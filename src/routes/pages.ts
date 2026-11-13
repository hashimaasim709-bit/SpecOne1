// Server-rendered public pages. Interactive parts (booking wizard, tracker, account,
// maps, chat) are hydrated by small client bundles.
import { Hono } from 'hono';
import { SLOTS, VEHICLE_ZONES, type SlotKey } from '../../shared/constants';
import { formatDate, haversineMiles, money, normPhone, todayIn } from '../../shared/format';
import { travelFor } from '../../shared/pricing';
import type { AppEnv, Ctx } from '../env';
import { all, first, parseJson } from '../lib/db';
import { html, jsonForScript, markdown, raw, type SafeHtml } from '../lib/html';
import { fail } from '../lib/security';
import { getSettings } from '../lib/settings';
import { getAvailability, getLocation, getPackages, travelBandsOf, type LocationRow, type PackageRow } from '../services/catalog';
import { getBookingByToken } from '../services/bookings';
import { mediaUrl } from '../services/media';
import { emblem, icon } from '../views/icons';
import { asset, BUILD_ID, crumbs, loadShell, renderPage, type PageOptions, type Shell } from '../views/layout';
import { vehicleStage } from '../views/stage';

export const pageRoutes = new Hono<AppEnv>();

async function page(c: Ctx, opts: PageOptions, status: 200 | 404 = 200): Promise<Response> {
  const shell = await loadShell(c);
  return c.html(renderPage(c, shell, opts), status);
}

// ───────────────────────────── Shared fragments ─────────────────────────────
const fromPrice = (p: PackageRow, cur: string): SafeHtml =>
  p.price_s === p.price_l ? html`${money(p.price_m, cur)}` : html`<small>from</small>${money(p.price_s, cur)}`;
const duration = (m: number): string => (m >= 420 ? `${m >= 480 ? '1 day' : '7 hrs'}` : m >= 60 ? `${Math.round((m / 60) * 10) / 10} hr${m > 60 ? 's' : ''}` : `${m} min`);

function pkgCard(p: PackageRow, cur: string): SafeHtml {
  return html`<a class="pkg" href="/services/${p.slug}">
  <div class="pkg-top">${p.badge ? html`<span class="badge badge-accent">${p.badge}</span>` : html`<span></span>`}<span class="meta">${icon('clock')}${duration(p.duration_min)}</span></div>
  <h3>${p.name}</h3>
  <p>${p.summary}</p>
  <div class="pkg-foot"><span class="price">${fromPrice(p, cur)}</span><span class="meta" style="color:var(--accent-hi)">Details ${icon('arrow')}</span></div>
</a>`;
}

const sectionHead = (eyebrow: string, title: SafeHtml | string, lead = '', action: SafeHtml | string = ''): SafeHtml =>
  html`<div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h2 class="display">${title}</h2>${lead ? html`<p class="lead">${lead}</p>` : ''}</div>${action}</div>`;

const stars = (n: number): string => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

function reviewCard(r: { author: string; rating: number; body: string; vehicle: string; reviewed_on: string; source: string }): SafeHtml {
  return html`<article class="card review"><div class="spread"><span class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</span>${r.source === 'google' ? html`<span class="badge">Google</span>` : html`<span class="badge badge-good">Verified job</span>`}</div>
  <blockquote>${r.body || 'Rated without a written review.'}</blockquote>
  <footer><span class="avatar">${(r.author[0] ?? '?').toUpperCase()}</span><span><b style="color:var(--text)">${r.author}</b>${r.vehicle ? html` · ${r.vehicle}` : ''}<br><span class="mono" style="font-size:.74rem">${formatDate(r.reviewed_on)}</span></span></footer></article>`;
}

function faqBlock(faqs: { question: string; answer: string }[]): { html: SafeHtml; ld: Record<string, unknown> } {
  return {
    html: html`<div class="faq">${faqs.map((f, i) => html`<details${i === 0 ? raw(' open') : ''}><summary>${f.question}</summary><div class="answer">${f.answer}</div></details>`)}</div>`,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) },
  };
}

function coverageMap(loc: LocationRow, extra: Record<string, unknown> = {}): SafeHtml {
  const bands = travelBandsOf(loc);
  return html`<div class="map" data-coverage-map data-lat="${loc.lat}" data-lng="${loc.lng}" data-bands="${JSON.stringify(bands)}" data-extra="${JSON.stringify(extra)}" role="img" aria-label="Coverage map centred on ${loc.name}"></div>`;
}

function postcodeChecker(currency: string): SafeHtml {
  return html`<form class="card stack" data-postcode-check data-currency="${currency}">
  <label class="label" for="pc-input">Check your postcode</label>
  <div class="input-group"><input class="input mono" id="pc-input" name="pc" placeholder="BN21 4AB" autocomplete="postal-code" maxlength="9" required style="text-transform:uppercase"><button class="btn btn-primary" type="submit">Check</button></div>
  <div data-pc-result aria-live="polite"></div>
</form>`;
}

function ctaBand(shell: Shell, title = 'Ready when you are.', lead = 'Fixed prices, live tracking and pay on completion. Most bookings take under a minute.'): SafeHtml {
  const b = shell.settings.business;
  return html`<section class="section-tight"><div class="wrap"><div class="cta-band grid-bg"><div class="spread" style="align-items:center">
  <div><h2 class="display">${title}</h2><p class="lead" style="margin:12px 0 0">${lead}</p></div>
  <div class="row"><a class="btn btn-primary btn-lg" href="/book">Book a visit ${icon('arrow')}</a><a class="btn btn-lg" style="--btn-bg:rgba(255,255,255,.08);--btn-fg:#fff;--btn-line:rgba(255,255,255,.2)" href="tel:${normPhone(b.phone)}">${icon('phone')} ${b.phone}</a></div>
</div></div></div></section>`;
}

function beforeAfter(before: SafeHtml, after: SafeHtml, label = 'Drag to compare'): SafeHtml {
  return html`<div class="ba" data-ba>${before}<div class="ba-after" style="position:absolute;inset:0">${after}</div><span class="ba-label before">BEFORE</span><span class="ba-label after">AFTER</span><div class="ba-handle"></div><input type="range" min="0" max="100" value="50" aria-label="${label}"></div>`;
}

const mediaEl = (key: string, contentType: string, alt: string): SafeHtml =>
  contentType.startsWith('video/')
    ? html`<video src="${mediaUrl(key)}" muted loop playsinline autoplay preload="metadata" aria-label="${alt}"></video>`
    : html`<img src="${mediaUrl(key)}" alt="${alt}" loading="lazy" decoding="async">`;

export function embedUrl(url: string): { src: string; wide: boolean } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'instagram.com') {
      const m = /\/(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
      return m ? { src: `https://www.instagram.com/${m[1]}/${m[2]}/embed`, wide: false } : null;
    }
    if (host === 'tiktok.com') {
      const m = /\/video\/(\d+)/.exec(u.pathname);
      return m ? { src: `https://www.tiktok.com/embed/v2/${m[1]}`, wide: false } : null;
    }
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      const id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? /\/(shorts|embed)\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[2];
      return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { src: `https://www.youtube-nocookie.com/embed/${id}`, wide: !u.pathname.includes('/shorts/') } : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

interface GalleryRow { id: number; kind: string; title: string; caption: string; tags: string; embed_url: string; featured: number; m_key: string | null; m_type: string | null; b_key: string | null; b_type: string | null; a_key: string | null; a_type: string | null }
const GALLERY_SQL = `SELECT g.*, m.storage_key AS m_key, m.content_type AS m_type, bm.storage_key AS b_key, bm.content_type AS b_type, am.storage_key AS a_key, am.content_type AS a_type
  FROM gallery_items g LEFT JOIN media m ON m.id = g.media_id LEFT JOIN media bm ON bm.id = g.before_media_id LEFT JOIN media am ON am.id = g.after_media_id
  WHERE g.visible = 1`;

function galleryTile(g: GalleryRow): SafeHtml | '' {
  if ((g.kind === 'before_after' || g.kind === 'before_after_video') && g.b_key && g.a_key) {
    return html`<figure class="tile" data-tags="${g.tags.toLowerCase()}" style="margin:0">${beforeAfter(mediaEl(g.b_key, g.b_type ?? '', `${g.title} — before`), mediaEl(g.a_key, g.a_type ?? '', `${g.title} — after`))}${g.title || g.caption ? html`<figcaption><b style="color:var(--text)">${g.title}</b>${g.caption ? html`<br>${g.caption}` : ''}</figcaption>` : ''}</figure>`;
  }
  if (g.kind === 'social' && g.embed_url) {
    const e = embedUrl(g.embed_url);
    if (!e) return html`<a class="tile card-tight" href="${g.embed_url}" target="_blank" rel="noopener" data-tags="${g.tags.toLowerCase()}"><figcaption>${icon('play')} ${g.title || 'View post'}</figcaption></a>`;
    return html`<figure class="tile" data-tags="${g.tags.toLowerCase()}" style="margin:0"><div class="embed${e.wide ? ' wide' : ''}"><iframe src="${e.src}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen title="${g.title || 'Social post'}"></iframe></div>${g.title ? html`<figcaption>${g.title}</figcaption>` : ''}</figure>`;
  }
  if (g.m_key) {
    const isVideo = (g.m_type ?? '').startsWith('video/');
    return html`<a class="tile" href="${mediaUrl(g.m_key)}" data-lightbox-item data-type="${isVideo ? 'video' : 'image'}" data-caption="${[g.title, g.caption].filter(Boolean).join(' — ')}" data-tags="${g.tags.toLowerCase()}">${mediaEl(g.m_key, g.m_type ?? '', g.title || 'Lab gallery photo')}${isVideo ? html`<span class="badge play">${icon('play')} Video</span>` : ''}${g.title ? html`<figcaption><b style="color:var(--text)">${g.title}</b>${g.caption ? html`<br>${g.caption}` : ''}</figcaption>` : ''}</a>`;
  }
  return '';
}

async function reviewSummary(db: D1Database): Promise<{ avg: number; count: number; google: { rating: number; count: number } | null }> {
  const [site, flag] = await Promise.all([
    first<{ avg: number | null; n: number }>(db, 'SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE visible = 1'),
    first<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'flag:google_rating'"),
  ]);
  const google = parseJson<{ rating: number; count: number } | null>(flag?.value, null);
  return { avg: site?.avg ?? 0, count: site?.n ?? 0, google };
}

// ───────────────────────────── Home ─────────────────────────────
pageRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const shell = await loadShell(c);
  const s = shell.settings;
  const loc = await getLocation(db);
  const cur = loc.currency;
  const [packages, faqs, reviews, gallery, guides, availability, rating] = await Promise.all([
    getPackages(db),
    all<{ question: string; answer: string }>(db, 'SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort, id LIMIT 6'),
    all<{ author: string; rating: number; body: string; vehicle: string; reviewed_on: string; source: string }>(db, 'SELECT author, rating, body, vehicle, reviewed_on, source FROM reviews WHERE visible = 1 ORDER BY rating DESC, reviewed_on DESC LIMIT 6'),
    all<GalleryRow>(db, `${GALLERY_SQL} AND g.featured = 1 ORDER BY g.sort, g.id DESC LIMIT 4`),
    all<{ slug: string; title: string; excerpt: string; season: string; category: string; read_minutes: number }>(db, "SELECT slug, title, excerpt, season, category, read_minutes FROM guides WHERE active = 1 ORDER BY CASE WHEN season = ? THEN 0 WHEN season = 'all' THEN 1 ELSE 2 END, published_on DESC LIMIT 3", currentSeason(todayIn(loc.timezone))),
    getAvailability(db, s, loc, todayIn(loc.timezone), 14),
    reviewSummary(db),
  ]);
  const diag = packages.filter((p) => p.category === 'diagnostics');
  const detail = packages.filter((p) => p.category === 'detailing');
  // Featured packages first, topped up with the rest so each division always shows three.
  const pick3 = (list: PackageRow[]) => [...list.filter((p) => p.featured), ...list.filter((p) => !p.featured)].slice(0, 3);
  const featuredDiag = pick3(diag);
  const featuredDetail = pick3(detail);
  const next = availability.find((d) => !d.closed && Object.values(d.slots).some((n) => (n ?? 0) > 0));
  const nextSlot = next ? (Object.entries(next.slots).find(([, n]) => (n ?? 0) > 0)?.[0] as SlotKey | undefined) : undefined;
  const today = todayIn(loc.timezone);
  const nextLabel = next && nextSlot ? `${next.date === today ? 'Today' : formatDate(next.date, 'day')} · ${SLOTS[nextSlot].label}` : 'Call us';
  const openWeek = availability.slice(0, 7).reduce((sum, d) => sum + Object.values(d.slots).reduce<number>((a, n) => a + (n ?? 0), 0), 0);
  const capacityWeek = availability.slice(0, 7).reduce((sum, d) => sum + Object.keys(d.slots).length * 2, 0) || 1;
  const bands = travelBandsOf(loc).sort((a, b) => a.upTo - b.upTo);
  const freeRadius = bands.find((b) => b.fee === 0)?.upTo;
  const ratingText = rating.google ? `${rating.google.rating.toFixed(1)} ★ · ${rating.google.count} Google` : rating.count ? `${rating.avg.toFixed(1)} ★ · ${rating.count} reviews` : 'Pay on completion';
  const faq = faqBlock(faqs);
  const fill = Math.min(1, openWeek / capacityWeek);
  const needle = Math.round(-90 + fill * 180);
  const split = s.branding.heroHeadline.indexOf('. ');
  const headline = split > 0 ? [s.branding.heroHeadline.slice(0, split + 1), s.branding.heroHeadline.slice(split + 2)] : [s.branding.heroHeadline, ''];

  const hero = html`<section class="hero grid-bg"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">${s.business.town} · ${s.business.region} · Mobile laboratory</span>
    <h1 class="display">${headline[0]}${headline[1] ? html`<span class="line-accent">${headline[1]}</span>` : ''}</h1>
    <p class="lead">${s.branding.heroSub}</p>
    <div class="hero-ctas"><a class="btn btn-primary btn-lg" href="/book">Book a visit ${icon('arrow')}</a><a class="btn btn-sos btn-lg" href="/emergency">${icon('alert')} Emergency call-out</a></div>
    <div class="hero-trust">${s.business.credentials.map((cr) => html`<span>${icon('check')}${cr}</span>`)}</div>
  </div>
  <div class="card card-glass telemetry" aria-label="Live availability">
    <div class="telemetry-head"><span class="mono">LIVE LAB TELEMETRY</span><span class="badge badge-good"><span class="dot dot-live"></span>Online</span></div>
    <svg class="gauge" viewBox="0 0 300 190" aria-hidden="true">
      <defs><linearGradient id="gArc" x1="0" x2="1"><stop offset="0" stop-color="#10b981"/><stop offset=".55" stop-color="#f5a524"/><stop offset="1" stop-color="#ff2e55"/></linearGradient></defs>
      <path d="M40 160 A110 110 0 1 1 260 160" fill="none" stroke="var(--surface-3)" stroke-width="16" stroke-linecap="round"/>
      <path d="M40 160 A110 110 0 1 1 260 160" fill="none" stroke="url(#gArc)" stroke-width="16" stroke-linecap="round" pathLength="100" stroke-dasharray="${Math.max(1, Math.round(fill * 100))} 100"/>
      ${raw(Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (1 + i / 10); const r1 = 90; const r2 = i % 5 === 0 ? 74 : 82; return `<line x1="${(150 + Math.cos(a) * r1).toFixed(1)}" y1="${(160 + Math.sin(a) * r1).toFixed(1)}" x2="${(150 + Math.cos(a) * r2).toFixed(1)}" y2="${(160 + Math.sin(a) * r2).toFixed(1)}" stroke="var(--line-3)" stroke-width="2"/>`; }).join(''))}
      <g class="g-needle" data-needle="${needle}" style="transform:rotate(-90deg)"><line x1="150" y1="160" x2="150" y2="78" stroke="var(--accent-hi)" stroke-width="4" stroke-linecap="round"/></g>
      <circle cx="150" cy="160" r="11" fill="var(--surface)" stroke="var(--accent-hi)" stroke-width="3"/>
      <text x="150" y="188" text-anchor="middle" font-size="11" fill="var(--muted)" letter-spacing="2">${openWeek} OPEN SLOTS THIS WEEK</text>
    </svg>
    <div class="readouts">
      <div class="readout"><small>Next available</small><b class="good">${nextLabel}</b></div>
      <div class="readout"><small>Free call-out</small><b>${freeRadius != null ? `≤ ${freeRadius} miles` : 'Ask us'}</b></div>
      <div class="readout"><small>Coverage</small><b>${Math.round(loc.max_miles)} mi radius</b></div>
      <div class="readout"><small>${rating.google || rating.count ? 'Rating' : 'Payment'}</small><b>${ratingText}</b></div>
    </div>
  </div>
</div></section>`;

  const marqueeItems = [...s.business.credentials, rating.google ? `${rating.google.rating.toFixed(1)} ★ Google rating` : '', 'Dealer-level tooling', 'Written PDF reports', 'Live technician tracking', 'Fixed prices'].filter(Boolean);
  const marquee = html`<div class="marquee" aria-label="Credentials"><div class="marquee-track">${[...marqueeItems, ...marqueeItems].map((m) => html`<span class="marquee-item">${icon(m.includes('★') ? 'star' : m.toLowerCase().includes('insur') ? 'shield' : 'check')}${m}</span>`)}</div></div>`;

  const services = html`<section class="section"><div class="wrap">
  ${sectionHead('Two divisions · one lab', html`Engineering-grade <span class="accent">care</span>`, 'Dealer-level diagnostics and coding alongside restorative detailing — all carried out at your home or workplace, with fixed prices and a written report.', html`<a class="btn" href="/services">All services ${icon('arrow')}</a>`)}
  <div class="division-head" id="diagnostics"><span class="num">DIV 01</span><h3>Diagnostics &amp; coding</h3></div>
  <div class="grid grid-3">${featuredDiag.map((p) => pkgCard(p, cur))}</div>
  <div class="division-head" id="detailing"><span class="num">DIV 02</span><h3>Detailing &amp; ceramic</h3></div>
  <div class="grid grid-3">${featuredDetail.map((p) => pkgCard(p, cur))}</div>
  <div class="alert alert-info" style="margin-top:22px">${icon('gift')}<span>Combine two packages on one vehicle and save <b>${money(s.pricing.bundle.two, cur)}</b>, or three and save <b>${money(s.pricing.bundle.threePlus, cur)}</b>. Extra vehicles in the same visit save ${s.pricing.multiVehiclePct}%.</span></div>
</div></section>`;

  const stage = html`<section class="section section-alt"><div class="wrap">
  ${sectionHead('Interactive stage', 'Explore by system', 'Tap a hotspot on the vehicle to see what we can diagnose, code, repair or restore — and switch body style to match yours.')}
  ${vehicleStage(packages, cur)}
</div></section>`;

  const how = html`<section class="section"><div class="wrap">
  ${sectionHead('How it works', 'Booked in a minute')}
  <div class="steps">
    <div class="step"><h3>Pick your services</h3><p>Choose from fixed-price packages or describe the fault. Add up to ${s.booking.maxVehicles} vehicles in one visit.</p></div>
    <div class="step"><h3>Choose a time</h3><p>Live availability shows what is open — including evening and emergency call-outs. Instant confirmation by text.</p></div>
    <div class="step"><h3>Track the lab</h3><p>Follow the mobile lab to your door on a live map, then every stage of the job.</p></div>
    <div class="step"><h3>Pay on completion</h3><p>Card, Apple Pay, Google Pay or cash. Your invoice and technical report stay in your garage account.</p></div>
  </div>
</div></section>`;

  const showcase = gallery.length
    ? html`<div class="masonry">${gallery.map(galleryTile)}</div>`
    : html`<div class="grid grid-2" style="align-items:center">${beforeAfter(html`<div class="ba-layer ba-demo-before"></div>`, html`<div class="ba-layer ba-demo-after"></div>`, 'Drag to compare the illustration')}<div><p class="lead">Swirls, oxidation and haze removed by machine correction, then locked in with ceramic protection.</p><p class="faint mono" style="font-size:.76rem;letter-spacing:.08em">ILLUSTRATION · REAL JOB PHOTOS APPEAR HERE ONCE ADDED IN THE ADMIN GALLERY</p><a class="btn" href="/gallery">Open the lab gallery ${icon('arrow')}</a></div></div>`;
  const results = html`<section class="section section-alt"><div class="wrap">${sectionHead('Transformations', 'From the lab', '', html`<a class="btn" href="/gallery">Full gallery ${icon('arrow')}</a>`)}${showcase}</div></section>`;

  const coverage = html`<section class="section"><div class="wrap">
  ${sectionHead('Coverage', html`We come <span class="accent">to you</span>`, `Based in ${s.business.town} and covering ${s.business.region}. Diagnostics and coding need no mains power or water.`)}
  <div class="grid grid-2" style="grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr)">
    ${coverageMap(loc)}
    <div class="stack">${postcodeChecker(cur)}
      <div class="card zone-legend">${bands.map((b, i) => html`<div><i style="background:${['#10b981', '#f5a524', '#ff2e55', '#38bdf8'][i % 4]}"></i><span><b>${b.label}</b> · ${b.fee ? `+${money(b.fee, cur)}` : 'free'} · up to ${b.upTo} miles</span></div>`)}</div>
      <div class="chip-row">${shell.towns.map((t) => html`<a class="chip" href="/${t.slug}">${icon('pin')}${t.name}</a>`)}</div>
    </div>
  </div>
</div></section>`;

  const reviewsSection = reviews.length
    ? html`<section class="section section-alt"><div class="wrap">${sectionHead('Reviews', 'Trusted locally', '', s.business.googleReviewUrl ? html`<a class="btn" href="${s.business.googleReviewUrl}" target="_blank" rel="noopener">${icon('star')} Google reviews</a>` : '')}<div class="grid grid-3">${reviews.map(reviewCard)}</div></div></section>`
    : s.business.googleReviewUrl
      ? html`<section class="section-tight"><div class="wrap"><div class="card spread"><div><span class="eyebrow">Reviews</span><h3>See what customers say on Google</h3></div><a class="btn btn-primary" href="${s.business.googleReviewUrl}" target="_blank" rel="noopener">${icon('star')} Read Google reviews</a></div></div></section>`
      : '';

  const lookup = html`<section class="section"><div class="wrap"><div class="grid grid-2" style="align-items:center">
  <div><span class="eyebrow">Fault code library</span><h2 class="display">Got a code?<br><span class="accent">Decode it.</span></h2><p class="lead">Type a code from your scanner or MOT advisory for its meaning, likely causes, and how we would pinpoint it.</p></div>
  <div class="card"><form class="dtc-search" data-dtc-search action="/fault-codes">${icon('search')}<input class="input" name="q" placeholder="e.g. P2002, U0100" autocomplete="off" maxlength="20" aria-label="Fault code"></form><div class="dtc-results" data-dtc-results></div></div>
</div></div></section>`;

  const guidesSection = guides.length ? html`<section class="section section-alt"><div class="wrap">${sectionHead('Guides', 'Seasonal know-how', '', html`<a class="btn" href="/guides">All guides ${icon('arrow')}</a>`)}<div class="grid grid-3">${guides.map((g) => html`<a class="card card-link stack" href="/guides/${g.slug}"><span class="row"><span class="badge badge-accent">${g.season === 'all' ? g.category : g.season}</span><span class="meta">${g.read_minutes} min read</span></span><h3>${g.title}</h3><p class="muted" style="margin:0">${g.excerpt}</p></a>`)}</div></div></section>` : '';

  const faqSection = html`<section class="section"><div class="wrap wrap-narrow">${sectionHead('FAQ', 'Good questions')}${faq.html}<p style="margin-top:18px"><a class="accent" href="/faq">More answers →</a></p></div></section>`;

  const fleet = html`<section class="section-tight"><div class="wrap"><div class="card grid grid-2" style="align-items:center">
  <div><span class="eyebrow">Fleet &amp; trade</span><h2 class="display" style="font-size:2.2rem">Keep your fleet earning</h2><p class="muted">Taxi firms, dealers, bodyshops and company fleets: multi-vehicle visits, agreed rates, one monthly invoice and your own branded booking portal.</p><a class="btn btn-primary" href="/fleet">Talk to us about your fleet ${icon('arrow')}</a></div>
  <div class="readouts"><div class="readout"><small>Vehicles per visit</small><b>Up to ${s.booking.maxVehicles}</b></div><div class="readout"><small>Multi-vehicle saving</small><b>${s.pricing.multiVehiclePct}% each</b></div><div class="readout"><small>Invoicing</small><b>Monthly</b></div><div class="readout"><small>Portal</small><b>Branded</b></div></div>
</div></div></section>`;

  return c.html(renderPage(c, shell, {
    title: `${s.business.name} — Mobile Diagnostics, Coding & Detailing in ${s.business.town}`,
    description: `${s.branding.heroSub}`.slice(0, 158),
    path: '/',
    body: html`${hero}${marquee}${services}${stage}${how}${results}${coverage}${reviewsSection}${lookup}${guidesSection}${fleet}${faqSection}${ctaBand(shell)}`,
    jsonLd: [faq.ld, { '@context': 'https://schema.org', '@type': 'WebSite', name: s.business.name, url: shell.origin, potentialAction: { '@type': 'SearchAction', target: `${shell.origin}/fault-codes?q={code}`, 'query-input': 'required name=code' } }],
  }));
});

function currentSeason(date: string): string {
  const m = Number(date.slice(5, 7));
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
}

// ───────────────────────────── Services ─────────────────────────────
pageRoutes.get('/services', async (c) => {
  const shell = await loadShell(c);
  const db = c.env.DB;
  const loc = await getLocation(db);
  const packages = await getPackages(db);
  const plans = await all<{ name: string; summary: string; includes: string; interval: string; price_s: number; price_l: number; package_slug: string }>(db, 'SELECT * FROM plans WHERE active = 1 ORDER BY sort');
  const cur = loc.currency;
  const group = (cat: string) => packages.filter((p) => p.category === cat);
  const bc = crumbs(shell, [['/services', 'Services']]);
  const list = (cat: string, id: string, num: string, title: string) => html`<div class="division-head" id="${id}"><span class="num">${num}</span><h3>${title}</h3></div><div class="grid grid-3">${group(cat).map((p) => pkgCard(p, cur))}</div>`;
  return c.html(renderPage(c, shell, {
    title: 'Services & Prices', description: 'Fixed-price mobile diagnostics, OEM coding, DPF recovery, detailing, paint correction and ceramic coating.', path: '/services',
    jsonLd: [bc.ld, { '@context': 'https://schema.org', '@type': 'OfferCatalog', name: 'Services', itemListElement: packages.map((p) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: p.name, description: p.summary }, price: (p.price_s / 100).toFixed(2), priceCurrency: cur })) }],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Services &amp; prices</span><h1 class="display">Fixed prices.<br><span class="accent">No surprises.</span></h1><p class="lead">Every package has a clear price before you book. Detailing is priced by vehicle size; diagnostics and coding are the same for every car.</p></div></section>
<section class="section-tight"><div class="wrap">
  ${list('diagnostics', 'diagnostics', 'DIV 01', 'Diagnostics & coding')}
  ${list('detailing', 'detailing', 'DIV 02', 'Detailing & ceramic')}
  <div class="division-head" id="plans"><span class="num">PLANS</span><h3>Maintenance plans</h3></div>
  <div class="grid grid-2">${plans.map((p) => html`<div class="card stack"><div class="spread"><h3>${p.name}</h3><span class="badge badge-accent">${p.interval}</span></div><p class="muted" style="margin:0">${p.summary}</p><ul class="includes">${parseJson<string[]>(p.includes, []).map((i) => html`<li>${i}</li>`)}</ul><div class="spread"><span class="price"><small>per visit from</small>${money(p.price_s, cur)}</span><a class="btn btn-primary" href="/book?package=${p.package_slug}">Start plan</a></div></div>`)}</div>
  <div class="division-head" id="addons"><span class="num">ADD-ONS</span><h3>Add while we're there</h3></div>
  <div class="grid grid-3">${group('addon').map((p) => pkgCard(p, cur))}</div>
</div></section>${ctaBand(shell)}`,
  }));
});

pageRoutes.get('/services/:slug', async (c) => {
  const shell = await loadShell(c);
  const db = c.env.DB;
  const p = await first<PackageRow>(db, 'SELECT * FROM packages WHERE slug = ? AND active = 1', c.req.param('slug'));
  if (!p) fail(404, 'That service could not be found.');
  const loc = await getLocation(db);
  const cur = loc.currency;
  const related = await all<PackageRow>(db, 'SELECT * FROM packages WHERE active = 1 AND category = ? AND id <> ? ORDER BY featured DESC, sort LIMIT 3', p!.category, p!.id);
  const codes = await all<{ code: string; title: string; severity: string }>(db, 'SELECT code, title, severity FROM dtc_codes WHERE package_slug = ? AND public = 1 ORDER BY code LIMIT 8', p!.slug);
  const bc = crumbs(shell, [['/services', 'Services'], [`/services/${p!.slug}`, p!.name]]);
  const includes = parseJson<string[]>(p!.includes, []);
  return c.html(renderPage(c, shell, {
    title: p!.name, description: p!.summary.slice(0, 158), path: `/services/${p!.slug}`,
    jsonLd: [bc.ld, { '@context': 'https://schema.org', '@type': 'Service', name: p!.name, description: p!.summary, provider: { '@id': `${shell.origin}/#business` }, areaServed: shell.towns.map((t) => t.name), offers: { '@type': 'AggregateOffer', priceCurrency: cur, lowPrice: (p!.price_s / 100).toFixed(2), highPrice: (p!.price_l / 100).toFixed(2) } }],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}
  <div class="grid grid-2" style="align-items:end"><div>${p!.badge ? html`<span class="badge badge-accent" style="margin-bottom:14px">${p!.badge}</span>` : ''}<h1 class="display" style="font-size:clamp(2.2rem,5vw,3.8rem)">${p!.name}</h1><p class="lead">${p!.summary}</p></div>
  <div class="card card-glass stack"><div class="spread"><span class="meta">${icon('clock')}${duration(p!.duration_min)} on site</span>${p!.needs_utilities ? html`<span class="badge badge-warn">Needs tap &amp; 240V</span>` : html`<span class="badge badge-good">No mains power needed</span>`}</div>
    ${p!.price_s === p!.price_l ? html`<div class="price" style="font-size:2.4rem">${money(p!.price_m, cur)}</div>` : html`<div class="readouts">${(['S', 'M', 'L'] as const).map((sz) => html`<div class="readout"><small>${sz === 'S' ? 'Small' : sz === 'M' ? 'Medium' : 'Large'}</small><b>${money(sz === 'S' ? p!.price_s : sz === 'M' ? p!.price_m : p!.price_l, cur)}</b></div>`)}</div>`}
    <a class="btn btn-primary btn-lg btn-block" href="/book?package=${p!.slug}">Book this service ${icon('arrow')}</a></div></div>
</div></section>
<section class="section-tight"><div class="wrap grid grid-2">
  <div class="card"><h3 style="margin-bottom:14px">What's included</h3><ul class="includes">${includes.map((i) => html`<li>${i}</li>`)}</ul></div>
  <div class="card stack"><h3>Where we work</h3><p class="muted" style="margin:0">${p!.needs_utilities ? 'This package needs driveway access, an outside tap and a 240V socket within about 25 metres. No access? Choose lab drop-off when booking.' : 'Carried out at your home, workplace or the roadside — no mains power or water needed.'}</p><p class="muted" style="margin:0">Zone: ${VEHICLE_ZONES[p!.zone]?.label ?? p!.zone}</p></div>
</div></section>
${codes.length ? html`<section class="section-tight"><div class="wrap"><h3 style="margin-bottom:14px">Fault codes this service resolves</h3><div class="chip-row">${codes.map((d) => html`<a class="chip mono" href="/fault-codes/${d.code}">${d.code} · ${d.title.slice(0, 40)}</a>`)}</div></div></section>` : ''}
${related.length ? html`<section class="section-tight"><div class="wrap"><h3 style="margin-bottom:14px">Often booked together</h3><div class="grid grid-3">${related.map((r) => pkgCard(r, cur))}</div></div></section>` : ''}
${ctaBand(shell)}`,
  }));
});

// ───────────────────────────── Booking, tracking, account ─────────────────────────────
const noscript = (shell: Shell) => html`<noscript><div class="alert alert-warn">${icon('alert')}<span>Online booking needs JavaScript. Call <a href="tel:${normPhone(shell.settings.business.phone)}">${shell.settings.business.phone}</a> or WhatsApp us and we'll book you in.</span></div></noscript>`;

pageRoutes.get('/book', async (c) => {
  const shell = await loadShell(c);
  const bc = crumbs(shell, [['/book', 'Book a visit']]);
  return c.html(renderPage(c, shell, {
    title: 'Book a Visit', description: 'Book mobile diagnostics, coding or detailing online. Live availability, instant confirmation and pay on completion.', path: '/book', scripts: ['book'], mobileBar: false,
    jsonLd: [bc.ld],
    body: html`<section class="section-tight grid-bg"><div class="wrap">${bc.html}<div id="book-app" data-emergency="${c.req.query('emergency') === '1' ? '1' : ''}">${noscript(shell)}<div class="stack" aria-hidden="true"><div class="skeleton" style="height:28px;width:40%"></div><div class="skeleton" style="height:56px;width:70%"></div><div class="grid grid-3"><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div></div></div></div></div></section>`,
  }));
});

pageRoutes.get('/track/:token', async (c) => {
  const b = await getBookingByToken(c.env.DB, c.req.param('token'));
  if (!b) fail(404, 'This tracking link is not valid. Please check the link in your confirmation message.');
  const shell = await loadShell(c);
  return c.html(renderPage(c, shell, {
    title: `Booking ${b!.ref}`, description: 'Live tracker for your SpecOne booking.', path: `/track/${b!.access_token}`, scripts: ['track'], noindex: true, hideBanners: true,
    body: html`<section class="section-tight"><div class="wrap"><div id="track-app" data-token="${b!.access_token}"><div class="stack"><div class="skeleton" style="height:40px;width:50%"></div><div class="skeleton" style="height:420px"></div></div></div></div></section>`,
  }));
});

pageRoutes.get('/account', async (c) => {
  const shell = await loadShell(c);
  return c.html(renderPage(c, shell, {
    title: 'My Garage', description: 'Your bookings, vehicles, reports, plans and loyalty points.', path: '/account', scripts: ['account'], noindex: true,
    body: html`<section class="section-tight grid-bg"><div class="wrap"><div id="account-app" data-signed-in="${c.get('customer') ? '1' : ''}"><div class="stack"><div class="skeleton" style="height:40px;width:40%"></div><div class="skeleton" style="height:260px"></div></div></div></div></section>`,
  }));
});

// ───────────────────────────── Coverage & towns ─────────────────────────────
pageRoutes.get('/coverage', async (c) => {
  const shell = await loadShell(c);
  const loc = await getLocation(c.env.DB);
  const bands = travelBandsOf(loc).sort((a, b) => a.upTo - b.upTo);
  const bc = crumbs(shell, [['/coverage', 'Coverage']]);
  return c.html(renderPage(c, shell, {
    title: 'Coverage & Travel', description: `Mobile coverage around ${shell.settings.business.town} with transparent travel bands. Check your postcode.`, path: '/coverage', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Coverage</span><h1 class="display">Where the lab goes</h1><p class="lead">Distance is measured from our ${loc.name} base. Enter your postcode for your exact travel fee — it is shown before you book and never added afterwards.</p></div></section>
<section class="section-tight"><div class="wrap grid grid-2" style="grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr)">
  ${coverageMap(loc)}
  <div class="stack">${postcodeChecker(loc.currency)}
    <div class="table-wrap"><table class="table"><thead><tr><th>Zone</th><th>Distance</th><th>Travel</th></tr></thead><tbody>${bands.map((b) => html`<tr><td>${b.label}</td><td class="mono">≤ ${b.upTo} mi</td><td class="mono">${b.fee ? money(b.fee, loc.currency) : 'Free'}</td></tr>`)}</tbody></table></div>
    <p class="muted" style="font-size:.9rem">Further than ${loc.max_miles} miles? Call us — larger jobs and fleets often make the trip worthwhile.</p>
    <div class="chip-row">${shell.towns.map((t) => html`<a class="chip" href="/${t.slug}">${icon('pin')}${t.name}</a>`)}</div>
  </div>
</div></section>${ctaBand(shell)}`,
  }));
});

// ───────────────────────────── Fault codes & coding ─────────────────────────────
pageRoutes.get('/fault-codes', async (c) => {
  const shell = await loadShell(c);
  const codes = await all<{ code: string; title: string; system: string; severity: string }>(c.env.DB, 'SELECT code, title, system, severity FROM dtc_codes WHERE public = 1 ORDER BY system, code');
  const systems = [...new Set(codes.map((d) => d.system))];
  const q = (c.req.query('q') ?? '').toUpperCase().slice(0, 20);
  const bc = crumbs(shell, [['/fault-codes', 'Fault codes']]);
  return c.html(renderPage(c, shell, {
    title: 'OBD Fault Code Library', description: 'Look up OBD-II fault codes: meaning, probable causes and how a technician pinpoints them. DPF, AdBlue, CAN-bus, fuel and more.', path: '/fault-codes', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap wrap-narrow" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${bc.html}<span class="eyebrow">Fault code library</span><h1 class="display">Decode your warning light</h1><p class="lead">${codes.length} common OBD-II codes with plain-English causes and the diagnostic route we would take.</p>
  <form class="dtc-search" data-dtc-search action="/fault-codes">${icon('search')}<input class="input" name="q" value="${q}" placeholder="Type a code, e.g. P0299" autocomplete="off" maxlength="20" aria-label="Fault code"></form><div class="dtc-results" data-dtc-results></div></div></section>
<section class="section-tight"><div class="wrap">${systems.map((sys) => html`<h3 style="margin:26px 0 12px">${sys}</h3><div class="dtc-results">${codes.filter((d) => d.system === sys).map((d) => html`<a class="dtc sev-${d.severity}" href="/fault-codes/${d.code}"><span class="dtc-code">${d.code}</span><span>${d.title}</span>${icon('arrow')}</a>`)}</div>`)}</div></section>
<section class="section-tight"><div class="wrap"><div class="alert alert-info">${icon('info')}<span>A code tells you which circuit reported a problem — not which part failed. Generic definitions shown; manufacturers can add their own meanings. Book a pinpoint diagnosis to find the real cause.</span></div></div></section>${ctaBand(shell, 'Code still a mystery?', 'We read every module, graph the live data and find the root cause — with a written report.')}`,
  }));
});

pageRoutes.get('/fault-codes/:code', async (c) => {
  const shell = await loadShell(c);
  const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const d = await first<{ code: string; title: string; system: string; causes: string; fixes: string; severity: string; package_slug: string }>(c.env.DB, 'SELECT * FROM dtc_codes WHERE code = ? AND public = 1', code);
  if (!d) fail(404, `We don't have ${code} in the library yet — call us and we'll look it up for your vehicle.`);
  const loc = await getLocation(c.env.DB);
  const pkg = d!.package_slug ? await first<PackageRow>(c.env.DB, 'SELECT * FROM packages WHERE slug = ? AND active = 1', d!.package_slug) : null;
  const related = await all<{ code: string; title: string; severity: string }>(c.env.DB, 'SELECT code, title, severity FROM dtc_codes WHERE system = ? AND code <> ? AND public = 1 ORDER BY code LIMIT 6', d!.system, d!.code);
  const sev = d!.severity === 'red' ? { cls: 'bad', text: 'Stop and get it checked', note: 'This fault can cause damage or leave you stranded. Avoid driving until it is diagnosed.' } : d!.severity === 'amber' ? { cls: 'warn', text: 'Book a check soon', note: 'Usually safe to drive gently in the short term, but it will get worse and can damage other parts.' } : { cls: 'info', text: 'Low urgency', note: 'Unlikely to affect safety, but it may affect economy or an MOT emissions test.' };
  const bc = crumbs(shell, [['/fault-codes', 'Fault codes'], [`/fault-codes/${d!.code}`, d!.code]]);
  const faq = faqBlock([
    { question: `What does ${d!.code} mean?`, answer: `${d!.code}: ${d!.title}. It is logged by the ${d!.system.toLowerCase()} system.` },
    { question: `What causes ${d!.code}?`, answer: d!.causes },
    { question: `How is ${d!.code} fixed?`, answer: d!.fixes },
  ]);
  return c.html(renderPage(c, shell, {
    title: `${d!.code} — ${d!.title}`, description: `${d!.code}: ${d!.title}. Causes: ${d!.causes}`.slice(0, 158), path: `/fault-codes/${d!.code}`, jsonLd: [bc.ld, faq.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<div class="row"><span class="dtc-code mono" style="font-size:1.5rem;padding:8px 14px;border-radius:12px;background:var(--surface-3)">${d!.code}</span><span class="badge badge-${sev.cls}">${sev.text}</span><span class="badge">${d!.system}</span></div><h1 class="display" style="font-size:clamp(2rem,4.6vw,3.4rem);margin-top:18px">${d!.title}</h1></div></section>
<section class="section-tight"><div class="wrap grid grid-2">
  <div class="stack"><div class="alert alert-${sev.cls}">${icon('alert')}<span>${sev.note}</span></div>
    <div class="card"><h3 style="margin-bottom:10px">Probable causes</h3><p class="muted" style="margin:0">${d!.causes}</p></div>
    <div class="card"><h3 style="margin-bottom:10px">How we pinpoint it</h3><p class="muted" style="margin:0">${d!.fixes}</p></div></div>
  <div class="stack">${pkg ? html`<div class="card card-glass stack"><span class="eyebrow">Recommended</span><h3>${pkg.name}</h3><p class="muted" style="margin:0">${pkg.summary}</p><div class="spread"><span class="price">${fromPrice(pkg, loc.currency)}</span><a class="btn btn-primary" href="/book?package=${pkg.slug}&amp;symptom=${encodeURIComponent(d!.code)}">Book now</a></div></div>` : ''}
    ${related.length ? html`<div class="card"><h3 style="margin-bottom:12px">Related ${d!.system} codes</h3><div class="dtc-results">${related.map((r) => html`<a class="dtc sev-${r.severity}" href="/fault-codes/${r.code}"><span class="dtc-code">${r.code}</span><span>${r.title}</span>${icon('arrow')}</a>`)}</div></div>` : ''}</div>
</div></section>${ctaBand(shell)}`,
  }));
});

pageRoutes.get('/coding', async (c) => {
  const shell = await loadShell(c);
  const rows = await all<{ make_group: string; platform: string; feature: string; module: string; tool: string; notes: string }>(c.env.DB, 'SELECT make_group, platform, feature, module, tool, notes FROM coding_matrix WHERE public = 1 ORDER BY make_group, feature');
  const makes = [...new Set(rows.map((r) => r.make_group))];
  const bc = crumbs(shell, [['/coding', 'Coding matrix']]);
  return c.html(renderPage(c, shell, {
    title: 'OEM Feature Coding — What We Can Unlock', description: 'Hidden feature activation and module coding for BMW, MINI, VAG, Ford, Land Rover and Mercedes-Benz.', path: '/coding', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">OEM coding matrix</span><h1 class="display">Unlock what's<br><span class="accent">already there</span></h1><p class="lead">Factory features built into your car's modules, switched on with dealer-level tools — with a full configuration backup first. Availability depends on hardware and software level; we check before we start.</p>
  <div class="chip-row" style="margin-top:20px">${makes.map((m) => html`<a class="chip" href="#${m.replace(/[^a-z]/gi, '')}">${m}</a>`)}</div></div></section>
<section class="section-tight"><div class="wrap stack" style="gap:30px">${makes.map((m) => html`<div id="${m.replace(/[^a-z]/gi, '')}"><h2 class="display" style="font-size:2rem;margin-bottom:14px">${m}</h2><div class="table-wrap"><table class="table"><thead><tr><th>Feature</th><th>Platform</th><th>Module</th><th>Tool</th></tr></thead><tbody>${rows.filter((r) => r.make_group === m).map((r) => html`<tr><td><b>${r.feature}</b>${r.notes ? html`<br><span class="muted" style="font-size:.85rem">${r.notes}</span>` : ''}</td><td class="mono" style="font-size:.85rem">${r.platform}</td><td style="font-size:.88rem">${r.module}</td><td style="font-size:.88rem">${r.tool}</td></tr>`)}</tbody></table></div></div>`)}</div></section>
${ctaBand(shell, "Don't see your car?", 'Tell us the make, model and year and we will check what your modules support.')}`,
  }));
});

// ───────────────────────────── Gallery, reviews, FAQ, guides ─────────────────────────────
pageRoutes.get('/gallery', async (c) => {
  const shell = await loadShell(c);
  const items = await all<GalleryRow>(c.env.DB, `${GALLERY_SQL} ORDER BY g.featured DESC, g.sort, g.id DESC LIMIT 120`);
  const tags = [...new Set(items.flatMap((g) => g.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)))].slice(0, 16);
  const social = shell.settings.business.social;
  const bc = crumbs(shell, [['/gallery', 'Lab gallery']]);
  const tiles = items.map(galleryTile).filter(Boolean);
  return c.html(renderPage(c, shell, {
    title: 'Lab Gallery — Detailing & Diagnostics Results', description: 'Before-and-after paint correction, ceramic coatings, interior restorations and coding work from the SpecOne mobile lab.', path: '/gallery', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Lab gallery</span><h1 class="display">Results, not promises</h1><p class="lead">Recent transformations and technical work. Tap any photo to view it full screen; drag the sliders to compare before and after.</p>
  ${social.instagram || social.tiktok ? html`<div class="row" style="margin-top:18px">${social.instagram ? html`<a class="btn" href="${social.instagram}" target="_blank" rel="noopener">${icon('instagram')} Instagram</a>` : ''}${social.tiktok ? html`<a class="btn" href="${social.tiktok}" target="_blank" rel="noopener">${icon('tiktok')} TikTok</a>` : ''}</div>` : ''}</div></section>
<section class="section-tight"><div class="wrap">
  ${tags.length ? html`<div class="filter-bar" data-gallery-filter><button class="chip is-on" type="button" data-tag="">All</button>${tags.map((t) => html`<button class="chip" type="button" data-tag="${t}">${t}</button>`)}</div>` : ''}
  ${tiles.length ? html`<div class="masonry" data-gallery>${tiles}</div>` : html`<div class="grid grid-2" style="align-items:center">${beforeAfter(html`<div class="ba-layer ba-demo-before"></div>`, html`<div class="ba-layer ba-demo-after"></div>`)}<div class="card stack"><h3>Fresh results coming soon</h3><p class="muted" style="margin:0">The latest photos and video walkthroughs from the lab will appear here.</p><a class="btn btn-primary" href="/book">Book your transformation</a></div></div>`}
</div></section>${ctaBand(shell)}`,
  }));
});

pageRoutes.get('/reviews', async (c) => {
  const shell = await loadShell(c);
  const reviews = await all<{ author: string; rating: number; body: string; vehicle: string; reviewed_on: string; source: string }>(c.env.DB, 'SELECT author, rating, body, vehicle, reviewed_on, source FROM reviews WHERE visible = 1 ORDER BY reviewed_on DESC LIMIT 100');
  const summary = await reviewSummary(c.env.DB);
  const b = shell.settings.business;
  const bc = crumbs(shell, [['/reviews', 'Reviews']]);
  const ld = summary.count ? [{ '@context': 'https://schema.org', '@type': 'AutoRepair', '@id': `${shell.origin}/#business`, name: b.name, aggregateRating: { '@type': 'AggregateRating', ratingValue: summary.avg.toFixed(1), reviewCount: summary.count } }] : [];
  return c.html(renderPage(c, shell, {
    title: 'Customer Reviews', description: `Genuine reviews from ${b.name} customers.`, path: '/reviews', jsonLd: [bc.ld, ...ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<div class="spread" style="align-items:end"><div><span class="eyebrow">Reviews</span><h1 class="display">What customers say</h1></div>
  <div class="row">${summary.google ? html`<div class="card card-tight"><div class="rating-big">${summary.google.rating.toFixed(1)}</div><span class="stars" style="color:#f5b400">${stars(summary.google.rating)}</span><div class="muted mono" style="font-size:.75rem">${summary.google.count} GOOGLE REVIEWS</div></div>` : ''}${summary.count ? html`<div class="card card-tight"><div class="rating-big">${summary.avg.toFixed(1)}</div><span class="stars" style="color:#f5b400">${stars(summary.avg)}</span><div class="muted mono" style="font-size:.75rem">${summary.count} VERIFIED JOBS</div></div>` : ''}</div></div>
  ${b.googleReviewUrl ? html`<div class="row" style="margin-top:20px"><a class="btn btn-primary" href="${b.googleReviewUrl}" target="_blank" rel="noopener">${icon('star')} Read & write Google reviews</a></div>` : ''}</div></section>
<section class="section-tight"><div class="wrap">${reviews.length ? html`<div class="grid grid-3">${reviews.map(reviewCard)}</div>` : html`<div class="card"><p class="muted" style="margin:0">Reviews from completed jobs appear here once customers leave feedback.${b.googleReviewUrl ? html` In the meantime, <a class="accent" href="${b.googleReviewUrl}" target="_blank" rel="noopener">see our Google reviews</a>.` : ''}</p></div>`}</div></section>`,
  }));
});

pageRoutes.get('/faq', async (c) => {
  const shell = await loadShell(c);
  const faqs = await all<{ category: string; question: string; answer: string }>(c.env.DB, 'SELECT category, question, answer FROM faqs WHERE active = 1 ORDER BY sort, id');
  const cats = [...new Set(faqs.map((f) => f.category))];
  const all_ = faqBlock(faqs);
  const bc = crumbs(shell, [['/faq', 'FAQ']]);
  return c.html(renderPage(c, shell, {
    title: 'Frequently Asked Questions', description: 'Mobile visit requirements, coding safety, payments, coverage and booking questions answered.', path: '/faq', jsonLd: [bc.ld, all_.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">FAQ</span><h1 class="display">Questions, answered</h1></div></section>
<section class="section-tight"><div class="wrap wrap-narrow" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${cats.map((cat) => html`<h2 class="display" style="font-size:1.7rem;margin:28px 0 14px">${cat}</h2>${faqBlock(faqs.filter((f) => f.category === cat)).html}`)}</div></section>${ctaBand(shell, 'Still wondering?', 'Ask in the live chat or call — a technician will answer.')}`,
  }));
});

pageRoutes.get('/guides', async (c) => {
  const shell = await loadShell(c);
  const guides = await all<{ slug: string; title: string; excerpt: string; season: string; category: string; read_minutes: number; published_on: string }>(c.env.DB, 'SELECT slug, title, excerpt, season, category, read_minutes, published_on FROM guides WHERE active = 1 ORDER BY published_on DESC');
  const bc = crumbs(shell, [['/guides', 'Guides']]);
  return c.html(renderPage(c, shell, {
    title: 'Car Care & Diagnostics Guides', description: 'Seasonal detailing advice and plain-English diagnostics guides from the SpecOne lab.', path: '/guides', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Guides</span><h1 class="display">From the workbench</h1><p class="lead">Practical advice to keep your car healthy between visits.</p></div></section>
<section class="section-tight"><div class="wrap"><div class="grid grid-3">${guides.map((g) => html`<a class="card card-link stack" href="/guides/${g.slug}"><span class="row"><span class="badge badge-accent">${g.season === 'all' ? g.category : g.season}</span><span class="meta">${g.read_minutes} min read</span></span><h3>${g.title}</h3><p class="muted" style="margin:0">${g.excerpt}</p><span class="meta">${formatDate(g.published_on)}</span></a>`)}</div></div></section>`,
  }));
});

pageRoutes.get('/guides/:slug', async (c) => {
  const shell = await loadShell(c);
  const g = await first<{ slug: string; title: string; excerpt: string; body: string; season: string; category: string; read_minutes: number; published_on: string }>(c.env.DB, 'SELECT * FROM guides WHERE slug = ? AND active = 1', c.req.param('slug'));
  if (!g) fail(404, 'That guide could not be found.');
  const bc = crumbs(shell, [['/guides', 'Guides'], [`/guides/${g!.slug}`, g!.title]]);
  return c.html(renderPage(c, shell, {
    title: g!.title, description: g!.excerpt.slice(0, 158), path: `/guides/${g!.slug}`,
    jsonLd: [bc.ld, { '@context': 'https://schema.org', '@type': 'Article', headline: g!.title, description: g!.excerpt, datePublished: g!.published_on, author: { '@type': 'Organization', name: shell.settings.business.name }, publisher: { '@id': `${shell.origin}/#business` } }],
    body: html`<section class="page-head grid-bg"><div class="wrap wrap-narrow" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${bc.html}<span class="row"><span class="badge badge-accent">${g!.season === 'all' ? g!.category : g!.season}</span><span class="meta">${g!.read_minutes} min read · ${formatDate(g!.published_on)}</span></span><h1 class="display" style="font-size:clamp(2.2rem,5vw,3.6rem);margin-top:16px">${g!.title}</h1><p class="lead">${g!.excerpt}</p></div></section>
<section class="section-tight"><div class="wrap wrap-narrow prose" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${markdown(g!.body)}</div></section>${ctaBand(shell)}`,
  }));
});

// ───────────────────────────── Fleet & trade ─────────────────────────────
pageRoutes.get('/fleet', async (c) => {
  const shell = await loadShell(c);
  const db = c.env.DB;
  const loc = await getLocation(db);
  const plans = await all<{ name: string; summary: string; includes: string; interval: string; price_s: number; package_slug: string; audience: string }>(db, 'SELECT * FROM plans WHERE active = 1 ORDER BY audience DESC, sort');
  const s = shell.settings;
  const bc = crumbs(shell, [['/fleet', 'Fleet & trade']]);
  return c.html(renderPage(c, shell, {
    title: 'Fleet, Taxi & Trade Accounts', description: 'Mobile diagnostics and cleaning for taxi firms, dealers, bodyshops and company fleets — agreed rates, monthly invoicing and branded booking portals.', path: '/fleet', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Fleet &amp; trade</span><h1 class="display">Less downtime.<br><span class="accent">One invoice.</span></h1><p class="lead">We work at your yard, showroom or bodyshop so vehicles stay earning. Multi-vehicle visits, agreed rates and a branded portal your drivers or team can book through.</p></div></section>
<section class="section-tight"><div class="wrap grid grid-2">
  <div class="stack">
    <div class="steps" style="grid-template-columns:1fr">
      <div class="step"><h3>Branded booking portal</h3><p>Your own page with your logo and agreed discount, so drivers and staff book the right services at the right price.</p></div>
      <div class="step"><h3>Multi-vehicle visits</h3><p>Up to ${s.booking.maxVehicles} vehicles per booking, ${s.pricing.multiVehiclePct}% off every extra vehicle, and priority emergency call-outs.</p></div>
      <div class="step"><h3>Referral partnerships</h3><p>Bodyshops, auctions and garages earn commission on every customer they send our way — tracked automatically.</p></div>
    </div>
    ${plans.filter((p) => p.audience === 'fleet').map((p) => html`<div class="card stack"><div class="spread"><h3>${p.name}</h3><span class="badge badge-accent">${p.interval}</span></div><p class="muted" style="margin:0">${p.summary}</p><span class="price"><small>per vehicle per visit from</small>${money(p.price_s, loc.currency)}</span></div>`)}
  </div>
  <form class="card stack" data-enquiry-form data-kind="fleet">
    <h3>Tell us about your fleet</h3>
    <div class="form-grid"><div class="field"><label for="f-name">Your name</label><input class="input" id="f-name" name="name" required maxlength="80" autocomplete="name"></div><div class="field"><label for="f-company">Company</label><input class="input" id="f-company" name="company" maxlength="120" autocomplete="organization"></div></div>
    <div class="form-grid"><div class="field"><label for="f-phone">Phone</label><input class="input" id="f-phone" name="phone" type="tel" maxlength="24" autocomplete="tel"></div><div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" maxlength="120" autocomplete="email"></div></div>
    <div class="field"><label for="f-veh">Fleet size &amp; types</label><input class="input" id="f-veh" name="vehicles" maxlength="60" placeholder="e.g. 12 taxis, 3 vans"></div>
    <div class="field"><label for="f-msg">What do you need?</label><textarea class="textarea" id="f-msg" name="message" maxlength="2000"></textarea></div>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div data-turnstile></div>
    <button class="btn btn-primary btn-lg" type="submit">Send enquiry</button>
    <div data-form-result aria-live="polite"></div>
  </form>
</div></section>`,
  }));
});

pageRoutes.get('/fleet/:slug', async (c) => {
  const portal = await first<{ slug: string; company_name: string; accent: string; headline: string; intro: string; discount_pct: number; contact_name: string; logo_key: string | null }>(
    c.env.DB, 'SELECT f.*, m.storage_key AS logo_key FROM fleet_portals f LEFT JOIN media m ON m.id = f.logo_media_id WHERE f.slug = ? AND f.active = 1', c.req.param('slug'),
  );
  if (!portal) fail(404, 'That portal could not be found.');
  const shell = await loadShell(c);
  const accent = /^#[0-9a-f]{6}$/i.test(portal!.accent) ? portal!.accent : '#e11d48';
  return c.html(renderPage(c, shell, {
    title: `${portal!.company_name} — Booking Portal`, description: `Book SpecOne services for ${portal!.company_name}.`, path: `/fleet/${portal!.slug}`, scripts: ['book'], noindex: true, mobileBar: false,
    body: html`<section class="section-tight grid-bg"><div class="wrap stack" style="gap:22px">
  <div class="portal-brand" style="--portal-accent:${accent}">${portal!.logo_key ? html`<img src="${mediaUrl(portal!.logo_key)}" alt="${portal!.company_name}">` : html`<span class="avatar" style="width:48px;height:48px;font-size:1.2rem">${portal!.company_name[0]}</span>`}<div><span class="eyebrow" style="margin:0 0 4px;color:${accent}">Fleet portal</span><h1 class="display" style="font-size:2rem">${portal!.headline || portal!.company_name}</h1>${portal!.intro ? html`<p class="muted" style="margin:6px 0 0">${portal!.intro}</p>` : ''}</div>${portal!.discount_pct ? html`<span class="badge badge-good" style="margin-left:auto">${portal!.discount_pct}% agreed rate</span>` : ''}</div>
  <div id="book-app" data-fleet="${portal!.slug}">${noscript(shell)}</div>
</div></section>`,
  }));
});

// ───────────────────────────── Emergency & partners ─────────────────────────────
pageRoutes.get('/emergency', async (c) => {
  const shell = await loadShell(c);
  const b = shell.settings.business;
  const recovery = await all<{ name: string; phone: string; website: string; notes: string }>(c.env.DB, "SELECT name, phone, website, notes FROM partners WHERE active = 1 AND public_listing = 1 AND kind = 'recovery' ORDER BY name LIMIT 4");
  const bc = crumbs(shell, [['/emergency', 'Emergency']]);
  return c.html(renderPage(c, shell, {
    title: 'Emergency Mobile Diagnostics', description: `Stranded, in limp mode or showing a red warning light? Emergency mobile diagnostics across ${b.region}. Call ${b.phone}.`, path: '/emergency', hideBanners: true, jsonLd: [bc.ld],
    body: html`<div class="sos-hero"></div><section class="section-tight"><div class="wrap stack" style="gap:22px">${bc.html}
  <div class="sos-panel"><span class="eyebrow" style="color:#ffdf1a;justify-content:center">Emergency call-out</span><h1 class="display" style="font-size:clamp(2.4rem,7vw,4.6rem);color:#fff">Stuck? We'll come to you.</h1><p class="lead" style="margin:16px auto 26px;color:#cfd5df">Limp mode, a red warning, a no-start or a flat battery — call now for priority dispatch, including evenings.</p>
    <a class="sos-call" href="tel:${normPhone(b.phone)}">${icon('phone')}<span>${b.phone}</span><small style="font-family:var(--font-mono);letter-spacing:.14em">TAP TO CALL NOW</small></a>
    <div class="row" style="justify-content:center;margin-top:22px"><a class="btn btn-lg" style="--btn-bg:#25d366;--btn-fg:#04120c;--btn-line:transparent" href="https://wa.me/${normPhone(b.whatsapp).replace('+', '')}?text=${encodeURIComponent('EMERGENCY: I need help with my vehicle at ')}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp your location</a><a class="btn btn-lg" style="--btn-bg:rgba(255,255,255,.08);--btn-fg:#fff;--btn-line:rgba(255,255,255,.2)" href="/book?emergency=1">Book an emergency slot online</a></div>
  </div>
  <div class="grid grid-3">
    <div class="card"><h3 style="margin-bottom:8px">1 · Get safe</h3><p class="muted" style="margin:0">Pull over somewhere safe, hazards on. On a motorway, leave the car and stand behind the barrier.</p></div>
    <div class="card"><h3 style="margin-bottom:8px">2 · Note the lights</h3><p class="muted" style="margin:0">Photograph the dashboard warnings and any message. Red usually means stop; amber means get it checked.</p></div>
    <div class="card"><h3 style="margin-bottom:8px">3 · Call us</h3><p class="muted" style="margin:0">Tell us where you are and what happened. We'll say straight away whether we can fix it on the spot or you need recovery.</p></div>
  </div>
  ${recovery.length ? html`<div class="card"><h3 style="margin-bottom:12px">Recovery partners</h3><div class="grid grid-2">${recovery.map((r) => html`<div class="spread"><span><b>${r.name}</b>${r.notes ? html`<br><span class="muted" style="font-size:.88rem">${r.notes}</span>` : ''}</span>${r.phone ? html`<a class="btn btn-sm" href="tel:${normPhone(r.phone)}">${icon('phone')} ${r.phone}</a>` : ''}</div>`)}</div></div>` : ''}
  <div class="alert alert-warn">${icon('alert')}<span>An emergency call-out fee of <b>${money(shell.settings.pricing.emergencyFee, shell.settings.business.currency)}</b> applies for same-day priority dispatch. If your car is unsafe to repair at the roadside we'll help arrange recovery.</span></div>
</div></section>`,
  }));
});

pageRoutes.get('/recovery-partners', async (c) => {
  const shell = await loadShell(c);
  const partners = await all<{ name: string; kind: string; phone: string; website: string; notes: string }>(c.env.DB, 'SELECT name, kind, phone, website, notes FROM partners WHERE active = 1 AND public_listing = 1 ORDER BY kind, name');
  const bc = crumbs(shell, [['/recovery-partners', 'Partners']]);
  return c.html(renderPage(c, shell, {
    title: 'Recovery & Trade Partners', description: 'Local recovery operators, bodyshops and garages we work with.', path: '/recovery-partners', jsonLd: [bc.ld],
    body: html`<section class="page-head grid-bg"><div class="wrap">${bc.html}<span class="eyebrow">Partners</span><h1 class="display">Who we work with</h1><p class="lead">Trusted local recovery operators, bodyshops and garages. If your vehicle can't be fixed at the roadside, we coordinate with them so you are not left stranded.</p></div></section>
<section class="section-tight"><div class="wrap">${partners.length ? html`<div class="grid grid-3">${partners.map((p) => html`<div class="card stack"><span class="badge">${p.kind}</span><h3>${p.name}</h3>${p.notes ? html`<p class="muted" style="margin:0">${p.notes}</p>` : ''}<div class="row">${p.phone ? html`<a class="btn btn-sm" href="tel:${normPhone(p.phone)}">${icon('phone')} Call</a>` : ''}${p.website ? html`<a class="btn btn-sm" href="${p.website}" target="_blank" rel="noopener">Website</a>` : ''}</div></div>`)}</div>` : html`<div class="card"><p class="muted" style="margin:0">Need recovery? Call us on <a class="accent" href="tel:${normPhone(shell.settings.business.phone)}">${shell.settings.business.phone}</a> and we'll put you in touch with a local operator.</p></div>`}
<div class="card spread" style="margin-top:22px"><div><h3>Become a partner</h3><p class="muted" style="margin:6px 0 0">Bodyshops, auctions and garages earn commission on referrals.</p></div><a class="btn btn-primary" href="/fleet">Get in touch</a></div></div></section>`,
  }));
});

// ───────────────────────────── Legal ─────────────────────────────
function legalPage(title: string, intro: string, sections: [string, string][]): SafeHtml {
  return html`<section class="page-head grid-bg"><div class="wrap"><span class="eyebrow">Legal</span><h1 class="display">${title}</h1><p class="lead">${intro}</p></div></section><section class="section-tight"><div class="wrap wrap-narrow prose" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${sections.map(([h, body]) => html`<h2>${h}</h2>${markdown(body)}`)}</div></section>`;
}

pageRoutes.get('/privacy', async (c) => {
  const shell = await loadShell(c);
  const b = shell.settings.business;
  return c.html(renderPage(c, shell, {
    title: 'Privacy Notice', description: `How ${b.name} collects, uses and protects your personal data.`, path: '/privacy',
    body: legalPage('Privacy notice', `${b.legalName} is the controller of the personal data described here. Questions or requests: ${b.email}.`, [
      ['What we collect', '- Contact details you give us: name, phone, email, address and postcode.\n- Vehicle details: registration, make, model and the work carried out, including diagnostic results and photos.\n- Photos you choose to upload, and a signature where you sign off a pre-work inspection.\n- Messages you send through chat, WhatsApp, SMS or email.\n- Payment records (card payments are processed by Stripe; we never see or store full card numbers).\n- With your consent only: analytics cookies about how the website is used.'],
      ['Why we use it', '- To arrange, carry out and invoice the work you book (performance of a contract).\n- To send booking confirmations, live tracking links, reminders and your reports (contract).\n- To keep a permanent service history for each vehicle and to meet accounting and tax obligations (legal obligation and legitimate interests).\n- To send MOT/service reminders and occasional offers, only if you opt in (consent — withdraw any time).\n- To prevent fraud and abuse of our systems (legitimate interests).'],
      ['Who we share it with', 'We use carefully chosen processors to run the service: Cloudflare (hosting and storage, EU/UK and global edge), Stripe (online payments), Resend (email), Twilio (SMS and WhatsApp), postcodes.io (postcode lookup) and, where enabled, DVLA (vehicle details) and Google (reviews and analytics with consent). Partner technicians see only the jobs assigned to them. We never sell your data.'],
      ['How long we keep it', 'Booking, invoice and vehicle service records are kept for 6 years to meet tax law. Chat transcripts are kept for 2 years. Analytics data follows the provider’s retention settings. Unattached uploads are deleted within 24 hours.'],
      ['Your rights', 'You can ask for a copy of your data, ask us to correct or delete it, object to or restrict processing, and withdraw consent at any time. Email us and we will respond within one month. You can also complain to the Information Commissioner’s Office (ico.org.uk).'],
      ['Security', 'Data is encrypted in transit and at rest. Staff accounts use strong passwords or passkeys, sessions can be revoked, every change is recorded in an audit trail, and nightly backups are encrypted.'],
    ]),
  }));
});

pageRoutes.get('/terms', async (c) => {
  const shell = await loadShell(c);
  const b = shell.settings.business;
  const cur = b.currency;
  return c.html(renderPage(c, shell, {
    title: 'Terms of Service', description: `Booking and service terms for ${b.name}.`, path: '/terms',
    body: legalPage('Terms of service', 'Plain-English terms for bookings with us.', [
      ['Bookings', 'Your booking is confirmed when you receive a confirmation with a reference number. Please make sure the vehicle is accessible and the keys are available at the booked time. Detailing packages need an outside tap and a 240V socket within about 25 metres unless you choose lab drop-off.'],
      ['Prices', `Package prices are fixed and shown before you book. Travel fees are calculated from your postcode and shown before you confirm. If diagnostics reveal further work, we will explain it and agree the price with you before doing it. Emergency same-day dispatch carries a ${money(shell.settings.pricing.emergencyFee, cur)} call-out fee.`],
      ['Payment', 'Payment is due on completion by card, Apple Pay, Google Pay, cash or bank transfer, unless agreed otherwise for trade accounts. An optional online deposit can secure high-value or full-day slots and is deducted from the final invoice.'],
      ['Changes & cancellations', 'You can cancel online from your tracker link up to the day before your visit at no charge. For on-the-day changes please call. Deposits for cancellations with less than 24 hours’ notice may be retained to cover lost time.'],
      ['Diagnostics & coding', 'Diagnostics identify the cause of a fault present at the time of testing; unrelated faults can develop later. Coding only enables options supported by your vehicle’s hardware; a configuration backup is taken first and changes can be reversed. Software updates carry a small inherent risk which we explain beforehand.'],
      ['Our responsibility', 'We carry public liability insurance and take care with every vehicle. Pre-existing damage is recorded on a walkaround before work starts. Nothing in these terms limits your statutory rights as a consumer.'],
    ]),
  }));
});

pageRoutes.get('/cookies', async (c) => {
  const shell = await loadShell(c);
  return c.html(renderPage(c, shell, {
    title: 'Cookie Policy', description: 'The cookies and storage this website uses.', path: '/cookies',
    body: legalPage('Cookie policy', 'We keep cookies to a minimum. Analytics cookies are only set if you accept them.', [
      ['Essential (always on)', '- **s1_cust** — keeps you signed in to your garage account (HttpOnly, secure).\n- **s1_staff** — keeps staff signed in to the admin (HttpOnly, secure).\n- Local storage for your theme choice, dismissed banners, chat conversation and cookie choice. These never leave your device.'],
      ['Analytics (only with consent)', '- Google Analytics 4 and Meta Pixel, if configured, measure which pages and features are useful. They load only after you press "Accept analytics".'],
      ['Changing your mind', 'Use the "Cookie settings" link in the footer at any time to change your choice.'],
    ]),
  }));
});

pageRoutes.get('/offline', async (c) => {
  const shell = await loadShell(c);
  return c.html(renderPage(c, shell, {
    title: 'Offline', description: 'You are offline.', path: '/offline', noindex: true, hideBanners: true,
    body: html`<section class="section"><div class="wrap wrap-narrow" style="text-align:center">${emblem('emblem')}<h1 class="display" style="margin:20px 0 10px">You're offline</h1><p class="lead" style="margin:0 auto 22px">No signal right now. Pages you have visited are still available, and you can always call us.</p><a class="btn btn-sos btn-lg" href="tel:${normPhone(shell.settings.business.phone)}">${icon('phone')} ${shell.settings.business.phone}</a></div></section>`,
  }));
});

// ───────────────────────────── Admin shell ─────────────────────────────
pageRoutes.get('/admin', async (c) => {
  const settings = await getSettings(c.env.DB);
  const nonce = c.get('nonce');
  return c.html('<!doctype html>' + html`<html lang="en-GB" data-theme="${settings.branding.themeDefault}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="robots" content="noindex, nofollow">
<title>Admin · ${settings.business.name}</title><meta name="theme-color" content="#07080b">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('admin.css')}">
<script nonce="${nonce}">try{var t=localStorage.getItem('s1-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
</head><body><div id="admin-app"><div class="boot">${emblem('emblem emblem-glow')}</div></div>
<script type="application/json" id="s1-config" nonce="${nonce}">${jsonForScript({ buildId: BUILD_ID, business: settings.business.name, turnstile: c.env.TURNSTILE_SITE_KEY ?? '' })}</script>
<script type="module" src="${asset('admin.js')}" nonce="${nonce}"></script></body></html>`.value);
});

// ───────────────────────────── Town landing pages (#46) — keep last ─────────────────────────────
pageRoutes.get('/:slug{[a-z0-9-]{2,60}}', async (c) => {
  const db = c.env.DB;
  const town = await first<{ slug: string; name: string; headline: string; intro: string; postcodes: string; areas: string; lat: number | null; lng: number | null; body: string }>(db, 'SELECT * FROM towns WHERE slug = ? AND active = 1', c.req.param('slug'));
  if (!town) return c.notFound();
  const shell = await loadShell(c);
  const loc = await getLocation(db);
  const cur = loc.currency;
  const [packages, faqs, reviews] = await Promise.all([
    getPackages(db),
    all<{ question: string; answer: string }>(db, 'SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort LIMIT 4'),
    all<{ author: string; rating: number; body: string; vehicle: string; reviewed_on: string; source: string }>(db, 'SELECT author, rating, body, vehicle, reviewed_on, source FROM reviews WHERE visible = 1 ORDER BY rating DESC, reviewed_on DESC LIMIT 3'),
  ]);
  const miles = town.lat != null && town.lng != null ? haversineMiles(loc.lat, loc.lng, town.lat, town.lng) : null;
  const travel = travelFor(miles, travelBandsOf(loc), loc.max_miles);
  const featured = packages.filter((p) => p.featured && p.category !== 'addon').slice(0, 6);
  const faq = faqBlock(faqs);
  const bc = crumbs(shell, [[`/${town.slug}`, town.name]]);
  return c.html(renderPage(c, shell, {
    title: town.headline || `Mobile Car Diagnostics in ${town.name}`, description: (town.intro || `Mobile diagnostics, coding and detailing in ${town.name}.`).slice(0, 158), path: `/${town.slug}`,
    jsonLd: [bc.ld, faq.ld, { '@context': 'https://schema.org', '@type': 'Service', name: `Mobile vehicle diagnostics & detailing in ${town.name}`, provider: { '@id': `${shell.origin}/#business` }, areaServed: { '@type': 'City', name: town.name }, serviceType: 'Mobile vehicle diagnostics, coding and detailing' }],
    body: html`<section class="hero grid-bg"><div class="wrap hero-grid">
  <div>${bc.html}<span class="eyebrow">${town.name} · ${town.postcodes}</span><h1 class="display" style="font-size:clamp(2.4rem,6vw,4.4rem)">${town.headline || `Mobile diagnostics in ${town.name}`}</h1><p class="lead">${town.intro}</p>
    <div class="hero-ctas"><a class="btn btn-primary btn-lg" href="/book">Book in ${town.name} ${icon('arrow')}</a><a class="btn btn-lg" href="tel:${normPhone(shell.settings.business.phone)}">${icon('phone')} ${shell.settings.business.phone}</a></div></div>
  <div class="card card-glass telemetry"><div class="telemetry-head"><span class="mono">${town.name.toUpperCase()} COVERAGE</span><span class="badge badge-good"><span class="dot dot-live"></span>Covered</span></div>
    <div class="readouts"><div class="readout"><small>Distance from base</small><b>${miles != null ? `${miles.toFixed(1)} mi` : '—'}</b></div><div class="readout"><small>Travel fee</small><b class="${travel.fee ? '' : 'good'}">${miles == null ? 'By postcode' : travel.fee ? money(travel.fee, cur) : 'Free'}</b></div><div class="readout" style="grid-column:1/-1"><small>Areas we visit</small><b style="font-family:var(--font-sans);font-size:.95rem;font-weight:550">${town.areas}</b></div></div></div>
</div></section>
<section class="section-tight"><div class="wrap grid grid-2" style="align-items:start"><div class="prose">${markdown(town.body)}</div><div class="stack">${postcodeChecker(cur)}${coverageMap(loc, town.lat != null ? { lat: town.lat, lng: town.lng, label: town.name } : {})}</div></div></section>
<section class="section-tight"><div class="wrap">${sectionHead(`Popular in ${town.name}`, 'Services', '', html`<a class="btn" href="/services">All services ${icon('arrow')}</a>`)}<div class="grid grid-3">${featured.map((p) => pkgCard(p, cur))}</div></div></section>
${reviews.length ? html`<section class="section-tight"><div class="wrap"><div class="grid grid-3">${reviews.map(reviewCard)}</div></div></section>` : ''}
<section class="section-tight"><div class="wrap wrap-narrow" style="margin-left:max(20px, calc((100% - 1180px)/2 + 20px))">${faq.html}</div></section>${ctaBand(shell, `Booking in ${town.name}?`)}`,
  }));
});

// ───────────────────────────── Error page ─────────────────────────────
export async function renderErrorPage(c: Ctx, status: number, message: string): Promise<string> {
  try {
    const shell = await loadShell(c);
    return renderPage(c, shell, {
      title: status === 404 ? 'Page not found' : 'Something went wrong', description: message, path: c.req.path, noindex: true, hideBanners: true,
      body: html`<section class="section grid-bg"><div class="wrap wrap-narrow" style="text-align:center"><div class="error-code">${status}</div><h1 class="display" style="font-size:2.4rem;margin:12px 0">${status === 404 ? 'Wrong turn' : 'Engine hiccup'}</h1><p class="lead" style="margin:0 auto 26px">${message}</p><div class="row" style="justify-content:center"><a class="btn btn-primary" href="/">Back to home</a><a class="btn" href="/book">Book a visit</a><a class="btn" href="tel:${normPhone(shell.settings.business.phone)}">${icon('phone')} Call us</a></div></div></section>`,
    });
  } catch {
    // Database unavailable: never show a white screen.
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07080b;color:#eef1f6;font-family:system-ui,sans-serif;text-align:center;padding:24px}a{color:#ff2e55}</style></head><body><div><h1 style="font-size:4rem;margin:0">${status}</h1><p>${message.replace(/[<>&]/g, '')}</p><p><a href="/">Return home</a></p></div></body></html>`;
  }
}
