/* ============================================================
   car.js — how a car moves, and how the computer drivers think.

   The physics here is deliberately "arcade", not a simulation. A real
   car model is less fun on a touchscreen: you want a kart that goes
   where you point it, slides a bit, and never feels like it betrayed you.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  // The base numbers every car starts from. Upgrades multiply these.
  const BASE = {
    maxSpeed: 520,      // world units per second on clean tarmac
    accel: 340,         // how quickly you reach top speed
    turnRate: 3.0,      // radians per second at full lock
    scrub: 0.55,        // speed lost while cornering hard
    radius: 27,         // for bumping into other cars
  };

  // How much dirt there is between the edge of the tarmac and the barrier.
  // Enough to survive a mistake, not enough to make cutting a corner pay.
  const RUNOFF = 62;
  RC.RUNOFF = RUNOFF;

  // The turbo meter. A full meter is BOOST_SECONDS of boost, and it takes
  // BOOST_RECHARGE seconds of not using it to fill from empty. Every car has
  // one, including the computer drivers, so it speeds the whole race up
  // rather than handing the player a free advantage.
  const MAX_OIL = 3;
  RC.MAX_OIL = MAX_OIL;

  const BOOST_SECONDS = 2.2;
  const BOOST_RECHARGE = 7.5;
  const BOOST_MULTIPLIER = 1.40;
  RC.BOOST_SECONDS = BOOST_SECONDS;

  const CAR_COLORS = [
    { body: '#ff4d5e', trim: '#ffd6da', name: 'Scorcher' },
    { body: '#3fa9ff', trim: '#d3ecff', name: 'Bluebird' },
    { body: '#ffd23f', trim: '#fff3c4', name: 'Hornet' },
    { body: '#5ce88a', trim: '#d8ffe6', name: 'Grasshopper' },
    { body: '#c46bff', trim: '#eddaff', name: 'Nightshade' },
    { body: '#ff8f3f', trim: '#ffe2c9', name: 'Firecracker' },
  ];
  RC.CAR_COLORS = CAR_COLORS;

  RC.makeCar = function (opts) {
    return {
      x: opts.x, y: opts.y,
      heading: opts.heading,
      speed: 0,

      // A short-lived push applied on top of normal driving: what a shunt
      // from another car, or a spin, feels like.
      kickX: 0, kickY: 0,

      isPlayer: !!opts.isPlayer,
      index: opts.index,
      color: CAR_COLORS[opts.index % CAR_COLORS.length],
      name: opts.name || CAR_COLORS[opts.index % CAR_COLORS.length].name,

      // Upgrades, 0..3 each. These persist across the championship.
      engine: opts.engine || 0,
      tires: opts.tires || 0,
      armor: opts.armor || 0,

      oil: 0,              // slicks in reserve, picked up from crates
      spin: 0,             // seconds left spinning out
      spinDir: 1,
      boost: 0,            // seconds of boost from a speed strip or an item
    boostCharge: 1,      // the turbo meter, 0..1
    boosting: false,     // is the turbo actually firing right now
      invuln: 0,           // brief mercy window after being hit
      offRoad: false,
    braking: false,

      // Race position tracking
      loc: 0,              // nearest centreline index
      // Cars line up BEHIND the start line, so they cross it once just to
      // begin the race. Starting at -1 means that first crossing takes them
      // to "zero laps completed" rather than handing them a free lap.
      lap: -1,
      lapStartTime: 0,
      lapTimes: [],
      totalProgress: 0,    // lap + fraction, used to sort the field
      finished: false,
      finishTime: 0,
      place: 0,

      // AI only
      ai: opts.ai || null,

      steerInput: 0,
      slip: 0,             // visual body lean/drift angle
      wheelAngle: 0,
      engineNote: 0,
    };
  };

  /* ---------- Derived stats ---------- */

  RC.carMaxSpeed = (c) => BASE.maxSpeed * (1 + c.engine * 0.075);
  // The player can scale their own turn rate from the Controls screen. The
  // computer cars are never scaled, so the setting is a comfort dial rather
  // than a difficulty one - and its corner-speed maths stays honest.
  RC.playerTurnScale = 1;
  RC.carTurnRate = (c) => BASE.turnRate * (1 + c.tires * 0.085)
    * (c.isPlayer ? RC.playerTurnScale : 1);
  RC.carGripOffRoad = (c) => 0.56 + c.tires * 0.05;  // how much speed you keep in the dirt
  RC.carHitResist = (c) => 1 - c.armor * 0.22;       // armour shortens a spin-out

  /* ---------- Driving ---------- */

  RC.updateCar = function (car, track, dt, race) {
    const prevLoc = car.loc;

    // --- Steering input ---
    if (car.spin > 0) {
      // Spun out: no control at all for a moment. This is the punishment
      // for an oil slick or a big shunt.
      car.spin -= dt;
      car.heading += car.spinDir * 9.0 * dt;
      car.speed = RC.damp(car.speed, 40, 3.2, dt);
      car.steerInput = 0;
    } else {
      if (car.isPlayer) {
        // Left and right turn the car for as long as they are held. A very
        // fast ramp rather than an instant jump, so the first frame of a press
        // isn't a jolt - but quick enough to feel immediate.
        const want = race.controlsLive ? RC.input.steer : 0;
        car.steerInput = RC.damp(car.steerInput, want, 30, dt);
      } else {
        car.steerInput = RC.aiSteer(car, track, dt, race);
      }
    }

    const maxSpeed = RC.carMaxSpeed(car);

    const live = race.controlsLive && car.spin <= 0 && !car.finished;

    // Braking. Down on the cross for the player; the computer lifts off
    // rather than braking, which its corner-speed maths already handles.
    const braking = car.isPlayer && live && RC.input.brake;
    car.braking = braking;

    // --- Turbo ---
    // Held down, it drains the meter. Let go and the meter refills.
    const wantBoost = car.isPlayer ? (live && RC.input.turbo) : (live && !!car.wantBoost);
    if (wantBoost && car.boostCharge > 0) {
      car.boostCharge = Math.max(0, car.boostCharge - dt / BOOST_SECONDS);
      car.boosting = true;
    } else {
      car.boosting = false;
      car.boostCharge = Math.min(1, car.boostCharge + dt / BOOST_RECHARGE);
    }
    // Speed strips and the turbo pickup still give a timed boost of their own.
    if (car.boost > 0) car.boost -= dt;
    const boosting = car.boosting || car.boost > 0;

    // --- How fast do we want to be going? ---
    let targetSpeed = maxSpeed;
    if (braking) targetSpeed *= 0.30;
    if (car.offRoad) targetSpeed *= RC.carGripOffRoad(car);
    if (boosting) targetSpeed *= BOOST_MULTIPLIER;
    if (!race.controlsLive && car.isPlayer) targetSpeed = 0; // countdown / finished
    if (!race.started) targetSpeed = 0;
    if (car.ai) targetSpeed *= car.ai.speedScale;

    if (car.spin > 0) targetSpeed = 0;

    // --- Turning ---
    if (car.spin <= 0) {
      const sp = car.speed / maxSpeed;
      // Steering is weaker when you're crawling and the car pushes a little
      // wide at top speed, which is what makes it feel like a toy car rather
      // than a cursor. But it never drops to zero: a car that has been shunted
      // to a standstill facing a barrier has to be able to turn itself round,
      // or it is simply stuck there for the rest of the race.
      const grip = RC.lerp(0.45, 1, RC.clamp(sp / 0.25, 0, 1))
                 * (1 - 0.22 * RC.clamp(sp, 0, 1.4));
      // The dirt costs you speed - that is the punishment. It deliberately
      // costs very little steering, because a car that slides off and then
      // cannot turn back onto the tarmac just stays there, which is annoying
      // rather than difficult.
      const surface = car.offRoad ? 0.85 : 1;
      // Slowing down already tightens your line for free, because a slower
      // car turning at the same rate traces a smaller circle. The small extra
      // bonus here is just to make the brake feel decisive.
      const brakeBonus = braking ? 1.15 : 1;
      car.heading += car.steerInput * RC.carTurnRate(car) * grip * surface * brakeBonus * dt;
    }

    // --- Speed ---
    const rate = targetSpeed > car.speed
      ? BASE.accel
      : BASE.accel * (braking ? 3.0 : 2.1);
    car.speed += RC.clamp(targetSpeed - car.speed, -rate * dt, rate * dt);
    // Cornering scrubs off speed, so you can't take a hairpin flat out.
    car.speed -= Math.abs(car.steerInput) * car.speed * BASE.scrub * dt;
    if (car.speed < 0) car.speed = 0;

    // --- Move ---
    car.x += Math.cos(car.heading) * car.speed * dt + car.kickX * dt;
    car.y += Math.sin(car.heading) * car.speed * dt + car.kickY * dt;

    // --- Where did we end up? ---
    // `car.loc` from last frame is the hint that keeps this search fast and
    // stops a car jumping across a hairpin to the wrong bit of track.
    const loc = track.locate(car.x, car.y, car.loc);
    car.loc = loc.index;
    car.trackOffset = loc.offset;
    car.offRoad = !track.onRoad(loc.offset);

    // --- Barriers ---
    // There is a strip of dirt either side of the tarmac, and then a wall.
    // Without the wall, cutting straight across the inside of a corner is
    // faster than driving round it even at dirt speed, and both you and the
    // computer cars would just drive through the scenery all race.
    const wall = track.halfWidth + RUNOFF;
    if (Math.abs(loc.offset) > wall) {
      const side = Math.sign(loc.offset);
      const excess = Math.abs(loc.offset) - wall;
      const nx = track.normals[car.loc * 2], ny = track.normals[car.loc * 2 + 1];
      car.x -= nx * side * excess;
      car.y -= ny * side * excess;
      car.trackOffset = side * wall;

      // Graze along the barrier rather than sticking to it: lose some speed,
      // and get nudged back towards the racing line.
      car.speed *= Math.max(0.55, 1 - 2.4 * dt - excess * 0.004);
      car.kickX = car.kickY = 0;
      const along = track.headings[car.loc];
      car.heading += RC.angleDelta(car.heading, along) * Math.min(1, 9 * dt);

      if (car.isPlayer && excess > 1.5) {
        RC.audio.thud(RC.clamp(excess * 0.05, 0.08, 0.5));
        if (race.shakeFrom) race.shakeFrom(car.x, car.y, RC.clamp(excess * 0.8, 0, 6));
      }
    }

    // --- Lap counting ---
    // If our position round the loop wrapped from "almost 1" to "almost 0",
    // we just crossed the start line.
    const prevP = prevLoc / track.count;
    const nowP = car.loc / track.count;
    if (prevP > 0.75 && nowP < 0.25) {
      car.lap++;
      // lap 0 is the race actually starting, so there is no time to record yet.
      if (car.lap >= 1) car.lapTimes.push(race.time - car.lapStartTime);
      car.lapStartTime = race.time;
    } else if (prevP < 0.25 && nowP > 0.75) {
      car.lap--; // driving backwards over the line
    }
    car.totalProgress = car.lap + nowP;

    // The kick from a hit fades away over about a third of a second.
    const decay = Math.exp(-6.5 * dt);
    car.kickX *= decay; car.kickY *= decay;

    if (car.invuln > 0) car.invuln -= dt;

    // --- Cosmetic: body lean and steered front wheels ---
    car.slip = RC.damp(car.slip, -car.steerInput * 0.20 * RC.clamp(car.speed / maxSpeed, 0, 1), 9, dt);
    car.wheelAngle = RC.damp(car.wheelAngle, car.steerInput * 0.5, 14, dt);
  };

  /* ---------- Getting hit ---------- */

  RC.spinOut = function (car, duration, dirHint) {
    if (car.invuln > 0 || car.finished) return false;
    const spin = duration * RC.carHitResist(car);
    car.spin = Math.max(car.spin, spin);
    car.spinDir = dirHint || (Math.random() < 0.5 ? -1 : 1);
    // The mercy window has to comfortably outlast the spin. Without it a car
    // that gets knocked back into the pack is a sitting duck: slow, pointing
    // the wrong way, and hit again the instant it recovers. That death spiral
    // was costing one car half a minute a race, and it would be far worse for
    // a human, who would simply be spun in circles until the flag.
    car.invuln = spin + 2.2;
    return true;
  };

  RC.shove = function (car, fx, fy) {
    car.kickX += fx;
    car.kickY += fy;
  };

  /* ---------- Car-versus-car bumping ---------- */

  RC.resolveCarCollisions = function (cars) {
    const minD = BASE.radius * 2;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d < 1e-4) continue;

        dx /= d; dy /= d;
        const push = (minD - d) * 0.5;
        a.x -= dx * push; a.y -= dy * push;
        b.x += dx * push; b.y += dy * push;

        // Whoever was going faster into the contact wins the exchange.
        const closing = Math.abs(a.speed - b.speed);
        const force = 40 + closing * 0.8;
        RC.shove(a, -dx * force, -dy * force);
        RC.shove(b, dx * force, dy * force);

        // A really big hit spins the slower car. Armour protects you.
        if (closing > 190) {
          const loser = a.speed < b.speed ? a : b;
          RC.spinOut(loser, 0.55);
        }
        if (a.isPlayer || b.isPlayer) RC.audio.thud(RC.clamp(force / 220, 0.1, 1));
      }
    }
  };

  /* ---------- Keeping cars roughly on the planet ---------- */

  // If a car ends up absurdly far off the circuit (a big shunt near a hairpin,
  // say) we walk it back onto the tarmac rather than let it get lost.
  RC.leashCar = function (car, track) {
    const limit = track.halfWidth + 420;
    if (Math.abs(car.trackOffset) > limit) {
      const side = Math.sign(car.trackOffset);
      const p = track.pointAt(car.loc, side * (track.halfWidth * 0.6));
      car.x = p[0]; car.y = p[1];
      car.heading = track.headings[car.loc];
      car.speed *= 0.35;
      car.kickX = car.kickY = 0;
    }
  };

  /* ============================================================
     The computer drivers.

     An AI driver does three things every frame:
       1. Pick a point further along the track to aim at.
       2. Steer towards it.
       3. Decide how fast it dares to go, based on the next corner.
     ============================================================ */

  RC.makeAiBrain = function (skill, rng) {
    return {
      skill,                              // 0 (slow) .. 1 (quick)
      speedScale: 0.94 + skill * 0.08,    // top-speed confidence
      cornerNerve: 0.90 + skill * 0.16,   // how fast it dares take a corner
      lineBias: (rng() - 0.5) * 0.26,     // personal preference for the racing line
      wobblePhase: rng() * RC.TAU,
      wobbleRate: 0.5 + rng() * 0.7,
      // A weaker driver reacts late. Kept deliberately mild: a big reaction
      // delay doesn't read as "slower driver", it reads as "car falls off the
      // track", and then the race is a procession instead of a fight.
      reaction: 0.05 + (1 - skill) * 0.06,
      oilTimer: 2 + rng() * 4,   // seconds until it will lay another slick
      steerMemory: 0,
      rubber: 1,
    };
  };

  RC.aiSteer = function (car, track, dt, race) {
    const ai = car.ai;
    const maxSpeed = RC.carMaxSpeed(car);

    // 1. Look ahead by roughly half a second of travel, never less than a
    //    few samples or the car would chase its own bumper.
    const aheadSamples = RC.clamp(
      Math.round((car.speed * 0.55) / track.spacing), 7, 42
    );
    const aimIndex = car.loc + aheadSamples;

    // 2. Choose a line across the track. Cut towards the inside of the
    //    upcoming bend, which is what makes them look like they're racing
    //    rather than just tracing the middle of the road.
    const bend = track.bendAhead(car.loc, aheadSamples + 12);
    const inside = RC.clamp(bend * 9000, -1, 1); // +1 = corner goes left
    ai.wobblePhase += ai.wobbleRate * dt;
    const wobble = Math.sin(ai.wobblePhase) * 0.10 * (1 - ai.skill);

    const lateral = track.halfWidth * RC.clamp(
      inside * 0.55 + ai.lineBias + wobble, -0.72, 0.72
    );
    const aim = track.pointAt(aimIndex, lateral);

    // 3. Steer towards it.
    const want = Math.atan2(aim[1] - car.y, aim[0] - car.x);
    // Steer harder when it has dropped a wheel in the dirt, so a small mistake
    // stays a small mistake.
    const urgency = car.offRoad ? 3.4 : 2.5;
    let steer = RC.clamp(RC.angleDelta(car.heading, want) * urgency, -1, 1);

    // A weaker driver reacts a beat late, which is what makes them beatable.
    ai.steerMemory = RC.damp(ai.steerMemory, steer, 1 / Math.max(ai.reaction, 0.02), dt);
    steer = ai.steerMemory;

    // 4. Speed for the corner.
    //    A car turning at rate w while travelling at speed v traces a curve of
    //    tightness w/v. So the fastest it can get through a bend of tightness
    //    k is v = w/k. Working it out this way rather than guessing means the
    //    AI is quick on the fast tracks and genuinely lifts for the hairpin on
    //    Thunder Ridge, without any per-track hand-tuning.
    const curve = track.maxCurvature(car.loc, aheadSamples + 22);
    let cornerLimit = 1;
    if (curve > 1e-5) {
      const turn = RC.carTurnRate(car) * 0.76; // turn rate after grip losses
      cornerLimit = RC.clamp((turn / curve) / maxSpeed * ai.cornerNerve, 0.28, 1);
    }

    // 4b. Spend the turbo meter on the straights, where it is worth most,
    //     and keep a little back so it is never completely empty at a corner.
    const straightAhead = track.maxCurvature(car.loc, 34) < 0.0011;
    car.wantBoost = straightAhead && car.boostCharge > 0.35;

    // 5. A gentle helping hand so the pack stays together and the race stays
    //    interesting - but not so strong that going fast stops mattering.
    const gap = race.playerCar ? race.playerCar.totalProgress - car.totalProgress : 0;
    let target = gap > 0.25 ? 1.05 : gap < -0.25 ? 0.955 : 1;

    // Anyone who has fallen most of a lap behind the leader gets a tow. One
    // bad moment early - a spin, a slick, a trip through the dirt - used to
    // drop a car out of the race entirely and leave it circulating alone half
    // a minute back. This pulls them back into the fight.
    let lead = -Infinity;
    for (let i = 0; i < race.cars.length; i++) {
      if (race.cars[i].totalProgress > lead) lead = race.cars[i].totalProgress;
    }
    if (lead - car.totalProgress > 0.4) target = Math.max(target, 1.13);

    ai.rubber = RC.damp(ai.rubber, target, 0.6, dt);

    ai.speedScale = (0.94 + ai.skill * 0.08) * cornerLimit * ai.rubber;
    if (car.offRoad) ai.speedScale *= 0.9;

    return steer;
  };
})();
