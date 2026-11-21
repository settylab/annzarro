/**
 * The Cell-Gene Plot's matrix and legends (static/js/panels/cell-gene/draw.js, CXG-9, CXG-12, CXG-15, CXG-16,
 * CXG-20; UX 3.2 "in the plot", 3.3). `buildFigure(model, theme)` is pure, so the figure is held here, with no
 * browser: dots and heatmap, swap, the color bar, the size legend, hover text, missing values, No size, and the
 * legends of a one-row section on a different quantity (Q1).
 *
 * Run:  node --test annzarro/tests/js/cell-gene-draw.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/panels/cell-gene/draw.js');
const { PLOT_PALETTES, GAP_COLOUR } = await import('../../../static/js/utils/plot-theme.js');
const { VOCABULARY: V } = await import('../../../static/js/utils/vocabulary.js');

const W = V.cellGene;
const LIGHT = PLOT_PALETTES.light;
const DARK = PLOT_PALETTES.dark;

/** A model of `rows` genes in `groups` groups; colour is r + g / 10, size is 10 * (g + 1) (percent). */
function model({ rows = 3, groups = 2, mode = 'dots', ...over } = {}) {
    const colour = new Float64Array(rows * groups);
    const size = new Float64Array(rows * groups);
    for (let r = 0; r < rows; r++) {
        for (let g = 0; g < groups; g++) {
            colour[r * groups + g] = r + g / 10;
            size[r * groups + g] = 10 * (g + 1);
        }
    }
    return {
        mode,
        groups: Array.from({ length: groups }, (_, g) => ({ label: `group ${g}`, n: 100 * (g + 1) })),
        rows: Array.from({ length: rows }, (_, r) => ({ label: `Gene${r}` })),
        color: { id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: colour, colorscale: 'Viridis' },
        size: { id: 'pct|X', stat: 'pct_expressing', layer: 'X', detectAbove: 0, values: size },
        ...over
    };
}

const traces = (fig, type) => fig.data.filter((t) => t.type === type);
const lines = (title) => title.text.split('<br>');
const bars = (fig) => fig.data.filter((t) => t.marker && t.marker.colorbar || t.colorbar);
const sizeLegend = (fig) => fig.data.find((t) => t.name === 'size legend');

// --- dots -------------------------------------------------------------------------------------------------------

test('dots: one point per cell of the matrix, groups on y, genes on x, colored and sized by the matrices', () => {
    const fig = D.buildFigure(model(), LIGHT);
    const [t] = fig.data.filter((d) => d.mode === 'markers' && d.name !== 'size legend');
    assert.equal(t.x.length, 6);
    assert.deepEqual([...new Set(t.x)].sort(), [0, 1, 2]);
    assert.deepEqual([...new Set(t.y)].sort(), [0, 1]);
    assert.deepEqual(t.marker.color, [0, 0.1, 1, 1.1, 2, 2.1]);
    assert.equal(fig.layout.xaxis.ticktext.join(), 'Gene0,Gene1,Gene2');
    assert.equal(fig.layout.yaxis.ticktext.join(), 'group 0,group 1');
});

test('dot sizes run from the smallest to the largest dot over the range of the size values', () => {
    const m = model();
    m.size.smallest = 4;
    m.size.largest = 20;
    const [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.deepEqual([...new Set(t.marker.size)].sort((a, b) => a - b), [4, 20]);
});

test('dot_min and dot_max clamp the size range', () => {
    const m = model();
    m.size.smallest = 4;
    m.size.largest = 20;
    m.size.dotMin = 0;
    m.size.dotMax = 40;
    const [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.deepEqual([...new Set(t.marker.size)].sort((a, b) => a - b), [4 + 16 * 0.25, 4 + 16 * 0.5]);
    m.size.dotMin = 15;
    m.size.dotMax = 15.0001;
    const sizes = new Set(traces(D.buildFigure(m, LIGHT), 'scatter')[0].marker.size);
    assert.deepEqual([...sizes].sort((a, b) => a - b), [4, 20], 'values under dot_min draw smallest, over dot_max largest');
});

test('up to DOT_SVG_MAX dots are scatter, for a vector export; above, scattergl', () => {
    const few = D.buildFigure(model({ rows: 50, groups: 100 }), LIGHT);
    assert.equal(traces(few, 'scatter').length >= 1, true);
    assert.equal(traces(few, 'scattergl').length, 0);
    const many = D.buildFigure(model({ rows: 51, groups: 100 }), LIGHT);
    assert.equal(traces(many, 'scattergl').length, 1);
    assert.equal(traces(many, 'scatter').filter((t) => t.name !== 'size legend').length, 0);
});

test('a missing value is no dot, and a missing size is no dot', () => {
    const m = model();
    m.color.values[1] = NaN;
    m.size.values[2] = NaN;
    const [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.equal(t.x.length, 4);
    assert.ok(!t.marker.color.some(Number.isNaN));
});

test('the color range is the range of the data; Min, Max and Center set it, a center keeps it symmetric', () => {
    let [t] = traces(D.buildFigure(model(), LIGHT), 'scatter');
    assert.deepEqual([t.marker.cmin, t.marker.cmax], [0, 2.1]);
    const m = model();
    m.color.min = -1;
    m.color.max = 5;
    [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.deepEqual([t.marker.cmin, t.marker.cmax], [-1, 5]);
    m.color.center = 0;
    [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.deepEqual([t.marker.cmin, t.marker.cmax], [-5, 5]);
    const flat = model();
    flat.color.values.fill(3);
    [t] = traces(D.buildFigure(flat, LIGHT), 'scatter');
    assert.ok(t.marker.cmax > t.marker.cmin, 'a constant matrix still has a range');
});

// --- heatmap ----------------------------------------------------------------------------------------------------

test('heatmap: z is groups by genes, x the genes and y the groups, first group on top', () => {
    const fig = D.buildFigure(model({ mode: 'heatmap' }), LIGHT);
    const [h] = traces(fig, 'heatmap');
    assert.deepEqual(h.z.map((r) => [...r]), [[0, 1, 2], [0.1, 1.1, 2.1]]);
    assert.deepEqual([...h.x], [0, 1, 2]);
    assert.deepEqual([...h.y], [0, 1]);
    assert.deepEqual(fig.layout.yaxis.range, [1.5, -0.5], 'the first group is at the top');
    assert.equal(h.colorscale, 'Viridis');
    assert.equal(h.xgap === undefined || h.xgap === 0, true);
});

test('heatmap: a missing value is the app\'s gap color, and hover says it has no value', () => {
    const m = model({ mode: 'heatmap' });
    m.color.values[0] = NaN;
    const fig = D.buildFigure(m, LIGHT);
    const [main, gap] = traces(fig, 'heatmap');
    assert.ok(Number.isNaN(main.z[0][0]), 'the value layer has nothing there');
    assert.equal(gap.z[0][0], 1);
    assert.ok(Number.isNaN(gap.z[0][1]), 'the gap layer marks only the missing cell');
    assert.deepEqual(gap.colorscale.map((s) => s[1]), [GAP_COLOUR, GAP_COLOUR]);
    assert.equal(gap.showscale, false);
    assert.match(gap.text[0][0], new RegExp(`${V.word.noValue}`));
    assert.match(gap.text[0][0], /Gene0/);
    assert.equal(traces(D.buildFigure(model({ mode: 'heatmap' }), LIGHT), 'heatmap').length, 1, 'no gap layer when nothing is missing');
});

test('heatmap: Print values in cells writes the values into the cells', () => {
    const [h] = traces(D.buildFigure(model({ mode: 'heatmap', color: { ...model().color, printValues: true } }), LIGHT), 'heatmap');
    assert.ok(h.texttemplate, 'a text template is set');
    assert.equal(traces(D.buildFigure(model({ mode: 'heatmap' }), LIGHT), 'heatmap')[0].texttemplate, undefined);
});

// --- swap (CXG-12) ----------------------------------------------------------------------------------------------

test('swap puts the genes on y and the groups on x, dots and heatmap', () => {
    const plain = traces(D.buildFigure(model(), LIGHT), 'scatter')[0];
    const swapped = D.buildFigure(model({ swap: true }), LIGHT);
    const s = traces(swapped, 'scatter')[0];
    assert.deepEqual(s.x, plain.y);
    assert.deepEqual(s.y, plain.x);
    assert.equal(swapped.layout.xaxis.ticktext.join(), 'group 0,group 1');
    assert.equal(swapped.layout.yaxis.ticktext.join(), 'Gene0,Gene1,Gene2');
    assert.deepEqual(swapped.layout.yaxis.range, [2.5, -0.5], 'the first gene is at the top');

    const hm = traces(D.buildFigure(model({ mode: 'heatmap', swap: true }), LIGHT), 'heatmap')[0];
    assert.deepEqual(hm.z.map((r) => [...r]), [[0, 0.1], [1, 1.1], [2, 2.1]]);
});

// --- legends (UX 3.3) -------------------------------------------------------------------------------------------

test('the color bar has two lines when scaled: statistic and layer, then the scaling', () => {
    let fig = D.buildFigure(model(), LIGHT);
    const [bar] = bars(fig);
    assert.deepEqual(lines((bar.marker ? bar.marker.colorbar : bar.colorbar).title), [`${W.statistic.mean} · X`]);
    const m = model();
    m.color.scaling = 'var';
    fig = D.buildFigure(m, LIGHT);
    assert.deepEqual(lines(bars(fig)[0].marker.colorbar.title), [`${W.statistic.mean} · X`, W.scaled.var]);
});

test('a title the user edited replaces the default, on the color bar and the size legend', () => {
    const m = model();
    m.color.title = 'My colors';
    m.size.title = 'My sizes';
    const fig = D.buildFigure(m, LIGHT);
    assert.deepEqual(lines(bars(fig)[0].marker.colorbar.title), ['My colors']);
    assert.ok(fig.layout.annotations.some((a) => a.text === 'My sizes'));
});

test('the size legend: five reference dots from dot_min to dot_max, titled with statistic, threshold and layer', () => {
    const m = model();
    m.size.dotMin = 0;
    m.size.dotMax = 100;
    m.size.smallest = 4;
    m.size.largest = 24;
    const fig = D.buildFigure(m, LIGHT);
    const legend = sizeLegend(fig);
    assert.equal(legend.marker.size.length, 5);
    assert.deepEqual(legend.marker.size, [4, 9, 14, 19, 24]);
    assert.deepEqual(legend.text, ['0', '25', '50', '75', '100']);
    assert.ok(fig.layout.annotations.some((a) => a.text === `${W.statistic.pct_expressing} (> 0) · X`));
    assert.equal(legend.hoverinfo, 'skip');
});

test('Plot Options can hide the color bar and the size legend', () => {
    const fig = D.buildFigure(model({ legend: { colorBar: false, sizeLegend: false } }), LIGHT);
    assert.equal(bars(fig).length, 0);
    assert.equal(sizeLegend(fig), undefined);
    assert.equal(traces(fig, 'scatter').length, 1);
});

test('a heatmap has a color bar and no size legend', () => {
    const fig = D.buildFigure(model({ mode: 'heatmap' }), LIGHT);
    assert.equal(sizeLegend(fig), undefined);
    assert.deepEqual(lines(traces(fig, 'heatmap')[0].colorbar.title), [`${W.statistic.mean} · X`]);
});

// --- No size (SHR-27) -------------------------------------------------------------------------------------------

test('No size: every dot at one size, the size legend replaced by the sentence it is given', () => {
    const says = '% expressing is not available on X: X has negative values. Choose a layer.';
    const m = model({ size: { none: says } });
    const fig = D.buildFigure(m, LIGHT);
    const [t] = traces(fig, 'scatter');
    assert.equal(new Set(t.marker.size).size, 1);
    assert.equal(t.x.length, 6, 'every cell with a color is still drawn');
    assert.equal(sizeLegend(fig), undefined);
    assert.ok(fig.layout.annotations.some((a) => a.text === says));
});

// --- a one-row section on a different quantity (Q1) -------------------------------------------------------------

const withOwnRows = (over = {}) => {
    const m = model({ rows: 4, groups: 2, ...over });
    m.rows[2] = { label: 'B cell score', section: { index: 1, title: 'Pathway' },
        own: { color: { id: 'score_mean|B', label: 'z-score mean · X, averaged' }, size: { id: 'mean_of_means|X', label: "Mean of the genes' means" } } };
    m.rows[3] = { label: 'T score', section: { index: 2, title: 'Immune' },
        own: { color: { id: 'mean|X', label: 'Mean · X' }, size: { id: 'pct|X', label: '% expressing' } } };
    return m;
};

test('a one-row section on a different quantity gets its own color bar, titled with the section', () => {
    const fig = D.buildFigure(withOwnRows(), LIGHT);
    const own = bars(fig);
    assert.equal(own.length, 2, 'the genes\' bar and the section\'s');
    const titles = own.map((t) => lines(t.marker.colorbar.title));
    assert.deepEqual(titles[0], [`${W.statistic.mean} · X`]);
    assert.deepEqual(titles[1], ['Pathway', 'z-score mean · X, averaged']);
    const [genes, section] = fig.data.filter((t) => t.name !== 'size legend' && t.marker && t.marker.colorbar);
    assert.equal(genes.x.length + section.x.length, 8 - 0, 'rows are split between the traces, none lost or doubled');
});

test('a one-row section on the same quantity shares the genes\' color bar', () => {
    const fig = D.buildFigure(withOwnRows(), LIGHT);
    const gene = fig.data.find((t) => t.marker && t.marker.colorbar && lines(t.marker.colorbar.title).length === 1);
    assert.equal(gene.x.length, 6, 'two gene rows and the section whose quantity is the same, over two groups');
});

test('under a 0-to-1 or z-score scaling one color bar serves every row', () => {
    for (const scaling of ['var', 'group', 'z_groups', 'z_pooled']) {
        const m = withOwnRows();
        m.color.scaling = scaling;
        assert.equal(bars(D.buildFigure(m, LIGHT)).length, 1, scaling);
    }
    const none = withOwnRows();
    assert.equal(bars(D.buildFigure(none, LIGHT)).length, 2);
});

test('a one-row section whose size is not the genes\' size gets its own size legend, titled with the section', () => {
    const fig = D.buildFigure(withOwnRows(), LIGHT);
    const legends = fig.data.filter((t) => t.name === 'size legend');
    assert.equal(legends.length, 2);
    const titles = fig.layout.annotations.map((a) => a.text);
    assert.ok(titles.includes(`Pathway<br>Mean of the genes' means`), titles.join('|'));
    assert.ok(titles.includes(`${W.statistic.pct_expressing} (> 0) · X`));
    assert.ok(!titles.some((t) => t.startsWith('Immune')), 'the section on the genes\' size draws no legend of its own');
    const own = legends[1];
    assert.equal(own.marker.size.length, 5);
});

test('a heatmap gives a one-row section on a different quantity its own layer and color bar', () => {
    const fig = D.buildFigure(withOwnRows({ mode: 'heatmap' }), LIGHT);
    const layers = traces(fig, 'heatmap').filter((t) => t.colorbar);
    assert.equal(layers.length, 2);
    const [genes, section] = layers;
    assert.ok(Number.isNaN(genes.z[0][2]), 'the genes\' layer is empty where the section is');
    assert.equal(section.z[0][2], 0 + 0 / 10 + 2, 'the section\'s layer holds its own values');
    assert.ok(Number.isNaN(section.z[0][0]));
    assert.deepEqual(lines(section.colorbar.title), ['Pathway', 'z-score mean · X, averaged']);
});

// --- hover (CXG-15) ---------------------------------------------------------------------------------------------

test('hover names the group and its cells, the gene, and each value with its statistic and layer', () => {
    const [t] = traces(D.buildFigure(model(), LIGHT), 'scatter');
    const i = t.x.findIndex((x, k) => x === 1 && t.y[k] === 1);
    const lines2 = t.text[i].split('<br>');
    assert.equal(lines2[0], `group 1 · ${W.csv.cells}: 200`);
    assert.equal(lines2[1], 'Gene1');
    assert.equal(lines2[2], `${W.statistic.mean} · X: 1.1`);
    assert.equal(lines2[3], `${W.statistic.pct_expressing} (> 0) · X: 20`);
    assert.equal(t.hoverinfo, 'text');
});

test('hover shows the value as computed and as scaled, and says when no cell expresses', () => {
    const m = model();
    m.color.scaling = 'var';
    m.color.raw = Float64Array.from(m.color.values, (v) => v * 10);
    m.color.noExpressing = new Uint8Array(6);
    m.color.noExpressing[0] = 1;
    const [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.match(t.text[0], new RegExp(`${W.statistic.mean} · X: 0 \\(${W.scaled.var}: 0\\)`));
    assert.match(t.text[0], new RegExp(W.noExpressingCells));
    assert.doesNotMatch(t.text[1], new RegExp(W.noExpressingCells));
});

test('hover on a one-row section names the section and its aggregation', () => {
    const fig = D.buildFigure(withOwnRows(), LIGHT);
    const section = fig.data.find((t) => t.marker && t.marker.colorbar && lines(t.marker.colorbar.title).length === 2);
    assert.match(section.text[0], /Pathway · B cell score/);
    assert.match(section.text[0], /z-score mean · X, averaged: 2/);
});

test('hover text is HTML-safe: a gene name with angle brackets cannot make markup', () => {
    const m = model();
    m.rows[0].label = 'A<b>1';
    const [t] = traces(D.buildFigure(m, LIGHT), 'scatter');
    assert.ok(t.text.every((s) => !s.includes('<b>')));
    assert.ok(t.text[0].includes('A&lt;b>1'));
});

// --- rows, gaps, theme ------------------------------------------------------------------------------------------

test('a gap before a row leaves that many empty positions on the gene axis', () => {
    const m = model();
    m.rows[2].gapBefore = 2;
    const fig = D.buildFigure(m, LIGHT);
    assert.deepEqual(fig.layout.xaxis.tickvals, [0, 1, 4]);
    assert.deepEqual(fig.layout.xaxis.range, [-0.5, 4.5]);
    const hm = traces(D.buildFigure({ ...m, mode: 'heatmap' }, LIGHT), 'heatmap')[0];
    assert.equal(hm.z[0].length, 5);
    assert.ok(Number.isNaN(hm.z[0][2]) && Number.isNaN(hm.z[0][3]), 'the gap is empty');
    assert.equal(hm.z[0][4], 2);
    const gapRows = D.buildFigure({ ...m, mode: 'heatmap', color: { ...m.color, values: Float64Array.from(m.color.values).fill(NaN) } }, LIGHT);
    assert.ok(!traces(gapRows, 'heatmap')[1].z.some((r) => r[2] === 1 || r[3] === 1), 'a gap is not a missing value');
});

test('a one-row section label is italic, and a gene label is not', () => {
    const fig = D.buildFigure(withOwnRows(), LIGHT);
    assert.deepEqual(fig.layout.xaxis.ticktext.slice(0, 3), ['Gene0', 'Gene1', '<i>B cell score</i>']);
});

test('the theme sets the colors, the font and the plot title; dark differs from light', () => {
    const light = D.buildFigure(model({ plotTitle: 'Markers' }), LIGHT);
    const dark = D.buildFigure(model(), { ...DARK, fontFamily: 'Georgia', fontSize: 14 });
    assert.equal(light.layout.paper_bgcolor, LIGHT.bgColor);
    assert.equal(dark.layout.paper_bgcolor, DARK.bgColor);
    assert.equal(dark.layout.font.color, DARK.textColor);
    assert.equal(dark.layout.font.family, 'Georgia');
    assert.equal(dark.layout.font.size, 14);
    assert.equal(light.layout.title.text, 'Markers');
    assert.equal(dark.layout.title, undefined);
    assert.equal(light.layout.showlegend, false);
    assert.equal(D.buildFigure(model(), undefined).layout.paper_bgcolor, LIGHT.bgColor, 'light by default');
});

test('the figure leaves the model alone and survives a JSON round trip', () => {
    const m = withOwnRows();
    const before = JSON.stringify({ ...m, color: { ...m.color, values: [...m.color.values] }, size: { ...m.size, values: [...m.size.values] } });
    const fig = D.buildFigure(m, LIGHT);
    JSON.parse(JSON.stringify(fig));
    const after = JSON.stringify({ ...m, color: { ...m.color, values: [...m.color.values] }, size: { ...m.size, values: [...m.size.values] } });
    assert.equal(after, before);
});

test('an empty matrix draws an empty figure, not an error', () => {
    for (const mode of ['dots', 'heatmap']) {
        const fig = D.buildFigure(model({ rows: 0, groups: 2, mode }), LIGHT);
        assert.ok(Array.isArray(fig.data));
    }
});

test('a model that is not recognised is refused', () => {
    assert.throws(() => D.buildFigure(model({ mode: 'bubbles' }), LIGHT), /mode/);
});

// --- scaling (CXG-17: 400,000 cells) ----------------------------------------------------------------------------

const best = (fn, runs = 5) => {
    let t = Infinity;
    for (let i = 0; i < runs; i++) {
        const s = performance.now();
        fn();
        t = Math.min(t, performance.now() - s);
    }
    return t;
};

/** The CPU milliseconds (user + system) of `reps` calls of `fn` in this process, the quickest of `runs` samples. */
const bestCpu = (fn, reps, runs = 7) => {
    let t = Infinity;
    for (let i = 0; i < runs; i++) {
        const s = process.cpuUsage();
        for (let k = 0; k < reps; k++) fn();
        const d = process.cpuUsage(s);
        t = Math.min(t, (d.user + d.system) / 1000);
    }
    return t;
};

test('scaling: ten times the cells take at most fifteen times as long, heatmap and dots', () => {
    // A ratio of wall-clock times of builds that last a few milliseconds is noise on a loaded machine: the
    // scheduler's slice is as long as the build. The work is what grows with the cells, so CPU time is
    // compared (the machine's load does not enter it), a sample is a batch of builds (the small size 10 times,
    // the large one once, the same total cells, so neither sample is a fraction of a millisecond), and each is
    // the quickest of seven samples after a warm-up. Sizes and the 15x bound are as before.
    for (const mode of ['heatmap', 'dots']) {
        const small = model({ rows: 20, groups: 200, mode });
        const large = model({ rows: 200, groups: 200, mode });
        D.buildFigure(small, LIGHT);
        D.buildFigure(large, LIGHT);
        const a = bestCpu(() => D.buildFigure(small, LIGHT), 10) / 10;
        const b = bestCpu(() => D.buildFigure(large, LIGHT), 1);
        assert.ok(b <= 15 * Math.max(a, 1), `${mode}: ${a.toFixed(2)} ms of CPU for 4,000, ${b.toFixed(2)} ms for 40,000`);
    }
});

test('a 400,000-cell heatmap figure builds in well inside the 2 s drawing budget', () => {
    const m = model({ rows: 2000, groups: 200, mode: 'heatmap' });
    const t = best(() => D.buildFigure(m, LIGHT), 3);
    assert.ok(t < 1500, `${t.toFixed(0)} ms`);
});

// --- colourBars: one definition for the drawing and the clustering (X2b) ----------------------------------------

const barMatrix = (rows, groups, fill) => {
    const values = new Float64Array(rows * groups);
    for (let i = 0; i < values.length; i++) values[i] = fill(Math.floor(i / groups), i % groups);
    return { values, rows, groups };
};
const settings = (over = {}) => ({ id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', ...over });
const sectionsFor = () => [
    { title: 'Markers', rows: [0, 1, 2] },
    { title: 'Pathway', rows: [3], own: { id: 'score_mean|B', label: 'z-score mean · X, averaged' } },
    { title: 'Same', rows: [4], own: { id: 'mean|X', label: 'Mean · X' } }
];

test('colourBars: rows of one quantity share a bar, and every row is in exactly one bar', () => {
    const bars2 = D.colourBars(barMatrix(5, 2, (r, g) => r + g), [sectionsFor()[0], sectionsFor()[2]], settings());
    assert.equal(bars2.length, 1);
    assert.deepEqual([...bars2[0].rows], [0, 1, 2, 4]);
    const all = D.colourBars(barMatrix(5, 2, (r, g) => r + g), sectionsFor(), settings());
    const seen = all.flatMap((b) => [...b.rows]).sort((a, b) => a - b);
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
});

test('colourBars: under no scaling a one-row section on another quantity has its own bar, titled with the section', () => {
    const bars2 = D.colourBars(barMatrix(5, 2, (r, g) => r + g), sectionsFor(), settings());
    assert.equal(bars2.length, 2);
    assert.deepEqual([...bars2[0].rows], [0, 1, 2, 4], 'the section on the same quantity shares the genes\' bar');
    assert.deepEqual([...bars2[1].rows], [3]);
    assert.equal(bars2[1].title, `Pathway<br>z-score mean · X, averaged`);
    assert.equal(bars2[0].title, `${W.statistic.mean} · X`);
    assert.equal(bars2[0].rows instanceof Int32Array, true);
});

test('colourBars: under a 0-to-1 or z-score scaling there is one bar for all rows', () => {
    for (const scaling of ['var', 'group', 'z_groups', 'z_pooled']) {
        const bars2 = D.colourBars(barMatrix(5, 2, (r, g) => r + g), sectionsFor(), settings({ scaling }));
        assert.equal(bars2.length, 1, scaling);
        assert.deepEqual([...bars2[0].rows], [0, 1, 2, 3, 4]);
        assert.equal(bars2[0].title, `${W.statistic.mean} · X<br>${W.scaled[scaling]}`);
    }
});

test('colourBars: lo and hi skip NaN, and an own bar ranges over its own rows', () => {
    const m = barMatrix(5, 2, (r, g) => (r === 0 && g === 0 ? NaN : r === 3 ? 100 + g : r + g));
    const [genes, own] = D.colourBars(m, sectionsFor(), settings());
    assert.deepEqual([genes.lo, genes.hi], [1, 5]);
    assert.deepEqual([own.lo, own.hi], [100, 101]);
    assert.deepEqual([D.colourBars(m, sectionsFor(), settings({ min: 0, max: 9 }))[0].lo], [0]);
});

test('the figure takes its color bars from colourBars', () => {
    const m = withOwnRows();
    const fig = D.buildFigure(m, LIGHT);
    const rows = m.rows.length;
    const sections = m.rows.map((r, i) => (r.own ? { title: r.section.title, rows: [i], own: r.own.color } : null)).filter(Boolean);
    const genes = { title: '', rows: m.rows.map((r, i) => (r.own ? -1 : i)).filter((i) => i >= 0) };
    const expected = D.colourBars({ values: m.color.values, rows, groups: 2 }, [genes, ...sections], m.color);
    const drawn = fig.data.filter((t) => t.marker && t.marker.colorbar);
    assert.deepEqual(drawn.map((t) => [t.marker.cmin, t.marker.cmax]), expected.map((b) => [b.lo, b.hi]));
    assert.deepEqual(drawn.map((t) => t.marker.colorbar.title.text), expected.map((b) => b.title));
});

test('an axis of thousands of genes carries at most 120 labels, the first among them, and hover still names every gene', () => {
    const fig = D.buildFigure(model({ rows: 2000, groups: 3, mode: 'heatmap' }), LIGHT);
    const axis = fig.layout.xaxis;
    assert.ok(axis.tickvals.length <= 120 && axis.tickvals.length === axis.ticktext.length);
    assert.equal(axis.ticktext[0], 'Gene0');
    assert.equal(axis.tickvals[1] - axis.tickvals[0], Math.ceil(2000 / 120));
    assert.match(traces(fig, 'heatmap')[0].text[0][1999], /Gene1999/);
    assert.equal(D.buildFigure(model({ rows: 120, groups: 2 }), LIGHT).layout.xaxis.ticktext.length, 120, 'at the cap nothing is dropped');
});
