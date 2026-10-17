/**
 * The focused marker's style (static/js/utils/focus-style.js): settings in,
 * Plotly marker, restyle keys and large-plot shape out.
 *
 * The defaults must draw exactly the highlight every plot had before the
 * Focused group existed: size twice the point size, opaque, red fill, a 2 px
 * black edge (and the ring of a cell outside the subset: red, 2 px). A link
 * or panel config without the keys gets them in the light theme; in the dark
 * theme the edge is white.
 *
 * Run:  node --test annzarro/tests/js/focus-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// the app theme is read from <html data-theme>
let theme = 'light';
globalThis.document = { documentElement: { getAttribute: (a) => (a === 'data-theme' ? theme : null) } };

import {
    FOCUS_DEFAULTS, NO_FILL, focusParams, focusSize, focusMarker, focusRestyle, focusShapeStyle
} from '../../../static/js/utils/focus-style.js';
import { PLOT_PALETTES, THEMED_COLOURS, followTheme, adoptColourModel } from '../../../static/js/utils/plot-theme.js';
import { STYLE_KEYS, pickStyle, adoptStyle, applyPreset } from '../../../static/js/panels/plot-utilities/plot-options.js';

// '#rrggbb' or 'rgba(r, g, b, 1)' as [r, g, b]: today's literals were rgba strings
const rgb = (c) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(c);
    if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/.exec(c);
    return m ? m.slice(1, 4).map(Number) : null;
};

// The marker plot-update.js built before this module, for a point size `p`
const EDGE = { light: 'rgba(0, 0, 0, 1)', dark: 'rgba(255, 255, 255, 1)' };
const TODAY = (p, name = 'light') => ({ size: p * 2, color: 'rgba(255, 0, 0, 1)', opacity: 1,
                                        line: { color: EDGE[name], width: 2 }, showscale: false });
const TODAY_RING = (p) => ({ size: p * 2, symbol: 'circle-open', color: 'rgba(255, 0, 0, 1)',
                             line: { color: 'rgba(255, 0, 0, 1)', width: 2 }, showscale: false });

const sameMarker = (got, want) => {
    assert.equal(got.size, want.size);
    assert.deepEqual(rgb(got.color), rgb(want.color));
    assert.equal(got.opacity ?? 1, want.opacity ?? 1);
    assert.deepEqual(rgb(got.line.color), rgb(want.line.color));
    assert.equal(got.line.width, want.line.width);
    assert.equal(got.symbol, want.symbol);
    assert.equal(got.showscale, false);
};

for (const name of ['light', 'dark']) {
    test(`a config without the keys draws today's highlight, ${name} theme`, () => {
        theme = name;
        for (const p of [0.392, 3, 5, 12]) {
            sameMarker(focusMarker({ pointSize: p }), TODAY(p, name));
            sameMarker(focusMarker({ pointSize: p }, true), TODAY_RING(p));
        }
        assert.equal(PLOT_PALETTES[name].focusedColor, '#ff0000');
        assert.equal(PLOT_PALETTES[name].focusedEdgeColor, name === 'dark' ? '#ffffff' : '#000000');
        theme = 'light';
    });
}

test("the large plot's shape keeps today's radius and colours", () => {
    // before: r = max(2, pointSize || 4), red fill, 2 px black line, opaque
    for (const p of [0.5, 1, 3, 5, 9]) {
        const s = focusShapeStyle({ pointSize: p });
        assert.equal(s.r, Math.max(2, p));
        assert.deepEqual(rgb(s.fillcolor), [255, 0, 0]);
        assert.deepEqual(s.line, { color: '#000000', width: 2 });
        assert.equal(s.opacity, 1);
    }
    assert.equal(focusShapeStyle({}).r, 4);
});

test('the panel values replace the defaults', () => {
    const s = { pointSize: 4, focusedScale: 3.5, focusedOpacity: 0.4, focusedEdgeWidth: 0,
                focusedColor: '#00ff00', focusedEdgeColor: '#ffffff' };
    assert.deepEqual(focusMarker(s), { size: 14, color: '#00ff00', opacity: 0.4,
                                       line: { color: '#ffffff', width: 0 }, showscale: false });
    assert.deepEqual(focusRestyle(s), { 'marker.size': 14, 'marker.color': '#00ff00', 'marker.opacity': 0.4,
                                        'marker.line.color': '#ffffff', 'marker.line.width': 0 });
    const ring = focusMarker(s, true);
    assert.equal(ring.color, '#00ff00');
    assert.equal(ring.line.color, '#00ff00');        // the ring is stroked in the fill colour
    assert.equal(ring.line.width, 1);                // never invisible
    assert.deepEqual(focusShapeStyle(s), { r: 7, opacity: 0.4, fillcolor: '#00ff00', line: { color: '#ffffff', width: 0 } });
});

test('values that cannot be drawn fall back to the defaults', () => {
    for (const bad of [0, -1, 51, NaN, '3', null, undefined]) {
        assert.equal(focusParams({ focusedScale: bad }).scale, FOCUS_DEFAULTS.scale, String(bad));
        assert.equal(focusParams({ focusedOpacity: bad }).opacity, FOCUS_DEFAULTS.opacity, String(bad));
    }
    for (const bad of [-0.5, 21, NaN, '1', null]) {
        assert.equal(focusParams({ focusedEdgeWidth: bad }).edgeWidth, FOCUS_DEFAULTS.edgeWidth, String(bad));
    }
    assert.equal(focusParams({ focusedOpacity: 1 }).opacity, 1);
    assert.equal(focusParams({ focusedScale: 50 }).scale, 50);
    assert.equal(focusSize({ focusedScale: 3 }), 0);           // no point size: nothing to scale
});

test('the colours follow the theme until set, and Reset follows it again', () => {
    assert.ok(THEMED_COLOURS.includes('focusedColor') && THEMED_COLOURS.includes('focusedEdgeColor'));
    const s = { pointSize: 5, focusedColor: '#123456' };
    assert.equal(focusMarker(s).color, '#123456');
    followTheme(s, ['focusedColor']);
    assert.equal('focusedColor' in s, false);
    assert.equal(focusMarker(s).color, PLOT_PALETTES.light.focusedColor);
    // a link from before the colour model: no keys, nothing pinned
    const old = { pointSize: 5, bgColor: '#ffffff' };
    adoptColourModel(old);
    assert.equal('focusedColor' in old || 'focusedEdgeColor' in old, false);
});

test('Apply to other panels copies the Focused group; presets leave it', () => {
    for (const k of ['focusedScale', 'focusedOpacity', 'focusedColor', 'focusedNoFill', 'focusedEdgeColor', 'focusedEdgeWidth']) {
        assert.ok(STYLE_KEYS.includes(k), k);
    }
    const src = { focusedScale: 4, focusedEdgeWidth: 1, focusedColor: '#00ff00' };
    const dst = adoptStyle({ focusedOpacity: 0.3, focusedEdgeColor: '#ffffff' }, pickStyle(src));
    assert.equal(dst.focusedScale, 4);
    assert.equal(dst.focusedEdgeWidth, 1);
    assert.equal(dst.focusedColor, '#00ff00');
    assert.equal('focusedOpacity' in dst, false);     // unset on the source: unset here
    assert.equal('focusedEdgeColor' in dst, false);
    const kept = { focusedScale: 3, focusedColor: '#00ff00' };
    applyPreset(kept, 'default');
    applyPreset(kept, 'publication');
    assert.deepEqual([kept.focusedScale, kept.focusedColor], [3, '#00ff00']);
});

test('an edge left at the default follows the theme; an edge set by hand is kept in both', () => {
    const edge = (s) => focusMarker(s).line.color;
    const auto = { pointSize: 4 };
    theme = 'light';
    assert.equal(edge(auto), '#000000');
    theme = 'dark';
    assert.equal(edge(auto), '#ffffff');
    // a hand-set colour, also black (the light default) or white (the dark default), is pinned
    for (const colour of ['#0000ff', '#000000', '#ffffff']) {
        const set = { pointSize: 4, focusedEdgeColor: colour };
        for (const name of ['light', 'dark', 'light']) {
            theme = name;
            assert.equal(edge(set), colour);
            assert.equal(focusShapeStyle(set).line.color, colour);
        }
    }
    // Reset makes it follow again
    const set = { pointSize: 4, focusedEdgeColor: '#0000ff' };
    followTheme(set, ['focusedEdgeColor']);
    theme = 'dark';
    assert.equal(edge(set), '#ffffff');
    theme = 'light';
    assert.equal(edge(set), '#000000');
});

test('a setting saved before the white dark edge keeps the colour it saved', () => {
    // a link or panel set made in the dark theme saved no edge when it was left at the default
    // (follows the theme: white now) and the colour itself when it was set (black stays black)
    theme = 'dark';
    const saved = { colourModel: 2, focusedEdgeColor: '#000000' };
    adoptColourModel(saved);
    assert.equal(saved.focusedEdgeColor, '#000000');
    assert.equal(focusMarker({ pointSize: 4, ...saved }).line.color, '#000000');
    const unset = { colourModel: 2 };
    adoptColourModel(unset);
    assert.equal(focusMarker({ pointSize: 4, ...unset }).line.color, '#ffffff');
    theme = 'light';
});

test('no fill draws an open circle: transparent fill, the edge kept at 1 px at least', () => {
    const s = { pointSize: 4, focusedColor: '#00ff00', focusedEdgeColor: '#0000ff', focusedEdgeWidth: 3, focusedNoFill: true };
    assert.deepEqual(focusMarker(s), { size: 8, color: NO_FILL, opacity: 1, line: { color: '#0000ff', width: 3 }, showscale: false });
    assert.equal(focusRestyle(s)['marker.color'], NO_FILL);
    assert.deepEqual(focusShapeStyle(s), { r: 4, opacity: 1, fillcolor: NO_FILL, line: { color: '#0000ff', width: 3 } });
    assert.match(NO_FILL, /^rgba\(\d+,\d+,\d+,0\)$/);   // alpha 0
    // an edge width of 0 would leave nothing to see: drawn 1 px
    const zero = { ...s, focusedEdgeWidth: 0 };
    assert.equal(focusMarker(zero).line.width, 1);
    assert.equal(focusShapeStyle(zero).line.width, 1);
    // only `true` counts; the flag off (or any other value) is the filled marker
    for (const v of [false, undefined, 'true', 1, null]) {
        assert.equal(focusMarker({ ...s, focusedNoFill: v }).color, '#00ff00', String(v));
    }
    assert.equal(focusMarker({ ...s, focusedNoFill: false, focusedEdgeWidth: 0 }).line.width, 0);
});

test('the ring of a cell outside the subset looks the same with or without a fill', () => {
    const s = { pointSize: 4, focusedColor: '#00ff00', focusedEdgeWidth: 0 };
    assert.deepEqual(focusMarker({ ...s, focusedNoFill: true }, true), focusMarker(s, true));
});

test('a 3D marker draws no edge, so no fill is the open-circle symbol in the edge colour', () => {
    const s = { pointSize: 4, focusedColor: '#00ff00', focusedEdgeColor: '#0000ff', focusedEdgeWidth: 0, focusedNoFill: true };
    assert.deepEqual(focusMarker(s, false, true), { size: 8, symbol: 'circle-open', color: '#0000ff', opacity: 1,
                                                    line: { color: '#0000ff', width: 1 }, showscale: false });
    assert.equal(focusRestyle(s, false, true)['marker.symbol'], 'circle-open');
    // filled again: the plain symbol goes back; a 2D restyle never names the symbol
    const filled = { ...s, focusedNoFill: false };
    assert.equal(focusRestyle(filled, false, true)['marker.symbol'], 'circle');
    assert.equal(focusMarker(filled, false, true).symbol, undefined);
    assert.equal('marker.symbol' in focusRestyle(s), false);
    assert.deepEqual(focusMarker({ ...s, focusedNoFill: true }, true, true), focusMarker(s, true));   // the ring is as it was
});
