/**
 * Message pipe between a {@link Session} and an authoritative host.
 *
 * Implementations:
 *  - {@link LocalTransport}: in-process loopback to an embedded HostCore (solo, offline).
 *  - {@link WebSocketTransport}: JSON over WebSocket to the Node relay (multiplayer).
 */

import type { ClientMessage, ServerMessage } from './protocol';

export interface TransportCloseEvent {
  /** Human-readable reason. */
  reason: string;
  /** WebSocket close code when available. */
  code?: number;
  /** True while the transport is trying to re-establish the connection by itself. */
  willReconnect: boolean;
}

export interface Transport {
  /** Opens the connection. Resolves once messages can be sent. */
  connect(): Promise<void>;
  /** Sends a message (silently dropped while disconnected). */
  send(msg: ClientMessage): void;
  /** Subscribes to messages from the host. Returns an unsubscribe function. */
  onMessage(fn: (msg: ServerMessage) => void): () => void;
  /** Connection lost (`willReconnect`) or closed for good. Returns an unsubscribe function. */
  onClose(fn: (ev: TransportCloseEvent) => void): () => void;
  /** Called after an automatic reconnect succeeded (the session must send `hello` again). */
  onReopen?(fn: () => void): () => void;
  /** Closes for good (no reconnect). */
  close(): void;
  /** Smoothed round-trip time in ms (0 for the local loopback). */
  readonly latency: number;
  /** Whether messages can currently be sent. */
  readonly connected: boolean;
}

/** Tiny handler set used by transports. */
export class HandlerSet<T> {
  private set = new Set<(v: T) => void>();
  add(fn: (v: T) => void): () => void {
    this.set.add(fn);
    return () => this.set.delete(fn);
  }
  emit(v: T): void {
    for (const fn of [...this.set]) {
      try {
        fn(v);
      } catch (err) {
        console.error('[net] handler failed', err);
      }
    }
  }
  clear(): void {
    this.set.clear();
  }
}
