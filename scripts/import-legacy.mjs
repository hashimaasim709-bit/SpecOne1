// Import customers, vehicles and bookings from the previous SpecOne system.
//
// Easiest: GitHub → Actions → "Import old bookings" → Run workflow (see docs/DEPLOY.md).
//
// By hand, straight from the old site's D1 database in the same Cloudflare account:
//   node scripts/import-legacy.mjs --d1 <old-database-name> legacy-import.sql
// or from the JSON the old site's /api/admin/cloud-backup page downloads:
//   node scripts/import-legacy.mjs specone-cloud-d1-backup.json legacy-import.sql
// then apply it to the new database:
//   npx wrangler d1 execute DB --remote --file legacy-import.sql
//
// The import is idempotent: bookings are matched on their old reference, customers on
// phone/email and vehicles on registration, so running it twice does not duplicate data.
// The old database is only read, never changed.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const fromD1 = args[0] === '--d1' ? args[1] : null;
const [input, output = 'legacy-import.sql'] = fromD1 ? [null, args[2]] : args;
if (!fromD1 && !input) {
  console.error('Usage: node scripts/import-legacy.mjs <old-backup.json> [output.sql]\n   or: node scripts/import-legacy.mjs --d1 <old-database-name> [output.sql]');
  process.exit(1);
}

/** Run a read-only query against a remote D1 database through Wrangler and return its rows. */
function d1Query(database, sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed.flatMap((r) => r.results ?? []);
}

// Only the columns the import uses (older versions of the old site lack some of them, and
// photo columns can be large), so ask the old table which ones it has first.
const WANTED = ['id', 'booking_ref', 'customer_name', 'customer_email', 'phone', 'address', 'vehicle_size', 'vehicle_details', 'service', 'price', 'date_time', 'notes', 'status', 'service_mode'];
const columnsOf = (database) => new Set(d1Query(database, 'PRAGMA table_info(bookings)').map((c) => c.name));
const looksLikeOldSite = (cols) => cols.has('date_time') && cols.has('vehicle_details') && cols.has('customer_name');

/** `--d1 auto`: find the previous site's database among the account's D1 databases. */
async function detectOldDatabase() {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const current = /"database_name"\s*:\s*"([^"]+)"/.exec(config)?.[1];
  const listOut = execFileSync('npx', ['wrangler', 'd1', 'list', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const all = JSON.parse(listOut.slice(listOut.indexOf('['))).map((d) => d.name).filter((n) => n && n !== current);
  const found = [];
  for (const name of all) {
    try {
      if (looksLikeOldSite(columnsOf(name))) found.push(name);
    } catch {
      /* not readable or not the old site — skip */
    }
  }
  if (found.length === 1) {
    console.log(`Found the previous site's database: ${found[0]}`);
    return found[0];
  }
  console.error(found.length
    ? `More than one database looks like the previous site: ${found.join(', ')}. Run again and type the right name.`
    : `No database with the previous site's bookings was found (checked: ${all.join(', ') || 'none'}). Run again and type its name.`);
  process.exit(1);
}

let bookings;
let source = input;
if (fromD1) {
  const database = fromD1 === 'auto' ? await detectOldDatabase() : fromD1;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(database)) {
    console.error(`"${database}" does not look like a D1 database name.`);
    process.exit(1);
  }
  const have = columnsOf(database);
  if (!looksLikeOldSite(have)) {
    console.error(`The database "${database}" has no bookings from the previous site. Check the name in Cloudflare → Storage & Databases → D1.`);
    process.exit(1);
  }
  source = `D1 database ${database}`;
  bookings = d1Query(database, `SELECT ${WANTED.filter((c) => have.has(c)).join(', ')} FROM bookings ORDER BY id`);
} else {
  const raw = JSON.parse(await readFile(input, 'utf8'));
  // Accepts the old site's backup JSON, a plain array of rows, or `wrangler d1 execute --json` output.
  bookings = Array.isArray(raw) ? (raw[0] && Array.isArray(raw[0].results) ? raw.flatMap((r) => r.results ?? []) : raw) : raw.bookings ?? raw.tables?.bookings ?? [];
}

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

const lines = ['-- SpecOne legacy import', `-- Source: ${source}`, `-- Generated: ${new Date().toISOString()}`, ''];
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
