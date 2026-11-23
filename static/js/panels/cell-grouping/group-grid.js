/**
 * The group grid of a Cell Grouping (UX 2.5, GRP-6, GRP-18): a row per group with its colour, name, cells and share,
 * the small mark; a cross-table for two factors; the reasons cells are in
 * no group; the CSV. It is a `role="grid"` that draws only the rows in view, so 2,000 groups cost what 20 do
 * (utils/virtual-grid.js).
 *
 * What is drawn comes from panels/cell-grouping/group-rows.js (pure); this file holds the DOM and the requests.
 * The panel mounts it: `PARTS.groups.mount(host, ctx)` (panels/cell-grouping.js).
 */
import { DataManager } from '../../data-manager.js';
import { makeDom } from '../gene-set-utilities/dom.js';
import { createVirtualGrid, columnRange } from '../../utils/virtual-grid.js';
import { groupSources, sourceTitleOf } from '../../utils/group-host.js';
import { codesRefusal } from '../../utils/cell-group-source.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import { cellExportEntry } from './cell-export.js';
import { groupColours as colorsOf, sourceName } from '../../utils/cell-grouping.js';
import { groupColours as hueColours } from '../plot-utilities/colors.js';
import { GROUP_COLOURS } from '../../utils/categories.js';
import { noGroupReasons } from './status.js';
import { smallOf } from './settings.js';
import { groupRows, shareText, filterRows, reasonRows, crossTable, listColumns, listCsv, crossCsv } from './group-rows.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const ROW_HEIGHT = 28;
/** The cross-table's first column and each further column, in px. */
const LABEL_WIDTH = 160;
const COLUMN_WIDTH = 84;
/** The list's columns: name, cells, share. */
const LIST_COLUMNS = 'minmax(9rem, 1fr) 4.5rem 4rem';
const SMALL_TITLE = 'Under 10 cells: statistics are unreliable';
const PALETTE = hueColours(GROUP_COLOURS);

/**
 * Hand a text to the user as a file.
 * @param {string} name
 * @param {string|string[]} text - the text, or its parts
 */
function download(name, text) {
    const url = URL.createObjectURL(new Blob(Array.isArray(text) ? text : [text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {HTMLElement} host - `.cgrp-groups`
 * @param {{panelId: string, read: () => ?Object, recipe: () => Object, shown: () => ?Object, noGroup?: () => boolean}} ctx
 * @returns {{update: () => void, destroy: () => void}}
 */
function mount(host, ctx) {
    const D = makeDom(document);
    const { el } = D;

    let view = 'list';                  // the user's choice: list or cross
    let search = '';
    let grid = null;                    // the virtual grid and the view it draws
    let gridView = null;
    let model = null;                   // what the reply and the recipe say, made once per reply and recipe
    let alive = true;

    // ---------------------------------------------------------------------------------- the bar and the frame

    const title = el('span', { class: 'cgg__title', aria: { live: 'polite' } });
    const searchBox = el('input', { type: 'search', class: 'form-control form-control-sm cgg__search', placeholder: 'Search groups',
        aria: { label: 'Search groups' }, autocomplete: 'off', spellcheck: 'false' });
    const viewButtons = {
        list: el('button', { type: 'button', class: 'btn btn-sm cgg__viewbtn', role: 'radio', data: { view: 'list' } }, 'List'),
        cross: el('button', { type: 'button', class: 'btn btn-sm cgg__viewbtn', role: 'radio', data: { view: 'cross' } }, 'Cross-table')
    };
    const viewGroup = el('div', { class: 'cgg__view', role: 'radiogroup', aria: { label: 'Show the groups as' } }, viewButtons.list, viewButtons.cross);
    const exportButton = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgg__export',
        title: 'Download the groups as CSV' }, 'Export CSV');
    const cellsExport = cellExportEntry({
        id: ctx.panelId, words: VOCABULARY.cellExport, download,
        deps: { cells: () => (DataManager.getCells() || []).length, names: () => DataManager.allCellNames(), sources: groupSources().sources,
            refusal: (id) => codesRefusal(id, ctx.panelId), panelId: ctx.panelId, host }
    });
    const bar = el('div', { class: 'cgg__bar' }, title, searchBox, viewGroup, exportButton, cellsExport.button, cellsExport.note);
    const gridHost = el('div', { class: 'cgg__gridhost' });
    const foot = el('div', { class: 'cgg__foot', hidden: true });
    const root = el('div', { class: 'cgg', hidden: true }, bar, gridHost, foot);
    host.appendChild(root);

    searchBox.addEventListener('input', () => {
        search = searchBox.value;
        if (model) update();
    });
    for (const [name, button] of Object.entries(viewButtons)) {
        button.addEventListener('click', () => { if (!button.disabled) setView(name); });
    }
    viewGroup.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const to = view === 'list' ? 'cross' : 'list';
        if (viewButtons[to].disabled) return;
        e.preventDefault();
        setView(to);
        viewButtons[to].focus();
    });
    exportButton.addEventListener('click', exportCsv);

    function setView(next) {
        if (view === next) return;
        view = next;
        update();
    }

    // ---------------------------------------------------------------------------------- the model

    /** The rows, names, colours and cross-table of the reply shown; made again only when the reply or the recipe is another. */
    function makeModel(recipe) {
        const s = ctx.shown();
        if (!s) return null;
        const reply = s.reply;
        const names = groupSources().sources.namesOf(ctx.panelId, reply);
        const colors = colorsOf(s.made, reply, PALETTE);
        const rows = groupRows({ reply, names, colors, small: smallOf(s.made) });
        const levelName = (j, id) => {
            const k = s.index.indexOf(j);
            const live = k >= 0 ? recipe.partitionings[k] : null;
            return (live && live.labels && live.labels[id]) || (s.defaults[j] && s.defaults[j].get(id)) || id;
        };
        const cross = crossTable({ reply, levelName });
        const factor = (i) => (s.made.partitionings[i] ? sourceName(s.made.partitionings[i].source, sourceTitleOf) : '');
        const reasons = () => reasonRows(noGroupReasons(s.made, reply, factor));
        return { recipe, reply, rows, cross, factor, reasons, total: rows.length, reasonList: null };
    }

    // ---------------------------------------------------------------------------------- the list

    let head = null;

    /** The list's header: the group's own columns. */
    function buildHeader() {
        D.clear(head);
        head.append(
            el('div', { class: 'cgg-headcell', role: 'columnheader' }, 'Name'),
            el('div', { class: 'cgg-headcell cgg-num cgg-cells cgg-narrow-hide', role: 'columnheader' }, 'Cells'),
            el('div', { class: 'cgg-headcell cgg-num cgg-narrow-hide', role: 'columnheader' }, 'Share'));
        grid.element.style.setProperty('--cgg-cols', LIST_COLUMNS);
        grid.element.setAttribute('aria-colcount', '3');
    }

    function listParts(row) {
        const swatch = el('span', { class: 'cgg-swatch', aria: { hidden: 'true' } });
        const name = el('span', { class: 'cgg-name' });
        const first = el('div', { class: 'cgg-cell cgg-cell--name', role: 'gridcell' }, swatch, name);
        const cells = el('div', { class: 'cgg-cell cgg-num cgg-cells cgg-narrow-hide', role: 'gridcell' });
        const share = el('div', { class: 'cgg-cell cgg-num cgg-share cgg-narrow-hide', role: 'gridcell' });
        row.append(first, cells, share);
        return { first, swatch, name, cells, share, pill: null };
    }

    const parts = new WeakMap();

    function buildListRow(row) {
        row.classList.add('cgg-row');
        parts.set(row, listParts(row));
    }

    /** The rows now shown: the groups matching the search, or the reasons. */
    let shownRows = [];

    function fillListRow(row, i) {
        const p = parts.get(row);
        const r = shownRows[i];
        const reasons = gridView === 'reasons';
        row.classList.toggle('cgg-row--reason', reasons);
        p.name.textContent = r.name;
        p.name.title = r.name;
        p.swatch.style.backgroundColor = r.color || 'transparent';
        p.swatch.hidden = !r.color;
        if (r.small && !p.pill) {
            p.pill = el('span', { class: 'cgg-small', title: SMALL_TITLE }, 'small');
            p.first.append(' ', p.pill);
        } else if (!r.small && p.pill) {
            p.pill.previousSibling.remove();
            p.pill.remove();
            p.pill = null;
        }
        p.cells.textContent = r.n === null ? '' : fmt(r.n);
        p.share.textContent = r.share === null ? '' : shareText(r.share);
        if (!reasons) row.title = `${r.name}: ${fmt(r.n)} cells, ${shareText(r.share)}`;
    }

    // ---------------------------------------------------------------------------------- the cross-table

    function buildCrossRow(row) {
        row.classList.add('cgg-row', 'cgg-row--cross');
        row.style.width = `${LABEL_WIDTH + model.cross.cols.length * COLUMN_WIDTH}px`;
        const label = el('div', { class: 'cgg-cell cgg-label', role: 'gridcell', style: `width:${LABEL_WIDTH}px` });
        row.appendChild(label);
        parts.set(row, { label, cells: [] });
    }

    function visibleColumns() {
        const g = grid.element;
        return columnRange(g.scrollLeft, (g.clientWidth || 400) - LABEL_WIDTH, COLUMN_WIDTH, model.cross.cols.length);
    }

    function fillCrossRow(row, i) {
        const p = parts.get(row);
        const cross = model.cross;
        p.label.textContent = cross.rows[i].label;
        p.label.title = `${cross.rows[i].label}: ${fmt(cross.rows[i].total)} cells`;
        for (const cell of p.cells) cell.remove();
        p.cells = [];
        const { start, end } = visibleColumns();
        for (let c = start; c < end; c++) {
            const n = cross.count(i, c);
            const cell = el('div', { class: `cgg-cell cgg-num cgg-count${n ? '' : ' cgg-zero'}`, role: 'gridcell',
                style: `left:${LABEL_WIDTH + c * COLUMN_WIDTH}px;width:${COLUMN_WIDTH}px`, text: fmt(n) });
            row.appendChild(cell);
            p.cells.push(cell);
        }
    }

    function paintCrossHead() {
        const cross = model.cross;
        D.clear(head);
        head.append(el('div', { class: 'cgg-headcell cgg-label', role: 'columnheader', style: `width:${LABEL_WIDTH}px`, text: model.factor(0) }));
        const { start, end } = visibleColumns();
        for (let c = start; c < end; c++) {
            head.append(el('div', { class: 'cgg-headcell cgg-num', role: 'columnheader',
                style: `left:${LABEL_WIDTH + c * COLUMN_WIDTH}px;width:${COLUMN_WIDTH}px`, title: cross.cols[c].label, text: cross.cols[c].label }));
        }
    }

    // ---------------------------------------------------------------------------------- the grid itself

    function makeGrid(kind) {
        if (grid) { grid.destroy(); grid = null; }
        D.clear(gridHost);
        head = el('div', { class: 'cgg-head', role: 'row' });
        const cross = kind === 'cross';
        grid = createVirtualGrid({
            doc: document, label: cross ? 'Cross-table of groups' : (kind === 'reasons' ? 'Cells in no group' : 'Groups'), rowHeight: ROW_HEIGHT, header: head,
            classes: { grid: 'cgg-grid', sizer: 'cgg-grid__sizer', rows: 'cgg-grid__rows', row: 'cgg-row' },
            buildRow: cross ? buildCrossRow : buildListRow,
            fillRow: cross ? fillCrossRow : fillListRow,
            onRender: cross ? paintCrossHead : () => {}
        });
        grid.element.dataset.view = kind;
        gridView = kind;
        gridHost.appendChild(grid.element);
        if (cross) {
            head.classList.add('cgg-head--cross');
            grid.setWidth(LABEL_WIDTH + model.cross.cols.length * COLUMN_WIDTH);
        } else if (kind === 'reasons') {
            D.clear(head);
            head.append(el('div', { class: 'cgg-headcell', role: 'columnheader' }, 'Cells in no group'));
            grid.element.style.setProperty('--cgg-cols', 'minmax(0, 1fr)');
            grid.element.setAttribute('aria-colcount', '1');
        } else {
            buildHeader();
        }
    }

    function paintRows({ top = false } = {}) {
        if (gridView === 'cross') {
            grid.setCount(model.cross.rows.length, { top });
            return;
        }
        if (gridView === 'reasons') {
            if (!model.reasonList) model.reasonList = model.reasons();
            shownRows = model.reasonList;
        } else {
            shownRows = filterRows(model.rows, search);
        }
        grid.setCount(shownRows.length, { top });
    }

    function paintTitle() {
        if (gridView === 'cross') {
            title.textContent = `Groups ${fmt(model.total)}`;
            foot.textContent = model.cross.text;
            foot.hidden = false;
            return;
        }
        foot.hidden = true;
        const filtered = gridView === 'list' && search.trim() && shownRows.length !== model.total;
        title.textContent = filtered ? `Groups ${fmt(shownRows.length)} of ${fmt(model.total)}` : `Groups ${fmt(model.total)}`;
    }

    // ---------------------------------------------------------------------------------- the export

    function exportCsv() {
        if (!model) return;
        if (gridView === 'cross') {
            download('groups-cross-table.csv', crossCsv(model.cross, [model.factor(0), model.factor(1)]));
            return;
        }
        download('groups.csv', listCsv({ rows: model.rows, columns: listColumns() }));
    }

    // ---------------------------------------------------------------------------------- update

    /** The panel painted: show what its groups say now. Cheap when nothing changed, and it never redraws rows that did not change. */
    function update() {
        if (!alive) return;
        cellsExport.refresh();
        const snap = ctx.read();
        const reply = snap && snap.values && snap.values.reply;
        const recipe = ctx.recipe();
        if (!reply) {
            root.hidden = true;
            return;
        }
        root.hidden = false;
        if (!model || model.reply !== reply || model.recipe !== recipe) {
            model = makeModel(recipe);
            if (!model) { root.hidden = true; return; }
        }
        const open = typeof ctx.noGroup === 'function' && ctx.noGroup();
        const canCross = !!model.cross;
        if (view === 'cross' && !canCross) view = 'list';
        viewButtons.cross.disabled = !canCross;
        const want = open ? 'reasons' : view;
        for (const [name, button] of Object.entries(viewButtons)) button.setAttribute('aria-checked', String(name === view && !open));
        const remake = want !== gridView || (want === 'cross' && gridModel !== model);
        if (remake) {
            makeGrid(want);
            gridModel = model;
        }
        searchBox.disabled = want !== 'list';
        const rowsKey = `${want}\u0001${search}`;
        if (remake || rowsFor.model !== model || rowsFor.key !== rowsKey) {
            const top = remake || rowsFor.key !== rowsKey;
            rowsFor = { model, key: rowsKey };
            paintRows({ top });
        }
        paintTitle();
    }
    let gridModel = null;
    let rowsFor = { model: null, key: null };

    // ---------------------------------------------------------------------------------- life

    return {
        update,
        destroy() {
            alive = false;
            if (grid) grid.destroy();
            root.remove();
        }
    };
}

/** The part of the panel that draws the groups: `PARTS.groups` (panels/cell-grouping.js). */
export const GROUP_GRID = Object.freeze({ mount });
