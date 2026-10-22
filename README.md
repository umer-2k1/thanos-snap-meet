# ✨ Thanos Snap for Google Meet

Snap your fingers on camera and **disintegrate into dust like Thanos** — every
participant watches you dissolve into thousands of particles while your **mic
mutes instantly**. Snap again and the dust reconverges into you as your mic
unmutes.

> A Chrome (Manifest V3) extension. No servers, no accounts — everything runs
> locally in your browser.

<p align="center">
  <img src="icons/icon128.png" width="96" alt="Thanos Snap icon" />
</p>

## What it does

- **Snap** → you turn to ash over ~4 seconds, a dim "empty room" is revealed, and your microphone goes silent the instant the snap is heard.
- **Snap again** → the dust flies back and re-forms you, and your mic comes back.
- A floating **purple status pill** shows your state live: `LIVE` ↔ `MUTED · GONE`.
- Prefer not to rely on snaps? Click the pill or press <kbd>Shift</kbd>+<kbd>S</kbd>.

## The key trick

Meet never touches your real devices. `getUserMedia` is intercepted and your
streams are rebuilt:

```
VIDEO   camera ──▶ <video> ──▶ <canvas> (per-frame) ──▶ captureStream ──▶ Meet
                                  └─ dust effect renders here on a snap

AUDIO   mic ──┬─▶ SnapDetector        (clone A · NEVER muted · hears your return snap)
              └─▶ GainNode ──▶ Meet   (clone B · gain 1 = live, gain 0 = muted)
```

Because the detection clone is never muted, it can still hear your "come back"
snap even while Meet is receiving pure silence. Muting is done by ramping the
gain to zero (instant, click-free); as a cosmetic touch the extension also tries
to toggle Meet's own on-screen mic button so its UI matches.

## Person-only mode ("empty room revealed behind you")

A body-segmentation model ([BodyPix](https://github.com/tensorflow/tfjs-models/tree/master/body-pix)
on TensorFlow.js) runs on each frame to separate **you** from the room:

- **Only you dissolve.** Particles are sampled from your silhouette; the real
  background is drawn underneath, so the room stays put as you turn to ash.
- **The hole fills in.** While you're present, the extension continuously folds
  the background (everything that isn't you) into a clean *empty-room plate*. When
  you vanish, that plate is what's revealed — and while you're gone it keeps you
  painted out live, so real background motion still shows.

### Why BodyPix on the WebGL backend?

Meet ships a strict CSP: `script-src … 'strict-dynamic'` **and**
`require-trusted-types-for 'script'`. That blocks the runtime `<script>` /
`Function()` injection the legacy MediaPipe *solutions* rely on (see MediaPipe
issue #4028). BodyPix on the **WebGL** backend uses no `wasm`, no `eval`, and
injects no scripts:

- All library JS (`vendor/tf-*.js`, `vendor/body-pix.min.js`) ships as
  **browser-injected content scripts**, which bypass the page CSP entirely.
- Only the **model weights** are fetched at runtime — allowed, because Meet sets
  no `connect-src`/`default-src`, so `chrome-extension://` fetches are permitted.
- An ISOLATED-world [`src/bridge.js`](src/bridge.js) publishes the extension's
  vendor URL to the MAIN world (which has no `chrome.runtime`).

If the model ever fails to load, the extension cleanly falls back to a
**full-frame dissolve** (the whole frame turns to a dim ghost of the room).

## Try the effect instantly (no Meet needed)

Want to see the disintegration before installing? Open a terminal in the repo and run:

```bash
python3 -m http.server 8731
```

Then visit <http://localhost:8731/demo/index.html> and hit **Snap** — it drives the
exact `src/effects/dust.js` engine the extension uses, on a synthetic scene or your webcam.

## Install (unpacked)

1. `git clone https://github.com/umer-2k1/thanos-snap-meet.git`
2. Open `chrome://extensions` and turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `thanos-snap-meet` folder.
4. Open [meet.google.com](https://meet.google.com/) and join a call.
5. Snap your fingers near the mic — or press <kbd>Shift</kbd>+<kbd>S</kbd>.

> Tip: if Meet was already open, reload the tab so the extension can intercept
> the camera/mic before the call starts.

## Project layout

```
manifest.json            MV3 manifest (ISOLATED bridge + MAIN-world content scripts)
src/
  bridge.js              ISOLATED world: publishes the extension's vendor URL
  core/config.js         shared namespace + all tunables
  effects/dust.js        the disintegration particle engine
  core/segmenter.js      BodyPix person/background mask (graceful full-frame fallback)
  core/snap-detector.js  audio transient detection (the snap)
  core/pipeline.js       getUserMedia override + audio/video graph + bg-plate + orchestration
  ui/overlay.js          the LIVE/MUTED status pill + Shift+S fallback
  main.js                bootstrap
  ui/popup.html          toolbar popup
vendor/                  TensorFlow.js + BodyPix (bundled) and the model weights
demo/
  index.html             dust-engine playground
  seg-test.html          person-only segmentation harness (?img=<url> or webcam)
icons/                   extension icons
```

## Tuning

All knobs live in [`src/core/config.js`](src/core/config.js):

| Setting | Meaning |
| --- | --- |
| `snap.rmsThreshold` | how loud a transient must be to count |
| `snap.spikeRatio` | how much louder than the room it must be |
| `snap.highBandRatio` | how "bright" the sound must be (snaps are broadband) |
| `snap.cooldownMs` | ignore further snaps for this long after one fires |
| `dust.vanishMs` / `dust.returnMs` | effect durations |
| `dust.sampleStep` | pixel spacing → particle density |
| `dust.wind` | direction the ash drifts |

Set `localStorage.thanos_snap_debug = "1"` and reload Meet to see detector logs
in the console.

## Notes & limits

- **Person-only "empty room" reveal** is on by default (BodyPix, bundled in
  `vendor/`). The empty-room plate fills in as the background becomes visible, so
  moving around a little right after you join gives the cleanest reveal; on a
  single static frame the hole shows a soft blurred fill instead.
- BodyPix segmentation runs on your GPU (WebGL). On low-end machines it may cost
  a few fps; if the model can't load, the effect falls back to full-frame mode.
- Snap detection is tuned for a clear snap close to the mic; adjust the
  thresholds in `config.js` for your room, or just use <kbd>Shift</kbd>+<kbd>S</kbd>.
- This is a fun/novelty project, not affiliated with Google or Marvel.

## License

MIT — see [LICENSE](LICENSE).
