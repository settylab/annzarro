import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelLabel, describeLoad, begin, panelReady, end, isCurrent, currentLoad } from '../../../static/js/utils/load-progress.js';

test('a plot is named by its embedding and colour', () => {
    const c = { x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' },
        color: { type: 'obs', key: 'cell_type', column: '' } };
    assert.equal(panelLabel('cell-plot', c), 'Cell plot · UMAP · coloured by cell_type');
    assert.equal(panelLabel('cell-table', {}), 'Cell table');
    assert.equal(panelLabel('gene-set', {}), 'Gene set analysis');
});

test('axes that are not one embedding are named x vs y', () => {
    const c = { x: { type: 'obs', key: 'n_genes' }, y: { type: 'obs', key: 'n_counts' } };
    assert.equal(panelLabel('cell-plot', c), 'Cell plot · n_genes vs n_counts');
});

test('the overall line counts panels and the ready ones', () => {
    assert.equal(describeLoad({ kind: 'link', name: 'a.zarr', total: 4, ready: 2 }), 'Opening link: a.zarr, 4 panels (2 ready)');
    assert.equal(describeLoad({ kind: 'link', name: 'a.zarr', total: 1 }), 'Opening link: a.zarr, 1 panel');
    assert.equal(describeLoad({ kind: 'switch', name: 'b.zarr' }), 'Switching to b.zarr…');
});

test('a newer load supersedes an older one; the older end does nothing', () => {
    const a = begin({ kind: 'link', name: 'a', ids: ['p1', 'p2'] });
    const b = begin({ kind: 'set', name: 'b', ids: ['p1'] });
    assert.ok(!isCurrent(a) && isCurrent(b));
    end(a);
    assert.ok(isCurrent(b), 'a late end of the superseded load must not clear the new one');
    panelReady('p1'); panelReady('other');
    assert.equal(currentLoad().ready, 1);
    end(b);
    assert.equal(currentLoad(), null);
});
