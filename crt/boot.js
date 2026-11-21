/* Entry point — the only file the site references. Decides whether this
   machine gets terminal mode, injects the trigger glyph, lazy-loads the rest.

   Desktop: terminal mode is what the visitor gets. Leaving it lasts for the
   rest of the tab — links followed from the plain page stay plain — until the
   glyph switches it back on or the page is reloaded. No JS: this never runs.
   Touch or small: nothing is injected and no stylesheet is requested.

   Deliberately without imports: an import is a round trip before this file
   can run at all, and until it runs the plain page is what shows. */

const MODULE_BASE = new URL('.', import.meta.url);
const MIN_WIDTH = 760;
const MIN_HEIGHT = 480;

/* Everything crt.js pulls in, fetched side by side instead of one import
   after another. A new module under crt/ belongs on this list too. */
const MODULES = ['crt.js', 'text.js', 'vfs.js', 'pageview.js', 'shell.js', 'page.js', 'notice.js'];

/* What this tab remembers about terminal mode, in sessionStorage:

   - that the visitor left it. Honoured for the rest of the tab, so a link
     followed from the plain page lands on a plain page; switching it back
     on with the glyph clears it. A reload asks for the default again.
   - that the tube already warmed up, so a link followed inside the terminal
     does not replay the boot crawl.

   Kept here, not in the screen's own code, because the decision below has to
   be made before any of that is loaded; crt.js is handed `memory` to write
   the two notes with. Wrapped: sessionStorage throws when site data is
   blocked. Both keys are listed in /privacy.html. */
const SEEN = 'sige.crt.seen';
const LEFT = 'sige.crt.left';

function noted(key) {
    try { return window.sessionStorage.getItem(key) === '1'; } catch (_) { return false; }
}

function note(key, on) {
    try {
        if (on) window.sessionStorage.setItem(key, '1');
        else window.sessionStorage.removeItem(key);
    } catch (_) { /* private mode */ }
}

/** Has the tube already warmed up in this tab? */
const bootedBefore = () => noted(SEEN);

/** Did the visitor leave terminal mode earlier in this tab? */
const leftBefore = () => noted(LEFT);

/** What crt.js writes with: open() notes both, close() notes the leaving. */
const memory = {
    booted: () => note(SEEN, true),
    left: (left) => note(LEFT, left),
};

/** Keyboard-driven and pointer-hungry: phone-shaped or touch-first is out. */
function isEligible() {
    if (typeof window.matchMedia !== 'function') return false;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
    if (/Mobi|Android|iPhone|iPad|iPod|Silk|Kindle/i.test(navigator.userAgent)) return false;
    if (window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT) return false;
    return true;
}

/** The modules are a waterfall otherwise: crt.js, then what it imports,
    then what those import — a round trip each before the tube appears. */
function preloadModules() {
    for (const name of MODULES) {
        const link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = new URL(name, MODULE_BASE).href;
        document.head.appendChild(link);
    }
}

let stylesReady = null;

/** The screen measures itself in cells, so it must not be built before
    crt.css applies — an unstyled measure gives too few columns. Worse, an
    unstyled screen still makes the page inert and locks its scrolling, so
    without the stylesheet there is no terminal mode at all. */
function loadStyles() {
    if (stylesReady) return stylesReady;
    if (document.getElementById('crt-styles')) {
        stylesReady = Promise.resolve();
        return stylesReady;
    }

    const link = document.createElement('link');
    link.id = 'crt-styles';
    link.rel = 'stylesheet';
    link.href = new URL('crt.css', MODULE_BASE).href;

    stylesReady = new Promise((resolve, reject) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', () => {
            link.remove();
            stylesReady = null;             // the next attempt fetches again
            reject(new Error('crt.css did not load'));
        }, { once: true });
    });
    document.head.appendChild(link);
    return stylesReady;
}

let pending = null;

/** Resolves with the screen once it is up, or with nothing when a module
    or the stylesheet failed — the plain site then stays as it is. */
function start(options) {
    if (!pending) pending = import(new URL('crt.js', MODULE_BASE).href);
    return Promise.all([pending, loadStyles()])
        .then(([mod]) => mod.open({ ...options, memory }))
        .catch(() => { /* module or stylesheet failed */ });
}

/* The tube is the default view, but its stylesheet and modules are a round
   trip behind this file, and until they land the plain page would show: a
   flash of bright paper before a dark screen. So the moment the decision is
   made a black sheet goes over the page, and comes off once the tube is up.

   It also comes off if the tube never arrives — a failed request, or one
   that stalls past CURTAIN_MAX — so the plain site is never held hostage.
   Styled from script: the pages' CSP forbids style attributes in markup,
   not the CSSOM, and crt.css is exactly what has not loaded yet. */
const CURTAIN_COLOR = '#060a07';    // --crt-bg in crt.css
const CURTAIN_MAX = 3000;           // ms: give up and show the page
const CURTAIN_LINGER = 320;         // ms: outlasts the reduced-motion fade-in

let curtain = null;
let curtainTimer = 0;

function drawCurtain() {
    curtain = document.createElement('div');
    curtain.setAttribute('aria-hidden', 'true');
    const style = curtain.style;
    style.position = 'fixed';
    style.top = '0';
    style.right = '0';
    style.bottom = '0';
    style.left = '0';
    style.zIndex = '2147482000';    // over the page, under the screen
    style.background = CURTAIN_COLOR;
    document.body.appendChild(curtain);
    curtainTimer = setTimeout(liftCurtain, CURTAIN_MAX);
}

function liftCurtain() {
    clearTimeout(curtainTimer);
    if (curtain) curtain.remove();
    curtain = null;
}

/* A small CRT: screen, prompt chevron, blinking cursor, stand. */
const ICON = [
    '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false">',
    '<rect x="2" y="3" width="20" height="14" rx="2.5"/>',
    '<path d="M6.4 8.3 9.2 10.7 6.4 13.1"/>',
    '<path class="crt-trigger__cursor" d="M11.4 13.1 H15.8"/>',
    '<path d="M12 17 V20.4 M8.6 20.6 H15.4"/>',
    '</svg>',
].join('');

function injectTrigger() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crt-trigger';
    button.title = 'Terminal mode';
    button.setAttribute('aria-label', 'Switch to terminal mode');
    button.innerHTML = ICON;
    // Asking for it by hand earns the full power-on.
    button.addEventListener('click', () => start({ instant: false }));
    document.body.appendChild(button);
    return button;
}

/** A reload is the visitor asking for the page again, default and all. */
function isReload() {
    try {
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        if (nav) return nav.type === 'reload';
        return !!performance.navigation && performance.navigation.type === 1;   // Safari 14
    } catch (_) {
        return false;
    }
}

let eligible = false;

function init() {
    if (!isEligible()) return;
    eligible = true;

    // Left earlier in this tab, and this is a link followed from the plain
    // page (or Back to one): stay plain.
    const plain = leftBefore() && !isReload();

    // First, before a single request goes out: the page is about to be
    // replaced, so it should not be seen at all.
    if (!plain) drawCurtain();

    preloadModules();
    // The glyph is drawn by crt.css: no stylesheet, no glyph.
    loadStyles().then(injectTrigger, () => {});

    if (plain) return;

    // The crawl is worth watching once; after that, following a link inside
    // the terminal should just land in the terminal.
    start({ instant: bootedBefore() }).then((screen) => {
        if (screen) setTimeout(liftCurtain, CURTAIN_LINGER);
        else liftCurtain();
    });
}

/* The back/forward cache restores a page exactly as it was left, tube and
   all, without running init() again. Bring it in line with what the visitor
   chose since: left on another page, or switched back on there. */
window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !eligible) return;
    if (leftBefore()) {
        if (pending) pending.then((mod) => mod.close({ instant: true })).catch(() => {});
    } else {
        start({ instant: true });
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
