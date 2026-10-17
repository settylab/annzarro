/**
 * The memory guard across panels drawn at once (static/js/utils/memory-guard.js):
 * heavy draws take turns (DrawTurns, isHeavyDraw), so each is checked against
 * what the plots drawn before it hold, and the later ones of a set that does
 * not fit are refused in order.
 *
 * Run:  node --test annzarro/tests/js/memory-guard-turns.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    GB, DrawTurns, isHeavyDraw, HEAVY_SHARE, Ledger, panelCost, check, drawNeed, addCost, memorySettings, DEFAULT_SETTINGS
} = await import('../../../static/js/utils/memory-guard.js');

const limits = (heapGb, totalGb) => ({
    heap: { bytes: heapGb * GB, source: 'test' }, total: { bytes: totalGb === null ? null : totalGb * GB, source: 'test' },
    contexts: 16, browserLimit: false
});

test('heavy: every large-plot draw, and any draw needing HEAVY_SHARE of a ceiling', () => {
    const L = limits(4, 16);
    assert.equal(isHeavyDraw({ heap: 0, off: 0 }, L, true), true);
    assert.equal(isHeavyDraw({ heap: HEAVY_SHARE * 4 * GB, off: 0 }, L), true);
    assert.equal(isHeavyDraw({ heap: HEAVY_SHARE * 4 * GB - 1, off: 0 }, L), false);
    assert.equal(isHeavyDraw({ heap: 0, off: HEAVY_SHARE * 16 * GB }, L), true);
    assert.equal(isHeavyDraw({ heap: 0, off: HEAVY_SHARE * 16 * GB }, limits(4, null)), false, 'no total budget');
    // a 100k-cell plot is light; a 5M-cell regular plot is heavy
    const peak = (n) => panelCost({ kind: 'cell-plot', n }).peak;
    assert.equal(isHeavyDraw(peak(100000), L), false);
    assert.equal(isHeavyDraw(peak(5000000), L), true);
});

test('turns go one at a time, in the order asked; a released waiter is skipped', async () => {
    const turns = new DrawTurns();
    const order = [];
    const a = await turns.take('a');
    order.push('a');
    const pb = turns.take('b').then(t => { order.push('b'); return t; });
    const pc = turns.take('c').then(t => { order.push('c'); return t; });
    const pd = turns.take('d');
    await Promise.resolve();
    assert.deepEqual(order, ['a'], 'b and c wait while a draws');
    assert.deepEqual(turns.waiting().map(t => t.label), ['b', 'c', 'd']);
    // d is no longer wanted (its panel closed): it leaves the queue
    const d = await Promise.race([pd, Promise.resolve(null)]);
    assert.equal(d, null);
    turns.release(turns.waiting()[2]);
    assert.deepEqual(turns.waiting().map(t => t.label), ['b', 'c']);
    turns.release(a);
    const b = await pb;
    assert.deepEqual(order, ['a', 'b']);
    assert.equal(turns.holder(), b);
    turns.release(b);
    const c = await pc;
    assert.deepEqual(order, ['a', 'b', 'c']);
    turns.release(c);
    assert.equal(turns.holder(), null);
    // releasing twice, or nothing, does no harm
    turns.release(c);
    turns.release(null);
});

test('a turn held past maxMs lets the next draw go', async () => {
    let t = 0;
    const turns = new DrawTurns({ now: () => t, maxMs: 1000 });
    const a = await turns.take('a');
    let got = null;
    const pb = turns.take('b').then(x => { got = x; return x; });
    await Promise.resolve();
    assert.equal(got, null);
    t = 1001;
    // the next ask notices the expired holder
    const pc = turns.take('c');
    const b = await pb;
    assert.equal(b.label, 'b');
    assert.equal(turns.holder(), b);
    turns.release(a);   // the stalled draw ends late: it does not release b's turn
    assert.equal(turns.holder(), b);
    turns.release(b);
    assert.equal((await pc).label, 'c');
});

/**
 * Four plots of `n` points drawn in turn against `limits`: each is checked
 * against what the ones drawn before it hold, reserved, then committed.
 */
function drawInTurn(n, L, settings = DEFAULT_SETTINGS, count = 4, large = true) {
    const ledger = new Ledger();
    const out = [];
    for (let i = 0; i < count; i++) {
        const id = `cell-plot-${i}`;
        const p = { kind: 'cell-plot', n, large, colour: 'none' };
        const need = { ...drawNeed(panelCost(p).peak, null, large, settings.margin) };
        const r = check(need, ledger.totals(), L, settings, { panels: ledger.plotCount() + 1 });
        out.push(r.verdict);
        if (r.verdict === 'block') continue;
        const token = ledger.reserve(id, p);
        ledger.commit(id, null, token);
    }
    return { out, ledger };
}

test('drawn in turn, the plots that fit are drawn and the later ones are refused', () => {
    // 95.6M points in large-plot mode: about 7 GB each (73 B a point outside the heap) with the margin 8.4 GB
    const { out, ledger } = drawInTurn(95624334, limits(4.4, 20));
    assert.deepEqual(out, ['ok', 'ok', 'block', 'block']);
    assert.equal(ledger.plotCount(), 2);
    // with room for all, all draw
    assert.deepEqual(drawInTurn(95624334, limits(4.4, 64)).out, ['ok', 'ok', 'ok', 'ok']);
    // enforce warn: all draw, the later ones warned
    assert.deepEqual(drawInTurn(95624334, limits(4.4, 20), memorySettings({ enforce: 'warn' })).out, ['ok', 'ok', 'warn', 'warn']);
});

test('drawn at once, unchecked against each other, they would all have passed', () => {
    // what the turns prevent: every check made before any plot held its buffers
    const L = limits(4.4, 20);
    const ledger = new Ledger();
    const p = { kind: 'cell-plot', n: 95624334, large: true, colour: 'none' };
    const need = panelCost(p).peak;
    const verdicts = [0, 1, 2, 3].map(() => check(need, ledger.totals(), L, DEFAULT_SETTINGS).verdict);
    assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'ok']);
    // and the four together are well over the budget
    const all = [0, 1, 2, 3].reduce((t) => addCost(t, need), ledger.totals());
    assert.ok(all.heap + all.off > L.total.bytes);
});
