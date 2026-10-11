/**
 * A cell subset change reaches the panels whose data depends on the cells shown.
 *
 * Run:  node --test annzarro/tests/js/subset-reads.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { seriesReadsCellSubset, readsCellSubset } = await import('../../../static/js/utils/subset-reads.js');
const { notifyEach } = await import('../../../static/js/utils/notify-panels.js');

test('a cell panel reads the cells shown, whatever its sources', () => {
  assert.equal(readsCellSubset('cells', []), true);
  assert.equal(seriesReadsCellSubset('cells', { type: 'layer', key: 'X', column: 'Gata1' }), true);
  assert.equal(seriesReadsCellSubset('cells', { type: 'none' }), false);
});

test('a gene panel reads them only through the cell axis stores or a table link', () => {
  const row = { type: 'layer', key: 'X', column: 'cell_1' };
  const gene = { type: 'var', key: 'mean', column: '' };
  assert.equal(readsCellSubset('genes', [gene, row, { type: 'varm', key: 'pca', column: '0' }]), false);
  assert.equal(readsCellSubset('genes', [gene, { type: 'obsp', key: 'c', column: 'cell_1' }]), false);
  assert.equal(readsCellSubset('genes', [gene, { type: 'obs', key: 'cell_type', column: '' }]), true);
  assert.equal(readsCellSubset('genes', [gene, { type: 'obsm', key: 'X_umap', column: '0' }]), true);
  assert.equal(readsCellSubset('genes', [gene], 'cell-table-1'), true);
  assert.equal(readsCellSubset('genes', [gene, null, undefined], 'none'), false);
});

test('a subset change is not handed to a panel that does not read the cells; other updates are', async () => {
  const got = [];
  const panel = (id, reads) => ({ getId: () => id, onDataUpdate: (t) => { got.push([id, t]); },
    ...(reads === undefined ? {} : { readsCellSubset: () => reads }) });
  const panels = [panel('cells', true), panel('genes', false), panel('legacy')];
  await notifyEach(panels, 'subsetChanged', {});
  assert.deepEqual(got, [['cells', 'subsetChanged'], ['legacy', 'subsetChanged']]);
  got.length = 0;
  await notifyEach(panels, 'datasetChanged', {});
  assert.deepEqual(got.map(g => g[0]), ['cells', 'genes', 'legacy']);
});
