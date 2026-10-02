/**
 * Compatibility shims for WebGPU implementations that lag behind the spec revision
 * three.js targets. Some Chromium builds (≈ M141) expose `swizzle` on
 * GPUTextureViewDescriptor as a dictionary while three.js passes the newer string
 * form ('rgba'). The identity swizzle is the default anyway, so we drop it.
 */
export function installWebGPUCompat(): void {
  const g = globalThis as any;
  if (!g.GPUTexture || g.__waldeggCompat) return;
  g.__waldeggCompat = true;
  const proto = g.GPUTexture.prototype;
  const original = proto.createView;
  proto.createView = function (desc?: any) {
    if (desc && desc.swizzle === 'rgba') {
      const copy = { ...desc };
      delete copy.swizzle;
      return original.call(this, copy);
    }
    return original.call(this, desc);
  };
}
