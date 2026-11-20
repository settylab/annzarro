/**
 * Inspecting a score (static/js/utils/score-inspect.js): the histogram's bins,
 * the cells with no score, the per-gene rows and their flags, sorting and the
 * two CSV builders.
 *
 * Run:  node --test annzarro/tests/js/score-inspect.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const I = await import('../../../static/js/utils/score-inspect.js');

test('every finite value falls in exactly one bin and the top value is in the last', () => {
    const v = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const d = I.distribution(v, { bins: 5 });
    assert.equal(d.counts.length, 5);
    assert.equal(d.counts.reduce((a, b) => a + b, 0), 11);
    assert.deepEqual(d.counts, [2, 2, 2, 2, 3]);       // 10 is in the last bin
    assert.equal(d.edges.length, 6);
    assert.equal(d.edges[0], 0);
    assert.equal(d.edges[5], 10);
    assert.equal(d.min, 0);
    assert.equal(d.max, 10);
    assert.equal(d.mean, 5);
    assert.ok(Math.abs(d.sd - Math.sqrt(10)) < 1e-9);
});

test('NaN and infinite scores are counted as missing and kept out of the figures', () => {
    const v = new Float32Array([1, NaN, 3, Infinity, NaN, -Infinity, 5]);
    const d = I.distribution(v, { bins: 4 });
    assert.equal(d.n, 7);
    assert.equal(d.finite, 3);
    assert.equal(d.missing, 4);
    assert.equal(d.counts.reduce((a, b) => a + b, 0), 3);
    assert.equal(d.mean, 3);
    assert.equal(d.min, 1);
    assert.equal(d.max, 5);
    assert.match(I.missingText(d), /^4 cells have no score/);
    assert.match(I.missingText(I.distribution(new Float32Array([1, NaN]))), /^1 cell has no score/);
    assert.equal(I.missingText(I.distribution(new Float32Array([1, 2]))), 'No cell is missing a score.');
});

test('a score that is missing everywhere, or constant, has no bins or one', () => {
    const none = I.distribution(new Float32Array([NaN, NaN]));
    assert.equal(none.finite, 0);
    assert.equal(none.missing, 2);
    assert.deepEqual(none.counts, []);
    assert.equal(none.mean, null);
    const same = I.distribution(new Float32Array([2, 2, 2]));
    assert.deepEqual(same.counts, [3]);
    assert.equal(same.sd, 0);
    assert.equal(I.binText(same, 0), '2: 3 cells (100.0%)');
    assert.deepEqual(I.distribution(new Float32Array(0)).counts, []);
});

test('a million cells are binned without spreading the array', () => {
    const v = new Float32Array(1_000_000);
    for (let i = 0; i < v.length; i++) v[i] = (i % 1000) / 10;
    const d = I.distribution(v);
    assert.equal(d.counts.reduce((a, b) => a + b, 0), 1_000_000);
    assert.equal(d.counts.length, I.BINS);
});

test('bin text names the range, the count and the share', () => {
    const d = I.distribution(new Float32Array([0, 0, 0, 10]), { bins: 2 });
    assert.equal(I.binText(d, 0), '0 to 5: 3 cells (75.0%)');
    assert.equal(I.binText(d, 1), '5 to 10: 1 cell (25.0%)');
});

test('number formats', () => {
    assert.equal(I.fmtNum(0.123456), '0.123');
    assert.equal(I.fmtNum(41.234), '41.2');
    assert.equal(I.fmtNum(0), '0');
    assert.equal(I.fmtNum(NaN), '');
    assert.equal(I.fmtNum(null), '');
    assert.equal(I.fmtPercent(0.412), '41.2%');
    assert.equal(I.fmtPercent(0.0004), '<0.1%');
    assert.equal(I.fmtPercent(0), '0%');
    assert.equal(I.fmtPercent(null), '');
});

const gene = (name, extra = {}) => ({ name, column: 0, status: 'used', mean: 1, sd: 1, detected: 0.4, clipped: 0, ...extra });

test('genes barely detected, or clipped in many cells, are flagged in plain words (z-score mean)', () => {
    const rows = I.geneRows([gene('A'), gene('RARE', { detected: 0.004 }), gene('CLIP', { clipped: 0.032 }),
        gene('BOTH', { detected: 0.002, clipped: 0.5 })], 'zscore_mean');
    const kinds = Object.fromEntries(rows.map(r => [r.name, r.flags.map(f => f.kind)]));
    assert.deepEqual(kinds, { A: [], RARE: ['rare'], CLIP: ['dominates'], BOTH: ['rare', 'dominates'] });
    assert.match(rows[1].flags[0].text, /^Barely detected: non-zero in 0\.4% of cells/);
    assert.match(rows[2].flags[0].text, /^Dominates: clipped in 3\.2% of cells/);
    assert.equal(I.flagSummary(rows), '2 genes dominate the score, 2 are barely detected.');
});

test('in a plain mean a gene dominates when its spread is most of the total', () => {
    const rows = I.geneRows([gene('BIG', { sd: 30 }), gene('b', { sd: 1 }), gene('c', { sd: 1 }), gene('d', { sd: 1 })], 'mean');
    assert.deepEqual(rows.map(r => r.flags.map(f => f.kind)), [['dominates'], [], [], []]);
    assert.match(rows[0].flags[0].text, /about 100% of all genes' spread/);
    // equal spreads: nobody dominates
    const even = I.geneRows([gene('a'), gene('b'), gene('c')], 'mean');
    assert.ok(even.every(r => !r.flags.length));
    // one gene cannot dominate itself
    assert.deepEqual(I.geneRows([gene('only', { sd: 5 })], 'mean')[0].flags, []);
});

test('clipping does not apply to a plain mean and its figure stays empty', () => {
    const rows = I.geneRows([gene('A', { clipped: null }), gene('B', { clipped: null }), gene('C', { clipped: null })], 'mean');
    assert.equal(rows[0].clipped, null);
    assert.equal(I.flagSummary(rows), '');
});

test('constant genes and genes with no values are said to be left out', () => {
    const rows = I.geneRows([gene('K', { status: 'constant', sd: 0 }), gene('N', { status: 'no_values', mean: null, sd: null, detected: null }),
        gene('A')], 'zscore_mean');
    assert.deepEqual(rows.map(r => r.flags.map(f => f.kind)), [['left-out'], ['left-out'], []]);
    assert.match(rows[0].flags[0].text, /^Left out: the same value in every cell/);
    assert.equal(I.flagSummary(rows), '2 were left out.');
    assert.equal(rows[1].mean, null);
});

test('sorting: numbers in either direction, missing last, ties by name, the input untouched', () => {
    const rows = I.geneRows([gene('C', { detected: 0.3 }), gene('A', { detected: 0.3 }), gene('B', { detected: null }), gene('D', { detected: 0.9 })], 'mean');
    const before = rows.map(r => r.name).join('');
    assert.equal(I.sortGeneRows(rows, 'detected', 'asc').map(r => r.name).join(''), 'ACDB');
    assert.equal(I.sortGeneRows(rows, 'detected', 'desc').map(r => r.name).join(''), 'DACB');
    assert.equal(I.sortGeneRows(rows, 'name', 'desc').map(r => r.name).join(''), 'DCBA');
    assert.equal(rows.map(r => r.name).join(''), before);
});

test('csv fields are quoted when they need it and formulas are defused', () => {
    assert.equal(I.csvField('plain'), 'plain');
    assert.equal(I.csvField('a,b'), '"a,b"');
    assert.equal(I.csvField('say "hi"'), '"say ""hi"""');
    assert.equal(I.csvField('line\nbreak'), '"line\nbreak"');
    assert.equal(I.csvField('=1+1', { text: true }), "'=1+1");
    assert.equal(I.csvField('-5', { text: true }), '-5');          // a number is not a formula
    assert.equal(I.csvField('@SUM(A1)', { text: true }), "'@SUM(A1)");
    assert.equal(I.csvField('=1+1'), '=1+1');
    assert.equal(I.csvField(null), '');
});

test('the gene csv carries every gene with fractions, in the order sent', () => {
    const csv = I.longGeneCsv([{ label: 'T', genes: [gene('CD3D', { mean: 0.5, sd: 1.25, detected: 0.412, clipped: 0.001 }),
        gene('X,Y', { status: 'constant', mean: 2, sd: 0, detected: 1, clipped: null }), gene('NV', { status: 'no_values', mean: null, sd: null, detected: null, clipped: null })] }]);
    assert.equal(csv, [
        'combination,gene,status,detected_fraction,mean,sd,clipped_fraction',
        'T,CD3D,used,0.412,0.5,1.25,0.001',
        'T,"X,Y",constant,1,2,0,',
        'T,NV,no_values,,,,',
        ''
    ].join('\r\n'));
    assert.equal(I.longGeneCsv([]), 'combination,gene,status,detected_fraction,mean,sd,clipped_fraction\r\n');
});

test('file names are safe', () => {
    assert.equal(I.fileName('T cell score', 'zscore_mean_genes'), 'T_cell_score_zscore_mean_genes.csv');
    assert.equal(I.fileName('a/b\\c:d', 'x'), 'a_b_c_d_x.csv');
    assert.equal(I.fileName('', 'x'), 'signature_x.csv');
});

// ---------------------------------------------------------------------------------------------------------------
// export of several method · layer combinations

test('gene figures of several combinations are long: one row per combination and gene', () => {
    const csv = I.longGeneCsv([
        { label: 'T · z-score mean · X', genes: [{ name: 'A', status: 'used', detected: 0.5, mean: 1, sd: 2, clipped: 0.1 }] },
        { label: 'T · mean · counts', genes: [{ name: '=B', status: 'constant', detected: 1, mean: 3, sd: 0, clipped: null }] }]);
    assert.equal(csv, 'combination,gene,status,detected_fraction,mean,sd,clipped_fraction\r\nT · z-score mean · X,A,used,0.5,1,2,0.1\r\n'
        + "T · mean · counts,'=B,constant,1,3,0,\r\n");
});

test('file names: one combination keeps its name, several are named for the source', () => {
    assert.equal(I.exportFileName('T cell', 'scores', [{ method: 'mean', layer: 'X' }]), 'T_cell_mean_X_scores.csv');
    assert.equal(I.exportFileName('T cell', 'scores', [{ method: 'mean', layer: 'X' }, { method: 'sum', layer: 'X' }]), 'T_cell_scores.csv');
});
