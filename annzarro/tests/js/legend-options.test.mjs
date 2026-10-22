/**
 * Legend options of a categorical colouring: the dots' size, the number of columns, the title.
 *
 * Run:  node --test annzarro/tests/js/legend-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    legendDotSize, proxyMarkerSize, legendColumns, legendOrientation, legendTitleText, titleIndent, LABEL_INDENT, columnSizes, assignColumns,
    legendOptionsIntoLayout, legendOptionKeys, DOT_SIZE_MAX
} from '../../../static/js/utils/legend-options.js';
import { legendKey } from '../../../static/js/utils/legend-entries.js';
import { normalizePlotOptions, pickStyle, adoptStyle, defaultLook } from '../../../static/js/panels/plot-utilities/plot-options.js';
import { legendPlacement } from '../../../static/js/panels/plot-utilities/plot-aesthetics-menu.js';

const colour = { type: 'obs', key: 'cell_type', column: '' };

test('unset, the legend is the constant one it always was', () => {
    const s = normalizePlotOptions({ pointSize: 3, color: colour });
    assert.equal(legendDotSize(s), null);
    assert.equal(proxyMarkerSize(s), 12);       // what a constant legend draws, whatever the point size
    assert.equal(legendColumns(s), 1);
    assert.equal(legendOrientation('v', s), 'v');
    assert.equal(legendTitleText(s).replace(/^\u00a0+|<br>\u00a0$/g, ''), 'cell_type');
    assert.deepEqual(legendOptionKeys(s), { 'legend.itemsizing': 'constant', 'legend.title.text': legendTitleText(s), 'legend.title.side': 'top', 'legend.title.font.size': 14, 'legend.traceorder': null, 'legend.groupclick': null, 'meta.azLegendColumns': 1 });
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
    assert.equal(legendTitleText({ color: colour, showLegendTitle: true }).replace(/^\u00a0+|<br>\u00a0$/g, ''), 'cell_type');
});

const proxy = (name, rank) => ({ meta: 'az-legend', name, legendgroup: name, showlegend: true, ...(rank === undefined ? {} : { legendrank: rank }) });
const points = (name) => ({ meta: 'az-points', name, legendgroup: name, showlegend: false });

test('columns deal the entries as evenly as can be, the first columns longer', () => {
    assert.deepEqual(columnSizes(10, 3), [4, 3, 3]);
    assert.deepEqual(columnSizes(5, 4), [2, 1, 1, 1]);
    assert.deepEqual(columnSizes(2, 4), [1, 1]);              // never an empty column
    assert.deepEqual(columnSizes(6, 2), [3, 3]);
});

test('entries go to column groups in legend order, and keep their category', () => {
    const traces = [points('a'), points('b'), points('c'), points('d'), proxy('a'), proxy('b'), proxy('c'), proxy('d')];
    assert.equal(assignColumns(traces, 2), true);
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(t => t.legendgroup), ['azcol0', 'azcol0', 'azcol1', 'azcol1']);
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(legendKey), ['a', 'b', 'c', 'd']);   // the category, not the column
    assert.deepEqual(traces.filter(t => t.meta === 'az-points').map(t => t.legendgroup), ['a', 'b', 'c', 'd']);   // the points untouched
    assert.equal(assignColumns(traces, 2), false);            // already there
    assignColumns(traces, 3);                                 // another count regroups from the same categories
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(t => t.legendgroup), ['azcol0', 'azcol0', 'azcol1', 'azcol2']);
    assert.equal(assignColumns(traces, 1), true);             // one column: as it was
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(t => [t.legendgroup, t.azKey]), [['a'], ['b'], ['c'], ['d']].map(([g]) => [g, undefined]));
    assert.equal(assignColumns(traces, 1), false);
});

test('legend rank orders the entries before their position', () => {
    const traces = [proxy('x', 3), proxy('y', 1), proxy('z', 2)];
    assignColumns(traces, 3);
    assert.deepEqual(traces.map(t => t.legendgroup), ['azcol2', 'azcol0', 'azcol1']);
});

test('one column changes nothing', () => {
    const traces = [points('a'), proxy('a'), proxy('b')];
    const before = JSON.stringify(traces);
    assert.equal(assignColumns(traces, 1), false);
    assert.equal(JSON.stringify(traces), before);
});

test('a layout carries the options; unset it is the constant legend', () => {
    const layout = { legend: { orientation: 'v', x: 1.05 } };
    legendOptionsIntoLayout(layout, { color: colour, legendDotSize: 10, legendColumns: 2, showLegendTitle: false });
    assert.equal(layout.legend.itemsizing, 'trace');
    assert.equal(layout.legend.orientation, 'h');
    assert.equal(layout.legend.title.text, '');
    assert.equal(layout.legend.title.side, 'top');
    assert.equal(layout.legend.traceorder, 'grouped');
    assert.equal(layout.legend.groupclick, 'toggleitem');
    assert.equal(layout.meta.azLegendColumns, 2);
    const plain = legendOptionsIntoLayout({ legend: { orientation: 'v' } }, { color: colour });
    assert.equal(plain.legend.itemsizing, 'constant');
    assert.equal(plain.legend.orientation, 'v');
    assert.equal(plain.legend.title.text, legendTitleText({ color: colour }));
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

test('the title starts where the labels start, in any of the fonts, and leaves a line below it', () => {
    const px = (family, size) => titleIndent(family, size).length * size * ({ Courier: 0.6, 'Times New Roman': 0.25, Georgia: 0.241, Verdana: 0.352 }[family] ?? 0.278);
    for (const family of ['Arial', 'Times New Roman', 'Courier', 'Georgia', 'Verdana']) {
        for (const size of [10, 14, 18, 26]) assert.ok(Math.abs(px(family, size) - LABEL_INDENT) <= size * 0.35, `${family} ${size}: ${px(family, size)}`);
    }
    const text = legendTitleText({ color: colour, fontSize: 16, fontFamily: 'Arial, Helvetica, sans-serif' });
    assert.ok(text.endsWith('cell_type<br>\u00a0'));
    assert.equal(text.match(/^\u00a0*/)[0].length, titleIndent('Arial', 18).length);
    assert.equal(legendTitleText({ color: { type: 'none', key: '', column: '' } }), '');       // nothing to title
});

test('legend title: size is the setting or 2 px above the text, kept in range', async () => {
  const { legendTitleSize } = await import('../../../static/js/utils/legend-options.js');
  assert.equal(legendTitleSize({}), 14);
  assert.equal(legendTitleSize({ fontSize: 12 }), 14);
  assert.equal(legendTitleSize({ fontSize: 20 }), 22);
  assert.equal(legendTitleSize({ fontSize: 12, legendTitleSize: 30 }), 30);
  assert.equal(legendTitleSize({ legendTitleSize: 1 }), 6);
  assert.equal(legendTitleSize({ legendTitleSize: 500 }), 48);
});

test('legend title: a gap is lines of a small element font, so it is linear in px', async () => {
  const { titleGapPlan, legendTitleFontSize, legendTitleText, defaultTitleGap } = await import('../../../static/js/utils/legend-options.js');
  assert.equal(titleGapPlan({}), null);
  assert.equal(legendTitleFontSize({}), 14);                      // unset: the title's own size, as before
  assert.equal(defaultTitleGap({ fontSize: 12 }), 18);
  const s = { color: { type: 'obs', key: 'cell_type', column: '' } };
  assert.ok(legendTitleText(s).endsWith('<br>\u00a0'), 'default look unchanged');
  assert.deepEqual(titleGapPlan({ legendTitleGap: 0 }), { lines: 0, size: 14 });
  assert.ok(!legendTitleText({ ...s, legendTitleGap: 0 }).includes('<br>'));
  for (const gap of [1, 10, 20, 40, 80]) {
    const plan = titleGapPlan({ legendTitleGap: gap });
    assert.ok(plan.size <= 14 && plan.size >= 1, `${gap}: the first line must not move`);
    assert.ok(Math.abs(plan.lines * 1.3 * plan.size - gap) < 0.7 || plan.size === 1, `${gap} px: ${JSON.stringify(plan)}`);
    assert.equal(legendTitleFontSize({ legendTitleGap: gap }), plan.size);
  }
  assert.equal((legendTitleText({ ...s, legendTitleGap: 40 }).match(/<br>/g) || []).length, titleGapPlan({ legendTitleGap: 40 }).lines);
  assert.equal(titleGapPlan({ legendTitleGap: 999 }).lines >= 1, true);
});
