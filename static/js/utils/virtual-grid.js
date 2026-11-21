/**
 * A virtualised grid: a row per item of a list as long as a dataset's whole gene set (a million at the most) or as
 * the groups of a grouping (2,000), with only the rows in view (and a few beyond) in the page. The gene grid
 * (utils/gene-grid.js) and the group grid (panels/cell-grouping/group-grid.js) are built on it, so the two cannot
 * drift apart.
 *
 * It is a `role="grid"`. The grid says its true size (`aria-rowcount`, which counts the header row when there is
 * one) and each row its place (`aria-rowindex`), as a virtualised list must. One row is in the tab order (the active
 * one); Up, Down, Home, End, Page Up and Page Down move between rows, Left and Right between the controls of a row.
 *
 * What a row holds is the caller's: `buildRow` makes its elements once, `fillRow` puts item i in them. Work per
 * scroll is the rows in view, never the length of the list.
 */

/** Rows rendered above and below the view. */
const OVERSCAN = 6;
/** What a hidden or not yet laid out grid is taken to show, in px. */
const FALLBACK_VIEWPORT = 400;

/**
 * The items to draw along one axis.
 * @param {number} scroll - how far the grid is scrolled along the axis
 * @param {number} viewport - the grid's visible extent
 * @param {number} size - the height of a row, or the width of a column
 * @param {number} count - items in all
 * @param {number} [overscan]
 * @returns {{start: number, end: number}} items start..end-1
 */
function window1d(scroll, viewport, size, count, overscan) {
    if (count <= 0 || size <= 0) return { start: 0, end: 0 };
    const top = Math.max(0, scroll);
    const first = Math.floor(top / size);
    const last = Math.ceil((top + Math.max(0, viewport)) / size);
    return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

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
    return window1d(scrollTop, viewport, rowHeight, count, overscan);
}

/**
 * The columns to draw (a cross-table wider than its panel).
 * @param {number} scrollLeft
 * @param {number} viewport - the grid's visible width
 * @param {number} columnWidth
 * @param {number} count - columns in all
 * @param {number} [overscan]
 * @returns {{start: number, end: number}} columns start..end-1
 */
export function columnRange(scrollLeft, viewport, columnWidth, count, overscan = 2) {
    return window1d(scrollLeft, viewport, columnWidth, count, overscan);
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
 * @param {number} [opts.colCount] - `aria-colcount`
 * @param {{grid?: string, sizer?: string, rows?: string, row?: string}} [opts.classes] - the elements' class names
 * @param {?HTMLElement} [opts.header] - a header row, kept at the top while the rows scroll; it is the caller's
 * @param {(row: HTMLElement, i: number) => void} opts.buildRow - make the content of a new row element
 * @param {(row: HTMLElement, i: number) => void} opts.fillRow - put item i in a row element, on every render
 * @param {(row: HTMLElement) => HTMLElement[]} [opts.controlsOf] - the tab stops of a row; the row itself when absent
 * @param {() => void} [opts.onRender] - after the rows were drawn (the caller refreshes what depends on the scroll)
 * @returns {{element: HTMLElement, setCount: Function, refresh: Function, focusRow: Function, activeIndex: Function,
 *   drawnCount: Function, rowElement: Function, viewport: Function, setWidth: Function, destroy: Function}}
 */
export function createVirtualGrid({ doc = document, label, rowHeight = 28, colCount = 1, classes = {}, header = null,
    buildRow, fillRow, controlsOf = (row) => [row], onRender = () => {} }) {
    const grid = doc.createElement('div');
    grid.className = classes.grid || 'vgrid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', label);
    grid.setAttribute('aria-rowcount', header ? '1' : '0');
    grid.setAttribute('aria-colcount', String(colCount));
    const sizer = doc.createElement('div');
    sizer.className = classes.sizer || 'vgrid__sizer';
    sizer.setAttribute('role', 'presentation');
    const body = doc.createElement('div');
    body.className = classes.rows || 'vgrid__rows';
    body.setAttribute('role', 'rowgroup');
    sizer.appendChild(body);
    if (header) grid.appendChild(header);
    grid.appendChild(sizer);

    let count = 0;
    let active = 0;
    const drawn = new Map();   // row index -> element
    let frame = 0;
    let observer = null;

    const view = () => doc.defaultView || window;
    const headerHeight = () => (header ? header.offsetHeight : 0);
    const viewport = () => Math.max(rowHeight, (grid.clientHeight || FALLBACK_VIEWPORT) - headerHeight());

    function makeRow(i) {
        const row = doc.createElement('div');
        row.className = classes.row || 'vgrid__row';
        row.setAttribute('role', 'row');
        row.style.height = `${rowHeight}px`;
        buildRow(row, i);
        return row;
    }

    /** Put row i's content and place in its element, and its controls in or out of the tab order. */
    function fill(row, i) {
        row.dataset.index = String(i);
        row.setAttribute('aria-rowindex', String(i + 1 + (header ? 1 : 0)));
        row.style.transform = `translateY(${i * rowHeight}px)`;
        fillRow(row, i);
        const stop = i === active ? 0 : -1;
        for (const control of controlsOf(row)) control.tabIndex = stop;
    }

    function render() {
        frame = 0;
        const { start, end } = visibleRange(grid.scrollTop, viewport(), rowHeight, count);
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
            const control = first && controlsOf(first)[0];
            if (control) control.tabIndex = 0;
        }
        onRender();
    }

    function schedule() {
        if (frame) return;
        frame = view().requestAnimationFrame(render);
    }

    function scrollTo(i) {
        const top = i * rowHeight;
        if (top < grid.scrollTop) grid.scrollTop = top;
        else if (top + rowHeight > grid.scrollTop + viewport()) grid.scrollTop = top + rowHeight - viewport();
    }

    function focusRow(i) {
        if (!count) return;
        active = Math.min(count - 1, Math.max(0, i));
        scrollTo(active);
        render();
        const el = drawn.get(active);
        const control = el && controlsOf(el)[0];
        if (control) control.focus({ preventScroll: true });
    }

    grid.addEventListener('scroll', schedule, { passive: true });
    grid.addEventListener('focusin', (e) => {
        const row = e.target.closest && e.target.closest('[role=row]');
        if (!row || row.dataset.index === undefined) return;
        const i = Number(row.dataset.index);
        if (i === active) return;
        const old = drawn.get(active);
        if (old) for (const control of controlsOf(old)) control.tabIndex = -1;
        active = i;
        for (const control of controlsOf(row)) control.tabIndex = 0;
    });
    grid.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Left and Right move between the controls of a row, when it has more than one
        if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target && e.target.closest) {
            const row = e.target.closest('[role=row]');
            const controls = row && row.dataset.index !== undefined ? controlsOf(row).filter((c) => !c.hidden) : [];
            const at = controls.indexOf(e.target);
            if (controls.length > 1 && at >= 0) {
                const to = controls[at + (e.key === 'ArrowRight' ? 1 : -1)];
                if (to) { e.preventDefault(); to.focus({ preventScroll: true }); }
                return;
            }
        }
        const page = Math.max(1, Math.floor(viewport() / rowHeight) - 1);
        const next = rowAfterKey(e.key, active, count, page);
        if (next === null) return;
        e.preventDefault();
        focusRow(next);
    });
    if (typeof view().ResizeObserver === 'function') {
        observer = new (view().ResizeObserver)(schedule);
        observer.observe(grid);
    }

    return {
        element: grid,
        /**
         * Show this many rows. The scroll position is kept unless `top`.
         * @param {number} n
         * @param {{top?: boolean}} [opts]
         */
        setCount(n, { top = false } = {}) {
            count = n;
            grid.setAttribute('aria-rowcount', String(n + (header ? 1 : 0)));
            sizer.style.height = `${n * rowHeight}px`;
            for (const el of drawn.values()) el.remove();
            drawn.clear();
            if (top) { grid.scrollTop = 0; active = 0; }
            active = Math.min(active, Math.max(0, n - 1));
            render();
        },
        /** Repaint the rows in view (a state changed). */
        refresh() {
            for (const [i, el] of drawn) fill(el, i);
            onRender();
        },
        focusRow,
        activeIndex: () => active,
        /** The number of row elements in the page (a test reads it). */
        drawnCount: () => drawn.size,
        /** The element of row i when it is in the page. */
        rowElement: (i) => drawn.get(i) || null,
        viewport,
        /** The width of the rows, for a grid wider than its panel (the grid then scrolls sideways). */
        setWidth(px) {
            sizer.style.minWidth = px ? `${px}px` : '';
            if (header) header.style.minWidth = px ? `${px}px` : '';
        },
        destroy() {
            if (frame) view().cancelAnimationFrame(frame);
            if (observer) observer.disconnect();
            drawn.clear();
            grid.remove();
        }
    };
}
