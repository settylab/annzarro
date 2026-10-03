/**
 * A panel without a dataset shows a still screen, not a spinner.
 *
 * Reported from the desktop app as "it scrolls in circles": panels restored
 * from autosave whose dataset had been deleted showed "No dataset loaded"
 * under a spinner that never stopped, so the app looked hung. Nothing loads
 * in that state; it waits for the user to pick a dataset.
 *
 * Run:  node --test annzarro/tests/js/no-dataset-screen.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { noDatasetScreenHtml } = await import('../../../static/js/utils/no-dataset-screen.js');

test('the no-dataset screen says so and has no spinner', () => {
    const html = noDatasetScreenHtml('cell-plot-1');
    assert.match(html, /id="loading-screen-cell-plot-1"/);
    assert.match(html, /No dataset loaded/);
    assert.doesNotMatch(html, /spinner|role="status"/);
});

test('plot and table panels both use it', () => {
    for (const file of ['panels/plot-utilities/panel-ui-make.js', 'panels/table-utilities/table-ui-make.js']) {
        const src = readFileSync(new URL(`../../../static/js/${file}`, import.meta.url), 'utf8');
        assert.match(src, /noDatasetScreenHtml\(id\)/, file);
        assert.doesNotMatch(src, /Please select a dataset to begin visualization/, file);
    }
});
