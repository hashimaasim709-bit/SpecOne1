// Media storage. Files live in R2 when a bucket is bound; otherwise small images fall
// back to a D1 blob table so the platform still works on a database-only deployment.
import type { Ctx, Env } from '../env';
import { randomToken } from '../lib/crypto';
import { first, run, stmt } from '../lib/db';
import { HttpError, sniffMediaType } from '../lib/security';

export interface MediaRow {
  id: number;
  storage_key: string;
  kind: string;
  visibility: 'public' | 'private';
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  booking_id: number | null;
  label: string;
  attached: number;
  created_at: string;
}

const MB = 1024 * 1024;
export const LIMITS = { imageR2: 8 * MB, imageD1: 1.4 * MB, video: 95 * MB };

export const mediaUrl = (key: string | null | undefined): string => (key ? `/media/${key}` : '');

export async function storeMedia(
  env: Env, bytes: Uint8Array<ArrayBuffer>,
  meta: { kind: string; visibility: 'public' | 'private'; label?: string; bookingId?: number | null; uploadedBy?: string; width?: number | null; height?: number | null; attached?: boolean },
): Promise<MediaRow> {
  const sniffed = sniffMediaType(bytes);
  if (!sniffed) throw new HttpError(415, 'That file type is not supported. Upload a JPEG, PNG, WebP or MP4/WebM/MOV video.');
  if (sniffed.kind === 'video') {
    if (!env.MEDIA) throw new HttpError(503, 'Video uploads need R2 storage to be enabled.');
    if (bytes.length > LIMITS.video) throw new HttpError(413, 'Videos must be under 95 MB — trim the clip and try again.');
  } else if (bytes.length > (env.MEDIA ? LIMITS.imageR2 : LIMITS.imageD1)) {
    throw new HttpError(413, 'That image is too large.');
  }
  const key = `${meta.kind}/${new Date().getUTCFullYear()}/${randomToken(18)}.${sniffed.ext}`;
  if (env.MEDIA) {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: sniffed.type, cacheControl: meta.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=3600' } });
  } else {
    await stmt(env.DB, 'INSERT INTO media_blobs (storage_key, data) VALUES (?, ?)', key, bytes).run();
  }
  const { id } = await run(
    env.DB, 'INSERT INTO media (storage_key, kind, visibility, content_type, size, width, height, booking_id, label, uploaded_by, attached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    key, sniffed.kind === 'video' ? 'video' : meta.kind, meta.visibility, sniffed.type, bytes.length, meta.width ?? null, meta.height ?? null, meta.bookingId ?? null, (meta.label ?? '').slice(0, 120), meta.uploadedBy ?? '', meta.attached === false ? 0 : 1,
  );
  return (await first<MediaRow>(env.DB, 'SELECT * FROM media WHERE id = ?', id))!;
}

export async function readMediaBytes(env: Env, key: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }
  const row = await first<{ data: ArrayBuffer | number[] }>(env.DB, 'SELECT data FROM media_blobs WHERE storage_key = ?', key);
  return row ? new Uint8Array(row.data as ArrayBuffer) : null;
}

export async function deleteMedia(env: Env, id: number): Promise<void> {
  const row = await first<{ storage_key: string }>(env.DB, 'SELECT storage_key FROM media WHERE id = ?', id);
  if (!row) return;
  if (env.MEDIA) await env.MEDIA.delete(row.storage_key);
  await env.DB.batch([stmt(env.DB, 'DELETE FROM media_blobs WHERE storage_key = ?', row.storage_key), stmt(env.DB, 'DELETE FROM media WHERE id = ?', id)]);
}

/**
 * Serve a stored file. Public media (gallery, logos) is cacheable for a year; private
 * media (customer photos, signatures, job photos) needs a staff session or the booking's
 * secret access token. Supports HTTP Range so videos seek and play on iOS.
 */
export async function serveMedia(c: Ctx, key: string): Promise<Response> {
  const row = await first<MediaRow & { access_token: string | null }>(
    c.env.DB, 'SELECT m.*, b.access_token FROM media m LEFT JOIN bookings b ON b.id = m.booking_id WHERE m.storage_key = ?', key,
  );
  if (!row) return c.notFound();
  if (row.visibility === 'private') {
    const token = c.req.query('t');
    const allowed = !!c.get('staff') || (!!token && !!row.access_token && token === row.access_token);
    if (!allowed) throw new HttpError(403, 'Not available.');
  }
  const headers = new Headers({
    'Content-Type': row.content_type,
    'Cache-Control': row.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Accept-Ranges': 'bytes',
  });
  if (c.env.MEDIA) {
    const rangeHeader = c.req.header('Range');
    const obj = await c.env.MEDIA.get(key, rangeHeader ? { range: c.req.raw.headers } : undefined);
    if (!obj) return c.notFound();
    headers.set('ETag', obj.httpEtag);
    if (rangeHeader && obj.range && 'offset' in obj.range) {
      const offset = obj.range.offset ?? 0;
      const length = obj.range.length ?? obj.size - offset;
      headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set('Content-Length', String(length));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(obj.size));
    return new Response(obj.body, { headers });
  }
  const bytes = await readMediaBytes(c.env, key);
  if (!bytes) return c.notFound();
  headers.set('Content-Length', String(bytes.length));
  return new Response(bytes, { headers });
}

/** Decode a `data:image/png;base64,…` URL (signature pad output). */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(422, 'Invalid image data.');
  const bin = atob(m[2]!);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
