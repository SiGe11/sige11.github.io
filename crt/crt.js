/* ==========================================================================
   Terminal mode — the screen itself.

   Owns the overlay, the character grid, the key routing and the transitions.
   It knows nothing about the site's content: that lives in pageview.js,
   shell.js and vfs.js, which it drives through a small `screen` interface.
   ========================================================================== */

import { segments, pad, setEllipsis } from './text.js';
import { buildVfs } from './vfs.js';
import { createPageView } from './pageview.js';
import { createShell } from './shell.js';

const SESSION_KEY = 'sige.crt';

/* φωσφόρος — light-bearer. What a green screen is, literally. */
const SYSTEM = 'PhosphorOs';

/* Box drawing keeps the grid honest only while every glyph occupies exactly
   one cell. Menlo, Consolas and DejaVu Sans Mono all do; if the visitor's
   monospace font falls back to something that does not, we drop to ASCII
   rather than let the frame come apart. */
const GLYPHS_UNICODE = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ell: '…' };
const GLYPHS_ASCII   = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ell: '.' };
const GLYPH_SAMPLE = '┌┐└┘─│…';

/* How much the tube bulges. 0 disables it entirely; much above 0.03 and the
   frame starts reading as a trapezoid rather than curved glass. */
const CURVE = 0.011;

const MARKUP = `
<div class="crt__screen">
  <div class="crt__jitter">
    <div class="crt__hold">
      <div class="crt__glitch">
        <pre class="crt__buffer" aria-live="polite"></pre>
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

function setSession(on) {
    try {
        if (on) sessionStorage.setItem(SESSION_KEY, '1');
        else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private mode: mode simply will not survive navigation */ }
}

/* -------------------------------------------------------------------------
   Screen
   ------------------------------------------------------------------------- */
function createScreen() {
    const root = document.createElement('div');
    root.className = 'crt';
    root.tabIndex = -1;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Terminal mode');
    root.innerHTML = MARKUP;

    const buffer = root.querySelector('.crt__buffer');

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
        // *transformed* box, and the power-on animation scales this subtree
        // horizontally — measuring mid-animation would inflate every cell.
        // A long run keeps the integer rounding down in the noise.
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

    function render(lines) {
        const frag = document.createDocumentFragment();
        const limit = Math.min(lines.length, rows);
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
                if (seg.c) node.className = seg.c;
                if (seg.index != null) node.dataset.index = String(seg.index);
                node.textContent = text;
                row.appendChild(node);
            }
            // Barrel distortion, one row at a time: rows away from the middle
            // sit narrower and closer in, the way a curved tube presents them.
            // Done with transforms rather than a filter so hit-testing curves
            // with the picture and the links stay exactly where they look.
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
    }

    function draw() {
        if (view) view.draw();
    }

    function setView(next) {
        if (view && view.leave) view.leave();
        view = next;
        if (view.enter) view.enter();
        draw();
    }

    /* --- input ---------------------------------------------------------- */
    function onKeyDown(event) {
        if (closing) return;
        if (event.metaKey || event.altKey) return;           // leave browser shortcuts alone
        if (event.ctrlKey && !'lLcCuUaAeEkK'.includes(event.key)) return;

        if (view && view.key && view.key(event)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function onPointerOver(event) {
        const target = event.target.closest('[data-index]');
        if (target && view && view.hover) view.hover(Number(target.dataset.index));
    }

    function onWheel(event) {
        if (view && view.wheel) view.wheel(event);
    }

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

    /**
     * One more look once the first frame is on screen. Cheap insurance
     * against measuring a layout that was not quite final — a late webfont,
     * or a stylesheet that landed a tick after the screen was built.
     */
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

    /**
     * Watching the buffer itself catches everything the window resize event
     * misses: browser zoom, a font that arrives late, and the case where the
     * screen is measured before it has been laid out (a background tab), which
     * would otherwise leave the grid stuck at its minimum size.
     */
    function watchSize() {
        if (typeof ResizeObserver !== 'function') return;
        observer = new ResizeObserver(onResize);
        observer.observe(buffer);
    }

    /* --- lifecycle ------------------------------------------------------ */
    function mount() {
        for (const node of Array.from(document.body.children)) {
            if (node === root) continue;
            siblings.push([node, node.hasAttribute('inert')]);
            node.setAttribute('inert', '');
        }
        document.body.appendChild(root);
        document.documentElement.style.overflow = 'hidden';

        document.addEventListener('keydown', onKeyDown, true);
        buffer.addEventListener('mouseover', onPointerOver);
        root.addEventListener('wheel', onWheel, { passive: true });
        window.addEventListener('resize', onResize);

        measure();
        watchSize();
        root.focus({ preventScroll: true });
    }

    function unmount() {
        document.removeEventListener('keydown', onKeyDown, true);
        buffer.removeEventListener('mouseover', onPointerOver);
        root.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(resizeTimer);

        root.remove();
        document.documentElement.style.overflow = '';
        for (const [node, wasInert] of siblings) {
            if (!wasInert) node.removeAttribute('inert');
        }
        siblings.length = 0;
    }

    /* --- public interface ----------------------------------------------- */
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
            // Terminal mode is carried across same-site navigation unless the
            // destination is a page that does not load this module.
            setSession(options.keepMode !== false);
            window.location.href = href;
        },

        /** Power the tube back down and hand the visitor the normal site. */
        close() {
            if (closing) return;
            closing = true;
            setSession(false);

            const finish = () => {
                unmount();
                instance = null;
                const trigger = document.querySelector('.crt-trigger');
                if (trigger) trigger.focus({ preventScroll: true });
            };

            if (reducedMotion()) {
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

/* -------------------------------------------------------------------------
   Boot sequence — a short power-on crawl, skippable with any key.
   ------------------------------------------------------------------------- */
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
        enter() { timer = setTimeout(step, 900); },   // let the tube warm up first
        leave() { clearTimeout(timer); },
        draw() {
            screen.render(lines.slice(0, shown).map((l) => screen.pad(l)));
        },
        key() { finish(); return true; },
    };
}

/* -------------------------------------------------------------------------
   Entry point
   ------------------------------------------------------------------------- */
export function open(options = {}) {
    if (instance) return instance;

    const screen = createScreen();
    instance = screen;
    screen.vfs = buildVfs(screen);
    screen.mount();
    setSession(true);

    const instant = options.instant === true || reducedMotion();

    // Flush layout so the power-on animation starts from its first keyframe.
    // (rAF would be tidier, but it never fires while the tab is hidden, which
    // would leave the screen mounted and invisible.)
    void screen.root.offsetWidth;
    screen.root.classList.add('is-on');
    if (!instant) screen.root.classList.add('is-powering-on');

    if (instant) screen.showPage();
    else screen.setView(createBootView(screen, () => screen.showPage()));

    screen.settle();

    return screen;
}
