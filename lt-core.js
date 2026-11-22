/* ITN Link Test - pure logic (no DOM). Works in the browser, in a service worker and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LTCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KB = 1024, MB = 1048576;

  /* ---------- formatting ---------- */
  function formatBytes(n) {
    if (!isFinite(n) || n < 0) return '?';
    if (n < KB) return Math.round(n) + ' B';
    if (n < MB) return (n / KB).toFixed(1) + ' KB';
    if (n < 1024 * MB) return (n / MB).toFixed(n < 10 * MB ? 2 : 1) + ' MB';
    return (n / (1024 * MB)).toFixed(2) + ' GB';
  }
  function formatRate(bytesPerSec) {
    if (!isFinite(bytesPerSec) || bytesPerSec < 0) return '?';
    return (bytesPerSec / MB).toFixed(bytesPerSec < 10 * MB ? 2 : 1) + ' MB/s';
  }
  function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return '?';
    sec = Math.round(sec);
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  /* ---------- progress / ETA ---------- */
  function progressStats(o) {
    var done = Math.max(0, o.done), total = Math.max(0, o.total), ms = Math.max(0, o.elapsedMs);
    var rate = ms > 0 ? done / (ms / 1000) : 0;
    var remaining = Math.max(0, total - done);
    return {
      pct: total > 0 ? Math.min(100, (done / total) * 100) : 0,
      rate: rate,
      etaSec: rate > 0 ? remaining / rate : (remaining === 0 ? 0 : Infinity),
      mbPerSec: rate / MB
    };
  }

  /* ---------- chunking ---------- */
  function chunkCount(total, chunkSize) {
    if (total <= 0) return 0;
    return Math.ceil(total / chunkSize);
  }
  function chunkRanges(total, chunkSize, from) {
    var out = [];
    for (var s = from || 0; s < total; s += chunkSize) out.push([s, Math.min(total, s + chunkSize)]);
    return out;
  }
  /* how many more chunks may be queued without exceeding the high-water mark */
  function pumpPlan(buffered, high, chunkSize) {
    return Math.max(0, Math.floor((high - buffered) / chunkSize));
  }

  /* ---------- resume planning ---------- */
  /* receiver asks to resume with {name,size,have}; sender holds {name,size} */
  function resumeOffset(sender, req) {
    if (!sender || !req) return { ok: false, reason: 'no file selected on the sending side' };
    if (sender.name !== req.name || sender.size !== req.size)
      return { ok: false, reason: 'the selected file is not the one being resumed (name or size differs)' };
    var have = req.have;
    if (!(have >= 0) || have > sender.size || Math.floor(have) !== have)
      return { ok: false, reason: 'invalid resume offset' };
    return { ok: true, offset: have };
  }

  /* ---------- SHA-256 (incremental, pure JS) ---------- */
  var K = new Uint32Array(64), IV = new Uint32Array(8);
  (function () {
    var primes = [], n = 2;
    while (primes.length < 64) {
      var isP = true;
      for (var i = 0; i < primes.length; i++) if (n % primes[i] === 0) { isP = false; break; }
      if (isP) primes.push(n);
      n++;
    }
    function frac32(x) { return Math.floor((x - Math.floor(x)) * 4294967296) >>> 0; }
    for (var j = 0; j < 64; j++) K[j] = frac32(Math.cbrt(primes[j]));
    for (var k = 0; k < 8; k++) IV[k] = frac32(Math.sqrt(primes[k]));
  })();

  function Sha256() {
    this.h = new Uint32Array(IV);
    this.buf = new Uint8Array(64);
    this.blen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }
  Sha256.prototype._block = function (b, o) {
    var w = this.w, h = this.h, i;
    for (i = 0; i < 16; i++, o += 4) w[i] = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      var t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  };
  Sha256.prototype.update = function (u8) {
    var i = 0, n = u8.length;
    this.total += n;
    if (this.blen) {
      while (this.blen < 64 && i < n) this.buf[this.blen++] = u8[i++];
      if (this.blen === 64) { this._block(this.buf, 0); this.blen = 0; }
    }
    while (i + 64 <= n) { this._block(u8, i); i += 64; }
    while (i < n) this.buf[this.blen++] = u8[i++];
    return this;
  };
  Sha256.prototype.digest = function () {
    var bits = this.total * 8, pad = new Uint8Array(((this.blen < 56) ? 56 : 120) - this.blen + 8);
    pad[0] = 0x80;
    var hi = Math.floor(bits / 4294967296), lo = bits >>> 0, L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
    pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    var total = this.total;
    this.update(pad);
    this.total = total;
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) { out[i * 4] = this.h[i] >>> 24; out[i * 4 + 1] = this.h[i] >>> 16; out[i * 4 + 2] = this.h[i] >>> 8; out[i * 4 + 3] = this.h[i]; }
    return out;
  };
  Sha256.prototype.hex = function () { return toHex(this.digest()); };

  function toHex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }
  function sha256Hex(u8) { return new Sha256().update(u8).hex(); }

  /* ---------- block hasher: SHA-256 of each 1 MB block (native, async), then SHA-256 of the digests ---------- */
  /* digestFn(u8) -> Promise<ArrayBuffer|Uint8Array> (e.g. crypto.subtle.digest.bind(null,'SHA-256')) */
  function BlockHasher(digestFn, blockSize) {
    this.digestFn = digestFn;
    this.size = blockSize || MB;
    this.cur = new Uint8Array(this.size);
    this.n = 0;
    this.pending = [];
    this.total = 0;
  }
  BlockHasher.prototype.update = function (u8) {
    var i = 0;
    this.total += u8.length;
    while (i < u8.length) {
      var take = Math.min(this.size - this.n, u8.length - i);
      this.cur.set(u8.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.size) this._flush();
    }
  };
  BlockHasher.prototype._flush = function () {
    if (!this.n) return;
    this.pending.push(Promise.resolve(this.digestFn(this.cur.slice(0, this.n))));
    this.n = 0;
  };
  BlockHasher.prototype.finish = function () {
    var self = this;
    this._flush();
    return Promise.all(this.pending).then(function (ds) {
      var all = new Uint8Array(ds.length * 32);
      ds.forEach(function (d, i) { all.set(new Uint8Array(d), i * 32); });
      return Promise.resolve(self.digestFn(all));
    }).then(function (d) { return toHex(new Uint8Array(d)); });
  };

  function hashesMatch(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.length === 64 && a.toLowerCase() === b.toLowerCase();
  }

  /* ---------- signalling text (offer / answer) ---------- */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64urlEncode(u8) {
    var s = '', i;
    for (i = 0; i + 2 < u8.length; i += 3) {
      var n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i + 1 === u8.length) { var a = u8[i] << 16; s += B64[a >> 18] + B64[(a >> 12) & 63]; }
    else if (i + 2 === u8.length) { var b = (u8[i] << 16) | (u8[i + 1] << 8); s += B64[b >> 18] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63]; }
    return s;
  }
  function b64urlDecode(str) {
    var rev = {}, i;
    for (i = 0; i < 64; i++) rev[B64[i]] = i;
    var vals = [];
    for (i = 0; i < str.length; i++) {
      var v = rev[str[i]];
      if (v === undefined) throw new Error('bad character in text');
      vals.push(v);
    }
    if (vals.length % 4 === 1) throw new Error('text is truncated');
    var out = [];
    for (i = 0; i < vals.length; i += 4) {
      var n = (vals[i] << 18) | (vals[i + 1] << 12) | ((vals[i + 2] || 0) << 6) | (vals[i + 3] || 0);
      out.push((n >> 16) & 255);
      if (i + 2 < vals.length) out.push((n >> 8) & 255);
      if (i + 3 < vals.length) out.push(n & 255);
    }
    return new Uint8Array(out);
  }
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0);
  }
  function crcText(u8) { var h = crc32(u8).toString(16); return ('00000000' + h).slice(-8); }

  var SIG_PREFIX = 'ITNLT1';
  /* kind: 'o' offer | 'a' answer; bytes: Uint8Array (already compressed or raw; first byte of bytes = 0 raw / 1 deflate-raw) */
  function packSignal(kind, bytes) {
    if (kind !== 'o' && kind !== 'a') throw new Error('kind must be o or a');
    return SIG_PREFIX + ':' + kind + ':' + b64urlEncode(bytes) + ':' + crcText(bytes);
  }
  function unpackSignal(text) {
    var t = String(text || '').replace(/\s+/g, '');
    var p = t.split(':');
    if (p.length !== 4 || p[0] !== SIG_PREFIX) throw new Error('This is not a link-test pairing text (it should start with ' + SIG_PREFIX + ').');
    if (p[1] !== 'o' && p[1] !== 'a') throw new Error('Unknown pairing text type.');
    var bytes;
    try { bytes = b64urlDecode(p[2]); } catch (e) { throw new Error('The pairing text is damaged (' + e.message + '). Copy it again.'); }
    if (crcText(bytes) !== p[3].toLowerCase()) throw new Error('The pairing text is incomplete or damaged (check code mismatch). Copy it again.');
    return { kind: p[1], bytes: bytes };
  }

  /* ---------- candidate parsing (for the report; never stores addresses) ---------- */
  function parseCandidate(line) {
    var m = /candidate:(\S+) (\d+) (\w+) (\d+) (\S+) (\d+) typ (\w+)/.exec(line || '');
    if (!m) return null;
    var addr = m[5];
    var kind = /\.local$/i.test(addr) ? 'mdns' : (addr.indexOf(':') >= 0 ? 'ipv6' : 'ipv4');
    return { protocol: m[3].toLowerCase(), type: m[7], addrKind: kind, address: addr };
  }
  function subnet24(addr) {
    var m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(addr || '');
    return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
  }
  function sameSubnet(listA, listB) {
    for (var i = 0; i < listA.length; i++) if (listB.indexOf(listA[i]) >= 0) return true;
    return false;
  }
  function redactIPs(text) {
    return String(text)
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'x.x.x.x')
      .replace(/\b[0-9a-f-]{8,}\.local\b/gi, '<mdns>.local')
      .replace(/[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}/gi, function (m) {
        return (m.indexOf('::') >= 0 || /[a-f]/i.test(m)) && m.length > 4 ? '<ipv6>' : m; /* keeps times such as 10:00:00 */
      });
  }

  /* ---------- status vocabulary and plain-language meaning ---------- */
  var STATUSES = ['PASS', 'FAIL', 'NOT SUPPORTED', 'INFO', 'NOT RUN'];
  var EXPLAIN = {
    dev: {
      PASS: 'This browser has the features a daily sync tool would build on. The table below shows exactly which ones.',
      FAIL: 'Some basic features are missing (see list). A sync feature would need a different route on this device.',
      'NOT SUPPORTED': 'Could not read the device information.'
    },
    selftest: {
      PASS: 'Hashing, compression and random data work, so integrity checks in a sync tool will work here.',
      FAIL: 'The integrity check building blocks failed here. A sync tool could not prove files arrived intact.',
      'NOT SUPPORTED': 'Required crypto/compression features are missing.'
    },
    link: {
      PASS: 'The two devices opened a direct link with no server. A direct PC-to-tablet sync is possible on this network.',
      FAIL: 'No direct link. Wi-Fi may isolate devices or block them. Try USB tethering or the PC hotspot (Same-network section).',
      'NOT SUPPORTED': 'This browser has no WebRTC, so a direct browser-to-browser link is not possible here.'
    },
    tp: {
      PASS: 'Data crossed the link intact. The MB/s figure is the real speed a daily sync would get.',
      FAIL: 'Data was corrupted or the transfer stopped. A direct sync would not be reliable on this link.',
      'NOT SUPPORTED': 'Needs an open link first.'
    },
    file: {
      PASS: 'A real file went across and the SHA-256 matched. A file-based daily sync (for example a setup copy) is possible.',
      FAIL: 'The file did not arrive intact. Do not rely on this link for sync until the cause is known.',
      'NOT SUPPORTED': 'Needs an open link first.'
    },
    resume: {
      PASS: 'An interrupted transfer continued from where it stopped and still matched. A flaky link will not force a full restart.',
      FAIL: 'The resumed file did not match. A sync design would have to restart whole files after a drop.',
      'NOT SUPPORTED': 'Needs an open link first.'
    },
    net: {
      PASS: 'Both devices appear to be on the same network segment, so a direct link should work.',
      FAIL: 'The devices look to be on different networks. Use USB tethering or a hotspot so they share one.',
      INFO: 'This shows what the browser exposes about local addresses. Most browsers hide real IPs behind random .local names; that is normal.',
      'NOT SUPPORTED': 'WebRTC is missing, so local addresses cannot be listed.'
    },
    usb: {
      PASS: 'The browser can see a USB device through WebUSB. Check the class codes: only vendor-specific devices are usable; phones in file-transfer mode normally are not.',
      FAIL: 'No USB device could be used from the browser. This is the expected result for a tablet in file-transfer (MTP) mode. USB cable copy then stays an Explorer drag-and-drop job, not a web feature.',
      'NOT SUPPORTED': 'This browser has no WebUSB (Edge/Chrome on a PC normally do). USB can not be used from the page; use Explorer copy or USB tethering.',
      INFO: 'Device list only.'
    },
    fsdir: {
      PASS: 'The page can read and write a real folder on this PC at the speed shown. A PC-side sync folder is possible.',
      FAIL: 'Writing to the chosen folder failed or was blocked. A page-based sync folder would not work here.',
      'NOT SUPPORTED': 'No folder picker in this browser (typical on Android). The PC folder route is possible only on the PC.'
    },
    opfs: {
      PASS: 'The browser private storage works at the speed shown. A sync tool can cache incoming data here before saving it.',
      FAIL: 'Private browser storage failed. Large incoming data could not be staged.',
      'NOT SUPPORTED': 'No private browser file storage (OPFS) here.'
    },
    dl: {
      PASS: 'The page asked the browser to save a generated file to Downloads. Check the Downloads folder on this device.',
      FAIL: 'The download could not be started. A sync tool could not hand a file to the user this way.',
      'NOT SUPPORTED': 'Downloads are not available here.'
    },
    pick: {
      PASS: 'The chosen file was read through the system picker at the speed shown. If your OneDrive file read fast, the picker is fine for it.',
      FAIL: 'The file could not be read fully or stalled. This is the cloud-file problem: use a locally stored copy or the Share route.',
      'NOT SUPPORTED': 'No file picker available.'
    },
    canshare: {
      PASS: 'The browser can hand files to other apps with Share. A sync tool could send files out to OneDrive or another app.',
      FAIL: 'Sharing files is not allowed here.',
      'NOT SUPPORTED': 'Web Share with files is not available in this browser (common on desktop Edge/Chrome on non-touch Windows installs).'
    },
    target: {
      PASS: 'The app received a file shared from another app. "Share from OneDrive to the app" works as a way to get files in on the tablet.',
      FAIL: 'A share arrived but could not be read.',
      'NOT SUPPORTED': 'This browser/device cannot register a share target (the app must be installed as an app on Android).',
      INFO: 'Install the app, then use Share from the OneDrive app and pick this app.'
    },
    tab: {
      PASS: 'Same-origin tabs can talk and the browser database works. ITN\'s own manual flows depend on this.',
      FAIL: 'Tab messaging or the browser database failed. ITN manual flows may misbehave here.',
      'NOT SUPPORTED': 'BroadcastChannel or IndexedDB is missing.'
    }
  };
  function explain(id, status) {
    var e = EXPLAIN[id];
    if (status === 'NOT RUN') return 'Not run yet.';
    return (e && e[status]) || '';
  }

  /* ---------- design suggestion from results ---------- */
  function suggestDesign(r, network) {
    var st = function (id) { return r[id] ? r[id].status : 'NOT RUN'; };
    var out = [];
    if (st('link') === 'PASS' && (st('tp') === 'PASS' || st('file') === 'PASS')) {
      out.push('WebRTC direct link works on "' + (network || 'unlabelled network') + '" -> design A (direct sync) is possible here.');
    } else if (st('link') === 'FAIL') {
      out.push('Direct link failed on "' + (network || 'unlabelled network') + '" -> repeat on USB tethering / hotspot; if it also fails use a share/folder route.');
    } else if (st('link') === 'NOT RUN') {
      out.push('Direct link not tested yet.');
    }
    if (st('target') === 'PASS') out.push('Share target works -> OneDrive app Share route is possible (design C).');
    if (st('pick') === 'FAIL') out.push('Chosen-file read failed or stalled -> avoid the in-browser OneDrive picker.');
    if (st('fsdir') === 'PASS') out.push('PC folder read/write works -> PC-side folder is possible.');
    if (st('link') !== 'PASS' && st('target') !== 'PASS')
      out.push('Fallback: a small PC helper program (design D) if no browser-only route passes.');
    return out;
  }

  /* ---------- report formatter ---------- */
  function formatReport(rep) {
    var L = [];
    L.push('ITN LINK TEST REPORT');
    L.push('App version: ' + (rep.version || '?'));
    L.push('Generated: ' + (rep.generated || '?'));
    if (rep.network) L.push('Network used for the link test: ' + rep.network);
    if (rep.role) L.push('Device role: ' + rep.role);
    if (rep.preface && rep.preface.length) { L.push(''); rep.preface.forEach(function (x) { L.push(x); }); }
    L.push('');
    (rep.sections || []).forEach(function (s) {
      L.push('[' + s.status + '] ' + s.title);
      if (s.summary) L.push('  ' + s.summary);
      (s.details || []).forEach(function (d) { L.push('    ' + d); });
    });
    if (rep.suggestions && rep.suggestions.length) {
      L.push('');
      L.push('Suggestions from this device:');
      rep.suggestions.forEach(function (x) { L.push('  - ' + x); });
    }
    L.push('');
    L.push('No secrets, no IP addresses and no ITN data are included in this report.');
    return redactIPs(L.join('\n'));
  }

  return {
    KB: KB, MB: MB, STATUSES: STATUSES,
    formatBytes: formatBytes, formatRate: formatRate, formatDuration: formatDuration,
    progressStats: progressStats, chunkCount: chunkCount, chunkRanges: chunkRanges, pumpPlan: pumpPlan,
    resumeOffset: resumeOffset,
    Sha256: Sha256, sha256Hex: sha256Hex, toHex: toHex, BlockHasher: BlockHasher, hashesMatch: hashesMatch,
    b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, crc32: crc32, packSignal: packSignal, unpackSignal: unpackSignal,
    parseCandidate: parseCandidate, subnet24: subnet24, sameSubnet: sameSubnet, redactIPs: redactIPs,
    explain: explain, suggestDesign: suggestDesign, formatReport: formatReport
  };
});
