// Third-party services the platform can use, described for the admin Connections centre.
// Keys pasted in the admin are stored encrypted in the database; a Cloudflare secret with the
// same name always takes priority.

export interface ConnectionField {
  name: string;
  label: string;
  /** Public keys (site keys, map keys) end up in the page; everything else is never shown again. */
  secret: boolean;
  placeholder?: string;
}

export interface ConnectionDef {
  key: string;
  title: string;
  what: string;
  cost: string;
  steps: string[];
  link: { label: string; url: string };
  fields: ConnectionField[];
  /** Fields that must all be set for the service to be on. */
  required: string[];
  test?: { label: string; input?: string };
  priority: 'essential' | 'recommended' | 'optional';
}

export const CONNECTIONS: ConnectionDef[] = [
  {
    key: 'alerts',
    title: 'Phone alerts (ntfy)',
    what: 'Instant notifications on your phone for new bookings, chats, contact messages, trade applications, payments and low stock.',
    cost: 'Free',
    steps: [
      'Install the free “ntfy” app from the Play Store or App Store.',
      'Tap “Create my private alert channel” below — a secret channel name is made for you.',
      'Tap the subscribe link on your phone (or add the channel name in the ntfy app with the + button).',
      'Tap “Send test” — your phone should buzz.',
    ],
    link: { label: 'Get the ntfy app', url: 'https://ntfy.sh/' },
    fields: [{ name: 'NTFY_TOPIC', label: 'Private channel name', secret: true, placeholder: 'created for you below' }, { name: 'NTFY_SERVER', label: 'Server (leave blank for ntfy.sh)', secret: false, placeholder: 'https://ntfy.sh' }],
    required: ['NTFY_TOPIC'],
    test: { label: 'Send test' },
    priority: 'essential',
  },
  {
    key: 'dvla',
    title: 'DVLA registration lookup',
    what: 'Fills in make, colour, fuel, year and MOT expiry from the number plate when customers book, and powers free MOT reminders.',
    cost: 'Free (apply to DVLA)',
    steps: [
      'Open the DVLA Vehicle Enquiry Service API page and choose “Register for an API key”.',
      'Fill in the form: business name SpecOne Auto Labs, use case “prefill vehicle details for customer bookings”.',
      'DVLA emails your API key (usually within a few days).',
      'Paste it below and test with your own number plate.',
    ],
    link: { label: 'DVLA API registration', url: 'https://register-for-ves.driver-vehicle-licensing.api.gov.uk/' },
    fields: [{ name: 'DVLA_API_KEY', label: 'DVLA API key', secret: true }],
    required: ['DVLA_API_KEY'],
    test: { label: 'Look up a plate', input: 'Registration, e.g. GY75AWV' },
    priority: 'recommended',
  },
  {
    key: 'address',
    title: 'Street address lookup',
    what: 'After a customer types their postcode, a dropdown lists every street address so they pick theirs instead of typing it.',
    cost: 'Small charge per lookup — check the provider’s current pricing',
    steps: [
      'Create an account with getAddress.io (or Ideal Postcodes).',
      'Copy your API key from their dashboard.',
      'Paste it below and test with your postcode.',
      'Postcode distance and travel fees already work without this.',
    ],
    link: { label: 'getAddress.io', url: 'https://getaddress.io/' },
    fields: [{ name: 'GETADDRESS_API_KEY', label: 'getAddress.io API key', secret: true }, { name: 'IDEAL_POSTCODES_API_KEY', label: 'or Ideal Postcodes API key', secret: true }],
    required: [],
    test: { label: 'Find addresses', input: 'Postcode, e.g. BN21 4AB' },
    priority: 'recommended',
  },
  {
    key: 'maps',
    title: 'Detailed maps',
    what: 'Sharper street maps with road names in matching dark and light styles for the coverage map and the live van tracker.',
    cost: 'Free tier available',
    steps: [
      'Create a free MapTiler account.',
      'Open “API keys”, copy your key, and under “Allowed HTTP origins” add speconeautolabs.co.uk.',
      'Paste it below. Without a key the site uses standard OpenStreetMap tiles.',
    ],
    link: { label: 'MapTiler', url: 'https://cloud.maptiler.com/account/keys/' },
    fields: [{ name: 'MAPTILER_KEY', label: 'MapTiler key (public)', secret: false }],
    required: ['MAPTILER_KEY'],
    priority: 'optional',
  },
  {
    key: 'email',
    title: 'Email (Resend)',
    what: 'Booking confirmations, reminders, sign-in codes, invoices, estimates and trade codes by email.',
    cost: 'Free tier available',
    steps: [
      'Create a Resend account and add your domain speconeautolabs.co.uk.',
      'Add the DNS records Resend shows you in Cloudflare → DNS (it takes a few minutes to verify).',
      'Create an API key and paste it below, with the “from” address.',
      'Send a test email to yourself.',
    ],
    link: { label: 'Resend', url: 'https://resend.com/' },
    fields: [{ name: 'RESEND_API_KEY', label: 'Resend API key', secret: true }, { name: 'EMAIL_FROM', label: 'Send from', secret: false, placeholder: 'SpecOne Auto Labs <bookings@speconeautolabs.co.uk>' }],
    required: ['RESEND_API_KEY'],
    test: { label: 'Send test email', input: 'Your email address' },
    priority: 'essential',
  },
  {
    key: 'sms',
    title: 'Text messages & WhatsApp (Twilio)',
    what: 'Automatic texts with tracker links, “on my way” messages, reminders, review requests and estimates. WhatsApp Business once approved by Meta.',
    cost: 'Pay per message — check Twilio’s UK pricing',
    steps: [
      'Create a Twilio account and buy a UK mobile number (or set up an alphanumeric sender “SpecOne”).',
      'Copy the Account SID and Auth Token from the Twilio console.',
      'Paste them below with your Twilio number in +44 format.',
      'WhatsApp: request a WhatsApp sender in Twilio, then add it as “WhatsApp from”.',
    ],
    link: { label: 'Twilio console', url: 'https://console.twilio.com/' },
    fields: [
      { name: 'TWILIO_ACCOUNT_SID', label: 'Account SID', secret: true },
      { name: 'TWILIO_AUTH_TOKEN', label: 'Auth token', secret: true },
      { name: 'TWILIO_FROM', label: 'Send from (+44… or sender name)', secret: false },
      { name: 'TWILIO_WHATSAPP_FROM', label: 'WhatsApp from (optional)', secret: false, placeholder: 'whatsapp:+44…' },
    ],
    required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
    test: { label: 'Send test text', input: 'Your mobile number' },
    priority: 'recommended',
  },
  {
    key: 'payments',
    title: 'Card payments, Apple Pay & Google Pay (Stripe)',
    what: 'Online deposits and balances from the tracker with card, Apple Pay and Google Pay. Paid jobs update automatically.',
    cost: 'Per-transaction fee — check Stripe’s UK pricing',
    steps: [
      'Create a Stripe account and complete the business verification.',
      'Developers → API keys: copy the Secret key (starts sk_live_).',
      'Developers → Webhooks → Add endpoint: https://speconeautolabs.co.uk/api/stripe/webhook with events checkout.session.completed, checkout.session.async_payment_succeeded and charge.refunded. Copy its signing secret (whsec_).',
      'Paste both below and test.',
    ],
    link: { label: 'Stripe dashboard', url: 'https://dashboard.stripe.com/apikeys' },
    fields: [{ name: 'STRIPE_SECRET_KEY', label: 'Secret key', secret: true }, { name: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook signing secret', secret: true }],
    required: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    test: { label: 'Check connection' },
    priority: 'optional',
  },
  {
    key: 'reviews',
    title: 'Google reviews sync',
    what: 'Pulls your Google rating and newest reviews onto the website every day.',
    cost: 'Free monthly allowance on Google Cloud',
    steps: [
      'In Google Cloud, create a project and enable “Places API (New)”.',
      'Create an API key (restrict it to the Places API).',
      'Find your Place ID with Google’s Place ID finder and put it in Settings → Business.',
      'Paste the key below and test.',
    ],
    link: { label: 'Google Cloud console', url: 'https://console.cloud.google.com/apis/library/places.googleapis.com' },
    fields: [{ name: 'GOOGLE_PLACES_API_KEY', label: 'Places API key', secret: true }],
    required: ['GOOGLE_PLACES_API_KEY'],
    test: { label: 'Sync now' },
    priority: 'optional',
  },
  {
    key: 'turnstile',
    title: 'Spam protection (Cloudflare Turnstile)',
    what: 'Invisible check on booking, contact and trade forms that stops spam bots without annoying customers.',
    cost: 'Free',
    steps: [
      'Cloudflare dashboard → Turnstile → Add widget, domain speconeautolabs.co.uk, mode “Managed”.',
      'Copy the Site key and Secret key and paste them below.',
    ],
    link: { label: 'Cloudflare Turnstile', url: 'https://dash.cloudflare.com/?to=/:account/turnstile' },
    fields: [{ name: 'TURNSTILE_SITE_KEY', label: 'Site key (public)', secret: false }, { name: 'TURNSTILE_SECRET_KEY', label: 'Secret key', secret: true }],
    required: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
    priority: 'recommended',
  },
  {
    key: 'telegram',
    title: 'Telegram alerts (optional)',
    what: 'The same phone alerts as ntfy, delivered by a Telegram bot instead or as well.',
    cost: 'Free',
    steps: ['Message @BotFather in Telegram, create a bot and copy its token.', 'Send your bot a message, then get your chat ID (e.g. from @userinfobot).', 'Paste both below.'],
    link: { label: 'BotFather', url: 'https://t.me/BotFather' },
    fields: [{ name: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', secret: true }, { name: 'TELEGRAM_CHAT_ID', label: 'Chat ID', secret: false }],
    required: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    priority: 'optional',
  },
  {
    key: 'ai',
    title: 'AI review & chat insights (Claude)',
    what: 'Summarises the mood of reviews and chats and suggests follow-ups. A built-in analyser runs without it.',
    cost: 'Pay per use',
    steps: ['Create an account at console.anthropic.com and add billing.', 'Create an API key and paste it below.'],
    link: { label: 'Anthropic console', url: 'https://console.anthropic.com/' },
    fields: [{ name: 'ANTHROPIC_API_KEY', label: 'API key', secret: true }],
    required: ['ANTHROPIC_API_KEY'],
    priority: 'optional',
  },
];

export const CONNECTION_FIELD_NAMES: string[] = CONNECTIONS.flatMap((c) => c.fields.map((f) => f.name));
