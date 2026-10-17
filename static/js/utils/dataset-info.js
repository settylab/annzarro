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
import { mountStructureSearch } from './structure-search.js';

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

/** A fraction as a percentage to two significant digits: 0.25 is "25%", 0.00004 is "<0.01%". */
export function densityLabel(density) {
    if (density === null || density === undefined) return '';
    if (density === 0) return '0%';
    const pct = density * 100;
    return pct < 0.01 ? '<0.01%' : `${Number(pct.toPrecision(2))}%`;
}

const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The type of an obsm, varm, obsp, varp, layers or X entry in a few words: "float32", "csr_matrix, float32, 4 stored
 * values (25% dense)", "dataframe, 2 columns: u, v", "awkward-array, length 200".
 */
export function memberType(item) {
    const bits = [];
    if (item.encoding && item.encoding !== 'array') bits.push(item.encoding);
    if (item.dtype) bits.push(item.dtype);
    if (item.nnz !== undefined) {
        const dense = densityLabel(item.density);
        bits.push(`${plural(item.nnz, 'stored value', 'stored values')}${dense ? ` (${dense} dense)` : ''}`);
    }
    if (item.columns !== undefined) {
        const names = (item.column_names || []).join(', ');
        bits.push(`${plural(item.columns, 'column', 'columns')}${names ? `: ${names}${item.columns > item.column_names.length ? ', …' : ''}` : ''}`);
    }
    if (item.encoding === 'categorical' && item.categories !== undefined) bits.push(plural(item.categories, 'category', 'categories'));
    if (item.length !== undefined && item.length !== null) bits.push(`length ${item.length.toLocaleString('en-US')}`);
    return bits.join(', ');
}

/** The type of an obs or var column: "categorical, 8 categories, ordered", "integer, int64, nullable", "string". */
export function columnType(column) {
    if (column.kind === 'categorical') {
        const bits = ['categorical'];
        if (column.categories !== undefined) bits.push(plural(column.categories, 'category', 'categories'));
        if (column.ordered) bits.push('ordered');
        if (column.codes_dtype) bits.push(`codes ${column.codes_dtype}`);
        return bits.join(', ');
    }
    const base = column.dtype && column.dtype !== column.kind ? `${column.kind}, ${column.dtype}` : (column.kind || column.dtype || '');
    return column.nullable ? `${base}, nullable` : base;
}

const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOUR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i;
const NAMED_COLOUR = /^[a-z]{3,20}$/i;

/**
 * `text` when it is a plain CSS colour (hex, strict rgb or rgba, or a colour name) and short, else null. Anything with
 * url(), var(), a semicolon or a space is refused, so a colour is only ever set through `style.backgroundColor`.
 */
export function safeColour(text) {
    const value = String(text === undefined || text === null ? '' : text).trim();
    if (!value || value.length > 50) return null;
    if (!HEX_COLOUR.test(value) && !RGB_COLOUR.test(value) && !NAMED_COLOUR.test(value)) return null;
    if (NAMED_COLOUR.test(value) && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', value)) return null;
    return value;
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

function name(doc, text) {
    const bdi = el(doc, 'bdi', null, text);     // a right-to-left name cannot reorder what is around it
    const span = el(doc, 'span', 'dsi-name');
    span.appendChild(bdi);
    return span;
}

/** A colour as a bordered square with its text as the accessible name; a colour that is not plain is "?". */
function swatch(doc, colour) {
    const safe = safeColour(colour);
    const node = el(doc, 'span', safe ? 'dsi-swatch' : 'dsi-swatch dsi-swatch-bad');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', String(colour).slice(0, 100));
    node.title = String(colour).slice(0, 100);
    if (safe) node.style.backgroundColor = safe; else node.textContent = '?';
    return node;
}

/** A table of `rows`; when `items` is given, each row is added to it as a searchable item (see structure-search.js). */
function table(doc, headers, rows, items = null) {
    const t = el(doc, 'table', 'table table-sm dsi-table');
    const head = el(doc, 'thead');
    const tr = el(doc, 'tr');
    for (const h of headers) tr.appendChild(el(doc, 'th', null, h));
    head.appendChild(tr);
    t.appendChild(head);
    const body = el(doc, 'tbody');
    for (const row of rows) {
        const r = el(doc, 'tr');
        const fields = [];
        row.cells.forEach((cell, i) => {
            const c = el(doc, i === 0 ? 'th' : 'td');
            if (i === 0) c.appendChild(name(doc, cell)); else c.textContent = cell;
            fields.push({ el: i === 0 ? c.firstChild.firstChild : c, text: String(cell) });
            r.appendChild(c);
        });
        body.appendChild(r);
        const item = { rows: [r], fields };
        if (items) items.push(item);
        if (row.extra) {
            for (const bdi of row.extra.querySelectorAll('.dsi-label bdi')) fields.push({ el: bdi, text: bdi.textContent });
            const more = el(doc, 'tr', 'dsi-extra');
            const td = el(doc, 'td');
            td.colSpan = headers.length;
            td.appendChild(row.extra);
            more.appendChild(td);
            body.appendChild(more);
            item.rows.push(more);
        }
    }
    t.appendChild(body);
    return t;
}

/** The head of a categorical's labels, each with its colour when the dataset has one, and the colour count against the categories. */
function categoryDetail(doc, column) {
    if (column.kind !== 'categorical') return null;
    const box = el(doc, 'div', 'dsi-labels');
    const labels = column.labels || [];
    labels.forEach((label, i) => {
        const chip = el(doc, 'span', 'dsi-label');
        if (column.label_colors && column.label_colors[i] !== undefined) chip.appendChild(swatch(doc, column.label_colors[i]));
        chip.appendChild(name(doc, label));
        box.appendChild(chip);
    });
    if (labels.length && column.categories > labels.length) box.appendChild(el(doc, 'span', 'dsi-muted', `+${(column.categories - labels.length).toLocaleString('en-US')}`));
    if (column.colors !== undefined && column.colors !== null) {
        if (column.colors_mismatch) {
            const warn = el(doc, 'span', 'dsi-warn', `Mismatch: ${plural(column.colors, 'colour', 'colours')} for ${plural(column.categories, 'category', 'categories')}`);
            warn.setAttribute('role', 'note');
            box.appendChild(warn);
        } else {
            box.appendChild(el(doc, 'span', 'dsi-muted', plural(column.colors, 'colour', 'colours')));
        }
    }
    return box.childNodes.length ? box : null;
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

function unsTree(doc, node, items = null, parent = null, trail = []) {
    const ul = el(doc, 'ul', 'dsi-tree');
    for (const child of node.children || []) {
        const li = el(doc, 'li');
        const label = name(doc, child.name);
        li.appendChild(label);
        const path = [...trail, child.name];
        const item = { rows: [li], fields: [{ el: label.firstChild, text: String(child.name) }], path: path.join('/'), parent };
        if (items) items.push(item);
        const muted = (text) => {
            const span = li.appendChild(el(doc, 'span', 'dsi-muted', text));
            item.fields.push({ el: span, text });
            return span;
        };
        if (child.type === 'group') {
            muted(` group, ${plural(child.total, 'key', 'keys')}`);
            if (child.children && child.children.length) li.appendChild(unsTree(doc, child, items, item, path));
            else if (child.total) muted(' …');
        } else if (child.type === 'encoded') {
            const shape = shapeLabel(child.shape);
            muted(` ${[memberType(child), shape ? `(${shape})` : ''].filter(Boolean).join(' ')}`);
        } else if (child.type === 'array') {
            const shape = shapeLabel(child.shape);
            muted(` ${[child.dtype, shape ? `(${shape})` : 'scalar'].filter(Boolean).join(' ')}`);
            if (child.value !== undefined) {
                li.appendChild(doc.createTextNode(' = '));
                const value = li.appendChild(el(doc, 'span', 'dsi-value', child.value));
                item.fields.push({ el: value, text: String(child.value) });
            }
            if (child.colors) {
                const holder = el(doc, 'span', 'dsi-labels');
                for (const c of child.colors) holder.appendChild(swatch(doc, c));
                li.appendChild(holder);
            }
        } else {
            muted(' unreadable');
        }
        ul.appendChild(li);
    }
    const left = (node.total || 0) - (node.children || []).length;
    if (left > 0 && (node.children || []).length) ul.appendChild(el(doc, 'li', 'dsi-muted', `… and ${left.toLocaleString('en-US')} more`));
    return ul;
}

function capsLine(s) {
    const c = s.caps;
    if (!c) return null;
    const bits = [`${c.columns} columns per table`, `${c.items} keys per slot`, `uns to depth ${c.uns_depth} and ${c.uns_nodes} nodes`,
        `${c.category_labels} labels for the first ${c.label_columns} categorical columns`, `names cut at ${c.label_chars} characters`];
    return `Limits: ${bits.join('; ')}.`;
}

/** Structure: counts, X, obs and var columns, the matrix slots with shapes, raw, the uns tree, unknown groups, and the limits applied. */
export function drawStructure(container, structure, { compact = false } = {}) {
    const doc = container.ownerDocument;
    const s = structure || {};
    const index = [];                    // what the search box filters (structure-search.js)
    let partial = false;
    const track = (details, open) => {
        const entry = { details, open, items: [] };
        index.push(entry);
        return entry.items;
    };
    const count = (n) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('en-US'));
    container.appendChild(el(doc, 'p', 'dsi-summary', `${count(s.n_obs)} observations (cells) × ${count(s.n_vars)} variables (genes)`));
    const x = el(doc, 'p', 'dsi-x');
    x.append(el(doc, 'strong', null, 'X '));
    x.append(doc.createTextNode(s.X ? [shapeLabel(s.X.shape), memberType(s.X)].filter(Boolean).join(', ') : 'none'));
    container.appendChild(x);
    if (s.capped === 'deadline') {
        const cut = el(doc, 'p', 'dsi-warn dsi-cut', `Reading was cut off after ${(s.caps && s.caps.remote_budget_s) || 'a few'} s because the store is slow to answer; items below are missing.`);
        cut.setAttribute('role', 'note');
        container.appendChild(cut);
    }
    for (const [key, label] of [['obs', 'obs: cell annotations'], ['var', 'var: gene annotations']]) {
        const t = s[key] || { columns: [], total: 0 };
        const d = section(doc, label, t.total, !compact && t.total <= 40);
        d.dataset.section = key;
        if (t.index) d.appendChild(el(doc, 'p', 'dsi-note', `Index: ${t.index}${t.index_dtype ? `, ${t.index_dtype}` : ''}`));
        const items = track(d, d.open);
        if (t.columns.length) d.appendChild(table(doc, ['Column', 'Type'], t.columns.map((c) => ({ cells: [c.name, columnType(c)], extra: categoryDetail(doc, c) })), items));
        else d.appendChild(el(doc, 'p', 'dsi-muted', 'No columns.'));
        const note = more(doc, t.columns.length, t.total);
        if (note) { d.appendChild(note); partial = true; }
        container.appendChild(d);
    }
    for (const [slot, label] of [['obsm', 'obsm: cell embeddings'], ['varm', 'varm: gene matrices'], ['obsp', 'obsp: cell-cell graphs'],
        ['varp', 'varp: gene-gene matrices'], ['layers', 'layers']]) {
        const t = s[slot];
        if (!t || !t.total) continue;
        const d = section(doc, label, t.total, !compact);
        d.dataset.section = slot;
        d.appendChild(table(doc, ['Key', 'Shape', 'Type'], t.items.map((i) => ({ cells: [i.name, shapeLabel(i.shape), memberType(i)] })), track(d, d.open)));
        const note = more(doc, t.items.length, t.total);
        if (note) { d.appendChild(note); partial = true; }
        container.appendChild(d);
    }
    if (s.raw) {
        const d = section(doc, 'raw: not shown in plots', undefined, false);
        d.dataset.section = 'raw';
        const bits = [];
        if (s.raw.X) bits.push(`X ${[shapeLabel(s.raw.X.shape), memberType(s.raw.X)].filter(Boolean).join(', ')}`);
        bits.push(plural(s.raw.var_columns || 0, 'var column', 'var columns'));
        if (s.raw.varm_keys && s.raw.varm_keys.length) bits.push(`varm: ${s.raw.varm_keys.join(', ')}`);
        const line = d.appendChild(el(doc, 'p', null, bits.join('; ')));
        track(d, d.open).push({ rows: [], fields: [{ el: line, text: bits.join('; ') }] });
        d.appendChild(el(doc, 'p', 'dsi-note', 'AnnZarro plots the genes of X, not of raw.'));
        container.appendChild(d);
    }
    const uns = s.uns || { children: [], total: 0 };
    const d = section(doc, 'uns: unstructured', uns.total, !compact && uns.total <= 40);
    d.dataset.section = 'uns';
    const unsItems = track(d, d.open);
    if (uns.children && uns.children.length) d.appendChild(unsTree(doc, uns, unsItems));
    else d.appendChild(el(doc, 'p', 'dsi-muted', 'Empty.'));
    if (uns.capped) { d.appendChild(el(doc, 'p', 'dsi-note', 'The tree is cut here; the dataset has more.')); partial = true; }
    container.appendChild(d);
    if (s.other && s.other.length) {
        const o = section(doc, 'other groups', s.other.length, true);
        o.dataset.section = 'other';
        o.appendChild(table(doc, ['Name', 'Type'], s.other.map((g) => ({ cells: [g.name, g.encoding] })), track(o, o.open)));
        container.appendChild(o);
    }
    const caps = capsLine(s);
    if (caps) container.appendChild(el(doc, 'p', 'dsi-note dsi-caps', caps));
    if (!compact) mountStructureSearch(container, index, { partial });
}
