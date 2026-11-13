import { describe, expect, it } from 'vitest';
import { addMonths, formatReg, isUkPostcode, money, normPhone, normPostcode, regYear } from '../shared/format';
import { classifyVehicle } from '../shared/vehicle';
import { decryptBackup, encryptBackup, gunzip, gzip, hashPassword, randomCode, verifyPassword } from '../src/lib/crypto';
import { escapeHtml, html, jsonForScript, markdown, raw } from '../src/lib/html';
import { sniffMediaType } from '../src/lib/security';
import { lexiconSentiment } from '../src/services/sentiment';
import { toCsv } from '../src/services/backup';
import { verifyStripeSignature } from '../src/services/payments';
import { isSafeWebhookUrl } from '../src/services/webhooks';
import { hmacSha256Hex } from '../src/lib/crypto';
// @ts-expect-error — plain ESM build script without type declarations
import { splitSql } from '../scripts/build.mjs';

describe('formatting', () => {
  it('formats money in pounds', () => {
    expect(money(9500)).toBe('£95');
    expect(money(1850)).toBe('£18.50');
  });
  it('normalises UK phone numbers and plates', () => {
    expect(normPhone('07351 453451')).toBe('+447351453451');
    expect(normPhone('+44 7351 453451')).toBe('+447351453451');
    expect(formatReg('gy75awv')).toBe('GY75 AWV');
    expect(regYear('GY75AWV')).toBe(2025);
    expect(regYear('AB12CDE')).toBe(2012);
  });
  it('validates and formats postcodes', () => {
    expect(isUkPostcode('BN21 4AB')).toBe(true);
    expect(isUkPostcode('NOTAPC')).toBe(false);
    expect(normPostcode('bn214ab')).toBe('BN21 4AB');
  });
  it('adds months without overflowing short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-16', 11)).toBe('2027-10-16');
  });
  it('classifies vehicles by size and body', () => {
    expect(classifyVehicle('Land Rover Range Rover Sport')).toEqual({ size: 'L', body: 'suv' });
    expect(classifyVehicle('Ford Fiesta')).toEqual({ size: 'S', body: 'hatchback' });
    expect(classifyVehicle('Ford Transit Custom')).toEqual({ size: 'L', body: 'van' });
  });
});

describe('security primitives', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(h.startsWith('pbkdf2$100000$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('generates codes from an unambiguous alphabet', () => {
    expect(randomCode(12)).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
  it('round-trips encrypted, compressed backups', async () => {
    const data = new Uint8Array(new TextEncoder().encode(JSON.stringify({ hello: 'world'.repeat(50) })));
    const enc = await encryptBackup(await gzip(data), 'secret-key');
    const dec = await gunzip(new Uint8Array(await decryptBackup(new Uint8Array(enc), 'secret-key')));
    expect(new TextDecoder().decode(dec)).toContain('worldworld');
    await expect(decryptBackup(new Uint8Array(enc), 'wrong-key')).rejects.toThrow();
  });
  it('verifies Stripe webhook signatures', async () => {
    const payload = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex('whsec_test', `${t}.${payload}`);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_test')).toBe(true);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'other')).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t - 1000},v1=${sig}`, 'whsec_test')).toBe(false);
  });
  it('sniffs real file types from magic bytes', () => {
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.type).toBe('image/jpeg');
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))?.type).toBe('image/png');
    expect(sniffMediaType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });
  it('rejects private webhook targets', () => {
    expect(isSafeWebhookUrl('https://hooks.zapier.com/hooks/catch/1/abc')).toBe(true);
    expect(isSafeWebhookUrl('http://hooks.zapier.com/x')).toBe(false);
    expect(isSafeWebhookUrl('https://localhost/x')).toBe(false);
    expect(isSafeWebhookUrl('https://192.168.1.10/x')).toBe(false);
  });
});

describe('HTML safety', () => {
  it('escapes interpolations unless explicitly raw', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<p>${name}</p>`.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html`<p>${raw('<b>ok</b>')}</p>`.value).toBe('<p><b>ok</b></p>');
    expect(escapeHtml('"')).toBe('&quot;');
  });
  it('never lets JSON close a script tag', () => {
    expect(jsonForScript({ x: '</script><script>alert(1)</script>' }).value).not.toContain('</script>');
  });
  it('renders admin markdown safely', () => {
    const out = markdown('## Title\n\n- one\n- **two**\n\n<img src=x onerror=alert(1)>\n\n[link](javascript:alert(1))').value;
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>two</strong>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('href="javascript');
  });
  it('neutralises spreadsheet formulas but keeps phone numbers', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: '+447351453451' }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain(',+447351453451');
  });
});

describe('sentiment fallback', () => {
  it('scores obvious praise and complaints', () => {
    expect(lexiconSentiment('Brilliant service, very professional and quick. Highly recommend!', 5).label).toBe('positive');
    expect(lexiconSentiment('Arrived late, rude and the problem is still not fixed.', 1).label).toBe('negative');
    expect(lexiconSentiment('not good at all', null).score).toBeLessThan(0);
  });
});

describe('migration splitter', () => {
  it('keeps triggers intact and ignores comments and quoted semicolons', () => {
    const out = splitSql("-- c\nCREATE TABLE a (x TEXT DEFAULT 'a;b');\nCREATE TRIGGER t BEFORE DELETE ON a BEGIN SELECT RAISE(ABORT, 'no;'); END;\nINSERT INTO a VALUES ('it''s');");
    expect(out).toHaveLength(3);
    expect(out[1]).toMatch(/^CREATE TRIGGER t .* END$/);
    expect(out[2]).toContain("'it''s'");
  });
});
