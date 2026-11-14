# Deploying SpecOne Auto Labs

The platform runs on **Cloudflare Workers** with a **D1** (SQLite) database, on your domain
**speconeautolabs.co.uk**. The free Cloudflare plan is enough. Allow about 20 minutes the first
time; after that every merge to `main` goes live by itself.

You only need a web browser. Nothing has to be installed on your computer.

**Replacing the previous site:** the first deploy moves speconeautolabs.co.uk (and www) from the
previous Worker to this one automatically. The previous Worker and its database are left untouched,
so its bookings can be copied across (step 8) and you can switch back at any time (see the end of
Part A).

---

## Part A — Go live (browser only)

### 1. Cloudflare account
Use the Cloudflare account that already holds **speconeautolabs.co.uk**. (Starting fresh? Sign up at
dash.cloudflare.com and add the domain with **Add a site** first.)

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
for the **Deploy** run to show a green tick (about 3 minutes). This:
- creates the new database (`specone-platform-v2`; the site fills in its catalogue on the first visit),
- publishes the new Worker `specone-auto-labs`,
- points speconeautolabs.co.uk and www.speconeautolabs.co.uk at it (SSL is automatic; www redirects
  to the main address).

Returning visitors' phones swap the old installed app for the new one automatically.

### 6. Set your setup password
Cloudflare → **Workers & Pages** → **specone-auto-labs** → **Settings** → **Variables and Secrets** →
**+ Add** → type **Secret**, name `SETUP_TOKEN`, value: any long phrase you invent → **Deploy**.
It is used once, to prove you own the site.

### 7. Create your owner account
Open **https://speconeautolabs.co.uk/admin**. Enter the `SETUP_TOKEN` phrase, your name, email and a
password (10+ characters). Then in **Settings → Security** tap **Add this device** to sign in with
Face ID or fingerprint.

Next, in the admin:
- **Settings → Business**: phone, WhatsApp, email, opening windows, Google review link, social links.
- **Settings → Branding**: upload your logo (app icons are generated from it).
- **Locations**: base coordinates, travel bands and jobs per window.
- **Services & prices**: check every package price.
- **Team**: add partner technicians with the Technician role.
- **Settings → Booking rules → Phone calendar sync**: subscribe on your phone.

### 8. Bring over the previous site's bookings
GitHub → **Actions** → **Import old bookings** (left-hand list) → **Run workflow** → leave the box
as `auto` → **Run workflow**. When it shows a green tick, the summary says how many old bookings are
now in the new site; they appear in Admin → Bookings and Customers.

`auto` finds the previous site's database by itself. If it can't (it says why), type the database's
name from Cloudflare → **Storage & Databases** → **D1** instead. The old database is only read, and
running the import again never creates duplicates. No customer details are printed in the logs.

### If the old site still appears
Wait five minutes and refresh. If it is still there, Cloudflare → **Workers & Pages** → the *old*
Worker → **Settings** → **Domains & Routes** → delete any entry for speconeautolabs.co.uk, then
GitHub → **Actions** → **Deploy** → **Run workflow**.

### Switching back to the previous site
Cloudflare → **Workers & Pages** → the old Worker → **Settings** → **Domains & Routes** → **+ Add** →
**Custom domain** → `speconeautolabs.co.uk`. Once you are happy with the new site and the old bookings
are imported, you can delete the old Worker.

---

## Part B — Optional extras (any time later)

### Integrations
**Easiest:** Admin → **Connections** — paste each key and press Test (see `docs/SETUP.md`).
Alternatively add them the same way as `SETUP_TOKEN` in step 6 (Worker → Settings → Variables and
Secrets → Add → Secret); a Cloudflare secret takes priority over a key saved in the admin.
Until a key is added the site uses a sensible fallback and says so.

| Secret(s) | Turns on | Where to get it |
|---|---|---|
| `NTFY_TOPIC` | Instant phone alerts for new bookings, chats, payments, low stock | Install the free **ntfy** app and subscribe to a long random name nobody could guess |
| `RESEND_API_KEY`, `EMAIL_FROM` | Booking confirmations, reminders, sign-in codes, invoices by email | resend.com → verify your domain → API key. `EMAIL_FROM` e.g. `SpecOne Auto Labs <bookings@speconeautolabs.co.uk>` |
| `DVLA_API_KEY` | Real make, colour, fuel and MOT date from the registration | Apply free for the DVLA Vehicle Enquiry Service API |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Automatic SMS with tracker links, review requests, staff dispatch texts | twilio.com → buy a UK number (or alphanumeric sender) |
| `TWILIO_WHATSAPP_FROM` | Automatic WhatsApp Business messages | Twilio WhatsApp sender (after Meta approval) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Owner alerts via Telegram instead of / as well as ntfy | @BotFather |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online deposits and balances with card, **Apple Pay and Google Pay** | Stripe dashboard → Developers. Webhook endpoint: `https://speconeautolabs.co.uk/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` |
| `GETADDRESS_API_KEY` **or** `IDEAL_POSTCODES_API_KEY` | Street-address dropdown after postcode entry | getaddress.io or ideal-postcodes.co.uk (postcode distance works without either) |
| `GOOGLE_PLACES_API_KEY` | Daily sync of your Google reviews onto the site | Google Cloud → Places API (New). Also set the Place ID in Admin → Settings → Business |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Invisible bot protection on booking and enquiry forms | Cloudflare dashboard → Turnstile |
| `ANTHROPIC_API_KEY` | AI-assisted sentiment summaries of reviews and chats | console.anthropic.com (a built-in analyser is used without it) |
| `BACKUP_ENCRYPTION_KEY` | Nightly encrypted backups (needs R2, below) | Any long phrase — keep a copy somewhere safe |
| `TWA_PACKAGE_NAME`, `TWA_SHA256_FINGERPRINTS` | Full-screen Google Play app | Printed by `npm run twa` |

If the previous Worker had secrets you want to keep (for example `RESEND_API_KEY` or `NTFY_TOPIC`),
add them to `specone-auto-labs` too — secrets are stored per Worker. **Admin → Settings → System**
shows which integrations are switched on.

### R2 storage (videos and cloud backups)
Photos work out of the box (stored in the database). For video uploads, larger photos and nightly
encrypted backups: Cloudflare dashboard → **R2** → enable it (Cloudflare asks for a card; the free
allowance still applies). Then uncomment the `r2_buckets` block in `wrangler.jsonc` and merge.
The bucket is created automatically on the next deploy.

### Security settings for the domain
- Recommended zone settings: **SSL/TLS → Full (strict)**, **Always Use HTTPS**, **HSTS** (the app also
  sends it), **Bot Fight Mode** on.
- **Rate limiting (WAF)** — the app already limits bookings, logins, chat and uploads per visitor. For an
  extra edge layer add a rule in Security → WAF → Rate limiting rules, e.g. *URI path starts with `/api/`*
  → 120 requests per minute per IP → Block.
- Optional: add a repository **variable** `PUBLIC_URL` = `https://speconeautolabs.co.uk` (Settings →
  Secrets and variables → Actions → Variables) so every deploy is followed by an automatic health check.

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
  `npx wrangler d1 time-travel restore specone-platform-v2 --timestamp=2026-11-13T10:00:00Z`.
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
npm run import:legacy -- --d1 auto legacy-import.sql && npx wrangler d1 execute DB --remote --file legacy-import.sql
```

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run dev                 # http://localhost:8787 — /admin creates the owner without a token locally
npm run check               # typecheck + unit tests
```
