/**
 * The grouping's recipe model (utils/cell-grouping.js): schema, normaliser, hash, names, colours, request (G6).
 *
 * Run:  node --test annzarro/tests/js/cell-grouping-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expected } from './fixtures/grouping.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, '..', 'data', 'golden');
const golden = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${name}.json`), 'utf8'));

const G = await import('../../../static/js/utils/cell-grouping.js');
const { encodeViewPayload } = await import('../../../static/js/utils/deeplink.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const reply = (name) => ({ partitionings: expected.grouping[name].partitionings, groups: expected.grouping[name].groups });
const recipeOf = (name) => G.normalizeGrouping({ version: 1, ...expected.grouping[name].recipe }).recipe;

// --- the golden configs (R1): read unchanged ------------------------------------------------------------------------

test('a grouping golden config is read unchanged: nothing added, nothing dropped, nothing reordered', () => {
    for (const name of ['cell_grouping_1', 'cell_grouping_3', 'cell_grouping_6_named40']) {
        const raw = golden(name);
        const { recipe, problems } = G.normalizeGrouping(raw);
        assert.deepEqual(problems, [], name);
        assert.equal(JSON.stringify(recipe), JSON.stringify(raw), name);
    }
});

test('a partitioning golden config of every kind of source is read unchanged', () => {
    const names = fs.readdirSync(GOLDEN).filter((f) => f.startsWith('partitioning_')).map((f) => f.replace('.json', ''));
    assert.ok(names.length >= 9);
    for (const name of names) {
        const raw = golden(name);
        const { partitioning, problems } = G.normalizePartitioning(raw);
        assert.deepEqual(problems, [], name);
        assert.equal(JSON.stringify(partitioning), JSON.stringify(raw), name);
    }
});

test('the golden configs of the other schemas use only ids and field names the plan froze', () => {
    const STAT = ['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count'];
    const MEASURE_STAT = ['mean', 'sum', 'pct_above', 'sd', 'zscore'];
    const AGG = ['mean_of_means', 'sum_of_means', 'mean_of_zscores', 'mean_of_pct_expressing', 'score_mean', 'score_pct_above'];
    const SCALING = ['none', 'var', 'group', 'z_groups', 'z_pooled'];
    const MODES = ['bar', 'histogram', 'hist2d', 'density', 'density2d', 'pie', 'heatmap', 'venn', 'upset'];
    for (const name of ['cell_gene_1', 'cell_gene_6']) {
        const c = golden(name);
        assert.equal(c.version, 1);
        assert.ok(['dots', 'heatmap'].includes(c.mode));
        assert.ok(STAT.includes(c.color.stat) && STAT.includes(c.size.stat));
        if (c.scale) assert.ok(SCALING.includes(c.scale));
        for (const s of c.sections) {
            assert.ok(['genes', 'set'].includes(s.rows));
            for (const r of [s.color, s.size].filter(Boolean)) assert.ok(AGG.includes(r.agg), r.agg);
        }
        assert.ok(!JSON.stringify(c).includes('colour'), 'the field is color');
    }
    assert.equal(golden('cell_gene_6').sections.length, 6);
    for (const name of ['cell_count_bar_split_measure', 'cell_count_upset_8_tables']) {
        const c = golden(name);
        assert.equal(c.version, 1);
        assert.ok(MODES.includes(c.mode));
    }
    assert.ok(MEASURE_STAT.includes(golden('cell_count_bar_split_measure').measure.stat));
    assert.equal(golden('cell_count_upset_8_tables').sets.length, 8);
    const ref = golden('group_reference');
    assert.deepEqual(Object.keys(ref), ['group', 'groupWas', 'follow']);
    assert.equal(golden('group_reference_small').follow, undefined, 'follow is written only when true');
    assert.deepEqual(golden('group_reference_small').group, ['@small']);
    const stat = golden('group_stat');
    assert.equal(stat.type, 'group-stat');
    assert.equal(typeof stat.column, 'string');
    assert.deepEqual(JSON.parse(stat.column), ref.group);
    for (const name of ['set_member_levels', 'set_member_condition', 'set_member_group']) {
        const m = golden(name);
        const forms = [m.levels, m.op, m.group].filter((x) => x !== undefined).length;
        assert.equal(forms, 1, `${name}: exactly one form of member`);
    }
});

test('the link sizes of the golden configs are within 10% of PER-4', async () => {
    const view = (panels) => ({
        v: 1, constants: {},
        layout: {
            v: 1, hierarchy: Object.keys(panels).map((id) => ({ type: 'tile', id, controlsVisible: true })),
            controlState: Object.fromEntries(Object.keys(panels).map((id) => [id, true])), panelConfigs: panels
        }
    });
    const base = (await encodeViewPayload(view({}))).length;
    const added = async (panels) => (await encodeViewPayload(view(panels))).length - base;
    const panel = (id, title, key, name) => ({ id, title, [key]: golden(name) });
    const one = (id, title, key, name) => added({ [id]: panel(id, title, key, name) });
    const cases = [
        ['grouping, 1 partitioning', await one('cell-grouping-1718000000001', 'Grouping 1', 'recipe', 'cell_grouping_1'), 219],
        ['grouping, 3 partitionings', await one('cell-grouping-1718000000001', 'Grouping 1', 'recipe', 'cell_grouping_3'), 353],
        ['grouping, 6 partitionings, 40 named levels', await one('cell-grouping-1718000000001', 'Grouping 1', 'recipe', 'cell_grouping_6_named40'), 635],
        ['cell-gene, 1 section', await one('cell-gene-1718000000001', 'Cell-Gene Plot 1', 'config', 'cell_gene_1'), 387],
        ['cell-gene, 6 sections', await one('cell-gene-1718000000001', 'Cell-Gene Plot 1', 'config', 'cell_gene_6'), 464],
        ['count plot, bar with split and measure', await one('cell-count-1718000000001', 'Count 1', 'config', 'cell_count_bar_split_measure'), 265],
        ['count plot, UpSet of 8 tables', await one('cell-count-1718000000001', 'Count 1', 'config', 'cell_count_upset_8_tables'), 316],
        ['a grouping, a Cell-Gene Plot and a count plot', await added({
            'cell-grouping-1718000000001': panel('cell-grouping-1718000000001', 'Grouping 1', 'recipe', 'cell_grouping_3'),
            'cell-gene-1718000000002': panel('cell-gene-1718000000002', 'Cell-Gene Plot 1', 'config', 'cell_gene_6'),
            'cell-count-1718000000003': panel('cell-count-1718000000003', 'Count 1', 'config', 'cell_count_bar_split_measure')
        }), 832]
    ];
    for (const [what, got, target] of cases) {
        assert.ok(Math.abs(got - target) <= 0.1 * target, `${what}: ${got} characters, PER-4 says ${target}`);
    }
});

// --- the normaliser -------------------------------------------------------------------------------------------------

test('a missing or junk recipe is an empty grouping at version 1, with its problem', () => {
    for (const raw of [undefined, null, 'x', 7, []]) {
        const { recipe, problems } = G.normalizeGrouping(raw);
        assert.deepEqual(recipe, { version: 1, partitionings: [] }, String(raw));
        assert.ok(problems.length > 0 || raw === undefined, String(raw));
    }
});

test('defaults are not written', () => {
    const { recipe } = G.normalizeGrouping({
        version: 1, separator: ' | ', small: { threshold: 10, mode: 'keep' }, detect_above: 0, offered: [], layers: [],
        partitionings: [obs('cell_type', { rest: 'other', levels: undefined, labels: {}, binning: undefined })]
    });
    assert.deepEqual(recipe, { version: 1, partitionings: [obs('cell_type')] });
});

test('what differs from a default is written, in a fixed order', () => {
    const { recipe } = G.normalizeGrouping({
        detect_above: 0.5, layers: ['logged'], offered: ['sd', 'mean'], small: { mode: 'collect', threshold: 25 }, separator: ' / ',
        partitionings: [{ labels: { 'c:a': 'A' }, rest: 'exclude', levels: ['c:a'], source: { column: 'x', key: 'k', type: 'layer', layer: 'L' } }]
    });
    assert.deepEqual(Object.keys(recipe), ['version', 'partitionings', 'separator', 'small', 'offered', 'layers', 'detect_above']);
    assert.deepEqual(Object.keys(recipe.partitionings[0]), ['source', 'levels', 'rest', 'labels']);
    assert.deepEqual(Object.keys(recipe.partitionings[0].source), ['type', 'key', 'column', 'layer']);
    assert.deepEqual(recipe.small, { threshold: 25, mode: 'collect' });
    assert.deepEqual(recipe.offered, ['sd', 'mean']);
});

test('unknown fields are kept, at every level, so an older build loses nothing from a newer link', () => {
    const raw = { version: 1, future: [1], partitionings: [{ source: { type: 'obs', key: 'k', extra: 1 }, tomorrow: true,
        binning: { method: 'equal_count', later: 2 } }] };
    const { recipe, problems } = G.normalizeGrouping(raw);
    assert.deepEqual(problems, []);
    assert.deepEqual(recipe.future, [1]);
    assert.equal(recipe.partitionings[0].tomorrow, true);
    assert.equal(recipe.partitionings[0].source.extra, 1);
    assert.equal(recipe.partitionings[0].binning.later, 2);
});

test('a link from a newer version is kept as it is and reported', () => {
    const { recipe, problems } = G.normalizeGrouping({ version: 2, partitionings: [obs('a')], wonder: 1 });
    assert.equal(recipe.version, 2);
    assert.equal(recipe.wonder, 1);
    assert.ok(problems.some((p) => p.reason === 'newer_version'));
});

test('a link with no version is version 1', () => {
    assert.equal(G.normalizeGrouping({ partitionings: [obs('a')] }).recipe.version, 1);
});

test('more than 8 factors: the first 8 stay, and it is said', () => {
    const { recipe, problems } = G.normalizeGrouping({ version: 1, partitionings: Array.from({ length: 11 }, (_, i) => obs(`c${i}`)) });
    assert.equal(recipe.partitionings.length, 8);
    assert.deepEqual(problems.map((p) => p.reason), ['too_many_partitionings']);
    assert.equal(G.GROUPING_LIMITS.partitionings, 8);
    assert.equal(G.GROUPING_LIMITS.groups, 2000);
});

test('a partitioning with no usable source is dropped and reported; bad levels, labels and statistics are cleaned', () => {
    const { recipe, problems } = G.normalizeGrouping({
        version: 1, offered: ['mean', 'median', 'mean', 7], layers: ['X', 'X', 3],
        partitionings: [{ source: { type: 'obs' } }, 'x', obs('ok', { levels: ['c:a', 3, 'c:a', 'c:b'], labels: { 'c:a': 'A', 'c:b': 4 }, rest: 'bogus' })]
    });
    assert.equal(recipe.partitionings.length, 1);
    assert.deepEqual(recipe.partitionings[0], obs('ok', { levels: ['c:a', 'c:b'], labels: { 'c:a': 'A' } }));
    assert.deepEqual(recipe.offered, ['mean']);
    assert.deepEqual(recipe.layers, ['X']);
    assert.ok(problems.length >= 3);
});

test('normalising is idempotent', () => {
    for (const name of ['cell_grouping_1', 'cell_grouping_3', 'cell_grouping_6_named40']) {
        const once = G.normalizeGrouping(golden(name)).recipe;
        assert.deepEqual(G.normalizeGrouping(once).recipe, once);
    }
});

// --- the hash (PER-3) -----------------------------------------------------------------------------------------------

test('a rename, a separator, a level label change no hash; a change of what is computed does', () => {
    const recipe = recipeOf('cell_type_x_condition');
    const hash = G.groupingHasher(recipe);
    const h = hash(recipe);
    const renamed = { ...recipe, separator: ' / ', partitionings: recipe.partitionings.map((p) => ({ ...p, labels: { 'c:B cell': 'B' } })) };
    assert.equal(hash(renamed), h);
    assert.equal(hash({ ...recipe, partitionings: [recipe.partitionings[0]] }) === h, false);
    assert.notEqual(hash({ ...recipe, small: { threshold: 10, mode: 'collect' } }), h);
    assert.notEqual(hash({ ...recipe, partitionings: [{ ...recipe.partitionings[0], rest: 'exclude' }, recipe.partitionings[1]] }), h);
    assert.notEqual(hash({ ...recipe, partitionings: [{ ...recipe.partitionings[0], levels: ['c:B cell'] }, recipe.partitionings[1]] }), h);
});

test('a default written out is the same hash as the default left out', () => {
    const a = { version: 1, partitionings: [obs('x', { binning: { method: 'equal_count' } })] };
    const b = { version: 1, separator: ' | ', small: { threshold: 10, mode: 'keep' },
        partitionings: [obs('x', { rest: 'other', binning: { method: 'equal_count', bins: 4, outside: 'clamp', edges_from: 'shown', zero_bin: false } })] };
    assert.equal(G.groupingHasher(a)(a), G.groupingHasher(b)(b));
});

test('the order of offered statistics and layers changes nothing a number depends on', () => {
    const a = { version: 1, partitionings: [obs('x')], offered: ['mean', 'sd'], layers: ['X', 'logged'] };
    const b = { ...a, offered: ['sd', 'mean'], layers: ['logged', 'X'] };
    assert.equal(G.groupingHasher(a)(a), G.groupingHasher(a)(b));
});

test('a source made by another panel is hashed by what that panel computes, not by its id', () => {
    const recipe = { version: 1, partitionings: [{ source: { type: 'table', key: 'cell-table-1' } }] };
    const hash = (upstream) => G.groupingHasher(recipe, upstream)(recipe);
    assert.equal(hash(() => 'abc'), hash(() => 'abc'));
    assert.notEqual(hash(() => 'abc'), hash(() => 'abd'));
    const moved = { version: 1, partitionings: [{ source: { type: 'table', key: 'cell-table-2' } }] };
    assert.equal(G.groupingHasher(recipe, () => 'abc')(recipe), G.groupingHasher(moved, () => 'abc')(moved));
});

test('hashing a variant never walks the partitionings again: the work is per applied recipe, not per call', () => {
    let reads = 0;
    const heavy = obs('cell_type', { levels: Array.from({ length: 2000 }, (_, i) => `c:L${i}`) });
    const counted = new Proxy(heavy, { get(target, prop) { if (prop === 'levels') reads++; return target[prop]; } });
    const recipe = { version: 1, partitionings: [counted] };
    const hash = G.groupingHasher(recipe);
    const afterFirst = reads;
    assert.ok(afterFirst >= 1);
    for (let i = 0; i < 500; i++) hash({ ...recipe, small: { threshold: i + 1, mode: 'keep' } });
    assert.equal(reads, afterFirst);
});

// --- names, labels, colours (SHR-9, SHR-11, SHR-12) -----------------------------------------------------------------

test('a group is named by its level labels joined by the separator, in factor order', () => {
    const names = G.groupNames(recipeOf('cell_type_x_condition'), reply('cell_type_x_condition'));
    assert.equal(names.length, 12);
    assert.deepEqual(names.slice(0, 3), ['B cell | ctrl', 'B cell | treated', 'T cell | ctrl']);
});

test('a separator is part of the name and never of the default labels', () => {
    const recipe = { ...recipeOf('cell_type_x_condition'), separator: ' / ' };
    assert.equal(G.groupNames(recipe, reply('cell_type_x_condition'))[0], 'B cell / ctrl');
    assert.deepEqual(G.groupLabels(recipe, reply('cell_type_x_condition'))[0].labels, ['B cell', 'ctrl']);
});

test('a rename changes the name and not the default label a reference compares', () => {
    const recipe = recipeOf('cell_type');
    const renamed = { ...recipe, partitionings: [{ ...recipe.partitionings[0], labels: { 'c:B cell': 'B' } }] };
    assert.equal(G.groupNames(renamed, reply('cell_type'))[0], 'B');
    assert.equal(G.groupLabels(renamed, reply('cell_type'))[0].labels[0], 'B cell');
    assert.equal(G.groupLabels(renamed, reply('cell_type'))[0].key[0], 'c:B cell');
});

test('two groups with one name get (2), (3) in order', () => {
    const recipe = { version: 1, partitionings: [obs('x', { labels: { 'c:a': 'same', 'c:b': 'same', 'c:c': 'same' } })] };
    const r = { partitionings: [{ levels: ['c:a', 'c:b', 'c:c', 'c:d'] }], groups: ['c:a', 'c:b', 'c:c', 'c:d'].map((k) => ({ key: [k], n: 1 })) };
    assert.deepEqual(G.groupNames(recipe, r), ['same', 'same (2)', 'same (3)', 'd']);
});

test('the same label in two factors reads column=label for both', () => {
    const recipe = { version: 1, partitionings: [obs('treated'), obs('responded')] };
    const r = { partitionings: [{ levels: ['c:yes', 'c:no'] }, { levels: ['c:yes', 'c:maybe'] }],
        groups: [{ key: ['c:yes', 'c:yes'], n: 1 }, { key: ['c:no', 'c:maybe'], n: 1 }] };
    assert.deepEqual(G.groupNames(recipe, r), ['treated=yes | responded=yes', 'no | maybe']);
});

test('a boolean factor reads its name and "not" its name', () => {
    const r = { partitionings: [{ levels: ['c:false', 'c:true'], boolean: true }], groups: [{ key: ['c:false'], n: 1 }, { key: ['c:true'], n: 1 }] };
    assert.deepEqual(G.groupNames({ version: 1, partitionings: [obs('is_doublet')] }, r), ['not is_doublet', 'is_doublet']);
    const plain = { partitionings: [{ levels: ['c:false', 'c:true'] }], groups: r.groups };
    assert.deepEqual(G.groupNames({ version: 1, partitionings: [obs('flag')] }, plain), ['false', 'true']);
});

test('bins are named by the source and the range, the zero bin "= 0" (the fixture\'s own reply)', () => {
    const names = G.groupNames(recipeOf('depth_width3_zero_bin'), reply('depth_width3_zero_bin'));
    assert.deepEqual(names, ['depth = 0', '0 < depth < 5.27', 'depth 5.27 to 10.5', 'depth ≥ 10.5']);
});

test('a gene is named by the gene, a score by the title of its panel', () => {
    const names = G.groupNames(recipeOf('cell_type_x_binned_gene'), reply('cell_type_x_binned_gene'));
    assert.ok(names.every((n) => n.includes(' | ')) && names.some((n) => n.includes('GENE005')), names.join(', '));
    assert.equal(G.sourceName({ type: 'layer', key: 'logged', column: 'Cd3e' }), 'Cd3e');
    assert.equal(G.sourceName({ type: 'obs', key: 'pseudotime' }), 'pseudotime');
    assert.equal(G.sourceName({ type: 'obsm', key: 'X_pca', column: '3' }), 'X_pca 3');
    assert.equal(G.sourceName({ type: 'table', key: 't1' }, () => 'Table 1'), 'Table 1');
    assert.equal(G.sourceName({ type: 'table', key: 't1' }), 't1');
});

test('other, no value, table in and out, a collected small group, a group used as a factor', () => {
    const other = G.groupNames(recipeOf('cell_type_keep2_other'), reply('cell_type_keep2_other'));
    assert.deepEqual(other, ['B cell', 'T cell', 'cell_type other']);
    const sample = G.groupNames(recipeOf('sample_other_vs_at_other'), reply('sample_other_vs_at_other'));
    assert.deepEqual(sample, ['other', 'S00', 'sample other'], 'a category called other is not the level other');
    const na = G.groupNames({ version: 1, partitionings: [obs('x')] }, { partitionings: [{ levels: ['c:a', '@na'] }], groups: [{ key: ['c:a'], n: 1 }, { key: ['@na'], n: 1 }] });
    assert.deepEqual(na, ['a', 'x no value']);
    const t = { partitionings: [{ levels: ['@in', '@out'] }], groups: [{ key: ['@in'], n: 1 }, { key: ['@out'], n: 1 }] };
    assert.deepEqual(G.groupNames({ version: 1, partitionings: [{ source: { type: 'table', key: 't1' } }] }, t, () => 'Table 1'), ['in Table 1', 'not in Table 1']);
    const collect = recipeOf('small_collect');
    collect.small = { threshold: 10, mode: 'collect' };
    const names = G.groupNames(collect, reply('small_collect'));
    assert.equal(names[names.length - 1], 'Small groups (under 10 cells)');
    const g = { partitionings: [{ levels: ['g:["c:a"]'], names: { 'g:["c:a"]': 'Group A' } }], groups: [{ key: ['g:["c:a"]'], n: 1 }] };
    assert.deepEqual(G.groupNames({ version: 1, partitionings: [{ source: { type: 'cell-group', key: 'cell-grouping-1' } }] }, g), ['Group A']);
});

test('a grouping of one categorical factor takes that column\'s colours; anything else the palette in group order', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444'];
    const one = { partitionings: [{ levels: ['c:a', 'c:b'], colors: { 'c:a': '#aa0000', 'c:b': '#00aa00' } }], groups: [{ key: ['c:a'], n: 1 }, { key: ['c:b'], n: 1 }] };
    assert.deepEqual(G.groupColours({ version: 1, partitionings: [obs('x')] }, one, palette), ['#aa0000', '#00aa00']);
    const partial = { partitionings: [{ levels: ['c:a', 'c:b'], colors: { 'c:a': '#aa0000' } }], groups: one.groups };
    assert.deepEqual(G.groupColours({ version: 1, partitionings: [obs('x')] }, partial, palette), ['#aa0000', '#222222']);
    const two = { partitionings: [{ levels: ['c:a'], colors: { 'c:a': '#aa0000' } }, { levels: ['c:b', 'c:c'] }], groups: [{ key: ['c:a', 'c:b'], n: 1 }, { key: ['c:a', 'c:c'], n: 1 }] };
    assert.deepEqual(G.groupColours({ version: 1, partitionings: [obs('x'), obs('y')] }, two, palette), ['#111111', '#222222']);
    const binned = { partitionings: [{ levels: ['bin:0', 'bin:1'], colors: { 'bin:0': '#ff0000' } }], groups: [{ key: ['bin:0'], n: 1 }, { key: ['bin:1'], n: 1 }] };
    assert.deepEqual(G.groupColours({ version: 1, partitionings: [obs('x', { binning: { method: 'equal_count' } })] }, binned, palette), ['#111111', '#222222']);
});

test('above 64 groups the colours repeat by the 64 colour groups, as for any large category list', () => {
    const palette = Array.from({ length: 64 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    const groups = Array.from({ length: 130 }, (_, i) => ({ key: [`c:g${i}`], n: 1 }));
    const r = { partitionings: [{ levels: groups.map((g) => g.key[0]) }, ], groups };
    const colours = G.groupColours({ version: 1, partitionings: [obs('x'), obs('y')] }, { ...r, partitionings: [r.partitionings[0], { levels: [] }] }, palette);
    assert.equal(colours.length, 130);
    assert.equal(colours[64], colours[0]);
    assert.equal(colours[129], colours[1]);
});

// --- the request ----------------------------------------------------------------------------------------------------

test('the request carries what the server computes from, and not a label, a separator or a statistic offered', () => {
    const recipe = {
        version: 1, separator: ' / ', offered: ['mean'], layers: ['X'],
        partitionings: [obs('cell_type', { levels: ['c:B cell'], rest: 'exclude', labels: { 'c:B cell': 'B' } }),
            obs('pseudotime', { binning: { method: 'equal_width', bins: 3, range: [0, 6] } })],
        small: { mode: 'collect' }
    };
    const body = G.serverRequest(recipe, { subset: { kind: 'all' } }, ['groups', 'codes']);
    assert.deepEqual(Object.keys(body).sort(), ['partitionings', 'shape', 'small', 'subset', 'want']);
    assert.equal(body.shape, 'grouping');
    assert.deepEqual(body.want, ['groups', 'codes']);
    assert.deepEqual(body.small, { threshold: 10, mode: 'collect' });
    assert.deepEqual(body.partitionings[0], { source: { type: 'obs', key: 'cell_type' }, levels: ['c:B cell'], rest: 'exclude' });
    assert.deepEqual(body.partitionings[1].binning, { method: 'equal_width', bins: 3, range: [0, 6], outside: 'clamp', edges_from: 'shown' });
    assert.deepEqual(body.subset, { kind: 'all' });
    assert.equal(JSON.stringify(body).includes('labels'), false);
});

test('a bitset packs the cells shown least significant bit first, standard base64 with padding (the vector E3 asserts too)', () => {
    const flags = Array.from({ length: 13 }, (_, i) => [0, 2, 3, 7, 8, 12].includes(i));
    assert.deepEqual(G.packBitset(flags), { encoding: 'bitset-base64', length: 13, data: 'jRE=' });
    assert.deepEqual(G.packBitset([]), { encoding: 'bitset-base64', length: 0, data: '' });
    assert.equal(G.packBitset(new Uint8Array(8).fill(1)).data, '/w==');
    assert.equal(G.packBitset([1, 0, 0, 0, 0, 0, 0, 0, 0]).data, 'AQA=');
});

test('a table factor sends its packed bitset; the request is the same whichever labels the recipe holds', () => {
    const recipe = { version: 1, partitionings: [{ source: { type: 'table', key: 'cell-table-1' }, rest: 'exclude' }] };
    const body = G.serverRequest(recipe, { bitsetFor: () => [true, false, true] }, ['groups']);
    assert.deepEqual(body.partitionings[0].bitset, { encoding: 'bitset-base64', length: 3, data: 'BQ==' });
    const a = G.serverRequest({ version: 1, partitionings: [obs('x')] }, {}, ['groups']);
    const b = G.serverRequest({ version: 1, partitionings: [obs('x', { labels: { 'c:q': 'Q' } })], separator: '-' }, {}, ['groups']);
    assert.deepEqual(a, b);
});

test('a score or a grouping used as a factor carries its recipe inline, nested at most 4 deep', () => {
    const score = { type: 'gene-score', key: 'sig-1', column: 'zscore_mean', layer: 'logged' };
    const inner = { version: 1, partitionings: [obs('cell_type')], small: { mode: 'collect' }, separator: ' / ' };
    const ctx = {
        inlineRecipe: (s) => (s.key === 'sig-1' ? { recipe: { genes: ['A'], method: 'zscore_mean' } }
            : s.key === 'g-1' ? { grouping: inner } : null)
    };
    const body = G.serverRequest({ version: 1, partitionings: [{ source: score }, { source: { type: 'cell-group', key: 'g-1' } }] }, ctx, ['groups']);
    assert.deepEqual(body.partitionings[0].source.recipe, { genes: ['A'], method: 'zscore_mean' });
    assert.deepEqual(body.partitionings[1].source.recipe, {
        partitionings: [{ source: { type: 'obs', key: 'cell_type' } }], small: { threshold: 10, mode: 'collect' }
    });
    const loop = { inlineRecipe: () => ({ grouping: { version: 1, partitionings: [{ source: { type: 'cell-group', key: 'again' } }] } }) };
    assert.throws(() => G.serverRequest({ version: 1, partitionings: [{ source: { type: 'cell-group', key: 'again' } }] }, loop, ['groups']), /nest/);
});

test('a grouping always clamps: outside exclude is reported and dropped, a count plot input keeps it', () => {
    const raw = { source: { type: 'obs', key: 'x' }, binning: { method: 'equal_width', range: [0, 5], outside: 'exclude' } };
    const { recipe, problems } = G.normalizeGrouping({ version: 1, partitionings: [raw] });
    assert.equal(recipe.partitionings[0].binning.outside, undefined);
    assert.ok(problems.some((p) => p.reason === 'exclude_in_grouping'));
    assert.equal(G.normalizePartitioning(raw).partitioning.binning.outside, 'exclude');
});
