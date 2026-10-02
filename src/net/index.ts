/**
 * Networking / session layer. See INTEGRATION.md in this folder.
 *
 * Browser entry point (includes the three.js RemotePlayers view). Node code (the relay)
 * must import the DOM-free modules directly: protocol, WorldState, reducers, HostCore.
 */

export * from './protocol';
export { WorldState, type ApplyResult, type WorldListener } from './WorldState';
export {
  ReducerRegistry, defaultRegistry, registerReducer, registerDefaultReducers,
  doorReducer, itemReducer, lightReducer, noteReducer, switchReducer, DEFAULT_DOOR_ANGLE,
  type Reducer, type ReducerContext,
} from './reducers';
export { HostCore, PLAYER_COLORS, type HostConnection, type HostLink, type HostCoreOptions, type HostLogger, type HostStats } from './HostCore';
export { HandlerSet, type Transport, type TransportCloseEvent } from './Transport';
export { LocalTransport, type LocalTransportOptions } from './LocalTransport';
export { WebSocketTransport, type WebSocketTransportOptions } from './WebSocketTransport';
export { SnapshotBuffer, createRemoteSample, isTeleport, MAX_EXTRAPOLATION_MS, type RemoteSample } from './Interpolation';
export { Emitter } from './Emitter';
export {
  Session, RemotePlayerState,
  type SessionMode, type SessionOptions, type ConnectOptions, type SessionEvents, type EntityEvent, type LocalPlayerState, type Vec3Like,
} from './Session';
export { RemotePlayers, type RemotePlayersOptions, type RemoteFlashlightParams } from './RemotePlayers';
