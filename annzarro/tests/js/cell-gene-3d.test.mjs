/**
 * WP-12 (UX 6b): the Cell-Gene Plot in 3D. Bars on a grid of genes x groups, one `mesh3d` (utils/bars-3d.js); the bar
 * height is a third measure, "Same as Color" by default.
 *
 *   - a 3D figure for a dots model is one mesh3d with one box per drawn cell; Size is the footprint's area;
 *   - "Same as Color" heights are the colour's values as displayed (its statistic, layer, threshold and scaling);
 *   - a Height source of its own adds a feature only when its layer (or threshold) is new, and matrixLimits counts it;
 *   - over the bar cap the 3D button is refused with the matrix wording;
 *   - 3D draws no dendrograms, strips, brackets or totals;
 *   - the configuration keeps `view`, `height` and `camera`; the CSV gets a Height column only when it differs.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-3d.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/panels/cell-gene/draw.js');
const S = await import('../../../static/js/panels/cell-gene/sections.js');
const M = await import('../../../static/js/utils/cell-gene-model.js');
const O = await import('../../../static/js/panels/cell-gene/options.js');
const B = await import('../../../static/js/utils/bars-3d.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const LIGHT = PLOT_PALETTES.light;

/** `rows` genes in `groups` groups; colour r + 1 + g / 10, size 10 * (g + 1) (percent). */
function model({ rows = 3, groups = 2, mode = 'dots', ...over } = {}) {
    const colour = new Float64Array(rows * groups);
    const size = new Float64Array(rows * groups);
    for (let r = 0; r < rows; r++) {
        for (let g = 0; g < groups; g++) {
            colour[r * groups + g] = r + 1 + g / 10;
            size[r * groups + g] = 10 * (g + 1);
        }
    }
    return {
        mode, view: '3d',
        groups: Array.from({ length: groups }, (_, g) => ({ label: `group ${g}`, n: 100 * (g + 1) })),
        rows: Array.from({ length: rows }, (_, r) => ({ label: `Gene${r}`, section: { index: 0, title: 's' } })),
        color: { id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: colour, colorscale: 'Reds' },
        size: { id: 'pct|X', stat: 'pct_expressing', layer: 'X', detectAbove: 0, values: size },
        height: { same: true, values: colour },
        ...over
    };
}

/** The height's title: an annotation of the scene (Plotly's own z title is left empty, sceneLabels draws it). */
const zTitleOf = (fig) => (fig.layout.scene.annotations.find((a) => a.name === 'z title') || {}).text;
const meshes = (fig) => fig.data.filter((t) => t.type === 'mesh3d');
/** The top of each bar: the z of its 5th vertex (bars-3d.js corner order). */
const tops = (mesh) => Array.from({ length: mesh.x.length / B.VERTICES_PER_BAR }, (_, b) => mesh.z[b * B.VERTICES_PER_BAR + 4]);
/** The side of each bar's footprint. */
const sides = (mesh) => Array.from({ length: mesh.x.length / B.VERTICES_PER_BAR }, (_, b) => mesh.x[b * 8 + 1] - mesh.x[b * 8]);

// ------------------------------------------------------------------ the figure

test('a 3D figure for a dots model is one mesh3d with a bar per drawn cell, in a scene', () => {
    const fig = D.buildFigure(model({ rows: 3, groups: 4 }), LIGHT);
    assert.equal(fig.data.length, 1, fig.data.map((t) => t.type).join());
    const [mesh] = meshes(fig);
    assert.equal(mesh.x.length, 12 * B.VERTICES_PER_BAR);
    assert.equal(mesh.i.length, 12 * B.TRIANGLES_PER_BAR);
    assert.ok(fig.layout.scene, 'a 3D scene');
    assert.equal(fig.layout.scene.aspectmode, 'manual');
    assert.equal(zTitleOf(fig), 'Mean · X');
    assert.deepEqual(fig.layout.scene.camera.eye, { x: 1.6, y: -1.6, z: 1.1 }, 'the default camera');
    // a missing value is not drawn
    const m = model({ rows: 3, groups: 4 });
    m.color.values[5] = NaN;
    assert.equal(meshes(D.buildFigure(m, LIGHT))[0].x.length, 11 * B.VERTICES_PER_BAR);
});

test('in dots the footprint area encodes Size; a heatmap has one footprint', () => {
    const dots = meshes(D.buildFigure(model({ rows: 1, groups: 4 }), LIGHT))[0];
    const s = sides(dots);
    // size 10, 20, 30, 40 percent: area proportional, so side proportional to sqrt
    for (let g = 0; g < 4; g++) assert.ok(Math.abs(s[g] / s[3] - Math.sqrt((g + 1) / 4)) < 1e-6, `${s}`);
    const heat = meshes(D.buildFigure(model({ rows: 1, groups: 4, mode: 'heatmap', size: { none: '' } }), LIGHT))[0];
    assert.equal(new Set(sides(heat).map((v) => v.toFixed(6))).size, 1);
});

test('"Same as Color": the bars are the colour values; an own height is drawn as given, hover names all three', () => {
    const same = meshes(D.buildFigure(model({ rows: 2, groups: 2 }), LIGHT))[0];
    assert.deepEqual(tops(same).map((v) => Math.round(v * 1000) / 1000), [1, 1.1, 2, 2.1]);
    const intensity = Array.from({ length: 4 }, (_, b) => same.intensity[b * 8]);
    assert.deepEqual(intensity.map((v) => Math.round(v * 1000) / 1000), [1, 1.1, 2, 2.1]);
    const own = model({ rows: 2, groups: 2, height: { same: false, stat: 'sum', layer: 'counts', values: Float64Array.of(5, 6, 7, 8) } });
    const fig = D.buildFigure(own, LIGHT);
    const mesh = meshes(fig)[0];
    assert.deepEqual(tops(mesh), [5, 6, 7, 8]);
    assert.equal(zTitleOf(fig), 'Sum · counts');
    const text = mesh.hovertext[0];
    const lines = text.split('<br>');
    assert.equal(lines[0], 'Gene0');
    assert.match(lines[1], /^group 0 · Cells: 100$/);
    assert.match(lines[2], /^Mean · X: 1$/);
    assert.match(lines[3], /^% expressing \(> 0\) · X: 10$/);
    assert.match(lines[4], /^Height · Sum · counts: 5$/);
});

test("view '3d' drops the dendrogram, strip, bracket and totals traces; 2D keeps them", () => {
    const merges = Float64Array.from([0, 1, 0.5, 2]);
    const annotations = {
        brackets: { titles: true }, totals: true,
        strips: [{ title: 'cell_type', colours: ['#e41a1c', '#377eb8'], levels: ['B', 'T'] }],
        dendrograms: { groups: [{ merges, positions: [0, 1] }], genes: [{ merges, positions: [0, 1] }] }
    };
    const twoD = D.buildFigure(model({ rows: 2, groups: 2, view: undefined, annotations }), LIGHT);
    const names = twoD.data.map((t) => t.name);
    for (const n of ['dendrogram genes', 'dendrogram groups', 'group strip', 'cells per group']) assert.ok(names.includes(n), `2D has ${n}: ${names}`);
    const threeD = D.buildFigure(model({ rows: 2, groups: 2, annotations }), LIGHT);
    assert.deepEqual(threeD.data.map((t) => t.type), ['mesh3d']);
    assert.ok(!(threeD.layout.annotations || []).some((a) => a.name === 'section title'));
});

test('a stored camera is drawn; z-scored heights hang below 0', () => {
    const camera = { eye: { x: 0.5, y: -2, z: 0.4 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const fig = D.buildFigure(model({ camera }), LIGHT);
    assert.deepEqual(fig.layout.scene.camera, camera);
    assert.ok(fig.layout.uirevision, 'a uirevision, so a redraw in place keeps the camera on screen');
    const m = model({ rows: 1, groups: 2 });
    m.color.values = Float64Array.of(-1, 1);
    m.height = { same: true, values: m.color.values };
    assert.deepEqual(tops(meshes(D.buildFigure(m, LIGHT))[0]), [-1, 1]);
});

// ------------------------------------------------------------------ the measure

const sections = (genes) => [{ section: { source: 's', rows: 'genes' }, genes, title: 's', scoreRecipe: () => null }];
const GENES = ['A', 'B', 'C'];

test('"Same as Color" heights equal the colour values as displayed, scaling included', () => {
    const config = S.normalizeCellGene({ mode: 'heatmap', view: '3d', scale: 'z_groups', sections: [{ source: 's' }], color: { stat: 'mean', layer: 'X' } }).config;
    assert.equal(config.height, undefined, '"Same as Color" is stored as absent');
    const plan = S.planFeatures({ sections: sections(GENES), color: config.color, size: null, height: S.heightOf(config) });
    const moments = new Map(plan.features.map((f, k) => [f.key, Float64Array.from([4, 4 * (k + 1), 20 * (k + 1), 2, 3, 5, 5 * k + 9, 30, 3, 4])]));
    const matrix = S.buildMatrix(plan, (key) => moments.get(key), [{ n: 4 }, { n: 5 }], config);
    assert.ok(matrix.height.same);
    assert.deepEqual(Array.from(matrix.height.values), Array.from(matrix.color.values));
    assert.notDeepEqual(Array.from(matrix.color.values), Array.from(matrix.color.raw), 'the colours are scaled');
});

test('a Height source of its own adds a feature only when its layer or threshold is new', () => {
    const color = { stat: 'mean', layer: 'X' };
    const size = { stat: 'pct_expressing', layer: 'X' };
    const base = S.planFeatures({ sections: sections(GENES), color, size }).features.length;
    assert.equal(base, 3);
    assert.equal(S.planFeatures({ sections: sections(GENES), color, size, height: { stat: 'sum', layer: 'X' } }).features.length, 3,
        'Sum on X reads the moments Color and Size read');
    assert.equal(S.planFeatures({ sections: sections(GENES), color, size, height: { stat: 'mean_expressing', layer: 'X' } }).features.length, 3,
        'a threshold statistic at the shared threshold adds nothing');
    const counts = S.planFeatures({ sections: sections(GENES), color, size, height: { stat: 'sum', layer: 'counts' } });
    assert.equal(counts.features.length, 6, 'one more per gene on a new layer');
    assert.deepEqual(counts.features.filter((f) => f.wire.layer === 'counts').map((f) => f.wire.name), GENES);
    assert.ok(counts.rows.every((r) => typeof r.height === 'string'));
    assert.ok(counts.statistics.some((s) => s.stat === 'sum' && s.layer === 'counts'), 'the grouping counts the plot among its users');
    const above = S.planFeatures({ sections: sections(GENES), color, size, height: { stat: 'pct_expressing', layer: 'X', detect_above: 2 } });
    assert.equal(above.features.length, 6, 'a new threshold on the same layer is a feature per gene too');
});

test('an own height is unscaled, and the plan with a height on a third layer is counted by matrixLimits', () => {
    const config = S.normalizeCellGene({ mode: 'dots', view: '3d', scale: 'var', sections: [{ source: 's' }], height: { stat: 'sum', layer: 'counts' } }).config;
    assert.deepEqual(config.height, { stat: 'sum', layer: 'counts' });
    const plan = S.planFeatures({ sections: sections(['A']), color: config.color, size: config.size, height: S.heightOf(config) });
    const moments = new Map(plan.features.map((f) => [f.key, f.wire.layer === 'counts' ? Float64Array.of(2, 40, 900, 2, 40, 3, 90, 3000, 3, 90)
        : Float64Array.of(2, 1, 1, 1, 1, 3, 3, 4, 2, 3)]));
    const matrix = S.buildMatrix(plan, (key) => moments.get(key), [{ n: 2 }, { n: 3 }], config);
    assert.equal(matrix.height.same, false);
    assert.deepEqual(Array.from(matrix.height.values), [40, 90], 'the sums, not scaled 0 to 1');
    // 10 sections of 2,000 genes, 12 groups: Color and Size on X are 20,000 features (240,000 values) ...
    const big = Array.from({ length: 10 }, (_, s) => ({ section: { source: `s${s}`, rows: 'genes' },
        genes: Array.from({ length: 2000 }, (_, k) => `G${s}_${k}`), title: `s${s}`, scoreRecipe: () => null }));
    const shape = big.map(() => ({ rows: 2000, genes: 2000 }));
    const two = S.planFeatures({ sections: big, color: { stat: 'mean', layer: 'X' }, size: { stat: 'pct_expressing', layer: 'X' } });
    assert.deepEqual(M.matrixLimits({ groups: 12, sections: shape, features: two.features.length }), { ok: true });
    // ... and a Height on counts makes them 40,000 (480,000 values): refused
    const three = S.planFeatures({ sections: big, color: { stat: 'mean', layer: 'X' }, size: { stat: 'pct_expressing', layer: 'X' }, height: { stat: 'sum', layer: 'counts' } });
    assert.deepEqual(M.matrixLimits({ groups: 12, sections: shape, features: three.features.length }),
        { ok: false, reason: 'too_many_values', count: 480000, limit: 400000 });
});

test('heightOf: absent, or 2D, reads no height of its own; a stored height is kept while 3D is off', () => {
    const own = { stat: 'sum', layer: 'counts' };
    assert.equal(S.heightOf(S.normalizeCellGene({ view: '3d' }).config), null);
    assert.equal(S.heightOf(S.normalizeCellGene({ height: own }).config), null, 'not drawn in 2D, so not read');
    assert.deepEqual(S.normalizeCellGene({ height: own }).config.height, own, 'kept for when 3D is on again');
    assert.deepEqual(S.heightOf(S.normalizeCellGene({ view: '3d', height: own }).config), own);
});

test('the configuration keeps view, height and camera, and drops what it cannot read', () => {
    const camera = { eye: { x: 1, y: 2, z: 3 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const { config, problems } = S.normalizeCellGene({ view: '3d', camera, height: { stat: 'sd', layer: 'logged' } });
    assert.equal(config.view, '3d');
    assert.deepEqual(config.camera, camera);
    assert.deepEqual(problems, []);
    const bad = S.normalizeCellGene({ view: 'vr', camera: { eye: 'up' }, height: 'tall' });
    assert.equal('view' in bad.config, false);
    assert.equal('camera' in bad.config, false);
    assert.equal('height' in bad.config, false);
    assert.equal(bad.problems.length, 3, bad.problems.join('; '));
});

// ------------------------------------------------------------------ the cap and the CSV

test('the cap check refuses with the matrix wording; a lowered max refuses a small grid', () => {
    const over = O.view3dGate({ rows: 300, groups: 200 });
    assert.equal(over.ok, false);
    assert.equal(over.text, '3D draws at most 40,000 bars; this plot has 60,000. Use fewer genes or groups.');
    assert.equal(O.view3dGate({ rows: 200, groups: 200 }).ok, true);
    const small = O.view3dGate({ rows: 4, groups: 6, max: 10 });
    assert.equal(small.text, '3D draws at most 10 bars; this plot has 24. Use fewer genes or groups.');
});

test('the CSV gets a Height column only when its source differs from Color', () => {
    const m = model({ rows: 1, groups: 2 });
    const head = (mm) => M.longRows(O.tableOf(mm))[0];
    assert.ok(!head(m).some((h) => /^Height/.test(h)), head(m).join(' | '));
    const own = model({ rows: 1, groups: 2, height: { same: false, stat: 'sum', layer: 'counts', values: Float64Array.of(5, 6) } });
    const rows = M.longRows(O.tableOf(own));
    const k = rows[0].indexOf('Height · Sum · counts · not scaled');
    assert.ok(k > 0, rows[0].join(' | '));
    assert.deepEqual(rows.slice(1).map((r) => r[k]), ['5', '6']);
    assert.ok(!head(model({ rows: 1, groups: 2, view: undefined, height: own.height })).some((h) => /^Height/.test(h)), 'not in 2D');
});

// ------------------------------------------------------------------ the 3D labels (operator: never centred on their tick)

const ROTATED = { eye: { x: 1.6, y: 1.6, z: 1.1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
const labelsOf = (fig, axis) => fig.layout.scene.annotations.filter((a) => a.name === `${axis} label`);

test('the label anchor: right of the scene a label starts at its tick, left of it a label ends there', () => {
    // 3 columns (x: -0.5..2.5) by 2 rows (y: -0.5..1.5); per axis, its labels' edge across the box and their anchor
    const spec = { x: { labels: ['a', 'b', 'c'], positions: [0, 1, 2], extent: 3 }, y: { labels: ['p', 'q'], positions: [0, 1], extent: 2 },
        aspect: { x: 1, y: 0.67, z: 0.6 }, z: 0, font: {} };
    const sides = (camera) => {
        const list = D.sceneLabels(spec, camera);
        const one = (name, key) => { const l = list.filter((a) => a.name === name); assert.equal(new Set(l.map((a) => `${a[key]}|${a.xanchor}`)).size, 1); return l[0]; };
        const x = one('x label', 'y');
        const y = one('y label', 'x');
        return { x: [x.y, x.xanchor], y: [y.x, y.xanchor] };
    };
    // the default camera looks from (+x, -y): the x axis's near edge (y = -0.5) is on the left, the y axis's (x = 2.5) on the right
    assert.deepEqual(sides(D.DEFAULT_CAMERA), { x: [-0.5, 'right'], y: [2.5, 'left'] });
    // from (+x, +y) the near edges change sides, and so do the anchors
    assert.deepEqual(sides(ROTATED), { x: [1.5, 'left'], y: [2.5, 'right'] });
    // from (-x, +y), the default turned half round: the same sides as the default
    assert.deepEqual(sides({ ...ROTATED, eye: { x: -1.6, y: 1.6, z: 1.1 } }), { x: [1.5, 'right'], y: [-0.5, 'left'] });
});

test('3D labels are scene annotations anchored by side, Plotly\'s own centred tick labels hidden', () => {
    const fig = D.buildFigure(model({ rows: 3, groups: 4 }), LIGHT);
    const { xaxis } = fig.layout.scene;
    assert.deepEqual(xaxis.range, [-0.5, 2.5], 'the box is the cells, so the labels sit just outside it');
    const genes = labelsOf(fig, 'x');
    const groups = labelsOf(fig, 'y');
    assert.deepEqual(genes.map((a) => a.text), ['Gene0', 'Gene1', 'Gene2']);
    assert.deepEqual(groups.map((a) => a.text), ['group 0', 'group 1', 'group 2', 'group 3']);
    assert.ok(genes.every((a) => a.xanchor === 'right' && a.yanchor === 'middle' && a.showarrow === false));
    assert.ok(groups.every((a) => a.xanchor === 'left'));
    assert.deepEqual(genes.map((a) => a.x), [0, 1, 2]);
    // on the near edge (Plotly drops a scene annotation outside the box), a few px off it on the label's side
    assert.ok(genes.every((a) => a.y === -0.5 && a.xshift < 0), 'the near edge');
    assert.ok(groups.every((a) => a.x === 2.5 && a.xshift > 0));
    // a stored camera from the other side: the anchors follow it
    const turned = D.buildFigure(model({ rows: 3, groups: 4, camera: ROTATED }), LIGHT);
    assert.ok(labelsOf(turned, 'x').every((a) => a.xanchor === 'left' && a.y === 3.5));
    assert.ok(labelsOf(turned, 'y').every((a) => a.xanchor === 'right'));
    // and the panel re-anchors a drawn figure for a camera turned by the user
    assert.deepEqual(D.sceneLabels(fig.labels3d, ROTATED), turned.layout.scene.annotations);
    // Plotly's own labels and titles are hidden; each title is drawn beyond its labels, away from the box on screen
    assert.equal(xaxis.showticklabels, false);
    assert.equal(xaxis.title.text, '');
    const [gt] = fig.layout.scene.annotations.filter((a) => a.name === 'x title');
    const [yt] = fig.layout.scene.annotations.filter((a) => a.name === 'y title');
    assert.equal(gt.text, 'Genes');
    assert.equal(yt.text, 'Groups');
    // default camera: the genes' edge is lower left, the groups' lower right
    assert.ok(gt.xshift < -30 && gt.yshift < 0, JSON.stringify(gt));
    assert.ok(yt.xshift > 30 && yt.yshift < 0, JSON.stringify(yt));
});

test('3D labels: swapped axes keep each axis\'s own side; above 60 categories an axis has none', () => {
    const swapped = D.buildFigure(model({ rows: 3, groups: 4, swap: true }), LIGHT);
    assert.deepEqual(labelsOf(swapped, 'x').map((a) => a.text), ['group 0', 'group 1', 'group 2', 'group 3']);
    assert.ok(labelsOf(swapped, 'x').every((a) => a.xanchor === 'right'));
    assert.ok(labelsOf(swapped, 'y').every((a) => a.xanchor === 'left'));
    const many = D.buildFigure(model({ rows: 61, groups: 2 }), LIGHT);
    assert.equal(labelsOf(many, 'x').length, 0);
    assert.equal(labelsOf(many, 'y').length, 2);
});

test('3D text: gl3d tick text is the name as it is; annotations, hover and 2D keep the markup escaping Plotly decodes', () => {
    const NAME = 'Young | Rnase6 < 0.391 & x';
    const QUOTES = 'a > "b" \'c\' ≥ d';
    const m = model({ rows: 1, groups: 2 });
    m.groups = [{ label: NAME, n: 10 }, { label: QUOTES, n: 20 }];
    const fig = D.buildFigure(m, LIGHT);
    // the hidden gl3d tick text (drawn literally by Plotly): the literal characters, never an entity
    assert.deepEqual(fig.layout.scene.yaxis.ticktext, [NAME, QUOTES]);
    // the annotations are SVG text, which Plotly reads as markup and decodes: '<' and '&' escaped there, nothing else
    const labels = fig.layout.scene.annotations.filter((a) => a.name === 'y label').map((a) => a.text);
    assert.deepEqual(labels, ['Young | Rnase6 &lt; 0.391 &amp; x', 'a > "b" \'c\' ≥ d']);
    const hover = fig.data[0].hovertext.find((t) => t.includes('Rnase6'));
    assert.match(hover, /^Gene0<br>Young \| Rnase6 &lt; 0\.391 &amp; x · Cells: 10<br>/);
    // 2D as before: its tick text is markup too
    const twoD = D.buildFigure({ ...m, view: undefined }, LIGHT);
    assert.deepEqual(twoD.layout.yaxis.ticktext, ['Young | Rnase6 &lt; 0.391 &amp; x', 'a > "b" \'c\' ≥ d']);
});

test('the 3D colour bar is the Cell Plot\'s (plot-utilities/colour-bar.js): its title runs along the bar', () => {
    const { colorbar } = D.buildFigure(model(), LIGHT).data[0];
    assert.equal(colorbar.title.side, 'right');
    assert.equal(colorbar.title.text, 'Mean · X');
    assert.equal(colorbar.title.font.color, LIGHT.textColor);
    assert.equal(colorbar.len, 0.7);
    assert.equal(D.buildFigure(model({ legend: { colorBar: false } }), LIGHT).data[0].showscale, false);
});

// ------------------------------------------------------------------ the 3D labels' options (operator: side and justification)

const SPEC = { x: { labels: ['a', 'b', 'c'], positions: [0, 1, 2], extent: 3 }, y: { labels: ['p', 'q'], positions: [0, 1], extent: 2 },
    aspect: { x: 1, y: 0.67, z: 0.6 }, z: 0, font: {} };
const placed = (list, name) => {
    const l = list.filter((a) => a.name === name);
    return { edge: name === 'x label' ? l[0].y : l[0].x, xanchor: [...new Set(l.map((a) => a.xanchor))].join(), xshift: [...new Set(l.map((a) => a.xshift))].join() };
};

test('labels3d is kept in the configuration only when not the default, and a fixed side keeps its edges', () => {
    const keep = { side: 'fixed', edges: { x: 'max', y: 'min' }, justify: 'center' };
    assert.deepEqual(S.normalizeCellGene({ labels3d: keep }).config.labels3d, keep);
    assert.equal('labels3d' in S.normalizeCellGene({ labels3d: { side: 'auto', justify: 'auto' } }).config, false, 'defaults are absent');
    assert.deepEqual(S.normalizeCellGene({ labels3d: { justify: 'left' } }).config.labels3d, { justify: 'left' });
    const bad = S.normalizeCellGene({ labels3d: { side: 'sideways', justify: 'up' } });
    assert.equal('labels3d' in bad.config, false);
    assert.equal(bad.problems.length, 2, bad.problems.join('; '));
    // a fixed side with no edges stored is the default camera's edges
    assert.deepEqual(S.normalizeCellGene({ labels3d: { side: 'fixed' } }).config.labels3d, { side: 'fixed', edges: { x: 'min', y: 'max' } });
});

test('Side Fixed keeps the edges as the camera turns; Justify Auto still runs outward for the camera', () => {
    const fixed = { ...SPEC, options: { side: 'fixed', edges: { x: 'min', y: 'max' } } };
    // from (+x, +y) Auto moves the genes to the edge now nearer (1.5); Fixed keeps them at -0.5, whose middle is now on the
    // left of the screen, so they end at their ticks
    assert.deepEqual(placed(D.sceneLabels(SPEC, ROTATED), 'x label'), { edge: 1.5, xanchor: 'left', xshift: '4' });
    assert.deepEqual(placed(D.sceneLabels(fixed, ROTATED), 'x label'), { edge: -0.5, xanchor: 'right', xshift: '-4' });
    assert.deepEqual(placed(D.sceneLabels(fixed, D.DEFAULT_CAMERA), 'x label'), { edge: -0.5, xanchor: 'right', xshift: '-4' });
});

test('Justify Left, Right or Center sets every label\'s anchor whatever the camera; Center sits on the tick', () => {
    for (const camera of [D.DEFAULT_CAMERA, ROTATED]) {
        assert.deepEqual(placed(D.sceneLabels({ ...SPEC, options: { justify: 'left' } }, camera), 'y label').xanchor, 'left');
        assert.deepEqual(placed(D.sceneLabels({ ...SPEC, options: { justify: 'right' } }, camera), 'x label').xshift, '-4');
        assert.deepEqual(placed(D.sceneLabels({ ...SPEC, options: { justify: 'center' } }, camera), 'x label').xanchor, 'center');
        assert.deepEqual(placed(D.sceneLabels({ ...SPEC, options: { justify: 'center' } }, camera), 'y label').xshift, '0');
    }
});

test('looking straight down, the anchors stay those of the default view rather than collapsing to one side', () => {
    const above = { eye: { x: 0, y: 0, z: 2.5 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    const list = D.sceneLabels(SPEC, above);
    assert.notEqual(placed(list, 'x label').xanchor, placed(list, 'y label').xanchor);
});

test('the options reach the figure: figureExtras passes labels3d, and the 3D figure draws with it', () => {
    const config = { mode: 'heatmap', view: '3d', labels3d: { justify: 'center' } };
    assert.deepEqual(O.figureExtras(config).labels3d, { justify: 'center' });
    const fig = D.buildFigure(model({ rows: 2, groups: 2, labels3d: { justify: 'center' } }), LIGHT);
    assert.ok(fig.layout.scene.annotations.filter((a) => a.name === 'x label' || a.name === 'y label').every((a) => a.xanchor === 'center'));
    assert.equal(fig.labels3d.options.justify, 'center');
});

// ------------------------------------------------------------------ Rotation, Padding, the Labels switches, the height's labels

const withOpts = (options) => ({ ...SPEC, options: D.labelOptions3d({ labels3d: options }) });
const xy = (list) => list.filter((a) => a.name === 'x label' || a.name === 'y label');

test('Rotation: Horizontal is level; an angle tilts every label, anchored at the end of its text; Along follows each edge', () => {
    assert.ok(xy(D.sceneLabels(withOpts({}), D.DEFAULT_CAMERA)).every((a) => a.textangle === 0 && a.yanchor === 'middle'));
    const tilted = xy(D.sceneLabels(withOpts({ rotation: 30 }), D.DEFAULT_CAMERA));
    assert.ok(tilted.every((a) => a.textangle === 30));
    // clockwise: a label starting at its tick (left) has its start at the top of its box, one ending there at the bottom
    assert.ok(tilted.every((a) => a.yanchor === (a.xanchor === 'left' ? 'top' : 'bottom')), JSON.stringify(tilted.map((a) => [a.xanchor, a.yanchor])));
    const along = D.sceneLabels(withOpts({ rotation: 'along' }), D.DEFAULT_CAMERA);
    const angleOf = (list, name) => [...new Set(list.filter((a) => a.name === name).map((a) => a.textangle))];
    const [gx] = angleOf(along, 'x label');
    const [gy] = angleOf(along, 'y label');
    assert.equal(angleOf(along, 'x label').length, 1);
    assert.ok(gx > 0 && gx < 90 && gy < 0 && gy > -90, `${gx} ${gy}`, 'from the default camera x runs down to the right, y up to the right');
    const turned = D.sceneLabels(withOpts({ rotation: 'along' }), ROTATED);
    assert.notEqual(angleOf(turned, 'x label')[0], gx, 'recomputed for the camera');
    // Across: square to the edge, and running out of the box (the genes' edge is lower left: out is down and left)
    const across = D.sceneLabels(withOpts({ rotation: 'across' }), D.DEFAULT_CAMERA);
    const [ax] = angleOf(across, 'x label');
    assert.ok(Math.abs(Math.abs(ax - gx) - 90) < 1e-6, `${ax} ${gx}`);
    const genes = across.filter((a) => a.name === 'x label');
    const t = ax * Math.PI / 180;
    const sign = genes[0].xanchor === 'left' ? 1 : -1;
    assert.ok(sign * Math.cos(t) < 0 && sign * Math.sin(t) > 0, `${ax} ${genes[0].xanchor}: the text runs down and to the left`);
});

test('Padding sets the gap between a label and its tick; the default is 4', () => {
    assert.ok(xy(D.sceneLabels(withOpts({}), D.DEFAULT_CAMERA)).every((a) => Math.abs(a.xshift) === 4));
    assert.ok(xy(D.sceneLabels(withOpts({ padding: 12 }), D.DEFAULT_CAMERA)).every((a) => Math.abs(a.xshift) === 12));
    assert.equal(D.labelOptions3d({ labels3d: { padding: 99 } }).padding, 40);
    assert.deepEqual(S.normalizeCellGene({ labels3d: { rotation: 'along', padding: 10 } }).config.labels3d, { rotation: 'along', padding: 10 });
    assert.deepEqual(S.normalizeCellGene({ labels3d: { rotation: 120 } }).config.labels3d, { rotation: 90 });
    assert.equal('labels3d' in S.normalizeCellGene({ labels3d: { rotation: 'horizontal', padding: 4 } }).config, false);
    assert.equal(S.normalizeCellGene({ labels3d: { rotation: 'diagonal', padding: 'x' } }).problems.length, 2);
});

test('Plot Options ▸ Labels apply in 3D: an axis\'s labels hidden take its title with them; the other stays', () => {
    const shown = { annotations: { labels: { genes: false } } };
    assert.deepEqual(D.labelOptions3d(shown).show, { genes: false, groups: true });
    const fig = D.buildFigure(model({ rows: 3, groups: 2, ...shown }), LIGHT);
    const names = fig.layout.scene.annotations.map((a) => a.name);
    assert.ok(!names.includes('x label') && !names.includes('x title'), names.join());
    assert.ok(names.includes('y label') && names.includes('y title'));
    const swapped = D.buildFigure(model({ rows: 3, groups: 2, swap: true, ...shown }), LIGHT);
    assert.ok(!swapped.layout.scene.annotations.some((a) => a.name === 'y label'), 'genes on y when swapped');
});

test('the height\'s labels: round ticks off the floor, ending at the left-most vertical edge; Plotly\'s own hidden', () => {
    const fig = D.buildFigure(model({ rows: 3, groups: 4 }), LIGHT);
    const { zaxis } = fig.layout.scene;
    assert.equal(zaxis.showticklabels, false);
    assert.equal(zaxis.title.text, '');
    const z = fig.layout.scene.annotations.filter((a) => a.name === 'z label');
    // heights 1 to 3.1: ticks 0 to 3 a step of 1 apart, and the floor (0) not labelled
    assert.deepEqual(z.map((a) => a.text), ['1', '2', '3']);
    assert.ok(z.every((a) => a.xanchor === 'right' && a.xshift === -4));
    assert.deepEqual(zaxis.tickvals, [0, 1, 2, 3], 'the grid keeps its floor line');
    // the default camera looks from (+x, -y): the left-most corner is (x min, y min)
    assert.deepEqual([z[0].x, z[0].y], [-0.5, -0.5]);
    const zt = fig.layout.scene.annotations.find((a) => a.name === 'z title');
    assert.equal(zt.textangle, -90);
    assert.ok(zt.xshift < -20);
});
