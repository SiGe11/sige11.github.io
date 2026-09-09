/* ==========================================================================
   Terminal mode — reading the page.

   The terminal renders whatever the current document already says, so the
   two views never drift apart: edit index.html and the CLI follows.
   ========================================================================== */

/** Structured data the site already publishes, if present. */
function readJsonLd() {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            const data = JSON.parse(node.textContent);
            if (data && typeof data === 'object') return data;
        } catch (_) { /* malformed block: ignore it */ }
    }
    return {};
}

function isExternal(anchor) {
    try {
        return new URL(anchor.getAttribute('href'), location.href).origin !== location.origin;
    } catch (_) {
        return false;
    }
}

/**
 * Short, human display form of a URL: "github.com/SiGe11".
 * Query strings are dropped — tracking parameters are noise on screen, and
 * the anchor still carries the full href.
 */
export function prettyUrl(href) {
    try {
        const url = new URL(href, location.href);
        const path = url.pathname.replace(/\/$/, '');
        return (url.host + path).replace(/^www\./, '');
    } catch (_) {
        return href;
    }
}

/**
 * @returns {{title:string, subtitle:string, role:string, description:string,
 *            links:Array<{label:string, href:string, external:boolean}>}}
 */
export function readPage() {
    const block = document.querySelector('.info-block') || document.body;
    const meta = readJsonLd();

    const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, ' ') : '');
    const description =
        document.querySelector('meta[name="description"]')?.content?.trim() ||
        meta.description || '';

    const links = Array.from(block.querySelectorAll('a[href]'))
        .filter((a) => {
            const href = a.getAttribute('href');
            return href && !href.startsWith('#') && !href.startsWith('javascript:');
        })
        .map((a) => ({
            label: text(a),
            href: new URL(a.getAttribute('href'), location.href).href,
            external: isExternal(a),
        }));

    return {
        title: text(block.querySelector('h1')) || meta.name || document.title,
        subtitle: text(block.querySelector('h2')) || '',
        role: meta.jobTitle || '',
        description,
        links,
    };
}
