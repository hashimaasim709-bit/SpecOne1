// Site search and symptom advisor. One query returns matching services (including by
// plain-English symptom), fault codes, warning lights, guides, FAQs and pages.
import { money } from '../../shared/format';
import { WARNING_LIGHTS } from '../../shared/warning-lights';
import { all, likeTerm } from '../lib/db';
import { getPackages, type PackageRow } from './catalog';

export interface SearchHit {
  type: 'service' | 'code' | 'light' | 'guide' | 'faq' | 'page' | 'link';
  title: string;
  sub: string;
  href: string;
  meta?: string;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'my', 'car', 'van', 'has', 'have', 'is', 'on', 'in', 'it', 'to', 'of', 'a', 'an', 'how', 'do', 'does', 'can', 'you', 'your', 'what', 'why', 'need', 'get', 'got', 'that', 'this', 'when', 'will', 'not', 'wont', 'keeps', 'keep', 'coming', 'come', 'comes', 'light', 'warning', 'please', 'help', 'me', 'i']);

/** Plain-English symptoms → the packages that solve them. Phrases are matched against the whole query. */
export const SYMPTOMS: [string[], string[]][] = [
  [['limp', 'engine light', 'engine management', 'eml', 'check engine', 'misfire', 'judder', 'shaking', 'loss of power', 'no power', 'cutting out', 'stalling', 'rough idle', 'hesitat'], ['fault-pinpointing', 'fault-scan']],
  [['dpf', 'soot', 'regen', 'particulate', 'smoke'], ['dpf-regeneration']],
  [['adblue', 'ad blue', 'nox', 'scr', 'emissions fluid', 'no start in', 'countdown'], ['adblue-diagnostics']],
  [['egr'], ['adblue-diagnostics', 'dpf-regeneration']],
  [['carplay', 'car play', 'android auto', 'hidden feature', 'video in motion', 'folding mirror', 'start stop', 'start/stop', 'digital dash', 'activate', 'unlock feature'], ['feature-coding']],
  [['key', 'fob', 'immobiliser', 'immobilizer', 'spare key', 'lost key'], ['key-programming']],
  [['abs', 'traction', 'esp', 'dsc', 'steering angle', 'brake bleed', 'handbrake', 'parking brake', 'epb'], ['abs-coding']],
  [['battery', 'wont start', "won't start", 'not starting', 'flat', 'alternator', 'drain', 'jump start', 'clicking'], ['battery-health-addon', 'fault-pinpointing']],
  [['mot'], ['pre-mot-health-scan']],
  [['buying', 'used car', 'second hand', 'inspection', 'pre purchase', 'pre-purchase', 'before i buy', 'clocked', 'mileage'], ['pre-purchase-inspection']],
  [['module', 'retrofit', 'towbar', 'tow bar', 'injector', 'bms', 'battery registration', 'new ecu', 'replacement ecu', 'bcm'], ['module-coding']],
  [['seat', 'stain', 'smell', 'odour', 'interior', 'upholstery', 'carpet', 'pet hair', 'spill', 'sick', 'mould', 'damp'], ['interior-deep-clean', 'cabin-sanitisation-addon']],
  [['swirl', 'scratch', 'polish', 'dull paint', 'faded', 'oxidis', 'oxidiz'], ['machine-polish', 'paint-correction']],
  [['ceramic', 'coating', 'protect paint'], ['ceramic-coating']],
  [['headlight', 'headlamp', 'cloudy', 'yellowed', 'foggy lens'], ['headlight-restoration']],
  [['engine bay'], ['engine-bay-detail']],
  [['valet', 'wash', 'clean', 'detail'], ['inside-out-restoration', 'winter-road-shield']],
  [['taxi', 'fleet', 'company vehicles'], ['fleet-pro-plan']],
  [['airbag', 'srs', 'tyre pressure', 'tpms', 'bulb', 'scan', 'diagnos', 'fault code', 'read codes', 'clear code'], ['fault-scan', 'fault-pinpointing']],
];

const LINKS: { title: string; sub: string; href: string; keys: string }[] = [
  { title: 'Book a visit', sub: 'Live availability, instant confirmation', href: '/book', keys: 'book booking appointment slot availability reserve' },
  { title: 'Emergency call-out', sub: 'Stranded or in limp mode — same-day help', href: '/emergency', keys: 'emergency urgent stranded breakdown broken down asap today now' },
  { title: 'Full price list', sub: 'Every package and price', href: '/rate-card', keys: 'price prices cost how much rate card list quote pricing' },
  { title: 'Check your postcode', sub: 'Coverage map and travel fee', href: '/coverage', keys: 'cover coverage area postcode travel where come to me location distance' },
  { title: 'Track a booking / my garage', sub: 'Tracker, invoices and reports', href: '/account', keys: 'track tracking tracker invoice report account garage login sign in receipt my booking' },
  { title: 'Contact & help', sub: 'Message, call back, WhatsApp', href: '/contact', keys: 'contact help support message call phone whatsapp email question' },
  { title: 'Trade portal', sub: 'Trade rates for garages, dealers and fleets', href: '/trade', keys: 'trade garage dealer bodyshop b2b wholesale account' },
  { title: 'Free MOT reminder', sub: 'Never miss an MOT', href: '/mot-reminder', keys: 'mot reminder remind due expiry' },
  { title: 'Warning-light guide', sub: 'Tap a dashboard light to see what it means', href: '/warning-lights', keys: 'warning light lights dashboard symbol symbols dash' },
  { title: 'Fault-code library', sub: 'Decode a P, U, C or B code', href: '/fault-codes', keys: 'fault code codes dtc obd library decode' },
  { title: 'Coding matrix', sub: 'Features we can activate by make', href: '/coding', keys: 'coding matrix features bmw vag ford mercedes land rover retrofit' },
  { title: 'Reviews', sub: 'What customers say', href: '/reviews', keys: 'review reviews rating testimonials feedback' },
  { title: 'Lab gallery', sub: 'Before and after', href: '/gallery', keys: 'gallery photos before after pictures results' },
];

export const tokenise = (q: string): string[] => q.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w));

/** Short terms must match a whole word (optionally plural); longer ones may match the start of a word. */
function phraseIn(q: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}${phrase.length <= 4 ? "s?([^a-z0-9]|$)" : ''}`).test(q);
}

/** Rank packages for a free-text query: symptom phrases first, then words in the name and summary. */
export function matchPackages(packages: PackageRow[], query: string): PackageRow[] {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9'/ ]+/g, ' ')} `;
  const words = tokenise(query);
  const score = new Map<string, number>();
  for (const [phrases, slugs] of SYMPTOMS) {
    if (phrases.some((p) => phraseIn(q, p))) slugs.forEach((s, i) => score.set(s, (score.get(s) ?? 0) + 6 - i));
  }
  for (const p of packages) {
    const name = `${p.name} ${p.slug} ${p.badge}`.toLowerCase();
    const body = `${p.summary} ${p.includes}`.toLowerCase();
    let s = 0;
    for (const w of words) s += name.includes(w) ? 3 : body.includes(w) ? 1 : 0;
    if (s) score.set(p.slug, (score.get(p.slug) ?? 0) + s);
  }
  return packages.filter((p) => (score.get(p.slug) ?? 0) >= 2).sort((a, b) => (score.get(b.slug) ?? 0) - (score.get(a.slug) ?? 0)).slice(0, 4);
}

export async function siteSearch(db: D1Database, query: string, currency: string): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const words = tokenise(q);
  const hits: SearchHit[] = [];
  const upper = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const looksLikeCode = /^[PCBU][0-9A-F]{1,4}$/.test(upper);
  const like = words.filter((w) => w.length >= 4).slice(0, 3);

  // Fault codes: exact / prefix when it looks like a code, otherwise by title words.
  if (looksLikeCode) {
    const codes = await all<{ code: string; title: string; severity: string }>(db, "SELECT code, title, severity FROM dtc_codes WHERE public = 1 AND code LIKE ? ESCAPE '\\' ORDER BY code LIMIT 5", `${upper.replace(/[\\%_]/g, '\\$&')}%`);
    codes.forEach((c) => hits.push({ type: 'code', title: `${c.code} — ${c.title}`, sub: c.severity === 'red' ? 'Serious — stop and get it checked' : 'Fault code: causes and how we pinpoint it', href: `/fault-codes/${c.code}`, meta: c.code }));
  }

  // Services, by symptom and by name.
  const packages = await getPackages(db);
  for (const p of matchPackages(packages, q)) {
    hits.push({ type: 'service', title: p.name, sub: p.summary, href: `/services/${p.slug}`, meta: `${p.price_s === p.price_l ? '' : 'from '}${money(p.price_s, currency)}` });
  }

  // Warning lights.
  const ql = ` ${q.toLowerCase()} `;
  WARNING_LIGHTS.filter((l) => words.some((w) => w.length >= 3 && `${l.name} ${l.keywords}`.toLowerCase().includes(w)) || ql.includes(l.key)).slice(0, 3)
    .forEach((l) => hits.push({ type: 'light', title: `${l.name} warning light`, sub: l.meaning, href: `/warning-lights#light-${l.key}`, meta: l.colour === 'red' ? 'Red' : 'Amber' }));

  if (like.length) {
    const cond = (cols: string[]) => like.map(() => `(${cols.map((col) => `LOWER(${col}) LIKE ? ESCAPE '\\'`).join(' OR ')})`).join(' OR ');
    const binds = (n: number) => like.flatMap((w) => Array.from({ length: n }, () => likeTerm(w)));
    const [codes, guides, faqs, pages] = await Promise.all([
      looksLikeCode ? Promise.resolve([]) : all<{ code: string; title: string }>(db, `SELECT code, title FROM dtc_codes WHERE public = 1 AND (${cond(['title', 'system'])}) ORDER BY code LIMIT 3`, ...binds(2)),
      all<{ slug: string; title: string; excerpt: string; read_minutes: number }>(db, `SELECT slug, title, excerpt, read_minutes FROM guides WHERE active = 1 AND (${cond(['title', 'excerpt'])}) ORDER BY published_on DESC LIMIT 3`, ...binds(2)),
      all<{ question: string; answer: string }>(db, `SELECT question, answer FROM faqs WHERE active = 1 AND (${cond(['question'])}) ORDER BY sort LIMIT 2`, ...binds(1)),
      all<{ slug: string; title: string; intro: string }>(db, `SELECT slug, title, intro FROM pages WHERE active = 1 AND (${cond(['title', 'intro'])}) ORDER BY sort LIMIT 2`, ...binds(2)).catch(() => []),
    ]);
    codes.forEach((c) => hits.push({ type: 'code', title: `${c.code} — ${c.title}`, sub: 'Fault code: causes and how we pinpoint it', href: `/fault-codes/${c.code}`, meta: c.code }));
    guides.forEach((g) => hits.push({ type: 'guide', title: g.title, sub: g.excerpt, href: `/guides/${g.slug}`, meta: `${g.read_minutes} min` }));
    faqs.forEach((f) => hits.push({ type: 'faq', title: f.question, sub: f.answer, href: '/faq' }));
    pages.forEach((p) => hits.push({ type: 'page', title: p.title.replace(/[[\]]/g, ''), sub: p.intro, href: `/${p.slug}` }));
  }

  // Quick links.
  LINKS.filter((l) => words.some((w) => w.length >= 3 && l.keys.split(' ').some((k) => k.startsWith(w) || w.startsWith(k)))).slice(0, 3)
    .forEach((l) => hits.push({ type: 'link', title: l.title, sub: l.sub, href: l.href }));

  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.href + h.title) ? false : (seen.add(h.href + h.title), true))).slice(0, 12).map((h) => ({ ...h, sub: h.sub.length > 130 ? `${h.sub.slice(0, 127).trimEnd()}…` : h.sub }));
}
