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
 * rounds. `node --check` passes on it; the repo's own `.eslintrc.js` catches it
 * (`no-undef`) and nothing runs ESLint.
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

const { GAP } = await import('../../../static/js/utils/coverage.js');
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
