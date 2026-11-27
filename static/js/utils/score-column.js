/**
 * A gene-signature score as a column of a Cell Table (design 3.3, 7.4, 8.7; UX review 3.4).
 * Pure: no DOM and no page state, so Node tests hold every state and sentence. The page's side
 * is panels/table-utilities/table-scores.js (the handles) and table-score-ui.js (the table).
 *
 * A column is `{type: gene-score, key: <signature panel id>, column: <aggregation>, label}`,
 * the same three-level form every consumer of the source stores (utils/source-registry.js). A
 * link or a panel set keeps this reference and nothing else: never a value.
 *
 * The words below are the score's, and so are the states: a column of any other provider with a table half
 * (utils/table-source.js) is stated by the same view and gate, from a snapshot with the same states, and sorted,
 * filtered and exported alike. What differs per provider (its handle, title and notice) is the provider's.
 *
 * What a column says of itself is read from a handle's snapshot (utils/score-sources.js):
 *
 *   state of the score          column                      cells          sort    filter   export
 *   ready                       Title                       values         on      on       on
 *   updating (previous values)  Title (updating)            previous       on      on       off
 *   estimating/queued/computing Title (computing)           computing...   off     holds    off
 *   awaiting (asks one click)   Title (not computed)        not computed   off     holds    off
 *   cancelled/refused/failed/
 *   noscore/nogenes/off         Title (no score)            no score       off     holds    off
 *   deleted                     Title (deleted)             no score       off     holds    off
 *
 * "Holds" is the table's own state, not a column setting: a filter with a condition on a column
 * that is not ready holds the table's rows (nothing is shown, nothing is reported as passing),
 * and the table reports not ready down the chain (`filterGate`).
 */
import { describeScore } from './score-notices.js';
import { referencedKeys } from './line-select.js';
import { DEFAULT_METHOD } from './gene-signature.js';
import { tableHalfOf } from './table-source.js';
import { getSource } from './source-registry.js';

const SCORE_TYPE = 'gene-score';

/**
 * Whether a table column is one of a source (a gene-signature score, or any provider with a table half: the type
 * is found in the registry, so a provider this page has not loaded is not).
 */
export function isScoreColumn(column) {
    return !!column && (column.type === SCORE_TYPE || !!tableHalfOf(column));
}

/**
 * The series a snapshot holds, in either form (utils/table-source.js), or null before it has one.
 * @param {Object|null} snap
 * @returns {null|{kind: 'numerical'|'categorical', length: number, held: Object}} `held` is the array itself
 */
export function seriesOf(snap) {
    if (snap && snap.values) return { kind: 'numerical', length: snap.values.length, held: snap.values };
    if (snap && snap.codes && snap.categories) return { kind: 'categorical', length: snap.codes.length, held: snap.codes };
    return null;
}

/** The score columns of a table's column list, in order. */
export function scoreColumnsOf(columns) {
    return Array.isArray(columns) ? columns.filter(isScoreColumn) : [];
}

/** The aggregation of a column: its sub-key, or the provider's default. */
export function subOf(column) {
    if (column && column.column) return String(column.column);
    const provider = column && column.type !== SCORE_TYPE ? getSource(column.type) : null;
    return provider ? provider.defaultSub : DEFAULT_METHOD;
}

/** Whether two columns are the same score: one signature, one aggregation. */
export function sameScoreColumn(a, b) {
    const half = isScoreColumn(a) ? tableHalfOf(a) : null;
    if (half && half.chooser.identity) return isScoreColumn(b) && b.type === a.type && half.chooser.identity(a) === half.chooser.identity(b);
    return isScoreColumn(a) && isScoreColumn(b) && a.key === b.key && subOf(a) === subOf(b) && (a.layer || '') === (b.layer || '');
}

/**
 * The score columns a filter has a condition on. The search box's text is not counted: it spans
 * every column of the rows that are shown, and a score that is not ready simply adds no text.
 * @param {Object[]} columns - the table's columns
 * @param {{criteria?: Array}|null|undefined} searchBuilderConfig
 * @param {(column: Object) => string} keyOf - a column's data key (utils/column-key.js)
 * @returns {Object[]}
 */
export function usedScoreColumns(columns, searchBuilderConfig, keyOf) {
    const scores = scoreColumnsOf(columns);
    if (!scores.length) return [];
    const used = referencedKeys(searchBuilderConfig);
    if (!used.size) return [];
    return scores.filter(column => used.has(keyOf(column)));
}

/**
 * The sentence for a derived column a filter reads that has no values yet, naming what it is: "the score 'T cell score' is
 * not ready", "the group statistic 'B cell: mean · logged' is not ready" (the column's provider's own word, `snap.words.the`),
 * never "the score" for a statistic of a grouping.
 * @param {{label?: string, key?: string}} column
 * @param {{words?: {the?: string}}|null} [snap] - the column's last snapshot, when it has one
 */
export function notReadyText(column, snap = null) {
    const the = snap && snap.words && snap.words.the ? snap.words.the : SCORE_WORDS.the;
    return `${the} '${(column && (column.label || column.key)) || ''}' is not ready`;
}

/** The words of a score that is not ready, in a column header and in its cells. */
const PENDING = new Set(['estimating', 'queued', 'computing', 'idle', 'building']);

/**
 * What a column calls its values while it has none: a score's, unless the snapshot carries its provider's own
 * (`snap.words`, utils/table-source.js): `the` (the values, when the column has no title), `none` (it has none) and
 * `ready` (the sentence's end when they are there).
 */
const SCORE_WORDS = Object.freeze({ the: 'the score', none: 'no score', ready: 'the score is ready' });
const wordsOf = (snap) => (snap && snap.words) || SCORE_WORDS;

/**
 * How a column looks and what it allows, from the state of its score.
 * @param {Object|null} snap - a handle's read(); null before it has been read
 * @param {string} [title] - the column's name
 * @returns {{kind: 'ready'|'updating'|'pending'|'none', state: string, suffix: string (the header's state, in brackets), cell: string,
 *   hasValues: boolean, sortable: boolean, filterable: boolean, exportable: boolean, exportNote: string}}
 */
export function columnView(snap, title = '') {
    const state = snap && snap.state ? snap.state : 'estimating';
    const w = wordsOf(snap);
    const t = title ? `'${title}'` : w.the;
    const view = (kind, suffix, cell, o) => ({ kind, state, suffix, cell, hasValues: false, sortable: false,
        filterable: false, exportable: false, exportNote: '', ...o });
    const hasSeries = !!seriesOf(snap);
    if (state === 'ready' && hasSeries) {
        return view('ready', '', '', { hasValues: true, sortable: true, filterable: true, exportable: true });
    }
    if (state === 'updating' && hasSeries) {
        return view('updating', '(updating)', '', { hasValues: true, sortable: true, filterable: true,
            exportNote: `Available when ${t} is updated` });
    }
    if (PENDING.has(state)) {
        return view('pending', '(computing)', 'computing…', { exportNote: `Available when ${t} is ready` });
    }
    if (state === 'ask') {
        return view('pending', '(not built)', 'not built', { exportNote: `Available when ${t} is built` });
    }
    if (state === 'awaiting') {
        return view('pending', '(not computed)', 'not computed', { exportNote: `Available when ${t} is computed` });
    }
    if (state === 'deleted') {
        return view('none', '(deleted)', w.none, { exportNote: `${t} was deleted: remove the column to export` });
    }
    return view('none', `(${w.none})`, w.none, { exportNote: `${t} has ${w.none}: remove the column to export` });
}

/**
 * The notice over a table for one score column: the plot's own wording and actions
 * (utils/score-notices.js), except that there is no other signature to choose in a table, so
 * "Choose another" gives way to "Remove column" in every state with no score.
 * @param {Object} snap - a handle's read()
 * @param {{sharers?: number}} [opts]
 * @returns {null|Object} a describeScore notice
 */
export function describeColumn(snap, { sharers = 1 } = {}) {
    const notice = describeScore(snap, { role: 'column', sharers });
    if (!notice) return null;
    const actions = notice.actions.filter(([action]) => action !== 'score-choose');
    if (['deleted', 'off', 'failed', 'refused', 'cancelled', 'noscore', 'nogenes'].includes(notice.state)) {
        actions.push(['score-remove', 'Remove column']);
    }
    return { ...notice, actions };
}

/**
 * What stands between a table's filter and its rows: the worst state among the score columns
 * the filter has a condition on. Null when every one of them can be read (ready or updating).
 * The status has the shape of a resolver status (utils/table-resolver.js) with reason 'score',
 * so a plot, a Gene Set Analysis panel and the resolver pass it down unchanged.
 * @param {Array<{title: string, view: Object, snap: Object, describe?: (snap: Object) => Object|null}>} items - `describe`
 *   is the provider's notice for the column (the score's own words when it has none)
 * @returns {null|{state: 'waiting'|'failed'|'refused', reason: 'score', title: string, scoreState: string,
 *   detail: string, columns: number}}
 */
export function filterGate(items) {
    let worst = null;
    let rank = -1;
    const order = { updating: -1, ready: -1, pending: 1, none: 2 };
    for (const item of items || []) {
        const r = order[item.view.kind] === undefined ? 2 : order[item.view.kind];
        if (r > rank) {
            rank = r;
            worst = item;
        }
    }
    if (!worst || rank < 1) return null;
    const { view, snap, title } = worst;
    const notice = worst.describe ? worst.describe({ ...(snap || {}), title }) : describeScore({ ...(snap || {}), title }, { role: 'column' });
    const detail = notice ? `${notice.headline}${notice.text ? ` ${notice.text}` : ''}` : '';
    const words = wordsOf(snap);
    if (view.kind === 'pending') {
        return { state: 'waiting', reason: 'score', title, scoreState: view.state, detail, columns: items.length, words };
    }
    const refused = view.state === 'refused';
    return { state: refused ? 'refused' : 'failed', reason: 'score', title, scoreState: view.state, detail, columns: items.length, words };
}

/**
 * The words of a table whose rows are held because its filter reads a score that is not ready.
 * @param {{state: string, title: string, scoreState: string, detail: string}} gate - from filterGate
 * @returns {{headline: string, text: string}}
 */
export function describeHeldRows(gate) {
    const t = `'${gate.title}'`;
    const w = gate.words || SCORE_WORDS;
    if (gate.state === 'waiting') {
        return { headline: `Filter on ${t} not applied yet.`,
            text: gate.scoreState === 'awaiting' ? `Rows appear when ${t} is computed.` : `Rows appear when ${w.ready}.` };
    }
    return { headline: `Filter on ${t} not applied.`, text: gate.detail || `${t} has ${w.none}.` };
}

/**
 * Follow a signature to a new id in a table's configuration (a panel set added beside open
 * panels): the columns' `key`, and the conditions of the filter, which name a column by its
 * data key (`origData`), a string that holds the signature's id.
 * @param {{columns?: Object[], searchBuilderConfig?: Object}} config - rewritten in place
 * @param {Map<string,string>} idMap - old id -> new id
 * @param {(column: Object) => string} keyOf - a column's data key
 * @returns {boolean} whether anything changed
 */
export function followSignatureIds(config, idMap, keyOf) {
    if (!config || !Array.isArray(config.columns)) return false;
    const renames = new Map();
    for (const column of config.columns) {
        if (isScoreColumn(column) && typeof column.key === 'string' && idMap.has(column.key)) {
            const before = keyOf(column);
            column.key = idMap.get(column.key);
            renames.set(before, keyOf(column));
        }
    }
    if (!renames.size) return false;
    renameFilterKeys(config.searchBuilderConfig, renames);
    return true;
}

/**
 * A filter without its conditions on one column: the others stay as they were, and a group left with no condition goes.
 * @param {{criteria?: Array, logic?: string}|null|undefined} searchBuilderConfig - not changed
 * @param {string} key - the column's data key (`origData`)
 * @returns {{criteria: Array, logic: string}}
 */
export function dropConditions(searchBuilderConfig, key) {
    const keep = (node) => {
        if (!node || typeof node !== 'object') return null;
        if (!Array.isArray(node.criteria)) return node.origData === key ? null : node;
        const criteria = node.criteria.map(keep).filter(Boolean);
        return criteria.length ? { ...node, criteria } : null;
    };
    const top = keep(searchBuilderConfig);
    return top ? { ...top, logic: top.logic === 'OR' ? 'OR' : 'AND' } : { criteria: [], logic: 'AND' };
}

/**
 * Rename the columns a filter's conditions name. A condition names its column by data key (`origData`), which for a
 * score column holds the source's id and the layer, so it follows when either is rewritten.
 * @param {{criteria?: Array}|null|undefined} searchBuilderConfig - rewritten in place
 * @param {Map<string, string>} renames - old data key -> new data key
 */
function renameFilterKeys(searchBuilderConfig, renames) {
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.criteria)) node.criteria.forEach(walk);
        else if (typeof node.origData === 'string' && renames.has(node.origData)) node.origData = renames.get(node.origData);
    };
    walk(searchBuilderConfig);
}


/**
 * Write the layer explicitly into every gene score entry that has none: an axis, the colour or a hover
 * entry of a plot, and a score column of a table. The signature's `input` is only the layer an entry
 * without one resolves to (a link made before layers were stored), so such an entry is resolved ONCE, to
 * the input as it is at that moment, and keeps it. A column's data key names its layer, so the column is renamed and every condition of the filter
 * that names the old key follows, in the same step.
 * @param {Object} config - a panel's settings or config: rewritten in place
 * @param {(signatureId: string) => (string|null|undefined)} inputOf - a signature's input now, or nothing if unknown
 * @param {(column: Object) => string} keyOf - a table column's data key
 * @returns {boolean} whether anything changed
 */
export function pinScoreLayers(config, inputOf, keyOf) {
    if (!config || typeof config !== 'object') return false;
    let changed = false;
    const pin = (source) => {
        if (!source || source.type !== SCORE_TYPE || typeof source.key !== 'string' || source.layer) return null;
        const input = inputOf(source.key);
        if (!input) return null;
        source.layer = input;
        changed = true;
        return source;
    };
    for (const axis of ['x', 'y', 'z', 'color']) pin(config[axis]);
    if (Array.isArray(config.hoverInfo)) config.hoverInfo.forEach(pin);
    if (Array.isArray(config.columns)) {
        const renames = new Map();
        for (const column of config.columns) {
            if (!isScoreColumn(column) || column.layer) continue;
            const before = keyOf(column);
            if (pin(column)) renames.set(before, keyOf(column));
        }
        if (renames.size) renameFilterKeys(config.searchBuilderConfig, renames);
    }
    return changed;
}
