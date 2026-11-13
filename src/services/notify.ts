// Outbound messaging: email (Resend), SMS and WhatsApp (Twilio), owner push alerts
// (ntfy / Telegram). Every attempt is written to the `notifications` outbox so the admin
// can see exactly what was sent — or what would have been sent had a provider been configured.
import { slotLabel } from '../../shared/constants';
import { displayPhone, formatDate, formatReg, money, normPhone } from '../../shared/format';
import type { Env } from '../env';
import { run } from '../lib/db';
import type { Settings } from '../lib/settings';

export interface SendResult {
  channel: string;
  ok: boolean;
  provider: string;
  error: string;
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

async function log(db: D1Database, r: SendResult, recipient: string, subject: string, body: string, bookingId?: number | null): Promise<void> {
  await run(
    db, 'INSERT INTO notifications (channel, recipient, subject, body, status, provider, error, booking_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    r.channel, recipient, subject.slice(0, 200), body.slice(0, 4000), r.ok ? 'sent' : r.provider === 'none' ? 'skipped' : 'failed', r.provider, r.error.slice(0, 500), bookingId ?? null,
  ).catch(() => undefined);
}

export async function sendEmail(env: Env, msg: { to: string; subject: string; html: string; text: string; bookingId?: number | null; replyTo?: string }): Promise<SendResult> {
  let result: SendResult = { channel: 'email', ok: false, provider: 'none', error: 'RESEND_API_KEY not configured' };
  if (env.RESEND_API_KEY && msg.to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM || 'SpecOne Auto Labs <bookings@speconeautolabs.co.uk>', to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, reply_to: msg.replyTo }),
        signal: AbortSignal.timeout(8000),
      });
      result = { channel: 'email', ok: res.ok, provider: 'resend', error: res.ok ? '' : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    } catch (e) {
      result = { channel: 'email', ok: false, provider: 'resend', error: String(e) };
    }
  }
  await log(env.DB, result, msg.to, msg.subject, msg.text, msg.bookingId);
  return result;
}

async function twilio(env: Env, to: string, from: string, body: string): Promise<{ ok: boolean; error: string }> {
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, error: res.ok ? '' : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function sendSms(env: Env, toRaw: string, body: string, bookingId?: number | null): Promise<SendResult> {
  const to = normPhone(toRaw);
  let result: SendResult = { channel: 'sms', ok: false, provider: 'none', error: 'Twilio not configured' };
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && to) {
    result = { channel: 'sms', provider: 'twilio', ...(await twilio(env, to, env.TWILIO_FROM, body)) };
  }
  await log(env.DB, result, to, '', body, bookingId);
  return result;
}

export async function sendWhatsApp(env: Env, toRaw: string, body: string, bookingId?: number | null): Promise<SendResult> {
  const to = normPhone(toRaw);
  let result: SendResult = { channel: 'whatsapp', ok: false, provider: 'none', error: 'Twilio WhatsApp sender not configured' };
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM && to) {
    const from = env.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? env.TWILIO_WHATSAPP_FROM : `whatsapp:${env.TWILIO_WHATSAPP_FROM}`;
    result = { channel: 'whatsapp', provider: 'twilio', ...(await twilio(env, `whatsapp:${to}`, from, body)) };
  }
  await log(env.DB, result, to, '', body, bookingId);
  return result;
}

/** Push an alert to the owner's phone (ntfy and/or Telegram). */
export async function pushOwner(env: Env, title: string, message: string, clickUrl = '', priority: 3 | 4 | 5 = 3, tags: string[] = []): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (env.NTFY_TOPIC) {
    jobs.push(
      fetch((env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: env.NTFY_TOPIC, title, message, click: clickUrl || undefined, priority, tags }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => undefined),
    );
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `${title}\n${message}${clickUrl ? `\n${clickUrl}` : ''}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => undefined),
    );
  }
  await Promise.all(jobs);
}

/** Send a short text to a customer over the best available channels (SMS, WhatsApp, email). */
export async function messageCustomer(
  env: Env, settings: Settings, customer: { name: string; email: string; phone: string },
  msg: { subject: string; text: string; ctaLabel?: string; ctaUrl?: string; bookingId?: number | null; emailOnly?: boolean },
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  const sms = msg.ctaUrl ? `${msg.text} ${msg.ctaUrl}` : msg.text;
  if (!msg.emailOnly && customer.phone) {
    results.push(await sendSms(env, customer.phone, `${settings.business.name}: ${sms}`, msg.bookingId));
    if (env.TWILIO_WHATSAPP_FROM) results.push(await sendWhatsApp(env, customer.phone, `${settings.business.name}: ${sms}`, msg.bookingId));
  }
  if (customer.email) {
    results.push(await sendEmail(env, {
      to: customer.email, subject: msg.subject, text: `${msg.text}${msg.ctaUrl ? `\n\n${msg.ctaLabel ?? 'Open'}: ${msg.ctaUrl}` : ''}`,
      html: emailLayout(settings, { heading: msg.subject, paragraphs: [`Hi ${customer.name.split(' ')[0]},`, msg.text], ctaLabel: msg.ctaLabel, ctaUrl: msg.ctaUrl }),
      bookingId: msg.bookingId, replyTo: settings.business.email,
    }));
  }
  return results;
}

/** Branded, dark-header HTML email that renders consistently across mail clients. */
export function emailLayout(settings: Settings, o: { heading: string; paragraphs: string[]; rows?: [string, string][]; ctaLabel?: string; ctaUrl?: string; footnote?: string }): string {
  const b = settings.business;
  const rows = (o.rows ?? []).map(([k, v]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #eceef2;color:#6b7280;font-size:13px;width:38%">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid #eceef2;color:#0b0d12;font-size:14px;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b0d12">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#07080b;padding:22px 28px;border-bottom:3px solid #e11d48"><span style="font-size:18px;font-weight:800;letter-spacing:.06em;color:#ffffff">SPEC<span style="color:#ff2e55">ONE</span></span><span style="display:block;font-size:11px;letter-spacing:.18em;color:#9ca3af;margin-top:4px">AUTO LABS · MOBILE LABORATORY</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#0b0d12">${esc(o.heading)}</h1>
${o.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151">${esc(p)}</p>`).join('')}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 6px">${rows}</table>` : ''}
${o.ctaUrl ? `<p style="margin:22px 0 6px"><a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:10px">${esc(o.ctaLabel ?? 'Open')}</a></p>` : ''}
${o.footnote ? `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#6b7280">${esc(o.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #eceef2;font-size:12px;line-height:1.6;color:#6b7280">${esc(b.name)} · ${esc(b.town)}, ${esc(b.region)}<br>Tel ${esc(b.phone)} · ${esc(b.email)}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface BookingMessageData {
  id: number;
  ref: string;
  date: string;
  slot: string;
  address: string;
  total: number;
  currency: string;
  vehicles: string[];
  services: string[];
  trackUrl: string;
  customer: { name: string; email: string; phone: string };
}

export async function notifyBookingCreated(env: Env, settings: Settings, b: BookingMessageData, opts: { emergency: boolean; adminUrl: string; pending: boolean }): Promise<void> {
  const when = `${formatDate(b.date, 'long')}, ${slotLabel(b.slot)}`;
  const first = b.customer.name.split(' ')[0];
  const sms = `${settings.business.name}: Hi ${first}, booking ${b.ref} is ${opts.pending ? 'received' : 'confirmed'} for ${formatDate(b.date, 'day')} (${slotLabel(b.slot)}). Track your technician live: ${b.trackUrl}`;
  const jobs: Promise<unknown>[] = [];
  if (b.customer.phone) {
    jobs.push(sendSms(env, b.customer.phone, sms, b.id));
    if (env.TWILIO_WHATSAPP_FROM) jobs.push(sendWhatsApp(env, b.customer.phone, sms, b.id));
  }
  if (b.customer.email) {
    jobs.push(sendEmail(env, {
      to: b.customer.email,
      subject: `Booking ${opts.pending ? 'received' : 'confirmed'} — ${b.ref}`,
      text: `Hi ${first},\n\nYour booking ${b.ref} is ${opts.pending ? 'received and awaiting confirmation' : 'confirmed'}.\n\nWhen: ${when}\nWhere: ${b.address}\nVehicle(s): ${b.vehicles.join('; ')}\nServices: ${b.services.join('; ')}\nTotal: ${money(b.total, b.currency)} (pay on completion unless a deposit was paid)\n\nLive tracker: ${b.trackUrl}\n\n${settings.business.name} · ${settings.business.phone}`,
      html: emailLayout(settings, {
        heading: opts.pending ? `We have your request, ${first}` : `You're booked in, ${first}`,
        paragraphs: [opts.pending ? 'We will confirm your slot shortly. Here are the details we have:' : 'Your mobile lab appointment is locked in. Here are the details:'],
        rows: [['Reference', b.ref], ['When', when], ['Where', b.address], ['Vehicle', b.vehicles.join(' · ')], ['Services', b.services.join(' · ')], ['Total', money(b.total, b.currency)]],
        ctaLabel: 'Track your booking live', ctaUrl: b.trackUrl,
        footnote: 'Need to change something? Reply to this email or call us. You only pay once the work is complete, unless you chose to pay a deposit.',
      }),
      bookingId: b.id, replyTo: settings.business.email,
    }));
  }
  jobs.push(pushOwner(
    env, `${opts.emergency ? 'EMERGENCY ' : ''}New booking ${b.ref} — ${money(b.total, b.currency)}`,
    `${b.customer.name} (${displayPhone(b.customer.phone)})\n${when}\n${b.vehicles.join('; ')}\n${b.services.join('; ')}\n${b.address}`,
    opts.adminUrl, opts.emergency ? 5 : 4, [opts.emergency ? 'rotating_light' : 'calendar'],
  ));
  if (settings.business.email) {
    jobs.push(sendEmail(env, {
      to: settings.business.email, subject: `${opts.emergency ? '[EMERGENCY] ' : ''}New booking ${b.ref} — ${b.customer.name}`,
      text: `${b.customer.name} · ${displayPhone(b.customer.phone)} · ${b.customer.email}\n${when}\n${b.address}\n${b.vehicles.join('; ')}\n${b.services.join('; ')}\nTotal ${money(b.total, b.currency)}\n${opts.adminUrl}`,
      html: emailLayout(settings, {
        heading: `New booking ${b.ref}`, paragraphs: [`${b.customer.name} booked online.`],
        rows: [['Customer', `${b.customer.name} · ${displayPhone(b.customer.phone)}`], ['When', when], ['Where', b.address], ['Vehicle', b.vehicles.join(' · ')], ['Services', b.services.join(' · ')], ['Total', money(b.total, b.currency)]],
        ctaLabel: 'Open job card', ctaUrl: opts.adminUrl,
      }),
      bookingId: b.id,
    }));
  }
  await Promise.all(jobs);
}

/** Pre-written WhatsApp deep links the technician can fire from their own phone at no cost. */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${normPhone(phone).replace('+', '')}?text=${encodeURIComponent(text)}`;
}

export const vehicleLabel = (v: { reg: string; make: string; model: string; year?: number | null }): string =>
  [v.year, v.make, v.model].filter(Boolean).join(' ').trim() ? `${[v.year, v.make, v.model].filter(Boolean).join(' ')} (${formatReg(v.reg)})` : formatReg(v.reg);

/** Which integrations are live — shown in Admin → Settings → Integrations. */
export function integrationStatus(env: Env): Record<string, { on: boolean; label: string; secrets: string }> {
  return {
    email: { on: !!env.RESEND_API_KEY, label: 'Email — confirmations, reminders, login codes (Resend)', secrets: 'RESEND_API_KEY, EMAIL_FROM' },
    sms: { on: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM), label: 'SMS — confirmations, tracker links, review requests (Twilio)', secrets: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM' },
    whatsapp: { on: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_WHATSAPP_FROM), label: 'WhatsApp Business messages (Twilio)', secrets: 'TWILIO_WHATSAPP_FROM' },
    push: { on: !!(env.NTFY_TOPIC || env.TELEGRAM_BOT_TOKEN), label: 'Owner phone alerts (ntfy / Telegram)', secrets: 'NTFY_TOPIC or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID' },
    payments: { on: !!env.STRIPE_SECRET_KEY, label: 'Online deposits, Apple Pay & Google Pay (Stripe Checkout)', secrets: 'STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET' },
    dvla: { on: !!env.DVLA_API_KEY, label: 'Registration auto-fill (DVLA Vehicle Enquiry Service)', secrets: 'DVLA_API_KEY' },
    address: { on: !!(env.GETADDRESS_API_KEY || env.IDEAL_POSTCODES_API_KEY), label: 'Postcode street-address picker (Royal Mail PAF)', secrets: 'GETADDRESS_API_KEY or IDEAL_POSTCODES_API_KEY' },
    google: { on: !!env.GOOGLE_PLACES_API_KEY, label: 'Live Google reviews sync (Places API)', secrets: 'GOOGLE_PLACES_API_KEY + Place ID in Settings' },
    turnstile: { on: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY), label: 'Bot protection on forms (Cloudflare Turnstile)', secrets: 'TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY' },
    r2: { on: !!env.MEDIA, label: 'R2 storage — video uploads and cloud backups', secrets: 'r2_buckets binding in wrangler.jsonc' },
    backups: { on: !!(env.MEDIA && env.BACKUP_ENCRYPTION_KEY), label: 'Nightly encrypted database backups', secrets: 'BACKUP_ENCRYPTION_KEY (+ R2)' },
    ai: { on: !!env.ANTHROPIC_API_KEY, label: 'AI-assisted feedback analysis (Claude)', secrets: 'ANTHROPIC_API_KEY' },
  };
}
