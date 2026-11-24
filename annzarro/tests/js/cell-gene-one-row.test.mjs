/**
 * A one-row section of the Cell-Gene Plot (one-row-ux-080.md, decision 40).
 *
 *   - a signature with down genes is never summarised as if its down genes were up: its row is its score.
 *
 * Run:  node --test annzarro/tests/js/cell-gene-one-row.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCellGene, addSection, setSectionRows, sectionGenes, planFeatures } from '../../../static/js/panels/cell-gene/sections.js';

const RECIPE = { genes: ['UP1', 'UP2'], down: ['DN1'], method: 'zscore_mean', input: 'X' };
const scoreRecipe = (column, layer) => ({ ...RECIPE, method: column, input: layer });
const base = () => normalizeCellGene({ color: { stat: 'mean', layer: 'logged' }, size: { stat: 'pct_expressing', layer: 'logged' } }).config;

function planOf(cfg, counted) {
    return planFeatures({ sections: cfg.sections.map((section) => ({ section, genes: counted.genes, down: counted.down, title: 'Sig', scoreRecipe })),
        color: cfg.color, size: cfg.size, threshold: 0 });
}

test('sectionGenes counts the down genes it keeps', () => {
    const counted = sectionGenes(RECIPE, (g) => g !== 'UP2');
    assert.deepEqual(counted.genes, ['UP1', 'DN1']);
    assert.equal(counted.down, 1);
    assert.equal(sectionGenes({ genes: ['A'] }, () => true).down, 0);
});

test('a one-row section of a signature with down genes is its score, not a mean that counts down genes as up', () => {
    const cfg = setSectionRows(addSection(base(), 'sig'), 0, 'set');
    const p = planOf(cfg, sectionGenes(RECIPE, () => true));
    const row = p.rows.find((r) => r.kind === 'set');
    assert.ok(row.color.key, 'Color reads one score feature');
    assert.equal(row.color.keys, undefined, 'and no gene features averaged');
    const scores = p.features.filter((f) => f.wire.kind === 'score');
    assert.deepEqual(scores.map((f) => [f.wire.column, f.wire.layer]), [['zscore_mean', 'logged']], 'the source default method on the channel layer, one feature for both');
    // without down genes, the same section sends no score request
    const plain = planOf(cfg, sectionGenes({ genes: ['UP1', 'UP2'] }, () => true));
    assert.equal(plain.features.filter((f) => f.wire.kind === 'score').length, 0);
});
