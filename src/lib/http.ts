// Request parsing and response helpers.
import type { z } from 'zod';
import type { Ctx } from '../env';
import { fail } from './security';

const MAX_JSON_BYTES = 512 * 1024;

/** Parse and validate a JSON body. Field-level problems are returned to the client as `fields`. */
export async function readJson<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  const type = c.req.header('Content-Type') ?? '';
  if (!type.includes('application/json')) fail(415, 'Expected a JSON request body.');
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (length > MAX_JSON_BYTES) fail(413, 'Request body is too large.');
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > MAX_JSON_BYTES) fail(413, 'Request body is too large.');
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof Error && e.name === 'HttpError') throw e;
    fail(400, 'The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    const firstKey = Object.keys(fields)[0] ?? '_';
    fail(422, firstKey === '_' ? fields._! : `Please check "${firstKey.split('.').pop()}": ${fields[firstKey]}`, fields);
  }
  return parsed.data as z.infer<S>;
}

/** Read a single uploaded file from a multipart form. */
export async function readUpload(c: Ctx, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; form: FormData }> {
  const length = Number(c.req.header('Content-Length') ?? 0);
  if (length > maxBytes + 64 * 1024) fail(413, 'That file is too large.');
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !file || typeof file === 'string') fail(400, 'No file was uploaded.');
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  if (bytes.length > maxBytes) fail(413, 'That file is too large.');
  if (bytes.length < 16) fail(400, 'That file is empty.');
  return { bytes, form: form! };
}

export function intParam(c: Ctx, name: string): number {
  const v = Number(c.req.param(name));
  if (!Number.isInteger(v) || v < 1) fail(404, 'Not found.');
  return v;
}

export function intQuery(c: Ctx, name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = c.req.query(name);
  const v = raw == null || raw === '' ? def : Number(raw);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : def;
}

export const noStore = (c: Ctx): void => {
  c.header('Cache-Control', 'no-store');
};

export function download(body: BodyInit, filename: string, type: string, inline = false): Response {
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
