/* ============================================================
   input.js — reading the player's controls.

   A four-way cross on the left, two buttons on the right.

     LEFT / RIGHT  turn the car, for as long as you hold them
     DOWN          brake
     UP            nothing (it's there so the cross looks like a cross)
     TURBO         a burst of speed from a meter that refills
     FIRE          use whatever item you're carrying

   Left and right ROTATE the car rather than pointing it somewhere. Hold
   right and it keeps turning; let go and it holds the line it's on. That is
   how R.C. Pro-Am worked, and it's why the controls no longer fight you:
   an earlier version aimed the car at a compass bearing, so holding a
   direction through a curve made the car stubbornly sit on that bearing
   while the track bent away underneath it.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  RC.input = {
    steer: 0,          // -1 hard left .. +1 hard right
    brake: false,
    turbo: false,
    firePressed: false,

    _pad: null,        // which finger is on the d-pad
    _turboTouch: null,
    _fireTouch: null,
    _cx: 0, _cy: 0, _r: 60,   // d-pad centre and size
    _held: { l: false, r: false, u: false, d: false },
    _keys: new Set(),
    _el: {},
  };

  const I = RC.input;

  /* ---------- Wiring ---------- */

  RC.input.attach = function (els) {
    I._el = els;
    layoutPad();
    window.addEventListener('resize', layoutPad);

    // One set of listeners on the window handles every finger at once, so you
    // can steer, brake and fire in the same instant.
    window.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onEnd, { passive: false });

    // Mouse and keyboard, so the game is playable on a laptop.
    els.pad.addEventListener('mousedown', (e) => { I._pad = 'mouse'; readPad(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (I._pad === 'mouse') readPad(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => {
      if (I._pad === 'mouse') releasePad();
      I.turbo = false; press(els.turbo, false); press(els.fire, false);
    });
    els.fire.addEventListener('mousedown', () => { I.firePressed = true; press(els.fire, true); });
    els.turbo.addEventListener('mousedown', () => { I.turbo = true; press(els.turbo, true); });

    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));
  };

  function onKey(down) {
    return (e) => {
      const map = { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r',
                    ArrowDown: 'd2', s: 'd2', ArrowUp: 'u', w: 'u' };
      const k = map[e.key];
      if (k) { down ? I._keys.add(k) : I._keys.delete(k); e.preventDefault(); }
      if (e.key === 'Shift') { I.turbo = down; press(I._el.turbo, down); }
      if (down && (e.key === ' ' || e.key === 'Enter')) { I.firePressed = true; e.preventDefault(); }
    };
  }

  /* ---------- The cross ---------- */

  // Measuring a hidden element gives back a rectangle of zeros, so refuse to
  // record one - otherwise the pad is dead until the next time this runs.
  function layoutPad() {
    const r = I._el.pad.getBoundingClientRect();
    if (r.width <= 0) return false;
    I._cx = r.left + r.width / 2;
    I._cy = r.top + r.height / 2;
    I._r = r.width / 2;
    return true;
  }
  RC.input.layout = layoutPad;

  // Which arms is this finger on? Worked out from the direction it sits in
  // relative to the middle, rather than from which arm it is strictly inside.
  // That is far more forgiving with a thumb you cannot see past, and it makes
  // diagonals - turning while braking - fall out for free.
  function readPad(x, y) {
    if (!(I._r > 0) && !layoutPad()) return;
    const dx = x - I._cx, dy = y - I._cy;
    const dead = I._r * 0.22;

    const h = { l: false, r: false, u: false, d: false };
    if (Math.abs(dx) > dead) (dx < 0 ? h.l = true : h.r = true);
    if (Math.abs(dy) > dead) (dy < 0 ? h.u = true : h.d = true);

    // A press that is mostly horizontal shouldn't also count as vertical.
    if (h.d && Math.abs(dx) > Math.abs(dy) * 2.2) h.d = false;
    if ((h.l || h.r) && Math.abs(dy) > Math.abs(dx) * 2.2) { h.l = false; h.r = false; }

    I._held = h;
    applyHeld();
  }

  function applyHeld() {
    const h = I._held;
    I.steer = (h.r ? 1 : 0) - (h.l ? 1 : 0);
    I.brake = h.d;
    const e = I._el;
    press(e.padL, h.l); press(e.padR, h.r); press(e.padD, h.d); press(e.padU, h.u);
  }

  function releasePad() {
    I._pad = null;
    I._held = { l: false, r: false, u: false, d: false };
    applyHeld();
  }

  /* ---------- Touch routing ---------- */

  // NB: the pressed class must not be one of the arm names. It used to be
  // 'down', which collided with the down arm's own class - the first reset
  // stripped it, the arm lost its place in the grid, and the cross came out
  // shaped wrong.
  function press(el, on) { if (el) el.classList.toggle('pressed', on); }

  function zoneOf(t) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el) {
      if (el.closest('#btnFire')) return 'fire';
      if (el.closest('#btnTurbo')) return 'turbo';
      if (el.closest('.screen') || el.closest('#btnPause')) return 'ui';
    }
    // A generous catchment around the cross, so you don't have to look at it.
    const dx = t.clientX - I._cx, dy = t.clientY - I._cy;
    if (Math.hypot(dx, dy) < I._r * 2.1) return 'pad';
    return 'none';
  }

  function onStart(e) {
    let used = false;
    for (const t of e.changedTouches) {
      const z = zoneOf(t);
      if (z === 'ui' || z === 'none') continue;
      used = true;
      if (z === 'fire') { I._fireTouch = t.identifier; I.firePressed = true; press(I._el.fire, true); }
      else if (z === 'turbo') { I._turboTouch = t.identifier; I.turbo = true; press(I._el.turbo, true); }
      else if (I._pad === null) { I._pad = t.identifier; readPad(t.clientX, t.clientY); }
    }
    if (used) e.preventDefault();
  }

  function onMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === I._pad) { readPad(t.clientX, t.clientY); e.preventDefault(); }
    }
  }

  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === I._pad) releasePad();
      if (t.identifier === I._fireTouch) { I._fireTouch = null; press(I._el.fire, false); }
      if (t.identifier === I._turboTouch) { I._turboTouch = null; I.turbo = false; press(I._el.turbo, false); }
    }
  }

  /* ---------- Per frame ---------- */

  RC.input.update = function () {
    if (I._keys.size) {
      I.steer = (I._keys.has('r') ? 1 : 0) - (I._keys.has('l') ? 1 : 0);
      I.brake = I._keys.has('d2');
    }
  };

  RC.input.consumeFire = function () {
    const f = I.firePressed;
    I.firePressed = false;
    return f;
  };

  RC.input.reset = function () {
    releasePad();
    I.turbo = false;
    I.firePressed = false;
    I._turboTouch = I._fireTouch = null;
    I._keys.clear();
    press(I._el.turbo, false);
    press(I._el.fire, false);
  };
})();
