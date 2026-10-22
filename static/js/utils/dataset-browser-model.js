/**
 * The logic of the dataset browser (static/js/utils/dataset-browser.js),
 * apart from the DOM: what a table row says, how rows are filtered and sorted,
 * the places the browser offers, the breadcrumb, and the choices the page makes
 * with the recently opened list (which dataset to open at start, what the
 * open panels use that another dataset lacks).
 *
 * A row is a listing entry: `{kind: 'folder'|'store', path, name, rel_path?,
 * cells?, genes?, format?, modified?, is_link?, error?, match?, openedAt?}`.
 * Pure functions, so they run under `node --test`.
 */

import { compileQuery, searchParts, splitByRanges } from './dataset-picker.js';

// ---- what a row says ---------------------------------------------------------------------

/** A format as the table shows it: "zarr v2", "zarr v3", "zarr v3 sharded", "h5ad". */
export function formatLabel(format) {
    if (!format) return '';
    const text = String(format);
    if (text === 'h5ad') return 'h5ad';
    const m = /^zarr format (\d)(, sharded)?$/.exec(text);
    if (m) return `zarr v${m[1]}${m[2] ? ' sharded' : ''}`;
    return text;
}

/** The filter chip a format belongs to: `h5ad`, `zarr2`, `zarr3` or `sharded` (null when unknown). */
export function formatKey(format) {
    const text = String(format || '');
    if (text === 'h5ad') return 'h5ad';
    if (/sharded/.test(text)) return 'sharded';
    if (/format 3/.test(text)) return 'zarr3';
    if (/format 2/.test(text)) return 'zarr2';
    return null;
}

export const FORMAT_CHIPS = [
    { key: 'h5ad', label: 'h5ad' },
    { key: 'zarr2', label: 'zarr v2' },
    { key: 'zarr3', label: 'zarr v3' },
    { key: 'sharded', label: 'sharded' }
];

export const CELL_BANDS = [
    { key: 'lt100k', label: '< 100k cells', test: n => n < 100_000 },
    { key: '100k-1m', label: '100k to 1M', test: n => n >= 100_000 && n < 1_000_000 },
    { key: '1m-10m', label: '1M to 10M', test: n => n >= 1_000_000 && n < 10_000_000 },
    { key: 'gt10m', label: '> 10M cells', test: n => n >= 10_000_000 }
];

export const MODIFIED_BANDS = [
    { key: 'week', label: 'Past week', seconds: 7 * 86400 },
    { key: 'month', label: 'Past month', seconds: 31 * 86400 },
    { key: 'year', label: 'Past year', seconds: 366 * 86400 }
];

/** A count with thousands separators ("8,090"), '' when it is not known. */
export function countLabel(n) {
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '';
}

const pad = n => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of seconds since the epoch ('' when not known). */
export function dateLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const d = new Date(seconds * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD HH:MM` of seconds since the epoch ('' when not known). */
export function dateTimeLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const d = new Date(seconds * 1000);
    return `${dateLabel(seconds)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** When a dataset was last opened, from the recents' `openedAt` (milliseconds; 0 = not known). */
export function openedLabel(openedAt) {
    return Number.isFinite(openedAt) && openedAt > 0 ? dateLabel(openedAt / 1000) : '';
}

/** What the match against the open view (or the view without data) is called in a row, '' for none. */
export function matchBadge(entry) {
    switch (entry && entry.match) {
        case 'same': case 'fields': return 'same cells and genes';
        case 'counts': return 'same size';
        case 'name-different': return 'same name, other size';
        case 'name': return 'same name';
        default: return '';
    }
}

/** The chip that keeps the stores like the view's dataset, and what it says it does. */
export const MATCH_CHIP = {
    label: "Like this view's dataset",
    title: 'Only datasets with the same cells and genes, the same size, or the same name as the dataset this view was made on'
};

/** Whether the entry matches the view at all (the MATCH_CHIP chip). */
export function matchesView(entry) {
    return !!matchBadge(entry);
}

/** The sentence a screen reader gets for a row: name, counts, format, modified, match, why it is unreadable. */
export function rowDescription(entry) {
    if (entry.kind === 'folder') return entry.is_link ? 'folder, link' : 'folder';
    const bits = [];
    if (Number.isFinite(entry.cells)) bits.push(`${countLabel(entry.cells)} cells`);
    if (Number.isFinite(entry.genes)) bits.push(`${countLabel(entry.genes)} genes`);
    if (entry.format) bits.push(formatLabel(entry.format));
    if (entry.modified) bits.push(`modified ${dateLabel(entry.modified)}`);
    if (entry.openedAt) bits.push(`opened ${openedLabel(entry.openedAt)}`);
    const badge = matchBadge(entry);
    if (badge) bits.push(badge);
    if (entry.error) bits.push(`cannot be opened: ${entry.error}`);
    return bits.join(', ');
}

export function isRemote(path) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(path || ''));
}

// ---- filtering and sorting ---------------------------------------------------------------

/**
 * @typedef {Object} Filters
 * @property {Set<string>} formats - FORMAT_CHIPS keys (any of)
 * @property {Set<string>} cells - CELL_BANDS keys (any of)
 * @property {string} modified - a MODIFIED_BANDS key, or ''
 * @property {boolean} matches - only what matches the view
 * @property {boolean} unreadable - show the stores that cannot be opened
 */
export function emptyFilters() {
    return { formats: new Set(), cells: new Set(), modified: '', matches: false, unreadable: true };
}

/** Whether any chip narrows the rows (unreadable shown is the default, so not a narrowing). */
export function filtersActive(filters) {
    return filters.formats.size > 0 || filters.cells.size > 0 || !!filters.modified || filters.matches;
}

/**
 * The rows that pass the chips. Folders are not narrowed by the format, cell
 * count or date (they have none), but they are by the view match. A store whose
 * value is not known passes no chip that asks for that value.
 * @param {Array} rows
 * @param {Filters} filters
 * @param {number} [now] - seconds since the epoch
 */
export function applyFilters(rows, filters, now = Date.now() / 1000) {
    const band = MODIFIED_BANDS.find(b => b.key === filters.modified);
    return rows.filter(row => {
        if (row.kind === 'folder') return !filters.matches;
        if (!filters.unreadable && row.error) return false;
        if (filters.matches && !matchesView(row)) return false;
        if (filters.formats.size && !filters.formats.has(formatKey(row.format))) return false;
        if (filters.cells.size) {
            if (!Number.isFinite(row.cells)) return false;
            if (![...filters.cells].some(key => CELL_BANDS.find(b => b.key === key).test(row.cells))) return false;
        }
        if (band && !(Number.isFinite(row.modified) && now - row.modified <= band.seconds)) return false;
        return true;
    });
}

/** Rows whose name or relative path matches the query (all when empty or invalid). */
export function searchRows(rows, query, { regex = false } = {}) {
    const compiled = compileQuery(query, { regex });
    if (compiled.empty || compiled.error) return { rows: rows.slice(), compiled };
    const kept = rows.filter(row => {
        const { name, rel } = searchParts(row);
        return compiled.test(name) || (!!rel && compiled.test(rel));
    });
    return { rows: kept, compiled };
}

export const COLUMNS = [
    { key: 'name', label: 'Name', numeric: false },
    { key: 'cells', label: 'Cells', numeric: true },
    { key: 'genes', label: 'Genes', numeric: true },
    { key: 'format', label: 'Format', numeric: false },
    { key: 'modified', label: 'Modified', numeric: false },
    { key: 'opened', label: 'Last opened', numeric: false }
];

/** The columns the server sorts (a stat is enough); the others sort the rows loaded. */
export const SERVER_SORTS = ['name', 'modified'];

const byName = (a, b) => String(a.name || a.path).localeCompare(String(b.name || b.path), undefined, { numeric: true, sensitivity: 'base' });

function value(row, key) {
    switch (key) {
        case 'name': return String(row.name || row.path).toLowerCase();
        case 'cells': return row.cells;
        case 'genes': return row.genes;
        case 'format': return row.format ? formatLabel(row.format) : null;
        case 'modified': return row.modified;
        case 'opened': return row.openedAt || null;
        default: return null;
    }
}

/**
 * A new array in the order asked. Folders come first and stores that cannot be
 * opened last, whatever the column and direction; a row without a value for the
 * column goes after those with one. `key` null keeps the order given (relevance).
 * @param {Array} rows
 * @param {string|null} key - a COLUMNS key
 * @param {'asc'|'desc'} [dir]
 */
export function sortRows(rows, key, dir = 'asc') {
    const sign = dir === 'desc' ? -1 : 1;
    const rank = row => (row.kind === 'folder' ? 0 : row.error ? 2 : 1);
    const list = rows.map((row, i) => ({ row, i }));
    list.sort((x, y) => {
        const a = x.row, b = y.row;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (key) {
            const va = value(a, key), vb = value(b, key);
            const missA = va === null || va === undefined, missB = vb === null || vb === undefined;
            if (missA !== missB) return missA ? 1 : -1;
            if (!missA) {
                const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
                if (c) return c * sign;
            }
            const n = byName(a, b);
            if (n) return key === 'name' ? n * sign : n;
        }
        return x.i - y.i;
    });
    return list.map(x => x.row);
}

/** The value of `aria-sort` for a column header. */
export function ariaSort(sort, key) {
    return sort && sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none';
}

/** A column's next sort when its header is pressed: first ascending (numbers and dates: largest/newest first), then reversed. */
export function nextSort(sort, key) {
    const firstDir = ['cells', 'genes', 'modified', 'opened'].includes(key) ? 'desc' : 'asc';
    if (sort && sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
    return { key, dir: firstDir };
}

/** Finder-style type-ahead: the index of the first row after `from` whose name starts with `buffer` (case-insensitive), else -1. */
export function typeAheadIndex(rows, buffer, from = -1) {
    const needle = String(buffer || '').toLowerCase();
    if (!needle) return -1;
    const n = rows.length;
    // a repeated single letter cycles through the names that start with it
    const start = needle.length === 1 || from < 0 ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (String(rows[i].name || '').toLowerCase().startsWith(needle)) return i;
    }
    return -1;
}

// ---- places and the breadcrumb ------------------------------------------------------------

/**
 * The places of the left column.
 * @param {Object} o
 * @param {Object|null} o.me - auth/me
 * @param {Array} o.rootEntries - the first page of the root listing (admin roots and granted folders are among it)
 * @returns {Array<{id: string, label: string, kind: 'recent'|'pinned'|'folder'|'remote', folder?: string, group: string, title?: string}>}
 */
export function buildPlaces({ me, rootEntries = [] }) {
    const restricted = !!(me && me.restricted);
    const places = [
        { id: 'recent', label: 'Recent', kind: 'recent', group: 'quick' },
        { id: 'pinned', label: 'Pinned', kind: 'pinned', group: 'quick' },
        { id: 'root', label: restricted ? 'Your datasets' : 'Data directory', kind: 'folder', folder: '', group: 'roots' }
    ];
    for (const entry of rootEntries) {
        // admin data roots lie outside the data directory; a restricted user's granted folders are their roots
        if (entry.kind === 'folder' && (entry.admin_root || restricted)) {
            places.push({ id: `folder:${entry.path}`, label: entry.name, kind: 'folder', folder: entry.path, group: 'roots', title: restricted ? entry.name : entry.path });
        }
    }
    if (me && me.remote_stores) places.push({ id: 'remote', label: 'Remote', kind: 'remote', group: 'remote' });
    return places;
}

/**
 * The breadcrumb of a folder listing: the place's root, then each folder below it.
 * @param {Object} o
 * @param {string} o.rootLabel - the place's name
 * @param {string} o.rootPath - the folder the place starts at ('' for the data directory)
 * @param {string} o.folder - the folder shown (absolute; '' for the root listing)
 * @param {string} [o.rel] - its path relative to the data directory (the listing's `rel_path`)
 * @returns {Array<{label: string, path: string}>}
 */
export function breadcrumbs({ rootLabel, rootPath = '', folder = '', rel = '' }) {
    const crumbs = [{ label: rootLabel, path: rootPath }];
    if (!folder || folder === rootPath) return crumbs;
    const segments = String(rel || '').split('/').filter(s => s && s !== '.');
    if (!segments.length && !rootPath) return crumbs;     // the data directory itself
    const sane = segments.length && !segments.includes('..') && !String(rel).startsWith('/');
    if (sane && !rootPath && String(folder).endsWith(String(rel).replace(/\/+$/, ''))) {
        // below the data directory: every segment is a folder one can go back to
        const base = String(folder).slice(0, String(folder).length - String(rel).replace(/\/+$/, '').length).replace(/\/+$/, '');
        segments.forEach((segment, i) => crumbs.push({ label: segment, path: `${base}/${segments.slice(0, i + 1).join('/')}` }));
        return crumbs;
    }
    if (rootPath && String(folder).startsWith(rootPath.replace(/\/+$/, '') + '/')) {
        const below = String(folder).slice(rootPath.replace(/\/+$/, '').length + 1).split('/').filter(Boolean);
        below.forEach((segment, i) => crumbs.push({ label: segment, path: `${rootPath.replace(/\/+$/, '')}/${below.slice(0, i + 1).join('/')}` }));
        return crumbs;
    }
    const last = String(folder).replace(/\/+$/, '').split('/').pop();
    crumbs.push({ label: last || folder, path: folder });
    return crumbs;
}

// ---- the choices made with the recents -----------------------------------------------------

/**
 * The dataset to open at start when nothing else was asked: the most recent one
 * the server says this user may read, else the only dataset of the listing, else
 * none (the welcome screen).
 * @param {Array<Object>} recents - lookup entries of the recents, newest first (unavailable ones carry `error`)
 * @param {Array<Object>} listing - the dataset listing
 * @returns {string|null}
 */
export function firstDatasetChoice(recents, listing) {
    const recent = (recents || []).find(r => r && r.path && !r.error && r.status !== 'unavailable' && r.status !== 'unchecked');
    if (recent) return recent.path;
    const readable = (listing || []).filter(d => d && d.path && !d.error);
    return readable.length === 1 && (listing || []).length === 1 ? readable[0].path : null;
}

function* strings(value, depth = 0) {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') { yield value; return; }
    if (Array.isArray(value)) { for (const v of value) yield* strings(v, depth + 1); return; }
    if (typeof value === 'object') { for (const v of Object.values(value)) yield* strings(v, depth + 1); }
}

/**
 * The keys of the open dataset (obs columns, obsm keys, layers) that the open
 * panels name in their settings. A panel setting is any string in its config;
 * a string counts when it is a key the dataset has.
 * @param {Object} panelConfigs - `{panelId: config}` (PanelManager.saveLayout().panelConfigs)
 * @param {Object|null} structure - /data/dataset_structure of the open dataset
 * @returns {Array<{key: string, kind: 'obs'|'obsm'|'layer'}>}
 */
export function keysUsedByPanels(panelConfigs, structure) {
    if (!panelConfigs || !structure) return [];
    const have = new Map();
    const add = (list, kind) => { for (const k of (Array.isArray(list) ? list : [])) if (typeof k === 'string' && !have.has(k)) have.set(k, kind); };
    add(structure.obs && structure.obs.columns, 'obs');
    add(Array.isArray(structure.obsm && structure.obsm.keys) ? structure.obsm.keys : Object.keys((structure.obsm && structure.obsm.keys) || {}), 'obsm');
    add(structure.layers && ((structure.layers.details && structure.layers.details.keys) || structure.layers.keys), 'layer');
    const used = new Map();
    for (const config of Object.values(panelConfigs)) {
        for (const s of strings(config)) if (have.has(s) && !used.has(s)) used.set(s, have.get(s));
    }
    return [...used].map(([key, kind]) => ({ key, kind }));
}

/**
 * Of the keys the open panels use, those the target dataset lacks, from its
 * `/datasets/details` (lists are capped at 500: a longer list is not judged).
 * @returns {Array<{key: string, kind: string}>}
 */
export function missingKeys(used, details) {
    if (!details || !details.readable || details.remote) return [];
    const names = list => new Set((list || []).map(c => (typeof c === 'string' ? c : c.name)));
    const lists = {
        obs: [names(details.obs_columns), details.obs_columns_total, (details.obs_columns || []).length],
        obsm: [names(details.obsm_keys), details.obsm_total, (details.obsm_keys || []).length],
        layer: [names(details.layers_keys), details.layers_total, (details.layers_keys || []).length]
    };
    return used.filter(({ key, kind }) => {
        const [set, total, shown] = lists[kind] || [new Set(), 0, 0];
        if (Number.isFinite(total) && total > shown) return false;     // cut off: do not claim it is missing
        return !set.has(key);
    });
}

/** The sentence for the live region under the table. */
export function countSummary({ stores, folders, query, truncated = false, sortedAmong = null }) {
    const parts = [];
    const s = `${stores} dataset${stores === 1 ? '' : 's'}`;
    parts.push(folders ? `${s} and ${folders} folder${folders === 1 ? '' : 's'}` : s);
    let text = parts[0] + (query ? ` match '${query}'` : '');
    if (truncated) text += `; the search stopped at its limit`;
    if (sortedAmong) text += `; sorted among ${sortedAmong} loaded`;
    return text;
}

// ---- searching the descriptions ------------------------------------------------------------
//
// The server's text search (`GET /datasets/text-search`) answers `{results, more, partial, index}` (`more`: matches after this page); a result is a
// listing entry plus `title`, `score`, `matched` and `snippet: {field, text, highlights}`, with the highlights
// as `[start, end]` offsets in UTF-16 code units, which are the indices of a JavaScript string.

export const TEXT_SECTION = 'Found in titles, attribution and READMEs';

/**
 * A snippet as pieces to set with `textContent`: `[{text, hit}]`. The offsets are the server's; any that
 * lie outside the text, overlap, or cut a surrogate pair are repaired or dropped, so a bad answer cannot
 * break the line.
 */
export function snippetParts(snippet) {
    const text = snippet && typeof snippet.text === 'string' ? snippet.text : '';
    if (!text) return [];
    const ranges = [];
    const whole = i => i > 0 && i < text.length && /[\uDC00-\uDFFF]/.test(text[i]) && /[\uD800-\uDBFF]/.test(text[i - 1]);
    for (const pair of (snippet && Array.isArray(snippet.highlights) ? snippet.highlights : [])) {
        if (!Array.isArray(pair)) continue;
        let [from, to] = pair;
        if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
        from = Math.max(0, from);
        to = Math.min(text.length, to);
        if (whole(from)) from--;
        if (whole(to)) to++;
        if (to > from) ranges.push([from, to]);
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]);
    }
    return splitByRanges(text, merged);
}

/** What identifies a hit: its path, else (a path the server did not send) its relative path. */
const hitKey = hit => hit.path || hit.rel_path || '';

/**
 * The text hits to list under the name matches: listing-entry rows marked `textHit`, without the stores the
 * name matches already show (a store found both ways appears once, among the names).
 * @param {Array} nameRows - the rows the name search gave
 * @param {Array} hits - the server's `results`
 */
export function textRows(nameRows, hits) {
    const have = new Set(nameRows.map(r => r.path));
    const seen = new Set();
    const out = [];
    for (const hit of Array.isArray(hits) ? hits : []) {
        const key = hitKey(hit);
        if (!key || have.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...hit, path: hit.path || key, kind: 'store', textHit: true, matched: Array.isArray(hit.matched) ? hit.matched : [] });
    }
    return out;
}

/**
 * The description section's rows: the hits not already among the name matches, each marked with its
 * match to the view (`annotate`, as the listed rows are), passed through the chips except the match chip.
 * The words were found in the dataset's own text, so a hit is shown whether or not it is like the view's
 * dataset; its badge says when it is.
 */
export function textSection(nameRows, hits, filters, annotate = row => row) {
    return applyFilters(textRows(nameRows, hits).map(annotate), { ...filters, matches: false });
}

/** The query as the terms the server searches for: words and "quoted phrases". */
export function queryTerms(query) {
    const terms = [];
    for (const m of String(query || '').matchAll(/"([^"]*)"|(\S+)/g)) {
        const term = (m[1] !== undefined ? m[1] : m[2]).trim();
        if (term) terms.push(term);
    }
    return terms;
}

/** Fold a text for matching: no case, no accents (NFKD), as the server compares. */
function fold(text) {
    return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * Where the terms occur in `text`: merged `[start, end]` offsets into `text` (UTF-16), matched case- and
 * accent-insensitively. Used to mark the first hit in a README the server already found.
 */
export function termRanges(text, terms) {
    const source = String(text || '');
    const wanted = (terms || []).map(t => fold(String(t))).filter(Boolean);
    if (!source || !wanted.length) return [];
    let folded = '';
    const back = [];           // folded index -> index of its character in the source
    for (let i = 0; i < source.length;) {
        const cp = source.codePointAt(i);
        const width = cp > 0xFFFF ? 2 : 1;
        const piece = fold(source.slice(i, i + width));
        for (let k = 0; k < piece.length; k++) back.push(i);
        folded += piece;
        i += width;
    }
    const found = [];
    for (const term of wanted) {
        for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
            const start = back[at];
            const lastChar = back[at + term.length - 1];
            const end = lastChar + (source.codePointAt(lastChar) > 0xFFFF ? 2 : 1);
            found.push([start, end]);
        }
    }
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const r of found) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r);
    }
    return merged;
}

/**
 * The one line under the search field about the description index, from the `index` object of an answer: null
 * when every dataset is searched (or the server said nothing), else how far it is. The counts are only there
 * for an unrestricted user (`searched`, `total`); `capped` says the server's size limit leaves datasets out.
 * There is no polling: the next query shows the newer state.
 * @returns {string|null}
 */
export function indexLine(index) {
    if (!index || index.complete !== false) return null;
    const searched = Number.isFinite(index.searched) ? index.searched : null;
    const total = Number.isFinite(index.total) && index.total > 0 ? index.total : null;
    if (index.capped) {
        return searched !== null ? `Descriptions of ${countLabel(searched)} datasets searched; the server's limit leaves out the rest` : 'Descriptions of some datasets are not searched; the server\'s limit leaves them out';
    }
    if (searched !== null && total !== null) return `Descriptions of ${countLabel(Math.min(searched, total))} of ${countLabel(total)} datasets searched so far`;
    return 'Descriptions of some datasets are not searched yet';
}

/** The label of the button that loads the next page of description hits (`more` is the server's count). */
export function moreLabel(more) {
    return Number.isFinite(more) && more > 0 ? `${countLabel(more)} more` : '';
}
