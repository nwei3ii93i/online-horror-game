/**
 * Snapshot interpolation for remote players.
 *
 * Each remote player has a time-ordered buffer of pose samples stamped with the
 * sender's sample time in host clock. The renderer samples the buffer at
 * `renderTime = hostNow − interpolationDelay` (≈100 ms in the past), which is almost
 * always bracketed by two received samples → smooth motion despite network jitter.
 *
 *  - Between samples: linear position, shortest-arc yaw, linear pitch / velocity;
 *    discrete fields (stance, light) switch at the nearer sample.
 *  - Teleports (implausible jump between two samples) are not interpolated: the old
 *    pose holds until the new sample's time, then snaps.
 *  - Past the newest sample: extrapolate along the last velocity for at most
 *    {@link MAX_EXTRAPOLATION_MS}, then hold.
 *
 * Pure TypeScript, no DOM / three.js.
 */

import type { PlayerSnapshot, Stance, Vec3 } from './protocol';

/** Longest time (ms) the pose is extrapolated past the newest sample. */
export const MAX_EXTRAPOLATION_MS = 200;
/** Jumps longer than this (m) and faster than {@link TELEPORT_SPEED} are treated as teleports. */
export const TELEPORT_DISTANCE = 3;
export const TELEPORT_SPEED = 20;
/** Samples older than this relative to the newest one are discarded (ms). */
const KEEP_MS = 3000;
const MAX_SAMPLES = 90;

/** Interpolated pose of a remote player (reusable output object). */
export interface RemoteSample {
  /** Feet position. */
  p: Vec3;
  yaw: number;
  pitch: number;
  stance: Stance;
  light: boolean;
  vel: Vec3;
  /** Host time of the pose. */
  t: number;
  /** Render time lies past the newest sample (pose is predicted / held). */
  extrapolated: boolean;
  /** ms between render time and the newest sample (positive = waiting for data). */
  starvation: number;
}

export function createRemoteSample(): RemoteSample {
  return { p: [0, 0, 0], yaw: 0, pitch: 0, stance: 'stand', light: false, vel: [0, 0, 0], t: 0, extrapolated: false, starvation: 0 };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function copyInto(out: RemoteSample, s: PlayerSnapshot): RemoteSample {
  out.p[0] = s.p[0]; out.p[1] = s.p[1]; out.p[2] = s.p[2];
  out.vel[0] = s.vel[0]; out.vel[1] = s.vel[1]; out.vel[2] = s.vel[2];
  out.yaw = s.yaw;
  out.pitch = s.pitch;
  out.stance = s.stance;
  out.light = s.light;
  out.t = s.t;
  out.extrapolated = false;
  out.starvation = 0;
  return out;
}

export function isTeleport(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
  const d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
  if (d <= TELEPORT_DISTANCE) return false;
  const dt = Math.max(1e-3, (b.t - a.t) / 1000);
  return d / dt > TELEPORT_SPEED;
}

export class SnapshotBuffer {
  readonly samples: PlayerSnapshot[] = [];

  get latest(): PlayerSnapshot | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Adds a sample; out-of-order / duplicate samples are ignored. Returns true if added. */
  push(s: PlayerSnapshot): boolean {
    const last = this.latest;
    if (last && s.t <= last.t) return false;
    this.samples.push(s);
    const cutoff = s.t - KEEP_MS;
    let drop = 0;
    while (drop < this.samples.length - 2 && (this.samples[drop + 1].t < cutoff || this.samples.length - drop > MAX_SAMPLES)) drop++;
    if (drop) this.samples.splice(0, drop);
    return true;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Pose at `renderTime` (host clock, ms), or null when no sample has arrived yet. */
  sample(renderTime: number, out: RemoteSample = createRemoteSample()): RemoteSample | null {
    const s = this.samples;
    const n = s.length;
    if (n === 0) return null;
    if (renderTime <= s[0].t) return copyInto(out, s[0]);
    const last = s[n - 1];
    if (renderTime >= last.t) {
      copyInto(out, last);
      const ahead = renderTime - last.t;
      out.starvation = ahead;
      out.extrapolated = ahead > 0;
      const k = Math.min(ahead, MAX_EXTRAPOLATION_MS) / 1000;
      out.p[0] += last.vel[0] * k;
      out.p[1] += last.vel[1] * k;
      out.p[2] += last.vel[2] * k;
      out.t = last.t + k * 1000;
      return out;
    }
    // binary search for the bracketing pair s[i].t <= renderTime < s[i+1].t
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= renderTime) lo = mid;
      else hi = mid;
    }
    const a = s[lo], b = s[hi];
    if (isTeleport(a, b)) return copyInto(out, a);
    const k = (renderTime - a.t) / (b.t - a.t);
    out.p[0] = lerp(a.p[0], b.p[0], k);
    out.p[1] = lerp(a.p[1], b.p[1], k);
    out.p[2] = lerp(a.p[2], b.p[2], k);
    out.vel[0] = lerp(a.vel[0], b.vel[0], k);
    out.vel[1] = lerp(a.vel[1], b.vel[1], k);
    out.vel[2] = lerp(a.vel[2], b.vel[2], k);
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    out.pitch = lerp(a.pitch, b.pitch, k);
    const near = k < 0.5 ? a : b;
    out.stance = near.stance;
    out.light = near.light;
    out.t = renderTime;
    out.extrapolated = false;
    out.starvation = 0;
    return out;
  }
}
