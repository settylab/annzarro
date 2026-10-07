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

// --- columns with too many values to list -----------------------------------

test('a column with more distinct values than the list limit is filtered by typing', async () => {
    const { moreDistinctThan, textOnlyConditions, TEXT_ONLY_TYPE } = await import('../../../static/js/utils/search-builder.js');
    assert.equal(TEXT_ONLY_TYPE, 'az-text');
    assert.equal(moreDistinctThan(['a', 'b', 'a'], 2), false);
    assert.equal(moreDistinctThan(['a', 'b', 'c'], 2), true);
    const ids = Array.from({ length: 1e6 }, (_, i) => `BC${i}`);
    const t0 = Date.now();
    assert.equal(moreDistinctThan(ids, 10000), true);
    assert.ok(Date.now() - t0 < 200, 'stops counting at the limit');
    const select = () => 'select', input = () => 'input';
    const Criteria = {
        initInput: input, inputValueInput: input, isInputValidInput: input,
        stringConditions: {
            '=': { conditionName: 'Equals', init: select, inputValue: select, isInputValid: select, search: (t, v) => t === v[0] },
            '!=': { conditionName: 'Not', init: select, inputValue: select, isInputValid: select, search: (t, v) => t !== v[0] },
            contains: { conditionName: 'Contains', init: input }
        }
    };
    const c = textOnlyConditions(Criteria);
    assert.equal(c['='].init, input);
    assert.equal(c['!='].isInputValid, input);
    assert.equal(c['='].search('x', ['x']), true);
    assert.equal(c.contains, Criteria.stringConditions.contains);
    assert.equal(Criteria.stringConditions['='].init, select, 'the shared string conditions are not changed');
});

test('Equals lists each value once, in one pass over the rows, sorted and preselected as SearchBuilder does', async () => {
    const { fastSelectInit, fastSelectConditions } = await import('../../../static/js/utils/search-builder.js');
    // a jQuery of the calls fastSelectInit makes
    const $ = (tag, attrs = {}) => {
        const el = { tag, attrs, classes: new Set(), children: [], props: {}, store: {} };
        Object.assign(el, {
            addClass(c) { el.classes.add(c); return el; }, removeClass(c) { el.classes.delete(c); return el; },
            append(c) { el.children.push(...(Array.isArray(c) ? c : [c])); return el; }, on() { return el; },
            data(k, v) { el.store[k] = v; return el; }, html(h) { el.text = h; return el; },
            prop(k, v) { el.props[k] = v; return el; }, removeProp(k) { delete el.props[k]; return el; }
        });
        return el;
    };
    const Criteria = { classes: { value: 'v', dropDown: 'd', italic: 'i', select: 's', greyscale: 'g' },
        stringConditions: { '=': { init: null }, '!=': { init: null }, contains: {} }, numConditions: { '=': {}, '!=': {} } };
    const rows = ['b', 'a', 'c', 'a', 'b', null, 'c', 'a'];
    let reads = 0;
    const that = (type, rowsIn) => ({
        dom: { data: { children: () => ({ val: () => 0 }) }, valueTitle: $('<option>') },
        c: { orthogonal: { search: 'filter', display: 'display' }, greyscale: false },
        classes: { option: 'o', notItalic: 'n' },
        s: { type, dt: { rows: () => ({ indexes: () => ({ toArray: () => rowsIn.map((_, i) => i) }) }),
            settings: () => [{ oApi: { _fnGetCellData: (_s, row) => { reads++; return rowsIn[row]; } } }] } }
    });
    const init = fastSelectInit(Criteria, $);
    const select = init(that('string', rows), () => {}, ['b']);
    const options = select.children.slice(1);
    assert.deepEqual(options.map(o => o.attrs.value), [null, 'a', 'b', 'c']);    // '' sorts first
    assert.equal(options.find(o => o.attrs.value === 'b').props.selected, true);
    assert.ok(!select.classes.has('i'), 'a preselected value is not shown in italics');
    assert.ok(reads <= rows.length + 4, `one pass: ${reads} reads`);             // + a display read per value
    const nums = init(that('num', [10, 9, 100, 9]), () => {}).children.slice(1).map(o => o.attrs.value);
    assert.deepEqual(nums, [9, 10, 100]);
    const conds = fastSelectConditions(Criteria, $);
    assert.equal(conds.string['='].init, conds.string['!='].init);
    assert.ok(conds.string.contains && conds.num['='].init);
});

test('a numeric column with too many values to list keeps the number conditions (v0.4.1)', async () => {
    const { manyValuesType, isNumericColumn, textOnlyNumConditions, TEXT_ONLY_TYPE, TEXT_ONLY_NUM_TYPE } =
        await import('../../../static/js/utils/search-builder.js');
    // a focused-cell layer row of the bm_aging gene table: 16,285 floats
    const floats = Array.from({ length: 16285 }, (_, i) => i / 7);
    assert.equal(manyValuesType(floats, 10000), TEXT_ONLY_NUM_TYPE);
    assert.equal(manyValuesType([...floats.slice(0, 12000), null, null], 10000), TEXT_ONLY_NUM_TYPE,
        'missing values do not make a column text');
    assert.equal(manyValuesType(floats.map(String), 10000), TEXT_ONLY_TYPE);
    assert.equal(manyValuesType(floats.slice(0, 500), 10000), null, 'few values: detected type stands');
    assert.equal(isNumericColumn([null, undefined]), false);
    assert.equal(isNumericColumn([1, 'a']), false);
    const select = () => 'select', input = () => 'input';
    const Criteria = {
        initInput: input, inputValueInput: input, isInputValidInput: input,
        numConditions: {
            '=': { conditionName: 'Equals', init: select, inputValue: select, isInputValid: select, search: (t, v) => +t === +v[0] },
            '!=': { conditionName: 'Not', init: select, inputValue: select, isInputValid: select, search: (t, v) => +t !== +v[0] },
            '>': { conditionName: 'Greater Than', init: input, search: (t, v) => +t > +v[0] }
        }
    };
    const c = textOnlyNumConditions(Criteria);
    assert.equal(c['='].init, input);
    assert.equal(c['>'], Criteria.numConditions['>']);
    assert.equal(c['>'].search(0.6, ['0.5']), true);
    assert.equal(Criteria.numConditions['='].init, select, 'the shared number conditions are not changed');
});
