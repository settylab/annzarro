/**
 * The plot panel has a "Hover" picker for settings.hoverInfo.
 *
 * hoverInfo was read by loadHoverColumns (and saved in links and panel sets)
 * but no control in the panel changed it. The picker lists the obs (cell
 * plot) or var (gene plot) columns; picking writes hoverInfo and reloads
 * only those columns into the hover text, without a redraw.
 *
 * Run:  node --test annzarro/tests/js/hover-columns.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { hoverColumnOptions, hoverInfoFromSelection, hoverOffFromSelection, NO_HOVER } =
    await import('../../../static/js/panels/plot-utilities/hover-columns.js');

const structure = {
    obs: { columns: ['_index', 'Age', 'highres_celltype', 'n_counts'] },
    var: { columns: ['_index', 'highly_variable', 'means'] }
};

test('the picker lists annotation columns and marks the configured ones', () => {
    const opts = hoverColumnOptions('cells', structure, [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' }]);
    assert.deepEqual(opts.map(o => o.value), [NO_HOVER, 'Age', 'highres_celltype', 'n_counts']);
    assert.equal(opts[0].label, 'No hover');
    assert.deepEqual(opts.filter(o => o.selected).map(o => o.value), ['Age']);
    assert.deepEqual(hoverColumnOptions('genes', structure, undefined).map(o => o.value), [NO_HOVER, 'highly_variable', 'means']);
    assert.deepEqual(hoverColumnOptions('cells', {}, []).map(o => o.value), [NO_HOVER]);
});

test('a selection becomes hoverInfo, keeping what the picker cannot show', () => {
    const previous = [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' }, { type: 'obsm', key: 'X_umap', column: '0' }];
    const next = hoverInfoFromSelection('cells', ['highres_celltype', 'n_counts'], previous);
    assert.deepEqual(next, [
        { type: 'obs', key: '_index' },
        { type: 'obsm', key: 'X_umap', column: '0' },
        { type: 'obs', key: 'highres_celltype' },
        { type: 'obs', key: 'n_counts' }
    ]);
    // clearing the selection leaves the default name entry
    assert.deepEqual(hoverInfoFromSelection('genes', [], undefined), [{ type: 'var', key: '_index' }]);
    // round trip: what is selected is what the options mark
    const opts = hoverColumnOptions('cells', structure, next);
    assert.deepEqual(opts.filter(o => o.selected).map(o => o.value), ['highres_celltype', 'n_counts']);
});

test('"No hover": shown selected when the hover is off, and picked or left by the selection', () => {
    for (const off of [true, 'auto']) {
        const opts = hoverColumnOptions('cells', structure, [{ type: 'obs', key: 'Age' }], off);
        assert.deepEqual(opts.filter(o => o.selected).map(o => o.value), [NO_HOVER], String(off));
    }
    assert.equal(hoverOffFromSelection([NO_HOVER], undefined), true);              // picked
    assert.equal(hoverOffFromSelection([NO_HOVER, 'Age'], 'auto'), false);         // a column picked while off
    assert.equal(hoverOffFromSelection([NO_HOVER, 'Age'], false), true);           // "No hover" picked beside a column
    assert.equal(hoverOffFromSelection(['Age'], true), false);
    assert.equal(hoverOffFromSelection([], 'auto'), false);                        // everything cleared: names only
    // "No hover" is no column
    assert.deepEqual(hoverInfoFromSelection('cells', [NO_HOVER], undefined), [{ type: 'obs', key: '_index' }]);
});

test('the panel builds the picker and the listener writes hoverInfo', () => {
    const url = (p) => new URL(`../../../static/js/panels/plot-utilities/${p}`, import.meta.url);
    const make = fs.readFileSync(url('panel-ui-make.js'), 'utf8');
    assert.match(make, /<select multiple[^>]*id="hover-columns-\$\{id\}"/);
    assert.match(make, /populateHoverSelect\(document\.getElementById\(`hover-columns-\$\{id\}`\)/);
    const listeners = fs.readFileSync(url('listeners.js'), 'utf8');
    assert.match(listeners, /settings\.hoverInfo = hoverInfoFromSelection\(/);
    assert.match(listeners, /data\.hoverExtra = extra;\s*await applyHoverInfo\(plotContainer, data, settings\)/);
});

test('a cell plot lists each score a signature offers, the default first; a gene plot lists none', async () => {
    const { hoverColumnOptions: options, hoverInfoFromSelection: info, scoreValue, parseScoreValue } =
        await import('../../../static/js/panels/plot-utilities/hover-columns.js');
    const offers = [{ method: 'zscore_mean', layer: '', label: 'Z-score mean' }, { method: 'mean', layer: '', label: 'Mean' },
        { method: 'mean', layer: 'counts', label: 'Mean · counts' }];
    const sigs = [{ id: 'gene-signature-1', title: 'T cell score', options: offers }, { id: 'gene-signature-2', title: 'B cell score', options: offers.slice(0, 1) }];
    const cells = options('cells', structure, [{ type: 'gene-score', key: 'gene-signature-2' }], false, sigs);
    const scores = cells.filter(o => o.group === 'Gene scores');
    assert.deepEqual(scores.map(o => [o.value, o.label, o.selected]), [
        ['gene-score:gene-signature-1:zscore_mean:', 'T cell score', false], ['gene-score:gene-signature-1:mean:', 'T cell score · Mean', false],
        ['gene-score:gene-signature-1:mean:counts', 'T cell score · Mean · counts', false], ['gene-score:gene-signature-2:zscore_mean:', 'B cell score', true]]);
    assert.equal(options('genes', structure, [], false, sigs).some(o => o.group), false);
    // a pick the signature no longer offers is kept and marked
    const lapsed = options('cells', structure, [{ type: 'gene-score', key: 'gene-signature-2', column: 'sum' }], false, sigs)
        .filter(o => o.group === 'Gene scores').map(o => [o.label, o.selected]);
    assert.deepEqual(lapsed.at(-1), ['B cell score · sum (no longer offered)', true]);
    // a pick stores the method in column and the layer beside it (none for the default)
    assert.deepEqual(parseScoreValue(scoreValue('gene-signature-1', 'mean', 'counts')), { key: 'gene-signature-1', column: 'mean', layer: 'counts' });
    assert.deepEqual(parseScoreValue(scoreValue('gene-signature-1', 'mean', '')), { key: 'gene-signature-1', column: 'mean' });
    const picked = info('cells', ['Age', scoreValue('gene-signature-1', 'mean', 'counts')], [{ type: 'obs', key: '_index' }]);
    assert.deepEqual(picked, [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' }, { type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'counts' }]);
    assert.deepEqual(info('cells', ['Age'], picked), [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' }]);
});
