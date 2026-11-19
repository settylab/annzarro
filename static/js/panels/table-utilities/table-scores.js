/**
 * The scores a Cell Table shows as columns: one handle per (table, score column), shared by the
 * open table (which draws them and fills them in place, table-score-ui.js) and by the table
 * resolver (which needs the scores a CLOSED table's filter reads before it can build that
 * filter, table-background.js). The values live in the score store (utils/score-store.js) as a
 * Float32Array; this module holds a reference to it, never a copy.
 *
 * What a table's render functions read is a `reader`: `{vec, view, render(type, row)}`. DataTables
 * keeps a row as an object with one property per column, which is what makes a 1M-row table
 * heavy; a score column does not add a property to a million rows. Its column has no value in
 * the row object at all, and its render function reads `vec[row]` (the row index DataTables
 * hands every render function), so the table holds exactly one Float32Array per score and the
 * per-row cost is DataTables' own caches for the column when it is sorted or filtered.
 */
import { scores, scoreLabel } from '../../utils/score-source.js';
import { DataManager } from '../../data-manager.js';
import { getColumnKey } from '../../utils/column-key.js';
import { isScoreColumn, subOf, columnView, usedScoreColumns, filterGate } from '../../utils/score-column.js';

/** tableId -> Map(columnKey -> entry) */
const TABLES = new Map();
/** tableId -> fn(entry, changed): the open table's way to fill a column in place */
const SINKS = new Map();
/** fn(tableId, entry, changed): the resolver's way to hear of a score changing */
const LISTENERS = new Set();

/** Whether a table's tile is in view: a score is computed for a table nobody can see only when nothing else is waiting. */
export function tileOnScreen(id) {
    if (typeof document === 'undefined') return false;
    const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(id)}"]`);
    if (!tile) return false;
    const r = tile.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
        && r.top < window.innerHeight && r.left < window.innerWidth;
}

/** The text of a number in a cell, as the other numeric columns show it. */
function displayNumber(v) {
    return v.toFixed(4).replace(/\.?0+$/, '');
}

/** How many cells the rows of a cell table are for now. */
function rowsShown() {
    const cells = DataManager.getCells();
    return cells ? Number(cells.length) || 0 : 0;
}

function makeReader() {
    const reader = {
        vec: null,
        view: columnView(null),
        /**
         * One cell. DataTables asks for it by type: 'display' (HTML), 'sort' (a number), and
         * 'filter', 'export' and the rest (the value at the precision a float32 has).
         * @param {string} type
         * @param {number} i - the row, as DataTables numbers it (the position in the rows it was given)
         */
        render(type, i) {
            const vec = reader.vec;
            if (!vec || !(i < vec.length)) {
                return type === 'display' ? `<span class="text-muted az-score-wait">${reader.view.cell || ''}</span>` : '';
            }
            const v = vec[i];
            if (v !== v) return type === 'display' ? '<span class="text-muted">N/A</span>' : '';
            if (type === 'display') return displayNumber(v);
            if (type === 'sort') return v;
            return Number(v.toPrecision(7));
        }
    };
    return reader;
}

function update(entry, snap, silent = false) {
    const previous = entry.reader.vec;
    entry.snap = snap;
    entry.title = scoreLabel(entry.column);
    // values for other cells than the rows shown (a subset changed under them) are not values of these rows
    const values = snap && snap.values && snap.values.length === rowsShown() ? snap.values : null;
    entry.reader.vec = values;
    entry.reader.view = columnView(values || !snap || !snap.values ? snap : { ...snap, state: 'estimating', values: null }, entry.title);
    const sig = [snap && snap.state, entry.reader.vec ? 1 : 0, snap && snap.held ? snap.held.edits : '', entry.title].join('|');
    const changed = sig !== entry.sig || previous !== entry.reader.vec;
    entry.sig = sig;
    if (silent) return;
    const sink = SINKS.get(entry.tableId);
    if (sink) {
        try { sink(entry, changed); } catch (error) { console.error('Table score sink:', error); }
    }
    for (const fn of [...LISTENERS]) {
        try { fn(entry.tableId, entry, changed); } catch (error) { console.error('Table score listener:', error); }
    }
}

function tableMap(tableId) {
    let map = TABLES.get(tableId);
    if (!map) {
        map = new Map();
        TABLES.set(tableId, map);
    }
    return map;
}

/**
 * The entry for one score column of a table, made (and its score asked for) when it is not
 * there yet.
 * @param {string} tableId
 * @param {Object} column - `{type: 'gene-score', key, column, label}`
 */
function ensure(tableId, column, visible = null) {
    const key = getColumnKey(column);
    const map = tableMap(tableId);
    let entry = map.get(key);
    if (entry && (entry.column.key !== column.key || subOf(entry.column) !== subOf(column))) {
        release(tableId, key);
        entry = null;
    }
    if (!entry) {
        entry = { tableId, key, column, sub: subOf(column), handle: null, snap: null, title: '', sig: '',
            reader: makeReader(), visible: visible || (() => tileOnScreen(tableId)) };
        entry.handle = scores().sources.watch(column.key, {
            sub: entry.sub, host: tableId, role: 'column', visible: () => entry.visible(),
            onChange: (snap) => update(entry, snap)
        });
        map.set(key, entry);
        update(entry, entry.handle.read(), true);
    } else {
        entry.column = column;
        if (visible && entry.visible !== visible) {
            entry.visible = visible;
            scores().sources.visibilityChanged();
        }
        // the cells may have changed since the table last built its rows: read where the score stands now
        update(entry, entry.handle.read(), true);
    }
    return entry;
}

function release(tableId, key) {
    const map = TABLES.get(tableId);
    const entry = map && map.get(key);
    if (!entry) return;
    entry.handle.release();
    map.delete(key);
    if (!map.size) TABLES.delete(tableId);
}

export const TableScores = {
    /** The reader a table's score column renders from (made, and the score asked for, when needed). */
    readerOf(tableId, column) {
        return ensure(tableId, column).reader;
    },

    entry(tableId, column) {
        const map = TABLES.get(tableId);
        return (map && map.get(getColumnKey(column))) || null;
    },

    /** The entries of a table, in no particular order. */
    entries(tableId) {
        const map = TABLES.get(tableId);
        return map ? [...map.values()] : [];
    },

    /** Keep only the entries for these columns; the others stop wanting their scores. */
    prune(tableId, columns) {
        const keep = new Set((columns || []).filter(isScoreColumn).map(getColumnKey));
        const map = TABLES.get(tableId);
        if (!map) return;
        for (const key of [...map.keys()]) if (!keep.has(key)) release(tableId, key);
    },

    /** The table is gone (or closed and frozen): none of its scores is wanted. */
    release(tableId) {
        const map = TABLES.get(tableId);
        if (!map) return;
        for (const key of [...map.keys()]) release(tableId, key);
        SINKS.delete(tableId);
    },

    /**
     * Who needs the scores to be computed: a closed table's dependants, by what they can see.
     * @param {string} tableId
     * @param {() => boolean} visible
     */
    setVisible(tableId, visible) {
        for (const entry of this.entries(tableId)) entry.visible = visible;
    },

    /** The open table fills its columns in place through this. */
    setSink(tableId, fn) {
        if (fn) SINKS.set(tableId, fn); else SINKS.delete(tableId);
    },
    hasSink(tableId) { return SINKS.has(tableId); },
    clearSink(tableId, fn) {
        if (SINKS.get(tableId) === fn) SINKS.delete(tableId);
    },

    /** `fn(tableId, entry, changed)` on every change of any table's score. Returns the way to stop. */
    on(fn) {
        LISTENERS.add(fn);
        return () => LISTENERS.delete(fn);
    },

    /**
     * What stands between a table's filter and its rows, or null: the worst state of the score
     * columns the filter has a condition on (utils/score-column.js filterGate).
     * @param {string} tableId
     * @param {{columns?: Object[], searchBuilderConfig?: Object}} config
     * @param {{visible?: () => boolean}} [opts] - for a closed table: who needs the scores
     */
    gateOf(tableId, config, { visible = null } = {}) {
        if (!config) return null;
        const used = usedScoreColumns(config.columns, config.searchBuilderConfig, getColumnKey);
        if (!used.length) return null;
        const items = used.map((column) => {
            const entry = ensure(tableId, column, visible);
            return { title: entry.title, view: entry.reader.view, snap: entry.snap };
        });
        return filterGate(items);
    },

    /** The commands of the notices, for every score column of a table. */
    compute(tableId) { return this.entries(tableId).some(e => e.handle.compute()); },
    retry(tableId) { return this.entries(tableId).some(e => e.handle.retry()); },
    cancel(tableId) { return this.entries(tableId).some(e => e.handle.cancel()); },
    update(tableId) {
        let any = false;
        for (const entry of this.entries(tableId)) any = scores().sources.update(entry.column.key) || any;
        return any;
    },

    /** The handle count, for tests. */
    get tables() { return TABLES.size; }
};
