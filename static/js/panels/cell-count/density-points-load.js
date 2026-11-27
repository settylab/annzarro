/**
 * The cells of a 2D density's "Cell points" layer: each cell's x and y, and its Color by level, from the paths the
 * large Cell Plot loads (plot-utilities/large-plot.js `loadSeries`): typed Float32 vectors of the cells shown (the
 * subset is the DataManager's), the level of a categorical obs column as codes. The grid route has no per-cell
 * values, so this is the only place they come from. Above the draw cap a seeded uniform sample is kept; above the
 * load cap nothing is loaded (density-points.js).
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { sampleIndices } from './density-points.js';
import { limit } from '../../utils/limits.js';
import { isProviderType, largeAccepts } from '../../utils/source-registry.js';
import { GROUP_SOURCE } from '../cell-grouping/factors.js';
import { RESERVED } from '../../utils/level-id.js';

/** The caps now in force: the server's limits.density_points_draw and _load (utils/limits.js), unless a browser test
 *  lowered one in Config.DEFAULTS (DENSITY_POINTS_DRAW, DENSITY_POINTS_LOAD) to stand for a large dataset. */
const capOf = (key, name) => { const v = Config.DEFAULTS && Config.DEFAULTS[key]; return Number.isFinite(v) && v > 0 ? v : limit(name); };
// export-unused-ok: the module's tests state it
export const drawCap = () => capOf('DENSITY_POINTS_DRAW', 'density_points_draw');
// export-unused-ok: the module's tests state it
export const loadCap = () => capOf('DENSITY_POINTS_LOAD', 'density_points_load');

const COORDINATE_TYPES = ['obs', 'obsm', 'layer'];

const infoOf = (structure, key) => (structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[key]) || null;

/** Whether a source gives per-cell numbers on `axis` ('x', 'y' or 'color') as a large Cell Plot draws them. */
const numbersOn = (s, axis) => !!s && (COORDINATE_TYPES.includes(s.type) || (isProviderType(s.type) && s.type !== GROUP_SOURCE && largeAccepts(s.type, axis)));

/**
 * Whether the layer can be drawn for this config and this many cells, and if not, why (density-points.js
 * `pointsRefusal`). Synchronous: nothing is loaded to say it. X and Y are numbers (an obs column, an embedding, a gene,
 * a gene score); a Color by is a categorical obs column, a grouping, or a number binned by the reply's edges.
 * @returns {null|{kind: 'too_many', total: number, limit: number}|{kind: 'source', input: string}}
 */
export function pointsRefused(config, structure, total, load = loadCap()) {
    for (const input of ['x', 'y']) {
        const s = config[input] && config[input].source;
        if (!numbersOn(s, input)) return { kind: 'source', input };
        if (s.type === 'obs' && (infoOf(structure, s.key) || {}).type === 'categorical') return { kind: 'source', input };
    }
    if (config.split) {
        const s = config.split.source;
        if (!s || !(s.type === GROUP_SOURCE || numbersOn(s, 'color'))) return { kind: 'source', input: 'split' };
    }
    return total > load ? { kind: 'too_many', total, limit: load } : null;
}

/** A key of what the loaded cells are for: the sources and the cells shown, so a change of either loads again. */
export function pointsKey(config, total) {
    const src = (p) => (p && p.source ? [p.source.type, p.source.key, p.source.column || ''].join('|') : '');
    return [src(config.x), src(config.y), src(config.split), total, DataManager.getSubsetParam() || '', DataManager.getCurrentDataset() || ''].join('\u0001');
}

/**
 * Load the cells' positions and codes, and keep a sample above `draw` of them.
* @param {{groupCodes: (id: string) => Promise<{codes, MISSING, groupIds}>}} deps - the panel's watch on a grouping
 * @returns {Promise<{x: Float32Array, y: Float32Array, codes: ?(Uint16Array|Uint32Array), categories: ?string[], total: number}>}
 */
export async function loadCellPoints(config, { structure, signal, groupCodes, draw = drawCap() }) {
    const { loadSeries } = await import('../plot-utilities/large-plot.js');
    const datasetPath = DataManager.getCurrentDataset();
    const series = (p, role) => loadSeries(p.source, datasetPath, structure, signal, { axis: role, role });
    const [sx, sy] = await Promise.all([series(config.x, 'x'), series(config.y, 'y')]);
    const total = sx.values.length;
    // the Color by: a categorical obs column or a grouping as codes with the level id of each, a number as its values
    let codes = null;
    let groupIds = null;
    let MISSING = 0;
    let values = null;
    if (config.split) {
        const s = config.split.source;
        if (s.type === GROUP_SOURCE) {
            ({ codes, MISSING, groupIds } = await groupCodes(s.key));
        } else if (s.type === 'obs' && (infoOf(structure, s.key) || {}).type === 'categorical') {
            const got = await DataManager.loadCategoryCodes(datasetPath, s.key, { signal });
            ({ codes, MISSING } = got);
            groupIds = got.categories.map((text) => `c:${text}`);
        } else {
            values = (await loadSeries(s, datasetPath, structure, signal, { role: 'color' })).values;
        }
        const n = codes ? codes.length : values.length;
        if (n !== total) throw new Error('The cells of x, y and Color by do not line up.');
    }
    if (sy.values.length !== total) throw new Error('The cells of x, y and Color by do not line up.');
    const pick = sampleIndices(total, draw);
    const take = (v, Type) => {
        if (!pick) return v;
        const out = new Type(pick.length);
        for (let i = 0; i < pick.length; i++) out[i] = v[pick[i]];
        return out;
    };
    return {
        x: take(sx.values, Float32Array), y: take(sy.values, Float32Array),
        codes: codes ? take(codes, codes.constructor) : null, MISSING, groupIds,
        values: values ? take(values, Float32Array) : null, total
    };
}

/** The bin of `v` among `edges` (the last bin closed on the right), -1 outside or NaN: a binary search, for any edges. */
function binOf(v, edges) {
    const last = edges.length - 1;
    if (!(v >= edges[0]) || v > edges[last]) return -1;
    let lo = 0;
    let hi = last - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (edges[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/**
 * The loaded cells as the figure takes them: the level of each as an index of the table's split axis, -1 for a cell
 * whose level the plot does not show. Codes are matched by their level ids (a grouping's `g:` ids, a category's
 * `c:<text>`); a number by the reply's `edges` (the zero bin takes exactly 0).
 * @param {Object} loaded - from loadCellPoints
 * @param {string[]|null} levelIds - the table's split axis levels
 * @param {{edges?: number[]}} [info] - the split axis of the reply
 */
export function pointsForFigure(loaded, levelIds, info = {}) {
    const out = { x: loaded.x, y: loaded.y, level: null, total: loaded.total };
    if (!levelIds) return out;
    const byId = new Map(levelIds.map((id, i) => [id, i]));
    const n = loaded.x.length;
    out.level = new Int16Array(n);
    if (loaded.codes) {
        const ids = loaded.groupIds || loaded.categories.map((t) => `c:${t}`);
        const map = new Int16Array(ids.length);
        ids.forEach((id, c) => { map[c] = byId.has(id) ? byId.get(id) : -1; });
        for (let i = 0; i < n; i++) { const c = loaded.codes[i]; out.level[i] = c === loaded.MISSING || c >= map.length ? -1 : map[c]; }
        return out;
    }
    const edges = info.edges || [];
    const zero = byId.has(RESERVED.zero) ? byId.get(RESERVED.zero) : -1;
    const bin = levelIds.map((id) => (id.startsWith('bin:') ? Number(id.slice(4)) : -1));
    const at = new Map(bin.map((b, i) => [b, i]));
    for (let i = 0; i < n; i++) {
        const v = loaded.values[i];
        if (zero >= 0 && v === 0) { out.level[i] = zero; continue; }
        const b = edges.length > 1 ? binOf(v, edges) : -1;
        out.level[i] = b >= 0 && at.has(b) ? at.get(b) : -1;
    }
    return out;
}
