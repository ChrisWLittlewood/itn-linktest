import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { render } from './qrimage.mjs';
const require = createRequire(import.meta.url);
const Q = require('../lt-qr.js');
const S = require('../lt-qrscan.js');
const K = require('../lt-code.js');

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';
function sdp(setup, cands) {
  return ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:xKqP', 'a=ice-pwd:7Zs0aB3dEfGhIjKlMnOpQrSt',
    'a=fingerprint:sha-256 ' + FP, 'a=setup:' + setup, 'a=mid:0', 'a=sctp-port:5000', ...cands].join('\r\n') + '\r\n';
}
const m = (i, p) => `a=candidate:${i} 1 udp 2113937151 ${['3f2a9b1c-1111-4222-8333-444455556666', '0a1b2c3d-aaaa-4bbb-8ccc-ddddeeeeffff'][i - 1]}.local ${p} typ host`;
const v4 = (i, ip, p) => `a=candidate:${i} 1 udp 2122260223 ${ip} ${p} typ host`;
const CODES = {
  answer144: K.sdpToCode('a', sdp('active', [v4(1, '192.168.42.129', 49152)])),
  answer171: K.sdpToCode('a', sdp('active', [v4(1, '192.168.42.129', 49152), v4(2, '10.20.30.40', 50000)])),
  offer204: K.sdpToCode('o', sdp('actpass', [m(1, 54321), m(2, 55555)]))
};
const enc = (t) => Q.encode(t, 'M');
const textOf = (r) => (r ? Buffer.from(r).toString('utf8') : null);

test('Reed-Solomon correction: up to eccLen/2 random errors are fixed, more are refused', () => {
  for (const eccLen of [10, 18, 28, 30]) {
    for (let trial = 0; trial < 30; trial++) {
      const data = [...crypto.randomBytes(40)];
      const cw = Q.rsEncode(data, eccLen);
      const bad = cw.slice();
      const nerr = 1 + (trial % (eccLen / 2));
      const seen = new Set();
      while (seen.size < nerr) seen.add(Math.floor(Math.random() * cw.length));
      for (const p of seen) bad[p] ^= 1 + Math.floor(Math.random() * 255);
      assert.deepEqual(Q.rsCorrect(bad, eccLen), cw, `eccLen ${eccLen} errors ${nerr}`);
    }
    const cw = Q.rsEncode([...crypto.randomBytes(40)], eccLen), bad = cw.slice();
    for (let i = 0; i < eccLen / 2 + 3; i++) bad[i * 2] ^= 77;
    assert.throws(() => Q.rsCorrect(bad, eccLen), /error-correction/);
  }
});

test('matrix decode now corrects damaged modules', () => {
  const qr = enc(CODES.answer144), copy = qr.modules.map((r) => r.slice());
  for (const [x, y] of [[qr.size - 1, qr.size - 1], [qr.size - 3, qr.size - 5], [30, 40], [31, 41], [20, 45]]) copy[y][x] = !copy[y][x];
  assert.equal(textOf(Q.decodeMatrix(copy)), CODES.answer144);
});

test('code sizes (characters) and QR versions', () => {
  for (const [k, c] of Object.entries(CODES)) { const q = enc(c); console.log(`code ${k}: ${c.length} characters -> QR version ${q.version} (${q.size}x${q.size} modules, level M)`); }
  assert.equal(CODES.answer144.length, 144);
});

/* ---- the key test: decoder over a matrix of synthetic camera conditions ---- */
const BASE = { scale: 5 };
const CASES = [
  ...[3, 4, 6, 8].map((scale) => ['scale ' + scale, { scale }, 'base']),
  ...[90, 180, 270, 15, -30, 45, 170].map((rot) => ['rotation ' + rot, { rot }, 'base']),
  ...[1, 2, 3].map((seed) => ['perspective 4% #' + seed, { persp: 0.04, seed }, 'base']),
  ...[4, 5, 6].map((seed) => ['perspective 8% + rot #' + seed, { persp: 0.08, rot: 12, seed, scale: 6 }, 'hard']),
  ['noise 20', { noise: 20 }, 'base'], ['noise 45', { noise: 45 }, 'hard'],
  ['blur 1', { blur: 1 }, 'base'], ['blur 2', { blur: 2, scale: 6 }, 'hard'],
  ['inverted', { invert: true }, 'base'], ['inverted + noise', { invert: true, noise: 25, rot: 20 }, 'hard'],
  ['low contrast 90-170', { lo: 90, hi: 170 }, 'base'], ['low contrast 60-110 + noise', { lo: 60, hi: 110, noise: 8 }, 'hard'],
  ['dim (30-130)', { lo: 30, hi: 130 }, 'base'], ['bright washed (150-255)', { lo: 150, hi: 255 }, 'base'],
  ['glare', { glare: 140 }, 'hard'], ['glare strong', { glare: 220, scale: 6 }, 'hard'],
  ['moire', { moire: 35 }, 'hard'], ['moire + blur', { moire: 30, blur: 1 }, 'hard'],
  ['combined moderate', { rot: 10, persp: 0.05, noise: 15, blur: 1, lo: 50, hi: 210, scale: 6 }, 'hard'],
  ['combined hard', { rot: -20, persp: 0.07, noise: 25, blur: 1, lo: 70, hi: 170, glare: 80, moire: 15, scale: 6 }, 'hard']
];

test('QR image decoder recovers the exact code across the synthetic camera matrix', () => {
  let total = 0, ok = 0, base = 0, baseOk = 0, hard = 0, hardOk = 0, fastOk = 0, ms = 0;
  const fails = [];
  for (const [name, opts, kind] of CASES) {
    for (const [ck, code] of Object.entries(CODES)) {
      const qr = enc(code), img = render(qr, { ...BASE, seed: 7, ...opts });
      const t0 = performance.now();
      const res = S.decodeGray(img.gray, img.w, img.h, { deep: true });
      ms += performance.now() - t0;
      const good = textOf(res) === code;
      if (good && textOf(S.decodeGray(img.gray, img.w, img.h, { deep: false })) === code) fastOk++;
      total++; ok += good; if (kind === 'base') { base++; baseOk += good; } else { hard++; hardOk += good; }
      if (!good) fails.push(`${name} / ${ck}${res ? ' (wrong text)' : ''}`);
    }
  }
  console.log(`QR image decoder: ${ok}/${total} = ${(100 * ok / total).toFixed(1)}% overall; baseline ${baseOk}/${base}; hard ${hardOk}/${hard}; single-pass (fast) mode ${fastOk}/${total}; mean ${(ms / total).toFixed(0)} ms per image (deep mode)`);
  if (fails.length) console.log('failed cases:\n  ' + fails.join('\n  '));
  assert.equal(baseOk, base, 'every baseline case must decode: ' + fails.join('; '));
  assert.ok(ok / total >= 0.9, 'overall success rate ' + (ok / total));
});

test('no false positives: noise, blank and a non-QR pattern decode to nothing', () => {
  const W = 400, H = 400, g = new Uint8Array(W * H);
  let r = 12345; for (let i = 0; i < g.length; i++) { r = (r * 1103515245 + 12345) & 0x7fffffff; g[i] = r >> 23; }
  assert.equal(S.decodeGray(g, W, H, { deep: true }), null);
  assert.equal(S.decodeGray(new Uint8Array(W * H).fill(200), W, H, { deep: true }), null);
  const stripes = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) stripes[y * W + x] = (Math.floor(x / 7) + Math.floor(y / 7)) % 2 ? 230 : 20;
  assert.equal(S.decodeGray(stripes, W, H, { deep: true }), null);
});

test('decoder returns exact bytes for arbitrary binary payloads too', () => {
  const bin = crypto.randomBytes(120), qr = Q.encode(bin, 'M'), img = render(qr, { scale: 5, rot: 8, persp: 0.03, noise: 10, seed: 3 });
  assert.deepEqual(Buffer.from(S.decodeGray(img.gray, img.w, img.h, { deep: true })), bin);
});

test('randomised sweep (plausible webcam-of-a-screen conditions): success rate', async () => {
  const { rng } = await import('./qrimage.mjs');
  const r = rng(2024);
  let total = 0, ok = 0, ms = 0;
  const fails = [];
  for (const [ck, code] of Object.entries(CODES)) {
    const qr = enc(code);
    for (let i = 0; i < 40; i++) {
      const span = 60 + r() * 195, lo = r() * (255 - span);
      const o = { scale: 4 + Math.floor(r() * 4), rot: Math.floor(r() * 360), persp: r() * 0.08, noise: r() * 35, blur: Math.floor(r() * 3), lo, hi: lo + span, glare: r() < 0.4 ? r() * 150 : 0, moire: r() < 0.4 ? r() * 25 : 0, invert: r() < 0.1, seed: 100 + i };
      const img = render(qr, o), t0 = performance.now();
      const res = S.decodeGray(img.gray, img.w, img.h, { deep: true });
      ms += performance.now() - t0; total++;
      if (textOf(res) === code) ok++; else fails.push(ck + ' ' + JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
    }
  }
  console.log(`QR randomised sweep: ${ok}/${total} = ${(100 * ok / total).toFixed(1)}% (mean ${(ms / total).toFixed(0)} ms)`);
  if (fails.length) console.log('sweep failures:\n  ' + fails.slice(0, 12).join('\n  '));
  assert.ok(ok / total >= 0.85, 'sweep success ' + ok / total);
});
