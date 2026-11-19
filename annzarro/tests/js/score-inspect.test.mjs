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
    const csv = I.geneCsv([gene('CD3D', { mean: 0.5, sd: 1.25, detected: 0.412, clipped: 0.001 }),
        gene('X,Y', { status: 'constant', mean: 2, sd: 0, detected: 1, clipped: null }), gene('NV', { status: 'no_values', mean: null, sd: null, detected: null, clipped: null })]);
    assert.equal(csv, [
        'gene,status,detected_fraction,mean,sd,clipped_fraction',
        'CD3D,used,0.412,0.5,1.25,0.001',
        '"X,Y",constant,1,2,0,',
        'NV,no_values,,,,',
        ''
    ].join('\r\n'));
    assert.equal(I.geneCsv([]), 'gene,status,detected_fraction,mean,sd,clipped_fraction\r\n');
});

test('float32 values are written in the fewest digits that read back exactly', () => {
    assert.equal(I.float32Text(Math.fround(0.1)), '0.1');
    assert.equal(I.float32Text(Math.fround(-1.2345678)), '-1.2345678');
    assert.equal(I.float32Text(0), '0');
    assert.equal(I.float32Text(3), '3');
    assert.equal(I.float32Text(NaN), '');
    for (const x of [0.3, 1 / 3, 12345.678, 1e-7, 123456.7, 2 ** 24 + 2]) {
        const f = Math.fround(x);
        assert.equal(Math.fround(Number(I.float32Text(f))), f, String(x));
    }
});

test('the score csv is cell name and value, in order, with an empty value for a missing score', () => {
    const parts = I.scoreCsvParts(['c0', 'c,1', 'c2'], new Float32Array([0.5, NaN, -2]));
    assert.equal(parts.join(''), 'cell,score\r\nc0,0.5\r\n"c,1",\r\nc2,-2\r\n');
});

test('the score csv is built in chunks and refuses a mismatch', () => {
    const n = 120_001;
    const names = Array.from({ length: n }, (_, i) => `c${i}`);
    const values = new Float32Array(n).map((_, i) => i);
    const parts = I.scoreCsvParts(names, values, { chunk: 50000 });
    assert.equal(parts.length, 1 + 3);
    const lines = parts.join('').split('\r\n');
    assert.equal(lines.length, n + 2);             // header, rows, trailing empty
    assert.equal(lines[n], `c${n - 1},${n - 1}`);
    assert.throws(() => I.scoreCsvParts(['a'], new Float32Array(2)), /1 cell names for 2 scores/);
});

test('file names are safe', () => {
    assert.equal(I.fileName('T cell score', 'zscore_mean_genes'), 'T_cell_score_zscore_mean_genes.csv');
    assert.equal(I.fileName('a/b\\c:d', 'x'), 'a_b_c_d_x.csv');
    assert.equal(I.fileName('', 'x'), 'signature_x.csv');
});

// ---------------------------------------------------------------------------------------------------------------
// export of several method · layer combinations

test('several combinations make one column each, headed with the full label, a row per cell', () => {
    const names = ['c0', 'c1', 'c2'];
    const parts = I.multiScoreCsvParts(names, [
        { header: 'T · z-score mean · X', values: new Float32Array([1, 2.5, NaN]) },
        { header: 'T · mean · counts', values: new Float32Array([0.1, 0, 7]) }], { chunk: 2 });
    assert.deepEqual(parts, ['cell,T · z-score mean · X,T · mean · counts\r\n', 'c0,1,0.1\r\nc1,2.5,0\r\n', 'c2,,7\r\n']);
    assert.throws(() => I.multiScoreCsvParts(['a'], [{ header: 'h', values: [1, 2] }]), /1 cell names for 2 scores/);
});

test('formula-like cell names and headers follow the same rules as one column', () => {
    const parts = I.multiScoreCsvParts(['=SUM(A1)', '+1x', 'a,b'], [{ header: 'a,b', values: [1, 2, 3] }, { header: 'h', values: [4, 5, 6] }]);
    assert.equal(parts[0], 'cell,"a,b",h\r\n');
    assert.equal(parts[1], "'=SUM(A1),1,4\r\n'+1x,2,5\r\n\"a,b\",3,6\r\n");
});

test('blob parts hold the same text, and nothing is one string of the whole file', async () => {
    const names = Array.from({ length: 120000 }, (_, i) => `c${i}`);
    const cols = [{ header: 'h', values: new Float32Array(names.length).fill(1) }];
    const parts = I.multiScoreCsvParts(names, cols, { blobs: true });
    assert.equal(parts.length, 1 + 3, 'a header and three chunks of at most 50,000 rows');
    assert.ok(parts.every(p => p instanceof Blob));
    assert.equal(await new Blob(parts).text(), I.multiScoreCsvParts(names, cols).join(''));
});

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
