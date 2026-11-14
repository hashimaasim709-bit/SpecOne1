// Admin API. Every route requires a signed-in, unlocked member of staff; most also need a
// specific permission (see ROLE_PERMISSIONS). All changes are written to the audit trail.
import { Hono } from 'hono';
import { z } from 'zod';
import { BODIES, BOOKING_STATUSES, can, ROLE_PERMISSIONS, ROLES, SLOT_ORDER, slotLabel, type BookingStatus } from '../../shared/constants';
import { addDays, displayPhone, formatDate, formatReg, isIsoDate, normPhone, normReg, todayIn } from '../../shared/format';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { audit, diff, revokeSessions, staffOrFail } from '../lib/auth';
import { hashPassword, passwordProblem, randomToken } from '../lib/crypto';
import { all, first, likeTerm, nowIso, parseJson, run } from '../lib/db';
import { download, intParam, intQuery, noStore, readJson, readUpload } from '../lib/http';
import { fail, rateLimit } from '../lib/security';
import { DEFAULT_SETTINGS, getSettings, saveSetting, setFlag, SETTINGS_KEYS, type Settings, type SettingsKey } from '../lib/settings';
import { exportDatabase, readBackup, runBackup, toCsv } from '../services/backup';
import {
  addEvent, bookingItems, bookingVehicles, createBooking, getBooking, recalcTotals, setStatus, upsertCustomer, upsertVehicle,
} from '../services/bookings';
import { getAvailability, getLocation } from '../services/catalog';
import { lookupReg, etaMinutes } from '../services/lookups';
import { dataUrlToBytes, deleteMedia, LIMITS, mediaUrl, storeMedia } from '../services/media';
import { integrationStatus, messageCustomer, sendSms, sendWhatsApp, whatsappLink } from '../services/notify';
import { createCheckout, paymentsEnabled, recordPayment } from '../services/payments';
import { dashboard, jobProfit, lifetimeValue, taxLedger } from '../services/reports';
import { analyseReview, analyseThread } from '../services/sentiment';
import { deliverDue } from '../services/webhooks';
import { hmacSha256Hex } from '../lib/crypto';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  staffOrFail(c);
  noStore(c);
  await next();
});

const fin = (c: Ctx) => can(c.get('staff')?.role, 'finance.read');

// ───────────────────────────── Dashboard ─────────────────────────────
adminRoutes.get('/dashboard', async (c) => {
  const settings = await getSettings(c.env.DB);
  return c.json(await dashboard(c.env.DB, settings, fin(c)));
});

// ───────────────────────────── Bookings ─────────────────────────────
adminRoutes.get('/bookings', async (c) => {
  staffOrFail(c, 'bookings.read');
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const from = c.req.query('from');
  const to = c.req.query('to');
  const status = c.req.query('status');
  const q = (c.req.query('q') ?? '').trim();
  if (isIsoDate(from)) { where.push('b.date >= ?'); binds.push(from); }
  if (isIsoDate(to)) { where.push('b.date <= ?'); binds.push(to); }
  if (status === 'active') where.push("b.status IN ('pending','confirmed','en_route','arrived','in_progress')");
  else if (status && (BOOKING_STATUSES as readonly string[]).includes(status)) { where.push('b.status = ?'); binds.push(status); }
  if (q) {
    const t = likeTerm(q);
    const reg = likeTerm(normReg(q) || q);
    where.push(`(b.ref LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR b.postcode LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id AND v.reg LIKE ? ESCAPE '\\'))`);
    binds.push(t, t, likeTerm(normPhone(q) || q), t, t, reg);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = intQuery(c, 'page', 1, 1, 10000);
  const size = intQuery(c, 'size', 50, 1, 200);
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC';
  const rows = await all(
    c.env.DB,
    `SELECT b.id, b.ref, b.status, b.date, b.slot, b.slot_span, b.emergency, b.source, b.postcode, b.address, b.service_mode, ${fin(c) ? 'b.total, b.paid_amount, b.payment_status,' : ''}
       b.assigned_user_id, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
       (SELECT GROUP_CONCAT(v.reg, ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS regs,
       (SELECT GROUP_CONCAT(v.make || ' ' || v.model, ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS vehicles,
       (SELECT GROUP_CONCAT(name, ' · ') FROM booking_items WHERE booking_id = b.id) AS services
     FROM bookings b JOIN customers c ON c.id = b.customer_id ${whereSql}
     ORDER BY b.date ${order}, CASE b.slot WHEN 'asap' THEN 0 WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END ${order}, b.id ${order} LIMIT ? OFFSET ?`,
    ...binds, size, (page - 1) * size,
  );
  const count = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM bookings b JOIN customers c ON c.id = b.customer_id ${whereSql}`, ...binds);
  return c.json({ rows, total: count?.n ?? 0, page, size });
});

adminRoutes.get('/calendar', async (c) => {
  staffOrFail(c, 'bookings.read');
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') ?? '') ? c.req.query('month')! : todayIn().slice(0, 7);
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const settings = await getSettings(c.env.DB);
  const loc = await getLocation(c.env.DB);
  const [bookings, blocked, availability] = await Promise.all([
    all(c.env.DB, `SELECT b.id, b.ref, b.date, b.slot, b.slot_span, b.status, b.emergency, c.name AS customer_name,
        (SELECT GROUP_CONCAT(v.reg, ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS regs
      FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.date BETWEEN ? AND ? AND b.status NOT IN ('cancelled') ORDER BY b.date, b.slot`, from, lastDay),
    all(c.env.DB, 'SELECT date, reason FROM blocked_dates WHERE date BETWEEN ? AND ?', from, lastDay),
    getAvailability(c.env.DB, settings, loc, from, Number(lastDay.slice(8, 10))),
  ]);
  return c.json({ month, bookings, blocked, availability });
});

adminRoutes.post('/blocked-dates', async (c) => {
  staffOrFail(c, 'bookings.write');
  const input = await readJson(c, z.object({ date: z.string().refine(isIsoDate), reason: z.string().max(120).default(''), blocked: z.boolean() }));
  if (input.blocked) await run(c.env.DB, 'INSERT INTO blocked_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason', input.date, input.reason || 'Unavailable');
  else await run(c.env.DB, 'DELETE FROM blocked_dates WHERE date = ?', input.date);
  await audit(c, input.blocked ? 'block' : 'unblock', 'calendar', input.date, `${input.blocked ? 'Blocked' : 'Unblocked'} ${input.date}${input.reason ? ` (${input.reason})` : ''}`);
  return c.json({ ok: true });
});

adminRoutes.get('/bookings/:id', async (c) => {
  staffOrFail(c, 'bookings.read');
  const id = intParam(c, 'id');
  const db = c.env.DB;
  const b = await getBooking(db, id);
  if (!b) fail(404, 'Booking not found.');
  const finance = fin(c);
  const [customer, vehicles, items, events, payments, media, expenses, checklists, dpf, battery, flash, freeze, parts, users, vans, commission, previous] = await Promise.all([
    first(db, 'SELECT id, name, email, phone, address, postcode, company, notes, tags, loyalty_points, created_at FROM customers WHERE id = ?', b!.customer_id),
    bookingVehicles(db, id),
    bookingItems(db, id),
    all(db, 'SELECT id, type, detail, actor, public, created_at FROM booking_events WHERE booking_id = ? ORDER BY id', id),
    finance || can(c.get('staff')?.role, 'bookings.write') ? all(db, 'SELECT id, kind, method, provider, amount, note, created_at FROM payments WHERE booking_id = ? ORDER BY id', id) : [],
    all<{ id: number; storage_key: string; kind: string; content_type: string; label: string; created_at: string }>(db, 'SELECT id, storage_key, kind, content_type, label, created_at FROM media WHERE booking_id = ? ORDER BY id', id),
    finance ? all(db, 'SELECT id, description, category, amount, supplier, spent_on FROM expenses WHERE booking_id = ? ORDER BY id', id) : [],
    all(db, 'SELECT r.id, r.kind, r.status, r.score, r.max_score, r.completed_at, t.name FROM checklist_runs r JOIN checklist_templates t ON t.id = r.template_id WHERE r.booking_id = ? ORDER BY r.id', id),
    all(db, 'SELECT * FROM dpf_logs WHERE booking_id = ? ORDER BY id', id),
    all(db, 'SELECT * FROM battery_tests WHERE booking_id = ? ORDER BY id', id),
    all(db, 'SELECT * FROM flash_log WHERE booking_id = ? ORDER BY id', id),
    all(db, 'SELECT * FROM freeze_frames WHERE booking_id = ? ORDER BY id', id),
    all(db, 'SELECT id, supplier, status, items, created_at FROM parts_requests WHERE booking_id = ? ORDER BY id', id),
    all(db, 'SELECT id, name, role, phone FROM users WHERE active = 1 ORDER BY name'),
    all(db, 'SELECT id, name, reg, lat, lng, tracking_booking_id, position_at FROM vans WHERE active = 1 ORDER BY id'),
    finance ? first(db, 'SELECT c.amount, c.status, p.name FROM commissions c JOIN partners p ON p.id = c.partner_id WHERE c.booking_id = ?', id) : null,
    all(db, `SELECT b2.id, b2.ref, b2.date, b2.status FROM bookings b2 WHERE b2.customer_id = ? AND b2.id <> ? ORDER BY b2.date DESC LIMIT 8`, b!.customer_id, id),
  ]);
  const partner = b!.partner_id ? await first(db, 'SELECT id, name, code FROM partners WHERE id = ?', b!.partner_id) : null;
  const settings = await getSettings(db);
  const track = `${originOf(c)}/track/${b!.access_token}`;
  const first_ = String((customer as { name?: string } | null)?.name ?? '').split(' ')[0];
  const phone = String((customer as { phone?: string } | null)?.phone ?? '');
  const wa = phone ? {
    onTheWay: whatsappLink(phone, `Hi ${first_}, it's ${settings.business.leadEngineer} from ${settings.business.name}. I'm on my way to you now — you can follow the van live here: ${track}`),
    running: whatsappLink(phone, `Hi ${first_}, ${settings.business.name} here. Running about 15 minutes behind today — sorry! Live tracker: ${track}`),
    arrived: whatsappLink(phone, `Hi ${first_}, I've arrived for your ${settings.business.name} appointment.`),
    done: whatsappLink(phone, `Hi ${first_}, all finished! Your invoice and report are here: ${track}`),
    review: whatsappLink(phone, `Hi ${first_}, thanks again for choosing ${settings.business.name}. If you have a moment, a Google review would really help: ${settings.business.googleReviewUrl}`),
  } : null;
  const booking = { ...b!, quote_snapshot: parseJson(b!.quote_snapshot, {}) } as Record<string, unknown>;
  if (!finance) for (const k of ['subtotal', 'discount', 'peak_adjustment', 'loyalty_discount', 'quote_snapshot']) delete booking[k];
  return c.json({
    booking, customer, partner, vehicles, items, events, payments, expenses, checklists, dpf, battery, flash, freeze, users, vans, previous,
    parts: parts.map((p) => ({ ...p, items: parseJson((p as { items: string }).items, []) })),
    media: media.map((m) => ({ ...m, url: mediaUrl(m.storage_key) })),
    profit: finance ? await jobProfit(db, id) : null,
    commission,
    trackUrl: track,
    whatsapp: wa,
    signatureUrl: b!.signature_media_id ? mediaUrl((media.find((m) => m.id === b!.signature_media_id) ?? (await first<{ storage_key: string }>(db, 'SELECT storage_key FROM media WHERE id = ?', b!.signature_media_id)))?.storage_key) : '',
    canPayOnline: paymentsEnabled(c.env),
    labourRates: settings.pricing.labourRates,
  });
});

const editSchema = z.object({
  date: z.string().refine(isIsoDate).optional(),
  slot: z.enum([...SLOT_ORDER, 'asap'] as ['morning', 'afternoon', 'evening', 'asap']).optional(),
  slot_span: z.number().int().min(1).max(3).optional(),
  address: z.string().max(240).optional(),
  postcode: z.string().max(10).optional(),
  customer_notes: z.string().max(4000).optional(),
  internal_notes: z.string().max(4000).optional(),
  findings: z.string().max(10000).optional(),
  assigned_user_id: z.number().int().positive().nullable().optional(),
  van_id: z.number().int().positive().nullable().optional(),
  payment_method: z.string().max(40).optional(),
  emergency: z.boolean().optional(),
  // Money fields — finance only.
  discount: z.number().int().min(0).optional(),
  travel_fee: z.number().int().min(0).optional(),
  emergency_fee: z.number().int().min(0).optional(),
  deposit_due: z.number().int().min(0).optional(),
});

adminRoutes.patch('/bookings/:id', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, editSchema);
  const before = await getBooking(c.env.DB, id);
  if (!before) fail(404, 'Booking not found.');
  const money = ['discount', 'travel_fee', 'emergency_fee', 'deposit_due'] as const;
  if (money.some((k) => k in input) && !can(c.get('staff')?.role, 'finance.write')) fail(403, 'Changing prices needs finance access.');
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) values[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  if (values.postcode) values.postcode = String(values.postcode).toUpperCase();
  const cols = Object.keys(values);
  if (!cols.length) return c.json({ ok: true });
  await run(c.env.DB, `UPDATE bookings SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...(cols.map((k) => values[k]) as (string | number | null)[]), nowIso(), id);
  if (money.some((k) => k in input)) await recalcTotals(c.env.DB, id);
  const changes = diff(before as unknown as Record<string, unknown>, values);
  if (changes.date || changes.slot) await addEvent(c.env.DB, id, 'rescheduled', `Moved to ${formatDate(String(values.date ?? before!.date), 'long')}, ${slotLabel(String(values.slot ?? before!.slot))}`, c.get('staff')!.name);
  if (Object.keys(changes).length) await audit(c, 'update', 'booking', id, `Edited ${before!.ref}: ${Object.keys(changes).join(', ')}`, changes);
  return c.json({ ok: true });
});

adminRoutes.post('/bookings/:id/status', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ status: z.enum(BOOKING_STATUSES), reason: z.string().max(300).default(''), etaMinutes: z.number().int().min(1).max(600).nullable().default(null), notify: z.boolean().default(true) }));
  const settings = await getSettings(c.env.DB);
  const before = await getBooking(c.env.DB, id);
  if (!before) fail(404, 'Booking not found.');
  let eta = input.etaMinutes;
  if (input.status === 'en_route' && eta == null && before!.lat != null && before!.lng != null) {
    const van = await first<{ lat: number | null; lng: number | null }>(c.env.DB, 'SELECT lat, lng FROM vans WHERE id = COALESCE(?, 1)', before!.van_id);
    if (van?.lat != null && van.lng != null) eta = etaMinutes(van.lat, van.lng, before!.lat!, before!.lng!, settings.booking.avgSpeedMph);
  }
  const updated = await setStatus(c.env, settings, id, input.status, c.get('staff')!.name, originOf(c), { reason: input.reason, etaMinutes: eta, notify: input.notify });
  if (input.status === 'en_route') await run(c.env.DB, 'UPDATE vans SET tracking_booking_id = ? WHERE id = COALESCE(?, 1)', id, before!.van_id);
  await audit(c, 'status', 'booking', id, `${before!.ref}: ${before!.status} → ${input.status}`, { status: [before!.status, input.status], reason: input.reason });
  c.executionCtx.waitUntil(deliverDue(c.env.DB, 10));
  return c.json({ ok: true, status: updated.status });
});

/** Live GPS from the technician's phone. Feeds the customer tracker and recalculates the ETA. */
adminRoutes.post('/van/position', async (c) => {
  staffOrFail(c, 'bookings.write');
  await rateLimit(c, 'van-gps', 240, 600, String(c.get('staff')!.id));
  const input = await readJson(c, z.object({ vanId: z.number().int().positive().default(1), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), heading: z.number().nullable().default(null), speed: z.number().nullable().default(null), bookingId: z.number().int().positive().nullable().default(null) }));
  const db = c.env.DB;
  await run(db, 'UPDATE vans SET lat = ?, lng = ?, heading = ?, speed_mph = ?, position_at = ?, tracking_booking_id = COALESCE(?, tracking_booking_id) WHERE id = ?', input.lat, input.lng, input.heading, input.speed, nowIso(), input.bookingId, input.vanId);
  const van = await first<{ tracking_booking_id: number | null }>(db, 'SELECT tracking_booking_id FROM vans WHERE id = ?', input.vanId);
  let eta: number | null = null;
  if (van?.tracking_booking_id) {
    const b = await getBooking(db, van.tracking_booking_id);
    if (b && b.status === 'en_route' && b.lat != null && b.lng != null) {
      const settings = await getSettings(db);
      eta = etaMinutes(input.lat, input.lng, b.lat, b.lng, settings.booking.avgSpeedMph);
      await run(db, 'UPDATE bookings SET eta_minutes = ? WHERE id = ?', eta, b.id);
    }
  }
  return c.json({ ok: true, tracking: van?.tracking_booking_id ?? null, eta });
});

adminRoutes.post('/bookings/:id/dispatch', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ userId: z.number().int().positive().nullable(), vanId: z.number().int().positive().nullable().default(null), notify: z.boolean().default(true), note: z.string().max(500).default('') }));
  const db = c.env.DB;
  const b = await getBooking(db, id);
  if (!b) fail(404, 'Booking not found.');
  const tech = input.userId ? await first<{ id: number; name: string; phone: string }>(db, 'SELECT id, name, phone FROM users WHERE id = ? AND active = 1', input.userId) : null;
  if (input.userId && !tech) fail(404, 'Team member not found.');
  await run(db, 'UPDATE bookings SET assigned_user_id = ?, van_id = COALESCE(?, van_id), updated_at = ? WHERE id = ?', input.userId, input.vanId, nowIso(), id);
  await addEvent(db, id, 'dispatch', tech ? `Assigned to ${tech.name}` : 'Unassigned', c.get('staff')!.name, false);
  let sent: string[] = [];
  if (tech && input.notify && tech.phone) {
    const customer = await first<{ name: string; phone: string }>(db, 'SELECT name, phone FROM customers WHERE id = ?', b!.customer_id);
    const vehicles = await bookingVehicles(db, id);
    const items = await bookingItems(db, id);
    const text = `New job ${b!.ref}: ${formatDate(b!.date, 'day')} ${slotLabel(b!.slot)}. ${customer?.name} ${displayPhone(customer?.phone)}. ${b!.address}. ${vehicles.map((v) => `${formatReg(v.reg)} ${v.make} ${v.model}`).join('; ')}. ${items.map((i) => i.name).join('; ')}.${input.note ? ` Note: ${input.note}` : ''} Job card: ${originOf(c)}/admin#/bookings/${id}`;
    const results = await Promise.all([sendSms(c.env, tech.phone, text, id), c.env.TWILIO_WHATSAPP_FROM ? sendWhatsApp(c.env, tech.phone, text, id) : null]);
    sent = results.filter((r) => r?.ok).map((r) => r!.channel);
  }
  await audit(c, 'dispatch', 'booking', id, `${b!.ref} assigned to ${tech?.name ?? 'nobody'}`, { assigned_user_id: [b!.assigned_user_id, input.userId] });
  return c.json({ ok: true, sent, whatsapp: tech?.phone ? whatsappLink(tech.phone, `Job ${b!.ref} — ${originOf(c)}/admin#/bookings/${id}`) : '' });
});

// Line items: labour, parts and custom work on the job card.
const itemSchema = z.object({
  kind: z.enum(['package', 'labour', 'part', 'custom']).default('custom'),
  name: z.string().trim().min(1).max(200),
  qty: z.number().min(0.01).max(1000).default(1),
  unitPrice: z.number().int().min(-10_000_000).max(10_000_000),
  vehicleId: z.number().int().positive().nullable().default(null),
});

adminRoutes.post('/bookings/:id/items', async (c) => {
  staffOrFail(c, 'finance.write');
  const id = intParam(c, 'id');
  const item = await readJson(c, itemSchema);
  const b = await getBooking(c.env.DB, id);
  if (!b) fail(404, 'Booking not found.');
  await run(c.env.DB, 'INSERT INTO booking_items (booking_id, vehicle_id, kind, name, qty, unit_price, sort) VALUES (?, ?, ?, ?, ?, ?, 200)', id, item.vehicleId, item.kind, item.name, item.qty, item.unitPrice);
  const total = await recalcTotals(c.env.DB, id);
  await audit(c, 'add_item', 'booking', id, `${b!.ref}: added ${item.kind} "${item.name}" ${item.qty} × ${item.unitPrice}`, item);
  return c.json({ ok: true, total });
});

adminRoutes.patch('/bookings/:id/items/:itemId', async (c) => {
  staffOrFail(c, 'finance.write');
  const id = intParam(c, 'id');
  const itemId = intParam(c, 'itemId');
  const item = await readJson(c, itemSchema.partial());
  const before = await first(c.env.DB, 'SELECT * FROM booking_items WHERE id = ? AND booking_id = ?', itemId, id);
  if (!before) fail(404, 'Line not found.');
  await run(c.env.DB, 'UPDATE booking_items SET name = COALESCE(?, name), qty = COALESCE(?, qty), unit_price = COALESCE(?, unit_price) WHERE id = ?', item.name ?? null, item.qty ?? null, item.unitPrice ?? null, itemId);
  const total = await recalcTotals(c.env.DB, id);
  await audit(c, 'edit_item', 'booking', id, `Edited line "${before!.name}"`, diff(before, { name: item.name, qty: item.qty, unit_price: item.unitPrice }));
  return c.json({ ok: true, total });
});

adminRoutes.delete('/bookings/:id/items/:itemId', async (c) => {
  staffOrFail(c, 'finance.write');
  const id = intParam(c, 'id');
  const itemId = intParam(c, 'itemId');
  const before = await first<{ name: string }>(c.env.DB, 'SELECT name FROM booking_items WHERE id = ? AND booking_id = ?', itemId, id);
  await run(c.env.DB, 'DELETE FROM booking_items WHERE id = ? AND booking_id = ?', itemId, id);
  const total = await recalcTotals(c.env.DB, id);
  if (before) await audit(c, 'remove_item', 'booking', id, `Removed line "${before.name}"`);
  return c.json({ ok: true, total });
});

adminRoutes.post('/bookings/:id/payments', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ kind: z.enum(['deposit', 'balance', 'refund']).default('balance'), method: z.enum(['card', 'cash', 'bank_transfer', 'sumup', 'online', 'account', 'other']), amount: z.number().int().positive(), note: z.string().max(300).default('') }));
  if (input.kind === 'refund') staffOrFail(c, 'finance.write');
  await recordPayment(c.env.DB, id, { ...input, provider: 'manual', actor: c.get('staff')!.name });
  await audit(c, 'payment', 'booking', id, `${input.kind} ${input.amount} by ${input.method}`, input);
  c.executionCtx.waitUntil(deliverDue(c.env.DB, 10));
  return c.json({ ok: true });
});

adminRoutes.post('/bookings/:id/payment-link', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const b = await getBooking(c.env.DB, id);
  if (!b) fail(404, 'Booking not found.');
  const settings = await getSettings(c.env.DB);
  const customer = await first<{ name: string; email: string; phone: string }>(c.env.DB, 'SELECT name, email, phone FROM customers WHERE id = ?', b!.customer_id);
  const { send } = await readJson(c, z.object({ send: z.boolean().default(true) }));
  const url = await createCheckout(c.env, b!, b!.paid_amount === 0 && b!.deposit_due > 0 && b!.status !== 'completed' ? 'deposit' : 'balance', originOf(c), customer?.email ?? '', settings.business.name);
  if (send && customer) await messageCustomer(c.env, settings, customer, { subject: `Payment link — ${b!.ref}`, text: 'Here is your secure payment link (card, Apple Pay or Google Pay):', ctaLabel: 'Pay securely', ctaUrl: url, bookingId: id });
  await audit(c, 'payment_link', 'booking', id, `Payment link created for ${b!.ref}${send ? ' and sent' : ''}`);
  return c.json({ ok: true, url });
});

/** Customer signs the pre-inspection on the technician's touchscreen. */
adminRoutes.post('/bookings/:id/signature', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ dataUrl: z.string().max(600_000), name: z.string().trim().min(2).max(80), notes: z.string().max(4000).default('') }));
  const b = await getBooking(c.env.DB, id);
  if (!b) fail(404, 'Booking not found.');
  const media = await storeMedia(c.env, dataUrlToBytes(input.dataUrl), { kind: 'signature', visibility: 'private', bookingId: id, label: `Signature — ${input.name}`, uploadedBy: c.get('staff')!.name });
  const walkaround = input.notes ? `Pre-work inspection: ${input.notes}` : '';
  await run(c.env.DB, "UPDATE bookings SET signature_media_id = ?, signed_name = ?, signed_at = ?, internal_notes = CASE WHEN ? <> '' THEN TRIM(internal_notes || char(10) || ?) ELSE internal_notes END, updated_at = ? WHERE id = ?", media.id, input.name, nowIso(), walkaround, walkaround, nowIso(), id);
  await addEvent(c.env.DB, id, 'signed', `Pre-inspection signed by ${input.name}`, c.get('staff')!.name);
  await audit(c, 'sign', 'booking', id, `${b!.ref}: pre-inspection signed by ${input.name}`);
  return c.json({ ok: true, url: mediaUrl(media.storage_key) });
});

adminRoutes.post('/bookings/:id/resend', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const { kind } = await readJson(c, z.object({ kind: z.enum(['confirmation', 'invoice', 'review']) }));
  const b = await getBooking(c.env.DB, id);
  if (!b) fail(404, 'Booking not found.');
  const settings = await getSettings(c.env.DB);
  const customer = await first<{ name: string; email: string; phone: string }>(c.env.DB, 'SELECT name, email, phone FROM customers WHERE id = ?', b!.customer_id);
  const track = `${originOf(c)}/track/${b!.access_token}`;
  const msg = kind === 'confirmation'
    ? { subject: `Your booking ${b!.ref}`, text: `Your booking ${b!.ref} is on ${formatDate(b!.date, 'day')}, ${slotLabel(b!.slot)}. Live tracker:`, ctaLabel: 'Open tracker', ctaUrl: track }
    : kind === 'invoice'
      ? { subject: `Invoice — ${b!.ref}`, text: `Your invoice and report for ${b!.ref} are ready to view and download:`, ctaLabel: 'View invoice', ctaUrl: track }
      : { subject: 'How did we do?', text: `Thanks for choosing ${settings.business.name}. A quick Google review would mean a lot:`, ctaLabel: 'Leave a review', ctaUrl: settings.business.googleReviewUrl || track };
  const results = await messageCustomer(c.env, settings, customer!, { ...msg, bookingId: id });
  await audit(c, 'resend', 'booking', id, `Re-sent ${kind} for ${b!.ref}`);
  return c.json({ ok: true, results });
});

adminRoutes.post('/bookings/:id/media', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const { bytes, form } = await readUpload(c, c.env.MEDIA ? LIMITS.video : LIMITS.imageD1);
  const media = await storeMedia(c.env, bytes, { kind: 'job', visibility: 'private', bookingId: id, label: String(form.get('label') ?? '').slice(0, 120), uploadedBy: c.get('staff')!.name });
  await addEvent(c.env.DB, id, 'photo', `Photo added${media.label ? `: ${media.label}` : ''}`, c.get('staff')!.name, false);
  return c.json({ ok: true, id: media.id, url: mediaUrl(media.storage_key) });
});

/** Turn DTCs found in the findings into a supplier parts request. */
adminRoutes.post('/bookings/:id/parts-request', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ supplier: z.string().max(120).default(''), supplierContact: z.string().max(120).default('') }));
  const db = c.env.DB;
  const b = await getBooking(db, id);
  if (!b) fail(404, 'Booking not found.');
  const codes = [...new Set((b!.findings.toUpperCase().match(/\b[PBCU][0-9A-F]{4}\b/g) ?? []))].slice(0, 20);
  const known = codes.length ? await all<{ code: string; title: string; causes: string }>(db, `SELECT code, title, causes FROM dtc_codes WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes) : [];
  const items = codes.map((code) => {
    const k = known.find((d) => d.code === code);
    return { description: k ? `${k.title} — check: ${k.causes.split(/[,.]/)[0]}` : `Part for fault ${code}`, part_no: '', qty: 1, dtc: code };
  });
  if (!items.length) items.push({ description: '', part_no: '', qty: 1, dtc: '' });
  const vehicles = await bookingVehicles(db, id);
  const { id: reqId } = await run(db, "INSERT INTO parts_requests (booking_id, vehicle_reg, supplier, supplier_contact, status, items, notes, created_by) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)",
    id, vehicles[0]?.reg ?? '', input.supplier, input.supplierContact, JSON.stringify(items), vehicles[0] ? `${vehicles[0].year ?? ''} ${vehicles[0].make} ${vehicles[0].model}${vehicles[0].vin ? ` VIN ${vehicles[0].vin}` : ''}`.trim() : '', c.get('staff')!.name);
  await audit(c, 'create', 'parts_requests', reqId, `Parts request drafted from ${b!.ref} (${codes.join(', ') || 'no codes found'})`);
  return c.json({ ok: true, id: reqId, codes });
});

/** Send a parts request to the supplier by email (with the PDF link) or get a WhatsApp link. */
adminRoutes.post('/parts-requests/:id/send', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const req = await first<{ supplier: string; supplier_contact: string; vehicle_reg: string; items: string; notes: string }>(c.env.DB, 'SELECT * FROM parts_requests WHERE id = ?', id);
  if (!req) fail(404, 'Parts request not found.');
  const items = parseJson<{ description: string; part_no: string; qty: number; dtc: string }[]>(req!.items, []);
  const text = `Parts request PR-${id} for ${formatReg(req!.vehicle_reg)}${req!.notes ? ` (${req!.notes})` : ''}:\n${items.map((i) => `• ${i.qty} × ${i.description}${i.part_no ? ` [${i.part_no}]` : ''}`).join('\n')}\nPlease confirm price and availability.`;
  const contact = req!.supplier_contact.trim();
  const settings = await getSettings(c.env.DB);
  let sentBy = '';
  if (/@/.test(contact)) {
    const { sendEmail, emailLayout } = await import('../services/notify');
    const r = await sendEmail(c.env, { to: contact, subject: `Parts request PR-${id} — ${settings.business.name}`, text, html: emailLayout(settings, { heading: `Parts request PR-${id}`, paragraphs: text.split('\n') }), replyTo: settings.business.email });
    if (r.ok) sentBy = 'email';
  }
  await run(c.env.DB, "UPDATE parts_requests SET status = CASE WHEN status = 'draft' THEN 'requested' ELSE status END WHERE id = ?", id);
  await audit(c, 'send', 'parts_requests', id, `Parts request PR-${id} sent${sentBy ? ` by ${sentBy}` : ''}`);
  return c.json({ ok: true, sentBy, whatsapp: contact && !/@/.test(contact) ? whatsappLink(contact, text) : '', text });
});

// ───────────────────────────── Quick-booker (phone & walk-in) ─────────────────────────────
adminRoutes.post('/quick-book', async (c) => {
  staffOrFail(c, 'bookings.write');
  const input = await readJson(c, z.object({
    source: z.enum(['phone', 'walk_in', 'admin']).default('phone'),
    customer: z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(6).max(24), email: z.string().trim().max(120).default(''), marketing: z.boolean().default(false) }),
    vehicle: z.object({ reg: z.string().trim().min(2).max(12), make: z.string().max(60).default(''), model: z.string().max(80).default(''), year: z.number().int().nullable().optional(), size: z.enum(['S', 'M', 'L']).default('M'), body: z.enum(BODIES).default('hatchback') }),
    packageIds: z.array(z.number().int().positive()).max(12).default([]),
    customItems: z.array(z.object({ name: z.string().trim().min(1).max(200), unitPrice: z.number().int(), qty: z.number().min(0.01).max(1000).default(1), kind: z.enum(['labour', 'part', 'custom']).default('custom') })).max(20).default([]),
    date: z.string().refine(isIsoDate),
    slot: z.enum([...SLOT_ORDER, 'asap'] as ['morning', 'afternoon', 'evening', 'asap']).default('morning'),
    emergency: z.boolean().default(false),
    serviceMode: z.enum(['mobile', 'drop_off']).default('mobile'),
    address: z.string().max(240).default(''),
    postcode: z.string().max(10).default(''),
    notes: z.string().max(2000).default(''),
    promoCode: z.string().max(40).default(''),
    assignedUserId: z.number().int().positive().nullable().default(null),
    status: z.enum(['confirmed', 'completed']).default('confirmed'),
    payment: z.object({ method: z.enum(['card', 'cash', 'bank_transfer', 'sumup', 'other']), amount: z.number().int().positive() }).nullable().default(null),
    notify: z.boolean().default(true),
  }));
  if (input.customItems.length && !can(c.get('staff')?.role, 'finance.write')) fail(403, 'Custom-priced lines need finance access.');
  const settings = await getSettings(c.env.DB);
  const booking = await createBooking(c.env, settings, {
    vehicles: [{ ...input.vehicle, packageIds: input.packageIds }], date: input.date, slot: input.slot, emergency: input.emergency, serviceMode: input.serviceMode,
    address: input.address, postcode: input.postcode, customer: input.customer, notes: input.notes, symptoms: [], photoIds: [], promoCode: input.promoCode,
    loyaltyPoints: 0, paymentMethod: 'on_completion', fleetSlug: '', source: input.source,
    ...(input.source === 'walk_in' ? { serviceMode: 'drop_off' as const } : {}), customItems: input.customItems, overrideAvailability: true,
    assignedUserId: input.assignedUserId, silent: !input.notify, internalNotes: `Logged by ${c.get('staff')!.name} (${input.source.replace('_', '-')})`,
  }, originOf(c), c.executionCtx);
  if (input.status === 'completed') await setStatus(c.env, settings, booking.id, 'completed', c.get('staff')!.name, originOf(c), { notify: input.notify });
  if (input.payment) await recordPayment(c.env.DB, booking.id, { kind: 'balance', method: input.payment.method, provider: 'manual', amount: input.payment.amount, actor: c.get('staff')!.name });
  await audit(c, 'create', 'booking', booking.id, `Quick-booked ${booking.ref} (${input.source}) for ${input.customer.name}`, { total: booking.total });
  return c.json({ ok: true, id: booking.id, ref: booking.ref, total: booking.total, invoiceUrl: `/docs/invoice/${booking.id}.pdf`, trackUrl: `/track/${booking.token}` }, 201);
});

adminRoutes.post('/vehicle-lookup', async (c) => {
  staffOrFail(c, 'bookings.read');
  const { reg } = await readJson(c, z.object({ reg: z.string().min(2).max(12) }));
  const result = await lookupReg(c.env, reg);
  const record = await first<{ id: number; customer_id: number | null }>(c.env.DB, 'SELECT id, customer_id FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', normReg(reg));
  const owner = record?.customer_id ? await first(c.env.DB, 'SELECT id, name, phone, email, address, postcode FROM customers WHERE id = ?', record.customer_id) : null;
  return c.json({ ...result, vehicleId: record?.id ?? null, owner });
});

// ───────────────────────────── CRM ─────────────────────────────
adminRoutes.get('/customers/:id', async (c) => {
  staffOrFail(c, 'crm.read');
  const id = intParam(c, 'id');
  const db = c.env.DB;
  const customer = await first(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!customer) fail(404, 'Customer not found.');
  const finance = fin(c);
  const [vehicles, bookings, ledger, subs, referred, threads] = await Promise.all([
    all(db, 'SELECT id, reg, make, model, year, mot_due, notes FROM vehicles WHERE customer_id = ? ORDER BY id DESC', id),
    all(db, `SELECT b.id, b.ref, b.date, b.status, ${finance ? 'b.total, b.paid_amount,' : ''} (SELECT GROUP_CONCAT(name, ' · ') FROM booking_items WHERE booking_id = b.id) AS services FROM bookings b WHERE b.customer_id = ? ORDER BY b.date DESC`, id),
    all(db, 'SELECT points, reason, created_at FROM loyalty_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 50', id),
    all(db, 'SELECT s.id, s.status, s.next_visit_on, p.name AS plan FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.customer_id = ?', id),
    all(db, 'SELECT id, name, created_at FROM customers WHERE referred_by = ?', id),
    all(db, "SELECT id, updated_at, sentiment FROM chat_threads WHERE contact LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", likeTerm(String((customer as { phone?: string }).phone || '#none#'))),
  ]);
  const completed = (bookings as { status: string; total?: number }[]).filter((b) => b.status === 'completed');
  return c.json({
    customer, vehicles, bookings, ledger, subscriptions: subs, referred, threads,
    ltv: finance ? { spend: completed.reduce((s, b) => s + (b.total ?? 0), 0), jobs: completed.length, firstJob: completed.at(-1) ?? null } : null,
  });
});

/** Full permanent history for a registration plate — follows the vehicle across owners. */
adminRoutes.get('/vehicles/history/:reg', async (c) => {
  staffOrFail(c, 'crm.read');
  const reg = normReg(c.req.param('reg'));
  const db = c.env.DB;
  const vehicle = await first<{ id: number }>(db, 'SELECT * FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', reg);
  const [jobs, dpf, battery, flash, freeze, checklists] = await Promise.all([
    vehicle ? all(db, `SELECT b.id, b.ref, b.date, b.status, b.findings, c.name AS customer_name, (SELECT GROUP_CONCAT(name, ' · ') FROM booking_items bi WHERE bi.booking_id = b.id) AS services
      FROM booking_vehicles bv JOIN bookings b ON b.id = bv.booking_id JOIN customers c ON c.id = b.customer_id WHERE bv.vehicle_id = ? ORDER BY b.date DESC`, vehicle.id) : [],
    all(db, 'SELECT * FROM dpf_logs WHERE reg = ? ORDER BY logged_on DESC', reg),
    all(db, 'SELECT * FROM battery_tests WHERE reg = ? ORDER BY tested_on DESC', reg),
    all(db, 'SELECT * FROM flash_log WHERE reg = ? ORDER BY flashed_on DESC', reg),
    all(db, 'SELECT * FROM freeze_frames WHERE reg = ? ORDER BY captured_on DESC', reg),
    all(db, 'SELECT r.id, r.kind, r.score, r.max_score, r.completed_at, t.name FROM checklist_runs r JOIN checklist_templates t ON t.id = r.template_id WHERE r.reg = ? ORDER BY r.id DESC', reg),
  ]);
  return c.json({ reg, vehicle, jobs, dpf, battery, flash, freeze: freeze.map((f) => ({ ...f, data: parseJson((f as { data: string }).data, []) })), checklists });
});

adminRoutes.patch('/vehicles/:id/notes', async (c) => {
  staffOrFail(c, 'crm.write');
  const id = intParam(c, 'id');
  const { notes } = await readJson(c, z.object({ notes: z.string().max(4000) }));
  await run(c.env.DB, 'UPDATE vehicles SET notes = ? WHERE id = ?', notes, id);
  await audit(c, 'update', 'vehicles', id, 'Updated permanent vehicle notes');
  return c.json({ ok: true });
});

adminRoutes.post('/customers/:id/loyalty', async (c) => {
  staffOrFail(c, 'finance.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ points: z.number().int().min(-100000).max(100000), reason: z.string().trim().min(2).max(120) }));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE customers SET loyalty_points = MAX(0, loyalty_points + ?) WHERE id = ?').bind(input.points, id),
    c.env.DB.prepare('INSERT INTO loyalty_ledger (customer_id, points, reason) VALUES (?, ?, ?)').bind(id, input.points, input.reason),
  ]);
  await audit(c, 'loyalty', 'customers', id, `${input.points > 0 ? '+' : ''}${input.points} points: ${input.reason}`);
  return c.json({ ok: true });
});

adminRoutes.post('/customers/merge', async (c) => {
  staffOrFail(c, 'crm.write');
  const { keepId, mergeId } = await readJson(c, z.object({ keepId: z.number().int().positive(), mergeId: z.number().int().positive() }));
  if (keepId === mergeId) fail(422, 'Choose two different customers.');
  const db = c.env.DB;
  const [keep, merge] = await Promise.all([first(db, 'SELECT * FROM customers WHERE id = ?', keepId), first<{ loyalty_points: number; name: string }>(db, 'SELECT * FROM customers WHERE id = ?', mergeId)]);
  if (!keep || !merge) fail(404, 'Customer not found.');
  await db.batch([
    db.prepare('UPDATE bookings SET customer_id = ? WHERE customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE vehicles SET customer_id = ? WHERE customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE subscriptions SET customer_id = ? WHERE customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE loyalty_ledger SET customer_id = ? WHERE customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE scheduled_messages SET customer_id = ? WHERE customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE customers SET referred_by = ? WHERE referred_by = ?').bind(keepId, mergeId),
    db.prepare('UPDATE promo_codes SET owner_customer_id = ? WHERE owner_customer_id = ?').bind(keepId, mergeId),
    db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?').bind(merge!.loyalty_points, keepId),
    db.prepare("DELETE FROM sessions WHERE kind = 'customer' AND subject_id = ?").bind(mergeId),
    db.prepare('DELETE FROM customers WHERE id = ?').bind(mergeId),
  ]);
  await audit(c, 'merge', 'customers', keepId, `Merged customer #${mergeId} (${merge!.name}) into #${keepId}`);
  return c.json({ ok: true });
});

// ───────────────────────────── Checklists (VHC, PPI, packing, walkaround) ─────────────────────────────
adminRoutes.get('/checklists/templates', async (c) => {
  staffOrFail(c, 'tech.read');
  const rows = await all<{ id: number; kind: string; name: string; sections: string }>(c.env.DB, 'SELECT id, kind, name, sections FROM checklist_templates WHERE active = 1 ORDER BY kind, name');
  return c.json({ templates: rows.map((r) => ({ ...r, sections: parseJson(r.sections, []) })) });
});

adminRoutes.post('/checklists/runs', async (c) => {
  staffOrFail(c, 'tech.write');
  const input = await readJson(c, z.object({ templateId: z.number().int().positive(), bookingId: z.number().int().positive().nullable().default(null), reg: z.string().max(12).default('') }));
  const t = await first<{ kind: string }>(c.env.DB, 'SELECT kind FROM checklist_templates WHERE id = ?', input.templateId);
  if (!t) fail(404, 'Checklist template not found.');
  let reg = normReg(input.reg);
  if (!reg && input.bookingId) reg = (await bookingVehicles(c.env.DB, input.bookingId))[0]?.reg ?? '';
  const { id } = await run(c.env.DB, 'INSERT INTO checklist_runs (template_id, kind, booking_id, reg) VALUES (?, ?, ?, ?)', input.templateId, t!.kind, input.bookingId, reg);
  return c.json({ ok: true, id });
});

adminRoutes.get('/checklists/runs/:id', async (c) => {
  staffOrFail(c, 'tech.read');
  const id = intParam(c, 'id');
  const run_ = await first<{ template_id: number; results: string }>(c.env.DB, 'SELECT * FROM checklist_runs WHERE id = ?', id);
  if (!run_) fail(404, 'Checklist not found.');
  const t = await first<{ name: string; sections: string; kind: string }>(c.env.DB, 'SELECT name, kind, sections FROM checklist_templates WHERE id = ?', run_!.template_id);
  const photos = await all<{ id: number; storage_key: string; label: string }>(c.env.DB, "SELECT id, storage_key, label FROM media WHERE label LIKE ? ESCAPE '\\'", `checklist:${id}:%`);
  return c.json({ run: { ...run_, results: parseJson(run_!.results, {}) }, template: { ...t, sections: parseJson(t?.sections, []) }, photos: photos.map((p) => ({ ...p, url: mediaUrl(p.storage_key) })) });
});

adminRoutes.put('/checklists/runs/:id', async (c) => {
  staffOrFail(c, 'tech.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({
    results: z.record(z.string(), z.object({ status: z.enum(['pass', 'advisory', 'fail', 'na', '']).default(''), note: z.string().max(500).default('') })),
    summary: z.string().max(2000).default(''),
    complete: z.boolean().default(false),
  }));
  const entries = Object.values(input.results).filter((r) => r.status && r.status !== 'na');
  const score = entries.reduce((s, r) => s + (r.status === 'pass' ? 1 : r.status === 'advisory' ? 0.5 : 0), 0);
  await run(c.env.DB, `UPDATE checklist_runs SET results = ?, summary = ?, score = ?, max_score = ?, status = CASE WHEN ? THEN 'completed' ELSE status END,
    completed_by = CASE WHEN ? THEN ? ELSE completed_by END, completed_at = CASE WHEN ? THEN ? ELSE completed_at END WHERE id = ?`,
    JSON.stringify(input.results), input.summary, Math.round(score), entries.length, input.complete ? 1 : 0, input.complete ? 1 : 0, c.get('staff')!.name, input.complete ? 1 : 0, nowIso(), id);
  if (input.complete) {
    const r = await first<{ booking_id: number | null; kind: string }>(c.env.DB, 'SELECT booking_id, kind FROM checklist_runs WHERE id = ?', id);
    if (r?.booking_id) await addEvent(c.env.DB, r.booking_id, 'checklist', `${r.kind === 'ppi' ? 'Pre-purchase inspection' : r.kind === 'vhc' ? 'Vehicle health check' : 'Checklist'} completed — ${Math.round(score)}/${entries.length}`, c.get('staff')!.name, r.kind === 'vhc' || r.kind === 'ppi');
    await audit(c, 'complete', 'checklist_runs', id, `Checklist completed: ${Math.round(score)}/${entries.length}`);
  }
  return c.json({ ok: true, score: Math.round(score), maxScore: entries.length });
});

adminRoutes.post('/checklists/runs/:id/photo', async (c) => {
  staffOrFail(c, 'tech.write');
  const id = intParam(c, 'id');
  const r = await first<{ booking_id: number | null }>(c.env.DB, 'SELECT booking_id FROM checklist_runs WHERE id = ?', id);
  if (!r) fail(404, 'Checklist not found.');
  const { bytes, form } = await readUpload(c, c.env.MEDIA ? LIMITS.imageR2 : LIMITS.imageD1);
  const item = String(form.get('item') ?? '').slice(0, 80);
  const media = await storeMedia(c.env, bytes, { kind: 'job', visibility: 'private', bookingId: r!.booking_id, label: `checklist:${id}:${item}`, uploadedBy: c.get('staff')!.name });
  return c.json({ ok: true, id: media.id, url: mediaUrl(media.storage_key) });
});

// ───────────────────────────── Media library ─────────────────────────────
adminRoutes.post('/media', async (c) => {
  staffOrFail(c);
  const { bytes, form } = await readUpload(c, c.env.MEDIA ? LIMITS.video : LIMITS.imageD1);
  const kind = String(form.get('kind') ?? 'gallery');
  if (!['gallery', 'logo', 'icon', 'wiring', 'portal', 'job'].includes(kind)) fail(422, 'Unknown upload type.');
  const visibility = kind === 'wiring' || kind === 'job' ? 'private' : 'public';
  const width = Number(form.get('width')) || null;
  const height = Number(form.get('height')) || null;
  const media = await storeMedia(c.env, bytes, { kind, visibility, label: String(form.get('label') ?? '').slice(0, 120), uploadedBy: c.get('staff')!.name, width, height, attached: kind === 'logo' || kind === 'icon' });
  return c.json({ ok: true, id: media.id, url: mediaUrl(media.storage_key), kind: media.kind, contentType: media.content_type });
});

adminRoutes.get('/media/:id', async (c) => {
  staffOrFail(c);
  const m = await first<{ storage_key: string; content_type: string; kind: string }>(c.env.DB, 'SELECT storage_key, content_type, kind FROM media WHERE id = ?', intParam(c, 'id'));
  if (!m) fail(404, 'File not found.');
  return c.json({ url: mediaUrl(m!.storage_key), contentType: m!.content_type, kind: m!.kind });
});

adminRoutes.delete('/media/:id', async (c) => {
  staffOrFail(c, 'content.write');
  const id = intParam(c, 'id');
  await deleteMedia(c.env, id);
  await audit(c, 'delete', 'media', id, 'Deleted a file');
  return c.json({ ok: true });
});

// ───────────────────────────── Inbox (live chat & enquiries) ─────────────────────────────
adminRoutes.get('/inbox', async (c) => {
  staffOrFail(c, 'inbox');
  await setFlag(c.env.DB, 'staff_inbox_seen', nowIso());
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const threads = await all(c.env.DB, `SELECT t.*, (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message
    FROM chat_threads t WHERE t.status = ? ORDER BY t.updated_at DESC LIMIT 100`, status);
  return c.json({ threads });
});

adminRoutes.get('/inbox/:id', async (c) => {
  staffOrFail(c, 'inbox');
  const id = intParam(c, 'id');
  await setFlag(c.env.DB, 'staff_inbox_seen', nowIso());
  const thread = await first(c.env.DB, 'SELECT * FROM chat_threads WHERE id = ?', id);
  if (!thread) fail(404, 'Conversation not found.');
  await run(c.env.DB, 'UPDATE chat_threads SET unread = 0 WHERE id = ?', id);
  const messages = await all(c.env.DB, 'SELECT id, sender, author, body, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id', id);
  return c.json({ thread, messages });
});

adminRoutes.post('/inbox/:id/reply', async (c) => {
  staffOrFail(c, 'inbox');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ body: z.string().trim().min(1).max(2000), sms: z.boolean().default(false) }));
  const thread = await first<{ contact: string; visitor_name: string }>(c.env.DB, 'SELECT contact, visitor_name FROM chat_threads WHERE id = ?', id);
  if (!thread) fail(404, 'Conversation not found.');
  await run(c.env.DB, "INSERT INTO chat_messages (thread_id, sender, author, body) VALUES (?, 'staff', ?, ?)", id, c.get('staff')!.name, input.body);
  await run(c.env.DB, 'UPDATE chat_threads SET unread = 0, updated_at = ? WHERE id = ?', nowIso(), id);
  await setFlag(c.env.DB, 'staff_inbox_seen', nowIso());
  let sms = null;
  const phone = thread!.contact.split('·').map((s) => s.trim()).find((s) => /\d{6,}/.test(s));
  if (input.sms && phone) {
    const settings = await getSettings(c.env.DB);
    sms = await sendSms(c.env, phone, `${settings.business.name}: ${input.body}`);
  }
  await audit(c, 'reply', 'chat_threads', id, `Replied to ${thread!.visitor_name}`);
  return c.json({ ok: true, sms });
});

adminRoutes.post('/inbox/:id/status', async (c) => {
  staffOrFail(c, 'inbox');
  const id = intParam(c, 'id');
  const { status } = await readJson(c, z.object({ status: z.enum(['open', 'closed']) }));
  await run(c.env.DB, 'UPDATE chat_threads SET status = ?, unread = 0 WHERE id = ?', status, id);
  return c.json({ ok: true });
});

adminRoutes.post('/inbox/:id/analyse', async (c) => {
  staffOrFail(c, 'inbox');
  return c.json({ ok: true, sentiment: await analyseThread(c.env, intParam(c, 'id')) });
});

adminRoutes.post('/reviews/:id/analyse', async (c) => {
  staffOrFail(c, 'content.write');
  const id = intParam(c, 'id');
  const r = await first<{ body: string; rating: number }>(c.env.DB, 'SELECT body, rating FROM reviews WHERE id = ?', id);
  if (!r) fail(404, 'Review not found.');
  return c.json({ ok: true, sentiment: await analyseReview(c.env, id, r!.body, r!.rating) });
});

/** Overall feedback picture: sentiment mix across reviews and chats, with the items needing attention. */
adminRoutes.get('/feedback', async (c) => {
  staffOrFail(c, 'content.write');
  const db = c.env.DB;
  const [reviewMix, chatMix, attention, rating] = await Promise.all([
    all(db, "SELECT sentiment, COUNT(*) AS n, AVG(rating) AS avg_rating FROM reviews WHERE sentiment <> '' GROUP BY sentiment"),
    all(db, "SELECT CASE WHEN sentiment LIKE 'positive%' THEN 'positive' WHEN sentiment LIKE 'negative%' THEN 'negative' ELSE 'neutral' END AS sentiment, COUNT(*) AS n FROM chat_threads WHERE sentiment <> '' GROUP BY 1"),
    all(db, "SELECT 'review' AS type, id, author AS who, rating, body, sentiment_summary AS summary, reviewed_on AS at FROM reviews WHERE sentiment = 'negative' OR rating <= 3 ORDER BY id DESC LIMIT 10"),
    first(db, 'SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews'),
  ]);
  const negativeChats = await all(db, "SELECT 'chat' AS type, id, visitor_name AS who, sentiment AS summary, updated_at AS at FROM chat_threads WHERE sentiment LIKE 'negative%' ORDER BY id DESC LIMIT 10");
  return c.json({ reviewMix, chatMix, attention: [...attention, ...negativeChats], rating, engine: c.env.ANTHROPIC_API_KEY ? 'claude' : 'lexicon' });
});

// ───────────────────────────── Reports ─────────────────────────────
adminRoutes.get('/reports/ltv', async (c) => {
  staffOrFail(c, 'finance.read');
  return c.json(await lifetimeValue(c.env.DB, intQuery(c, 'limit', 100, 1, 1000)));
});

adminRoutes.get('/reports/tax', async (c) => {
  staffOrFail(c, 'finance.read');
  const settings = await getSettings(c.env.DB);
  const date = c.req.query('date');
  return c.json(await taxLedger(c.env.DB, settings, isIsoDate(date) ? date : todayIn(settings.business.timezone)));
});

adminRoutes.get('/reports/partners', async (c) => {
  staffOrFail(c, 'finance.read');
  const rows = await all(c.env.DB, `SELECT p.id, p.name, p.code, p.kind, p.commission_pct,
      (SELECT COUNT(*) FROM bookings b WHERE b.partner_id = p.id AND b.status <> 'cancelled') AS referrals,
      (SELECT COALESCE(SUM(b.total), 0) FROM bookings b WHERE b.partner_id = p.id AND b.status = 'completed') AS revenue,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE partner_id = p.id AND status = 'due') AS owed,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE partner_id = p.id AND status = 'paid') AS paid
    FROM partners p ORDER BY revenue DESC`);
  return c.json({ partners: rows });
});

adminRoutes.post('/commissions/pay', async (c) => {
  staffOrFail(c, 'finance.write');
  const { partnerId } = await readJson(c, z.object({ partnerId: z.number().int().positive() }));
  const settings = await getSettings(c.env.DB);
  const res = await run(c.env.DB, "UPDATE commissions SET status = 'paid', paid_at = ? WHERE partner_id = ? AND status = 'due'", todayIn(settings.business.timezone), partnerId);
  await audit(c, 'pay', 'commissions', partnerId, `Marked ${res.changes} commission payment(s) as paid`);
  return c.json({ ok: true, paid: res.changes });
});

// ───────────────────────────── Library search ─────────────────────────────
adminRoutes.get('/library/search', async (c) => {
  staffOrFail(c, 'tech.read');
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return c.json({ dtc: [], coding: [], torque: [], wiring: [], guides: [] });
  const t = likeTerm(q);
  const db = c.env.DB;
  const [dtc, coding, torque, wiring, guides] = await Promise.all([
    all(db, "SELECT code, title, system, severity, causes, fixes FROM dtc_codes WHERE code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR system LIKE ? ESCAPE '\\' ORDER BY code LIMIT 15", t, t, t),
    all(db, "SELECT id, make_group, platform, feature, module, parameter, tool, notes FROM coding_matrix WHERE make_group LIKE ? ESCAPE '\\' OR platform LIKE ? ESCAPE '\\' OR feature LIKE ? ESCAPE '\\' OR module LIKE ? ESCAPE '\\' LIMIT 15", t, t, t, t),
    all(db, "SELECT * FROM torque_specs WHERE make_model LIKE ? ESCAPE '\\' LIMIT 10", t),
    all(db, "SELECT id, make_model, title, detail, url FROM wiring_refs WHERE make_model LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' LIMIT 10", t, t, t),
    all(db, "SELECT id, title, category, applies_to FROM tech_guides WHERE title LIKE ? ESCAPE '\\' OR applies_to LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' LIMIT 10", t, t, t),
  ]);
  return c.json({ dtc, coding, torque, wiring, guides });
});

// ───────────────────────────── Settings ─────────────────────────────
/** Shape-check a settings document against its defaults: unknown keys are dropped, types must match. */
function sanitize(template: unknown, value: unknown, path: string): unknown {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) fail(422, `Settings: "${path}" must be a list.`);
    const sample = template[0];
    return (value as unknown[]).slice(0, 50).map((v, i) => (sample === undefined ? v : sanitize(sample, v, `${path}[${i}]`)));
  }
  if (template !== null && typeof template === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(422, `Settings: "${path}" has the wrong shape.`);
    const out: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(template as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[k];
      out[k] = v === undefined ? t : sanitize(t, v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  if (template === null) return value === null || typeof value === 'number' ? value : null;
  if (typeof template === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) fail(422, `Settings: "${path}" must be a number.`);
    return n;
  }
  if (typeof template === 'boolean') return value === true || value === 'true' || value === 1;
  return String(value ?? '').slice(0, 2000);
}

adminRoutes.get('/settings', async (c) => {
  staffOrFail(c);
  const settings = await getSettings(c.env.DB, true);
  const visible: Partial<Settings> = can(c.get('staff')?.role, 'settings.write') ? settings : { business: settings.business, branding: settings.branding, security: settings.security, booking: settings.booking };
  const calendarToken = await first<{ value: string }>(c.env.DB, "SELECT value FROM settings WHERE key = 'flag:calendar_token'");
  const logo = settings.branding.logoMediaId ? await first<{ storage_key: string }>(c.env.DB, 'SELECT storage_key FROM media WHERE id = ?', settings.branding.logoMediaId) : null;
  return c.json({
    settings: visible,
    integrations: integrationStatus(c.env),
    calendarFeed: calendarToken && can(c.get('staff')?.role, 'bookings.read') ? `${originOf(c)}/calendar/${calendarToken.value}.ics` : '',
    logoUrl: logo ? mediaUrl(logo.storage_key) : '',
    googleRating: parseJson((await first<{ value: string }>(c.env.DB, "SELECT value FROM settings WHERE key = 'flag:google_rating'"))?.value, null),
    sourceRepo: c.env.SOURCE_REPO_URL ?? '',
    environment: c.env.APP_ENV ?? 'production',
  });
});

adminRoutes.put('/settings/:key', async (c) => {
  staffOrFail(c, 'settings.write');
  const key = c.req.param('key') as SettingsKey;
  if (!SETTINGS_KEYS.includes(key)) fail(404, 'Unknown settings section.');
  if ((key === 'pricing' || key === 'tax') && !can(c.get('staff')?.role, 'finance.write')) fail(403, 'Pricing settings need finance access.');
  const body = await c.req.json().catch(() => null);
  const before = (await getSettings(c.env.DB, true))[key];
  const clean = sanitize(DEFAULT_SETTINGS[key], body, key) as Settings[typeof key];
  if (key === 'business') {
    const b = clean as Settings['business'];
    if (b.slotsByWeekday.length !== 7) fail(422, 'Opening windows need an entry for each day of the week.');
    b.slotsByWeekday = b.slotsByWeekday.map((d) => (Array.isArray(d) ? d.filter((s) => (SLOT_ORDER as string[]).includes(s)) : []));
  }
  await saveSetting(c.env.DB, key, clean);
  await audit(c, 'update', 'settings', key, `Updated ${key} settings`, diff(flatten(before), flatten(clean)));
  return c.json({ ok: true, settings: clean });
});

function flatten(o: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out[prefix] = Array.isArray(o) ? JSON.stringify(o) : o;
  return out;
}

adminRoutes.post('/calendar-feed', async (c) => {
  staffOrFail(c, 'settings.write');
  const token = randomToken(24);
  await setFlag(c.env.DB, 'calendar_token', token);
  await audit(c, 'rotate', 'settings', 'calendar_feed', 'Generated a new calendar feed link');
  return c.json({ ok: true, url: `${originOf(c)}/calendar/${token}.ics` });
});

adminRoutes.get('/integrations', async (c) => {
  staffOrFail(c, 'settings.write');
  return c.json({ integrations: integrationStatus(c.env) });
});

adminRoutes.post('/webhooks/:id/test', async (c) => {
  staffOrFail(c, 'settings.write');
  const id = intParam(c, 'id');
  const hook = await first<{ url: string; secret: string }>(c.env.DB, 'SELECT url, secret FROM webhooks WHERE id = ?', id);
  if (!hook) fail(404, 'Webhook not found.');
  const payload = JSON.stringify({ event: 'test.ping', created_at: nowIso(), data: { message: 'Test delivery from SpecOne Auto Labs' } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(hook!.secret, `${ts}.${payload}`);
  try {
    const res = await fetch(hook!.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SpecOne-Event': 'test.ping', 'X-SpecOne-Signature': `t=${ts},v1=${sig}` }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return c.json({ ok: res.ok, status: res.status });
  } catch (e) {
    return c.json({ ok: false, status: 0, error: String(e).slice(0, 200) });
  }
});

adminRoutes.get('/webhooks/deliveries', async (c) => {
  staffOrFail(c, 'settings.write');
  return c.json({ deliveries: await all(c.env.DB, 'SELECT d.id, d.event, d.status, d.attempts, d.response_code, d.last_error, d.created_at, w.name FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id ORDER BY d.id DESC LIMIT 100') });
});

// ───────────────────────────── Team ─────────────────────────────
adminRoutes.get('/users', async (c) => {
  staffOrFail(c);
  const users = await all(c.env.DB, `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.last_login_at, u.created_at, u.location_id, ${fin(c) ? 'u.hourly_cost,' : ''}
    (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
    (SELECT COUNT(*) FROM bookings b WHERE b.assigned_user_id = u.id AND b.status IN ('confirmed','en_route','arrived','in_progress')) AS open_jobs
    FROM users u ORDER BY u.active DESC, u.name`);
  return c.json({ users, roles: ROLES, permissions: ROLE_PERMISSIONS });
});

adminRoutes.post('/users', async (c) => {
  staffOrFail(c, 'users.write');
  const input = await readJson(c, z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), phone: z.string().max(24).default(''), role: z.enum(ROLES), password: z.string().min(1).max(200), hourlyCost: z.number().int().min(0).default(0) }));
  const problem = passwordProblem(input.password);
  if (problem) fail(422, problem, { password: problem });
  const { id } = await run(c.env.DB, 'INSERT INTO users (name, email, phone, role, password_hash, hourly_cost) VALUES (?, ?, ?, ?, ?, ?)', input.name, input.email, input.phone ? normPhone(input.phone) : '', input.role, await hashPassword(input.password), input.hourlyCost);
  await audit(c, 'create', 'users', id, `Added team member ${input.name} as ${input.role}`);
  return c.json({ ok: true, id }, 201);
});

adminRoutes.patch('/users/:id', async (c) => {
  staffOrFail(c, 'users.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().max(24).optional(), role: z.enum(ROLES).optional(), active: z.boolean().optional(), hourlyCost: z.number().int().min(0).optional(), password: z.string().max(200).optional() }));
  const before = await first<{ role: string; active: number; name: string }>(c.env.DB, 'SELECT role, active, name FROM users WHERE id = ?', id);
  if (!before) fail(404, 'Team member not found.');
  const demoting = (input.role && input.role !== 'owner') || input.active === false;
  if (before!.role === 'owner' && demoting) {
    const owners = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id <> ?", id);
    if (!owners?.n) fail(409, 'There must always be at least one active owner.');
  }
  if (input.password) {
    const problem = passwordProblem(input.password);
    if (problem) fail(422, problem, { password: problem });
  }
  await run(c.env.DB, `UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), role = COALESCE(?, role), active = COALESCE(?, active), hourly_cost = COALESCE(?, hourly_cost),
    password_hash = COALESCE(?, password_hash) WHERE id = ?`,
    input.name ?? null, input.phone != null ? normPhone(input.phone) : null, input.role ?? null, input.active == null ? null : input.active ? 1 : 0, input.hourlyCost ?? null, input.password ? await hashPassword(input.password) : null, id);
  if (input.active === false || input.password || (input.role && input.role !== before!.role)) await revokeSessions(c.env.DB, 'staff', id);
  await audit(c, 'update', 'users', id, `Updated ${before!.name}: ${Object.keys(input).filter((k) => k !== 'password').join(', ')}${input.password ? ' (password reset)' : ''}`, diff(before, { role: input.role, active: input.active }));
  return c.json({ ok: true });
});

// ───────────────────────────── Audit trail ─────────────────────────────
adminRoutes.get('/audit', async (c) => {
  staffOrFail(c, 'audit.read');
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const entity = c.req.query('entity');
  const action = c.req.query('action');
  const actor = c.req.query('actor');
  const q = c.req.query('q');
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (entity) { where.push('entity = ?'); binds.push(entity); }
  if (action) { where.push('action = ?'); binds.push(action); }
  if (actor) { where.push("actor_name LIKE ? ESCAPE '\\'"); binds.push(likeTerm(actor)); }
  if (q) { where.push("(summary LIKE ? ESCAPE '\\' OR entity_id = ?)"); binds.push(likeTerm(q), q); }
  if (isIsoDate(from)) { where.push('created_at >= ?'); binds.push(`${from}T00:00:00Z`); }
  if (isIsoDate(to)) { where.push('created_at <= ?'); binds.push(`${to}T23:59:59Z`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page = intQuery(c, 'page', 1, 1, 100000);
  const rows = await all(c.env.DB, `SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT 100 OFFSET ?`, ...binds, (page - 1) * 100);
  const facets = await Promise.all([all(c.env.DB, 'SELECT DISTINCT entity FROM audit_log ORDER BY entity'), all(c.env.DB, 'SELECT DISTINCT action FROM audit_log ORDER BY action')]);
  return c.json({ rows: rows.map((r) => ({ ...r, changes: parseJson((r as { changes: string }).changes, {}) })), page, entities: facets[0].map((f) => (f as { entity: string }).entity), actions: facets[1].map((f) => (f as { action: string }).action) });
});

adminRoutes.get('/notifications', async (c) => {
  staffOrFail(c, 'bookings.read');
  const bookingId = c.req.query('booking');
  const rows = bookingId
    ? await all(c.env.DB, 'SELECT * FROM notifications WHERE booking_id = ? ORDER BY id DESC LIMIT 100', Number(bookingId))
    : await all(c.env.DB, 'SELECT * FROM notifications ORDER BY id DESC LIMIT 200');
  return c.json({ rows });
});

adminRoutes.get('/errors', async (c) => {
  staffOrFail(c, 'settings.write');
  return c.json({ rows: await all(c.env.DB, 'SELECT * FROM error_logs ORDER BY id DESC LIMIT 200') });
});

// ───────────────────────────── Exports & backups ─────────────────────────────
adminRoutes.get('/export/:what', async (c) => {
  const what = c.req.param('what');
  const settings = await getSettings(c.env.DB);
  const stamp = todayIn(settings.business.timezone);
  const db = c.env.DB;
  if (what === 'bookings.csv') {
    staffOrFail(c, 'finance.read');
    const rows = await all(db, `SELECT b.ref, b.date, b.slot, b.status, b.source, c.name AS customer, c.phone, c.email, b.address, b.postcode,
      (SELECT GROUP_CONCAT(v.reg, ' ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS vehicles,
      (SELECT GROUP_CONCAT(name, '; ') FROM booking_items WHERE booking_id = b.id) AS services,
      printf('%.2f', b.subtotal / 100.0) AS subtotal, printf('%.2f', b.discount / 100.0) AS discount, printf('%.2f', b.travel_fee / 100.0) AS travel_fee,
      printf('%.2f', b.total / 100.0) AS total, printf('%.2f', b.paid_amount / 100.0) AS paid, b.payment_status, b.promo_code,
      printf('%.2f', COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.booking_id = b.id), 0) / 100.0) AS job_costs
      FROM bookings b JOIN customers c ON c.id = b.customer_id ORDER BY b.date DESC`);
    await audit(c, 'export', 'bookings', 'csv', `Exported ${rows.length} bookings`);
    return download(toCsv(rows), `specone-bookings-${stamp}.csv`, 'text/csv; charset=utf-8');
  }
  if (what === 'expenses.csv') {
    staffOrFail(c, 'finance.read');
    const rows = await all(db, "SELECT spent_on, category, description, supplier, qty, printf('%.2f', amount / 100.0) AS amount, printf('%.2f', vat_amount / 100.0) AS vat, booking_id FROM expenses ORDER BY spent_on DESC");
    await audit(c, 'export', 'expenses', 'csv', `Exported ${rows.length} expenses`);
    return download(toCsv(rows), `specone-expenses-${stamp}.csv`, 'text/csv; charset=utf-8');
  }
  if (what === 'customers.csv') {
    staffOrFail(c, 'crm.read');
    const rows = await all(db, 'SELECT id, name, email, phone, company, address, postcode, loyalty_points, marketing_opt_in, created_at FROM customers ORDER BY id');
    await audit(c, 'export', 'customers', 'csv', `Exported ${rows.length} customers`);
    return download(toCsv(rows), `specone-customers-${stamp}.csv`, 'text/csv; charset=utf-8');
  }
  if (what === 'database.json') {
    staffOrFail(c, 'settings.write');
    const { data, rows } = await exportDatabase(db);
    await audit(c, 'export', 'system', 'database', `Downloaded a full data export (${rows} rows)`);
    return download(JSON.stringify(data, null, 1), `specone-data-${stamp}.json`, 'application/json');
  }
  return fail(404, 'Unknown export.');
});

adminRoutes.get('/backups', async (c) => {
  staffOrFail(c, 'settings.write');
  return c.json({ backups: await all(c.env.DB, 'SELECT * FROM backups ORDER BY id DESC LIMIT 60'), r2: !!c.env.MEDIA, encrypted: !!c.env.BACKUP_ENCRYPTION_KEY });
});

adminRoutes.post('/backups', async (c) => {
  staffOrFail(c, 'settings.write');
  await rateLimit(c, 'backup-now', 6, 3600);
  const result = await runBackup(c.env, 'manual');
  await audit(c, 'backup', 'system', 'database', result.message);
  return c.json(result, result.ok ? 200 : 503);
});

adminRoutes.get('/backups/:id/download', async (c) => {
  staffOrFail(c, 'settings.write');
  const id = intParam(c, 'id');
  const file = await readBackup(c.env, id);
  if (!file) fail(404, 'Backup not available (missing, or the encryption key has changed).');
  await audit(c, 'download', 'backups', id, `Downloaded backup ${file!.filename}`);
  return download(file!.bytes as Uint8Array<ArrayBuffer>, file!.filename, 'application/gzip');
});

// ───────────────────────────── Offline job sheets ─────────────────────────────
/** Everything needed to work today's and tomorrow's jobs with no signal. Cached on the device. */
adminRoutes.get('/offline-bundle', async (c) => {
  staffOrFail(c, 'bookings.read');
  const settings = await getSettings(c.env.DB);
  const today = todayIn(settings.business.timezone);
  const db = c.env.DB;
  const jobs = await all<{ id: number }>(db, "SELECT id FROM bookings WHERE date BETWEEN ? AND ? AND status NOT IN ('cancelled','no_show') ORDER BY date, slot", today, addDays(today, 2));
  const sheets = await Promise.all(jobs.map(async (j) => {
    const b = await getBooking(db, j.id);
    const [customer, vehicles, items] = await Promise.all([first(db, 'SELECT name, phone, email, address, postcode, notes FROM customers WHERE id = ?', b!.customer_id), bookingVehicles(db, j.id), bookingItems(db, j.id)]);
    return { id: b!.id, ref: b!.ref, date: b!.date, slot: b!.slot, status: b!.status, address: b!.address, postcode: b!.postcode, customer_notes: b!.customer_notes, internal_notes: b!.internal_notes, findings: b!.findings, emergency: b!.emergency, customer, vehicles, items: items.map((i) => ({ name: i.name, qty: i.qty })) };
  }));
  const [torque, packing] = await Promise.all([all(db, 'SELECT make_model, wheel_nm, caliper_nm, sump_nm FROM torque_specs ORDER BY make_model'), first<{ sections: string }>(db, "SELECT sections FROM checklist_templates WHERE kind = 'packing' AND active = 1 LIMIT 1")]);
  return c.json({ generatedAt: nowIso(), sheets, torque, packing: parseJson(packing?.sections, []) });
});

// ───────────────────────────── Customer/vehicle quick search (command palette) ─────────────────────────────
adminRoutes.get('/search', async (c) => {
  staffOrFail(c, 'bookings.read');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ results: [] });
  const t = likeTerm(q);
  const db = c.env.DB;
  const [bookings, customers, vehicles] = await Promise.all([
    all(db, "SELECT b.id, b.ref, b.date, b.status, c.name FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.ref LIKE ? ESCAPE '\\' ORDER BY b.id DESC LIMIT 5", t),
    can(c.get('staff')?.role, 'crm.read') ? all(db, "SELECT id, name, phone, email FROM customers WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 6", t, likeTerm(normPhone(q) || q), t) : [],
    all(db, "SELECT id, reg, make, model, customer_id FROM vehicles WHERE reg LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 6", likeTerm(normReg(q) || q)),
  ]);
  return c.json({ bookings, customers, vehicles });
});

// Re-export helpers some routes reuse.
export { upsertCustomer, upsertVehicle };
