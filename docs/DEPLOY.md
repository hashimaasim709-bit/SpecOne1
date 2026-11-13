# Deploying SpecOne Auto Labs

The platform runs on **Cloudflare Workers** with a **D1** (SQLite) database. The free Cloudflare
plan is enough. Allow about 20 minutes the first time; after that every merge to `main` goes live
by itself.

You only need a web browser. Nothing has to be installed on your computer.

---

## Part A — Go live (browser only)

### 1. Create a Cloudflare account
Sign up free at **dash.cloudflare.com**. Then open **Workers & Pages** in the left menu (it may sit
under *Compute*). If Cloudflare asks you to choose a `workers.dev` name, pick one, e.g. `specone`.
Your site will first live at `https://specone-auto-labs.<that-name>.workers.dev`.

### 2. Make a Cloudflare API token (lets GitHub publish the site)
1. Go to **dash.cloudflare.com/profile/api-tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers** click **Use template**.
3. Under *Permissions* click **+ Add more** and choose **Account → D1 → Edit**.
4. *Account Resources*: **Include → your account**. *Zone Resources*: **Include → All zones**.
5. **Continue to summary** → **Create Token** → **Copy** the token. It is shown only once.

### 3. Copy your Account ID
In the Cloudflare dashboard, the address bar looks like `dash.cloudflare.com/`**`1a2b3c…`**`/…`.
That 32-character code is your Account ID. (It is also shown on the Workers & Pages overview.)

### 4. Give both to GitHub
GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 3 |

### 5. Publish
Merge the pull request (**Merge pull request** → **Confirm merge**). Open the **Actions** tab and wait
for the **Deploy** run to show a green tick (about 3 minutes). The first deploy creates the database
automatically, and the site fills in its full catalogue on the first visit.

### 6. Set your setup password
Cloudflare → **Workers & Pages** → **specone-auto-labs** → **Settings** → **Variables and Secrets** →
**+ Add** → type **Secret**, name `SETUP_TOKEN`, value: any long phrase you invent → **Deploy**.
It is used once, to prove you own the site.

### 7. Create your owner account
Open `https://specone-auto-labs.<your-name>.workers.dev/admin`. Enter the `SETUP_TOKEN` phrase,
your name, email and a password (10+ characters). Then in **Settings → Security** tap
**Add this device** to sign in with Face ID or fingerprint.

Next, in the admin:
- **Settings → Business**: phone, WhatsApp, email, opening windows, Google review link, social links.
- **Settings → Branding**: upload your logo (app icons are generated from it).
- **Locations**: base coordinates, travel bands and jobs per window.
- **Services & prices**: check every package price.
- **Team**: add partner technicians with the Technician role.
- **Settings → Booking rules → Phone calendar sync**: subscribe on your phone.

---

## Part B — Optional extras (any time later)

### Integrations
Each one is added the same way as `SETUP_TOKEN` in step 6 (Worker → Settings → Variables and
Secrets → Add → Secret). Until a key is added the site uses a sensible fallback and says so.

| Secret(s) | Turns on | Where to get it |
|---|---|---|
| `NTFY_TOPIC` | Instant phone alerts for new bookings, chats, payments, low stock | Install the free **ntfy** app and subscribe to a long random name nobody could guess |
| `RESEND_API_KEY`, `EMAIL_FROM` | Booking confirmations, reminders, sign-in codes, invoices by email | resend.com → verify your domain → API key. `EMAIL_FROM` e.g. `SpecOne Auto Labs <bookings@speconeautolabs.co.uk>` |
| `DVLA_API_KEY` | Real make, colour, fuel and MOT date from the registration | Apply free for the DVLA Vehicle Enquiry Service API |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Automatic SMS with tracker links, review requests, staff dispatch texts | twilio.com → buy a UK number (or alphanumeric sender) |
| `TWILIO_WHATSAPP_FROM` | Automatic WhatsApp Business messages | Twilio WhatsApp sender (after Meta approval) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Owner alerts via Telegram instead of / as well as ntfy | @BotFather |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online deposits and balances with card, **Apple Pay and Google Pay** | Stripe dashboard → Developers. Webhook endpoint: `https://YOUR-DOMAIN/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` |
| `GETADDRESS_API_KEY` **or** `IDEAL_POSTCODES_API_KEY` | Street-address dropdown after postcode entry | getaddress.io or ideal-postcodes.co.uk (postcode distance works without either) |
| `GOOGLE_PLACES_API_KEY` | Daily sync of your Google reviews onto the site | Google Cloud → Places API (New). Also set the Place ID in Admin → Settings → Business |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Invisible bot protection on booking and enquiry forms | Cloudflare dashboard → Turnstile |
| `ANTHROPIC_API_KEY` | AI-assisted sentiment summaries of reviews and chats | console.anthropic.com (a built-in analyser is used without it) |
| `BACKUP_ENCRYPTION_KEY` | Nightly encrypted backups (needs R2, below) | Any long phrase — keep a copy somewhere safe |
| `TWA_PACKAGE_NAME`, `TWA_SHA256_FINGERPRINTS` | Full-screen Google Play app | Printed by `npm run twa` |

**Admin → Settings → System** shows which integrations are switched on.

### R2 storage (videos and cloud backups)
Photos work out of the box (stored in the database). For video uploads, larger photos and nightly
encrypted backups: Cloudflare dashboard → **R2** → enable it (Cloudflare asks for a card; the free
allowance still applies). Then uncomment the `r2_buckets` block in `wrangler.jsonc` and merge.
The bucket is created automatically on the next deploy.

### Your own domain, SSL and security
1. Add `speconeautolabs.co.uk` to Cloudflare (**Add a site**) and switch the nameservers at your registrar.
2. In `wrangler.jsonc` uncomment the `routes` entry, and add `"PUBLIC_ORIGIN": "https://speconeautolabs.co.uk"`
   to `vars` so links in texts and emails use your domain. Merge. Cloudflare issues the SSL certificate automatically.
3. Recommended zone settings: **SSL/TLS → Full (strict)**, **Always Use HTTPS**, **HSTS** (the app also sends it), **Bot Fight Mode** on.
4. **Rate limiting (WAF)** — the app already limits bookings, logins, chat and uploads per visitor. For an
   extra edge layer add a rule in Security → WAF → Rate limiting rules, e.g. *URI path starts with `/api/`*
   → 120 requests per minute per IP → Block.
5. Optional: add a repository **variable** `PUBLIC_URL` (Settings → Secrets and variables → Actions →
   Variables) so every deploy is followed by an automatic health check.

### Bring over your old bookings
While signed in on the **old** site, open `/api/admin/cloud-backup` and save the JSON file. Then, on a
computer with Node.js 20+ and this repository:

```bash
npm install
npm run import:legacy -- specone-cloud-d1-backup.json legacy-import.sql
npx wrangler login
npx wrangler d1 execute DB --remote --file legacy-import.sql
```

Customers, vehicles and bookings are recreated. It is safe to run twice.

### Google Play app
The site is already an installable app (Add to Home Screen, Android long-press shortcuts, offline
page). To list it on Google Play as well, on a computer:

```bash
SITE=https://speconeautolabs.co.uk npm run twa
```

Bubblewrap asks a few questions and builds `scripts/twa/out/app-release-bundle.aab`. Set the printed
package name and SHA-256 fingerprint as the `TWA_PACKAGE_NAME` and `TWA_SHA256_FINGERPRINTS`
secrets, then upload the `.aab` in the Play Console. Keep the generated signing key safe.

---

## Updates, rollback and backups

- **Updates**: every merge to `main` is typechecked, tested and deployed. Cloudflare swaps versions
  atomically, so there is no downtime.
- **Rollback**: Cloudflare → Workers & Pages → specone-auto-labs → **Deployments** → pick an earlier
  version → **Rollback**. (Or `npx wrangler rollback`.)
- **Point-in-time restore**: D1 Time Travel restores the database to any minute in the last 30 days:
  `npx wrangler d1 time-travel restore specone --timestamp=2026-11-13T10:00:00Z`.
- **Nightly backups** (with R2 + `BACKUP_ENCRYPTION_KEY`): encrypted snapshots in R2 `backups/`, 30 kept.
  Download from Admin → Settings → Backups & data; decrypt with
  `BACKUP_ENCRYPTION_KEY=... npm run backup:decrypt -- file.json.gz.enc`.
- **Everything you own**: `npm run export:source` zips the full source; Admin → Backups downloads all data as JSON.

## Deploying from your own computer instead

```bash
npm install
npx wrangler login
npx wrangler secret put SETUP_TOKEN
npm run deploy           # typecheck + tests + deploy (creates the database on first run)
```

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run dev                 # http://localhost:8787 — /admin creates the owner without a token locally
npm run check               # typecheck + unit tests
```
