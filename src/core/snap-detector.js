/*
 * snap-detector.js  —  detect a finger snap in a live audio stream
 *
 * A finger snap is a short, loud, broadband transient: energy jumps far above
 * the running background level and a big chunk of it sits in the high band.
 * We watch an AnalyserNode and fire `onSnap` on the rising edge of such an
 * event, with a cooldown so one snap can't trigger twice.
 *
 * Crucially this runs on a clone of the mic that is NEVER muted, so it can
 * still hear your "come back" snap while Meet is receiving silence.
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  class SnapDetector {
    constructor(audioCtx, sourceNode, onSnap) {
      this.ctx = audioCtx;
      this.onSnap = onSnap;
      this.enabled = true;
      this.lastTrigger = 0;
      this.background = 0.02; // rolling background RMS estimate

      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.0;
      sourceNode.connect(this.analyser);

      this._time = new Float32Array(this.analyser.fftSize);
      this._freq = new Uint8Array(this.analyser.frequencyBinCount);
      this._raf = 0;
      this._loop = this._loop.bind(this);
      this._loop();
    }

    setEnabled(v) {
      this.enabled = v;
    }

    _loop() {
      this._raf = requestAnimationFrame(this._loop);
      if (!this.enabled) return;

      const cfg = TS.snap;
      const a = this.analyser;

      // --- overall loudness (RMS) in the time domain ---
      a.getFloatTimeDomainData(this._time);
      let sum = 0;
      for (let i = 0; i < this._time.length; i++) {
        const v = this._time[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this._time.length);

      // --- how "bright" the sound is (high-band share) ---
      a.getByteFrequencyData(this._freq);
      const n = this._freq.length;
      const split = Math.floor(n * 0.5); // upper half of spectrum = "high"
      let low = 0, high = 0;
      for (let i = 0; i < n; i++) {
        if (i < split) low += this._freq[i];
        else high += this._freq[i];
      }
      const total = low + high;
      const highRatio = total > 0 ? high / total : 0;

      const now = performance.now();
      const isSpike =
        rms > cfg.rmsThreshold &&
        rms > this.background * cfg.spikeRatio &&
        highRatio > cfg.highBandRatio;

      if (isSpike && now - this.lastTrigger > cfg.cooldownMs) {
        this.lastTrigger = now;
        TS.log("snap! rms=", rms.toFixed(3), "high=", highRatio.toFixed(2));
        try { this.onSnap(); } catch (e) { console.error("[ThanosSnap] onSnap error", e); }
      }

      // Update the rolling background only when it's quiet, so a sustained
      // loud voice doesn't desensitise us to snaps.
      if (rms < cfg.rmsThreshold) {
        this.background = this.background * cfg.backgroundDecay + rms * (1 - cfg.backgroundDecay);
      }
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      try { this.analyser.disconnect(); } catch (_) {}
    }
  }

  TS.SnapDetector = SnapDetector;
  TS.log("snap detector loaded");
})();
