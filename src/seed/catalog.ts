// Starting catalogue, carried over from the original SpecOne price list (prices in pence).
// Everything here is editable in the admin once seeded.

const P = (
  slug: string, category: 'diagnostics' | 'detailing' | 'plan' | 'addon', zone: string, badge: string, name: string, summary: string, includes: string[],
  duration_min: number, prices: [number, number, number], flags: { utilities?: boolean; mot?: boolean; featured?: boolean } = {},
) => ({
  slug, category, zone, badge, name, summary, includes: JSON.stringify(includes), duration_min,
  price_s: prices[0] * 100, price_m: prices[1] * 100, price_l: prices[2] * 100,
  needs_utilities: flags.utilities ? 1 : 0, mot_reminder: flags.mot ? 1 : 0, featured: flags.featured ? 1 : 0,
});

export const PACKAGES = [
  P('fault-scan', 'diagnostics', 'engine', 'Fast scan', 'All-Module Fault Scan & Warning Light Reset',
    'Full-system OBD interrogation across engine, ABS, SRS and body modules, with stored fault codes explained and cleared.',
    ['Every control module read, not just the engine ECU', 'Fault codes explained in plain English', 'Warning lights reset where safe to do so', 'No mains power or water needed'], 30, [60, 60, 60], { featured: true }),
  P('fault-pinpointing', 'diagnostics', 'engine', 'Lead engineer pick', 'Fault Pinpointing, Oscilloscope & Live Data Report',
    'First-principles electrical and CAN-bus fault isolation with live sensor graphing, oscilloscope capture and a written report.',
    ['Root-cause isolation rather than parts guessing', 'Live data and oscilloscope waveform capture', 'CAN-bus network integrity checks', 'PDF technical report with findings'], 60, [95, 95, 95], { featured: true }),
  P('feature-coding', 'diagnostics', 'dash', 'OEM feature coding', 'Hidden Feature Activation & Custom Coding',
    'Unlock factory features already built into your car: CarPlay / Android Auto, video in motion, digital dash layouts, folding mirrors and more.',
    ['BMW / MINI, VAG, Ford, Land Rover, Mercedes', 'Full configuration backup before any change', 'Start/stop memory, mirror fold, lighting options', 'Reversible at any time'], 60, [85, 85, 85], { featured: true }),
  P('module-coding', 'diagnostics', 'dash', 'Dealer toolchain', 'Module Retrofits, PMI, Injector & BMS Coding',
    'Programmable module installation, replacement ECU / BCM coding, injector correction coding and battery BMS registration.',
    ['Replacement module set-up and VIN coding', 'Injector IMA / correction values written', 'New battery registered to the BMS', 'Software versions logged for your records'], 60, [95, 95, 95]),
  P('abs-coding', 'diagnostics', 'chassis', 'Brake & chassis', 'ABS / ESP Module Recoding & Electronic Bleed',
    'VIN coding for replacement ABS modules, steering-angle calibration and automated hydraulic pump bleeding.',
    ['ABS / DSC / ESP module coding', 'Steering angle sensor calibration', 'Automated ABS pump bleed routine', 'Fixed price'], 60, [95, 95, 95]),
  P('key-programming', 'diagnostics', 'dash', 'Security & keys', 'Immobiliser & Smart Key Programming',
    'Transponder key coding, immobiliser pairing and instrument-cluster security synchronisation.',
    ['Spare and replacement keys coded', 'Ford PATS and KVM synchronisation', 'Proof of ownership required', 'From the price shown — varies by vehicle'], 60, [95, 95, 95]),
  P('dpf-regeneration', 'diagnostics', 'exhaust', 'Limp-mode recovery', 'DPF Assessment, Forced Regeneration & EGR Reset',
    'Live soot-mass and differential-pressure analysis, forced regeneration, counter reset and EGR adaptation.',
    ['Soot load and pressure measured before and after', 'Forced static or dynamic regeneration', 'DPF counters and EGR adaptations reset', 'Regeneration log added to your vehicle history'], 120, [130, 130, 130], { featured: true }),
  P('pre-mot-health-scan', 'diagnostics', 'chassis', 'Pre-MOT & battery', 'Pre-MOT Health, Emissions & Battery Scan',
    'OBD emissions-readiness check, battery state of health, alternator charging and ripple test, plus a full fault sweep.',
    ['Emissions monitors checked for MOT readiness', 'Battery SOH and alternator test with certificate', 'All-module fault sweep', 'Reminder before next year’s test'], 45, [70, 70, 70], { mot: true }),
  P('adblue-diagnostics', 'diagnostics', 'exhaust', 'SCR / emissions', 'AdBlue, EGR, NOx & SCR Diagnostics',
    'Pinpointing AdBlue no-start countdowns, NOx sensor heater faults and SCR dosing problems.',
    ['AdBlue countdown and no-start warnings', 'NOx sensor and dosing injector testing', 'EGR flow and position checks', 'Fixed price'], 60, [95, 95, 95]),
  P('pre-purchase-inspection', 'diagnostics', 'engine', '50-point buyer audit', 'Pre-Purchase Vehicle Inspection',
    'Mileage verification across control modules, a 50-point inspection rubric, live engine data, paint depth audit and road test.',
    ['50-point scored inspection', 'Mileage cross-checked across modules', 'Paint depth readings on every panel', 'Full buyer PDF dossier'], 90, [130, 130, 130]),

  P('winter-road-shield', 'detailing', 'paint', '+ free OBD scan', 'Winter Road-Shield Detail',
    'Citrus pre-wash, two-bucket contact wash, alloy fallout decontamination and a hydrophobic SiO2 top coat — with a free fault scan.',
    ['Safe pre-wash and contact wash', 'Wheel and arch decontamination', 'SiO2 hydrophobic protection', 'Complimentary OBD health scan'], 120, [70, 80, 95], { utilities: true }),
  P('interior-deep-clean', 'detailing', 'cabin', 'Wet extraction', 'Interior Deep Clean & Heated Wet Extraction',
    'Enzyme pre-spray, heated seat and carpet shampoo extraction, steam sanitisation and leather feed.',
    ['Heated extraction of seats and carpets', 'Steam sanitisation of touch points', 'Leather cleaned and fed', 'Glass and trim finished'], 210, [95, 110, 130], { utilities: true }),
  P('inside-out-restoration', 'detailing', 'cabin', 'Most popular', 'Deep Inside & Out Restoration',
    'Full heated interior extraction plus exterior iron and tar decontamination, gloss seal and a free OBD health check.',
    ['Everything in the Interior Deep Clean', 'Exterior chemical decontamination', 'Gloss sealant applied', 'Complimentary OBD health check'], 270, [135, 150, 175], { utilities: true, featured: true }),
  P('engine-bay-detail', 'detailing', 'engine', 'Sensor-safe', 'Engine Bay Steam Clean & Dress',
    'Degreaser agitation, low-pressure steam rinse and a non-greasy satin dress for plastics — safe around sensors.',
    ['Electrical components protected', 'Low-pressure steam, no jet wash', 'OEM satin finish, not greasy shine'], 60, [45, 55, 65]),
  P('headlight-restoration', 'detailing', 'paint', 'MOT pass optical', 'Headlight Restoration & UV Ceramic Seal',
    'Multi-stage wet sanding, machine compounding and a UV ceramic coating for cloudy or yellowed lenses.',
    ['Both headlights restored', 'Machine polished to clarity', 'UV ceramic coating to stop re-yellowing', 'Improves beam output for MOT'], 90, [50, 60, 70]),
  P('machine-polish', 'detailing', 'paint', 'Swirl removal', 'Single-Stage Machine Polish & Ceramic Sealant',
    'Chemical and clay decontamination followed by a dual-action machine polish and a 12-month ceramic sealant.',
    ['Three-stage decontamination', 'Removes the majority of light swirls', '12-month ceramic sealant', 'Typically a full day on site'], 420, [220, 250, 290], { utilities: true }),
  P('paint-correction', 'detailing', 'paint', 'Mirror correction', 'Multi-Stage Paint Correction',
    'Heavy cutting compound and refining stages for severe oxidation, wash marring and deeper clear-coat defects.',
    ['Cutting and refining stages', 'Paint depth measured throughout', 'For heavily marked or oxidised paint', 'One to two days depending on condition'], 480, [320, 360, 420], { utilities: true }),
  P('ceramic-coating', 'detailing', 'paint', '9H SiO2', '3-Year Ceramic Coating & Decontamination',
    'Full decontamination, enhancement polish and a high-solids 9H SiO2 ceramic coating for paint and wheels.',
    ['Enhancement machine polish', '9H ceramic on paint and wheels', 'Three-year hydrophobic protection', 'Aftercare guide included'], 480, [280, 320, 370], { utilities: true }),

  P('maintenance-club', 'plan', 'cabin', 'Club plan', 'Monthly Maintenance Club',
    'A scheduled monthly inside-and-out maintenance visit with seasonal diagnostic health scans included.',
    ['Monthly maintenance clean', 'Seasonal OBD health scans included', 'Priority booking slots', 'Pause or cancel any time'], 90, [65, 75, 90], { utilities: true }),
  P('fleet-pro-plan', 'plan', 'cabin', 'Commercial fleet', 'Taxi & Commercial Fleet Plan',
    'Fortnightly cabin sanitisation and extraction for working vehicles, with priority diagnostic support.',
    ['Fortnightly visits at your yard', 'Cabin sanitisation and extraction', 'Priority diagnostic call-outs', 'One monthly invoice'], 120, [145, 165, 185], { utilities: true }),

  P('health-scan-addon', 'addon', 'engine', 'Add-on', 'All-Module Diagnostic Health Scan (add-on)',
    'Add a complete fault interrogation and health report to any booking while we are on site.',
    ['Every module scanned', 'Written health summary'], 20, [40, 40, 40]),
  P('battery-health-addon', 'addon', 'chassis', 'Add-on', 'Battery & Alternator Health Certificate (add-on)',
    'State-of-health, cranking and charging-system test with a PDF certificate for your records.',
    ['Battery SOH and SOC', 'Alternator output and ripple', 'PDF certificate'], 15, [25, 25, 25]),
  P('cabin-sanitisation-addon', 'addon', 'cabin', 'Add-on', 'Cabin Steam Sanitisation (add-on)',
    'Steam sanitisation of vents, touch points and upholstery with an odour-neutralising treatment.',
    ['Vents and touch points steamed', 'Odour treatment'], 30, [30, 30, 30]),
].map((p, i) => ({ ...p, sort: (i + 1) * 10 }));

export const PLANS = [
  { slug: 'maintenance-club', name: 'Monthly Maintenance Club', summary: 'Monthly inside-and-out maintenance with seasonal health scans.', includes: JSON.stringify(['Monthly maintenance clean', 'Seasonal OBD health scans', 'Priority slots']), interval: 'monthly', price_s: 6500, price_m: 7500, price_l: 9000, package_slug: 'maintenance-club', audience: 'retail', sort: 10 },
  { slug: 'fleet-pro', name: 'Taxi & Commercial Fleet Plan', summary: 'Fortnightly sanitisation and priority diagnostics for working vehicles.', includes: JSON.stringify(['Fortnightly visits', 'Cabin sanitisation', 'Priority diagnostics']), interval: 'fortnightly', price_s: 14500, price_m: 16500, price_l: 18500, package_slug: 'fleet-pro-plan', audience: 'fleet', sort: 20 },
];

export const UPSELLS = [
  { trigger_category: 'diagnostics', trigger_package_slug: '', suggest_package_slug: 'battery-health-addon', message: 'While the scan tool is connected: add a battery and alternator health test with a PDF certificate.', sort: 10 },
  { trigger_category: '', trigger_package_slug: 'dpf-regeneration', suggest_package_slug: 'cabin-sanitisation-addon', message: 'A DPF regeneration takes a couple of hours on site — have the cabin steam-sanitised while it runs.', sort: 20 },
  { trigger_category: 'detailing', trigger_package_slug: '', suggest_package_slug: 'health-scan-addon', message: 'Add a full all-module diagnostic health scan while we are with your car.', sort: 30 },
  { trigger_category: '', trigger_package_slug: 'interior-deep-clean', suggest_package_slug: 'cabin-sanitisation-addon', message: 'Finish the deep clean with steam sanitisation of vents and touch points.', sort: 40 },
];

export const PRICING_RULES = [
  { name: 'Sunday call-out', weekdays: JSON.stringify([0]), slots: JSON.stringify([]), adjust_type: 'percent', value: 10, active: 0 },
  { name: 'Evening call-out', weekdays: JSON.stringify([]), slots: JSON.stringify(['evening']), adjust_type: 'fixed', value: 1000, active: 0 },
];

export const PROMOS = [
  { code: 'WINTER10', kind: 'promo', discount_type: 'percent', value: 10, description: 'Seasonal winter check promotion' },
  { code: 'EASTBOURNE10', kind: 'promo', discount_type: 'percent', value: 10, description: 'Local Eastbourne resident saving' },
];

export const PARTNERS = [
  { name: 'Pronto Cosmetics', kind: 'bodyshop', contact_name: '', phone: '', code: 'PRONTO', commission_pct: 10, notes: 'Eastbourne body shop — refers post-repair coding, calibration and detailing.' },
  { name: 'Eastbourne Car Auctions', kind: 'auction', contact_name: '', phone: '', code: 'ECA', commission_pct: 10, notes: 'Pre-sale diagnostics and buyer inspections.' },
  { name: 'Ali — partner technician', kind: 'garage', contact_name: 'Ali', phone: '', code: 'ALI', commission_pct: 15, notes: 'Local garage / mobile tech partner. Jobs can also be dispatched to Ali from the job card.' },
];

export const INVENTORY = [
  { name: 'Enzyme interior cleaner (5 L)', category: 'chemical', unit: 'litres', stock: 5, min_stock: 2 },
  { name: 'Touch-less pre-wash (5 L)', category: 'chemical', unit: 'litres', stock: 5, min_stock: 2 },
  { name: 'Wheel fallout remover (5 L)', category: 'chemical', unit: 'litres', stock: 5, min_stock: 1 },
  { name: 'pH-neutral shampoo (5 L)', category: 'chemical', unit: 'litres', stock: 5, min_stock: 2 },
  { name: '9H SiO2 ceramic coating (30 ml vial)', category: 'chemical', unit: 'vials', stock: 4, min_stock: 2 },
  { name: 'DPF regeneration additive', category: 'fluid', unit: 'bottles', stock: 3, min_stock: 2 },
  { name: 'DA polishing pads — cutting', category: 'consumable', unit: 'pads', stock: 6, min_stock: 3 },
  { name: 'DA polishing pads — finishing', category: 'consumable', unit: 'pads', stock: 6, min_stock: 3 },
  { name: 'Microfibre cloths', category: 'consumable', unit: 'cloths', stock: 40, min_stock: 15 },
  { name: 'Clay bar (100 g)', category: 'consumable', unit: 'bars', stock: 4, min_stock: 2 },
];

export const LICENCES = [
  { name: 'Autel MaxiPRO MP900-BT software subscription', vendor: 'Autel', kind: 'software', notes: 'Set the renewal date so you are warned 30 days before it lapses.' },
  { name: 'FORScan extended licence', vendor: 'FORScan', kind: 'software', notes: '' },
  { name: 'Public liability & tools-in-transit insurance', vendor: '', kind: 'insurance', notes: '' },
];

export const LOCATION = {
  slug: 'eastbourne', name: 'Eastbourne HQ', region: 'East Sussex', lat: 50.768, lng: 0.2905, timezone: 'Europe/London', currency: 'GBP',
  travel_bands: JSON.stringify([
    { upTo: 8, fee: 0, label: 'Zone 1 — free local call-out' },
    { upTo: 18, fee: 1000, label: 'Zone 2 — East Sussex' },
    { upTo: 45, fee: 2000, label: 'Zone 3 — extended Sussex' },
  ]),
  max_miles: 45,
  slot_capacity: JSON.stringify([{ slot: 'morning', capacity: 2 }, { slot: 'afternoon', capacity: 2 }, { slot: 'evening', capacity: 1 }]),
  phone: '07351 453451',
};

export const VAN = { location_id: 1, name: 'Mobile Lab 1', reg: '' };
