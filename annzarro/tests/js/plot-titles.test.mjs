/**
 * Long plot titles are shortened in the middle to fit, full text kept.
 *
 * Colour-bar titles like "obsp.diffusion_walk_t5.HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
 * ran off the top of a half-height tile. Headless at 1200x600 (graphs 391 px
 * tall) the fitted title now spans 80-331 px with the full text in an SVG
 * <title> tooltip.
 *
 * Run:  node --test annzarro/tests/js/plot-titles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { middleEllipsis, fitPlotTitles } = await import('../../../static/js/utils/plot-titles.js');
const width = (n) => (s) => Array.from(s).length <= n;   // 1 unit per character

test('a title that fits is untouched', () => {
    assert.equal(middleEllipsis('obsm.X_umap.0', width(20)), 'obsm.X_umap.0');
});

test('a long title keeps its head and tail', () => {
    const t = 'obsp.diffusion_walk_t5.HSPC_Old_1#GAAGCCCGTGGCTCTG-1';
    const out = middleEllipsis(t, width(25));
    assert.equal(Array.from(out).length, 25);
    assert.ok(out.startsWith('obsp.diffusi'), out);
    assert.ok(out.endsWith('GGCTCTG-1'), out);
    assert.ok(out.includes('…'));
});

test('nothing fits: just the ellipsis', () => {
    assert.equal(middleEllipsis('abcdef', width(0)), '…');
});

test('a graph without a laid-out size is left alone', () => {
    assert.doesNotThrow(() => fitPlotTitles({}));
    assert.doesNotThrow(() => fitPlotTitles(null));
});

test('the colour title reads as a label, not a raw key', async () => {
    const { colourTitle } = await import('../../../static/js/utils/plot-titles.js');
    assert.equal(colourTitle({ type: 'obsp', key: 'chemical_synapses', column: 'AVA' }), 'chemical_synapses · row AVA');
    assert.equal(colourTitle({ type: 'varp', key: 'gene_corr', column: 'Gata1' }), 'gene_corr · row Gata1');
    assert.equal(colourTitle({ type: 'obs', key: 'total_counts', column: '' }), 'total_counts');
    assert.equal(colourTitle({ type: 'obsm', key: 'X_pca', column: '3' }), 'X_pca · 3');
    assert.equal(colourTitle({ type: 'layer', key: 'counts', column: 'Gata1' }), 'counts · Gata1');
    assert.equal(colourTitle({ type: 'none', key: '', column: '' }), '');
});

test('every colour bar and legend title goes through colourTitle', async () => {
    // The raw `${settings.color.type}.${settings.color.key}` was written out at
    // nine sites; one left behind would show the old key after some redraws.
    const { readFileSync } = await import('node:fs');
    const dir = new URL('../../../static/js/panels/plot-utilities/', import.meta.url);
    for (const f of ['plot-make.js', 'plot-update.js', 'large-plot.js']) {
        const src = readFileSync(new URL(f, dir), 'utf8');
        assert.doesNotMatch(src, /\$\{settings\.color\.type\}\.\$\{settings\.color\.key\}/, f);
        assert.match(src, /colourTitle\(settings\.color\)/, f);
    }
});
