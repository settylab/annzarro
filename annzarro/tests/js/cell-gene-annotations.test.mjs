/**
 * The Cell-Gene Plot's drawn annotations (static/js/panels/cell-gene/draw-annotations.js, CXG-6, CXG-12, CXG-13,
 * CXG-14, CXG-17, CXG-24; UX 3.2 "in the plot"): section brackets with titles, group strips, the totals bar,
 * dendrograms, and labels thinned by the pixels they have. All of it is figure content, so Node holds it: each
 * annotation, its swap, the geometry that keeps the bands apart, and the hover that still names every gene and group.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-annotations.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/panels/cell-gene/draw.js');
const A = await import('../../../static/js/panels/cell-gene/draw-annotations.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const LIGHT = PLOT_PALETTES.light;
const DARK = PLOT_PALETTES.dark;

/** `rows` genes in `groups` groups; section 0 is the first `split` rows, section 1 the rest, with a gap between. */
function model({ rows = 6, groups = 4, split = 3, mode = 'dots', swap = false, annotations = {}, pixels, ...over } = {}) {
    const colour = new Float64Array(rows * groups);
    const size = new Float64Array(rows * groups);
    for (let i = 0; i < colour.length; i++) {
        colour[i] = i % 7;
        size[i] = (i * 13) % 101;
    }
    return {
        mode, swap, pixels: pixels || { width: 900, height: 600 }, annotations,
        groups: Array.from({ length: groups }, (_, g) => ({ label: `group ${g}`, n: 100 * (g + 1) })),
        rows: Array.from({ length: rows }, (_, r) => ({
            label: `Gene${r}`, gapBefore: r === split ? 1 : 0,
            section: r < split ? { index: 0, title: 'B cell markers', note: '3 genes not in this dataset' } : { index: 1, title: 'T cell markers' }
        })),
        color: { id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: colour, colorscale: 'Viridis' },
        size: { id: 'pct|X', stat: 'pct_expressing', layer: 'X', detectAbove: 0, values: size },
        ...over
    };
}

const draw = (m, theme = LIGHT) => A.annotateFigure(D.buildFigure(m, theme), m, theme);
const named = (fig, name) => fig.data.filter((t) => t.name === name);
const one = (fig, name) => {
    const t = named(fig, name);
    assert.equal(t.length, 1, `one "${name}" trace, got ${t.length}`);
    return t[0];
};
const finite = (a) => a.filter((v) => v !== null);
const axisOf = (fig, trace, dim) => fig.layout[`${dim}axis${trace[`${dim}axis`].slice(1)}`];
const span = ([a, b]) => b - a;
const lowest = (a) => a.reduce((x, y) => (y < x ? y : x), Infinity);
const highest = (a) => a.reduce((x, y) => (y > x ? y : x), -Infinity);

/** Every sub-axis domain is a pair inside [0, 1]. */
function domainsInside(fig) {
    for (const [key, axis] of Object.entries(fig.layout)) {
        if (/^[xy]axis/.test(key) && axis.domain) {
            assert.ok(axis.domain[0] >= -1e-9 && axis.domain[1] <= 1 + 1e-9 && axis.domain[1] > axis.domain[0], `${key} domain ${axis.domain}`);
        }
    }
}

// --- brackets (CXG-6) -------------------------------------------------------------------------------------------

test('brackets: one per section, spanning its columns, titled, with the section note in the hover', () => {
    const fig = draw(model({ annotations: { brackets: { titles: true } } }));
    const lines = one(fig, 'section brackets');
    // positions: genes 0,1,2 then one gap, genes at 4,5,6; each bracket runs from 0.4 before its first to 0.4 after its last
    const xs = finite(lines.x);
    assert.equal(lowest(xs), -0.4);
    assert.ok(xs.includes(2.4) && xs.includes(3.6) && xs.includes(6.4));
    assert.equal(lines.xaxis.slice(1) === lines.yaxis.slice(1), true, 'the bracket subplot is one axis pair');
    assert.equal(axisOf(fig, lines, 'x').matches, 'x', 'brackets follow the gene axis when it zooms');
    const titles = fig.layout.annotations.filter((a) => a.name === 'section title');
    assert.deepEqual(titles.map((a) => a.text), ['B cell markers', 'T cell markers']);
    assert.deepEqual(titles.map((a) => a.x), [1, 5]);
    const hover = one(fig, 'section hover');
    assert.equal(hover.hovertext[0], 'B cell markers<br>3 genes not in this dataset');
    assert.equal(hover.hovertext[1], 'T cell markers');
    domainsInside(fig);
});

test('brackets: titles can be hidden and the bracket stays, with its hover', () => {
    const fig = draw(model({ annotations: { brackets: { titles: false } } }));
    assert.equal(fig.layout.annotations.filter((a) => a.name === 'section title').length, 0);
    one(fig, 'section brackets');
    one(fig, 'section hover');
});

test('brackets: a title longer than its bracket is cut to fit, and the hover keeps it whole', () => {
    const m = model({ annotations: { brackets: { titles: true } } });
    m.rows[0].section.title = 'A very long section title that cannot fit over three columns';
    m.pixels = { width: 300, height: 400 };
    const fig = draw(m);
    const t = fig.layout.annotations.find((a) => a.name === 'section title' && a.x === 1);
    assert.ok(t.text.length < 30 && t.text.endsWith('…'), t.text);
    assert.ok(one(fig, 'section hover').hovertext[0].startsWith('A very long section title that cannot fit over three columns'));
});

test('brackets: a row with no section draws none, and a section is one run of consecutive rows', () => {
    const m = model({ annotations: { brackets: { titles: true } } });
    delete m.rows[5].section;
    const fig = draw(m);
    assert.equal(fig.layout.annotations.filter((a) => a.name === 'section title').length, 2);
    const xs = finite(one(fig, 'section brackets').x);
    assert.ok(xs.includes(5.4) && !xs.includes(6.4), 'the second bracket ends at gene 4 (position 5)');
});

test('swap: brackets stand left of the gene labels, aligned on y, with the titles turned', () => {
    const fig = draw(model({ swap: true, annotations: { brackets: { titles: true } } }));
    const lines = one(fig, 'section brackets');
    assert.equal(axisOf(fig, lines, 'y').matches, 'y');
    const ys = finite(lines.y);
    assert.equal(lowest(ys), -0.4);
    assert.ok(ys.includes(6.4));
    const titles = fig.layout.annotations.filter((a) => a.name === 'section title');
    assert.ok(titles.every((a) => a.textangle === -90));
    assert.deepEqual(titles.map((a) => a.y), [1, 5]);
    // the band is left of the plot
    const band = axisOf(fig, lines, 'x').domain;
    assert.ok(band[1] <= fig.layout.xaxis.domain[0] + 1e-9);
    domainsInside(fig);
});

// --- strips (CXG-14) --------------------------------------------------------------------------------------------

const STRIPS = [
    { title: 'cell_type', colours: ['#e41a1c', '#e41a1c', '#377eb8', '#377eb8'], levels: ['B', 'B', 'T', 'T'] },
    { title: 'age', colours: ['#4daf4a', '#984ea3', '#4daf4a', '#984ea3'], levels: ['Old', 'Young', 'Old', 'Young'] }
];

test('strips: one stacked bar per factor, a color per group, hover naming group and level', () => {
    const fig = draw(model({ annotations: { strips: STRIPS } }));
    const bars = named(fig, 'group strip');
    assert.equal(bars.length, 2);
    assert.deepEqual(bars.map((b) => b.marker.color), STRIPS.map((s) => s.colours));
    assert.equal(bars[0].orientation, 'h', 'groups are on y, so the strip bars lie along it');
    assert.deepEqual(bars[0].y, [0, 1, 2, 3]);
    assert.deepEqual(bars[1].x, [1, 1, 1, 1]);
    assert.equal(bars[1].text[1], 'group 1<br>age: Young');
    assert.equal(axisOf(fig, bars[0], 'y').matches, 'y');
    assert.equal(fig.layout.barmode, 'stack');
    assert.equal(bars[0].xaxis, bars[1].xaxis, 'the factors share one strip subplot');
    // the strip is between the labels and the plot: the labels stand off by its width
    assert.ok(fig.layout.yaxis.ticklabelstandoff > 0);
    domainsInside(fig);
});

test('strips: small groups say "small" after the label, the collected group too', () => {
    const m = model({ annotations: { strips: STRIPS } });
    m.groups[3].small = true;
    const fig = draw(m);
    assert.equal(fig.layout.yaxis.ticktext[3], 'group 3 <i>small</i>');
    assert.equal(fig.layout.yaxis.ticktext[2], 'group 2');
});

test('swap: strips lie along x below the plot, bars upright', () => {
    const fig = draw(model({ swap: true, annotations: { strips: STRIPS } }));
    const bars = named(fig, 'group strip');
    assert.equal(bars[0].orientation, 'v');
    assert.deepEqual(bars[0].x, [0, 1, 2, 3]);
    assert.equal(axisOf(fig, bars[0], 'x').matches, 'x');
    assert.ok(axisOf(fig, bars[0], 'y').domain[1] <= fig.layout.yaxis.domain[0] + 1e-9, 'below the plot');
    assert.ok(fig.layout.xaxis.ticklabelstandoff > 0);
    domainsInside(fig);
});

// --- totals (CXG-13) --------------------------------------------------------------------------------------------

test('totals: cells per group as a bar along the cell axis, on the side opposite the labels', () => {
    const fig = draw(model({ annotations: { totals: true } }));
    const bar = one(fig, 'cells per group');
    assert.deepEqual(bar.x, [100, 200, 300, 400]);
    assert.deepEqual(bar.y, [0, 1, 2, 3]);
    assert.equal(bar.orientation, 'h');
    assert.ok(bar.text.every((t, g) => t.includes(`group ${g}`) && t.includes(String(100 * (g + 1)))), bar.text.join('|'));
    const band = axisOf(fig, bar, 'x');
    assert.ok(band.domain[0] >= fig.layout.xaxis.domain[1] - 1e-9, 'right of the plot');
    assert.equal(axisOf(fig, bar, 'y').matches, 'y');
    assert.ok(band.range[0] === 0 && band.range[1] >= 400, 'the count axis starts at zero and holds the largest group');
    domainsInside(fig);
});

test('swap: totals stand above the plot as upright bars', () => {
    const fig = draw(model({ swap: true, annotations: { totals: true } }));
    const bar = one(fig, 'cells per group');
    assert.equal(bar.orientation, 'v');
    assert.deepEqual(bar.y, [100, 200, 300, 400]);
    assert.ok(axisOf(fig, bar, 'y').domain[0] >= fig.layout.yaxis.domain[1] - 1e-9, 'above the plot');
    domainsInside(fig);
});

// --- dendrograms (CXG-24) ---------------------------------------------------------------------------------------

// four leaves at drawn positions 0..3: (0,1) join at 0.5, (2,3) at 1, the two clusters at 2 (scipy's linkage layout)
const MERGES = Float64Array.from([0, 1, 0.5, 2, 2, 3, 1, 2, 4, 5, 2, 4]);

test('dendrograms: each merge is a bracket at its height, parents midway between children', () => {
    const fig = draw(model({ rows: 4, groups: 4, split: 4, annotations: { dendrograms: { groups: [{ merges: MERGES, positions: [0, 1, 2, 3] }] } } }));
    const t = one(fig, 'dendrogram groups');
    assert.equal(t.hoverinfo, 'skip');
    // groups are on y, so the tree's leaves are y and its heights x
    const segs = [];
    for (let i = 0; i < t.x.length; i += 5) segs.push([t.x.slice(i, i + 4), t.y.slice(i, i + 4)]);
    assert.equal(segs.length, 3);
    assert.deepEqual(segs[0], [[0, 0.5, 0.5, 0], [0, 0, 1, 1]]);
    assert.deepEqual(segs[1], [[0, 1, 1, 0], [2, 2, 3, 3]]);
    assert.deepEqual(segs[2], [[0.5, 2, 2, 1], [0.5, 0.5, 2.5, 2.5]]);
    assert.equal(t.x[4], null);
    const depth = axisOf(fig, t, 'x');
    assert.deepEqual([depth.range[0], depth.range[1] > 2], [0, true], 'leaves touch the plot (0), the root fits');
    assert.ok(depth.domain[0] >= fig.layout.xaxis.domain[1] - 1e-9);
    assert.equal(axisOf(fig, t, 'y').matches, 'y');
    domainsInside(fig);
});

test('dendrograms: genes sit on the far side from the labels and use the gene positions across a gap', () => {
    // one block of four genes spanning the gap: genes 0,1 are drawn at 0,1 and genes 2,3 at 3,4
    const m = model({ rows: 4, groups: 3, split: 2, annotations: { dendrograms: { genes: [{ merges: MERGES, positions: [0, 1, 2, 3] }] } } });
    const fig = draw(m);
    const t = one(fig, 'dendrogram genes');
    const leaves = [];
    finite(t.y).forEach((h, i) => { if (h === 0) leaves.push(finite(t.x)[i]); });
    assert.deepEqual([...new Set(leaves)].sort((a, b) => a - b), [0, 1, 3, 4]);
    const depth = axisOf(fig, t, 'y');
    assert.ok(depth.domain[1] <= fig.layout.yaxis.domain[0] + 1e-9, 'below the plot, labels are above');
    assert.ok(depth.range[0] > depth.range[1], 'leaves at the top of the band, next to the plot');
    domainsInside(fig);
});

test('swap: the group tree is above the plot and the gene tree right of it', () => {
    const blocks = { merges: MERGES, positions: [0, 1, 2, 3] };
    const fig = draw(model({ rows: 4, groups: 4, split: 4, swap: true, annotations: { dendrograms: { groups: [blocks], genes: [blocks] } } }));
    const g = one(fig, 'dendrogram groups');
    const r = one(fig, 'dendrogram genes');
    assert.equal(axisOf(fig, g, 'x').matches, 'x');
    assert.ok(axisOf(fig, g, 'y').domain[0] >= fig.layout.yaxis.domain[1] - 1e-9);
    assert.equal(axisOf(fig, r, 'y').matches, 'y');
    assert.ok(axisOf(fig, r, 'x').domain[0] >= fig.layout.xaxis.domain[1] - 1e-9);
    domainsInside(fig);
});

test('dendrogramBlocks: leaves go where the order drew them; rows left out and blocks too large draw no tree', () => {
    // matrix rows 2,0,1 were clustered (clustered holds matrix indices, merges index into it); row 3 was left out
    const blocks = [
        { start: 0, count: 4, state: 'clustered', clustered: Int32Array.from([2, 0, 1]), excluded: Int32Array.from([3]),
            merges: Float64Array.from([0, 1, 0.3, 3, 2, 0.8, 3]) },
        { start: 4, count: 5000, state: 'too_many' },
        { start: 9, count: 1, state: 'clustered', clustered: Int32Array.from([9]), excluded: new Int32Array(0), merges: new Float64Array(0) }
    ];
    // drawn order: position p holds matrix row order[p]
    const order = Int32Array.from([1, 2, 0, 3, 4, 5, 6, 7, 8, 9]);
    const out = A.dendrogramBlocks(blocks, order);
    assert.equal(out.length, 1, 'only the block with a tree');
    assert.deepEqual([...out[0].positions], [1, 2, 0], 'matrix row 2 is drawn at 1, row 0 at 2, row 1 at 0');
    assert.equal(out[0].merges, blocks[0].merges);
});

// --- label thinning (CXG-17) ------------------------------------------------------------------------------------

test('thinTicks keeps ticks at least a gap apart, the first always, and all of them when they fit', () => {
    assert.deepEqual([...A.thinTicks([0, 10, 20, 30], 10)], [0, 1, 2, 3]);
    assert.deepEqual([...A.thinTicks([0, 4, 8, 12, 16, 20], 10)], [0, 3]);
    const px = Array.from({ length: 1000 }, (_, i) => i * 0.5);
    const kept = A.thinTicks(px, 14);
    for (let i = 1; i < kept.length; i++) assert.ok(px[kept[i]] - px[kept[i - 1]] >= 14);
    assert.ok(kept.length >= 500 / 14 - 1, 'it does not thin more than the pixels need');
});

test('labels thin by the pixels they have: 2,000 genes on a 600 px axis never overlap, every gene stays in the hover', () => {
    const m = model({ rows: 2000, groups: 3, split: 1000, swap: true, pixels: { width: 900, height: 600 }, annotations: {} });
    const fig = draw(m);
    const axis = fig.layout.yaxis;
    assert.ok(axis.tickvals.length >= 20 && axis.tickvals.length <= 50, `kept ${axis.tickvals.length}`);
    const [lo, hi] = [lowest(axis.range), highest(axis.range)];
    const inner = 600 - 20;
    const px = axis.tickvals.map((v) => ((v - lo) / (hi - lo)) * inner * (axis.domain[1] - axis.domain[0])).sort((a, b) => a - b);
    for (let i = 1; i < px.length; i++) assert.ok(px[i] - px[i - 1] >= 12 * 1.2 - 1e-6, `gap ${px[i] - px[i - 1]}`);
    assert.equal(axis.tickvals.length, axis.ticktext.length);
    // the hover still names every gene
    const text = fig.data.filter((t) => t.text).flatMap((t) => t.text).join('\n');
    for (let r = 0; r < 2000; r += 1) assert.ok(text.includes(`<br>Gene${r}<br>`), `Gene${r}`);
});

test('labels stay whole when the axis has room, and wider axes keep more', () => {
    const small = draw(model({ rows: 40, groups: 3, pixels: { width: 400, height: 300 } }));
    const wide = draw(model({ rows: 40, groups: 3, pixels: { width: 1600, height: 300 } }));
    assert.ok(small.layout.xaxis.tickvals.length < wide.layout.xaxis.tickvals.length);
    assert.equal(wide.layout.xaxis.tickvals.length, 40);
    assert.equal(wide.layout.xaxis.ticktext[39], 'Gene39');
});

test('the thinning is not the stopgap: 2,000 gene labels on a tall axis are kept far past 120', () => {
    const fig = draw(model({ rows: 2000, groups: 3, split: 1000, swap: true, pixels: { width: 900, height: 4000 } }));
    assert.ok(fig.layout.yaxis.tickvals.length > 120, `kept ${fig.layout.yaxis.tickvals.length}`);
});

test('the gap between sections moves the ticks with it', () => {
    const fig = draw(model({ pixels: { width: 1600, height: 300 } }));
    assert.deepEqual(fig.layout.xaxis.tickvals, [0, 1, 2, 4, 5, 6]);
});

test('labels off: no tick labels on the axis that has them off', () => {
    const fig = draw(model({ annotations: { labels: { genes: false } } }));
    assert.equal(fig.layout.xaxis.showticklabels, false);
    assert.notEqual(fig.layout.yaxis.showticklabels, false);
    const both = draw(model({ annotations: { labels: { genes: false, groups: false } } }));
    assert.equal(both.layout.yaxis.showticklabels, false);
});

test('long labels are cut to the room set aside for them; the hover has the whole name', () => {
    const m = model({ annotations: { brackets: { titles: true } } });
    m.rows[0].label = 'A_Gene_Name_That_Is_Really_Much_Too_Long_For_Any_Axis_To_Hold_Whole';
    const fig = draw(m);
    const text = fig.layout.xaxis.ticktext[0];
    assert.ok(text.endsWith('…') && text.length < 40, text);
    assert.ok(fig.data.some((t) => t.text && t.text.some((s) => s.includes('A_Gene_Name_That_Is_Really_Much_Too_Long_For_Any_Axis_To_Hold_Whole'))));
});

// --- the whole figure -------------------------------------------------------------------------------------------

test('with nothing to annotate the figure is the matrix and thinned labels, no extra traces', () => {
    const m = model();
    const plain = D.buildFigure(m, LIGHT);
    const fig = draw(m);
    assert.equal(fig.data.length, plain.data.length);
    assert.equal(fig.layout.xaxis.automargin, true, 'Plotly still fits the labels when no band has to sit beyond them');
    assert.deepEqual(fig.layout.xaxis.domain, plain.layout.xaxis.domain);
});

test('every annotation at once keeps the plot and the bands apart, in dots and in a heatmap, swapped or not', () => {
    const blocks = { merges: MERGES, positions: [0, 1, 2, 3] };
    for (const mode of ['dots', 'heatmap']) {
        for (const swap of [false, true]) {
            const fig = draw(model({ rows: 4, groups: 4, split: 2, mode, swap, annotations: {
                brackets: { titles: true }, strips: STRIPS, totals: true, dendrograms: { groups: [blocks], genes: [blocks] } } }));
            domainsInside(fig);
            const x = fig.layout.xaxis.domain;
            const y = fig.layout.yaxis.domain;
            assert.ok(span(x) > 0.2 && span(y) > 0.2, `${mode} swap=${swap}: the plot keeps room ${x} ${y}`);
            const bands = Object.entries(fig.layout).filter(([k]) => /^[xy]axis\d+$/.test(k) && Number(k.replace(/\D/g, '')) >= 90);
            assert.ok(bands.length >= 5, `${mode} swap=${swap}: a pair of axes per band (${bands.length})`);
            // the legend column is not covered: bands stay left of the legends
            for (const [k, a] of bands) if (k.startsWith('xaxis')) assert.ok(a.domain[1] <= 0.83, `${k} ${a.domain}`);
        }
    }
});

test('the dark palette colors the bands: totals, trees, bracket lines and titles follow the theme', () => {
    const fig = draw(model({ rows: 4, groups: 4, split: 4, annotations: { brackets: { titles: true }, totals: true,
        dendrograms: { groups: [{ merges: MERGES, positions: [0, 1, 2, 3] }] } } }), DARK);
    assert.equal(one(fig, 'dendrogram groups').line.color, DARK.axisColor);
    assert.equal(one(fig, 'section brackets').line.color, DARK.axisColor);
    assert.equal(one(fig, 'cells per group').marker.color, DARK.axisColor);
    assert.ok(fig.layout.annotations.filter((a) => a.name === 'section title').every((a) => a.font.color === DARK.textColor));
});

test('annotating does not touch the matrix traces and does no work per cell', () => {
    const m = model({ rows: 2000, groups: 200, split: 1000, mode: 'heatmap', annotations: { brackets: { titles: true }, totals: true } });
    const plain = D.buildFigure(m, LIGHT);
    const before = plain.data[0];
    const fig = A.annotateFigure(plain, m, LIGHT);
    assert.equal(fig.data[0], before, 'the same trace object, untouched');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) A.annotateFigure(D.buildFigure(model({ rows: 2000, groups: 2, mode: 'heatmap', annotations: {} }), LIGHT), model({ rows: 2000, groups: 2 }), LIGHT);
    assert.ok(performance.now() - t0 < 5000);
});
