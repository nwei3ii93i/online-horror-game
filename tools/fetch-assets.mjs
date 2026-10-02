#!/usr/bin/env node
/**
 * Downloads CC0 photoscanned assets from Poly Haven (https://polyhaven.com, licence CC0)
 * and converts them for the web:
 *   textures → public/assets/textures/<id>/{diff,nor,arm,disp}.webp
 *   models   → public/assets/models/<id>.glb  (textures resized + WebP, meshes welded)
 * and writes public/assets/manifest.json.
 *
 * Models above `maxTris` (config, default 40k) are simplified with meshoptimizer.
 *
 * Usage: node tools/fetch-assets.mjs [--only=id1,id2] [--force] [--resimplify]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'assets');
const cfg = JSON.parse(readFileSync(join(root, 'tools', 'assets.config.json'), 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const only = args.only ? new Set(String(args.only).split(',')) : null;
const manifestPath = join(out, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { source: 'https://polyhaven.com (CC0)', textures: {}, models: {} };

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}
const json = async (url) => JSON.parse((await get(url)).toString('utf8'));

async function fetchTexture(t) {
  const dir = join(out, 'textures', t.id);
  if (!args.force && existsSync(join(dir, 'diff.webp'))) return;
  mkdirSync(dir, { recursive: true });
  const files = await json(`https://api.polyhaven.com/files/${t.id}`);
  const info = await json(`https://api.polyhaven.com/info/${t.id}`);
  const res = t.res ?? '1k';
  const size = t.size ?? (res === '2k' ? 2048 : 1024);
  const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm, disp: t.disp ? files.Displacement : null };
  for (const [name, entry] of Object.entries(maps)) {
    if (!entry) continue;
    const url = entry[res]?.jpg?.url ?? entry[res]?.png?.url;
    if (!url) { console.warn(`  ! ${t.id}: no ${name} at ${res}`); continue; }
    const buf = await get(url);
    const q = name === 'nor' ? 90 : name === 'diff' ? 86 : 82;
    await sharp(buf).resize(size, size, { fit: 'fill' }).webp({ quality: q, effort: 5 }).toFile(join(dir, `${name}.webp`));
  }
  const dims = info.dimensions ? info.dimensions.map((d) => d / 1000) : [2, 2];
  manifest.textures[t.id] = { size: dims, res: size, disp: !!t.disp, name: info.name, authors: Object.keys(info.authors ?? {}) };
  console.log(`  ✓ texture ${t.id} (${dims.join('×')} m)`);
}

const MAX_TRIS = cfg.maxTris ?? 40000;
function simplifyStep(m, polycount) {
  const max = m.maxTris ?? MAX_TRIS;
  if (!polycount || polycount <= max) return [];
  return [simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.03, max / polycount), error: m.simplifyError ?? 0.004, lockBorder: false })];
}

/** Re-run simplification on an already downloaded model (in place). */
async function resimplify(m) {
  const file = join(out, 'models', `${m.id}.glb`);
  const info = manifest.models[m.id];
  if (!existsSync(file) || !info || !info.polycount || info.polycount <= (m.maxTris ?? MAX_TRIS) || info.simplified) return;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  await doc.transform(weld(), ...simplifyStep(m, info.polycount), prune());
  await io.write(file, doc);
  info.simplified = Math.min(info.polycount, m.maxTris ?? MAX_TRIS);
  console.log(`  ✓ simplified ${m.id} ${info.polycount} → ~${info.simplified}`);
}

async function fetchModel(m) {
  const file = join(out, 'models', `${m.id}.glb`);
  if (args.resimplify) return resimplify(m);
  if (!args.force && existsSync(file)) return;
  mkdirSync(join(out, 'models'), { recursive: true });
  const files = await json(`https://api.polyhaven.com/files/${m.id}`);
  const info = await json(`https://api.polyhaven.com/info/${m.id}`);
  const res = m.res ?? '1k';
  const g = files.gltf?.[res]?.gltf;
  if (!g) { console.warn(`  ! model ${m.id}: no gltf ${res}`); return; }
  const tmp = join(root, 'node_modules', '.cache', 'ph', m.id);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const gltfName = g.url.split('/').pop();
  writeFileSync(join(tmp, gltfName), await get(g.url));
  for (const [rel, f] of Object.entries(g.include ?? {})) {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), await get(f.url));
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(tmp, gltfName));
  const texSize = m.tex ?? 1024;
  await MeshoptSimplifier.ready;
  await doc.transform(
    dedup(), prune(), weld(),
    ...simplifyStep(m, info.polycount),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 84 }),
  );
  doc.createExtension(EXTTextureWebP).setRequired(true);
  await io.write(file, doc);
  const simplified = info.polycount && info.polycount > (m.maxTris ?? MAX_TRIS) ? (m.maxTris ?? MAX_TRIS) : undefined;
  manifest.models[m.id] = { name: info.name, polycount: info.polycount ?? null, simplified, dimensions: info.dimensions ? info.dimensions.map((d) => d / 1000) : null, authors: Object.keys(info.authors ?? {}) };
  rmSync(tmp, { recursive: true, force: true });
  console.log(`  ✓ model ${m.id} (${info.polycount ?? '?'} tris)`);
}

const tasks = [
  ...cfg.textures.filter((t) => !only || only.has(t.id)).map((t) => () => fetchTexture(t)),
  ...cfg.models.filter((m) => !only || only.has(m.id)).map((m) => () => fetchModel(m)),
];
const conc = 4;
let next = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (next < tasks.length) {
    const t = tasks[next++];
    try { await t(); } catch (e) { console.error('  ✗', e.message); }
  }
}));
mkdirSync(out, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`manifest: ${Object.keys(manifest.textures).length} textures, ${Object.keys(manifest.models).length} models`);
