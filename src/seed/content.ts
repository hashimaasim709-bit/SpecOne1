// Starting marketing content. All of it is editable under Admin → Marketing.

export const BANNERS = [
  { kind: 'promo', title: 'Combine two packages and save £15 — three or more, save £35', message: 'Fixed prices. Pay on completion.', cta_label: 'Book now', cta_href: '/book', promo_code: '', months: '[]', sort: 10 },
  { kind: 'seasonal', title: 'Winter freeze-check', message: 'Battery, charging and coolant health check before the cold snap — 10% off diagnostics with code WINTER10.', cta_label: 'Book a winter check', cta_href: '/book?package=pre-mot-health-scan&promo=WINTER10', promo_code: 'WINTER10', months: '[11,12,1,2]', sort: 20 },
  { kind: 'seasonal', title: 'Spring decontamination', message: 'Wash away a winter of road salt with a full decontamination and protection detail.', cta_label: 'See detailing', cta_href: '/services#detailing', promo_code: '', months: '[3,4,5]', sort: 30 },
  { kind: 'seasonal', title: 'Summer cabin refresh', message: 'Heated extraction and steam sanitisation before the holiday miles — and a fault scan before you set off.', cta_label: 'Book a refresh', cta_href: '/book?package=interior-deep-clean', promo_code: '', months: '[6,7,8]', sort: 40 },
  { kind: 'seasonal', title: 'Autumn protection', message: 'Seal the paint before the weather turns: machine polish and ceramic protection.', cta_label: 'Protect my paint', cta_href: '/book?package=ceramic-coating', promo_code: '', months: '[9,10]', sort: 50 },
  { kind: 'emergency', title: 'Stranded or stuck in limp mode?', message: 'Emergency mobile diagnostics across East Sussex.', cta_label: 'Call the hotline', cta_href: 'tel:', promo_code: '', months: '[]', sort: 5 },
];

export const FAQS = [
  { category: 'Mobile visits', question: 'Do you need mains electricity or water at my address?', answer: 'Diagnostics, coding, battery, ABS and DPF work need no mains power or water — we can work at your home, your workplace or at the roadside. Detailing and wet-extraction packages need driveway access, an outside tap and a 240V socket within about 25 metres. If that is not possible, choose the lab drop-off option when booking.' },
  { category: 'Mobile visits', question: 'Which areas do you cover?', answer: 'We are based in Eastbourne and cover East Sussex, including Polegate, Hailsham, Pevensey, Bexhill, Hastings, Seaford, Newhaven, Lewes, Brighton and Hove. Local call-outs are free; a small travel surcharge applies further out and is shown before you confirm.' },
  { category: 'Mobile visits', question: 'Can I follow the technician on the day?', answer: 'Yes. Your confirmation includes a live tracker link. When the mobile lab sets off you can watch it approach on a map with an estimated arrival time, then follow each stage of the job through to the finished report.' },
  { category: 'Coding & diagnostics', question: 'Is hidden-feature coding safe for my car?', answer: 'Yes. We only enable genuine factory options that already exist in your vehicle’s modules, using dealer-level tooling, and we always take a full configuration backup first so any change can be reversed.' },
  { category: 'Coding & diagnostics', question: 'My garage read the fault code — why do I need diagnostics?', answer: 'A fault code tells you which circuit or system reported a problem, not which part has failed. Pinpoint diagnostics tests the wiring, sensor signals and live data to find the actual cause, so you do not pay for parts you did not need.' },
  { category: 'Coding & diagnostics', question: 'Can you clear a blocked DPF at my home?', answer: 'In most cases, yes. We measure soot load and differential pressure, check for the underlying cause, then carry out a forced regeneration on site. If the filter is beyond regeneration we will tell you before doing chargeable work and explain the options.' },
  { category: 'Payment', question: 'When do I pay?', answer: 'On completion, once the work is finished and you are happy — by card, Apple Pay, Google Pay, cash or bank transfer. For high-value or full-day bookings you can optionally pay a deposit online to secure the slot.' },
  { category: 'Payment', question: 'Are your prices fixed?', answer: 'Yes. Every package has a fixed price shown before you book, with detailing priced by vehicle size. If diagnostics uncovers further work we explain it and agree any extra cost with you first.' },
  { category: 'Booking', question: 'How quickly can you come out?', answer: 'The booking calendar shows live availability, often including same-week slots. For urgent problems there is an emergency call-out option with priority dispatch, including evenings.' },
  { category: 'Booking', question: 'Can I book more than one vehicle?', answer: 'Yes — add up to five vehicles in a single booking and we will service them in one visit. Fleet and trade customers can ask for a dedicated booking portal with agreed rates.' },
];

export const TOWNS = [
  {
    slug: 'eastbourne', name: 'Eastbourne', lat: 50.768, lng: 0.2905, postcodes: 'BN20, BN21, BN22, BN23', sort: 10,
    areas: 'Old Town, Meads, Sovereign Harbour, Hampden Park, Willingdon, Langney, Roselands',
    headline: 'Mobile car diagnostics & coding in Eastbourne',
    intro: 'SpecOne Auto Labs is based in Eastbourne, so local call-outs are free and often available the same week. Dealer-level fault-finding, coding and detailing at your home or workplace.',
    body: '## Diagnostics on your driveway\nEngine management light on, limp mode on the A22 or a DPF warning after weeks of short runs around town? We bring the diagnostic equipment a main dealer uses to your address anywhere in Eastbourne.\n\n## Why Eastbourne drivers call us\n- Free call-out across BN20 to BN23\n- Fixed prices, shown before you book\n- No mains power or water needed for diagnostics and coding\n- Pay on completion\n\n## Short journeys and blocked DPFs\nTown driving rarely gets a diesel hot enough to clean its particulate filter. We measure soot load, find out why regeneration has been failing and clear the filter on site where possible.',
  },
  {
    slug: 'bexhill', name: 'Bexhill-on-Sea', lat: 50.8409, lng: 0.4676, postcodes: 'TN39, TN40, BN24', sort: 20,
    areas: 'Cooden, Little Common, Sidley, Pebsham, Pevensey Bay, Normans Bay',
    headline: 'Mobile diagnostics, coding & detailing in Bexhill',
    intro: 'Mobile fault-finding, OEM coding, DPF recovery and restorative detailing across Bexhill, Cooden and Pevensey — at your home, with no trip to a garage.',
    body: '## We come to you\nFrom Little Common to Sidley, the mobile lab arrives equipped for dealer-level diagnostics, key and module coding and full interior restoration.\n\n## Popular in Bexhill\n- Warning light and fault pinpointing\n- Apple CarPlay and Android Auto activation\n- Pre-MOT health and battery checks\n- Heated interior extraction\n\n## Coastal cars need protection\nSalt air is hard on paint and electrical connectors. Ask about ceramic protection and our seasonal health scans.',
  },
  {
    slug: 'hastings', name: 'Hastings & St Leonards', lat: 50.8543, lng: 0.5735, postcodes: 'TN34, TN35, TN37, TN38', sort: 30,
    areas: 'St Leonards, Ore, Hollington, Silverhill, Old Town, Fairlight',
    headline: 'Mobile ECU diagnostics & key coding in Hastings',
    intro: 'Specialist mobile fault pinpointing, module coding, key programming and cabin restoration across Hastings and St Leonards.',
    body: '## Hills, short trips and warning lights\nSteep, stop-start driving is tough on clutches, DPFs and batteries. We diagnose the cause properly, at your address, with a written report.\n\n## What we do in Hastings\n- Oscilloscope and live-data fault pinpointing\n- Replacement module and injector coding\n- Spare key and immobiliser programming\n- Deep interior cleaning and paint protection\n\n## Buying a used car locally?\nBook a pre-purchase inspection: a scored 50-point check, mileage verification across modules and a buyer’s PDF dossier before you hand over any money.',
  },
  {
    slug: 'brighton', name: 'Brighton & Hove', lat: 50.8225, lng: -0.1372, postcodes: 'BN1, BN2, BN3, BN7, BN25', sort: 40,
    areas: 'Hove, Kemptown, Falmer, Lewes, Newhaven, Seaford, Peacehaven',
    headline: 'Mobile car diagnostics & coding in Brighton',
    intro: 'An advanced mobile automotive laboratory covering Brighton, Hove, Lewes, Newhaven and Seaford along the A27 and A259.',
    body: '## Dealer-level work without the dealer\nNo waiting for a main-dealer slot or leaving your car in the city for the day. We diagnose, code and repair electronic faults at your home or workplace.\n\n## Emissions zones and AdBlue\nAdBlue countdown warnings and NOx sensor faults are common on modern diesels. We test the dosing system, sensors and heater circuits to find the real cause.\n\n## Popular in Brighton & Hove\n- Hidden-feature coding for BMW, MINI, Audi and VW\n- AdBlue and DPF diagnostics\n- Pre-purchase inspections\n- Ceramic coating and paint correction',
  },
];

export const GUIDES = [
  {
    slug: 'protect-paint-through-winter', title: 'How to protect your paint through a British winter', season: 'winter', category: 'Detailing', read_minutes: 4,
    excerpt: 'Road salt, grit and short days are hard on paintwork. A little preparation in autumn saves a lot of correction in spring.',
    body: '## Why winter is hard on paint\nGritting salt is corrosive and abrasive. It sits in wheel arches and along sills, and every wipe with a dirty sponge drags it across the clear coat.\n\n## Before the cold arrives\n- Decontaminate the paint: remove tar and bonded iron so protection can bond properly\n- Apply a durable sealant or ceramic coating — water and grime release far more easily\n- Treat door seals so they do not freeze shut\n\n## Washing in winter\n- Pre-rinse or snow-foam first so grit is lifted before you touch the paint\n- Use two buckets: one to wash, one to rinse the mitt\n- Rinse the arches and underside after gritted roads\n\n## What to avoid\nAutomatic brush washes and dry wiping are the main causes of swirl marks. Hot water on a frozen screen can crack it.\n\n## When to call us\nIf the paint already looks dull or feels rough after washing, a decontamination and machine polish will reset it before protection goes on.',
  },
  {
    slug: 'summer-interior-care', title: 'Summer interior care: heat, sunscreen and odours', season: 'summer', category: 'Detailing', read_minutes: 3,
    excerpt: 'High cabin temperatures bake spills into fabric and dry out leather. Here is how to keep the interior fresh.',
    body: '## Heat sets stains\nA spill left in a hot car bonds to the fibres within days. Blot it straight away with a damp microfibre — do not rub.\n\n## Sunscreen marks\nSunscreen leaves white marks on door cards and leather. Wipe with a mild interior cleaner as soon as you notice them.\n\n## Leather and plastics\n- Clean leather before conditioning it, otherwise you seal the dirt in\n- Use a UV-protectant dressing on the dashboard; avoid greasy silicone shines\n- A windscreen shade makes a real difference to cabin temperature\n\n## Smells from the vents\nA musty smell when the air conditioning starts usually means moisture in the system. Run the fan without A/C for the last few minutes of a journey, and replace the cabin filter yearly.\n\n## A proper reset\nHeated wet extraction lifts what a vacuum cannot, and steam sanitises vents and touch points without soaking the cabin.',
  },
  {
    slug: 'dpf-warning-light-what-to-do', title: 'DPF warning light on? What to do — and what not to', season: 'all', category: 'Diagnostics', read_minutes: 4,
    excerpt: 'A diesel particulate filter light is a request for help, not a breakdown. Acting early usually avoids an expensive replacement.',
    body: '## What the light means\nThe filter traps soot and burns it off during regeneration. The light means soot has built up faster than it could be burned.\n\n## First steps\n- If the car drives normally, a steady 20 to 30 minute run on a faster road may let it regenerate\n- Do not keep doing short trips with the light on\n- If the engine is in limp mode or other warnings are showing, stop and get it diagnosed\n\n## Why it keeps happening\nRepeated blocking nearly always has a cause: a faulty pressure sensor, a split hose, a stuck EGR valve, a thermostat that keeps the engine too cool, or simply the wrong oil.\n\n## What we do\nWe read the measured soot load and differential pressure, check the regeneration history and look for the root cause before forcing a regeneration — and we log the before and after figures on your vehicle record.',
  },
  {
    slug: 'spring-decontamination', title: 'Spring clean: getting a winter of salt off your car', season: 'spring', category: 'Detailing', read_minutes: 3,
    excerpt: 'A proper spring decontamination removes what normal washing leaves behind and sets the paint up for the year.',
    body: '## What is left after winter\nIron particles from brake dust, tar spots along the sills and a film of salt in every seam.\n\n## The decontamination process\n- Citrus pre-wash to loosen traffic film\n- Iron remover on paint and wheels\n- Tar remover on the lower panels\n- Clay to lift whatever is still bonded\n\n## Then protect\nClean paint is the best time to apply protection, because sealants and ceramic coatings bond far better to a decontaminated surface.\n\n## Do not forget underneath\nRinse arches and the underside thoroughly: that is where salt does its damage.',
  },
];

export const CHATBOT_RULES = [
  { keywords: 'warranty,guarantee', answer: 'Our workmanship is covered and every job comes with a written report. If a fault returns that relates to work we carried out, call us and we will put it right.', sort: 10 },
  { keywords: 'trade,fleet,taxi,company cars,account', answer: 'We look after trade and fleet vehicles with agreed rates, multi-vehicle visits and one monthly invoice. Tell us about your fleet at /fleet and we will set up a dedicated booking portal.', sort: 20 },
  { keywords: 'cancel,reschedule,change my booking,move my booking', answer: 'No problem — open the tracker link from your confirmation message, or reply to it, and we will move your slot. Please give as much notice as you can.', sort: 30 },
];
