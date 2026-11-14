// Constants shared by the Worker and the browser apps.

export const BRAND = {
  name: 'SpecOne Auto Labs',
  short: 'SpecOne',
  tagline: 'Mobile diagnostics, coding & detailing laboratory',
} as const;

export const SLOTS = {
  morning: { label: 'Morning', window: '9:00 – 13:00', startHour: 9, endHour: 13 },
  afternoon: { label: 'Afternoon', window: '13:00 – 17:00', startHour: 13, endHour: 17 },
  evening: { label: 'Evening', window: '17:00 – 20:30', startHour: 17, endHour: 20.5 },
} as const;
export type SlotKey = keyof typeof SLOTS;
export type BookingSlot = SlotKey | 'asap';
export const SLOT_ORDER: SlotKey[] = ['morning', 'afternoon', 'evening'];
export const slotLabel = (slot: string): string =>
  slot === 'asap' ? 'Emergency — as soon as possible' : `${SLOTS[slot as SlotKey]?.label ?? slot} (${SLOTS[slot as SlotKey]?.window ?? ''})`;

export type Size = 'S' | 'M' | 'L';
export const SIZES: Record<Size, { label: string; examples: string }> = {
  S: { label: 'Small', examples: 'Fiesta, Polo, Mini, Corsa' },
  M: { label: 'Medium', examples: 'Golf, Puma, 3 Series, A-Class' },
  L: { label: 'Large', examples: 'Range Rover, X5, Transit, Q7' },
};

export const BODIES = ['hatchback', 'saloon', 'suv', 'van'] as const;
export type Body = (typeof BODIES)[number];
export const BODY_LABELS: Record<Body, string> = { hatchback: 'Hatchback', saloon: 'Saloon / Estate', suv: 'SUV / 4x4', van: 'Van' };

export const BOOKING_STATUSES = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const STATUS_META: Record<BookingStatus, { label: string; tone: 'neutral' | 'info' | 'warn' | 'good' | 'bad'; customer: string }> = {
  pending: { label: 'Awaiting confirmation', tone: 'warn', customer: 'We have your request and will confirm shortly.' },
  confirmed: { label: 'Confirmed', tone: 'info', customer: 'Your slot is locked in.' },
  en_route: { label: 'En route', tone: 'info', customer: 'The mobile lab is on its way to you.' },
  arrived: { label: 'Arrived', tone: 'info', customer: 'Your technician has arrived.' },
  in_progress: { label: 'Work in progress', tone: 'warn', customer: 'Work is under way on your vehicle.' },
  completed: { label: 'Completed', tone: 'good', customer: 'All done — your report and invoice are ready.' },
  cancelled: { label: 'Cancelled', tone: 'bad', customer: 'This booking was cancelled.' },
  no_show: { label: 'No show', tone: 'bad', customer: 'We could not reach you for this appointment.' },
};
/** Stages shown on the customer's live tracker, in order. */
export const TRACK_STAGES: { status: BookingStatus; label: string }[] = [
  { status: 'confirmed', label: 'Booking confirmed' },
  { status: 'en_route', label: 'Mobile lab en route' },
  { status: 'arrived', label: 'Arrived & pre-inspection' },
  { status: 'in_progress', label: 'Work in progress' },
  { status: 'completed', label: 'Completed' },
];
export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];

export const PAYMENT_METHODS: Record<string, string> = {
  on_completion: 'Card / Apple Pay / Google Pay on completion',
  card: 'Card / contactless',
  sumup: 'Card (SumUp reader)',
  other: 'Other',
  cash: 'Cash on completion',
  bank_transfer: 'Bank transfer on invoice',
  online: 'Paid online',
  account: 'Trade account (monthly invoice)',
};

export const ROLES = ['owner', 'manager', 'technician', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner — full access',
  manager: 'Manager — everything except team & security',
  technician: 'Technician — jobs and technical tools, no financials',
  viewer: 'Viewer — read-only bookings, no financials',
};

export const PERMISSIONS = [
  'bookings.read', 'bookings.write', 'finance.read', 'finance.write', 'crm.read', 'crm.write',
  'tech.read', 'tech.write', 'inventory.write', 'content.write', 'inbox', 'settings.write', 'users.write', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: PERMISSIONS.filter((p) => p !== 'users.write'),
  technician: ['bookings.read', 'bookings.write', 'crm.read', 'tech.read', 'tech.write', 'inventory.write', 'inbox'],
  viewer: ['bookings.read', 'crm.read', 'tech.read'],
};
export const can = (role: string | undefined | null, permission: Permission): boolean =>
  !!role && (ROLE_PERMISSIONS[role as Role] ?? []).includes(permission);

/** Events emitted to outgoing webhooks (Zapier, Make, n8n, accounting tools). */
export const WEBHOOK_EVENTS = [
  'booking.created', 'booking.updated', 'booking.status_changed', 'booking.completed', 'booking.cancelled',
  'payment.received', 'customer.created', 'review.received', 'chat.message', 'inventory.low_stock',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const VEHICLE_ZONES: Record<string, { label: string; blurb: string }> = {
  engine: { label: 'Engine & powertrain', blurb: 'Fault pinpointing, live data, oscilloscope work and engine-bay detailing.' },
  dash: { label: 'ECU, coding & keys', blurb: 'Hidden-feature activation, module retrofits, immobiliser and key programming.' },
  chassis: { label: 'Brakes, ABS & chassis', blurb: 'ABS/ESP recoding, electronic bleeding, EPB service and battery health.' },
  exhaust: { label: 'DPF, AdBlue & emissions', blurb: 'Soot assessment, forced regeneration, NOx / SCR and AdBlue diagnostics.' },
  cabin: { label: 'Cabin & interior', blurb: 'Heated wet extraction, steam sanitisation and leather care.' },
  paint: { label: 'Paint, glass & lights', blurb: 'Decontamination, machine polishing, ceramic coating and headlight restoration.' },
};

export const SYMPTOM_CHIPS = [
  'Engine management light / limp mode',
  'DPF warning or blocked filter',
  'AdBlue / emissions warning',
  'ABS, traction or airbag light',
  'Battery drain or charging fault',
  'Will not start / intermittent start',
  'Activate CarPlay / Android Auto',
  'Spare key or immobiliser coding',
  'Module replaced and needs coding',
  'Pre-purchase inspection',
];

// ── Website studio (admin-controlled site layout and look) ──

/** Homepage sections in their default order. The hero always stays first. */
export const HOME_SECTIONS = [
  ['hero', 'Hero & live telemetry'],
  ['marquee', 'Credentials ticker'],
  ['services', 'Featured services'],
  ['stage', 'Interactive vehicle stage'],
  ['how', 'How it works'],
  ['results', 'Transformations gallery'],
  ['coverage', 'Coverage map & postcode check'],
  ['reviews', 'Reviews'],
  ['lookup', 'Fault-code lookup'],
  ['guides', 'Seasonal guides'],
  ['trade', 'Fleet & trade'],
  ['faq', 'FAQ'],
  ['cta', 'Booking call-to-action'],
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number][0];

/** Accent colour presets. Each passes contrast on both the dark and light themes. */
export const ACCENTS = {
  crimson: { label: 'SpecOne crimson', swatch: '#e11d48' },
  racing: { label: 'Racing red', swatch: '#ef4444' },
  electric: { label: 'Electric blue', swatch: '#2f7cf6' },
  amber: { label: 'Workshop amber', swatch: '#f59e0b' },
  emerald: { label: 'Emerald', swatch: '#10b981' },
  violet: { label: 'Ultra violet', swatch: '#8b5cf6' },
} as const;
export type AccentKey = keyof typeof ACCENTS;

/** Right-hand panel of the homepage hero. */
export const HERO_PANELS = [
  ['telemetry', 'Live lab telemetry (availability gauge)'],
  ['contact', 'Quick contact card (call, WhatsApp, book)'],
  ['none', 'No panel — text only'],
] as const;

export const FLYER_TEMPLATES = {
  diagnostics: { label: 'Diagnostics & coding', eyebrow: 'Mobile diagnostics lab', icon: 'gauge' },
  detailing: { label: 'Detailing & ceramic', eyebrow: 'Restorative detailing', icon: 'sparkle' },
  emergency: { label: 'Emergency call-out', eyebrow: 'Breakdown & limp-mode rescue', icon: 'alert' },
  trade: { label: 'Trade & fleet', eyebrow: 'Trade accounts', icon: 'building' },
  seasonal: { label: 'Seasonal offer', eyebrow: 'Limited-time offer', icon: 'gift' },
} as const;
export type FlyerTemplate = keyof typeof FLYER_TEMPLATES;

/** Topics on the contact & help form. */
export const CONTACT_TOPICS = [
  ['booking', 'A booking or availability question'],
  ['quote', 'A quote for a fault or job'],
  ['warning', 'A warning light or fault code'],
  ['coding', 'Coding or feature activation'],
  ['detailing', 'Detailing or ceramic'],
  ['trade', 'Trade or fleet account'],
  ['existing', 'An existing booking or report'],
  ['feedback', 'Feedback or a complaint'],
  ['other', 'Something else'],
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number][0];
