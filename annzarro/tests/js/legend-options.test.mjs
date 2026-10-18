/**
 * Legend options of a categorical colouring: the dots' size, the number of columns, the title.
 *
 * Run:  node --test annzarro/tests/js/legend-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    legendDotSize, proxyMarkerSize, legendColumns, legendOrientation, legendTitleText, columnEntryWidth, legendMaxWidth,
    legendOptionsIntoLayout, legendOptionKeys, DOT_SIZE_MAX
} from '../../../static/js/utils/legend-options.js';
import { normalizePlotOptions, pickStyle, adoptStyle, defaultLook } from '../../../static/js/panels/plot-utilities/plot-options.js';
import { legendPlacement } from '../../../static/js/panels/plot-utilities/plot-aesthetics-menu.js';

const colour = { type: 'obs', key: 'cell_type', column: '' };

test('unset, the legend is the constant one it always was', () => {
    const s = normalizePlotOptions({ pointSize: 3, color: colour });
    assert.equal(legendDotSize(s), null);
    assert.equal(proxyMarkerSize(s), 12);       // what a constant legend draws, whatever the point size
    assert.equal(legendColumns(s), 1);
    assert.equal(legendOrientation('v', s), 'v');
    assert.equal(legendTitleText(s), 'cell_type');
    assert.deepEqual(legendOptionKeys(s), { 'legend.itemsizing': 'constant', 'legend.title.text': 'cell_type', 'meta.azLegendColumns': 1 });
});

test('a dot size is clamped to what Plotly draws and gives the proxies that size', () => {
    assert.equal(legendDotSize({ legendDotSize: 8 }), 8);
    assert.equal(legendDotSize({ legendDotSize: 40 }), DOT_SIZE_MAX);
    assert.equal(legendDotSize({ legendDotSize: 0 }), 2);
    assert.equal(legendDotSize({ legendDotSize: 'big' }), null);
    assert.equal(proxyMarkerSize({ legendDotSize: 8, pointSize: 3 }), 8);
    assert.equal(legendOptionKeys({ legendDotSize: 8, color: colour })['legend.itemsizing'], 'trace');
});

test('several columns make the legend horizontal, one keeps the position\'s orientation', () => {
    assert.equal(legendColumns({ legendColumns: 3 }), 3);
    assert.equal(legendColumns({ legendColumns: 1 }), 1);
    assert.equal(legendColumns({ legendColumns: 99 }), 8);
    assert.equal(legendOrientation('v', { legendColumns: 2 }), 'h');
    assert.equal(legendOrientation('h', { legendColumns: 1 }), 'h');
    const place = legendPlacement([{ showlegend: true, name: 'a' }], { legendOrientation: 'v', legendX: 1.05, legendY: 0.5,
        legendXanchor: 'left', legendYanchor: 'middle' }, { legendColumns: 2 });
    assert.equal(place['legend.orientation'], 'h');
    assert.equal(place['legend.x'], 1.05);
});

test('the title can be switched off', () => {
    assert.equal(legendTitleText({ color: colour, showLegendTitle: false }), '');
    assert.equal(legendTitleText({ color: colour, showLegendTitle: true }), 'cell_type');
});

test('the entry width fits N columns and not N + 1, and never cuts a label', () => {
    const A = (w, itemwidth = 30) => w + itemwidth + 15;               // what an entry advances by
    for (const [columns, maxWidth, textWidth] of [[2, 500, 60], [3, 500, 60], [4, 780, 90], [2, 300, 20]]) {
        const w = columnEntryWidth({ columns, maxWidth, textWidth });
        assert.ok(columns * A(w) <= maxWidth, `${columns} columns fit in ${maxWidth}`);
        assert.ok((columns + 1) * A(w) > maxWidth, `${columns + 1} do not`);
        assert.ok(w >= textWidth);
    }
    // a label too long for the columns wins: fewer columns
    assert.equal(columnEntryWidth({ columns: 4, maxWidth: 400, textWidth: 200 }), 200);
    assert.equal(columnEntryWidth({ columns: 2, maxWidth: 500, textWidth: 60, itemwidth: 50 }), Math.ceil(500 / 2.5 - 65));
});

test('a legend beside the plot wraps at half the graph, else at the plot', () => {
    assert.equal(legendMaxWidth({ legend: { x: 1.05 }, width: 1000, _size: { w: 700 } }), 500);
    assert.equal(legendMaxWidth({ legend: { x: -0.05 }, width: 1000, _size: { w: 700 } }), 500);
    assert.equal(legendMaxWidth({ legend: { x: 0.5 }, width: 1000, _size: { w: 700 } }), 700);
});

test('a layout carries the options; unset it is the constant legend', () => {
    const layout = { legend: { orientation: 'v', x: 1.05 } };
    legendOptionsIntoLayout(layout, { color: colour, legendDotSize: 10, legendColumns: 2, showLegendTitle: false });
    assert.equal(layout.legend.itemsizing, 'trace');
    assert.equal(layout.legend.orientation, 'h');
    assert.equal(layout.legend.title.text, '');
    assert.equal(layout.meta.azLegendColumns, 2);
    const plain = legendOptionsIntoLayout({ legend: { orientation: 'v' } }, { color: colour });
    assert.equal(plain.legend.itemsizing, 'constant');
    assert.equal(plain.legend.orientation, 'v');
    assert.equal(plain.legend.title.text, 'cell_type');
});

test('the options are normalised, copied with the look and reset by the default preset', () => {
    const s = normalizePlotOptions({ legendDotSize: 99, legendColumns: 1, showLegendTitle: 'no' });
    assert.equal(s.legendDotSize, DOT_SIZE_MAX);
    assert.equal(s.legendColumns, null);
    assert.equal(s.showLegendTitle, true);
    const target = adoptStyle({}, pickStyle({ legendDotSize: 7, legendColumns: 3, showLegendTitle: false }));
    assert.deepEqual([target.legendDotSize, target.legendColumns, target.showLegendTitle], [7, 3, false]);
    const look = defaultLook();
    assert.deepEqual([look.legendDotSize, look.legendColumns, look.showLegendTitle], [null, null, true]);
});
