/**
 * The client applies the server's ui.* settings.
 *
 * /api/v1/config serves them nested (ui: {defaults, cache, autosave,
 * enabled_panel_types}, the shape of config/base.yaml), but config.js read
 * only flat ui_* keys, so every ui setting was ignored. Worse, an absent flat
 * ui_autosave_enabled (undefined !== null) set AUTOSAVE.ENABLED to
 * undefined, switching autosave off. readUiSettings reads nested first, flat
 * as fallback, and reports unset as null.
 *
 * Run:  node --test annzarro/tests/js/ui-config.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => ({ ok: false, statusText: 'offline in test' });
const { readUiSettings } = await import('../../../static/js/config.js');

test('nested ui settings are read', () => {
    const ui = readUiSettings({ ui: {
        enabled_panel_types: ['cell-plot', 'gene-set'],
        defaults: { max_cells: 50000, point_size: 3, color_scale: 'Viridis', taxonomy_id: '10090' },
        cache: { max_entries: 10, max_size_mb: 64 },
        autosave: { enabled: false, interval_ms: 5000, auto_restore: false }
    } });
    assert.deepEqual(ui.enabledPanelTypes, ['cell-plot', 'gene-set']);
    assert.equal(ui.maxCells, 50000);
    assert.equal(ui.pointSize, 3);
    assert.equal(ui.colorScale, 'Viridis');
    assert.equal(ui.taxonomyId, '10090');
    assert.equal(ui.cacheMaxEntries, 10);
    assert.equal(ui.cacheMaxSizeMb, 64);
    assert.equal(ui.autosaveEnabled, false, 'false is a setting');
    assert.equal(ui.autosaveIntervalMs, 5000);
    assert.equal(ui.autosaveAutoRestore, false);
});

test('flat keys still work, nested wins', () => {
    const ui = readUiSettings({ ui_max_cells: 1234, ui_point_size: 7, ui: { defaults: { point_size: 2 } } });
    assert.equal(ui.maxCells, 1234);
    assert.equal(ui.pointSize, 2);
});

test('nothing sent leaves everything unset (null), autosave included', () => {
    const ui = readUiSettings({ ui_max_cells: null });
    assert.ok(Object.values(ui).every(v => v === null), JSON.stringify(ui));
    assert.equal(readUiSettings(undefined).autosaveEnabled, null);
});
