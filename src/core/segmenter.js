/*
 * segmenter.js  —  person / background segmentation (BodyPix on TensorFlow.js)
 *
 * Produces a per-frame person mask so that only YOU dissolve while the real
 * room stays put ("empty room revealed behind you").
 *
 * Why BodyPix + the WebGL backend specifically? meet.google.com ships a strict
 * CSP (strict-dynamic + require-trusted-types-for 'script'). That blocks the
 * runtime <script>/Function() injection the legacy MediaPipe solutions rely on.
 * BodyPix on the WebGL backend uses no wasm, no eval, and injects no scripts —
 * all of its JS is shipped as browser-injected content scripts (which bypass
 * page CSP) and only the model weights are fetched (allowed: Meet sets no
 * connect-src). If anything here fails, we simply report unavailable and the
 * pipeline falls back to a full-frame dissolve.
 *
 * Interface used by the pipeline:
 *    Segmenter.available        -> boolean
 *    Segmenter.hasMask          -> boolean (a mask has been produced at least once)
 *    Segmenter.maskCanvas       -> small canvas, white where the person is
 *    Segmenter.init()           -> Promise<boolean>
 *    Segmenter.update(frame)     -> kick an async segmentation (throttled)
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  const INTERNAL_W = 256; // segmentation input width (keeps it fast)

  const Segmenter = {
    available: false,
    hasMask: false,
    net: null,
    _busy: false,
    maskCanvas: null,
    _mctx: null,
    _in: null,
    _inctx: null,

    async _vendorBase() {
      // The ISOLATED bridge publishes this; wait briefly for it.
      for (let i = 0; i < 40; i++) {
        const b = document.documentElement.dataset.tsVendorBase;
        if (b) return b;
        await new Promise((r) => setTimeout(r, 25));
      }
      return null;
    },

    async init() {
      try {
        if (!window.tf || !window.bodyPix) {
          TS.log("segmenter: tf/bodyPix not present -> full-frame mode");
          return false;
        }
        const base = await this._vendorBase();
        if (!base) {
          TS.log("segmenter: no vendor base -> full-frame mode");
          return false;
        }

        await window.tf.setBackend("webgl");
        await window.tf.ready();

        this.net = await window.bodyPix.load({
          architecture: "MobileNetV1",
          outputStride: 16,
          multiplier: 0.75,
          quantBytes: 2,
          modelUrl: base + "model/model-stride16.json"
        });

        this._in = document.createElement("canvas");
        this._inctx = this._in.getContext("2d", { willReadFrequently: true });
        this.maskCanvas = document.createElement("canvas");
        this._mctx = this.maskCanvas.getContext("2d");

        this.available = true;
        TS.log("segmenter: BodyPix ready (person-only mode)");
        return true;
      } catch (e) {
        console.warn("[ThanosSnap] segmenter init failed; full-frame mode", e);
        this.available = false;
        return false;
      }
    },

    /** Kick off an async segmentation of `frame`. Throttled by a busy flag. */
    update(frame, w, h) {
      if (!this.available || this._busy || !frame) return;
      const iw = INTERNAL_W;
      const ih = Math.max(2, Math.round((INTERNAL_W * h) / w));
      if (this._in.width !== iw || this._in.height !== ih) {
        this._in.width = iw; this._in.height = ih;
      }
      try {
        this._inctx.drawImage(frame, 0, 0, iw, ih);
      } catch (_) { return; }

      this._busy = true;
      this.net
        .segmentPerson(this._in, {
          internalResolution: "low",
          segmentationThreshold: 0.6,
          maxDetections: 1,
          flipHorizontal: false
        })
        .then((seg) => {
          this._writeMask(seg);
          this._busy = false;
        })
        .catch((e) => {
          TS.log("segmenter: segment error", e);
          this._busy = false;
        });
    },

    _writeMask(seg) {
      const { width, height, data } = seg;
      if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
        this.maskCanvas.width = width;
        this.maskCanvas.height = height;
      }
      const img = this._mctx.createImageData(width, height);
      const px = img.data;
      for (let i = 0; i < data.length; i++) {
        const on = data[i] ? 255 : 0;
        const j = i * 4;
        px[j] = 255; px[j + 1] = 255; px[j + 2] = 255; px[j + 3] = on;
      }
      this._mctx.putImageData(img, 0, 0);
      this.hasMask = true;
    }
  };

  TS.Segmenter = Segmenter;
  TS.log("segmenter loaded (BodyPix)");
})();
