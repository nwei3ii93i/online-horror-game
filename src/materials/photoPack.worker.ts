/// <reference lib="webworker" />
/**
 * Packs a photoscanned CC0 texture set (diff/nor/arm[/disp] WebP files written by
 * tools/fetch-assets.mjs) into the engine's two-texture PBR layout:
 *   A = albedo.rgb (sRGB) + alpha (height | metalness)
 *   B = normal.xy, roughness, ao
 * so photo sets are drop-in replacements for the procedural ones.
 */
interface Job {
  jobId: number;
  base: string;
  size: number;
  disp: boolean;
  alphaMode: 'height' | 'metal';
  tint: [number, number, number];
}

async function load(url: string, size: number): Promise<Uint8ClampedArray> {
  const blob = await (await fetch(url)).blob();
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  g.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { jobId, base, size, disp, alphaMode, tint } = e.data;
  try {
    const [D, N, R, H] = await Promise.all([
      load(`${base}diff.webp`, size),
      load(`${base}nor.webp`, size),
      load(`${base}arm.webp`, size),
      disp ? load(`${base}disp.webp`, size) : Promise.resolve(null),
    ]);
    const n = size * size;
    const A = new Uint8Array(n * 4), B = new Uint8Array(n * 4);
    const [tr, tg, tb] = tint;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const r = D[o], g = D[o + 1], b = D[o + 2];
      A[o] = Math.min(255, r * tr); A[o + 1] = Math.min(255, g * tg); A[o + 2] = Math.min(255, b * tb);
      // without a displacement map, luminance is a usable stand-in for puddles / blending
      A[o + 3] = alphaMode === 'metal' ? R[o + 2] : H ? H[o] : (r * 0.3 + g * 0.55 + b * 0.15);
      B[o] = N[o]; B[o + 1] = N[o + 1]; B[o + 2] = R[o + 1]; B[o + 3] = R[o];
    }
    (self as unknown as Worker).postMessage({ jobId, size, a: A, b: B, alphaMode }, [A.buffer, B.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ jobId, error: String(err) });
  }
};
