# Terminal mode

> This whole CRT module was generated with Claude Code (Opus 5), for test
> purposes — an experiment in how far an agent gets on a self-contained
> feature.

A vintage-terminal skin, and on desktop it is what the visitor gets: the page
powers up as a green-phosphor CRT showing the same content as a TUI, with the
same links. Esc / `exit` / `./legacy.sh` leaves it for the plain document
underneath; leaving is **not** remembered, so the next load starts the tube
again. The glyph bottom-left brings it back without a reload.

The site's only dependency on any of this is one line before `</body>`:

```html
<script type="module" src="/crt/boot.js"></script>
```

Remove that line and terminal mode is gone.

## When it runs

`boot.js` does anything only with JavaScript, a fine pointer with hover (not
touch), and a viewport >= 760 x 480. Otherwise nothing is injected and
`crt.css` is never even requested — that is the whole mobile story.

`mode.js` carries one thing: `sige.crt.seen` in `sessionStorage`, keeping the
power-on crawl to once per tab so a link followed inside the terminal does not
replay the boot. Access is wrapped — reading `sessionStorage` throws outright
when site data is blocked.

## Keys

| Key | Document view |
|-----|----|
| arrows / `j` `k` / Tab | move the selection |
| Backspace | up to the site root (sub-pages only) |
| Enter, or a click | open the link |
| `1`-`9` | jump to that entry |
| `q` | to the console (`:q` also works) |
| Esc | leave terminal mode |

**Console** — `help` lists the lot: `ls`, `dir`, `cat <file>`,
`echo <file\|text>`, `./<file>`, `date`, `uname`, `clear`, `exit`. Tab
completes, up walks the history, Ctrl+L clears, Ctrl+C abandons the line —
unless text is selected, when the browser gets the key and copies.

Files in `~`: `about.txt`, `site.sh` (draw the site again), `legacy.sh` (back
to the normal site), `swarm.exe`, `writeup.sh`.

## Files

| File | |
|------|--|
| `boot.js` | eligibility, the trigger glyph, lazy-loads the rest |
| `mode.js` | has the tube warmed up in this tab |
| `crt.js` | overlay, character grid, key routing, power on/off |
| `pageview.js` | the site as a TUI, and the `:` command line |
| `shell.js` | the console — commands live in `COMMANDS` |
| `vfs.js` | the files in `~` and what running them does |
| `page.js` | reads the document, so the two views cannot drift |
| `text.js` | padding, wrapping, dotted leaders |
| `crt.css` | phosphor, scanlines, jitter, flutter, power on/off |

Edit points: `PROFILE` in `vfs.js` is what `about.txt` says (the links under
it are read from the page and never go stale); one more entry in `entries`
adds a file, which the shell then lists, cats and completes on its own; one
more entry in `COMMANDS` adds a command; `CURVE` in `crt.js` is the tube's
bulge, 0 to flatten it.

The machine calls itself **PhosphorOs** (φωσφόρος, light-bearer) and talks in
Latin; everything it renders stays in English.

## Constraints worth knowing before editing

* **Measurement** uses `offsetWidth`, never `getBoundingClientRect()`: the
  latter reports the transformed box, and the power-on animation scales this
  subtree, so a re-measure mid-animation inflates every cell.
* **Box drawing** holds the grid only while `─ │ ┌ ┐ └ ┘ …` are one cell
  wide. Their advance is compared against `M` at measure time; if the font
  disagrees the frame falls back to `- | +` and `.`.
* **Curvature** is per-row `scaleX` + `translateY`, not a filter, so
  hit-testing curves with the picture and links stay clickable where they
  look.
* **Caret**: inline-block, one line tall, no width — it wraps exactly the
  glyph it covers, so it takes a normal advance and shifts nothing.
* **Mouse pointer**: a one-cell block, document view only. `crt.js` puts the
  view name on the root as `data-view`; the stylesheet hangs the cursor off
  `[data-view="page"]` and hides it via `.is-idle` when the mouse stops. It
  is a PNG data URI because **Safari rejects an SVG cursor** and would fall
  back to the arrow.
* **The exit button** keys its visible state off `:active` as well as
  `:focus`, because **Safari does not focus a button on mousedown** — on
  `:focus` alone it shrinks back to a pixel between press and release and
  swallows its own click.
* The buffer is deliberately **not** `aria-live`: a screen redrawn on every
  keystroke would be read out on every keystroke.

## Verified

Boot, TUI, arrows, `q`, the shell commands, link navigation and exit on
Chrome 152 (Blink), Firefox 155 (Gecko) and WebKit 26.6 (Safari 26's engine)
at 800x520, 1024x768, 1280x720, 1366x768, 1440x900, 1536x864, 1600x900,
1920x1080, 2560x1440 and 3440x1440. Edge is Blink, covered by Chrome.
axe-core: no violations in either view on any engine. `prefers-reduced-motion`
drops jitter, flutter, roll and the power-on, and opens without the crawl.
Dim green is 4.8:1 on the tube, everything else well above.

Floor is roughly Chrome/Edge 86, Firefox 78, Safari 14 — ES modules,
`replaceChildren` (which has a fallback) and custom properties. Older
browsers never get the glyph, or degrade quietly.
