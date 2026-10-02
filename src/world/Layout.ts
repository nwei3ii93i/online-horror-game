/**
 * Master plan of Gut Waldegg. Pure data shared by terrain, buildings, vegetation,
 * navigation and audio. Coordinates in metres: +X east, -Z north, +Y up.
 *
 * The estate sits on a shallow plateau in a spruce/beech forest. A neglected service
 * road climbs from the valley in the south, passes the caretaker's house and the gate,
 * and ends in the gravel courtyard in front of the manor.
 */

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Pad extends Rect {
  /** Target ground height (absolute). */
  y: number;
  /** Blend distance to surrounding terrain. */
  blend: number;
  /** Surface layer painted on the pad. */
  surface?: SurfaceLayer;
  /** Cut a hole in terrain render mesh + ignore terrain collision (basements, cellar stairs). */
  hole?: boolean;
}

export type SurfaceLayer = 'forest' | 'meadow' | 'mud' | 'gravel' | 'asphalt' | 'rock' | 'moss' | 'leaves';

export interface PathDef {
  id: string;
  points: [number, number][];
  width: number;
  surface: SurfaceLayer;
  /** Edge noise/softness in metres. */
  soft: number;
  /** How strongly the terrain is smoothed/flattened under the path (0..1). */
  flatten: number;
  /** Keep trees this far away from the centreline. */
  clearance: number;
}

export interface Clearing { x: number; z: number; r: number; surface: SurfaceLayer }

export const WORLD_HALF = 320;
export const GROUND_Y = 0;

/** Building footprints (outer wall lines). */
export const BUILDINGS = {
  manor: { x0: -13, z0: -29, x1: 13, z1: -15, floorY: 0.75, basementY: -2.05 },
  caretaker: { x0: 27, z0: 1, x1: 35, z1: 10, floorY: 0.45, cellarY: -2.0 },
  workshop: { x0: -33, z0: -4, x1: -22, z1: 4, floorY: 0.05 },
  barn: { x0: -55, z0: -49, x1: -31, z1: -36, floorY: 0.1 },
  greenhouse: { x0: 19, z0: -45, x1: 34, z1: -39, floorY: 0.1 },
  pumphouse: { x0: -30, z0: -53, x1: -25, z1: -48, floorY: 0.2, basementY: -2.05 },
  chapel: { x0: 48, z0: -112, x1: 54, z1: -104, floorY: 0.0 },
} as const;

export type BuildingId = keyof typeof BUILDINGS;

export const CEMETERY = { x0: 41, z0: -114, x1: 61, z1: -96 };
export const GARDEN = { x0: -20, z0: -66, x1: 20, z1: -31 };
export const COURTYARD = { x0: -18, z0: -14, x1: 20, z1: 9 };

/** Tunnel network below ground (centre lines, y = floor height). */
export const TUNNELS: { id: string; points: [number, number][]; width: number; height: number; y: number }[] = [
  // service tunnel: manor boiler cellar → pump house (heating pipes, water main)
  { id: 'service', points: [[-13, -24.5], [-27.5, -24.5], [-27.5, -48]], width: 1.7, height: 2.15, y: -2.05 },
  // side gallery to the old coal store / sealed room
  { id: 'coal', points: [[-27.5, -34], [-34, -34]], width: 1.5, height: 2.0, y: -2.05 },
];

export const PADS: Pad[] = [
  // buildings (slightly larger than footprint)
  { ...grow(BUILDINGS.manor, 1.0), y: 0.0, blend: 9, surface: 'gravel', hole: false },
  { ...grow(BUILDINGS.caretaker, 1.2), y: 0.05, blend: 7, surface: 'mud' },
  { ...grow(BUILDINGS.workshop, 1.5), y: -0.05, blend: 7, surface: 'gravel' },
  { ...grow(BUILDINGS.barn, 2.0), y: 0.0, blend: 10, surface: 'mud' },
  { ...grow(BUILDINGS.greenhouse, 1.0), y: 0.0, blend: 6, surface: 'meadow' },
  { ...grow(BUILDINGS.pumphouse, 1.0), y: 0.1, blend: 6, surface: 'mud' },
  { ...grow(BUILDINGS.chapel, 1.0), y: 6.2, blend: 6 },
  // open areas
  { ...COURTYARD, y: 0.0, blend: 10, surface: 'gravel' },
  { ...GARDEN, y: 0.0, blend: 12, surface: 'meadow' },
  { ...CEMETERY, y: 6.0, blend: 10, surface: 'meadow' },
  // yard between workshop and barn
  { x0: -60, z0: -36, x1: -22, z1: -8, y: 0.0, blend: 10, surface: 'mud' },
];

/** Terrain holes (render + collision) where stairs lead below ground. */
export const HOLES: Rect[] = [
  { x0: -13, z0: -29, x1: 13, z1: -15 },          // manor footprint (has full basement)
  { x0: -30, z0: -53, x1: -25, z1: -48 },         // pump house shaft
  { x0: 27, z0: 1, x1: 35, z1: 10 },              // caretaker (cellar + crawl space)
  { x0: 48, z0: -112, x1: 54, z1: -104 },         // chapel crypt
];

export const PATHS: PathDef[] = [
  {
    id: 'road', width: 4.2, surface: 'asphalt', soft: 1.2, flatten: 0.9, clearance: 5,
    points: [[46, 330], [40, 260], [24, 205], [36, 150], [48, 104], [42, 62], [30, 36], [20, 20], [10, 9], [4, 2]],
  },
  {
    id: 'courtyard_track', width: 3.2, surface: 'mud', soft: 1.0, flatten: 0.6, clearance: 3,
    points: [[-14, 0], [-22, -10], [-28, -22], [-36, -32]],
  },
  {
    id: 'garden_cemetery', width: 1.5, surface: 'leaves', soft: 0.8, flatten: 0.5, clearance: 2.2,
    points: [[0, -66], [6, -74], [18, -80], [30, -86], [40, -93], [47, -96]],
  },
  {
    id: 'barn_meadow', width: 1.4, surface: 'mud', soft: 0.8, flatten: 0.4, clearance: 2.0,
    points: [[-55, -44], [-66, -50], [-78, -58], [-88, -66]],
  },
  {
    id: 'caretaker_woodshed', width: 1.2, surface: 'mud', soft: 0.6, flatten: 0.4, clearance: 1.5,
    points: [[31, 0], [33, -8], [38, -16], [46, -30], [52, -48], [55, -70], [52, -95]],
  },
  {
    id: 'greenhouse_path', width: 1.3, surface: 'gravel', soft: 0.6, flatten: 0.5, clearance: 1.5,
    points: [[13, -36], [19, -40]],
  },
  {
    id: 'forest_loop', width: 1.1, surface: 'leaves', soft: 0.9, flatten: 0.3, clearance: 1.6,
    points: [[-88, -66], [-96, -90], [-80, -120], [-40, -130], [0, -122], [30, -118], [42, -110]],
  },
  {
    id: 'stream_path', width: 1.0, surface: 'leaves', soft: 0.9, flatten: 0.3, clearance: 1.5,
    points: [[35, 6], [60, 10], [85, 2], [110, -14]],
  },
];

export const CLEARINGS: Clearing[] = [
  { x: -88, z: -72, r: 26, surface: 'meadow' },   // old pasture with the hunting stand
  { x: 70, z: 30, r: 14, surface: 'meadow' },     // overgrown orchard remains
  { x: 108, z: -18, r: 10, surface: 'moss' },     // stream bend
];

/** Points of interest used by dressing, audio and the hunting stand. */
export const POI = {
  gate: { x: 24, z: 26 },
  huntingStand: { x: -70, z: -84, rot: 0.9 },
  well: { x: -9, z: 4 },
  transformer: { x: 40, z: 40 },
  woodshed: { x: 38, z: -4 },
  chickenCoop: { x: -60, z: -24 },
  playerSpawn: { x: 36, z: 60, rot: Math.PI * 0.95 },
  /** The group's van, pulled onto the shoulder of the service road below the gate. */
  van: { x: 32.2, z: 39.35, heading: -2.709 },
  /** Arrival point on the service road below the gate, looking up towards it. */
  arrival: { x: 31.4, z: 37.6, rot: 0.56 },
} as const;

export function grow(r: Rect, m: number): Rect {
  return { x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m };
}

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
}

/** Signed distance from point to rectangle (negative inside). */
export function rectDist(r: Rect, x: number, z: number): number {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0);
}

/** Distance to a polyline and the parameter (arc length) of the closest point. */
export function polylineDist(pts: [number, number][], x: number, z: number): { d: number; s: number; seg: number } {
  let best = Infinity, bestS = 0, bestSeg = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const len2 = vx * vx + vz * vz;
    const len = Math.sqrt(len2);
    let t = len2 > 0 ? ((x - ax) * vx + (z - az) * vz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + vx * t, pz = az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bestS = acc + t * len; bestSeg = i; }
    acc += len;
  }
  return { d: best, s: bestS, seg: bestSeg };
}

/** Catmull-Rom smoothing of a polyline (for roads and paths). */
export function smoothPolyline(pts: [number, number][], samplesPerSeg = 6): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
