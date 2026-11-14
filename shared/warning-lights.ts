// Dashboard warning-light guide. Icons are original line drawings on a 24 px grid (the same
// stroke style as the rest of the site), not manufacturer artwork.

export type LightColour = 'red' | 'amber';
export type DriveVerdict = 'stop' | 'soon' | 'careful';

export interface WarningLight {
  key: string;
  name: string;
  colour: LightColour;
  verdict: DriveVerdict;
  /** Inner SVG markup (stroke icons, viewBox 0 0 24 24). */
  icon: string;
  meaning: string;
  now: string;
  we: string;
  package: string;
  keywords: string;
}

const label = (t: string): string => `<text x="12" y="14.3" text-anchor="middle" font-size="5.4" font-weight="800" fill="currentColor" stroke="none" font-family="Arial, sans-serif">${t}</text>`;
const ring = '<circle cx="12" cy="12" r="6.6"/><path d="M3.6 6.4a10 10 0 0 0 0 11.2M20.4 6.4a10 10 0 0 1 0 11.2"/>';

export const VERDICTS: Record<DriveVerdict, { label: string; tone: 'bad' | 'warn' | 'info' }> = {
  stop: { label: 'Stop when safe', tone: 'bad' },
  soon: { label: 'Get it checked soon', tone: 'warn' },
  careful: { label: 'Drive gently, book a check', tone: 'warn' },
};

export const WARNING_LIGHTS: WarningLight[] = [
  {
    key: 'engine', name: 'Engine management light', colour: 'amber', verdict: 'soon',
    icon: '<path d="M3 11h2v-1h2V8h3V6h5v2h1.5l1.5 2h1V9h2v7h-2v-1h-1v2h-7l-2-2H7v-3H5v2H3z"/>',
    meaning: 'The engine computer has stored a fault. It can be anything from a loose sensor plug to a misfire or an emissions fault — the light alone does not say which.',
    now: 'Steady light and the car drives normally: keep journeys short and book a scan. Flashing light, shaking or loss of power: ease off and stop when safe — a misfire can damage the catalytic converter.',
    we: 'Read every stored code, look at live sensor data and pinpoint the root cause — not just clear the light.',
    package: 'fault-pinpointing', keywords: 'engine check eml mil orange engine symbol management',
  },
  {
    key: 'oil', name: 'Oil pressure', colour: 'red', verdict: 'stop',
    icon: '<path d="M3 11l4 2 3-2h6l4-2-5 7H9l-2-3-4 1z"/><path d="M20.6 13.4c.7 1 1 1.6 1 2.2a1 1 0 0 1-2 0c0-.6.3-1.2 1-2.2z"/>',
    meaning: 'Oil pressure is too low to protect the engine. This is one of the few lights where seconds matter.',
    now: 'Stop as soon as it is safe and switch the engine off. Check the oil level once it has settled. Do not restart if the level is fine and the light stays on.',
    we: 'Confirm real oil pressure, check the sender and wiring, and tell you honestly whether it is a sensor or the engine.',
    package: 'fault-pinpointing', keywords: 'oil can red genie lamp pressure',
  },
  {
    key: 'battery', name: 'Battery / charging', colour: 'red', verdict: 'careful',
    icon: '<rect x="3" y="8" width="18" height="11" rx="1.5"/><path d="M7 8V6h3v2M14 8V6h3v2M6.5 13.5h3M14.5 13.5h3M16 12v3"/>',
    meaning: 'The battery is not being charged — usually the alternator, its belt, or a wiring fault. The car is running on battery power alone.',
    now: 'Switch off heated seats, screens and anything you do not need, and head somewhere safe: the engine will stop when the battery runs flat.',
    we: 'Test battery health, alternator output and ripple, and check for a parasitic drain. You get a printed battery certificate.',
    package: 'battery-health-addon', keywords: 'battery charging alternator red battery flat',
  },
  {
    key: 'coolant', name: 'Engine temperature', colour: 'red', verdict: 'stop',
    icon: '<path d="M12 4v9"/><circle cx="12" cy="15" r="2"/><path d="M12 6h3M12 9h3M3 20c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
    meaning: 'The engine is overheating or the coolant level is low.',
    now: 'Stop when safe and let the engine cool fully. Never open the coolant cap while it is hot — the system is pressurised.',
    we: 'Check for leaks, test the thermostat, fan and sensor readings, and find out why it is overheating.',
    package: 'fault-pinpointing', keywords: 'temperature overheating coolant thermometer hot',
  },
  {
    key: 'brake', name: 'Brake system', colour: 'red', verdict: 'stop',
    icon: `${ring}<path d="M12 8.6v4M12 15.2h.01"/>`,
    meaning: 'Handbrake still on, low brake fluid, or a fault in the braking system.',
    now: 'Check the handbrake is fully released. If the light stays on or the pedal feels soft, stop when safe and do not drive on.',
    we: 'Check fluid level and pad wear sensors, read the ABS module and service electronic parking brakes.',
    package: 'abs-coding', keywords: 'brake exclamation circle handbrake fluid red',
  },
  {
    key: 'abs', name: 'ABS', colour: 'amber', verdict: 'soon',
    icon: `${ring}${label('ABS')}`,
    meaning: 'The anti-lock braking system has switched itself off. Normal braking still works, but the wheels can lock in an emergency stop.',
    now: 'Drive with more distance, especially in the wet, and get it checked soon. An ABS light is an MOT fail.',
    we: 'Read the ABS module, test each wheel speed sensor and its wiring, and code replacement modules.',
    package: 'abs-coding', keywords: 'abs anti lock wheel speed sensor',
  },
  {
    key: 'traction', name: 'Traction / stability control', colour: 'amber', verdict: 'soon',
    icon: '<path d="M6 12l1.5-4h9L18 12v3.5H6z"/><path d="M7 19.5c1-1.2 1 1.2 2 0s1 1.2 2 0M13 19.5c1-1.2 1 1.2 2 0s1 1.2 2 0"/>',
    meaning: 'Flashing while driving means it is working. A steady light means the system has a fault or has been switched off.',
    now: 'Check you have not pressed the ESP/DSC off button. If it stays on, drive carefully in the wet and book a check.',
    we: 'Scan the stability system, recalibrate the steering angle sensor and trace wheel-speed and yaw sensor faults.',
    package: 'abs-coding', keywords: 'traction esp dsc stability skid car squiggly lines',
  },
  {
    key: 'airbag', name: 'Airbag / SRS', colour: 'red', verdict: 'soon',
    icon: '<circle cx="9" cy="6" r="2"/><path d="M9 8.5v5l4 1.5v4M6 20l3-6.5"/><circle cx="16.5" cy="9.5" r="3.5"/>',
    meaning: 'A fault in the airbag or seatbelt pretensioner system. Airbags may not deploy in a crash.',
    now: 'The car drives normally, but protection is reduced. Get it diagnosed soon — it is an MOT fail.',
    we: 'Read the restraint module, check connectors under the seats and clock spring, and clear the fault once repaired.',
    package: 'fault-scan', keywords: 'airbag srs seatbelt person ball',
  },
  {
    key: 'dpf', name: 'Diesel particulate filter', colour: 'amber', verdict: 'soon',
    icon: '<rect x="6" y="8" width="12" height="8" rx="2"/><path d="M2 12h4M18 12h4M9.5 11h.01M12 13h.01M14.5 11h.01M9.5 14.2h.01M14.5 14.2h.01"/>',
    meaning: 'The filter that traps diesel soot is filling up and needs to regenerate.',
    now: 'If the car drives normally, a steady 20–30 minute run at motorway speed can clear it. If it is in limp mode or the engine light joins it, stop driving it hard and book a check.',
    we: 'Measure real soot load and pressure, run a controlled forced regeneration and find out why it blocked.',
    package: 'dpf-regeneration', keywords: 'dpf particulate filter soot box dots diesel',
  },
  {
    key: 'adblue', name: 'AdBlue / emissions fluid', colour: 'amber', verdict: 'soon',
    icon: '<path d="M12 3.5c3 4 5 6.7 5 9.6a5 5 0 0 1-10 0c0-2.9 2-5.600 5-9.600z"/><path d="M9.800 14a2.300 2.300 0 0 0 2.300 2.300"/><path d="M4 20h16"/>',
    meaning: 'AdBlue is low, or the system that injects it has a fault. Many cars count down the miles until they refuse to restart.',
    now: 'Top up with AdBlue first. If the warning or countdown stays, do not let it reach zero — the engine will not restart.',
    we: 'Test fluid quality, the pump, heater, injector and NOx sensors, and reset the countdown once the fault is fixed.',
    package: 'adblue-diagnostics', keywords: 'adblue ad blue def urea countdown no start nox',
  },
  {
    key: 'glow', name: 'Glow plug (diesel)', colour: 'amber', verdict: 'soon',
    icon: '<path d="M2.500 13h3c0-4.500 4-4.500 4 0s4 4.500 4 0 4-4.500 4 0h4"/>',
    meaning: 'Steady for a few seconds on a cold start is normal. Flashing or staying on means an engine management fault on many diesels.',
    now: 'If it flashes and power drops, the car is protecting itself (limp mode). Avoid hard driving and book a scan.',
    we: 'Test glow plugs and the control module, and read the engine codes the flashing light is pointing at.',
    package: 'fault-pinpointing', keywords: 'glow plug coil spring diesel flashing',
  },
  {
    key: 'tpms', name: 'Tyre pressure', colour: 'amber', verdict: 'careful',
    icon: '<path d="M6 5c-2 3-2 9 0 13h12c2-4 2-10 0-13"/><path d="M5 18h14M8 20.800h.01M12 20.800h.01M16 20.800h.01M12 8v5M12 15.500h.01"/>',
    meaning: 'One or more tyres is low, or the pressure monitoring system has a fault.',
    now: 'Check and set all four pressures (and the spare) when the tyres are cold, then reset the system from the dash menu.',
    we: 'Diagnose sensor faults and code replacement tyre-pressure sensors to the car.',
    package: 'fault-scan', keywords: 'tyre tire pressure tpms horseshoe exclamation',
  },
  {
    key: 'steering', name: 'Power steering', colour: 'red', verdict: 'careful',
    icon: '<circle cx="10" cy="12" r="7"/><circle cx="10" cy="12" r="1.500"/><path d="M3.500 10.500h13M10 13.500V19M20.500 8v5M20.500 16h.01"/>',
    meaning: 'Power assistance has failed or is reduced. The steering still works but is much heavier.',
    now: 'Slow down — low-speed manoeuvres will need real effort. Have it checked before longer journeys.',
    we: 'Check battery voltage (a common cause on electric steering), read the steering module and calibrate the angle sensor.',
    package: 'fault-pinpointing', keywords: 'steering wheel exclamation heavy eps',
  },
  {
    key: 'gearbox', name: 'Transmission / gearbox', colour: 'amber', verdict: 'careful',
    icon: '<circle cx="12" cy="12" r="4.200"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100M12 10.200v2M12 14h.01"/>',
    meaning: 'The automatic gearbox has detected a fault or is overheating. It may hold one gear to protect itself.',
    now: 'Avoid towing and hard acceleration. If gears slip or bang, stop and get it looked at.',
    we: 'Read the transmission module, check fluid condition and adaptation values, and tell you whether it is electrical or mechanical.',
    package: 'fault-pinpointing', keywords: 'gearbox transmission cog gear automatic',
  },
  {
    key: 'epb', name: 'Electronic parking brake', colour: 'amber', verdict: 'soon',
    icon: `${ring}${label('P')}`,
    meaning: 'A fault in the electric handbrake — a motor, switch or wiring problem.',
    now: 'The handbrake may not hold or release. Park in gear (or in P) on level ground and chock a wheel if needed.',
    we: 'Put the parking brake into service mode, test each motor and recalibrate after pad changes.',
    package: 'abs-coding', keywords: 'parking brake handbrake epb p circle',
  },
  {
    key: 'key', name: 'Key / immobiliser', colour: 'amber', verdict: 'soon',
    icon: '<path d="M3.500 15l1.500-4h9l1.500 4v3h-12z"/><circle cx="19" cy="6.500" r="2.200"/><path d="M19 8.700v4.300M19 11h1.600"/>',
    meaning: 'The car cannot read the key, or the key battery is low. The engine may refuse to start.',
    now: 'Hold the key against the start button or steering column marker and try again, then change the key battery.',
    we: 'Programme spare keys, pair immobilisers and trace antenna or module faults.',
    package: 'key-programming', keywords: 'key immobiliser fob not detected car padlock',
  },
  {
    key: 'service', name: 'Service due', colour: 'amber', verdict: 'careful',
    icon: '<path d="M14.800 5.200a4 4 0 0 0-5.200 5.200L4 16l2 4 5.600-7.600a4 4 0 0 0 5.200-5.200L14.300 9.700l-2-2z"/>',
    meaning: 'A reminder that a service or inspection is due by time or mileage — not a fault.',
    now: 'Safe to drive. Book the service, and have the reminder reset properly afterwards.',
    we: 'Reset service indicators and oil-life counters, and health-check the car while we are there.',
    package: 'pre-mot-health-scan', keywords: 'spanner service wrench inspection reminder',
  },
  {
    key: 'bulb', name: 'Bulb failure', colour: 'amber', verdict: 'careful',
    icon: '<path d="M9 17h6M10 20h4M12 3a6 6 0 0 0-3.500 10.900c.600.500 1 1.200 1 2h5c0-.800.400-1.500 1-2A6 6 0 0 0 12 3z"/><path d="M12 7.500v3M12 12.800h.01"/>',
    meaning: 'An exterior bulb has failed, or the car does not recognise a replacement (common after fitting LEDs).',
    now: 'Walk round the car with the lights on and replace the failed bulb — a blown brake light or headlight can get you stopped.',
    we: 'Trace wiring and module faults, and code the car for LED upgrades so the warning stays off.',
    package: 'fault-scan', keywords: 'bulb light lamp out led error',
  },
];
