/**
 * The session's default plot style (static/js/utils/session-style.js): what a new plot takes from it,
 * what it never takes, one default per plot kind, and what a stored one may hold.
 *
 * Run:  node --test annzarro/tests/js/session-style.test.mjs
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlotOptions, STYLE_KEYS, presetChanges } from '../../../static/js/panels/plot-utilities/plot-options.js';
import { COLOUR_MODEL } from '../../../static/js/utils/plot-theme.js';
import {
    STYLE_TYPES, sessionStyle, hasSessionStyle, setSessionStyle, clearSessionStyle, replaceSessionStyles,
    cleanSessionStyles, storableSessionStyles, withSessionStyle, onSessionStyleChange
} from '../../../static/js/utils/session-style.js';

const look = (extra = {}) => normalizePlotOptions({ colourModel: COLOUR_MODEL, showGrid: false, fontSize: 18, bgColor: '#ffffff', ...extra });

beforeEach(() => clearSessionStyle());

test('no default: a config is returned as it is', () => {
    const config = { id: 'cell-plot-1', title: 'Cell Plot 1' };
    assert.equal(withSessionStyle('cell-plot', config), config);
    assert.equal(storableSessionStyles(), undefined);
});

test('a new plot takes the options it leaves unset, and only those', () => {
    setSessionStyle('cell-plot', look());
    const out = withSessionStyle('cell-plot', { id: 'a', title: 'T', fontSize: 9 });
    assert.equal(out.showGrid, false);
    assert.equal(out.bgColor, '#ffffff');
    assert.equal(out.fontSize, 9, 'a set option wins');
    assert.equal(out.id, 'a');
    assert.equal(out.colourModel, COLOUR_MODEL);
});

test('what the plot shows is never part of it', () => {
    setSessionStyle('cell-plot', look({ x: 'umap_1', color: { type: 'obs', key: 'c' }, pointSize: 9, subsettedCells: [1, 2] }));
    const out = withSessionStyle('cell-plot', { id: 'a' });
    for (const k of ['x', 'color', 'pointSize', 'subsettedCells']) assert.equal(out[k], undefined, k);
    assert.deepEqual(Object.keys(sessionStyle('cell-plot')).sort(), [...STYLE_KEYS].sort());
});

test('an option the source leaves unset stays unset: a colour follows the app theme', () => {
    setSessionStyle('cell-plot', look({ bgColor: undefined }));
    const out = withSessionStyle('cell-plot', { id: 'a' });
    assert.equal('bgColor' in out, false);
});

test('cell plots and gene plots have a default each', () => {
    setSessionStyle('cell-plot', look());
    assert.ok(hasSessionStyle('cell-plot'));
    assert.ok(!hasSessionStyle('gene-plot'));
    const gene = { id: 'g' };
    assert.equal(withSessionStyle('gene-plot', gene), gene);
    setSessionStyle('gene-plot', look({ fontSize: 22 }));
    assert.equal(withSessionStyle('gene-plot', {}).fontSize, 22);
    assert.equal(withSessionStyle('cell-plot', {}).fontSize, 18);
    clearSessionStyle('cell-plot');
    assert.ok(!hasSessionStyle('cell-plot') && hasSessionStyle('gene-plot'));
});

test('only plots have one', () => {
    assert.equal(setSessionStyle('cell-table', look()), false);
    assert.deepEqual(Object.keys(STYLE_TYPES), ['cell-plot', 'gene-plot']);
});

test('the Bare preset as a default: a new plot is bare', () => {
    const bare = look();
    Object.assign(bare, presetChanges('bare'));
    setSessionStyle('cell-plot', bare);
    const out = withSessionStyle('cell-plot', { id: 'a' });
    assert.equal(out.bare, true);
    assert.equal(out.showLegend, false);
    assert.deepEqual(out.margins, { l: 0, r: 0, t: 0, b: 0, pad: 0 });
});

test('the default is a copy: changing the source or the new plot does not change it', () => {
    const source = look();
    setSessionStyle('cell-plot', source);
    source.margins.l = 1;
    const out = withSessionStyle('cell-plot', {});
    out.margins.l = 2;
    assert.equal(sessionStyle('cell-plot').margins.l, 80);
    assert.equal(withSessionStyle('cell-plot', {}).margins.l, 80);
});

test('it survives JSON, as the autosave and a panel set store it', () => {
    setSessionStyle('cell-plot', look());
    const stored = JSON.parse(JSON.stringify(storableSessionStyles()));
    clearSessionStyle();
    replaceSessionStyles(stored);
    assert.equal(withSessionStyle('cell-plot', {}).fontSize, 18);
});

test('replacing swaps the whole default; a stored empty one clears it', () => {
    setSessionStyle('cell-plot', look());
    replaceSessionStyles({ 'gene-plot': { fontSize: 7 } });
    assert.ok(!hasSessionStyle('cell-plot'));
    assert.equal(withSessionStyle('gene-plot', {}).fontSize, 7);
    replaceSessionStyles(undefined);
    assert.equal(storableSessionStyles(), undefined);
});

test('a stored default is cleaned: unknown types and keys, and other shapes, are dropped', () => {
    const clean = cleanSessionStyles({
        'cell-plot': { fontSize: 12, x: 'umap_1', color: 'red' },
        'cell-table': { fontSize: 12 },
        'gene-plot': ['no'],
    });
    assert.deepEqual(clean, { 'cell-plot': { fontSize: 12 } });
    for (const bad of [null, 5, 'x', [], { 'cell-plot': null }]) assert.deepEqual(cleanSessionStyles(bad), {});
});

test('listeners hear a set or a reset by the person, not a load', () => {
    let n = 0;
    const off = onSessionStyleChange(() => n++);
    setSessionStyle('cell-plot', look());
    clearSessionStyle('cell-plot');
    clearSessionStyle('cell-plot');          // nothing to reset: nothing to hear
    replaceSessionStyles({ 'cell-plot': { fontSize: 5 } });
    assert.equal(n, 2);
    off();
    clearSessionStyle();
    assert.equal(n, 2);
});
