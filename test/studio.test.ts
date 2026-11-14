import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from '../src/lib/qr';
import { DEFAULT_SETTINGS, siteSections } from '../src/lib/settings';

describe('QR codes', () => {
  it('builds a square matrix with finder patterns in three corners', () => {
    const m = qrMatrix('https://speconeautolabs.co.uk/book?src=rate-card');
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === n)).toBe(true);
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as [number, number][]) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 6]![c + 6]).toBe(true);
      expect(m[r + 3]![c + 3]).toBe(true);
    }
  });
  it('renders escaped, self-contained SVG', () => {
    const svg = qrSvg('https://example.com', { label: '<b>Scan</b>' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('aria-label="bScan/b"');
  });
});

describe('website studio sections', () => {
  it('keeps the hero first and on, drops unknown keys and appends new sections', () => {
    const site = { ...DEFAULT_SETTINGS.site, sections: [{ key: 'faq', on: false }, { key: 'bogus', on: true }, { key: 'hero', on: false }, { key: 'faq', on: true }] } as unknown as typeof DEFAULT_SETTINGS.site;
    const out = siteSections(site);
    expect(out[0]).toEqual({ key: 'hero', on: true });
    expect(out[1]).toEqual({ key: 'faq', on: false });
    expect(out.filter((s) => s.key === 'faq')).toHaveLength(1);
    expect(out.some((s) => (s.key as string) === 'bogus')).toBe(false);
    expect(out).toHaveLength(DEFAULT_SETTINGS.site.sections.length);
  });
});
