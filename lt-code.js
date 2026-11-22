/* ITN Link Test - compact pairing codes.
   Reduces a data-channel-only WebRTC offer/answer to the few fields that matter (ICE user fragment + password,
   DTLS fingerprint, UDP candidates as address:port) and encodes them as a short grouped code (Crockford base32).
   Anything unexpected throws, and the app then falls back to the full-length text format. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lt-core.js'));
  else root.LTCode = factory(root.LTCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var PREFIX = 'LT2';
  var UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

  function hexToBytes(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
  function bytesToHex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }

  function ipv6ToBytes(a) {
    var parts = a.toLowerCase().split('::');
    if (parts.length > 2) throw new Error('bad ipv6');
    var head = parts[0] ? parts[0].split(':') : [], tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
    if (parts.length === 1 && head.length !== 8) throw new Error('bad ipv6');
    var mid = parts.length === 2 ? 8 - head.length - tail.length : 0;
    if (mid < 0) throw new Error('bad ipv6');
    var groups = head.concat(new Array(mid).fill('0'), tail), out = new Uint8Array(16);
    if (groups.length !== 8) throw new Error('bad ipv6');
    groups.forEach(function (g, i) { var v = parseInt(g, 16); if (!(v >= 0 && v < 65536)) throw new Error('bad ipv6'); out[i * 2] = v >> 8; out[i * 2 + 1] = v & 255; });
    return out;
  }
  function bytesToIpv6(b) {
    var g = []; for (var i = 0; i < 8; i++) g.push(((b[i * 2] << 8) | b[i * 2 + 1]).toString(16));
    return g.join(':');
  }

  /* parse the pieces we need out of an SDP; throws if anything is outside the simple data-channel shape */
  function parseSdp(sdp) {
    var lines = String(sdp).split(/\r?\n/), info = { ufrag: null, pwd: null, fp: null, cands: [] }, mlines = 0;
    lines.forEach(function (l) {
      var m;
      if (/^m=/.test(l)) { mlines++; if (!/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel/.test(l)) throw new Error('not a plain data-channel SDP'); }
      else if ((m = /^a=ice-ufrag:(\S+)$/.exec(l))) info.ufrag = m[1];
      else if ((m = /^a=ice-pwd:(\S+)$/.exec(l))) info.pwd = m[1];
      else if ((m = /^a=fingerprint:(\S+) (\S+)$/.exec(l))) {
        if (m[1].toLowerCase() !== 'sha-256') throw new Error('unsupported fingerprint');
        info.fp = hexToBytes(m[2].replace(/:/g, ''));
      } else if ((m = /^a=candidate:(\S+) (\d+) (\w+) (\d+) (\S+) (\d+) typ (\w+)/.exec(l))) {
        if (m[3].toLowerCase() !== 'udp') return; /* TCP candidates are dropped */
        if (m[2] !== '1') return;
        var typ = m[7], addr = m[5], port = parseInt(m[6], 10), c;
        if (typ !== 'host' && typ !== 'srflx') return; /* relay/prflx are not used */
        if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) c = { kind: 0, bytes: Uint8Array.from(addr.split('.').map(Number)) };
        else if (UUID_LOCAL.test(addr)) { var u = UUID_LOCAL.exec(addr); c = { kind: 2, bytes: hexToBytes(u.slice(1).join('')) }; }
        else if (addr.indexOf(':') >= 0) c = { kind: 1, bytes: ipv6ToBytes(addr) };
        else throw new Error('unsupported candidate address');
        c.port = port; c.srflx = typ === 'srflx';
        info.cands.push(c);
      }
    });
    if (mlines !== 1) throw new Error('expected exactly one media section');
    if (!info.ufrag || !info.pwd || !info.fp || info.fp.length !== 32) throw new Error('missing ICE or DTLS fields');
    if (info.ufrag.length > 255 || info.pwd.length > 255) throw new Error('ICE field too long');
    if (!info.cands.length) throw new Error('no usable candidates');
    if (info.cands.length > 20) info.cands.length = 20;
    return info;
  }

  function candText(c) {
    var addr = c.kind === 0 ? Array.prototype.join.call(c.bytes, '.')
      : c.kind === 1 ? bytesToIpv6(c.bytes)
      : (function () { var h = bytesToHex(c.bytes); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20) + '.local'; })();
    return addr;
  }

  /* role: 'offer' -> setup actpass; 'answer' -> setup active */
  function buildSdp(info, role) {
    var L = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + info.ufrag, 'a=ice-pwd:' + info.pwd, 'a=ice-options:trickle',
      'a=fingerprint:sha-256 ' + bytesToHex(info.fp).toUpperCase().match(/../g).join(':'),
      'a=setup:' + (role === 'offer' ? 'actpass' : 'active'), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144'];
    info.cands.forEach(function (c, i) {
      var prio = c.srflx ? 1677729535 - i : 2113937151 - i * 256;
      L.push('a=candidate:' + (i + 1) + ' 1 udp ' + prio + ' ' + candText(c) + ' ' + c.port + ' typ ' + (c.srflx ? 'srflx raddr 0.0.0.0 rport 0' : 'host') + ' generation 0');
    });
    L.push('a=end-of-candidates');
    return L.join('\r\n') + '\r\n';
  }

  function encodeBinary(kind, info) {
    var out = [(2 << 4) | (kind === 'a' ? 1 : 0)], i;
    function str(s) { out.push(s.length); for (var k = 0; k < s.length; k++) { var cc = s.charCodeAt(k); if (cc > 127) throw new Error('non-ascii ICE field'); out.push(cc); } }
    str(info.ufrag); str(info.pwd);
    for (i = 0; i < 32; i++) out.push(info.fp[i]);
    out.push(info.cands.length);
    info.cands.forEach(function (c) {
      out.push(c.kind | (c.srflx ? 4 : 0));
      for (var k = 0; k < c.bytes.length; k++) out.push(c.bytes[k]);
      out.push(c.port >> 8, c.port & 255);
    });
    var body = Uint8Array.from(out), crc = C.crc32(body) & 0xFFFF, res = new Uint8Array(body.length + 2);
    res.set(body, 0); res[body.length] = crc >> 8; res[body.length + 1] = crc & 255;
    return res;
  }
  function decodeBinary(buf) {
    if (buf.length < 40) throw new Error('code is too short');
    var body = buf.subarray(0, buf.length - 2), crc = (buf[buf.length - 2] << 8) | buf[buf.length - 1];
    if ((C.crc32(body) & 0xFFFF) !== crc) throw new Error('check digits do not match - a character was mistyped or the code is incomplete');
    var p = 0;
    if ((body[p] >> 4) !== 2) throw new Error('unknown code version');
    var kind = (body[p] & 1) ? 'a' : 'o'; p++;
    function str() { var n = body[p++], s = ''; for (var k = 0; k < n; k++) s += String.fromCharCode(body[p++]); return s; }
    var info = { ufrag: str(), pwd: str(), fp: body.slice(p, p + 32), cands: [] }; p += 32;
    var n = body[p++];
    for (var i = 0; i < n; i++) {
      var t = body[p++], k = t & 3, len = k === 0 ? 4 : 16;
      if (k === 3) throw new Error('bad candidate');
      var c = { kind: k, srflx: !!(t & 4), bytes: body.slice(p, p + len) }; p += len;
      c.port = (body[p] << 8) | body[p + 1]; p += 2;
      info.cands.push(c);
    }
    if (p !== body.length || !info.cands.length) throw new Error('code is damaged');
    return { kind: kind, info: info };
  }

  function b32encode(u8) {
    var s = '', bits = 0, acc = 0;
    for (var i = 0; i < u8.length; i++) {
      acc = (acc << 8) | u8[i]; bits += 8;
      while (bits >= 5) { s += ALPHA[(acc >>> (bits - 5)) & 31]; bits -= 5; }
      acc &= (1 << bits) - 1;
    }
    if (bits) s += ALPHA[(acc << (5 - bits)) & 31];
    return s;
  }
  function b32decode(str) {
    var out = [], bits = 0, acc = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === 'O') ch = '0'; else if (ch === 'I' || ch === 'L') ch = '1'; else if (ch === 'U') ch = 'V';
      var v = ALPHA.indexOf(ch);
      if (v < 0) throw new Error('the code contains the character "' + str[i] + '" which is not allowed');
      acc = (acc << 5) | v; bits += 5;
      if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
      acc &= (1 << bits) - 1;
    }
    return Uint8Array.from(out);
  }
  function group(s, n, sep) { return s.match(new RegExp('.{1,' + n + '}', 'g')).join(sep); }

  /* sdp -> display code. Throws if the SDP cannot be compacted. */
  function sdpToCode(kind, sdp) {
    var raw = b32encode(encodeBinary(kind, parseSdp(sdp)));
    return PREFIX + '-' + group(raw, 5, '-');
  }
  function isCode(text) { return String(text || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().indexOf(PREFIX) === 0 && !/^ITNLT1/i.test(String(text || '').trim()); }
  /* code -> {kind, sdp, info}. Accepts spaces, line breaks, lower case and look-alike characters. */
  function codeToSdp(text, expectKind) {
    var s = String(text || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (s.indexOf(PREFIX) !== 0) throw new Error('This is not a pairing code (it should start with ' + PREFIX + ').');
    var d = decodeBinary(b32decode(s.slice(PREFIX.length)));
    if (expectKind && d.kind !== expectKind) throw new Error(expectKind === 'o' ? 'That is the tablet\'s ANSWER code. The tablet needs the PC\'s code.' : 'That is the PC\'s code. The PC needs the tablet\'s ANSWER code.');
    return { kind: d.kind, info: d.info, sdp: buildSdp(d.info, d.kind === 'o' ? 'offer' : 'answer') };
  }
  function codeStats(code) { var n = String(code).length, chars = String(code).replace(/-/g, '').length; return { length: n, typeable: n <= 150, chars: chars }; }

  return { parseSdp: parseSdp, buildSdp: buildSdp, sdpToCode: sdpToCode, codeToSdp: codeToSdp, isCode: isCode, codeStats: codeStats, b32encode: b32encode, b32decode: b32decode };
});
