/**
 * The page's group sources: ONE group store and ONE set of group sources for the whole page, bound to its panels.
 * Every consumer of groups (the plots and tables of the cell-group provider, the Cell Grouping panel watching its own
 * groups, a count plot, a Cell-Gene Plot's cell axis) reads through `groupSources()`, so two of them that need the same
 * groups share one request, one copy of the codes and one notice.
 *
 * `groupSources()` is the page's binding, made when first needed:
 *
 * - the store asks the cell_groups route, within the page's limit on computations at once (score-source.js
 *   `pageLimiter`, shared with the scores);
 * - the CODES are held on the memory guard's ledger (memory-guard-ui.js `ledger`, CAT-4): pinned while a consumer on
 *   screen holds them, evictable while only hidden ones do, and released with the last (utils/group-store.js does the
 *   holding; this is where the ledger is given to it);
 * - the host hooks of utils/group-sources.js are filled once, here: what a grouping panel is (`source`), what a
 *   factor's source of another panel stands for now (`upstream`: a grouping, a table's passing cells, a score's
 *   recipe, or the gate of either), the cycle through a panel, panel titles and kinds, and the event that tells the
 *   sources a table or a score changed (`onUpstreamChange`).
 *
 * Lifted from panels/cell-grouping.js (G9a), which now imports it.
 */
import { DataManager } from '../data-manager.js';
import { Config } from '../config.js';
import { Policy } from '../policy.js';
import { serverRecipe, recipeHash } from './gene-signature.js';
import { sourceName } from './cell-grouping.js';
import { createGroupStore } from './group-store.js';
import { createGroupSources, GROUPING } from './group-sources.js';
import { createGroupsApi, createGenesApi } from './cell-groups-client.js';
import { createDerivedStore } from './derived-store.js';
import { pageLimiter } from './score-source.js';
import { createSourceAdapter } from './score-source-panels.js';
import { dependsOn } from './panel-references.js';
import { findCycle, TableResolver } from './table-resolver.js';
import { selectionOnCells } from './closed-table.js';
import { ledger } from './memory-guard-ui.js';
import { tableOfCells } from './group-stat-model.js';
import { missingFactors, PANEL_SOURCES, SCORE_SOURCE, GROUP_SOURCE, TABLE_SOURCE } from '../panels/cell-grouping/factors.js';

/** The panel type whose panels are groupings. */
const TYPE = 'cell-grouping';

/** The id of a panel's own cell axis in the page's group sources: 'axis:<panelId>' (G7b). */
export const AXIS_PREFIX = 'axis:';

/** The page's panel registry (window.PanelManager): importing panel-manager.js would load every panel. */
const panels = () => globalThis.PanelManager;

/** The panel with this id, or null. */
export const panelOf = (id) => (id && panels() ? panels().getPanel(id) : null);
/** A panel's type, or null. */
export const typeOf = (p) => (p && typeof p.getType === 'function' ? p.getType() : null);
/** Whether a panel is open (not closed). */
export const isOpen = (p) => !!p && !!panels() && panels().getActivePanels().includes(p);
/** A panel's title, or its id when it has none. */
export const titleOfPanel = (id) => { const p = panelOf(tableOfCells(id) || id); return p && p.getTitle ? p.getTitle() : id; };

/** A cycle member's kind, as a notice names a ring. */
function kindOfPanel(id) {
    const type = typeOf(panelOf(id));
    if (type === 'cell-table' || type === 'gene-table') return 'table';
    if (type === TYPE) return 'grouping';
    if (type === 'gene-signature') return 'signature';
    return type || 'panel';
}

/**
 * The ids on a cycle through `id`, as a closed ring that ends where it starts ("A, B, A"), or null. That is the shape
 * every reader of a cycle takes (group-sources.js `cycleOf`, source-notices.js `describeSource`, which drops the last).
 */
export function cycleIds(id) {
    return findCycle(id, dependsOn) || null;
}

const resolver = {
    need: (id, dependant) => TableResolver.need(id, dependant),
    accept: (id) => TableResolver.accept(id),
    cancel: (id) => TableResolver.cancel(id),
    retry: (id) => TableResolver.retry(id),
    cycleOf: (id) => cycleIds(id)
};

let _scoreAdapter = null;
function scoreAdapter() {
    if (!_scoreAdapter) {
        _scoreAdapter = createSourceAdapter({ panel: panelOf, active: isOpen, geneNames: () => DataManager.getGenes(), resolver });
    }
    return _scoreAdapter;
}

/** The dataset's structure, as last read (a gate is asked on every read and cannot wait for it). */
let _structure = { dataset: null, value: null };

/** The structure of the open dataset as last read, or null when it is not read yet or is another dataset's. */
export function structureNow() {
    return _structure.dataset === DataManager.getCurrentDataset() ? _structure.value : null;
}

/** The structure as last read, whatever dataset it is of (what a panel last drew from). */
export function structureRead() {
    return _structure.value;
}

/** Forget the structure (the dataset changed). */
export function resetStructure() {
    _structure = { dataset: null, value: null };
}

/** Read the structure of the open dataset into the cache; resolves to it. */
export async function loadStructure() {
    const dataset = DataManager.getCurrentDataset();
    if (!dataset || !DataManager.isDatasetLoaded()) return null;
    if (_structure.dataset === dataset && _structure.value) return _structure.value;
    const value = await DataManager.getDatasetStructure(dataset);
    _structure = { dataset, value };
    return value;
}

/** The dataset's genes as a Set, made once per gene list. */
let _genes = { list: null, set: null };
/** Whether the open dataset has this gene. */
export function hasGene(name) {
    const list = DataManager.getGenes() || [];
    if (_genes.list !== list) _genes = { list, set: new Set(list) };
    return _genes.set.has(name);
}

const gone = (message) => ({ gate: { state: 'failed', reason: 'upstream_gone', message } });

/** A hash of a table's passing rows for the cells shown: equal rows, equal hash. */
function rowsHash(entries, n) {
    let h = 2166136261 >>> 0;
    for (const i of entries) { h ^= i & 0xffff; h = Math.imul(h, 16777619) >>> 0; h ^= i >>> 16; h = Math.imul(h, 16777619) >>> 0; }
    return `${n}:${entries.length}:${h.toString(16)}`;
}

/** @type {Map<string, {hash: string, flags: Uint8Array}>} table id -> its last bitset, the same array while its hash is */
const _bitsets = new Map();
function bitsetOf(id, entries, n) {
    const hash = rowsHash(entries, n);
    const was = _bitsets.get(id);
    if (was && was.hash === hash) return was;
    const flags = new Uint8Array(n);
    for (const i of entries) if (i >= 0 && i < n) flags[i] = 1;
    const made = { hash, flags };
    _bitsets.set(id, made);
    return made;
}

/** What a table factor stands for: its passing cells shown, or the gate of its build (GRP-15). */
function tableUpstream(id, dependant) {
    const panel = panelOf(id);
    if (!panel || typeOf(panel) !== 'cell-table') return gone('the table it uses is gone');
    const cells = DataManager.getCells() || [];
    const n = cells.length;
    const actions = { accept: () => TableResolver.accept(id), cancel: () => TableResolver.cancel(id), retry: () => TableResolver.retry(id) };
    const gated = TableResolver.gate(id);
    const cfg = panel.getConfig();
    if (isOpen(panel) && !gated) {
        if (typeof panel.isReady === 'function' && !panel.isReady()) return { gate: { state: 'building', table: id }, actions };
        const entries = Array.isArray(cfg.currentEntries) ? cfg.currentEntries : [];
        return { bitset: () => bitsetOf(id, entries, n) };
    }
    // closed: by name, on the cells shown, from what it kept when it closed
    const selection = cfg.closedSelection || null;
    if (selection && Array.isArray(cells)) {
        const found = selectionOnCells(selection, cells);
        if (!found.unknown) {
            return { bitset: () => {
                const entries = [];
                cells.forEach((name, i) => { if (found.passing.has(name)) entries.push(i); });
                return bitsetOf(id, entries, n);
            } };
        }
    }
    const status = gated || TableResolver.need(id, dependant);
    if (!status || status.state === 'ready') return { gate: { state: 'building', table: id }, actions };
    if (status.state === 'missing') return gone('the table it uses is gone');
    const state = ['ask', 'refused', 'failed', 'cycle'].includes(status.state) ? status.state : 'building';
    return { gate: { ...status, state, table: id, message: status.reason && state !== 'building' ? status.reason : undefined }, actions };
}

/** What a score factor stands for: the score route's recipe, inline, or the gate of its source (a gene table). */
function scoreUpstream(source, dependant) {
    const src = scoreAdapter().get(source.key);
    if (!src) return gone("the score's signature or gene table is gone");
    const gate = src.gate(dependant);
    if (gate) return { gate: { ...gate.gate, state: gate.state, message: gate.message, table: source.key }, actions: src.actions };
    return { recipe: () => {
        const base = src.recipe();
        const scored = { ...base, method: source.column || base.method, input: source.layer || base.input };
        return { recipe: serverRecipe(scored), hash: recipeHash(scored) };
    } };
}

/** A column of the dataset that the open dataset lacks: a gate, so nothing is asked (GRP-14). */
function missingGate(source) {
    const structure = structureNow();
    if (!structure) return null;
    const lacking = missingFactors({ partitionings: [{ source }] }, structure, { hasGene, hasPanel: () => true });
    return lacking.length
        ? { gate: { state: 'refused', reason: 'not_in_dataset', message: `${sourceName(source)} is not in this dataset` } } : null;
}

/** The title of the panel behind a source, for labels (a table's, a score's, a grouping's); undefined for a column. */
export const sourceTitleOf = (source) => (PANEL_SOURCES.includes(source.type) && panelOf(source.key)
    ? titleOfPanel(source.key) : undefined);

/** The page's host hooks of utils/group-sources.js (its `GroupHost`), each filled once. */
function pageHost() {
    return {
        source(id) {
            // a cell table's cells (the Gene Plot's table-stat): a grouping of one table factor, its group `@in` the passing cells
            const table = tableOfCells(id);
            if (table) {
                const t = panelOf(table);
                if (typeOf(t) !== 'cell-table') return null;
                const methods = typeof t.getMethods === 'function' ? t.getMethods() : {};
                return { title: t.getTitle(), kind: 'table', shape: GROUPING, recipe: () => ({
                    version: 1, partitionings: [{ source: { type: TABLE_SOURCE, key: table } }],
                    ...(typeof methods.detect_above === 'number' && methods.detect_above > 0 ? { detect_above: methods.detect_above } : {}) }) };
            }
            // a panel's own cell axis (a Cell-Gene Plot on an obs column): the panel says what it is
            if (typeof id === 'string' && id.startsWith(AXIS_PREFIX)) {
                const owner = panelOf(id.slice(AXIS_PREFIX.length));
                return owner && typeof owner.axisSource === 'function' ? owner.axisSource() : null;
            }
            const p = panelOf(id);
            // a panel that is a source of groups in a shape of its own (a count plot's grid) describes itself
            if (p && typeof p.groupSource === 'function') return p.groupSource();
            if (typeOf(p) !== TYPE) return null;
            return { title: p.getTitle(), kind: 'grouping', recipe: () => p.getRecipe(), shape: GROUPING };
        },
        // per id: a panel's own cell axis is off when its owner's type is; a panel that is a source of groups itself
        // (a count plot, groupSource()) when its own type is; anything else (a grouping) when Cell Grouping is
        off: (id) => {
            if (tableOfCells(id)) return !Policy.panelEnabled('cell-table');
            if (typeof id === 'string' && id.startsWith(AXIS_PREFIX)) {
                const owner = panelOf(id.slice(AXIS_PREFIX.length));
                return !!owner && !Policy.panelEnabled(typeOf(owner));
            }
            const p = panelOf(id);
            if (p && typeof p.groupSource === 'function') return !Policy.panelEnabled(typeOf(p));
            return !Policy.panelEnabled(TYPE);
        },
        upstream(source, dependant) {
            switch (source.type) {
                case GROUP_SOURCE: return typeOf(panelOf(source.key)) === TYPE ? { grouping: source.key } : gone('the grouping it uses is gone');
                case TABLE_SOURCE: return tableUpstream(source.key, dependant);
                case SCORE_SOURCE: return scoreUpstream(source, dependant);
                default: return missingGate(source);
            }
        },
        cycleOf: cycleIds,
        titleOf: titleOfPanel,
        kindOf: kindOfPanel,
        sourceTitle: sourceTitleOf,
        onUpstreamChange(fn) {
            if (typeof document === 'undefined') return;
            document.addEventListener('annzarro:table-filtered', (e) => { if (e.detail && e.detail.id) fn(e.detail.id); });
        }
    };
}

function pageContext() {
    const cells = DataManager.getCells();
    return { dataset: DataManager.getCurrentDataset() || '', subset: DataManager.getSubsetParam(),
        cells: cells && Number.isFinite(Number(cells.length)) ? Number(cells.length) : null };
}

/**
 * One group store and the group sources over it, with the memory guard's ledger for the codes.
 * @param {Object} deps
 * @param {import('./derived-store.js').DerivedApi} deps.api - utils/cell-groups-client.js createGroupsApi
 * @param {Object} [deps.limiter] - the page's limit on computations at once
 * @param {Object} deps.ledger - memory-guard.js Ledger: hold, pin, release
 * @param {import('./group-sources.js').GroupHost} deps.host
 * @param {() => {dataset: string, subset: (string|null), cells?: (number|null)}} deps.context
 * @param {Object} [deps.timers] - setTimer and clearTimer, for a test
 * @returns {{store: ReturnType<typeof createGroupStore>, sources: ReturnType<typeof createGroupSources>}}
 */
function createGroupBinding({ api, limiter = null, ledger: codes, host, context, timers = {} }) {
    const store = createGroupStore({ api, limiter, codes });
    // the moments of every gene over one group (the Gene Plot's group-stat): a derived store of its own, over the same api
    const genesStore = createDerivedStore({ api: createGenesApi(api), limiter, refusalReason: 'groups_too_expensive',
        isEmpty: (out) => !(out.values && out.values.moments),
        refusedOf: (out) => (out.header && out.header.refused ? { reason: out.header.refused.reason, message: out.header.refused.message || null } : null) });
    return { store, genesStore, sources: createGroupSources({ store, host, context, genesStore, ...timers }) };
}

let _binding = null;

/**
 * The page's group store and group sources, made when first needed.
 * @returns {{store: ReturnType<typeof createGroupStore>, sources: ReturnType<typeof createGroupSources>}}
 */
export function groupSources() {
    if (!_binding) {
        _binding = createGroupBinding({ api: createGroupsApi({ url: Config.API.CELL_GROUPS }), limiter: pageLimiter(), ledger,
            host: pageHost(), context: pageContext });
    }
    return _binding;
}
