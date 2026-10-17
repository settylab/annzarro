/**
 * No legend entry without a name, and no legend without an entry.
 *
 * Reported: a plot coloured by nothing (a colour column the dataset does not
 * have after a switch, or no colour) showed a grey "trace 0" in its legend
 * after an axis change, and lost it on a refresh. The update that follows an
 * axis change applies the plot options, whose legend step gave every trace
 * without a colour scale an entry, and turned the legend on: the unnamed grey
 * trace became Plotly's "trace 0". A full draw does not apply them.
 * Headless: annzarro/tests/browser/test_no_unnamed_legend.py.
 *
 * Run:  node --test annzarro/tests/js/legend-entries.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [],
    documentElement: { getAttribute: () => null, dataset: {} }
};
const calls = [];
globalThis.Plotly = new Proxy({}, {
    get: (_, fn) => (gd, ...args) => { calls.push([fn, ...args]); return Promise.resolve(gd); }
});

const { isRealName, isLegendEntry, hasLegendEntries, withLegendInvariant } =
    await import('../../../static/js/utils/legend-entries.js');
const { applyAllAestheticSettings } = await import('../../../static/js/panels/plot-utilities/plot-aesthetics-menu.js');
const { POINTS, NOT_IN_TABLE, withLegendProxies } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');

const grey = { type: 'scattergl', mode: 'markers', name: POINTS, showlegend: false,
               marker: { color: 'rgba(150, 150, 150, 1.)' }, x: [1], y: [1] };
const AXES = { x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' }, z: null,
               color: { type: 'none', key: '', column: '' }, legendPosition: 'right' };
const focused = { type: 'scattergl', name: 'Focused Cell', showlegend: false, marker: { color: 'red' }, x: [1], y: [1] };

test('a name a legend can show: not empty, not Plotly\'s default', () => {
    assert.equal(isRealName('HSC'), true);
    assert.equal(isRealName(POINTS), true);
    for (const n of [undefined, null, '', 'trace 0', 'trace 12', 3]) assert.equal(isRealName(n), false, String(n));
    assert.equal(isRealName('trace 0 cells'), true);
});

test('a legend entry is named and not hidden from the legend', () => {
    assert.equal(isLegendEntry({ name: 'HSC' }), true);                       // Plotly's default showlegend
    assert.equal(isLegendEntry({ name: 'HSC', showlegend: true }), true);
    assert.equal(isLegendEntry({ name: 'HSC', showlegend: true, visible: 'legendonly' }), true);
    assert.equal(isLegendEntry({ name: 'HSC', showlegend: true, visible: false }), false);
    assert.equal(isLegendEntry({ showlegend: true }), false);
    assert.equal(isLegendEntry(grey), false);
    assert.equal(isLegendEntry(null), false);
    assert.equal(hasLegendEntries([grey, focused]), false);
    assert.equal(hasLegendEntries([]), false);
    assert.equal(hasLegendEntries(undefined), false);
});

test('the categories of a categorical plot are the legend', () => {
    const cats = withLegendProxies([
        { type: 'scattergl', name: NOT_IN_TABLE, showlegend: false, marker: { color: '#ccc' } },
        { type: 'scattergl', name: 'k0', showlegend: true, marker: { color: '#f00' } },
        { type: 'scattergl', name: 'k1', showlegend: true, marker: { color: '#0f0' } }
    ], { pointSize: 3 });
    assert.deepEqual(cats.filter(isLegendEntry).map(t => t.name), ['k0', 'k1']);
});

test('an unnamed trace drawn is hidden from the legend, with a warning', (t) => {
    const warned = [];
    t.mock.method(console, 'warn', (m) => warned.push(m));
    const traces = [{ type: 'scattergl', x: [1], y: [1], showlegend: true }, { name: 'trace 1', x: [1] }, focused];
    const layout = { showlegend: true };
    withLegendInvariant(traces, layout);
    assert.deepEqual(traces.map(tr => tr.showlegend), [false, false, false]);
    assert.equal(layout.showlegend, false);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /trace 0, 1 has no name/);
});

test('a figure with legend entries keeps its showlegend, and nothing is said', (t) => {
    const warned = [];
    t.mock.method(console, 'warn', (m) => warned.push(m));
    for (const showlegend of [true, false, undefined]) {
        const layout = showlegend === undefined ? {} : { showlegend };
        withLegendInvariant([{ name: 'k0', showlegend: true }, grey], layout);
        assert.equal(layout.showlegend, showlegend);
    }
    const layout = { showlegend: true };
    withLegendInvariant([grey, focused], layout);
    assert.equal(layout.showlegend, false);
    assert.deepEqual(warned, []);
});

test('the plot options leave a plot coloured by nothing without a legend', () => {
    // the call at the end of every incremental update (plot-update.js)
    const gd = { data: [{ ...grey }, { ...focused }], layout: {}, _fullLayout: {} };
    calls.length = 0;
    applyAllAestheticSettings(gd, { ...AXES, showLegend: true });
    const relayouts = calls.filter(c => c[0] === 'relayout').map(c => c[1]);
    const shown = relayouts.filter(u => 'showlegend' in u).map(u => u.showlegend);
    assert.ok(shown.length > 0, 'the legend is set');
    assert.ok(shown.every(v => v === false), `showlegend ${JSON.stringify(shown)}`);
    const restyled = calls.filter(c => c[0] === 'restyle').map(c => c[1]);
    assert.ok(restyled.every(u => u.showlegend !== true), JSON.stringify(restyled));
});

test('the plot options show the legend of a categorical plot', () => {
    const cats = withLegendProxies([{ type: 'scattergl', name: 'k0', showlegend: true, marker: { color: '#f00' } }],
                                   { pointSize: 3 });
    const gd = { data: cats, layout: {}, _fullLayout: {} };
    calls.length = 0;
    applyAllAestheticSettings(gd, { ...AXES, showLegend: true });
    const shown = calls.filter(c => c[0] === 'relayout' && 'showlegend' in c[1]).map(c => c[1].showlegend);
    assert.ok(shown.length > 0 && shown.every(v => v === true), JSON.stringify(shown));
    calls.length = 0;
    applyAllAestheticSettings(gd, { ...AXES, showLegend: false });
    const hidden = calls.filter(c => c[0] === 'relayout' && 'showlegend' in c[1]).map(c => c[1].showlegend);
    assert.ok(hidden.length > 0 && hidden.every(v => v === false), JSON.stringify(hidden));
});
