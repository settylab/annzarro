/**
 * The allocation probe: ask the browser for the memory a step needs before
 * the step starts, and read its answer.
 *
 * The RAM budget (memory-guard.js) protects the machine: a page gets no
 * memory-pressure signal, and an allocation can succeed by swapping. It
 * cannot say what this browser will give the tab. A tab fails inside
 * itself, at a size no table knows: `RangeError: Array buffer allocation
 * failed` came at 15.4 to 17.4 GB of renderer memory on a 128 GB machine
 * (v0.4.1, 250M points and up). Typed-array allocation is catchable, so the
 * large-plot path (large-plot.js) allocates the buffers it will need first:
 *
 *   - `transient` parts stand for the rest of the draw's off-heap peak (the
 *     guard model's 65 B per point less the build buffers: response bodies,
 *     Plotly's calc and trace pieces, staging copies); they are allocated
 *     together with the rest to test the peak, then handed back before the
 *     requests go out;
 *   - the other parts are the build buffers (group keys, grouped x and y);
 *     the draw fills these very buffers, so the probe costs no second
 *     allocation.
 *
 * If any allocation throws, everything is released, no request is sent, and
 * the panel says so and offers a subset (probeMessage).
 *
 * A V8 heap out-of-memory is a renderer crash and cannot be caught; the
 * large-plot path keeps its per-point series off that heap. The probe covers
 * ArrayBuffers only; a lost WebGL context is handled by the plot itself
 * (large-plot.js watchGpu).
 *
 * Pure: no DOM, no imports. The allocator is injectable (setAllocator, or
 * `window.__annzarroAllocator` for browser tests).
 */

const TYPES = {
    u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array
};
export const BYTES = { u8: 1, u16: 2, u32: 4, f32: 4, f64: 8 };

/** Steps whose off-heap need is below this (bytes) are not probed (a few MB: any browser has them). */
export const PROBE_MIN_BYTES = 256 * 1024 * 1024;

let _allocator = null;

/** Replace the allocator `(type, length) => TypedArray` (tests); null restores the real one. */
export function setAllocator(fn) {
    _allocator = typeof fn === 'function' ? fn : null;
}

/**
 * The allocator in force: the one set by setAllocator, else a page-level
 * hook (`window.__annzarroAllocator`, for browser tests), else the real one.
 */
export function allocate(type, length) {
    if (_allocator) return _allocator(type, length);
    const hook = typeof globalThis !== 'undefined' ? globalThis.__annzarroAllocator : null;
    if (typeof hook === 'function') return hook(type, length);
    return new TYPES[type](length);
}

/** Whether `error` is the browser refusing an allocation (a RangeError). */
export function isAllocationFailure(error) {
    return !!error && (error instanceof RangeError || error.name === 'RangeError');
}

/** Give an array's memory back now rather than at garbage collection (detach its buffer). */
export function freeNow(array) {
    try {
        const b = array && array.buffer;
        if (b && typeof b.transfer === 'function' && !b.detached) b.transfer(0);
    } catch { /* not detachable: the collector gets it */ }
}

/**
 * Allocate `parts` ({name, type, length, transient?}) in order.
 * @param {Array} parts
 * @param {Object} [opts]
 * @param {Function} [opts.alloc] - `(type, length) => TypedArray`
 * @returns {{ok: boolean, buffers: Object, bytes: number, failed: string|null,
 *   failedBytes: number, error: Error|null, release: Function}}
 *   `buffers` holds the kept parts by name; `release()` frees them. On a
 *   failure nothing is held and `failed` names the part that did not fit.
 *   An error that is not a RangeError is thrown.
 */
export function probe(parts, { alloc = allocate } = {}) {
    const got = [];
    let bytes = 0;
    const freeAll = () => { for (const g of got) freeNow(g.array); got.length = 0; };
    for (const p of parts) {
        const need = p.length * BYTES[p.type];
        let array;
        try {
            array = alloc(p.type, p.length);
        } catch (error) {
            if (!isAllocationFailure(error)) throw error;
            freeAll();
            return { ok: false, buffers: {}, bytes, failed: p.name, failedBytes: need, error, release() {} };
        }
        got.push({ name: p.name, array, transient: !!p.transient });
        bytes += need;
    }
    const buffers = {};
    for (const g of got) {
        if (g.transient) freeNow(g.array); else buffers[g.name] = g.array;
    }
    const kept = got.filter(g => !g.transient);
    return {
        ok: true, buffers, bytes, failed: null, failedBytes: 0, error: null,
        release() { for (const g of kept) freeNow(g.array); kept.length = 0; }
    };
}

/** Transient blocks are cut into pieces of this many bytes: the sum is what is tested, not one contiguous run. */
export const CHUNK_BYTES = 512 * 1024 * 1024;

/** `bytes` as transient u8 parts (a step's transient buffers: an export, a label table, a draw's peak). */
export function blockParts(bytes, name = 'block') {
    const parts = [];
    let left = Math.max(1, Math.ceil(bytes));
    for (let i = 0; left > 0; i++) {
        const c = Math.min(left, CHUNK_BYTES);
        parts.push({ name: `${name}-${i}`, type: 'u8', length: c, transient: true });
        left -= c;
    }
    return parts;
}

/**
 * What a large plot of `n` points needs from the browser's off-heap memory
 * while it draws: `offPerPoint` bytes per point (the guard model's
 * large.off, 65 B: response bodies, Plotly's calc and trace pieces, staging
 * copies, all measured as renderer memory), of which the build buffers are
 * kept and reused by the draw (group keys, grouped x and y, and the
 * log-scaled colour) and the rest is a transient block, allocated for the
 * test and freed before the data is requested.
 * @param {number} n
 * @param {Object} [o]
 * @param {boolean} [o.log] - numeric colour on a log scale
 * @param {number} [o.offPerPoint] - guard model large.off
 */
export function largePlotParts(n, { log = false, offPerPoint = 65 } = {}) {
    const kept = [
        { name: 'key', type: 'u16', length: n },
        { name: 'X', type: 'f32', length: n },
        { name: 'Y', type: 'f32', length: n }
    ];
    if (log) kept.unshift({ name: 'logged', type: 'f32', length: n });
    const keptPerPoint = kept.reduce((a, p) => a + BYTES[p.type], 0);
    const transient = Math.max(0, n * offPerPoint - n * keptPerPoint);
    return [...(transient > 0 ? blockParts(transient, 'peak') : []), ...kept];
}

const _sep = (v) => Math.round(v).toLocaleString('en-US');

/** 1, 2, 5 times a power of ten, at most `v` (at least 1). */
export function niceFloor(v) {
    if (!(v >= 1)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

/**
 * A subset size this browser can hold, found by probing smaller sizes, or
 * null when none above `floor` fits. Sizes shrink by a quarter; the one that
 * fits is cut again by 20% (the plot then also needs the browser's own
 * buffers) and rounded down to 1, 2 or 5 times a power of ten.
 * @param {number} n - the size that did not fit
 * @param {(size:number)=>Array} partsFor
 */
export function suggestSize(n, partsFor, { alloc = allocate, floor = 1000, steps = 40 } = {}) {
    let size = n;
    for (let i = 0; i < steps; i++) {
        size = Math.floor(size * 0.75);
        if (size < floor) return null;
        const r = probe(partsFor(size), { alloc });
        if (r.ok) {
            r.release();
            return Math.max(floor, niceFloor(size * 0.8));
        }
    }
    return null;
}

/**
 * The sentence for a plot that did not fit: "This browser cannot hold N
 * points; use a subset (k parts of m)".
 * @param {number} n - points that did not fit
 * @param {number|null} size - suggested subset size (suggestSize)
 * @param {number} [eligible] - cells the parts are cut from (the dataset)
 */
export function probeMessage(n, size, eligible = n) {
    const head = `This browser cannot hold ${_sep(n)} points`;
    if (!size) return `${head}; use a much smaller subset`;
    const parts = Math.max(1, Math.ceil(Number(eligible) / size));
    return `${head}; use a subset (${_sep(parts)} part${parts === 1 ? '' : 's'} of ${_sep(size)})`;
}

/** Thrown by a draw whose probe failed: carries the sentence and the numbers. */
export class AllocationProbeError extends Error {
    constructor(message, detail = {}) {
        super(message);
        this.name = 'AllocationProbeError';
        Object.assign(this, detail);
    }
}

/**
 * The probe of a large-plot draw of `n` points: the buffers to fill, or an
 * AllocationProbeError (message with the subset to use) thrown before the
 * caller has requested anything.
 * @param {Object} o
 * @param {number} o.n - points
 * @param {boolean} [o.log]
 * @param {number} [o.offPerPoint] - guard model large.off
 * @param {number} [o.eligible] - cells the subset parts are cut from
 * @param {Function} [o.alloc] - injectable allocator
 * @returns {{key, X, Y, logged?}}
 */
export function probeForDraw({ n, log = false, offPerPoint = 65, eligible = n, alloc = allocate }) {
    const opts = { log, offPerPoint };
    const r = probe(largePlotParts(n, opts), { alloc });
    if (r.ok) return r.buffers;
    const size = suggestSize(n, m => largePlotParts(m, opts),
        { alloc, floor: Math.min(1000, Math.max(1, Math.floor(n / 100))) });
    throw new AllocationProbeError(probeMessage(n, size, eligible),
        { n, size, failed: r.failed, failedBytes: r.failedBytes, cause: r.error });
}
