/**
 * HOMI-21: transactional email via Resend. The provider surface we use
 * is a single authenticated POST, so the client is a fetch wrapper
 * rather than an SDK dependency.
 *
 * Configuration is by presence, same shape as Redis (redis.ts): when
 * RESEND_API_KEY is set, mail really sends; when it is not, callers
 * fall back to their dev behavior (the magic-link logger seam), and
 * production refuses at boot via requireMailerInProduction so a
 * misconfigured deploy fails loudly instead of swallowing sign-ins.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

// Resend's sandbox sender: works without a verified domain but only
// delivers to the account owner's own inbox. A real sending domain
// replaces this via EMAIL_FROM before outside testers arrive.
const DEFAULT_FROM = 'HOMI <onboarding@resend.dev>';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(input: SendEmailInput): Promise<void>;
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function requireMailerInProduction(): void {
  if (process.env.NODE_ENV === 'production' && !isMailerConfigured()) {
    // without email there is no way to sign in (magic links only)
    throw new Error('RESEND_API_KEY must be set in production (magic-link delivery)');
  }
}

export function createMailer(fetchFn: typeof fetch = fetch): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;
  return {
    async send({ to, subject, text, html }: SendEmailInput): Promise<void> {
      const res = await fetchFn(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        // no response body in the error: provider messages can echo
        // payload fields, and this path handles sign-in links
        throw new Error(`email send failed: Resend responded ${res.status}`);
      }
    },
  };
}

let instance: Mailer | undefined;

export function getMailer(): Mailer {
  if (!instance) instance = createMailer();
  return instance;
}
