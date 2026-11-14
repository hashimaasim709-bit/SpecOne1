// Customer-facing live tracker, reached through the secret link in the confirmation message.
import { Hono } from 'hono';
import { z } from 'zod';
import { SLOT_ORDER, SLOTS, slotLabel, STATUS_META, type SlotKey } from '../../shared/constants';
import { fitsDay } from '../../shared/availability';
import { addDays, formatDate, formatReg, isIsoDate, todayIn } from '../../shared/format';
import type { TrackPayload } from '../../shared/types';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { audit } from '../lib/auth';
import { all, first, run } from '../lib/db';
import { noStore, readJson } from '../lib/http';
import { fail, rateLimit } from '../lib/security';
import { getSettings } from '../lib/settings';
import { addEvent, bookingItems, bookingVehicles, getBookingByToken, setStatus, type BookingRow } from '../services/bookings';
import { getAvailability, getLocation } from '../services/catalog';
import { messageCustomer, pushOwner } from '../services/notify';
import { createCheckout, paymentsEnabled } from '../services/payments';
import { analyseReview } from '../services/sentiment';
import { emit } from '../services/webhooks';
import { decideEstimate, estimateOut, type EstimateRow } from './ops';

export const trackRoutes = new Hono<AppEnv>();

export async function bookingFromToken(c: Ctx): Promise<BookingRow> {
  const booking = await getBookingByToken(c.env.DB, c.req.param('token') ?? '');
  if (!booking) fail(404, 'This tracking link is not valid.');
  return booking!;
}

trackRoutes.get('/:token', async (c) => {
  noStore(c);
  await rateLimit(c, 'track', 240, 600);
  const b = await bookingFromToken(c);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const [vehicles, items, events, tech, van, docs, estimates] = await Promise.all([
    bookingVehicles(db, b.id),
    bookingItems(db, b.id),
    all<{ type: string; detail: string; created_at: string }>(db, 'SELECT type, detail, created_at FROM booking_events WHERE booking_id = ? AND public = 1 ORDER BY id', b.id),
    b.assigned_user_id ? first<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', b.assigned_user_id) : null,
    first<{ lat: number | null; lng: number | null; heading: number | null; position_at: string | null }>(db, 'SELECT lat, lng, heading, position_at FROM vans WHERE tracking_booking_id = ? ORDER BY position_at DESC LIMIT 1', b.id),
    Promise.all([
      all<{ id: number }>(db, 'SELECT id FROM battery_tests WHERE booking_id = ?', b.id),
      all<{ id: number; kind: string }>(db, "SELECT id, kind FROM checklist_runs WHERE booking_id = ? AND status = 'completed' AND kind IN ('vhc','ppi')", b.id),
    ]),
    all<EstimateRow>(db, "SELECT * FROM estimates WHERE booking_id = ? AND status != 'withdrawn' ORDER BY id DESC", b.id),
  ]);
  const showVan = (b.status === 'en_route' || b.status === 'arrived') && van?.lat != null && van.position_at && Date.now() - Date.parse(van.position_at) < 30 * 60_000;
  const t = encodeURIComponent(b.access_token);
  const documents = [{ label: b.status === 'completed' ? 'Invoice' : 'Booking summary', href: `/track/${t}/invoice.pdf` }];
  if (b.status === 'completed' || b.findings) documents.push({ label: 'Technical report', href: `/track/${t}/report.pdf` });
  docs[0].forEach((d) => documents.push({ label: 'Battery health certificate', href: `/track/${t}/battery/${d.id}.pdf` }));
  docs[1].forEach((d) => documents.push({ label: d.kind === 'ppi' ? 'Pre-purchase inspection report' : 'Vehicle health check', href: `/track/${t}/checklist/${d.id}.pdf` }));

  const payload: TrackPayload = {
    ref: b.ref,
    status: b.status,
    statusText: STATUS_META[b.status].customer,
    date: b.date,
    slot: slotLabel(b.slot),
    serviceMode: b.service_mode,
    address: b.address,
    destination: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null,
    van: showVan ? { lat: van!.lat!, lng: van!.lng!, heading: van!.heading, updatedAt: van!.position_at! } : null,
    etaMinutes: b.status === 'en_route' ? b.eta_minutes : null,
    technician: tech?.name ?? settings.business.leadEngineer,
    vehicles: vehicles.map((v) => ({ reg: formatReg(v.reg), label: [v.year, v.make, v.model].filter(Boolean).join(' ') })),
    items: items.map((i) => ({ name: i.qty !== 1 ? `${i.name} × ${i.qty}` : i.name, price: Math.round(i.qty * i.unit_price) })),
    total: b.total,
    paid: b.paid_amount,
    balance: Math.max(0, b.total - b.paid_amount),
    currency: b.currency,
    canPayOnline: paymentsEnabled(c.env) && b.total - b.paid_amount > 0 && !['cancelled', 'no_show'].includes(b.status),
    events: events.map((e) => ({ type: e.type, detail: e.detail, at: e.created_at })),
    documents,
    reviewUrl: settings.business.googleReviewUrl,
    business: { name: settings.business.name, phone: settings.business.phone, whatsapp: settings.business.whatsapp },
    canReschedule: canReschedule(b, todayIn(settings.business.timezone)),
    estimates: estimates.map((e) => { const o = estimateOut(e); return { id: o.id, title: o.title, note: o.note, items: o.items, total: o.total, status: o.status as 'pending' | 'approved' | 'declined', decidedAt: o.decidedAt, createdAt: o.createdAt }; }),
  };
  return c.json(payload);
});

trackRoutes.post('/:token/pay', async (c) => {
  await rateLimit(c, 'track-pay', 10, 600);
  const b = await bookingFromToken(c);
  const { kind } = await readJson(c, z.object({ kind: z.enum(['deposit', 'balance']).default('balance') }));
  const settings = await getSettings(c.env.DB);
  const customer = await first<{ email: string }>(c.env.DB, 'SELECT email FROM customers WHERE id = ?', b.customer_id);
  const url = await createCheckout(c.env, b, kind === 'deposit' && b.paid_amount === 0 && b.deposit_due > 0 ? 'deposit' : 'balance', originOf(c), customer?.email ?? '', settings.business.name);
  return c.json({ ok: true, url });
});

trackRoutes.post('/:token/cancel', async (c) => {
  await rateLimit(c, 'track-cancel', 5, 3600);
  const b = await bookingFromToken(c);
  const { reason } = await readJson(c, z.object({ reason: z.string().trim().max(300).default('') }));
  const settings = await getSettings(c.env.DB);
  if (!['pending', 'confirmed'].includes(b.status)) fail(409, 'This booking can no longer be cancelled online — please call us.');
  if (b.date <= todayIn(settings.business.timezone)) fail(409, `On-the-day changes need a quick call: ${settings.business.phone}.`);
  const customer = await first<{ name: string }>(c.env.DB, 'SELECT name FROM customers WHERE id = ?', b.customer_id);
  await setStatus(c.env, settings, b.id, 'cancelled', customer?.name ?? 'Customer', originOf(c), { reason: `Cancelled by customer${reason ? `: ${reason}` : ''}` });
  await audit(c, 'cancel', 'booking', b.id, `Customer cancelled ${b.ref}`, { reason }, { type: 'customer', id: b.customer_id, name: customer?.name ?? 'Customer' });
  c.executionCtx.waitUntil(pushOwner(c.env, `Cancelled: ${b.ref}`, `${customer?.name ?? 'Customer'} cancelled their ${b.date} booking online.${reason ? ` Reason: ${reason}` : ''}`, `${originOf(c)}/admin#/bookings/${b.id}`, 4, ['x']));
  return c.json({ ok: true });
});

trackRoutes.post('/:token/feedback', async (c) => {
  await rateLimit(c, 'feedback', 5, 3600);
  const b = await bookingFromToken(c);
  if (b.status !== 'completed') fail(409, 'You can leave feedback once the job is complete.');
  const input = await readJson(c, z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(2000).default(''), name: z.string().trim().max(80).default('') }));
  const db = c.env.DB;
  const existing = await first<{ id: number }>(db, "SELECT id FROM reviews WHERE booking_id = ? AND source = 'site'", b.id);
  const customer = await first<{ name: string }>(db, 'SELECT name FROM customers WHERE id = ?', b.customer_id);
  const vehicle = (await bookingVehicles(db, b.id))[0];
  const author = input.name || `${(customer?.name ?? 'Customer').split(' ')[0]}${customer?.name?.includes(' ') ? ` ${customer.name.split(' ').pop()![0]}.` : ''}`;
  let id: number;
  if (existing) {
    await run(db, 'UPDATE reviews SET rating = ?, body = ?, author = ? WHERE id = ?', input.rating, input.body, author, existing.id);
    id = existing.id;
  } else {
    id = (await run(db, "INSERT INTO reviews (source, booking_id, author, rating, body, vehicle, visible) VALUES ('site', ?, ?, ?, ?, ?, 0)", b.id, author, input.rating, input.body, vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : '')).id;
  }
  c.executionCtx.waitUntil((async () => {
    const s = await analyseReview(c.env, id, input.body, input.rating);
    await emit(db, 'review.received', { id, booking_ref: b.ref, rating: input.rating, body: input.body, sentiment: s.label });
    if (input.rating <= 3 || s.label === 'negative') {
      await pushOwner(c.env, `${input.rating}★ feedback on ${b.ref}`, `${s.summary}${s.followUp ? `\nSuggested: ${s.followUp}` : ''}\n"${input.body.slice(0, 200)}"`, `${originOf(c)}/admin#/r/reviews`, 4, ['warning']);
    }
  })());
  const settings = await getSettings(db);
  return c.json({ ok: true, reviewUrl: input.rating >= 4 ? settings.business.googleReviewUrl : '' });
});

trackRoutes.post('/:token/estimates/:id', async (c) => {
  await rateLimit(c, 'estimate', 10, 3600);
  const b = await bookingFromToken(c);
  const input = await readJson(c, z.object({ decision: z.enum(['approve', 'decline']), name: z.string().trim().max(80).default(''), note: z.string().trim().max(500).default('') }));
  const customer = await first<{ name: string }>(c.env.DB, 'SELECT name FROM customers WHERE id = ?', b.customer_id);
  const name = input.name || customer?.name || 'Customer';
  const { total } = await decideEstimate(c, b.id, Number(c.req.param('id')), input.decision, name, input.note);
  await audit(c, input.decision, 'estimate', c.req.param('id') ?? '', `${name} ${input.decision === 'approve' ? 'approved' : 'declined'} an estimate on ${b.ref}`, {}, { type: 'customer', id: b.customer_id, name });
  return c.json({ ok: true, total });
});

// ── Self-service reschedule: move the visit to another open day / window ──
const canReschedule = (b: BookingRow, today: string): boolean => ['pending', 'confirmed'].includes(b.status) && b.date > today && !b.emergency && b.slot !== 'asap';

trackRoutes.get('/:token/availability', async (c) => {
  noStore(c);
  await rateLimit(c, 'track-availability', 60, 600);
  const b = await bookingFromToken(c);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const loc = await getLocation(db, b.location_id);
  const today = todayIn(loc.timezone);
  const days = await getAvailability(db, settings, loc, addDays(today, 1), Math.min(35, settings.booking.horizonDays), b.id);
  return c.json({ span: b.slot_span, days: days.map((d) => ({ date: d.date, slots: SLOT_ORDER.filter((sl) => fitsDay(d, sl, b.slot_span)) })).filter((d) => d.slots.length) });
});

trackRoutes.post('/:token/reschedule', async (c) => {
  await rateLimit(c, 'reschedule', 6, 3600);
  const b = await bookingFromToken(c);
  const input = await readJson(c, z.object({ date: z.string().refine(isIsoDate, 'Choose a valid date.'), slot: z.enum(['morning', 'afternoon', 'evening']) }));
  const db = c.env.DB;
  const settings = await getSettings(db);
  const loc = await getLocation(db, b.location_id);
  const today = todayIn(loc.timezone);
  if (!canReschedule(b, today)) fail(409, `This booking can't be moved online — please call ${settings.business.phone}.`);
  if (input.date <= today || input.date > addDays(today, settings.booking.horizonDays)) fail(422, 'Choose a day from tomorrow onwards.');
  if (input.date === b.date && input.slot === b.slot) return c.json({ ok: true, unchanged: true });
  const [day] = await getAvailability(db, settings, loc, input.date, 1, b.id);
  if (!fitsDay(day, input.slot as SlotKey, b.slot_span)) fail(409, 'That time has just been taken — please pick another.');
  await run(db, "UPDATE bookings SET date = ?, slot = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", input.date, input.slot, b.id);
  const remindAt = `${addDays(input.date, -1)}T16:00:00Z`;
  const moved = await run(db, "UPDATE scheduled_messages SET send_at = ? WHERE booking_id = ? AND kind = 'booking_reminder' AND status = 'pending'", remindAt, b.id);
  if (!moved.changes && remindAt > new Date().toISOString()) await run(db, "INSERT INTO scheduled_messages (kind, booking_id, customer_id, send_at) VALUES ('booking_reminder', ?, ?, ?)", b.id, b.customer_id, remindAt);
  const when = `${formatDate(input.date, 'day')}, ${SLOTS[input.slot as SlotKey].label}`;
  const customer = await first<{ name: string; email: string; phone: string }>(db, 'SELECT name, email, phone FROM customers WHERE id = ?', b.customer_id);
  await addEvent(db, b.id, 'rescheduled', `Moved from ${formatDate(b.date, 'day')} (${slotLabel(b.slot)}) to ${when}`, customer?.name ?? 'Customer', true);
  await audit(c, 'reschedule', 'booking', b.id, `Customer moved ${b.ref} to ${input.date} ${input.slot}`, { from: `${b.date} ${b.slot}`, to: `${input.date} ${input.slot}` }, { type: 'customer', id: b.customer_id, name: customer?.name ?? 'Customer' });
  c.executionCtx.waitUntil(pushOwner(c.env, `Rescheduled: ${b.ref}`, `${customer?.name ?? 'Customer'} moved their booking to ${when} (was ${formatDate(b.date, 'day')}).`, `${originOf(c)}/admin#/bookings/${b.id}`, 4, ['calendar']));
  if (customer) c.executionCtx.waitUntil(messageCustomer(c.env, settings, customer, { subject: `Booking ${b.ref} moved to ${when}`, text: `Done — your booking ${b.ref} is now ${when}. Your tracker link stays the same:`, ctaLabel: 'Open tracker', ctaUrl: `${originOf(c)}/track/${b.access_token}`, bookingId: b.id, emailOnly: true }).then(() => undefined));
  await emit(db, 'booking.updated', { ref: b.ref, date: input.date, slot: input.slot, rescheduled: true });
  return c.json({ ok: true, when });
});
