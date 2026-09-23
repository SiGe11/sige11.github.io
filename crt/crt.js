/* The screen: overlay, character grid, key routing, transitions. Knows
   nothing about the site's content — pageview.js, shell.js and vfs.js do,
   and this drives them through the `screen` interface at the bottom. */

import { segments, pad, setEllipsis } from './text.js';
import { buildVfs } from './vfs.js';
import { createPageView } from './pageview.js';
import { createShell } from './shell.js';
import { markBooted, markLeft } from './mode.js';

/* φωσφόρος — light-bearer. What a green screen is, literally. */
const SYSTEM = 'PhosphorOs';

/* Box drawing holds the grid together only while every glyph is one cell
   wide. If the rendering font disagrees, measure() falls back to ASCII. */
const GLYPHS_UNICODE = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ell: '…' };
const GLYPHS_ASCII   = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ell: '.' };
const GLYPH_SAMPLE = '┌┐└┘─│…';

/* Tube bulge. 0 disables it; above ~0.03 it reads as a trapezoid. */
const CURVE = 0.011;

/* Option is how a Mac types ~ | \ @ { } on most non-US layouts. */
const MAC = /Mac/i.test(navigator.platform || navigator.userAgent);

/* The command line's hidden field is what the browser pastes into and
   composes accented / IME text in; keystrokes themselves never reach it. */
const MARKUP = `
<button type="button" class="crt__exit">Leave terminal mode</button>
<p class="crt__intro" id="crt-intro">Terminal mode: the page drawn as a text
console. Arrow keys move between links, Enter opens one, q drops to a command
prompt, Escape leaves terminal mode and shows the standard page.</p>
<textarea class="crt__input" tabindex="-1" aria-label="Command line" rows="1"
          autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
<div class="crt__screen">
  <div class="crt__jitter">
    <div class="crt__hold">
      <div class="crt__glitch">
        <pre class="crt__buffer"></pre>
      </div>
    </div>
  </div>
  <div class="crt__roll" aria-hidden="true"></div>
  <div class="crt__scanlines" aria-hidden="true"></div>
  <div class="crt__noise" aria-hidden="true"></div>
  <div class="crt__vignette" aria-hidden="true"></div>
  <div class="crt__bezel" aria-hidden="true"></div>
  <div class="crt__glass" aria-hidden="true"></div>
  <div class="crt__flash" aria-hidden="true"></div>
</div>`;

/* The machine speaks Latin; the content it renders does not. */
const bootLines = () => [
    [{ t: SYSTEM, c: 'crt-bright' }, { t: '  v2.5' }],
    '',
    [{ t: 'Memoria ....... ', c: 'crt-dim' }, { t: '640K OK' }],
    [{ t: 'Lumen ......... ', c: 'crt-dim' }, { t: 'P31 viridis, 60 Hz' }],
    [{ t: 'Nexus ......... ', c: 'crt-dim' }, { t: location.hostname || 'sige25.dev' }],
    '',
    [{ t: 'Documentum legens', c: 'crt-dim' }, { t: ' ...' }],
];

let instance = null;

const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A character typed with AltGr (Windows reports it as Ctrl+Alt) or with
    Option on a Mac is text, not a shortcut. Plain Alt+letter on Windows and
    Linux stays a browser shortcut (Alt+D, Alt+F). */
function typedWithModifier(event) {
    if (event.key.length !== 1 || event.metaKey) return false;
    if (typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return true;
    return MAC && event.altKey && !event.ctrlKey;
}

/* Screen */
function createScreen() {
    const root = document.createElement('div');
    root.className = 'crt';
    root.tabIndex = -1;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Terminal mode');
    root.setAttribute('aria-describedby', 'crt-intro');
    root.innerHTML = MARKUP;

    const buffer = root.querySelector('.crt__buffer');
    const field = root.querySelector('.crt__input');

    let cols = 80;
    let rows = 24;
    let lineH = 20;
    let view = null;
    let closing = false;

    const siblings = [];

    function measure() {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
        buffer.appendChild(probe);

        // offsetWidth, not getBoundingClientRect: the latter reports the
        // transformed box, and the power-on animation scales this subtree,
        // so a mid-animation measure would inflate every cell. The long run
        // keeps integer rounding in the noise.
        const advance = (text, times) => {
            probe.textContent = text.repeat(times);
            return probe.offsetWidth / (text.length * times);
        };
        const charWidth = advance('M', 200) || 8;
        const boxWidth = advance(GLYPH_SAMPLE, 30);
        probe.remove();

        // Same advance width as the rest of the grid? Then the frame is safe.
        screen.glyphs = Math.abs(boxWidth - charWidth) < 0.25 ? GLYPHS_UNICODE : GLYPHS_ASCII;
        setEllipsis(screen.glyphs.ell);

        const style = getComputedStyle(buffer);
        const lineHeight = parseFloat(style.lineHeight) || 20;
        lineH = lineHeight;
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

        cols = Math.max(48, Math.floor((buffer.clientWidth - padX) / charWidth));
        rows = Math.max(14, Math.floor((buffer.clientHeight - padY) / lineHeight));
        screen.cols = cols;
        screen.rows = rows;
    }

    /** Move focus to `el` — unless the visitor put it on the exit button,
        which a redraw must not snatch away. */
    function claimFocus(el) {
        const active = document.activeElement;
        if (active && active !== el && active.classList && active.classList.contains('crt__exit')) return;
        el.focus({ preventScroll: true });
    }

    function render(lines) {
        const frag = document.createDocumentFragment();
        const limit = Math.min(lines.length, rows);
        let focusTarget = null;
        for (let i = 0; i < limit; i++) {
            const row = document.createElement('div');
            let used = 0;
            for (const seg of segments(lines[i])) {
                if (used >= cols) break;                      // never overflow the tube
                const text = used + String(seg.t).length > cols
                    ? String(seg.t).slice(0, cols - used)
                    : String(seg.t);
                used += text.length;

                const node = seg.href ? document.createElement('a')
                                      : document.createElement('span');
                if (seg.href) {
                    node.href = seg.href;
                    if (seg.external) {
                        node.target = '_blank';
                        node.rel = 'noopener noreferrer';
                    }
                }
                // A screen reader should hear the link's name, not its
                // dotted leader.
                if (seg.label) node.setAttribute('aria-label', seg.label);
                if (seg.action) node.dataset.action = seg.action;
                const classes = [seg.c, seg.action && 'crt-action'].filter(Boolean).join(' ');
                if (classes) node.className = classes;
                if (seg.index != null) node.dataset.index = String(seg.index);
                if (seg.focus) focusTarget = node;
                node.textContent = text;
                row.appendChild(node);
            }
            // Barrel distortion per row. Transforms, not a filter, so
            // hit-testing curves with the picture and links stay clickable
            // where they look.
            if (CURVE && limit > 2) {
                const mid = (limit - 1) / 2;
                const n = (i - mid) / mid;
                const scaleX = 1 - CURVE * n * n;
                const shift = -CURVE * 0.6 * n * Math.abs(n) * lineH;
                row.style.transform = `translateY(${shift.toFixed(2)}px) scaleX(${scaleX.toFixed(4)})`;
            }
            frag.appendChild(row);
        }
        if (buffer.replaceChildren) {
            buffer.replaceChildren(frag);
        } else {
            buffer.textContent = '';
            buffer.appendChild(frag);
        }

        // Real focus follows the selection, so assistive tech announces
        // it. A redraw that removed the focused link must not leave focus
        // stranded on <body> either.
        if (focusTarget) claimFocus(focusTarget);
        else if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    }

    function draw() {
        if (view) view.draw();
    }

    function setView(next) {
        if (view && view.leave) view.leave();
        view = next;
        // The stylesheet keys off this: the document view gets the block
        // mouse pointer, the console keeps an ordinary one.
        root.dataset.view = view.name || '';
        if (view.enter) view.enter();
        draw();
    }

    // input
    function focusField() {
        field.focus({ preventScroll: true });
    }

    function onKeyDown(event) {
        if (closing) return;
        // The exit control is a plain button: let the browser drive it.
        if (event.target && event.target.closest && event.target.closest('.crt__exit')) return;
        // Mid-composition (a dead key, an IME): the hidden field takes it.
        if (event.isComposing || event.keyCode === 229) return;

        // Paste lands wherever focus is when the keystroke finishes, and
        // Safari only pastes into something editable.
        const paste = (event.metaKey || event.ctrlKey) && (event.key === 'v' || event.key === 'V');
        if (paste && view && view.paste) focusField();

        const typed = typedWithModifier(event);
        if (!typed) {
            if (event.metaKey || event.altKey) return;       // leave browser shortcuts alone
            if (event.ctrlKey && !'lLcCuUaAeEkK'.includes(event.key)) return;
        }

        // What the views see: AltGr's phantom Ctrl taken off.
        const input = { key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey && !typed };
        if (view && view.key && view.key(input)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function onPaste(event) {
        if (closing || !view || !view.paste) return;
        event.preventDefault();
        const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
        if (text) view.paste(text);
    }

    /* Text composed in the hidden field (é from a dead key, IME input) is
       handed to the view once composition ends, then the field is emptied. */
    let composing = false;
    function flushField() {
        if (composing) return;
        const text = field.value;
        field.value = '';
        if (text && !closing && view && view.paste) view.paste(text);
    }

    function onPointerOver(event) {
        const target = event.target.closest('[data-index]');
        if (target && view && view.hover) view.hover(Number(target.dataset.index));
    }

    /* Clickable bits of text that are not links: the status line's ESC. */
    function onClick(event) {
        const target = event.target.closest('[data-action]');
        if (target && target.dataset.action === 'close') screen.close();
    }

    /* A click in the console lands focus on the screen; hand it back to
       the command line, unless it was the end of a selection to copy. */
    function onMouseUp() {
        if (!view || !view.paste) return;
        const selection = window.getSelection && window.getSelection();
        if (!selection || selection.isCollapsed) focusField();
    }

    function onWheel(event) {
        if (view && view.wheel) view.wheel(event);
    }

    /* A mouse left alone gets out of the way; movement brings it back. */
    let idleTimer = 0;
    function onMouseMove() {
        root.classList.remove('is-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => root.classList.add('is-idle'), 1600);
    }

    /* An effect that never pauses reads as mechanical, however subtle it is.
       These run in bursts of random length separated by random still spells,
       so the tube is restless in fits rather than on a beat. All times in ms.

       The animations themselves are untouched: only whether one is running
       at all. pulse(selector, burst, rest) — [min, max] ranges, or a
       function returning a duration. */
    const pulses = [];
    const between = (r) =>
        typeof r === 'function' ? r() : r[0] + Math.random() * (r[1] - r[0]);

    function pulse(selector, burst, rest) {
        const el = root.querySelector(selector);
        let timer = 0;

        function run() {
            el.classList.remove('is-live');
            void el.offsetWidth;                 // reflow, or the restart is ignored
            el.classList.add('is-live');
            timer = setTimeout(() => {
                el.classList.remove('is-live');
                timer = setTimeout(run, between(rest));
            }, between(burst));
        }

        pulses.push([run, () => {
            clearTimeout(timer);
            el.classList.remove('is-live');
        }]);
    }

    /* Restless rather more often than not, with real pauses in between. */
    pulse('.crt__jitter', [1600, 3600], [1100, 3200]);

    /* Brightness wanders on a slower clock of its own. */
    pulse('.crt__glass', [3200, 7000], [2000, 6000]);

    /* Vertical hold: one 7.5s pass, then a wait. 7.5-15s start to start,
       three passes in four landing between 9 and 12 — so the rest that
       follows a pass is what is left of that after the 7.5s of travel. */
    function rollGap() {
        const r = Math.random();
        if (r < 0.75) return 1500 + Math.random() * 3000;
        const tail = (r - 0.75) / 0.25 * 4500;   // the quarter outside, spread flat
        return tail < 1500 ? tail : 4500 + (tail - 1500);
    }

    pulse('.crt__roll', [7500, 7500], rollGap);

    let resizeTimer = 0;
    let observer = null;

    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const before = cols + 'x' + rows;
            measure();
            if (before !== cols + 'x' + rows) draw();
        }, 120);
    }

    /** Re-measure once the first frame is up: the layout may not have been
        final (late webfont, stylesheet landing a tick after the screen). */
    function settle() {
        const recheck = () => {
            const before = cols + 'x' + rows;
            measure();
            if (before !== cols + 'x' + rows) draw();
        };
        setTimeout(recheck, 50);
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(recheck);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(recheck).catch(() => {});
        }
    }

    /** Catches what `resize` misses: browser zoom, a late font, and a
        screen measured before layout (background tab), which would leave
        the grid stuck at its minimum. */
    function watchSize() {
        if (typeof ResizeObserver !== 'function') return;
        observer = new ResizeObserver(onResize);
        observer.observe(buffer);
    }

    // lifecycle
    function mount() {
        for (const node of Array.from(document.body.children)) {
            if (node === root) continue;
            siblings.push([node, node.hasAttribute('inert')]);
            node.setAttribute('inert', '');
        }
        document.body.appendChild(root);
        document.documentElement.style.overflow = 'hidden';

        root.querySelector('.crt__exit')
            .addEventListener('click', () => screen.close());
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('paste', onPaste, true);
        field.addEventListener('compositionstart', () => { composing = true; });
        field.addEventListener('compositionend', () => { composing = false; flushField(); });
        field.addEventListener('input', flushField);
        buffer.addEventListener('mouseover', onPointerOver);
        buffer.addEventListener('click', onClick);
        root.addEventListener('mouseup', onMouseUp);
        root.addEventListener('mousemove', onMouseMove);
        root.addEventListener('wheel', onWheel, { passive: true });
        window.addEventListener('resize', onResize);
        onMouseMove();                       // start the idle countdown
        // Every one of these is stripped out when motion is off.
        if (!reducedMotion()) for (const [start] of pulses) start();

        measure();
        watchSize();
        root.focus({ preventScroll: true });
    }

    function unmount() {
        // A view may still have a timer running (the boot crawl).
        if (view && view.leave) view.leave();
        view = null;

        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('paste', onPaste, true);
        buffer.removeEventListener('mouseover', onPointerOver);
        buffer.removeEventListener('click', onClick);
        root.removeEventListener('mouseup', onMouseUp);
        root.removeEventListener('mousemove', onMouseMove);
        root.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
        clearTimeout(idleTimer);
        for (const [, stop] of pulses) stop();
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(resizeTimer);

        root.remove();
        document.documentElement.style.overflow = '';
        for (const [node, wasInert] of siblings) {
            if (!wasInert) node.removeAttribute('inert');
        }
        siblings.length = 0;
    }

    // public interface
    const screen = {
        cols,
        rows,
        root,
        vfs: null,
        glyphs: GLYPHS_UNICODE,
        system: SYSTEM,
        render,
        redraw: draw,
        setView,
        focusField,

        /** Fill a line to the full width of the screen. */
        pad: (line) => pad(line, screen.cols),

        /** Follow a link the way the normal site would. */
        navigate(href, options = {}) {
            // A file that navigates after a short beat (swarm.exe) must not
            // drag the visitor along if they hit Escape in the meantime.
            if (closing) return;
            if (options.external) {
                window.open(href, '_blank', 'noopener,noreferrer');
                return;
            }
            window.location.href = href;   // the default carries it across
        },

        /** Power the tube back down and hand the visitor the normal site.
            `instant` skips the power-off, for a page restored from the
            back/forward cache after the visitor left terminal mode elsewhere. */
        close(options = {}) {
            if (closing) return;
            closing = true;
            // Honoured for the rest of the tab: links followed from the
            // plain page stay plain (boot.js reads it).
            markLeft(true);

            const finish = () => {
                unmount();
                instance = null;
                const trigger = document.querySelector('.crt-trigger');
                if (trigger) trigger.focus({ preventScroll: true });
            };

            if (options.instant) {
                finish();
            } else if (reducedMotion()) {
                root.classList.remove('is-on');
                setTimeout(finish, 220);
            } else {
                root.classList.add('is-powering-off');
                setTimeout(finish, 540);
            }
        },

        showPage() {
            setView(createPageView(screen));
        },

        showShell(options) {
            setView(createShell(screen, options));
        },
    };

    screen.cols = cols;
    screen.rows = rows;
    screen.mount = mount;
    screen.settle = settle;
    return screen;
}

/* Boot sequence — a short power-on crawl, skippable with any key. */
function createBootView(screen, done) {
    const lines = bootLines();
    let shown = 0;
    let timer = 0;

    function step() {
        shown += 1;
        screen.redraw();
        if (shown >= lines.length) {
            timer = setTimeout(finish, 620);
        } else {
            // The header lands first, then the checks tick past.
            timer = setTimeout(step, shown <= 1 ? 300 : 165);
        }
    }

    function finish() {
        clearTimeout(timer);
        timer = 0;
        done();
    }

    return {
        name: 'boot',
        enter() { timer = setTimeout(step, 900); },   // let the tube warm up first
        leave() { clearTimeout(timer); },
        draw() {
            screen.render(lines.slice(0, shown).map((l) => screen.pad(l)));
        },
        key(input) {
            // Escape leaves, as it does everywhere else; any other key skips.
            if (input.key === 'Escape') screen.close();
            else finish();
            return true;
        },
    };
}

/** Leave terminal mode from outside — see the pageshow handler in boot.js. */
export function close(options) {
    if (instance) instance.close(options);
}

/* Entry point */
export function open(options = {}) {
    if (instance) return instance;

    const screen = createScreen();
    instance = screen;
    screen.vfs = buildVfs(screen);
    screen.mount();

    const instant = options.instant === true || reducedMotion();
    markBooted();
    markLeft(false);                   // switched on again: links stay in it

    // Flush layout so the animation starts at its first keyframe. Not rAF:
    // it never fires in a hidden tab, leaving the screen mounted and invisible.
    void screen.root.offsetWidth;
    screen.root.classList.add('is-on');
    if (!instant) {
        screen.root.classList.add('is-powering-on');
        // The vertical hold is the last of the power-on animations to
        // settle. Drop the class then, or the fill leaves a filter on the
        // whole screen for as long as it is open.
        screen.root.addEventListener('animationend', function settled(event) {
            if (event.animationName !== 'crt-hold') return;
            screen.root.classList.remove('is-powering-on');
            screen.root.removeEventListener('animationend', settled);
        });
    }

    if (instant) screen.showPage();
    else screen.setView(createBootView(screen, () => screen.showPage()));

    screen.settle();

    return screen;
}
