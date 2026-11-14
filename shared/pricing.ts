// The quote engine. Pure and deterministic: the booking wizard runs it for instant
// feedback and the Worker re-runs it on submit, so the server total is always authoritative.
import type { Size } from './constants';
import { weekdayOf } from './format';
import type { PackageLite, PeakRule, Quote, QuoteConfig, QuoteInput, QuoteLine, TravelBand } from './types';

export const SLOT_MINUTES = 240;

export function priceFor(pkg: Pick<PackageLite, 'price_s' | 'price_m' | 'price_l'>, size: Size): number {
  return size === 'S' ? pkg.price_s : size === 'L' ? pkg.price_l : pkg.price_m;
}

export function travelFor(miles: number | null | undefined, bands: TravelBand[], maxMiles: number): { fee: number; label: string; outOfArea: boolean } {
  if (miles == null || !Number.isFinite(miles)) return { fee: 0, label: '', outOfArea: false };
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo);
  const band = sorted.find((b) => miles <= b.upTo);
  if (band) return { fee: band.fee, label: band.label, outOfArea: false };
  const last = sorted[sorted.length - 1];
  return { fee: last?.fee ?? 0, label: last?.label ?? '', outOfArea: miles > maxMiles };
}

export function matchPeakRules(rules: PeakRule[], date: string | null | undefined, slot: string | null | undefined): PeakRule[] {
  if (!date || !slot) return [];
  const weekday = weekdayOf(date);
  return rules.filter((r) => (r.weekdays.length === 0 || r.weekdays.includes(weekday)) && (r.slots.length === 0 || r.slots.includes(slot)));
}

/** How many consecutive 4-hour slots a job of this length occupies (max a full day). */
export const slotSpanFor = (durationMin: number): number => Math.min(3, Math.max(1, Math.ceil(durationMin / SLOT_MINUTES)));

export function computeQuote(input: QuoteInput, config: QuoteConfig): Quote {
  const byId = new Map(config.packages.map((p) => [p.id, p]));
  const { pricing } = config;
  const lines: QuoteLine[] = [];
  let subtotal = 0;
  let bundleDiscount = 0;
  let multiVehicleDiscount = 0;
  let durationMin = 0;
  let needsUtilities = false;

  input.vehicles.forEach((vehicle, vehicleIndex) => {
    let vehicleTotal = 0;
    let counted = 0;
    for (const id of [...new Set(vehicle.packageIds)]) {
      const pkg = byId.get(id);
      if (!pkg) continue;
      const price = priceFor(pkg, vehicle.size);
      lines.push({ vehicleIndex, packageId: pkg.id, name: pkg.name, price, durationMin: pkg.duration_min });
      vehicleTotal += price;
      durationMin += pkg.duration_min;
      if (pkg.needs_utilities) needsUtilities = true;
      if (pkg.category !== 'plan') counted++;
    }
    subtotal += vehicleTotal;
    const bundle = counted >= 3 ? pricing.bundle.threePlus : counted === 2 ? pricing.bundle.two : 0;
    const vehicleBundle = Math.min(bundle, Math.floor(vehicleTotal / 2));
    bundleDiscount += vehicleBundle;
    if (vehicleIndex > 0 && pricing.multiVehiclePct > 0) {
      multiVehicleDiscount += Math.round(((vehicleTotal - vehicleBundle) * pricing.multiVehiclePct) / 100);
    }
  });

  let net = subtotal - bundleDiscount - multiVehicleDiscount;

  // Trade pricing and promo codes do not stack: trade accounts already have a negotiated rate.
  const tradePct = Math.min(Math.max(input.tradeDiscountPct ?? 0, 0), 60);
  const tradeDiscount = Math.round((net * tradePct) / 100);
  net -= tradeDiscount;

  let promoDiscount = 0;
  const promo = tradePct > 0 ? null : input.promo;
  if (promo && net >= promo.min_spend) {
    promoDiscount = promo.discount_type === 'percent' ? Math.round((net * Math.min(promo.value, 100)) / 100) : Math.min(promo.value, net);
    net -= promoDiscount;
  }

  // Peak-hour rules adjust the labour value of the job, not travel or call-out fees.
  let peakAdjustment = 0;
  const matched = input.emergency ? [] : matchPeakRules(config.peakRules, input.date, input.slot);
  for (const rule of matched) {
    peakAdjustment += rule.adjust_type === 'percent' ? Math.round((net * rule.value) / 100) : rule.value;
  }
  if (net + peakAdjustment < 0) peakAdjustment = -net;

  const mobile = (input.serviceMode ?? 'mobile') === 'mobile';
  const travel = mobile ? travelFor(input.distanceMiles, config.travelBands, config.maxMiles) : { fee: 0, label: 'Lab drop-off', outOfArea: false };
  const emergencyFee = input.emergency ? pricing.emergencyFee : 0;

  const beforeLoyalty = net + peakAdjustment + travel.fee + emergencyFee;

  let loyaltyDiscount = 0;
  let loyaltyPointsUsed = 0;
  const requested = Math.max(0, Math.floor(input.loyaltyPoints ?? 0));
  if (pricing.loyalty.enabled && requested >= pricing.loyalty.minRedeem && pricing.loyalty.pointValue > 0) {
    loyaltyPointsUsed = Math.min(requested, Math.floor(beforeLoyalty / pricing.loyalty.pointValue));
    loyaltyDiscount = loyaltyPointsUsed * pricing.loyalty.pointValue;
  }

  const total = Math.max(0, beforeLoyalty - loyaltyDiscount);

  const dep = pricing.deposit;
  let depositDue = 0;
  let depositRequired = false;
  if (dep.mode !== 'off' && total > 0) {
    depositDue = Math.min(total, Math.max(dep.minimum, Math.round((total * dep.percent) / 100)));
    depositRequired = dep.mode === 'required_over' && total >= dep.threshold;
  }

  return {
    lines,
    subtotal,
    bundleDiscount,
    multiVehicleDiscount,
    tradeDiscount,
    promoDiscount,
    loyaltyDiscount,
    loyaltyPointsUsed,
    discountTotal: bundleDiscount + multiVehicleDiscount + tradeDiscount + promoDiscount + loyaltyDiscount,
    peakAdjustment,
    peakLabel: matched.map((r) => r.name).join(' + '),
    travelFee: travel.fee,
    travelLabel: travel.label,
    emergencyFee,
    total,
    depositDue,
    depositRequired,
    durationMin,
    slotSpan: slotSpanFor(durationMin),
    outOfArea: travel.outOfArea,
    needsUtilities,
    pointsEarned: pricing.loyalty.enabled ? Math.floor((total / 100) * pricing.loyalty.pointsPerPound) : 0,
  };
}

/** Labour charge for the job-card calculator: hours × rate, rounded to the nearest 5p. */
export function labourCharge(hours: number, ratePerHour: number, multiplier = 1): number {
  return Math.round((hours * ratePerHour * multiplier) / 5) * 5;
}

export interface TaxSettings {
  personalAllowance: number;
  basicRateLimit: number;
  higherRateLimit: number;
  basicRate: number;
  higherRate: number;
  additionalRate: number;
  ni4LowerLimit: number;
  ni4UpperLimit: number;
  ni4MainRate: number;
  ni4UpperRate: number;
  taxYearStartMonth: number;
  taxYearStartDay: number;
}

/**
 * Rough sole-trader estimate (income tax + Class 4 NI) on annual profit, in minor units.
 * A planning aid for setting money aside — not a substitute for an accountant.
 */
export function estimateTax(profit: number, t: TaxSettings): { incomeTax: number; nationalInsurance: number; total: number; effectiveRate: number } {
  const p = Math.max(0, profit);
  // The personal allowance tapers away by £1 for every £2 earned over £100,000.
  const taperStart = 100_000_00;
  const allowance = p > taperStart ? Math.max(0, t.personalAllowance - Math.floor((p - taperStart) / 2)) : t.personalAllowance;
  const taxable = Math.max(0, p - allowance);
  const basicBand = Math.max(0, t.basicRateLimit - t.personalAllowance);
  const higherBand = Math.max(0, t.higherRateLimit - allowance - basicBand);
  const basic = Math.min(taxable, basicBand);
  const higher = Math.min(Math.max(0, taxable - basicBand), higherBand);
  const additional = Math.max(0, taxable - basicBand - higherBand);
  const incomeTax = Math.round((basic * t.basicRate + higher * t.higherRate + additional * t.additionalRate) / 100);
  const niMain = Math.max(0, Math.min(p, t.ni4UpperLimit) - t.ni4LowerLimit);
  const niUpper = Math.max(0, p - t.ni4UpperLimit);
  const nationalInsurance = Math.round((niMain * t.ni4MainRate + niUpper * t.ni4UpperRate) / 100);
  const total = incomeTax + nationalInsurance;
  return { incomeTax, nationalInsurance, total, effectiveRate: p > 0 ? total / p : 0 };
}

/** The tax year (as [start, end] ISO dates) containing a given date. UK default: 6 April – 5 April. */
export function taxYearFor(date: string, startMonth = 4, startDay = 6): { start: string; end: string; label: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const startYear = m > startMonth || (m === startMonth && d >= startDay) ? y : y - 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${startYear}-${pad(startMonth)}-${pad(startDay)}`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay - 1));
  return { start, end: endDate.toISOString().slice(0, 10), label: `${startYear}/${String(startYear + 1).slice(2)}` };
}
