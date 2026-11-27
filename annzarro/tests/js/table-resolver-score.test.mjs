/**
 * A score is a dependency of a table's filter (static/js/utils/table-resolver.js, design 8.7): a
 * closed table whose filter reads a score builds only after the score is ready, an open table holds
 * its rows for a score that is not, and a cycle stops resolution before anything asks for a score.
 * A fake host, as table-resolver.test.mjs has.
 *
 * Run:  node --test annzarro/tests/js/table-resolver-score.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createResolver, describeUnresolved } = await import('../../../static/js/utils/table-resolver.js');

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/** Wait for the real condition (a wait of a fixed time is for a thing that must NOT happen). */
async function until(done, what = 'the condition') {
    for (let i = 0; !done(); i++) {
        assert.ok(i < 5000, `${what} never came`);
        await tick(1);
    }
}

function fake({ tables = ['A', 'B'], depends = {} } = {}) {
    const open = new Set();
    const wanted = { p: 'A' };
    const state = { gate: {} };            // table -> the score status the host reports
    const asked = [];                      // [id, open, dependant] each time the host is asked about scores
    const published = [];
    const notified = [];
    const builds = [];
    const released = [];
    const host = {
        panel: (id) => tables.includes(id) ? { id, kind: 'cell-table', open: open.has(id), title: `Table ${id}`, config: { id } } : null,
        isDependant: (d, t) => wanted[d] === t,
        visible: () => true,
        cellsKey: () => 'k1',
        rowCount: () => 100,
        mayLoad: () => ({ ok: true }),
        depends: (id) => depends[id] || [],
        scoreGate: (id, o) => { asked.push([id, o.open, o.dependant || null]); return state.gate[id] ? { ...state.gate[id] } : null; },
        releaseScores: (id) => released.push(id),
        build: (job) => new Promise((resolve) => { builds.push({ id: job.id, finish: resolve }); }),
        publish: (id, selection) => published.push([id, selection]),
        notify: (id) => notified.push(id),
        schedule: (fn) => setTimeout(fn, 0)
    };
    return { resolver: createResolver(host), open, wanted, state, asked, published, notified, builds, released };
}

const waiting = { state: 'waiting', reason: 'score', title: 'T cell score', scoreState: 'computing', detail: '' };

test('a closed table whose filter reads a score that is not ready builds nothing and says it waits for the score', async () => {
    const t = fake();
    t.state.gate.A = waiting;
    const s = t.resolver.need('A', 'p');
    assert.deepEqual([s.state, s.reason, s.title], ['waiting', 'score', 'T cell score']);
    await tick(20);
    assert.equal(t.builds.length, 0, 'the score is resolved first');
    assert.deepEqual(t.asked[0], ['A', false, 'p']);
});

test('when the score is ready the same ask builds the filter', async () => {
    const t = fake();
    t.state.gate.A = waiting;
    t.resolver.need('A', 'p');
    t.state.gate.A = null;
    assert.equal(t.resolver.need('A', 'p').state, 'waiting', 'queued for the build');
    await until(() => t.builds.length === 1, 'the build');
    assert.equal(t.builds.length, 1);
    t.builds[0].finish({ passing: [], seen: [] });
    await until(() => t.published.length === 1, 'the result');
    assert.equal(t.published.length, 1);
    assert.equal(t.resolver.status('A').state, 'ready');
});

test('a score that changes voids the selection built from the old one and tells the dependants to ask again', async () => {
    const t = fake();
    t.resolver.need('A', 'p');
    await until(() => t.builds.length === 1, 'the build');
    t.builds[0].finish({ passing: ['c1'], seen: ['c1'] });
    await until(() => t.published.length === 1, 'the result');
    t.published.length = 0;
    t.notified.length = 0;
    t.resolver.scoreChanged('A');
    assert.deepEqual(t.published, [['A', null]], 'the closed selection is cleared, so a plot has no stale rows to use');
    assert.deepEqual(t.notified, ['A']);
    assert.equal(t.resolver.status('A').state, 'idle');
    t.resolver.need('A', 'p');
    await until(() => t.builds.length === 2, 'the second build');
    assert.equal(t.builds.length, 2, 'it builds again');
});

test('a score change for an open table is not the resolver\'s: the table fills itself', () => {
    const t = fake();
    t.open.add('A');
    t.resolver.need('A', 'p');
    t.resolver.scoreChanged('A');
    assert.deepEqual(t.notified, []);
});

test('an open table whose filter reads a score that is not ready reports it through gate, so every reader waits', () => {
    const t = fake();
    t.open.add('A');
    assert.equal(t.resolver.gate('A'), null);
    t.state.gate.A = waiting;
    assert.deepEqual(t.resolver.gate('A'), waiting);
    assert.equal(t.resolver.need('A', 'p').reason, 'score', 'need passes it down unchanged');
    assert.deepEqual(t.asked.at(-1).slice(0, 2), ['A', true]);
    t.state.gate.A = null;
    assert.equal(t.resolver.need('A', 'p').state, 'ready');
});

test('a table that is opening still reports opening before it reports a score', () => {
    const t = fake();
    t.open.add('A');
    t.state.gate.A = waiting;
    t.resolver.claim('A');
    assert.equal(t.resolver.gate('A').reason, 'opening');
});

test('a cycle through a table with a score filter stops resolution, and no score is asked for', async () => {
    const t = fake({ depends: { A: ['B'], B: ['A'] } });
    t.state.gate.A = waiting;
    const s = t.resolver.need('A', 'p');
    assert.equal(s.state, 'cycle');
    assert.deepEqual(s.cycle, ['A', 'B', 'A']);
    assert.equal(t.asked.length, 0, 'the cycle is found before the score is');
    await tick(20);
    assert.equal(t.builds.length, 0);
});

test('a table that leaves lets go of its scores, and so does a reset for a closed one only', () => {
    const t = fake();
    t.open.add('B');
    t.resolver.need('A', 'p');
    t.resolver.need('B', 'q');
    t.resolver.drop('A');
    assert.deepEqual(t.released, ['A']);
    t.released.length = 0;
    t.resolver.need('A', 'p');
    t.resolver.reset();
    assert.ok(t.released.includes('A') && !t.released.includes('B'), 'an open table keeps its scores through a reset');
});

test('wantedBy lists the dependants on the page that wait on a table', () => {
    const t = fake();
    t.resolver.need('A', 'p');
    assert.deepEqual(t.resolver.wantedBy('A'), ['p']);
    assert.deepEqual(t.resolver.wantedBy('B'), []);
    t.wanted.p = 'B';
    assert.deepEqual(t.resolver.wantedBy('A'), [], 'a plot that filters by another table no longer waits');
});

// the words ---------------------------------------------------------------------------------

test('a plot says what a table filter waits for, in the sentence of the other unresolved states', () => {
    const w = describeUnresolved(waiting, 'Cell Table 1');
    assert.deepEqual([w.tag, w.headline], ['Waiting for score', 'Filter not applied yet']);
    assert.equal(w.text, "Filtering by 'Cell Table 1' needs 'T cell score', which is not ready yet. No cells are drawn until it is.");
    assert.deepEqual(w.actions.map(a => a[0]), ['table-score-cancel', 'reopen-table', 'table-filter-off']);
    const asks = describeUnresolved({ ...waiting, scoreState: 'awaiting' }, 'Cell Table 1');
    assert.match(asks.text, /which has not been computed/);
    assert.deepEqual(asks.actions[0], ['table-score-compute', 'Compute score']);
    const failed = describeUnresolved({ state: 'failed', reason: 'score', title: 'T cell score', scoreState: 'failed',
        detail: "'T cell score' could not be computed: boom." }, 'Cell Table 1');
    assert.deepEqual([failed.tag, failed.headline], ['Filter not applied', 'Filter not applied']);
    assert.equal(failed.text, "'Cell Table 1' is filtered by 'T cell score'. 'T cell score' could not be computed: boom. No cells are drawn.");
    assert.deepEqual(failed.actions.map(a => a[0]), ['table-score-retry', 'reopen-table', 'table-filter-off']);
    const refused = describeUnresolved({ state: 'refused', reason: 'score', title: 'T cell score', scoreState: 'refused', detail: 'too big.' }, 'Cell Table 1');
    assert.deepEqual(refused.actions.map(a => a[0]), ['reopen-table', 'table-filter-off'], 'a refused score cannot be retried');
});

test('the other reasons keep their words', () => {
    assert.equal(describeUnresolved({ state: 'waiting', reason: 'opening' }, 'T').tag, 'Opening table');
    assert.equal(describeUnresolved({ state: 'failed', reason: 'boom' }, 'T').tag, 'Filter not applied');
    assert.equal(describeUnresolved({ state: 'ask', rows: 5 }, 'T').tag, 'Filter not built');
});
