// Admin data layer with offline support (#78):
//  - every successful GET is cached on the device, so job sheets open with no signal;
//  - safe edits (status changes, notes, checklist results) made offline are queued in an
//    outbox and replayed in order when the connection returns.
import { api, ApiError } from '../lib/api';

const CACHE_PREFIX = 's1a:get:';
const OUTBOX = 's1a:outbox';
const MAX_CACHE_CHARS = 350_000;

type Listener = () => void;
const listeners = new Set<Listener>();
export const onSyncChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach((fn) => fn());

let lockHandler: (() => void) | null = null;
let authHandler: (() => void) | null = null;
export const setAuthHandlers = (onLocked: () => void, onSignedOut: () => void): void => {
  lockHandler = onLocked;
  authHandler = onSignedOut;
};

function cacheSet(path: string, data: unknown): void {
  try {
    const text = JSON.stringify({ at: Date.now(), data });
    if (text.length > MAX_CACHE_CHARS) return;
    localStorage.setItem(CACHE_PREFIX + path, text);
  } catch {
    // Storage full: drop the oldest cached responses and carry on.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
  }
}
export function cacheGet<T>(path: string): { at: number; data: T } | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_PREFIX + path) ?? 'null') as { at: number; data: T } | null;
  } catch {
    return null;
  }
}
export function clearDeviceData(): void {
  Object.keys(localStorage).filter((k) => k.startsWith('s1a:')).forEach((k) => localStorage.removeItem(k));
  navigator.serviceWorker?.controller?.postMessage('clear-private');
}

function handleAuth(e: unknown): never {
  if (e instanceof ApiError && e.status === 423) lockHandler?.();
  if (e instanceof ApiError && e.status === 401) authHandler?.();
  throw e;
}

export interface Fetched<T> { data: T; stale: boolean; at: number }

/** GET with a device cache fallback when offline. */
export async function get<T>(path: string): Promise<Fetched<T>> {
  try {
    const data = await api<T>(`/api/admin${path}`);
    cacheSet(path, data);
    return { data, stale: false, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const hit = cacheGet<T>(path);
      if (hit) return { data: hit.data, stale: true, at: hit.at };
    }
    return handleAuth(e);
  }
}

export async function send<T = { ok: boolean }>(path: string, body?: unknown, method = 'POST', opts: { queueable?: boolean } = {}): Promise<T> {
  try {
    return await api<T>(`/api/admin${path}`, { method, body: body ?? {} });
  } catch (e) {
    if (e instanceof ApiError && e.status === 0 && opts.queueable) {
      const box = outbox();
      box.push({ path, body, method, at: Date.now() });
      localStorage.setItem(OUTBOX, JSON.stringify(box));
      notify();
      return { ok: true, queued: true } as T;
    }
    return handleAuth(e);
  }
}

export const del = <T = { ok: boolean }>(path: string): Promise<T> => send<T>(path, undefined, 'DELETE');

export async function upload(path: string, file: Blob, fields: Record<string, string> = {}, name = 'upload.jpg'): Promise<{ id: number; url: string; contentType?: string }> {
  const form = new FormData();
  form.append('file', file, name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  try {
    return await api(`/api/admin${path}`, { form });
  } catch (e) {
    return handleAuth(e);
  }
}

export const auth = <T = { ok: boolean }>(path: string, body?: unknown, method = 'POST'): Promise<T> => api<T>(`/api/staff/auth${path}`, { method, body: body ?? (method === 'GET' ? undefined : {}) });

interface Queued { path: string; body: unknown; method: string; at: number }
export function outbox(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}

/** Replay queued offline edits, oldest first. Stops at the first network failure. */
export async function flushOutbox(): Promise<number> {
  let box = outbox();
  let sent = 0;
  while (box.length) {
    const item = box[0]!;
    try {
      await api(`/api/admin${item.path}`, { method: item.method, body: item.body ?? {} });
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) break;
      // A rejected edit (e.g. the job moved on meanwhile) is dropped rather than retried forever.
    }
    box = box.slice(1);
    localStorage.setItem(OUTBOX, JSON.stringify(box));
  }
  notify();
  return sent;
}
