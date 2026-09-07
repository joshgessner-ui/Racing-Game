/* ============================================================
   game.js — glues everything together.

   Holds the current race, runs the loop, tracks the championship, and
   drives the on-screen menus.
   ============================================================ */

(function () {
  'use strict';
  const RC = window.RC;

  const POINTS = [10, 8, 6, 4, 2, 1];   // championship points for 1st..6th
  const PODIUM = 3;                      // finish this high or better to advance
  const FIELD = 6;                       // cars on the grid
  const PLAYER_GRID_SLOT = 3;            // 0 = pole, so 3 means you start 4th

  RC.game = {
    screen: 'menu',
    race: null,
    save: null,
    paused: false,
  };

  /* ---------- Saved progress ---------- */

  function defaultSave() {
    return {
      raceIndex: 0,
      points: 0,
      upgrades: { engine: 0, tires: 0, armor: 0 },
      best: {},
      settings: { sensitivity: 1.0, invert: false, sound: true, mode: 'tilt' },
      championshipDone: false,
    };
  }

  function loadGame() {
    const s = RC.loadSave();
    const base = defaultSave();
    if (!s) return base;
    return Object.assign(base, s, {
      upgrades: Object.assign(base.upgrades, s.upgrades || {}),
      settings: Object.assign(base.settings, s.settings || {}),
      best: s.best || {},
    });
  }

  function persist() { RC.writeSave(RC.game.save); }

  /* ---------- Building a race ---------- */

  RC.startRace = function (raceIndex) {
    const g = RC.game;
    const def = RC.TRACK_DEFS[raceIndex];
    const track = RC.buildTrack(def);
    const rng = RC.makeRng(1000 + raceIndex * 977);
    RC.populateTrack(track, rng, raceIndex);

    const race = {
      track,
      raceIndex,
      cars: [],
      playerCar: null,
      missiles: [],
      slicks: [],
      particles: [],
      time: 0,
      countdown: 3.999,
      started: false,
      controlsLive: false,
      over: false,
      minimap: RC.buildMinimap(track, Math.min(132, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.30))),
      hudTopInset: 0,
      toast: showToast,
      shakeFrom,
    };

    // --- The grid ---
    // Cars line up in pairs behind the start/finish line. The player is
    // slotted mid-pack so there is always someone to chase and someone to
    // hold off.
    const aiSkillBase = 0.30 + raceIndex * 0.115;
    let aiCount = 0;

    for (let slot = 0; slot < FIELD; slot++) {
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const idx = track.count - 10 - row * 5;
      const lateral = (col === 0 ? -1 : 1) * track.halfWidth * 0.38;
      const p = track.pointAt(idx, lateral);
      const isPlayer = slot === PLAYER_GRID_SLOT;

      const car = RC.makeCar({
        x: p[0], y: p[1],
        heading: track.headings[((idx % track.count) + track.count) % track.count],
        index: slot,
        isPlayer,
        engine: isPlayer ? g.save.upgrades.engine : 0,
        tires: isPlayer ? g.save.upgrades.tires : 0,
        armor: isPlayer ? g.save.upgrades.armor : 0,
      });

      if (isPlayer) {
        car.name = 'YOU';
        race.playerCar = car;
      } else {
        // Spread the field's ability out around the difficulty for this race.
        const spread = (aiCount - 2) * 0.07;
        const skill = RC.clamp(aiSkillBase + spread + (rng() - 0.5) * 0.06, 0.05, 0.97);
        car.ai = RC.makeAiBrain(skill, rng);
        // The computer cars get upgrades too on later rounds, so the field
        // scales up with you instead of being left behind.
        const tier = Math.min(3, Math.floor(raceIndex * 0.7));
        car.engine = tier; car.tires = tier; car.armor = Math.max(0, tier - 1);
        aiCount++;
      }

      car.loc = track.locate(car.x, car.y, null).index;
      race.cars.push(car);
    }

    g.race = race;
    g.screen = 'race';
    g.paused = false;
    RC.input.reset();
    updateHudStatic();
    showScreen(null);
    return race;
  };

  function shakeFrom(x, y, amount) {
    const race = RC.game.race;
    if (!race || !race.playerCar) return;
    const d = RC.dist(x, y, race.playerCar.x, race.playerCar.y);
    const falloff = RC.clamp(1 - d / 700, 0, 1);
    RC.view.shake = Math.max(RC.view.shake, amount * falloff);
  }

  /* ---------- Standings ---------- */

  function computePlaces(race) {
    const sorted = race.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    sorted.forEach((c, i) => { c.place = i + 1; });
    return sorted;
  }

  /* ---------- The loop ---------- */

  let lastTs = 0;
  let accumulator = 0;
  const STEP = 1 / 120; // simulate at a steady 120Hz no matter the display

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    // If the tab was hidden or the phone locked, dt could be enormous.
    // Clamping stops the cars teleporting through the scenery on resume.
    dt = Math.min(dt, 0.1);

    const g = RC.game;
    if (g.screen !== 'race' || !g.race) return;

    if (!g.paused) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP && steps < 8) {
        stepRace(g.race, STEP);
        accumulator -= STEP;
        steps++;
      }
      if (steps >= 8) accumulator = 0;
    }

    RC.updateCamera(g.race, dt);
    RC.draw(g.race);
    updateHud(g.race);
  }

  function stepRace(race, dt) {
    RC.input.update(dt);

    // --- Countdown ---
    if (!race.started) {
      const before = Math.ceil(race.countdown);
      race.countdown -= dt;
      const after = Math.ceil(race.countdown);
      if (after !== before && after >= 0) {
        setCountdown(after === 0 ? 'GO!' : String(after));
        RC.audio.count(after === 0);
      }
      if (race.countdown <= 0) {
        race.started = true;
        race.controlsLive = true;
        setCountdown('');
        for (const c of race.cars) c.lapStartTime = 0;
      }
    } else {
      race.time += dt;
    }

    race.controlsLive = race.started && !race.over;

    // --- Firing ---
    if (RC.input.consumeFire() && race.controlsLive && race.playerCar) {
      RC.fireItem(race.playerCar, race);
    }

    // --- Cars ---
    for (const car of race.cars) {
      if (car.finished) {
        // Coast to a stop past the line rather than freezing mid-air.
        car.speed = RC.damp(car.speed, 0, 1.6, dt);
        car.x += Math.cos(car.heading) * car.speed * dt;
        car.y += Math.sin(car.heading) * car.speed * dt;
        continue;
      }
      RC.updateCar(car, race.track, dt, race);
      RC.leashCar(car, race.track);

      if (car.lap >= race.track.laps && !car.finished) {
        car.finished = true;
        car.finishTime = race.time;
        if (car.isPlayer) onPlayerFinish(race, car);
      }
    }

    RC.resolveCarCollisions(race.cars);
    RC.updateItems(race, dt);
    RC.updateParticles(race, dt);
    computePlaces(race);

    // Engine note follows the player's car.
    const p = race.playerCar;
    if (p) {
      const rev = RC.clamp(p.speed / RC.carMaxSpeed(p), 0, 1.4);
      RC.audio.engine(rev, race.started && !race.over ? 1 : 0.25);
    }
  }

  function onPlayerFinish(race, car) {
    race.over = true;
    race.controlsLive = false;

    // Everyone still running is placed by how far round they got.
    computePlaces(race);
    const place = car.place;
    const g = RC.game;

    const best = g.save.best[race.track.name];
    const isBest = !best || car.finishTime < best;
    if (isBest) g.save.best[race.track.name] = car.finishTime;

    const advanced = place <= PODIUM;
    if (advanced) {
      g.save.points += POINTS[place - 1] || 0;
      g.save.upgrades = { engine: car.engine, tires: car.tires, armor: car.armor };
      if (race.raceIndex + 1 >= RC.TRACK_DEFS.length) {
        g.save.championshipDone = true;
      } else {
        g.save.raceIndex = Math.max(g.save.raceIndex, race.raceIndex + 1);
      }
    }
    persist();

    if (advanced) RC.audio.finish(); else RC.audio.fail();
    setTimeout(() => showResults(race, car, place, advanced, isBest), 1400);
  }

  /* ============================================================
     User interface
     ============================================================ */

  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.remove('on');
    $('hud').classList.toggle('on', id === null);
    if (id) $(id).classList.add('on');
  }

  function setCountdown(text) {
    const el = $('countdown');
    el.textContent = text;
    if (text) {
      el.classList.remove('pop');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add('pop');
    }
  }

  function showToast(text, color) {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('rise');
    void el.offsetWidth;
    el.classList.add('rise');
  }

  function updateHudStatic() {
    const race = RC.game.race;
    $('trackName').textContent = race.track.name;
    // Leave room for a phone's notch / rounded corners.
    race.hudTopInset = parseInt(getComputedStyle(document.body).getPropertyValue('--safe-top')) || 0;
  }

  const ITEM_ICON = { missile: '🚀', oil: '🛢️', turbo: '⚡' };
  let lastItem = 'none';
  let lastLap = -1;
  let lastPlace = -1;

  function updateHud(race) {
    const car = race.playerCar;
    if (!car) return;

    if (car.place !== lastPlace) {
      lastPlace = car.place;
      $('place').textContent = RC.ordinal(car.place);
      $('place').className = car.place <= 3 ? 'good' : '';
    }

    const lap = RC.clamp(car.lap + 1, 1, race.track.laps);
    if (lap !== lastLap) {
      lastLap = lap;
      $('lap').textContent = 'LAP ' + lap + '/' + race.track.laps;
    }

    const it = car.item || 'none';
    if (it !== lastItem) {
      lastItem = it;
      const slot = $('itemSlot');
      slot.textContent = car.item ? ITEM_ICON[car.item] : '';
      slot.classList.toggle('full', !!car.item);
    }

    const frac = RC.clamp(car.speed / RC.carMaxSpeed(car), 0, 1);
    $('speedFill').style.width = (frac * 100).toFixed(0) + '%';
    $('speedFill').classList.toggle('boost', car.boost > 0);
  }

  function showResults(race, car, place, advanced, isBest) {
    const g = RC.game;
    $('resultPlace').textContent = RC.ordinal(place);
    $('resultPlace').className = advanced ? 'big good' : 'big bad';
    $('resultTrack').textContent = race.track.name;
    $('resultTime').textContent = RC.formatTime(car.finishTime) + (isBest ? '  ★ BEST' : '');

    // The race stops the moment you cross the line, so most rivals have no
    // finish time. Rather than a row of dashes, work out how far back they
    // were and show it as a gap - which is what you actually want to know.
    const avgLap = car.finishTime / race.track.laps;
    const rows = computePlaces(race).map((c, i) => {
      let time;
      if (c.finished) {
        time = RC.formatTime(c.finishTime);
      } else {
        const gap = (car.totalProgress - c.totalProgress) * avgLap;
        time = gap > 0.05 ? '+' + gap.toFixed(1) + 's' : '--';
      }
      return '<div class="row' + (c.isPlayer ? ' me' : '') + '">' +
        '<span class="pos">' + (i + 1) + '</span>' +
        '<span class="dot" style="background:' + c.color.body + '"></span>' +
        '<span class="nm">' + c.name + '</span>' +
        '<span class="tm">' + time + '</span>' +
        '</div>';
    }).join('');
    $('resultTable').innerHTML = rows;

    $('resultUpgrades').innerHTML =
      upgradePips('ENGINE', car.engine) + upgradePips('TYRES', car.tires) + upgradePips('CAGE', car.armor);

    const last = race.raceIndex + 1 >= RC.TRACK_DEFS.length;
    if (advanced && last) {
      $('resultMsg').textContent = 'CHAMPION! ' + g.save.points + ' points.';
      $('btnNext').textContent = 'Back to menu';
      $('btnNext').dataset.action = 'menu';
    } else if (advanced) {
      $('resultMsg').textContent = 'Podium! Next up: ' + RC.TRACK_DEFS[race.raceIndex + 1].name;
      $('btnNext').textContent = 'Next race →';
      $('btnNext').dataset.action = 'next';
    } else {
      $('resultMsg').textContent = 'Top ' + PODIUM + ' to move on. Have another go.';
      $('btnNext').textContent = 'Retry race';
      $('btnNext').dataset.action = 'retry';
    }

    RC.game.screen = 'results';
    showScreen('results');
  }

  function upgradePips(label, level) {
    let pips = '';
    for (let i = 0; i < 3; i++) pips += '<i class="' + (i < level ? 'on' : '') + '"></i>';
    return '<div class="up"><span>' + label + '</span>' + pips + '</div>';
  }

  function buildMenu() {
    const g = RC.game;
    const list = RC.TRACK_DEFS.map((t, i) => {
      const locked = i > g.save.raceIndex;
      const best = g.save.best[t.name];
      return '<button class="trackBtn' + (locked ? ' locked' : '') + '" data-race="' + i + '"' +
        (locked ? ' disabled' : '') + '>' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="info"><b>' + (locked ? '???' : t.name) + '</b>' +
        '<em>' + (locked ? 'Finish the previous race to unlock' : t.subtitle) + '</em></span>' +
        '<span class="bst">' + (best ? RC.formatTime(best) : '') + '</span>' +
        '</button>';
    }).join('');
    $('trackList').innerHTML = list;

    $('menuPoints').textContent = g.save.points + ' pts';
    $('menuUpgrades').innerHTML =
      upgradePips('ENGINE', g.save.upgrades.engine) +
      upgradePips('TYRES', g.save.upgrades.tires) +
      upgradePips('CAGE', g.save.upgrades.armor);
  }

  /* ---------- Control settings ---------- */

  function refreshControlUi() {
    const s = RC.game.save.settings;
    $('sens').value = String(s.sensitivity);
    $('sensVal').textContent = s.sensitivity.toFixed(1) + '×';
    $('invert').checked = s.invert;
    $('sound').checked = s.sound;
    document.querySelectorAll('[data-mode]').forEach(b =>
      b.classList.toggle('sel', b.dataset.mode === RC.input.mode));

    let status;
    if (RC.input.mode === 'touch') {
      status = RC.input.tiltPermission === 'denied'
        ? 'Motion access was declined — using touch steering.'
        : RC.input.tiltPermission === 'unsupported'
          ? 'This device has no tilt sensor — using touch steering.'
          : 'Touch steering: hold the left or right half of the screen.';
    } else {
      status = RC.input.tiltAvailable
        ? 'Tilt steering is live. Recalibrate if it pulls to one side.'
        : 'Waiting for the motion sensor…';
    }
    $('tiltStatus').textContent = status;
  }

  async function enableTilt() {
    const ok = await RC.input.requestTilt();
    RC.game.save.settings.mode = RC.input.mode;
    persist();
    refreshControlUi();
    return ok;
  }

  /* ---------- Wiring up the buttons ---------- */

  function bindUi() {
    const g = RC.game;

    $('trackList').addEventListener('click', (e) => {
      const btn = e.target.closest('.trackBtn');
      if (!btn || btn.disabled) return;
      RC.audio.start();
      RC.startRace(parseInt(btn.dataset.race, 10));
    });

    $('btnStart').addEventListener('click', async () => {
      RC.audio.start();
      if (g.save.settings.mode === 'tilt') await enableTilt();
      RC.startRace(Math.min(g.save.raceIndex, RC.TRACK_DEFS.length - 1));
    });

    $('btnTracks').addEventListener('click', () => { buildMenu(); showScreen('tracks'); g.screen = 'tracks'; });
    $('btnSettings').addEventListener('click', async () => {
      refreshControlUi();
      showScreen('settings');
      g.screen = 'settings';
      // Probe the motion sensor on the way in. Without this the screen sits
      // there saying "waiting for the motion sensor" on a device that hasn't
      // got one, because nothing had asked it yet.
      if (RC.input.mode === 'tilt' && RC.input.tiltPermission === 'unknown') {
        RC.audio.start();
        await enableTilt();
      }
    });
    $('btnHowto').addEventListener('click', () => { showScreen('howto'); g.screen = 'howto'; });

    document.querySelectorAll('[data-back]').forEach(b =>
      b.addEventListener('click', () => { buildMenu(); showScreen('menu'); g.screen = 'menu'; }));

    $('btnNext').addEventListener('click', () => {
      const action = $('btnNext').dataset.action;
      if (action === 'next') RC.startRace(g.race.raceIndex + 1);
      else if (action === 'retry') RC.startRace(g.race.raceIndex);
      else { buildMenu(); showScreen('menu'); g.screen = 'menu'; }
    });

    $('btnQuit').addEventListener('click', () => { buildMenu(); showScreen('menu'); g.screen = 'menu'; });

    $('btnPause').addEventListener('click', () => {
      g.paused = true;
      showScreen('pause');
    });
    $('btnResume').addEventListener('click', () => {
      g.paused = false;
      RC.input.reset();
      showScreen(null);
    });
    $('btnPauseCalib').addEventListener('click', () => {
      RC.input.calibrate();
      showToast('Centred', '#7fe8ff');
    });
    $('btnPauseQuit').addEventListener('click', () => {
      g.paused = false;
      g.screen = 'menu';
      buildMenu();
      showScreen('menu');
    });

    // Settings
    $('sens').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      g.save.settings.sensitivity = v;
      RC.input.sensitivity = v;
      $('sensVal').textContent = v.toFixed(1) + '×';
      persist();
    });
    $('invert').addEventListener('change', (e) => {
      g.save.settings.invert = e.target.checked;
      RC.input.invert = e.target.checked;
      persist();
    });
    $('sound').addEventListener('change', (e) => {
      g.save.settings.sound = e.target.checked;
      RC.audio.start();
      RC.audio.setEnabled(e.target.checked);
      persist();
    });
    $('btnCalibrate').addEventListener('click', () => {
      RC.input.calibrate();
      $('tiltStatus').textContent = 'Centred on how you are holding it right now.';
    });
    document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => {
      RC.audio.start();
      if (b.dataset.mode === 'tilt') {
        await enableTilt();
      } else {
        RC.input.mode = 'touch';
        g.save.settings.mode = 'touch';
        persist();
      }
      refreshControlUi();
    }));

    $('btnReset').addEventListener('click', () => {
      if (!confirm('Erase all progress and upgrades?')) return;
      const settings = g.save.settings;
      g.save = defaultSave();
      g.save.settings = settings;
      persist();
      buildMenu();
      showToast('Progress cleared', '#ff9d4d');
    });

    // Pause automatically if the player switches apps or locks the phone.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && g.screen === 'race' && !g.paused) {
        g.paused = true;
        showScreen('pause');
      }
    });
  }

  /* ---------- Boot ---------- */

  window.addEventListener('load', () => {
    RC.game.save = loadGame();
    RC.input.sensitivity = RC.game.save.settings.sensitivity;
    RC.input.invert = RC.game.save.settings.invert;
    RC.input.mode = RC.game.save.settings.mode;
    RC.audio.enabled = RC.game.save.settings.sound;

    const canvas = $('game');
    RC.initRender(canvas);
    RC.input.attach(canvas);
    bindUi();
    buildMenu();
    showScreen('menu');

    requestAnimationFrame(frame);
  });
})();
