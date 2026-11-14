// Outgoing webhooks for Zapier / Make / n8n / accounting tools.
// Deliveries are queued in D1, signed with HMAC-SHA256 and retried with backoff by the cron.
import type { WebhookEvent } from '../../shared/constants';
import { hmacSha256Hex } from '../lib/crypto';
import { all, inMinutes, nowIso, parseJson, run, stmt } from '../lib/db';

interface WebhookRow {
  id: number;
  url: string;
  events: string;
  secret: string;
}

/** Queue an event for every subscribed endpoint. Cheap: a single read when no webhooks exist. */
export async function emit(db: D1Database, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const hooks = await all<WebhookRow>(db, 'SELECT id, url, events, secret FROM webhooks WHERE active = 1');
  const targets = hooks.filter((h) => {
    const events = parseJson<string[]>(h.events, ['*']);
    return events.includes('*') || events.includes(event);
  });
  if (!targets.length) return;
  const payload = JSON.stringify({ event, created_at: nowIso(), data });
  await db.batch(targets.map((h) => stmt(db, 'INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES (?, ?, ?)', h.id, event, payload)));
}

const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/** Attempt all due deliveries. Called from the cron trigger and right after events fire. */
export async function deliverDue(db: D1Database, limit = 25): Promise<number> {
  const due = await all<{ id: number; event: string; payload: string; attempts: number; url: string; secret: string }>(
    db,
    `SELECT d.id, d.event, d.payload, d.attempts, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND w.active = 1 ORDER BY d.id LIMIT ?`,
    nowIso(), limit,
  );
  let delivered = 0;
  for (const d of due) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await hmacSha256Hex(d.secret, `${timestamp}.${d.payload}`);
    let code = 0;
    let error = '';
    try {
      const res = await fetch(d.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SpecOne-Webhooks/2.0',
          'X-SpecOne-Event': d.event,
          'X-SpecOne-Delivery': String(d.id),
          'X-SpecOne-Signature': `t=${timestamp},v1=${signature}`,
        },
        body: d.payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = String(e).slice(0, 300);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      delivered++;
      await run(db, "UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, response_code = ?, last_error = '' WHERE id = ?", attempts, code, d.id);
    } else if (attempts >= BACKOFF_MINUTES.length) {
      await run(db, "UPDATE webhook_deliveries SET status = 'failed', attempts = ?, response_code = ?, last_error = ? WHERE id = ?", attempts, code || null, error, d.id);
    } else {
      await run(db, 'UPDATE webhook_deliveries SET attempts = ?, response_code = ?, last_error = ?, next_attempt_at = ? WHERE id = ?', attempts, code || null, error, inMinutes(BACKOFF_MINUTES[attempts]!), d.id);
    }
  }
  return delivered;
}

/** Only allow public https endpoints — never loopback, link-local or private ranges. */
export function isSafeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return false;
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}
