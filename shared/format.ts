// Formatting and normalisation helpers shared by the Worker and the browser apps.

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Format integer minor units ("pence") as currency. Whole amounts drop the decimals: £95, £95.50. */
export function money(minor: number | null | undefined, currency = 'GBP', locale = 'en-GB'): string {
  const value = (minor ?? 0) / 100;
  const whole = Number.isInteger(value);
  const key = `${locale}|${currency}|${whole}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    moneyFormatters.set(key, fmt);
  }
  return fmt.format(value);
}

/** Parse a user-typed amount ("£95", "95.50") into minor units. */
export function parseMoney(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Math.round(input * 100);
  const n = Number(String(input ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export const normReg = (reg: string | null | undefined): string => String(reg ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/** Display a UK registration with its conventional space (AB12 CDE). */
export function formatReg(reg: string | null | undefined): string {
  const r = normReg(reg);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r)) return `${r.slice(0, 4)} ${r.slice(4)}`;
  if (/^[A-Z]\d{1,3}[A-Z]{3}$/.test(r)) return `${r.slice(0, -3)} ${r.slice(-3)}`;
  return r;
}

/** Year of first registration implied by a current-format UK plate (AB12 CDE → 2012). */
export function regYear(reg: string): number | null {
  const m = /^[A-Z]{2}(\d{2})[A-Z]{3}$/.exec(normReg(reg));
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 0 || n === 50) return null;
  const year = n >= 51 ? 2000 + n - 50 : 2000 + n;
  return year >= 2001 && year <= new Date().getUTCFullYear() + 1 ? year : null;
}

/** Normalise a phone number to E.164, assuming UK national format when no country code is given. */
export function normPhone(phone: string | null | undefined, defaultCountry = '44'): string {
  let p = String(phone ?? '').replace(/[^0-9+]/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('+')) return '+' + p.slice(1).replace(/\D/g, '');
  if (p.startsWith('0')) return `+${defaultCountry}${p.slice(1)}`;
  if (p.startsWith(defaultCountry)) return `+${p}`;
  return `+${defaultCountry}${p}`;
}

export function displayPhone(phone: string | null | undefined): string {
  const p = normPhone(phone);
  if (p.startsWith('+447') && p.length === 13) return `0${p.slice(3, 7)} ${p.slice(7)}`;
  if (p.startsWith('+44')) return `0${p.slice(3)}`;
  return p;
}

export const isValidPhone = (phone: string): boolean => /^\+\d{9,15}$/.test(normPhone(phone));
export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

const UK_POSTCODE = /^(GIR0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]([0-9]|[ABEHMNPRV-Y])?|[0-9][A-HJKPS-UW])[0-9][ABD-HJLNP-UW-Z]{2})$/;
export const isUkPostcode = (pc: string): boolean => UK_POSTCODE.test(String(pc ?? '').toUpperCase().replace(/\s/g, ''));
export function normPostcode(pc: string | null | undefined): string {
  const p = String(pc ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length > 3 ? `${p.slice(0, -3)} ${p.slice(-3)}` : p;
}
/** Outward code ("BN21") — safe to show publicly. */
export const outwardCode = (pc: string | null | undefined): string => normPostcode(pc).split(' ')[0] ?? '';

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Dates. Calendar dates are plain YYYY-MM-DD strings; maths is done in UTC. ──
export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function todayIn(timeZone = 'Europe/London', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Current hour (0–23.99) in a time zone, as a decimal. */
export function hourIn(timeZone = 'Europe/London', now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function formatDate(date: string | null | undefined, style: 'short' | 'long' | 'day' = 'short', locale = 'en-GB'): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(d.getTime())) return String(date);
  const opts: Intl.DateTimeFormatOptions =
    style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : style === 'day' ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: date.length === 10 ? 'UTC' : 'Europe/London' }).format(d);
}
export function formatDateTime(iso: string | null | undefined, locale = 'en-GB', timeZone = 'Europe/London'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(d);
}
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 7)} weeks ago`;
}
export function durationLabel(minutes: number): string {
  if (minutes >= 1440) return `${Math.round(minutes / 480)} day${minutes >= 960 ? 's' : ''}`;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr${h === 1 ? '' : 's'}`;
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
export const titleCase = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
}
