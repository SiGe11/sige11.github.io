/* ==========================================================================
   Terminal mode — entry point.

   This is the only file the site itself references. It decides whether the
   machine in front of us should be offered terminal mode at all, injects the
   trigger glyph, and lazy-loads the rest of the module on first use.

   No JavaScript  -> this file never runs, so no glyph is ever rendered.
   Touch / small   -> the glyph is not injected either.
   ========================================================================== */

const MODULE_BASE = new URL('.', import.meta.url);
const SESSION_KEY = 'sige.crt';
const MIN_WIDTH = 760;
const MIN_HEIGHT = 480;

/**
 * Terminal mode is keyboard-driven and assumes a roomy, precise pointer.
 * Anything phone-shaped or touch-first is deliberately left out.
 */
function isEligible() {
    if (typeof window.matchMedia !== 'function') return false;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
    if (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches) return false;
    if (/Mobi|Android|iPhone|iPad|iPod|Silk|Kindle/i.test(navigator.userAgent)) return false;
    if (window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT) return false;
    return true;
}

let stylesReady = null;

/**
 * The screen measures itself in character cells, so it must not be built
 * before crt.css has actually been applied — an unstyled measurement yields
 * the wrong column count and the frame comes up too narrow.
 */
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

    stylesReady = new Promise((resolve) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 3000);          // never leave the glyph unresponsive
    });
    document.head.appendChild(link);
    return stylesReady;
}

let pending = null;

function start(options) {
    if (!pending) pending = import(new URL('crt.js', MODULE_BASE).href);
    return Promise.all([pending, loadStyles()])
        .then(([mod]) => mod.open(options))
        .catch(() => { /* module failed to load: the plain site stays as it is */ });
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
    button.addEventListener('click', () => start({ instant: false }));
    document.body.appendChild(button);
    return button;
}

function init() {
    if (!isEligible()) {
        // Drop a flag left behind by a window that has since been resized or
        // handed to a touch device, so terminal mode cannot resume by surprise.
        try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
        return;
    }

    loadStyles();
    injectTrigger();

    // Terminal mode survives navigation between pages of the site, so that
    // following a link from inside the terminal does not drop you out of it.
    let resumed = false;
    try { resumed = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (_) { /* private mode */ }
    if (resumed) start({ instant: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
