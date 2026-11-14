// Staff authentication: first-owner setup, password sign-in, passkeys (Face ID / fingerprint /
// device PIN via WebAuthn) and the quick-lock screen that guards an idle admin session.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { ROLE_PERMISSIONS } from '../../shared/constants';
import type { AppEnv, Ctx } from '../env';
import { isDev } from '../env';
import { audit, createSession, destroySession, revokeSessions, staffOrFail } from '../lib/auth';
import { fromBase64Url, hashPassword, passwordProblem, randomToken, timingSafeEqual, toBase64Url, verifyPassword } from '../lib/crypto';
import { all, first, inMinutes, nowIso, run } from '../lib/db';
import { intParam, noStore, readJson } from '../lib/http';
import { fail, rateLimit } from '../lib/security';
import { getSettings } from '../lib/settings';

export const authRoutes = new Hono<AppEnv>();

const rp = (c: Ctx) => {
  const url = new URL(c.req.url);
  return { id: url.hostname, origin: url.origin };
};

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: keyof typeof ROLE_PERMISSIONS;
  password_hash: string;
  active: number;
}

authRoutes.get('/state', async (c) => {
  noStore(c);
  const db = c.env.DB;
  const users = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users');
  const staff = c.get('staff');
  const settings = await getSettings(db);
  const passkeys = staff ? await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', staff.id) : null;
  return c.json({
    setupRequired: (users?.n ?? 0) === 0,
    setupNeedsToken: !isDev(c.env),
    setupTokenConfigured: !!c.env.SETUP_TOKEN,
    user: staff ? { id: staff.id, name: staff.name, email: staff.email, role: staff.role, permissions: ROLE_PERMISSIONS[staff.role] } : null,
    locked: staff?.locked ?? false,
    passkeys: passkeys?.n ?? 0,
    autoLockMinutes: settings.security.autoLockMinutes,
    businessName: settings.business.name,
  });
});

authRoutes.post('/setup', async (c) => {
  await rateLimit(c, 'setup', 5, 3600);
  const input = await readJson(c, z.object({
    token: z.string().max(200).default(''),
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(200),
  }));
  const db = c.env.DB;
  if (((await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users'))?.n ?? 0) > 0) fail(409, 'Setup has already been completed. Please sign in.');
  if (!isDev(c.env)) {
    if (!c.env.SETUP_TOKEN) fail(403, 'Set the SETUP_TOKEN secret on the Worker first (see docs/DEPLOY.md), then enter it here.');
    if (!timingSafeEqual(input.token, c.env.SETUP_TOKEN!)) fail(403, 'That setup token is not correct.');
  }
  const problem = passwordProblem(input.password);
  if (problem) fail(422, problem, { password: problem });
  // INSERT … SELECT … WHERE NOT EXISTS keeps this safe if two setup requests race.
  const res = await run(db, "INSERT INTO users (email, name, role, password_hash) SELECT ?, ?, 'owner', ? WHERE NOT EXISTS (SELECT 1 FROM users)", input.email, input.name, await hashPassword(input.password));
  if (!res.changes) fail(409, 'Setup has already been completed. Please sign in.');
  await createSession(c, 'staff', res.id, (await getSettings(db)).security.sessionDays);
  await audit(c, 'setup', 'user', res.id, `Owner account created for ${input.email}`, {}, { type: 'staff', id: res.id, name: input.name });
  return c.json({ ok: true });
});

authRoutes.post('/login', async (c) => {
  await rateLimit(c, 'staff-login', 10, 900);
  const input = await readJson(c, z.object({ email: z.string().trim().toLowerCase().max(120), password: z.string().min(1).max(200) }));
  await rateLimit(c, 'staff-login-account', 8, 900, input.email);
  const db = c.env.DB;
  const user = await first<UserRow>(db, 'SELECT id, name, email, role, password_hash, active FROM users WHERE email = ?', input.email);
  // Verify against a dummy hash when the account doesn't exist so timing reveals nothing.
  const ok = await verifyPassword(input.password, user?.password_hash || 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!user || !ok || !user.active) {
    if (user) await audit(c, 'login_failed', 'user', user.id, `Failed sign-in for ${input.email}`, {}, { type: 'public', id: null, name: 'Unknown' });
    fail(401, 'Email or password is incorrect.');
  }
  await destroySession(c, 'staff');
  await createSession(c, 'staff', user!.id, (await getSettings(db)).security.sessionDays);
  await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user!.id);
  await audit(c, 'login', 'user', user!.id, 'Signed in with password', {}, { type: 'staff', id: user!.id, name: user!.name });
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const staff = c.get('staff');
  if (staff) await audit(c, 'logout', 'user', staff.id, 'Signed out');
  await destroySession(c, 'staff');
  return c.json({ ok: true });
});

authRoutes.post('/lock', async (c) => {
  const staff = c.get('staff');
  if (staff) await run(c.env.DB, 'UPDATE sessions SET locked = 1 WHERE id = ?', staff.sessionId);
  return c.json({ ok: true });
});

authRoutes.post('/unlock', async (c) => {
  await rateLimit(c, 'unlock', 10, 900);
  const staff = c.get('staff');
  if (!staff) fail(401, 'Please sign in.');
  const { password } = await readJson(c, z.object({ password: z.string().min(1).max(200) }));
  const user = await first<UserRow>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', staff!.id);
  if (!user || !(await verifyPassword(password, user.password_hash))) fail(401, 'Password is incorrect.');
  await run(c.env.DB, 'UPDATE sessions SET locked = 0 WHERE id = ?', staff!.sessionId);
  return c.json({ ok: true });
});

authRoutes.post('/password', async (c) => {
  await rateLimit(c, 'password-change', 6, 900);
  const staff = staffOrFail(c);
  const input = await readJson(c, z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }));
  const user = await first<UserRow>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', staff.id);
  if (!user || !(await verifyPassword(input.current, user.password_hash))) fail(401, 'Your current password is incorrect.', { current: 'Incorrect.' });
  const problem = passwordProblem(input.next);
  if (problem) fail(422, problem, { next: problem });
  await run(c.env.DB, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(input.next), staff.id);
  await revokeSessions(c.env.DB, 'staff', staff.id, staff.sessionId);
  await audit(c, 'password_change', 'user', staff.id, 'Changed password and signed out other devices');
  return c.json({ ok: true });
});

// ── Passkeys ──
authRoutes.get('/passkeys', async (c) => {
  const staff = staffOrFail(c);
  return c.json({ passkeys: await all(c.env.DB, 'SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id', staff.id) });
});

authRoutes.delete('/passkeys/:id', async (c) => {
  const staff = staffOrFail(c);
  const id = intParam(c, 'id');
  await run(c.env.DB, 'DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, staff.id);
  await audit(c, 'delete', 'passkey', id, 'Removed a passkey');
  return c.json({ ok: true });
});

authRoutes.post('/passkeys/register/options', async (c) => {
  const staff = staffOrFail(c);
  const settings = await getSettings(c.env.DB);
  const existing = await all<{ credential_id: string; transports: string }>(c.env.DB, 'SELECT credential_id, transports FROM passkeys WHERE user_id = ?', staff.id);
  const options = await generateRegistrationOptions({
    rpName: settings.business.name,
    rpID: rp(c).id,
    userName: staff.email,
    userDisplayName: staff.name,
    userID: new Uint8Array(new TextEncoder().encode(`staff-${staff.id}`)),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: JSON.parse(p.transports || '[]') as string[] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  const id = randomToken(18);
  await run(c.env.DB, "INSERT INTO auth_challenges (id, purpose, challenge, subject, expires_at) VALUES (?, 'passkey_register', ?, ?, ?)", id, options.challenge, String(staff.id), inMinutes(5));
  return c.json({ challengeId: id, options });
});

authRoutes.post('/passkeys/register/verify', async (c) => {
  const staff = staffOrFail(c);
  const input = await readJson(c, z.object({ challengeId: z.string().max(64), name: z.string().trim().max(60).default('This device'), response: z.custom<RegistrationResponseJSON>((v) => !!v && typeof v === 'object') }));
  const row = await first<{ challenge: string; subject: string }>(c.env.DB, "SELECT challenge, subject FROM auth_challenges WHERE id = ? AND purpose = 'passkey_register' AND expires_at > ?", input.challengeId, nowIso());
  if (!row || Number(row.subject) !== staff.id) fail(400, 'Passkey set-up timed out — please try again.');
  await run(c.env.DB, 'DELETE FROM auth_challenges WHERE id = ?', input.challengeId);
  const result = await verifyRegistrationResponse({ response: input.response, expectedChallenge: row!.challenge, expectedOrigin: rp(c).origin, expectedRPID: rp(c).id, requireUserVerification: true }).catch(() => null);
  const info = result?.verified ? result.registrationInfo : null;
  if (!info) fail(400, 'This device could not be registered.');
  const cred = info!.credential;
  await run(c.env.DB, 'INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)', staff.id, cred.id, toBase64Url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), input.name || 'This device');
  await audit(c, 'create', 'passkey', cred.id.slice(0, 16), `Registered passkey "${input.name}"`);
  return c.json({ ok: true });
});

/** Passkey sign-in, and passkey unlock of a locked session. */
authRoutes.post('/passkeys/login/options', async (c) => {
  await rateLimit(c, 'passkey-options', 30, 900);
  const staff = c.get('staff');
  const allow = staff ? await all<{ credential_id: string; transports: string }>(c.env.DB, 'SELECT credential_id, transports FROM passkeys WHERE user_id = ?', staff.id) : [];
  const options = await generateAuthenticationOptions({
    rpID: rp(c).id,
    userVerification: 'required',
    allowCredentials: allow.map((p) => ({ id: p.credential_id, transports: JSON.parse(p.transports || '[]') as string[] })),
  });
  const id = randomToken(18);
  await run(c.env.DB, "INSERT INTO auth_challenges (id, purpose, challenge, subject, expires_at) VALUES (?, 'passkey_login', ?, ?, ?)", id, options.challenge, staff ? String(staff.id) : '', inMinutes(5));
  return c.json({ challengeId: id, options });
});

authRoutes.post('/passkeys/login/verify', async (c) => {
  await rateLimit(c, 'passkey-verify', 20, 900);
  const input = await readJson(c, z.object({ challengeId: z.string().max(64), response: z.custom<AuthenticationResponseJSON>((v) => !!v && typeof v === 'object') }));
  const db = c.env.DB;
  const row = await first<{ challenge: string; subject: string }>(db, "SELECT challenge, subject FROM auth_challenges WHERE id = ? AND purpose = 'passkey_login' AND expires_at > ?", input.challengeId, nowIso());
  if (!row) fail(400, 'Sign-in timed out — please try again.');
  await run(db, 'DELETE FROM auth_challenges WHERE id = ?', input.challengeId);
  const pk = await first<{ id: number; user_id: number; credential_id: string; public_key: string; counter: number; transports: string }>(db, 'SELECT * FROM passkeys WHERE credential_id = ?', input.response.id);
  if (!pk) fail(401, 'This passkey is not registered. Sign in with your password, then add it under Settings → Security.');
  const result = await verifyAuthenticationResponse({
    response: input.response, expectedChallenge: row!.challenge, expectedOrigin: rp(c).origin, expectedRPID: rp(c).id, requireUserVerification: true,
    credential: { id: pk!.credential_id, publicKey: fromBase64Url(pk!.public_key), counter: pk!.counter, transports: JSON.parse(pk!.transports || '[]') as string[] },
  }).catch(() => null);
  if (!result?.verified) fail(401, 'Passkey verification failed.');
  const user = await first<UserRow>(db, 'SELECT id, name, email, role, active FROM users WHERE id = ?', pk!.user_id);
  if (!user?.active) fail(403, 'This account is disabled.');
  await run(db, 'UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?', result!.authenticationInfo.newCounter, nowIso(), pk!.id);

  const staff = c.get('staff');
  if (staff && staff.id === user!.id) {
    await run(db, 'UPDATE sessions SET locked = 0 WHERE id = ?', staff.sessionId);
    return c.json({ ok: true, unlocked: true });
  }
  await destroySession(c, 'staff');
  await createSession(c, 'staff', user!.id, (await getSettings(db)).security.sessionDays);
  await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user!.id);
  await audit(c, 'login', 'user', user!.id, 'Signed in with a passkey', {}, { type: 'staff', id: user!.id, name: user!.name });
  return c.json({ ok: true });
});
