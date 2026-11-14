// Public, unauthenticated API used by the website and booking wizard.
import { Hono } from 'hono';
import { z } from 'zod';
import { BODIES, CONTACT_TOPICS, SLOT_ORDER, type ContactTopic } from '../../shared/constants';
import { formatReg, isIsoDate, isUkPostcode, normPhone, normPostcode, outwardCode, timeAgo, todayIn } from '../../shared/format';
import { travelFor } from '../../shared/pricing';
import type { BookingConfig, CreateBookingResponse } from '../../shared/types';
import type { AppEnv, Ctx } from '../env';
import { originOf } from '../env';
import { audit, createSession } from '../lib/auth';
import { randomCode, randomToken } from '../lib/crypto';
import { all, first, likeTerm, nowIso, run } from '../lib/db';
import { intQuery, noStore, readJson, readUpload } from '../lib/http';
import { fail, rateLimit, verifyTurnstile } from '../lib/security';
import { getFlag, getSettings } from '../lib/settings';
import { createBooking } from '../services/bookings';
import { findPromo, getAvailability, getLocation, getQuoteConfig } from '../services/catalog';
import { autoReply, FALLBACK_REPLY } from '../services/chatbot';
import { geocodePostcode, hasAddressLookup, lookupAddresses, lookupReg } from '../services/lookups';
import { LIMITS, storeMedia } from '../services/media';
import { emailLayout, pushOwner, sendEmail } from '../services/notify';
import { createCheckout, paymentsEnabled } from '../services/payments';
import { emit } from '../services/webhooks';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/booking-config', async (c) => {
  noStore(c);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const loc = await getLocation(db);
  const config = await getQuoteConfig(db, settings, loc);
  const upsells = await all<{ trigger_category: string; trigger_package_slug: string; suggest_package_slug: string; message: string }>(db, 'SELECT * FROM upsell_rules WHERE active = 1 ORDER BY sort, id');
  const fleetSlug = c.req.query('fleet') ?? '';
  const fleet = fleetSlug ? await first<{ slug: string; company_name: string; discount_pct: number }>(db, 'SELECT slug, company_name, discount_pct FROM fleet_portals WHERE slug = ? AND active = 1', fleetSlug) : null;
  const session = c.get('customer');
  const customer = session ? await first<{ name: string; email: string; phone: string; loyalty_points: number }>(db, 'SELECT name, email, phone, loyalty_points FROM customers WHERE id = ?', session.id) : null;
  const body: BookingConfig = {
    ...config,
    business: { name: settings.business.name, phone: settings.business.phone, whatsapp: settings.business.whatsapp, currency: loc.currency, locale: settings.business.locale, timezone: loc.timezone },
    base: { lat: loc.lat, lng: loc.lng, name: loc.name },
    upsells: upsells.map((u) => ({ triggerCategory: u.trigger_category, triggerSlug: u.trigger_package_slug, suggestSlug: u.suggest_package_slug, message: u.message })),
    features: { addressLookup: hasAddressLookup(c.env), regLookup: true, onlinePayments: paymentsEnabled(c.env), turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? '', sumupLink: settings.integrations.sumupLink },
    maxVehicles: settings.booking.maxVehicles,
    fleet: fleet ? { slug: fleet.slug, companyName: fleet.company_name, discountPct: fleet.discount_pct } : null,
    customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone, loyaltyPoints: customer.loyalty_points } : null,
  };
  return c.json(body);
});

publicRoutes.get('/availability', async (c) => {
  noStore(c);
  const settings = await getSettings(c.env.DB);
  const loc = await getLocation(c.env.DB);
  const from = c.req.query('from');
  const start = isIsoDate(from) ? from : todayIn(loc.timezone);
  return c.json({ days: await getAvailability(c.env.DB, settings, loc, start, intQuery(c, 'days', 42, 1, 70)) });
});

publicRoutes.get('/postcode', async (c) => {
  await rateLimit(c, 'postcode', 60, 600);
  const pc = normPostcode(c.req.query('pc') ?? '');
  if (!isUkPostcode(pc)) fail(422, 'Please enter a full UK postcode, e.g. BN21 4AB.');
  const loc = await getLocation(c.env.DB);
  const geo = await geocodePostcode(pc, loc);
  if (!geo) fail(404, 'We could not find that postcode — please check it.');
  const settings = await getSettings(c.env.DB);
  const config = await getQuoteConfig(c.env.DB, settings, loc);
  const travel = travelFor(geo!.miles, config.travelBands, config.maxMiles);
  const addresses = c.req.query('addresses') === '1' ? await lookupAddresses(c.env, pc) : [];
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ ...geo, fee: travel.fee, zone: travel.label, outOfArea: travel.outOfArea, addresses });
});

publicRoutes.post('/vehicle', async (c) => {
  await rateLimit(c, 'reg', 30, 600);
  const { reg } = await readJson(c, z.object({ reg: z.string().min(2).max(12) }));
  return c.json(await lookupReg(c.env, reg));
});

publicRoutes.post('/promo', async (c) => {
  await rateLimit(c, 'promo', 30, 600);
  const { code } = await readJson(c, z.object({ code: z.string().min(1).max(40) }));
  const upper = code.trim().toUpperCase();
  const partner = await first<{ name: string; customer_discount_pct: number; trade_status: string }>(c.env.DB, 'SELECT name, customer_discount_pct, trade_status FROM partners WHERE code = ? AND active = 1', upper);
  if (partner) return c.json({ ok: true, kind: 'partner', code: upper, tradeDiscountPct: partner.customer_discount_pct, description: partner.trade_status === 'approved' ? `Trade account — ${partner.name} (${partner.customer_discount_pct}% trade rate)` : `Referred by ${partner.name}` });
  const loc = await getLocation(c.env.DB);
  const { promo, error } = await findPromo(c.env.DB, upper, todayIn(loc.timezone), c.get('customer')?.id);
  if (!promo) return c.json({ ok: false, error }, 404);
  return c.json({ ok: true, kind: 'promo', promo });
});

publicRoutes.get('/dtc', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toUpperCase().slice(0, 40);
  if (q.length < 2) return c.json({ results: [] });
  const term = likeTerm(q);
  const results = await all(
    c.env.DB,
    `SELECT code, system, title, causes, fixes, severity, package_slug FROM dtc_codes WHERE public = 1 AND (code LIKE ? ESCAPE '\\' OR UPPER(title) LIKE ? ESCAPE '\\' OR UPPER(system) LIKE ? ESCAPE '\\')
     ORDER BY CASE WHEN code = ? THEN 0 WHEN code LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, code LIMIT 12`,
    term, term, term, q, `${q.replace(/[\\%_]/g, '\\$&')}%`,
  );
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ results });
});

publicRoutes.post('/upload', async (c) => {
  await rateLimit(c, 'upload', 12, 3600);
  const { bytes } = await readUpload(c, c.env.MEDIA ? LIMITS.imageR2 : LIMITS.imageD1);
  const media = await storeMedia(c.env, bytes, { kind: 'customer', visibility: 'private', label: 'Customer photo', uploadedBy: 'customer', attached: false });
  if (media.kind === 'video') fail(415, 'Please upload a photo rather than a video.');
  return c.json({ ok: true, id: media.id });
});

const vehicleSchema = z.object({
  reg: z.string().trim().min(2, 'Enter the registration.').max(12),
  make: z.string().trim().max(60).default(''),
  model: z.string().trim().max(80).default(''),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  fuel: z.string().max(40).optional(),
  colour: z.string().max(40).optional(),
  size: z.enum(['S', 'M', 'L']),
  body: z.enum(BODIES),
  packageIds: z.array(z.number().int().positive()).max(12),
});

const bookingSchema = z.object({
  vehicles: z.array(vehicleSchema).min(1, 'Add a vehicle.').max(10),
  date: z.string().refine(isIsoDate, 'Choose a date.'),
  slot: z.enum([...SLOT_ORDER, 'asap'] as ['morning', 'afternoon', 'evening', 'asap']),
  emergency: z.boolean().default(false),
  serviceMode: z.enum(['mobile', 'drop_off']).default('mobile'),
  address: z.string().trim().max(240).default(''),
  postcode: z.string().trim().max(10).default(''),
  customer: z.object({
    name: z.string().trim().min(2, 'Enter your name.').max(80),
    email: z.string().trim().max(120).default(''),
    phone: z.string().trim().min(6, 'Enter your phone number.').max(24),
    marketing: z.boolean().default(false),
  }),
  notes: z.string().max(2000).default(''),
  symptoms: z.array(z.string().max(80)).max(12).default([]),
  photoIds: z.array(z.number().int().positive()).max(8).default([]),
  promoCode: z.string().max(40).default(''),
  loyaltyPoints: z.number().int().min(0).max(1_000_000).default(0),
  paymentMethod: z.enum(['on_completion', 'cash', 'bank_transfer', 'online', 'account']).default('on_completion'),
  payDeposit: z.boolean().default(false),
  utilitiesConfirmed: z.boolean().default(false),
  fleetSlug: z.string().max(60).default(''),
  channel: z.string().max(60).default(''),
  turnstileToken: z.string().max(4096).default(''),
  website: z.string().max(200).default(''),
});

publicRoutes.post('/bookings', async (c) => {
  await rateLimit(c, 'book', 8, 3600);
  const input = await readJson(c, bookingSchema);
  // Honeypot: a hidden field real visitors never fill in.
  if (input.website) fail(400, 'Unable to accept this booking.');
  await verifyTurnstile(c, input.turnstileToken);
  const settings = await getSettings(c.env.DB);
  if (settings.site.maintenance.on && !c.get('staff')) fail(503, `${settings.site.maintenance.message} ${settings.business.phone}`.trim());
  const session = c.get('customer');
  const booking = await createBooking(c.env, settings, { ...input, source: 'web', sessionCustomerId: session?.id ?? null }, originOf(c), c.executionCtx);

  if (!session && booking.customerCreated) await createSession(c, 'customer', booking.customerId, 90);
  await audit(c, 'create', 'booking', booking.id, `Online booking ${booking.ref} — total ${booking.total}`, { ref: booking.ref, total: booking.total, emergency: input.emergency });

  let checkoutUrl: string | null = null;
  if (paymentsEnabled(c.env) && booking.depositDue > 0 && (input.payDeposit || booking.depositRequired)) {
    const row = await first<Parameters<typeof createCheckout>[1]>(c.env.DB, 'SELECT * FROM bookings WHERE id = ?', booking.id);
    checkoutUrl = await createCheckout(c.env, row!, 'deposit', originOf(c), input.customer.email, settings.business.name).catch(() => null);
  }
  const out: CreateBookingResponse = {
    ok: true, ref: booking.ref, token: booking.token, trackUrl: `/track/${booking.token}`, total: booking.total, depositDue: booking.depositDue,
    checkoutUrl, status: booking.status, referralCode: booking.referralCode,
  };
  return c.json(out, 201);
});

// ── Live chat ──
const chatSchema = z.object({
  token: z.string().max(64).default(''),
  name: z.string().trim().max(80).default(''),
  contact: z.string().trim().max(120).default(''),
  message: z.string().trim().min(1, 'Type a message.').max(1500),
});

async function threadMessages(db: D1Database, threadId: number, after = 0) {
  return all<{ id: number; sender: string; author: string; body: string; created_at: string }>(db, 'SELECT id, sender, author, body, created_at FROM chat_messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 100', threadId, after);
}

publicRoutes.post('/chat', async (c) => {
  await rateLimit(c, 'chat', 20, 600);
  const input = await readJson(c, chatSchema);
  const db = c.env.DB;
  const settings = await getSettings(db);
  let thread = input.token ? await first<{ id: number; token: string; updated_at: string }>(db, 'SELECT id, token, updated_at FROM chat_threads WHERE token = ?', input.token) : null;
  const isNew = !thread;
  if (!thread) {
    const token = randomToken(24);
    const { id } = await run(db, 'INSERT INTO chat_threads (token, visitor_name, contact) VALUES (?, ?, ?)', token, input.name || 'Website visitor', input.contact);
    thread = { id, token, updated_at: nowIso() };
  } else if (input.name || input.contact) {
    await run(db, "UPDATE chat_threads SET visitor_name = CASE WHEN ? <> '' THEN ? ELSE visitor_name END, contact = CASE WHEN ? <> '' THEN ? ELSE contact END WHERE id = ?", input.name, input.name, input.contact, input.contact, thread.id);
  }
  await run(db, "INSERT INTO chat_messages (thread_id, sender, author, body) VALUES (?, 'visitor', ?, ?)", thread.id, input.name || 'Visitor', input.message);
  await run(db, "UPDATE chat_threads SET unread = unread + 1, status = 'open', sentiment = '', updated_at = ? WHERE id = ?", nowIso(), thread.id);

  // Auto-reply only while nobody is working the inbox.
  const staffSeen = await getFlag(db, 'staff_inbox_seen');
  const staffActive = staffSeen && Date.now() - Date.parse(staffSeen) < 10 * 60_000;
  if (!staffActive) {
    const answer = (await autoReply(db, settings, input.message)) || (isNew ? FALLBACK_REPLY(settings) : '');
    if (answer) await run(db, "INSERT INTO chat_messages (thread_id, sender, author, body) VALUES (?, 'bot', 'SpecOne assistant', ?)", thread.id, answer);
  }
  const quiet = isNew || Date.now() - Date.parse(thread.updated_at) > 5 * 60_000;
  if (quiet) c.executionCtx.waitUntil(pushOwner(c.env, `Chat: ${input.name || 'Website visitor'}`, input.message.slice(0, 300), `${originOf(c)}/admin#/inbox/${thread.id}`, 4, ['speech_balloon']));
  c.executionCtx.waitUntil(emit(db, 'chat.message', { thread_id: thread.id, name: input.name, contact: input.contact, message: input.message }));
  return c.json({ ok: true, token: thread.token, messages: await threadMessages(db, thread.id) });
});

publicRoutes.get('/chat/:token', async (c) => {
  noStore(c);
  const thread = await first<{ id: number }>(c.env.DB, 'SELECT id FROM chat_threads WHERE token = ?', c.req.param('token'));
  if (!thread) fail(404, 'Conversation not found.');
  return c.json({ messages: await threadMessages(c.env.DB, thread!.id, intQuery(c, 'after', 0)) });
});

// ── Contact & help, fleet and partner enquiries land in the admin inbox ──
const TOPIC_KEYS = CONTACT_TOPICS.map(([k]) => k) as [ContactTopic, ...ContactTopic[]];
const TOPIC_LABEL = Object.fromEntries(CONTACT_TOPICS) as Record<ContactTopic, string>;

async function openInboxThread(c: Ctx, name: string, contact: string, author: string, body: string): Promise<number> {
  const { id } = await run(c.env.DB, 'INSERT INTO chat_threads (token, visitor_name, contact, unread) VALUES (?, ?, ?, 1)', randomToken(24), name, contact);
  await run(c.env.DB, "INSERT INTO chat_messages (thread_id, sender, author, body) VALUES (?, 'visitor', ?, ?)", id, author, body);
  return id;
}

publicRoutes.post('/enquiry', async (c) => {
  await rateLimit(c, 'enquiry', 6, 3600);
  const input = await readJson(c, z.object({
    kind: z.enum(['fleet', 'general', 'partner', 'contact']).default('general'),
    name: z.string().trim().min(2).max(80),
    company: z.string().trim().max(120).default(''),
    phone: z.string().trim().max(24).default(''),
    email: z.string().trim().max(120).default(''),
    vehicles: z.string().trim().max(60).default(''),
    topic: z.union([z.enum(TOPIC_KEYS), z.literal('')]).default(''),
    reg: z.string().trim().max(10).default(''),
    preferred: z.enum(['call', 'text', 'whatsapp', 'email', '']).default(''),
    message: z.string().trim().max(2000).default(''),
    turnstileToken: z.string().max(4096).default(''),
    website: z.string().max(200).default(''),
  }));
  if (input.website) fail(400, 'Unable to send.');
  if (!input.phone && !input.email) fail(422, 'Please give a phone number or email so we can reply.', { phone: 'Required.' });
  if (input.kind === 'contact' && input.message.length < 5) fail(422, 'Please tell us a little about what you need.', { message: 'Required.' });
  await verifyTurnstile(c, input.turnstileToken);
  const heading = input.kind === 'fleet' ? 'Fleet / trade enquiry' : input.kind === 'partner' ? 'Partner enquiry' : input.kind === 'contact' ? `Contact form${input.topic ? ` — ${TOPIC_LABEL[input.topic]}` : ''}` : 'Enquiry';
  const reg = input.reg ? formatReg(input.reg.toUpperCase().replace(/[^A-Z0-9]/g, '')) : '';
  const body = [
    `${heading}${input.company ? ` from ${input.company}` : ''}`,
    input.vehicles ? `Vehicles: ${input.vehicles}` : '',
    reg ? `Registration: ${reg}` : '',
    `Contact: ${[input.phone, input.email].filter(Boolean).join(' · ')}${input.preferred ? ` (prefers ${input.preferred === 'text' ? 'a text' : input.preferred === 'whatsapp' ? 'WhatsApp' : input.preferred === 'call' ? 'a call' : 'email'})` : ''}`,
    input.message,
  ].filter(Boolean).join('\n');
  const id = await openInboxThread(c, input.company ? `${input.name} (${input.company})` : input.name, [input.phone, input.email].filter(Boolean).join(' · '), input.name, body);
  const urgent = input.topic === 'warning' || input.topic === 'feedback';
  c.executionCtx.waitUntil(pushOwner(c.env, `${input.kind === 'fleet' ? 'Fleet enquiry' : input.kind === 'contact' ? 'Contact form' : 'New enquiry'}: ${input.company || input.name}`, body.slice(0, 400), `${originOf(c)}/admin#/inbox/${id}`, urgent ? 5 : 4, ['envelope']));
  return c.json({ ok: true });
});

// ── Trade account applications (trade portal) ──
publicRoutes.post('/trade-apply', async (c) => {
  await rateLimit(c, 'trade-apply', 4, 3600);
  const input = await readJson(c, z.object({
    company: z.string().trim().min(2).max(120),
    businessType: z.enum(['garage', 'bodyshop', 'dealer', 'fleet', 'taxi', 'auction', 'recovery', 'other']).default('garage'),
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(7).max(24),
    email: z.string().trim().email().max(120),
    siteUrl: z.string().trim().max(200).default(''),
    postcode: z.string().trim().max(10).default(''),
    volume: z.string().trim().max(40).default(''),
    message: z.string().trim().max(2000).default(''),
    turnstileToken: z.string().max(4096).default(''),
    website: z.string().max(200).default(''),
  }));
  if (input.website) fail(400, 'Unable to send.');
  await verifyTurnstile(c, input.turnstileToken);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const existing = await first<{ id: number; trade_status: string }>(db, "SELECT id, trade_status FROM partners WHERE lower(email) = lower(?) AND trade_status IN ('applied','approved') LIMIT 1", input.email);
  if (existing?.trade_status === 'approved') fail(409, 'This email already has a trade account. Use your trade code when booking, or call us if you have lost it.');
  if (existing) return c.json({ ok: true, already: true });
  const kind = ({ garage: 'garage', bodyshop: 'bodyshop', dealer: 'garage', fleet: 'fleet', taxi: 'fleet', auction: 'auction', recovery: 'recovery', other: 'other' } as const)[input.businessType];
  const base = input.company.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TRADE';
  let code = `T-${base}`;
  for (let i = 0; await first(db, 'SELECT 1 FROM partners WHERE code = ?', code); i++) code = `T-${base}${randomCode(3)}`;
  const details = [`Business type: ${input.businessType}`, input.volume ? `Expected volume: ${input.volume}` : '', input.postcode ? `Postcode: ${normPostcode(input.postcode)}` : '', input.message].filter(Boolean).join('\n');
  const { id } = await run(
    db,
    "INSERT INTO partners (name, kind, contact_name, phone, email, website, code, commission_pct, customer_discount_pct, notes, active, trade_status, trade_details) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'Trade account application', 0, 'applied', ?)",
    input.company, kind, input.name, normPhone(input.phone), input.email.toLowerCase(), input.siteUrl, code, settings.pricing.tradeDiscountPct, details,
  );
  const body = `Trade account application from ${input.company}\nContact: ${input.name} · ${input.phone} · ${input.email}\n${details}\n\nApprove it from the admin dashboard to send their trade code (${code}).`;
  await openInboxThread(c, `${input.name} (${input.company})`, `${input.phone} · ${input.email}`, input.name, body);
  await audit(c, 'create', 'partner', id, `Trade application from ${input.company}`, { code });
  c.executionCtx.waitUntil(pushOwner(c.env, `Trade application: ${input.company}`, body.slice(0, 400), `${originOf(c)}/admin#/dashboard`, 4, ['handshake']));
  c.executionCtx.waitUntil(sendEmail(c.env, {
    to: input.email, subject: `We have your trade account application — ${settings.business.name}`, replyTo: settings.business.email,
    text: `Hi ${input.name.split(' ')[0]},\n\nThanks for applying for a ${settings.business.name} trade account for ${input.company}. We review applications within one working day and will send your trade code by text and email.\n\nIn the meantime you can call ${settings.business.phone}.`,
    html: emailLayout(settings, { heading: 'Trade application received', paragraphs: [`Hi ${input.name.split(' ')[0]},`, `Thanks for applying for a trade account for ${input.company}. We review applications within one working day and will send your trade code by text and email.`, `Need something sooner? Call ${settings.business.phone}.`] }),
  }).then(() => undefined));
  return c.json({ ok: true });
});

// ── Social proof: genuine recent bookings, anonymised to vehicle model and postcode district ──
publicRoutes.get('/recent', async (c) => {
  const settings = await getSettings(c.env.DB);
  c.header('Cache-Control', 'public, max-age=300');
  if (!settings.integrations.socialProof) return c.json({ items: [] });
  const rows = await all<{ created_at: string; postcode: string; make: string | null; model: string | null; service: string | null }>(
    c.env.DB,
    `SELECT b.created_at, b.postcode,
       (SELECT v.make FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id LIMIT 1) AS make,
       (SELECT v.model FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id LIMIT 1) AS model,
       (SELECT bi.name FROM booking_items bi WHERE bi.booking_id = b.id ORDER BY bi.sort LIMIT 1) AS service
     FROM bookings b WHERE b.source IN ('web','fleet') AND b.status NOT IN ('cancelled','no_show') AND b.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-14 days')
     ORDER BY b.id DESC LIMIT 8`,
  );
  const items = rows
    .filter((r) => r.service && r.make)
    .map((r) => ({ vehicle: [r.make, r.model].filter(Boolean).join(' '), area: outwardCode(r.postcode), service: r.service!, ago: timeAgo(r.created_at) }));
  return c.json({ items });
});

// ── Client-side error reporting ──
publicRoutes.post('/errors', async (c) => {
  await rateLimit(c, 'client-error', 20, 600);
  const e = await readJson(c, z.object({ message: z.string().max(1000), stack: z.string().max(6000).default(''), url: z.string().max(500).default('') }));
  await run(c.env.DB, 'INSERT INTO error_logs (source, message, stack, url, user_agent) VALUES (?, ?, ?, ?, ?)', 'client', e.message, e.stack, e.url, (c.req.header('User-Agent') ?? '').slice(0, 250));
  return c.json({ ok: true });
});
