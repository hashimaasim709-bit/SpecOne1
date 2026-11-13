// Import customers, vehicles and bookings from the previous SpecOne system.
//
// 1. On the OLD site, open /api/admin/cloud-backup while signed in and save the JSON file.
// 2. node scripts/import-legacy.mjs specone-cloud-d1-backup.json legacy-import.sql
// 3. npx wrangler d1 execute DB --remote --file legacy-import.sql
//
// The import is idempotent: bookings are matched on their old reference, customers on
// phone/email and vehicles on registration, so running it twice does not duplicate data.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [input, output = 'legacy-import.sql'] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/import-legacy.mjs <old-backup.json> [output.sql]');
  process.exit(1);
}
const raw = JSON.parse(await readFile(input, 'utf8'));
const bookings = Array.isArray(raw) ? raw : raw.bookings ?? raw.tables?.bookings ?? [];

const q = (v) => (v == null || v === '' ? "''" : `'${String(v).replace(/'/g, "''")}'`);
const pence = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.]/g, '') || 0) * 100);
const phone = (p) => {
  let s = String(p ?? '').replace(/[^0-9+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('0')) s = `+44${s.slice(1)}`;
  if (s.startsWith('44')) s = `+${s}`;
  return s.startsWith('+') ? s : `+44${s}`;
};
const STATUS = { confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled', 'quote requested': 'pending', pending: 'pending' };
const statusOf = (s) => {
  const v = String(s ?? '').toLowerCase();
  if (v.startsWith('en route')) return 'en_route';
  return STATUS[v] ?? 'confirmed';
};
const slotOf = (s) => {
  const v = String(s ?? '').toLowerCase();
  if (v.includes('emergency') || v.includes('asap')) return 'asap';
  if (v.includes('afternoon')) return 'afternoon';
  if (v.includes('evening')) return 'evening';
  return 'morning';
};
const sizeOf = (s) => (/^s/i.test(String(s ?? '')) ? 'S' : /^l/i.test(String(s ?? '')) ? 'L' : 'M');

const lines = ['-- SpecOne legacy import', `-- Source: ${input}`, `-- Generated: ${new Date().toISOString()}`, ''];
let count = 0;
for (const b of bookings) {
  const tel = phone(b.phone);
  const email = String(b.customer_email ?? '').trim().toLowerCase();
  const name = String(b.customer_name ?? 'Customer').trim() || 'Customer';
  const [datePart, slotPart] = String(b.date_time ?? '').split(' | ');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(datePart ?? '') ? datePart : new Date().toISOString().slice(0, 10);
  const details = String(b.vehicle_details ?? '');
  const regMatch = /\(([A-Z0-9 ]{2,10})\)\s*$/i.exec(details);
  const reg = (regMatch?.[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || `LEGACY${b.id ?? count}`;
  const desc = details.replace(/\([^)]*\)\s*$/, '').trim();
  const [make, ...model] = desc.split(' ');
  const ref = String(b.booking_ref || `S1-OLD${b.id ?? count}`).toUpperCase();
  const total = pence(b.price);
  const custMatch = tel ? `phone = ${q(tel)}` : email ? `email = ${q(email)}` : `name = ${q(name)}`;
  const status = statusOf(b.status);
  const paid = status === 'completed' ? total : 0;

  lines.push(`-- ${ref}`);
  lines.push(`INSERT INTO customers (name, email, phone, address) SELECT ${q(name)}, ${q(email)}, ${q(tel)}, ${q(b.address)} WHERE NOT EXISTS (SELECT 1 FROM customers WHERE ${custMatch});`);
  lines.push(`INSERT INTO vehicles (customer_id, reg, make, model, size) SELECT (SELECT id FROM customers WHERE ${custMatch} ORDER BY id LIMIT 1), ${q(reg)}, ${q(make ?? '')}, ${q(model.join(' '))}, '${sizeOf(b.vehicle_size)}' WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE reg = ${q(reg)});`);
  lines.push(`INSERT INTO bookings (ref, access_token, customer_id, status, source, date, slot, service_mode, address, subtotal, total, paid_amount, payment_status, customer_notes, internal_notes, created_at) SELECT ${q(ref)}, ${q(randomBytes(24).toString('base64url'))}, (SELECT id FROM customers WHERE ${custMatch} ORDER BY id LIMIT 1), '${status}', 'admin', ${q(date)}, '${slotOf(slotPart)}', ${/drop/i.test(String(b.service_mode ?? '')) ? "'drop_off'" : "'mobile'"}, ${q(b.address)}, ${total}, ${total}, ${paid}, '${paid ? 'paid' : 'unpaid'}', ${q(b.notes)}, 'Imported from the previous system', ${q(`${date}T09:00:00Z`)} WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE ref = ${q(ref)});`);
  lines.push(`INSERT INTO booking_vehicles (booking_id, vehicle_id, size) SELECT (SELECT id FROM bookings WHERE ref = ${q(ref)}), (SELECT id FROM vehicles WHERE reg = ${q(reg)} ORDER BY id DESC LIMIT 1), '${sizeOf(b.vehicle_size)}' WHERE NOT EXISTS (SELECT 1 FROM booking_vehicles WHERE booking_id = (SELECT id FROM bookings WHERE ref = ${q(ref)}));`);
  lines.push(`INSERT INTO booking_items (booking_id, kind, name, qty, unit_price) SELECT (SELECT id FROM bookings WHERE ref = ${q(ref)}), 'custom', ${q(b.service || 'Imported service')}, 1, ${total} WHERE NOT EXISTS (SELECT 1 FROM booking_items WHERE booking_id = (SELECT id FROM bookings WHERE ref = ${q(ref)}));`);
  lines.push('');
  count++;
}
await writeFile(output, lines.join('\n'));
console.log(`Wrote ${output} with ${count} booking(s). Apply it with:\n  npx wrangler d1 execute DB --remote --file ${output}`);
