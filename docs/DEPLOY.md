# Deploying SpecOne Auto Labs

The platform runs on **Cloudflare Workers** with a **D1** (SQLite) database and an **R2**
bucket for photos, videos and backups. The free Cloudflare plan is enough to start.

Allow about 20 minutes for the first deploy. Every step after that is a `git push`.

---

## 1. One-time setup on your computer

```bash
# Node.js 20 or newer, then:
npm install
npx wrangler login          # opens Cloudflare in your browser
```

## 2. Create the database and storage

Use a **new** database. The old site's database has a different shape and must not be reused
(you can import its bookings in step 7).

```bash
npx wrangler d1 create specone
npx wrangler r2 bucket create specone-media
```

`d1 create` prints a `database_id`. Open `wrangler.jsonc` and add it to the D1 entry:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "specone", "database_id": "PASTE-ID-HERE", "migrations_dir": "migrations" }
],
```

## 3. Secrets

Secrets are stored encrypted by Cloudflare and never appear in the code or the database.
Only `SETUP_TOKEN` is required; everything else switches on an optional integration.

```bash
npx wrangler secret put SETUP_TOKEN            # any long random phrase — used once to create your owner account
npx wrangler secret put BACKUP_ENCRYPTION_KEY  # recommended — encrypts nightly backups (keep a copy somewhere safe)
```

| Secret(s) | Turns on | Where to get it |
|---|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | Booking confirmations, reminders, sign-in codes, invoices by email | resend.com → verify your domain → API key. `EMAIL_FROM` e.g. `SpecOne Auto Labs <bookings@speconeautolabs.co.uk>` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS confirmations with tracker links, review requests, staff dispatch texts | twilio.com → buy a UK number (or alphanumeric sender) |
| `TWILIO_WHATSAPP_FROM` | WhatsApp Business messages | Twilio WhatsApp sender (after Meta approval) |
| `NTFY_TOPIC` (optional `NTFY_SERVER`) | Instant phone alerts for new bookings, chats, payments, low stock | Install the ntfy app, subscribe to a long random topic name |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Same alerts via Telegram | @BotFather |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online deposits and balances with card, **Apple Pay and Google Pay** | Stripe dashboard → Developers. Webhook endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` |
| `DVLA_API_KEY` | Registration auto-fill (make, year, colour, fuel, MOT expiry) | DVLA Vehicle Enquiry Service API |
| `GETADDRESS_API_KEY` **or** `IDEAL_POSTCODES_API_KEY` | Street-address dropdown after postcode entry | getaddress.io or ideal-postcodes.co.uk (postcode distance works without either) |
| `GOOGLE_PLACES_API_KEY` | Daily sync of your Google reviews onto the site | Google Cloud → Places API (New). Also set the Place ID in Admin → Settings → Business |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Invisible bot protection on booking and enquiry forms | Cloudflare dashboard → Turnstile |
| `ANTHROPIC_API_KEY` | AI-assisted sentiment summaries of reviews and chats | console.anthropic.com (a built-in analyser is used without it) |
| `TWA_PACKAGE_NAME`, `TWA_SHA256_FINGERPRINTS` | Full-screen Google Play app (see step 8) | Printed by `npm run twa` |

Set a variable (not a secret) for your public address so links in texts and emails are right:
add `"PUBLIC_ORIGIN": "https://speconeautolabs.co.uk"` to `vars` in `wrangler.jsonc`.

## 4. Deploy

```bash
npm run deploy      # typecheck + tests + database migrations + upload
```

Wrangler prints a `*.workers.dev` address. Open it — the site is live with the full catalogue.

## 5. Create your owner account

Go to `/admin`, enter the `SETUP_TOKEN` you chose, your name, email and a password.
Then in **Settings → Security** tap **Add this device** to sign in with Face ID or fingerprint.

Next, in the admin:
- **Settings → Business**: phone, WhatsApp, email, opening windows, Google review link, social links.
- **Settings → Branding**: upload your logo (app icons are generated from it).
- **Locations**: base coordinates, travel bands and jobs per window.
- **Services & prices**: check every package price.
- **Team**: add partner technicians with the Technician role.
- **Settings → Booking rules → Phone calendar sync**: subscribe on your phone.

## 6. Your domain, SSL and security

1. Add `speconeautolabs.co.uk` to Cloudflare (Websites → Add a site) and switch the nameservers at your registrar.
2. In `wrangler.jsonc` uncomment the `routes` entry and deploy again. Cloudflare issues and renews the SSL certificate automatically.
3. Recommended zone settings: **SSL/TLS → Full (strict)**, **Always Use HTTPS**, **HSTS** (the app also sends it), **Bot Fight Mode** on.
4. **Rate limiting (WAF)** — the app already limits bookings, logins, chat and uploads per visitor. For an extra edge layer add a rule in Security → WAF → Rate limiting rules, e.g. *URI path starts with `/api/`* → 120 requests per minute per IP → Block.

## 7. Bring over your old bookings (optional)

While signed in on the **old** site, open `/api/admin/cloud-backup` and save the JSON file. Then:

```bash
npm run import:legacy -- specone-cloud-d1-backup.json legacy-import.sql
npx wrangler d1 execute DB --remote --file legacy-import.sql
```

Customers, vehicles and bookings are recreated. It is safe to run twice.

## 8. Google Play app (optional)

The site is already an installable app (Add to Home Screen, Android long-press shortcuts, offline
page). To list it on Google Play as well:

```bash
SITE=https://speconeautolabs.co.uk npm run twa
```

Bubblewrap asks a few questions and builds `scripts/twa/out/app-release-bundle.aab`. Set the printed
package name and SHA-256 fingerprint as the `TWA_PACKAGE_NAME` and `TWA_SHA256_FINGERPRINTS`
secrets, deploy, then upload the `.aab` in the Play Console. Keep the generated signing key safe.

## 9. Automatic deploys from GitHub

`.github/workflows/deploy.yml` deploys every push to `main` after typechecking, testing and
migrating. In the GitHub repository → Settings → Secrets and variables → Actions add:

- `CLOUDFLARE_API_TOKEN` — Cloudflare → My Profile → API Tokens → *Edit Cloudflare Workers* template, plus D1 Edit
- `CLOUDFLARE_ACCOUNT_ID`
- Variable `PUBLIC_URL` (optional) — enables the post-deploy health check

Cloudflare swaps versions atomically, so there is no downtime. To roll back:
`npx wrangler rollback`.

## 10. Backups and recovery

- **Nightly** at 03:15 UTC an encrypted snapshot of every table goes to R2 (`backups/`), 30 kept. Download from Admin → Settings → Backups & data and decrypt locally with
  `BACKUP_ENCRYPTION_KEY=... npm run backup:decrypt -- file.json.gz.enc`.
- **Point in time**: D1 Time Travel restores the database to any minute in the last 30 days:
  `npx wrangler d1 time-travel restore specone --timestamp=2026-11-13T10:00:00Z`.
- **Everything you own**: `npm run export:source` zips the full source; Admin → Backups downloads all data as JSON.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run dev                 # http://localhost:8787 — /admin creates the owner without a token locally
npm run check               # typecheck + unit tests
```
