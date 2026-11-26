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
import { inlineRename } from '../../ui/inline-rename.js';
import { cellExportEntry } from './cell-export.js';
import { sourceName } from '../../utils/cell-grouping.js';
import { toHex, withGroupColor, withGroupLabel, withoutGroupOverride, withoutInactiveOverrides } from './colours.js';
import { groupOverrideState } from '../../utils/grouping-colours.js';
import { noGroupReasons } from './status.js';
import { smallOf } from './settings.js';
import { groupRows, shareText, filterRows, reasonRows, crossTable, crossColumnWidth, listColumns, listCsv, crossCsv } from './group-rows.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const ROW_HEIGHT = 28;
/** The cross-table's first column, in px; each further column is as wide as its longest name needs (crossColumnWidth). */
const LABEL_WIDTH = 160;
/** The list's columns: name, cells, share. */
const LIST_COLUMNS = 'minmax(9rem, 1fr) 4.5rem 4rem';
const SMALL_TITLE = 'Under 10 cells: statistics are unreliable';

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
        // the colours the recipe has now (a colour change asks for nothing), the same in every panel that draws the groups
        const got = groupSources().sources.coloursOf(ctx.panelId, reply);
        const colors = got.groups;
        const rows = groupRows({ reply, names, colors, small: smallOf(s.made) });
        // a group's own settings are keyed by its generated name (decision 38): every row knows it
        for (const r of rows) r.generated = got.generated[r.index];
        const levelName = (j, id) => {
            const k = s.index.indexOf(j);
            const live = k >= 0 ? recipe.partitionings[k] : null;
            return (live && live.labels && live.labels[id]) || (s.defaults[j] && s.defaults[j].get(id)) || id;
        };
        const cross = crossTable({ reply, levelName });
        const factor = (i) => (s.made.partitionings[i] ? sourceName(s.made.partitionings[i].source, sourceTitleOf) : '');
        const reasons = () => reasonRows(noGroupReasons(s.made, reply, factor));
        const overrides = new Map((Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : []).map((o) => [o.name, o]));
        return { recipe, reply, rows, cross, factor, reasons, total: rows.length, reasonList: null, generated: got.generated, overrides, namesRef: names, coloursRef: got };
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
        // a click on the swatch opens the browser's color picker: the group's own color, one undo step. It is not a tab stop
        // (the grid keeps its one, the row): Enter or Space on a focused row opens it (openPicker)
        const input = el('input', { type: 'color', class: 'cgg-swatch-input', tabindex: '-1' });
        const swatch = el('span', { class: 'cgg-swatch' }, input);
        const name = el('span', { class: 'cgg-name' });
        // ✎ and Reset: shown on hover and focus, never tab stops (the row is the grid's one): F2 on a row renames it. Their glyphs are
        // CSS content, so a cell's text stays the group's name
        const renameBtn = el('button', { type: 'button', class: 'btn btn-sm btn-link cgg-rowbtn cgg-rename', tabindex: '-1' });
        const resetBtn = el('button', { type: 'button', class: 'btn btn-sm btn-link cgg-rowbtn cgg-reset', tabindex: '-1', hidden: true });
        const first = el('div', { class: 'cgg-cell cgg-cell--name', role: 'gridcell' }, swatch, name, renameBtn, resetBtn);
        const cells = el('div', { class: 'cgg-cell cgg-num cgg-cells cgg-narrow-hide', role: 'gridcell' });
        const share = el('div', { class: 'cgg-cell cgg-num cgg-share cgg-narrow-hide', role: 'gridcell' });
        row.append(first, cells, share);
        input.addEventListener('change', () => pickColor(row, input.value));
        row.addEventListener('keydown', (e) => {
            if (e.target === row && e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const r = shownRows[Number(row.dataset.shownIndex)];
                if (r && r.generated) { e.preventDefault(); startRename(r); }
                return;
            }
            if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey) return;
            if (openPicker(row)) e.preventDefault();
        });
        const rowOf = () => shownRows[Number(row.dataset.shownIndex)];
        name.addEventListener('dblclick', () => { const r = rowOf(); if (r && r.generated) startRename(r); });
        renameBtn.addEventListener('click', () => { const r = rowOf(); if (r && r.generated) startRename(r); });
        resetBtn.addEventListener('click', () => { const r = rowOf(); if (r && r.generated) resetGroup(r); });
        return { first, swatch, input, name, cells, share, pill: null, renameBtn, resetBtn };
    }

    const parts = new WeakMap();

    /** The user chose a color for the group of a row: it is the group's override. */
    function pickColor(row, css) {
        const r = shownRows[Number(row.dataset.shownIndex)];
        if (r) setGroupColor(r, css);
    }

    /** One group's own color, one undo step; keyed by the group's generated name (decision 38), so it holds while a group of that name exists. */
    function setGroupColor(r, css) {
        if (!r || !r.key || typeof r.generated !== 'string' || typeof ctx.set !== 'function') return;
        ctx.set({ groupOverrides: withGroupColor(ctx.recipe(), r.generated, css) }, `color group ${r.name}`);
    }

    /** Open the color picker of a row's group from the keyboard; false when the row's group takes no color (a reason). */
    function openPicker(row) {
        const p = parts.get(row);
        if (!p || p.swatch.hidden || p.input.disabled) return false;
        if (typeof p.input.showPicker === 'function') {
            try { p.input.showPicker(); return true; } catch { /* not allowed here: a click opens it */ }
        }
        p.input.click();
        return true;
    }

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
        row.dataset.shownIndex = String(i);
        const editing = !reasons && !!renaming && r.generated === renaming.name;
        placeEditor(p, r, editing);
        const custom = !reasons && !!model.overrides.get(r.generated);
        p.renameBtn.hidden = reasons || !r.generated || editing;
        p.renameBtn.setAttribute('aria-label', `Rename ${r.name}`);
        p.renameBtn.title = `Rename ${r.name} (F2)`;
        p.resetBtn.hidden = !custom || editing;
        p.resetBtn.setAttribute('aria-label', `Reset the name and color of ${r.name}`);
        p.resetBtn.title = 'Back to the generated name and the default color';
        p.swatch.style.backgroundColor = r.color || 'transparent';
        p.swatch.hidden = !r.color || editing;
        const input = p.input;
        input.setAttribute('aria-label', `Color of ${r.name}`);
        input.title = `Set the color of ${r.name}`;
        input.value = toHex(r.color);
        input.disabled = reasons || !r.key;
        // the row says its keys: Enter or Space opens its group's color picker
        if (input.disabled || !r.color) row.removeAttribute('aria-keyshortcuts'); else row.setAttribute('aria-keyshortcuts', 'Enter Space');
        if (p.pill) p.pill.hidden = editing;
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

    // ---------------------------------------------------------------------------------- naming a group

    /**
     * The name editor of a group (decision 38): the group's own color beside the field, ✓ and ✕. It is one element moved into
     * the row that shows the group being edited, so a redraw of the rows never takes the field a user types in. The rules
     * are the level rename's: Enter or ✓ or a click elsewhere saves, Escape or ✕ cancels, Tab saves and edits the next group.
     * Nothing asks the server: a group's name is a label, keyed by its generated name.
     */
    let renaming = null;                // {name: generated name, draft?: string, fresh: boolean}
    let editor = null;
    let focusRowAfter = null;           // generated name of the row that takes the focus after the next redraw

    function ensureEditor() {
        if (editor) return editor;
        const hint = 'Enter saves, Escape cancels, Tab saves and moves to the next group.';
        const color = el('input', { type: 'color', class: 'cgg-edit__color', title: 'Color of this group (Alt+C)',
            aria: { label: 'Color of this group', keyshortcuts: 'Alt+C' } });
        const rename = inlineRename({ el, swatch: color, onInput: (text) => { if (renaming) renaming.draft = text; },
            classes: { input: 'form-control form-control-sm cgg-edit__name', ok: 'btn btn-sm btn-outline-success cgg-edit__ok', cancel: 'btn btn-sm btn-outline-secondary cgg-edit__cancel' },
            labels: { field: 'New name of the group', ok: 'Save the new name of the group', cancel: 'Cancel renaming the group', hint },
            onSave: (text, move) => leaveRename(true, move), onCancel: () => leaveRename(false) });
        const { input, ok, cancel } = rename;
        const box = el('span', { class: 'cgg-edit', role: 'group', aria: { label: 'Rename the group' } }, color, input, ok, cancel);
        editor = { box, input, color, ok, cancel, rearm: rename.rearm };
        color.addEventListener('change', () => {
            const r = renaming && model && model.rows.find((x) => x.generated === renaming.name);
            if (r) setGroupColor(r, color.value);
        });
        rename.attach(box);
        return editor;
    }

    /** Show the editor in the row of the group being renamed, and the group's name in every other row. */
    function placeEditor(p, r, editing) {
        p.first.classList.toggle('is-editing', editing);
        p.name.hidden = editing;
        if (!editing) {
            if (editor && editor.box.parentNode === p.first) editor.box.remove();
            return;
        }
        const e = ensureEditor();
        if (e.box.parentNode !== p.first) {
            e.input.value = renaming.draft !== undefined ? renaming.draft : r.name;
            p.first.append(e.box);
        }
        e.color.value = toHex(r.color);
        if (renaming.fresh) {
            renaming.fresh = false;
            e.rearm();
            setTimeout(() => { if (e.input.isConnected) { e.input.focus(); e.input.select(); } }, 0);
        }
    }

    function startRename(r) {
        if (!r || !r.generated || gridView !== 'list') return;
        renaming = { name: r.generated, draft: undefined, fresh: true };
        grid.refresh();
    }

    /** Leave the field: `keep` saves it; `move` (1 or -1) goes on to the next or the previous group in the list. */
    function leaveRename(keep, move = 0) {
        if (!renaming) return;
        const cur = renaming;
        renaming = null;
        const at = shownRows.findIndex((x) => x.generated === cur.name);
        const r = shownRows[at];
        const text = editor ? editor.input.value.trim() : '';
        const target = move && shownRows[at + move] && shownRows[at + move].generated ? shownRows[at + move] : null;
        if (target) renaming = { name: target.generated, draft: undefined, fresh: true };
        else focusRowAfter = cur.name;
        if (keep && r && typeof ctx.set === 'function' && text !== r.name) {
            // the generated name is what a group is called without a label: typing it back is Reset for the name
            ctx.set({ groupOverrides: withGroupLabel(ctx.recipe(), cur.name, text === cur.name ? '' : text) }, `rename group ${r.name}`);
        }
        if (model) grid.refresh();
        if (!target) {
            setTimeout(() => {
                const idx = shownRows.findIndex((x) => x.generated === cur.name);
                const row = grid && idx >= 0 ? grid.element.querySelector(`.cgg-row[data-shown-index="${idx}"]`) : null;
                if (row && focusRowAfter === cur.name) row.focus({ preventScroll: true });
                focusRowAfter = null;
            }, 0);
        }
    }

    /** Back to the generated name and the default color: the group's override goes. */
    function resetGroup(r) {
        if (typeof ctx.set === 'function') ctx.set({ groupOverrides: withoutGroupOverride(ctx.recipe(), r.generated) }, `reset group ${r.name}`);
    }

    // ---------------------------------------------------------------------------------- overrides no group has now

    const inactiveBox = el('div', { class: 'cgg__inactive', hidden: true, role: 'region', aria: { label: 'Names and colors no group has now' } });
    root.appendChild(inactiveBox);

    /**
     * The overrides no current group's generated name matches (a factor changed, a dataset switched, edges moved): kept, listed
     * here muted with what they set, and removed only by Drop. They apply again when a group of that name is back.
     */
    let inactiveKey = null;

    function paintInactive() {
        const state = groupOverrideState(model.recipe, model.generated);
        const key = JSON.stringify(state.inactive);
        if (key === inactiveKey) return;           // drawn again only when it changed, so a Drop button keeps its focus
        inactiveKey = key;
        D.clear(inactiveBox);
        inactiveBox.hidden = !state.inactive.length;
        if (!state.inactive.length) return;
        inactiveBox.append(el('div', { class: 'cgg__inactive-head' },
            el('span', { class: 'cgg__inactive-title', text: 'Not in these groups', title: 'Names and colors set for groups that no group has now. They apply again if a group of that name returns.' }),
            state.inactive.length > 1 ? el('button', { type: 'button', class: 'btn btn-sm btn-link cgg-drop-all',
                on: { click: () => ctx.set({ groupOverrides: withoutInactiveOverrides(ctx.recipe(), model.generated) }, 'drop inactive group settings') } }, 'Drop all inactive') : null));
        for (const o of state.inactive) {
            inactiveBox.append(el('div', { class: 'cgg-inactive-row', data: { name: o.name } },
                el('span', { class: 'cgg-swatch', style: o.color ? `background-color:${o.color}` : '', hidden: !o.color, aria: { hidden: 'true' } }),
                el('span', { class: 'cgg-inactive-name', text: o.label ? `${o.name} → ${o.label}` : o.name }),
                el('button', { type: 'button', class: 'btn btn-sm btn-link cgg-drop', aria: { label: `Drop the settings of ${o.name}` },
                    on: { click: () => ctx.set({ groupOverrides: withoutGroupOverride(ctx.recipe(), o.name) }, `drop settings of ${o.name}`) } }, 'Drop')));
        }
    }

    // ---------------------------------------------------------------------------------- the cross-table

    let widthOf = null;
    let widthIs = 0;

    /** One width for every column of the cross-table now shown: the longest column name decides. */
    function colWidth() {
        const cols = model.cross && model.cross.cols;
        if (!cols) return crossColumnWidth([]);
        if (widthOf !== cols) { widthOf = cols; widthIs = crossColumnWidth(cols); }
        return widthIs;
    }

    function buildCrossRow(row) {
        row.classList.add('cgg-row', 'cgg-row--cross');
        row.style.width = `${LABEL_WIDTH + model.cross.cols.length * colWidth()}px`;
        const label = el('div', { class: 'cgg-cell cgg-label', role: 'gridcell', style: `width:${LABEL_WIDTH}px` });
        row.appendChild(label);
        parts.set(row, { label, cells: [] });
    }

    function visibleColumns() {
        const g = grid.element;
        return columnRange(g.scrollLeft, (g.clientWidth || 400) - LABEL_WIDTH, colWidth(), model.cross.cols.length);
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
                style: `left:${LABEL_WIDTH + c * colWidth()}px;width:${colWidth()}px`, text: fmt(n) });
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
                style: `left:${LABEL_WIDTH + c * colWidth()}px;width:${colWidth()}px`, title: cross.cols[c].label, text: cross.cols[c].label }));
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
            grid.setWidth(LABEL_WIDTH + model.cross.cols.length * colWidth());
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
        // the names and colours are made once per reading of the reply: another grouping this one is built on may have been renamed
        // or recoloured with nothing in this recipe or reply changing
        const named = groupSources().sources.namesOf(ctx.panelId, reply);
        if (!model || model.reply !== reply || model.recipe !== recipe || model.namesRef !== named
            || model.coloursRef !== groupSources().sources.coloursOf(ctx.panelId, reply)) {
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
        paintInactive();
        paintInactive();
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
