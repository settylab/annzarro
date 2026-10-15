/**
 * The current dataset, in one place (static/js/utils/dataset-state.js): the
 * state and who is told of a change, open() through the registered opener, the
 * sources that are user choices, and the tab title.
 *
 * Run:  node --test annzarro/tests/js/dataset-state.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createDatasetState, DatasetState, documentTitle, datasetName, isUserSource, USER_SOURCES } =
    await import('../../../static/js/utils/dataset-state.js');

test('it starts with no dataset', () => {
    assert.deepEqual(createDatasetState().get(), { path: null, label: '', status: 'none', error: null, failed: null });
});

test('set() tells subscribers once per change, with the state before', () => {
    const state = createDatasetState();
    const seen = [];
    state.subscribe((now, before) => seen.push([now.status, now.path, before.status]));
    state.set({ path: '/d/a.zarr', label: 'a.zarr', status: 'opening' });
    state.set({ path: '/d/a.zarr', label: 'a.zarr', status: 'opening' });    // no change: nobody is told
    state.set({ status: 'open' });
    assert.deepEqual(seen, [['opening', '/d/a.zarr', 'none'], ['open', '/d/a.zarr', 'opening']]);
    assert.equal(state.get().label, 'a.zarr', 'fields not named keep their value');
});

test('error and failed are cleared by the next change unless it names them', () => {
    const state = createDatasetState();
    state.set({ path: '/d/a.zarr', status: 'open' });
    state.set({ failed: { path: '/d/typo', message: 'Not found' } });
    assert.deepEqual(state.get().failed, { path: '/d/typo', message: 'Not found' });
    state.set({ status: 'opening' });
    assert.equal(state.get().failed, null);
    state.set({ status: 'none', error: 'Could not open' });
    assert.deepEqual([state.get().path, state.get().error], [null, 'Could not open'], 'none forgets the path, keeps the reason');
});

test('subscribe: immediate call, unsubscribe, and a failing subscriber does not stop the others', () => {
    const state = createDatasetState();
    const calls = [];
    const quiet = console.error;
    console.error = () => {};
    try {
        state.subscribe(() => { throw new Error('boom'); });
        const stop = state.subscribe((s) => calls.push(s.status), { immediate: true });
        state.set({ path: '/p', status: 'open' });
        stop();
        state.set({ path: '/q', status: 'open' });
    } finally {
        console.error = quiet;
    }
    assert.deepEqual(calls, ['none', 'open']);
});

test('an unknown status is refused', () => {
    assert.throws(() => createDatasetState().set({ path: '/p', status: 'half-open' }), /Unknown dataset status/);
});

test('open() runs the opener with the source and resolves to the state after it', async () => {
    const state = createDatasetState();
    const asked = [];
    state.setOpener(async (path, { source }) => {
        asked.push([path, source]);
        state.set({ path, label: path, status: 'open' });
    });
    const after = await state.open('/d/a.zarr', { source: 'external' });
    assert.deepEqual(asked, [['/d/a.zarr', 'external']]);
    assert.equal(after.status, 'open');
    await state.open('/d/b.zarr');
    assert.deepEqual(asked.at(-1), ['/d/b.zarr', 'user'], 'the default source is the user');
});

test('open() with no path does nothing; with no opener it says so', async () => {
    const state = createDatasetState();
    await assert.rejects(state.open('/d/a.zarr'), /No dataset can be opened yet/);
    state.setOpener(async () => { throw new Error('must not run'); });
    assert.equal((await state.open('')).status, 'none');
});

test('only the user\'s own choices are user sources', () => {
    assert.deepEqual(USER_SOURCES, ['user', 'external']);
    for (const source of ['user', 'external']) assert.equal(isUserSource(source), true);
    for (const source of ['autosave', 'link', 'view', 'default', 'refresh', undefined]) assert.equal(isUserSource(source), false);
});

test('the title names the dataset while one opens or is open, the app otherwise', () => {
    const open = { path: '/data/projects/bm_aging.zarr', label: 'projects/bm_aging.zarr', status: 'open' };
    assert.equal(documentTitle(open), 'bm_aging.zarr \u00b7 AnnZarro');
    assert.equal(documentTitle({ ...open, status: 'opening' }, 'Atlas'), 'bm_aging.zarr \u00b7 Atlas');
    assert.equal(documentTitle({ ...open, status: 'nodata' }), 'AnnZarro');
    assert.equal(documentTitle({ ...open, status: 'unavailable' }, 'Atlas'), 'Atlas');
    assert.equal(documentTitle({ path: null, status: 'none' }), 'AnnZarro');
    assert.equal(documentTitle(open, ''), 'bm_aging.zarr \u00b7 AnnZarro', 'an empty app name falls back');
    assert.equal(datasetName({ path: 's3://lab/pbmc.zarr/' }), 'pbmc.zarr');
    assert.equal(datasetName({ path: 'C:\\data\\x.h5ad' }), 'x.h5ad');
    assert.equal(datasetName({ path: '/', label: 'root' }), 'root', 'no last segment: the label');
});

test('the shared state is its own instance', () => {
    assert.equal(DatasetState.get().status, 'none');
    assert.notEqual(DatasetState, createDatasetState());
});
