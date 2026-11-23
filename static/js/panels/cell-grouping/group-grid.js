/**
 * The group grid of a Cell Grouping (UX 2.5, GRP-6, GRP-18): a row per group with its colour, name, cells and share,
 * the small mark, and the focused gene's offered statistics; a cross-table for two factors; the reasons cells are in
 * no group; the CSV. It is a `role="grid"` that draws only the rows in view, so 2,000 groups cost what 20 do
 * (utils/virtual-grid.js).
 *
 * THE FOCUSED GENE'S COLUMNS cost a computation, so they are asked for only when the estimate is live (under the
 * server's live limit) and the panel is on screen. Otherwise the header is a button, "Show Mrpl15", and a focus change
 * sends no request at all: it only renames the button. The gene is one feature that rides the panel's OWN request
 * (`ctx.setFeatures`): the groups and the gene come in one reply, a later edit costs one request and not two, and the
 * grid reads the moments from the panel's snapshot.
 *
 * What is drawn comes from panels/cell-grouping/group-rows.js (pure); this file holds the DOM and the requests.
 * The panel mounts it: `PARTS.groups.mount(host, ctx)` (panels/cell-grouping.js).
 */
import { DataManager } from '../../data-manager.js';
import { makeDom } from '../gene-set-utilities/dom.js';
import { createVirtualGrid, columnRange } from '../../utils/virtual-grid.js';
import { KIND_CLIENT } from '../score-options/score-options.js';
import { groupSources, sourceTitleOf } from '../../utils/group-host.js';
import { codesRefusal } from '../../utils/cell-group-source.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import { cellExportEntry } from './cell-export.js';
import { sourceName } from '../../utils/cell-grouping.js';
import { groupId } from '../../utils/grouping-colours.js';
import { toHex, withOverride } from './colours.js';
import { noGroupReasons } from './status.js';
import { smallOf } from './settings.js';
import {
    groupRows, shareText, filterRows, reasonRows, crossTable, layerOf, featureWire, focusColumns, focusValues, columnFormat, isLive, gateOf,
    listColumns, listCsv, crossCsv
} from './group-rows.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const PENDING = '…';
const DASH = '—';
const ROW_HEIGHT = 28;
/** The sources the dataset itself holds: a grouping of these can be estimated before it is watched. */
const PLAIN_SOURCES = Object.freeze(['obs', 'obsm', 'layer', 'obsp']);
/** The cross-table's first column and each further column, in px. */
const LABEL_WIDTH = 160;
const COLUMN_WIDTH = 84;
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
    let visible = true;
    let alive = true;
    let columnsNow = [];                // the focused gene's columns now
    let valuesMemo = null;

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
        const colors = groupSources().sources.coloursOf(ctx.panelId, reply).groups;
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

    // ---------------------------------------------------------------------------------- the focused gene

    const focus = { gene: null, sig: '', blocked: false, forced: null, ticket: 0, key: null, kind: null, kindLayer: null,
        requested: null, shownGene: null, waiting: false };
    const hasReply = () => { const snap = ctx.read(); return !!(snap && snap.values && snap.values.reply); };

    const currentGene = () => DataManager.getFocusedGene() || null;
    const sigOf = (recipe) => `${layerOf(recipe)}\u0001${recipe.detect_above || 0}`;
    const stale = (ticket) => !alive || ticket !== focus.ticket;

    async function kindOf(layer) {
        if (focus.kindLayer === layer) return focus.kind;
        let reply = null;
        try { reply = await KIND_CLIENT.kind(DataManager.getCurrentDataset(), layer); } catch (error) { console.error('Group grid:', error); }
        const kind = (reply && reply.kind) || null;
        focus.kind = kind;
        focus.kindLayer = layer;
        return kind;
    }

    /** Stop asking for the gene: the panel's next request carries no feature. */
    function stopAsking() {
        focus.ticket++;
        focus.key = null;
        if (focus.requested) {
            focus.requested = null;
            focus.shownGene = null;
            ctx.setFeatures(null);
            paintFocus();
        }
    }

    /** Ask for the gene's moments with the panel's own request. */
    async function request(gene, recipe, ticket) {
        await kindOf(layerOf(recipe));
        if (stale(ticket)) return;
        const wire = featureWire(gene, recipe);
        focus.requested = JSON.stringify(wire);
        focus.shownGene = gene;
        ctx.setFeatures([wire]);
        paintFocus();
    }

    /** Whether the gene's statistics are cheap enough to compute at once: the estimate, and nothing computed. */
    async function decide(gene, recipe, ticket) {
        // what the layer's numbers look like and what the gene would cost are asked together: the answer comes in one round trip
        const asked = groupSources().sources.estimate(ctx.panelId, { features: [featureWire(gene, recipe)] }).catch((error) => { console.error('Group grid:', error); return null; });
        await Promise.all([kindOf(layerOf(recipe)), asked]);
        if (stale(ticket)) return;
        const reply = await asked;
        if (!reply) {
            // not decidable: the source is gated (a table or an upstream grouping is not ready). Asked again once the groups are
            // there, and never on every paint, which the estimate itself would cause.
            focus.key = null;
            if (hasReply()) { focus.blocked = true; paintFocus(); } else focus.waiting = true;
            return;
        }
        if (isLive(reply.estimate)) {
            await request(gene, recipe, ticket);
        } else {
            focus.blocked = true;
            focus.key = null;
            paintFocus();
        }
    }

    /** Decide what the focused gene's columns do now (GRP-6). Idempotent: it acts only when something it depends on changed. */
    function syncFocus() {
        const recipe = ctx.recipe();
        const gene = currentGene();
        const sig = sigOf(recipe);
        if (sig !== focus.sig) {
            focus.sig = sig;
            focus.blocked = false;
            focus.forced = null;
            focus.kindLayer = null;
            focus.waiting = false;
            stopAsking();
        }
        focus.gene = gene;
        const gate = gateOf({ gene, visible, blocked: focus.blocked, forced: focus.forced === gene });
        if (gate === 'nogene' || gate === 'button') {
            if (focus.requested || focus.key) stopAsking();
            return;
        }
        if (gate === 'wait') return;
        if (focus.waiting) {
            if (!hasReply()) return;
            focus.waiting = false;
        }
        const key = `${gene}\u0001${sig}`;
        if (focus.key === key) return;
        focus.key = key;
        const ticket = ++focus.ticket;
        if (gate === 'compute') request(gene, recipe, ticket);
        else decide(gene, recipe, ticket);
    }

    /** The focused gene's values for every row, made once per reply of the moments, the rows and the columns. */
    function focusData() {
        const columns = columnsNow;
        const snap = ctx.read();
        const wires = ctx.applied();
        const mine = focus.requested && wires.length === 1 && JSON.stringify(wires[0]) === focus.requested;
        const feature = mine && snap && snap.state === 'ready' && snap.values && snap.values.features && snap.values.features[0];
        if (!feature) return { values: null, pending: true };
        if (!feature.moments || !feature.status || feature.status.status !== 'ok' || !model || !columns.length) return { values: null, pending: false };
        const memo = valuesMemo;
        if (memo && memo.feature === feature && memo.rows === model.rows && memo.columns === columns) return { values: memo.values, formats: memo.formats, pending: false };
        const values = focusValues({ columns, rows: model.rows, featureReply: snap.values.reply, moments: feature.moments });
        const formats = columns.map((c, k) => columnFormat(c.stat, values[k]));
        valuesMemo = { feature, rows: model.rows, columns, values, formats };
        return { values, formats, pending: false };
    }

    function paintFocus() {
        if (!alive || !model) return;
        columnsNow = focus.requested ? focusColumns({ gene: focus.shownGene, recipe: ctx.recipe(), kind: focus.kind }) : [];
        if (gridView === 'list') { buildHeader(); grid.refresh(); }
    }

    // ---------------------------------------------------------------------------------- the list

    let head = null;
    let template = '';

    const mode = () => (focus.requested ? 'columns' : (!focus.gene ? 'nogene' : (focus.blocked ? 'button' : 'pending')));

    let headerKey = null;

    /** The list's header, made again only when what it says changed, so a button in it keeps its focus. */
    function buildHeader() {
        const m = mode();
        const columns = m === 'columns' ? columnsNow : [];
        const key = `${m}\u0001${focus.gene}\u0001${focus.shownGene}\u0001${columns.map((c) => c.header).join('\u0002')}`;
        if (key === headerKey) return;
        headerKey = key;
        D.clear(head);
        head.append(
            el('div', { class: 'cgg-headcell', role: 'columnheader' }, 'Name'),
            el('div', { class: 'cgg-headcell cgg-num cgg-cells cgg-narrow-hide', role: 'columnheader' }, 'Cells'),
            el('div', { class: 'cgg-headcell cgg-num cgg-narrow-hide', role: 'columnheader' }, 'Share'));
        for (const c of columns) {
            head.append(el('div', { class: 'cgg-headcell cgg-num cgg-narrow-hide', role: 'columnheader', title: c.header }, c.header));
        }
        if (m === 'nogene') head.append(el('div', { class: 'cgg-headnote cgg-narrow-hide' }, 'No gene focused'));
        else if (m === 'button') {
            head.append(el('div', { class: 'cgg-headnote cgg-narrow-hide' }, el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary cgg-show',
                title: 'Compute this gene\'s statistics for every group', on: { click: pressShow } }, `Show ${focus.gene}`)));
        } else if (m === 'pending') head.append(el('div', { class: 'cgg-headnote cgg-narrow-hide' }, PENDING));
        const n = columns.length;
        template = `minmax(9rem, 1fr) 4.5rem 4rem ${n ? `repeat(${n}, minmax(7rem, 12rem))` : 'minmax(7rem, 12rem)'}`;
        grid.element.style.setProperty('--cgg-cols', template);
        grid.element.setAttribute('aria-colcount', String(3 + n));
    }

    /** The user pressed "Show <gene>": compute it for this gene now, whatever the estimate said. */
    function pressShow() {
        focus.forced = focus.gene;
        focus.blocked = false;
        focus.key = null;
        syncFocus();
    }

    function listParts(row) {
        // a click on the swatch opens the browser's color picker: the group's own color, one undo step. It is not a tab stop
        // (the grid keeps its one, the row): Enter or Space on a focused row opens it (openPicker)
        const input = el('input', { type: 'color', class: 'cgg-swatch-input', tabindex: '-1' });
        const swatch = el('span', { class: 'cgg-swatch' }, input);
        const name = el('span', { class: 'cgg-name' });
        const first = el('div', { class: 'cgg-cell cgg-cell--name', role: 'gridcell' }, swatch, name);
        const cells = el('div', { class: 'cgg-cell cgg-num cgg-cells cgg-narrow-hide', role: 'gridcell' });
        const share = el('div', { class: 'cgg-cell cgg-num cgg-share cgg-narrow-hide', role: 'gridcell' });
        row.append(first, cells, share);
        input.addEventListener('change', () => pickColor(row, input.value));
        row.addEventListener('keydown', (e) => {
            if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey) return;
            if (openPicker(row)) e.preventDefault();
        });
        return { first, swatch, input, name, cells, share, pill: null, vals: [] };
    }

    const parts = new WeakMap();

    /** The user chose a color for the group of a row: it is the group's override. */
    function pickColor(row, css) {
        const r = shownRows[Number(row.dataset.shownIndex)];
        if (!r || !r.key || typeof ctx.set !== 'function') return;
        ctx.set({ colors: withOverride(ctx.recipe(), groupId(r.key), css).colors }, `color group ${r.name}`);
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
        p.swatch.style.backgroundColor = r.color || 'transparent';
        p.swatch.hidden = !r.color;
        const input = p.input;
        input.setAttribute('aria-label', `Color of ${r.name}`);
        input.title = `Set the color of ${r.name}`;
        input.value = toHex(r.color);
        input.disabled = reasons || !r.key;
        // the row says its keys: Enter or Space opens its group's color picker
        if (input.disabled || !r.color) row.removeAttribute('aria-keyshortcuts'); else row.setAttribute('aria-keyshortcuts', 'Enter Space');
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
        const data = reasons ? { values: null, pending: false } : focusData();
        const columns = !reasons && mode() === 'columns' ? columnsNow : [];
        while (p.vals.length > columns.length) p.vals.pop().remove();
        while (p.vals.length < columns.length) {
            const cell = el('div', { class: 'cgg-cell cgg-num cgg-val cgg-narrow-hide', role: 'gridcell' });
            row.appendChild(cell);
            p.vals.push(cell);
        }
        const bits = [];
        columns.forEach((c, k) => {
            const x = data.values ? data.values[k][r.index] : NaN;
            const text = data.values ? data.formats[k](x) : (data.pending ? PENDING : DASH);
            p.vals[k].textContent = text;
            bits.push(`${c.header} ${text}`);
        });
        if (!reasons) row.title = [`${r.name}: ${fmt(r.n)} cells, ${shareText(r.share)}`, ...bits].join('; ');
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
        headerKey = null;
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
        const data = focusData();
        const columns = listColumns({ focus: data.values ? columnsNow : [] });
        download('groups.csv', listCsv({ rows: model.rows, columns, values: data.values || [] }));
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
            if (snap) syncFocus();            // decided while the groups come: the gene can ride the first request
            return;
        }
        root.hidden = false;
        // the gene must never cost the grouping its live tier: when the panel holds edits or asks first, the gene goes
        if (focus.requested && (snap.held || snap.state === 'awaiting')) { focus.blocked = true; stopAsking(); }
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
        columnsNow = focus.requested ? focusColumns({ gene: focus.shownGene, recipe, kind: focus.kind }) : [];
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
        syncFocus();
        if (gridView === 'list') buildHeader();
    }
    let gridModel = null;
    let rowsFor = { model: null, key: null };

    // ---------------------------------------------------------------------------------- life

    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver((entries) => {
            const now = !!entries[entries.length - 1].isIntersecting;
            if (now === visible) return;
            visible = now;
            if (alive) syncFocus();
        });
        observer.observe(root);
    }

    // a gene was focused somewhere: the columns follow it, or only the button's label does
    const onFocus = () => update();
    document.addEventListener('focusedGeneChanged', onFocus);

    return {
        update,
        /**
         * The panel is about to ask for its groups (a dataset is loaded): decide now whether the focused gene is cheap
         * enough to ride that request. Resolves when it is decided; the first request waits for it for a moment.
         * @returns {?Promise<void>}
         */
        prepare() {
            const recipe = ctx.recipe();
            focus.sig = sigOf(recipe);
            focus.blocked = false;
            focus.forced = null;
            focus.kindLayer = null;
            focus.waiting = false;
            stopAsking();
            const gene = currentGene();
            focus.gene = gene;
            if (gateOf({ gene, visible, blocked: false, forced: false }) !== 'estimate') return null;
            // a factor that waits on another panel (a table, a score, another grouping) is estimated once its groups are there
            if (!recipe.partitionings.every((p) => PLAIN_SOURCES.includes(p.source.type))) return null;
            focus.key = `${gene}\u0001${focus.sig}`;
            return decide(gene, recipe, ++focus.ticket);
        },
        destroy() {
            alive = false;
            document.removeEventListener('focusedGeneChanged', onFocus);
            focus.ticket++;
            if (focus.requested) ctx.setFeatures(null);
            if (observer) observer.disconnect();
            if (grid) grid.destroy();
            root.remove();
        }
    };
}

/** The part of the panel that draws the groups: `PARTS.groups` (panels/cell-grouping.js). */
export const GROUP_GRID = Object.freeze({ mount });
