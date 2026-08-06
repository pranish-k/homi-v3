import { authClient } from '@/auth/client';
import { API_BASE } from './config';

/**
 * HOMI-32: the app's first calls to the HOMI API proper (everything
 * before this went through the Better Auth client). React Native's fetch
 * has no shared cookie jar with SecureStore, so the session cookie the
 * Expo plugin persisted is attached by hand on every request - the same
 * cookie the auth client sends, read through its `getCookie` action.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API's error shape; anything else falls back to a generic message. */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body as { message: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
    // Nest's validation pipe can return message as an array of strings.
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return status === 401
    ? 'Your session expired. Sign in again.'
    : 'Something went wrong. Try again.';
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Cookie: authClient.getCookie(),
        ...init?.headers,
      },
    });
  } catch {
    // Offline or DNS failure - distinguishable from a server error,
    // because "check your connection" is the only useful advice here.
    throw new ApiError(0, 'Cannot reach HOMI. Check your connection.');
  }

  const text = await response.text();
  // Not every response on this path is ours: Cloud Run and the load
  // balancer answer with HTML on 502/503 and on a failed cold start, so
  // JSON.parse throwing here is a real case, not a defensive one. Letting
  // the SyntaxError escape would put the parser's own message ("Unexpected
  // token <...") on screen as user-facing copy, exactly when something is
  // already going wrong.
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        response.status,
        response.ok
          ? 'Something went wrong. Try again.'
          : messageFrom(null, response.status),
      );
    }
  }
  if (!response.ok) throw new ApiError(response.status, messageFrom(body, response.status));
  return body as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);

export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
