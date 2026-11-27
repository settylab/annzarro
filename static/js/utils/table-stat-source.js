/**
 * The page's side of the `table-stat` source: a Cell Table's passing cells as the cells whose statistic colours a Gene Plot, or
 * is its x, y or z axis (offered-removal-080.md 10.1, SO-8c). Each gene's value is one statistic (mean, fraction of cells, mean of
 * expressing cells, sum, SD; utils/group-statistics.js) of that gene over the table's cells, on a layer, with the table's
 * Expressed above (Methods of the table) as the threshold.
 *
 * A setting is `{type, key, stat, layer, label?}` (type `table-stat`): the table's panel id, the statistic and the layer. It has
 * no group: the table IS the group of cells. The server gets the table's bitset as the route's `sets` and `member`
 * (`shape: "genes"`, core/gene_moments.py): nothing is resolved there.
 *
 * THE TABLE'S ROWS CHANGE. The axis FOLLOWS the table's current cells, as a signature follows its genes: the group source of the
 * table (utils/group-host.js, a grouping of one table factor) is an edit when its bitset changes (a filter, a row added or
 * removed), and a plot shows the values it has while the new ones are on their way (the state `updating`), applied after the
 * usual short pause when the estimate is live and held behind Update when it is not. Its key is the bitset's hash, so the
 * same rows are asked once however many axes read them. A table that is being built gates it (the table's own notices); a table
 * with no rows says so; a table that is gone says so, and the plot keeps its setting.
 *
 * The statistics, the aggregation button and the grading are the group statistic's (utils/group-stat-model.js). The structure
 * of the provider follows utils/group-stat-source.js.
 */
import { drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP } from './coverage.js';
import { describeSource, paintProgress, sentenceOf, coverageKindOf } from './source-notices.js';
import { actions } from './source-actions.js';
import { createHostBinding, isVisible, panelIdOf } from './host-binding.js';
import { registerSource, SourceUnavailable } from './source-registry.js';
import { registerPanelSourceType } from './panel-references.js';
import { groupSources } from './group-host.js';
import { VOCABULARY } from './vocabulary.js';
import { layerFacts, datasetLayersNow } from './score-source.js';
import { STATISTIC_INFO } from './group-statistics.js';
import { STAT_SYMBOLS } from './aggregation-symbols.js';
import * as M from './group-stat-model.js';

/** The type of the source this module provides: what a consumer's setting names. */
const TYPE = 'table-stat';

/** The panel type whose panels are Cell Tables. */
const TABLE_PANEL = 'cell-table';

const A = VOCABULARY.aggregation;

const PanelManager = {
    getPanel: (id) => (globalThis.PanelManager ? globalThis.PanelManager.getPanel(id) : null),
    getAllPanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getAllPanels() : []),
    getActivePanels: () => (globalThis.PanelManager ? globalThis.PanelManager.getActivePanels() : []),
    reopenClosedPanel: (id, opts) => globalThis.PanelManager.reopenClosedPanel(id, opts)
};

const isTable = (panel) => !!panel && typeof panel.getType === 'function' && panel.getType() === TABLE_PANEL;

function tablePanel(id) {
    const panel = id ? PanelManager.getPanel(id) : null;
    return isTable(panel) ? panel : null;
}

/** Every Cell Table, open or closed, in the order they were made: [{id, title, open}]. A closed one is read from what it kept. */
function tableList() {
    const open = new Set(PanelManager.getActivePanels().map((p) => p.getId()));
    return PanelManager.getAllPanels().filter(isTable).map((p) => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()) }));
}

/** The title of the table a setting names, or what it was called when last seen (the setting's `label`). */
function tableTitle(setting) {
    const panel = tablePanel(setting && setting.key);
    return panel ? panel.getTitle() : (setting && (setting.label || setting.key)) || '';
}

const kindsNow = () => layerFacts(datasetLayersNow() || [M.DEFAULT_LAYER]).kinds;
const layersNow = () => datasetLayersNow() || [M.DEFAULT_LAYER];

/** Write into a consumer's setting what it is called: `label`, the table's title, and the two lines a colour bar is titled by. */
function nameSetting(setting) {
    const title = tableTitle(setting);
    const panel = tablePanel(setting.key);
    const methods = panel && typeof panel.getMethods === 'function' ? panel.getMethods() : {};
    const above = M.thresholdOf(methods);
    const threshold = ['fraction_of_cells', 'mean_expressing'].includes(M.statOf(setting)) ? ` (> ${Number(above.toPrecision(4))})` : '';
    const lines = [title, `${VOCABULARY.cellGene.statistic[M.statOf(setting)]}${threshold} · ${M.layerOf(setting)}`].join('\n');
    const changed = (!!title && setting.label !== title) || setting.labelFull !== lines;
    if (title) setting.label = title;
    setting.labelFull = lines;
    return changed;
}

// ---------------------------------------------------------------------------------------------- the item picker

/** The statistic and layer menus, the group statistic's. */
const aggregate = {
    sections: () => [{ heading: A.sections.cellTables, empty: 'No cell tables yet', entries: tableList().map((t) => ({ entry: t.id, text: t.title })) }],
    start: (id, layer, previous = null) => {
        const held = { type: TYPE, key: id, stat: previous && previous.type === TYPE ? M.statOf(previous) : M.DEFAULT_STAT, layer };
        const p = M.pairAfter(held, 'layer', layer, kindsNow(), layersNow());
        return { ...held, stat: p.stat, layer: p.layer, label: tableTitle({ key: id }) };
    },
    entryOf: (setting) => setting.key,
    layerOf: (setting) => M.layerOf(setting),
    methods: (setting) => ({
        options: M.statMenu(setting, kindsNow()).options.map((o) => ({ value: o.value, name: STATISTIC_INFO.find((m) => m.value === o.value).label,
            symbol: STAT_SYMBOLS[o.value], ...(o.value === M.ZSCORE ? { disabled: true, title: VOCABULARY.cellGene.zscoreCannot.table } : { disabled: !!o.disabled, title: o.title || '' }) })),
        chosen: M.statOf(setting)
    }),
    layers: (setting) => M.layerMenu(setting, kindsNow(), layersNow()),
    after: (setting, kind, value) => {
        const p = M.pairAfter(setting, kind === 'method' ? 'stat' : 'layer', value, kindsNow(), layersNow());
        return { stat: p.stat, layer: p.layer, say: p.say };
    },
    symbolOf: (setting) => STAT_SYMBOLS[M.statOf(setting)]
};

// ---------------------------------------------------------------------------------------------- notices

/** What a table's notices call things (utils/source-notices.js). */
const VOCAB = Object.freeze({
    thing: 'cell table', source: 'cell table', result: 'table statistic', Computing: 'Computing', progressUnit: 'values',
    found: 'cells', act: { to: 'read', ing: 'reading' },
    tags: { computing: 'Table statistic…', refused: 'Table statistic refused', failed: 'Table statistic failed' },
    off: 'Cell Table is turned off on this server.',
    states: {
        unset(snap, f) {
            return f.out('unset', 'notice', 'No table', 'No cell table is chosen.', '', [f.choose]);
        },
        empty(snap, f) {
            return f.out('empty', 'notice', 'No cells', `${f.t} has no rows, so there is nothing to draw.`, 'Clear its filter, or choose another table.', [f.open, f.choose]);
        }
    }
});

/** A table with no passing row has moments of no cell: it says so (the values are there, and say nothing). */
const isEmpty = (snap) => !!(snap && snap.values && snap.values.reply && Number(snap.values.reply.n_group) === 0);

const describe = (snap, ctx = {}) => describeSource(isEmpty(snap) ? { ...snap, state: 'empty' } : snap, ctx, VOCAB);

const roleWord = (role) => (role === 'color' ? 'colour' : role);

const unavailable = (notice, coverage, state = null) => new SourceUnavailable(notice.headline, notice, coverage, state, TYPE);

const missingCoverage = (notice, setting, unit, total, kind) => Coverage.missing(GAP.UNAVAILABLE, sentenceOf(notice),
    { source: `cell table ${tableTitle(setting)}`, unit, total, kind });

// ---------------------------------------------------------------------------------------------- records

function stillUsed(rec) {
    const panel = rec.panelId ? PanelManager.getPanel(rec.panelId) : null;
    if (!panel || typeof panel.getConfig !== 'function') return true;
    const s = panel.getConfig()[rec.role];
    return !!(s && s.type === TYPE && s.key === rec.tableId && M.layerOf(s) === rec.layer);
}

function refreshPanel(host) {
    const panel = PanelManager.getPanel(panelIdOf(host));
    const reload = panel && (panel.refreshPlot || panel.refreshTable);
    if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
}

function drawTablePlaceholder(host, notice) {
    if (!host) return;
    const unit = 'genes';
    const cov = Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'table statistic', unit, total: null, kind: coverageKindOf(notice) });
    drawPlaceholder(host, cov, unit, {
        actions: notice.actions,
        say: { severity: notice.severity === 'error' ? 'error' : 'notice', headline: notice.headline, lines: notice.text ? [notice.text] : [] }
    });
    const box = host.querySelector('.coverage-placeholder');
    if (box) {
        box.dataset.scoreState = notice.state;
        paintProgress(box, notice.progress || null, sentenceOf(notice));
    }
    host.__sourcePlaceholder = true;
}

const PROVIDER = 'plot-table-stat';

let _binding = null;

/** The handle a record reads: the moments of the table's cells, asked as a group source of the table's own (`M.tableCellsId`). */
function openRecord(host, role, setting, onChange) {
    const { sources } = groupSources();
    const id = setting.key;
    const consumer = { kind: 'plot', role, panelId: panelIdOf(host), host };
    const rec = { tableId: id, layer: M.layerOf(setting), consumer, handle: null };
    const withTitle = (snap) => ({ ...snap, title: snap.title || tableTitle({ key: id }) });
    const moments = sources.watchGenes(M.tableCellsId(id), {
        consumer, option: { group: M.IN_GROUP, layer: M.layerOf(setting), member: true }, visible: () => isVisible(host), onChange: (snap) => onChange(withTitle(snap))
    });
    rec.handle = {
        read: () => withTitle(moments.read()),
        release: () => moments.release(),
        sharers: () => moments.sharers(),
        compute: () => moments.compute(),
        retry: () => moments.retry(),
        cancel: () => moments.cancel()
    };
    return rec;
}

function binding() {
    if (!_binding) {
        _binding = createHostBinding({
            id: PROVIDER,
            open: openRecord,
            matches: (rec, setting) => rec.tableId === setting.key && rec.layer === M.layerOf(setting),
            describe,
            stillUsed,
            stale: (rec, snap) => (!!rec.drawnKey && !!snap.title && snap.title !== rec.setting.label)
                || (rec.drawnKey === null && rec.drawnKind !== undefined && coverageKindOf(snap) !== rec.drawnKind),
            refresh: refreshPanel,
            visibilityChanged: () => groupSources().sources.visibilityChanged(),
            placeholder: drawTablePlaceholder
        });
    }
    return _binding;
}

// ---------------------------------------------------------------------------------------------- the series

/** moments -> {stat -> values}: a statistic is made once from the moments it is read of. */
const DERIVED = new WeakMap();

function valuesOf(moments, stat, genes) {
    let byStat = DERIVED.get(moments);
    if (!byStat) DERIVED.set(moments, byStat = new Map());
    let values = byStat.get(stat);
    if (!values) byStat.set(stat, values = Array.from(M.statValues(stat, moments, genes)));
    return values;
}

function loadSeries(setting, { host, role, expected, unit = 'genes', quiet = false }) {
    nameSetting(setting);
    if (!host || !setting.key) {
        const notice = describe({ state: 'unset', title: '' }, { role: roleWord(role) });
        throw unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped'));
    }
    const rec = binding().recordFor(host, role, setting);
    const snap = rec.handle.read();
    if (snap.values && snap.values.moments) {
        if (isEmpty(snap)) {
            const notice = describe(snap, { role: roleWord(role) });
            rec.drawnKey = null;
            rec.drawnKind = 'stopped';
            binding().paint(host);
            throw unavailable(notice, missingCoverage(notice, setting, unit, expected, 'stopped'), 'empty');
        }
        rec.drawnKey = snap.shownKey || snap.key;
        rec.drawnKind = undefined;
        binding().paint(host);
        const values = valuesOf(snap.values.moments, M.statOf(setting), Number(snap.values.reply.n_var));
        return { type: 'numerical', values, coverage: Coverage.complete(values.length, 'genes') };
    }
    rec.drawnKey = null;
    rec.drawnKind = coverageKindOf(snap);
    const ctx = { role: roleWord(role), sharers: rec.handle.sharers() };
    const notice = describe(snap, ctx) || describe({ ...snap, state: 'estimating' }, ctx);
    if (!(quiet && ['idle', 'estimating', 'queued', 'computing', 'updating'].includes(snap.state))) binding().paint(host);
    throw unavailable(notice, missingCoverage(notice, setting, unit, expected, coverageKindOf(snap)), snap.state);
}

function loadForPlot(setting, { host, role, expected, unit = 'genes', signal }) {
    return binding().loadWhenReady((quiet) => loadSeries(setting, { host, role, expected, unit, quiet }), { host, role }, signal);
}

// ---------------------------------------------------------------------------------------------- actions

function chooser(host, role) {
    const tile = host.closest ? host.closest('.tile') : null;
    const select = tile && tile.querySelector(`.axis-key-select[data-axis="${role}"]`);
    if (!select) return null;
    return { focus() { if (select.scrollIntoView) select.scrollIntoView({ block: 'nearest' }); select.focus(); } };
}

function openTable(id, nextTo = null) {
    const panel = tablePanel(id);
    if (!panel) return null;
    if (PanelManager.getActivePanels().includes(panel)) {
        const tile = typeof document !== 'undefined' ? document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`) : null;
        if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
        return panel;
    }
    return PanelManager.reopenClosedPanel(id, { nextTo });
}

actions.register({
    id: PROVIDER,
    owns: (host) => !!binding().shownRecord(host),
    actions: {
        'score-compute': { target: (host) => (binding().recordsOf(host).size ? host : null), run: (host) => { for (const r of binding().recordsOf(host).values()) r.handle.compute(); } },
        'score-cancel': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { rec.handle.cancel(); } },
        'score-retry': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { rec.handle.retry(); } },
        'score-update': { target: (host) => binding().shownRecord(host) || null, run: (rec) => { groupSources().sources.update(M.tableCellsId(rec.tableId)); } },
        'score-open': { target: (host) => { const rec = binding().shownRecord(host); return rec && tablePanel(rec.tableId) ? rec : null; },
            run: (rec, host) => { openTable(rec.tableId, panelIdOf(host)); } },
        'score-choose': { target: (host) => { const rec = binding().shownRecord(host); return rec ? chooser(host, rec.role) : null; }, run: (place) => { place.focus(); } }
    }
});

// ---------------------------------------------------------------------------------------------- events from the page

/** Panels were added, removed, closed, reopened or renamed: a deleted table shows, a returned one resolves, a renamed one is named again. */
function panelsChanged() {
    if (!_binding || !_binding.hosts().length) return;
    const { sources } = groupSources();
    sources.recheck();
    sources.contextChanged();
    for (const host of _binding.hosts()) {
        for (const rec of _binding.recordsOf(host).values()) {
            if (rec.drawnKey && tableTitle(rec.setting) !== rec.setting.label) _binding.refreshSoon(host);
        }
        _binding.schedulePaint(host);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
}

// ---------------------------------------------------------------------------------------------- the provider

// a Gene Plot's axis of a table's cells follows its table in a remap
registerPanelSourceType(TYPE);

registerSource({
    type: TYPE,
    valueType: 'numerical',
    entity: 'genes',
    consumers: ['gene-plot'],
    axes: ['x', 'y', 'z', 'color'],
    defaultSub: '',
    layered: true,
    aggregate,
    // made over the cells shown: a change of the cell subset changes it (utils/subset-reads.js)
    readsCellSubset: true,
    entities: tableList,
    keyEntries: (list) => list.map((t) => ({ value: t.id, text: t.title })),
    subKeys: () => [],
    load: loadForPlot,
    titleOf: (setting) => `cell table ${tableTitle(setting)}`,
    placeholder: drawTablePlaceholder,
    releaseHost: (host) => { if (_binding) _binding.releaseHost(host); },
    vocabulary: { result: 'table statistic' }
});
