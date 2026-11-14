// Generic CRUD for every admin-managed table, driven by shared/resources.ts.
// Only declared columns can be read or written, values are coerced to their declared type,
// identifiers come from the static definitions, and every value is a bound parameter.
import { Hono } from 'hono';
import { can } from '../../shared/constants';
import { isIsoDate, slugify, todayIn } from '../../shared/format';
import { optionValue, RESOURCE_MAP, type Field, type Resource } from '../../shared/resources';
import type { AppEnv, Ctx } from '../env';
import { audit, diff, staffOrFail } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { all, first, likeTerm, parseJson, run, stmt } from '../lib/db';
import { intQuery, noStore } from '../lib/http';
import { fail } from '../lib/security';
import { getSettings } from '../lib/settings';
import { analyseReview } from '../services/sentiment';
import { isSafeWebhookUrl } from '../services/webhooks';

export const resourceRoutes = new Hono<AppEnv>();

const JSON_TYPES = new Set(['list', 'rows', 'sections', 'weekdays', 'slotset', 'months', 'multiselect']);

function resourceOrFail(c: Ctx, mode: 'read' | 'write'): Resource {
  const res = RESOURCE_MAP[c.req.param('resource') ?? ''];
  if (!res) fail(404, 'Unknown section.');
  staffOrFail(c, mode === 'read' ? res!.read : res!.write);
  return res!;
}

const hiddenFor = (c: Ctx, res: Resource): Set<string> => new Set(can(c.get('staff')?.role, 'finance.read') ? [] : res.financeFields ?? []);

function toClient(res: Resource, row: Record<string, unknown>, hidden: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = { [res.pk]: row[res.pk] };
  for (const f of res.fields) {
    if (hidden.has(f.key)) continue;
    out[f.key] = JSON_TYPES.has(f.type) ? parseJson(row[f.key], f.type === 'rows' || f.type === 'sections' || f.type === 'list' || f.type === 'multiselect' ? [] : []) : row[f.key];
  }
  if ('created_at' in row) out.created_at = row.created_at;
  return out;
}

function coerce(f: Field, value: unknown, today: string): unknown {
  const empty = value === undefined || value === null || value === '';
  const def = f.def === 'today' ? today : f.def;
  const label = f.label;
  switch (f.type) {
    case 'int': case 'money': case 'percent': case 'media': {
      if (empty) {
        if (def !== undefined) return typeof def === 'boolean' ? Number(def) : def;
        if (f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
        return null;
      }
      const n = Number(value);
      if (!Number.isFinite(n)) fail(422, `${label} must be a number.`, { [f.key]: 'Must be a number.' });
      if (f.type === 'percent' && (n < 0 || n > 100)) fail(422, `${label} must be between 0 and 100.`, { [f.key]: '0–100.' });
      return Math.round(n);
    }
    case 'number': {
      if (empty) {
        if (def !== undefined) return def;
        if (f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
        return null;
      }
      const n = Number(value);
      if (!Number.isFinite(n)) fail(422, `${label} must be a number.`, { [f.key]: 'Must be a number.' });
      return n;
    }
    case 'bool':
      return empty ? (def ? 1 : 0) : value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
    case 'date':
      if (empty) {
        if (def) return def;
        if (f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
        return null;
      }
      if (!isIsoDate(value)) fail(422, `${label} must be a valid date.`, { [f.key]: 'Invalid date.' });
      return value;
    case 'select': {
      const v = empty ? String(def ?? '') : String(value);
      const allowed = (f.options ?? []).map(optionValue);
      if (v && !allowed.includes(v)) fail(422, `${label}: choose one of the listed options.`, { [f.key]: 'Invalid option.' });
      if (!v && f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
      return v;
    }
    case 'list': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split('\n');
      return JSON.stringify(arr.map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 60));
    }
    case 'multiselect': {
      if (f.optionsFrom) {
        const picked = (Array.isArray(value) ? value : []).map(String).filter((v) => /^[a-z0-9-]{1,60}$/.test(v));
        return JSON.stringify([...new Set(picked)].slice(0, 20));
      }
      const allowed = (f.options ?? []).map(optionValue);
      const arr = (Array.isArray(value) ? value : []).map(String).filter((v) => allowed.includes(v));
      return JSON.stringify(arr.length ? arr : def !== undefined ? [String(def)] : ['*']);
    }
    case 'weekdays': case 'months': {
      const [lo, hi] = f.type === 'weekdays' ? [0, 6] : [1, 12];
      const arr = (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi);
      return JSON.stringify([...new Set(arr)].sort((a, b) => a - b));
    }
    case 'slotset': {
      const arr = (Array.isArray(value) ? value : []).map(String).filter((s) => ['morning', 'afternoon', 'evening'].includes(s));
      return JSON.stringify([...new Set(arr)]);
    }
    case 'rows': {
      const cols = f.columns ?? [];
      const rows = (Array.isArray(value) ? value : []).slice(0, 100).map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        return Object.fromEntries(cols.map((col) => [col.key, col.type === 'number' || col.type === 'money' ? (row[col.key] === '' || row[col.key] == null ? null : Number(row[col.key])) : String(row[col.key] ?? '').slice(0, 300)]));
      }).filter((r) => Object.values(r).some((v) => v !== '' && v !== null));
      return JSON.stringify(rows);
    }
    case 'sections': {
      const sections = (Array.isArray(value) ? value : []).slice(0, 30).map((s) => {
        const sec = (s ?? {}) as { title?: unknown; items?: unknown };
        return { title: String(sec.title ?? '').slice(0, 120), items: (Array.isArray(sec.items) ? sec.items : []).map((i) => String(i).trim().slice(0, 200)).filter(Boolean).slice(0, 80) };
      }).filter((s) => s.title || s.items.length);
      return JSON.stringify(sections);
    }
    case 'url': {
      const v = empty ? '' : String(value).trim();
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) fail(422, `${label} must be a full https:// link.`, { [f.key]: 'Must start with https://' });
      if (!v && f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
      return v.slice(0, 500);
    }
    case 'color': {
      const v = empty ? String(def ?? '') : String(value).trim();
      if (v && !/^#[0-9a-f]{6}$/i.test(v)) fail(422, `${label} must be a hex colour like #e11d48.`, { [f.key]: 'Invalid colour.' });
      return v;
    }
    default: {
      let v = empty ? String(def ?? '') : String(value).trim();
      if (f.upper) v = v.toUpperCase();
      if (f.key === 'slug') v = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (!v && f.required) fail(422, `${label} is required.`, { [f.key]: 'Required.' });
      const max = f.type === 'markdown' ? 20000 : f.type === 'textarea' ? 4000 : 300;
      return v.slice(0, max);
    }
  }
}

function buildValues(res: Resource, body: Record<string, unknown>, creating: boolean, hidden: Set<string>, today: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of res.fields) {
    if (hidden.has(f.key)) continue;
    if (!creating && f.lockOnEdit) continue;
    if (!creating && !(f.key in body)) continue;
    values[f.key] = coerce(f, body[f.key], today);
  }
  // Resource-specific normalisation.
  if (res.key === 'packages' || res.key === 'plans') values.slug &&= slugify(String(values.slug));
  if ((res.key === 'towns' || res.key === 'fleet_portals' || res.key === 'guides') && creating) values.slug = slugify(String(values.slug ?? ''));
  if (res.key === 'promo_codes' || res.key === 'partners') values.code &&= String(values.code).replace(/[^A-Z0-9-]/g, '');
  if (res.key === 'vehicles' || res.key.endsWith('_logs') || ['battery_tests', 'flash_log', 'freeze_frames', 'parts_requests'].includes(res.key)) {
    for (const k of ['reg', 'vehicle_reg']) if (typeof values[k] === 'string') values[k] = String(values[k]).replace(/[^A-Z0-9]/g, '');
  }
  if (res.key === 'reviews' && values.rating != null && (Number(values.rating) < 1 || Number(values.rating) > 5)) fail(422, 'Rating must be 1 to 5.', { rating: '1–5.' });
  if (res.key === 'webhooks') {
    if (values.url !== undefined && !isSafeWebhookUrl(String(values.url))) fail(422, 'Webhook URL must be a public https:// address.', { url: 'Invalid URL.' });
    if (creating || values.secret === '') values.secret = values.secret || `whsec_${randomToken(24)}`;
  }
  return values;
}

resourceRoutes.get('/:resource', async (c) => {
  noStore(c);
  const res = resourceOrFail(c, 'read');
  const hidden = hiddenFor(c, res);
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const filter = (c.req.query('filter') ?? '').trim().slice(0, 60);
  const page = intQuery(c, 'page', 1, 1, 10000);
  const size = intQuery(c, 'size', 50, 1, 500);
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (q && res.search.length) {
    where.push(`(${res.search.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    res.search.forEach(() => binds.push(likeTerm(q)));
  }
  if (filter && res.filter) {
    where.push(`${res.filter} = ?`);
    binds.push(filter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    all(c.env.DB, `SELECT * FROM ${res.table} ${whereSql} ORDER BY ${res.orderBy} LIMIT ? OFFSET ?`, ...binds, size, (page - 1) * size),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM ${res.table} ${whereSql}`, ...binds),
  ]);
  return c.json({ rows: rows.map((r) => toClient(res, r, hidden)), total: count?.n ?? 0, page, size });
});

resourceRoutes.get('/:resource/:id', async (c) => {
  noStore(c);
  const res = resourceOrFail(c, 'read');
  const row = await first(c.env.DB, `SELECT * FROM ${res.table} WHERE ${res.pk} = ?`, c.req.param('id'));
  if (!row) fail(404, `That ${res.singular} no longer exists.`);
  return c.json({ row: toClient(res, row!, hiddenFor(c, res)) });
});

async function afterSave(c: Ctx, res: Resource, values: Record<string, unknown>, id: string | number, creating: boolean): Promise<void> {
  const db = c.env.DB;
  const mediaIds = res.fields.filter((f) => f.type === 'media').map((f) => values[f.key]).filter((v): v is number => typeof v === 'number');
  if (mediaIds.length) {
    const visibility = res.key === 'wiring_refs' ? 'private' : 'public';
    await db.batch(mediaIds.map((m) => stmt(db, 'UPDATE media SET attached = 1, visibility = ? WHERE id = ?', visibility, m)));
  }
  if (res.key === 'expenses' && creating && values.inventory_id) {
    await run(db, "UPDATE inventory SET stock = MAX(0, stock - ?), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", Number(values.qty ?? 1), Number(values.inventory_id));
  }
  if (res.key === 'reviews' && ('body' in values || 'rating' in values)) {
    const row = await first<{ body: string; rating: number }>(db, 'SELECT body, rating FROM reviews WHERE id = ?', id);
    if (row) c.executionCtx.waitUntil(analyseReview(c.env, Number(id), row.body, row.rating).then(() => undefined));
  }
}

resourceRoutes.post('/:resource', async (c) => {
  const res = resourceOrFail(c, 'write');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') fail(400, 'Invalid request.');
  const settings = await getSettings(c.env.DB);
  const values = buildValues(res, body!, true, hiddenFor(c, res), todayIn(settings.business.timezone));
  if (res.pkType === 'text' && !values[res.pk]) fail(422, `${res.fields.find((f) => f.key === res.pk)?.label ?? 'Key'} is required.`, { [res.pk]: 'Required.' });
  // Omit nulls so column defaults apply.
  const cols = Object.keys(values).filter((k) => values[k] !== null);
  const result = await run(c.env.DB, `INSERT INTO ${res.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...(cols.map((k) => values[k]) as (string | number)[]));
  const id = res.pkType === 'text' ? String(values[res.pk]) : result.id;
  await afterSave(c, res, values, id, true);
  await audit(c, 'create', res.key, id, `Created ${res.singular} ${String(values.name ?? values.title ?? values.code ?? values.reg ?? values.description ?? id)}`.slice(0, 200), values);
  const row = await first(c.env.DB, `SELECT * FROM ${res.table} WHERE ${res.pk} = ?`, id);
  return c.json({ ok: true, row: toClient(res, row!, hiddenFor(c, res)) }, 201);
});

resourceRoutes.patch('/:resource/:id', async (c) => {
  const res = resourceOrFail(c, 'write');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') fail(400, 'Invalid request.');
  const before = await first(c.env.DB, `SELECT * FROM ${res.table} WHERE ${res.pk} = ?`, id);
  if (!before) fail(404, `That ${res.singular} no longer exists.`);
  const settings = await getSettings(c.env.DB);
  const values = buildValues(res, body!, false, hiddenFor(c, res), todayIn(settings.business.timezone));
  const cols = Object.keys(values);
  if (cols.length) await run(c.env.DB, `UPDATE ${res.table} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE ${res.pk} = ?`, ...(cols.map((k) => values[k]) as (string | number | null)[]), id);
  await afterSave(c, res, values, id, false);
  const changes = diff(before, values);
  if (res.key === 'webhooks') delete changes.secret;
  if (Object.keys(changes).length) await audit(c, 'update', res.key, id, `Updated ${res.singular} ${String(before!.name ?? before!.title ?? before!.code ?? before!.reg ?? id)}: ${Object.keys(changes).join(', ')}`.slice(0, 300), changes);
  const row = await first(c.env.DB, `SELECT * FROM ${res.table} WHERE ${res.pk} = ?`, id);
  return c.json({ ok: true, row: toClient(res, row!, hiddenFor(c, res)) });
});

resourceRoutes.delete('/:resource/:id', async (c) => {
  const res = resourceOrFail(c, 'write');
  const id = c.req.param('id');
  const before = await first(c.env.DB, `SELECT * FROM ${res.table} WHERE ${res.pk} = ?`, id);
  if (!before) return c.json({ ok: true });
  if (res.key === 'locations' && Number(id) === 1) fail(409, 'The main location cannot be deleted.');
  await run(c.env.DB, `DELETE FROM ${res.table} WHERE ${res.pk} = ?`, id);
  await audit(c, 'delete', res.key, id, `Deleted ${res.singular} ${String(before.name ?? before.title ?? before.code ?? before.reg ?? id)}`.slice(0, 200), res.key === 'webhooks' ? {} : before);
  return c.json({ ok: true });
});
