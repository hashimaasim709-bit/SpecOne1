// Decrypt and decompress a nightly backup downloaded from R2.
//   BACKUP_ENCRYPTION_KEY=... npm run backup:decrypt -- specone-2026-11-13T03-15-00.json.gz.enc
// Writes the plain JSON export next to the input file.
import { webcrypto as crypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
const secret = process.env.BACKUP_ENCRYPTION_KEY;
if (!file) {
  console.error('Usage: npm run backup:decrypt -- <backup file>');
  process.exit(1);
}
let bytes = new Uint8Array(await readFile(file));
const magic = new TextEncoder().encode('S1BK1');
if (magic.every((b, i) => bytes[i] === b)) {
  if (!secret) {
    console.error('This backup is encrypted. Set BACKUP_ENCRYPTION_KEY to the secret used on the Worker.');
    process.exit(1);
  }
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`specone-backup:${secret}`));
  const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['decrypt']);
  bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(5, 17) }, key, bytes.slice(17)));
}
const json = gunzipSync(bytes).toString('utf8');
const out = file.replace(/(\.json)?\.gz(\.enc)?$/, '') + '.json';
await writeFile(out, json);
const data = JSON.parse(json);
console.log(`Wrote ${out}: ${Object.keys(data.tables).length} tables, generated ${data.generated_at}`);
