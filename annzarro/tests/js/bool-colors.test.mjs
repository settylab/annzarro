/**
 * A boolean obs column coloured with its `uns/<col>_colors` (nexus #407).
 *
 * The server serves categories [false, true] for a boolean column, and
 * `uns/<col>_colors` is [colour_False, colour_True] (pandas' category order).
 * The plot used to order the categories by first appearance, so in a dataset
 * whose first cell is True the True cells got the False colour.
 *
 * Run:  node --test annzarro/tests/js/bool-colors.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: () => ({ position: 'relative' })
};
const created = [];
function mkEl(tag) {
    const el = {
        tagName: tag, style: {}, dataset: {}, children: [], _attrs: {},
        innerHTML: '', className: '',
        classList: { add() {}, remove() {} },
        appendChild(c) { this.children.push(c); return c; },
        insertBefore(c) { this.children.push(c); return c; },
        querySelectorAll: () => [], querySelector: () => null,
        remove() {}, setAttribute(k, v) { this._attrs[k] = v; }
    };
    created.push(el);
    return el;
}
globalThis.document = {
    createElement: mkEl, getElementById: () => null, body: mkEl('body'),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
const chain = new Proxy(function () {}, {
    get: (_t, p) => (p === 'length' ? 0 : p === Symbol.iterator ? [][Symbol.iterator] : () => chain),
    apply: () => chain
});
globalThis.jQuery = () => chain;
globalThis.$ = globalThis.jQuery;

const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { processCategories, isLegendProxy } = await import(
    '../../../static/js/panels/plot-utilities/plot-make-helper.js');

const FALSE_COLOUR = '#111111';
const TRUE_COLOUR = '#eeeeee';

/** Colour of every point of `labels` after the real load and trace builder. */
async function coloursOf(values, { served = [false, true], unsColors = [FALSE_COLOUR, TRUE_COLOUR] } = {}) {
    const CELLS = values.map((_, i) => `c${i}`);
    Object.assign(DataManager, {
        getCells: () => CELLS, getGenes: () => [],
        getCurrentDataset: () => '/fixture.zarr',
        getDatasetStructure: async () => null,
        loadObs: async ({ columns }) => ({
            data: { [columns[0]]: values },
            ...(served ? { categories: { [columns[0]]: served } } : {})
        })
    });
    const series = await loadAxisData({ type: 'obs', key: 'flag' }, 'cells', null, { role: 'colour', panel: {} });
    assert.equal(series.type, 'categorical');
    const data = {
        entities: 'cells', cells: CELLS,
        x: { values: CELLS.map((_, i) => i) }, y: { values: CELLS.map((_, i) => -i) },
        color: series.values, colorType: series.type, colorCategories: series.categories
    };
    const catValues = data.colorCategories || [...new Set(data.color)];
    const settings = { categoryPalette: 'uns', tableFilter: 'none', z: null };
    const traces = processCategories(settings, data, catValues, unsColors).filter(t => !isLegendProxy(t));
    const byLabel = {};
    for (const t of traces) {
        assert.equal(typeof t.name, 'string', 'legend names stay text, as before');
        byLabel[t.name] = t.marker.color;
    }
    return byLabel;
}

test('first cell True: True cells take the second uns colour', async () => {
    const colours = await coloursOf([true, true, false, true, false]);
    assert.equal(colours.true, TRUE_COLOUR);
    assert.equal(colours.false, FALSE_COLOUR);
});

test('first cell False: unchanged', async () => {
    const colours = await coloursOf([false, true, true, false]);
    assert.equal(colours.true, TRUE_COLOUR);
    assert.equal(colours.false, FALSE_COLOUR);
});

test('an all-True column is still the second colour', async () => {
    const colours = await coloursOf([true, true, true]);
    assert.deepEqual(Object.keys(colours), ['true']);
    assert.equal(colours.true, TRUE_COLOUR);
});

test('a missing value in a nullable boolean column is not a category', async () => {
    const colours = await coloursOf([true, null, false, true]);
    assert.equal(colours.true, TRUE_COLOUR);
    assert.equal(colours.false, FALSE_COLOUR);
});

test('no uns colours: the default palette still colours both values', async () => {
    const colours = await coloursOf([true, false, true], { unsColors: null });
    assert.ok(colours.true && colours.false);
    assert.notEqual(colours.true, colours.false);
});

test('an older server without categories still draws both values', async () => {
    const colours = await coloursOf([true, false], { served: null, unsColors: null });
    assert.ok(colours.true && colours.false);
});
