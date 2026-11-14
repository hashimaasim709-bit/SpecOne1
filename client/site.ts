// Site-wide behaviour for every public page.
import { api, errorMessage, readConfig } from './lib/api';
import type * as MapLib from './lib/map';
import { $, $$, debounce, enableRipples, esc, installErrorReporting, money, store, toast } from './lib/ui';

interface SiteConfig {
  buildId: string;
  phone: string;
  whatsapp: string;
  chat: boolean;
  socialProof: boolean;
  ga4: string;
  pixel: string;
  business: string;
  turnstile?: string;
  installPrompt?: boolean;
}
const cfg = readConfig<SiteConfig>();

installErrorReporting();
enableRipples();

// ── Theme toggle (#65) ──
$$('[data-theme-toggle]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      store.set('s1-theme', next);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(apply);
    else apply();
  }),
);

// ── Mobile menu ──
const sheet = $('[data-menu]');
const setMenu = (open: boolean) => {
  sheet?.classList.toggle('is-open', open);
  sheet?.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
};
$$('[data-menu-open]').forEach((b) => b.addEventListener('click', () => setMenu(true)));
$$('[data-menu-close]').forEach((b) => b.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

// ── Promo strip: dismissible per banner ──
$$<HTMLElement>('[data-banner]').forEach((strip) => {
  const key = `s1-banner-${strip.dataset.banner}`;
  if (!store.get(key)) strip.hidden = false;
  strip.querySelector('.strip-close')?.addEventListener('click', () => {
    strip.hidden = true;
    store.set(key, '1');
  });
});

// ── Telemetry gauge needle ──
$$<SVGGElement>('[data-needle]').forEach((g) => requestAnimationFrame(() => setTimeout(() => (g.style.transform = `rotate(${g.dataset.needle}deg)`), 250)));

// ── Interactive vehicle stage (#64, #69) ──
$$('[data-stage]').forEach((stage) => {
  const selectZone = (zone: string) => {
    $$('[data-zone]', stage).forEach((h) => h.setAttribute('aria-pressed', String(h.dataset.zone === zone)));
    $$<HTMLElement>('[data-zone-panel]', stage).forEach((p) => (p.hidden = p.dataset.zonePanel !== zone));
  };
  $$('[data-body-btn]', stage).forEach((btn) =>
    btn.addEventListener('click', () => {
      const body = btn.dataset.bodyBtn!;
      $$('[data-body-btn]', stage).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      $$<SVGGElement>('[data-body]', stage).forEach((g) => (g.style.display = g.dataset.body === body ? '' : 'none'));
      const current = $('[data-zone][aria-pressed="true"]', stage)?.dataset.zone;
      if (current) selectZone(current);
    }),
  );
  stage.addEventListener('click', (e) => {
    const hot = (e.target as Element).closest<HTMLElement>('[data-zone]');
    if (hot) selectZone(hot.dataset.zone!);
  });
  stage.addEventListener('keydown', (e) => {
    const hot = (e.target as Element).closest<HTMLElement>('[data-zone]');
    if (hot && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectZone(hot.dataset.zone!);
    }
  });
  selectZone('engine');
});

// ── Before / after sliders (#62) ──
$$<HTMLElement>('[data-ba]').forEach((ba) => {
  const input = $<HTMLInputElement>('input[type=range]', ba)!;
  const set = () => ba.style.setProperty('--pos', `${input.value}%`);
  input.addEventListener('input', set);
  set();
});

// ── Gallery filter & lightbox (#63, #75) ──
const filter = $('[data-gallery-filter]');
filter?.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-tag]');
  if (!btn) return;
  $$('[data-tag]', filter).forEach((b) => b.classList.toggle('is-on', b === btn));
  const tag = btn.dataset.tag ?? '';
  $$<HTMLElement>('[data-gallery] > *').forEach((tile) => (tile.style.display = !tag || (tile.dataset.tags ?? '').includes(tag) ? '' : 'none'));
});
const lightbox = $('[data-lightbox]');
const lbContent = $('[data-lightbox-content]');
const closeLightbox = () => {
  if (!lightbox) return;
  lightbox.hidden = true;
  lbContent!.innerHTML = '';
  document.body.style.overflow = '';
};
document.addEventListener('click', (e) => {
  const item = (e.target as Element).closest<HTMLAnchorElement>('[data-lightbox-item]');
  if (!item || !lightbox) return;
  e.preventDefault();
  const caption = item.dataset.caption ? `<p class="lightbox-caption">${esc(item.dataset.caption)}</p>` : '';
  lbContent!.innerHTML = item.dataset.type === 'video' ? `<video src="${esc(item.href)}" controls autoplay playsinline></video>${caption}` : `<img src="${esc(item.href)}" alt="${esc(item.dataset.caption ?? '')}">${caption}`;
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  $<HTMLButtonElement>('[data-lightbox-close]')?.focus();
});
$('[data-lightbox-close]')?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (e) => e.target === lightbox && closeLightbox());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeLightbox());

// ── Coverage map & postcode checker (#3, #14) ──
let mapLib: typeof MapLib | null = null;
let coverageMap: import('leaflet').Map | null = null;
let pcMarker: import('leaflet').Marker | null = null;
const mapEl = $<HTMLElement>('[data-coverage-map]');
if (mapEl) {
  const init = async () => {
    mapLib = await import('./lib/map');
    const { createMap, drawZones, pinIcon, L } = mapLib;
    const base: MapLib.LatLng = [Number(mapEl.dataset.lat), Number(mapEl.dataset.lng)];
    const bands = JSON.parse(mapEl.dataset.bands ?? '[]') as { upTo: number; label: string }[];
    const extra = JSON.parse(mapEl.dataset.extra ?? '{}') as { lat?: number; lng?: number; label?: string };
    coverageMap = createMap(mapEl, base, 9);
    drawZones(coverageMap, base, bands);
    if (extra.lat != null && extra.lng != null) L.marker([extra.lat, extra.lng], { icon: pinIcon('home') }).addTo(coverageMap).bindTooltip(extra.label ?? '', { permanent: true, direction: 'top', offset: [0, -12] });
  };
  // Load the map only when it scrolls into view.
  new IntersectionObserver((entries, obs) => {
    if (entries.some((en) => en.isIntersecting)) {
      obs.disconnect();
      void init();
    }
  }, { rootMargin: '200px' }).observe(mapEl);
}
$$<HTMLFormElement>('[data-postcode-check]').forEach((form) =>
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-pc-result]', form)!;
    const pc = new FormData(form).get('pc')?.toString().trim() ?? '';
    const btn = $<HTMLButtonElement>('button', form)!;
    btn.disabled = true;
    out.innerHTML = '<div class="skeleton" style="height:56px"></div>';
    try {
      const r = await api<{ postcode: string; miles: number; fee: number; zone: string; outOfArea: boolean; town: string; lat: number; lng: number }>(`/api/public/postcode?pc=${encodeURIComponent(pc)}`);
      const cur = form.dataset.currency ?? 'GBP';
      out.innerHTML = r.outOfArea
        ? `<div class="alert alert-warn"><span><b>${esc(r.postcode)}</b> is ${r.miles} miles away — outside our standard area. Call <a href="tel:${esc(cfg.phone)}">${esc(cfg.phone)}</a> and we'll see what we can do.</span></div>`
        : `<div class="alert alert-good"><span><b>${esc(r.postcode)}${r.town ? ` · ${esc(r.town)}` : ''}</b> — ${r.miles} miles from base. ${r.fee ? `Travel fee <b>${money(r.fee, cur)}</b>` : '<b>Free call-out</b>'} (${esc(r.zone)}). <a href="/book?postcode=${encodeURIComponent(r.postcode)}">Book now →</a></span></div>`;
      if (coverageMap && mapLib) {
        pcMarker?.remove();
        pcMarker = mapLib.L.marker([r.lat, r.lng], { icon: mapLib.pinIcon('home') }).addTo(coverageMap).bindTooltip(r.postcode, { permanent: true, direction: 'top', offset: [0, -12] });
        coverageMap.flyTo([r.lat, r.lng], 11, { duration: 0.8 });
      }
      store.set('s1-postcode', r.postcode);
    } catch (err) {
      out.innerHTML = `<div class="alert alert-bad"><span>${esc(errorMessage(err))}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  }),
);

// ── Fault code search (#31) ──
$$<HTMLFormElement>('[data-dtc-search]').forEach((form) => {
  const input = $<HTMLInputElement>('input', form)!;
  const results = form.parentElement!.querySelector<HTMLElement>('[data-dtc-results]')!;
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      results.innerHTML = '';
      return;
    }
    try {
      const { results: rows } = await api<{ results: { code: string; title: string; system: string; severity: string }[] }>(`/api/public/dtc?q=${encodeURIComponent(q)}`);
      results.innerHTML = rows.length
        ? rows.map((r) => `<a class="dtc sev-${esc(r.severity)}" href="/fault-codes/${esc(r.code)}"><span class="dtc-code">${esc(r.code)}</span><span><small>${esc(r.system)}</small>${esc(r.title)}</span><span class="badge">View</span></a>`).join('')
        : `<div class="alert alert-info"><span>No match for <b>${esc(q.toUpperCase())}</b> in our library — it may be manufacturer-specific. <a href="/book?symptom=${encodeURIComponent(q.toUpperCase())}">Book a diagnosis</a> or ask in chat.</span></div>`;
    } catch {
      results.innerHTML = '';
    }
  }, 220);
  input.addEventListener('input', run);
  form.addEventListener('submit', (e) => {
    const q = input.value.trim().toUpperCase();
    if (/^[PBCU][0-9A-F]{4}$/.test(q)) {
      e.preventDefault();
      location.href = `/fault-codes/${q}`;
    }
  });
  if (input.value) run();
});

// ── Turnstile bot protection (#83), rendered only when configured ──
const turnstileIds = new Map<Element, string>();
async function loadTurnstile(): Promise<void> {
  const holders = $$('[data-turnstile]');
  if (!cfg.turnstile || !holders.length) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile'));
    document.head.append(s);
  }).catch(() => undefined);
  const ts = (window as unknown as { turnstile?: { render: (el: Element, o: Record<string, unknown>) => string } }).turnstile;
  holders.forEach((h) => ts && turnstileIds.set(h, ts.render(h, { sitekey: cfg.turnstile, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' })));
}
const turnstileToken = (form: Element): string => {
  const holder = $('[data-turnstile]', form);
  const id = holder ? turnstileIds.get(holder) : undefined;
  const ts = (window as unknown as { turnstile?: { getResponse: (id: string) => string } }).turnstile;
  return id && ts ? ts.getResponse(id) ?? '' : '';
};
void loadTurnstile();

// ── Enquiry forms (fleet / trade) ──
$$<HTMLFormElement>('[data-enquiry-form]').forEach((form) =>
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-form-result]', form)!;
    const btn = $<HTMLButtonElement>('button[type=submit]', form)!;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    btn.disabled = true;
    try {
      await api(form.dataset.endpoint ?? '/api/public/enquiry', { body: { ...data, kind: form.dataset.kind ?? 'general', turnstileToken: turnstileToken(form) } });
      form.reset();
      $$('.chip[aria-pressed="true"]', form).forEach((c) => c.setAttribute('aria-pressed', 'false'));
      out.innerHTML = `<div class="alert alert-good"><span>${esc(form.dataset.success ?? 'Thanks — we have your enquiry and will be in touch shortly.')}</span></div>`;
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      out.innerHTML = `<div class="alert alert-bad"><span>${esc(errorMessage(err))}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  }),
);

// Quick-help chips on the contact form: one tap fills the topic and starts the message.
$$<HTMLButtonElement>('[data-prefill]').forEach((chip) =>
  chip.addEventListener('click', () => {
    const form = chip.closest('form');
    if (!form) return;
    const topic = $<HTMLSelectElement>('select[name=topic]', form);
    const msg = $<HTMLTextAreaElement>('textarea[name=message]', form);
    if (topic && chip.dataset.topic) topic.value = chip.dataset.topic;
    if (msg) {
      msg.value = chip.dataset.prefill ?? '';
      msg.focus();
      msg.setSelectionRange(msg.value.length, msg.value.length);
    }
    $$('[data-prefill]', form).forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
  }),
);

// Share buttons (rate card, flyers): native share sheet, falling back to copying the link.
$$<HTMLButtonElement>('[data-share]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const url = btn.dataset.share || location.href;
    const title = btn.dataset.title || document.title;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {
      /* share sheet closed */
    }
  }),
);
$$<HTMLButtonElement>('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));

// Trade portal: unlock trade prices in the booking form with a trade code.
$$<HTMLFormElement>('[data-trade-code]').forEach((form) =>
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = String(new FormData(form).get('code') ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (code) location.href = `/book?promo=${encodeURIComponent(code)}&src=trade`;
  }),
);

// ── Live chat with instant auto-replies (#53) ──
interface ChatMsg { id: number; sender: string; author: string; body: string }
const panel = $('[data-chat-panel]');
if (panel && cfg.chat) {
  const log = $('[data-chat-log]', panel)!;
  const form = $<HTMLFormElement>('[data-chat-form]', panel)!;
  const who = $('[data-chat-who]', panel)!;
  const unread = $('[data-chat-unread]');
  let token = store.get('s1-chat') ?? '';
  let lastId = Number(store.get('s1-chat-last') ?? 0);
  let open = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (token) who.hidden = true;
  const render = (msgs: ChatMsg[], replace = false) => {
    if (replace) log.querySelectorAll('[data-msg]').forEach((n) => n.remove());
    for (const m of msgs) {
      if (log.querySelector(`[data-msg="${m.id}"]`)) continue;
      const el = document.createElement('div');
      el.className = `bubble ${m.sender}`;
      el.dataset.msg = String(m.id);
      el.innerHTML = `${m.sender === 'visitor' ? '' : `<span class="who">${esc(m.sender === 'bot' ? 'Auto-reply' : m.author)}</span>`}${esc(m.body)}`;
      log.append(el);
    }
    log.scrollTop = log.scrollHeight;
  };
  const poll = async () => {
    clearTimeout(timer);
    if (token && document.visibilityState === 'visible') {
      try {
        const { messages } = await api<{ messages: ChatMsg[] }>(`/api/public/chat/${encodeURIComponent(token)}?after=${open ? 0 : lastId}`);
        if (open) {
          render(messages, true);
          const max = messages.at(-1)?.id ?? lastId;
          lastId = max;
          store.set('s1-chat-last', String(max));
        } else if (messages.some((m) => m.sender !== 'visitor')) {
          unread && (unread.hidden = false);
        }
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          token = '';
          store.remove('s1-chat');
          who.hidden = false;
        }
      }
    }
    timer = setTimeout(poll, open ? 5000 : 30000);
  };
  const setOpen = (v: boolean) => {
    open = v;
    panel.hidden = !v;
    if (v) {
      unread && (unread.hidden = true);
      $<HTMLInputElement>('input[name=message]', panel)?.focus();
    }
    void poll();
  };
  $$('[data-chat-open]').forEach((b) => b.addEventListener('click', () => setOpen(!open)));
  $('[data-chat-close]', panel)?.addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const message = String(data.get('message') ?? '').trim();
    if (!message) return;
    const input = $<HTMLInputElement>('input[name=message]', form)!;
    input.value = '';
    render([{ id: -Date.now(), sender: 'visitor', author: '', body: message }]);
    try {
      const res = await api<{ token: string; messages: ChatMsg[] }>('/api/public/chat', { body: { token, name: data.get('name') ?? '', contact: data.get('contact') ?? '', message } });
      token = res.token;
      store.set('s1-chat', token);
      who.hidden = true;
      render(res.messages, true);
    } catch (err) {
      toast(errorMessage(err), { icon: 'alert' });
    }
  });
  if (token) void poll();
}

// ── Social proof: genuine recent bookings, anonymised (#54) ──
if (cfg.socialProof && !/^\/(book|track|account|admin|emergency)/.test(location.pathname) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const shown = Number(sessionStorage.getItem('s1-sp') ?? 0);
  if (shown < 3) {
    setTimeout(async () => {
      try {
        const { items } = await api<{ items: { vehicle: string; area: string; service: string; ago: string }[] }>('/api/public/recent');
        let i = shown;
        const next = () => {
          const it = items[i % Math.max(items.length, 1)];
          if (!it || i >= 3) return;
          toast(`${it.vehicle}${it.area ? ` in ${it.area}` : ''} booked ${it.service}`, { title: `Recent booking · ${it.ago}`, icon: 'car', timeout: 6000 });
          sessionStorage.setItem('s1-sp', String(++i));
          setTimeout(next, 28000);
        };
        next();
      } catch {
        /* ignore */
      }
    }, 9000);
  }
}

// ── Cookie consent (#81); analytics load only after opt-in ──
const consent = $('[data-consent]');
function loadAnalytics(): void {
  if (cfg.ga4) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga4)}`;
    document.head.append(s);
    const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer.push(arguments);
    };
    w.gtag('js', new Date());
    w.gtag('config', cfg.ga4, { anonymize_ip: true });
  }
  if (cfg.pixel) {
    type Fbq = ((...a: unknown[]) => void) & { queue: unknown[]; callMethod?: (...a: unknown[]) => void; loaded: boolean; version: string };
    const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };
    if (!w.fbq) {
      const fbq: Fbq = Object.assign((...a: unknown[]) => {
        if (fbq.callMethod) fbq.callMethod(...a);
        else fbq.queue.push(a);
      }, { queue: [] as unknown[], loaded: true, version: '2.0' });
      w.fbq = w._fbq = fbq;
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.append(s);
      fbq('init', cfg.pixel);
      fbq('track', 'PageView');
    }
  }
}
const choice = store.get('s1-consent');
if (choice === 'all') loadAnalytics();
else if (!choice && consent && (cfg.ga4 || cfg.pixel)) setTimeout(() => (consent.hidden = false), 1200);
$('[data-consent-accept]')?.addEventListener('click', () => {
  store.set('s1-consent', 'all');
  consent!.hidden = true;
  loadAnalytics();
});
$('[data-consent-decline]')?.addEventListener('click', () => {
  store.set('s1-consent', 'essential');
  consent!.hidden = true;
});
$('[data-consent-reopen]')?.addEventListener('click', () => {
  if (consent) consent.hidden = false;
});

// ── PWA: service worker, install prompt (#76) ──
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker?.register('/sw.js').catch(() => undefined));
}
const install = $('[data-install]');
let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
const snoozed = cfg.installPrompt === false || Number(store.get('s1-install-snooze') ?? 0) > Date.now();
const visits = Number(store.get('s1-visits') ?? 0) + 1;
store.set('s1-visits', String(visits));
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as typeof deferred;
  if (!snoozed && visits >= 2 && install) setTimeout(() => (install.hidden = false), 4000);
});
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
if (isIos && !standalone && !snoozed && visits >= 2 && install) {
  $('[data-install-text]', install)!.textContent = 'Tap the Share button, then "Add to Home Screen" to install the app.';
  ($('[data-install-accept]', install) as HTMLElement).hidden = true;
  setTimeout(() => (install.hidden = false), 5000);
}
$('[data-install-accept]')?.addEventListener('click', async () => {
  install!.hidden = true;
  if (!deferred) return;
  await deferred.prompt();
  deferred = null;
});
$('[data-install-dismiss]')?.addEventListener('click', () => {
  install!.hidden = true;
  store.set('s1-install-snooze', String(Date.now() + 14 * 86400000));
});
