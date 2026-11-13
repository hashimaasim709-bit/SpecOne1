-- SpecOne Auto Labs — initial schema.
-- Money is stored as integer minor units (pence). Timestamps are ISO-8601 UTC strings.
-- Every statement is idempotent so the Worker's self-migrator and
-- `wrangler d1 migrations apply` can both run it safely.

-- ───────────────────────────── System ─────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  currency TEXT NOT NULL DEFAULT 'GBP',
  travel_bands TEXT NOT NULL DEFAULT '[]',
  max_miles REAL NOT NULL DEFAULT 45,
  slot_capacity TEXT NOT NULL DEFAULT '{}',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('owner','manager','technician','viewer')),
  password_hash TEXT NOT NULL DEFAULT '',
  location_id INTEGER REFERENCES locations(id),
  hourly_cost INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT 'Passkey',
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('staff','customer')),
  subject_id INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(kind, subject_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  challenge TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- The audit trail is append-only: the database itself refuses edits and deletions.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable');
END;

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS analytics_daily (
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, metric)
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  tables INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  encrypted INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL DEFAULT 'cron',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["*"]',
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  response_code INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);

-- ───────────────────────────── Media ─────────────────────────────
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'image',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  booking_id INTEGER,
  vehicle_id INTEGER,
  label TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  attached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_booking ON media(booking_id);

-- Fallback blob store used only when no R2 bucket is bound.
CREATE TABLE IF NOT EXISTS media_blobs (
  storage_key TEXT PRIMARY KEY,
  data BLOB NOT NULL
);

-- ───────────────────────────── Catalogue & pricing ─────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('diagnostics','detailing','plan','addon')),
  zone TEXT NOT NULL DEFAULT 'engine',
  badge TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  includes TEXT NOT NULL DEFAULT '[]',
  duration_min INTEGER NOT NULL DEFAULT 60,
  price_s INTEGER NOT NULL,
  price_m INTEGER NOT NULL,
  price_l INTEGER NOT NULL,
  needs_utilities INTEGER NOT NULL DEFAULT 0,
  mot_reminder INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS upsell_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_category TEXT NOT NULL DEFAULT '',
  trigger_package_slug TEXT NOT NULL DEFAULT '',
  suggest_package_slug TEXT NOT NULL,
  message TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  weekdays TEXT NOT NULL DEFAULT '[]',
  slots TEXT NOT NULL DEFAULT '[]',
  adjust_type TEXT NOT NULL DEFAULT 'percent' CHECK (adjust_type IN ('percent','fixed')),
  value INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'promo' CHECK (kind IN ('promo','referral')),
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  value INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_spend INTEGER NOT NULL DEFAULT 0,
  starts_on TEXT,
  expires_on TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  owner_customer_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT ''
);

-- ───────────────────────────── CRM ─────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  referral_code TEXT UNIQUE,
  referred_by INTEGER REFERENCES customers(id),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  partner_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  reg TEXT NOT NULL,
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year INTEGER,
  fuel TEXT NOT NULL DEFAULT '',
  colour TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT 'M' CHECK (size IN ('S','M','L')),
  body TEXT NOT NULL DEFAULT 'hatchback',
  mot_due TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_reg ON vehicles(reg);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bodyshop' CHECK (kind IN ('bodyshop','auction','garage','fleet','recovery','other')),
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL UNIQUE,
  commission_pct INTEGER NOT NULL DEFAULT 10,
  customer_discount_pct INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  public_listing INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────────────────────────── Bookings ─────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  location_id INTEGER NOT NULL DEFAULT 1 REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','en_route','arrived','in_progress','completed','cancelled','no_show')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','phone','walk_in','subscription','fleet','admin')),
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning','afternoon','evening','asap')),
  slot_span INTEGER NOT NULL DEFAULT 1,
  emergency INTEGER NOT NULL DEFAULT 0,
  service_mode TEXT NOT NULL DEFAULT 'mobile' CHECK (service_mode IN ('mobile','drop_off')),
  address TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  distance_miles REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  travel_fee INTEGER NOT NULL DEFAULT 0,
  emergency_fee INTEGER NOT NULL DEFAULT 0,
  peak_adjustment INTEGER NOT NULL DEFAULT 0,
  loyalty_discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  quote_snapshot TEXT NOT NULL DEFAULT '{}',
  deposit_due INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'on_completion',
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','deposit_paid','paid','refunded')),
  promo_code TEXT NOT NULL DEFAULT '',
  referral_code TEXT NOT NULL DEFAULT '',
  partner_id INTEGER REFERENCES partners(id),
  fleet_slug TEXT NOT NULL DEFAULT '',
  subscription_id INTEGER,
  assigned_user_id INTEGER REFERENCES users(id),
  van_id INTEGER,
  customer_notes TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  signature_media_id INTEGER,
  signed_name TEXT NOT NULL DEFAULT '',
  signed_at TEXT,
  eta_minutes INTEGER,
  started_at TEXT,
  completed_at TEXT,
  cancelled_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, slot);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  size TEXT NOT NULL DEFAULT 'M',
  mileage INTEGER
);
CREATE INDEX IF NOT EXISTS idx_booking_vehicles_booking ON booking_vehicles(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_vehicles_vehicle ON booking_vehicles(vehicle_id);

CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id),
  package_id INTEGER REFERENCES packages(id),
  kind TEXT NOT NULL DEFAULT 'package' CHECK (kind IN ('package','labour','part','custom')),
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);

CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 1,
  actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'balance' CHECK (kind IN ('deposit','balance','refund')),
  method TEXT NOT NULL DEFAULT 'card',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL DEFAULT 'succeeded',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider, provider_ref) WHERE provider_ref <> '';

CREATE TABLE IF NOT EXISTS vans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL DEFAULT 1 REFERENCES locations(id),
  name TEXT NOT NULL,
  reg TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  heading REAL,
  speed_mph REAL,
  tracking_booking_id INTEGER,
  position_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────────── Plans, loyalty, referrals ─────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  includes TEXT NOT NULL DEFAULT '[]',
  interval TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('weekly','fortnightly','monthly','quarterly')),
  price_s INTEGER NOT NULL,
  price_m INTEGER NOT NULL,
  price_l INTEGER NOT NULL,
  package_slug TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'retail',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  preferred_slot TEXT NOT NULL DEFAULT 'morning',
  address TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  next_visit_on TEXT,
  started_on TEXT NOT NULL DEFAULT (date('now')),
  cancelled_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  booking_id INTEGER,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_ledger(customer_id);

CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','void')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────────────────────────── Finance & stock ─────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'chemical' CHECK (category IN ('chemical','consumable','part','fluid','tool','token')),
  unit TEXT NOT NULL DEFAULT 'units',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  alerted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'parts' CHECK (category IN ('parts','fluids','chemicals','fuel','tools','licences','insurance','marketing','vehicle','other')),
  description TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,
  vat_amount INTEGER NOT NULL DEFAULT 0,
  spent_on TEXT NOT NULL DEFAULT (date('now')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_booking ON expenses(booking_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_on);

CREATE TABLE IF NOT EXISTS licences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'software' CHECK (kind IN ('software','hardware','tokens','insurance','certification','other')),
  serial TEXT NOT NULL DEFAULT '',
  expires_on TEXT,
  tokens_left INTEGER,
  annual_cost INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  alerted_at TEXT
);

CREATE TABLE IF NOT EXISTS parts_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  vehicle_reg TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  supplier_contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','requested','ordered','received','fitted','cancelled')),
  items TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────────────────────────── Messaging ─────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id INTEGER,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(status, send_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  provider TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  booking_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  visitor_name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  unread INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT NOT NULL DEFAULT '',
  sentiment_score REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('visitor','bot','staff')),
  author TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);

CREATE TABLE IF NOT EXISTS chatbot_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keywords TEXT NOT NULL,
  answer TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'site' CHECK (source IN ('site','google')),
  external_id TEXT NOT NULL DEFAULT '',
  booking_id INTEGER,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL DEFAULT '',
  vehicle TEXT NOT NULL DEFAULT '',
  reviewed_on TEXT NOT NULL DEFAULT (date('now')),
  visible INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT NOT NULL DEFAULT '',
  sentiment_score REAL,
  sentiment_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_external ON reviews(source, external_id) WHERE external_id <> '';

-- ───────────────────────────── Marketing content ─────────────────────────────
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'promo' CHECK (kind IN ('promo','seasonal','emergency','notice')),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT '',
  cta_href TEXT NOT NULL DEFAULT '',
  promo_code TEXT NOT NULL DEFAULT '',
  months TEXT NOT NULL DEFAULT '[]',
  starts_on TEXT,
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'General',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS towns (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  postcodes TEXT NOT NULL DEFAULT '',
  areas TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  body TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fleet_portals (
  slug TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  partner_id INTEGER REFERENCES partners(id),
  logo_media_id INTEGER,
  accent TEXT NOT NULL DEFAULT '#e11d48',
  headline TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  discount_pct INTEGER NOT NULL DEFAULT 0,
  contact_name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS guides (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all','winter','spring','summer','autumn')),
  category TEXT NOT NULL DEFAULT 'Detailing',
  read_minutes INTEGER NOT NULL DEFAULT 4,
  published_on TEXT NOT NULL DEFAULT (date('now')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','before_after','video','before_after_video','social')),
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  media_id INTEGER,
  before_media_id INTEGER,
  after_media_id INTEGER,
  embed_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────────────────────────── Technical library ─────────────────────────────
CREATE TABLE IF NOT EXISTS dtc_codes (
  code TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  title TEXT NOT NULL,
  causes TEXT NOT NULL DEFAULT '',
  fixes TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'amber' CHECK (severity IN ('info','amber','red')),
  package_slug TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coding_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_group TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  feature TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  parameter TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wiring_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_model TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  media_id INTEGER
);

CREATE TABLE IF NOT EXISTS torque_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  make_model TEXT NOT NULL,
  wheel_nm TEXT NOT NULL DEFAULT '',
  caliper_nm TEXT NOT NULL DEFAULT '',
  sump_nm TEXT NOT NULL DEFAULT '',
  other TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tech_guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('canbus','injector','epb','air_suspension','dpf','battery','general')),
  title TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flash_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  reg TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL,
  part_number TEXT NOT NULL DEFAULT '',
  version_before TEXT NOT NULL DEFAULT '',
  version_after TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failed','rolled_back')),
  notes TEXT NOT NULL DEFAULT '',
  flashed_on TEXT NOT NULL DEFAULT (date('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_flash_reg ON flash_log(reg);

CREATE TABLE IF NOT EXISTS dpf_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  reg TEXT NOT NULL DEFAULT '',
  regen_type TEXT NOT NULL DEFAULT 'forced_static' CHECK (regen_type IN ('forced_static','forced_dynamic','chemical_clean','assessment_only')),
  soot_pct_before REAL,
  soot_pct_after REAL,
  soot_g_before REAL,
  soot_g_after REAL,
  dp_mbar_before REAL,
  dp_mbar_after REAL,
  ash_g REAL,
  max_egt_c INTEGER,
  duration_min INTEGER,
  km_since_regen INTEGER,
  result TEXT NOT NULL DEFAULT 'pass' CHECK (result IN ('pass','partial','fail')),
  notes TEXT NOT NULL DEFAULT '',
  logged_on TEXT NOT NULL DEFAULT (date('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dpf_reg ON dpf_logs(reg);

CREATE TABLE IF NOT EXISTS battery_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  reg TEXT NOT NULL DEFAULT '',
  battery_type TEXT NOT NULL DEFAULT 'AGM',
  rated_cca INTEGER,
  measured_cca INTEGER,
  soh_pct REAL,
  soc_pct REAL,
  resting_v REAL,
  cranking_v REAL,
  charging_v_idle REAL,
  charging_v_load REAL,
  ripple_mv REAL,
  verdict TEXT NOT NULL DEFAULT 'pass' CHECK (verdict IN ('pass','monitor','replace')),
  notes TEXT NOT NULL DEFAULT '',
  tested_on TEXT NOT NULL DEFAULT (date('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_battery_reg ON battery_tests(reg);

CREATE TABLE IF NOT EXISTS freeze_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  reg TEXT NOT NULL DEFAULT '',
  dtc TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  captured_on TEXT NOT NULL DEFAULT (date('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_freeze_reg ON freeze_frames(reg);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('packing','vhc','ppi','pre_inspection')),
  name TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS checklist_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
  kind TEXT NOT NULL,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  reg TEXT NOT NULL DEFAULT '',
  results TEXT NOT NULL DEFAULT '{}',
  score INTEGER,
  max_score INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  completed_by TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_booking ON checklist_runs(booking_id);
