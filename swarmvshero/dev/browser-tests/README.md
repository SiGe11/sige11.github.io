# Cross-browser checks

Not part of the game. Nothing here ships; `index.html` never references it.

`run.mjs` drives Chromium, real Google Chrome, Firefox and WebKit through
Playwright. `safari.mjs` drives the real, shipping Safari through `safaridriver`
(WebDriver) — Playwright's WebKit is the engine, this is the browser people
actually have. `pixels.mjs` renders one deterministic scene in every engine and
compares a 576-point pixel grid, so "it looks right everywhere" is a
measurement rather than an impression.

## Setup

```bash
npm run setup
```

Downloads ~500 MB of browser engines into `~/Library/Caches/ms-playwright`.

## Running

The game must be served first, from the `swarmvshero` directory:

```bash
python3 -m http.server 8765
```

Then, from this directory:

```bash
npm test      # Chromium, Chrome, Firefox, WebKit
npm run safari  # the real Safari (see below)
npm run pixels  # per-engine pixel comparison
```

Screenshots and raw results land in `/tmp/swarm-shots`.

`npm run safari` needs Safari's **Develop → Allow Remote Automation** turned on,
and it drives a real visible Safari window rather than a headless one.

## What each run checks

- the page boots and the render loop advances
- a real click dismisses the intro and a real click summons a unit
- a digit held down when the strain panel opens does **not** pick a strain,
  and a fresh press after the settling window does
- 300 simulated seconds of play without an exception, with finite state
- the game, all six field-guide pages and the strain panel render, and the HUD
  does not overlap, at ten desktop viewports from 1024x640 to 3440x1440
- `dev/compat-check.html`'s own feature-detection verdict
