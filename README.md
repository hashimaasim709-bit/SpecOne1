# SpecOne Auto Labs

Booking, live tracking and business platform for a mobile vehicle diagnostics, OEM coding
and detailing laboratory — rebuilt from the ground up on Cloudflare Workers.

- **Public site** — fast server-rendered pages with an obsidian-and-crimson design system,
  interactive vehicle stage, coverage map, fault-code library, gallery, town landing pages.
- **Booking wizard** — multi-vehicle quotes, live availability, postcode travel fees,
  smart upsells, promo/referral codes, deposits with Apple Pay / Google Pay.
- **Live tracker** — the van on a map with ETA, job stages, invoice, report and feedback.
- **Customer portal** — bookings, per-vehicle history, plans, loyalty points, referrals.
- **Admin app** (installable, works offline) — dashboard and charts, job cards with
  signatures, checklists, technical logs, dispatch, payments, CRM, reports and tax,
  inventory, marketing content, team permissions, audit trail, backups.

See **[docs/FEATURES.md](docs/FEATURES.md)** for all 100 features and **[docs/DEPLOY.md](docs/DEPLOY.md)** to go live.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev            # http://localhost:8787   (admin at /admin)
npm run check          # typecheck + unit tests
npm run deploy         # check and deploy to Cloudflare (creates the database on first run)
```

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers (Hono router), static assets on the edge |
| Data | D1 (SQLite) with versioned migrations; R2 for media and backups |
| Front end | Server-rendered HTML + small Preact islands; Leaflet maps loaded on demand |
| Documents | pdf-lib (invoices, certificates, reports) |
| Auth | Hashed session tokens, PBKDF2 passwords, WebAuthn passkeys, role permissions |
| Integrations | Resend, Twilio, Stripe Checkout, DVLA, postcodes.io, getAddress/Ideal Postcodes, Google Places, ntfy/Telegram, Claude |

## Project layout

```
src/            Worker: routes, services, views, seed data
  routes/       public, track, account, auth, admin, resources, documents, system, pages
  services/     bookings, pricing config, payments, notifications, PDFs, backups, scheduler…
  views/        page shell, icons, vehicle stage
shared/         code used by both server and browser (pricing engine, formats, types)
client/         browser bundles: site widgets, booking, tracker, account, admin app, styles
migrations/     D1 schema
scripts/        build, icons, source export, backup decrypt, legacy import, Play Store packaging
test/           unit tests (vitest)
```

## Scheduled jobs

Every 10 minutes: reminders, review requests, webhook retries.
Daily 03:15 UTC: encrypted backup, subscription visits, stock and licence alerts,
MOT reminders, Google review sync, sentiment sweep, housekeeping.
