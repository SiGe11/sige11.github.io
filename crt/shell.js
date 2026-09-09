/* ==========================================================================
   Terminal mode — the console you land in after `:q`.

   A small, deliberately old-fashioned shell over the virtual file system in
   vfs.js. New commands go in the COMMANDS table at the bottom; new files go
   in vfs.js and are picked up here for free (listing, cat, completion).
   ========================================================================== */

import { clip } from './text.js';

const USER = 'sige';
const CWD = '~';
const HOME = '/home/sige';

export function createShell(screen, options = {}) {
    const prompt = `${CWD}$ `;

    const output = [];
    const history = [];
    let historyIndex = 0;      // == history.length means "typing a new line"
    let input = '';
    let caret = 0;
    let scroll = 0;            // lines scrolled back from the bottom

    /* --- output ---------------------------------------------------------- */
    const print = (...lines) => {
        for (const line of lines) output.push(line);
        scroll = 0;
    };

    function banner() {
        print(
            [{ t: screen.system, c: 'crt-bright' }, { t: ' shell — document mode terminated.', c: 'crt-dim' }],
            [{ t: 'Type ' }, { t: 'help', c: 'crt-bright' }, { t: ' for commands.' }],
            '',
        );
    }

    /* --- file helpers ---------------------------------------------------- */
    function readFile(name, verb) {
        const entry = screen.vfs.find(name);
        if (!entry) {
            print({ t: `${verb}: ${name}: No such file or directory`, c: 'crt-warn' });
            return;
        }
        if (entry.kind === 'exec') {
            print({ t: `${verb}: ${entry.name}: is an executable — run it with ./${entry.name}`, c: 'crt-warn' });
            return;
        }
        print(...entry.read(screen.cols));
    }

    function runFile(name) {
        const entry = screen.vfs.find(name);
        if (!entry) return false;
        if (entry.kind !== 'exec') {
            print({ t: `${entry.name}: Permission denied`, c: 'crt-warn' });
            return true;
        }
        const result = entry.run(screen);
        if (Array.isArray(result)) print(...result);
        return true;
    }

    /* --- commands -------------------------------------------------------- */
    const COMMANDS = {
        help: () => {
            print({ t: 'COMMANDS', c: 'crt-dim' });
            for (const [name, desc] of HELP) {
                print([{ t: '  ' + name.padEnd(19), c: 'crt-bright' }, { t: desc }]);
            }
        },

        ls: (args) => {
            const flags = args.filter((a) => a.startsWith('-')).join('');
            const all = flags.includes('a');
            const long = flags.includes('l');
            const entries = screen.vfs.list(all);

            if (long) {
                for (const e of entries) {
                    print([
                        { t: e.mode + '  ', c: 'crt-dim' },
                        { t: String(e.size).padStart(5) + '  ' },
                        { t: e.date + '  ', c: 'crt-dim' },
                        { t: e.name + (e.kind === 'exec' ? '*' : ''), c: e.kind === 'exec' ? 'crt-bright' : '' },
                    ]);
                }
                return;
            }
            // Plain columns, the way ls actually prints.
            const names = entries.map((e) => e.name + (e.kind === 'exec' ? '*' : ''));
            const colWidth = Math.max(...names.map((n) => n.length)) + 2;
            const perRow = Math.max(1, Math.floor((screen.cols - 2) / colWidth));

            for (let i = 0; i < names.length; i += perRow) {
                const row = [{ t: '  ' }];
                names.slice(i, i + perRow).forEach((name, j) => {
                    row.push({
                        t: name.padEnd(colWidth),
                        c: entries[i + j].kind === 'exec' ? 'crt-bright' : '',
                    });
                });
                print(row);
            }
        },

        dir: (args) => {
            const entries = screen.vfs.list(args.join('').includes('a'));
            print({ t: ` Directory of ${HOME}`, c: 'crt-dim' }, '');
            for (const e of entries) {
                print([
                    { t: ' ' + e.date + '   ', c: 'crt-dim' },
                    { t: String(e.size).padStart(7) + '  ' },
                    { t: e.name, c: e.kind === 'exec' ? 'crt-bright' : '' },
                ]);
            }
            const bytes = entries.reduce((n, e) => n + e.size, 0);
            print('', { t: `       ${entries.length} File(s)   ${bytes} bytes`, c: 'crt-dim' });
        },

        cat: (args) => {
            if (!args.length) { print({ t: 'cat: missing operand', c: 'crt-warn' }); return; }
            args.forEach((name) => readFile(name, 'cat'));
        },

        // Prints a file when handed one, otherwise echoes its arguments.
        echo: (args) => {
            if (args.length === 1 && screen.vfs.find(args[0])) { readFile(args[0], 'echo'); return; }
            print(args.join(' '));
        },

        clear: () => { output.length = 0; },

        pwd: () => print(HOME),
        whoami: () => print(USER),
        date: () => print(new Date().toString()),
        uname: () => print(`${screen.system} 2.5 viridis i386`),

        site: () => runFile('site.sh'),
        swarm: () => runFile('swarm.exe'),

        exit: () => screen.close(),
    };

    COMMANDS.cls = COMMANDS.clear;
    COMMANDS.quit = COMMANDS.exit;
    COMMANDS[':q'] = COMMANDS.exit;
    COMMANDS['?'] = COMMANDS.help;
    COMMANDS.man = COMMANDS.help;

    /* Every command the shell answers to, aliases named on the right.
       Anything added to COMMANDS above belongs here too. */
    const HELP = [
        ['help', 'this list — also ? and man'],
        ['ls [-a] [-l]', 'list the files in this directory'],
        ['dir', 'the same listing, DOS style'],
        ['cat <file>', 'print a text file'],
        ['echo <file|text>', 'print a text file, or the text you typed'],
        ['./<file>', 'run an executable — also run, exec, sh'],
        ['site', 'draw the site again — same as ./site.sh'],
        ['swarm', 'launch Swarm vs Hero — same as ./swarm.exe'],
        ['pwd', 'print the working directory'],
        ['whoami', 'print the current user'],
        ['date', 'print the date and time'],
        ['uname', 'print the system name and build'],
        ['clear', 'wipe the screen — also cls, Ctrl+L'],
        ['exit', 'leave terminal mode — also quit, :q, ./legacy.sh'],
    ];

    /* --- the read-eval loop ---------------------------------------------- */
    function submit() {
        const raw = input;
        print([{ t: prompt, c: 'crt-dim' }, { t: raw }]);
        input = '';
        caret = 0;

        const line = raw.trim();
        if (line) {
            history.push(line);
            const [name, ...args] = line.split(/\s+/);

            if (Object.prototype.hasOwnProperty.call(COMMANDS, name)) {
                COMMANDS[name](args);
            } else if (name === 'run' || name === 'exec' || name === 'sh') {
                if (!args.length || !runFile(args[0])) {
                    print({ t: `${name}: ${args[0] || ''}: No such file`, c: 'crt-warn' });
                }
            } else if (!runFile(name)) {
                print(
                    { t: `${clip(name, 40)}: command not found`, c: 'crt-warn' },
                    { t: 'Try `help`, or `ls` to see the files.', c: 'crt-dim' },
                );
            }
        }
        historyIndex = history.length;
        // A command may have handed the screen to another view (site.sh), so
        // redraw whatever is active now rather than this shell unconditionally.
        screen.redraw();
    }

    /** Tab completion over command names and file names. */
    function complete() {
        const parts = input.split(/\s+/);
        const word = parts[parts.length - 1] || '';
        const prefix = word.replace(/^\.\//, '');
        const pool = parts.length > 1
            ? screen.vfs.list(true).map((e) => e.name)
            : Object.keys(COMMANDS).concat(screen.vfs.list().map((e) => './' + e.name));

        const hits = pool.filter((c) => c.replace(/^\.\//, '').startsWith(prefix));
        if (!hits.length) return;

        if (hits.length === 1) {
            parts[parts.length - 1] = word.startsWith('./') ? './' + hits[0].replace(/^\.\//, '') : hits[0];
            input = parts.join(' ');
            caret = input.length;
        } else {
            print([{ t: prompt, c: 'crt-dim' }, { t: input }]);
            print({ t: '  ' + hits.join('   '), c: 'crt-dim' });
        }
        draw();
    }

    function recall(delta) {
        if (!history.length) return;
        historyIndex = Math.min(history.length, Math.max(0, historyIndex + delta));
        input = historyIndex === history.length ? '' : history[historyIndex];
        caret = input.length;
        draw();
    }

    /* --- drawing --------------------------------------------------------- */
    function promptLine() {
        const before = input.slice(0, caret);
        const at = input.slice(caret, caret + 1) || ' ';
        const after = input.slice(caret + 1);
        return [
            { t: prompt, c: 'crt-dim' },
            { t: before },
            { t: at, c: 'crt-cursor' },
            { t: after },
        ];
    }

    function draw() {
        const visible = screen.rows - 1;
        const all = output.concat([promptLine()]);
        const end = Math.max(0, all.length - scroll);
        const start = Math.max(0, end - visible);
        const lines = all.slice(start, end);
        while (lines.length < visible) lines.push('');
        screen.render(lines.map((l) => screen.pad(l)));
    }

    /* --- input ----------------------------------------------------------- */
    function key(event) {
        const k = event.key;

        if (event.ctrlKey) {
            if (k === 'l' || k === 'L') { output.length = 0; draw(); return true; }
            if (k === 'c' || k === 'C') {
                // Ctrl+C is also the copy key outside macOS. With something
                // selected on screen the visitor means "copy": hand the key
                // to the browser instead of interrupting the line.
                const selection = window.getSelection && window.getSelection();
                if (selection && !selection.isCollapsed && String(selection)) return false;
                print([{ t: prompt, c: 'crt-dim' }, { t: input }, { t: '^C', c: 'crt-warn' }]);
                input = ''; caret = 0; draw(); return true;
            }
            if (k === 'u' || k === 'U') { input = input.slice(caret); caret = 0; draw(); return true; }
            if (k === 'a' || k === 'A') { caret = 0; draw(); return true; }
            if (k === 'e' || k === 'E') { caret = input.length; draw(); return true; }
            if (k === 'k' || k === 'K') { input = input.slice(0, caret); draw(); return true; }
            return false;
        }

        switch (k) {
            case 'Enter':      submit(); return true;
            case 'Backspace':
                if (caret > 0) { input = input.slice(0, caret - 1) + input.slice(caret); caret -= 1; draw(); }
                return true;
            case 'Delete':
                input = input.slice(0, caret) + input.slice(caret + 1); draw(); return true;
            case 'Tab':        complete(); return true;
            case 'ArrowUp':    recall(-1); return true;
            case 'ArrowDown':  recall(1); return true;
            case 'ArrowLeft':  caret = Math.max(0, caret - 1); draw(); return true;
            case 'ArrowRight': caret = Math.min(input.length, caret + 1); draw(); return true;
            case 'Home':       caret = 0; draw(); return true;
            case 'End':        caret = input.length; draw(); return true;
            case 'PageUp':     scroll = Math.min(output.length, scroll + 5); draw(); return true;
            case 'PageDown':   scroll = Math.max(0, scroll - 5); draw(); return true;
            case 'Escape':     input = ''; caret = 0; draw(); return true;
            default:           break;
        }

        if (k.length === 1) {
            input = input.slice(0, caret) + k + input.slice(caret);
            caret += 1;
            draw();
            return true;
        }
        return false;
    }

    return {
        name: 'shell',
        enter() {
            if (options.quiet !== true) banner();
        },
        draw,
        key,
        wheel(event) {
            scroll = Math.max(0, Math.min(output.length, scroll + (event.deltaY < 0 ? 3 : -3)));
            draw();
        },
    };
}
