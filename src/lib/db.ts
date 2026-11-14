// Thin, typed helpers over D1. Every query in the codebase goes through prepared
// statements with bound parameters — user input is never concatenated into SQL.
import migrations from '../generated/migrations.json';

type Bind = string | number | boolean | null | undefined | ArrayBuffer | Uint8Array;

const norm = (v: Bind): string | number | null | ArrayBuffer | Uint8Array => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function stmt(db: D1Database, sql: string, ...binds: Bind[]): D1PreparedStatement {
  const s = db.prepare(sql);
  return binds.length ? s.bind(...binds.map(norm)) : s;
}

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: Bind[]): Promise<T[]> {
  const { results } = await stmt(db, sql, ...binds).all<T>();
  return results ?? [];
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: Bind[]): Promise<T | null> {
  return (await stmt(db, sql, ...binds).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...binds: Bind[]): Promise<{ id: number; changes: number }> {
  const res = await stmt(db, sql, ...binds).run();
  return { id: Number(res.meta?.last_row_id ?? 0), changes: Number(res.meta?.changes ?? 0) };
}

export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const inMinutes = (minutes: number): string => new Date(Date.now() + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Safe JSON parse for TEXT columns holding JSON. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Escape LIKE wildcards in a user-supplied search term. Use with `LIKE ? ESCAPE '\'`. */
export const likeTerm = (term: string): string => `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

// ── Self-applying migrations ──
// The SQL files in /migrations are compiled into the bundle at build time. On the first
// request after a deploy the Worker applies any that are missing, recording them in the
// same `d1_migrations` table that `wrangler d1 migrations apply` uses, so both routes agree.
let ready: Promise<void> | null = null;

async function migrate(db: D1Database): Promise<void> {
  let applied: Set<string>;
  try {
    applied = new Set((await all<{ name: string }>(db, 'SELECT name FROM d1_migrations')).map((r) => r.name));
  } catch {
    await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
    applied = new Set();
  }
  for (const m of migrations as { name: string; statements: string[] }[]) {
    if (applied.has(m.name)) continue;
    await db.batch([...m.statements.map((s) => db.prepare(s)), db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(m.name)]);
  }
}

export function ensureDatabase(db: D1Database, seed: (db: D1Database) => Promise<void>): Promise<void> {
  ready ??= (async () => {
    await migrate(db);
    await seed(db);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
