/**
 * A virtualised grid of genes: a row per gene with a tick, for lists as long
 * as a dataset's whole gene set (tens of thousands of rows, a million at the
 * most). Only the rows in view (and a few beyond) are in the page.
 *
 * It is a `role="grid"` and not a listbox because a row may hold two controls
 * (the tick, and a direction button when genes can be scored as down), which a listbox option may not.
 * The grid says its true size (`aria-rowcount`) and each row its place
 * (`aria-rowindex`), as a virtualised list must. One row is in the tab order
 * (the active one); Up, Down, Home, End, Page Up and Page Down move between
 * rows, Left and Right between the controls of a row, Space ticks.
 *
 * Names reach the page as text, never as markup.
 */

/** Rows rendered above and below the view. */
const OVERSCAN = 6;
/** What a hidden or not yet laid out grid is taken to show, in px. */
const FALLBACK_VIEWPORT = 400;

/**
 * The rows to draw.
 * @param {number} scrollTop
 * @param {number} viewport - the grid's visible height
 * @param {number} rowHeight
 * @param {number} count - rows in all
 * @param {number} [overscan]
 * @returns {{start: number, end: number}} rows start..end-1
 */
export function visibleRange(scrollTop, viewport, rowHeight, count, overscan = OVERSCAN) {
    if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
    const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
    const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
    return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/**
 * The row a movement key lands on.
 * @param {string} key
 * @param {number} active - the row now
 * @param {number} count
 * @param {number} page - rows in one page
 * @returns {number|null} null for a key that does not move
 */
export function rowAfterKey(key, active, count, page) {
    if (count <= 0) return null;
    const clamp = (i) => Math.min(count - 1, Math.max(0, i));
    switch (key) {
        case 'ArrowDown': return clamp(active + 1);
        case 'ArrowUp': return clamp(active - 1);
        case 'Home': return 0;
        case 'End': return count - 1;
        case 'PageDown': return clamp(active + Math.max(1, page));
        case 'PageUp': return clamp(active - Math.max(1, page));
        default: return null;
    }
}

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
    const grid = doc.createElement('div');
    grid.className = 'gsig-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', label);
    grid.setAttribute('aria-rowcount', '0');
    grid.setAttribute('aria-colcount', '1');
    const sizer = doc.createElement('div');
    sizer.className = 'gsig-grid__sizer';
    sizer.setAttribute('role', 'presentation');
    const body = doc.createElement('div');
    body.className = 'gsig-grid__rows';
    body.setAttribute('role', 'rowgroup');
    sizer.appendChild(body);
    grid.appendChild(sizer);

    let rows = [];
    let active = 0;
    const drawn = new Map();   // row index -> element
    let frame = 0;
    let observer = null;

    const viewport = () => grid.clientHeight || FALLBACK_VIEWPORT;

    function makeRow(i) {
        const row = doc.createElement('div');
        row.className = 'gsig-row';
        row.setAttribute('role', 'row');
        row.style.height = `${rowHeight}px`;
        row.style.transform = `translateY(${i * rowHeight}px)`;
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
        return row;
    }

    /** Put row i's content and state in its element. */
    function fill(row, i) {
        const name = rows[i];
        row.dataset.index = String(i);
        row.setAttribute('aria-rowindex', String(i + 1));
        row.style.transform = `translateY(${i * rowHeight}px)`;
        const st = stateOf(name);
        const box = row.querySelector('input');
        const text = row.querySelector('.gsig-name');
        const note = row.querySelector('.gsig-note');
        box.checked = !!st.checked;
        box.setAttribute('aria-label', st.missing ? `${name}, not in this dataset` : name);
        box.tabIndex = i === active ? 0 : -1;
        text.textContent = name;
        text.title = name;
        note.textContent = st.missing ? 'not in this dataset' : '';
        const dir = row.querySelector('.gsig-dir');
        dir.hidden = !st.direction;
        if (st.direction) {
            dir.dataset.direction = st.direction;
            dir.textContent = st.direction === 'down' ? '↓ Down' : '↑ Up';
            dir.classList.toggle('gsig-dir--down', st.direction === 'down');
            dir.setAttribute('aria-label', `${name}: ${st.direction}. Press to make it ${st.direction === 'down' ? 'up' : 'down'}`);
            dir.title = `Scored as ${st.direction}. Press to make ${name} ${st.direction === 'down' ? 'up' : 'down'}.`;
        }
        dir.tabIndex = i === active ? 0 : -1;
        row.classList.toggle('is-down', st.direction === 'down');
        row.classList.toggle('is-missing', !!st.missing);
        row.classList.toggle('is-removed', !!st.removed);
    }

    function render() {
        frame = 0;
        const { start, end } = visibleRange(grid.scrollTop, viewport(), rowHeight, rows.length);
        for (const [i, el] of drawn) {
            if (i < start || i >= end) { el.remove(); drawn.delete(i); }
        }
        for (let i = start; i < end; i++) {
            let el = drawn.get(i);
            if (!el) {
                el = makeRow(i);
                drawn.set(i, el);
                body.appendChild(el);
            }
            fill(el, i);
        }
        // the active row must be reachable by Tab even when it is out of view
        if (!drawn.has(active) && drawn.size) {
            const first = drawn.get(start);
            if (first) first.querySelector('input').tabIndex = 0;
        }
    }

    function schedule() {
        if (frame) return;
        frame = (doc.defaultView || window).requestAnimationFrame(render);
    }

    function scrollTo(i) {
        const top = i * rowHeight;
        if (top < grid.scrollTop) grid.scrollTop = top;
        else if (top + rowHeight > grid.scrollTop + viewport()) grid.scrollTop = top + rowHeight - viewport();
    }

    function focusRow(i) {
        if (!rows.length) return;
        active = Math.min(rows.length - 1, Math.max(0, i));
        scrollTo(active);
        render();
        const el = drawn.get(active);
        if (el) el.querySelector('input').focus({ preventScroll: true });
    }

    grid.addEventListener('scroll', schedule, { passive: true });
    grid.addEventListener('focusin', (e) => {
        const row = e.target.closest && e.target.closest('.gsig-row');
        if (!row) return;
        const i = Number(row.dataset.index);
        if (i === active) return;
        const old = drawn.get(active);
        if (old) { old.querySelector('input').tabIndex = -1; old.querySelector('.gsig-dir').tabIndex = -1; }
        active = i;
        row.querySelector('input').tabIndex = 0;
        row.querySelector('.gsig-dir').tabIndex = 0;
    });
    grid.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Left and Right move between the controls of a row (the tick and the direction button)
        if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target && e.target.closest) {
            const row = e.target.closest('.gsig-row');
            const dir = row && row.querySelector('.gsig-dir');
            if (dir && !dir.hidden) {
                const to = e.key === 'ArrowRight' ? dir : row.querySelector('input');
                if (to !== e.target) { e.preventDefault(); to.focus({ preventScroll: true }); }
                return;
            }
        }
        const page = Math.max(1, Math.floor(viewport() / rowHeight) - 1);
        const next = rowAfterKey(e.key, active, rows.length, page);
        if (next === null) return;
        e.preventDefault();
        focusRow(next);
    });
    if (typeof (doc.defaultView || window).ResizeObserver === 'function') {
        observer = new (doc.defaultView || window).ResizeObserver(schedule);
        observer.observe(grid);
    }

    return {
        element: grid,
        /**
         * Show these names. The scroll position is kept unless `top`.
         * @param {string[]} names
         * @param {{top?: boolean}} [opts]
         */
        setRows(names, { top = false } = {}) {
            rows = names;
            grid.setAttribute('aria-rowcount', String(names.length));
            sizer.style.height = `${names.length * rowHeight}px`;
            for (const el of drawn.values()) el.remove();
            drawn.clear();
            if (top) { grid.scrollTop = 0; active = 0; }
            active = Math.min(active, Math.max(0, names.length - 1));
            render();
        },
        /** Repaint the rows in view (a tick changed, a state changed). */
        refresh() {
            for (const [i, el] of drawn) fill(el, i);
        },
        focusRow,
        rowIndexOf(name) {
            return rows.indexOf(name);
        },
        rows() {
            return rows;
        },
        activeIndex() {
            return active;
        },
        /** The number of row elements in the page (a test reads it). */
        drawnCount() {
            return drawn.size;
        },
        destroy() {
            if (frame) (doc.defaultView || window).cancelAnimationFrame(frame);
            if (observer) observer.disconnect();
            drawn.clear();
            grid.remove();
        }
    };
}
