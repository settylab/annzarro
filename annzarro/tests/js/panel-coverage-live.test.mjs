/**
 * The INCREMENTAL path, executed end to end.
 *
 * `coverage.test.mjs` tests `classifyFilterStats` in isolation, and every
 * fixture in it -- including its 60-combination sweep -- passes the SAME object
 * as `axisCoverage.x` and as a member of the `Coverage.merge` that is supposed
 * to re-supply the sentence. That identity is exactly what does NOT hold on the
 * incremental path, so no test in that file could see this:
 *
 *   `data.coverage` was written at ONE place, the full render
 *   (`plot-make.js`), while `data[axis]` is replaced without it by
 *   `plot-update.js`'s `refocusAxisOnEntity` and `listeners.js`'s axis
 *   dropdown. So `data.coverage` described the PREVIOUS x while `data.x` held
 *   the new one. The suppression was licensed by the FRESH axis and the
 *   sentence was expected from the STALE panel value, which did not carry it.
 *
 * Result, measured: picking an unfocused `obsp` column on x produced the
 * headline "No cells shown (of 200)" and NO reason at all, while the loader had
 * produced a perfectly good one. That is silence -- the defect `utils/coverage.js`
 * exists to end -- reached through the fix for a cosmetic duplicate.
 *
 * This suite drives the REAL `loadAxisData` into the REAL `updatePlotElements`
 * behind stubbed `window`/`document`/`Plotly`, and asserts on what the USER is
 * told: the `title` attribute `renderCoverageNotice` writes.
 *
 * Run:  node --test annzarro/tests/js/panel-coverage-live.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
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
globalThis.document = { createElement: mkEl, getElementById: () => null, body: mkEl('body') };
globalThis.Plotly = new Proxy({}, { get: () => () => Promise.resolve() });

const { Coverage } = await import('../../../static/js/utils/coverage.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { loadAxisData } = await import('../../../static/js/panels/plot-utilities/plot-make.js');
const { updatePlotElements } = await import('../../../static/js/panels/plot-utilities/plot-update.js');

const N = 200;
const CELLS = Array.from({ length: N }, (_, i) => `c${i}`);
Object.assign(DataManager, {
    getCells: () => CELLS, getGenes: () => [],
    getCurrentDataset: () => '/fixture.zarr',
    getCellIndex: () => -1,          // nothing focused -> blankFocusSeries
    resolveCellIndex: async () => -1,
    getGeneIndex: () => -1,
    getFocusedCell: () => null, getFocusedGene: () => null
});

const mkContainer = () => ({
    data: [{ type: 'scattergl', x: [], y: [] }], layout: {},
    parentNode: { querySelector: () => null, insertBefore() {}, appendChild() {}, children: [] },
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {} }, dataset: {}, id: 'plot-container-1', style: {}
});

/** Drive one incremental x-axis update and return what the user is told. */
async function incrementalAxisUpdate({ staleCoverage }) {
    const settings = {
        x: { type: 'obsp', key: 'connectivities', column: '' },   // no cell focused
        y: { type: 'obsm', key: 'X_umap', column: 1 },
        z: null, color: { type: 'none' },
        hideNaN: false, hideOutliers: false, tableFilter: 'none'
    };
    const freshX = await loadAxisData(settings.x, 'cells', null);
    const data = {
        entities: 'cells', cells: CELLS,
        x: freshX,                                    // listeners.js: data[axis] = axisData
        y: {
            values: Array.from({ length: N }, (_, i) => i), type: 'numerical',
            coverage: Coverage.complete(N, 'cells')
        },
        z: null, color: null, colorType: null, colorCategories: null, colorCoverage: null,
        tableEntities: null, tableFilterMask: null,
        coverage: staleCoverage,                      // NOT recomputed on this path
        generation: DataManager.getDatasetGeneration() // stamped by a finished load
    };
    created.length = 0;
    let refreshed = false;
    await updatePlotElements(mkContainer(), data, settings, () => { refreshed = true; },
                             { xAxis: true, layout: true });
    const notice = created.find(e => e._attrs && e._attrs.title !== undefined);
    const lines = notice ? String(notice._attrs.title).split('\n') : [];
    return { freshX, refreshed, lines };
}

test('the loader really does produce a reason for an unfocused obsp axis', async () => {
    // The premise of everything below: there IS a sentence to lose.
    const { freshX } = await incrementalAxisUpdate({
        staleCoverage: Coverage.merge(
            [Coverage.complete(N, 'cells'), Coverage.complete(N, 'cells')], 'cells')
    });
    assert.equal(freshX.values.length, N);
    assert.ok(freshX.values.every(Number.isNaN), 'the series is entirely blank');
    assert.equal(freshX.coverage.shown, 0);
    assert.match(freshX.coverage.lines()[0], /focused/);
});

test('an incremental axis update states a reason even when data.coverage is STALE', async () => {
    // `data.coverage` describes the PREVIOUS x -- two healthy series, nothing
    // missing. It cannot explain the axis the user just picked. If the panel
    // reads it instead of recomputing, the suppression fires and the reason
    // the loader produced never reaches anyone.
    const stale = Coverage.merge(
        [Coverage.complete(N, 'cells'), Coverage.complete(N, 'cells')], 'cells');
    assert.equal(stale.isComplete, true, 'the stale value says nothing is missing');

    const { refreshed, lines } = await incrementalAxisUpdate({ staleCoverage: stale });
    assert.equal(refreshed, false, 'the full-render fallback did not fire; this IS the notice');
    assert.equal(lines[0], `No cells shown (of ${N})`);
    assert.ok(lines.length > 1,
        `headline with NO reason -- this is the silence the module exists to end: ${JSON.stringify(lines)}`);
    assert.match(lines.slice(1).join('\n'), /focused/,
        'and it must be the SERIES-level reason, not the filter mask\'s wrong category');
});

test('...and it is the right category: a not-yet-made selection, not a filter', async () => {
    // The point of the branch. Base said "x-axis: filtered out (200 cells)",
    // which is true and the wrong category for a selection nobody has made yet.
    const { lines } = await incrementalAxisUpdate({
        staleCoverage: Coverage.merge(
            [Coverage.complete(N, 'cells'), Coverage.complete(N, 'cells')], 'cells')
    });
    const body = lines.slice(1).join('\n');
    assert.match(body, /needs a focused selection/);
    assert.doesNotMatch(body, /filtered out/,
        'the duplicate the branch exists to remove must still be gone');
});
