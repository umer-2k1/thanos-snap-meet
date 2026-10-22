/*
 * config.js  —  shared namespace + tunable settings
 *
 * Every module in this extension runs in the page's MAIN world at
 * document_start and shares a single global namespace: window.__THANOS_SNAP.
 * Loading order is defined in manifest.json; this file must be first.
 */
(function () {
  "use strict";

  if (window.__THANOS_SNAP) return; // guard against double injection

  const TS = {
    /** Build / debug */
    DEBUG: false,

    /** Current high-level state of the user's presence. */
    state: "live", // "live" | "vanishing" | "gone" | "returning"

    /** Tunables for the snap detector (audio transient detection). */
    snap: {
      // Minimum instantaneous loudness (RMS, 0..1) to even consider a snap.
      rmsThreshold: 0.14,
      // How many times louder than the rolling background the transient must be.
      spikeRatio: 3.0,
      // Fraction of energy that must sit in the high band (snaps are bright/broadband).
      highBandRatio: 0.35,
      // Ignore further triggers for this long after one fires (ms).
      cooldownMs: 1200,
      // Smoothing factor for the rolling background energy estimate.
      backgroundDecay: 0.96
    },

    /** Tunables for the dust / disintegration effect. */
    dust: {
      // Duration of the dissolve, in milliseconds.
      vanishMs: 4200,
      // Duration of the re-materialise, in milliseconds.
      returnMs: 3200,
      // Sample the source frame every N pixels -> one particle each.
      sampleStep: 5,
      // Wind direction (particles drift up and to the right, Thanos-style).
      wind: { x: 0.6, y: -0.9 },
      // Random turbulence applied to each particle.
      turbulence: 0.5,
      // Max particles (safety cap for performance).
      maxParticles: 24000
    },

    /** Whether to also try to click Meet's own on-screen mic button. */
    clickMeetMuteButton: true,

    log(...args) {
      if (this.DEBUG) console.log("%c[ThanosSnap]", "color:#a855f7;font-weight:bold", ...args);
    }
  };

  // Allow the popup / page to flip debug on at runtime.
  try {
    if (localStorage.getItem("thanos_snap_debug") === "1") TS.DEBUG = true;
  } catch (_) {}

  window.__THANOS_SNAP = TS;
  TS.log("config loaded");
})();
