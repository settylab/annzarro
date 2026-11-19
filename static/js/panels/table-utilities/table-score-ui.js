/**
 * The open Cell Table's side of its gene-score columns: fill a column in place when its score
 * arrives, say what state it is in (header, cells, a notice over the table, the strip tag), hold
 * the rows while the filter reads a score that is not ready, and keep export honest.
 *
 * The table is built at once with the column in the state the score is in; nothing rebuilds it
 * when the score arrives. A change touches only the column: its cached sort and filter data are
 * dropped, the cells already built are rewritten, and one `draw(false)` re-sorts and re-filters
 * with the page position held, where the user is (sort order, page, search and scroll stay). Utils/score-column.js holds the
 * wording; panels/table-utilities/table-scores.js the handles.
 */
import { setScoreNotice, setStatusTag } from '../../utils/panel-surface.js';
import { worstNotice } from '../../utils/score-notices.js';
import { registerHostActions, openSignature } from '../../utils/score-source.js';
import { describeColumn, describeHeldRows } from '../../utils/score-column.js';
import { TableScores } from './table-scores.js';

/** Milliseconds a burst of progress frames waits before the notice is drawn again. */
const NOTICE_MS = 120;

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

    /** The cached sort and filter data of the column, and the cells already built. */
    const invalidate = (entry) => {
        const idx = indexOf(entry);
        if (idx < 0) return;
        const rows = st.aoData;
        const reader = entry.reader;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (row._aSortData) row._aSortData[idx] = null;
            row._aFilterData = null;
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

    /** The worst notice among the columns: an overlay and a strip tag, never a resize. */
    const paint = () => {
        const items = TableScores.entries(id).map(entry => ({
            entry, notice: describeColumn({ ...entry.snap, title: entry.title }, { sharers: entry.handle.sharers() })
        }));
        const worst = worstNotice(items.map(i => i.notice));
        const shown = items.find(i => i.notice === worst);
        container.__scoreWorst = shown ? shown.entry : null;
        if (!worst) {
            setScoreNotice(container, null);
            setStatusTag(container, 'score', null);
            return;
        }
        setStatusTag(container, 'score', { text: worst.tag.text, severity: worst.severity === 'error' ? 'error' : 'warning',
            title: worst.tag.title, pop: { text: `${worst.headline}${worst.text ? ` ${worst.text}` : ''}`, actions: worst.actions } });
        setScoreNotice(container, { state: worst.state, headline: worst.headline, text: worst.text, actions: worst.actions });
    };

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
        setScoreNotice(container, null);
        setStatusTag(container, 'score', null);
    });
    // a condition added or removed in the filter changes whether the rows are held
    dataTable.on('draw.dt', () => {
        if (hold()) tellPanels(id);
    });
    const syncAll = () => {
        for (const entry of TableScores.entries(id)) decorate(entry);
        hold();
        exportState();
        paint();
    };
    st._azScoreSync = syncAll;
    syncAll();
}

/** Whether the table's filter holds its rows now: for `isReady()` and for the resolver. */
export function tableHeldBy(id, config) {
    return TableScores.gateOf(id, config);
}

// ---------------------------------------------------------------------------
// the notice's actions, for the table container as a host (utils/score-source.js runScoreAction)

function tableIdOf(host) {
    const m = host && typeof host.id === 'string' ? /^table-container-(.+)$/.exec(host.id) : null;
    return m ? m[1] : null;
}

registerHostActions({
    available(action, host) {
        const id = tableIdOf(host);
        if (!id || !TableScores.entries(id).length) return undefined;
        if (action === 'score-remove') return !!host.__scoreWorst;
        if (action === 'score-open') return !!host.__scoreWorst && !!panelOf(host.__scoreWorst.column.key);
        return true;
    },
    run(action, host) {
        const id = tableIdOf(host);
        if (!id || !TableScores.entries(id).length) return false;
        const worst = host.__scoreWorst;
        switch (action) {
            case 'score-compute': TableScores.compute(id); return true;
            case 'score-cancel': TableScores.cancel(id); return true;
            case 'score-retry': TableScores.retry(id); return true;
            case 'score-update': TableScores.update(id); return true;
            case 'score-open':
                if (worst) openSignature(worst.column.key, id);
                return true;
            case 'score-remove': {
                const panel = panelOf(id);
                if (worst && panel && typeof panel.removeColumn === 'function') panel.removeColumn(worst.column);
                return true;
            }
            default: return false;
        }
    }
});
