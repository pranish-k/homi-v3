import * as Sentry from '@sentry/node';

/**
 * HOMI-15a: error reporting, configured by presence like Redis and
 * Resend. When SENTRY_DSN is set the API reports unhandled server
 * errors and process-level crashes to Sentry; when it is absent (dev,
 * tests, or a deploy whose DSN is not wired yet) initialization is a
 * silent no-op.
 *
 * Unlike REDIS_URL, a missing DSN does NOT fail prod boot: a missing
 * error reporter must never be the thing that takes the service down.
 *
 * release is the deployed image's git SHA (SENTRY_RELEASE), so an issue
 * in Sentry points at exactly the revision that produced it. Performance
 * tracing stays off this sprint - error capture is the whole slice; the
 * dashboards are the later HOMI-15 work, once there is traffic to graph.
 */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

export function initSentry(): void {
  if (!isSentryConfigured()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: process.env.SENTRY_RELEASE,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
  // the worker shares this project; the tag tells the two runtimes apart
  Sentry.setTag('service', 'api');
}
