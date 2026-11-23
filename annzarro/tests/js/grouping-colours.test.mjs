/**
 * The one place a grouping's and a factor's colours are decided (utils/grouping-colours.js, operator decision 33):
 * the dataset's colours by default, a sequential map for bins, a named palette, per-level and per-group overrides,
 * "colour groups by factor k", and the recipe's `colors` field (stored only off its defaults, never in the hash).
 *
 * Run:  node --test annzarro/tests/js/grouping-colours.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// imported per test, so the recipe tests below run (and show what holds today) before the module exists
const resolver = () => import('../../../static/js/utils/grouping-colours.js');
const { normalizeGrouping, normalizePartitioning, groupingHasher } = await import('../../../static/js/utils/cell-grouping.js');
const { generateDiscreteColors, groupColours } = await import('../../../static/js/panels/plot-utilities/colors.js');

const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const g = (...key) => ({ key, n: 20 });
const keyId = (key) => JSON.stringify(key);

// --- one factor ---------------------------------------------------------------------------------------------------------

test('a categorical factor takes the dataset colours the reply carries', async () => {
    const { factorColours } = await resolver();
    const info = { levels: ['c:a', 'c:b'], colors: { 'c:a': '#111111', 'c:b': '#222222' } };
    const got = factorColours(obs('x'), info, info.levels);
    assert.equal(got.get('c:a'), '#111111');
    assert.equal(got.get('c:b'), '#222222');
});

test('without dataset colours, or when they are not all valid, the default palette in level order', async () => {
    const { factorColours } = await resolver();
    const levels = ['c:a', 'c:b', 'c:c'];
    const first = groupColours(3);
    for (const info of [{ levels }, { levels, colors: { 'c:a': '#111111', 'c:b': 'not a colour!', 'c:c': '#333333' } }]) {
        const got = factorColours(obs('x'), info, levels);
        assert.deepEqual(levels.map((id) => got.get(id)), first);
    }
});

test('a boolean column takes its dataset colours too', async () => {
    const { factorColours } = await resolver();
    const info = { levels: ['c:true', 'c:false'], boolean: true, colors: { 'c:true': '#aa0000', 'c:false': '#0000aa' } };
    assert.equal(factorColours(obs('flag'), info, info.levels).get('c:false'), '#0000aa');
});

test('a binned factor is sequential over its bins, in order; the reserved levels have no colour', async () => {
    const { factorColours } = await resolver();
    const levels = ['bin:0', 'bin:1', 'bin:2', 'bin:3', '@na'];
    const got = factorColours(obs('x', { binning: { method: 'equal_count' } }), { levels, colors: { 'bin:0': '#ff0000' } }, levels);
    assert.deepEqual(levels.slice(0, 4).map((id) => got.get(id)), generateDiscreteColors(4, 'viridis'));
    assert.equal(got.has('@na'), false);
});

test('reserved levels (other, small, missing, zero) have no colour and take no palette slot', async () => {
    const { factorColours } = await resolver();
    const levels = ['c:a', '@other', 'c:b', '@small', '@na', '@zero'];
    const got = factorColours(obs('x'), { levels }, levels);
    for (const id of ['@other', '@small', '@na', '@zero']) assert.equal(got.has(id), false, id);
    assert.deepEqual([got.get('c:a'), got.get('c:b')], groupColours(2));
});

test('a named palette replaces the dataset colours; "default" is the app palette whatever the dataset says', async () => {
    const { factorColours } = await resolver();
    const info = { levels: ['c:a', 'c:b'], colors: { 'c:a': '#111111', 'c:b': '#222222' } };
    const named = factorColours(obs('x', { colors: { palette: 'Set1' } }), info, info.levels);
    assert.deepEqual(info.levels.map((id) => named.get(id)), groupColours(2, 'Set1'));
    const plain = factorColours(obs('x', { colors: { palette: 'default' } }), info, info.levels);
    assert.deepEqual(info.levels.map((id) => plain.get(id)), groupColours(2));
    const bins = ['bin:0', 'bin:1', 'bin:2'];
    const seq = factorColours(obs('x', { binning: {}, colors: { palette: 'plasma' } }), { levels: bins }, bins);
    assert.deepEqual(bins.map((id) => seq.get(id)), generateDiscreteColors(3, 'plasma'));
});

test('a level override wins over the palette and the dataset; an invalid override is ignored', async () => {
    const { factorColours } = await resolver();
    const info = { levels: ['c:a', 'c:b'], colors: { 'c:a': '#111111', 'c:b': '#222222' } };
    const got = factorColours(obs('x', { colors: { palette: 'Set1', overrides: { 'c:a': '#abcdef', 'c:b': 'nonsense!' } } }), info, info.levels);
    assert.equal(got.get('c:a'), '#abcdef');
    assert.equal(got.get('c:b'), groupColours(2, 'Set1')[1]);
});

// --- a grouping ---------------------------------------------------------------------------------------------------------

const two = () => ({
    recipe: { version: 1, partitionings: [obs('cell_type'), obs('condition')] },
    reply: {
        partitionings: [
            { levels: ['c:B', 'c:T'], colors: { 'c:B': '#b00000', 'c:T': '#00b000' } },
            { levels: ['c:ctl', 'c:trt'], colors: { 'c:ctl': '#0000b0', 'c:trt': '#b0b000' } }
        ],
        groups: [g('c:B', 'c:ctl'), g('c:B', 'c:trt'), g('c:T', 'c:ctl'), g('c:T', 'c:trt')]
    }
});

test('a grouping of several factors has its own palette in group order by default', async () => {
    const { groupingColours } = await resolver();
    const { recipe, reply } = two();
    assert.deepEqual(groupingColours(recipe, reply).groups, groupColours(4));
});

test('a grouping of one factor takes that factor\'s colours of each group', async () => {
    const { groupingColours } = await resolver();
    const { reply } = two();
    const one = { partitionings: [reply.partitionings[0]], groups: [g('c:B'), g('c:T')] };
    const got = groupingColours({ version: 1, partitionings: [obs('cell_type')] }, one);
    assert.deepEqual(got.groups, ['#b00000', '#00b000']);
    assert.equal(got.factors.length, 1);
    assert.equal(got.factors[0].get('c:T'), '#00b000');
});

test('an old recipe without colors gives today\'s colours: the column\'s own, else the app palette in group order', async () => {
    const { groupingColours } = await resolver();
    const one = { partitionings: [{ levels: ['c:a', 'c:b'] }], groups: [g('c:a'), g('c:b')] };
    assert.deepEqual(groupingColours({ version: 1, partitionings: [obs('x')] }, one).groups, groupColours(2));
});

test('"colour groups by factor k" gives each group the colour of its level of factor k', async () => {
    const { groupingColours } = await resolver();
    const { recipe, reply } = two();
    const by1 = groupingColours({ ...recipe, colors: { by: 1 } }, reply);
    assert.deepEqual(by1.groups, ['#0000b0', '#b0b000', '#0000b0', '#b0b000']);
    const by0 = groupingColours({ ...recipe, colors: { by: 0 } }, reply);
    assert.deepEqual(by0.groups, ['#b00000', '#b00000', '#00b000', '#00b000']);
    assert.deepEqual(groupingColours({ ...recipe, colors: { by: 7 } }, reply).groups, groupColours(4), 'a factor that is not there: own palette');
});

test('a grouping palette names the colours of the groups; group overrides win over everything', async () => {
    const { groupingColours } = await resolver();
    const { recipe, reply } = two();
    const named = groupingColours({ ...recipe, colors: { palette: 'Set2' } }, reply);
    assert.deepEqual(named.groups, groupColours(4, 'Set2'));
    const over = groupingColours({ ...recipe, colors: { by: 1, overrides: { [keyId(['c:B', 'c:trt'])]: '#123456', [keyId(['c:T', 'c:ctl'])]: 'bad!' } } }, reply);
    assert.deepEqual(over.groups, ['#0000b0', '#123456', '#0000b0', '#b0b000']);
});

test('the collected small group has no colour, past 64 groups the colours repeat by colour group', async () => {
    const { groupingColours } = await resolver();
    const { recipe, reply } = two();
    const small = { ...reply, groups: [...reply.groups, { key: ['@small'], n: 3 }] };
    assert.equal(groupingColours(recipe, small).groups[4], null);
    const many = Array.from({ length: 130 }, (_, i) => g(`c:g${i}`, 'c:x'));
    const got = groupingColours(recipe, { partitionings: [{ levels: [] }, { levels: ['c:x'] }], groups: many }).groups;
    assert.equal(got.length, 130);
    assert.equal(got[64], got[0]);
    assert.equal(got[129], got[1]);
});

// --- the recipe field ---------------------------------------------------------------------------------------------------

test('colors is kept when set, dropped when invalid or at its defaults, so a default recipe stores nothing', () => {
    const raw = { version: 1, partitionings: [obs('x', { colors: { palette: 'Set1', overrides: { 'c:a': '#abcdef', 'c:b': 'bad!' } } })],
        colors: { by: 0, palette: 'tab10', overrides: { '["c:a"]': '#123456' } } };
    const { recipe } = normalizeGrouping(raw);
    assert.deepEqual(recipe.partitionings[0].colors, { palette: 'Set1', overrides: { 'c:a': '#abcdef' } });
    assert.deepEqual(recipe.colors, { by: 0, palette: 'tab10', overrides: { '["c:a"]': '#123456' } });
    const bare = normalizeGrouping({ version: 1, partitionings: [obs('x', { colors: {} })], colors: { by: 'own', palette: '', overrides: {} } }).recipe;
    assert.equal('colors' in bare, false);
    assert.equal('colors' in bare.partitionings[0], false);
    assert.equal(normalizePartitioning(obs('x', { colors: { overrides: { 'c:a': 'bad!' } } })).partitioning.colors, undefined);
    assert.equal(normalizeGrouping({ version: 1, partitionings: [obs('x')], colors: { by: -1 } }).recipe.colors, undefined);
});

test('a colour change never changes the hash a result is cached under', () => {
    const plain = normalizeGrouping({ version: 1, partitionings: [obs('x'), obs('y')] }).recipe;
    const coloured = normalizeGrouping({ version: 1, partitionings: [obs('x', { colors: { palette: 'Set1' } }), obs('y')],
        colors: { by: 1, overrides: { '["c:a","c:b"]': '#123456' } } }).recipe;
    assert.equal(groupingHasher(coloured)(coloured), groupingHasher(plain)(plain));
});

// --- the Count Plot's own level palette (WP-6a) --------------------------------------------------------------------------

test("a count plot's level palette replaces its split's colours; without one the split keeps the factor's", async () => {
    const { tableLevelColour } = await resolver();
    const info = { levels: ['c:a', 'c:b'], colors: { 'c:a': '#111111', 'c:b': '#222222' } };
    const split = obs('x', { colors: { overrides: { 'c:b': '#abcdef' } } });
    const table = () => ({ axes: [{ input: 'split', levels: info.levels, info }] });
    const plain = table();
    assert.deepEqual([0, 1].map((i) => tableLevelColour({ split }, plain, 0, i, 'grey')), ['#111111', '#abcdef']);
    const config = { split, color: { palette: 'Dark2' } };
    const dark = generateDiscreteColors(2, 'Dark2');
    assert.deepEqual([0, 1].map((i) => tableLevelColour(config, plain, 0, i, 'grey')), dark, 'same axis, palette changed: not the cached colours');
    assert.deepEqual([0, 1].map((i) => tableLevelColour({ split, color: {} }, plain, 0, i, 'grey')), ['#111111', '#abcdef']);
});
