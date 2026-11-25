/**
 * A Venn's own controls (operator, 0.8.0): what its regions print, the set names, and whether areas follow the counts.
 * Each is stored only when it differs from what an old link drew, and only a Venn reads them.
 *
 * Run:  node --test annzarro/tests/js/count-venn-controls.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');

const V = (fields) => K.drawOptions({ mode: 'venn', sets, ...fields }).venn;
const sets = [{ source: { type: 'obs', key: 'cell_type' }, member: { levels: ['c:T cell'] } }, { source: { type: 'obs', key: 'is_doublet' }, member: { levels: ['c:true'] } }];

test('an old Venn link (none of the fields) reads count and share, names on, equal circles', () => {
    assert.deepEqual(K.drawOptions({ mode: 'venn', sets }).venn, { labels: 'both', names: true, proportional: false });
});

test('the stored fields are read, and a value that is not one of the choices is the default', () => {
    assert.deepEqual(V({ vennLabels: 'share', vennNames: false, vennArea: true }), { labels: 'share', names: false, proportional: true });
    assert.deepEqual(V({ vennLabels: 'none' }), { labels: 'none', names: true, proportional: false });
    assert.deepEqual(V({ vennLabels: 'median', vennNames: 'no', vennArea: 'yes' }), { labels: 'both', names: true, proportional: false });
});

test('only a Venn has the options, so no other mode\'s options change', () => {
    for (const mode of ['bar', 'pie', 'histogram', 'upset', 'heatmap']) {
        assert.equal('venn' in K.drawOptions({ mode, vennArea: true, vennLabels: 'none', sets }), false, mode);
    }
    assert.equal(K.rowsOf('venn').venn, true);
    assert.equal(K.rowsOf('pie').venn, false);
});

test('a Venn\'s Labels select offers count and share, count, share and none', () => {
    assert.deepEqual(K.VENN_LABEL_KINDS.map(k => VOCABULARY.countPlot.venn.labels[k]), ['Count and fraction', 'Count', 'Fraction', 'None']);
});
