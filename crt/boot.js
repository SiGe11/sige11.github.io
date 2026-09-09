/* Entry point — the only file the site references. Decides whether this
   machine gets terminal mode, injects the trigger glyph, lazy-loads the rest.

   Desktop: terminal mode is what the visitor gets. Leaving it lasts until
   the next page load. No JS: this never runs. Touch or small: nothing is
   injected and no stylesheet is requested. */

import { bootedBefore } from './mode.js';

const MODULE_BASE = new URL('.', import.meta.url);
const MIN_WIDTH = 760;
const MIN_HEIGHT = 480;

/** Keyboard-driven and pointer-hungry: phone-shaped or touch-first is out. */
function isEligible() {
    if (typeof window.matchMedia !== 'function') return false;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
    if (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches) return false;
    if (/Mobi|Android|iPhone|iPad|iPod|Silk|Kindle/i.test(navigator.userAgent)) return false;
    if (window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT) return false;
    return true;
}

let stylesReady = null;

/** The screen measures itself in cells, so it must not be built before
    crt.css applies — an unstyled measure gives too few columns. */
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
    // Asking for it by hand earns the full power-on.
    button.addEventListener('click', () => start({ instant: false }));
    document.body.appendChild(button);
    return button;
}

function init() {
    if (!isEligible()) return;

    loadStyles();
    injectTrigger();

    // The crawl is worth watching once; after that, following a link inside
    // the terminal should just land in the terminal.
    start({ instant: bootedBefore() });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
