// Leaflet helpers: OpenStreetMap tiles (tinted to the theme in CSS), coverage rings and pins.
import L from 'leaflet';

export type LatLng = [number, number];
const ZONE_COLOURS = ['#10b981', '#f5a524', '#ff2e55', '#38bdf8'];

export function createMap(el: HTMLElement, center: LatLng, zoom = 10): L.Map {
  const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  // Re-enable scroll zoom only after the user interacts, so the page scrolls normally.
  map.once('focus', () => map.scrollWheelZoom.enable());
  return map;
}

export const pinIcon = (cls = ''): L.DivIcon => L.divIcon({ className: '', html: `<div class="map-pin ${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

export function vanIcon(heading: number | null): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="van-marker" style="transform:rotate(${heading ?? 0}deg)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${-(heading ?? 0)}deg)"><path d="M3 16V7.5A1.5 1.5 0 0 1 4.5 6H14v10M14 9h3.5l3.5 4v3h-1.5"/><circle cx="7" cy="17" r="1.9"/><circle cx="17" cy="17" r="1.9"/><path d="M9 17h6"/></svg></div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

export function drawZones(map: L.Map, base: LatLng, bands: { upTo: number; label: string }[]): void {
  [...bands].sort((a, b) => b.upTo - a.upTo).forEach((band) => {
    const i = [...bands].sort((a, b) => a.upTo - b.upTo).indexOf(band);
    const colour = ZONE_COLOURS[i % ZONE_COLOURS.length]!;
    L.circle(base, { radius: band.upTo * 1609.34, color: colour, weight: 1.5, opacity: 0.8, fillColor: colour, fillOpacity: 0.06, dashArray: i === 0 ? undefined : '6 6' }).addTo(map).bindTooltip(band.label, { sticky: true });
  });
  L.marker(base, { icon: pinIcon(), keyboard: false }).addTo(map).bindTooltip('Lab base');
}

export { L };
