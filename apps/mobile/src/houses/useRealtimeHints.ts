import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { API_BASE } from '@/api/config';
import { authClient } from '@/auth/client';

/**
 * HOMI-33 (HOMI-17 server side): one socket per house at
 * `/v1/houses/:houseId/realtime`.
 *
 * Hints are cache invalidation only - `{ type, entityType, entityId, ts }`,
 * ids and never data - so a hint triggers a full snapshot refetch and the
 * payload is never merged into state. That is what keeps the client from
 * inventing a second, subtly different copy of the ledger.
 *
 * The socket is an optimisation, not a dependency: HOME already refetches
 * on focus, so a failed connect degrades to "fresh whenever you look at
 * it" rather than breaking the screen.
 *
 * `onHint` therefore means "your copy may be stale", and it also fires
 * whenever hints could have been missed: on every reconnect after the
 * first open (anything sent while the socket was down is gone), and when
 * the app returns to the foreground (the OS may have suspended the socket
 * without a close, and HOME does not refocus on resume).
 */

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * React Native's WebSocket accepts a third options argument carrying
 * request headers; the bundled DOM lib types only describe the browser's
 * two-argument form, so the RN shape is named here rather than casting at
 * the call site.
 */
type RNWebSocket = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

export function useRealtimeHints(houseId: string | undefined, onHint: () => void): void {
  // Kept in a ref so a changing callback identity cannot tear down and
  // rebuild the socket on every render.
  const handler = useRef(onHint);
  handler.current = onHint;

  useEffect(() => {
    if (houseId === undefined) return;

    let socket: WebSocket | undefined;
    let retryMs = RECONNECT_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let hasOpened = false;

    const connect = () => {
      if (closed) return;
      const url = `${API_BASE.replace(/^http/, 'ws')}/v1/houses/${houseId}/realtime`;
      try {
        // The session cookie has to ride the handshake because RN shares
        // no cookie jar. On web this argument is ignored and the browser
        // sends the cookie itself.
        socket = new (WebSocket as unknown as RNWebSocket)(url, undefined, {
          headers: { Cookie: authClient.getCookie() },
        });
      } catch {
        scheduleRetry();
        return;
      }

      socket.onopen = () => {
        retryMs = RECONNECT_MIN_MS;
        // A reconnect, not the first open: hints sent while the socket was
        // down were never delivered, so treat the gap as one big hint.
        if (hasOpened) handler.current();
        hasOpened = true;
      };
      socket.onmessage = () => {
        // The hint's contents are deliberately ignored: refetch is the
        // only correct response to any of them.
        handler.current();
      };
      socket.onerror = () => {
        // 'close' always follows; retrying here too would double up.
      };
      socket.onclose = () => {
        socket = undefined;
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };

    connect();

    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      handler.current();
      // Back in the foreground with the socket down: reconnect now rather
      // than waiting out a backoff that grew while the app was asleep.
      if (socket === undefined && retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryMs = RECONNECT_MIN_MS;
        connect();
      }
    });

    return () => {
      closed = true;
      appState.remove();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      // Drop the handler first: a close fired by our own teardown must
      // not schedule a reconnect for a house we are leaving.
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [houseId]);
}
