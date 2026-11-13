// Business configuration lives in the `settings` table as JSON documents, merged over
// these defaults. Everything here is editable from Admin → Settings.
import type { TaxSettings } from '../../shared/pricing';
import type { BusinessSettings, PricingSettings } from '../../shared/types';
import { all, parseJson, stmt } from './db';

export interface Settings {
  business: BusinessSettings;
  pricing: PricingSettings;
  booking: {
    autoConfirm: boolean;
    /** Minimum notice (hours) for a standard, non-emergency booking. */
    leadHours: number;
    horizonDays: number;
    maxVehicles: number;
    reminderHoursBefore: number;
    reviewDelayMinutes: number;
    serviceReminderMonths: number;
    avgSpeedMph: number;
  };
  branding: {
    logoMediaId: number | null;
    /** Square PWA / favicon icons generated from the logo in the admin (192 and 512 px PNG). */
    icon192MediaId: number | null;
    icon512MediaId: number | null;
    themeDefault: 'dark' | 'light';
    heroHeadline: string;
    heroSub: string;
  };
  integrations: {
    ga4Id: string;
    metaPixelId: string;
    sumupLink: string;
    socialProof: boolean;
    chat: boolean;
    seasonalBanners: boolean;
  };
  tax: TaxSettings & { setAsideNote: string };
  security: { autoLockMinutes: number; sessionDays: number };
}

export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: 'SpecOne Auto Labs',
    legalName: 'SpecOne Auto Labs',
    phone: '07351 453451',
    whatsapp: '+447351453451',
    email: 'info@speconeautolabs.co.uk',
    addressLine: 'Mobile laboratory',
    town: 'Eastbourne',
    region: 'East Sussex',
    postcode: 'BN21',
    country: 'GB',
    currency: 'GBP',
    locale: 'en-GB',
    timezone: 'Europe/London',
    hours: [
      { days: 'Monday – Saturday', open: '07:00', close: '21:00' },
      { days: 'Sunday', open: '10:00', close: '15:30' },
    ],
    slotsByWeekday: [
      ['morning', 'afternoon'],
      ['morning', 'afternoon', 'evening'],
      ['morning', 'afternoon', 'evening'],
      ['morning', 'afternoon', 'evening'],
      ['morning', 'afternoon', 'evening'],
      ['morning', 'afternoon', 'evening'],
      ['morning', 'afternoon', 'evening'],
    ],
    credentials: ['City & Guilds Level 3 certified', 'Fully insured mobile technician', 'Dealer-level Autel & FORScan tooling', 'Pay on completion'],
    googleReviewUrl: 'https://share.google/RLp58PVTK2ixx0Tg8',
    googleMapsUrl: '',
    googlePlaceId: '',
    social: { instagram: '', tiktok: '', facebook: '', youtube: '' },
    leadEngineer: 'Hashim Aasim',
  },
  pricing: {
    bundle: { two: 1500, threePlus: 3500 },
    multiVehiclePct: 5,
    emergencyFee: 3500,
    deposit: { mode: 'optional', percent: 20, minimum: 2000, threshold: 20000 },
    loyalty: { enabled: true, pointsPerPound: 1, pointValue: 5, minRedeem: 100, referrerPoints: 300 },
    labourRates: [
      { key: 'standard', label: 'Standard diagnostic labour', rate: 9500 },
      { key: 'complex', label: 'Complex electrical / oscilloscope fault-finding', rate: 11500 },
      { key: 'detailing', label: 'Detailing labour', rate: 4500 },
      { key: 'out_of_hours', label: 'Out-of-hours / emergency labour', rate: 13000 },
    ],
    vat: { registered: false, rate: 20, number: '' },
  },
  booking: {
    autoConfirm: true,
    leadHours: 3,
    horizonDays: 60,
    maxVehicles: 5,
    reminderHoursBefore: 24,
    reviewDelayMinutes: 120,
    serviceReminderMonths: 11,
    avgSpeedMph: 26,
  },
  branding: {
    logoMediaId: null,
    icon192MediaId: null,
    icon512MediaId: null,
    themeDefault: 'dark',
    heroHeadline: 'Dealer-level diagnostics. On your driveway.',
    heroSub: 'A fully equipped mobile laboratory for fault-finding, OEM coding, DPF recovery and restorative detailing across East Sussex. Fixed prices. Pay on completion.',
  },
  integrations: { ga4Id: '', metaPixelId: '', sumupLink: '', socialProof: true, chat: true, seasonalBanners: true },
  tax: {
    personalAllowance: 12_570_00,
    basicRateLimit: 50_270_00,
    higherRateLimit: 125_140_00,
    basicRate: 20,
    higherRate: 40,
    additionalRate: 45,
    ni4LowerLimit: 12_570_00,
    ni4UpperLimit: 50_270_00,
    ni4MainRate: 6,
    ni4UpperRate: 2,
    taxYearStartMonth: 4,
    taxYearStartDay: 6,
    setAsideNote: 'Estimate only: sole-trader income tax and Class 4 National Insurance on profit. Confirm rates and allowances with your accountant.',
  },
  security: { autoLockMinutes: 5, sessionDays: 14 },
};

export type SettingsKey = keyof Settings;
export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return (override === undefined || override === null ? base : (override as T));
  if (typeof override !== 'object' || override === null || Array.isArray(override)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

let cache: { at: number; value: Settings } | null = null;
const CACHE_MS = 20_000;

export async function getSettings(db: D1Database, fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, parseJson<unknown>(r.value, null)]));
  const value = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, deepMerge(DEFAULT_SETTINGS[k], stored[k])])) as unknown as Settings;
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSetting<K extends SettingsKey>(db: D1Database, key: K, value: Settings[K]): Promise<void> {
  await stmt(db, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')", key, JSON.stringify(value)).run();
  cache = null;
}

/** Free-form key/value flags (seed version, staff presence…) stored alongside settings. */
export async function getFlag(db: D1Database, key: string): Promise<string | null> {
  const row = await stmt(db, 'SELECT value FROM settings WHERE key = ?', `flag:${key}`).first<{ value: string }>();
  return row?.value ?? null;
}
export async function setFlag(db: D1Database, key: string, value: string): Promise<void> {
  await stmt(db, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')", `flag:${key}`, value).run();
}
export const invalidateSettings = (): void => {
  cache = null;
};
