// Help centre: step-by-step tutorials for every job in the admin, and the getting-started
// checklist shown on the dashboard until setup is complete.
import { useEffect, useState } from 'preact/hooks';
import { get, send } from '../api';
import { go, type Me } from '../main';
import { Icon, PageTitle, useAction } from '../ui';

interface Tutorial { id: string; cat: string; title: string; time: string; steps: string[]; go?: [string, string]; tip?: string; routes?: string[] }

const CATS = ['Getting started', 'Bookings & jobs', 'Customers & trade', 'Money', 'Website & marketing', 'Workshop', 'Team & safety'];

export const TUTORIALS: Tutorial[] = [
  // ── Getting started ──
  { id: 'alerts', cat: 'Getting started', title: 'Get booking alerts on your phone', time: '2 min', routes: ['connections'], go: ['Open Connections', 'connections'],
    steps: ['Install the free “ntfy” app from the Play Store or App Store.', 'Open Connections and find “Phone alerts”.', 'Tap “Create my private alert channel”.', 'On your phone tap “Open in the ntfy app” (or scan the QR code if you are on a computer).', 'Tap “Send test” — your phone should buzz within a few seconds.'],
    tip: 'Keep the channel name private. Anyone who knows it could read your alerts.' },
  { id: 'logo', cat: 'Getting started', title: 'Upload your logo', time: '1 min', routes: ['settings'], go: ['Open Branding', 'settings/branding'],
    steps: ['Open Settings → Branding.', 'Tap “Upload logo” and choose your logo image (PNG with a transparent background looks best).', 'The logo appears in the website header, on invoices and reports, and as the app icon.'] },
  { id: 'business', cat: 'Getting started', title: 'Set your phone number, hours and links', time: '3 min', go: ['Open Business settings', 'settings/business'],
    steps: ['Open Settings → Business.', 'Check your phone, WhatsApp number and email.', 'Set the opening hours shown on the website.', 'Tick which windows (morning, afternoon, evening) you work on each day — this controls what customers can book.', 'Paste your Google review link and social links, then Save.'] },
  { id: 'face-id', cat: 'Getting started', title: 'Sign in with Face ID or fingerprint', time: '1 min', go: ['Open Security', 'settings/security'],
    steps: ['On the phone you use every day, open Settings → Security.', 'Tap “Add this device”.', 'Approve with your face or fingerprint.', 'Next time, tap “Sign in with Face ID / fingerprint” — no password needed.'],
    tip: 'Add each device once: your phone, your tablet, your laptop.' },
  { id: 'prices', cat: 'Getting started', title: 'Check and change your prices', time: '5 min', routes: ['r/packages'], go: ['Open Services & prices', 'r/packages'],
    steps: ['Open Services & prices.', 'Tap a service to open it.', 'Change the Small, Medium and Large prices (use the same price in all three for diagnostics).', 'Tap Save — the website, price list and booking form update straight away.'],
    tip: 'Switch “Active” off to hide a service without deleting it.' },
  { id: 'install', cat: 'Getting started', title: 'Put the admin on your home screen', time: '1 min',
    steps: ['Open the admin in Chrome (Android) or Safari (iPhone).', 'Android: tap the ⋮ menu → “Add to Home screen” or “Install app”.', 'iPhone: tap the Share button → “Add to Home Screen”.', 'Open it from the icon — it runs full screen like an app and remembers today’s jobs offline.'] },

  // ── Bookings & jobs ──
  { id: 'quick-book', cat: 'Bookings & jobs', title: 'Book a customer who phones or walks in', time: '1 min', routes: ['quick'], go: ['Open Quick-book', 'quick'],
    steps: ['Tap Quick-book.', 'Type the registration and tap Look up.', 'Pick the services (add labour or a part if needed).', 'Enter the customer’s name and mobile.', 'Choose the day and window, or tick “Paid now” for a walk-in.', 'Tap Create booking — the customer gets their confirmation and tracker link.'] },
  { id: 'run-job', cat: 'Bookings & jobs', title: 'Run a job from start to finish', time: '3 min', routes: ['today', 'bookings'], go: ['Open Today’s jobs', 'today'],
    steps: ['Open Today’s jobs. Tap “On my way” — the customer’s tracker shows your van and arrival time.', 'Tap “Arrived” when you get there.', 'Tap “Walkaround & sign”: note any existing damage and get the customer’s signature.', 'Do the work. Type or dictate your findings on the job card.', 'Add any tech logs (DPF, battery test, software versions) under “Tech logs”.', 'Under Money, tap “Record payment” when the customer pays.', 'Tap “Complete job” — the invoice and report are ready on their tracker, and a review request is sent later.'] },
  { id: 'estimate', cat: 'Bookings & jobs', title: 'Ask a customer to approve extra work', time: '1 min', routes: ['bookings'],
    steps: ['Open the job and tap the Money tab.', 'Tap “Ask to approve extra work”.', 'Say what you found and why it matters.', 'Add each item with its price.', 'Tap “Send for approval” — the customer gets a link.', 'When they approve, the items are added to the invoice automatically and you get an alert.'],
    tip: 'Never start extra work until it shows as Approved.' },
  { id: 'block-day', cat: 'Bookings & jobs', title: 'Take a day off or pause bookings', time: '30 sec', routes: ['dashboard', 'calendar'], go: ['Open the dashboard', 'dashboard'],
    steps: ['On the dashboard find “One-tap controls”.', 'Tap “Block today”, “Block tomorrow” or “Block next Sunday”.', 'For other dates: Catalogue → Blocked dates → Add.', 'To stop all online booking for a while, tap “Pause online booking”. Tap “Resume” to reopen.'],
    tip: 'Blocking a day never cancels existing bookings — it only stops new ones.' },
  { id: 'reschedule', cat: 'Bookings & jobs', title: 'Move or cancel a booking', time: '1 min', routes: ['bookings'], go: ['Open Bookings', 'bookings'],
    steps: ['Open the booking.', 'In the Dispatch box find “Move booking”, pick the new date and window, and tap “Move booking”.', 'Their tracker updates straight away — send a quick WhatsApp from the job card so they know.', 'To cancel, tap “Cancel booking” and give a short reason.', 'Customers can also move their own booking from their tracker with “Change date or time”.'] },
  { id: 'run-sheet', cat: 'Bookings & jobs', title: 'Share today’s run sheet', time: '30 sec', go: ['Open the dashboard', 'dashboard'],
    steps: ['On the dashboard tap “Today’s run sheet” in One-tap controls.', 'Choose where to share it — Samsung Notes, WhatsApp, a message — or it is copied for you to paste.', 'It lists each job in order with the customer, vehicle, address and what to collect.'] },

  // ── Customers & trade ──
  { id: 'inbox', cat: 'Customers & trade', title: 'Reply to chats and contact messages', time: '1 min', routes: ['inbox'], go: ['Open Inbox', 'inbox'],
    steps: ['Open Inbox — a red number shows unread conversations.', 'Tap a conversation to read it. Contact forms, call-back requests and trade applications arrive here too.', 'Type your reply and tap Send. The customer sees it in the website chat.', 'For a call-back request, tap the phone number to ring them.'] },
  { id: 'trade-approve', cat: 'Customers & trade', title: 'Approve a trade account', time: '30 sec', routes: ['r/partners'], go: ['Open the dashboard', 'dashboard'],
    steps: ['New applications appear at the top of the dashboard under “Trade applications”.', 'Check the business details.', 'Tap “Approve” — their trade code is sent by text and email, and trade prices switch on for them.', 'Change the discount for one account under Customers → Trade partners.'],
    tip: 'The standard trade discount is set in Settings → Pricing.' },
  { id: 'statement', cat: 'Customers & trade', title: 'Send a trade customer their monthly statement', time: '1 min', go: ['Open Trade partners', 'r/partners'],
    steps: ['Open Customers → Trade partners and tap the business.', 'Under “Monthly statement” tap the month.', 'The PDF opens — share or download it.', 'Trade customers can also download their own statements from My garage.'] },
  { id: 'customer-history', cat: 'Customers & trade', title: 'Look up a customer or a car’s history', time: '30 sec', routes: ['customers', 'vehicles', 'r/customers', 'r/vehicles'], go: ['Open Customers', 'r/customers'],
    steps: ['Type a name, phone number, booking reference or registration into the search bar at the top.', 'Tap the result.', 'A customer page shows every booking, their vehicles, loyalty points and notes.', 'A vehicle page shows every job on that registration — even under previous owners.'] },

  // ── Money ──
  { id: 'payment', cat: 'Money', title: 'Record a payment or send a pay link', time: '30 sec', routes: ['bookings'],
    steps: ['Open the job → Money tab.', 'Tap “Record payment”, choose cash, card or bank transfer, and Save.', 'With Stripe connected, tap “Payment link” and the customer pays by card, Apple Pay or Google Pay on their tracker.', 'Tap “PDF” for the invoice or receipt.'] },
  { id: 'expenses', cat: 'Money', title: 'Log parts and costs to see real profit', time: '1 min', routes: ['r/expenses', 'reports'], go: ['Open Expenses', 'r/expenses'],
    steps: ['On a job: Money tab → “Log part / chemical”. Linking a stock item reduces your stock count.', 'For general costs (fuel, insurance, tools): Money & stock → Expenses → Add.', 'Open Reports & tax to see revenue, costs, profit and a tax estimate for the year.'],
    tip: 'The tax figure is an estimate to help you set money aside — confirm with your accountant.' },

  // ── Website & marketing ──
  { id: 'studio', cat: 'Website & marketing', title: 'Change the website’s colours, photo and wording', time: '5 min', routes: ['settings'], go: ['Open Website studio', 'settings/site'],
    steps: ['Open Website studio.', 'Pick an accent colour and dark or light theme.', 'Under Images, upload a homepage background photo.', 'Under Homepage wording, open a section and type your own heading. Put a word in [square brackets] to colour it.', 'Under Homepage sections, switch sections off or move them up and down.', 'Tap “Publish changes”, then “Preview site”.'] },
  { id: 'pages', cat: 'Website & marketing', title: 'Add a page such as About us', time: '5 min', routes: ['r/pages'], go: ['Open Website pages', 'r/pages'],
    steps: ['Open Website pages → Add page.', 'Type the title and the web address (e.g. about-us).', 'Write the content. Start a line with ## for a heading and - for a bullet point.', 'Upload a photo if you have one.', 'Tick “Show in the main menu” or “Show in the footer”, then Save.'] },
  { id: 'flyer', cat: 'Website & marketing', title: 'Make a flyer with a QR code', time: '3 min', routes: ['r/flyers'], go: ['Open Flyer studio', 'r/flyers'],
    steps: ['Open Flyer studio → Add flyer.', 'Choose a style and write a headline.', 'Add selling points, one per line.', 'Pick the services to feature and, if you like, a promo code.', 'Save, then open it again and tap “Print PDF” or “Share link”.', 'The dashboard counts bookings that came from each flyer.'] },
  { id: 'promo', cat: 'Website & marketing', title: 'Run an offer or a flash sale', time: '1 min', routes: ['r/promo_codes', 'r/banners'], go: ['Open Promo codes', 'r/promo_codes'],
    steps: ['Fastest: dashboard → One-tap controls → “48-hour flash sale” (10% off with a banner).', 'For your own offer: Promo codes → Add, choose a code, a percentage or amount, and an end date.', 'To announce it, add a Banner with the same code.', 'End a flash sale early with “End flash sale”.'] },
  { id: 'gallery', cat: 'Website & marketing', title: 'Add before-and-after photos', time: '2 min', routes: ['r/gallery_items'], go: ['Open Lab gallery', 'r/gallery_items'],
    steps: ['Open Lab gallery → Add.', 'Choose “Before / after” and upload both photos (take them from the same angle).', 'Add a title and tags such as “interior” or “paint”.', 'Tick “Featured” to show it on the homepage.'] },
  { id: 'reviews', cat: 'Website & marketing', title: 'Get more Google reviews', time: '2 min', routes: ['r/reviews'], go: ['Open Business settings', 'settings/business'],
    steps: ['Put your Google review link in Settings → Business.', 'Every completed job then gets a review request automatically about two hours later.', 'From a job card you can also tap “Ask for review” to send it by WhatsApp.', 'Connect Google reviews in Connections to show your rating on the website.'] },

  // ── Workshop ──
  { id: 'dtc', cat: 'Workshop', title: 'Use and grow the fault-code library', time: '2 min', routes: ['library', 'r/dtc_codes'], go: ['Open the tech library', 'library'],
    steps: ['Open Tech library and search a code such as P2002.', 'Each code shows causes and how to pinpoint it — handy on the driveway.', 'Add your own: Fault codes → Add.', 'Add many at once: Fault codes → “Import list”, then paste rows from a spreadsheet.'] },
  { id: 'checklists', cat: 'Workshop', title: 'Do a health check or pre-purchase inspection', time: '2 min', routes: ['checklist'],
    steps: ['Open the job → Checks tab.', 'Start “Vehicle health check” or “50-point inspection”.', 'Mark each item pass, advisory or fail; add a note or photo where useful.', 'Finish it — a PDF report appears on the customer’s tracker.'] },
  { id: 'stock', cat: 'Workshop', title: 'Track stock, chemicals and tool licences', time: '2 min', routes: ['r/inventory', 'r/licences'], go: ['Open Stock', 'r/inventory'],
    steps: ['Add each item under Stock & chemicals with a minimum level.', 'Log it on a job and the count goes down.', 'When stock drops below the minimum, it shows on the dashboard under “Needs attention”.', 'Add tool subscriptions under Licences & tokens to be warned 30 days before they expire.'] },

  // ── Team & safety ──
  { id: 'team', cat: 'Team & safety', title: 'Add a technician or partner', time: '2 min', go: ['Open Team', 'settings/team'],
    steps: ['Open Settings → Team and add a team member.', 'Enter their name and email, and choose a role.', 'Technician: can run jobs but cannot see prices or reports. Manager: everything except adding staff. Viewer: read-only.', 'Give them the password you set; they should change it and add their fingerprint.', 'Assign them to a job from the job card under Dispatch.'] },
  { id: 'backup', cat: 'Team & safety', title: 'Back up and download your data', time: '1 min', go: ['Open Backups', 'settings/backups'],
    steps: ['Open Settings → Backups & data.', 'Tap “Download everything” for a full copy of your data.', 'With R2 storage switched on, an encrypted backup is also saved every night.', 'The Audit trail shows who changed what, and when.'] },
];

const forRoute = (route: string): Tutorial | undefined => TUTORIALS.find((t) => t.routes?.some((r) => route === r || route.startsWith(`${r}/`)));

export function HelpView({ openId, from }: { me: Me; openId?: string; from?: string }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const suggested = from ? forRoute(from) : undefined;
  const [open, setOpen] = useState<string | null>(openId ?? suggested?.id ?? null);
  useEffect(() => {
    if (openId) setOpen(openId);
  }, [openId]);
  useEffect(() => {
    if (open) document.getElementById(`tut-${open}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = TUTORIALS.filter((t) => (!cat || t.cat === cat) && words.every((w) => `${t.title} ${t.steps.join(' ')} ${t.cat}`.toLowerCase().includes(w)));
  return (
    <div class="stack" style="gap:16px;max-width:900px">
      <PageTitle title="Help & tutorials" sub={`${TUTORIALS.length} step-by-step guides`} />
      <div class="input-group"><span class="btn btn-ghost" style="pointer-events:none"><Icon name="search" /></span><input class="input" type="search" placeholder="What do you want to do? e.g. flyer, day off, payment" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></div>
      <div class="chip-row"><button class="chip" type="button" aria-pressed={!cat} onClick={() => setCat('')}>All</button>{CATS.map((c) => <button class="chip" type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
      {list.length === 0 && <div class="empty">Nothing matches “{q}”. Try a different word, or ask in the chat that built your site.</div>}
      {CATS.filter((c) => list.some((t) => t.cat === c)).map((c) => (
        <section class="stack" style="gap:8px">
          <span class="deck-label" style="margin:6px 0 0">{c}</span>
          {list.filter((t) => t.cat === c).map((t) => (
            <div class={`panel tut${open === t.id ? ' tut-open' : ''}`} id={`tut-${t.id}`}>
              <button class="tut-head" type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                <span class="grow"><b>{t.title}</b></span><span class="faint mono" style="font-size:.74rem">{t.time}</span><Icon name={open === t.id ? 'up' : 'down'} />
              </button>
              {open === t.id && (
                <div class="stack" style="gap:12px;margin-top:12px">
                  <ol class="tut-steps">{t.steps.map((s) => <li>{s}</li>)}</ol>
                  {t.tip && <div class="alert alert-info"><Icon name="sparkle" /><span><b>Tip:</b> {t.tip}</span></div>}
                  {t.go && <button class="btn btn-primary" style="align-self:flex-start" type="button" onClick={() => go(t.go![1])}>{t.go[0]} <Icon name="arrow" /></button>}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

interface Item { key: string; label: string; done: boolean; href: string; tutorial: string; manual: boolean }

/** Getting-started checklist on the dashboard. Items tick themselves off from real data. */
export function Onboarding() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('s1-onboarding') === 'hidden');
  const [busy, act] = useAction();
  const load = () => get<{ items: Item[] }>('/onboarding').then((r) => setItems(r.data.items)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!items || hidden) return null;
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <div class="panel onboarding">
      <div class="panel-head"><h3><Icon name="sparkle" /> Getting started · {done} of {items.length}</h3><button class="btn btn-sm btn-ghost" type="button" onClick={() => { localStorage.setItem('s1-onboarding', 'hidden'); setHidden(true); }}>Hide</button></div>
      <div class="progress-bar" style="margin-bottom:10px"><span style={{ width: `${Math.round((done / items.length) * 100)}%` }} /></div>
      <div class="list">{items.map((i) => (
        <div class={`list-row${i.done ? ' is-done' : ''}`}>
          <span class={`tick${i.done ? ' on' : ''}`}>{i.done && <Icon name="check" />}</span>
          <span class="grow"><b>{i.label}</b></span>
          {!i.done && <a class="btn btn-sm btn-ghost" href={`#/help/${i.tutorial}`}>How?</a>}
          {!i.done && <a class="btn btn-sm" href={`#/${i.href}`}>Go</a>}
          {!i.done && i.manual && <button class="btn btn-sm btn-primary" type="button" disabled={busy} onClick={async () => { if (await act(() => send(`/onboarding/${i.key}`, {}))) void load(); }}>Done</button>}
        </div>
      ))}</div>
    </div>
  );
}
