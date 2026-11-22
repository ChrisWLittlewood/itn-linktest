# ITN Link Test (version 2)

A small stand-alone web page that finds out **whether Chris's work PC and work-profile tablet can send files straight to each other**, before any daily PC <-> tablet sync is built into ITN.

* No ITN code or data. Random test data only.
* Sends nothing to any server. No analytics. No storage (only a tiny service worker so the Share target can work; the PC / tablet choice is kept for the browser tab session only).
* The one optional outside request is a public STUN server, and only if you tick the box in *Connection options* (default OFF).
* Strict Content-Security-Policy: scripts and styles only from the page's own files, `connect-src 'self'`.
* Does not enable developer mode or USB debugging, and does not try to get around the web filter.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page: first screen (PC / tablet), guided steps, "No pairing needed" tab, "Advanced tests" tab |
| `wizard.js` | The guided steps screen by screen (DOM only) |
| `app.js` | The link, the tests, the full link test, the report |
| `lt-wizard.js` | Pure logic: step state machine, mode suggestion, **verdict** |
| `lt-code.js` | Pure logic: short pairing codes (minimal SDP + base32) |
| `lt-core.js` | Pure logic: chunker, back-pressure/ETA, SHA-256, report formatter, long-code fallback |
| `lt-qr.js` | Tiny QR generator (+ matrix decoder used by tests) |
| `style.css`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png` | Layout, share target, install |
| `tests/`, `smoke/` | Node tests and static checks; Edge smoke test (kept apart so `node --test` never starts a browser) |

Host the folder as is, over https (a github.io path works) or on `localhost`.

## How Chris uses it (guided)

1. **Open the page on both devices.** The first screen asks *I am on the PC* or *I am on the tablet* (the right one is highlighted from touch/browser, and you can always change it).
2. **PC, step 1: Make a pairing code.** A QR square and a text code appear, with a Copy button.
3. **Tablet, step 1: Scan the PC's code.** Press *Allow camera and scan* (a sentence explains what the camera is for; it is switched off straight after). If the camera or BarcodeDetector is missing, paste the code instead.
4. **Tablet, step 2 -> PC, step 2: bring the answer back.** The PC has no camera, so the answer code is shown on the tablet as text with *Copy code* and as a QR, and the PC has a paste box:
   * **Best:** Copy on the tablet, send to yourself in Teams or Outlook, paste on the PC.
   * **Type it:** the answer code is about 140 characters (capital letters and digits; case, spaces, dashes, O/0 and I/L/1 mix-ups are forgiven and a check code catches typos).
   * **Webcam:** if the PC has a webcam (and the browser has BarcodeDetector), a button appears to scan the tablet screen.
5. **Step 3 connects by itself.** On success both screens jump to step 4. On failure a red box says in plain words what to try.
6. **Step 4: Run the full link test** (either device; the PC does the work). It measures reply time, sends 25 MB each way, sends a 6 MB test file, interrupts it at 40% and resumes it, checking SHA-256 every time.
7. **Step 5: the verdict card**, plus *Copy report* (plain text, no IP addresses; contains the verdict, all step results and the code lengths).

The **No pairing needed** tab holds the single-device checks (device report, picker read speed including a OneDrive file, storage, download, share target, tabs and database). The **Advanced tests** tab holds the old manual pairing, same-network listing and USB check.

## Pairing code size (measured)

The code is not the full WebRTC description. Only the ICE user fragment and password, the DTLS fingerprint and the UDP candidates (address and port) are kept; the rest is rebuilt on the other side. It is encoded in Crockford base32 and grouped in fives.

| Case | Characters |
|---|---|
| Offer, two `.local` (mDNS) candidates (typical Chrome / Edge on Wi-Fi) | about 200 |
| Answer, one IPv4 candidate (typical USB tethering) | about 140 |
| The old full text format | about 800 to 1500 |

So a typed code is possible but tedious (140 to 200 characters); *Copy and send to yourself* is the recommended route and the typed code is the backup. The app shows the actual length on screen and puts it in the report. If the browser rejects a short code, tick *Use the long code* in Connection options on both devices.

## What the verdict can say

| Verdict | When |
|---|---|
| **DIRECT LINK WORKS (x MB/s; a daily sync of 500 MB would take about M min)** | connected, every hash matched, speed 1 MB/s or more (the slower direction is used) |
| **WORKS BUT SLOW** | connected and intact but under 1 MB/s |
| **DOES NOT WORK RELIABLY** | connected but data or the file arrived damaged |
| **DOES NOT WORK: no direct link could be opened** | never connected: the text explains client isolation, firewall / VPN and hidden `.local` names, then lists what to try (USB tethering with the exact tablet setting names, VPN off, the STUN option, fall back to Share/PC-helper routes) |
| **TEST NOT FINISHED** | connected but a test step did not complete |

## Decision table: result -> possible ITN sync design

| Results | Design that becomes possible | Daily workflow |
|---|---|---|
| Verdict **DIRECT LINK WORKS** on office Wi-Fi | **A. Direct link** | Open ITN on both, click *Sync*; a pairing step the first time (and after each page reload). |
| Verdict fails on Wi-Fi but **works on USB tethering** or hotspot | **B. USB tethering (or hotspot) + direct link** | Plug in the cable, switch on tethering once, open both, click *Sync*. Needs tethering allowed by company policy. |
| No direct link anywhere; **Share target PASS** (No pairing needed tab) | **C. OneDrive folder + Share target** | Export a sync file on one device, share it to ITN (or OneDrive) on the other: two steps, avoids the in-browser OneDrive picker. |
| No direct link; picker read of a OneDrive file slow or stalls | **C'. Read from a locally stored copy** | Copy the file to local storage first, then pick it. |
| None of the browser-only routes pass; Explorer still sees the tablet (MTP) | **D. A small PC helper program** | A helper approved by IT copies via MTP/Explorer to a folder ITN reads. Outside the browser. |
| USB check FAIL/NOT SUPPORTED on a tablet in file-transfer mode | (expected) | The cable alone can not be driven by a web page without debugging, which is off the table. It only helps as tethering (B). |

Order of preference when several pass: **A**, then **B**, then **C**, then **D**.

## Running the tests

```
node --test linktest/tests/
```

* `core.test.mjs`: chunker, back-pressure and ETA, SHA-256 against Node, block hasher, hash check, long-code text, candidate parsing and redaction, report formatter, QR round trip for every version 1-40.
* `wizard.test.mjs`: **wizard state machine** (Next only after a pass, Back always, link-opened shortcut, auto-advance rules per mode), **compact code encode/decode round trip** (mDNS, IPv4, srflx, IPv6; typing mistakes; wrong kind; damaged), measured code lengths, **verdict logic** with synthetic results (works / slow / unreliable / incomplete / not connected, advice not repeated once tried, no IP addresses).
* `static.test.mjs`: strict CSP, no inline code, no network calls, only the mode choice in `sessionStorage`, every element id used by the scripts exists, manifest and icons valid.
* `smoke/edge_smoke.mjs` (outside `tests/` on purpose): `node linktest/smoke/edge_smoke.mjs`. Starts a local server and headless Edge, loads the page, checks the first screen and wizard step 1, makes a real short code, **loops two peer connections through the compact code format to prove the browser accepts the rebuilt descriptions and opens a data channel**, and runs the single-device safe tests.

## Known limits

* Not yet run in a real browser by the author: the wizard screens, the camera scan and the compact-code acceptance are covered by Node logic tests and by the smoke test written for Edge, not by an actual run. Run the smoke test first; if its loopback line fails, the long code (*Use the long code*) is the built-in fallback.
* The QR generator is verified by encode -> decode in Node (including error-correction) but not against a real scanner.
* A secure (https) page cannot call a plain-http address on the local network, so there is no "type the other device's IP" probe; the link test is the reachability test.
* Browsers hide real local IPs behind `.local` names; if the company network blocks that lookup the link can fail even on the same Wi-Fi, and USB tethering avoids it.
* The offer/answer must be exchanged again after a page reload (there is no server to remember it).
* The received test file is kept in memory on the receiving page (6 MB in the full test).
