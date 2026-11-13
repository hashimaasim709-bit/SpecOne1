// Cron-driven automation. Two triggers are configured in wrangler.jsonc:
//   every 10 minutes — due messages (reminders, review requests), webhook retries
//   daily 03:15 UTC  — encrypted backup, subscription visits, stock & licence alerts,
//                      MOT reminders, Google review sync, sentiment sweep, housekeeping
import { slotLabel } from '../../shared/constants';
import { addDays, formatDate, formatReg, todayIn } from '../../shared/format';
import type { Env } from '../env';
import { auditSystem } from '../lib/auth';
import { all, first, nowIso, run } from '../lib/db';
import { getSettings, type Settings } from '../lib/settings';
import { runBackup } from './backup';
import { scheduleSubscriptionVisits } from './bookings';
import { messageCustomer, pushOwner } from './notify';
import { analysePendingThreads } from './sentiment';
import { deliverDue, emit } from './webhooks';

const originOf = (env: Env): string => (env.PUBLIC_ORIGIN || 'https://speconeautolabs.co.uk').replace(/\/$/, '');

interface DueMessage {
  id: number;
  kind: string;
  booking_id: number | null;
  customer_id: number | null;
  vehicle_id: number | null;
}

/** Send every scheduled message whose time has come. */
export async function processScheduledMessages(env: Env, settings: Settings): Promise<number> {
  const db = env.DB;
  const origin = originOf(env);
  const due = await all<DueMessage>(db, "SELECT id, kind, booking_id, customer_id, vehicle_id FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 40", nowIso());
  let sent = 0;
  for (const m of due) {
    try {
      const customer = m.customer_id ? await first<{ name: string; email: string; phone: string; marketing_opt_in: number }>(db, 'SELECT name, email, phone, marketing_opt_in FROM customers WHERE id = ?', m.customer_id) : null;
      const booking = m.booking_id ? await first<{ id: number; ref: string; status: string; date: string; slot: string; access_token: string }>(db, 'SELECT id, ref, status, date, slot, access_token FROM bookings WHERE id = ?', m.booking_id) : null;
      const vehicle = m.vehicle_id ? await first<{ reg: string; make: string; model: string }>(db, 'SELECT reg, make, model FROM vehicles WHERE id = ?', m.vehicle_id) : null;
      let result = 'skipped';
      if (customer) {
        const car = vehicle ? `${[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'vehicle'} (${formatReg(vehicle.reg)})` : 'vehicle';
        if (m.kind === 'booking_reminder' && booking && ['pending', 'confirmed'].includes(booking.status)) {
          await messageCustomer(env, settings, customer, {
            subject: `Reminder — your SpecOne visit is ${formatDate(booking.date, 'day')}`,
            text: `A reminder that your booking ${booking.ref} is ${formatDate(booking.date, 'day')}, ${slotLabel(booking.slot)}. You can follow the mobile lab live on the day:`,
            ctaLabel: 'Open tracker', ctaUrl: `${origin}/track/${booking.access_token}`, bookingId: booking.id,
          });
          result = 'sent';
        } else if (m.kind === 'review_request' && booking?.status === 'completed') {
          // Sent a couple of hours after completion, with the direct Google review link.
          const url = settings.business.googleReviewUrl || `${origin}/track/${booking.access_token}#feedback`;
          await messageCustomer(env, settings, customer, {
            subject: 'How did we do?',
            text: `Thanks for choosing ${settings.business.name}. If you were happy with the work on your ${car}, a quick Google review makes a huge difference to a small local business:`,
            ctaLabel: 'Leave a review', ctaUrl: url, bookingId: booking.id,
          });
          result = 'sent';
        } else if (m.kind === 'service_reminder' || m.kind === 'mot_reminder') {
          if (customer.marketing_opt_in || m.kind === 'mot_reminder') {
            await messageCustomer(env, settings, customer, {
              subject: `Your ${car} is due a check`,
              text: m.kind === 'mot_reminder'
                ? `The MOT on your ${car} is due soon. A pre-MOT health and emissions scan at your home or workplace catches failures before the test:`
                : `It has been nearly a year since we last looked after your ${car}, so its MOT or service is likely due soon. Book a pre-MOT health scan at your home or workplace:`,
              ctaLabel: 'Book a pre-MOT scan', ctaUrl: `${origin}/book?package=pre-mot-health-scan`, bookingId: booking?.id ?? null,
            });
            result = 'sent';
          } else {
            result = 'skipped: no reminder consent';
          }
        }
      }
      await run(db, "UPDATE scheduled_messages SET status = ?, result = ? WHERE id = ?", result === 'sent' ? 'sent' : 'cancelled', result, m.id);
      if (result === 'sent') sent++;
    } catch (e) {
      await run(db, "UPDATE scheduled_messages SET status = 'failed', result = ? WHERE id = ?", String(e).slice(0, 300), m.id);
    }
  }
  return sent;
}

/** Push one alert per item when stock drops below its minimum; re-arms once restocked. */
export async function lowStockAlerts(env: Env): Promise<number> {
  const db = env.DB;
  await run(db, 'UPDATE inventory SET alerted_at = NULL WHERE stock > min_stock AND alerted_at IS NOT NULL');
  const low = await all<{ id: number; name: string; stock: number; min_stock: number; unit: string }>(db, 'SELECT id, name, stock, min_stock, unit FROM inventory WHERE stock <= min_stock AND alerted_at IS NULL');
  if (!low.length) return 0;
  await pushOwner(env, `Low stock: ${low.length} item${low.length === 1 ? '' : 's'}`, low.map((i) => `${i.name} — ${i.stock} ${i.unit} left (min ${i.min_stock})`).join('\n'), `${originOf(env)}/admin#/r/inventory`, 4, ['package']);
  for (const item of low) {
    await run(db, 'UPDATE inventory SET alerted_at = ? WHERE id = ?', nowIso(), item.id);
    await emit(db, 'inventory.low_stock', item);
  }
  return low.length;
}

/** Warn 30 days before a licence, subscription or certificate expires, or when tokens run low. */
export async function licenceAlerts(env: Env, settings: Settings): Promise<number> {
  const db = env.DB;
  const today = todayIn(settings.business.timezone);
  const due = await all<{ id: number; name: string; expires_on: string | null; tokens_left: number | null }>(
    db, 'SELECT id, name, expires_on, tokens_left FROM licences WHERE ((expires_on IS NOT NULL AND expires_on <= ?) OR (tokens_left IS NOT NULL AND tokens_left <= 5)) AND (alerted_at IS NULL OR alerted_at < ?)',
    addDays(today, 30), `${addDays(today, -14)}T00:00:00Z`,
  );
  if (!due.length) return 0;
  await pushOwner(env, 'Licences need attention', due.map((l) => `${l.name} — ${l.expires_on ? (l.expires_on < today ? `EXPIRED ${l.expires_on}` : `expires ${l.expires_on}`) : ''}${l.tokens_left != null ? ` ${l.tokens_left} tokens left` : ''}`).join('\n'), `${originOf(env)}/admin#/r/licences`, 4, ['key']);
  for (const l of due) await run(db, 'UPDATE licences SET alerted_at = ? WHERE id = ?', nowIso(), l.id);
  return due.length;
}

/** Queue an MOT reminder four weeks before a known MOT expiry date. */
export async function queueMotReminders(env: Env, settings: Settings): Promise<number> {
  const db = env.DB;
  const today = todayIn(settings.business.timezone);
  const vehicles = await all<{ id: number; customer_id: number; mot_due: string }>(
    db,
    `SELECT v.id, v.customer_id, v.mot_due FROM vehicles v WHERE v.customer_id IS NOT NULL AND v.mot_due BETWEEN ? AND ?
     AND NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE s.vehicle_id = v.id AND s.kind = 'mot_reminder' AND s.created_at > ?)`,
    addDays(today, 21), addDays(today, 30), `${addDays(today, -200)}T00:00:00Z`,
  );
  for (const v of vehicles) {
    await run(db, "INSERT INTO scheduled_messages (kind, customer_id, vehicle_id, send_at) VALUES ('mot_reminder', ?, ?, ?)", v.customer_id, v.id, `${today}T09:30:00Z`);
  }
  return vehicles.length;
}

/** Pull the latest reviews from Google Business Profile (Places API) when configured. */
export async function syncGoogleReviews(env: Env, settings: Settings): Promise<number> {
  const placeId = settings.business.googlePlaceId;
  if (!env.GOOGLE_PLACES_API_KEY || !placeId) return 0;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { rating?: number; userRatingCount?: number; reviews?: { name?: string; rating?: number; text?: { text?: string }; authorAttribution?: { displayName?: string }; publishTime?: string }[] };
    let added = 0;
    for (const r of data.reviews ?? []) {
      if (!r.name || !r.rating) continue;
      const out = await run(
        env.DB, "INSERT OR IGNORE INTO reviews (source, external_id, author, rating, body, reviewed_on, visible) VALUES ('google', ?, ?, ?, ?, ?, 1)",
        r.name, r.authorAttribution?.displayName ?? 'Google user', Math.round(r.rating), r.text?.text ?? '', (r.publishTime ?? nowIso()).slice(0, 10),
      );
      added += out.changes;
    }
    if (data.rating && data.userRatingCount) {
      await run(env.DB, "INSERT INTO settings (key, value) VALUES ('flag:google_rating', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ rating: data.rating, count: data.userRatingCount, at: nowIso() }));
    }
    return added;
  } catch {
    return 0;
  }
}

export async function housekeeping(env: Env): Promise<void> {
  const db = env.DB;
  const now = nowIso();
  const stale = await all<{ id: number; storage_key: string }>(db, "SELECT id, storage_key FROM media WHERE attached = 0 AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')");
  for (const m of stale) {
    if (env.MEDIA) await env.MEDIA.delete(m.storage_key);
    await run(db, 'DELETE FROM media_blobs WHERE storage_key = ?', m.storage_key);
    await run(db, 'DELETE FROM media WHERE id = ?', m.id);
  }
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86400),
    db.prepare("DELETE FROM error_logs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')"),
    db.prepare("DELETE FROM webhook_deliveries WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')"),
    db.prepare("DELETE FROM notifications WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-180 days')"),
    db.prepare("UPDATE vans SET tracking_booking_id = NULL WHERE position_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours')"),
  ]);
}

export async function runCron(env: Env, cron: string): Promise<Record<string, unknown>> {
  const settings = await getSettings(env.DB, true);
  const out: Record<string, unknown> = {};
  out.messages = await processScheduledMessages(env, settings);
  out.webhooks = await deliverDue(env.DB, 40);
  if (cron === '15 3 * * *' || cron === 'daily') {
    const backup = await runBackup(env, 'cron').catch((e) => ({ ok: false, message: String(e) }));
    out.backup = backup.message;
    if (backup.ok) await auditSystem(env.DB, 'backup', 'system', 'database', backup.message);
    out.subscriptions = await scheduleSubscriptionVisits(env, settings, originOf(env));
    out.lowStock = await lowStockAlerts(env);
    out.licences = await licenceAlerts(env, settings);
    out.motReminders = await queueMotReminders(env, settings);
    out.googleReviews = await syncGoogleReviews(env, settings);
    out.sentiment = await analysePendingThreads(env);
    await housekeeping(env);
  }
  return out;
}
