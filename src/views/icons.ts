// Inline SVG icon set (24px grid, 1.8px stroke) used by server-rendered pages.
import { raw, type SafeHtml } from '../lib/html';

const P: Record<string, string> = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z" /><path d="M9 8.5c0 3.5 2.5 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1.2-.5-2.3-1.6-2.8-2.8l.8-1-1-2z" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12.5L20 4M17 7l2.5 2.5M14.5 9.5l2 2"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3M7 12h4M9 10v4"/>',
  sparkle: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  droplet: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  filter: '<path d="M4 6h16l-6 7.5V19l-4 2v-7.5z"/>',
  car: '<path d="M4 15.5V12l2-4.5A2 2 0 0 1 7.8 6h8.4a2 2 0 0 1 1.8 1.5L20 12v3.5a1 1 0 0 1-1 1h-1"/><path d="M6 16.5H5a1 1 0 0 1-1-1M8.5 16.5h7"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="17" cy="16.5" r="1.8"/><path d="M4.5 12h15"/>',
  van: '<path d="M3 16V7.5A1.5 1.5 0 0 1 4.5 6H14v10M14 9h3.5l3.5 4v3h-1.5"/><circle cx="7" cy="17" r="1.9"/><circle cx="17" cy="17" r="1.9"/><path d="M9 17h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="12" rx="1.5"/><path d="M3.5 12.5h17M12 8.5v12M12 8.5S10.5 4 8 4.5 7.5 8.5 12 8.5zM12 8.5s1.5-4.5 4-4 .5 4-4 4z"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  building: '<path d="M4 21V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 5v16M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.2 6.8h.01"/>',
  tiktok: '<path d="M14 3.5v11a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3.5c.5 2.6 2.3 4.3 5 4.5"/>',
  facebook: '<path d="M14.5 21v-7.5H17l.5-3h-3V8.6c0-.9.4-1.6 1.6-1.6h1.5V4.3a19 19 0 0 0-2.3-.1c-2.4 0-3.8 1.4-3.8 4V10.5H9v3h2.5V21"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>',
  share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7M12 17h.01"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.2 1.2 0 0 1 0 1.7l-6.8 6.8a1.2 1.2 0 0 1-1.7 0z"/><circle cx="8" cy="8" r="1.4"/>',
};

export function icon(name: keyof typeof P | string, cls = ''): SafeHtml {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`);
}

/** The S1 tachometer emblem — animated sweep on the needle and live arc. */
export const emblem = (cls = 'emblem'): SafeHtml =>
  raw(`<svg class="${cls}" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#0b0d12" stroke="#e11d48" stroke-width="2.5"/><circle cx="32" cy="32" r="25" stroke="rgba(255,255,255,.14)" stroke-dasharray="2 3"/><path d="M15 45A21 21 0 1 1 49 45" stroke="#232836" stroke-width="4.5" stroke-linecap="round"/><path class="arc-live" d="M15 45A21 21 0 1 1 49 45" stroke="#ff2e55" stroke-width="4.5" stroke-linecap="round" pathLength="200"/><g class="needle"><line x1="32" y1="32" x2="45" y2="19" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g><circle cx="32" cy="32" r="4.6" fill="#e11d48" stroke="#fff" stroke-width="1.6"/><text x="32" y="56" fill="#f2f4f8" font-size="9" font-weight="800" text-anchor="middle" font-family="monospace" letter-spacing="1.5">S1</text></svg>`);
