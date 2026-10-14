/**
 * Plot Options as functions of a panel's settings (static/js/panels/plot-utilities/plot-options.js):
 * defaults for links that predate them, ticks, colour bar, scale bar, presets, copying.
 *
 * Run:  node --test annzarro/tests/js/plot-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizePlotOptions, OPTION_DEFAULTS, DEFAULT_MARGINS, tickMarksOn, tickKeys, axisPaths,
    colorbarPosition, colorbarExtras, linkedMargins, niceLength, formatLength, scaleBar, scaleBarActive,
    replaceScaleBar, SCALE_BAR, presetChanges, applyPreset, pickStyle, adoptStyle, STYLE_KEYS
} from '../../../static/js/panels/plot-utilities/plot-options.js';

const roundTrip = (o) => JSON.parse(JSON.stringify(o));

test('a config from before these options gets the defaults', () => {
    const old = roundTrip({ showGrid: true, margins: { l: 80, r: 80, t: 80, b: 60, pad: 4 }, legendPosition: 'right' });
    const s = normalizePlotOptions(old);
    for (const [k, v] of Object.entries(OPTION_DEFAULTS)) assert.deepEqual(s[k], v, k);
    assert.equal(s.showTickMarks, undefined);
});

test('options survive a link: JSON out and back, then normalised, unchanged', () => {
    const set = normalizePlotOptions({ tickCount: 6, showTickMarks: false, marginsUnlinked: true,
        margins: { l: 10, r: 20, t: 30, b: 40, pad: 4 }, colorbarPosition: 'bottom', colorbarLength: 0.5, colorbarTicks: 4,
        showScaleBar: true, scaleBarCorner: 'top-left', scaleBarUnitsPerCoord: 0.65, scaleBarUnit: 'µm' });
    const back = normalizePlotOptions(roundTrip(set));
    assert.deepEqual(back, set);
});

test('values that cannot be used fall back', () => {
    const s = normalizePlotOptions({ tickCount: 1, colorbarLength: 5, colorbarPosition: 'middle', scaleBarCorner: 'centre',
        scaleBarUnitsPerCoord: -2, scaleBarUnit: '  ', colorbarTicks: 'many', showTickMarks: 'yes' });
    assert.equal(s.tickCount, null);
    assert.equal(s.colorbarLength, 1);
    assert.equal(s.colorbarPosition, 'legend');
    assert.equal(s.scaleBarCorner, 'bottom-right');
    assert.equal(s.scaleBarUnitsPerCoord, 1);
    assert.equal(s.scaleBarUnit, 'units');
    assert.equal(s.colorbarTicks, null);
    assert.equal(s.showTickMarks, undefined);
});

test('panels do not share one margins object', () => {
    const a = normalizePlotOptions({}), b = normalizePlotOptions({});
    a.margins.t = 5;
    assert.equal(b.margins.t, DEFAULT_MARGINS.t);
});

test('tick marks follow the tick labels until set on their own', () => {
    assert.equal(tickMarksOn({ showAxisLabels: false }), false);
    assert.equal(tickMarksOn({ showAxisLabels: false, showTickMarks: true }), true);
    assert.equal(tickMarksOn({ showAxisLabels: true, showTickMarks: false }), false);
    assert.equal(tickMarksOn({}), true);
});

test('tick keys: marks, labels and count per axis; 2D and 3D axes', () => {
    assert.deepEqual(tickKeys({ showAxisLabels: true, showTickMarks: false, tickCount: 6 }, axisPaths({})), {
        'xaxis.ticks': '', 'xaxis.showticklabels': true, 'xaxis.nticks': 6,
        'yaxis.ticks': '', 'yaxis.showticklabels': true, 'yaxis.nticks': 6 });
    const keys = tickKeys({ showAxisLabels: false, tickCount: null }, axisPaths({ z: { type: 'obsm' } }));
    assert.equal(Object.keys(keys).length, 9);
    assert.equal(keys['scene.zaxis.nticks'], 0);
    assert.equal(keys['scene.xaxis.showticklabels'], false);
});

test('colour bar: own position or the legend\'s; length and tick count', () => {
    assert.equal(colorbarPosition({ legendPosition: 'left' }), 'left');
    assert.equal(colorbarPosition({ legendPosition: 'left', colorbarPosition: 'legend' }), 'left');
    assert.equal(colorbarPosition({ legendPosition: 'left', colorbarPosition: 'bottom' }), 'bottom');
    assert.equal(colorbarPosition({}), 'right');
    assert.deepEqual(colorbarExtras({ colorbarLength: 0.5, colorbarTicks: 4 }), { len: 0.5, lenmode: 'fraction', nticks: 4 });
    assert.deepEqual(colorbarExtras({ colorbarTicks: null }), { len: 1, lenmode: 'fraction' });
});

test('one margin value sets all four sides and keeps the padding', () => {
    assert.deepEqual(linkedMargins({ margins: { l: 1, r: 2, t: 3, b: 4, pad: 7 } }, 55.4), { l: 55, r: 55, t: 55, b: 55, pad: 7 });
    assert.equal(linkedMargins({ margins: {} }, 999).t, 200);
    assert.equal(linkedMargins({ margins: {} }, -3).l, 0);
});

test('niceLength: 1, 2 or 5 times a power of ten, the nearest', () => {
    const cases = [[1, 1], [1.4, 1], [1.5, 2], [3.1, 2], [3.2, 5], [7, 5], [8, 10], [95, 100], [0.23, 0.2], [0.0069, 0.005], [1234, 1000], [26000, 20000]];
    for (const [t, want] of cases) assert.equal(niceLength(t), want, `target ${t}`);
    assert.equal(niceLength(0), 1);
    assert.equal(niceLength(NaN), 1);
});

test('formatLength has no floating point noise', () => {
    assert.equal(formatLength(0.1 + 0.2), '0.3');
    assert.equal(formatLength(0.5), '0.5');
    assert.equal(formatLength(100), '100');
    assert.equal(formatLength(5 * Math.pow(10, -3)), '0.005');
    assert.equal(formatLength(2e-7), '2e-7');
    assert.equal(formatLength(2e8), '2e8');
});

const SB = { showScaleBar: true, equalAspect: true, scaleBarUnitsPerCoord: 1, scaleBarUnit: 'µm', scaleBarCorner: 'bottom-right', textColor: '#111111' };

test('scale bar: about a fifth of the visible width, a round number, label with the unit', () => {
    const bar = scaleBar(SB, [0, 1000]);
    assert.equal(bar.length, 200);
    assert.equal(bar.label, '200 µm');
    const [shape] = bar.shapes;
    assert.equal(shape.name, SCALE_BAR);
    assert.equal(shape.x1 - shape.x0, 200);
    assert.equal(shape.y0, 0.05);
    assert.equal(bar.annotations[0].text, '200 µm');
});

test('scale bar: units per coordinate unit change the number and not the drawn length ratio', () => {
    const bar = scaleBar({ ...SB, scaleBarUnitsPerCoord: 0.5 }, [0, 1000]);       // 1000 coordinates are 500 µm: a fifth is 100 µm
    assert.equal(bar.length, 100);
    assert.equal(bar.shapes[0].x1 - bar.shapes[0].x0, 200);                      // 100 µm are 200 coordinates
});

test('scale bar: zooming in shortens it', () => {
    assert.equal(scaleBar(SB, [0, 1000]).length, 200);
    assert.equal(scaleBar(SB, [400, 500]).length, 20);
    assert.equal(scaleBar(SB, [400, 440]).length, 10);
});

test('scale bar: corners, and a reversed axis', () => {
    const at = (corner, range) => scaleBar({ ...SB, scaleBarCorner: corner }, range).shapes[0];
    const br = at('bottom-right', [0, 1000]);
    assert.equal(br.x1, 960);
    const bl = at('bottom-left', [0, 1000]);
    assert.equal(bl.x0, 40);
    const tr = at('top-right', [0, 1000]);
    assert.equal(tr.y0, 0.95);
    assert.equal(scaleBar({ ...SB, scaleBarCorner: 'top-left' }, [0, 1000]).annotations[0].yanchor, 'top');
    // reversed x: the bar still sits at the visual right, which is the range's second end
    const rev = at('bottom-right', [1000, 0]);
    assert.equal(rev.x1, 40);
    assert.equal(rev.x0, 240);
});

test('scale bar needs Equal aspect, a 2D plot and the switch', () => {
    assert.equal(scaleBar({ ...SB, equalAspect: false }, [0, 10]), null);
    assert.equal(scaleBar({ ...SB, z: { type: 'obsm' } }, [0, 10]), null);
    assert.equal(scaleBar({ ...SB, showScaleBar: false }, [0, 10]), null);
    assert.equal(scaleBar(SB, [5, 5]), null);
    assert.equal(scaleBar(SB, null), null);
    assert.equal(scaleBarActive({ ...SB, equalAspect: false }), false);
});

test('replaceScaleBar keeps other shapes and replaces its own', () => {
    const other = { name: 'x', type: 'rect' };
    const ours = scaleBar(SB, [0, 100]).shapes;
    const once = replaceScaleBar([other, { name: SCALE_BAR }], ours);
    assert.deepEqual(once, [other, ...ours]);
    assert.deepEqual(replaceScaleBar(once, []), [other]);
    assert.deepEqual(replaceScaleBar(undefined, []), []);
});

test('presets: default restores the look, publication is white, gridless, sparse and larger', () => {
    const s = normalizePlotOptions({ bgColor: '#000000', showGrid: false, fontSize: 20, tickCount: 9, showTickMarks: false,
        margins: { l: 1, r: 1, t: 1, b: 1, pad: 4 }, marginsUnlinked: true, showScaleBar: true, scaleBarUnit: 'µm',
        notInTableScale: 3, equalAspect: true });
    applyPreset(s, 'default');
    assert.equal(s.bgColor, '#ffffff');
    assert.equal(s.showGrid, true);
    assert.equal(s.fontSize, 12);
    assert.equal(s.tickCount, null);
    assert.equal('showTickMarks' in s, false);
    assert.deepEqual(s.margins, DEFAULT_MARGINS);
    assert.equal(s.marginsUnlinked, false);
    assert.equal(s.showScaleBar, false);
    assert.equal(s.scaleBarUnit, 'µm');           // the unit is data, not look
    assert.equal(s.notInTableScale, 3);
    assert.equal(s.equalAspect, true);

    applyPreset(s, 'publication');
    assert.equal(s.bgColor, '#ffffff');
    assert.equal(s.showGrid, false);
    assert.equal(s.tickCount, 5);
    assert.equal(s.showTickMarks, true);
    assert.ok(s.fontSize > 12);
    assert.equal(s.showScaleBar, true);           // configured (µm) and Equal aspect on
});

test('publication turns the scale bar on only when one is set up and Equal aspect is on', () => {
    const base = normalizePlotOptions({});
    assert.equal(presetChanges('publication', { ...base, equalAspect: true }).showScaleBar, false);
    assert.equal(presetChanges('publication', { ...base, scaleBarUnit: 'µm', equalAspect: false }).showScaleBar, false);
    assert.equal(presetChanges('publication', { ...base, scaleBarUnit: 'µm', equalAspect: true }).showScaleBar, true);
    assert.equal(presetChanges('publication', { ...base, scaleBarUnitsPerCoord: 0.5, equalAspect: true }).showScaleBar, true);
    assert.deepEqual(presetChanges('nope', base), {});
});

test('copying styling takes the look and none of the data choices', () => {
    const src = normalizePlotOptions({ bgColor: '#101010', fontSize: 18, showGrid: false, tickCount: 7, showScaleBar: true,
        color: { type: 'obs', key: 'cell_type' }, x: { type: 'obsm', key: 'X_umap', column: '0' }, subsettedCells: ['a'],
        tableFilter: 't1', pointSize: 9, equalAspect: true, margins: { l: 1, r: 2, t: 3, b: 4, pad: 4 }, notInTableColor: '#ff0000' });
    const style = pickStyle(src);
    for (const k of Object.keys(style)) assert.ok(STYLE_KEYS.includes(k), k);
    for (const k of ['color', 'x', 'y', 'z', 'subsettedCells', 'tableFilter', 'pointSize', 'equalAspect', 'id', 'title']) {
        assert.equal(k in style, false, k);
    }
    const dst = normalizePlotOptions({ color: { type: 'obs', key: 'other' }, tableFilter: 't2', pointSize: 3, notInTableOpacity: 0.2, showTickMarks: true });
    adoptStyle(dst, roundTrip(style));
    assert.equal(dst.bgColor, '#101010');
    assert.equal(dst.fontSize, 18);
    assert.equal(dst.showGrid, false);
    assert.equal(dst.tickCount, 7);
    assert.equal(dst.notInTableColor, '#ff0000');
    assert.equal('notInTableOpacity' in dst, false);    // unset on the source: unset here
    assert.equal('showTickMarks' in dst, false);
    assert.deepEqual(dst.margins, { l: 1, r: 2, t: 3, b: 4, pad: 4 });
    assert.notEqual(dst.margins, src.margins);          // a copy
    assert.deepEqual(dst.color, { type: 'obs', key: 'other' });
    assert.equal(dst.tableFilter, 't2');
    assert.equal(dst.pointSize, 3);
});
