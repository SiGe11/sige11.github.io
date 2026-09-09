/* The site drawn as a TUI. Reads the document (page.js), paints it in a
   box-drawing frame. Links stay real <a>, so click, middle-click and "copy
   link address" behave as on the normal page; arrows drive the same list.

   Layout adapts to the tube: links are laid out first and the header keeps
   what rows are left, dropping its lowest-ranked blocks on a short screen;
   the link column is capped on a wide one.

   `q` drops to the shell; `:` still opens a vi-style command line. */

import { wrap, clip, spaced, leader, width } from './text.js';
import { readPage, prettyUrl } from './page.js';

const HINT_WIDE = 'ARROWS select   ENTER open   1-9 jump   Q exit   ESC escape';
const HINT_NARROW = 'ARROWS  ENTER open  Q exit  ESC escape';
const LIST_MAX = 100;   // columns; beyond this the leaders just get silly

/** The page's links, with a `..` entry first when this is not the site
    root — otherwise a sub-page is a one-way trip. */
function buildItems(page) {
    const root = new URL('/', location.href).href;
    // Paths only: a query string or #fragment must not make the home page
    // look like a sub-page and add a `..` back to itself.
    const here = new URL(location.pathname.replace(/index\.html?$/, ''), location.href).href;
    const items = [];

    if (here !== root) {
        items.push({
            label: 'Back to ' + prettyUrl(root),
            href: root,
            external: false,
            marker: '..',
        });
    }
    page.links.forEach((link, i) => items.push({ ...link, marker: String(i + 1) }));
    return items;
}

export function createPageView(screen) {
    const page = readPage();
    const items = buildItems(page);
    const canGoBack = items.length > 0 && items[0].marker === '..';

    let selected = 0;
    let command = null;   // null = no command line, string = what has been typed
    let message = null;   // transient error / feedback under the frame

    // helpers
    const inner = () => screen.cols - 2;
    const glyph = () => screen.glyphs;
    const flatten = (segs) => segs.map((s) => s.t).join('');

    /** Wrap a content line in the frame's left and right edges. */
    function framed(content = []) {
        const segs = Array.isArray(content) ? content : [content];
        const gap = inner() - width(segs);
        return [
            { t: glyph().v, c: 'crt-dim' },
            ...segs,
            ...(gap > 0 ? [{ t: ' '.repeat(gap) }] : []),
            { t: glyph().v, c: 'crt-dim' },
        ];
    }

    function titleBar() {
        const g = glyph();
        const label = `[ ${clip(prettyUrl(location.href), Math.max(8, screen.cols - 12))} ]`;
        const tail = Math.max(0, screen.cols - label.length - 3);
        return [{ t: `${g.tl}${g.h}${label}${g.h.repeat(tail)}${g.tr}`, c: 'crt-dim' }];
    }

    function bottomBar() {
        const g = glyph();
        return [{ t: `${g.bl}${g.h.repeat(inner())}${g.br}`, c: 'crt-dim' }];
    }

    /** One menu row: number, marker, label, dotted leader, target. */
    function itemLine(item, index, listWidth) {
        const prefix = ` ${item.marker.padStart(2)} > `;
        const room = Math.max(12, listWidth - prefix.length);
        const label = clip(item.label, Math.max(8, Math.floor(room * 0.42)));
        // Leave the dotted leader room to exist, however long the URL is.
        const target = clip(prettyUrl(item.href), Math.max(12, Math.floor(room * 0.5)));
        const body = prefix + flatten(leader(label, target, room));

        return framed([
            { t: '  ' },
            {
                t: clip(body, listWidth).padEnd(listWidth, ' '),
                c: index === selected ? 'crt-sel' : '',
                href: item.href,
                external: item.external,
                index,
            },
        ]);
    }

    /** The slice to show, kept around the selection so more links than
        rows still scrolls sensibly. */
    function itemWindow(max) {
        if (items.length <= max) return { start: 0, list: items };
        const start = Math.min(
            Math.max(0, selected - Math.floor(max / 2)),
            items.length - max,
        );
        return { start, list: items.slice(start, start + max) };
    }

    /** Header blocks in display order; `rank` is how readily each may be
        dropped on a short screen (0 = never). */
    function headerBlocks(indent) {
        const blocks = [
            { rank: 3, lines: [[]] },
            { rank: 0, lines: [[{ t: indent }, { t: spaced(page.title), c: 'crt-bright' }]] },
        ];
        if (page.subtitle) {
            blocks.push({ rank: 2, lines: [[{ t: indent }, { t: page.subtitle }]] });
        }
        blocks.push({
            rank: 4,
            lines: [[{ t: indent }, { t: glyph().h.repeat(Math.min(inner() - 6, 34)), c: 'crt-dim' }]],
        });
        if (page.description) {
            const body = wrap(page.description, Math.max(24, Math.min(inner() - 8, 66)))
                .map((row) => [{ t: indent }, { t: row, c: 'crt-dim' }]);
            blocks.push({ rank: 5, lines: [[], ...body] });
        }
        blocks.push({ rank: 1, lines: [[], []] });
        return blocks.map((block, order) => ({ ...block, order }));
    }

    // drawing
    function draw() {
        const contentRows = Math.max(4, screen.rows - 3);   // title, bottom, status
        const listWidth = Math.max(24, Math.min(inner() - 4, LIST_MAX));

        // The links come first — they are what the page is for.
        const view = itemWindow(Math.max(1, contentRows - 1));
        let room = contentRows - view.list.length;

        // Then as much of the header as still fits, most important kept first.
        const kept = [];
        for (const block of headerBlocks('   ').sort((a, b) => a.rank - b.rank)) {
            if (block.lines.length > room) continue;
            kept.push(block);
            room -= block.lines.length;
        }
        kept.sort((a, b) => a.order - b.order);

        const rows = [];
        for (const block of kept) for (const line of block.lines) rows.push(framed(line));
        view.list.forEach((item, i) => rows.push(itemLine(item, view.start + i, listWidth)));
        while (rows.length < contentRows) rows.push(framed());

        const lines = [
            titleBar(),
            ...rows.slice(0, contentRows),
            bottomBar(),
            statusLine(view),
        ];
        screen.render(lines.map((l) => screen.pad(l)));
    }

    function statusLine(view) {
        if (command !== null) {
            return [{ t: ':' + command }, { t: ' ', c: 'crt-cursor' }];
        }
        if (message) {
            return [{ t: ' ' + clip(message, screen.cols - 2), c: 'crt-warn' }];
        }

        const base = screen.cols >= 72 ? HINT_WIDE : HINT_NARROW;
        const hint = canGoBack ? base.replace('ENTER open', 'ENTER open   BKSP back') : base;
        const line = [{ t: ' ' + clip(hint, screen.cols - 2), c: 'crt-dim' }];
        // Say where we are only when the list does not all fit on screen.
        if (view && view.list.length < items.length) {
            const count = ` ${selected + 1}/${items.length} `;
            const gap = screen.cols - width(line) - count.length;
            if (gap > 2) line.push({ t: ' '.repeat(gap) }, { t: count, c: 'crt-dim' });
        }
        return line;
    }

    // behaviour
    function move(delta) {
        if (!items.length) return;
        selected = (selected + delta + items.length) % items.length;
        message = null;
        draw();
    }

    function activate(index = selected) {
        const item = items[index];
        if (!item) return;
        screen.navigate(item.href, { external: item.external });
    }

    function runCommand(raw) {
        const cmd = raw.trim();
        command = null;

        if (cmd === 'q' || cmd === 'q!' || cmd === 'quit' || cmd === 'wq' || cmd === 'x') {
            screen.showShell();
            return;
        }
        if (cmd === 'exit' || cmd === 'qa' || cmd === 'qa!') {
            screen.close();
            return;
        }
        if (cmd === 'h' || cmd === 'help') {
            message = 'Arrow keys move, ENTER opens, q drops to the console.';
        } else if (cmd === '') {
            message = null;
        } else {
            message = `E492: Not an editor command: ${clip(cmd, 30)}`;
        }
        draw();
    }

    function key(event) {
        const k = event.key;
        if (event.ctrlKey) return false;   // leave Ctrl+C and friends to the browser

        // vi-style command line has priority while it is open.
        if (command !== null) {
            if (k === 'Enter')      { runCommand(command); return true; }
            if (k === 'Escape')     { command = null; draw(); return true; }
            if (k === 'Backspace')  {
                if (command.length === 0) command = null;
                else command = command.slice(0, -1);
                draw();
                return true;
            }
            if (k.length === 1)     { command += k; draw(); return true; }
            return true;
        }

        switch (k) {
            case 'ArrowDown': case 'ArrowRight': case 'j':
                move(1); return true;
            case 'ArrowUp': case 'ArrowLeft': case 'k':
                move(-1); return true;
            case 'Tab':
                move(event.shiftKey ? -1 : 1); return true;
            case 'Home': case 'g':
                selected = 0; draw(); return true;
            case 'End': case 'G':
                selected = Math.max(0, items.length - 1); draw(); return true;
            case 'Enter': case ' ':
                activate(); return true;
            case 'q': case 'Q':
                screen.showShell(); return true;
            case ':':
                command = ''; message = null; draw(); return true;
            case 'Backspace':
                if (canGoBack) activate(0);
                return true;
            case 'Escape':
                screen.close(); return true;
            default:
                break;
        }

        if (/^[1-9]$/.test(k)) {
            const index = items.findIndex((item) => item.marker === k);
            if (index >= 0) { selected = index; draw(); activate(index); }
            return true;
        }
        return false;
    }

    return {
        name: 'page',
        draw,
        key,
        hover(index) {
            if (index !== selected) { selected = index; message = null; draw(); }
        },
    };
}
