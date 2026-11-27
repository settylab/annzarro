/**
 * A consumer that names one group of a grouping (static/js/utils/group-reference.js, SHR-38, UX 2.8): ok, changed and
 * gone from a stored key and `groupWas`; what is not a change; Keep and following; said once per change; one line for
 * several changes; the sentences.
 *
 * Run:  node --test annzarro/tests/js/group-reference.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../../../static/js/utils/group-reference.js');
const G = await import('../../../static/js/utils/cell-grouping.js');

const gene = { type: 'layer', key: 'logged', column: 'Cd3e' };
const binned = (extra = {}) => G.normalizeGrouping({
    version: 1, partitionings: [{ source: gene, binning: { method: 'equal_count', bins: 3 } }], ...extra
}).recipe;
/** A reply whose three bins of Cd3e have these edges. */
const bins = (edges) => ({
    partitionings: [{ levels: ['bin:0', 'bin:1', 'bin:2'], edges, bins_made: 3 }],
    groups: [{ key: ['bin:0'], n: 5 }, { key: ['bin:1'], n: 5 }, { key: ['bin:2'], n: 5 }]
});
const before = bins([0, 0.5, 1.75, 4]);
const after = bins([0, 0.62, 1.9, 4]);
const later = bins([0, 0.7, 2.2, 4]);
const labelled = (reply, recipe = binned()) => R.labelledGroups(recipe, reply);

const middle = { group: ['bin:1'], groupWas: ['Cd3e 0.5 to 1.75'] };

test('a stored key whose default labels are those stored is ok, and says nothing', () => {
    const result = R.resolveGroup(middle, labelled(before), new Map());
    assert.equal(result.state, 'ok');
    assert.equal(result.say, false);
    assert.equal(result.update, undefined);
    assert.equal(R.describeGroupReference(result, 'Grouping 1'), null);
});

test('a stored key whose default labels differ is changed: was and now, Keep and Choose another', () => {
    const result = R.resolveGroup(middle, labelled(after), new Map());
    assert.equal(result.state, 'changed');
    assert.equal(result.was, 'Cd3e 0.5 to 1.75');
    assert.equal(result.now, 'Cd3e 0.62 to 1.9');
    assert.equal(result.say, true);
    assert.deepEqual(R.describeGroupReference(result, 'Grouping 1'), {
        tag: 'Group changed',
        text: "This group has changed: was 'Cd3e 0.5 to 1.75', now 'Cd3e 0.62 to 1.9'.",
        actions: [{ id: 'keep', label: 'Keep' }, { id: 'chooseAnother', label: 'Choose another' }]
    });
});

test('a stored key that is no longer a group is gone, with Choose another', () => {
    const top = { group: ['bin:3'], groupWas: ['Cd3e ≥ 1.75'] };
    const result = R.resolveGroup(top, labelled(before), new Map());
    assert.equal(result.state, 'gone');
    assert.equal(result.was, 'Cd3e ≥ 1.75');
    assert.deepEqual(R.describeGroupReference(result, 'Grouping 1'), {
        tag: 'No longer a group',
        text: "'Cd3e ≥ 1.75' is no longer a group of 'Grouping 1'.",
        actions: [{ id: 'chooseAnother', label: 'Choose another' }]
    });
});

test('a rename of a level is not a change', () => {
    const renamed = binned();
    renamed.partitionings[0].labels = { 'bin:1': 'middle' };
    assert.equal(G.groupNames(renamed, before)[1], 'middle');
    assert.equal(R.resolveGroup(middle, labelled(before, renamed), new Map()).state, 'ok');
});

test('a separator change is not a change, and the sentences join the labels by the separator', () => {
    const two = (separator) => G.normalizeGrouping({ version: 1, separator, partitionings: [
        { source: { type: 'obs', key: 'cell_type' } }, { source: { type: 'obs', key: 'condition' } }] }).recipe;
    const reply = { partitionings: [{ levels: ['c:B cell'] }, { levels: ['c:ctrl', 'c:treated'] }],
        groups: [{ key: ['c:B cell', 'c:ctrl'], n: 3 }, { key: ['c:B cell', 'c:treated'], n: 2 }] };
    const ref = { group: ['c:B cell', 'c:ctrl'], groupWas: ['B cell', 'ctrl'] };
    assert.equal(R.resolveGroup(ref, R.labelledGroups(two(' / '), reply), new Map()).state, 'ok');
    const gone = R.resolveGroup({ group: ['c:T cell', 'c:ctrl'], groupWas: ['T cell', 'ctrl'] }, R.labelledGroups(two(' / '), reply), new Map());
    assert.equal(gone.was, 'T cell / ctrl');
});

test('a (2) suffix of two groups with one name is not a change', () => {
    const recipe = G.normalizeGrouping({ version: 1, partitionings: [
        { source: { type: 'obs', key: 'cell_type' }, labels: { 'c:a': 'x', 'c:b': 'x' } }] }).recipe;
    const reply = { partitionings: [{ levels: ['c:a', 'c:b'] }], groups: [{ key: ['c:a'], n: 1 }, { key: ['c:b'], n: 1 }] };
    assert.deepEqual(G.groupNames(recipe, reply), ['x', 'x (2)']);
    assert.equal(R.resolveGroup({ group: ['c:b'], groupWas: ['b'] }, R.labelledGroups(recipe, reply), new Map()).state, 'ok');
});

test('the collected small group is one key whatever the factors, labelled by its threshold', () => {
    const recipe = binned({ small: { threshold: 20, mode: 'collect' } });
    const reply = { ...before, groups: [...before.groups, { key: ['@small'], n: 9 }] };
    const ref = R.referToGroup(R.labelledGroups(recipe, reply), ['@small']);
    assert.deepEqual(ref, { group: ['@small'], groupWas: ['Small groups (under 20 cells)'] });
});

test('picking a group writes a reference without follow; an unknown key gives none', () => {
    assert.deepEqual(R.referToGroup(labelled(before), ['bin:1']), middle);
    assert.equal(R.referToGroup(labelled(before), ['bin:9']), null);
});

test('follow absent reads as false: a change is reported', () => {
    assert.equal(R.resolveGroup({ ...middle }, labelled(after), new Map()).state, 'changed');
    assert.equal(R.resolveGroup({ ...middle, follow: false }, labelled(after), new Map()).state, 'changed');
});

test('Keep stores the new labels and follows; a followed reference updates groupWas with no notice', () => {
    const kept = R.keepGroup(middle, labelled(after));
    assert.deepEqual(kept, { group: ['bin:1'], groupWas: ['Cd3e 0.62 to 1.9'], follow: true });
    assert.deepEqual(middle, { group: ['bin:1'], groupWas: ['Cd3e 0.5 to 1.75'] }, 'the stored reference is not edited');

    const seen = new Map();
    const moved = R.resolveGroup(kept, labelled(later), seen);
    assert.equal(moved.state, 'ok');
    assert.equal(moved.say, false);
    // the new groupWas, for the consumer to store without a history step
    assert.deepEqual(moved.update, { group: ['bin:1'], groupWas: ['Cd3e 0.7 to 2.2'], follow: true });
    assert.equal(R.describeGroupReference(moved, 'Grouping 1'), null);
    // unchanged: nothing to store
    assert.equal(R.resolveGroup(kept, labelled(after), seen).update, undefined);
    // a followed key that is gone is still gone
    assert.equal(R.resolveGroup({ ...kept, group: ['bin:7'] }, labelled(later), seen).state, 'gone');
});

test('said once per change: the sentence stays for the change, clears silently, and a name reported before shows the tag only', () => {
    const seen = new Map();
    const first = R.resolveGroup(middle, labelled(after), seen);
    assert.equal(first.say, true);
    // read again (another paint, another progress frame): the same change, still said
    assert.equal(R.resolveGroup(middle, labelled(after), seen).say, true);
    // toggled back to the stored name: ok, nothing to say
    const back = R.resolveGroup(middle, labelled(before), seen);
    assert.equal(back.state, 'ok');
    assert.equal(back.say, false);
    // and forward again to the name already reported this session: the tag, not the sentence
    const again = R.resolveGroup(middle, labelled(after), seen);
    assert.equal(again.state, 'changed');
    assert.equal(again.say, false);
    assert.deepEqual(R.describeGroupReference(again, 'Grouping 1'), {
        tag: 'Group changed', text: null,
        actions: [{ id: 'keep', label: 'Keep' }, { id: 'chooseAnother', label: 'Choose another' }]
    });
    // a name not reported yet is said
    assert.equal(R.resolveGroup(middle, labelled(later), seen).say, true);
    // another session knows nothing of it
    assert.equal(R.resolveGroup(middle, labelled(after), new Map()).say, true);
});

test('one line for several changes: Keep all and Review; one change, or none to say, makes no line', () => {
    const seen = new Map();
    const refs = [
        { group: ['bin:0'], groupWas: ['Cd3e < 0.5'] },
        { group: ['bin:1'], groupWas: ['Cd3e 0.5 to 1.75'] },
        { group: ['bin:2'], groupWas: ['Cd3e ≥ 1.75'] }
    ];
    const results = refs.map((ref) => R.resolveGroup(ref, labelled(after), seen));
    assert.deepEqual(R.summariseChanges(results), {
        count: 3,
        text: '3 groups have changed after the subset changed.',
        actions: [{ id: 'keepAll', label: 'Keep all' }, { id: 'review', label: 'Review' }]
    });
    assert.equal(R.summariseChanges(results.slice(0, 1)), null);
    assert.equal(R.summariseChanges([R.resolveGroup(refs[1], labelled(before), seen)]), null);
    // already reported: tags only, no line
    const quiet = refs.map((ref) => R.resolveGroup(ref, labelled(before), seen))
        .concat(refs.map((ref) => R.resolveGroup(ref, labelled(after), seen)));
    assert.equal(R.summariseChanges(quiet), null);
});

test('a resolve does no work that grows with the groups: the labelled groups are indexed once', () => {
    const n = 2000;
    const recipe = G.normalizeGrouping({ version: 1, partitionings: [{ source: { type: 'obs', key: 'cell_id' } }] }).recipe;
    const reply = { partitionings: [{ levels: Array.from({ length: n }, (_, i) => `c:${i}`) }],
        groups: Array.from({ length: n }, (_, i) => ({ key: [`c:${i}`], n: 1 })) };
    const index = R.labelledGroups(recipe, reply);
    const seen = new Map();
    const ref = { group: ['c:1999'], groupWas: ['1999'] };
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) R.resolveGroup(ref, index, seen);
    const perCall = (performance.now() - t0) / 10000;
    assert.ok(perCall < 0.05, `a resolve took ${perCall.toFixed(4)} ms at ${n} groups`);
});
