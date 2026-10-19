/**
 * Every plotting option of a panel travels through a share link, a panel set, the autosave and
 * Duplicate (the pure part: what is written, read and normalised).
 *
 * The options are listed once, with a value that is not the default, in plot-option-cases.json;
 * tests/browser/test_plot_options_roundtrip.py reads the same file and checks what the panels
 * draw. A new option the menu writes that is not in that file fails here, so it cannot go
 * unserialised unnoticed.
 *
 * Run:  node --test annzarro/tests/js/plot-options-roundtrip.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeViewPayload, decodeViewPayload, normalizeView, panelSetToView, serializableConfig } from '../../../static/js/utils/deeplink.js';
import { normalizePlotOptions, pickStyle, adoptStyle, STYLE_KEYS, OPTION_DEFAULTS, defaultLook } from '../../../static/js/panels/plot-utilities/plot-options.js';
import { THEMED_COLOURS } from '../../../static/js/utils/plot-theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { cases } = JSON.parse(fs.readFileSync(path.join(here, 'plot-option-cases.json'), 'utf8'));

const X = { type: 'obsm', key: 'X_umap', column: '0' };
const Y = { type: 'obsm', key: 'X_umap', column: '1' };

/** A plot's config with the option of `c` set (and what the option needs). */
function configFor(c) {
    const base = { id: 'cell-plot-1', x: X, y: Y, z: c.panel === 'a3d' ? { ...X } : null, color: { type: 'obs', key: 'cell_type', column: '' } };
    if (c.panel === 'a') base.equalAspect = true;
    return { ...base, ...(c.extra || {}), [c.key]: c.value };
}

/** What the panel hands on (getConfig) is what normalisation leaves of it. */
function opened(config) {
    return normalizePlotOptions(JSON.parse(JSON.stringify(config)));
}

const routes = {
    async 'share link'(config) {
        const payload = await encodeViewPayload({ v: 1, subset: null, layout: { v: 1, hierarchy: [{ type: 'tile', id: config.id }], controlState: {}, panelConfigs: { [config.id]: config } } });
        assert.ok(payload.startsWith('z1.'));
        const view = normalizeView(await decodeViewPayload(payload));
        return view.layout.panelConfigs[config.id];
    },
    async 'panel set'(config) {
        const view = { v: 1, layout: { v: 1, hierarchy: [{ type: 'tile', id: config.id }], controlState: {}, panelConfigs: { [config.id]: serializableConfig(config) } } };
        const set = { name: 's', dataset: 'd', panelConfigs: { [config.id]: { id: config.id, type: 'cell-plot', title: 't', config: serializableConfig(config) } }, view };
        const stored = JSON.parse(JSON.stringify(set));                         // the server keeps JSON
        return panelSetToView(stored).view.layout.panelConfigs[config.id];
    },
    async 'panel set from before views'(config) {
        const set = { name: 's', dataset: 'd', panelConfigs: { [config.id]: { id: config.id, type: 'cell-plot', title: 't', config: serializableConfig(config) } } };
        const plan = panelSetToView(JSON.parse(JSON.stringify(set)));
        return plan.view.layout.panelConfigs[config.id];
    },
    async autosave(config) {
        return JSON.parse(JSON.stringify({ view: { layout: { panelConfigs: { [config.id]: serializableConfig(config) } } } })).view.layout.panelConfigs[config.id];
    },
    async duplicate(config) {
        const copy = JSON.parse(JSON.stringify(config));
        copy.id = 'cell-plot-2';
        copy.title = 'Cell Plot 2';
        return copy;
    }
};

for (const c of cases) {
    const name = c.name || c.key;
    test(`${name}: the value survives normalisation`, () => {
        const config = configFor(c);
        const s = opened(config);
        if (c.auto) {
            assert.equal(s[c.key], true, 'stays automatic');
        } else {
            assert.deepEqual(s[c.key], c.value);
        }
        for (const [k, v] of Object.entries(c.extra || {})) assert.deepEqual(s[k], v, `${k} (needed by ${name})`);
    });

    for (const [route, carry] of Object.entries(routes)) {
        test(`${name}: through ${route}`, async () => {
            const config = opened(configFor(c));          // what a panel with the option holds
            const back = opened(await carry(config));     // what the next panel holds
            assert.equal(back.colourModel, config.colourModel, 'the colour model marker travels (an old link is migrated, a new one is not)');
            for (const k of [c.key, ...Object.keys(c.extra || {})]) {
                if (k === 'title' && route === 'duplicate') continue;       // a copy gets its own title, by design
                assert.deepEqual(back[k], config[k], `${k} differs after ${route}`);
            }
            // the other options of the panel: the same too, none gained or lost on the way
            const { id, title, ...rest } = back;
            const { id: id0, title: title0, ...rest0 } = config;
            assert.deepEqual(rest, rest0);
        });
    }
}

test('a colour left at the theme default stays out of a link, one set by hand is kept', () => {
    const s = opened({ id: 'cell-plot-1', bgColor: '#102030' });
    assert.equal(s.bgColor, '#102030');
    assert.equal(s.gridColor, undefined);
    assert.equal(JSON.parse(JSON.stringify(s)).gridColor, undefined);
});

test('every themed colour has a case, with a colour that is not the theme default', () => {
    const keys = new Set(cases.map(c => c.key));
    for (const k of THEMED_COLOURS) assert.ok(keys.has(k) || ['focusedColor', 'focusedEdgeColor'].includes(k), `${k} has no case`);
});

// ---- a new option cannot go unlisted ----

/** Keys the menu (and the panel's plot controls) write: `settings.<key> = ` in the sources. */
function writtenKeys() {
    const files = ['panels/plot-utilities/plot-aesthetics-menu.js', 'panels/plot-utilities/listeners.js', 'panels/plot-utilities/panel-ui-update.js'];
    const keys = new Set();
    for (const f of files) {
        const src = fs.readFileSync(path.join(root, 'static/js', f), 'utf8');
        for (const m of src.matchAll(/\bsettings\.([A-Za-z0-9_]+)\s*=(?!=)/g)) keys.add(m[1]);
    }
    for (const k of STYLE_KEYS) keys.add(k);
    for (const k of Object.keys(OPTION_DEFAULTS)) keys.add(k);
    for (const k of Object.keys(defaultLook())) keys.add(k);
    return keys;
}

// written by the panel for its own reasons, not options of the look: the data choice, the view, the loaded state
const NOT_A_PLOT_OPTION = {
    x: 'data choice', y: 'data choice', z: 'data choice', color: 'data choice', hoverInfo: 'data choice (Hover list)',
    column: 'part of an axis or colour choice', key: 'part of an axis or colour choice', type: 'part of an axis or colour choice',
    history: 'part of an axis or colour choice', locked: 'part of an axis or colour choice',
    viewport2D: 'the zoom (restored by its own tests)', viewport3D: 'the 3D camera (restored by its own tests)',
    tableFilter: 'link to a table', removeNonTableEntries: 'table filter behaviour, with the table panel',
    subsettedCells: 'subset', hideNonSubset: 'subset', title: 'panel title (listed)',
    colorMax: 'pair of colorMin', colourModel: 'format marker, checked by every route',
    colorLockedLimits: 'derived', centeringActive: 'derived by the Center at 0 button', colorRangeUnits: 'format marker of the colour range',
    hideOutliers: 'data filter button, the same route as Hide NaN', sortByColor: 'data button', highlightFocusedGene: 'gene plots: same route as highlightFocusedCell',
    hoverOff: 'derived', tickDensity: 'default only, no control', controlsVisible: 'layout state',
    margins: 'listed', pointColor: 'colour of a plot without colour data', autoPointColor: 'derived', logColor: 'colour scale button',
    focusedEdgeWidth: 'listed', scaleBarSize: 'listed',
    styleDefault: 'whether the plot is on Default or has its own look; session-style.test.mjs and test_session_default_style.py'
};

test('every option the menu writes is in plot-option-cases.json (or is not a plot option, with the reason)', () => {
    const listed = new Set(cases.map(c => c.key));
    const missing = [...writtenKeys()].filter(k => !listed.has(k) && !(k in NOT_A_PLOT_OPTION)).sort();
    assert.deepEqual(missing, [], 'add each to tests/js/plot-option-cases.json with a non-default value, or to NOT_A_PLOT_OPTION with the reason');
});

test('the options Apply to other panels copies are all listed', () => {
    const listed = new Set(cases.map(c => c.key));
    const missing = STYLE_KEYS.filter(k => !listed.has(k));
    assert.deepEqual(missing, []);
});

test('Apply to other panels carries the look of a panel as it is', () => {
    const s = opened({ id: 'cell-plot-1', bgColor: '#102030', showGrid: false, fontSize: 18 });
    const target = opened({ id: 'cell-plot-2' });
    adoptStyle(target, JSON.parse(JSON.stringify(pickStyle(s))));
    assert.equal(target.bgColor, '#102030');
    assert.equal(target.showGrid, false);
    assert.equal(target.fontSize, 18);
    assert.equal(target.gridColor, undefined);
});
