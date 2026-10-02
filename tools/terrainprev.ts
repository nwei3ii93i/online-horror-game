import { writeFileSync } from 'node:fs';
import { TerrainData, SPLAT_N, TERRAIN_N } from '../src/world/TerrainData';
import { png } from './texpreview-png';
const t0 = performance.now();
const t = new TerrainData();
console.log('terrain gen ms', (performance.now() - t0).toFixed(0));
const out = process.argv[2];
// height map preview with hillshade + splat colors
const N = SPLAT_N;
const rgb = new Uint8Array(N * N * 3);
const cols = [[60, 45, 30], [110, 120, 60], [90, 70, 45], [150, 145, 135], [40, 40, 40], [120, 120, 120], [50, 90, 40]];
let hmin = Infinity, hmax = -Infinity;
for (const h of t.heights) { hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
console.log('height range', hmin.toFixed(1), hmax.toFixed(1));
const nn = { x: 0, y: 0, z: 0 };
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -320 + (i + 0.5) / N * 640, z = -320 + (j + 0.5) / N * 640;
  t.normalAt(x, z, nn);
  const shade = Math.max(0.2, nn.x * -0.5 + nn.y * 0.7 + nn.z * -0.5);
  const o = (j * N + i) * 4;
  const w = [t.splat0[o], t.splat0[o + 1], t.splat0[o + 2], t.splat0[o + 3], t.splat1[o], t.splat1[o + 1], t.splat1[o + 2]];
  let r = 0, g = 0, b = 0;
  for (let k = 0; k < 7; k++) { r += cols[k][0] * w[k] / 255; g += cols[k][1] * w[k] / 255; b += cols[k][2] * w[k] / 255; }
  const op = t.openAt(x, z);
  const q = ((N - 1 - j) * N + i) * 3; // flip so north (-z) is up -> rows: j small = north -> top. png() flips again
  const p = (j * N + i) * 3;
  rgb[p] = Math.min(255, r * shade * (0.7 + op * 0.3)); rgb[p + 1] = Math.min(255, g * shade); rgb[p + 2] = Math.min(255, b * shade);
  void q;
}
writeFileSync(out, png(N, N, rgb));
