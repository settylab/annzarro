/**
 * The browser's model of a binning: the schema, the defaults, validation and the label text (SHR-18). It never
 * computes an edge from data. The server's `core/binning.py` is the one implementation of edges and assignment; this
 * module has its field names and its defaults, reads the reply it writes, and spells what a level is called.
 *
 * A stored binning is `{method, bins?, thresholds?, zero_bin?, range?, outside?, edges_from?}`, written without its
 * defaults (as a link stores it) and with every unknown field kept. `effectiveBinning` is the same recipe with the
 * defaults filled in, which is what the server's `Binning.to_dict()` writes, so it is what a hash and a request use.
 *
 * Bins are `[lo, hi)`, the last one closed. Equal-count and equal-width edges have `bins + 1` values, the thresholds of
 * a manual binning are its edges, and a column split by its values has one edge per value. With the zero bin on, level
 * `@zero` comes first and `bin:0`, `bin:1`, ... follow.
 *
 * Pure, so Node tests cover it. tests/data/binning_recipe_vectors.json is written from the engine and pins it.
 */
import { VOCABULARY } from './vocabulary.js';
import { binId, RESERVED } from './level-id.js';

const P = VOCABULARY.phrase;

/** The methods of `core/binning.py`, in its order. */
// export-unused-ok: G9b lists the methods of the shared binning control
export const BINNING_METHODS = Object.freeze(['equal_width', 'equal_count', 'log', 'manual', 'categories']);

// export-unused-ok: G9b validates a typed bin count against the same limits
export const BINS_MIN = 2;
// export-unused-ok: G9b validates a typed bin count against the same limits
export const BINS_MAX = 1000;

/** The bin count a method uses when none is stored (SHR-14). */
// export-unused-ok: G9b shows the default bin count of the method chosen
export const DEFAULT_BINS = Object.freeze({ equal_count: 4, equal_width: 10, log: 10 });

const DEFAULT_METHOD = 'equal_count';
const OUTSIDE = ['clamp', 'exclude'];
const EDGES_FROM = ['shown', 'all'];
const KNOWN = ['method', 'bins', 'thresholds', 'zero_bin', 'range', 'outside', 'edges_from'];
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A stored binning from whatever a link, a panel set or a control holds: every field valid, defaults left out, unknown
 * fields kept. A value that cannot be used is repaired to what the engine would use and reported.
 * @param {*} raw
 * @returns {{binning: Object, problems: {field: string, reason: string}[]}} `reason` is the engine's own key
 */
export function normalizeBinning(raw) {
    const problems = [];
    const bad = (field, reason) => problems.push({ field, reason });
    if (raw === undefined || raw === null) raw = {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        bad('binning', 'bad_binning');
        return { binning: { method: DEFAULT_METHOD }, problems };
    }
    let method = raw.method === undefined ? DEFAULT_METHOD : raw.method;
    if (!BINNING_METHODS.includes(method)) {
        bad('method', 'bad_method');
        method = DEFAULT_METHOD;
    }
    const out = { method };

    if (method in DEFAULT_BINS && raw.bins !== undefined) {
        if (Number.isInteger(raw.bins) && raw.bins >= BINS_MIN && raw.bins <= BINS_MAX) {
            if (raw.bins !== DEFAULT_BINS[method]) out.bins = raw.bins;
        } else {
            bad('bins', 'bad_bins');
        }
    }
    if (method === 'manual') out.thresholds = thresholdsOf(raw.thresholds, bad);
    if (raw.zero_bin !== undefined && typeof raw.zero_bin !== 'boolean') bad('zero_bin', 'bad_zero_bin');
    else if (raw.zero_bin === true && method !== 'categories') out.zero_bin = true;
    if ((method === 'equal_width' || method === 'log') && raw.range !== undefined && raw.range !== null) {
        const range = rangeOf(raw.range, method, bad);
        if (range) out.range = range;
    }
    if (raw.outside !== undefined && !OUTSIDE.includes(raw.outside)) bad('outside', 'bad_outside');
    else if (raw.outside === 'exclude' && method !== 'manual' && method !== 'categories') out.outside = 'exclude';
    if (raw.edges_from !== undefined && !EDGES_FROM.includes(raw.edges_from)) bad('edges_from', 'bad_edges_from');
    else if (raw.edges_from === 'all' && method !== 'manual') out.edges_from = 'all';

    for (const key of Object.keys(raw)) if (!KNOWN.includes(key)) out[key] = raw[key];
    return { binning: out, problems };
}

function thresholdsOf(raw, bad) {
    if (!Array.isArray(raw) || raw.length === 0) {
        bad('thresholds', 'bad_thresholds');
        return [];
    }
    const numbers = raw.filter(isNumber);
    if (numbers.length !== raw.length) bad('thresholds', 'bad_number');
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    if (sorted.length > BINS_MAX - 1) bad('thresholds', 'bad_thresholds');
    return sorted;
}

/** `[lo, hi]` with a side `null` for automatic; both automatic is no range. Null when unusable (reported). */
function rangeOf(raw, method, bad) {
    if (!Array.isArray(raw) || raw.length !== 2) {
        bad('range', 'bad_range');
        return null;
    }
    const [lo, hi] = raw;
    for (const side of raw) {
        if (side !== null && !isNumber(side)) {
            bad('range', 'bad_number');
            return null;
        }
    }
    if (lo === null && hi === null) return null;
    if (lo !== null && hi !== null && !(lo < hi)) {
        bad('range', 'bad_range');
        return null;
    }
    if (method === 'log' && lo !== null && lo <= 0) {
        bad('range', 'bad_range');
        return null;
    }
    return [lo, hi];
}

/**
 * The binning with every default filled in: what the engine's `Binning.to_dict()` writes, and so what a hash and a
 * request carry. Unknown fields are left out.
 * @param {Object} binning - from normalizeBinning
 * @returns {Object}
 */
export function effectiveBinning(binning) {
    const { method } = binning;
    const out = { method };
    if (method in DEFAULT_BINS) out.bins = binning.bins === undefined ? DEFAULT_BINS[method] : binning.bins;
    if (method === 'manual') out.thresholds = [...binning.thresholds];
    if (binning.zero_bin) out.zero_bin = true;
    if (binning.range !== undefined) out.range = [...binning.range];
    if (method !== 'manual' && method !== 'categories') out.outside = binning.outside || 'clamp';
    if (method !== 'manual') out.edges_from = binning.edges_from || 'shown';
    return out;
}

/**
 * The edges a stored binning fixes by itself: its thresholds (manual), or `bins + 1` edges over a stored range (equal
 * width, log-spaced). Null for the rest, whose edges only the server's reply holds.
 * @param {Object} binning - from normalizeBinning
 * @returns {number[]|null}
 */
// export-unused-ok: G9b draws a manual or ranged binning's lines before the reply arrives
export function recipeEdges(binning) {
    const { method } = binning;
    if (method === 'manual') return [...binning.thresholds];
    const range = binning.range;
    if (!range || range[0] === null || range[1] === null || (method !== 'equal_width' && method !== 'log')) return null;
    const [lo, hi] = range;
    const k = binning.bins === undefined ? DEFAULT_BINS[method] : binning.bins;
    const edges = new Array(k + 1);
    if (method === 'equal_width') {
        const step = (hi - lo) / k;
        for (let i = 0; i < k; i++) edges[i] = lo + i * step;
    } else {
        const ratio = hi / lo;
        for (let i = 0; i < k; i++) edges[i] = lo * Math.pow(ratio, i / k);
    }
    edges[0] = lo;
    edges[k] = hi;
    return method === 'log' ? edges.filter((v, i) => i === 0 || v !== edges[i - 1]) : edges;
}

/** The number of bins of the method (the zero bin not counted): the reply's count, else what its edges or the recipe fix. */
function binCount(binning, info) {
    if (info && Number.isInteger(info.bins_made)) return info.bins_made;
    const edges = (info && info.edges) || recipeEdges(binning);
    if (!edges) throw new Error('The reply is needed here: the edges of this binning come from the data.');
    if (binning.method === 'manual') return edges.length + 1;
    return binning.method === 'categories' ? edges.length : edges.length - 1;
}

/**
 * The ids of the levels, in level order: `@zero` when the zero bin is on, then `bin:0`, `bin:1`, ...
 * @param {Object} binning - from normalizeBinning
 * @param {Object|null} info - this partitioning's part of the reply (`bins_made`); not needed when the recipe fixes the edges
 * @returns {string[]}
 */
// export-unused-ok: G9b draws one chip per level, and G7 reads the levels of a reply
export function levelIds(binning, info) {
    const ids = binning.zero_bin ? [RESERVED.zero] : [];
    const n = binCount(binning, info);
    for (let i = 0; i < n; i++) ids.push(binId(i));
    return ids;
}

/** A number to three significant digits, written plainly (no trailing zeros). */
function figure(x) {
    return String(Number(Number(x).toPrecision(3)));
}

/**
 * The default label of each level (SHR-9, SHR-45, SHR-46), without the user's renames.
 *
 * The end bins are open ("CD3E < 0.5", "CD3E ≥ 1.75") because the first and last bin hold every cell below or above
 * the inner edges: manual thresholds always do, and so do the data-derived methods when outside values are clamped.
 * When they are excluded the end bins hold only what is inside the edges, so they read as the ranges they are.
 * @param {Object} binning - from normalizeBinning
 * @param {Object|null} info - this partitioning's part of the reply: `edges`, `bins_made`, and for degenerate data `degenerate`, `value`
 * @param {string} name - the source's short name
 * @returns {{id: string, label: string}[]}
 */
export function levelLabels(binning, info, name) {
    const ids = levelIds(binning, info);
    const edges = (info && info.edges) || recipeEdges(binning) || [];
    const labels = [];
    if (binning.zero_bin) labels.push(P.zero(name));
    const n = ids.length - labels.length;
    const method = binning.method;
    if (method === 'categories') {
        for (const v of edges) labels.push(String(v));
    } else if (method !== 'manual' && n === 1) {
        const value = info && info.value !== undefined ? info.value : edges[0];
        labels.push(value === null || value === undefined ? P.noValue(name) : P.equals(name, figure(value)));
    } else {
        const inner = method === 'manual' ? edges : edges.slice(1, -1);
        const closedEnds = method !== 'manual' && binning.outside === 'exclude';
        for (let i = 0; i < n; i++) {
            if (i === 0) {
                if (closedEnds) labels.push(P.between(name, figure(edges[0]), figure(inner[0])));
                else labels.push(binning.zero_bin ? P.positiveBelow(name, figure(inner[0])) : P.below(name, figure(inner[0])));
            } else if (i === n - 1) {
                if (closedEnds) labels.push(P.between(name, figure(inner[i - 1]), figure(edges[edges.length - 1])));
                else labels.push(P.atLeast(name, figure(inner[i - 1])));
            } else {
                labels.push(P.between(name, figure(inner[i - 1]), figure(inner[i])));
            }
        }
    }
    return ids.map((id, i) => ({ id, label: labels[i] }));
}

/**
 * Freeze thresholds (SHR-17): the current data-derived edges as manual thresholds, so the bins no longer move. The
 * thresholds are the inner edges, so every cell lands where it did; the zero bin stays.
 * @param {Object} binning - from normalizeBinning
 * @param {Object|null} info - this partitioning's part of the reply (`edges`)
 * @returns {Object|null} the manual binning, or null when there is nothing to freeze (already manual, split by value, one level)
 */
// export-unused-ok: G9b's Freeze thresholds button
export function freezeThresholds(binning, info) {
    if (binning.method === 'manual' || binning.method === 'categories') return null;
    const edges = (info && info.edges) || recipeEdges(binning);
    if (!edges || (info && info.degenerate) || edges.length < 3) return null;
    return normalizeBinning({ method: 'manual', thresholds: edges.slice(1, -1), zero_bin: binning.zero_bin }).binning;
}
