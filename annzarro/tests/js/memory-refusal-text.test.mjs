/**
 * The sentence beside a refused control (static/js/utils/memory-guard-ui.js
 * refusalText): the guard's reason, then the ways out. A browser that cannot allocate
 * is not helped by closing other plots, so that advice goes.
 *
 * Run:  node --test annzarro/tests/js/memory-refusal-text.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}), querySelectorAll: () => [] };
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { refusalText, refusalPanel } = await import('../../../static/js/utils/memory-guard-ui.js');
const ADVICE = 'Close a plot, or show fewer cells (a smaller subset).';

test('memory: the reason and both ways out', () => {
    assert.equal(refusalText({ binding: 'total', why: 'needs ~16 GB of browser memory; 12 GB free (of 12 GB, estimated)' }, ADVICE),
        'Needs ~16 GB of browser memory; 12 GB free (of 12 GB, estimated). Close a plot, or show fewer cells (a smaller subset).');
});

test('the browser cannot allocate: only a smaller step helps', () => {
    assert.equal(refusalText({ binding: 'alloc', why: 'this browser cannot allocate the ~6.0 GB the export needs' }, ADVICE),
        'This browser cannot allocate the ~6.0 GB the export needs. Show fewer cells (a smaller subset).');
});

const near = { hopeless: false, doomed: false, why: 'needs ~7 MB; 4 MB free with 3 plots open (of 4.0 GB, estimated)' };
const hopeless = { hopeless: true, doomed: true, emptyName: 'heap', emptyNeedBytes: 34e9, emptyLimitBytes: 4.0e9 };
const actionNames = (panel) => panel.actions.map(([a]) => a);

test('a refusal closing panels can fix keeps the ways out it had', () => {
    const t = refusalPanel({ result: near, kind: 'cell-table', n: 1000, checkAt: () => ({ fits: false }), anyway: 'Load anyway' });
    assert.equal(t.headline, 'Not loaded: not enough browser memory');
    assert.deepEqual(actionNames(t), ['subset-half', 'subset', 'close-others', 'draw-anyway']);
    const g = refusalPanel({ result: near, kind: 'gene-plot', n: 1000, checkAt: () => ({ fits: false }), anyway: 'Draw anyway' });
    assert.equal(g.headline, 'Not drawn: not enough browser memory');
    assert.deepEqual(actionNames(g), ['close-others', 'draw-anyway']);
});

test('an empty page cannot hold a Cell Table: say so, offer the subset that fits, no close-others', () => {
    const fits = m => ({ fits: m <= 12_345_678 });
    const t = refusalPanel({ result: hopeless, kind: 'cell-table', n: 95_624_334, checkAt: fits, anyway: 'Load anyway' });
    assert.equal(t.headline, 'Too many rows for this browser');
    assert.equal(t.why, '95.6M rows need ~34 GB; this browser gives a page at most 4.0 GB of JS memory.');
    // half of 95.6M would not fit, and neither would the margin-free estimate: no "Half the cells", no "Load anyway"
    assert.deepEqual(actionNames(t), ['subset-n:12300000', 'subset']);
    assert.equal(t.actions[0][1], 'Show 12,300,000 cells');
    assert.ok(12_300_000 <= 12_345_678);
    assert.equal(t.risk, null);
    // an estimate that fits without the margin leaves "Load anyway", with its risk
    const edge = refusalPanel({ result: { ...hopeless, doomed: false }, kind: 'cell-table', n: 95_624_334, checkAt: fits, anyway: 'Load anyway' });
    assert.deepEqual(actionNames(edge), ['subset-n:12300000', 'subset', 'draw-anyway']);
    assert.match(edge.risk, /^Load anyway may run the tab out of memory/);
});

test('nothing fits at all: only Subset remains for cells; genes say there is no subset', () => {
    const none = () => ({ fits: false });
    const t = refusalPanel({ result: hopeless, kind: 'cell-plot', n: 95_624_334, checkAt: none, anyway: 'Draw anyway' });
    assert.equal(t.headline, 'Too many points for this browser');
    assert.deepEqual(actionNames(t), ['subset']);
    const g = refusalPanel({ result: hopeless, kind: 'gene-table', n: 60_000_000, checkAt: none, anyway: 'Load anyway' });
    assert.deepEqual(actionNames(g), []);
    assert.match(g.why, /^60M rows need ~34 GB;.* Genes cannot be subset/);
});

test('a table caps "Show N cells" below the memory fit; a plot keeps the memory fit', () => {
    const fits = m => ({ fits: m <= 9_080_000 });
    const t = refusalPanel({ result: hopeless, kind: 'cell-table', n: 95_624_334, checkAt: fits, anyway: 'Load anyway', cap: 1_000_000 });
    assert.equal(t.actions[0][1], 'Show 1,000,000 cells');
    assert.equal(t.actions[0][0], 'subset-n:1000000');
    // the cap above the fit changes nothing
    const above = refusalPanel({ result: hopeless, kind: 'cell-table', n: 95_624_334, checkAt: fits, anyway: 'Load anyway', cap: 50_000_000 });
    assert.equal(above.actions[0][1], 'Show 9,080,000 cells');
    const p = refusalPanel({ result: hopeless, kind: 'cell-plot', n: 95_624_334, checkAt: fits, anyway: 'Draw anyway' });
    assert.equal(p.actions[0][1], 'Show 9,080,000 cells');
});
