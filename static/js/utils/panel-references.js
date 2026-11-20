/**
 * What a panel's configuration refers to: the ids of other panels it names, and where.
 *
 * Every panel type declares its references ONCE (registerReferences), and that one declaration serves
 * everything that asks which panels a configuration names:
 *
 *   remapReferences   ids changed (a panel set added beside open panels): every reference follows
 *   dependsOn         the panels a panel is computed from: the edges of the dependency graph
 *                     (the table resolver finds a cycle in it, whatever kinds of panel are on it)
 *   usersOf           the panels that use a panel ("in use", "used by")
 *   keptInUse         the closed panels in use, which Clear closed panels keeps
 *
 * A reference is `{ id, via, get, set, remembered? }`:
 *   id          the id it names now (`get()` when it was declared)
 *   via         how it is named, one of VIAS below
 *   get, set    read and write it in the configuration. A reference is used right after it was asked
 *               for: `set` may rewrite what belongs to it (a table column's filter conditions), as
 *               they were when it was declared, so ids that swap places land each in its own place.
 *   remembered  true for a setting the panel keeps only to restore it (an axis's earlier source): it
 *               follows a remap, but it is no use and no edge
 *
 * The graph is mixed: a table, a signature, a grouping or a plot is a node alike, so a cycle through a
 * panel that is not a table is found as one through tables is. An edge is every reference the panel is
 * computed from: every one except `source`, a column the panel only shows (no filter condition reads it,
 * so nothing downstream of the panel depends on it), and except a remembered one. A reference to a panel
 * that does not exist is no edge.
 *
 * The page's panels are reached only through a host (setReferenceHost), so Node tests cover the graph
 * with fakes. The declarations of the six panel types that exist before 0.8.0 are at the end of this
 * module; a new panel type declares its own in its panel module.
 */
import { getColumnKey } from './column-key.js';
import { isScoreColumn } from './score-column.js';

/**
 * How a configuration names another panel:
 *   filter        its rows are filtered by it (`tableFilter`, a filter condition on its score column)
 *   source        a column it shows and does not filter on: a use, no edge
 *   partitioning  a factor's or a count plot input's source
 *   set           the source of a set
 *   section       a Cell-Gene Plot section's genes
 *   axis          a plot's axis, colour or hover entry; a Cell-Gene Plot's cell axis
 *   measure       a count plot's measure
 */
const VIAS = new Set(['filter', 'source', 'partitioning', 'set', 'section', 'axis', 'measure']);

/** panel type -> (config) => references */
const declarations = new Map();
/** Source types whose `key` is a panel's id, registered by their providers (later a grouping's groups). */
const panelSourceTypes = new Set();
/** A signature's or gene table's score is one already: score-column.js names its type. */
const isPanelSourceType = (type) => panelSourceTypes.has(type) || isScoreColumn({ type });

let host = { panel: () => null, ids: () => [] };

/**
 * Declare the references of a panel type. Once per type: a second declaration is a mistake.
 * @param {string} panelType
 * @param {(config: Object) => Array<{id: string, via: string, get: Function, set: Function, remembered?: boolean}>} declare
 *   reads only the fields that hold references (a table's configuration has lazy views of its rows)
 *   and must not throw on a configuration from a hand-edited link
 */
export function registerReferences(panelType, declare) {  // export-unused-ok: G9a, X3a, C2a: declare their panel types' references
    if (typeof declare !== 'function') throw new Error(`The references of '${panelType}' must be a function`);
    if (declarations.has(panelType)) throw new Error(`The references of '${panelType}' are declared already`);
    declarations.set(panelType, declare);
}

/**
 * Declare a source type whose `key` holds a panel's id. A plot's axes, colour and hover entries and a
 * table's columns of that type then follow their panel, with no other change.
 * @param {string} type
 */
export function registerPanelSourceType(type) {  // export-unused-ok: G8a: registers cell-group, so its keys follow (CAT-9)
    panelSourceTypes.add(type);
}

/**
 * The references of a configuration.
 * @param {Object} config
 * @param {string} [panelType] - its type. Without one, or with one that declares nothing, every
 *   declaration is asked: a link may not say a configuration's type, and each declaration reads
 *   only its own fields
 * @returns {Array<{id: string, via: string, get: Function, set: Function, remembered?: boolean}>}
 */
function referencesOf(config, panelType) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
    const own = declarations.get(panelType);
    const asked = own ? [own] : [...declarations.values()];
    const out = [];
    for (const declare of asked) {
        for (const ref of declare(config) || []) {
            if (!VIAS.has(ref.via)) throw new Error(`Unknown reference kind '${ref.via}' (one of ${[...VIAS].join(', ')})`);
            if (typeof ref.id === 'string' && ref.id) out.push(ref);
        }
    }
    return out;
}

/**
 * Rewrite the references between panels after ids changed.
 * @param {Object[]} configs - rewritten in place
 * @param {Map<string,string>|Object} idMap - old id -> new id
 * @returns {Object[]} the same configs
 */
export function remapReferences(configs, idMap) {
    const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
    if (!map.size) return configs;
    for (const config of configs || []) {
        // every reference is read before any is written, so ids that swap places do not chase each other
        const moves = referencesOf(config).map(ref => [ref, ref.get()]).filter(([, id]) => map.has(id));
        for (const [ref, id] of moves) ref.set(map.get(id));
    }
    return configs;
}

/**
 * Where the graph finds the page's panels.
 * @param {{panel: (id: string) => ({type: string, config: Object}|null), ids: () => string[]}} pageHost
 */
export function setReferenceHost(pageHost) {
    host = pageHost;
}

/** A panel's references, from the host. */
function referencesOfPanel(id) {
    const panel = host.panel(id);
    return panel ? referencesOf(panel.config, panel.type) : [];
}

/**
 * The panels `id` is computed from, each once, in the order its configuration names them.
 * @param {string} id
 * @returns {string[]}
 */
export function dependsOn(id) {
    const out = [];
    for (const ref of referencesOfPanel(id)) {
        if (ref.via === 'source' || ref.remembered || out.includes(ref.id) || !host.panel(ref.id)) continue;
        out.push(ref.id);
    }
    return out;
}

/**
 * The panels that use `id`: each once, in the host's order, never `id` itself. A remembered setting is
 * no use.
 * @param {string} id
 * @returns {Array<{panelId: string, kind: string}>} kind is the user's panel type
 */
export function usersOf(id) {  // export-unused-ok: G9a: a grouping deleted from the chooser with a count of its users (GRP-13)
    const out = [];
    for (const other of host.ids()) {
        if (other === id) continue;
        const panel = host.panel(other);
        if (!panel) continue;
        if (referencesOf(panel.config, panel.type).some(ref => ref.id === id && !ref.remembered)) {
            out.push({ panelId: other, kind: panel.type });
        }
    }
    return out;
}

/**
 * The closed panels that Clear closed panels keeps: those that an open panel uses, and those that a kept
 * panel uses, and so on. Closed panels that only use each other are not kept.
 * @param {Iterable<string>} closedIds - the closed panels
 * @returns {Set<string>} the ones in use
 */
export function keptInUse(closedIds) {
    const closed = new Set(closedIds);
    const kept = new Set();
    const users = new Map([...closed].map(id => [id, usersOf(id)]));
    let grew = true;
    while (grew) {
        grew = false;
        for (const [id, list] of users) {
            if (kept.has(id) || !list.some(u => !closed.has(u.panelId) || kept.has(u.panelId))) continue;
            kept.add(id);
            grew = true;
        }
    }
    return kept;
}

// ---------------------------------------------------------------- the panel types before 0.8.0

const isObject = (x) => !!x && typeof x === 'object';
const isPanelSource = (s) => isObject(s) && isPanelSourceType(s.type) && typeof s.key === 'string';

/** The key of a source setting as a reference. */
function sourceRef(source, via, remembered = false) {
    return { id: source.key, via, get: () => source.key, set: (v) => { source.key = v; }, ...(remembered ? { remembered } : {}) };
}

/** `tableFilter`: the table (or signature) whose rows filter the panel's. 'none' names nothing. */
function tableFilterRefs(config) {
    const id = config.tableFilter;
    if (typeof id !== 'string' || !id || id === 'none') return [];
    return [{ id, via: 'filter', get: () => config.tableFilter, set: (v) => { config.tableFilter = v; } }];
}

const AXES = ['x', 'y', 'z', 'color'];

/** A plot: its table filter, the sources of its axes, colour and hover, and what each axis remembers. */
function plotReferences(config) {
    const out = tableFilterRefs(config);
    for (const axis of AXES) if (isPanelSource(config[axis])) out.push(sourceRef(config[axis], 'axis'));
    if (Array.isArray(config.hoverInfo)) for (const h of config.hoverInfo) if (isPanelSource(h)) out.push(sourceRef(h, 'axis'));
    for (const axis of AXES) {
        const history = isObject(config[axis]) && isObject(config[axis].history) ? config[axis].history : null;
        if (!history) continue;
        for (const [type, was] of Object.entries(history)) {
            if (isPanelSourceType(type) && isObject(was) && typeof was.key === 'string') out.push(sourceRef(was, 'axis', true));
        }
    }
    return out;
}

/** The leaves of a filter: the conditions, each naming its column by data key (`origData`). */
function conditionsOf(searchBuilderConfig) {
    const out = [];
    const walk = (node) => {
        if (!isObject(node)) return;
        if (Array.isArray(node.criteria)) node.criteria.forEach(walk);
        else if (typeof node.origData === 'string') out.push(node);
    };
    walk(searchBuilderConfig);
    return out;
}

/**
 * A table: its table filter, and each column whose source is a panel. A column its filter has a condition
 * on is a filter; one it only shows is a source. A column's data key holds the panel's id, so the
 * conditions that name it follow it.
 */
function tableReferences(config) {
    const out = tableFilterRefs(config);
    if (!Array.isArray(config.columns)) return out;
    const conditions = conditionsOf(config.searchBuilderConfig);
    for (const column of config.columns.filter(isPanelSource)) {
        const key = getColumnKey(column);
        const naming = conditions.filter(node => node.origData === key);
        out.push({
            id: column.key, via: naming.length ? 'filter' : 'source',
            get: () => column.key,
            set: (v) => {
                column.key = v;
                const now = getColumnKey(column);
                for (const node of naming) node.origData = now;
            }
        });
    }
    return out;
}

registerReferences('cell-plot', plotReferences);
registerReferences('gene-plot', plotReferences);
registerReferences('cell-table', tableReferences);
registerReferences('gene-table', tableReferences);
// Gene Set Analysis reads the genes of the table or signature it names
registerReferences('gene-set', tableFilterRefs);
// a signature's genes are handpicked: it names no panel
registerReferences('gene-signature', () => []);
