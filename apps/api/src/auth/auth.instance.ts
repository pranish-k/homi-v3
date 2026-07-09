import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { createDb, schema } from '@homi/db';
import { getSharedPool } from '../db.pool';
import { getRateLimiter } from '../ratelimit/rate-limiter';

// HOMI-24: the magic-link endpoint is an unauthenticated email-send
// loop (review M6). Budgets are per target inbox first (bombing one
// address) and per source IP second (rotating addresses to burn email
// quota). Fifteen-minute windows match the link TTL order of magnitude.
const MAGIC_LINK_WINDOW_SEC = 15 * 60;
const MAGIC_LINK_PER_EMAIL = 3;
const MAGIC_LINK_PER_IP = 30;

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

const magicLinkRateLimit = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-in/magic-link') return;
  const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : undefined;
  const ip = requestIp(ctx.request);
  const limiter = getRateLimiter();
  const decisions = await Promise.all([
    email
      ? limiter.consume(`ml:email:${email}`, MAGIC_LINK_PER_EMAIL, MAGIC_LINK_WINDOW_SEC)
      : undefined,
    ip ? limiter.consume(`ml:ip:${ip}`, MAGIC_LINK_PER_IP, MAGIC_LINK_WINDOW_SEC) : undefined,
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
 * (spec 5.2): magic links now, Apple/Google once OAuth credentials are
 * configured via env.
 *
 * Email delivery is HOMI-21; until a transactional email provider is
 * wired, magic-link URLs are logged server-side and (outside
 * production) exposed via lastMagicLink for tests and local sign-in.
 */
export const lastMagicLink = new Map<string, string>();

function buildAuth() {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.BETTER_AUTH_SECRET;
  if (isProduction && !secret) {
    // a fallback secret in prod means anyone with the repo can forge sessions
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  }
  const db = createDb(getSharedPool());

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    secret: secret ?? 'homi-dev-secret-do-not-use-in-prod',
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
      before: magicLinkRateLimit,
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (isProduction) {
            // never log sign-in credentials; fail loudly until email
            // delivery exists (HOMI-21)
            throw new Error('Email delivery is not configured (HOMI-21)');
          }
          // bounded: a long-running dev process must not grow one entry
          // per distinct email forever
          if (lastMagicLink.size >= 100) {
            const oldest = lastMagicLink.keys().next().value;
            if (oldest) lastMagicLink.delete(oldest);
          }
          lastMagicLink.set(email, url);
          console.log(`[auth] magic link for ${email}: ${url}`);
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
