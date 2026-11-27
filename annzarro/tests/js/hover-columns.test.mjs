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

test('decision 32: a Cell Plot\'s Hover picker lists no gene score, and a stored one goes quietly', async () => {
    const { hoverColumnOptions: options, hoverInfoFromSelection: info, shownHoverInfo } =
        await import('../../../static/js/panels/plot-utilities/hover-columns.js');
    // the score's provider is registered (as on the page) and still a source of axes, colour and table columns
    await import('../../../static/js/utils/score-source.js');
    const R = await import('../../../static/js/utils/source-registry.js');
    const score = R.getSource('gene-score');
    assert.ok(score, 'the gene-score provider is registered');
    assert.equal(score.axes.includes('hover'), false, 'a score fills no hover line');
    assert.equal(R.hoverSources('cell-plot').includes(score), false);
    const stored = [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' },
        { type: 'gene-score', key: 'gene-signature-1', column: 'mean', layer: 'counts', label: 'T cell score' },
        { type: 'not-loaded-here', key: 'x' }];
    // the picker shows no Gene scores group, whatever is stored
    const cells = options('cells', structure, stored, false);
    assert.equal(cells.some(o => o.group === 'Gene scores' || String(o.value).startsWith('gene-score:')), false);
    // an old link's score entry is dropped when the plot is made; a provider this page has not loaded is kept
    assert.deepEqual(shownHoverInfo(stored, 'cells'), [{ type: 'obs', key: '_index' }, { type: 'obs', key: 'Age' }, { type: 'not-loaded-here', key: 'x' }]);
    const clean = [{ type: 'obs', key: '_index' }];
    assert.equal(shownHoverInfo(clean, 'cells'), clean, 'nothing to drop: the same array');
    assert.equal(shownHoverInfo(undefined, 'cells'), undefined);
    // and a pick in the picker does not carry it on
    assert.deepEqual(info('cells', ['Age'], stored), [{ type: 'obs', key: '_index' }, { type: 'not-loaded-here', key: 'x' }, { type: 'obs', key: 'Age' }]);
});
