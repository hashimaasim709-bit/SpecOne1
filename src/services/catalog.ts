// Catalogue, pricing configuration and slot availability.
import { fitsDay, slotsCovered } from '../../shared/availability';
import { SLOT_ORDER, SLOTS, type SlotKey } from '../../shared/constants';
import { addDays, hourIn, todayIn, weekdayOf } from '../../shared/format';
import type { DayAvailability, PackageLite, PeakRule, PromoInfo, QuoteConfig, TravelBand } from '../../shared/types';
import { all, first, parseJson } from '../lib/db';
import type { Settings } from '../lib/settings';

export interface PackageRow extends Omit<PackageLite, 'includes'> {
  includes: string;
  mot_reminder: number;
  active: number;
  sort: number;
}

export interface LocationRow {
  id: number;
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  timezone: string;
  currency: string;
  travel_bands: string;
  max_miles: number;
  slot_capacity: string;
  phone: string;
}

export const toPackageLite = (p: PackageRow): PackageLite => ({ ...p, includes: parseJson<string[]>(p.includes, []) });

export async function getPackages(db: D1Database, includeInactive = false): Promise<PackageRow[]> {
  return all<PackageRow>(db, `SELECT * FROM packages ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`);
}

export async function getLocation(db: D1Database, id = 1): Promise<LocationRow> {
  const loc = (await first<LocationRow>(db, 'SELECT * FROM locations WHERE id = ? AND active = 1', id)) ?? (await first<LocationRow>(db, 'SELECT * FROM locations WHERE active = 1 ORDER BY id LIMIT 1'));
  if (!loc) throw new Error('No active location configured');
  return loc;
}

export const travelBandsOf = (loc: LocationRow): TravelBand[] =>
  parseJson<TravelBand[]>(loc.travel_bands, []).map((b) => ({ upTo: Number(b.upTo), fee: Number(b.fee), label: String(b.label ?? '') })).filter((b) => Number.isFinite(b.upTo));

export function capacityOf(loc: LocationRow): Record<SlotKey, number> {
  const rows = parseJson<{ slot: string; capacity: number }[]>(loc.slot_capacity, []);
  const out: Record<SlotKey, number> = { morning: 2, afternoon: 2, evening: 1 };
  for (const r of rows) if (r.slot in SLOTS) out[r.slot as SlotKey] = Math.max(0, Number(r.capacity) || 0);
  return out;
}

export async function getPeakRules(db: D1Database): Promise<PeakRule[]> {
  const rows = await all<{ id: number; name: string; weekdays: string; slots: string; adjust_type: 'percent' | 'fixed'; value: number }>(db, 'SELECT * FROM pricing_rules WHERE active = 1');
  return rows.map((r) => ({ id: r.id, name: r.name, weekdays: parseJson<number[]>(r.weekdays, []), slots: parseJson<string[]>(r.slots, []), adjust_type: r.adjust_type, value: r.value }));
}

export async function getQuoteConfig(db: D1Database, settings: Settings, loc: LocationRow): Promise<QuoteConfig> {
  const [packages, peakRules] = await Promise.all([getPackages(db), getPeakRules(db)]);
  return { packages: packages.map(toPackageLite), travelBands: travelBandsOf(loc), maxMiles: loc.max_miles, pricing: settings.pricing, peakRules };
}

/** Look up a promo or referral code and check it is currently redeemable. */
export async function findPromo(db: D1Database, rawCode: string, today: string, customerId?: number | null): Promise<{ promo: PromoInfo | null; error: string }> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) return { promo: null, error: '' };
  const row = await first<{ code: string; kind: 'promo' | 'referral'; discount_type: 'percent' | 'fixed'; value: number; min_spend: number; description: string; starts_on: string | null; expires_on: string | null; max_uses: number | null; used_count: number; owner_customer_id: number | null }>(
    db, 'SELECT * FROM promo_codes WHERE code = ? AND active = 1', code,
  );
  if (!row) return { promo: null, error: 'That code is not recognised.' };
  if (row.starts_on && today < row.starts_on) return { promo: null, error: 'That code is not active yet.' };
  if (row.expires_on && today > row.expires_on) return { promo: null, error: 'That code has expired.' };
  if (row.max_uses != null && row.used_count >= row.max_uses) return { promo: null, error: 'That code has been fully redeemed.' };
  if (row.kind === 'referral' && customerId && row.owner_customer_id === customerId) return { promo: null, error: 'You cannot use your own referral code.' };
  return { promo: { code: row.code, kind: row.kind, discount_type: row.discount_type, value: row.value, min_spend: row.min_spend, description: row.description }, error: '' };
}

/**
 * Real remaining capacity for each day in a range. A job spanning several slots
 * consumes capacity in each one. Emergency ("asap") jobs are squeezed in and do not
 * reduce standard capacity.
 */
export async function getAvailability(
  db: D1Database, settings: Settings, loc: LocationRow, from: string, days: number, excludeBookingId = 0,
): Promise<DayAvailability[]> {
  const to = addDays(from, days - 1);
  const [bookings, blocked] = await Promise.all([
    all<{ date: string; slot: string; slot_span: number }>(
      db, "SELECT date, slot, slot_span FROM bookings WHERE location_id = ? AND date BETWEEN ? AND ? AND status NOT IN ('cancelled','no_show') AND id <> ?", loc.id, from, to, excludeBookingId,
    ),
    all<{ date: string; reason: string }>(db, 'SELECT date, reason FROM blocked_dates WHERE date BETWEEN ? AND ?', from, to),
  ]);
  const blockedMap = new Map(blocked.map((b) => [b.date, b.reason]));
  const used = new Map<string, number>();
  for (const b of bookings) {
    if (b.slot === 'asap') continue;
    for (const s of slotsCovered(b.slot as SlotKey, Math.max(1, b.slot_span)) ?? [b.slot as SlotKey]) {
      used.set(`${b.date}|${s}`, (used.get(`${b.date}|${s}`) ?? 0) + 1);
    }
  }
  const capacity = capacityOf(loc);
  const today = todayIn(loc.timezone);
  const hourNow = hourIn(loc.timezone);
  const horizon = addDays(today, settings.booking.horizonDays);

  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const offered = settings.business.slotsByWeekday[weekdayOf(date)] ?? [];
    const day: DayAvailability = { date, closed: false, reason: '', slots: {} };
    if (date < today) Object.assign(day, { closed: true, reason: 'Past' });
    else if (date > horizon) Object.assign(day, { closed: true, reason: 'Not yet open for booking' });
    else if (blockedMap.has(date)) Object.assign(day, { closed: true, reason: blockedMap.get(date) || 'Unavailable' });
    else if (offered.length === 0) Object.assign(day, { closed: true, reason: 'Closed' });
    else {
      for (const slot of SLOT_ORDER) {
        if (!offered.includes(slot)) continue;
        // Today: a window must still be at least `leadHours` away from starting to close.
        if (date === today && hourNow + settings.booking.leadHours > SLOTS[slot].endHour - 1) continue;
        day.slots[slot] = Math.max(0, capacity[slot] - (used.get(`${date}|${slot}`) ?? 0));
      }
      const offeredNow = Object.keys(day.slots).length;
      if (offeredNow === 0) Object.assign(day, { closed: true, reason: 'No windows left today' });
      else if (Object.values(day.slots).every((n) => !n)) day.reason = 'Fully booked';
    }
    out.push(day);
  }
  return out;
}

export async function slotIsFree(db: D1Database, settings: Settings, loc: LocationRow, date: string, slot: SlotKey, span: number, excludeBookingId = 0): Promise<boolean> {
  const [day] = await getAvailability(db, settings, loc, date, 1, excludeBookingId);
  return fitsDay(day, slot, span);
}
