// Site-wide enhancements loaded by site.ts: the rev-bar scroll indicator, scroll-in reveal,
// the search / symptom advisor overlay and the warning-light picker.
import { api } from './lib/api';
import { $, $$, debounce, esc } from './lib/ui';

// ── Rev bar: scroll progress under the header, like a tachometer sweeping to the red line ──
const rev = $('[data-revbar]');
if (rev) {
  let ticking = false;
  const paint = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    rev.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    ticking = false;
  };
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(paint);
    }
  }, { passive: true });
  paint();
}

// ── Scroll-in reveal for content below the fold (skipped when reduced motion is preferred) ──
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  $$<HTMLElement>('main .section-head, main .grid > *, main .steps > *, main .division-head, main .cta-band, main .lights-group, main .faq > details').forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.92) return; // already on screen: never hide it
    const siblings = el.parentElement ? [...el.parentElement.children] : [];
    el.style.setProperty('--i', String(Math.min(siblings.indexOf(el), 5)));
    el.classList.add('reveal');
    io.observe(el);
  });
}

// ── Site search & symptom advisor: "/" or Ctrl/⌘+K opens it from anywhere ──
interface Hit { type: string; title: string; sub: string; href: string; meta?: string }
const search = $('[data-search]');
if (search) {
  const input = $<HTMLInputElement>('[data-search-input]', search)!;
  const results = $('[data-search-results]', search)!;
  const suggestions = results.innerHTML;
  const TYPE: Record<string, string> = { service: 'Service', code: 'Fault code', light: 'Warning light', guide: 'Guide', faq: 'FAQ', page: 'Page', link: 'Go to' };
  let active = -1;
  let seq = 0;
  let lastFocus: HTMLElement | null = null;
  const rows = () => $$<HTMLAnchorElement>('.search-hit', results);
  const mark = (i: number) => {
    const list = rows();
    active = list.length ? (i + list.length) % list.length : -1;
    list.forEach((r, j) => r.classList.toggle('is-active', j === active));
    list[active]?.scrollIntoView({ block: 'nearest' });
  };
  const run = async (q: string) => {
    const term = q.trim();
    if (term.length < 2) {
      results.innerHTML = suggestions;
      active = -1;
      return;
    }
    const mine = ++seq;
    try {
      const { hits } = await api<{ hits: Hit[] }>(`/api/public/search?q=${encodeURIComponent(term)}`);
      if (mine !== seq) return;
      results.innerHTML = hits.length
        ? hits.map((h) => `<a class="search-hit" href="${esc(h.href)}"><span class="search-type type-${esc(h.type)}">${esc(TYPE[h.type] ?? h.type)}</span><span class="search-text"><b>${esc(h.title)}</b><small>${esc(h.sub)}</small></span>${h.meta ? `<span class="search-meta mono">${esc(h.meta)}</span>` : ''}</a>`).join('')
        : `<div class="search-empty"><b>No exact match for “${esc(term)}”.</b><p>Tell us what the car is doing and a technician will point you the right way.</p><div class="row"><a class="btn btn-primary btn-sm" href="/contact?topic=warning">Ask the lab</a><a class="btn btn-sm" href="/book?symptom=${encodeURIComponent(term)}">Book a diagnostic</a></div></div>`;
      mark(hits.length ? 0 : -1);
    } catch {
      if (mine === seq) results.innerHTML = '<div class="search-empty"><b>Search is unavailable right now.</b><p>Please try again in a moment.</p></div>';
    }
  };
  const open = (q = '') => {
    lastFocus = document.activeElement as HTMLElement | null;
    search.hidden = false;
    document.body.classList.add('search-open');
    input.value = q;
    input.focus();
    if (q) void run(q);
    else results.innerHTML = suggestions;
  };
  const close = () => {
    search.hidden = true;
    document.body.classList.remove('search-open');
    lastFocus?.focus?.();
  };
  const runSoon = debounce((q: string) => void run(q), 160);
  input.addEventListener('input', () => runSoon(input.value));
  $$('[data-search-open]').forEach((b) => b.addEventListener('click', () => open()));
  search.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-search-close]')) close();
    const chip = t.closest<HTMLElement>('[data-search-q]');
    if (chip) {
      input.value = chip.dataset.searchQ ?? '';
      input.focus();
      void run(input.value);
    }
  });
  $<HTMLFormElement>('[data-search-form]', search)!.addEventListener('submit', (e) => {
    e.preventDefault();
    const go = rows()[Math.max(active, 0)];
    if (go) location.href = go.href;
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    const typing = /^(input|textarea|select)$/i.test(el?.tagName ?? '') || !!el?.isContentEditable;
    if (search.hidden) {
      if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      mark(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mark(active - 1);
    }
  });
}

// ── Warning-light guide: tap a light to show its panel ──
const lights = $('[data-lights]');
if (lights) {
  const tiles = $$<HTMLAnchorElement>('[data-light]', lights);
  const panels = $$<HTMLElement>('[data-light-panel]', lights);
  const show = (key: string, scroll: boolean) => {
    const panel = panels.find((p) => p.dataset.lightPanel === key);
    if (!panel) return;
    lights.classList.add('lights-live');
    panels.forEach((p) => (p.hidden = p !== panel));
    tiles.forEach((t) => t.setAttribute('aria-current', t.dataset.light === key ? 'true' : 'false'));
    if (scroll && matchMedia('(max-width: 900px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  tiles.forEach((t) => t.addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', `#light-${t.dataset.light}`);
    show(t.dataset.light ?? '', true);
  }));
  const fromHash = () => location.hash.replace('#light-', '');
  show(panels.some((p) => p.dataset.lightPanel === fromHash()) ? fromHash() : tiles[0]?.dataset.light ?? '', location.hash.startsWith('#light-'));
  addEventListener('hashchange', () => show(fromHash(), true));
}
