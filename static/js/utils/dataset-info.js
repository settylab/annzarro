/**
 * What a dataset says about itself: attribution, README and AnnData structure.
 *
 * The data comes from `GET /api/v1/datasets/info?path=&parts=` (server: core/dataset_info.py), one
 * part at a time and only when it is shown. This module has the loader (cached, one request per
 * part), the drawing of each part, and the loading and error states, so the dataset information
 * dialog (dataset-info-dialog.js) and the dataset browser's details pane show the same thing.
 *
 * Everything the dataset's author wrote is set as text (`textContent`), except the README, which
 * goes through the safe Markdown renderer (safe-markdown.js: escape first, then a small allow-list;
 * links only http, https and mailto; no raw HTML, no images). A link of the attribution is only
 * made when its address is http(s) or mailto, whatever the server said.
 */
import { renderSafeMarkdown } from './safe-markdown.js';

export const PARTS = ['about', 'readme', 'structure'];

const DOCS_URL = 'https://annzarro.readthedocs.io/en/latest/deployment/dataset-attribution.html';

/** `url` when it is an http, https or mailto address, else null. */
export function safeHref(url) {
    const text = String(url || '').trim();
    return /^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(text) ? text : null;
}

/** `[200, 20]` as "200 × 20"; "" when the shape is unknown. */
export function shapeLabel(shape) {
    return Array.isArray(shape) && shape.length ? shape.map((n) => Number(n).toLocaleString('en-US')).join(' × ') : '';
}

/** The type of a matrix-like member in a few words: "float32", "csr_matrix, float32", "dataframe, 3 columns". */
export function memberType(item) {
    const bits = [];
    if (item.encoding && item.encoding !== 'array') bits.push(item.encoding);
    if (item.columns !== undefined) bits.push(`${item.columns} column${item.columns === 1 ? '' : 's'}`);
    if (item.dtype) bits.push(item.dtype);
    return bits.join(', ');
}

/** The type of an obs or var column: "categorical, 8 categories", "float64", "string". */
export function columnType(column) {
    if (column.kind === 'categorical') {
        const n = column.categories;
        return n === undefined ? 'categorical' : `categorical, ${n.toLocaleString('en-US')} categor${n === 1 ? 'y' : 'ies'}`;
    }
    return column.dtype && column.dtype !== column.kind ? `${column.kind}, ${column.dtype}` : (column.kind || column.dtype || '');
}

/** Text to copy for "Copy citation": the citation as given, with the DOI link when it does not name it. */
export function citationText(about) {
    if (!about) return '';
    const doi = about.doi_url || '';
    if (about.citation) {
        return doi && !about.citation.includes(about.doi || '') ? `${about.citation} ${doi}` : about.citation;
    }
    const authors = Array.isArray(about.authors) ? about.authors.join(', ') : '';
    const parts = [authors, about.title, about.attribution, doi || (about.doi ? `doi:${about.doi}` : '')].filter(Boolean);
    return parts.join('. ');
}

// ---- loading ---------------------------------------------------------------------------------

/**
 * A loader of the parts of one server's datasets: each (path, part) is asked for once and kept, a
 * request in flight is shared, and a failure is not kept (so "Try again" asks again).
 * @param {{url: string, fetchImpl?: Function}} options
 */
export function createInfoLoader({ url, fetchImpl = (...args) => fetch(...args) }) {
    const kept = new Map();
    const flying = new Map();
    async function request(path, part) {
        const response = await fetchImpl(`${url}?path=${encodeURIComponent(path)}&parts=${part}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.error || `The server answered ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return body[part];
    }
    return {
        /** @returns {Promise<Object>} the part (`about`, `readme` or `structure`) of the dataset at `path` */
        load(path, part) {
            const key = `${path}|${part}`;
            if (kept.has(key)) return Promise.resolve(kept.get(key));
            if (flying.has(key)) return flying.get(key);
            const promise = request(path, part).then((value) => { kept.set(key, value); return value; })
                .finally(() => flying.delete(key));
            flying.set(key, promise);
            return promise;
        },
        peek(path, part) { return kept.get(`${path}|${part}`); },
        /** Forget what was read of `path` (the dataset was refreshed), or of everything. */
        forget(path = null) {
            for (const key of [...kept.keys()]) if (path === null || key.startsWith(`${path}|`)) kept.delete(key);
        }
    };
}

function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
}

function link(doc, href, text) {
    const safe = safeHref(href);
    if (!safe) return doc.createTextNode(text);
    const a = el(doc, 'a', null, text);
    a.href = safe;
    a.rel = 'noopener noreferrer';
    if (!/^mailto:/i.test(safe)) a.target = '_blank';
    return a;
}

/** The loading state: a spinner and words, announced to a screen reader. */
export function showLoading(container, what = 'Loading…') {
    const doc = container.ownerDocument;
    container.textContent = '';
    container.setAttribute('aria-busy', 'true');
    const box = el(doc, 'div', 'dsi-loading');
    box.setAttribute('role', 'status');
    box.appendChild(el(doc, 'span', 'dsi-spinner'));
    box.appendChild(el(doc, 'span', 'dsi-loading-text', what));
    container.appendChild(box);
}

/** The error state: what went wrong and a button that asks again. */
export function showError(container, message, retry) {
    const doc = container.ownerDocument;
    container.textContent = '';
    container.removeAttribute('aria-busy');
    const box = el(doc, 'div', 'dsi-error');
    box.setAttribute('role', 'alert');
    box.appendChild(el(doc, 'p', 'dsi-error-text', message || 'The information could not be read.'));
    if (retry) {
        const button = el(doc, 'button', 'btn btn-sm btn-outline-secondary dsi-retry', 'Try again');
        button.type = 'button';
        button.addEventListener('click', retry);
        box.appendChild(button);
    }
    container.appendChild(box);
}

/**
 * Show part `part` of the dataset at `path` in `container`: the loading state, then the drawing, or the error.
 * `current()` says whether the container still belongs to that dataset (nothing is drawn after it moved on).
 */
export async function showPart(container, { loader, path, part, draw, current = () => true, compact = false }) {
    const words = { about: 'Loading the attribution…', readme: 'Loading the README…', structure: 'Reading the structure…' };
    showLoading(container, words[part]);
    try {
        const value = await loader.load(path, part);
        if (!current()) return false;
        container.textContent = '';
        container.removeAttribute('aria-busy');
        draw(container, value, { compact });
        return true;
    } catch (error) {
        if (!current()) return false;
        showError(container, (error && error.message) || 'The information could not be read.', () => showPart(container, { loader, path, part, draw, current, compact }));
        return false;
    }
}

// ---- drawing ---------------------------------------------------------------------------------

/** About: title, description, licence, authors, citation (with a copy button), DOI, source, contact. */
export function drawAbout(container, about, { compact = false, copy = null } = {}) {
    const doc = container.ownerDocument;
    if (!about || !about.present) {
        const empty = el(doc, 'p', 'dsi-empty', 'This dataset records no attribution.');
        container.appendChild(empty);
        if (!compact) {
            const how = el(doc, 'p', 'dsi-hint dsi-muted', 'Its owner can add a licence, a citation and a DOI to uns["annzarro"] (');
            const a = link(doc, DOCS_URL, 'how');
            how.appendChild(a);
            how.appendChild(doc.createTextNode(').'));
            container.appendChild(how);
        }
        return;
    }
    if (about.title && !compact) container.appendChild(el(doc, 'h3', 'dsi-title', about.title));
    if (about.description) container.appendChild(el(doc, 'p', 'dsi-description', about.description));
    const list = el(doc, 'dl', compact ? 'dsi-fields dsi-fields-compact' : 'dsi-fields');
    const add = (term, node, cls) => {
        if (node === null || node === undefined || node === '') return null;
        list.appendChild(el(doc, 'dt', null, term));
        const dd = el(doc, 'dd', cls || null);
        if (typeof node === 'string') dd.textContent = node; else dd.appendChild(node);
        list.appendChild(dd);
        return dd;
    };
    if (compact && about.title) add('Title', about.title);
    if (about.license) {
        const holder = doc.createDocumentFragment();
        holder.appendChild(link(doc, about.license_url, about.license));
        add('Licence', holder, 'dsi-license');
    }
    if (Array.isArray(about.authors) && about.authors.length) add('Authors', about.authors.join(', '));
    add('Attribution', about.attribution, 'dsi-multiline');
    add('Citation', about.citation, 'dsi-multiline dsi-citation');
    if (about.doi) {
        const holder = doc.createDocumentFragment();
        holder.appendChild(link(doc, about.doi_url, about.doi));
        add('DOI', holder, 'dsi-doi');
    }
    if (about.source_url) {
        const holder = doc.createDocumentFragment();
        holder.appendChild(link(doc, about.source_url, about.source_url));
        add('Source', holder, 'dsi-source');
    }
    if (about.contact) {
        const holder = doc.createDocumentFragment();
        holder.appendChild(link(doc, about.contact_url, about.contact));
        add('Contact', holder);
    }
    container.appendChild(list);
    const text = citationText(about);
    if (text) {
        const button = el(doc, 'button', 'btn btn-sm btn-outline-secondary dsi-copy', 'Copy citation');
        button.type = 'button';
        button.addEventListener('click', async () => {
            const write = copy || ((value) => navigator.clipboard.writeText(value));
            try { await write(text); button.textContent = 'Copied'; } catch { button.textContent = 'Copy failed'; }
            setTimeout(() => { button.textContent = 'Copy citation'; }, 1500);
        });
        container.appendChild(button);
    }
    if (about.source === 'uns' || (about.fallbacks && about.fallbacks.length)) {
        const keys = (about.fallbacks || []).map((k) => `uns["${k}"]`).join(', ');
        container.appendChild(el(doc, 'p', 'dsi-hint dsi-muted', about.source === 'uns'
            ? `Taken from ${keys}; the dataset has no uns["annzarro"].` : `Some fields taken from ${keys}.`));
    }
}

/** README: rendered as safe Markdown, with a note when it was cut and a reason when it cannot be shown. */
export function drawReadme(container, readme, { compact = false } = {}) {
    const doc = container.ownerDocument;
    if (!readme || !readme.present) {
        container.appendChild(el(doc, 'p', 'dsi-empty', 'This dataset has no README.'));
        return;
    }
    if (readme.problem) {
        const why = readme.problem === 'too_large'
            ? 'The README is too large to show.' : readme.problem === 'not_text'
                ? 'uns["README"] is not a single text string, so it is not shown.' : 'The README could not be read.';
        container.appendChild(el(doc, 'p', 'dsi-empty', why));
        return;
    }
    const body = el(doc, 'div', compact ? 'dsi-readme dsi-readme-compact' : 'dsi-readme');
    // the one place text becomes markup: the renderer escapes everything first, then allows a small subset
    body.innerHTML = renderSafeMarkdown(readme.text, { headingBase: compact ? 5 : 4 });
    container.appendChild(body);
    if (readme.truncated) {
        const kb = (n) => `${Math.round(n / 1024).toLocaleString('en-US')} KB`;
        const note = el(doc, 'p', 'dsi-note dsi-truncated', `Showing the first ${kb(readme.limit_bytes || readme.text.length)} of ${kb(readme.bytes)}.`);
        container.appendChild(note);
    }
}

function table(doc, headers, rows) {
    const t = el(doc, 'table', 'table table-sm dsi-table');
    const head = el(doc, 'thead');
    const tr = el(doc, 'tr');
    for (const h of headers) tr.appendChild(el(doc, 'th', null, h));
    head.appendChild(tr);
    t.appendChild(head);
    const body = el(doc, 'tbody');
    for (const row of rows) {
        const r = el(doc, 'tr');
        row.forEach((cell, i) => r.appendChild(el(doc, i === 0 ? 'th' : 'td', i === 0 ? 'dsi-name' : null, cell)));
        body.appendChild(r);
    }
    t.appendChild(body);
    return t;
}

function section(doc, title, count, open) {
    const d = el(doc, 'details', 'dsi-section');
    d.open = open;
    const summary = el(doc, 'summary', null, title);
    if (count !== undefined) summary.appendChild(el(doc, 'span', 'dsi-count', ` ${count.toLocaleString('en-US')}`));
    d.appendChild(summary);
    return d;
}

function more(doc, shown, total) {
    return total > shown ? el(doc, 'p', 'dsi-note', `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}.`) : null;
}

function unsTree(doc, node) {
    const ul = el(doc, 'ul', 'dsi-tree');
    for (const child of node.children || []) {
        const li = el(doc, 'li');
        li.appendChild(el(doc, 'span', 'dsi-name', child.name));
        if (child.type === 'group') {
            li.appendChild(el(doc, 'span', 'dsi-muted', ` group, ${child.total} ${child.total === 1 ? 'key' : 'keys'}`));
            if (child.children && child.children.length) li.appendChild(unsTree(doc, child));
            else if (child.total) li.appendChild(el(doc, 'span', 'dsi-muted', ' …'));
        } else if (child.type === 'array') {
            const shape = shapeLabel(child.shape);
            li.appendChild(el(doc, 'span', 'dsi-muted', ` ${[child.dtype, shape ? `(${shape})` : 'scalar'].filter(Boolean).join(' ')}`));
        } else {
            li.appendChild(el(doc, 'span', 'dsi-muted', ' unreadable'));
        }
        ul.appendChild(li);
    }
    const left = (node.total || 0) - (node.children || []).length;
    if (left > 0 && (node.children || []).length) ul.appendChild(el(doc, 'li', 'dsi-muted', `… and ${left.toLocaleString('en-US')} more`));
    return ul;
}

/** Structure: counts, X, obs and var columns, the matrix slots with shapes, the uns tree. */
export function drawStructure(container, structure, { compact = false } = {}) {
    const doc = container.ownerDocument;
    const s = structure || {};
    const count = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('en-US'));
    container.appendChild(el(doc, 'p', 'dsi-summary', `${count(s.n_obs)} observations (cells) × ${count(s.n_vars)} variables (genes)`));
    if (s.X) {
        const x = el(doc, 'p', 'dsi-x');
        x.append(el(doc, 'strong', null, 'X '), doc.createTextNode([shapeLabel(s.X.shape), memberType(s.X)].filter(Boolean).join(', ')));
        container.appendChild(x);
    }
    for (const [key, label] of [['obs', 'obs: cell annotations'], ['var', 'var: gene annotations']]) {
        const t = s[key] || { columns: [], total: 0 };
        const d = section(doc, label, t.total, !compact && t.total <= 40);
        d.dataset.section = key;
        if (t.columns.length) d.appendChild(table(doc, ['Column', 'Type'], t.columns.map((c) => [c.name, columnType(c)])));
        else d.appendChild(el(doc, 'p', 'dsi-muted', 'No columns.'));
        const note = more(doc, t.columns.length, t.total);
        if (note) d.appendChild(note);
        container.appendChild(d);
    }
    for (const [slot, label] of [['obsm', 'obsm: cell embeddings'], ['varm', 'varm: gene matrices'], ['obsp', 'obsp: cell-cell graphs'],
        ['varp', 'varp: gene-gene matrices'], ['layers', 'layers']]) {
        const t = s[slot];
        if (!t || !t.total) continue;
        const d = section(doc, label, t.total, !compact);
        d.dataset.section = slot;
        d.appendChild(table(doc, ['Key', 'Shape', 'Type'], t.items.map((i) => [i.name, shapeLabel(i.shape), memberType(i)])));
        const note = more(doc, t.items.length, t.total);
        if (note) d.appendChild(note);
        container.appendChild(d);
    }
    const uns = s.uns || { children: [], total: 0 };
    const d = section(doc, 'uns: unstructured', uns.total, !compact && uns.total <= 40);
    d.dataset.section = 'uns';
    if (uns.children && uns.children.length) d.appendChild(unsTree(doc, uns));
    else d.appendChild(el(doc, 'p', 'dsi-muted', 'Empty.'));
    if (uns.capped) d.appendChild(el(doc, 'p', 'dsi-note', 'The tree is cut here; the dataset has more.'));
    container.appendChild(d);
}
