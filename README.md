# Turbo Circuit

A tilt-steered top-down racer for phones and tablets, built in the spirit of
**R.C. Pro-Am**: little toy cars, missiles, oil slicks, and upgrades you keep
for the rest of the championship.

Tilt to steer. Tap anywhere to fire. That's the whole control scheme.

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

Tilt steering only works on an `https://` address, which is why the GitHub
link matters. It won't work from a file on your desktop.

**On a computer, to try it quickly:** double-click `index.html`. Steer with the
arrow keys, fire with the spacebar.

## The rules

- Your car accelerates by itself. You only ever steer.
- Finish in the **top three** to unlock the next circuit. Below that, you retry.
- **🚀 Missile** — fires forward, spins out whoever it hits.
- **🛢️ Oil** — drops behind you for whoever is chasing.
- **⚡ Turbo** — an instant burst of speed.
- **Yellow squares** are upgrades: engine, tyres, roll cage. You keep them for
  the whole championship, so a good early race makes every later one easier.
  They sit off the racing line on purpose — grabbing one costs you time.
- **Glowing arrows** on the tarmac are speed strips. Free speed, if you can hit them.
- There's dirt either side of the tarmac and a barrier beyond it. The dirt is
  slow, so cutting a corner never pays.

Five circuits, getting harder. The first one you can take almost flat out; the
last has a hairpin you have to genuinely slow down for.

---

## If the steering feels wrong

Everything below is under **Controls** on the main menu.

| Problem | Fix |
|---|---|
| The car drifts to one side when you hold still | **Centre steering** — hold the device how you want to play, then tap it |
| Too twitchy / not responsive enough | **Sensitivity** slider |
| Steering is backwards | **Reverse steering** |
| Nothing happens when you tilt | Switch to **Touch** — hold the left or right half of the screen |

On iPhone and iPad the browser asks permission to use motion sensors the first
time. If you decline it, the game quietly switches to touch steering; you can
re-enable tilt from the Controls screen.

---

## How the code is laid out

No build step, no installing anything, no libraries. Nine plain JavaScript
files loaded in order by `index.html`. Open any of them in a text editor,
change a number, refresh the page.

| File | What it does |
|---|---|
| `js/util.js` | Small maths helpers. No game logic. |
| `js/audio.js` | Every sound, generated in code — there are no audio files. |
| `js/input.js` | Reading tilt, with touch and keyboard fallbacks. |
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
  `accel`. This is the feel of the game in five numbers.
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

The one rule: keep it built from `ring({...})`. Because every point is a
distance out from a centre, the track can never cross over itself, which would
break the lap counting.
