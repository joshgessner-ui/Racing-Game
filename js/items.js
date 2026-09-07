/* ============================================================
   items.js — the RC Pro-Am kit.

   Crates  : drive over one, get a random weapon.
   Missile : fires forward, homes gently, spins out whoever it hits.
   Oil     : dropped behind you, spins out whoever drives through it.
   Turbo   : an instant burst of speed.
   Zips    : glowing strips baked into the tarmac. Free speed if you can
             hit them, which quietly teaches you the racing line.
   Upgrades: engine / tyres / roll cage. These are the big ones - you keep
             them for the rest of the championship, so a good early race
             compounds into an easier late one.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  const CRATE_RESPAWN = 9;
  const UPGRADE_KINDS = ['engine', 'tires', 'armor'];

  /* ---------- Laying out a circuit's pickups ---------- */

  RC.populateTrack = function (track, rng, raceIndex) {
    track.items = [];
    track.zips = [];

    const n = track.count;

    // Crates in rows of 3 so there's a choice of line. Spaced so you meet a
    // row roughly every four seconds - dense enough that the race stays
    // lively, sparse enough that holding an item still feels like something.
    const gap = Math.max(60, Math.floor(n / 5));
    for (let i = Math.floor(gap * 0.7); i < n - 20; i += gap) {
      const spread = track.halfWidth * 0.55;
      for (let k = -1; k <= 1; k++) {
        const p = track.pointAt(i, k * spread);
        track.items.push({
          kind: 'crate', x: p[0], y: p[1], index: i,
          active: true, cooldown: 0, spin: rng() * RC.TAU,
        });
      }
    }

    // Zips go on the straightest stretches. The threshold is worked out from
    // this particular track rather than being a fixed number, because a fixed
    // number put plenty of zips on the fast circuits and none at all on the
    // twisty ones.
    const straightness = [];
    for (let i = 0; i < n; i++) straightness.push(track.maxCurvature(i, 14));
    const sorted = straightness.slice().sort((a, b) => a - b);
    const zipThreshold = sorted[Math.floor(sorted.length * 0.30)];

    for (let i = 0; i < n; i += 6) {
      if (straightness[i] <= zipThreshold) {
        const bend = track.bendAhead(i, 40);
        const side = RC.clamp(bend * 6000, -1, 1) * track.halfWidth * 0.34;
        const p = track.pointAt(i, side);
        track.zips.push({ x: p[0], y: p[1], index: i, heading: track.headings[i] });
        i += 12; // don't carpet the whole straight in them
      }
    }

    // Two or three upgrades per race, always slightly off the ideal line so
    // taking one costs you a little time. That's the trade-off.
    const upgradeCount = 2 + (raceIndex >= 2 ? 1 : 0);
    for (let u = 0; u < upgradeCount; u++) {
      const i = Math.floor(((u + 0.55) / upgradeCount) * n);
      const bend = track.bendAhead(i, 30);
      const side = -Math.sign(bend || 1) * track.halfWidth * 0.68;
      const p = track.pointAt(i, side);
      track.items.push({
        kind: 'upgrade',
        upgrade: UPGRADE_KINDS[(u + raceIndex) % UPGRADE_KINDS.length],
        x: p[0], y: p[1], index: i, active: true, cooldown: 0, spin: rng() * RC.TAU,
      });
    }
  };

  /* ---------- Firing ---------- */

  RC.fireItem = function (car, race) {
    if (!car.item || car.spin > 0 || car.finished) return;
    const kind = car.item;
    car.item = null;

    if (kind === 'turbo') {
      car.boost = Math.max(car.boost, 1.7);
      RC.audio.turbo();
      RC.burst(race, car.x, car.y, 14, '#7fe8ff', 260);
      return;
    }

    if (kind === 'oil') {
      const bx = car.x - Math.cos(car.heading) * 52;
      const by = car.y - Math.sin(car.heading) * 52;
      // `caught` remembers who this slick has already got, so one slick is one
      // spin per car rather than a trap you can never drive out of.
      race.slicks.push({ x: bx, y: by, r: 46, life: 9, owner: car.index, grow: 0, caught: [] });
      RC.audio.drop();
      return;
    }

    if (kind === 'missile') {
      race.missiles.push({
        x: car.x + Math.cos(car.heading) * 34,
        y: car.y + Math.sin(car.heading) * 34,
        heading: car.heading,
        speed: RC.carMaxSpeed(car) * 1.55 + 140,
        life: 3.2,
        owner: car.index,
        smoke: 0,
      });
      RC.audio.launch();
    }
  };

  /* ---------- Per-frame update ---------- */

  RC.updateItems = function (race, dt) {
    const track = race.track;
    const cars = race.cars;

    /* Crates and upgrades */
    for (const it of track.items) {
      if (!it.active) {
        it.cooldown -= dt;
        if (it.cooldown <= 0 && it.kind === 'crate') it.active = true;
        continue;
      }
      it.spin += dt * 1.6;

      for (const car of cars) {
        if (car.finished) continue;
        if (RC.dist2(car.x, car.y, it.x, it.y) > 34 * 34) continue;

        if (it.kind === 'crate') {
          if (!car.item) {
            car.item = rollItem(car, race);
            if (car.isPlayer) RC.audio.pickup();
          }
          it.active = false;
          it.cooldown = CRATE_RESPAWN;
        } else {
          // Upgrades are one per race, and only if you can still use them.
          if (car[it.upgrade] < 3) {
            car[it.upgrade]++;
            it.active = false;
            it.cooldown = 1e9;
            if (car.isPlayer) {
              RC.audio.upgrade();
              race.toast(upgradeLabel(it.upgrade), '#ffd23f');
            }
            RC.burst(race, it.x, it.y, 18, '#ffd23f', 200);
          }
        }
        break;
      }
    }

    /* Zips (boost strips) */
    for (const car of cars) {
      if (car.finished || car.spin > 0) continue;
      for (const z of track.zips) {
        if (Math.abs(car.loc - z.index) > 8 && Math.abs(car.loc - z.index) < track.count - 8) continue;
        if (RC.dist2(car.x, car.y, z.x, z.y) < 40 * 40) {
          car.boost = Math.max(car.boost, 0.85);
          if (car.isPlayer) RC.audio.zip();
          break;
        }
      }
    }

    /* Missiles */
    for (let i = race.missiles.length - 1; i >= 0; i--) {
      const m = race.missiles[i];
      m.life -= dt;

      // Gentle homing: only towards a car that is genuinely in front of it.
      let best = null, bestD = 1e9;
      for (const c of cars) {
        if (c.index === m.owner || c.finished) continue;
        const dx = c.x - m.x, dy = c.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d > 620) continue;
        const ang = Math.abs(RC.angleDelta(m.heading, Math.atan2(dy, dx)));
        if (ang > 0.75) continue;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) {
        const want = Math.atan2(best.y - m.y, best.x - m.x);
        m.heading += RC.clamp(RC.angleDelta(m.heading, want), -2.6 * dt, 2.6 * dt);
      }

      m.x += Math.cos(m.heading) * m.speed * dt;
      m.y += Math.sin(m.heading) * m.speed * dt;

      m.smoke -= dt;
      if (m.smoke <= 0) {
        m.smoke = 0.02;
        RC.puff(race, m.x, m.y, '#ffffff', 0.35, 9);
      }

      let hit = false;
      for (const c of cars) {
        if (c.index === m.owner || c.finished) continue;
        if (c.invuln > 0) continue; // already been got - let the missile fly on
        if (RC.dist2(c.x, c.y, m.x, m.y) < 27 * 27) {
          if (RC.spinOut(c, 1.0)) {
            RC.shove(c, Math.cos(m.heading) * 300, Math.sin(m.heading) * 300);
          }
          hit = true;
          break;
        }
      }

      if (hit || m.life <= 0) {
        RC.burst(race, m.x, m.y, 22, '#ffb03f', 340);
        RC.audio.boom();
        if (race.playerCar) race.shakeFrom(m.x, m.y, 12);
        race.missiles.splice(i, 1);
      }
    }

    /* Oil slicks */
    for (let i = race.slicks.length - 1; i >= 0; i--) {
      const s = race.slicks[i];
      s.life -= dt;
      s.grow = Math.min(1, s.grow + dt * 4);
      if (s.life <= 0) { race.slicks.splice(i, 1); continue; }

      for (const c of cars) {
        if (c.finished || c.spin > 0) continue;
        if (s.caught.indexOf(c.index) !== -1) continue;
        if (RC.dist2(c.x, c.y, s.x, s.y) < (s.r * s.grow) * (s.r * s.grow)) {
          if (RC.spinOut(c, 0.85)) {
            s.caught.push(c.index);
            if (c.isPlayer) race.shakeFrom(c.x, c.y, 8);
          }
        }
      }
    }

    /* Computer drivers deciding when to use what they're holding */
    for (const car of cars) {
      if (!car.ai || !car.item || car.spin > 0 || car.finished) continue;
      car.ai.itemTimer -= dt;
      if (car.ai.itemTimer > 0) continue;
      car.ai.itemTimer = 0.35;

      if (car.item === 'turbo') {
        // Save it for a straight, where it's actually worth something.
        if (track.maxCurvature(car.loc, 30) < 0.001) RC.fireItem(car, race);
      } else if (car.item === 'missile') {
        for (const c of cars) {
          if (c === car || c.finished) continue;
          if (c.spin > 0 || c.invuln > 0) continue; // no kicking a car while it's down
          const dx = c.x - car.x, dy = c.y - car.y;
          const d = Math.hypot(dx, dy);
          if (d < 560 && Math.abs(RC.angleDelta(car.heading, Math.atan2(dy, dx))) < 0.45) {
            RC.fireItem(car, race); break;
          }
        }
      } else if (car.item === 'oil') {
        for (const c of cars) {
          if (c === car || c.finished) continue;
          if (c.spin > 0 || c.invuln > 0) continue;
          const dx = c.x - car.x, dy = c.y - car.y;
          const d = Math.hypot(dx, dy);
          if (d < 300 && Math.abs(RC.angleDelta(car.heading + Math.PI, Math.atan2(dy, dx))) < 0.6) {
            RC.fireItem(car, race); break;
          }
        }
      }
    }
  };

  // What comes out of a crate. Being further back gives you slightly better
  // odds - the classic catch-up mechanic that keeps a race winnable.
  function rollItem(car, race) {
    const behind = race.cars.filter(c => c.totalProgress > car.totalProgress).length;
    const r = Math.random() + behind * 0.05;
    if (r < 0.42) return 'missile';
    if (r < 0.72) return 'oil';
    return 'turbo';
  }

  function upgradeLabel(kind) {
    return kind === 'engine' ? 'ENGINE UP!'
      : kind === 'tires' ? 'TYRES UP!'
        : 'ROLL CAGE UP!';
  }
  RC.upgradeLabel = upgradeLabel;

  /* ---------- Particles ---------- */

  RC.burst = function (race, x, y, count, color, speed) {
    for (let i = 0; i < count; i++) {
      if (race.particles.length > 260) break;
      const a = Math.random() * RC.TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      race.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.4, max: 0.75,
        size: 3 + Math.random() * 5, color, drag: 3.2,
      });
    }
  };

  RC.puff = function (race, x, y, color, life, size) {
    if (race.particles.length > 260) return;
    race.particles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
      life, max: life, size, color, drag: 1.5,
    });
  };

  RC.updateParticles = function (race, dt) {
    const p = race.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      q.life -= dt;
      if (q.life <= 0) { p.splice(i, 1); continue; }
      const d = Math.exp(-q.drag * dt);
      q.vx *= d; q.vy *= d;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  };
})();
