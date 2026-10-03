/**
 * A focused or locked cell outside the cell subset is located and read by
 * its dataset row (DataManager.locateCell / cellRowParams).
 *
 * The fake server has six cells c0..c5. Part 0 of the subset shows c1 and c3
 * (dataset rows 1 and 3), part 1 shows c0 and c4. Every request is recorded,
 * so each test checks which requests were made, and which were not.
 *
 * Run:  node --test annzarro/tests/js/cell-locator.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { Config } = await import('../../../static/js/config.js');
const { CacheManager } = await import('../../../static/js/cache-manager.js');
const { DataManager } = await import('../../../static/js/data-manager.js');
const { unreadableCell } = await import('../../../static/js/utils/coverage.js');

const DS = '/data/atlas.zarr';
const NAMES = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
const PARTS = [[1, 3], [0, 4]];
const key = part => JSON.stringify(part ? { n: 2, seed: 0, part } : { n: 2, seed: 0 });
const partOf = k => (k ? (JSON.parse(k).part || 0) : null);

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * The fake server. `features`: what /data/subset lists (an older server
 * lists none). `oneRow`: false makes obsp answer two rows for one.
 */
function installServer({ features = ['dataset_rows', 'locate', 'names_scope'], oneRow = true } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url, 'http://localhost');
        const q = Object.fromEntries(u.searchParams);
        const path = u.pathname.replace('/api/v1/data/', '');
        calls.push({ path, q });
        const part = partOf(q.subset);
        const shown = part === null ? NAMES.map((_, i) => i) : PARTS[part];
        if (path === 'dataset_structure') return json({ n_obs: NAMES.length });
        if (path === 'subset') {
            const p = q.subset === 'auto' ? 0 : partOf(q.subset);
            return json({ subset: { n: 2, seed: 0, ...(p ? { part: p } : {}) }, key: key(p), n: 2,
                          n_total: 6, n_eligible: 6, part: p, parts: 3,
                          defaults: { threshold: 3, size: 2, seed: 0 }, features });
        }
        if (path === 'cells') return json({ cells: shown.map(r => NAMES[r]) });
        if (path === 'genes') return json({ genes: ['g0', 'g1'] });
        if (path === 'names') {
            const row = NAMES.indexOf(q.q);
            const all = q.scope === 'dataset' || part === null;
            if (row < 0 || (!all && !shown.includes(row))) return json({ matches: [], truncated: false });
            const index = shown.indexOf(row);
            return json({ matches: [{ name: q.q, index: index < 0 ? null : index, row }], truncated: false });
        }
        if (path === 'subset/locate') {
            if (q.rows) return json({ dataset_rows: q.rows.split(',').map(p => shown[Number(p)]) });
            return json({ rows: q.dataset_rows.split(',').map(r => shown.indexOf(Number(r))) });
        }
        const row = q.dataset_rows !== undefined ? Number(q.dataset_rows) : shown[Number(q.rows)];
        if (path === 'obs') return json({ data: { _index: [NAMES[row]] } });
        if (path.startsWith('obsp/')) {
            // row r of obsp holds 10 * r + c, over the cells shown
            const vec = shown.map(c => 10 * row + c);
            return json({ data: oneRow ? [vec] : [vec, vec] });
        }
        if (path.startsWith('layer/')) return json({ data: [[row, row + 0.5]] });
        return json({ data: [] });
    };
    return calls;
}

async function open(part = 0, opts) {
    CacheManager.clear();
    const calls = installServer(opts);
    DataManager.setSubsetRequest(part ? { n: 2, seed: 0, part } : { n: 2, seed: 0 });
    await DataManager.setCurrentDataset(DS, true);
    calls.length = 0;
    return calls;
}

const named = (calls, path) => calls.filter(c => c.path === path);

test('a shown cell is read by position, with no dataset_rows', async () => {
    const calls = await open(0);
    const cell = await DataManager.locateCell('c3');
    assert.deepEqual({ ...cell }, { name: 'c3', position: 1, row: null, shown: true });
    assert.deepEqual(DataManager.cellRowParams(cell), { rows: '1' });
    const obsp = await DataManager.loadObsp({ obspKey: 'knn', cell });
    assert.deepEqual(obsp.data, [[31, 33]]);
    const req = named(calls, 'obsp/knn')[0].q;
    assert.equal(req.rows, '1');
    assert.equal(req.dataset_rows, undefined);
    assert.equal(named(calls, 'names').length, 0, 'the names are in memory');
});

test('a cell outside the subset is located dataset-wide and read by dataset row', async () => {
    const calls = await open(0);
    const cell = await DataManager.locateCell('c4');
    assert.deepEqual({ ...cell }, { name: 'c4', position: -1, row: 4, shown: false });
    assert.equal(named(calls, 'names')[0].q.scope, 'dataset');
    assert.deepEqual(DataManager.cellRowParams(cell), { dataset_rows: '4' });

    const obsp = await DataManager.loadObsp({ obspKey: 'knn', cell });
    assert.deepEqual(obsp.data, [[41, 43]], 'its row over the cells shown');
    const req = named(calls, 'obsp/knn')[0].q;
    assert.equal(req.dataset_rows, '4');
    assert.equal(req.rows, undefined, 'never both');
    assert.equal(req.subset, key(0));

    const layer = await DataManager.loadLayer({ layerName: 'counts', cell });
    assert.deepEqual(layer.data, [4, 4.5], 'its own expression row');
    assert.equal(named(calls, 'layer/counts')[0].q.dataset_rows, '4');

    // located once per dataset load and subset
    await DataManager.locateCell('c4');
    assert.equal(named(calls, 'names').length, 1);
});

test('a name the dataset lacks has no row, and says so', async () => {
    await open(0);
    const cell = await DataManager.locateCell('nope');
    assert.deepEqual({ ...cell }, { name: 'nope', position: -1, row: null, shown: false });
    assert.equal(DataManager.cellRowParams(cell), null);
    assert.match(JSON.stringify(unreadableCell(cell)), /the cell \\"nope\\" is not in this dataset/);
});

test('an older server: no dataset_rows, no dataset-wide search, and a true message', async () => {
    const calls = await open(0, { features: [] });
    const cell = await DataManager.locateCell('c4');
    assert.equal(cell.shown, false);
    assert.equal(cell.unreadable, true);
    assert.equal(DataManager.canReadOutsideSubset(), false);
    assert.equal(DataManager.cellRowParams(cell), null);
    await assert.rejects(DataManager.loadObsp({ obspKey: 'knn', cell }));
    assert.ok(calls.every(c => c.q.dataset_rows === undefined && c.q.scope === undefined),
              JSON.stringify(calls));
    const coverage = unreadableCell(cell, { source: 'obsp.knn', total: 2 });
    const text = JSON.stringify(coverage);
    assert.match(text, /not among the cells shown/);
    assert.match(text, /cannot read a cell outside the subset/);
    assert.doesNotMatch(text, /not in this dataset/);
});

test('one row asked for by dataset row must come back as one row', async () => {
    await open(0, { oneRow: false });
    const cell = await DataManager.locateCell('c4');
    await assert.rejects(DataManager.loadObsp({ obspKey: 'knn', cell }), /answered 2 rows/);
});

test('a part step finds the focused cell by the row recorded before it, without a name search', async () => {
    let calls = await open(0);
    await DataManager.recordCellRows(['c3', 'c1']);
    const locates = named(calls, 'subset/locate');
    assert.equal(locates.length, 1, 'one call for every cell');
    assert.equal(locates[0].q.rows, '1,0');
    assert.deepEqual(DataManager.cellRowHints(['c3', 'c1', 'c5']), { c3: 3, c1: 1 });

    DataManager.setSubsetRequest({ n: 2, seed: 0, part: 1 });
    calls = installServer();
    await DataManager.setCurrentDataset(DS, true);
    calls.length = 0;
    const cell = await DataManager.locateCell('c3');
    assert.deepEqual({ ...cell }, { name: 'c3', position: -1, row: 3, shown: false });
    assert.equal(named(calls, 'names').length, 0, 'no dataset-wide name index');
    const obsp = await DataManager.loadObsp({ obspKey: 'knn', cell });
    assert.deepEqual(obsp.data, [[30, 34]], 'cut to part 1');
});

test('with the names on the server, a known row is located without a name lookup', async () => {
    const threshold = Config.DEFAULTS.LARGE_PLOT_POINTS;
    Config.DEFAULTS.LARGE_PLOT_POINTS = 1;     // two shown cells: names stay on the server
    try {
        let calls = await open(0);
        assert.equal(await DataManager.resolveCellIndex('c1'), 0);
        await DataManager.recordCellRows(['c1']);
        DataManager.setSubsetRequest({ n: 2, seed: 0, part: 1 });
        calls = installServer();
        await DataManager.setCurrentDataset(DS, true);
        calls.length = 0;
        const cell = await DataManager.locateCell('c1');
        assert.deepEqual({ ...cell }, { name: 'c1', position: -1, row: 1, shown: false });
        assert.equal(named(calls, 'names').length, 0);
        assert.equal(named(calls, 'subset/locate')[0].q.dataset_rows, '1');
    } finally {
        Config.DEFAULTS.LARGE_PLOT_POINTS = threshold;
    }
});

test('a link\'s row hint is used once obs/_index confirms the name', async () => {
    const calls = await open(0);
    DataManager.setCellRowHints(DS, { c5: 5 });
    const cell = await DataManager.locateCell('c5');
    assert.deepEqual({ ...cell }, { name: 'c5', position: -1, row: 5, shown: false });
    const check = named(calls, 'obs')[0].q;
    assert.equal(check.columns, '_index');
    assert.equal(check.dataset_rows, '5');
    assert.equal(named(calls, 'names').length, 0, 'the hint spared the dataset-wide search');
});

test('a wrong row hint is dropped: the name decides', async () => {
    const calls = await open(0);
    DataManager.setCellRowHints(DS, { c2: 5 });
    const cell = await DataManager.locateCell('c2');
    assert.equal(cell.row, 2);
    assert.equal(named(calls, 'names').length, 1);
    assert.deepEqual(DataManager.cellRowHints(['c2']), { c2: 2 });
});

test('rows learned for a dataset are not used for another', async () => {
    await open(0);
    assert.deepEqual(DataManager.cellRowHints(['c3']), { c3: 3 });
    DataManager.setCellRowHints('/data/other.zarr', { c3: 0 });
    assert.deepEqual(DataManager.cellRowHints(['c3']), {});
});
