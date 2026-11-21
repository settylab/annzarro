/**
 * The open Cell Table's side of its source columns (a gene score, or any provider with a table half): fill a column in place when its score
 * arrives, say what state it is in (header, cells, a notice over the table, the strip tag), hold
 * the rows while the filter reads a score that is not ready, and keep export honest.
 *
 * The table is built at once with the column in the state the score is in; nothing rebuilds it
 * when the score arrives. A change touches only the column: its cached sort and filter data are
 * dropped, the cells already built are rewritten, and one `draw(false)` re-sorts and re-filters
 * with the page position held, where the user is (sort order, page, search and scroll stay). Utils/score-column.js holds the
 * wording; panels/table-utilities/table-scores.js the handles.
 */
import { actions } from '../../utils/source-actions.js';
import { painter } from '../../utils/host-binding.js';
import { describeHeldRows, dropConditions } from '../../utils/score-column.js';
import { referencedKeys } from '../../utils/line-select.js';
import { tableHalfOf } from '../../utils/table-source.js';
import { TableScores } from './table-scores.js';

/** The class of a header whose column a new condition cannot name in this table (a loop: operator decision 15). */
const FILTER_OFF = 'az-filter-off';

/** SearchBuilder's `columns`: a selector of the header cells of the columns a new condition can name. */
export const FILTER_COLUMNS = `:not(.${FILTER_OFF})`;

/** Milliseconds a burst of progress frames waits before the notice is drawn again. */
const NOTICE_MS = 120;

/** The tables' provider: its notices on the page's painter and its actions in the registry. */
const TABLE_PROVIDER = 'table-score';

/** container -> the table id whose score columns it states, while the table is bound */
const BOUND = new WeakMap();
/** container -> its DataTable, while the table is bound (Remove this filter rebuilds its conditions) */
const TABLES = new WeakMap();

// what a table container has to say: one entry per score column, as the column states it (the painter shows the
// worst of every provider's notices on the container, with its progress bar)
painter.register({
    id: TABLE_PROVIDER,
    entries(container) {
        const id = BOUND.get(container);
        if (!id) return [];
        return TableScores.entries(id).map(entry => ({
            role: 'column', snap: entry.snap, rec: entry,
            notice: TableScores.noticeOf(entry)
        }));
    }
});

function panelOf(id) {
    return window.PanelManager && window.PanelManager.getPanel ? window.PanelManager.getPanel(id) : null;
}

function tellPanels(id) {
    const pm = window.PanelManager;
    if (pm && pm.notifyPanels) pm.notifyPanels('tableFiltered', { id, type: 'cells' }).catch(() => {});
}

/**
 * Show the states of a table's score columns and keep them up to date. Called when a table is
 * built and again after its rows were replaced in place.
 * @param {Object} dataTable - DataTables API instance
 * @param {Object} settings - the panel's settings
 * @param {HTMLElement} container - the table container
 */
export function bindScoreColumns(dataTable, settings, container) {
    const id = settings.id;
    if (!id || !TableScores.entries(id).length) {
        TableScores.setSink(id, null);
        return;
    }
    const st = dataTable.settings()[0];
    // bound already (the rows were replaced in place): state the columns as they are now
    if (typeof st._azScoreSync === 'function') {
        st._azScoreSync();
        return;
    }
    const indexOf = (entry) => st.aoColumns.findIndex(c => c.mData === entry.key);
    let noticeTimer = null;
    let lastHold = '';
    let adjustTimer = null;

    const adjust = () => {
        clearTimeout(adjustTimer);
        adjustTimer = setTimeout(() => {
            try { if (container.isConnected) dataTable.columns.adjust(); } catch { /* destroyed meanwhile */ }
        }, 40);
    };

    /** The header cell: the name, then the state in brackets. */
    const decorate = (entry) => {
        const idx = indexOf(entry);
        if (idx < 0) return;
        let th;
        try { th = dataTable.column(idx).header(); } catch { return; }
        if (!th) return;
        const view = entry.reader.view;
        let span = th.querySelector('.az-score-state');
        if (view.suffix) {
            if (!span) {
                span = document.createElement('span');
                span.className = 'az-score-state';
                th.appendChild(span);
            }
            const text = ` ${view.suffix}`;
            if (span.textContent !== text) {
                span.textContent = text;
                adjust();
            }
        } else if (span) {
            span.remove();
            adjust();
        }
        th.dataset.exportTitle = TableScores.fullLabelOf(entry);
        th.classList.toggle('az-sort-off', !view.sortable);
        th.setAttribute('aria-disabled', view.sortable ? 'false' : 'true');
        th.dataset.scoreState = view.state;
        if (!entry.guarded) {
            // a column with no values cannot be sorted: DataTables binds its click and key handlers
            // when the table is made, so the column stays orderable and the way in is closed here
            entry.guarded = true;
            const stop = (e) => {
                if (e.type === 'keypress' && e.which !== 13 && e.key !== 'Enter') return;
                if (!entry.reader.view.sortable) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                }
            };
            th.addEventListener('click', stop, true);
            th.addEventListener('keypress', stop, true);
        }
    };

    /**
     * The cached sort and filter data of the column, and the cells already built. Only this column's
     * slot of each row's caches is touched (the other columns' stay): the sort data is dropped, to
     * be read again if the table is sorted, and the filter text is written in place, so the draw
     * that follows does not read every column of every row again. A million rows is a loop of a
     * million small steps.
     */
    const invalidate = (entry) => {
        const idx = indexOf(entry);
        if (idx < 0) return;
        const rows = st.aoData;
        const reader = entry.reader;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const sortData = row._aSortData;
            if (sortData && sortData.length > idx) sortData[idx] = null;
            const filterData = row._aFilterData;
            if (filterData && filterData.length > idx) {
                filterData[idx] = String(reader.render('filter', r));
                row._sFilterRow = filterData.join('  ');
            }
            const cells = row.anCells;
            if (cells && cells[idx]) cells[idx].innerHTML = reader.render('display', r);
        }
    };

    const gate = () => {
        const cfg = { columns: settings.columns, searchBuilderConfig: settings.searchBuilderConfig };
        return TableScores.gateOf(id, cfg);
    };

    /** The rows are held while the filter reads a score that cannot be read. */
    const hold = () => {
        const g = gate();
        const wrapper = container.querySelector('.dataTables_wrapper');
        container.classList.toggle('az-score-held', !!g);
        let note = container.querySelector('.az-score-held-note');
        if (g) {
            const words = describeHeldRows(g);
            if (!note && wrapper) {
                note = document.createElement('div');
                note.className = 'az-score-held-note alert alert-secondary';
                note.setAttribute('role', 'status');
                const after = wrapper.querySelector('.az-search-row');
                if (after) after.after(note); else wrapper.appendChild(note);
            }
            if (note) {
                note.dataset.state = g.state;
                note.innerHTML = '';
                const strong = document.createElement('strong');
                strong.textContent = words.headline;
                note.append(strong, ' ', words.text);
            }
        } else if (note) {
            note.remove();
        }
        const key = g ? `${g.state}|${g.scoreState}|${g.title}` : '';
        const moved = key !== lastHold;
        lastHold = key;
        return moved;
    };

    /** Export is off while any score column cannot give its values. */
    const exportState = () => {
        const button = document.getElementById(`export-csv-${id}`);
        if (!button) return;
        const blocked = TableScores.entries(id).find(e => !e.reader.view.exportable);
        button.disabled = !!blocked;
        if (blocked) button.title = blocked.reader.view.exportNote;
        else button.removeAttribute('title');
    };

    /**
     * Keep out of the condition builder the columns a provider says cannot be filtered on in this table, unless a
     * condition names one already (a link): asked when the table is bound and again as a condition is about to be
     * made, so it follows a grouping's recipe and the table's references as they are then.
     */
    const markFilterable = () => {
        let named = null;
        for (const entry of TableScores.entries(id)) {
            const half = tableHalfOf(entry.column);
            const idx = indexOf(entry);
            if (!half || !half.filterable || idx < 0) continue;
            let th;
            try { th = dataTable.column(idx).header(); } catch { continue; }
            if (!th) continue;
            if (!named) named = referencedKeys(settings.searchBuilderConfig);
            th.classList.toggle(FILTER_OFF, !half.filterable(entry.column, id) && !named.has(entry.key));
        }
    };
    // before SearchBuilder's own handler makes the condition (and lists the columns it can name)
    container.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.dtsb-add')) markFilterable();
    }, true);

    /** The worst notice among the columns (and any other provider's on the container): an overlay and a strip tag, never a resize. */
    BOUND.set(container, id);
    TABLES.set(container, dataTable);
    const paint = () => painter.paint(container);

    const schedulePaint = () => {
        if (noticeTimer) return;
        noticeTimer = setTimeout(() => {
            noticeTimer = null;
            if (container.isConnected) paint();
        }, NOTICE_MS);
    };

    const sink = (entry, changed) => {
        if (!container.isConnected) return;
        if (changed) {
            invalidate(entry);
            decorate(entry);
            // sorts and filters again where the user is: 'page' alone would draw the old order
            try { dataTable.draw(false); } catch { /* destroyed meanwhile */ }
            hold();
            exportState();
            // plots filtered by this table ask again: the rows they may use changed
            tellPanels(id);
        }
        schedulePaint();
    };

    TableScores.setSink(id, sink);
    dataTable.on('destroy.dt', () => {
        TableScores.clearSink(id, sink);
        clearTimeout(noticeTimer);
        clearTimeout(adjustTimer);
        const note = container.querySelector('.az-score-held-note');
        if (note) note.remove();
        container.classList.remove('az-score-held');
        BOUND.delete(container);
        TABLES.delete(container);
        painter.paint(container);
    });
    // a condition added or removed in the filter changes whether the rows are held
    dataTable.on('draw.dt', () => {
        if (hold()) tellPanels(id);
    });
    const syncAll = () => {
        for (const entry of TableScores.entries(id)) decorate(entry);
        markFilterable();
        hold();
        exportState();
        paint();
    };
    st._azScoreSync = syncAll;
    syncAll();
}

// ---------------------------------------------------------------------------
// the notice's actions, for the table container as a host (utils/source-actions.js)

function tableIdOf(host) {
    const m = host && typeof host.id === 'string' ? /^table-container-(.+)$/.exec(host.id) : null;
    return m ? m[1] : null;
}

/**
 * The tables' provider of the notice actions. Every dependency is given, so a Node test can hold every state of a host
 * against every action. A table has no other source to choose, so it has no "Choose another": it removes the column.
 * @param {Object} deps
 */
export function createTableActions({ tableIdOf: idOf, hasColumns, worstOf, compute, cancel, retry, update, canOffer, offerAgain: offer, panelOf: panel,
    openSource, filtersOn = () => false, unfilter = () => {} }) {
    const table = (host) => { const id = idOf(host); return id && hasColumns(id) ? id : null; };
    const all = (run) => ({ target: table, run: (id) => { run(id); } });
    const worst = (test) => (host) => { const w = table(host) && worstOf(host); return w && test(w, host) ? w : null; };
    return {
        id: TABLE_PROVIDER,
        owns: (host) => !!table(host),
        actions: {
            'score-compute': all(compute),
            'score-cancel': all(cancel),
            'score-retry': all(retry),
            'score-update': all(update),
            'score-offer': { target: worst((w) => canOffer(w.column)), run: (w) => { offer(w.column); } },
            'score-open': { target: worst((w) => !!panel(w.column.key)), run: (w, host) => { openSource(w.column.key, idOf(host), w.column); } },
            // the conditions on the column go, and the column stays (a loop through the filter ends: decision 18)
            'score-unfilter': { target: worst((w, host) => filtersOn(host, w)), run: (w, host) => { unfilter(host, w); } },
            'score-remove': { target: worst((w, host) => { const p = panel(idOf(host)); return !!p && typeof p.removeColumn === 'function'; }),
                run: (w, host) => { panel(idOf(host)).removeColumn(w.column); } }
        }
    };
}

actions.register(createTableActions({
    tableIdOf,
    hasColumns: (id) => TableScores.entries(id).length > 0,
    worstOf: (host) => { const shown = painter.shownOf(host); return shown && shown.provider === TABLE_PROVIDER ? shown.rec : null; },
    compute: (id) => TableScores.compute(id),
    cancel: (id) => TableScores.cancel(id),
    retry: (id) => TableScores.retry(id),
    update: (id) => TableScores.update(id),
    canOffer: (column) => TableScores.canOffer(column),
    offerAgain: (column) => TableScores.offer(column),
    panelOf,
    openSource: (key, hostId, column) => TableScores.open(column, hostId),
    filtersOn: (host, entry) => { const dt = TABLES.get(host); return !!dt && referencedKeys(dt.searchBuilder.getDetails()).has(entry.key); },
    unfilter: (host, entry) => { const dt = TABLES.get(host); if (dt) dt.searchBuilder.rebuild(dropConditions(dt.searchBuilder.getDetails(), entry.key)); }
}));
