/* The virtual file system. Add a file by pushing one more object into
   `entries` below; the shell picks it up for ls / cat / echo / completion. */

import { wrap, leader, clip } from './text.js';
import { readPage, prettyUrl } from './page.js';

const SWARM_URL = '/swarmvshero/';
const WRITEUP_URL = '/content/writeups/funpage/';

/** Same-site pages, so: this tab. The visitor keeps control of their tabs
    and Back still works, and terminal mode is the default so coming back
    lands here again. External links in the page view still open a new tab —
    that is what the site's own markup asks for. */
function launch(screen, url, line) {
    setTimeout(() => screen.navigate(url), 420);   // let the line land first
    return [line];
}

/* about.txt — the one place to edit it. The links under it are read from
   the page, so they never go stale. */
const PROFILE = {
    name: 'Gergely Simon',
    tagline: 'back-end developer · cybersecurity',
    bio: [
        'Back-end developer, cybersecurity enthusiast. The parts of a ' +
        'system nobody sees — and what happens when someone looks.',

        'Builds and maintains Lightweight Blocker, a privacy aware site ' +
        'blocker for Firefox and Chrome.',

        'Breaks things on purpose at TryHackMe, and writes up how.',
    ],
};

function aboutFile(cols) {
    const page = readPage();
    const inner = Math.min(Math.max(cols - 2, 30), 72);
    const lines = [];

    lines.push({ t: PROFILE.name.toUpperCase(), c: 'crt-bright' });
    lines.push({ t: PROFILE.tagline, c: 'crt-dim' });
    lines.push('');

    for (const paragraph of PROFILE.bio) {
        for (const row of wrap(paragraph, inner - 2)) lines.push('  ' + row);
        lines.push('');
    }

    if (page.links.length) {
        lines.push({ t: 'ELSEWHERE', c: 'crt-dim' });
        for (const link of page.links) {
            lines.push(['  ', ...leader(clip(link.label, 20), prettyUrl(link.href), inner - 2)]);
        }
        lines.push('');
    }

    return lines;
}

/** A nod to the comment that has been sitting in index.html all along. */
function flagFile() {
    return [
        { t: 'R2hjY2RtIGVremYgZW50bWMgYXg6IG1uYW5jeCB4ZHMu', c: 'crt-warn' },
        '',
        { t: 'base64, then walk each letter one step forward.', c: 'crt-dim' },
    ];
}

export function buildVfs(screen) {
    const entries = [
        // Who Gergely Simon is.
        {
            name: 'about.txt',
            kind: 'text',
            mode: '-rw-r--r--',
            size: 1104,
            date: 'Feb  3 09:41',
            read: (cols) => aboutFile(cols),
        },
        // Draw the current page on this terminal again.
        {
            name: 'site.sh',
            kind: 'exec',
            mode: '-rwxr-xr-x',
            size: 512,
            date: 'Feb  3 09:41',
            run: () => { screen.showPage(); },
        },
        // Back to the normal website.
        {
            name: 'legacy.sh',
            kind: 'exec',
            mode: '-rwxr-xr-x',
            size: 288,
            date: 'Feb  3 09:41',
            run: () => {
                screen.close();
                return [{ t: 'Restoring document mode …', c: 'crt-dim' }];
            },
        },
        // Launch the game.
        {
            name: 'swarm.exe',
            kind: 'exec',
            mode: '-rwxr-xr-x',
            size: 4096,
            date: 'Apr 22 18:07',
            run: () => launch(screen, SWARM_URL, { t: 'Opening rifts …', c: 'crt-warn' }),
        },
        // The Funpage write-up.
        {
            name: 'writeup.sh',
            kind: 'exec',
            mode: '-rwxr-xr-x',
            size: 2048,
            date: 'Feb  3 09:41',
            run: () => launch(screen, WRITEUP_URL, { t: 'Opening the write-up …', c: 'crt-dim' }),
        },
        // Still unclaimed.
        {
            name: '.flag',
            kind: 'text',
            hidden: true,
            mode: '-r--r--r--',
            size: 96,
            date: 'Feb  3 09:41',
            read: () => flagFile(),
        },
    ];

    return {
        entries,
        /** Visible entries, or everything when `all` is set (ls -a). */
        list: (all = false) => entries.filter((e) => all || !e.hidden),
        /** Lookup tolerant of the ./ prefix people type out of habit. */
        find: (name) => {
            const clean = String(name).replace(/^\.\//, '');
            return entries.find((e) => e.name === clean) || null;
        },
    };
}
