import { describe, expect, it } from 'vitest';
import { fitsDay, slotsCovered } from '../shared/availability';
import { computeQuote, estimateTax, labourCharge, slotSpanFor, taxYearFor, travelFor } from '../shared/pricing';
import type { PackageLite, QuoteConfig } from '../shared/types';

const pkg = (id: number, s: number, m: number, l: number, extra: Partial<PackageLite> = {}): PackageLite => ({
  id, slug: `p${id}`, category: 'diagnostics', zone: 'engine', badge: '', name: `Package ${id}`, summary: '', includes: [], duration_min: 60,
  price_s: s, price_m: m, price_l: l, needs_utilities: 0, featured: 0, ...extra,
});

const config: QuoteConfig = {
  packages: [pkg(1, 9500, 9500, 9500), pkg(2, 7000, 7000, 7000), pkg(3, 6000, 6000, 6000), pkg(4, 9500, 11000, 13000, { category: 'detailing', needs_utilities: 1, duration_min: 300 })],
  travelBands: [{ upTo: 8, fee: 0, label: 'Zone 1' }, { upTo: 18, fee: 1000, label: 'Zone 2' }, { upTo: 45, fee: 2000, label: 'Zone 3' }],
  maxMiles: 45,
  pricing: {
    bundle: { two: 1500, threePlus: 3500 },
    multiVehiclePct: 5,
    emergencyFee: 3500,
    deposit: { mode: 'optional', percent: 20, minimum: 2000, threshold: 20000 },
    loyalty: { enabled: true, pointsPerPound: 1, pointValue: 5, minRedeem: 100, referrerPoints: 300 },
    labourRates: [],
    vat: { registered: false, rate: 20, number: '' },
  },
  peakRules: [{ id: 1, name: 'Sunday', weekdays: [0], slots: [], adjust_type: 'percent', value: 10 }],
};

describe('computeQuote', () => {
  it('applies the two-package bundle saving per vehicle', () => {
    const q = computeQuote({ vehicles: [{ size: 'M', packageIds: [1, 2] }] }, config);
    expect(q.subtotal).toBe(16500);
    expect(q.bundleDiscount).toBe(1500);
    expect(q.total).toBe(15000);
  });

  it('matches the booking verified end to end: two vehicles, bundle, multi-vehicle and 10% promo', () => {
    const q = computeQuote({
      vehicles: [{ size: 'M', packageIds: [1, 2] }, { size: 'M', packageIds: [3] }],
      promo: { code: 'WINTER10', kind: 'promo', discount_type: 'percent', value: 10, min_spend: 0, description: '' },
    }, config);
    expect(q.multiVehicleDiscount).toBe(300);
    expect(q.promoDiscount).toBe(2070);
    expect(q.total).toBe(18630);
    expect(q.depositDue).toBe(3726);
  });

  it('prices detailing by size and flags utilities', () => {
    const q = computeQuote({ vehicles: [{ size: 'L', packageIds: [4] }] }, config);
    expect(q.total).toBe(13000);
    expect(q.needsUtilities).toBe(true);
    expect(q.slotSpan).toBe(2);
  });

  it('adds travel by band and refuses beyond the maximum distance', () => {
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], distanceMiles: 12 }, config).travelFee).toBe(1000);
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], distanceMiles: 60 }, config).outOfArea).toBe(true);
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], distanceMiles: 60, serviceMode: 'drop_off' }, config).travelFee).toBe(0);
  });

  it('applies peak rules to the job but not to emergency call-outs', () => {
    const sunday = '2026-11-15';
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], date: sunday, slot: 'morning' }, config).peakAdjustment).toBe(950);
    const sos = computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], date: sunday, slot: 'asap', emergency: true }, config);
    expect(sos.peakAdjustment).toBe(0);
    expect(sos.emergencyFee).toBe(3500);
  });

  it('does not stack trade rates with promo codes', () => {
    const q = computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], tradeDiscountPct: 20, promo: { code: 'X', kind: 'promo', discount_type: 'percent', value: 10, min_spend: 0, description: '' } }, config);
    expect(q.tradeDiscount).toBe(1900);
    expect(q.promoDiscount).toBe(0);
  });

  it('redeems loyalty points only above the minimum and never below zero', () => {
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [1] }], loyaltyPoints: 50 }, config).loyaltyDiscount).toBe(0);
    const q = computeQuote({ vehicles: [{ size: 'M', packageIds: [3] }], loyaltyPoints: 100000 }, config);
    expect(q.total).toBe(0);
    expect(q.loyaltyPointsUsed).toBe(1200);
  });

  it('ignores unknown package ids', () => {
    expect(computeQuote({ vehicles: [{ size: 'M', packageIds: [999] }] }, config).total).toBe(0);
  });
});

describe('availability helpers', () => {
  it('maps job length to consecutive windows', () => {
    expect(slotSpanFor(60)).toBe(1);
    expect(slotSpanFor(300)).toBe(2);
    expect(slotSpanFor(2000)).toBe(3);
    expect(slotsCovered('afternoon', 2)).toEqual(['afternoon', 'evening']);
    expect(slotsCovered('evening', 2)).toBeNull();
  });
  it('requires every covered window to have room', () => {
    const day = { date: '2026-11-20', closed: false, reason: '', slots: { morning: 1, afternoon: 0, evening: 1 } };
    expect(fitsDay(day, 'morning', 1)).toBe(true);
    expect(fitsDay(day, 'morning', 2)).toBe(false);
    expect(fitsDay({ ...day, closed: true }, 'morning', 1)).toBe(false);
  });
});

describe('money helpers', () => {
  it('rounds labour to the nearest 5p', () => {
    expect(labourCharge(0.5, 9500)).toBe(4750);
    expect(labourCharge(1 / 3, 9500)).toBe(3165);
  });
  it('picks the right travel band', () => {
    expect(travelFor(8, config.travelBands, 45).fee).toBe(0);
    expect(travelFor(8.1, config.travelBands, 45).fee).toBe(1000);
    expect(travelFor(null, config.travelBands, 45).fee).toBe(0);
  });
});

describe('tax estimate', () => {
  const t = { personalAllowance: 12_570_00, basicRateLimit: 50_270_00, higherRateLimit: 125_140_00, basicRate: 20, higherRate: 40, additionalRate: 45, ni4LowerLimit: 12_570_00, ni4UpperLimit: 50_270_00, ni4MainRate: 6, ni4UpperRate: 2, taxYearStartMonth: 4, taxYearStartDay: 6 };
  it('is zero within the personal allowance', () => {
    expect(estimateTax(10_000_00, t).total).toBe(0);
  });
  it('charges basic rate and Class 4 NI on profit above the allowance', () => {
    const e = estimateTax(30_000_00, t);
    expect(e.incomeTax).toBe(3_486_00);
    expect(e.nationalInsurance).toBe(1_045_80);
  });
  it('uses the UK tax year boundaries', () => {
    expect(taxYearFor('2026-04-05')).toEqual({ start: '2025-04-06', end: '2026-04-05', label: '2025/26' });
    expect(taxYearFor('2026-04-06').label).toBe('2026/27');
  });
});
