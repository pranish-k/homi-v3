import { afterEach, describe, expect, it } from 'vitest';
import {
  createMailer,
  isMailerConfigured,
  requireMailerInProduction,
  type Mailer,
  type SendEmailInput,
} from '../src/email/mailer';
import { deliverSignInLink } from '../src/auth/auth.instance';

/** HOMI-21: the Resend client and the presence-based configuration rules. */

const ENV_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM', 'NODE_ENV'] as const;
const saved = new Map<string, string | undefined>();
for (const k of ENV_KEYS) saved.set(k, process.env[k]);

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

const input: SendEmailInput = {
  to: 'roomie@example.com',
  subject: 'Sign in to HOMI',
  text: 'link',
};

describe('createMailer', () => {
  it('POSTs to Resend with bearer auth and the configured sender', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    process.env.EMAIL_FROM = 'HOMI <auth@homi.example>';
    const { fn, calls } = fakeFetch(200);

    await createMailer(fn).send(input);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer rk_test');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      from: 'HOMI <auth@homi.example>',
      to: 'roomie@example.com',
      subject: 'Sign in to HOMI',
      text: 'link',
    });
    expect(body).not.toHaveProperty('html'); // omitted, not null
  });

  it('falls back to the Resend sandbox sender without EMAIL_FROM', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    delete process.env.EMAIL_FROM;
    const { fn, calls } = fakeFetch(200);

    await createMailer(fn).send(input);

    expect(JSON.parse(String(calls[0].init.body)).from).toBe('HOMI <onboarding@resend.dev>');
  });

  it('rejects on a non-2xx without echoing the payload', async () => {
    process.env.RESEND_API_KEY = 'rk_test';
    const { fn } = fakeFetch(422);

    await expect(createMailer(fn).send(input)).rejects.toThrow(/Resend responded 422/);
  });

  it('refuses to build without an API key', () => {
    delete process.env.RESEND_API_KEY;
    expect(() => createMailer()).toThrow(/RESEND_API_KEY/);
  });
});

describe('configuration rules', () => {
  it('is configured by key presence', () => {
    delete process.env.RESEND_API_KEY;
    expect(isMailerConfigured()).toBe(false);
    process.env.RESEND_API_KEY = 'rk_test';
    expect(isMailerConfigured()).toBe(true);
  });

  it('production refuses to boot without a mailer; dev does not', () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => requireMailerInProduction()).toThrow(/RESEND_API_KEY must be set/);
    process.env.NODE_ENV = 'test';
    expect(() => requireMailerInProduction()).not.toThrow();
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 'rk_test';
    expect(() => requireMailerInProduction()).not.toThrow();
  });
});

describe('deliverSignInLink (magic-link send resilience)', () => {
  const url = 'https://homi.example/verify?token=secret-token';

  function recordingMailer(behavior: 'ok' | Error): { mailer: Mailer; sent: SendEmailInput[] } {
    const sent: SendEmailInput[] = [];
    const mailer: Mailer = {
      async send(inputToSend) {
        sent.push(inputToSend);
        if (behavior !== 'ok') throw behavior;
      },
    };
    return { mailer, sent };
  }

  it('sends the link on success', async () => {
    const { mailer, sent } = recordingMailer('ok');
    await expect(deliverSignInLink('roomie@example.com', url, mailer)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('roomie@example.com');
    expect(sent[0].text).toContain(url);
  });

  it('maps a provider failure (429/422) to a retryable 503, not a raw 500', async () => {
    const { mailer } = recordingMailer(new Error('email send failed: Resend responded 429'));
    await expect(deliverSignInLink('roomie@example.com', url, mailer)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('maps a send timeout to 503 as well', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    const { mailer } = recordingMailer(timeout);
    await expect(deliverSignInLink('roomie@example.com', url, mailer)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('never leaks the sign-in url or the provider error into the client message', async () => {
    const { mailer } = recordingMailer(new Error(`Resend rejected recipient for ${url}`));
    let caught: { body?: { message?: string } } | undefined;
    try {
      await deliverSignInLink('roomie@example.com', url, mailer);
    } catch (err) {
      caught = err as { body?: { message?: string } };
    }
    const message = caught?.body?.message ?? '';
    expect(message).not.toContain(url);
    expect(message).not.toContain('Resend');
    expect(message.length).toBeGreaterThan(0);
  });
});
