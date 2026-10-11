/**
 * A text-valued axis is drawn, so it is counted as shown.
 *
 * `createFilterMask` asked `!isNaN(v)` of every axis value. isNaN('ENSG0001')
 * is true, so a gene plot with an Ensembl ID column as its x axis reported
 * "5,000 of 5,000 genes not shown: no x/y value" while Plotly drew all 5,000
 * on a category axis. Missing is null, undefined, NaN or ''; a label is a value.
 *
 * Run:  node --test annzarro/tests/js/axis-text-values.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { createFilterMask, hasAxisValue } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { classifyFilterStats } = await import('../../../static/js/utils/coverage.js');

const run = (entities, x, y) => {
    const n = x.length;
    const data = { entities, [entities]: x.map((_, i) => `e${i}`), x: { values: x }, y: { values: y },
        colorType: 'constant', color: null, tableEntities: null, tableFilterMask: null };
    return createFilterMask(data, { tableFilter: 'none', z: null, hideNaN: false });
};

test('hasAxisValue: labels, numbers and booleans are values; null, undefined, NaN and empty are not', () => {
    for (const v of ['ENSG00000001', 'nan', 'false', 0, -1.5, Infinity, true, false, 3]) assert.ok(hasAxisValue(v), String(v));
    for (const v of [null, undefined, NaN, '']) assert.ok(!hasAxisValue(v), String(v));
});

for (const entities of ['genes', 'cells']) {
    test(`${entities}: a string x axis with a numeric y axis shows every point`, () => {
        const ids = Array.from({ length: 50 }, (_, i) => `ENSG${String(i).padStart(11, '0')}`);
        const { indexMask, filterStats } = run(entities, ids, ids.map((_, i) => i * 0.5));
        assert.equal(filterStats.filtered, 0);
        assert.equal(filterStats.xNaN, 0);
        assert.ok(indexMask.every(Boolean));
        assert.equal(filterStats.shown, 50);
        const cov = classifyFilterStats(filterStats, entities);
        assert.equal(cov.shown, 50);
        assert.equal(cov.total, 50);
        assert.deepEqual(cov.gaps, []);
    });
}

test('a categorical (label) axis and a boolean axis (as the strings the loader makes) show every point', () => {
    const { filterStats } = run('cells', ['a', 'b', 'a', 'c'], ['true', 'false', 'true', 'false']);
    assert.equal(filterStats.filtered, 0);
});

test('numeric axes: NaN and null are missing, as before', () => {
    const { indexMask, filterStats } = run('cells', [1, NaN, 3, null], [1, 2, 3, 4]);
    assert.deepEqual(indexMask, [true, false, true, false]);
    assert.equal(filterStats.xNaN, 2);
    assert.equal(filterStats.exclusive.coords, 2);
});

test('text axes: only a missing label is missing', () => {
    const { indexMask, filterStats } = run('genes', ['a', null, '', NaN, 'b'], [1, 1, 1, 1, NaN]);
    assert.deepEqual(indexMask, [true, false, false, false, false]);
    assert.equal(filterStats.xNaN, 3);
    assert.equal(filterStats.yNaN, 1);
    const cov = classifyFilterStats(filterStats, 'genes');
    assert.equal(cov.shown, 1);
    assert.equal(cov.total, 5);
    assert.ok(cov.gaps.length > 0, 'the four missing points are said');
});
