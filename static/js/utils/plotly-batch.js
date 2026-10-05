/**
 * Batch every Plotly edit of one graph into a single Plotly.react.
 *
 * An incremental plot update (a new colour column, a filter, a focus change)
 * is a sequence of edits made by separate helpers: unsort the points, write
 * the new colours, restate the coverage annotation, label the hover, set the
 * log colour bar ticks, sort by colour again, move the focus highlight, apply
 * the aesthetics, place the legend. Each was its own Plotly.restyle or
 * relayout, and each restyle of a 100,000-point scattergl trace recomputed
 * and redrew all of it: recolouring by a new gene spent about 1.8 s in the
 * browser for 0.1 s of server time.
 *
 * Inside `withPlotlyBatch(gd, fn)` those calls do not reach Plotly for `gd`.
 * restyle, relayout, update, addTraces and deleteTraces are applied to a copy
 * of the graph's input (`gd.data`, `gd.layout`) with Plotly's own semantics
 * for what the helpers send (attribute paths, one value per trace, `null`
 * deletes, the implied edits below), and helpers that read `gd.data` /
 * `gd.layout` in between see the edited copy. At the end the copy is drawn
 * once with Plotly.react. The result is the figure the separate calls left
 * behind, computed and drawn once.
 *
 * Calls for other graphs pass straight through. Any other Plotly function
 * called on a batched graph (newPlot, react, purge, toImage, ...) first draws
 * the batch, so it sees the graph as the sequential calls would have left it.
 *
 * Deprecated keys are renamed as Plotly renames them before applying an edit
 * (`titleside` -> `title.side`, `titlefont` -> `title.font`, a string `title`
 * -> `title.text`, ...); a stale `title.side` otherwise survives a restyle of
 * `titleside`.
 *
 * Implied edits reproduced (plotly.js 2.x attribute `impliedEdits`): setting
 * `cmin`/`cmax` sets `cauto: false`, `zmin`/`zmax` sets `zauto: false`,
 * `colorscale` sets `autocolorscale: false`, and an axis `range` (or one of its
 * ends) sets that axis's `autorange: false`, unless the same call sets them.
 */

import { syncSceneCamera } from './scene-camera.js';

const VIRTUAL = new Set(['restyle', 'relayout', 'update', 'addTraces', 'deleteTraces']);

const _batches = new Map();   // gd -> { data, layout, origData, origLayout }
let _enabled = true;
let _real = null;             // the Plotly object the router stands in for
let _router = null;

function _isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
        && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/**
 * Copy the containers of a figure input, not its data: plain objects and
 * arrays of objects are copied (helpers edit them), arrays of values and
 * typed arrays are shared (edits replace them, never write into them).
 */
export function copyContainers(v) {
    if (_isPlainObject(v)) {
        const out = {};
        for (const k of Object.keys(v)) out[k] = copyContainers(v[k]);
        return out;
    }
    if (Array.isArray(v) && v.some(x => _isPlainObject(x) || Array.isArray(x))) {
        return v.map(copyContainers);
    }
    return v;
}

/** 'marker.colorbar.x' -> ['marker', 'colorbar', 'x']; 'annotations[2].text' -> ['annotations', 2, 'text'] */
function _parts(path) {
    const out = [];
    for (const piece of path.split('.')) {
        const m = piece.match(/^([^[\]]*)((?:\[\d+\])*)$/);
        if (!m) { out.push(piece); continue; }
        if (m[1]) out.push(m[1]);
        for (const idx of m[2].match(/\d+/g) || []) out.push(Number(idx));
    }
    return out;
}

/** Set `path` in `container` as Plotly's nestedProperty does: null deletes. */
export function setPath(container, path, value) {
    const parts = _parts(path);
    let node = container;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (node[key] === undefined || node[key] === null || typeof node[key] !== 'object') {
            if (value === null) return;      // nothing to delete
            node[key] = typeof parts[i + 1] === 'number' ? [] : {};
        }
        node = node[key];
    }
    const last = parts[parts.length - 1];
    if (value === null) {
        if (Array.isArray(node) && typeof last === 'number') node[last] = null;
        else delete node[last];
    } else {
        node[last] = value;
    }
}

function _explicit(aobj, path) {
    if (path in aobj) return true;
    // a parent of `path` set in the same call wins as well
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) if (parts.slice(0, i).join('.') in aobj) return true;
    return false;
}

const OLD_TITLE_KEY = /(^|axis\d*\.|colorbar\.)title$/;
const RENAMED = [['titlefont', 'title.font'], ['titleposition', 'title.position'],
                 ['titleside', 'title.side'], ['titleoffset', 'title.offset']];

/** The edit with deprecated keys renamed, as plotly.js cleanDeprecatedAttributeKeys does. */
export function cleanKeys(aobj) {
    const out = {};
    for (const [key, value] of Object.entries(aobj)) {
        let name = key;
        if (OLD_TITLE_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
            name = key.replace(/title$/, 'title.text');
        } else if (key.includes('titlefont') && !key.includes('grouptitlefont')) {
            name = key.replace('titlefont', 'title.font');
        } else {
            for (const [old, renamed] of RENAMED.slice(1)) {
                if (key.includes(old)) { name = key.replace(old, renamed); break; }
            }
        }
        out[name] = value;
    }
    return out;
}

const TRACE_IMPLIED = { cmin: ['cauto', false], cmax: ['cauto', false], zmin: ['zauto', false],
                        zmax: ['zauto', false], colorscale: ['autocolorscale', false] };

function _sibling(path, leaf) {
    const i = path.lastIndexOf('.');
    return i < 0 ? leaf : `${path.slice(0, i)}.${leaf}`;
}

export function applyRestyle(data, layout, aobj, value, traces) {
    if (typeof aobj === 'string') aobj = { [aobj]: value };
    else traces = value;
    aobj = cleanKeys(aobj);
    let indices;
    if (traces === undefined || traces === null) indices = data.map((_, i) => i);
    else indices = (Array.isArray(traces) ? traces : [traces]).map(i => (i < 0 ? data.length + i : i));
    for (const [attr, vi] of Object.entries(aobj)) {
        if (attr.startsWith('LAYOUT')) {
            setPath(layout, attr.slice(6), Array.isArray(vi) ? vi[0] : vi);
            continue;
        }
        const leaf = attr.slice(attr.lastIndexOf('.') + 1);
        indices.forEach((traceIndex, i) => {
            const trace = data[traceIndex];
            const newVal = Array.isArray(vi) ? vi[i % vi.length] : vi;
            if (!trace || newVal === undefined) return;
            const implied = TRACE_IMPLIED[leaf];
            if (implied && newVal !== null) {
                const target = _sibling(attr, implied[0]);
                if (!_explicit(aobj, target)) setPath(trace, target, implied[1]);
            }
            setPath(trace, attr, newVal);
        });
    }
}

const AXIS_RANGE = /^((?:scene\d*\.)?[xyz]axis\d*)\.range(\[[01]\])?$/;

export function applyRelayout(layout, aobj, value) {
    if (typeof aobj === 'string') aobj = { [aobj]: value };
    aobj = cleanKeys(aobj);
    for (const [attr, v] of Object.entries(aobj)) {
        if (v === undefined) continue;
        const range = attr.match(AXIS_RANGE);
        if (range && v !== null && !_explicit(aobj, `${range[1]}.autorange`)) {
            setPath(layout, `${range[1]}.autorange`, false);
        }
        setPath(layout, attr, v);
    }
}

function _addTraces(data, traces, newIndices) {
    const list = (Array.isArray(traces) ? traces : [traces]).map(copyContainers);
    if (newIndices === undefined || newIndices === null) {
        data.push(...list);
        return;
    }
    const at = (Array.isArray(newIndices) ? newIndices : [newIndices]).map(i => (i < 0 ? data.length + i + 1 : i));
    list.forEach((t, k) => data.splice(at[k], 0, t));
}

function _deleteTraces(data, indices) {
    const list = (Array.isArray(indices) ? indices : [indices]).map(i => (i < 0 ? data.length + i : i));
    [...new Set(list)].sort((a, b) => b - a).forEach(i => data.splice(i, 1));
}

function _virtual(name, gd, args) {
    const b = _batches.get(gd);
    if (name === 'restyle') applyRestyle(b.data, b.layout, args[0], args[1], args[2]);
    else if (name === 'relayout') applyRelayout(b.layout, args[0], args[1]);
    else if (name === 'update') {
        if (args[0]) applyRestyle(b.data, b.layout, args[0], args[2]);
        if (args[1]) applyRelayout(b.layout, args[1]);
    } else if (name === 'addTraces') _addTraces(b.data, args[0], args[1]);
    else if (name === 'deleteTraces') _deleteTraces(b.data, args[0]);
    return Promise.resolve(gd);
}

function _install() {
    if (_router || typeof globalThis.Plotly === 'undefined') return;
    _real = globalThis.Plotly;
    _router = new Proxy(_real, {
        get(target, key) {
            const value = target[key];
            if (typeof value !== 'function') return value;
            if (VIRTUAL.has(key)) {
                return (gd, ...args) => (_batches.has(gd) ? _virtual(key, gd, args) : value.call(target, gd, ...args));
            }
            return (...args) => {
                if (_batches.has(args[0])) _draw(args[0]);
                return value.apply(target, args);
            };
        }
    });
    globalThis.Plotly = _router;
}

function _uninstall() {
    if (_batches.size || !_router) return;
    if (globalThis.Plotly === _router) globalThis.Plotly = _real;
    _router = null;
    _real = null;
}

function _end(gd) {
    const b = _batches.get(gd);
    _batches.delete(gd);
    // Put the graph's own input back, so react diffs against what is drawn.
    if (gd.data === b.data) gd.data = b.origData;
    if (gd.layout === b.layout) gd.layout = b.origLayout;
    return b;
}

/** Draw a batch now (the batch ends). Resolves when Plotly has drawn it. */
function _draw(gd) {
    const real = _real;
    const b = _end(gd);
    _uninstall();
    if (gd.data !== b.origData) return Promise.resolve(gd);   // replaced meanwhile (newPlot)
    syncSceneCamera(gd);
    return real.react(gd, b.data, b.layout);
}


/**
 * Run `fn` with the Plotly edits of `gd` batched, then draw them once.
 * When `fn` throws, nothing it edited is drawn and the error propagates.
 * Without Plotly, or for a graph that is not drawn yet, `fn` just runs.
 * @param {HTMLElement} gd - The Plotly graph div.
 * @param {() => Promise<*>|*} fn
 * @returns {Promise<*>} What `fn` returned, after the batch is drawn.
 */
export async function withPlotlyBatch(gd, fn) {
    if (!_enabled || !gd || _batches.has(gd) || typeof globalThis.Plotly === 'undefined'
            || !Array.isArray(gd.data)) {
        return fn();
    }
    _install();
    // the copy below starts from the camera on screen
    syncSceneCamera(gd);
    const origData = gd.data;
    const origLayout = gd.layout || {};
    const b = { origData, origLayout, data: origData.map(copyContainers), layout: copyContainers(origLayout) };
    _batches.set(gd, b);
    gd.data = b.data;
    gd.layout = b.layout;
    let result;
    try {
        result = await fn();
        // Let promise chains the helpers started (a highlight's add-then-
        // relayout) finish into the batch.
        await new Promise(resolve => setTimeout(resolve, 0));
    } catch (error) {
        if (_batches.get(gd) === b) {
            _end(gd);
            _uninstall();
        }
        throw error;
    }
    if (_batches.get(gd) === b) await _draw(gd);
    return result;
}

/**
 * Turn batching off (each edit then reaches Plotly as it is made, as before
 * batching existed) or back on. For comparing the two in tests.
 */
export function setPlotlyBatching(enabled) {
    _enabled = !!enabled;
}

/** Whether `gd` is inside a batch (for tests). */
export function isBatched(gd) {
    return _batches.has(gd);
}
