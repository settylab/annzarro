/**
 * X5: the Cell-Gene Plot's Plot Options and Cluster menu, as they reach the figure (static/js/panels/cell-gene/options.js;
 * UX 3.1, 3.3, 3.4; requirements 5.3).
 *
 * ONE TEST PER "Now" ROW of the scanpy parity table (requirements 5.3): each row's option, set as the panel stores it,
 * reaches the figure the panel draws. The panel builds its drawing model from the matrix (X2a, X3a) and adds what the
 * options say with `figureExtras(config, ctx)` and `barSettings(config)`; these tests compose the model the same way
 * and hold the figure of draw.js (X4a) and draw-annotations.js (X4b).
 *
 * Then what X5 adds to the drawing itself: the strips' legend (which factor, which colors), placed in the legend column
 * clear of the modebar; the placeholder rows of a section still being read (CXG-18).
 *
 * Run:  node --test annzarro/tests/js/cell-gene-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const O = await import('../../../static/js/panels/cell-gene/options.js');
const D = await import('../../../static/js/panels/cell-gene/draw.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const { EXTRA_SCALES } = await import('../../../static/js/utils/color-scales.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { normalizeGrouping } = await import('../../../static/js/utils/cell-grouping.js');
const { normalizeCellGene, planFeatures } = await import('../../../static/js/panels/cell-gene/sections.js');
const { columnHeader, longRows, longCsv } = await import('../../../static/js/utils/cell-gene-model.js');

const W = VOCABULARY.cellGene;
const LIGHT = PLOT_PALETTES.light;

// --- the panel's composition, as cell-gene.js drawFigure does it --------------------------------------------------

const TWO_FACTORS = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'cell_type' } }, { source: { type: 'obs', key: 'age' } }] }).recipe;
const ONE_FACTOR = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'cell_type' } }] }).recipe;

/** A reply of four groups: cell_type B/T crossed with age Old/Young, cell_type's colors from the column. */
function reply2() {
    return {
        partitionings: [
            { levels: ['c:B', 'c:T'], colors: { 'c:B': '#e41a1c', 'c:T': '#377eb8' } },
            { levels: ['c:Old', 'c:Young'] }
        ],
        groups: [
            { key: ['c:B', 'c:Old'], n: 100 }, { key: ['c:B', 'c:Young'], n: 200 },
            { key: ['c:T', 'c:Old'], n: 300 }, { key: ['c:T', 'c:Young'], n: 400 }
        ],
        n_shown: 1000
    };
}

const identity = (n) => Int32Array.from({ length: n }, (_, i) => i);
const unclustered = (rows, groups) => ({ rows: identity(rows), groups: identity(groups), rowBlocks: [], groupBlocks: [], rowsLeftOut: 0, groupsLeftOut: 0 });

/** `rows` genes over four groups, two sections; the plot's config fields over that. */
function compose(fields = {}, { rows = 6, split = 3, reply = reply2(), recipe = TWO_FACTORS, order, values, size, scaling } = {}) {
    const config = normalizeCellGene({
        version: 1, mode: 'dots', cellAxis: { type: 'obs', key: 'cell_type' },
        sections: [{ source: 'S1', rows: 'genes' }, { source: 'S2', rows: 'genes' }],
        color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged' }, ...fields
    }).config;
    const G = reply.groups.length;
    const colour = values || Float64Array.from({ length: rows * G }, (_, i) => (i % 7) / 2);
    const sized = size || Float64Array.from({ length: rows * G }, (_, i) => (i * 13) % 101);
    const ord = order || unclustered(rows, G);
    const extras = O.figureExtras(config, { reply, recipe, order: ord, titleOf: () => undefined });
    const model = {
        mode: config.mode, swap: !!config.swap, pixels: { width: 900, height: 600 },
        groups: Array.from(ord.groups, (g) => ({ label: `group ${g}`, n: reply.groups[g].n })),
        rows: Array.from({ length: rows }, (_, r) => ({
            label: `Gene${r}`, gapBefore: r === split ? 1 : 0,
            section: r < split ? { index: 0, title: 'B cell markers' } : { index: 1, title: 'T cell markers' }
        })),
        color: { id: 'mean|logged', stat: 'mean', layer: 'logged', scaling: scaling || config.scale || 'none', ...O.barSettings(config),
            ...extras.color, values: colour, raw: colour },
        size: config.mode !== 'dots' ? { none: '' }
            : { id: 'pct|logged', stat: 'pct_expressing', layer: 'logged', detectAbove: 0, ...extras.size, values: sized },
        legend: extras.legend, plotTitle: extras.plotTitle, annotations: extras.annotations
    };
    return { config, model, figure: D.buildFigure(model, LIGHT), extras };
}

const named = (fig, name) => fig.data.filter((t) => t.name === name);
const one = (fig, name) => {
    const t = named(fig, name);
    assert.equal(t.length, 1, `one "${name}" trace, got ${t.length}`);
    return t[0];
};
const matrixTraces = (fig) => fig.data.filter((t) => !t.name && (t.type === 'scatter' || t.type === 'scattergl' || t.type === 'heatmap'));
const colourBarTitles = (fig) => matrixTraces(fig).map((t) => (t.marker && t.marker.colorbar) || t.colorbar).filter(Boolean).map((c) => c.title.text);
const sizeTitles = (fig) => fig.layout.annotations.filter((a) => a.xref === 'paper' && named(fig, 'size legend').length).map((a) => a.text);

// ================================================================================================ the "Now" rows (5.3)

test('5.3 var_names as a list: one section draws its genes in the source order, under one bracket', () => {
    const { figure } = compose({ sections: [{ source: 'S1', rows: 'genes' }] }, { rows: 4, split: 99 });
    const brackets = one(figure, 'section brackets');
    assert.equal(brackets.x.filter((v) => v === null).length, 1, 'one bracket');
    assert.deepEqual(figure.layout.xaxis.ticktext, ['Gene0', 'Gene1', 'Gene2', 'Gene3']);
});

test('5.3 var_names as a mapping, var_group_labels: each section a titled bracket; Show section titles off keeps the brackets bare', () => {
    const on = compose().figure;
    assert.deepEqual(on.layout.annotations.filter((a) => a.name === 'section title').map((a) => a.text), ['B cell markers', 'T cell markers']);
    const off = compose({ sectionTitles: false }).figure;
    assert.equal(off.layout.annotations.filter((a) => a.name === 'section title').length, 0);
    one(off, 'section brackets');
    // the gap between sections, 0 to 3 cells (CXG-6), is the panel's gapBefore; a gap of 0 draws no blank column
    assert.equal(O.figureExtras(normalizeCellGene({ gap: 7 }).config, {}).gap, 3);
    assert.equal(O.figureExtras(normalizeCellGene({ gap: 0 }).config, {}).gap, 0);
    assert.equal(O.figureExtras(normalizeCellGene({}).config, {}).gap, 1);
});

test('5.3 groupby, several keys: one strip per factor, colored by its levels, in the drawn group order', () => {
    const { figure, extras } = compose();
    const strips = extras.annotations.strips;
    assert.deepEqual(strips.map((s) => s.title), ['cell_type', 'age']);
    assert.deepEqual(strips[0].colours, ['#e41a1c', '#e41a1c', '#377eb8', '#377eb8'], "a column's own colors");
    assert.deepEqual(strips[0].levels, ['B', 'B', 'T', 'T']);
    assert.deepEqual(strips[1].levels, ['Old', 'Young', 'Old', 'Young']);
    assert.notEqual(strips[1].colours[0], strips[1].colours[1], 'a factor with no colors of its own takes the palette per level');
    assert.equal(named(figure, 'group strip').length, 2);
    // the groups clustered or sorted: the strips follow the drawn order
    const order = { ...unclustered(6, 4), groups: Int32Array.from([3, 2, 1, 0]) };
    assert.deepEqual(compose({}, { order }).extras.annotations.strips[1].levels, ['Young', 'Old', 'Young', 'Old']);
});

test('5.3 num_categories: a binned factor\'s strip is labelled with its bins', () => {
    const recipe = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'age_days' }, binning: { method: 'equal_width', bins: 2 } }] }).recipe;
    const reply = {
        partitionings: [{ levels: ['bin:0', 'bin:1'], edges: [0, 50, 100] }],
        groups: [{ key: ['bin:0'], n: 10 }, { key: ['bin:1'], n: 20 }, { key: ['bin:0'], n: 1 }, { key: ['bin:1'], n: 2 }], n_shown: 33
    };
    const strips = O.figureExtras(normalizeCellGene({}).config, { reply, recipe, order: unclustered(1, 4), titleOf: () => undefined }).annotations.strips;
    assert.equal(strips.length, 1);
    assert.ok(strips[0].levels.every((l) => !l.startsWith('bin:')), `bins have labels, not ids: ${strips[0].levels}`);
    assert.notEqual(strips[0].levels[0], strips[0].levels[1]);
});

test('5.3 categories_order: the strip legend lists the levels in the grouping\'s level order', () => {
    const reply = reply2();
    reply.partitionings[1].levels = ['c:Young', 'c:Old'];
    const { extras } = compose({}, { reply });
    assert.deepEqual(extras.annotations.strips[1].legend.map((e) => e.label), ['Young', 'Old']);
});

test('5.3 layer: the color bar names the statistic and the layer it reads', () => {
    assert.deepEqual(colourBarTitles(compose().figure), ['Mean · logged']);
});

test('5.3 expression_cutoff: the Size threshold Plot Options stores is what the size statistic is read with', () => {
    // Plot Options writes it as size.detect_above (the browser test drives the box); empty, Size reads Color's
    const config = normalizeCellGene({ size: { stat: 'pct_expressing', layer: 'logged', detect_above: 0.5 } }).config;
    const plan = planFeatures({ sections: [{ section: { source: 'S1', rows: 'genes' }, genes: ['G1'], title: 'S1' }],
        color: config.color, size: config.size, threshold: 0 });
    assert.ok(plan.features.some((f) => f.wire.detect_above === 0.5), 'the gene is asked with the size threshold');
    const { model } = compose({ size: config.size });
    model.size.detectAbove = 0.5;
    const fig = D.buildFigure(model, LIGHT);
    assert.ok(fig.layout.annotations.some((a) => a.text === '% expressing (> 0.5) · logged'), 'the size legend names the threshold');
});

test('5.3 mean_only_expressed: a group with no expressing cell is noted in the table and the CSV', () => {
    const { model } = compose({ color: { stat: 'mean_expressing', layer: 'logged' } });
    model.color.stat = 'mean_expressing';
    model.color.noExpressing = new Uint8Array(model.color.values.length);
    model.color.noExpressing[1] = 1;
    const rows = longRows(O.tableOf(model));
    assert.equal(rows[0][rows[0].length - 1], W.csv.note);
    assert.equal(rows[2][rows[0].length - 1], W.noExpressingCells, 'row 0, group 1');
    assert.equal(rows[1][rows[0].length - 1], '');
});

test('5.3 standard_scale: the scaling help line, the pooled note under z_pooled, and headers naming the scaling', () => {
    // the lines Plot Options shows under the scaling (the browser test reads them in the menu)
    assert.equal(W.options.scalingNote, 'Groups with no value are skipped; a constant gene gives 0.');
    assert.match(W.options.pooledNote, /one-row section/i);
    assert.match(W.options.pooledNote, /across its own groups/);
    const { model } = compose({ scale: 'var' }, { scaling: 'var' });
    const head = longRows(O.tableOf(model))[0];
    assert.ok(head.includes(columnHeader({ stat: 'mean', layer: 'logged', scaling: 'none' })), 'the statistic as computed');
    assert.ok(head.includes(columnHeader({ stat: 'mean', layer: 'logged', scaling: 'var' })), 'and as displayed');
});

test('5.3 dot_color_df, dot_size_df: Color and Size are separate columns, each with its own statistic and layer', () => {
    const { model } = compose();
    model.size.layer = 'counts';
    const head = longRows(O.tableOf(model))[0];
    assert.deepEqual(head, [W.csv.section, W.csv.row, W.csv.group, W.csv.cells,
        columnHeader({ stat: 'mean', layer: 'logged', scaling: 'none' }), columnHeader({ stat: 'pct_expressing', layer: 'counts', scaling: 'none' })]);
    // the CSV and the table are one specification
    assert.equal(longCsv(O.tableOf(model)).split('\n')[0], head.join(','));
});

test('5.3 cmap, vmin, vmax, vcenter: Color scale, Min, Max and a Center for a diverging scale', () => {
    const fig = compose({ colorScale: 'RdBu', limits: [0, 3], center: 1 }).figure;
    const marker = matrixTraces(fig)[0].marker;
    assert.equal(marker.colorscale, 'RdBu');
    assert.equal(marker.cmin, -1, 'symmetric about the center: max(3-1, 1-0) either side');
    assert.equal(marker.cmax, 3);
    // a center applies to diverging scales only, and a scale Plotly has no name for is given as stops
    const seq = matrixTraces(compose({ colorScale: 'Inferno', limits: [0, 3], center: 1 }).figure)[0].marker;
    assert.deepEqual(seq.colorscale, EXTRA_SCALES.Inferno);
    assert.equal(seq.cmin, 0);
    assert.equal(seq.cmax, 3);
    // the clustering reads the same bars (operator decision 19): barSettings carries the center
    assert.deepEqual(O.barSettings(normalizeCellGene({ colorScale: 'RdBu', limits: [0, 3], center: 1 }).config), { min: 0, max: 3, center: 1 });
});

test('5.3 dot_min, dot_max: the % at the smallest and largest dot set the size legend\'s range', () => {
    const fig = compose({ dotMin: 10, dotMax: 60 }).figure;
    const legend = one(fig, 'size legend');
    assert.deepEqual(legend.text, ['10', '22.5', '35', '47.5', '60']);
});

test('5.3 smallest_dot, largest_dot: one range of dot sizes in px', () => {
    const fig = compose({ dotSizes: [5, 12] }).figure;
    const sizes = matrixTraces(fig)[0].marker.size;
    assert.ok(sizes.every((s) => s >= 5 && s <= 12), `${sizes.slice(0, 10)}`);
    assert.ok(sizes.includes(5) && sizes.includes(12), 'both ends are used');
});

test('5.3 swap_axes: the strips and the dendrograms follow the groups to the other axis', () => {
    const order = clusteredGroups();
    const { figure } = compose({ swap: true, cluster: { genes: 'off', groups: 'all', linkage: 'complete', distance: 'correlation' } }, { order });
    const strip = named(figure, 'group strip')[0];
    assert.equal(strip.orientation, 'v', 'groups on x: the strip bars stand along it');
    const tree = one(figure, 'dendrogram groups');
    assert.equal(figure.layout[`xaxis${tree.xaxis.slice(1)}`].matches, 'x');
});

/** An order whose groups were clustered as one block of four, with scipy's linkage matrix. */
function clusteredGroups() {
    return {
        ...unclustered(6, 4), groups: Int32Array.from([1, 0, 3, 2]),
        groupBlocks: [{ start: 0, count: 4, state: 'clustered', clustered: Int32Array.from([0, 1, 2, 3]), excluded: new Int32Array(0),
            merges: Float64Array.from([0, 1, 0.2, 2, 2, 3, 0.3, 2, 4, 5, 0.9, 4]) }]
    };
}

test('5.3 dendrogram, add_dendrogram: a tree for each clustered block; Dendrograms off draws none', () => {
    const cluster = { genes: 'off', groups: 'all', linkage: 'complete', distance: 'correlation' };
    const on = compose({ cluster }, { order: clusteredGroups() });
    assert.equal(on.extras.annotations.dendrograms.groups.length, 1);
    one(on.figure, 'dendrogram groups');
    const off = compose({ cluster: { ...cluster, dendrograms: false } }, { order: clusteredGroups() });
    assert.equal(named(off.figure, 'dendrogram groups').length, 0);
    // clustering off: no tree, whatever the order holds
    assert.equal(named(compose({}, { order: clusteredGroups() }).figure, 'dendrogram groups').length, 0);
    // the defaults are scanpy's (OD 16)
    assert.deepEqual(O.figureExtras(normalizeCellGene({}).config).cluster,
        { genes: 'off', groups: 'off', linkage: 'complete', distance: 'correlation', dendrograms: true });
    // Ward is Euclidean whatever a link says (CXG-21)
    assert.equal(O.figureExtras(normalizeCellGene({ cluster: { linkage: 'ward', distance: 'correlation' } }).config).cluster.distance, 'euclidean');
});

test('5.3 add_totals: Cells per group draws the totals bar; Sort groups by size is the order\'s', () => {
    assert.equal(named(compose().figure, 'cells per group').length, 0);
    const bar = one(compose({ totals: true }).figure, 'cells per group');
    assert.deepEqual(bar.x, [100, 200, 300, 400]);
    assert.equal(O.figureExtras(normalizeCellGene({ sortGroups: true }).config, {}).sortBySize, true);
});

test('5.3 title, colorbar_title, size_title: the titles of Plot Options replace the defaults', () => {
    const fig = compose({ titles: { plot: 'Markers', color: 'Expression', size: 'Fraction' } }).figure;
    assert.equal(fig.layout.title.text, 'Markers');
    assert.deepEqual(colourBarTitles(fig), ['Expression']);
    assert.ok(fig.layout.annotations.some((a) => a.text === 'Fraction'), 'the size legend title');
    // empty titles are the defaults
    const plain = compose({ titles: { plot: '', color: '' } }).figure;
    assert.equal(plain.layout.title, undefined);
    assert.deepEqual(colourBarTitles(plain), ['Mean · logged']);
});

test('5.3 legend(show_colorbar, show_size_legend): each legend can be hidden', () => {
    const fig = compose({ legend: { colorBar: false, sizeLegend: false } }).figure;
    assert.deepEqual(colourBarTitles(fig), []);
    assert.equal(named(fig, 'size legend').length, 0);
    assert.equal(sizeTitles(fig).length, 0);
});

test('5.3 show_gene_labels: gene and group labels can be hidden', () => {
    const fig = compose({ labels: { genes: false, groups: false } }).figure;
    assert.equal(fig.layout.xaxis.showticklabels, false);
    assert.equal(fig.layout.yaxis.showticklabels, false);
    const shown = compose().figure;
    assert.notEqual(shown.layout.xaxis.showticklabels, false);
});

test('5.3 group colour strip: the strips have a legend naming each factor and its colors', () => {
    const fig = compose().figure;
    const legends = named(fig, 'strip legend');
    assert.equal(legends.length, 2, 'one per factor');
    assert.deepEqual(legends[0].marker.color, ['#e41a1c', '#377eb8']);
    assert.deepEqual(legends[0].text, ['B', 'T']);
    const titles = fig.layout.annotations.filter((a) => a.name === 'strip legend title').map((a) => a.text);
    assert.deepEqual(titles, ['cell_type', 'age']);
    // Legend: the strips' legend can be hidden like the others
    assert.equal(named(compose({ legend: { strips: false } }).figure, 'strip legend').length, 0);
});

test('5.3 values printed in the cells: a heatmap option, ignored for dots', () => {
    const heat = compose({ mode: 'heatmap', printValues: true }).figure;
    assert.ok(matrixTraces(heat).some((t) => t.texttemplate), 'the values are printed');
    assert.equal(compose({ mode: 'heatmap' }).figure.data.some((t) => t.texttemplate), false);
    assert.equal(O.figureExtras(normalizeCellGene({ printValues: true }).config, {}).color.printValues, undefined);
});

// ================================================================================================ the strips' legend

test('the strips\' legend stands in the legend column below the modebar, past the color bar and the size legend', () => {
    const fig = compose().figure;
    const titles = fig.layout.annotations.filter((a) => a.name === 'strip legend title');
    const reserve = 36 / (600 - 20);
    for (const t of titles) assert.ok(t.y <= 1 - reserve + 1e-9, `title at ${t.y} is clear of the modebar`);
    const bar = matrixTraces(fig)[0].marker.colorbar;
    assert.ok(titles[0].y < bar.y, 'below the color bar');
    assert.ok(titles.every((t) => t.x === bar.x), 'in the same column');
    // the legend's subplot stays inside the figure
    for (const legend of named(fig, 'strip legend')) {
        const y = fig.layout[`yaxis${legend.yaxis.slice(1)}`].domain;
        assert.ok(y[0] >= -1e-9 && y[1] <= 1 + 1e-9 && y[1] > y[0], `${y}`);
    }
});

test('the strips\' legend shows as many levels as fit and says how many more', () => {
    const levels = Array.from({ length: 60 }, (_, i) => `c:L${i}`);
    const reply = { partitionings: [{ levels }], groups: levels.map((id, i) => ({ key: [id], n: i + 1 })), n_shown: 1830 };
    const { figure } = compose({}, { reply, recipe: ONE_FACTOR, rows: 2, split: 99 });
    const legend = one(figure, 'strip legend');
    assert.ok(legend.text.length < 60, `${legend.text.length} shown`);
    assert.equal(legend.text[legend.text.length - 1], W.options.more(60 - (legend.text.length - 1)));
});

// ================================================================================================ CXG-18 placeholders

test('CXG-18: rows still being read are drawn as placeholders with the reading sentence, not as missing values', () => {
    const { model } = compose({ mode: 'heatmap' });
    const G = 4;
    for (let g = 0; g < G; g++) { model.color.values[3 * G + g] = NaN; model.color.values[4 * G + g] = NaN; model.color.values[5 * G + g] = NaN; }
    model.rows[3].pending = true;
    model.rows[4].pending = true;
    model.rows[5].pending = true;
    model.pendingText = 'Reading 3 genes';
    const fig = D.buildFigure(model, LIGHT);
    const pending = one(fig, 'rows being read');
    const texts = pending.text.flat().filter(Boolean);
    assert.equal(texts.length, 12, 'every cell of the three rows');
    assert.ok(texts.every((t) => t.includes('Reading 3 genes')));
    // they are not the gap color of a missing value
    const noValue = fig.data.filter((t) => t.type === 'heatmap' && t.text && t.text.flat().some((x) => x && x.includes(VOCABULARY.word.noValue)));
    assert.equal(noValue.length, 0);
    // dots: a faint marker per cell, the same hover
    const dots = compose({});
    for (let g = 0; g < G; g++) dots.model.color.values[5 * G + g] = NaN;
    dots.model.rows[5].pending = true;
    dots.model.pendingText = 'Reading 1 gene';
    const dfig = D.buildFigure(dots.model, LIGHT);
    const marks = one(dfig, 'rows being read');
    assert.equal(marks.x.length, 4);
    assert.ok(marks.text.every((t) => t.includes('Reading 1 gene')));
});
