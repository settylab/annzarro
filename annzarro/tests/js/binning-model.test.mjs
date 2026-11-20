/**
 * The browser's model of a binning (utils/binning.js): the schema, the defaults and the label text. It never
 * computes an edge from data; every case that involves the engine reads tests/data/binning_recipe_vectors.json,
 * which tests/core/test_binning_recipe_vectors.py keeps equal to what core/binning.py writes.
 *
 * Run:  node --test annzarro/tests/js/binning-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'binning_recipe_vectors.json'), 'utf8'));
const B = await import('../../../static/js/utils/binning.js');

const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)), `${what}: ${a} vs ${b}`);
const labelsOf = (binning, info, name = 'CD3E') => B.levelLabels(B.normalizeBinning(binning).binning, info, name).map((l) => l.label);

// --- the recipe: schema, defaults, validation (SHR-14 to SHR-17, SHR-45) ---------------------------------------

test('every recipe the engine accepts is the same recipe here, in the engine\'s own defaults-filled form', () => {
    const accepted = vectors.recipes.filter((r) => r.ok);
    assert.ok(accepted.length >= 14);
    for (const r of accepted) {
        const { binning, problems } = B.normalizeBinning(r.raw);
        assert.deepEqual(problems, [], JSON.stringify(r.raw));
        assert.deepEqual(B.effectiveBinning(binning), r.effective, JSON.stringify(r.raw));
    }
});

test('every recipe the engine refuses is a problem here, for the engine\'s reason', () => {
    const refused = vectors.recipes.filter((r) => !r.ok && r.reason !== 'unknown_field');
    assert.ok(refused.length >= 12);
    for (const r of refused) {
        const { problems } = B.normalizeBinning(r.raw);
        assert.ok(problems.some((p) => p.reason === r.reason), `${JSON.stringify(r.raw)} should be ${r.reason}, got ${JSON.stringify(problems)}`);
    }
});

test('the field names, methods and limits are the engine\'s', () => {
    assert.deepEqual([...B.BINNING_METHODS], ['equal_width', 'equal_count', 'log', 'manual', 'categories']);
    assert.deepEqual([B.BINS_MIN, B.BINS_MAX], [2, 1000]);
    assert.deepEqual({ ...B.DEFAULT_BINS }, { equal_count: 4, equal_width: 10, log: 10 });
    assert.equal(B.ZERO_BIN_SHARE, 0.25);
});

test('defaults are not written, and what differs from a default is', () => {
    const n = (raw) => B.normalizeBinning(raw).binning;
    assert.deepEqual(n({ method: 'equal_count', bins: 4, zero_bin: false, outside: 'clamp', edges_from: 'shown' }), { method: 'equal_count' });
    assert.deepEqual(n({ method: 'equal_width', bins: 10 }), { method: 'equal_width' });
    assert.deepEqual(n({ method: 'equal_count', bins: 7, zero_bin: true, outside: 'exclude', edges_from: 'all' }),
        { method: 'equal_count', bins: 7, zero_bin: true, outside: 'exclude', edges_from: 'all' });
    assert.deepEqual(n({ method: 'manual', thresholds: [2, 0.5, 2], bins: 9, range: [0, 5], edges_from: 'all', outside: 'exclude' }),
        { method: 'manual', thresholds: [0.5, 2] });
    assert.deepEqual(n({ method: 'categories', zero_bin: true, outside: 'exclude', bins: 3 }), { method: 'categories' });
    assert.deepEqual(n({ method: 'categories', edges_from: 'all' }), { method: 'categories', edges_from: 'all' });
});

test('the field order is fixed, so equal recipes are equal text', () => {
    const a = B.normalizeBinning({ edges_from: 'all', range: [0, 6], zero_bin: true, bins: 3, method: 'equal_width', outside: 'exclude' }).binning;
    assert.deepEqual(Object.keys(a), ['method', 'bins', 'zero_bin', 'range', 'outside', 'edges_from']);
});

test('a range with one side automatic is [null, hi] or [lo, null], and a range with neither is no range', () => {
    const n = (r) => B.normalizeBinning({ method: 'equal_width', range: r });
    assert.deepEqual(n([null, 5]).binning.range, [null, 5]);
    assert.deepEqual(n([2, null]).binning.range, [2, null]);
    assert.equal(n([null, null]).binning.range, undefined);
    assert.deepEqual(n([null, null]).problems, []);
    assert.deepEqual(n([5, 5]).problems.map((p) => p.reason), ['bad_range']);
    assert.equal(n([5, 5]).binning.range, undefined);
});

test('unknown fields are kept and ignored, so an older build loses nothing from a newer link', () => {
    const { binning, problems } = B.normalizeBinning({ method: 'equal_count', future: { a: 1 } });
    assert.deepEqual(problems, []);
    assert.deepEqual(binning.future, { a: 1 });
    assert.equal(B.effectiveBinning(binning).future, undefined);
});

test('a bad value is repaired to what the engine would use and reported', () => {
    const { binning, problems } = B.normalizeBinning({ method: 'equal_count', bins: 1 });
    assert.deepEqual(problems, [{ field: 'bins', reason: 'bad_bins' }]);
    assert.deepEqual(binning, { method: 'equal_count' });
    assert.deepEqual(B.normalizeBinning(undefined).binning, { method: 'equal_count' });
    assert.deepEqual(B.normalizeBinning('x').problems.map((p) => p.reason), ['bad_binning']);
});

test('manual thresholds are sorted and de-duplicated on entry', () => {
    assert.deepEqual(B.normalizeBinning({ method: 'manual', thresholds: [3, 1, 3, 2] }).binning.thresholds, [1, 2, 3]);
});

// --- edges and level ids the recipe itself fixes ---------------------------------------------------------------

test('a recipe that needs no data has the engine\'s edges, level ids and bounds', () => {
    for (const v of vectors.edges) {
        const binning = B.normalizeBinning(v.binning).binning;
        const edges = B.recipeEdges(binning);
        assert.equal(edges.length, v.reply.edges.length, JSON.stringify(v.binning));
        edges.forEach((x, i) => close(x, v.reply.edges[i], JSON.stringify(v.binning)));
        assert.deepEqual(B.levelIds(binning, null), v.ids, JSON.stringify(v.binning));
    }
});

test('data-derived edges are not computed here: no stored range, no edges', () => {
    for (const raw of [{ method: 'equal_count' }, { method: 'equal_width' }, { method: 'log' }, { method: 'categories' }]) {
        assert.equal(B.recipeEdges(B.normalizeBinning(raw).binning), null, raw.method);
    }
    assert.throws(() => B.levelIds(B.normalizeBinning({ method: 'equal_count' }).binning, null), /reply/);
});

test('the level ids of a real reply are the engine\'s: @zero first, then bin:0, bin:1 ..., one bin:0 for degenerate data', () => {
    for (const v of vectors.data) assert.deepEqual(B.levelIds(B.normalizeBinning(v.binning).binning, v.reply), v.ids, JSON.stringify(v.binning));
});

// --- labels (SHR-9, SHR-45, SHR-46) ----------------------------------------------------------------------------

test('manual thresholds: below the first, between, and from the last', () => {
    assert.deepEqual(labelsOf({ method: 'manual', thresholds: [0.5, 1.75] }, { edges: [0.5, 1.75] }),
        ['CD3E < 0.5', 'CD3E 0.5 to 1.75', 'CD3E ≥ 1.75']);
});

test('equal count: open ends, edges to three significant digits', () => {
    const d = vectors.data[0];
    assert.deepEqual(labelsOf(d.binning, d.reply), ['CD3E < 0.275', 'CD3E 0.275 to 0.55', 'CD3E 0.55 to 1.05', 'CD3E ≥ 1.05']);
    assert.deepEqual(labelsOf({ method: 'equal_count' }, { edges: [0.41234, 0.93456, 1.60001, 2.5] }),
        ['CD3E < 0.935', 'CD3E 0.935 to 1.6', 'CD3E ≥ 1.6']);
});

test('the zero bin is "name = 0", and the first positive bin names its lower bound', () => {
    const d = vectors.data[1];
    assert.deepEqual(d.ids, ['@zero', 'bin:0', 'bin:1', 'bin:2', 'bin:3']);
    assert.deepEqual(labelsOf(d.binning, d.reply), ['CD3E = 0', '0 < CD3E < 1.05', 'CD3E 1.05 to 1.9', 'CD3E 1.9 to 3.43', 'CD3E ≥ 3.43']);
});

test('under a stored range with clamping the end bins are open, so the label does not lie about the cells in it', () => {
    const d = vectors.data[4];
    assert.equal(d.reply.outside, 'clamp');
    assert.deepEqual(labelsOf(d.binning, d.reply), ['CD3E < 2', 'CD3E 2 to 4', 'CD3E ≥ 4']);
});

test('when outside values are excluded the end bins are the true ranges, the last one closed', () => {
    const d = vectors.data[5];
    assert.equal(d.reply.outside, 'exclude');
    assert.deepEqual(labelsOf(d.binning, d.reply), ['CD3E 0 to 2', 'CD3E 2 to 4', 'CD3E 4 to 6']);
});

test('degenerate data is one level named for its value (SHR-46)', () => {
    const one = vectors.data[7];
    assert.equal(one.reply.degenerate, true);
    assert.deepEqual(labelsOf(one.binning, one.reply), ['CD3E = 1.2']);
    const zeroed = vectors.data[8];
    assert.deepEqual(labelsOf(zeroed.binning, zeroed.reply), ['CD3E = 0', 'CD3E = 2.5']);
    const none = vectors.data[9];
    assert.deepEqual(labelsOf(none.binning, none.reply), ['CD3E no value']);
});

test('an integer column split by its values: one level per value, in order', () => {
    const d = vectors.data[11];
    assert.deepEqual(labelsOf(d.binning, d.reply), ['1', '2', '3', '7', '12']);
});

test('merged edges give fewer labels than bins asked', () => {
    const d = vectors.data[10];
    assert.equal(d.reply.bins_asked, 8);
    assert.equal(d.reply.bins_made, 3);
    assert.equal(labelsOf(d.binning, d.reply).length, 3);
});

test('labels and ids go together, one pair per level, in level order', () => {
    for (const v of vectors.data) {
        const binning = B.normalizeBinning(v.binning).binning;
        assert.deepEqual(B.levelLabels(binning, v.reply, 'x').map((l) => l.id), v.ids, JSON.stringify(v.binning));
    }
});

// --- Freeze thresholds (SHR-17) --------------------------------------------------------------------------------

test('freezing makes manual thresholds that assign every cell as the data-derived edges did', () => {
    const place = (thresholds, zero, x) => (zero && x === 0 ? 0 : (zero ? 1 : 0) + thresholds.filter((t) => x >= t).length);
    let frozen = 0;
    for (const v of vectors.data) {
        const binning = B.normalizeBinning(v.binning).binning;
        const f = B.freezeThresholds(binning, v.reply);
        if (v.reply.degenerate || binning.method === 'manual' || binning.method === 'categories') {
            assert.equal(f, null, JSON.stringify(v.binning));
            continue;
        }
        frozen++;
        assert.equal(f.method, 'manual');
        assert.equal(f.zero_bin, binning.zero_bin);
        assert.deepEqual(Object.keys(f).sort(), ['method', 'thresholds', ...(binning.zero_bin ? ['zero_bin'] : [])].sort());
        v.values.forEach((x, i) => {
            if (x === null) return;
            const expected = v.codes[i];
            if (expected === 65535) return;                    // excluded as outside the range: manual has no range
            assert.equal(place(f.thresholds, binning.zero_bin, x), expected, `${JSON.stringify(v.binning)} value ${x}`);
        });
    }
    assert.ok(frozen >= 6);
});

test('freezing a manual binning, or one with no edges, offers nothing', () => {
    assert.equal(B.freezeThresholds({ method: 'manual', thresholds: [1] }, { edges: [1] }), null);
    assert.equal(B.freezeThresholds({ method: 'equal_count' }, null), null);
});
