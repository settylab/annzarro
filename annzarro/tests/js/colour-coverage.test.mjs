/**
 * What the COLOUR series does to the points on screen, and whether the panel
 * says so -- driven through the real trace builder, filter mask and
 * incremental colour update.
 *
 *  - settylab/annzarro#38: `processCategories` built one trace per known
 *    category by strict equality and had no residual arm. A point whose value
 *    matched no category (null, NaN -- which equals nothing -- or a value
 *    missing from the server's category list) was in no trace, so Plotly never
 *    drew it, and nothing produced a Coverage for it: the panel reported
 *    "6 of 6" over 4 drawn points. The invariant tested here is the one that
 *    makes such a drop impossible to hide: every point handed in is in exactly
 *    one trace, or was removed by a filter that `createFilterMask` counted.
 *  - settylab/annzarro#37 (third finding): with a table filter, the hide-NaN
 *    mask applies only to table entities, but `colorNaN` counted the whole
 *    array, so "5 of 6 shown" sat above "2 filtered out".
 *  - settylab/annzarro#40: the incremental colour path must replace
 *    `data.colorCoverage`, so a failure of the PREVIOUS colour column is not
 *    announced after switching to a healthy one.
 *
 * Run:  node --test annzarro/tests/js/colour-coverage.test.mjs
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

const { GAP, Coverage, classifyFilterStats } = await import('../../../static/js/utils/coverage.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { createFilterMask, applyFilterMask, panelLoadCoverage } = await import(
    '../../../static/js/panels/plot-utilities/plot-make.js');
const { processCategories, NO_VALUE_CATEGORY } = await import(
    '../../../static/js/panels/plot-utilities/plot-make-helper.js');
const { loadColorDataAndUpdatePlot } = await import(
    '../../../static/js/panels/plot-utilities/plot-update.js');

function panel({ color, colorType = 'categorical', categories = null, table = null, remove = false,
                 hideNaN = false }) {
    const n = color.length;
    const cells = Array.from({ length: n }, (_, i) => `c${i}`);
    const data = {
        entities: 'cells', cells,
        x: { values: cells.map((_, i) => i) }, y: { values: cells.map((_, i) => -i) },
        color, colorType, colorCategories: categories
    };
    const settings = { hideNaN, hideOutliers: false, tableFilter: 'none', z: null };
    if (table) {
        settings.tableFilter = 'cell-table';
        settings.removeNonTableEntries = remove;
        data.tableEntities = new Set(table.map(i => cells[i]));
        data.tableFilterMask = cells.map(c => data.tableEntities.has(c));
    }
    return { data, settings };
}

/** The full render's categorical branch, minus Plotly: mask, filter, traces. */
function drawCategorical(data, settings) {
    const { indexMask, filterStats } = createFilterMask(data, settings);
    const filtered = (settings.hideNaN || settings.hideOutliers) ? applyFilterMask(data, indexMask) : data;
    const catValues = filtered.colorCategories || [...new Set(filtered.color)];
    const traces = processCategories(settings, filtered, catValues);
    const drawn = traces.reduce((n, t) => n + t.x.length, 0);
    return { traces, drawn, filterStats };
}

// --- #38 ---------------------------------------------------------------

test('#38: a categorical point with no value is drawn, under NA', () => {
    // The measured case from the issue: 6 cells, 2 missing, categories [A, B].
    const { data, settings } = panel({
        color: ['A', 'A', 'B', 'B', null, NaN], categories: ['A', 'B'], hideNaN: true
    });
    const { traces, drawn, filterStats } = drawCategorical(data, settings);
    assert.equal(drawn, 6, 'before the fix: 4 drawn, 2 dropped, panel said 6 of 6');
    const na = traces.find(t => t.name === NO_VALUE_CATEGORY);
    assert.ok(na, 'the missing values have a legend entry');
    assert.deepEqual(na.customdata, ['c4', 'c5']);
    const cov = classifyFilterStats(filterStats, 'cells');
    assert.equal(cov.isComplete, true, 'nothing is hidden, so nothing is claimed hidden');
});

test('#38: a value the category list does not name gets its own trace', () => {
    const { data, settings } = panel({ color: ['A', 'B', 'C', 'A'], categories: ['A', 'B'] });
    const { traces, drawn } = drawCategorical(data, settings);
    assert.equal(drawn, 4);
    assert.deepEqual(traces.map(t => t.name).sort(), ['A', 'B', 'C']);
});

test('#38: sweep -- every point is drawn exactly once or counted as filtered', () => {
    const shapes = {
        clean: ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'],
        nulls: ['A', null, 'B', null, 'A', 'B', undefined, 'B'],
        nans: [NaN, 'A', 'B', NaN, 'A', 'B', 'A', NaN],
        unlisted: ['A', 'B', 'Z', 'A', 'Y', 'B', 'Z', 'A'],
        allBlank: [null, null, NaN, NaN, undefined, null, NaN, null],
        numericCodes: [0, 1, 2, 0, 1, 2, NaN, 0]
    };
    const tables = [null, [0, 2, 4, 6], [1, 3, 5, 7], []];
    let cases = 0;
    for (const [name, color] of Object.entries(shapes)) {
        for (const table of tables) {
            for (const remove of [false, true]) {
                for (const hideNaN of [false, true]) {
                    if (!table && remove) continue;
                    const { data, settings } = panel({
                        color: color.slice(), categories: ['A', 'B'], table, remove, hideNaN
                    });
                    const { traces, drawn, filterStats } = drawCategorical(data, settings);
                    const label = `${name} table=${JSON.stringify(table)} remove=${remove} hideNaN=${hideNaN}`;
                    const removedByTable = table && remove ? filterStats.tableFiltered : 0;
                    assert.equal(drawn + removedByTable, color.length, label);
                    const seen = traces.flatMap(t => t.customdata);
                    assert.equal(new Set(seen).size, seen.length, `${label}: a point in two traces`);
                    cases++;
                }
            }
        }
    }
    assert.ok(cases >= 60, `swept ${cases} cases`);
});

// --- #37, third finding ----------------------------------------------------

test('#37: with a table filter, colorNaN counts only what the mask removed', () => {
    // 6 cells; c4 (in the table) and c5 (not) have no colour.
    const { data, settings } = panel({
        color: [1, 2, 3, 4, NaN, NaN], colorType: 'numerical',
        table: [0, 1, 2, 3, 4], remove: false, hideNaN: true
    });
    const { indexMask, filterStats } = createFilterMask(data, settings);
    assert.equal(indexMask.filter(k => !k).length, 1, 'only the table entity is hidden');
    assert.equal(filterStats.colorNaN, 1, 'before the fix: 2, under "5 of 6 shown"');
    const cov = classifyFilterStats(filterStats, 'cells');
    assert.equal(cov.headline(), '5 of 6 cells shown');
    assert.equal(cov.gaps[0].count, 1);
});

test('#37: with a table filter, colorOutliers counts only what the mask removed', () => {
    const { data, settings } = panel({
        color: [1, 2, 3, 4, 100, 100], colorType: 'numerical', table: [0, 1, 2, 3, 4]
    });
    settings.hideOutliers = true;
    settings.colorMin = 0; settings.colorMax = 10;
    const { indexMask, filterStats } = createFilterMask(data, settings);
    assert.equal(indexMask.filter(k => !k).length, 1);
    assert.equal(filterStats.colorOutliers, 1);
});

// --- #40 -----------------------------------------------------------------

test('#40: switching from a failed colour column to a healthy one drops the old reason', async () => {
    const N = 20;
    const CELLS = Array.from({ length: N }, (_, i) => `c${i}`);
    Object.assign(DataManager, {
        getCells: () => CELLS, getGenes: () => [],
        getCurrentDataset: () => '/fixture.zarr',
        loadObs: async ({ columns }) => ({
            data: { [columns[0]]: CELLS.map((_, i) => i / N) }
        })
    });
    const failed = Coverage.missing(GAP.FAILED, 'the server could not read it',
        { source: 'obs.oldcol', unit: 'cells', total: N }).asDescribing();
    const complete = Coverage.complete(N, 'cells');
    const data = {
        entities: 'cells', cells: CELLS,
        x: { values: CELLS.map((_, i) => i), coverage: complete },
        y: { values: CELLS.map((_, i) => i), coverage: complete },
        z: null,
        color: Array(N).fill(1), colorType: 'constant', colorCategories: null,
        colorCoverage: failed,                       // the PREVIOUS colour column
        tableEntities: null, tableFilterMask: null
    };
    const settings = {
        x: { type: 'obs', key: 'a' }, y: { type: 'obs', key: 'b' }, z: null,
        color: { type: 'obs', key: 'newcol' }, hideNaN: false, hideOutliers: false,
        tableFilter: 'none'
    };
    assert.equal(panelLoadCoverage(data, settings, 'cells').worstReason, GAP.FAILED,
        'precondition: the old column is the one announced');
    const plotContainer = {
        data: [{ type: 'scattergl', x: [], y: [] }], layout: {},
        parentNode: { querySelector: () => null, insertBefore() {}, appendChild() {}, children: [] },
        querySelector: () => null, querySelectorAll: () => [],
        classList: { add() {}, remove() {} }, dataset: {}, id: 'plot-container-c', style: {},
        appendChild(c) { return c; }, removeChild() {}, contains: () => false
    };
    let refreshed = false;
    await loadColorDataAndUpdatePlot({}, plotContainer, settings, data, 'c', () => { refreshed = true; });

    assert.equal(refreshed, false, 'took the incremental path');
    assert.equal(data.colorCoverage.isComplete, true);
    const live = panelLoadCoverage(data, settings, 'cells');
    assert.equal(live.isComplete, true, live.lines().join('; '));
    assert.ok(!live.lines().some(l => l.includes('obs.oldcol')), 'no stale reason survives');
});
