# Terminal mode

> This whole CRT module was generated with Claude Code (Opus 5), for test
> purposes — an experiment in how far an agent gets on a self-contained
> feature.

A vintage-terminal skin, and on desktop it is what the visitor gets: the page
powers up as a green-phosphor CRT showing the same content as a TUI, with the
same links. Esc / `exit` / `./legacy.sh` — or a click on `ESC escape` in the
status line — leaves it for the plain document underneath. Leaving is
**honoured for the rest of the tab**: links followed from the plain page land
on plain pages, and Back does not bring the tube back either. The glyph
bottom-left switches it on again (and links then stay in it); a reload or a
new tab starts with the tube, as a first visit does.

The site's only dependency on any of this is one line before `</body>`:

```html
<script type="module" src="/crt/boot.js"></script>
```

Remove that line and terminal mode is gone.

## When it runs

`boot.js` does anything only with JavaScript, a fine pointer with hover (not
touch), and a viewport >= 760 x 480. Otherwise nothing is injected and
`crt.css` is never even requested — that is the whole mobile story.

On an eligible machine it preloads every module side by side (`MODULES` in
`boot.js` — a new module belongs on that list), and nothing opens until
`crt.css` has loaded: the glyph is injected on its `load`, and if it fails
there is no terminal mode at all rather than an unstyled one.

`mode.js` carries two flags in `sessionStorage`. `sige.crt.left` is set by
every way out (`close()` in `crt.js`) and cleared by `open()`; `boot.js`
skips the auto-start while it is set, unless the navigation is a reload.
`sige.crt.seen` keeps the power-on crawl to once per tab, so a link followed
inside the terminal does not replay the boot. Access is wrapped — reading
`sessionStorage` throws outright when site data is blocked.

## Keys

| Key | Document view |
|-----|----|
| arrows / `j` `k` / Tab | move the selection |
| Backspace | up to the site root (sub-pages only) |
| Enter, or a click | open the link |
| `1`-`9` | jump to that entry |
| `q` | to the console (`:q` also works) |
| `:p`, or a click on `:p privacy` | the privacy notice, paged inside the frame |
| Esc, or a click on `ESC escape` | leave terminal mode — also mid-crawl |

In the notice, `less`'s keys (`pagerDelta()` in `notice.js`): arrows / `j` `k`
/ Enter a line, Space / PageDown / `f` and Shift+Space / PageUp / `b` a screen,
`d` `u` half a screen, `g` `G` `<` `>` Home End the ends, the wheel too; `q`,
Backspace, `:q` or a click on `Q back` return to the links.

**Console** — `help` lists the lot: `ls`, `dir`, `cat <file>`,
`echo <file\|text>`, `./<file>`, `privacynotice`, `date`, `uname`, `clear`,
`exit`. `privacynotice` opens the notice full-screen as `less` would: the same
keys as above, `~` past the end, a reverse-video prompt line that reads
`(END)` at the end, and `q` (or Esc, or a click on `Q quit`) back to the
prompt with the console as it was. Tab
completes as bash does (unique match, then the shared prefix, then a listing;
dotfiles only once the word starts with `.`), up walks the history, Ctrl+L
clears, Ctrl+C abandons the line — unless text is selected, when the browser
gets the key and copies. Cmd/Ctrl+V pastes the clipboard's first non-empty
line. AltGr and Option characters (`~ | \ @ { }` on most non-US layouts),
dead keys and IME input all type as text.

Files in `~`: `about.txt`, `site.sh` (draw the site again), `legacy.sh` (back
to the normal site), `swarm.exe`, `writeup.sh`.

## Files

| File | |
|------|--|
| `boot.js` | eligibility, module preloads, the trigger glyph, lazy-loads the rest |
| `mode.js` | did the visitor leave it; has the tube warmed up — per tab |
| `crt.js` | overlay, character grid, key routing, power on/off |
| `pageview.js` | the site as a TUI, and the `:` command line |
| `shell.js` | the console — commands live in `COMMANDS` |
| `vfs.js` | the files in `~` and what running them does |
| `page.js` | reads the document, so the two views cannot drift |
| `notice.js` | reads `/privacy.html` and lays it out, for `:p` and `privacynotice` |
| `text.js` | padding, wrapping, dotted leaders |
| `crt.css` | phosphor, scanlines, jitter, flutter, power on/off |

Edit points: `PROFILE` in `vfs.js` is what `about.txt` says (the links under
it are the `sameAs` list in the page's JSON-LD — the Person on `index.html`,
its `author` on `lightweight-blocker.html` — so every page lists the same
profiles); one more entry in `entries`
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
  keystroke would be read out on every keystroke. Instead **focus follows the
  selection**: the selected link gets real focus, with its name as
  `aria-label` so the dotted leader is not read out. A redraw never takes
  focus off the exit button.
* **The console's focus lives in a hidden `<textarea>`** (`.crt__input`).
  Keystrokes are handled on `keydown` and never reach it, but two things only
  an editable element gets do: paste (**Safari will not paste into anything
  that is not editable**, so Cmd+V first moves focus there) and composition
  (dead keys, IME), which is handed to the shell on `compositionend`.
* **AltGr arrives as Ctrl+Alt on Windows.** `typedWithModifier()` in `crt.js`
  treats AltGr — and Option on a Mac — plus a printable key as text, and
  hands the views an event with the phantom Ctrl removed. Plain Alt+letter on
  Windows and Linux stays a browser shortcut (Alt+D, Alt+F).
* **The back/forward cache restores a page as it was left**, tube and all,
  without running `init()` again. A `pageshow` handler in `boot.js` brings a
  restored page in line with `sige.crt.left`: it closes the tube instantly
  (`close({ instant: true })`) or opens it. Playwright disables that cache
  by default, so a test of this needs Chrome with
  `ignoreDefaultArgs: ['--disable-back-forward-cache']`, or real Safari.
* **No stylesheet, no screen.** An unstyled screen still makes every sibling
  `inert` and locks scrolling, so `boot.js` rejects on a `crt.css` error
  instead of opening anyway.
* **`is-powering-on` is removed on the `crt-hold` `animationend`**, the last
  power-on animation to finish; otherwise its fill keeps a filter on the whole
  screen. Retiming the power-on means checking which animation ends last.
* **The host pages carry a Content-Security-Policy `<meta>`**: no `style=`
  attributes in markup strings and no inline handlers. Setting `element.style`
  from JS is fine — the CSP does not cover the CSSOM.
* **Every link in `.info-block` becomes a menu entry.** The host pages' privacy
  link lives in a `footer.site-foot` outside it for that reason: inside, it was
  entry 5, and it led to `privacy.html`, which has no terminal mode and no
  glyph to bring it back.
* **The privacy notice is `privacy.html` itself**, fetched on first use
  (`default-src 'self'` covers the fetch) and parsed with `DOMParser`.
  `notice.js` reads the children of `.legal`: `h1` plus `.subtitle` make the
  title, `h2` a heading, `ul` a list, `.updated` a dim note, `.back` is
  skipped, anything else is a paragraph. Inside them `strong` turns bright and
  `a[href]` stays a link. Restructuring that page changes what the terminal
  prints, so check `:p` after editing it.

## Verified

Boot, TUI, arrows, `q`, the shell commands, link navigation and exit on
Chrome 152 (Blink), Firefox 155 (Gecko) and WebKit 26.6 (Safari 26's engine)
at 800x520, 1024x768, 1280x720, 1366x768, 1440x900, 1536x864, 1600x900,
1920x1080, 2560x1440 and 3440x1440. Edge is Blink, covered by Chrome.
axe-core: no violations in either view on any engine. `prefers-reduced-motion`
drops jitter, flutter, roll and the power-on, and opens without the crawl.
Dim green is 4.8:1 on the tube, everything else well above.

Re-checked after the September 2026 audit fixes, at 1280x800 on Chromium 153,
Chrome 154, Firefox 155 and WebKit 26.6 (Playwright), and in real Safari 26.6.2
through `safaridriver`: Esc mid-crawl, the clickable ESC hint, focus following
the selection, the shell (completion, paste, AltGr, composition), `about.txt`,
a failed `crt.css`, and no CSP violations. Real Cmd+V paste works in all five.
axe-core still finds no violations in either view on Chromium, Firefox or WebKit.

After the privacy notice was added (September 2026), at 1280x800 and 800x520
on Chromium, Firefox and WebKit (Playwright): the menus without a Privacy
entry, `:p` by key and by click, scrolling by key and wheel, `Q back` and `:q`,
the `privacynotice` pager (keys, wheel, `(END)`, `q` and `Q quit`) with Tab
completion, `help`, `about.txt`, `site.sh`, Esc, and no errors in the console.
In real Safari 26.6.2 through `safaridriver`: boot, Esc, a link followed after
leaving (stays plain), reload and the glyph (both bring it back), and `:p` and
the pager with real keystrokes. Not re-run with axe-core.

Floor is roughly Chrome/Edge 86, Firefox 78, Safari 14 — ES modules,
`replaceChildren` (which has a fallback) and custom properties. Older
browsers never get the glyph, or degrade quietly.
