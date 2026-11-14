// Admin Connections centre: status, saving keys (encrypted), test buttons and the one-tap
// private ntfy channel. Values are write-only — the browser only ever sees a short hint.
import { Hono } from 'hono';
import { z } from 'zod';
import { CONNECTION_FIELD_NAMES, CONNECTIONS } from '../../shared/connections';
import { formatReg, normPhone } from '../../shared/format';
import type { AppEnv, Ctx, Env } from '../env';
import { originOf } from '../env';
import { audit, staffOrFail } from '../lib/auth';
import { invalidateConnections, rawEnv, sealValue, storedConnections, withConnections } from '../lib/connections';
import { run } from '../lib/db';
import { noStore, readJson } from '../lib/http';
import { fail } from '../lib/security';
import { getSettings } from '../lib/settings';
import { randomToken } from '../lib/crypto';
import { qrSvg } from '../lib/qr';
import { lookupAddresses } from '../services/lookups';
import { sendEmail, sendSms } from '../services/notify';
import { syncGoogleReviews } from '../services/scheduler';

export const connectionRoutes = new Hono<AppEnv>();

const ownerOnly = (c: Ctx) => {
  const staff = staffOrFail(c, 'settings.write');
  if (staff.role !== 'owner') fail(403, 'Only the owner can change service keys.');
  return staff;
};

const SECRET = new Set(CONNECTIONS.flatMap((d) => d.fields.filter((f) => f.secret).map((f) => f.name)));
const hintOf = (name: string, value: string): string => (SECRET.has(name) ? `••••${value.slice(-4)}` : value.slice(0, 80));

async function status(c: Ctx) {
  const raw = rawEnv(c.env) as unknown as Record<string, string | undefined>;
  const stored = await storedConnections(rawEnv(c.env));
  const hints = Object.fromEntries((await c.env.DB.prepare('SELECT name, hint, updated_at FROM connections').all<{ name: string; hint: string; updated_at: string }>()).results.map((r) => [r.name, r]));
  return CONNECTIONS.map((d) => {
    const fields = d.fields.map((f) => {
      const fromCloudflare = !!raw[f.name];
      const fromAdmin = f.name in stored.values;
      return {
        name: f.name,
        set: fromCloudflare || fromAdmin,
        source: fromCloudflare ? 'cloudflare' : fromAdmin ? 'admin' : '',
        hint: fromCloudflare ? (SECRET.has(f.name) ? 'Set in Cloudflare' : String(raw[f.name]).slice(0, 80)) : hints[f.name]?.hint ?? '',
        updatedAt: fromCloudflare ? null : hints[f.name]?.updated_at ?? null,
        unreadable: stored.unreadable.includes(f.name),
      };
    });
    const set = new Set(fields.filter((f) => f.set).map((f) => f.name));
    const on = d.required.length ? d.required.every((n) => set.has(n)) : fields.some((f) => f.set);
    return { key: d.key, on, fields };
  });
}

connectionRoutes.get('/connections', async (c) => {
  const staff = staffOrFail(c, 'settings.write');
  noStore(c);
  return c.json({ connections: await status(c), canEdit: staff.role === 'owner', setupTokenSet: !!rawEnv(c.env).SETUP_TOKEN || c.env.APP_ENV === 'development' });
});

function validate(name: string, value: string): string {
  if (name === 'NTFY_TOPIC' && !/^[A-Za-z0-9_-]{6,64}$/.test(value)) fail(422, 'Channel names use letters, numbers, dashes or underscores (6–64 characters).');
  if (name === 'NTFY_SERVER' && !/^https:\/\/[^\s/]+\/?$/.test(value)) fail(422, 'Use the full server address, e.g. https://ntfy.sh');
  if (name === 'TWILIO_FROM' && /^0\d{9,10}$/.test(value.replace(/\s/g, ''))) return normPhone(value);
  if (name === 'EMAIL_FROM' && !/@/.test(value)) fail(422, 'Use a from address like: SpecOne Auto Labs <bookings@speconeautolabs.co.uk>');
  if (name === 'STRIPE_SECRET_KEY' && !/^(sk|rk)_(live|test)_/.test(value)) fail(422, 'That does not look like a Stripe secret key (it starts with sk_live_).');
  if (name === 'STRIPE_WEBHOOK_SECRET' && !/^whsec_/.test(value)) fail(422, 'The webhook signing secret starts with whsec_.');
  return value;
}

connectionRoutes.put('/connections/:name', async (c) => {
  const staff = ownerOnly(c);
  const name = c.req.param('name');
  if (!CONNECTION_FIELD_NAMES.includes(name)) fail(404, 'Unknown setting.');
  const { value } = await readJson(c, z.object({ value: z.string().max(600) }));
  const clean = value.trim();
  if (!clean) {
    await run(c.env.DB, 'DELETE FROM connections WHERE name = ?', name);
    await audit(c, 'delete', 'connection', name, `Removed ${name}`);
  } else {
    const v = validate(name, clean);
    let sealed: string;
    try {
      sealed = await sealValue(rawEnv(c.env), v);
    } catch (e) {
      fail(409, e instanceof Error ? e.message : 'Could not save.');
    }
    await run(c.env.DB, "INSERT INTO connections (name, value, hint, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, hint = excluded.hint, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')", name, sealed!, hintOf(name, v), staff.name);
    await audit(c, 'update', 'connection', name, `Saved ${name} (${hintOf(name, v)})`);
  }
  invalidateConnections();
  return c.json({ ok: true, connections: await statusFresh(c) });
});

async function statusFresh(c: Ctx) {
  invalidateConnections();
  return status(c);
}

/** One tap: a long random ntfy channel nobody could guess, saved and ready to subscribe to. */
connectionRoutes.post('/connections/ntfy/generate', async (c) => {
  const staff = ownerOnly(c);
  const topic = `specone-${randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}`;
  await run(c.env.DB, "INSERT INTO connections (name, value, hint, updated_by) VALUES ('NTFY_TOPIC', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, hint = excluded.hint, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')", await sealValue(rawEnv(c.env), topic), hintOf('NTFY_TOPIC', topic), staff.name);
  await audit(c, 'update', 'connection', 'NTFY_TOPIC', 'Created a private ntfy alert channel');
  invalidateConnections();
  const server = ((await withConnections(rawEnv(c.env))).NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  return c.json({ ok: true, topic, subscribeUrl: `${server}/${topic}`, appUrl: `ntfy://${new URL(server).host}/${topic}` });
});

/** Shows the channel name again so it can be added on another phone (owner only). */
connectionRoutes.get('/connections/ntfy/channel', async (c) => {
  ownerOnly(c);
  noStore(c);
  const env = await withConnections(rawEnv(c.env));
  if (!env.NTFY_TOPIC) return c.json({ topic: '' });
  const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  return c.json({ topic: env.NTFY_TOPIC, subscribeUrl: `${server}/${env.NTFY_TOPIC}`, appUrl: `ntfy://${new URL(server).host}/${env.NTFY_TOPIC}` });
});

const okMsg = (ok: boolean, message: string) => ({ ok, message });

connectionRoutes.post('/connections/test/:key', async (c) => {
  staffOrFail(c, 'settings.write');
  const key = c.req.param('key');
  const { input } = await readJson(c, z.object({ input: z.string().trim().max(120).default('') }));
  invalidateConnections();
  const env: Env = await withConnections(rawEnv(c.env));
  const settings = await getSettings(env.DB);
  const t = AbortSignal.timeout(9000);
  switch (key) {
    case 'alerts': {
      if (!env.NTFY_TOPIC) return c.json(okMsg(false, 'Create your private alert channel first.'));
      const res = await fetch((env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: t,
        body: JSON.stringify({ topic: env.NTFY_TOPIC, title: 'SpecOne alerts are working ✅', message: 'New bookings, chats and payments will arrive like this.', priority: 4, tags: ['white_check_mark'], click: `${originOf(c)}/admin` }),
      }).catch(() => null);
      return c.json(okMsg(!!res?.ok, res?.ok ? 'Sent — your phone should buzz in a few seconds. Not arrived? Check you subscribed to the same channel in the ntfy app.' : `The alert service did not accept it (${res?.status ?? 'no response'}).`));
    }
    case 'dvla': {
      if (!env.DVLA_API_KEY) return c.json(okMsg(false, 'Paste your DVLA key first.'));
      const reg = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (reg.length < 2) return c.json(okMsg(false, 'Type a registration to test with.'));
      const res = await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles', { method: 'POST', headers: { 'x-api-key': env.DVLA_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNumber: reg }), signal: t }).catch(() => null);
      if (!res) return c.json(okMsg(false, 'Could not reach the DVLA right now. Try again in a minute.'));
      if (res.status === 403) return c.json(okMsg(false, 'The DVLA rejected the key — check it was copied in full.'));
      if (res.status === 404) return c.json(okMsg(true, `Key works — but the DVLA has no record of ${formatReg(reg)}. Try another plate.`));
      if (!res.ok) return c.json(okMsg(false, `DVLA replied with an error (${res.status}).`));
      const v = (await res.json()) as { make?: string; colour?: string; yearOfManufacture?: number; fuelType?: string; motExpiryDate?: string };
      return c.json(okMsg(true, `Working: ${formatReg(reg)} is a ${[v.yearOfManufacture, v.colour, v.make].filter(Boolean).join(' ')} (${v.fuelType ?? 'fuel unknown'})${v.motExpiryDate ? `, MOT until ${v.motExpiryDate}` : ''}.`));
    }
    case 'address': {
      if (!env.GETADDRESS_API_KEY && !env.IDEAL_POSTCODES_API_KEY) return c.json(okMsg(false, 'Paste an address-lookup key first.'));
      const list = await lookupAddresses(env, input || settings.business.postcode);
      return c.json(okMsg(list.length > 0, list.length ? `Working: ${list.length} addresses found, e.g. “${list[0]}”.` : 'No addresses came back — check the key and try a full postcode.'));
    }
    case 'email': {
      if (!env.RESEND_API_KEY) return c.json(okMsg(false, 'Paste your Resend key first.'));
      if (!/@/.test(input)) return c.json(okMsg(false, 'Type the email address to send the test to.'));
      const r = await sendEmail(env, { to: input, subject: `Test email from ${settings.business.name}`, text: 'Email is working. Booking confirmations, reminders and invoices will look like this.', html: `<p>Email is working. Booking confirmations, reminders and invoices will come from <b>${settings.business.name}</b>.</p>` });
      return c.json(okMsg(r.ok, r.ok ? `Sent to ${input} — check the inbox (and spam the first time).` : `Not sent: ${r.error || 'check the key and that your domain is verified in Resend.'}`));
    }
    case 'sms': {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) return c.json(okMsg(false, 'Paste the Twilio details first.'));
      if (input.replace(/\D/g, '').length < 10) return c.json(okMsg(false, 'Type the mobile number to text.'));
      const r = await sendSms(env, input, `${settings.business.name}: text messages are working.`);
      return c.json(okMsg(r.ok, r.ok ? 'Text sent.' : `Not sent: ${r.error || 'check the Twilio details.'}`));
    }
    case 'payments': {
      if (!env.STRIPE_SECRET_KEY) return c.json(okMsg(false, 'Paste your Stripe secret key first.'));
      const res = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }, signal: t }).catch(() => null);
      return c.json(okMsg(!!res?.ok, res?.ok ? `Connected to Stripe${env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? ' (test mode)' : ''}.${env.STRIPE_WEBHOOK_SECRET ? '' : ' Add the webhook signing secret so payments mark jobs as paid.'}` : res?.status === 401 ? 'Stripe rejected the key.' : 'Could not reach Stripe.'));
    }
    case 'reviews': {
      if (!env.GOOGLE_PLACES_API_KEY) return c.json(okMsg(false, 'Paste your Places API key first.'));
      if (!settings.business.googlePlaceId) return c.json(okMsg(false, 'Add your Google Place ID in Settings → Business first.'));
      const n = await syncGoogleReviews(env, settings);
      return c.json(okMsg(n > 0, n > 0 ? `Synced ${n} review${n === 1 ? '' : 's'} from Google.` : 'Nothing came back — check the key and the Place ID.'));
    }
    default:
      fail(404, 'No test for that service.');
  }
});

/** QR code for staff screens (e.g. scan the alert channel with your phone). */
connectionRoutes.get('/qr.svg', (c) => {
  staffOrFail(c);
  const text = (c.req.query('text') ?? '').slice(0, 300);
  if (!/^(https?|ntfy):\/\//.test(text)) fail(422, 'Only links can be turned into QR codes here.');
  c.header('Cache-Control', 'private, max-age=300');
  return c.body(qrSvg(text, { label: 'QR code' }), 200, { 'Content-Type': 'image/svg+xml' });
});
