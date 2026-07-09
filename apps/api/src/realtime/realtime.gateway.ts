import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { WebSocket, WebSocketServer } from 'ws';
import { getAuth } from '../auth/auth.instance';
import { MembershipService } from '../auth/membership.service';
import { UUID_RE } from '../lib/validation';
import { RealtimeService } from './realtime.service';

const WS_PATH_RE = /^\/v1\/houses\/([^/]+)\/realtime$/;
const HEARTBEAT_MS = 30_000;

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

/**
 * HOMI-17: one WebSocket channel per house. The connect handshake runs
 * the same two layers as every HTTP request: session via the single
 * Better Auth instance, then CURRENT active membership (H9) via the
 * same MembershipService the HTTP guard uses. Membership is only
 * checked at connect; a removed member keeps receiving hints (ids, no
 * data) until their socket drops, and every refetch those hints trigger
 * is membership-guarded, so nothing leaks.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationShutdown {
  private wss?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly membership: MembershipService,
    private readonly realtime: RealtimeService,
  ) {}

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    this.heartbeat = setInterval(() => this.reapDeadSockets(), HEARTBEAT_MS);
    this.heartbeat.unref();

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.handleUpgrade(req, socket, head).catch(() => {
        rejectUpgrade(socket, 500, 'Internal Server Error');
      });
    });
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const match = WS_PATH_RE.exec(req.url?.split('?')[0] ?? '');
    // a non-UUID segment must 404 here, not surface as a Postgres cast
    // error from the membership query
    if (!match?.[1] || !UUID_RE.test(match[1])) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const houseId = match[1].toLowerCase();

    const session = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (!(await this.membership.isActiveMember(houseId, session.user.id))) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    this.wss?.handleUpgrade(req, socket, head, (ws: TrackedSocket) => {
      this.wss?.emit('connection', ws, req);
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      const unsubscribe = this.realtime.subscribe(houseId, (hint) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(hint));
      });
      ws.on('close', unsubscribe);
      // clients only listen; anything they send is ignored
    });
  }

  private reapDeadSockets(): void {
    for (const client of this.wss?.clients ?? []) {
      const ws = client as TrackedSocket;
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  /** idempotent: tests and Nest lifecycle may both call it */
  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
    this.wss = undefined;
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
