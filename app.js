/* ITN Link Test - page logic. No network requests, no storage. Synthetic random data only. */
(function () {
  'use strict';
  var C = window.LTCore, Q = window.LTQr;
  var VERSION = '1.0.0';
  var MB = C.MB, CHUNK = 16384, HIGH = 4 * MB, LOW = MB;
  var $ = function (id) { return document.getElementById(id); };
  var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var now = function () { return performance.now(); };
  var digest = function (u8) { return crypto.subtle.digest('SHA-256', u8); };
  var enc = new TextEncoder(), dec = new TextDecoder();

  /* ---------- results ---------- */
  var DEFS = [
    ['dev', 'Device report'], ['selftest', 'Hash + compression self-test'],
    ['link', 'Direct link (WebRTC)'], ['tp', 'Throughput + integrity'], ['file', 'File transfer'], ['resume', 'Drop and resume'],
    ['net', 'Same-network check'], ['usb', 'USB (WebUSB)'],
    ['fsdir', 'PC folder read/write (50 MB)'], ['opfs', 'Private storage (OPFS) speed'], ['dl', 'Download to Downloads'], ['pick', 'Read a file from the system picker'],
    ['canshare', 'Share a file out'], ['target', 'Share target (receive a shared file)'], ['tab', 'Tabs + database']
  ];
  var results = {}, extra = {};
  var rows = {};
  DEFS.forEach(function (d) { results[d[0]] = { status: 'NOT RUN', summary: '', details: [] }; });

  function buildRows() {
    document.querySelectorAll('[data-tests]').forEach(function (box) {
      box.getAttribute('data-tests').split(',').forEach(function (id) {
        var def = DEFS.filter(function (d) { return d[0] === id; })[0];
        var row = document.createElement('div'); row.className = 'trow';
        var h = document.createElement('h3'); h.textContent = def[1];
        var b = document.createElement('span'); b.className = 'badge pend'; b.textContent = 'NOT RUN';
        var s = document.createElement('p'); s.className = 'sum'; s.setAttribute('role', 'status');
        var m = document.createElement('p'); m.className = 'meaning';
        var d = document.createElement('pre'); d.className = 'det'; d.hidden = true;
        row.appendChild(h); row.appendChild(b); row.appendChild(s); row.appendChild(m); row.appendChild(d);
        box.appendChild(row);
        rows[id] = { badge: b, sum: s, mean: m, det: d };
      });
    });
  }
  function badgeClass(s) { return s === 'PASS' ? 'pass' : s === 'FAIL' ? 'fail' : s === 'NOT SUPPORTED' ? 'ns' : s === 'INFO' ? 'info' : 'pend'; }
  function setResult(id, status, summary, details) {
    var r = results[id]; r.status = status; r.summary = summary || ''; r.details = details || r.details || [];
    var row = rows[id];
    if (!row) return;
    row.badge.textContent = status; row.badge.className = 'badge ' + badgeClass(status);
    row.sum.textContent = r.summary;
    row.mean.textContent = status === 'NOT RUN' ? '' : 'What this means for ITN sync: ' + C.explain(id, status);
    row.det.textContent = r.details.join('\n'); row.det.hidden = !r.details.length;
  }
  function addDetail(id, line) { results[id].details.push(line); var row = rows[id]; if (row) { row.det.textContent = results[id].details.join('\n'); row.det.hidden = false; } }
  function soft(msg) { var e = new Error(msg); e.soft = true; return e; }
  function guard(fn, id) {
    return function () {
      return Promise.resolve().then(fn).catch(function (e) {
        var name = e && e.name ? e.name : 'Error';
        if (e && e.soft) { var row = rows[id]; if (row) row.sum.textContent = e.message; else $('scan-note').textContent = e.message; return; }
        if (name === 'AbortError' && id) { setResult(id, results[id].status === 'NOT RUN' ? 'NOT RUN' : results[id].status, 'Cancelled.', results[id].details); return; }
        if (id) setResult(id, 'FAIL', name + ': ' + (e && e.message ? e.message : e), results[id].details);
        else console.error(e);
      });
    };
  }
  function concat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }

  /* ---------- 1. device report ---------- */
  function has(path) {
    try { return path.split('.').reduce(function (o, k) { return o[k]; }, window) !== undefined; } catch (e) { return false; }
  }
  function mark(v) { return v ? 'yes' : 'NO'; }
  async function collectDevice() {
    var nav = navigator, L = [];
    var ua = nav.userAgent;
    L.push('User agent: ' + ua);
    L.push('Platform: ' + ((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '?') + (nav.userAgentData ? ', mobile=' + nav.userAgentData.mobile : ''));
    L.push('Screen: ' + screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x, viewport ' + innerWidth + 'x' + innerHeight);
    L.push('CPU threads: ' + (nav.hardwareConcurrency || '?') + ', memory hint: ' + (nav.deviceMemory ? nav.deviceMemory + ' GB' : 'n/a'));
    var secure = window.isSecureContext;
    L.push('Secure context: ' + mark(secure) + ' (' + location.protocol + (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? ' localhost' : '') + ')');
    var standalone = !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    L.push('Running as installed app (PWA): ' + mark(standalone));
    L.push('Online: ' + mark(nav.onLine));
    var cn = nav.connection;
    L.push('Network information: ' + (cn ? 'type=' + (cn.type || 'n/a') + ', effectiveType=' + (cn.effectiveType || 'n/a') + ', downlink=' + (cn.downlink || 'n/a') + ' Mbit/s, rtt=' + (cn.rtt || 'n/a') + ' ms, saveData=' + !!cn.saveData : 'API not available'));
    try {
      if (nav.storage && nav.storage.estimate) {
        var e = await nav.storage.estimate();
        L.push('Storage estimate: quota ' + C.formatBytes(e.quota || 0) + ', used ' + C.formatBytes(e.usage || 0));
        L.push('IndexedDB quota (same pool): ' + C.formatBytes(e.quota || 0));
      } else L.push('Storage estimate: not available');
      L.push('Persistent storage granted: ' + (nav.storage && nav.storage.persisted ? mark(await nav.storage.persisted()) : 'n/a'));
    } catch (err) { L.push('Storage estimate failed: ' + err.name); }
    var apis = [
      ['showDirectoryPicker', 'File System Access: showDirectoryPicker'], ['showSaveFilePicker', 'File System Access: showSaveFilePicker'], ['showOpenFilePicker', 'File System Access: showOpenFilePicker'],
      ['navigator.usb', 'WebUSB'], ['navigator.serial', 'WebSerial'], ['navigator.bluetooth', 'WebBluetooth'],
      ['RTCPeerConnection', 'WebRTC RTCPeerConnection'], ['RTCDataChannel', 'WebRTC data channels'], ['BroadcastChannel', 'BroadcastChannel'],
      ['navigator.share', 'Web Share'], ['indexedDB', 'IndexedDB'], ['serviceWorker', 'Service workers (in navigator)'],
      ['CompressionStream', 'CompressionStream'], ['DecompressionStream', 'DecompressionStream'], ['navigator.wakeLock', 'Wake Lock'],
      ['navigator.connection', 'Network Information'], ['BarcodeDetector', 'BarcodeDetector (QR scanning)'], ['crypto.subtle', 'Web Crypto (SHA-256)']
    ];
    var api = {};
    apis.forEach(function (a) {
      var ok = a[0] === 'serviceWorker' ? ('serviceWorker' in nav) : (a[0].indexOf('navigator.') === 0 ? (a[0].slice(10) in nav) : has(a[0]));
      api[a[0]] = ok; L.push('API ' + a[1] + ': ' + mark(ok));
    });
    var canShareFiles = false;
    try { canShareFiles = !!(nav.canShare && nav.canShare({ files: [new File(['x'], 't.txt', { type: 'text/plain' })] })); } catch (e2) { /* ignore */ }
    L.push('Web Share with files (canShare): ' + mark(canShareFiles));
    var opfs = false;
    try { opfs = !!(nav.storage && nav.storage.getDirectory); } catch (e3) { /* ignore */ }
    L.push('OPFS (private file storage): ' + mark(opfs));
    L.push('Web Share Target: needs the app installed (PWA); installed now: ' + mark(standalone));
    extra.device = { api: api, standalone: standalone, secure: secure };
    var ok = secure && api.RTCPeerConnection && api.indexedDB && api['crypto.subtle'];
    return { status: ok ? 'PASS' : 'FAIL', summary: ok ? 'Secure page with WebRTC, database and hashing available.' : 'Missing: ' + [!secure && 'secure context', !api.RTCPeerConnection && 'WebRTC', !api.indexedDB && 'IndexedDB', !api['crypto.subtle'] && 'Web Crypto'].filter(Boolean).join(', ') + '.', details: L };
  }
  var runDev = guard(async function () {
    setResult('dev', 'NOT RUN', 'Running...');
    var r = await collectDevice();
    setResult('dev', r.status, r.summary, r.details);
    return r;
  }, 'dev');

  /* ---------- self-test ---------- */
  var runSelftest = guard(async function () {
    if (!crypto.subtle) { setResult('selftest', 'NOT SUPPORTED', 'Web Crypto is not available (needs a secure page).'); return; }
    var L = [], ok = true;
    var abc = enc.encode('abc'), known = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    var js = C.sha256Hex(abc), nat = C.toHex(new Uint8Array(await digest(abc)));
    L.push('SHA-256("abc") JS = ' + (js === known ? 'ok' : 'WRONG') + ', native = ' + (nat === known ? 'ok' : 'WRONG')); ok = ok && js === known && nat === known;
    var buf = new Uint8Array(8 * MB); for (var i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
    var t = now(); var hj = C.sha256Hex(buf); var tj = now() - t;
    t = now(); var hn = C.toHex(new Uint8Array(await digest(buf))); var tn = now() - t;
    L.push('8 MB hash: JS ' + C.formatRate(8 * MB / (tj / 1000)) + ', native ' + C.formatRate(8 * MB / (Math.max(tn, 0.5) / 1000)) + ', agree = ' + (hj === hn)); ok = ok && hj === hn;
    var bh = new C.BlockHasher(digest); bh.update(buf);
    L.push('Block hash computed: ' + (await bh.finish()).slice(0, 12) + '...');
    if (window.CompressionStream) {
      var back = await decompress(await compress(buf.subarray(0, 100000)));
      var same = back.length === 100000 && C.sha256Hex(back) === C.sha256Hex(buf.subarray(0, 100000));
      L.push('Compression round trip: ' + (same ? 'ok' : 'FAILED')); ok = ok && same;
    } else L.push('Compression: not available (pairing text will be longer; still works)');
    var qr = Q.encode('ITNLT1:selftest', 'L'); L.push('QR encoder: version ' + qr.version + ' ok');
    setResult('selftest', ok ? 'PASS' : 'FAIL', ok ? 'All checks passed.' : 'A check failed.', L);
  }, 'selftest');

  /* ---------- compression ---------- */
  async function compress(u8) {
    if (!window.CompressionStream) return concat(new Uint8Array([0]), u8);
    var out = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return concat(new Uint8Array([1]), out);
  }
  async function decompress(u8) {
    if (u8[0] === 0) return u8.subarray(1);
    if (!window.DecompressionStream) throw new Error('This browser cannot read compressed pairing text');
    return new Uint8Array(await new Response(new Blob([u8.subarray(1)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  async function toSignalText(kind, sdp) { return C.packSignal(kind, await compress(enc.encode(sdp))); }
  async function fromSignalText(text, kind) {
    var u;
    try { u = C.unpackSignal(text); } catch (e) { throw soft(e.message); }
    if (u.kind !== kind) throw soft(kind === 'o' ? 'That is an ANSWER text. Device B needs the OFFER from device A.' : 'That is an OFFER text. Device A needs the ANSWER from device B.');
    return dec.decode(await decompress(u.bytes));
  }

  /* ---------- 2. WebRTC ---------- */
  var S = { pc: null, dc: null, role: null, rx: null, tx: null, partial: null, peerNet: null, localNet: null, rtts: [], pairWatch: null };
  var tpStats = { sent: null, recv: null };

  function newPc() {
    closeLink(true);
    var servers = $('stun').checked ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
    var pc = new RTCPeerConnection({ iceServers: servers });
    S.pc = pc;
    pc.onconnectionstatechange = function () { showState(); if (pc.connectionState === 'failed') linkFailed('The connection state became "failed".'); };
    pc.oniceconnectionstatechange = showState;
    return pc;
  }
  function gather(pc) {
    return new Promise(function (res) {
      if (pc.iceGatheringState === 'complete') return res();
      var t = setTimeout(res, $('stun').checked ? 9000 : 5000);
      pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  function showState() {
    var pc = S.pc, dc = S.dc;
    $('link-state').textContent = !pc ? 'Not connected.' : 'Connection: ' + pc.connectionState + ', ICE: ' + pc.iceConnectionState + (dc ? ', data channel: ' + dc.readyState : '');
  }
  function closeLink(quiet) {
    try { if (S.dc) S.dc.close(); } catch (e) { /* ignore */ }
    try { if (S.pc) S.pc.close(); } catch (e) { /* ignore */ }
    clearInterval(S.pairWatch);
    S.dc = null; S.pc = null; S.peerNet = null;
    if (!quiet) showState();
  }
  function linkFailed(msg) {
    if (results.link.status === 'PASS') return;
    setResult('link', 'FAIL', 'No direct link. ' + msg + ' Often Wi-Fi client isolation or a firewall; try USB tethering / hotspot (section 3).', results.link.details);
  }
  function waitOpen(timeoutMs) {
    clearTimeout(S.openTimer);
    S.openTimer = setTimeout(function () { if (!S.dc || S.dc.readyState !== 'open') linkFailed('Nothing connected within ' + (timeoutMs / 1000) + ' seconds.'); }, timeoutMs);
  }
  function setupDc(dc) {
    S.dc = dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = LOW;
    dc.onopen = function () { showState(); onOpen(); };
    dc.onclose = function () { showState(); if (S.rx && S.rx.kind === 'file') interruptedRx('The link closed during the transfer.'); };
    dc.onerror = function () { showState(); };
    dc.onmessage = function (ev) { onMessage(ev.data); };
    showState();
  }
  function send(obj) { if (S.dc && S.dc.readyState === 'open') S.dc.send(JSON.stringify(obj)); else throw soft('The link is not open. Pair the devices first.'); }

  async function pairInfo() {
    var pc = S.pc; if (!pc) return null;
    var st = await pc.getStats(), pair = null;
    st.forEach(function (r) { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
    if (!pair) st.forEach(function (r) { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if (!pair) return null;
    var l = st.get(pair.localCandidateId) || {}, rm = st.get(pair.remoteCandidateId) || {};
    return { local: l.candidateType || '?', remote: rm.candidateType || '?', proto: l.protocol || '?', rtt: pair.currentRoundTripTime };
  }
  async function onOpen() {
    clearTimeout(S.openTimer);
    var info = await pairInfo();
    var kinds = info ? 'local ' + info.local + ' / remote ' + info.remote + ' (' + info.proto + ')' : 'candidate type unknown';
    var typeNote = info && (info.local === 'relay' || info.remote === 'relay') ? 'relay (traffic goes through a server!)' : info && (info.local === 'srflx' || info.remote === 'srflx') ? 'srflx (found through STUN)' : 'host (direct, local)';
    $('link-info').textContent = 'Candidate type used: ' + typeNote + ' - ' + kinds + '.';
    setResult('link', 'PASS', 'Connected. Candidate type used: ' + typeNote + '.', ['Candidates: ' + kinds, 'Network chosen by you: ' + $('network').value, 'Role: ' + (S.role === 'A' ? 'offerer (A)' : 'answerer (B)')]);
    runPing();
    try { send({ t: 'net', subnets: S.localNet ? S.localNet.subnets : [], mdns: S.localNet ? S.localNet.mdns : 0 }); } catch (e) { /* ignore */ }
    updateNet();
  }

  var makeOffer = guard(async function () {
    if (!window.RTCPeerConnection) { setResult('link', 'NOT SUPPORTED', 'This browser has no WebRTC.'); return; }
    setResult('link', 'NOT RUN', 'Making the offer...');
    var pc = newPc(); S.role = 'A';
    setupDc(pc.createDataChannel('lt', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gather(pc);
    var text = await toSignalText('o', pc.localDescription.sdp);
    $('a-offer').value = text; showQr('a-qr', text);
    setResult('link', 'NOT RUN', 'Offer ready. Give it to device B (scan the QR or copy the text), then paste B\'s answer here.');
    waitOpen(120000);
  }, 'link');
  var makeAnswer = guard(async function () {
    if (!window.RTCPeerConnection) { setResult('link', 'NOT SUPPORTED', 'This browser has no WebRTC.'); return; }
    var sdp = await fromSignalText($('b-offer').value, 'o');
    setResult('link', 'NOT RUN', 'Making the answer...');
    var pc = newPc(); S.role = 'B';
    pc.ondatachannel = function (e) { setupDc(e.channel); };
    await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gather(pc);
    var text = await toSignalText('a', pc.localDescription.sdp);
    $('b-answer').value = text; showQr('b-qr', text);
    setResult('link', 'NOT RUN', 'Answer ready. Show it to device A (scan the QR or copy the text). The link opens when A has used it.');
    waitOpen(120000);
  }, 'link');
  var acceptAnswer = guard(async function () {
    if (!S.pc || S.role !== 'A') throw soft('First make an offer on this device (A).');
    var sdp = await fromSignalText($('a-answer').value, 'a');
    await S.pc.setRemoteDescription({ type: 'answer', sdp: sdp });
    setResult('link', 'NOT RUN', 'Connecting...');
    waitOpen(30000);
  }, 'link');
  function showQr(canvasId, text) {
    var cv = $(canvasId);
    try {
      var qr = Q.encode(text, 'L');
      Q.drawToCanvas(cv, qr, Math.max(2, Math.floor(420 / (qr.size + 8))), 4); cv.hidden = false;
    } catch (e) { cv.hidden = true; $('scan-note').textContent = 'The text is too long for a QR code on this browser (' + e.message + ') - use copy/paste.'; }
  }
  function copyText(id, noteId) {
    var el = $(id); el.select();
    var done = function () { $('scan-note').textContent = 'Copied.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(done, function () { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  }

  /* QR scanning */
  var scan = { stream: null, timer: null };
  function stopScan() { clearInterval(scan.timer); if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); }); scan.stream = null; $('scan-video').hidden = true; $('scan-video').srcObject = null; }
  var startScan = function (onText) {
    return guard(async function () {
      if (!('BarcodeDetector' in window)) { $('scan-note').textContent = 'This browser cannot scan QR codes (no BarcodeDetector). Use the text boxes instead.'; return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('scan-note').textContent = 'No camera access from this page. Use the text boxes.'; return; }
      stopScan();
      var det = new BarcodeDetector({ formats: ['qr_code'] });
      scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      var v = $('scan-video'); v.srcObject = scan.stream; v.hidden = false; await v.play();
      $('scan-note').textContent = 'Point the camera at the QR code...';
      var busy = false;
      scan.timer = setInterval(async function () {
        if (busy) return; busy = true;
        try { var found = await det.detect(v); if (found.length) { var txt = found[0].rawValue; stopScan(); $('scan-note').textContent = 'QR read.'; onText(txt); } } catch (e) { /* keep trying */ }
        busy = false;
      }, 300);
    }, null);
  };
  var scanAnswer = startScan(function (t) { $('a-answer').value = t; acceptAnswer(); });
  var scanOffer = startScan(function (t) { $('b-offer').value = t; makeAnswer(); });

  /* ---------- messages ---------- */
  function onMessage(data) {
    if (typeof data !== 'string') return onBinary(data);
    var m; try { m = JSON.parse(data); } catch (e) { return; }
    var h = HANDLERS[m.t]; if (h) Promise.resolve(h(m)).catch(function (e) { console.error(e); });
  }
  function onBinary(buf) {
    var rx = S.rx; if (!rx) return;
    var u8 = new Uint8Array(buf);
    rx.got += u8.length;
    if (rx.kind === 'tp') rx.hasher.update(u8); else rx.chunks.push(buf);
    var t = now();
    if (t - rx.lastUi > 120) { rx.lastUi = t; rx.ui(rx); }
  }
  var HANDLERS = {
    ping: function (m) { send({ t: 'pong', n: m.n, ts: m.ts }); },
    pong: function (m) { if (S.pingWait) S.pingWait(m); },
    net: function (m) { S.peerNet = m; updateNet(); },
    'tp-pull': function (m) { return sendRandom(m.mb); },
    'tp-start': function (m) {
      S.rx = { kind: 'tp', id: m.id, total: m.total, got: 0, t0: now(), lastUi: 0, hasher: new C.BlockHasher(digest), ui: function (r) { showProgress('tp-recv', r.got, r.total, now() - r.t0); } };
      showProgress('tp-recv', 0, m.total, 1);
    },
    'tp-end': async function (m) {
      var rx = S.rx; if (!rx || rx.id !== m.id) return;
      var ms = now() - rx.t0, hex = await rx.hasher.finish();
      var ok = C.hashesMatch(hex, m.sha) && rx.got === rx.total;
      S.rx = null; showProgress('tp-recv', rx.got, rx.total, ms);
      var rate = rx.got / (ms / 1000);
      $('tp-recv-txt').textContent = (ok ? 'Done: ' : 'MISMATCH: ') + C.formatBytes(rx.got) + ' in ' + C.formatDuration(ms / 1000) + ' = ' + C.formatRate(rate) + ', hash ' + (ok ? 'matches' : 'DOES NOT MATCH') + '.';
      tpStats.recv = { ok: ok, rate: rate, bytes: rx.got };
      tpDone();
      send({ t: 'tp-result', id: m.id, ok: ok, bytes: rx.got, ms: ms });
    },
    'tp-result': function (m) {
      if (S.tx && S.tx.id === m.id) {
        var rate = m.bytes / (m.ms / 1000);
        $('tp-send-txt').textContent = (m.ok ? 'Delivered and verified: ' : 'FAILED verification: ') + C.formatBytes(m.bytes) + ' at ' + C.formatRate(rate) + ' (measured by the receiver).';
        tpStats.sent = { ok: m.ok, rate: rate, bytes: m.bytes }; S.tx = null; tpDone();
      }
    },
    'f-start': function (m) {
      S.rx = { kind: 'file', id: m.id, name: m.name, size: m.size, sha: m.sha, got: 0, chunks: [], t0: now(), lastUi: 0, ui: function (r) { showProgress('f', r.got, r.size, now() - r.t0); } };
      S.partial = S.rx; $('f-save-wrap').hidden = true;
      setResult('file', 'NOT RUN', 'Receiving ' + m.name + ' (' + C.formatBytes(m.size) + ')...');
    },
    'f-end': async function (m) { await finishFileRx(m); },
    'f-drop': function () { interruptedRx('The sender stopped the transfer (simulated drop).'); },
    'f-resume': async function (m) {
      var f = $('f-pick').files[0];
      var r = C.resumeOffset(f ? { name: f.name, size: f.size } : null, m);
      if (!r.ok) { send({ t: 'f-resume-no', why: r.reason }); return; }
      send({ t: 'f-resume-ok', id: m.id, offset: r.offset });
      await sendFile(f, r.offset, m.id, true);
    },
    'f-resume-ok': function (m) { if (S.partial && S.partial.id === m.id) { S.rx = S.partial; S.rx.t0 = now() - 1; S.rx.base = S.rx.got; S.rx.resumed = true; } },
    'f-resume-no': function (m) { setResult('resume', 'FAIL', 'The sender could not resume: ' + m.why + '.'); }
  };
  function tpDone() {
    var a = tpStats.sent, b = tpStats.recv, L = [];
    if (a) L.push('Sent: ' + C.formatBytes(a.bytes) + ' at ' + C.formatRate(a.rate) + ' - ' + (a.ok ? 'hash OK' : 'HASH MISMATCH'));
    if (b) L.push('Received: ' + C.formatBytes(b.bytes) + ' at ' + C.formatRate(b.rate) + ' - ' + (b.ok ? 'hash OK' : 'HASH MISMATCH'));
    var bad = (a && !a.ok) || (b && !b.ok);
    setResult('tp', bad ? 'FAIL' : 'PASS', bad ? 'Integrity check failed.' : 'Data arrived intact. ' + L.join('; '), L);
  }
  function showProgress(prefix, done, total, ms) {
    var p = C.progressStats({ done: done, total: total, elapsedMs: ms });
    $(prefix + (prefix === 'tp-recv' || prefix === 'tp-send' ? '-bar' : '-bar')).value = p.pct;
    $(prefix + '-txt').textContent = Math.round(p.pct) + '% - ' + C.formatBytes(done) + ' of ' + C.formatBytes(total) + ' - ' + C.formatRate(p.rate) + ' - about ' + (isFinite(p.etaSec) ? C.formatDuration(p.etaSec) : '?') + ' left';
  }

  /* round-trip time */
  var runPing = guard(async function () {
    try { await pingOnce(); } catch (e) { addDetail('link', 'Round-trip measurement failed: ' + e.message); }
  }, null);
  async function pingOnce() {
    var vals = [];
    for (var i = 0; i < 10; i++) {
      var t = now();
      await new Promise(function (res, rej) {
        var to = setTimeout(function () { S.pingWait = null; rej(new Error('no reply from the other device')); }, 3000);
        S.pingWait = function () { clearTimeout(to); S.pingWait = null; res(); };
        send({ t: 'ping', n: i, ts: t });
      });
      vals.push(now() - t);
      await delay(40);
    }
    vals.sort(function (a, b) { return a - b; });
    var med = vals[Math.floor(vals.length / 2)], info = await pairInfo();
    var line = 'Round-trip time: median ' + med.toFixed(1) + ' ms (min ' + vals[0].toFixed(1) + ', max ' + vals[vals.length - 1].toFixed(1) + ')' + (info && info.rtt ? '; ICE reports ' + (info.rtt * 1000).toFixed(0) + ' ms' : '');
    $('link-info').textContent = $('link-info').textContent.split(' Round-trip')[0] + ' ' + line;
    addDetail('link', line);
  }

  /* back-pressure send loop */
  function waitLow(dc) {
    return new Promise(function (res, rej) {
      var on = function () { off(); res(); }, cl = function () { off(); rej(new Error('The link closed while sending.')); };
      var off = function () { dc.removeEventListener('bufferedamountlow', on); dc.removeEventListener('close', cl); };
      dc.addEventListener('bufferedamountlow', on); dc.addEventListener('close', cl);
    });
  }
  async function pump(total, from, getChunk, onProgress, ctl) {
    var dc = S.dc, t0 = now(), lastUi = 0, sent = from;
    dc.bufferedAmountLowThreshold = LOW;
    while (sent < total) {
      if (ctl && ctl.abort) return sent;
      if (!dc || dc.readyState !== 'open') throw new Error('The link closed while sending.');
      if (dc.bufferedAmount >= HIGH) { await waitLow(dc); continue; }
      var n = Math.min(CHUNK, total - sent), chunk = await getChunk(sent, n);
      dc.send(chunk); sent += n;
      var t = now();
      if (t - lastUi > 120) { lastUi = t; onProgress(sent, t - t0); await delay(0); }
    }
    if (dc.bufferedAmount > 0 && dc.readyState === 'open') { dc.bufferedAmountLowThreshold = 0; await waitLow(dc).catch(function () { }); dc.bufferedAmountLowThreshold = LOW; }
    onProgress(sent, now() - t0);
    return sent;
  }

  var busy = false;
  async function sendRandom(mb) {
    if (busy) throw soft('Another transfer is running.');
    busy = true;
    try {
      var total = mb * MB, id = Math.random().toString(36).slice(2);
      var pool = new Uint8Array(MB); for (var i = 0; i < MB; i += 65536) crypto.getRandomValues(pool.subarray(i, i + 65536));
      var hasher = new C.BlockHasher(digest), n = 0;
      S.tx = { id: id }; tpStats.sent = null;
      send({ t: 'tp-start', id: id, total: total });
      var t0 = now();
      await pump(total, 0, function (off, len) {
        var o = (n++ * 4099) % (MB - CHUNK), view = pool.subarray(o, o + len);
        hasher.update(view); return view;
      }, function (sent, ms) { showProgress('tp-send', sent, total, ms); }, null);
      var sha = await hasher.finish();
      send({ t: 'tp-end', id: id, sha: sha });
      $('tp-send-txt').textContent = 'Sent ' + C.formatBytes(total) + ' in ' + C.formatDuration((now() - t0) / 1000) + '. Waiting for the other device to verify...';
    } finally { busy = false; }
  }
  var tpSend = guard(function () { return sendRandom(parseInt($('tp-mb').value, 10)); }, 'tp');
  var tpPull = guard(function () { send({ t: 'tp-pull', mb: parseInt($('tp-mb').value, 10) }); $('tp-recv-txt').textContent = 'Asked the other device to send...'; }, 'tp');

  /* files */
  async function hashFile(file, onProg) {
    var h = new C.Sha256(), off = 0, step = 4 * MB, t0 = now();
    while (off < file.size) {
      h.update(new Uint8Array(await file.slice(off, off + step).arrayBuffer())); off += step;
      onProg(Math.min(off, file.size), now() - t0); await delay(0);
    }
    return h.hex();
  }
  var fileCtl = { abort: false };
  async function sendFile(file, from, id, isResume) {
    if (busy && !isResume) throw soft('Another transfer is running.');
    busy = true; fileCtl.abort = false;
    try {
      var sha;
      if (!isResume) {
        $('f-txt').textContent = 'Hashing the file first...';
        sha = await hashFile(file, function (d) { $('f-bar').value = d / file.size * 100; $('f-txt').textContent = 'Hashing the file first: ' + Math.round(d / file.size * 100) + '%'; });
        id = Math.random().toString(36).slice(2);
        S.txFile = { id: id, sha: sha, name: file.name, size: file.size };
        send({ t: 'f-start', id: id, name: file.name, size: file.size, sha: sha });
      } else sha = S.txFile && S.txFile.sha;
      var bs = -1, block = null;
      var sent = await pump(file.size, from, async function (off, len) {
        if (!block || off < bs || off + len > bs + block.length) { bs = off; block = new Uint8Array(await file.slice(off, Math.min(file.size, off + MB)).arrayBuffer()); }
        return block.subarray(off - bs, off - bs + len);
      }, function (s, ms) { showProgress('f', s, file.size, ms); }, fileCtl);
      if (fileCtl.abort) { try { send({ t: 'f-drop' }); } catch (e) { /* ignore */ } $('f-txt').textContent = 'Dropped at ' + C.formatBytes(sent) + ' (simulated). Press Resume on the receiving device.'; return; }
      if (!sha) sha = await hashFile(file, function () { });
      send({ t: 'f-end', id: id, sha: sha });
      $('f-txt').textContent = 'File sent (' + C.formatBytes(file.size) + '). The receiver is verifying it.';
    } finally { busy = false; }
  }
  var fSend = guard(function () {
    var f = $('f-pick').files[0]; if (!f) throw soft('Choose a file first.');
    if (f.size > 500 * MB) throw soft('Choose a file under about 500 MB (the receiving page keeps it in memory).');
    return sendFile(f, 0, null, false);
  }, 'file');
  function interruptedRx(why) {
    var rx = S.rx; if (!rx || rx.kind !== 'file') return;
    S.partial = rx; S.rx = null;
    $('f-txt').textContent = why + ' Received ' + C.formatBytes(rx.got) + ' of ' + C.formatBytes(rx.size) + '. Press Resume when the link is open again.';
    setResult('resume', 'NOT RUN', 'Interrupted at ' + C.formatBytes(rx.got) + '. Press "Resume" on this (receiving) device.');
  }
  var fResume = guard(function () {
    var p = S.partial; if (!p) throw soft('Nothing to resume on this device. (Resume is pressed on the receiving device.)');
    send({ t: 'f-resume', id: p.id, name: p.name, size: p.size, have: p.got });
    setResult('resume', 'NOT RUN', 'Asked the sender to continue from ' + C.formatBytes(p.got) + '...');
  }, 'resume');
  var fDrop = guard(function () { fileCtl.abort = true; }, null);
  async function finishFileRx(m) {
    var rx = S.rx; if (!rx || rx.id !== m.id) return;
    var ms = now() - rx.t0, resumed = !!rx.resumed;
    $('f-txt').textContent = 'Received; checking SHA-256...';
    var blob = new Blob(rx.chunks), h = new C.Sha256(), off = 0;
    while (off < blob.size) { h.update(new Uint8Array(await blob.slice(off, off + 4 * MB).arrayBuffer())); off += 4 * MB; await delay(0); }
    var hex = h.hex(), ok = C.hashesMatch(hex, rx.sha) && blob.size === rx.size;
    S.rx = null; S.partial = ok ? null : S.partial;
    showProgress('f', rx.got, rx.size, ms);
    var line = (ok ? 'Hash matches: ' : 'HASH DOES NOT MATCH: ') + rx.name + ', ' + C.formatBytes(blob.size) + ', SHA-256 ' + hex.slice(0, 16) + '...';
    $('f-txt').textContent = line;
    setResult('file', ok ? 'PASS' : 'FAIL', line, ['Receive time ' + C.formatDuration(ms / 1000) + ' (' + C.formatRate((rx.got - (rx.base || 0)) / (ms / 1000)) + (resumed ? ', resumed transfer' : '') + ')']);
    if (resumed) setResult('resume', ok ? 'PASS' : 'FAIL', ok ? 'Transfer was interrupted and resumed; the hash still matches.' : 'Resumed transfer did not match.', []);
    if (ok) {
      if ($('f-save')._url) URL.revokeObjectURL($('f-save')._url);
      var url = URL.createObjectURL(blob); $('f-save')._url = url; $('f-save').href = url;
      $('f-save').download = rx.name.replace(/[\\/:*?"<>|]/g, '_'); $('f-save-wrap').hidden = false;
    }
  }

  /* ---------- 3. same network ---------- */
  var runNet = guard(async function () {
    if (!window.RTCPeerConnection) { setResult('net', 'NOT SUPPORTED', 'No WebRTC.'); return; }
    var pc = new RTCPeerConnection({ iceServers: [] }), cands = [];
    pc.createDataChannel('probe');
    pc.onicecandidate = function (e) { if (e.candidate) { var c = C.parseCandidate(e.candidate.candidate); if (c) cands.push(c); } };
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([gather(pc), delay(3000)]);
    pc.close();
    var subnets = [], mdns = 0, v6 = 0;
    cands.forEach(function (c) { if (c.addrKind === 'mdns') mdns++; else if (c.addrKind === 'ipv6') v6++; else { var s = C.subnet24(c.address); if (s && subnets.indexOf(s) < 0) subnets.push(s); } });
    S.localNet = { subnets: subnets, mdns: mdns, v6: v6, count: cands.length };
    var L = ['Local candidates found: ' + cands.length + ' (real IPv4: ' + subnets.length + ' network(s), hidden .local names: ' + mdns + ', IPv6: ' + v6 + ')',
      mdns ? 'The browser hides real addresses behind .local names (normal and good for privacy). The other device must be able to resolve them (mDNS); some corporate networks block that.' : 'The browser exposed real addresses.',
      'You can not type an IP into this page: a secure (https) page is not allowed to call a plain-http address on your network, and the app does not scan your network.'];
    if (!cands.length) L.push('No local candidates at all: WebRTC may be restricted by policy on this browser.');
    setResult('net', cands.length ? 'INFO' : 'FAIL', cands.length ? 'Listed what this browser exposes. Open the link in section 2 to compare both devices.' : 'This browser produced no local candidates.', L);
    updateNet();
  }, 'net');
  function updateNet() {
    if (results.net.status === 'NOT RUN' && !S.localNet) return;
    var mine = S.localNet, peer = S.peerNet, linkOk = results.link.status === 'PASS';
    var L = results.net.details.slice(0, 3);
    if (peer && mine) {
      if (mine.subnets.length && peer.subnets.length) {
        var same = C.sameSubnet(mine.subnets, peer.subnets);
        L.push('Both devices expose real addresses: ' + (same ? 'same /24 network' : 'DIFFERENT networks'));
        setResult('net', same ? 'PASS' : (linkOk ? 'PASS' : 'FAIL'), same ? 'Both devices are on the same network.' : (linkOk ? 'Networks differ yet the link worked (probably routed).' : 'The devices appear to be on different networks.'), L);
        return;
      }
      L.push('Addresses are hidden on at least one device, so networks cannot be compared. ' + (linkOk ? 'The direct link works, which proves they can reach each other.' : 'Open a link in section 2 to prove reachability.'));
      setResult('net', linkOk ? 'PASS' : 'INFO', linkOk ? 'The devices reach each other (link works).' : results.net.summary, L);
    }
  }

  /* ---------- 4. USB ---------- */
  var runUsb = guard(async function () {
    if (!navigator.usb) { setResult('usb', 'NOT SUPPORTED', 'This browser has no WebUSB.'); return; }
    var L = [], known = await navigator.usb.getDevices();
    L.push('Devices this page already has permission for: ' + known.length);
    var dev = null;
    try { dev = await navigator.usb.requestDevice({ filters: [] }); }
    catch (e) {
      L.push('Chooser result: ' + e.name + ': ' + e.message);
      setResult('usb', 'FAIL', e.name === 'NotFoundError' ? 'No device was chosen, or the browser listed none (normal for a tablet in file-transfer mode).' : e.name + ': ' + e.message, L); return;
    }
    L.push('Chosen device: vendor 0x' + dev.vendorId.toString(16) + ', product 0x' + dev.productId.toString(16) + ', name ' + (dev.productName || '(none)') + ', device class 0x' + (dev.deviceClass || 0).toString(16));
    (dev.configurations || []).forEach(function (cfg) { cfg.interfaces.forEach(function (itf) { itf.alternates.forEach(function (a) { L.push('  interface ' + itf.interfaceNumber + ': class 0x' + a.interfaceClass.toString(16) + ' subclass 0x' + a.interfaceSubclass.toString(16) + ' protocol 0x' + a.interfaceProtocol.toString(16)); }); }); });
    L.push('Class reference: 0x06 = still image/PTP, 0xFF = vendor specific (ADB and some MTP use this), 0x08 = mass storage.');
    L.push('This app did NOT open the device or change anything.');
    setResult('usb', 'PASS', 'The browser can see 1 device. It was only listed, not opened.', L);
  }, 'usb');

  /* ---------- 5. file system ---------- */
  function makeBlock(i) { var b = new Uint8Array(MB); for (var k = 0; k < MB; k += 65536) crypto.getRandomValues(b.subarray(k, k + 65536)); b[0] = i & 255; b[1] = (i >> 8) & 255; return b; }
  async function writeReadTest(dir, id, label) {
    var name = 'itn-linktest-50mb.bin', L = [], N = 50;
    var hw = new C.BlockHasher(digest);
    var fh = await dir.getFileHandle(name, { create: true });
    var t = now(), w = await fh.createWritable();
    for (var i = 0; i < N; i++) { var b = makeBlock(i); hw.update(b); await w.write(b); }
    await w.close(); var tw = now() - t;
    var file = await fh.getFile(); t = now();
    var hr = new C.BlockHasher(digest), off = 0;
    while (off < file.size) { hr.update(new Uint8Array(await file.slice(off, off + 4 * MB).arrayBuffer())); off += 4 * MB; }
    var tr = now() - t;
    var ok = file.size === N * MB && C.hashesMatch(await hw.finish(), await hr.finish());
    t = now(); await dir.removeEntry(name); var td = now() - t;
    L.push('Create + write 50 MB: ' + C.formatDuration(tw / 1000) + ' (' + C.formatRate(N * MB / (tw / 1000)) + ')');
    L.push('Read back 50 MB: ' + C.formatDuration(tr / 1000) + ' (' + C.formatRate(N * MB / (tr / 1000)) + ')');
    L.push('Delete: ' + td.toFixed(0) + ' ms; content ' + (ok ? 'verified' : 'DID NOT MATCH'));
    setResult(id, ok ? 'PASS' : 'FAIL', label + ': write ' + C.formatRate(N * MB / (tw / 1000)) + ', read ' + C.formatRate(N * MB / (tr / 1000)) + '.', L);
  }
  var runFsdir = guard(async function () {
    if (!window.showDirectoryPicker) { setResult('fsdir', 'NOT SUPPORTED', 'No folder picker in this browser.'); return; }
    var dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    setResult('fsdir', 'NOT RUN', 'Testing...');
    await writeReadTest(dir, 'fsdir', 'Folder');
  }, 'fsdir');
  var runOpfs = guard(async function () {
    if (!(navigator.storage && navigator.storage.getDirectory)) { setResult('opfs', 'NOT SUPPORTED', 'No private file storage (OPFS).'); return; }
    var root = await navigator.storage.getDirectory();
    setResult('opfs', 'NOT RUN', 'Testing...');
    var fh = await root.getFileHandle('probe', { create: true }); if (!fh.createWritable) { setResult('opfs', 'NOT SUPPORTED', 'createWritable is missing here.'); return; }
    await root.removeEntry('probe');
    await writeReadTest(root, 'opfs', 'Private storage');
  }, 'opfs');
  var runDl = guard(async function () {
    var t = now(), parts = []; for (var i = 0; i < 50; i++) parts.push(makeBlock(i));
    var blob = new Blob(parts, { type: 'application/octet-stream' }), tg = now() - t;
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'itn-linktest-50mb.bin'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 120000);
    setResult('dl', 'PASS', 'Generated 50 MB in ' + C.formatDuration(tg / 1000) + ' and asked the browser to save itn-linktest-50mb.bin. Check the Downloads folder (and delete the file afterwards).', ['Generation time ' + tg.toFixed(0) + ' ms. Whether the file really landed can only be checked by looking in Downloads.']);
  }, 'dl');
  var pickCtl = { cancel: false };
  var runPick = guard(async function () {
    var f = $('pick-file').files[0]; if (!f) throw soft('Choose a file first.');
    pickCtl.cancel = false;
    var step = 4 * MB, off = 0, t0 = now(), last = now(), worst = 0, L = [], stalled = false;
    var watch = setInterval(function () { var s = (now() - last) / 1000; if (s > 8) { stalled = true; $('pick-txt').textContent = 'No data for ' + Math.round(s) + ' s - the file may be a cloud placeholder being downloaded...'; } }, 1000);
    try {
      while (off < f.size && !pickCtl.cancel) {
        var t = now(); await f.slice(off, off + step).arrayBuffer(); var dt = now() - t; worst = Math.max(worst, dt);
        off += step; last = now(); var d = Math.min(off, f.size);
        showProgress('pick', d, f.size, now() - t0);
      }
    } finally { clearInterval(watch); }
    var ms = now() - t0, done = Math.min(off, f.size);
    if (pickCtl.cancel) { setResult('pick', 'NOT RUN', 'Cancelled at ' + C.formatBytes(done) + '.'); return; }
    L.push('File: ' + C.formatBytes(f.size) + ' read in ' + C.formatDuration(ms / 1000) + ' = ' + C.formatRate(f.size / (ms / 1000)));
    L.push('Slowest 4 MB slice: ' + (worst / 1000).toFixed(2) + ' s' + (stalled ? '; there was a stall of 8 s or more' : ''));
    setResult('pick', 'PASS', 'Read the whole file at ' + C.formatRate(f.size / (ms / 1000)) + (stalled ? ' (with a stall)' : '') + '.', L);
  }, 'pick');

  /* ---------- 6. share ---------- */
  function testFile() { return new File([new Uint8Array(2048)], 'itn-linktest.txt', { type: 'text/plain' }); }
  var runCanShare = guard(async function () {
    if (!navigator.share || !navigator.canShare) { setResult('canshare', 'NOT SUPPORTED', 'navigator.share / canShare is missing.'); return; }
    var ok = navigator.canShare({ files: [testFile()] });
    setResult('canshare', ok ? 'PASS' : 'FAIL', ok ? 'The browser says it can share files. Press "Share a small test file" to really try.' : 'The browser refuses file sharing here.', []);
  }, 'canshare');
  var runShare = guard(async function () {
    if (!navigator.share) { setResult('canshare', 'NOT SUPPORTED', 'navigator.share is missing.'); return; }
    var f = testFile();
    if (navigator.canShare && !navigator.canShare({ files: [f] })) { setResult('canshare', 'FAIL', 'The browser refuses file sharing here.'); return; }
    try { await navigator.share({ files: [f], title: 'ITN Link Test file' }); setResult('canshare', 'PASS', 'The share sheet opened and accepted the test file.', ['You chose a target; the file was tiny synthetic data.']); }
    catch (e) { if (e.name === 'AbortError') { addDetail('canshare', 'Share sheet cancelled by you.'); return; } throw e; }
  }, 'canshare');
  async function checkShared() {
    if (location.search.indexOf('shared=1') < 0 || !window.caches) return;
    try {
      var c = await caches.open('lt-share'), r = await c.match('shared-meta');
      if (r) {
        var m = await r.json(); await caches.delete('lt-share');
        var L = ['Received ' + m.files.length + ' file(s), title length ' + m.titleLen + ', text length ' + m.textLen];
        m.files.forEach(function (f) { L.push(f.name + ' | ' + (f.type || 'unknown type') + ' | ' + C.formatBytes(f.size) + ' | SHA-256 ' + f.sha.slice(0, 16) + '... | read in ' + f.ms + ' ms'); });
        setResult('target', m.files.length ? 'PASS' : 'INFO', m.files.length ? 'A shared file arrived through the share target.' : 'A share arrived with text only and no file.', L);
      }
    } catch (e) { setResult('target', 'FAIL', 'Could not read the received share: ' + e.name); }
    history.replaceState(null, '', location.pathname);
  }
  async function initShareTarget() {
    var standalone = extra.device ? extra.device.standalone : (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!('serviceWorker' in navigator)) { setResult('target', 'NOT SUPPORTED', 'No service workers here, so no share target.'); return; }
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { setResult('target', 'NOT SUPPORTED', 'Service worker could not be registered: ' + e.name); return; }
    $('target-note').textContent = standalone ? 'Running as an installed app. Share a file to it from another app now.' : 'Not installed yet: install the app first (browser menu: Install app / Add to Home screen).';
    if (results.target.status === 'NOT RUN') setResult('target', 'INFO', standalone ? 'Waiting for you to share a file to this app.' : 'Install the app, then share a file to it.');
    await checkShared();
  }

  /* ---------- 7. tabs + database ---------- */
  var tabId = Math.random().toString(36).slice(2, 8), bcMain = null;
  function initBc() {
    if (!window.BroadcastChannel) return;
    bcMain = new BroadcastChannel('itn-linktest');
    bcMain.onmessage = function (e) {
      var m = e.data || {};
      if (m.t === 'ping' && m.id !== tabId) bcMain.postMessage({ t: 'pong', to: m.id, id: tabId });
      if (m.t === 'pong' && m.to === tabId && S.tabWait) S.tabWait.push(m.id);
    };
  }
  var tabPing = guard(async function () {
    if (!bcMain) throw soft('BroadcastChannel is not available.');
    S.tabWait = []; bcMain.postMessage({ t: 'ping', id: tabId }); await delay(1000);
    var n = S.tabWait.length; S.tabWait = null;
    addDetail('tab', 'Cross-tab ping: ' + n + ' other tab(s) answered' + (n ? '' : ' (open this page in a second tab first)'));
    setResult('tab', results.tab.status === 'NOT RUN' ? 'INFO' : results.tab.status, results.tab.summary || (n + ' other tab(s) answered.'), results.tab.details);
  }, 'tab');
  var runTab = guard(async function () {
    var L = [], ok = true;
    if (!window.BroadcastChannel) { L.push('BroadcastChannel: not available'); ok = false; }
    else {
      var got = await new Promise(function (res) { var a = new BroadcastChannel('itn-linktest-self'), b = new BroadcastChannel('itn-linktest-self'); var to = setTimeout(function () { a.close(); b.close(); res(false); }, 1500); b.onmessage = function () { clearTimeout(to); a.close(); b.close(); res(true); }; a.postMessage('hi'); });
      L.push('BroadcastChannel message between two channels on this page: ' + (got ? 'ok' : 'NOT DELIVERED')); ok = ok && got;
    }
    if (!window.indexedDB) { L.push('IndexedDB: not available'); ok = false; }
    else {
      var name = 'itn-linktest-tmp-' + tabId, payload = crypto.getRandomValues(new Uint8Array(65536)), t = now();
      try {
        var db = await new Promise(function (res, rej) { var r = indexedDB.open(name, 1); r.onupgradeneeded = function () { r.result.createObjectStore('s'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
        await new Promise(function (res, rej) { var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(payload, 'k'); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
        var back = await new Promise(function (res, rej) { var r = db.transaction('s').objectStore('s').get('k'); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
        var same = back && C.sha256Hex(new Uint8Array(back.buffer || back)) === C.sha256Hex(payload);
        db.close();
        await new Promise(function (res) { var r = indexedDB.deleteDatabase(name); r.onsuccess = res; r.onerror = res; r.onblocked = res; });
        L.push('IndexedDB write/read/delete of 64 KB: ' + (same ? 'ok' : 'DATA DIFFERED') + ' in ' + (now() - t).toFixed(0) + ' ms (temporary database deleted)'); ok = ok && same;
      } catch (e) { L.push('IndexedDB failed: ' + e.name); ok = false; }
    }
    L.push('Cross-tab test: open this page in a second tab, then press "Ping other tabs".');
    setResult('tab', ok ? 'PASS' : (window.BroadcastChannel && window.indexedDB ? 'FAIL' : 'NOT SUPPORTED'), ok ? 'Tab messaging and the database work.' : 'A check failed.', L);
  }, 'tab');

  /* ---------- run all + report ---------- */
  var runAll = guard(async function () {
    var btn = $('run-all'); btn.disabled = true;
    try {
      var steps = [['Device report', runDev], ['Self-test', runSelftest], ['Same-network listing', runNet], ['File-sharing check', runCanShare], ['Private storage', runOpfs], ['Tabs + database', runTab]];
      for (var i = 0; i < steps.length; i++) { btn.textContent = 'Running: ' + steps[i][0] + '...'; await steps[i][1](); }
    } finally { btn.disabled = false; btn.textContent = 'Run all safe tests'; }
    renderReport();
  }, null);
  function buildReport() {
    var secs = DEFS.map(function (d) { var r = results[d[0]]; return { title: d[1], status: r.status, summary: r.summary, details: r.details }; });
    return C.formatReport({ version: VERSION, generated: new Date().toISOString(), network: $('network').value, role: $('role').value, sections: secs, suggestions: C.suggestDesign(results, $('network').value) });
  }
  function renderReport() { $('report').value = buildReport(); }
  var copyReport = guard(async function () {
    renderReport();
    var txt = $('report').value;
    try { await navigator.clipboard.writeText(txt); $('copy-note').textContent = 'Report copied. Paste it into your message.'; }
    catch (e) { $('report').select(); document.execCommand('copy'); $('copy-note').textContent = 'Report selected - copy it from the box at the bottom if it did not copy automatically.'; }
  }, null);

  /* ---------- wiring ---------- */
  function on(id, fn) { $(id).addEventListener('click', fn); }
  function init() {
    buildRows(); $('ver').textContent = VERSION;
    on('run-all', runAll); on('copy-report', copyReport);
    on('run-dev', runDev); on('run-selftest', runSelftest);
    on('a-make', makeOffer); on('a-copy', function () { copyText('a-offer'); }); on('a-accept', acceptAnswer); on('a-scan', scanAnswer);
    on('b-make', makeAnswer); on('b-scan', scanOffer); on('b-copy', function () { copyText('b-answer'); });
    on('p-ping', runPing); on('p-close', function () { closeLink(); setResult('link', 'NOT RUN', 'Link closed by you. Pair again to continue (resume works after re-pairing).'); });
    on('tp-send', tpSend); on('tp-pull', tpPull);
    on('f-send', fSend); on('f-drop', fDrop); on('f-resume', fResume);
    on('run-net', runNet); on('run-usb', runUsb);
    on('run-fsdir', runFsdir); on('run-opfs', runOpfs); on('run-dl', runDl); on('run-pick', runPick); on('cancel-pick', function () { pickCtl.cancel = true; });
    on('run-canshare', runCanShare); on('run-share', runShare);
    on('run-tab', runTab); on('tab-ping', tabPing);
    if (!window.RTCPeerConnection) setResult('link', 'NOT SUPPORTED', 'This browser has no WebRTC.');
    initBc(); initShareTarget();
    window.addEventListener('pagehide', stopScan);
  }
  window.LT = { results: results, runCapabilities: runDev, runAllSafe: runAll, buildReport: buildReport, collectDevice: collectDevice, version: VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
