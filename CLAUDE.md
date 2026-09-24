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
| `privacy.html` | privacy notice and licences. `css/style.css` + `css/legal.css`; terminal mode prints it too. |
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
Runs are seeded (`__suite(bot, n, { seed: 1 })`), so to judge a change, run the
same seeded batch on both builds — they then face identical maps and champions.

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
CRT. Leaving is remembered for the rest of the tab (`sessionStorage`): links
followed from the plain page, and Back, stay plain until the glyph switches
it on again. A reload or a new tab starts with the tube again.

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
editing. The flip side: **a link that must not be a menu entry goes outside
`.info-block`** — the privacy link lives in `<footer class="site-foot">` after
`</main>` for that reason (inside, it became an entry leading to a page with
no terminal mode). A link to `/` (the blocker page's `← Home`) is left out of the TUI
list, because its `..` entry already goes home. The TUI header shows the
JSON-LD `jobTitle` when there is one, else the meta description.

The exception is `about.txt`, whose bio comes from `PROFILE` in `crt/vfs.js`.
The profile links under it come from the JSON-LD `sameAs` list — the Person on
`index.html` and the `author` on `lightweight-blocker.html` carry the same
list; keep the two in step.

`vfs.js` also carries fabricated file sizes for `ls -l` — if you change a
file's contents, nudge its listed size so `cat` and `ls` don't contradict each
other.

The privacy notice follows the same rule: `crt/notice.js` fetches
`/privacy.html` and reads its `.legal` block for `:p` (page view) and
`privacynotice` (console, a `less`-style pager), so there is one text to edit. Its structure —
`h1` + `.subtitle`, `h2`, `p`, `ul`, `.updated`, `.back` — is what the
terminal understands; see "Constraints" in `crt/README.md`.

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

Images use `<picture>` with a WebP source and a PNG/JPG fallback, wrapped in an
`a.writeup-zoom` to the WebP: on a phone a terminal screenshot is only
readable at full size. Flat screenshots are lossless WebP and must not be
resized — resampling invents colours and multiplies the file size; only
photographic images get resized.

## Conventions

- **Adding a page** means updating `sitemap.xml` (with `lastmod`) and
  `llms.txt`. `robots.txt` points at the sitemap and keeps the repo's notes
  (`CLAUDE.md`, the READMEs) out of search — the repo is served as-is.
- **The privacy notice lists every storage key and every third-party asset.**
  Adding a `localStorage`/`sessionStorage` key, a cookie, a font or borrowed
  code means updating `privacy.html` (and the licence table in `README.md`);
  borrowed code also gets its notice in the file and its text in `licenses/`.
  The game links to the notice from its field guide by full URL
  (`PRIVACY_URL` in `swarmvshero/src/hud.js`), because it is also hosted
  away from this site; keep it absolute.
- **The two root pages, the privacy page and the write-up carry a
  Content-Security-Policy `<meta>`** (GitHub Pages cannot send headers; `swarmvshero/` has none yet): `default-src 'self'; img-src 'self' data:` plus lockdowns. So
  no inline `<script>`, no `on…=` attributes and no `style=` attributes in
  markup. JSON-LD blocks are fine (never executed), and so is setting
  `element.style` from JS. The write-up's copy buttons live in `copy.js` for
  this reason.
- **Social images**: the root pages' `og:image`s (`assets/og-*.png`, 1200x630)
  are screenshots of the page in terminal mode, served as `sige25.dev` so the
  screen shows the real domain; retake them when a page's content changes. The
  write-up's is `images/og-card.png`, its nmap output letterboxed.
- **Favicons**: `/assets/favicon.png` on the root pages, plus `/favicon.ico`
  and `/apple-touch-icon.png` at the root for anything that asks by
  convention. The write-up keeps its own inline favicon — its PNG comment is
  part of a puzzle.
- **`prefers-reduced-motion` is honoured everywhere** — the fade-up on the
  business card, every CRT effect, the write-up, the game's screen shake and
  flashes. Keep it that way.
- **`#26719f`** is the accent (headings, link hover, the write-up's copy
  button); it was picked for contrast and shouldn't drift.
- **Browser targets** are Chrome, Edge, Firefox and Safari on desktop, plus
  Chrome, Firefox and Safari on mobile for the non-CRT pages. Edge is Blink, so
  Chrome covers it. The floor for terminal mode is roughly Chrome/Edge 86,
  Firefox 78, Safari 14.
