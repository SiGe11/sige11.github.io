# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The personal site at **sige25.dev**, served straight from `main` by GitHub Pages
(`CNAME`, `.nojekyll`). There is **no build step, no bundler and no package
manager at the root** — every file in the repo is the file the browser gets.
Everything is vanilla ES modules, hand-written CSS and self-hosted fonts; no
runtime dependency is shipped.

Four independent pieces share the repo:

| | |
|---|---|
| `index.html`, `lightweight-blocker.html` | the business card. `css/style.css`, shared markup shape. |
| `crt/` | terminal mode — a CRT/TUI overlay for the two pages above. |
| `content/writeups/funpage/` | a TryHackMe write-up. Self-contained, own CSS. |
| `swarmvshero/` | a canvas game. Self-contained, own README, own tests. |

`crt/README.md` and `swarmvshero/README.md` are the authoritative docs for those
two, and both carry a "constraints worth knowing before editing" section listing
non-obvious things (Safari quirks, measurement rules, balance variance). **Read
the relevant one before touching either directory**; the notes there exist
because the obvious change breaks something.

## Running it

Everything must be served over HTTP — ES modules are blocked over `file://`
(origin `null` fails the CORS check), so opening an HTML file directly gives a
blank page.

```bash
python3 -m http.server 8127 --bind 127.0.0.1
```

Terminal mode needs a viewport of at least 760x480 and a fine pointer, so use a
desktop-sized window when checking it.

Safari serves ES module imports from its memory cache; a plain `Cmd+R` will not
pick up an edit. Use `Cmd+Option+R` (Reload From Origin), or serve with caching
off:

```bash
python3 -c "import http.server as s; H=type('H',(s.SimpleHTTPRequestHandler,),{'end_headers':lambda self:(self.send_header('Cache-Control','no-store'), s.SimpleHTTPRequestHandler.end_headers(self))}); s.test(HandlerClass=H,port=8127)"
```

## Tests

The only automated suite in the repo is the game's. It lives in
`swarmvshero/dev/browser-tests/` and drives Chromium, real Chrome, Firefox and
WebKit through Playwright, plus real Safari through `safaridriver`.

It expects the server **rooted at `swarmvshero/`, on port 8765** — not the repo
root, because it fetches `/dev/compat-check.html`:

```bash
cd swarmvshero && python3 -m http.server 8765
```

Then, from `swarmvshero/dev/browser-tests/`:

```bash
npm run setup   # once: installs playwright + ~500 MB of engines
npm test        # Chromium, Chrome, Firefox, WebKit
npm run safari  # real Safari; needs Develop -> Allow Remote Automation
npm run pixels  # 576-point pixel-grid comparison across engines
```

Screenshots and raw results land in `/tmp/swarm-shots` (override with `SHOTS`).
There is no per-test filter; `run.mjs` is a single script — to narrow a run,
edit its `VIEWPORTS` list or comment out checks.

Game balance is measured, not tested: paste `swarmvshero/dev/balance-harness.js`
into the console on a running game and call `window.__suite(window.__DUMB, 80)`.
Run-to-run variance is high enough that 80-run samples of an identical build
have ranged from 38% to 64% — pool several hundred runs before moving a number.

For the rest of the site there is no committed suite. Cross-browser work has
been done with throwaway Playwright scripts in the scratchpad against Chrome,
Firefox and WebKit; write one, run it, don't commit it.

## Architecture notes

### Terminal mode is bolted on, not built in

The site's entire dependency on `crt/` is one line before `</body>`:

```html
<script type="module" src="/crt/boot.js"></script>
```

Only `index.html` and `lightweight-blocker.html` carry it. Delete the line and
terminal mode is gone; the pages underneath are complete, working documents on
their own. `boot.js` feature-gates on pointer, touch, UA and viewport, and
lazy-loads everything else — on a phone `crt.css` is never even requested.

**On desktop it is the default view**, not an opt-in: the page powers up as a
CRT. Leaving is deliberately not remembered, so a reload brings it back.

### The two views cannot drift

`crt/page.js` reads the *live document* — `.info-block`'s `h1`/`h2`/`a[href]`
and the JSON-LD block — rather than duplicating the content. That is why both
root pages share the same markup shape:

```html
<main class="main-container">
  <div class="info-block">
    <h1>…</h1><h2>…</h2><ul><li><a href="…">…</a></li></ul>
  </div>
</main>
```

Changing that structure silently changes what terminal mode renders. Adding a
link to the page adds it to the TUI automatically; nothing in `crt/` needs
editing.

The exception is `about.txt`, whose bio comes from `PROFILE` in `crt/vfs.js`
(the links under it are still read from the page). `vfs.js` also carries
fabricated file sizes for `ls -l` — if you change a file's contents, nudge its
listed size so `cat` and `ls` don't contradict each other.

### CRT effects run in bursts, not continuously

Three effects in `crt/crt.css` are gated by an `is-live` class that `crt.js`
adds and removes on a randomised schedule (the `pulse()` helper): micro-jitter,
the brightness flicker on the glass overlay, and the vertical-hold roll band.
The animations themselves are untouched — only *whether* one is running. A fixed
cadence reads as a mechanical loop; random burst/rest spells read as a tired
tube.

If you add a burst-gated animation, put it on `.thing.is-live` and add that
selector to the `prefers-reduced-motion` block too — the class out-specifies the
bare `animation: none` rule.

### The write-up carries a Bootstrap subset, not Bootstrap

`content/writeups/funpage/fp_style.css` inlines the handful of Bootstrap Grid
rules the page actually uses. The `!important` on the utility classes
(`.mb-4`, `.p-4`, …) is **load-bearing** — it is what lets a utility beat
`.writeup-img`'s own margin. Dropping it silently changes the spacing under
every image. Bootstrap itself is not a dependency and its files are not in the
repo.

Images use `<picture>` with a WebP source and a PNG/JPG fallback. Flat
screenshots are lossless WebP and must not be resized — resampling invents
colours and multiplies the file size; only photographic images get resized.

## Conventions

- **Adding a page** means updating `sitemap.xml` (with `lastmod`) and
  `llms.txt`. `robots.txt` only points at the sitemap.
- **`prefers-reduced-motion` is honoured everywhere** — the fade-up on the
  business card, every CRT effect, the write-up. Keep it that way.
- **`#26719f`** is the accent (headings, link hover, the write-up's copy
  button); it was picked for contrast and shouldn't drift.
- **Browser targets** are Chrome, Edge, Firefox and Safari on desktop, plus
  Chrome, Firefox and Safari on mobile for the non-CRT pages. Edge is Blink, so
  Chrome covers it. The floor for terminal mode is roughly Chrome/Edge 86,
  Firefox 78, Safari 14.
- `content/writeups/funpage/images/gobuster.png` is currently referenced by
  nothing.
