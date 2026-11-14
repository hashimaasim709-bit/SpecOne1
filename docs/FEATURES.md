# Feature map — all 100

Where each requested feature lives, how to use it, and what (if anything) it depends on.
**Built** = works out of the box. **Built · needs key** = fully implemented, switches on when the
named provider secret is set (see `DEPLOY.md`); until then a sensible fallback runs.

## Phase 1 — Customer booking & conversion

| # | Feature | Status | Where / how |
|---|---|---|---|
| 1 | Live GPS technician tracking | Built | Technician taps **Share live location** (Admin → Today) or **On my way**; customer's `/track/…` page shows the van moving on a map with a road-adjusted ETA, refreshed every 15 s |
| 2 | SMS / WhatsApp confirmation with 1-tap tracker link | Built · needs Twilio | Sent on booking. Without Twilio: email confirmation, a "Send link to my WhatsApp" button on the success screen, and pre-written WhatsApp links for staff on every job card |
| 3 | Travel surcharge by mileage band | Built | Distance from base via postcodes.io; bands editable per location (Admin → Locations). Shown live in the quote and on town pages |
| 4 | Online deposit link | Built · needs Stripe | Optional or required-over-threshold deposit at checkout (Settings → Pricing). Staff can also send a payment link from the job card. Optional SumUp link field |
| 5 | Multi-vehicle fleet booking | Built | Up to 5 vehicles per booking (configurable), per-vehicle services, extra-vehicle discount |
| 6 | Warning-light photo upload | Built | Booking step 2; photos are resized on the phone, stored privately and appear on the job card |
| 7 | Automated Google review request | Built · needs SMS/email | Scheduled 2 h after completion (configurable) with your Google review link |
| 8 | Touchscreen signature sign-off | Built | Job card → Sign-off: walkaround notes + signature pad; signature printed on the technical report |
| 9 | Maintenance subscriptions & portal | Built | Booking a plan package starts a subscription; visits are auto-booked a week ahead; customers pause/resume/cancel in **My garage** |
| 10 | Emergency call-out surcharge | Built | "Emergency — ASAP" option in booking; fee set in Settings → Pricing |
| 11 | Apple Pay / Google Pay | Built · needs Stripe | Stripe Checkout shows Apple Pay / Google Pay automatically on supported devices |
| 12 | Before/after video | Built · needs R2 | Gallery item type "Before / after videos" or "Video clip" |
| 13 | Live slot availability badges | Built | Calendar dots and "Only 1 morning slot left" badges computed from real remaining capacity |
| 14 | Postcode address picker | Built · street list needs getAddress/Ideal Postcodes | Postcode lookup and distance work free; the street dropdown appears when a PAF key is set |
| 15 | Smart upsell recommender | Built | Rules in Admin → Smart upsells (e.g. DPF → cabin sanitisation, diagnostics → battery certificate) |

## Phase 2 — Admin CRM & business intelligence

| # | Feature | Status | Where / how |
|---|---|---|---|
| 16 | Parts & chemical cost tracker | Built | Job card → Money → Log part / chemical; linking a stock item deducts stock; per-job net profit shown |
| 17 | Revenue & profit charts | Built | Dashboard (12 weeks / 12 months) and Reports, with table view |
| 18 | Customer lifetime value | Built | Customer profile and Reports → Customer value |
| 19 | Low-stock alerts | Built · alerts need ntfy/Telegram | Daily check; dashboard "Needs attention" panel always shows them |
| 20 | Staff / partner dispatch | Built | Job card → Dispatch: assign a team member (e.g. Ali) and van; job sent by SMS or WhatsApp |
| 21 | Permanent client notes & per-plate history | Built | Customer notes; Vehicles → history follows the registration across owners |
| 22 | MOT & service reminders | Built · needs SMS/email | 11 months after MOT-flagged packages (configurable) and 4 weeks before a known MOT date |
| 23 | Labour rate calculator | Built | Job card → Money and Quick-book; rates in Settings → Pricing |
| 24 | Trade partner commission | Built | Partner codes at booking → commission accrues on completion; Reports → Partner commissions → Mark paid |
| 25 | Immutable audit trail | Built | Settings → Audit trail, filterable; database triggers reject edits and deletions |
| 26 | Biometric admin quick-lock | Built | Passkeys (Face ID / fingerprint) for sign-in and unlock; auto-lock after inactivity |
| 27 | Encrypted cloud backups | Built · needs R2 + `BACKUP_ENCRYPTION_KEY` | Nightly AES-256-GCM snapshots, 30 kept; plus D1 Time Travel |
| 28 | Multi-tier permissions | Built | Owner / Manager / Technician / Viewer roles; viewers and technicians cannot change prices or see financials |
| 29 | Phone / walk-in quick-booker | Built | Admin → Quick-book: reg lookup, services, labour, paid now → PDF invoice in seconds |
| 30 | Custom promo codes | Built | Admin → Promo codes with start/expiry dates, minimum spend and usage caps |

## Phase 3 — Technical diagnostics & engineering

| # | Feature | Status | Where / how |
|---|---|---|---|
| 31 | DTC library | Built | 55 codes seeded; public `/fault-codes` with search and detail pages; admin library search |
| 32 | Battery & alternator certificate | Built | Tech logs → Battery test → branded PDF certificate with gauges and verdict |
| 33 | DPF regeneration log book | Built | Pre/post soot %, mass, differential pressure, EGT; on the report and vehicle history |
| 34 | OEM coding matrix | Built | BMW/MINI, VAG, Ford, Land Rover, Mercedes; public `/coding` page and admin library |
| 35 | 50-point pre-purchase rubric | Built | Checklist runner with pass/advisory/fail, notes, photos and a scored PDF report |
| 36 | Wiring diagram quick lookup | Built | Pinouts seeded; add links or upload schematic images |
| 37 | Torque spec reference | Built | Seeded from your sheet; searchable on the driveway |
| 38 | Software flash tracker | Built | Version before/after, tool and result per module |
| 39 | Licence & token tracker | Built · alerts need ntfy/Telegram | 30-day expiry and low-token warnings |
| 40 | Mobile lab packing checklist | Built | Today → Pre-dispatch packing checklist |
| 41 | Digital vehicle health check | Built | VHC checklist with per-item photos; PDF to the customer's tracker |
| 42 | Freeze-frame data viewer | Built | Parameter tables per snapshot; shown on vehicle history and the report |
| 43 | CAN-bus 60 Ω guide | Built | Library → Procedures |
| 44 | Injector & IMA coding notes | Built | Library → Procedures |
| 45 | EPB & air suspension service modes | Built | Library → Procedures |

## Phase 4 — Marketing, conversion & local SEO

| # | Feature | Status | Where / how |
|---|---|---|---|
| 46 | Town landing pages | Built | `/eastbourne`, `/bexhill`, `/hastings`, `/brighton` + add more in Admin → Town pages |
| 47 | Emergency hotline banner | Built | Banner kind "Emergency"; dedicated `/emergency` page |
| 48 | Trust badge carousel | Built | Credentials marquee on the home page (edit in Settings → Business) |
| 49 | Referral codes | Built | Every customer gets a code: friends save 15 %, referrer earns points on completion |
| 50 | Seasonal promos | Built | Banners switch on automatically by month |
| 51 | Fleet / trade portals | Built | `/fleet/your-slug` with client logo, accent colour and agreed discount |
| 52 | FAQ with schema markup | Built | FAQPage structured data on home, FAQ, town and fault-code pages |
| 53 | Chat auto-replies | Built | Instant answers from live prices/coverage/hours + editable rules; quiet while staff are in the inbox |
| 54 | Social proof pop-ups | Built | Uses **genuine** recent bookings, anonymised to model and postcode district — never invented |
| 55 | Google Business Profile | Built · reviews need Places API | Reviews sync daily and display on the site; "Navigate" buttons open Google Maps |
| 56 | Instagram / TikTok portfolio | Built | Add post URLs as gallery items; they embed. A fully automatic feed needs Meta/TikTok API approval |
| 57 | Before/after video walkthroughs | Built · needs R2 | See #12 |
| 58 | Recovery partner links | Built | Partners marked "public" appear on `/recovery-partners` and the emergency page |
| 59 | Seasonal maintenance guides | Built | `/guides`, four seeded, editable |
| 60 | Floating WhatsApp button | Built | Desktop bubble; on phones it lives in the bottom action bar |

## Phase 5 — UI/UX & brand

| # | Feature | Status | Where / how |
|---|---|---|---|
| 61 | Logo uploader | Built | Settings → Branding; used in nav, PDFs and app icons |
| 62 | Before/after slider | Built | Touch-draggable, in the gallery and home page |
| 63 | Admin-controlled gallery | Built | Upload from your phone, tag, feature, hide, delete |
| 64 | Interactive vehicle stage | Built | CAD-style blueprint with tappable systems (an original luxury-SUV silhouette, not manufacturer artwork) |
| 65 | Dark / light theme | Built | Toggle in the nav; obsidian & crimson by default |
| 66 | Glassmorphism | Built | Frosted nav, cards, chat and mobile bars |
| 67 | S1 tachometer animations | Built | Animated emblem and live telemetry gauge |
| 68 | Monospace data readouts | Built | JetBrains Mono for prices, codes, dates and references |
| 69 | Silhouette switching | Built | Hatchback / Saloon / SUV / Van on the stage; body style in booking |
| 70 | High-contrast emergency buttons | Built | Yellow/black emergency styling throughout |
| 71 | Branded PDF documents | Built | Invoices, receipts, reports, certificates, inspection reports, parts requests |
| 72 | Favicon & PWA icons | Built | S1 icon set included; regenerated from your logo when uploaded |
| 73 | Smooth page transitions | Built | View transitions between pages; animated wizard steps |
| 74 | Micro-interactions | Built | Tap ripples, check-mark pops, animated progress |
| 75 | Full-screen modals | Built | Gallery lightbox, procedure viewer, drawers |

## Phase 6 — Security, PWA & infrastructure

| # | Feature | Status | Where / how |
|---|---|---|---|
| 76 | PWA install prompt | Built | Shown on the second visit (Android); "Add to Home Screen" hint on iPhone |
| 77 | Android long-press shortcuts | Built | Book, Emergency, My garage, Today's jobs |
| 78 | Offline job sheets | Built | Job sheets cached on the technician's phone; status and notes changes made offline sync when back online. (Browser storage, not an in-browser SQLite engine) |
| 79 | Google Play packaging | Built · runs on your computer | `npm run twa` (Bubblewrap) → `.aab`; asset links served automatically |
| 80 | Image compression | Built | Photos resized and re-encoded on the device before upload; file types verified server-side |
| 81 | Cookie consent | Built | Analytics load only after consent; preference changeable any time |
| 82 | SSL & security headers | Built | Cloudflare SSL; HSTS, nonce-based CSP, frame and content-type protections on every response |
| 83 | Rate limiting & bot protection | Built · Turnstile optional | Per-visitor limits on every sensitive endpoint, honeypots, Turnstile, plus WAF rule guidance |
| 84 | Secure HttpOnly sessions | Built | Random tokens, hashed at rest, revocable, SameSite cookies, origin checks |
| 85 | SQL injection protection | Built | Every query is parameterised; admin tables use a column allow-list |
| 86 | Cache busting | Built | Content-hashed assets; service worker versioned per build |
| 87 | Mobile viewport | Built | Verified with no horizontal scroll at 390 px across pages |
| 88 | Edge CDN | Built | Static assets served from Cloudflare's edge without invoking the Worker |
| 89 | Error logging & fallbacks | Built | Server and browser errors logged (Settings → System logs); branded error pages, never a white screen |
| 90 | Zero-downtime deploys | Built | GitHub Actions → `wrangler deploy` (atomic), one-command rollback |

## Phase 7 — Future-proofing & scaling

| # | Feature | Status | Where / how |
|---|---|---|---|
| 91 | Multi-currency | Built (foundation) | Currency and locale settings drive all formatting, invoices and Stripe; amounts stored in minor units |
| 92 | Multi-location readiness | Built (foundation) | Locations with their own base, bands, capacity, time zone and currency; vans per location. The public booking flow currently serves the primary location |
| 93 | Expense & tax estimator | Built | Reports → Profit & tax: tax-year ledger, expense categories, income tax + Class 4 NI estimate and year-end projection (an estimate — confirm with your accountant) |
| 94 | Loyalty points | Built | Earn per £1, redeem at checkout when signed in, adjustable by staff |
| 95 | Peak-hour pricing | Built | Rules by day and window (seeded disabled — switch on in Peak pricing) |
| 96 | Zapier / webhooks | Built | Signed (HMAC-SHA256) events with retries and a delivery log |
| 97 | Voice notes | Built | Job card → Dictate (Chrome / Safari speech recognition) |
| 98 | Parts ordering workflow | Built | Fault codes in findings → draft supplier list → email/WhatsApp + PDF, tracked to fitted |
| 99 | Feedback sentiment analysis | Built · AI needs Anthropic key | Claude summarises reviews and chats; a built-in analyser runs without a key |
| 100 | Source & data ownership | Built | `npm run export:source`, full JSON export, decryptable backups |

## From the original site — rebuilt and extended

Everything the previous site offered that wasn't in the list above, done properly.

| Original feature | Now | Where / how |
|---|---|---|
| Rate card (`/flyer`) | Built | `/rate-card` — every package with S/M/L prices, add-ons, plans, savings and travel zones; scan-to-book QR, print-ready layout, Share button and a branded **PDF** (`/rate-card.pdf`). Old `/flyer` links redirect here |
| Interactive flyers | Built | Admin → **Flyer studio**: pick a style (diagnostics, detailing, emergency, trade, seasonal), headline, selling points, featured packages, offer and promo code. Each flyer gets its own page `/flyer/name` with one-tap booking, a QR code, Share/Print, and a printable **PDF**. Views and bookings from each flyer are counted (Dashboard → Flyers & campaigns) |
| Trade portal (`/trade`) + trade sign-up | Built | `/trade`: trade price list at your trade % (Settings → Pricing, default 25%), "book at trade rates" with a trade code, multi-vehicle visits, and an online **trade account application**. Applications appear on the dashboard — **Approve** sends the trade code by text/email and activates trade pricing |
| B2B trade statement PDF | Built | Partner → **Monthly statement** for any of the last six months: every job, paid and outstanding |
| Support / help page | Built | `/contact` (also `/support`, `/help`): topic-based message form with quick-start chips, optional reg plate and preferred reply method; call, WhatsApp, email and live chat tiles; opening times and quick-help links. Messages land in the admin inbox with a phone alert |
| Estimate approval (`/approve`) | Built | Job card → Money → **Ask to approve extra work**: items and explanation are sent to the customer, who approves or declines on their tracker. Approved work is added to the invoice automatically and you get an alert |
| 24 one-click admin macros | Built | Dashboard → **One-tap controls**: test phone alert, today's run sheet (share/copy for Samsung Notes or WhatsApp), block today / tomorrow / next Sunday, reopen all days, pause/resume online booking, confirm all pending, send tomorrow's reminders, 48-hour flash sale on/off, boost/standard bundle savings, share price list & trade portal, flyer studio, back up now, export bookings, archive old chats |
| Phone push pings (ntfy) | Built · needs `NTFY_TOPIC` | Private topic set as a secret (the old hard-coded, guessable topic is gone) |
| Calendar sync & .ics | Built | Settings → Booking rules → Phone calendar sync; per-booking "Add to calendar" on the tracker |

## Website studio — change the site without code

Admin → Settings → **Website studio** (owners and managers only):

- **Accent colour** — SpecOne crimson, racing red, electric blue, workshop amber, emerald or ultra violet (contrast-checked on dark and light themes).
- **Default theme** — dark or light; visitors can still switch.
- **Hero panel** — live telemetry gauge, quick contact card, or text only; edit the headline and introduction.
- **Homepage sections** — switch any section off or move it up and down.
- **Feature switches** — emergency strip, WhatsApp button, phone action bar, install prompt, live chat, recent-booking pop-ups, seasonal banners, "Prices" and "Trade" in the menu.
- **Pause online booking** — shows your message on every page and asks customers to call or WhatsApp; staff can still book.
