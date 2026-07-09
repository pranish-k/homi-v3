import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
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
 *
 * Sockets are torn down in beforeApplicationShutdown, which Nest runs
 * BEFORE it closes the HTTP server: a live WebSocket would otherwise
 * keep httpServer.close() waiting forever and turn every deploy into a
 * SIGKILL.
 */
@Injectable()
export class RealtimeGateway implements BeforeApplicationShutdown {
  private wss?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;
  private attachedServer?: Server;

  constructor(
    private readonly membership: MembershipService,
    private readonly realtime: RealtimeService,
  ) {}

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    this.attachedServer = server;
    this.heartbeat = setInterval(() => this.reapDeadSockets(), HEARTBEAT_MS);
    this.heartbeat.unref();

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // a client resetting the connection mid-handshake must not become
      // an unhandled 'error' event, which would kill the process
      socket.on('error', () => socket.destroy());
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
    if (!match?.[1] || !UUID_RE.test(match[1])) {
      // this gateway owns the only WS endpoint; if another upgrade
      // listener ever exists, let it answer paths that are not ours
      if (this.attachedServer && this.attachedServer.listenerCount('upgrade') > 1) return;
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

    // subscribe BEFORE completing the handshake: once the client sees
    // 'open' the subscription is live, so a hint published right after
    // connect cannot race past it
    let ws: TrackedSocket | undefined;
    const unsubscribe = await this.realtime.subscribe(houseId, (hint) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(hint));
    });

    if (!this.wss) {
      // shutdown began while the handshake was in flight
      unsubscribe();
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (client: TrackedSocket) => {
      ws = client;
      this.wss?.emit('connection', client, req);
      client.isAlive = true;
      client.on('pong', () => {
        client.isAlive = true;
      });
      client.on('close', unsubscribe);
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
  beforeApplicationShutdown(): void {
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
