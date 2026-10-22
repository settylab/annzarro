/**
 * Legend options of a categorical colouring: the dots' size, the number of columns, the title.
 *
 * Run:  node --test annzarro/tests/js/legend-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    legendDotSize, proxyMarkerSize, legendColumns, legendOrientation, legendTitleText, LABEL_INDENT, legendTitleShift, columnSizes, assignColumns,
    legendOptionsIntoLayout, legendOptionKeys, DOT_SIZE_MAX, blankTitle, fitColumns, cutLabel, cutLabelAmong, placeColumns, legendColumnGap, legendIds,
    withLegendColumns, usedColumns, legendTitleAlign, titleSide
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
    assert.equal(legendTitleText(s).replace(/<span[^>]*>\u00a0<\/span>|^\u00a0+|<br>\u00a0$/g, ''), 'cell_type');
    assert.deepEqual(legendOptionKeys(s), { 'legend.itemsizing': 'constant', 'legend.title.text': legendTitleText(s), 'legend.title.side': 'top', 'meta.azTitleAlign': 'markers', 'meta.azTitleShift': 12, 'legend.title.font.size': 14, 'meta.azLegendColumns': 1, 'meta.azLegendGap': 24, 'meta.azLegendPosition': 'right' });
});

test('a dot size is clamped to what Plotly draws and gives the proxies that size', () => {
    assert.equal(legendDotSize({ legendDotSize: 8 }), 8);
    assert.equal(legendDotSize({ legendDotSize: 40 }), DOT_SIZE_MAX);
    assert.equal(legendDotSize({ legendDotSize: 0 }), 2);
    assert.equal(legendDotSize({ legendDotSize: 'big' }), null);
    assert.equal(proxyMarkerSize({ legendDotSize: 8, pointSize: 3 }), 8);
    assert.equal(legendOptionKeys({ legendDotSize: 8, color: colour })['legend.itemsizing'], 'trace');
});

test('several columns make each legend vertical, one keeps the position\'s orientation', () => {
    assert.equal(legendColumns({ legendColumns: 3 }), 3);
    assert.equal(legendColumns({ legendColumns: 1 }), 1);
    assert.equal(legendColumns({ legendColumns: 99 }), 8);
    assert.equal(legendOrientation('h', { legendColumns: 2 }), 'v');
    assert.equal(legendOrientation('h', { legendColumns: 1 }), 'h');
    const place = legendPlacement([{ showlegend: true, name: 'a' }], { legendOrientation: 'v', legendX: 1.05, legendY: 0.5,
        legendXanchor: 'left', legendYanchor: 'middle' }, { legendColumns: 2 });
    assert.equal(place['legend.orientation'], 'v');
    assert.equal(place['legend.x'], 1.05);
});

test('the title can be switched off', () => {
    assert.equal(legendTitleText({ color: colour, showLegendTitle: false }), '');
    assert.equal(legendTitleText({ color: colour, showLegendTitle: true }).replace(/<span[^>]*>\u00a0<\/span>|^\u00a0+|<br>\u00a0$/g, ''), 'cell_type');
});

const proxy = (name, rank) => ({ meta: 'az-legend', name, legendgroup: name, showlegend: true, ...(rank === undefined ? {} : { legendrank: rank }) });
const points = (name) => ({ meta: 'az-points', name, legendgroup: name, showlegend: false });

test('columns deal the entries in order, ceil(n / k) to a column', () => {
    assert.deepEqual(columnSizes(10, 3), [4, 4, 2]);
    assert.deepEqual(columnSizes(5, 4), [2, 2, 1]);           // never an empty column
    assert.deepEqual(columnSizes(2, 4), [1, 1]);
    assert.deepEqual(columnSizes(6, 2), [3, 3]);
    assert.deepEqual(columnSizes(7, 1), [7]);
});

test('entries and their points go to the legend of their column, keeping their legend group', () => {
    const traces = [points('a'), points('b'), points('c'), points('d'), proxy('a'), proxy('b'), proxy('c'), proxy('d')];
    assert.equal(assignColumns(traces, 2), true);
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(t => t.legend), ['legend', 'legend', 'legend2', 'legend2']);
    assert.deepEqual(traces.filter(t => t.meta === 'az-points').map(t => t.legend), ['legend', 'legend', 'legend2', 'legend2']);
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(legendKey), ['a', 'b', 'c', 'd']);   // the category is the group
    assert.deepEqual(traces.map(t => t.legendgroup), ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd']);
    assert.equal(assignColumns(traces, 2), false);            // already there
    assignColumns(traces, 3);                                 // ceil(4 / 3) = 2 to a column: two columns
    assert.deepEqual(traces.filter(t => t.meta === 'az-legend').map(t => t.legend), ['legend', 'legend', 'legend2', 'legend2']);
    assert.equal(usedColumns(traces, 3), 2);
    assert.equal(usedColumns([proxy('a'), proxy('b'), proxy('c')], 3), 3);
    assert.equal(assignColumns(traces, 1), true);             // one column: as it was
    assert.ok(traces.every(t => t.legend === undefined));
    assert.equal(assignColumns(traces, 1), false);
});

test('legend rank orders the entries before their position', () => {
    const traces = [proxy('x', 3), proxy('y', 1), proxy('z', 2)];
    assignColumns(traces, 3);
    assert.deepEqual(traces.map(t => t.legend), ['legend3', 'legend', 'legend2']);
});

test('one column changes nothing', () => {
    const traces = [points('a'), proxy('a'), proxy('b')];
    const before = JSON.stringify(traces);
    assert.equal(assignColumns(traces, 1), false);
    assert.equal(JSON.stringify(traces), before);
});

test('the title of the other columns is blank, of the same height', () => {
    const s = { color: colour, legendTitleGap: 10 };
    const text = legendTitleText(s);
    const blank = legendTitleText(s, true);
    assert.equal(blankTitle(text), blank);
    assert.equal((blank.match(/<br>/g) || []).length, (text.match(/<br>/g) || []).length);
    assert.ok(!blank.includes('cell_type'));
    assert.equal(blankTitle(''), '');
    assert.equal(blankTitle(legendTitleText({ color: colour })), legendTitleText({ color: colour }, true));
});

test('columns that fit are left alone, wider ones are squeezed and then cut', () => {
    assert.deepEqual(fitColumns([100, 120], 24, 400), { gap: 24, limits: null });
    assert.deepEqual(fitColumns([200, 200], 24, 410), { gap: 8, limits: null });          // the gap gives way first
    const fit = fitColumns([100, 500, 500], 24, 600);
    assert.equal(fit.gap, 8);
    assert.equal(fit.limits[0], 100);                                                    // a narrow column keeps its width
    assert.ok(Math.abs(fit.limits[1] + fit.limits[2] + 100 + 16 - 600) < 0.01, JSON.stringify(fit));
    const measure = (t) => t.length * 10;
    assert.equal(cutLabel('short', 100, measure), 'short');
    const cut = cutLabel('a very long label indeed', 100, measure);
    assert.ok(cut.endsWith('\u2026') && measure(cut) <= 100 && cut.length > 3, cut);
});

test('a cut label keeps what tells it from the others', () => {
    const measure = (t) => t.length * 10;
    const all = ['Haematopoietic lineage 00 progenitor', 'Haematopoietic lineage 01 progenitor', 'Haematopoietic lineage 13 progenitor'];
    const cut = all.map(l => cutLabelAmong(l, 200, measure, all));
    assert.ok(cut.every(c => measure(c) <= 200 && /\d\d/.test(c)), cut.join('|'));
    assert.equal(new Set(cut).size, 3);
    assert.equal(cutLabelAmong(all[0], 400, measure, all), all[0]);
    const tiny = all.map(l => cutLabelAmong(l, 90, measure, all));
    assert.ok(tiny.every(c => measure(c) <= 90 && /\d\d/.test(c)) && new Set(tiny).size === 3, tiny.join('|'));
    assert.ok(cutLabelAmong('abcdefghijklmnop', 80, measure, ['abcdefghijklmnop']).includes('\u2026'));
});

test('columns sit side by side to the right of the plot, in order, never overlapping', () => {
    const W = 1000, m = { l: 80, r: 80 };
    const p = placeColumns({ position: 'right', widths: [150, 200, 90], gap: 24, width: W, margins: m, base: m });
    const plotW = W - m.l - p.margin.r;
    const lefts = p.legends.map(l => m.l + (l.x) * plotW);               // px from the graph's left edge
    assert.ok(lefts[1] >= lefts[0] + 150 + 24 - 0.1 && lefts[2] >= lefts[1] + 200 + 24 - 0.1, JSON.stringify(lefts));
    assert.ok(lefts[2] + 90 <= W, 'inside the graph');
    assert.ok(lefts[0] >= m.l + plotW, 'right of the plot');
    assert.ok(p.margin.r >= 150 + 200 + 90 + 48, 'the plot leaves room for them');
    assert.ok(p.legends.every(l => l.xanchor === 'left'));
    const wide = placeColumns({ position: 'right', widths: [10], gap: 24, width: W, margins: m, base: m });
    assert.equal(wide.margin.r, 80);                                                    // the margin set stays when it holds them
    const left = placeColumns({ position: 'left', widths: [100, 100], gap: 20, width: W, margins: m, base: m });
    assert.ok(left.legends.every(l => l.xanchor === 'right' && l.x < 0) && left.legends[0].x < left.legends[1].x);
    assert.ok(left.margin.l >= 220 + 8 + 50 + 12);
    const bottom = placeColumns({ position: 'bottom', widths: [100, 100], gap: 20, width: W, margins: m, base: m });
    assert.deepEqual(bottom.legends.map(l => l.x), [0.369, 0.5119], 'centred under the plot');
    assert.equal(legendColumnGap({}), 24);
    assert.equal(legendColumnGap({ legendColumnGap: 0 }), 0);
    assert.equal(legendColumnGap({ legendColumnGap: 999 }), 80);
});

test('a drawn figure gets a legend for each column, the others titled blank', () => {
    const traces = [proxy('a'), proxy('b'), proxy('c')];
    const layout = { legend: { orientation: 'v', title: { text: legendTitleText({ color: colour }) } }, meta: { azLegendColumns: 2, azLegendPosition: 'right' } };
    withLegendColumns(traces, layout);
    assert.deepEqual(legendIds(layout), ['legend', 'legend2']);
    assert.equal(layout.legend2.title.text, legendTitleText({ color: colour }, true));
    assert.equal(layout.legend2.orientation, 'v');
    assert.equal(layout.legend.yanchor, 'top');
    const one = { legend: { orientation: 'v' }, legend2: { x: 1 }, meta: { azLegendColumns: 1 } };
    withLegendColumns([proxy('a')], one);
    assert.deepEqual(legendIds(one), ['legend']);
});

test('a layout carries the options; unset it is the constant legend', () => {
    const layout = { legend: { orientation: 'v', x: 1.05 } };
    legendOptionsIntoLayout(layout, { color: colour, legendDotSize: 10, legendColumns: 2, showLegendTitle: false });
    assert.equal(layout.legend.itemsizing, 'trace');
    assert.equal(layout.legend.orientation, 'v');
    assert.equal(layout.legend.title.text, '');
    assert.equal(layout.legend.title.side, 'top');
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

test('the title text is the name whatever the alignment; the shift is kept apart', () => {
    for (const align of [undefined, 'markers', 'labels', 'centre', 'right']) {
        for (const legendTitleGap of [undefined, 0, 10]) {
            const text = legendTitleText({ color: colour, fontSize: 16, legendTitleAlign: align, legendTitleGap });
            const bare = text.replace(/<\/?span[^>]*>|<br>|\u00a0/g, '');
            assert.equal(bare, 'cell_type', `${align} ${legendTitleGap}: only the name, the line breaks and spacing: ${text}`);
            if (legendTitleGap === undefined) assert.equal(text, 'cell_type<br>\u00a0', 'the default title is the name and a blank line');
        }
    }
    assert.equal(legendTitleShift({ legendTitleAlign: 'markers' }), 12);                // 18 - 12 / 2
    assert.equal(legendTitleShift({ legendTitleAlign: 'markers', legendDotSize: 16 }), 10);
    assert.equal(legendTitleShift({ legendTitleAlign: 'labels' }), LABEL_INDENT);
    assert.equal(legendTitleShift({ legendTitleAlign: 'centre' }), 0);
    assert.equal(legendTitleShift({ legendPosition: 'top' }), 0);                       // auto: centre
    assert.equal(legendTitleShift({ legendPosition: 'right' }), 12);                    // auto: markers
    assert.equal(legendOptionKeys({ color: colour })['meta.azTitleShift'], 12);
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

test('legend title: a gap is lines of a small element font, with room above so the text is not cut', async () => {
  const { titleGapPlan, legendTitleFontSize, legendTitleText, defaultTitleGap } = await import('../../../static/js/utils/legend-options.js');
  assert.equal(titleGapPlan({}), null);
  assert.equal(legendTitleFontSize({}), 14);                      // unset: the title's own size, as before
  assert.equal(defaultTitleGap({ fontSize: 12 }), 18);
  const s = { color: { type: 'obs', key: 'cell_type', column: '' } };
  assert.ok(legendTitleText(s).endsWith('<br>\u00a0'), 'default look unchanged');
  assert.deepEqual(titleGapPlan({ legendTitleGap: 0 }), { lead: 0, lines: 0, size: 14 });
  assert.ok(!legendTitleText({ ...s, legendTitleGap: 0 }).includes('<br>'));
  for (const gap of [1, 2, 3, 10, 20, 40, 80]) {
    const plan = titleGapPlan({ legendTitleGap: gap });
    assert.ok(plan.size <= 14 && plan.size >= 1, `${gap}: Plotly takes no font under 1 px`);
    assert.ok(Math.abs(plan.lines * 1.3 * plan.size - gap) < 0.7 || plan.size === 1, `${gap} px: ${JSON.stringify(plan)}`);
    assert.equal(legendTitleFontSize({ legendTitleGap: gap }), plan.size);
    // the room above the text that a small element font takes away: 1.3 (S - P) - 0.3 S + 3 px
    const room = 1.3 * (14 - plan.size) - 0.3 * 14 + 3;
    assert.ok(plan.lead * 1.3 * plan.size >= room - 0.01, `${gap} px: lead ${plan.lead} gives ${plan.lead * 1.3 * plan.size} for ${room}`);
    const text = legendTitleText({ ...s, legendTitleGap: gap });
    assert.equal((text.match(/<br>/g) || []).length, plan.lead + plan.lines);
    assert.ok(text.startsWith('\u00a0<br>'.repeat(plan.lead)));
  }
  assert.equal(titleGapPlan({ legendTitleGap: 999 }).lines >= 1, true);
});

test('title alignment follows the legend position unless it is set', () => {
    assert.equal(legendTitleAlign({}), 'markers');
    assert.equal(legendTitleAlign({ legendPosition: 'right' }), 'markers');
    assert.equal(legendTitleAlign({ legendPosition: 'top' }), 'centre');
    assert.equal(legendTitleAlign({ legendPosition: 'bottom' }), 'centre');
    assert.equal(legendTitleAlign({ legendPosition: 'top', legendTitleAlign: 'labels' }), 'labels');
    assert.equal(legendTitleAlign({ legendTitleAlign: 'nonsense', legendPosition: 'left' }), 'markers');
    assert.equal(titleSide('centre'), 'top center');
    assert.equal(titleSide('right'), 'top right');
    assert.equal(titleSide('markers'), 'top');
    const text = (a) => legendTitleText({ color: colour, legendTitleAlign: a });
    assert.ok(!text('centre').startsWith('\u00a0') && !text('right').startsWith('\u00a0'));
});
