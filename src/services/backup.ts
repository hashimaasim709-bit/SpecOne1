// Database export and encrypted cloud backups.
//
// Nightly: every table is exported to JSON, gzip-compressed, encrypted with AES-256-GCM
// (key derived from the BACKUP_ENCRYPTION_KEY secret) and written to R2 under backups/.
// The same export powers the admin's one-click data download. D1's built-in Time Travel
// (30-day point-in-time restore) remains available as a second line of defence.
import type { Env } from '../env';
import { decryptBackup, encryptBackup, gunzip, gzip, isEncryptedBackup } from '../lib/crypto';
import { all, first, run } from '../lib/db';

const SKIP = new Set(['d1_migrations', 'media_blobs', 'sessions', 'rate_limits', 'auth_challenges']);
const RETAIN = 30;

export interface DatabaseExport {
  format: 'specone-export';
  version: 2;
  generated_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportDatabase(db: D1Database): Promise<{ data: DatabaseExport; tables: number; rows: number }> {
  const names = (await all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"))
    .map((t) => t.name)
    .filter((n) => !SKIP.has(n) && /^[a-z0-9_]+$/.test(n));
  const tables: DatabaseExport['tables'] = {};
  let rows = 0;
  for (const name of names) {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 2000) {
      // Table names come from sqlite_master and are validated above; values never reach the SQL text.
      const page = await all(db, `SELECT * FROM "${name}" LIMIT 2000 OFFSET ?`, offset);
      out.push(...page);
      if (page.length < 2000) break;
    }
    // Never export credential material.
    if (name === 'users') out.forEach((r) => delete r.password_hash);
    if (name === 'passkeys') out.forEach((r) => delete r.public_key);
    tables[name] = out;
    rows += out.length;
  }
  return { data: { format: 'specone-export', version: 2, generated_at: new Date().toISOString(), tables }, tables: names.length, rows };
}

export interface BackupResult {
  ok: boolean;
  key: string;
  size: number;
  encrypted: boolean;
  message: string;
}

export async function runBackup(env: Env, trigger: 'cron' | 'manual'): Promise<BackupResult> {
  if (!env.MEDIA) return { ok: false, key: '', size: 0, encrypted: false, message: 'R2 storage is not connected, so cloud backups are unavailable. Use the manual download instead.' };
  const { data, tables, rows } = await exportDatabase(env.DB);
  const compressed = await gzip(new TextEncoder().encode(JSON.stringify(data)));
  const encrypted = !!env.BACKUP_ENCRYPTION_KEY;
  const body = encrypted ? await encryptBackup(compressed, env.BACKUP_ENCRYPTION_KEY!) : compressed;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const key = `backups/specone-${stamp}.json.gz${encrypted ? '.enc' : ''}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { tables: String(tables), rows: String(rows), trigger } });
  await run(env.DB, 'INSERT INTO backups (storage_key, size, tables, row_count, encrypted, trigger) VALUES (?, ?, ?, ?, ?, ?)', key, body.length, tables, rows, encrypted, trigger);

  // Retention: keep the most recent snapshots, delete the rest from R2 and the index.
  const old = await all<{ id: number; storage_key: string }>(env.DB, 'SELECT id, storage_key FROM backups ORDER BY id DESC LIMIT -1 OFFSET ?', RETAIN);
  for (const b of old) {
    await env.MEDIA.delete(b.storage_key);
    await run(env.DB, 'DELETE FROM backups WHERE id = ?', b.id);
  }
  return { ok: true, key, size: body.length, encrypted, message: encrypted ? 'Encrypted backup stored.' : 'Backup stored unencrypted — set the BACKUP_ENCRYPTION_KEY secret to encrypt future backups.' };
}

/** Fetch a stored backup and return it as gzip-compressed JSON, decrypting if needed. */
export async function readBackup(env: Env, id: number): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const row = await first<{ storage_key: string }>(env.DB, 'SELECT storage_key FROM backups WHERE id = ?', id);
  if (!row || !env.MEDIA) return null;
  const obj = await env.MEDIA.get(row.storage_key);
  if (!obj) return null;
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await obj.arrayBuffer());
  if (isEncryptedBackup(bytes)) {
    if (!env.BACKUP_ENCRYPTION_KEY) return null;
    bytes = new Uint8Array(await decryptBackup(bytes, env.BACKUP_ENCRYPTION_KEY));
  }
  // Sanity-check that the payload decompresses before handing it over.
  await gunzip(bytes.slice(0));
  return { bytes, filename: row.storage_key.replace(/^backups\//, '').replace(/\.enc$/, '') };
}

/** RFC 4180 CSV for a set of rows. Formula-leading cells are neutralised for spreadsheet safety. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}
