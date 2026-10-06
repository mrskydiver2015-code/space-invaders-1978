# Space Invaders 1978

A self-contained arcade replica built with HTML5 Canvas, vanilla JavaScript, and synthesized Web Audio. The entire game—including styles, pixel sprites, and sound—is in `index.html`. No external assets, runtime dependencies, or build step.

## Play locally

Open `index.html` in a modern browser, or serve this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` in your browser and select **Start Game**. Sound begins after a user gesture; the sound button toggles it. High scores are stored locally when browser storage is available. The game remains playable without storage or audio support.

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | Left/Right arrows or A/D | Hold either arrow |
| Fire | Hold Space | Hold FIRE |
| Pause/resume | P or Escape | Pause/Resume button |
| Start/retry | Enter or Start button | Start/Play Again button |

The phone layout reserves approximately 68% of the viewport for the game area and 32% for its separate touch deck. Move and fire simultaneously with two fingers. Switching tabs or losing window focus pauses play and releases held controls.

## Game mechanics

- 55 invaders in five rows, with two-frame squid (30), crab (20), and octopus (10) sprites.
- Discrete marching, edge reversal/descent, and an accelerating four-note bass sequence as the formation shrinks.
- A periodic mystery saucer awarding 50, 100, 150, or 300 points.
- Four pixel-mask bunkers eroded by both player lasers and alien bombs; descending invaders can crush them.
- One player laser at a time, three cannons, brief respawn protection, persistent high score, and successive waves.
- A fixed 60 Hz simulation driven by `requestAnimationFrame`, cached sprite frames, and bunker redraws only when damaged. Display refresh and device capability determine actual frame rate.

## Browser smoke tests

The optional test runner uses Node.js and Playwright with Chromium. Test tooling is separate from the dependency-free game. On the prepared Linux cloud environment:

```sh
npm install --prefix /tmp/invaders-smoke --cache /tmp/npm-cache playwright@1.58.2 --no-audit --no-fund
NODE_PATH=/tmp/invaders-smoke/node_modules node tests/smoke.cjs
```

Set `CHROMIUM_PATH` if the executable is somewhere other than `/usr/bin/chromium`. The runner starts and stops its own local HTTP server and browser.

Checks cover startup, keyboard pause, audio toggle, five viewport sizes, simultaneous touch controls, cancellation, formation movement, alien scoring, bunker erosion, UFOs, bombs, cannon loss, game over/restart, wave progression, focus handling, storage fallback, and browser console errors. Mechanics checks inject a test bridge into an in-memory response; no debug interface is included in the shipped game.

The initial Chromium run passed 30 checks with zero console errors and measured approximately 60 FPS over 120 sampled frames. Mobile controls are tested through Chromium touch emulation; physical iOS/Android hardware and audible sound quality still warrant manual testing.

## Deploy

Publish `index.html` with any static host, including GitHub Pages. No server-side code is required.
