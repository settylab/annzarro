/**
 * The area-proportional layout of a Venn (utils/venn-euler.js): two sets exact, three sets approximate with the error
 * stated, and the figure that draws it (panels/cell-count/draw-sets.js with `proportional`).
 *
 * Run:  node --test annzarro/tests/js/venn-euler.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../../../static/js/utils/venn-euler.js');
const D = await import('../../../static/js/panels/cell-count/draw-sets.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');
const LIGHT = PLOT_PALETTES.light;

const maxOf = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const minOf = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);

/** Counts by region code of three sets (1 A, 2 B, 3 AB, 4 C, 5 AC, 6 BC, 7 ABC), listed in this order. */
const FIXTURES = {
    lopsided: [120, 60, 40, 30, 25, 15, 10],
    gene_sets: [300, 250, 120, 200, 60, 80, 40],
    equal_sets: [300, 300, 100, 300, 100, 100, 100],
    tiny_triple: [400, 300, 100, 200, 100, 100, 2],
    nested: [500, 0, 200, 0, 0, 0, 0],
    disjoint: [100, 100, 0, 100, 0, 0, 0]
};
/** Pairs that overlap and never all three together: no circles draw this. */
const IMPOSSIBLE = [0, 0, 50, 0, 50, 50, 0];

/** The area of the part of the circles all contain, by counting grid points (an independent check of the exact areas). */
function gridArea(circles, n = 1200) {
    const x0 = minOf(circles.map(c => c.x - c.r)), x1 = maxOf(circles.map(c => c.x + c.r));
    const y0 = minOf(circles.map(c => c.y - c.r)), y1 = maxOf(circles.map(c => c.y + c.r));
    let hit = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const x = x0 + ((i + 0.5) * (x1 - x0)) / n, y = y0 + ((j + 0.5) * (y1 - y0)) / n;
            if (circles.every(c => Math.hypot(x - c.x, y - c.y) <= c.r)) hit++;
        }
    }
    return (hit * (x1 - x0) * (y1 - y0)) / (n * n);
}

function plotOf(counts, k = 3) {
    const regions = [];
    for (let code = 1; code < (1 << k); code++) {
        const key = new Uint8Array(k);
        let degree = 0;
        for (let s = 0; s < k; s++) if (code & (1 << s)) { key[s] = 1; degree++; }
        regions.push({ key, degree, count: counts[code - 1], share: 0, color: null });
    }
    const inSets = regions.reduce((a, r) => a + r.count, 0), universe = inSets + 100;
    for (const r of regions) r.share = r.count / universe;
    const sets = Array.from({ length: k }, (_, i) => ({
        index: i, letter: 'ABC'[i], name: `set ${i}`, size: regions.filter(r => r.key[i]).reduce((a, r) => a + r.count, 0), noValue: 0, state: 'ok'
    }));
    return { mode: 'venn', universe, inNone: 100, sets, regions, shown: regions.map((_, i) => i), hidden: { regions: 0, cells: 0, share: 0 }, options: null, color: null };
}
const circlesOf = (fig) => fig.layout.shapes.filter(s => s.type === 'circle');
const radius = (c) => (c.x1 - c.x0) / 2;

test('the area of two circles that overlap is exact: the lens has the intersection\'s area to 1e-6 relative', () => {
    for (const [a, b, ab] of [[700, 300, 200], [50, 950, 20], [400, 400, 399], [120, 10, 1], [900, 100, 100]]) {
        const layout = E.eulerLayout(2, (code) => [a, b, ab][code - 1]);
        const [c0, c1] = layout.circles;
        const sizeA = a + ab, sizeB = b + ab, per = Math.PI / Math.max(sizeA, sizeB);
        assert.ok(Math.abs(Math.PI * c0.r ** 2 - sizeA * per) / (sizeA * per) < 1e-9, 'circle A is its set');
        assert.ok(Math.abs(Math.PI * c1.r ** 2 - sizeB * per) / (sizeB * per) < 1e-9, 'circle B is its set');
        const lens = E.lensArea(c0.r, c1.r, Math.hypot(c1.x - c0.x, c1.y - c0.y));
        assert.ok(Math.abs(lens - ab * per) / (ab * per) < 1e-6, `overlap of ${[a, b, ab]}: ${lens} against ${ab * per}`);
        assert.ok(layout.error < 1e-9 && layout.exact, 'the layout says it is exact');
    }
});

test('the exact intersection area agrees with a count of grid points, for two and three circles', () => {
    const cs = [{ x: 0, y: 0, r: 1 }, { x: 0.9, y: 0.1, r: 0.8 }, { x: 0.4, y: -0.8, r: 0.7 }];
    for (const mask of [[0, 1], [0, 2], [1, 2], [0, 1, 2]]) {
        const sel = mask.map(i => cs[i]);
        const exact = E.intersectionArea(sel), grid = gridArea(sel);
        assert.ok(Math.abs(exact - grid) / grid < 1e-3, `${mask}: ${exact} against ${grid}`);
    }
});

test('three sets: the largest error of a region stays within 3.5 percentage points on the fixtures, and every circle is its set\'s size', () => {
    for (const [name, counts] of Object.entries(FIXTURES)) {
        const layout = E.eulerLayout(3, (code) => counts[code - 1]);
        assert.ok(layout.error <= 0.035, `${name}: largest error ${(layout.error * 100).toFixed(2)} points`);
        assert.equal(layout.exact, false);
        const sizes = [0, 1, 2].map(s => counts.reduce((a, n, i) => a + ((i + 1) & (1 << s) ? n : 0), 0));
        const biggest = maxOf(sizes);
        layout.circles.forEach((c, s) => assert.ok(Math.abs(c.r - Math.sqrt(sizes[s] / biggest)) < 1e-12, `${name} circle ${s}`));
        // the same counts give the same drawing
        assert.deepEqual(E.eulerLayout(3, (code) => counts[code - 1]).circles, layout.circles);
    }
});

test('three sets that cannot be drawn with circles report a large error, and the drawing says so under the plot', () => {
    const layout = E.eulerLayout(3, (code) => IMPOSSIBLE[code - 1]);
    assert.ok(layout.error > 0.1, `error ${layout.error}`);
    const note = (fig) => fig.layout.annotations.find(a => a.text.startsWith('Areas are approximate'));
    const bad = D.buildFigure(plotOf(IMPOSSIBLE), LIGHT, { proportional: true });
    assert.match(note(bad).text, /^Areas are approximate: largest error \d+\.\d% of the cells in the sets$/);
    assert.equal(note(bad).yref, 'paper');
    assert.equal(note(bad).yanchor, 'top', 'under the plot');
    for (const counts of Object.values(FIXTURES)) {
        assert.equal(note(D.buildFigure(plotOf(counts), LIGHT, { proportional: true })), undefined, 'a close drawing has no note');
    }
    assert.equal(note(D.buildFigure(plotOf(IMPOSSIBLE), LIGHT)), undefined, 'the fixed layout has no note');
    assert.equal(note(D.buildFigure(plotOf([700, 300, 200], 2), LIGHT, { proportional: true })), undefined, 'two sets are exact');
});

test('proportional circles have areas in proportion to the sets, and a region without cells has no label', () => {
    const fig = D.buildFigure(plotOf([500, 0, 0, 200, 0, 0, 0]), LIGHT, { proportional: true });
    const cs = circlesOf(fig);
    assert.ok(Math.abs(radius(cs[0]) - 1) < 1e-12);
    assert.equal(radius(cs[1]), 0, 'a set with no cells has no area');
    const labels = fig.data[0];
    const text = (code) => labels.text[code - 1];
    assert.ok(text(1).startsWith('500') && text(4).startsWith('200'));
    assert.equal(text(2), '', 'nothing to label in a region that does not exist');
    const sized = D.buildFigure(plotOf([700, 300, 200], 2), LIGHT, { proportional: true });
    const [a, b] = circlesOf(sized).map(radius);
    assert.ok(Math.abs((b / a) ** 2 - 500 / 900) < 1e-9, 'areas 900 : 500');
});

test('proportional labels sit inside exactly the circles of their region', () => {
    for (const counts of [FIXTURES.lopsided, FIXTURES.gene_sets, FIXTURES.equal_sets]) {
        const plot = plotOf(counts);
        const fig = D.buildFigure(plot, LIGHT, { proportional: true });
        const cs = circlesOf(fig), t = fig.data[0];
        plot.shown.forEach((ri, n) => {
            const inside = cs.map(c => (Math.hypot(t.x[n] - (c.x0 + c.x1) / 2, t.y[n] - (c.y0 + c.y1) / 2) < (c.x1 - c.x0) / 2 ? 1 : 0));
            assert.deepEqual(inside, [...plot.regions[ri].key], `region ${ri}`);
        });
    }
});

test('a region too small to hold its label loses the label and keeps its hover, by the plot\'s size', () => {
    const plot = plotOf([10000, 10000, 5000, 10000, 5000, 5000, 1]);
    const wide = D.buildFigure(plot, LIGHT, { proportional: true, width: 1600, height: 1200 }).data[0];
    const narrow = D.buildFigure(plot, LIGHT, { proportional: true, width: 300, height: 220 }).data[0];
    assert.ok(wide.text.filter(Boolean).length > narrow.text.filter(Boolean).length, 'a larger plot holds more labels');
    assert.equal(narrow.text[6], '', 'the one-cell triple overlap has no room at 300 px');
    assert.equal(narrow.hovertext.length, 7, 'every region keeps its hover');
    assert.ok(narrow.hovertext[6].includes('1 cells'));
});

test('label modes: names off, and count, share, both or none in each region', () => {
    const plot = plotOf(FIXTURES.gene_sets);
    const annotated = (o) => D.buildFigure(plot, LIGHT, o).layout.annotations.filter(a => /^[ABC] · /.test(a.text));
    assert.equal(annotated({}).length, 3, 'names are on by default');
    assert.equal(annotated({ names: true }).length, 3);
    assert.equal(annotated({ names: false }).length, 0);
    for (const proportional of [false, true]) {
        const texts = (labels) => D.buildFigure(plot, LIGHT, { labels, proportional }).data[0].text;
        assert.ok(texts('none').every(t => t === ''));
        assert.ok(texts('count').filter(Boolean).every(t => /^[\d,]+$/.test(t)));
        assert.ok(texts('share').filter(Boolean).every(t => /^[\d.<]+%$/.test(t)));
        assert.ok(texts('both').filter(Boolean).every(t => /^[\d,]+<br>[\d.<]+%$/.test(t)));
        assert.ok(texts('count').filter(Boolean).length >= 5);
    }
    // the cells in no set are still stated, whatever the labels
    const none = D.buildFigure(plot, LIGHT, { labels: 'none', names: false });
    assert.ok(none.layout.annotations.some(a => a.text.includes('in no set')));
});

test('old configs are unchanged: no options, and the options that name the defaults, draw the fixed layout as before', () => {
    for (const k of [1, 2, 3]) {
        const plot = plotOf([120, 60, 40, 30, 25, 15, 10].slice(0, (1 << k) - 1), k);
        const before = D.buildFigure(plot, LIGHT);
        assert.deepEqual(D.buildFigure(plot, LIGHT, { labels: 'both', names: true, proportional: false }), before);
        assert.deepEqual(before.layout.xaxis.range, [-2.4, 2.4]);
        assert.deepEqual(before.layout.yaxis.range, [-2.0, 1.8]);
        assert.deepEqual(circlesOf(before).map(c => [c.x1 - c.x0, c.y1 - c.y0]), Array.from({ length: k }, () => [2, 2]));
        assert.equal(before.layout.margin.b, 16);
    }
    const three = D.buildFigure(plotOf(FIXTURES.lopsided), LIGHT);
    const centres = circlesOf(three).map(c => [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]);
    [[-0.55, 0.32], [0.55, 0.32], [0, -0.62]].forEach((want, i) => want.forEach((v, j) => assert.ok(Math.abs(centres[i][j] - v) < 1e-12)));
    assert.deepEqual(three.data[0].x, [-1.0, 1.0, 0, 0, -0.62, 0.62, 0]);
    assert.deepEqual(three.data[0].text.map(t => t.split('<br>')[0]), ['120', '60', '40', '30', '25', '15', '10']);
});

test('one set draws the same with area reflecting counts, and a Venn with no cells in any set falls back to the fixed layout', () => {
    const one = plotOf([800], 1);
    assert.deepEqual(circlesOf(D.buildFigure(one, LIGHT, { proportional: true })).map(c => c.x1 - c.x0), [2]);
    const empty = D.buildFigure(plotOf([0, 0, 0, 0, 0, 0, 0]), LIGHT, { proportional: true });
    assert.deepEqual(empty.layout.xaxis.range, [-2.4, 2.4]);
});
