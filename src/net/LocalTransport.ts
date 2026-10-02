/**
 * Loopback transport for solo play: embeds the authoritative {@link HostCore} in-process.
 *
 * Messages are JSON round-tripped (exactly what the network would do, so solo and
 * multiplayer behave identically and nobody can share mutable objects across the
 * boundary) and delivered on the microtask queue: zero latency, but still asynchronous
 * like a real connection. Works fully offline.
 *
 * Several LocalTransports may share one HostCore (`{ host }`), e.g. to run two Sessions
 * against each other in a test or a local split-screen experiment.
 */

import { HostCore, type HostCoreOptions, type HostLink } from './HostCore';
import type { ClientMessage, ServerMessage } from './protocol';
import { HandlerSet, type Transport, type TransportCloseEvent } from './Transport';

export interface LocalTransportOptions extends HostCoreOptions {
  /** Use an existing host instead of creating (and owning) one. */
  host?: HostCore;
}

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class LocalTransport implements Transport {
  readonly host: HostCore;
  readonly latency = 0;
  private readonly ownsHost: boolean;
  private link: HostLink | null = null;
  private closed = false;
  private messages = new HandlerSet<ServerMessage>();
  private closes = new HandlerSet<TransportCloseEvent>();

  constructor(opts: LocalTransportOptions = {}) {
    this.ownsHost = !opts.host;
    this.host = opts.host ?? new HostCore({ room: 'SOLO', resumeGraceMs: 0, ...opts });
  }

  get connected(): boolean {
    return this.link !== null && !this.closed;
  }

  async connect(): Promise<void> {
    if (this.link || this.closed) return;
    this.link = this.host.connect({
      send: (msg) => {
        const copy = roundTrip(msg);
        queueMicrotask(() => {
          if (!this.closed) this.messages.emit(copy);
        });
      },
      close: (code, reason) => {
        queueMicrotask(() => this.finish(reason ?? 'closed by host', code));
      },
    });
    if (this.ownsHost) this.host.start();
  }

  send(msg: ClientMessage): void {
    const link = this.link;
    if (!link || this.closed) return;
    const copy = roundTrip(msg);
    queueMicrotask(() => {
      if (!this.closed) link.receive(copy);
    });
  }

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    return this.messages.add(fn);
  }

  onClose(fn: (ev: TransportCloseEvent) => void): () => void {
    return this.closes.add(fn);
  }

  close(): void {
    if (this.closed) return;
    const link = this.link;
    this.closed = true;
    link?.receive({ type: 'bye' });
    link?.disconnect('bye');
    if (this.ownsHost) this.host.dispose();
    this.closes.emit({ reason: 'closed', willReconnect: false });
    this.messages.clear();
    this.closes.clear();
  }

  private finish(reason: string, code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.link?.disconnect(reason);
    if (this.ownsHost) this.host.dispose();
    this.closes.emit({ reason, code, willReconnect: false });
  }
}
