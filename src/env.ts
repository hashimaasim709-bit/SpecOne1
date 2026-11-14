import type { Context } from 'hono';
import type { Role } from '../shared/constants';

/** Bindings and secrets. Only DB and ASSETS are required; every integration is optional. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** R2 bucket for media and encrypted backups. Without it, images fall back to D1. */
  MEDIA?: R2Bucket;

  APP_ENV?: string;
  /** Canonical origin for links in messages, e.g. https://speconeautolabs.co.uk */
  PUBLIC_ORIGIN?: string;
  /** One-time token that authorises creating the first owner account at /admin. */
  SETUP_TOKEN?: string;

  // Email (Resend)
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // SMS / WhatsApp (Twilio)
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  TWILIO_WHATSAPP_FROM?: string;
  // Owner push alerts
  NTFY_TOPIC?: string;
  NTFY_SERVER?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  // Payments (Stripe Checkout: cards, Apple Pay, Google Pay)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Lookups
  DVLA_API_KEY?: string;
  GETADDRESS_API_KEY?: string;
  IDEAL_POSTCODES_API_KEY?: string;
  GOOGLE_PLACES_API_KEY?: string;
  // Bot protection (Cloudflare Turnstile)
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  // Backups
  BACKUP_ENCRYPTION_KEY?: string;
  // AI-assisted feedback analysis
  ANTHROPIC_API_KEY?: string;
  // Android Trusted Web Activity
  TWA_PACKAGE_NAME?: string;
  TWA_SHA256_FINGERPRINTS?: string;
  SOURCE_REPO_URL?: string;
}

export interface StaffSession {
  sessionId: string;
  id: number;
  name: string;
  email: string;
  role: Role;
  locked: boolean;
}

export interface CustomerSession {
  sessionId: string;
  id: number;
  name: string;
  email: string;
  phone: string;
}

export interface Variables {
  nonce: string;
  ip: string;
  staff: StaffSession | null;
  customer: CustomerSession | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type Ctx = Context<AppEnv>;

export const isDev = (env: Env): boolean => env.APP_ENV === 'development';

/** Origin to use when building absolute links (tracker links in SMS, Stripe return URLs…). */
export function originOf(c: Ctx): string {
  return (c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '');
}
