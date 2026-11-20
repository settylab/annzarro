/**
 * F7: the panel types of 0.8.0 are registered but unreleased.
 *
 *   - panel-types.json lists cell-grouping, cell-gene and cell-count with "released": false, in the order and with
 *     the labels and icons of UX 6.2; gene-count and group-stat are reserved entries that are never registered.
 *   - Config.PANEL_TYPES (the chooser, the icons) holds released types only; panelTypeInfo still names an unreleased
 *     one, so its default title is "Cell-Gene Plot 1".
 *   - A reserved id is skipped without an error (PER-7).
 *   - The default list of enabled types (config.js, base.yaml, schema.yaml) is exactly the released set, so flipping
 *     "released" cannot leave a type out of the chooser.
 *
 * Run:  node --test annzarro/tests/js/panel-types-unreleased.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });
const { Config } = await import('../../../static/js/config.js');
const { createPlaceholderPanel } = await import('../../../static/js/utils/placeholder-panel.js');

const REGISTRY = JSON.parse(readFileSync(new URL('../../../static/js/panels/panel-types.json', import.meta.url), 'utf8'));
const entry = (type) => REGISTRY.find(e => e.type === type);

test('the three new types follow Gene Signature, in the order of UX 6.2, unreleased', () => {
    const types = REGISTRY.map(e => e.type);
    assert.deepEqual(types.slice(5, 9), ['gene-signature', 'cell-grouping', 'cell-gene', 'cell-count']);
    assert.deepEqual(
        ['cell-grouping', 'cell-gene', 'cell-count'].map(t => [entry(t).label, entry(t).icon, entry(t).released]),
        [['Cell Grouping', 'fas fa-object-group', false],
         ['Cell-Gene Plot', 'fas fa-braille', false],
         ['Cell Count Plot', 'fas fa-chart-column', false]]);
});

test('gene-count and group-stat are reserved entries with nothing to show', () => {
    for (const type of ['gene-count', 'group-stat']) {
        assert.equal(entry(type).reserved, true, type);
        assert.equal(entry(type).label, undefined, type);
    }
});

test('the chooser list holds released types only; the registry still names the others', () => {
    const released = REGISTRY.filter(e => !e.reserved && e.released !== false).map(e => e.type);
    assert.deepEqual(Config.PANEL_TYPES.map(p => p.type), released);
    assert.ok(!Config.PANEL_TYPES.some(p => ['cell-grouping', 'cell-gene', 'cell-count', 'gene-count', 'group-stat'].includes(p.type)));
    assert.equal(Config.panelTypeInfo('cell-gene').label, 'Cell-Gene Plot');
    assert.equal(Config.panelTypeInfo('cell-plot').label, 'Cell Plot');
    assert.equal(Config.panelTypeInfo('gene-count'), undefined);
    assert.equal(Config.panelTypeInfo('nothing-here'), undefined);
});

test('reserved ids are known as reserved, and only those', () => {
    assert.equal(Config.isReservedPanelType('gene-count'), true);
    assert.equal(Config.isReservedPanelType('group-stat'), true);
    assert.equal(Config.isReservedPanelType('cell-gene'), false);
    assert.equal(Config.isReservedPanelType('nothing-here'), false);
});

test('the default list of enabled types is the released set in config.js, base.yaml and schema.yaml', () => {
    const released = REGISTRY.filter(e => !e.reserved && e.released !== false).map(e => e.type);
    assert.deepEqual(Config.DEFAULTS.ENABLED_PANEL_TYPES, released);
    const list = (text, re) => re.exec(text)[1].split(/\n/).map(s => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    const base = readFileSync(new URL('../../config/base.yaml', import.meta.url), 'utf8');
    assert.deepEqual(list(base, /enabled_panel_types:\n((?:\s+- [a-z-]+\n)+)/), released);
    const schema = readFileSync(new URL('../../config/schema.yaml', import.meta.url), 'utf8');
    const flow = /enabled_panel_types:[\s\S]*?default: \[([^\]]*)\]/.exec(schema)[1].split(',').map(s => s.trim());
    assert.deepEqual(flow, released);
    const enumFlow = /enabled_panel_types:[\s\S]*?enum: \[([^\]]*)\]/.exec(schema)[1].split(',').map(s => s.trim());
    assert.deepEqual(enumFlow, released);
});

class El {
    constructor() { this.children = []; this.dataset = {}; this.className = ''; this.textContent = ''; }
    set innerHTML(v) { this.children = []; this.textContent = ''; }
    get innerHTML() { return ''; }
    append(...c) { this.children.push(...c); }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener() {}
}
globalThis.document = { createElement: () => new El() };

test('a placeholder names each new type by its label and keeps its settings', () => {
    for (const [type, label] of [['cell-grouping', 'Cell Grouping'], ['cell-gene', 'Cell-Gene Plot'], ['cell-count', 'Cell Count Plot']]) {
        const saved = { id: `${type}-1`, version: 1, extra: { kept: true } };
        const panel = createPlaceholderPanel(new El(), type, saved, {});
        assert.equal(panel.getTitle(), label);
        assert.deepEqual(panel.getConfig().extra, { kept: true });
    }
});
