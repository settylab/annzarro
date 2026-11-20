/**
 * The page's side of the `gene-score` source: signatures, scores and the
 * plots that show them. The logic is in utils/score-store.js (cache, jobs,
 * tiers) and utils/score-sources.js (dependants, edits); this binds them to
 * PanelManager, DataManager and the plot containers, and paints the notices
 * of utils/score-notices.js.
 *
 * A plot's x, y, z, colour or hover that reads `{type: 'gene-score', key: <the
 * source's panel id>, column: <method>, layer, label: <its title when last seen>}`
 * asks here for its series (`loadScoreSeries`). A source is a Gene Signature or
 * a Gene Table (utils/score-source-panels.js). A ready score is returned as a series. Anything
 * else throws `ScoreUnavailable`: a colour falls back to neutral points (the
 * plot's existing colour fallback) and an axis to a placeholder, both with the
 * notice over the plot. When the state changes, the plot is drawn again.
 */
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { Policy } from '../policy.js';
import { setStatusTag, setScoreNotice, drawPlaceholder } from './panel-surface.js';
import { Coverage, GAP, classifyValues } from './coverage.js';
import { createScoreStore } from './score-store.js';
import { createScoreSources } from './score-sources.js';
import { createScoreApi } from './gene-score-client.js';
import { describeScore, worstNotice } from './score-notices.js';
import { registerSource, subKeyOf, layerOf } from './source-registry.js';
import { pinScoreLayers } from './score-column.js';
import { DEFAULT_METHOD, effectiveDownWeight } from './gene-signature.js';
import { DEFAULT_INPUT, DEFAULT_OFFERED, METHODS, methodShort, offeredOptions, isOffered } from './signature-options.js';
import { createSourceAdapter, isSourceType, kindOfType, optionFieldsOf } from './score-source-panels.js';
import { findCycle, TableResolver } from './table-resolver.js';

/** What each aggregation is called where a consumer picks it (level 3). */
const SUB_LABELS = Object.fromEntries(METHODS.map(m => [m, methodShort(m)]));

/** States that pass by themselves: a score being asked for, queued or computed. The others last until the user acts. */
const PENDING = ['idle', 'estimating', 'queued', 'computing', 'updating'];

/** Whether a plot shows a drawing now (not a placeholder): a switch keeps it until the new data is there. */
export function hasDrawing(host) {
    return !!(host && host._fullLayout && Array.isArray(host.data) && host.data.length && !host.querySelector('.coverage-placeholder'));
}

/**
 * The series of a score, waiting for it while it is pending when the plot has a drawing to keep. The old
 * drawing stays, the plot's own loading pill shows (the caller's), and nothing is claimed about the score
 * (no notice, no tag, no gene count) until it is known to last: refused, failed, asks first, cancelled, not
 * offered, deleted. With no drawing yet, or in those states, it throws as loadScoreSeries does.
 * @param {Object} setting
 * @param {Object} opts - as loadScoreSeries
 * @param {AbortSignal|null} [signal]
 */
export async function loadScoreSeriesWhenReady(setting, opts, signal = null) {
    const keep = hasDrawing(opts.host);
    for (;;) {
        try {
            const got = await loadScoreSeries(setting, { ...opts, quiet: keep });
            const done = opts.host ? recordsOf(opts.host).get(opts.role) : null;
            if (done) done.quiet = false;
            return got;
        } catch (error) {
            if (!keep || !error || error.name !== 'ScoreUnavailable' || !PENDING.includes(error.scoreState)) {
                // it lasts (or there is nothing to keep): say so
                const rec = opts.host ? recordsOf(opts.host).get(opts.role) : null;
                if (rec) { rec.quiet = false; paint(opts.host); }
                throw error;
            }
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const rec = recordsOf(opts.host).get(opts.role);
            await new Promise((resolve, reject) => {
                if (!rec) { resolve(); return; }
                (rec.waiters = rec.waiters || []).push(resolve);
                if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
        }
    }
}

/** The last entry of a score's option list: opens the signature panel on what it offers. */
export const OFFER_MORE = '__offer_more__';

/** The value that is not a signature: "New signature..." in the key list. */
export const NEW_SIGNATURE = '__new_signature__';

/** Hover entries have a role each (`hover:<signature>:<aggregation>`): one plot may show several. */
const isHover = (role) => typeof role === 'string' && role.startsWith('hover');

/** The axes a score can be an x, y or z of; the rest of the roles are colour and hover. */
const AXIS_ROLES = ['x', 'y', 'z'];

/** The page's panel registry (window.PanelManager, as plot-make.js reads it): importing the module would load every panel. */
const PanelManager = {
    getPanel: (id) => globalThis.PanelManager.getPanel(id),
    getAllPanels: () => globalThis.PanelManager.getAllPanels(),
    getActivePanels: () => globalThis.PanelManager.getActivePanels(),
    reopenClosedPanel: (id, opts) => globalThis.PanelManager.reopenClosedPanel(id, opts)
};

let _store = null;
let _sources = null;

/** host -> Map(role -> {handle, sigId, role, setting, drawnKey, panelId}) */
const HOSTS = new WeakMap();
/** hosts with records, to repaint */
const LIVE_HOSTS = new Set();

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
        offers: (recipe, sub, layer) => isOffered(recipe, sub, layer || undefined),
        resolver: tableResolver
    });
}

function context() {
    const cells = DataManager.getCells();
    return { dataset: DataManager.getCurrentDataset() || '', subset: DataManager.getSubsetParam(),
        cells: cells && Number.isFinite(Number(cells.length)) ? Number(cells.length) : null };
}

/** The store and the sources, made when first needed. */
export function scores() {
    if (!_sources) {
        _store = createScoreStore({ api: createScoreApi({ url: Config.API.GENE_SCORE }) });
        _sources = createScoreSources({ store: _store, signatures: signatureAdapter(), context });
    }
    return { store: _store, sources: _sources };
}

/** The aggregations a signature panel offers consumers, first the default: [{value, label}]. */
function offeredSubs(panel) {
    if (!isSource(panel)) return METHODS.map(value => ({ value, label: SUB_LABELS[value] }));
    // a signature's recipe, or a table's option fields: both have the default method
    const recipe = optionFieldsOf(panel);
    const seen = [];
    // what the panel offers (impossible combinations left out), the default first
    for (const o of (typeof panel.getOfferedOptions === 'function' ? panel.getOfferedOptions() : offeredOptions(recipe))) {
        if (!seen.includes(o.method)) seen.push(o.method);
    }
    seen.sort((a, b) => (a === recipe.method ? -1 : b === recipe.method ? 1 : 0));
    return seen.map(value => ({ value, label: SUB_LABELS[value] || value }));
}

/**
 * Every source of a gene score, open or closed: signatures first, then gene tables, each in the order they were made.
 * [{id, title, open, kind: 'signature'|'table', subs, input, options}].
 */
export function sourceList() {
    const open = new Set(PanelManager.getActivePanels().map(p => p.getId()));
    const all = PanelManager.getAllPanels().filter(isSource);
    return [...all.filter(p => p.getType() === 'gene-signature'), ...all.filter(p => p.getType() !== 'gene-signature')]
        .map(p => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()), kind: kindOfType(p.getType()), subs: offeredSubs(p),
            input: optionFieldsOf(p).input, options: scoreOptions(p.getId()) }));
}

/** The source panel (a signature or a gene table) with this id, or null. */
function sourcePanel(id) {
    const panel = id ? PanelManager.getPanel(id) : null;
    return isSource(panel) ? panel : null;
}

/**
 * The layer a source reads when a consumer names none: its first offered layer now. Null when there is no such source.
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

/** A custom error: the series cannot be drawn yet, and why. */
export class ScoreUnavailable extends Error {
    constructor(text, notice, coverage, scoreState = null) {
        super(text);
        this.scoreState = scoreState;
        this.name = 'ScoreUnavailable';
        this.scoreNotice = notice;
        this.coverage = coverage;
    }
}

// ---------------------------------------------------------------------------
// records: one handle per (host, role)

function recordsOf(host) {
    let map = HOSTS.get(host);
    if (!map) {
        map = new Map();
        HOSTS.set(host, map);
    }
    return map;
}

function panelIdOf(host) {
    return host && typeof host.id === 'string' && host.id.startsWith('plot-container-')
        ? host.id.slice('plot-container-'.length) : (host && host.__azPanelId) || null;
}

function isVisible(host) {
    if (!host || !host.isConnected) return false;
    return host.__scoreVisible !== false;
}

function watchVisibility(host) {
    if (host.__scoreObserver || typeof IntersectionObserver === 'undefined') return;
    host.__scoreVisible = true;
    host.__scoreObserver = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        const now = !!last.isIntersecting;
        if (now === host.__scoreVisible) return;
        host.__scoreVisible = now;
        scores().sources.visibilityChanged();
    });
    host.__scoreObserver.observe(host);
}

function release(host, role) {
    const map = HOSTS.get(host);
    const rec = map && map.get(role);
    if (!rec) return;
    rec.handle.release();
    map.delete(role);
    if (!map.size) {
        LIVE_HOSTS.delete(host);
        showNotice(host, null);
        if (host.__scoreObserver) {
            host.__scoreObserver.disconnect();
            host.__scoreObserver = null;
        }
    } else {
        paint(host);
    }
}

/** A plot closes: its dependants go, and a score nothing else needs stops computing. */
export function releaseHost(host) {
    const map = HOSTS.get(host);
    if (!map) return;
    for (const role of [...map.keys()]) release(host, role);
}

/** Whether the plot still reads the score a record holds (the user may have changed the axis). */
function stillUsed(rec) {
    const panel = rec.panelId ? PanelManager.getPanel(rec.panelId) : null;
    if (!panel || typeof panel.getConfig !== 'function') return true;
    const cfg = panel.getConfig();
    if (isHover(rec.role)) {
        return (cfg.hoverInfo || []).some(h => h && h.type === 'gene-score' && h.key === rec.sigId && subKeyOf(h) === rec.sub && layerOf(h) === (rec.layer || ''));
    }
    const s = cfg[rec.role];
    return !!(s && s.type === 'gene-score' && s.key === rec.sigId && subKeyOf(s) === rec.sub && layerOf(s) === (rec.layer || ''));
}

// ---------------------------------------------------------------------------
// painting

const PAINT_MS = 120;

function schedulePaint(host) {
    if (host.__scorePaint) return;
    host.__scorePaint = setTimeout(() => {
        host.__scorePaint = null;
        paint(host);
    }, PAINT_MS);
}

function noticeOf(rec) {
    const snap = rec.handle.read();
    // while a load waits for a score that is only pending, nothing is said: the plot keeps what it shows and the loading pill speaks
    if (rec.quiet && PENDING.includes(snap.state)) return { rec, snap, notice: null };
    return { rec, snap, notice: describeScore(snap, { role: rec.role === 'color' ? 'colour' : (isHover(rec.role) ? 'hover' : rec.role), sharers: rec.handle.sharers() }) };
}

/**
 * The placeholder an axis shows while its score cannot be drawn. Also the
 * progress repaint: it replaces itself.
 */
export function drawScorePlaceholder(host, notice) {
    if (!host) return;
    const unit = 'cells';
    const cov = Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: null });
    drawPlaceholder(host, cov, unit, {
        actions: notice.actions,
        say: { severity: notice.severity === 'error' ? 'error' : 'notice', headline: notice.headline,
            lines: notice.text ? [notice.text] : [] }
    });
    const box = host.querySelector('.coverage-placeholder');
    if (box) box.dataset.scoreState = notice.state;
    host.__scorePlaceholder = true;
}

/** Say what every score of this plot is doing: an overlay and a strip tag, never a resize. */
export function paint(host) {
    const map = HOSTS.get(host);
    if (!map || !map.size) return;
    const entries = [...map.values()].filter(r => !isHover(r.role)).map(noticeOf);
    const axis = worstNotice(entries.filter(e => AXIS_ROLES.includes(e.rec.role) && e.notice && e.notice.blocksAxis)
        .map(e => e.notice));
    const worst = worstNotice(entries.map(e => e.notice));
    const shown = entries.find(e => e.notice === worst);
    host.__scoreShown = shown ? shown.rec.role : null;
    // an axis that cannot be drawn: nothing truthful can be shown, so the plot area says it, as a placeholder
    showNotice(host, worst, { overlay: !axis });
    if (axis) {
        if (host.__scoreHost && (host.__scorePlaceholder || host.querySelector('.coverage-placeholder'))) drawScorePlaceholder(host, axis);
        return;
    }
    host.__scorePlaceholder = false;
}

/**
 * Say a score's notice on a host (a plot's or a table's container): a strip tag and an overlay inside the host, so
 * nothing moves or resizes. Null clears both.
 * @param {HTMLElement} host
 * @param {Object|null} notice - from describeScore
 * @param {{overlay?: boolean}} [opts] - false when the host states the notice itself (an axis placeholder)
 */
export function showNotice(host, notice, { overlay = true } = {}) {
    setStatusTag(host, 'score', notice && { text: notice.tag.text, severity: notice.severity === 'error' ? 'error' : 'warning',
        title: notice.tag.title, pop: { text: `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`, actions: notice.actions } });
    setScoreNotice(host, notice && overlay ? { state: notice.state, headline: notice.headline, text: notice.text, actions: notice.actions } : null);
}

function refreshPanel(host) {
    if (host.__scoreRefresh) return;
    host.__scoreRefresh = setTimeout(() => {
        host.__scoreRefresh = null;
        const panel = PanelManager.getPanel(panelIdOf(host));
        const reload = panel && (panel.refreshPlot || panel.refreshTable);
        if (typeof reload === 'function') Promise.resolve(reload()).catch(() => {});
    }, 30);
}

function onChange(host, rec, snap) {
    if (rec.waiters && rec.waiters.length) for (const wake of rec.waiters.splice(0)) wake();
    if (!host.isConnected) { release(host, rec.role); return; }
    if (!stillUsed(rec)) { release(host, rec.role); paint(host); return; }
    const showing = snap.values ? (snap.shownKey || snap.key) : null;
    if (!rec.quiet && snap.state !== 'updating' && rec.drawnKey !== undefined && showing !== rec.drawnKey) {
        refreshPanel(host);
    }
    schedulePaint(host);
}

function recordFor(host, role, setting) {
    const map = recordsOf(host);
    let rec = map.get(role);
    const sub = subKeyOf(setting);
    if (rec && (rec.sigId !== setting.key || rec.sub !== sub || (rec.layer || '') !== layerOf(setting))) {
        release(host, role);
        rec = null;
    }
    if (!rec) {
        const { sources } = scores();
        rec = { role, sigId: setting.key, sub, layer: setting.layer || null, setting, panelId: panelIdOf(host), drawnKey: undefined, handle: null };
        rec.handle = sources.watch(setting.key, {
            kind: 'plot', host, role, sub, layer: setting.layer || null, dependant: rec.panelId, visible: () => isVisible(host),
            onChange: (snap) => onChange(host, rec, snap)
        });
        recordsOf(host).set(role, rec);
        LIVE_HOSTS.add(host);
        host.__scoreHost = true;
        watchVisibility(host);
    }
    rec.setting = setting;
    return rec;
}

// ---------------------------------------------------------------------------
// the series a plot loads

/**
 * The series of a `gene-score` source for a cell plot.
 * @param {Object} setting - `{type: 'gene-score', key, label}`
 * @param {{host: HTMLElement, role: string, expected: (number|null), unit: string}} opts
 * @returns {Promise<{values: Array<number>, type: 'numerical', categories: null, coverage: Coverage, vector: Float32Array}>}
 *   `values` is a plain array (the regular plot's form); `vector` is the Float32Array
 * @throws {ScoreUnavailable} when no score can be drawn
 */
export function loadScoreSeries(setting, { host, role, expected, unit = 'cells', array = true, quiet = false }) {
    // the setting keeps the source's title (for when the source is deleted) and what the colour bar, axis titles and
    // legends say (two lines for the bar), both refreshed whenever the score is read
    nameSetting(setting);
    const title = scoreLabel(setting);
    if (!host || !setting.key) {
        const notice = describeScore({ state: 'unset', title: '' }, { role });
        throw new ScoreUnavailable(notice.headline, notice,
            Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: expected }));
    }
    // an entry with no layer (an old link) is resolved now, once, to the signature's input
    if (!setting.layer) { const input = sourceInput(setting.key); if (input) setting.layer = input; }
    const rec = recordFor(host, role, setting);
    rec.quiet = quiet;
    const snap = rec.handle.read();
    if (snap.values) {
        rec.drawnKey = snap.shownKey || snap.key;
        paint(host);
        const vector = snap.values;
        const values = array ? Array.from(vector) : null;
        const source = `gene score ${title}`;
        const coverage = array ? classifyValues({ values, expected, unit, source }) : Coverage.complete(vector.length, unit);
        return Promise.resolve({ values: array ? values : vector, type: 'numerical', categories: null, coverage, vector });
    }
    rec.drawnKey = null;
    const notice = describeScore(snap, { role, sharers: rec.handle.sharers() })
        || describeScore({ ...snap, state: 'estimating' }, { role });
    // a caller that waits for the score says nothing yet (rec.quiet): no notice and no tag until it is known to last
    if (!(quiet && PENDING.includes(snap.state))) paint(host);
    throw new ScoreUnavailable(notice.headline, notice,
        Coverage.missing(GAP.UNAVAILABLE, `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`,
            { source: `gene score ${title}`, unit, total: expected }), snap.state);
}

/** The record that reads this very setting object, if a plot loaded it. */
function recordOfSetting(setting) {
    for (const host of LIVE_HOSTS) {
        for (const rec of recordsOf(host).values()) if (rec.setting === setting) return rec;
    }
    return null;
}

/**
 * One cell's value of a score a plot holds, by its position among the cells
 * shown (a large plot's tooltip reads it here rather than asking the server
 * for one cell).
 * @returns {number|null}
 */
export function heldScoreValue(setting, position) {
    const rec = recordOfSetting(setting);
    if (!rec) return null;
    const snap = rec.handle.read();
    if (!snap.values || !(position >= 0 && position < snap.values.length)) return null;
    const v = snap.values[position];
    return Number.isNaN(v) ? null : v;
}

/** Which score a plot shows now (changes when the recipe or the cells do): for caches keyed by the colour. */
export function shownScoreKey(setting) {
    const rec = recordOfSetting(setting);
    if (!rec) return '';
    const snap = rec.handle.read();
    return snap.values ? (snap.shownKey || snap.key || '') : '';
}

// ---------------------------------------------------------------------------
// actions of the notices (main.js routes `score-*` here)

export const SCORE_ACTIONS = ['score-offer', 'score-compute', 'score-cancel', 'score-retry', 'score-update', 'score-open', 'score-choose'];

function shownRecord(host) {
    const map = HOSTS.get(host);
    if (!map) return null;
    return map.get(host.__scoreShown) || [...map.values()][0] || null;
}

/**
 * Hosts other than plots (a Cell Table's score columns) run the same actions: each registers a
 * provider `{available(action, host) -> boolean|undefined, run(action, host) -> boolean}` that
 * answers for its own containers and says nothing (undefined, false) for the rest.
 */
const HOST_ACTIONS = new Set();
export function registerHostActions(provider) {
    HOST_ACTIONS.add(provider);
}

/** Whether a score action applies to this plot now. */
export function scoreActionAvailable(action, host) {
    for (const provider of HOST_ACTIONS) {
        const answer = provider.available(action, host);
        if (answer !== undefined) return answer;
    }
    if (!SCORE_ACTIONS.includes(action)) return false;
    const rec = shownRecord(host);
    if (!rec) return false;
    return action !== 'score-open' || !!sourcePanel(rec.sigId);
}

/** Run a score action for a plot. */
export function runScoreAction(action, host) {
    for (const provider of HOST_ACTIONS) if (provider.run(action, host)) return;
    const rec = shownRecord(host);
    if (!rec) return;
    const { sources } = scores();
    switch (action) {
        case 'score-compute':
            for (const r of recordsOf(host).values()) r.handle.compute();
            break;
        case 'score-offer':
            offerAgain(rec.setting);
            break;
        case 'score-cancel':
            rec.handle.cancel();
            break;
        case 'score-retry':
            rec.handle.retry();
            break;
        case 'score-update':
            sources.update(rec.sigId);
            break;
        case 'score-open':
            openSignature(rec.sigId, panelIdOf(host));
            break;
        case 'score-choose': {
            const tile = host.closest ? host.closest('.tile') : null;
            const select = tile && tile.querySelector(`.axis-key-select[data-axis="${isHover(rec.role) ? 'color' : rec.role}"]`);
            if (select) {
                select.scrollIntoView && select.scrollIntoView({ block: 'nearest' });
                select.focus();
            }
            break;
        }
    }
}

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
const MENU_KEYS = ['offered', 'layers', 'input', 'method', 'detect_above'];

/**
 * A source changed: its genes (a signature's list, the rows a table's filter passes) or the option fields named in
 * `keys`, by an edit in its panel or from outside (a saved config, Back and Forward). The plots and tables that read
 * its score follow by the rules for an edit (utils/score-sources.js), and the menus that list what it offers are
 * rebuilt when what they list changed.
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

/** A source was renamed, or what it offers changed: the menus that list it are rebuilt and the titles of the plots that show it follow. */
export function sourceRenamed(id) {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
    if (!_sources) return;
    for (const host of LIVE_HOSTS) {
        for (const rec of recordsOf(host).values()) {
            if (rec.sigId !== id) continue;
            if (nameSetting(rec.setting) && rec.drawnKey) refreshPanel(host);
        }
    }
}

/** Panels were added, removed, closed or reopened: a deleted signature shows, a returned one resolves. */
export function panelsChanged() {
    if (!_sources) return;
    _sources.recheck();
    _sources.contextChanged();
    for (const host of LIVE_HOSTS) schedulePaint(host);
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

registerSource({
    type: 'gene-score',
    label: 'gene-score',
    entity: 'cells',
    consumers: ['cell-plot'],
    axes: ['x', 'y', 'z', 'color', 'hover'],
    defaultSub: DEFAULT_METHOD,
    entities: () => sourceList(),
    /** The aggregations the server computes, z-score mean first; a new method is a new entry in METHODS. */
    subKeys: (id) => {
        const panel = sourcePanel(id);
        if (panel) return offeredSubs(panel);
        // no id: every aggregation; an id nothing answers to (a deleted signature): the ones offered by default
        return (id ? DEFAULT_OFFERED : METHODS).map(value => ({ value, label: SUB_LABELS[value] || value }));
    },
    load: (setting, opts) => loadScoreSeries(setting, opts)
});


/**
 * What a signature offers its consumers, as one list of entries (method and layer together, in the
 * order of offeredOptions). `layer` is what a consumer stores: '' for the signature's default layer.
 * @param {string} id - a signature panel id
 * @returns {Array<{id: string, value: string, method: string, layer: string, label: string, short: string}>}
 */
export function scoreOptions(id) {
    const panel = sourcePanel(id);
    if (!panel) return [];
    const recipe = optionFieldsOf(panel);
    // the panel's own graded list: a combination that cannot be computed (a share on a log layer) is left out
    const list = typeof panel.getOfferedOptions === 'function' ? panel.getOfferedOptions() : offeredOptions(recipe, _datasetLayers);
    return list.filter(o => !_datasetLayers || !_datasetLayers.length || _datasetLayers.includes(o.layer)).map(o => ({
        id: o.id, value: o.id, method: o.method, layer: o.layer, label: o.label,
        short: methodShort(o.method)
    }));
}

/** The dataset's layers (X first), noted from its structure when a menu is built. */
let _datasetLayers = null;
export function noteDatasetLayers(list) {
    _datasetLayers = Array.isArray(list) ? [...list] : null;
}

/** The entry a consumer's setting stands for in a signature's options, or null when it is not offered. */
export function optionOf(setting) {
    const sub = subKeyOf(setting);
    // no layer: the setting follows the signature's default layer (a link made before the layer was stored)
    const layer = layerOf(setting) || sourceInput(setting.key) || DEFAULT_INPUT;
    return scoreOptions(setting.key).find(o => o.method === sub && o.layer === layer) || null;
}

/** The label of an option a consumer holds that the signature no longer offers. */
export function lapsedLabel(setting) {
    const panel = sourcePanel(setting && setting.key);
    const several = panel ? new Set(offeredOptions(optionFieldsOf(panel), _datasetLayers).map(o => o.layer)).size > 1 : false;
    const layer = layerOf(setting);
    const base = methodShort(subKeyOf(setting));
    return `${several || layer ? `${base} · ${layer || sourceInput(setting.key) || DEFAULT_INPUT}` : base} (no longer offered)`;
}

/**
 * "Offer other scores…": open (or reopen) the signature's panel beside `nextTo`, expand its offered
 * options and put the cursor there.
 * @param {string} id - the signature
 * @param {string|null} nextTo - the panel the request came from
 */
export function offerOtherScores(id, nextTo = null) {
    const panel = openSignature(id, nextTo);
    if (panel && typeof panel.revealScoresOffered === 'function') {
        // the panel may still be building its sections
        setTimeout(() => panel.revealScoresOffered(), 0);
    }
    return panel;
}

/**
 * Offer again the option a consumer holds that its source stopped offering (the notice's one-click action, for a plot
 * and a table column alike).
 * @param {{key: string, column?: string, layer?: string}} setting - the consumer's setting
 * @returns {boolean} whether the source took it
 */
export function offerAgain(setting) {
    const panel = sourcePanel(setting && setting.key);
    if (!panel) return false;
    const method = subKeyOf(setting);
    const layer = layerOf(setting);
    const recipe = optionFieldsOf(panel);
    const offered = [...new Set([...(recipe.offered || []), method])];
    const layers = layer && !(recipe.layers || []).includes(layer) ? [...(recipe.layers || [recipe.input]), layer] : recipe.layers;
    const patch = { offered, ...(layers ? { layers } : {}) };
    // a gene table stores the option fields under one key; a signature keeps them in its recipe
    if (typeof panel.setScoreOptions === 'function') panel.setScoreOptions(patch);
    else if (typeof panel.updateConfig === 'function') panel.updateConfig(patch);
    else return false;
    scores().sources.recheck();
    return true;
}
