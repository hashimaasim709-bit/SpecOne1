// External lookups: postcode geocoding, address pick-lists and vehicle registration data.
// Each provider is optional; the booking flow degrades gracefully to manual entry.
import type { Body, Size } from '../../shared/constants';
import { classifyVehicle } from '../../shared/vehicle';
import { haversineMiles, isUkPostcode, normPostcode, normReg, regYear, titleCase } from '../../shared/format';
import type { Env } from '../env';
import { first } from '../lib/db';

export interface GeoResult {
  postcode: string;
  lat: number;
  lng: number;
  town: string;
  district: string;
  miles: number;
}

async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Geocode a UK postcode with postcodes.io (ONS / Ordnance Survey open data, no key required). */
export async function geocodePostcode(rawPostcode: string, base: { lat: number; lng: number }): Promise<GeoResult | null> {
  const postcode = normPostcode(rawPostcode);
  if (!isUkPostcode(postcode)) return null;
  const data = await getJson<{ result?: { postcode: string; latitude: number; longitude: number; admin_district?: string; admin_ward?: string; parish?: string; post_town?: string } }>(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(' ', ''))}`,
    { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit,
  );
  const r = data?.result;
  if (!r || typeof r.latitude !== 'number') return null;
  const parish = r.parish && !/unparished/i.test(r.parish) ? r.parish : '';
  return {
    postcode: r.postcode,
    lat: r.latitude,
    lng: r.longitude,
    town: parish || r.admin_ward || r.admin_district || '',
    district: r.admin_district ?? '',
    miles: Math.round(haversineMiles(base.lat, base.lng, r.latitude, r.longitude) * 10) / 10,
  };
}

/**
 * Street-level address list for a postcode from a Royal Mail PAF provider.
 * Supports getAddress.io and Ideal Postcodes — set whichever API key you have.
 */
export async function lookupAddresses(env: Env, rawPostcode: string): Promise<string[]> {
  const pc = normPostcode(rawPostcode).replace(' ', '');
  if (!isUkPostcode(pc)) return [];
  if (env.GETADDRESS_API_KEY) {
    const data = await getJson<{ addresses?: { formatted_address?: string[]; line_1?: string; town_or_city?: string }[] }>(
      `https://api.getAddress.io/find/${encodeURIComponent(pc)}?api-key=${encodeURIComponent(env.GETADDRESS_API_KEY)}&expand=true&sort=true`,
    );
    return (data?.addresses ?? []).map((a) => (a.formatted_address ?? [a.line_1, a.town_or_city]).filter(Boolean).join(', ')).filter(Boolean).slice(0, 120);
  }
  if (env.IDEAL_POSTCODES_API_KEY) {
    const data = await getJson<{ result?: { line_1?: string; line_2?: string; line_3?: string; post_town?: string }[] }>(
      `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(pc)}?api_key=${encodeURIComponent(env.IDEAL_POSTCODES_API_KEY)}`,
    );
    return (data?.result ?? []).map((a) => [a.line_1, a.line_2, a.line_3, a.post_town ? titleCase(a.post_town) : ''].filter(Boolean).join(', ')).slice(0, 120);
  }
  return [];
}

export const hasAddressLookup = (env: Env): boolean => !!(env.GETADDRESS_API_KEY || env.IDEAL_POSTCODES_API_KEY);

export interface VehicleLookup {
  found: boolean;
  source: 'dvla' | 'history' | 'plate' | 'none';
  reg: string;
  make: string;
  model: string;
  year: number | null;
  fuel: string;
  colour: string;
  motDue: string | null;
  size: Size | null;
  body: Body | null;
}

/**
 * Registration lookup. Uses the DVLA Vehicle Enquiry Service when DVLA_API_KEY is set
 * (make, year, fuel, colour, MOT expiry), enriched with any model we already hold for the plate.
 */
export async function lookupReg(env: Env, rawReg: string): Promise<VehicleLookup> {
  const reg = normReg(rawReg);
  const out: VehicleLookup = { found: false, source: 'none', reg, make: '', model: '', year: regYear(reg), fuel: '', colour: '', motDue: null, size: null, body: null };
  if (reg.length < 2) return out;

  const known = await first<{ make: string; model: string; year: number | null; fuel: string; colour: string; size: Size; body: Body; mot_due: string | null }>(
    env.DB, 'SELECT make, model, year, fuel, colour, size, body, mot_due FROM vehicles WHERE reg = ? ORDER BY id DESC LIMIT 1', reg,
  );

  if (env.DVLA_API_KEY) {
    const data = await getJson<{ make?: string; yearOfManufacture?: number; fuelType?: string; colour?: string; motExpiryDate?: string; typeApproval?: string }>(
      'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      { method: 'POST', headers: { 'x-api-key': env.DVLA_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNumber: reg }) },
    );
    if (data?.make) {
      const make = titleCase(data.make);
      const model = known?.model ?? '';
      const guess = classifyVehicle(`${make} ${model}`);
      const isVan = /^N[123]$/.test(data.typeApproval ?? '');
      return {
        found: true, source: 'dvla', reg, make, model,
        year: data.yearOfManufacture ?? out.year,
        fuel: titleCase(data.fuelType ?? ''), colour: titleCase(data.colour ?? ''),
        motDue: data.motExpiryDate ?? known?.mot_due ?? null,
        size: known?.size ?? (isVan ? 'L' : model ? guess.size : null),
        body: known?.body ?? (isVan ? 'van' : model ? guess.body : null),
      };
    }
  }
  if (known?.make) {
    return { found: true, source: 'history', reg, make: known.make, model: known.model, year: known.year ?? out.year, fuel: known.fuel, colour: known.colour, motDue: known.mot_due, size: known.size, body: known.body };
  }
  return { ...out, found: out.year != null, source: out.year != null ? 'plate' : 'none' };
}

/** Straight-line distance padded for real roads, converted to a drive-time estimate. */
export function etaMinutes(fromLat: number, fromLng: number, toLat: number, toLng: number, avgSpeedMph: number): number {
  const roadMiles = haversineMiles(fromLat, fromLng, toLat, toLng) * 1.3;
  return Math.max(1, Math.round((roadMiles / Math.max(avgSpeedMph, 5)) * 60));
}
