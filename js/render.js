/* ============================================================
   render.js — everything you see.

   The camera never rotates. North on the track is always up on the screen,
   and the view simply slides along to follow your car, exactly as the
   original RC Pro-Am did.

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

    // Deliberately never rotated. See the note at the top of this file.
    v.camRot = 0;

    if (v.shake > 0 && RC.view.shakeEnabled) {
      v.shake = Math.max(0, v.shake - dt * 26);
      v.shakeX = (Math.random() - 0.5) * v.shake;
      v.shakeY = (Math.random() - 0.5) * v.shake;
    } else { v.shake = 0; v.shakeX = v.shakeY = 0; }
  };

  function applyWorldTransform(ctx, v) {
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.translate(v.w / 2 + v.shakeX, v.h / 2 + v.shakeY);
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
    drawRoad(ctx, race, track, th, viewR);
    drawZips(ctx, race, track, th, viewR);
    drawSlicks(ctx, race, viewR);
    drawPickups(ctx, race, track, viewR);
    drawParticles(ctx, race);
    drawCars(ctx, race, viewR);
    drawMissiles(ctx, race);

    // Back to plain screen coordinates for the minimap.
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
    const runs = visibleRuns(track, v.camX, v.camY, viewR);
    const n = track.count;

    for (const [a, b] of runs) {
      if (b <= a) continue;

      // Tarmac
      stripPath(ctx, track, a, b);
      ctx.fillStyle = th.tarmac;
      ctx.fill();

      // Kerbs: red and white blocks, brighter through the corners.
      ctx.lineWidth = 11;
      ctx.lineCap = 'butt';
      for (let i = a; i < b; i++) {
        const k = ((i % n) + n) % n;
        const k2 = ((i + 1) % n + n) % n;
        // Red-and-white kerbing through the corners, a plain painted line
        // down the straights. The alternation is what makes a corner read as
        // a corner from a distance.
        const sharp = track.curvature[k] > 0.0012;
        const on = (Math.floor(i / 3) % 2) === 0;
        const col = sharp ? (on ? '#ee4b4b' : '#f2f2f2') : '#cfcfda';
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(track.left[k * 2], track.left[k * 2 + 1]);
        ctx.lineTo(track.left[k2 * 2], track.left[k2 * 2 + 1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(track.right[k * 2], track.right[k * 2 + 1]);
        ctx.lineTo(track.right[k2 * 2], track.right[k2 * 2 + 1]);
        ctx.stroke();
      }

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

    drawStartLine(ctx, track);
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
    ctx.restore();
  }

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
        ctx.moveTo(-22 + k * 20, -30);
        ctx.lineTo(-4 + k * 20, 0);
        ctx.lineTo(-22 + k * 20, 30);
        ctx.lineTo(-14 + k * 20, 0);
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
      ctx.beginPath(); ctx.ellipse(0, 10 - bob, 18, 8, 0, 0, RC.TAU); ctx.fill();

      // No un-rotating needed: the camera never turns, so an icon drawn
      // upright stays upright.
      if (it.kind === 'crate') {
        const s = 15;
        ctx.fillStyle = '#f6f2e8';
        rr(ctx, -s, -s, s * 2, s * 2, 5); ctx.fill();
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#ff4d5e';
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 1);
      } else {
        const s = 17;
        ctx.fillStyle = '#ffd23f';
        rr(ctx, -s, -s, s * 2, s * 2, 7); ctx.fill();
        ctx.strokeStyle = '#4a3a00'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#4a3a00';
        ctx.font = 'bold 17px system-ui, sans-serif';
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
    const L = 23, W = 13; // half-length, half-width of the body

    // Ground shadow, offset so the car reads as sitting above the tarmac.
    ctx.save();
    ctx.translate(car.x + 5, car.y + 7);
    ctx.rotate(car.heading);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    rr(ctx, -L, -W, L * 2, W * 2, 7); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading + car.slip * 0.6);

    // Turbo flame out the back
    if (car.boost > 0) {
      const f = 0.6 + Math.random() * 0.5;
      ctx.fillStyle = 'rgba(255,190,60,0.9)';
      ctx.beginPath();
      ctx.moveTo(-L, -6); ctx.lineTo(-L - 26 * f, 0); ctx.lineTo(-L, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(-L, -3); ctx.lineTo(-L - 13 * f, 0); ctx.lineTo(-L, 3);
      ctx.closePath(); ctx.fill();
    }

    // Wheels. The front pair steer, which sells the toy-car look.
    ctx.fillStyle = '#1b1b22';
    const wheel = (x, y, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      rr(ctx, -7, -4, 14, 8, 3); ctx.fill();
      ctx.restore();
    };
    wheel(L * 0.55, -W - 2, car.wheelAngle);
    wheel(L * 0.55, W + 2, car.wheelAngle);
    wheel(-L * 0.55, -W - 2, 0);
    wheel(-L * 0.55, W + 2, 0);

    // Body
    ctx.fillStyle = car.color.body;
    rr(ctx, -L, -W, L * 2, W * 2, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2.5; ctx.stroke();

    // Nose highlight
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    rr(ctx, L * 0.35, -W + 2, L * 0.5, W * 2 - 4, 4); ctx.fill();

    // Cockpit / roof
    ctx.fillStyle = car.color.trim;
    rr(ctx, -L * 0.30, -W * 0.62, L * 0.72, W * 1.24, 4); ctx.fill();
    ctx.fillStyle = 'rgba(30,30,45,0.75)';
    rr(ctx, -L * 0.10, -W * 0.44, L * 0.42, W * 0.88, 3); ctx.fill();

    // Rear wing
    ctx.fillStyle = '#22222b';
    rr(ctx, -L - 2, -W - 3, 6, (W + 3) * 2, 2); ctx.fill();

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
      ctx.ellipse(0, 3, L + 7, W + 11, car.heading, 0, RC.TAU);
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
        ctx.arc(Math.cos(a) * 26, Math.sin(a) * 13 - 20, 4.5, 0, RC.TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // Dust kicked up when you drop a wheel off the tarmac.
    if (car.offRoad && car.speed > 120 && Math.random() < 0.5) {
      RC.puff(race, car.x - Math.cos(car.heading) * 22, car.y - Math.sin(car.heading) * 22,
        race.track.theme.groundAlt, 0.4, 8);
    }
  }

  function drawMissiles(ctx, race) {
    for (const m of race.missiles) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.heading);
      ctx.fillStyle = '#ffe0a0';
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-8, -6); ctx.lineTo(-5, 0); ctx.lineTo(-8, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff6b3f';
      ctx.beginPath(); ctx.arc(-8, 0, 4.5, 0, RC.TAU); ctx.fill();
      ctx.restore();
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
