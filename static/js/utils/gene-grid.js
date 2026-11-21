/**
 * A virtualised grid of genes: a row per gene with a tick, for lists as long
 * as a dataset's whole gene set (tens of thousands of rows, a million at the
 * most). Only the rows in view (and a few beyond) are in the page.
 *
 * It is the shared virtualised grid (utils/virtual-grid.js) with a tick, a name and a direction button in each row.
 * It is a `role="grid"` and not a listbox because a row may hold two controls
 * (the tick, and a direction button when genes can be scored as down), which a listbox option may not.
 * The grid says its true size (`aria-rowcount`) and each row its place
 * (`aria-rowindex`), as a virtualised list must. One row is in the tab order
 * (the active one); Up, Down, Home, End, Page Up and Page Down move between
 * rows, Left and Right between the controls of a row, Space ticks.
 *
 * Names reach the page as text, never as markup.
 */
import { createVirtualGrid, visibleRange, rowAfterKey } from './virtual-grid.js';

// the windowing and the keys are the shared grid's; they stay importable from here
export { visibleRange, rowAfterKey };

/**
 * @param {Object} opts
 * @param {Document} [opts.doc]
 * @param {string} opts.label - the grid's accessible name
 * @param {number} [opts.rowHeight] - px; every row has it
 * @param {(name: string, checked: boolean) => void} opts.onToggle
 * @param {(name: string, direction: 'up'|'down') => void} [opts.onDirection] - the direction button was pressed; `direction` is the new one
 * @param {(name: string) => {checked: boolean, missing?: boolean, removed?: boolean, direction?: ('up'|'down')}} opts.stateOf
 *   `direction` is given only when genes can be scored as down and the gene is in the signature: the row then has its button
 * @returns {{element: HTMLElement, setRows: Function, refresh: Function, focusRow: Function,
 *   rowIndexOf: Function, rows: Function, activeName: Function, destroy: Function}}
 */
export function createGeneGrid({ doc = document, label, rowHeight = 28, onToggle, onDirection = () => {}, stateOf }) {
    let rows = [];
    const parts = new WeakMap();   // row element -> its box, text, note and direction button

    function buildRow(row) {
        row.classList.add('gsig-row');
        const cell = doc.createElement('div');
        cell.className = 'gsig-cell';
        cell.setAttribute('role', 'gridcell');
        const box = doc.createElement('input');
        box.type = 'checkbox';
        box.className = 'gsig-tick form-check-input';
        box.addEventListener('change', () => onToggle(rows[Number(row.dataset.index)], box.checked));
        const text = doc.createElement('span');
        text.className = 'gsig-name';
        const note = doc.createElement('span');
        note.className = 'gsig-note';
        const dir = doc.createElement('button');
        dir.type = 'button';
        dir.className = 'gsig-dir btn btn-sm';
        dir.hidden = true;
        dir.addEventListener('click', () => {
            const name = rows[Number(row.dataset.index)];
            onDirection(name, dir.dataset.direction === 'down' ? 'up' : 'down');
        });
        cell.append(box, text, note, dir);
        row.appendChild(cell);
        parts.set(row, { box, text, note, dir });
    }

    /** Put row i's content and state in its element. */
    function fillRow(row, i) {
        const name = rows[i];
        const { box, text, note, dir } = parts.get(row);
        const st = stateOf(name);
        box.checked = !!st.checked;
        box.setAttribute('aria-label', st.missing ? `${name}, not in this dataset` : name);
        text.textContent = name;
        text.title = name;
        note.textContent = st.missing ? 'not in this dataset' : '';
        dir.hidden = !st.direction;
        if (st.direction) {
            dir.dataset.direction = st.direction;
            dir.textContent = st.direction === 'down' ? '\u2193 Down' : '\u2191 Up';
            dir.classList.toggle('gsig-dir--down', st.direction === 'down');
            dir.setAttribute('aria-label', `${name}: ${st.direction}. Press to make it ${st.direction === 'down' ? 'up' : 'down'}`);
            dir.title = `Scored as ${st.direction}. Press to make ${name} ${st.direction === 'down' ? 'up' : 'down'}.`;
        }
        row.classList.toggle('is-down', st.direction === 'down');
        row.classList.toggle('is-missing', !!st.missing);
        row.classList.toggle('is-removed', !!st.removed);
    }

    const grid = createVirtualGrid({
        doc, label, rowHeight, colCount: 1,
        classes: { grid: 'gsig-grid', sizer: 'gsig-grid__sizer', rows: 'gsig-grid__rows' },
        buildRow, fillRow,
        controlsOf: (row) => { const p = parts.get(row); return p ? [p.box, p.dir] : []; }
    });

    return {
        element: grid.element,
        /**
         * Show these names. The scroll position is kept unless `top`.
         * @param {string[]} names
         * @param {{top?: boolean}} [opts]
         */
        setRows(names, opts = {}) {
            rows = names;
            grid.setCount(names.length, opts);
        },
        /** Repaint the rows in view (a tick changed, a state changed). */
        refresh: grid.refresh,
        focusRow: grid.focusRow,
        rowIndexOf(name) {
            return rows.indexOf(name);
        },
        rows() {
            return rows;
        },
        activeIndex: grid.activeIndex,
        /** The number of row elements in the page (a test reads it). */
        drawnCount: grid.drawnCount,
        destroy: grid.destroy
    };
}
