/**
 * WP-5b: the Cell Plot and the Gene Plot declared as kinds of the shared Plot Options (panels/plot-utilities/
 * aesthetics-kinds.js on options-schema.js). Their fields are the settings keys the plots have always stored, so a
 * link from before keeps every aesthetic; their defaults are today's look; their groups follow the shared order.
 *
 * Run:  node --test annzarro/tests/js/aesthetics-kinds.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const K = await import('../../../static/js/panels/plot-utilities/aesthetics-kinds.js');
const S = await import('../../../static/js/panels/plot-utilities/options-schema.js');
const PO = await import('../../../static/js/panels/plot-utilities/plot-options.js');

test('both kinds have the shared section order, with their own Points and Focused groups', () => {
    for (const kind of K.AESTHETICS_KINDS) {
        assert.deepEqual(S.sectionsOf(kind).map((s) => s.id),
            ['presets', 'text', 'background', 'axes', 'panel:points', 'panel:focused', 'legend', 'margins', 'export', 'apply']);
    }
});

test('the fields are the keys the plots store: every look key Apply to other panels copies is a field', () => {
    for (const kind of K.AESTHETICS_KINDS) {
        // the margins field holds two keys: its sides and the switch that sets them one by one (`unlinkedPath`)
        const paths = new Set(S.fieldsOf(kind).flatMap((f) => [f.path, f.unlinkedPath].filter(Boolean)));
        for (const key of PO.STYLE_KEYS) assert.ok(paths.has(key), `${kind}: ${key}`);
        assert.ok(![...paths].some((p) => p.startsWith('look.')), 'no field of the new panels\' `look`: links keep their keys');
        assert.ok(paths.has('pointSize'), 'the point size is in Plot Options (Points)');
    }
});

test('the defaults are today\'s look (plot-options.js defaultLook); colours follow the theme', () => {
    const look = PO.defaultLook();
    for (const f of S.fieldsOf('cell-plot')) {
        if (!(f.path in look)) continue;
        // the font is unset in the look and filled with Arial when a plot is made (initializeAestheticsSettings)
        const want = f.path === 'fontFamily' ? 'Arial, Helvetica, sans-serif' : look[f.path] === undefined ? null : look[f.path];
        assert.deepEqual(S.defaultOf(f, 'cell-plot'), want, f.path);
    }
});

test('a Reset of a group puts back only that group\'s keys', () => {
    assert.deepEqual(K.sectionKeys('cell-plot', 'text'), ['fontFamily', 'fontSize', 'textColor']);
    assert.deepEqual(K.sectionKeys('gene-plot', 'points'), ['notInTableScale', 'notInTableOpacity', 'notInTableColor'],
        'the point size has its own auto; the Points Reset leaves it');
    assert.ok(!K.sectionKeys('cell-plot', 'axes').includes('flipX'), 'Flip x is a view, not a look');
    assert.deepEqual(K.sectionKeys('cell-plot', 'presets'), []);
});
