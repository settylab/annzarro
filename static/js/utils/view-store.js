/**
 * Which store a saved view belongs to, and how the store it is opened on
 * compares. Pure (no DOM, no fetch), so the Node suite tests the very
 * functions the boot path runs.
 *
 * A share link or panel set records, next to its layout:
 *
 *   view.store = {
 *     path,      // relative to the server's data directory when the store
 *                //   is inside it (opens on any server whose data
 *                //   directory holds it); absolute otherwise
 *     abs?,      // the absolute path it had where it was saved: a hint
 *     name,      // the store's file name, for finding it by name
 *     fp?        // the fingerprint (annzarro/core/fingerprint.py)
 *   }
 *   view.annzarro = '<version that saved it>'
 *
 * The fingerprint has two tiers. `data` (n_obs, n_var, and a digest of the
 * cell and of the gene names) says whether these are the same cells and
 * genes; `meta` (a digest of every metadata document, per-group digests and
 * the field names) says whether the fields are the same. A view opened on a
 * store whose cells or genes differ gets a strong warning; one whose fields
 * differ gets a mild notice naming them; a view without a fingerprint (made
 * before v0.4.1) opens as it always did.
 *
 * The same store and the same AnnZarro version give the same view and the
 * same exported figure. Another version opens the view, but it may render
 * differently; versionNotice says so.
 */

/** Fingerprint definition this build understands (annzarro/core/fingerprint.py). */
export const FINGERPRINT_VERSION = 1;

/** The last path component, without a trailing slash: the store's file name. */
export function storeName(path) {
    const parts = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || '';
}

/**
 * The `store` record a saved view carries.
 * @param {{path: string, relPath?: string|null, fingerprint?: Object|null}} info
 * @returns {{path: string, abs?: string, name: string, fp?: Object}}
 */
export function storeRecord({ path, relPath = null, fingerprint = null }) {
    const record = { path: relPath || path, name: storeName(path) };
    if (relPath && path && path !== relPath) record.abs = path;
    if (fingerprint && typeof fingerprint === 'object') {
        const fp = {};
        for (const key of ['v', 'n_obs', 'n_var', 'cells', 'genes', 'data', 'meta', 'groups', 'fields']) {
            if (fingerprint[key] !== undefined && fingerprint[key] !== null) fp[key] = fingerprint[key];
        }
        record.fp = fp;
    }
    return record;
}

/** Whether a fingerprint has its data tier (the names were hashed). */
export function hasDataTier(fp) {
    return !!(fp && fp.data);
}

const GROUP_LABELS = { '/': 'top-level attributes' };

/**
 * What differs in the fields: names added or missing per group, and groups
 * whose metadata changed with the same names.
 * @returns {string[]} e.g. ['obs/leiden is not in this store', 'obsm/X_pca added']
 */
export function fieldChanges(saved, current) {
    const out = [];
    const sf = (saved && saved.fields) || {};
    const cf = (current && current.fields) || {};
    const named = new Set();
    const groups = [...new Set([...Object.keys(sf), ...Object.keys(cf)])].sort();
    if (Object.keys(sf).length && Object.keys(cf).length) {
        for (const g of groups) {
            const before = new Set(sf[g] || []);
            const after = new Set(cf[g] || []);
            for (const name of [...before].sort()) {
                if (!after.has(name)) { out.push(`${g}/${name} is not in this store`); named.add(g); }
            }
            for (const name of [...after].sort()) {
                if (!before.has(name)) { out.push(`${g}/${name} added`); named.add(g); }
            }
        }
    }
    const sg = (saved && saved.groups) || {};
    const cg = (current && current.groups) || {};
    for (const g of [...new Set([...Object.keys(sg), ...Object.keys(cg)])].sort()) {
        if (named.has(g) || sg[g] === cg[g]) continue;
        if (!(g in cg)) out.push(`${GROUP_LABELS[g] || g} is not in this store`);
        else if (!(g in sg)) out.push(`${GROUP_LABELS[g] || g} added`);
        else out.push(`${GROUP_LABELS[g] || g} changed`);
    }
    return out;
}

/**
 * Compare the fingerprint a view was saved with to the store's.
 *
 *   'unknown'   the view has none (made before v0.4.1), or another
 *               definition: it opens as before, unchecked
 *   'different' other cells or genes (counts, or the name digests)
 *   'fields'    the same cells and genes (or the same counts, while the
 *               names are still being hashed), other fields
 *   'same'      the same store; `dataKnown` false while the names of a
 *               large store are still being hashed (only counts and
 *               metadata compared so far)
 *
 * @param {Object|null} saved - view.store.fp
 * @param {Object|null} current - the open store's fingerprint (may be pending)
 * @returns {{level: string, dataKnown: boolean, cells?: boolean, genes?: boolean,
 *            changes: string[], saved?: Object, current?: Object}}
 */
export function compareStores(saved, current) {
    if (!saved || !current || typeof saved !== 'object' || typeof current !== 'object'
        || saved.v !== FINGERPRINT_VERSION || current.v !== FINGERPRINT_VERSION) {
        return { level: 'unknown', dataKnown: false, changes: [] };
    }
    const base = { saved, current, changes: [] };
    const counted = Number.isFinite(saved.n_obs) && Number.isFinite(current.n_obs);
    if (counted && (saved.n_obs !== current.n_obs || saved.n_var !== current.n_var)) {
        return { ...base, level: 'different', dataKnown: true,
            cells: saved.n_obs !== current.n_obs, genes: saved.n_var !== current.n_var };
    }
    const dataKnown = hasDataTier(saved) && hasDataTier(current);
    if (dataKnown && saved.data !== current.data) {
        return { ...base, level: 'different', dataKnown,
            cells: saved.cells !== current.cells, genes: saved.genes !== current.genes };
    }
    if (saved.meta && current.meta && saved.meta !== current.meta) {
        return { ...base, level: 'fields', dataKnown, changes: fieldChanges(saved, current) };
    }
    return { ...base, level: 'same', dataKnown };
}

function _count(n, noun) {
    return Number.isFinite(n) ? `${n.toLocaleString('en-US')} ${noun}` : `? ${noun}`;
}

/**
 * The notice for a comparison, or null when there is nothing to say.
 * @param {Object} cmp - from compareStores
 * @param {string} openedPath - the store the view is being opened on
 * @returns {{title: string, message: string, strong: boolean}|null}
 */
export function describeComparison(cmp, openedPath) {
    if (!cmp || cmp.level === 'unknown' || cmp.level === 'same') return null;
    if (cmp.level === 'different') {
        const s = cmp.saved || {}, c = cmp.current || {};
        const what = cmp.cells && cmp.genes ? 'cells and genes'
            : cmp.cells ? 'cells' : cmp.genes ? 'genes' : 'cells or genes';
        return {
            strong: true,
            title: 'This store differs from the one the view was saved on',
            message: `${openedPath} has other ${what} than the store this view was saved on ` +
                `(saved: ${_count(s.n_obs, 'cells')} x ${_count(s.n_var, 'genes')}; ` +
                `here: ${_count(c.n_obs, 'cells')} x ${_count(c.n_var, 'genes')}). ` +
                'Panels may show other data or none.'
        };
    }
    const shown = cmp.changes.slice(0, 6);
    const more = cmp.changes.length - shown.length;
    const list = shown.length ? `: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}` : '';
    return {
        strong: false,
        title: cmp.dataKnown ? 'Same cells and genes, other fields' : 'Same size, other fields',
        message: `${cmp.dataKnown ? 'Same cells and genes' : 'Same number of cells and genes'} as when this view ` +
            `was saved; fields differ${list}. Panels that use a missing field say so.`
    };
}

/**
 * The notice for a view saved with another AnnZarro version, or null.
 * @param {string|null|undefined} saved
 * @param {string|null|undefined} current
 * @returns {string|null}
 */
export function versionNotice(saved, current) {
    if (!saved || !current || String(saved) === String(current)) return null;
    return `Saved with AnnZarro ${saved}; this is ${current}. The view may look different.`;
}

/**
 * Order the data directory's stores for "Change dataset": the same cells and
 * genes first, then the same counts while unchecked, then a store with the
 * saved name, then the rest by name. Each entry may carry `cmp` (from
 * compareStores against the saved fingerprint).
 * @param {Array<{path: string, name?: string, rel_path?: string, cmp?: Object}>} entries
 * @param {Object|null} savedStore - view.store
 * @returns {Array} a new array, each entry with `rank` and `match` set
 */
export function orderCandidates(entries, savedStore) {
    const savedName = savedStore ? (savedStore.name || storeName(savedStore.path)) : '';
    const scored = (entries || []).map(entry => {
        const level = entry.cmp ? entry.cmp.level : 'unknown';
        const sameName = !!savedName && storeName(entry.path) === savedName;
        let rank = 4, match = 'other';
        if (level === 'same' && entry.cmp.dataKnown) { rank = 0; match = 'same'; }
        else if (level === 'fields' && entry.cmp.dataKnown) { rank = 1; match = 'fields'; }
        else if (level === 'same' || level === 'fields') { rank = 2; match = 'counts'; }
        else if (sameName) { rank = 3; match = 'name'; }
        if (level === 'different') match = sameName ? 'name-different' : 'different';
        if (level === 'different') rank = sameName ? 3.5 : 4;
        return { ...entry, rank, match, sameName };
    });
    return scored.sort((a, b) => a.rank - b.rank || (b.sameName - a.sameName)
        || String(a.name || a.path).localeCompare(String(b.name || b.path)));
}

/**
 * The store to open without asking, when the saved path is not on this
 * server, or null to let the user choose.
 *
 * With a fingerprint: the one store with the same cells and genes (by its
 * name among several). Without one (a view from before v0.4.1): the one
 * store with the saved file name, as a relative name always resolved.
 * @param {Array} ordered - from orderCandidates
 * @param {Object|null} savedStore
 * @returns {Object|null}
 */
export function automaticCandidate(ordered, savedStore) {
    const list = ordered || [];
    if (savedStore && hasDataTier(savedStore.fp)) {
        const same = list.filter(e => e.match === 'same' || e.match === 'fields');
        if (same.length === 1) return same[0];
        const named = same.filter(e => e.sameName);
        return named.length === 1 ? named[0] : null;
    }
    const named = list.filter(e => e.sameName && e.match !== 'name-different');
    return named.length === 1 ? named[0] : null;
}

/**
 * The view's store as recorded, also for views made before v0.4.1 (which
 * name the store only by the link's dataset_path or the panel set's
 * `dataset`).
 * @param {Object|null} view
 * @param {string|null} datasetPath
 * @returns {{path: string, abs?: string, name: string, fp?: Object}|null}
 */
export function savedStoreOf(view, datasetPath) {
    const store = view && view.store && typeof view.store === 'object' ? view.store : null;
    if (store && store.path) return { ...store, name: store.name || storeName(store.path) };
    if (!datasetPath) return null;
    return { path: datasetPath, name: storeName(datasetPath) };
}
