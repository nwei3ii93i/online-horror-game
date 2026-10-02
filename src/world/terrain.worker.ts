/// <reference lib="webworker" />
import { TerrainData } from './TerrainData';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  const t = new TerrainData(e.data.seed);
  const a = t.toArrays();
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(a, [a.heights.buffer, a.open.buffer, a.pathDist.buffer, a.pathClear.buffer, a.splat0.buffer, a.splat1.buffer]);
};
