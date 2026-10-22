/*
 * main.js  —  bootstrap
 *
 * Loaded last. The heavy lifting is installed by each module's own IIFE (the
 * getUserMedia override is already live by the time Meet asks for devices).
 * Here we just kick off optional async init and announce readiness.
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;
  if (!TS) return;

  (async () => {
    try {
      await TS.Segmenter.init();
    } catch (e) {
      TS.log("segmenter init failed (full-frame mode)", e);
    }
    if (TS.Overlay) TS.Overlay.set(TS.state);
    TS.log("Thanos Snap ready ✨  — snap your fingers or press Shift+S");
    console.log(
      "%c✨ Thanos Snap for Meet active",
      "color:#a855f7;font-weight:bold;font-size:13px"
    );
  })();
})();
