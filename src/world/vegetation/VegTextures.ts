import * as THREE from 'three/webgpu';
import { RNG } from '../../core/Random';

/**
 * Alpha-tested foliage cards painted with Canvas2D at load time: spruce branchlets,
 * dead lower spruce twigs, bare deciduous twig sprays (with a few marcescent beech
 * leaves), dead bracken, dry grass tufts and bramble leaves. All late-November.
 */
export interface VegTextureSet {
  spruce: THREE.Texture;
  spruceDead: THREE.Texture;
  twigs: THREE.Texture;
  beechLeaves: THREE.Texture;
  fern: THREE.Texture;
  grass: THREE.Texture;
  bramble: THREE.Texture;
  ivy: THREE.Texture;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  return [c, g];
}

function toTexture(c: HTMLCanvasElement, name: string): THREE.Texture {
  // Bleed colour into transparent texels so mip-mapping doesn't produce dark halos.
  const g = c.getContext('2d')!;
  const img = g.getImageData(0, 0, c.width, c.height);
  dilate(img);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.name = name;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Push RGB of opaque texels into neighbouring transparent ones (alpha untouched). */
function dilate(img: ImageData, passes = 6): void {
  const { width: w, height: h, data } = img;
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!filled[j]) continue;
        r += data[j * 4]; gg += data[j * 4 + 1]; b += data[j * 4 + 2]; n++;
      }
      if (n) { data[i * 4] = r / n; data[i * 4 + 1] = gg / n; data[i * 4 + 2] = b / n; next[i] = 1; }
    }
    filled.set(next);
  }
}

const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Spruce branchlet seen from above: main axis along +u, drooping side shoots densely needled. */
function drawSpruce(dead: boolean): HTMLCanvasElement {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const rng = new RNG(dead ? 'spruce-dead' : 'spruce');
  g.lineCap = 'round';
  const stem = (x0: number, y0: number, len: number, ang: number, width: number, depth: number) => {
    const segs = 8;
    let x = x0, y = y0, a = ang;
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < segs; i++) {
      a += (rng.float() - 0.5) * 0.12 + (dead ? 0.02 : 0.015);
      x += Math.cos(a) * len / segs; y += Math.sin(a) * len / segs;
      pts.push([x, y]);
    }
    g.strokeStyle = dead ? rgb(92, 86, 78) : rgb(58, 42, 30);
    g.lineWidth = width;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) g.lineTo(p[0], p[1]);
    g.stroke();
    return pts;
  };
  const needles = (pts: [number, number][], density: number, nlen: number) => {
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const sa = Math.atan2(by - ay, bx - ax);
      const n = density;
      for (let i = 0; i < n; i++) {
        const t = rng.float();
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        const side = rng.sign();
        const a = sa + side * (0.7 + rng.float() * 0.6);
        const L = nlen * (0.7 + rng.float() * 0.5) * (1 - k / pts.length * 0.35);
        const shade = 0.6 + rng.float() * 0.5;
        const tip = rng.float() < 0.15;
        g.strokeStyle = tip ? rgb(62 * shade, 84 * shade, 50 * shade) : rgb(30 * shade, 48 * shade, 30 * shade);
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
      }
    }
  };
  const main = stem(4, H / 2, W - 30, 0, dead ? 5 : 6, 0);
  if (!dead) needles(main, 60, 14);
  // side shoots
  for (let i = 1; i < main.length - 1; i++) {
    for (const side of [-1, 1]) {
      if (rng.float() < 0.15) continue;
      const [x, y] = main[i];
      const len = (W - x) * (0.35 + rng.float() * 0.3) * (dead ? 0.8 : 1);
      const a = side * (0.55 + rng.float() * 0.35);
      const sp = stem(x, y, Math.min(len, H * 0.55), a, dead ? 2.5 : 3, 1);
      if (!dead) needles(sp, 34, 11);
      // tertiary
      for (let j = 2; j < sp.length - 1; j += 2) {
        const [tx, ty] = sp[j];
        const tl = len * 0.35 * (0.6 + rng.float() * 0.4);
        const ta = a + side * (0.5 + rng.float() * 0.4) * (rng.float() < 0.5 ? 1 : -1);
        const tp = stem(tx, ty, tl, ta, dead ? 1.4 : 1.8, 2);
        if (!dead) needles(tp, 18, 9);
        else if (rng.float() < 0.25) {
          // lichen tufts on dead twigs
          g.fillStyle = rgb(140, 148, 120, 0.85);
          g.beginPath(); g.arc(tp[3][0], tp[3][1], 2 + rng.float() * 3, 0, Math.PI * 2); g.fill();
        }
      }
    }
  }
  return c;
}

/** Fine bare twig spray (beech/birch/oak crowns in winter), sympodial zig-zag growth. */
function drawTwigs(withLeaves: boolean): HTMLCanvasElement {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const rng = new RNG(withLeaves ? 'beech-leaves' : 'twigs');
  g.lineCap = 'round';
  const leaves: [number, number, number][] = [];
  const grow = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    if (depth > 6 || len < 6) {
      if (withLeaves && rng.float() < 0.55) leaves.push([x, y, a]);
      return;
    }
    const segs = 3;
    let px = x, py = y, pa = a;
    g.strokeStyle = rgb(48 + depth * 6, 42 + depth * 5, 38 + depth * 4);
    g.lineWidth = w;
    g.beginPath(); g.moveTo(px, py);
    for (let i = 0; i < segs; i++) {
      pa += (i % 2 ? 1 : -1) * (0.12 + rng.float() * 0.15); // zig-zag
      px += Math.cos(pa) * len / segs; py += Math.sin(pa) * len / segs;
      g.lineTo(px, py);
    }
    g.stroke();
    const n = depth < 2 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const spread = (rng.float() - 0.5) * 1.3;
      grow(px, py, pa + spread, len * (0.62 + rng.float() * 0.15), Math.max(0.7, w * 0.68), depth + 1);
    }
  };
  // twigs grow from the bottom-centre upward/outward
  for (let i = 0; i < 3; i++) grow(W / 2 + (i - 1) * 20, H - 4, -Math.PI / 2 + (i - 1) * 0.5, 120, 5, 0);
  if (withLeaves) {
    for (const [x, y, a] of leaves) {
      const L = 16 + rng.float() * 10, Wd = L * 0.55;
      const hue = rng.float();
      const col = hue < 0.6 ? [150, 92, 46] : hue < 0.85 ? [120, 74, 40] : [170, 120, 66];
      const sh = 0.7 + rng.float() * 0.45;
      g.save();
      g.translate(x, y); g.rotate(a + (rng.float() - 0.5) * 1.2);
      g.fillStyle = rgb(col[0] * sh, col[1] * sh, col[2] * sh);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(L * 0.3, -Wd, L * 0.8, -Wd * 0.6, L, 0);
      g.bezierCurveTo(L * 0.8, Wd * 0.6, L * 0.3, Wd, 0, 0);
      g.fill();
      // curled dry leaf: darker midrib & edge
      g.strokeStyle = rgb(col[0] * sh * 0.6, col[1] * sh * 0.6, col[2] * sh * 0.6);
      g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.95, 0); g.stroke();
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(L * k / 6, 0); g.lineTo(L * (k / 6 + 0.08), -Wd * 0.6); g.stroke(); g.beginPath(); g.moveTo(L * k / 6, 0); g.lineTo(L * (k / 6 + 0.08), Wd * 0.6); g.stroke(); }
      g.restore();
    }
  }
  return c;
}

/** Dead bracken frond (rust-brown), rachis along v. */
function drawFern(): HTMLCanvasElement {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  const rng = new RNG('fern');
  g.lineCap = 'round';
  const cx = W / 2;
  g.strokeStyle = rgb(92, 60, 34); g.lineWidth = 4;
  g.beginPath(); g.moveTo(cx, H); g.quadraticCurveTo(cx + 8, H * 0.5, cx - 4, 8); g.stroke();
  const n = 22;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = H - t * (H - 12);
    const x = cx + Math.sin(t * 2) * 6;
    const len = (1 - t) * 0.9 * (W / 2 - 8) * (0.8 + Math.sin(t * 3.1) * 0.25) + 10;
    for (const side of [-1, 1]) {
      const a = side > 0 ? -0.35 : Math.PI + 0.35;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len * 0.6;
      g.strokeStyle = rgb(110, 70, 38); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      // pinnules
      const m = Math.max(3, Math.round(len / 7));
      for (let k = 0; k < m; k++) {
        const u = k / m;
        const px = x + (ex - x) * u, py = y + (ey - y) * u;
        const pl = (1 - u) * 9 + 3;
        const sh = 0.65 + rng.float() * 0.5;
        g.fillStyle = rgb(150 * sh, 88 * sh, 42 * sh);
        g.beginPath(); g.ellipse(px, py - 2, pl * 0.45, pl, 0.3 * side, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(px, py + 3, pl * 0.4, pl * 0.8, -0.3 * side, 0, Math.PI * 2); g.fill();
      }
    }
  }
  return c;
}

/** Tuft of dry autumn grass, blades rising from the bottom edge. */
function drawGrass(): HTMLCanvasElement {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const rng = new RNG('grass');
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x0 = W * 0.1 + rng.float() * W * 0.8;
    const h = H * (0.35 + rng.float() * 0.62);
    const lean = (rng.float() - 0.5) * 120 + (x0 - W / 2) * 0.35;
    const dry = rng.float();
    const col = dry < 0.45 ? [150, 138, 92] : dry < 0.8 ? [118, 112, 70] : [74, 86, 46];
    const sh = 0.6 + rng.float() * 0.5;
    g.strokeStyle = rgb(col[0] * sh, col[1] * sh, col[2] * sh);
    g.lineWidth = 1.5 + rng.float() * 2;
    g.beginPath(); g.moveTo(x0, H);
    g.quadraticCurveTo(x0 + lean * 0.3, H - h * 0.6, x0 + lean, H - h);
    g.stroke();
    if (rng.float() < 0.08) {
      // seed heads
      g.fillStyle = rgb(140 * sh, 120 * sh, 84 * sh);
      g.beginPath(); g.ellipse(x0 + lean, H - h, 3, 10, lean * 0.004, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

/** Bramble leaves (keep their dark leaves into winter, purple-tinged). */
function drawBramble(): HTMLCanvasElement {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const rng = new RNG('bramble');
  g.lineCap = 'round';
  // arching canes
  for (let i = 0; i < 7; i++) {
    g.strokeStyle = rgb(80, 42, 46); g.lineWidth = 4;
    const x0 = 40 + rng.float() * 430;
    g.beginPath(); g.moveTo(x0, H); g.quadraticCurveTo(x0 + (rng.float() - 0.5) * 300, 40 + rng.float() * 200, x0 + (rng.float() - 0.5) * 400, H * 0.4 + rng.float() * 200); g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = 30 + rng.float() * (W - 60), y = 30 + rng.float() * (H - 60);
    const a = rng.float() * Math.PI * 2;
    const sh = 0.55 + rng.float() * 0.5;
    const red = rng.float() < 0.3;
    for (let k = 0; k < 3; k++) {
      g.save(); g.translate(x, y); g.rotate(a + (k - 1) * 0.9);
      g.fillStyle = red ? rgb(96 * sh, 46 * sh, 48 * sh) : rgb(40 * sh, 56 * sh, 34 * sh);
      g.beginPath(); g.ellipse(18, 0, 18, 11, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(20, 28, 18, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(2, 0); g.lineTo(34, 0); g.stroke();
      g.restore();
    }
  }
  return c;
}

/** Ivy (Hedera) leaves for façades and trunks. */
function drawIvy(): HTMLCanvasElement {
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const rng = new RNG('ivy');
  g.strokeStyle = rgb(70, 54, 40); g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.beginPath(); let x = rng.float() * W, y = H;
    g.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (rng.float() - 0.5) * 70; y -= H / 12; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 180; i++) {
    const x = rng.float() * W, y = rng.float() * H, s = 10 + rng.float() * 12;
    const sh = 0.5 + rng.float() * 0.6;
    g.save(); g.translate(x, y); g.rotate((rng.float() - 0.5) * 1.4);
    g.fillStyle = rgb(30 * sh, 48 * sh, 26 * sh);
    g.beginPath();
    g.moveTo(0, -s); g.lineTo(s * 0.45, -s * 0.35); g.lineTo(s * 0.95, -s * 0.2); g.lineTo(s * 0.5, s * 0.3); g.lineTo(0, s * 0.6);
    g.lineTo(-s * 0.5, s * 0.3); g.lineTo(-s * 0.95, -s * 0.2); g.lineTo(-s * 0.45, -s * 0.35); g.closePath(); g.fill();
    g.strokeStyle = rgb(120 * sh, 130 * sh, 100 * sh, 0.5); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -s * 0.8); g.lineTo(0, s * 0.5); g.stroke();
    g.restore();
  }
  return c;
}

export function createVegTextures(): VegTextureSet {
  return {
    spruce: toTexture(drawSpruce(false), 'veg_spruce'),
    spruceDead: toTexture(drawSpruce(true), 'veg_spruce_dead'),
    twigs: toTexture(drawTwigs(false), 'veg_twigs'),
    beechLeaves: toTexture(drawTwigs(true), 'veg_beech_leaves'),
    fern: toTexture(drawFern(), 'veg_fern'),
    grass: toTexture(drawGrass(), 'veg_grass'),
    bramble: toTexture(drawBramble(), 'veg_bramble'),
    ivy: toTexture(drawIvy(), 'veg_ivy'),
  };
}
