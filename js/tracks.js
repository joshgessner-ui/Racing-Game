/* ============================================================
   tracks.js — the five circuits of the championship.

   Rather than hand-placing dozens of corner points (fiddly, and easy to
   accidentally make a track cross over itself), each circuit is described
   as a wobbly circle: a base radius plus a few "waves" added on top.
     - a wave that repeats 2x per lap gives you long sweepers
     - a wave that repeats 6x per lap gives you tight, technical corners
   Stacking a few together gives a varied lap that is guaranteed never to
   overlap itself. Change the numbers and the track changes shape - this is
   the most fun file in the project to experiment with.

   The exact numbers below were solved for rather than eyeballed, so that
   each circuit is about 20 seconds a lap and its tightest corner needs a
   specific speed to get through. That is the difficulty curve of the
   championship, in one row of numbers per track.

   Corner tightness and track width are not independent. If the tarmac's
   half-width ever exceeds the radius of the tightest corner, the inside
   edge folds back through itself and both the drawing and the collision
   break. So widening the last two circuits meant easing their sharpest
   corners to match - the width you can have is set by the corner you keep.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  function ring(opts) {
    // Longer circuits need more control points to stay smooth.
    const n = opts.n || 30;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * RC.TAU;
      let r = opts.base;
      for (const h of opts.waves) r += h.amp * Math.cos(h.k * t + h.phase);
      pts.push([
        Math.cos(t) * r * (opts.sx || 1),
        Math.sin(t) * r * (opts.sy || 1),
      ]);
    }
    return pts;
  }

  RC.TRACK_DEFS = [
    {
      name: 'Sunset Speedway',
      subtitle: 'Wide, fast, forgiving. Learn the controls here.',
      halfWidth: 165,
      laps: 3,
      points: ring({
        base: 1547, sx: 1.24, sy: 1.0, n: 34,
        waves: [
          { k: 2, amp: 468, phase: 0 },
          { k: 3, amp: 257, phase: 0.6 },
          { k: 5, amp: 103, phase: 2.1 },
        ],
      }),
      theme: {
        ground: '#c08348', groundAlt: '#b5793f', tarmac: '#3c3c46',
        accent: '#ff9d4d', sky: '#ffb36b', crowd: '#e8d6b8',
        scenery: 'palm',
      },
    },
    {
      name: 'Harbour Lights',
      subtitle: 'A long back straight and one nasty left.',
      halfWidth: 152,
      laps: 3,
      points: ring({
        base: 1707, sx: 1.16, sy: 0.95, n: 34,
        waves: [
          { k: 3, amp: 480, phase: 0.4 },
          { k: 1, amp: 289, phase: 1.1 },
          { k: 6, amp: 124, phase: 1.7 },
        ],
      }),
      theme: {
        ground: '#1d6a78', groundAlt: '#195c68', tarmac: '#39434d',
        accent: '#4fd6e8', sky: '#7fe3ef', crowd: '#cfe9ee',
        scenery: 'harbour',
      },
    },
    {
      name: 'Neon District',
      subtitle: 'Corners that all seem to arrive at once.',
      halfWidth: 136,
      laps: 3,
      points: ring({
        base: 1810, sx: 1.2, sy: 1.0, n: 36,
        waves: [
          { k: 4, amp: 296, phase: 0.2 },
          { k: 2, amp: 231, phase: 1.9 },
          { k: 7, amp: 87, phase: 0.9 },
        ],
      }),
      theme: {
        ground: '#241b36', groundAlt: '#1e1730', tarmac: '#2f2c40',
        accent: '#ff5ecb', sky: '#6b3fa0', crowd: '#b98fe0',
        scenery: 'city',
      },
    },
    {
      name: 'Canyon Run',
      subtitle: 'Narrow, with a hairpin that bites.',
      halfWidth: 128,
      laps: 3,
      points: ring({
        base: 1880, sx: 1.26, sy: 0.9, n: 38,
        waves: [
          { k: 5, amp: 255, phase: 0.9 },
          { k: 3, amp: 207, phase: 0.3 },
          { k: 2, amp: 133, phase: 2.2 },
          { k: 8, amp: 79, phase: 1.3 },
        ],
      }),
      theme: {
        ground: '#a2472f', groundAlt: '#8f3d28', tarmac: '#464039',
        accent: '#ffd451', sky: '#e78a5c', crowd: '#f0c9a5',
        scenery: 'canyon',
      },
    },
    {
      name: 'Thunder Ridge',
      subtitle: 'The championship decider. Good luck.',
      halfWidth: 120,
      laps: 3,
      points: ring({
        base: 1950, sx: 1.3, sy: 0.96, n: 40,
        waves: [
          { k: 6, amp: 195, phase: 0.5 },
          { k: 4, amp: 180, phase: 2.4 },
          { k: 2, amp: 134, phase: 0.8 },
          { k: 9, amp: 62, phase: 2.0 },
        ],
      }),
      theme: {
        ground: '#2b4739', groundAlt: '#243d31', tarmac: '#34383d',
        accent: '#9dff5e', sky: '#5f7f6a', crowd: '#c6dcc9',
        scenery: 'forest',
      },
    },
  ];
})();
