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
import { registerSource, subKeyOf } from './source-registry.js';
import { METHODS, DEFAULT_METHOD } from './gene-signature.js';

/** What each aggregation is called where a consumer picks it (level 3). */
const SUB_LABELS = { zscore_mean: 'z-score mean', mean: 'mean' };

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
        off: () => !Policy.panelEnabled('gene-signature')
    };
}

function context() {
    return { dataset: DataManager.getCurrentDataset() || '', subset: DataManager.getSubsetParam() };
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

/** Every signature panel, open or closed: [{id, title, open}]. */
export function signatureList() {
    const open = new Set(PanelManager.getActivePanels().map(p => p.getId()));
    return PanelManager.getAllPanels()
        .filter(p => p.getType && p.getType() === 'gene-signature')
        .map(p => ({ id: p.getId(), title: p.getTitle(), open: open.has(p.getId()) }));
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
    const title = scoreTitle(setting).replace(/ · (z-score mean|mean)$/, '');
    return !sub || sub === DEFAULT_METHOD ? title : `${title} · ${SUB_LABELS[sub] || sub}`;
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
        return (cfg.hoverInfo || []).some(h => h && h.type === 'gene-score' && h.key === rec.sigId && subKeyOf(h) === rec.sub);
    }
    const s = cfg[rec.role];
    return !!(s && s.type === 'gene-score' && s.key === rec.sigId && subKeyOf(s) === rec.sub);
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
    if (rec && (rec.sigId !== setting.key || rec.sub !== sub)) {
        release(host, role);
        rec = null;
    }
    if (!rec) {
        const { sources } = scores();
        rec = { role, sigId: setting.key, sub, setting, panelId: panelIdOf(host), drawnKey: undefined, handle: null };
        rec.handle = sources.watch(setting.key, {
            host, role, sub, visible: () => isVisible(host),
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

export const SCORE_ACTIONS = ['score-compute', 'score-cancel', 'score-retry', 'score-update', 'score-open', 'score-choose'];

function shownRecord(host) {
    const map = HOSTS.get(host);
    if (!map) return null;
    return map.get(host.__scoreShown) || [...map.values()][0] || null;
}

/** Whether a score action applies to this plot now. */
export function scoreActionAvailable(action, host) {
    if (!SCORE_ACTIONS.includes(action)) return false;
    const rec = shownRecord(host);
    if (!rec) return false;
    const panel = PanelManager.getPanel(rec.sigId);
    if (action === 'score-open') return !!panel && panel.getType() === 'gene-signature';
    return true;
}

/** Run a score action for a plot. */
export function runScoreAction(action, host) {
    const rec = shownRecord(host);
    if (!rec) return;
    const { sources } = scores();
    switch (action) {
        case 'score-compute':
            for (const r of recordsOf(host).values()) r.handle.compute();
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
    /** The aggregations the server computes now, z-score mean first; later methods are new entries here. */
    subKeys: () => METHODS.map(value => ({ value, label: SUB_LABELS[value] || value })),
    load: (setting, opts) => loadScoreSeries(setting, opts)
});
