/**
 * A group's own name (operator decision 38): `groupOverrides: [{name, label?, color?}]` keyed by the group's GENERATED name
 * (its level labels joined by the separator); `groupNames` returns the label, `generatedGroupNames` never does. An override
 * that no group matches is kept, listed as inactive, and goes only when dropped.
 *
 * Run:  node --test annzarro/tests/js/group-names.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeGrouping, groupNames, generatedGroupNames } = await import('../../../static/js/utils/cell-grouping.js');
const { groupOverrideState } = await import('../../../static/js/utils/grouping-colours.js');
const colours = await import('../../../static/js/panels/cell-grouping/colours.js');

const reply = {
    n_shown: 100,
    partitionings: [{ levels: ['c:B', 'c:T'], counts: [60, 40], names: { 'c:B': 'B', 'c:T': 'T' } }],
    groups: [{ key: ['c:B'], n: 60 }, { key: ['c:T'], n: 40 }]
};
const recipeWith = (groupOverrides) => normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'ct' } }], groupOverrides }).recipe;
const names = (recipe) => groupNames(recipe, reply, () => undefined);
const generated = (recipe) => generatedGroupNames(recipe, reply, () => undefined);

test('the name function returns the override, and the generated names stay what they were', () => {
    const recipe = recipeWith([{ name: 'B', label: 'B lymphocytes' }]);
    assert.deepEqual(names(recipe), ['B lymphocytes', 'T']);
    assert.deepEqual(generated(recipe), ['B', 'T'], 'what overrides are keyed by does not move with them');
});

test('a colour with no label leaves the name alone', () => {
    assert.deepEqual(names(recipeWith([{ name: 'B', color: '#112233' }])), ['B', 'T']);
});

test('a label equal to another group\'s name is qualified the way level duplicates are', () => {
    const got = names(recipeWith([{ name: 'B', label: 'T' }]));
    assert.equal(got[1], 'T', 'the group that is called that keeps it');
    assert.notEqual(got[0], 'T');
    assert.match(got[0], /^T \(2\)$/);
    const two = names(recipeWith([{ name: 'B', label: 'X' }, { name: 'T', label: 'X' }]));
    assert.deepEqual(two, ['X', 'X (2)']);
});

test('an override applies by generated name: a level renamed moves the name, so the override goes inactive and is kept', () => {
    const recipe = recipeWith([{ name: 'B', label: 'B lymphocytes' }]);
    assert.deepEqual(groupOverrideState(recipe, generated(recipe)).inactive, []);
    const renamed = normalizeGrouping({ partitionings: [{ source: { type: 'obs', key: 'ct' }, labels: { 'c:B': 'B cell' } }],
        groupOverrides: [{ name: 'B', label: 'B lymphocytes' }] }).recipe;
    assert.deepEqual(generated(renamed), ['B cell', 'T']);
    assert.deepEqual(names(renamed), ['B cell', 'T'], 'no group of that generated name: nothing applies');
    const state = groupOverrideState(renamed, generated(renamed));
    assert.deepEqual(state.active, []);
    assert.deepEqual(state.inactive, [{ name: 'B', label: 'B lymphocytes' }], 'kept, not dropped');
    assert.deepEqual(renamed.groupOverrides, [{ name: 'B', label: 'B lymphocytes' }]);
});

test('withGroupLabel keeps the colour, withGroupColor keeps the label, and an empty override goes', () => {
    let list = colours.withGroupLabel({}, 'B', 'Bs');
    assert.deepEqual(list, [{ name: 'B', label: 'Bs' }]);
    list = colours.withGroupColor({ groupOverrides: list }, 'B', '#112233');
    assert.deepEqual(list, [{ name: 'B', label: 'Bs', color: '#112233' }]);
    list = colours.withGroupLabel({ groupOverrides: list }, 'B', 'B again');
    assert.deepEqual(list, [{ name: 'B', label: 'B again', color: '#112233' }], 'the colour stays');
    list = colours.withGroupColor({ groupOverrides: list }, 'B', undefined);
    assert.deepEqual(list, [{ name: 'B', label: 'B again' }]);
    assert.equal(colours.withGroupLabel({ groupOverrides: list }, 'B', ''), undefined, 'an empty label with no colour leaves nothing');
});

test('Drop removes one override, drop all removes the inactive ones only', () => {
    const recipe = { groupOverrides: [{ name: 'B', label: 'Bs' }, { name: 'gone', label: 'x' }, { name: 'gone2', color: '#000000' }] };
    assert.deepEqual(colours.withoutGroupOverride(recipe, 'gone'), [{ name: 'B', label: 'Bs' }, { name: 'gone2', color: '#000000' }]);
    assert.deepEqual(colours.withoutInactiveOverrides(recipe, ['B', 'T']), [{ name: 'B', label: 'Bs' }]);
    assert.equal(colours.withoutGroupOverride({ groupOverrides: [{ name: 'B', label: 'Bs' }] }, 'B'), undefined);
});

// ------------------------------------------------------------------------------------------------- nested groupings

const { groupLevelId } = await import('../../../static/js/utils/level-id.js');

/**
 * An outer grouping whose one factor is the inner grouping above: its levels are the inner groups. As the group store reads
 * the reply, the factor's `names` are what the inner groups are CALLED (a label the user gave shows) and `generatedNames` what
 * they are keyed by.
 */
function outer(innerLabelled) {
    const ids = [groupLevelId(['c:B']), groupLevelId(['c:T'])];
    const reply = {
        n_shown: 100,
        partitionings: [{ levels: ids, counts: [60, 40],
            names: { [ids[0]]: innerLabelled ? 'B lymphocytes' : 'B', [ids[1]]: 'T' }, generatedNames: { [ids[0]]: 'B', [ids[1]]: 'T' } }],
        groups: [{ key: [ids[0]], n: 60 }, { key: [ids[1]], n: 40 }]
    };
    const make = (groupOverrides) => normalizeGrouping({ partitionings: [{ source: { type: 'cell-group', key: 'inner' } }], groupOverrides }).recipe;
    return { reply, make };
}

test('renaming an inner group is display only: the outer grouping keeps its override active and shows the inner label', () => {
    const { reply, make } = outer(true);
    const recipe = make([{ name: 'B', color: '#112233' }]);
    assert.deepEqual(generatedGroupNames(recipe, reply, () => undefined), ['B', 'T'], 'keyed by the inner GENERATED names');
    assert.deepEqual(groupNames(recipe, reply, () => undefined), ['B lymphocytes', 'T'], 'displayed with the inner label');
    const state = groupOverrideState(recipe, generatedGroupNames(recipe, reply, () => undefined));
    assert.deepEqual(state.active, [{ name: 'B', color: '#112233' }], 'the override stays active');
    assert.deepEqual(state.inactive, []);
});

test('an outer label wins over the inner label, and a reply with no generated names reads as before', () => {
    const { reply, make } = outer(true);
    assert.deepEqual(groupNames(make([{ name: 'B', label: 'Bs' }]), reply, () => undefined), ['Bs', 'T']);
    const plain = { ...reply, partitionings: [{ ...reply.partitionings[0], generatedNames: undefined }] };
    assert.deepEqual(generatedGroupNames(make(undefined), plain, () => undefined), ['B lymphocytes', 'T'], 'no generated names: the names stand');
});

test('Reset group names removes every label, keeps the colours, and drops entries left with nothing', () => {
    const recipe = { groupOverrides: [{ name: 'B', label: 'Bs', color: '#112233' }, { name: 'T', label: 'Ts' }, { name: 'N', color: '#000000' }] };
    assert.equal(colours.groupLabelCount(recipe), 2);
    assert.deepEqual(colours.withoutGroupLabels(recipe), [{ name: 'B', color: '#112233' }, { name: 'N', color: '#000000' }]);
    assert.equal(colours.withoutGroupLabels({ groupOverrides: [{ name: 'T', label: 'Ts' }] }), undefined);
    assert.equal(colours.groupLabelCount({}), 0);
    assert.equal(colours.withoutGroupLabels({}), undefined);
});

test('Reset names of a factor removes its level labels and nothing else', () => {
    const p = { type: 'categorical', key: 'cell_type', labels: { a: 'A1' }, colors: { palette: 'x' } };
    const next = colours.withoutLevelLabels(p);
    assert.equal('labels' in next, false);
    assert.deepEqual(next.colors, { palette: 'x' });
    assert.equal(p.labels.a, 'A1', 'the factor is not changed in place');
});
