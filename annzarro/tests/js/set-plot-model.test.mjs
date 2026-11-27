/**
 * The sets of a Venn or UpSet (utils/set-plot-model.js, V1): a set's kind, its member on the wire, its row text, where
 * each group set stands (SHR-38, UX 2.8), and the SetPlot drawn by draw-sets.js (lead-notes, "V1 output shape").
 *
 * The regions are checked against a brute force: random cells, each in or out of each set, counted into the grid the
 * engine would send (axis per set, levels @in and @out, first axis slowest), then read back by the model.
 *
 * Run:  node --test annzarro/tests/js/set-plot-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/utils/set-plot-model.js');
const M = await import('../../../static/js/utils/count-plot-model.js');
const G = await import('../../../static/js/utils/group-reference.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { cellGroupType } = await import('../../../static/js/utils/cell-group-source.js');
const D = await import('../../../static/js/panels/cell-count/draw-sets.js');
const { PLOT_PALETTES } = await import('../../../static/js/utils/plot-theme.js');

const GROUP = cellGroupType();
const W = VOCABULARY.countSets;

/** A seeded generator, so a failure repeats. */
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * A sets grid of `cells` (each a Uint8Array of in/out per set), as the group store holds the route's reply: one axis
 * per set with the levels @in, @out, counts in mixed-radix order with the first axis slowest; `noValue[s]` per axis.
 */
function setsGrid(cells, k, { noValue = [], measure = null, shown = cells.length } = {}) {
    const counts = new Float64Array(2 ** k);
    const moments = measure ? new Float64Array(2 ** k * 5) : null;
    cells.forEach((inside, c) => {
        let at = 0;
        for (let s = 0; s < k; s++) at = at * 2 + (inside[s] ? 0 : 1);
        counts[at] += 1;
        if (moments) {
            const v = measure[c];
            moments[at * 5] += 1; moments[at * 5 + 1] += v; moments[at * 5 + 2] += v * v;
        }
    });
    const axes = Array.from({ length: k }, (_, s) => ({ kind: 'member', levels: ['@in', '@out'], n_outside: [0, 0],
        ...(noValue[s] !== undefined ? { n_no_value: noValue[s] } : {}) }));
    return M.readGrid({ reply: { n_shown: shown, n_counted: cells.length, axes }, counts, measures: moments });
}

const inputsOf = (k) => Array.from({ length: k }, (_, s) => ({ input: 'sets', set: s }));
const tableOf = (config, grid) => M.countTable(config, grid, inputsOf(config.sets.length));
const setsOf = (k) => Array.from({ length: k }, (_, s) => ({ source: { type: 'obs', key: `c${s}` }, member: { op: '>', value: s } }));

function randomCells(n, k, seed, p = 0.35) {
    const r = rng(seed);
    return Array.from({ length: n }, () => Uint8Array.from({ length: k }, () => (r() < p ? 1 : 0)));
}

/** The exclusive region of each cell, by bit code (bit s = in set s): the brute force. */
function bruteRegions(cells, k) {
    const out = new Map();
    for (const inside of cells) {
        let code = 0;
        for (let s = 0; s < k; s++) if (inside[s]) code |= 1 << s;
        out.set(code, (out.get(code) || 0) + 1);
    }
    return out;
}

const codeOf = (key) => key.reduce((a, v, s) => a + (v ? 1 << s : 0), 0);

// --- regions -------------------------------------------------------------------------------------------------------

test('every region is the exclusive count of its grid cell, for 2 to 16 sets (brute force)', () => {
    for (const k of [2, 3, 5, 9, 16]) {
        const cells = randomCells(3000, k, 17 + k);
        const config = { version: 1, mode: 'upset', sets: setsOf(k), top: 65535 };
        const plot = S.setPlotModel(config, tableOf(config, setsGrid(cells, k)), { names: setsOf(k).map((_, s) => `s${s}`) });
        const brute = bruteRegions(cells, k);
        const got = new Map(plot.regions.map((r) => [codeOf(r.key), r.count]));
        for (const [code, n] of brute) if (code !== 0) assert.equal(got.get(code), n, `k=${k} region ${code}`);
        assert.equal(plot.inNone, brute.get(0) || 0, `k=${k}: cells in no set`);
        assert.ok(plot.regions.every((r) => r.count > 0), 'UpSet lists only regions that hold a cell');
        assert.equal(plot.regions.reduce((a, r) => a + r.count, 0) + plot.inNone, cells.length, 'each cell in exactly one region');
        for (let s = 0; s < k; s++) {
            assert.equal(plot.sets[s].size, cells.filter((c) => c[s]).length, `k=${k}: size of set ${s}`);
        }
        assert.ok(plot.regions.every((r) => r.degree === r.key.reduce((a, v) => a + v, 0) && r.degree >= 1));
    }
});

test('a Venn lists all 2^k - 1 regions, empty ones included, letters A to C, no options and no color', () => {
    const cells = [Uint8Array.of(1, 0, 0), Uint8Array.of(1, 1, 0), Uint8Array.of(0, 0, 0), Uint8Array.of(1, 1, 0)];
    const config = { version: 1, mode: 'venn', sets: setsOf(3) };
    const plot = S.setPlotModel(config, tableOf(config, setsGrid(cells, 3, { shown: 10 })), { names: ['a', 'b', 'c'] });
    assert.equal(plot.regions.length, 7);
    assert.deepEqual(plot.regions.map((r) => codeOf(r.key)), [1, 2, 3, 4, 5, 6, 7], 'in the order of their bit code');
    assert.deepEqual(plot.regions.map((r) => r.count), [1, 0, 2, 0, 0, 0, 0]);
    assert.deepEqual(plot.shown, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(plot.sets.map((s) => s.letter), ['A', 'B', 'C']);
    assert.equal(plot.universe, 10, 'the universe is the cells shown (grid n_shown)');
    assert.equal(plot.regions[2].share, 0.2);
    assert.equal(plot.inNone, 1);
    assert.deepEqual(plot.hidden, { regions: 0, cells: 0, share: 0 });
    assert.equal(plot.options, null);
    assert.equal(plot.color, null);
    assert.ok(plot.regions.every((r) => r.color === null));
});

test('each set carries its cells without a value, counted as out, and its row state', () => {
    const cells = randomCells(200, 3, 5);
    const config = { version: 1, mode: 'venn', sets: setsOf(3) };
    const plot = S.setPlotModel(config, tableOf(config, setsGrid(cells, 3, { noValue: [undefined, 0, 312] })),
        { names: ['a', 'b', 'c'], states: ['ok', 'changed', 'gone'] });
    assert.deepEqual(plot.sets.map((s) => s.noValue), [0, 0, 312]);
    assert.deepEqual(plot.sets.map((s) => s.state), ['ok', 'changed', 'deleted'], 'a group that is gone draws as deleted');
    assert.deepEqual(S.setCounts(plot.sets[2]), { cells: W.cells(plot.sets[2].size), noValue: '312 without a value, counted as out' });
    assert.equal(S.setCounts(plot.sets[0]).noValue, '');
    assert.equal(S.universeLine({ universe: 8090, inNone: 3402 }), 'Universe: the 8,090 cells shown. 3,402 are in no set.');
});

// --- an UpSet's sort, top and minimum size ---------------------------------------------------------------------------

test('UpSet: sorted by size (ties by degree, then key), cut to the top 40, and the share of cells not shown stated', () => {
    const k = 8;
    const cells = randomCells(20000, k, 99, 0.3);
    const config = { version: 1, mode: 'upset', sets: setsOf(k) };
    const plot = S.setPlotModel(config, tableOf(config, setsGrid(cells, k)), { names: setsOf(k).map(String) });
    assert.deepEqual(plot.options, { sort: 'size', top: 40, minSize: 0 });
    assert.equal(plot.shown.length, 40);
    const shown = plot.shown.map((i) => plot.regions[i]);
    for (let i = 1; i < shown.length; i++) {
        const a = shown[i - 1];
        const b = shown[i];
        assert.ok(a.count > b.count || (a.count === b.count && (a.degree < b.degree || (a.degree === b.degree && codeOf(a.key) < codeOf(b.key)))), `order at ${i}`);
    }
    const kept = new Set(plot.shown);
    const notShown = plot.regions.filter((_, i) => !kept.has(i));
    assert.equal(plot.hidden.regions, notShown.length);
    assert.equal(plot.hidden.cells, notShown.reduce((a, r) => a + r.count, 0));
    assert.equal(plot.hidden.share, plot.hidden.cells / cells.length);
    const least = shown.reduce((a, r) => Math.min(a, r.count), Infinity);
    assert.ok(notShown.every((r) => r.count <= least), 'the 40 largest');
});

test('UpSet: by degree, then size; a minimum size; Show top; defaults are not written', () => {
    const k = 4;
    const cells = randomCells(5000, k, 3, 0.5);
    const base = { version: 1, mode: 'upset', sets: setsOf(k) };
    const byDegree = S.setPlotModel({ ...base, sort: 'degree' }, tableOf(base, setsGrid(cells, k)), { names: ['a', 'b', 'c', 'd'] });
    const order = byDegree.shown.map((i) => byDegree.regions[i]);
    for (let i = 1; i < order.length; i++) {
        assert.ok(order[i - 1].degree < order[i].degree || (order[i - 1].degree === order[i].degree && order[i - 1].count >= order[i].count));
    }
    const min = 300;
    const big = S.setPlotModel({ ...base, minSize: min, top: 3 }, tableOf(base, setsGrid(cells, k)), { names: ['a', 'b', 'c', 'd'] });
    assert.ok(big.shown.length <= 3 && big.shown.every((i) => big.regions[i].count >= min));
    assert.deepEqual(big.options, { sort: 'size', top: 3, minSize: min });
    assert.deepEqual(S.upsetOptions({ sort: 'height', top: 0, minSize: -1 }), { sort: 'size', top: 40, minSize: 0 }, "a bar's sort is not an UpSet's");
    assert.deepEqual(S.withUpsetOption({ mode: 'upset', top: 12 }, 'top', 40), { mode: 'upset' });
    assert.deepEqual(S.withUpsetOption({ mode: 'upset' }, 'sort', 'degree'), { mode: 'upset', sort: 'degree' });
    assert.deepEqual(S.parseUpsetOption('top', '25'), { ok: true, value: 25 });
    assert.deepEqual(S.parseUpsetOption('top', ''), { ok: true, value: 40 });
    assert.equal(S.parseUpsetOption('top', '0').ok, false);
    assert.equal(S.parseUpsetOption('top', '2.5').message, 'Enter a whole number from 1 to 65,535.');
    assert.deepEqual(S.parseUpsetOption('minSize', '0'), { ok: true, value: 0 });
    assert.equal(S.parseUpsetOption('minSize', '-3').message, 'Enter a whole number, 0 or more.');
});

test('UpSet bars colored by share of cells shown or by a statistic over the region; none for Count', () => {
    const k = 3;
    const cells = randomCells(400, k, 11);
    const values = cells.map((_, c) => (c % 7) + 0.5);
    const grid = setsGrid(cells, k, { measure: values });
    const base = { version: 1, mode: 'upset', sets: setsOf(k) };
    const words = { ...VOCABULARY.countPlot, measureSource: 'Mrpl15 · logged_counts' };
    const share = S.setPlotModel({ ...base, value: { kind: 'share', of: 'all' } }, tableOf(base, grid), { names: ['a', 'b', 'c'], words });
    assert.deepEqual(share.color, { kind: 'share', label: 'Fraction of cells shown' });
    for (const r of share.regions) assert.ok(Math.abs(r.color - r.count / cells.length) < 1e-12);
    const mean = S.setPlotModel({ ...base, value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: 'layer', key: 'logged_counts', column: 'Mrpl15' } } },
        tableOf(base, grid), { names: ['a', 'b', 'c'], words });
    assert.deepEqual(mean.color, { kind: 'statistic', label: 'Mean of Mrpl15 · logged_counts' });
    for (const r of mean.regions) {
        const own = cells.map((inside, c) => [inside, values[c]]).filter(([inside]) => codeOf(inside) === codeOf(r.key)).map(([, v]) => v);
        assert.ok(Math.abs(r.color - own.reduce((a, v) => a + v, 0) / own.length) < 1e-9, 'the mean over the region');
    }
    const count = S.setPlotModel(base, tableOf(base, grid), { names: ['a', 'b', 'c'] });
    assert.equal(count.color, null);
});

test('the SetPlot is what draw-sets.js draws: a Venn and an UpSet figure come out of it', () => {
    const cells = randomCells(500, 3, 21);
    const venn = { version: 1, mode: 'venn', sets: setsOf(3) };
    const fig = D.buildFigure(S.setPlotModel(venn, tableOf(venn, setsGrid(cells, 3)), { names: ['a', 'b', 'c'] }), PLOT_PALETTES.light);
    assert.equal(fig.layout.shapes.length, 3);
    const upset = { version: 1, mode: 'upset', sets: setsOf(16) };
    const big = randomCells(2000, 16, 23, 0.2);
    const plot = S.setPlotModel(upset, tableOf(upset, setsGrid(big, 16)), { names: setsOf(16).map((_, s) => `s${s}`) });
    const up = D.buildFigure(plot, PLOT_PALETTES.light, { width: 900 });
    assert.equal(up.data.find((t) => t.name === 'intersections').y.length, Math.min(40, plot.regions.length));
});

// --- members, kinds and row text -----------------------------------------------------------------------------------

const STRUCTURE = { obs: { columns: ['is_doublet', 'cell_type', 'pseudotime'], columns_info: {
    is_doublet: { type: 'bool' }, cell_type: { type: 'category', n_categories: 6 }, pseudotime: { type: 'float64' } } } };

test('the member on the wire: a table none, a group its key only (Keep and following never change the request)', () => {
    assert.equal(S.memberOnWire({ source: { type: 'table', key: 't' } }), undefined);
    assert.deepEqual(S.memberOnWire({ source: { type: GROUP, key: 'g' }, member: { group: ['bin:1'], groupWas: ['x 0.5 to 1'], follow: true } }), { group: ['bin:1'] });
    assert.deepEqual(S.memberOnWire({ source: { type: 'obs', key: 'cell_type' }, member: { levels: ['c:T cell', 'c:NK'] } }), { levels: ['c:T cell', 'c:NK'] });
    assert.deepEqual(S.memberOnWire({ source: { type: 'layer', key: 'X', column: 'Cd3e' }, member: { op: '>=', value: 0.5 } }), { op: '>=', value: 0.5 });
    // the grid key of a group set does not move when the stored name or following changes
    const ctx = { isNumeric: () => false, levelCount: () => 2, memberFor: S.memberOnWire };
    const set = (member) => ({ version: 1, mode: 'venn', sets: [{ source: { type: 'table', key: 't' } }, { source: { type: GROUP, key: 'g' }, member }] });
    const a = M.planGrid(set({ group: ['bin:1'], groupWas: ['x 0.5 to 1'] }), ctx);
    const b = M.planGrid(set({ group: ['bin:1'], groupWas: ['x 0.6 to 1.1'], follow: true }), ctx);
    assert.equal(a.state, 'ready');
    assert.equal(a.key, b.key);
    assert.deepEqual(a.request.partitionings[1].member, { group: ['bin:1'] });
    assert.ok(!('member' in a.request.partitionings[0]) || a.request.partitionings[0].member === undefined, 'a table carries no member');
});

test('a set\'s kind and its row text (UX 4.6)', () => {
    const titleOf = (s) => ({ t1: 'Table 1', g1: 'Grouping 1' }[s.key]);
    const table = { source: { type: 'table', key: 't1' } };
    const bool = { source: { type: 'obs', key: 'is_doublet' }, member: { levels: ['c:true'] } };
    const levels = { source: { type: 'obs', key: 'cell_type' }, member: { levels: ['c:T cell', 'c:NK'] } };
    const cond = { source: { type: 'layer', key: 'logged_counts', column: 'Cd3e' }, member: { op: '>', value: 0.5 } };
    const condObs = { source: { type: 'obs', key: 'pseudotime' }, member: { op: '<=', value: 0.25 } };
    const group = { source: { type: GROUP, key: 'g1' }, member: { group: ['bin:1'], groupWas: ['Cd3e 0.5 to 1.75'] } };
    const ctx = { titleOf, structure: STRUCTURE };
    assert.deepEqual([table, bool, levels, cond, condObs, group].map((s) => S.setKind(s, STRUCTURE)), ['table', 'boolean', 'levels', 'condition', 'condition', 'group']);
    assert.equal(S.setKind({ source: { type: 'obs', key: 'cell_type' }, member: { levels: ['c:true'] } }, STRUCTURE), 'levels', 'c:true of a text column is levels');
    assert.equal(S.setText(table, ctx), 'in Table 1');
    assert.equal(S.setText(bool, ctx), 'is_doublet');
    assert.equal(S.setText(levels, ctx), 'cell_type is T cell, NK');
    assert.equal(S.setText(cond, ctx), 'Cd3e > 0.5 (logged_counts)');
    assert.equal(S.setText(condObs, ctx), 'pseudotime ≤ 0.25');
    assert.equal(S.setText(group, ctx), 'Grouping 1: Cd3e 0.5 to 1.75');
    assert.equal(S.setText({ ...group, name: 'T cells' }, ctx), 'T cells', 'the name is editable');
    assert.equal(S.setText(table, {}), 'in t1', 'a table not known any more is named by its id');
});

test('Add set stops at 16, with the reason', () => {
    assert.deepEqual(S.canAddSet({ sets: setsOf(15) }), { ok: true });
    assert.deepEqual(S.canAddSet({ sets: setsOf(16) }), { ok: false, reason: 'UpSet shows up to 16 sets.' });
    assert.deepEqual(S.canAddSet({}), { ok: true });
    assert.deepEqual([...S.SET_KINDS].map((k) => W.kinds[k]),
        ['Cell table…', 'Boolean column…', 'Levels of a column…', 'Condition on a number…', 'Group of a grouping…']);
});

test('a menu that picks the panel behind a set marks a choice that would close a loop, with the reason', async () => {
    const R = await import('../../../static/js/utils/panel-references.js');
    // a grouping G2 computed from a table T2 that is computed from this plot: G2 and T2 would close a loop
    R.registerReferences('v1-test-node', (config) => (config.from ? [{ id: config.from, via: 'filter', get: () => config.from, set() {} }] : []));
    const page = { 'cell-count-1': { type: 'v1-test-node', config: {} }, t1: { type: 'v1-test-node', config: {} },
        t2: { type: 'v1-test-node', config: { from: 'cell-count-1' } }, g2: { type: 'v1-test-node', config: { from: 't2' } } };
    R.setReferenceHost({ panel: (id) => page[id] || null, ids: () => Object.keys(page) });
    try {
        const out = S.panelChoices([{ id: 't1', title: 'Table 1' }, { id: 't2', title: 'Table 2' }, { id: 'g2', title: 'Grouping 2' }], 'cell-count-1');
        assert.deepEqual(out, [
            { value: 't1', label: 'Table 1', disabled: false, title: '' },
            { value: 't2', label: 'Table 2', disabled: true, title: 'Uses Table 2, which depends on this plot' },
            { value: 'g2', label: 'Grouping 2', disabled: true, title: 'Uses Grouping 2, which depends on this plot' }
        ]);
    } finally {
        R.setReferenceHost({ panel: () => null, ids: () => [] });
    }
});

test('levels of a column whose categories are numbers or booleans: the ids are the server\'s, and the regions follow the codes', async () => {
    const fs = await import('node:fs');
    const vectors = JSON.parse(fs.readFileSync(new URL('../data/level_id_vectors.json', import.meta.url), 'utf8')).categories
        .filter((v) => v.only !== 'python' && ['bool', 'float', 'string'].includes(v.kind) && typeof v.value !== 'string' || v.kind === 'string');
    // the obs route's category_ranks labels are the categories as JSON values (core/categories.py labels_of_ranks)
    const values = vectors.map((v) => v.value);
    const got = S.categoryChoices([...values, null]);
    assert.deepEqual(got.ids, vectors.map((v) => v.id), 'each id is the producer\'s canonical id (plan 1.6)');
    assert.equal(got.ids.length, values.length, 'a null category is no choice');
    // a column of categories [3, 0.5, true]: codes per cell, a set of the first and last category
    const cats = [3, 0.5, true];
    const { ids } = S.categoryChoices(cats);
    assert.deepEqual(ids, ['c:3', 'c:0.5', 'c:true']);
    const serverIds = ['c:3', 'c:0.5', 'c:true'];         // core/cell_groups.py canonical_label of int 3, 0.5, True
    const codes = Array.from({ length: 300 }, (_, i) => (i * 7) % 4 - 1);   // -1 is a missing value
    const member = [ids[0], ids[2]];
    const cells = codes.map((c, i) => Uint8Array.of(c >= 0 && member.includes(serverIds[c]) ? 1 : 0, i % 3 === 0 ? 1 : 0));
    const config = { version: 1, mode: 'venn', sets: [{ source: { type: 'obs', key: 'k' }, member: { levels: member } }, setsOf(1)[0]] };
    const plot = S.setPlotModel(config, tableOf(config, setsGrid(cells, 2)), { names: ['a', 'b'] });
    assert.equal(plot.sets[0].size, codes.filter((c) => c === 0 || c === 2).length);
    const brute = bruteRegions(cells, 2);
    assert.deepEqual(plot.regions.map((r) => r.count), [1, 2, 3].map((code) => brute.get(code) || 0));
});

test('levels of a column: the ids the route sends are used as they are, so a float32 or a 2**53+1 category keeps its level', () => {
    // JSON gives JavaScript 0.10000000149011612 for a float32 0.1 and 9007199254740992 for 2**53+1: no id made from them is the engine's
    const labels = [0.10000000149011612, 9007199254740992, 'x', null];
    const serverIds = ['c:0.1', 'c:9007199254740993', 'c:x', '@na'];
    const got = S.categoryChoices(labels, serverIds);
    assert.deepEqual(got.ids, ['c:0.1', 'c:9007199254740993', 'c:x'], 'the server\'s ids; a missing category is no choice');
    assert.deepEqual(got.labels, ['0.1', '9007199254740993', 'x'], 'the label is the id\'s text');
    // without ids (an old server) the id is made from the value, as before
    assert.deepEqual(S.categoryChoices([3, 'x']).ids, ['c:3', 'c:x']);
});

// --- where a group set stands (SHR-38, UX 2.8) -----------------------------------------------------------------------

/** A grouping's groups by key with their default labels, as group-sources.js `labelsOf` gives them. */
const labelled = (entries) => ({ byKey: new Map(entries.map(([key, labels]) => [JSON.stringify(key), labels])), separator: ' | ' });

function statesCtx(byGrouping, { gone = [] } = {}) {
    const seen = new Map();
    return {
        exists: (id) => !gone.includes(id),
        labelledOf: (g) => byGrouping[g] || null,
        seenOf: (g) => { if (!seen.has(g)) seen.set(g, new Map()); return seen.get(g); },
        titleOf: (g) => ({ g1: 'Grouping 1', g2: 'Grouping 2' }[g] || g)
    };
}

const groupSet = (key, was, extra = {}) => ({ source: { type: GROUP, key: extra.grouping || 'g1' }, member: { group: key, groupWas: was, ...(extra.follow ? { follow: true } : {}) } });

test('a group set whose labels moved says so once, with Keep and Choose another; Keep makes it follow, silently', () => {
    const sets = [groupSet(['bin:1'], ['Cd3e 0.5 to 1.75'])];
    const ctx = statesCtx({ g1: labelled([[['bin:1'], ['Cd3e 0.62 to 1.9']]]) });
    const first = S.setStates(sets, ctx);
    assert.equal(first.rows[0].state, 'changed');
    assert.equal(first.rows[0].note.tag, 'Group changed');
    assert.equal(first.rows[0].note.text, "This group has changed: was 'Cd3e 0.5 to 1.75', now 'Cd3e 0.62 to 1.9'.");
    assert.deepEqual(first.rows[0].note.actions.map((a) => a.label), ['Keep', 'Choose another']);
    assert.equal(first.summary, null, 'one change has no summary line');
    // Keep: the new labels, following
    const kept = { ...sets[0], member: G.keepGroup(sets[0].member, ctx.labelledOf('g1')) };
    assert.deepEqual(kept.member, { group: ['bin:1'], groupWas: ['Cd3e 0.62 to 1.9'], follow: true });
    const after = S.setStates([kept], ctx);
    assert.deepEqual(after.rows[0], { state: 'ok', note: null });
    // a later change of a following set: no notice, and the reference to store with no history step
    const moved = statesCtx({ g1: labelled([[['bin:1'], ['Cd3e 0.7 to 2']]]) });
    const later = S.setStates([kept], moved);
    assert.equal(later.rows[0].state, 'ok');
    assert.equal(later.rows[0].note, null);
    assert.deepEqual(later.rows[0].update, { group: ['bin:1'], groupWas: ['Cd3e 0.7 to 2'], follow: true });
});

test('several group sets changed at once are one line, Keep all and Review; a key no longer a group; a deleted panel', () => {
    const sets = [groupSet(['bin:0'], ['x < 0.5']), groupSet(['bin:1'], ['x 0.5 to 1']), groupSet(['bin:2'], ['x ≥ 1']),
        { source: { type: 'table', key: 't9' } }];
    const ctx = statesCtx({ g1: labelled([[['bin:0'], ['x < 0.6']], [['bin:1'], ['x 0.6 to 1.1']]]) }, { gone: ['t9'] });
    const out = S.setStates(sets, ctx);
    assert.deepEqual(out.rows.map((r) => r.state), ['changed', 'changed', 'gone', 'deleted']);
    assert.deepEqual(out.summary && { count: out.summary.count, text: out.summary.text, actions: out.summary.actions.map((a) => a.label) },
        { count: 2, text: '2 groups have changed after the subset changed.', actions: ['Keep all', 'Review'] });
    assert.equal(out.rows[2].note.text, "'x ≥ 1' is no longer a group of 'Grouping 1'.");
    assert.deepEqual(out.rows[2].note.actions.map((a) => a.label), ['Choose another']);
});

test('a group whose grouping has no groups here yet is ok until it has; toggling back clears the change silently', () => {
    const sets = [groupSet(['bin:1'], ['x 0.5 to 1'])];
    assert.deepEqual(S.setStates(sets, statesCtx({})).rows[0], { state: 'ok', note: null });
    const ctx = statesCtx({ g1: labelled([[['bin:1'], ['x 0.6 to 1.1']]]) });
    assert.equal(S.setStates(sets, ctx).rows[0].note.text !== null, true);
    const back = { ...ctx, labelledOf: () => labelled([[['bin:1'], ['x 0.5 to 1']]]) };
    assert.deepEqual(S.setStates(sets, back).rows[0], { state: 'ok', note: null });
    // the same change again, in the same session: the tag only, not the sentence (N10)
    const again = S.setStates(sets, ctx).rows[0];
    assert.equal(again.note.tag, 'Group changed');
    assert.equal(again.note.text, null);
});

// --- scaling (CNT-12): no work that grows past one pass over the grid ------------------------------------------------

test('scaling: the model of a 16-set grid is one pass, at most 15x a 10x smaller grid', () => {
    const time = (k, reps) => {
        const cells = randomCells(4000, k, 7, 0.15);
        const config = { version: 1, mode: 'upset', sets: setsOf(k) };
        const grid = setsGrid(cells, k);
        const names = setsOf(k).map((_, s) => `s${s}`);
        const table = tableOf(config, grid);
        S.setPlotModel(config, table, { names });
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < reps; i++) S.setPlotModel(config, table, { names });
        return Number(process.hrtime.bigint() - t0) / reps;
    };
    // 2^16 grid cells against 2^13 (8x) and 2^12.7 ~ 10x: the model is linear in the grid cells
    const small = Math.min(time(13, 20), time(13, 20));
    const big = Math.min(time(16, 5), time(16, 5));
    assert.ok(big <= 15 * small, `16 sets ${big} ns vs 13 sets ${small} ns`);
});
