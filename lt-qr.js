/* ITN Link Test - tiny QR code generator (byte mode, ECC L/M, versions 1-40) and a matrix decoder for round-trip tests.
   Written for this app; follows the QR Model 2 layout (ISO/IEC 18004). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LTQr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ECC = {
    L: { fmt: 1, cw: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25] },
    M: { fmt: 0, cw: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
         blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] }
  };

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(v, ecl) {
    return Math.floor(rawModules(v) / 8) - ECC[ecl].cw[v - 1] * ECC[ecl].blocks[v - 1];
  }
  function alignPositions(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    var step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  /* GF(256) */
  function gmul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 255;
  }
  function rsDivisor(deg) {
    var r = new Array(deg).fill(0); r[deg - 1] = 1;
    var root = 1;
    for (var i = 0; i < deg; i++) {
      for (var j = 0; j < deg; j++) {
        r[j] = gmul(r[j], root);
        if (j + 1 < deg) r[j] ^= r[j + 1];
      }
      root = gmul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = new Array(div.length).fill(0);
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= gmul(c, f); });
    });
    return r;
  }

  /* function-pattern template: returns {size, mod[y][x], fn[y][x]} with all function modules drawn (format bits blank/0) */
  function template(v) {
    var size = v * 4 + 17, mod = [], fn = [], i, j;
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { mod[y][x] = d; fn[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = alignPositions(v), n = ap.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    /* reserve format areas */
    for (i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    setF(8, size - 8, true);
    if (v >= 7) {
      for (i = 0; i < 18; i++) { var a = size - 11 + (i % 3), b = Math.floor(i / 3); fn[b][a] = true; fn[a][b] = true; }
    }
    return { size: size, mod: mod, fn: fn };
  }
  function bit(x, i) { return ((x >>> i) & 1) !== 0; }
  function formatBits(ecl, mask) {
    var data = (ECC[ecl].fmt << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function drawFormat(mod, size, ecl, mask) {
    var bits = formatBits(ecl, mask), i;
    for (i = 0; i <= 5; i++) mod[i][8] = bit(bits, i);
    mod[7][8] = bit(bits, 6); mod[8][8] = bit(bits, 7); mod[8][7] = bit(bits, 8);
    for (i = 9; i < 15; i++) mod[8][14 - i] = bit(bits, i);
    for (i = 0; i < 8; i++) mod[8][size - 1 - i] = bit(bits, i);
    for (i = 8; i < 15; i++) mod[size - 15 + i][8] = bit(bits, i);
    mod[size - 8][8] = true;
  }
  function drawVersion(mod, size, v) {
    if (v < 7) return;
    var rem = v;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (v << 12) | rem;
    for (i = 0; i < 18; i++) {
      var b = bit(bits, i), a = size - 11 + (i % 3), c = Math.floor(i / 3);
      mod[c][a] = b; mod[a][c] = b;
    }
  }
  function maskFn(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }
  function applyMask(mod, fn, size, m) {
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++)
      if (!fn[y][x] && maskFn(m, x, y)) mod[y][x] = !mod[y][x];
  }
  function penalty(mod, size) {
    var p = 0, x, y, run, i;
    function lines(get) {
      for (var a = 0; a < size; a++) {
        run = 1;
        var bits = '';
        for (var b = 0; b < size; b++) {
          var cur = get(a, b);
          bits += cur ? '1' : '0';
          if (b > 0 && cur === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
        }
        var idx = -1;
        while ((idx = bits.indexOf('10111010000', idx + 1)) >= 0) p += 40;
        idx = -1;
        while ((idx = bits.indexOf('00001011101', idx + 1)) >= 0) p += 40;
      }
    }
    lines(function (a, b) { return mod[a][b]; });
    lines(function (a, b) { return mod[b][a]; });
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    p += Math.max(0, k) * 10;
    return p;
  }

  function utf8(text) {
    if (typeof text !== 'string') return text;
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    return Uint8Array.from(Buffer.from(text, 'utf8'));
  }

  /* encode bytes (or string); ecl 'L' (default) or 'M'. Returns {version, size, modules[y][x], mask, ecl} */
  function encode(input, ecl) {
    ecl = ecl || 'L';
    var bytes = utf8(input), v, i;
    for (v = 1; v <= 40; v++) {
      var cap = dataCodewords(v, ecl) * 8, used = 4 + (v < 10 ? 8 : 16) + 8 * bytes.length;
      if (used <= cap) break;
    }
    if (v > 40) throw new Error('Too much data for one QR code (' + bytes.length + ' bytes). Use the copy/paste text instead.');
    var bits = [];
    function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    var capBits = dataCodewords(v, ecl) * 8;
    put(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    for (var pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }
    var all = interleave(data, v, ecl);
    var t = template(v), size = t.size, mod = t.mod, fn = t.fn;
    /* codewords */
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < all.length * 8) { mod[y][x] = bit(all[bi >>> 3], 7 - (bi & 7)); bi++; }
      }
    }
    var best = -1, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(mod, fn, size, m);
      drawFormat(mod, size, ecl, m); drawVersion(mod, size, v);
      var pen = penalty(mod, size);
      if (pen < bestP) { bestP = pen; best = m; }
      applyMask(mod, fn, size, m);
    }
    applyMask(mod, fn, size, best);
    drawFormat(mod, size, ecl, best); drawVersion(mod, size, v);
    return { version: v, size: size, modules: mod, mask: best, ecl: ecl };
  }

  function blockLayout(v, ecl) {
    var nb = ECC[ecl].blocks[v - 1], eccLen = ECC[ecl].cw[v - 1], raw = Math.floor(rawModules(v) / 8);
    var shortCount = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    return { nb: nb, eccLen: eccLen, raw: raw, shortCount: shortCount, shortLen: shortLen };
  }
  function interleave(data, v, ecl) {
    var L = blockLayout(v, ecl), div = rsDivisor(L.eccLen), blocks = [], k = 0, i, j;
    for (i = 0; i < L.nb; i++) {
      var dat = data.slice(k, k + L.shortLen - L.eccLen + (i < L.shortCount ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < L.shortCount) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++)
      for (j = 0; j < blocks.length; j++)
        if (i !== L.shortLen - L.eccLen || j >= L.shortCount) out.push(blocks[j][i]);
    return out;
  }

  /* decode a module matrix (array of rows of booleans). Verifies the error-correction codes. Returns Uint8Array. */
  function decodeMatrix(mod) {
    var size = mod.length, v = (size - 17) / 4;
    if (v !== Math.floor(v) || v < 1 || v > 40) throw new Error('bad matrix size');
    function readFormat() {
      var bits = 0, i;
      for (i = 0; i <= 5; i++) bits |= (mod[i][8] ? 1 : 0) << i;
      bits |= (mod[7][8] ? 1 : 0) << 6; bits |= (mod[8][8] ? 1 : 0) << 7; bits |= (mod[8][7] ? 1 : 0) << 8;
      for (i = 9; i < 15; i++) bits |= (mod[8][14 - i] ? 1 : 0) << i;
      return bits;
    }
    var fb = readFormat(), found = null, bestD = 99;
    ['L', 'M'].forEach(function (e) {
      for (var m = 0; m < 8; m++) {
        var cand = formatBits(e, m), d = 0, x = cand ^ fb;
        while (x) { d += x & 1; x >>>= 1; }
        if (d < bestD) { bestD = d; found = { ecl: e, mask: m }; }
      }
    });
    if (!found || bestD > 3) throw new Error('unreadable format bits (or unsupported ECC level)');
    var t = template(v), fn = t.fn, work = mod.map(function (r) { return r.slice(); });
    applyMask(work, fn, size, found.mask);
    var bytes = [], cur = 0, nbit = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x]) {
          cur = (cur << 1) | (work[y][x] ? 1 : 0); nbit++;
          if (nbit === 8) { bytes.push(cur); cur = 0; nbit = 0; }
        }
      }
    }
    var L = blockLayout(v, found.ecl), blocks = [], i, j2, pos = 0;
    var lens = [];
    for (i = 0; i < L.nb; i++) lens.push(L.shortLen + 1); /* short blocks keep one untransmitted placeholder slot */
    for (i = 0; i < L.nb; i++) blocks.push(new Array(lens[i]));
    var maxLen = L.shortLen + 1;
    for (i = 0; i < maxLen; i++) for (j2 = 0; j2 < L.nb; j2++) {
      if (i !== L.shortLen - L.eccLen || j2 >= L.shortCount) blocks[j2][i] = bytes[pos++];
    }
    var data = [], div = rsDivisor(L.eccLen);
    blocks.forEach(function (blk, bi) {
      var dlen = lens[bi] - L.eccLen, d = blk.slice(0, dlen), e = blk.slice(dlen);
      /* short blocks carry a placeholder slot at index shortLen-eccLen which is not transmitted; rebuild */
      if (bi < L.shortCount) { d = blk.slice(0, L.shortLen - L.eccLen); e = blk.slice(L.shortLen - L.eccLen + 1); }
      var calc = rsRemainder(d, div);
      for (var q = 0; q < calc.length; q++) if (calc[q] !== e[q]) throw new Error('error-correction check failed');
      data = data.concat(d);
    });
    /* parse: mode(4) count then bytes */
    var bp = 0;
    function take(n) { var r = 0; for (var k = 0; k < n; k++) { r = (r << 1) | ((data[bp >>> 3] >>> (7 - (bp & 7))) & 1); bp++; } return r; }
    if (take(4) !== 4) throw new Error('not byte mode');
    var count = take(v < 10 ? 8 : 16), out = new Uint8Array(count);
    for (i = 0; i < count; i++) out[i] = take(8);
    return out;
  }

  /* draw onto a canvas element (browser only). scale = pixels per module */
  function drawToCanvas(canvas, qr, scale, quiet) {
    scale = scale || 4; quiet = quiet === undefined ? 4 : quiet;
    var n = qr.size + quiet * 2, px = n * scale;
    canvas.width = px; canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++)
      if (qr.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }

  return { encode: encode, decodeMatrix: decodeMatrix, drawToCanvas: drawToCanvas, dataCodewords: dataCodewords };
});
