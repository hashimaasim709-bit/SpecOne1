// Sessions, cookies, permission guards and the audit trail.
//
// Session cookies carry only a random 256-bit token. The database stores its SHA-256
// hash, so a leaked database cannot be replayed as a login, and every session can be
// revoked server-side. Cookies are HttpOnly + Secure + SameSite=Lax.
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { can, type Permission, type Role } from '../../shared/constants';
import type { AppEnv, Ctx, CustomerSession, StaffSession } from '../env';
import { isDev } from '../env';
import { randomToken, sha256Hex } from './crypto';
import { first, inMinutes, nowIso, run, stmt } from './db';
import { fail } from './security';

const COOKIES = { staff: 's1_staff', customer: 's1_cust' } as const;
type Kind = keyof typeof COOKIES;

const cookieOptions = (c: Ctx, maxAge: number) => ({
  httpOnly: true,
  secure: !isDev(c.env) || new URL(c.req.url).protocol === 'https:',
  sameSite: 'Lax' as const,
  path: '/',
  maxAge,
});

export async function createSession(c: Ctx, kind: Kind, subjectId: number, days: number): Promise<void> {
  const token = randomToken(32);
  const maxAge = days * 86400;
  await stmt(
    c.env.DB,
    'INSERT INTO sessions (id, kind, subject_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    await sha256Hex(token), kind, subjectId, c.get('ip'), (c.req.header('User-Agent') ?? '').slice(0, 250), inMinutes(days * 1440),
  ).run();
  setCookie(c, COOKIES[kind], token, cookieOptions(c, maxAge));
}

export async function destroySession(c: Ctx, kind: Kind): Promise<void> {
  const token = getCookie(c, COOKIES[kind]);
  if (token) await stmt(c.env.DB, 'DELETE FROM sessions WHERE id = ?', await sha256Hex(token)).run();
  deleteCookie(c, COOKIES[kind], { path: '/' });
}

export async function revokeSessions(db: D1Database, kind: Kind, subjectId: number, exceptId?: string): Promise<void> {
  await stmt(db, 'DELETE FROM sessions WHERE kind = ? AND subject_id = ? AND id <> ?', kind, subjectId, exceptId ?? '').run();
}

async function touch(db: D1Database, id: string, lastSeen: string): Promise<void> {
  if (Date.now() - Date.parse(lastSeen) > 5 * 60_000) await stmt(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), id).run();
}

/** Resolve the staff and customer sessions (if any) for this request. */
export const loadSessions: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('staff', null);
  c.set('customer', null);
  const staffToken = getCookie(c, COOKIES.staff);
  const customerToken = getCookie(c, COOKIES.customer);
  const now = nowIso();

  if (staffToken) {
    const id = await sha256Hex(staffToken);
    const row = await first<{ locked: number; last_seen_at: string; uid: number; name: string; email: string; role: Role }>(
      c.env.DB,
      `SELECT s.locked, s.last_seen_at, u.id AS uid, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.subject_id
       WHERE s.id = ? AND s.kind = 'staff' AND s.expires_at > ? AND u.active = 1`,
      id, now,
    );
    if (row) {
      c.set('staff', { sessionId: id, id: row.uid, name: row.name, email: row.email, role: row.role, locked: !!row.locked });
      c.executionCtx.waitUntil(touch(c.env.DB, id, row.last_seen_at));
    }
  }
  if (customerToken) {
    const id = await sha256Hex(customerToken);
    const row = await first<{ last_seen_at: string; cid: number; name: string; email: string; phone: string }>(
      c.env.DB,
      `SELECT s.last_seen_at, cu.id AS cid, cu.name, cu.email, cu.phone
       FROM sessions s JOIN customers cu ON cu.id = s.subject_id
       WHERE s.id = ? AND s.kind = 'customer' AND s.expires_at > ?`,
      id, now,
    );
    if (row) {
      c.set('customer', { sessionId: id, id: row.cid, name: row.name, email: row.email, phone: row.phone });
      c.executionCtx.waitUntil(touch(c.env.DB, id, row.last_seen_at));
    }
  }
  return next();
};

/** Require a signed-in, unlocked member of staff — optionally holding a permission. */
export function requireStaff(permission?: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    staffOrFail(c, permission);
    return next();
  };
}

export function staffOrFail(c: Ctx, permission?: Permission): StaffSession {
  const staff = c.get('staff');
  if (!staff) return fail(401, 'Please sign in.');
  if (staff.locked) return fail(423, 'Session locked — unlock to continue.');
  if (permission && !can(staff.role, permission)) return fail(403, 'Your role does not have access to this.');
  return staff;
}

export function customerOrFail(c: Ctx): CustomerSession {
  const customer = c.get('customer');
  if (!customer) return fail(401, 'Please sign in to your account.');
  return customer;
}

export const hasPermission = (c: Ctx, permission: Permission): boolean => can(c.get('staff')?.role, permission);

/**
 * Append to the immutable audit trail. Database triggers reject any UPDATE or DELETE on
 * this table, so entries cannot be altered after the fact — even by an owner.
 */
export async function audit(
  c: Ctx,
  action: string,
  entity: string,
  entityId: string | number,
  summary: string,
  changes: Record<string, unknown> = {},
  actor?: { type: string; id: number | null; name: string },
): Promise<void> {
  const staff = c.get('staff');
  const customer = c.get('customer');
  const who = actor ?? (staff ? { type: 'staff', id: staff.id, name: staff.name } : customer ? { type: 'customer', id: customer.id, name: customer.name } : { type: 'public', id: null, name: 'Website visitor' });
  await run(
    c.env.DB,
    'INSERT INTO audit_log (actor_type, actor_id, actor_name, action, entity, entity_id, summary, changes, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    who.type, who.id, who.name, action, entity, String(entityId), summary.slice(0, 500), JSON.stringify(changes).slice(0, 8000), c.get('ip'),
  );
}

/** System-initiated audit entries (cron jobs, webhooks) that have no request context. */
export async function auditSystem(db: D1Database, action: string, entity: string, entityId: string | number, summary: string, changes: Record<string, unknown> = {}): Promise<void> {
  await run(
    db,
    "INSERT INTO audit_log (actor_type, actor_id, actor_name, action, entity, entity_id, summary, changes) VALUES ('system', NULL, 'System', ?, ?, ?, ?, ?)",
    action, entity, String(entityId), summary.slice(0, 500), JSON.stringify(changes).slice(0, 8000),
  );
}

/** Field-level diff for audit entries: { field: [before, after] } for values that changed. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(after)) {
    const prev = before?.[k];
    if (String(prev ?? '') !== String(v ?? '')) out[k] = [prev ?? null, v ?? null];
  }
  return out;
}
