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
