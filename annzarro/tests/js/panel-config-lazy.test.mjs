/**
 * A table's getConfig() reads its live row list only when a caller reads it.
 *
 * `currentEntries` (every row passing the table's filter, read from the
 * DataTable) took about 50 ms at 1M rows, and `{title, ...settings}` read it
 * on every getConfig(): the column chooser on each focus change, the
 * autosave and the address bar on every save, for a list none of them used
 * (serializableConfig leaves it out). Most of 0.5 s per focus change at 1M
 * cells.
 *
 * Run:  node --test annzarro/tests/js/panel-config-lazy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { configOf } = await import('../../../static/js/utils/panel-settings.js');
const { serializableConfig } = await import('../../../static/js/utils/deeplink.js');

function settings() {
    const reads = { n: 0 };
    const s = { id: 'cell-table-1', columns: [{ type: 'obs', key: 'a' }], currentEntries: [] };
    Object.defineProperty(s, 'currentEntries', { configurable: true, get() { reads.n++; return [4, 5, 6]; } });
    return { s, reads };
}

test('the live row list is read when read, not on getConfig()', () => {
    const { s, reads } = settings();
    const cfg = configOf(s, { title: 'Table 1' });
    assert.equal(reads.n, 0);
    assert.equal(cfg.title, 'Table 1');
    assert.deepEqual(cfg.columns, s.columns);
    assert.deepEqual(Object.keys(cfg), ['title', 'id', 'columns', 'currentEntries']);
    assert.deepEqual(cfg.currentEntries, [4, 5, 6]);           // a table filter reads it
    assert.equal(reads.n, 1);
    // a spread or JSON still sees every key and value
    assert.deepEqual(JSON.parse(JSON.stringify(cfg)).currentEntries, [4, 5, 6]);
});

test('a settings title wins over the head, as in a spread; writing to the copy leaves the panel alone', () => {
    const { s, reads } = settings();
    s.title = 'own';
    const cfg = configOf(s, { title: 'Table 1' });
    assert.equal(cfg.title, 'own');
    cfg.currentEntries = [1];
    assert.deepEqual(cfg.currentEntries, [1]);
    assert.equal(reads.n, 0);
    cfg.columns = [];
    assert.equal(s.columns.length, 1);
});

test('what a link or the autosave keeps does not read the row list', () => {
    const { s, reads } = settings();
    const out = serializableConfig(configOf(s, { title: 'Table 1' }));
    assert.equal(reads.n, 0);
    assert.deepEqual(out, { title: 'Table 1', id: 'cell-table-1', columns: s.columns });
});
