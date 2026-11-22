/* ITN Link Test - service worker. Only job: receive a file shared from another app (Web Share Target),
   report its name/size/SHA-256 to the page, and discard the file. It caches no pages and keeps no files. */
importScripts('lt-core.js');

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method === 'POST' && /\/share-target$/.test(u.pathname)) e.respondWith(handleShare(e.request, u));
});

async function handleShare(req, u) {
  var meta = { files: [], titleLen: 0, textLen: 0 };
  try {
    var fd = await req.formData();
    for (var pair of fd.entries()) {
      var k = pair[0], v = pair[1];
      if (typeof v === 'string') { if (k === 'title') meta.titleLen = v.length; else meta.textLen += v.length; continue; }
      var t0 = Date.now(), h = new LTCore.Sha256(), size = 0, reader = v.stream().getReader();
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        h.update(r.value); size += r.value.length;
      }
      meta.files.push({ name: v.name, type: v.type, size: size, sha: h.hex(), ms: Date.now() - t0 });
    }
  } catch (err) { meta.error = String(err && err.name || err); }
  var cache = await caches.open('lt-share');
  await cache.put('shared-meta', new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
  return Response.redirect(new URL('./?shared=1', u.href).href, 303);
}
