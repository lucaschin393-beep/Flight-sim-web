# Airplane Simulator (web)

A 3D flight simulator that runs in the browser, written in **TypeScript** with **three.js** (WebGL)
and **Web Audio**. It is a port of the Python/pygame simulator: same flight model, aircraft, maps,
crashes and sounds, but drawn with a real depth buffer and shadows, so it is smooth and runs
anywhere a browser does.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm test` (Vitest), `npm run typecheck`, `npm run build` (static site in `dist/`),
`npm run preview` (serve the build).

The build is a plain static site (relative URLs), so `dist/` can be hosted anywhere. Pushing to
`main` on GitHub deploys it to GitHub Pages through `.github/workflows/deploy.yml`
(enable Pages in the repo settings with *Source: GitHub Actions*).

Click the page (or press any key) to start: browsers only allow sound after a user gesture.

## Controls

| Key | Action |
|-----|--------|
| `W` / `S` | Nose down / nose up |
| `A` / `D` | Bank (and turn) left / right |
| `Shift` / `Ctrl` (or `E` / `Q`, `↑` / `↓`) | Throttle up / down |
| `G` | Landing gear up / down (can't be raised on the ground) |
| `B` (hold) | Air brake (wheel brake on the ground) |
| `C` (or `1`–`4`) | Change aircraft |
| `N` (or `F1`–`F5`) | Change map |
| `Space` / `Esc` | Pause / resume |
| `P` | Change view (3rd person ⇄ 1st person) |
| `R` | Restart (after a safe landing: carry on from where you landed) |
| `M` | Mute / unmute |
| `H` | Show / hide the help text |

`Ctrl+W` closes a browser tab, so `E` / `Q` are there as throttle keys if you fly with `W`.
Set `INVERT_PITCH` in `src/config.ts` if you prefer `W` = climb.

## Aircraft

| Key | Aircraft | Character |
|-----|----------|-----------|
| `1` | Skylark trainer | Forgiving all-rounder |
| `2` | Barnstormer biplane | Slow, light and nimble |
| `3` | Falcon jet | Very fast, snappy roll, high landing speed; afterburner flame and roar |
| `4` | Atlas airliner | Big, heavy, sluggish; needs wide turns and gentle inputs |

## Maps

| Key | Map | Look |
|-----|-----|------|
| `F1` | Home Fields | Green plains, no water |
| `F2` | Emerald Lakes | Green hills dotted with lakes |
| `F3` | Island Chain | A warm sea scattered with islands; the runway is on one |
| `F4` | Sunset Coast | Dry shores in the west, open ocean to the east, a few ponds |
| `F5` | Frozen Fjords | Snowy highlands cut by long, dark fjords and lakes |

Switching maps restarts you at the runway (always on dry land) in the same aircraft.
Land, water and shores are generated from a seeded height field, so a map is the same every time.

## How to fly

- You start airborne over the start of the runway, heading north.
- Banking turns the plane; level the wings by releasing `A`/`D`. Banking also pulls the nose
  down, so add back-pressure (`S`) in turns.
- Climbing bleeds speed. Below stall speed the plane sinks and the nose drops: push `W` and add throttle.
- **Landing:** lower the gear (`G`), cut the throttle and hold `B` to slow down. The HUD (bottom left)
  shows the speed and sink-rate limits for your aircraft. Touch down gently, wings and nose level,
  on dry ground (the runway or anywhere else). Landing with the gear up is a crash. Water is not landable.
- **Taking off:** after a safe landing `R` parks you right there. Hold throttle, steer with
  `A`/`D`, and pull back (`S`) above the rotate speed shown on screen. Ground speed is capped at 300 km/h.
- **Crashes:** hitting the ground too fast or unlevel, or touching a mountain, building or tree with
  the body, tail, propeller or wheels, is a crash. Clipping a tree or building with only a **wing**
  snaps that wing off: it tumbles away and you keep flying, but the plane rolls toward the missing
  side and sinks. Losing the second wing is fatal.
- **Fire and water:** a crash blows the plane apart into tumbling pieces, a scorch mark and a burning
  wreck; hitting water gives a splash and the wreckage sinks.

## Layout

```
index.html           page, start screen and the two canvases (3D view + HUD)
src/main.ts          browser entry: keyboard, resize, animation loop
src/game.ts          game state and per-frame rules (no DOM / WebGL)
src/plane.ts         flight model, collision points, wing loss
src/aircraft.ts      the four aircraft: handling, models, engine and wing data
src/meshes.ts        low-poly shape builders and the four aircraft models
src/maps.ts          the five maps and the land/water height field
src/world.ts         runway, mountains, buildings, trees; collision queries
src/explosion.ts     crash simulation: particles, wreckage pieces, scorch, ripples
src/camera.ts        chase and cockpit camera (game coordinates)
src/sceneview.ts     three.js scene: streaming terrain, aircraft, shadow, crash effects
src/geometry.ts      game polygons -> three.js geometry (z is mirrored, see the comment)
src/hud.ts           flight data, help, landing panel, cockpit frame (2D canvas)
src/soundgen.ts      procedural sound waveforms (no audio files)
src/sound.ts         Web Audio playback: engines, gear, tyres, crash, fire, afterburner
tests/               Vitest tests (physics, collisions, maps, explosions, sound)
```

The game world uses x = right, y = up, z = forward; three.js looks down -z, so `geometry.ts`
mirrors z when handing geometry and transforms to three.js.
