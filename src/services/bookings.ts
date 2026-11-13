// Booking lifecycle: creation, status workflow, totals, loyalty, referrals, commissions
// and the scheduled messages that hang off each stage.
import { fitsDay, slotsCovered } from '../../shared/availability';
import { ACTIVE_STATUSES, BODIES, SLOT_ORDER, STATUS_META, type Body, type BookingSlot, type BookingStatus, type Size, type SlotKey } from '../../shared/constants';
import { addDays, addMonths, isIsoDate, isValidEmail, isValidPhone, normPhone, normPostcode, normReg, todayIn } from '../../shared/format';
import { computeQuote, priceFor } from '../../shared/pricing';
import type { Quote } from '../../shared/types';
import type { Env } from '../env';
import { randomCode, randomToken } from '../lib/crypto';
import { all, first, nowIso, parseJson, run, stmt } from '../lib/db';
import { HttpError } from '../lib/security';
import type { Settings } from '../lib/settings';
import { capacityOf, findPromo, getAvailability, getLocation, getQuoteConfig, type PackageRow } from './catalog';
import { geocodePostcode } from './lookups';
import { messageCustomer, notifyBookingCreated, pushOwner, vehicleLabel } from './notify';
import { deliverDue, emit } from './webhooks';

export interface NewBookingInput {
  vehicles: { reg: string; make: string; model: string; year?: number | null; fuel?: string; colour?: string; size: Size; body: Body; packageIds: number[] }[];
  date: string;
  slot: BookingSlot;
  emergency: boolean;
  serviceMode: 'mobile' | 'drop_off';
  address: string;
  postcode: string;
  customer: { name: string; email: string; phone: string; marketing: boolean };
  notes: string;
  symptoms: string[];
  photoIds: number[];
  promoCode: string;
  loyaltyPoints: number;
  paymentMethod: string;
  fleetSlug: string;
  source: 'web' | 'phone' | 'walk_in' | 'subscription' | 'fleet' | 'admin';
  /** Extra free-form lines (admin quick-booker): labour, parts, custom work. */
  customItems?: { name: string; unitPrice: number; qty: number; kind: 'labour' | 'part' | 'custom' }[];
  /** Staff may place a job in a full or closed slot. */
  overrideAvailability?: boolean;
  /** Verified customer session — required to redeem loyalty points. */
  sessionCustomerId?: number | null;
  assignedUserId?: number | null;
  subscriptionId?: number | null;
  /** Fixed total for subscription visits. */
  fixedTotal?: number | null;
  internalNotes?: string;
  silent?: boolean;
}

export interface CreatedBooking {
  id: number;
  ref: string;
  token: string;
  total: number;
  depositDue: number;
  depositRequired: boolean;
  status: BookingStatus;
  customerId: number;
  referralCode: string;
  quote: Quote;
}

export interface BookingRow {
  id: number;
  ref: string;
  access_token: string;
  customer_id: number;
  location_id: number;
  status: BookingStatus;
  source: string;
  date: string;
  slot: string;
  slot_span: number;
  emergency: number;
  service_mode: string;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  distance_miles: number;
  currency: string;
  subtotal: number;
  discount: number;
  travel_fee: number;
  emergency_fee: number;
  peak_adjustment: number;
  loyalty_discount: number;
  total: number;
  quote_snapshot: string;
  deposit_due: number;
  paid_amount: number;
  payment_method: string;
  payment_status: string;
  promo_code: string;
  referral_code: string;
  partner_id: number | null;
  fleet_slug: string;
  subscription_id: number | null;
  assigned_user_id: number | null;
  van_id: number | null;
  customer_notes: string;
  internal_notes: string;
  findings: string;
  signature_media_id: number | null;
  signed_name: string;
  signed_at: string | null;
  eta_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_reason: string;
  created_at: string;
  updated_at: string;
}

const bad = (message: string, fields?: Record<string, string>): never => {
  throw new HttpError(422, message, fields);
};

async function uniqueRef(db: D1Database): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const ref = `S1-${randomCode(6)}`;
    if (!(await first(db, 'SELECT 1 FROM bookings WHERE ref = ?', ref))) return ref;
  }
  return `S1-${randomCode(9)}`;
}

async function uniqueReferralCode(db: D1Database, name: string): Promise<string> {
  const stem = (name.split(/\s+/)[0] ?? 'S1').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'S1';
  for (let i = 0; i < 6; i++) {
    const code = `${stem}-${randomCode(4)}`;
    if (!(await first(db, 'SELECT 1 FROM promo_codes WHERE code = ?', code))) return code;
  }
  return `S1-${randomCode(8)}`;
}

/** Find or create the customer record, matching on email first and then phone. */
export async function upsertCustomer(
  db: D1Database, c: { name: string; email: string; phone: string; address?: string; postcode?: string; marketing?: boolean; referredBy?: number | null; partnerId?: number | null },
  /** A verified, signed-in customer always books as their own record. */
  forceId?: number | null,
): Promise<{ id: number; referralCode: string; created: boolean }> {
  const email = c.email.trim().toLowerCase();
  const phone = normPhone(c.phone);
  const existing =
    (forceId ? await first<{ id: number; referral_code: string | null }>(db, 'SELECT id, referral_code FROM customers WHERE id = ?', forceId) : null) ??
    (email ? await first<{ id: number; referral_code: string | null }>(db, "SELECT id, referral_code FROM customers WHERE email = ? AND email <> '' ORDER BY id LIMIT 1", email) : null) ??
    (phone ? await first<{ id: number; referral_code: string | null }>(db, "SELECT id, referral_code FROM customers WHERE phone = ? AND phone <> '' ORDER BY id LIMIT 1", phone) : null);
  if (existing) {
    await run(
      db,
      `UPDATE customers SET name = ?, email = CASE WHEN email = '' THEN ? ELSE email END, phone = CASE WHEN ? <> '' THEN ? ELSE phone END,
       address = CASE WHEN ? <> '' THEN ? ELSE address END, postcode = CASE WHEN ? <> '' THEN ? ELSE postcode END,
       marketing_opt_in = MAX(marketing_opt_in, ?) WHERE id = ?`,
      c.name.trim(), email, phone, phone, c.address ?? '', c.address ?? '', c.postcode ?? '', c.postcode ?? '', c.marketing ? 1 : 0, existing.id,
    );
    let code = existing.referral_code;
    if (!code) code = await createReferralCode(db, existing.id, c.name);
    return { id: existing.id, referralCode: code, created: false };
  }
  const { id } = await run(
    db, 'INSERT INTO customers (name, email, phone, address, postcode, marketing_opt_in, referred_by, partner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    c.name.trim(), email, phone, c.address ?? '', c.postcode ?? '', c.marketing ? 1 : 0, c.referredBy ?? null, c.partnerId ?? null,
  );
  return { id, referralCode: await createReferralCode(db, id, c.name), created: true };
}

/** Every customer gets a personal code: friends save 15%, the referrer earns loyalty points. */
async function createReferralCode(db: D1Database, customerId: number, name: string): Promise<string> {
  const code = await uniqueReferralCode(db, name);
  await db.batch([
    stmt(db, 'UPDATE customers SET referral_code = ? WHERE id = ?', code, customerId),
    stmt(db, "INSERT INTO promo_codes (code, kind, discount_type, value, description, owner_customer_id) VALUES (?, 'referral', 'percent', 15, ?, ?)", code, `Referral from ${name.trim()}`, customerId),
  ]);
  return code;
}

export async function upsertVehicle(
  db: D1Database, customerId: number | null, v: { reg: string; make: string; model: string; year?: number | null; fuel?: string; colour?: string; size: Size; body: Body },
): Promise<number> {
  const reg = normReg(v.reg);
  const existing = await first<{ id: number }>(db, 'SELECT id FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', reg);
  if (existing) {
    // History stays with the plate: the record is kept and simply re-pointed at its current keeper.
    await run(
      db,
      `UPDATE vehicles SET customer_id = COALESCE(?, customer_id), make = CASE WHEN ? <> '' THEN ? ELSE make END, model = CASE WHEN ? <> '' THEN ? ELSE model END,
       year = COALESCE(?, year), fuel = CASE WHEN ? <> '' THEN ? ELSE fuel END, colour = CASE WHEN ? <> '' THEN ? ELSE colour END, size = ?, body = ? WHERE id = ?`,
      customerId, v.make, v.make, v.model, v.model, v.year ?? null, v.fuel ?? '', v.fuel ?? '', v.colour ?? '', v.colour ?? '', v.size, v.body, existing.id,
    );
    return existing.id;
  }
  return (await run(db, 'INSERT INTO vehicles (customer_id, reg, make, model, year, fuel, colour, size, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', customerId, reg, v.make.trim(), v.model.trim(), v.year ?? null, v.fuel ?? '', v.colour ?? '', v.size, v.body)).id;
}

export async function addEvent(db: D1Database, bookingId: number, type: string, detail: string, actor = '', isPublic = true): Promise<void> {
  await run(db, 'INSERT INTO booking_events (booking_id, type, detail, actor, public) VALUES (?, ?, ?, ?, ?)', bookingId, type, detail.slice(0, 500), actor, isPublic ? 1 : 0);
}

export async function createBooking(env: Env, settings: Settings, input: NewBookingInput, origin: string, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<CreatedBooking> {
  const db = env.DB;
  const loc = await getLocation(db);
  const config = await getQuoteConfig(db, settings, loc);
  const today = todayIn(loc.timezone);
  const staffSource = input.source === 'phone' || input.source === 'walk_in' || input.source === 'admin' || input.source === 'subscription';

  // ── Validate ──
  const fields: Record<string, string> = {};
  const name = input.customer.name.trim();
  if (name.length < 2) fields.name = 'Please enter your name.';
  if (!isValidPhone(input.customer.phone)) fields.phone = 'Please enter a valid phone number.';
  if (input.customer.email ? !isValidEmail(input.customer.email) : !staffSource) fields.email = 'Please enter a valid email address.';
  if (!isIsoDate(input.date)) fields.date = 'Please choose a date.';
  if (!input.vehicles.length) fields.vehicles = 'Add at least one vehicle.';
  if (input.vehicles.length > settings.booking.maxVehicles) fields.vehicles = `Up to ${settings.booking.maxVehicles} vehicles can be booked in one visit.`;
  const mobile = input.serviceMode === 'mobile';
  if (mobile && input.address.trim().length < 5) fields.address = 'Please enter the address for the visit.';
  const byId = new Map(config.packages.map((p) => [p.id, p]));
  input.vehicles.forEach((v, i) => {
    if (normReg(v.reg).length < 2) fields[`vehicles.${i}.reg`] = 'Enter the registration.';
    v.packageIds = [...new Set(v.packageIds)].filter((id) => byId.has(id));
    if (!v.packageIds.length && !(input.customItems?.length)) fields[`vehicles.${i}.packages`] = 'Choose at least one service for this vehicle.';
    if (!BODIES.includes(v.body)) v.body = 'hatchback';
    if (!['S', 'M', 'L'].includes(v.size)) v.size = 'M';
  });
  if (Object.keys(fields).length) bad(Object.values(fields)[0]!, fields);
  if (input.date < today && !input.overrideAvailability) bad('That date has passed — please choose another.', { date: 'Choose a future date.' });

  // ── Location & distance ──
  let geo: Awaited<ReturnType<typeof geocodePostcode>> = null;
  if (mobile && input.postcode) geo = await geocodePostcode(input.postcode, loc);
  if (mobile && !geo && !staffSource) bad('We could not find that postcode — please check it.', { postcode: 'Postcode not recognised.' });

  // ── Discounts: fleet portal, partner code, promo / referral code ──
  let tradePct = 0;
  let partnerId: number | null = null;
  let fleetSlug = '';
  if (input.fleetSlug) {
    const portal = await first<{ slug: string; discount_pct: number; partner_id: number | null }>(db, 'SELECT slug, discount_pct, partner_id FROM fleet_portals WHERE slug = ? AND active = 1', input.fleetSlug);
    if (portal) {
      tradePct = portal.discount_pct;
      partnerId = portal.partner_id;
      fleetSlug = portal.slug;
    }
  }
  let promoCode = '';
  let referralCode = '';
  let referredBy: number | null = null;
  let promo = null as Awaited<ReturnType<typeof findPromo>>['promo'];
  const typedCode = input.promoCode.trim().toUpperCase();
  if (typedCode) {
    const partner = await first<{ id: number; customer_discount_pct: number }>(db, 'SELECT id, customer_discount_pct FROM partners WHERE code = ? AND active = 1', typedCode);
    if (partner) {
      partnerId = partner.id;
      tradePct = Math.max(tradePct, partner.customer_discount_pct);
      promoCode = typedCode;
    } else {
      const found = await findPromo(db, typedCode, today, input.sessionCustomerId);
      if (!found.promo && !staffSource) bad(found.error || 'That code is not valid.', { promoCode: found.error });
      promo = found.promo;
      if (promo) {
        promoCode = promo.code;
        if (promo.kind === 'referral') {
          referralCode = promo.code;
          referredBy = (await first<{ owner_customer_id: number | null }>(db, 'SELECT owner_customer_id FROM promo_codes WHERE code = ?', promo.code))?.owner_customer_id ?? null;
        }
      }
    }
  }

  // ── Loyalty: points can only be redeemed by the verified, signed-in account holder ──
  let loyaltyPoints = 0;
  if (input.loyaltyPoints > 0 && input.sessionCustomerId) {
    const balance = (await first<{ loyalty_points: number }>(db, 'SELECT loyalty_points FROM customers WHERE id = ?', input.sessionCustomerId))?.loyalty_points ?? 0;
    loyaltyPoints = Math.min(input.loyaltyPoints, balance);
  }

  const emergency = !!input.emergency;
  const slot: BookingSlot = emergency && input.slot === 'asap' ? 'asap' : SLOT_ORDER.includes(input.slot as SlotKey) ? input.slot : 'morning';
  const quote = computeQuote(
    { vehicles: input.vehicles.map((v) => ({ size: v.size, packageIds: v.packageIds })), date: input.date, slot, emergency, serviceMode: input.serviceMode, distanceMiles: geo?.miles ?? null, promo, tradeDiscountPct: tradePct, loyaltyPoints },
    config,
  );
  if (quote.outOfArea && !staffSource) bad(`That address is ${Math.round(geo?.miles ?? 0)} miles from our base, outside the standard coverage area. Please call ${settings.business.phone} and we will see what we can do.`, { postcode: 'Outside our coverage area.' });

  const customSubtotal = (input.customItems ?? []).reduce((sum, it) => sum + Math.round(it.unitPrice * it.qty), 0);
  let total = quote.total + customSubtotal;
  if (input.fixedTotal != null) total = input.fixedTotal;

  // ── Availability ──
  const span = quote.slotSpan;
  if (slot !== 'asap' && !input.overrideAvailability) {
    const [day] = await getAvailability(db, settings, loc, input.date, 1);
    if (!fitsDay(day, slot as SlotKey, span)) {
      const reason = day?.closed ? day.reason || 'unavailable' : span > 1 ? 'not long enough for this job from that start time' : 'fully booked';
      bad(`Sorry — that window is ${reason}. Please pick another.`, { slot: 'No longer available.' });
    }
  }

  // ── Persist ──
  const postcode = normPostcode(input.postcode);
  const street = input.address.trim();
  const address = postcode && !street.toUpperCase().replace(/\s/g, '').includes(postcode.replace(' ', '')) ? `${street}, ${postcode}` : street;
  const customer = await upsertCustomer(db, { name, email: input.customer.email, phone: input.customer.phone, address: street, postcode, marketing: input.customer.marketing, referredBy, partnerId }, input.sessionCustomerId);
  if (referredBy === customer.id) {
    referralCode = '';
  }
  const vehicleIds: number[] = [];
  for (const v of input.vehicles) vehicleIds.push(await upsertVehicle(db, customer.id, v));

  const ref = await uniqueRef(db);
  const token = randomToken(24);
  const status: BookingStatus = settings.booking.autoConfirm || staffSource ? 'confirmed' : 'pending';
  const notes = [input.symptoms.length ? `Symptoms: ${input.symptoms.join('; ')}` : '', input.notes.trim()].filter(Boolean).join('\n').slice(0, 4000);
  const discount = quote.bundleDiscount + quote.multiVehicleDiscount + quote.tradeDiscount + quote.promoDiscount;
  const depositDue = settings.pricing.deposit.mode === 'off' ? 0 : Math.min(total, quote.depositDue);

  const { id } = await run(
    db,
    `INSERT INTO bookings (ref, access_token, customer_id, location_id, status, source, date, slot, slot_span, emergency, service_mode, address, postcode, lat, lng, distance_miles,
       currency, subtotal, discount, travel_fee, emergency_fee, peak_adjustment, loyalty_discount, total, quote_snapshot, deposit_due, payment_method, promo_code, referral_code,
       partner_id, fleet_slug, subscription_id, assigned_user_id, customer_notes, internal_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ref, token, customer.id, loc.id, status, fleetSlug && input.source === 'web' ? 'fleet' : input.source, input.date, slot, span, emergency, input.serviceMode,
    mobile ? address : `Drop-off at ${loc.name}`, normPostcode(input.postcode), geo?.lat ?? null, geo?.lng ?? null, geo?.miles ?? 0,
    loc.currency, quote.subtotal + customSubtotal, discount, quote.travelFee, quote.emergencyFee, quote.peakAdjustment, quote.loyaltyDiscount, total,
    JSON.stringify({ ...quote, lines: undefined }), depositDue, input.paymentMethod || 'on_completion', promoCode, referralCode,
    partnerId, fleetSlug, input.subscriptionId ?? null, input.assignedUserId ?? null, notes, (input.internalNotes ?? '').slice(0, 4000),
  );

  try {
    const batch: D1PreparedStatement[] = [];
    input.vehicles.forEach((v, i) => batch.push(stmt(db, 'INSERT INTO booking_vehicles (booking_id, vehicle_id, size) VALUES (?, ?, ?)', id, vehicleIds[i]!, v.size)));
    quote.lines.forEach((line, i) => batch.push(stmt(db, "INSERT INTO booking_items (booking_id, vehicle_id, package_id, kind, name, qty, unit_price, sort) VALUES (?, ?, ?, 'package', ?, 1, ?, ?)", id, vehicleIds[line.vehicleIndex]!, line.packageId, line.name, line.price, i)));
    (input.customItems ?? []).forEach((it, i) => batch.push(stmt(db, 'INSERT INTO booking_items (booking_id, vehicle_id, kind, name, qty, unit_price, sort) VALUES (?, ?, ?, ?, ?, ?, ?)', id, vehicleIds[0] ?? null, it.kind, it.name.slice(0, 200), it.qty, it.unitPrice, 100 + i)));
    batch.push(stmt(db, "INSERT INTO booking_events (booking_id, type, detail, actor) VALUES (?, 'created', ?, ?)", id, status === 'pending' ? 'Booking request received' : 'Booking confirmed', staffSource ? 'Staff' : name));
    if (input.photoIds.length) {
      for (const pid of input.photoIds.slice(0, 8)) batch.push(stmt(db, 'UPDATE media SET booking_id = ?, attached = 1 WHERE id = ? AND attached = 0 AND booking_id IS NULL', id, pid));
    }
    if (promo) batch.push(stmt(db, 'UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?', promo.code));
    if (quote.loyaltyPointsUsed > 0 && input.sessionCustomerId === customer.id) {
      batch.push(stmt(db, 'UPDATE customers SET loyalty_points = MAX(0, loyalty_points - ?) WHERE id = ?', quote.loyaltyPointsUsed, customer.id));
      batch.push(stmt(db, 'INSERT INTO loyalty_ledger (customer_id, booking_id, points, reason) VALUES (?, ?, ?, ?)', customer.id, id, -quote.loyaltyPointsUsed, `Redeemed on ${ref}`));
    }
    // 24-hour reminder.
    const remindAt = `${addDays(input.date, -1)}T16:00:00Z`;
    if (remindAt > nowIso()) batch.push(stmt(db, "INSERT INTO scheduled_messages (kind, booking_id, customer_id, send_at) VALUES ('booking_reminder', ?, ?, ?)", id, customer.id, remindAt));
    await db.batch(batch);
  } catch (err) {
    await run(db, 'DELETE FROM bookings WHERE id = ?', id);
    throw err;
  }

  // Two people racing for the last slot: the later insert backs out.
  if (slot !== 'asap' && !input.overrideAvailability) {
    const capacity = capacityOf(loc);
    const same = await all<{ id: number; slot: string; slot_span: number }>(db, "SELECT id, slot, slot_span FROM bookings WHERE location_id = ? AND date = ? AND slot <> 'asap' AND status NOT IN ('cancelled','no_show')", loc.id, input.date);
    for (const s of slotsCovered(slot as SlotKey, span) ?? []) {
      const holders = same.filter((b) => (slotsCovered(b.slot as SlotKey, b.slot_span) ?? [b.slot]).includes(s));
      if (holders.length > capacity[s] && Math.max(...holders.map((h) => h.id)) === id) {
        await run(db, 'DELETE FROM bookings WHERE id = ?', id);
        bad('Sorry — someone just took that window. Please pick another.', { slot: 'Just taken.' });
      }
    }
  }

  // Maintenance plans: booking a plan package starts the subscription for that vehicle.
  if (input.source !== 'subscription') {
    for (const line of quote.lines) {
      const pkg = byId.get(line.packageId);
      if (pkg?.category !== 'plan') continue;
      const plan = await first<{ id: number; interval: string }>(db, 'SELECT id, interval FROM plans WHERE package_slug = ? AND active = 1', pkg.slug);
      if (!plan) continue;
      await run(
        db, "INSERT INTO subscriptions (customer_id, vehicle_id, plan_id, preferred_slot, address, postcode, price, next_visit_on, started_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        customer.id, vehicleIds[line.vehicleIndex]!, plan.id, slot === 'asap' ? 'morning' : slot, input.address.trim(), normPostcode(input.postcode), line.price, nextVisitDate(input.date, plan.interval), input.date,
      );
    }
  }

  const created: CreatedBooking = { id, ref, token, total, depositDue, depositRequired: quote.depositRequired, status, customerId: customer.id, referralCode: customer.referralCode, quote };

  if (!input.silent) {
    const work = (async () => {
      const vehicles = input.vehicles.map((v) => vehicleLabel(v));
      const services = [...quote.lines.map((l) => l.name), ...(input.customItems ?? []).map((i) => i.name)];
      await notifyBookingCreated(env, settings, {
        id, ref, date: input.date, slot, address: mobile ? address : `Drop-off at ${loc.name}`, total, currency: loc.currency, vehicles, services,
        trackUrl: `${origin}/track/${token}`, customer: { name, email: input.customer.email.trim().toLowerCase(), phone: normPhone(input.customer.phone) },
      }, { emergency, adminUrl: `${origin}/admin#/bookings/${id}`, pending: status === 'pending' });
      await emit(db, 'booking.created', await webhookPayload(db, id));
      if (customer.created) await emit(db, 'customer.created', { id: customer.id, name, email: input.customer.email, phone: normPhone(input.customer.phone) });
      await deliverDue(db, 10);
    })().catch((e) => console.error('booking notifications failed', e));
    if (ctx) ctx.waitUntil(work);
    else await work;
  }
  return created;
}

export function nextVisitDate(from: string, interval: string): string {
  return interval === 'weekly' ? addDays(from, 7) : interval === 'fortnightly' ? addDays(from, 14) : interval === 'quarterly' ? addMonths(from, 3) : addMonths(from, 1);
}

export async function getBooking(db: D1Database, id: number): Promise<BookingRow | null> {
  return first<BookingRow>(db, 'SELECT * FROM bookings WHERE id = ?', id);
}
export async function getBookingByToken(db: D1Database, token: string): Promise<BookingRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return first<BookingRow>(db, 'SELECT * FROM bookings WHERE access_token = ?', token);
}

export interface BookingVehicle { id: number; reg: string; make: string; model: string; year: number | null; fuel: string; colour: string; size: Size; body: string; mot_due: string | null; notes: string }
export interface BookingItem { id: number; vehicle_id: number | null; package_id: number | null; kind: string; name: string; qty: number; unit_price: number; sort: number }

export async function bookingVehicles(db: D1Database, bookingId: number): Promise<BookingVehicle[]> {
  return all<BookingVehicle>(db, 'SELECT v.id, v.reg, v.make, v.model, v.year, v.fuel, v.colour, bv.size, v.body, v.mot_due, v.notes FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = ? ORDER BY bv.id', bookingId);
}
export async function bookingItems(db: D1Database, bookingId: number): Promise<BookingItem[]> {
  return all<BookingItem>(db, 'SELECT id, vehicle_id, package_id, kind, name, qty, unit_price, sort FROM booking_items WHERE booking_id = ? ORDER BY sort, id', bookingId);
}

/** Flat, stable payload for webhooks and exports. */
export async function webhookPayload(db: D1Database, bookingId: number): Promise<Record<string, unknown>> {
  const b = await getBooking(db, bookingId);
  if (!b) return { id: bookingId };
  const [customer, vehicles, items] = await Promise.all([
    first<{ name: string; email: string; phone: string }>(db, 'SELECT name, email, phone FROM customers WHERE id = ?', b.customer_id),
    bookingVehicles(db, bookingId),
    bookingItems(db, bookingId),
  ]);
  return {
    id: b.id, ref: b.ref, status: b.status, source: b.source, date: b.date, slot: b.slot, emergency: !!b.emergency, service_mode: b.service_mode,
    address: b.address, postcode: b.postcode, currency: b.currency, subtotal: b.subtotal, discount: b.discount, travel_fee: b.travel_fee, emergency_fee: b.emergency_fee,
    total: b.total, paid_amount: b.paid_amount, payment_status: b.payment_status, promo_code: b.promo_code,
    customer_name: customer?.name ?? '', customer_email: customer?.email ?? '', customer_phone: customer?.phone ?? '',
    vehicles: vehicles.map((v) => ({ reg: v.reg, make: v.make, model: v.model, year: v.year })),
    items: items.map((i) => ({ name: i.name, kind: i.kind, qty: i.qty, unit_price: i.unit_price })),
    created_at: b.created_at, completed_at: b.completed_at,
  };
}

/** Recompute stored totals after line items, fees or discounts are edited on the job card. */
export async function recalcTotals(db: D1Database, bookingId: number): Promise<number> {
  const sum = (await first<{ s: number | null }>(db, 'SELECT SUM(ROUND(qty * unit_price)) AS s FROM booking_items WHERE booking_id = ?', bookingId))?.s ?? 0;
  const b = await getBooking(db, bookingId);
  if (!b) return 0;
  const total = Math.max(0, Math.round(sum) - b.discount + b.travel_fee + b.emergency_fee + b.peak_adjustment - b.loyalty_discount);
  await run(db, 'UPDATE bookings SET subtotal = ?, total = ?, updated_at = ? WHERE id = ?', Math.round(sum), total, nowIso(), bookingId);
  await syncPaymentStatus(db, bookingId);
  return total;
}

export async function syncPaymentStatus(db: D1Database, bookingId: number): Promise<void> {
  const paid = (await first<{ s: number | null }>(db, "SELECT SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END) AS s FROM payments WHERE booking_id = ? AND status = 'succeeded'", bookingId))?.s ?? 0;
  const b = await getBooking(db, bookingId);
  if (!b) return;
  const refunded = !!(await first(db, "SELECT 1 FROM payments WHERE booking_id = ? AND kind = 'refund' AND status = 'succeeded'", bookingId));
  const status = paid >= b.total && b.total > 0 ? 'paid' : paid > 0 ? 'deposit_paid' : refunded ? 'refunded' : 'unpaid';
  await run(db, 'UPDATE bookings SET paid_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?', Math.max(0, paid), status, nowIso(), bookingId);
}

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show', 'pending'],
  en_route: ['arrived', 'in_progress', 'confirmed', 'cancelled', 'no_show'],
  arrived: ['in_progress', 'completed', 'cancelled', 'no_show', 'en_route'],
  in_progress: ['completed', 'arrived', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['confirmed', 'pending'],
  no_show: ['confirmed'],
};

/** Move a booking through the workflow and run everything that hangs off the new status. */
export async function setStatus(
  env: Env, settings: Settings, bookingId: number, next: BookingStatus, actor: string, origin: string, opts: { reason?: string; etaMinutes?: number | null; notify?: boolean } = {},
): Promise<BookingRow> {
  const db = env.DB;
  const b = await getBooking(db, bookingId);
  if (!b) throw new HttpError(404, 'Booking not found.');
  if (b.status === next) return b;
  if (!ALLOWED[b.status].includes(next)) throw new HttpError(409, `A booking that is "${STATUS_META[b.status].label}" cannot move to "${STATUS_META[next].label}".`);
  const now = nowIso();
  const customer = await first<{ id: number; name: string; email: string; phone: string; referred_by: number | null }>(db, 'SELECT id, name, email, phone, referred_by FROM customers WHERE id = ?', b.customer_id);
  const trackUrl = `${origin}/track/${b.access_token}`;
  const notify = opts.notify !== false && !!customer;

  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const binds: (string | number | null)[] = [next, now];
  if (next === 'en_route') {
    sets.push('eta_minutes = ?');
    binds.push(opts.etaMinutes ?? null);
  }
  if (next === 'in_progress' && !b.started_at) {
    sets.push('started_at = ?');
    binds.push(now);
  }
  if (next === 'completed') {
    sets.push('completed_at = ?', 'eta_minutes = NULL');
    binds.push(now);
  }
  if (next === 'cancelled') {
    sets.push('cancelled_reason = ?');
    binds.push((opts.reason ?? '').slice(0, 300));
  }
  await run(db, `UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, ...binds, bookingId);
  await addEvent(db, bookingId, next, next === 'cancelled' && opts.reason ? `Cancelled: ${opts.reason}` : STATUS_META[next].customer, actor);

  if (next !== 'en_route' && next !== 'arrived') await run(db, 'UPDATE vans SET tracking_booking_id = NULL WHERE tracking_booking_id = ?', bookingId);

  if (next === 'confirmed' && b.status === 'pending' && notify) {
    await messageCustomer(env, settings, customer!, { subject: `Booking ${b.ref} confirmed`, text: `Your booking ${b.ref} is confirmed. You can follow it live here:`, ctaLabel: 'Track booking', ctaUrl: trackUrl, bookingId });
  }
  if (next === 'en_route' && notify) {
    const eta = opts.etaMinutes ? ` — about ${opts.etaMinutes} minutes away` : '';
    await messageCustomer(env, settings, customer!, { subject: 'Your technician is on the way', text: `Your SpecOne technician is on the way${eta}. Follow the mobile lab live:`, ctaLabel: 'Open live tracker', ctaUrl: trackUrl, bookingId });
  }
  if (next === 'completed') await onCompleted(env, settings, b, customer, origin, notify);
  if (next === 'cancelled' || next === 'no_show') {
    await run(db, "UPDATE scheduled_messages SET status = 'cancelled' WHERE booking_id = ? AND status = 'pending'", bookingId);
    if (b.loyalty_discount > 0 && customer) {
      const points = parseJson<{ loyaltyPointsUsed?: number }>(b.quote_snapshot, {}).loyaltyPointsUsed ?? 0;
      if (points > 0) {
        await db.batch([
          stmt(db, 'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', points, customer.id),
          stmt(db, 'INSERT INTO loyalty_ledger (customer_id, booking_id, points, reason) VALUES (?, ?, ?, ?)', customer.id, bookingId, points, `Refunded — ${b.ref} cancelled`),
        ]);
      }
    }
    if (next === 'cancelled' && notify) await messageCustomer(env, settings, customer!, { subject: `Booking ${b.ref} cancelled`, text: `Your booking ${b.ref} has been cancelled. If this is unexpected, please call ${settings.business.phone}.`, bookingId });
  }

  const payload = await webhookPayload(db, bookingId);
  await emit(db, 'booking.status_changed', { ...payload, previous_status: b.status });
  if (next === 'completed') await emit(db, 'booking.completed', payload);
  if (next === 'cancelled') await emit(db, 'booking.cancelled', payload);
  return (await getBooking(db, bookingId))!;
}

async function onCompleted(
  env: Env, settings: Settings, b: BookingRow, customer: { id: number; name: string; email: string; phone: string; referred_by: number | null } | null, origin: string, notify: boolean,
): Promise<void> {
  const db = env.DB;
  const batch: D1PreparedStatement[] = [];
  const loyalty = settings.pricing.loyalty;

  if (customer && loyalty.enabled) {
    const already = await first(db, "SELECT 1 FROM loyalty_ledger WHERE booking_id = ? AND reason LIKE 'Earned%'", b.id);
    const points = Math.floor((b.total / 100) * loyalty.pointsPerPound);
    if (!already && points > 0) {
      batch.push(stmt(db, 'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', points, customer.id));
      batch.push(stmt(db, 'INSERT INTO loyalty_ledger (customer_id, booking_id, points, reason) VALUES (?, ?, ?, ?)', customer.id, b.id, points, `Earned on ${b.ref}`));
    }
    // Referral reward: the friend's first completed job credits the person who referred them.
    if (b.referral_code && customer.referred_by && loyalty.referrerPoints > 0) {
      const rewarded = await first(db, "SELECT 1 FROM loyalty_ledger WHERE customer_id = ? AND reason = ?", customer.referred_by, `Referral reward — ${customer.name}`);
      if (!rewarded) {
        batch.push(stmt(db, 'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', loyalty.referrerPoints, customer.referred_by));
        batch.push(stmt(db, 'INSERT INTO loyalty_ledger (customer_id, booking_id, points, reason) VALUES (?, ?, ?, ?)', customer.referred_by, b.id, loyalty.referrerPoints, `Referral reward — ${customer.name}`));
      }
    }
  }

  if (b.partner_id) {
    const partner = await first<{ commission_pct: number }>(db, 'SELECT commission_pct FROM partners WHERE id = ?', b.partner_id);
    const amount = Math.round(((b.total - b.travel_fee - b.emergency_fee) * (partner?.commission_pct ?? 0)) / 100);
    if (amount > 0) batch.push(stmt(db, "INSERT INTO commissions (partner_id, booking_id, amount) VALUES (?, ?, ?) ON CONFLICT(booking_id) DO UPDATE SET amount = excluded.amount WHERE status = 'due'", b.partner_id, b.id, amount));
  }

  if (customer) {
    // Review request a couple of hours after the job; reminder ~11 months later for MOT / service work.
    const reviewAt = new Date(Date.now() + settings.booking.reviewDelayMinutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hasReview = await first(db, "SELECT 1 FROM scheduled_messages WHERE booking_id = ? AND kind = 'review_request'", b.id);
    if (!hasReview) batch.push(stmt(db, "INSERT INTO scheduled_messages (kind, booking_id, customer_id, send_at) VALUES ('review_request', ?, ?, ?)", b.id, customer.id, reviewAt));
    const reminderPackages = await all<{ vehicle_id: number | null }>(
      db, 'SELECT DISTINCT bi.vehicle_id FROM booking_items bi JOIN packages p ON p.id = bi.package_id WHERE bi.booking_id = ? AND p.mot_reminder = 1', b.id,
    );
    const remindOn = `${addMonths(b.date, settings.booking.serviceReminderMonths)}T09:30:00Z`;
    for (const r of reminderPackages) {
      const exists = await first(db, "SELECT 1 FROM scheduled_messages WHERE booking_id = ? AND kind = 'service_reminder' AND vehicle_id IS ?", b.id, r.vehicle_id);
      if (!exists) batch.push(stmt(db, "INSERT INTO scheduled_messages (kind, booking_id, customer_id, vehicle_id, send_at) VALUES ('service_reminder', ?, ?, ?, ?)", b.id, customer.id, r.vehicle_id, remindOn));
    }
  }
  if (batch.length) await db.batch(batch);

  if (customer && notify) {
    await messageCustomer(env, settings, customer, {
      subject: `All done — ${b.ref}`,
      text: `Your vehicle is finished. Your invoice and report for ${b.ref} are ready to view and download:`,
      ctaLabel: 'View invoice & report', ctaUrl: `${origin}/track/${b.access_token}`, bookingId: b.id,
    });
  }
}

/** Create the next visit for each active subscription that falls due within a week. */
export async function scheduleSubscriptionVisits(env: Env, settings: Settings, origin: string): Promise<number> {
  const db = env.DB;
  const today = todayIn(settings.business.timezone);
  const due = await all<{ id: number; customer_id: number; vehicle_id: number | null; plan_id: number; preferred_slot: string; address: string; postcode: string; price: number; next_visit_on: string; interval: string; package_slug: string; plan_name: string }>(
    db,
    `SELECT s.*, p.interval, p.package_slug, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.status = 'active' AND s.next_visit_on IS NOT NULL AND s.next_visit_on <= ?`,
    addDays(today, 7),
  );
  let created = 0;
  for (const sub of due) {
    const visitDate = sub.next_visit_on < today ? addDays(today, 1) : sub.next_visit_on;
    const customer = await first<{ name: string; email: string; phone: string }>(db, 'SELECT name, email, phone FROM customers WHERE id = ?', sub.customer_id);
    const vehicle = sub.vehicle_id ? await first<{ reg: string; make: string; model: string; year: number | null; size: Size; body: Body }>(db, 'SELECT reg, make, model, year, size, body FROM vehicles WHERE id = ?', sub.vehicle_id) : null;
    const pkg = await first<PackageRow>(db, 'SELECT * FROM packages WHERE slug = ?', sub.package_slug);
    if (!customer || !vehicle || !pkg) {
      await run(db, 'UPDATE subscriptions SET next_visit_on = ? WHERE id = ?', nextVisitDate(sub.next_visit_on, sub.interval), sub.id);
      continue;
    }
    try {
      const booking = await createBooking(env, settings, {
        vehicles: [{ ...vehicle, packageIds: [pkg.id] }], date: visitDate, slot: (SLOT_ORDER.includes(sub.preferred_slot as SlotKey) ? sub.preferred_slot : 'morning') as SlotKey,
        emergency: false, serviceMode: 'mobile', address: sub.address, postcode: sub.postcode, customer: { ...customer, marketing: false }, notes: `${sub.plan_name} — scheduled plan visit`,
        symptoms: [], photoIds: [], promoCode: '', loyaltyPoints: 0, paymentMethod: 'on_completion', fleetSlug: '', source: 'subscription', overrideAvailability: true,
        subscriptionId: sub.id, fixedTotal: sub.price || priceFor(pkg, vehicle.size), silent: true,
      }, origin);
      await run(db, 'UPDATE subscriptions SET next_visit_on = ? WHERE id = ?', nextVisitDate(visitDate, sub.interval), sub.id);
      await messageCustomer(env, settings, customer, {
        subject: `Your next ${sub.plan_name} visit is booked`, text: `Your next ${sub.plan_name} visit is scheduled for ${visitDate} (${sub.preferred_slot}). Need a different day? Reply or manage it in your account:`,
        ctaLabel: 'View booking', ctaUrl: `${origin}/track/${booking.token}`, bookingId: booking.id,
      });
      created++;
    } catch (e) {
      console.error('subscription visit failed', sub.id, e);
      await pushOwner(env, 'Subscription visit could not be scheduled', `Subscription #${sub.id} (${customer.name}) — ${String(e).slice(0, 120)}`, `${origin}/admin#/r/subscriptions`);
    }
  }
  return created;
}

export const isActive = (status: BookingStatus): boolean => ACTIVE_STATUSES.includes(status);
