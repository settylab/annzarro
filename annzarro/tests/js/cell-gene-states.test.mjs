/**
 * X3b: the Cell-Gene Plot's states (UX 3.5), without a page. Every row of the table as its sentence:
 *
 *   - the matrix limit (CXG-17), decided from counts before any request;
 *   - Queued from the server's `queue` (SHR-47): the plain wait before any frame, the place in line, the page's own job
 *     named, sharing as one state that does not flicker, "Groupings and counts keep working.";
 *   - Building groups, Computing with the genes read, time left from entries_done / running_s only after 10% and 5 s,
 *     "while sharing" (SHR-48);
 *   - Stale (Update tier), Asks first as an upper bound with Compute and Fewer genes (SHR-32), Refused by cost and for
 *     a CSR layer (CXG-19, no command named), Refused too large, the grouping's own refusal, Error with Retry;
 *   - a drawn plot: the strip's "28 groups × 63 rows", One cell per group (CXG-27), the Size layer select under No
 *     size (SHR-27).
 *
 * Run:  node --test annzarro/tests/js/cell-gene-states.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    gateMatrix, describePlot, ownJobAhead, plotState, matrixTag, oneCellPerGroup
} from '../../../static/js/panels/cell-gene/states.js';
import { layerList, statisticList } from '../../../static/js/panels/cell-gene/controls.js';

/** The generic words the panel gives the fallback notice (panels/cell-gene.js NOTICE_WORDS). */
const WORDS = Object.freeze({
    thing: 'grouping', source: 'grouping', result: 'plot', Computing: 'Computing', progressUnit: 'values', found: 'cells',
    act: { to: 'group', ing: 'grouping' }, tags: { computing: 'Computing…' }, cycleKind: 'grouping', off: 'Off.'
});
const CTX = { role: 'axis', sharers: 1 };
const PLOT = { genes: 200, cells: 8090, layer: 'logged_counts', tooLarge: null, ownJobAhead: () => null };
const HEAVY = { seconds: 120, tier: 'confirm', lane: 'heavy', entries: 1e9, n_cells: 8090, layout: 'csc' };
const say = (snap, plot = PLOT, ctx = CTX) => describePlot(snap, ctx, plot, WORDS);
const labels = (n) => n.actions.map(([, label]) => label);
const ids = (n) => n.actions.map(([id]) => id);
const progress = (fields) => ({ done: 0, total: 0, ...fields });

// ------------------------------------------------------------------ the matrix limit (CXG-17)

test('rows that cannot exceed the limit at 2,000 groups go with the groups in one request', () => {
    assert.deepEqual(gateMatrix({ sections: [{ rows: 200, genes: 200 }], groups: null }), { ask: 'all', tooLarge: null });
    assert.deepEqual(gateMatrix({ sections: [{ rows: 120, genes: 120 }, { rows: 80, genes: 80 }], groups: null }), { ask: 'all', tooLarge: null });
});

test('more rows with the groups not yet known ask for the groups alone first, never for the genes', () => {
    assert.deepEqual(gateMatrix({ sections: [{ rows: 201, genes: 201 }], groups: null }), { ask: 'groups', tooLarge: null });
});

test('groups known: over 400,000 cells of the matrix nothing is asked, and the numbers are said', () => {
    const g = gateMatrix({ sections: [{ rows: 10000, genes: 2000 }, { rows: 5000, genes: 2000 }], groups: 28 });
    assert.equal(g.ask, 'none');
    assert.deepEqual(g.tooLarge, { groups: 28, rows: 15000, count: 420000, limit: 400000 });
    assert.deepEqual(gateMatrix({ sections: [{ rows: 14285, genes: 2000 }], groups: 28 }), { ask: 'all', tooLarge: null });
    assert.deepEqual(gateMatrix({ sections: [{ rows: 400, genes: 40 }], groups: 1000 }), { ask: 'all', tooLarge: null });
});

test('Refused, too large: the sentence of UX 3.5, no button, the plot area covered', () => {
    const n = say({ state: 'ready', values: {} }, { ...PLOT, tooLarge: { groups: 28, rows: 15000, count: 420000, limit: 400000 } });
    assert.equal(n.headline, '28 groups × 15,000 rows = 420,000 cells of the matrix; the limit is 400,000.');
    assert.equal(n.text, 'Remove a section or use fewer groups.');
    assert.deepEqual(n.actions, []);
    assert.equal(n.state, 'refused');
    assert.equal(n.blocksAxis, true);
    assert.equal(plotState({ state: 'ready' }, { tooLarge: true, drawn: true }), 'toolarge');
});

// ------------------------------------------------------------------ queued (SHR-47)

test('until a frame of the server has arrived, the plain wait with no number', () => {
    const n = say({ state: 'computing', progress: progress({}), estimate: HEAVY });
    assert.equal(n.headline, 'Waiting for the server.');
    assert.equal(n.text, '');
    assert.deepEqual(labels(n), ['Cancel']);
    assert.equal(say({ state: 'computing', progress: null }).headline, 'Waiting for the server.');
});

test('a place in the server\'s line: the fallback sentence, and under it that groupings and counts keep working', () => {
    const n = say({ state: 'computing', progress: progress({ queue: { ahead: 1, sharing: 0 } }), estimate: HEAVY });
    assert.equal(n.headline, 'Waiting for the server: 1 computation ahead.');
    assert.equal(n.text, 'Groupings and counts keep working.');
    assert.equal(n.state, 'queued');
    assert.equal(say({ state: 'computing', progress: progress({ queue: { ahead: 3, sharing: 0 } }), estimate: HEAVY }).headline,
        'Waiting for the server: 3 computations ahead.');
    assert.equal(plotState({ state: 'computing', progress: progress({ queue: { ahead: 2, sharing: 0 } }) }), 'queued');
});

test('a light job does not claim that groupings keep working beside it', () => {
    const n = say({ state: 'computing', progress: progress({ queue: { ahead: 1, sharing: 0 } }), estimate: { ...HEAVY, lane: 'light' } });
    assert.equal(n.text, '');
});

test('the job ahead is named only when it is this page\'s own other plot', () => {
    const own = { ...PLOT, ownJobAhead: () => 'Cell-Gene Plot 2' };
    assert.equal(say({ state: 'computing', progress: progress({ queue: { ahead: 1, sharing: 0 } }), estimate: HEAVY }, own).headline,
        'Waiting for Cell-Gene Plot 2 to finish.');
    // two ahead: one of them is not this page's, so neither is named
    assert.equal(say({ state: 'computing', progress: progress({ queue: { ahead: 2, sharing: 0 } }), estimate: HEAVY }, own).headline,
        'Waiting for the server: 2 computations ahead.');
    const running = { state: 'computing', progress: progress({ queue: { ahead: 0, sharing: 0 } }) };
    const waiting = { state: 'computing', progress: progress({ queue: { ahead: 1, sharing: 0 } }) };
    assert.equal(ownJobAhead([{ title: 'Cell-Gene Plot 2', snap: running }, { title: 'Cell-Gene Plot 3', snap: { state: 'ready' } }]), 'Cell-Gene Plot 2');
    assert.equal(ownJobAhead([{ title: 'A', snap: running }, { title: 'B', snap: running }]), null);
    assert.equal(ownJobAhead([{ title: 'A', snap: waiting }]), null);
    assert.equal(ownJobAhead([]), null);
});

test('computing while sharing the slot is one state: frames alternating sharing 1 and 0 never turn it into queued', () => {
    const frames = [1, 0, 1, 1, 0].map((sharing, i) => ({ state: 'computing', estimate: HEAVY,
        progress: progress({ stage: 'features', queue: { ahead: 0, sharing }, entries_done: (i + 1) * 1e8, entries_total: 1e9, running_s: 2 + i,
            items: { done: 20 * (i + 1), total: 200 } }) }));
    const states = frames.map((f) => say(f).state);
    assert.deepEqual([...new Set(states)], ['computing']);
    assert.deepEqual([...new Set(frames.map((f) => plotState(f, { drawn: false })))], ['computing']);
    const n = say(frames[0]);
    assert.equal(n.text, 'Sharing the server with 1 other computation. Groupings and counts keep working.');
});

// ------------------------------------------------------------------ building groups, computing, time left (SHR-48)

test('Building groups: the cells shown, the previous drawing kept', () => {
    const n = say({ state: 'updating', progress: progress({ stage: 'groups', queue: { ahead: 0, sharing: 0 } }), estimate: HEAVY });
    assert.equal(n.headline, 'Grouping 8,090 cells…');
    assert.equal(n.blocksAxis, false, 'the previous drawing stays (SHR-36)');
});

test('Computing: the genes read, counted by the server\'s items, with Cancel', () => {
    const n = say({ state: 'computing', estimate: HEAVY,
        progress: progress({ stage: 'features', queue: { ahead: 0, sharing: 0 }, entries_done: 5e7, entries_total: 1e9, running_s: 3, items: { done: 120, total: 200 } }) });
    assert.equal(n.headline, 'Reading 200 genes: 120 of 200');
    assert.deepEqual(ids(n), ['score-cancel']);
    assert.equal(say({ state: 'computing', estimate: HEAVY, progress: progress({ stage: 'features', queue: { ahead: 0, sharing: 0 }, items: { done: 1, total: 12 } }) },
        PLOT, { role: 'axis', sharers: 3 }).actions[0][1], 'Cancel for 3 plots');
});

test('a new section alone: the line counts the genes of its own request, not every gene of the plot', () => {
    const n = say({ state: 'updating', estimate: HEAVY,
        progress: progress({ stage: 'features', queue: { ahead: 0, sharing: 0 }, items: { done: 3, total: 12 } }) });
    assert.equal(n.headline, 'Reading 12 genes: 3 of 12');
    assert.equal(n.blocksAxis, false);
});

test('time left from entries_done over running_s, only after 10% of the entries and 5 s', () => {
    const at = (entries_done, running_s, items = { done: 61, total: 200 }, sharing = 0) => say({ state: 'computing', estimate: HEAVY,
        progress: progress({ stage: 'features', queue: { ahead: 0, sharing }, entries_done, entries_total: 1e9, running_s, items }) }).headline;
    assert.equal(at(5e7, 30), 'Reading 200 genes: 61 of 200', 'under 10% of the entries');
    assert.equal(at(3e8, 4), 'Reading 200 genes: 61 of 200', 'under 5 s');
    // 30% in 60 s: 140 s left, whatever share of the genes is done
    assert.equal(at(3e8, 60), 'Reading 200 genes: 61 of 200 · about 2 minutes left');
    assert.equal(at(3e8, 60, { done: 190, total: 200 }), 'Reading 200 genes: 190 of 200 · about 2 minutes left', 'genes done do not set the rate');
    assert.equal(at(3e8, 60, { done: 61, total: 200 }, 1), 'Reading 200 genes: 61 of 200 · about 2 minutes left while sharing');
});

// ------------------------------------------------------------------ tiers (SHR-32, CXG-19)

test('Stale, Update tier: the previous plot, the changes not applied, how long, and Update', () => {
    const n = say({ state: 'ready', values: {}, held: { edits: 2, seconds: 40 } });
    assert.equal(n.headline, 'Showing the previous plot. 2 changes not applied. About 40 seconds.');
    assert.deepEqual(labels(n), ['Update']);
    assert.deepEqual(ids(n), ['score-update']);
    assert.equal(say({ state: 'ready', values: {}, held: { edits: 1 } }).headline, 'Showing the previous plot. 1 change not applied.');
    assert.equal(say({ state: 'ready', values: {} }), null);
    assert.equal(plotState({ state: 'ready', held: { edits: 2 } }, { drawn: true }), 'held');
});

test('Asks first: an upper bound from the estimate, the stored values, Compute and Fewer genes', () => {
    const n = say({ state: 'awaiting', estimate: { seconds: 350, tier: 'confirm', lane: 'heavy', entries: 10.5e9, n_cells: 95.6e6, layout: 'csc' } },
        { ...PLOT, cells: 95.6e6 });
    assert.equal(n.headline, 'Reading 200 genes over 95.6M cells: up to about 6 minutes (10.5 billion stored values).');
    assert.equal(n.text, 'Groupings and counts keep working.');
    assert.deepEqual(labels(n), ['Compute', 'Fewer genes']);
    assert.deepEqual(ids(n), ['score-compute', 'fewer-genes']);
    assert.equal(n.tag.text, 'Not computed');
});

test('Refused by cost: how long it would take and the ways out', () => {
    const n = say({ state: 'refused', reason: 'groups_too_expensive', estimate: { ...HEAVY, seconds: 1500, tier: 'refused' } });
    assert.equal(n.headline, 'Would take about 25 minutes, so it was not run.');
    assert.equal(n.text, 'Use fewer genes, a smaller subset, or a layer stored by gene (CSC).');
});

test('Refused for a CSR layer: the layout named, the way out that exists, and no command', () => {
    const n = say({ state: 'refused', reason: 'groups_too_expensive', estimate: { ...HEAVY, seconds: 2400, tier: 'refused', layout: 'csr' } });
    assert.equal(n.headline, 'logged_counts is stored by cell (CSR), so 200 genes mean reading the whole matrix: about 40 minutes.');
    assert.equal(n.text, 'A copy of the layer stored by gene (CSC) makes this fast; see the documentation.');
    const one = say({ state: 'refused', reason: 'groups_too_expensive', estimate: { ...HEAVY, seconds: 700, layout: 'csr' } }, { ...PLOT, genes: 1 });
    assert.match(one.headline, /^logged_counts is stored by cell \(CSR\), so 1 gene means reading the whole matrix/);
    for (const x of [n, one]) assert.doesNotMatch(`${x.headline} ${x.text}`, /annzarro |convert|command/i, 'N3: no string names a command');
});

test('Too many groups: the grouping\'s own refusal, with Open grouping', () => {
    const n = say({ state: 'refused', reason: 'too_many_groups', title: 'Grouping 1', message: '6,840 groups: a grouping holds up to 2,000.' });
    assert.equal(n.state, 'refused');
    assert.ok(n.actions.some(([id, label]) => id === 'score-open' && label === 'Open grouping'));
    assert.match(n.text, /6,840 groups/);
});

// operator 2026-11-25: "would take about 1 second, so it was not run". A grouping refused for its SIZE (groups or levels over the
// limit) is a refused state with the estimate that was made before it: cheap, in the auto tier. The notice must name the limit
// that refused it, never the seconds.
const CHEAP = { seconds: 1.2, tier: 'auto', lane: 'light', entries: 0, n_cells: 8090, layout: 'column', auto_max_s: 60, max_s: 600 };

test('Refused for size with a cheap estimate: the limit and its figures, never "would take about 1 second"', () => {
    for (const snap of [
        { state: 'refused', reason: 'too_many_groups', title: 'Grouping 1', estimate: CHEAP, message: null, refused: { reason: 'too_many_groups', count: 19000, limit: 2000 } },
        { state: 'refused', reason: 'too_many_groups', title: 'Grouping 1', estimate: CHEAP, message: null, header: { refused: { reason: 'too_many_groups', count: 19000, limit: 2000 } } }
    ]) {
        const n = say(snap);
        const said = `${n.headline} ${n.text}`;
        assert.doesNotMatch(said, /would take|second|so it was not run/i, said);
        assert.match(said, /19,000 groups/, said);
        assert.match(said, /2,000/, said);
        assert.ok(n.actions.some(([id]) => id === 'score-open'), 'the way out: open the grouping');
    }
    const levels = say({ state: 'refused', reason: 'too_many_levels', title: 'Grouping 1', estimate: CHEAP, message: null, refused: { reason: 'too_many_levels', count: 2500, limit: 2000 } });
    assert.match(`${levels.headline} ${levels.text}`, /2,500 levels/);
    assert.doesNotMatch(`${levels.headline} ${levels.text}`, /would take|second/i);
});

test('Refused with no figures and no cost reason: it says it was refused and why it can, never a made-up duration', () => {
    const n = say({ state: 'refused', reason: 'too_many_groups', title: 'Grouping 1', estimate: CHEAP, message: null });
    assert.doesNotMatch(`${n.headline} ${n.text}`, /would take|second/i);
    const other = say({ state: 'refused', reason: 'something_new', title: 'Grouping 1', estimate: CHEAP, message: 'The server said no.' });
    assert.doesNotMatch(`${other.headline} ${other.text}`, /would take|second/i);
    assert.match(`${other.headline} ${other.text}`, /The server said no/);
});

test('A cost refusal is quoted in seconds only when the seconds are over the limit the estimate reports', () => {
    const over = say({ state: 'refused', reason: 'groups_too_expensive', estimate: { ...HEAVY, seconds: 1500, tier: 'refused', max_s: 600 } });
    assert.equal(over.headline, 'Would take about 25 minutes, so it was not run.');
    const under = say({ state: 'refused', reason: 'groups_too_expensive', estimate: { ...CHEAP, tier: 'refused' }, message: 'This would take about 1 seconds; the limit is 10 minutes.' });
    assert.doesNotMatch(under.headline, /would take about 1 second/i, under.headline);
});

test('Error: what went wrong, and Retry', () => {
    const n = say({ state: 'failed', reason: 'failed', message: 'the server stopped responding' });
    assert.equal(n.headline, 'Could not be computed: the server stopped responding.');
    assert.deepEqual(ids(n), ['score-retry']);
    assert.equal(say({ state: 'failed', reason: 'failed' }).headline, 'Could not be computed: the server stopped responding.');
    // a reason with a sentence of its own keeps it (a busy server, which Retry may mend)
    assert.match(say({ state: 'failed', reason: 'read_busy', title: 'x' }).text, /busy/);
});

test('every other state is the generic notice: a cycle, a grouping with no factors, a deleted grouping', () => {
    assert.equal(say({ state: 'cycle', cycle: ['A', 'B', 'A'] }).state, 'cycle');
    assert.equal(say({ state: 'nofactors', title: 'G' }).state, 'nofactors');
    assert.equal(say({ state: 'deleted', title: 'G' }).state, 'deleted');
});

// ------------------------------------------------------------------ a drawn plot

test('the strip of a drawn plot: groups by rows, and the cells of the matrix with no value', () => {
    assert.deepEqual(matrixTag(28, 63, 0), { text: '28 groups × 63 rows', title: '28 groups × 63 rows' });
    assert.deepEqual(matrixTag(1, 1, 1), { text: '1 group × 1 row', title: '1 group × 1 row · 1 cell of the matrix has no value' });
    assert.equal(matrixTag(28, 63, 12).title, '28 groups × 63 rows · 12 cells of the matrix have no value');
});

test('One cell per group: suggested only for dots sized by Fraction of cells, over groups of one cell each', () => {
    const ones = [{ n: 1 }, { n: 1 }, { n: 1 }];
    const size = { stat: 'fraction_of_cells', layer: 'logged' };
    assert.equal(oneCellPerGroup({ mode: 'dots', size, sized: true, groups: ones }), true);
    assert.equal(oneCellPerGroup({ mode: 'heatmap', size, sized: true, groups: ones }), false);
    assert.equal(oneCellPerGroup({ mode: 'dots', size, sized: false, groups: ones }), false, 'No size draws no size to suggest about');
    assert.equal(oneCellPerGroup({ mode: 'dots', size: { stat: 'mean', layer: 'logged' }, sized: true, groups: ones }), false);
    assert.equal(oneCellPerGroup({ mode: 'dots', size, sized: true, groups: [{ n: 1 }, { n: 2 }] }), false);
    assert.equal(oneCellPerGroup({ mode: 'dots', size, sized: true, groups: [] }), false);
});

test('No size: the Size layer select keeps the statistic and lists the layers that can give it (WP-4, decision 31)', () => {
    const kinds = { X: 'signed', logged_counts: 'log', raw_counts: 'counts' };
    const held = { stat: 'fraction_of_cells', layer: 'X' };
    const list = layerList({ datasetLayers: ['X', 'logged_counts', 'raw_counts'], kinds, stat: held.stat, held });
    assert.deepEqual(list.filter((o) => !o.disabled && !o.lapsed).map((o) => o.value), ['logged_counts', 'raw_counts']);
    const x = list.find((o) => o.value === 'X');
    assert.equal(x.label, 'X (not available)', 'the held layer stays, marked, so the select shows what is held');
    assert.equal(x.lapsed, true);
    assert.equal(statisticList({ kinds, held }).find((o) => o.value === 'fraction_of_cells').label, 'Fraction of cells (not available)');
});

test('the state word follows the snapshot and the drawing', () => {
    assert.equal(plotState(null), 'empty');
    assert.equal(plotState({ state: 'ready' }, { drawn: false }), 'drawing');
    assert.equal(plotState({ state: 'ready' }, { drawn: true }), 'ready');
    assert.equal(plotState({ state: 'updating' }, { drawn: true }), 'updating');
    for (const s of ['awaiting', 'refused', 'failed', 'computing', 'cycle']) assert.equal(plotState({ state: s }), s);
});

// ------------------------------------------------------------------ the genes read reach the snapshot (R4)

const { createGroupsApi } = await import('../../../static/js/utils/cell-groups-client.js');
const { createDerivedStore } = await import('../../../static/js/utils/derived-store.js');

/** A 200 reply whose body is these frames and then nothing: the stream stays open until `end()`. */
function openStream(frames) {
    const enc = new TextEncoder();
    const pieces = frames.map((f) => enc.encode(`${JSON.stringify(f)}\n`));
    let wake = null;
    let ended = false;
    return {
        end() { ended = true; if (wake) wake(); },
        response: { ok: true, status: 200, body: { getReader() {
            return {
                async read() {
                    if (pieces.length) return { done: false, value: pieces.shift() };
                    if (!ended) await new Promise((resolve) => { wake = resolve; });
                    return { done: true };
                },
                async cancel() {}
            };
        } } }
    };
}

const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a features frame of the groups route puts the genes read on the snapshot as items; a score frame carries none', async () => {
    const queue = { ahead: 0, sharing: 0 };
    const groups = openStream([
        { type: 'start', codes: 'miss', lane: 'heavy', entries_total: 1000, queue },
        { type: 'progress', stage: 'features', done: 61, total: 200, entries_done: 300, entries_total: 1000, running_s: 6, queue }
    ]);
    const api = createGroupsApi({ url: '/api/v1/data/cell_groups', fetchImpl: async () => groups.response });
    const store = createDerivedStore({ api: { estimate: async () => ({ estimate: { seconds: 1, tier: 'live' } }), compute: (req) => api.compute(req) } });
    store.attach('k', { recipe: { shape: 'grouping' }, dataset: 'd', subset: null, hash: 'k' }, { visible: () => true });
    await until(() => (store.snapshot('k').progress || {}).items);
    const p = store.snapshot('k').progress;
    assert.deepEqual(p.items, { done: 61, total: 200 });
    assert.equal(p.entries_done, 300);
    assert.equal(describePlot(store.snapshot('k'), CTX, PLOT, WORDS).headline, 'Reading 200 genes: 61 of 200 · about 14 seconds left');
    store.cancel('k');
    groups.end();

    // the score stream's frames are counted in genes already, and keep no items
    let told = null;
    const score = createDerivedStore({ api: { estimate: async () => ({ estimate: { seconds: 1, tier: 'live' } }),
        compute: (req) => { req.onProgress(3, 12, { type: 'progress', done: 3, total: 12, entries_done: 30, entries_total: 120, running_s: 1, queue });
            told = true; return new Promise(() => {}); } } });
    score.attach('s', { recipe: {}, dataset: 'd', subset: null, hash: 's' }, { visible: () => true });
    await until(() => told);
    const q = score.snapshot('s').progress;
    assert.equal(q.items, undefined);
    assert.equal(q.done, 3);
});
