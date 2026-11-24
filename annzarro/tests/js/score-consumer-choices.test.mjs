/**
 * SO-3 (decision 31): every consumer of a gene score picks a method, then a layer, each listing EVERY entry, an
 * impossible pair disabled with its reason. The lists come from the gene-score provider (utils/score-source.js) and are
 * the same for a plot's axis, a Count Plot's measure, a Cell Table's add row and a Cell Grouping's score factor.
 * Nothing is "offered": no "Offer other scores…" entry, no "(no longer offered)", no hover entry (decision 32).
 *
 * Run:  node --test annzarro/tests/js/score-consumer-choices.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const SS = await import('../../../static/js/utils/score-source.js');
const R = await import('../../../static/js/utils/source-registry.js');
const { METHODS } = await import('../../../static/js/utils/signature-options.js');

const LAYERS = ['X', 'logged', 'counts'];
/** X scaled and signed, `logged` log-normalised, `counts` raw: the fixture's layers. */
const KINDS = { X: 'signed', logged: 'log', counts: 'counts' };

/** A signature panel as the provider reads it; `stored` overrides recipe fields (an old link's offered/layers). */
function signature(id, stored = {}) {
    const recipe = { genes: ['A', 'B'], down: [], input: 'X', method: 'zscore_mean', clip: 10, seed: null, bins: 25, controls: 50,
        detect_above: 0, version: 1, directions: false, down_weight: 'gene', ...stored };
    return { getId: () => id, getTitle: () => `Sig ${id}`, getType: () => 'gene-signature', getRecipe: () => recipe,
        getGrading: () => ({ kinds: KINDS, stats: {} }) };
}

/** The page's panel registry, with these panels open. */
function page(...panels) {
    const byId = new Map(panels.map(p => [p.getId(), p]));
    globalThis.PanelManager = {
        getPanel: (id) => byId.get(id) || null, getAllPanels: () => [...byId.values()], getActivePanels: () => [...byId.values()],
        reopenClosedPanel: () => null, createPanelNextTo: () => null
    };
    SS.noteDatasetLayers(LAYERS);
}

const provider = () => R.getSource('gene-score');

test('the method select lists all six methods, the layer select all three layers: menus are methods + layers, never a product', () => {
    page(signature('gene-signature-1'));
    const setting = { type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'logged' };
    const methods = provider().subKeyMenu(setting);
    assert.deepEqual(methods.options.map(o => o.value), [...METHODS]);
    assert.equal(methods.chosen, 'mean');
    assert.equal(methods.adopt, null, 'a consumer that holds a pair keeps it');
    assert.equal(methods.options.some(o => /offer/i.test(o.text) || o.run), false, 'no "Offer other scores…"');
    const layers = provider().layerMenu(setting);
    assert.deepEqual(layers.options.map(o => o.value), LAYERS);
    assert.equal(layers.chosen, 'logged');
    assert.equal(methods.options.length + layers.options.length, 9);
});

test('% of total: X is disabled in the layer select, with the reason as its title; a costly method says it reads the whole matrix', () => {
    page(signature('gene-signature-1'));
    const layers = provider().layerMenu({ type: 'gene-score', key: 'gene-signature-1', column: 'fraction_of_total', layer: 'counts' });
    const x = layers.options.find(o => o.value === 'X');
    assert.equal(x.disabled, true);
    assert.match(x.title, /negative values/);
    assert.equal(layers.options.find(o => o.value === 'counts').disabled, false);
    // on X, % of total is the disabled METHOD, with the same reason
    const methods = provider().subKeyMenu({ type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'X' });
    const share = methods.options.find(o => o.value === 'fraction_of_total');
    assert.equal(share.disabled, true);
    assert.match(share.title, /negative values/);
    // usable expensive methods name their cost; cheap ones do not
    const onCounts = provider().subKeyMenu({ type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'counts' }).options;
    assert.match(onCounts.find(o => o.value === 'fraction_of_total').title, /Reads the whole matrix once\./);
    assert.match(onCounts.find(o => o.value === 'control_adjusted').title, /Reads the whole matrix once\./);
    assert.doesNotMatch(onCounts.find(o => o.value === 'sum').title, /whole matrix/);
});

test('the select the user touches wins; the other moves only when impossible, and says so once', () => {
    page(signature('gene-signature-1'));
    const held = { type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'X' };
    const moved = provider().pairAfter(held, 'method', 'fraction_of_total');
    assert.equal(moved.column, 'fraction_of_total');
    assert.notEqual(moved.layer, 'X');
    assert.match(moved.say, /^Layer changed to \w+: % of total is not available on X\.$/);
    // a layer change that leaves the method possible moves nothing
    const kept = provider().pairAfter({ ...held, column: 'sum' }, 'layer', 'counts');
    assert.deepEqual(kept, { column: 'sum', layer: 'counts', say: '' });
    // the layer touched to X under % of total: the method moves
    const back = provider().pairAfter({ ...held, column: 'fraction_of_total', layer: 'counts' }, 'layer', 'X');
    assert.equal(back.layer, 'X');
    assert.notEqual(back.column, 'fraction_of_total');
    assert.match(back.say, /^Method changed to /);
});

test('a new consumer starts on z-score mean · X; an old signature that offered sum on counts starts there', () => {
    page(signature('gene-signature-1'), signature('gene-signature-2', { offered: ['sum'], layers: ['counts'], input: 'counts', method: 'sum' }));
    // a setting with no method and no layer (the user just picked the score, or switched the type from obsm)
    const fresh = provider().subKeyMenu({ type: 'gene-score', key: 'gene-signature-1', column: '0' });
    assert.deepEqual(fresh.adopt, { column: 'zscore_mean', layer: 'X' });
    assert.equal(fresh.chosen, 'zscore_mean');
    assert.deepEqual(SS.scoreStartPair('gene-signature-1'), { method: 'zscore_mean', layer: 'X' });
    assert.deepEqual(SS.scoreStartPair('gene-signature-2'), { method: 'sum', layer: 'counts' });
});

test('a stored pair that cannot be computed stays selectable, labelled "(not available)"; nothing is "no longer offered"', () => {
    page(signature('gene-signature-1'));
    const setting = { type: 'gene-score', key: 'gene-signature-1', column: 'fraction_of_total', layer: 'X' };
    const methods = provider().subKeyMenu(setting);
    const held = methods.options.find(o => o.value === 'fraction_of_total');
    assert.equal(held.disabled, false);
    assert.match(held.text, /\(not available\)$/);
    const layers = provider().layerMenu(setting);
    assert.match(layers.options.find(o => o.value === 'X').text, /\(not available\)$/);
    assert.equal(JSON.stringify([methods, layers]).includes('no longer offered'), false);
});

test('Cell Table chooser: a source lists its ticked columns only, then an add row with the same two selects', () => {
    page(signature('gene-signature-1'));
    const chooser = provider().table.chooser;
    const sig = { id: 'gene-signature-1', title: 'Sig gene-signature-1', input: 'X' };
    const ticked = [{ type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'counts' },
        { type: 'gene-score', key: 'other', column: 'sum', layer: 'X' }];
    assert.deepEqual(chooser.options(sig, ticked).map(o => [o.column, o.layer, o.text]), [['mean', 'counts', 'mean · counts']]);
    assert.deepEqual(chooser.options(sig, []), [], 'nothing ticked: no pairs listed');
    assert.equal('more' in chooser, false, 'no "Offer other scores…" link');
    const start = chooser.add.start(sig);
    assert.deepEqual(start, { method: 'zscore_mean', layer: 'X' });
    const menus = chooser.add.menus(sig, { method: 'mean', layer: 'logged' });
    assert.deepEqual(menus.methods.map(m => m.value), [...METHODS]);
    assert.deepEqual(menus.layers.map(l => l.value), LAYERS);
    assert.equal(chooser.add.label({ method: 'mean', layer: 'logged' }), 'mean · logged');
    assert.deepEqual(chooser.add.after(sig, 'layer', 'logged', { method: 'mean', layer: 'X' }), { method: 'mean', layer: 'logged', say: '' });
});

test('the provider fills no hover line and has no notice action to offer again', () => {
    page(signature('gene-signature-1'));
    assert.equal(provider().hover, undefined);
    assert.equal(provider().axes.includes('hover'), false);
    for (const gone of ['OFFER_MORE', 'offerAgain', 'canOfferAgain', 'scoreHoverOptions', 'optionOf', 'lapsedLabel', 'offerOtherScores', 'scoreOptions']) {
        assert.equal(gone in SS, false, `${gone} is gone`);
    }
});
