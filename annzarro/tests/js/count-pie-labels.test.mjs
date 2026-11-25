/**
 * A pie's numbers sit at one radius (operator, 0.8.0): "all numbers should stay at the same radius", whether Ring is on
 * or not. Plotly's inside text moved the largest slice's number with Ring; the numbers are now a text layer of their own,
 * each at its slice's middle angle and at the middle of a ring's band (the same fraction of the radius in a full pie).
 *
 * Run:  node --test annzarro/tests/js/count-pie-labels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/count-plot-model.js');
const D = await import('../../../static/js/panels/cell-count/draw.js');
const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const WORDS = { count: 'Cells', fill: '%', hoverCount: 'Cells', hoverShare: 'Share', share: () => '' };

/** A pie whose first slice dominates (85%), then two smaller ones and two under 3%. */
function pie(stored) {
    const config = M.normalizeCountPlot({ version: 1, mode: 'pie', x: { source: { type: 'obs', key: 'k' } }, labels: 'count', ...stored }).config;
    const counts = [850, 70, 50, 20, 10];
    const reply = { reply: { n_counted: 1000, n_shown: 1000, axes: [{ levels: ['c:a', 'c:b', 'c:c', 'c:d', 'c:e'], n_outside: [0, 0] }] }, counts, measures: null };
    const table = M.countTable(config, M.readGrid(reply), [{ input: 'x' }]);
    return D.countFigure(config, table, { options: K.drawOptions(config), words: WORDS, inputNames: { x: 'k' }, palette: ['#111111'], theme: PLOT_PALETTES.light });
}

/** The numbers: their radius and angle each, as placed (x = r sin θ, y = r cos θ on axes of the pie's radius). */
const labelsOf = (f) => {
    const notes = (f.layout.annotations || []).filter((a) => a.name === 'pie-label');
    if (!notes.length) return undefined;
    const x = notes.map((a) => a.x);
    const y = notes.map((a) => a.y);
    return { notes, x, y, text: notes.map((a) => a.text), r: x.map((v, i) => Math.hypot(v, y[i])),
        theta: x.map((v, i) => ((Math.atan2(v, y[i]) * 180) / Math.PI + 360) % 360) };
};

test('every number is at one radius, and Ring moves none: the dominant slice\'s included', () => {
    const full = pie({});
    const ring = pie({ ring: true });
    assert.equal(full.data[0].textinfo, 'none', 'no Plotly inside text, which picks a place per slice');
    const a = labelsOf(full);
    const b = labelsOf(ring);
    assert.ok(a && b, 'the numbers are placed by the plot, not by Plotly\'s inside text');
    assert.ok(a.notes.every((n) => n.xref === 'x' && n.yref === 'y' && n.xanchor === 'center' && n.yanchor === 'middle' && !n.showarrow));
    assert.ok(a.r.every((r) => Math.abs(r - 0.75) < 1e-12), 'one radius for every slice: the middle of the ring\'s band (hole 0.5)');
    assert.deepEqual([a.x, a.y], [b.x, b.y], 'the same places with and without Ring');
    assert.equal(ring.data[0].hole, 0.5);
});

test('each number is at its slice\'s middle angle, clockwise from 12 o\'clock as the pie draws it', () => {
    const f = pie({});
    const t = labelsOf(f);
    assert.deepEqual(t.text, ['850', '70', '50'], 'a slice under 3% (2%, 1%) shows its number in its hover only');
    const mids = [425, 850 + 35, 920 + 25].map((v) => (v / 1000) * 360);
    t.theta.forEach((theta, i) => assert.ok(Math.abs(theta - mids[i]) < 1e-9, `slice ${i}`));
    assert.equal(f.data[0].direction, 'clockwise');
    assert.equal(f.data[0].rotation, 0);
    // the layer's axes: one scale, -1 to 1, the pie's radius, and nothing to zoom
    assert.deepEqual([f.layout.xaxis.range, f.layout.yaxis.range, f.layout.yaxis.scaleanchor], [[-1, 1], [-1, 1], 'x']);
    assert.equal(f.layout.xaxis.fixedrange && f.layout.yaxis.fixedrange, true);
    assert.equal(f.data[0].hoverinfo, 'text', 'the hover is the pie\'s, unchanged');
    assert.ok(f.data.slice(1).every((d) => d.hoverinfo === 'skip' && d.showlegend === false), 'the axes\' trace hovers and lists nothing');
});

test('no numbers asked for: no layer', () => {
    assert.equal(labelsOf(pie({ labels: 'none' })), undefined);
    const share = labelsOf(pie({ labels: 'share' }));
    assert.equal(share.text[0], '0.85');
});
