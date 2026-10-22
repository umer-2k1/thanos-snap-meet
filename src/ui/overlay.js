/*
 * overlay.js  —  on-screen status bar
 *
 * A small floating pill that shows your live mic/presence state, mirroring the
 * reference's "purple bar shows mic state live: LIVE / MUTED". It also exposes
 * a manual toggle (click, or Shift+S) as a fallback for when you'd rather not
 * rely on snap detection.
 */
(function () {
  "use strict";
  const TS = window.__THANOS_SNAP;

  const Overlay = {
    el: null,
    dot: null,
    label: null,

    mount() {
      if (this.el || !document.body) return;
      const el = document.createElement("div");
      el.id = "thanos-snap-overlay";
      el.innerHTML =
        '<span class="ts-dot"></span><span class="ts-label">LIVE</span>' +
        '<span class="ts-hint">snap or Shift+S</span>';
      const style = document.createElement("style");
      style.textContent = `
        #thanos-snap-overlay{
          position:fixed; z-index:2147483647; bottom:92px; left:50%;
          transform:translateX(-50%); display:flex; align-items:center; gap:8px;
          padding:7px 14px; border-radius:999px; cursor:pointer; user-select:none;
          font:600 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
          color:#fff; letter-spacing:.3px; backdrop-filter:blur(8px);
          background:rgba(20,20,24,.72); box-shadow:0 6px 24px rgba(0,0,0,.35);
          border:1px solid rgba(255,255,255,.12); transition:all .25s ease;
        }
        #thanos-snap-overlay .ts-dot{
          width:9px; height:9px; border-radius:50%; background:#22c55e;
          box-shadow:0 0 10px #22c55e; transition:all .25s ease;
        }
        #thanos-snap-overlay .ts-hint{
          opacity:.55; font-weight:500; font-size:11px; letter-spacing:.2px;
        }
        #thanos-snap-overlay.ts-muted{ background:rgba(88,28,135,.82);
          border-color:rgba(168,85,247,.5); }
        #thanos-snap-overlay.ts-muted .ts-dot{ background:#a855f7;
          box-shadow:0 0 12px #a855f7; }
        #thanos-snap-overlay.ts-busy{ background:rgba(76,29,149,.9); }
        #thanos-snap-overlay.ts-busy .ts-dot{ background:#e9d5ff; animation:tsPulse .6s infinite; }
        @keyframes tsPulse{50%{opacity:.3}}
      `;
      document.documentElement.appendChild(style);
      document.body.appendChild(el);
      el.addEventListener("click", () => TS.Pipeline && TS.Pipeline.toggle());
      this.el = el;
      this.dot = el.querySelector(".ts-dot");
      this.label = el.querySelector(".ts-label");
      TS.log("overlay mounted");
    },

    set(state) {
      if (!this.el) return;
      this.el.classList.remove("ts-muted", "ts-busy");
      const hint = this.el.querySelector(".ts-hint");
      switch (state) {
        case "live":
          this.label.textContent = "LIVE";
          hint.textContent = "snap or Shift+S";
          break;
        case "vanishing":
          this.el.classList.add("ts-busy");
          this.label.textContent = "VANISHING…";
          hint.textContent = "muting";
          break;
        case "gone":
          this.el.classList.add("ts-muted");
          this.label.textContent = "MUTED · GONE";
          hint.textContent = "snap to return";
          break;
        case "returning":
          this.el.classList.add("ts-busy");
          this.label.textContent = "RETURNING…";
          hint.textContent = "unmuting";
          break;
      }
    }
  };

  TS.onStateChange = (s) => Overlay.set(s);

  // Keyboard fallback trigger.
  window.addEventListener("keydown", (e) => {
    if (e.shiftKey && (e.key === "S" || e.key === "s") && !e.repeat) {
      const tag = (e.target && e.target.tagName) || "";
      if (/INPUT|TEXTAREA/.test(tag) || (e.target && e.target.isContentEditable)) return;
      TS.Pipeline && TS.Pipeline.toggle();
    }
  });

  if (document.body) Overlay.mount();
  else window.addEventListener("DOMContentLoaded", () => Overlay.mount());
  // Meet rebuilds its DOM; keep the overlay alive.
  const keep = setInterval(() => {
    if (!document.getElementById("thanos-snap-overlay") && document.body) {
      Overlay.el = null; Overlay.mount(); Overlay.set(TS.state);
    }
  }, 3000);
  TS._overlayKeep = keep;

  TS.Overlay = Overlay;
  TS.log("overlay loaded");
})();
