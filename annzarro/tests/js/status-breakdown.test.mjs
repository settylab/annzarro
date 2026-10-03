/**
 * The status strip's breakdown (utils/coverage.js `breakdown`) over what a
 * cell plot really computes (plot-make.js `createFilterMask`, then
 * `classifyFilterStats`, `Coverage.merge` and `withSubsetCoverage`).
 *
 * The strip promises that its reasons add up: "28 of 200 cells shown" and
 * rows of 150 + 21 + 1 under it. The old widget and banner counted every
 * reason on its own, so a cell both NaN and outside the table filter was
 * counted twice and the rows did not sum to the total. Here every combination
 * of reasons -- per point, and per setting -- is swept, and each hidden point
 * must be counted exactly once, under the first reason that applies.
 *
 * Run:  node --test annzarro/tests/js/status-breakdown.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    addEventListener() {}, location: { href: 'http://localhost/' }, Config: {},
    getComputedStyle: () => ({ position: 'relative' })
};
function mkEl(tag) {
    return {
        tagName: tag, style: {}, dataset: {}, children: [], _attrs: {}, innerHTML: '', className: '',
        classList: { add() {}, remove() {} },
        appendChild(c) { this.children.push(c); return c; },
        insertBefore(c) { this.children.push(c); return c; },
        querySelectorAll: () => [], querySelector: () => null,
        remove() {}, setAttribute(k, v) { this._attrs[k] = v; }
    };
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

const { GAP, Coverage, classifyFilterStats, breakdown, compactCount, exactCount } =
    await import('../../../static/js/utils/coverage.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { createFilterMask, withSubsetCoverage } = await import(
    '../../../static/js/panels/plot-utilities/plot-make.js');

// Every point pattern: x missing, y missing, not in the table, colour NaN,
// colour outside [0, 10]. Two points of each, so 64.
const PATTERNS = [];
for (let m = 0; m < 32; m++) {
    const p = { xNaN: !!(m & 1), yNaN: !!(m & 2), outTable: !!(m & 4), cNaN: !!(m & 8), cOut: !!(m & 16) };
    if (p.cNaN && p.cOut) continue;          // a NaN colour is not also out of range
    PATTERNS.push(p, p);
}
const N = PATTERNS.length;
const CELLS = PATTERNS.map((_, i) => `c${i}`);

function panelData() {
    const inTable = PATTERNS.map(p => !p.outTable);
    return {
        entities: 'cells', cells: CELLS,
        x: { values: PATTERNS.map((p, i) => (p.xNaN ? NaN : i)), coverage: Coverage.complete(N, 'cells') },
        y: { values: PATTERNS.map((p, i) => (p.yNaN ? NaN : -i)), coverage: Coverage.complete(N, 'cells') },
        z: null,
        color: PATTERNS.map(p => (p.cNaN ? NaN : p.cOut ? 50 : 5)),
        colorType: 'numerical',
        tableEntities: new Set(CELLS.filter((_, i) => inTable[i])),
        tableFilterMask: inTable
    };
}

/** The first reason each point is hidden for, worked out from the patterns. */
function expected(s) {
    const counts = { coords: 0, table: 0, nan: 0, outliers: 0 };
    let drawn = 0;
    for (const p of PATTERNS) {
        // with a table filter the colour filters act on the table's points only
        const colourApplies = !s.table || !p.outTable;
        if (p.xNaN || p.yNaN) counts.coords++;
        else if (s.table && s.remove && p.outTable) counts.table++;
        else if (s.hideNaN && p.cNaN && colourApplies) counts.nan++;
        else if (s.hideOutliers && p.cOut && colourApplies) counts.outliers++;
        else drawn++;
    }
    return { counts, drawn };
}

function withSubset(outside, info, fn) {
    const saved = { getCellsNotInSubset: DataManager.getCellsNotInSubset, getSubset: DataManager.getSubset };
    Object.assign(DataManager, { getCellsNotInSubset: () => outside, getSubset: () => info });
    try { return fn(); } finally { Object.assign(DataManager, saved); }
}

const PART_INFO = { subset: { n: N, seed: 0 }, part: 1, parts: 4, n: N, n_total: 4 * N };

test('every combination of reasons: each hidden point counted once, and the rows add up', () => {
    let cases = 0;
    for (let m = 0; m < 32; m++) {
        const s = { table: !!(m & 1), remove: !!(m & 2), hideNaN: !!(m & 4), hideOutliers: !!(m & 8),
                    subset: !!(m & 16) };
        if (s.remove && !s.table) continue;
        const settings = {
            hideNaN: s.hideNaN, hideOutliers: s.hideOutliers, colorMin: 0, colorMax: 10,
            tableFilter: s.table ? 'cell-table-1' : 'none', removeNonTableEntries: s.remove, z: null
        };
        const data = panelData();
        const { indexMask, filterStats } = createFilterMask(data, settings);
        const outside = s.subset ? 3 * N : 0;
        const cov = withSubset(outside, s.subset ? PART_INFO : null, () => withSubsetCoverage(Coverage.merge([
            Coverage.complete(N, 'cells'), Coverage.complete(N, 'cells'),
            classifyFilterStats(filterStats, 'cells', { axisCoverage: { x: data.x.coverage, y: data.y.coverage } })
        ], 'cells')));
        const b = breakdown(cov);
        const want = expected(s);
        const label = JSON.stringify(s);

        assert.equal(indexMask.filter(Boolean).length, want.drawn, `${label}: points drawn`);
        assert.equal(b.shown, want.drawn, `${label}: the strip's shown is what is drawn`);
        assert.equal(b.total, N + outside, `${label}: the total is the dataset's`);
        assert.equal(b.rows.reduce((t, r) => t + r.count, 0), b.hidden, `${label}: the rows add up`);
        assert.equal(b.unattributed, 0, `${label}: no unattributed remainder`);
        const got = Object.fromEntries(b.rows.map(r => [r.kind, r.count]));
        for (const [kind, n] of Object.entries(want.counts)) {
            assert.equal(got[kind] || 0, n, `${label}: ${kind}`);
        }
        assert.equal(got.outside || 0, outside, `${label}: outside the subset`);
        if (s.subset) assert.equal(b.rows[0].chip, 'not in part 2 of 4', `${label}: the subset row comes first`);
        // one row per reason: nothing reported twice
        assert.equal(new Set(b.rows.map(r => r.kind)).size, b.rows.length, `${label}: no reason twice`);
        cases++;
    }
    assert.equal(cases, 24);
});

test('an axis whose loader already accounts for its blanks is not counted again', () => {
    // x loaded 150 of 200 (the rest failed): the filter must not add the same
    // 50 under "no coordinates" on top of the loader's own line
    const x = Coverage.partial(150, 200, GAP.FAILED, 'short read', { source: 'obs.x', unit: 'cells' });
    const stats = { total: 200, filtered: 50, xNaN: 50, yNaN: 0, zNaN: 0,
                    exclusive: { coords: 50, table: 0, nan: 0, outliers: 0 } };
    const cov = Coverage.merge([x, Coverage.complete(200, 'cells'),
                                classifyFilterStats(stats, 'cells', { axisCoverage: { x } })], 'cells');
    const b = breakdown(cov);
    assert.equal(b.hidden, 50);
    assert.deepEqual(b.rows.map(r => [r.reason, r.count]), [[GAP.FAILED, 50]]);
});

test('a colour that failed to read hides nothing: a note, not a counted row', () => {
    const colour = Coverage.missing(GAP.FAILED, 'boom', { source: 'obs.c', unit: 'cells', total: 200 }).asDescribing();
    const b = breakdown(Coverage.merge([Coverage.complete(200, 'cells'), colour], 'cells'));
    assert.equal(b.hidden, 0);
    assert.equal(b.rows.length, 0);
    assert.match(b.notes[0].label, /obs\.c: failed to read/);
    assert.equal(b.headline, '200 cells');
    assert.equal(b.severity, 'error');
});

test('a gap nobody accounts for is shown as such, never dropped', () => {
    const b = breakdown(new Coverage({ shown: 10, total: 50, unit: 'cells', gaps: [] }));
    assert.equal(b.unattributed, 40);
    assert.equal(b.rows.at(-1).reason, GAP.UNREPORTED);
    assert.equal(b.rows.reduce((t, r) => t + r.count, 0), b.hidden);
});

test('the strip counts are compact, the popover counts exact', () => {
    assert.equal(compactCount(99812), '99,812');
    assert.equal(compactCount(95624334), '95.6M');
    assert.equal(compactCount(95524522), '95.5M');
    assert.equal(compactCount(150_000_000), '150M');
    assert.equal(exactCount(95624334), '95,624,334');
    const cov = Coverage.complete(99812, 'cells').withOutside(95624334 - 99812, 'not in part 1 of 957');
    const b = breakdown(cov);
    assert.equal(b.headline, '99,812 of 95.6M cells shown');
    assert.equal(b.headlineExact, '99,812 of 95,624,334 cells shown');
    assert.equal(`${compactCount(b.rows[0].count)} ${b.rows[0].chip}`, '95.5M not in part 1 of 957');
    // two counts that would read the same are written out
    const near = breakdown(Coverage.complete(95624000, 'cells').withOutside(334, 'not in the cell subset'));
    assert.equal(near.headline, '95,624,000 of 95.6M cells shown');
});
