/* Copy buttons on the code blocks. A file of its own, not inline, so the
   page's Content-Security-Policy can forbid inline script. */
(function () {
    // The buttons' aria-label outranks their text, so "Copied!" is never
    // heard from the button itself; this polite status says it instead.
    const status = document.getElementById('copy-status');

    function copyToClipboard(button) {
        const code = button.nextElementSibling.innerText;
        const done = (label, spoken) => {
            button.textContent = label;
            if (status) status.textContent = spoken;
            setTimeout(() => {
                button.textContent = 'Copy';
                if (status) status.textContent = '';
            }, 2000);
        };
        // The Clipboard API needs a secure context and can still reject
        // (an unfocused document, for instance), so fall back rather than
        // leaving the button silently dead.
        const legacy = () => {
            const field = document.createElement('textarea');
            field.value = code;
            field.setAttribute('readonly', '');
            field.style.position = 'fixed';
            field.style.top = '-1000px';
            document.body.appendChild(field);
            field.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            field.remove();
            if (ok) done('Copied!', 'Command copied');
            else done('Press Ctrl+C', 'Copy failed: select the command and press Ctrl+C');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => done('Copied!', 'Command copied'), legacy);
        } else {
            legacy();
        }
    }

    for (const button of document.querySelectorAll('.copy-btn')) {
        button.addEventListener('click', () => copyToClipboard(button));
    }
})();
