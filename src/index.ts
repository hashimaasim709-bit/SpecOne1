// SpecOne Auto Labs — Cloudflare Worker entry point.
import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { loadSessions } from './lib/auth';
import { randomToken } from './lib/crypto';
import { ensureDatabase, run } from './lib/db';
import { baseSecurityHeaders, contentSecurityPolicy, HttpError, sameOriginOnly } from './lib/security';
import { getSettings } from './lib/settings';
import { accountRoutes } from './routes/account';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { documentRoutes } from './routes/documents';
import { pageRoutes, renderErrorPage } from './routes/pages';
import { publicRoutes } from './routes/public';
import { resourceRoutes } from './routes/resources';
import { systemRoutes } from './routes/system';
import { trackRoutes } from './routes/track';
import { seedDatabase } from './seed';
import { runCron } from './services/scheduler';

const app = new Hono<AppEnv>();

// ── One canonical address: www.example.com → example.com (keeps sign-ins and SEO on one host) ──
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
    return c.redirect(url.toString(), 301);
  }
  await next();
});

// ── Request context ──
app.use('*', async (c, next) => {
  c.set('ip', c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'local');
  c.set('nonce', randomToken(16));
  await ensureDatabase(c.env.DB, seedDatabase);
  await next();

  // Security headers on every response; a strict, nonce-based CSP on every HTML page.
  for (const [k, v] of Object.entries(baseSecurityHeaders(c.env))) if (!c.res.headers.has(k)) c.res.headers.set(k, v);
  if ((c.res.headers.get('Content-Type') ?? '').includes('text/html')) {
    const settings = await getSettings(c.env.DB).catch(() => null);
    c.res.headers.set('Content-Security-Policy', contentSecurityPolicy(c.get('nonce'), c.env, settings));
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-cache');
  }
});
app.use('*', loadSessions);
app.use('/api/*', sameOriginOnly);

// ── Routes ──
app.route('/', systemRoutes);
app.route('/api/public', publicRoutes);
app.route('/api/track', trackRoutes);
app.route('/api/account', accountRoutes);
app.route('/api/staff/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin/r', resourceRoutes);
app.route('/', documentRoutes);
app.route('/', pageRoutes);

// ── Errors: graceful JSON for the API, a branded page for browsers — never a white screen. ──
app.onError(async (err, c) => {
  const isApi = c.req.path.startsWith('/api/');
  if (err instanceof HttpError) {
    if (isApi) return c.json({ ok: false, error: err.message, fields: err.fields }, err.status);
    return c.html(await renderErrorPage(c, err.status, err.message), err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error', c.req.method, c.req.path, err);
  c.executionCtx.waitUntil(
    run(c.env.DB, 'INSERT INTO error_logs (source, message, stack, url, user_agent) VALUES (?, ?, ?, ?, ?)', 'server', message.slice(0, 500), (err instanceof Error ? err.stack ?? '' : '').slice(0, 4000), c.req.path, (c.req.header('User-Agent') ?? '').slice(0, 250)).catch(() => undefined),
  );
  const conflict = /UNIQUE constraint failed/.test(message) ? 'That already exists — use a different value.' : /FOREIGN KEY constraint failed/.test(message) ? 'This is still in use elsewhere. Deactivate it instead of deleting.' : '';
  if (isApi) return c.json({ ok: false, error: conflict || 'Something went wrong on our side. Please try again.' }, conflict ? 409 : 500);
  return c.html(await renderErrorPage(c, 500, 'Something went wrong on our side. Please try again, or call us.'), 500);
});

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ ok: false, error: 'Not found.' }, 404);
  return c.html(await renderErrorPage(c, 404, 'We could not find that page.'), 404);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await ensureDatabase(env.DB, seedDatabase);
        const result = await runCron(env, controller.cron);
        console.log('cron', controller.cron, JSON.stringify(result));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };
