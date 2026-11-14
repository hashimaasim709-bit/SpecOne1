// Additional generic fault codes (SAE J2012 / ISO 15031-6 wording) added after launch.
// Inserted with INSERT OR IGNORE, so codes edited in the admin are never overwritten.

type Sev = 'info' | 'amber' | 'red';
const D = (code: string, system: string, title: string, causes: string, fixes: string, severity: Sev, package_slug: string) => ({ code, system, title, causes, fixes, severity, package_slug });
const pin = 'fault-pinpointing';
const dpf = 'dpf-regeneration';
const scr = 'adblue-diagnostics';
const mod = 'module-coding';
const abs = 'abs-coding';
const mot = 'pre-mot-health-scan';

export const DTC_EXTRA = [
  // ── Variable valve timing & engine timing ──
  D('P0010', 'Valve timing', 'Camshaft position actuator A circuit (bank 1)', 'Faulty VVT solenoid, open or shorted wiring, poor connector, ECU driver fault.', 'Check solenoid resistance and the ECU drive signal with the oscilloscope; inspect the connector for oil wicking.', 'amber', pin),
  D('P0011', 'Valve timing', 'Camshaft position A — timing over-advanced or system performance (bank 1)', 'Low or dirty oil, sticking VVT solenoid, worn cam phaser, stretched timing chain.', 'Check oil level and grade first; compare desired vs actual cam angle; command the solenoid and watch the response.', 'amber', pin),
  D('P0016', 'Valve timing', 'Crankshaft / camshaft position correlation (bank 1 sensor A)', 'Stretched timing chain or jumped belt, faulty cam or crank sensor, worn phaser.', 'Do not keep driving if it rattles. Overlay crank and cam signals on the oscilloscope to measure timing drift before any strip-down.', 'red', pin),
  // ── Turbo & boost ──
  D('P0045', 'Turbocharger', 'Turbo / supercharger boost control A circuit / open', 'Faulty boost control solenoid or electronic actuator, wiring break, connector corrosion.', 'Check actuator supply and command; resistance-test the solenoid; inspect the harness near the hot side.', 'amber', pin),
  D('P0046', 'Turbocharger', 'Turbo / supercharger boost control A circuit range / performance', 'Sticking variable vanes, split vacuum pipe, failing actuator, carbon build-up.', 'Compare commanded vs actual boost under load; vacuum-test the actuator; sweep the vanes with the scan tool.', 'amber', pin),
  D('P0236', 'Turbocharger', 'Turbo boost sensor A circuit range / performance', 'Split or disconnected boost hose, blocked sensor port, faulty MAP/boost sensor.', 'Smoke-test the charge-air system; compare boost sensor with barometric pressure key-on engine-off.', 'amber', pin),
  D('P0237', 'Turbocharger', 'Turbo boost sensor A circuit low', 'Sensor signal shorted to ground, broken 5 V reference, failed sensor.', 'Back-probe 5 V reference, ground and signal; wiggle-test the harness while watching live data.', 'amber', pin),
  D('P0238', 'Turbocharger', 'Turbo boost sensor A circuit high', 'Signal shorted to voltage, open ground, failed sensor.', 'Check sensor ground first; then reference and signal against expected values at idle.', 'amber', pin),
  D('P2562', 'Turbocharger', 'Turbo boost control position sensor A circuit', 'Faulty vane position sensor (often inside the electronic actuator), wiring fault.', 'Check actuator position feedback while sweeping the vanes; inspect the connector for heat damage.', 'amber', pin),
  D('P2563', 'Turbocharger', 'Turbo boost control position sensor A circuit range / performance', 'Sticking or carboned variable vanes, worn actuator, position sensor drift.', 'Run the actuator learn/test routine; compare commanded and actual position; vane cleaning often cures it.', 'amber', pin),
  // ── Sensors & air metering ──
  D('P0068', 'Air metering', 'MAP / MAF — throttle position correlation', 'Intake leak, faulty MAF or MAP sensor, sticking throttle body.', 'Compare MAF, MAP and throttle angle together in live data; smoke-test the intake.', 'amber', pin),
  D('P0069', 'Air metering', 'Manifold absolute pressure — barometric pressure correlation', 'Faulty MAP or barometric sensor, blocked sensor port, wiring fault.', 'Key-on engine-off both readings should match atmospheric pressure; clean the port and recheck.', 'amber', pin),
  D('P0102', 'Air metering', 'Mass air flow circuit low input', 'Unplugged or damaged MAF, wiring open, poor ground, large intake leak.', 'Check MAF supply and ground at the plug; watch g/s at idle and under load.', 'amber', pin),
  D('P0103', 'Air metering', 'Mass air flow circuit high input', 'Signal shorted to voltage, contaminated or failing MAF sensor.', 'Back-probe the signal wire; compare with a known-good reading for the engine size.', 'amber', pin),
  D('P0107', 'Air metering', 'Manifold absolute pressure / barometric circuit low input', 'Sensor unplugged, 5 V reference missing, signal shorted to ground.', 'Check reference, ground and signal at the sensor connector; inspect for oil contamination.', 'amber', pin),
  D('P0108', 'Air metering', 'Manifold absolute pressure / barometric circuit high input', 'Open sensor ground, signal shorted to voltage, failed sensor.', 'Check the sensor ground first, then the signal against barometric pressure key-on.', 'amber', pin),
  D('P0112', 'Sensors', 'Intake air temperature sensor 1 circuit low', 'Signal shorted to ground, failed sensor, damaged harness.', 'Compare intake temperature with ambient on a cold engine; check resistance against the temperature chart.', 'info', pin),
  D('P0115', 'Cooling', 'Engine coolant temperature circuit malfunction', 'Faulty coolant temperature sensor, wiring or connector fault.', 'Compare ECT with ambient on a cold engine and with an infrared reading when warm.', 'amber', pin),
  D('P0116', 'Cooling', 'Engine coolant temperature circuit range / performance', 'Thermostat stuck open, sensor drift, low coolant.', 'Check coolant level; graph warm-up time — a slow climb points at the thermostat.', 'amber', pin),
  D('P0118', 'Cooling', 'Engine coolant temperature circuit high input', 'Sensor open circuit, broken wire, corroded connector.', 'A reading near -40 °C means open circuit — check continuity back to the ECU.', 'amber', pin),
  D('P0120', 'Throttle', 'Throttle / pedal position sensor A circuit malfunction', 'Worn throttle body sensor track, wiring fault, failing pedal sensor.', 'Sweep the throttle slowly while graphing the signal for dropouts; check reference voltage.', 'amber', pin),
  D('P0121', 'Throttle', 'Throttle / pedal position sensor A circuit range / performance', 'Worn sensor track, carbon on the throttle plate, sensor mismatch.', 'Clean the throttle body, run the adaptation, then graph both tracks for correlation.', 'amber', pin),
  D('P2101', 'Throttle', 'Throttle actuator control motor circuit range / performance', 'Carboned or sticking throttle body, failing motor, wiring fault.', 'Clean and inspect the throttle body; run the actuator test and throttle adaptation.', 'red', pin),
  D('P2135', 'Throttle', 'Throttle / pedal position sensor A/B voltage correlation', 'Worn sensor tracks, wiring fault, poor ground, water in the connector.', 'Graph both sensor tracks together; they should mirror smoothly with no gaps.', 'red', pin),
  D('P2138', 'Throttle', 'Throttle / pedal position sensor D/E voltage correlation', 'Faulty accelerator pedal sensor, wiring damage near the pedal.', 'Graph pedal sensors D and E while pressing slowly; inspect the pedal connector.', 'red', pin),
  // ── Oxygen sensors & fuelling ──
  D('P0030', 'Oxygen sensors', 'O2 sensor heater control circuit (bank 1 sensor 1)', 'Failed heater element, blown fuse, wiring damage near the exhaust.', 'Check heater resistance and the fused supply; inspect the harness for melting.', 'amber', mot),
  D('P0130', 'Oxygen sensors', 'O2 sensor circuit malfunction (bank 1 sensor 1)', 'Failed sensor, exhaust leak before the sensor, wiring fault.', 'Graph the sensor switching at 2,500 rpm; check for exhaust leaks before replacing.', 'amber', mot),
  D('P0133', 'Oxygen sensors', 'O2 sensor circuit slow response (bank 1 sensor 1)', 'Ageing or contaminated sensor, exhaust leak, fuelling problem.', 'Measure rich/lean switching time on the oscilloscope; fix any fuelling fault first.', 'amber', mot),
  D('P0135', 'Oxygen sensors', 'O2 sensor heater circuit (bank 1 sensor 1)', 'Heater element open, fuse, relay or wiring fault.', 'Resistance-test the heater; check supply voltage with the engine running.', 'amber', mot),
  D('P0136', 'Oxygen sensors', 'O2 sensor circuit malfunction (bank 1 sensor 2)', 'Failed downstream sensor, wiring fault, exhaust leak.', 'The rear sensor should hold a steady voltage on a healthy catalyst — check signal and wiring.', 'amber', mot),
  D('P0141', 'Oxygen sensors', 'O2 sensor heater circuit (bank 1 sensor 2)', 'Downstream heater element failure, wiring damage.', 'Check heater resistance and supply; inspect the harness along the exhaust.', 'amber', mot),
  D('P0174', 'Fuelling', 'System too lean (bank 2)', 'Intake leak on bank 2, weak fuel delivery, MAF under-reading.', 'Compare bank 1 and bank 2 trims: both lean suggests MAF or fuel; one bank suggests a local air leak.', 'amber', pin),
  D('P0175', 'Fuelling', 'System too rich (bank 2)', 'Leaking injector, high fuel pressure, faulty O2 sensor, MAF over-reading.', 'Check fuel pressure and injector balance; compare trims between banks.', 'amber', pin),
  D('P2187', 'Fuelling', 'System too lean at idle (bank 1)', 'Vacuum leak (often PCV or intake gasket), weak fuel pressure at idle.', 'Smoke-test the intake; watch trims fall back towards zero as revs rise.', 'amber', pin),
  D('P2195', 'Oxygen sensors', 'O2 sensor signal stuck lean (bank 1 sensor 1)', 'Air leak before the sensor, failed sensor, low fuel pressure.', 'Inject propane or snap the throttle — a healthy sensor should go rich instantly.', 'amber', pin),
  D('P2196', 'Oxygen sensors', 'O2 sensor signal stuck rich (bank 1 sensor 1)', 'Leaking injector, fuel-diluted oil, failed sensor.', 'Create a lean condition and watch the response; check oil for fuel smell.', 'amber', pin),
  D('P0089', 'Fuel system', 'Fuel pressure regulator 1 performance', 'Sticking pressure regulator or metering valve, weak pump, sensor fault.', 'Graph commanded vs actual rail pressure; check regulator duty cycle and return flow.', 'amber', pin),
  D('P0190', 'Fuel system', 'Fuel rail pressure sensor circuit malfunction', 'Faulty rail pressure sensor, wiring or connector fault.', 'Key-on engine-off pressure should read near zero; check 5 V reference and signal.', 'red', pin),
  D('P0201', 'Fuel system', 'Injector circuit / open — cylinder 1', 'Open injector coil, broken wiring, ECU driver fault.', 'Resistance-test the injector; scope the injector current waveform.', 'red', pin),
  D('P0230', 'Fuel system', 'Fuel pump primary circuit malfunction', 'Fuel pump relay, fuse, inertia switch, wiring or pump control module fault.', 'Check pump relay operation and supply voltage at the pump; listen for prime at key-on.', 'red', pin),
  // ── Misfire & ignition ──
  D('P0302', 'Ignition', 'Cylinder 2 misfire detected', 'Coil, plug or injector on cylinder 2, low compression, vacuum leak near that port.', 'Swap the coil with another cylinder to see if the misfire moves; check compression.', 'red', pin),
  D('P0303', 'Ignition', 'Cylinder 3 misfire detected', 'Coil, plug or injector on cylinder 3, low compression.', 'Swap coil and plug to see if the fault follows; relative compression test.', 'red', pin),
  D('P0304', 'Ignition', 'Cylinder 4 misfire detected', 'Coil, plug or injector on cylinder 4, low compression.', 'Swap coil and plug to see if the fault follows; relative compression test.', 'red', pin),
  D('P0325', 'Ignition', 'Knock sensor 1 circuit (bank 1)', 'Faulty knock sensor, incorrect torque, wiring fault.', 'Check sensor output while lightly tapping the block; confirm mounting torque.', 'amber', pin),
  D('P0336', 'Engine', 'Crankshaft position sensor A circuit range / performance', 'Damaged reluctor ring, debris on the sensor, failing sensor, wiring interference.', 'Scope the crank signal for missing or distorted teeth; inspect the sensor tip.', 'red', pin),
  D('P0341', 'Engine', 'Camshaft position sensor A circuit range / performance', 'Faulty cam sensor, timing chain or belt wear, wiring fault.', 'Overlay cam and crank signals; check the sensor gap and connector.', 'amber', pin),
  // ── Diesel glow plugs ──
  D('P0381', 'Glow plugs', 'Glow plug / heater indicator circuit', 'Dashboard warning lamp circuit fault, glow plug module fault.', 'Check lamp circuit and module output; confirm glow plugs work with the actuation test.', 'info', pin),
  D('P0670', 'Glow plugs', 'Glow plug module control circuit', 'Failed glow plug control module, wiring or fuse fault.', 'Check the module supply and control signal from the ECU; actuation test.', 'amber', pin),
  D('P0671', 'Glow plugs', 'Cylinder 1 glow plug circuit', 'Failed glow plug, broken feed wire, corroded terminal.', 'Resistance-test each glow plug; current-clamp test during actuation.', 'amber', pin),
  // ── EGR & emissions ──
  D('P0400', 'EGR', 'Exhaust gas recirculation flow malfunction', 'Carboned or stuck EGR valve, blocked passages, failed position sensor.', 'Command the valve and compare position; check MAF drop when EGR opens.', 'amber', dpf),
  D('P0403', 'EGR', 'Exhaust gas recirculation circuit malfunction', 'EGR valve motor or solenoid failure, wiring fault.', 'Check supply and control signal; resistance-test the actuator.', 'amber', dpf),
  D('P0405', 'EGR', 'Exhaust gas recirculation sensor A circuit low', 'Faulty position sensor, wiring shorted to ground.', 'Check reference voltage and signal at the valve connector.', 'amber', dpf),
  D('P2457', 'EGR', 'Exhaust gas recirculation cooling system performance', 'Blocked or leaking EGR cooler, faulty bypass valve, temperature sensor fault.', 'Compare EGR temperatures before and after the cooler; check coolant loss.', 'amber', dpf),
  D('P2425', 'EGR', 'Exhaust gas recirculation cooling valve control circuit / open', 'Faulty EGR cooler bypass valve or vacuum solenoid, wiring fault.', 'Actuate the bypass valve; check vacuum supply and solenoid resistance.', 'amber', dpf),
  D('P0410', 'Emissions', 'Secondary air injection system malfunction', 'Failed air pump, stuck combi valve, blown fuse or relay.', 'Command the pump and listen; check the combi valve and hoses for moisture damage.', 'amber', pin),
  D('P0430', 'Emissions', 'Catalyst system efficiency below threshold (bank 2)', 'Worn catalytic converter, misfire damage, exhaust leak, rear O2 sensor fault.', 'Compare front and rear sensor activity; fix any misfire or leak before condemning the cat.', 'amber', mot),
  D('P2031', 'DPF & exhaust', 'Exhaust gas temperature sensor circuit (bank 1 sensor 2)', 'Failed EGT sensor, wiring damage from heat.', 'Compare EGT sensors cold — they should all read close to ambient.', 'amber', dpf),
  D('P2032', 'DPF & exhaust', 'Exhaust gas temperature sensor circuit low (bank 1 sensor 2)', 'Sensor shorted, damaged wiring near the exhaust.', 'Check sensor resistance and harness; replace a sensor reading wildly out of range.', 'amber', dpf),
  D('P2080', 'DPF & exhaust', 'Exhaust gas temperature sensor circuit range / performance (bank 1 sensor 1)', 'Drifting EGT sensor, exhaust leak near the sensor.', 'Compare against the other EGT sensors when cold and during a regeneration.', 'amber', dpf),
  D('P20B9', 'AdBlue / SCR', 'Reductant heater A control circuit / open', 'Failed AdBlue tank heater, wiring fault, heater relay.', 'Check heater resistance and supply; common in cold weather with crystallised fluid.', 'amber', scr),
  D('P2047', 'AdBlue / SCR', 'Reductant injector circuit / open (bank 1 unit 1)', 'Failed AdBlue dosing injector, wiring fault, crystal blockage.', 'Resistance-test the injector; run a dosing quantity test.', 'amber', scr),
  D('P2BAD', 'AdBlue / SCR', 'NOx exceedance — root cause unknown', 'Poor-quality AdBlue, failing SCR catalyst, NOx sensor drift, dosing fault.', 'Test AdBlue concentration; run the dosing test; compare upstream and downstream NOx readings.', 'red', scr),
  // ── Evaporative system ──
  D('P0440', 'Evaporative', 'Evaporative emission system malfunction', 'Loose or faulty fuel cap, cracked EVAP hose, purge or vent valve fault.', 'Check the fuel cap seal; smoke-test the EVAP system.', 'info', mot),
  D('P0442', 'Evaporative', 'Evaporative emission system small leak detected', 'Fuel cap seal, small cracked hose, leaking purge valve.', 'Smoke-test with the vent valve closed.', 'info', mot),
  D('P0443', 'Evaporative', 'Evaporative emission purge control valve circuit', 'Failed purge solenoid, wiring fault.', 'Command the valve and check it clicks; resistance-test the solenoid.', 'info', mot),
  D('P0446', 'Evaporative', 'Evaporative emission vent control circuit', 'Stuck or failed vent valve, blocked charcoal canister.', 'Command the vent valve; check the canister for blockage or fuel saturation.', 'info', mot),
  D('P0456', 'Evaporative', 'Evaporative emission system very small leak detected', 'Fuel cap seal, tiny hose crack, filler neck corrosion.', 'Smoke-test; replace the fuel cap seal first as the cheapest fix.', 'info', mot),
  // ── Idle, oil & electrical ──
  D('P0505', 'Idle', 'Idle air control system malfunction', 'Dirty throttle body, faulty idle valve, vacuum leak.', 'Clean the throttle body and run the idle relearn; smoke-test the intake.', 'amber', pin),
  D('P0507', 'Idle', 'Idle air control system RPM higher than expected', 'Vacuum leak, sticking throttle, incorrect idle adaptation.', 'Smoke-test; clean the throttle body and reset adaptations.', 'amber', pin),
  D('P0520', 'Lubrication', 'Engine oil pressure sensor / switch circuit malfunction', 'Low oil level or pressure, faulty sender, wiring fault.', 'Stop the engine and check the oil level now. Confirm real pressure with a mechanical gauge before blaming the sender.', 'red', pin),
  D('P0571', 'Brakes', 'Brake switch A circuit malfunction', 'Faulty or misadjusted brake light switch, wiring fault.', 'Check both switch circuits in live data while pressing the pedal; check the brake lights.', 'amber', abs),
  D('P0641', 'Electrical', 'Sensor reference voltage A circuit / open', 'One sensor on the shared 5 V supply shorted, harness chafe, ECU fault.', 'Unplug sensors on that reference one at a time until the voltage recovers.', 'red', pin),
  D('P0651', 'Electrical', 'Sensor reference voltage B circuit / open', 'Shorted sensor on the B reference circuit, harness damage, ECU fault.', 'Isolate sensors on the B reference one at a time while monitoring the voltage.', 'red', pin),
  D('P0601', 'Control module', 'Internal control module memory checksum error', 'ECU memory corruption, interrupted programming, failing ECU.', 'Check battery and grounds; re-flash the ECU software before considering replacement.', 'red', mod),
  D('P0603', 'Control module', 'Internal control module keep-alive memory error', 'Battery disconnection, poor permanent supply or ground, ECU fault.', 'Check the permanent battery feed and grounds; clear and retest after a charge.', 'amber', mod),
  D('P0605', 'Control module', 'Internal control module read-only memory error', 'ECU software corruption or internal fault.', 'Attempt a software re-flash with a stable power supply; replace and code if it persists.', 'red', mod),
  // ── Intake runners ──
  D('P2004', 'Intake', 'Intake manifold runner control stuck open (bank 1)', 'Carboned swirl flaps, broken linkage, failed actuator.', 'Inspect the swirl flap linkage and actuator movement; carbon cleaning often frees it.', 'amber', pin),
  D('P2008', 'Intake', 'Intake manifold runner control circuit / open (bank 1)', 'Failed runner actuator or solenoid, wiring fault.', 'Check actuator supply and command; resistance-test the solenoid.', 'amber', pin),
  D('P2015', 'Intake', 'Intake manifold runner position sensor / switch circuit range / performance (bank 1)', 'Worn actuator position sensor, broken linkage, carbon build-up.', 'Compare commanded and actual position; inspect the linkage — common on diesels.', 'amber', pin),
  D('P2279', 'Intake', 'Intake air system leak', 'Split intake hose, loose clamp, cracked manifold, PCV leak.', 'Smoke-test the intake from the air filter to the manifold.', 'amber', pin),
  // ── Transmission ──
  D('P0715', 'Transmission', 'Input / turbine speed sensor A circuit', 'Failed speed sensor, wiring fault, transmission control module issue.', 'Check sensor signal while driving; inspect the connector for fluid ingress.', 'amber', pin),
  D('P0720', 'Transmission', 'Output speed sensor circuit malfunction', 'Failed output speed sensor, wiring fault.', 'Compare output speed with vehicle speed in live data; check sensor and wiring.', 'amber', pin),
  D('P0730', 'Transmission', 'Incorrect gear ratio', 'Low or degraded fluid, slipping clutches, solenoid fault.', 'Check fluid level and condition first; compare input and output speeds per gear.', 'red', pin),
  D('P0741', 'Transmission', 'Torque converter clutch circuit performance or stuck off', 'Worn torque converter clutch, faulty solenoid, degraded fluid.', 'Check slip RPM with the clutch commanded on; fluid condition and solenoid test.', 'amber', pin),
  // ── Network & body ──
  D('U0102', 'Network', 'Lost communication with transfer case control module', 'Module power or ground fault, CAN wiring damage, failed module.', 'Check module power and grounds; measure CAN termination (about 60 Ω across the bus).', 'amber', pin),
  D('U0151', 'Network', 'Lost communication with restraints control module', 'Airbag module power or ground fault, CAN wiring, module failure.', 'Airbag light on: check module supply, then CAN at the module connector. Do not probe airbag circuits live.', 'red', pin),
  D('U0164', 'Network', 'Lost communication with HVAC control module', 'Climate control module power fault, CAN wiring, module failure.', 'Check module fuses, power and grounds; then the CAN lines at the module.', 'info', pin),
  D('U0184', 'Network', 'Lost communication with radio', 'Head unit power fault, aftermarket head unit fitted, CAN wiring.', 'Check head unit supply and CAN connection; code out an aftermarket unit if fitted.', 'info', mod),
  D('U0415', 'Network', 'Invalid data received from ABS control module', 'ABS module fault, wheel speed sensor fault, software mismatch after replacement.', 'Read ABS module codes first; code or update a replacement module.', 'amber', abs),
  D('U3003', 'Electrical', 'Battery voltage', 'Weak battery, charging fault, parasitic drain, poor battery connections.', 'Battery health test, charging ripple test and a parasitic drain check.', 'amber', 'battery-health-addon'),
];
