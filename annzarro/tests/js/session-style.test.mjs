/**
 * The session's default plot style (static/js/utils/session-style.js): what is stored (only what differs
 * from built-in), what plots on Default get, one default per plot kind, what a view does to it, and what a
 * panel set card says about it.
 *
 * Run:  node --test annzarro/tests/js/session-style.test.mjs
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlotOptions, STYLE_KEYS, presetChanges, pickStyle } from '../../../static/js/panels/plot-utilities/plot-options.js';
import { COLOUR_MODEL } from '../../../static/js/utils/plot-theme.js';
import {
    STYLE_TYPES, sessionStyle, hasSessionStyle, setSessionStyle, clearSessionStyle, replaceSessionStyles,
    cleanSessionStyles, storableSessionStyles, effectiveStyle, onDefault, onSessionStyleChange, diffStyle,
    viewStyleChange, styleSummary, saveSessionStylesTo, loadSessionStylesFrom, STORAGE_KEY
} from '../../../static/js/utils/session-style.js';
import { normalizeView, encodeViewPayload, decodeViewPayload } from '../../../static/js/utils/deeplink.js';

const built = () => normalizePlotOptions({ colourModel: COLOUR_MODEL, showGrid: true, fontSize: 12, exportWidth: 1200 });
const BASE = pickStyle(built());
const look = (extra = {}) => normalizePlotOptions({ ...built(), showGrid: false, fontSize: 18, bgColor: '#ffffff', ...extra });

beforeEach(() => clearSessionStyle());

test('no default: plots on Default have the built-in look', () => {
    assert.deepEqual(effectiveStyle('cell-plot', BASE), BASE);
    assert.equal(storableSessionStyles(), undefined);
});

test('only what differs from built-in is kept', () => {
    assert.equal(setSessionStyle('cell-plot', look(), BASE), true);
    const kept = sessionStyle('cell-plot');
    assert.deepEqual(Object.keys(kept).sort(), ['bgColor', 'fontSize', 'showGrid']);
    assert.deepEqual(kept, { showGrid: false, fontSize: 18, bgColor: '#ffffff' });
});

test('a look that is the built-in one is no default, and clears the one there was', () => {
    setSessionStyle('cell-plot', look(), BASE);
    assert.equal(setSessionStyle('cell-plot', built(), BASE), false);
    assert.ok(!hasSessionStyle('cell-plot'));
    assert.equal(storableSessionStyles(), undefined);
});

test('plots on Default get the built-in look with the default on top', () => {
    setSessionStyle('cell-plot', look(), BASE);
    const eff = effectiveStyle('cell-plot', BASE);
    assert.equal(eff.fontSize, 18);
    assert.equal(eff.showGrid, false);
    assert.equal(eff.bgColor, '#ffffff');
    assert.deepEqual(eff.margins, BASE.margins);                 // a key it does not list is built-in
    assert.equal(eff.exportWidth, 1200);
});

test('a key the default unsets is unset, not built-in', () => {
    const own = look({ fontFamily: undefined });
    const base = { ...BASE, fontFamily: 'Arial, Helvetica, sans-serif' };
    setSessionStyle('cell-plot', own, base);
    assert.equal(sessionStyle('cell-plot').fontFamily, null);
    assert.equal(effectiveStyle('cell-plot', base).fontFamily, null);
});

test('what the plot shows is never part of it', () => {
    setSessionStyle('cell-plot', look({ x: 'umap_1', color: { type: 'obs', key: 'c' }, pointSize: 9, subsettedCells: [1, 2] }), BASE);
    const style = sessionStyle('cell-plot');
    for (const k of Object.keys(style)) assert.ok(STYLE_KEYS.includes(k), k);
    for (const k of ['x', 'color', 'pointSize', 'subsettedCells']) assert.equal(k in effectiveStyle('cell-plot', BASE) && !(k in BASE), false, k);
});

test('cell plots and gene plots have a default each', () => {
    setSessionStyle('cell-plot', look(), BASE);
    assert.ok(hasSessionStyle('cell-plot') && !hasSessionStyle('gene-plot'));
    assert.deepEqual(effectiveStyle('gene-plot', BASE), BASE);
    setSessionStyle('gene-plot', look({ fontSize: 22 }), BASE);
    assert.equal(effectiveStyle('gene-plot', BASE).fontSize, 22);
    assert.equal(effectiveStyle('cell-plot', BASE).fontSize, 18);
    clearSessionStyle('cell-plot');
    assert.ok(!hasSessionStyle('cell-plot') && hasSessionStyle('gene-plot'));
});

test('only plots have one, and only plots made from the chooser are put on Default', () => {
    assert.equal(setSessionStyle('cell-table', look(), BASE), false);
    assert.deepEqual(Object.keys(STYLE_TYPES), ['cell-plot', 'gene-plot']);
    assert.deepEqual(onDefault('cell-plot', { id: 'a' }), { id: 'a', styleDefault: true });
    const table = { id: 't' };
    assert.equal(onDefault('cell-table', table), table);
});

test('the Bare preset as a default: plots on Default are bare', () => {
    const bare = look();
    Object.assign(bare, presetChanges('bare'));
    setSessionStyle('cell-plot', bare, BASE);
    const eff = effectiveStyle('cell-plot', BASE);
    assert.equal(eff.bare, true);
    assert.equal(eff.showLegend, false);
    assert.deepEqual(eff.margins, { l: 0, r: 0, t: 0, b: 0, pad: 0 });
});

test('the default is a copy: changing the source or a result does not change it', () => {
    const source = look({ margins: { l: 5, r: 5, t: 5, b: 5, pad: 4 } });
    setSessionStyle('cell-plot', source, BASE);
    source.margins.l = 1;
    const eff = effectiveStyle('cell-plot', BASE);
    eff.margins.l = 2;
    assert.equal(effectiveStyle('cell-plot', BASE).margins.l, 5);
});

test('it survives JSON, as a link, the autosave and a panel set store it', () => {
    setSessionStyle('cell-plot', look(), BASE);
    const stored = JSON.parse(JSON.stringify(storableSessionStyles()));
    clearSessionStyle();
    replaceSessionStyles(stored);
    assert.equal(effectiveStyle('cell-plot', BASE).fontSize, 18);
});

test('replacing swaps the whole default; none clears it', () => {
    setSessionStyle('cell-plot', look(), BASE);
    replaceSessionStyles({ 'gene-plot': { fontSize: 7 } });
    assert.ok(!hasSessionStyle('cell-plot'));
    assert.equal(effectiveStyle('gene-plot', BASE).fontSize, 7);
    replaceSessionStyles(undefined);
    assert.equal(storableSessionStyles(), undefined);
});

test('a stored default is cleaned: unknown types and keys, and other shapes, are dropped', () => {
    const clean = cleanSessionStyles({
        'cell-plot': { fontSize: 12, x: 'umap_1', color: 'red', fontFamily: null },
        'cell-table': { fontSize: 12 },
        'gene-plot': ['no'],
    });
    assert.deepEqual(clean, { 'cell-plot': { fontSize: 12, fontFamily: null } });
    for (const bad of [null, 5, 'x', [], { 'cell-plot': null }]) assert.deepEqual(cleanSessionStyles(bad), {});
});

test('listeners hear a set or a reset by the person, not a load', () => {
    let n = 0;
    const off = onSessionStyleChange(() => n++);
    setSessionStyle('cell-plot', look(), BASE);
    clearSessionStyle('cell-plot');
    clearSessionStyle('cell-plot');          // nothing to reset: nothing to hear
    replaceSessionStyles({ 'cell-plot': { fontSize: 5 } });
    assert.equal(n, 2);
    off();
    clearSessionStyle();
    assert.equal(n, 2);
});

test('diffStyle lists the keys whose value differs, an unset one as null', () => {
    assert.deepEqual(diffStyle({ a: 1 }, {}), {});
    assert.deepEqual(diffStyle(pickStyle(look({ tickCount: undefined })), BASE), { showGrid: false, fontSize: 18, bgColor: '#ffffff' });
});

// ---- what a view (link, panel set, autosave) does to the default ----

const plot = (id, on) => ({ id, ...(on ? { styleDefault: true } : {}) });
const viewOf = (configs, extra = {}) => ({ v: 1, layout: { v: 1, hierarchy: [], panelConfigs: configs }, ...extra });

test('a view with a default replaces the current one', () => {
    const change = viewStyleChange(viewOf({ a: plot('a', false) }, { sessionStyles: { 'cell-plot': { fontSize: 9 } } }));
    assert.deepEqual(change, { styles: { 'cell-plot': { fontSize: 9 } } });
});

test('a view with plots on Default and no default clears it: they look built-in, as for the sender', () => {
    assert.deepEqual(viewStyleChange(viewOf({ a: plot('a', true), b: plot('b', false) })), { styles: {} });
    assert.deepEqual(viewStyleChange({ v: 1, panels: [{ type: 'cell-plot', config: plot('a', true) }] }), { styles: {} });
});

test('a view with no plot on Default, as every view from before this, leaves the default alone', () => {
    assert.equal(viewStyleChange(viewOf({ a: plot('a', false) })), null);
    assert.equal(viewStyleChange(viewOf({})), null);
    assert.equal(viewStyleChange(null), null);
    assert.equal(viewStyleChange({ v: 1, sessionStyles: { 'cell-table': { fontSize: 1 } } }), null);
});

test('a link round-trips the default and the plots on Default', async () => {
    setSessionStyle('cell-plot', look(), BASE);
    const view = viewOf({ a: plot('a', true) }, { sessionStyles: storableSessionStyles() });
    view.layout.hierarchy = [{ type: 'tile', id: 'cell-plot-a' }];
    view.layout.panelConfigs = { 'cell-plot-a': plot('cell-plot-a', true) };
    const back = normalizeView(await decodeViewPayload(await encodeViewPayload(normalizeView(view))));
    assert.deepEqual(back.sessionStyles, { 'cell-plot': { showGrid: false, fontSize: 18, bgColor: '#ffffff' } });
    assert.equal(back.layout.panelConfigs['cell-plot-a'].styleDefault, true);
    assert.deepEqual(viewStyleChange(back), { styles: back.sessionStyles });
});

test('a link with no default carries no field, and old links open as before', async () => {
    const view = normalizeView(viewOf({ a: plot('a', true) }));
    assert.equal('sessionStyles' in view, false);
    assert.equal(normalizeView({ v: 1, sessionStyles: [1] }).sessionStyles, undefined);
});

// ---- panel set cards ----

test('a set card says which kinds of default it brings, and whether it is only a style', () => {
    const view = { sessionStyles: { 'cell-plot': { fontSize: 9 }, 'gene-plot': { fontSize: 8 } } };
    assert.deepEqual(styleSummary({ view }), { kinds: ['cell', 'gene'], only: false });
    assert.deepEqual(styleSummary({ view, styleOnly: true }), { kinds: ['cell', 'gene'], only: true });
    assert.equal(styleSummary({ view: { layout: {} } }), null);
    assert.equal(styleSummary(null), null);
});

// ---- the tab's copy ----

test('the tab keeps it in session storage, and drops it with the default', () => {
    const store = new Map();
    const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
    setSessionStyle('cell-plot', look(), BASE);
    saveSessionStylesTo(storage);
    assert.ok(store.has(STORAGE_KEY));
    clearSessionStyle();
    loadSessionStylesFrom(storage);
    assert.equal(effectiveStyle('cell-plot', BASE).fontSize, 18);
    clearSessionStyle();
    saveSessionStylesTo(storage);
    assert.ok(!store.has(STORAGE_KEY));
    store.set(STORAGE_KEY, '{not json');
    loadSessionStylesFrom(storage);                      // not JSON: ignored
    assert.equal(storableSessionStyles(), undefined);
});
