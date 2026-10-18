/**
 * How a plot's colours follow the app theme (static/js/utils/plot-theme.js).
 *
 * The rule: a plot follows the app theme for every colour not set explicitly.
 * A colour is auto (absent from the settings) or pinned (a stored string);
 * only pinned colours are saved. Old links stored every colour, the light
 * defaults included, and are migrated once.
 *
 * Run:  node --test annzarro/tests/js/plot-theme.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLOUR_MODEL, THEMED_COLOURS, BUTTON_COLOURS, PLOT_PALETTES, plotColour, isFollowing,
    adoptColourModel, pinPalette, followTheme, normalizeHex, withAlpha, modebarColours
} from '../../../static/js/utils/plot-theme.js';
import {
    normalizePlotOptions, pickStyle, adoptStyle, applyPreset, scaleBar, defaultLook
} from '../../../static/js/panels/plot-utilities/plot-options.js';
import { greyMarker, NOT_IN_TABLE_COLOR } from '../../../static/js/utils/point-style.js';

const followsAll = (s) => THEMED_COLOURS.every(k => isFollowing(s, k));

const LIGHT = PLOT_PALETTES.light;
const DARK = PLOT_PALETTES.dark;

test('an unset colour is the theme\'s; a set one is kept in either theme', () => {
    const s = {};
    for (const key of THEMED_COLOURS) {
        assert.equal(plotColour(s, key, 'light'), LIGHT[key]);
        assert.equal(plotColour(s, key, 'dark'), DARK[key]);
        assert.equal(isFollowing(s, key), true);
    }
    s.textColor = '#ff0000';
    assert.equal(plotColour(s, 'textColor', 'light'), '#ff0000');
    assert.equal(plotColour(s, 'textColor', 'dark'), '#ff0000');
    assert.equal(plotColour(s, 'bgColor', 'dark'), DARK.bgColor);   // the others still follow
    assert.equal(isFollowing(s, 'textColor'), false);
    assert.equal(followsAll(s), false);
});

test('the default theme is the one on the page (light with no document)', () => {
    assert.equal(plotColour({}, 'bgColor'), LIGHT.bgColor);
});

test('empty values are not colours', () => {
    for (const v of ['', '   ', null, undefined, 3, {}]) assert.equal(isFollowing({ gridColor: v }, 'gridColor'), true);
});

test('the dark palette is readable: text, axis and grey against the dark background', () => {
    const lum = (hex) => {
        const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const theme of ['light', 'dark']) {
        const p = PLOT_PALETTES[theme];
        assert.ok(ratio(p.textColor, p.bgColor) >= 7, `text on background, ${theme}`);
        assert.ok(ratio(p.axisColor, p.bgColor) >= 7, `axis on background, ${theme}`);
        assert.ok(ratio(p.notInTableColor, p.bgColor) >= 1.7, `the grey must show on the background, ${theme}`);
    }
    assert.ok(ratio(DARK.notInTableColor, DARK.bgColor) >= 3, 'dark grey is a visible 3:1 on the dark background');
});

// ---- old links ----

test('old link, never touched: every stored colour equals the light default and becomes auto', () => {
    const s = { ...LIGHT, showGrid: true };
    delete s.notInTableColor;           // the palette colours no link from before the colour model stored
    delete s.focusedColor;
    delete s.focusedEdgeColor;
    const freed = adoptColourModel(s);
    assert.deepEqual(freed.sort(), BUTTON_COLOURS.slice().sort());
    for (const k of THEMED_COLOURS) assert.equal(k in s, false);
    assert.equal(s.colourModel, COLOUR_MODEL);
    assert.equal(followsAll(s), true);
    assert.equal(plotColour(s, 'bgColor', 'dark'), DARK.bgColor);
});

test('old link with chosen colours: those stay pinned, the untouched ones follow', () => {
    const s = { ...LIGHT, gridColor: '#ff00ff', bgColor: '#111111' };
    adoptColourModel(s);
    assert.equal(s.gridColor, '#ff00ff');
    assert.equal(s.bgColor, '#111111');
    assert.equal('textColor' in s, false);
    assert.equal(plotColour(s, 'textColor', 'dark'), DARK.textColor);
    assert.equal(plotColour(s, 'gridColor', 'dark'), '#ff00ff');
});

test('old link written with the dark button: pinned dark, it stays dark in the light theme', () => {
    const s = { bgColor: '#1e1e1e', gridColor: '#444444', axisColor: '#ffffff', textColor: '#ffffff', zeroLineColor: '#666666', backdropColor: '#121212' };
    adoptColourModel(s);
    for (const k of BUTTON_COLOURS) assert.equal(plotColour(s, k, 'light'), DARK[k]);
});

test('light defaults are recognised however they were written (case, short form)', () => {
    const s = { bgColor: '#FFFFFF', textColor: '#000', gridColor: ' #E6E6E6 ' };
    adoptColourModel(s);
    assert.deepEqual(Object.keys(s).filter(k => k.endsWith('Color')), []);
    assert.equal(normalizeHex('#ABC'), '#aabbcc');
});

test('a link of the new model is taken literally: a pinned white stays pinned', () => {
    const s = { colourModel: COLOUR_MODEL, bgColor: '#ffffff' };
    assert.deepEqual(adoptColourModel(s), []);
    assert.equal(s.bgColor, '#ffffff');
    assert.equal(plotColour(s, 'bgColor', 'dark'), '#ffffff');
});

test('migrating twice changes nothing', () => {
    const s = { ...LIGHT, textColor: '#222222' };
    adoptColourModel(s);
    const once = JSON.stringify(s);
    adoptColourModel(s);
    assert.equal(JSON.stringify(s), once);
});

test('normalizePlotOptions migrates, so every loading path does', () => {
    const s = normalizePlotOptions({ bgColor: '#ffffff', textColor: '#00ff00' });
    assert.equal('bgColor' in s, false);
    assert.equal(s.textColor, '#00ff00');
    assert.equal(s.colourModel, COLOUR_MODEL);
});

// ---- the state travels in a link ----

test('only pinned colours are in what a link stores', () => {
    const s = normalizePlotOptions({});
    s.gridColor = '#123456';
    const stored = JSON.parse(JSON.stringify(s));
    assert.equal(stored.gridColor, '#123456');
    for (const k of THEMED_COLOURS.filter(k => k !== 'gridColor')) assert.equal(k in stored, false);
    // and the round trip keeps it: still pinned, the rest still auto
    const back = normalizePlotOptions(stored);
    assert.equal(back.gridColor, '#123456');
    assert.equal(isFollowing(back, 'bgColor'), true);
});

// ---- the buttons ----

test('Light colours and Dark colours pin; Follow app theme releases every colour', () => {
    const s = normalizePlotOptions({});
    pinPalette(s, 'dark');
    for (const k of BUTTON_COLOURS) assert.equal(s[k], DARK[k]);
    assert.equal(plotColour(s, 'bgColor', 'light'), DARK.bgColor);
    pinPalette(s, 'light');
    assert.equal(plotColour(s, 'bgColor', 'dark'), LIGHT.bgColor);
    s.notInTableColor = '#abcdef';
    const changed = followTheme(s);
    assert.ok(changed.includes('bgColor') && changed.includes('notInTableColor'));
    assert.equal(followsAll(s), true);
    assert.equal(s.colourModel, COLOUR_MODEL);
});

test('a colour\'s Reset releases only that colour', () => {
    const s = normalizePlotOptions({});
    pinPalette(s, 'light');
    followTheme(s, ['gridColor']);
    assert.equal(isFollowing(s, 'gridColor'), true);
    assert.equal(isFollowing(s, 'bgColor'), false);
});

test('presets: Default releases the colours, Publication pins them light', () => {
    const s = normalizePlotOptions({});
    pinPalette(s, 'dark');
    applyPreset(s, 'publication');
    assert.equal(plotColour(s, 'bgColor', 'dark'), '#ffffff');
    assert.equal(plotColour(s, 'textColor', 'dark'), '#000000');
    applyPreset(s, 'default');
    assert.equal(followsAll(s), true);
    const look = defaultLook();
    for (const k of BUTTON_COLOURS) assert.equal(look[k], undefined);
});

test('Apply to other panels copies the pinned colours and the following alike', () => {
    const src = normalizePlotOptions({});
    src.textColor = '#336699';                    // pinned; the rest follow
    const target = normalizePlotOptions({});
    pinPalette(target, 'dark');
    adoptStyle(target, pickStyle(src));
    assert.equal(target.textColor, '#336699');
    assert.equal(isFollowing(target, 'bgColor'), true);    // released on the other side too
    // onto an old-link panel that has not been migrated yet
    const old = { bgColor: '#ffffff', gridColor: '#e6e6e6' };
    adoptStyle(old, pickStyle(src));
    assert.equal(old.colourModel, COLOUR_MODEL);
    assert.equal(isFollowing(old, 'bgColor'), true);
    assert.equal(old.textColor, '#336699');
});

// ---- what else follows the text colour and the theme ----

test('the scale bar takes the text colour, so it follows the theme until text is pinned', () => {
    const s = normalizePlotOptions({ showScaleBar: true, equalAspect: true });
    const colour = () => scaleBar(s, [0, 100]).shapes[0].line.color;
    assert.equal(colour(), LIGHT.textColor);
    s.textColor = '#00aa00';
    assert.equal(colour(), '#00aa00');
});

test('the grey of points not in the table follows the theme unless set', () => {
    assert.equal(NOT_IN_TABLE_COLOR, LIGHT.notInTableColor);
    assert.equal(greyMarker({}, 100).color, LIGHT.notInTableColor);
    assert.equal(greyMarker({ notInTableColor: '#123456' }, 100).color, '#123456');
});

test('the toolbar takes the plot\'s text colour', () => {
    assert.equal(modebarColours({}, 'dark').activecolor, DARK.textColor);
    assert.equal(modebarColours({}, 'light').activecolor, LIGHT.textColor);
    assert.equal(modebarColours({ textColor: '#ff0000' }, 'dark').color, 'rgba(255, 0, 0, 0.55)');
    assert.equal(withAlpha('not a colour', 0.5), 'not a colour');
});

test('a link saved with a whole palette pinned (the removed theme buttons) loads and draws as saved', () => {
    for (const [name, pal] of [['dark', DARK], ['light', LIGHT]]) {
        const saved = { colourModel: COLOUR_MODEL };
        for (const k of BUTTON_COLOURS) saved[k] = pal[k];
        const loaded = normalizePlotOptions(JSON.parse(JSON.stringify(saved)));
        for (const k of BUTTON_COLOURS) {
            assert.equal(plotColour(loaded, k, 'light'), pal[k], `${name} ${k} in a light app`);
            assert.equal(plotColour(loaded, k, 'dark'), pal[k], `${name} ${k} in a dark app`);
        }
        followTheme(loaded, ['bgColor']);                      // a colour's Reset frees only that colour
        assert.equal(plotColour(loaded, 'bgColor', 'dark'), DARK.bgColor);
        assert.equal(plotColour(loaded, 'textColor', 'dark'), pal.textColor);
    }
});
