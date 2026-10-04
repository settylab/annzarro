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

/** The ladder starts here; smaller datasets get a few smaller rungs. */
export const LADDER_FLOOR = 1000;
/** Below this the ladder skips its 2-rungs (1k, 5k, 10k, 50k), so it stays short on a phone. */
export const FULL_LADDER_FROM = 100000;
const MIN_PRESETS = 3;
/**
 * An estimate for n more than this many times the largest n this session
 * measured on its path is extrapolated. Against the benchmark's defaults the
 * factor is 1: anything past its largest clean run is a guess.
 */
export const EXTRAPOLATE_FACTOR = 4;

/** Large-plot mode above this many points unless the server says otherwise (ui.defaults.large_plot_points). */
export const DEFAULT_LARGE_PLOT_POINTS = 1000000;
/**
 * Above this many points a plot may not fit in the browser tab at all. The
 * paper's laptop benchmark drew 175M points in large-plot mode and ran out
 * of V8 memory (OOM) at 182M with a 4.40 GB heap; 150M leaves a margin.
 * Sizes above it are offered with a warning and never chosen by default.
 */
export const BROWSER_POINT_CEILING = 150000000;

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
 *
 * measuredUpTo is the largest plot the benchmark timed on each path.
 */
export const DEFAULT_MODEL = {
    serverPerCell: 2.0e-8,
    regular: { first: { fixed: 0.53, perPoint: 5.5e-6 }, recolour: { fixed: 0.07, perPoint: 1.58e-6 }, measuredUpTo: 1000000 },
    large: { first: { fixed: 0.53, perPoint: 6.2e-8 }, recolour: { fixed: 1.05, perPoint: 5.7e-8 }, measuredUpTo: 95624334 }
};

/**
 * The 1-2-5 sequence from `from` up to (not including) `below`, without the
 * 2-rungs below `full` (1-5 there).
 */
function _ladder(from, below, full = 0) {
    const out = [];
    for (let decade = 1; decade < below; decade *= 10) {
        for (const m of [1, 2, 5]) {
            const v = m * decade;
            if (v >= from && v < below && !(m === 2 && v < full)) out.push(v);
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
    const ladder = _ladder(LADDER_FLOOR, e, FULL_LADDER_FROM);
    if (ladder.length >= MIN_PRESETS) return ladder;
    const all = _ladder(1, e);
    return all.slice(Math.max(0, all.length - MIN_PRESETS));
}

/**
 * The largest size a regular Cell Plot draws (n <= threshold): null when
 * every eligible cell fits ("All"), else the largest preset at most the
 * threshold (the threshold itself when no preset is that small).
 */
export function largestRegularSize(eligible, threshold = DEFAULT_LARGE_PLOT_POINTS) {
    if (!(Number(eligible) > threshold)) return null;
    const fits = presetSizes(eligible).filter(n => n <= threshold);
    return fits.length ? fits[fits.length - 1] : Math.max(1, threshold);
}

/** The size a dialog offers first: the server's default, within the cells and the browser ceiling. */
export function initialSize(defaultSize, eligible, ceiling = BROWSER_POINT_CEILING) {
    return Math.max(1, Math.min(Number(defaultSize) || 1, Number(eligible) || 1, ceiling));
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
 * @param {number} [ctx.ceiling] BROWSER_POINT_CEILING
 * @returns {{seconds: number, large: boolean, calibrated: boolean, extrapolated: boolean,
 *            measuredUpTo: number, overCeiling: boolean}}
 *   calibrated: rescaled to this session's draws on this path;
 *   extrapolated: n is beyond the largest plot that measured the per-point
 *   cost (measuredUpTo): more than EXTRAPOLATE_FACTOR times this session's
 *   largest draw on the path, or past the benchmark's largest clean run
 *   until a session draw measures it;
 *   overCeiling: n may not fit in the browser's memory at all.
 */
export function estimateLoad(n, { nTotal = 0, threshold = DEFAULT_LARGE_PLOT_POINTS, serverTime = null, samples = null,
                              model = DEFAULT_MODEL, ceiling = BROWSER_POINT_CEILING } = {}) {
    const large = n > threshold;
    const path = large ? 'large' : 'regular';
    const mine = (samples || _samples).filter(s => s.large === large);
    const f = _factors(model, path, mine);
    const t = model[path].first;
    // the slope is this session's, or the benchmark's with its range
    const measuredUpTo = f.perPointMeasured
        ? mine.reduce((m, s) => Math.max(m, s.n), 0) : model[path].measuredUpTo;
    // The preview request times the selection alone; reading the subset's
    // rows from a big store costs more, so it can raise the modelled cost but
    // not lower it.
    const server = Math.max(serverTime > 0 ? serverTime : 0, model.serverPerCell * Number(nTotal || 0));
    return {
        seconds: server + t.fixed * f.fixed + t.perPoint * f.perPoint * n,
        large,
        calibrated: mine.length > 0,
        extrapolated: n > (f.perPointMeasured ? EXTRAPOLATE_FACTOR : 1) * measuredUpTo,
        measuredUpTo,
        overCeiling: n > ceiling
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
