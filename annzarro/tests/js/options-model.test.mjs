/**
 * The shared options model (static/js/utils/options-model.js): one implementation of the offered list, layers, grading
 * menu, summaries and parameters for any method table. A fake two-method table with ONE shared threshold proves it
 * does not depend on the gene signature; a sweep over every value of the sentences that state a setting proves each
 * names the value in force.
 *
 * Run:  node --test annzarro/tests/js/options-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/options-model.js');
const O = await import('../../../static/js/utils/signature-options.js');
const G = await import('../../../static/js/utils/gene-signature.js');

// ---------------------------------------------------------------- a two-method fake with one shared threshold

const FAKE_METHODS = [
    { value: 'pct', label: '% expressing', menu: '% expressing', needs: ['threshold'], unit: '0 to 100',
        definition: 'Share of the group\'s cells above the threshold, 0 to 100.' },
    { value: 'mean_expr', label: 'Mean of expressing cells', menu: 'mean of expressing cells', needs: ['threshold'], unit: 'layer units',
        definition: 'Average over the cells above the threshold.' }
];

function fakeModel() {
    return M.createOptionsModel({
        methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['pct'], defaultLayer: 'X',
        paramDefaults: { pct: { threshold: 0 }, mean_expr: { threshold: 0 } },
        paramNotes: (recipe, method) => (FAKE_METHODS.find(m => m.value === method).needs.includes('threshold') && recipe.threshold
            ? [`above ${recipe.threshold}`] : []),
        paramLines: { threshold: (recipe) => `Expressed above ${M.figure(recipe.threshold || 0)}.` },
        paramValue: (recipe, key) => (recipe[key] === undefined ? 0 : recipe[key]),
        grade: (method, layer, kind) => (kind === 'signed'
            ? { grade: 'cannot', code: 'negative', reason: `Not available on '${layer}': it has negative values.` }
            : { grade: 'ok', code: '', reason: '' }),
        layerLines: (layer, recipe, kind, stats, offered) => (kind === 'signed' && offered.length
            ? [{ grade: 'cannot', code: 'negative', text: `Has negative values: ${M.andList(offered.map(m => `${m}`))} not offered here.` }] : [])
    });
}

test('a model is built from a method table and refuses a table that cannot work', () => {
    assert.throws(() => M.createOptionsModel({ methods: [], defaultMethod: 'a', defaultOffered: [], grade: () => ({}) }), /method table/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['pct'] }), /grading/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'nope', defaultOffered: ['pct'], grade: () => ({}) }), /default method/);
    assert.throws(() => M.createOptionsModel({ methods: [...FAKE_METHODS, FAKE_METHODS[0]], defaultMethod: 'pct', defaultOffered: ['pct'], grade: () => ({}) }), /unique/);
    assert.throws(() => M.createOptionsModel({ methods: FAKE_METHODS, defaultMethod: 'pct', defaultOffered: ['zzz'], grade: () => ({}) }), /default offered/);
});

test('the offered list and layers of a fake table follow the same rules as the signature\'s', () => {
    const m = fakeModel();
    assert.deepEqual(m.offeredMethods({}), ['pct'], 'the default list');
    assert.deepEqual(m.offeredMethods({ offered: ['mean_expr', 'pct', 'junk'] }), ['pct', 'mean_expr'], 'known ids, in table order');
    assert.deepEqual(m.offeredMethods({ offered: [], method: 'mean_expr' }), ['mean_expr'], 'never empty');
    assert.deepEqual(m.offeredLayers({ input: 'X', layers: ['b', 'X', 'b', ''] }), ['X', 'b'], 'the default layer first, each once');
    assert.equal(m.isOffered({ offered: ['pct'], input: 'X' }, 'mean_expr'), false);
    assert.equal(m.isOffered({ offered: ['pct'], input: 'X' }, 'pct', 'X'), true);
    assert.equal(m.isOffered({ offered: ['pct'], input: 'X' }, 'pct', 'other'), false);
    assert.deepEqual(m.defaultFields(), { input: 'X', method: 'pct', offered: ['pct'], layers: ['X'] });
    assert.equal(m.isDefaultOffer({ input: 'X', method: 'pct', offered: ['pct'], layers: ['X'] }), true);
    assert.equal(m.isDefaultOffer({ input: 'X', method: 'pct', offered: ['pct', 'mean_expr'], layers: ['X'] }), false);
});

test('one threshold is shared: both methods read the same recipe field, and a change moves both', () => {
    const m = fakeModel();
    assert.deepEqual(m.usersOfParam('threshold'), ['pct', 'mean_expr']);
    const a = { threshold: 0.5 };
    assert.deepEqual(m.paramsOf(a, 'pct'), { threshold: 0.5 });
    assert.deepEqual(m.paramsOf(a, 'mean_expr'), { threshold: 0.5 });
    assert.deepEqual(m.paramsOf({}, 'pct'), { threshold: 0 }, 'a missing value is filled');
    assert.equal(m.isMethodDefault({ threshold: 0 }, 'pct'), true);
    assert.equal(m.isMethodDefault({ threshold: 0.5 }, 'mean_expr'), false);
    const r = { offered: ['pct', 'mean_expr'], input: 'X', layers: ['X'], threshold: 0.5 };
    assert.equal(m.offeredSummary(r), '% expressing (above 0.5), mean of expressing cells (above 0.5) · X');
    assert.equal(m.offeredSummary({ ...r, threshold: 0 }), '% expressing, mean of expressing cells · X');
    assert.equal(m.offeredSummaryShort(r), '2 methods · X');
    assert.equal(m.paramLine('threshold', r), 'Expressed above 0.5.');
});

test('the graded menu of a fake table leaves out what cannot be computed and says why on the method', () => {
    const m = fakeModel();
    const r = { offered: ['pct', 'mean_expr'], input: 'X', layers: ['X', 'logged'] };
    const kinds = { X: 'signed', logged: 'log' };
    const graded = m.gradedOptions(r, null, kinds);
    assert.deepEqual(graded.map(o => [o.id, o.grade]), [['pct@X', 'cannot'], ['pct@logged', 'ok'], ['mean_expr@X', 'cannot'], ['mean_expr@logged', 'ok']]);
    assert.deepEqual(m.offeredOptions(r, null, kinds).map(o => o.id), ['pct@logged', 'mean_expr@logged']);
    assert.deepEqual(m.offeredOptions(r, ['logged'], kinds).map(o => o.layer), ['logged', 'logged'], 'a layer the dataset lacks is left out');
    // every offered layer is signed: said once under the method; only some: said on the layer's row
    assert.deepEqual(m.methodLines('pct', ['X'], r, { X: 'signed' }).map(l => l.text), ["Not available on 'X': it has negative values."]);
    assert.deepEqual(m.methodLines('pct', ['X', 'logged'], r, kinds), []);
    assert.deepEqual(m.methodLines('pct', ['X', 'b'], r, { X: 'signed', b: 'signed' }).map(l => l.text), ["Not available on 'X': it has negative values."].map(() => "Not available on 'X': it has negative values."));
    assert.deepEqual(m.layerLines('X', r, 'signed').map(l => l.code), ['negative']);
    assert.deepEqual(m.layerLines('logged', r, 'log'), []);
});

test('the signature is that same model: its names are the model\'s, bound', () => {
    assert.equal(O.SIGNATURE_MODEL.offeredMethods, O.offeredMethods);
    assert.equal(O.SIGNATURE_MODEL.gradedOptions, O.gradedOptions);
    assert.equal(O.SIGNATURE_MODEL.defaultLayer, O.DEFAULT_INPUT);
});

// ---------------------------------------------------------------- every sentence names the value in force

const recipe = (raw) => G.normalizeRecipe({ genes: ['A', 'B'], ...raw }).recipe;

test('down-gene weighting hint: names the weighting in force, and only that one', () => {
    for (const weight of O.DOWN_WEIGHTS) {
        const other = O.DOWN_WEIGHTS.find(w => w !== weight);
        const line = O.downWeightLine(weight);
        assert.ok(line.includes(O.DOWN_WEIGHT_WORDS[weight]), `${weight}: ${line}`);
        assert.ok(!line.includes(O.DOWN_WEIGHT_WORDS[other]), `${weight} does not name ${other}`);
    }
    assert.equal(O.downWeightLine(undefined), O.downWeightLine('gene'), 'an unknown weighting reads as the default, and says so');
});

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
        assert.ok(line.startsWith('A gene counts as detected in a cell when its value is above this.'), 'the old sentence leads');
    }
    assert.equal(O.thresholdLine(-1), O.thresholdLine(0), 'an invalid threshold is read as 0, and the line says 0');
    assert.equal(O.SIGNATURE_MODEL.paramLine('clip', recipe({ clip: 4 })), O.clipLine(4));
    assert.equal(O.SIGNATURE_MODEL.paramLine('detect_above', recipe({ detect_above: 0.25 })), O.thresholdLine(0.25));
});

const KINDS = ['counts', 'normalised', 'log', 'signed', 'other', undefined];
const KIND_PHRASE = { counts: 'Raw counts', normalised: 'Normalised', log: 'Log values', signed: 'negative values' };

test('layer lines: each names the kind or the threshold in force, over every kind and offered set', () => {
    const subsets = [['zscore_mean'], ['mean', 'sum'], ['sum', 'fraction_of_total'], ['detected'], O.METHODS];
    for (const offered of subsets) {
        for (const kind of KINDS) {
            for (const t of [0, 0.1, 1, 5]) {
                const r = recipe({ offered, detect_above: t });
                const stats = { density: 0.5, quantiles: [0.1, 0.5, 1, 2, 4], min: -1, max: 4 };
                for (const line of O.layerLines('L', r, kind, stats)) {
                    assert.ok(line.text.length > 0);
                    if (line.code === 'detect_high' || line.code === 'detect_low') {
                        assert.ok(line.text.includes(M.figure(t)), `${line.code} names ${t}: ${line.text}`);
                    } else {
                        assert.ok(line.text.includes(KIND_PHRASE[kind]), `${kind}/${line.code}: ${line.text}`);
                    }
                }
            }
        }
    }
});

test('method lines and option notes: each names the layer, or every offered layer, or the down genes', () => {
    for (const method of O.METHODS) {
        for (const kind of KINDS) {
            for (const hasDown of [false, true]) {
                const r = recipe({ offered: [method], detect_above: 0.5, down: hasDown ? ['C'] : [], directions: hasDown });
                for (const layers of [['L'], ['L', 'M']]) {
                    const kinds = { L: kind, M: kind };
                    for (const line of O.methodLines(method, layers, r, kinds, { L: { density: 0.5, quantiles: [0.1, 0.5, 1, 2, 4] } })) {
                        if (line.down) assert.ok(/down genes/i.test(line.text), line.text);
                        else if (layers.length === 1) assert.ok(line.text.includes("'L'"), line.text);
                        else assert.ok(line.text.includes('every offered layer'), line.text);
                    }
                }
                for (const o of O.gradedOptions(r, null, { X: kind })) {
                    if (o.grade !== 'ok') assert.ok(o.reason.includes("'X'") || /down genes/i.test(o.reason), o.reason);
                    assert.equal(o.note, o.grade === 'warn' ? o.reason : '');
                }
            }
        }
    }
});

// --- a grouping's recipe, which has no input and no method (G7b, M9) ------------------------------------------------

const STAT_METHODS = [
    { value: 'mean', label: 'Mean', menu: 'Mean', needs: [], unit: 'layer units', definition: 'Average over the group.' },
    { value: 'sd', label: 'SD', menu: 'SD', needs: [], unit: 'layer units', definition: 'Standard deviation over the group.' }
];

function groupingModel() {
    return M.createOptionsModel({
        methods: STAT_METHODS, defaultMethod: 'mean', defaultOffered: ['mean'], defaultLayer: 'X',
        resetFields: ['offered', 'layers'], grade: () => ({ grade: 'ok', code: '', reason: '' })
    });
}

test('M9: a grouping\'s recipe (offered and layers, no input or method) reads as the default layer', () => {
    const m = groupingModel();
    const recipe = { version: 1, partitionings: [], offered: ['mean', 'sd'] };
    assert.deepEqual(m.offeredLayers(recipe), ['X']);
    assert.deepEqual(m.gradedOptions(recipe).map((o) => o.id), ['mean@X', 'sd@X']);
    assert.equal(m.offeredSummary(recipe), 'Mean, SD · X');
    assert.equal(m.inputOf(recipe), 'X');
    assert.equal(m.inputOf({ input: 'logged' }), 'logged');
});

test('M9: a reset writes only the fields the spec names, so no foreign field enters a grouping\'s recipe', () => {
    const m = groupingModel();
    assert.deepEqual(m.defaultFields(), { offered: ['mean'], layers: ['X'] });
    assert.equal(m.isDefaultOffer({ version: 1, partitionings: [], offered: ['mean'], layers: ['X'] }), true);
    assert.equal(m.isDefaultOffer({ version: 1, partitionings: [] }), true, 'defaults left out are the defaults');
    assert.equal(m.isDefaultOffer({ version: 1, partitionings: [], offered: ['mean', 'sd'] }), false);
});
