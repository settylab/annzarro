/**
 * What the dataset browser (utils/dataset-browser.js) shares with the rest of the page, apart from the DOM:
 * compiling a search (substring, or a regular expression like the Focused Cell / Gene pickers' ".*" toggle) and
 * where it matches, and what the typed-path field says to each kind of user. Rows, filters and sorting are
 * in dataset-browser-model.js.
 *
 * An entry is a listing entry: {path, name?, rel_path?, cells?, genes?,
 * format?, modified?, is_link?, error?, match?}.
 */

/** Recently opened datasets the browser lists (the page keeps more). */
export const RECENT_LIMIT = 50;

/** What an entry is searched by: its name, and its path relative to the data directory (each on its own, so ^ and $ anchor one of them). */
export function searchParts(entry) {
    const name = entry.name || basename(entry.path);
    return { name, rel: entry.rel_path || '' };
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

/**
 * What the typed-path field of the picker says, by what this user can open:
 * a user confined to the data directory, an admin of a shared server, or
 * anyone on a local server; a remote store URL only where remote stores work
 * (`me.remote_stores`, from auth/me). The server's refusal stays the safety net.
 * @param {{auth_enabled?: boolean, is_admin?: boolean, may_open_any_path?: boolean, remote_stores?: boolean, restricted?: boolean}|null} me
 */
export function pathFieldWording(me) {
    const m = me || {};
    const url = !!m.remote_stores;
    if (m.restricted) {
        // a restricted user opens what they were given: the server answers anything else as not found
        return {
            label: url ? 'Open a dataset shared with you, or a remote store URL' : 'Open a dataset shared with you',
            placeholder: url ? 'name of a shared dataset or https://\u2026' : 'name of a shared dataset'
        };
    }
    if (!m.may_open_any_path) {
        return {
            label: url ? 'Open a path in the data directory, or a remote store URL' : 'Open a path in the data directory',
            placeholder: url ? 'projects/liver/sample.zarr or https://\u2026' : 'projects/liver/sample.zarr'
        };
    }
    const admin = !!(m.auth_enabled && m.is_admin);
    return {
        label: (admin ? 'Open any path on this server' : 'Open any path') + (url ? ', or a remote store URL' : '') + (admin ? ' (admin)' : ''),
        placeholder: url ? 'name in the data directory, a full path, or https://\u2026' : 'name in the data directory, or a full path'
    };
}
