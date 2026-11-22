# ITN Link Test

A small stand-alone web page that finds out **which direct links actually work between Chris's work PC and work-profile tablet**, before any daily PC <-> tablet sync is built into ITN.

* No ITN code or data. Random test data only.
* Sends nothing to any server. No analytics. No storage (only a tiny service worker so the Share target can work).
* The one optional outside request is a public STUN server, and only if you tick the box (default OFF).
* Strict Content-Security-Policy: scripts and styles only from the page's own files, `connect-src 'self'`.
* Does not enable developer mode or USB debugging, and does not try to get around the web filter.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page (all sections, strict CSP) |
| `app.js` | Page logic |
| `lt-core.js` | Pure logic: chunker, back-pressure/ETA, SHA-256, pairing text, report formatter (tested in Node) |
| `lt-qr.js` | Tiny QR generator (+ matrix decoder used by tests) |
| `style.css` | Light/dark, phone/tablet/desktop layout |
| `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png` | Installable app + Web Share Target |
| `tests/`, `smoke/` | Node unit tests and static checks; Edge smoke test (kept apart so `node --test` never starts a browser) |

Host the folder as is, over https (a github.io path works) or on `localhost`. It needs a secure context for WebRTC, crypto, share and OPFS.

## How to use it: 5 steps

1. **Open the page on both devices** (PC in Edge, tablet in Chrome). On the tablet choose *Install app* from the browser menu (needed only for the Share test). Pick the network you are on and the device role at the top.
2. **Press "Run all safe tests" on each device.** No prompts. Then press **Copy report** and keep the text.
3. **Pair the devices (section 2).** On device A press *make the pairing offer*. On device B scan the QR code (or copy the text into the box) and press *make the answer*. Bring the answer back to A (scan or paste) and press *connect*. The status line should say the data channel is open and which candidate type was used.
4. **Measure.** Press *Send to the other device* for 10 MB, then 100 MB, then *Ask the other device to send to me*. Send a real file and try *Simulate a drop* followed by *Resume*. Repeat once with USB tethering or a hotspot if the plain Wi-Fi link failed (section 3 has the instructions) and change the network drop-down before copying the report.
5. **Run the individual tests** you care about (USB, PC folder test, tablet storage/download, system-picker read with a OneDrive file and with a local file, Share target from the OneDrive app). Press **Copy report** on each device and paste both to the release owner.

## How to read the results

Each test shows a badge and a sentence on what it means for ITN sync.

| Badge | Meaning |
|---|---|
| **PASS** | The feature works on this device here and now. |
| **FAIL** | It exists but did not work (blocked, failed, corrupted, stalled). |
| **NOT SUPPORTED** | The browser or device does not have the feature at all. |
| **INFO** | Facts only (for example the address listing). |
| **NOT RUN** | Not tried yet. |

Things to look at specially:

* **Candidate type** in section 2: `host` = direct local link (best). `srflx` = found through STUN (only if you ticked the box). `relay` = traffic would go through a server (should not happen here).
* **MB/s** from the speed test is what a daily sync would get. As a guide, 500 MB at 20 MB/s is under half a minute.
* **Hash matches** is required for every transfer. A mismatch means do not rely on the link.
* **Picker read speed**: compare a OneDrive file with a local file of the same size. A big difference or a stall is the cloud-file problem.
* The report contains no IP addresses and no secrets. Local addresses are replaced by `x.x.x.x`.

Notes on the speed test: integrity is SHA-256 of every 1 MB block, then SHA-256 of those hashes (so the hash does not slow the link). File transfers use a full SHA-256 of the whole file. The receiving page keeps a transferred file in memory, so stay under about 500 MB.

## Decision table: result -> possible ITN sync design

| Results | Design that becomes possible | Daily workflow |
|---|---|---|
| Section 2 **link PASS** on office Wi-Fi, speed good, file hash matches | **A. WebRTC direct** | Open ITN on both, click *Sync*; a pairing step by QR or text the first time (and after each page reload). |
| Link **FAIL** on Wi-Fi but **PASS** on USB tethering or a hotspot | **B. USB tethering (or hotspot) + WebRTC** | Plug in the cable, switch on tethering once, open both, click *Sync*. Needs tethering allowed by company policy. |
| Link fails everywhere; **Share target PASS** and *Share a file out* PASS | **C. OneDrive folder + Share target** | Export a sync file on one device, share it to ITN (or OneDrive) on the other. Still manual but 2 steps, and avoids the in-browser OneDrive picker. |
| Link fails everywhere; Share target not possible; PC folder test **PASS**; picker read slow or stalls on OneDrive files | **C'. Keep OneDrive folder, copy to a local file first** | Use a locally stored copy; ITN reads from the local copy. |
| None of the browser-only routes pass; Explorer can still see the tablet (MTP) | **D. A small PC helper program** | A signed helper (or script approved by IT) copies via MTP/Explorer to a folder ITN reads. Outside the browser; needs IT agreement. |
| USB section FAIL/NOT SUPPORTED on a tablet in file-transfer mode | (expected) | USB cable alone can not be driven by a web page without debugging, which is off the table. It only helps as tethering (B). |

Order of preference when several pass: **A**, then **B**, then **C**, then **D**.

## Running the tests

```
node --test linktest/tests/
```

* `core.test.mjs`: chunker, back-pressure and ETA math, SHA-256 against Node, block hasher, hash check, pairing text, candidate parsing and redaction, report formatter, QR encode -> decode round trip for every version 1-40.
* `static.test.mjs`: CSP is strict, no inline code, no network calls, every element id used by `app.js` exists, manifest and icons are valid.
* `smoke/edge_smoke.mjs` (outside `tests/` on purpose): starts a local server and headless Edge, loads the page, runs the device report and safe tests. Run it by hand: `node linktest/smoke/edge_smoke.mjs` (`node --test linktest/tests/` never starts it).

## Known limits (be honest about them)

* The QR generator is verified by an encode -> decode round trip in Node (including the error-correction check) but **not yet against a real phone/tablet scanner**. The copy/paste text always works as a fallback.
* A secure (https) page cannot call a plain-http address on the local network, so there is no "type the other device's IP" probe; the link test itself is the reachability test.
* Browsers hide real local IPs behind `.local` names. If the corporate network blocks mDNS the link can fail even when both devices are on the same Wi-Fi; USB tethering avoids that.
* The offer/answer must be re-exchanged after a page reload (there is no server to remember it).
