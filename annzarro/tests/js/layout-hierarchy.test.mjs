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

function el(cls, { dataset = {}, children = [], style = { getPropertyValue: () => '' } } = {}) {
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
        // every descendant, as the DOM does: a split nested in a pane must
        // not be mistaken for more panes of this one
        querySelectorAll(sel) {
            const out = [];
            for (const c of children) {
                if (sel === '.split-pane' && c.classList.contains('split-pane')) out.push(c);
                out.push(...c.querySelectorAll(sel));
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

const split = (direction, a, b, pct = ['50', '50']) => el(`split-container split-${direction}`, {
    dataset: { splitDirection: direction },
    children: [
        el('split-pane', { dataset: { flexPercentage: pct[0] }, children: [a] }),
        el('split-handle'),
        el('split-pane', { dataset: { flexPercentage: pct[1] }, children: [b] })
    ]
});

// Reproduced headless on 9ea6673: cell plot, split horizontally, split the
// left half vertically, Share Link. The hierarchy was
// [{type: 'split', direction: 'horizontal', children: []}, {type: 'selector'}]:
// the outer split found four .split-pane descendants, failed its two-pane
// check and kept no children, so the opened link showed an empty layout.
test('a split nested in a split keeps both levels, in order, with their sizes', () => {
    const inner = split('vertical', tile('cell-plot-1'), tile('gene-plot-3'), ['65', '35']);
    const outer = split('horizontal', inner, tile('cell-table-2'), ['40', '60']);
    const node = LayoutManager.buildLayoutHierarchy(outer);
    assert.equal(node.direction, 'horizontal');
    assert.deepEqual(node.panes.map(p => p.percentage), [40, 60]);
    assert.equal(node.children.length, 2);
    assert.equal(node.children[0].type, 'split');
    assert.equal(node.children[0].direction, 'vertical');
    assert.deepEqual(node.children[0].panes.map(p => p.percentage), [65, 35]);
    assert.deepEqual(node.children[0].children.map(c => c.id), ['cell-plot-1', 'gene-plot-3']);
    assert.equal(node.children[1].id, 'cell-table-2');
});

test('three levels, nested in the second pane, survive', () => {
    const deepest = split('horizontal', tile('gene-plot-3'), tile('cell-plot-4'));
    const middle = split('vertical', tile('cell-table-2'), deepest);
    const node = LayoutManager.buildLayoutHierarchy(split('horizontal', tile('cell-plot-1'), middle));
    assert.equal(node.children[0].id, 'cell-plot-1');
    assert.equal(node.children[1].children[0].id, 'cell-table-2');
    assert.deepEqual(node.children[1].children[1].children.map(c => c.id), ['gene-plot-3', 'cell-plot-4']);
});

test('childPanes returns only a split\'s own two panes', () => {
    const inner = split('vertical', tile('cell-plot-1'), tile('gene-plot-3'));
    const outer = split('horizontal', inner, tile('cell-table-2'));
    assert.equal(outer.querySelectorAll('.split-pane').length, 4);
    const panes = LayoutManager.childPanes(outer);
    assert.equal(panes.length, 2);
    assert.equal(panes[0].children[0], inner);
});

// A restore wraps each top-level node in a .panel-wrapper of this height, as
// the bottom chooser does; without it restored panels shrank with the chooser.
test('a wrapped panel keeps its row height; without one there is none', () => {
    const sized = el('panel-wrapper', { dataset: { panelWrapper: 'true' }, style: { getPropertyValue: () => '640px' },
                                        children: [split('vertical', tile('cell-plot-1'), tile('gene-plot-2'))] });
    assert.equal(LayoutManager.buildLayoutHierarchy(sized).height, 640);
    const unsized = el('panel-wrapper', { dataset: { panelWrapper: 'true' }, children: [tile('cell-plot-1')] });
    assert.equal('height' in LayoutManager.buildLayoutHierarchy(unsized), false);
});
