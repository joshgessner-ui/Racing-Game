/* ============================================================
   input.js — reading the player's steering.

   Three sources, in priority order:
     1. TILT   — physically tilting the phone/tablet (the default).
     2. TOUCH  — hold the left/right half of the screen (fallback).
     3. KEYS   — arrow keys, so you can test on a laptop.

   Everything below produces one number: RC.input.steer,
   which is -1 (hard left) .. 0 (straight) .. +1 (hard right).
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  RC.input = {
    steer: 0,          // the final steering value the car reads
    firePressed: false, // set true for one frame when the player taps
    mode: 'tilt',      // 'tilt' | 'touch'
    tiltAvailable: false,
    tiltPermission: 'unknown', // 'unknown' | 'granted' | 'denied' | 'unsupported'
    sensitivity: 1.0,  // how far you must tilt. Higher = twitchier.
    invert: false,
    deadzone: 2.5,     // degrees of tilt ignored, so a resting hand drives straight

    _rawTilt: 0,       // most recent tilt reading, in degrees
    _neutral: 0,       // the "holding it comfortably" angle captured on calibration
    _touchSteer: 0,
    _keySteer: 0,
    _smoothed: 0,
  };

  /* ---------- Tilt ---------- */

  // A phone reports its orientation as three angles. Which one means
  // "tilted left/right" depends on whether you're holding the device in
  // portrait or landscape, so we rotate the reading to match the screen.
  function tiltFromEvent(e) {
    const beta = e.beta || 0;   // front-to-back tilt
    const gamma = e.gamma || 0; // left-to-right tilt

    let angle = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      angle = screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
      angle = window.orientation;
    }
    const rad = angle * Math.PI / 180;

    // In portrait (angle 0) this is just gamma. In landscape it becomes beta.
    return gamma * Math.cos(rad) + beta * Math.sin(rad);
  }

  function onOrientation(e) {
    if (e.gamma === null && e.beta === null) return; // no real sensor data
    RC.input.tiltAvailable = true;
    RC.input._rawTilt = tiltFromEvent(e);
  }

  // iOS 13+ requires an explicit permission prompt, and it must be triggered
  // by a real tap. That's why this is called from a button, not on page load.
  RC.input.requestTilt = async function () {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      RC.input.tiltPermission = 'unsupported';
      RC.input.mode = 'touch';
      return false;
    }

    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') {
          RC.input.tiltPermission = 'denied';
          RC.input.mode = 'touch';
          return false;
        }
      } catch (err) {
        RC.input.tiltPermission = 'denied';
        RC.input.mode = 'touch';
        return false;
      }
    }

    RC.input.tiltPermission = 'granted';
    window.addEventListener('deviceorientation', onOrientation, true);

    // The sensor may simply never fire (desktop, tablet with no gyro).
    // Give it a moment, and quietly fall back to touch if nothing arrives.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (!RC.input.tiltAvailable) {
      RC.input.tiltPermission = 'unsupported';
      RC.input.mode = 'touch';
      return false;
    }

    RC.input.mode = 'tilt';
    RC.input.calibrate();
    return true;
  };

  // Capture however the player is currently holding the device and call
  // that "straight ahead". Lets you play lying down, in a car seat, anywhere.
  RC.input.calibrate = function () {
    RC.input._neutral = RC.input._rawTilt;
  };

  /* ---------- Touch fallback + tap-to-fire ---------- */

  RC.input.attach = function (el) {
    const active = new Map(); // touch id -> which half of the screen

    function halfOf(clientX) {
      return clientX < window.innerWidth / 2 ? -1 : 1;
    }

    function recompute() {
      let s = 0;
      for (const dir of active.values()) s += dir;
      RC.input._touchSteer = RC.clamp(s, -1, 1);
    }

    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) active.set(t.identifier, halfOf(t.clientX));
      recompute();
      RC.input.firePressed = true; // every tap also fires your item
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (active.has(t.identifier)) active.set(t.identifier, halfOf(t.clientX));
      }
      recompute();
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) active.delete(t.identifier);
      recompute();
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);

    // Mouse, so the game is playable while you're building it on a laptop.
    let mouseDown = false;
    el.addEventListener('mousedown', (e) => {
      mouseDown = true;
      RC.input._touchSteer = halfOf(e.clientX);
      RC.input.firePressed = true;
    });
    el.addEventListener('mousemove', (e) => {
      if (mouseDown) RC.input._touchSteer = halfOf(e.clientX);
    });
    window.addEventListener('mouseup', () => { mouseDown = false; RC.input._touchSteer = 0; });

    // Keyboard
    const keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.add('l');
      if (e.key === 'ArrowRight' || e.key === 'd') keys.add('r');
      if (e.key === ' ' || e.key === 'Enter') { RC.input.firePressed = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.delete('l');
      if (e.key === 'ArrowRight' || e.key === 'd') keys.delete('r');
    });
    RC.input._readKeys = () => (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
  };

  /* ---------- Called once per frame by the game loop ---------- */

  RC.input.update = function (dt) {
    let target = 0;

    if (RC.input.mode === 'tilt' && RC.input.tiltAvailable) {
      // How far from "neutral" are we, in degrees?
      let deg = RC.input._rawTilt - RC.input._neutral;

      // Ignore tiny wobbles so a steady hand goes perfectly straight.
      const dz = RC.input.deadzone;
      deg = deg > dz ? deg - dz : deg < -dz ? deg + dz : 0;

      // 22 degrees of tilt = full lock at sensitivity 1.0.
      const fullLock = 22 / RC.input.sensitivity;
      target = RC.clamp(deg / fullLock, -1, 1);
    } else {
      target = RC.input._touchSteer;
    }

    const k = RC.input._readKeys ? RC.input._readKeys() : 0;
    if (k !== 0) target = k;

    if (RC.input.invert) target = -target;

    // Smooth the raw reading a little. Phone gyros are noisy, and this
    // stops the car from twitching while you hold it still.
    RC.input._smoothed = RC.damp(RC.input._smoothed, target, 18, dt);
    RC.input.steer = RC.input._smoothed;
  };

  RC.input.consumeFire = function () {
    const f = RC.input.firePressed;
    RC.input.firePressed = false;
    return f;
  };

  RC.input.reset = function () {
    RC.input._touchSteer = 0;
    RC.input._smoothed = 0;
    RC.input.steer = 0;
    RC.input.firePressed = false;
  };
})();
