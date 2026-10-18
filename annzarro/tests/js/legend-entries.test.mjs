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
 * And the categories hidden with the legend stay hidden by category, not by
 * trace index, when a redraw adds, drops or moves traces (the 'Not in table'
 * trace of a table link, a category a filter empties).
 * Headless: annzarro/tests/browser/test_legend_hidden_table_filter.py.
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

const { isRealName, isLegendEntry, hasLegendEntries, withLegendInvariant, withLegendState, legendKey,
        legendUirevision, rememberLegendHidden } = await import('../../../static/js/utils/legend-entries.js');
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

// A categorical figure as processCategories draws it: the grey points first
// when a table link greys them out, a point trace and a legend proxy per category.
const REV = legendUirevision('ds.zarr', { type: 'obs', key: 'cell_type', column: '' });
const figure = (cats, { grey: withGrey = false } = {}) => withLegendProxies([
    ...(withGrey ? [{ type: 'scattergl', name: NOT_IN_TABLE, showlegend: false, marker: { color: '#ccc' }, x: [0] }] : []),
    ...cats.map(c => ({ type: 'scattergl', name: c, showlegend: true, marker: { color: '#f00' }, x: [1], customdata: [c] }))
], { pointSize: 3 });
const layout = (rev = REV) => ({ uirevision: 'ds.zarr', legend: { uirevision: rev } });
/** Draw `traces` into `gd` as Plotly.react would, after the legend state is applied. */
const draw = (gd, traces, lay = layout()) => { withLegendState(gd, traces, lay); gd.data = traces; gd.layout = lay; return traces; };
/** A legend click on `name`: Plotly toggles every trace of its legend group. */
const click = (gd, name) => {
    const hide = gd.data.find(t => t.legendgroup === name && t.showlegend !== false).visible !== 'legendonly';
    for (const t of gd.data) if (t.legendgroup === name) t.visible = hide ? 'legendonly' : true;
};
const hiddenOf = (traces) => traces.filter(t => t.visible === 'legendonly').map(t => `${t.meta}:${legendKey(t)}`).sort();

test('a hidden category stays hidden when the grey trace comes first and goes again', () => {
    const gd = {};
    draw(gd, figure(['A', 'B', 'C']));
    click(gd, 'B');
    for (let i = 0; i < 4; i++) {
        const traces = draw(gd, figure(['A', 'B', 'C'], { grey: i % 2 === 0 }));
        assert.deepEqual(hiddenOf(traces), ['az-legend:B', 'az-points:B'], `redraw ${i}`);
        if (i % 2 === 0) assert.equal(traces[0].name, NOT_IN_TABLE);
        assert.ok(traces.every(t => t.name !== NOT_IN_TABLE || t.visible === undefined), 'the grey points are never hidden');
    }
});

test('a hidden category a filter empties comes back hidden; a shown one comes back shown', () => {
    const gd = {};
    draw(gd, figure(['A', 'B', 'C']));
    click(gd, 'A');
    assert.deepEqual(hiddenOf(draw(gd, figure(['C'], { grey: true }))), []);
    assert.deepEqual(hiddenOf(draw(gd, figure(['B', 'C']))), []);
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'B', 'C']))), ['az-legend:A', 'az-points:A']);
    // shown again with the legend, it stays shown
    click(gd, 'A');
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'C'], { grey: true }))), []);
});

test('another colour column starts with nothing hidden; the same column keeps it', () => {
    const gd = {};
    draw(gd, figure(['A', 'B']));
    click(gd, 'A');
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'B']), layout(REV))), ['az-legend:A', 'az-points:A']);
    const other = legendUirevision('ds.zarr', { type: 'obs', key: 'leiden', column: '' });
    assert.notEqual(other, REV);
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'B']), layout(other))), []);
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'B']), layout(REV))), [], 'the old column\'s record is gone');
});

test('a graph released and drawn again keeps what its legend hid', () => {
    const gd = {};
    draw(gd, figure(['A', 'B']));
    click(gd, 'B');
    rememberLegendHidden(gd);            // releasePlot, before Plotly.purge
    delete gd.data; delete gd.layout;
    assert.deepEqual(hiddenOf(draw(gd, figure(['A', 'B']))), ['az-legend:B', 'az-points:B']);
});

test('every trace gets a uid from what it is: unique, and the same across redraws', () => {
    const gd = {};
    const focus = { type: 'scattergl', name: 'Focused Cell', showlegend: false, x: [1] };
    const first = draw(gd, [...figure(['A', 'B'], { grey: true }), { ...focus }]);
    const uids = first.map(t => t.uid);
    assert.equal(new Set(uids).size, uids.length, JSON.stringify(uids));
    for (const u of uids) assert.match(u, /^[A-Za-z0-9_-]+$/);
    // the same category has the same uid wherever its trace is
    const second = draw(gd, [...figure(['B'])]);
    assert.equal(second.find(t => t.name === 'B' && t.meta === 'az-points').uid,
                 first.find(t => t.name === 'B' && t.meta === 'az-points').uid);
    // a trace of one name keeps the uid of its name; chunks of one category are numbered
    assert.equal(first.find(t => t.name === NOT_IN_TABLE).uid, 't-Not_20_in_20_table');
    const chunks = draw({}, [{ name: 'A', legendgroup: 'A', meta: 'az-points', showlegend: false },
                            { name: 'A', legendgroup: 'A', meta: 'az-points', showlegend: false }]);
    assert.notEqual(chunks[0].uid, chunks[1].uid);
    // a uid given elsewhere stays
    assert.equal(draw({}, [{ name: 'x', uid: 'az1' }])[0].uid, 'az1');
    // the focus marker is never hidden with the legend
    click(gd, 'B');
    assert.equal(draw(gd, [...figure(['A', 'B']), { ...focus }]).find(t => t.name === 'Focused Cell').visible, undefined);
});
