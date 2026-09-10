/* ============================================================
   items.js — the RC Pro-Am kit.

   Crates  : drive over one to pick up an oil slick or a turbo refill.
   Oil     : dropped behind you, spins out whoever drives through it.
   Turbo   : refills the boost meter the turbo button spends.
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

  // How long a computer car waits between shots. The player's five a lap are
  // theirs to spend as fast as they like; the computer cars are deliberately
  // more sparing, or six of them firing freely turns the race into a lottery.
  const UPGRADE_KINDS = ['engine', 'tires', 'armor'];

  /* ---------- Laying out a circuit's pickups ---------- */

  RC.populateTrack = function (track, rng, raceIndex) {
    track.items = [];
    track.zips = [];

    const n = track.count;

    // Crates in rows of 3 so there's a choice of line, spaced by DISTANCE
    // rather than by a fraction of the lap - otherwise a long circuit gets
    // the same handful of rows as a short one and feels empty between them.
    // Roughly one row every four seconds at racing speed.
    const ROW_SPACING = 2300;
    const gap = Math.max(50, Math.round(ROW_SPACING / track.spacing));
    // The cars line up behind the start line, so the last stretch of the lap
    // has to stay clear. A crate 25 units from the grid meant a car could
    // collect one while stationary on the line.
    const GRID_CLEAR = Math.round(700 / track.spacing);
    for (let i = Math.floor(gap * 0.7); i < n - GRID_CLEAR; i += gap) {
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

    // Upgrades sit slightly off the ideal line, so taking one costs a little
    // time. Also scaled by distance so a long lap isn't a long walk between
    // them, with a floor and a ceiling.
    const upgradeCount = RC.clamp(
      Math.round(track.length / 4600) + (raceIndex >= 2 ? 1 : 0), 2, 5
    );
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

  // Every one of these refuses to do anything unless the race is actually
  // running. Without that guard the computer cars would open fire during the
  // countdown, while everyone was sitting still on the grid.
  function canAct(car, race) {
    return race.controlsLive && race.started && car.spin <= 0 && !car.finished;
  }

  RC.dropOil = function (car, race) {
    if (!canAct(car, race) || car.oil <= 0) return false;
    car.oil--;
    race.slicks.push({
      x: car.x - Math.cos(car.heading) * 62,
      y: car.y - Math.sin(car.heading) * 62,
      r: 56, life: 9, owner: car.index, grow: 0, caught: [],
    });
    RC.audio.drop();
    return true;
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
        if (RC.dist2(car.x, car.y, it.x, it.y) > 42 * 42) continue;

        if (it.kind === 'crate') {
          // Nothing is collected before the lights go out.
          if (!race.started) continue;
          if (rollCrate(car)) {
            it.active = false;
            it.cooldown = CRATE_RESPAWN;
            if (car.isPlayer) RC.audio.pickup();
          }
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
        if (RC.dist2(car.x, car.y, z.x, z.y) < 50 * 50) {
          car.boost = Math.max(car.boost, 0.85);
          if (car.isPlayer) RC.audio.zip();
          break;
        }
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

    /* Computer drivers deciding when to lay a slick */
    for (const car of cars) {
      if (!car.ai || car.spin > 0 || car.finished) continue;
      // The same guard as the player: nothing happens before the start.
      if (!race.started || !race.controlsLive) continue;

      // A cooldown, so a computer car does not empty its whole supply of
      // slicks the moment somebody gets close behind it.
      car.ai.oilTimer -= dt;

      if (car.oil > 0 && car.ai.oilTimer <= 0) {
        for (const c of cars) {
          if (c === car || c.finished) continue;
          if (c.spin > 0 || c.invuln > 0) continue;
          const dx = c.x - car.x, dy = c.y - car.y;
          const d = Math.hypot(dx, dy);
          if (d < 300 && Math.abs(RC.angleDelta(car.heading + Math.PI, Math.atan2(dy, dx))) < 0.6) {
            if (RC.dropOil(car, race)) car.ai.oilTimer = 3.5 + Math.random() * 3;
            break;
          }
        }
      }
    }
  };

  // What comes out of a crate: a slick to lay down, or a full turbo meter.
  // If a car can use neither, the crate is left standing.
  function rollCrate(car) {
    const canOil = car.oil < RC.MAX_OIL;
    const canTurbo = car.boostCharge < 0.9;
    if (!canOil && !canTurbo) return false;
    const wantOil = canOil && (!canTurbo || Math.random() < 0.55);
    if (wantOil) car.oil++;
    else { car.boostCharge = 1; car.boost = Math.max(car.boost, 0.5); RC.audio.turbo(); }
    return true;
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
