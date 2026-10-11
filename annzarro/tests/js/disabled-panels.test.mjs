/**
 * Panels the administrator disabled (policy key panel.<type>.enabled).
 *
 *   - panels/panel-types.json is the panel registry: every
 *     PanelManager.registerPanelType(type, ...) in static/js has an entry, so
 *     a new panel type cannot skip its switch; config.js reads it.
 *   - The panel menu (SelectionTile.panelTypes) offers the enabled types only.
 *   - A disabled panel in a panel set or a link is a placeholder that keeps
 *     its saved JSON: saving the layout again, reloading it and enabling the
 *     type give the panel back intact.
 *
 * No browser here: a stand-in DOM is enough for the placeholder; the
 * browser test (tests/browser/test_disabled_panels.py) drives the real app.
 *
 * Run:  node --test annzarro/tests/js/disabled-panels.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_JS = new URL('../../../static/js/', import.meta.url).pathname;

let policyReply = { status: 404 };
globalThis.fetch = async (url) => {
    if (String(url).includes('/policy/effective')) {
        return policyReply.status === 200
            ? { ok: true, status: 200, headers: { get: () => null }, json: async () => policyReply.body }
            : { ok: false, status: policyReply.status };
    }
    return { ok: false, status: 404, statusText: 'offline in test' };
};
const { Config } = await import('../../../static/js/config.js');
const { Policy } = await import('../../../static/js/policy.js');
const { SelectionTile } = await import('../../../static/js/selection-tile.js');
const { createPlaceholderPanel } = await import('../../../static/js/utils/placeholder-panel.js');
const { serializableConfig } = await import('../../../static/js/utils/deeplink.js');

const REGISTRY = JSON.parse(readFileSync(join(STATIC_JS, 'panels', 'panel-types.json'), 'utf8'));

function sources(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === 'vendor' ? [] : sources(path);
        return name.endsWith('.js') ? [path] : [];
    });
}

test('every registerPanelType has an entry in panel-types.json', () => {
    const registered = [];
    for (const file of sources(STATIC_JS)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\bregisterPanelType\(\s*['"]([^'"]+)['"]/g)) registered.push(m[1]);
    }
    assert.ok(registered.length >= 5, `found ${registered.length} registerPanelType calls`);
    const known = new Set(REGISTRY.map(e => e.type));
    for (const type of registered) assert.ok(known.has(type), `panel type "${type}" has no entry in panels/panel-types.json`);
    for (const type of known) assert.ok(registered.includes(type), `panel-types.json lists "${type}" but nothing registers it`);
});

test('panel-types.json entries are complete, and config.js serves them', () => {
    for (const e of REGISTRY) {
        for (const field of ['type', 'label', 'icon']) assert.equal(typeof e[field], 'string', `${e.type}.${field}`);
        assert.match(e.type, /^[a-z]+(-[a-z]+)*$/);
    }
    assert.equal(new Set(REGISTRY.map(e => e.type)).size, REGISTRY.length);
    assert.deepEqual(Config.PANEL_TYPES, REGISTRY);
    assert.deepEqual(Config.PANEL_TYPES.map(p => p.type), ['cell-plot', 'gene-plot', 'cell-table', 'gene-table', 'gene-set']);
});

const menu = () => Object.getOwnPropertyDescriptor(SelectionTile.prototype, 'panelTypes').get.call({}).map(p => p.type);

test('the panel menu offers every type when the server has no policy', async () => {
    policyReply = { status: 404 };
    await Policy.load();
    assert.deepEqual(menu(), REGISTRY.map(e => e.type));
});

test('the panel menu leaves out the types the policy disables', async () => {
    policyReply = { status: 200, body: { version: 'v1', values: { 'panel.gene-set.enabled': false, 'panel.cell-plot.enabled': true } } };
    await Policy.load();
    assert.deepEqual(menu(), ['cell-plot', 'gene-plot', 'cell-table', 'gene-table']);
    // the config's own list still applies on top
    const saved = Config.DEFAULTS.ENABLED_PANEL_TYPES;
    Config.DEFAULTS.ENABLED_PANEL_TYPES = ['cell-plot', 'gene-set'];
    assert.deepEqual(menu(), ['cell-plot']);
    Config.DEFAULTS.ENABLED_PANEL_TYPES = saved;
    // enabled again: back in the menu
    policyReply = { status: 200, body: { version: 'v2', values: { 'panel.gene-set.enabled': true } } };
    await Policy.load();
    assert.ok(menu().includes('gene-set'));
    policyReply = { status: 404 };
    await Policy.load();
});

// --- the placeholder, in a stand-in DOM -----------------------------------

class El {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; }
    set innerHTML(v) { this.children = []; this.textContent = ''; }
    get innerHTML() { return ''; }
    append(...c) { this.children.push(...c); }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener() {}
    texts() { return [this.textContent, ...this.children.flatMap(c => c.texts())].filter(Boolean); }
}
globalThis.document = { createElement: (tag) => new El(tag) };

const SAVED = {
    id: 'gene-set-G', title: 'My enrichment', tableFilter: 'gene-table-A', autoUpdate: true,
    sections: { 'string-enrichment': { visible: true, params: { category: 'KEGG', fdr: 0.01 } }, links: { visible: false } },
    consent: { selection: 'abc', hosts: ['string-db.org'] }, taxonomyId: '10090', unknownFutureField: { nested: [1, 2, 3] }
};

test('a disabled panel is a placeholder that says so and keeps the saved JSON', () => {
    const container = new El('div');
    const panel = createPlaceholderPanel(container, 'gene-set', SAVED, { disabled: true });
    panel.init();
    const text = container.texts().join(' | ');
    assert.match(text, /Disabled by the administrator/);
    assert.doesNotMatch(text, /no data/i);
    assert.equal(container.children[0].dataset.disabledByPolicy, 'true');
    assert.equal(panel.isPlaceholder, true);
    assert.equal(panel.getType(), 'gene-set');
    assert.deepEqual(panel.getConfig(), SAVED);
});

test('save, reload, save again: the disabled panel\'s JSON is intact, and the panel returns when enabled', () => {
    // save: what saveLayout writes for a panel (panel-manager.js: { id, ...serializableConfig(getConfig()) })
    const saveOf = (panel) => ({ id: panel.getId(), ...serializableConfig(panel.getConfig()) });
    const first = createPlaceholderPanel(new El('div'), 'gene-set', SAVED, { disabled: true });
    const saved1 = saveOf(first);
    assert.deepEqual(saved1, SAVED);

    // reload from what was saved (through JSON, as a stored set or a link does), and save again
    const reloaded = createPlaceholderPanel(new El('div'), 'gene-set', JSON.parse(JSON.stringify(saved1)), { disabled: true });
    reloaded.init();
    const saved2 = saveOf(reloaded);
    assert.deepEqual(saved2, SAVED);
    assert.equal(JSON.stringify(saved2), JSON.stringify(saved1), 'byte for byte');

    // the placeholder's own copy cannot be changed from outside
    const out = reloaded.getConfig();
    out.sections.links.visible = true;
    assert.equal(reloaded.getConfig().sections.links.visible, false);

    // enabled again: the real constructor gets exactly the saved config
    let given = null;
    class FakePanel { constructor(container, config) { given = config; } }
    const type = 'gene-set';
    const policyOf = (enabled) => ({ panelEnabled: (t) => !(t === type && !enabled) });
    const build = (p, cfg) => (p.panelEnabled(type) ? new FakePanel(new El('div'), cfg) : createPlaceholderPanel(new El('div'), type, cfg, { disabled: true }));
    assert.equal(build(policyOf(false), saved2).isPlaceholder, true);
    assert.ok(build(policyOf(true), saved2) instanceof FakePanel);
    assert.deepEqual(given, SAVED);
});

test('a title change on a placeholder is saved with it', () => {
    const panel = createPlaceholderPanel(new El('div'), 'gene-set', SAVED, { disabled: true });
    panel.setTitle('Renamed');
    assert.equal(panel.getConfig().title, 'Renamed');
    assert.deepEqual({ ...panel.getConfig(), title: SAVED.title }, SAVED);
});
