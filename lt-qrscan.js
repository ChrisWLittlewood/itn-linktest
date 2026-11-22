/* ITN Link Test - QR code reader for camera frames, pure JavaScript (no library, no network).
   gray image -> binarise (several ways) -> finder patterns (1:1:3:1:1) -> alignment pattern -> perspective grid sampling
   -> module matrix -> LTQr.decodeMatrix (format info + Reed-Solomon error correction + byte mode). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lt-qr.js'));
  else root.LTQrScan = factory(root.LTQr);
})(typeof self !== 'undefined' ? self : this, function (Q) {
  'use strict';

  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    return g;
  }

  /* scale 0.5 (2x2 box) or 2 (bilinear); anything else returns the input */
  function resample(g, w, h, scale) {
    var x, y, out, nw, nh;
    if (scale === 0.5) {
      nw = w >> 1; nh = h >> 1; out = new Uint8Array(nw * nh);
      for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) { var i = (y * 2) * w + x * 2; out[y * nw + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) >> 2; }
      return { g: out, w: nw, h: nh };
    }
    if (scale === 2) {
      nw = w * 2; nh = h * 2; out = new Uint8Array(nw * nh);
      for (y = 0; y < nh; y++) {
        var sy = Math.max(0, (y - 0.5) / 2), y0 = Math.min(h - 1, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
        for (x = 0; x < nw; x++) {
          var sx = Math.max(0, (x - 0.5) / 2), x0 = Math.min(w - 1, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
          var a = g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx, b = g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx;
          out[y * nw + x] = a * (1 - fy) + b * fy;
        }
      }
      return { g: out, w: nw, h: nh };
    }
    return { g: g, w: w, h: h };
  }

  /* 1 = dark. mode: 'adaptive' (local mean) | 'otsu' (global) ; bias moves the threshold ; invert flips polarity */
  function binarize(g, w, h, mode, bias, invert) {
    var bits = new Uint8Array(w * h), i, x, y;
    if (mode === 'otsu') {
      var hist = new Array(256).fill(0); for (i = 0; i < g.length; i++) hist[g[i]]++;
      var sum = 0, total = g.length; for (i = 0; i < 256; i++) sum += i * hist[i];
      var sb = 0, wb = 0, best = 0, th = 127;
      for (i = 0; i < 256; i++) { wb += hist[i]; if (!wb) continue; var wf = total - wb; if (!wf) break; sb += i * hist[i]; var mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > best) { best = v; th = i; } }
      th += bias || 0;
      for (i = 0; i < g.length; i++) bits[i] = (g[i] <= th) !== !!invert ? 1 : 0;
      return bits;
    }
    var r = Math.max(7, Math.floor(Math.min(w, h) / 10)), W1 = w + 1, integ = new Float64Array(W1 * (h + 1));
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += g[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row; } }
    var frac = 1 - 0.06 + (bias || 0) / 255;
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var area = (x1 - x0) * (y1 - y0), s = integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0];
        var dark = g[y * w + x] * area < s * frac;
        bits[y * w + x] = dark !== !!invert ? 1 : 0;
      }
    }
    return bits;
  }

  /* ---- finder patterns ---- */
  function ratioOk(runs, tol) {
    var total = runs[0] + runs[1] + runs[2] + runs[3] + runs[4];
    if (total < 7) return 0;
    var m = total / 7, t = m * tol;
    if (Math.abs(runs[0] - m) < t && Math.abs(runs[1] - m) < t && Math.abs(runs[2] - 3 * m) < 3 * t && Math.abs(runs[3] - m) < t && Math.abs(runs[4] - m) < t) return m;
    return 0;
  }
  /* the 5 runs (dark, light, DARK centre, light, dark) through (cx,cy) along (dx,dy); also the offset of the centre run's middle from (cx,cy) */
  function crossRuns(bits, w, h, cx, cy, dx, dy) {
    var x = Math.round(cx), y = Math.round(cy);
    function at(i) { var px = x + dx * i, py = y + dy * i; return (px < 0 || py < 0 || px >= w || py >= h) ? -1 : bits[py * w + px]; }
    if (at(0) !== 1) return null;
    var runs = [0, 0, 0, 0, 0], k = 0, c, pos;
    while (at(-k) === 1) k++;
    runs[2] = k; pos = -k;
    c = 0; while (at(pos) === 0) { c++; pos--; } runs[1] = c; if (!c) return null;
    c = 0; while (at(pos) === 1) { c++; pos--; } runs[0] = c; if (!c) return null;
    var f = 0, q = 1; while (at(q) === 1) { f++; q++; }
    runs[2] += f;
    c = 0; while (at(q) === 0) { c++; q++; } runs[3] = c; if (!c) return null;
    c = 0; while (at(q) === 1) { c++; q++; } runs[4] = c; if (!c) return null;
    return { runs: runs, off: (f - (k - 1)) / 2 };
  }
  function findFinders(bits, w, h) {
    var cands = [], y, x;
    for (y = 0; y < h; y++) {
      var list = [], cur = bits[y * w], run = 0;
      for (x = 0; x < w; x++) { var b = bits[y * w + x]; if (b === cur) run++; else { list.push([cur, run, x - run]); cur = b; run = 1; } }
      list.push([cur, run, w - run]);
      for (var i = 0; i + 4 < list.length; i++) {
        if (!list[i][0]) continue;
        var r5 = [list[i][1], list[i + 1][1], list[i + 2][1], list[i + 3][1], list[i + 4][1]], m = ratioOk(r5, 0.7);
        if (!m) continue;
        var cx = list[i][2] + r5[0] + r5[1] + r5[2] / 2;
        var v = crossRuns(bits, w, h, cx, y, 0, 1); if (!v) continue;
        var m2 = ratioOk(v.runs, 0.7); if (!m2) continue;
        var cy = y + v.off;
        var hr = crossRuns(bits, w, h, cx, cy, 1, 0); if (!hr) continue;
        var m3 = ratioOk(hr.runs, 0.7); if (!m3) continue;
        cx += hr.off;
        var mod = (m + m2 + m3) / 3, found = false;
        for (var c = 0; c < cands.length; c++) {
          var q = cands[c];
          if (Math.abs(q.x - cx) < q.m * 2 && Math.abs(q.y - cy) < q.m * 2 && Math.abs(q.m - mod) < q.m * 0.5) { q.x = (q.x * q.n + cx) / (q.n + 1); q.y = (q.y * q.n + cy) / (q.n + 1); q.m = (q.m * q.n + mod) / (q.n + 1); q.n++; found = true; break; }
        }
        if (!found) cands.push({ x: cx, y: cy, m: mod, n: 1 });
      }
    }
    return cands.filter(function (c) { return c.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 9);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  /* ordered triples [TL, TR, BL] that look like three corners of a square */
  function triples(f) {
    var out = [];
    for (var i = 0; i < f.length; i++) for (var j = i + 1; j < f.length; j++) for (var k = j + 1; k < f.length; k++) {
      var P = [f[i], f[j], f[k]], d = [dist(P[1], P[2]), dist(P[0], P[2]), dist(P[0], P[1])]; /* d[n] = side opposite P[n] */
      var hyp = d.indexOf(Math.max(d[0], d[1], d[2])), tl = P[hyp], o = P.filter(function (_, n) { return n !== hyp; });
      var s1 = dist(tl, o[0]), s2 = dist(tl, o[1]);
      if (s1 < 10 || s2 < 10 || Math.min(s1, s2) / Math.max(s1, s2) < 0.6) continue;
      var dot = ((o[0].x - tl.x) * (o[1].x - tl.x) + (o[0].y - tl.y) * (o[1].y - tl.y)) / (s1 * s2);
      if (Math.abs(dot) > 0.5) continue;
      var mm = Math.max(tl.m, o[0].m, o[1].m) / Math.min(tl.m, o[0].m, o[1].m); if (mm > 1.7) continue;
      var cross = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
      var tr = cross > 0 ? o[0] : o[1], bl = cross > 0 ? o[1] : o[0];
      out.push({ tl: tl, tr: tr, bl: bl, score: tl.n + o[0].n + o[1].n - Math.abs(s1 - s2) / Math.max(s1, s2) * 5 });
    }
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 4);
  }

  /* alignment pattern near (px,py): light-DARK-light, each about one module, in both directions (the outer dark ring may touch dark data) */
  function centreCheck(bits, w, h, cx, cy, dx, dy, mod) {
    var x = Math.round(cx), y = Math.round(cy), tol = mod * 0.7;
    function at(i) { var px = x + dx * i, py = y + dy * i; return (px < 0 || py < 0 || px >= w || py >= h) ? -1 : bits[py * w + px]; }
    if (at(0) !== 1) return null;
    var k = 0; while (at(-k) === 1) k++;
    var f = 0, q = 1; while (at(q) === 1) { f++; q++; }
    var len = k + f; if (Math.abs(len - mod) > tol) return null;
    var c1 = 0, p = -k; while (at(p) === 0) { c1++; p--; }
    var c2 = 0; q = f + 1; while (at(q) === 0) { c2++; q++; }
    if (Math.abs(c1 - mod) > tol || Math.abs(c2 - mod) > tol || at(p) !== 1 || at(q) !== 1) return null;
    return (f - (k - 1)) / 2;
  }
  /* all 25 modules of the 5x5 alignment pattern, laid out along the (possibly rotated) module axes e1, e2 */
  function apVerify(bits, w, h, cx, cy, e1, e2) {
    var good = 0;
    for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) {
      var x = Math.round(cx + a * e1[0] + b * e2[0]), y = Math.round(cy + a * e1[1] + b * e2[1]);
      var want = Math.max(Math.abs(a), Math.abs(b)) === 1 ? 0 : 1;
      if (x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] === want) good++;
    }
    return good >= 23;
  }
  function findAlignment(bits, w, h, px, py, mod, e1, e2) {
    var rad = Math.ceil(mod * 6), best = null, bd = Infinity, x0 = Math.max(0, Math.floor(px - rad)), x1 = Math.min(w, Math.ceil(px + rad));
    for (var y = Math.max(0, Math.floor(py - rad)); y < Math.min(h, Math.ceil(py + rad)); y++) {
      var list = [], cur = null, run = 0, x;
      for (x = x0; x < x1; x++) {
        var b = bits[y * w + x];
        if (b === cur) run++; else { if (cur !== null) list.push([cur, run, x - run]); cur = b; run = 1; }
      }
      if (cur !== null) list.push([cur, run, x1 - run]);
      for (var i = 1; i + 1 < list.length; i++) {
        if (!list[i][0] || list[i - 1][0] || list[i + 1][0]) continue;
        var tol = mod * 0.7;
        if (Math.abs(list[i][1] - mod) > tol || Math.abs(list[i - 1][1] - mod) > tol || Math.abs(list[i + 1][1] - mod) > tol) continue;
        var cx = list[i][2] + list[i][1] / 2, off = centreCheck(bits, w, h, cx, y, 0, 1, mod);
        if (off === null) continue;
        var cy = y + off, off2 = centreCheck(bits, w, h, cx, cy, 1, 0, mod);
        if (off2 === null) continue;
        cx += off2;
        if (e1 && !apVerify(bits, w, h, cx, cy, e1, e2)) continue;
        var dd = Math.hypot(cx - px, cy - py);
        if (dd < bd) { bd = dd; best = { x: cx, y: cy }; }
      }
    }
    return best;
  }

  /* homography mapping 4 source points to 4 destination points (returns function) */
  function homography(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
    }
    for (i = 0; i < 8; i++) {
      var p = i; for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var t = A[i]; A[i] = A[p]; A[p] = t;
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (j = i + 1; j < 8; j++) { var f = A[j][i] / A[i][i]; for (k = i; k < 9; k++) A[j][k] -= f * A[i][k]; }
    }
    var hh = new Array(8);
    for (i = 7; i >= 0; i--) { var s = A[i][8]; for (j = i + 1; j < 8; j++) s -= A[i][j] * hh[j]; hh[i] = s / A[i][i]; }
    return function (u, v) { var d = hh[6] * u + hh[7] * v + 1; return [(hh[0] * u + hh[1] * v + hh[2]) / d, (hh[3] * u + hh[4] * v + hh[5]) / d]; };
  }

  function sampleMatrix(bits, w, h, map, dim) {
    var m = [], r, c;
    for (r = 0; r < dim; r++) {
      var row = new Array(dim);
      for (c = 0; c < dim; c++) {
        var votes = 0, offs = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
        for (var o = 0; o < 5; o++) {
          var p = map(c + offs[o][0], r + offs[o][1]), x = Math.round(p[0] - 0.5), y = Math.round(p[1] - 0.5);
          if (x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x]) votes++;
        }
        row[c] = votes >= 3;
      }
      m.push(row);
    }
    return m;
  }

  function tryTriple(bits, w, h, t) {
    var ang = Math.atan2(t.tr.y - t.tl.y, t.tr.x - t.tl.x), rotf = Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang))), mod0 = (t.tl.m + t.tr.m + t.bl.m) / 3 * rotf; /* runs measured along rows are stretched when the code is rotated */
    var est = (dist(t.tl, t.tr) + dist(t.tl, t.bl)) / 2 / mod0 + 7, v0 = Math.round((est - 17) / 4), tried = {};
    var vers = [v0, v0 + 1, v0 - 1, v0 + 2, v0 - 2];
    for (var vi = 0; vi < vers.length; vi++) {
      var v = vers[vi]; if (v < 1 || v > 40 || tried[v]) continue; tried[v] = 1;
      var dim = 17 + 4 * v, span = dim - 7;
      var e1 = [(t.tr.x - t.tl.x) / span, (t.tr.y - t.tl.y) / span], e2 = [(t.bl.x - t.tl.x) / span, (t.bl.y - t.tl.y) / span];
      var aff = function (u, w2) { return [t.tl.x + (u - 3.5) * e1[0] + (w2 - 3.5) * e2[0], t.tl.y + (u - 3.5) * e1[1] + (w2 - 3.5) * e2[1]]; };
      var fourth = aff(dim - 3.5, dim - 3.5), srcPts = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], [dim - 3.5, dim - 3.5]];
      if (v >= 2) {
        var pred = aff(dim - 6.5, dim - 6.5), modv = Math.hypot(e1[0], e1[1]), ap = findAlignment(bits, w, h, pred[0], pred[1], modv, e1, e2);
        if (ap) { srcPts[3] = [dim - 6.5, dim - 6.5]; fourth = [ap.x, ap.y]; }
        else srcPts[3] = [dim - 3.5, dim - 3.5];
      }
      var map = homography(srcPts, [[t.tl.x, t.tl.y], [t.tr.x, t.tr.y], [t.bl.x, t.bl.y], fourth]);
      if (!map) continue;
      try { return Q.decodeMatrix(sampleMatrix(bits, w, h, map, dim)); } catch (e) { /* try next version / triple */ }
    }
    return null;
  }

  function decodeBits(bits, w, h) {
    var f = findFinders(bits, w, h);
    if (f.length < 3) return null;
    var ts = triples(f);
    for (var i = 0; i < ts.length; i++) { var r = tryTriple(bits, w, h, ts[i]); if (r) return r; }
    return null;
  }

  /* gray: Uint8Array w*h. opts.deep also tries half and double size. Returns Uint8Array of decoded bytes or null. */
  function decodeGray(gray, w, h, opts) {
    opts = opts || {};
    var sizes = [{ g: gray, w: w, h: h }];
    if (opts.deep) { var half = resample(gray, w, h, 0.5); if (half.w > 80) sizes.push(half); if (w * h < 500000) sizes.push(resample(gray, w, h, 2)); }
    var variants = [['adaptive', 0, false], ['otsu', 0, false], ['adaptive', 0, true], ['otsu', 0, true], ['adaptive', 6, false], ['adaptive', -6, false]];
    if (!opts.deep) variants = variants.slice(0, 3);
    for (var s = 0; s < sizes.length; s++) for (var v = 0; v < variants.length; v++) {
      var bits = binarize(sizes[s].g, sizes[s].w, sizes[s].h, variants[v][0], variants[v][1], variants[v][2]);
      var r = decodeBits(bits, sizes[s].w, sizes[s].h);
      if (r) return r;
    }
    return null;
  }
  function decodeRgba(rgba, w, h, opts) { return decodeGray(toGray(rgba, w, h), w, h, opts); }

  return { tryTriple: tryTriple, triples: triples, sampleMatrix: sampleMatrix, findAlignment: findAlignment, homography: homography, decodeGray: decodeGray, decodeRgba: decodeRgba, toGray: toGray, binarize: binarize, findFinders: findFinders, resample: resample };
});
