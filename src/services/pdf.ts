// Branded PDF documents (invoices, certificates, inspection and job reports), drawn
// directly with pdf-lib so they render identically everywhere and need no headless browser.
// Every page carries a vector header and footer; an uploaded logo replaces the S1 emblem.
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';

const W = 595.28;
const H = 841.89;
const M = 44;
const INNER = W - M * 2;

const C = {
  ink: rgb(0.06, 0.07, 0.09),
  body: rgb(0.2, 0.22, 0.26),
  muted: rgb(0.45, 0.48, 0.53),
  line: rgb(0.87, 0.88, 0.9),
  panel: rgb(0.96, 0.965, 0.972),
  obsidian: rgb(0.03, 0.035, 0.045),
  steel: rgb(0.62, 0.65, 0.7),
  crimson: rgb(0.88, 0.11, 0.28),
  good: rgb(0.02, 0.55, 0.38),
  warn: rgb(0.8, 0.5, 0.02),
  bad: rgb(0.82, 0.13, 0.13),
  white: rgb(1, 1, 1),
};
export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
const toneColor = (t: Tone): RGB => (t === 'good' ? C.good : t === 'warn' ? C.warn : t === 'bad' ? C.bad : C.muted);

/** The standard PDF fonts only cover WinAnsi; swap or drop anything outside it so drawing never throws. */
export function pdfSafe(input: unknown): string {
  return String(input ?? '')
    .replace(/Ω/g, 'ohm').replace(/[✓✔]/g, 'Yes').replace(/[✗✘]/g, 'No').replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/[‐‑−]/g, '-').replace(/[\t\r]/g, ' ')
    .replace(/[^\n\x20-\x7E -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '');
}

export interface PdfBrand {
  name: string;
  tagline: string;
  contact: string[];
  footer: string;
  logo?: { bytes: Uint8Array; type: string } | null;
}

export interface Column {
  label: string;
  /** Fraction of the content width. */
  width: number;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  bold?: boolean;
  tones?: boolean;
}

export class Doc {
  pdf!: PDFDocument;
  page!: PDFPage;
  y = 0;
  regular!: PDFFont;
  bold!: PDFFont;
  mono!: PDFFont;
  monoBold!: PDFFont;
  private logo: PDFImage | null = null;

  private constructor(private brand: PdfBrand, private title: string, private meta: [string, string][]) {}

  static async create(brand: PdfBrand, title: string, meta: [string, string][]): Promise<Doc> {
    const d = new Doc(brand, title, meta);
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(pdfSafe(`${title} — ${brand.name}`));
    d.pdf.setAuthor(pdfSafe(brand.name));
    d.pdf.setCreator('SpecOne Auto Labs platform');
    d.regular = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.mono = await d.pdf.embedFont(StandardFonts.Courier);
    d.monoBold = await d.pdf.embedFont(StandardFonts.CourierBold);
    if (brand.logo) {
      try {
        d.logo = brand.logo.type === 'image/png' ? await d.pdf.embedPng(brand.logo.bytes) : brand.logo.type === 'image/jpeg' ? await d.pdf.embedJpg(brand.logo.bytes) : null;
      } catch {
        d.logo = null;
      }
    }
    d.addPage(true);
    return d;
  }

  width(text: string, size: number, font: PDFFont = this.regular): number {
    return font.widthOfTextAtSize(pdfSafe(text), size);
  }

  draw(text: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: RGB; align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}): void {
    const size = o.size ?? 10;
    const font = o.font ?? this.regular;
    let t = pdfSafe(text).replace(/\n/g, ' ');
    if (o.maxWidth) while (t.length > 1 && font.widthOfTextAtSize(t, size) > o.maxWidth) t = `${t.slice(0, -2).trimEnd()}…`;
    const w = font.widthOfTextAtSize(t, size);
    const dx = o.align === 'right' ? -w : o.align === 'center' ? -w / 2 : 0;
    this.page.drawText(t, { x: x + dx, y, size, font, color: o.color ?? C.ink });
  }

  wrap(text: string, size: number, maxWidth: number, font: PDFFont = this.regular): string[] {
    const lines: string[] = [];
    for (const raw of pdfSafe(text).split('\n')) {
      let line = '';
      for (const word of raw.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
        else {
          if (line) lines.push(line);
          line = word;
          while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private emblem(x: number, top: number, size: number): void {
    const s = size / 64;
    const p = this.page;
    p.drawCircle({ x: x + size / 2, y: top - size / 2, size: 30 * s, color: C.obsidian, borderColor: C.crimson, borderWidth: 2.2 * s });
    p.drawSvgPath('M15 45 A21 21 0 1 1 49 45', { x, y: top, scale: s, borderColor: rgb(0.2, 0.22, 0.27), borderWidth: 4.5 * s, borderLineCap: LineCapStyle.Round });
    p.drawSvgPath('M15 45 A21 21 0 0 1 47 18', { x, y: top, scale: s, borderColor: C.crimson, borderWidth: 4.5 * s, borderLineCap: LineCapStyle.Round });
    p.drawLine({ start: { x: x + 32 * s, y: top - 32 * s }, end: { x: x + 45 * s, y: top - 19 * s }, thickness: 2.4 * s, color: C.white, lineCap: LineCapStyle.Round });
    p.drawCircle({ x: x + 32 * s, y: top - 32 * s, size: 4.2 * s, color: C.crimson, borderColor: C.white, borderWidth: 1.2 * s });
  }

  addPage(first = false): void {
    this.page = this.pdf.addPage([W, H]);
    const bandH = first ? 104 : 44;
    this.page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: C.obsidian });
    this.page.drawRectangle({ x: 0, y: H - bandH - 3, width: W, height: 3, color: C.crimson });
    if (first) {
      let textX = M;
      if (this.logo) {
        const scale = Math.min(150 / this.logo.width, 50 / this.logo.height);
        this.page.drawImage(this.logo, { x: M, y: H - 27 - this.logo.height * scale, width: this.logo.width * scale, height: this.logo.height * scale });
        this.draw(this.brand.tagline.toUpperCase(), M, H - 92, { size: 6.8, font: this.mono, color: C.steel });
      } else {
        this.emblem(M, H - 24, 50);
        textX = M + 62;
        this.draw(this.brand.name.toUpperCase(), textX, H - 48, { size: 15, font: this.bold, color: C.white });
        this.draw(this.brand.tagline.toUpperCase(), textX, H - 62, { size: 6.8, font: this.mono, color: C.steel });
      }
      this.draw(this.title.toUpperCase(), W - M, H - 46, { size: 19, font: this.bold, color: C.white, align: 'right' });
      this.meta.slice(0, 4).forEach(([k, v], i) => this.draw(`${k.toUpperCase()}  ${v}`, W - M, H - 62 - i * 10.5, { size: 7.6, font: this.mono, color: C.steel, align: 'right' }));
    } else {
      this.draw(this.brand.name.toUpperCase(), M, H - 27, { size: 9.5, font: this.bold, color: C.white });
      this.draw(`${this.title.toUpperCase()}${this.meta[0] ? `  ·  ${this.meta[0][1]}` : ''}`, W - M, H - 27, { size: 7.6, font: this.mono, color: C.steel, align: 'right' });
    }
    this.y = H - bandH - 30;
  }

  ensure(height: number): void {
    if (this.y - height < M + 34) this.addPage();
  }

  gap(n = 10): void {
    this.y -= n;
  }

  heading(text: string, tag = ''): void {
    this.ensure(46);
    this.y -= 6;
    if (tag) {
      this.draw(tag.toUpperCase(), M, this.y, { size: 6.8, font: this.monoBold, color: C.crimson });
      this.y -= 13;
    }
    this.draw(text, M, this.y, { size: 12.5, font: this.bold });
    this.y -= 7;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.7, color: C.line });
    this.y -= 14;
  }

  para(text: string, o: { size?: number; color?: RGB; x?: number; width?: number; font?: PDFFont; leading?: number } = {}): void {
    const size = o.size ?? 9.5;
    const leading = o.leading ?? size * 1.45;
    for (const line of this.wrap(text, size, o.width ?? INNER, o.font ?? this.regular)) {
      this.ensure(leading);
      if (line) this.draw(line, o.x ?? M, this.y, { size, color: o.color ?? C.body, font: o.font });
      this.y -= leading;
    }
  }

  /** Label/value grid. */
  kv(pairs: [string, string][], cols = 2): void {
    const colW = INNER / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const heights = row.map(([, v]) => this.wrap(v || '—', 9.5, colW - 14, this.bold).length);
      const rowH = 13 + Math.max(...heights) * 12.5;
      this.ensure(rowH);
      row.forEach(([k, v], c) => {
        const x = M + c * colW;
        this.draw(k.toUpperCase(), x, this.y, { size: 6.6, font: this.mono, color: C.muted });
        this.wrap(v || '—', 9.5, colW - 14, this.bold).forEach((line, li) => this.draw(line, x, this.y - 12 - li * 12.5, { size: 9.5, font: this.bold }));
      });
      this.y -= rowH + 3;
    }
  }

  table(cols: Column[], rows: string[][], o: { zebra?: boolean; size?: number } = {}): void {
    const size = o.size ?? 9;
    const xs: number[] = [];
    let acc = M;
    for (const c of cols) {
      xs.push(acc);
      acc += c.width * INNER;
    }
    const head = (): void => {
      this.page.drawRectangle({ x: M, y: this.y - 6, width: INNER, height: 19, color: C.obsidian });
      cols.forEach((c, i) => {
        const cw = c.width * INNER;
        const x = c.align === 'right' ? xs[i]! + cw - 7 : c.align === 'center' ? xs[i]! + cw / 2 : xs[i]! + 7;
        this.draw(c.label.toUpperCase(), x, this.y, { size: 6.6, font: this.monoBold, color: C.white, align: c.align });
      });
      this.y -= 22;
    };
    this.ensure(48);
    head();
    rows.forEach((row, r) => {
      const wrapped = row.map((cell, i) => this.wrap(cell ?? '', size, cols[i]!.width * INNER - 14, cols[i]!.mono ? this.mono : cols[i]!.bold ? this.bold : this.regular));
      const rowH = Math.max(...wrapped.map((w) => w.length)) * (size + 3.2) + 7;
      if (this.y - rowH < M + 34) {
        this.addPage();
        head();
      }
      if (o.zebra !== false && r % 2 === 0) this.page.drawRectangle({ x: M, y: this.y - rowH + size + 1, width: INNER, height: rowH, color: C.panel });
      wrapped.forEach((lines, i) => {
        const c = cols[i]!;
        const cw = c.width * INNER;
        const x = c.align === 'right' ? xs[i]! + cw - 7 : c.align === 'center' ? xs[i]! + cw / 2 : xs[i]! + 7;
        const tone = c.tones ? statusTone(row[i] ?? '') : null;
        lines.forEach((line, li) => this.draw(line, x, this.y - li * (size + 3.2), { size, font: c.mono ? this.mono : c.bold || tone ? this.bold : this.regular, align: c.align, color: tone ? toneColor(tone) : C.ink }));
      });
      this.y -= rowH;
    });
    this.page.drawLine({ start: { x: M, y: this.y + 7 }, end: { x: W - M, y: this.y + 7 }, thickness: 0.7, color: C.line });
    this.y -= 6;
  }

  /** Right-aligned totals block. The last strong row is rendered as the headline figure. */
  totals(rows: { label: string; value: string; strong?: boolean; tone?: Tone }[]): void {
    const boxW = 230;
    const x = W - M - boxW;
    this.ensure(rows.length * 16 + 22);
    for (const r of rows) {
      if (r.strong) {
        this.y -= 9;
        this.page.drawRectangle({ x, y: this.y - 8, width: boxW, height: 25, color: C.obsidian });
        this.draw(r.label.toUpperCase(), x + 10, this.y, { size: 7.6, font: this.monoBold, color: C.white });
        this.draw(r.value, W - M - 10, this.y - 1, { size: 13, font: this.bold, color: C.white, align: 'right' });
        this.y -= 31;
      } else {
        this.draw(r.label, x + 10, this.y, { size: 9, color: C.muted });
        this.draw(r.value, W - M - 10, this.y, { size: 9.5, font: this.mono, align: 'right', color: r.tone ? toneColor(r.tone) : C.ink });
        this.y -= 15.5;
      }
    }
  }

  badge(text: string, tone: Tone, x: number, y: number, size = 8): number {
    const label = pdfSafe(text).toUpperCase();
    const w = this.monoBold.widthOfTextAtSize(label, size) + 16;
    this.page.drawRectangle({ x, y: y - 5, width: w, height: size + 10, color: toneColor(tone) });
    this.draw(label, x + 8, y, { size, font: this.monoBold, color: C.white });
    return w;
  }

  /** Horizontal gauge bar with a value readout — used on battery and DPF results. */
  gauge(label: string, valueText: string, fraction: number, tone: Tone, note = ''): void {
    this.ensure(40);
    const barX = M + 190;
    const barW = INNER - 190 - 96;
    this.draw(label, M, this.y, { size: 9.5, font: this.bold });
    if (note) this.draw(note, M, this.y - 11, { size: 7.2, font: this.mono, color: C.muted, maxWidth: 180 });
    this.page.drawRectangle({ x: barX, y: this.y - 3, width: barW, height: 9, color: C.panel, borderColor: C.line, borderWidth: 0.5 });
    const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    if (f > 0) this.page.drawRectangle({ x: barX, y: this.y - 3, width: barW * f, height: 9, color: toneColor(tone) });
    for (let i = 1; i < 10; i++) this.page.drawLine({ start: { x: barX + (barW * i) / 10, y: this.y - 3 }, end: { x: barX + (barW * i) / 10, y: this.y - (i === 5 ? 7 : 5) }, thickness: 0.5, color: C.steel });
    this.draw(valueText, W - M, this.y - 1, { size: 11, font: this.monoBold, align: 'right', color: toneColor(tone) });
    this.y -= 30;
  }

  /** Large verdict panel. */
  verdict(title: string, detail: string, tone: Tone): void {
    const lines = this.wrap(detail, 9.5, INNER - 40);
    const h = 40 + lines.length * 13.5;
    this.ensure(h + 16);
    const top = this.y - 2;
    this.page.drawRectangle({ x: M, y: top - h, width: INNER, height: h, color: C.panel, borderColor: toneColor(tone), borderWidth: 1.2 });
    this.page.drawRectangle({ x: M, y: top - h, width: 5, height: h, color: toneColor(tone) });
    this.draw(title.toUpperCase(), M + 20, top - 22, { size: 14, font: this.bold, color: toneColor(tone) });
    lines.forEach((line, i) => this.draw(line, M + 20, top - 40 - i * 13.5, { size: 9.5, color: C.body }));
    this.y = top - h - 20;
  }

  async image(bytes: Uint8Array, type: string, maxW: number, maxH: number, x = M): Promise<void> {
    try {
      const img = type === 'image/png' ? await this.pdf.embedPng(bytes) : type === 'image/jpeg' ? await this.pdf.embedJpg(bytes) : null;
      if (!img) return;
      const s = Math.min(maxW / img.width, maxH / img.height, 1);
      this.ensure(img.height * s + 8);
      this.page.drawImage(img, { x, y: this.y - img.height * s + 8, width: img.width * s, height: img.height * s });
      this.y -= img.height * s + 6;
    } catch {
      /* unreadable image — skip it rather than fail the whole document */
    }
  }

  async signOff(left: { label: string; name: string; image?: { bytes: Uint8Array; type: string } | null; date?: string }, right?: { label: string; name: string; date?: string }): Promise<void> {
    this.ensure(92);
    const colW = INNER / 2 - 12;
    const top = this.y;
    if (left.image) {
      try {
        const img = left.image.type === 'image/png' ? await this.pdf.embedPng(left.image.bytes) : await this.pdf.embedJpg(left.image.bytes);
        const s = Math.min(colW / img.width, 46 / img.height);
        this.page.drawImage(img, { x: M, y: top - 50, width: img.width * s, height: img.height * s });
      } catch {
        /* ignore */
      }
    }
    [left, right].forEach((col, i) => {
      if (!col) return;
      const x = M + i * (colW + 24);
      this.page.drawLine({ start: { x, y: top - 54 }, end: { x: x + colW, y: top - 54 }, thickness: 0.8, color: C.ink });
      this.draw(col.label.toUpperCase(), x, top - 65, { size: 6.6, font: this.mono, color: C.muted });
      this.draw(col.name, x, top - 78, { size: 9.5, font: this.bold });
      if (col.date) this.draw(col.date, x + colW, top - 78, { size: 8, font: this.mono, color: C.muted, align: 'right' });
    });
    this.y = top - 92;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      this.page = page;
      page.drawLine({ start: { x: M, y: M + 14 }, end: { x: W - M, y: M + 14 }, thickness: 0.6, color: C.line });
      page.drawRectangle({ x: M, y: M + 13.4, width: 26, height: 1.6, color: C.crimson });
      this.draw(this.brand.contact.join('  ·  '), M, M + 3, { size: 6.8, font: this.mono, color: C.muted, maxWidth: INNER - 70 });
      this.draw(this.brand.footer, M, M - 7, { size: 6.4, color: C.muted, maxWidth: INNER - 70 });
      this.draw(`PAGE ${i + 1} / ${pages.length}`, W - M, M + 3, { size: 6.8, font: this.mono, color: C.muted, align: 'right' });
    });
    return this.pdf.save();
  }
}

function statusTone(value: string): Tone {
  const v = value.toLowerCase();
  if (/^(pass|ok|good|yes|success|green|fitted|paid)/.test(v)) return 'good';
  if (/^(advis|monitor|amber|partial|soon|due)/.test(v)) return 'warn';
  if (/^(fail|replace|red|urgent|no\b|rolled)/.test(v)) return 'bad';
  return 'neutral';
}

// ───────────────────────────── Documents ─────────────────────────────

export interface InvoiceData {
  brand: PdfBrand;
  kind: 'Invoice' | 'Receipt' | 'Quote';
  ref: string;
  issued: string;
  status: { text: string; tone: Tone };
  billTo: string[];
  job: [string, string][];
  items: { description: string; detail: string; qty: string; unit: string; total: string }[];
  totals: { label: string; value: string; strong?: boolean; tone?: Tone }[];
  payments: [string, string, string][];
  notes: string;
  terms: string;
}

export async function invoicePdf(d: InvoiceData): Promise<Uint8Array> {
  const doc = await Doc.create(d.brand, d.kind, [['No.', d.ref], ['Issued', d.issued]]);
  const top = doc.y;
  doc.draw('BILLED TO', M, top, { size: 6.6, font: doc.mono, color: C.muted });
  d.billTo.filter(Boolean).forEach((line, i) => doc.draw(line, M, top - 14 - i * 12.5, { size: i === 0 ? 11 : 9.5, font: i === 0 ? doc.bold : doc.regular, color: i === 0 ? C.ink : C.body, maxWidth: 260 }));
  const bw = doc.badge(d.status.text, d.status.tone, 0, -100);
  doc.badge(d.status.text, d.status.tone, W - M - bw, top - 2);
  doc.y = top - 22 - Math.max(d.billTo.filter(Boolean).length, 2) * 12.5;
  doc.gap(4);
  doc.kv(d.job, 3);
  doc.gap(2);
  doc.table(
    [{ label: 'Description', width: 0.56 }, { label: 'Qty', width: 0.1, align: 'right', mono: true }, { label: 'Unit', width: 0.16, align: 'right', mono: true }, { label: 'Amount', width: 0.18, align: 'right', mono: true }],
    d.items.map((i) => [i.detail ? `${i.description}\n${i.detail}` : i.description, i.qty, i.unit, i.total]),
  );
  doc.gap(6);
  doc.totals(d.totals);
  if (d.payments.length) {
    doc.heading('Payments', 'Ledger');
    doc.table([{ label: 'Date', width: 0.25, mono: true }, { label: 'Method', width: 0.5 }, { label: 'Amount', width: 0.25, align: 'right', mono: true }], d.payments, { zebra: false });
  }
  if (d.notes) {
    doc.heading('Technician notes', 'Findings');
    doc.para(d.notes);
  }
  doc.gap(8);
  doc.para(d.terms, { size: 7.6, color: C.muted });
  return doc.finish();
}

export interface BatteryCertData {
  brand: PdfBrand;
  certNo: string;
  date: string;
  vehicle: [string, string][];
  test: {
    battery_type: string; rated_cca: number | null; measured_cca: number | null; soh_pct: number | null; soc_pct: number | null; resting_v: number | null;
    cranking_v: number | null; charging_v_idle: number | null; charging_v_load: number | null; ripple_mv: number | null; verdict: 'pass' | 'monitor' | 'replace'; notes: string;
  };
  technician: string;
  credential: string;
}

const band = (v: number | null, good: [number, number], warn: [number, number]): Tone => (v == null ? 'neutral' : v >= good[0] && v <= good[1] ? 'good' : v >= warn[0] && v <= warn[1] ? 'warn' : 'bad');
const fmt = (v: number | null, unit: string, dp = 1): string => (v == null ? '—' : `${v.toFixed(dp)} ${unit}`);

/** Battery state-of-health & charging-system certificate. Thresholds follow common 12 V test practice. */
export async function batteryCertificatePdf(d: BatteryCertData): Promise<Uint8Array> {
  const t = d.test;
  const doc = await Doc.create(d.brand, 'Battery Certificate', [['Cert', d.certNo], ['Tested', d.date]]);
  doc.heading('Battery & charging system health certificate', 'Certificate of test');
  doc.kv(d.vehicle, 3);
  const verdictText = t.verdict === 'pass' ? 'Pass — battery and charging system healthy' : t.verdict === 'monitor' ? 'Monitor — serviceable, re-test advised' : 'Replace — battery or charging fault found';
  const tone: Tone = t.verdict === 'pass' ? 'good' : t.verdict === 'monitor' ? 'warn' : 'bad';
  doc.verdict(verdictText, t.notes || (t.verdict === 'pass' ? 'All measured values are within the expected range for this battery type.' : 'One or more measured values are outside the expected range. See the readings below.'), tone);
  doc.heading('Battery', '01 // Storage');
  doc.gauge('State of health (SOH)', fmt(t.soh_pct, '%', 0), (t.soh_pct ?? 0) / 100, band(t.soh_pct, [70, 100], [50, 70]), 'Healthy >= 70%');
  doc.gauge('State of charge (SOC)', fmt(t.soc_pct, '%', 0), (t.soc_pct ?? 0) / 100, band(t.soc_pct, [75, 100], [50, 75]), 'Healthy >= 75%');
  doc.gauge('Resting voltage', fmt(t.resting_v, 'V', 2), ((t.resting_v ?? 11) - 11) / 2, band(t.resting_v, [12.4, 13.2], [12.1, 12.4]), 'Healthy 12.4 – 12.9 V');
  doc.gauge('Cranking voltage', fmt(t.cranking_v, 'V', 2), ((t.cranking_v ?? 7) - 7) / 5, band(t.cranking_v, [9.6, 13], [9.0, 9.6]), 'Should stay above 9.6 V');
  if (t.rated_cca || t.measured_cca) {
    const ratio = t.rated_cca && t.measured_cca ? t.measured_cca / t.rated_cca : null;
    doc.gauge('Cold cranking amps', `${t.measured_cca ?? '—'} / ${t.rated_cca ?? '—'} A`, ratio ?? 0, band(ratio, [0.8, 2], [0.6, 0.8]), `${t.battery_type} · measured / rated`);
  }
  doc.heading('Alternator & charging', '02 // Generation');
  doc.gauge('Charging voltage — idle', fmt(t.charging_v_idle, 'V', 2), ((t.charging_v_idle ?? 12) - 12) / 3.5, band(t.charging_v_idle, [13.5, 14.9], [13.0, 15.2]), 'Expected 13.5 – 14.9 V');
  doc.gauge('Charging voltage — under load', fmt(t.charging_v_load, 'V', 2), ((t.charging_v_load ?? 12) - 12) / 3.5, band(t.charging_v_load, [13.3, 14.9], [12.8, 15.2]), 'Expected 13.3 – 14.9 V');
  doc.gauge('Diode ripple (AC)', fmt(t.ripple_mv, 'mV', 0), (t.ripple_mv ?? 0) / 500, t.ripple_mv == null ? 'neutral' : t.ripple_mv <= 100 ? 'good' : t.ripple_mv <= 250 ? 'warn' : 'bad', 'Healthy below 100 mV');
  doc.gap(6);
  doc.para('Smart-charging (BMS) vehicles vary charging voltage by design; readings were taken with the system in a charging phase. This certificate records the condition at the time of test and is not a guarantee of future performance.', { size: 7.8, color: C.muted });
  doc.gap(8);
  await doc.signOff({ label: 'Tested by', name: d.technician, date: d.date }, { label: 'Qualification', name: d.credential });
  return doc.finish();
}

export interface ChecklistReportData {
  brand: PdfBrand;
  title: string;
  ref: string;
  date: string;
  vehicle: [string, string][];
  sections: { title: string; items: { label: string; status: string; note: string }[] }[];
  score: number | null;
  maxScore: number | null;
  summary: string;
  technician: string;
  credential: string;
}

/** Vehicle health check / pre-purchase inspection report with a traffic-light result per item. */
export async function checklistReportPdf(d: ChecklistReportData): Promise<Uint8Array> {
  const doc = await Doc.create(d.brand, d.title, [['Ref', d.ref], ['Date', d.date]]);
  doc.heading(d.title, 'Inspection report');
  doc.kv(d.vehicle, 3);
  const all = d.sections.flatMap((s) => s.items);
  const count = (re: RegExp) => all.filter((i) => re.test(i.status)).length;
  const fails = count(/^(fail|red)/i);
  const advisories = count(/^(advis|amber)/i);
  const passes = count(/^(pass|green|ok)/i);
  if (d.score != null && d.maxScore) {
    const pct = d.score / d.maxScore;
    doc.gauge('Overall score', `${d.score} / ${d.maxScore}`, pct, pct >= 0.85 ? 'good' : pct >= 0.65 ? 'warn' : 'bad', `${passes} pass · ${advisories} advisory · ${fails} fail`);
  }
  doc.verdict(
    fails ? `${fails} item${fails === 1 ? '' : 's'} need attention` : advisories ? `${advisories} advisory item${advisories === 1 ? '' : 's'}` : 'No defects found',
    d.summary || (fails ? 'Items marked FAIL should be rectified before purchase or further use.' : 'See the itemised results below.'),
    fails ? 'bad' : advisories ? 'warn' : 'good',
  );
  d.sections.forEach((s, i) => {
    doc.heading(s.title, `${String(i + 1).padStart(2, '0')} // Section`);
    doc.table(
      [{ label: 'Check', width: 0.46 }, { label: 'Result', width: 0.14, tones: true }, { label: 'Notes', width: 0.4 }],
      s.items.map((it) => [it.label, it.status ? it.status.toUpperCase() : '—', it.note]),
      { size: 8.6 },
    );
  });
  doc.gap(6);
  doc.para('This report reflects a visual and electronic inspection carried out on the date shown, without dismantling. It cannot identify every latent defect and is not a warranty.', { size: 7.8, color: C.muted });
  doc.gap(8);
  await doc.signOff({ label: 'Inspected by', name: d.technician, date: d.date }, { label: 'Qualification', name: d.credential });
  return doc.finish();
}

export interface JobReportData {
  brand: PdfBrand;
  ref: string;
  date: string;
  job: [string, string][];
  findings: string;
  dtcs: string[][];
  dpf: string[][];
  flash: string[][];
  freeze: { title: string; rows: string[][]; notes: string }[];
  walkaround: string;
  signature: { bytes: Uint8Array; type: string } | null;
  signedName: string;
  signedAt: string;
  technician: string;
}

/** Technical job report: findings, DPF regeneration log, software versions, freeze-frame data and customer sign-off. */
export async function jobReportPdf(d: JobReportData): Promise<Uint8Array> {
  const doc = await Doc.create(d.brand, 'Technical Report', [['Job', d.ref], ['Date', d.date]]);
  doc.heading('Diagnostic & service report', 'Job summary');
  doc.kv(d.job, 3);
  if (d.findings) {
    doc.heading('Findings & work carried out', '01 // Findings');
    doc.para(d.findings);
  }
  if (d.dtcs.length) {
    doc.heading('Fault codes referenced', '02 // DTC');
    doc.table([{ label: 'Code', width: 0.12, mono: true, bold: true }, { label: 'Definition', width: 0.4 }, { label: 'Probable causes', width: 0.48 }], d.dtcs, { size: 8.4 });
  }
  if (d.dpf.length) {
    doc.heading('DPF regeneration log', '03 // Emissions');
    doc.table(
      [{ label: 'Procedure', width: 0.24 }, { label: 'Soot before', width: 0.15, align: 'right', mono: true }, { label: 'Soot after', width: 0.15, align: 'right', mono: true }, { label: 'dP before/after', width: 0.2, align: 'right', mono: true }, { label: 'Peak EGT', width: 0.12, align: 'right', mono: true }, { label: 'Result', width: 0.14, tones: true }],
      d.dpf, { size: 8.4 },
    );
  }
  if (d.flash.length) {
    doc.heading('Software & coding record', '04 // Modules');
    doc.table([{ label: 'Module', width: 0.2, bold: true }, { label: 'Before', width: 0.24, mono: true }, { label: 'After', width: 0.24, mono: true }, { label: 'Tool', width: 0.18 }, { label: 'Result', width: 0.14, tones: true }], d.flash, { size: 8.4 });
  }
  for (const f of d.freeze) {
    doc.heading(f.title, '05 // Live data');
    doc.table([{ label: 'Parameter', width: 0.4 }, { label: 'Value', width: 0.2, align: 'right', mono: true, bold: true }, { label: 'Unit', width: 0.12, mono: true }, { label: 'Expected', width: 0.28, mono: true }], f.rows, { size: 8.4 });
    if (f.notes) doc.para(f.notes, { size: 8.6 });
  }
  if (d.walkaround || d.signature) {
    doc.heading('Pre-work inspection & customer sign-off', '06 // Sign-off');
    if (d.walkaround) doc.para(d.walkaround);
    doc.gap(6);
    await doc.signOff({ label: 'Customer signature', name: d.signedName || '—', image: d.signature, date: d.signedAt }, { label: 'Technician', name: d.technician, date: d.date });
  }
  return doc.finish();
}

export interface PartsRequestData {
  brand: PdfBrand;
  ref: string;
  date: string;
  supplier: string;
  vehicle: [string, string][];
  items: string[][];
  notes: string;
}

export async function partsRequestPdf(d: PartsRequestData): Promise<Uint8Array> {
  const doc = await Doc.create(d.brand, 'Parts Request', [['Ref', d.ref], ['Date', d.date]]);
  doc.heading(`Parts request${d.supplier ? ` — ${d.supplier}` : ''}`, 'Supplier order');
  doc.kv(d.vehicle, 3);
  doc.table([{ label: 'Part', width: 0.46 }, { label: 'Part no.', width: 0.24, mono: true }, { label: 'Qty', width: 0.1, align: 'right', mono: true }, { label: 'For fault', width: 0.2, mono: true }], d.items);
  if (d.notes) {
    doc.gap(4);
    doc.para(d.notes);
  }
  doc.gap(8);
  doc.para('Please confirm price, availability and delivery time before dispatch. Quote the reference above on all paperwork.', { size: 8, color: C.muted });
  return doc.finish();
}
