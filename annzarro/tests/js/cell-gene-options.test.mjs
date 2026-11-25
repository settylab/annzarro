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
        legend: extras.legend, plotTitle: extras.plotTitle, annotations: extras.annotations, outline: extras.outline, dotOpacity: extras.dotOpacity
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
    // the title wraps to the legend column at 900 px; read as one line it names the threshold
    assert.ok(fig.layout.annotations.some((a) => a.text.split('<br>').join(' ') === '% expressing (> 0.5) · logged'), 'the size legend names the threshold');
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
        columnHeader({ stat: 'mean', layer: 'logged', scaling: 'none' }), columnHeader({ stat: 'pct_expressing', layer: 'counts', detectAbove: 0, scaling: 'none' })]);
    assert.equal(head[5], '% expressing (> 0) · counts · not scaled', 'a thresholded column names its threshold (WP-4)');
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
    // a figure tall enough for all five reference dots (the legend column holds four entries here); the largest dot
    // fills its cell by default, so here it takes a fifth of it, and each reference dot gets its 16 px line
    const { model } = compose({ dotMin: 10, dotMax: 60, dotScale: 20 });
    model.pixels = { width: 900, height: 1200 };
    assert.deepEqual(one(D.buildFigure(model, LIGHT), 'size legend').text, ['10', '22.5', '35', '47.5', '60']);
});

test('the size legend\'s reference dots never crowd their labels: fewer of them, still from dot_min to dot_max, in a short slot', () => {
    for (const height of [600, 420, 300]) {
        const { model } = compose({ dotMin: 10, dotMax: 60 });
        model.pixels = { width: 900, height };
        const fig = D.buildFigure(model, LIGHT);
        const legend = one(fig, 'size legend');
        assert.ok(legend.text.length >= 2 && legend.text.length <= 5, `${height}: ${legend.text}`);
        assert.equal(legend.text[0], '10');
        assert.equal(legend.text[legend.text.length - 1], '60');
        // each dot's line, in px: the subplot's height over its range
        const y = fig.layout[`yaxis${legend.yaxis.slice(1)}`];
        const linePx = ((y.domain[1] - y.domain[0]) * (height - 20)) / (y.range[0] - y.range[1]);
        assert.ok(linePx >= 16 - 1e-6 || legend.text.length === 2, `${height}: ${linePx.toFixed(1)} px per reference dot`);
    }
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
        { genes: 'off', groups: 'off', linkage: 'complete', distance: 'correlation', dendrograms: { genes: true, groups: true } });
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

test('a one-row section with a quantity of its own is a column named by its section and aggregation, never "undefined"', () => {
    const { model } = compose();
    model.rows[5] = { ...model.rows[5], label: 'Pathway', section: { index: 1, title: 'Pathway' },
        own: { color: { id: 'rows_sum|mean|logged|', label: 'cells: Mean · logged; genes: sum' } } };
    const rows = longRows(O.tableOf(model));
    const head = rows[0];
    const own = columnHeader({ label: 'cells: Mean · logged; genes: sum', scaling: 'none', section: 'Pathway' });
    assert.equal(own, 'Pathway · cells: Mean · logged; genes: sum · not scaled');
    assert.ok(head.includes(own), head.join(' | '));
    assert.ok(!head.some((h) => h.includes('undefined')), head.join(' | '));
    // its values are on its row only; the genes' column leaves that row empty
    const at = head.indexOf(own);
    const main = head.indexOf(columnHeader({ stat: 'mean', layer: 'logged', scaling: 'none' }));
    const pathway = rows.filter((r) => r[1] === 'Pathway');
    assert.equal(pathway.length, 4);
    assert.ok(pathway.every((r) => r[at] !== '' && r[main] === ''));
    assert.ok(rows.slice(1).filter((r) => r[1] !== 'Pathway').every((r) => r[at] === ''));
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

// ================================================================================================ legend titles at a narrow width

test('legend titles fit the legend column of a narrow figure, wrapping at spaces, and a cut title keeps its whole text in hover', () => {
    const narrow = { width: 340, height: 520 };
    const { model } = compose({ titles: { color: 'Mean expression of the marker genes, logged counts' } });
    model.pixels = narrow;
    model.annotations.strips[0].title = 'cell_type_annotation_from_the_atlas';
    const fig = D.buildFigure(model, LIGHT);
    const bar = matrixTraces(fig)[0].marker.colorbar;
    // the legend column keeps at least 120 px: the plot gives way, not the legends
    assert.ok((narrow.width - 20) * (1 - bar.x) >= 120 - 1e-6, `${bar.x}`);
    assert.ok(fig.layout.xaxis.domain[1] < bar.x, 'the matrix ends before the legend column');
    const chars = Math.floor(((narrow.width - 20) * (1 - bar.x)) / (0.58 * 12));
    const titles = [bar.title.text,
        ...fig.layout.annotations.filter((a) => a.xref === 'paper' && a.name !== 'legend title hover' && a.x === bar.x && a.text).map((a) => a.text)];
    assert.ok(titles.length >= 4, `the color bar, the size legend and two strips: ${titles.length}`);
    for (const t of titles) {
        const lines = t.split('<br>');
        assert.ok(lines.length <= 3, t);
        for (const line of lines) assert.ok(line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').length <= chars, `"${line}" is over ${chars} characters`);
    }
    // the size legend's title wraps whole: nothing is cut, so its words read back unchanged
    const size = fig.layout.annotations.find((a) => a.text.split('<br>').join(' ') === '% expressing (> 0) · logged');
    assert.ok(size, 'the size legend title wraps at spaces and loses nothing');
    assert.equal(size.hovertext, undefined);
    assert.ok(size.text.split('<br>').some((l) => l.includes('(> 0)')), `a bracketed part never breaks: ${size.text}`);
    // a title cut to fit has its whole text in hover: the color bar's over it, the strip's on itself
    const barHover = fig.layout.annotations.find((a) => a.name === 'legend title hover');
    assert.equal(barHover.hovertext, 'Mean expression of the marker genes, logged counts');
    assert.ok(bar.title.text.endsWith('…'));
    const strip = fig.layout.annotations.find((a) => a.name === 'strip legend title' && a.hovertext);
    assert.equal(strip.hovertext, 'cell_type_annotation_from_the_atlas');
    assert.ok(strip.text.endsWith('…'));
    // with room, nothing wraps
    const wide = compose().figure;
    assert.deepEqual(colourBarTitles(wide), ['Mean · logged']);
});

// ================================================================================================ the matrix first

test('at 340 px the matrix keeps 10 px a column: totals go first, then the groups\' dendrogram, then the legend\'s width, each named', () => {
    const cluster = { genes: 'off', groups: 'all', linkage: 'complete', distance: 'correlation' };
    const { model } = compose({ totals: true, cluster }, { order: clusteredGroups() });
    const span = 7;          // six genes and a gap of one between the two sections
    const columnPx = (fig, width) => ((fig.layout.xaxis.domain[1] - fig.layout.xaxis.domain[0]) * (width - 20)) / span;

    const wide = D.buildFigure({ ...model, pixels: { width: 900, height: 600 } }, LIGHT);
    assert.deepEqual(wide.hidden, [], 'with room, nothing is given up');
    one(wide, 'cells per group');
    one(wide, 'dendrogram groups');

    const narrow = D.buildFigure({ ...model, pixels: { width: 340, height: 600 } }, LIGHT);
    assert.ok(narrow.hidden.length >= 1, 'something gave way');
    assert.deepEqual(narrow.hidden, ['totals', 'dendrogram', 'legend'].slice(0, narrow.hidden.length), 'in that order');
    assert.equal(named(narrow, 'cells per group').length, 0, 'the totals are the first to go');
    if (narrow.hidden.includes('dendrogram')) assert.equal(named(narrow, 'dendrogram groups').length, 0);
    // the matrix keeps its minimum, unless everything that could give way already has
    assert.ok(columnPx(narrow, 340) >= 10 - 1e-6 || narrow.hidden.length === 3, `${columnPx(narrow, 340).toFixed(1)} px a column`);
    // each dropped part has its sentence for the strip
    for (const part of narrow.hidden) assert.ok(W.narrow[part], part);
    assert.equal(W.narrow.totals, 'Totals hidden at this width.');
});

// ================================================================================================ the modebar

/** The highest top, in px below the figure's top, of the matrix and every band around it (not the legend column). */
function bandsTopPx(fig, height) {
    const innerH = height - fig.layout.margin.t - fig.layout.margin.b;
    let top = 0;
    for (const [key, axis] of Object.entries(fig.layout)) {
        const id = /^yaxis(\d*)$/.exec(key);
        if (!id || !axis.domain) continue;
        const n = Number(id[1] || 1);
        if (n > 1 && n < 90) continue;          // legend subplots (size and strip legends)
        if (axis.domain[1] > top) top = axis.domain[1];
    }
    return fig.layout.margin.t + (1 - top) * innerH;
}

test('at 340 px the bands above the matrix stay clear of the modebar, and at 900 px nothing moves for it', () => {
    const MODEBAR_PX = 36;
    const narrow = compose().model;
    narrow.pixels = { width: 340, height: 600 };
    const fig = D.buildFigure(narrow, LIGHT);
    one(fig, 'section brackets');
    assert.ok(bandsTopPx(fig, 600) >= MODEBAR_PX - 1e-6, `the highest band is ${bandsTopPx(fig, 600).toFixed(1)} px below the top`);
    // wide, the matrix ends left of the modebar: the bands reach the top as before
    const wide = compose().figure;
    assert.ok(bandsTopPx(wide, 600) < MODEBAR_PX, `${bandsTopPx(wide, 600).toFixed(1)} px`);
    // swapped, the band on top is the groups' far side: it keeps clear too
    const swapped = compose({ swap: true, totals: true }).model;
    swapped.pixels = { width: 340, height: 600 };
    assert.ok(bandsTopPx(D.buildFigure(swapped, LIGHT), 600) >= MODEBAR_PX - 1e-6);
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

// ================================================================================================ 0.8.0 WP-3: defaults

test('WP-3 the default color scale is Reds, in dots and in a heatmap', () => {
    assert.equal(matrixTraces(compose().figure)[0].marker.colorscale, 'Reds');
    assert.equal(matrixTraces(compose({ mode: 'heatmap' }).figure)[0].colorscale, 'Reds');
});

test('WP-3 a stored color scale is kept, Reds picked under a z-score included', () => {
    assert.equal(matrixTraces(compose({ colorScale: 'Viridis' }).figure)[0].marker.colorscale, 'Viridis');
    assert.equal(matrixTraces(compose({ colorScale: 'Reds', scale: 'z_groups' }).figure)[0].marker.colorscale, 'Reds');
});

test('WP-3 under a z-score the default is RdBu centred at 0; a stored map or center wins', () => {
    for (const scale of ['z_groups', 'z_pooled']) {
        const fig = compose({ scale }).figure;
        const m = matrixTraces(fig)[0].marker;
        assert.equal(m.colorscale, 'RdBu', scale);
        assert.equal(m.cmin, -m.cmax, `${scale}: symmetric about 0`);
        assert.deepEqual(O.barSettings(normalizeCellGene({ scale }).config).center, 0);
    }
    const picked = compose({ scale: 'z_groups', colorScale: 'Viridis' });
    assert.equal(matrixTraces(picked.figure)[0].marker.colorscale, 'Viridis');
    assert.equal(O.barSettings(picked.config).center, undefined, 'no centre on a sequential map');
    assert.equal(O.barSettings(compose({ scale: 'z_groups', center: 1 }).config).center, 1);
    assert.equal(compose({ scale: 'group' }).extras.color.colorscale, 'Reds', '0-to-1 scalings stay sequential');
});

test('WP-3 dots carry a black 0.5 px outline; width 0 draws none; a heatmap has none', () => {
    assert.deepEqual(matrixTraces(compose().figure)[0].marker.line, { color: '#000', width: 0.5 });
    assert.deepEqual(matrixTraces(compose({ outline: { color: '#ff0000', width: 2 } }).figure)[0].marker.line, { color: '#ff0000', width: 2 });
    assert.equal(matrixTraces(compose({ outline: { width: 0 } }).figure)[0].marker.line, undefined);
    const heat = matrixTraces(compose({ mode: 'heatmap' }).figure)[0];
    assert.equal(heat.line, undefined);
    assert.equal(heat.marker, undefined);
});

test('WP-3 the size legend dots wear the plot dots outline', () => {
    assert.deepEqual(one(compose().figure, 'size legend').marker.line, { color: '#000', width: 0.5 });
    assert.equal(one(compose({ outline: { width: 0 } }).figure, 'size legend').marker.line.width, 0);
});

// ================================================================================================ 0.8.0 WP-2: pop-overs

/** An order whose rows and groups were both clustered as one block of four. */
function clusteredBoth() {
    const block = clusteredGroups().groupBlocks[0];
    return { ...clusteredGroups(), rows: identity(6), rowBlocks: [{ ...block }] };
}
const CLUSTER_BOTH = { genes: 'sections', groups: 'all', linkage: 'complete', distance: 'correlation' };
const trees = (dendrograms) => O.figureExtras(normalizeCellGene({ cluster: { ...CLUSTER_BOTH, dendrograms } }).config,
    { reply: reply2(), recipe: TWO_FACTORS, order: clusteredBoth(), titleOf: () => undefined }).annotations.dendrograms;

test('WP-2 dendrograms {genes: false} draws the groups\' tree only', () => {
    const d = trees({ genes: false });
    assert.equal(d.genes, undefined);
    assert.equal(d.groups.length, 1);
    const f = compose({ cluster: { ...CLUSTER_BOTH, dendrograms: { genes: false } } }, { order: clusteredBoth() }).figure;
    assert.equal(named(f, 'dendrogram genes').length, 0);
    one(f, 'dendrogram groups');
    const g = trees({ groups: false });
    assert.equal(g.groups, undefined);
    assert.equal(g.genes.length, 1);
});

test('WP-2 a legacy dendrograms false hides both trees, true shows both', () => {
    assert.deepEqual(trees(false), {});
    const both = trees(true);
    assert.equal(both.genes.length, 1);
    assert.equal(both.groups.length, 1);
    assert.deepEqual(Object.keys(trees(undefined)).sort(), ['genes', 'groups'], 'absent is both');
    assert.deepEqual(O.figureExtras(normalizeCellGene({ cluster: { dendrograms: false } }).config).cluster.dendrograms, { genes: false, groups: false });
    assert.deepEqual(O.figureExtras(normalizeCellGene({ cluster: { dendrograms: true } }).config).cluster.dendrograms, { genes: true, groups: true });
});

test('WP-2 Reverse reverses the color scale of dots and heatmap', () => {
    assert.equal(matrixTraces(compose().figure)[0].marker.reversescale, undefined);
    assert.equal(matrixTraces(compose({ reverse: true }).figure)[0].marker.reversescale, true);
    assert.equal(matrixTraces(compose({ reverse: true, mode: 'heatmap' }).figure)[0].reversescale, true);
});

// --- dots fill their cells, opaque, no grid (operator, 2026-11-23) ------------------------------------------------

const arrayMaxOf = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const arrayMinOf = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);

/** The matrix's cell in px, read from the figure: the gene axis's and the group axis's pitch, the smaller. */
function cellPitch(fig, model) {
    const inner = { w: model.pixels.width - 20, h: model.pixels.height - 20 };
    const along = (ax, px) => ((ax.domain[1] - ax.domain[0]) * px) / Math.abs(ax.range[1] - ax.range[0]);
    return Math.min(along(fig.layout.xaxis, inner.w), along(fig.layout.yaxis, inner.h));
}

test('by default the largest dot fills its cell less a 2 px gap, and follows the plot size and the number of rows', () => {
    const seen = [];
    for (const [rows, width, height] of [[40, 900, 600], [40, 1400, 600], [60, 900, 600], [24, 700, 900], [80, 1200, 500]]) {
        const { model } = compose({}, { rows, split: 3 });
        model.pixels = { width, height };
        const fig = D.buildFigure(model, LIGHT);
        const sizes = matrixTraces(fig)[0].marker.size;
        const largest = arrayMaxOf(sizes);
        const want = cellPitch(fig, model) - 2;
        assert.ok(Math.abs(largest - want) < 1.5, `${rows} rows at ${width} x ${height}: largest ${largest.toFixed(1)} px, cell less 2 ${want.toFixed(1)}`);
        assert.ok(arrayMinOf(sizes) >= 3 - 1e-9, 'the smallest dot stays 3 px');
        seen.push(largest);
    }
    assert.ok(seen[1] > seen[0], 'a wider plot, larger dots');
    assert.ok(seen[2] < seen[0], 'more rows, smaller dots');
});

test('a few rows and groups: the largest dot fills its cell, and the size legend draws its dots scaled to its slot, saying so', () => {
    for (const [width, height] of [[1400, 1000], [900, 600], [700, 420]]) {
        const { model } = compose({});
        model.pixels = { width, height };
        const fig = D.buildFigure(model, LIGHT);
        const largest = arrayMaxOf(matrixTraces(fig)[0].marker.size);
        assert.ok(Math.abs(largest - (cellPitch(fig, model) - 2)) < 1.5, `${width} x ${height}: ${largest} px fills the cell`);
        const legend = one(fig, 'size legend');
        const y = fig.layout[`yaxis${legend.yaxis.slice(1)}`];
        const roomPx = (y.domain[1] - y.domain[0]) * (height - 20);
        const linePx = roomPx / (y.range[0] - y.range[1]);
        const drawn = arrayMaxOf(legend.marker.size);
        assert.ok(drawn <= linePx + 1e-6, `${width} x ${height}: a ${drawn} px reference dot in its ${linePx.toFixed(1)} px line`);
        const note = fig.layout.annotations.find((a) => a.name === 'size legend scale');
        assert.ok(note, `${width} x ${height}: the legend says its dots are scaled`);
        const n = Number(/1:(\d+)/.exec(note.text)[1]);
        assert.ok(Math.abs(drawn * n - largest) < 1e-6, `${width} x ${height}: 1:${n} of ${largest}`);
        // the note stands under the title and above the dots
        assert.ok(note.y > y.domain[1], 'the note is above the reference dots');
    }
});

test('dots that fit their legend are drawn there at their own size, with no note', () => {
    const { model } = compose({}, { rows: 40, split: 3 });
    const fig = D.buildFigure(model, LIGHT);
    assert.equal(arrayMaxOf(one(fig, 'size legend').marker.size), arrayMaxOf(matrixTraces(fig)[0].marker.size));
    assert.ok(!fig.layout.annotations.some((a) => a.name === 'size legend scale'));
});

test('the size legend\'s title stands above its first reference dot, at every height', () => {
    for (const height of [300, 360, 420, 500, 600, 800]) {
        const { model } = compose({ titles: { size: 'Gene Signature 1 % of cells with mean · logged_counts above 0' } });
        model.pixels = { width: 900, height };
        const fig = D.buildFigure(model, LIGHT);
        const legend = one(fig, 'size legend');
        const y = fig.layout[`yaxis${legend.yaxis.slice(1)}`];
        const plotPx = height - 20;
        // the title: the nearest annotation above the subplot, but for the scale note
        const titleAnn = fig.layout.annotations.filter((a) => a.xref === 'paper' && a.name !== 'size legend scale' && a.name !== 'legend title hover'
            && a.y > y.domain[1] - 1e-9).sort((p, q) => p.y - q.y)[0];
        assert.ok(titleAnn, `${height}: the title`);
        const lines = (titleAnn.text ? titleAnn.text.split('<br>').length : 0) + (fig.layout.annotations.some((a) => a.name === 'size legend scale') ? 1 : 0);
        // the title's lines, 17 px each from its top, end above the reference dots' subplot
        const titleBottom = titleAnn.y - (lines * 17) / plotPx;
        assert.ok(titleBottom >= y.domain[1] - 1e-9, `${height}: the title reaches ${titleBottom.toFixed(3)}, the dots start at ${y.domain[1].toFixed(3)}`);
        // and the first dot, centred in its line, stays inside the subplot
        const linePx = ((y.domain[1] - y.domain[0]) * plotPx) / (y.range[0] - y.range[1]);
        assert.ok(arrayMaxOf(legend.marker.size) <= linePx + 1e-6, `${height}: dots fit their lines`);
    }
});

test('Largest dot takes a share of the cell; Smallest dot is px; the configuration keeps both', () => {
    const at = (fields) => {
        const { model } = compose(fields, { rows: 40, split: 3 });
        const fig = D.buildFigure(model, LIGHT);
        const sizes = matrixTraces(fig)[0].marker.size;
        return { lo: arrayMinOf(sizes), hi: arrayMaxOf(sizes), cell: cellPitch(fig, model) };
    };
    const full = at({});
    const half = at({ dotScale: 50 });
    assert.ok(Math.abs(half.hi - (full.cell - 2) / 2) < 1, `50%: ${half.hi} of ${full.cell}`);
    assert.equal(at({ dotScale: 3 }).hi, at({ dotScale: 10 }).hi, 'the share stops at 10%');
    assert.equal(at({ dotSmallest: 6 }).lo, 6);
    assert.ok(Math.abs(at({ dotSmallest: 6 }).hi - full.hi) < 1e-9, 'the smallest dot leaves the largest as it is');
    // a smallest dot larger than a small cell's largest is drawn at the largest
    const tiny = at({ dotScale: 10, dotSmallest: 30 });
    assert.equal(tiny.lo, tiny.hi);
    const c = normalizeCellGene({ version: 1, mode: 'dots', dotScale: 50, dotSmallest: 6, sections: [] }).config;
    assert.ok(c.dotScale === 50 && c.dotSmallest === 6, 'both are kept by the configuration');
});

test('a link from before keeps its px range: dotSizes draws those px until Largest dot is moved', () => {
    const old = compose({ dotSizes: [5, 12] }, { rows: 40, split: 3 }).figure;
    const sizes = matrixTraces(old)[0].marker.size;
    assert.equal(arrayMinOf(sizes), 5);
    assert.equal(arrayMaxOf(sizes), 12);
    const moved = matrixTraces(compose({ dotSizes: [5, 12], dotScale: 100 }, { rows: 40, split: 3 }).figure)[0].marker.size;
    assert.equal(arrayMinOf(moved), 5, 'the smallest of the old range stays');
    assert.ok(arrayMaxOf(moved) > 12, 'the largest fills the cell');
});

test('dots are opaque and neither mode draws grid lines', () => {
    for (const mode of ['dots', 'heatmap']) {
        const fig = compose({ mode }).figure;
        assert.equal(fig.layout.xaxis.showgrid, false, `${mode}: x`);
        assert.equal(fig.layout.yaxis.showgrid, false, `${mode}: y`);
        if (mode === 'dots') for (const t of matrixTraces(fig)) assert.equal(t.marker.opacity, 1);
    }
});

// --- the strips in the order of their legend (operator, 2026-11-23) ----------------------------------------------

/**
 * The factors' bands in reading order: left to right when they stand beside the groups on y, top to bottom below the
 * matrix when the axes are swapped. Each strip is a stacked bar, the k-th over depth [k, k + 1] of its band axis.
 */
function bandOrder(fig) {
    const bars = fig.data.filter((t) => t.name === 'group strip');
    const at = bars.map((b, k) => {
        const vertical = b.orientation === 'h';
        const ax = fig.layout[`${vertical ? 'x' : 'y'}axis${(vertical ? b.xaxis : b.yaxis).slice(1)}`];
        const [r0, r1] = ax.range;
        const t = (k + 0.5 - r0) / (r1 - r0);
        return { k, vertical, paper: ax.domain[0] + t * (ax.domain[1] - ax.domain[0]) };
    });
    // left to right is paper x rising; top to bottom is paper y falling
    return at.sort((a, b) => (a.vertical ? a.paper - b.paper : b.paper - a.paper)).map((a) => a.k);
}

/** The strips' legend titles, top to bottom. */
const legendOrder = (fig) => fig.layout.annotations.filter((a) => a.name === 'strip legend title')
    .sort((a, b) => b.y - a.y).map((a) => a.text);

test('the factors\' bands read in the order of their legend, beside the groups and below them when swapped', () => {
    for (const swap of [false, true]) {
        const fig = compose({ swap }).figure;
        const titles = legendOrder(fig);
        assert.deepEqual(titles, ['cell_type', 'age'], `${swap}: the legend lists the factors in the grouping's order`);
        const bars = fig.data.filter((t) => t.name === 'group strip');
        const factorOf = (k) => (bars[k].hovertext[0].includes('cell_type:') ? 'cell_type' : 'age');
        assert.deepEqual(bandOrder(fig).map(factorOf), titles, `${swap ? 'swapped' : 'beside the groups'}: bands in legend order`);
    }
});

// --- dot opacity (operator, 2026-11-23) ----------------------------------------------------------------------------

test('Dot opacity: the dots and the size legend\'s dots follow it, opaque by default; a heatmap is unaffected', () => {
    const legendAt = (fig) => one(fig, 'size legend').marker.opacity;
    const opaque = compose({}).figure;
    for (const t of matrixTraces(opaque)) assert.equal(t.marker.opacity, 1);
    const base = legendAt(opaque);
    const half = compose({ dotOpacity: 0.5 }).figure;
    for (const t of matrixTraces(half)) assert.equal(t.marker.opacity, 0.5);
    assert.ok(Math.abs(legendAt(half) - base * 0.5) < 1e-9, `the legend's dots at the same share: ${legendAt(half)} of ${base}`);
    // the range is 0.1 to 1
    for (const t of matrixTraces(compose({ dotOpacity: 0 }).figure)) assert.equal(t.marker.opacity, 0.1);
    for (const t of matrixTraces(compose({ dotOpacity: 3 }).figure)) assert.equal(t.marker.opacity, 1);
    // a heatmap has no dots: its tiles carry no opacity of the setting
    for (const t of matrixTraces(compose({ mode: 'heatmap', dotOpacity: 0.5 }).figure)) assert.ok(t.opacity === undefined || t.opacity === 1, `${t.opacity}`);
    const c = normalizeCellGene({ version: 1, mode: 'dots', dotOpacity: 0.4, sections: [] }).config;
    assert.equal(c.dotOpacity, 0.4, 'the configuration keeps it');
});

// --- Color strips: Factors, Group or None (operator, 2026-11-24) ------------------------------------------------

test('Color strips: one per factor by default, the Group band alone in each group\'s own colour, or none', () => {
    const reply = reply2();
    const order = unclustered(6, reply.groups.length);
    const groups = { colours: ['#111111', '#222222', '#333333', '#fedcba'], names: ['B, Old', 'B, Young', 'T, Old', 'T, Young'] };
    const strips = (config, g = groups) => O.figureExtras(normalizeCellGene({ version: 1, mode: 'dots', ...config }).config,
        { reply, recipe: TWO_FACTORS, order, titleOf: () => undefined, groups: g }).annotations.strips;
    const factors = strips({});
    assert.equal(factors.length, 2, 'the default: one strip per factor, no Group band, whatever the groups\' colours');
    assert.ok(factors.every((s) => s.title !== W.options.groupBand));
    const band = strips({ colorStrips: 'group' });
    assert.equal(band.length, 1);
    assert.equal(band[0].title, W.options.groupBand);
    assert.deepEqual(band[0].colours, groups.colours);
    assert.deepEqual(band[0].levels, groups.names);
    assert.deepEqual(band[0].legend.map((e) => e.colour), groups.colours);
    assert.deepEqual(strips({ colorStrips: 'none' }), []);
    // an older link's band switch, and a value this build does not know: the default
    assert.equal(strips({ groupBand: false }).length, 2);
    assert.equal(strips({ colorStrips: 'both' }).length, 2);
    // Group with no group colours given (an old caller): nothing to draw
    assert.deepEqual(strips({ colorStrips: 'group' }, null), []);
});

// --- Largest dot and Smallest dot are Plot Options fields (WP-5a schema; lead, 2026-11-24) -------------------------

test('Largest dot and Smallest dot are Plot Options ▸ Dots fields, and Apply and the session default carry them', async () => {
    const S = await import('../../../static/js/panels/plot-utilities/options-schema.js');
    const scale = S.fieldOf('cell-gene', 'dotScale');
    const smallest = S.fieldOf('cell-gene', 'dotSmallest');
    assert.ok(scale && smallest, 'both are fields of the schema');
    // Largest dot: a slider and a box, the box empty when the dot fills its cell and saying what is drawn (placeholder)
    assert.deepEqual([scale.section, scale.type, scale.path, scale.min, scale.max, S.defaultOf(scale, 'cell-gene')], ['panel:dots', 'range', 'dotScale', 10, 200, null]);
    assert.equal(scale.stepFrom, 100, 'unset, the slider stands at a full cell');
    assert.equal(S.placeholderOf(scale, normalizeCellGene({ version: 1, sections: [] }).config), 100);
    assert.equal(S.placeholderOf(scale, normalizeCellGene({ version: 1, sections: [], dotSizes: [5, 12] }).config), '12 px (saved)');
    assert.equal(S.placeholderOf(scale, normalizeCellGene({ version: 1, sections: [], dotSizes: [5, 12], dotScale: 80 }).config), 100);
    // an old link's smallest dot is Smallest dot
    assert.equal(normalizeCellGene({ version: 1, sections: [], dotSizes: [5, 12] }).config.dotSmallest, 5);
    assert.deepEqual([smallest.section, smallest.type, smallest.path, smallest.min, smallest.max, S.defaultOf(smallest, 'cell-gene')], ['panel:dots', 'range', 'dotSmallest', 1, 40, 3]);
    // copied by Apply to other plots and the session default (the look by path)
    const from = normalizeCellGene({ version: 1, mode: 'dots', sections: [], dotScale: 60, dotSmallest: 6 }).config;
    const look = S.pickLook(from, 'cell-gene');
    assert.equal(look.dotScale, 60);
    assert.equal(look.dotSmallest, 6);
    assert.ok(S.lookPaths('cell-gene').includes('dotScale') && S.lookPaths('cell-gene').includes('dotSmallest'));
    const to = S.adoptLook({ version: 1, mode: 'dots', sections: [] }, look, 'cell-gene');
    assert.equal(to.dotScale, 60);
    assert.equal(to.dotSmallest, 6);
    // at the default they are written as absent
    assert.equal('dotScale' in S.writeField({}, scale, null, 'cell-gene'), false);
    assert.equal('dotSmallest' in S.writeField({}, smallest, 3, 'cell-gene'), false);
});

// --- Largest dot up to 200 % on the slider, typed up to 1000 % (operator, 2026-11-25) -------------------------------

test('Largest dot: the slider runs 10 to 200, a typed share goes to 1000, and larger dots are drawn larger', async () => {
    const S = await import('../../../static/js/panels/plot-utilities/options-schema.js');
    const scale = S.fieldOf('cell-gene', 'dotScale');
    assert.deepEqual([scale.min, scale.max, scale.typedMax, scale.stepFrom], [10, 200, 1000, 100]);
    assert.equal(S.placeholderOf(scale, normalizeCellGene({ version: 1, sections: [] }).config), 100, 'unset: a full cell');
    assert.equal(S.writeField({}, scale, 350, 'cell-gene').dotScale, 350, 'a typed 350 is kept');
    assert.equal(S.writeField({}, scale, 5000, 'cell-gene').dotScale, 1000, 'past the ceiling: 1000');
    assert.ok(/1000/.test(S.helpOf(scale, 'cell-gene')), 'the help says where typing stops');
    // other ranges still stop at their max
    assert.equal(S.writeField({}, S.fieldOf('cell-gene', 'dotSmallest'), 100, 'cell-gene').dotSmallest, 40);
    assert.equal(S.writeField({}, S.fieldOf('cell-gene', 'dotOpacity'), 5, 'cell-gene').dotOpacity, undefined, '1 is the default, written as absent');
    // drawn: the largest dot is the share of its cell (the cell as laid out), larger shares larger, and the matrix gets
    // room at its edges for dots past their cell (half the overflow, in cells), so the plot area does not cut them
    const at = (pct) => {
        const { model } = compose(pct === null ? {} : { dotScale: pct }, { rows: 40, split: 3 });
        const fig = D.buildFigure(model, LIGHT);
        const largest = arrayMaxOf(matrixTraces(fig)[0].marker.size);
        const span = Math.abs(fig.layout.yaxis.range[0] - fig.layout.yaxis.range[1]);
        return { largest, cell: cellPitch(fig, model), pad: (span - model.groups.length) / 2 };
    };
    const largestAt = (pct) => at(pct).largest;
    for (const pct of [100, 150, 200, 350]) {
        const a = at(pct);
        assert.ok(Math.abs(a.largest - (pct / 100) * (a.cell - 2)) < 1e-6, `${pct} %: ${a.largest} of a ${a.cell} px cell`);
        assert.ok(Math.abs(a.pad - Math.max(0, (pct / 100 - 1) / 2)) < 1e-9, `${pct} %: ${a.pad} cells of room at the edge`);
    }
    assert.ok(largestAt(350) > largestAt(200) && largestAt(200) > largestAt(null));
    assert.equal(largestAt(5000), largestAt(1000), 'a stored share past the ceiling draws at the ceiling');
});
