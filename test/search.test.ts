import { describe, expect, it } from 'vitest';
import { WARNING_LIGHTS } from '../shared/warning-lights';
import { PACKAGES } from '../src/seed/catalog';
import { GUIDES_EXTRA } from '../src/seed/guides-extra';
import type { PackageRow } from '../src/services/catalog';
import { matchPackages, tokenise } from '../src/services/search';

const packages = PACKAGES as unknown as PackageRow[];
const top = (q: string) => matchPackages(packages, q)[0]?.slug;

describe('symptom advisor', () => {
  it('matches plain-English symptoms to the right service', () => {
    expect(top('car is in limp mode')).toBe('fault-pinpointing');
    expect(top('DPF light on')).toBe('dpf-regeneration');
    expect(top('adblue countdown no start')).toBe('adblue-diagnostics');
    expect(top('activate carplay')).toBe('feature-coding');
    expect(top('lost my spare key')).toBe('key-programming');
    expect(top('abs light')).toBe('abs-coding');
    expect(top('cloudy headlights')).toBe('headlight-restoration');
    expect(top('thinking of buying a used car')).toBe('pre-purchase-inspection');
  });
  it('does not confuse short terms inside longer words', () => {
    expect(matchPackages(packages, 'scratches on the door').map((p) => p.slug)).not.toContain('adblue-diagnostics');
    expect(matchPackages(packages, 'remote motor noise').map((p) => p.slug)).not.toContain('pre-mot-health-scan');
  });
  it('drops filler words', () => {
    expect(tokenise('My car has a warning light on')).toEqual([]);
    expect(tokenise('Battery keeps going flat')).toEqual(['battery', 'going', 'flat']);
  });
});

describe('content integrity', () => {
  const slugs = new Set(packages.map((p) => p.slug));
  it('every warning light links to a real package and has a unique key', () => {
    expect(new Set(WARNING_LIGHTS.map((l) => l.key)).size).toBe(WARNING_LIGHTS.length);
    for (const l of WARNING_LIGHTS) expect(slugs.has(l.package), l.key).toBe(true);
  });
  it('guide links to services point at real packages', () => {
    for (const g of GUIDES_EXTRA) {
      for (const m of g.body.matchAll(/\/services\/([a-z0-9-]+)/g)) expect(slugs.has(m[1]!), `${g.slug} → ${m[1]}`).toBe(true);
      for (const m of g.body.matchAll(/package=([a-z0-9-]+)/g)) expect(slugs.has(m[1]!), `${g.slug} → ${m[1]}`).toBe(true);
    }
  });
});
