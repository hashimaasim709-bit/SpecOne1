// Payments. Online payments go through Stripe Checkout, which presents cards, Apple Pay
// and Google Pay automatically on supported devices. In-person payments (card reader,
// SumUp, cash, bank transfer) are recorded manually from the job card.
import { money } from '../../shared/format';
import type { Env } from '../env';
import { hmacSha256Hex, timingSafeEqual } from '../lib/crypto';
import { first, run } from '../lib/db';
import { HttpError } from '../lib/security';
import { addEvent, getBooking, syncPaymentStatus, webhookPayload, type BookingRow } from './bookings';
import { pushOwner } from './notify';
import { emit } from './webhooks';

export const paymentsEnabled = (env: Env): boolean => !!env.STRIPE_SECRET_KEY;

export async function recordPayment(
  db: D1Database, bookingId: number, p: { kind: 'deposit' | 'balance' | 'refund'; method: string; provider: string; providerRef?: string; amount: number; note?: string; actor?: string },
): Promise<boolean> {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new HttpError(422, 'Enter a payment amount.');
  const booking = await getBooking(db, bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  // The unique (provider, provider_ref) index makes webhook redeliveries harmless.
  const res = await run(
    db, 'INSERT OR IGNORE INTO payments (booking_id, kind, method, provider, provider_ref, amount, currency, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    bookingId, p.kind, p.method, p.provider, p.providerRef ?? '', p.amount, booking.currency, (p.note ?? '').slice(0, 300),
  );
  if (!res.changes) return false;
  await syncPaymentStatus(db, bookingId);
  const label = p.kind === 'refund' ? 'Refund issued' : p.kind === 'deposit' ? 'Deposit received' : 'Payment received';
  await addEvent(db, bookingId, 'payment', `${label}: ${money(p.amount, booking.currency)} (${p.method.replace(/_/g, ' ')})`, p.actor ?? '');
  if (p.kind !== 'refund') await emit(db, 'payment.received', { ...(await webhookPayload(db, bookingId)), payment: { kind: p.kind, method: p.method, provider: p.provider, amount: p.amount } });
  return true;
}

/** Create a Stripe Checkout session for a deposit or the outstanding balance. Returns the hosted payment URL. */
export async function createCheckout(env: Env, booking: BookingRow, kind: 'deposit' | 'balance', origin: string, customerEmail: string, businessName: string): Promise<string> {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Online payments are not enabled.');
  const balance = booking.total - booking.paid_amount;
  const amount = kind === 'deposit' ? Math.min(booking.deposit_due, balance) : balance;
  if (amount < 50) throw new HttpError(409, 'There is nothing left to pay on this booking.');
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/track/${booking.access_token}?paid=1`,
    cancel_url: `${origin}/track/${booking.access_token}?paid=0`,
    client_reference_id: booking.ref,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': booking.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': `${businessName} — ${kind === 'deposit' ? 'booking deposit' : 'balance'} (${booking.ref})`,
    'metadata[booking_id]': String(booking.id),
    'metadata[kind]': kind,
    'payment_intent_data[description]': `${booking.ref} ${kind}`,
    'payment_intent_data[metadata][booking_id]': String(booking.id),
    'payment_intent_data[metadata][kind]': kind,
  });
  if (customerEmail) body.set('customer_email', customerEmail);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `checkout-${booking.id}-${kind}-${amount}-${Math.floor(Date.now() / 600000)}` },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    console.error('stripe checkout failed', res.status, data.error?.message);
    throw new HttpError(502, 'The payment page could not be opened. Please try again or pay on completion.');
  }
  return data.url;
}

/** Verify a Stripe webhook signature (HMAC-SHA256 over "timestamp.payload", 5-minute tolerance). */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]).filter((p) => p.length === 2 && p[0] === 't')) as { t?: string };
  const signatures = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!parts.t || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = await hmacSha256Hex(secret, `${parts.t}.${payload}`);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

export async function handleStripeEvent(env: Env, event: StripeEvent, origin: string): Promise<void> {
  const db = env.DB;
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid') return;
    const meta = (obj.metadata ?? {}) as { booking_id?: string; kind?: string };
    const bookingId = Number(meta.booking_id);
    if (!Number.isInteger(bookingId)) return;
    const amount = Number(obj.amount_total);
    const ref = String(obj.payment_intent || obj.id);
    const isNew = await recordPayment(db, bookingId, { kind: meta.kind === 'deposit' ? 'deposit' : 'balance', method: 'online', provider: 'stripe', providerRef: ref, amount, actor: 'Stripe' });
    if (isNew) {
      const b = await getBooking(db, bookingId);
      await run(db, "UPDATE bookings SET payment_method = 'online' WHERE id = ? AND payment_method = 'on_completion'", bookingId);
      await pushOwner(env, `Payment received — ${money(amount, b?.currency ?? 'GBP')}`, `${b?.ref ?? bookingId}: ${meta.kind === 'deposit' ? 'deposit' : 'balance'} paid online.`, `${origin}/admin#/bookings/${bookingId}`, 3, ['moneybag']);
    }
  } else if (event.type === 'charge.refunded') {
    const intent = String(obj.payment_intent ?? '');
    const original = intent ? await first<{ booking_id: number }>(db, "SELECT booking_id FROM payments WHERE provider = 'stripe' AND provider_ref = ?", intent) : null;
    if (!original) return;
    const refunded = Number(obj.amount_refunded);
    const already = (await first<{ s: number | null }>(db, "SELECT SUM(amount) AS s FROM payments WHERE booking_id = ? AND kind = 'refund' AND provider = 'stripe'", original.booking_id))?.s ?? 0;
    if (refunded > already) {
      await recordPayment(db, original.booking_id, { kind: 'refund', method: 'online', provider: 'stripe', providerRef: `refund:${String(obj.id)}:${refunded}`, amount: refunded - already, actor: 'Stripe' });
    }
  }
}
