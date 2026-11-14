// Workshop reference library. Fault-code definitions follow the generic SAE J2012 / ISO 15031
// wording. Torque figures are carried over from the original SpecOne reference sheet and are
// a quick reminder only — always confirm against OEM data for the exact vehicle.

type Sev = 'info' | 'amber' | 'red';
const D = (code: string, system: string, title: string, causes: string, fixes: string, severity: Sev, package_slug: string) => ({ code, system, title, causes, fixes, severity, package_slug });
const pin = 'fault-pinpointing';

export const DTC_CODES = [
  D('P0087', 'Fuel system', 'Fuel rail / system pressure too low', 'Weak high-pressure pump, blocked fuel filter, injector leak-off, faulty pressure regulator or metering valve, low lift-pump supply.', 'Graph commanded vs actual rail pressure while cranking and under load; injector leak-off test; check low-pressure supply before condemning the pump.', 'red', pin),
  D('P0088', 'Fuel system', 'Fuel rail / system pressure too high', 'Sticking pressure control valve, restricted return line, faulty rail pressure sensor.', 'Compare sensor reading key-on engine-off (should be near zero); check return flow and regulator duty.', 'amber', pin),
  D('P0093', 'Fuel system', 'Fuel system leak detected — large leak', 'External high-pressure leak, injector stuck open, pressure relief valve leaking.', 'Visual inspection for diesel leaks first — do not drive. Then leak-off and relief-valve return test.', 'red', pin),
  D('P0100', 'Air metering', 'Mass or volume air flow circuit malfunction', 'MAF sensor failure, wiring or connector fault, blown supply fuse.', 'Check supply, ground and signal at the sensor; compare g/s reading at idle and at wide-open throttle against expected values.', 'amber', pin),
  D('P0101', 'Air metering', 'Mass air flow circuit range / performance', 'Contaminated MAF, intake leak after the sensor, blocked air filter, EGR stuck open.', 'Smoke-test the intake; compare MAF against calculated load; inspect filter and EGR position.', 'amber', pin),
  D('P0106', 'Air metering', 'Manifold absolute pressure range / performance', 'Blocked or split MAP sensor hose, sooted sensor, boost leak.', 'Compare MAP with barometric pressure key-on engine-off; clean or replace sensor; check for boost leaks.', 'amber', pin),
  D('P0113', 'Air metering', 'Intake air temperature sensor circuit high', 'Open circuit, unplugged sensor (often after air-box work), failed sensor.', 'Check the connector first; measure sensor resistance against temperature.', 'info', 'fault-scan'),
  D('P0117', 'Cooling', 'Engine coolant temperature sensor circuit low', 'Short to ground in wiring, failed sensor.', 'Unplug the sensor: reading should drop to minimum. If not, wiring is shorted.', 'amber', pin),
  D('P0128', 'Cooling', 'Coolant temperature below thermostat regulating temperature', 'Thermostat stuck open, low coolant, faulty temperature sensor.', 'Graph warm-up curve on a cold start. A slow rise that never reaches about 85–90°C points to the thermostat. Also a common cause of failed DPF regenerations.', 'amber', pin),
  D('P0171', 'Fuelling', 'System too lean (bank 1)', 'Intake air leak, weak fuel pressure, contaminated MAF, exhaust leak before the oxygen sensor.', 'Check fuel trims at idle and 2,500 rpm: trims that improve with revs suggest an air leak; trims that worsen suggest fuel delivery.', 'amber', pin),
  D('P0172', 'Fuelling', 'System too rich (bank 1)', 'Leaking injector, high fuel pressure, faulty MAF, saturated charcoal canister.', 'Review fuel trims and oxygen sensor response; check for fuel in the oil.', 'amber', pin),
  D('P0191', 'Fuel system', 'Fuel rail pressure sensor range / performance', 'Sensor drift, wiring resistance, genuine pressure fluctuation.', 'Check 5V reference and ground; compare sensor against mechanical or expected values.', 'amber', pin),
  D('P0234', 'Turbocharger', 'Turbocharger overboost condition', 'Sticking variable vanes, faulty boost control solenoid, split vacuum line to the actuator.', 'Graph requested vs actual boost; actuate the vane mechanism through full travel and check vacuum supply.', 'amber', pin),
  D('P0299', 'Turbocharger', 'Turbocharger underboost condition', 'Split intercooler or boost hose, sticking vanes, faulty boost solenoid, leaking actuator, blocked DPF.', 'Smoke or pressure-test the boost side; graph requested vs actual boost; bi-directional actuator test.', 'amber', pin),
  D('P0300', 'Ignition', 'Random / multiple cylinder misfire detected', 'Ignition coils or plugs, fuel delivery, vacuum leak, low compression.', 'Check misfire counters per cylinder; swap coils to see if the fault moves; relative compression test with the oscilloscope.', 'red', pin),
  D('P0301', 'Ignition', 'Cylinder 1 misfire detected', 'Coil, spark plug, injector or compression fault on cylinder 1.', 'Swap coil and plug to another cylinder and re-test; injector balance and compression checks.', 'red', pin),
  D('P0335', 'Engine speed', 'Crankshaft position sensor A circuit', 'Failed sensor, damaged reluctor ring, wiring fault.', 'Scope the sensor signal while cranking; check air gap and wiring continuity.', 'red', pin),
  D('P0340', 'Engine speed', 'Camshaft position sensor A circuit', 'Failed sensor, wiring fault, timing chain or belt stretched.', 'Scope cam and crank signals together to verify sensor output and timing correlation.', 'red', pin),
  D('P0380', 'Glow system', 'Glow plug / heater circuit A', 'Failed glow plug, glow control module or relay, wiring fault.', 'Measure each plug’s resistance and current draw; check module supply and control signal.', 'info', 'fault-scan'),
  D('P0401', 'EGR', 'Exhaust gas recirculation flow insufficient', 'Carbon-blocked EGR valve or cooler, faulty valve actuator, blocked passages.', 'Command the valve and watch MAF response; inspect and clean, then reset adaptations.', 'amber', 'dpf-regeneration'),
  D('P0402', 'EGR', 'Exhaust gas recirculation flow excessive', 'EGR valve stuck open, faulty position sensor.', 'Check commanded vs actual valve position; a stuck-open valve causes rough idle and heavy soot loading.', 'amber', 'dpf-regeneration'),
  D('P0404', 'EGR', 'Exhaust gas recirculation circuit range / performance', 'Sticking valve, worn position sensor, carbon build-up.', 'Run the valve through full travel with the scan tool and watch position feedback.', 'amber', 'dpf-regeneration'),
  D('P0420', 'Catalyst', 'Catalyst system efficiency below threshold (bank 1)', 'Aged catalytic converter, exhaust leak ahead of the downstream sensor, lazy oxygen sensor, engine running rich.', 'Compare upstream and downstream oxygen sensor waveforms; fix any misfire or fuelling fault before replacing the catalyst.', 'amber', pin),
  D('P0455', 'Evaporative', 'Evaporative emission system leak detected (large)', 'Loose or damaged filler cap, split hose, stuck-open purge valve.', 'Check the cap seal first; then smoke-test the EVAP system.', 'info', 'fault-scan'),
  D('P0471', 'Exhaust pressure', 'Exhaust pressure sensor range / performance', 'Blocked or split sensor pipe, failed sensor.', 'Inspect the sensor hoses for splits or soot blockage; compare reading with engine off.', 'amber', 'dpf-regeneration'),
  D('P0500', 'Vehicle speed', 'Vehicle speed sensor A', 'Wheel speed sensor fault, damaged reluctor ring, ABS module communication.', 'Compare all four wheel speeds on a short drive.', 'amber', 'abs-coding'),
  D('P0504', 'Brake switch', 'Brake switch A / B correlation', 'Misadjusted or failed brake light switch.', 'Watch both switch signals while pressing the pedal slowly; replace and adjust the switch.', 'info', 'fault-scan'),
  D('P0562', 'Charging', 'System voltage low', 'Weak battery, failing alternator, poor earth or charging cable connection.', 'Battery state-of-health test, then alternator output and ripple under load; volt-drop test the main cables.', 'amber', 'pre-mot-health-scan'),
  D('P0563', 'Charging', 'System voltage high', 'Faulty alternator regulator, battery sensor fault, incorrect battery registered.', 'Measure charging voltage at the battery; check BMS data and register the correct battery type.', 'amber', 'pre-mot-health-scan'),
  D('P0606', 'Control module', 'Control module processor', 'Internal ECU fault, low supply voltage, water ingress, poor earths.', 'Verify power and ground to the module under load before condemning it; check for software updates.', 'red', 'module-coding'),
  D('P0620', 'Charging', 'Generator control circuit', 'Alternator control wiring (LIN / PWM) fault, failed regulator.', 'Scope the alternator control line; check connector condition.', 'amber', pin),
  D('P0700', 'Transmission', 'Transmission control system (MIL request)', 'A fault is stored in the transmission control module.', 'Read the transmission module directly — this code only tells you to look there.', 'amber', 'fault-scan'),
  D('P2002', 'DPF', 'Diesel particulate filter efficiency below threshold (bank 1)', 'Soot overload, faulty differential pressure sensor, split pressure hose, stuck EGR, cracked filter.', 'Measure differential pressure at idle and 2,500 rpm; inspect sensor hoses; find the cause before forcing regeneration.', 'amber', 'dpf-regeneration'),
  D('P2263', 'Turbocharger', 'Turbocharger / supercharger boost system performance', 'Boost leak, sticking vanes, restricted exhaust (blocked DPF), faulty actuator.', 'Pressure-test the intake; check exhaust back-pressure and DPF soot load.', 'amber', pin),
  D('P242F', 'DPF', 'Diesel particulate filter restriction — ash accumulation', 'Filter has reached its ash capacity; ash cannot be burned off by regeneration.', 'Check calculated ash mass and mileage. Needs off-car cleaning or replacement, then ash counter reset.', 'red', 'dpf-regeneration'),
  D('P2452', 'DPF', 'Diesel particulate filter pressure sensor A circuit', 'Failed differential pressure sensor, wiring fault, blocked or melted hoses.', 'Check reading with engine off (should be near zero); inspect hoses; test wiring.', 'amber', 'dpf-regeneration'),
  D('P2458', 'DPF', 'Diesel particulate filter regeneration duration', 'Regeneration taking too long: low exhaust temperature, faulty temperature sensor, thermostat stuck open.', 'Check exhaust gas temperature sensors and coolant warm-up; review regeneration history.', 'amber', 'dpf-regeneration'),
  D('P2459', 'DPF', 'Diesel particulate filter regeneration frequency', 'Regenerating too often: short journeys, over-fuelling, EGR fault, pressure sensor drift.', 'Review distance between regenerations and driving pattern; check for the underlying soot source.', 'amber', 'dpf-regeneration'),
  D('P2463', 'DPF', 'Diesel particulate filter restriction — soot accumulation', 'Failed passive regenerations from short trips, faulty thermostat, boost leak, EGR fault.', 'Read measured soot mass; if within limits carry out a forced regeneration and reset counters after fixing the cause.', 'red', 'dpf-regeneration'),
  D('P204F', 'AdBlue / SCR', 'Reductant system performance (bank 1)', 'Crystallised dosing injector, poor-quality AdBlue, pump or pressure fault.', 'Check AdBlue quality with a refractometer; dosing test into a measuring vessel; check pump pressure.', 'red', 'adblue-diagnostics'),
  D('P20E8', 'AdBlue / SCR', 'Reductant pressure too low', 'Failing AdBlue pump, blocked filter or line, frozen or leaking system.', 'Run the pump pressure test; inspect lines and tank heater operation.', 'red', 'adblue-diagnostics'),
  D('P20EE', 'AdBlue / SCR', 'SCR NOx catalyst efficiency below threshold (bank 1)', 'Crystallised injector, faulty downstream NOx sensor, diluted AdBlue, exhaust leak.', 'Compare upstream and downstream NOx readings; dosing quantity test; check fluid concentration.', 'red', 'adblue-diagnostics'),
  D('P2200', 'AdBlue / SCR', 'NOx sensor circuit (bank 1 sensor 1)', 'Failed upstream NOx sensor or its control unit, wiring fault, water ingress.', 'Check sensor supply and CAN communication; confirm heater operation once exhaust is warm.', 'amber', 'adblue-diagnostics'),
  D('P229F', 'AdBlue / SCR', 'NOx sensor circuit range / performance (bank 1 sensor 2)', 'Downstream NOx sensor drift or failure, exhaust leak, SCR not converting.', 'Compare both NOx sensors at steady cruise; verify dosing before replacing the sensor.', 'amber', 'adblue-diagnostics'),
  D('U0001', 'Network', 'High speed CAN communication bus', 'Open or shorted CAN wiring, failed module pulling the bus down, corroded connector.', 'Measure bus resistance (about 60 ohms) and scope CAN-high and CAN-low; unplug modules one at a time to isolate.', 'red', pin),
  D('U0073', 'Network', 'Control module communication bus off', 'Bus shorted or overloaded, faulty module, water ingress.', 'Resistance and oscilloscope checks on the affected bus; inspect for water in connectors and module locations.', 'red', pin),
  D('U0100', 'Network', 'Lost communication with ECM / PCM A', 'Engine ECU power or ground fault, CAN wiring fault, termination resistance fault, wet connector.', 'Verify ECU supplies and grounds; 60-ohm bus resistance test; oscilloscope capture of bus activity.', 'red', pin),
  D('U0101', 'Network', 'Lost communication with TCM', 'Transmission module power, ground or CAN fault.', 'Check module fuses and supplies; test CAN continuity to the module connector.', 'red', pin),
  D('U0121', 'Network', 'Lost communication with ABS control module', 'Blown ABS fuse, corroded module connector, open CAN circuit.', 'Check ABS supplies and grounds under load; inspect the multi-plug; CAN continuity test.', 'red', 'abs-coding'),
  D('U0140', 'Network', 'Lost communication with body control module', 'BCM power or ground fault, water ingress, CAN fault.', 'Check for water in the BCM area; verify supplies; network test.', 'red', pin),
  D('U0155', 'Network', 'Lost communication with instrument panel cluster', 'Cluster supply or CAN fault, internal cluster failure.', 'Verify cluster power, ground and bus signals at its connector.', 'amber', pin),
  D('U0401', 'Network', 'Invalid data received from ECM / PCM A', 'Another fault in the engine ECU is causing implausible data, software mismatch after module replacement.', 'Read and fix engine ECU faults first; check module software levels and coding.', 'amber', 'module-coding'),
  D('C0035', 'ABS', 'Left front wheel speed sensor circuit', 'Failed sensor, damaged wiring at the hub, corroded or cracked reluctor ring.', 'Compare live wheel speeds; scope the sensor; inspect ring and wiring at full lock.', 'amber', 'abs-coding'),
  D('C0040', 'ABS', 'Right front wheel speed sensor circuit', 'Failed sensor, damaged wiring at the hub, corroded or cracked reluctor ring.', 'Compare live wheel speeds; scope the sensor; inspect ring and wiring at full lock.', 'amber', 'abs-coding'),
  D('B1318', 'Body (Ford)', 'Battery voltage low', 'Discharged or failing battery, parasitic drain, charging fault.', 'Battery health test, charging test, then parasitic drain test with the car asleep.', 'amber', 'pre-mot-health-scan'),
];

const CM = (make_group: string, platform: string, feature: string, module: string, tool: string, notes = '') => ({ make_group, platform, feature, module, parameter: '', tool, notes });

export const CODING_MATRIX = [
  CM('BMW / MINI', 'F & G series', 'Full-screen wireless Apple CarPlay', 'Head unit (NBT Evo / MGU)', 'Autel MP900-BT', 'Depends on head-unit hardware and software level.'),
  CM('BMW / MINI', 'F & G series', 'Video in motion', 'Head unit', 'Autel MP900-BT', 'For passenger use only.'),
  CM('BMW / MINI', 'F & G series', 'M-Performance digital dash & start-up animation', 'Instrument cluster (KOMBI)', 'Autel MP900-BT'),
  CM('BMW / MINI', 'F & G series', 'Auto start/stop — remember last setting', 'FEM / BDC', 'Autel MP900-BT'),
  CM('BMW / MINI', 'F & G series', 'Mirrors fold on lock', 'FEM / BDC', 'Autel MP900-BT'),
  CM('BMW / MINI', 'F & G series', 'Digital speedometer and sport displays', 'Instrument cluster / head unit', 'Autel MP900-BT'),
  CM('BMW / MINI', 'F & G series', 'AGM / lithium battery registration', 'DME / BDC (power management)', 'Autel MP900-BT', 'Register capacity and type after every battery change.'),
  CM('BMW / MINI', 'F & G series', 'ZF 8HP gearbox adaptation reset', 'EGS', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Apple CarPlay / Android Auto (App-Connect) activation', 'Infotainment (5F)', 'Autel MP900-BT', 'MIB2 units; hardware dependent.'),
  CM('VAG', 'MQB / MLB', 'Virtual cockpit sport layout & needle sweep', 'Instrument cluster (17)', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Acoustic lock confirmation', 'Central electrics (09)', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Rear lights on with daytime running lights', 'Central electrics (09)', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Throttle response profile', 'Engine (01) / drive select', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Haldex pump bleed & DSG clutch basic settings', 'AWD (22) / transmission (02)', 'Autel MP900-BT'),
  CM('VAG', 'MQB / MLB', 'Electronic parking brake service retract', 'ABS / brakes (03)', 'Autel MP900-BT'),
  CM('Ford', 'CGEA 1.3 / C1MCA', 'Programmable module installation (PMI) for PCM / BCM / ABS', 'Target module', 'FORScan', 'Save as-built data from the old module first where it still communicates.'),
  CM('Ford', 'CGEA 1.3 / C1MCA', 'PATS key programming & parameter reset', 'BCM / PCM', 'FORScan', 'Two keys normally required to close the procedure.'),
  CM('Ford', 'Duratorq / EcoBlue', 'Injector correction (IMA) coding', 'PCM', 'FORScan'),
  CM('Ford', 'CGEA 1.3 / C1MCA', 'Auto-lock on drive-away & global window close', 'BCM', 'FORScan'),
  CM('Ford', 'CGEA 1.3 / C1MCA', 'High beam with front fogs ("bambi mode")', 'BCM', 'FORScan', 'Check local lighting regulations.'),
  CM('Ford', 'Duratorq / EcoBlue', 'DPF static regeneration & soot-load reset', 'PCM', 'FORScan'),
  CM('Ford', 'CGEA 1.3 / C1MCA', 'Battery monitoring system reset', 'BCM', 'FORScan'),
  CM('Land Rover', 'L405 / L494 / L460', 'Dynamic mode / configurable Terrain Response', 'Car configuration file', 'Autel MP900-BT'),
  CM('Land Rover', 'L405 / L494 / L460', 'Auto start/stop — remember last setting', 'Car configuration file', 'Autel MP900-BT'),
  CM('Land Rover', 'L405 / L494 / L460', 'Air suspension height calibration', 'Chassis control module', 'Autel MP900-BT'),
  CM('Land Rover', 'L405 / L494 / L460', 'Park brake unjam & service mode', 'Park brake module', 'Autel MP900-BT'),
  CM('Land Rover', 'L405 / L494 / L460', 'DPF forced regeneration & AdBlue no-start reset', 'PCM', 'Autel MP900-BT'),
  CM('Land Rover', 'L405 / L494 / L460', 'Smart key & KVM synchronisation', 'KVM / BCM', 'Autel MP900-BT'),
  CM('Mercedes-Benz', 'NTG5 / NTG6', 'AMG instrument cluster menu', 'Instrument cluster', 'Autel MP900-BT'),
  CM('Mercedes-Benz', 'NTG5 / NTG6', 'Start/stop ECO — last-state memory', 'Front SAM / EIS', 'Autel MP900-BT'),
  CM('Mercedes-Benz', 'NTG5 / NTG6', 'Seatbelt chime & parking sensor volume', 'Instrument cluster / PTS', 'Autel MP900-BT'),
  CM('Mercedes-Benz', '7G / 9G-Tronic', 'Transmission adaptation', 'Transmission control', 'Autel MP900-BT'),
  CM('Mercedes-Benz', 'BlueTEC', 'AdBlue remaining-starts counter reset after repair', 'Engine / SCR control', 'Autel MP900-BT', 'Only after the underlying fault is fixed.'),
];

export const TORQUE_SPECS = [
  { make_model: 'Ford Puma / Fiesta / Focus (M12 x 1.5)', wheel_nm: '135 Nm', caliper_nm: '115 Nm', sump_nm: '25 Nm' },
  { make_model: 'Ford Transit Custom 2.0 EcoBlue / 2.2 TDCi', wheel_nm: '200 Nm', caliper_nm: '175 Nm', sump_nm: '35 Nm' },
  { make_model: 'Range Rover / Sport (L405 / L494 / L460)', wheel_nm: '140 Nm', caliper_nm: '180 Nm', sump_nm: '25 Nm' },
  { make_model: 'BMW 1 / 3 / 5 Series & X5 (M14 x 1.25)', wheel_nm: '140 Nm', caliper_nm: '110 Nm', sump_nm: '25 Nm' },
  { make_model: 'VW Golf / Transporter T6 / Audi A3–A6', wheel_nm: '120 Nm (T6: 180 Nm)', caliper_nm: '125 Nm', sump_nm: '30 Nm' },
  { make_model: 'Mercedes A-Class / C-Class / E-Class', wheel_nm: '130 Nm', caliper_nm: '115 Nm', sump_nm: '30 Nm' },
].map((t) => ({ ...t, other: '', notes: 'Quick reference only — confirm against OEM data for the exact model year and wheel type.' }));

export const WIRING_REFS = [
  { make_model: 'All OBD-II vehicles', title: 'J1962 diagnostic connector pinout', detail: 'Pin 4 chassis ground · Pin 5 signal ground · Pin 6 HS-CAN high · Pin 14 HS-CAN low · Pin 16 battery positive (permanent). Pin 7 K-line on older vehicles. Pins 1, 3, 8, 9, 11, 12, 13 are manufacturer-specific.' },
  { make_model: 'Ford Puma / Fiesta / Focus', title: 'CAN networks at the DLC', detail: 'HS-CAN on pins 6 and 14 (about 60 ohms across the pair). MS-CAN on pins 3 and 11.' },
  { make_model: 'Ford Transit Custom', title: 'CAN termination', detail: 'BCM behind the glovebox / dash. Check about 60 ohms across DLC pins 6 and 14 — two 120-ohm terminators, in the PCM and the BCM.' },
  { make_model: 'Range Rover / Sport (L405 / L494 / L460)', title: 'Gateway location', detail: 'Gateway module under the dash. HS-CAN on DLC pins 6 and 14 (about 60 ohms); FlexRay used between chassis modules.' },
  { make_model: 'BMW 1 / 3 / 5 Series & X5', title: 'Gateway location', detail: 'FEM / BDC gateway in the passenger footwell. PT-CAN terminates at about 60 ohms.' },
  { make_model: 'VW Golf / Transporter T6 / Audi A3–A6', title: 'Gateway location', detail: 'J533 data-bus gateway above the pedals. Powertrain CAN about 60 ohms.' },
  { make_model: 'Mercedes A / C / E-Class', title: 'Gateway and CAN distributor', detail: 'N93 central gateway; CAN distributor (X30 series) in the sill area.' },
].map((w) => ({ ...w, url: '' }));

export const TECH_GUIDES = [
  {
    category: 'canbus', title: 'CAN-bus 60-ohm termination resistance test', applies_to: 'All high-speed CAN vehicles', sort: 10,
    body: '## Before you start\nIgnition off, key away from the car and wait for the bus to go to sleep (a few minutes). For the most reliable reading disconnect the battery negative.\n\n## Measure\n1. Set the multimeter to ohms.\n2. Measure between DLC pin 6 (CAN high) and pin 14 (CAN low).\n3. Read the result against the table below.\n\n## What the reading means\n- About 60 ohms: both 120-ohm terminators present and the pair is continuous.\n- About 120 ohms: one terminator missing — an open circuit in CAN high or low, or an unplugged or failed terminating module.\n- Near 0 ohms: CAN high and CAN low shorted together.\n- Open circuit / very high: both terminators out of circuit, or a break close to the DLC.\n\n## Check for shorts to ground and power\n1. Measure pin 6 to pin 4 (chassis ground), then pin 14 to pin 4. Neither should be close to 0 ohms.\n2. Reconnect the battery, ignition on, and measure voltage: CAN high about 2.5–3.5 V, CAN low about 1.5–2.5 V. The two should add up to roughly 5 V.\n\n## Isolating the fault\nIf resistance is wrong, unplug modules on that bus one at a time and re-measure. When the reading returns to normal you have found the module or branch at fault. Confirm with an oscilloscope: a healthy bus shows clean mirrored square waves.',
  },
  {
    category: 'injector', title: 'Diesel injector correction (IMA / C2I / QR) coding', applies_to: 'Common-rail diesel engines', sort: 20,
    body: '## Why it matters\nEvery injector is flow-tested at manufacture and given a correction code. The engine ECU uses it to trim pilot and main injection for that cylinder. Wrong or missing codes cause rough idle, diesel knock, smoke and failed regenerations.\n\n## Code formats\n- Bosch: IMA code, typically 6 to 8 alphanumeric characters.\n- Delphi: C2I (16 characters) or C3I (20 characters).\n- Denso: QR / compensation code, 16 to 30 characters.\n- Continental / Siemens: numeric class code, typically 6 digits.\n\n## Procedure\n1. Before fitting, photograph each injector’s code and note which cylinder it is going into.\n2. Read and save the existing codes from the ECU.\n3. Connect a battery support unit.\n4. In the engine ECU special functions, select injector coding and enter the new code for each cylinder replaced.\n5. Cycle the ignition, then read the values back to confirm they were stored.\n6. Run any pilot-learn or small-quantity adaptation the manufacturer requires.\n7. Check cylinder balance / smooth-running values at warm idle.\n\n## Common mistakes\nCodes entered against the wrong cylinder (check the manufacturer’s numbering), confusing O with 0 or I with 1, and skipping the learn procedure.',
  },
  {
    category: 'epb', title: 'Electronic parking brake service mode', applies_to: 'Vehicles with motor-on-caliper EPB', sort: 30,
    body: '## Never wind back by force\nThe caliper motor must be retracted electronically before the piston is pushed back. Forcing it damages the motor gear and spindle.\n\n## Procedure\n1. Chock the wheels, ignition on, parking brake released.\n2. Connect a battery support unit — voltage drop mid-procedure can leave a caliper stranded.\n3. With the scan tool, select the brake / parking brake module and start the pad-change or service mode. The motors wind fully back.\n4. Push the pistons back, fit pads and discs.\n5. Exit service mode with the scan tool. The motors run out and set the clearance.\n6. Carry out the calibration or basic setting if prompted, then apply and release several times and clear any stored codes.\n\n## Notes by manufacturer\n- VAG: function under brake electronics (03) — open and close for lining change.\n- Ford: service mode via the scan tool; some models also have a pedal-and-switch entry sequence — check the workshop procedure.\n- Land Rover: park brake service mode and unjam procedure via the park brake module.\n- BMW: workshop mode via the scan tool, then bedding-in procedure for new rear pads where specified.',
  },
  {
    category: 'air_suspension', title: 'Air suspension height calibration', applies_to: 'Land Rover / Range Rover and other air-sprung vehicles', sort: 40,
    body: '## When it is needed\nAfter replacing a height sensor, air spring, suspension arm or control module — or when the car sits unevenly with no leaks found.\n\n## Preparation\n1. Level ground, tyre pressures correct, vehicle unladen, doors closed.\n2. Engine running so the compressor is available; connect battery support.\n3. Check for leaks and stored faults first — calibration will not fix a leaking strut or a failing compressor.\n\n## Procedure\n1. Select normal ride height and let the car settle.\n2. Measure each corner from the wheel centre to the wheel-arch edge, vertically.\n3. In the chassis / suspension control module, start the height calibration routine.\n4. Enter the four measured values when prompted. The module calculates new sensor offsets.\n5. Let the system re-level, then measure again and repeat if any corner is outside tolerance.\n6. Cycle through access, normal and off-road heights to confirm correct operation.\n\n## Safety\nNever work under an air-sprung vehicle without axle stands — the suspension can drop without warning. Use the jacking / service mode before lifting.',
  },
  {
    category: 'dpf', title: 'Forced DPF regeneration checklist', applies_to: 'Diesel vehicles with a particulate filter', sort: 50,
    body: '## Before forcing a regeneration\n1. Read measured and calculated soot load and ash mass. If ash is at its limit, regeneration will not help.\n2. Check the oil level — a rising level means fuel dilution from failed regenerations. Change the oil first if it is over-full.\n3. Fix the cause: pressure sensor and hoses, EGR, thermostat, boost leaks, injector faults.\n4. At least a quarter of a tank of fuel, engine at operating temperature, no flammable material under the exhaust.\n\n## During\n1. Log soot percentage, differential pressure and exhaust temperatures before starting.\n2. Start the static or dynamic regeneration with the scan tool.\n3. Watch exhaust gas temperature — expect roughly 550–650°C at the filter.\n4. Stop if temperatures run away, or if soot does not fall after 15–20 minutes.\n\n## After\n1. Log the post-regeneration figures in the DPF log.\n2. Reset counters only where the manufacturer procedure calls for it.\n3. Clear codes, road-test and re-check differential pressure.',
  },
  {
    category: 'battery', title: 'Battery and alternator test procedure', applies_to: '12 V systems', sort: 60,
    body: '## Resting voltage\nMeasure after the car has stood for at least an hour (or remove surface charge with headlights for a minute). 12.6 V or above is fully charged; 12.2 V is about half; under 12.0 V is discharged.\n\n## Cranking\nVoltage should stay above about 9.6 V while cranking at normal temperatures.\n\n## Charging\n1. Engine at idle, no loads: typically 13.5–14.9 V.\n2. Load the system (lights, heated screens, blower): voltage should hold above about 13.3 V.\n3. Measure AC ripple at the battery: under about 100 mV is healthy. High ripple points to a failed diode.\n\n## Smart charging\nVehicles with a battery monitoring sensor deliberately vary voltage. Test during a charging phase and check live data. Always register a new battery so the charging strategy matches it.',
  },
];

const section = (title: string, items: string[]) => ({ title, items });

export const CHECKLISTS = [
  {
    kind: 'packing', name: 'Mobile lab pre-dispatch packing list',
    sections: [
      section('Diagnostic equipment', ['Autel MaxiPRO MP900-BT, charged', 'VCI / Bluetooth interface', 'FORScan laptop and OBD adapter', 'Oscilloscope and leads', 'Multimeter and test probes', 'Battery support unit and leads', 'Battery tester', 'Key programming kit and blanks', 'Breakout leads and back-probes']),
      section('Detailing equipment', ['Pressure washer, hose and lance', 'Wet extraction machine', 'Steam cleaner', 'Dual-action polisher and pads', 'Vacuum', 'Extension reel and RCD', 'Water hose and tap connectors']),
      section('Chemicals & consumables', ['Pre-wash and shampoo', 'Wheel fallout remover', 'Tar remover and clay', 'Interior cleaner and enzyme pre-spray', 'Ceramic coating / sealant', 'Clean microfibres and applicators', 'Seat and floor covers, gloves']),
      section('Paperwork & safety', ['Phone charged, job sheets synced for offline use', 'Card reader charged', 'Wheel chocks and axle stands', 'Fire extinguisher', 'First aid kit', 'Hi-vis and warning triangle']),
    ],
  },
  {
    kind: 'pre_inspection', name: 'Pre-work walkaround',
    sections: [
      section('Exterior', ['Existing scratches or dents noted', 'Wheel and tyre condition noted', 'Glass chips or cracks noted', 'Lights and trim condition noted']),
      section('Interior', ['Existing stains or damage noted', 'Warning lights present on arrival', 'Mileage recorded', 'Valuables removed by customer']),
      section('Agreement', ['Work to be carried out explained', 'Price confirmed with customer']),
    ],
  },
  {
    kind: 'vhc', name: 'Digital vehicle health check',
    sections: [
      section('Under the bonnet', ['Engine oil level and condition', 'Coolant level and strength', 'Brake fluid level and condition', 'Drive belt condition', 'Battery state of health', 'Visible leaks']),
      section('Brakes, tyres & suspension', ['Front brake pads and discs', 'Rear brake pads and discs', 'Tyre tread depth — all four', 'Tyre condition and pressures', 'Suspension and steering play', 'Shock absorbers and springs']),
      section('Lights & visibility', ['Headlights and aim', 'Brake, tail and indicator lights', 'Wipers and washers', 'Windscreen condition']),
      section('Electronics', ['Stored fault codes', 'Warning lights on dash', 'Charging system output', 'Emissions readiness monitors']),
    ],
  },
  {
    kind: 'ppi', name: 'Pre-purchase inspection — 50-point rubric',
    sections: [
      section('Identity & history (6)', ['VIN matches V5C and all VIN locations', 'Mileage consistent across control modules', 'MOT history reviewed for advisories and mileage', 'Service history present and plausible', 'Number of keys supplied and working', 'Outstanding recalls checked']),
      section('Electronics & diagnostics (10)', ['Full all-module fault scan', 'No evidence of recently cleared codes', 'Emissions readiness monitors complete', 'Airbag / SRS system status', 'ABS / stability system status', 'Battery state of health', 'Alternator output and ripple', 'All windows, locks and mirrors operate', 'Infotainment, cameras and sensors operate', 'Air conditioning blows cold']),
      section('Engine & transmission (10)', ['Cold start behaviour and idle quality', 'No abnormal noises or smoke', 'Oil level, condition and leaks', 'Coolant condition, no oil contamination', 'Live data: fuel trims / injector balance', 'Boost pressure meets target', 'DPF soot and ash load (diesel)', 'Clutch bite and operation / gearbox shift quality', 'Driveshafts, gaiters and mounts', 'Exhaust condition and leaks']),
      section('Brakes, steering & suspension (8)', ['Brake pad and disc wear', 'Brake pedal feel and handbrake hold', 'Brake fluid condition', 'Steering play and noise', 'Suspension bushes, arms and links', 'Shock absorbers and springs', 'Wheel bearings', 'Tyres: tread, age and even wear']),
      section('Body & paint (9)', ['Paint depth readings — every panel', 'Panel gaps and alignment', 'Evidence of accident repair or overspray', 'Corrosion: arches, sills and underside', 'Windscreen and glass', 'Lights and lenses', 'Door, boot and bonnet seals', 'Underside damage or leaks', 'Wheels: kerbing, cracks or buckles']),
      section('Interior & road test (7)', ['Seat, trim and headlining condition', 'Wear consistent with mileage', 'Water ingress or damp', 'All warning lights extinguish after start', 'Straight-line tracking and brake pull', 'No vibration at speed', 'Gearbox and engine response under load']),
    ],
  },
].map((c) => ({ ...c, sections: JSON.stringify(c.sections) }));
