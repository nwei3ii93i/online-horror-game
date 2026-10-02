/**
 * Waldegg multiplayer relay.
 *
 * A small authoritative WebSocket server: one {@link HostCore} per room (rooms are
 * created on first join and dropped when the last player leaves). The HostCore is the
 * exact same code that runs in-process for solo play, so rules, validation and
 * reducers are identical in both modes.
 *
 *   PORT=8787 npx tsx server/server.ts
 *
 * Environment: PORT (8787), HOST (0.0.0.0), SEED (1987, default for new rooms),
 * MAX_ROOMS (200), RESUME_GRACE_MS (20000), LOG (1; 0 = quiet).
 *
 * HTTP GET /health → JSON status. Any other upgrade request path is accepted as WebSocket.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { HostCore, type HostConnection, type HostLink, type HostLogger } from '../src/net/HostCore';
import {
  CloseCode, DEFAULT_PORT, DEFAULT_SEED, PROTOCOL_VERSION, isRecord, normalizeRoom, parseClientMessage,
  type ErrorCode, type ServerMessage,
} from '../src/net/protocol';
import { defaultRegistry } from '../src/net/reducers';
// Shared world rules: the default reducers register themselves on import (via HostCore →
// WorldState → reducers). Import additional DOM-free game rule modules here so the relay
// knows them too, e.g.:  import '../src/gameplay/worldRules';

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Seed for new rooms unless the creating client requests one. */
  seed?: number;
  maxRooms?: number;
  resumeGraceMs?: number;
  /** Ping/terminate dead sockets at this interval (ms). */
  heartbeatMs?: number;
  /** Close sockets that do not send `hello` within this time (ms). */
  helloTimeoutMs?: number;
  /** Logger; `false` = silent. Default: console with timestamps. */
  log?: HostLogger | false;
}

export interface RunningServer {
  readonly port: number;
  readonly rooms: ReadonlyMap<string, HostCore>;
  close(): Promise<void>;
}

const MAX_PAYLOAD = 64 * 1024;

const consoleLogger: HostLogger = (level, msg) => {
  const line = `${new Date().toISOString()} ${level === 'warn' ? 'WARN ' : ''}${msg}`;
  if (level === 'warn') console.warn(line);
  else console.log(line);
};

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log: HostLogger = opts.log === false ? () => {} : (opts.log ?? consoleLogger);
  const defaultSeed = opts.seed ?? DEFAULT_SEED;
  const maxRooms = opts.maxRooms ?? 200;
  const heartbeatMs = opts.heartbeatMs ?? 10000;
  const helloTimeoutMs = opts.helloTimeoutMs ?? 5000;
  const rooms = new Map<string, HostCore>();
  const startedAt = Date.now();
  defaultRegistry.onError = (entity, op, err) => log('warn', `reducer for ${entity}.${op} threw: ${(err as Error)?.message ?? err}`);

  const httpServer = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      const body = JSON.stringify({
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptime: Math.round((Date.now() - startedAt) / 1000),
        rooms: [...rooms.values()].map((r) => ({ room: r.room, seed: r.seed, players: r.playerCount, connected: r.connectedCount })),
      });
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Waldegg relay: connect via WebSocket\n');
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, boolean>();

  function getRoom(code: string, seed: number | undefined): HostCore | null {
    const existing = rooms.get(code);
    if (existing) return existing;
    if (rooms.size >= maxRooms) return null;
    const room: HostCore = new HostCore({
      room: code,
      seed: seed ?? defaultSeed,
      resumeGraceMs: opts.resumeGraceMs ?? 20000,
      log,
      onEmpty: () => {
        // defer: onEmpty fires from inside the host's own message handling
        queueMicrotask(() => {
          if (rooms.get(code) === room && room.playerCount === 0) {
            room.dispose();
            rooms.delete(code);
            log('info', `[${code}] room closed`);
          }
        });
      },
    });
    rooms.set(code, room);
    room.start();
    log('info', `[${code}] room created (seed ${room.seed})`);
    return room;
  }

  wss.on('connection', (ws, req) => {
    const addr = `${req.socket.remoteAddress ?? '?'}:${req.socket.remotePort ?? '?'}`;
    alive.set(ws, true);
    let link: HostLink | null = null;

    const sendRaw = (msg: ServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const fail = (code: ErrorCode, message: string, closeCode: number): void => {
      sendRaw({ type: 'error', code, message, fatal: true });
      ws.close(closeCode, message.slice(0, 120));
    };
    const conn: HostConnection = {
      send: sendRaw,
      close: (code, reason) => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code ?? 1000, (reason ?? '').slice(0, 120));
      },
    };

    const helloTimer = setTimeout(() => {
      if (!link) fail('hello_timeout', 'No hello received', CloseCode.HelloTimeout);
    }, helloTimeoutMs);

    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data: RawData, isBinary: boolean) => {
      alive.set(ws, true);
      if (isBinary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        sendRaw({ type: 'error', code: 'bad_request', message: 'Invalid JSON', fatal: false });
        return;
      }
      if (link) {
        link.receive(raw);
        return;
      }
      // lobby: route the first hello to its room
      if (isRecord(raw) && raw.type === 'ping' && typeof raw.t === 'number') {
        sendRaw({ type: 'pong', t: raw.t, serverTime: performance.now() });
        return;
      }
      const msg = parseClientMessage(raw);
      if (!msg || msg.type !== 'hello') {
        sendRaw({ type: 'error', code: 'not_joined', message: 'Send hello first', fatal: false });
        return;
      }
      if (msg.protocol !== PROTOCOL_VERSION) {
        fail('protocol_mismatch', `Protocol ${msg.protocol} not supported (server speaks ${PROTOCOL_VERSION})`, CloseCode.ProtocolMismatch);
        return;
      }
      const code = normalizeRoom(msg.room);
      if (!code) {
        fail('bad_room', 'Invalid room code', CloseCode.BadRoom);
        return;
      }
      const room = getRoom(code, msg.seed);
      if (!room) {
        fail('server_full', 'Server has no free rooms', CloseCode.ServerFull);
        return;
      }
      clearTimeout(helloTimer);
      link = room.connect(conn);
      link.receive(raw);
      if (link.playerId) log('info', `[${code}] ${link.playerId} connected from ${addr}`);
    });

    ws.on('close', (code: number) => {
      clearTimeout(helloTimer);
      link?.disconnect(code === 1000 ? 'closed' : `dropped (${code})`);
      link = null;
    });

    ws.on('error', (err: Error) => log('warn', `socket error from ${addr}: ${err.message}`));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }
  }, heartbeatMs);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port ?? DEFAULT_PORT, opts.host ?? '0.0.0.0', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? DEFAULT_PORT);

  let closing: Promise<void> | null = null;
  return {
    port,
    rooms,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const room of rooms.values()) room.dispose('Server shutting down');
        rooms.clear();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      });
      return closing;
    },
  };
}

// ---------------------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------------------

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const env = process.env;
  const num = (v: string | undefined): number | undefined => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const server = await startServer({
    port: num(env.PORT) ?? DEFAULT_PORT,
    host: env.HOST || '0.0.0.0',
    seed: num(env.SEED),
    maxRooms: num(env.MAX_ROOMS),
    resumeGraceMs: num(env.RESUME_GRACE_MS),
    log: env.LOG === '0' ? false : undefined,
  });
  consoleLogger('info', `Waldegg relay listening on ws://${env.HOST || '0.0.0.0'}:${server.port} (protocol v${PROTOCOL_VERSION})`);
  const shutdown = (sig: string) => {
    consoleLogger('info', `${sig} received, shutting down`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
