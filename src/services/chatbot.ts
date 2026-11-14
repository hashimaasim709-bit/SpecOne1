// Chat assistant auto-replies. Answers about pricing, coverage and hours are generated
// from live settings so they can never drift from the real catalogue; anything else is
// matched against the editable rules in Admin → Marketing → Chat auto-replies.
import { money } from '../../shared/format';
import { all } from '../lib/db';
import type { Settings } from '../lib/settings';
import { getLocation, getPackages, travelBandsOf } from './catalog';

const has = (q: string, ...terms: string[]): boolean => terms.some((t) => q.includes(t));

export async function autoReply(db: D1Database, settings: Settings, message: string): Promise<string> {
  const q = ` ${message.toLowerCase().replace(/[^a-z0-9£ ]+/g, ' ')} `;
  const b = settings.business;

  const rules = await all<{ keywords: string; answer: string }>(db, 'SELECT keywords, answer FROM chatbot_rules WHERE active = 1 ORDER BY sort, id');
  for (const rule of rules) {
    const keys = rule.keywords.toLowerCase().split(',').map((k) => k.trim()).filter(Boolean);
    if (keys.some((k) => q.includes(k))) return rule.answer;
  }

  if (has(q, ' price', ' cost', 'how much', ' quote', ' rates', ' charge', '£')) {
    const packages = await getPackages(db);
    const cur = b.currency;
    const pick = (cat: string) => packages.filter((p) => p.category === cat).sort((a, z) => a.price_s - z.price_s);
    const diag = pick('diagnostics');
    const detail = pick('detailing');
    // Match what the customer typed against package names and slugs ("dpf regen" → DPF package).
    const STOP = new Set(['how', 'much', 'price', 'cost', 'costs', 'quote', 'the', 'for', 'and', 'your', 'you', 'what', 'does', 'charge', 'rates', 'need', 'car', 'van', 'please', 'with', 'can']);
    const words = q.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
    let mentioned: (typeof packages)[number] | undefined;
    let best = 0;
    for (const p of packages) {
      const hay = `${p.name} ${p.slug} ${p.badge}`.toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length;
      if (score > best) {
        best = score;
        mentioned = p;
      }
    }
    if (mentioned) return `${mentioned.name} is ${mentioned.price_s === mentioned.price_l ? money(mentioned.price_m, cur) : `${money(mentioned.price_s, cur)}–${money(mentioned.price_l, cur)} depending on vehicle size`}. Prices are fixed and you pay on completion. You can book it at /book.`;
    return `Diagnostics start from ${money(diag[0]?.price_s ?? 0, cur)} and detailing from ${money(detail[0]?.price_s ?? 0, cur)}. Combine two packages and save ${money(settings.pricing.bundle.two, cur)}, or three for ${money(settings.pricing.bundle.threePlus, cur)} off. Full price list: /services`;
  }
  if (has(q, ' cover', ' area', 'come to', 'travel', 'postcode', ' where ', 'how far', 'location')) {
    const loc = await getLocation(db);
    const bands = travelBandsOf(loc).sort((a, z) => a.upTo - z.upTo);
    const text = bands.map((band) => `up to ${band.upTo} miles ${band.fee ? `+${money(band.fee, loc.currency)}` : 'free call-out'}`).join(', ');
    return `We're a mobile lab based in ${b.town} covering ${b.region}: ${text}. Pop your postcode into the checker at /coverage for an exact figure.`;
  }
  if (has(q, ' open', 'hours', ' when ', 'weekend', 'sunday', 'saturday', 'evening', 'today', 'tomorrow', 'available', 'availability')) {
    return `We work ${b.hours.map((h) => `${h.days} ${h.open}–${h.close}`).join(', ')}. Live availability for each day is shown in the booking calendar at /book — and there is an emergency call-out option for urgent jobs.`;
  }
  if (has(q, 'emergency', 'urgent', 'stranded', 'broken down', 'breakdown', 'asap', "won't start", 'wont start', 'not starting', 'limp')) {
    return `For anything urgent call ${b.phone} now — that's the quickest way to reach the technician. You can also book an emergency call-out online at /book?emergency=1 (${money(settings.pricing.emergencyFee, b.currency)} priority dispatch fee).`;
  }
  if (has(q, ' pay', 'payment', 'deposit', 'card', 'cash', 'apple pay', 'google pay')) {
    return 'You pay on completion — card, Apple Pay, Google Pay, cash or bank transfer. A deposit is optional for most jobs and only used to secure high-value slots.';
  }
  if (has(q, 'water', 'electric', 'power', 'socket', 'driveway', ' tap ')) {
    return 'Diagnostics, coding and DPF work need no mains power or water — we can work at home, at your workplace or at the roadside. Detailing packages need an outside tap and a 240V socket within about 25 metres.';
  }
  if (has(q, ' book', 'appointment', 'slot')) {
    return 'You can book in about a minute at /book — choose your services, pick a day and arrival window, and you will get an instant confirmation with a live tracker link.';
  }
  if (has(q, 'carplay', 'android auto', 'coding', ' code ', 'retrofit', 'feature')) {
    return 'Yes — we activate factory features and code replacement modules on BMW/MINI, VAG, Ford, Land Rover and Mercedes using dealer-level tooling, always with a configuration backup first. See what is possible for your car at /coding.';
  }
  if (has(q, 'dpf', 'adblue', 'regen', 'soot')) {
    return 'We do on-site DPF soot assessment and forced regeneration, plus AdBlue / NOx diagnostics. If you have a fault code, look it up at /fault-codes for likely causes — or book the DPF package at /book.';
  }
  return '';
}

export const FALLBACK_REPLY = (settings: Settings): string =>
  `Thanks for your message — a technician will reply here as soon as they are off the tools. For anything urgent, call ${settings.business.phone}.`;
