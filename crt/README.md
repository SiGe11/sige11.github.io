# Terminal mode

> This whole CRT module was generated with Claude Code (Opus 5), for test
> purposes — an experiment in how far an agent gets on a self-contained
> feature.

An optional vintage-terminal skin for the site. Click the little terminal icon in the
bottom-left corner and the page powers up as a green-phosphor CRT: the same
content, drawn as a TUI, with the same links.

The site does not depend on any of this. The only change to the pages
themselves is one line before `</body>`:

```html
<script type="module" src="/crt/boot.js"></script>
```

Remove that line and terminal mode is gone; nothing else has to change.

## When it is offered

`boot.js` injects the trigger glyph only when the visitor has

* JavaScript (the glyph is created in script — there is no markup for it),
* a fine pointer with hover (so: not a touch device),
* a viewport of at least 760 × 480.

Otherwise nothing is injected and no stylesheet is even requested.

## Using it

**Document view** — the page as a TUI.

| Key | Does |
|-----|------|
| arrows / `j` `k` / Tab | move the selection |
| Backspace | up to the site root (sub-pages only) |
| Enter, or a click | open the link |
| `1`–`9` | jump straight to that entry |
| `:q` | quit to the console |
| Esc | leave terminal mode |

**Console** — `help` lists every command it answers to: `ls`, `dir`,
`cat <file>`, `echo <file\|text>`, `./<file>`, `site`, `swarm`, `pwd`,
`whoami`, `date`, `uname`, `clear`, `exit`. Tab completes, the up arrow walks
the history, Ctrl+L clears, and Ctrl+C abandons the line — unless something is
selected, in which case the browser gets the keystroke and copies it.

Files in `~`:

| File | |
|------|--|
| `about.txt` | who Gergely Simon is |
| `site.sh` | draw the site again |
| `legacy.sh` | back to the normal website |
| `swarm.exe` | launch Swarm vs Hero |
| `writeup.sh` | open the Funpage write-up |

## Browsers

Verified end to end — boot, TUI, arrow keys, `:q`, the shell commands, link
navigation and exit — on Chrome 152 (Blink), Firefox 155 (Gecko) and WebKit
26.6, at 800x520, 1024x768, 1280x720, 1366x625, 1440x900, 1536x864,
1600x900, 1920x1080, 2560x1300 and 3440x1400, plus live resizing between
those. Edge shares Blink with Chrome and is covered by the same engine. No
mobile: the glyph is never injected there.

Two things the grid depends on, and how each is guarded:

* **Measurement** uses `offsetWidth`, not `getBoundingClientRect()`. The
  latter reports the transformed box, and the power-on animation scales this
  subtree — a re-measure landing mid-animation would inflate every cell.
* **Box drawing** only holds the grid together while `─ │ ┌ ┐ └ ┘ …` occupy
  exactly one cell. Their advance width is compared against `M` at measure
  time; if a font disagrees, the frame falls back to `- | +` and `.`.

The floor is roughly Chrome/Edge 86, Firefox 78 and Safari 14 — set by ES
modules, `replaceChildren` (which has a fallback anyway) and CSS custom
properties. Older browsers simply never get the glyph or degrade quietly.

## Layout

| File | |
|------|--|
| `boot.js` | eligibility check, the trigger glyph, lazy-loads the rest |
| `crt.js` | the screen: overlay, character grid, key routing, power on/off |
| `pageview.js` | the site drawn as a TUI, and the `:` command line |
| `shell.js` | the console — commands live in its `COMMANDS` table |
| `vfs.js` | the files in `~`, and what running them does |
| `page.js` | reads the current document, so the two views cannot drift |
| `text.js` | padding, wrapping, dotted leaders |
| `crt.css` | phosphor, scanlines, jitter, flutter, power on/off |

The machine calls itself **PhosphorOs** (φωσφόρος, light-bearer — what a
green screen literally is) and does its own talking in Latin; everything it
renders stays in English.

The tube's bulge is the `CURVE` constant in `crt.js`. Each rendered row is
scaled and nudged by how far it sits from the middle, which approximates
barrel distortion using transforms rather than a filter — so hit-testing
curves along with the picture and every link stays clickable exactly where
it looks. Set it to 0 to flatten the screen.

What `about.txt` says lives in the `PROFILE` constant at the top of
`vfs.js` — that is the one place to edit it. The links under it are read
from the page, so they never go stale.

Any page below the site root gets a `..` entry at the top of its list, so a
sub-page is never a one-way trip. Backspace does the same thing.

Adding a file means one entry in `vfs.js`; the shell picks it up for
listing, `cat`, `echo` and tab-completion on its own. Adding a command means
one entry in the `COMMANDS` table in `shell.js`.

Terminal mode is remembered in `sessionStorage` under `sige.crt`, so a link
followed from inside the terminal arrives in the terminal.
