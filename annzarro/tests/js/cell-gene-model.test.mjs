/**
 * The statistics, scalings and gene-set rows of the Cell-Gene Plot (utils/cell-gene-model.js, SHR-19, SHR-21, CXG-9,
 * CXG-10, CXG-16, CXG-17, CXG-20), against scanpy.
 *
 * The oracle is tests/data/oracle/dotplot_matrixplot.json, which tests/core/test_oracle_dotplot_json.py keeps equal to
 * what its exporter writes from the scanpy .npz. It holds the moments of each gene in each group, which is what the
 * server sends, and scanpy's DotPlot and MatrixPlot values. Parity is 1e-9 relative (README of the oracle folder).
 *
 * Run:  node --test annzarro/tests/js/cell-gene-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'oracle', 'dotplot_matrixplot.json'), 'utf8'));
const M = await import('../../../static/js/utils/cell-gene-model.js');

const REL = 1e-9;
const ABS = 1e-12;
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= REL * Math.max(Math.abs(a), Math.abs(b)) + ABS, `${what}: ${a} vs ${b}`);

/** The oracle's moments of one gene as the wire writes them: groups x 5 in one Float64Array. */
const flat = (perGene) => Float64Array.from(perGene.flat());
const momentsOf = (layer, groupby, cut) => oracle.moments[`${layer}__${groupby}__cut${cut}`].map(flat);
const nGroupsOf = (groupby) => oracle.groupby[groupby].groups.length;
/** Genes x groups as a matrix `{values, rows, groups}`, from one column per gene. */
const matrixOf = (columns, groups) => {
    const values = new Float64Array(columns.length * groups);
    columns.forEach((c, i) => values.set(c, i * groups));
    return { values, rows: columns.length, groups };
};
/** scanpy writes groups x genes; the model's rows are genes. */
const transpose = (byGroup) => byGroup[0].map((_, j) => byGroup.map((row) => row[j]));
const sizesOf = (groupby) => Float64Array.from(oracle.groupby[groupby].n_cells);

const CASES = [];
for (const layer of oracle.layers) for (const groupby of oracle.groupbys) CASES.push([layer, groupby]);

// --- parity with scanpy (SHR-19, CXG-10) -------------------------------------------------------------------------

test('dot colour and size equal scanpy for every layer, grouping, cutoff, mean-only-expressed and scaling', () => {
    let compared = 0;
    for (const [layer, groupby] of CASES) {
        const G = nGroupsOf(groupby);
        for (const cut of oracle.cutoffs) {
            const moments = momentsOf(layer, groupby, cut);
            for (const mo of [0, 1]) {
                const colour = moments.map((m) => M.statisticColumn(mo ? 'mean_expressing' : 'mean', m, G));
                const size = moments.map((m) => M.statisticColumn('pct_expressing', m, G));
                for (const ss of oracle.scales) {
                    const ref = oracle.dot[`${layer}__${groupby}__cut${cut}__mo${mo}__ss${ss}`];
                    const scaled = M.scale(matrixOf(colour, G), ss === 'none' ? 'none' : ss);
                    const want = transpose(ref.color);
                    want.forEach((row, r) => row.forEach((v, g) => near(scaled[r * G + g], v, `${layer} ${groupby} cut${cut} mo${mo} ss${ss} colour [${r}][${g}]`)));
                    // scanpy never scales the size, and writes a fraction where this model writes 0 to 100
                    transpose(ref.size).forEach((row, r) => row.forEach((v, g) => near(size[r][g], 100 * v, `${layer} ${groupby} cut${cut} size [${r}][${g}]`)));
                    compared += want.length * G;
                }
            }
        }
    }
    assert.ok(compared > 10000, `only ${compared} values compared`);
});

test('a matrix plot\'s values equal scanpy for every layer, grouping and scaling', () => {
    let compared = 0;
    for (const [layer, groupby] of CASES) {
        const G = nGroupsOf(groupby);
        const means = momentsOf(layer, groupby, 0).map((m) => M.statisticColumn('mean', m, G));
        for (const ss of oracle.scales) {
            const scaled = M.scale(matrixOf(means, G), ss);
            transpose(oracle.matrix[`${layer}__${groupby}__ss${ss}`]).forEach((row, r) => row.forEach((v, g) => {
                near(scaled[r * G + g], v, `${layer} ${groupby} ss${ss} [${r}][${g}]`);
                compared += 1;
            }));
        }
    }
    assert.ok(compared > 5000);
});

test('a constant gene gives 0, not NaN, under both min-to-max scalings and under z-score across groups', () => {
    const G = nGroupsOf('cell_type');
    const idx = oracle.genes.indexOf('GENE003');          // expressed by nobody
    for (const layer of ['logged', 'counts']) {
        const m = momentsOf(layer, 'cell_type', 0)[idx];
        const row = M.statisticColumn('mean', m, G);
        assert.ok(row.every((v) => v === 0));
        for (const s of ['var', 'group', 'z_groups']) {
            const out = M.scale(matrixOf([row], G), s);
            assert.ok(out.every((v) => v === 0), `${layer} ${s}: ${Array.from(out)}`);
        }
    }
});

// --- the statistics from moments (SHR-19, SHR-20) ---------------------------------------------------------------

/** Moments of a list of values, the way the server writes them: [n, sum, sumsq, nAbove, sumAbove]. */
const momentsFromValues = (values, t = 0) => {
    const v = values.filter(Number.isFinite);
    const hi = v.filter((x) => x > t);
    return [v.length, v.reduce((a, b) => a + b, 0), v.reduce((a, b) => a + b * b, 0), hi.length, hi.reduce((a, b) => a + b, 0)];
};
const wire = (...groups) => Float64Array.from(groups.flat());

test('every statistic of SHR-19 from the five moments', () => {
    const m = wire(momentsFromValues([0, 0, 2, 4]), momentsFromValues([1, 3]));
    const G = 2;
    assert.deepEqual(Array.from(M.statisticColumn('mean', m, G)), [1.5, 2]);
    assert.deepEqual(Array.from(M.statisticColumn('pct_expressing', m, G)), [50, 100]);
    assert.deepEqual(Array.from(M.statisticColumn('mean_expressing', m, G)), [3, 2]);
    assert.deepEqual(Array.from(M.statisticColumn('sum', m, G)), [6, 4]);
    near(M.statisticColumn('sd', m, G)[0], Math.sqrt(((0 - 1.5) ** 2 * 2 + (2 - 1.5) ** 2 + (4 - 1.5) ** 2) / 4), 'population SD, ddof 0');
    assert.equal(M.statisticColumn('sd', m, G)[1], 1);
    assert.deepEqual(Array.from(M.statisticColumn('count', null, G, Float64Array.of(7, 9))), [7, 9]);
});

test('a group with no finite value has no value, never 0, for every statistic that needs a cell', () => {
    const m = wire(momentsFromValues([NaN, Infinity]), momentsFromValues([1]));
    for (const stat of ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd']) {
        const col = M.statisticColumn(stat, m, 2);
        assert.ok(Number.isNaN(col[0]), `${stat} of a group with no finite value is ${col[0]}`);
        assert.ok(Number.isFinite(col[1]), stat);
    }
});

test('P3: the mean of expressing cells of a group with no expressing cell is 0, flagged, in one place', () => {
    const m = wire(momentsFromValues([0, 0, 0]), momentsFromValues([1, 2]), momentsFromValues([]));
    const col = M.statisticColumn('mean_expressing', m, 3);
    assert.equal(col[0], 0);
    assert.equal(col[1], 1.5);
    assert.ok(Number.isNaN(col[2]), 'no cell at all is missing, not 0');
    const flags = M.noExpressingCells('mean_expressing', m, 3);
    assert.deepEqual(Array.from(flags), [1, 0, 0]);
    assert.deepEqual(Array.from(M.noExpressingCells('mean', m, 3)), [0, 0, 0], 'only that statistic carries the note');
    assert.equal(M.statisticColumn('mean', m, 3)[0], 0, 'a plain mean of zeros is a measured 0');
});

test('the pooled SD of a constant gene is 0 whatever the rounding of its sums', () => {
    const m = wire(momentsFromValues([2.5, 2.5, 2.5]), momentsFromValues([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]));
    assert.deepEqual(Array.from(M.statisticColumn('sd', m, 2)), [0, 0]);
    const p = M.pooledReference(m, 2);
    assert.equal(p.mean, 2.5);
    assert.equal(p.sd, 0);
});

// --- scaling (CXG-10) -------------------------------------------------------------------------------------------

test('scaling skips groups with no value and never writes a value for them', () => {
    const rows = matrixOf([Float64Array.of(1, NaN, 3), Float64Array.of(NaN, NaN, NaN)], 3);
    const var01 = M.scale(rows, 'var');
    assert.deepEqual(Array.from(var01.slice(0, 3)).map((v) => (Number.isNaN(v) ? 'NaN' : v)), [0, 'NaN', 1]);
    assert.ok(Array.from(var01.slice(3)).every(Number.isNaN), 'a row with no value stays missing');
    const grp = M.scale(matrixOf([Float64Array.of(1, 5), Float64Array.of(NaN, 9)], 2), 'group');
    assert.deepEqual(Array.from(grp).map((v) => (Number.isNaN(v) ? 'NaN' : v)), [0, 0, 'NaN', 1], 'one value in a group is constant, so 0');
});

test('scale returns a new array and leaves the matrix alone', () => {
    const rows = matrixOf([Float64Array.of(1, 2, 3)], 3);
    const before = Array.from(rows.values);
    const out = M.scale(rows, 'var');
    assert.notEqual(out, rows.values);
    assert.deepEqual(Array.from(rows.values), before);
    assert.equal(M.scale(rows, 'none')[2], 3);
});

test('z-score across groups uses the population SD of the groups with a value', () => {
    const out = M.scale(matrixOf([Float64Array.of(1, 2, 3, NaN)], 4), 'z_groups');
    const sd = Math.sqrt(2 / 3);
    near(out[0], -1 / sd, 'z0');
    assert.equal(out[1], 0);
    near(out[2], 1 / sd, 'z2');
    assert.ok(Number.isNaN(out[3]));
});

test('z-score against all grouped cells pools the groups\' moments, and only the groups that count (OD 12)', () => {
    // gene in three groups: {0,2} {4} {10,10,10}. The third group is "hidden": its cells are not grouped cells.
    const groups = [[0, 2], [4], [10, 10, 10]];
    const m = wire(...groups.map((g) => momentsFromValues(g)));
    const counted = Uint8Array.of(1, 1, 0);
    const cells = [0, 2, 4];
    const mu = cells.reduce((a, b) => a + b) / 3;
    const sd = Math.sqrt(cells.reduce((a, b) => a + (b - mu) ** 2, 0) / 3);
    const p = M.pooledReference(m, 3, counted);
    near(p.mean, mu, 'pooled mean');
    near(p.sd, sd, 'pooled SD');
    const means = M.statisticColumn('mean', m, 3);
    const out = M.scale(matrixOf([means], 3), 'z_pooled', [p]);
    near(out[0], (1 - mu) / sd, 'group 0');
    near(out[1], (4 - mu) / sd, 'group 1');
    near(out[2], (10 - mu) / sd, 'a hidden group is still drawn against the reference of the others');
    const all = M.pooledReference(m, 3);
    assert.notEqual(all.mean, p.mean, 'without the mask every group counts');
});

test('z_pooled without a reference is refused, not guessed', () => {
    assert.throws(() => M.scale(matrixOf([Float64Array.of(1, 2)], 2), 'z_pooled'), /reference/);
    assert.throws(() => M.scale(matrixOf([Float64Array.of(1, 2)], 2), 'nope'), /scaling/);
});

test('every scaling id of the frozen schema is known and none else', () => {
    assert.deepEqual(M.SCALINGS, ['none', 'var', 'group', 'z_groups', 'z_pooled']);
});

// --- gene-set rows (SHR-21) ------------------------------------------------------------------------------------

const setCase = () => {
    // three genes, three groups
    const genes = [
        wire(momentsFromValues([0, 2]), momentsFromValues([4, 6]), momentsFromValues([0, 0])),
        wire(momentsFromValues([1, 1]), momentsFromValues([3, 5]), momentsFromValues([NaN])),       // no value in group 2
        wire(momentsFromValues([0, 0]), momentsFromValues([0, 0]), momentsFromValues([2, 2]))
    ];
    return genes;
};
const columnsOf = (genes, stat) => genes.map((g) => M.statisticColumn(stat, g, 3));

test('the aggregations of SHR-21 are one list of two kinds, with the cheap summaries first', () => {
    assert.deepEqual(Object.keys(M.ROW_AGGREGATIONS),
        ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing', 'score_mean', 'score_pct_above']);
    for (const id of ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing']) assert.equal(M.ROW_AGGREGATIONS[id].kind, 'summary');
    for (const id of ['score_mean', 'score_pct_above']) assert.equal(M.ROW_AGGREGATIONS[id].kind, 'score');
    assert.deepEqual(M.DEFAULT_ROW_AGGREGATIONS, { color: 'mean_of_means', size: 'mean_of_pct_expressing' });
});

test('mean and sum of the genes\' means skip a gene with no value in that group', () => {
    const genes = setCase();
    // means: g0: 1 5 0 | g1: 1 4 missing | g2: 0 0 2
    assert.deepEqual(Array.from(M.setRow('mean_of_means', genes, 3)), [2 / 3, 3, 1]);
    assert.deepEqual(Array.from(M.setRow('sum_of_means', genes, 3)), [2, 9, 2]);
});

test('mean of the genes\' % expressing', () => {
    const genes = setCase();
    // pct: g0 50 100 0 | g1 100 100 NaN | g2 0 0 100
    assert.deepEqual(Array.from(M.setRow('mean_of_pct_expressing', genes, 3)), [50, 200 / 3, 50]);
});

test('mean of the genes\' z-scores uses each gene\'s pooled mean and SD over the grouped cells', () => {
    const genes = setCase();
    const counted = Uint8Array.of(1, 1, 0);
    const refs = genes.map((g) => M.pooledReference(g, 3, counted));
    const means = columnsOf(genes, 'mean');
    const z = (gi, g) => (refs[gi].sd === 0 ? 0 : (means[gi][g] - refs[gi].mean) / refs[gi].sd);
    const out = M.setRow('mean_of_zscores', genes, 3, { counted });
    near(out[0], (z(0, 0) + z(1, 0) + z(2, 0)) / 3, 'group 0');
    near(out[1], (z(0, 1) + z(1, 1) + z(2, 1)) / 3, 'group 1');
    near(out[2], (z(0, 2) + z(2, 2)) / 2, 'group 2 skips the gene with no value');
});

test('a set row with no gene having a value in a group has no value there, never 0', () => {
    const genes = [wire(momentsFromValues([1]), momentsFromValues([]))];
    for (const agg of ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing']) {
        const out = M.setRow(agg, genes, 2);
        assert.ok(Number.isFinite(out[0]) && Number.isNaN(out[1]), agg);
    }
});

test('the per-cell score kinds are the score\'s own moments: its mean, and the share above', () => {
    const score = wire(momentsFromValues([1, 2, 3, 4], 2), momentsFromValues([5, 5]), momentsFromValues([]));
    assert.deepEqual(Array.from(M.setRow('score_mean', score, 3)).map((v) => (Number.isNaN(v) ? 'NaN' : v)), [2.5, 5, 'NaN']);
    assert.deepEqual(Array.from(M.setRow('score_pct_above', score, 3)).map((v) => (Number.isNaN(v) ? 'NaN' : v)), [50, 100, 'NaN']);
});

test('summaries and score kinds are not mixed up: each takes its own input', () => {
    assert.throws(() => M.setRow('score_mean', setCase(), 3), /score/);
    assert.throws(() => M.setRow('mean_of_means', wire(momentsFromValues([1])), 1), /genes/);
    assert.throws(() => M.setRow('median', [], 1), /aggregation/);
});

test('summaries need no request: they are computed from the genes\' moments alone', () => {
    // setRow takes no fetch, no store and no score; the list says which kind needs a score
    for (const [id, a] of Object.entries(M.ROW_AGGREGATIONS)) assert.equal(a.needsScore, a.kind === 'score', id);
});

// --- availability and limits (OD 8, CXG-17) --------------------------------------------------------------------

test('on a signed layer % expressing and mean of expressing cells are unavailable, with the reason (OD 8)', () => {
    for (const stat of ['pct_expressing', 'mean_expressing']) {
        assert.deepEqual(M.statisticAvailability(stat, 'signed'), { available: false, reason: 'negative_values' });
        assert.deepEqual(M.statisticAvailability(stat, 'log'), { available: true });
        assert.deepEqual(M.statisticAvailability(stat, 'unknown'), { available: true });
    }
    for (const stat of ['mean', 'sum', 'sd', 'count']) assert.deepEqual(M.statisticAvailability(stat, 'signed'), { available: true });
});

test('the matrix limit is 400,000 cells and 2,000 genes per section; above, the refusal names which number to reduce', () => {
    assert.deepEqual(M.matrixLimits({ groups: 200, sections: [{ rows: 2000, genes: 2000 }] }), { ok: true });
    assert.deepEqual(M.matrixLimits({ groups: 200, sections: [{ rows: 2000, genes: 2000 }, { rows: 1, genes: 0 }] }), { ok: true });
    assert.deepEqual(M.matrixLimits({ groups: 201, sections: [{ rows: 2000, genes: 2000 }] }),
        { ok: false, reason: 'matrix_too_large', count: 402000, limit: 400000 });
    assert.deepEqual(M.matrixLimits({ groups: 3, sections: [{ rows: 1, genes: 2001 }] }),
        { ok: false, reason: 'too_many_genes', section: 0, count: 2001, limit: 2000 });
    assert.deepEqual(M.matrixLimits({ groups: 3, sections: [{ rows: 5, genes: 5 }, { rows: 2, genes: 2002 }] }),
        { ok: false, reason: 'too_many_genes', section: 1, count: 2002, limit: 2000 });
});

// --- CSV (CXG-20) -----------------------------------------------------------------------------------------------

const NAMES = {
    statistic: { mean: 'Mean', pct_expressing: '% expressing' },
    scaling: { none: 'no scaling', var: 'scaled 0 to 1 per gene' },
    layer: (l) => l,
    noExpressingCells: 'no expressing cells',
    note: 'Note'
};

test('a column header names statistic, layer and scaling', () => {
    assert.equal(M.columnHeader({ stat: 'mean', layer: 'X', scaling: 'var' }, NAMES), 'Mean · X · scaled 0 to 1 per gene');
    assert.equal(M.columnHeader({ stat: 'pct_expressing', layer: 'logged', scaling: 'none' }, NAMES), '% expressing · logged · no scaling');
    assert.equal(M.columnHeader({ stat: 'mean', layer: 'X', scaling: 'none', section: 'B markers' }, NAMES), 'B markers · Mean · X · no scaling');
});

test('the long CSV has one row per row and group, one column per statistic, an empty field for a missing value', () => {
    const csv = M.longCsv({
        groups: [{ label: 'B cell', n: 500 }, { label: 'T, cell', n: 3 }],
        rows: [{ section: 'Markers', label: 'GENE000' }, { section: 'Markers', label: '=SUM' }],
        columns: [
            { stat: 'mean', layer: 'X', scaling: 'none', values: Float64Array.of(1.5, NaN, 0.25, 2) },
            { stat: 'pct_expressing', layer: 'X', scaling: 'none', values: Float64Array.of(10, 20, 30, 40) }
        ],
        header: { section: 'Section', row: 'Row', group: 'Group', cells: 'Cells' }
    }, NAMES);
    assert.deepEqual(csv.split('\n'), [
        'Section,Row,Group,Cells,Mean · X · no scaling,% expressing · X · no scaling',
        'Markers,GENE000,B cell,500,1.5,10',
        'Markers,GENE000,"T, cell",3,,20',
        "Markers,'=SUM,B cell,500,0.25,30",
        "Markers,'=SUM,\"T, cell\",3,2,40",
        ''
    ]);
});

test('the CSV says "no expressing cells" on the row of a group whose mean of expressing cells is the P3 zero', () => {
    const csv = M.longCsv({
        groups: [{ label: 'A', n: 2 }, { label: 'B', n: 2 }],
        rows: [{ section: 'S', label: 'g' }],
        columns: [{ stat: 'mean', layer: 'X', scaling: 'none', values: Float64Array.of(0, 3), noExpressing: Uint8Array.of(1, 0) }],
        header: { section: 'Section', row: 'Row', group: 'Group', cells: 'Cells' }
    }, NAMES).split('\n');
    assert.equal(csv[0].split(',').at(-1), 'Note');
    assert.equal(csv[1].split(',').at(-1), 'no expressing cells');
    assert.equal(csv[2].split(',').at(-1), '');
});

// --- size of the work -------------------------------------------------------------------------------------------

test('a section at the limit (2,000 genes in 200 groups) is derived from its moments in one pass per statistic', () => {
    const G = 200;
    const genes = Array.from({ length: 2000 }, (_, i) => Float64Array.from({ length: G * 5 }, (_, k) => (k % 5 === 0 ? 10 : (i + k) % 7)));
    const columns = genes.map((m) => M.statisticColumn('mean', m, G));
    const out = M.scale(matrixOf(columns, G), 'var');
    assert.equal(out.length, 2000 * G);
    assert.equal(M.setRow('mean_of_means', genes, G).length, G);
});
