/**
 * A link stored before 0.8.1 on a grouping of a float32 column names its levels by the float64 digits
 * (`c:0.10000000149011612`); the engine now ids them `c:0.1` and says so in the reply's `legacy_ids`. The colours, the
 * renames and the group settings of such a link open on the same levels and groups.
 *
 * Run:  node --test annzarro/tests/js/legacy-level-ids.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGrouping, groupNames, generatedGroupNames, upgradeRecipe, renameOf } from '../../../static/js/utils/cell-grouping.js';
import { factorColours, groupingColours } from '../../../static/js/utils/grouping-colours.js';

const OLD = ['c:0.10000000149011612', 'c:0.20000000298023224', 'c:0.30000001192092896'];
const NEW = ['c:0.1', 'c:0.2', 'c:0.3'];
const legacy = Object.fromEntries(OLD.map((o, i) => [o, NEW[i]]));
const RED = '#ff0000';
const BLUE = '#0000ff';

/** The link as 0.8.0 stored it: a level colour, a rename, a colour and a label for the group of the old name. */
const stored = (levels) => normalizeGrouping({
    partitionings: [{ source: { type: 'obs', key: 'f' }, ...(levels ? { levels } : {}),
        labels: { [OLD[1]]: 'second' }, colors: { overrides: { [OLD[0]]: RED } } }],
    groupOverrides: [{ name: '0.30000001192092896', color: BLUE, label: 'third' }]
}).recipe;

const reply = (ids, withLegacy) => ({
    partitionings: [{ kind: 'category', levels: ids, ...(withLegacy ? { legacy_ids: legacy } : {}) }],
    groups: ids.map((id) => ({ key: [id], n: 10 }))
});

test('the engine says what the ids were: an old link opens with its level colour, rename and group settings', () => {
    const recipe = stored();
    const r = reply(NEW, true);
    assert.equal(factorColours(recipe.partitionings[0], r.partitionings[0], NEW).get('c:0.1'), RED);
    assert.deepEqual(generatedGroupNames(recipe, r, undefined), ['0.1', 'second', '0.3']);
    // the group settings were keyed by the name the old ids made: they now apply to the same group
    assert.deepEqual(groupNames(recipe, r), ['0.1', 'second', 'third']);
    const names = generatedGroupNames(upgradeRecipe(recipe, r), r);
    const colours = groupingColours(upgradeRecipe(recipe, r), r, names);
    assert.equal(colours.groups[2], BLUE);
    assert.equal(colours.factors[0].get('c:0.1'), RED);
    assert.equal(renameOf(recipe.partitionings[0].labels, 'c:0.2', r.partitionings[0]), 'second');
});

test('the same link read as the old engine answered (old ids, no legacy_ids) is unchanged', () => {
    const recipe = stored();
    const r = reply(OLD, false);
    assert.equal(upgradeRecipe(recipe, r), recipe, 'nothing to move');
    assert.deepEqual(groupNames(recipe, r), ['0.10000000149011612', 'second', 'third']);
    assert.equal(factorColours(recipe.partitionings[0], r.partitionings[0], OLD).get(OLD[0]), RED);
});

test('a hidden level (kept levels stored by the old ids) is echoed as stored, so what is keyed by it needs no move', () => {
    const kept = [OLD[0], OLD[2]];
    const recipe = stored(kept);
    const r = reply(kept.concat(['@other']), true);       // the engine's slots are the kept ids as stored
    const up = upgradeRecipe(recipe, r);          // only the level that is not kept (and not listed) is moved
    assert.deepEqual(up.partitionings[0].colors.overrides, { [OLD[0]]: RED }, 'a kept level stays under the id it was stored by');
    assert.equal(factorColours(recipe.partitionings[0], r.partitionings[0], kept).get(OLD[0]), RED);
    assert.deepEqual(groupNames(recipe, r).slice(0, 2), ['0.10000000149011612', '0.30000001192092896'].map((n, i) => (i === 1 ? 'third' : n)));
});
