/**
 * Browser WebSocket client for the Node relay (`server/server.ts`).
 *
 *  - JSON text frames, one message per frame.
 *  - Heartbeat: sends `ping` every `pingInterval` ms; `latency` is the smoothed RTT from
 *    the echoed `pong`s (the Session uses the same pongs for clock synchronisation).
 *  - Watchdog: if nothing arrives for `timeout` ms the socket is considered dead.
 *  - Automatic reconnect with exponential backoff + jitter after unexpected drops
 *    (not after fatal close codes such as "room full" or after `close()`).
 *  - Back-pressure: pose updates are dropped while the socket buffer is congested.
 *
 * Uses the global `WebSocket` (browsers, Node ≥ 22) unless `WebSocketImpl` is given.
 */

import { FATAL_CLOSE_CODES, parseServerMessage, type ClientMessage, type ServerMessage } from './protocol';
import { HandlerSet, type Transport, type TransportCloseEvent } from './Transport';

export interface WebSocketTransportOptions {
  /** Reconnect automatically after unexpected drops. Default true. */
  reconnect?: boolean;
  /** Give up after this many consecutive failed reconnect attempts. Default 12 (~1.5 min). */
  maxReconnectAttempts?: number;
  /** First backoff delay (ms). Default 500. */
  baseDelay?: number;
  /** Max backoff delay (ms). Default 8000. */
  maxDelay?: number;
  /** Ping interval (ms). Default 2000. */
  pingInterval?: number;
  /** Silence after which the connection is considered dead (ms). Default 10000. */
  timeout?: number;
  /** Initial connect timeout (ms). Default 8000. */
  connectTimeout?: number;
  /** WebSocket constructor override (tests / non-browser runtimes). */
  WebSocketImpl?: typeof WebSocket;
}

const OPEN = 1;

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private readonly opts: Required<Omit<WebSocketTransportOptions, 'WebSocketImpl'>>;
  private readonly Impl: typeof WebSocket;
  private messages = new HandlerSet<ServerMessage>();
  private closes = new HandlerSet<TransportCloseEvent>();
  private reopens = new HandlerSet<void>();
  private everOpened = false;
  private userClosed = false;
  private finished = false;
  private reconnecting = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastRecv = 0;
  private rtt = 0;

  constructor(readonly url: string, opts: WebSocketTransportOptions = {}) {
    this.opts = {
      reconnect: opts.reconnect ?? true,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 12,
      baseDelay: opts.baseDelay ?? 500,
      maxDelay: opts.maxDelay ?? 8000,
      pingInterval: opts.pingInterval ?? 2000,
      timeout: opts.timeout ?? 10000,
      connectTimeout: opts.connectTimeout ?? 8000,
    };
    const Impl = opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Impl) throw new Error('WebSocket is not available in this environment');
    this.Impl = Impl;
  }

  get latency(): number {
    return this.rtt;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN;
  }

  connect(): Promise<void> {
    if (this.everOpened || this.ws) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(new Error(`Connection to ${this.url} timed out`));
      }, this.opts.connectTimeout);
      const fail = (err: Error) => {
        clearTimeout(timer);
        this.finished = true;
        if (this.ws) {
          const ws = this.ws;
          this.ws = null;
          this.detach(ws);
          try { ws.close(); } catch { /* ignore */ }
        }
        reject(err);
      };
      this.openSocket(
        () => { clearTimeout(timer); resolve(); },
        (reason) => fail(new Error(`Could not connect to ${this.url}${reason ? `: ${reason}` : ''}`)),
      );
    });
  }

  send(msg: ClientMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    // drop pose updates under congestion; they are superseded 50 ms later anyway
    if (msg.type === 'state' && ws.bufferedAmount > 64 * 1024) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    return this.messages.add(fn);
  }

  onClose(fn: (ev: TransportCloseEvent) => void): () => void {
    return this.closes.add(fn);
  }

  onReopen(fn: () => void): () => void {
    return this.reopens.add(fn);
  }

  close(): void {
    if (this.userClosed) return;
    this.userClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    if (ws && (ws.readyState === OPEN || ws.readyState === 0)) {
      try { ws.close(1000, 'client closed'); } catch { /* ignore */ }
    } else {
      this.finish({ reason: 'closed', code: 1000, willReconnect: false });
    }
  }

  // -------------------------------------------------------------------------------------

  private openSocket(onOpen?: () => void, onFail?: (reason: string) => void): void {
    let ws: WebSocket;
    try {
      ws = new this.Impl(this.url);
    } catch (err) {
      if (onFail) onFail((err as Error).message);
      else this.handleDrop(1006, (err as Error).message, false);
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempts = 0;
      this.lastRecv = performance.now();
      this.startHeartbeat();
      if (!this.everOpened) {
        this.everOpened = true;
        onOpen?.();
      } else {
        this.reconnecting = false;
        this.reopens.emit();
      }
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.lastRecv = performance.now();
      if (typeof ev.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const msg = parseServerMessage(raw);
      if (!msg) return;
      if (msg.type === 'pong') {
        const sample = performance.now() - msg.t;
        if (sample >= 0 && sample < 30000) this.rtt = this.rtt === 0 ? sample : this.rtt + (sample - this.rtt) * 0.2;
      }
      this.messages.emit(msg);
    };
    ws.onerror = () => {
      /* a close event always follows */
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws === ws) this.ws = null;
      this.stopHeartbeat();
      if (!this.everOpened) {
        onFail?.(ev.reason || `code ${ev.code}`);
        return;
      }
      this.handleDrop(ev.code, ev.reason, opened);
    };
  }

  private detach(ws: WebSocket): void {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
  }

  /** The socket closed after having been open at least once (or a reconnect attempt failed). */
  private handleDrop(code: number, reason: string, wasOpen: boolean): void {
    if (this.finished) return;
    const fatal = this.userClosed || FATAL_CLOSE_CODES.includes(code) || !this.opts.reconnect;
    if (fatal || this.attempts >= this.opts.maxReconnectAttempts) {
      this.finish({ reason: this.userClosed ? 'closed' : reason || `connection closed (${code})`, code, willReconnect: false });
      return;
    }
    if (wasOpen && !this.reconnecting) {
      this.reconnecting = true;
      this.closes.emit({ reason: reason || `connection lost (${code})`, code, willReconnect: true });
    }
    this.attempts++;
    const delay = Math.min(this.opts.maxDelay, this.opts.baseDelay * 2 ** (this.attempts - 1)) * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.userClosed && !this.finished) this.openSocket();
    }, delay);
  }

  private finish(ev: TransportCloseEvent): void {
    if (this.finished) return;
    this.finished = true;
    this.stopHeartbeat();
    this.closes.emit(ev);
    this.messages.clear();
    this.closes.clear();
    this.reopens.clear();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ping = () => this.send({ type: 'ping', t: performance.now() });
    // a short burst gives the session a good clock estimate right away
    ping();
    setTimeout(ping, 120);
    setTimeout(ping, 260);
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== OPEN) return;
      if (performance.now() - this.lastRecv > this.opts.timeout) {
        // half-open connection: don't wait for a close handshake that may never complete
        this.detach(ws);
        this.ws = null;
        this.stopHeartbeat();
        try { ws.close(4900, 'timeout'); } catch { /* ignore */ }
        this.handleDrop(4900, 'connection timed out', true);
        return;
      }
      ping();
    }, this.opts.pingInterval);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
