// Web Crypto helpers: tokens, password hashing, HMAC signatures and backup encryption.

const enc = new TextEncoder();

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Cryptographically random URL-safe token. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Short human-friendly code from an unambiguous alphabet (no 0/O, 1/I/L). */
export function randomCode(length = 6, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'): string {
  const out: string[] = [];
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]!);
    }
  }
  return out.join('');
}

export const randomDigits = (length = 6): string => randomCode(length, '0123456789');

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(input)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ── Passwords: PBKDF2-HMAC-SHA256 with a per-password random salt. ──
// 100,000 iterations is the maximum the Workers runtime permits for PBKDF2.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const candidate = await pbkdf2(password, fromBase64Url(salt), iterations);
  return timingSafeEqual(toBase64Url(candidate), hash);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(password) || /^(password|specone|trade20\d\d|tech20\d\d|12345)/i.test(password)) return 'Choose something less guessable.';
  return null;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// ── Backup encryption: AES-256-GCM, key derived from the BACKUP_ENCRYPTION_KEY secret. ──
// File layout: "S1BK1" magic (5 bytes) | 12-byte IV | ciphertext + GCM tag.
const BACKUP_MAGIC = enc.encode('S1BK1');

async function backupKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`specone-backup:${secret}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(plain: Uint8Array<ArrayBuffer>, secret: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await backupKey(secret), plain));
  const out = new Uint8Array(BACKUP_MAGIC.length + iv.length + cipher.length);
  out.set(BACKUP_MAGIC, 0);
  out.set(iv, BACKUP_MAGIC.length);
  out.set(cipher, BACKUP_MAGIC.length + iv.length);
  return out;
}

export async function decryptBackup(file: Uint8Array<ArrayBuffer>, secret: string): Promise<Uint8Array> {
  const iv = file.slice(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
  const cipher = file.slice(BACKUP_MAGIC.length + 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await backupKey(secret), cipher));
}

export const isEncryptedBackup = (file: Uint8Array): boolean => BACKUP_MAGIC.every((b, i) => file[i] === b);

export async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
