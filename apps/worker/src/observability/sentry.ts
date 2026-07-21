import * as Sentry from '@sentry/node';

/**
 * HOMI-15a: error reporting for the worker, configured by presence like
 * Redis (buildPublisher). When SENTRY_DSN is set, a failed bill-posting
 * or prune run and any process-level crash report to Sentry; when it is
 * absent (dev, tests, or a deploy whose DSN is not wired yet) init is a
 * silent no-op. A missing reporter never fails boot.
 *
 * release is the deployed image's git SHA (SENTRY_RELEASE); tracing is
 * off - error capture is the whole slice this sprint. The worker and API
 * share one Sentry project, told apart by the `service` tag.
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
  Sentry.setTag('service', 'worker');
}
