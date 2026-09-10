/* ============================================================
   audio.js — all the sound is generated in code.

   There are no .mp3 files to download, which keeps the game tiny and
   means it loads instantly on a phone. Browsers refuse to make noise
   until the player has tapped something, so everything starts muted
   until RC.audio.start() is called from a real tap.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  RC.audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    engineFilter: null,
    enabled: true,
    ready: false,
  };

  RC.audio.start = function () {
    if (RC.audio.ctx) {
      if (RC.audio.ctx.state === 'suspended') RC.audio.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    const ctx = RC.audio.ctx = new AC();
    const master = RC.audio.master = ctx.createGain();
    master.gain.value = RC.audio.enabled ? 0.5 : 0;
    master.connect(ctx.destination);

    // The engine: a buzzy sawtooth run through a filter. Raising its pitch
    // and opening the filter as you speed up is enough to read as "engine".
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 400;
    filt.Q.value = 3;

    const g = ctx.createGain();
    g.gain.value = 0;

    osc.connect(filt); filt.connect(g); g.connect(master);
    osc.start();

    RC.audio.engineOsc = osc;
    RC.audio.engineGain = g;
    RC.audio.engineFilter = filt;
    RC.audio.ready = true;
  };

  RC.audio.setEnabled = function (on) {
    RC.audio.enabled = on;
    if (RC.audio.master) {
      RC.audio.master.gain.setTargetAtTime(on ? 0.5 : 0, RC.audio.ctx.currentTime, 0.05);
    }
  };

  // Called every frame with the player's speed as a 0..1 fraction.
  RC.audio.engine = function (rev, load) {
    if (!RC.audio.ready) return;
    const t = RC.audio.ctx.currentTime;
    RC.audio.engineOsc.frequency.setTargetAtTime(52 + rev * 190, t, 0.06);
    RC.audio.engineFilter.frequency.setTargetAtTime(320 + rev * 1500, t, 0.08);
    RC.audio.engineGain.gain.setTargetAtTime(load * 0.11, t, 0.08);
  };

  // One short tone. Everything else in the game is built from this.
  function blip(freq, dur, type, vol, sweepTo) {
    if (!RC.audio.ready || !RC.audio.enabled) return;
    const ctx = RC.audio.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(RC.audio.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A burst of noise, for explosions and bumps.
  function noise(dur, vol, cutoff) {
    if (!RC.audio.ready || !RC.audio.enabled) return;
    const ctx = RC.audio.ctx, t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(RC.audio.master);
    src.start(t);
  }

  RC.audio.pickup = () => blip(660, 0.10, 'square', 0.16, 990);
  RC.audio.upgrade = () => { blip(523, 0.09, 'square', 0.18); setTimeout(() => blip(784, 0.14, 'square', 0.18), 90); };
  RC.audio.drop = () => blip(200, 0.16, 'triangle', 0.14, 90);
  RC.audio.turbo = () => blip(300, 0.35, 'sawtooth', 0.13, 1400);
  RC.audio.zip = () => blip(520, 0.09, 'triangle', 0.10, 1040);
  RC.audio.thud = (v) => noise(0.09, 0.10 * v, 500);
  RC.audio.count = (final) => blip(final ? 880 : 440, final ? 0.4 : 0.16, 'square', 0.22);
  RC.audio.finish = () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'square', 0.2), i * 110));
  };
  RC.audio.fail = () => { blip(300, 0.3, 'sawtooth', 0.18, 120); setTimeout(() => blip(200, 0.4, 'sawtooth', 0.16, 80), 220); };
})();
