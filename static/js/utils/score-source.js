/**
 * The page's side of the `gene-score` source: signatures, scores and the
 * plots that show them. The logic is in utils/score-store.js (cache, jobs,
 * tiers) and utils/score-sources.js (dependants, edits); this binds them to
 * PanelManager, DataManager and the plot containers, and paints the notices
 * of utils/score-notices.js.
 *
 * A plot's x, y, z, colour or hover that reads `{type: 'gene-score', key: <the
 * signature's panel id>, label: <its title when last seen>}` asks here for its
 * series (`loadScoreSeries`). A ready score is returned as a series. Anything
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
import { DEFAULT_METHOD } from './gene-signature.js';
import { DEFAULT_OFFERED, METHODS, methodShort, methodLabel, offeredOptions, isOffered } from './signature-options.js';

/** What each aggregation is called where a consumer picks it (level 3). */
const SUB_LABELS = Object.fromEntries(METHODS.map(m => [m, methodShort(m)]));

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

function signatureAdapter() {
    return {
        get(id) {
            const panel = id ? PanelManager.getPanel(id) : null;
            if (!panel || typeof panel.getType !== 'function' || panel.getType() !== 'gene-signature'
                || typeof panel.getRecipe !== 'function') return null;
            return { title: panel.getTitle(), recipe: () => panel.getRecipe() };
        },
        off: () => !Policy.panelEnabled('gene-signature'),
        offers: (recipe, sub, layer) => isOffered(recipe, sub, layer || undefined)
    };
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

/** For tests: replace the store and sources (Node cannot reach the page). */
export function _useForTest(store, sources) {
    _store = store;
    _sources = sources;
}

/** The aggregations a signature panel offers consumers, first the default: [{value, label}]. */
function offeredSubs(panel) {
    if (!panel || typeof panel.getRecipe !== 'function') return METHODS.map(value => ({ value, label: SUB_LABELS[value] }));
    const recipe = panel.getRecipe();
    const seen = [];
    for (const o of offeredOptions(recipe)) if (!seen.includes(o.method)) seen.push(o.method);
    seen.sort((a, b) => (a === recipe.method ? -1 : b === recipe.method ? 1 : 0));
    return seen.map(value => ({ value, label: SUB_LABELS[value] || value }));
}

/** Every signature panel, open or closed: [{id, title, open}]. */
export function signatureList() {
    const open = new Set(PanelManager.getActivePanels().map(p => p.getId()));
    return PanelManager.getAllPanels()
        .filter(p => p.getType && p.getType() === 'gene-signature')
        .map(p => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()), subs: offeredSubs(p), input: p.getRecipe ? p.getRecipe().input : 'X', options: scoreOptions(p.getId()) }));
}

/** The title of the signature a setting names, or what it was called when last seen. */
export function scoreTitle(setting) {
    const panel = setting && setting.key ? PanelManager.getPanel(setting.key) : null;
    const base = panel && panel.getType && panel.getType() === 'gene-signature' ? panel.getTitle()
        : (setting && setting.label) || (setting && setting.key) || '';
    return base;
}

/** The name a consumer shows for a score: the signature's title, and the aggregation when it is not the default. */
export function scoreLabel(setting) {
    const sub = subKeyOf(setting);
    const title = scoreTitle(setting).replace(new RegExp(`( · (${METHODS.map(m => SUB_LABELS[m]).join('|')}))?( · of .+)?$`), '');
    const layer = layerOf(setting);
    const panel = setting && setting.key ? PanelManager.getPanel(setting.key) : null;
    const own = panel && panel.getRecipe ? panel.getRecipe().input : 'X';
    const out = !sub || sub === DEFAULT_METHOD ? title : `${title} · ${SUB_LABELS[sub] || sub}`;
    // the layer is named when it is not the one the signature itself reads
    return layer && layer !== own ? `${out} · ${layer}` : out;
}

/**
 * The two lines a score is named by wherever it leaves the app (the colour bar, an axis title, a legend,
 * a CSV header): the signature's title, then the method and the layer it was computed over, always.
 * @returns {[string, string]}
 */
export function scoreLabelLines(setting) {
    const title = scoreTitle(setting).replace(new RegExp(`( · (${METHODS.map(m => SUB_LABELS[m]).join('|')}))?( · of .+)?$`), '');
    const panel = setting && setting.key ? PanelManager.getPanel(setting.key) : null;
    const own = panel && panel.getRecipe ? panel.getRecipe().input : 'X';
    const sub = subKeyOf(setting);
    return [title, `${SUB_LABELS[sub] || sub} · ${layerOf(setting) || own}`];
}

/** The one-line form of scoreLabelLines: "T cell score · z-score mean · X". */
export function scoreFullLabel(setting) {
    return scoreLabelLines(setting).join(' · ');
}

/** A custom error: the series cannot be drawn yet, and why. */
export class ScoreUnavailable extends Error {
    constructor(text, notice, coverage) {
        super(text);
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
        setScoreNotice(host, null);
        setStatusTag(host, 'score', null);
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
    return { rec, snap, notice: describeScore(snap, { role: rec.role === 'color' ? 'colour' : (isHover(rec.role) ? 'hover' : rec.role), sharers: rec.handle.sharers() }) };
}

/**
 * The placeholder an axis shows while its score cannot be drawn. Also the
 * progress repaint: it replaces itself.
 */
export function drawScorePlaceholder(host, notice, snap) {
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
    void snap;
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
    if (!worst) {
        setScoreNotice(host, null);
        setStatusTag(host, 'score', null);
        host.__scorePlaceholder = false;
        return;
    }
    setStatusTag(host, 'score', { text: worst.tag.text, severity: worst.severity === 'error' ? 'error' : 'warning',
        title: worst.tag.title, pop: { text: `${worst.headline}${worst.text ? ` ${worst.text}` : ''}`, actions: worst.actions } });
    if (axis) {
        // nothing truthful can be drawn: the plot area says so, as a placeholder
        setScoreNotice(host, null);
        if (host.__scorePlaceholder || host.querySelector('.coverage-placeholder')) {
            const again = entries.find(e => e.notice === axis);
            if (host.__scoreHost) drawScorePlaceholder(host, axis, again && again.snap);
        }
        return;
    }
    host.__scorePlaceholder = false;
    setScoreNotice(host, { state: worst.state, headline: worst.headline, text: worst.text, actions: worst.actions });
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
    if (!host.isConnected) { release(host, rec.role); return; }
    if (!stillUsed(rec)) { release(host, rec.role); refreshPanelIfNeeded(host); return; }
    const showing = snap.values ? (snap.shownKey || snap.key) : null;
    if (snap.state !== 'updating' && rec.drawnKey !== undefined && showing !== rec.drawnKey) {
        refreshPanel(host);
    }
    schedulePaint(host);
}

function refreshPanelIfNeeded(host) {
    paint(host);
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
            host, role, sub, layer: setting.layer || null, visible: () => isVisible(host),
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
export function loadScoreSeries(setting, { host, role, expected, unit = 'cells', array = true }) {
    const title = scoreLabel(setting);
    if (title && setting.label !== title) setting.label = title;
    // what the colour bar, axis titles and legends say (two lines for the bar), refreshed with the label
    const lines = scoreLabelLines(setting).join('\n');
    if (setting.labelFull !== lines) setting.labelFull = lines;
    if (!host || !setting.key) {
        const notice = describeScore({ state: 'unset', title: '' }, { role });
        throw new ScoreUnavailable(notice.headline, notice,
            Coverage.missing(GAP.UNAVAILABLE, notice.headline, { source: 'gene score', unit, total: expected }));
    }
    const rec = recordFor(host, role, setting);
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
    paint(host);
    throw new ScoreUnavailable(notice.headline, notice,
        Coverage.missing(GAP.UNAVAILABLE, `${notice.headline}${notice.text ? ` ${notice.text}` : ''}`,
            { source: `gene score ${title}`, unit, total: expected }));
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
    const panel = PanelManager.getPanel(rec.sigId);
    if (action === 'score-open') return !!panel && panel.getType() === 'gene-signature';
    return true;
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
            offerAgain(rec.sigId, rec.sub, rec.layer);
            sources.recheck();
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
    const panel = PanelManager.getPanel(id);
    if (!panel || panel.getType() !== 'gene-signature') return null;
    if (PanelManager.getActivePanels().includes(panel)) {
        const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`);
        if (tile && tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
        return panel;
    }
    return PanelManager.reopenClosedPanel(id, { nextTo });
}

// ---------------------------------------------------------------------------
// events from the page

/** A signature was edited (called by the panel). */
export function signatureChanged(id) {
    if (_sources) _sources.recipeChanged(id);
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

/** A signature was renamed: the titles of the plots that show it follow. */
export function signatureRenamed(id) {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('annzarro:panels-changed'));
    if (!_sources) return;
    for (const host of LIVE_HOSTS) {
        for (const rec of recordsOf(host).values()) {
            if (rec.sigId !== id) continue;
            const title = scoreLabel(rec.setting);
            if (rec.setting.label !== title) {
                rec.setting.label = title;
                rec.setting.labelFull = scoreLabelLines(rec.setting).join('\n');
                if (rec.drawnKey) refreshPanel(host);
            }
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

/** The status of a signature for its own panel. */
export function signatureStatus(id) {
    return scores().sources.status(id);
}

/** Subscribe the panel to its own score status; returns the way to stop. */
export function onSignatureStatus(id, fn) {
    return scores().sources.onSignature(id, fn);
}

/** The aggregations in use for a signature, each with how many plots or tables read it: [{value, count}]. */
export function aggregationsInUse(id) {
    const counts = new Map();
    for (const handle of scores().sources.handlesOf(id)) {
        const sub = handle.sub || DEFAULT_METHOD;
        counts.set(sub, (counts.get(sub) || 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }));
}

/** The layers in use for a signature, each with how many plots or tables read it: [{value, count}]; `null` layer is the default. */
export function layersInUse(id) {
    const counts = new Map();
    for (const handle of scores().sources.handlesOf(id)) {
        const layer = handle.layer || null;
        counts.set(layer, (counts.get(layer) || 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }));
}

/** The plots and other dependants that use a signature: hosts and roles. */
export function dependantsOf(id) {
    const out = [];
    for (const host of LIVE_HOSTS) {
        for (const rec of recordsOf(host).values()) if (rec.sigId === id) out.push({ host, role: rec.role });
    }
    return out;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('annzarro:panels-changed', () => panelsChanged());
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
    entities: () => signatureList(),
    /** The aggregations the server computes, z-score mean first; a new method is a new entry in METHODS. */
    subKeys: (id) => {
        const panel = id ? PanelManager.getPanel(id) : null;
        if (panel && panel.getType && panel.getType() === 'gene-signature') return offeredSubs(panel);
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
    const panel = id ? PanelManager.getPanel(id) : null;
    if (!panel || !panel.getRecipe) return [];
    const recipe = panel.getRecipe();
    return offeredOptions(recipe, _datasetLayers).map(o => ({
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
    const panel = setting && setting.key ? PanelManager.getPanel(setting.key) : null;
    // no layer: the setting follows the signature's default layer (a link made before the layer was stored)
    const layer = layerOf(setting) || (panel && panel.getRecipe ? panel.getRecipe().input : 'X');
    return scoreOptions(setting.key).find(o => o.method === sub && o.layer === layer) || null;
}

/** The label of an option a consumer holds that the signature no longer offers. */
export function lapsedLabel(setting) {
    const panel = setting && setting.key ? PanelManager.getPanel(setting.key) : null;
    const several = panel && panel.getRecipe ? new Set(offeredOptions(panel.getRecipe(), _datasetLayers).map(o => o.layer)).size > 1 : false;
    const layer = layerOf(setting);
    const base = methodLabel(subKeyOf(setting));
    return `${several || layer ? `${base} · ${layer || (panel && panel.getRecipe ? panel.getRecipe().input : 'X')}` : base} (no longer offered)`;
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

/** Offer an option again in the signature's panel (the notice's one-click action). */
function offerAgain(id, method, layer) {
    const panel = id ? PanelManager.getPanel(id) : null;
    if (!panel || !panel.getRecipe || !panel.updateConfig) return false;
    const recipe = panel.getRecipe();
    const offered = [...new Set([...(recipe.offered || []), method])];
    const layers = layer && !(recipe.layers || []).includes(layer) ? [...(recipe.layers || [recipe.input]), layer] : recipe.layers;
    panel.updateConfig({ offered, ...(layers ? { layers } : {}) });
    return true;
}
