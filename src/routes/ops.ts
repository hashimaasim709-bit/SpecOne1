// Admin "one-tap" operations: the control deck on the dashboard, trade-account approvals,
// monthly trade statements and estimates sent to customers for approval.
import { Hono } from 'hono';
import { z } from 'zod';
import { slotLabel, STATUS_META } from '../../shared/constants';
import { addDays, formatDate, formatReg, money, todayIn } from '../../shared/format';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { audit, hasPermission, staffOrFail } from '../lib/auth';
import { all, first, nowIso, parseJson, run } from '../lib/db';
import { download, intParam, noStore, readJson } from '../lib/http';
import { fail } from '../lib/security';
import { getSettings, invalidateSettings, saveSetting } from '../lib/settings';
import { runBackup } from '../services/backup';
import { addEvent, getBooking, recalcTotals, setStatus } from '../services/bookings';
import { integrationStatus, messageCustomer, pushOwner } from '../services/notify';
import { statementPdf } from '../services/pdf';
import { processScheduledMessages } from '../services/scheduler';
import { brand } from './documents';

export const opsRoutes = new Hono<AppEnv>();

const nextSunday = (today: string): string => {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, dow === 0 ? 7 : 7 - dow);
};

// ───────────────────────────── Control deck ─────────────────────────────
const ACTIONS = [
  'test-alert', 'block-today', 'block-tomorrow', 'block-sunday', 'unblock-upcoming', 'confirm-pending', 'send-reminders',
  'flash-promo-on', 'flash-promo-off', 'bundles-standard', 'bundles-boost', 'backup-now', 'archive-chats', 'pause-booking', 'resume-booking',
] as const;
type Action = (typeof ACTIONS)[number];

const PERMS: Record<Action, Parameters<typeof hasPermission>[1] | null> = {
  'test-alert': null, 'block-today': 'bookings.write', 'block-tomorrow': 'bookings.write', 'block-sunday': 'bookings.write', 'unblock-upcoming': 'bookings.write',
  'confirm-pending': 'bookings.write', 'send-reminders': 'bookings.write', 'flash-promo-on': 'content.write', 'flash-promo-off': 'content.write',
  'bundles-standard': 'finance.write', 'bundles-boost': 'finance.write', 'backup-now': 'settings.write', 'archive-chats': 'inbox',
  'pause-booking': 'settings.write', 'resume-booking': 'settings.write',
};

const FLASH_CODE = 'FLASH10';

opsRoutes.post('/quick/:action', async (c) => {
  const staff = staffOrFail(c);
  const action = c.req.param('action') as Action;
  if (!ACTIONS.includes(action)) fail(404, 'Unknown action.');
  const perm = PERMS[action];
  if (perm && !hasPermission(c, perm)) fail(403, 'Your role cannot do that.');
  const db = c.env.DB;
  const settings = await getSettings(db, true);
  const today = todayIn(settings.business.timezone);
  const origin = originOf(c);
  let message = '';

  const block = async (date: string, reason: string) => {
    await run(db, 'INSERT INTO blocked_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason', date, reason);
    const booked = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status NOT IN ('cancelled','no_show')", date);
    return `${formatDate(date, 'day')} is now closed to new bookings.${booked?.n ? ` ${booked.n} existing booking${booked.n === 1 ? ' is' : 's are'} unaffected — contact ${booked.n === 1 ? 'that customer' : 'those customers'} if you need to move them.` : ''}`;
  };

  switch (action) {
    case 'test-alert': {
      const on = integrationStatus(c.env).push?.on ?? false;
      await pushOwner(c.env, 'Test alert ✅', `Sent by ${staff.name} from the control deck. Booking, chat and payment alerts will arrive like this.`, `${origin}/admin`, 4, ['white_check_mark']);
      message = on ? 'Test alert sent — check your phone.' : 'No phone alert channel is set up yet. Add the NTFY_TOPIC secret (free ntfy app) in Cloudflare to get instant alerts.';
      break;
    }
    case 'block-today': message = await block(today, 'Closed (control deck)'); break;
    case 'block-tomorrow': message = await block(addDays(today, 1), 'Closed (control deck)'); break;
    case 'block-sunday': message = await block(nextSunday(today), 'Sunday off (control deck)'); break;
    case 'unblock-upcoming': {
      const r = await run(db, 'DELETE FROM blocked_dates WHERE date >= ?', today);
      message = r.changes ? `${r.changes} upcoming day${r.changes === 1 ? '' : 's'} reopened for booking.` : 'No upcoming days were blocked.';
      break;
    }
    case 'confirm-pending': {
      const pending = await all<{ id: number }>(db, "SELECT id FROM bookings WHERE status = 'pending' AND date >= ? ORDER BY date LIMIT 50", today);
      for (const b of pending) await setStatus(c.env, settings, b.id, 'confirmed', staff.name, origin);
      message = pending.length ? `${pending.length} booking${pending.length === 1 ? '' : 's'} confirmed and customers notified.` : 'Nothing waiting for confirmation.';
      break;
    }
    case 'send-reminders': {
      const tomorrow = addDays(today, 1);
      const jobs = await all<{ id: number; customer_id: number }>(db, "SELECT id, customer_id FROM bookings WHERE date = ? AND status IN ('pending','confirmed')", tomorrow);
      const now = nowIso();
      for (const j of jobs) {
        const r = await run(db, "UPDATE scheduled_messages SET send_at = ? WHERE kind = 'booking_reminder' AND status = 'pending' AND booking_id = ?", now, j.id);
        if (!r.changes) {
          const done = await first(db, "SELECT 1 FROM scheduled_messages WHERE kind = 'booking_reminder' AND status = 'sent' AND booking_id = ?", j.id);
          if (!done) await run(db, "INSERT INTO scheduled_messages (kind, booking_id, customer_id, send_at) VALUES ('booking_reminder', ?, ?, ?)", j.id, j.customer_id, now);
        }
      }
      const sent = jobs.length ? await processScheduledMessages(c.env, settings) : 0;
      message = jobs.length ? `Reminders sent for ${jobs.length} booking${jobs.length === 1 ? '' : 's'} tomorrow${sent < jobs.length ? ' (some had already been reminded)' : ''}.` : 'No bookings tomorrow.';
      break;
    }
    case 'flash-promo-on': {
      const ends = addDays(today, 2);
      await run(db, `INSERT INTO promo_codes (code, kind, discount_type, value, description, starts_on, expires_on, active) VALUES (?, 'promo', 'percent', 10, '48-hour flash sale', ?, ?, 1)
        ON CONFLICT(code) DO UPDATE SET value = 10, discount_type = 'percent', starts_on = excluded.starts_on, expires_on = excluded.expires_on, active = 1`, FLASH_CODE, today, ends);
      const existing = await first<{ id: number }>(db, "SELECT id FROM banners WHERE promo_code = ? AND kind = 'promo'", FLASH_CODE);
      if (existing) await run(db, 'UPDATE banners SET active = 1, starts_on = ?, ends_on = ? WHERE id = ?', today, ends, existing.id);
      else await run(db, "INSERT INTO banners (kind, title, message, cta_label, cta_href, promo_code, months, starts_on, ends_on, active, sort) VALUES ('promo', '48-hour flash sale', '10% off every booking', 'Book now', '/book?promo=FLASH10', ?, '[]', ?, ?, 1, -10)", FLASH_CODE, today, ends);
      message = `Flash sale live: code ${FLASH_CODE} gives 10% off until ${formatDate(ends, 'day')}, with a banner across the site.`;
      break;
    }
    case 'flash-promo-off': {
      await run(db, 'UPDATE promo_codes SET active = 0 WHERE code = ?', FLASH_CODE);
      await run(db, "UPDATE banners SET active = 0 WHERE promo_code = ? AND kind = 'promo'", FLASH_CODE);
      message = 'Flash sale ended and banner removed.';
      break;
    }
    case 'bundles-standard': case 'bundles-boost': {
      const bundle = action === 'bundles-boost' ? { two: 2500, threePlus: 5000 } : { two: 1500, threePlus: 3500 };
      await saveSetting(db, 'pricing', { ...settings.pricing, bundle });
      message = `Bundle savings are now ${money(bundle.two)} for two packages and ${money(bundle.threePlus)} for three or more.`;
      break;
    }
    case 'backup-now': {
      const r = await runBackup(c.env, 'manual');
      message = r.ok ? `Backup saved${r.encrypted ? ' (encrypted)' : ''}: ${Math.round(r.size / 1024)} KB.` : r.message;
      break;
    }
    case 'archive-chats': {
      const r = await run(db, "UPDATE chat_threads SET status = 'closed', unread = 0 WHERE status = 'open' AND updated_at < ?", new Date(Date.now() - 30 * 86_400_000).toISOString());
      message = r.changes ? `${r.changes} conversation${r.changes === 1 ? '' : 's'} older than 30 days archived.` : 'No old conversations to archive.';
      break;
    }
    case 'pause-booking': case 'resume-booking': {
      const on = action === 'pause-booking';
      await saveSetting(db, 'site', { ...settings.site, maintenance: { ...settings.site.maintenance, on } });
      message = on ? 'Online booking paused. Customers see your message and are asked to call or WhatsApp.' : 'Online booking is open again.';
      break;
    }
  }
  invalidateSettings();
  await audit(c, 'quick_action', 'system', action, message.slice(0, 300));
  return c.json({ ok: true, message });
});

/** Plain-text run sheet for a day — paste into Samsung Notes, WhatsApp or a message to a partner. */
opsRoutes.get('/run-sheet', async (c) => {
  staffOrFail(c, 'bookings.read');
  noStore(c);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('date') ?? '') ? c.req.query('date')! : todayIn(settings.business.timezone);
  const jobs = await all<{ id: number; ref: string; slot: string; status: string; service_mode: string; address: string; postcode: string; total: number; paid_amount: number; customer_notes: string; name: string; phone: string; vehicles: string | null; items: string | null }>(
    db,
    `SELECT b.id, b.ref, b.slot, b.status, b.service_mode, b.address, b.postcode, b.total, b.paid_amount, b.customer_notes, c.name, c.phone,
       (SELECT group_concat(v.reg || ' ' || trim(v.make || ' ' || v.model), ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS vehicles,
       (SELECT group_concat(i.name, ', ') FROM booking_items i WHERE i.booking_id = b.id) AS items
     FROM bookings b JOIN customers c ON c.id = b.customer_id
     WHERE b.date = ? AND b.status NOT IN ('cancelled','no_show') ORDER BY CASE b.slot WHEN 'asap' THEN 0 WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, b.id`,
    date,
  );
  const lines = [`${settings.business.name} — run sheet ${formatDate(date, 'long')}`, `${jobs.length} job${jobs.length === 1 ? '' : 's'}`, ''];
  jobs.forEach((j, i) => {
    lines.push(`${i + 1}. ${slotLabel(j.slot)} · ${j.ref} · ${STATUS_META[j.status as keyof typeof STATUS_META]?.label ?? j.status}`);
    lines.push(`   ${j.name} · ${j.phone}`);
    if (j.vehicles) lines.push(`   ${j.vehicles.split(', ').map((v) => { const [reg, ...rest] = v.split(' '); return `${formatReg(reg ?? '')} ${rest.join(' ')}`.trim(); }).join(', ')}`);
    if (j.items) lines.push(`   ${j.items}`);
    lines.push(`   ${j.service_mode === 'drop_off' ? 'Lab drop-off' : [j.address, j.postcode].filter(Boolean).join(', ')}`);
    if (j.customer_notes) lines.push(`   Notes: ${j.customer_notes.replace(/\s+/g, ' ').slice(0, 200)}`);
    lines.push(`   ${money(j.total)}${j.paid_amount >= j.total && j.total > 0 ? ' · paid' : j.paid_amount ? ` · ${money(j.paid_amount)} paid` : ' · to collect'}`);
    lines.push('');
  });
  if (!jobs.length) lines.push('No jobs booked.');
  return c.text(lines.join('\n'));
});

// ───────────────────────────── Trade accounts ─────────────────────────────
opsRoutes.get('/trade/applications', async (c) => {
  staffOrFail(c, 'crm.read');
  noStore(c);
  const rows = await all(c.env.DB, "SELECT id, name, kind, contact_name, phone, email, code, customer_discount_pct, trade_details, created_at FROM partners WHERE trade_status = 'applied' ORDER BY created_at");
  return c.json({ rows });
});

opsRoutes.post('/trade/:id/:decision{approve|decline}', async (c) => {
  staffOrFail(c, 'crm.write');
  const id = intParam(c, 'id');
  const decision = c.req.param('decision');
  const db = c.env.DB;
  const p = await first<{ id: number; name: string; contact_name: string; phone: string; email: string; code: string; customer_discount_pct: number; trade_status: string }>(db, 'SELECT * FROM partners WHERE id = ?', id);
  if (!p) fail(404, 'Application not found.');
  const settings = await getSettings(db);
  if (decision === 'approve') {
    const { discount } = await readJson(c, z.object({ discount: z.number().int().min(0).max(60).optional() }));
    const pct = discount ?? (p!.customer_discount_pct || settings.pricing.tradeDiscountPct);
    await run(db, "UPDATE partners SET trade_status = 'approved', active = 1, customer_discount_pct = ? WHERE id = ?", pct, id);
    const origin = originOf(c);
    await messageCustomer(c.env, settings, { name: p!.contact_name || p!.name, email: p!.email, phone: p!.phone }, {
      subject: `Your ${settings.business.name} trade account is approved`,
      text: `Your trade account for ${p!.name} is approved. Your trade code is ${p!.code} — use it when booking online (or quote it by phone) for ${pct}% off every package.`,
      ctaLabel: 'Book at trade rates', ctaUrl: `${origin}/book?promo=${encodeURIComponent(p!.code)}&src=trade`,
    });
    await audit(c, 'approve', 'partner', id, `Approved trade account ${p!.name} (${p!.code}, ${pct}%)`);
    return c.json({ ok: true, message: `${p!.name} approved — trade code ${p!.code} sent.` });
  }
  await run(db, "UPDATE partners SET trade_status = 'declined', active = 0 WHERE id = ?", id);
  await audit(c, 'decline', 'partner', id, `Declined trade application from ${p!.name}`);
  return c.json({ ok: true, message: `${p!.name} declined. No message was sent — contact them if you want to explain.` });
});

/** Monthly statement PDF for a trade / partner account (shared by the admin and the customer portal). */
export async function buildStatement(c: Ctx, id: number, monthRaw: string | undefined): Promise<{ bytes: Uint8Array; filename: string }> {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const month = /^\d{4}-\d{2}$/.test(monthRaw ?? '') ? monthRaw! : todayIn(settings.business.timezone).slice(0, 7);
  const p = await first<{ id: number; name: string; contact_name: string; email: string; phone: string; code: string; customer_discount_pct: number }>(db, 'SELECT * FROM partners WHERE id = ?', id);
  if (!p) fail(404, 'Account not found.');
  const rows = await all<{ date: string; ref: string; status: string; total: number; paid_amount: number; vehicles: string | null; items: string | null }>(
    db,
    `SELECT b.date, b.ref, b.status, b.total, b.paid_amount,
       (SELECT group_concat(v.reg, ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS vehicles,
       (SELECT group_concat(i.name, ', ') FROM booking_items i WHERE i.booking_id = b.id) AS items
     FROM bookings b WHERE b.partner_id = ? AND substr(b.date, 1, 7) = ? AND b.status NOT IN ('cancelled','no_show') ORDER BY b.date, b.id`,
    id, month,
  );
  const billed = rows.reduce((a, r) => a + r.total, 0);
  const paid = rows.reduce((a, r) => a + Math.min(r.paid_amount, r.total), 0);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const period = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const bytes = await statementPdf({
    brand: await brand(c, settings), ref: `${p!.code}-${month}`, period, issued: formatDate(todayIn(settings.business.timezone)),
    account: [p!.name, p!.contact_name, p!.email, p!.phone, `Trade code ${p!.code}`],
    summary: [['Jobs', String(rows.length)], ['Trade rate', `${p!.customer_discount_pct}%`], ['Billed', money(billed)], ['Outstanding', money(billed - paid)]],
    rows: rows.map((r) => [formatDate(r.date), r.ref, [r.vehicles ? r.vehicles.split(', ').map(formatReg).join(', ') : '', r.items ?? ''].filter(Boolean).join(' — '), STATUS_META[r.status as keyof typeof STATUS_META]?.label ?? r.status, money(r.total), money(Math.max(0, r.total - r.paid_amount))]),
    totals: [{ label: 'Billed this period', value: money(billed) }, { label: 'Paid', value: money(paid), tone: 'good' }, { label: 'Balance due', value: money(billed - paid), strong: true }],
    terms: `Payment due within 14 days of the statement date. Pay by bank transfer quoting ${p!.code}-${month}, or by card through the tracker link for each job. Questions: ${settings.business.phone} · ${settings.business.email}.`,
  });
  return { bytes, filename: `statement-${p!.code}-${month}.pdf` };
}

opsRoutes.get('/partners/:id/statement.pdf', async (c) => {
  staffOrFail(c, 'finance.read');
  const { bytes, filename } = await buildStatement(c, intParam(c, 'id'), c.req.query('month'));
  return download(bytes as Uint8Array<ArrayBuffer>, filename, 'application/pdf', c.req.query('download') !== '1');
});

// ───────────────────────────── Estimates (extra work for customer approval) ─────────────────────────────
interface EstimateItem { name: string; qty: number; unitPrice: number }
export interface EstimateRow { id: number; booking_id: number; title: string; note: string; items: string; total: number; status: string; created_by: string; decided_name: string; decided_note: string; decided_at: string | null; created_at: string }

export const estimateOut = (e: EstimateRow) => ({ id: e.id, title: e.title, note: e.note, items: parseJson<EstimateItem[]>(e.items, []), total: e.total, status: e.status, createdBy: e.created_by, decidedName: e.decided_name, decidedNote: e.decided_note, decidedAt: e.decided_at, createdAt: e.created_at });

opsRoutes.get('/bookings/:id/estimates', async (c) => {
  staffOrFail(c, 'bookings.read');
  const rows = await all<EstimateRow>(c.env.DB, 'SELECT * FROM estimates WHERE booking_id = ? ORDER BY id DESC', intParam(c, 'id'));
  return c.json({ estimates: rows.map(estimateOut) });
});

opsRoutes.post('/bookings/:id/estimates', async (c) => {
  const staff = staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const input = await readJson(c, z.object({
    title: z.string().trim().min(2).max(120).default('Additional work'),
    note: z.string().trim().max(2000).default(''),
    items: z.array(z.object({ name: z.string().trim().min(1).max(160), qty: z.number().min(0.1).max(100).default(1), unitPrice: z.number().int().min(0).max(10_000_00) })).min(1).max(20),
    notify: z.boolean().default(true),
  }));
  const db = c.env.DB;
  const b = await getBooking(db, id);
  if (!b) fail(404, 'Booking not found.');
  if (['cancelled', 'no_show'].includes(b!.status)) fail(409, 'This booking is closed.');
  const total = Math.round(input.items.reduce((a, i) => a + i.qty * i.unitPrice, 0));
  const { id: estimateId } = await run(db, 'INSERT INTO estimates (booking_id, title, note, items, total, created_by) VALUES (?, ?, ?, ?, ?, ?)', id, input.title, input.note, JSON.stringify(input.items), total, staff.name);
  await addEvent(db, id, 'estimate', `Estimate for approval: ${input.title} — ${money(total, b!.currency)}`, staff.name, true);
  if (input.notify) {
    const settings = await getSettings(db);
    const customer = await first<{ name: string; email: string; phone: string }>(db, 'SELECT name, email, phone FROM customers WHERE id = ?', b!.customer_id);
    if (customer) {
      c.executionCtx.waitUntil(messageCustomer(c.env, settings, customer, {
        subject: `Approval needed: ${input.title} (${b!.ref})`,
        text: `We've found something on your vehicle that needs your OK before we carry on: ${input.title}, ${money(total, b!.currency)}. Tap to see the details and approve or decline:`,
        ctaLabel: 'Review estimate', ctaUrl: `${originOf(c)}/track/${b!.access_token}#estimates`, bookingId: id,
      }).then(() => undefined));
    }
  }
  await audit(c, 'create', 'estimate', estimateId, `Estimate ${input.title} on ${b!.ref} for ${money(total, b!.currency)}`);
  return c.json({ ok: true, id: estimateId });
});

opsRoutes.post('/estimates/:id/withdraw', async (c) => {
  staffOrFail(c, 'bookings.write');
  const id = intParam(c, 'id');
  const e = await first<EstimateRow>(c.env.DB, 'SELECT * FROM estimates WHERE id = ?', id);
  if (!e) fail(404, 'Estimate not found.');
  if (e!.status !== 'pending') fail(409, 'Only a pending estimate can be withdrawn.');
  await run(c.env.DB, "UPDATE estimates SET status = 'withdrawn', decided_at = ? WHERE id = ?", nowIso(), id);
  await addEvent(c.env.DB, e!.booking_id, 'estimate', `Estimate withdrawn: ${e!.title}`, c.get('staff')!.name, true);
  await audit(c, 'withdraw', 'estimate', id, `Withdrew estimate ${e!.title}`);
  return c.json({ ok: true });
});

/** Customer decision from the tracker. Approval adds the work to the job and recalculates the total. */
export async function decideEstimate(c: Ctx, bookingId: number, estimateId: number, decision: 'approve' | 'decline', name: string, note: string): Promise<{ total: number }> {
  const db = c.env.DB;
  const e = await first<EstimateRow>(db, 'SELECT * FROM estimates WHERE id = ? AND booking_id = ?', estimateId, bookingId);
  if (!e) fail(404, 'Estimate not found.');
  if (e!.status !== 'pending') fail(409, `This estimate has already been ${e!.status}.`);
  const status = decision === 'approve' ? 'approved' : 'declined';
  const updated = await run(db, "UPDATE estimates SET status = ?, decided_name = ?, decided_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'", status, name, note, nowIso(), estimateId);
  if (!updated.changes) fail(409, 'This estimate was just updated — refresh to see it.');
  let total = (await getBooking(db, bookingId))!.total;
  if (decision === 'approve') {
    const sortBase = (await first<{ s: number | null }>(db, 'SELECT MAX(sort) AS s FROM booking_items WHERE booking_id = ?', bookingId))?.s ?? 0;
    const items = parseJson<EstimateItem[]>(e!.items, []);
    for (const [i, it] of items.entries()) await run(db, "INSERT INTO booking_items (booking_id, kind, name, qty, unit_price, sort) VALUES (?, 'custom', ?, ?, ?, ?)", bookingId, it.name, it.qty, it.unitPrice, sortBase + 1 + i);
    total = await recalcTotals(db, bookingId);
  }
  await addEvent(db, bookingId, 'estimate', `${name || 'Customer'} ${status} the estimate: ${e!.title} (${money(e!.total)})${note ? ` — "${note.slice(0, 200)}"` : ''}`, name || 'Customer', true);
  const b = await getBooking(db, bookingId);
  c.executionCtx.waitUntil(pushOwner(c.env, `Estimate ${status}: ${b!.ref}`, `${name || 'The customer'} ${status} "${e!.title}" (${money(e!.total)}).${note ? ` Note: ${note.slice(0, 200)}` : ''}`, `${originOf(c)}/admin#/bookings/${bookingId}`, decision === 'approve' ? 4 : 3, [decision === 'approve' ? 'white_check_mark' : 'x']));
  return { total };
}

// ───────────────────────────── Fault-code bulk import ─────────────────────────────
/** Split one CSV / tab-separated line, honouring double-quoted fields. */
export function splitRow(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

opsRoutes.post('/dtc/import', async (c) => {
  staffOrFail(c, 'tech.write');
  const { text } = await readJson(c, z.object({ text: z.string().max(400_000) }));
  const db = c.env.DB;
  let added = 0;
  let updated = 0;
  const skipped: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const existing = new Set((await all<{ code: string }>(db, 'SELECT code FROM dtc_codes')).map((r) => r.code));
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [code = '', title = '', system = '', causes = '', fixes = '', severity = ''] = splitRow(raw);
    const c0 = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[PCBU][0-9A-F]{4}$/.test(c0)) {
      if (!/^code$/i.test(code)) skipped.push(raw.slice(0, 40));
      continue;
    }
    if (!title) {
      skipped.push(raw.slice(0, 40));
      continue;
    }
    const sev = ['info', 'amber', 'red'].includes(severity.toLowerCase()) ? severity.toLowerCase() : 'amber';
    const sys = system || ({ P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' } as Record<string, string>)[c0[0]!]!;
    statements.push(db.prepare(`INSERT INTO dtc_codes (code, system, title, causes, fixes, severity) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET title = excluded.title, system = COALESCE(NULLIF(?, ''), dtc_codes.system), causes = COALESCE(NULLIF(excluded.causes, ''), dtc_codes.causes), fixes = COALESCE(NULLIF(excluded.fixes, ''), dtc_codes.fixes), severity = CASE WHEN ? = '' THEN dtc_codes.severity ELSE excluded.severity END`)
      .bind(c0, sys.slice(0, 60), title.slice(0, 200), causes.slice(0, 1000), fixes.slice(0, 1000), sev, system, severity));
    if (existing.has(c0)) updated++;
    else {
      added++;
      existing.add(c0);
    }
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  await audit(c, 'import', 'dtc_codes', 'bulk', `Imported fault codes: ${added} added, ${updated} updated`);
  return c.json({ ok: true, added, updated, skipped: skipped.slice(0, 20), skippedCount: skipped.length });
});
