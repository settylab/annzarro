/**
 * The closed dataset box's label is cut by script to the room it has
 * (static/js/utils/dataset-label.js): folders first, then the middle of the
 * name, always keeping the end (version, extension).
 *
 * Run:  node --test annzarro/tests/js/dataset-label.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { truncateDatasetLabel, datasetLabel, TAIL_CHARS } = await import('../../../static/js/utils/dataset-label.js');

const measure = s => s.length * 8;          // a fixed-width model: 8 px a character
const fit = (text, chars) => truncateDatasetLabel(text, chars * 8, measure);
const PATH = 'projects/liver/2026-10_batch3/bm_aging_liver_hepatocyte_atlas_final_v7_approved_for_sharing.zarr';

test('a label that fits is left alone', () => {
    assert.equal(fit(PATH, PATH.length), PATH);
    assert.equal(fit('short.zarr', 40), 'short.zarr');
});

test('the middle folders go first', () => {
    const out = fit(PATH, PATH.length - 5);
    assert.equal(out, 'projects/\u2026/bm_aging_liver_hepatocyte_atlas_final_v7_approved_for_sharing.zarr');
});

test('then the middle of the name is cut, its start and last 16 characters kept, behind the collapsed folders', () => {
    const out = fit(PATH, 50);
    assert.ok(out.startsWith('projects/\u2026/bm_aging'), out);
    assert.ok(out.endsWith('for_sharing.zarr') && out.endsWith(PATH.slice(-TAIL_CHARS)), out);
    assert.ok(out.length <= 50, out.length);
    assert.ok(out.includes('\u2026', out.indexOf('/\u2026/') + 3), 'the name itself is cut');
});

test('then the folders go altogether', () => {
    const out = fit(PATH, 30);
    assert.ok(out.startsWith('\u2026/bm_aging') && out.endsWith(PATH.slice(-TAIL_CHARS)), out);
    assert.ok(out.length <= 30);
});

test('whatever the room, the result fits and ends with as much of the end as can be kept', () => {
    for (let chars = 1; chars <= PATH.length; chars++) {
        const out = fit(PATH, chars);
        assert.ok(out.length <= Math.max(chars, 1), `${chars}: ${out}`);
        if (chars >= 24) assert.ok(out.endsWith(PATH.slice(-TAIL_CHARS)), `${chars}: ${out}`);
    }
});

test('a name without folders is cut in its middle; a single folder is kept while it can be', () => {
    const name = 'a_rather_long_dataset_name_with_a_version_suffix_v12.zarr';
    const out = fit(name, 30);
    assert.ok(out.startsWith('a_rather') && out.endsWith(name.slice(-TAIL_CHARS)) && out.length <= 30, out);
    const one = fit('liver/' + name, 40);
    assert.ok(one.startsWith('liver/a_') && one.endsWith(name.slice(-TAIL_CHARS)) && one.length <= 40, one);
});

test('the label of an unlisted path is relative to the data directory', () => {
    const listing = [{ path: '/srv/data/a.zarr', rel_path: 'a.zarr' }];
    assert.equal(datasetLabel('/srv/data/projects/x.zarr', listing), 'projects/x.zarr');
    assert.equal(datasetLabel('/elsewhere/x.zarr', listing), '/elsewhere/x.zarr');
});
