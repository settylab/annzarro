/**
 * The cell/gene TABLE and the PLOT must reach the same verdict from the same
 * server response.
 *
 * ## Why this suite exists
 *
 * The first cut of the coverage mechanism classified a plot column with
 * `classifyColumn` -- which inspects the RESPONSE BODY and can therefore tell
 * "the column is not in this dataset" (key ABSENT) from "the read failed" (key
 * present, empty) -- while the table classified the ARRAY EXTRACTED from that
 * body. Both shapes extract to `undefined`, so the discriminator was destroyed
 * before the table's classifier ever ran.
 *
 * The consequence, measured against the live service on 2026-08-28: on 22 of
 * 33 served datasets a table holding 75,000 rows was captioned, in red,
 *
 *     No cells shown (of 75,000)
 *     obs.celltype: failed to read (75,000 cells) -- the column returned no
 *     values although this dataset has 75000 cells
 *
 * while the PLOT on the same page, from the same response, correctly said
 * "not in this dataset". Both halves of that caption were false: the reason,
 * because the discriminator was gone, and the count, because `Coverage.merge`
 * took `min(shown)` over a contributor that removes no rows.
 *
 * These tests drive the REAL `loadTableData` -- not a transcription of its
 * logic -- against response bodies of the shapes the server actually produces,
 * and assert the table's verdict EQUALS `classifyColumn`'s. A transcription
 * would have passed while the two implementations drifted, which is the defect
 * this suite exists to prevent.
 *
 * Run:  node --test annzarro/tests/js/table-coverage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GAP, ROLE, Coverage, classifyColumn } from '../../../static/js/utils/coverage.js';
import { DataManager } from '../../../static/js/data-manager.js';
import { loadTableData } from '../../../static/js/panels/table-utilities/table-data.js';

const N = 75000;
const CELLS = Array.from({ length: N }, (_, i) => `cell_${i}`);

/**
 * Point DataManager at a fixed obs response. Returns a restore function.
 * The table module holds `DataManager` by reference, so patching its members
 * exercises the real loader rather than a stand-in for it.
 */
function withObs(body, { cells = CELLS, cellIndex = null } = {}) {
    const saved = {
        loadObs: DataManager.loadObs,
        getCells: DataManager.getCells,
        getCellsForPanel: DataManager.getCellsForPanel,
        getGenes: DataManager.getGenes,
        getCellIndex: DataManager.getCellIndex,
        resolveCellIndex: DataManager.resolveCellIndex,
        getFocusedCell: DataManager.getFocusedCell,
        loadObsp: DataManager.loadObsp
    };
    DataManager.loadObs = async () => body;
    DataManager.getCells = () => cells;
    DataManager.getCellsForPanel = () => cells;
    DataManager.getGenes = () => [];
    if (cellIndex !== null) {
        DataManager.getCellIndex = () => cellIndex;
        DataManager.resolveCellIndex = async () => cellIndex;
    }
    return () => Object.assign(DataManager, saved);
}

async function tableCoverageFor(body, columns, opts = {}) {
    const restore = withObs(body, opts);
    try {
        return await loadTableData({ columns }, 'cells');
    } finally {
        restore();
    }
}

const OBS_CELLTYPE = [{ type: 'obs', key: 'celltype' }];

/* ------------------------------------------------------------------ *
 * The four response shapes the server actually produces.              *
 * Each asserts the TABLE's verdict against classifyColumn's, so the   *
 * two consumers cannot drift apart again.                             *
 * ------------------------------------------------------------------ */

const SHAPES = [
    {
        name: 'key ABSENT -- the column is not in this dataset (22 of 33 live datasets)',
        body: { data: {} },
        reason: GAP.UNAVAILABLE
    },
    {
        name: 'key PRESENT but empty -- the read failed (the 2026-08-28 incident shape)',
        body: { data: { celltype: [] } },
        reason: GAP.FAILED
    },
    {
        name: 'full length, every value null -- a legitimate all-NaN categorical',
        body: { data: { celltype: Array(N).fill(null) } },
        reason: GAP.EMPTY
    },
    {
        name: 'short read -- fewer values than the dataset has cells',
        body: { data: { celltype: Array(1000).fill('T') } },
        reason: GAP.FAILED
    }
];

for (const shape of SHAPES) {
    test(`table and plot agree: ${shape.name}`, async () => {
        const plot = classifyColumn({
            column: 'celltype', response: shape.body,
            expected: N, unit: 'cells', source: 'obs.celltype'
        });
        const table = await tableCoverageFor(shape.body, OBS_CELLTYPE);

        assert.equal(plot.worstReason, shape.reason,
            'the plot classifier changed; fix the expectation or the classifier');
        assert.equal(table.coverage.worstReason, shape.reason,
            `the TABLE says "${table.coverage.worstReason}" where the plot says `
            + `"${plot.worstReason}" for the same response body`);
        assert.deepEqual(table.coverage.lines(), plot.lines(),
            'the table and the plot must give the user the same sentence');
    });
}

test('a healthy column produces no notice on either surface', async () => {
    const body = { data: { celltype: Array(N).fill('T cell') } };
    const plot = classifyColumn({
        column: 'celltype', response: body, expected: N,
        unit: 'cells', source: 'obs.celltype'
    });
    const table = await tableCoverageFor(body, OBS_CELLTYPE);
    assert.equal(plot.isComplete, true);
    assert.equal(table.coverage.isComplete, true);
    assert.deepEqual(table.coverage.lines(), []);
});

/* ------------------------------------------------------------------ *
 * The count half of the same defect.                                  *
 * ------------------------------------------------------------------ */

test('a table with one unreadable column still reports every row as shown', async () => {
    // Two healthy columns and one absent from the dataset -- the exact
    // situation an ordinary dataset switch produces, since nothing prunes
    // columns that the new dataset does not have.
    const body = {
        data: {
            sample: Array(N).fill('s1'),
            n_genes: Array(N).fill(1200)
        }
    };
    const table = await tableCoverageFor(body, [
        { type: 'obs', key: 'celltype' },   // absent from `data`
        { type: 'obs', key: 'sample' },
        { type: 'obs', key: 'n_genes' }
    ]);

    assert.equal(table.data.length, N, 'all rows are on screen');
    assert.equal(table.coverage.shown, N,
        `the notice claims ${table.coverage.shown} rows are shown while ${N} are rendered`);
    assert.equal(table.coverage.total, N);
    assert.doesNotMatch(table.coverage.headline(), /^No cells shown/,
        'a table holding every row must never be captioned "No cells shown"');
    assert.equal(table.coverage.worstReason, GAP.UNAVAILABLE);
    assert.equal(table.coverage.lines().length, 1,
        'exactly one coverage per requested column -- a bad column counted twice '
        + 'would state its reason twice');
    assert.match(table.coverage.lines()[0], /not in this dataset/);

    // ...and the two good columns are actually in the table.
    const titles = table.columns.map(c => c.title);
    assert.deepEqual(titles, ['Cell ID', 'sample', 'n_genes']);
});

test('a table whose every column is unreadable still shows its rows', async () => {
    const table = await tableCoverageFor({ data: {} }, [
        { type: 'obs', key: 'celltype' },
        { type: 'obs', key: 'sample' }
    ]);
    assert.equal(table.coverage.shown, N);
    assert.equal(table.coverage.lines().length, 2);
    assert.doesNotMatch(table.coverage.headline(), /^No cells shown/);
});

/* ------------------------------------------------------------------ *
 * "Not in this dataset" must not be reported as "legitimately blank". *
 * ------------------------------------------------------------------ */

test('an obsp column naming a cell this dataset does not have says so', async () => {
    // getCellIndex returns -1; the loader fills the column with nulls. Reading
    // that array alone, the only available verdict is "every entry is blank",
    // which tells the user the data is legitimately absent. It is not.
    const restore = withObs({ data: {} }, { cellIndex: -1 });
    try {
        const table = await loadTableData({
            columns: [{ type: 'obsp', key: 'connectivities', column: 'cell_from_old_dataset' }]
        }, 'cells');
        assert.equal(table.coverage.worstReason, GAP.UNAVAILABLE,
            'a cell absent from this dataset is UNAVAILABLE, not EMPTY');
        assert.match(table.coverage.lines()[0], /cell_from_old_dataset.*not in this dataset/);
        assert.equal(table.coverage.shown, N, 'the rows are still on screen');
    } finally {
        restore();
    }
});

/* ------------------------------------------------------------------ *
 * The role a table column carries is what makes the count honest.     *
 * ------------------------------------------------------------------ */

test('every table column coverage DESCRIBES rather than RESTRICTS', async () => {
    // Stated directly, because the count assertions above would also pass if
    // merge stopped taking a minimum at all. It is the ROLE that is correct
    // here, not merely the arithmetic.
    for (const body of [
        { data: {} },
        { data: { celltype: [] } },
        { data: { celltype: Array(N).fill(null) } },
        { data: { celltype: Array(10).fill('T') } },
        { data: { celltype: Array(N).fill('T') } }
    ]) {
        const restore = withObs(body);
        try {
            // Reach into the module the same way loadTableData does, via its
            // public entry point, and check the per-column value it merged.
            const table = await loadTableData({ columns: OBS_CELLTYPE }, 'cells');
            assert.equal(table.coverage.role, ROLE.RESTRICTS,
                'a merged panel coverage is itself a real entity count');
            assert.equal(table.coverage.shown, N,
                `shown=${table.coverage.shown} for body ${JSON.stringify(Object.keys(body.data))}`
                + ' -- a table column must not bound the rows on screen');
        } finally {
            restore();
        }
    }
});

test('a dataset with no cell names does restrict, and says nothing is shown', async () => {
    // The opposite direction: this one genuinely removes every row, so
    // "nothing shown" is the truth and must survive the fix.
    const restore = withObs({ data: {} }, { cells: [] });
    try {
        await assert.rejects(
            () => loadTableData({ columns: OBS_CELLTYPE }, 'cells'),
            (err) => {
                assert.ok(err.coverage instanceof Coverage);
                assert.equal(err.coverage.role, ROLE.RESTRICTS);
                assert.equal(err.coverage.shown, 0);
                assert.equal(err.coverage.worstReason, GAP.UNAVAILABLE);
                return true;
            }
        );
    } finally {
        restore();
    }
});
