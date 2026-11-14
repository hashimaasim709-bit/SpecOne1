// Service keys saved in the admin Connections centre. They are encrypted at rest with
// AES-256-GCM under a key derived from the SETUP_TOKEN secret, decrypted only inside the
// Worker, and never sent back to the browser. A Cloudflare secret of the same name wins.
import { CONNECTION_FIELD_NAMES } from '../../shared/connections';
import type { Env } from '../env';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function keyFor(env: Env): Promise<CryptoKey | null> {
  const secret = env.SETUP_TOKEN || (env.APP_ENV === 'development' ? 'development-only' : '');
  if (!secret) return null;
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`specone-connections:${secret}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function sealValue(env: Env, plain: string): Promise<string> {
  const key = await keyFor(env);
  if (!key) throw new Error('Set the SETUP_TOKEN secret on the Worker before saving keys here.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv, 0);
  out.set(cipher, 12);
  return `v1:${toB64(out)}`;
}

async function openValue(key: CryptoKey, sealed: string): Promise<string | null> {
  try {
    const raw = fromB64(sealed.replace(/^v1:/, ''));
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
  } catch {
    return null; // SETUP_TOKEN changed: the value must be entered again
  }
}

let cache: { at: number; values: Record<string, string>; unreadable: string[] } | null = null;
const TTL = 30_000;
export const invalidateConnections = (): void => {
  cache = null;
};

/** Decrypted admin-entered values, cached briefly per isolate. */
export async function storedConnections(env: Env): Promise<{ values: Record<string, string>; unreadable: string[] }> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const values: Record<string, string> = {};
  const unreadable: string[] = [];
  try {
    const { results } = await env.DB.prepare('SELECT name, value FROM connections').all<{ name: string; value: string }>();
    const key = results.length ? await keyFor(env) : null;
    for (const r of results) {
      if (!CONNECTION_FIELD_NAMES.includes(r.name)) continue;
      const v = key ? await openValue(key, r.value) : null;
      if (v === null) unreadable.push(r.name);
      else values[r.name] = v;
    }
  } catch {
    /* table not created yet (first request before migrations) */
  }
  cache = { at: Date.now(), values, unreadable };
  return cache;
}

const RAW = Symbol('raw-env');

/** The original Worker env (Cloudflare bindings and secrets only), before admin keys were merged in. */
export const rawEnv = (env: Env): Env => ((env as unknown as Record<symbol, Env>)[RAW] ?? env);

/** The Worker env with admin-entered keys filled in wherever no Cloudflare secret is set. */
export async function withConnections(env: Env): Promise<Env> {
  if (!env?.DB) return env;
  const raw = rawEnv(env);
  const { values } = await storedConnections(raw);
  const merged: Record<string | symbol, unknown> = { ...raw };
  for (const [name, value] of Object.entries(values)) if (!(raw as unknown as Record<string, unknown>)[name]) merged[name] = value;
  Object.defineProperty(merged, RAW, { value: raw, enumerable: false });
  return merged as unknown as Env;
}
