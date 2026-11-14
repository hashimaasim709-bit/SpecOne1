// Customer how-to guides added after launch. Delivered once to existing databases with
// INSERT OR IGNORE, so guides edited or removed in the admin are never overwritten.

const G = (slug: string, title: string, category: string, read_minutes: number, excerpt: string, body: string) =>
  ({ slug, title, category, read_minutes, excerpt, body, season: 'all', published_on: '2026-11-14', active: 1 });

export const GUIDES_EXTRA = [
  G('engine-light-on-what-to-do', 'Engine management light on: what to do first', 'Warning lights', 4,
    'A steady amber engine light is rarely an emergency, but a flashing one is. Here is how to tell the difference and what to do next.',
    `## Steady or flashing?
- **Steady amber, car drives normally:** the engine computer has stored a fault. Keep journeys short and get it scanned in the next few days.
- **Flashing, or the car shakes and loses power:** that is usually a misfire. Ease off and stop when it is safe — unburnt fuel can overheat and damage the catalytic converter.
- **Light on with reduced power:** the car has put itself in limp mode to protect the engine. Drive gently and book a diagnostic.

## Quick checks you can do
- Is the fuel cap clicked shut? A loose cap can trigger the light on petrol cars.
- Any new noises, smells or smoke? Note them — they help pinpoint the fault.
- Did it start after refuelling, a jump start or very cold weather? Tell your technician.

## What not to do
- Do not just clear the code and hope. The fault usually returns, and the stored data that helps find the cause is wiped.
- Do not replace parts on a guess. A code names the circuit that noticed a problem, not the part that failed.

## How we find the cause
We read every module, look at live sensor readings and test the suspect circuit before recommending a repair. You get a written report either way. Not sure which light you have? Use the [warning-light guide](/warning-lights), or [book a diagnostic](/book?package=fault-pinpointing).`),

  G('limp-mode-explained', 'Limp mode explained: why your car has lost power', 'Warning lights', 4,
    'Limp mode is your car protecting itself. It is not a fault in itself, but it always has a cause worth finding.',
    `## What limp mode is
When the engine or gearbox computer sees a reading that could cause damage, it limits power and revs so you can get somewhere safe. You may be held in one gear, with the engine light or a "reduced power" message on.

## Common causes
- **Turbo boost faults:** split boost hoses, sticking turbo vanes or a failed boost sensor.
- **Diesel particulate filter:** a filter too full of soot to regenerate.
- **Sensors:** mass air flow, fuel rail pressure or throttle position readings that do not add up.
- **Gearbox:** low or tired fluid, or a solenoid fault.
- **Wiring:** chafed looms and corroded connectors, especially after wet weather.

## What to do
- Pull over when safe, switch off, wait a minute and restart. If it clears, the fault is intermittent — still get it checked, because it will come back.
- Avoid motorways and hard acceleration until it is diagnosed.
- If there is smoke, a hot smell or a red warning light, stop and call for help.

## Finding the real cause
Limp mode stores codes and a snapshot of what the engine was doing when it happened. We read that data, test under the same conditions and fix the cause rather than resetting the symptom. See [fault pinpointing](/services/fault-pinpointing), or for a stranded car use [emergency call-out](/emergency).`),

  G('adblue-warning-countdown-explained', 'AdBlue warnings and the "no start in" countdown', 'Warning lights', 4,
    'Modern diesels count down the miles until they refuse to restart. Topping up is often not the whole answer.',
    `## What AdBlue does
AdBlue is a fluid injected into the exhaust to turn harmful nitrogen oxides into nitrogen and water. The car monitors the tank level, the fluid quality and how well the system is working.

## The countdown
If the car decides the system is not working, it shows a message such as "no engine start in 500 miles". When that reaches zero the engine will not restart after you switch off. This is built in by law, not a fault with your car.

## First: top up properly
- Use fresh AdBlue from a sealed container.
- Add at least five litres — many cars will not register a small top-up.
- Drive for 10 to 20 minutes afterwards so the level sensor can update.

## If the warning stays on
The tank is full but the countdown continues? Then it is a system fault, commonly:
- a failed tank heater or pump module,
- a blocked or crystallised dosing injector,
- NOx sensors reading out of range,
- poor-quality or contaminated fluid.

## Do not leave it
Act while there are miles left. Once the countdown hits zero you need a recovery truck or a mobile visit. We test each part of the system and reset the countdown once the fault is fixed — see [AdBlue diagnostics](/services/adblue-diagnostics).`),

  G('battery-keeps-going-flat', 'Battery keeps going flat? How to find out why', 'Diagnostics', 5,
    'A new battery is not always the cure. Three things drain batteries, and each needs a different fix.',
    `## The three usual suspects
- **A tired battery.** Most last around five years. Short trips and cold weather finish off a weak one.
- **A charging fault.** If the alternator is not charging properly, even a new battery goes flat within days.
- **A parasitic drain.** Something stays awake when the car is locked — a module, a boot light, an aftermarket tracker or dash cam.

## Clues to which it is
- Slow cranking on cold mornings but fine after a drive: probably the battery.
- Battery light on, or lights that dim at idle: charging system.
- Fine if used daily, flat after two or three days parked: parasitic drain.

## Things to try
- Check the battery terminals are tight and free of white or green crust.
- Unplug chargers and accessories left in sockets.
- Make sure the car is actually going to sleep: no interior lights, no boot ajar.

## Modern cars need the battery registered
Many cars with start/stop must be told when a new battery is fitted, so the charging system treats it correctly. Skip that and a new battery can be over- or under-charged.

## How we test
We measure battery health, alternator output and ripple, then measure the current drawn with the car asleep and trace which circuit is taking it. You get a printed certificate with the results. See the [battery and alternator health check](/services/battery-health-addon).`),

  G('what-a-fault-code-really-tells-you', 'What a fault code really tells you (and what it does not)', 'Diagnostics', 4,
    'A code reader gives you a starting point, not an answer. Here is how to read one like a technician.',
    `## A code describes a symptom
Take P0171, "system too lean". The engine computer is saying it had to add more fuel than expected. It does not say why: an air leak, a weak fuel pump and a dirty air-flow sensor all produce the same code.

## Reading the letters and numbers
- **P** powertrain (engine and gearbox), **C** chassis (brakes, steering), **B** body (airbags, comfort), **U** network (modules not talking to each other).
- A second digit of **0** is a generic code that means the same on every car; **1** is manufacturer-specific.

## Why parts-swapping gets expensive
Replacing the part named in a code works some of the time. The rest of the time you have bought a sensor that was only reporting someone else's problem.

## What a proper diagnosis adds
- **Freeze-frame data:** what the engine was doing at the moment the fault was logged.
- **Live data:** watching sensors while the fault is happening.
- **Circuit tests:** checking the wiring, supply and signal with a meter or oscilloscope.

## Look yours up
Our [fault-code library](/fault-codes) explains common codes, their likely causes and how we would pinpoint them. Got a code and want a straight answer? [Send it to us](/contact?topic=warning).`),

  G('used-car-checks-before-you-buy', 'Buying a used car: checks worth doing before you pay', 'Buying & owning', 5,
    'Ten minutes of checks can save thousands. Here is what to look at yourself, and what needs proper equipment.',
    `## Before you travel
- Check the MOT history online using the registration: look for repeated advisories and mileage that goes down.
- Ask how many keys come with the car. A second key can be expensive to add later.
- Ask for the service history and look for gaps.

## At the car
- **Start it from cold.** A warm engine hides rattles, smoke and slow starting. Feel the bonnet when you arrive.
- **Warning lights:** every light should come on with the ignition and go out once started. A light that never comes on may have been disabled.
- **Tyres:** uneven wear points to suspension or alignment problems.
- **Panel gaps and paint:** mismatched shades or uneven gaps suggest accident repair.
- **Electrics:** try every window, the air conditioning, the screen, parking sensors and heated seats.

## On the test drive
- Listen for knocks over bumps and whines that change with speed.
- An automatic gearbox should change smoothly without flaring or thumping.
- Brake firmly from speed: the car should pull up straight with no judder.

## What you cannot see yourself
- Fault codes that have been cleared just before the viewing.
- Mileage recorded in other modules that does not match the dashboard.
- Paint thickness that reveals filler and resprays.

Our [pre-purchase inspection](/services/pre-purchase-inspection) covers those with a 50-point check, a full scan and a written report you can use to negotiate — at the seller's address, before you hand over the money.`),

  G('how-booking-and-tracking-works', 'How booking, tracking and paying work', 'Using SpecOne', 3,
    'From choosing a service to getting your report: every step, and what you will receive along the way.',
    `## 1. Book online in about a minute
Go to [Book a visit](/book). Enter your registration, pick your services and choose a day and a morning, afternoon or evening window. Prices are fixed and shown before you confirm. Your postcode works out any travel fee straight away.

## 2. Get your confirmation
You receive a confirmation with a private tracker link. Keep it — that link is how you follow the job, change your booking and download documents. No password needed.

## 3. Need to change the day?
Open your tracker and choose **Change date or time**. You will see the days and windows that are still free. Changes on the day itself need a quick call.

## 4. On the day
When the technician sets off, your tracker shows the van on a live map with an estimated arrival time. You will also see each stage: arrived, work in progress, complete.

## 5. If we find something extra
Extra work is never done without asking. It appears on your tracker as an estimate with a price, and you approve or decline it there.

## 6. Pay and get your report
Pay on completion by card, Apple Pay, Google Pay, cash or bank transfer. Your invoice and technical report appear on the tracker and in [My garage](/account), where they stay for every future visit.

## Questions?
Use the [contact page](/contact) or call — a technician answers, not a call centre.`),

  G('prepare-for-your-mobile-visit', 'How to prepare for your mobile visit', 'Using SpecOne', 2,
    'A few minutes of preparation means we can start straight away and finish sooner.',
    `## For every visit
- **Keys ready,** including the locking wheel nut key if you have one.
- **Space to work:** room to open the bonnet and at least one side of the car fully. A driveway, car park or quiet road is fine.
- **Tell us the symptoms:** when it happens, any warning lights, and anything changed recently such as a new battery or repair. Photos of the dashboard help.
- **Fuel:** at least a quarter of a tank if a road test or DPF regeneration is planned.

## For diagnostics and coding
- No mains power or water is needed — the mobile lab is self-contained.
- For coding, have the infotainment PIN or security code if your car uses one.
- Remove plug-in trackers or insurance boxes from the diagnostic socket if you can.

## For detailing
- We need an **outside tap** and a **240 V socket** within about 25 metres. No tap or socket? Choose lab drop-off when booking.
- Empty the car, including the boot and door pockets, and remove child seats so we can clean beneath them.
- Let us know about anything delicate: fresh paintwork, loose trim or aftermarket wraps.

## On the day
You do not need to stay with the car. Follow progress on your tracker, and we will message or call if we need you. See [how booking and tracking work](/guides/how-booking-and-tracking-works).`),

  G('understanding-your-diagnostic-report', 'How to read your diagnostic report', 'Using SpecOne', 3,
    'Your report is written to be understood. Here is what each section means and how to use it.',
    `## Where to find it
Open your tracker link or [My garage](/account) and choose **Technical report**. It is a PDF you can keep, print or forward to a garage or insurer.

## Job summary
The vehicle, date, technician and the services carried out. Check the registration and mileage are right — the report follows the car, which helps when you sell it.

## Findings and work carried out
The plain-English explanation: what we found, what we tested, what was fixed and what we recommend. If something needs a part or further work, it says so here with the reason.

## Fault codes referenced
Each code with its definition and probable causes. A code listed here is not automatically a fault that still exists — the findings section says which were live and which were historic.

## Live data and measurements
Depending on the job you may see:
- **DPF log:** soot load and pressure before and after a regeneration.
- **Battery results:** state of health, cranking performance and alternator output.
- **Software record:** module versions before and after coding.
- **Freeze-frame data:** sensor readings captured when a fault was stored.

## Sign-off
The walkaround notes and your signature confirm the condition of the car before work began.

## What to do with advisories
Advisories are things to plan for, not emergencies. Ask us anything that is unclear — [send a message](/contact?topic=existing) with your booking reference.`),
];
