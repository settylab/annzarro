/**
 * The logic of the dataset picker (#change-dataset-modal), apart from the
 * DOM: searching entries by name and relative path (substring, or a regular
 * expression like the Focused Cell / Gene pickers' ".*" toggle), sorting,
 * the "Recently opened" list, grouping, and the labels a row shows.
 *
 * An entry is a listing entry: {path, name?, rel_path?, cells?, genes?,
 * format?, modified?, is_link?, error?, match?}.
 */

export const RECENT_LIMIT = 8;
export const RECENT_KEY_PREFIX = 'annzarro.recentDatasets:';

/** What an entry is searched by: its name, and its path relative to the data directory (each on its own, so ^ and $ anchor one of them). */
export function searchParts(entry) {
    const name = entry.name || basename(entry.path);
    return { name, rel: entry.rel_path || '' };
}

/** The folder part of an entry's relative path, with its trailing slash ('' for a store at the top). */
export function folderOf(entry) {
    const rel = entry.rel_path || '';
    const at = rel.lastIndexOf('/');
    return at > 0 ? rel.slice(0, at + 1) : '';
}

/**
 * How a path is shown everywhere: relative to the data directory. `listing`
 * is the entries of the picker; a path it lacks (outside the data directory,
 * a remote URL) is shown as it is.
 */
export function displayPath(path, listing = [], known = null) {
    const hit = (listing || []).find(e => e.path === path);
    if (hit && hit.rel_path) return hit.rel_path;
    if (known && known.relPath) return known.relPath;
    return path || '';
}

export function basename(path) {
    return String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

/**
 * Compile a query. An empty query matches everything; an invalid regular
 * expression is an `error` (shown beside the field), never a throw.
 * @returns {{test: (text:string) => boolean, ranges: (text:string) => Array<[number, number]>, error: string|null, empty: boolean}}
 */
export function compileQuery(query, { regex = false } = {}) {
    const q = String(query || '');
    if (!q) return { test: () => true, ranges: () => [], error: null, empty: true };
    let re;
    try {
        re = regex ? new RegExp(q, 'gi') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    } catch (e) {
        return { test: () => true, ranges: () => [], error: `Invalid regular expression: ${e.message}`, empty: false };
    }
    const ranges = (text) => {
        const out = [];
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[0] === '') { re.lastIndex++; continue; }   // a zero-length match highlights nothing
            out.push([m.index, m.index + m[0].length]);
        }
        return out;
    };
    return { test: (text) => ranges(text).length > 0, ranges, error: null, empty: false };
}

export function entryMatches(compiled, entry) {
    const { name, rel } = searchParts(entry);
    return compiled.test(name) || (!!rel && compiled.test(rel));
}

/** Entries matching the query (all of them when it is empty or invalid), with the compiled query. */
export function searchEntries(entries, query, { regex = false } = {}) {
    const compiled = compileQuery(query, { regex });
    if (compiled.empty || compiled.error) return { entries: entries.slice(), ...compiled };
    return { entries: entries.filter(e => entryMatches(compiled, e)), ...compiled };
}

export const SORTS = ['best', 'name', 'cells', 'modified'];

/** A new array in the order asked: 'best' keeps the order given; cells and modified put the largest and newest first. */
export function sortEntries(entries, key) {
    const list = entries.slice();
    const byName = (a, b) => String(a.name || a.path).localeCompare(String(b.name || b.path), undefined, { numeric: true, sensitivity: 'base' });
    if (key === 'name') return list.sort(byName);
    if (key === 'cells') return list.sort((a, b) => (b.cells ?? -1) - (a.cells ?? -1) || byName(a, b));
    if (key === 'modified') return list.sort((a, b) => (b.modified ?? -1) - (a.modified ?? -1) || byName(a, b));
    return list;
}

// ---- recently opened ------------------------------------------------------------

function recentKey(serverKey) { return RECENT_KEY_PREFIX + (serverKey || ''); }

/** The recent paths for a server, newest first; [] when storage is missing or broken. */
export function loadRecents(storage, serverKey) {
    try {
        const parsed = JSON.parse(storage.getItem(recentKey(serverKey)) || '[]');
        return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string' && p).slice(0, RECENT_LIMIT) : [];
    } catch (e) {
        return [];
    }
}

/** Put `path` first in the server's recents (the last RECENT_LIMIT are kept); returns the new list. Never throws. */
export function pushRecent(storage, serverKey, path) {
    if (!path) return loadRecents(storage, serverKey);
    const next = [path, ...loadRecents(storage, serverKey).filter(p => p !== path)].slice(0, RECENT_LIMIT);
    try { storage.setItem(recentKey(serverKey), JSON.stringify(next)); } catch (e) { /* storage full or blocked */ }
    return next;
}

// ---- groups -----------------------------------------------------------------------

const MATCH_GROUPS = [
    ['Same cells and genes', e => e.match === 'same' || e.match === 'fields'],
    ['Same size (cell and gene names not compared yet)', e => e.match === 'counts'],
    ['Same name, other cells or genes', e => e.match === 'name-different'],
    ['Same name', e => e.match === 'name']
];

/**
 * The groups of the picker, in order: "Recently opened" first, then the
 * match groups relative to the saved store (when `relative`) and the rest.
 * A store shows once: a recent one only under "Recently opened". An entry
 * with `error` goes last, in "Cannot be opened".
 * @param {Array} entries - listing entries with `match` (orderCandidates)
 * @param {{recents?: string[], otherTitle?: string}} [opts]
 * @returns {Array<{title: string, key: string, entries: Array}>} non-empty groups only
 */
export function buildGroups(entries, { recents = [], otherTitle = 'Other datasets in the data directory' } = {}) {
    const groups = [];
    const readable = entries.filter(e => !e.error);
    const byPath = new Map(readable.map(e => [e.path, e]));
    const recent = recents.map(p => byPath.get(p)).filter(Boolean);
    const taken = new Set(recent.map(e => e.path));
    if (recent.length) groups.push({ title: 'Recently opened', key: 'recent', entries: recent });
    const rest = readable.filter(e => !taken.has(e.path));
    for (const [title, test] of MATCH_GROUPS) {
        const members = rest.filter(test);
        if (members.length) groups.push({ title, key: title, entries: members });
    }
    const other = rest.filter(e => !MATCH_GROUPS.some(([, test]) => test(e)));
    if (other.length) groups.push({ title: otherTitle, key: 'other', entries: other });
    const broken = entries.filter(e => e.error);
    if (broken.length) groups.push({ title: 'Cannot be opened', key: 'errors', entries: broken });
    return groups;
}

/**
 * Cut groups to at most `limit` rows in all (the picker renders in pages so
 * 2,000 entries stay smooth). Returns the shown groups and how many rows remain.
 */
export function pageGroups(groups, limit) {
    let left = limit;
    let total = 0;
    let shownCount = 0;
    const shown = [];
    for (const g of groups) {
        total += g.entries.length;
        if (left <= 0) continue;
        const take = g.entries.slice(0, left);
        left -= take.length;
        shownCount += take.length;
        shown.push({ ...g, entries: take });
    }
    return { groups: shown, remaining: total - shownCount };
}

// ---- labels ---------------------------------------------------------------------------

export function countsLabel(entry) {
    return Number.isFinite(entry.cells) && Number.isFinite(entry.genes)
        ? `${entry.cells.toLocaleString('en-US')} cells x ${entry.genes.toLocaleString('en-US')} genes` : '';
}

export function modifiedLabel(entry) {
    if (!Number.isFinite(entry.modified)) return '';
    const d = new Date(entry.modified * 1000);
    return `modified ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Split `text` into [{text, hit}] by the given ranges (for highlighting). */
export function splitByRanges(text, ranges) {
    const parts = [];
    let at = 0;
    for (const [from, to] of ranges) {
        if (from < at) continue;
        if (from > at) parts.push({ text: text.slice(at, from), hit: false });
        parts.push({ text: text.slice(from, to), hit: true });
        at = to;
    }
    if (at < text.length) parts.push({ text: text.slice(at), hit: false });
    return parts;
}
