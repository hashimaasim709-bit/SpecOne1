// Renders the S1 emblem and shortcut glyphs to the PNG icons in public/icons using a
// headless browser. The generated files are committed; re-run only to change the artwork.
//   npm run icons        (needs Playwright: npx playwright install chromium)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/icons');

const emblem = (stroke = 2.5) => `
  <circle cx="32" cy="32" r="30" fill="#0b0d12" stroke="#e11d48" stroke-width="${stroke}"/>
  <circle cx="32" cy="32" r="25" fill="none" stroke="rgba(255,255,255,.16)" stroke-dasharray="2 3"/>
  <path d="M15 45A21 21 0 1 1 49 45" fill="none" stroke="#262b38" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M15 45A21 21 0 0 1 47 18" fill="none" stroke="#ff2e55" stroke-width="4.5" stroke-linecap="round"/>
  <line x1="32" y1="32" x2="45" y2="19" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="4.6" fill="#e11d48" stroke="#fff" stroke-width="1.6"/>
  <text x="32" y="56" fill="#f2f4f8" font-size="9" font-weight="800" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" letter-spacing="1.5">S1</text>`;

const square = (size, pad, bg = 'radial-gradient(circle at 50% 30%, #2a0912, #07080b 70%)') => `<!doctype html><html><body style="margin:0">
  <div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg}">
    <svg viewBox="0 0 64 64" width="${size - pad * 2}" height="${size - pad * 2}">${emblem()}</svg>
  </div></body></html>`;

const glyphs = {
  book: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 14.5l2 2 4-4"/>',
  sos: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2h.01"/>',
  garage: '<path d="M4 15.5V12l2-4.5A2 2 0 0 1 7.8 6h8.4a2 2 0 0 1 1.8 1.5L20 12v3.5a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="16.5" r="1.8"/><circle cx="17" cy="16.5" r="1.8"/><path d="M4.5 12h15"/>',
  jobs: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
};
const shortcut = (g, colour) => `<!doctype html><html><body style="margin:0"><div style="width:96px;height:96px;border-radius:24px;display:grid;place-items:center;background:${colour}">
  <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${g}</svg></div></body></html>`;

const og = `<!doctype html><html><head><style>
  body{margin:0;width:1200px;height:630px;background:#07080b;color:#eef1f6;font-family:'DejaVu Sans',sans-serif;overflow:hidden;position:relative}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px}
  .glow{position:absolute;right:-200px;top:-240px;width:900px;height:900px;background:radial-gradient(circle,rgba(225,29,72,.45),transparent 60%)}
  .c{position:absolute;left:84px;top:110px;right:84px}
  h1{font-size:92px;line-height:.95;margin:28px 0 0;font-weight:800;letter-spacing:-2px;text-transform:uppercase}
  h1 span{color:#ff2e55}
  p{font-size:30px;color:#c8ced8;margin:26px 0 0}
  .bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#e11d48,#ff2e55)}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="c"><svg viewBox="0 0 64 64" width="120" height="120">${emblem()}</svg>
<h1>Dealer-level diagnostics.<br><span>On your driveway.</span></h1><p>Mobile diagnostics · OEM coding · DPF recovery · detailing</p></div><div class="bar"></div></body></html>`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(htmlDoc, file, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(htmlDoc);
  await page.screenshot({ path: path.join(out, file), omitBackground: false, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote', file);
}
await shot(square(512, 40), 'icon-512.png', 512, 512);
await shot(square(192, 16), 'icon-192.png', 192, 192);
await shot(square(512, 104), 'maskable-512.png', 512, 512);
await shot(square(180, 18, '#07080b'), 'apple-touch-icon.png', 180, 180);
await shot(square(48, 2, '#07080b'), 'favicon-48.png', 48, 48);
await shot(shortcut(glyphs.book, 'linear-gradient(180deg,#ff2e55,#e11d48)'), 'shortcut-book.png', 96, 96);
await shot(shortcut(glyphs.sos, '#d4a106'), 'shortcut-sos.png', 96, 96);
await shot(shortcut(glyphs.garage, '#059669'), 'shortcut-garage.png', 96, 96);
await shot(shortcut(glyphs.jobs, '#1c212c'), 'shortcut-jobs.png', 96, 96);
await shot(og, 'og-image.png', 1200, 630);
await browser.close();
await writeFile(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${emblem()}</svg>\n`);
console.log('wrote icon.svg');
