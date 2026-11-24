/**
 * WP-5a: the shared Plot Options of the Cell-Gene Plot and the Cell Count Plot (panels/plot-utilities/options-schema.js,
 * plot-style.js; design note options-ux-080 sections 2f and 3.1; operator decisions 25, 30, 33).
 *
 *  1. The schema: each kind's sections in order, its own defaults (the Cell-Gene Plot draws no grid, the count plot does;
 *     the legend caps differ), a value at its default is written as absent, a stored value is cleaned, the Cell-Gene
 *     Plot's fields of before keep their keys.
 *  2. applyPlotStyle on a Cell-Gene figure (draw.js buildFigure, composed as cell-gene.js does) and on a count figure
 *     (cell-count/draw.js countFigure): font, background, margins, grid; on the Cell-Gene Plot only its main axes.
 *  3. The legend cap: N entries and "+ k more", for a Cell-Gene strip legend and a count plot's levels; the columns of
 *     each; the Cell-Gene legend column's space.
 *  4. Apply to other panels and the session default carry the look, not the titles.
 *
 * Run:  node --test annzarro/tests/js/plot-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/panels/plot-utilities/options-schema.js');
const P = await import('../../../static/js/panels/plot-utilities/plot-style.js');
const O = await import('../../../static/js/panels/cell-gene/options.js');     // registers the Cell-Gene Plot's own fields
const D = await import('../../../static/js/panels/cell-gene/draw.js');
const CD = await import('../../../static/js/panels/cell-count/draw.js');
const M = await import('../../../static/js/utils/count-plot-model.js');
const SS = await import('../../../static/js/utils/session-style.js');
const { normalizeCellGene } = await import('../../../static/js/panels/cell-gene/sections.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const LIGHT = PLOT_PALETTES.light;
const CG = 'cell-gene';
const CC = 'cell-count';

// --- a Cell-Gene figure, composed as cell-gene.js drawFigure composes it ---------------------------------------------

/** `levels` levels of one factor, one group each; 4 genes. The model as the panel makes it, with the style's parts. */
function cellGene(fields = {}, { levels = 6, pixels = { width: 900, height: 600 } } = {}) {
    const config = normalizeCellGene({
        version: 1, mode: 'dots', cellAxis: { type: 'obs', key: 'cell_type' }, sections: [{ source: 'S1', rows: 'genes' }],
        color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged' }, ...fields
    }).config;
    const ids = Array.from({ length: levels }, (_, i) => `c:L${i}`);
    const reply = { partitionings: [{ levels: ids }], groups: ids.map((id, i) => ({ key: [id], n: 10 + i })), n_shown: 100 };
    const recipe = { partitionings: [{ source: { type: 'obs', key: 'cell_type' } }] };
    const G = levels;
    const R = 4;
    const order = { rows: Int32Array.from({ length: R }, (_, i) => i), groups: Int32Array.from({ length: G }, (_, i) => i), rowBlocks: [], groupBlocks: [] };
    const extras = O.figureExtras(config, { reply, recipe, order, titleOf: () => undefined });
    const look = S.resolveStyle(config, CG);
    const values = Float64Array.from({ length: R * G }, (_, i) => (i % 5) / 2);
    const model = {
        mode: config.mode, pixels,
        groups: ids.map((_, g) => ({ label: `group ${g}`, n: 10 + g })),
        rows: Array.from({ length: R }, (_, r) => ({ label: `Gene${r}`, section: { index: 0, title: 'Markers' } })),
        color: { id: 'm', stat: 'mean', layer: 'logged', scaling: 'none', ...O.barSettings(config), ...extras.color, values, raw: values },
        size: { id: 's', stat: 'pct_expressing', layer: 'logged', detectAbove: 0, ...extras.size, values: Float64Array.from({ length: R * G }, (_, i) => (i * 7) % 100) },
        legend: extras.legend, plotTitle: extras.plotTitle, annotations: extras.annotations, outline: extras.outline,
        legendLayout: P.cellGeneLegend(look)
    };
    const figure = P.applyPlotStyle(D.buildFigure(model, P.styleTheme(look, LIGHT)), look, CG);
    return { config, look, figure };
}

// --- a count figure ---------------------------------------------------------------------------------------------------

const words = {
    count: 'Cell count', fill: '% of cells in each bar', hoverCount: 'Cells', hoverShare: 'Share',
    share: (base) => `Share of ${base}`, measure: (stat, source) => `${stat} of ${source}`, topLevel: (name) => `Most frequent level of ${name}`
};

/** A bar plot of 3 levels split by `split` levels (one trace per split level, each a legend entry). */
function count(look = {}, { split = 4 } = {}) {
    const config = M.normalizeCountPlot({ version: 1, mode: 'bar', x: { source: { type: 'obs', key: 'k' } }, split: { source: { type: 'obs', key: 'c' } }, ...look }).config;
    const ids = Array.from({ length: split }, (_, i) => `c:s${i}`);
    const reply = { n_shown: 100, n_counted: 100, axes: [{ levels: ['c:a', 'c:b', 'c:c'], n_outside: [0, 0] }, { levels: ids, n_outside: [0, 0] }] };
    const table = M.countTable(config, M.readGrid({ reply, counts: Array.from({ length: 3 * split }, (_, i) => i + 1), measures: null }), [{ input: 'x' }, { input: 'split' }]);
    const style = S.resolveStyle(config, CC);
    const palette = ['#111111', '#222222', '#333333', '#444444'];
    const fig = CD.countFigure(config, table, { options: {}, words, inputNames: { x: 'k', split: 'c' }, palette, theme: P.styleTheme(style, LIGHT) });
    return { config, style, figure: P.applyPlotStyle(fig, style, CC) };
}

const named = (fig, name) => fig.data.filter((t) => t.name === name);
const proxies = (fig) => fig.data.filter((t) => t.meta === 'az-legend');

// ================================================================================================ 1. the schema

test('each kind has the common sections in order, with its own sections between them', () => {
    assert.deepEqual(S.sectionsOf(CG).map((s) => s.id),
        ['presets', 'text', 'background', 'axes', 'panel:dots', 'panel:sections', 'legend', 'panel:annotations', 'margins', 'export', 'apply']);
    assert.deepEqual(S.sectionsOf(CC).map((s) => s.id), ['presets', 'text', 'background', 'axes', 'legend', 'margins', 'export', 'apply']);
    // the Cell-Gene Plot's fields of before are in the schema, at the keys they always had
    const cg = Object.fromEntries(S.fieldsOf(CG).map((f) => [f.id, f.path]));
    assert.equal(cg.outlineWidth, 'outline.width');
    assert.equal(cg.geneLabels, 'labels.genes');
    assert.equal(cg.strips, 'legend.strips');
    assert.equal(cg.totals, 'totals');
    assert.equal(cg.plotTitle, 'titles.plot');
    // the count plot's legend has a position; the Cell-Gene Plot's legend column is always on the right
    assert.ok(S.fieldOf(CC, 'legendPosition'));
    assert.equal(S.fieldOf(CG, 'legendPosition'), null);
});

test('per-kind defaults: no grid on the Cell-Gene Plot, a grid on the count plot; Arial and Open Sans; their own legend caps', () => {
    const g = S.resolveStyle({}, CG);
    const c = S.resolveStyle({}, CC);
    assert.equal(g.grid, false);
    assert.equal(c.grid, true);
    assert.equal(g.fontFamily, 'Arial, Helvetica, sans-serif');
    assert.match(c.fontFamily, /Open Sans/);
    assert.equal(g.fontSize, 12);
    assert.equal(g.legendMax, 20);
    assert.equal(c.legendMax, 25);
    assert.equal(g.legendColumns, 1);
    assert.equal(g.export2x, true);
    assert.equal(g.bgColor, null, 'the background follows the app theme until set');
});

test('a value at its default is written as absent, and a stored value is cleaned', () => {
    const size = S.fieldOf(CG, 'fontSize');
    let config = S.writeField({}, size, 16, CG);
    assert.deepEqual(config, { look: { fontSize: 16 } });
    config = S.writeField(config, size, 12, CG);
    assert.deepEqual(config, {}, 'the default leaves nothing, not an empty look');
    assert.equal(S.readField({ look: { fontSize: 400 } }, size, CG), 36, 'clamped');
    assert.equal(S.readField({ look: { fontSize: 'big' } }, size, CG), 12, 'not a number: the default');
    assert.equal(S.readField({ look: { textColor: 'red;x' } }, S.fieldOf(CG, 'textColor'), CG), null);
    // a per-kind default: the grid on is the Cell-Gene Plot's own value, the count plot's default
    const grid = S.fieldOf(CG, 'grid');
    assert.deepEqual(S.writeField({}, grid, true, CG), { look: { grid: true } });
    assert.deepEqual(S.writeField({}, grid, true, CC), {});
    // the outline's default is the panel's (cell-gene/options.js), at its old key
    const width = S.fieldOf(CG, 'outlineWidth');
    assert.deepEqual(S.writeField({ outline: { color: '#ff0000' } }, width, 2, CG), { outline: { color: '#ff0000', width: 2 } });
    assert.deepEqual(S.writeField({ outline: { width: 2 } }, width, S.defaultOf(width, CG), CG), {});
});

// ================================================================================================ 2. applyPlotStyle

test('applyPlotStyle on a Cell-Gene figure: font, background, margins and grid, the grid on its main axes only', () => {
    const plain = cellGene().figure;
    assert.equal(plain.layout.xaxis.showgrid, false, 'the Cell-Gene Plot draws no grid by default (operator)');
    assert.equal(plain.layout.yaxis.showgrid, false);
    const { figure } = cellGene({ look: { fontSize: 16, fontFamily: 'Georgia, serif', textColor: '#112233', bgColor: '#fafafa', grid: true,
        gridColor: '#cccccc', gridWidth: 2, margins: { t: 5, r: 6, b: 7, l: 8 } }, titles: { plot: 'My plot' } });
    const L = figure.layout;
    const base = cellGene({ look: { fontSize: 16, fontFamily: 'Georgia, serif' }, titles: { plot: 'My plot' } }).figure.layout.margin;
    assert.deepEqual(L.font, { family: 'Georgia, serif', size: 16, color: '#112233' });
    assert.equal(L.paper_bgcolor, '#fafafa');
    assert.equal(L.plot_bgcolor, '#fafafa');
    assert.deepEqual([L.margin.t, L.margin.r, L.margin.b, L.margin.l], [base.t + 5, base.r + 6, base.b + 7, base.l + 8], 'added to the builder\'s');
    assert.equal(base.l, 10, 'the builder\'s own margin');
    assert.equal(L.title.font.size, 20, 'the title 4 px above the font');
    for (const a of ['xaxis', 'yaxis']) {
        assert.equal(L[a].showgrid, true, a);
        assert.equal(L[a].gridcolor, '#cccccc', a);
        assert.equal(L[a].gridwidth, 2, a);
    }
    // the legend column's and the bands' small axes are left alone
    const others = Object.keys(L).filter((k) => /^[xy]axis\d+$/.test(k));
    assert.ok(others.length > 0, 'the figure has legend subplots');
    for (const k of others) {
        assert.notEqual(L[k].gridcolor, '#cccccc', k);
        assert.notEqual(L[k].gridwidth, 2, k);
    }
    // the builder measured its labels with the style's font, so its text annotations are in the style's colour
    assert.ok(L.annotations.filter((a) => a.font && a.font.color).every((a) => a.font.color === '#112233' || a.font.color === 'rgba(0,0,0,0)'));
});

test('applyPlotStyle on a count figure: font, background, margins, title; grid off on every 2D axis', () => {
    const plain = count().figure;
    assert.notEqual(plain.layout.xaxis.showgrid, false, 'the count plot keeps its grid by default');
    const { figure } = count({ look: { fontSize: 14, bgColor: '#000000', grid: false, margins: { l: 20 } }, titles: { plot: 'Counts' } });
    const L = figure.layout;
    assert.equal(L.font.size, 14);
    assert.equal(L.paper_bgcolor, '#000000');
    assert.equal(L.xaxis.showgrid, false);
    assert.equal(L.yaxis.showgrid, false);
    assert.equal(L.margin.l, plain.layout.margin.l + 20);
    assert.equal(L.title.text, 'Counts');
    assert.equal(L.title.font.size, 18);
    assert.ok(L.margin.t > plain.layout.margin.t, 'room for the title');
});

// ================================================================================================ 3. the legend

test('the legend cap on a Cell-Gene strip legend: the first N levels and "+ k more"', () => {
    const tall = { pixels: { width: 900, height: 2400 } };
    const all = cellGene({}, { levels: 30, ...tall }).figure;
    const capped = named(all, 'strip legend')[0];
    assert.equal(capped.text.length, 21, '20 levels (the default cap) and the "+ 10 more" line');
    assert.equal(capped.text[20], '+ 10 more');
    const five = named(cellGene({ look: { legendMax: 5 } }, { levels: 30, ...tall }).figure, 'strip legend')[0];
    assert.deepEqual(five.text, ['L0', 'L1', 'L2', 'L3', 'L4', '+ 25 more']);
    const under = named(cellGene({ look: { legendMax: 5 } }, { levels: 4 }).figure, 'strip legend')[0];
    assert.deepEqual(under.text, ['L0', 'L1', 'L2', 'L3'], 'no "more" line under the cap');
    // a slot too short for the cap still cuts at what fits, and two columns hold twice that
    const short = named(cellGene({}, { levels: 30 }).figure, 'strip legend')[0];
    const shortTwo = named(cellGene({ look: { legendColumns: 2 } }, { levels: 30 }).figure, 'strip legend')[0];
    assert.match(short.text[short.text.length - 1], /^\+ \d+ more$/);
    assert.equal(shortTwo.text.length, 2 * short.text.length);
});

test('Cell-Gene legend columns fill top to bottom; the space moves the legend column', () => {
    const one = named(cellGene({}, { levels: 8 }).figure, 'strip legend')[0];
    assert.deepEqual(new Set(one.x).size, 1, 'one column');
    const two = named(cellGene({ look: { legendColumns: 2 } }, { levels: 8 }).figure, 'strip legend')[0];
    assert.equal(new Set(two.x).size, 2, 'two columns');
    assert.deepEqual(two.y, [0, 1, 2, 3, 0, 1, 2, 3]);
    const wide = cellGene({ look: { legendSpace: 40 } }).figure;
    const plain = cellGene().figure;
    assert.ok(wide.layout.xaxis.domain[1] < plain.layout.xaxis.domain[1] - 0.1, 'a wider legend column leaves the matrix less room');
    assert.ok(Math.abs(wide.layout.xaxis.domain[1] - (0.6 - 0.05)) < 1e-9);
});

test('the legend cap on a count plot: N proxies, the bars they stand for kept, and "+ k more"', () => {
    const { figure } = count({ look: { legendMax: 2 } }, { split: 4 });
    const p = proxies(figure);
    assert.deepEqual(p.map((t) => t.name), ['s0', 's1', '+ 2 more']);
    const bars = figure.data.filter((t) => t.type === 'bar');
    assert.equal(bars.length, 4, 'every level is still drawn');
    assert.ok(bars.every((t) => t.showlegend === false), 'the bars are listed by their proxies');
    assert.equal(p[0].legendgroup, bars[0].legendgroup, 'a click on an entry hides its bars');
    assert.deepEqual(figure.legendShown, { entries: 4, shown: 2, more: 2, proxies: true });
    // under the cap, one column, no space set: Plotly's own legend, untouched
    const plain = count({}, { split: 4 }).figure;
    assert.equal(proxies(plain).length, 0);
    assert.equal(plain.data.filter((t) => t.showlegend !== false && t.type === 'bar').length, 4);
});

test('count plot legend columns, position and space reach the legend machinery of Cell Plot (legend-options.js)', () => {
    const { figure } = count({ look: { legendColumns: 2, legendPosition: 'bottom', legendSpace: 30 } }, { split: 4 });
    assert.equal(figure.layout.meta.azLegendColumns, 2);
    assert.equal(figure.layout.meta.azLegendPosition, 'bottom');
    assert.equal(figure.layout.meta.azLegendShare, 0.3);
    assert.equal(figure.layout.legend.orientation, 'h');
    assert.equal(proxies(figure).length, 4);
    const hidden = count({ look: { showLegend: false } }).figure;
    assert.equal(hidden.layout.showlegend, false);
});

// ================================================================================================ 4. the look copied

test('a picked look carries the look, not the titles, and adopting it puts unset fields back to their defaults', () => {
    const from = normalizeCellGene({ look: { fontSize: 18 }, outline: { width: 2 }, titles: { plot: 'Mine' } }).config;
    const look = S.pickLook(from, CG);
    assert.equal(look['look.fontSize'], 18);
    assert.equal(look['outline.width'], 2);
    assert.equal(look['look.grid'], null, 'at its default');
    assert.ok(!('titles.plot' in look), 'a title is not a look');
    const to = S.adoptLook({ look: { bgColor: '#ffffff' }, titles: { plot: 'Theirs' }, totals: true }, look, CG);
    assert.deepEqual(to.look, { fontSize: 18 });
    assert.deepEqual(to.outline, { width: 2 });
    assert.equal(to.titles.plot, 'Theirs');
    assert.equal(to.totals, undefined, 'the totals switch is part of the look and was off');
});

test('the session default of the new kinds keeps their look by path, and a plot on Default follows it', () => {
    assert.ok('cell-gene' in SS.STYLE_TYPES && 'cell-count' in SS.STYLE_TYPES);
    SS.clearSessionStyle();
    const set = SS.setSessionStyle(CG, { look: { fontSize: 20, grid: true }, titles: { plot: 'x' } });
    assert.equal(set, true);
    assert.deepEqual(SS.sessionStyle(CG), { 'look.fontSize': 20, 'look.grid': true });
    const follows = SS.followLook({ version: 1, mode: 'dots', styleDefault: true, look: { bgColor: '#ffffff' } }, CG);
    assert.deepEqual(follows.look, { fontSize: 20, grid: true });
    assert.equal(follows.styleDefault, true);
    // a stored default is cleaned by path: what is not a look of the kind is dropped
    assert.deepEqual(SS.cleanSessionStyles({ 'cell-gene': { 'look.fontSize': 14, 'titles.plot': 'no', evil: 1 } }), { 'cell-gene': { 'look.fontSize': 14 } });
    SS.clearSessionStyle();
});

// ================================================================================================ 5. every option that applies

test('a field that does not apply to a kind is not offered: the count plot has axis titles, tick labels and zero lines, the Cell-Gene Plot not', () => {
    const cg = new Set(S.fieldsOf(CG).map((f) => f.id));
    const cc = new Set(S.fieldsOf(CC).map((f) => f.id));
    for (const id of ['axisLines', 'axisColor', 'axisWidth', 'tickMarks', 'grid', 'legendColumns', 'legendMax', 'legendSpace']) {
        assert.ok(cg.has(id) && cc.has(id), id);
    }
    for (const id of ['axisTitles', 'tickLabels', 'zeroLines', 'tickCount', 'legendTitle', 'legendColumnGap', 'legendPosition', 'showLegend']) {
        assert.ok(cc.has(id) && !cg.has(id), id);
    }
    for (const id of ['geneLabels', 'groupLabels', 'outlineWidth', 'totals']) assert.ok(cg.has(id) && !cc.has(id), id);
});

test('axis lines, tick marks and the count plot\'s axis titles, tick labels, zero lines and tick count reach the figure', () => {
    const cg = cellGene({ look: { axisLines: true, axisColor: '#ff0000', axisWidth: 2, tickMarks: true } }).figure.layout;
    assert.equal(cg.xaxis.showline, true);
    assert.equal(cg.xaxis.linecolor, '#ff0000');
    assert.equal(cg.yaxis.linewidth, 2);
    assert.equal(cg.yaxis.ticks, 'outside');
    const cc = count({ look: { axisTitles: false, tickLabels: false, zeroLines: false, tickCount: 4 } }).figure.layout;
    assert.equal(cc.yaxis.title.text, '');
    assert.equal(cc.yaxis.showticklabels, false);
    assert.equal(cc.yaxis.zeroline, false);
    assert.equal(cc.yaxis.nticks, 4, 'the count axis takes the tick count');
    assert.equal(cc.xaxis.nticks, undefined, 'a category axis keeps a tick per level');
});

test('presets: Publication and Bare set the look of the kind; Default puts every copied field back', () => {
    const pub = S.applyPreset({ titles: { plot: 'Kept' } }, 'publication', CC);
    assert.deepEqual(pub.look, { bgColor: '#ffffff', textColor: '#000000', axisColor: '#000000', fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 16, grid: false, axisLines: true, axisWidth: 1.5, tickMarks: true, zeroLines: false });
    assert.equal(pub.titles.plot, 'Kept');
    const bare = S.applyPreset({}, 'bare', CG);
    assert.deepEqual(bare.legend, { colorBar: false, sizeLegend: false, strips: false }, 'the Cell-Gene legends are off');
    assert.equal(bare.look, undefined, 'no grid is already the Cell-Gene default');
    assert.deepEqual(S.applyPreset(pub, 'default', CC), { titles: { plot: 'Kept' } });
});

test('a declared kind (WP-5b) brings its own order, defaults and the fields it takes', () => {
    S.registerKind('test-kind', { order: ['text', 'axes', 'export'], defaults: { fontSize: 14, grid: false }, applies: ['zeroLines'] });
    assert.deepEqual(S.sectionsOf('test-kind').map((s) => s.id), ['text', 'axes', 'export']);
    assert.equal(S.resolveStyle({}, 'test-kind').fontSize, 14);
    assert.ok(S.fieldOf('test-kind', 'zeroLines'));
    assert.equal(S.fieldOf('test-kind', 'legendPosition'), null);
});
