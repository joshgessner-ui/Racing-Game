/* ============================================================
   input.js — reading the player's controls.

   A thumbstick on the left says WHICH WAY you want to go, and two buttons
   on the right brake and fire. The car accelerates by itself.

   The important idea: the stick gives a DIRECTION, not a turn. Push it
   north-west and the car turns until it is heading north-west, then holds
   that line. That only works because the camera no longer rotates - what
   is up on the screen is always up in the world, so "push where you want
   to go" means the same thing everywhere on the track.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  RC.input = {
    // What the car reads each frame:
    dirX: 0, dirY: 0,     // the direction you're asking for, as a unit vector
    active: false,        // is the stick pushed far enough to mean anything
    brake: false,
    firePressed: false,

    // How hard the car corrects towards the direction you asked for.
    // Higher feels sharper; the car still can't turn faster than its tyres.
    response: 2.8,

    // How far you must push before it counts, as a fraction of the stick's
    // travel. Stops a resting thumb from twitching the car.
    deadzone: 0.24,

    _stickTouch: null,    // which finger is on the stick
    _brakeTouch: null,
    _fireTouch: null,
    _homeX: 0, _homeY: 0, // where the stick sits when untouched
    _baseX: 0, _baseY: 0, // where it sits right now
    _radius: 52,
    _keys: new Set(),
    _el: {},
  };

  const I = RC.input;

  /* ---------- Wiring ---------- */

  RC.input.attach = function (els) {
    I._el = els;
    layoutStick();
    window.addEventListener('resize', layoutStick);

    // One set of listeners on the window handles every finger at once, which
    // is what lets you steer and brake and fire at the same time.
    window.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onEnd, { passive: false });

    // Mouse and keyboard, so the game is playable on a laptop.
    els.stick.addEventListener('mousedown', (e) => {
      I._stickTouch = 'mouse';
      setBase(e.clientX, e.clientY);
      moveKnob(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (I._stickTouch === 'mouse') moveKnob(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (I._stickTouch === 'mouse') releaseStick();
      I._brakeTouch = null; I.brake = false;
      setPressed(els.brake, false); setPressed(els.fire, false);
    });
    els.fire.addEventListener('mousedown', () => { I.firePressed = true; setPressed(els.fire, true); });
    els.brake.addEventListener('mousedown', () => { I.brake = true; setPressed(els.brake, true); });

    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));
  };

  function onKey(down) {
    return (e) => {
      const k = e.key;
      const map = {
        ArrowUp: 'u', w: 'u', ArrowDown: 'd', s: 'd',
        ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r',
      };
      if (map[k]) { down ? I._keys.add(map[k]) : I._keys.delete(map[k]); e.preventDefault(); }
      if (k === 'Shift') { I.brake = down; setPressed(I._el.brake, down); }
      if (down && (k === ' ' || k === 'Enter')) { I.firePressed = true; e.preventDefault(); }
    };
  }

  /* ---------- The thumbstick ---------- */

  // Where the stick rests when nobody is touching it, and how far it travels.
  //
  // Measuring a hidden element gives back a rectangle of all zeros, so this
  // refuses to record a zero size. Without that guard the travel radius was
  // 0 whenever this ran before the HUD was shown, every push worked out as
  // 0/0, and the stick was simply dead for the first touch of the race.
  function layoutStick() {
    const r = I._el.stick.getBoundingClientRect();
    if (r.width <= 0) return false;
    I._homeX = r.left + r.width / 2;
    I._homeY = r.top + r.height / 2;
    I._radius = r.width * 0.34;
    if (I._stickTouch === null) { I._baseX = I._homeX; I._baseY = I._homeY; }
    return true;
  }
  RC.input.layout = layoutStick;

  // The stick jumps to wherever your thumb lands, rather than making you
  // find it. On a phone you are not looking at your thumb, you are looking
  // at the corner you are about to miss.
  function setBase(x, y) {
    I._baseX = x; I._baseY = y;
    const el = I._el.stick;
    el.style.left = (x - el.offsetWidth / 2) + 'px';
    el.style.top = (y - el.offsetHeight / 2) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.classList.add('live');
  }

  function moveKnob(x, y) {
    // Last line of defence: if we still have no measurement, take one now.
    if (!(I._radius > 0) && !layoutStick()) return;

    let dx = x - I._baseX, dy = y - I._baseY;
    const len = Math.hypot(dx, dy);
    const max = I._radius;
    const clamped = Math.min(len, max);
    const ux = len > 0 ? dx / len : 0;
    const uy = len > 0 ? dy / len : 0;

    I._el.knob.style.transform =
      'translate(' + (ux * clamped) + 'px,' + (uy * clamped) + 'px)';

    const mag = clamped / max;
    if (mag >= I.deadzone) { I.active = true; I.dirX = ux; I.dirY = uy; }
    else { I.active = false; }
  }

  function releaseStick() {
    I._stickTouch = null;
    I.active = false;
    const el = I._el.stick;
    el.classList.remove('live');
    el.style.left = ''; el.style.top = '';
    el.style.right = ''; el.style.bottom = '';
    I._el.knob.style.transform = 'translate(0,0)';
    layoutStick();
  }

  /* ---------- Touch routing ---------- */

  function setPressed(el, on) { if (el) el.classList.toggle('down', on); }

  // Which control did this finger land on?
  function zoneOf(t) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el) {
      if (el.closest('#btnFire')) return 'fire';
      if (el.closest('#btnBrake')) return 'brake';
      if (el.closest('.screen') || el.closest('#btnPause')) return 'ui';
    }
    // Anywhere on the lower-left of the screen steers.
    if (t.clientX < window.innerWidth * 0.55 && t.clientY > window.innerHeight * 0.3) return 'stick';
    return 'none';
  }

  function onStart(e) {
    let handled = false;
    for (const t of e.changedTouches) {
      const z = zoneOf(t);
      if (z === 'ui' || z === 'none') continue;
      handled = true;
      if (z === 'fire') {
        I._fireTouch = t.identifier; I.firePressed = true; setPressed(I._el.fire, true);
      } else if (z === 'brake') {
        I._brakeTouch = t.identifier; I.brake = true; setPressed(I._el.brake, true);
      } else if (I._stickTouch === null) {
        I._stickTouch = t.identifier;
        setBase(t.clientX, t.clientY);
        moveKnob(t.clientX, t.clientY);
      }
    }
    // Only swallow the event if we actually used it, so menu buttons and
    // scrolling still behave normally.
    if (handled) e.preventDefault();
  }

  function onMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === I._stickTouch) { moveKnob(t.clientX, t.clientY); e.preventDefault(); }
    }
  }

  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === I._stickTouch) releaseStick();
      if (t.identifier === I._fireTouch) { I._fireTouch = null; setPressed(I._el.fire, false); }
      if (t.identifier === I._brakeTouch) {
        I._brakeTouch = null; I.brake = false; setPressed(I._el.brake, false);
      }
    }
  }

  /* ---------- Per frame ---------- */

  RC.input.update = function () {
    // Keyboard overrides the stick, so arrow keys work on a desktop.
    if (I._keys.size) {
      let kx = (I._keys.has('r') ? 1 : 0) - (I._keys.has('l') ? 1 : 0);
      let ky = (I._keys.has('d') ? 1 : 0) - (I._keys.has('u') ? 1 : 0);
      const len = Math.hypot(kx, ky);
      if (len > 0) { I.dirX = kx / len; I.dirY = ky / len; I.active = true; }
    }
  };

  RC.input.consumeFire = function () {
    const f = I.firePressed;
    I.firePressed = false;
    return f;
  };

  RC.input.reset = function () {
    releaseStick();
    I.brake = false;
    I.firePressed = false;
    I._brakeTouch = I._fireTouch = null;
    I._keys.clear();
    setPressed(I._el.brake, false);
    setPressed(I._el.fire, false);
  };
})();
