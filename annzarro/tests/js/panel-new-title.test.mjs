/**
 * A new panel's title (G9a, UX 2.1): a type with its own word for one panel ("title" in panel-types.json) is titled
 * with it, "Grouping 1"; every other type keeps "<label> 1" as before. The panel menu's path (SelectionTile) is
 * checked here; PanelManager's own path is checked in the browser (test_cell_grouping_panel.py).
 *
 * Run:  node --test annzarro/tests/js/panel-new-title.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });
const { Config } = await import('../../../static/js/config.js');
const { SelectionTile } = await import('../../../static/js/selection-tile.js');

const titleOf = (type) => SelectionTile.prototype._newTitle.call(
    { generateUniqueName: (name) => name, _formatPanelType: SelectionTile.prototype._formatPanelType }, type);

test('the registry names a grouping "Grouping", and no other type has a title of its own', () => {
    assert.equal(Config.panelTypeInfo('cell-grouping').title, 'Grouping');
    for (const type of ['cell-plot', 'gene-plot', 'cell-table', 'gene-table', 'gene-set', 'gene-signature', 'cell-gene', 'cell-count']) {
        assert.equal(Config.panelTypeInfo(type).title, undefined, type);
    }
});

test('a grouping from the panel menu is "Grouping 1"; the other types keep their label', () => {
    assert.equal(titleOf('cell-grouping'), 'Grouping 1');
    assert.equal(titleOf('cell-plot'), 'Cell Plot 1');
    assert.equal(titleOf('gene-signature'), 'Gene Signature 1');
});
