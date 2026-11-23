/**
 * C2a: the Cell Count Plot's controls, without a page (panels/cell-count/controls-model.js).
 *
 *   - the rows each mode shows, in the order of UX 4.1, and the inputs per mode of UX 4.2;
 *   - a mode change keeps every input, and the "Kept for other modes" line names what the mode does not read (CNT-6);
 *   - the compact binning line of UX 4.4, and the bin counts the shared control is given and gives back (CNT-9);
 *   - Height and Color (UX 4.5, CNT-15 to CNT-18): the entries per mode, what each writes, a statistic from the
 *     focused gene (job 5), and what a mode that cannot show the stored choice shows instead, the choice kept;
 *   - a layer and an obsp source follow the focus unless locked (CNT-2, CNT-17);
 *   - the references of a config: a remap round trip of the inputs, Color by, the sets and the statistic (CAT-9);
 *   - the words of VOCABULARY.countPlot that the drawing reads.
 *
 * Run:  node --test annzarro/tests/js/cell-count-controls.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'offline in test' });

const K = await import('../../../static/js/panels/cell-count/controls-model.js');
const M = await import('../../../static/js/utils/count-plot-model.js');
const R = await import('../../../static/js/utils/panel-references.js');
const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
const { SCORE_TYPE } = await import('../../../static/js/utils/score-source.js');

const golden = (name) => JSON.parse(readFileSync(new URL(`../data/golden/${name}.json`, import.meta.url), 'utf8'));
const norm = (config) => M.normalizeCountPlot({ version: 1, ...config }).config;
const obs = (key, extra = {}) => ({ source: { type: 'obs', key }, ...extra });
const C = VOCABULARY.countPlot;

const STRUCTURE = {
    obs: { columns: ['_index', 'cell_type', 'condition', 'depth', 'is_doublet', 'batch', 'sample'],
        columns_info: { cell_type: { type: 'category', n_categories: 6 }, condition: { type: 'category', n_categories: 2 },
            depth: { type: 'float64' }, is_doublet: { type: 'bool' }, batch: { type: 'int64' }, sample: { type: 'category' } } },
    obsm: { dataframes: {}, keys: ['X_umap'] }
};
const TITLES = { 'cell-table-T': 'Table 1', 'cell-table-U': 'Table 2', 'cell-grouping-G': 'Grouping 1', 'gene-signature-S': 'Signature 1' };
const titleOf = (source) => TITLES[source.key];

// --- the rows of each mode (UX 4.1, 4.2) -------------------------------------------------------------------------

test('each mode shows the rows of UX 4.2 and no other', () => {
    const shown = (mode) => {
        const r = K.rowsOf(mode);
        return ['x', 'y', 'split', 'sets'].filter((k) => r[k]).concat(r.value ? [r.value] : []);
    };
    assert.deepEqual(shown('bar'), ['x', 'split', 'height']);
    assert.deepEqual(shown('histogram'), ['x', 'split', 'height']);
    assert.deepEqual(shown('pie'), ['x']);
    assert.deepEqual(shown('hist2d'), ['x', 'y', 'split', 'color']);
    assert.deepEqual(shown('heatmap'), ['x', 'y', 'color']);
    assert.deepEqual(shown('density'), ['x', 'split']);
    assert.deepEqual(shown('density2d'), ['x', 'y', 'split']);
    assert.deepEqual(shown('venn'), ['sets']);
    assert.deepEqual(shown('upset'), ['sets', 'color']);
    assert.equal(K.rowsOf('pie').slices, true, 'a pie\'s X is its Slices');
    assert.deepEqual(K.rowsOf('bar').arrangement, ['stack', 'dodge', 'fill']);
    assert.deepEqual(K.rowsOf('histogram').arrangement, ['stack', 'dodge']);
    assert.equal(K.rowsOf('bar').horizontal && K.rowsOf('histogram').horizontal, true);
    assert.equal(K.rowsOf('pie').ring, true);
});

test('the Mode select groups the modes as UX 4.1 does, with their names', () => {
    assert.deepEqual(C.modeGroups.map((g) => [g.label, [...g.modes]]), [
        ['Counts', ['bar', 'histogram', 'pie']], ['Two inputs', ['hist2d', 'heatmap']], ['Smoothed', ['density', 'density2d']], ['Sets', ['venn', 'upset']]
    ]);
    assert.deepEqual(C.modeGroups.flatMap((g) => g.modes).map((m) => C.modes[m]),
        ['Bar', 'Histogram', 'Pie', '2D histogram', 'Heatmap', 'Density', '2D density', 'Venn', 'UpSet']);
    assert.deepEqual([...M.COUNT_MODES].sort(), C.modeGroups.flatMap((g) => g.modes).sort());
    assert.deepEqual([C.rows.mode, C.rows.x, C.rows.split, C.rows.height, C.rows.labels], ['Mode', 'X', 'Color by', 'Height', 'Labels']);
    assert.deepEqual([C.arrangement.stack, C.arrangement.dodge, C.arrangement.fill], ['Stacked', 'Side by side', '100%']);
});

// --- a mode change keeps every input (CNT-6) ---------------------------------------------------------------------

test('a mode change keeps every input, and switching back restores them', () => {
    const start = norm({ mode: 'hist2d', x: obs('depth'), y: { source: { type: 'obsm', key: 'X_umap', column: '1' } }, split: obs('condition') });
    const bar = norm(K.setMode(start, 'bar'));
    assert.deepEqual([bar.x, bar.y, bar.split], [start.x, start.y, start.split]);
    const back = norm(K.setMode(bar, 'hist2d'));
    assert.deepEqual(back, start);
});

test('"Kept for other modes" names what the mode does not read, sets by their names', () => {
    const config = norm({
        mode: 'bar', x: obs('cell_type'), y: { source: { type: 'obsm', key: 'X_umap', column: '1' } },
        sets: [{ source: { type: 'table', key: 'cell-table-T' } }, { source: { type: 'table', key: 'cell-table-U' } }]
    });
    assert.equal(K.keptLine(config, titleOf), 'Kept for other modes: Y obsm X_umap 1 · Sets: in Table 1, in Table 2');
    assert.equal(K.keptLine(norm({ mode: 'hist2d', x: obs('depth'), y: obs('batch') }), titleOf), '');
    const venn = norm({ ...config, mode: 'venn', split: obs('condition') });
    assert.equal(K.keptLine(venn, titleOf), 'Kept for other modes: X obs cell_type · Y obsm X_umap 1 · Color by obs condition');
    const named = norm({ mode: 'bar', x: obs('cell_type'), sets: [{ source: { type: 'obs', key: 'is_doublet' }, name: 'Doublets' }] });
    assert.equal(K.keptLine(named, titleOf), 'Kept for other modes: Sets: Doublets');
});

// --- the inline binning line (UX 4.4, CNT-9) ---------------------------------------------------------------------

test('the compact binning line says the method, the bins and the range', () => {
    assert.equal(K.binningLine(obs('depth'), 'histogram'), 'Bins: equal width · 50 · auto range');
    assert.equal(K.binningLine(obs('depth'), 'hist2d'), 'Bins: equal width · 100 · auto range');
    assert.equal(K.binningLine(obs('depth', { binning: { method: 'equal_width', bins: 120, range: [0, null] } }), 'histogram'),
        'Bins: equal width · 120 · range 0 to auto');
    assert.equal(K.binningLine(obs('depth', { binning: { method: 'equal_count', bins: 4, zero_bin: true } }), 'bar'),
        'Bins: equal count · 4 · zero bin');
    assert.equal(K.binningLine(obs('depth', { binning: { method: 'manual', thresholds: [0.5, 1.75] } }), 'bar'),
        'Bins: manual thresholds · 0.5, 1.75');
});

test('the binning control is given the count plot\'s bins, and what it gives back is stored without the mode\'s default', () => {
    assert.deepEqual(K.forControl(obs('depth'), 'histogram').binning, { method: 'equal_width', bins: 50 });
    assert.deepEqual(K.forControl(obs('depth'), 'hist2d').binning, { method: 'equal_width', bins: 100 });
    // the count plot's default left out; equal width with nothing else is not written at all
    assert.deepEqual(K.fromControl({ ...obs('depth'), binning: { method: 'equal_width', bins: 50 } }, 'histogram'), obs('depth'));
    // the grouping's default count (10) is a count like any other here, and so is one past the grouping's limit
    assert.deepEqual(K.fromControl({ ...obs('depth'), binning: { method: 'equal_width', bins: 10 } }, 'histogram').binning, { method: 'equal_width', bins: 10 });
    assert.deepEqual(K.fromControl({ ...obs('depth'), binning: { method: 'equal_width', bins: 1500 } }, 'histogram').binning, { method: 'equal_width', bins: 1500 });
    assert.deepEqual(K.fromControl({ ...obs('depth'), binning: { method: 'equal_count', bins: 50 } }, 'bar').binning, { method: 'equal_count' });
    // a stored count survives the config's normaliser and reaches the request
    const config = norm({ mode: 'histogram', x: K.fromControl({ ...obs('depth'), binning: { method: 'equal_width', bins: 1500 } }, 'histogram') });
    const plan = M.planGrid(config, { isNumeric: (s) => s.key === 'depth', levelCount: () => null });
    assert.equal(plan.request.partitionings[0].binning.bins, 1500);
});

// --- Height and Color (UX 4.5) -----------------------------------------------------------------------------------

test('Height offers the count, the shares the plot has bases for, and the statistics', () => {
    const labels = (config) => K.valueChoices(norm(config)).map((c) => c.label);
    assert.deepEqual(labels({ mode: 'bar', x: obs('cell_type') }),
        ['Count', 'Share of all cells shown', 'Mean of…', 'Sum of…', '% above…', 'SD of…', 'z-score of…']);
    assert.deepEqual(labels({ mode: 'bar', x: obs('cell_type'), split: obs('condition') }),
        ['Count', 'Share of all cells shown', 'Share within each X', 'Share within each color', 'Mean of…', 'Sum of…', '% above…', 'SD of…', 'z-score of…']);
    assert.deepEqual(labels({ mode: 'heatmap', x: obs('cell_type'), y: obs('condition') }),
        ['Count', 'Share of the row', 'Share of the column', 'Share of the total', 'Mean of…', 'Sum of…', '% above…', 'SD of…', 'z-score of…',
            'Most frequent level of…']);
    assert.deepEqual(K.valueChoices(norm({ mode: 'pie', x: obs('cell_type') })), []);
    const z = K.valueChoices(norm({ mode: 'bar', x: obs('cell_type') })).find((c) => c.value === 'stat:zscore');
    assert.equal(z.help, "The bar's mean against all counted cells.");
});

test('job 1: shares within each cluster write the share base, and the arrangement is its own field', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition') });
    const next = norm(K.applyValueChoice(config, 'share:x'));
    assert.deepEqual(next.value, { kind: 'share', of: 'x' });
    assert.equal(K.valueChoiceOf(next), 'share:x');
    assert.deepEqual(norm(K.applyValueChoice(next, 'share:all')).value, { kind: 'share' });
    assert.equal(norm(K.applyValueChoice(next, 'count')).value, undefined);
    assert.equal(norm({ ...config, arrangement: 'fill' }).arrangement, 'fill');
});

test('job 5: a statistic starts from the focused gene on X, keeps its source, and the count keeps it stored', () => {
    const config = norm({ mode: 'bar', x: obs('cell_type') });
    const defaults = K.valueDefaults(config, STRUCTURE, 'Mrpl15');
    assert.deepEqual(defaults.measureSource, { type: 'layer', key: 'X', column: 'Mrpl15' });
    const mean = norm(K.applyValueChoice(config, 'stat:mean', defaults));
    assert.deepEqual(mean.value, { kind: 'measure' });
    assert.deepEqual(mean.measure, { stat: 'mean', source: { type: 'layer', key: 'X', column: 'Mrpl15' } });
    const pct = norm(K.applyValueChoice({ ...mean, measure: { ...mean.measure, above: 0.5 } }, 'stat:pct_above', defaults));
    assert.deepEqual(pct.measure, { stat: 'pct_above', source: mean.measure.source, above: 0.5 });
    const sd = norm(K.applyValueChoice(pct, 'stat:sd', defaults));
    assert.equal(sd.measure.above, undefined, 'a threshold is of % above only');
    const counted = norm(K.applyValueChoice(mean, 'count'));
    assert.equal(counted.value, undefined);
    assert.deepEqual(counted.measure, mean.measure);
    // with no focus, the first numeric obs column; with neither, no statistic can be chosen
    assert.deepEqual(K.valueDefaults(config, STRUCTURE, null).measureSource, { type: 'obs', key: 'depth' });
    assert.equal(K.applyValueChoice(config, 'stat:mean', {}), null);
});

test('the most frequent level takes a categorical column that is not an axis, and keeps its factor', () => {
    const config = norm({ mode: 'heatmap', x: obs('cell_type'), y: obs('condition') });
    const d = K.valueDefaults(config, STRUCTURE, null);
    assert.deepEqual(d.factor, obs('is_doublet'));
    const top = norm(K.applyValueChoice(config, 'top_level', d));
    assert.deepEqual(top.value, { kind: 'top_level', factor: obs('is_doublet') });
    assert.equal(K.valueChoiceOf(top), 'top_level');
});

test('a choice the mode cannot show is shown as the count or a share of all, and stays stored', () => {
    const heat = norm({ mode: 'heatmap', x: obs('cell_type'), y: obs('condition'), value: { kind: 'top_level', factor: obs('sample') } });
    const bar = norm(K.setMode(heat, 'bar'));
    assert.equal(K.valueChoiceOf(bar), 'count');
    assert.equal(K.shownConfig(bar).value, undefined);
    assert.deepEqual(bar.value, heat.value, 'stored');
    const split = norm({ mode: 'bar', x: obs('cell_type'), split: obs('condition'), value: { kind: 'share', of: 'split' } });
    const noSplit = norm({ ...split, split: undefined });
    delete noSplit.split;
    assert.equal(K.valueChoiceOf(noSplit), 'share:all');
    assert.deepEqual(K.shownConfig(noSplit).value, { kind: 'share' });
    assert.equal(K.shownConfig(split), split, 'a config the mode shows as it is, is itself');
});

// --- sources and the focus (CNT-2, CNT-17) -----------------------------------------------------------------------

test('a select\'s setting is stored as the source, and a new source keeps only the lock', () => {
    assert.deepEqual(K.sourceFromSetting({ type: 'obs', key: 'cell_type', column: '', history: {} }), { type: 'obs', key: 'cell_type' });
    assert.deepEqual(K.sourceFromSetting({ type: 'obsm', key: 'X_umap', column: '1' }), { type: 'obsm', key: 'X_umap', column: '1' });
    assert.deepEqual(K.sourceFromSetting({ type: 'layer', key: 'X', column: 'Cd3e', layer: 'counts' }), { type: 'layer', key: 'X', column: 'Cd3e' });
    assert.deepEqual(K.sourceFromSetting({ type: SCORE_TYPE, key: 'gene-signature-S', column: 'zscore_mean', layer: 'logged' }),
        { type: SCORE_TYPE, key: 'gene-signature-S', column: 'zscore_mean', layer: 'logged' });
    assert.equal(K.sourceFromSetting({ type: 'none', key: '' }), null);
    const was = { source: { type: 'layer', key: 'X', column: 'Cd3e' }, binning: { method: 'equal_count' }, labels: { 'bin:0': 'low' }, locked: true };
    assert.equal(K.inputFromSource(was, { type: 'layer', key: 'X', column: 'Cd3e' }), was);
    assert.deepEqual(K.inputFromSource(was, { type: 'layer', key: 'X', column: 'Ms4a1' }), { source: { type: 'layer', key: 'X', column: 'Ms4a1' }, locked: true });
    assert.equal(K.inputFromSource(was, null), null);
    assert.deepEqual(K.settingOf(was, {}), { type: 'layer', key: 'X', column: 'Cd3e', locked: true, history: {} });
});

test('an unlocked layer or obsp source follows the focus; a locked one does not; nothing to follow is no change', () => {
    const config = norm({
        mode: 'bar', x: { source: { type: 'layer', key: 'X', column: 'Cd3e' } }, split: { source: { type: 'layer', key: 'X', column: 'Cd4' }, locked: true },
        value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: 'layer', key: 'logged', column: 'Cd3e' } },
        y: { source: { type: 'obsp', key: 'connectivities', column: 'cell_1' } }
    });
    const next = K.followFocus(config, { gene: 'Ms4a1', cell: 'cell_9' });
    assert.equal(next.x.source.column, 'Ms4a1');
    assert.equal(next.split.source.column, 'Cd4', 'locked');
    assert.equal(next.measure.source.column, 'Ms4a1');
    assert.equal(next.y.source.column, 'cell_9');
    assert.equal(K.followFocus(next, { gene: 'Ms4a1', cell: 'cell_9' }), null);
    assert.equal(K.followFocus(norm({ mode: 'bar', x: obs('cell_type') }), { gene: 'Ms4a1' }), null);
    // the lock survives the normaliser and asks nothing new of the engine
    const ctx = { isNumeric: () => true, levelCount: () => null };
    const a = M.planGrid(norm({ mode: 'histogram', x: { source: { type: 'layer', key: 'X', column: 'Cd3e' } } }), ctx).key;
    const b = M.planGrid(norm({ mode: 'histogram', x: { source: { type: 'layer', key: 'X', column: 'Cd3e' }, locked: true } }), ctx).key;
    assert.equal(a, b);
});

test('which sources are numbers, and how many levels an input will have', () => {
    const num = (source) => K.isNumericSource(source, STRUCTURE);
    assert.deepEqual([num({ type: 'obs', key: 'depth' }), num({ type: 'obs', key: 'batch' }), num({ type: 'obs', key: 'cell_type' }),
        num({ type: 'obs', key: 'is_doublet' }), num({ type: 'obsm', key: 'X_umap', column: '0' }), num({ type: 'layer', key: 'X', column: 'Cd3e' }),
        num({ type: 'table', key: 'cell-table-T' }), num({ type: SCORE_TYPE, key: 'gene-signature-S' })],
    [true, true, false, false, true, true, false, true]);
    const n = (p) => K.levelCountOf(p, STRUCTURE);
    assert.deepEqual([n(obs('cell_type')), n(obs('is_doublet')), n(obs('sample')), n({ source: { type: 'table', key: 'T' } }),
        n(obs('cell_type', { levels: ['c:B', 'c:T'] })), n(obs('cell_type', { levels: ['c:B', 'c:T'], rest: 'exclude' }))],
    [6, 2, null, 2, 3, 2]);
});

test('a source is named in a line and on a value axis as UX 4.5 writes it', () => {
    assert.equal(K.inputText({ type: 'obsm', key: 'X_umap', column: '1' }), 'obsm X_umap 1');
    assert.equal(K.inputText({ type: 'table', key: 'cell-table-T' }, titleOf), 'in Table 1');
    assert.equal(K.inputText({ type: 'cell-group', key: 'cell-grouping-G' }, titleOf), 'Grouping 1');
    assert.equal(K.measureSourceName({ type: 'layer', key: 'logged_counts', column: 'Mrpl15' }), 'Mrpl15 · logged_counts');
    assert.equal(C.measure('mean', 'Mrpl15 · logged_counts'), 'Mean of Mrpl15 · logged_counts');
    assert.equal(C.share('all', {}), '% of cells shown');
    assert.equal(C.share('x', { x: 'cell_type' }), '% within each cell_type');
    assert.equal(C.topLevel('sample'), 'Most frequent level of sample');
});

// --- the references and a remap round trip (CAT-9) ---------------------------------------------------------------

R.registerReferences('cell-count', K.countReferences);

test('every source of another panel is a reference: inputs, Color by, the factor, the sets and the statistic', () => {
    const config = norm({
        mode: 'bar', x: { source: { type: 'table', key: 'cell-table-T' } }, y: obs('condition'),
        split: { source: { type: 'cell-group', key: 'cell-grouping-G' } },
        value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: SCORE_TYPE, key: 'gene-signature-S', column: 'zscore_mean' } },
        sets: [{ source: { type: 'table', key: 'cell-table-U' } }, { source: { type: 'obs', key: 'is_doublet' } }]
    });
    const refs = K.countReferences(config);
    assert.deepEqual(refs.map((r) => [r.id, r.via, r.field]), [
        ['cell-table-T', 'partitioning', 'x'], ['cell-grouping-G', 'partitioning', 'split'], ['cell-table-U', 'set', 'sets'],
        ['gene-signature-S', 'measure', 'measure']
    ]);
    assert.deepEqual(R.referencedFields(config, 'cell-count'), ['x', 'split', 'sets', 'measure']);
    const top = norm({ mode: 'heatmap', x: obs('a'), y: obs('b'), value: { kind: 'top_level', factor: { source: { type: 'cell-group', key: 'cell-grouping-G' } } } });
    assert.deepEqual(K.countReferences(top).map((r) => [r.id, r.field]), [['cell-grouping-G', 'value']]);
    assert.deepEqual(K.countReferences(null), []);
    assert.deepEqual(K.countReferences({ x: 'nonsense', sets: 'nope', measure: { source: 7 } }), []);
});

test('a remap round trip: every reference follows the new ids, and back again restores the config', () => {
    const config = norm({
        mode: 'bar', x: { source: { type: 'table', key: 'cell-table-T' } }, split: { source: { type: 'cell-group', key: 'cell-grouping-G' } },
        value: { kind: 'measure' }, measure: { stat: 'mean', source: { type: SCORE_TYPE, key: 'gene-signature-S', column: 'zscore_mean' } },
        sets: [{ source: { type: 'table', key: 'cell-table-U' } }, { source: { type: 'table', key: 'cell-table-T' } }]
    });
    const before = JSON.parse(JSON.stringify(config));
    const forward = { 'cell-table-T': 'cell-table-T2', 'cell-table-U': 'cell-table-U2', 'cell-grouping-G': 'cell-grouping-G2', 'gene-signature-S': 'gene-signature-S2' };
    const [moved] = R.remapReferences([JSON.parse(JSON.stringify(config))], forward);
    assert.equal(moved.x.source.key, 'cell-table-T2');
    assert.equal(moved.split.source.key, 'cell-grouping-G2');
    assert.deepEqual(moved.sets.map((s) => s.source.key), ['cell-table-U2', 'cell-table-T2']);
    assert.equal(moved.measure.source.key, 'gene-signature-S2');
    assert.deepEqual(norm(moved), moved, 'still a normal config');
    const back = Object.fromEntries(Object.entries(forward).map(([a, b]) => [b, a]));
    assert.deepEqual(R.remapReferences([moved], back)[0], before);
    // ids that swap places land each in its own place
    const [swapped] = R.remapReferences([JSON.parse(JSON.stringify(config))], { 'cell-table-T': 'cell-table-U', 'cell-table-U': 'cell-table-T' });
    assert.deepEqual([swapped.x.source.key, ...swapped.sets.map((s) => s.source.key)], ['cell-table-U', 'cell-table-T', 'cell-table-U']);
});

test('the golden count configs read unchanged, and an UpSet\'s style fields are not a bar\'s', () => {
    for (const name of ['cell_count_bar_split_measure', 'cell_count_upset_8_tables']) assert.deepEqual(norm(golden(name)), golden(name));
    const upset = norm(golden('cell_count_upset_8_tables'));
    assert.equal(K.countReferences(upset).length, 8);
    const asBar = K.drawOptions({ ...upset, mode: 'bar' });
    assert.equal(asBar.labels, 'none', "an UpSet's labels: true is no label kind");
    assert.equal(asBar.sort, undefined, "an UpSet's sort by size is not a bar's sort by height");
    const bar = norm(golden('cell_count_bar_split_measure'));
    assert.deepEqual(K.valueChoiceOf(bar), 'stat:mean');
});

// --- the options of the drawing and the labels -------------------------------------------------------------------

test('the drawing\'s options are the style fields the mode has', () => {
    const bar = norm({ mode: 'bar', x: obs('cell_type'), labels: 'count', sort: 'height', reverse: true, horizontal: true, log: true, ring: true });
    assert.deepEqual(K.drawOptions(bar), { labels: 'count', sort: 'height', reverse: true, horizontal: true, log: true, ring: false, fade: false,
        adjust: 1, scale: 'level', layers: null, pointSize: 3, colour: { reverse: false } });
    const pie = { ...bar, mode: 'pie' };
    assert.deepEqual(K.drawOptions(pie), { labels: 'count', sort: 'height', reverse: true, horizontal: false, log: false, ring: true, fade: false,
        adjust: 1, scale: 'level', layers: null, pointSize: 3, colour: { reverse: false } });
    assert.equal(K.drawOptions({ ...bar, labels: 'measure' }).labels, 'none', 'no statistic to print');
    assert.deepEqual(K.labelChoices(bar).map((c) => c.label), ['None', 'Count', 'Share']);
    assert.deepEqual(K.labelChoices({ ...bar, measure: { stat: 'mean', source: { type: 'obs', key: 'depth' } } }).map((c) => c.label),
        ['None', 'Count', 'Share', 'Statistic']);
});

test('the labels shown are the defaults with the input\'s renames, the renames of the config now', () => {
    const made = norm({ mode: 'bar', x: obs('cell_type') });
    const grid = M.readGrid({ reply: { n_shown: 3, n_counted: 3, axes: [{ levels: ['c:B', 'c:T'], n_outside: [0, 0] }] }, counts: [1, 2], measures: null });
    const table = M.countTable(made, grid, [{ input: 'x' }]);
    const live = norm({ ...made, x: obs('cell_type', { labels: { 'c:T': 'T lymphocyte' } }) });
    const [map] = K.shownLabels(made, table, live);
    assert.deepEqual([...map], [['c:B', 'B'], ['c:T', 'T lymphocyte']]);
    assert.deepEqual(K.levelTotals({ dims: [2, 3], cells: 6, counts: [1, 2, 3, 4, 5, 6] }, 0), [6, 15]);
    assert.deepEqual(K.levelTotals({ dims: [2, 3], cells: 6, counts: [1, 2, 3, 4, 5, 6] }, 1), [5, 7, 9]);
});

test('the words the drawing reads are VOCABULARY.countPlot\'s, and none says "measure" or "metric"', () => {
    for (const key of ['count', 'fill', 'hoverCount', 'hoverShare']) assert.equal(typeof C[key], 'string', key);
    for (const key of ['share', 'measure', 'topLevel']) assert.equal(typeof C[key], 'function', key);
    assert.deepEqual(Object.keys(C.csv).sort(), ['count', 'measure', 'share']);
    const said = [C.count, C.fill, C.hoverCount, C.hoverShare, ...Object.values(C.csv), ...Object.values(C.labels), ...Object.values(C.rows),
        ...Object.values(C.value.share), ...Object.values(C.value.stat), C.value.topLevel, ...Object.values(C.valueHelp),
        ...M.MEASURE_STATS.map((s) => C.measure(s, 'x', 1)), ...M.SHARE_BASES.map((b) => C.share(b, { x: 'a', y: 'b', split: 'c' }))];
    for (const text of said) {
        for (const word of VOCABULARY.never.statistic) assert.ok(!text.toLowerCase().includes(word), `${text} says ${word}`);
        assert.ok(!/colour/i.test(text), `${text}: US spelling`);
    }
});

test('a density\'s own options: the bandwidth adjust from 0.1 to 10, curves by level size, a 2D density as an image', () => {
    assert.equal(K.rowsOf('density').density, 1);
    assert.equal(K.rowsOf('density2d').density, 2);
    assert.equal(K.rowsOf('bar').density, 0);
    const d = norm({ mode: 'density2d', x: obs('depth'), y: obs('score'), adjust: 2.5, scale: 'size', style: 'image' });
    const o = K.drawOptions(d);
    assert.deepEqual([o.adjust, o.scale, o.layers.image], [2.5, 'size', true]);
    assert.deepEqual([K.drawOptions({ ...d, mode: 'density' }).layers, K.drawOptions({ ...d, mode: 'bar' }).adjust], [null, 1]);
    assert.equal(K.drawOptions({ ...d, adjust: 40 }).adjust, 1, 'out of range: the default');
    assert.deepEqual(K.parseAdjust(' 0.5 '), { ok: true, value: 0.5 });
    assert.deepEqual(K.parseAdjust(''), { ok: true, value: 1 });
    assert.deepEqual(K.parseAdjust('11'), { ok: false, message: 'Enter a number from 0.1 to 10.' });
    assert.deepEqual(K.parseAdjust('x'), { ok: false, message: 'Enter a number from 0.1 to 10.' });
});

test('a density never asks for a zero bin: one kept from a histogram stays stored and is not sent', () => {
    const hist = norm({ mode: 'histogram', x: obs('depth', { binning: { method: 'equal_width', zero_bin: true } }) });
    const dens = norm(K.setMode(hist, 'density'));
    assert.equal(dens.x.binning.zero_bin, true, 'stored');
    const shown = K.shownConfig(dens);
    assert.equal(shown.x.binning.zero_bin, undefined);
    const plan = M.planGrid(shown, { isNumeric: () => true, levelCount: () => null });
    assert.equal(plan.request.partitionings[0].binning.zero_bin, undefined);
    assert.equal(K.shownConfig(hist), hist, 'a histogram keeps it');
});

test('a 2D density\'s layers: the stored ones, else the old style, else the default of the Color by', () => {
    const d = norm({ mode: 'density2d', x: obs('depth'), y: obs('score') });
    assert.deepEqual(K.drawOptions(d).layers, { image: false, lines: false, fill: true, points: false }, 'one group: filled isolines');
    const split = { ...d, split: obs('condition') };
    assert.deepEqual(K.drawOptions(split).layers, { image: false, lines: true, fill: true, points: false }, 'a Color by: filled isolines with lines');
    assert.deepEqual(K.drawOptions({ ...split, style: 'image' }).layers, { image: true, lines: false, fill: false, points: false });
    assert.deepEqual(K.drawOptions({ ...split, style: 'contours' }).layers, { image: false, lines: true, fill: false, points: false });
    assert.deepEqual(K.drawOptions({ ...split, style: 'image', layers: { image: true, lines: true } }).layers, { image: true, lines: true, fill: false, points: false });
    assert.equal(K.drawOptions({ ...split, mode: 'density' }).layers, null, 'a 1D density has no layers');
});
