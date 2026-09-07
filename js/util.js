/* ============================================================
   util.js — small math helpers used everywhere else.
   If you're new to code: this file has no game logic in it.
   It's just a toolbox of tiny functions.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC = window.RC || {};

  RC.TAU = Math.PI * 2;

  // Keep a number inside a range. clamp(15, 0, 10) === 10
  RC.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Blend between a and b. lerp(0, 100, 0.5) === 50
  RC.lerp = (a, b, t) => a + (b - a) * t;

  // Frame-rate independent smoothing. Use instead of lerp(a,b,0.1) in a loop.
  RC.damp = (a, b, rate, dt) => RC.lerp(a, b, 1 - Math.exp(-rate * dt));

  // Map a value from one range to another, clamped.
  RC.mapRange = (v, a1, b1, a2, b2) => {
    const t = RC.clamp((v - a1) / (b1 - a1), 0, 1);
    return a2 + (b2 - a2) * t;
  };

  // Wrap an angle into -PI..PI so turning never takes "the long way round".
  RC.wrapAngle = (a) => {
    while (a > Math.PI) a -= RC.TAU;
    while (a < -Math.PI) a += RC.TAU;
    return a;
  };

  // Shortest signed turn from angle a to angle b.
  RC.angleDelta = (a, b) => RC.wrapAngle(b - a);

  RC.dist2 = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  };
  RC.dist = (ax, ay, bx, by) => Math.sqrt(RC.dist2(ax, ay, bx, by));

  // A seeded random number generator, so a track always looks the same
  // every time you play it instead of reshuffling on each load.
  RC.makeRng = (seed) => {
    let s = seed >>> 0 || 1;
    return function rng() {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  };

  RC.pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

  // "1st", "2nd", "3rd", "4th"...
  RC.ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // Turn 83.4 seconds into "1:23.40"
  RC.formatTime = (sec) => {
    if (!isFinite(sec) || sec < 0) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };

  // Save / load progress in the browser. Wrapped in try/catch because
  // private browsing modes can throw when you touch localStorage.
  RC.SAVE_KEY = 'rcproam.save.v1';
  RC.loadSave = () => {
    try {
      const raw = localStorage.getItem(RC.SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  RC.writeSave = (obj) => {
    try { localStorage.setItem(RC.SAVE_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  };
})();
