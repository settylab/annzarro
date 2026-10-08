/**
 * Browser memory: what an action will cost before it runs, what the open
 * panels hold, and whether the action fits. Pure (no DOM, no fetch), so Node
 * tests cover it; the page's glue is utils/memory-guard-ui.js.
 *
 * Why it exists: a tab that runs out of memory does not fail politely. Chrome
 * kills the renderer ("Aw, Snap!") and every panel, filter and focus is gone;
 * with autosave on, reloading restores the set that crashed. The limit that
 * bites is the V8 heap: 4.40 GB under pointer compression, whatever the
 * flags, and the tab dies at about 4.03 GB used (the paper's benchmark,
 * annzarro-paper benchmark/scale/NOTES.md). Large-plot mode drew 175M points
 * and crashed at 182M until v0.4.1, which keeps its positions outside that
 * heap (utils/scattergl-calc.js; 200M then drew with 35 MB of heap); the
 * regular path stops near 5M.
 *
 * The browser cannot be asked how close it is. `performance.memory`
 * counts ArrayBuffers in usedJSHeapSize (so it is not comparable with
 * jsHeapSizeLimit) and, without --enable-precise-memory-info, is bucketed and
 * rarely refreshed; Firefox and Safari have no API at all. So the guard keeps
 * its own LEDGER of what each open panel holds, from cost models fitted per
 * action (fixed + bytes per point, separately for the V8 heap, memory outside
 * it and the GPU), and corrects the total with a measured one when the
 * browser offers it (measureUserAgentSpecificMemory, only under cross-origin
 * isolation). Headroom = ceiling - ledger; an action is checked against it.
 *
 * Every number marked `provisional` comes from reading the code or from
 * run maxima of the benchmark, not from a fit of that action; the
 * measurement plan replaces them (see the docs, Browser memory).
 */

/** GB here are 10^9 bytes, as in the benchmark notes and Chrome's jsHeapSizeLimit (4,395,630,592 = 4.40 GB). */
export const GB = 1e9;
export const MB = 1e6;

/** What the guard does when an action does not fit (ui.memory.enforce). */
export const ENFORCE = ['off', 'warn', 'block'];

/** Defaults of ui.memory (annzarro/config/base.yaml). */
export const DEFAULT_SETTINGS = Object.freeze({
    enforce: 'block',
    heapGb: null,      // null: the browser's own limit (Chrome reports it), else FALLBACK_HEAP_GB
    totalGb: null,     // null: no limit, except on small devices (navigator.deviceMemory)
    margin: 0.2
});

/**
 * The V8 heap a tab may fill, as a share of jsHeapSizeLimit: the benchmark's
 * tab crashed with 4,027,182,277 bytes used and a limit of 4,395,630,592
 * (benchmark/scale/results/heapcap_rerun.jsonl).
 */
export const HEAP_USABLE_SHARE = 4027182277 / 4395630592;
/** The heap ceiling where the browser reports none (Firefox, Safari): Chrome's, which is the tightest known. */
export const FALLBACK_HEAP_GB = 4.40;
/**
 * Total budget where ui.memory.total_gb is not set (GB). The guard cannot
 * see the computer's memory: Chrome reports at most 8 GB (navigator.deviceMemory).
 * - Browser on the server's computer (the server reports its RAM, see
 *   routes/core.py): that RAM less a reserve for the system and the browser,
 *   HOST_RESERVE_SHARE of it and at least HOST_RESERVE_MIN_GB.
 * - Browser on another computer: REMOTE_TOTAL_GB, a budget a 32 GB computer
 *   can give a tab; with the margin it binds just above 200M large-plot
 *   points (13.6 GB of renderer memory measured at 200M).
 * ui.memory.total_gb (server-wide) replaces either.
 */
export const HOST_RESERVE_SHARE = 0.25;
export const HOST_RESERVE_MIN_GB = 4;
export const REMOTE_TOTAL_GB = 16;
/**
 * The largest large plot drawn in a test (synthetic 200M-cell store, every
 * cell, v0.4.1, Chrome on an M3 Max with 128 GB: 13.6 GB renderer, 35 MB of
 * V8 heap). Information only: it refuses nothing. What a browser can hold
 * above it is found by asking it (utils/alloc-probe.js: the draw allocates
 * its buffers before it requests any data); at 250M and up the same
 * machine's tab ran out of array buffers at 15.4 to 17.4 GB.
 */
export const LARGEST_TESTED_POINTS = 200000000;
/** navigator.deviceMemory at or below this (GB) sets a total budget of half of it. */
export const SMALL_DEVICE_GB = 4;
/**
 * Live WebGL contexts a page may hold before the browser drops the oldest
 * (Chrome and Safari: 16). Every Plotly 2D WebGL plot holds two (its context
 * and focus canvases); an export's off-screen plot two more while it runs.
 */
export const MAX_WEBGL_CONTEXTS = 16;
export const CONTEXTS_PER_PLOT = 2;
/** Above this share of the ceiling, an action leaves a crash marker until it finishes. */
export const RISKY_SHARE = 0.7;

/**
 * Bytes per point and fixed bytes, per path. `heap` is the V8 heap, `off`
 * ArrayBuffers and other memory outside it, `gpu` buffers in the GPU process.
 * `resident` is what a drawn plot keeps; `peak` what it needs while drawing.
 *
 * Sources (annzarro-paper benchmark/scale/NOTES.md, Chrome on an M3 Max):
 * - app: 0.17 GB heap, 0.04 GB ArrayBuffers with a 100k-cell plot open
 *   (measured).
 * - large, heap: 0.1 B/point resident, 0.2 peak. Plotly's scattergl calc
 *   keeps positions and point ids as plain Arrays (20.1 B/point of heap,
 *   1.94 GB at 95.6M, 3.53 GB at 175M, a V8 out-of-memory at 200M);
 *   utils/scattergl-calc.js moves them into typed arrays in large-plot
 *   mode. Measured after a forced GC on synthetic stores: 12.3 MB at
 *   2.5M and 12.9 MB at 10M points (0.08 B/point; before the move 62.2 and
 *   212.9 MB, 20.1 B/point); peak 35 MB of V8 heap drawing 200M points.
 * - large, off: 65 B/point beyond the 1 GB client cache: 45 B/point
 *   (5.28 GB at 95.6M, 7.41 GB at 175M; run maxima, the split provisional)
 *   plus the 20 B/point the typed arrays moved there (ArrayBuffers 36.0 ->
 *   56.0 B/point between 2.5M and 10M, measured). Renderer RSS for
 *   comparison: 76 B/point between 2.5M and 10M, 13.56 GB at 200M.
 * - large, gpu: 19 B/point (GPU-process RSS 2.02 GB at 95.6M; 17.0 B/point
 *   between 2.5M and 10M, 3.65 GB at 200M; measured).
 * - regular, colour by gene: 640 B/point heap peak (3.36 GB at 5M, run
 *   maximum); resident 560 (provisional). Categorical and uncoloured plots
 *   are lighter (provisional, from large-plot.js's 400-900 B/point).
 * - regular, off 160 B/point (0.84 GB at 5M) and gpu 56 B/point (0.50 GB
 *   GPU RSS at 5M), run maxima.
 */
export const DEFAULT_MODEL = {
    app: { heap: 0.17 * GB, off: 0.04 * GB },
    panelFixed: { heap: 5 * MB, off: 1 * MB },
    regular: {
        numeric: { resident: 560, peak: 640, provisional: ['resident'] },
        categorical: { resident: 360, peak: 420, provisional: ['resident', 'peak'] },
        none: { resident: 260, peak: 300, provisional: ['resident', 'peak'] },
        off: 160, gpu: 56,
        // a 3D plot (scatter3d) on top of the 2D costs; provisional
        threeD: 1.3
    },
    large: {
        resident: 0.1, peak: 0.2,
        // 65 B plot + 8 B point index (utils/point-index.js: row and cell
        // order, 4 B each, typed arrays); the table-filter mask (1 B) is
        // transient and inside the peak's margin
        off: 73, gpu: 19
    },
    /**
     * Transient costs on top of what the panel holds.
     * - export: a full-resolution export draws the plot again off screen:
     *   Plotly's calc (large: 20 B/point, as typed arrays outside the heap
     *   like the panel's; regular calc, the hover index and per-point
     *   colours, 100 B/point), new GPU buffers, and float32 copies of the
     *   positions on their way to the GPU (16 B/point).
     *   Code-derived, provisional. Its canvas: 4 bytes per pixel, three
     *   copies (canvas, image, encoded file).
     * - recolour: the benchmark recoloured 175M points in large-plot mode
     *   without growing the heap (3.53 GB max); regular 80 B/point. Provisional.
     */
    export: {
        large: { heap: 0.2, off: 36, gpu: 19 },
        regular: { heap: 100, off: 20, gpu: 56 },
        pixelCopies: 3
    },
    recolour: { large: 2, regular: 80 },
    /**
     * Hover labels of a categorical column (a colour of many categories, or
     * a hover column): per point its label's reference and hover text, per
     * distinct label its string, plus while loading the reply's JSON blob.
     * Measured at 1M points (Chromium, heap after GC, hover on minus off):
     * 999,998 barcodes of 21.9 characters +114.1 MB, 65,000 labels of 8
     * characters +37.9 MB, which give 34 B per point and 59 B + 1 B per
     * character per label; the blob adds 3 B + 1 B per character per label.
     */
    hoverLabels: { perPoint: 34, perLabel: 62, perChar: 2 },
    /** A cell table row (DataTables with deferRender): its data array and row object. Provisional. */
    tableRow: { heap: 300 },
    /** Numbers still to be measured (listed by the docs and the report). */
    provisional: [
        'large.off split from the client cache', 'regular resident (all colours)', 'regular categorical/none peak',
        'regular 3D factor', 'export transient (both paths)', 'recolour transient (both paths)', 'table row'
    ]
};

// -- settings and limits -----------------------------------------------------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * ui.memory from /api/v1/config, checked: unknown or malformed values fall
 * back to the defaults rather than disabling the guard.
 * @param {Object} [memory] - the server's ui.memory
 */
export function memorySettings(memory) {
    const m = memory && typeof memory === 'object' ? memory : {};
    // YAML 1.1 reads an unquoted `enforce: off` as false (and `on` as true)
    const e = m.enforce === false ? 'off' : m.enforce === true ? 'block' : String(m.enforce).toLowerCase();
    const enforce = ENFORCE.includes(e) ? e : DEFAULT_SETTINGS.enforce;
    const heapGb = num(m.heap_gb);
    const totalGb = num(m.total_gb);
    const margin = num(m.margin);
    // the server's RAM, which it reports only to a browser on its own computer
    const hostBytes = num(m.host_memory_bytes);
    return {
        enforce,
        heapGb: heapGb !== null && heapGb > 0 ? heapGb : null,
        totalGb: totalGb !== null && totalGb > 0 ? totalGb : null,
        hostBytes: hostBytes !== null && hostBytes > 0 ? hostBytes : null,
        margin: margin !== null && margin >= 0 && margin <= 5 ? margin : DEFAULT_SETTINGS.margin
    };
}

/**
 * The ceilings this browser gives, and where each came from.
 * @param {Object} env - { performance, navigator } (window's, or stubs)
 * @param {Object} settings - memorySettings()
 * @returns {{heap: {bytes: number, source: string}, total: {bytes: number|null, source: string},
 *            contexts: number, browserLimit: boolean}}
 *   heap.bytes is what may be FILLED (the crash point), not the nominal limit.
 */
export function readLimits(env = {}, settings = DEFAULT_SETTINGS) {
    const perf = env.performance;
    const nav = env.navigator;
    const reported = perf && perf.memory && Number(perf.memory.jsHeapSizeLimit) > 0
        ? Number(perf.memory.jsHeapSizeLimit) : null;
    let heap;
    if (settings.heapGb) {
        heap = { bytes: settings.heapGb * GB * HEAP_USABLE_SHARE, source: `ui.memory.heap_gb (${settings.heapGb} GB)` };
    } else if (reported) {
        heap = { bytes: reported * HEAP_USABLE_SHARE, source: `this browser's JS heap limit (${formatGB(reported)})` };
    } else {
        heap = { bytes: FALLBACK_HEAP_GB * GB * HEAP_USABLE_SHARE, source: `Chrome's JS heap limit (${FALLBACK_HEAP_GB} GB); this browser reports none` };
    }
    let total;
    const device = nav && Number(nav.deviceMemory) > 0 ? Number(nav.deviceMemory) : null;
    if (settings.totalGb) {
        total = { bytes: settings.totalGb * GB, source: `ui.memory.total_gb (${settings.totalGb} GB)` };
    } else if (settings.hostBytes) {
        const reserve = Math.max(HOST_RESERVE_SHARE * settings.hostBytes, HOST_RESERVE_MIN_GB * GB);
        total = { bytes: Math.max(0, settings.hostBytes - reserve),
            source: `this computer's ${formatGB(settings.hostBytes)} less ${formatGB(reserve)} for the system and the browser` };
    } else {
        total = { bytes: REMOTE_TOTAL_GB * GB,
            source: `${REMOTE_TOTAL_GB} GB for a browser on another computer than the server (ui.memory.total_gb)` };
    }
    if (device !== null && device <= SMALL_DEVICE_GB && !settings.totalGb && device * GB / 2 < total.bytes) {
        total = { bytes: device * GB / 2, source: `half of this device's ${device} GB` };
    }
    return { heap, total, contexts: MAX_WEBGL_CONTEXTS, browserLimit: !!reported && !settings.heapGb };
}

// -- cost models ---------------------------------------------------------------

/**
 * Colour kind of a Cell Plot's settings for the regular model: 'numeric'
 * (a gene, a numeric obs column, an embedding), 'categorical' or 'none'.
 * @param {Object} settings - panel settings
 * @param {Object} [structure] - the dataset structure (obs.columns_info)
 */
export function colourKind(settings, structure) {
    const c = settings && settings.color;
    if (!c || !c.type || c.type === 'none') return 'none';
    if (c.type === 'obs') {
        const info = structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[c.key];
        if (info && /categor|bool|str|object/i.test(String(info.type))) return 'categorical';
    }
    return 'numeric';
}

/** Zero cost. */
export function zero() {
    return { heap: 0, off: 0, gpu: 0, contexts: 0 };
}

export function addCost(a, b, k = 1) {
    return { heap: a.heap + k * b.heap, off: a.off + k * b.off, gpu: a.gpu + k * b.gpu, contexts: a.contexts + k * b.contexts };
}

/**
 * Whether a redraw of a drawn plot REPLACES it rather than adding to it: a
 * large-plot-mode plot redrawn in large-plot mode (a recolour, a part step,
 * any change there redraws). Measured at 95.6M points: 1.94 GB on the heap
 * before, during (peak 1.96 GB) and after, so the old and the new plot never
 * coexist. The regular path is not measured that way and stays old + new.
 */
export function replacesInPlace(old, large) {
    return !!(old && old.large && large);
}

/**
 * What a draw adds on top of what is held, when `old` is what the panel holds
 * now (null for a new plot): the whole peak, or for a plot replaced in place
 * its growth beyond the old plot, with the margin on the NEW plot's peak:
 * check() multiplies the need by (1 + margin), so the need returned is
 * max(0, peak - old / (1 + margin)), and the check charges
 * max(0, (1 + margin) * peak - old). A same-size redraw is thus still
 * charged margin x its peak (a short spike while V8 frees the old arrays,
 * which a sampled peak can miss); a larger redraw (a subset step up) the
 * whole growth with the margin.
 */
export function drawNeed(peak, old, large, margin = DEFAULT_SETTINGS.margin) {
    if (!replacesInPlace(old, large)) return peak;
    const r = old.resident;
    const k = 1 + margin;
    return { heap: Math.max(0, peak.heap - r.heap / k), off: Math.max(0, peak.off - r.off / k),
        gpu: Math.max(0, peak.gpu - r.gpu / k), contexts: 0 };
}

/**
 * What a plot or table panel holds once drawn (`resident`) and needs while
 * it is drawn (`peak`, which includes the resident part).
 * @param {Object} p
 * @param {string} p.kind - 'cell-plot' | 'gene-plot' | 'cell-table' | 'gene-table' | other
 * @param {number} p.n - points (plots) or rows (tables)
 * @param {boolean} [p.large] - large-plot mode (Cell Plots above the threshold)
 * @param {string} [p.colour] - colourKind()
 * @param {boolean} [p.threeD]
 * @param {Object} [model]
 * @returns {{resident: Object, peak: Object}}
 */
export function panelCost({ kind, n, large = false, colour = 'numeric', threeD = false }, model = DEFAULT_MODEL) {
    const pts = Math.max(0, Number(n) || 0);
    const fixed = { heap: model.panelFixed.heap, off: model.panelFixed.off, gpu: 0, contexts: 0 };
    if (kind === 'cell-table' || kind === 'gene-table') {
        const c = addCost(fixed, { heap: model.tableRow.heap * pts, off: 0, gpu: 0, contexts: 0 });
        return { resident: c, peak: c };
    }
    if (kind !== 'cell-plot' && kind !== 'gene-plot') {
        return { resident: fixed, peak: fixed };
    }
    if (large) {
        const L = model.large;
        const base = { heap: 0, off: L.off * pts, gpu: L.gpu * pts, contexts: CONTEXTS_PER_PLOT };
        return {
            resident: addCost(fixed, { ...base, heap: L.resident * pts }),
            peak: addCost(fixed, { ...base, heap: L.peak * pts })
        };
    }
    const R = model.regular;
    const c = R[colour] || R.numeric;
    const f = threeD ? R.threeD : 1;
    const base = { heap: 0, off: R.off * pts * f, gpu: R.gpu * pts * f, contexts: CONTEXTS_PER_PLOT };
    return {
        resident: addCost(fixed, { ...base, heap: c.resident * pts * f }),
        peak: addCost(fixed, { ...base, heap: c.peak * pts * f })
    };
}

/**
 * What a full-resolution image export needs while it runs, on top of what
 * the panel holds. Its cost is the points, not the pixels: a smaller or
 * lower-scale image needs nearly as much.
 * @param {Object} p - { n, large, width, height, scale }
 */
export function exportCost({ n, large = false, width = 1200, height = 800, scale = 1 }, model = DEFAULT_MODEL) {
    const pts = Math.max(0, Number(n) || 0);
    const e = large ? model.export.large : model.export.regular;
    const pixels = Math.max(1, width) * Math.max(1, height) * Math.max(1, scale) ** 2;
    return {
        heap: e.heap * pts + 4 * pixels,
        off: e.off * pts + 4 * pixels * model.export.pixelCopies,
        gpu: e.gpu * pts,
        contexts: CONTEXTS_PER_PLOT
    };
}

/** What an export "as shown" needs: the drawn canvases and one image, never the points. */
export function snapshotCost({ width = 1200, height = 800, ratio = 2 }, model = DEFAULT_MODEL) {
    const pixels = Math.max(1, width) * Math.max(1, height) * Math.max(1, ratio) ** 2;
    return { heap: 4 * pixels, off: 4 * pixels * model.export.pixelCopies, gpu: 0, contexts: 0 };
}

/**
 * What reading the hover labels of a categorical column needs: `labels`
 * distinct labels of `chars` characters on average, over `points` points.
 */
export function labelCost({ points, labels, chars }, model = DEFAULT_MODEL) {
    const m = model.hoverLabels;
    const n = Math.max(0, Number(labels) || 0);
    const heap = Math.max(0, Number(points) || 0) * m.perPoint + n * (m.perLabel + m.perChar * Math.max(0, Number(chars) || 0));
    return { heap, off: 0, gpu: 0, contexts: 0 };
}

/** The extra a recolour of a drawn plot needs while it runs. */
export function recolourCost({ n, large = false }, model = DEFAULT_MODEL) {
    const pts = Math.max(0, Number(n) || 0);
    return { heap: (large ? model.recolour.large : model.recolour.regular) * pts, off: 0, gpu: 0, contexts: 0 };
}

// -- the ledger ------------------------------------------------------------------

/**
 * What each open panel holds. A panel is RESERVED when its draw starts
 * (so panels drawn at the same time, a restored panel set or a subset
 * change, see each other) and COMMITTED when it is drawn; a closed panel
 * is removed. Totals add the app's own baseline and the client cache.
 */
export class Ledger {
    constructor(model = DEFAULT_MODEL) {
        this.model = model;
        this.entries = new Map();     // id -> {kind, n, large, colour, threeD, resident, peak, title}
        this.pending = new Map();     // id -> same, while drawing (the panel's latest draw)
        this._drawing = new Map();    // token -> entry, every draw not yet settled
        this._seq = 0;
        this.cacheBytes = 0;
        this.observed = null;         // {bytes, at, source}: a measured total, when the browser gives one
        this._listeners = new Set();
    }

    onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _changed() { for (const fn of this._listeners) { try { fn(this); } catch { /* a listener's problem */ } } }

    _entry(id, p) {
        const c = panelCost(p, this.model);
        return { id, kind: p.kind, n: p.n, large: !!p.large, colour: p.colour, threeD: !!p.threeD, title: p.title || id,
            resident: c.resident, peak: c.peak };
    }

    /**
     * A draw of panel `id` starts; until commit or cancel it counts at its
     * peak. Returns the draw's token: a panel can start a second draw before
     * the first one ends (init and the dataset's arrival both draw), and
     * the first one's end must not settle the second one's reservation.
     */
    reserve(id, p) {
        const token = ++this._seq;
        const e = { ...this._entry(id, p), token };
        this.pending.set(id, e);
        this._drawing.set(token, e);
        this._changed();
        return token;
    }

    /**
     * The draw finished: the panel now holds its resident cost. With a
     * token, that draw's reservation; with `p`, that cost; else the
     * panel's current reservation.
     */
    commit(id, p = null, token = null) {
        const e = p ? this._entry(id, p) : (token ? this._drawing.get(token) : this.pending.get(id));
        if (token) this._drawing.delete(token);
        const cur = this.pending.get(id);
        if (cur && (!token || cur.token === token)) this.pending.delete(id);
        if (e) this.entries.set(id, e);
        this._changed();
    }

    /** The draw did not happen (aborted, refused, failed): what was held before stays. */
    cancel(id, token = null) {
        if (token) this._drawing.delete(token);
        const cur = this.pending.get(id);
        if (cur && (!token || cur.token === token)) {
            this.pending.delete(id);
            this._changed();
        }
    }

    /** The panel was closed or emptied. */
    remove(id) {
        const a = this.entries.delete(id);
        const b = this.pending.delete(id);
        for (const [t, e] of this._drawing) if (e.id === id) this._drawing.delete(t);
        if (a || b) this._changed();
    }

    setCacheBytes(bytes) {
        const b = Math.max(0, Number(bytes) || 0);
        if (b !== this.cacheBytes) { this.cacheBytes = b; this._changed(); }
    }

    /** A measured total (bytes of the page, heap and ArrayBuffers), e.g. measureUserAgentSpecificMemory. */
    observe(bytes, source) {
        if (!(bytes > 0)) return;
        this.observed = { bytes: Number(bytes), at: Date.now(), source };
        this._changed();
    }

    get(id) { return this.entries.get(id) || null; }

    /** Panels holding memory now (committed, or reserved and drawing). */
    panels() {
        const out = new Map(this.entries);
        for (const [id, e] of this.pending) out.set(id, e);
        return [...out.values()];
    }

    /**
     * The total held, excluding `exclude` (ids whose cost the caller
     * accounts for itself). A drawing panel counts at its peak, plus what it
     * held before (the old plot stays until the new one replaces it).
     */
    totals({ exclude = [] } = {}) {
        const skip = new Set(exclude);
        let t = { heap: this.model.app.heap, off: this.model.app.off + this.cacheBytes, gpu: 0, contexts: 0 };
        for (const [id, e] of this.entries) if (!skip.has(id)) t = addCost(t, e.resident);
        for (const [id, e] of this.pending) if (!skip.has(id)) t = addCost(t, e.peak);
        return t;
    }

    /** Cell Plots counted (committed or drawing), for "with N panels open". */
    plotCount() {
        return this.panels().filter(e => e.kind === 'cell-plot' || e.kind === 'gene-plot').length;
    }
}

// -- the check ---------------------------------------------------------------------

/**
 * Free memory against each ceiling, after `held`.
 * @returns {{heap: number, total: number|null, contexts: number}}
 */
export function headroom(held, limits) {
    return {
        heap: limits.heap.bytes - held.heap,
        total: limits.total.bytes === null ? null : limits.total.bytes - (held.heap + held.off),
        contexts: limits.contexts - held.contexts
    };
}

/**
 * Whether an action that needs `need` (on top of `held`) fits, and the
 * sentence that says why not.
 * @param {Object} need - {heap, off, gpu, contexts}: what the action adds at its peak
 * @param {Object} held - Ledger.totals() for everything else
 * @param {Object} limits - readLimits()
 * @param {Object} settings - memorySettings()
 * @param {Object} [opts]
 * @param {number} [opts.observed] - a measured total of held memory (bytes); the larger of it and the estimate counts
 * @param {number} [opts.panels] - plot panels open (for the sentence)
 * @returns {{verdict: 'ok'|'warn'|'block', fits: boolean, risky: boolean, binding: string|null,
 *            needBytes: number, freeBytes: number, limitBytes: number, measured: boolean, why: string}}
 */
export function check(need, held, limits, settings = DEFAULT_SETTINGS, opts = {}) {
    const k = 1 + settings.margin;
    let held2 = held;
    const measured = opts.observed > 0 && opts.observed > held.heap + held.off;
    if (measured) {
        // the measured total says more is held than the ledger knows: the
        // difference is charged to the heap, the binding ceiling
        held2 = { ...held, heap: held.heap + (opts.observed - (held.heap + held.off)) };
    }
    const free = headroom(held2, limits);
    const checks = [];
    checks.push({ name: 'heap', need: need.heap * k, free: free.heap, limit: limits.heap.bytes });
    if (free.total !== null) checks.push({ name: 'total', need: (need.heap + need.off) * k, free: free.total, limit: limits.total.bytes });
    let binding = null;
    for (const c of checks) {
        if (c.need > c.free && (!binding || c.need - c.free > binding.need - binding.free)) binding = c;
    }
    const contextsShort = need.contexts > 0 && need.contexts > free.contexts;
    const fits = !binding && !contextsShort;
    const main = checks[0];
    const shown = binding || main;
    const risky = fits && (held2.heap + need.heap * k) > RISKY_SHARE * limits.heap.bytes;
    let why = '';
    if (binding) {
        const word = binding.name === 'heap' ? 'JS memory' : 'memory';
        why = `needs ~${formatGB(binding.need)} of browser ${word}; ${formatGB(Math.max(0, binding.free))} free`
            + (opts.panels ? ` with ${opts.panels} plot${opts.panels === 1 ? '' : 's'} open` : '')
            + ` (of ${formatGB(binding.limit)}${measured ? ', measured' : ', estimated'})`;
    } else if (contextsShort) {
        why = `the browser keeps at most ${limits.contexts} WebGL canvases; ${limits.contexts - free.contexts} are in use`
            + ' and the oldest plot would go blank';
    }
    const verdict = fits || settings.enforce === 'off' ? 'ok' : settings.enforce === 'warn' ? 'warn' : 'block';
    return {
        verdict, fits, risky, binding: binding ? binding.name : (contextsShort ? 'contexts' : null),
        needBytes: shown.need, freeBytes: Math.max(0, shown.free), limitBytes: shown.limit, measured, why
    };
}

/**
 * The largest n in [lo, hi] for which `fits(n)` holds, assuming it is
 * monotone (more points never cost less); `lo - 1` when none does.
 */
export function largestFitting(fits, lo, hi) {
    let a = Math.max(0, Math.floor(lo)), b = Math.floor(hi);
    if (b < a) return a - 1;
    if (fits(b)) return b;
    if (!fits(a)) return a - 1;
    while (b - a > 1) {
        const mid = Math.floor((a + b) / 2);
        if (fits(mid)) a = mid; else b = mid;
    }
    return a;
}

/**
 * What changing the subset to `n` cells costs: every open Cell Plot and
 * cell table is redrawn at once (notifyEach), each plot keeping its old
 * points until the new ones replace them. Gene panels do not change.
 * @param {number} n - cells after the change
 * @param {Array} panels - Ledger.panels() (or {kind, n, large, colour, threeD} for open panels)
 * @param {number} threshold - large-plot mode above this many points
 * @returns {{peak: Object, after: Object, changed: number}} peak and after
 *   include the unchanged panels; the caller adds app and cache (Ledger.totals of nothing)
 */
export function predictSubsetChange(n, panels, threshold, model = DEFAULT_MODEL, canLarge = () => true,
    margin = DEFAULT_SETTINGS.margin) {
    let peak = zero(), after = zero(), changed = 0;
    for (const p of panels) {
        const old = p.resident || panelCost(p, model).resident;
        if (p.kind === 'cell-plot' || p.kind === 'cell-table') {
            const large = p.kind === 'cell-plot' && n > threshold && canLarge(p);
            const c = panelCost({ ...p, n, large }, model);
            // a large plot redrawn large replaces itself; anything else keeps
            // its old points until the new ones are drawn
            peak = addCost(peak, replacesInPlace(p, large) ? addCost(old, drawNeed(c.peak, p, large, margin)) : addCost(old, c.peak));
            after = addCost(after, c.resident);
            changed++;
        } else {
            peak = addCost(peak, old);
            after = addCost(after, old);
        }
    }
    return { peak, after, changed };
}

// -- words -----------------------------------------------------------------------

/** "0.8 GB", "120 MB": rounded, so it does not look more precise than it is. */
export function formatGB(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b >= GB) {
        const g = b / GB;
        return `${g >= 10 ? Math.round(g) : g.toFixed(1)} GB`;
    }
    const m = b / MB;
    return `${m >= 100 ? Math.round(m / 10) * 10 : Math.max(1, Math.round(m))} MB`;
}

/** The one-line headroom statement (subset dialog footer, status strip popovers). */
export function headroomLine(held, limits, { panels = 0, measured = false } = {}) {
    const free = headroom(held, limits);
    const parts = [`Browser memory: ${formatGB(Math.max(0, free.heap))} of ${formatGB(limits.heap.bytes)} JS memory free`];
    if (free.total !== null) parts.push(`${formatGB(Math.max(0, free.total))} of ${formatGB(limits.total.bytes)} in total`);
    return `${parts.join(', ')} with ${panels} plot${panels === 1 ? '' : 's'} open (${measured ? 'measured' : 'estimated'})`;
}

// -- crash marker ------------------------------------------------------------------

export const CRASH_KEY = 'annzarro_memory_pending';

/**
 * Before an action that comes close to the ceiling: note it, so that if
 * the tab dies the next load knows which panel did it. `storage` is
 * localStorage (or a stub); failures to write are ignored.
 */
export function markPending(storage, action) {
    try {
        storage.setItem(CRASH_KEY, JSON.stringify({ ...action, at: Date.now() }));
    } catch { /* private window, quota: no marker */ }
}

export function clearPending(storage) {
    try { storage.removeItem(CRASH_KEY); } catch { /* nothing to clear */ }
}

/**
 * The action the previous page was running when it died, or null; reading
 * it clears it. Markers older than a day are ignored (a stale tab).
 */
export const LEARNED_MARGIN_KEY = 'annzarro_memory_margin';
const MAX_LEARNED_MARGIN = 1;

/**
 * Extra margin this browser has earned by crashing: each crash during a
 * marked action adds 0.25 (at most 1), kept in localStorage. A model that
 * under-predicted once is trusted less from then on.
 */
export function learnedMargin(storage) {
    try {
        const v = Number(storage.getItem(LEARNED_MARGIN_KEY));
        return Number.isFinite(v) && v > 0 ? Math.min(MAX_LEARNED_MARGIN, v) : 0;
    } catch {
        return 0;
    }
}

export function learnFromCrash(storage) {
    const next = Math.min(MAX_LEARNED_MARGIN, learnedMargin(storage) + 0.25);
    try { storage.setItem(LEARNED_MARGIN_KEY, String(next)); } catch { /* not kept */ }
    return next;
}

export function takeCrashed(storage, now = Date.now()) {
    let raw;
    try { raw = storage.getItem(CRASH_KEY); } catch { return null; }
    clearPending(storage);
    if (!raw) return null;
    try {
        const a = JSON.parse(raw);
        return a && typeof a === 'object' && now - Number(a.at) < 24 * 3600 * 1000 ? a : null;
    } catch {
        return null;
    }
}
