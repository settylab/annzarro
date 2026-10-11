/**
 * How a dataset path is labelled: relative to the data directory, the
 * absolute path being the tooltip. A path outside the data directory (an
 * admin's open, a remote URL) has no relative form and is shown as it is.
 *
 * The browser is never told the data directory, but every listed store says
 * where it is (`path`) and where it is relative to it (`rel_path`), which
 * gives the directory's prefix.
 */

/** The data directory's absolute path, from any listing entry; null when none says. */
export function dataDirOf(listing) {
    for (const entry of listing || []) {
        const { path, rel_path: rel } = entry || {};
        if (path && rel && path.endsWith(rel) && path.length > rel.length) {
            return path.slice(0, path.length - rel.length).replace(/[\\/]+$/, '');
        }
    }
    return null;
}

/**
 * The label of `path`: its path relative to the data directory when that is
 * known, else `path` itself.
 * @param {string} path
 * @param {Array<{path: string, rel_path?: string}>} listing - the dataset listing
 * @param {{relPath?: string|null}|null} [known] - what the server said of this store (probe)
 */
export function datasetLabel(path, listing = [], known = null) {
    if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path || '';
    const listed = (listing || []).find(e => e && e.path === path);
    if (listed && listed.rel_path) return listed.rel_path;
    if (known && known.relPath) return known.relPath;
    const dir = dataDirOf(listing);
    if (dir && path.startsWith(dir + '/')) return path.slice(dir.length + 1);
    return path;
}

export const TAIL_CHARS = 16;
const ELLIPSIS = '\u2026';

/** `name` cut in the middle to fit `room`, keeping its start and its last TAIL_CHARS; null when not even 5 characters of the start fit. */
function cutName(name, room, measure) {
    const tail = name.slice(-Math.min(TAIL_CHARS, name.length));
    const most = name.length - tail.length - 1;
    let low = 0;
    let high = most;
    while (low < high) {                       // the longest head that still fits
        const mid = Math.ceil((low + high) / 2);
        if (measure(name.slice(0, mid) + ELLIPSIS + tail) <= room) low = mid; else high = mid - 1;
    }
    return low >= 5 && measure(name.slice(0, low) + ELLIPSIS + tail) <= room ? name.slice(0, low) + ELLIPSIS + tail : null;
}

/**
 * A relative path cut to fit `maxWidth`, so that it always fits and no CSS
 * ellipsis is needed. What goes first:
 *   (a) the middle folders:      projects/liver/2026/name.zarr -> projects/\u2026/name.zarr
 *   (b) the middle of the name, keeping its start and its last 16 characters
 *       (version, extension), behind the collapsed folders;
 *   (c) the folders altogether:  \u2026/name_start\u2026tail.zarr
 * and, if even that is too wide, the tail itself gives way.
 * @param {string} text - the label (a path relative to the data directory, or any name)
 * @param {number} maxWidth - the room, in the unit of `measure`
 * @param {(s: string) => number} measure - the width of a string
 */
export function truncateDatasetLabel(text, maxWidth, measure) {
    if (!text || measure(text) <= maxWidth) return text;
    const parts = text.split('/');
    const name = parts.pop();
    const folders = parts;
    const collapsed = folders.length >= 2 ? `${folders[0]}/${ELLIPSIS}/` : (folders.length ? `${folders[0]}/` : '');
    if (folders.length >= 2 && measure(collapsed + name) <= maxWidth) return collapsed + name;     // (a)
    for (const prefix of [collapsed, folders.length ? `${ELLIPSIS}/` : '']) {                         // (b), then (c)
        const cut = cutName(name, maxWidth - measure(prefix), measure);
        if (cut) return prefix + cut;
    }
    // not even the start of the name fits with its tail: keep the end that does
    for (let keep = Math.min(name.length, TAIL_CHARS + 8); keep > 1; keep--) {
        const candidate = ELLIPSIS + name.slice(-keep);
        if (measure(candidate) <= maxWidth) return candidate;
    }
    return ELLIPSIS;
}
