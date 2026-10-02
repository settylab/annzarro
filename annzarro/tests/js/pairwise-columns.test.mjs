/**
 * A gene table offers the varp matrices by NAME.
 *
 * /data/dataset_structure sends `varp: {keys: ['spearman_fold_change', ...]}`
 * (a list). panel-tracker.js iterated Object.keys() of that list, so the
 * varp tab listed "0: Focused Gene", "1: Focused Gene", and a column
 * {type: 'varp', key: 'spearman_fold_change', column: 'focused_gene'} from a
 * deep link or panel set matched no item and was silently dropped.
 *
 * Run:  node --test annzarro/tests/js/pairwise-columns.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};

const { DataManager } = await import('../../../static/js/data-manager.js');
const { pairwiseKeys, getVarpColumnsForGeneTable, getObspColumnsForCellTable } =
    await import('../../../static/js/panels/table-utilities/panel-tracker.js');
DataManager.getFocusedGene = () => 'S100a9';
DataManager.getFocusedCell = () => 'HSPC_Old_1#GAAG-1';

// the shape bm_aging.zarr's /data/dataset_structure returns
const structure = {
    obsp: { available: true, keys: ['connectivities', 'diffusion_walk_t5'] },
    varp: { available: true, keys: ['spearman_fold_change', 'spearman_smoothed'] }
};

test('varp items are named after the matrices', () => {
    const items = getVarpColumnsForGeneTable(structure);
    assert.deepEqual(items.map(i => i.key), ['spearman_fold_change', 'spearman_smoothed']);
    assert.equal(items[0].label, 'spearman_fold_change: S100a9 (focused)');
    // a column picked from the focus stores the gene, not a placeholder (#9)
    assert.ok(items.some(i => i.type === 'varp' && i.key === 'spearman_fold_change' && i.column === 'S100a9'));
});

test('a restored placeholder column is still listed, so it can be removed', () => {
    const items = getVarpColumnsForGeneTable(structure,
        [{ type: 'varp', key: 'spearman_fold_change', column: 'focused_gene' }]);
    const restored = items.find(i => i.column === 'focused_gene');
    assert.ok(restored);
    assert.equal(restored.label, 'spearman_fold_change: follows the focused gene (S100a9)');
});

test('obsp items are named after the matrices', () => {
    const items = getObspColumnsForCellTable(structure);
    assert.deepEqual(items.map(i => i.key), ['connectivities', 'diffusion_walk_t5']);
});

test('pairwiseKeys reads a list, a name-keyed object, or nothing', () => {
    assert.deepEqual(pairwiseKeys({ keys: ['a', 'b'] }), ['a', 'b']);
    assert.deepEqual(pairwiseKeys({ matrices: { a: {}, b: {} } }), ['a', 'b']);
    assert.deepEqual(pairwiseKeys({ matrices: ['m'], keys: ['k'] }), ['m']);
    assert.deepEqual(pairwiseKeys(undefined), []);
    assert.deepEqual(pairwiseKeys({}), []);
});
