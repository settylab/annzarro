/**
 * Table filters restore with their logic, and boolean columns filter.
 *
 * Both gave silently wrong results (Fig 4/5 walkthrough):
 *  - var kompot_de_Young_to_Old_is_de "Equals Yes" kept 0 rows: the saved
 *    condition was {type: 'num', value: ['true']} against raw booleans.
 *  - a saved top-level OR came back as AND (only `criteria` was restored).
 *
 * Run:  node --test annzarro/tests/js/search-builder.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { isBooleanColumn, renderBoolean, searchBuilderPreDefined } =
    await import('../../../static/js/utils/search-builder.js');

test('boolean columns are recognised, mixed ones are not', () => {
    assert.equal(isBooleanColumn([true, false, null, true]), true);
    assert.equal(isBooleanColumn([null, undefined]), false);
    assert.equal(isBooleanColumn([true, 1]), false);
    assert.equal(isBooleanColumn(['Yes', 'No']), false);
});

test('booleans read Yes/No to filtering and type detection, 1/0 to sorting', () => {
    for (const type of ['display', 'filter', 'type', undefined]) {
        assert.equal(renderBoolean(true, type), 'Yes');
        assert.equal(renderBoolean(false, type), 'No');
    }
    assert.equal(renderBoolean(true, 'sort'), 1);
    assert.equal(renderBoolean(false, 'sort'), 0);
    assert.match(renderBoolean(null, 'display'), /N\/A/);
    assert.equal(renderBoolean(null, 'filter'), '');
});

test('the top-level logic is restored', () => {
    const saved = { logic: 'OR', criteria: [{ condition: '=', data: 'a', origData: 'obs_a_main', type: 'string', value: ['x'] }] };
    assert.equal(searchBuilderPreDefined(saved).logic, 'OR');
    assert.equal(searchBuilderPreDefined({ criteria: [] }).logic, 'AND');
    assert.deepEqual(searchBuilderPreDefined(undefined), { criteria: [], logic: 'AND' });
});

test('a boolean condition saved as num "true" becomes string "Yes", also nested', () => {
    const key = 'var_kompot_de_Young_to_Old_is_de_main';
    const saved = {
        logic: 'AND',
        criteria: [
            { condition: '=', data: 'kompot_de_Young_to_Old_is_de', origData: key, type: 'num', value: ['true'] },
            { logic: 'OR', criteria: [
                { condition: '!=', data: 'kompot_de_Young_to_Old_is_de', origData: key, type: 'num', value: ['false'] },
                { condition: '>', data: 'means', origData: 'var_means_main', type: 'num', value: ['2'] }
            ] }
        ]
    };
    const pre = searchBuilderPreDefined(saved, new Set([key]));
    assert.deepEqual(pre.criteria[0], { condition: '=', data: 'kompot_de_Young_to_Old_is_de', origData: key, type: 'string', value: ['Yes'] });
    assert.equal(pre.criteria[1].logic, 'OR');
    assert.deepEqual(pre.criteria[1].criteria[0].value, ['No']);
    assert.deepEqual(pre.criteria[1].criteria[1], saved.criteria[1].criteria[1], 'a numeric column is untouched');
    assert.equal(saved.criteria[0].value[0], 'true', 'the saved config itself is not mutated');
});
