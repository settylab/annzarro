/**
 * What a panel set's Load buttons do (utils/panelset-load.js): one primary
 * Load, and icons for its ablations; the badge of where its dataset is.
 *
 * Run:  node --test annzarro/tests/js/panelset-load.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { loadChoices, describeStatus, modeOptions, MODES } =
    await import('../../../static/js/utils/panelset-load.js');

const by = (choices, mode) => choices.actions.find(a => a.mode === mode);
const here = { found: true, hasCurrent: true, currentName: 'bm_aging.zarr', open: 2, total: 5 };

test('a set whose dataset is here: Load switches and opens, three icons', () => {
    const c = loadChoices(here);
    assert.deepEqual([c.primary.mode, c.primary.label], ['full', 'Load']);
    assert.match(c.primary.title, /open 2 panels/);
    assert.deepEqual(c.actions.filter(a => a.visible).map(a => a.mode), ['current', 'add']);
    assert.ok(c.actions.filter(a => a.visible).every(a => a.enabled));
    assert.match(by(c, 'add').title, /5 panels/);
});

test('"Load on the current dataset" is disabled, with the reason, when no dataset is open', () => {
    const c = loadChoices({ ...here, hasCurrent: false, currentName: '' });
    assert.equal(c.primary.mode, 'full');
    const current = by(c, 'current');
    assert.equal(current.enabled, false);
    assert.match(current.title, /no dataset is open/);
    assert.equal(by(c, 'closed'), undefined);      // no "panels closed" button
});

test('a set with no panel open: Load says so and lists the panels closed', () => {
    const c = loadChoices({ ...here, open: 0 });
    assert.equal(c.primary.label, 'Load (no panels were open)');
    assert.equal(c.primary.mode, 'full');
});

test('a dataset that is not here: Load becomes "Load on the current dataset", with a Choose icon', () => {
    const c = loadChoices({ ...here, found: false });
    assert.deepEqual([c.primary.mode, c.primary.label], ['current', 'Load on the current dataset']);
    assert.match(c.primary.title, /bm_aging\.zarr/);
    // the ablation that is now the primary is not repeated
    assert.equal(by(c, 'current').visible, false);
    assert.equal(by(c, 'choose').visible, true);
    assert.equal(by(c, 'add').enabled, true);
});

test('a dataset that is not here and none open: the primary chooses one', () => {
    const c = loadChoices({ found: false, hasCurrent: false, open: 1, total: 1 });
    assert.deepEqual([c.primary.mode, c.primary.label], ['choose', 'Choose dataset…']);
    assert.equal(by(c, 'choose').visible, false);      // not repeated
    assert.equal(by(c, 'current').enabled, false);
});

test('a set that names no dataset uses the open one, or asks for one', () => {
    assert.equal(loadChoices({ found: null, hasCurrent: true, open: 1, total: 1 }).primary.mode, 'full');
    assert.equal(loadChoices({ found: null, hasCurrent: false, open: 1, total: 1 }).primary.mode, 'choose');
});

test('before the set is known the buttons still have labels and tooltips', () => {
    const c = loadChoices({ hasCurrent: true });
    assert.equal(c.primary.label, 'Load');
    assert.ok(c.actions.every(a => a.title.length > 10));
});

test('every mode maps to what it does to the dataset and to the panels', () => {
    assert.deepEqual(MODES, ['full', 'current', 'add', 'choose']);
    const flags = m => { const o = modeOptions(m); return [o.keepDataset, o.add, o.choose].map(Number).join(''); };
    //            keep add choose
    assert.equal(flags('full'), '000');       // switch dataset, open the panels
    assert.equal(flags('current'), '100');    // keep the dataset, open the panels
    assert.equal(flags('add'), '110');        // keep dataset and open panels, add closed
    assert.equal(flags('choose'), '001');     // pick a dataset, then as Load
    assert.equal(flags('anything else'), '000');
});

test('the badge: available, missing (with the reason) or none', () => {
    assert.equal(describeStatus({ named: 'a.zarr', found: true }).text, '✓ available here');
    const moved = describeStatus({ named: 'a.zarr', found: true, foundPath: 'b/a2.zarr', repointed: { from: 'a.zarr' } });
    assert.match(moved.title, /same cells and genes/);
    const gone = describeStatus({ named: 'a.zarr', found: false });
    assert.equal(gone.text, 'not found here');
    assert.equal(gone.state, 'missing');
    assert.match(gone.title, /not on this server/);
    assert.match(describeStatus({ named: 'a.zarr', found: false, refused: { path: 'a.zarr' } }).title, /outside the data directory/);
    assert.match(describeStatus({ named: 'a.zarr', found: false, failed: { error: 'boom' } }).title, /boom/);
    assert.equal(describeStatus({ named: null, found: null }).text, '');
    assert.equal(describeStatus(null).state, 'pending');
});
