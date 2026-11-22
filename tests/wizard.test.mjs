import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../lt-core.js');
const K = require('../lt-code.js');
const W = require('../lt-wizard.js');
const Q = require('../lt-qr.js');

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';
function sdp(setup, cands) {
  return ['v=0', 'o=- 123456789 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:xKqP', 'a=ice-pwd:7Zs0aB3dEfGhIjKlMnOpQrSt', 'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + FP, 'a=setup:' + setup, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ...cands].join('\r\n') + '\r\n';
}
const MDNS = ['a=candidate:1 1 udp 2113937151 3f2a9b1c-1111-4222-8333-444455556666.local 54321 typ host generation 0 network-cost 999',
  'a=candidate:2 1 udp 2113939711 0a1b2c3d-aaaa-4bbb-8ccc-ddddeeeeffff.local 55555 typ host generation 0 network-cost 999',
  'a=candidate:3 1 tcp 1518280447 3f2a9b1c-1111-4222-8333-444455556666.local 9 typ host tcptype active generation 0 network-cost 999'];
const V4 = ['a=candidate:1 1 udp 2122260223 192.168.42.129 49152 typ host generation 0', 'a=candidate:2 1 udp 1686052607 203.0.113.9 49152 typ srflx raddr 192.168.42.129 rport 49152 generation 0',
  'a=candidate:3 1 udp 2122194687 fe80::1234:5678:9abc:def0 50000 typ host generation 0'];

test('compact code round trip for offer (mDNS) and answer (IPv4, srflx, IPv6)', () => {
  for (const [kind, role, setup, cands] of [['o', 'offer', 'actpass', MDNS], ['a', 'answer', 'active', V4]]) {
    const code = K.sdpToCode(kind, sdp(setup, cands));
    assert.match(code, /^LT2-[0-9A-Z]{5}(-[0-9A-Z]{1,5})*$/);
    const back = K.codeToSdp(code, kind);
    assert.equal(back.kind, kind);
    const a = K.parseSdp(sdp(setup, cands)), b = K.parseSdp(back.sdp);
    assert.equal(b.ufrag, a.ufrag); assert.equal(b.pwd, a.pwd);
    assert.deepEqual([...b.fp], [...a.fp]);
    assert.equal(b.cands.length, a.cands.length);
    a.cands.forEach((c, i) => { assert.deepEqual([...b.cands[i].bytes], [...c.bytes]); assert.equal(b.cands[i].port, c.port); assert.equal(b.cands[i].srflx, c.srflx); assert.equal(b.cands[i].kind, c.kind); });
    assert.match(back.sdp, new RegExp('a=setup:' + (role === 'offer' ? 'actpass' : 'active')));
    assert.match(back.sdp, /a=candidate:1 1 udp /);
    assert.match(back.sdp, /m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel/);
  }
});

test('rebuilt SDP keeps mDNS names and IPs exactly', () => {
  const back = K.codeToSdp(K.sdpToCode('o', sdp('actpass', MDNS)), 'o').sdp;
  assert.match(back, /3f2a9b1c-1111-4222-8333-444455556666\.local 54321 typ host/);
  assert.match(back, /0a1b2c3d-aaaa-4bbb-8ccc-ddddeeeeffff\.local 55555 typ host/);
  assert.ok(!/tcp/i.test(back), 'tcp candidates dropped');
  const b2 = K.codeToSdp(K.sdpToCode('a', sdp('active', V4)), 'a').sdp;
  assert.match(b2, /192\.168\.42\.129 49152 typ host/);
  assert.match(b2, /203\.0\.113\.9 49152 typ srflx/);
  assert.match(b2, /fe80:0:0:0:1234:5678:9abc:def0 50000 typ host/);
});

test('code length is measured and short', () => {
  const o = K.sdpToCode('o', sdp('actpass', MDNS)), a = K.sdpToCode('a', sdp('active', ['a=candidate:1 1 udp 2122260223 192.168.42.129 49152 typ host generation 0']));
  const so = K.codeStats(o), sa = K.codeStats(a);
  console.log('compact offer (2 mDNS candidates):', so.length, 'chars; answer (1 IPv4 candidate):', sa.length, 'chars; full SDP was', sdp('actpass', MDNS).length);
  assert.ok(so.length < 230, 'offer ' + so.length);
  assert.ok(sa.length < 160, 'answer ' + sa.length);
  assert.ok(sa.typeable);
  assert.ok(so.length < sdp('actpass', MDNS).length / 3);
});

test('code tolerates typing: lowercase, spaces, O/0 and I/L/1, line breaks', () => {
  const code = K.sdpToCode('a', sdp('active', V4));
  const messy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l').replace(/(.{20})/g, '$1\n');
  assert.equal(K.codeToSdp(messy, 'a').kind, 'a');
});

test('code errors: wrong kind, typo, truncated, not a code, unsupported SDP', () => {
  const o = K.sdpToCode('o', sdp('actpass', MDNS));
  assert.throws(() => K.codeToSdp(o, 'a'), /PC's code/);
  assert.throws(() => K.codeToSdp(K.sdpToCode('a', sdp('active', V4)), 'o'), /ANSWER code/);
  const flip = o.slice(0, 12) + (o[12] === 'A' ? 'B' : 'A') + o.slice(13);
  assert.throws(() => K.codeToSdp(flip, 'o'), /check digits|damaged|too short|not allowed|unknown/);
  assert.throws(() => K.codeToSdp(o.slice(0, o.length - 8), 'o'), /check digits|damaged|too short/);
  assert.throws(() => K.codeToSdp('hello', 'o'), /not a pairing code/);
  assert.throws(() => K.codeToSdp('LT2-@@@@', 'o'), /not allowed|too short/);
  assert.throws(() => K.sdpToCode('o', sdp('actpass', ['a=candidate:1 1 udp 1 weird.example 5 typ host'])), /unsupported candidate/);
  assert.throws(() => K.sdpToCode('o', 'v=0\r\nm=audio 9 RTP/AVP 0\r\n'), /data-channel/);
  assert.throws(() => K.sdpToCode('o', sdp('actpass', [])), /no usable candidates/);
  assert.ok(K.isCode(o)); assert.ok(!K.isCode('ITNLT1:o:abc:123'));
});

test('base32 round trip and QR fits for the compact code', () => {
  for (const n of [0, 1, 2, 5, 17, 100]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual([...K.b32decode(K.b32encode(b))], [...b]);
  }
  const code = K.sdpToCode('o', sdp('actpass', MDNS));
  const qr = Q.encode(code.replace(/-/g, '-'), 'M');
  assert.ok(qr.version <= 10, 'QR version ' + qr.version);
  assert.equal(Buffer.from(Q.decodeMatrix(qr.modules)).toString(), code);
});

/* ---------- wizard state machine ---------- */
test('mode suggestion', () => {
  assert.equal(W.suggestMode({ ua: 'Mozilla/5.0 (Windows NT 10.0) Edg/120', coarsePointer: false, touchPoints: 0 }), 'pc');
  assert.equal(W.suggestMode({ ua: 'Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120', coarsePointer: true, touchPoints: 5 }), 'tablet');
  assert.equal(W.suggestMode({ ua: 'Windows touch laptop', coarsePointer: false, touchPoints: 10 }), 'tablet');
  assert.equal(W.suggestMode({}), 'pc');
});

test('wizard: five steps, Next only after a pass, Back always, progress label', () => {
  for (const mode of ['pc', 'tablet']) {
    const w = new W.Wizard(mode);
    assert.equal(w.n, 5);
    assert.equal(w.label(), 'Step 1 of 5: ' + W.STEPS[mode][0]);
    assert.ok(!w.canBack()); assert.ok(!w.canNext());
    w.next(); assert.equal(w.current, 1, 'cannot skip an unpassed step');
    assert.equal(w.go(3), false);
    w.pass(1); assert.ok(w.canNext()); w.next(); assert.equal(w.current, 2);
    assert.ok(w.canBack()); w.back(); assert.equal(w.current, 1);
    w.fail(1, 'camera blocked'); assert.ok(!w.canNext()); assert.equal(w.messages[0], 'camera blocked');
    w.pass(1); w.pass(2); assert.ok(w.go(3)); assert.equal(w.current, 3);
    w.pass(3).pass(4).pass(5);
    w.go(5); assert.ok(!w.canNext(), 'no next after the last step');
    assert.deepEqual(w.strip().map((s) => s.status), ['pass', 'pass', 'pass', 'pass', 'pass']);
    assert.equal(w.strip().filter((s) => s.current).length, 1);
  }
});

test('wizard: link opening completes the pairing steps; start again resets', () => {
  const w = new W.Wizard('pc');
  w.pass(1); w.next();
  w.linkOpened();
  assert.deepEqual(w.status, ['pass', 'pass', 'pass', 'todo', 'todo']);
  assert.equal(w.current, 4);
  const t = new W.Wizard('tablet'); t.linkOpened(); t.go(5) || assert.ok(true);
  w.startAgain(); assert.equal(w.current, 1); assert.ok(w.status.every((s) => s === 'todo'));
  assert.throws(() => new W.Wizard('phone'));
  assert.throws(() => w.pass(9));
});

test('wizard: auto-advance rules follow who must act', () => {
  const pc = new W.Wizard('pc'), tb = new W.Wizard('tablet');
  assert.ok(!pc.autoNext(1), 'PC must show the code to the tablet first');
  assert.ok(pc.autoNext(2) && pc.autoNext(3));
  assert.ok(tb.autoNext(1), 'tablet moves on after scanning');
  assert.ok(!tb.autoNext(2), 'tablet must show the answer to the PC first');
});

/* ---------- verdict ---------- */
const GOOD = { connected: true, candidate: 'host', network: 'Office Wi-Fi', rttMs: 12, out: { ok: true, rate: 20 * 1048576 }, inn: { ok: true, rate: 12 * 1048576 }, file: { ok: true }, resume: { ok: true } };

test('verdict: works, with sync-time estimate from the slower direction', () => {
  const v = W.verdict(GOOD);
  assert.equal(v.result, 'works');
  assert.match(v.headline, /^DIRECT LINK WORKS \(12\.0 MB\/s; a daily sync of 500 MB would take under a minute\)/);
  assert.match(v.lines.join(' '), /intact/);
  assert.match(v.lines.join(' '), /continued correctly/);
  const v2 = W.verdict({ ...GOOD, out: { ok: true, rate: 3 * 1048576 }, inn: { ok: true, rate: 4 * 1048576 } });
  assert.match(v2.headline, /3\.00 MB\/s; a daily sync of 500 MB would take about 3 minutes/);
});

test('verdict: slow, unreliable, incomplete', () => {
  assert.equal(W.verdict({ ...GOOD, out: { ok: true, rate: 400000 } }).result, 'slow');
  assert.match(W.verdict({ ...GOOD, out: { ok: true, rate: 400000 } }).headline, /^WORKS BUT SLOW/);
  const u = W.verdict({ ...GOOD, file: { ok: false } });
  assert.equal(u.result, 'unreliable'); assert.match(u.headline, /test file did not arrive intact/);
  assert.equal(W.verdict({ ...GOOD, inn: { ok: false, rate: 1 } }).result, 'unreliable');
  const inc = W.verdict({ connected: true, candidate: 'host', out: { ok: true, rate: 1e6 }, errors: ['Step "in" timed out.'] });
  assert.equal(inc.result, 'incomplete'); assert.match(inc.lines[0], /timed out/);
  const noResume = W.verdict({ ...GOOD, resume: { ok: false } });
  assert.equal(noResume.result, 'works'); assert.match(noResume.lines.join(' '), /starting a file again/);
  assert.equal(W.verdict({ ...GOOD, candidate: 'relay' }).result, 'fail');
});

test('verdict: not connected gives plain reasons and next steps with exact setting names', () => {
  const v = W.verdict({ connected: false, hadMdns: true, stun: false, network: 'Office Wi-Fi' });
  assert.equal(v.result, 'fail');
  assert.match(v.headline, /^DOES NOT WORK/);
  const all = v.lines.join(' ') + ' ' + v.next.join(' ');
  assert.match(all, /client isolation/);
  assert.match(all, /Mobile Hotspot and Tethering/);
  assert.match(all, /USB tethering/);
  assert.match(all, /VPN/);
  assert.match(all, /STUN/);
  assert.match(all, /random names/);
  const v2 = W.verdict({ connected: false, stun: true, network: 'USB tethering' });
  const all2 = v2.lines.join(' ') + v2.next.join(' ');
  assert.ok(!/Tick "Also try a public STUN/.test(all2), 'STUN advice not repeated once used');
  assert.ok(!/client isolation/.test(all2));
  assert.ok(!/Settings -> Connections/.test(v2.next[0]), 'tethering advice not repeated when already on tethering');
  assert.equal(W.connectionProblem({ network: 'Office Wi-Fi' }).result, 'fail');
});

test('verdict text never contains IP addresses; report accepts verdict preface', () => {
  const v = W.verdict(GOOD);
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(v)));
  const rep = C.formatReport({ version: '2', generated: 'x', network: 'USB tethering', role: 'PC', preface: ['VERDICT: ' + v.headline, 'Pairing code length: offer 150, answer 96 characters'], sections: [], suggestions: [] });
  assert.match(rep, /VERDICT: DIRECT LINK WORKS/);
  assert.match(rep, /Pairing code length: offer 150/);
});
