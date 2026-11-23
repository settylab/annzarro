/**
 * The cells of a 2D density's "Cell points" layer: each cell's x and y, and its Color by level, from the paths the
 * large Cell Plot loads (plot-utilities/large-plot.js `loadSeries`): typed Float32 vectors of the cells shown (the
 * subset is the DataManager's), the level of a categorical obs column as codes. The grid route has no per-cell
 * values, so this is the only place they come from. Above the draw cap a seeded uniform sample is kept; above the
 * load cap nothing is loaded (density-points.js).
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { DENSITY_POINTS_DRAW, DENSITY_POINTS_LOAD, sampleIndices } from './density-points.js';

/** The caps now in force: Config's (a test or the cost limits set them), else the named constants. */
const capOf = (key, fallback) => { const v = Config.DEFAULTS && Config.DEFAULTS[key]; return Number.isFinite(v) && v > 0 ? v : fallback; };
// export-unused-ok: the module's tests state it
export const drawCap = () => capOf('DENSITY_POINTS_DRAW', DENSITY_POINTS_DRAW);
// export-unused-ok: the module's tests state it
export const loadCap = () => capOf('DENSITY_POINTS_LOAD', DENSITY_POINTS_LOAD);

const COORDINATE_TYPES = ['obs', 'obsm', 'layer'];

const infoOf = (structure, key) => (structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[key]) || null;

/**
 * Whether the layer can be drawn for this config and this many cells, and if not, why (density-points.js
 * `pointsRefusal`). Synchronous: nothing is loaded to say it.
 * @returns {null|{kind: 'too_many', total: number, limit: number}|{kind: 'source', input: string}}
 */
export function pointsRefused(config, structure, total, load = loadCap()) {
    for (const input of ['x', 'y']) {
        const p = config[input];
        const s = p && p.source;
        if (!s || !COORDINATE_TYPES.includes(s.type)) return { kind: 'source', input };
        if (s.type === 'obs' && (infoOf(structure, s.key) || {}).type === 'categorical') return { kind: 'source', input };
    }
    if (config.split) {
        const s = config.split.source;
        if (!s || s.type !== 'obs' || (infoOf(structure, s.key) || {}).type !== 'categorical') return { kind: 'source', input: 'split' };
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
 * @returns {Promise<{x: Float32Array, y: Float32Array, codes: ?(Uint16Array|Uint32Array), categories: ?string[], total: number}>}
 */
export async function loadCellPoints(config, { structure, signal, draw = drawCap() }) {
    const { loadSeries } = await import('../plot-utilities/large-plot.js');
    const datasetPath = DataManager.getCurrentDataset();
    const series = (p, role) => loadSeries(p.source, datasetPath, structure, signal, { axis: role, role });
    const [sx, sy] = await Promise.all([series(config.x, 'x'), series(config.y, 'y')]);
    let split = null;
    if (config.split) split = await DataManager.loadCategoryCodes(datasetPath, config.split.source.key, { signal });
    const total = sx.values.length;
    if (sy.values.length !== total || (split && split.codes.length !== total)) throw new Error('The cells of x, y and Color by do not line up.');
    const pick = sampleIndices(total, draw);
    const take = (v, Type) => {
        if (!pick) return v;
        const out = new Type(pick.length);
        for (let i = 0; i < pick.length; i++) out[i] = v[pick[i]];
        return out;
    };
    return {
        x: take(sx.values, Float32Array), y: take(sy.values, Float32Array),
        codes: split ? take(split.codes, split.codes.constructor) : null, MISSING: split ? split.MISSING : 0,
        categories: split ? split.categories : null, total
    };
}

/**
 * The loaded cells as the figure takes them: the level of each as an index of the table's split axis (-1 for a cell
 * whose level the plot does not show). Category `text` is the level id `c:<text>`.
 * @param {Object} loaded - from loadCellPoints
 * @param {string[]|null} levelIds - the table's split axis levels
 */
export function pointsForFigure(loaded, levelIds) {
    if (!levelIds) return { x: loaded.x, y: loaded.y, level: null, total: loaded.total };
    const byId = new Map(levelIds.map((id, i) => [id, i]));
    const map = new Int16Array(loaded.categories.length);
    loaded.categories.forEach((text, c) => { map[c] = byId.has(`c:${text}`) ? byId.get(`c:${text}`) : -1; });
    const level = new Int16Array(loaded.codes.length);
    for (let i = 0; i < level.length; i++) { const c = loaded.codes[i]; level[i] = c === loaded.MISSING ? -1 : map[c]; }
    return { x: loaded.x, y: loaded.y, level, total: loaded.total };
}
