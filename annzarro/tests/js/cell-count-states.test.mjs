/**
 * C2b: what a Cell Count Plot says, without a page (panels/cell-count/states.js).
 *
 *   - each refusal of UX 4.3, decided from the plan before any request, with the count, the limit and its way out:
 *     Bin it, Choose levels, Remove Color by (SHR-39, CNT-8, CNT-9, CNT-14);
 *   - an input the mode cannot use stays selected and the plot says what is missing, with Show as Bar or Show as UpSet
 *     (SHR-37, UX 4.2);
 *   - what each way out writes: one undoable step with its label, or a control opened in place, never a reset input;
 *   - the route's states through the shared wording (SHR-35), with "Counting 8,090 cells…" while it computes (UX 4.7);
 *   - the strip sentence of CNT-22: cells counted, without a value per input, outside the range, in levels left out.
 *
 * Run:  node --test annzarro/tests/js/cell-count-states.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });

const S = await import('../../../static/js/panels/cell-count/states.js');
const M = await import('../../../static/js/utils/count-plot-model.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const NUMERIC = new Set(['depth', 'score', 'batch', 'total_counts']);
const LEVELS = { cell_type: 6, condition: 2, sample: 380, many: 2001, age: 12 };
const page = {
    isNumeric: (source) => source.type === 'obs' && NUMERIC.has(source.key),
    levelCount: (p) => (Array.isArray(p.levels) ? p.levels.length + (p.rest === 'exclude' ? 0 : 1) : LEVELS[p.source.key] ?? null)
};
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
/** The plan of a config as the group store's handle reads it: a plan that asks nothing is the snapshot. */
const snapOf = (config) => ({ ...M.planGrid(norm(config), page) });
const said = (config) => {
    const c = norm(config);
    return S.describePlan(snapOf(config), {
        config: c, isNumeric: page.isNumeric,
        nameOf: (field) => { const p = field === 'factor' ? c.value.factor : c[field]; return p.source.key; }
    });
};

// --- refused before any request (UX 4.3) ---------------------------------------------------------------------------

test('Bar and Pie: more than 200 levels on X is refused with the count, the limit and Choose levels', () => {
    for (const [mode, word] of [['bar', 'Bar'], ['pie', 'Pie']]) {
        const plan = snapOf({ mode, x: obs('sample') });
        assert.equal(plan.state, 'refused');
        assert.equal(S.isPlanState(plan), true, 'nothing was asked: the plan is the state');
        assert.deepEqual(said({ mode, x: obs('sample') }), {
            state: 'refused', reason: 'too_many_levels',
            text: `sample has 380 levels; ${word} shows up to 200.`,
            actions: [['levels:x', 'Choose levels']]
        });
    }
});

test('a number with too many bins for Bar is refused with Bin it, which takes the most bins Bar shows and opens the control', () => {
    const config = { mode: 'bar', x: obs('depth', { binning: { method: 'equal_width', bins: 300 } }) };
    assert.deepEqual(said(config), {
        state: 'refused', reason: 'too_many_bins', text: 'depth has 300 bins; Bar shows up to 200.', actions: [['bin:x', 'Bin it']]
    });
    const way = S.wayOut('bin:x', norm(config));
    assert.deepEqual(way, { config: { ...norm(config), x: obs('depth', { binning: { method: 'equal_width', bins: 200 } }) },
        label: 'bin X', reveal: { field: 'x', what: 'binning' } });
    assert.equal(M.planGrid(way.config, page).state, 'ready');
});

test('a whole-number column read by its values offers both Bin it and Choose levels', () => {
    const config = { mode: 'bar', x: obs('batch', { binning: { method: 'categories' } }) };
    const plan = M.planGrid(norm(config), { ...page, levelCount: () => 412 });
    const out = S.describePlan(plan, { config: norm(config), isNumeric: page.isNumeric, nameOf: () => 'batch' });
    assert.equal(out.text, 'batch has 412 levels; Bar shows up to 200.');
    assert.deepEqual(out.actions, [['bin:x', 'Bin it'], ['levels:x', 'Choose levels']]);
    // Bin it bins it: equal width, the count plot's default, one undoable step, and the control opens on it
    const way = S.wayOut('bin:x', norm(config));
    assert.deepEqual(way.config.x, obs('batch'));
    assert.equal(way.label, 'bin X');
    assert.deepEqual(way.reveal, { field: 'x', what: 'binning' });
    assert.equal(M.planGrid(way.config, page).state, 'ready');
});

test('Heatmap: X × Y over 200 × 200 says both counts and both limits', () => {
    const config = { mode: 'heatmap', x: obs('sample'), y: obs('cell_type') };
    assert.deepEqual(said(config), {
        state: 'refused', reason: 'too_many_levels',
        text: 'sample × cell_type is 380 × 6; Heatmap shows up to 200 × 200.',
        actions: [['levels:x', 'Choose levels']]
    });
    const onY = said({ mode: 'heatmap', x: obs('cell_type'), y: obs('many') });
    assert.equal(onY.text, 'cell_type × many is 6 × 2,001; Heatmap shows up to 200 × 200.');
    assert.deepEqual(onY.actions, [['levels:y', 'Choose levels']]);
});

test('Histogram and Density: Color by over 200 levels is refused with Remove Color by', () => {
    for (const [mode, phrase] of [['histogram', 'a histogram'], ['density', 'a density']]) {
        const config = { mode, x: obs('depth'), split: obs('sample') };
        assert.deepEqual(said(config), {
            state: 'refused', reason: 'too_many_levels',
            text: `Color by sample has 380 levels; ${phrase} colors up to 200.`,
            actions: [['remove:split', 'Remove Color by']]
        }, mode);
        const way = S.wayOut('remove:split', norm(config));
        assert.equal(way.config.split, undefined);
        assert.deepEqual(way.config.x, obs('depth'), 'the other inputs stay');
        assert.equal(way.label, 'no Color by');
    }
});

test('2D histogram and 2D density: Color by over 8 levels is refused with Remove Color by', () => {
    const d2 = { mode: 'density2d', x: obs('depth'), y: obs('score'), split: obs('age') };
    assert.deepEqual(said(d2), {
        state: 'refused', reason: 'too_many_levels', text: 'Color by age has 12 levels; 2D density colors up to 8.',
        actions: [['remove:split', 'Remove Color by']]
    });
    // a 2D histogram's Color by is its most frequent level (CNT-18): removing it draws the count again
    const h2 = { mode: 'hist2d', x: obs('depth'), y: obs('score'), value: { kind: 'top_level', factor: obs('age') } };
    assert.deepEqual(said(h2), {
        state: 'refused', reason: 'too_many_levels', text: 'Color by age has 12 levels; 2D histogram colors up to 8.',
        actions: [['remove:factor', 'Remove Color by']]
    });
    const way = S.wayOut('remove:factor', norm(h2));
    assert.equal(way.config.value, undefined);
    assert.equal(M.planGrid(way.config, page).state, 'ready');
});

test('a 2D histogram with too many bins says both, from a link (bins typed are validated where typed)', () => {
    const config = { mode: 'hist2d', x: obs('depth', { binning: { method: 'equal_width', bins: 600 } }), y: obs('score') };
    const out = said(config);
    assert.equal(out.text, 'depth × score is 600 × 100; 2D histogram shows up to 512 × 512.');
    assert.deepEqual(out.actions, [['bin:x', 'Bin it']]);
    assert.equal(S.wayOut('bin:x', norm(config)).config.x.binning.bins, 512);
});

test('UpSet with more than 16 sets says its limit', () => {
    const sets = Array.from({ length: 17 }, (_, i) => ({ source: { type: 'table', key: `cell-table-${i}` } }));
    const plan = M.planGrid(norm({ mode: 'upset', sets }), { ...page, memberFor: () => ({}) });
    const out = S.describePlan(plan, { config: norm({ mode: 'upset', sets }), isNumeric: page.isNumeric, nameOf: () => '' });
    assert.deepEqual(out, { state: 'refused', reason: 'too_many_sets', text: 'UpSet shows up to 16 sets.', actions: [] });
});

// --- an input the mode cannot use, and nothing chosen (SHR-37, UX 4.2, UX 4.7) --------------------------------------

test('a categorical X in a histogram stays selected and the plot says why, with Show as Bar', () => {
    const config = { mode: 'histogram', x: obs('cell_type') };
    assert.deepEqual(said(config), {
        state: 'unusable', reason: 'needs_numeric', text: 'Histogram needs a numeric X. cell_type is categorical.',
        actions: [['mode:bar', 'Show as Bar']]
    });
    const way = S.wayOut('mode:bar', norm(config));
    assert.equal(way.config.mode, 'bar');
    assert.deepEqual(way.config.x, obs('cell_type'));
    assert.equal(way.label, 'mode Bar');
});

test('a categorical Y in a 2D histogram offers Show as Heatmap, which reads the same two inputs', () => {
    const config = { mode: 'hist2d', x: obs('depth'), y: obs('cell_type') };
    const out = said(config);
    assert.equal(out.text, '2D histogram needs a numeric Y. cell_type is categorical.');
    assert.deepEqual(out.actions, [['mode:heatmap', 'Show as Heatmap']]);
});

test('Venn with a fourth set offers UpSet', () => {
    const sets = Array.from({ length: 4 }, (_, i) => ({ source: { type: 'table', key: `cell-table-${i}` } }));
    const plan = M.planGrid(norm({ mode: 'venn', sets }), page);
    const out = S.describePlan(plan, { config: norm({ mode: 'venn', sets }), isNumeric: page.isNumeric, nameOf: () => '' });
    assert.deepEqual(out, { state: 'unusable', reason: 'too_many_sets', text: 'Venn shows 2 or 3 sets.', actions: [['mode:upset', 'Show as UpSet']] });
    assert.equal(S.wayOut('mode:upset', norm({ mode: 'venn', sets })).config.mode, 'upset');
});

test('nothing chosen yet: the sentences of UX 4.7, with no button', () => {
    assert.deepEqual(said({ mode: 'bar' }), { state: 'empty', reason: 'choose_x', text: 'Choose X to count cells.', actions: [] });
    assert.equal(said({ mode: 'heatmap', x: obs('cell_type') }).text, 'Choose Y to count cells.');
    const venn = S.describePlan(M.planGrid(norm({ mode: 'venn' }), page), { config: norm({ mode: 'venn' }), isNumeric: page.isNumeric, nameOf: () => '' });
    assert.equal(venn.text, 'Add two or more sets.');
});

test('a ready plan and the route\'s states are not the plan\'s to say', () => {
    assert.equal(S.isPlanState({ state: 'refused', reason: 'too_large' }), false, 'a refusal by the route carries no inputs');
    assert.equal(S.isPlanState({ state: 'computing' }), false);
    assert.equal(S.describePlan({ state: 'ready' }, { config: norm({ mode: 'bar', x: obs('cell_type') }) }), null);
});

test('Choose levels opens the chooser of that input and writes nothing', () => {
    assert.deepEqual(S.wayOut('levels:y', norm({ mode: 'heatmap', x: obs('cell_type'), y: obs('many') })), { reveal: { field: 'y', what: 'levels' } });
});

test('every way out the plan offers does something: it writes a config or opens a control', () => {
    const configs = [
        { mode: 'bar', x: obs('sample') }, { mode: 'heatmap', x: obs('sample'), y: obs('many') },
        { mode: 'histogram', x: obs('depth'), split: obs('sample') }, { mode: 'density2d', x: obs('depth'), y: obs('score'), split: obs('age') },
        { mode: 'hist2d', x: obs('depth'), y: obs('score'), value: { kind: 'top_level', factor: obs('age') } },
        { mode: 'histogram', x: obs('cell_type') }, { mode: 'bar', x: obs('depth', { binning: { method: 'equal_width', bins: 300 } }) }
    ];
    for (const config of configs) {
        for (const [action] of said(config).actions) {
            const way = S.wayOut(action, norm(config));
            assert.ok(way && (way.config || way.reveal), `${action} of ${JSON.stringify(config)}`);
            if (way.config) assert.equal(typeof way.label, 'string');
        }
    }
    assert.equal(S.wayOut('nothing:x', norm(configs[0])), null);
});

// --- the route's states (SHR-35, UX 4.7) -----------------------------------------------------------------------------

test('computing says how many cells are counted; queued, refused and failed use the shared wording', () => {
    const computing = S.gridNotice({ state: 'computing', title: 'Count 1', key: 'k' }, { role: 'grid' }, 8090);
    assert.equal(computing.headline, 'Counting 8,090 cells…');
    assert.deepEqual(computing.actions, [['score-cancel', 'Cancel']]);
    const waiting = S.gridNotice({ state: 'computing', title: 'Count 1', progress: { queue: { ahead: 2, sharing: 0 } } }, { role: 'grid' }, 8090);
    assert.equal(waiting.state, 'queued');
    assert.equal(waiting.headline, 'Waiting for the server: 2 computations ahead.');
    const asks = S.gridNotice({ state: 'awaiting', title: 'Count 1', estimate: { seconds: 40 } }, { role: 'grid' }, 8090);
    assert.equal(asks.headline, "'Count 1' will take about 40 seconds.");
    assert.deepEqual(asks.actions.map((a) => a[0]), ['score-compute', 'score-choose']);
    const busy = S.gridNotice({ state: 'failed', title: 'Count 1', reason: 'read_busy' }, { role: 'grid' }, 8090);
    assert.equal(busy.state, 'failed');
    assert.deepEqual(busy.actions[0], ['score-retry', 'Retry']);
    assert.equal(S.gridNotice({ state: 'ready', title: 'Count 1' }, { role: 'grid' }, 8090), null);
    assert.equal(S.gridNotice(snapOf({ mode: 'bar', x: obs('sample') }), { role: 'grid' }, 8090), null, 'a plan says its own');
});

// --- the strip (CNT-22, UX 4.7) --------------------------------------------------------------------------------------

test('the strip says the cells counted, then each reason a cell was left out', () => {
    const table = { shown: 8209, total: 8090, noValue: { x: 78, split: 0 }, outside: 41 };
    assert.equal(S.stripSentence(table, { x: 'total_counts', split: 'sample' }),
        '8,090 cells counted · 78 without a value for total_counts · 41 outside the range');
    assert.equal(S.stripSentence({ shown: 1200, total: 1200, noValue: { x: 0 }, outside: 0 }, { x: 'cell_type' }), '1,200 cells counted');
    // cells of levels left out (Choose levels with "Leave out") are the rest
    assert.equal(S.stripSentence({ shown: 1200, total: 1000, noValue: { x: 0 }, outside: 0 }, { x: 'cell_type' }),
        '1,000 cells counted · 200 in levels left out');
    assert.equal(S.stripSentence({ shown: 10, total: 4, noValue: { x: 1, y: 2 }, outside: 3 }, { x: 'a', y: 'b' }),
        '4 cells counted · 1 without a value for a · 2 without a value for b · 3 outside the range');
});

// --- the words come from the vocabulary ------------------------------------------------------------------------------

test('the density sentences live in the vocabulary with the other count words (UX 4.4)', async () => {
    const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
    const d = VOCABULARY.countPlot.density;
    assert.equal(d.floor, "Bandwidth raised to the grid's resolution.");
    assert.equal(d.range(82), 'Range from the 0.1st to the 99.9th percentile: 82 cells outside are not counted.');
    assert.equal(d.bandwidth(['0.21'], '1.0', 1), "Bandwidth 0.21 (Scott's rule × 1.0).");
    const source = (await import('node:fs')).readFileSync(new URL('../../../static/js/panels/cell-count/draw-density.js', import.meta.url), 'utf8');
    assert.ok(!/DENSITY_WORDS\s*=/.test(source), 'draw-density.js reads them, it does not define them');
});

// --- a typed bin count never validates and then meets a refusal (UX 4.3) ----------------------------------------------

test('each input of each mode takes the bins its limit allows, so a valid typed count is never refused', () => {
    assert.deepEqual(M.binsRange('bar', 'x'), { min: 2, max: 200 });
    assert.deepEqual(M.binsRange('pie', 'x'), { min: 2, max: 200 });
    assert.deepEqual(M.binsRange('heatmap', 'y'), { min: 2, max: 200 });
    assert.deepEqual(M.binsRange('histogram', 'x'), { min: 2, max: 2000 });
    assert.deepEqual(M.binsRange('hist2d', 'y'), { min: 2, max: 512 });
    assert.deepEqual(M.binsRange('bar'), { min: 2, max: 2000 }, 'without an input: the dimension\'s range, as before');
    assert.equal(M.binsProblem('bar', 201, 'x'), 'bad_bins');
    assert.equal(M.binsProblem('bar', 200, 'x'), null);
    // the sweep: in every mode that bins X or Y, the largest count the field takes plans, and one more would be refused
    for (const mode of ['bar', 'pie', 'histogram', 'heatmap', 'hist2d']) {
        for (const field of ['x', 'y']) {
            if (field === 'y' && !['heatmap', 'hist2d'].includes(mode)) continue;
            const { max } = M.binsRange(mode, field);
            const binned = (n) => obs('depth', { binning: { method: 'equal_width', bins: n } });
            const other = mode === 'heatmap' ? obs('cell_type') : obs('score');
            const config = (n) => norm({ mode, x: field === 'x' ? binned(n) : other, ...(['heatmap', 'hist2d'].includes(mode) ? { y: field === 'y' ? binned(n) : other } : {}) });
            assert.equal(M.planGrid(config(max), page).state, 'ready', `${mode} ${field} ${max}`);
            if (max < M.binsRange(mode).max) assert.equal(M.planGrid(config(max + 1), page).state, 'refused', `${mode} ${field} ${max + 1}`);
        }
    }
});

// operator 2026-11-25: Color by a large Cell Grouping in a 2D histogram or 2D density. The route refuses the grid for the size of that
// input (figures in header.refused, `axis` the input's place in the request); the notice names the input, its count and the mode's cap.
test('a grid refused for the size of an input says that input, its count and the mode\'s cap, never the estimate', () => {
    const facts = (mode) => ({ mode, inputs: ['x', 'y', 'split'], nameOf: (f) => ({ x: 'depth', y: 'score', split: 'Grouping 1' }[f]) });
    const refused = (axis, count, limit, reason = 'too_many_levels') => ({
        state: 'refused', title: 'Count 1', reason, message: null, estimate: { seconds: 1.2, tier: 'auto', max_s: 600 },
        header: { refused: { reason, count, limit, axis } }
    });
    for (const [mode, as] of [['hist2d', '2D histogram'], ['density2d', '2D density']]) {
        const n = S.gridNotice(refused(2, 30, 8), { role: 'grid' }, 8090, facts(mode));
        assert.equal(n.state, 'refused');
        assert.equal(n.headline, `Color by Grouping 1 has 30 levels; ${as} colors up to 8.`);
        assert.doesNotMatch(`${n.headline} ${n.text}`, /would take|second/i);
        assert.deepEqual(n.actions.map((a) => a[0]), ['score-open', 'score-choose'], 'the buttons are the generic notice\'s');
    }
    // an axis (x) over the levels cap: the levels sentence
    const axis = S.gridNotice(refused(0, 3000, 200, 'too_many_groups'), { role: 'grid' }, 8090, facts('hist2d'));
    assert.equal(axis.headline, 'depth has 3,000 levels; 2D histogram shows up to 200.');
    // without the panel's facts, or figures: the generic sentence, still no seconds
    for (const n of [S.gridNotice(refused(2, 30, 8), { role: 'grid' }, 8090), S.gridNotice({ ...refused(2, 30, 8), header: null }, { role: 'grid' }, 8090, facts('hist2d'))]) {
        assert.doesNotMatch(`${n.headline} ${n.text}`, /would take|second/i);
    }
});

// --- Choose levels when the levels cannot be listed (follow-up to C2b) ----------------------------------------------

test('levels refused for their number: Choose levels says how many and the limit, never "follow once counted"', () => {
    const refused = { state: 'refused', reason: 'too_many_groups', refused: { reason: 'too_many_groups', count: 2345, limit: 2000 } };
    assert.deepEqual(S.levelsNote(refused, { field: 'x', name: 'barcode', numeric: false }), {
        state: 'refused', text: 'barcode has 2,345 levels that hold a cell; Choose levels lists up to 2,000.', actions: []
    });
    // a whole-number column read by its values: binning it is the way out
    assert.deepEqual(S.levelsNote({ ...refused, reason: 'too_many_levels', refused: { reason: 'too_many_levels', count: 4100, limit: 2000 } },
        { field: 'y', name: 'umi', numeric: true }),
    { state: 'refused', text: 'umi has 4,100 levels that hold a cell; Choose levels lists up to 2,000.', actions: [['bin:y', 'Bin it']] });
});

test('levels that failed to come say why, with Retry; a refusal without figures says it was not read', () => {
    assert.deepEqual(S.levelsNote({ state: 'failed', message: 'Failed to fetch.' }, { field: 'x', name: 'barcode', numeric: false }), {
        state: 'failed', text: 'The levels of barcode could not be read: Failed to fetch.', actions: [['levels-retry:x', 'Retry']]
    });
    assert.deepEqual(S.levelsNote({ state: 'refused', message: 'It would take about 7 minutes.' }, { field: 'x', name: 'barcode', numeric: false }), {
        state: 'refused', text: 'The levels of barcode could not be read: It would take about 7 minutes.', actions: []
    });
    for (const state of ['estimating', 'queued', 'computing', 'ready', 'idle']) {
        assert.equal(S.levelsNote({ state }, { field: 'x', name: 'barcode', numeric: false }), null, state);
    }
    assert.equal(S.levelsNote(null, { field: 'x', name: 'barcode' }), null);
});

// --- the strip's bar of a count that keeps its drawing (decision 21), with this provider's words ----------------------

test('a count that keeps its drawing shows a determinate strip bar from its progress frames after 10 s, saying the cells counted', async () => {
    const HB = await import('../../../static/js/utils/host-binding.js');
    const SN = await import('../../../static/js/utils/source-notices.js');
    let t = 0;
    const timers = [];
    const strips = [];
    const painter = HB.createPainter({ now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimer: () => {},
        paint: () => {}, strip: (host, bar, notice) => strips.push({ bar, sentence: notice ? SN.sentenceOf(notice) : null }) });
    let onChange = null;
    const handle = { snap: { state: 'computing', title: 'Count 1', key: 'k1', progress: { entries_done: 0, entries_total: 100, running_s: 0 } },
        read() { return this.snap; }, release() {}, sharers: () => 1 };
    // the count plot's binding as panels/cell-count.js makes it: its notices are states.js gridNotice
    const b = HB.createHostBinding({ id: 'count-grid-test', painter, setTimer: (fn) => { fn(); return 0; },
        open: (h, role, setting, change) => { onChange = change; return { id: setting.id, handle }; },
        matches: (rec, setting) => rec.id === setting.id, describe: (snap, ctx) => S.gridNotice(snap, ctx, 1200) });
    const host = { isConnected: true, id: 'ccnt-plot-x' };
    const rec = b.recordFor(host, 'grid', { id: 'cell-count-x' });
    rec.quiet = true;                       // a drawing is kept: nothing is said over it
    b.paint(host);
    assert.equal(strips.length, 0, 'a short wait: no bar');
    t = 12000;
    handle.snap = { ...handle.snap, progress: { entries_done: 30, entries_total: 100, running_s: 12 } };
    onChange(handle.snap);
    b.paint(host);
    const last = strips[strips.length - 1];
    assert.deepEqual(last.bar, { determinate: true, value: 30, max: 100 });
    assert.equal(last.sentence, 'Counting 1,200 cells…');
    handle.snap = { ...handle.snap, state: 'ready', progress: null };
    b.paint(host);
    assert.equal(strips[strips.length - 1].bar, null, 'done: the bar goes');
});
