/**
 * Networking self-test:  npx tsx server/selftest.ts
 *
 *  1. HostCore in-process with fake connections and a fake clock (join, poses, speed
 *     validation, door/item rules, late-join snapshot, leave, resume, capacity, limits).
 *  2. Interpolation buffer.
 *  3. Session over LocalTransport (solo path) incl. optimistic prediction + rollback.
 *  4. The real WebSocket server on a random port with raw `ws` clients.
 *  5. Session over WebSocketTransport (Node's global WebSocket) against that server:
 *     roster events, remote interpolation, actions, sounds, clock sync, drop + resume.
 *
 * Prints PASS/FAIL per check and exits with code 1 on any failure.
 */

import { WebSocket } from 'ws';
import { HostCore, type HostLink } from '../src/net/HostCore';
import { LocalTransport } from '../src/net/LocalTransport';
import { Session } from '../src/net/Session';
import { SnapshotBuffer } from '../src/net/Interpolation';
import { CloseCode, PROTOCOL_VERSION, type ClientMessage, type PlayerSnapshot, type ServerMessage } from '../src/net/protocol';
import { startServer } from './server';

let passed = 0;
let failed = 0;
function check(name: string, cond: unknown, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n# ${title}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Msg = ServerMessage;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;

// ---------------------------------------------------------------------------------------
// 1. HostCore in-process
// ---------------------------------------------------------------------------------------

class FakeClient {
  inbox: Msg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  readonly link: HostLink;
  constructor(host: HostCore) {
    this.link = host.connect({
      send: (m) => this.inbox.push(JSON.parse(JSON.stringify(m)) as Msg),
      close: (code, reason) => { this.closed = { code, reason }; },
    });
  }
  send(m: ClientMessage | Record<string, unknown>): void {
    this.link.receive(JSON.parse(JSON.stringify(m)));
  }
  all<T extends Msg['type']>(type: T): Of<T>[] {
    return this.inbox.filter((m): m is Of<T> => m.type === type);
  }
  last<T extends Msg['type']>(type: T): Of<T> | undefined {
    const a = this.all(type);
    return a[a.length - 1];
  }
  clear(): void {
    this.inbox = [];
  }
}

const hello = (name: string, extra: Record<string, unknown> = {}) => ({ type: 'hello', protocol: PROTOCOL_VERSION, name, room: 'TEST', ...extra });
const state = (t: number, p: [number, number, number], extra: Record<string, unknown> = {}) =>
  ({ type: 'state', seq: 0, t, p, yaw: 0.5, pitch: -0.1, stance: 'stand', light: true, vel: [1, 0, 0], ...extra });

function testHostCore(): void {
  section('HostCore (in-process, fake clock)');
  let clock = 10_000;
  const host = new HostCore({ room: 'TEST', now: () => clock, resumeGraceMs: 5000 });

  // join
  const A = new FakeClient(host), B = new FakeClient(host), C = new FakeClient(host);
  A.send(hello('Anna'));
  B.send(hello('Ben'));
  C.send(hello('Cleo\u0007 <b>'));
  const wa = A.last('welcome'), wb = B.last('welcome'), wc = C.last('welcome');
  check('3 clients receive welcome', wa && wb && wc);
  const ids = [wa?.you.id, wb?.you.id, wc?.you.id];
  check('player ids are unique', new Set(ids).size === 3, ids);
  check('player colours are unique', new Set([wa?.you.color, wb?.you.color, wc?.you.color]).size === 3);
  check('welcome lists the others (not self)', wa?.players.length === 0 && wb?.players.length === 1 && wc?.players.length === 2);
  check('welcome carries seed 1987 and token', wa?.seed === 1987 && typeof wa?.token === 'string' && wa.token.length >= 16);
  check('names are sanitised', wc?.you.name === 'Cleo <b>', wc?.you.name);
  check('existing players are told about joins', A.all('joined').length === 2 && B.all('joined').length === 1 && C.all('joined').length === 0);
  const [ida, idb, idc] = ids as string[];

  // poses
  A.clear(); B.clear(); C.clear();
  A.send(state(clock, [0, 0, 0]));
  host.tick();
  const sb = B.last('states');
  check('tick broadcasts A pose to B and C', sb?.players.some((p) => p.id === ida) && C.last('states')?.players.some((p) => p.id === ida));
  check('sender does not receive its own pose', A.all('states').length === 0);
  check('pose is quantised', sb?.players[0].yaw === 0.5 && sb.players[0].pitch === -0.1);
  clock += 50;
  A.send(state(clock, [0.08, 0, 0]));
  host.tick();
  check('normal movement accepted', B.last('states')?.players.find((p) => p.id === ida)?.p[0] === 0.08);
  B.clear();
  clock += 50;
  A.send(state(clock, [100, 0, 0]));
  host.tick();
  check('teleport > 15 m/s rejected', B.all('states').length === 0 && host.stats.rejectedStates === 1);
  clock += 50;
  A.send(state(clock, [100, 0, 0], { tp: true }));
  host.tick();
  check('flagged teleport accepted', B.last('states')?.players.find((p) => p.id === ida)?.p[0] === 100);
  const dropped = host.stats.droppedMessages;
  A.send({ ...state(clock + 50, [100, 0, 0]), p: [NaN, 0, 0] });
  A.send({ ...state(clock + 50, [100, 0, 0]), stance: 'flying' });
  check('non-finite / invalid states dropped', host.stats.droppedMessages === dropped + 2);

  // door rules
  A.clear(); B.clear(); C.clear();
  B.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'lock' });
  const ackLock = B.last('ack');
  check('lock accepted', ackLock?.ok === true && ackLock.state?.locked === true);
  check('others receive entity update', A.last('entity')?.state.locked === true && C.last('entity')?.by === idb);
  check('actor gets ack, not a duplicate entity', B.all('entity').length === 0);
  C.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'open', data: { angle: 1.2 } });
  const ackOpen = C.last('ack');
  check('open rejected while locked', ackOpen?.ok === false && ackOpen.state?.locked === true && ackOpen.state?.open === false);
  check('rejection is not broadcast', A.all('entity').length === 1);
  A.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'unlock' });
  C.send({ type: 'action', seq: 2, entity: 'door:manor_front', op: 'open', data: { angle: 1.2 } });
  check('unlock then open accepted', A.last('ack')?.ok === true && C.last('ack')?.ok === true && C.last('ack')?.state?.angle === 1.2);

  A.send({ type: 'declare', entities: { 'door:cellar': { locked: true, key: 'cellar_key' }, 'item:lantern': {} } });
  check('declare broadcasts new entities', B.last('entities')?.states['door:cellar']?.locked === true);
  B.send({ type: 'declare', entities: { 'door:cellar': { locked: false } } });
  check('re-declare does not override, declarer gets correction', host.world.get('door:cellar')?.locked === true && B.last('entities')?.states['door:cellar']?.locked === true);
  B.send({ type: 'action', seq: 2, entity: 'door:cellar', op: 'unlock', data: { key: 'rusty_nail' } });
  check('unlock with wrong key rejected', B.last('ack')?.ok === false);
  B.send({ type: 'action', seq: 3, entity: 'door:cellar', op: 'unlock', data: { key: 'cellar_key' } });
  check('unlock with right key accepted', B.last('ack')?.ok === true && host.world.get('door:cellar')?.locked === false);
  B.send({ type: 'action', seq: 4, entity: 'door:cellar', op: 'toggle' });
  check('toggle opens', host.world.get('door:cellar')?.open === true);
  B.send({ type: 'action', seq: 5, entity: 'door:cellar', op: 'lock', data: { key: 'cellar_key' } });
  check('cannot lock an open door', B.last('ack')?.ok === false);
  B.send({ type: 'action', seq: 6, entity: 'unknown:thing', op: 'poke' });
  check('unknown entity type rejected', B.last('ack')?.ok === false);
  B.send({ type: 'action', seq: 7, entity: 'door:cellar', op: '$release' });
  check('host-internal ops cannot be sent', B.all('ack').every((a) => a.seq !== 7));

  // items, lights, notes, switches
  A.send({ type: 'action', seq: 2, entity: 'item:lantern', op: 'take' });
  C.send({ type: 'action', seq: 3, entity: 'item:lantern', op: 'take' });
  check('item take: first wins, second rejected', A.last('ack')?.ok === true && C.last('ack')?.ok === false && host.world.get('item:lantern')?.by === ida);
  C.send({ type: 'action', seq: 4, entity: 'item:lantern', op: 'drop', data: { p: [1, 2, 3] } });
  check('only the holder can drop', C.last('ack')?.ok === false);
  C.send({ type: 'action', seq: 5, entity: 'light:hall', op: 'toggle' });
  C.send({ type: 'action', seq: 6, entity: 'switch:fusebox', op: 'toggle' });
  check('light/switch toggle', host.world.get('light:hall')?.on === true && host.world.get('switch:fusebox')?.on === true);
  const before = A.all('entity').length;
  C.send({ type: 'action', seq: 7, entity: 'note:diary_1', op: 'read' });
  check('note read accepted without state change', C.last('ack')?.ok === true && A.all('entity').length === before && !host.world.has('note:diary_1'));

  // late join
  const D = new FakeClient(host);
  D.send(hello('Dora'));
  const wd = D.last('welcome');
  check('late joiner gets world snapshot', wd?.world['door:manor_front']?.open === true && wd.world['door:cellar']?.open === true && wd.world['item:lantern']?.by === ida);
  check('late joiner gets current poses', D.last('states')?.players.some((p) => p.id === ida && p.p[0] === 100));
  const idd = wd?.you.id as string;

  // leave
  A.clear(); C.clear(); D.clear();
  B.send({ type: 'bye' });
  check('bye -> others get left', A.last('left')?.id === idb && C.last('left')?.id === idb && D.last('left')?.reason === 'left');
  check('bye closes the connection', B.closed?.code === 1000);

  // drop + resume
  const tokenC = wc?.token as string;
  C.link.disconnect('dropped');
  check('dropped player keeps slot during grace period', A.all('left').length === 1 && host.playerCount === 3);
  const C2 = new FakeClient(host);
  C2.send(hello('Cleo', { resume: { id: idc, token: tokenC } }));
  check('resume with token restores same id', C2.last('welcome')?.resumed === true && C2.last('welcome')?.you.id === idc);
  check('resume is invisible to others', A.all('joined').length === 0 && A.all('left').length === 1);
  const C3 = new FakeClient(host);
  C3.send(hello('Mallory', { resume: { id: idc, token: 'wrong' } }));
  check('resume with wrong token is a new player', C3.last('welcome')?.resumed === false && C3.last('welcome')?.you.id !== idc);
  C3.send({ type: 'bye' });
  C2.link.disconnect('dropped');
  clock += 5100;
  host.tick();
  check('slot expires after grace -> left(timeout)', A.all('left').some((l) => l.id === idc && l.reason === 'timeout'));

  // capacity
  const extra: FakeClient[] = [];
  for (const n of ['E', 'F', 'G', 'H']) {
    const c = new FakeClient(host);
    c.send(hello(n));
    extra.push(c);
  }
  check('room holds 6 players', host.playerCount === 6, host.playerCount);
  const X = new FakeClient(host);
  X.send(hello('Seventh'));
  const err = X.last('error');
  check('7th player rejected (room_full)', err?.code === 'room_full' && err.fatal && X.closed?.code === CloseCode.RoomFull && !X.last('welcome'));

  // item release on leave
  D.clear();
  A.send({ type: 'bye' });
  const rel = D.all('entity').find((e) => e.entity === 'item:lantern');
  check('items held by a leaving player are dropped at their position', rel?.state.taken === false && rel.by === 'host' && JSON.stringify(rel.state.p) === '[100,0,0]');

  // protocol + validation
  const P = new FakeClient(host);
  P.send({ type: 'hello', protocol: 999, name: 'Old', room: 'TEST' });
  check('protocol mismatch rejected', P.last('error')?.code === 'protocol_mismatch' && P.closed?.code === CloseCode.ProtocolMismatch);
  const Q = new FakeClient(host);
  Q.send({ type: 'action', seq: 1, entity: 'door:x', op: 'open' });
  check('actions before hello rejected', Q.last('error')?.code === 'not_joined');

  // rate limit
  const E = extra[0];
  E.clear();
  for (let i = 0; i < 100; i++) E.send({ type: 'action', seq: 100 + i, entity: 'light:spam', op: 'toggle' });
  const limited = E.all('ack').filter((a) => a.reason === 'rate_limited').length;
  check('action rate limit kicks in', limited > 0 && limited < 100, limited);

  void idd;
  host.dispose();
  check('dispose notifies remaining clients', D.last('error')?.code === 'server_shutdown');
}

// ---------------------------------------------------------------------------------------
// 2. Interpolation
// ---------------------------------------------------------------------------------------

function testInterpolation(): void {
  section('Interpolation buffer');
  const snap = (t: number, x: number, extra: Partial<PlayerSnapshot> = {}): PlayerSnapshot =>
    ({ id: 'p1', t, p: [x, 0, 0], yaw: 3.1, pitch: 0, stance: 'stand', light: true, vel: [10, 0, 0], ...extra });
  const b = new SnapshotBuffer();
  b.push(snap(1000, 0));
  b.push(snap(1100, 1, { yaw: -3.1 }));
  check('out-of-order sample ignored', !b.push(snap(1050, 5)));
  const mid = b.sample(1050);
  check('linear position interpolation', mid !== null && Math.abs(mid.p[0] - 0.5) < 1e-9, mid?.p);
  check('yaw interpolates across ±π via the short arc', mid !== null && Math.abs(Math.abs(mid.yaw) - Math.PI) < 0.01, mid?.yaw);
  const ex = b.sample(1150);
  check('extrapolates with velocity', ex !== null && ex.extrapolated && Math.abs(ex.p[0] - 1.5) < 1e-9, ex?.p);
  const clampEx = b.sample(5000);
  check('extrapolation clamped to 200 ms', clampEx !== null && Math.abs(clampEx.p[0] - 3) < 1e-9, clampEx?.p);
  b.push(snap(1200, 80, { stance: 'crouch' }));
  const tp = b.sample(1150);
  check('teleports are not interpolated', tp !== null && tp.p[0] === 1, tp?.p);
  const before = b.sample(900);
  check('before first sample holds first pose', before !== null && before.p[0] === 0);
}

// ---------------------------------------------------------------------------------------
// 3. Solo session (LocalTransport)
// ---------------------------------------------------------------------------------------

async function testSolo(): Promise<void> {
  section('Session.solo (LocalTransport loopback)');
  const s = await Session.solo('Solo', { seed: 42 });
  check('solo session established', s.mode === 'solo' && s.connected && s.localId !== '' && s.room === 'SOLO');
  check('solo seed honoured', s.seed === 42);
  check('solo clock offset ~0', Math.abs(s.serverNow() - performance.now()) < 5);
  const seen: string[] = [];
  s.world.subscribe((id, st) => seen.push(`${id}:${st?.open ?? '-'}:${st?.locked ?? '-'}`), 'door:');
  s.declare('door:shed', { locked: true, key: 'shed_key' });
  check('declare applies locally', s.world.get('door:shed')?.locked === true);
  check('predict reflects rules', !s.predict('door:shed', 'open') && s.predict('door:shed', 'unlock', { key: 'shed_key' }));
  check('locked door open rejected', (await s.act('door:shed', 'open')) === false && s.world.get('door:shed')?.open !== true && s.world.get('door:shed')?.locked === true);
  check('unlock with key', (await s.act('door:shed', 'unlock', { key: 'shed_key' })) === true && s.world.get('door:shed')?.locked === false);
  const pr = s.act('door:shed', 'open', { angle: 1.1 });
  check('open applies optimistically (synchronously)', s.world.get('door:shed')?.open === true);
  check('open confirmed', (await pr) === true && s.world.get('door:shed')?.angle === 1.1);
  check('subscribe fired for each visible change', seen.length >= 3, seen);
  let sound = false;
  s.on('sound', () => { sound = true; });
  s.emitSound('scream', [0, 1, 0], 1);
  s.sendLocalState({ p: { x: 1, y: 2, z: 3 }, yaw: 0, pitch: 0, stance: 'stand', light: true });
  await flush();
  check('own sounds are not echoed back', !sound);
  let disc = false;
  s.on('disconnected', (e) => { disc = !e.willReconnect; });
  s.close();
  check('close emits final disconnected', disc && !s.connected);
  check('act after close resolves false', (await s.act('door:shed', 'close')) === false);

  section('Two sessions on one in-process host (prediction + rollback)');
  const host = new HostCore({ room: 'LAN' });
  const X = await Session.create(new LocalTransport({ host }), 'solo', 'LAN', 'X');
  const Y = await Session.create(new LocalTransport({ host }), 'solo', 'LAN', 'Y');
  await flush();
  check('X sees Y join', X.players.has(Y.localId) && Y.players.has(X.localId));
  const lockP = X.act('door:gate', 'lock');
  const openP = Y.act('door:gate', 'open');
  check('Y predicts open optimistically', Y.world.get('door:gate')?.open === true);
  const [lockOk, openOk] = await Promise.all([lockP, openP]);
  await flush();
  check('host serialises: lock wins, open rejected', lockOk === true && openOk === false);
  check('Y rolled back to authoritative (closed + locked)', Y.world.get('door:gate')?.open === false && Y.world.get('door:gate')?.locked === true);
  X.close();
  Y.close();
  host.dispose();
}

// ---------------------------------------------------------------------------------------
// 4. Real WebSocket server with raw ws clients
// ---------------------------------------------------------------------------------------

class WsClient {
  msgs: Msg[] = [];
  closed: { code: number; reason: string } | null = null;
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString()) as Msg));
    ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
  }
  static open(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new WsClient(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }
  send(m: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends Msg['type']>(type: T, pred: (m: Of<T>) => boolean = () => true, timeout = 2000): Promise<Of<T> | undefined> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const i = this.msgs.findIndex((m) => m.type === type && pred(m as Of<T>));
      if (i >= 0) return this.msgs.splice(i, 1)[0] as Of<T>;
      await sleep(5);
    }
    return undefined;
  }
  async waitClosed(timeout = 2000): Promise<boolean> {
    const end = Date.now() + timeout;
    while (Date.now() < end && !this.closed) await sleep(5);
    return !!this.closed;
  }
}

async function testServer(url: string, port: number): Promise<void> {
  section(`WebSocket server (raw ws clients, ${url})`);
  const join = async (name: string, room = 'alpha') => {
    const c = await WsClient.open(url);
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, name, room });
    const w = await c.waitFor('welcome');
    return { c, w };
  };
  const a = await join('Anna'), b = await join('Ben'), c = await join('Cleo');
  check('3 ws clients joined room ALPHA', !!a.w && !!b.w && !!c.w && a.w.room === 'ALPHA' && c.w?.players.length === 2);
  const ida = a.w?.you.id as string;
  check('A told about B and C', !!(await a.c.waitFor('joined', (m) => m.player.id === b.w?.you.id)) && !!(await a.c.waitFor('joined', (m) => m.player.id === c.w?.you.id)));

  a.c.send({ type: 'state', seq: 1, t: performance.now(), p: [5, 0, 5], yaw: 1, pitch: 0, stance: 'crouch', light: false, vel: [0, 0, 0] });
  const st = await b.c.waitFor('states', (m) => m.players.some((p) => p.id === ida));
  check('state relayed to B within a tick', st?.players.find((p) => p.id === ida)?.stance === 'crouch');

  b.c.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'lock' });
  check('B lock acked', (await b.c.waitFor('ack', (m) => m.seq === 1))?.ok === true);
  check('C receives entity update', (await c.c.waitFor('entity', (m) => m.entity === 'door:manor_front'))?.state.locked === true);
  c.c.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'open' });
  check('C open rejected while locked', (await c.c.waitFor('ack', (m) => m.seq === 1))?.ok === false);
  a.c.send({ type: 'action', seq: 1, entity: 'door:manor_front', op: 'unlock' });
  await a.c.waitFor('ack', (m) => m.seq === 1);
  c.c.send({ type: 'action', seq: 2, entity: 'door:manor_front', op: 'open', data: { angle: 1.4 } });
  check('C open accepted after unlock', (await c.c.waitFor('ack', (m) => m.seq === 2))?.ok === true);

  c.c.send({ type: 'sound', id: 'door_slam', p: [1, 2, 3], v: 2 });
  const snd = await a.c.waitFor('sound');
  check('sound relayed (volume clamped)', snd?.id === 'door_slam' && snd.v === 1 && snd.by === c.w?.you.id);

  const d = await join('Dora');
  check('late join snapshot over ws', d.w?.world['door:manor_front']?.open === true && d.w.world['door:manor_front']?.locked === false);

  b.c.send({ type: 'bye' });
  b.c.ws.close(1000);
  check('leave relayed over ws', (await a.c.waitFor('left'))?.id === b.w?.you.id);

  const e = await join('Ema'), f = await join('Finn'), g = await join('Gus');
  check('room filled to 6', !!e.w && !!f.w && !!g.w);
  const h = await WsClient.open(url);
  h.send({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Hugo', room: 'ALPHA' });
  const herr = await h.waitFor('error');
  await h.waitClosed();
  check('7th player rejected over ws', herr?.code === 'room_full' && h.closed?.code === CloseCode.RoomFull);

  const other = await join('Zed', 'beta');
  check('rooms are isolated', other.w?.room === 'BETA' && other.w.players.length === 0 && Object.keys(other.w.world).length === 0);

  const bad = await WsClient.open(url);
  bad.send({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'x', room: 'no spaces!' });
  check('invalid room code rejected', (await bad.waitFor('error'))?.code === 'bad_room' && (await bad.waitClosed()));

  const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { ok: boolean; rooms: { room: string; players: number }[] };
  check('health endpoint lists rooms', health.ok && health.rooms.some((r) => r.room === 'ALPHA' && r.players === 6));

  for (const x of [a, c, d, e, f, g, other]) x.c.ws.close(1000);
  h.ws.close();
  bad.ws.close();
}

// ---------------------------------------------------------------------------------------
// 5. Session over WebSocket
// ---------------------------------------------------------------------------------------

async function testSessionOnline(url: string): Promise<void> {
  section('Session.connect (WebSocketTransport, global WebSocket)');
  const s1 = await Session.connect(url, 'gamma', 'Anna');
  const joined: string[] = [];
  s1.on('playerJoined', (p) => joined.push(p.name));
  const s2 = await Session.connect(url, 'gamma', 'Ben');
  await sleep(50);
  check('both sessions connected', s1.connected && s2.connected && s1.mode === 'online');
  check('playerJoined event + roster', joined.includes('Ben') && s2.players.has(s1.localId));
  check('clock sync (same process, offset ~0)', Math.abs(s1.serverNow() - performance.now()) < 25, s1.serverNow() - performance.now());

  // walk s1 along +x at 1.5 m/s for ~0.6 s
  const t0 = performance.now();
  while (performance.now() - t0 < 600) {
    const x = ((performance.now() - t0) / 1000) * 1.5;
    s1.sendLocalState({ p: [x, 0, 0], vel: [1.5, 0, 0], yaw: 0.3, pitch: 0.1, stance: 'stand', light: true });
    await sleep(16);
  }
  const rt = s2.renderTime();
  const smp = s2.sampleRemote(s1.localId, rt);
  // s1 stamped its samples with its host-clock estimate; map s2's render time back to s1's local clock
  const off1 = s1.serverNow() - performance.now();
  const expected = ((rt - off1 - t0) / 1000) * 1.5;
  check('remote pose interpolated on s2', smp !== null && smp.light && smp.stance === 'stand' && Math.abs(smp.p[0] - expected) < 0.2, { got: smp?.p[0], expected });
  check('interpolation delay >= 100 ms', s2.interpolationDelay >= 100, s2.interpolationDelay);
  check('latency measured', s1.latency >= 0 && Number.isFinite(s1.latency), s1.latency);

  let entityEv: unknown = null;
  s2.on('entity', (e) => { if (e.entity === 'door:hall') entityEv = e; });
  check('s1 locks door', (await s1.act('door:hall', 'lock')) === true);
  await sleep(30);
  check('s2 sees lock via entity event + world', s2.world.get('door:hall')?.locked === true && (entityEv as { by?: string } | null)?.by === s1.localId);
  check('s2 open rejected', (await s2.act('door:hall', 'open')) === false && s2.world.get('door:hall')?.open === false);

  let heard: { id: string; v: number } | null = null;
  s2.on('sound', (e) => { heard = e; });
  s1.emitSound('glass_break', [1, 2, 3], 0.8);
  await sleep(30);
  check('sound event received', (heard as { id: string } | null)?.id === 'glass_break');

  // connection drop -> automatic reconnect -> resume same slot
  let left = false;
  s2.on('playerLeft', () => { left = true; });
  const reconnected = new Promise<{ resumed: boolean; idChanged: boolean }>((r) => s1.on('reconnected', r));
  let dropped = false;
  s1.on('disconnected', (e) => { dropped = e.willReconnect; });
  const id1 = s1.localId;
  (s1.transport as unknown as { ws: { close(code: number): void } }).ws.close(4999);
  const rec = await Promise.race([reconnected, sleep(4000).then(() => null)]);
  check('drop detected (willReconnect)', dropped);
  check('reconnect resumes the same player slot', rec !== null && rec.resumed && !rec.idChanged && s1.localId === id1, rec);
  check('others did not see a leave', !left);
  check('world survives reconnect', s1.world.get('door:hall')?.locked === true);

  s1.close();
  await sleep(80);
  check('orderly close -> playerLeft on s2', left && !s2.players.has(id1));
  s2.close();

  let rejected = '';
  try {
    await Session.connect('ws://127.0.0.1:1', 'x', 'nobody', { transport: { connectTimeout: 1500 } });
  } catch (err) {
    rejected = (err as Error).message;
  }
  check('unreachable server rejects connect()', rejected !== '', rejected);
}

// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  testHostCore();
  testInterpolation();
  await testSolo();
  const server = await startServer({ port: 0, host: '127.0.0.1', log: false, resumeGraceMs: 2000, heartbeatMs: 1000 });
  const url = `ws://127.0.0.1:${server.port}`;
  try {
    await testServer(url, server.port);
    await testSessionOnline(url);
    await sleep(50);
    check('empty rooms are cleaned up', !server.rooms.has('BETA'), [...server.rooms.keys()]);
  } finally {
    await server.close();
  }
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  console.log('\nFAIL: exception');
  process.exit(1);
});
