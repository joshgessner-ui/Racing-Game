/* ============================================================
   render.js — everything you see.

   The camera slides along to follow your car and, by default, stays put
   rotationally - until the car would otherwise end up pointing down the
   screen, at which point it turns just enough to keep it roughly upright.

   This matters more than it sounds. An earlier version turned the camera
   with the car so that you always pointed up the screen, which is the right
   choice for tilt steering - but a world that swings round you every time
   you take a corner makes a lot of people motion sick, and it is not what
   RC Pro-Am looked like. A fixed camera also makes the thumbstick honest:
   up on the stick is up on the screen, wherever you are on the lap.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  RC.view = {
    canvas: null, ctx: null,
    w: 0, h: 0, dpr: 1,
      camX: 0, camY: 0, camRot: 0, zoom: 1,
    // The camera only turns to stop the car going upside down. Limit is how
    // far from upright the car may look before the camera steps in; release
    // is how far back it brings it. Both in radians.
    keepUpright: true,
    uprightDead: 30 * Math.PI / 180,     // camera ignores anything this small
    uprightMaxRate: 1.1,                 // rad/s - the comfort speed limit
    uprightLimit: 135 * Math.PI / 180,   // hard backstop: never past this
    shakeX: 0, shakeY: 0, shake: 0, shakeEnabled: true,
    _visible: null,
  };

  RC.initRender = function (canvas) {
    RC.view.canvas = canvas;
    RC.view.ctx = canvas.getContext('2d', { alpha: false });
    RC.resize();
    window.addEventListener('resize', RC.resize);
    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', () => setTimeout(RC.resize, 120));
    }
  };

  RC.resize = function () {
    const v = RC.view;
    if (!v.canvas) return;
    // Cap the pixel ratio at 2. Some phones report 3 or 4, which quadruples
    // the work for no visible gain and will drop your frame rate.
    v.dpr = Math.min(window.devicePixelRatio || 1, 2);
    v.w = Math.floor(window.innerWidth);
    v.h = Math.floor(window.innerHeight);
    v.canvas.width = Math.floor(v.w * v.dpr);
    v.canvas.height = Math.floor(v.h * v.dpr);
    v.canvas.style.width = v.w + 'px';
    v.canvas.style.height = v.h + 'px';

    // With a fixed camera your car sits in the middle of the screen and you
    // need to see roughly the same distance in EVERY direction, so this keys
    // off the shorter edge. Every device ends up showing about 900 units of
    // track across the narrow side of the screen.
    v.zoom = RC.clamp(Math.min(v.w, v.h) / 900, 0.35, 0.85);
  };

  // Rounded rectangle. Written by hand because ctx.roundRect is missing on
  // older iPad and iPhone browsers.
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---------- Camera ---------- */

  /* ---------- Keeping the car upright without spinning the world ----------

     A camera locked north-up never makes anyone ill, but on a closed circuit
     you spend a quarter of every lap driving down the screen, where pressing
     right sends you left and the controls feel backwards. (The original
     RC Pro-Am dodged this: its tracks scrolled upward, so you always drove
     roughly up the screen.)

     So: leave the camera alone while the car is anywhere near upright, and
     only turn it when the car would otherwise go past upside down. On
     straights and gentle bends it doesn't move at all. The correction has a
     dead zone, a separate release angle so it can't chatter at the boundary,
     and a speed limit so it eases round rather than snapping.
     ------------------------------------------------------------------- */

  function updateCameraRotation(v, car, dt) {
    if (!v.keepUpright) {
      // Unwind smoothly back to north-up rather than snapping.
      v.camRot += RC.angleDelta(v.camRot, 0) * (1 - Math.exp(-5 * dt));
      if (Math.abs(v.camRot) < 0.002) v.camRot = 0;
      return;
    }

    // How far from straight-up does the car LOOK right now? The world is drawn
    // rotated by camRot, so what you see is the car's heading plus that.
    const off = RC.wrapAngle(car.heading + v.camRot + Math.PI / 2);
    const away = Math.abs(off);

    // The car's own rate of turn, so the camera can match it when it has to.
    const hr = v._lastHeading === undefined ? 0
      : Math.abs(RC.angleDelta(v._lastHeading, car.heading)) / Math.max(dt, 1e-4);
    v._lastHeading = car.heading;

    // Inside the dead zone the camera does not move at all. This is what keeps
    // straights and gentle bends completely still.
    if (away <= v.uprightDead) return;

    // Outside it, ease towards upright - gently, and faster the further out we
    // are. The cap is what separates this from the old camera, which simply
    // matched the car and swung the world round at every corner.
    const excess = away - v.uprightDead;
    let rate = Math.min(v.uprightMaxRate, 0.5 + 2.0 * excess);

    // A hard backstop: past the limit, out-turn the car so it can never carry
    // on round to upside down.
    if (away > v.uprightLimit) rate = Math.max(rate, hr + 2.0);

    const step = Math.min(excess, rate * dt);
    v.camRot = RC.wrapAngle(v.camRot - Math.sign(off) * step);
  }

  RC.updateCamera = function (race, dt) {
    const v = RC.view;
    const car = race.playerCar;
    if (!car) return;

    // Look a little way in the direction of travel, so you get some warning
    // of what is coming rather than seeing the corner only once you're in it.
    const lead = RC.clamp(car.speed * 0.22, 0, 150);
    const tx = car.x + Math.cos(car.heading) * lead;
    const ty = car.y + Math.sin(car.heading) * lead;

    v.camX = RC.damp(v.camX, tx, 6.5, dt);
    v.camY = RC.damp(v.camY, ty, 6.5, dt);

    updateCameraRotation(v, car, dt);

    if (v.shake > 0 && RC.view.shakeEnabled) {
      v.shake = Math.max(0, v.shake - dt * 26);
      v.shakeX = (Math.random() - 0.5) * v.shake;
      v.shakeY = (Math.random() - 0.5) * v.shake;
    } else { v.shake = 0; v.shakeX = v.shakeY = 0; }
  };

  function applyWorldTransform(ctx, v) {
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.translate(v.w / 2 + v.shakeX, v.h / 2 + v.shakeY);
    ctx.rotate(v.camRot);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.camX, -v.camY);
  }

  /* ---------- Main draw ---------- */

  RC.draw = function (race) {
    const v = RC.view, ctx = v.ctx;
    const track = race.track;
    const th = track.theme;

    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = th.ground;
    ctx.fillRect(0, 0, v.w, v.h);

    applyWorldTransform(ctx, v);

    // How far can we see? Used to skip drawing anything off-screen.
    const viewR = (Math.hypot(v.w, v.h) / 2) / v.zoom + 200;

    drawGroundTexture(ctx, v, th, viewR);
    drawScenery(ctx, race, track, th, viewR);
    drawRoad(ctx, race, track, th, viewR);
    drawSkids(ctx, race, viewR);
    drawZips(ctx, race, track, th, viewR);
    drawSlicks(ctx, race, viewR);
    drawPickups(ctx, race, track, viewR);
    drawParticles(ctx, race);
    drawCars(ctx, race, viewR);

    // Back to plain screen coordinates for the overlays.
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    drawMinimap(ctx, race);
  };

  /* ---------- Ground ---------- */

  function drawGroundTexture(ctx, v, th, viewR) {
    // A sparse grid of soft blobs. Without something textured out here, the
    // grass reads as a flat colour and you lose all sense of speed.
    const step = 190;
    const x0 = Math.floor((v.camX - viewR) / step) * step;
    const x1 = v.camX + viewR;
    const y0 = Math.floor((v.camY - viewR) / step) * step;
    const y1 = v.camY + viewR;

    ctx.globalAlpha = 0.6;
    ctx.fillStyle = th.groundAlt;
    for (let x = x0; x < x1; x += step) {
      for (let y = y0; y < y1; y += step) {
        // A cheap hash so the pattern looks scattered rather than gridded.
        // Note the >>> shifts: a plain >> treats the hash as signed, which
        // hands back negative numbers and asks the canvas to draw a circle
        // with a negative radius.
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const ox = (h % 100) - 50;
        const oy = ((h >>> 7) % 100) - 50;
        const r = 22 + ((h >>> 14) % 30);
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, RC.TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Road ---------- */

  // Which stretches of centreline are on screen right now?
  function visibleRuns(track, cx, cy, viewR) {
    const v = RC.view;
    if (!v._visible || v._visible.length !== track.count) v._visible = new Uint8Array(track.count);
    const vis = v._visible;
    const r2 = (viewR + track.halfWidth + 60) ** 2;
    for (let i = 0; i < track.count; i++) {
      vis[i] = RC.dist2(cx, cy, track.pts[i][0], track.pts[i][1]) < r2 ? 1 : 0;
    }

    const runs = [];
    let start = -1;
    for (let i = 0; i < track.count; i++) {
      if (vis[i] && start === -1) start = i;
      else if (!vis[i] && start !== -1) { runs.push([start, i - 1]); start = -1; }
    }
    if (start !== -1) runs.push([start, track.count - 1]);
    // If the track is visible across the seam, join the first and last runs.
    if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === track.count - 1) {
      const last = runs.pop();
      runs[0][0] = last[0] - track.count;
    }
    return runs;
  }

  // Reused scratch buffers: one per colour, holding flat x1,y1,x2,y2 runs.
  const KERB = [[], [], []];
  const KERB_COLS = ['#ee4b4b', '#f2f2f2', '#cfcfda'];
  const WALL = [[], []];
  // Slate panels, deliberately NOT red-and-white: that pattern belongs to the
  // kerb alone. Two candy-striped lines running in parallel made it genuinely
  // hard to see where the tarmac ended.
  const WALL_COLS = ['#4c4c59', '#3c3c47'];

  function strokeBuckets(ctx, buckets, colours) {
    for (let bi = 0; bi < buckets.length; bi++) {
      const seg = buckets[bi];
      if (!seg.length) continue;
      ctx.strokeStyle = colours[bi];
      ctx.beginPath();
      for (let j = 0; j < seg.length; j += 4) {
        ctx.moveTo(seg[j], seg[j + 1]);
        ctx.lineTo(seg[j + 2], seg[j + 3]);
      }
      ctx.stroke();
    }
  }

  function stripPath(ctx, track, a, b) {
    const n = track.count;
    ctx.beginPath();
    for (let i = a; i <= b; i++) {
      const k = ((i % n) + n) % n;
      if (i === a) ctx.moveTo(track.left[k * 2], track.left[k * 2 + 1]);
      else ctx.lineTo(track.left[k * 2], track.left[k * 2 + 1]);
    }
    for (let i = b; i >= a; i--) {
      const k = ((i % n) + n) % n;
      ctx.lineTo(track.right[k * 2], track.right[k * 2 + 1]);
    }
    ctx.closePath();
  }


  function drawRoad(ctx, race, track, th, viewR) {
    const v = RC.view;
    // Widen the cull a little so barriers and scenery just off-screen still
    // draw, rather than popping in at the edge of the view.
    const runs = visibleRuns(track, v.camX, v.camY, viewR + 120);
    const n = track.count;

    for (const [a, b] of runs) {
      if (b <= a) continue;

      // Tarmac
      stripPath(ctx, track, a, b);
      ctx.fillStyle = th.tarmac;
      ctx.fill();

      // Kerbs: red and white blocks through the corners, a plain painted line
      // down the straights. The alternation is what makes a corner read as a
      // corner from a distance.
      //
      // Segments are bucketed by colour and each colour drawn as ONE path.
      // Stroking every segment separately was hundreds of draw calls a frame
      // and cost a tablet about eight frames a second on its own.
      for (const bucket of KERB) bucket.length = 0;
      for (let i = a; i < b; i++) {
        const k = ((i % n) + n) % n;
        const k2 = ((i + 1) % n + n) % n;
        const sharp = track.curvature[k] > 0.0012;
        const bi = sharp ? ((Math.floor(i / 3) % 2) === 0 ? 0 : 1) : 2;
        const bucket = KERB[bi];
        bucket.push(track.left[k * 2], track.left[k * 2 + 1],
                    track.left[k2 * 2], track.left[k2 * 2 + 1],
                    track.right[k * 2], track.right[k * 2 + 1],
                    track.right[k2 * 2], track.right[k2 * 2 + 1]);
      }
      ctx.lineWidth = 11;
      ctx.lineCap = 'butt';
      strokeBuckets(ctx, KERB, KERB_COLS);

      // Faint dashes down the middle
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 4;
      ctx.setLineDash([26, 34]);
      ctx.beginPath();
      for (let i = a; i <= b; i++) {
        const k = ((i % n) + n) % n;
        if (i === a) ctx.moveTo(track.pts[k][0], track.pts[k][1]);
        else ctx.lineTo(track.pts[k][0], track.pts[k][1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawBarriers(ctx, track, th, runs);
    drawStartLine(ctx, track);
  }

  // The wall beyond the dirt. It used to be invisible, which made hitting it a
  // surprise - now you can see what you're about to graze.
  function drawBarriers(ctx, track, th, runs) {
    const n = track.count;
    const out = track.halfWidth + (RC.RUNOFF || 62);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 11;
    for (const [a, b] of runs) {
      for (const bucket of WALL) bucket.length = 0;
      for (let i = a; i < b; i++) {
        const k = ((i % n) + n) % n, k2 = ((i + 1) % n + n) % n;
        const bucket = WALL[(Math.floor(i / 4) % 2) === 0 ? 0 : 1];
        for (const side of [1, -1]) {
          bucket.push(
            track.pts[k][0] + track.normals[k * 2] * out * side,
            track.pts[k][1] + track.normals[k * 2 + 1] * out * side,
            track.pts[k2][0] + track.normals[k2 * 2] * out * side,
            track.pts[k2][1] + track.normals[k2 * 2 + 1] * out * side);
        }
      }
      strokeBuckets(ctx, WALL, WALL_COLS);

      // A thin highlight along the top of the wall, so it reads as a solid
      // object rather than a painted line.
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.beginPath();
      for (const bucket of WALL) {
        for (let j = 0; j < bucket.length; j += 4) {
          ctx.moveTo(bucket[j], bucket[j + 1]);
          ctx.lineTo(bucket[j + 2], bucket[j + 3]);
        }
      }
      ctx.stroke();
      ctx.lineWidth = 11;
    }
  }

  function drawStartLine(ctx, track) {
    const i = 0;
    const px = track.pts[i][0], py = track.pts[i][1];
    const nx = track.normals[i * 2], ny = track.normals[i * 2 + 1];
    const tx = track.tangents[i * 2], ty = track.tangents[i * 2 + 1];
    const W = track.halfWidth, D = 26, cols = 12;

    ctx.save();
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 2; r++) {
        if ((c + r) % 2) continue;
        const s0 = -W + (c / cols) * W * 2;
        const s1 = -W + ((c + 1) / cols) * W * 2;
        const d0 = (r - 1) * D, d1 = r * D;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(px + nx * s0 + tx * d0, py + ny * s0 + ty * d0);
        ctx.lineTo(px + nx * s1 + tx * d0, py + ny * s1 + ty * d0);
        ctx.lineTo(px + nx * s1 + tx * d1, py + ny * s1 + ty * d1);
        ctx.lineTo(px + nx * s0 + tx * d1, py + ny * s0 + ty * d1);
        ctx.closePath(); ctx.fill();
      }
    }
    // A gantry across the line, so the start/finish reads at a glance.
    const W2 = W + 26;
    ctx.fillStyle = '#22222c';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(px + nx * W2 * side, py + ny * W2 * side, 11, 0, RC.TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#2b2b36';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(px + nx * W2 + tx * 34, py + ny * W2 + ty * 34);
    ctx.lineTo(px - nx * W2 + tx * 34, py - ny * W2 + ty * 34);
    ctx.stroke();
    ctx.strokeStyle = '#ff9d4d';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.restore();
  }

  /* ---------- Roadside scenery ----------

     All drawn from directly above, like everything else, so it rotates with
     the world without any special handling. Each prop is a handful of canvas
     shapes plus a soft shadow, which is what sells the "toy models on a
     table" look far more cheaply than any texture would.
     ------------------------------------------------------------------- */

  function shadow(ctx, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(r * 0.22, r * 0.30, r, r * 0.86, 0, 0, RC.TAU); ctx.fill();
  }
  const shade = (hex, t) => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t);
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  };

  function drawScenery(ctx, race, track, th, viewR) {
    const v = RC.view;
    const r2 = (viewR + 200) * (viewR + 200);
    for (const p of track.scenery) {
      if (RC.dist2(v.camX, v.camY, p.x, p.y) > r2) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(p.size, p.size);
      drawProp(ctx, p, th);
      ctx.restore();
    }
  }

  function drawProp(ctx, p, th) {
    switch (p.kind) {
      case 'palm': {
        shadow(ctx, 26);
        ctx.fillStyle = '#2f7d4a';
        for (let i = 0; i < 7; i++) {           // fronds, seen from above
          const a = (i / 7) * RC.TAU;
          ctx.save(); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(16, 0, 15, 6, 0, 0, RC.TAU); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#6b4a2a';
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, RC.TAU); ctx.fill();
        break;
      }
      case 'pine': {
        shadow(ctx, 24);
        const g = p.tone < 0.5 ? '#3d9159' : '#347c4c';
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 24, 0, RC.TAU); ctx.fill();
        ctx.fillStyle = shade(g, 0.16);
        ctx.beginPath(); ctx.arc(-3, -3, 15, 0, RC.TAU); ctx.fill();
        ctx.fillStyle = shade(g, 0.34);
        ctx.beginPath(); ctx.arc(-5, -5, 7, 0, RC.TAU); ctx.fill();
        break;
      }
      case 'bush': {
        shadow(ctx, 15);
        ctx.fillStyle = '#3d8a55';
        for (const [dx, dy, r] of [[-7, 0, 10], [7, 2, 9], [0, -6, 9]]) {
          ctx.beginPath(); ctx.arc(dx, dy, r, 0, RC.TAU); ctx.fill();
        }
        break;
      }
      case 'cactus': {
        shadow(ctx, 14);
        ctx.fillStyle = '#4f8f4a';
        rr(ctx, -7, -7, 14, 14, 6); ctx.fill();
        rr(ctx, -22, -5, 16, 10, 5); ctx.fill();
        rr(ctx, 6, -5, 16, 10, 5); ctx.fill();
        break;
      }
      case 'rock': case 'boulder': {
        const r = p.kind === 'rock' ? 13 : 20;
        shadow(ctx, r);
        const base = p.tone < 0.5 ? '#8a8478' : '#77706a';
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.moveTo(-r, 2); ctx.lineTo(-r * 0.4, -r); ctx.lineTo(r * 0.6, -r * 0.7);
        ctx.lineTo(r, r * 0.3); ctx.lineTo(0, r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(base, 0.20);
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -r); ctx.lineTo(r * 0.6, -r * 0.7); ctx.lineTo(0, -r * 0.1);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'spire': {
        shadow(ctx, 22);
        ctx.fillStyle = '#a4573a';
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, RC.TAU); ctx.fill();
        ctx.fillStyle = '#c76d47';
        ctx.beginPath(); ctx.arc(-3, -3, 14, 0, RC.TAU); ctx.fill();
        ctx.fillStyle = '#e08a5c';
        ctx.beginPath(); ctx.arc(-5, -5, 6, 0, RC.TAU); ctx.fill();
        break;
      }
      case 'container': {
        shadow(ctx, 26);
        const cols = ['#c0453e', '#2f7fa8', '#d69b2a', '#3f8a55'];
        const c = cols[Math.floor(p.tone * cols.length) % cols.length];
        ctx.fillStyle = c; rr(ctx, -30, -13, 60, 26, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = shade(c, 0.18);
        for (let i = -24; i < 26; i += 8) ctx.fillRect(i, -11, 3, 22);
        break;
      }
      case 'crate': {
        shadow(ctx, 14);
        ctx.fillStyle = '#9c7440'; rr(ctx, -14, -14, 28, 28, 3); ctx.fill();
        ctx.strokeStyle = '#6d4f2a'; ctx.lineWidth = 3; ctx.stroke();
        break;
      }
      case 'bollard': {
        shadow(ctx, 9);
        ctx.fillStyle = '#4a5560';
        ctx.beginPath(); ctx.arc(0, 0, 9, 0, RC.TAU); ctx.fill();
        ctx.fillStyle = '#9aa6b2';
        ctx.beginPath(); ctx.arc(-1.5, -1.5, 5, 0, RC.TAU); ctx.fill();
        break;
      }
      case 'tower': case 'block': {
        const w = p.kind === 'tower' ? 34 : 52, h = p.kind === 'tower' ? 34 : 30;
        shadow(ctx, Math.max(w, h) * 0.6);
        ctx.fillStyle = '#2b2540'; rr(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill();
        ctx.fillStyle = '#3a3358'; rr(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 3); ctx.fill();
        // Lit windows along the roof edge.
        ctx.fillStyle = p.tone < 0.5 ? 'rgba(255,94,203,0.85)' : 'rgba(120,220,255,0.85)';
        for (let i = -w / 2 + 7; i < w / 2 - 6; i += 9) ctx.fillRect(i, -h / 2 + 1.5, 5, 3);
        break;
      }
      case 'sign': {
        shadow(ctx, 13);
        ctx.fillStyle = '#1d1830'; rr(ctx, -16, -7, 32, 14, 3); ctx.fill();
        ctx.fillStyle = p.tone < 0.5 ? '#ff5ecb' : '#5ee8ff';
        rr(ctx, -13, -4, 26, 8, 2); ctx.fill();
        break;
      }
    }
  }

  /* ---------- Rubber left on the road ----------

     Each car keeps a short trail of where it was while sliding or braking
     hard. Drawing one stroked path per car is far cheaper than hundreds of
     separate marks, and it reads as continuous rubber rather than dashes.
     ------------------------------------------------------------------- */

  const SKID_LIFE = 3.2;

  RC.updateSkids = function (race, dt) {
    for (const car of race.cars) {
      if (!car.skid) { car.skid = []; car._skidT = 0; }
      const fast = car.speed > 150;
      const sliding = fast && !car.offRoad &&
        (car.braking || Math.abs(car.steerInput) > 0.75 || car.spin > 0);

      car._skidT -= dt;
      if (sliding && car._skidT <= 0) {
        car._skidT = 0.045;
        const c = Math.cos(car.heading), s = Math.sin(car.heading);
        car.skid.push({
          x: car.x - c * 17, y: car.y - s * 17, nx: -s, ny: c, t: race.time,
        });
      } else if (!sliding && car.skid.length && car.skid[car.skid.length - 1]) {
        car.skid.push(null);   // a gap, so the next mark starts a new streak
        car._skidT = 0;
      }
      while (car.skid.length && (!car.skid[0] || race.time - car.skid[0].t > SKID_LIFE)) {
        car.skid.shift();
      }
    }
  };

  function drawSkids(ctx, race, viewR) {
    const v = RC.view;
    ctx.strokeStyle = 'rgba(20,18,24,0.30)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const car of race.cars) {
      if (!car.skid || car.skid.length < 2) continue;
      for (const w of [-1, 1]) {          // one streak per rear wheel
        ctx.beginPath();
        let drawing = false;
        for (const m of car.skid) {
          if (!m) { drawing = false; continue; }
          if (RC.dist2(v.camX, v.camY, m.x, m.y) > viewR * viewR) { drawing = false; continue; }
          const x = m.x + m.nx * 15 * w, y = m.y + m.ny * 15 * w;
          if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  /* ---------- Vignette ----------
     Deliberately NOT drawn here. Shading the screen edges on the canvas meant
     alpha-blending every pixel every frame, which cost a tablet nine frames a
     second all by itself - more than the scenery, the kerbs and the skid
     marks put together. It is a static CSS layer over the canvas instead, so
     the browser composites it once on the GPU and the game loop never touches
     it. See #vignette in style.css.
     ------------------------------------------------------------------- */

  /* ---------- Track furniture ---------- */

  function drawZips(ctx, race, track, th, viewR) {
    const v = RC.view;
    const t = race.time;
    for (const z of track.zips) {
      if (RC.dist2(v.camX, v.camY, z.x, z.y) > viewR * viewR) continue;
      ctx.save();
      ctx.translate(z.x, z.y);
      ctx.rotate(z.heading);
      for (let k = 0; k < 3; k++) {
        const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 7 - k * 1.1));
        ctx.fillStyle = th.accent;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.moveTo(-28 + k * 25, -38);
        ctx.lineTo(-5 + k * 25, 0);
        ctx.lineTo(-28 + k * 25, 38);
        ctx.lineTo(-18 + k * 25, 0);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawSlicks(ctx, race, viewR) {
    const v = RC.view;
    for (const s of race.slicks) {
      if (RC.dist2(v.camX, v.camY, s.x, s.y) > viewR * viewR) continue;
      const r = s.r * s.grow;
      const fade = RC.clamp(s.life / 2.5, 0, 1);
      ctx.globalAlpha = 0.82 * fade;
      ctx.fillStyle = '#15151c';
      ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.82, 0.4, 0, RC.TAU); ctx.fill();
      ctx.fillStyle = 'rgba(120,90,200,0.35)';
      ctx.beginPath(); ctx.ellipse(s.x - r * 0.2, s.y - r * 0.2, r * 0.45, r * 0.3, 0.6, 0, RC.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawPickups(ctx, race, track, viewR) {
    const v = RC.view;
    const t = race.time;
    for (const it of track.items) {
      if (!it.active) continue;
      if (RC.dist2(v.camX, v.camY, it.x, it.y) > viewR * viewR) continue;

      const bob = Math.sin(t * 3 + it.spin) * 4;
      ctx.save();
      ctx.translate(it.x, it.y + bob);

      // Shadow on the tarmac
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, 12 - bob, 22, 10, 0, 0, RC.TAU); ctx.fill();

      // The camera can turn, so un-rotate the icon to keep the "?" and the
      // upgrade letters the right way up whatever the view is doing.
      ctx.rotate(-v.camRot);

      if (it.kind === 'crate') {
        const s = 19;
        ctx.fillStyle = '#f6f2e8';
        rr(ctx, -s, -s, s * 2, s * 2, 5); ctx.fill();
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#ff4d5e';
        ctx.font = 'bold 25px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 1);
      } else {
        const s = 21;
        ctx.fillStyle = '#ffd23f';
        rr(ctx, -s, -s, s * 2, s * 2, 7); ctx.fill();
        ctx.strokeStyle = '#4a3a00'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#4a3a00';
        ctx.font = 'bold 21px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.upgrade === 'engine' ? 'E' : it.upgrade === 'tires' ? 'T' : 'C', 0, 1);
      }
      ctx.restore();
    }
  }

  /* ---------- Cars ---------- */

  function drawCars(ctx, race, viewR) {
    const v = RC.view;
    // Draw the player last so they're always on top of the pack.
    const order = race.cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const car of order) {
      if (RC.dist2(v.camX, v.camY, car.x, car.y) > (viewR + 120) ** 2) continue;
      drawCar(ctx, car, race);
    }
  }

  function drawCar(ctx, car, race) {
    const L = 30, W = 17; // half-length, half-width of the body

    // Ground shadow, offset so the car reads as sitting above the tarmac.
    ctx.save();
    ctx.translate(car.x + 6, car.y + 9);
    ctx.rotate(car.heading);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    rr(ctx, -L, -W, L * 2, W * 2, 9); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading + car.slip * 0.6);

    // Turbo flame out the back, whether from the meter or a speed strip
    if (car.boost > 0 || car.boosting) {
      const f = 0.6 + Math.random() * 0.5;
      ctx.fillStyle = 'rgba(255,190,60,0.9)';
      ctx.beginPath();
      ctx.moveTo(-L, -8); ctx.lineTo(-L - 34 * f, 0); ctx.lineTo(-L, 8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(-L, -4); ctx.lineTo(-L - 17 * f, 0); ctx.lineTo(-L, 4);
      ctx.closePath(); ctx.fill();
    }

    // Wheels. The front pair steer, which sells the toy-car look.
    ctx.fillStyle = '#1b1b22';
    const wheel = (x, y, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      rr(ctx, -9, -5, 18, 10, 4); ctx.fill();
      ctx.restore();
    };
    wheel(L * 0.55, -W - 3, car.wheelAngle);
    wheel(L * 0.55, W + 3, car.wheelAngle);
    wheel(-L * 0.55, -W - 3, 0);
    wheel(-L * 0.55, W + 3, 0);

    // Body
    ctx.fillStyle = car.color.body;
    rr(ctx, -L, -W, L * 2, W * 2, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3; ctx.stroke();

    // Nose highlight
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    rr(ctx, L * 0.35, -W + 3, L * 0.5, W * 2 - 6, 5); ctx.fill();

    // Cockpit / roof
    ctx.fillStyle = car.color.trim;
    rr(ctx, -L * 0.30, -W * 0.62, L * 0.72, W * 1.24, 5); ctx.fill();
    ctx.fillStyle = 'rgba(30,30,45,0.75)';
    rr(ctx, -L * 0.10, -W * 0.44, L * 0.42, W * 0.88, 4); ctx.fill();

    // A driver in the seat, and brake lights across the tail.
    ctx.fillStyle = car.color.trim;
    ctx.beginPath(); ctx.arc(-L * 0.02, 0, W * 0.30, 0, RC.TAU); ctx.fill();
    ctx.fillStyle = car.braking ? '#ff5a5a' : 'rgba(150,40,40,0.7)';
    rr(ctx, -L + 2, -W * 0.62, 3.5, W * 1.24, 1.5); ctx.fill();

    // Rear wing
    ctx.fillStyle = '#22222b';
    rr(ctx, -L - 3, -W - 4, 8, (W + 4) * 2, 3); ctx.fill();

    ctx.restore();

    // A ring under the player's car. The camera keeps you in the same place
    // on screen, but in a six-car scrap that is not always enough to find
    // yourself at a glance.
    if (car.isPlayer) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 4, L + 9, W + 14, car.heading, 0, RC.TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Spinning out: little stars round the roof, the universal "you goofed".
    if (car.spin > 0) {
      ctx.save();
      ctx.translate(car.x, car.y);
      for (let i = 0; i < 3; i++) {
        const a = race.time * 9 + i * (RC.TAU / 3);
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 34, Math.sin(a) * 17 - 26, 5.8, 0, RC.TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // Dust kicked up when you drop a wheel off the tarmac.
    if (car.offRoad && car.speed > 120 && Math.random() < 0.5) {
      RC.puff(race, car.x - Math.cos(car.heading) * 28, car.y - Math.sin(car.heading) * 28,
        race.track.theme.groundAlt, 0.4, 8);
    }
  }

  function drawParticles(ctx, race) {
    for (const p of race.particles) {
      const a = RC.clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, RC.TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- Minimap ---------- */

  // Drawn once into a small offscreen canvas when a race loads, then just
  // stamped onto the screen each frame. Redrawing 600 track points every
  // frame for a 130px map would be pure waste.
  RC.buildMinimap = function (track, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const b = track.bounds;
    const pad = 10;
    const sx = (size - pad * 2) / (b.maxX - b.minX);
    const sy = (size - pad * 2) / (b.maxY - b.minY);
    const s = Math.min(sx, sy);
    const ox = pad + ((size - pad * 2) - (b.maxX - b.minX) * s) / 2;
    const oy = pad + ((size - pad * 2) - (b.maxY - b.minY) * s) / 2;

    const toMap = (x, y) => [ox + (x - b.minX) * s, oy + (y - b.minY) * s];

    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = Math.max(3, track.halfWidth * 2 * s);
    g.beginPath();
    for (let i = 0; i <= track.count; i++) {
      const k = i % track.count;
      const [mx, my] = toMap(track.pts[k][0], track.pts[k][1]);
      if (i === 0) g.moveTo(mx, my); else g.lineTo(mx, my);
    }
    g.stroke();

    g.strokeStyle = track.theme.accent;
    g.lineWidth = 2;
    const [s0x, s0y] = toMap(track.pts[0][0], track.pts[0][1]);
    g.beginPath(); g.arc(s0x, s0y, 4, 0, RC.TAU); g.stroke();

    return { canvas: c, toMap, size };
  };

  function drawMinimap(ctx, race) {
    const mm = race.minimap;
    if (!mm) return;
    const v = RC.view;
    const pad = 12;
    const x = v.w - mm.size - pad;
    const y = pad + race.hudTopInset;

    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = '#0d0d14';
    rr(ctx, x - 6, y - 6, mm.size + 12, mm.size + 12, 12); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(mm.canvas, x, y);
    ctx.globalAlpha = 1;

    for (const car of race.cars) {
      const [mx, my] = mm.toMap(car.x, car.y);
      ctx.fillStyle = car.color.body;
      ctx.beginPath();
      ctx.arc(x + mx, y + my, car.isPlayer ? 5 : 3.5, 0, RC.TAU);
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.restore();
  }
})();
