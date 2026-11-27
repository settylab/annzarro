/**
 * "Try anyway" in the notices (aggregation-unify-080.md 14.3 to 14.5): which refusals get the button and the tick, the
 * sentence of a refusal that has no way on, the tried run's own words, the new state `stopped`, the panel-level actions
 * of the tick, and the strip's tag "Runs without asking".
 *
 * Run:  node --test annzarro/tests/js/try-anyway-notices.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const SN = await import('../../../static/js/utils/source-notices.js');
const { askPolicy, panelOfHost } = await import('../../../static/js/utils/ask-policy.js');
const { actions } = await import('../../../static/js/utils/source-actions.js');
const { createPainter } = await import('../../../static/js/utils/host-binding.js');

const VOC = { thing: 'signature', source: 'source', result: 'score', Computing: 'Computing' };
const refused = (extra = {}, tried = { allowed: true, max_s: 1800, why: null }) => ({
    state: 'refused', title: 'Pathway score', reason: 'score_too_expensive',
    estimate: { seconds: 840, tier: 'refused', max_s: 600, try: tried }, message: '', ...extra
});
const say = (snap) => SN.withTry(snap, SN.describeSource(snap, { role: 'x' }, VOC));
const ids = (n) => n.actions.map(a => a[0]);

test.afterEach(() => askPolicy.clearAll());

test('a time refusal that may be tried says its estimate and the limit, and offers Try anyway first, with the tick', () => {
    const n = say(refused());
    assert.equal(n.headline, "'Pathway score' was not run: it is estimated at about 14 minutes (runs over 10 minutes are not started by themselves).");
    assert.deepEqual(n.actions[0], ['score-compute', 'Try anyway']);
    assert.equal(n.tick, 'try');
    assert.ok(ids(n).includes('score-choose'), 'the remedies stay');
});

test('a time refusal the server will not try says why in words and offers no button and no tick', () => {
    const big = say(refused({}, { allowed: false, max_s: 1800, why: 'too_long' }));
    assert.match(big.text, /more than ten times the 30 minutes/);
    assert.ok(!ids(big).includes('score-compute'));
    assert.equal(big.tick, undefined);
    const off = say(refused({}, { allowed: false, max_s: 0, why: 'off' }));
    assert.match(off.text, /does not run jobs over the limit/);
    assert.ok(!ids(off).includes('score-compute'));
});

test('a refusal for size has no button and no tick, whatever the estimate says', () => {
    const size = say({ state: 'refused', title: 'G', reason: 'groups_too_expensive', refused: { reason: 'too_many_groups', count: 19000, limit: 2000 },
        estimate: { seconds: 1, tier: 'auto', max_s: 600, try: { allowed: true, max_s: 1800 } } });
    assert.ok(!ids(size).includes('score-compute'));
    assert.equal(size.tick, undefined);
});

test('the question of the confirm tier gains the tick of level confirm; Compute stays Compute', () => {
    const n = say({ state: 'awaiting', title: 'T', estimate: { seconds: 125, tier: 'confirm' } });
    assert.equal(n.tick, 'confirm');
    assert.deepEqual(n.actions[0], ['score-compute', 'Compute']);
});

test('a cancelled run still over the limit offers Try anyway where it offered Compute; under it, Compute', () => {
    const over = say({ state: 'cancelled', title: 'T', estimate: { seconds: 840, tier: 'refused', max_s: 600, try: { allowed: true, max_s: 1800 } } });
    assert.deepEqual(over.actions[0], ['score-compute', 'Try anyway']);
    assert.equal(over.tick, 'try');
    const under = say({ state: 'cancelled', title: 'T', estimate: { seconds: 125, tier: 'confirm', max_s: 600 } });
    assert.deepEqual(under.actions[0], ['score-compute', 'Compute']);
});

test('stopped says the limit of a tried run, the way on and [Try again]; nothing partial is promised', () => {
    const n = SN.describeSource({ state: 'stopped', title: 'Pathway score', limitS: 1800, reason: 'try_time_exceeded' }, {}, VOC);
    assert.equal(n.state, 'stopped');
    assert.equal(n.headline, "'Pathway score' was stopped after 30 minutes, the server's limit for a tried run.");
    assert.equal(n.text, 'Use fewer genes or groups, or a subset.');
    assert.deepEqual(n.actions[0], ['score-compute', 'Try again']);
    assert.equal(n.tag.text, 'Score stopped');
    assert.ok(SN.PRIORITY.includes('stopped'));
});

test('a tried run says it stops by itself, and shows its bar at once', () => {
    const snap = { state: 'computing', title: 'T', forced: true, progress: { done: 0, total: 10, deadline_s: 1800, queue: { ahead: 0, sharing: 0 } },
        estimate: { seconds: 840, try: { allowed: true, max_s: 1800 } } };
    assert.match(SN.describeSource(snap, {}, VOC).text, /Stops by itself after 30 minutes\./);
    assert.ok(SN.progressBar({ ...snap, state: 'computing' }, 0), 'a tried run shows a bar with no clock');
    assert.equal(SN.progressBar({ state: 'computing', progress: { done: 1, total: 10 }, estimate: { seconds: 2 } }, 0), null, 'an ordinary short one does not');
    assert.ok(SN.progressBar({ state: 'computing', unasked: true, progress: { done: 1, total: 10 }, estimate: { seconds: 2 } }, 0), 'one run by the tick does');
});

test('limitText is exact', () => {
    assert.equal(SN.limitText(600), '10 minutes');
    assert.equal(SN.limitText(1800), '30 minutes');
    assert.equal(SN.limitText(3600), '1 hour');
    assert.equal(SN.limitText(45), '45 seconds');
    assert.equal(SN.limitText(0), '');
});

test('the tick actions set and clear the panel level; they are available only where there is a panel', () => {
    const host = { id: 'plot-container-cell-gene-1' };
    assert.equal(panelOfHost(host), 'cell-gene-1');
    assert.equal(actions.available('ask-again', host), false, 'nothing to undo yet');
    assert.equal(actions.run('ask-tick:try', host), true);
    assert.equal(askPolicy.get('cell-gene-1'), 'try');
    assert.equal(actions.available('ask-again', host), true);
    actions.run('ask-tick:confirm', host);
    assert.equal(askPolicy.get('cell-gene-1'), 'confirm');
    actions.run('ask-again', host);
    assert.equal(askPolicy.get('cell-gene-1'), null);
    assert.equal(actions.run('ask-tick:try', { id: 'somewhere' }), false);
});

test("the painter paints the strip's tag \"Runs without asking\" while the panel's tick is on, and takes it away when it is not", () => {
    const calls = [];
    const painter = createPainter({ paint: () => {}, strip: () => {}, unasked: (h, level) => calls.push([h.id, level]), setTimer: () => 1, clearTimer: () => {} });
    const host = { id: 'plot-container-p1', isConnected: true };
    painter.paint(host);
    assert.deepEqual(calls.pop(), ['plot-container-p1', null]);
    askPolicy.set('p1', 'try');
    assert.deepEqual(calls.pop(), ['plot-container-p1', 'try'], 'a change repaints the hosts the painter knows');
    askPolicy.clear('p1');
    assert.deepEqual(calls.pop(), ['plot-container-p1', null]);
});
