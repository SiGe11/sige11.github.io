/* Leaving terminal mode is not remembered — a reload brings it back. The
   only thing carried is whether the tube already warmed up in this tab, so a
   link followed inside the terminal does not replay the boot crawl.
   Wrapped: reading sessionStorage throws when site data is blocked. */

const SEEN = 'sige.crt.seen';

/** Has the tube already warmed up in this tab? */
export function bootedBefore() {
    try { return window.sessionStorage.getItem(SEEN) === '1'; } catch (_) { return false; }
}

export function markBooted() {
    try { window.sessionStorage.setItem(SEEN, '1'); } catch (_) { /* private mode */ }
}
