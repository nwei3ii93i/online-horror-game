/// <reference lib="webworker" />
import { generateTexture } from './registry';

self.onmessage = (e: MessageEvent<{ jobId: number; id: string; size: number }>) => {
  const { jobId, id, size } = e.data;
  try {
    const t = generateTexture(id, size);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { jobId, id, size: t.size, a: t.a, b: t.b, alphaMode: t.alphaMode },
      [t.a.buffer, t.b.buffer],
    );
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ jobId, id, error: String(err) });
  }
};
