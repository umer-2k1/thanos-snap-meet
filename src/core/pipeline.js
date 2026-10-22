/*
 * pipeline.js  —  camera + microphone interception and orchestration
 *
 * This is the spine of the extension. It overrides getUserMedia so that Meet
 * never touches your real devices directly. Instead:
 *
 *   VIDEO:  real camera -> <video> -> <canvas> (per-frame draw) -> captureStream
 *           Normally the canvas is a straight copy of the camera. On a snap we
 *           render the dust effect onto it instead, so every participant sees
 *           you disintegrate.
 *
 *   AUDIO:  real mic is cloned twice (exactly the reference's "key trick"):
 *             clone A -> SnapDetector         (NEVER muted; hears the return snap)
 *             clone B -> GainNode -> Meet      (gain 1 = live, gain 0 = muted)
 *
 * A single snap toggles you between "live" and "gone", muting instantly.
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || !mediaDevices.getUserMedia) {
    TS.log("getUserMedia unavailable; extension inert");
    return;
  }
  const originalGUM = mediaDevices.getUserMedia.bind(mediaDevices);

  const Pipeline = {
    dust: new TS.DustEngine(),
    video: null, // { rawTrack, videoEl, canvas, ctx, stream, raf, w, h }
    audio: null, // { ctx, gain, detector, destTrack }
    busy: false, // true while an animation is playing

    /* ---------------------------------------------------------------- VIDEO */
    async _wrapVideoTrack(rawTrack) {
      // Meet calls getUserMedia more than once (device preview, then join).
      // Tear down any previous render loop so we don't leak rAF callbacks.
      if (this.video && this.video.raf) cancelAnimationFrame(this.video.raf);

      const videoEl = document.createElement("video");
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = new MediaStream([rawTrack]);
      await videoEl.play().catch(() => {});

      const settings = rawTrack.getSettings();
      const w = settings.width || videoEl.videoWidth || 640;
      const h = settings.height || videoEl.videoHeight || 480;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      const fps = settings.frameRate || 30;
      const stream = canvas.captureStream(fps);
      const outTrack = stream.getVideoTracks()[0];
      // Let Meet's "stop camera" button still work on the real device.
      const origStop = outTrack.stop.bind(outTrack);
      outTrack.stop = () => { origStop(); try { rawTrack.stop(); } catch (_) {} };

      const bgPlate = this._mkCanvas(w, h);
      const work = this._mkCanvas(w, h);
      this.video = {
        rawTrack, videoEl, canvas, ctx, stream, raf: 0, w, h,
        bgPlate, plateCtx: bgPlate.getContext("2d"),
        work, workCtx: work.getContext("2d"),
        plateSeeded: false, plateReady: false
      };
      this._renderLoop();
      TS.log("video pipeline ready", w + "x" + h);
      return outTrack;
    },

    _mkCanvas(w, h) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    },

    _segActive() {
      const s = TS.Segmenter;
      return !!(s && s.available && s.hasMask);
    },

    _renderLoop() {
      const v = this.video;
      if (!v) return;
      const draw = () => {
        v.raf = requestAnimationFrame(draw);
        const now = performance.now();
        const st = TS.state;
        const seg = TS.Segmenter;

        // Keep the mask + empty-room plate fresh whenever you're present.
        if (seg && seg.available && (st === "live" || st === "gone")) {
          seg.update(v.videoEl, v.w, v.h);
          if (seg.hasMask) this._accumulatePlate();
        }

        if (st === "live") {
          try { v.ctx.drawImage(v.videoEl, 0, 0, v.w, v.h); } catch (_) {}
        } else if (st === "vanishing" || st === "returning") {
          const stillAnimating = this.dust.render(v.ctx, now);
          if (!stillAnimating) {
            TS.state = st === "vanishing" ? "gone" : "live";
            this.busy = false;
            TS.onStateChange && TS.onStateChange(TS.state);
          }
        } else if (st === "gone") {
          if (this._segActive() && v.plateReady) this._drawGoneComposite();
          else this.dust.drawGhost(v.ctx, v.w, v.h);
        }
      };
      draw();
    },

    // Fold the current background (everything that isn't you) into the plate,
    // so over time we hold a clean, person-free image of the room.
    _accumulatePlate() {
      const v = this.video, seg = TS.Segmenter;
      if (!v.plateSeeded) {
        // Seed with a dim, blurred frame so holes are never pure black even
        // before the plate has filled in with real background.
        v.plateCtx.filter = "blur(12px) brightness(0.5)";
        v.plateCtx.drawImage(v.videoEl, 0, 0, v.w, v.h);
        v.plateCtx.filter = "none";
        v.plateSeeded = true;
      }
      const wc = v.workCtx;
      wc.globalCompositeOperation = "source-over";
      wc.clearRect(0, 0, v.w, v.h);
      wc.drawImage(v.videoEl, 0, 0, v.w, v.h);
      // Erase you from the copy, leaving only background pixels.
      wc.globalCompositeOperation = "destination-out";
      wc.filter = "blur(3px)";
      wc.drawImage(seg.maskCanvas, 0, 0, v.w, v.h);
      wc.filter = "none";
      wc.globalCompositeOperation = "source-over";
      // Paint those fresh background pixels onto the plate.
      v.plateCtx.drawImage(v.work, 0, 0, v.w, v.h);
      v.plateReady = true;
    },

    // While "gone": show the live room but keep yourself painted out using the
    // accumulated empty-room plate, so any real background motion still shows.
    _drawGoneComposite() {
      const v = this.video, seg = TS.Segmenter;
      v.ctx.globalCompositeOperation = "source-over";
      v.ctx.clearRect(0, 0, v.w, v.h);
      v.ctx.drawImage(v.videoEl, 0, 0, v.w, v.h);
      // plate ∩ you  ->  cover the live you with empty room.
      const wc = v.workCtx;
      wc.globalCompositeOperation = "source-over";
      wc.clearRect(0, 0, v.w, v.h);
      wc.drawImage(v.bgPlate, 0, 0, v.w, v.h);
      wc.globalCompositeOperation = "destination-in";
      wc.filter = "blur(3px)";
      wc.drawImage(seg.maskCanvas, 0, 0, v.w, v.h);
      wc.filter = "none";
      wc.globalCompositeOperation = "source-over";
      v.ctx.drawImage(v.work, 0, 0, v.w, v.h);
    },

    _freezeFrame() {
      const v = this.video;
      const c = this._mkCanvas(v.w, v.h);
      c.getContext("2d").drawImage(v.videoEl, 0, 0, v.w, v.h);
      return c;
    },

    // A person-only copy of the current frame (background made transparent).
    _freezePerson() {
      const v = this.video, seg = TS.Segmenter;
      const c = this._mkCanvas(v.w, v.h);
      const cx = c.getContext("2d");
      cx.drawImage(v.videoEl, 0, 0, v.w, v.h);
      cx.globalCompositeOperation = "destination-in";
      cx.filter = "blur(2px)";
      cx.drawImage(seg.maskCanvas, 0, 0, v.w, v.h);
      cx.filter = "none";
      return c;
    },

    // A stable copy of the plate so the revealed room doesn't shift mid-animation.
    _plateSnapshot() {
      const v = this.video;
      const c = this._mkCanvas(v.w, v.h);
      c.getContext("2d").drawImage(v.bgPlate, 0, 0, v.w, v.h);
      return c;
    },

    /* ---------------------------------------------------------------- AUDIO */
    _wrapAudioTrack(rawTrack) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));

      // Branch B: the gated track Meet actually receives.
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(dest);

      // Branch A: always-on snap detection off the raw source.
      const detector = new TS.SnapDetector(ctx, src, () => this.toggle());

      ctx.resume && ctx.resume().catch(() => {});
      this.audio = { ctx, gain, detector, rawTrack, destTrack: dest.stream.getAudioTracks()[0] };
      TS.log("audio pipeline ready (mic cloned twice)");
      return this.audio.destTrack;
    },

    setMeetAudioMuted(muted) {
      if (!this.audio) return;
      const g = this.audio.gain.gain;
      const t = this.audio.ctx.currentTime;
      g.cancelScheduledValues(t);
      // A quick ramp avoids an audible click.
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(muted ? 0 : 1, t + 0.03);
      if (TS.clickMeetMuteButton) this._syncMeetMuteButton(muted);
    },

    // Best-effort: make Meet's own on-screen mic button match our state.
    _syncMeetMuteButton(muted) {
      try {
        const btn = document.querySelector(
          '[aria-label*="microphone" i],[data-tooltip*="microphone" i]'
        );
        if (!btn) return;
        const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || "").toLowerCase();
        const currentlyOn = /turn off/.test(label); // "Turn off microphone" => mic is ON
        if (muted && currentlyOn) btn.click();
        else if (!muted && !currentlyOn) btn.click();
      } catch (_) {}
    },

    /* ----------------------------------------------------------- STATE SWAP */
    toggle() {
      if (this.busy || !this.video) return;
      if (TS.state === "live") this.vanish();
      else if (TS.state === "gone") this.rematerialise();
    },

    vanish() {
      this.busy = true;
      TS.state = "vanishing";
      this.setMeetAudioMuted(true); // mute INSTANTLY at the snap
      const v = this.video;
      if (this._segActive() && v.plateReady) {
        // Person-only: only you dissolve; the real room is revealed.
        this.dust.vanish(this._freezePerson(), v.w, v.h, this._plateSnapshot());
      } else {
        // Fallback: the whole frame dissolves to a dim ghost of the room.
        this.dust.vanish(this._freezeFrame(), v.w, v.h, null);
      }
      TS.onStateChange && TS.onStateChange("vanishing");
      TS.log("vanishing + muted", this._segActive() ? "(person-only)" : "(full-frame)");
    },

    rematerialise() {
      this.busy = true;
      TS.state = "returning";
      const v = this.video;
      if (this._segActive() && v.plateReady) {
        this.dust.rematerialise(this._freezePerson(), v.w, v.h, this._plateSnapshot());
      } else {
        this.dust.rematerialise(this._freezeFrame(), v.w, v.h, null);
      }
      this.setMeetAudioMuted(false); // unmute as you reappear
      TS.onStateChange && TS.onStateChange("returning");
      TS.log("returning + unmuted");
    },

    /* --------------------------------------------------- getUserMedia proxy */
    async handleGUM(constraints) {
      const real = await originalGUM(constraints);
      try {
        const outTracks = [];
        for (const track of real.getTracks()) {
          if (track.kind === "video" && constraints && constraints.video) {
            outTracks.push(await this._wrapVideoTrack(track));
          } else if (track.kind === "audio" && constraints && constraints.audio) {
            // Always hand Meet the single gated track so muting is honoured no
            // matter how many times it re-requests the mic. A later real track
            // is redundant, so release it.
            if (this.audio) { try { track.stop(); } catch (_) {} outTracks.push(this.audio.destTrack); }
            else outTracks.push(this._wrapAudioTrack(track));
          } else {
            outTracks.push(track);
          }
        }
        return new MediaStream(outTracks);
      } catch (err) {
        console.error("[ThanosSnap] pipeline error, falling back to raw stream", err);
        return real;
      }
    }
  };

  // Install the override.
  mediaDevices.getUserMedia = function (constraints) {
    TS.log("getUserMedia intercepted", constraints);
    return Pipeline.handleGUM(constraints || {});
  };
  // Keep the legacy alias pointing at the same thing.
  if (navigator.getUserMedia) {
    navigator.getUserMedia = function (c, ok, err) {
      Pipeline.handleGUM(c).then(ok, err);
    };
  }

  TS.Pipeline = Pipeline;
  TS.log("pipeline installed; getUserMedia overridden");
})();
