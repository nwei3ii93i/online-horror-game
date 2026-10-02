// Visual tour: loads the game once, then flies the camera through a list of viewpoints and
// saves a screenshot at each. Usage:
//   node tools/tour.mjs tour.json outdir [--url=http://localhost:5173/?quality=high] [--size=1280x720] [--settle=2500]
// tour.json: [{ "name": "front", "cam": [x, y, z, yawDeg, pitchDeg] }, …]  (y = eye height, world space)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const shots = JSON.parse(readFileSync(args[0], 'utf8'));
const outDir = args[1] || 'tour';
const opt = Object.fromEntries(args.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const [w, h] = (opt.size || '1280x720').split('x').map(Number);
const settle = Number(opt.settle || 2500);
mkdirSync(outDir, { recursive: true });
const base = opt.url || 'http://localhost:5173/?quality=high';
const c0 = shots[0].cam.map((v) => v ?? 3).join(',');
const url = `${base}${base.includes('?') ? '&' : '?'}frames=8&cam=${c0}`;
const dir = process.env.SHOT_PROFILE || path.join(os.tmpdir(), 'waldegg-tour-profile');
const browser = await chromium.launchPersistentContext(dir, {
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  viewport: { width: w, height: h },
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = browser.pages()[0] || await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/THREE\.|404/.test(t)) console.log(`[${m.type()}] ${t.slice(0, 300)}`); } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready, null, { timeout: 900000, polling: 500 });
console.log('loaded in', (Date.now() - t0) / 1000, 's');
for (const s of shots) {
  // y = null → eye height above the terrain
  await page.evaluate((c) => { if (c[1] == null) c[1] = window.__game.terrain.heightAt(c[0], c[2]) + 1.7; window.__game.setCamera(...c); }, s.cam);
  if (s.eval) await page.evaluate(s.eval);
  await page.waitForTimeout(s.settle ?? settle);
  const info = await page.evaluate(() => { const i = window.__game.engine.renderer.info.render; return `${i.drawCalls} calls ${(i.triangles / 1e6).toFixed(2)}M tris`; });
  await page.screenshot({ path: path.join(outDir, `${s.name}.png`), timeout: 900000 });
  console.log(s.name, info);
}
await browser.close();
