import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { type Observable, tap } from 'rxjs';

/**
 * HOMI-15a: report unhandled SERVER errors from request handlers to
 * Sentry. Client errors (4xx HttpExceptions - validation, auth, rate
 * limits, the magic-link 503 retry) are expected and never reported, so
 * the dashboard stays signal, not noise. Exception filters still format
 * the HTTP response; this only observes the error stream.
 *
 * Scope note: this sees errors thrown by Nest controllers and the
 * services they call - where the app's own bugs live. The Better Auth
 * handler is mounted at the Express layer (setup.ts) and its errors do
 * not pass through here; process-level crashes are covered separately
 * by Sentry.init's global handlers.
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap({
        error: (err: unknown) => {
          if (isServerError(err)) Sentry.captureException(err);
        },
      }),
    );
  }
}

function isServerError(err: unknown): boolean {
  if (err instanceof HttpException) return err.getStatus() >= 500;
  return true; // a non-HTTP throwable is an unexpected fault
}
