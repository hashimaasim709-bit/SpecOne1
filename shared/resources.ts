// Declarative definitions for every admin-managed table. The Worker uses them to build a
// safe, parameterised CRUD API (only listed columns can ever be read or written) and the
// admin app uses the same definitions to render tables and forms.
import type { Permission } from './constants';
import { WEBHOOK_EVENTS } from './constants';

export type FieldType =
  | 'text' | 'textarea' | 'markdown' | 'int' | 'number' | 'money' | 'percent' | 'bool' | 'date' | 'select'
  | 'list' | 'rows' | 'sections' | 'weekdays' | 'slotset' | 'months' | 'multiselect' | 'color' | 'media' | 'url' | 'email' | 'tel';

export interface RowColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money';
  width?: number;
}

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: (string | [string, string])[];
  required?: boolean;
  /** Show as a column in the list view. */
  list?: boolean;
  help?: string;
  def?: string | number | boolean;
  placeholder?: string;
  columns?: RowColumn[];
  accept?: string;
  /** Set once on create, then locked (primary keys such as slugs and codes). */
  lockOnEdit?: boolean;
  upper?: boolean;
}

export interface Resource {
  key: string;
  table: string;
  pk: string;
  pkType: 'int' | 'text';
  title: string;
  singular: string;
  group: 'Catalogue & pricing' | 'Customers' | 'Finance & stock' | 'Marketing' | 'Workshop library' | 'Job logs' | 'System';
  blurb: string;
  fields: Field[];
  search: string[];
  orderBy: string;
  filter?: string;
  read: Permission;
  write: Permission;
  /** Columns holding money that roles without finance access must not see. */
  financeFields?: string[];
}

const f = (key: string, label: string, type: FieldType, extra: Partial<Field> = {}): Field => ({ key, label, type, ...extra });
const active = f('active', 'Active', 'bool', { def: true, list: true });
const sort = f('sort', 'Sort order', 'int', { def: 0, help: 'Lower numbers appear first.' });
const zones: [string, string][] = [['engine', 'Engine & powertrain'], ['dash', 'ECU, coding & keys'], ['chassis', 'Brakes, ABS & chassis'], ['exhaust', 'DPF & emissions'], ['cabin', 'Cabin & interior'], ['paint', 'Paint, glass & lights']];

export const RESOURCES: Resource[] = [
  // ── Catalogue & pricing ──
  {
    key: 'packages', table: 'packages', pk: 'id', pkType: 'int', title: 'Service packages', singular: 'package', group: 'Catalogue & pricing',
    blurb: 'Everything customers can book. Prices are per vehicle size.',
    read: 'bookings.read', write: 'content.write', search: ['name', 'summary', 'badge'], orderBy: 'sort, id', filter: 'category',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('slug', 'URL slug', 'text', { required: true, help: 'Used in the page address: /services/your-slug' }),
      f('category', 'Category', 'select', { options: [['diagnostics', 'Diagnostics & coding'], ['detailing', 'Detailing'], ['plan', 'Maintenance plan'], ['addon', 'Add-on']], required: true, list: true }),
      f('zone', 'Vehicle zone', 'select', { options: zones, help: 'Which hotspot on the interactive vehicle diagram highlights this package.' }),
      f('badge', 'Badge', 'text', { placeholder: 'Most popular' }),
      f('summary', 'Summary', 'textarea', { required: true }),
      f('includes', "What's included", 'list', { help: 'One line per item.' }),
      f('duration_min', 'Duration (minutes)', 'int', { def: 60, list: true }),
      f('price_s', 'Price — small', 'money', { required: true, list: true }),
      f('price_m', 'Price — medium', 'money', { required: true, list: true }),
      f('price_l', 'Price — large', 'money', { required: true, list: true }),
      f('needs_utilities', 'Needs water tap & 240V socket', 'bool'),
      f('mot_reminder', 'Schedule an 11-month MOT / service reminder after this job', 'bool'),
      f('featured', 'Featured on the home page', 'bool'),
      active, sort,
    ],
  },
  {
    key: 'plans', table: 'plans', pk: 'id', pkType: 'int', title: 'Maintenance plans', singular: 'plan', group: 'Catalogue & pricing',
    blurb: 'Recurring subscriptions. Visits are scheduled automatically ahead of each due date.',
    read: 'bookings.read', write: 'content.write', search: ['name', 'summary'], orderBy: 'sort, id',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('slug', 'Slug', 'text', { required: true }),
      f('summary', 'Summary', 'textarea'),
      f('includes', "What's included", 'list'),
      f('interval', 'Visit frequency', 'select', { options: ['weekly', 'fortnightly', 'monthly', 'quarterly'], list: true }),
      f('price_s', 'Per visit — small', 'money', { required: true, list: true }),
      f('price_m', 'Per visit — medium', 'money', { required: true, list: true }),
      f('price_l', 'Per visit — large', 'money', { required: true, list: true }),
      f('package_slug', 'Linked package slug', 'text', { help: 'Booking this package in the wizard starts the plan.' }),
      f('audience', 'Audience', 'select', { options: ['retail', 'fleet'] }),
      active, sort,
    ],
  },
  {
    key: 'upsell_rules', table: 'upsell_rules', pk: 'id', pkType: 'int', title: 'Smart upsells', singular: 'upsell rule', group: 'Catalogue & pricing',
    blurb: 'Suggest a relevant extra when a customer picks a package or category.',
    read: 'bookings.read', write: 'content.write', search: ['message', 'suggest_package_slug'], orderBy: 'sort, id',
    fields: [
      f('trigger_category', 'When the basket contains a package in', 'select', { options: [['', 'Any category'], ['diagnostics', 'Diagnostics & coding'], ['detailing', 'Detailing']], list: true }),
      f('trigger_package_slug', '…or this specific package (slug)', 'text', { list: true, help: 'Leave blank to trigger on the whole category.' }),
      f('suggest_package_slug', 'Suggest this package (slug)', 'text', { required: true, list: true }),
      f('message', 'Message shown to the customer', 'textarea', { required: true }),
      active, sort,
    ],
  },
  {
    key: 'pricing_rules', table: 'pricing_rules', pk: 'id', pkType: 'int', title: 'Peak-hour pricing', singular: 'pricing rule', group: 'Catalogue & pricing',
    blurb: 'Automatic uplifts (or off-peak discounts) for particular days and arrival windows.',
    read: 'bookings.read', write: 'finance.write', search: ['name'], orderBy: 'id',
    fields: [
      f('name', 'Label shown on the quote', 'text', { required: true, list: true, placeholder: 'Sunday call-out' }),
      f('weekdays', 'Days', 'weekdays', { help: 'None selected = every day.', list: true }),
      f('slots', 'Arrival windows', 'slotset', { help: 'None selected = every window.', list: true }),
      f('adjust_type', 'Adjustment', 'select', { options: [['percent', 'Percentage of the job'], ['fixed', 'Fixed amount']], list: true }),
      f('value', 'Value', 'int', { required: true, list: true, help: 'Percent: 10 = +10%, -10 = 10% off. Fixed: pence, e.g. 1500 = +£15.' }),
      active,
    ],
  },
  {
    key: 'promo_codes', table: 'promo_codes', pk: 'id', pkType: 'int', title: 'Promo & referral codes', singular: 'code', group: 'Catalogue & pricing',
    blurb: 'Discount codes with optional start/expiry dates and usage caps. Referral codes are created automatically per customer.',
    read: 'bookings.read', write: 'finance.write', search: ['code', 'description'], orderBy: 'id DESC', filter: 'kind',
    fields: [
      f('code', 'Code', 'text', { required: true, list: true, upper: true, placeholder: 'EASTBOURNE10' }),
      f('kind', 'Kind', 'select', { options: ['promo', 'referral'], def: 'promo', list: true }),
      f('discount_type', 'Discount', 'select', { options: [['percent', 'Percent off'], ['fixed', 'Fixed amount off']], def: 'percent', list: true }),
      f('value', 'Value', 'int', { required: true, list: true, help: 'Percent: 10 = 10%. Fixed: pence, e.g. 1500 = £15.' }),
      f('description', 'Description', 'text'),
      f('min_spend', 'Minimum spend', 'money', { def: 0 }),
      f('starts_on', 'Starts on', 'date'),
      f('expires_on', 'Expires on', 'date', { list: true }),
      f('max_uses', 'Maximum uses', 'int', { help: 'Leave blank for unlimited.' }),
      f('used_count', 'Times used', 'int', { def: 0, list: true }),
      active,
    ],
  },
  {
    key: 'blocked_dates', table: 'blocked_dates', pk: 'date', pkType: 'text', title: 'Blocked dates', singular: 'blocked date', group: 'Catalogue & pricing',
    blurb: 'Days the mobile lab is unavailable (holidays, training, van servicing).',
    read: 'bookings.read', write: 'bookings.write', search: ['date', 'reason'], orderBy: 'date DESC',
    fields: [f('date', 'Date', 'date', { required: true, list: true, lockOnEdit: true }), f('reason', 'Reason', 'text', { list: true })],
  },

  // ── Customers ──
  {
    key: 'customers', table: 'customers', pk: 'id', pkType: 'int', title: 'Customers', singular: 'customer', group: 'Customers',
    blurb: 'Everyone who has booked, with contact details and permanent notes.',
    read: 'crm.read', write: 'crm.write', search: ['name', 'email', 'phone', 'postcode', 'company'], orderBy: 'id DESC',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('email', 'Email', 'email', { list: true }),
      f('phone', 'Phone', 'tel', { list: true }),
      f('company', 'Company', 'text'),
      f('address', 'Address', 'textarea'),
      f('postcode', 'Postcode', 'text', { list: true, upper: true }),
      f('tags', 'Tags', 'text', { placeholder: 'trade, vip' }),
      f('notes', 'Permanent client notes', 'textarea'),
      f('loyalty_points', 'Loyalty points', 'int', { def: 0, list: true }),
      f('marketing_opt_in', 'Opted in to reminders & offers', 'bool'),
    ],
  },
  {
    key: 'vehicles', table: 'vehicles', pk: 'id', pkType: 'int', title: 'Vehicles', singular: 'vehicle', group: 'Customers',
    blurb: 'Vehicle records keyed by registration. Service history follows the plate permanently.',
    read: 'crm.read', write: 'crm.write', search: ['reg', 'make', 'model', 'vin'], orderBy: 'id DESC',
    fields: [
      f('reg', 'Registration', 'text', { required: true, list: true, upper: true }),
      f('make', 'Make', 'text', { list: true }),
      f('model', 'Model', 'text', { list: true }),
      f('year', 'Year', 'int', { list: true }),
      f('fuel', 'Fuel', 'text'),
      f('colour', 'Colour', 'text'),
      f('vin', 'VIN', 'text', { upper: true }),
      f('size', 'Size class', 'select', { options: [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']], def: 'M' }),
      f('body', 'Body style', 'select', { options: ['hatchback', 'saloon', 'suv', 'van'], def: 'hatchback' }),
      f('mot_due', 'MOT due', 'date', { list: true }),
      f('customer_id', 'Customer ID', 'int'),
      f('notes', 'Permanent vehicle notes', 'textarea'),
    ],
  },
  {
    key: 'partners', table: 'partners', pk: 'id', pkType: 'int', title: 'Trade & recovery partners', singular: 'partner', group: 'Customers',
    blurb: 'Bodyshops, auctions, garages and recovery firms. Bookings quoting a partner code accrue commission.',
    read: 'crm.read', write: 'crm.write', search: ['name', 'code', 'contact_name'], orderBy: 'name', filter: 'kind', financeFields: ['commission_pct'],
    fields: [
      f('name', 'Business name', 'text', { required: true, list: true }),
      f('kind', 'Type', 'select', { options: ['bodyshop', 'auction', 'garage', 'fleet', 'recovery', 'other'], list: true }),
      f('code', 'Partner code', 'text', { required: true, list: true, upper: true, help: 'Customers or partners quote this when booking.' }),
      f('contact_name', 'Contact', 'text', { list: true }),
      f('phone', 'Phone', 'tel', { list: true }),
      f('email', 'Email', 'email'),
      f('website', 'Website', 'url'),
      f('commission_pct', 'Referral commission %', 'percent', { def: 10, list: true }),
      f('customer_discount_pct', 'Discount for their customers %', 'percent', { def: 0 }),
      f('public_listing', 'List on the public recovery partners page', 'bool'),
      f('notes', 'Collaboration notes', 'textarea'),
      active,
    ],
  },
  {
    key: 'subscriptions', table: 'subscriptions', pk: 'id', pkType: 'int', title: 'Subscriptions', singular: 'subscription', group: 'Customers',
    blurb: 'Active maintenance plans. The next visit is booked automatically a week ahead.',
    read: 'crm.read', write: 'crm.write', search: ['postcode', 'notes'], orderBy: 'id DESC', filter: 'status', financeFields: ['price'],
    fields: [
      f('customer_id', 'Customer ID', 'int', { required: true, list: true }),
      f('vehicle_id', 'Vehicle ID', 'int', { list: true }),
      f('plan_id', 'Plan ID', 'int', { required: true, list: true }),
      f('status', 'Status', 'select', { options: ['active', 'paused', 'cancelled'], def: 'active', list: true }),
      f('preferred_slot', 'Preferred window', 'select', { options: ['morning', 'afternoon', 'evening'], def: 'morning' }),
      f('price', 'Price per visit', 'money', { list: true, def: 0 }),
      f('next_visit_on', 'Next visit', 'date', { list: true }),
      f('address', 'Address', 'textarea'),
      f('postcode', 'Postcode', 'text', { upper: true }),
      f('notes', 'Notes', 'textarea'),
    ],
  },

  // ── Finance & stock ──
  {
    key: 'expenses', table: 'expenses', pk: 'id', pkType: 'int', title: 'Expenses', singular: 'expense', group: 'Finance & stock',
    blurb: 'Parts, fluids, chemicals and overheads. Link an expense to a job to see its true net profit.',
    read: 'finance.read', write: 'finance.write', search: ['description', 'supplier'], orderBy: 'spent_on DESC, id DESC', filter: 'category',
    fields: [
      f('description', 'Description', 'text', { required: true, list: true }),
      f('category', 'Category', 'select', { options: ['parts', 'fluids', 'chemicals', 'fuel', 'tools', 'licences', 'insurance', 'marketing', 'vehicle', 'other'], def: 'parts', list: true }),
      f('amount', 'Amount (inc. VAT)', 'money', { required: true, list: true }),
      f('vat_amount', 'Of which VAT', 'money', { def: 0 }),
      f('qty', 'Quantity', 'number', { def: 1 }),
      f('supplier', 'Supplier', 'text', { list: true }),
      f('spent_on', 'Date', 'date', { required: true, list: true, def: 'today' }),
      f('booking_id', 'Job ID (optional)', 'int', { list: true, help: 'Links this cost to a booking for per-job profit.' }),
      f('inventory_id', 'Stock item ID (optional)', 'int', { help: 'Deducts the quantity from stock when saved.' }),
    ],
  },
  {
    key: 'inventory', table: 'inventory', pk: 'id', pkType: 'int', title: 'Stock & chemicals', singular: 'stock item', group: 'Finance & stock',
    blurb: 'Detailing chemicals, pads, fluids and diagnostic tokens. You are alerted when anything drops below its minimum.',
    read: 'bookings.read', write: 'inventory.write', search: ['name', 'supplier'], orderBy: 'name', filter: 'category', financeFields: ['unit_cost'],
    fields: [
      f('name', 'Item', 'text', { required: true, list: true }),
      f('category', 'Category', 'select', { options: ['chemical', 'consumable', 'part', 'fluid', 'tool', 'token'], def: 'chemical', list: true }),
      f('stock', 'In stock', 'number', { required: true, list: true }),
      f('min_stock', 'Alert below', 'number', { required: true, list: true }),
      f('unit', 'Unit', 'text', { def: 'units', list: true, placeholder: 'litres, pads, tokens' }),
      f('unit_cost', 'Unit cost', 'money', { def: 0 }),
      f('supplier', 'Supplier', 'text'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'licences', table: 'licences', pk: 'id', pkType: 'int', title: 'Licences & tokens', singular: 'licence', group: 'Finance & stock',
    blurb: 'Diagnostic hardware subscriptions, software licences, insurance and certifications with expiry alerts.',
    read: 'tech.read', write: 'tech.write', search: ['name', 'vendor', 'serial'], orderBy: 'expires_on', filter: 'kind', financeFields: ['annual_cost'],
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('vendor', 'Vendor', 'text', { list: true }),
      f('kind', 'Kind', 'select', { options: ['software', 'hardware', 'tokens', 'insurance', 'certification', 'other'], def: 'software', list: true }),
      f('serial', 'Serial / account', 'text'),
      f('expires_on', 'Expires on', 'date', { list: true }),
      f('tokens_left', 'Tokens remaining', 'int', { list: true }),
      f('annual_cost', 'Annual cost', 'money', { def: 0 }),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'parts_requests', table: 'parts_requests', pk: 'id', pkType: 'int', title: 'Parts orders', singular: 'parts request', group: 'Finance & stock',
    blurb: 'Supplier request lists generated from diagnostic findings. Send by email or WhatsApp, then track to fitted.',
    read: 'bookings.read', write: 'bookings.write', search: ['supplier', 'vehicle_reg', 'notes'], orderBy: 'id DESC', filter: 'status',
    fields: [
      f('vehicle_reg', 'Vehicle reg', 'text', { list: true, upper: true }),
      f('booking_id', 'Job ID', 'int', { list: true }),
      f('supplier', 'Supplier', 'text', { list: true }),
      f('supplier_contact', 'Supplier email or phone', 'text'),
      f('status', 'Status', 'select', { options: ['draft', 'requested', 'ordered', 'received', 'fitted', 'cancelled'], def: 'draft', list: true }),
      f('items', 'Parts', 'rows', { columns: [{ key: 'description', label: 'Part', width: 3 }, { key: 'part_no', label: 'Part no.', width: 2 }, { key: 'qty', label: 'Qty', type: 'number', width: 1 }, { key: 'dtc', label: 'For fault', width: 1 }] }),
      f('notes', 'Notes for supplier', 'textarea'),
    ],
  },
  {
    key: 'commissions', table: 'commissions', pk: 'id', pkType: 'int', title: 'Partner commissions', singular: 'commission', group: 'Finance & stock',
    blurb: 'Referral commission owed to trade partners, created automatically when a referred job completes.',
    read: 'finance.read', write: 'finance.write', search: [], orderBy: 'id DESC', filter: 'status',
    fields: [
      f('partner_id', 'Partner ID', 'int', { required: true, list: true }),
      f('booking_id', 'Job ID', 'int', { required: true, list: true }),
      f('amount', 'Amount', 'money', { required: true, list: true }),
      f('status', 'Status', 'select', { options: ['due', 'paid', 'void'], def: 'due', list: true }),
      f('paid_at', 'Paid on', 'date', { list: true }),
    ],
  },

  // ── Marketing ──
  {
    key: 'banners', table: 'banners', pk: 'id', pkType: 'int', title: 'Banners & seasonal promos', singular: 'banner', group: 'Marketing',
    blurb: 'Promo strips across the site. Seasonal banners switch on automatically in their months.',
    read: 'content.write', write: 'content.write', search: ['title', 'message'], orderBy: 'sort, id', filter: 'kind',
    fields: [
      f('title', 'Headline', 'text', { required: true, list: true }),
      f('message', 'Message', 'textarea'),
      f('kind', 'Kind', 'select', { options: [['promo', 'Promo strip'], ['seasonal', 'Seasonal promo'], ['emergency', 'Emergency hotline'], ['notice', 'Notice']], def: 'promo', list: true }),
      f('cta_label', 'Button label', 'text'),
      f('cta_href', 'Button link', 'text', { placeholder: '/book?promo=WINTER10' }),
      f('promo_code', 'Promo code to apply', 'text', { upper: true }),
      f('months', 'Show automatically in', 'months', { help: 'None selected = all year (subject to the dates below).', list: true }),
      f('starts_on', 'Starts on', 'date'),
      f('ends_on', 'Ends on', 'date'),
      active, sort,
    ],
  },
  {
    key: 'faqs', table: 'faqs', pk: 'id', pkType: 'int', title: 'FAQs', singular: 'FAQ', group: 'Marketing',
    blurb: 'Published with FAQ schema markup so answers can appear directly in Google results.',
    read: 'content.write', write: 'content.write', search: ['question', 'answer'], orderBy: 'sort, id', filter: 'category',
    fields: [f('question', 'Question', 'text', { required: true, list: true }), f('answer', 'Answer', 'textarea', { required: true }), f('category', 'Category', 'text', { def: 'General', list: true }), active, sort],
  },
  {
    key: 'towns', table: 'towns', pk: 'slug', pkType: 'text', title: 'Town landing pages', singular: 'town page', group: 'Marketing',
    blurb: 'Local SEO pages such as /eastbourne and /hastings, each with its own copy and coverage details.',
    read: 'content.write', write: 'content.write', search: ['name', 'slug', 'postcodes'], orderBy: 'sort, name',
    fields: [
      f('slug', 'URL slug', 'text', { required: true, list: true, lockOnEdit: true, help: 'The page lives at /your-slug' }),
      f('name', 'Town name', 'text', { required: true, list: true }),
      f('headline', 'Headline', 'text'),
      f('intro', 'Intro paragraph', 'textarea'),
      f('postcodes', 'Postcode districts', 'text', { list: true, placeholder: 'BN20, BN21, BN22, BN23' }),
      f('areas', 'Neighbourhoods covered', 'text', { placeholder: 'Old Town, Meads, Sovereign Harbour' }),
      f('lat', 'Latitude', 'number'),
      f('lng', 'Longitude', 'number'),
      f('body', 'Local copy', 'markdown', { help: 'Blank line between paragraphs. Lines starting with ## become headings, - become bullets.' }),
      active, sort,
    ],
  },
  {
    key: 'fleet_portals', table: 'fleet_portals', pk: 'slug', pkType: 'text', title: 'Fleet & trade portals', singular: 'portal', group: 'Marketing',
    blurb: 'Branded booking sub-portals at /fleet/your-slug with the client’s logo, colour and agreed discount.',
    read: 'content.write', write: 'content.write', search: ['company_name', 'slug'], orderBy: 'company_name',
    fields: [
      f('slug', 'URL slug', 'text', { required: true, list: true, lockOnEdit: true }),
      f('company_name', 'Company name', 'text', { required: true, list: true }),
      f('logo_media_id', 'Company logo', 'media', { accept: 'image/*' }),
      f('accent', 'Accent colour', 'color', { def: '#e11d48' }),
      f('headline', 'Headline', 'text'),
      f('intro', 'Intro', 'textarea'),
      f('discount_pct', 'Agreed discount %', 'percent', { def: 0, list: true }),
      f('contact_name', 'Their fleet contact', 'text'),
      f('partner_id', 'Linked partner ID', 'int'),
      active,
    ],
  },
  {
    key: 'guides', table: 'guides', pk: 'slug', pkType: 'text', title: 'Guides & articles', singular: 'guide', group: 'Marketing',
    blurb: 'Seasonal maintenance guides published at /guides.',
    read: 'content.write', write: 'content.write', search: ['title', 'excerpt'], orderBy: 'published_on DESC', filter: 'season',
    fields: [
      f('slug', 'URL slug', 'text', { required: true, lockOnEdit: true }),
      f('title', 'Title', 'text', { required: true, list: true }),
      f('excerpt', 'Excerpt', 'textarea'),
      f('category', 'Category', 'text', { def: 'Detailing', list: true }),
      f('season', 'Season', 'select', { options: ['all', 'winter', 'spring', 'summer', 'autumn'], def: 'all', list: true }),
      f('read_minutes', 'Read time (min)', 'int', { def: 4 }),
      f('published_on', 'Published on', 'date', { list: true, def: 'today' }),
      f('body', 'Article', 'markdown', { help: 'Blank line between paragraphs. ## for headings, - for bullets.' }),
      active,
    ],
  },
  {
    key: 'gallery_items', table: 'gallery_items', pk: 'id', pkType: 'int', title: 'Lab gallery', singular: 'gallery item', group: 'Marketing',
    blurb: 'Photos, before/after sliders, video walkthroughs and social posts. Upload straight from your phone.',
    read: 'content.write', write: 'content.write', search: ['title', 'caption', 'tags'], orderBy: 'sort, id DESC', filter: 'kind',
    fields: [
      f('kind', 'Type', 'select', { options: [['photo', 'Photo'], ['before_after', 'Before / after photos'], ['video', 'Video clip'], ['before_after_video', 'Before / after videos'], ['social', 'Instagram / TikTok / YouTube post']], def: 'photo', list: true }),
      f('title', 'Title', 'text', { list: true }),
      f('caption', 'Caption', 'textarea'),
      f('tags', 'Tags', 'text', { placeholder: 'paint correction, ceramic, bmw', list: true }),
      f('media_id', 'Photo or video', 'media', { accept: 'image/*,video/mp4,video/webm,video/quicktime' }),
      f('before_media_id', 'Before', 'media', { accept: 'image/*,video/mp4,video/webm,video/quicktime' }),
      f('after_media_id', 'After', 'media', { accept: 'image/*,video/mp4,video/webm,video/quicktime' }),
      f('embed_url', 'Post URL', 'url', { help: 'Instagram, TikTok or YouTube link (for social items).' }),
      f('featured', 'Feature on the home page', 'bool'),
      f('visible', 'Visible', 'bool', { def: true, list: true }),
      sort,
    ],
  },
  {
    key: 'reviews', table: 'reviews', pk: 'id', pkType: 'int', title: 'Reviews & feedback', singular: 'review', group: 'Marketing',
    blurb: 'Customer feedback and Google reviews, with sentiment scoring. Only genuine reviews you mark visible are published.',
    read: 'content.write', write: 'content.write', search: ['author', 'body'], orderBy: 'reviewed_on DESC, id DESC', filter: 'source',
    fields: [
      f('author', 'Reviewer', 'text', { required: true, list: true }),
      f('rating', 'Rating (1–5)', 'int', { required: true, list: true }),
      f('body', 'Review', 'textarea'),
      f('vehicle', 'Vehicle', 'text'),
      f('source', 'Source', 'select', { options: ['site', 'google'], def: 'site', list: true }),
      f('reviewed_on', 'Date', 'date', { list: true, def: 'today' }),
      f('visible', 'Published on the site', 'bool', { list: true }),
      f('sentiment', 'Sentiment', 'text', { list: true }),
      f('sentiment_summary', 'Sentiment notes', 'textarea'),
    ],
  },
  {
    key: 'chatbot_rules', table: 'chatbot_rules', pk: 'id', pkType: 'int', title: 'Chat auto-replies', singular: 'auto-reply', group: 'Marketing',
    blurb: 'Instant answers the chat assistant gives when you are not in the inbox. Pricing, coverage and hours answers are generated from live settings.',
    read: 'content.write', write: 'content.write', search: ['keywords', 'answer'], orderBy: 'sort, id',
    fields: [f('keywords', 'Keywords', 'text', { required: true, list: true, help: 'Comma-separated. Any match triggers the reply.' }), f('answer', 'Reply', 'textarea', { required: true }), active, sort],
  },

  // ── Workshop library ──
  {
    key: 'dtc_codes', table: 'dtc_codes', pk: 'code', pkType: 'text', title: 'Fault code library', singular: 'fault code', group: 'Workshop library',
    blurb: 'OBD-II trouble codes with probable causes and fixes. Also powers the public fault-code lookup.',
    read: 'tech.read', write: 'tech.write', search: ['code', 'title', 'system', 'causes'], orderBy: 'code', filter: 'severity',
    fields: [
      f('code', 'Code', 'text', { required: true, list: true, lockOnEdit: true, upper: true }),
      f('title', 'Definition', 'text', { required: true, list: true }),
      f('system', 'System', 'text', { required: true, list: true }),
      f('severity', 'Severity', 'select', { options: [['info', 'Low — monitor'], ['amber', 'Amber — book soon'], ['red', 'Red — stop driving']], def: 'amber', list: true }),
      f('causes', 'Probable causes', 'textarea'),
      f('fixes', 'Diagnostic route & fix', 'textarea'),
      f('package_slug', 'Recommended package (slug)', 'text'),
      f('public', 'Show on the public lookup', 'bool', { def: true }),
    ],
  },
  {
    key: 'coding_matrix', table: 'coding_matrix', pk: 'id', pkType: 'int', title: 'OEM coding matrix', singular: 'coding entry', group: 'Workshop library',
    blurb: 'Quick reference of coding parameters by manufacturer and platform.',
    read: 'tech.read', write: 'tech.write', search: ['make_group', 'platform', 'feature', 'module', 'parameter'], orderBy: 'make_group, feature', filter: 'make_group',
    fields: [
      f('make_group', 'Manufacturer', 'select', { options: ['BMW / MINI', 'VAG', 'Ford', 'Land Rover', 'Mercedes-Benz', 'Other'], required: true, list: true }),
      f('platform', 'Platform / chassis', 'text', { list: true }),
      f('feature', 'Feature', 'text', { required: true, list: true }),
      f('module', 'Module', 'text', { list: true }),
      f('parameter', 'Parameter / address', 'text'),
      f('tool', 'Tool', 'text', { list: true }),
      f('notes', 'Notes', 'textarea'),
      f('public', 'Show on the public coding page', 'bool', { def: true }),
    ],
  },
  {
    key: 'wiring_refs', table: 'wiring_refs', pk: 'id', pkType: 'int', title: 'Wiring & pinouts', singular: 'wiring reference', group: 'Workshop library',
    blurb: 'Gateway pinouts, connector views and links or uploads of common schematics.',
    read: 'tech.read', write: 'tech.write', search: ['make_model', 'title', 'detail'], orderBy: 'make_model',
    fields: [
      f('make_model', 'Vehicle', 'text', { required: true, list: true }),
      f('title', 'Reference', 'text', { required: true, list: true }),
      f('detail', 'Pinout / notes', 'textarea'),
      f('url', 'Link to schematic', 'url'),
      f('media_id', 'Upload schematic image', 'media', { accept: 'image/*' }),
    ],
  },
  {
    key: 'torque_specs', table: 'torque_specs', pk: 'id', pkType: 'int', title: 'Torque specs', singular: 'torque spec', group: 'Workshop library',
    blurb: 'Wheel nut, caliper and sump plug settings for quick mobile reference. Always confirm against OEM data.',
    read: 'tech.read', write: 'tech.write', search: ['make_model', 'notes'], orderBy: 'make_model',
    fields: [
      f('make_model', 'Vehicle', 'text', { required: true, list: true }),
      f('wheel_nm', 'Wheel nuts / bolts', 'text', { list: true }),
      f('caliper_nm', 'Caliper carrier', 'text', { list: true }),
      f('sump_nm', 'Sump plug', 'text', { list: true }),
      f('other', 'Other', 'textarea'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'tech_guides', table: 'tech_guides', pk: 'id', pkType: 'int', title: 'Procedures & guides', singular: 'guide', group: 'Workshop library',
    blurb: 'Step-by-step notes: CAN-bus resistance tests, injector coding, EPB service mode, air suspension calibration.',
    read: 'tech.read', write: 'tech.write', search: ['title', 'applies_to', 'body'], orderBy: 'category, sort', filter: 'category',
    fields: [
      f('title', 'Title', 'text', { required: true, list: true }),
      f('category', 'Category', 'select', { options: [['canbus', 'CAN-bus testing'], ['injector', 'Injector & IMA coding'], ['epb', 'Electronic parking brake'], ['air_suspension', 'Air suspension'], ['dpf', 'DPF & emissions'], ['battery', 'Battery & charging'], ['general', 'General']], required: true, list: true }),
      f('applies_to', 'Applies to', 'text', { list: true }),
      f('body', 'Procedure', 'markdown', { help: 'Numbered steps: start lines with 1. 2. 3. Headings: ##' }),
      sort,
    ],
  },
  {
    key: 'checklist_templates', table: 'checklist_templates', pk: 'id', pkType: 'int', title: 'Checklists & rubrics', singular: 'checklist', group: 'Workshop library',
    blurb: 'Templates for the pre-dispatch packing list, vehicle health check and the 50-point pre-purchase inspection.',
    read: 'tech.read', write: 'tech.write', search: ['name'], orderBy: 'kind, name', filter: 'kind',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('kind', 'Used for', 'select', { options: [['packing', 'Mobile lab packing list'], ['vhc', 'Vehicle health check'], ['ppi', 'Pre-purchase inspection'], ['pre_inspection', 'Pre-work walkaround']], required: true, list: true }),
      f('sections', 'Sections & items', 'sections', { help: 'Start a section with "# Section name", then one item per line.' }),
      active,
    ],
  },

  // ── Job logs ──
  {
    key: 'dpf_logs', table: 'dpf_logs', pk: 'id', pkType: 'int', title: 'DPF regeneration log', singular: 'DPF log', group: 'Job logs',
    blurb: 'Pre- and post-regeneration soot mass, differential pressure and temperatures for every DPF job.',
    read: 'tech.read', write: 'tech.write', search: ['reg', 'notes'], orderBy: 'logged_on DESC, id DESC', filter: 'result',
    fields: [
      f('reg', 'Registration', 'text', { required: true, list: true, upper: true }),
      f('logged_on', 'Date', 'date', { list: true, def: 'today' }),
      f('regen_type', 'Procedure', 'select', { options: [['forced_static', 'Forced static regen'], ['forced_dynamic', 'Forced dynamic (road) regen'], ['chemical_clean', 'Chemical clean + regen'], ['assessment_only', 'Assessment only']], list: true }),
      f('soot_pct_before', 'Soot load before (%)', 'number', { list: true }),
      f('soot_pct_after', 'Soot load after (%)', 'number', { list: true }),
      f('soot_g_before', 'Soot mass before (g)', 'number'),
      f('soot_g_after', 'Soot mass after (g)', 'number'),
      f('dp_mbar_before', 'Diff. pressure before (mbar)', 'number'),
      f('dp_mbar_after', 'Diff. pressure after (mbar)', 'number'),
      f('ash_g', 'Ash mass (g)', 'number'),
      f('max_egt_c', 'Peak EGT (°C)', 'int'),
      f('duration_min', 'Duration (min)', 'int'),
      f('km_since_regen', 'Distance since last regen (km)', 'int'),
      f('result', 'Result', 'select', { options: ['pass', 'partial', 'fail'], def: 'pass', list: true }),
      f('booking_id', 'Job ID', 'int'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'battery_tests', table: 'battery_tests', pk: 'id', pkType: 'int', title: 'Battery & alternator tests', singular: 'battery test', group: 'Job logs',
    blurb: 'State-of-health and charging-system results. Each test can be issued as a branded PDF certificate.',
    read: 'tech.read', write: 'tech.write', search: ['reg', 'notes'], orderBy: 'tested_on DESC, id DESC', filter: 'verdict',
    fields: [
      f('reg', 'Registration', 'text', { required: true, list: true, upper: true }),
      f('tested_on', 'Date', 'date', { list: true, def: 'today' }),
      f('battery_type', 'Battery type', 'select', { options: ['AGM', 'EFB', 'Flooded lead-acid', 'Lithium (LiFePO4)', 'Gel'], def: 'AGM' }),
      f('rated_cca', 'Rated CCA', 'int'),
      f('measured_cca', 'Measured CCA', 'int'),
      f('soh_pct', 'State of health (%)', 'number', { list: true }),
      f('soc_pct', 'State of charge (%)', 'number', { list: true }),
      f('resting_v', 'Resting voltage (V)', 'number'),
      f('cranking_v', 'Cranking voltage (V)', 'number'),
      f('charging_v_idle', 'Charging at idle (V)', 'number'),
      f('charging_v_load', 'Charging under load (V)', 'number'),
      f('ripple_mv', 'Alternator ripple (mV AC)', 'number'),
      f('verdict', 'Verdict', 'select', { options: [['pass', 'Pass'], ['monitor', 'Monitor'], ['replace', 'Replace']], def: 'pass', list: true }),
      f('booking_id', 'Job ID', 'int'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'flash_log', table: 'flash_log', pk: 'id', pkType: 'int', title: 'Software flash log', singular: 'flash record', group: 'Job logs',
    blurb: 'ECU / BCM software versions before and after every flash, update or module retrofit.',
    read: 'tech.read', write: 'tech.write', search: ['reg', 'module', 'part_number', 'version_after'], orderBy: 'flashed_on DESC, id DESC', filter: 'result',
    fields: [
      f('reg', 'Registration', 'text', { required: true, list: true, upper: true }),
      f('flashed_on', 'Date', 'date', { list: true, def: 'today' }),
      f('module', 'Module', 'text', { required: true, list: true, placeholder: 'PCM, BCM, APIM, TCM' }),
      f('part_number', 'Hardware / part no.', 'text'),
      f('version_before', 'Version before', 'text', { list: true }),
      f('version_after', 'Version after', 'text', { list: true }),
      f('tool', 'Tool', 'text', { placeholder: 'FORScan, Autel MP900-BT' }),
      f('result', 'Result', 'select', { options: [['success', 'Success'], ['failed', 'Failed'], ['rolled_back', 'Rolled back']], def: 'success', list: true }),
      f('booking_id', 'Job ID', 'int'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  {
    key: 'freeze_frames', table: 'freeze_frames', pk: 'id', pkType: 'int', title: 'Freeze-frame data', singular: 'snapshot', group: 'Job logs',
    blurb: 'Recorded live-data and freeze-frame snapshots captured during fault finding.',
    read: 'tech.read', write: 'tech.write', search: ['reg', 'dtc', 'title', 'notes'], orderBy: 'captured_on DESC, id DESC',
    fields: [
      f('reg', 'Registration', 'text', { required: true, list: true, upper: true }),
      f('captured_on', 'Date', 'date', { list: true, def: 'today' }),
      f('dtc', 'Fault code', 'text', { list: true, upper: true }),
      f('title', 'Snapshot title', 'text', { required: true, list: true, placeholder: 'Underboost at 2,400 rpm, 4th gear' }),
      f('data', 'Parameters', 'rows', { columns: [{ key: 'pid', label: 'Parameter', width: 3 }, { key: 'value', label: 'Value', width: 2 }, { key: 'unit', label: 'Unit', width: 1 }, { key: 'expected', label: 'Expected', width: 2 }] }),
      f('booking_id', 'Job ID', 'int'),
      f('notes', 'Interpretation', 'textarea'),
    ],
  },

  // ── System ──
  {
    key: 'locations', table: 'locations', pk: 'id', pkType: 'int', title: 'Locations', singular: 'location', group: 'System',
    blurb: 'Each base has its own travel bands, capacity, time zone and currency — ready for more vans and regions.',
    read: 'settings.write', write: 'settings.write', search: ['name', 'slug', 'region'], orderBy: 'id',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true }),
      f('slug', 'Slug', 'text', { required: true, list: true }),
      f('region', 'Region', 'text', { list: true }),
      f('lat', 'Base latitude', 'number', { required: true }),
      f('lng', 'Base longitude', 'number', { required: true }),
      f('timezone', 'Time zone', 'text', { def: 'Europe/London' }),
      f('currency', 'Currency (ISO code)', 'text', { def: 'GBP', upper: true, list: true }),
      f('travel_bands', 'Travel surcharge bands', 'rows', { columns: [{ key: 'upTo', label: 'Up to (miles)', type: 'number', width: 1 }, { key: 'fee', label: 'Fee', type: 'money', width: 1 }, { key: 'label', label: 'Label', width: 3 }], help: 'Distance is measured from the base coordinates above.' }),
      f('max_miles', 'Maximum distance (miles)', 'number', { def: 45 }),
      f('slot_capacity', 'Jobs per window', 'rows', { columns: [{ key: 'slot', label: 'Window (morning / afternoon / evening)', width: 3 }, { key: 'capacity', label: 'Jobs', type: 'number', width: 1 }] }),
      f('phone', 'Local phone', 'tel'),
      active,
    ],
  },
  {
    key: 'vans', table: 'vans', pk: 'id', pkType: 'int', title: 'Mobile lab vans', singular: 'van', group: 'System',
    blurb: 'Vehicles that can be dispatched and tracked live.',
    read: 'bookings.read', write: 'settings.write', search: ['name', 'reg'], orderBy: 'id',
    fields: [f('name', 'Name', 'text', { required: true, list: true }), f('reg', 'Registration', 'text', { list: true, upper: true }), f('location_id', 'Location ID', 'int', { def: 1, list: true }), active],
  },
  {
    key: 'webhooks', table: 'webhooks', pk: 'id', pkType: 'int', title: 'Webhooks', singular: 'webhook', group: 'System',
    blurb: 'Push events to Zapier, Make, n8n or accounting tools. Each delivery is signed with the secret (HMAC-SHA256).',
    read: 'settings.write', write: 'settings.write', search: ['name', 'url'], orderBy: 'id',
    fields: [
      f('name', 'Name', 'text', { required: true, list: true, placeholder: 'Zapier → Xero invoice' }),
      f('url', 'Endpoint URL', 'url', { required: true, list: true }),
      f('events', 'Events', 'multiselect', { options: ['*', ...WEBHOOK_EVENTS], help: '* sends everything.' }),
      f('secret', 'Signing secret', 'text', { help: 'Leave blank to generate one.' }),
      active,
    ],
  },
];

export const RESOURCE_MAP: Record<string, Resource> = Object.fromEntries(RESOURCES.map((r) => [r.key, r]));
export const optionValue = (o: string | [string, string]): string => (typeof o === 'string' ? o : o[0]);
export const optionLabel = (o: string | [string, string]): string => (typeof o === 'string' ? o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, ' ') : o[1]);
