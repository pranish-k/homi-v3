import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { createDb, schema } from '@homi/db';
import { getSharedPool } from '../db.pool';

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
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (isProduction) {
            // never log sign-in credentials; fail loudly until email
            // delivery exists (HOMI-21)
            throw new Error('Email delivery is not configured (HOMI-21)');
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
