/**
 * The Venn and UpSet figures (panels/cell-count/draw-sets.js, V2): built from a fake SetPlot of the shape fixed in
 * lead-notes ("V1 output shape"), so no model code is needed. The figure is pure data; these tests read it back.
 *
 * Run:  node --test annzarro/tests/js/draw-sets.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../../static/js/panels/cell-count/draw-sets.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const LIGHT = PLOT_PALETTES.light;
const DARK = PLOT_PALETTES.dark;
const NAMES = ['in Table 1', 'cell_type is T cell, NK', 'Cd3e > 0.5 (logged_counts)'];

/** A SetPlot as V1 makes it: every region of degree >= 1, exclusive counts, sets lettered. */
function fakePlot(k, { mode = 'venn', counts, universe, shown, options = null, color = null, colors = null, state = [] } = {}) {
    const total = (1 << k) - 1;
    const regions = [];
    for (let code = 1; code <= total; code++) {
        const key = new Uint8Array(k);
        let degree = 0;
        for (let s = 0; s < k; s++) if (code & (1 << s)) { key[s] = 1; degree++; }
        const count = counts ? counts[code] : 100 * code;
        regions.push({ key, degree, count, share: 0, color: colors ? colors[code] : null });
    }
    const inSets = regions.reduce((a, r) => a + r.count, 0);
    const uni = universe ?? inSets + 3402;
    for (const r of regions) r.share = r.count / uni;
    const sets = Array.from({ length: k }, (_, i) => ({
        index: i, letter: String.fromCharCode(65 + i), name: NAMES[i] ?? `set ${i}`,
        size: regions.filter(r => r.key[i]).reduce((a, r) => a + r.count, 0), noValue: i === 2 ? 312 : 0, state: state[i] ?? 'ok'
    }));
    const all = regions.map((_, i) => i);
    const idx = shown ?? all;
    const gone = all.filter(i => !idx.includes(i));
    const hidden = { regions: gone.length, cells: gone.reduce((a, i) => a + regions[i].count, 0), share: 0 };
    hidden.share = hidden.cells / uni;
    return { mode, universe: uni, inNone: uni - inSets, sets, regions, shown: idx, hidden, options, color };
}

const traceOf = (fig, name) => fig.data.find(t => t.name === name);
const circles = (fig) => fig.layout.shapes.filter(s => s.type === 'circle');

test('a Venn of three sets draws three circles, lettered, with the count and share of each region', () => {
    const fig = D.buildFigure(fakePlot(3), LIGHT);
    assert.equal(circles(fig).length, 3);
    const labels = traceOf(fig, 'regions');
    assert.equal(labels.x.length, 7);
    assert.ok(labels.text.every(t => /\d/.test(t)));
    assert.ok(labels.text[0].includes('100'), 'count of region A only');
    assert.ok(labels.text[0].includes('%'), 'and its share');
    const letters = fig.layout.annotations.map(a => a.text);
    for (const l of ['A', 'B', 'C']) assert.ok(letters.includes(l), `letter ${l}`);
    assert.ok(!letters.some(t => t.includes('Table 1')), 'Venn is lettered, names stay in the set list');
});

test('every Venn label lies inside exactly the circles its key says (not area-proportional, but never wrong)', () => {
    for (const k of [1, 2, 3]) {
        const plot = fakePlot(k);
        const fig = D.buildFigure(plot, LIGHT);
        const cs = circles(fig);
        const labels = traceOf(fig, 'regions');
        plot.shown.forEach((ri, n) => {
            const x = labels.x[n], y = labels.y[n];
            const inside = cs.map(c => {
                const rx = (c.x1 - c.x0) / 2, ry = (c.y1 - c.y0) / 2;
                return (((x - (c.x0 + c.x1) / 2) / rx) ** 2 + ((y - (c.y0 + c.y1) / 2) / ry) ** 2) < 1 ? 1 : 0;
            });
            assert.deepEqual(inside, [...plot.regions[ri].key], `k=${k} region ${ri}`);
        });
    }
});

test('the cells in no set are stated beside the Venn, and a region with no cells still says 0', () => {
    const counts = []; counts[1] = 0; counts[2] = 5; counts[3] = 7;
    const fig = D.buildFigure(fakePlot(2, { counts, universe: 8090 }), LIGHT);
    assert.ok(fig.layout.annotations.some(a => a.text.includes('8,078') && a.text.includes('in no set')));
    assert.ok(traceOf(fig, 'regions').text[0].startsWith('0'));
});

test('a Venn with a fourth set is refused by the drawing, which the panel never asks for', () => {
    assert.throws(() => D.buildFigure(fakePlot(4), LIGHT), RangeError);
});

test('Venn labels option: none, count or share', () => {
    const plot = fakePlot(2);
    assert.deepEqual(traceOf(D.buildFigure(plot, LIGHT, { labels: 'none' }), 'regions').text, ['', '', '']);
    const c = traceOf(D.buildFigure(plot, LIGHT, { labels: 'count' }), 'regions').text;
    assert.ok(c.every(t => !t.includes('%')));
    const s = traceOf(D.buildFigure(plot, LIGHT, { labels: 'share' }), 'regions').text;
    assert.ok(s.every(t => t.includes('%')));
});

test('hover names the sets, the count and the share; customdata carries the region for Save as grouping', () => {
    const fig = D.buildFigure(fakePlot(3), LIGHT);
    const t = traceOf(fig, 'regions');
    assert.deepEqual(t.customdata, [0, 1, 2, 3, 4, 5, 6]);
    assert.ok(t.hovertext[0].includes('in Table 1'));
    assert.ok(t.hovertext[0].includes('only'));
    assert.ok(t.hovertext[2].includes('in Table 1') && t.hovertext[2].includes('cell_type is T cell, NK'));
    assert.ok(t.hovertext[0].includes('cells'));
});

function upsetPlot(k, m, extra = {}) {
    // m regions shown out of the 2^k - 1, in a deliberately shuffled order: the drawing never re-sorts
    const base = fakePlot(k, { mode: 'upset', options: { sort: 'size', top: 40, minSize: 0 }, ...extra });
    const order = base.regions.map((_, i) => i).sort((a, b) => base.regions[b].count - base.regions[a].count).slice(0, m);
    const gone = base.regions.map((_, i) => i).filter(i => !order.includes(i));
    base.shown = order;
    base.hidden = { regions: gone.length, cells: gone.reduce((a, i) => a + base.regions[i].count, 0), share: 0 };
    base.hidden.share = base.hidden.cells / base.universe;
    return base;
}

test('UpSet draws the shown regions in the given order, one bar each, and nothing else', () => {
    const plot = upsetPlot(3, 4);
    const fig = D.buildFigure(plot, LIGHT);
    const bars = traceOf(fig, 'intersections');
    assert.deepEqual(bars.x, [0, 1, 2, 3]);
    assert.deepEqual(bars.y, plot.shown.map(i => plot.regions[i].count));
    assert.deepEqual(bars.customdata, plot.shown);
});

test('the dot matrix has a filled dot per set a region is in, and a line only between them', () => {
    const plot = upsetPlot(3, 7);
    const fig = D.buildFigure(plot, LIGHT);
    const on = traceOf(fig, 'in');
    const expectedDots = plot.shown.reduce((a, i) => a + plot.regions[i].degree, 0);
    assert.equal(on.x.length, expectedDots);
    plot.shown.forEach((ri, col) => {
        const rows = [];
        on.x.forEach((x, n) => { if (x === col) rows.push(on.y[n]); });
        assert.deepEqual(rows.sort(), [...plot.regions[ri].key].flatMap((v, s) => v ? [s] : []), `column ${col}`);
    });
    const link = traceOf(fig, 'links');
    const segs = link.x.filter(v => v === null).length;
    assert.equal(segs, plot.shown.filter(i => plot.regions[i].degree > 1).length, 'one segment per multi-set region');
    assert.equal(traceOf(fig, 'out').x.length, plot.shown.length * 3 - expectedDots);
});

test('set-size bars carry the model sizes, and UpSet names the sets in full', () => {
    const plot = upsetPlot(3, 7);
    const fig = D.buildFigure(plot, LIGHT);
    const sizes = traceOf(fig, 'set sizes');
    assert.deepEqual(sizes.x, plot.sets.map(s => s.size));
    const ticks = Object.values(fig.layout).filter(v => v && v.ticktext).flatMap(v => v.ticktext);
    for (const s of plot.sets) assert.ok(ticks.includes(s.name), s.name);
});

test('the share of cells in bars not shown is stated only when something is hidden', () => {
    const none = D.buildFigure(upsetPlot(3, 7), LIGHT);
    assert.ok(!none.layout.annotations.some(a => a.text.includes('not shown')));
    const some = D.buildFigure(upsetPlot(3, 4), LIGHT);
    const note = some.layout.annotations.find(a => a.text.includes('not shown'));
    assert.ok(note, 'a note when bars are hidden');
    assert.match(note.text, /\d+(\.\d)?%/);
    assert.ok(note.text.includes(some.layout.annotations.length ? 'cells' : ''));
});

test('UpSet bar Color: a numeric colour with a colour bar titled by the model, or one theme colour', () => {
    const plain = D.buildFigure(upsetPlot(3, 7), LIGHT);
    assert.equal(traceOf(plain, 'intersections').marker.color, LIGHT.noneColor);
    const colors = [null, 1, 2, 3, 4, 5, 6, 7];
    const plot = upsetPlot(3, 7, { colors, color: { label: 'Mean of Mrpl15 · logged_counts', kind: 'statistic' } });
    const fig = D.buildFigure(plot, LIGHT);
    const m = traceOf(fig, 'intersections').marker;
    assert.deepEqual(m.color, plot.shown.map(i => colors[i + 1]));
    assert.equal(m.colorbar.title.text, 'Mean of Mrpl15 · logged_counts');
    assert.equal(m.showscale, true);
});

test('a region without a colour value is drawn grey, never as zero', () => {
    const colors = [null, 1, null, 3, 4, 5, 6, 7];
    const plot = upsetPlot(3, 7, { colors, color: { label: 'Share', kind: 'share' } });
    const m = traceOf(D.buildFigure(plot, LIGHT), 'intersections').marker;
    const at = plot.shown.indexOf(1);
    assert.equal(m.color[at], null);
    const grey = traceOf(D.buildFigure(plot, LIGHT), 'no value');
    assert.equal(grey.marker.color, LIGHT.notInTableColor);
    assert.deepEqual(grey.y.map((v, n) => (v === null ? null : n)).filter(v => v !== null), [at], 'only that bar, in its own place');
    assert.equal(traceOf(D.buildFigure(upsetPlot(3, 7), LIGHT), 'no value'), undefined);
});

test('the bars start at zero, with a count axis titled in words and linear unless asked', () => {
    const fig = D.buildFigure(upsetPlot(3, 7), LIGHT);
    const axis = Object.values(fig.layout).find(v => v && v.title && v.title.text === 'Cells in region');
    assert.ok(axis);
    assert.equal(axis.type, 'linear');
    assert.equal(axis.rangemode, 'tozero');
    const logged = D.buildFigure(upsetPlot(3, 7), LIGHT, { logCounts: true });
    assert.ok(Object.values(logged.layout).some(v => v && v.title && v.title.text === 'Cells in region' && v.type === 'log'));
});

test('narrow: the set-size bars move under the matrix (UX 4.8)', () => {
    const plot = upsetPlot(3, 7);
    const wide = D.buildFigure(plot, LIGHT, { width: 900 });
    const narrow = D.buildFigure(plot, LIGHT, { width: 360 });
    const domainOf = (fig, trace) => fig.layout[trace.yaxis.replace('y', 'yaxis')].domain;
    const mw = domainOf(wide, traceOf(wide, 'in')), sw = domainOf(wide, traceOf(wide, 'set sizes'));
    assert.deepEqual(mw, sw, 'wide: same rows as the matrix, to its left');
    const mn = domainOf(narrow, traceOf(narrow, 'in')), sn = domainOf(narrow, traceOf(narrow, 'set sizes'));
    assert.ok(sn[1] <= mn[0] + 1e-9, 'narrow: below the matrix');
});

test('bar labels thin out when the bars are too narrow to carry them', () => {
    const plot = upsetPlot(5, 31);
    const roomy = traceOf(D.buildFigure(plot, LIGHT, { width: 2400, labels: 'count' }), 'intersections');
    const tight = traceOf(D.buildFigure(plot, LIGHT, { width: 400, labels: 'count' }), 'intersections');
    assert.equal(roomy.text.filter(Boolean).length, 31);
    assert.equal(tight.text.filter(Boolean).length, 0, 'none rather than overlapping');
    assert.equal(traceOf(D.buildFigure(plot, LIGHT, { width: 2400, labels: 'none' }), 'intersections').text.filter(Boolean).length, 0);
    const share = traceOf(D.buildFigure(plot, LIGHT, { width: 2400, labels: 'share' }), 'intersections').text;
    assert.ok(share.every(t => t.includes('%')));
});

test('the figure follows the theme: dark and light differ in paper, text and the unused dots', () => {
    const plot = upsetPlot(3, 7);
    const l = D.buildFigure(plot, LIGHT), d = D.buildFigure(plot, DARK);
    assert.notEqual(l.layout.paper_bgcolor, d.layout.paper_bgcolor);
    assert.equal(d.layout.font.color, DARK.textColor);
    assert.equal(traceOf(d, 'out').marker.color, DARK.gridColor);
    assert.equal(traceOf(D.buildFigure(fakePlot(2), DARK), 'regions').textfont.color, DARK.textColor);
});

test('a set whose source changed or is gone keeps its row in the figure, marked', () => {
    const plot = upsetPlot(3, 7, { state: ['ok', 'changed', 'deleted'] });
    const ticks = Object.values(D.buildFigure(plot, LIGHT).layout).filter(v => v && v.ticktext).flatMap(v => v.ticktext);
    assert.ok(ticks.some(t => t.includes('cell_type is T cell, NK') && t.includes('changed')));
    assert.ok(ticks.some(t => t.includes('deleted')));
    assert.ok(ticks.some(t => t === 'in Table 1'));
});

test('drawing reads only the shown regions: 16 sets, 65,535 regions, 40 bars (no work that grows with the regions)', () => {
    const k = 16;
    const touched = new Set();
    const regions = new Proxy({ length: 65535 }, {
        get(target, prop) {
            if (prop === 'length') return target.length;
            const i = Number(prop);
            if (Number.isInteger(i)) {
                touched.add(i);
                const key = new Uint8Array(k); key[i % k] = 1; key[(i + 3) % k] = 1;
                return { key, degree: 2, count: 1000 - i, share: 0.001, color: null };
            }
            return undefined;
        }
    });
    const sets = Array.from({ length: k }, (_, i) => ({ index: i, letter: String.fromCharCode(65 + i), name: `set ${i}`, size: 100, noValue: 0, state: 'ok' }));
    const shown = Array.from({ length: 40 }, (_, i) => i * 1000);
    const plot = { mode: 'upset', universe: 1e6, inNone: 10, sets, regions, shown, hidden: { regions: 65495, cells: 5e5, share: 0.5 },
        options: { sort: 'size', top: 40, minSize: 0 }, color: null };
    const fig = D.buildFigure(plot, LIGHT);
    assert.equal(traceOf(fig, 'intersections').x.length, 40);
    assert.ok([...touched].every(i => shown.includes(i)), `touched ${touched.size} regions`);
});
