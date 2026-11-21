/**
 * Loops prevented at the moment of choice (operator decision 15): `wouldLoop(panelId, candidateId)` in
 * static/js/utils/panel-references.js says whether naming the candidate as a reference of the panel would close a
 * cycle, over the mixed graph that the cycle state reads (`dependsOn`), and `loopReason` says why an option is
 * unavailable.
 *
 * Run:  node --test annzarro/tests/js/would-loop.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const refs = await import('../../../static/js/utils/panel-references.js');
const { registerReferences, registerPanelSourceType, setReferenceHost, dependsOn, wouldLoop, loopReason } = refs;
const { findCycle } = await import('../../../static/js/utils/table-resolver.js');
const { getColumnKey } = await import('../../../static/js/utils/column-key.js');

// a grouping-like panel type: its factors name tables, scores and other groupings
registerPanelSourceType('fake-group');
registerReferences('fake-grouping', (cfg) => (Array.isArray(cfg.partitionings) ? cfg.partitionings : [])
    .map((p) => p && p.source)
    .filter((s) => s && typeof s.key === 'string' && ['table', 'gene-score', 'fake-group'].includes(s.type))
    .map((s) => ({ id: s.key, via: 'partitioning', get: () => s.key, set: (v) => { s.key = v; } })));

function page(panels) {
    setReferenceHost({
        panel: (id) => (Object.prototype.hasOwnProperty.call(panels, id) ? panels[id] : null),
        ids: () => Object.keys(panels)
    });
    return panels;
}

const grouping = (...sources) => ({ type: 'fake-grouping', config: { partitionings: sources.map((source) => ({ source })) } });
const groupColumn = (key) => ({ type: 'fake-group', key });
/** A cell table with a grouping's column: filtered on it, or only showing it. */
const table = (key, { filtered }) => {
    const column = groupColumn(key);
    const origData = getColumnKey(column);
    return { type: 'cell-table', config: { columns: [column],
        searchBuilderConfig: filtered ? { criteria: [{ origData, condition: '=', value: ['x'] }] } : null } };
};

test('a mixed ring: a grouping of a table filtered on a grouping of a score of a gene table', () => {
    const panels = page({
        g1: grouping({ type: 'table', key: 't1' }),
        t1: table('g2', { filtered: true }),
        g2: grouping({ type: 'gene-score', key: 'gt1', column: 'mean' }),
        gt1: { type: 'gene-table', config: { tableFilter: 'none' } },
        p1: { type: 'cell-plot', config: { color: groupColumn('g1') } }
    });
    // the gene table's filter on g1, or g2 using g1, would close g1 -> t1 -> g2 -> ...
    assert.equal(wouldLoop('g2', 'g1'), true);
    assert.equal(wouldLoop('gt1', 'g1'), true);
    assert.equal(wouldLoop('gt1', 't1'), true);
    // the plot uses g1, and nothing is computed from the plot: anything it names closes no loop
    assert.equal(wouldLoop('p1', 'g2'), false);
    assert.equal(wouldLoop('p1', 'gt1'), false);
    assert.equal(wouldLoop('g1', 'gt1'), false, 'g1 depends on gt1 already: no loop');
    // a panel naming itself
    assert.equal(wouldLoop('g1', 'g1'), true);
    // and the cycle state agrees once the reference is made
    panels.gt1.config.tableFilter = 'g1';
    assert.deepEqual(findCycle('g1', dependsOn), ['g1', 't1', 'g2', 'gt1', 'g1']);
});

test('a column a table only shows is no edge: choosing that table closes no loop', () => {
    page({
        g1: grouping({ type: 'obs', key: 'cell_type' }),
        t3: table('g1', { filtered: false }),
        t4: table('g1', { filtered: true })
    });
    assert.equal(wouldLoop('g1', 't3'), false);
    assert.equal(wouldLoop('g1', 't4'), true);
});

test('a panel or a candidate that does not exist closes nothing', () => {
    page({ g1: grouping({ type: 'table', key: 't1' }) });
    assert.equal(wouldLoop('g1', 'nope'), false);
    assert.equal(wouldLoop('nope', 'g1'), false);
    assert.equal(wouldLoop('', 'g1'), false);
    assert.equal(wouldLoop('g1', null), false);
});

test('a reference menu: the options that would close a loop are unavailable, with the reason', () => {
    const titles = { g1: 'Grouping 1', g2: 'Grouping 2', t1: 'Table 1', t2: 'Table 2' };
    page({
        g1: grouping({ type: 'table', key: 't1' }),
        g2: grouping({ type: 'obs', key: 'batch' }),
        t1: table('g2', { filtered: false }),
        t2: { type: 'cell-table', config: { columns: [] } }
    });
    // Table 1's filter column menu: a grouping's column
    const menu = ['g1', 'g2'].map((id) => {
        const loop = wouldLoop('t1', id);
        return { value: id, text: titles[id], disabled: loop, ...(loop ? { title: loopReason(titles[id], 'table') } : {}) };
    });
    assert.deepEqual(menu, [
        { value: 'g1', text: 'Grouping 1', disabled: true, title: 'Uses Grouping 1, which depends on this table' },
        { value: 'g2', text: 'Grouping 2', disabled: false }
    ]);
});

test('under 1 ms at 50 panels', () => {
    // a chain g0 <- t0 <- g1 <- t1 ... of 50 panels, each grouping by the table before it, each table filtered on the
    // grouping before it, plus a plot per grouping
    const panels = {};
    for (let i = 0; i < 25; i++) {
        panels[`g${i}`] = grouping(i ? { type: 'table', key: `t${i - 1}` } : { type: 'obs', key: 'cell_type' });
        panels[`t${i}`] = table(`g${i}`, { filtered: true });
    }
    page(panels);
    assert.equal(wouldLoop('g0', 't24'), true);
    assert.equal(wouldLoop('t24', 'g0'), false);
    const times = [];
    for (let run = 0; run < 101; run++) {
        const t0 = performance.now();
        wouldLoop('g0', 't24');
        times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    assert.ok(times[50] < 1, `median ${times[50].toFixed(3)} ms at 50 panels`);
});
