import { Settings } from './core/Settings';
import { Game } from './Game';
import { LoadingScreen } from './ui/LoadingScreen';

async function boot() {
  const app = document.getElementById('app')!;
  const settings = new Settings();
  const params = new URLSearchParams(location.search);
  const loading = new LoadingScreen(document.body);
  const game = new Game(app, settings, { seed: Number(params.get('seed') ?? 1987), automation: params });
  (window as any).__game = game;
  try {
    await game.load(loading);
  } catch (e) {
    console.error(e);
    loading.set(1, `Failed: ${(e as Error).message}`);
    return;
  }
  game.start();
  loading.hide();
  // signal automation after a few frames have been presented
  let frames = 0;
  const target = Number(params.get('frames') ?? 12);
  const prev = game.engine.onAfterRender;
  game.engine.onAfterRender = () => {
    prev?.();
    if (++frames === target) (window as any).__ready = { backend: game.engine.backend, frame: game.engine.frame };
  };
}

boot();
