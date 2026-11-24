/**
 * The page's side of the `gene-score` source: signatures, scores and the
 * plots that show them. The logic is in utils/score-store.js (cache, jobs,
 * tiers) and utils/score-sources.js (dependants, edits); this binds them to
 * PanelManager, DataManager and the plot containers through one host binding
 * (utils/host-binding.js: records per host and role, visibility, the painter
 * every provider shares), with the notices of utils/score-notices.js.
 *
 * A plot's x, y, z, colour or hover that reads `{type: 'gene-score', key: <the
 * source's panel id>, column: <method>, layer, label: <its title when last seen>}`
 * asks here for its series (`loadScoreSeries`). A source is a Gene Signature or
 * a Gene Table (utils/score-source-panels.js). A ready score is returned as a series. Anything
 * else throws `SourceUnavailable`: a colour falls back to neutral points (the
 * plot's existing colour fallback) and an axis to a placeholder, both with the
 * notice over the plot. When the state changes, the plot is drawn again.
 *
 * The plots reach all of it through the provider registered at the end (utils/source-registry.js): its key
 * list, its method and layer selects (decision 31: every method, every layer, an impossible pair disabled with its
 * reason), its loads (the regular plot's and the large plot's), titles and placeholder. A score is not a Hover picker
 * entry (decision 32): a link that stored one drops it on load (panels/plot-utilities/hover-columns.js).
 */
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { Policy } from '../policy.js';
import { drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP, classifyValues } from './coverage.js';
import { createScoreStore } from './score-store.js';
import { createLimiter, DEFAULT_MAX_ACTIVE } from './derived-store.js';
import { createScoreSources } from './score-sources.js';
import { createScoreApi } from './gene-score-client.js';
import { createKindClient } from './matrix-kind-client.js';
import { describeScore } from './score-notices.js';
import { paintProgress, sentenceOf, coverageKindOf } from './source-notices.js';
import { actions } from './source-actions.js';
import { createHostBinding, isHover, isVisible, panelIdOf, PENDING } from './host-binding.js';
import { VOCABULARY } from './vocabulary.js';
import { registerSource, subKeyOf, layerOf, SourceUnavailable } from './source-registry.js';
import { pinScoreLayers } from './score-column.js';
import { DEFAULT_METHOD, effectiveDownWeight } from './gene-signature.js';
import { DEFAULT_INPUT, METHODS, SIGNATURE_MODEL, methodShort } from './signature-options.js';
import { legacyPair } from './options-model.js';
import { createSourceAdapter, entityLabel, isSourceType, kindOfType, optionFieldsOf, scoreKeyOptions } from './score-source-panels.js';
import { findCycle, TableResolver } from './table-resolver.js';
import { layerKeys } from './structure-keys.js';

/** What each aggregation is called where a consumer picks it (level 3). */
const SUB_LABELS = Object.fromEntries(METHODS.map(m => [m, methodShort(m)]));

/**
 * The series of a score, waiting for it while it is pending when the plot has a drawing to keep. The old
 * drawing stays, the plot's own loading pill shows (the caller's), and nothing is claimed about the score
 * (no notice, no tag, no gene count) until it is known to last: refused, failed, asks first, cancelled, deleted. With no drawing yet, or in those states, it throws as loadScoreSeries does.
 * @param {Object} setting
 * @param {Object} opts - as loadScoreSeries
 * @param {AbortSignal|null} [signal]
 */
function loadScoreSeriesWhenReady(setting, opts, signal = null) {
    return binding().loadWhenReady((quiet) => loadScoreSeries(setting, { ...opts, quiet }), opts, signal);
}

/** The value that is not a signature: "New signature..." in the key list. */
export const NEW_SIGNATURE = '__new_signature__';

/** The page's panel registry (window.PanelManager, as plot-make.js reads it): importing the module would load every panel. */
const PanelManager = {
    getPanel: (id) => globalThis.PanelManager.getPanel(id),
    getAllPanels: () => globalThis.PanelManager.getAllPanels(),
    getActivePanels: () => globalThis.PanelManager.getActivePanels(),
    reopenClosedPanel: (id, opts) => globalThis.PanelManager.reopenClosedPanel(id, opts),
    createPanelNextTo: (type, nextTo) => globalThis.PanelManager.createPanelNextTo(type, nextTo)
};

let _store = null;
let _sources = null;

/** Whether this panel is a source of a gene score: a signature, or a gene table (utils/score-source-panels.js). */
function isSource(panel) {
    return !!panel && typeof panel.getType === 'function' && isSourceType(panel.getType());
}

/** A gene table's score hangs on its rows, which the table resolver may have to build: it is reached through here. */
const tableResolver = {
    need: (id, dependant) => TableResolver.need(id, dependant),
    accept: (id) => TableResolver.accept(id),
    cancel: (id) => TableResolver.cancel(id),
    retry: (id) => TableResolver.retry(id),
    cycleOf: (id) => findCycle(id, (x) => TableResolver.host.depends(x))
};

function signatureAdapter() {
    return createSourceAdapter({
        panel: (id) => PanelManager.getPanel(id),
        active: (panel) => PanelManager.getActivePanels().includes(panel),
        geneNames: () => DataManager.getGenes(),
        off: () => !Policy.panelEnabled('gene-signature'),
        resolver: tableResolver
    });
}

function context() {
    const cells = DataManager.getCells();
    return { dataset: DataManager.getCurrentDataset() || '', subset: DataManager.getSubsetParam(),
        cells: cells && Number.isFinite(Number(cells.length)) ? Number(cells.length) : null };
}

let _limiter = null;

/**
 * The page's one limit on computations at once (SHR-31), made when first needed and given to every derived store, so a
 * score and a grouping computing together share the two slots.
 */
// export-unused-ok: the cell-group store (G7) is given it
export function pageLimiter() {
    if (!_limiter) _limiter = createLimiter(DEFAULT_MAX_ACTIVE);
    return _limiter;
}

/** The store and the sources, made when first needed. */
export function scores() {
    if (!_sources) {
        _store = createScoreStore({ api: createScoreApi({ url: Config.API.GENE_SCORE }), limiter: pageLimiter() });
        _sources = createScoreSources({ store: _store, signatures: signatureAdapter(), context });
    }
    return { store: _store, sources: _sources };
}

/**
 * Every source of a gene score, open or closed: signatures first, then gene tables, each in the order they were made.
 * [{id, title, open, kind: 'signature'|'table', input}].
 */
export function sourceList() {
    const open = new Set(PanelManager.getActivePanels().map(p => p.getId()));
    const all = PanelManager.getAllPanels().filter(isSource);
    return [...all.filter(p => p.getType() === 'gene-signature'), ...all.filter(p => p.getType() !== 'gene-signature')]
        .map(p => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()), kind: kindOfType(p.getType()),
            input: optionFieldsOf(p).input }));
}

/** The source panel (a signature or a gene table) with this id, or null. */
function sourcePanel(id) {
    const panel = id ? PanelManager.getPanel(id) : null;
    return isSource(panel) ? panel : null;
}

/**
 * The layer a source reads when a consumer names none: its stored `input` now. Null when there is no such source.
 * @param {string} id - a source's panel id
 * @returns {string|null}
 */
export function sourceInput(id) {
    const panel = sourcePanel(id);
    return panel ? optionFieldsOf(panel).input : null;
}

/** The title of the source a setting names, or what it was called when last seen (the setting's `label`). */
export function scoreTitle(setting) {
    const panel = sourcePanel(setting && setting.key);
    return panel ? panel.getTitle() : (setting && (setting.label || setting.key)) || '';
}

/** The name a consumer shows for a score: the source's title, the method when it is not the default, the layer when it is not the source's own. */
export function scoreLabel(setting) {
    const sub = subKeyOf(setting);
    const layer = layerOf(setting);
    const parts = [scoreTitle(setting)];
    if (sub && sub !== DEFAULT_METHOD) parts.push(SUB_LABELS[sub] || sub);
    if (layer && layer !== (sourceInput(setting.key) || DEFAULT_INPUT)) parts.push(layer);
    return parts.join(' · ');
}

/**
 * The two lines a score is named by wherever it leaves the app (the colour bar, an axis title, a legend,
 * a CSV header): the source's title, then the method and the layer it was computed over, always.
 * @returns {[string, string]}
 */
export function scoreLabelLines(setting) {
    const panel = sourcePanel(setting && setting.key);
    const sub = subKeyOf(setting);
    // down genes weighed by side (not the default) change the numbers, so the name says so wherever the score leaves the app
    const recipe = panel && typeof panel.getRecipe === 'function' ? panel.getRecipe() : null;
    const by = recipe && effectiveDownWeight(recipe, sub) === 'side' ? ', each side weighs equally' : '';
    return [scoreTitle(setting), `${SUB_LABELS[sub] || sub}${by} · ${layerOf(setting) || sourceInput(setting.key) || DEFAULT_INPUT}`];
}

/** The one-line form of scoreLabelLines: "T cell score · z-score mean · X". */
export function scoreFullLabel(setting) {
    return scoreLabelLines(setting).join(' · ');
}

/**
 * Resolve the entries of a panel's settings that carry no layer (see pinScoreLayers), against the
 * signatures as they are now. Called when a panel is built or drawn, and by a signature before its
 * input or layers change, so nothing reads `input` at draw time afterwards.
 * @param {Object} settings - a plot's or table's settings, rewritten in place
 * @param {(column: Object) => string} keyOf - a table column's data key
 * @returns {boolean}
 */
export function pinLayers(settings, keyOf) {
    return pinScoreLayers(settings, sourceInput, keyOf);
}

/** Before a signature's input or layers change: every panel pins what it holds with no layer. */
export function pinConsumersOf() {
    for (const panel of PanelManager.getAllPanels()) {
        if (panel && typeof panel.pinScoreLayers === 'function') panel.pinScoreLayers();
    }
}

/**
 * Write into a consumer's setting what it is called: `label`, the source's title (kept for when the source is
 * deleted), and `labelFull`, the two lines of scoreLabelLines (what plot-titles.js reads, which cannot reach the page).
 * @returns {boolean} whether either changed
 */
function nameSetting(setting) {
    const title = scoreTitle(setting);
    const lines = scoreLabelLines(setting).join('\n');
    const changed = (!!title && setting.label !== title) || setting.labelFull !== lines;
    if (title) setting.label = title;
    setting.labelFull = lines;
    return changed;
}

/** The type of the source this module provides: what a consumer's setting names. */
export const SCORE_TYPE = 'gene-score';

/** The series cannot be drawn yet, and why. */
const unavailable = (text, notice, coverage, state = null) => new SourceUnavailable(text, notice, coverage, state, SCORE_TYPE);

// ---------------------------------------------------------------------------
// records: one handle per (host, role), through the page's host binding

/** Whether the plot still reads the score a record holds (the user may have changed the axis). */
function stillUsed(rec) {
    const panel = rec.panelId ? PanelManager.getPanel(rec.panelId) : null;
    if (!panel || typeof panel.getConfig !== 'function') return true;
    const cfg = panel.getConfig();
    // a score is no hover line any more (decision 32)
    if (isHover(rec.role)) return false;
    const s = cfg[rec.role];
    return !!(s && s.type === SCORE_TYPE && s.key === rec.sigId && subKeyOf(s) === rec.sub && layerOf(s) === (rec.layer || ''));
}

/** Draw the panel of a host again: the score it drew changed. */
function refreshPanel(host) {
    const panel = PanelManager.getPanel(panelIdOf(host));
    const reload = panel && (panel.refreshPlot || panel.refreshTable);
    if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
}

/**
 * The placeholder an axis shows while its score cannot be drawn, with the notice's progress bar. Also the
 * progress repaint: it replaces itself.
 */
function drawScorePlaceholder(host, notice) {
    if (!host) return;
    const unit = 'cells';
    const cov = Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: null, kind: coverageKindOf(notice) });
    drawPlaceholder(host, cov, unit, {
        actions: notice.actions,
        say: { severity: notice.severity === 'error' ? 'error' : 'notice', headline: notice.headline,
            lines: notice.text ? [notice.text] : [] }
    });
    const box = host.querySelector('.coverage-placeholder');
    if (box) {
        box.dataset.scoreState = notice.state;
        paintProgress(box, notice.progress || null, sentenceOf(notice));
    }
    host.__sourcePlaceholder = true;
}

/** The id of the plots' score provider: its notices on the painter, its actions in the registry. */
const PLOT_PROVIDER = 'plot-score';

let _binding = null;

/** The plots' records of scores, made when first needed. */
function binding() {
    if (!_binding) {
        _binding = createHostBinding({
            id: PLOT_PROVIDER,
            open: (host, role, setting, onChange) => {
                const sub = subKeyOf(setting);
                const panelId = panelIdOf(host);
                const handle = scores().sources.watch(setting.key, {
                    kind: 'plot', host, role, sub, layer: setting.layer || null, dependant: panelId, visible: () => isVisible(host), onChange
                });
                return { sigId: setting.key, sub, layer: setting.layer || null, handle, consumer: { kind: 'plot', role, panelId, host } };
            },
            matches: (rec, setting) => rec.sigId === setting.key && rec.sub === subKeyOf(setting) && (rec.layer || '') === layerOf(setting),
            describe: describeScore,
            stillUsed,
            // drawn without a value, its strip says "not ready yet", "not available" or "not in this dataset": the
            // plot is drawn again when that changes (computing, then refused), and only then
            stale: (rec, snap) => rec.drawnKey === null && rec.drawnKind !== undefined && coverageKindOf(snap) !== rec.drawnKind,
            refresh: refreshPanel,
            visibilityChanged: () => scores().sources.visibilityChanged(),
            placeholder: drawScorePlaceholder
        });
    }
    return _binding;
}

/** A plot closes: its dependants go, and a score nothing else needs stops computing. */
function releaseHost(host) {
    binding().releaseHost(host);
}

// ---------------------------------------------------------------------------
// the series a plot loads

/**
 * The series of a `gene-score` source for a cell plot.
 * @param {Object} setting - `{type: 'gene-score', key, label}`
 * @param {{host: HTMLElement, role: string, expected: (number|null), unit: string}} opts
 * @returns {Promise<{values: Array<number>, type: 'numerical', categories: null, coverage: Coverage, vector: Float32Array}>}
 *   `values` is a plain array (the regular plot's form); `vector` is the Float32Array
 * @throws {SourceUnavailable} when no score can be drawn
 */
export function loadScoreSeries(setting, { host, role, expected, unit = 'cells', array = true, quiet = false }) {
    // the setting keeps the source's title (for when the source is deleted) and what the colour bar, axis titles and
    // legends say (two lines for the bar), both refreshed whenever the score is read
    nameSetting(setting);
    const title = scoreLabel(setting);
    if (!host || !setting.key) {
        const notice = describeScore({ state: 'unset', title: '' }, { role });
        throw unavailable(notice.headline, notice,
            Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: expected, kind: 'stopped' }));
    }
    // an entry with no layer (an old link) is resolved now, once, to the signature's input
    if (!setting.layer) { const input = sourceInput(setting.key); if (input) setting.layer = input; }
    const rec = binding().recordFor(host, role, setting);
    rec.quiet = quiet;
    const snap = rec.handle.read();
    if (snap.values) {
        rec.drawnKey = snap.shownKey || snap.key;
        rec.drawnKind = undefined;
        binding().paint(host);
        const vector = snap.values;
        const values = array ? Array.from(vector) : null;
        const source = `gene score ${title}`;
        const coverage = array ? classifyValues({ values, expected, unit, source }) : Coverage.complete(vector.length, unit);
        return Promise.resolve({ values: array ? values : vector, type: 'numerical', categories: null, coverage, vector });
    }
    rec.drawnKey = null;
    rec.drawnKind = coverageKindOf(snap);
    const notice = describeScore(snap, { role, sharers: rec.handle.sharers() })
        || describeScore({ ...snap, state: 'estimating' }, { role });
    // a caller that waits for the score says nothing yet (rec.quiet): no notice and no tag until it is known to last
    if (!(quiet && PENDING.includes(snap.state))) binding().paint(host);
    throw unavailable(notice.headline, notice,
        Coverage.missing(GAP.UNAVAILABLE, `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`,
            { source: `gene score ${title}`, unit, total: expected, kind: coverageKindOf(snap) }), snap.state);
}

// ---------------------------------------------------------------------------
// actions of the notices (main.js routes `score-*` here)

/**
 * The plots' provider of the notice actions (utils/source-actions.js). Every dependency is given, so a Node test can hold
 * every state of a host against every action; the page registers its own below.
 * @param {Object} deps
 */
export function createPlotActions({ shownRecord: shown, recordsOf: records, sourcePanel: panelOf, update, openSource,
    chooser, panelIdOf: hostPanelId }) {
    const ofShown = (host) => shown(host) || null;
    const record = (run) => ({ target: ofShown, run });
    return {
        id: PLOT_PROVIDER,
        owns: (host) => !!shown(host),
        actions: {
            'score-compute': { target: (host) => (records(host).size ? host : null), run: (host) => { for (const r of records(host).values()) r.handle.compute(); } },
            'score-cancel': record((rec) => { rec.handle.cancel(); }),
            'score-retry': record((rec) => { rec.handle.retry(); }),
            'score-update': record((rec) => { update(rec.sigId); }),
            'score-open': { target: (host) => { const rec = shown(host); return rec && panelOf(rec.sigId) ? rec : null; },
                run: (rec, host) => { openSource(rec.sigId, hostPanelId(host)); } },
            'score-choose': { target: (host) => { const rec = shown(host); return rec ? chooser(host, rec) : null; }, run: (place) => { place.focus(); } }
        }
    };
}


/** The select a plot's source is chosen in, to take the user to: null when the plot has none. */
function sourceChooser(host, rec) {
    const tile = host.closest ? host.closest('.tile') : null;
    const select = tile && tile.querySelector(`.axis-key-select[data-axis="${isHover(rec.role) ? 'color' : rec.role}"]`);
    if (!select) return null;
    return { focus() { select.scrollIntoView && select.scrollIntoView({ block: 'nearest' }); select.focus(); } };
}

actions.register(createPlotActions({
    shownRecord: (host) => binding().shownRecord(host), recordsOf: (host) => binding().recordsOf(host), sourcePanel,
    openSource: openSignature,
    update: (id) => scores().sources.update(id), chooser: sourceChooser, panelIdOf
}));

/**
 * Open a signature for editing: the tile of `nextTo` splits and the signature
 * opens beside it, with the same id, so everything that names it keeps meaning
 * it. Needs no chooser tile in the page.
 * @returns {Object|null} the open panel, or null
 */
export function openSignature(id, nextTo = null) {
    const panel = sourcePanel(id);
    if (!panel) return null;
    if (PanelManager.getActivePanels().includes(panel)) {
        const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`);
        if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
        return panel;
    }
    return PanelManager.reopenClosedPanel(id, { nextTo });
}

// ---------------------------------------------------------------------------
// events from the page

/** The option fields that change what plots and tables may pick: their menus and titles follow an edit of one. */
const MENU_KEYS = ['input', 'method', 'detect_above', 'clip', 'bins', 'controls', 'seed'];

/**
 * A source changed: its genes (a signature's list, the rows a table's filter passes) or the option fields named in
 * `keys`, by an edit in its panel or from outside (a saved config, Back and Forward). The plots and tables that read
 * its score follow by the rules for an edit (utils/score-sources.js), and the menus that grade its methods on its
 * layers are rebuilt when a field they grade by changed.
 * @param {string} id - the source's panel id
 * @param {string[]} [keys] - the option fields that changed, if any
 */
export function sourceChanged(id, keys = []) {
    if (_sources) _sources.recipeChanged(id);
    if (keys.some(key => MENU_KEYS.includes(key))) sourceRenamed(id);
}

/** A command from the signature's own panel: compute, cancel, retry, update (the notices' actions, from the panel). */
export function scoreCommand(id, command) {
    const { sources } = scores();
    if (command === 'update') return sources.update(id);
    const handle = sources.handlesOf(id)[0];
    if (!handle) return false;
    if (command === 'compute') return handle.compute();
    if (command === 'cancel') return handle.cancel();
    if (command === 'retry') return handle.retry();
    return false;
}

/** A source was renamed, or a field its menus grade by changed: the menus that list it are rebuilt and the titles of the plots that show it follow. */
export function sourceRenamed(id) {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
    if (!_sources) return;
    for (const host of binding().hosts()) {
        for (const rec of binding().recordsOf(host).values()) {
            if (rec.sigId !== id) continue;
            if (nameSetting(rec.setting) && rec.drawnKey) binding().refreshSoon(host);
        }
    }
}

/** Panels were added, removed, closed or reopened: a deleted signature shows, a returned one resolves. */
export function panelsChanged() {
    if (!_sources) return;
    _sources.recheck();
    _sources.contextChanged();
    for (const host of binding().hosts()) binding().schedulePaint(host);
}

/** The dataset or the cells shown changed. */
export function contextChanged() {
    if (_sources) _sources.contextChanged();
}

/** The status of a source's score for its own panel. */
export function sourceStatus(id) {
    return scores().sources.status(id);
}

/** Subscribe the panel to its own score status; returns the way to stop. */
export function onSourceStatus(id, fn) {
    return scores().sources.onSignature(id, fn);
}

/** The methods in use for a source, each with how many plots and tables read it: [{value, plots, tables}]. */
export function aggregationsInUse(id) {
    return scores().sources.usage(id, 'method');
}

/** The layers in use for a source, likewise; a `null` value is a consumer with no layer of its own. */
export function layersInUse(id) {
    return scores().sources.usage(id, 'layer');
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
    // A gene table's filter changed, or its rows were built: its genes changed, and its dependants follow as they do
    // for a signature that is edited (at once when the score is cheap, behind Update score when it is not)
    document.addEventListener('annzarro:table-filtered', (event) => {
        const id = event && event.detail && event.detail.id;
        const panel = sourcePanel(id);
        if (panel && panel.getType() === 'gene-table') sourceChanged(id);
    });
}


// ---------------------------------------------------------------------------
// the provider: signatures are the first source with a third level

/**
 * A plot's series of a score: waits for it while the plot has a drawing to keep (loadScoreSeriesWhenReady). A Gene
 * Plot cannot take one (a link can name it there): that axis says so, and the rest of the link works.
 * @param {Object} setting
 * @param {{host, role: string, axis: (string|null), expected: (number|null), unit: string, signal: (AbortSignal|null)}} opts
 */
function loadForPlot(setting, { host, role, axis, expected, unit, signal }) {
    if (unit === 'genes') {
        const notice = describeScore({ state: 'notcells', title: '' }, { role: role === 'color' ? 'colour' : (axis || 'x') });
        return Promise.reject(unavailable(notice.headline, notice,
            Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: expected, kind: 'stopped' })));
    }
    return loadScoreSeriesWhenReady(setting, { host, role, expected, unit }, signal);
}

/**
 * A large plot's series of a score: the score store's Float32Array itself, nothing copied; waits as loadForPlot does.
 * @param {Object} setting
 * @param {{host, role: string, expected: (number|null), signal: (AbortSignal|null)}} opts
 */
async function loadLargeForPlot(setting, { host, role, expected, signal }) {
    const scored = await loadScoreSeriesWhenReady(setting, { host, role, expected, array: false }, signal);
    return { type: 'numerical', vector: scored.vector };
}

// ---------------------------------------------------------------------------
// the two selects of a consumer: method, then layer (decision 31)

/** The methods whose server cost is a whole pass over the matrix besides the genes' reads (offered-removal-080.md, 7). */
const WHOLE_MATRIX = new Set(['control_adjusted', 'fraction_of_total']);
const WHOLE_MATRIX_NOTE = 'Reads the whole matrix once.';

/** The layer a setting reads: its own, else (a link made before layers were stored) the source's input. */
const heldLayer = (setting) => layerOf(setting) || sourceInput(setting && setting.key) || DEFAULT_INPUT;
/** The method a setting reads: its column when that is a method, else the default (an empty column). */
const heldMethod = (setting) => (METHODS.includes(subKeyOf(setting)) ? subKeyOf(setting) : DEFAULT_METHOD);

/** One select entry of a graded choice: disabled with its reason as title; a costly method says so. */
function entryOf(c, costly = false) {
    const title = [c.title, costly && !c.disabled ? WHOLE_MATRIX_NOTE : ''].filter(Boolean).join(' ');
    return { value: c.value, text: c.label, disabled: !!c.disabled, title };
}

/**
 * Both selects of source `id` for the pair a consumer holds: every method graded on its layer, every layer of the
 * dataset graded for its method; an impossible pair it holds stays, "(not available)". A source that is gone lists
 * every method ungraded and the held layer alone.
 * @param {string} id
 * @param {{method: string, layer: string}} pair
 * @returns {{methods: Array<{value, text, disabled, title}>, layers: Array<{value, text, disabled, title}>}}
 */
export function scorePairMenus(id, pair) {
    const choices = scoreChoices(id, pair);
    if (!choices) {
        return { methods: METHODS.map(m => ({ value: m, text: methodShort(m), disabled: false, title: '' })),
            layers: [{ value: pair.layer, text: pair.layer, disabled: false, title: '' }] };
    }
    return { methods: choices.methods.map(c => entryOf(c, WHOLE_MATRIX.has(c.value))), layers: choices.layers.map(c => entryOf(c)) };
}

/**
 * The pair after the user touched one select: the touched one wins, the other moves to its first usable value only
 * when it became impossible, and `say` names that move once ("Layer changed to logged: ...").
 * @param {string} id
 * @param {'method'|'layer'} changed
 * @param {string} value
 * @param {{method: string, layer: string}} pair - what the consumer held
 * @returns {{method: string, layer: string, say: string}}
 */
export function scorePairAfter(id, changed, value, pair) {
    const choices = scoreChoices(id, pair);
    const next = changed === 'method' ? { method: value, layer: pair.layer } : { method: pair.method, layer: value };
    if (!choices) return { ...next, say: '' };
    const p = choices.after(changed, value, pair);
    return { method: p.method, layer: p.layer || next.layer, say: p.say || '' };
}

/**
 * Where a new consumer of source `id` starts (decision 32): z-score mean · X, or the first usable layer for it when
 * that pair cannot be computed. A source with a stored offered list (a link made before decision 31) starts where
 * it started then: its first offered method on its first offered layer (legacyPair).
 * @param {string} id
 * @returns {{method: string, layer: string}}
 */
export function scoreStartPair(id) {
    const choices = scoreChoices(id);
    const want = choices ? choices.legacy : { method: DEFAULT_METHOD, layer: DEFAULT_INPUT };
    if (!choices) return want;
    const p = choices.after('method', want.method, want);
    return { method: p.method, layer: p.layer || want.layer };
}

/** Whether a setting holds no score choice of its own yet: no method (a column left over from another source) and no layer. */
const holdsNoPair = (setting) => !METHODS.includes(setting.column) && !setting.layer;

/**
 * The method select of a gene score (the registry's subKeyMenu) and the entry that is chosen, without changing
 * anything. `adopt` is set when the consumer holds no pair yet, so it starts on scoreStartPair.
 * @param {Object} setting
 */
function scoreSubKeyMenu(setting) {
    if (!setting.key) return { options: METHODS.map(m => ({ value: m, text: methodShort(m), column: m })), chosen: null, adopt: null };
    const start = holdsNoPair(setting) ? scoreStartPair(setting.key) : null;
    const pair = start || { method: heldMethod(setting), layer: heldLayer(setting) };
    const { methods } = scorePairMenus(setting.key, pair);
    return {
        options: methods.map(o => ({ ...o, column: o.value })),
        chosen: pair.method,
        adopt: start ? { column: start.method, layer: start.layer } : null
    };
}

/** The layer select of a gene score (the registry's layerMenu): every layer, graded for the method the setting holds. */
function scoreLayerMenu(setting) {
    if (!setting.key) return null;
    const pair = { method: heldMethod(setting), layer: heldLayer(setting) };
    return { options: scorePairMenus(setting.key, pair).layers, chosen: pair.layer };
}

/** The setting's pair after the user touched one of its selects (the registry's pairAfter). */
function scoreSettingAfter(setting, changed, value) {
    const p = scorePairAfter(setting.key, changed, value, { method: heldMethod(setting), layer: heldLayer(setting) });
    return { column: p.method, layer: p.layer, say: p.say };
}

/** "mean · counts" for a table column, "(not available)" when the pair cannot be computed. */
function columnPairLabel(column) {
    const pair = { method: heldMethod(column), layer: heldLayer(column) };
    const menus = scoreChoices(column.key, pair);
    const lapsed = menus && menus.layers.some(l => l.value === pair.layer && l.lapsed);
    return `${methodShort(pair.method)} · ${pair.layer}${lapsed ? ' (not available)' : ''}`;
}

/**
 * The key list of a gene score: every source, open or closed, by its title; the one held when it is gone, so the
 * plot can say it was deleted; and the way to make a signature.
 * @param {Array<{id: string, title: string, kind?: string}>} list - the sources
 * @param {{key?: string, label?: string}} setting - what the consumer holds; `label` is what its source was called
 */
function scoreKeyEntries(list, setting) {
    const options = scoreKeyOptions(list);
    const held = setting && setting.key;
    // (a key left over from another source type is not a deleted source: source ids are panel ids)
    if (held && /^gene-(signature|table)-/.test(held) && !list.some(source => source.id === held)) {
        options.push({ value: held, text: `${setting.label || held} (deleted)` });
    }
    if (!options.length) options.push({ value: '', text: 'No signatures or tables yet' });
    options.push({ value: NEW_SIGNATURE, text: 'New signature…' });
    return options;
}

/**
 * The table half of the provider (utils/table-source.js): a score as a column of a Cell Table. The column's handle is the
 * score's, so a table's score and a plot's share one computation.
 */
const scoreTable = {
    tab: VOCABULARY.sourceType.score,
    watch: (column, { host, visible, onChange }) => scores().sources.watch(column.key, {
        kind: 'table', sub: subKeyOf(column), layer: column.layer || '', host, role: 'column', visible, onChange
    }),
    visibilityChanged: () => scores().sources.visibilityChanged(),
    update: (column) => scores().sources.update(column.key),
    label: (column) => scoreLabel(column),
    fullLabel: (column) => scoreFullLabel(column),
    open: (column, hostId) => openSignature(column.key, hostId),
    chooser: {
        layerOf: (column) => column.layer || sourceInput(column.key) || DEFAULT_INPUT,
        entityLabel,
        /** The source's ticked columns only ("mean · counts"); the add row below them adds another. */
        options: (sig, ticked) => ticked.filter(t => t.key === sig.id)
            .map(t => ({ column: heldMethod(t), layer: heldLayer(t), text: columnPairLabel(t) })),
        /** The add row, `[method] on [layer] [Add column]`: the two selects of a plot's axis. */
        add: {
            start: (sig) => scoreStartPair(sig.id),
            menus: (sig, pair) => scorePairMenus(sig.id, pair),
            after: (sig, changed, value, pair) => scorePairAfter(sig.id, changed, value, pair),
            label: (pair) => `${methodShort(pair.method)} · ${pair.layer}`
        },
        note: (structure) => noteDatasetLayers(layerKeys(structure)),
        empty: { text: 'No signatures or gene tables yet.', button: 'New signature…' }
    }
};

registerSource({
    type: SCORE_TYPE,
    label: VOCABULARY.sourceType.score,
    valueType: 'numerical',
    entity: 'cells',
    consumers: ['cell-plot', 'cell-table'],
    axes: ['x', 'y', 'z', 'color', 'column'],
    largeAxes: ['x', 'y', 'color'],
    defaultSub: DEFAULT_METHOD,
    layered: true,
    entities: () => sourceList(),
    keyEntries: scoreKeyEntries,
    newEntity: { value: NEW_SIGNATURE, run: (nextTo) => (PanelManager.createPanelNextTo('gene-signature', nextTo) || null) },
    /** The aggregations the server computes, z-score mean first; a new method is a new entry in METHODS. */
    subKeys: () => METHODS.map(value => ({ value, label: SUB_LABELS[value] || value })),
    subKeyMenu: scoreSubKeyMenu,
    layerMenu: scoreLayerMenu,
    pairAfter: scoreSettingAfter,
    load: loadForPlot,
    loadLarge: loadLargeForPlot,
    table: scoreTable,
    titleOf: (setting) => `gene score ${scoreTitle(setting)}`,
    placeholder: drawScorePlaceholder,
    releaseHost,
    vocabulary: { result: 'score' }
});


/**
 * What a consumer of the score of signature `id` may choose (decision 31): the two selects, ungated. ALL six methods
 * and ALL the dataset's layers, an impossible pair disabled with its reason (SHR-27); no `offered`, nothing "no longer
 * offered". `method`/`layer` are what the consumer holds: the method list is graded on its layer, the layer list for
 * its method, and a held impossible pair stays selectable as "(not available)". `legacy` is the pair a consumer
 * that stored neither resolved to before decision 31 (read from the retired `offered`/`layers`, never written back).
 * @param {string} id - a signature (or gene table) panel id
 * @param {{method?: string, layer?: string}} [held] - the consumer's setting; `layer` '' or absent reads as the source's input
 * @param {{datasetLayers?: string[], facts?: Function}} [opts] - the dataset's layers, X first (default: those noted by
 *   noteDatasetLayers); `facts(layers)` -> {kinds, stats}: what the page knows each layer looks like (default: layerFacts)
 * @returns {{methods: Array<Object>, layers: Array<Object>, legacy: {method: string, layer: string}, after: Function}|null}
 *   null when the source is gone; `after(changed, value, pair)` is `pairAfter` with this source's context
 */
export function scoreChoices(id, held = {}, { datasetLayers = _datasetLayers, facts = layerFacts } = {}) {
    const panel = sourcePanel(id);
    if (!panel) return null;
    const recipe = optionFieldsOf(panel);
    const layers = datasetLayers && datasetLayers.length ? datasetLayers : [recipe.input || DEFAULT_INPUT];
    // what each layer looks like: the page's answers (a closed source grades too), then what its open panel sampled
    const page = facts(layers);
    const grading = typeof panel.getGrading === 'function' ? panel.getGrading() : {};
    const kinds = { ...page.kinds, ...(grading.kinds || {}) };
    const stats = { ...page.stats, ...(grading.stats || {}) };
    const ctx = { recipe, datasetLayers: layers, kinds, stats };
    const legacy = legacyPair(SIGNATURE_MODEL, recipe);
    const method = held.method || legacy.method;
    const layer = held.layer || legacy.layer;
    return {
        methods: SIGNATURE_MODEL.methodChoices({ recipe, layer, kinds, stats, held: held.method }),
        layers: SIGNATURE_MODEL.layerChoices({ ...ctx, method, held: held.layer || undefined }),
        legacy,
        after: (changed, value, pair) => SIGNATURE_MODEL.pairAfter(changed, value, pair, ctx)
    };
}

/** What the layers look like, for the menus: one sample per dataset and layer for the whole page, no alternative sought. */
let _kindClient = null;
/** `${dataset}\u0001${layer}` -> {kind, stats}, or null while asked (a failed answer stays null: the layer grades ok). */
const _layerFacts = new Map();

/**
 * What the page knows each layer looks like ({kinds, stats} by layer), asking the server for the others once
 * (offered-removal-080.md, section 7): until an answer comes a layer grades `ok`, and when it comes the menus are
 * built again. Nothing is asked outside a page (Node tests pass their own `facts`).
 * @param {string[]} layers
 */
// export-unused-ok: the Gene Plot's group-stat grades its statistic and layer menus by the same facts
export function layerFacts(layers) {
    const kinds = {};
    const stats = {};
    const layouts = {};
    const page = typeof window !== 'undefined' && typeof document !== 'undefined';
    const dataset = page ? (DataManager.getCurrentDataset() || '') : '';
    for (const layer of layers) {
        const key = `${dataset}\u0001${layer}`;
        if (page && dataset && !_layerFacts.has(key)) {
            _layerFacts.set(key, null);
            if (!_kindClient) _kindClient = createKindClient({ url: Config.API.MATRIX_KIND });
            Promise.resolve(_kindClient.kind(dataset, layer, { suggest: false })).then((reply) => {
                if (!reply || !reply.kind) return;
                _layerFacts.set(key, { kind: reply.kind, stats: reply.stats || null, layout: reply.layout || null });
                // the menus grade by it now
                if (DataManager.getCurrentDataset() === dataset) document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
            }, () => {});
        }
        const known = _layerFacts.get(key);
        if (known) {
            kinds[layer] = known.kind;
            if (known.stats) stats[layer] = known.stats;
            if (known.layout) layouts[layer] = known.layout;
        }
    }
    return { kinds, stats, layouts };
}

/** The dataset's layers (X first), noted from its structure when a menu is built. */
let _datasetLayers = null;
export function noteDatasetLayers(list) {
    _datasetLayers = Array.isArray(list) ? [...list] : null;
}

/** The dataset's layers as the last menu noted them (X first), or null before one has. */
// export-unused-ok: the Gene Plot's group-stat lists the same layers
export function datasetLayersNow() {
    return _datasetLayers ? [..._datasetLayers] : null;
}
