// Data shapes exchanged between the Worker and the browser apps.
import type { Body, BookingSlot, BookingStatus, Role, Size, SlotKey } from './constants';

export interface PackageLite {
  id: number;
  slug: string;
  category: 'diagnostics' | 'detailing' | 'plan' | 'addon';
  zone: string;
  badge: string;
  name: string;
  summary: string;
  includes: string[];
  duration_min: number;
  price_s: number;
  price_m: number;
  price_l: number;
  needs_utilities: number;
  featured: number;
}

export interface TravelBand {
  /** Upper bound of the band in miles from base. */
  upTo: number;
  /** Fee in minor units. */
  fee: number;
  label: string;
}

export interface PeakRule {
  id: number;
  name: string;
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  weekdays: number[];
  /** Empty means every slot. */
  slots: string[];
  adjust_type: 'percent' | 'fixed';
  value: number;
}

export interface LabourRate {
  key: string;
  label: string;
  /** Minor units per hour. */
  rate: number;
}

export interface PricingSettings {
  /** Money off per vehicle when 2 / 3+ packages are combined. */
  bundle: { two: number; threePlus: number };
  /** Percentage off every vehicle after the first in one visit. */
  multiVehiclePct: number;
  emergencyFee: number;
  deposit: { mode: 'off' | 'optional' | 'required_over'; percent: number; minimum: number; threshold: number };
  loyalty: { enabled: boolean; pointsPerPound: number; pointValue: number; minRedeem: number; referrerPoints: number };
  labourRates: LabourRate[];
  vat: { registered: boolean; rate: number; number: string };
}

export interface PromoInfo {
  code: string;
  kind: 'promo' | 'referral';
  discount_type: 'percent' | 'fixed';
  value: number;
  min_spend: number;
  description: string;
}

export interface QuoteVehicle {
  size: Size;
  packageIds: number[];
}

export interface QuoteInput {
  vehicles: QuoteVehicle[];
  date?: string | null;
  slot?: BookingSlot | null;
  emergency?: boolean;
  serviceMode?: 'mobile' | 'drop_off';
  distanceMiles?: number | null;
  promo?: PromoInfo | null;
  tradeDiscountPct?: number;
  loyaltyPoints?: number;
}

export interface QuoteConfig {
  packages: PackageLite[];
  travelBands: TravelBand[];
  maxMiles: number;
  pricing: PricingSettings;
  peakRules: PeakRule[];
}

export interface QuoteLine {
  vehicleIndex: number;
  packageId: number;
  name: string;
  price: number;
  durationMin: number;
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  bundleDiscount: number;
  multiVehicleDiscount: number;
  tradeDiscount: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  loyaltyPointsUsed: number;
  discountTotal: number;
  peakAdjustment: number;
  peakLabel: string;
  travelFee: number;
  travelLabel: string;
  emergencyFee: number;
  total: number;
  depositDue: number;
  depositRequired: boolean;
  durationMin: number;
  slotSpan: number;
  outOfArea: boolean;
  needsUtilities: boolean;
  pointsEarned: number;
}

export interface DayAvailability {
  date: string;
  closed: boolean;
  reason: string;
  /** Remaining capacity per slot; a missing slot is not offered that day. */
  slots: Partial<Record<SlotKey, number>>;
}

export interface BusinessSettings {
  name: string;
  legalName: string;
  phone: string;
  whatsapp: string;
  email: string;
  addressLine: string;
  town: string;
  region: string;
  postcode: string;
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  hours: { days: string; open: string; close: string }[];
  /** Which slots are offered on each weekday (index 0 = Sunday). */
  slotsByWeekday: SlotKey[][];
  credentials: string[];
  googleReviewUrl: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  social: { instagram: string; tiktok: string; facebook: string; youtube: string };
  leadEngineer: string;
}

export interface BookingConfig extends QuoteConfig {
  business: Pick<BusinessSettings, 'name' | 'phone' | 'whatsapp' | 'currency' | 'locale' | 'timezone'>;
  base: { lat: number; lng: number; name: string };
  upsells: { triggerCategory: string; triggerSlug: string; suggestSlug: string; message: string }[];
  features: { addressLookup: boolean; regLookup: boolean; onlinePayments: boolean; turnstileSiteKey: string; sumupLink: string };
  maxVehicles: number;
  fleet: { slug: string; companyName: string; discountPct: number } | null;
  customer: { name: string; email: string; phone: string; loyaltyPoints: number } | null;
}

export interface CreateBookingRequest {
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
  payDeposit: boolean;
  utilitiesConfirmed: boolean;
  fleetSlug: string;
  turnstileToken: string;
  /** Honeypot — must stay empty. */
  website: string;
}

export interface CreateBookingResponse {
  ok: true;
  ref: string;
  token: string;
  trackUrl: string;
  total: number;
  depositDue: number;
  checkoutUrl: string | null;
  status: BookingStatus;
  referralCode: string;
}

export interface TrackPayload {
  ref: string;
  status: BookingStatus;
  statusText: string;
  date: string;
  slot: string;
  serviceMode: string;
  address: string;
  destination: { lat: number; lng: number } | null;
  van: { lat: number; lng: number; heading: number | null; updatedAt: string } | null;
  etaMinutes: number | null;
  technician: string;
  vehicles: { reg: string; label: string }[];
  items: { name: string; price: number }[];
  total: number;
  paid: number;
  balance: number;
  currency: string;
  canPayOnline: boolean;
  events: { type: string; detail: string; at: string }[];
  documents: { label: string; href: string }[];
  reviewUrl: string;
  business: { name: string; phone: string; whatsapp: string };
}

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
}

export interface ApiError {
  ok: false;
  error: string;
  fields?: Record<string, string>;
}
