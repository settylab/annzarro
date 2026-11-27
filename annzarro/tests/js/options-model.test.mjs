/**
 * The shared options model (static/js/utils/options-model.js): one implementation of the graded method and layer
 * selects and of the parameters for any method table (decision 31: every method on every layer, nothing offered). A
 * fake two-method table with ONE shared threshold proves it does not depend on the gene signature; the reason builder
 * is the one phrasing both providers use; a sweep over every value of the sentences that state a setting proves each
 * names the value in force.
 *
 * Run:  node --test annzarro/tests/js/options-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/options-model.js');
const O = await import('../../../static/js/utils/signature-options.js');

// ---------------------------------------------------------------- a two-method fake with one shared threshold

const FAKE_METHODS = [
    { value: 'pct', label: 'Fraction of cells', menu: 'Fraction of cells', needs: ['threshold'], unit: '0 to 100',
        definition: 'Share of the group\'s cells above the threshold, 0 to 100.' },
    { value: 'mean_expr', label: 'Mean of expressing cells', menu: 'mean of expressing cells', needs: ['threshold'], unit: 'layer units',
        definition: 'Average over the cells above the threshold.' }
];

function fakeModel() {
    return M.createOptionsModel({
        methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['pct'], defaultLayer: 'X',
        paramDefaults: { pct: { threshold: 0 }, mean_expr: { threshold: 0 } },
        paramValue: (recipe, key) => (recipe[key] === undefined ? 0 : recipe[key]),
        grade: (method, layer, kind) => (kind === 'signed'
            ? { grade: 'cannot', code: 'negative', reason: M.REASON.cannotOn(FAKE_METHODS.find(m => m.value === method).label, M.quoted(layer), 'it has negative values.') }
            : { grade: 'ok', code: '', reason: '' })
    });
}

test('a model is built from a method table and refuses a table that cannot work', () => {
    assert.throws(() => M.createOptionsModel({ methods: [], defaultMethod: 'a', defaultOffered: [], grade: () => ({}) }), /method table/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['pct'] }), /grading/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'nope', defaultOffered: ['pct'], grade: () => ({}) }), /default method/);
    assert.throws(() => M.createOptionsModel({ methods: [...FAKE_METHODS, FAKE_METHODS[0]], defaultMethod: 'pct', defaultOffered: ['pct'], grade: () => ({}) }), /unique/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['zzz'], grade: () => ({}) }), /default offered/);
});

test('one threshold is shared: both methods read the same recipe field, and a change moves both', () => {
    const m = fakeModel();
    const a = { threshold: 0.5 };
    assert.deepEqual(m.paramsOf(a, 'pct'), { threshold: 0.5 });
    assert.deepEqual(m.paramsOf(a, 'mean_expr'), { threshold: 0.5 });
    assert.deepEqual(m.paramsOf({}, 'pct'), { threshold: 0 }, 'a missing value is filled');
    assert.equal(m.isMethodDefault({ threshold: 0 }, 'pct'), true);
    assert.equal(m.isMethodDefault({ threshold: 0.5 }, 'mean_expr'), false);
});

test('the graded selects of a fake table list every method and layer and disable what cannot be computed', () => {
    const m = fakeModel();
    const kinds = { X: 'signed', logged: 'log' };
    const methods = m.methodChoices({ layer: 'X', kinds });
    assert.deepEqual(methods.map(o => [o.value, o.disabled]), [['pct', true], ['mean_expr', true]]);
    assert.equal(methods[0].title, "Fraction of cells cannot be computed on 'X': it has negative values.");
    assert.deepEqual(m.methodChoices({ layer: 'logged', kinds }).map(o => o.disabled), [false, false]);
    const layers = m.layerChoices({ method: 'pct', datasetLayers: ['X', 'logged'], kinds });
    assert.deepEqual(layers.map(o => [o.value, o.disabled]), [['X', true], ['logged', false]]);
    const moved = m.pairAfter('method', 'pct', { layer: 'X' }, { datasetLayers: ['X', 'logged'], kinds });
    assert.deepEqual([moved.layer, moved.say], ['logged', "Layer changed to logged: Fraction of cells cannot be computed on 'X'."]);
});

test('every grading sentence has one phrasing: the method, then why', () => {
    assert.equal(M.REASON.cannotOn('% of total', M.quoted('X'), 'it has negative values.'), "% of total cannot be computed on 'X': it has negative values.");
    assert.equal(M.REASON.cannotWith('Sum', 'down genes', 'a signed sum depends on how many genes each side has.'),
        'Sum cannot be computed with down genes: a signed sum depends on how many genes each side has.');
    assert.equal(M.REASON.note('Mean', M.quoted('counts'), 'follows sequencing depth.'), "Mean on 'counts' follows sequencing depth.");
    assert.equal(M.REASON.moved('Method', 'mean', 'Fraction of cells', M.quoted('X')), "Method changed to mean: Fraction of cells cannot be computed on 'X'.");
});

test('the signature is that same model: its names are the model\'s, bound', () => {
    assert.equal(O.SIGNATURE_MODEL.methodInfo, O.methodInfo);
    assert.equal(O.SIGNATURE_MODEL.methodChoices, O.scoreMethodChoices);
    assert.equal(O.SIGNATURE_MODEL.defaultLayer, O.DEFAULT_INPUT);
});

// ---------------------------------------------------------------- every sentence names the value in force


test('clip line: names the clip, or that there is none', () => {
    for (const clip of [0.5, 1, 2.5, 10, 33.333, 1000, 1e6]) {
        assert.ok(O.clipLine(clip).includes(`±${M.figure(clip)}`), String(clip));
        assert.ok(!O.clipLine(clip).startsWith('Not clipped'));
    }
    assert.match(O.clipLine(null), /^Not clipped/);
    assert.equal(O.clipLine(undefined), O.clipLine(null));
});

test('threshold line: names the threshold, and keeps the sentence the page has always had', () => {
    for (const t of [0, 0.1, 0.5, 1, 2.5, 10, 123.456, 1e-3]) {
        const line = O.thresholdLine(t);
        assert.ok(line.includes(`above ${M.figure(t)}.`), `${t}: ${line}`);
        assert.ok(line.startsWith('A gene counts as expressed in a cell when its value is above this.'), 'the old sentence leads');
    }
    assert.equal(O.thresholdLine(-1), O.thresholdLine(0), 'an invalid threshold is read as 0, and the line says 0');
});
