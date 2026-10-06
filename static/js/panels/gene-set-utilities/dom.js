/**
 * The Gene Set Analysis panel's DOM builder. Everything a service returns
 * reaches the page as text (textContent) or as an attribute value, never as
 * HTML: a term named `<img src=x onerror=...>` is shown, not run. Images are
 * Blobs shown through object URLs (blob:), never a third party's URL in an
 * <img> (cross-origin isolation blocks those, and it would be a request on
 * render) and never inlined SVG.
 *
 * `makeDom(document)` so Node tests can pass a stand-in document.
 */

/**
 * @param {Document} doc
 * @returns {{el: Function, table: Function, link: Function, clear: Function}}
 */
export function makeDom(doc) {
    /**
     * el('button', {class: 'btn', type: 'button', on: {click: fn}, aria: {pressed: 'false'},
     *     data: {section: 'x'}, text: 'Run'}, ...children)
     * Children: nodes, strings (as text), null/false (skipped), arrays (flattened).
     */
    function el(tag, attrs = {}, ...children) {
        const node = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = String(v);
            else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
            else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null) node.setAttribute(`aria-${a}`, String(av)); }
            else if (k === 'data') for (const [d, dv] of Object.entries(v)) { if (dv !== undefined && dv !== null) node.dataset[d] = String(dv); }
            else if (k === 'hidden') node.hidden = !!v;
            else if (k === 'disabled') node.disabled = !!v;
            else if (k === 'checked') node.checked = !!v;
            else if (k === 'value') node.value = String(v);
            else node.setAttribute(k, v === true ? '' : String(v));
        }
        append(node, children);
        return node;
    }

    function append(node, children) {
        for (const c of children) {
            if (c === null || c === undefined || c === false) continue;
            if (Array.isArray(c)) append(node, c);
            else if (typeof c === 'string' || typeof c === 'number') node.appendChild(doc.createTextNode(String(c)));
            else node.appendChild(c);
        }
    }

    /** Remove every child. */
    function clear(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    /**
     * An external link: new tab, no opener, no referrer, and a name that says
     * where it goes. The desktop app opens it in the system browser.
     */
    function link(href, text, { label, cls } = {}) {
        return el('a', {
            href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
            class: cls || 'gs-link', text,
            aria: { label: `${label || text} (opens in a new tab)` }
        });
    }

    /**
     * A results table: a real <table> with a hidden caption and column
     * headers. A cell is a string/number (text), a node, or {text, title, href, cls}.
     * @param {string} caption
     * @param {Array<string|{label: string, cls?: string, title?: string}>} columns
     * @param {Array<Array>} rows
     */
    function table(caption, columns, rows) {
        const head = el('tr', {}, columns.map(c => {
            const col = typeof c === 'string' ? { label: c } : c;
            return el('th', { scope: 'col', class: col.cls, title: col.title, text: col.label });
        }));
        const body = el('tbody', {}, rows.map(row => el('tr', {}, row.map((cell, i) => {
            const col = typeof columns[i] === 'string' ? {} : (columns[i] || {});
            if (cell && typeof cell === 'object' && 'nodeType' in cell) return el('td', { class: col.cls }, cell);
            if (cell && typeof cell === 'object') {
                const inner = cell.href ? link(cell.href, cell.text, { label: cell.label }) : (cell.text ?? '');
                return el('td', { class: cell.cls || col.cls, title: cell.title }, inner);
            }
            return el('td', { class: col.cls, text: cell === null || cell === undefined ? '' : String(cell) });
        }))));
        return el('table', { class: 'table table-sm gs-table' },
            el('caption', { class: 'visually-hidden', text: caption }),
            el('thead', {}, head), body);
    }

    return { el, table, link, clear };
}

/** p-values and FDRs as the services print them: 3 significant digits. */
export function sci(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    // a service's 0 is a p below what it can compute, not an impossibility
    if (n === 0) return '< 1e-16';
    return n < 1e-3 ? n.toExponential(2) : n.toPrecision(3).replace(/\.?0+$/, '');
}

/** Rows as CSV text (for a section's download). */
export function toCsv(columns, rows) {
    const q = (v) => {
        const s = v === null || v === undefined ? '' : (Array.isArray(v) ? v.join(';') : String(v));
        return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
