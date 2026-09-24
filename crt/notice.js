/* The privacy notice, read from /privacy.html itself — like page.js, so the
   terminal can never say something the page does not. The console's
   `privacynotice` shows it in a less-style pager, `:p` in the document view
   inside the page's frame.

   Fetched on first use and kept for the life of the page: terminal mode
   costs nothing extra until someone asks. */

export const NOTICE_PATH = '/privacy.html';

let pending = null;

/** The notice as blocks, `{ kind, segs }` or `{ kind: 'list', items }`.
    Rejects when the page cannot be read; the next call tries again. */
export function loadNotice() {
    if (!pending) {
        const url = new URL(NOTICE_PATH, location.href);
        pending = fetch(url.href)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then((html) => readBlocks(new DOMParser().parseFromString(html, 'text/html'), url))
            .catch((error) => {
                pending = null;
                throw error;
            });
    }
    return pending;
}

/** Inline content as segments: bold turns bright, links stay links. */
function inline(node, base, style = {}) {
    const out = [];
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            out.push({ ...style, t: child.nodeValue });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            let next = style;
            if (child.tagName === 'A' && child.getAttribute('href')) {
                const url = new URL(child.getAttribute('href'), base);
                next = { ...style, c: 'crt-link', href: url.href, external: url.origin !== location.origin };
            } else if (child.tagName === 'STRONG' || child.tagName === 'B') {
                next = { ...style, c: 'crt-bright' };
            }
            out.push(...inline(child, base, next));
        }
    }
    return out;
}

/** The notice is the page's `.legal` block, minus its way home. */
function readBlocks(doc, base) {
    const root = doc.querySelector('.legal');
    if (!root) throw new Error('no .legal block');

    const blocks = [];
    for (const el of Array.from(root.children)) {
        if (el.classList.contains('back')) continue;
        const segs = () => inline(el, base);

        if (el.tagName === 'H1') {
            blocks.push({ kind: 'title', segs: segs() });
        } else if (el.classList.contains('subtitle') && blocks.length && blocks[blocks.length - 1].kind === 'title') {
            // "Privacy" + "and licences" read as one title on a terminal.
            blocks[blocks.length - 1].segs.push({ t: ' ' }, ...segs());
        } else if (el.tagName === 'H2') {
            blocks.push({ kind: 'heading', segs: segs() });
        } else if (el.tagName === 'UL' || el.tagName === 'OL') {
            blocks.push({ kind: 'list', items: Array.from(el.children).map((li) => inline(li, base)) });
        } else if (el.classList.contains('updated')) {
            blocks.push({ kind: 'note', segs: segs() });
        } else {
            blocks.push({ kind: 'para', segs: segs() });
        }
    }
    return blocks;
}

/** Greedy word wrap over segments, so a bold run or a link keeps its
    styling across a line break. The space before a word takes the style
    it had in the page: a link's inner spaces stay part of the link. */
function flow(segs, width, first = '', rest = first) {
    const words = [];
    let word = null;
    let gap = null;
    for (const seg of segs) {
        for (const part of String(seg.t).split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s/.test(part)) { word = null; gap = seg; continue; }
            if (!word) {
                word = { gap: { ...gap, t: ' ' }, pieces: [], size: 0 };
                words.push(word);
            }
            word.pieces.push({ ...seg, t: part });
            word.size += part.length;
        }
    }

    const lines = [];
    let lead = first;
    let line = [];
    let used = 0;
    for (const w of words) {
        if (used && used + 1 + w.size > width - lead.length) {
            lines.push(merge(lead, line));
            lead = rest;
            line = [];
            used = 0;
        }
        if (used) { line.push(w.gap); used += 1; }
        line.push(...w.pieces);
        used += w.size;
    }
    if (line.length || !lines.length) lines.push(merge(lead, line));
    return lines;
}

/** One segment per run of identical styling, so a link is one <a>. */
function merge(lead, pieces) {
    const out = lead ? [{ t: lead }] : [];
    for (const piece of pieces) {
        const last = out[out.length - 1];
        if (last && last.c === piece.c && last.href === piece.href) last.t += piece.t;
        else out.push({ ...piece });
    }
    return out;
}

/** less's movement keys, as a scroll delta in lines (±Infinity: the top or
    the end), or null for any other key. Both views that page the notice use
    it, so they scroll alike. */
export function pagerDelta(event, page) {
    switch (event.key) {
        case 'ArrowDown': case 'j': case 'e': case 'Enter':
            return 1;
        case 'ArrowUp': case 'k': case 'y':
            return -1;
        case ' ':
            return event.shiftKey ? -page : page;
        case 'PageDown': case 'f': case 'z':
            return page;
        case 'PageUp': case 'b': case 'w':
            return -page;
        case 'd':
            return Math.ceil(page / 2);
        case 'u':
            return -Math.ceil(page / 2);
        case 'Home': case 'g': case '<':
            return -Infinity;
        case 'End': case 'G': case '>':
            return Infinity;
        default:
            return null;
    }
}

const restyle = (segs, c) => segs.map((s) => ({ t: String(s.t).toUpperCase(), c }));

/** The notice laid out `width` cells wide: lines of segments, no indent. */
export function noticeLines(blocks, width) {
    const lines = [];
    for (const block of blocks) {
        if (block.kind === 'title') {
            lines.push(...flow(restyle(block.segs, 'crt-bright'), width), '');
        } else if (block.kind === 'heading') {
            lines.push(...flow(restyle(block.segs, 'crt-dim'), width));
        } else if (block.kind === 'list') {
            for (const item of block.items) lines.push(...flow(item, width, '- ', '  '));
            lines.push('');
        } else if (block.kind === 'note') {
            lines.push(...flow(block.segs.map((s) => ({ ...s, c: s.c || 'crt-dim' })), width), '');
        } else {
            lines.push(...flow(block.segs, width), '');
        }
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
}
