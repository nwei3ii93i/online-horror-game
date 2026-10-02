// Headless screenshot harness. Usage: node tools/shot.mjs <url> <out.png> [--webgl] [--wait=ms] [--size=1280x720] [--eval=js]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || 'shot.png';
const opt = Object.fromEntries(args.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const [w, h] = (opt.size || '1280x720').split('x').map(Number);
import os from 'node:os';
import path from 'node:path';
const userDataDir = process.env.SHOT_PROFILE || path.join(os.tmpdir(), 'waldegg-shot-profile');
const launchOpts = {
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  viewport: { width: w, height: h },
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
};
let browser;
try { browser = await chromium.launchPersistentContext(userDataDir, launchOpts); }
catch (e) {
  const { mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'waldegg-prof-'));
  console.log('profile busy, using temp profile', dir);
  browser = await chromium.launchPersistentContext(dir, launchOpts);
}
const page = browser.pages()[0] || await browser.newPage();
const logs = [];
page.on('console', m => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (opt.verbose || ((m.type() === "error" || m.type() === "warning") && logs.length < 40)) console.log(t.slice(0, 600)); });
let perr = 0; page.on("pageerror", e => { if (perr++ < 5) console.log("[pageerror]", e.message, e.stack?.slice(0, 800)); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
const timeout = Number(opt.timeout || 600000);
try {
  await page.waitForFunction(() => window.__ready, null, { timeout, polling: 500 });
} catch (e) { console.log('timeout waiting for __ready'); }
if (opt.evalfile) { const { readFileSync } = await import('node:fs'); opt.eval = readFileSync(opt.evalfile, 'utf8'); }
if (opt.eval) { await page.evaluate(opt.eval); }
if (opt.wait) await page.waitForTimeout(Number(opt.wait));
const ready = await page.evaluate(() => window.__ready);
console.log('ready', JSON.stringify(ready), 'elapsed', (Date.now() - t0) / 1000, 's');
await page.screenshot({ path: out, timeout: 900000 });
await browser.close();
