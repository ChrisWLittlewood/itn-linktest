// Test helper: renders a QR module matrix into a synthetic camera-like gray image (rotation, perspective, noise, blur, glare, moire...).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../lt-qrscan.js');

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* o: {scale, rot (deg), persp (fraction of side, corner jitter), noise (+-levels), blur (3x3 passes), invert, lo, hi (contrast range), glare (0..255 amplitude), moire (amplitude), seed, bg} */
export function render(qr, o = {}) {
  const rand = rng(o.seed || 1), scale = o.scale || 5, n = qr.size + 8, side = n * scale, margin = 25;
  const W = Math.ceil(side * 1.45) + margin * 2, H = W;
  const th = (o.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), pj = (o.persp || 0) * side;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = sx * side / 2 + (rand() - 0.5) * 2 * pj, y = sy * side / 2 + (rand() - 0.5) * 2 * pj;
    return [W / 2 + x * cs - y * sn, H / 2 + x * sn + y * cs];
  });
  const toModule = S.homography(corners, [[0, 0], [n, 0], [n, n], [0, n]]);
  const lo = o.lo === undefined ? 0 : o.lo, hi = o.hi === undefined ? 255 : o.hi;
  const g = new Float32Array(W * H);
  const dark = 25, light = 235, bg = o.bg === undefined ? 110 : o.bg;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const [u, v] = toModule(x + ox, y + oy);
      let val = bg;
      if (u >= 0 && v >= 0 && u < n && v < n) {
        const mx = Math.floor(u) - 4, my = Math.floor(v) - 4;
        val = (mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my][mx]) ? dark : light;
      }
      acc += val;
    }
    g[y * W + x] = acc / 4;
  }
  let cur = g;
  for (let p = 0; p < (o.blur || 0); p++) {
    const nx = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += cur[(y + dy) * W + x + dx]; nx[y * W + x] = s / 9; }
    cur = nx;
  }
  const gx = W * (0.3 + rand() * 0.4), gy = H * (0.3 + rand() * 0.4), sig = W * 0.12, f = 0.9 + rand();
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = lo + (cur[y * W + x] / 255) * (hi - lo);
    if (o.glare) v += o.glare * Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / (2 * sig * sig));
    if (o.moire) v += o.moire * Math.sin(x * f) * Math.sin(y * f * 1.1);
    if (o.noise) v += (rand() - 0.5) * 2 * o.noise;
    if (o.invert) v = 255 - v;
    out[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { gray: out, w: W, h: H };
}
