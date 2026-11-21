/**
 * What a notice says while a computation waits or runs, and of the server's new reasons (FX-H; SHR-47, SHR-48,
 * operator decision 21; the reasons of FX-E, E6a and E6b). The words are in static/js/utils/vocabulary.js; the shared
 * wording of utils/source-notices.js uses them for every provider. A score's existing sentences are held byte for byte
 * by source-notices.test.mjs; these are the new ones.
 *
 * Run:  node --test annzarro/tests/js/source-progress.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const SN = await import('../../../static/js/utils/source-notices.js');
const N = await import('../../../static/js/utils/score-notices.js');
const { VOCABULARY: V } = await import('../../../static/js/utils/vocabulary.js');

const GROUPING = { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing', found: 'cells',
    act: { to: 'group', ing: 'grouping' }, upstreamTitle: (snap) => (snap.table === 'cell-table-1' ? 'Table 1' : null) };

const computing = (progress, extra = {}) => ({ state: 'computing', title: 'T cell score', progress, ...extra });

// ---------------------------------------------------------------- the queue (SHR-47)

test("a job behind others says its place in the server's line, with the score's note", () => {
    const note = N.describeScore(computing({ done: 0, total: 200, entries_done: 0, entries_total: 1e9, running_s: 0, queue: { ahead: 1, sharing: 0 } }),
        { role: 'x' });
    assert.equal(note.state, 'queued');
    assert.equal(note.headline, 'Waiting for the server: 1 computation ahead.');
    assert.equal(note.text, 'Groupings and counts keep working.');
    assert.equal(note.tag.text, 'Score queued');
    assert.deepEqual(note.actions, [['score-cancel', 'Cancel']]);
    assert.equal(N.describeScore(computing({ done: 0, total: 2, queue: { ahead: 3, sharing: 0 } }), { role: 'colour' }).headline,
        'Waiting for the server: 3 computations ahead. This plot has no color.');
});

test('a grouping in line says no score word and no note it has not got', () => {
    const note = SN.describeSource({ state: 'computing', title: 'G1', progress: { done: 0, total: 9, queue: { ahead: 2, sharing: 0 } } }, { role: 'x' }, GROUPING);
    assert.equal(note.headline, 'Waiting for the server: 2 computations ahead.');
    assert.equal(note.text, '');
});

test('while sharing the server, the notice says so, and time left says "while sharing"', () => {
    const note = N.describeScore(computing({ done: 61, total: 200, entries_done: 3e9, entries_total: 1e10, running_s: 60, queue: { ahead: 0, sharing: 1 } }),
        { role: 'x' });
    assert.equal(note.state, 'computing');
    assert.equal(note.headline, "Computing 'T cell score': 61 of 200 genes · about 2 minutes left while sharing.");
    assert.equal(note.text, 'Sharing the server with 1 other computation. Groupings and counts keep working.');
});

// ---------------------------------------------------------------- time left (SHR-48)

test('time left is said from stored entries over running time, after 10% and 5 s', () => {
    const say = (progress) => N.describeScore(computing(progress), { role: 'x' }).headline;
    // 30% in 60 s of running: 140 s more, rounded as a person would
    assert.equal(say({ done: 61, total: 200, entries_done: 3e9, entries_total: 1e10, running_s: 60 }),
        "Computing 'T cell score': 61 of 200 genes · about 2 minutes left.");
    // under 10% of the entries: not yet
    assert.equal(say({ done: 150, total: 200, entries_done: 9e8, entries_total: 1e10, running_s: 60 }),
        "Computing 'T cell score': 150 of 200 genes.");
    // under 5 s of running: not yet, however far it is
    assert.equal(say({ done: 61, total: 200, entries_done: 5e9, entries_total: 1e10, running_s: 4 }),
        "Computing 'T cell score': 61 of 200 genes.");
    // the genes counted say nothing of the time: one well-expressed gene holds most of the entries
    assert.equal(say({ done: 199, total: 200, entries_done: 2e9, entries_total: 1e10, running_s: 10 }),
        "Computing 'T cell score': 199 of 200 genes · about 40 seconds left.");
    // no entries in the frame (an old server): no time left
    assert.equal(say({ done: 61, total: 200, running_s: 60 }), "Computing 'T cell score': 61 of 200 genes.");
});

// ---------------------------------------------------------------- the bar (operator decision 21)

test('progressBar: only for a job on its way, only once it is long, never a percentage that is not measured', () => {
    const bar = SN.progressBar;
    assert.equal(bar({ state: 'ready', values: [1] }, 99), null);
    assert.equal(bar({ state: 'awaiting', estimate: { seconds: 120 } }, 99), null, 'a job that waits for a click has no bar');
    assert.equal(bar({ state: 'computing', progress: { done: 1, total: 2 } }, 9.9), null, 'short: the text line');
    assert.deepEqual(bar({ state: 'computing', progress: { done: 1, total: 2 } }, 10), { determinate: true, value: 1, max: 2 });
    assert.deepEqual(bar({ state: 'computing', estimate: { seconds: 40 }, progress: { done: 0, total: 0 } }, 0), { determinate: false });
    assert.deepEqual(bar({ state: 'computing', estimate: { seconds: 40 } }, 0), { determinate: false }, 'no frame yet');
    assert.deepEqual(bar({ state: 'computing', progress: { done: 0, total: 0, running_s: 12, stage: 'groups' } }, 0), { determinate: false },
        'a phase that counts nothing');
    assert.deepEqual(bar({ state: 'updating', estimate: { seconds: 40 }, progress: { done: 3, total: 4, entries_done: 10, entries_total: 40 } }, 0),
        { determinate: true, value: 10, max: 40 }, 'entries win over the count');
    assert.deepEqual(bar({ state: 'computing', estimate: { seconds: 40 }, progress: { done: 9, total: 4 } }, 0), { determinate: true, value: 4, max: 4 },
        'held within its range');
    for (const state of ['queued', 'estimating']) {
        assert.deepEqual(bar({ state, estimate: { seconds: 40 }, progress: { done: 1, total: 2 } }, 0), { determinate: false }, state);
    }
    assert.deepEqual(bar({ state: 'computing', estimate: { seconds: 40 }, progress: { done: 0, total: 2, entries_done: 0, entries_total: 9,
        queue: { ahead: 1, sharing: 0 } } }, 0), { determinate: false }, 'in line: indeterminate');
});

// ---------------------------------------------------------------- the wording every provider shares

test("a table upstream is built or opened in the provider's own words, named by the table's title", () => {
    const building = SN.describeSource({ state: 'building', title: 'G1', table: 'cell-table-1', gate: { state: 'building' } }, { role: 'x' }, GROUPING);
    assert.equal(building.headline, "Building 'Table 1' to find its cells, then grouping them.");
    assert.equal(building.tag.text, 'Building filter');
    assert.deepEqual(building.actions.map(a => a[0]), ['score-cancel', 'score-open']);
    const opening = SN.describeSource({ state: 'building', title: 'G1', table: 'cell-table-1', gate: { reason: 'opening' } }, { role: 'colour' }, GROUPING);
    assert.equal(opening.headline, "Waiting for 'Table 1' to open, to group its cells. This plot has no color.");
    const ask = SN.describeSource({ state: 'ask', title: 'G1', table: 'cell-table-1' }, { role: 'x' }, GROUPING);
    assert.equal(ask.headline, "Building 'Table 1' to find its cells will pause the page for a few seconds.");
    assert.deepEqual(ask.actions, [['score-compute', 'Build filter'], ['score-open', 'Open grouping'], ['score-choose', 'Choose another']]);
    // a provider that names no upstream: the source itself, as a gene table is its own
    const score = N.describeScore({ state: 'ask', title: 'Genes A', kind: 'table' }, { role: 'x' });
    assert.equal(score.headline, "Building 'Genes A' to find its genes will pause the page for a few seconds.");
});

test('the score vocabulary no longer carries the building and ask sentences', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../../static/js/utils/score-notices.js', import.meta.url), 'utf8');
    assert.doesNotMatch(text, /will pause the page|then scoring them|to score its genes/);
});

// ---------------------------------------------------------------- the server's reasons

const LIMITS = ['too_many_measures', 'too_many_thresholds', 'range_too_wide', 'unsupported_column', 'too_many_values',
    'too_many_partitionings', 'obsp_too_large'];
const PASSING = ['set_length_mismatch', 'read_busy'];

test('every new reason has a sentence; a limit is a refusal with no Retry, a busy server a failure with Retry', () => {
    for (const reason of LIMITS) {
        const note = SN.describeSource({ state: 'failed', title: 'G1', reason, message: 'the server words' }, { role: 'x' }, GROUPING);
        assert.equal(note.state, 'refused', reason);
        assert.equal(note.severity, 'warning');
        assert.equal(note.headline, "'G1' was not computed.");
        assert.equal(note.text, V.reasons[reason].text);
        assert.ok(!note.actions.some(a => a[0] === 'score-retry'), `${reason}: trying again gives the same answer`);
        assert.equal(note.tag.text, 'Grouping refused');
    }
    for (const reason of PASSING) {
        const note = SN.describeSource({ state: 'failed', title: 'G1', reason, message: 'pairwise matrices' }, { role: 'x' }, GROUPING);
        assert.equal(note.state, 'failed', reason);
        assert.equal(note.headline, "'G1' could not be computed.");
        assert.equal(note.text, V.reasons[reason].text);
        assert.deepEqual(note.actions[0], ['score-retry', 'Retry']);
    }
    // read_busy is neutral: it never repeats the read guard's words about pairwise matrices
    assert.doesNotMatch(SN.describeSource({ state: 'failed', reason: 'read_busy', message: 'pairwise matrices' }, {}, GROUPING).text, /pairwise/);
});

test("the reasons' sentences use the interface words, US spelling, and end as sentences", () => {
    const banned = Object.entries(V.never).flatMap(([concept, words]) => (['statistic', 'factor', 'group', 'grouping'].includes(concept) ? words : []))
        .filter(w => !['subset', 'split', 'key'].includes(w));
    for (const [reason, { text }] of Object.entries(V.reasons)) {
        assert.match(text, /\.$/, reason);
        for (const word of banned) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(text), `${reason} says '${word}'`);
        assert.doesNotMatch(text, /colour|centre|behaviour|normalis/i, `${reason}: US spelling`);
    }
    assert.deepEqual(Object.keys(V.reasons).sort(), [...LIMITS, ...PASSING].sort());
});

// ---------------------------------------------------------------- what the strip says of a score that is not drawn

const { Coverage, GAP, breakdown } = await import('../../../static/js/utils/coverage.js');

test('a pending score is "not ready yet", a stopped one "not available", one the dataset lacks "not in this dataset"', () => {
    const kindOf = SN.coverageKindOf;
    for (const state of ['idle', 'estimating', 'queued', 'computing', 'updating']) assert.equal(kindOf({ state }), 'pending', state);
    for (const state of ['refused', 'failed', 'cancelled', 'awaiting', 'deleted', 'cycle', 'off', 'nogenes', 'unset', 'building', 'ask']) {
        assert.equal(kindOf({ state }), 'stopped', state);
    }
    assert.equal(kindOf({ state: 'nolayer' }), '', 'a layer the dataset lacks');
    assert.equal(kindOf({ state: 'noscore', reason: 'no_gene_present' }), '', 'no gene of it in the dataset');
    assert.equal(kindOf({ state: 'noscore', reason: 'other' }), 'stopped');
    const line = (kind) => Coverage.missing(GAP.UNAVAILABLE, 'why', { source: 'gene score T cell score', unit: 'cells', total: 60, kind }).lines()[0];
    assert.equal(line('pending'), 'gene score T cell score: not ready yet (60 cells) -- why');
    assert.equal(line('stopped'), 'gene score T cell score: not available (60 cells) -- why');
    assert.equal(line(''), 'gene score T cell score: not in this dataset (60 cells) -- why');
    assert.equal(line(undefined), 'gene score T cell score: not in this dataset (60 cells) -- why', 'no kind: as before');
    const note = breakdown(Coverage.missing(GAP.UNAVAILABLE, 'why', { source: 'gene score S', unit: 'cells', total: null, kind: 'pending' })).notes[0];
    assert.equal(note.label.split(' -- ')[0], 'gene score S: not ready yet', "the strip's short line");
});
