/**
 * A panel created from a selection tile is part of the saved layout.
 *
 * Reproduced headless on c7f24f9: open bm_aging.zarr, click "Cell Plot" on
 * the welcome screen, Share Link: the link's layout.hierarchy was
 * [{type: 'selector'}] (panelConfigs did hold the plot), so the opened link
 * showed the welcome screen. Such panels live in a .panel-wrapper, which the
 * layout walk did not know. After the fix the hierarchy holds the tile (or
 * the split it was turned into) and the reopened link shows the panels.
 *
 * Run:  node --test annzarro/tests/js/layout-hierarchy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};

function el(cls, { dataset = {}, children = [], style = {} } = {}) {
    const classes = new Set(cls.split(' '));
    const node = {
        dataset, children, style,
        classList: { contains: c => classes.has(c) },
        querySelector(sel) {
            for (const c of children) {
                if (sel === '.plot-controls' && c.classList.contains('plot-controls')) return c;
                const hit = c.querySelector(sel);
                if (hit) return hit;
            }
            return null;
        },
        querySelectorAll(sel) {
            const out = [];
            for (const c of children) {
                if (sel === '.split-pane' && c.classList.contains('split-pane')) out.push(c);
            }
            return out;
        }
    };
    return node;
}

const { LayoutManager } = await import('../../../static/js/layout-manager.js');
const tile = (id) => el('tile', { dataset: { tileId: id }, children: [el('tile', { dataset: { tileId: id } })] });

test('a panel in a .panel-wrapper is saved as its tile', () => {
    const wrapper = el('panel-wrapper', { dataset: { panelWrapper: 'true', wrapperId: 'cell-plot-1' }, children: [tile('cell-plot-1')] });
    const node = LayoutManager.buildLayoutHierarchy(wrapper);
    assert.equal(node.type, 'tile');
    assert.equal(node.id, 'cell-plot-1');
});

test('a wrapped panel that was split is saved as the split', () => {
    const split = el('split-container split-horizontal', {
        dataset: { splitDirection: 'horizontal' },
        children: [
            el('split-pane', { dataset: { flexPercentage: '50' }, children: [tile('cell-plot-1')] }),
            el('split-handle'),
            el('split-pane', { dataset: { flexPercentage: '50' }, children: [tile('gene-plot-2')] })
        ]
    });
    const wrapper = el('panel-wrapper', { dataset: { panelWrapper: 'true' }, children: [split] });
    const node = LayoutManager.buildLayoutHierarchy(wrapper);
    assert.equal(node.type, 'split');
    assert.deepEqual(node.children.map(c => c.id), ['cell-plot-1', 'gene-plot-2']);
});

test('an empty wrapper and a handle are skipped', () => {
    assert.equal(LayoutManager.buildLayoutHierarchy(el('panel-wrapper', { dataset: { panelWrapper: 'true' } })), null);
    assert.equal(LayoutManager.buildLayoutHierarchy(el('split-handle horizontal')), null);
});
