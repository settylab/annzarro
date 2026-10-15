/**
 * The dataset browser's logic (static/js/utils/dataset-browser-model.js): row labels, chips,
 * sorting, places, breadcrumb, the dataset opened at start, and the keys a dataset lacks.
 *
 * Run:  node --test annzarro/tests/js/dataset-browser-model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../../../static/js/utils/dataset-browser-model.js');

const S = (name, extra = {}) => ({ kind: 'store', path: `/d/${name}`, name, cells: 10, genes: 5, format: 'zarr format 2', modified: 1_700_000_000, ...extra });
const F = (name, extra = {}) => ({ kind: 'folder', path: `/d/${name}`, name, ...extra });
const names = rows => rows.map(r => r.name);

test('formats are named as the table shows them and map to one chip', () => {
    assert.equal(M.formatLabel('h5ad'), 'h5ad');
    assert.equal(M.formatLabel('zarr format 2'), 'zarr v2');
    assert.equal(M.formatLabel('zarr format 3'), 'zarr v3');
    assert.equal(M.formatLabel('zarr format 3, sharded'), 'zarr v3 sharded');
    assert.equal(M.formatLabel(null), '');
    assert.deepEqual(['h5ad', 'zarr format 2', 'zarr format 3', 'zarr format 3, sharded', null].map(M.formatKey),
        ['h5ad', 'zarr2', 'zarr3', 'sharded', null]);
});

test('counts and dates', () => {
    assert.equal(M.countLabel(8090), '8,090');
    assert.equal(M.countLabel(null), '');
    assert.match(M.dateLabel(1_700_000_000), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(M.dateLabel(0), '');
    assert.equal(M.openedLabel(0), '', 'an opened time of 0 is "not known"');
    assert.match(M.openedLabel(1_700_000_000_000), /^\d{4}-\d{2}-\d{2}$/);
});

test('the match badge names the match against the view', () => {
    assert.equal(M.matchBadge({ match: 'same' }), 'same cells and genes');
    assert.equal(M.matchBadge({ match: 'fields' }), 'same cells and genes');
    assert.equal(M.matchBadge({ match: 'counts' }), 'same size');
    assert.equal(M.matchBadge({ match: 'name-different' }), 'same name, other size');
    assert.equal(M.matchBadge({ match: 'name' }), 'same name');
    assert.equal(M.matchBadge({ match: 'other' }), '');
    assert.equal(M.matchesView({ match: 'other' }), false);
});

test('a row reads as its name, counts, format, date and match', () => {
    const text = M.rowDescription(S('a.zarr', { cells: 8090, genes: 16285, match: 'same' }));
    assert.match(text, /8,090 cells, 16,285 genes, zarr v2, modified \d{4}-\d{2}-\d{2}, same cells and genes/);
    assert.match(M.rowDescription(S('b.zarr', { error: 'Not readable' })), /cannot be opened: Not readable/);
    assert.equal(M.rowDescription(F('x')), 'folder');
});

test('chips narrow stores by format, cell band, age and match; folders by the match only', () => {
    const now = 1_700_000_000 + 3 * 86400;
    const rows = [
        S('a.zarr', { cells: 50_000 }), S('b.h5ad', { format: 'h5ad', cells: 2_000_000 }),
        S('c.zarr', { format: 'zarr format 3, sharded', cells: 20_000_000, modified: 1_600_000_000 }),
        S('d.zarr', { error: 'bad', cells: null }), F('proj')
    ];
    const f = M.emptyFilters();
    assert.equal(M.applyFilters(rows, f, now).length, 5, 'no chip, nothing narrowed');
    f.formats.add('h5ad');
    assert.deepEqual(names(M.applyFilters(rows, f, now)), ['b.h5ad', 'proj']);
    f.formats.clear(); f.cells.add('gt10m'); f.cells.add('lt100k');
    assert.deepEqual(names(M.applyFilters(rows, f, now)), ['a.zarr', 'c.zarr', 'proj'], 'two bands are an "or"');
    f.cells.clear(); f.modified = 'week';
    assert.deepEqual(names(M.applyFilters(rows, f, now)), ['a.zarr', 'b.h5ad', 'd.zarr', 'proj']);
    f.modified = ''; f.unreadable = false;
    assert.ok(!names(M.applyFilters(rows, f, now)).includes('d.zarr'));
    f.unreadable = true; f.matches = true;
    assert.deepEqual(M.applyFilters([...rows, S('m.zarr', { match: 'same' })], f, now).map(r => r.name), ['m.zarr']);
    assert.equal(M.filtersActive(f), true);
    assert.equal(M.filtersActive(M.emptyFilters()), false);
});

test('sorting keeps folders first and unreadable stores last, whatever the column and direction', () => {
    const rows = [S('b.zarr', { cells: 5 }), S('bad.zarr', { error: 'x', cells: 999 }), F('z'), S('a.zarr', { cells: 50 }), F('m'), S('n.zarr', { cells: null })];
    assert.deepEqual(names(M.sortRows(rows, 'name', 'asc')), ['m', 'z', 'a.zarr', 'b.zarr', 'n.zarr', 'bad.zarr']);
    assert.deepEqual(names(M.sortRows(rows, 'name', 'desc')), ['z', 'm', 'n.zarr', 'b.zarr', 'a.zarr', 'bad.zarr']);
    assert.deepEqual(names(M.sortRows(rows, 'cells', 'desc')), ['m', 'z', 'a.zarr', 'b.zarr', 'n.zarr', 'bad.zarr'], 'a store without the value goes after those with one');
    assert.deepEqual(names(M.sortRows(rows, 'cells', 'asc')), ['m', 'z', 'b.zarr', 'a.zarr', 'n.zarr', 'bad.zarr']);
    assert.deepEqual(names(M.sortRows(rows, null)), ['z', 'm', 'b.zarr', 'a.zarr', 'n.zarr', 'bad.zarr'], 'null keeps the order given, within the ranks');
});

test('numbers sort numerically in names too (liver_2 before liver_10)', () => {
    const rows = [S('liver_10.zarr'), S('liver_2.zarr')];
    assert.deepEqual(names(M.sortRows(rows, 'name')), ['liver_2.zarr', 'liver_10.zarr']);
});

test('a header press sorts largest or newest first for numbers and dates, then reverses', () => {
    assert.deepEqual(M.nextSort(null, 'name'), { key: 'name', dir: 'asc' });
    assert.deepEqual(M.nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
    assert.deepEqual(M.nextSort({ key: 'name', dir: 'desc' }, 'name'), { key: 'name', dir: 'asc' });
    assert.deepEqual(M.nextSort({ key: 'name', dir: 'asc' }, 'cells'), { key: 'cells', dir: 'desc' });
    assert.deepEqual(M.nextSort({ key: 'cells', dir: 'desc' }, 'cells'), { key: 'cells', dir: 'asc' });
    assert.equal(M.ariaSort({ key: 'cells', dir: 'desc' }, 'cells'), 'descending');
    assert.equal(M.ariaSort({ key: 'cells', dir: 'desc' }, 'name'), 'none');
});

test('search rows by name or relative path, substring or regex', () => {
    const rows = [S('liver.zarr', { rel_path: 'proj/liver.zarr' }), S('lung.zarr', { rel_path: 'lung.zarr' })];
    assert.deepEqual(names(M.searchRows(rows, 'proj/').rows), ['liver.zarr']);
    assert.deepEqual(names(M.searchRows(rows, '^lu', { regex: true }).rows), ['lung.zarr']);
    assert.equal(M.searchRows(rows, '(', { regex: true }).compiled.error !== null, true);
    assert.equal(M.searchRows(rows, '(', { regex: true }).rows.length, 2, 'an invalid regex filters nothing');
});

test('a regex is anchored to the name or to the path, not to both joined; a substring is literal', () => {
    const rows = [S('deep.zarr', { rel_path: 'projects/deep.zarr' }), S('a.b.zarr'), S('axb.zarr')];
    assert.deepEqual(names(M.searchRows(rows, '^deep\\.zarr$', { regex: true }).rows), ['deep.zarr']);
    assert.deepEqual(names(M.searchRows(rows, '^projects/', { regex: true }).rows), ['deep.zarr']);
    assert.deepEqual(names(M.searchRows(rows, 'a.b').rows), ['a.b.zarr'], 'the dot is only a dot');
    assert.deepEqual(names(M.searchRows(rows, '(').rows), [], 'an unbalanced bracket is only text');
    assert.deepEqual(names(M.searchRows(rows, '').rows), ['deep.zarr', 'a.b.zarr', 'axb.zarr']);
});

test('type-ahead finds the first name that starts with the typed text and cycles one letter', () => {
    const rows = [S('alpha.zarr'), S('beta.zarr'), S('bravo.zarr'), S('charlie.zarr')];
    assert.equal(M.typeAheadIndex(rows, 'b', -1), 1);
    assert.equal(M.typeAheadIndex(rows, 'b', 1), 2, 'the same letter again goes to the next');
    assert.equal(M.typeAheadIndex(rows, 'b', 2), 1, 'and wraps');
    assert.equal(M.typeAheadIndex(rows, 'br', 1), 2);
    assert.equal(M.typeAheadIndex(rows, 'zz', 0), -1);
    assert.equal(M.typeAheadIndex(rows, '', 0), -1);
});

test('places: recent and pinned, the data directory, admin roots, a restricted user\'s grants, remote', () => {
    const root = [{ kind: 'folder', name: 'extra', path: '/srv/extra', admin_root: true }, { kind: 'folder', name: 'sub', path: '/d/sub' }];
    const labels = places => places.map(p => p.label);
    assert.deepEqual(labels(M.buildPlaces({ me: {}, rootEntries: root })), ['Recent', 'Pinned', 'Data directory', 'extra']);
    assert.deepEqual(labels(M.buildPlaces({ me: { remote_stores: true }, rootEntries: [] })), ['Recent', 'Pinned', 'Data directory', 'Remote']);
    const grants = [{ kind: 'folder', name: 'liver', path: '/priv/liver' }, { kind: 'store', name: 'x.zarr', path: '/priv/x.zarr' }];
    const restricted = M.buildPlaces({ me: { restricted: true }, rootEntries: grants });
    assert.deepEqual(labels(restricted), ['Recent', 'Pinned', 'Your datasets', 'liver']);
    assert.equal(restricted[3].title, 'liver', 'the path above a grant is not disclosed');
});

test('the breadcrumb goes from the place to the folder, each part a folder to go back to', () => {
    assert.deepEqual(M.breadcrumbs({ rootLabel: 'Data directory', folder: '/d', rel: '.' }), [{ label: 'Data directory', path: '' }], 'the data directory listing is the place itself');
    assert.deepEqual(M.breadcrumbs({ rootLabel: 'Data directory', folder: '', rel: '' }), [{ label: 'Data directory', path: '' }]);
    assert.deepEqual(M.breadcrumbs({ rootLabel: 'Data directory', folder: '/d/projects/liver', rel: 'projects/liver' }), [
        { label: 'Data directory', path: '' }, { label: 'projects', path: '/d/projects' }, { label: 'liver', path: '/d/projects/liver' }
    ]);
    // an admin root is outside the data directory: its own crumbs start at the root
    assert.deepEqual(M.breadcrumbs({ rootLabel: 'extra', rootPath: '/srv/extra', folder: '/srv/extra/a/b', rel: '../../srv/extra/a/b' }), [
        { label: 'extra', path: '/srv/extra' }, { label: 'a', path: '/srv/extra/a' }, { label: 'b', path: '/srv/extra/a/b' }
    ]);
    assert.deepEqual(M.breadcrumbs({ rootLabel: 'Data directory', folder: '/elsewhere/x', rel: '../elsewhere/x' }), [
        { label: 'Data directory', path: '' }, { label: 'x', path: '/elsewhere/x' }
    ]);
});

test('at start: the most recent readable dataset, else the only one, else none', () => {
    const recents = [{ path: 'gone', status: 'unavailable', error: 'Not available' }, { path: 's3://x', status: 'unchecked' }, { path: '/d/b.zarr' }, { path: '/d/a.zarr' }];
    assert.equal(M.firstDatasetChoice(recents, [{ path: '/d/a.zarr' }, { path: '/d/b.zarr' }]), '/d/b.zarr');
    assert.equal(M.firstDatasetChoice([], [{ path: '/d/a.zarr' }]), '/d/a.zarr');
    assert.equal(M.firstDatasetChoice([], [{ path: '/d/a.zarr' }, { path: '/d/b.zarr' }]), null, 'never an arbitrary store of several');
    assert.equal(M.firstDatasetChoice([], [{ path: '/d/a.zarr', error: 'bad' }]), null);
    assert.equal(M.firstDatasetChoice([], []), null);
    assert.equal(M.firstDatasetChoice([{ path: 'gone', status: 'unavailable' }], [{ path: '/d/a.zarr' }]), '/d/a.zarr');
});

test('keys the open panels use that another dataset lacks', () => {
    const structure = { obs: { columns: ['cell_type', 'sample'] }, obsm: { keys: ['X_umap'] }, layers: { keys: ['counts'] } };
    const panels = { 'scatter-1': { id: 'scatter-1', colorBy: { type: 'obs', key: 'cell_type' }, x: 'X_umap', title: 'sample plot' }, 't-1': { layer: 'counts', gene: 'Actb' } };
    const used = M.keysUsedByPanels(panels, structure);
    assert.deepEqual(used.map(u => u.key).sort(), ['X_umap', 'cell_type', 'counts']);
    const details = { readable: true, remote: false, obs_columns: [{ name: 'sample', kind: 'string' }], obs_columns_total: 1, obsm_keys: ['X_umap'], obsm_total: 1, layers_keys: [], layers_total: 0 };
    assert.deepEqual(M.missingKeys(used, details).map(u => u.key).sort(), ['cell_type', 'counts']);
    assert.deepEqual(M.missingKeys(used, { ...details, obs_columns_total: 900 }).map(u => u.key), ['counts'], 'a capped list is not judged');
    assert.deepEqual(M.missingKeys(used, { ...details, remote: true }), [], 'a remote store lists no keys');
    assert.deepEqual(M.missingKeys(used, { readable: false }), []);
    assert.deepEqual(M.keysUsedByPanels(null, structure), []);
});

test('the summary under the table', () => {
    assert.equal(M.countSummary({ stores: 4, folders: 1, query: 'liver' }), "4 datasets and 1 folder match 'liver'");
    assert.equal(M.countSummary({ stores: 1, folders: 0, query: '' }), '1 dataset');
    assert.equal(M.countSummary({ stores: 2, folders: 0, query: 'x', truncated: true }), "2 datasets match 'x'; the search stopped at its limit");
    assert.equal(M.countSummary({ stores: 500, folders: 0, query: '', sortedAmong: 500 }), '500 datasets; sorted among 500 loaded');
});
