/**
 * Hidden control bars stay hidden when the dataset finishes loading.
 *
 * Reported from the paper's screenshot run and reproduced headless: a deep
 * link or panel set with controlState false showed every control bar again
 * once the dataset loaded (panel-ui-make.js toggled them on, cell-table.js
 * set display 'flex'). In half-height tiles the plot was squeezed to ~0 px,
 * Plotly threw 'Something went wrong with axis scaling' and the tile stayed
 * blank. The loading code now goes through syncControlsWithDataset, which
 * never shows a bar the user (or a restored view) hid.
 *
 * Run:  node --test annzarro/tests/js/controls-visibility.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { setControlsVisible, syncControlsWithDataset } = await import('../../../static/js/utils/controls-visibility.js');
const el = () => ({ style: {}, dataset: {} });

test('a bar hidden by the user stays hidden when the dataset loads', () => {
    const bar = el();
    setControlsVisible(bar, false);
    syncControlsWithDataset(bar, true);
    assert.equal(bar.style.display, 'none');
});

test('a bar nobody hid is shown once a dataset is loaded, hidden before', () => {
    const bar = el();
    syncControlsWithDataset(bar, false);
    assert.equal(bar.style.display, 'none');
    syncControlsWithDataset(bar, true);
    assert.equal(bar.style.display, 'flex');
});

test('showing it again is remembered too', () => {
    const bar = el();
    setControlsVisible(bar, false);
    setControlsVisible(bar, true);
    syncControlsWithDataset(bar, true);
    assert.equal(bar.style.display, 'flex');
    syncControlsWithDataset(bar, false);
    assert.equal(bar.style.display, 'none', 'no dataset: nothing to control');
});

test('a missing element is ignored', () => {
    assert.doesNotThrow(() => { setControlsVisible(null, true); syncControlsWithDataset(undefined, true); });
});
