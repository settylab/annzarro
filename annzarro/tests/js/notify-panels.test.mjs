/**
 * A dataset switch updates every panel, whatever happens in the others
 * (issue #2).
 *
 * Reported: switching to a dataset that lacks a field one panel uses stopped
 * every LATER panel from updating. PanelManager.notifyPanels hands the update
 * to the panels through notifyEach; this drives it with panels that throw
 * synchronously, reject, or resolve late, and checks that every panel's
 * update was started before any finished and that each failure stays its own.
 *
 * Run:  node --test annzarro/tests/js/notify-panels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { notifyEach } = await import('../../../static/js/utils/notify-panels.js');

function panel(id, behaviour, log) {
    return {
        getId: () => id,
        onDataUpdate(type, data) {
            log.push(`start ${id}`);
            if (behaviour === 'throw') throw new Error(`${id}: no obs column 'highres_celltype'`);
            if (behaviour === 'reject') return Promise.reject(new Error(`${id}: 404`));
            if (behaviour === 'abort') return Promise.reject(new DOMException('aborted', 'AbortError'));
            if (behaviour === 'slow') return new Promise(r => setTimeout(() => { log.push(`done ${id}`); r(); }, 30));
            if (behaviour === 'sync') { log.push(`done ${id}`); return undefined; }
            return Promise.resolve().then(() => { log.push(`done ${id}`); });
        }
    };
}

test('a throwing and a rejecting panel do not stop the panels after them', async () => {
    const log = [];
    const reported = [];
    const panels = [
        panel('p1', 'ok', log), panel('p2', 'slow', log), panel('p3', 'throw', log),
        panel('p4', 'reject', log), panel('p5', 'ok', log), panel('p6', 'sync', log)
    ];
    const outcomes = await notifyEach(new Set(panels), 'datasetChanged', {}, (p, e) => reported.push(p.getId()));
    assert.deepEqual(outcomes.map(o => [o.id, o.ok]),
        [['p1', true], ['p2', true], ['p3', false], ['p4', false], ['p5', true], ['p6', true]]);
    assert.deepEqual(reported, ['p3', 'p4']);
    for (const id of ['p1', 'p2', 'p5', 'p6']) assert.ok(log.includes(`done ${id}`), `${id} finished`);
});

test('every update starts before any is awaited (a slow panel delays nobody)', async () => {
    const log = [];
    await notifyEach([panel('a', 'slow', log), panel('b', 'throw', log), panel('c', 'ok', log)], 'datasetChanged', {}, () => {});
    assert.deepEqual(log.slice(0, 3), ['start a', 'start b', 'start c']);
    assert.ok(log.indexOf('done c') < log.indexOf('done a'));
});

test('aborts are outcomes, not reported errors; panels without onDataUpdate are skipped', async () => {
    const reported = [];
    const outcomes = await notifyEach([panel('x', 'abort', []), {}, null, panel('y', 'ok', [])],
        'datasetChanged', {}, (p) => reported.push(p.getId()));
    assert.deepEqual(outcomes.map(o => [o.id, o.ok]), [['x', false], ['y', true]]);
    assert.deepEqual(reported, []);
});
