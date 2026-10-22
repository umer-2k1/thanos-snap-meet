/*
 * segmenter.js  —  optional person segmentation (graceful stub)
 *
 * The premium "empty room revealed behind you" look needs a person/background
 * mask so that only YOU dissolve while the real room stays put. That requires a
 * body-segmentation model (e.g. MediaPipe Selfie Segmentation).
 *
 * meet.google.com ships a strict Content-Security-Policy, so we cannot pull a
 * model from a CDN at runtime from the page's MAIN world. A working model must
 * instead be bundled under vendor/ and wired in here. Until that is present we
 * report `available = false` and the pipeline falls back to a full-frame
 * dissolve, which looks great and works everywhere.
 *
 * This module exposes a stable interface so the model can be dropped in later
 * without touching the pipeline:
 *    Segmenter.available        -> boolean
 *    Segmenter.init()           -> Promise<boolean>
 *    Segmenter.mask(frame, w, h)-> canvas with person alpha, or null
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  const Segmenter = {
    available: false,
    _ready: false,

    async init() {
      // No bundled model -> stay in full-frame mode. Hook real init here.
      this._ready = false;
      this.available = false;
      TS.log("segmenter: running in full-frame mode (no bundled model)");
      return this.available;
    },

    /**
     * Return a canvas whose alpha channel marks person pixels, or null when
     * segmentation is unavailable (pipeline then treats the whole frame as you).
     */
    mask(/* frame, w, h */) {
      return null;
    }
  };

  TS.Segmenter = Segmenter;
  TS.log("segmenter loaded");
})();
