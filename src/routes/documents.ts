// PDF documents and calendar files. Staff reach them under /docs/*; customers reach the
// documents for their own booking through the secret tracker link (/track/:token/*).
import { Hono } from 'hono';
import { PAYMENT_METHODS, slotLabel, SLOTS, type SlotKey } from '../../shared/constants';
import { displayPhone, formatDate, formatDateTime, formatReg, money, todayIn } from '../../shared/format';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { staffOrFail } from '../lib/auth';
import { all, first, parseJson } from '../lib/db';
import { download, intParam } from '../lib/http';
import { fail } from '../lib/security';
import { getSettings, type Settings } from '../lib/settings';
import { bookingItems, bookingVehicles, getBooking, getBookingByToken, type BookingRow } from '../services/bookings';
import { readMediaBytes } from '../services/media';
import { batteryCertificatePdf, checklistReportPdf, invoicePdf, jobReportPdf, partsRequestPdf, type PdfBrand, type Tone } from '../services/pdf';

export const documentRoutes = new Hono<AppEnv>();

export async function brand(c: Ctx, settings: Settings): Promise<PdfBrand> {
  const b = settings.business;
  let logo: PdfBrand['logo'] = null;
  if (settings.branding.logoMediaId) {
    const m = await first<{ storage_key: string; content_type: string }>(c.env.DB, 'SELECT storage_key, content_type FROM media WHERE id = ?', settings.branding.logoMediaId);
    if (m && (m.content_type === 'image/png' || m.content_type === 'image/jpeg')) {
      const bytes = await readMediaBytes(c.env, m.storage_key);
      if (bytes) logo = { bytes, type: m.content_type };
    }
  }
  return {
    name: b.name,
    tagline: 'Mobile diagnostics · coding · detailing',
    contact: [b.phone, b.email, new URL(originOf(c)).host].filter(Boolean),
    footer: [b.legalName, settings.pricing.vat.registered && settings.pricing.vat.number ? `VAT ${settings.pricing.vat.number}` : '', b.credentials[0] ?? ''].filter(Boolean).join(' · '),
    logo,
  };
}

const vehicleRows = (v: { reg: string; make: string; model: string; year: number | null; vin?: string }): [string, string][] => [
  ['Registration', formatReg(v.reg)], ['Vehicle', [v.year, v.make, v.model].filter(Boolean).join(' ') || '—'], ['VIN', v.vin || '—'],
];

async function technician(c: Ctx, b: BookingRow, settings: Settings): Promise<string> {
  if (!b.assigned_user_id) return settings.business.leadEngineer;
  return (await first<{ name: string }>(c.env.DB, 'SELECT name FROM users WHERE id = ?', b.assigned_user_id))?.name ?? settings.business.leadEngineer;
}

async function renderInvoice(c: Ctx, b: BookingRow): Promise<Uint8Array> {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const [customer, vehicles, items, payments] = await Promise.all([
    first<{ name: string; email: string; phone: string; company: string; address: string }>(db, 'SELECT name, email, phone, company, address FROM customers WHERE id = ?', b.customer_id),
    bookingVehicles(db, b.id),
    bookingItems(db, b.id),
    all<{ kind: string; method: string; amount: number; created_at: string }>(db, "SELECT kind, method, amount, created_at FROM payments WHERE booking_id = ? AND status = 'succeeded' ORDER BY id", b.id),
  ]);
  const cur = b.currency;
  const m = (v: number) => money(v, cur);
  const vehicleOf = new Map(vehicles.map((v) => [v.id, formatReg(v.reg)]));
  const balance = b.total - b.paid_amount;
  const completed = b.status === 'completed';
  const kind = completed ? (balance <= 0 ? 'Receipt' : 'Invoice') : 'Quote';
  const status: { text: string; tone: Tone } = b.status === 'cancelled' ? { text: 'Cancelled', tone: 'bad' } : balance <= 0 && b.total > 0 ? { text: 'Paid in full', tone: 'good' } : completed ? { text: 'Payment due', tone: 'warn' } : { text: b.paid_amount > 0 ? 'Deposit paid' : 'Booked', tone: 'neutral' };
  const vat = settings.pricing.vat;
  const totals: { label: string; value: string; strong?: boolean; tone?: Tone }[] = [{ label: 'Subtotal', value: m(b.subtotal) }];
  if (b.discount) totals.push({ label: 'Discounts', value: `−${m(b.discount)}`, tone: 'good' });
  if (b.peak_adjustment) totals.push({ label: b.peak_adjustment > 0 ? 'Peak-time adjustment' : 'Off-peak saving', value: `${b.peak_adjustment > 0 ? '' : '−'}${m(Math.abs(b.peak_adjustment))}` });
  if (b.travel_fee) totals.push({ label: 'Travel', value: m(b.travel_fee) });
  if (b.emergency_fee) totals.push({ label: 'Emergency call-out', value: m(b.emergency_fee) });
  if (b.loyalty_discount) totals.push({ label: 'Loyalty points', value: `−${m(b.loyalty_discount)}`, tone: 'good' });
  if (vat.registered) totals.push({ label: `Includes VAT @ ${vat.rate}%`, value: m(Math.round((b.total * vat.rate) / (100 + vat.rate))) });
  totals.push({ label: 'Total', value: m(b.total), strong: !b.paid_amount });
  if (b.paid_amount) {
    totals.push({ label: 'Paid', value: `−${m(b.paid_amount)}`, tone: 'good' });
    totals.push({ label: balance > 0 ? 'Balance due' : 'Balance', value: m(Math.max(0, balance)), strong: true });
  }
  return invoicePdf({
    brand: await brand(c, settings),
    kind,
    ref: b.ref,
    issued: formatDate((b.completed_at ?? b.created_at).slice(0, 10), 'short'),
    status,
    billTo: [customer?.name ?? '', customer?.company ?? '', b.address || customer?.address || '', [displayPhone(customer?.phone), customer?.email].filter(Boolean).join(' · ')],
    job: [
      ['Appointment', `${formatDate(b.date, 'short')} · ${b.slot === 'asap' ? 'Emergency' : SLOTS[b.slot as SlotKey]?.label ?? b.slot}`],
      ['Vehicle', vehicles.map((v) => `${formatReg(v.reg)} ${[v.make, v.model].filter(Boolean).join(' ')}`).join(', ') || '—'],
      ['Payment', PAYMENT_METHODS[b.payment_method] ?? b.payment_method],
    ],
    items: items.map((i) => ({
      description: i.name,
      detail: [vehicles.length > 1 && i.vehicle_id ? vehicleOf.get(i.vehicle_id) : '', i.kind !== 'package' ? i.kind[0]!.toUpperCase() + i.kind.slice(1) : ''].filter(Boolean).join(' · '),
      qty: String(i.qty), unit: m(i.unit_price), total: m(Math.round(i.qty * i.unit_price)),
    })),
    totals,
    payments: payments.map((p) => [formatDate(p.created_at.slice(0, 10), 'short'), `${p.kind === 'refund' ? 'Refund' : p.kind === 'deposit' ? 'Deposit' : 'Payment'} — ${p.method.replace(/_/g, ' ')}`, `${p.kind === 'refund' ? '−' : ''}${m(p.amount)}`]),
    notes: completed ? b.findings : '',
    terms: [
      completed && balance > 0 ? `Payment due on completion. Pay by card, Apple Pay or Google Pay using the link in your tracker, or by bank transfer quoting ${b.ref}.` : '',
      'Workmanship guaranteed. Diagnostics identify the cause of a fault at the time of test; further faults may develop independently.',
      settings.pricing.vat.registered ? '' : 'Not VAT registered — no VAT has been charged.',
    ].filter(Boolean).join(' '),
  });
}

async function renderReport(c: Ctx, b: BookingRow): Promise<Uint8Array> {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const [vehicles, items, dpf, flash, freeze] = await Promise.all([
    bookingVehicles(db, b.id),
    bookingItems(db, b.id),
    all<Record<string, number | string | null>>(db, 'SELECT * FROM dpf_logs WHERE booking_id = ? ORDER BY id', b.id),
    all<Record<string, string>>(db, 'SELECT * FROM flash_log WHERE booking_id = ? ORDER BY id', b.id),
    all<{ title: string; data: string; notes: string; dtc: string }>(db, 'SELECT title, data, notes, dtc FROM freeze_frames WHERE booking_id = ? ORDER BY id', b.id),
  ]);
  const codes = [...new Set([...(b.findings.toUpperCase().match(/\b[PBCU][0-9A-F]{4}\b/g) ?? []), ...freeze.map((f) => f.dtc).filter(Boolean)])].slice(0, 30);
  const dtcs = codes.length ? await all<{ code: string; title: string; causes: string }>(db, `SELECT code, title, causes FROM dtc_codes WHERE code IN (${codes.map(() => '?').join(',')})`, ...codes) : [];
  let signature: { bytes: Uint8Array; type: string } | null = null;
  if (b.signature_media_id) {
    const m = await first<{ storage_key: string; content_type: string }>(db, 'SELECT storage_key, content_type FROM media WHERE id = ?', b.signature_media_id);
    const bytes = m ? await readMediaBytes(c.env, m.storage_key) : null;
    if (bytes && m) signature = { bytes, type: m.content_type };
  }
  const n = (v: unknown, unit: string) => (v == null || v === '' ? '—' : `${v}${unit}`);
  const walkaround = (b.internal_notes.match(/Pre-work inspection: (.*)/)?.[1] ?? '').trim();
  return jobReportPdf({
    brand: await brand(c, settings),
    ref: b.ref,
    date: formatDate(b.date, 'short'),
    job: [
      ...(vehicles[0] ? vehicleRows(vehicles[0] as { reg: string; make: string; model: string; year: number | null }) : []),
      ['Work carried out', items.map((i) => i.name).join('; ') || '—'],
      ['Technician', await technician(c, b, settings)],
      ['Status', b.status === 'completed' ? `Completed ${formatDateTime(b.completed_at)}` : b.status.replace('_', ' ')],
    ],
    findings: b.findings,
    dtcs: codes.map((code) => {
      const d = dtcs.find((x) => x.code === code);
      return [code, d?.title ?? 'Manufacturer-specific code', d?.causes ?? 'See findings.'];
    }),
    dpf: dpf.map((d) => [String(d.regen_type).replace(/_/g, ' '), n(d.soot_pct_before, '%'), n(d.soot_pct_after, '%'), `${n(d.dp_mbar_before, '')} / ${n(d.dp_mbar_after, ' mbar')}`, n(d.max_egt_c, '°C'), String(d.result)]),
    flash: flash.map((f) => [f.module!, f.version_before || '—', f.version_after || '—', f.tool || '—', f.result!]),
    freeze: freeze.map((f) => ({ title: `${f.dtc ? `${f.dtc} — ` : ''}${f.title}`, rows: parseJson<{ pid: string; value: string; unit: string; expected: string }[]>(f.data, []).map((r) => [r.pid, String(r.value ?? ''), r.unit ?? '', r.expected ?? '']), notes: f.notes })),
    walkaround: walkaround ? `Condition noted before work: ${walkaround}` : '',
    signature,
    signedName: b.signed_name,
    signedAt: b.signed_at ? formatDateTime(b.signed_at) : '',
    technician: await technician(c, b, settings),
  });
}

async function renderBattery(c: Ctx, testId: number, bookingId?: number): Promise<Uint8Array> {
  const db = c.env.DB;
  const t = await first<{ id: number; booking_id: number | null; reg: string; tested_on: string; created_by: string } & Parameters<typeof batteryCertificatePdf>[0]['test']>(db, 'SELECT * FROM battery_tests WHERE id = ?', testId);
  if (!t || (bookingId && t.booking_id !== bookingId)) fail(404, 'Certificate not found.');
  const settings = await getSettings(db);
  const v = await first<{ reg: string; make: string; model: string; year: number | null; vin: string }>(db, 'SELECT reg, make, model, year, vin FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', t!.reg);
  return batteryCertificatePdf({
    brand: await brand(c, settings),
    certNo: `BAT-${String(t!.id).padStart(5, '0')}`,
    date: formatDate(t!.tested_on, 'short'),
    vehicle: v ? vehicleRows(v) : [['Registration', formatReg(t!.reg)]],
    test: t!,
    technician: t!.created_by || settings.business.leadEngineer,
    credential: settings.business.credentials[0] ?? '',
  });
}

async function renderChecklist(c: Ctx, runId: number, bookingId?: number): Promise<Uint8Array> {
  const db = c.env.DB;
  const r = await first<{ id: number; booking_id: number | null; reg: string; results: string; score: number | null; max_score: number | null; summary: string; completed_by: string; completed_at: string | null; created_at: string; template_id: number; kind: string }>(db, 'SELECT * FROM checklist_runs WHERE id = ?', runId);
  if (!r || (bookingId && r.booking_id !== bookingId)) fail(404, 'Report not found.');
  const t = await first<{ name: string; sections: string }>(db, 'SELECT name, sections FROM checklist_templates WHERE id = ?', r!.template_id);
  const settings = await getSettings(db);
  const results = parseJson<Record<string, { status: string; note: string }>>(r!.results, {});
  const sections = parseJson<{ title: string; items: string[] }[]>(t?.sections, []);
  const v = r!.reg ? await first<{ reg: string; make: string; model: string; year: number | null; vin: string }>(db, 'SELECT reg, make, model, year, vin FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', r!.reg) : null;
  return checklistReportPdf({
    brand: await brand(c, settings),
    title: r!.kind === 'ppi' ? 'Pre-Purchase Inspection' : r!.kind === 'vhc' ? 'Vehicle Health Check' : t?.name ?? 'Checklist',
    ref: `${r!.kind.toUpperCase()}-${String(r!.id).padStart(5, '0')}`,
    date: formatDate((r!.completed_at ?? r!.created_at).slice(0, 10), 'short'),
    vehicle: v ? vehicleRows(v) : [['Registration', formatReg(r!.reg) || '—']],
    sections: sections.map((s, si) => ({
      title: s.title,
      items: s.items.map((label, ii) => {
        const res = results[`${si}.${ii}`] ?? { status: '', note: '' };
        return { label, status: res.status === 'na' ? 'N/A' : res.status, note: res.note };
      }),
    })),
    score: r!.score, maxScore: r!.max_score, summary: r!.summary,
    technician: r!.completed_by || settings.business.leadEngineer,
    credential: settings.business.credentials[0] ?? '',
  });
}

const pdf = (bytes: Uint8Array, name: string, c: Ctx) => download(bytes as Uint8Array<ArrayBuffer>, name, 'application/pdf', c.req.query('download') !== '1');

// ── Staff routes ──
documentRoutes.get('/docs/invoice/:id{[0-9]+\\.pdf}', async (c) => {
  staffOrFail(c, 'bookings.read');
  const b = await getBooking(c.env.DB, parseInt(c.req.param('id'), 10));
  if (!b) fail(404, 'Booking not found.');
  return pdf(await renderInvoice(c, b!), `${b!.ref}-invoice.pdf`, c);
});
documentRoutes.get('/docs/report/:id{[0-9]+\\.pdf}', async (c) => {
  staffOrFail(c, 'bookings.read');
  const b = await getBooking(c.env.DB, parseInt(c.req.param('id'), 10));
  if (!b) fail(404, 'Booking not found.');
  return pdf(await renderReport(c, b!), `${b!.ref}-report.pdf`, c);
});
documentRoutes.get('/docs/battery/:id{[0-9]+\\.pdf}', async (c) => {
  staffOrFail(c, 'tech.read');
  const id = parseInt(c.req.param('id'), 10);
  return pdf(await renderBattery(c, id), `battery-certificate-${id}.pdf`, c);
});
documentRoutes.get('/docs/checklist/:id{[0-9]+\\.pdf}', async (c) => {
  staffOrFail(c, 'tech.read');
  const id = parseInt(c.req.param('id'), 10);
  return pdf(await renderChecklist(c, id), `inspection-${id}.pdf`, c);
});
documentRoutes.get('/docs/parts/:id{[0-9]+\\.pdf}', async (c) => {
  staffOrFail(c, 'bookings.read');
  const id = parseInt(c.req.param('id'), 10);
  const req = await first<{ id: number; vehicle_reg: string; supplier: string; items: string; notes: string; created_at: string }>(c.env.DB, 'SELECT * FROM parts_requests WHERE id = ?', id);
  if (!req) fail(404, 'Parts request not found.');
  const settings = await getSettings(c.env.DB);
  const v = await first<{ reg: string; make: string; model: string; year: number | null; vin: string }>(c.env.DB, 'SELECT reg, make, model, year, vin FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', req!.vehicle_reg);
  const bytes = await partsRequestPdf({
    brand: await brand(c, settings), ref: `PR-${id}`, date: formatDate(req!.created_at.slice(0, 10), 'short'), supplier: req!.supplier,
    vehicle: v ? vehicleRows(v) : [['Registration', formatReg(req!.vehicle_reg) || '—']],
    items: parseJson<{ description: string; part_no: string; qty: number; dtc: string }[]>(req!.items, []).map((i) => [i.description, i.part_no || '—', String(i.qty ?? 1), i.dtc || '—']),
    notes: req!.notes,
  });
  return pdf(bytes, `parts-request-PR-${id}.pdf`, c);
});

// ── Customer routes (secret tracker link) ──
async function tokenBooking(c: Ctx): Promise<BookingRow> {
  const b = await getBookingByToken(c.env.DB, c.req.param('token') ?? '');
  if (!b) fail(404, 'This link is not valid.');
  return b!;
}
documentRoutes.get('/track/:token/invoice.pdf', async (c) => {
  const b = await tokenBooking(c);
  return pdf(await renderInvoice(c, b), `${b.ref}-invoice.pdf`, c);
});
documentRoutes.get('/track/:token/report.pdf', async (c) => {
  const b = await tokenBooking(c);
  return pdf(await renderReport(c, b), `${b.ref}-report.pdf`, c);
});
documentRoutes.get('/track/:token/battery/:id{[0-9]+\\.pdf}', async (c) => {
  const b = await tokenBooking(c);
  const id = parseInt(c.req.param('id'), 10);
  return pdf(await renderBattery(c, id, b.id), `battery-certificate-${id}.pdf`, c);
});
documentRoutes.get('/track/:token/checklist/:id{[0-9]+\\.pdf}', async (c) => {
  const b = await tokenBooking(c);
  const id = parseInt(c.req.param('id'), 10);
  return pdf(await renderChecklist(c, id, b.id), `inspection-${id}.pdf`, c);
});

// ── Calendar files ──
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');
function icsStamp(date: string, hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${date.replace(/-/g, '')}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
}

function vevent(b: { id: number; ref: string; date: string; slot: string; slot_span: number; address: string; status: string }, summary: string, description: string, url: string): string[] {
  const slot = b.slot === 'asap' ? null : SLOTS[b.slot as SlotKey];
  const start = slot?.startHour ?? 8;
  const endSlotKey = (['morning', 'afternoon', 'evening'] as SlotKey[])[Math.min(2, Object.keys(SLOTS).indexOf(b.slot) + Math.max(1, b.slot_span) - 1)];
  const end = b.slot === 'asap' ? start + 2 : SLOTS[endSlotKey ?? 'morning'].endHour;
  return [
    'BEGIN:VEVENT',
    `UID:booking-${b.id}@specone`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/London:${icsStamp(b.date, start)}`,
    `DTEND;TZID=Europe/London:${icsStamp(b.date, end)}`,
    icsFold(`SUMMARY:${icsEscape(summary)}`),
    icsFold(`DESCRIPTION:${icsEscape(description)}`),
    icsFold(`LOCATION:${icsEscape(b.address)}`),
    icsFold(`URL:${url}`),
    `STATUS:${b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', icsFold(`DESCRIPTION:${icsEscape(summary)}`), 'END:VALARM',
    'END:VEVENT',
  ];
}

const calendar = (name: string, events: string[]) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SpecOne Auto Labs//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', icsFold(`X-WR-CALNAME:${icsEscape(name)}`), 'X-WR-TIMEZONE:Europe/London',
  ...events, 'END:VCALENDAR',
].join('\r\n');

documentRoutes.get('/track/:token/calendar.ics', async (c) => {
  const b = await tokenBooking(c);
  const settings = await getSettings(c.env.DB);
  const items = await bookingItems(c.env.DB, b.id);
  const body = calendar(settings.business.name, vevent(b, `${settings.business.name} — ${items[0]?.name ?? 'appointment'}`, `Booking ${b.ref}, ${slotLabel(b.slot)}. Live tracker: ${originOf(c)}/track/${b.access_token}. Questions: ${settings.business.phone}`, `${originOf(c)}/track/${b.access_token}`));
  return download(body, `${b.ref}.ics`, 'text/calendar; charset=utf-8');
});

/** Subscribable staff calendar (Samsung / Google / Apple Calendar). Secured by an unguessable link. */
documentRoutes.get('/calendar/:token{[A-Za-z0-9_-]{20,64}\\.ics}', async (c) => {
  const token = c.req.param('token').replace(/\.ics$/, '');
  const flag = await first<{ value: string }>(c.env.DB, "SELECT value FROM settings WHERE key = 'flag:calendar_token'");
  if (!flag || flag.value !== token) fail(404, 'Calendar not found.');
  const settings = await getSettings(c.env.DB);
  const today = todayIn(settings.business.timezone);
  const rows = await all<{ id: number; ref: string; date: string; slot: string; slot_span: number; address: string; status: string; customer: string; phone: string; services: string; regs: string; customer_notes: string }>(
    c.env.DB,
    `SELECT b.id, b.ref, b.date, b.slot, b.slot_span, b.address, b.status, b.customer_notes, c.name AS customer, c.phone,
       (SELECT GROUP_CONCAT(name, '; ') FROM booking_items WHERE booking_id = b.id) AS services,
       (SELECT GROUP_CONCAT(v.reg || ' ' || v.make || ' ' || v.model, '; ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS regs
     FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.date >= ? AND b.status NOT IN ('no_show') ORDER BY b.date LIMIT 1000`,
    `${today.slice(0, 8)}01`,
  );
  const blocked = await all<{ date: string; reason: string }>(c.env.DB, 'SELECT date, reason FROM blocked_dates WHERE date >= ?', today);
  const events = rows.flatMap((b) => vevent(b, `${b.customer} — ${b.services ?? 'Job'}`, `${b.ref}\n${b.regs ?? ''}\n${displayPhone(b.phone)}\n${b.customer_notes}\n${originOf(c)}/admin#/bookings/${b.id}`, `${originOf(c)}/admin#/bookings/${b.id}`));
  for (const d of blocked) events.push('BEGIN:VEVENT', `UID:blocked-${d.date}@specone`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d.date.replace(/-/g, '')}`, icsFold(`SUMMARY:Blocked — ${icsEscape(d.reason || 'unavailable')}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  return new Response(calendar(`${settings.business.name} jobs`, events), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
});

export { intParam };
