// Interactive "studio stage": a CAD-style vehicle blueprint with four switchable
// silhouettes and tappable hotspots for each vehicle system (#64, #69).
import { BODIES, BODY_LABELS, VEHICLE_ZONES, type Body } from '../../shared/constants';
import { money } from '../../shared/format';
import { html, raw, type SafeHtml } from '../lib/html';
import type { PackageRow } from '../services/catalog';
import { icon } from './icons';

interface Silhouette {
  body: string;
  glass: string[];
  details: string[];
  wheels: [number, number];
  ground: number;
  hotspots: Record<string, [number, number]>;
}

const SHAPES: Record<Body, Silhouette> = {
  suv: {
    body: 'M78 270 L64 254 L60 214 Q62 196 84 188 L292 166 Q306 164 316 156 L364 110 Q372 104 384 104 L640 102 Q664 102 690 112 L716 124 Q728 130 728 146 L730 248 Q730 268 714 270 L658 270 A58 58 0 0 0 542 270 L248 270 A58 58 0 0 0 132 270 Z',
    glass: ['M330 160 L372 116 Q378 112 388 112 L470 112 L470 162 Z', 'M480 112 L598 112 L598 160 L480 162 Z', 'M608 112 L660 112 Q686 116 700 128 L706 158 L608 160 Z'],
    details: ['M300 170 L716 162', 'M474 112 L478 262', 'M603 112 L606 262', 'M322 164 Q318 214 322 262', 'M248 250 L542 250', 'M66 208 L116 200', 'M62 228 L92 226', 'M712 138 L730 146', 'M372 104 L640 100'],
    wheels: [190, 600],
    ground: 270,
    hotspots: { engine: [176, 200], dash: [322, 150], chassis: [190, 270], exhaust: [694, 250], cabin: [430, 138], paint: [556, 208] },
  },
  hatchback: {
    body: 'M76 272 L62 256 L58 222 Q60 204 82 198 L260 180 Q276 178 288 168 L346 118 Q356 110 370 110 L560 108 Q600 108 628 126 L668 160 Q684 172 686 196 L688 250 Q688 270 672 272 L618 272 A58 58 0 0 0 502 272 L238 272 A58 58 0 0 0 122 272 Z',
    glass: ['M304 172 L356 122 Q362 116 372 116 L452 116 L452 174 Z', 'M462 116 L556 114 Q592 114 616 130 L644 160 L462 172 Z'],
    details: ['M282 182 L664 170', 'M457 116 L462 262', 'M296 176 Q292 222 296 262', 'M238 252 L502 252', 'M64 216 L108 210', 'M666 172 L686 180'],
    wheels: [180, 560],
    ground: 272,
    hotspots: { engine: [160, 210], dash: [296, 168], chassis: [180, 272], exhaust: [650, 254], cabin: [410, 145], paint: [530, 214] },
  },
  saloon: {
    body: 'M74 272 L60 256 L56 226 Q58 210 80 204 L282 182 Q296 180 308 172 L372 124 Q384 116 400 116 L556 116 Q580 116 600 130 L652 172 L712 180 Q730 184 734 200 L736 252 Q736 270 720 272 L648 272 A58 58 0 0 0 532 272 L248 272 A58 58 0 0 0 132 272 Z',
    glass: ['M326 176 L380 128 Q388 122 400 122 L470 122 L470 178 Z', 'M480 122 L552 122 Q574 122 590 134 L632 172 L480 178 Z'],
    details: ['M302 184 L706 186', 'M476 122 L480 262', 'M318 178 Q314 222 318 262', 'M248 252 L532 252', 'M62 222 L110 216', 'M652 172 L734 198', 'M716 192 L734 198'],
    wheels: [190, 590],
    ground: 272,
    hotspots: { engine: [172, 212], dash: [316, 170], chassis: [190, 272], exhaust: [704, 254], cabin: [440, 150], paint: [664, 210] },
  },
  van: {
    body: 'M70 272 L54 254 L52 206 Q54 188 74 180 L150 164 Q170 160 184 140 L236 84 Q246 72 262 72 L728 70 Q746 70 748 88 L750 254 Q750 272 732 272 L668 272 A58 58 0 0 0 552 272 L228 272 A58 58 0 0 0 112 272 Z',
    glass: ['M200 148 L246 94 Q252 86 262 86 L314 86 L314 152 Z'],
    details: ['M160 166 L748 160', 'M326 86 L328 262', 'M478 84 L480 262', 'M326 112 L478 112', 'M700 72 L702 262', 'M56 216 L98 208', 'M732 100 L748 100', 'M228 252 L552 252'],
    wheels: [170, 610],
    ground: 272,
    hotspots: { engine: [108, 202], dash: [212, 148], chassis: [170, 272], exhaust: [724, 254], cabin: [272, 118], paint: [560, 170] },
  },
};

const ZONE_SHORT: Record<string, string> = { engine: 'ENGINE', dash: 'ECU · CODING', chassis: 'BRAKES · ABS', exhaust: 'DPF · EMISSIONS', cabin: 'CABIN', paint: 'PAINT · GLASS' };

function wheel(cx: number, cy: number): string {
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 72 * Math.PI) / 180;
    return `<line x1="${cx + Math.cos(a) * 10}" y1="${cy + Math.sin(a) * 10}" x2="${cx + Math.cos(a) * 30}" y2="${cy + Math.sin(a) * 30}" class="rim"/>`;
  }).join('');
  return `<circle cx="${cx}" cy="${cy}" r="46" class="wheel"/><circle cx="${cx}" cy="${cy}" r="32" class="rim"/><circle cx="${cx}" cy="${cy}" r="8" class="rim"/>${spokes}`;
}

function silhouette(body: Body, visible: boolean): string {
  const s = SHAPES[body];
  const hotspots = Object.entries(s.hotspots).map(([zone, [x, y]]) => {
    // Labels near the right edge are anchored to the left of the hotspot so they never clip.
    const right = x > 560;
    const lx = right ? x - 14 : x + 14;
    const ly = y - 16;
    return `<g class="hotspot" role="button" tabindex="0" data-zone="${zone}" aria-label="${VEHICLE_ZONES[zone]!.label}" aria-pressed="false"><circle class="halo" cx="${x}" cy="${y}" r="9"/><circle class="core" cx="${x}" cy="${y}" r="7"/><text x="${lx}" y="${ly}"${right ? ' text-anchor="end"' : ''}>${ZONE_SHORT[zone]}</text></g>`;
  }).join('');
  const [w1, w2] = s.wheels;
  return `<g data-body="${body}"${visible ? '' : ' style="display:none"'}>
    <path d="${s.body}" class="body-fill"/>
    <path d="${s.body}" class="body-line"/>
    ${s.glass.map((g) => `<path d="${g}" class="glass"/>`).join('')}
    ${s.details.map((d) => `<path d="${d}" class="detail-line"/>`).join('')}
    ${wheel(w1, s.ground)}${wheel(w2, s.ground)}
    <line x1="${w1}" y1="326" x2="${w2}" y2="326" class="dim-line"/><line x1="${w1}" y1="318" x2="${w1}" y2="334" class="dim-line"/><line x1="${w2}" y1="318" x2="${w2}" y2="334" class="dim-line"/>
    <text x="${(w1 + w2) / 2}" y="340" text-anchor="middle" class="dim">WHEELBASE · ${BODY_LABELS[body].toUpperCase()}</text>
    ${hotspots}
  </g>`;
}

export function vehicleStage(packages: PackageRow[], currency: string): SafeHtml {
  const zones = Object.keys(VEHICLE_ZONES);
  const byZone = (z: string) => packages.filter((p) => p.zone === z && p.category !== 'addon');
  const svg = `<svg class="vehicle" viewBox="20 40 760 310" role="img" aria-label="Interactive vehicle diagram — tap a system to see services">
    <defs><linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.07"/><stop offset="1" stop-color="currentColor" stop-opacity="0.01"/></linearGradient></defs>
    <line x1="30" y1="318" x2="770" y2="318" class="dim-line" style="stroke-dasharray:none;opacity:.5"/>
    ${BODIES.map((b) => silhouette(b, b === 'suv')).join('')}
  </svg>`;
  return html`<div class="stage" data-stage>
  <div class="stage-canvas">
    <div class="stage-toolbar">
      <span class="badge badge-accent"><span class="dot dot-live"></span>Studio stage</span>
      <div class="seg" role="group" aria-label="Vehicle body style">${BODIES.map((b) => html`<button type="button" data-body-btn="${b}" aria-pressed="${b === 'suv' ? 'true' : 'false'}">${BODY_LABELS[b].split(' ')[0]}</button>`)}</div>
    </div>
    ${raw(svg)}
    <p class="faint mono" style="position:relative;font-size:.72rem;letter-spacing:.08em;margin:6px 0 0;text-align:center">TAP A HOTSPOT TO EXPLORE EACH SYSTEM</p>
  </div>
  <div class="stage-panel">
    ${zones.map((z, i) => html`<div data-zone-panel="${z}"${i === 0 ? '' : raw(' hidden')}>
      <span class="eyebrow">System ${String(i + 1).padStart(2, '0')}</span>
      <div class="zone-title">${VEHICLE_ZONES[z]!.label}</div>
      <p class="muted">${VEHICLE_ZONES[z]!.blurb}</p>
      <div class="zone-list">${byZone(z).slice(0, 5).map((p) => html`<a class="zone-item" href="/book?package=${p.slug}"><span><b>${p.name}</b><br><span class="meta">${icon('clock')}${Math.round(p.duration_min / 60 * 10) / 10 >= 1 ? `${Math.round(p.duration_min / 6) / 10} hr` : `${p.duration_min} min`}</span></span><span class="price" style="font-size:1rem">${p.price_s === p.price_l ? money(p.price_m, currency) : html`<small>from</small>${money(p.price_s, currency)}`}</span></a>`)}</div>
      ${byZone(z).length === 0 ? html`<p class="muted">Ask us about work on this system — <a href="/book" class="accent">request a quote</a>.</p>` : ''}
    </div>`)}
  </div>
</div>`;
}
