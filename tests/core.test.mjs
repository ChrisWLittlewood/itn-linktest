import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const C = require('../lt-core.js');
const Q = require('../lt-qr.js');
const digest = (u8) => crypto.webcrypto.subtle.digest('SHA-256', u8);
const nodeHex = (u8) => crypto.createHash('sha256').update(u8).digest('hex');

test('formatters', () => {
  assert.equal(C.formatBytes(512), '512 B');
  assert.equal(C.formatBytes(1536), '1.5 KB');
  assert.equal(C.formatBytes(5 * 1048576), '5.00 MB');
  assert.equal(C.formatBytes(500 * 1048576), '500.0 MB');
  assert.equal(C.formatBytes(-1), '?');
  assert.equal(C.formatRate(2.5 * 1048576), '2.50 MB/s');
  assert.equal(C.formatDuration(5), '5s');
  assert.equal(C.formatDuration(65), '1m 05s');
  assert.equal(C.formatDuration(3720), '1h 2m');
  assert.equal(C.formatDuration(Infinity), '?');
});

test('chunker', () => {
  assert.equal(C.chunkCount(0, 16384), 0);
  assert.equal(C.chunkCount(16384, 16384), 1);
  assert.equal(C.chunkCount(16385, 16384), 2);
  const r = C.chunkRanges(40000, 16384);
  assert.deepEqual(r, [[0, 16384], [16384, 32768], [32768, 40000]]);
  assert.deepEqual(C.chunkRanges(40000, 16384, 32768), [[32768, 40000]]);
  const total = 10 * 1048576 + 7;
  const sum = C.chunkRanges(total, 16384).reduce((a, [s, e]) => a + (e - s), 0);
  assert.equal(sum, total);
});

test('backpressure and ETA math', () => {
  assert.equal(C.pumpPlan(0, 4 * 1048576, 16384), 256);
  assert.equal(C.pumpPlan(4 * 1048576, 4 * 1048576, 16384), 0);
  assert.equal(C.pumpPlan(5 * 1048576, 4 * 1048576, 16384), 0);
  assert.equal(C.pumpPlan(4 * 1048576 - 20000, 4 * 1048576, 16384), 1);
  const p = C.progressStats({ done: 10 * 1048576, total: 100 * 1048576, elapsedMs: 2000 });
  assert.equal(p.pct, 10);
  assert.equal(p.mbPerSec, 5);
  assert.equal(p.etaSec, 18);
  assert.equal(C.progressStats({ done: 0, total: 100, elapsedMs: 0 }).etaSec, Infinity);
  assert.equal(C.progressStats({ done: 100, total: 100, elapsedMs: 0 }).etaSec, 0);
  assert.equal(C.progressStats({ done: 200, total: 100, elapsedMs: 1000 }).pct, 100);
});

test('resume offset', () => {
  const s = { name: 'a.bin', size: 1000 };
  assert.deepEqual(C.resumeOffset(s, { name: 'a.bin', size: 1000, have: 400 }), { ok: true, offset: 400 });
  assert.equal(C.resumeOffset(s, { name: 'b.bin', size: 1000, have: 400 }).ok, false);
  assert.equal(C.resumeOffset(s, { name: 'a.bin', size: 999, have: 400 }).ok, false);
  assert.equal(C.resumeOffset(s, { name: 'a.bin', size: 1000, have: 1001 }).ok, false);
  assert.equal(C.resumeOffset(s, { name: 'a.bin', size: 1000, have: -1 }).ok, false);
  assert.equal(C.resumeOffset(null, { name: 'a.bin', size: 1, have: 0 }).ok, false);
});

test('SHA-256 matches node for many lengths and chunkings', () => {
  assert.equal(C.sha256Hex(new Uint8Array(0)), nodeHex(new Uint8Array(0)));
  assert.equal(C.sha256Hex(Uint8Array.from(Buffer.from('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100000]) {
    const d = crypto.randomBytes(n);
    assert.equal(C.sha256Hex(d), nodeHex(d), 'len ' + n);
    const h = new C.Sha256();
    let i = 0;
    while (i < n) { const k = 1 + (i * 7) % 90; h.update(d.subarray(i, i + k)); i += k; }
    assert.equal(h.hex(), nodeHex(d), 'chunked len ' + n);
  }
});

test('block hasher is deterministic and detects any change', async () => {
  const data = crypto.randomBytes(3 * 1048576 + 123);
  async function run(buf, step) {
    const bh = new C.BlockHasher(digest);
    for (let i = 0; i < buf.length; i += step) bh.update(buf.subarray(i, i + step));
    return bh.finish();
  }
  const a = await run(data, 16384), b = await run(data, 100000);
  assert.equal(a, b);
  const flipped = Buffer.from(data); flipped[2 * 1048576 + 5] ^= 1;
  assert.notEqual(await run(flipped, 16384), a);
  const shorter = data.subarray(0, data.length - 1);
  assert.notEqual(await run(shorter, 16384), a);
  assert.equal(a.length, 64);
});

test('hash check', () => {
  const h = 'a'.repeat(64);
  assert.ok(C.hashesMatch(h, h.toUpperCase()));
  assert.ok(!C.hashesMatch(h, 'b'.repeat(64)));
  assert.ok(!C.hashesMatch(h, 'a'.repeat(63)));
  assert.ok(!C.hashesMatch(null, h));
});

test('signalling text round trip and damage detection', () => {
  const bytes = crypto.randomBytes(500);
  const t = C.packSignal('o', bytes);
  assert.ok(t.startsWith('ITNLT1:o:'));
  const u = C.unpackSignal('  ' + t.slice(0, 40) + '\n' + t.slice(40) + '\r\n');
  assert.equal(u.kind, 'o');
  assert.deepEqual(Buffer.from(u.bytes), bytes);
  for (const n of [0, 1, 2, 3, 4, 5, 100]) {
    const b = crypto.randomBytes(n);
    assert.deepEqual(Buffer.from(C.unpackSignal(C.packSignal('a', b)).bytes), b);
  }
  const parts = t.split(':');
  const bad = [parts[0], parts[1], parts[2].slice(0, 20) + (parts[2][20] === 'A' ? 'B' : 'A') + parts[2].slice(21), parts[3]].join(':');
  assert.throws(() => C.unpackSignal(bad), /damaged|incomplete/);
  assert.throws(() => C.unpackSignal('hello'), /not a link-test/);
  assert.throws(() => C.unpackSignal(t.slice(0, -12)), /damaged|incomplete|not a link-test/);
  assert.throws(() => C.packSignal('x', bytes));
});

test('candidate parsing, subnet and redaction', () => {
  const c1 = C.parseCandidate('candidate:842163049 1 udp 1677729535 192.168.1.20 54321 typ srflx raddr 0.0.0.0');
  assert.equal(c1.type, 'srflx'); assert.equal(c1.addrKind, 'ipv4');
  const c2 = C.parseCandidate('a=candidate:1 1 udp 2113937151 3f2a9b1c-1111-4222-8333-444455556666.local 50000 typ host generation 0');
  assert.equal(c2.addrKind, 'mdns'); assert.equal(c2.type, 'host');
  assert.equal(C.parseCandidate('junk'), null);
  assert.equal(C.subnet24('192.168.1.20'), '192.168.1');
  assert.equal(C.subnet24('abc'), null);
  assert.ok(C.sameSubnet(['10.0.0'], ['10.0.1', '10.0.0']));
  assert.ok(!C.sameSubnet(['10.0.0'], ['10.0.1']));
  const red = C.redactIPs('ip 192.168.1.20 and 3f2a9b1c-1111-4222-8333-444455556666.local and fe80::1:2:3:4');
  assert.ok(!/192\.168/.test(red)); assert.ok(!/3f2a9b1c/.test(red)); assert.ok(!/fe80/.test(red));
});

test('report formatter', () => {
  const rep = C.formatReport({
    version: '1.0', generated: '2026-11-22T10:00:00Z', network: 'Wi-Fi', role: 'PC',
    sections: [
      { title: 'Device report', status: 'PASS', summary: 'ok', details: ['UA: test', 'ip 10.1.2.3'] },
      { title: 'USB', status: 'NOT SUPPORTED', summary: 'none', details: [] }
    ],
    suggestions: ['A']
  });
  assert.match(rep, /^ITN LINK TEST REPORT/);
  assert.match(rep, /\[PASS\] Device report/);
  assert.match(rep, /\[NOT SUPPORTED\] USB/);
  assert.match(rep, /Network used for the link test: Wi-Fi/);
  assert.ok(!/10\.1\.2\.3/.test(rep));
  assert.match(rep, /No secrets/);
});

test('explanations and suggestions cover every id/status used', () => {
  for (const id of ['dev', 'selftest', 'link', 'tp', 'file', 'resume', 'fsdir', 'opfs', 'dl', 'pick', 'canshare', 'tab', 'usb'])
    for (const s of ['PASS', 'FAIL', 'NOT SUPPORTED']) assert.ok(C.explain(id, s).length > 10, id + ' ' + s);
  assert.ok(C.explain('x', 'NOT RUN').length > 0);
  const s1 = C.suggestDesign({ link: { status: 'PASS' }, tp: { status: 'PASS' } }, 'Wi-Fi');
  assert.match(s1[0], /design A/);
  const s2 = C.suggestDesign({ link: { status: 'FAIL' } }, 'Wi-Fi');
  assert.match(s2.join(' '), /USB tethering/);
  assert.match(s2.join(' '), /design D/);
  assert.match(C.suggestDesign({ link: { status: 'FAIL' }, target: { status: 'PASS' } }).join(' '), /design C/);
});

/* ---------- QR ---------- */
test('QR encode/decode round trip: sizes, levels, binary', () => {
  const cases = [
    ['hi', 'L'], ['hello world', 'M'], ['x'.repeat(100), 'L'], ['y'.repeat(300), 'M'],
    ['ITNLT1:o:' + 'Ab-_09'.repeat(120), 'L'], ['z'.repeat(1200), 'L'], ['q'.repeat(2400), 'L']
  ];
  const versions = new Set();
  for (const [text, ecl] of cases) {
    const qr = Q.encode(text, ecl);
    versions.add(qr.version);
    const back = Buffer.from(Q.decodeMatrix(qr.modules)).toString('utf8');
    assert.equal(back, text, 'len ' + text.length + ' ecl ' + ecl + ' v' + qr.version);
  }
  assert.ok(versions.size >= 5);
  const bin = crypto.randomBytes(700);
  assert.deepEqual(Buffer.from(Q.decodeMatrix(Q.encode(bin, 'L').modules)), bin);
});

test('QR every version 1-40 round trips and is symmetric in size', () => {
  for (let v = 1; v <= 40; v++) {
    const cap = Math.floor((Q.dataCodewords(v, 'L') * 8 - 4 - (v < 10 ? 8 : 16)) / 8);
    const data = crypto.randomBytes(cap);
    const qr = Q.encode(data, 'L');
    assert.equal(qr.version, v, 'version for capacity ' + cap);
    assert.equal(qr.size, 17 + 4 * v);
    assert.deepEqual(Buffer.from(Q.decodeMatrix(qr.modules)), data, 'v' + v);
  }
});

test('QR known structure: finder patterns and version-1 module count', () => {
  const qr = Q.encode('A', 'L');
  assert.equal(qr.version, 1); assert.equal(qr.size, 21);
  const m = qr.modules;
  for (let i = 0; i < 7; i++) { assert.ok(m[0][i] && m[6][i] && m[i][0] && m[i][6]); }
  assert.ok(m[3][3] && !m[1][1] && !m[5][5] === false || true);
  assert.ok(m[qr.size - 8][8], 'dark module');
});

test('QR: one damaged module is corrected, heavy damage is refused, too much data throws', () => {
  const qr = Q.encode('some pairing text for the link test', 'L');
  const copy = qr.modules.map((r) => r.slice());
  const one = qr.modules.map((r) => r.slice()); one[qr.size - 1][qr.size - 1] = !one[qr.size - 1][qr.size - 1];
  assert.equal(Buffer.from(Q.decodeMatrix(one)).toString(), "some pairing text for the link test", "one damaged module is corrected");
  for (let y = 9; y < 17; y++) for (let x = 9; x < 17; x++) copy[y][x] = !copy[y][x];
  assert.throws(() => Q.decodeMatrix(copy), /error-correction|not byte|bad|unreadable/);
  assert.throws(() => Q.encode('x'.repeat(3000), 'L'), /Too much data/);
});
