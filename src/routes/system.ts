// Infrastructure routes: payment webhooks, media, PWA manifest, SEO and well-known files.
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { originOf } from '../env';
import { auditSystem } from '../lib/auth';
import { all, first } from '../lib/db';
import { fail } from '../lib/security';
import { getSettings } from '../lib/settings';
import { mediaUrl, serveMedia } from '../services/media';
import { handleStripeEvent, verifyStripeSignature } from '../services/payments';
import { deliverDue } from '../services/webhooks';

export const systemRoutes = new Hono<AppEnv>();

systemRoutes.get('/healthz', async (c) => {
  const db = await first<{ ok: number }>(c.env.DB, 'SELECT 1 AS ok').catch(() => null);
  return c.json({ ok: !!db, time: new Date().toISOString() }, db ? 200 : 503);
});

systemRoutes.post('/api/stripe/webhook', async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) fail(503, 'Stripe webhooks are not configured.');
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(payload, c.req.header('Stripe-Signature'), c.env.STRIPE_WEBHOOK_SECRET!))) fail(400, 'Invalid signature.');
  const event = JSON.parse(payload) as Parameters<typeof handleStripeEvent>[1] & { id: string };
  await handleStripeEvent(c.env, event, originOf(c));
  await auditSystem(c.env.DB, 'webhook', 'stripe', event.id, `Stripe event ${event.type}`);
  c.executionCtx.waitUntil(deliverDue(c.env.DB, 10));
  return c.json({ received: true });
});

systemRoutes.get('/media/*', async (c) => {
  const key = c.req.path.slice('/media/'.length);
  if (!/^[a-z]+\/\d{4}\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key)) return c.notFound();
  return serveMedia(c, key);
});

/** Web app manifest. Long-press shortcuts appear on the Android home-screen icon. */
systemRoutes.get('/manifest.webmanifest', async (c) => {
  const settings = await getSettings(c.env.DB);
  const ids = [settings.branding.icon192MediaId, settings.branding.icon512MediaId].filter((v): v is number => typeof v === 'number');
  const custom = ids.length ? await all<{ id: number; storage_key: string }>(c.env.DB, `SELECT id, storage_key FROM media WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const url = (id: number | null) => custom.find((m) => m.id === id)?.storage_key;
  const i192 = url(settings.branding.icon192MediaId);
  const i512 = url(settings.branding.icon512MediaId);
  const icons = [
    { src: i192 ? mediaUrl(i192) : '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: i512 ? mediaUrl(i512) : '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: i512 ? mediaUrl(i512) : '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  const shortcut = (name: string, short_name: string, url: string, icon: string) => ({ name, short_name, url, icons: [{ src: `/icons/${icon}`, sizes: '96x96', type: 'image/png' }] });
  const manifest = {
    id: '/',
    name: settings.business.name,
    short_name: settings.business.name.replace(/ Auto Labs$/i, '') || 'SpecOne',
    description: settings.branding.heroSub,
    lang: 'en-GB',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'portrait',
    background_color: '#07080b',
    theme_color: '#07080b',
    categories: ['auto', 'business', 'utilities'],
    icons,
    shortcuts: [
      shortcut('Book a visit', 'Book', '/book?source=shortcut', 'shortcut-book.png'),
      shortcut('Emergency call-out', 'Emergency', '/emergency?source=shortcut', 'shortcut-sos.png'),
      shortcut('My garage & bookings', 'My garage', '/account?source=shortcut', 'shortcut-garage.png'),
      shortcut("Today's jobs (staff)", 'Jobs', '/admin#/today', 'shortcut-jobs.png'),
    ],
    screenshots: [
      { src: '/icons/screenshot-mobile.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'Book a mobile diagnostic visit' },
    ],
  };
  return c.body(JSON.stringify(manifest), 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' });
});

// The previous site's manifest address, so phones that installed the old app pick up the new one.
systemRoutes.get('/manifest.json', (c) => c.redirect('/manifest.webmanifest', 301));

systemRoutes.get('/favicon.ico', async (c) => {
  const settings = await getSettings(c.env.DB);
  if (settings.branding.icon192MediaId) {
    const m = await first<{ storage_key: string }>(c.env.DB, 'SELECT storage_key FROM media WHERE id = ?', settings.branding.icon192MediaId);
    if (m) return c.redirect(mediaUrl(m.storage_key), 302);
  }
  return c.redirect('/icons/favicon-48.png', 302);
});

systemRoutes.get('/robots.txt', (c) => {
  const origin = originOf(c);
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /track/\nDisallow: /account\nDisallow: /docs/\nDisallow: /calendar/\n\nSitemap: ${origin}/sitemap.xml\n`, 200, { 'Cache-Control': 'public, max-age=86400' });
});

systemRoutes.get('/sitemap.xml', async (c) => {
  const origin = originOf(c);
  const db = c.env.DB;
  const [packages, towns, guides, codes] = await Promise.all([
    all<{ slug: string }>(db, "SELECT slug FROM packages WHERE active = 1 AND category <> 'addon'"),
    all<{ slug: string }>(db, 'SELECT slug FROM towns WHERE active = 1'),
    all<{ slug: string; published_on: string }>(db, 'SELECT slug, published_on FROM guides WHERE active = 1'),
    all<{ code: string }>(db, 'SELECT code FROM dtc_codes WHERE public = 1'),
  ]);
  const urls: [string, string?][] = [
    ['/'], ['/book'], ['/services'], ['/rate-card'], ['/trade'], ['/contact'], ['/mot-reminder'], ['/coverage'], ['/emergency'], ['/fault-codes'], ['/coding'], ['/gallery'], ['/reviews'], ['/faq'], ['/guides'], ['/fleet'], ['/recovery-partners'], ['/privacy'], ['/terms'],
    ...packages.map((p): [string] => [`/services/${p.slug}`]),
    ...towns.map((t): [string] => [`/${t.slug}`]),
    ...guides.map((g): [string, string] => [`/guides/${g.slug}`, g.published_on]),
    ...codes.map((d): [string] => [`/fault-codes/${d.code}`]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, mod]) => `  <url><loc>${origin}${u}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
});

/** Digital Asset Links: lets the Play Store app (Trusted Web Activity) open the site full-screen. */
systemRoutes.get('/.well-known/assetlinks.json', (c) => {
  const pkg = c.env.TWA_PACKAGE_NAME;
  const prints = (c.env.TWA_SHA256_FINGERPRINTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const body = pkg && prints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } }] : [];
  return c.json(body, 200, { 'Cache-Control': 'public, max-age=3600' });
});

systemRoutes.get('/.well-known/security.txt', async (c) => {
  const settings = await getSettings(c.env.DB);
  const expires = new Date(Date.now() + 300 * 86400000).toISOString();
  return c.text(`Contact: mailto:${settings.business.email}\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${originOf(c)}/.well-known/security.txt\n`);
});
