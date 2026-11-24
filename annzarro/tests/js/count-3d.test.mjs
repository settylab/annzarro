/**
 * The Count Plot in 3D (UX 6b, WP-11): a 2D histogram, a heatmap or a bar plot with a Color by as bars on a grid, one
 * `mesh3d` (utils/bars-3d.js).
 *
 *   - the bar's intensity is the 2D colour value, cell by cell (the bar plot's Color by: its plotted value);
 *   - the bar's height has its own source, "Same as Color" by default: a share or a statistic can be chosen;
 *   - the camera and the view are stored in the configuration, and a bad one is reported and left out;
 *   - the cap: at most BARS_3D_MAX bars (the shared constant), the 3D button refused with the reason beyond it;
 *   - even bins (WP-9) carry into 3D: bars at the indexes, grid lines at the borders labelled by the edges.
 *
 * Run:  node --test annzarro/tests/js/count-3d.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { expected } from './fixtures/grouping.mjs';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const D3 = await import('../../../static/js/panels/cell-count/draw-3d.js');
const B = await import('../../../static/js/utils/bars-3d.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const obs = (key) => ({ source: { type: 'obs', key } });
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const words = {
    count: 'Cell count', fill: '% of cells in each bar', hoverCount: 'Cells', hoverShare: 'Share',
    share: (base) => `Share of ${base}`, measure: (stat, source, above) => `${stat} of ${source}${above === undefined ? '' : ` above ${above}`}`,
    topLevel: (name) => `Most frequent level of ${name}`
};
const PALETTE = ['#111111', '#222222', '#333333', '#444444'];
const inputNames = { x: 'cell_type', y: 'condition', split: 'condition', factor: 'sample' };
const opts = (options = {}, extra = {}) => ({ options, words, inputNames, palette: PALETTE, theme: PLOT_PALETTES.light, measureSource: 'score', ...extra });

const withContract = ({ counts, measure, ...reply }) => ({
    reply: { n_shown: reply.n_counted, ...reply,
        axes: reply.axes.map((a) => {
            const bins = a.levels.filter((id) => id.startsWith('bin:')).length;
            const binned = bins ? { edges: Array.from({ length: bins + 1 }, (_, k) => k * 10), bins_made: bins, degenerate: false } : {};
            return { n_outside: [0, 0], ...binned, ...a };
        }) },
    counts, measures: measure || null });
const tableOf = (config, reply, inputs) => M.countTable(config, M.readGrid(withContract(reply)), inputs.map((input) => ({ input })));

/** x: 3 levels or bins, y: 2; counts z = [[1, 2, 4], [0, 3, 5]] (rows are y). */
const rect = (mode, over = {}) => {
    const config = norm({ mode, x: mode === 'hist2d' ? { source: { type: 'obs', key: 'a' }, binning: { method: 'equal_width', bins: 3 } } : obs('a'),
        y: mode === 'hist2d' ? { source: { type: 'obs', key: 'b' }, binning: { method: 'equal_width', bins: 2 } } : obs('b'), ...over });
    const xl = mode === 'hist2d' ? ['bin:0', 'bin:1', 'bin:2'] : ['c:p', 'c:q', 'c:r'];
    const yl = mode === 'hist2d' ? ['bin:0', 'bin:1'] : ['c:u', 'c:v'];
    return { config, table: tableOf(config, { axes: [{ levels: xl }, { levels: yl }], counts: [1, 0, 2, 3, 4, 5], n_counted: 15 }, ['x', 'y']) };
};

/** A bar plot of cell types by condition with a measure: the fixture of F0's grid. */
const bar = (over = {}) => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition'), measure: { stat: 'mean', source: { type: 'obs', key: 'score' }, above: 5 }, ...over });
    return { config, table: M.countTable(config, M.readGrid(withContract({ ...expected.grid.cell_type_x_condition })), [{ input: 'x' }, { input: 'split' }]) };
};

const meshes = (fig) => fig.data.filter((t) => t.type === 'mesh3d');
/** Each bar of a mesh: its cell (x, y indexes), its top, and its intensity (bars-3d.js corner order). */
const barsOf = (mesh) => Array.from({ length: mesh.x.length / B.VERTICES_PER_BAR }, (_, b) => {
    const v = b * B.VERTICES_PER_BAR;
    return { x: Math.round((mesh.x[v] + mesh.x[v + 1]) / 2), y: Math.round((mesh.y[v] + mesh.y[v + 2]) / 2), top: mesh.z[v + 4], value: mesh.intensity[v] };
});
const near = (a, b) => Math.abs(a - b) < 1e-5 * Math.max(1, Math.abs(b));

// ------------------------------------------------------------------ the figure: intensity is the 2D colour

test('a 2D histogram in 3D is one mesh3d whose intensity is the 2D z, cell by cell; empty rectangles are not drawn', () => {
    const { config, table } = rect('hist2d', { view: '3d' });
    const flat = D.countFigure(config, table, opts());
    const fig = D3.figure3d(config, table, opts());
    assert.equal(fig.data.filter((t) => t.type !== 'scatter3d').length, 1, fig.data.map((t) => t.type).join());
    const [mesh] = meshes(fig);
    const z = flat.data[0].z;
    const drawn = barsOf(mesh);
    assert.equal(drawn.length, 5, 'the zero rectangle is not a bar');
    for (const b of drawn) assert.equal(b.value, z[b.y][b.x], `intensity at x ${b.x}, y ${b.y}`);
    assert.ok(drawn.every((b) => b.top === b.value), 'Same as Color: the height is the colour value');
    assert.equal(mesh.intensitymode, 'vertex');
    assert.equal(fig.layout.xaxis, undefined, '3D has no 2D axes');
    assert.ok(fig.layout.scene);
});

test('a heatmap in 3D likewise: bars at the level indexes, labelled by the levels', () => {
    const { config, table } = rect('heatmap', { view: '3d' });
    const flat = D.countFigure(config, table, opts());
    const fig = D3.figure3d(config, table, opts());
    const [mesh] = meshes(fig);
    for (const b of barsOf(mesh)) assert.equal(b.value, flat.data[0].z[b.y][b.x]);
    assert.deepEqual(fig.labels3d.x.labels, ['p', 'q', 'r']);
    assert.deepEqual(fig.labels3d.y.labels, ['u', 'v']);
    assert.deepEqual(fig.layout.scene.xaxis.tickvals, [0, 1, 2]);
});

test('a bar plot with a Color by in 3D: x by the Color by\'s levels, the plotted value as height and intensity', () => {
    const { config, table } = bar({ view: '3d', measure: undefined });
    const fig = D3.figure3d(config, table, opts());
    const [mesh] = meshes(fig);
    const drawn = barsOf(mesh);
    assert.ok(drawn.length > 0);
    for (const b of drawn) {
        const count = table.count[b.x * table.stride[0] + b.y * table.stride[1]];
        assert.equal(b.value, count);
        assert.equal(b.top, count);
    }
    assert.equal(drawn.length, Array.from(table.count).filter((c) => c > 0).length);
    assert.equal(fig.layout.scene.zaxis.title.text, 'Cell count');
});

test('a statistic as the bar plot\'s value is the intensity too', () => {
    const { config, table } = bar({ view: '3d', value: { kind: 'measure' } });
    const means = M.measureValues(table, 'mean');
    const [mesh] = meshes(D3.figure3d(config, table, opts()));
    for (const b of barsOf(mesh)) assert.ok(near(b.value, means[b.x * table.stride[0] + b.y * table.stride[1]]));
});

// ------------------------------------------------------------------ the height has its own source

test('a height of a share differs from the colour, a count', () => {
    const { config, table } = rect('hist2d', { view: '3d', height: 'share:total' });
    const [mesh] = meshes(D3.figure3d(config, table, opts()));
    const drawn = barsOf(mesh);
    assert.equal(drawn.length, 5);
    for (const b of drawn) {
        assert.ok(near(b.top, b.value / 15), `height ${b.top} is the share of ${b.value}`);
        assert.notEqual(b.top, b.value);
    }
});

test('a height of a statistic comes from the measure already counted, and the hover names it', () => {
    const { config, table } = bar({ view: '3d', measure: { stat: 'mean', source: { type: 'obs', key: 'score' } }, height: 'stat:sum' });
    const sums = M.measureValues(table, 'sum');
    const fig = D3.figure3d(config, table, opts());
    const [mesh] = meshes(fig);
    for (const b of barsOf(mesh)) {
        assert.ok(near(b.top, sums[b.x * table.stride[0] + b.y * table.stride[1]]));
        assert.equal(b.value, table.count[b.x * table.stride[0] + b.y * table.stride[1]], 'the colour stays the count');
    }
    assert.match(mesh.hovertext[0], /Height/);
});

test('a height of a statistic with no measure in the reply falls back to Same as Color', () => {
    const { config, table } = rect('hist2d', { view: '3d', height: 'stat:mean' });
    const [mesh] = meshes(D3.figure3d(config, table, opts()));
    for (const b of barsOf(mesh)) assert.equal(b.top, b.value);
});

test('the hover is the 2D hover, plus the height when it differs from the colour', () => {
    const same = meshes(D3.figure3d(...Object.values(rect('hist2d', { view: '3d' })), opts()))[0];
    const share = meshes(D3.figure3d(...Object.values(rect('hist2d', { view: '3d', height: 'share:total' })), opts()))[0];
    assert.ok(!same.hovertext[0].includes('Height'), same.hovertext[0]);
    assert.ok(share.hovertext[0].includes('Height'), share.hovertext[0]);
    assert.equal(share.hoverinfo, 'text');
});

// ------------------------------------------------------------------ colour keys, options

test('the colour map, its range and Reverse reach the mesh as the 2D heatmap reads them', () => {
    const { config, table } = rect('hist2d', { view: '3d', color: { map: 'Reds', reverse: true, min: 0, max: 9 } });
    const options = { colorscale: 'Reds', colour: { reverse: true, min: 0, max: 9 } };
    const flat = D.countFigure(config, table, opts(options)).data[0];
    const [mesh] = meshes(D3.figure3d(config, table, opts(options)));
    assert.deepEqual(mesh.colorscale, flat.colorscale);
    assert.equal(mesh.reversescale, true);
    assert.equal(mesh.cmin, 0);
    assert.equal(mesh.cmax, 9);
    assert.equal(mesh.showscale, true);
    assert.equal(mesh.colorbar.title.text, 'Cell count');
});

test('Plot Options\' 3D section: footprint, lighting, the axis box and the z title', () => {
    const { config, table } = rect('hist2d', { view: '3d' });
    const wide = meshes(D3.figure3d(config, table, opts({}, { view3d: { footprint: 1 } })))[0];
    const narrow = meshes(D3.figure3d(config, table, opts({}, { view3d: { footprint: 0.5 } })))[0];
    assert.ok(near(wide.x[1] - wide.x[0], 1));
    assert.ok(near(narrow.x[1] - narrow.x[0], 0.5));
    const flat = meshes(D3.figure3d(config, table, opts({}, { view3d: { lighting: false } })))[0];
    assert.equal(flat.flatshading, true);
    assert.deepEqual(flat.lighting, { ambient: 1, diffuse: 0, specular: 0, roughness: 1, fresnel: 0 });
    const boxless = D3.figure3d(config, table, opts({}, { view3d: { box: false, zTitle: 'My <height>' } }));
    assert.equal(boxless.layout.scene.xaxis.showline, false);
    assert.equal(boxless.layout.scene.xaxis.showgrid, false);
    assert.equal(boxless.layout.scene.zaxis.title.text, 'My &lt;height&gt;');
});

test('a most frequent level colours its bars by the 2D heatmap\'s stepped codes, the height is the count, the levels are listed', () => {
    const config = norm({ mode: 'heatmap', view: '3d', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: obs('f') } });
    // rectangles (x,y): p/u 3 vs 1, p/v 1 vs 1 (tie), q/u 0 vs 4, q/v empty
    const reply = { axes: [{ levels: ['c:p', 'c:q'] }, { levels: ['c:u', 'c:v'] }, { levels: ['c:A', 'c:B'] }], counts: [3, 1, 1, 1, 0, 4, 0, 0], n_counted: 10 };
    const table = tableOf(config, reply, ['x', 'y', 'factor']);
    const flat = D.countFigure(config, table, opts()).data[0];
    const fig = D3.figure3d(config, table, opts());
    const [mesh] = meshes(fig);
    const drawn = barsOf(mesh);
    assert.equal(drawn.length, 3, 'the empty rectangle has no bar');
    for (const b of drawn) {
        assert.equal(b.value, flat.z[b.y][b.x]);
        assert.equal(b.top, table.count[b.x * table.stride[0] + b.y * table.stride[1]], 'no number to follow: the height is the count');
    }
    assert.deepEqual(mesh.colorscale, flat.colorscale);
    assert.equal(mesh.cmin, -0.5);
    assert.equal(mesh.showscale, false);
    assert.deepEqual(fig.data.slice(1).map((t) => [t.type, t.name]), [['scatter3d', 'A'], ['scatter3d', 'B']]);
    assert.equal(fig.layout.showlegend, true);
});

// ------------------------------------------------------------------ the camera and the config

const CAMERA = { eye: { x: 0.3, y: -2, z: 0.5 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

test('the view, the height and the camera round-trip through the config; absent is 2D', () => {
    const raw = { version: 1, mode: 'hist2d', x: obs('a'), y: obs('b'), view: '3d', height: 'share:row', camera: CAMERA };
    const { config, problems } = M.normalizeCountPlot(raw);
    assert.deepEqual(problems, []);
    assert.equal(config.view, '3d');
    assert.equal(config.height, 'share:row');
    assert.deepEqual(config.camera, CAMERA);
    assert.deepEqual(M.normalizeCountPlot(JSON.parse(JSON.stringify(config))).config, config);
    const plain = M.normalizeCountPlot({ version: 1, mode: 'hist2d', x: obs('a'), y: obs('b') }).config;
    assert.ok(!('view' in plain) && !('camera' in plain) && !('height' in plain));
});

test('a bad view, height or camera is reported and left out', () => {
    const { config, problems } = M.normalizeCountPlot({ version: 1, mode: 'hist2d', x: obs('a'), y: obs('b'), view: 'sideways', height: 'volume', camera: { eye: { x: 'a' } } });
    assert.ok(!('view' in config) && !('height' in config) && !('camera' in config), JSON.stringify(config));
    assert.deepEqual(problems.map((p) => p.field).sort(), ['camera', 'height', 'view']);
});

test('the stored camera is the scene\'s camera, and a figure without one has the default', () => {
    const { config, table } = rect('hist2d', { view: '3d', camera: CAMERA });
    assert.deepEqual(D3.figure3d(config, table, opts()).layout.scene.camera, CAMERA);
    const plain = D3.figure3d(rect('hist2d', { view: '3d' }).config, table, opts());
    assert.deepEqual(plain.layout.scene.camera, D3.DEFAULT_CAMERA);
});

// ------------------------------------------------------------------ what 3D is offered for, and the cap

test('3D is offered for a 2D histogram, a heatmap and a bar plot with a Color by, and refused elsewhere with the reason', () => {
    assert.equal(D3.view3dGate(norm({ mode: 'hist2d', x: obs('a'), y: obs('b') })).ok, true);
    assert.equal(D3.view3dGate(norm({ mode: 'heatmap', x: obs('a'), y: obs('b') })).ok, true);
    assert.equal(D3.view3dGate(norm({ mode: 'bar', x: obs('a'), split: obs('b') })).ok, true);
    for (const config of [norm({ mode: 'bar', x: obs('a') }), norm({ mode: 'pie', x: obs('a') }), norm({ mode: 'histogram', x: obs('a') }),
        norm({ mode: 'density2d', x: obs('a'), y: obs('b') }), norm({ mode: 'upset' }),
        norm({ mode: 'hist2d', x: obs('a'), y: obs('b'), split: obs('c') })]) {
        const gate = D3.view3dGate(config);
        assert.equal(gate.ok, false, config.mode);
        assert.ok(gate.text.length > 10, config.mode);
    }
});

test('over the cap the gate refuses with the count, and the cap is the served limit', () => {
    assert.equal(B.bars3dMax(), B.BARS_3D_MAX);
    const config = norm({ mode: 'hist2d', x: obs('a'), y: obs('b') });
    assert.equal(D3.view3dGate(config, 40000).ok, true);
    const over = D3.view3dGate(config, 262144);
    assert.equal(over.ok, false);
    assert.equal(over.text, '3D draws at most 40,000 bars; this plot has 262,144. Use fewer bins.');
    assert.equal(D3.view3dGate(config, 11, 10).text, '3D draws at most 10 bars; this plot has 11. Use fewer bins.');
});

// ------------------------------------------------------------------ even bins carry into 3D

const LOG = ['bin:0', 'bin:1', 'bin:2'];
const LOG_EDGES = [1, 10, 100, 1000];

test('log bins in 3D are bars at their index, grid lines at the borders, labelled by the edges', () => {
    const input = (key) => ({ source: { type: 'obs', key }, binning: { method: 'log' } });
    const config = norm({ mode: 'hist2d', view: '3d', x: input('a'), y: { source: { type: 'obs', key: 'b' } } });
    const table = tableOf(config, { axes: [{ levels: LOG, edges: LOG_EDGES }, { levels: ['bin:0', 'bin:1'], edges: [1, 2, 3] }], counts: [1, 2, 3, 4, 5, 6], n_counted: 21 }, ['x', 'y']);
    const fig = D3.figure3d(config, table, opts());
    const [mesh] = meshes(fig);
    assert.deepEqual([...new Set(barsOf(mesh).map((b) => b.x))].sort(), [0, 1, 2]);
    assert.deepEqual(fig.layout.scene.xaxis.tickvals, [-0.5, 0.5, 1.5, 2.5]);
    assert.deepEqual(fig.labels3d.x.labels, ['1', '10', '100', '1000']);
    assert.deepEqual(fig.labels3d.x.positions, [-0.5, 0.5, 1.5, 2.5]);
});

// ------------------------------------------------------------------ the request

test('a 3D height that is a statistic asks the grid for the measure; Same as Color and a share do not', () => {
    const page = { isNumeric: () => false, levelCount: () => 3, memberFor: () => ({}) };
    const base = { mode: 'heatmap', x: obs('a'), y: obs('b'), view: '3d' };
    const measure = { stat: 'mean', source: { type: 'obs', key: 'score' } };
    const plan = (over) => M.planGrid(norm({ ...base, ...over }), page);
    assert.equal(plan({ measure }).request.measures, undefined, 'Same as Color');
    assert.equal(plan({ measure, height: 'share:total' }).request.measures, undefined, 'a share is of the counts');
    assert.equal(plan({ measure, height: 'stat:sd' }).request.measures.length, 1);
    assert.equal(plan({ measure, height: 'stat:sd', view: undefined }).request.measures, undefined, 'in 2D it is kept, not asked for');
    assert.notEqual(plan({ measure, height: 'stat:sd' }).key, plan({ measure }).key);
});
