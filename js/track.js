/* ============================================================
   track.js — turns a handful of control points into a real circuit.

   The idea: a track is a closed loop of points down its middle (the
   "centreline"). Once we have that, almost everything else falls out:
     - where the tarmac is        (centreline +/- half the width)
     - are you on the road?       (how far you are from the centreline)
     - what lap are you on?       (how far along the centreline you are)
     - where should the AI aim?   (a point further along the centreline)
     - how sharp is the next bend?(how fast the centreline is turning)
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  // Distance between centreline samples, in world units. Smaller = smoother
  // track but more memory. 18 is a good balance for a phone.
  const SPACING = 18;

  // A Catmull-Rom spline: draws a smooth curve that passes exactly through
  // every control point. This is what stops our tracks looking like polygons.
  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
  }

  RC.buildTrack = function (def) {
    const cps = def.points;
    const n = cps.length;

    // 1. Sample the spline densely, all the way round the loop.
    const dense = [];
    const STEPS = 24;
    for (let i = 0; i < n; i++) {
      const p0 = cps[(i - 1 + n) % n], p1 = cps[i];
      const p2 = cps[(i + 1) % n], p3 = cps[(i + 2) % n];
      for (let s = 0; s < STEPS; s++) dense.push(catmullRom(p0, p1, p2, p3, s / STEPS));
    }

    // 2. Re-walk that dense curve at a constant spacing. This matters a lot:
    //    it means "index 100" is always the same distance along the track as
    //    "index 50" was from "index 0", which makes lap maths trivial.
    const pts = [];
    let carry = 0;
    for (let i = 0; i < dense.length; i++) {
      const a = dense[i], b = dense[(i + 1) % dense.length];
      const segLen = RC.dist(a[0], a[1], b[0], b[1]);
      if (segLen < 1e-6) continue;
      let d = carry;
      while (d < segLen) {
        const t = d / segLen;
        pts.push([RC.lerp(a[0], b[0], t), RC.lerp(a[1], b[1], t)]);
        d += SPACING;
      }
      carry = d - segLen;
    }

    const count = pts.length;

    // 3. Precompute everything we'll want per-frame, so the game loop
    //    only ever has to look values up rather than recalculate them.
    const tangents = new Float32Array(count * 2); // direction of travel
    const normals = new Float32Array(count * 2);  // 90 degrees to the left
    const curvature = new Float32Array(count);    // how sharp the bend is (always positive)
    const curveSigned = new Float32Array(count);  // + means the track bends left
    const headings = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const a = pts[(i - 1 + count) % count];
      const b = pts[(i + 1) % count];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      tangents[i * 2] = tx; tangents[i * 2 + 1] = ty;
      normals[i * 2] = -ty; normals[i * 2 + 1] = tx;
      headings[i] = Math.atan2(ty, tx);
    }
    for (let i = 0; i < count; i++) {
      // Curvature = how much the heading changes per unit of distance.
      const d = RC.angleDelta(headings[(i - 2 + count) % count], headings[(i + 2) % count]);
      curveSigned[i] = d / (SPACING * 4);
      curvature[i] = Math.abs(curveSigned[i]);
    }

    // 4. The tarmac edges.
    const halfWidth = def.halfWidth || 105;
    const left = new Float32Array(count * 2);
    const right = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      left[i * 2] = pts[i][0] + normals[i * 2] * halfWidth;
      left[i * 2 + 1] = pts[i][1] + normals[i * 2 + 1] * halfWidth;
      right[i * 2] = pts[i][0] - normals[i * 2] * halfWidth;
      right[i * 2 + 1] = pts[i][1] - normals[i * 2 + 1] * halfWidth;
    }

    // 5. How big is this track? Used to frame the minimap.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, left[i * 2], right[i * 2]);
      maxX = Math.max(maxX, left[i * 2], right[i * 2]);
      minY = Math.min(minY, left[i * 2 + 1], right[i * 2 + 1]);
      maxY = Math.max(maxY, left[i * 2 + 1], right[i * 2 + 1]);
    }

    const track = {
      def, pts, count, tangents, normals, curvature, curveSigned, headings,
      left, right, halfWidth, spacing: SPACING,
      length: count * SPACING,
      bounds: { minX, minY, maxX, maxY },
      name: def.name,
      laps: def.laps || 3,
      theme: def.theme,
      zips: [],   // speed strips baked into the tarmac
      items: [],  // crates and upgrades, filled in by items.js
    };

    /* ---- Queries the rest of the game uses ---- */

    // Which bit of centreline is this point nearest to?
    // `hint` is the answer from last frame: searching outwards from there is
    // both much faster AND stops a car "teleporting" to the far side of a
    // hairpin, which would wreck lap counting.
    track.locate = function (x, y, hint) {
      let bestI = 0, bestD = Infinity;
      if (hint === undefined || hint === null) {
        for (let i = 0; i < count; i++) {
          const d = RC.dist2(x, y, pts[i][0], pts[i][1]);
          if (d < bestD) { bestD = d; bestI = i; }
        }
      } else {
        const RANGE = 45;
        for (let k = -RANGE; k <= RANGE; k++) {
          const i = (hint + k + count * 2) % count;
          const d = RC.dist2(x, y, pts[i][0], pts[i][1]);
          if (d < bestD) { bestD = d; bestI = i; }
        }
      }
      // How far to the left (+) or right (-) of the centreline are we?
      const px = x - pts[bestI][0], py = y - pts[bestI][1];
      const offset = px * normals[bestI * 2] + py * normals[bestI * 2 + 1];
      return { index: bestI, offset, dist: Math.sqrt(bestD) };
    };

    track.onRoad = function (offset) { return Math.abs(offset) <= halfWidth; };

    // A point `ahead` samples further down the track, pushed `side` units
    // off the centreline. This is how the AI picks its racing line.
    track.pointAt = function (index, side) {
      const i = ((index % count) + count) % count;
      return [
        pts[i][0] + normals[i * 2] * side,
        pts[i][1] + normals[i * 2 + 1] * side,
      ];
    };

    // The sharpest bend within the next `steps` samples. The AI brakes for it.
    track.maxCurvature = function (index, steps) {
      let m = 0;
      for (let k = 0; k < steps; k++) {
        const i = (index + k) % count;
        if (curvature[i] > m) m = curvature[i];
      }
      return m;
    };

    // Average signed bend over the next `steps` samples: positive means the
    // road is about to go left. The AI uses this to pick its racing line.
    track.bendAhead = function (index, steps) {
      let sum = 0;
      for (let k = 0; k < steps; k++) sum += curveSigned[(index + k) % count];
      return sum / steps;
    };

    // Progress round the lap, 0 at the start line, approaching 1 just before it.
    track.progress = function (index) { return index / count; };

    return track;
  };
})();
