// Contact & help, the trade portal, the interactive rate card and shareable flyers —
// plus their printable PDF versions. Mounted before the catch-all town-page route.
import { Hono } from 'hono';
import { CONTACT_TOPICS, FLYER_TEMPLATES, type FlyerTemplate } from '../../shared/constants';
import { formatDate, money, normPhone, todayIn } from '../../shared/format';
import type { AppEnv, Ctx } from '../env';
import { all, first, parseJson, run } from '../lib/db';
import { html, raw, type SafeHtml } from '../lib/html';
import { download } from '../lib/http';
import { qrSvg } from '../lib/qr';
import { fail } from '../lib/security';
import type { Settings } from '../lib/settings';
import { getLocation, getPackages, travelBandsOf, type PackageRow } from '../services/catalog';
import { flyerPdf, rateCardPdf } from '../services/pdf';
import { icon } from '../views/icons';
import { crumbs, loadShell, renderPage, type Shell } from '../views/layout';
import { brand } from './documents';

export const marketingRoutes = new Hono<AppEnv>();

const mins = (m: number): string => (m >= 420 ? (m >= 480 ? '1 day' : '7 hrs') : m >= 60 ? `${Math.round((m / 60) * 10) / 10} hr${m > 60 ? 's' : ''}` : `${m} min`);
const sized = (p: PackageRow): boolean => p.price_s !== p.price_l || p.price_m !== p.price_l;
const pct = (minor: number, off: number): number => Math.round((minor * (100 - off)) / 100);
const waOf = (s: Settings): string => normPhone(s.business.whatsapp).replace('+', '');

function contactActions(shell: Shell, opts: { chat?: boolean } = {}): SafeHtml {
  const b = shell.settings.business;
  return html`<div class="contact-actions">
  <a class="contact-tile tile-call" href="tel:${normPhone(b.phone)}">${icon('phone')}<span><b>Call the lab</b><small class="mono">${b.phone}</small></span></a>
  <a class="contact-tile tile-wa" href="https://wa.me/${waOf(shell.settings)}" target="_blank" rel="noopener">${icon('whatsapp')}<span><b>WhatsApp</b><small>Send a photo of the fault</small></span></a>
  <a class="contact-tile" href="mailto:${b.email}">${icon('mail')}<span><b>Email</b><small>${b.email}</small></span></a>
  ${opts.chat && shell.settings.integrations.chat ? html`<button class="contact-tile" type="button" data-chat-open>${icon('chat')}<span><b>Live chat</b><small>Instant answers, then a technician</small></span></button>` : ''}
</div>`;
}

// ───────────────────────────── Contact & help ─────────────────────────────
marketingRoutes.get('/support', (c) => c.redirect('/contact', 301));
marketingRoutes.get('/help', (c) => c.redirect('/contact', 301));

marketingRoutes.get('/contact', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const b = s.business;
  const bc = crumbs(shell, [['/contact', 'Contact & help']]);
  const topic = CONTACT_TOPICS.some(([k]) => k === c.req.query('topic')) ? c.req.query('topic') : '';
  const chips: [string, string, string][] = [
    ['warning', 'Warning light on', 'My dashboard is showing a warning light: '],
    ['quote', 'Need a quote', 'Please could you quote for: '],
    ['booking', 'Do you cover me?', 'Do you cover my area? My postcode is '],
    ['coding', 'CarPlay / coding', 'I would like to activate this feature: '],
    ['detailing', 'Detailing price', 'I would like a price for detailing my '],
    ['existing', 'About my booking', 'My booking reference is '],
  ];
  return c.html(renderPage(c, shell, {
    title: 'Contact & Help', description: `Contact ${b.name}: ask about a warning light, a quote, coding or an existing booking. Call, WhatsApp, email or send a message.`, path: '/contact',
    jsonLd: [bc.ld, { '@context': 'https://schema.org', '@type': 'ContactPage', name: `Contact ${b.name}`, url: `${shell.origin}/contact` }],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Contact &amp; help</span><h1 class="display">Ask the lab.<br><span class="accent">Get a straight answer.</span></h1><p class="lead">A warning light, a quote, coding, detailing or an existing booking — send a message and a technician replies, usually within the hour during opening times. Stranded or in limp mode? Call rather than message.</p></div></section>
<section class="section-tight"><div class="wrap contact-grid">
  <form class="card stack" data-enquiry-form data-kind="contact" data-success="Thanks — your message is with the lab. We'll reply by your preferred method, usually within the hour during opening times.">
    <div><h2 class="h3" style="margin:0">Send a message</h2><p class="muted" style="margin:6px 0 0">Tap a quick start or write your own.</p></div>
    <div class="chip-row" role="group" aria-label="Quick start">${chips.map(([t, label, text]) => html`<button class="chip" type="button" data-prefill="${text}" data-topic="${t}" aria-pressed="false">${label}</button>`)}</div>
    <div class="form-grid">
      <div class="field"><label for="c-name">Your name</label><input class="input" id="c-name" name="name" required minlength="2" maxlength="80" autocomplete="name"></div>
      <div class="field"><label for="c-topic">What is it about?</label><select class="select" id="c-topic" name="topic">${CONTACT_TOPICS.map(([k, l]) => html`<option value="${k}"${k === topic ? raw(' selected') : ''}>${l}</option>`)}</select></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="c-phone">Mobile</label><input class="input" id="c-phone" name="phone" type="tel" maxlength="24" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email" maxlength="120" autocomplete="email"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="c-reg">Registration <span class="faint">(optional)</span></label><input class="input plate-input mono" id="c-reg" name="reg" maxlength="10" autocomplete="off" placeholder="AB12 CDE" style="text-transform:uppercase"></div>
      <div class="field"><label for="c-pref">Best way to reply</label><select class="select" id="c-pref" name="preferred"><option value="">Any</option><option value="call">Phone call</option><option value="text">Text message</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div>
    </div>
    <div class="field"><label for="c-msg">Message</label><textarea class="textarea" id="c-msg" name="message" required minlength="5" maxlength="2000" placeholder="Fault codes, symptoms, what you would like done…"></textarea><span class="hint">Give a mobile or an email so we can reply.</span></div>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div data-turnstile></div>
    <button class="btn btn-primary btn-lg" type="submit">${icon('mail')} Send message</button>
    <div data-form-result aria-live="polite"></div>
    <p class="faint" style="margin:0;font-size:.8rem">We only use your details to reply. See our <a href="/privacy">privacy notice</a>.</p>
  </form>
  <aside class="stack">
    ${contactActions(shell, { chat: true })}
    <form class="card stack callback-card" data-enquiry-form data-kind="callback" data-success="Thanks — we'll call you back. If it's urgent, call us now.">
      <h3 style="margin:0">${icon('phone')} Prefer a call back?</h3>
      <div class="form-grid"><div class="field"><label for="cb-name">Name</label><input class="input" id="cb-name" name="name" required minlength="2" maxlength="80" autocomplete="name"></div><div class="field"><label for="cb-phone">Number</label><input class="input" id="cb-phone" name="phone" type="tel" required maxlength="24" autocomplete="tel"></div></div>
      <div class="field"><label for="cb-when">When suits you?</label><select class="select" id="cb-when" name="when"><option value="asap">As soon as possible</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn btn-primary" type="submit">Call me back</button>
      <div data-form-result aria-live="polite"></div>
    </form>
    <div class="card stack" style="gap:10px"><h3 style="margin:0">${icon('clock')} Opening times</h3>${b.hours.map((h) => html`<div class="spread"><span>${h.days}</span><span class="mono">${h.open}–${h.close}</span></div>`)}<p class="faint" style="margin:0;font-size:.82rem">Emergency call-outs outside these times by phone, subject to availability.</p></div>
    <div class="card stack" style="gap:6px"><h3 style="margin:0 0 4px">${icon('help')} Quick help</h3>
      ${([['/account', 'Track a booking or download a report'], ['/mot-reminder', 'Get a free MOT reminder'], ['/fault-codes', 'Look up a fault code'], ['/coverage', 'Check if we cover your postcode'], ['/rate-card', 'See every price'], ['/emergency', 'Emergency call-out'], ['/faq', 'Frequently asked questions'], ['/trade', 'Trade & fleet accounts']] as [string, string][]).map(([href, label]) => html`<a class="link-row" href="${href}">${label}${icon('arrow')}</a>`)}
    </div>
  </aside>
</div></section>`,
  }));
});

// ───────────────────────────── Trade portal ─────────────────────────────
marketingRoutes.get('/trade', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const db = c.env.DB;
  const loc = await getLocation(db);
  const cur = loc.currency;
  const off = Math.min(Math.max(s.pricing.tradeDiscountPct, 0), 60);
  const packages = (await getPackages(db)).filter((p) => p.category === 'diagnostics' || p.category === 'detailing');
  const bc = crumbs(shell, [['/trade', 'Trade portal']]);
  const diag = packages.filter((p) => p.category === 'diagnostics');
  const det = packages.filter((p) => p.category === 'detailing');
  const book = (p: PackageRow) => html`<a class="btn btn-sm" href="/book?package=${p.slug}&src=trade">Book</a>`;
  return c.html(renderPage(c, shell, {
    title: 'Trade Portal — Trade Rates for Garages, Dealers & Fleets', description: `${off}% trade rates on every package for garages, bodyshops, dealers, taxi and fleet operators. Apply for a trade account online.`, path: '/trade', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Trade portal</span><h1 class="display">Trade rates for<br><span class="accent">the motor trade.</span></h1><p class="lead">Garages, bodyshops, dealers, taxi and fleet operators: ${off}% off every package, priority call-outs, multi-vehicle visits and one monthly statement.</p>
  <div class="readouts trade-stats"><div class="readout"><small>Trade discount</small><b class="good">${off}% off</b></div><div class="readout"><small>Vehicles per visit</small><b>Up to ${s.booking.maxVehicles}</b></div><div class="readout"><small>Extra vehicles</small><b>${s.pricing.multiVehiclePct}% more off</b></div><div class="readout"><small>Billing</small><b>Monthly statement</b></div></div>
</div></section>
<section class="section-tight"><div class="wrap grid grid-2" style="align-items:stretch">
  <form class="card stack" data-trade-code>
    <span class="eyebrow" style="margin:0">Already approved?</span>
    <h2 class="h3" style="margin:0">Book at trade rates</h2>
    <p class="muted" style="margin:0">Enter your trade code. Trade prices apply automatically, and you can add up to ${s.booking.maxVehicles} vehicles in one visit.</p>
    <div class="input-group"><input class="input mono" name="code" required maxlength="20" placeholder="T-YOURCODE" autocomplete="off" aria-label="Trade code" style="text-transform:uppercase"><button class="btn btn-primary" type="submit">Book ${icon('arrow')}</button></div>
    <p class="faint" style="margin:0;font-size:.82rem">Lost your code? Call <a href="tel:${normPhone(s.business.phone)}">${s.business.phone}</a>.</p>
  </form>
  <div class="card stack">
    <span class="eyebrow" style="margin:0">Why the trade use us</span>
    <ul class="includes">
      <li>Dealer-level diagnostics and coding at your premises — no transporting cars</li>
      <li>Post-repair scans, ADAS-free module coding, keys and immobilisers</li>
      <li>Pitch-ready valets, wet extraction and machine polishing for stock</li>
      <li>Written PDF reports for your customers or your own records</li>
      <li>Priority call-outs and one monthly statement</li>
    </ul>
  </div>
</div></section>
<section class="section-tight"><div class="wrap">
  <div class="section-head"><div><span class="eyebrow">Trade price list</span><h2 class="display">Every package at ${off}% off</h2><p class="lead">Retail prices for comparison. Travel and emergency fees are charged as normal.</p></div><a class="btn" href="/rate-card">Retail price list ${icon('arrow')}</a></div>
  <div class="division-head"><span class="num">DIV 01</span><h3>Diagnostics &amp; coding</h3></div>
  <div class="table-scroll"><table class="price-table"><thead><tr><th>Package</th><th class="num">Retail</th><th class="num">Trade</th><th></th></tr></thead><tbody>${diag.map((p) => html`<tr><td><b>${p.name}</b><small>${p.summary}</small></td><td class="num strike">${money(p.price_m, cur)}</td><td class="num good">${money(pct(p.price_m, off), cur)}</td><td>${book(p)}</td></tr>`)}</tbody></table></div>
  <div class="division-head"><span class="num">DIV 02</span><h3>Detailing &amp; pitch prep</h3></div>
  <div class="table-scroll"><table class="price-table wide"><thead><tr><th>Package</th><th class="num">Small</th><th class="num">Medium</th><th class="num">Large</th><th class="num">Retail (M)</th><th></th></tr></thead><tbody>${det.map((p) => html`<tr><td><b>${p.name}</b><small>${p.summary}</small></td><td class="num good">${money(pct(p.price_s, off), cur)}</td><td class="num good">${money(pct(p.price_m, off), cur)}</td><td class="num good">${money(pct(p.price_l, off), cur)}</td><td class="num strike">${money(p.price_m, cur)}</td><td>${book(p)}</td></tr>`)}</tbody></table></div>
</div></section>
<section class="section-tight" id="apply"><div class="wrap grid grid-2">
  <div class="stack">
    <span class="eyebrow">Apply</span><h2 class="display">Open a trade account</h2>
    <p class="lead">Applications are reviewed within one working day. Once approved you'll receive your trade code by text and email.</p>
    <div class="steps" style="grid-template-columns:1fr">
      <div class="step"><h3>Apply online</h3><p>Two minutes — business details and roughly how many vehicles a month.</p></div>
      <div class="step"><h3>Get your trade code</h3><p>Use it when booking online or quote it on the phone. Trade prices apply automatically.</p></div>
      <div class="step"><h3>Monthly statement</h3><p>Every job with its report, on one statement at the end of the month.</p></div>
    </div>
  </div>
  <form class="card stack" data-enquiry-form data-endpoint="/api/public/trade-apply" data-success="Application received — we'll review it within one working day and text your trade code.">
    <div class="form-grid">
      <div class="field"><label for="t-company">Business name</label><input class="input" id="t-company" name="company" required minlength="2" maxlength="120" autocomplete="organization"></div>
      <div class="field"><label for="t-type">Business type</label><select class="select" id="t-type" name="businessType"><option value="garage">Independent garage</option><option value="bodyshop">Bodyshop</option><option value="dealer">Car dealer</option><option value="fleet">Company fleet</option><option value="taxi">Taxi / private hire</option><option value="auction">Auction</option><option value="recovery">Recovery</option><option value="other">Other</option></select></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="t-name">Your name</label><input class="input" id="t-name" name="name" required minlength="2" maxlength="80" autocomplete="name"></div>
      <div class="field"><label for="t-phone">Mobile</label><input class="input" id="t-phone" name="phone" type="tel" required maxlength="24" autocomplete="tel"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="t-email">Email</label><input class="input" id="t-email" name="email" type="email" required maxlength="120" autocomplete="email"></div>
      <div class="field"><label for="t-pc">Business postcode</label><input class="input mono" id="t-pc" name="postcode" maxlength="9" autocomplete="postal-code" style="text-transform:uppercase"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="t-url">Website <span class="faint">(optional)</span></label><input class="input" id="t-url" name="siteUrl" maxlength="200" inputmode="url" placeholder="https://"></div>
      <div class="field"><label for="t-vol">Vehicles a month</label><select class="select" id="t-vol" name="volume"><option value="1-5">1–5</option><option value="6-20">6–20</option><option value="21-50">21–50</option><option value="50+">50+</option></select></div>
    </div>
    <div class="field"><label for="t-msg">Anything else?</label><textarea class="textarea" id="t-msg" name="message" maxlength="2000" placeholder="Typical work, makes you see most, preferred days…"></textarea></div>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div data-turnstile></div>
    <button class="btn btn-primary btn-lg" type="submit">Apply for a trade account</button>
    <div data-form-result aria-live="polite"></div>
  </form>
</div></section>`,
  }));
});

// ───────────────────────────── Rate card ─────────────────────────────
marketingRoutes.get('/flyer', (c) => c.redirect('/rate-card', 301));
marketingRoutes.get('/prices', (c) => c.redirect('/rate-card', 301));

async function rateCardData(c: Ctx) {
  const db = c.env.DB;
  const loc = await getLocation(db);
  const packages = await getPackages(db);
  const plans = await all<{ name: string; summary: string; interval: string; price_s: number; price_l: number; package_slug: string }>(db, 'SELECT name, summary, interval, price_s, price_l, package_slug FROM plans WHERE active = 1 ORDER BY sort');
  return { loc, cur: loc.currency, bands: travelBandsOf(loc).sort((a, b) => a.upTo - b.upTo), packages, plans };
}

marketingRoutes.get('/rate-card', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const { cur, bands, packages, plans } = await rateCardData(c);
  const bc = crumbs(shell, [['/rate-card', 'Price list']]);
  const bookUrl = `${shell.origin}/book?src=rate-card`;
  const group = (cat: string) => packages.filter((p) => p.category === cat);
  const flat = (rows: PackageRow[]) => html`<div class="table-scroll"><table class="price-table"><thead><tr><th>Package</th><th class="num">Time</th><th class="num">Price</th><th class="no-print"></th></tr></thead><tbody>${rows.map((p) => html`<tr><td><b>${p.name}</b><small>${p.summary}</small></td><td class="num mono">${mins(p.duration_min)}</td><td class="num price-cell">${sized(p) ? html`<small>from</small> ` : ''}${money(p.price_s, cur)}</td><td class="no-print"><a class="btn btn-sm" href="/book?package=${p.slug}&src=rate-card">Book</a></td></tr>`)}</tbody></table></div>`;
  const bySize = (rows: PackageRow[]) => html`<div class="table-scroll"><table class="price-table wide"><thead><tr><th>Package</th><th class="num">Small</th><th class="num">Medium</th><th class="num">Large</th><th class="no-print"></th></tr></thead><tbody>${rows.map((p) => html`<tr><td><b>${p.name}</b><small>${p.summary} · ${mins(p.duration_min)}</small></td><td class="num">${money(p.price_s, cur)}</td><td class="num">${money(p.price_m, cur)}</td><td class="num">${money(p.price_l, cur)}</td><td class="no-print"><a class="btn btn-sm" href="/book?package=${p.slug}&src=rate-card">Book</a></td></tr>`)}</tbody></table></div>`;
  return c.html(renderPage(c, shell, {
    title: 'Full Price List', description: `Every ${s.business.name} price in one place: diagnostics, coding, detailing, ceramic, add-ons and plans, with travel zones and savings.`, path: '/rate-card', jsonLd: [bc.ld], bodyClass: 'printable',
    body: html`<section class="page-head grid-bg"><div class="wrap ratecard-head">
  <div>${bc.html}<span class="eyebrow">Price list · ${formatDate(todayIn(s.business.timezone), 'long')}</span><h1 class="display">The full<br><span class="accent">rate card.</span></h1><p class="lead">Fixed prices for every package. Diagnostics and coding cost the same for every car; detailing is priced by vehicle size.</p>
    <div class="row no-print"><a class="btn btn-primary" href="/book?src=rate-card">Book a visit ${icon('arrow')}</a><a class="btn" href="/rate-card.pdf" download>${icon('download')} PDF</a><button class="btn" type="button" data-print>${icon('print')} Print</button><button class="btn" type="button" data-share data-title="${s.business.name} — price list">${icon('share')} Share</button></div></div>
  <figure class="qr-card">${raw(qrSvg(bookUrl, { label: 'Scan to book online' }))}<figcaption>Scan to book</figcaption></figure>
</div></section>
<section class="section-tight"><div class="wrap ratecard">
  <div class="division-head" id="diagnostics"><span class="num">DIV 01</span><h3>Diagnostics &amp; coding</h3></div>${flat(group('diagnostics'))}
  <div class="division-head" id="detailing"><span class="num">DIV 02</span><h3>Detailing &amp; ceramic</h3></div>${bySize(group('detailing'))}
  ${group('addon').length ? html`<div class="division-head" id="addons"><span class="num">ADD-ONS</span><h3>Add while we're there</h3></div>${flat(group('addon'))}` : ''}
  ${plans.length ? html`<div class="division-head" id="plans"><span class="num">PLANS</span><h3>Maintenance plans</h3></div><div class="table-scroll"><table class="price-table"><thead><tr><th>Plan</th><th>Visits</th><th class="num">Per visit from</th><th class="no-print"></th></tr></thead><tbody>${plans.map((p) => html`<tr><td><b>${p.name}</b><small>${p.summary}</small></td><td>${p.interval}</td><td class="num">${money(p.price_s, cur)}</td><td class="no-print"><a class="btn btn-sm" href="/book?package=${p.package_slug}&src=rate-card">Start</a></td></tr>`)}</tbody></table></div>` : ''}
  <div class="grid grid-3 ratecard-notes">
    <div class="card stack" style="gap:8px"><h3 style="margin:0">${icon('gift')} Savings</h3><p class="muted" style="margin:0">Two packages on one vehicle save <b>${money(s.pricing.bundle.two, cur)}</b>; three or more save <b>${money(s.pricing.bundle.threePlus, cur)}</b>. Every extra vehicle in the same visit saves ${s.pricing.multiVehiclePct}%.</p></div>
    <div class="card stack" style="gap:8px"><h3 style="margin:0">${icon('pin')} Travel</h3>${bands.map((b) => html`<div class="spread"><span>${b.label || `Up to ${b.upTo} miles`}</span><span class="mono">${b.fee ? money(b.fee, cur) : 'Free'}</span></div>`)}<p class="faint" style="margin:0;font-size:.82rem">Measured from our ${s.business.town} base.</p></div>
    <div class="card stack" style="gap:8px"><h3 style="margin:0">${icon('alert')} Emergency &amp; trade</h3><p class="muted" style="margin:0">Same-day emergency call-outs add ${money(s.pricing.emergencyFee, cur)}. Garages, dealers and fleets get ${s.pricing.tradeDiscountPct}% off on a <a href="/trade">trade account</a>.</p></div>
  </div>
</div></section>`,
  }));
});

marketingRoutes.get('/rate-card.pdf', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const { cur, bands, packages, plans } = await rateCardData(c);
  const group = (cat: string) => packages.filter((p) => p.category === cat);
  const bytes = await rateCardPdf({
    brand: await brand(c, s), title: 'Price List', issued: formatDate(todayIn(s.business.timezone)),
    subtitle: `Fixed prices for mobile diagnostics, OEM coding and restorative detailing across ${s.business.region}. Diagnostics and coding cost the same for every car; detailing is priced by vehicle size. Pay on completion.`,
    qrUrl: `${shell.origin}/book?src=rate-card-pdf`, qrLabel: 'Scan to book',
    groups: [
      { tag: 'Division 01', title: 'Diagnostics & coding', note: 'No mains power or water needed.', sized: false, rows: group('diagnostics').map((p) => [`${p.name}\n${p.summary}`, mins(p.duration_min), `${sized(p) ? 'from ' : ''}${money(p.price_s, cur)}`]) },
      { tag: 'Division 02', title: 'Detailing & ceramic', note: 'Mobile detailing needs an outdoor tap and a 240 V socket within 25 m, or use lab drop-off.', sized: true, rows: group('detailing').map((p) => [`${p.name}\n${p.summary}`, money(p.price_s, cur), money(p.price_m, cur), money(p.price_l, cur)]) },
      { tag: 'Add-ons', title: "Add while we're there", note: '', sized: false, rows: group('addon').map((p) => [p.name, mins(p.duration_min), money(p.price_s, cur)]) },
      { tag: 'Plans', title: 'Maintenance plans', note: '', sized: false, rows: plans.map((p) => [`${p.name}\n${p.summary}`, p.interval, `from ${money(p.price_s, cur)}`]) },
    ],
    notes: [
      `Bundle savings: ${money(s.pricing.bundle.two, cur)} off two packages on one vehicle, ${money(s.pricing.bundle.threePlus, cur)} off three or more. ${s.pricing.multiVehiclePct}% off every extra vehicle in the same visit.`,
      `Travel: ${bands.map((b) => `${b.label || `up to ${b.upTo} miles`} ${b.fee ? money(b.fee, cur) : 'free'}`).join(' · ')}.`,
      `Emergency same-day call-out: +${money(s.pricing.emergencyFee, cur)}. Trade accounts: ${s.pricing.tradeDiscountPct}% off — apply at ${new URL(shell.origin).host}/trade.`,
      'Prices include labour and standard consumables. Parts are quoted separately and fitted only with your approval.',
    ],
  });
  return download(bytes as Uint8Array<ArrayBuffer>, 'price-list.pdf', 'application/pdf', c.req.query('download') !== '1');
});

// ───────────────────────────── Flyers ─────────────────────────────
interface FlyerRow { slug: string; title: string; template: FlyerTemplate; headline: string; subhead: string; points: string; package_slugs: string; promo_code: string; offer_text: string; cta_label: string; expires_on: string | null; views: number; active: number }

async function loadFlyer(c: Ctx): Promise<{ f: FlyerRow; expired: boolean; packages: PackageRow[] }> {
  const slug = (c.req.param('slug') ?? '').toLowerCase();
  const f = await first<FlyerRow>(c.env.DB, 'SELECT * FROM flyers WHERE slug = ?', slug);
  if (!f || (!f.active && !c.get('staff'))) fail(404, 'That flyer could not be found — it may have been taken down.');
  const today = todayIn((await loadShell(c)).settings.business.timezone);
  const wanted = parseJson<string[]>(f!.package_slugs, []);
  const all_ = await getPackages(c.env.DB);
  const packages = wanted.map((w) => all_.find((p) => p.slug === w)).filter((p): p is PackageRow => !!p);
  return { f: f!, expired: !!f!.expires_on && f!.expires_on < today, packages };
}

const flyerBookUrl = (origin: string, f: FlyerRow, pkg?: string): string => {
  const q = new URLSearchParams({ src: `flyer:${f.slug}` });
  if (f.promo_code) q.set('promo', f.promo_code);
  if (pkg) q.set('package', pkg);
  return `${origin}/book?${q.toString()}`;
};

marketingRoutes.get('/flyer/:slug{[a-z0-9-]{2,60}}', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const { f, expired, packages } = await loadFlyer(c);
  if (!c.get('staff')) c.executionCtx.waitUntil(run(c.env.DB, 'UPDATE flyers SET views = views + 1 WHERE slug = ?', f.slug).then(() => undefined));
  const t = FLYER_TEMPLATES[f.template] ?? FLYER_TEMPLATES.diagnostics;
  const cur = (await getLocation(c.env.DB)).currency;
  const points = parseJson<string[]>(f.points, []).filter(Boolean);
  const bookUrl = flyerBookUrl(shell.origin, f);
  const pageUrl = `${shell.origin}/flyer/${f.slug}`;
  return c.html(renderPage(c, shell, {
    title: f.title, description: (f.subhead || f.headline).slice(0, 158), path: `/flyer/${f.slug}`, noindex: true, bodyClass: 'printable',
    body: html`<section class="section-tight grid-bg"><div class="wrap">
  <article class="flyer flyer-${f.template}${expired ? ' flyer-expired' : ''}">
    <div class="flyer-main">
      <span class="eyebrow">${icon(t.icon)} ${t.eyebrow}</span>
      <h1 class="display">${f.headline || f.title}</h1>
      ${f.subhead ? html`<p class="lead">${f.subhead}</p>` : ''}
      ${points.length ? html`<ul class="includes flyer-points">${points.map((p) => html`<li>${p}</li>`)}</ul>` : ''}
      ${expired ? html`<div class="alert alert-warn">${icon('clock')}<span>This offer ended on ${formatDate(f.expires_on!)}. Our current prices are on the <a href="/rate-card">price list</a>.</span></div>`
        : f.offer_text || f.promo_code ? html`<div class="flyer-offer"><b>${f.offer_text || 'Exclusive offer'}</b>${f.promo_code ? html`<span>Code <span class="code mono">${f.promo_code}</span> applied automatically</span>` : ''}${f.expires_on ? html`<small>Ends ${formatDate(f.expires_on)}</small>` : ''}</div>` : ''}
      ${packages.length ? html`<div class="flyer-packages">${packages.map((p) => html`<a class="flyer-pkg" href="${flyerBookUrl('', f, p.slug)}"><span><b>${p.name}</b><small>${mins(p.duration_min)}</small></span><span class="price">${sized(p) ? html`<small>from</small>` : ''}${money(p.price_s, cur)}</span></a>`)}</div>` : ''}
      <div class="row no-print"><a class="btn btn-primary btn-lg" href="${flyerBookUrl('', f)}">${f.cta_label || 'Book now'} ${icon('arrow')}</a><a class="btn btn-lg" href="tel:${normPhone(s.business.phone)}">${icon('phone')} ${s.business.phone}</a><a class="btn btn-lg" href="https://wa.me/${waOf(s)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a></div>
    </div>
    <aside class="flyer-side">
      <figure class="qr-card">${raw(qrSvg(bookUrl, { label: 'Scan to book this offer' }))}<figcaption>Scan to book</figcaption></figure>
      <div class="flyer-brand"><b>${s.business.name}</b><span class="mono">${s.business.phone}</span><span>${new URL(shell.origin).host}</span></div>
      <div class="row no-print" style="justify-content:center"><button class="btn btn-sm" type="button" data-share="${pageUrl}" data-title="${f.title}">${icon('share')} Share</button><button class="btn btn-sm" type="button" data-print>${icon('print')} Print</button><a class="btn btn-sm" href="/flyer/${f.slug}/pdf" download>${icon('download')} PDF</a></div>
    </aside>
  </article>
</div></section>`,
  }));
});

marketingRoutes.get('/flyer/:slug{[a-z0-9-]{2,60}}/pdf', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const { f, expired, packages } = await loadFlyer(c);
  const cur = (await getLocation(c.env.DB)).currency;
  const t = FLYER_TEMPLATES[f.template] ?? FLYER_TEMPLATES.diagnostics;
  const bytes = await flyerPdf({
    brand: await brand(c, s), eyebrow: t.eyebrow, headline: f.headline || f.title, subhead: f.subhead,
    points: parseJson<string[]>(f.points, []).filter(Boolean),
    offer: expired ? '' : f.offer_text, promoCode: expired ? '' : f.promo_code, expires: f.expires_on ? formatDate(f.expires_on) : '',
    packages: packages.map((p) => ({ name: p.name, price: `${sized(p) ? 'from ' : ''}${money(p.price_s, cur)}` })),
    qrUrl: flyerBookUrl(shell.origin, f), cta: `${f.cta_label || 'Book now'} — scan the code or call`,
    contact: [s.business.phone, new URL(shell.origin).host, s.business.email].filter(Boolean),
  });
  return download(bytes as Uint8Array<ArrayBuffer>, `${f.slug}.pdf`, 'application/pdf', c.req.query('download') !== '1');
});

// ───────────────────────────── Free MOT reminders ─────────────────────────────
marketingRoutes.get('/mot-reminder', async (c) => {
  const shell = await loadShell(c);
  const s = shell.settings;
  const bc = crumbs(shell, [['/mot-reminder', 'Free MOT reminder']]);
  return c.html(renderPage(c, shell, {
    title: 'Free MOT Reminder', description: `Never miss an MOT: enter your number plate and ${s.business.name} will text or email you before it is due. Free, no obligation.`, path: '/mot-reminder', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Free reminder</span><h1 class="display">Never miss<br><span class="accent">an MOT again.</span></h1><p class="lead">Enter your number plate and we'll send a reminder about four weeks before your MOT is due — with a quick pre-MOT check if you want one. Free, and you can stop any time.</p></div></section>
<section class="section-tight"><div class="wrap grid grid-2" style="align-items:start">
  <form class="card stack" data-enquiry-form data-endpoint="/api/public/mot-reminder" data-success="Done — your reminder is set.">
    <div class="field"><label for="m-reg">Number plate</label><input class="input plate-input mono" id="m-reg" name="reg" required maxlength="10" autocomplete="off" placeholder="AB12 CDE" style="text-transform:uppercase;font-size:1.4rem;text-align:center"></div>
    <div class="field"><label for="m-name">Your name</label><input class="input" id="m-name" name="name" required minlength="2" maxlength="80" autocomplete="name"></div>
    <div class="form-grid"><div class="field"><label for="m-phone">Mobile</label><input class="input" id="m-phone" name="phone" type="tel" maxlength="24" autocomplete="tel"></div><div class="field"><label for="m-email">Email</label><input class="input" id="m-email" name="email" type="email" maxlength="120" autocomplete="email"></div></div>
    <div class="field"><label for="m-due">MOT due date <span class="faint">(only if we can't find it)</span></label><input class="input" id="m-due" name="motDue" type="date"><span class="hint">We look it up from the DVLA automatically where we can.</span></div>
    <label class="check"><input type="checkbox" name="consent" required><span>Send me MOT and service reminders. I can stop them at any time.</span></label>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div data-turnstile></div>
    <button class="btn btn-primary btn-lg" type="submit">Set my reminder</button>
    <div data-form-result aria-live="polite"></div>
  </form>
  <div class="stack">
    <div class="steps" style="grid-template-columns:1fr">
      <div class="step"><h3>We check the date</h3><p>Your MOT expiry comes straight from the DVLA record for your plate.</p></div>
      <div class="step"><h3>We remind you</h3><p>About four weeks before it's due, by text or email — no spam in between.</p></div>
      <div class="step"><h3>Pass first time</h3><p>Book a pre-MOT health scan and we'll find warning lights, battery and emissions issues before the tester does.</p></div>
    </div>
    <a class="btn" style="align-self:flex-start" href="/services/pre-mot-health-scan">Pre-MOT health scan ${icon('arrow')}</a>
  </div>
</div></section>`,
  }));
});
