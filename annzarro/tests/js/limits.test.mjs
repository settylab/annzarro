/**
 * The cost limits in the browser (static/js/utils/limits.js): the page keeps to the server's values, read from
 * GET /api/v1/policy/effective, never to copies of its own.
 *
 *   - with no policy (an older server, or before it loads) every limit is its default from limits-defaults.json;
 *   - the server's value, once loaded, is what every check uses: the Cell-Gene matrix, genes per section, the groups
 *     and factors of a grouping, the count grid and its inputs, the sets of an UpSet, the 3D bars, the cell export,
 *     the progress bar and the dendrogram rows;
 *   - a value that is not a finite number is ignored, and a change of the policy applies at the next check.
 *
 * Run:  node --test annzarro/tests/js/limits.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { Policy } = await import('../../../static/js/policy.js');
const L = await import('../../../static/js/utils/limits.js');
const M = await import('../../../static/js/utils/cell-gene-model.js');
const G = await import('../../../static/js/utils/cell-grouping.js');
const B = await import('../../../static/js/utils/bars-3d.js');
const CP = await import('../../../static/js/utils/count-plot-model.js');
const SP = await import('../../../static/js/utils/set-plot-model.js');
const SN = await import('../../../static/js/utils/source-notices.js');
const X = await import('../../../static/js/panels/cell-grouping/cell-export.js');
const O = await import('../../../static/js/utils/cell-gene-order.js');

const DEFAULTS = JSON.parse(readFileSync(new URL('../../../static/js/limits-defaults.json', import.meta.url), 'utf8'));

/** Serve `values` as the policy, the way the server does, and load it through the page's own Policy. */
async function serve(values) {
    globalThis.fetch = async () => ({
        ok: true, status: 200, headers: { get: () => 'v-test' },
        json: async () => ({ version: `v-${JSON.stringify(values)}`, values })
    });
    await Policy.load();
}

test.afterEach(async () => { await serve({}); });

test('without a policy every limit is the default the server ships', async () => {
    await serve({});
    assert.deepEqual([...L.LIMIT_NAMES].sort(), Object.keys(DEFAULTS).filter((k) => k.startsWith('limits.')).map((k) => k.slice(7)).sort());
    for (const name of L.LIMIT_NAMES) assert.equal(L.limit(name), DEFAULTS[`limits.${name}`], name);
    assert.equal(L.limit('matrix_values'), 400000);
    assert.equal(L.limit('groups'), 2000);
    assert.equal(L.limit('bars_3d_max'), 40000);
    assert.throws(() => L.limit('gropus'), /Unknown limit "gropus"/);
});

test('the served value is the limit, and a value that is not a finite number is ignored', async () => {
    await serve({ 'limits.groups': 3, 'limits.bars_3d_max': 'lots', 'limits.matrix_values': null });
    assert.equal(L.limit('groups'), 3);
    assert.equal(L.limit('bars_3d_max'), 40000);
    assert.equal(L.limit('matrix_values'), 400000);
    assert.equal(L.limit('groups', { get: (key, fallback) => (key === 'limits.groups' ? 7 : fallback) }), 7);
});

test('the Cell-Gene matrix gate refuses at the served number, and at the default without one', async () => {
    const sections = [{ rows: 100, genes: 100 }];
    assert.deepEqual(M.matrixLimits({ groups: 40, sections, features: 100 }), { ok: true });
    await serve({ 'limits.matrix_values': 3999 });
    assert.deepEqual(M.matrixLimits({ groups: 40, sections, features: 0 }),
        { ok: false, reason: 'matrix_too_large', count: 4000, limit: 3999 });
    assert.deepEqual(M.matrixLimits({ groups: 39, sections: [{ rows: 10, genes: 10 }], features: 200 }),
        { ok: false, reason: 'too_many_values', count: 7800, limit: 3999 });
    await serve({ 'limits.genes_per_section': 50 });
    assert.deepEqual(M.matrixLimits({ groups: 2, sections }), { ok: false, reason: 'too_many_genes', section: 0, count: 100, limit: 50 });
});

test('the 3D gate refuses past the served bar cap', async () => {
    assert.equal(B.checkBarCap(40000).ok, true);
    await serve({ 'limits.bars_3d_max': 500 });
    assert.equal(B.bars3dMax(), 500);
    assert.equal(B.checkBarCap(500).ok, true);
    const over = B.checkBarCap(501, { hint: 'matrix' });
    assert.equal(over.ok, false);
    assert.equal(over.max, 500);
    assert.equal(over.text, '3D draws at most 500 bars; this plot has 501. Use fewer genes or groups.');
    assert.equal(B.BARS_3D_MAX, 40000);                              // the default, for whoever names it
});

test('the grouping limits are read at each use', async () => {
    assert.deepEqual({ ...G.GROUPING_LIMITS }, { partitionings: 8, levels: 2000, groups: 2000 });
    await serve({ 'limits.groups': 300, 'limits.partitionings': 2 });
    assert.deepEqual({ ...G.GROUPING_LIMITS }, { partitionings: 2, levels: 300, groups: 300 });
    assert.ok(Object.isFrozen(G.GROUPING_LIMITS));
});

test('the count grid, its inputs and the sets of an UpSet keep to the served grid limits', async () => {
    assert.deepEqual(CP.binsRange('histogram', 'x'), { min: 2, max: 2000 });
    assert.deepEqual(CP.binsRange('hist2d', 'x'), { min: 2, max: 512 });
    assert.deepEqual(CP.binsRange('bar', 'x'), { min: 2, max: 200 });
    await serve({ 'limits.grid_1d_bins': 300, 'limits.grid_2d_bins': 64, 'limits.grid_categorical_levels': 20 });
    assert.deepEqual(CP.binsRange('histogram', 'x'), { min: 2, max: 300 });
    assert.deepEqual(CP.binsRange('hist2d', 'y'), { min: 2, max: 64 });
    assert.deepEqual(CP.binsRange('bar', 'x'), { min: 2, max: 20 });
    assert.equal(CP.binsProblem('histogram', 301, 'x'), 'bad_bins');
    assert.equal(SP.canAddSet({ sets: Array(15).fill({}) }).ok, true);
    await serve({ 'limits.grid_sets': 4 });
    assert.equal(SP.canAddSet({ sets: Array(3).fill({}) }).ok, true);
    assert.equal(SP.canAddSet({ sets: Array(4).fill({}) }).ok, false);
});

test('the cell export is offered up to the served number of cells', async () => {
    const words = { tooManyCells: (n) => `Up to ${n.toLocaleString('en-US')} cells` };
    const deps = (cells) => ({ cells: () => cells, refusal: () => null, names: async () => [], sources: {} });
    await serve({ 'limits.cell_export_max': 10 });
    assert.deepEqual(await X.exportCells({ id: 'g', deps: deps(11), words, yieldTurn: () => Promise.resolve() }),
        { ok: false, reason: 'Up to 10 cells' });
});

test('the progress bar shows after the served number of seconds', async () => {
    const snap = { state: 'computing', estimate: { seconds: 4 }, progress: null };
    assert.equal(SN.progressBar(snap, 3), null);
    assert.equal(SN.BAR_AFTER_S, 10);
    await serve({ 'limits.progress_bar_s': 2 });
    assert.equal(SN.barAfterS(), 2);
    assert.notEqual(SN.progressBar(snap, 0), null);                    // the estimate (4 s) is over 2 s
    assert.notEqual(SN.progressBar({ ...snap, estimate: { seconds: 1 } }, 2.5), null);
    assert.equal(SN.progressBar({ ...snap, estimate: { seconds: 1 } }, 1), null);
});

test('a block over the served dendrogram rows is not clustered, and the limit travels to the worker', async () => {
    await serve({ 'limits.dendrogram_rows': 3 });
    const asked = [];
    const cluster = (values, rows, cols, settings) => {
        asked.push({ rows, maxRows: settings.maxRows });
        return Promise.resolve({ order: Int32Array.from({ length: rows }, (_, i) => i), clustered: Int32Array.from({ length: rows }, (_, i) => i),
            excluded: new Int32Array(0), merges: new Float64Array(0) });
    };
    const groups = Array.from({ length: 4 }, (_, i) => ({ key: [`c:g${i}`], n: 10 + i }));
    const o = await O.createCellGeneOrder({ cluster }).order({
        values: Float64Array.from({ length: 2 * 4 }, (_, i) => (i * 7) % 5), groups, partitionings: 1, sortBySize: false,
        sections: [{ kind: 'genes', genes: ['A', 'B'] }], bars: [{ rows: [0, 1], lo: 0, hi: 1 }],
        cluster: { genes: 'sections', groups: 'all', linkage: 'complete', distance: 'euclidean' }
    });
    assert.deepEqual(o.groupBlocks.map((b) => [b.count, b.state]), [[4, 'too_many']]);
    assert.deepEqual(asked, [{ rows: 2, maxRows: 3 }]);              // the two genes are clustered, told the limit
});

test('the Cell points layer refuses past the served load cap and samples at the served draw cap', async () => {
    const D = await import('../../../static/js/panels/cell-count/density-points-load.js');
    const num = (key) => ({ source: { type: 'obs', key } });
    const config = { mode: 'density2d', x: num('depth'), y: num('score') };
    const structure = { obs: { columns_info: { depth: { type: 'numeric' }, score: { type: 'numeric' } } } };
    assert.equal(D.loadCap(), 25000000);
    assert.equal(D.drawCap(), 1000000);
    assert.equal(D.pointsRefused(config, structure, 101), null);
    await serve({ 'limits.density_points_load': 100, 'limits.density_points_draw': 40 });
    assert.equal(D.loadCap(), 100);
    assert.equal(D.drawCap(), 40);
    assert.deepEqual(D.pointsRefused(config, structure, 101), { kind: 'too_many', total: 101, limit: 100 });
    assert.equal(D.pointsRefused(config, structure, 100), null, 'the cap itself is allowed');
});
