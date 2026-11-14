// Page shell for every public page: head, SEO metadata, navigation, banners, footer and
// the floating widgets. Content pages pass their <main> body in.
import assetsManifest from '../generated/assets.json';
import { displayPhone, normPhone, todayIn } from '../../shared/format';
import type { Ctx } from '../env';
import { originOf } from '../env';
import { all, first, parseJson } from '../lib/db';
import { html, jsonForScript, raw, type SafeHtml } from '../lib/html';
import { getSettings, type Settings } from '../lib/settings';
import { mediaUrl } from '../services/media';
import { emblem, icon } from './icons';

const ASSETS = (assetsManifest as { buildId: string; assets: Record<string, string> }).assets;
export const asset = (name: string): string => ASSETS[name] ?? '';
export const BUILD_ID = (assetsManifest as { buildId: string }).buildId;

export interface Banner {
  id: number;
  kind: 'promo' | 'seasonal' | 'emergency' | 'notice';
  title: string;
  message: string;
  cta_label: string;
  cta_href: string;
  promo_code: string;
  months: string;
  starts_on: string | null;
  ends_on: string | null;
}

export interface Shell {
  settings: Settings;
  logoUrl: string;
  banners: Banner[];
  towns: { slug: string; name: string }[];
  /** Custom pages placed in the menu or footer from the admin. */
  pages: { slug: string; label: string; menu: boolean; footer: boolean }[];
  /** Absolute URL of the uploaded social share image, if any. */
  shareImage: string;
  heroImage: string;
  origin: string;
}

/** Banners that are active today: within their dates and, for seasonal ones, in one of their months. */
export function activeBanners(rows: Banner[], today: string, seasonal: boolean): Banner[] {
  const month = Number(today.slice(5, 7));
  return rows.filter((b) => {
    if (b.starts_on && today < b.starts_on) return false;
    if (b.ends_on && today > b.ends_on) return false;
    const months = parseJson<number[]>(b.months, []);
    if (months.length && !months.includes(month)) return false;
    if (b.kind === 'seasonal' && !seasonal) return false;
    return true;
  });
}

export async function loadShell(c: Ctx): Promise<Shell> {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const mediaKey = (id: number | null) => (id ? first<{ storage_key: string }>(db, "SELECT storage_key FROM media WHERE id = ? AND visibility = 'public'", id) : Promise.resolve(null));
  const [bannerRows, towns, logo, pageRows, share, hero] = await Promise.all([
    all<Banner>(db, 'SELECT * FROM banners WHERE active = 1 ORDER BY sort, id'),
    all<{ slug: string; name: string }>(db, 'SELECT slug, name FROM towns WHERE active = 1 ORDER BY sort, name'),
    settings.branding.logoMediaId ? first<{ storage_key: string }>(db, 'SELECT storage_key FROM media WHERE id = ?', settings.branding.logoMediaId) : null,
    all<{ slug: string; title: string; nav_label: string; show_in_menu: number; show_in_footer: number }>(db, 'SELECT slug, title, nav_label, show_in_menu, show_in_footer FROM pages WHERE active = 1 AND (show_in_menu = 1 OR show_in_footer = 1) ORDER BY sort, title').catch(() => []),
    mediaKey(settings.site.shareImageMediaId),
    mediaKey(settings.site.heroImageMediaId),
  ]);
  const origin = originOf(c);
  return {
    settings, logoUrl: logo ? mediaUrl(logo.storage_key) : '', banners: activeBanners(bannerRows, todayIn(settings.business.timezone), settings.integrations.seasonalBanners), towns, origin,
    pages: pageRows.map((p) => ({ slug: p.slug, label: p.nav_label || p.title, menu: !!p.show_in_menu, footer: !!p.show_in_footer })),
    shareImage: share ? `${origin}${mediaUrl(share.storage_key)}` : '',
    heroImage: hero ? mediaUrl(hero.storage_key) : '',
  };
}

export interface PageOptions {
  title: string;
  description: string;
  path: string;
  body: SafeHtml;
  scripts?: ('book' | 'track' | 'account')[];
  jsonLd?: Record<string, unknown>[];
  noindex?: boolean;
  bodyClass?: string;
  mobileBar?: boolean;
  hideBanners?: boolean;
  data?: Record<string, unknown>;
  image?: string;
}

/** Main navigation, shaped by the website studio switches. */
function navItems(s: Settings): [string, string][] {
  const f = s.site.features;
  return [
    ['/services', 'Services'],
    ...(f.rateCardInNav ? [['/rate-card', 'Prices'] as [string, string]] : []),
    ['/coverage', 'Coverage'],
    ['/fault-codes', 'Fault codes'],
    f.tradeInNav ? ['/trade', 'Trade'] : ['/fleet', 'Fleet'],
    ['/contact', 'Contact'],
  ];
}

export function brandMark(shell: Shell): SafeHtml {
  const name = shell.settings.business.name;
  if (shell.logoUrl) return html`<a class="brand" href="/" aria-label="${name} home"><img src="${shell.logoUrl}" alt="${name}" width="160" height="40"></a>`;
  const [first, ...rest] = name.split(' ');
  const word = first ?? 'SpecOne';
  const split = /^spec/i.test(word) ? html`${word.slice(0, 4).toUpperCase()}<span>${word.slice(4).toUpperCase()}</span>` : html`${word.toUpperCase()}`;
  return html`<a class="brand" href="/" aria-label="${name} home">${emblem('emblem emblem-glow')}<span class="brand-word"><b>${split}</b><small>${rest.join(' ').toUpperCase() || 'AUTO LABS'}</small></span></a>`;
}

function localBusinessLd(shell: Shell): Record<string, unknown> {
  const b = shell.settings.business;
  const sameAs = Object.values(b.social).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoRepair',
    '@id': `${shell.origin}/#business`,
    name: b.name,
    url: shell.origin,
    telephone: normPhone(b.phone),
    email: b.email,
    image: `${shell.origin}/icons/icon-512.png`,
    logo: shell.logoUrl ? `${shell.origin}${shell.logoUrl}` : `${shell.origin}/icons/icon-512.png`,
    priceRange: '££',
    address: { '@type': 'PostalAddress', addressLocality: b.town, addressRegion: b.region, postalCode: b.postcode, addressCountry: b.country },
    areaServed: shell.towns.map((t) => ({ '@type': 'City', name: t.name })),
    openingHoursSpecification: b.hours.map((h) => ({ '@type': 'OpeningHoursSpecification', description: h.days, opens: h.open, closes: h.close })),
    ...(sameAs.length ? { sameAs } : {}),
    ...(b.googleMapsUrl ? { hasMap: b.googleMapsUrl } : {}),
  };
}

export function renderPage(c: Ctx, shell: Shell, o: PageOptions): string {
  const s = shell.settings;
  const b = s.business;
  const nonce = c.get('nonce');
  const canonical = `${shell.origin}${o.path === '/' ? '' : o.path}`;
  const title = o.title.includes(b.name) ? o.title : `${o.title} · ${b.name}`;
  const wa = normPhone(b.whatsapp).replace('+', '');
  const f = s.site.features;
  const NAV = [...navItems(s), ...shell.pages.filter((p) => p.menu).slice(0, 2).map((p) => [`/${p.slug}`, p.label] as [string, string])];
  const emergency = o.hideBanners || !f.emergencyStrip ? null : shell.banners.find((x) => x.kind === 'emergency');
  const promo = o.hideBanners ? null : shell.banners.find((x) => x.kind === 'seasonal') ?? shell.banners.find((x) => x.kind === 'promo' || x.kind === 'notice');
  const mobileBar = o.mobileBar !== false && f.mobileBar;
  const maintenance = s.site.maintenance.on ? s.site.maintenance.message : '';
  const client = {
    buildId: BUILD_ID,
    phone: b.phone,
    whatsapp: wa,
    chat: s.integrations.chat,
    socialProof: s.integrations.socialProof,
    ga4: s.integrations.ga4Id,
    pixel: s.integrations.metaPixelId,
    business: b.name,
    turnstile: c.env.TURNSTILE_SITE_KEY ?? '',
    installPrompt: f.installPrompt,
    mapKey: c.env.MAPTILER_KEY ?? '',
    ...(o.data ?? {}),
  };
  const ld = [localBusinessLd(shell), ...(o.jsonLd ?? [])];

  return '<!doctype html>' + html`<html lang="en-GB" data-theme="${s.branding.themeDefault}" data-accent="${s.site.accent}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${o.description}">
<link rel="canonical" href="${canonical}">
${o.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta name="theme-color" content="#07080b" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#07080b">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${b.name}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${o.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${o.image ?? (shell.shareImage || `${shell.origin}/icons/og-image.png`)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/barlow-condensed-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('site.css')}">
<script nonce="${nonce}">document.documentElement.classList.add('js');try{var t=localStorage.getItem('s1-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
${ld.map((d) => html`<script type="application/ld+json" nonce="${nonce}">${jsonForScript(d)}</script>`)}
</head>
<body class="${[mobileBar ? 'has-mobile-bar' : '', o.bodyClass ?? ''].join(' ').trim()}">
<a class="sr-only" href="#main">Skip to content</a>
${maintenance ? html`<div class="strip strip-notice" role="status"><div class="wrap">${icon('info')}<span>${maintenance}</span><a href="tel:${normPhone(b.phone)}">Call ${b.phone}</a></div></div>` : ''}
${emergency ? html`<div class="strip strip-sos" role="region" aria-label="Emergency hotline"><div class="wrap"><span class="flash" aria-hidden="true"></span><span><b class="strip-title">${emergency.title}</b><b class="strip-short">Emergency?</b> <span class="strip-msg">${emergency.message}</span></span><a href="tel:${normPhone(b.phone)}">Call ${b.phone}</a></div></div>` : ''}
${promo ? html`<div class="strip strip-promo" data-banner="${promo.id}" hidden><div class="wrap"><span><b>${promo.title}</b>${promo.message ? html`<span class="strip-msg"> — ${promo.message}</span>` : ''}</span>${promo.promo_code ? html`<span class="code">${promo.promo_code}</span>` : ''}${promo.cta_href ? html`<a href="${promo.cta_href.startsWith('tel:') ? `tel:${normPhone(b.phone)}` : promo.cta_href}"><span class="strip-cta">${promo.cta_label || 'Find out more'} </span>→</a>` : ''}</div><button class="strip-close" type="button" aria-label="Dismiss">${icon('x')}</button></div>` : ''}
<header class="nav">
  <div class="wrap">
    ${brandMark(shell)}
    <nav class="nav-links" aria-label="Main">${NAV.map(([href, label]) => html`<a href="${href}"${o.path === href || o.path.startsWith(`${href}/`) ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>
    <div class="nav-actions">
      <button class="btn btn-ghost btn-icon" type="button" data-search-open aria-label="Search the site" title="Search ( / )">${icon('search')}</button>
      <button class="btn btn-ghost btn-icon theme-toggle" type="button" data-theme-toggle aria-label="Switch light or dark mode">${icon('moon', 'moon')}${icon('sun', 'sun')}</button>
      <a class="btn btn-ghost btn-sm btn-call" href="tel:${normPhone(b.phone)}">${icon('phone')}<span class="mono">${b.phone}</span></a>
      <a class="btn btn-primary btn-sm btn-book" href="/book">Book a visit</a>
      <button class="btn btn-ghost btn-icon nav-toggle" type="button" data-menu-open aria-label="Open menu">${icon('menu')}</button>
    </div>
  </div>
  <div class="revbar" aria-hidden="true"><span data-revbar></span></div>
</header>
<div class="sheet" data-menu aria-hidden="true">
  <div class="sheet-backdrop" data-menu-close></div>
  <div class="sheet-panel" role="dialog" aria-label="Menu">
    <div class="spread" style="margin-bottom:10px">${brandMark(shell)}<button class="btn btn-ghost btn-icon" type="button" data-menu-close aria-label="Close menu">${icon('x')}</button></div>
    ${[['/book', 'Book a visit'], ...NAV.filter(([href]) => href !== '/contact'), ['/gallery', 'Lab gallery'], ['/emergency', 'Emergency call-out'], ['/warning-lights', 'Warning-light guide'], ['/mot-reminder', 'Free MOT reminder'], ...(f.tradeInNav ? [] : [['/trade', 'Trade portal']]), ...(f.rateCardInNav ? [] : [['/rate-card', 'Price list']]), ['/reviews', 'Reviews'], ['/guides', 'Guides'], ['/faq', 'FAQ'], ...shell.pages.filter((p) => p.menu).slice(2).map((p) => [`/${p.slug}`, p.label]), ['/contact', 'Contact & help'], ['/account', 'My garage']].map(([href, label]) => html`<a class="sheet-link" href="${href}">${label}${icon('arrow')}</a>`)}
    <div style="margin-top:auto;display:grid;gap:10px;padding-top:16px">
      <a class="btn btn-sos btn-block" href="tel:${normPhone(b.phone)}">${icon('phone')} Call ${b.phone}</a>
      <a class="btn btn-block" href="https://wa.me/${wa}" rel="noopener" target="_blank">${icon('whatsapp')} WhatsApp us</a>
    </div>
  </div>
</div>
<main id="main">${o.body}</main>
${renderFooter(shell)}
<div class="fab-stack">
  ${s.integrations.chat ? html`<button class="fab fab-chat" type="button" data-chat-open aria-label="Live chat">${icon('chat')}<span class="unread" data-chat-unread hidden>1</span></button>` : ''}
  ${f.whatsappButton ? html`<a class="fab fab-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${b.name}, `)}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">${icon('whatsapp')}</a>` : ''}
</div>
${mobileBar ? html`<nav class="mobile-bar" aria-label="Quick actions"><a class="btn" href="tel:${normPhone(b.phone)}">${icon('phone')} Call</a><a class="btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a><a class="btn btn-primary" href="/book">Book now</a></nav>` : ''}
<div class="toast-host" aria-live="polite"></div>
<div class="consent" data-consent hidden role="dialog" aria-label="Cookie preferences">
  <b>Your privacy</b>
  <p>We use essential storage to run bookings and your account. With your permission we also use analytics cookies to understand which pages help people most. <a href="/cookies">Cookie policy</a></p>
  <div class="row"><button class="btn btn-primary btn-sm" type="button" data-consent-accept>Accept analytics</button><button class="btn btn-sm" type="button" data-consent-decline>Essential only</button></div>
</div>
<div class="install" data-install hidden role="dialog" aria-label="Install app">
  <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><img class="app-icon" src="/icons/icon-192.png" alt="" width="52" height="52"><div><b>Install the ${b.name} app</b><p data-install-text>Book, track your technician and keep every report on your home screen.</p></div></div>
  <div class="row"><button class="btn btn-primary btn-sm" type="button" data-install-accept>Install</button><button class="btn btn-sm" type="button" data-install-dismiss>Not now</button></div>
</div>
${s.integrations.chat ? html`<section class="chat-panel" data-chat-panel hidden aria-label="Live chat">
  <div class="chat-head">${emblem('emblem')}<div><b>${b.name}</b><small><span class="dot dot-live" style="display:inline-block;margin-right:6px"></span>Usually replies within the hour</small></div><button class="btn btn-ghost btn-icon" style="margin-left:auto;color:#fff" type="button" data-chat-close aria-label="Close chat">${icon('x')}</button></div>
  <div class="chat-log" data-chat-log><div class="bubble bot"><span class="who">${b.name}</span>Hi! Ask about prices, coverage, fault codes or availability — you'll get an instant answer, and a technician will follow up.</div></div>
  <form class="chat-form" data-chat-form>
    <div class="form-grid" data-chat-who><input class="input" name="name" placeholder="Your name" autocomplete="name" maxlength="80"><input class="input" name="contact" placeholder="Mobile or email" autocomplete="tel" maxlength="120"></div>
    <div class="input-group"><input class="input" name="message" placeholder="Type your message…" required maxlength="1500" autocomplete="off"><button class="btn btn-primary btn-icon" type="submit" aria-label="Send">${icon('arrow')}</button></div>
  </form>
</section>` : ''}
<div class="search" data-search hidden role="dialog" aria-modal="true" aria-label="Search">
  <div class="search-backdrop" data-search-close></div>
  <div class="search-panel">
    <form class="search-bar" data-search-form role="search" action="/fault-codes">${icon('search')}<input class="search-input" type="search" name="q" placeholder="Describe a fault or search…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80" aria-label="Search the site" data-search-input><button class="btn btn-ghost btn-sm" type="button" data-search-close>Close</button></form>
    <div class="search-results" data-search-results aria-live="polite">
      <div class="search-suggest">
        <span class="search-label">Try</span>
        <div class="chip-row">${['Engine light on', 'Limp mode', 'DPF warning', 'Activate CarPlay', 'Battery keeps going flat', 'Spare key', 'Prices', 'Track my booking'].map((q) => html`<button class="chip" type="button" data-search-q="${q}">${q}</button>`)}</div>
        <span class="search-label">Quick links</span>
        <div class="search-links"><a href="/book">${icon('calendar')} Book a visit</a><a href="/warning-lights">${icon('alert')} Warning-light guide</a><a href="/fault-codes">${icon('search')} Fault-code library</a><a href="/rate-card">${icon('tag')} Price list</a><a href="/contact">${icon('mail')} Contact &amp; help</a><a href="/account">${icon('user')} My garage</a></div>
      </div>
    </div>
    <div class="search-foot"><span>${emblem('emblem')} Ask the lab — services, fault codes, warning lights and guides</span><span class="search-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</span></div>
  </div>
</div>
<div class="lightbox" data-lightbox hidden role="dialog" aria-modal="true" aria-label="Image viewer"><button class="btn btn-icon lightbox-close" type="button" data-lightbox-close aria-label="Close">${icon('x')}</button><div class="lightbox-inner" data-lightbox-content></div></div>
<script type="application/json" id="s1-config" nonce="${nonce}">${jsonForScript(client)}</script>
<script type="module" src="${asset('site.js')}" nonce="${nonce}"></script>
${(o.scripts ?? []).map((name) => html`<script type="module" src="${asset(`${name}.js`)}" nonce="${nonce}"></script>`)}
</body>
</html>`.value;
}

function renderFooter(shell: Shell): SafeHtml {
  const b = shell.settings.business;
  const social = b.social;
  const year = new Date().getUTCFullYear();
  const tag = shell.settings.branding.heroHeadline;
  const cut = tag.indexOf('. ');
  return html`<footer class="footer">
  <div class="wrap footer-brandline">
    <p class="display">${cut > 0 ? html`${tag.slice(0, cut + 1)} <span class="accent">${tag.slice(cut + 2)}</span>` : tag}</p>
    <div class="row"><span class="spec-stripe" aria-hidden="true"><i></i><i></i><i></i></span><a class="btn btn-primary" href="/book">Book a visit ${icon('arrow')}</a><a class="btn" href="/contact">Ask a question</a></div>
  </div>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        ${brandMark(shell)}
        <p class="muted" style="margin-top:16px;max-width:36ch">${shell.settings.branding.heroSub}</p>
        <div class="socials">
          ${social.instagram ? html`<a href="${social.instagram}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>` : ''}
          ${social.tiktok ? html`<a href="${social.tiktok}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>` : ''}
          ${social.facebook ? html`<a href="${social.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>` : ''}
          ${social.youtube ? html`<a href="${social.youtube}" target="_blank" rel="noopener" aria-label="YouTube">${icon('youtube')}</a>` : ''}
          ${b.googleReviewUrl ? html`<a href="${b.googleReviewUrl}" target="_blank" rel="noopener" aria-label="Google reviews">${icon('star')}</a>` : ''}
        </div>
      </div>
      <div>
        <h4>Services</h4>
        <ul><li><a href="/services#diagnostics">Diagnostics &amp; coding</a></li><li><a href="/services#detailing">Detailing &amp; ceramic</a></li><li><a href="/services#plans">Maintenance plans</a></li><li><a href="/rate-card">Full price list</a></li><li><a href="/trade">Trade portal</a></li><li><a href="/fleet">Fleet accounts</a></li><li><a href="/emergency">Emergency call-out</a></li><li><a href="/coding">Coding matrix</a></li><li><a href="/fault-codes">Fault code library</a></li><li><a href="/warning-lights">Warning-light guide</a></li><li><a href="/guides">Guides &amp; how-tos</a></li></ul>
      </div>
      <div>
        <h4>Areas</h4>
        <ul>${shell.towns.map((t) => html`<li><a href="/${t.slug}">${t.name}</a></li>`)}<li><a href="/coverage">Check your postcode</a></li></ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="tel:${normPhone(b.phone)}" class="mono">${displayPhone(b.phone)}</a></li>
          <li><a href="mailto:${b.email}">${b.email}</a></li>
          ${b.hours.map((h) => html`<li class="muted">${h.days}<br><span class="mono">${h.open}–${h.close}</span></li>`)}
          <li><a href="/contact">Contact &amp; help</a></li>
          <li><a href="/mot-reminder">Free MOT reminder</a></li>
          <li><a href="/account">My garage &amp; reports</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} ${b.legalName}. ${b.credentials.slice(0, 2).join(' · ')}</span>
      <span class="row" style="gap:16px">${shell.pages.filter((p) => p.footer && !['privacy', 'terms', 'cookies'].includes(p.slug)).map((p) => html`<a href="/${p.slug}">${p.label}</a>`)}<a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookies</a><button type="button" data-consent-reopen style="background:none;border:0;color:inherit;padding:0;font:inherit">Cookie settings</button><a href="/recovery-partners">Recovery partners</a><a href="/admin" rel="nofollow">Staff</a></span>
    </div>
  </div>
  <div class="footer-wordmark" aria-hidden="true">${(b.name.split(' ')[0] ?? 'SpecOne').toUpperCase()}</div>
</footer>`;
}

/** Breadcrumbs with BreadcrumbList structured data. */
export function crumbs(shell: Shell, items: [string, string][]): { html: SafeHtml; ld: Record<string, unknown> } {
  const all_: [string, string][] = [['/', 'Home'], ...items];
  return {
    html: html`<nav class="crumbs" aria-label="Breadcrumb">${all_.map(([href, label], i) => (i < all_.length - 1 ? html`<a href="${href}">${label}</a><span>/</span>` : html`<span aria-current="page">${label}</span>`))}</nav>`,
    ld: { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: all_.map(([href, label], i) => ({ '@type': 'ListItem', position: i + 1, name: label, item: `${shell.origin}${href}` })) },
  };
}
