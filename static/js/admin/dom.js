/**
 * Tiny DOM builder for the admin interface.
 *
 * Admin pages show names, paths and owners that other users control, so text
 * only ever reaches the page through createTextNode / textContent here. There
 * is no markup parsing anywhere under static/js/admin/ (eslint forbids
 * innerHTML and its relatives for this directory).
 */

/**
 * Build an element.
 *
 * `props` keys: `class` (string), `text` (textContent), `on<event>` (listener),
 * `data` (object, becomes data-* attributes), `value`/`checked`/`disabled`/
 * `hidden` (set as properties), anything else is an attribute (false, null and
 * undefined skip it, true sets it empty). Children are nodes or strings;
 * null, undefined and false are skipped, arrays are flattened.
 * @param {string} tag
 * @param {Object|null} [props]
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
    const doc = globalThis.document;
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.setAttribute('class', value);
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'data') {
            for (const [k, v] of Object.entries(value)) node.setAttribute(`data-${k}`, String(v));
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') {
            node[key] = value;
        } else node.setAttribute(key, value === true ? '' : String(value));
    }
    append(node, children);
    return node;
}

/**
 * Append children (see h) to `node`.
 * @param {Node} node
 * @param {Array} children
 * @returns {Node}
 */
export function append(node, children) {
    for (const child of children) {
        if (child === undefined || child === null || child === false) continue;
        if (Array.isArray(child)) append(node, child);
        else if (typeof child === 'string' || typeof child === 'number') {
            node.appendChild(globalThis.document.createTextNode(String(child)));
        } else node.appendChild(child);
    }
    return node;
}

/**
 * Replace everything inside `node` with `children`.
 * @param {Node} node
 * @param {...*} children
 * @returns {Node}
 */
export function setChildren(node, ...children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return append(node, children);
}

/**
 * A Bootstrap badge.
 * @param {string} text
 * @param {string} [tone] - Bootstrap colour name
 * @param {string} [title]
 */
export function badge(text, tone = 'secondary', title) {
    return h('span', { class: `badge text-bg-${tone}`, text, title });
}

/**
 * A table: header cells from `columns`, one row per entry of `rows`, each row
 * an array of cell contents (nodes or strings).
 * @param {string[]} columns
 * @param {Array<Array>} rows
 * @param {string} [emptyText] - shown in one spanning cell when there are no rows
 * @returns {HTMLElement}
 */
export function table(columns, rows, emptyText = 'Nothing to show.') {
    const body = rows.length
        ? rows.map((cells) => h('tr', null, cells.map((c) => h('td', null, c))))
        : [h('tr', null, h('td', { colspan: columns.length, class: 'text-muted', text: emptyText }))];
    return h('div', { class: 'table-responsive' },
        h('table', { class: 'table table-sm table-hover align-middle admin-table' },
            h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', text: c })))),
            h('tbody', null, body)));
}
