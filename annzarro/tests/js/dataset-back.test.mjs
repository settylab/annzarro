/**
 * The back button of the dataset bar (static/js/utils/dataset-button.js): what a
 * switch offers, and the words of the offer.
 *
 * Run:  node --test annzarro/tests/js/dataset-back.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { backOffer, backText } = await import('../../../static/js/utils/dataset-button.js');

const open = (path) => ({ path, label: path, status: 'open', error: null, failed: null });

test('a switch from an open dataset offers the one left, by its name', () => {
    const offer = backOffer(open('/d/projects/a.zarr'), open('/d/b.zarr'));
    assert.deepEqual(offer, { path: '/d/projects/a.zarr', name: 'a.zarr', from: '/d/b.zarr' });
    assert.equal(backText(offer), 'Back to a.zarr');
});

test('a dataset that was still opening counts as one that was open', () => {
    const before = { ...open('/d/a.zarr'), status: 'opening' };
    assert.equal(backOffer(before, open('/d/b.zarr')).path, '/d/a.zarr');
});

test('there is nothing to go back to without a previous dataset, or when it is the same one', () => {
    assert.equal(backOffer({ path: null, status: 'none' }, open('/d/b.zarr')), null);
    assert.equal(backOffer(open('/d/a.zarr'), open('/d/a.zarr')), null);
    assert.equal(backOffer(null, open('/d/a.zarr')), null);
});

test('a previous dataset that was unavailable or without data is not offered', () => {
    for (const status of ['nodata', 'unavailable', 'none']) {
        assert.equal(backOffer({ path: '/d/a.zarr', status }, open('/d/b.zarr')), null, status);
    }
});

test('a switch that did not end on an open dataset offers nothing', () => {
    for (const status of ['opening', 'nodata', 'unavailable', 'none']) {
        assert.equal(backOffer(open('/d/a.zarr'), { path: '/d/b.zarr', status }), null, status);
    }
});

test('the long name stays whole in the offer: the button shows no text, so it cannot overflow', () => {
    const long = 'bm_aging_liver_hepatocyte_atlas_batch3_reprocessed_with_harmony_integration_and_doublet_removal_final_v7_approved_for_sharing.zarr';
    assert.equal(backText(backOffer(open(`/d/${long}`), open('/d/b.zarr'))), `Back to ${long}`);
});
