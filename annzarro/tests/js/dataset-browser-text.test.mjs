/**
 * The dataset browser's search over descriptions (static/js/utils/dataset-browser-model.js): merging the
 * text hits under the name matches, snippets from UTF-16 offsets, the index line, and the status poller.
 *
 * Run:  node --test annzarro/tests/js/dataset-browser-text.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/dataset-browser-model.js');

const hit = (name, extra = {}) => ({ name, path: `/d/${name}`, rel_path: name, title: `Title of ${name}`, score: 5, matched: ['readme'], ...extra });

test('text hits come after the name matches and a store found both ways is listed once', () => {
    const names = [{ kind: 'store', path: '/d/a.zarr', name: 'a.zarr' }];
    const rows = M.textRows(names, [hit('a.zarr'), hit('b.zarr'), hit('b.zarr'), hit('c.zarr', { matched: undefined })]);
    assert.deepEqual(rows.map(r => r.name), ['b.zarr', 'c.zarr']);
    assert.ok(rows.every(r => r.kind === 'store' && r.textHit === true));
    assert.deepEqual(rows[1].matched, [], 'a missing `matched` is an empty list');
    assert.deepEqual(M.textRows(names, null), []);
});

test('the match chip does not hide description hits, and a hit like the view carries its badge', () => {
    const like = new Map([['/d/b.zarr', { match: 'same' }]]);
    const annotate = row => (like.has(row.path) ? { ...row, ...like.get(row.path) } : row);
    const on = { ...M.emptyFilters(), matches: true };
    const rows = M.textSection([], [hit('b.zarr', { format: 'zarr' }), hit('c.zarr', { format: 'zarr' })], on, annotate);
    assert.deepEqual(rows.map(r => r.name), ['b.zarr', 'c.zarr'], 'the chip is on (as when it is switched on for a view without data): both hits stay');
    assert.equal(M.matchBadge(rows[0]), 'same cells and genes');
    assert.equal(M.matchBadge(rows[1]), '');
    // the bug this fixes: through applyFilters with the chip on, every hit was dropped, the matching one too
    assert.deepEqual(M.applyFilters(M.textRows([], [hit('b.zarr')]), on), []);
    // the other chips still narrow the section
    const h5 = { ...M.emptyFilters(), formats: new Set(['h5ad']), matches: true };
    assert.deepEqual(M.textSection([], [hit('b.zarr', { format: 'zarr' })], h5, annotate), []);
});

test('the match chip says what it keeps', () => {
    assert.equal(M.MATCH_CHIP.label, "Like this view's dataset");
    assert.match(M.MATCH_CHIP.title, /same cells and genes, the same size, or the same name as the dataset this view was made on/);
});

test('a hit without a path is keyed by its relative path', () => {
    const rows = M.textRows([], [{ name: 'x.zarr', path: null, rel_path: 'grant/x.zarr' }]);
    assert.equal(rows[0].path, 'grant/x.zarr');
});

test('a snippet is cut at its offsets', () => {
    const parts = M.snippetParts({ text: 'a Preprocessing step', highlights: [[2, 15]] });
    assert.deepEqual(parts, [{ text: 'a ', hit: false }, { text: 'Preprocessing', hit: true }, { text: ' step', hit: false }]);
    assert.deepEqual(M.snippetParts({ text: 'plain', highlights: [] }), [{ text: 'plain', hit: false }]);
    assert.deepEqual(M.snippetParts(null), []);
    assert.deepEqual(M.snippetParts({ text: '' }), []);
});

test('offsets count UTF-16 units: accents, astral characters and right-to-left text', () => {
    // "Zoë Müller" has no surrogate pairs; the emoji is two units, so what follows it is shifted by two
    const text = 'Zoë Müller 🧬 Müller';
    const second = text.lastIndexOf('Müller');
    assert.equal(second, 14);
    const parts = M.snippetParts({ text, highlights: [[4, 10], [second, second + 6]] });
    assert.deepEqual(parts.filter(p => p.hit).map(p => p.text), ['Müller', 'Müller']);
    const arabic = 'كلمة بحث';
    assert.deepEqual(M.snippetParts({ text: arabic, highlights: [[5, 8]] }).find(p => p.hit).text, 'بحث');
});

test('bad offsets are dropped, clamped, merged and never split a surrogate pair', () => {
    const text = 'ab🧬cd';
    assert.deepEqual(M.snippetParts({ text, highlights: [[3, 4]] }).find(p => p.hit).text, '🧬', 'a cut inside the pair takes the whole pair');
    assert.deepEqual(M.snippetParts({ text, highlights: [[-5, 1], [4, 99]] }).filter(p => p.hit).map(p => p.text), ['a', 'cd']);
    const merged = M.snippetParts({ text: 'abcdef', highlights: [[1, 3], [2, 5], [4, 2], ['x', 1], null, [3.5, 4]] });
    assert.deepEqual(merged, [{ text: 'a', hit: false }, { text: 'bcde', hit: true }, { text: 'f', hit: false }]);
});

test('the query is split into words and quoted phrases', () => {
    assert.deepEqual(M.queryTerms('  pre   "bone marrow" aging '), ['pre', 'bone marrow', 'aging']);
    assert.deepEqual(M.queryTerms(''), []);
    assert.deepEqual(M.queryTerms('""'), []);
});

test('terms are found without regard to case or accents, with offsets in the original text', () => {
    assert.deepEqual(M.termRanges('Zoë MÜLLER wrote it', ['zoe', 'muller']), [[0, 3], [4, 10]]);
    assert.deepEqual(M.termRanges('🧬 Preprocessing', ['preprocessing']), [[3, 16]]);
    assert.deepEqual(M.termRanges('aaa', ['aa']), [[0, 2]]);
    assert.deepEqual(M.termRanges('ab ab', ['ab', 'b a']), [[0, 5]], 'overlapping terms merge');
    assert.deepEqual(M.termRanges('nothing', ['xyz']), []);
    assert.deepEqual(M.termRanges('text', []), []);
});

test('ages are short', () => {
    const now = 1_000_000;
    assert.equal(M.agoLabel(now - 10, now), 'just now');
    assert.equal(M.agoLabel(now - 180, now), '3 min ago');
    assert.equal(M.agoLabel(now - 7200, now), '2 h ago');
    assert.equal(M.agoLabel(now - 86400, now), '1 day ago');
    assert.equal(M.agoLabel(now - 3 * 86400, now), '3 days ago');
    assert.equal(M.agoLabel(0, now), '');
});

test('the index line: building, done with and without counts, stale, capped, failed, nothing', () => {
    const now = 1_000_000;
    assert.deepEqual(M.indexLine({ state: 'running', progress: { fraction: 0.42 } }, now), { text: 'Indexing descriptions… 42%', percent: 42 });
    assert.deepEqual(M.indexLine({ state: 'running', progress: null }, now), { text: 'Indexing descriptions…', percent: null });
    assert.equal(M.indexLine({ state: 'done', built_at: now - 180, stores: 1234 }, now).text, '1,234 datasets indexed 3 min ago');
    assert.equal(M.indexLine({ state: 'done', built_at: now - 180 }, now).text, 'Indexed 3 min ago', 'no count for a restricted user');
    assert.equal(M.indexLine({ state: 'done', built_at: now - 180, stale: true }, now).text, 'Indexed 3 min ago, updating');
    assert.equal(M.indexLine({ state: 'partial', built_at: now - 180, partial: true, stores: 5 }, now).text, '5 datasets indexed 3 min ago, some datasets are not searched');
    assert.match(M.indexLine({ state: 'done', built_at: now, capped: true }, now).text, /not searched/);
    assert.equal(M.indexLine({ state: 'failed' }, now).text, 'Descriptions could not be indexed.');
    assert.equal(M.indexLine({ state: 'idle', built_at: null }, now), null);
    assert.equal(M.indexLine(null), null);
});

/** A poller on a clock the test winds by hand. */
function harness(statuses, options = {}) {
    const timers = [];
    const seen = [];
    const done = [];
    let reads = 0;
    const poller = M.createIndexPoller({
        fetchStatus: async () => {
            const next = statuses[Math.min(reads++, statuses.length - 1)];
            if (next instanceof Error) throw next;
            return next;
        },
        onStatus: s => seen.push(s.state),
        onDone: s => done.push(s.state),
        setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimer: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
        ...options
    });
    const fire = async () => {
        const t = timers[timers.length - 1];
        if (t && t.fn) { const fn = t.fn; t.fn = null; await fn(); }
        await new Promise(resolve => setImmediate(resolve));
    };
    return { poller, timers, seen, done, fire, reads: () => reads };
}

test('the poller reads every 750 ms while the crawl runs and stops with a done once it ends', async () => {
    const h = harness([{ state: 'running' }, { state: 'running' }, { state: 'done' }]);
    assert.equal(M.POLL_MS, 750);
    h.poller.start();
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 750);
    await h.fire(); await h.fire();
    assert.equal(h.poller.running, true);
    assert.deepEqual(h.done, []);
    await h.fire();
    assert.deepEqual(h.seen, ['running', 'running', 'done']);
    assert.deepEqual(h.done, ['done']);
    assert.equal(h.poller.running, false);
    assert.equal(h.timers.filter(t => t.fn).length, 0, 'nothing is left scheduled');
});

test('stopping cancels the next read and ignores one in flight', async () => {
    const h = harness([{ state: 'running' }]);
    h.poller.start();
    h.poller.stop();
    assert.equal(h.timers[0].fn, null);
    assert.equal(h.poller.running, false);
    h.poller.start();
    const fn = h.timers[1].fn;
    const reading = fn();
    h.poller.stop();
    await reading;
    assert.deepEqual(h.seen, [], 'a reading that arrives after stop() is dropped');
    assert.equal(h.timers.length, 2, 'and schedules nothing');
});

test('starting twice runs one loop', () => {
    const h = harness([{ state: 'running' }]);
    h.poller.start(); h.poller.start();
    assert.equal(h.timers.length, 1);
});

test('the poller gives up after repeated failures and survives a single one', async () => {
    const h = harness([new Error('x'), { state: 'running' }, new Error('x'), new Error('x')], { maxFailures: 2 });
    h.poller.start();
    await h.fire(); await h.fire();
    assert.equal(h.poller.running, true, 'one failure, then a good reading');
    await h.fire(); await h.fire();
    assert.equal(h.poller.running, false, 'two in a row end it');
    assert.deepEqual(h.done, []);
});
