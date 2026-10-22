// Back and Forward as an undo of the view: when a settled change starts a
// history entry, and what a step changes on screen (utils/url-history.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPolicy, diffViews, layoutStep, stableStringify, MERGE_MS } from '../../../static/js/utils/url-history.js';

const run = (policy, steps) => steps.map(([now, path, capped]) => {
    const how = policy.decide({ now, path });
    policy.written({ now, path, capped });
    return how;
});

test('the first view of a tab replaces: Back from it leaves the app', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a.zarr']]), ['replace']);
});

test('an address that already holds the first view is the entry to start from', () => {
    const p = createHistoryPolicy();
    p.baseline({ path: 'a' });
    assert.equal(p.decide({ now: 50000, path: 'a' }), 'push');
    const welcome = createHistoryPolicy();
    welcome.baseline({ path: '' });
    assert.equal(welcome.decide({ now: 50000, path: 'a' }), 'replace');
});

test('the first dataset opened from the welcome screen replaces', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, ''], [5000, 'a.zarr'], [10000, 'a.zarr']]),
        ['replace', 'replace', 'push']);
});

test('the first write, which only puts the opening view in the address, merges with nothing', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a'], [100, 'a']]), ['replace', 'push']);
});

test('changes of one action (closer than the merge window) share an entry', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a'], [10000, 'a'], [10000 + MERGE_MS - 1, 'a']]),
        ['replace', 'push', 'replace']);
});

test('settled changes further apart than the window are separate entries', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a'], [5000, 'a'], [10000, 'a']]),
        ['replace', 'push', 'push']);
});

test('a sync forced by the maximum wait continues the gesture: the next replaces', () => {
    // a 10 s drag: pushed once at its first write, then written at the 3 s cap twice, then quiet
    const p = createHistoryPolicy();
    assert.deepEqual(run(p, [[0, 'a'], [10000, 'a', true], [13000, 'a', true], [16000, 'a', false], [30000, 'a']]),
        ['replace', 'push', 'replace', 'replace', 'push']);
});

test('another dataset pushes at once, even right after a change', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a'], [5000, 'a'], [5100, 'b']]),
        ['replace', 'push', 'push']);
});

test('a view with no dataset replaces', () => {
    assert.deepEqual(run(createHistoryPolicy(), [[0, 'a'], [5000, '']]), ['replace', 'replace']);
});

test('after Back or Forward the next change is a new action', () => {
    const p = createHistoryPolicy();
    run(p, [[0, 'a'], [5000, 'a']]);
    p.landed({ now: 6000, path: 'a' });
    assert.equal(p.decide({ now: 6100, path: 'a' }), 'replace');     // panels still settling: not an action
    assert.equal(p.decide({ now: 9100, path: 'a' }), 'push');
});

test('stableStringify ignores key order', () => {
    assert.equal(stableStringify({ a: 1, b: { d: [1, { y: 2, x: 1 }], c: 3 } }),
        stableStringify({ b: { c: 3, d: [1, { x: 1, y: 2 }] }, a: 1 }));
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

const tile = (id) => ({ type: 'tile', id });
const view = (configs, controls = {}, hierarchy = [tile('cell-plot-1'), tile('cell-plot-2')]) =>
    ({ layout: { hierarchy, panelConfigs: configs, controlState: controls } });
const ctx = { samePath: true, sameSubset: true };

test('another dataset or other cells reload the view', () => {
    const v = view({});
    assert.equal(diffViews(v, v, { samePath: false, sameSubset: true }).kind, 'reload');
    assert.equal(diffViews(v, v, { samePath: true, sameSubset: false }).kind, 'reload');
    assert.equal(diffViews(v, null, ctx).kind, 'reload');
});

test('a different arrangement rebuilds the layout around the unchanged panels', () => {
    const c1 = { id: 'cell-plot-1', size: 4 };
    const a = view({ 'cell-plot-1': c1 }, {}, [tile('cell-plot-1')]);
    const b = view({ 'cell-plot-1': c1, 'cell-plot-2': { id: 'cell-plot-2' } }, {}, [tile('cell-plot-1'), tile('cell-plot-2')]);
    assert.deepEqual(diffViews(a, b, ctx), { kind: 'layout', keep: ['cell-plot-1'] });
    assert.deepEqual(diffViews(b, a, ctx), { kind: 'layout', keep: ['cell-plot-1'] });
    // a panel whose settings changed as well is not kept
    const c = view({ 'cell-plot-1': { id: 'cell-plot-1', size: 9 }, 'cell-plot-2': { id: 'cell-plot-2' } }, {},
        [tile('cell-plot-1'), tile('cell-plot-2')]);
    assert.deepEqual(diffViews(a, c, ctx), { kind: 'layout', keep: [] });
});

test('the same arrangement rebuilds only the panels whose settings differ', () => {
    const a = view({ 'cell-plot-1': { id: 'cell-plot-1', size: 4, x: 1 }, 'cell-plot-2': { id: 'cell-plot-2', size: 4 } });
    // key order differs, values equal for plot 2
    const b = view({ 'cell-plot-1': { id: 'cell-plot-1', size: 9, x: 1 }, 'cell-plot-2': { size: 4, id: 'cell-plot-2' } });
    assert.deepEqual(diffViews(a, b, ctx), { kind: 'panels', panels: ['cell-plot-1'], controls: [] });
    assert.deepEqual(diffViews(a, a, ctx), { kind: 'panels', panels: [], controls: [] });
});

test('a control bar shown or hidden is toggled, not rebuilt', () => {
    const configs = { 'cell-plot-1': { id: 'cell-plot-1' }, 'cell-plot-2': { id: 'cell-plot-2' } };
    const a = view(configs, { 'cell-plot-1': true, 'cell-plot-2': true });
    const b = view(configs, { 'cell-plot-1': true, 'cell-plot-2': false });
    assert.deepEqual(diffViews(a, b, ctx), { kind: 'panels', panels: [], controls: ['cell-plot-2'] });
});

test('a point size that follows the plot area is not a difference', () => {
    const a = view({ 'cell-plot-1': { id: 'cell-plot-1', autoPointSize: true, pointSize: 4.7 } }, {}, [tile('cell-plot-1')]);
    const b = view({ 'cell-plot-1': { id: 'cell-plot-1', autoPointSize: true, pointSize: 5.1 } }, {}, [tile('cell-plot-1')]);
    assert.deepEqual(diffViews(a, b, ctx), { kind: 'panels', panels: [], controls: [] });
    const c = view({ 'cell-plot-1': { id: 'cell-plot-1', autoPointSize: false, pointSize: 4.7 } }, {}, [tile('cell-plot-1')]);
    const d = view({ 'cell-plot-1': { id: 'cell-plot-1', autoPointSize: false, pointSize: 5.1 } }, {}, [tile('cell-plot-1')]);
    assert.deepEqual(diffViews(c, d, ctx).panels, ['cell-plot-1']);
});

const split = (a, b, pcts = [50, 50]) => ({
    type: 'split', direction: 'horizontal', panes: pcts.map(percentage => ({ percentage })), children: [tile(a), tile(b)]
});
const at = (hierarchy) => ({ layout: { hierarchy } });

test('a layout step that is one close, one open or a moved split is named', () => {
    const one = at([tile('cell-plot-1'), { type: 'selector' }]);
    const two = at([tile('cell-plot-1'), tile('cell-plot-2'), { type: 'selector' }]);
    assert.deepEqual(layoutStep(two, one), { op: 'close', id: 'cell-plot-2' });
    assert.deepEqual(layoutStep(one, two), { op: 'open', id: 'cell-plot-2', where: 'row' });
    const pair = at([split('cell-plot-1', 'cell-plot-2')]);
    const solo = at([tile('cell-plot-1')]);
    assert.deepEqual(layoutStep(pair, solo), { op: 'close', id: 'cell-plot-2' });
    assert.deepEqual(layoutStep(solo, pair),
        { op: 'open', id: 'cell-plot-2', where: 'pane', sibling: 'cell-plot-1', direction: 'horizontal' });
    assert.deepEqual(layoutStep(pair, at([split('cell-plot-1', 'cell-plot-2', [30, 70])])), { op: 'resize' });
    assert.deepEqual(layoutStep(pair, at([{ ...split('cell-plot-1', 'cell-plot-2'), height: 500 }])), { op: 'resize' });
});

test('a layout step of several changes is not a single move', () => {
    const pair = at([split('cell-plot-1', 'cell-plot-2')]);
    assert.equal(layoutStep(at([tile('cell-plot-1')]), pair.layout.hierarchy.length && at([split('cell-plot-2', 'cell-plot-1')])), null);
    // a panel opened first in its split cannot be made by hand: rebuilt
    assert.equal(layoutStep(at([tile('cell-plot-1')]), at([split('cell-plot-2', 'cell-plot-1')])), null);
    // the same panels, arranged differently
    assert.equal(layoutStep(pair, at([tile('cell-plot-1'), tile('cell-plot-2')])), null);
});

test('several opens and closes in one step play together', () => {
    const solo = at([tile('cell-plot-1')]);
    const three = at([tile('cell-plot-1'), tile('cell-plot-2'), tile('cell-plot-3')]);
    assert.deepEqual(layoutStep(solo, three), { op: 'multi', steps: [
        { op: 'open', id: 'cell-plot-2', where: 'row' }, { op: 'open', id: 'cell-plot-3', where: 'row' }] });
    // one panel replaced by another
    const swapped = layoutStep(at([split('cell-plot-1', 'cell-plot-2')]), at([split('cell-plot-1', 'cell-plot-3')]));
    assert.deepEqual(swapped, { op: 'multi', steps: [
        { op: 'close', id: 'cell-plot-2' },
        { op: 'open', id: 'cell-plot-3', where: 'pane', sibling: 'cell-plot-1', direction: 'horizontal' }] });
    assert.deepEqual(layoutStep(three, solo).steps.map(s => s.op), ['close', 'close']);
});

const keyed = (p, steps) => steps.map(([now, key, extra = {}]) => {
    const how = p.decide({ now, path: 'a', key, ...extra });
    p.written({ now, path: 'a', key, capped: extra.capped });
    return how;
});

test('discrete actions are separate entries however soon they follow', () => {
    // close a panel, open another 200 ms later
    assert.deepEqual(keyed(createHistoryPolicy(), [[0, 'x'], [10000, 'close'], [10200, 'open']]),
        ['replace', 'push', 'push']);
});

test('repeated input of one control is one entry; another control is another', () => {
    // five clicks on one spinner, then a slider drag
    assert.deepEqual(keyed(createHistoryPolicy(), [[0, 'x'], [10000, 'spin'], [10300, 'spin'], [10600, 'spin'],
        [10900, 'spin'], [11200, 'spin']]), ['replace', 'push', 'replace', 'replace', 'replace', 'replace']);
    // control X, then control Y 300 ms later
    assert.deepEqual(keyed(createHistoryPolicy(), [[0, 'x'], [10000, 'X'], [10300, 'Y']]), ['replace', 'push', 'push']);
    // back to X after Y is a new action
    assert.deepEqual(keyed(createHistoryPolicy(), [[0, 'x'], [10000, 'X'], [10300, 'Y'], [10600, 'X']]),
        ['replace', 'push', 'push', 'push']);
});

test('the settling of one action, written in several goes, shares its entry; a long pause does not', () => {
    assert.deepEqual(keyed(createHistoryPolicy(), [[0, 'x'], [10000, 'open'], [10900, 'open'], [11800, 'open'], [20000, 'open']]),
        ['replace', 'push', 'replace', 'replace', 'push']);
});

test('a user action right after Back starts an entry; panels settling there do not', () => {
    const p = createHistoryPolicy();
    keyed(p, [[0, 'x'], [10000, 'a1']]);
    p.landed({ now: 12000, path: 'a' });
    assert.equal(p.decide({ now: 12500, path: 'a', key: 'a1', acted: false }), 'replace');
    assert.equal(p.decide({ now: 12500, path: 'a', key: 'a2', acted: true }), 'push');
});
