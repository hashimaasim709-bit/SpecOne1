// Customer accounts. Customers never set a password: they sign in with a six-digit code
// sent to the email address or phone number on their record.
import { Hono } from 'hono';
import { z } from 'zod';
import { formatReg, isValidEmail, normPhone } from '../../shared/format';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { audit, createSession, customerOrFail, destroySession } from '../lib/auth';
import { randomDigits, randomToken, sha256Hex, timingSafeEqual } from '../lib/crypto';
import { all, first, inMinutes, nowIso, run } from '../lib/db';
import { download, intParam, noStore, readJson } from '../lib/http';
import { fail, rateLimit } from '../lib/security';
import { getSettings } from '../lib/settings';
import { emailLayout, pushOwner, sendEmail, sendSms } from '../services/notify';
import { buildStatement } from './ops';

export const accountRoutes = new Hono<AppEnv>();

const GENERIC = 'If we have an account with those details, a sign-in code is on its way.';

accountRoutes.post('/code', async (c) => {
  await rateLimit(c, 'login-code', 6, 900);
  const { contact } = await readJson(c, z.object({ contact: z.string().trim().min(5).max(120) }));
  await rateLimit(c, 'login-code-subject', 4, 900, contact.toLowerCase());
  const db = c.env.DB;
  const isEmail = isValidEmail(contact);
  const customer = isEmail
    ? await first<{ id: number; name: string; email: string; phone: string }>(db, "SELECT id, name, email, phone FROM customers WHERE email = ? AND email <> '' ORDER BY id LIMIT 1", contact.toLowerCase())
    : await first<{ id: number; name: string; email: string; phone: string }>(db, "SELECT id, name, email, phone FROM customers WHERE phone = ? AND phone <> '' ORDER BY id LIMIT 1", normPhone(contact));
  const challengeId = randomToken(18);
  // Always respond the same way so the form cannot be used to discover who is a customer.
  if (customer) {
    const code = randomDigits(6);
    await run(db, "INSERT INTO auth_challenges (id, purpose, challenge, subject, expires_at) VALUES (?, 'customer_login', ?, ?, ?)", challengeId, await sha256Hex(code), String(customer.id), inMinutes(10));
    const settings = await getSettings(db);
    const text = `${code} is your ${settings.business.name} sign-in code. It expires in 10 minutes.`;
    c.executionCtx.waitUntil((async () => {
      if (isEmail) {
        await sendEmail(c.env, { to: customer.email, subject: `Your sign-in code: ${code}`, text, html: emailLayout(settings, { heading: 'Your sign-in code', paragraphs: [`Hi ${customer.name.split(' ')[0]}, use this code to sign in to your account:`, code, 'It expires in 10 minutes. If you did not ask for it, you can ignore this message.'] }) });
      } else {
        await sendSms(c.env, customer.phone, text);
      }
    })());
  }
  return c.json({ ok: true, challenge: challengeId, message: GENERIC });
});

accountRoutes.post('/verify', async (c) => {
  await rateLimit(c, 'login-verify', 12, 900);
  const { challenge, code } = await readJson(c, z.object({ challenge: z.string().min(10).max(64), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }));
  const db = c.env.DB;
  const row = await first<{ challenge: string; subject: string; attempts: number }>(db, "SELECT challenge, subject, attempts FROM auth_challenges WHERE id = ? AND purpose = 'customer_login' AND expires_at > ?", challenge, nowIso());
  if (!row || row.attempts >= 5) fail(401, 'That code has expired. Please request a new one.');
  if (!timingSafeEqual(row!.challenge, await sha256Hex(code))) {
    await run(db, 'UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', challenge);
    fail(401, 'That code is not right — please check it and try again.');
  }
  await run(db, 'DELETE FROM auth_challenges WHERE id = ?', challenge);
  const customerId = Number(row!.subject);
  await createSession(c, 'customer', customerId, 90);
  const customer = await first<{ name: string }>(db, 'SELECT name FROM customers WHERE id = ?', customerId);
  await audit(c, 'login', 'customer', customerId, 'Customer signed in with a one-time code', {}, { type: 'customer', id: customerId, name: customer?.name ?? 'Customer' });
  return c.json({ ok: true });
});

accountRoutes.post('/logout', async (c) => {
  await destroySession(c, 'customer');
  return c.json({ ok: true });
});

accountRoutes.get('/me', async (c) => {
  noStore(c);
  const me = customerOrFail(c);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const [profile, vehicles, bookings, subscriptions, ledger] = await Promise.all([
    first(db, 'SELECT id, name, email, phone, address, postcode, company, referral_code, loyalty_points, marketing_opt_in, created_at FROM customers WHERE id = ?', me.id),
    all(db, `SELECT v.id, v.reg, v.make, v.model, v.year, v.fuel, v.colour, v.mot_due, v.size, v.body,
               (SELECT COUNT(*) FROM booking_vehicles bv JOIN bookings b ON b.id = bv.booking_id WHERE bv.vehicle_id = v.id AND b.status = 'completed') AS visits
             FROM vehicles v WHERE v.customer_id = ? ORDER BY v.id DESC`, me.id),
    all(db, `SELECT b.id, b.ref, b.access_token AS token, b.status, b.date, b.slot, b.total, b.paid_amount, b.currency,
               (SELECT GROUP_CONCAT(name, ' · ') FROM booking_items WHERE booking_id = b.id) AS services,
               (SELECT GROUP_CONCAT(v.reg, ', ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS regs
             FROM bookings b WHERE b.customer_id = ? ORDER BY b.date DESC, b.id DESC LIMIT 60`, me.id),
    all(db, `SELECT s.id, s.status, s.price, s.next_visit_on, s.preferred_slot, p.name AS plan, p.interval, v.reg
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.customer_id = ? ORDER BY s.id DESC`, me.id),
    all(db, 'SELECT points, reason, created_at FROM loyalty_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 30', me.id),
  ]);
  const referrals = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM customers WHERE referred_by = ?', me.id);
  const trade = await tradeAccountFor(c, me.email);
  return c.json({
    profile, vehicles, bookings, subscriptions, ledger, trade,
    loyalty: { ...settings.pricing.loyalty, referrals: referrals?.n ?? 0 },
    currency: settings.business.currency,
    shareUrl: `${originOf(c)}/book?promo=${encodeURIComponent(String((profile as { referral_code?: string } | null)?.referral_code ?? ''))}`,
  });
});

accountRoutes.patch('/me', async (c) => {
  const me = customerOrFail(c);
  const input = await readJson(c, z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(6).max(24),
    address: z.string().trim().max(240).default(''),
    postcode: z.string().trim().max(10).default(''),
    marketing: z.boolean().default(false),
  }));
  await run(c.env.DB, 'UPDATE customers SET name = ?, phone = ?, address = ?, postcode = ?, marketing_opt_in = ? WHERE id = ?', input.name, normPhone(input.phone), input.address, input.postcode.toUpperCase(), input.marketing ? 1 : 0, me.id);
  await audit(c, 'update', 'customer', me.id, 'Customer updated their details');
  return c.json({ ok: true });
});

/** Permanent history for one of the customer's own vehicles. */
accountRoutes.get('/vehicles/:id', async (c) => {
  noStore(c);
  const me = customerOrFail(c);
  const db = c.env.DB;
  const vehicle = await first<{ id: number; reg: string }>(db, 'SELECT id, reg, make, model, year, mot_due FROM vehicles WHERE id = ? AND customer_id = ?', intParam(c, 'id'), me.id);
  if (!vehicle) fail(404, 'Vehicle not found.');
  // Only this customer's own jobs on the vehicle: history from a previous keeper stays private.
  const [jobs, dpf, battery, flash] = await Promise.all([
    all(db, `SELECT b.ref, b.access_token AS token, b.date, b.status, b.findings,
               (SELECT GROUP_CONCAT(name, ' · ') FROM booking_items bi WHERE bi.booking_id = b.id AND (bi.vehicle_id = ? OR bi.vehicle_id IS NULL)) AS services
             FROM bookings b JOIN booking_vehicles bv ON bv.booking_id = b.id WHERE bv.vehicle_id = ? AND b.customer_id = ? ORDER BY b.date DESC`, vehicle!.id, vehicle!.id, me.id),
    all(db, 'SELECT d.logged_on, d.regen_type, d.soot_pct_before, d.soot_pct_after, d.result FROM dpf_logs d JOIN bookings b ON b.id = d.booking_id WHERE d.reg = ? AND b.customer_id = ? ORDER BY d.logged_on DESC', vehicle!.reg, me.id),
    all(db, 'SELECT t.id, t.tested_on, t.soh_pct, t.verdict, b.access_token AS token FROM battery_tests t JOIN bookings b ON b.id = t.booking_id WHERE t.reg = ? AND b.customer_id = ? ORDER BY t.tested_on DESC', vehicle!.reg, me.id),
    all(db, 'SELECT f.flashed_on, f.module, f.version_after, f.result FROM flash_log f JOIN bookings b ON b.id = f.booking_id WHERE f.reg = ? AND b.customer_id = ? ORDER BY f.flashed_on DESC', vehicle!.reg, me.id),
  ]);
  return c.json({ vehicle: { ...vehicle, reg: formatReg(vehicle!.reg) }, jobs, dpf, battery, flash });
});

accountRoutes.post('/subscriptions/:id', async (c) => {
  const me = customerOrFail(c);
  const { action } = await readJson(c, z.object({ action: z.enum(['pause', 'resume', 'cancel']) }));
  const id = intParam(c, 'id');
  const sub = await first<{ status: string }>(c.env.DB, 'SELECT status FROM subscriptions WHERE id = ? AND customer_id = ?', id, me.id);
  if (!sub) fail(404, 'Plan not found.');
  if (sub!.status === 'cancelled') fail(409, 'This plan has already been cancelled.');
  const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
  await run(c.env.DB, 'UPDATE subscriptions SET status = ?, cancelled_at = CASE WHEN ? = \'cancelled\' THEN ? ELSE cancelled_at END WHERE id = ?', status, status, nowIso(), id);
  await audit(c, action, 'subscription', id, `Customer ${action}d their plan`);
  c.executionCtx.waitUntil(pushOwner(c.env, `Plan ${status}`, `${me.name} ${action}d subscription #${id}.`, `${originOf(c)}/admin#/r/subscriptions`, 3));
  return c.json({ ok: true, status });
});

/** An approved trade account whose email matches the signed-in customer. */
async function tradeAccountFor(c: Ctx, email: string): Promise<{ id: number; name: string; code: string; discount: number; months: { month: string; jobs: number; total: number }[] } | null> {
  if (!email) return null;
  const p = await first<{ id: number; name: string; code: string; customer_discount_pct: number }>(c.env.DB, "SELECT id, name, code, customer_discount_pct FROM partners WHERE lower(email) = lower(?) AND trade_status = 'approved' AND active = 1 LIMIT 1", email);
  if (!p) return null;
  const months = await all<{ month: string; jobs: number; total: number }>(c.env.DB, "SELECT substr(date, 1, 7) AS month, COUNT(*) AS jobs, SUM(total) AS total FROM bookings WHERE partner_id = ? AND status NOT IN ('cancelled','no_show') GROUP BY month ORDER BY month DESC LIMIT 12", p.id);
  return { id: p.id, name: p.name, code: p.code, discount: p.customer_discount_pct, months };
}

accountRoutes.get('/trade/statement.pdf', async (c) => {
  const me = customerOrFail(c);
  const trade = await tradeAccountFor(c, me.email);
  if (!trade) fail(404, 'No trade account is linked to this email.');
  const { bytes, filename } = await buildStatement(c, trade!.id, c.req.query('month'));
  return download(bytes as Uint8Array<ArrayBuffer>, filename, 'application/pdf', c.req.query('download') !== '1');
});
