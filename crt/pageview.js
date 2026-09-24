/* The site drawn as a TUI. Reads the document (page.js), paints it in a
   box-drawing frame. Links stay real <a>, so click, middle-click and "copy
   link address" behave as on the normal page; arrows drive the same list.

   Layout adapts to the tube: links are laid out first and the header keeps
   what rows are left, dropping its lowest-ranked blocks on a short screen;
   the link column is capped on a wide one.

   `q` drops to the shell; `:` still opens a vi-style command line, and `:p`
   pages through the privacy notice inside the same frame. */

import { segments, wrap, clip, spaced, leader, width } from './text.js';
import { readPage, prettyUrl } from './page.js';
import { loadNotice, noticeLines, pagerDelta, NOTICE_PATH } from './notice.js';

/* Status-line hints, longest first: the first that fits is shown. */
const HINTS_LINKS = [
    ['ARROWS select', 'ENTER open', 'BKSP back', '1-9 jump', 'Q or :q exit'],
    ['ARROWS select', 'ENTER open', 'BKSP back', 'Q or :q exit'],
    ['ARROWS', 'ENTER open', 'BKSP back', 'Q or :q exit'],
];
const HINTS_NOTICE = [
    ['ARROWS scroll', 'SPACE page'],
    ['ARROWS scroll'],
];
/* Their own segments, never clipped away: they are also the mouse's way
   around — out of terminal mode, into the notice and back. */
const HINT_ESC = 'ESC escape';
const HINT_NOTICE = ':p privacy';
const HINT_BACK = 'Q back';
const LIST_MAX = 100;   // columns; beyond this the leaders just get silly
const TEXT_MAX = 72;    // the notice's measure, as about.txt's

/** The page's links, with a `..` entry first when this is not the site
    root — otherwise a sub-page is a one-way trip. */
function buildItems(page) {
    const root = new URL('/', location.href).href;
    // Paths only: a query string or #fragment must not make the home page
    // look like a sub-page and add a `..` back to itself.
    const here = new URL(location.pathname.replace(/index\.html?$/, ''), location.href).href;
    const onRoot = here === root;
    const items = [];

    if (!onRoot) {
        items.push({
            label: 'Back to ' + prettyUrl(root),
            href: root,
            external: false,
            marker: '..',
        });
    }
    page.links
        // The page's own link home is what `..` already is.
        .filter((link) => onRoot || link.href !== root)
        .forEach((link, i) => items.push({ ...link, marker: String(i + 1) }));
    return items;
}

export function createPageView(screen) {
    const page = readPage();
    const items = buildItems(page);
    const canGoBack = items.length > 0 && items[0].marker === '..';

    let selected = 0;
    let command = null;   // null = no command line, string = what has been typed
    let message = null;   // transient error / feedback under the frame
    let notice = null;    // null = the links; else { blocks, failed, top, max }

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

    function titleBar(where = location.href) {
        const g = glyph();
        const label = `[ ${clip(prettyUrl(where), Math.max(8, screen.cols - 12))} ]`;
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
                label: item.label,
                focus: index === selected,
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
        // A person's page says what they do; the meta description is
        // written for search results and reads like it on screen.
        const blurb = page.role || page.description;
        if (blurb) {
            const body = wrap(blurb, Math.max(24, Math.min(inner() - 8, 66)))
                .map((row) => [{ t: indent }, { t: row, c: 'crt-dim' }]);
            blocks.push({ rank: 5, lines: [[], ...body] });
        }
        blocks.push({ rank: 1, lines: [[], []] });
        return blocks.map((block, order) => ({ ...block, order }));
    }

    // drawing
    function draw() {
        if (notice) { drawNotice(); return; }

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

        // Say where we are only when the list does not all fit on screen.
        const where = view.list.length < items.length ? `${selected + 1}/${items.length}` : '';
        const lines = [
            titleBar(),
            ...rows.slice(0, contentRows),
            bottomBar(),
            statusLine(where),
        ];
        screen.render(lines.map((l) => screen.pad(l)));
    }

    /** The notice's text, or why there is none yet. */
    function noticeBody(cols) {
        if (notice.failed) {
            return [
                { t: `Could not read ${NOTICE_PATH}.`, c: 'crt-warn' },
                '',
                [
                    { t: 'Open it in the browser: ' },
                    { t: prettyUrl(NOTICE_PATH), c: 'crt-link', href: new URL(NOTICE_PATH, location.href).href },
                ],
            ];
        }
        if (!notice.blocks) return [{ t: `Reading ${NOTICE_PATH} …`, c: 'crt-dim' }];
        return noticeLines(notice.blocks, cols);
    }

    /** The privacy notice in the page's frame, scrolled to `notice.top`. */
    function drawNotice() {
        const contentRows = Math.max(4, screen.rows - 3);
        const measure = Math.max(24, Math.min(inner() - 6, TEXT_MAX));
        // A blank row under the title bar, as the page's header has.
        const body = [''].concat(noticeBody(measure));

        notice.max = Math.max(0, body.length - contentRows);
        notice.top = Math.min(Math.max(0, notice.top), notice.max);

        const rows = body
            .slice(notice.top, notice.top + contentRows)
            .map((line) => framed([{ t: '   ' }, ...segments(line)]));
        while (rows.length < contentRows) rows.push(framed());

        const where = notice.max ? `${Math.round((notice.top / notice.max) * 100)}%` : '';
        const lines = [titleBar(NOTICE_PATH), ...rows, bottomBar(), statusLine(where)];
        screen.render(lines.map((l) => screen.pad(l)));
    }

    /** Hints on the left, the clickable ones after them, `where` (list
        position or scroll percentage) on the right when there is room. */
    function statusLine(where) {
        if (command !== null) {
            return [{ t: ':' + command }, { t: ' ', c: 'crt-cursor' }];
        }
        if (message) {
            return [{ t: ' ' + clip(message, screen.cols - 2), c: 'crt-warn' }];
        }

        const actions = notice
            ? [{ t: HINT_BACK, c: 'crt-dim', action: 'back' }]
            : [{ t: HINT_NOTICE, c: 'crt-dim', action: 'notice' }];
        actions.push({ t: HINT_ESC, c: 'crt-dim', action: 'close' });

        const wide = screen.cols >= 72;
        const gap = wide ? '   ' : '  ';
        const room = screen.cols - 2 - width(actions) - actions.length * gap.length;
        const variants = (notice ? HINTS_NOTICE : HINTS_LINKS)
            .map((parts) => parts.filter((p) => canGoBack || p !== 'BKSP back').join(gap));
        const hint = variants.find((v) => v.length <= room) || variants[variants.length - 1];

        const line = [{ t: ' ' + clip(hint, room), c: 'crt-dim' }];
        for (const action of actions) line.push({ t: gap }, action);

        if (where) {
            const label = ` ${where} `;
            const pad = screen.cols - width(line) - label.length;
            if (pad > 2) line.push({ t: ' '.repeat(pad) }, { t: label, c: 'crt-dim' });
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

    /** `:p` — read on the first ask, so the frame says so until it lands. */
    function openNotice() {
        const state = { blocks: null, failed: false, top: 0, max: 0 };
        notice = state;
        message = null;
        loadNotice()
            .then((blocks) => { state.blocks = blocks; }, () => { state.failed = true; })
            .then(() => { if (notice === state) screen.redraw(); });
        draw();
    }

    function closeNotice() {
        notice = null;
        message = null;
        draw();
    }

    /** Clamped when drawn, so ±Infinity means top / bottom. */
    function scrollNotice(delta) {
        notice.top += delta;
        message = null;
        draw();
        return true;
    }

    function runCommand(raw) {
        const cmd = raw.trim();
        command = null;

        // In the notice, quitting means back to the links, as a pager does.
        if (cmd === 'q' || cmd === 'q!' || cmd === 'quit' || cmd === 'wq' || cmd === 'x') {
            if (notice) closeNotice();
            else screen.showShell();
            return;
        }
        if (cmd === 'exit' || cmd === 'qa' || cmd === 'qa!') {
            screen.close();
            return;
        }
        if (cmd === 'p' || cmd === 'privacy') {
            if (notice) draw();
            else openNotice();
            return;
        }
        if (cmd === 'h' || cmd === 'help') {
            message = notice
                ? 'Arrow keys and SPACE scroll, q goes back to the links.'
                : 'Arrow keys move, ENTER opens, :p shows the privacy notice, q drops to the console.';
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

        if (notice) return noticeKey(event);

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

    /** Keys while the notice is up: less's, as the console's pager has. */
    function noticeKey(event) {
        const delta = pagerDelta(event, Math.max(1, screen.rows - 4));
        if (delta !== null) return scrollNotice(delta);
        switch (event.key) {
            case 'q': case 'Q': case 'Backspace': case 'ArrowLeft':
                closeNotice(); return true;
            case ':':
                command = ''; message = null; draw(); return true;
            case 'Escape':
                screen.close(); return true;
            case 'Tab':
                return true;   // as in the list: focus stays in the tube
            default:
                return false;
        }
    }

    return {
        name: 'page',
        draw,
        key,
        hover(index) {
            if (index !== selected) { selected = index; message = null; draw(); }
        },
        /** The status line's clickable hints (ESC is handled by crt.js). */
        action(name) {
            if (name === 'notice' && !notice) openNotice();
            else if (name === 'back' && notice) closeNotice();
        },
        wheel(event) {
            if (notice) scrollNotice(event.deltaY < 0 ? -3 : 3);
        },
    };
}
