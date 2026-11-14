// Tiny DOM helpers shared by the server-rendered pages.

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};

const ICONS: Record<string, string> = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  car: '<path d="M4 15.5V12l2-4.5A2 2 0 0 1 7.8 6h8.4a2 2 0 0 1 1.8 1.5L20 12v3.5a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="17" cy="16.5" r="1.8"/><path d="M4.5 12h15"/>',
};
export const svg = (name: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

export function toast(message: string, opts: { title?: string; icon?: string; timeout?: number } = {}): void {
  let host = $('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="icon">${svg(opts.icon ?? 'check')}</span><span>${opts.title ? `<small>${esc(opts.title)}</small>` : ''}${esc(message)}</span>`;
  host.append(el);
  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 280);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, opts.timeout ?? 5000);
}

/** Material-style tap ripple on buttons and chips (#74). */
export function enableRipples(): void {
  document.addEventListener('pointerdown', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('.btn, .chip, .option, .svc, .slot, .cal-day, .pkg');
    if (!target || target.hasAttribute('disabled')) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.width = r.style.height = `${size}px`;
    r.style.left = `${e.clientX - rect.left - size / 2}px`;
    r.style.top = `${e.clientY - rect.top - size / 2}px`;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.append(r);
    setTimeout(() => r.remove(), 600);
  }, { passive: true });
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const money = (minor: number, currency = 'GBP'): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

/** Report uncaught errors to the server so problems on customers' phones are visible in the admin (#89). */
export function installErrorReporting(): void {
  let sent = 0;
  const report = (message: string, stack = '') => {
    if (sent++ > 5) return;
    fetch('/api/public/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message.slice(0, 900), stack: stack.slice(0, 5000), url: location.pathname }), credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  };
  window.addEventListener('error', (e) => report(e.message || 'Script error', e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => report(String((e.reason as Error)?.message ?? e.reason), (e.reason as Error)?.stack));
}
