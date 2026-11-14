// QR codes for printed flyers, the rate card and trade material. Rendered as vector shapes
// (SVG for web pages, rectangles for PDFs) so they stay sharp at any print size.
import qrcode from 'qrcode-generator';

/** Square matrix of dark (true) / light (false) modules. Medium error correction survives smudged print. */
export function qrMatrix(text: string): boolean[][] {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** Inline SVG with a quiet zone. Adjacent dark modules in a row are merged into one path segment. */
export function qrSvg(text: string, o: { label?: string; dark?: string; light?: string; margin?: number } = {}): string {
  const m = qrMatrix(text);
  const n = m.length;
  const margin = o.margin ?? 4;
  const size = n + margin * 2;
  let d = '';
  m.forEach((row, r) => {
    let c = 0;
    while (c < n) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && row[c]) c++;
      d += `M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`;
    }
  });
  const label = (o.label ?? 'QR code').replace(/[<>&"]/g, '');
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${o.light ?? '#fff'}"/><path d="${d}" fill="${o.dark ?? '#0b0d12'}"/></svg>`;
}
