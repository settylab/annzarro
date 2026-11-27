/**
 * The sources a Cell Table shows as columns (a gene score, or any provider with a table half,
 * utils/table-source.js): one handle per (table, column), shared by the open table (which draws them
 * and fills them in place, table-score-ui.js) and by the table resolver (which needs the scores a
 * CLOSED table's filter reads before it can build that filter, table-background.js). A score's values
 * live in the score store (utils/score-store.js) as a Float32Array; this module holds a reference to
 * the series, never a copy.
 *
 * What a table's render functions read is a `reader`: `{vec, view, render(type, row)}`. DataTables
 * keeps a row as an object with one property per column, which is what makes a 1M-row table
 * heavy; a score column does not add a property to a million rows. Its column has no value in
 * the row object at all, and its render function reads `vec[row]` (the row index DataTables
 * hands every render function), so the table holds exactly one Float32Array per score and the
 * per-row cost is DataTables' own caches for the column when it is sorted or filtered.
 */
import { DataManager } from '../../data-manager.js';
import { getColumnKey } from '../../utils/column-key.js';
import { tableHalfOf, rowsOf } from '../../utils/table-source.js';
import { isScoreColumn, sameScoreColumn, subOf, columnView, describeColumn, usedScoreColumns, filterGate, seriesOf } from '../../utils/score-column.js';

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

/** tableId -> {observer, tile, tries, timer}: what tells the scores of a table that its tile came on screen. */
const WATCHED = new Map();

/**
 * A score a table shows is computed only for a table on screen (`visible`), which is asked when the job is pumped:
 * nothing started it when the table later came into view (scrolled to, a panel above it closed, the tile resized),
 * so its column said "Computing" for good. One observer per table tile pokes the scores' stores when it comes or goes.
 */
function watchTile(tableId) {
    if (WATCHED.has(tableId) || typeof IntersectionObserver === 'undefined') return;
    const watch = { observer: null, tile: null, tries: 0, timer: null };
    WATCHED.set(tableId, watch);
    const attach = () => {
        watch.timer = null;
        if (WATCHED.get(tableId) !== watch) return;
        const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(tableId)}"]`);
        if (!tile) {
            // the tile is not built yet (the panel is still being made): look again a few times
            if (++watch.tries < 40) watch.timer = setTimeout(attach, 250);
            return;
        }
        watch.tile = tile;
        watch.observer = new IntersectionObserver(() => {
            const map = TABLES.get(tableId);
            if (!map) return;
            for (const entry of map.values()) {
                const half = tableHalfOf(entry.column);
                if (half.visibilityChanged) half.visibilityChanged();
            }
        });
        watch.observer.observe(tile);
    };
    attach();
}

function unwatchTile(tableId) {
    const watch = WATCHED.get(tableId);
    if (!watch) return;
    WATCHED.delete(tableId);
    if (watch.timer) clearTimeout(watch.timer);
    if (watch.observer) watch.observer.disconnect();
}

/** A label as the text of a cell. */
function escapeText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The text of a number in a cell, as the other numeric columns show it. */
function displayNumber(v) {
    return v.toFixed(4).replace(/\.?0+$/, '');
}

/** How many rows a column is one value of now: the cells of a cell table, or the genes of a gene table. */
function rowsShown(column) {
    const rows = rowsOf(column) === 'genes' ? DataManager.getGenes() : DataManager.getCells();
    return rows ? Number(rows.length) || 0 : 0;
}

function makeReader() {
    const reader = {
        vec: null,
        codes: null,
        categories: null,
        MISSING: null,
        rank: null,
        missing: null,
        view: columnView(null),
        /** Hold the series the rows are shown from (or none). */
        hold(series, snap) {
            reader.vec = series && series.kind === 'numerical' ? series.held : null;
            reader.codes = series && series.kind === 'categorical' ? series.held : null;
            reader.categories = reader.codes ? snap.categories : null;
            reader.MISSING = reader.codes ? snap.MISSING : null;
            reader.rank = reader.codes && Array.isArray(snap.rank) ? snap.rank : null;
            // what a row of no category says, when its provider names it ('Not in any group'); 'N/A' otherwise
            reader.missing = reader.codes && typeof snap.missingLabel === 'string' ? snap.missingLabel : null;
        },
        /**
         * One cell. DataTables asks for it by type: 'display' (HTML), 'sort' (a number, or for a category the text of its
         * place in the order), and 'filter', 'export' and the rest (a number at the precision a float32 has, or the
         * category's label).
         * @param {string} type
         * @param {number} i - the row, as DataTables numbers it (the position in the rows it was given)
         */
        render(type, i) {
            const series = reader.codes || reader.vec;
            if (!series || !(i < series.length)) {
                return type === 'display' ? `<span class="text-muted az-score-wait">${reader.view.cell || ''}</span>` : '';
            }
            if (reader.codes) {
                const code = reader.codes[i];
                if (code === reader.MISSING || reader.categories[code] === undefined) {
                    if (type === 'display') return `<span class="text-muted">${reader.missing === null ? 'N/A' : escapeText(reader.missing)}</span>`;
                    // a named missing row is found by its name, and sorts after every category
                    if (reader.missing === null) return '';
                    return type === 'sort' ? (reader.rank ? '~' : `\uffff${reader.missing}`) : reader.missing;
                }
                if (type === 'display') return escapeText(reader.categories[code]);
                if (type === 'sort' && reader.rank) return String(reader.rank[code]).padStart(8, '0');
                return reader.categories[code];
            }
            const v = reader.vec[i];
            if (v !== v) return type === 'display' ? '<span class="text-muted">N/A</span>' : '';
            if (type === 'display') return displayNumber(v);
            if (type === 'sort') return v;
            return Number(v.toPrecision(7));
        }
    };
    return reader;
}

function update(entry, snap, silent = false) {
    const previous = entry.reader.codes || entry.reader.vec;
    entry.snap = snap;
    entry.title = tableHalfOf(entry.column).label(entry.column);
    // sources.read() already states a score of another length as failed (or asks again): the values
    // here are the rows' own. A last look, in case the cells changed between that read and now.
    const series = seriesOf(snap);
    const fits = !!series && series.length === rowsShown(entry.column);
    entry.reader.hold(fits ? series : null, snap);
    entry.reader.view = columnView(fits || !series ? snap
        : { ...snap, state: 'failed', values: null, codes: null, message: 'the score is for other cells' }, entry.title);
    const sig = [snap && snap.state, fits ? 1 : 0, snap && snap.held ? snap.held.edits : '', entry.title].join('|');
    const changed = sig !== entry.sig || previous !== (entry.reader.codes || entry.reader.vec);
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
 * @param {Object} column - `{type, key, column, label}` of a provider with a table half
 */
function ensure(tableId, column, visible = null) {
    const key = getColumnKey(column);
    const map = tableMap(tableId);
    let entry = map.get(key);
    if (entry && !sameScoreColumn(entry.column, column)) {
        release(tableId, key);
        entry = null;
    }
    if (!entry) {
        entry = { tableId, key, column, sub: subOf(column), handle: null, snap: null, title: '', sig: '',
            reader: makeReader(), visible: visible || (() => tileOnScreen(tableId)) };
        entry.handle = tableHalfOf(column).watch(column, { host: tableId, visible: () => entry.visible(), onChange: (snap) => update(entry, snap) });
        map.set(key, entry);
        if (!visible) watchTile(tableId);
        update(entry, entry.handle.read(), true);
    } else {
        entry.column = column;
        if (visible && entry.visible !== visible) {
            entry.visible = visible;
            const half = tableHalfOf(column);
            if (half.visibilityChanged) half.visibilityChanged();
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
    if (!map.size) { TABLES.delete(tableId); unwatchTile(tableId); }
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

    /** The open table fills its columns in place through this. */
    setSink(tableId, fn) {
        if (fn) SINKS.set(tableId, fn); else SINKS.delete(tableId);
    },
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
            const half = tableHalfOf(column);
            return { title: entry.title, view: entry.reader.view, snap: entry.snap,
                describe: half.describe ? (snap) => half.describe(snap, { sharers: 1 }) : undefined };
        });
        return filterGate(items);
    },

    /** The commands of the notices, for every score column of a table. */
    compute(tableId) { return this.entries(tableId).some(e => e.handle.compute()); },
    retry(tableId) { return this.entries(tableId).some(e => e.handle.retry()); },
    cancel(tableId) { return this.entries(tableId).some(e => e.handle.cancel()); },
    update(tableId) {
        let any = false;
        for (const entry of this.entries(tableId)) {
            const half = tableHalfOf(entry.column);
            any = (half.update ? half.update(entry.column) : false) || any;
        }
        return any;
    },

    /** The notice of a column, from its provider (the score's own words when it has none): null when it has nothing to say. */
    noticeOf(entry) {
        const half = tableHalfOf(entry.column);
        const snap = { ...entry.snap, source: entry.snap && entry.snap.title, title: entry.title };
        const sharers = entry.handle.sharers();
        return half.describe ? half.describe(snap, { sharers }) : describeColumn(snap, { sharers });
    },

    /** A column's name in an export's header. */
    fullLabelOf(entry) { return tableHalfOf(entry.column).fullLabel(entry.column); },

    /** Open the entity a column reads beside its table, when its provider can. */
    open(column, hostId) {
        const half = tableHalfOf(column);
        return half && half.open ? half.open(column, hostId) : null;
    },

    /** The handle count, for tests. */
    get tables() { return TABLES.size; }
};
