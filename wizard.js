/* ITN Link Test - guided wizard (PC mode / tablet mode). Uses LTApp (app.js) for the actual link; the step logic lives in lt-wizard.js. */
(function () {
  'use strict';
  var A = window.LTApp, W = window.LTWizard, C = window.LTCore;
  var $ = function (id) { return document.getElementById(id); };
  var mode = null, wiz = null, linkOpen = false, lastProblem = null, lastStep = 0;
  var FT = [['rtt', 'Reply time'], ['out', 'PC to tablet (25 MB)'], ['in', 'Tablet to PC (25 MB)'], ['file', 'Test file (6 MB)'], ['resume', 'Interrupted transfer']];

  function store(v) { try { if (v === undefined) return sessionStorage.getItem('lt-mode'); if (v === null) sessionStorage.removeItem('lt-mode'); else sessionStorage.setItem('lt-mode', v); } catch (e) { /* storage blocked: fine */ } return null; }
  function suggest() {
    var coarse = false; try { coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { /* ignore */ }
    return W.suggestMode({ ua: navigator.userAgent, coarsePointer: coarse, touchPoints: navigator.maxTouchPoints || 0 });
  }
  function P() { return mode === 'pc' ? 'w-pc-' : 'w-tab-'; }
  function showMsg(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  /* ---------- rendering ---------- */
  function render() {
    if (!wiz) return;
    var strip = $('w-strip'); strip.textContent = '';
    wiz.strip().forEach(function (s) {
      var li = document.createElement('li');
      li.className = (s.current ? 'current ' : '') + s.status;
      if (s.current) li.setAttribute('aria-current', 'step');
      var mark = s.status === 'pass' ? '✓' : s.status === 'fail' ? '!' : String(s.n);
      var b = document.createElement('span'); b.className = 'dot'; b.textContent = mark;
      var t = document.createElement('span'); t.className = 'lbl'; t.textContent = s.title + (s.status === 'pass' ? ' (done)' : s.status === 'fail' ? ' (problem)' : '');
      li.appendChild(b); li.appendChild(t); strip.appendChild(li);
    });
    $('w-progress').textContent = wiz.label();
    document.querySelectorAll('#panel-guided .step').forEach(function (el) {
      var on = el.getAttribute('data-mode') === mode && parseInt(el.getAttribute('data-step'), 10) === wiz.current;
      el.hidden = !on;
      if (on) {
        var ok = el.querySelector('.okbox');
        if (!ok) { ok = document.createElement('p'); ok.className = 'okbox'; ok.setAttribute('role', 'status'); el.querySelector('h3').after(ok); }
        var done = wiz.status[wiz.current - 1] === 'pass';
        ok.textContent = done ? '✓ This step worked.' + (wiz.messages[wiz.current - 1] ? ' ' + wiz.messages[wiz.current - 1] : '') : '';
        ok.hidden = !done;
      }
    });
    $('w-back').disabled = !wiz.canBack();
    $('w-next').hidden = wiz.current === wiz.n;
    $('w-next').disabled = !wiz.canNext();
    if (wiz.current !== lastStep) {
      lastStep = wiz.current;
      var h = document.querySelector('#panel-guided .step:not([hidden]) h3'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); }
      onEnter(wiz.current);
    }
  }
  function onEnter(n) {
    if (mode === 'pc' && n === 2) A.hasCamera().then(function (ok) { $('w-pc-camway').hidden = !ok; });
    if (n === 3 && lastProblem && !linkOpen) renderProblem(lastProblem);
  }
  function passStep(n, msg) {
    wiz.pass(n, msg); render();
    if (wiz.current === n && wiz.autoNext(n)) setTimeout(function () { if (wiz && wiz.current === n && wiz.canNext()) { wiz.next(); render(); } }, 900);
  }
  function failStep(n, msg, el) { wiz.fail(n, msg); if (el) showMsg(el, msg); render(); }
  function errText(e) {
    if (e && e.soft) return e.message;
    var n = (e && e.name) || 'Error', m = (e && e.message) || '';
    if (/setRemoteDescription|SDP|Failed to set|InvalidAccessError|OperationError/i.test(n + m)) return 'The browser did not accept this code (' + n + '). Tick "Use the long code" in Connection options on both devices and start again.';
    return 'Something went wrong (' + n + (m ? ': ' + m : '') + '). Press Start again.';
  }
  function copyFrom(textarea, noteEl) {
    textarea.select();
    var ok = function () { noteEl.textContent = 'Copied.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textarea.value).then(ok, function () { document.execCommand('copy'); ok(); });
    else { document.execCommand('copy'); ok(); }
  }

  /* ---------- mode ---------- */
  function chooseMode(m) {
    mode = m; store(m);
    A.mode = m === 'pc' ? 'PC' : 'Tablet'; A.setDriver(m === 'pc');
    wiz = new W.Wizard(m); lastStep = 0; linkOpen = false; lastProblem = null;
    $('screen-mode').hidden = true; $('app').hidden = false;
    $('mode-badge').textContent = m === 'pc' ? 'the PC' : 'the tablet';
    setTab('guided'); render();
  }
  function showModeScreen() { $('app').hidden = true; $('screen-mode').hidden = false; }
  function changeMode() { A.closeLink(); A.stopScan(); wiz = null; mode = null; store(null); showModeScreen(); }
  function setTab(t) {
    if (t === 'guided' && !wiz) { showModeScreen(); return; }
    A.stopScan();
    ['guided', 'quick', 'adv'].forEach(function (k) {
      var panel = $('panel-' + k); panel.hidden = k !== t;
      $('tab-' + k).setAttribute('aria-pressed', String(k === t));
    });
  }
  function startAgain() {
    A.closeLink(); A.stopScan();
    wiz.startAgain(); lastStep = 0; linkOpen = false; lastProblem = null;
    ['w-pc-out', 'w-tab-out'].forEach(function (id) { $(id).hidden = true; });
    ['w-pc-code', 'w-pc-answer', 'w-tab-offer', 'w-tab-code'].forEach(function (id) { $(id).value = ''; });
    ['w-pc-qr', 'w-tab-qr'].forEach(function (id) { $(id).hidden = true; });
    ['w-pc-err', 'w-pc-err2', 'w-pc-connerr', 'w-pc-err4', 'w-tab-err', 'w-tab-connerr', 'w-tab-err4'].forEach(function (id) { showMsg($(id), ''); });
    ['w-pc-make', 'w-tab-scan'].forEach(function (id) { $(id).disabled = false; });
    resetFt(); render();
  }

  /* ---------- PC steps ---------- */
  function pcMake() {
    var btn = $('w-pc-make'); btn.disabled = true; showMsg($('w-pc-err'), ''); $('w-pc-len').textContent = 'Making the code... (a few seconds)';
    A.createOffer().then(function (text) {
      $('w-pc-out').hidden = false; $('w-pc-code').value = text;
      var qrOk = A.drawQr($('w-pc-qr'), text);
      $('w-pc-len').textContent = 'Code length: ' + text.length + ' characters.' + (qrOk ? '' : ' Too long for a QR square - use the text code.') + (A.state.compactNote ? ' ' + A.state.compactNote : '');
      passStep(1, 'Code length ' + text.length + ' characters.');
    }).catch(function (e) { btn.disabled = false; $('w-pc-len').textContent = ''; failStep(1, errText(e), $('w-pc-err')); });
  }
  function pcAccept() {
    showMsg($('w-pc-err2'), ''); wiz.reset(2);
    var text = $('w-pc-answer').value;
    if (!text.trim()) { failStep(2, 'Paste or type the answer code from the tablet first.', $('w-pc-err2')); return; }
    A.acceptAnswer(text).then(function () { $('w-pc-conn').textContent = 'Answer accepted. Connecting...'; passStep(2); }).catch(function (e) { failStep(2, errText(e), $('w-pc-err2')); });
  }
  function pcCam() {
    A.scanInto($('w-pc-video'), $('w-pc-camnote'), function (t) { $('w-pc-answer').value = t; pcAccept(); }, null);
  }

  /* ---------- tablet steps ---------- */
  function tabUse(text) {
    showMsg($('w-tab-err'), ''); wiz.reset(1);
    if (!text.trim()) { failStep(1, 'Scan the PC\'s code or paste it into the box first.', $('w-tab-err')); return; }
    $('w-tab-note').textContent = 'Making the answer... (a few seconds)';
    A.acceptOffer(text).then(function (answer) {
      $('w-tab-out').hidden = false; $('w-tab-code').value = answer;
      var qrOk = A.drawQr($('w-tab-qr'), answer);
      $('w-tab-len').textContent = 'Answer length: ' + answer.length + ' characters.' + (qrOk ? '' : ' Too long for a QR square - use the text code.') + (A.state.compactNote ? ' ' + A.state.compactNote : '');
      $('w-tab-note').textContent = '';
      wiz.pass(2, 'Answer length ' + answer.length + ' characters.');
      passStep(1);
    }).catch(function (e) { $('w-tab-note').textContent = ''; failStep(1, errText(e), $('w-tab-err')); });
  }
  function tabScan() {
    showMsg($('w-tab-err'), '');
    A.scanInto($('w-tab-video'), $('w-tab-note'), function (t) { $('w-tab-offer').value = t; tabUse(t); }, 'environment');
  }

  /* ---------- connection events ---------- */
  function renderProblem(p) {
    var v = W.connectionProblem({ hadMdns: p.hadMdns, stun: p.stun, network: p.network });
    var el = $(P() + 'connerr'); el.textContent = '';
    var h = document.createElement('strong'); h.textContent = v.headline; el.appendChild(h);
    v.lines.forEach(function (l) { var q = document.createElement('p'); q.textContent = l; el.appendChild(q); });
    var t = document.createElement('p'); t.textContent = 'What to try next:'; el.appendChild(t);
    var ol = document.createElement('ol'); v.next.forEach(function (l) { var li = document.createElement('li'); li.textContent = l; ol.appendChild(li); }); el.appendChild(ol);
    el.hidden = false; $(P() + 'conn').textContent = 'No connection.';
  }
  function onOpen() {
    linkOpen = true; lastProblem = null; showMsg($(P() + 'connerr'), '');
    $(P() + 'conn').textContent = 'Connected directly between the two devices.';
    if (!wiz) return;
    wiz.linkOpened(); render();
    $('w-tab-note').textContent = '';
  }
  function onProblem(p) {
    if (linkOpen || !wiz) return;
    lastProblem = p;
    if (wiz.current >= 3) { wiz.fail(3, 'No connection.'); renderProblem(p); render(); }
  }

  /* ---------- full link test ---------- */
  function resetFt() {
    ['w-pc-ft', 'w-tab-ft'].forEach(function (id) {
      var ul = $(id); ul.textContent = '';
      FT.forEach(function (f) { var li = document.createElement('li'); li.setAttribute('data-key', f[0]); li.className = 'wait'; li.textContent = '• ' + f[1] + ': waiting'; ul.appendChild(li); });
    });
    document.querySelectorAll('.w-bar').forEach(function (b) { b.value = 0; });
    document.querySelectorAll('.w-bartxt').forEach(function (b) { b.textContent = ''; });
  }
  function onFt(m) {
    if (m.key === 'start') return;
    var f = FT.filter(function (x) { return x[0] === m.key; })[0]; if (!f) return;
    var icon = m.state === 'ok' ? '✓' : m.state === 'fail' ? '✗' : '…', cls = m.state === 'ok' ? 'ok' : m.state === 'fail' ? 'bad' : 'run';
    ['w-pc-ft', 'w-tab-ft'].forEach(function (id) {
      var li = $(id).querySelector('[data-key="' + m.key + '"]');
      if (li) { li.className = cls; li.textContent = icon + ' ' + f[1] + ': ' + (m.state === 'run' ? 'running... ' : '') + (m.text || ''); }
    });
  }
  function onProgress(p) {
    if (p.prefix === 'tp-send' || p.prefix === 'tp-recv' || p.prefix === 'f') {
      document.querySelectorAll('.w-bar').forEach(function (b) { b.value = p.pct; });
      document.querySelectorAll('.w-bartxt').forEach(function (b) { b.textContent = p.text; });
    }
  }
  function runTest() {
    var err = $(P() + 'err4'); showMsg(err, ''); resetFt();
    var p = mode === 'pc' ? A.runFullTest() : Promise.resolve().then(function () { A.askRunTest(); });
    p.catch(function (e) { showMsg(err, errText(e)); });
    if (mode === 'tablet') document.querySelectorAll('.w-bartxt').forEach(function (b) { b.textContent = 'Asked the PC to start the test...'; });
  }
  function renderVerdict(v) {
    ['w-pc-verdict', 'w-tab-verdict'].forEach(function (id) {
      var el = $(id); el.textContent = '';
      el.className = 'verdict ' + (v.result === 'works' ? 'good' : v.result === 'slow' ? 'warn' : 'bad');
      var h = document.createElement('h4'); h.className = 'headline'; h.textContent = v.headline; el.appendChild(h);
      v.lines.forEach(function (l) { var q = document.createElement('p'); q.textContent = l; el.appendChild(q); });
      if (v.next.length) {
        var t = document.createElement('p'); t.textContent = v.result === 'works' ? 'Next:' : 'What to try next:'; t.className = 'strong'; el.appendChild(t);
        var ol = document.createElement('ol'); v.next.forEach(function (l) { var li = document.createElement('li'); li.textContent = l; ol.appendChild(li); }); el.appendChild(ol);
      }
      var cs = A.state.codes, cp = A.state.peerCodes || {};
      var q2 = document.createElement('p'); q2.className = 'small';
      q2.textContent = 'Pairing code length: PC code ' + (cs.offer || cp.offer || '?') + ' characters, tablet answer ' + (cs.answer || cp.answer || '?') + ' characters.';
      el.appendChild(q2);
    });
    if (!wiz) return;
    wiz.linkOpened(); wiz.pass(4); wiz.pass(5);
    if (wiz.current === 4) { wiz.next(); }
    render();
  }
  function copyRep() {
    A.copyReport().then(function () { $(P() + 'repnote').textContent = $('copy-note').textContent || 'Report copied.'; });
  }
  function redo() { wiz.reset(5); wiz.go(4); resetFt(); lastStep = 0; render(); }

  /* ---------- wiring ---------- */
  function on(id, fn) { $(id).addEventListener('click', fn); }
  function init() {
    resetFt();
    var sug = suggest();
    $('mode-hint').textContent = 'This looks like ' + (sug === 'pc' ? 'a PC' : 'a tablet') + ', so that button is highlighted. You can always choose the other one.';
    $('mode-' + sug).classList.add('suggested');
    on('mode-pc', function () { chooseMode('pc'); }); on('mode-tablet', function () { chooseMode('tablet'); });
    on('to-quick', function () { $('screen-mode').hidden = true; $('app').hidden = false; $('mode-badge').textContent = 'not pairing (single-device checks)'; setTab('quick'); });
    on('change-mode', changeMode);
    on('tab-guided', function () { setTab('guided'); }); on('tab-quick', function () { setTab('quick'); }); on('tab-adv', function () { setTab('adv'); });
    on('w-back', function () { wiz.back(); render(); }); on('w-next', function () { wiz.next(); render(); });
    on('w-pc-make', pcMake); on('w-pc-copy', function () { copyFrom($('w-pc-code'), $('w-pc-len')); });
    on('w-pc-accept', pcAccept); on('w-pc-cam', pcCam); on('w-pc-again', startAgain); on('w-pc-again2', startAgain);
    on('w-pc-run', runTest); on('w-pc-copyrep', copyRep); on('w-pc-redo', redo);
    on('w-tab-scan', tabScan); on('w-tab-use', function () { tabUse($('w-tab-offer').value); });
    on('w-tab-copy', function () { copyFrom($('w-tab-code'), $('w-tab-len')); });
    on('w-tab-again', startAgain); on('w-tab-again2', startAgain);
    on('w-tab-run', runTest); on('w-tab-copyrep', copyRep); on('w-tab-redo', redo);
    A.on('open', onOpen); A.on('problem', onProblem); A.on('ft', onFt); A.on('progress', onProgress); A.on('verdict', renderVerdict);
    var saved = store();
    if (saved === 'pc' || saved === 'tablet') chooseMode(saved);
  }
  window.LTWiz = { chooseMode: chooseMode, state: function () { return { mode: mode, wiz: wiz }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
