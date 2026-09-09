/* ==========================================================================
   Terminal mode — text/line helpers.

   A "line" is an array of segments. A segment is either a plain string or
   an object:

       { t: 'text', c: 'crt-dim', href: '...', external: true, id: 'link-2' }

   The renderer in crt.js turns segments into <span>/<a> nodes; everything
   else in the module only ever builds these small plain objects.
   ========================================================================== */

/** Normalise a line into an array of segment objects. */
export function segments(line) {
    if (line == null) return [];
    const list = Array.isArray(line) ? line : [line];
    return list
        .filter((s) => s != null)
        .map((s) => (typeof s === 'string' ? { t: s } : s));
}

/** Printable width of a line, in character cells. */
export function width(line) {
    return segments(line).reduce((n, s) => n + String(s.t).length, 0);
}

/** Pad a line out to `cols` cells with spaces. */
export function pad(line, cols) {
    const segs = segments(line);
    const gap = cols - width(segs);
    return gap > 0 ? segs.concat([{ t: ' '.repeat(gap) }]) : segs;
}

/* The cut marker. crt.js swaps it for '.' when the rendering font turns out
   not to carry '…' at the same advance width as the rest of the grid. */
let ellipsis = '…';

/** Choose the character used to mark a truncated string. */
export function setEllipsis(ch) {
    ellipsis = ch;
}

/** Truncate a plain string, marking the cut. */
export function clip(str, max) {
    const s = String(str);
    if (max <= 1) return s.slice(0, Math.max(0, max));
    return s.length <= max ? s : s.slice(0, max - 1) + ellipsis;
}

/** Greedy word wrap. Returns an array of plain strings. */
export function wrap(str, max) {
    const out = [];
    for (const paragraph of String(str).split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            if (!line.length) {
                line = word;
            } else if (line.length + 1 + word.length <= max) {
                line += ' ' + word;
            } else {
                out.push(line);
                line = word;
            }
        }
        out.push(line);
    }
    return out;
}

/** `LABEL .......... value` — the classic dotted leader. */
export function leader(label, value, cols, dotClass = 'crt-dim') {
    const room = cols - label.length - value.length - 2;
    if (room < 1) return [{ t: label }, { t: ' ' }, { t: clip(value, Math.max(1, cols - label.length - 1)) }];
    return [
        { t: label },
        { t: ' ' + '.'.repeat(room) + ' ', c: dotClass },
        { t: value },
    ];
}

/** Centre a plain string inside `cols` cells. */
export function center(str, cols) {
    const s = clip(str, cols);
    const left = Math.max(0, Math.floor((cols - s.length) / 2));
    return ' '.repeat(left) + s;
}

/** A horizontal rule made of `ch`. */
export function rule(cols, ch = '─') {
    return ch.repeat(Math.max(0, cols));
}

/** Uppercase a string with a space between every letter: S I G E */
export function spaced(str) {
    return String(str).toUpperCase().split('').join(' ');
}
