/* What this tab remembers about terminal mode, in sessionStorage:

   - that the visitor left it. Honoured for the rest of the tab, so a link
     followed from the plain page lands on a plain page; switching it back
     on with the glyph clears it. A reload asks for the default again.
   - that the tube already warmed up, so a link followed inside the terminal
     does not replay the boot crawl.

   Wrapped: reading sessionStorage throws when site data is blocked. */

const SEEN = 'sige.crt.seen';
const LEFT = 'sige.crt.left';

/** Has the tube already warmed up in this tab? */
export function bootedBefore() {
    try { return window.sessionStorage.getItem(SEEN) === '1'; } catch (_) { return false; }
}

export function markBooted() {
    try { window.sessionStorage.setItem(SEEN, '1'); } catch (_) { /* private mode */ }
}

/** Did the visitor leave terminal mode earlier in this tab? */
export function leftBefore() {
    try { return window.sessionStorage.getItem(LEFT) === '1'; } catch (_) { return false; }
}

export function markLeft(left) {
    try {
        if (left) window.sessionStorage.setItem(LEFT, '1');
        else window.sessionStorage.removeItem(LEFT);
    } catch (_) { /* private mode */ }
}
