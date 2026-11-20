/**
 * The one registry of the actions a notice offers (static/js/utils/source-actions.js), and its contract: for every
 * provider, every action and every state of its host, "available" and "run" agree. A base provider answered
 * available for every action while run() refused most of them, and "Offer it again" did nothing.
 *
 * Run:  node --test annzarro/tests/js/source-actions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../../../static/js/utils/source-actions.js');
const SS = await import('../../../static/js/utils/score-source.js');
const TU = await import('../../../static/js/panels/table-utilities/table-score-ui.js');

/** The contract, for one registry over the hosts it may be asked about. Returns the number of (action, host) pairs checked. */
function checkContract(registry, hosts, spies) {
    let checked = 0;
    for (const host of hosts) {
        for (const name of A.actions.known) {
            const before = spies.map(s => s.calls);
            const available = registry.available(name, host);
            assert.equal(typeof available, 'boolean', `${name}: available answers true or false`);
            assert.deepEqual(spies.map(s => s.calls), before, `${name}: asking changes nothing`);
            const ran = registry.run(name, host);
            assert.equal(ran, available, `${name} on ${host.name}: available() is ${available} but run() is ${ran}`);
            if (!available) assert.deepEqual(spies.map(s => s.calls), before, `${name} on ${host.name}: an unavailable action does nothing`);
            checked++;
        }
    }
    return checked;
}

test('an action is available exactly when it runs, for every action of a fake provider', () => {
    const spy = { calls: 0 };
    const registry = A.actions.fresh();
    registry.register({
        id: 'fake',
        owns: (host) => host.owned,
        actions: {
            'score-compute': { target: (host) => host.can ? host : null, run: () => { spy.calls++; } },
            'score-offer': { target: () => null, run: () => { spy.calls++; } }
        }
    });
    const hosts = [{ name: 'can', owned: true, can: true }, { name: 'cannot', owned: true, can: false }, { name: 'foreign', owned: false, can: true }];
    assert.equal(checkContract(registry, hosts, [spy]), hosts.length * A.actions.known.length);
    assert.equal(registry.run('score-compute', hosts[0]), true);
    assert.equal(spy.calls > 0, true);
    assert.equal(registry.available('score-offer', hosts[0]), false, 'a target of null is not available');
    assert.equal(registry.available('score-choose', hosts[0]), false, 'an action the provider lacks');
    assert.equal(registry.available('score-compute', hosts[2]), false, 'a host nobody owns');
});

test('a provider cannot name an action the registry does not know, nor share an id', () => {
    const registry = A.actions.fresh();
    assert.throws(() => registry.register({ id: 'x', owns: () => true, actions: { 'score-bogus': { target: () => 1, run() {} } } }), /Unknown action/);
    registry.register({ id: 'x', owns: () => true, actions: {} });
    assert.throws(() => registry.register({ id: 'x', owns: () => true, actions: {} }), /already/);
    assert.throws(() => registry.register({ id: 'y', owns: () => true, actions: { 'score-open': { target: () => 1 } } }), /run/);
});

test('run is decided by the target, so a handler cannot answer true and then refuse', () => {
    const registry = A.actions.fresh();
    let ran = 0;
    registry.register({ id: 'p', owns: () => true, actions: { 'score-open': { target: () => 'there', run: (target) => { ran += target === 'there' ? 1 : 100; return false; } } } });
    assert.equal(registry.run('score-open', {}), true, 'what a handler returns is not the answer');
    assert.equal(ran, 1);
});

// ------------------------------------------------------- the plot provider and the table provider

function spied(fn, spy) { return (...args) => { spy.calls++; return fn(...args); }; }

test('the plot provider: every action of every state of its host agrees with itself', () => {
    const spy = { calls: 0 };
    const lonely = { rec: null };
    const make = (over) => SS.createPlotActions({
        shownRecord: (host) => host.rec,
        recordsOf: (host) => new Map(host.rec ? [['color', host.rec]] : []),
        sourcePanel: (id) => (id === 'sig' ? { id } : null),
        canOffer: (setting) => !!setting && setting.key === 'sig',
        offerAgain: spied(() => true, spy),
        update: spied(() => true, spy),
        openSource: spied(() => ({}), spy),
        chooser: (host) => host.chooser || null,
        panelIdOf: () => 'plot-1',
        ...over
    });
    const rec = (over) => ({ sigId: 'sig', setting: { key: 'sig' }, role: 'color',
        handle: { compute: spied(() => true, spy), cancel: spied(() => true, spy), retry: spied(() => true, spy) }, ...over });
    const hosts = [
        { name: 'no records', rec: null },
        { name: 'a record', rec: rec(), chooser: { focus: spied(() => {}, spy) } },
        { name: 'a record whose source is gone', rec: rec({ sigId: 'gone', setting: { key: 'gone' } }) },
        { name: 'a record without a chooser', rec: rec() }
    ];
    const registry = A.actions.fresh();
    registry.register(make({}));
    assert.ok(checkContract(registry, hosts, [spy]) >= 4 * A.actions.known.length);
    assert.equal(registry.available('score-offer', hosts[2]), false, 'offering again to a source that is gone');
    assert.equal(registry.available('score-open', hosts[2]), false);
    assert.equal(registry.available('score-choose', hosts[3]), false, 'no select to focus');
    assert.equal(registry.available('score-choose', hosts[1]), true);
    assert.equal(registry.available('score-compute', lonely), false);
});

test('the table provider: every action of every state of its host agrees with itself', () => {
    const spy = { calls: 0 };
    const columns = (over) => ({ column: { key: 'sig' }, ...over });
    const make = () => TU.createTableActions({
        tableIdOf: (host) => host.table || null,
        hasColumns: (id) => id === 't1',
        worstOf: (host) => host.worst || null,
        compute: spied(() => {}, spy), cancel: spied(() => {}, spy), retry: spied(() => {}, spy), update: spied(() => {}, spy),
        canOffer: (setting) => setting.key === 'sig',
        offerAgain: spied(() => true, spy),
        panelOf: (id) => (id === 'sig' ? {} : id === 't1' ? { removeColumn: spied(() => {}, spy) } : null),
        openSource: spied(() => ({}), spy)
    });
    const hosts = [
        { name: 'not a table', table: null },
        { name: 'a table with no score columns', table: 't2' },
        { name: 'a table, nothing to say', table: 't1', worst: null },
        { name: 'a table with a worst column', table: 't1', worst: columns() },
        { name: 'a worst column of a source that is gone', table: 't1', worst: columns({ column: { key: 'gone' } }) }
    ];
    const registry = A.actions.fresh();
    registry.register(make());
    checkContract(registry, hosts, [spy]);
    assert.equal(registry.available('score-offer', hosts[4]), false);
    assert.equal(registry.available('score-open', hosts[4]), false);
    assert.equal(registry.available('score-offer', hosts[3]), true);
    assert.equal(registry.available('score-remove', hosts[3]), true);
    assert.equal(registry.available('score-choose', hosts[3]), false, 'a table has no other source to choose');
    assert.equal(registry.available('score-compute', hosts[1]), false);
    assert.equal(registry.available('score-compute', hosts[2]), true);
});

test('the page registers the plot provider and the table provider, once each', () => {
    assert.deepEqual(A.actions.providerIds().sort(), ['plot-score', 'table-score']);
    // the contract also holds over the registry the page uses, for a host nobody owns
    const spy = { calls: 0 };
    assert.equal(checkContract(A.actions, [{ name: 'a stray element' }], [spy]), A.actions.known.length);
});
