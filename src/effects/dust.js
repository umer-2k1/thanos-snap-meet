/*
 * dust.js  —  the Thanos disintegration particle engine
 *
 * Operates purely on <canvas> surfaces so it can plug straight into the
 * camera pipeline. The frame that is on screen at the moment of the snap is
 * frozen and sampled into thousands of tiny particles; those particles then
 * drift away on a wind vector, desaturating into ash as they fade — leaving a
 * dim "ghost" of the room behind. Snapping again runs the whole thing in
 * reverse so the dust reconverges into you.
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;

  class DustEngine {
    constructor() {
      this.particles = [];
      this.width = 0;
      this.height = 0;
      this.mode = "idle"; // "idle" | "vanish" | "return"
      this.startTime = 0;
      this.duration = 0;
      // Scratch canvas used to read pixels from the frozen frame.
      this._sample = document.createElement("canvas");
      this._sampleCtx = this._sample.getContext("2d", { willReadFrequently: true });
      // The dim backdrop revealed once everything has turned to ash.
      this.ghost = document.createElement("canvas");
      this._ghostCtx = this.ghost.getContext("2d");
    }

    /** Is the engine currently producing an animated (non-passthrough) frame? */
    get active() {
      return this.mode !== "idle";
    }

    /**
     * Build the particle field from the current frame.
     * @param {HTMLCanvasElement|HTMLVideoElement} source frozen frame to sample
     * @param {number} w output width
     * @param {number} h output height
     */
    _build(source, w, h) {
      const cfg = TS.dust;
      this.width = w;
      this.height = h;

      // Downsample the source so each cell becomes one particle.
      const step = cfg.sampleStep;
      const cols = Math.floor(w / step);
      const rows = Math.floor(h / step);
      this._sample.width = cols;
      this._sample.height = rows;
      this._sampleCtx.drawImage(source, 0, 0, cols, rows);
      const data = this._sampleCtx.getImageData(0, 0, cols, rows).data;

      // Normalise the wind vector so "delay" sweeps across the image.
      const wx = cfg.wind.x, wy = cfg.wind.y;
      const wlen = Math.hypot(wx, wy) || 1;
      const nwx = wx / wlen, nwy = wy / wlen;

      const particles = [];
      const cap = cfg.maxParticles;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const i = (gy * cols + gx) * 4;
          const a = data[i + 3];
          if (a < 10) continue; // skip transparent (masked-out) pixels
          const px = gx * step;
          const py = gy * step;

          // Dissolve sweep: windward edge disintegrates first, plus jitter.
          const proj = (px * -nwx + py * -nwy) / (w + h);
          const delay = clamp(proj + 0.5 + (Math.random() - 0.5) * 0.35, 0, 1);

          particles.push({
            ox: px, oy: py,
            x: px, y: py,
            r: data[i], g: data[i + 1], b: data[i + 2],
            size: step + 1,
            delay,
            // Per-particle drift, biased along the wind vector.
            vx: (nwx + (Math.random() - 0.5) * cfg.turbulence) * (40 + Math.random() * 120),
            vy: (nwy + (Math.random() - 0.5) * cfg.turbulence) * (40 + Math.random() * 120),
            rot: Math.random() * Math.PI,
            flutter: 0.5 + Math.random()
          });
          if (particles.length >= cap) break;
        }
        if (particles.length >= cap) break;
      }
      this.particles = particles;
      TS.log("dust: built", particles.length, "particles");

      // Pre-render the dim "ghost room" backdrop that remains after the dust.
      this.ghost.width = w;
      this.ghost.height = h;
      const g = this._ghostCtx;
      g.clearRect(0, 0, w, h);
      g.filter = "blur(14px) brightness(0.45) saturate(0.5)";
      g.drawImage(source, 0, 0, w, h);
      g.filter = "none";
      // Subtle vignette so it clearly reads as "nobody's here".
      const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      g.fillStyle = vg;
      g.fillRect(0, 0, w, h);
    }

    /** Begin disintegrating. */
    vanish(source, w, h) {
      this._build(source, w, h);
      this.mode = "vanish";
      this.startTime = performance.now();
      this.duration = TS.dust.vanishMs;
    }

    /** Begin re-materialising from the given (current) frame. */
    rematerialise(source, w, h) {
      this._build(source, w, h);
      this.mode = "return";
      this.startTime = performance.now();
      this.duration = TS.dust.returnMs;
    }

    /**
     * Render one animated frame into `ctx`.
     * @returns {boolean} true while animating, false once finished.
     */
    render(ctx, now) {
      if (this.mode === "idle") return false;
      const w = this.width, h = this.height;
      const p = clamp((now - this.startTime) / this.duration, 0, 1);
      const vanishing = this.mode === "vanish";
      // "return" is just time reversed.
      const prog = vanishing ? p : 1 - p;

      // Base layer: the dim ghost room shows through more as dust clears.
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = clamp(prog * 1.3, 0, 1);
      ctx.drawImage(this.ghost, 0, 0, w, h);
      ctx.globalAlpha = 1;

      const spread = 0.55; // how staggered the particle start times are
      const parts = this.particles;
      for (let k = 0; k < parts.length; k++) {
        const pt = parts[k];
        // Local progress for this particle, staggered by its delay.
        let local = (prog - pt.delay * spread) / (1 - spread);
        local = clamp(local, 0, 1);

        if (local <= 0) {
          // Still solid: draw the original pixel in place.
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgb(${pt.r},${pt.g},${pt.b})`;
          ctx.fillRect(pt.ox, pt.oy, pt.size, pt.size);
          continue;
        }

        const e = easeOutCubic(local);
        const t = local * (this.duration / 1000);
        // Fly out on the wind, with a little gravity + flutter.
        const x = pt.ox + pt.vx * t * e;
        const y = pt.oy + pt.vy * t * e + 30 * t * t * pt.flutter;
        const alpha = 1 - e;
        if (alpha <= 0.02) continue;

        // Desaturate toward warm ash as the particle disperses.
        const ash = e * 0.6;
        const r = pt.r + (150 - pt.r) * ash;
        const gg = pt.g + (140 - pt.g) * ash;
        const b = pt.b + (130 - pt.b) * ash;
        const size = pt.size * (1 - e * 0.6);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;

      if (p >= 1) {
        if (vanishing) {
          this.mode = "idle";
          this._showGhostOnly = true;
          return false; // finished vanishing -> pipeline takes over "gone" frames
        } else {
          this.mode = "idle";
          this._showGhostOnly = false;
          return false; // finished returning -> back to passthrough
        }
      }
      return true;
    }

    /** Draw just the dim ghost room (used while fully "gone"). */
    drawGhost(ctx, w, h) {
      if (!this.ghost.width) return;
      ctx.drawImage(this.ghost, 0, 0, w, h);
    }
  }

  TS.DustEngine = DustEngine;
  TS.log("dust engine loaded");
})();
