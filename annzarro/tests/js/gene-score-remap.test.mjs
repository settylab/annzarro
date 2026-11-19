/**
 * Ids change when panels are restored (a panel set added beside the open
 * panels): a plot's gene-score sources follow their signature to its new id
 * (static/js/utils/deeplink.js remapPanelReferences, panelsToAdd).
 *
 * Run:  node --test annzarro/tests/js/gene-score-remap.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { remapPanelReferences, panelsToAdd } = await import('../../../static/js/utils/deeplink.js');

const plot = () => ({
    id: 'cell-plot-1',
    x: { type: 'obsm', key: 'X_umap', column: '0' },
    y: { type: 'gene-score', key: 'gene-signature-1', label: 'T cell score', history: { 'gene-score': { key: 'gene-signature-1' } } },
    color: { type: 'gene-score', key: 'gene-signature-1', label: 'T cell score' },
    hoverInfo: [{ type: 'obs', key: '_index' }, { type: 'gene-score', key: 'gene-signature-1' }, { type: 'gene-score', key: 'gene-signature-9' }]
});

test('every gene-score source of a plot follows its signature to the new id, and only that one', () => {
    const [cfg] = remapPanelReferences([plot()], { 'gene-signature-1': 'gene-signature-7' });
    assert.equal(cfg.y.key, 'gene-signature-7');
    assert.equal(cfg.color.key, 'gene-signature-7');
    assert.equal(cfg.y.history['gene-score'].key, 'gene-signature-7');
    assert.deepEqual(cfg.hoverInfo.map(h => h.key), ['_index', 'gene-signature-7', 'gene-signature-9']);
    assert.equal(cfg.x.key, 'X_umap', 'an obsm key that looks like nothing else is left alone');
    assert.equal(cfg.y.label, 'T cell score', 'the title it was last seen under stays');
});

test('an obs column that happens to have a signature\'s id is not renamed', () => {
    const cfg = { x: { type: 'obs', key: 'gene-signature-1' }, tableFilter: 'gene-signature-1' };
    remapPanelReferences([cfg], { 'gene-signature-1': 'gene-signature-7' });
    assert.equal(cfg.x.key, 'gene-signature-1');
    assert.equal(cfg.tableFilter, 'gene-signature-7');
});

test('a panel set added beside open panels renames a taken signature id and the plots of the set follow', () => {
    const plan = { view: { layout: { hierarchy: [], panelConfigs: {} } }, closedPanels: [
        { type: 'gene-signature', id: 'gene-signature-1', config: { id: 'gene-signature-1', title: 'T', genes: ['A'] } },
        { type: 'cell-plot', id: 'cell-plot-1', config: plot() }
    ] };
    let n = 100;
    const added = panelsToAdd(plan, (id) => id === 'gene-signature-1', (type) => `${type}-${n++}`);
    const sig = added.find(p => p.type === 'gene-signature');
    const cell = added.find(p => p.type === 'cell-plot');
    assert.equal(sig.config.id, 'gene-signature-100');
    assert.equal(cell.config.color.key, 'gene-signature-100');
    assert.equal(cell.config.hoverInfo[1].key, 'gene-signature-100');
});

test('links and panel sets carry no computed value: a plot config with a score holds the recipe\'s id and a label only', () => {
    const json = JSON.stringify(plot());
    assert.equal(/values|Float32|score_values/.test(json), false);
    assert.deepEqual(Object.keys(plot().color).sort(), ['key', 'label', 'type']);
});
