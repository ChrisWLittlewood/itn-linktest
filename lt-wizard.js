/* ITN Link Test - wizard state machine and verdict logic (pure; no DOM). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lt-core.js'));
  else root.LTWizard = factory(root.LTCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var STEPS = {
    pc: ['Make a pairing code', 'Bring the tablet\'s answer back', 'Connecting', 'Run the full link test', 'Result'],
    tablet: ['Scan the PC\'s code', 'Show the answer to the PC', 'Connecting', 'Run the full link test', 'Result']
  };
  /* steps that move on by themselves once they pass (the user must still act on the others, e.g. show the code to the other device) */
  var AUTO = { pc: [2, 3, 4], tablet: [1, 3, 4] };

  function suggestMode(env) {
    env = env || {};
    var ua = env.ua || '';
    if (env.coarsePointer || env.touchPoints > 1 || /Android|iPad|Tablet|Mobile/i.test(ua)) return 'tablet';
    return 'pc';
  }

  /* status per step: 'todo' | 'pass' | 'fail' */
  function Wizard(mode) {
    if (!STEPS[mode]) throw new Error('unknown mode ' + mode);
    this.mode = mode; this.titles = STEPS[mode]; this.n = this.titles.length;
    this.current = 1; this.status = []; this.messages = [];
    for (var i = 0; i < this.n; i++) { this.status.push('todo'); this.messages.push(''); }
  }
  Wizard.prototype._chk = function (s) { if (!(s >= 1 && s <= this.n)) throw new Error('no such step ' + s); };
  Wizard.prototype.label = function () { return 'Step ' + this.current + ' of ' + this.n + ': ' + this.titles[this.current - 1]; };
  Wizard.prototype.pass = function (s, msg) { this._chk(s); this.status[s - 1] = 'pass'; this.messages[s - 1] = msg || ''; return this; };
  Wizard.prototype.fail = function (s, msg) { this._chk(s); this.status[s - 1] = 'fail'; this.messages[s - 1] = msg || 'This step did not work.'; return this; };
  Wizard.prototype.reset = function (s) { this._chk(s); this.status[s - 1] = 'todo'; this.messages[s - 1] = ''; return this; };
  Wizard.prototype.canBack = function () { return this.current > 1; };
  Wizard.prototype.canNext = function () { return this.current < this.n && this.status[this.current - 1] === 'pass'; };
  Wizard.prototype.back = function () { if (this.canBack()) this.current--; return this.current; };
  Wizard.prototype.next = function () { if (this.canNext()) this.current++; return this.current; };
  Wizard.prototype.go = function (s) { this._chk(s); if (s > this.current && !this.allPassedBefore(s)) return false; this.current = s; return true; };
  Wizard.prototype.allPassedBefore = function (s) { for (var i = 0; i < s - 1; i++) if (this.status[i] !== 'pass') return false; return true; };
  Wizard.prototype.autoNext = function (s) { return AUTO[this.mode].indexOf(s) >= 0; };
  /* the link opened: everything up to "Connecting" is, by definition, done */
  Wizard.prototype.linkOpened = function () {
    for (var i = 1; i <= 3; i++) this.pass(i, this.messages[i - 1]);
    if (this.current <= 3) this.current = 4;
  };
  Wizard.prototype.startAgain = function () { for (var i = 0; i < this.n; i++) { this.status[i] = 'todo'; this.messages[i] = ''; } this.current = 1; };
  Wizard.prototype.strip = function () {
    var self = this;
    return this.titles.map(function (t, i) { return { n: i + 1, title: t, status: self.status[i], current: self.current === i + 1 }; });
  };

  /* ---------- verdict ---------- */
  var TETHER = 'On the tablet: Settings -> Connections (or Network & internet) -> Mobile Hotspot and Tethering (or Hotspot & tethering) -> switch on USB tethering. The tablet must be plugged into the PC with a data cable. Then choose "USB tethering" in the Connection box and start again on both devices.';
  var SYNC_MB = 500;

  function minutesText(mb, rateMBs) {
    var sec = mb / rateMBs;
    if (sec < 60) return 'under a minute';
    var m = Math.round(sec / 60);
    return 'about ' + m + ' minute' + (m === 1 ? '' : 's');
  }

  /* r: {connected, hadMdns, candidate, stun, network, rttMs, out:{ok,rate}, inn:{ok,rate}, file:{ok}, resume:{ok}, codeLen} (rate in bytes/s) */
  function verdict(r) {
    r = r || {};
    var lines = [], next = [];
    var netIsWifi = !r.network || /wi-?fi/i.test(r.network);
    if (!r.connected) {
      lines.push('The two devices could not open a direct connection to each other.');
      if (netIsWifi) lines.push('Most likely the office Wi-Fi does not let devices talk to each other (it is called "client isolation"), or a firewall or VPN blocks the link.');
      else lines.push('A firewall, VPN or a security setting on one of the devices is probably blocking the link.');
      if (r.hadMdns) lines.push('Your browsers also hide the devices\' addresses behind random names. Some company networks block the lookup of those names, which has the same effect.');
      if (!/usb/i.test(r.network || '')) next.push(TETHER);
      next.push('Switch off any VPN on both devices, then start again.');
      if (!r.stun) next.push('Tick "Also try a public STUN server" when you make the code (it makes one outside request to learn the public address), then start again. Your company filter may block it.');
      next.push('If nothing works, tell the release owner: ITN will use the Share/OneDrive route or a small PC helper program instead.');
      return { result: 'fail', headline: 'DOES NOT WORK: no direct link could be opened', lines: lines, next: next };
    }
    if (r.candidate === 'relay') {
      return { result: 'fail', headline: 'DOES NOT WORK: the connection goes through an outside server', lines: ['The devices connected only through a relay server, which ITN sync must not use.'], next: ['Try USB tethering (' + TETHER + ')'] };
    }
    var done = r.out && r.inn && r.file;
    if (!done) {
      return { result: 'incomplete', headline: 'TEST NOT FINISHED: the devices connected but the full test did not complete', lines: ['The link opened, but at least one test step did not finish.' + (r.errors && r.errors.length ? ' ' + r.errors.join(' ') : '')], next: ['Run the full link test again. If it stops at the same place, copy the report and send it.'] };
    }
    var bad = [];
    if (!r.out.ok) bad.push('data sent from the PC to the tablet was damaged or incomplete');
    if (!r.inn.ok) bad.push('data sent from the tablet to the PC was damaged or incomplete');
    if (!r.file.ok) bad.push('the test file did not arrive intact');
    if (bad.length) {
      return { result: 'unreliable', headline: 'DOES NOT WORK RELIABLY: ' + bad.join('; '), lines: ['The link opens but data is not coming through correctly, so it cannot be trusted for sync.'], next: ['Run the test again once. If it fails again, try USB tethering. ' + TETHER] };
    }
    var rate = Math.min(r.out.rate, r.inn.rate), mbs = rate / C.MB;
    lines.push('Speed: ' + C.formatRate(r.out.rate) + ' from PC to tablet, ' + C.formatRate(r.inn.rate) + ' from tablet to PC.');
    if (typeof r.rttMs === 'number') lines.push('Round trip: ' + r.rttMs.toFixed(0) + ' ms.');
    lines.push('Data was checked with SHA-256 and arrived intact' + (r.resume && r.resume.ok ? ', and an interrupted file transfer continued correctly.' : '.'));
    if (r.resume && !r.resume.ok) { lines.push('The "interrupted transfer" test did not complete, so a dropped link would mean starting a file again.'); }
    lines.push('Connection type: ' + (r.candidate === 'srflx' ? 'found through a public STUN server' : 'direct on the local network') + '.');
    var est = 'a daily sync of ' + SYNC_MB + ' MB would take ' + minutesText(SYNC_MB, mbs);
    if (mbs < 1) {
      next.push('A direct link is possible but slow. Try USB tethering for a faster link. ' + TETHER);
      return { result: 'slow', headline: 'WORKS BUT SLOW (' + C.formatRate(rate) + '; ' + est + ')', lines: lines, next: next };
    }
    next.push('Copy the report and send it. ITN can use a direct PC-to-tablet sync on this connection.');
    return { result: 'works', headline: 'DIRECT LINK WORKS (' + C.formatRate(rate) + '; ' + est + ')', lines: lines, next: next };
  }

  /* explain a connection that did not open (used by step 3) */
  function connectionProblem(ctx) { var v = verdict({ connected: false, hadMdns: ctx && ctx.hadMdns, stun: ctx && ctx.stun, network: ctx && ctx.network }); return v; }

  return { STEPS: STEPS, Wizard: Wizard, suggestMode: suggestMode, verdict: verdict, connectionProblem: connectionProblem, SYNC_MB: SYNC_MB, minutesText: minutesText };
});
