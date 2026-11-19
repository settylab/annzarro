/**
 * The rules of the background recompute of closed tables (static/js/utils/table-resolver.js), with a
 * fake host: the size tiers, one build at a time, the order of the queue, one owner per table with an
 * epoch, cycles, and the sentences a plot says of a filter that is not applied yet.
 *
 * Run:  node --test annzarro/tests/js/table-resolver.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { TABLE_LIMITS, tierOf, findCycle, depthOf, describeUnresolved, createResolver } =
    await import('../../../static/js/utils/table-resolver.js');

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/** A host with tables `names`, builds that wait until the test lets them finish. */
function fake({ rows = 100, tables = ['A', 'B', 'C'], depends = {}, visible = {}, guard = () => ({ ok: true }) } = {}) {
    const open = new Set();
    const cells = { key: 'k1' };
    const published = [];
    const notified = [];
    const builds = [];                   // {id, finish(selection), fail(error), job}
    const wanted = {};                   // dependant -> table
    const host = {
        panel: (id) => tables.includes(id) ? { id, kind: 'cell-table', open: open.has(id), title: id, config: { id } } : null,
        isDependant: (d, t) => wanted[d] === t,
        visible: (d) => visible[d] !== false,
        cellsKey: () => cells.key,
        rowCount: () => rows,
        mayLoad: (id, kind, n) => guard(id, kind, n),
        depends: (id) => depends[id] || [],
        build: (job) => new Promise((resolve, reject) => {
            builds.push({ id: job.id, job, finish: resolve, fail: reject });
            job.signal.addEventListener('abort', () => reject(job.signal.reason), { once: true });
        }),
        publish: (id, selection) => published.push([id, selection]),
        notify: (id) => notified.push(id),
        schedule: (fn) => setTimeout(fn, 0)
    };
    const resolver = createResolver(host);
    return { resolver, host, open, cells, published, notified, builds, wanted };
}

// ---------------------------------------------------------------- sizes

test('the size tiers sit at 200,000 and 1,000,000 rows', () => {
    assert.deepEqual({ ...TABLE_LIMITS }, { AUTO_ROWS: 200000, ASK_ROWS: 1000000 });
    assert.equal(tierOf(0), 'auto');
    assert.equal(tierOf(200000), 'auto');
    assert.equal(tierOf(200001), 'ask');
    assert.equal(tierOf(1000000), 'ask');
    assert.equal(tierOf(1000001), 'refuse');
});

test('a table above the automatic limit waits for Build filter; above the other limit it is refused', async () => {
    const t = fake({ rows: 300000 });
    t.wanted.p = 'A';
    assert.equal(t.resolver.need('A', 'p').state, 'ask');
    await tick();
    assert.equal(t.builds.length, 0, 'nothing is built before the click');
    t.resolver.confirm('A');
    await tick();
    assert.equal(t.builds.length, 1);

    const big = fake({ rows: 1000001 });
    big.wanted.p = 'A';
    assert.deepEqual([big.resolver.need('A', 'p').state, big.resolver.status('A').reason], ['refused', 'size']);
    big.resolver.confirm('A');
    assert.equal(big.resolver.need('A', 'p').state, 'refused', 'a click does not lift the upper limit');
    await tick();
    assert.equal(big.builds.length, 0);
});

test('the memory guard decides first: refused means nothing loads', async () => {
    const t = fake({ guard: () => ({ ok: false, detail: 'not enough' }) });
    t.wanted.p = 'A';
    const s = t.resolver.need('A', 'p');
    assert.deepEqual([s.state, s.reason, s.detail], ['refused', 'memory', 'not enough']);
    await tick();
    assert.equal(t.builds.length, 0);
    assert.equal(t.resolver.buildsStarted, 0);
});

test('the limits can be tuned in one place', () => {
    const t = fake({ rows: 50 });
    t.resolver.setLimits({ AUTO_ROWS: 10, ASK_ROWS: 40 });
    t.wanted.p = 'A';
    assert.equal(t.resolver.need('A', 'p').state, 'refused');
});

// ---------------------------------------------------------------- need, queue, one at a time

test('a build starts only when a dependant asks, and a table that is open is never built', async () => {
    const t = fake();
    await tick();
    assert.equal(t.resolver.buildsStarted, 0, 'nobody asked');
    t.open.add('B');
    t.wanted.p = 'B';
    assert.equal(t.resolver.need('B', 'p').state, 'ready');
    await tick();
    assert.equal(t.resolver.buildsStarted, 0, 'an open table is its own filter');
    assert.equal(t.resolver.need('nope', 'p').state, 'missing');
});

test('one build at a time; visible dependants first, then fewer tables upstream, then the order asked', async () => {
    const t = fake({ tables: ['A', 'B', 'C', 'D'], depends: { B: ['D'] }, visible: { pB: false } });
    Object.assign(t.wanted, { pA: 'A', pB: 'B', pC: 'C', pD: 'D' });
    for (const [id, p] of [['A', 'pA'], ['B', 'pB'], ['C', 'pC'], ['D', 'pD']]) t.resolver.need(id, p);
    await tick(20);
    assert.equal(t.builds.length, 1, 'one at a time');
    const order = [];
    for (let i = 0; i < 4; i++) {
        await tick(20);
        assert.equal(t.builds.length, i + 1, 'the next build waits for the one running');
        order.push(t.builds[i].id);
        t.builds[i].finish({ passing: [], seen: [] });
    }
    await tick(20);
    // A, C, D are on screen and need no table first (A before C before D: the order asked); B is off
    // screen and has D upstream
    assert.deepEqual(order, ['A', 'C', 'D', 'B']);
    assert.deepEqual(t.published.map(p => p[0]), ['A', 'C', 'D', 'B']);
});

test('the result is published once and the dependants are told once', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    const told = t.notified.length;                       // "building"
    t.builds[0].finish({ passing: ['x'], seen: ['x', 'y'] });
    await tick();
    assert.equal(t.published.length, 1);
    assert.equal(t.notified.length, told + 1);
    assert.equal(t.resolver.status('A').state, 'ready');
});

test('a build nobody wants any more ends', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    assert.equal(t.resolver.building, 'A');
    delete t.wanted.p;
    t.resolver.reassess();
    await tick();
    assert.equal(t.builds[0].job.signal.aborted, true);
    assert.equal(t.published.length, 0);
    assert.equal(t.resolver.building, null);
});

test('a queued table nobody wants any more is not built', async () => {
    const t = fake();
    Object.assign(t.wanted, { p: 'A', q: 'B' });
    t.resolver.need('A', 'p');
    t.resolver.need('B', 'q');
    await tick();
    delete t.wanted.q;
    t.builds[0].finish({ passing: [], seen: [] });
    await tick(20);
    assert.deepEqual(t.builds.map(b => b.id), ['A']);
});

// ---------------------------------------------------------------- one owner, the epoch

test('opening a table during its build ends the build; its late result is discarded', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    const before = t.resolver.epochOf('A');
    t.resolver.claim('A');
    assert.ok(t.resolver.epochOf('A') > before);
    assert.equal(t.builds[0].job.signal.aborted, true, 'the build is aborted before the table loads its rows');
    // the build ignores the abort and delivers anyway
    t.builds[0].finish({ passing: ['late'], seen: ['late'] });
    await tick();
    assert.equal(t.published.length, 0, 'a late background result can never overwrite an opened table');
    // the plots wait for the opened table until it publishes
    assert.deepEqual(t.resolver.gate('A'), { state: 'waiting', reason: 'opening' });
    t.resolver.panelPublished('A');
    assert.equal(t.resolver.gate('A'), null);
});

test('a result that arrives after the table was opened, closed and the cells changed is void', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    t.cells.key = 'k2';
    t.builds[0].finish({ passing: [], seen: [] });
    await tick();
    assert.equal(t.published.length, 0, 'it is for cells nobody shows');
    assert.notEqual(t.resolver.status('A').state, 'ready');
});

test('opening claims before the build loads: no second copy of the rows', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');           // queued, nothing built yet
    t.resolver.claim('A');
    await tick(20);
    assert.equal(t.builds.length, 0, 'the claim took the table out of the queue');
});

test('an opened table that is refused, fails or is cancelled is said, not read as empty', () => {
    const t = fake();
    t.resolver.claim('A');
    t.resolver.panelSettled('A', 'refused', 'no room');
    assert.deepEqual([t.resolver.gate('A').state, t.resolver.gate('A').reason], ['refused', 'memory']);
    t.resolver.claim('A');
    assert.equal(t.resolver.gate('A').reason, 'opening', 'a new try clears the old answer');
    t.resolver.panelSettled('A', 'failed', 'boom');
    assert.deepEqual([t.resolver.gate('A').state, t.resolver.gate('A').reason], ['failed', 'boom']);
    t.resolver.claim('A');
    t.resolver.panelSettled('A', 'empty');
    assert.equal(t.resolver.gate('A'), null);
});

test('a table closed while it opens releases the plots; closing keeps no build running', () => {
    const t = fake();
    t.resolver.claim('A');
    const told = t.notified.length;
    t.resolver.panelClosed('A');
    assert.equal(t.resolver.gate('A'), null);
    assert.equal(t.notified.length, told + 1, 'the plots that waited are told');
});

test('a deleted table ends its build and leaves no record', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    t.resolver.drop('A');
    t.builds[0].finish({ passing: [], seen: [] });
    await tick();
    assert.equal(t.published.length, 0);
    assert.equal(t.resolver.status('A').state, 'idle');
});

test('other cells end the builds for the old ones and void what was decided', async () => {
    const t = fake({ rows: 300000 });
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    t.resolver.confirm('A');
    await tick();
    assert.equal(t.resolver.building, 'A');
    t.cells.key = 'k2';
    t.resolver.cellsChanged();
    await tick();
    assert.equal(t.builds[0].job.signal.aborted, true);
    assert.equal(t.resolver.need('A', 'p').state, 'ask', 'the click was for the old cells');
});

test('a dataset switch or a panel set loaded stops everything', async () => {
    const t = fake();
    Object.assign(t.wanted, { p: 'A', q: 'B' });
    t.resolver.need('A', 'p');
    t.resolver.need('B', 'q');
    await tick();
    t.resolver.reset();
    await tick(20);
    assert.equal(t.builds[0].job.signal.aborted, true);
    assert.equal(t.builds.length, 1, 'the queued one does not start');
    assert.equal(t.published.length, 0);
});

test('a build that fails says why, once, and Retry builds again', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    t.builds[0].fail(new Error('a column could not be read'));
    await tick();
    const s = t.resolver.need('A', 'p');
    assert.deepEqual([s.state, s.reason], ['failed', 'a column could not be read']);
    await tick(20);
    assert.equal(t.builds.length, 1, 'no loop of retries');
    t.resolver.retry('A');
    await tick(20);
    assert.equal(t.builds.length, 2);
});

// ---------------------------------------------------------------- chains and cycles

test('a cycle is found, named, and stops resolution without throwing', async () => {
    assert.deepEqual(findCycle('A', (id) => ({ A: ['B'], B: ['A'] })[id] || []), ['A', 'B', 'A']);
    assert.equal(findCycle('A', (id) => ({ A: ['B'], B: ['C'] })[id] || []), null);
    assert.deepEqual(findCycle('A', (id) => ({ A: ['A'] })[id] || []), ['A', 'A']);
    const t = fake({ depends: { A: ['B'], B: ['A'] } });
    t.wanted.p = 'A';
    const s = t.resolver.need('A', 'p');
    assert.equal(s.state, 'cycle');
    assert.deepEqual(s.cycle, ['A', 'B', 'A']);
    await tick();
    assert.equal(t.builds.length, 0, 'it computes nothing');
});

test('a chain is resolved upstream first', () => {
    const depends = (id) => ({ plotTable: ['mid'], mid: ['base'] })[id] || [];
    assert.equal(depthOf('base', depends), 0);
    assert.equal(depthOf('mid', depends), 1);
    assert.equal(depthOf('plotTable', depends), 2);
    assert.ok(depthOf('x', (id) => ({ x: ['y'], y: ['x'] })[id] || []) <= 2, 'a cycle does not loop');
});

// ---------------------------------------------------------------- what a plot says

test('every unresolved state has its sentence and its way out', () => {
    const states = {
        waiting: [{ state: 'waiting' }, 'Building filter', /^Waiting to build 'T'/],
        opening: [{ state: 'waiting', reason: 'opening' }, 'Opening table', /^Waiting for 'T' to open/],
        building: [{ state: 'building' }, 'Building filter', /^Building 'T'/],
        ask: [{ state: 'ask' }, 'Filter not built', /will pause the page for a few seconds/],
        size: [{ state: 'refused', reason: 'size', rows: 2000000 }, 'Filter not applied', /too large to build here \(2,000,000 rows\)/],
        memory: [{ state: 'refused', reason: 'memory' }, 'Filter not applied', /Not enough browser memory/],
        failed: [{ state: 'failed', reason: 'boom' }, 'Filter not applied', /could not be built: boom/],
        cycle: [{ state: 'cycle', cycle: ['T', 'U', 'T'] }, 'Filter not applied', /'T' and 'U' depend on each other/]
    };
    for (const [name, [status, tag, text]] of Object.entries(states)) {
        const said = describeUnresolved(status, 'T', (id) => id);
        assert.equal(said.tag, tag, name);
        assert.match(said.text, text, name);
        assert.ok(said.actions.some(a => a[0] === 'table-filter-off'), `${name}: Stop filtering`);
        assert.ok(said.tag.length <= 20, `${name}: the tag stays short`);
    }
    assert.ok(describeUnresolved({ state: 'ask' }, 'T').actions.some(a => a[0] === 'build-filter'));
    assert.ok(describeUnresolved({ state: 'failed', reason: 'x' }, 'T').actions.some(a => a[0] === 'retry-filter'));
    assert.ok(describeUnresolved({ state: 'refused', reason: 'size' }, 'T').actions.some(a => a[0] === 'reopen-table'));
});

// ---------------------------------------------------------------- cancel

test('Cancel stops the load phase and returns to Build filter, whatever the size', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    assert.equal(t.resolver.status('A').state, 'building');
    assert.equal(t.resolver.cancel('A'), true);
    await tick();
    assert.equal(t.builds[0].job.signal.aborted, true);
    assert.equal(t.resolver.need('A', 'p').state, 'ask');
    await tick(20);
    assert.equal(t.builds.length, 1, 'nothing restarts by itself');
    t.resolver.confirm('A');
    await tick(20);
    assert.equal(t.builds.length, 2, 'Build filter builds again');
});

test('the last step cannot be cancelled, and the notice says so', async () => {
    const t = fake();
    t.wanted.p = 'A';
    t.resolver.need('A', 'p');
    await tick();
    const entering = t.builds[0].job.enter();
    assert.equal(t.resolver.status('A').frozen, true);
    assert.equal(t.resolver.cancel('A'), false);
    const said = describeUnresolved(t.resolver.status('A'), 'T');
    assert.match(said.text, /cannot be cancelled/);
    assert.ok(!said.actions.some(a => a[0] === 'cancel-filter'));
    await entering;
    assert.ok(describeUnresolved({ state: 'building' }, 'T').actions.some(a => a[0] === 'cancel-filter'));
});
