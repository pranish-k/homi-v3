import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, magicLink } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { createDb, schema } from '@homi/db';
import { getSharedPool } from '../db.pool';
import {
  getMailer,
  isMailerConfigured,
  requireMailerInProduction,
  type Mailer,
} from '../email/mailer';
import { getRateLimiter } from '../ratelimit/rate-limiter';

// HOMI-24: the passwordless sign-in endpoints are unauthenticated
// email-send loops (review M6). Budgets are per target inbox first
// (bombing one address) and per source IP second (rotating addresses to
// burn email quota). Fifteen-minute windows match the credential TTL
// order of magnitude. HOMI-31: the magic-link and email-OTP sends share
// one budget, keyed by inbox/IP without the path, so offering a second
// channel does not double an attacker's send allowance.
const SIGN_IN_EMAIL_WINDOW_SEC = 15 * 60;
const SIGN_IN_EMAIL_PER_EMAIL = 3;
const SIGN_IN_EMAIL_PER_IP = 30;
const SIGN_IN_EMAIL_PATHS = new Set(['/sign-in/magic-link', '/email-otp/send-verification-otp']);

function requestIp(request: Request | undefined): string | undefined {
  // the load balancer APPENDS the real client IP, so only the LAST
  // entry is trustworthy; the first entries are client-controlled and
  // keying on them would let an attacker mint a fresh budget per
  // request (or poison a victim's). Absent locally, where the
  // per-email budget still applies.
  const forwarded = request?.headers.get('x-forwarded-for');
  const parts = forwarded?.split(',');
  return parts?.[parts.length - 1]?.trim() || undefined;
}

const signInEmailRateLimit = createAuthMiddleware(async (ctx) => {
  if (!SIGN_IN_EMAIL_PATHS.has(ctx.path)) return;
  const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : undefined;
  const ip = requestIp(ctx.request);
  const limiter = getRateLimiter();
  const decisions = await Promise.all([
    email
      ? limiter.consume(`signin:email:${email}`, SIGN_IN_EMAIL_PER_EMAIL, SIGN_IN_EMAIL_WINDOW_SEC)
      : undefined,
    ip ? limiter.consume(`signin:ip:${ip}`, SIGN_IN_EMAIL_PER_IP, SIGN_IN_EMAIL_WINDOW_SEC) : undefined,
  ]);
  const blocked = decisions.find((d) => d && !d.allowed);
  if (blocked) {
    throw new APIError(
      'TOO_MANY_REQUESTS',
      { message: 'Too many sign-in emails requested; try again later' },
      { 'Retry-After': String(blocked.retryAfterSec) },
    );
  }
});

/**
 * Better Auth (HOMI-2, decision D3): auth library runs inside our
 * service, sessions and identities live in our Postgres. No passwords
 * (spec 5.2): magic links and email OTP codes now, Apple/Google once
 * OAuth credentials are configured via env.
 *
 * Two passwordless channels (HOMI-31): the magic link is one-tap when it
 * opens the app, but the emailed-link -> app hop can fail (desktop mail,
 * a browser that will not honor the homi:// bounce). The email OTP code
 * is the deep-link-free fallback: the user types a 6-digit code and the
 * session cookie lands on the app's own request, so sign-in can never be
 * stranded in a browser.
 *
 * Email delivery (HOMI-21): with RESEND_API_KEY set, both channels send
 * as real mail; without it, dev logs the credential and exposes it via
 * lastMagicLink / lastOtp for tests and local sign-in, while production
 * refuses to boot (delivery is the only way anyone can sign in).
 */
export const lastMagicLink = new Map<string, string>();
export const lastOtp = new Map<string, string>();

// bounded so a long-running dev process cannot grow one entry per
// distinct email forever (mirrors the magic-link capture)
function captureDevCredential(store: Map<string, string>, email: string, value: string): void {
  if (store.size >= 100) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(email, value);
}

/**
 * Send the sign-in email, translating any delivery failure into a
 * retryable 503. A raw throw here (Resend 429/422, or the send timeout)
 * would surface to the caller as an opaque 500 indistinguishable from a
 * real bug; the provider's error is logged server-side only, never
 * echoed, since this path carries the sign-in link. Exported (with an
 * injectable mailer) so the failure mapping is unit-testable.
 */
export async function deliverSignInLink(
  email: string,
  url: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  try {
    await mailer.send({
      to: email,
      subject: 'Sign in to HOMI',
      text: `Tap to sign in to HOMI:\n\n${url}\n\nThe link expires shortly. If you did not request it, ignore this email.`,
      html: `<p>Tap to sign in to HOMI:</p><p><a href="${url}">Sign in</a></p><p>The link expires shortly. If you did not request it, ignore this email.</p>`,
    });
  } catch (err) {
    console.error('[auth] magic-link send failed', err);
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Could not send the sign-in email right now; please try again in a moment.',
    });
  }
}

/**
 * Send the sign-in code email. Same delivery-failure masking as
 * deliverSignInLink (a provider 429/422 or timeout becomes a retryable
 * 503, never echoing the provider error) since this path also carries a
 * sign-in credential. Exported with an injectable mailer for the failure
 * mapping to stay unit-testable.
 */
export async function deliverSignInCode(
  email: string,
  code: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  try {
    await mailer.send({
      to: email,
      subject: `${code} is your HOMI sign-in code`,
      text: `Your HOMI sign-in code is ${code}.\n\nEnter it in the app to sign in. The code expires shortly. If you did not request it, ignore this email.`,
      html: `<p>Your HOMI sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:2px">${code}</p><p>Enter it in the app to sign in. The code expires shortly. If you did not request it, ignore this email.</p>`,
    });
  } catch (err) {
    console.error('[auth] sign-in code send failed', err);
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Could not send the sign-in email right now; please try again in a moment.',
    });
  }
}

function buildAuth() {
  const isProduction = process.env.NODE_ENV === 'production';
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const secret = process.env.BETTER_AUTH_SECRET;
  if (isProduction && !secret) {
    // a fallback secret in prod means anyone with the repo can forge sessions
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  }
  requireMailerInProduction();
  const db = createDb(getSharedPool());

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    baseURL,
    secret: secret ?? 'homi-dev-secret-do-not-use-in-prod',
    // HOMI-31: the mobile app is a non-browser origin; its deep-link
    // scheme must be trusted for callback URLs. Expo dev servers use
    // exp:// with a LAN address, so those stay out of production.
    trustedOrigins: ['homi://', ...(isProduction ? [] : ['exp://', 'exp://**'])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    advanced: {
      database: { generateId: () => randomUUID() },
    },
    emailAndPassword: { enabled: false },
    socialProviders,
    hooks: {
      before: signInEmailRateLimit,
    },
    plugins: [
      expo(),
      magicLink({
        sendMagicLink: async ({ email, token, url }) => {
          if (isMailerConfigured()) {
            // HOMI-31: the emailed link goes to the interstitial page
            // (GET /auth/link), which hands the token to the app via the
            // homi:// deep link; the app then verifies it itself so the
            // session cookie lands in the app, not the mail browser. The
            // raw verify URL would sign in Safari instead.
            await deliverSignInLink(email, `${baseURL}/auth/link?token=${encodeURIComponent(token)}`);
            return;
          }
          // requireMailerInProduction() makes this branch unreachable in
          // prod; never log sign-in credentials there regardless
          if (isProduction) {
            throw new Error('Email delivery is not configured (HOMI-21)');
          }
          captureDevCredential(lastMagicLink, email, url);
          console.log(`[auth] magic link for ${email}: ${url}`);
        },
      }),
      // HOMI-31: the deep-link-free sign-in channel. otpLength/expiresIn
      // pinned to Better Auth's defaults for clarity; disableSignUp stays
      // false so a code signs up a first-time user, matching the magic
      // link. Sends share the sign-in email budget (signInEmailRateLimit).
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        sendVerificationOTP: async ({ email, otp }) => {
          if (isMailerConfigured()) {
            await deliverSignInCode(email, otp);
            return;
          }
          if (isProduction) {
            throw new Error('Email delivery is not configured (HOMI-21)');
          }
          captureDevCredential(lastOtp, email, otp);
          console.log(`[auth] sign-in code for ${email}: ${otp}`);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let instance: Auth | undefined;

export function getAuth(): Auth {
  if (!instance) instance = buildAuth();
  return instance;
}
