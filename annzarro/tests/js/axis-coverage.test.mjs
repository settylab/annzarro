/**
 * The PLOT's real loader, executed.
 *
 * ## Why this suite exists, and why it is separate from table-coverage.test.mjs
 *
 * `table-coverage.test.mjs` asserts that `loadTableData`'s verdict equals
 * `classifyColumn`'s. That compares the table's CODE PATH against the plot's
 * CLASSIFIER -- not against the plot's code path. The distinction is not
 * pedantic: `classifyColumn` has exactly one call site per surface, in the
 * `obs`/`var` arm, and every other column type decides its verdict before
 * reaching any shared code. So that suite could be, and was, fully green while
 * the plot and the table gave opposite reasons at opposite severities for
 * `obsm`, `obsp` and `layer`.
 *
 * It was also green while `loadAxisData`'s catch block could not execute at
 * all. Four bindings the catch reads were `let`/`const` INSIDE the `try`, so
 * every plot-axis error not already carrying a `.coverage` threw
 * `ReferenceError: coverage is not defined` -- on exactly the paths
 * `classifyError` exists for. It shipped in four commits through two review
 * rounds. `node --check` passes on it; ESLint's `no-undef` catches it, and
 * `npm run lint` / annzarro/tests/static/test_eslint.py now run ESLint.
 *
 * The reason no test caught it is structural: `plot-make.js` touched `window`
 * at module scope, so the module threw on import under `node` and no test could
 * reach the function however it was written. That touch is now guarded, and
 * this file is the point of the guard -- it imports the real module and calls
 * the real `loadAxisData`.
 *
 * Run:  node --test annzarro/tests/js/axis-coverage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser surface. plot-make.js reaches for `window` once at module
// scope (guarded) and `document` through its loading indicator; neither is
// exercised by the loader paths under test.
globalThis.window = globalThis.window || {
    addEventListener() {}, location: { href: 'http://localhost/' }
};
globalThis.document = globalThis.document || {
    createElement: () => ({
        style: {}, classList: { add() {}, remove() {} },
        appendChild() {}, querySelectorAll: () => [], remove() {}
    }),
    body: { appendChild() {} }
};

const { GAP, Coverage, classifyMatrixColumn } = await import('../../../static/js/utils/coverage.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData } = await import(
    '../../../static/js/panels/plot-utilities/plot-make.js');
const { loadTableData } = await import(
    '../../../static/js/panels/table-utilities/table-data.js');

const N = 200;
const CELLS = Array.from({ length: N }, (_, i) => `c${i}`);
const GENES = ['g0', 'g1', 'g2'];

function stubDataManager({ entityIndex = -1 } = {}) {
    const saved = { ...DataManager };
    Object.assign(DataManager, {
        getCells: () => CELLS,
        getGenes: () => GENES,
        getCurrentDataset: () => '/fixture.zarr',
        getCellIndex: () => entityIndex,
        getGeneIndex: () => entityIndex,
        getFocusedCell: () => 'c0',
        getFocusedGene: () => 'g0'
    });
    return () => Object.assign(DataManager, saved);
}

/** Run one condition through BOTH real loaders and return both verdicts. */
async function bothSurfaces({ settings, tableColumn, patch, entityIndex }) {
    const restore = stubDataManager({ entityIndex });
    try {
        Object.assign(DataManager, patch);
        let plot;
        try {
            plot = (await loadAxisData(settings, 'cells', null)).coverage;
        } catch (e) {
            if (e instanceof ReferenceError || /is not defined/.test(e.message)) {
                assert.fail(`loadAxisData CRASHED: ${e.message}`);
            }
            plot = e.coverage;
        }
        const table = (await loadTableData({ columns: [tableColumn] }, 'cells')).coverage;
        return { plot, table };
    } finally { restore(); }
}

/* ------------------------------------------------------------------ *
 * The six conditions. Three of them used to diverge.                  *
 * ------------------------------------------------------------------ */

const CONDITIONS = [
    {
        name: 'obs: key ABSENT from the response body',
        reason: GAP.UNAVAILABLE,
        settings: { type: 'obs', key: 'celltype' },
        tableColumn: { type: 'obs', key: 'celltype' },
        patch: { loadObs: async () => ({ data: {} }) }
    },
    {
        name: 'obs: key PRESENT but empty (the 2026-08-28 incident shape)',
        reason: GAP.FAILED,
        settings: { type: 'obs', key: 'celltype' },
        tableColumn: { type: 'obs', key: 'celltype' },
        patch: { loadObs: async () => ({ data: { celltype: [] } }) }
    },
    {
        name: 'obsm: 200 with "data": [] -- the KEY is absent',
        reason: GAP.UNAVAILABLE,
        settings: { type: 'obsm', key: 'X_umap', column: 0 },
        tableColumn: { type: 'obsm', key: 'X_umap', column: 0 },
        patch: { loadObsm: async () => ({ data: [] }) }
    },
    {
        name: 'obsm: a full-length column of nulls',
        reason: GAP.EMPTY,
        settings: { type: 'obsm', key: 'X_umap', column: 0 },
        tableColumn: { type: 'obsm', key: 'X_umap', column: 0 },
        patch: { loadObsm: async () => ({ data: Array(N).fill(null) }) }
    },
    {
        name: 'obsp: the named cell is not in this dataset',
        reason: GAP.UNAVAILABLE,
        entityIndex: -1,
        settings: { type: 'obsp', key: 'connectivities', column: 'cell_from_old_dataset' },
        tableColumn: { type: 'obsp', key: 'connectivities', column: 'cell_from_old_dataset' },
        patch: { loadObsp: async () => ({ data: [Array(N).fill(1)] }) }
    },
    {
        name: 'layer: the named gene is not in this dataset',
        reason: GAP.UNAVAILABLE,
        entityIndex: -1,
        settings: { type: 'layer', key: 'X', column: 'GENE_NOT_HERE' },
        tableColumn: { type: 'layer', key: 'X', column: 'GENE_NOT_HERE' },
        patch: { loadLayer: async () => ({ data: Array(N).fill(1) }) }
    }
];

for (const c of CONDITIONS) {
    test(`plot and table agree -- ${c.name}`, async () => {
        const { plot, table } = await bothSurfaces(c);
        assert.equal(plot.worstReason, c.reason,
            `plot said "${plot.worstReason}"`);
        assert.equal(table.worstReason, c.reason,
            `table said "${table.worstReason}" where the plot said "${plot.worstReason}"`);
        assert.equal(plot.describe().severity, table.describe().severity,
            'opposite severities for one condition is the defect this suite exists for');
    });
}

/* ------------------------------------------------------------------ *
 * The catch block must EXECUTE. Five ordinary failures.               *
 * ------------------------------------------------------------------ */

const FAILURES = [
    ['HTTP 500', GAP.FAILED,
        Object.assign(new Error('Internal Server Error'), { status: 500 })],
    ['a cap rejection', GAP.CAPPED,
        Object.assign(new Error('Too many cells requested (max 300000)'),
            { status: 400, data: { reason: 'cap_exceeded' } })],
    ['a 404', GAP.UNAVAILABLE,
        Object.assign(new Error('Dataset not found: /fixture.zarr'),
            { status: 404, data: { reason: 'not_found' } })],
    ['a network drop', GAP.FAILED, new TypeError('Failed to fetch')]
];

for (const [name, reason, thrown] of FAILURES) {
    test(`loadAxisData classifies ${name} instead of crashing`, async () => {
        const restore = stubDataManager();
        try {
            DataManager.loadObs = async () => { throw thrown; };
            await assert.rejects(
                () => loadAxisData({ type: 'obs', key: 'celltype' }, 'cells', null),
                (err) => {
                    assert.ok(!(err instanceof ReferenceError),
                        `the catch block threw ${err.message} -- its bindings are `
                        + 'out of scope again; keep them declared OUTSIDE the try');
                    assert.ok(err.coverage, 'the error must carry a classification');
                    assert.equal(err.coverage.worstReason, reason);
                    // plot-make.js keys its axis-specific troubleshooting hints
                    // on this substring. A ReferenceError replaced it and the
                    // whole hints block -- including the stale-focused-cell
                    // advice -- silently stopped rendering.
                    assert.match(err.message, /Failed to load data for/,
                        'the hints block downstream keys on this substring');
                    return true;
                }
            );
        } finally { restore(); }
    });
}

test('an unknown axis type is classified, not crashed on', async () => {
    const restore = stubDataManager();
    try {
        await assert.rejects(
            () => loadAxisData({ type: 'nonsense', key: 'k' }, 'cells', null),
            (err) => {
                assert.ok(!(err instanceof ReferenceError), err.message);
                assert.ok(err.coverage);
                assert.match(err.message, /Failed to load data for/);
                return true;
            }
        );
    } finally { restore(); }
});

/* ------------------------------------------------------------------ *
 * The plot must not be SILENT on an all-blank column.                 *
 * ------------------------------------------------------------------ */

test('the plot states an all-blank obsp/layer column rather than drawing nothing', async () => {
    // These arms normalise null -> NaN to preserve array length BEFORE
    // classification, which defeated a blank check written for null/undefined
    // only: the table said "every entry is blank" and the plot rendered an
    // empty scatter and said nothing. A complete coverage renders NO notice.
    for (const [label, settings, patch] of [
        ['obsp', { type: 'obsp', key: 'conn', column: 'c0' },
            { loadObsp: async () => ({ data: [Array(N).fill(null)] }) }],
        ['layer', { type: 'layer', key: 'X', column: 'g0' },
            { loadLayer: async () => ({ data: Array(N).fill(null) }) }]
    ]) {
        const restore = stubDataManager({ entityIndex: 0 });
        try {
            Object.assign(DataManager, patch);
            const cov = (await loadAxisData(settings, 'cells', null)).coverage;
            assert.equal(cov.isComplete, false,
                `${label}: a complete coverage renders no notice, so the panel is silent`);
            assert.equal(cov.worstReason, GAP.EMPTY);
            assert.match(cov.lines()[0], /blank/);
        } finally { restore(); }
    }
});

test('a healthy axis still reports complete', async () => {
    const restore = stubDataManager();
    try {
        DataManager.loadObs = async () => ({ data: { celltype: Array(N).fill('T') } });
        const cov = (await loadAxisData({ type: 'obs', key: 'celltype' }, 'cells', null)).coverage;
        assert.equal(cov.isComplete, true);
        assert.deepEqual(cov.lines(), []);
    } finally { restore(); }
});

/* ------------------------------------------------------------------ *
 * A missing FOCUS must not fail the plot load.                        *
 *                                                                     *
 * An obsp/varp/layer column is measured relative to a focused cell or  *
 * gene. When that entity is unavailable, the data for the column       *
 * itself is fine -- only the reference is missing. It used to `throw`, *
 * which failed the whole panel and rendered a red "Error loading data" *
 * box with troubleshooting hints, for a known and expected condition.  *
 * Reported from the field on obsp.context_fn_ls1.                      *
 * ------------------------------------------------------------------ */

const FOCUS_CASES = [
    {
        name: 'obsp, a cell name left over from another dataset',
        settings: { type: 'obsp', key: 'context_fn_ls1', column: 'cell_from_old_dataset' },
        patch: { loadObsp: async () => ({ data: [Array(N).fill(0.5)] }) },
        reason: GAP.UNAVAILABLE, severity: 'warning', match: /not in this dataset/
    },
    {
        name: 'obsp, nothing focused at all',
        settings: { type: 'obsp', key: 'context_fn_ls1' },
        patch: { loadObsp: async () => ({ data: [Array(N).fill(0.5)] }) },
        reason: GAP.UNFOCUSED, severity: 'notice', match: /none is focused yet/
    },
    {
        name: 'varp, nothing focused at all',
        settings: { type: 'varp', key: 'gene_graph' },
        patch: { loadVarp: async () => ({ data: [Array(N).fill(0.5)] }) },
        reason: GAP.UNFOCUSED, severity: 'notice', match: /none is focused yet/
    },
    {
        name: 'layer keyed on a gene this dataset does not have',
        settings: { type: 'layer', key: 'X', column: 'GENE_NOT_HERE' },
        patch: { loadLayer: async () => ({ data: Array(N).fill(1) }) },
        reason: GAP.UNAVAILABLE, severity: 'warning', match: /not in this dataset/
    }
];

for (const c of FOCUS_CASES) {
    test(`a missing focus renders the plot rather than failing it -- ${c.name}`, async () => {
        const restore = stubDataManager({ entityIndex: -1 });
        try {
            Object.assign(DataManager, c.patch);
            // The load RESOLVES. If this throws, the panel is a red error box.
            const series = await loadAxisData(c.settings, 'cells', null);

            assert.equal(series.values.length, N,
                'the series keeps full length so downstream length invariants hold');
            assert.ok(series.values.every(v => typeof v === 'number' && Number.isNaN(v)),
                'and is blank, so nothing is drawn for it');
            assert.equal(series.coverage.worstReason, c.reason);
            assert.equal(series.coverage.describe().severity, c.severity,
                'visible, but not alarming: this is not a read failure');
            assert.match(series.coverage.lines()[0], c.match);
        } finally { restore(); }
    });
}

test('"nothing focused" and "focused thing is absent" are different reasons', async () => {
    // `cellIndex === -1` collapses them; they are not the same condition and
    // do not have the same consequence for the reader. Folding the second into
    // UNAVAILABLE produced the sentence "not in this dataset -- no cell is
    // focused", which is incoherent.
    const restore = stubDataManager({ entityIndex: -1 });
    try {
        DataManager.loadObsp = async () => ({ data: [Array(N).fill(1)] });
        const stale = (await loadAxisData(
            { type: 'obsp', key: 'k', column: 'c_from_old' }, 'cells', null)).coverage;
        const none = (await loadAxisData(
            { type: 'obsp', key: 'k' }, 'cells', null)).coverage;
        assert.notEqual(stale.worstReason, none.worstReason);
        assert.equal(stale.worstReason, GAP.UNAVAILABLE);
        assert.equal(none.worstReason, GAP.UNFOCUSED);
        assert.doesNotMatch(none.lines()[0], /not in this dataset/,
            'the label must not contradict the detail');
    } finally { restore(); }
});

test('a missing focus in the COLOUR slot leaves every point on screen', async () => {
    // The slot decides the role, not the condition: colour DESCRIBES points
    // Plotly draws anyway, so the panel is complete and merely uncoloured.
    // As an x/y/z contributor the same series RESTRICTS and "no cells shown"
    // is then the truth. Both are checked here because getting one right and
    // the other wrong is exactly the B1 shape.
    const restore = stubDataManager({ entityIndex: -1 });
    try {
        DataManager.loadObsp = async () => ({ data: [Array(N).fill(1)] });
        const cov = (await loadAxisData(
            { type: 'obsp', key: 'k', column: 'c_from_old' }, 'cells', null)).coverage;

        const asColour = Coverage.merge(
            [Coverage.complete(N, 'cells'), Coverage.complete(N, 'cells'), cov.asDescribing()],
            'cells');
        assert.equal(asColour.shown, N, 'every point is still drawn');
        assert.doesNotMatch(asColour.headline(), /^No cells shown/);
        assert.match(asColour.lines()[0], /not in this dataset/, 'and the reason is still stated');

        const asAxis = Coverage.merge([cov, Coverage.complete(N, 'cells')], 'cells');
        assert.equal(asAxis.shown, 0);
        assert.match(asAxis.headline(), /^No cells shown/);
    } finally { restore(); }
});

test('a focus that IS present still loads normally', async () => {
    const restore = stubDataManager({ entityIndex: 3 });
    try {
        DataManager.loadObsp = async () => ({ data: [Array(N).fill(0.25)] });
        const series = await loadAxisData(
            { type: 'obsp', key: 'k', column: 'c3' }, 'cells', null);
        assert.equal(series.coverage.isComplete, true);
        assert.equal(series.values.length, N);
        assert.ok(series.values.every(v => v === 0.25));
    } finally { restore(); }
});

/* ------------------------------------------------------------------ *
 * The VALID-INDEX / EMPTY-BODY family.                                *
 *                                                                     *
 * The previous round routed obsm through the shared matrix rule and    *
 * left the plot's four other hand-built sites alone, so the boundary   *
 * MOVED rather than closed: the conditions the fix reached agreed and  *
 * the ones immediately past it did not. A condition matrix built from  *
 * a reviewer's list inherits that list's boundary, so these rows are   *
 * deliberately the ones just outside the six above -- the named entity *
 * RESOLVES, and it is the matrix key that does not.                    *
 *                                                                     *
 * Measured read-only against the live service: a missing obsp, varp,   *
 * layer, varm or obsm key all answer `200 {"data": []}` -- the same    *
 * body. So one rule has to cover all of them.                          *
 * ------------------------------------------------------------------ */

const RESIDUE = [
    {
        name: 'obsp, valid cell index, empty body',
        settings: { type: 'obsp', key: 'conn', column: 'c0' },
        tableColumn: { type: 'obsp', key: 'conn', column: 'c0' },
        patch: { loadObsp: async () => ({ data: [] }) },
        entityIndex: 0, reason: GAP.UNAVAILABLE
    },
    {
        name: 'obsp, valid cell index, a single EMPTY row',
        settings: { type: 'obsp', key: 'conn', column: 'c0' },
        tableColumn: { type: 'obsp', key: 'conn', column: 'c0' },
        patch: { loadObsp: async () => ({ data: [[]] }) },
        entityIndex: 0, reason: GAP.UNAVAILABLE
    },
    {
        name: 'layer, valid gene, empty body',
        settings: { type: 'layer', key: 'X', column: 'g0' },
        tableColumn: { type: 'layer', key: 'X', column: 'g0' },
        patch: { loadLayer: async () => ({ data: [] }) },
        entityIndex: 0, reason: GAP.UNAVAILABLE
    },
    {
        name: 'layer, a body that is not an array at all (malformed, NOT key-absent)',
        settings: { type: 'layer', key: 'X', column: 'g0' },
        tableColumn: { type: 'layer', key: 'X', column: 'g0' },
        patch: { loadLayer: async () => ({ data: { nope: true } }) },
        entityIndex: 0, reason: GAP.FAILED
    },
    {
        name: 'obsm, a short read',
        settings: { type: 'obsm', key: 'X_umap', column: 0 },
        tableColumn: { type: 'obsm', key: 'X_umap', column: 0 },
        patch: { loadObsm: async () => ({ data: Array(10).fill(1) }) },
        reason: GAP.FAILED
    }
];

for (const c of RESIDUE) {
    test(`plot and table agree -- ${c.name}`, async () => {
        const { plot, table } = await bothSurfaces(c);
        assert.equal(plot.worstReason, c.reason, `plot said "${plot.worstReason}"`);
        assert.equal(table.worstReason, c.reason,
            `table said "${table.worstReason}" where the plot said "${plot.worstReason}"`);
        assert.equal(plot.describe().severity, table.describe().severity);
        assert.deepEqual(plot.lines(), table.lines(),
            'the two surfaces must give the user the same sentence');
    });
}

test('an empty ARRAY means key-absent; a non-array body means malformed', () => {
    // These are different claims about the server's answer and must not be
    // collapsed: `{"data": []}` is the measured shape for an absent key, while
    // a non-array body says nothing of the kind. Collapsing them had
    // classifyMatrixColumn assert "the key is absent" about a response that
    // never said so.
    const opts = { expected: 100, unit: 'cells', source: 's', key: 'k' };
    assert.equal(classifyMatrixColumn({ ...opts, values: [] }).worstReason, GAP.UNAVAILABLE);
    assert.equal(classifyMatrixColumn({ ...opts, values: { nope: 1 } }).worstReason, GAP.FAILED);
    assert.equal(classifyMatrixColumn({ ...opts, values: undefined }).worstReason, GAP.FAILED);
    // and a healthy one is still complete
    assert.equal(classifyMatrixColumn({ ...opts, values: Array(100).fill(1) }).isComplete, true);
});

test('nothing outside the try can throw unclassified', async () => {
    // Fixing the scope bug by hoisting widened the region that sits outside
    // BOTH the catch and the finally from 3 lines to 39, and put two
    // DataManager calls in it. Anything raised there escapes with no coverage,
    // without the "Failed to load data for" wrapper, and with the loading
    // indicator still up.
    const restore = stubDataManager();
    try {
        DataManager.getCells = () => { throw new Error('entity index exploded'); };
        await assert.rejects(
            () => loadAxisData({ type: 'obs', key: 'celltype' }, 'cells', null),
            (err) => {
                assert.ok(err.coverage,
                    'an error from the entity lookup must still carry a classification');
                assert.match(err.message, /Failed to load data for/);
                return true;
            }
        );
    } finally { restore(); }
});
