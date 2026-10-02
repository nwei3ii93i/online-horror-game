// Renders procedural textures to PNG for visual inspection.
// Usage: npx tsx tools/texpreview.ts <outdir> [size] [ids...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { TEXTURE_DEFS, generateTexture } from '../src/materials/texgen/registry';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    // flip so v=0 is at the bottom of the image
    const sy = h - 1 - y;
    Buffer.from(rgb.buffer, rgb.byteOffset + sy * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

const out = process.argv[2] || 'texprev';
const size = Number(process.argv[3] || 512);
const ids = process.argv.slice(4);
mkdirSync(out, { recursive: true });
for (const def of TEXTURE_DEFS) {
  if (ids.length && !ids.includes(def.id)) continue;
  const t0 = performance.now();
  const tex = generateTexture(def.id, size);
  const ms = performance.now() - t0;
  const n = tex.size;
  // Panel: albedo | normal | roughness | ao | alpha, and a lit preview (simple N·L) tiled 2x2
  const W = n * 4, H = n * 2;
  const rgb = new Uint8Array(W * H * 3);
  const put = (x: number, y: number, r: number, g: number, b: number) => { const o = (y * W + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b; };
  const L = [0.45, 0.55, 0.7]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const A = tex.a, B = tex.b;
    // top row: lit preview 2x2 tiles at half res (occupies 2n x 2n?) -> keep simple: lit at (0..n), albedo (n..2n)
    const nx = B[i] / 127.5 - 1, ny = B[i + 1] / 127.5 - 1; const nzv = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const ndl = Math.max(0, nx * L[0] + ny * L[1] + nzv * L[2]);
    const ao = B[i + 3] / 255;
    const lit = (c: number) => Math.min(255, c * (0.15 + 0.95 * ndl) * ao);
    put(x, y + n, lit(A[i]), lit(A[i + 1]), lit(A[i + 2]));
    put(x + n, y + n, A[i], A[i + 1], A[i + 2]);
    put(x + 2 * n, y + n, B[i], B[i + 1], 255);
    put(x + 3 * n, y + n, A[i + 3], A[i + 3], A[i + 3]);
    put(x, y, B[i + 2], B[i + 2], B[i + 2]);
    put(x + n, y, B[i + 3], B[i + 3], B[i + 3]);
    // tiled lit 2x2 at half res
    const hx = (x * 2) % n, hy = (y * 2) % n; const j = (hy * n + hx) * 4;
    const nx2 = B[j] / 127.5 - 1, ny2 = B[j + 1] / 127.5 - 1; const nz2 = Math.sqrt(Math.max(0, 1 - nx2 * nx2 - ny2 * ny2));
    const ndl2 = Math.max(0, nx2 * L[0] + ny2 * L[1] + nz2 * L[2]); const ao2 = B[j + 3] / 255;
    put(x + 2 * n, y, Math.min(255, A[j] * (0.15 + 0.95 * ndl2) * ao2), Math.min(255, A[j + 1] * (0.15 + 0.95 * ndl2) * ao2), Math.min(255, A[j + 2] * (0.15 + 0.95 * ndl2) * ao2));
    const hx3 = (x * 4) % n, hy3 = (y * 4) % n; const k = (hy3 * n + hx3) * 4;
    put(x + 3 * n, y, A[k], A[k + 1], A[k + 2]);
  }
  writeFileSync(`${out}/${def.id}.png`, png(W, H, rgb));
  console.log(def.id.padEnd(22), `${ms.toFixed(0)} ms`);
}
