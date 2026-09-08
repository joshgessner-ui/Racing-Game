# Turbo Circuit

A top-down racer for phones and tablets, built in the spirit of
**R.C. Pro-Am**: little toy cars, missiles, oil slicks, and upgrades you keep
for the rest of the championship.

A four-way cross on the left, turbo and fire on the right. The car
accelerates itself.

---

## Play it

**On your phone or tablet — the way it's meant to be played:**

1. On GitHub, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, then set the branch to
   **`main`** and the folder to **`/ (root)`**. Click **Save**.
3. Wait a minute or two, then refresh that page — GitHub shows you the live
   link at the top. It will be:

   **https://joshgessner-ui.github.io/Racing-Game/**

4. Open that link on your phone, then tap **Share → Add to Home Screen**. It
   opens fullscreen with no address bar after that, like a real app.

That's the whole deployment. There's no build step and nothing to install —
the repository *is* the website, so every push updates the live game
automatically.

**On a computer, to try it quickly:** double-click `index.html`. Steer with the
arrow keys, fire with the spacebar.

## The rules

- **Steering.** Left and right on the cross turn your car, for as long as you
  hold them. Let go and it holds the line it's on. It's a steering wheel, not
  a compass — you're turning the car, not pointing it at a spot on the map.
- **BRAKE** is the bottom of the cross. Your car speeds up on its own, so
  braking is your only way to slow down — and it also turns you about a
  quarter quicker, which is how you get round the tight stuff. You can hold
  brake and a direction together; press down-and-left on the cross.
- **TURBO** is a burst of speed from a meter that refills when you're not
  using it: about two seconds of boost when full, seven and a half to refill.
  Every car on the grid has one.
- **FIRE** uses your item. The button shows what you're carrying.
- Finish in the **top three** to unlock the next circuit.
- **🚀 Missile** — fires forward, spins out whoever it hits.
- **🛢️ Oil** — drops behind you for whoever is chasing.
- **⚡ Turbo pickup** — instantly refills your turbo meter.
- **Yellow squares** are upgrades: engine, tyres, roll cage. You keep them for
  the whole championship — including on races you don't win — so they're
  always worth the detour off the racing line. They're also the difficulty
  dial: on the last circuit, no upgrades finishes about sixth, a full set
  about second.
- **Glowing arrows** on the tarmac are speed strips. Free speed, if you can hit them.
- There's dirt either side of the tarmac and a barrier beyond it. The dirt is
  slow, so cutting a corner never pays.

Five circuits, getting harder. The first you can take almost flat out; the last
has a hairpin you genuinely have to brake for.

---

## If the handling feels wrong

Under **Controls** on the main menu:

| Problem | Fix |
|---|---|
| The car turns too slowly | Turn **Steering speed** up |
| The car is twitchy and hard to hold straight | Turn **Steering speed** down |
| Bumps and explosions make you queasy | Turn **Screen shake** off |

**On motion sickness.** The camera never rotates — north on the track is
always up on the screen, and the view just slides along to follow you, the way
the original RC Pro-Am worked. If anything still bothers you, turning screen
shake off removes the last camera movement that isn't your own driving.

**One consequence of that fixed camera** worth knowing: when you're driving
down the screen, pressing right turns the car right *from the car's point of
view*, which looks like moving left on screen. That's how RC Pro-Am handled it
too. The alternative is turning the camera with the car, which is what made
you ill.

---

## How the code is laid out

No build step, no installing anything, no libraries. Nine plain JavaScript
files loaded in order by `index.html`. Open any of them in a text editor,
change a number, refresh the page.

| File | What it does |
|---|---|
| `js/util.js` | Small maths helpers. No game logic. |
| `js/audio.js` | Every sound, generated in code — there are no audio files. |
| `js/input.js` | The cross and the two buttons, plus keyboard for desktop. |
| `js/track.js` | Turns a handful of points into a circuit, and answers "am I on the road?", "what lap is this?" |
| `js/tracks.js` | **The five circuits.** The most fun file to experiment with. |
| `js/car.js` | How a car moves, and how the computer drivers think. |
| `js/items.js` | Crates, missiles, oil, turbo, upgrades. |
| `js/render.js` | Everything you see. |
| `js/game.js` | The game loop, the championship, and the menus. |

### Things worth trying first

- **`js/tracks.js`** — each circuit is a circle with waves added on top. A wave
  that repeats twice per lap gives long sweepers; one that repeats six times
  gives tight technical corners. Change an `amp` and watch the track change.
- **`js/car.js`, the `BASE` block at the top** — `maxSpeed`, `turnRate`,
  `accel`. This is the feel of the game in five numbers. `turnRate` is the one
  that decides how sharp the steering feels.
- **`js/tracks.js`, the `theme` on each track** — the colours.

A note on the file structure: each file wraps its contents in
`(function () { ... })()`. That gives it a private scope. Plain `<script>` tags
all share one global namespace, so without it two files using the same variable
name is an error that stops the whole game loading.

---

## Adding your own track

Copy one of the entries in `js/tracks.js`, change the name and the numbers, and
it appears in the championship automatically. Nothing else needs editing —
pickups, the minimap, the AI's racing line and the start grid are all worked
out from the track shape.

Two rules. Keep it built from `ring({...})` — because every point is a
distance out from a centre, the track can never cross over itself, which would
break the lap counting.

And keep `halfWidth` comfortably under the radius of your tightest corner. If
the tarmac is wider than the corner is tight, the inside edge folds back
through itself and both the drawing and the collision break. Corner tightness
and track width are not independent: the width you can have is set by the
sharpest corner you keep.
