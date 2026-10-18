/**
 * The subset size the user chose, carried from dataset to dataset.
 *
 * The size is the user's intent, kept apart from the subset applied to the
 * open dataset: `undefined` (never chosen: the server's default applies),
 * `'all'` (every cell) or a number of cells. Only the user's own choice in
 * the subset dialog changes it (a part step does not, nor does a share link,
 * a panel set or a restored session, which apply their own subset as saved).
 *
 * Every dataset the user switches to (DatasetState isUserSource: the
 * browser, the back button, the desktop app) opens on that size: a subset of
 * `n` cells when it has more, every cell when it has as many or fewer. The
 * size is not changed by a dataset too small for it, so the next larger one
 * is subsampled to it again. Only the size travels: a filter, a balance
 * column and a part belong to the dataset they were chosen on, and the seed
 * is the server's default, as for a size chosen by hand on a fresh dataset.
 *
 * Kept in the tab's own storage (main.js passes it) per server and user:
 * key `annzarro.subsetSize:<origin>|<user>`, value `{"size": <n>|"all"}`.
 * It lasts while the tab does: a reload of the tab keeps it, and a fresh
 * visit to the bare address (a new tab, the address typed, a bookmark)
 * starts on the server's default (dropSubsetSizes). Nothing here throws:
 * storage may be missing, full or blocked.
 */

export const SUBSET_SIZE_KEY_PREFIX = 'annzarro.subsetSize:';

const fmt = (n) => Number(n).toLocaleString('en-US');

const knownSize = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** A size as kept: a whole number of at least 1, `'all'`, or undefined for anything else. */
export function cleanSize(size) {
    if (size === 'all') return 'all';
    return Number.isInteger(size) && size >= 1 ? size : undefined;
}

export function subsetSizeKey(origin, user) {
    return `${SUBSET_SIZE_KEY_PREFIX}${origin || ''}|${user || 'local'}`;
}

/** The size kept for `user` on `origin`, or undefined. */
export function loadSubsetSize(storage, origin, user) {
    try {
        const raw = storage.getItem(subsetSizeKey(origin, user));
        if (raw === null || raw === undefined) return undefined;
        return cleanSize(JSON.parse(raw).size);
    } catch {
        return undefined;
    }
}

/** Keep `size` for `user` on `origin` (undefined forgets it). */
export function saveSubsetSize(storage, origin, user, size) {
    const clean = cleanSize(size);
    try {
        if (clean === undefined) storage.removeItem(subsetSizeKey(origin, user));
        else storage.setItem(subsetSizeKey(origin, user), JSON.stringify({ size: clean }));
    } catch { /* storage full or blocked */ }
}

/** Forget every size kept in `storage` (any origin, any user). Returns how many were removed. */
export function dropSubsetSizes(storage) {
    let removed = 0;
    try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
        for (const key of keys) {
            if (typeof key === 'string' && key.startsWith(SUBSET_SIZE_KEY_PREFIX)) {
                storage.removeItem(key);
                removed++;
            }
        }
    } catch { /* storage blocked */ }
    return removed;
}

/**
 * Does `size` show every cell of a dataset of `nTotal` cells? `defaults` is
 * the server's ({threshold}) for a size never chosen.
 */
export function showsAll(size, nTotal, defaults = null) {
    if (size === 'all') return true;
    if (size === undefined) {
        const threshold = defaults && Number.isFinite(defaults.threshold) ? defaults.threshold : Infinity;
        return !(nTotal > threshold);
    }
    return !(nTotal > size);
}

/**
 * What the next dataset load asks the server for (DataManager.setSubsetRequest):
 * 'auto' (the server's default), null (every cell) or a spec `{n, seed}`.
 * @param {number|'all'|undefined} size - the size kept
 * @param {number} nTotal - the cells of the dataset opening
 * @param {{seed?: number, maxCells?: number}} [opts] - the server's default
 *   seed; the most cells the browser's memory guard lets through (a size it
 *   refuses falls back to the server's default)
 */
export function carriedRequest(size, nTotal, { seed = 0, maxCells = Infinity } = {}) {
    const kept = cleanSize(size);
    if (kept === undefined || !knownSize(nTotal)) return 'auto';
    const all = showsAll(kept, nTotal);
    if ((all ? nTotal : kept) > maxCells) return 'auto';
    return all ? null : { n: kept, seed: Number.isInteger(seed) ? seed : 0 };
}

/**
 * The size kept after the user applied `spec` (null or `n: null`: every
 * cell) on a dataset of `nTotal` cells. A number is kept as chosen. Every
 * cell where the size kept already shows every cell keeps it (the dataset is
 * just small). Every cell on a dataset the server would show in full anyway
 * (no more cells than its threshold, else its default size) says nothing
 * about large datasets: the kept size is forgotten and the server's default
 * applies again. Only every cell on a dataset above that is a new intent:
 * 'all'. Without the server's defaults there is no threshold to compare to.
 */
export function sizeAfterChoice(spec, nTotal, size, defaults = null) {
    const n = spec ? spec.n : null;
    if (Number.isInteger(n) && n >= 1) return n;
    if (showsAll(size, nTotal, defaults)) return size;
    const limit = defaults ? [defaults.threshold, defaults.size].find(Number.isFinite) : undefined;
    return limit !== undefined && nTotal <= limit ? undefined : 'all';
}

/**
 * The subset with half the cells of the one shown (every cell when none is),
 * keeping its seed, balance and filter: the panel's way out when the browser
 * ran out of memory. `info` is the subset in effect (DataManager.getSubset),
 * `reply` the /data/subset reply of the open dataset, `defaults` the server's.
 * Null when there is nothing to halve (one cell, or no dataset).
 */
export function halfSubset(info, reply, defaults = null) {
    const shown = info ? info.n : (reply ? reply.n_total : null);
    if (!knownSize(shown) || shown < 2) return null;
    return subsetOfSize(info, reply, defaults, Math.ceil(shown / 2));
}

/**
 * The subset with `n` cells (fewer than the one shown), keeping the seed,
 * balance and filter of the subset in effect; null when `n` is not a whole
 * number of at least one cell below what is shown. halfSubset's general form.
 */
export function subsetOfSize(info, reply, defaults, n) {
    const spec = info && info.subset;
    const shown = info ? info.n : (reply ? reply.n_total : null);
    if (!knownSize(shown) || !Number.isInteger(n) || n < 1 || n >= shown) return null;
    if (!spec) return { n, seed: defaults && Number.isInteger(defaults.seed) ? defaults.seed : 0 };
    const half = { ...spec, n };
    delete half.part;   // part 1 of the new partition
    return half;
}

/**
 * What the subset badge adds when every cell is shown because the dataset
 * is no larger than the size kept: a short note for the badge and a line for
 * its tooltip. Null when there is nothing to add.
 */
export function carryNote(size, nTotal) {
    if (!Number.isInteger(size) || !knownSize(nTotal) || nTotal > size) return null;
    return {
        badge: `≤ ${fmt(size)}`,
        title: `This dataset has no more cells than your subset size (${fmt(size)}). `
            + `Larger datasets you open show a subset of ${fmt(size)} cells.`
    };
}
