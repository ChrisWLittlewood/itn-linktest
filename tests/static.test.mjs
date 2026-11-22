import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');

test('index.html: strict CSP, no inline code, no external URLs', () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(csp));
  assert.match(csp, /connect-src 'self'/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'inline script');
  assert.ok(!/\sstyle="/i.test(html), 'inline style attribute');
  assert.ok(!/\son[a-z]+="/i.test(html), 'inline handler');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  for (const r of refs) { assert.ok(!/^[a-z]+:/i.test(r), 'external ref ' + r); assert.ok(fs.existsSync(path.join(root, r)), 'missing ' + r); }
});

test('every element id used by app.js exists in index.html', () => {
  const app = read('app.js') + '\n' + read('wizard.js');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...app.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  for (const m of app.matchAll(/(?<![.\w])on\('([a-z0-9-]+)'/g)) used.add(m[1]);
  used.add('mode-pc'); used.add('mode-tablet'); // built as 'mode-' + suggestion in wizard.js
  for (const pre of ['w-pc-', 'w-tab-']) for (const suf of ['conn', 'connerr', 'err4', 'repnote', 'ft', 'verdict', 'out', 'qr', 'code']) used.add(pre + suf);
  for (const m of app.matchAll(/showProgress\('([a-z-]+)'/g)) { used.add(m[1] + '-bar'); used.add(m[1] + '-txt'); }
  for (const id of used) assert.ok(ids.has(id), 'no element #' + id);
  const dataTests = [...html.matchAll(/data-tests="([^"]+)"/g)].flatMap((m) => m[1].split(','));
  const defs = [...app.matchAll(/\['([a-z]+)', '/g)].map((m) => m[1]);
  for (const t of dataTests) assert.ok(defs.includes(t), 'no definition for test row ' + t);
  for (const d of ['dev', 'selftest', 'link', 'tp', 'file', 'resume', 'net', 'usb', 'fsdir', 'opfs', 'dl', 'pick', 'canshare', 'target', 'tab'])
    assert.ok(dataTests.includes(d), 'row not shown: ' + d);
});

test('no network calls, storage writes or ITN references in app code', () => {
  for (const f of ['app.js', 'sw.js', 'lt-core.js', 'lt-qr.js', 'lt-code.js', 'lt-qrscan.js', 'lt-wizard.js', 'wizard.js']) {
    const s = read(f);
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(s), f + ' network call');
    assert.ok(!/localStorage|document\.cookie/.test(s), f + ' storage');
    if (f !== 'wizard.js') assert.ok(!/sessionStorage/.test(s), f + ' session storage');
    else assert.equal((s.match(/sessionStorage\./g) || []).length, 3, 'only the PC/tablet choice is kept, for the tab session');
    assert.ok(!/inspection|ITN_|from ['"]\.\.\/app/i.test(s.replace(/ITN Link Test|ITNLT1|ITN's|ITN sync|ITN\b/g, '')), f + ' ITN reference');
  }
  const app = read('app.js');
  assert.equal((app.match(/stun:stun\.l\.google\.com/g) || []).length, 1, 'exactly one STUN reference');
  assert.match(app, /\$\('stun'\)\.checked \?/);
});

test('manifest has share_target and icons that exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.share_target.method, 'POST');
  assert.equal(m.share_target.enctype, 'multipart/form-data');
  assert.ok(m.share_target.params.files[0].name);
  assert.match(read('sw.js'), /share-target/);
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
  assert.ok(fs.readFileSync(path.join(root, 'icon-192.png')).subarray(1, 4).toString() === 'PNG');
});

test('JS files parse', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const f of ['app.js', 'sw.js', 'lt-core.js', 'lt-qr.js', 'lt-code.js', 'lt-qrscan.js', 'lt-wizard.js', 'wizard.js']) execFileSync(process.execPath, ['--check', path.join(root, f)]);
});
