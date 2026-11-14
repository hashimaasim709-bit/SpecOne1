# Getting everything switched on

Everything below is done from your admin: **speconeautolabs.co.uk/admin → Connections** (in the
menu under *System*). Each service has the steps written out, a button to its website, a box to
paste the key, and a **Test** button. Keys are encrypted and never shown again.

Work down the list — the first two make the biggest difference.

## 1. Phone alerts — free, 2 minutes ⭐
New bookings, chats, contact messages, call-back requests and trade applications buzz your phone.
1. Install **ntfy** from the Play Store / App Store.
2. Connections → Phone alerts → **Create my private alert channel**.
3. On your phone tap **Open in the ntfy app** (or scan the QR code from a computer).
4. Tap **Send test**.

## 2. Email — free tier, 15 minutes ⭐
Confirmations, reminders, invoices, estimates, trade codes.
1. Sign up at resend.com and add your domain.
2. Copy the DNS records it shows into Cloudflare → your domain → DNS.
3. Create an API key → paste in Connections → **Send test email**.

## 3. DVLA number-plate lookup — free, a few days for approval
Fills in make, colour, fuel and MOT date when customers type their plate, and powers the free MOT
reminder page. Apply for a key with the DVLA (link in Connections), wait for the email, paste it,
test with your own plate.

## 4. Street address dropdown — small charge per lookup
After a postcode, customers pick their street address from a list. Sign up with getAddress.io
(or Ideal Postcodes), paste the key, test with your postcode. Distance and travel fees already
work without it.

## 5. Spam protection — free, 5 minutes
Cloudflare dashboard → Turnstile → add your domain → paste the two keys.

## 6. Text messages & WhatsApp — pay per message
Twilio: buy a UK number, paste the Account SID, Auth Token and number, send a test text.

## 7. When you're ready
| Service | What it adds |
|---|---|
| **Stripe** | Card, Apple Pay and Google Pay for deposits and balances on the tracker |
| **Google reviews** | Your Google rating and reviews on the site, updated daily (also add your Place ID in Settings → Business) |
| **MapTiler** | Sharper maps with road names on the coverage map and van tracker |
| **Telegram** | Alerts in Telegram as well as / instead of ntfy |
| **Claude (AI)** | Smarter summaries of reviews and chats |
| **R2 storage** | Video uploads and nightly cloud backups (Cloudflare → R2 → enable; tell your developer to switch it on) |

---

## Making the website yours (no code)

| What | Where in the admin |
|---|---|
| Logo & app icons | Settings → Branding |
| Colours, light/dark, homepage layout, switches, pause booking | Website & marketing → **Website studio** |
| Homepage photo, share image, every homepage heading and the 4 "how it works" steps | Website studio → Images / Homepage wording |
| New pages (About us, Warranty, Careers…) shown in the menu or footer | Website & marketing → **Website pages** |
| Your own privacy / terms text | Website pages → create a page with the address `privacy` or `terms` |
| Prices and services | Services & prices |
| Job photos and before/afters | Lab gallery |
| Banners and offers | Banners · Promo codes · One-tap controls → flash sale |
| Flyers with QR codes | Flyer studio |
| Town pages | Town pages |
| FAQs, guides, chat auto-replies | FAQs · Guides · Chat auto-replies |
| Fault-code library (145 codes built in) | Tech library → Fault codes → add one, or **Import list** to paste a spreadsheet |
| Opening times, phone, WhatsApp, social links | Settings → Business |
| Trade discount | Settings → Pricing |
