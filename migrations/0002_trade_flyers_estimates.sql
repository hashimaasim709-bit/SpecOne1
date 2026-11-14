-- Trade accounts, interactive flyers, customer-approved estimates and booking channels.

-- Trade account applications reuse the partners table: an application is a partner with
-- trade_status 'applied' (and active = 0) until it is approved in the admin.
ALTER TABLE partners ADD COLUMN trade_status TEXT NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN trade_details TEXT NOT NULL DEFAULT '';

-- Where a booking came from (a flyer, the trade portal, a QR code…), for marketing reports.
ALTER TABLE bookings ADD COLUMN channel TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_bookings_channel ON bookings(channel);

-- Shareable, printable flyers built in the admin Flyer studio.
CREATE TABLE IF NOT EXISTS flyers (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'diagnostics' CHECK (template IN ('diagnostics','detailing','emergency','trade','seasonal')),
  headline TEXT NOT NULL DEFAULT '',
  subhead TEXT NOT NULL DEFAULT '',
  points TEXT NOT NULL DEFAULT '[]',
  package_slugs TEXT NOT NULL DEFAULT '[]',
  promo_code TEXT NOT NULL DEFAULT '',
  offer_text TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT 'Book now',
  expires_on TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Extra work found on a job, sent to the customer to approve or decline on their tracker.
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Additional work',
  note TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  created_by TEXT NOT NULL DEFAULT '',
  decided_name TEXT NOT NULL DEFAULT '',
  decided_note TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_estimates_booking ON estimates(booking_id);
