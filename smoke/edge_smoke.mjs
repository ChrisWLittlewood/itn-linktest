// Edge smoke test for the Link Test page (NOT part of the Node sweep; run by hand: node linktest/smoke/edge_smoke.mjs).
// Serves linktest/ on 127.0.0.1, starts headless Edge with a throw-away profile, loads the page, runs the device-report
// section and the safe tests, and checks the CSP produced no violations. Needs Node 22+ (global WebSocket/fetch).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8971, CDP = 9271;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(root, 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const edgePaths = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const edge = process.env.EDGE || edgePaths.find((p) => fs.existsSync(p));
if (!edge) { console.error('msedge.exe not found (set EDGE=path)'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-smoke-'));
let proc, failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  proc = spawn(edge, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.length) break; } catch (e) { /* retry */ } await sleep(200); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(), logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('console error: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  for (let i = 0; i < 50 && !(await evalJs('!!window.LT')); i++) await sleep(200);

  check(await evalJs('document.title') === 'ITN Link Test', 'page title');
  check((await evalJs('document.querySelectorAll(".trow").length')) >= 15, 'all test rows rendered');
  const dev = await evalJs('LT.runCapabilities().then(()=>LT.results.dev)');
  check(dev.status === 'PASS', 'device report PASS on localhost (' + dev.summary + ')');
  check(dev.details.some((l) => /RTCPeerConnection: yes/.test(l)), 'WebRTC reported present');
  const all = await evalJs('LT.runAllSafe().then(()=>Object.fromEntries(Object.entries(LT.results).map(([k,v])=>[k,v.status])))');
  console.log('safe-test statuses:', JSON.stringify(all));
  check(all.selftest === 'PASS', 'self-test PASS');
  check(all.tab === 'PASS', 'tab + database PASS');
  const rep = await evalJs('LT.buildReport()');
  check(/^ITN LINK TEST REPORT/.test(rep) && !/\b\d+\.\d+\.\d+\.\d+\b/.test(rep), 'report text built without IP addresses');
  check(logs.length === 0, 'no console errors / CSP violations' + (logs.length ? ': ' + logs.join(' | ') : ''));
  ws.close();
}
main().catch((e) => { console.error(e); failed++; }).finally(() => {
  try { proc && proc.kill(); } catch (e) { /* ignore */ }
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } process.exit(failed ? 1 : 0); }, 1500);
});
