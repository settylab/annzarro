/**
 * The subset dialog's size presets and its load-time estimate. Pure (no DOM,
 * no fetch), so Node tests cover it.
 *
 * Presets follow the 1-2-5 ladder of round numbers (1k, 2k, 5k, 10k, ...),
 * from fast to comprehensive, below the number of eligible cells. A size n
 * splits the eligible cells into k = ceil(eligible / n) disjoint parts
 * (annzarro/core/subset.py).
 *
 * The estimate is a model, not a promise:
 *
 *   seconds ≈ server(n_total) + fixed + perPoint · n
 *
 * with one (fixed, perPoint) pair for the regular Cell Plot and one for
 * large-plot mode (more than Config.DEFAULTS.LARGE_PLOT_POINTS points). The
 * server term is the cost of selecting and reading a subset of n_total cells. Until this
 * session has drawn a plot the numbers are DEFAULT_MODEL; every Cell Plot
 * draw and recolour the page times (recordLoad) then rescales the model on
 * its path.
 */

/** The 1-2-5 ladder starts here; smaller datasets get a few smaller rungs. */
export const LADDER_FLOOR = 1000;
const MIN_PRESETS = 3;
/** An estimate for n more than this many times the largest n measured on its path is extrapolated. */
export const EXTRAPOLATE_FACTOR = 4;

/**
 * Defaults from the AnnZarro paper's clean laptop benchmark
 * (annzarro-paper benchmark/scale/results/browser_rerun_events.csv, clean=true,
 * medians, colour by gene, Tahoe-100M prefixes, Chrome on an Apple laptop):
 *
 * - server: 100k-cell first plot 1.10 s on 1M cells, 3.00 s on 95.6M, so
 *   about 20 ns per cell of the dataset to select the subset.
 * - regular first plot: 1.10 s for 100k points, 6.08 s for 1M (every cell
 *   of the 1M store): 5.5 µs per point, 0.53 s fixed.
 * - regular recolour: 0.23 s for 100k, 1.65 s for 1M.
 * - large first plot: 3.42 s for 50M, 9.03 s for 95.6M, fitted with the
 *   regular fixed cost: 62 ns per point.
 * - large recolour: 3.9 s for 50M, 6.5 s for 95.6M.
 */
export const DEFAULT_MODEL = {
    serverPerCell: 2.0e-8,
    regular: { first: { fixed: 0.53, perPoint: 5.5e-6 }, recolour: { fixed: 0.07, perPoint: 1.58e-6 } },
    large: { first: { fixed: 0.53, perPoint: 6.2e-8 }, recolour: { fixed: 1.05, perPoint: 5.7e-8 } }
};

/** The 1-2-5 sequence from `from` up to (not including) `below`. */
function _ladder(from, below) {
    const out = [];
    for (let decade = 1; decade < below; decade *= 10) {
        for (const m of [1, 2, 5]) {
            const v = m * decade;
            if (v >= from && v < below) out.push(v);
        }
    }
    return out;
}

/**
 * Preset sizes for `eligible` cells, smallest first: the ladder from 1k
 * below `eligible`, or, when that gives fewer than three, the three largest
 * rungs below it ("All" is offered separately).
 * @param {number} eligible
 * @returns {number[]}
 */
export function presetSizes(eligible) {
    const e = Number(eligible);
    if (!(e > 1)) return [];
    const ladder = _ladder(LADDER_FLOOR, e);
    if (ladder.length >= MIN_PRESETS) return ladder;
    const all = _ladder(1, e);
    return all.slice(Math.max(0, all.length - MIN_PRESETS));
}

/** k = ceil(eligible / n), the number of disjoint parts of size n (at least 1). */
export function partsFor(eligible, n) {
    const e = Number(eligible), size = Number(n);
    if (!(e > 0) || !(size > 0)) return 1;
    return Math.max(1, Math.ceil(e / size));
}

/** "1k", "20k", "1M", "1.5M": a preset's short label. */
export function shortCount(n) {
    const v = Number(n);
    const unit = v >= 1e9 ? [1e9, 'B'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'k'] : [1, ''];
    const x = v / unit[0];
    const s = x >= 100 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
    return s + unit[1];
}

// -- measurements ----------------------------------------------------------

const MAX_SAMPLES = 64;
let _samples = [];          // {n, seconds, kind: 'first'|'recolour', large}
let _server = new Map();    // dataset -> {nTotal, seconds}

/**
 * Note one timed Cell Plot draw ('first': data load and draw) or recolour.
 * Calls with nonsense values are ignored.
 */
export function recordLoad({ n, seconds, kind = 'first', large = false }) {
    if (!(n > 0) || !(seconds > 0) || !Number.isFinite(seconds)) return;
    if (kind !== 'first' && kind !== 'recolour') return;
    _samples.push({ n: Number(n), seconds: Number(seconds), kind, large: !!large });
    if (_samples.length > MAX_SAMPLES) _samples = _samples.slice(-MAX_SAMPLES);
}

/** Note how long the server took to select a subset of this dataset's `nTotal` cells. */
export function recordServer(dataset, nTotal, seconds) {
    if (!dataset || !(seconds > 0) || !Number.isFinite(seconds)) return;
    _server.set(dataset, { nTotal: Number(nTotal), seconds: Number(seconds) });
}

/** The last measured selection time on `dataset`, or null. */
export function serverSeconds(dataset) {
    const m = _server.get(dataset);
    return m ? m.seconds : null;
}

/** This session's measurements (for the dialog's note and the tests). */
export function loadSamples() {
    return _samples.slice();
}

export function resetLoadSamples() {
    _samples = [];
    _server = new Map();
}

// -- the estimate ----------------------------------------------------------

function _term(model, path, kind) {
    return model[path][kind];
}

/**
 * Rescale one path's (fixed, perPoint) to this session's samples on it. A
 * sample's ratio measured / modelled is credited to the per-point cost by
 * the share of the modelled time that is per-point, and to the fixed cost
 * by the rest, both as weighted means of log ratios. Small plots thus tune
 * the fixed cost and big plots the per-point cost; a cost no sample speaks
 * for stays at its default.
 */
function _factors(model, path, samples) {
    let wf = 0, wp = 0, lf = 0, lp = 0;
    for (const s of samples) {
        const t = _term(model, path, s.kind);
        const fixed = t.fixed, point = t.perPoint * s.n;
        const total = fixed + point;
        if (!(total > 0)) continue;
        const share = point / total;
        const log = Math.log(s.seconds / total);
        wp += share; lp += share * log;
        wf += 1 - share; lf += (1 - share) * log;
    }
    const clamp = (x) => Math.min(10, Math.max(0.1, x));
    return {
        fixed: wf >= 0.3 ? clamp(Math.exp(lf / wf)) : 1,
        perPoint: wp >= 0.3 ? clamp(Math.exp(lp / wp)) : 1,
        perPointMeasured: wp >= 0.3
    };
}

/**
 * Estimated seconds until a subset of `n` points is drawn.
 * @param {number} n points the plot will draw
 * @param {Object} ctx
 * @param {number} ctx.nTotal cells in the dataset (the server's selection cost)
 * @param {number} ctx.threshold large-plot mode above this many points
 * @param {number} [ctx.serverTime] the measured selection time (serverSeconds()); the larger of it and the modelled cost is used
 * @param {Array} [ctx.samples] defaults to this session's (recordLoad)
 * @param {Object} [ctx.model] defaults to DEFAULT_MODEL
 * @returns {{seconds: number, large: boolean, calibrated: boolean, extrapolated: boolean, measuredUpTo: number}}
 *   calibrated: rescaled to this session's draws on this path;
 *   extrapolated: no draw on this path measured its per-point cost, or n is
 *   more than EXTRAPOLATE_FACTOR times the largest measured.
 */
export function estimateLoad(n, { nTotal = 0, threshold = 5000000, serverTime = null, samples = null, model = DEFAULT_MODEL } = {}) {
    const large = n > threshold;
    const path = large ? 'large' : 'regular';
    const mine = (samples || _samples).filter(s => s.large === large);
    const f = _factors(model, path, mine);
    const t = model[path].first;
    const measuredUpTo = mine.reduce((m, s) => Math.max(m, s.n), 0);
    // The preview request times the selection alone; reading the subset's
    // rows from a big store costs more, so it can raise the modelled cost but
    // not lower it.
    const server = Math.max(serverTime > 0 ? serverTime : 0, model.serverPerCell * Number(nTotal || 0));
    return {
        seconds: server + t.fixed * f.fixed + t.perPoint * f.perPoint * n,
        large,
        calibrated: mine.length > 0,
        extrapolated: !f.perPointMeasured || n > EXTRAPOLATE_FACTOR * measuredUpTo,
        measuredUpTo
    };
}

/** "<1 s", "~2 s", "~15 s", "~2 min": an estimate, rounded so it does not look precise. */
export function formatSeconds(seconds) {
    const s = Number(seconds);
    if (!(s >= 1)) return '<1 s';
    if (s < 10) return `~${Math.round(s)} s`;
    if (s < 60) return `~${Math.round(s / 5) * 5} s`;
    const min = s / 60;
    return min < 10 ? `~${Math.round(min)} min` : `~${Math.round(min / 5) * 5} min`;
}
