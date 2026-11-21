/**
 * The model of the shared binning control (panels/partition-options/binning-control.js, G9b): what it accepts typed,
 * what each control writes into the stored binning, the zero-bin default of SHR-15, Freeze thresholds (SHR-17), the
 * slider geometry, and the sentences of UX 2.4. The DOM is covered by tests/browser/test_binning_control.py.
 *
 * Run:  node --test annzarro/tests/js/binning-control.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../../../static/js/panels/partition-options/binning-control.js');
const B = await import('../../../static/js/utils/binning.js');

const hist = (extra = {}) => ({ lo: 0, hi: 10, counts: new Array(100).fill(1), n: 100, n_no_value: 0, n_zero: 0, zero_share: 0,
    has_negative: false, zero_bin_default: false, degenerate: false, ...extra });
const norm = (raw) => B.normalizeBinning(raw).binning;

// --- typed entry (GRP-5) --------------------------------------------------------------------------------------

test('a bin count is a whole number from 2 to 1,000, and anything else says so', () => {
    assert.deepEqual(C.parseBins('4'), { ok: true, value: 4 });
    assert.deepEqual(C.parseBins(' 1,000 '.replace(',', '')), { ok: true, value: 1000 });
    for (const bad of ['', '1', '1001', '3.5', 'abc', '-4', '4e1x', '0x10']) {
        assert.deepEqual(C.parseBins(bad), { ok: false, message: 'Enter a whole number from 2 to 1,000.' }, bad);
    }
});

test('a count plot passes its own limit and the sentence names it', () => {
    assert.deepEqual(C.parseBins('2000', { max: 2000 }), { ok: true, value: 2000 });
    assert.deepEqual(C.parseBins('2001', { max: 2000 }), { ok: false, message: 'Enter a whole number from 2 to 2,000.' });
});

test('thresholds are numbers separated by commas, sorted and de-duplicated for you', () => {
    assert.deepEqual(C.parseThresholds('1.75, 0.5,0.5'), { ok: true, value: [0.5, 1.75] });
    assert.deepEqual(C.parseThresholds('-2; 3'.replace(';', ',')), { ok: true, value: [-2, 3] });
    for (const bad of ['', ' ', 'a, b', '1, , 2', '1,2,', '1 2', 'NaN', 'Infinity']) {
        assert.deepEqual(C.parseThresholds(bad), { ok: false, message: 'Enter numbers separated by commas.' }, JSON.stringify(bad));
    }
});

test('a range is two numbers or "auto" on a side, the first below the second', () => {
    assert.deepEqual(C.parseRange('', '', 'equal_width'), { ok: true, value: null });
    assert.deepEqual(C.parseRange('auto', ' 5 ', 'equal_width'), { ok: true, value: [null, 5] });
    assert.deepEqual(C.parseRange('0', '10', 'equal_width'), { ok: true, value: [0, 10] });
    assert.equal(C.parseRange('5', '5', 'equal_width').ok, false);
    assert.equal(C.parseRange('x', '5', 'equal_width').ok, false);
    assert.equal(C.parseRange('0', '5', 'log').ok, false);
    assert.equal(C.parseRange('0.1', '5', 'log').ok, true);
});

// --- what each control writes ---------------------------------------------------------------------------------

test('a method change keeps the zero bin and the population, and takes the new method\'s own bin count', () => {
    const before = norm({ method: 'equal_count', bins: 6, zero_bin: true, edges_from: 'all' });
    const w = C.setMethod(before, 'equal_width');
    assert.deepEqual(w, { method: 'equal_width', bins: 6, zero_bin: true, edges_from: 'all' });
    const d = C.setMethod(norm({ method: 'equal_count' }), 'equal_width');
    assert.deepEqual(d, { method: 'equal_width' });
    assert.deepEqual(C.setMethod(norm({ method: 'equal_width', range: [0, 5], outside: 'exclude' }), 'log'), { method: 'log', outside: 'exclude' });
});

test('manual thresholds from a method take today\'s inner edges, else the middle of the preview, else 0', () => {
    const info = { edges: [0, 1, 2, 3, 10], bins_made: 4 };
    assert.deepEqual(C.setMethod(norm({ method: 'equal_count' }), 'manual', info), { method: 'manual', thresholds: [1, 2, 3] });
    assert.deepEqual(C.setMethod(norm({ method: 'equal_count' }), 'manual', { histogram: hist() }), { method: 'manual', thresholds: [5] });
    assert.deepEqual(C.setMethod(norm({ method: 'equal_count' }), 'manual', null), { method: 'manual', thresholds: [0] });
    const kept = C.setMethod(norm({ method: 'equal_count', zero_bin: true }), 'manual', info);
    assert.equal(kept.zero_bin, true);
    assert.equal('edges_from' in kept, false, 'manual has no population');
});

test('bins, zero bin, population, thresholds and range each change one field and keep the rest', () => {
    const b = norm({ method: 'equal_width', bins: 5, range: [0, 9] });
    assert.deepEqual(C.setBins(b, 10), { method: 'equal_width', range: [0, 9] }, 'the default count is not written');
    assert.deepEqual(C.setBins(b, 7), { method: 'equal_width', bins: 7, range: [0, 9] });
    assert.deepEqual(C.setZeroBin(b, true), { method: 'equal_width', bins: 5, range: [0, 9], zero_bin: true });
    assert.deepEqual(C.setZeroBin(C.setZeroBin(b, true), false), b);
    assert.deepEqual(C.setEdgesFrom(b, 'all'), { method: 'equal_width', bins: 5, range: [0, 9], edges_from: 'all' });
    assert.deepEqual(C.setEdgesFrom(C.setEdgesFrom(b, 'all'), 'shown'), b);
    assert.deepEqual(C.setRange(b, [1, 8]), { method: 'equal_width', bins: 5, range: [1, 8] });
    assert.deepEqual(C.setRange(b, null), { method: 'equal_width', bins: 5 });
    const m = norm({ method: 'manual', thresholds: [1, 2] });
    assert.deepEqual(C.setThresholds(m, [3, 1]), { method: 'manual', thresholds: [1, 3] });
});

test('every control keeps the unknown fields of the binning', () => {
    const b = norm({ method: 'equal_count', future: { a: 1 } });
    for (const out of [C.setBins(b, 5), C.setZeroBin(b, true), C.setEdgesFrom(b, 'all'), C.setMethod(b, 'equal_width')]) {
        assert.deepEqual(out.future, { a: 1 });
    }
});

// --- sliders ----------------------------------------------------------------------------------------------------

test('a threshold moves between its neighbours and never across them', () => {
    const m = norm({ method: 'manual', thresholds: [1, 4, 8] });
    assert.deepEqual(C.moveThreshold(m, 1, 5).thresholds, [1, 5, 8]);
    assert.equal(C.moveThreshold(m, 1, 8), null, 'onto a neighbour');
    assert.equal(C.moveThreshold(m, 1, 0.5), null, 'past a neighbour');
    assert.equal(C.moveThreshold(m, 1, 4), null, 'unchanged');
    assert.deepEqual(C.moveThreshold(m, 0, -3).thresholds, [-3, 4, 8], 'the outer ones are free');
    assert.deepEqual(C.moveThreshold(m, 2, 99).thresholds, [1, 4, 99]);
    assert.equal(C.moveThreshold(m, 5, 2), null, 'no such threshold');
});

test('the preview maps a value to a place on the line and back, and keys step by 1% and 10%', () => {
    const h = hist({ lo: 2, hi: 12 });
    assert.equal(C.fractionOf(2, h), 0);
    assert.equal(C.fractionOf(7, h), 0.5);
    assert.equal(C.fractionOf(99, h), 1);
    assert.equal(C.fractionOf(-9, h), 0);
    assert.equal(C.valueAt(0.5, h), 7);
    assert.equal(C.keyStep(h, false), 0.1);
    assert.equal(C.keyStep(h, true), 1);
    assert.equal(C.keyStep(hist({ degenerate: true, lo: 3, hi: 3 }), false), 0.01 * 1, 'a flat preview still steps');
});

test('the bars scale to the tallest bin without spreading the counts into a call', () => {
    const counts = new Array(100).fill(0);
    counts[3] = 400000; counts[4] = 100000;
    const bars = C.barHeights(hist({ counts }));
    assert.equal(bars.length, 100);
    assert.equal(bars[3], 1);
    assert.equal(bars[4], 0.25);
    assert.equal(bars[0], 0);
    assert.deepEqual(C.barHeights(hist({ counts: [] })), []);
});

// --- the zero bin (SHR-15) --------------------------------------------------------------------------------------

test('the zero bin is on by default at 25% zeros, only for a factory binning, and never when a value is negative', () => {
    const many = { histogram: hist({ zero_share: 0.6, zero_bin_default: true }) };
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count' }), many), true);
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count', bins: 3 }), many), false, 'an edited binning is the user\'s');
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count', zero_bin: true }), many), false, 'already on');
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count' }), { histogram: hist({ zero_share: 0.2, zero_bin_default: false }) }), false);
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count' }), null), false);
    assert.equal(C.zeroBinDefault(norm({ method: 'equal_count' }), {}), false);
    assert.equal(C.zeroBinOffered({ histogram: hist({ has_negative: true }) }), false);
    assert.equal(C.zeroBinOffered({ histogram: hist() }), true);
    assert.equal(C.zeroBinOffered(null), true, 'offered until the preview says otherwise');
});

// --- Freeze thresholds (SHR-17) ---------------------------------------------------------------------------------

test('freeze keeps today\'s inner edges as manual thresholds and the zero bin, and is null where there is nothing to freeze', () => {
    const info = { edges: [0.4, 0.93, 1.6, 2.2, 9], bins_made: 4 };
    assert.deepEqual(C.freeze(norm({ method: 'equal_count', zero_bin: true }), info), { method: 'manual', thresholds: [0.93, 1.6, 2.2], zero_bin: true });
    assert.equal(C.freeze(norm({ method: 'manual', thresholds: [1] }), info), null);
    assert.equal(C.freeze(norm({ method: 'equal_count' }), { ...info, degenerate: true }), null);
    assert.equal(C.freeze(norm({ method: 'equal_count' }), null), null);
});

// --- the sentences of UX 2.4 ------------------------------------------------------------------------------------

test('the line under the chips names the population the edges came from', () => {
    assert.equal(C.edgesLine({ edges_from: 'shown', edges_n: 8090 }), 'Edges from the 8,090 cells shown.');
    assert.equal(C.edgesLine({ edges_from: 'all', edges_n: 8090 }), 'Edges from all 8,090 cells of the dataset.');
    assert.equal(C.edgesLine({ edges_from: 'shown', edges_n: 1 }), 'Edges from the 1 cell shown.');
    assert.equal(C.edgesLine({}), '');
    assert.equal(C.edgesLine(null), '');
});

test('the notes say fewer bins made, cells with no bin, degenerate data and clamped cells, each once', () => {
    const merged = C.binningNotes(norm({ method: 'equal_count', bins: 4 }), { bins_asked: 4, bins_made: 3, edges: [0, 1, 2, 3] });
    assert.deepEqual(merged.map((n) => n.text), ['4 bins asked, 3 made: many cells share the same value, so edges merged.']);
    const log = C.binningNotes(norm({ method: 'log' }), { bins_asked: 10, bins_made: 10, n_no_value: 312, edges: [1, 2] });
    assert.deepEqual(log.map((n) => n.text), ['312 cells at or below 0 have no bin. Turn on Zero as its own bin to keep them.']);
    assert.deepEqual(C.binningNotes(norm({ method: 'log', zero_bin: true }), { bins_asked: 10, bins_made: 10, n_no_value: 312 }), []);
    const flat = C.binningNotes(norm({ method: 'equal_count' }), { degenerate: true, value: 1.2, edges: [1.2], bins_asked: 4, bins_made: 1 });
    assert.deepEqual(flat.map((n) => n.text), ['All cells share one value.'], 'a degenerate reply is not also "fewer bins made"');
    const clamp = C.binningNotes(norm({ method: 'equal_width', range: [0, 5] }), { bins_asked: 10, bins_made: 10, n_outside: 41, edges: [0, 5] });
    assert.deepEqual(clamp.map((n) => n.text), ['41 cells outside the range are in the end bins.']);
    assert.deepEqual(C.binningNotes(norm({ method: 'equal_width', range: [0, 5], outside: 'exclude' }), { n_outside: 41, bins_asked: 10, bins_made: 10 }, { kind: 'count' })
        .map((n) => n.text), [], 'a count plot says it in its status strip');
    assert.deepEqual(C.binningNotes(norm({ method: 'equal_count' }), null), []);
});

test('the help under Range depends on who asks', () => {
    assert.equal(C.rangeHelp('grouping'), 'Values outside go into the first or last bin, labelled ≤ and ≥.');
    assert.equal(C.rangeHelp('count'), 'Values outside are left out and counted.');
});

test('the frozen line and the moved-edges line', () => {
    assert.equal(C.frozenLine({ method: 'equal_count', population: 'the 8,090 cells shown' }), 'Frozen from equal count on the 8,090 cells shown.');
    assert.equal(C.movedLine(2431), 'Edges now come from the 2,431 cells shown.');
});

test('a card for a panel with no preview yet draws a model with no histogram and no edges without throwing', () => {
    for (const b of [{ method: 'equal_count' }, { method: 'manual', thresholds: [1] }, { method: 'equal_width', range: [0, 1] }, { method: 'categories' }]) {
        assert.doesNotThrow(() => C.binningNotes(norm(b), null));
        assert.doesNotThrow(() => C.lineValues(norm(b), null));
    }
    assert.deepEqual(C.lineValues(norm({ method: 'manual', thresholds: [3, 1] }), null), [1, 3]);
    assert.deepEqual(C.lineValues(norm({ method: 'equal_count' }), { edges: [0, 1, 2, 5] }), [1, 2]);
    assert.deepEqual(C.lineValues(norm({ method: 'equal_count' }), { edges: [0, 5], degenerate: true }), []);
});
