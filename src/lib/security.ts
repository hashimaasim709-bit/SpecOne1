// Security headers, Content-Security-Policy, rate limiting, CSRF origin checks and
// Turnstile verification.
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Ctx, Env } from '../env';
import { isDev } from '../env';
import { stmt } from './db';
import type { Settings } from './settings';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 423 | 429 | 500 | 502 | 503,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const fail = (status: HttpError['status'], message: string, fields?: Record<string, string>): never => {
  throw new HttpError(status, message, fields);
};

/** Build the CSP for an HTML response. Third-party hosts are only allowed when that integration is configured. */
export function contentSecurityPolicy(nonce: string, env: Env, settings: Settings | null): string {
  const script = ["'self'", `'nonce-${nonce}'`];
  const img = ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'];
  const connect = ["'self'"];
  const frame = ['https://www.google.com', 'https://www.youtube-nocookie.com', 'https://www.instagram.com', 'https://www.tiktok.com'];
  if (env.TURNSTILE_SITE_KEY) {
    script.push('https://challenges.cloudflare.com');
    frame.push('https://challenges.cloudflare.com');
  }
  if (settings?.integrations.ga4Id) {
    script.push('https://www.googletagmanager.com');
    img.push('https://www.googletagmanager.com', 'https://*.google-analytics.com');
    connect.push('https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com');
  }
  if (settings?.integrations.metaPixelId) {
    script.push('https://connect.facebook.net');
    img.push('https://www.facebook.com');
    connect.push('https://www.facebook.com');
  }
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
  ];
  if (!isDev(env)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function baseSecurityHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self), payment=(self "https://checkout.stripe.com"), publickey-credentials-get=(self), publickey-credentials-create=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (!isDev(env)) headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  return headers;
}

/**
 * Fixed-window rate limiter backed by D1 (one upsert per limited request). Throws 429 when exceeded.
 * Cloudflare WAF rate-limiting rules can be layered on top at the zone level — see docs/DEPLOY.md.
 */
export async function rateLimit(c: Ctx, name: string, limit: number, windowSeconds: number, subject?: string): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const key = `${name}:${subject ?? c.get('ip')}`;
  const row = await stmt(
    c.env.DB,
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start
     RETURNING count`,
    key,
    window,
  ).first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    c.header('Retry-After', String(window + windowSeconds - Math.floor(Date.now() / 1000)));
    fail(429, 'Too many requests — please wait a moment and try again.');
  }
}

/**
 * CSRF defence for cookie-authenticated endpoints: state-changing requests must come from
 * our own origin. Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = c.req.header('Origin');
  const site = c.req.header('Sec-Fetch-Site');
  const host = new URL(c.req.url).host;
  const ok = origin ? safeHost(origin) === host : site ? site === 'same-origin' || site === 'none' : false;
  if (!ok) fail(403, 'Cross-site request blocked.');
  return next();
};

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}

/** Verify a Cloudflare Turnstile token. Passes automatically when Turnstile is not configured. */
export async function verifyTurnstile(c: Ctx, token: string | undefined): Promise<void> {
  if (!c.env.TURNSTILE_SECRET_KEY) return;
  if (!token) fail(400, 'Please complete the security check.');
  const body = new URLSearchParams({ secret: c.env.TURNSTILE_SECRET_KEY, response: token!, remoteip: c.get('ip') });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!data.success) fail(400, 'Security check failed — please try again.');
}

/** Sniff the real type of an upload from its magic bytes; never trust the client's Content-Type. */
export function sniffMediaType(bytes: Uint8Array): { type: string; ext: string; kind: 'image' | 'video' } | null {
  const b = bytes;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.slice(start, start + len));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return { type: 'image/png', ext: 'png', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { type: 'image/webp', ext: 'webp', kind: 'image' };
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return { type: 'image/avif', ext: 'avif', kind: 'image' };
    if (brand === 'qt  ') return { type: 'video/quicktime', ext: 'mov', kind: 'video' };
    return { type: 'video/mp4', ext: 'mp4', kind: 'video' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}
