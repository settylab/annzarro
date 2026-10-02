/**
 * Legends must be readable and stay off the colour bar.
 *
 * From the paper's screenshot run, confirmed headless on demo view E: the
 * 'Not in table' legend entry of a table-filtered, numerically coloured
 * UMAP was drawn on top of the colour bar's title (legend and colour bar
 * both default to the right edge), and categorical legend symbols were
 * drawn at the 3 px point size.
 *
 * Run:  node --test annzarro/tests/js/legend-placement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

const { legendPlacement, getPositioningByLocation } = await import('../../../static/js/panels/plot-utilities/plot-aesthetics-menu.js');
const { createLayout } = await import('../../../static/js/panels/plot-utilities/plot-make-helper.js');
const right = getPositioningByLocation('right');

const notInTable = { name: 'Not in table', marker: { color: 'rgba(180,180,180,1)' }, showlegend: true };
const inTable = { name: 'kompot_da', marker: { colorscale: 'RdBu', showscale: true }, showlegend: false };
const focused = { name: 'Focused Cell', marker: { color: 'red' }, showlegend: false };

test('legend entries beside a colour bar move above the plot', () => {
    const place = legendPlacement([notInTable, inTable, focused], right);
    assert.equal(place['legend.orientation'], 'h');
    assert.equal(place['legend.yanchor'], 'bottom');
    assert.ok(place['legend.y'] >= 1);
});

test('a categorical plot (no colour bar) keeps the configured position', () => {
    const cats = [{ name: 'HSC', marker: { color: '#f00' } }, { name: 'GMP', marker: { color: '#0f0' } }];
    assert.equal(legendPlacement(cats, right)['legend.x'], right.legendX);
    assert.equal(legendPlacement(cats, right)['legend.orientation'], 'v');
});

test('a colour bar alone keeps the configured position too', () => {
    assert.equal(legendPlacement([inTable, focused], right)['legend.x'], right.legendX);
});

test('legend symbols are drawn at a constant size', () => {
    const layout = createLayout({ x: { type: 'obsm', key: 'X_umap', column: 0 }, y: { type: 'obsm', key: 'X_umap', column: 1 }, z: null, showGrid: true });
    assert.equal(layout.legend.itemsizing, 'constant');
});
