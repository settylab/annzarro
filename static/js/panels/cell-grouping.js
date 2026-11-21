/**
 * Cell Grouping panel (UX 2, GRP-1 to GRP-4, GRP-7, GRP-8, GRP-10, GRP-11, GRP-13 to GRP-16, SHR-12, PER-1, PER-5).
 *
 * A grouping is a named recipe of factors that outlives its panel, as a signature does: it is its panel, open or
 * closed, and a link, a panel set and a history entry carry it as configuration only (PER-1). The recipe is
 * utils/cell-grouping.js `normalizeGrouping`'s; the panel's configuration is its title and the recipe's fields.
 *
 * Zones, top to bottom (UX 2.1): the status (panels/cell-grouping/status.js), the factors (factors.js), the groups
 * (G9c), Statistics offered (G9d), Settings (settings.js). Every edit is one undoable step. The panel watches its own
 * groups as a viewer (consumer kind `inspect`, so it is never counted as a user), through the page's group sources.
 *
 * THE PAGE'S GROUP SOURCES. `groupSources()` binds utils/group-sources.js to the page (G7b's API): one group store on
 * the cell_groups route with the page's limiter, and a host that knows the page's groupings, tables and scores. No
 * other module builds one yet: the cell-group provider (G8a, utils/cell-group-source.js) is to take this binding
 * over, with the memory guard's ledger for codes, which nothing here asks for.
 *
 * SEAMS for the steps after this one:
 *   G9b  factors.js BINNING_SLOT: the binning control mounts in a binned card.
 *   G9c  PARTS.groups: `mount(host, ctx)` draws the group grid in `.cgrp-groups`; `ctx.read()` is the panel's snapshot
 *        and `ctx.filterNoGroup` whether "in no group" is open.
 *   G9d  PARTS.statistics: the same, in `.cgrp-statistics`, with `ctx.recipe()` and `ctx.set(patch, label)` for the
 *        recipe's `offered`, `layers` and `detect_above`.
 *
 * It touches no DOM until init(): a closed grouping restored from a link or a panel set is constructed and never
 * initialized (PanelManager.registerClosedPanel), and is computed only when a dependant on screen needs it (PER-5).
 */
import { PanelManager } from '../panel-manager.js';
import { DataManager } from '../data-manager.js';
import { Config } from '../config.js';
import { Policy } from '../policy.js';
import { makeDom } from './gene-set-utilities/dom.js';
import { noDatasetScreenHtml } from '../utils/no-dataset-screen.js';
import { setControlsVisible, syncControlsWithDataset } from '../utils/controls-visibility.js';
import { UndoStack, serverRecipe, recipeHash } from '../utils/gene-signature.js';
import { normalizeGrouping, defaultLabelMaps, sourceName } from '../utils/cell-grouping.js';
import { createGroupStore } from '../utils/group-store.js';
import { createGroupSources, GROUPING } from '../utils/group-sources.js';
import { createGroupsApi } from '../utils/cell-groups-client.js';
import { pageLimiter, sourceList as scoreSources } from '../utils/score-source.js';
import { createSourceAdapter } from '../utils/score-source-panels.js';
import { registerReferences, usersOf, dependsOn } from '../utils/panel-references.js';
import { findCycle, TableResolver } from '../utils/table-resolver.js';
import { selectionOnCells } from '../utils/closed-table.js';
import { stableStringify } from '../utils/url-history.js';
import { VOCABULARY } from '../utils/vocabulary.js';
import { RESERVED } from '../utils/level-id.js';
import {
    groupingReferences, missingFactors, obsmWidth, obsmKeys, obspKeys, layerList, factorKind, columnFactor, cellNamesFactor, geneFactor,
    scoreFactor, tableFactor, groupingFactor, neighborsFactor, addFactorRefusal, cellNamesRefusal, referenceChoices, moveFactor,
    duplicateFactor, removeFactor, factorTitle, factorSummary, levelPreview, tickLevel, tickAll, tickNone, sortByCells, moveLevel,
    renameLevel, setRest, levelRows, BINNING_SLOT, PANEL_SOURCES, SCORE_SOURCE, GROUP_SOURCE, TABLE_SOURCE
} from './cell-grouping/factors.js';
import { describeStatus, smallLine, noGroupReasons, usedByText } from './cell-grouping/status.js';
import {
    settingsSummary, thresholdProblem, separatorProblem, smallOf, separatorOf, storedSeparator, storedSmall, smallModeWord
} from './cell-grouping/settings.js';

const TYPE = 'cell-grouping';
const DEFAULT_TITLE = 'Grouping 1';
/** Keys of a configuration that are the panel's own, not the recipe's. */
const PANEL_KEYS = ['id', 'title', 'controlsVisible', '_closed', 'active'];

registerReferences(TYPE, groupingReferences);

/**
 * The parts later steps draw into the panel: `{mount(host, ctx) -> {update(), destroy()}}` or null.
 * @type {{groups: ?Object, statistics: ?Object}}
 */
// export-unused-ok: G9c and G9d mount the group grid and Statistics offered here
export const PARTS = { groups: null, statistics: null };

// ================================================================================================ the page binding

const panelOf = (id) => (id ? PanelManager.getPanel(id) : null);
const typeOf = (p) => (p && typeof p.getType === 'function' ? p.getType() : null);
const isOpen = (p) => !!p && PanelManager.getActivePanels().includes(p);
const titleOfPanel = (id) => { const p = panelOf(id); return p && p.getTitle ? p.getTitle() : id; };

/** A cycle member's kind, as a notice names a ring. */
function kindOfPanel(id) {
    const type = typeOf(panelOf(id));
    if (type === 'cell-table' || type === 'gene-table') return 'table';
    if (type === TYPE) return 'grouping';
    if (type === 'gene-signature') return 'signature';
    return type || 'panel';
}

/** The ids on a cycle through `id`, each once, or null. */
function cycleIds(id) {
    const ring = findCycle(id, dependsOn);
    return ring ? [...new Set(ring)] : null;
}

const resolver = {
    need: (id, dependant) => TableResolver.need(id, dependant),
    accept: (id) => TableResolver.accept(id),
    cancel: (id) => TableResolver.cancel(id),
    retry: (id) => TableResolver.retry(id),
    cycleOf: (id) => cycleIds(id)
};

let _scoreAdapter = null;
function scoreAdapter() {
    if (!_scoreAdapter) {
        _scoreAdapter = createSourceAdapter({ panel: panelOf, active: isOpen, geneNames: () => DataManager.getGenes(), resolver });
    }
    return _scoreAdapter;
}

/** The dataset's structure, as last read (a gate is asked on every read and cannot wait for it). */
let _structure = { dataset: null, value: null };
/** The dataset's genes as a Set, made once per gene list. */
let _genes = { list: null, set: null };
function hasGene(name) {
    const list = DataManager.getGenes() || [];
    if (_genes.list !== list) _genes = { list, set: new Set(list) };
    return _genes.set.has(name);
}

/** Read the structure of the open dataset into the cache; resolves to it. */
async function loadStructure() {
    const dataset = DataManager.getCurrentDataset();
    if (!dataset || !DataManager.isDatasetLoaded()) return null;
    if (_structure.dataset === dataset && _structure.value) return _structure.value;
    const value = await DataManager.getDatasetStructure(dataset);
    _structure = { dataset, value };
    return value;
}

const gone = (message) => ({ gate: { state: 'failed', reason: 'upstream_gone', message } });

/** A hash of a table's passing rows for the cells shown: equal rows, equal hash. */
function rowsHash(entries, n) {
    let h = 2166136261 >>> 0;
    for (const i of entries) { h ^= i & 0xffff; h = Math.imul(h, 16777619) >>> 0; h ^= i >>> 16; h = Math.imul(h, 16777619) >>> 0; }
    return `${n}:${entries.length}:${h.toString(16)}`;
}

/** @type {Map<string, {hash: string, flags: Uint8Array}>} table id -> its last bitset, the same array while its hash is */
const _bitsets = new Map();
function bitsetOf(id, entries, n) {
    const hash = rowsHash(entries, n);
    const was = _bitsets.get(id);
    if (was && was.hash === hash) return was;
    const flags = new Uint8Array(n);
    for (const i of entries) if (i >= 0 && i < n) flags[i] = 1;
    const made = { hash, flags };
    _bitsets.set(id, made);
    return made;
}

/** What a table factor stands for: its passing cells shown, or the gate of its build (GRP-15). */
function tableUpstream(id, dependant) {
    const panel = panelOf(id);
    if (!panel || typeOf(panel) !== 'cell-table') return gone('the table it uses is gone');
    const cells = DataManager.getCells() || [];
    const n = cells.length;
    const actions = { accept: () => TableResolver.accept(id), cancel: () => TableResolver.cancel(id), retry: () => TableResolver.retry(id) };
    const gated = TableResolver.gate(id);
    const cfg = panel.getConfig();
    if (isOpen(panel) && !gated) {
        if (typeof panel.isReady === 'function' && !panel.isReady()) return { gate: { state: 'building', table: id }, actions };
        const entries = Array.isArray(cfg.currentEntries) ? cfg.currentEntries : [];
        return { bitset: () => bitsetOf(id, entries, n) };
    }
    // closed: by name, on the cells shown, from what it kept when it closed
    const selection = cfg.closedSelection || null;
    if (selection && Array.isArray(cells)) {
        const found = selectionOnCells(selection, cells);
        if (!found.unknown) {
            return { bitset: () => {
                const entries = [];
                cells.forEach((name, i) => { if (found.passing.has(name)) entries.push(i); });
                return bitsetOf(id, entries, n);
            } };
        }
    }
    const status = gated || TableResolver.need(id, dependant);
    if (!status || status.state === 'ready') return { gate: { state: 'building', table: id }, actions };
    if (status.state === 'missing') return gone('the table it uses is gone');
    const state = ['ask', 'refused', 'failed', 'cycle'].includes(status.state) ? status.state : 'building';
    return { gate: { ...status, state, table: id, message: status.reason && state !== 'building' ? status.reason : undefined }, actions };
}

/** What a score factor stands for: the score route's recipe, inline, or the gate of its source (a gene table). */
function scoreUpstream(source, dependant) {
    const src = scoreAdapter().get(source.key);
    if (!src) return gone("the score's signature or gene table is gone");
    const gate = src.gate(dependant);
    if (gate) return { gate: { ...gate.gate, state: gate.state, message: gate.message, table: source.key }, actions: src.actions };
    return { recipe: () => {
        const base = src.recipe();
        const scored = { ...base, method: source.column || base.method, input: source.layer || base.input };
        return { recipe: serverRecipe(scored), hash: recipeHash(scored) };
    } };
}

/** A column of the dataset that the open dataset lacks: a gate, so nothing is asked (GRP-14). */
function missingGate(source) {
    const structure = _structure.value;
    if (!structure || _structure.dataset !== DataManager.getCurrentDataset()) return null;
    const lacking = missingFactors({ partitionings: [{ source }] }, structure, { hasGene, hasPanel: () => true });
    return lacking.length
        ? { gate: { state: 'refused', reason: 'not_in_dataset', message: `${sourceName(source)} is not in this dataset` } } : null;
}

/** The title of the panel behind a source, for labels (a table's, a score's, a grouping's); undefined for a column. */
const sourceTitleOf = (source) => (PANEL_SOURCES.includes(source.type) && panelOf(source.key)
    ? titleOfPanel(source.key) : undefined);

function host() {
    return {
        source(id) {
            const p = panelOf(id);
            if (typeOf(p) !== TYPE) return null;
            return { title: p.getTitle(), kind: 'grouping', recipe: () => p.getRecipe(), shape: GROUPING };
        },
        off: () => !Policy.panelEnabled(TYPE),
        upstream(source, dependant) {
            switch (source.type) {
                case GROUP_SOURCE: return typeOf(panelOf(source.key)) === TYPE ? { grouping: source.key } : gone('the grouping it uses is gone');
                case TABLE_SOURCE: return tableUpstream(source.key, dependant);
                case SCORE_SOURCE: return scoreUpstream(source, dependant);
                default: return missingGate(source);
            }
        },
        cycleOf: cycleIds,
        titleOf: titleOfPanel,
        kindOf: kindOfPanel,
        sourceTitle: sourceTitleOf,
        onUpstreamChange(fn) {
            document.addEventListener('annzarro:table-filtered', (e) => { if (e.detail && e.detail.id) fn(e.detail.id); });
        }
    };
}

function context() {
    const cells = DataManager.getCells();
    return { dataset: DataManager.getCurrentDataset() || '', subset: DataManager.getSubsetParam(),
        cells: cells && Number.isFinite(Number(cells.length)) ? Number(cells.length) : null };
}

let _binding = null;

/**
 * The page's group store and group sources, made when first needed.
 * @returns {{store: ReturnType<typeof createGroupStore>, sources: ReturnType<typeof createGroupSources>}}
 */
// export-unused-ok: G8a's cell-group provider takes this binding over (see the header)
export function groupSources() {
    if (!_binding) {
        const store = createGroupStore({ api: createGroupsApi({ url: Config.API.CELL_GROUPS }), limiter: pageLimiter() });
        _binding = { store, sources: createGroupSources({ store, host: host(), context }) };
    }
    return _binding;
}

// ================================================================================================ the views

const W = VOCABULARY.word;
const fmt = (n) => Number(n).toLocaleString('en-US');

const ADD_ENTRIES = Object.freeze([
    { entry: 'column', label: 'Column…' },
    { entry: 'cells', label: 'Cell names' },
    { entry: 'gene', label: 'Gene…' },
    { entry: 'score', label: 'Score…' },
    { entry: 'table', label: 'Cell table…' },
    { entry: 'neighbors', label: 'Neighbors of a cell…' }
]);

/**
 * The factors zone: Add factor, its inline row, and one card per factor.
 * @param {Object} opts
 * @param {Object} opts.D - the DOM builder
 * @param {string} opts.id - the panel id (unique element ids)
 * @param {() => Object} opts.model - what to draw: {recipe, infos, labels: Map[], missing: Set, structure, cells,
 *   titleOf, choices: {groupings, tables, scores}, focusedGene, focusedCell, notes: Map(index -> text), refusal}
 * @param {Object} opts.on - what the user did: commit(partitionings, label), add(partitioning, label), announce(text)
 */
function createFactors({ D, id, model, on }) {
    const { el } = D;
    const expanded = new Set();         // indexes of expanded cards (kept by position, as the recipe is)
    const showAll = new Set();          // cards whose long level list is shown whole
    let adding = null;                  // the entry whose inline row is open
    let renaming = null;                // {index, id} of the level being renamed
    let menuOpen = false;
    let mounts = [];

    const addBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary cgrp-add',
        aria: { haspopup: 'menu', expanded: 'false', controls: `cgrp-add-menu-${id}` }, on: { click: toggleMenu } }, 'Add factor ▾');
    const menu = el('div', { class: 'cgrp-add-menu', id: `cgrp-add-menu-${id}`, role: 'menu', hidden: true, on: { keydown: onMenuKey } });
    const addWrap = el('div', { class: 'cgrp-add-wrap' }, addBtn, menu);
    const addRow = el('div', { class: 'cgrp-addrow', hidden: true });
    const list = el('ul', { class: 'cgrp-factors', role: 'list', aria: { label: VOCABULARY.plural.factor } });
    const addElement = el('div', { class: 'cgrp-addzone' }, addWrap, addRow);

    function toggleMenu() {
        menuOpen = !menuOpen;
        paintMenu();
        if (menuOpen) { const first = menu.querySelector('button:not(:disabled)'); if (first) first.focus(); }
    }

    function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        paintMenu();
    }

    function onMenuKey(e) {
        const items = [...menu.querySelectorAll('button:not(:disabled)')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { closeMenu(); addBtn.focus(); e.preventDefault(); e.stopPropagation(); }
        else if (e.key === 'ArrowDown') { (items[(i + 1) % items.length] || addBtn).focus(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { (items[(i - 1 + items.length) % items.length] || addBtn).focus(); e.preventDefault(); }
        else if (e.key === 'Tab') closeMenu();
    }

    function paintMenu() {
        const m = model();
        D.clear(menu);
        const cellsNote = cellNamesRefusal(m.cells);
        for (const { entry, label } of ADD_ENTRIES) {
            menu.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'cgrp-add-item', data: { entry },
                title: entry === 'cells' && cellsNote ? cellsNote : undefined,
                on: { click: () => openRow(entry) } }, label));
        }
        menu.hidden = !menuOpen;
        addBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    }

    // ------------------------------------------------------------------ the inline row of an entry

    function option(value, text, extra = {}) {
        const o = el('option', { value, text });
        if (extra.disabled) { o.disabled = true; o.title = extra.title || ''; }
        return o;
    }

    function select(cls, label, options) {
        return el('select', { class: `form-select form-select-sm ${cls}`, aria: { label } }, options);
    }

    function openRow(entry) {
        closeMenu();
        adding = entry;
        paintRow();
    }

    function closeRow() {
        adding = null;
        paintRow();
        addBtn.focus();
    }

    function paintRow() {
        D.clear(addRow);
        addRow.hidden = !adding;
        if (!adding) return;
        const m = model();
        const s = m.structure || {};
        const note = el('div', { class: 'cgrp-addrow__note', role: 'status' });
        const ok = el('button', { type: 'button', class: 'btn btn-sm btn-primary cgrp-addrow__ok' }, 'Add');
        const cancel = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-addrow__cancel', on: { click: closeRow } }, 'Cancel');
        const parts = [];
        let make = null;
        let validate = () => null;
        if (adding === 'column') {
            const type = select('cgrp-addrow__type', 'Source type', [option('obs', 'obs'), option('obsm', 'obsm')]);
            const key = select('cgrp-addrow__key', 'Column', []);
            const column = select('cgrp-addrow__column', 'Dimension', []);
            const fill = () => {
                D.clear(key);
                if (type.value === 'obs') {
                    const index = (s.obs && s.obs.index) || '_index';
                    for (const c of ((s.obs && s.obs.columns) || []).filter((c) => c !== '_index' && c !== index)) key.appendChild(option(c, c));
                    const groupings = referenceChoices(m.self, m.choices.groupings);
                    if (groupings.length) {
                        const og = el('optgroup', { label: 'Groupings' });
                        for (const g of groupings) og.appendChild(option(`${GROUP_SOURCE}:${g.id}`, g.title, { disabled: g.disabled, title: g.reason }));
                        key.appendChild(og);
                    }
                } else {
                    for (const k of obsmKeys(s)) key.appendChild(option(k, k));
                }
                fillColumn();
            };
            const fillColumn = () => {
                D.clear(column);
                column.hidden = type.value !== 'obsm';
                if (type.value !== 'obsm') return;
                const width = obsmWidth(s, key.value) || 0;
                for (let i = 0; i < width; i++) column.appendChild(option(String(i), String(i)));
            };
            type.addEventListener('change', fill);
            key.addEventListener('change', fillColumn);
            fill();
            parts.push(type, key, column);
            make = () => {
                if (key.value.startsWith(`${GROUP_SOURCE}:`)) {
                    const pid = key.value.slice(GROUP_SOURCE.length + 1);
                    return { p: groupingFactor(pid), label: `add factor ${m.titleOf({ type: GROUP_SOURCE, key: pid }) || pid}` };
                }
                const p = columnFactor(s, type.value, key.value, column.value);
                return { p, label: `add factor ${factorTitle(p, m.titleOf)}` };
            };
            validate = () => (key.value ? null : 'Choose a column.');
        } else if (adding === 'cells') {
            parts.push(el('span', { class: 'cgrp-addrow__fixed', text: 'obs index' }));
            make = () => ({ p: cellNamesFactor(s), label: 'add factor cell names' });
            validate = () => cellNamesRefusal(m.cells);
        } else if (adding === 'gene') {
            const layer = select('cgrp-addrow__key', 'Layer', ['X', ...layerList(s)].map((l) => option(l, l)));
            const gene = el('input', { type: 'text', class: 'form-control form-control-sm cgrp-addrow__gene', placeholder: 'Gene',
                autocomplete: 'off', spellcheck: 'false', aria: { label: 'Gene' } });
            parts.push(layer, gene);
            if (m.focusedGene) {
                parts.push(el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-addrow__focused',
                    on: { click: () => { gene.value = m.focusedGene; } } }, `Use focused gene ${m.focusedGene}`));
            }
            make = () => ({ p: geneFactor(layer.value, gene.value.trim()), label: `add factor ${gene.value.trim()}` });
            validate = () => (!gene.value.trim() ? 'Type a gene.' : m.hasGene(gene.value.trim()) ? null : `${gene.value.trim()} is not in this dataset.`);
        } else if (adding === 'score') {
            const scores = referenceChoices(m.self, m.choices.scores);
            const src = select('cgrp-addrow__key', 'Score', scores.map((c) => option(c.id, c.title, { disabled: c.disabled, title: c.reason })));
            const opt = select('cgrp-addrow__column', 'Score option', []);
            const fillOpt = () => {
                D.clear(opt);
                const found = m.choices.scores.find((c) => c.id === src.value);
                for (const o of (found && found.options) || []) opt.appendChild(option(`${o.method}\u0001${o.layer}`, o.label));
            };
            src.addEventListener('change', fillOpt);
            const first = scores.find((c) => !c.disabled);
            if (first) src.value = first.id;
            fillOpt();
            parts.push(src, opt);
            make = () => {
                const [method, layer] = opt.value.split('\u0001');
                return { p: scoreFactor(src.value, method, layer), label: `add factor ${m.titleOf({ type: SCORE_SOURCE, key: src.value }) || src.value}` };
            };
            validate = () => (!scores.length ? 'There is no gene signature or gene table to score.'
                : !src.value || (src.selectedOptions[0] && src.selectedOptions[0].disabled) ? 'Choose a score.' : !opt.value ? 'This source offers no score option.' : null);
        } else if (adding === 'table') {
            const tables = referenceChoices(m.self, m.choices.tables);
            const src = select('cgrp-addrow__key', 'Cell table', tables.map((c) => option(c.id, c.title, { disabled: c.disabled, title: c.reason })));
            const first = tables.find((c) => !c.disabled);
            if (first) src.value = first.id;
            parts.push(src);
            make = () => ({ p: tableFactor(src.value), label: `add factor in ${m.titleOf({ type: TABLE_SOURCE, key: src.value }) || src.value}` });
            validate = () => (!tables.length ? 'There is no cell table.'
                : !src.value || (src.selectedOptions[0] && src.selectedOptions[0].disabled) ? 'Choose a table.' : null);
        } else if (adding === 'neighbors') {
            const key = select('cgrp-addrow__key', 'Matrix', [...obspKeys(s)].map((k) => option(k, k)));
            const cell = el('input', { type: 'text', class: 'form-control form-control-sm cgrp-addrow__gene', placeholder: 'Cell',
                autocomplete: 'off', spellcheck: 'false', aria: { label: 'Cell' } });
            parts.push(key, cell);
            if (m.focusedCell) {
                parts.push(el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-addrow__focused',
                    on: { click: () => { cell.value = m.focusedCell; } } }, 'Use focused cell'));
            }
            make = () => ({ p: neighborsFactor(key.value, cell.value.trim()), label: `add factor neighbors of ${cell.value.trim()}` });
            validate = () => (!key.value ? 'This dataset has no obsp matrix.' : !cell.value.trim() ? 'Type a cell.' : null);
        }
        const refusal = addFactorRefusal(m.recipe);
        ok.addEventListener('click', () => {
            const why = refusal || validate();
            note.textContent = why || '';
            if (why) return;
            const { p, label } = make();
            adding = null;
            paintRow();
            on.add(p, label);
        });
        addRow.append(el('div', { class: 'cgrp-addrow__controls' }, ...parts, ok, cancel), note);
        addRow.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRow(); } });
        const firstControl = addRow.querySelector('select, input');
        if (firstControl) firstControl.focus();
    }

    // ------------------------------------------------------------------ the cards

    function commitFactor(i, p, label) {
        const list = [...model().recipe.partitionings];
        list[i] = p;
        on.commit(list, label);
    }

    function moveTo(i, j, name) {
        const n = model().recipe.partitionings.length;
        if (j < 0 || j >= n) return;
        const wasOpen = expanded.has(i);
        expanded.delete(i);
        if (expanded.has(j)) { expanded.delete(j); expanded.add(i); }
        if (wasOpen) expanded.add(j);
        on.commit(moveFactor(model().recipe.partitionings, i, j), `move factor ${name}`);
        on.announce(`${name} moved to position ${j + 1} of ${n}`);
        const head = list.querySelector(`.cgrp-card[data-index="${j}"] .cgrp-card__head`);
        if (head) head.focus();
    }

    function cardMenu(i, name, n, kind) {
        const items = [
            ['up', 'Move up', i === 0], ['down', 'Move down', i === n - 1], ['duplicate', 'Duplicate', !!addFactorRefusal(model().recipe)],
            ...(kind === 'categorical' || kind === 'table' ? [['rename', 'Rename levels…', false]] : []), ['remove', 'Remove', false]
        ];
        const pop = el('div', { class: 'cgrp-card__menu', role: 'menu', hidden: true });
        const btn = el('button', { type: 'button', class: 'btn btn-sm btn-link cgrp-card__more', aria: { haspopup: 'menu', expanded: 'false',
            label: `More for ${name}` }, on: { click: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); } } }, '⋯');
        for (const [op, label, disabled] of items) {
            pop.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'cgrp-card__op', data: { op }, disabled,
                on: { click: (e) => { e.stopPropagation(); pop.hidden = true; runOp(op, i, name); } } }, label));
        }
        pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.hidden = true; btn.focus(); e.stopPropagation(); } });
        return el('span', { class: 'cgrp-card__menu-wrap' }, btn, pop);
    }

    function runOp(op, i, name) {
        const ps = model().recipe.partitionings;
        if (op === 'up') moveTo(i, i - 1, name);
        else if (op === 'down') moveTo(i, i + 1, name);
        else if (op === 'duplicate') on.commit(duplicateFactor(ps, i), `duplicate factor ${name}`);
        else if (op === 'remove') {
            const kept = new Set([...expanded].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
            expanded.clear();
            for (const k of kept) expanded.add(k);
            on.commit(removeFactor(ps, i), `remove factor ${name}`, { said: `Removed ${W.factor} ${name}.` });
        } else if (op === 'rename') {
            expanded.add(i);
            paint();
            const first = list.querySelector(`.cgrp-card[data-index="${i}"] .cgrp-level__rename`);
            if (first) first.focus();
        }
    }

    function levelList(i, p, info, defaults) {
        const rows = levelRows(p, info, defaults);
        const total = rows.length;
        const LONG = 50;
        const cut = !showAll.has(i) && total > LONG;
        const ul = el('ul', { class: 'cgrp-levels', role: 'list', aria: { label: VOCABULARY.plural.level } });
        for (const r of cut ? rows.slice(0, LONG) : rows) ul.appendChild(levelRow(i, p, info, r));
        const out = [ul];
        if (cut) {
            out.push(el('button', { type: 'button', class: 'btn btn-sm btn-link cgrp-levels__more',
                on: { click: () => { showAll.add(i); paint(); } } }, `… ${fmt(total - LONG)} more`));
        }
        return out;
    }

    function levelRow(i, p, info, r) {
        const count = el('span', { class: 'cgrp-level__n', text: r.n === null ? '' : fmt(r.n) });
        const label = el('span', { class: 'cgrp-level__label', text: r.label, title: r.was ? `Was: ${r.was}` : undefined });
        const li = el('li', { class: 'cgrp-level', data: { id: r.id } });
        if (renaming && renaming.index === i && renaming.id === r.id) {
            const input = el('input', { type: 'text', class: 'form-control form-control-sm cgrp-level__name', value: r.label,
                aria: { label: `New name for ${r.label}` } });
            const done = (keep) => {
                const text = input.value;
                renaming = null;
                if (keep) commitFactor(i, renameLevel(p, r.id, text, defaultsOf(i).get(r.id)), `rename level ${r.was || r.label}`);
                else paint();
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); done(true); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
            });
            li.append(input, count);
            setTimeout(() => { input.focus(); input.select(); }, 0);
            return li;
        }
        if (r.tickable) {
            const box = el('input', { type: 'checkbox', checked: r.ticked, aria: { label: r.label } });
            box.addEventListener('change', () => commitFactor(i, tickLevel(p, info, r.id, box.checked), `${box.checked ? 'tick' : 'untick'} ${r.label}`));
            box.addEventListener('keydown', (e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !r.ticked) return;
                e.preventDefault();
                commitFactor(i, moveLevel(p, info, r.id, e.key === 'ArrowUp' ? -1 : 1), `move level ${r.label}`);
                on.announce(`${r.label} moved`);
            });
            li.append(el('label', { class: 'cgrp-level__tick' }, box, label));
        } else {
            li.append(label);
        }
        li.append(count);
        if (r.tickable || r.id === RESERVED.other || r.id === RESERVED.na || factorKind(p) === 'table') {
            li.append(el('button', { type: 'button', class: 'btn btn-sm btn-link cgrp-level__rename', title: `Rename ${r.label}`,
                aria: { label: `Rename ${r.label}` }, on: { click: () => { renaming = { index: i, id: r.id }; paint(); } } }, '✎'));
        }
        return li;
    }

    function defaultsOf(i) {
        return model().labels[i] || new Map();
    }

    function categoricalBody(i, p, info) {
        const defaults = defaultsOf(i);
        if (!info) return [el('div', { class: 'cgrp-card__wait', text: 'Levels follow once the groups are computed.' })];
        const name = factorTitle(p, model().titleOf);
        const restName = `cgrp-rest-${id}-${i}`;
        const rest = (value, text) => el('label', { class: 'cgrp-rest-opt' },
            el('input', { type: 'radio', class: 'cgrp-rest', name: restName, value, checked: (p.rest === 'exclude') === (value === 'exclude'),
                on: { change: () => commitFactor(i, setRest(p, value), value === 'exclude' ? 'leave unticked levels out' : 'group unticked levels') } }), ` ${text}`);
        return [
            el('div', { class: 'cgrp-levels__head' }, el('span', { text: 'Levels' }), el('span', { class: 'cgrp-levels__cells', text: 'cells' })),
            ...levelList(i, p, info, defaults),
            el('div', { class: 'cgrp-rest-row', role: 'radiogroup', aria: { label: 'Unticked levels' } },
                el('span', { text: 'Unticked levels ' }), rest('other', `Group as '${VOCABULARY.phrase.other(name)}'`), rest('exclude', 'Leave out of all groups')),
            el('div', { class: 'cgrp-levels__actions' },
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', on: { click: () => commitFactor(i, tickAll(p), 'tick all levels') } }, 'Tick all'),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', on: { click: () => commitFactor(i, tickNone(p, info), 'tick no level') } }, 'Tick none'),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', on: { click: () => commitFactor(i, sortByCells(p, info), 'sort levels by cells') } }, 'Sort by cells'))
        ];
    }

    function tableBody(i, p, info) {
        const m = model();
        const title = m.titleOf(p.source) || p.source.key;
        const defaults = defaultsOf(i);
        const rows = info ? levelRows(p, info, defaults) : [];
        const keep = el('input', { type: 'checkbox', class: 'cgrp-keepout', checked: p.rest !== 'exclude',
            on: { change: () => commitFactor(i, setRest(p, keep.checked ? 'other' : 'exclude'), keep.checked ? 'keep cells not in the table' : 'leave cells not in the table out') } });
        return [
            el('ul', { class: 'cgrp-levels', role: 'list' }, rows.map((r) => levelRow(i, p, info, r))),
            el('label', { class: 'cgrp-keepout-row' }, keep, ` Keep cells ${VOCABULARY.phrase.notInTable(title)} as a ${W.level}`),
            el('div', { class: 'cgrp-card__follows' }, `Follows the table's filter. `,
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-open', on: { click: () => on.open(p.source.key) } }, 'Open table'))
        ];
    }

    function binnedBody(i, p, info) {
        const host = el('div', { class: 'cgrp-binning' });
        if (BINNING_SLOT.mount) {
            mounts.push(BINNING_SLOT.mount(host, { partitioning: p, info, commit: (next, label) => commitFactor(i, next, label) }));
            return [host];
        }
        const defaults = defaultsOf(i);
        const rows = info ? levelRows(p, info, defaults) : [];
        return [host, el('ul', { class: 'cgrp-levels cgrp-bins', role: 'list' }, rows.map((r) => levelRow(i, p, info, r)))];
    }

    function card(i, p, n) {
        const m = model();
        const info = m.infos[i] || null;
        const missing = m.missing.has(i);
        const kind = factorKind(p);
        const name = factorTitle(p, m.titleOf);
        const open = expanded.has(i);
        const head = el('button', { type: 'button', class: 'cgrp-card__head', aria: { expanded: String(open), controls: `cgrp-card-${id}-${i}` },
            on: { click: () => { if (expanded.has(i)) expanded.delete(i); else expanded.add(i); paint(); },
                keydown: (e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    moveTo(i, i + (e.key === 'ArrowUp' ? -1 : 1), name);
                } } },
        el('span', { class: 'cgrp-card__grip', aria: { hidden: 'true' }, text: '≡' }),
        el('span', { class: 'cgrp-card__pos', text: String(i + 1) }),
        el('span', { class: 'cgrp-card__title', text: factorTitle(p, m.titleOf, missing) }),
        el('span', { class: 'cgrp-card__summary', text: factorSummary(p, info) }),
        open ? null : el('span', { class: 'cgrp-card__preview', text: levelPreview(info, mergedLabels(p, i)) }),
        el('span', { class: 'cgrp-card__chev', aria: { hidden: 'true' }, text: open ? '^' : 'v' }));
        const note = m.notes.get(i) || (missing ? 'Replace or remove it: nothing is computed until then.' : '');
        const li = el('li', { class: `cgrp-card${missing ? ' is-missing' : ''}`, data: { index: i, kind }, draggable: 'true' },
            el('div', { class: 'cgrp-card__bar' }, head, cardMenu(i, name, n, kind)),
            el('div', { class: 'cgrp-card__note', role: 'note', hidden: !note, text: note }));
        if (open) {
            const body = el('div', { class: 'cgrp-card__body', id: `cgrp-card-${id}-${i}` });
            body.append(...(kind === 'categorical' || kind === 'grouping' ? categoricalBody(i, p, info)
                : kind === 'table' ? tableBody(i, p, info) : binnedBody(i, p, info)));
            li.append(body);
        }
        li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-cgrp-factor', String(i)); e.dataTransfer.effectAllowed = 'move'; });
        li.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-cgrp-factor')) e.preventDefault(); });
        li.addEventListener('drop', (e) => {
            const from = Number(e.dataTransfer.getData('text/x-cgrp-factor'));
            if (!Number.isInteger(from) || from === i) return;
            e.preventDefault();
            moveTo(from, i, factorTitle(model().recipe.partitionings[from], model().titleOf));
        });
        return li;
    }

    /** The labels a card shows: the user's renames over the defaults. */
    function mergedLabels(p, i) {
        const out = new Map(defaultsOf(i));
        for (const [k, v] of Object.entries(p.labels || {})) out.set(k, v);
        return out;
    }

    function paint() {
        for (const mounted of mounts) if (mounted && mounted.destroy) mounted.destroy();
        mounts = [];
        const m = model();
        const n = m.recipe.partitionings.length;
        for (const k of [...expanded]) if (k >= n) expanded.delete(k);
        const refusal = addFactorRefusal(m.recipe);
        addBtn.disabled = !!refusal;
        addBtn.title = refusal || '';
        D.clear(list);
        m.recipe.partitionings.forEach((p, i) => list.appendChild(card(i, p, n)));
        list.hidden = !n;
        if (menuOpen) paintMenu();
    }

    return {
        /** Add factor and its inline row: hidden with the controls. */
        addElement,
        /** The cards: they stay, collapsed, when the controls are hidden. */
        listElement: list,
        paint,
        /** Expand a card (a status action: "Choose levels of sample"). */
        expand(i) {
            expanded.add(i);
            paint();
            const head = list.querySelector(`.cgrp-card[data-index="${i}"] .cgrp-card__head`);
            if (head) head.focus();
        },
        closeMenus() {
            closeMenu();
            for (const pop of list.querySelectorAll('.cgrp-card__menu')) pop.hidden = true;
        },
        destroy() {
            for (const mounted of mounts) if (mounted && mounted.destroy) mounted.destroy();
            mounts = [];
        }
    };
}

/**
 * @param {{D: Object, id: string, on: {action: (id: string) => void}}} opts
 */
function createStatus({ D, id, on }) {
    const { el } = D;
    const text = el('span', { class: 'cgrp-status__text' });
    const noGroup = el('button', { type: 'button', class: 'btn btn-sm btn-link cgrp-nogroup', hidden: true,
        aria: { expanded: 'false', controls: `cgrp-reasons-${id}` }, on: { click: toggleReasons } });
    const actions = el('span', { class: 'cgrp-status__actions' });
    const usedBy = el('span', { class: 'cgrp-usedby', hidden: true });
    const small = el('div', { class: 'cgrp-small', hidden: true });
    const reasons = el('ul', { class: 'cgrp-reasons', id: `cgrp-reasons-${id}`, hidden: true });
    const element = el('div', { class: 'cgrp-status', role: 'region', aria: { label: 'Groups', live: 'polite' } },
        el('div', { class: 'cgrp-status__row' }, text, noGroup, actions, usedBy), small, reasons);
    let lastReasons = [];

    function toggleReasons() {
        const open = reasons.hidden;
        reasons.hidden = !open;
        noGroup.setAttribute('aria-expanded', String(open));
        // SEAM (G9c): the group grid filters to the cells in no group while this is open
    }

    /**
     * @param {ReturnType<typeof describeStatus>} desc
     * @param {{small?: ?string, reasons?: string[], usedBy?: string}} extra
     */
    function paint(desc, extra = {}) {
        element.dataset.state = desc.state;
        text.textContent = desc.text;
        D.clear(actions);
        for (const a of desc.actions) {
            actions.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary cgrp-action', data: { action: a.id },
                on: { click: () => on.action(a.id) } }, a.label));
        }
        const n = desc.noGroup || 0;
        noGroup.hidden = !n;
        if (n) noGroup.textContent = `${fmt(n)} in no ${W.group}`;
        if (!n) { reasons.hidden = true; noGroup.setAttribute('aria-expanded', 'false'); }
        lastReasons = extra.reasons || [];
        D.clear(reasons);
        for (const r of lastReasons) reasons.appendChild(el('li', { text: r }));
        small.hidden = !extra.small;
        small.textContent = extra.small || '';
        usedBy.hidden = !extra.usedBy;
        usedBy.textContent = extra.usedBy || '';
    }

    return { element, paint };
}

/**
 * @param {{D: Object, id: string, recipe: () => Object, set: (patch: Object, label: string) => void}} opts
 *   `set` takes `{separator}` or `{small}` with the defaults left out (the recipe's normaliser drops them)
 */
function createSettings({ D, id, recipe, set }) {
    const { el } = D;
    let open = false;
    const summary = el('span', { class: 'cgrp-settings__summary' });
    const head = el('button', { type: 'button', class: 'cgrp-settings__head', aria: { expanded: 'false', controls: `cgrp-settings-${id}` },
        on: { click: () => { open = !open; paint(); } } }, el('span', { class: 'cgrp-settings__chev', aria: { hidden: 'true' } }), 'Settings ', summary);
    const problem = el('div', { class: 'cgrp-settings__problem', role: 'status' });
    const separator = el('input', { type: 'text', class: 'form-control form-control-sm cgrp-separator', id: `cgrp-sep-${id}`,
        autocomplete: 'off', spellcheck: 'false', size: '4' });
    const threshold = el('input', { type: 'text', inputmode: 'numeric', class: 'form-control form-control-sm cgrp-threshold', id: `cgrp-thr-${id}`,
        autocomplete: 'off', size: '4' });
    const modeName = `cgrp-small-${id}`;
    const modes = {};
    const radio = (value) => (modes[value] = el('input', { type: 'radio', class: 'cgrp-smallmode', name: modeName, value,
        on: { change: () => setSmall({ mode: value }, `small groups ${smallModeWord(value)}`) } }));
    const collectText = el('span');
    const body = el('div', { class: 'cgrp-settings__body', id: `cgrp-settings-${id}`, hidden: true },
        el('div', { class: 'cgrp-settings__line' }, el('label', { for: `cgrp-sep-${id}`, text: 'Separator ' }), separator),
        el('div', { class: 'cgrp-settings__line' }, el('label', { for: `cgrp-thr-${id}`, text: 'Small groups under ' }), threshold, el('span', { text: ' cells' })),
        el('div', { class: 'cgrp-settings__line', role: 'radiogroup', aria: { label: 'Small groups' } },
            el('label', { class: 'cgrp-smallmode-opt' }, radio('keep'), ' Keep'),
            el('label', { class: 'cgrp-smallmode-opt' }, radio('collect'), ' Collect into ', collectText),
            el('label', { class: 'cgrp-smallmode-opt' }, radio('hide'), ` Hide: their cells go in no ${VOCABULARY.word.group}`)),
        problem);
    const element = el('div', { class: 'cgrp-settings' }, head, body);

    function setSmall(patch, label) {
        set({ small: storedSmall({ ...smallOf(recipe()), ...patch }) }, label);
    }

    function commitThreshold() {
        const why = thresholdProblem(threshold.value);
        problem.textContent = why || '';
        if (why) { threshold.value = String(smallOf(recipe()).threshold); return; }
        const n = Number(threshold.value.trim());
        if (n !== smallOf(recipe()).threshold) setSmall({ threshold: n }, `small groups under ${n} cells`);
    }

    function commitSeparator() {
        const why = separatorProblem(separator.value);
        problem.textContent = why || '';
        const now = separatorOf(recipe());
        if (why) { separator.value = now; return; }
        if (separator.value !== now) set({ separator: storedSeparator(separator.value) }, 'change the separator');
    }

    const onKey = (commit) => (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
    threshold.addEventListener('keydown', onKey(commitThreshold));
    threshold.addEventListener('change', commitThreshold);
    separator.addEventListener('keydown', onKey(commitSeparator));
    separator.addEventListener('change', commitSeparator);

    function paint() {
        const r = recipe();
        const small = smallOf(r);
        summary.textContent = settingsSummary(r);
        head.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        if (document.activeElement !== separator) separator.value = separatorOf(r);
        if (document.activeElement !== threshold) threshold.value = String(small.threshold);
        collectText.textContent = `"${VOCABULARY.phrase.smallGroups(small.threshold)}"`;
        for (const [value, input] of Object.entries(modes)) input.checked = value === small.mode;
    }

    return { element, paint };
}

// ================================================================================================ the panel

const factorBody = (p) => stableStringify({ source: p.source, levels: p.levels || null, rest: p.rest || 'other', binning: p.binning || null });

(function () {
    /**
     * @param {HTMLElement} container
     * @param {Object} options - a saved configuration
     */
    function CellGroupingPanel(container, options = {}) {
        const _id = options.id || `${TYPE}-${Date.now()}`;
        let _title = options.title || DEFAULT_TITLE;
        let _controlsVisible = options.controlsVisible;
        let _recipe = recipeFrom(options);
        const _undo = new UndoStack();

        // derived, never saved
        let _initialized = false;
        let _dom = null;
        let D = null;
        let _handle = null;
        let _snap = null;
        let _visible = true;
        let _observer = null;
        let _missing = [];
        let _message = { text: '', undo: false };
        /** store key -> the recipe that made its groups (the applied one when the key was first read) */
        const _made = new Map();
        let _lastKey = null;
        /** What the cards were last drawn from: they are drawn again only when one of these changes, never per frame */
        let _drawn = null;
        let _usedBy = '';
        let _usedTimer = null;
        let _factors = null;
        let _status = null;
        let _settings = null;
        const _parts = [];
        const _listeners = [];

        function recipeFrom(raw) {
            const fields = {};
            for (const [k, v] of Object.entries(raw || {})) if (!PANEL_KEYS.includes(k)) fields[k] = v;
            return normalizeGrouping(fields).recipe;
        }

        // ---------------------------------------------------------------- life cycle

        function init() {
            D = makeDom(document);
            _initialized = true;
            buildDom();
            listen(document, 'click', (e) => { if (_dom && !e.target.closest(`.tile[data-tile-id="${CSS.escape(_id)}"]`)) _factors.closeMenus(); });
            // a table's filter column or a plot's grouping chosen somewhere: who uses this grouping may have changed
            listen(document, 'change', (e) => { if (e.target && e.target.tagName === 'SELECT') laterUsedBy(); });
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            if (typeof IntersectionObserver !== 'undefined') {
                _observer = new IntersectionObserver((entries) => {
                    const now = !!entries[entries.length - 1].isIntersecting;
                    if (now === _visible) return;
                    _visible = now;
                    groupSources().sources.visibilityChanged();
                });
                _observer.observe(_dom.root);
            }
            repaint();
            return loaded ? datasetReady() : undefined;
        }

        async function datasetReady() {
            try { await loadStructure(); } catch (error) { console.error(`Cell grouping ${_id}:`, error); }
            if (!_initialized) return;
            checkMissing();
            watch();
            groupSources().sources.recheck();
            refresh();
        }

        /** Read the handle again (a gate that changed without a store event: the structure came) and paint. */
        function refresh() {
            if (_handle) { _snap = _handle.read(); noteKey(_snap); }
            paint();
        }

        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            _listeners.push([target, type, fn]);
        }

        /** Drop the DOM, the listeners and the handle. The recipe stays: a closed grouping is still a grouping. */
        function cleanup() {
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            clearTimeout(_usedTimer);
            release();
            if (_observer) _observer.disconnect();
            _observer = null;
            for (const part of _parts.splice(0)) if (part && part.destroy) part.destroy();
            if (_factors) _factors.destroy();
            _factors = _status = _settings = null;
            _initialized = false;
            _dom = null;
            container.innerHTML = '';
        }

        // ---------------------------------------------------------------- the groups

        /** Watch the grouping's own groups while it has a factor; an empty grouping asks for nothing. */
        function watch() {
            if (!_initialized || !DataManager.isDatasetLoaded()) return;
            if (!_recipe.partitionings.length) { release(); return; }
            if (_handle) return;
            _handle = groupSources().sources.watch(_id, {
                consumer: { kind: 'inspect', panelId: _id, role: 'panel' }, option: {},
                visible: () => _visible && !!_dom && _dom.root.isConnected,
                onChange: (snap) => { _snap = snap; noteKey(snap); paint(); }
            });
            _snap = _handle.read();
            noteKey(_snap);
        }

        function release() {
            if (_handle) _handle.release();
            _handle = null;
            _snap = null;
            _lastKey = null;
        }

        /**
         * A key first read is the applied recipe's: the derived sources apply an edit and tell the handle at once, so
         * the recipe now is the one that made it, unless edits are waiting (a new subset, read with the old recipe).
         */
        function noteKey(snap) {
            const key = snap && (snap.shownKey || snap.key);
            if (!key || key === _lastKey) return;
            if (!_made.has(key)) {
                const st = groupSources().sources.status(_id);
                _made.set(key, (st.held || st.checking) && _lastKey && _made.has(_lastKey) ? _made.get(_lastKey) : _recipe);
                if (_made.size > 20) _made.delete(_made.keys().next().value);
            }
            _lastKey = key;
        }

        /** The reply shown, the recipe that made it, and for each factor of the recipe now its partitioning of the reply. */
        function shown() {
            const snap = _snap;
            const reply = snap && snap.values && snap.values.reply;
            if (!reply) return null;
            const made = _made.get(snap.shownKey || snap.key) || _recipe;
            const reading = groupSources().sources.replyOf(_id, reply);
            const named = { ...made, partitionings: made.partitionings.map((p) => {
                const live = _recipe.partitionings.find((q) => factorBody(q) === factorBody(p));
                return live && live.labels ? { ...p, labels: live.labels } : p;
            }) };
            const defaults = defaultLabelMaps(named, reading, sourceTitle);
            const used = new Set();
            const index = _recipe.partitionings.map((p) => {
                const j = made.partitionings.findIndex((q, k) => !used.has(k) && factorBody(q) === factorBody(p));
                if (j >= 0) used.add(j);
                return j;
            });
            return { reply, reading, made, index, defaults };
        }

        const sourceTitle = sourceTitleOf;

        function nameOf(i) {
            const p = _recipe.partitionings[i];
            return p ? sourceName(p.source, sourceTitle) : '';
        }

        // ---------------------------------------------------------------- the recipe

        function getRecipe() { return _recipe; }

        /** The saved configuration: the title, the recipe and the panel's own page state. */
        function getConfig() {
            const cfg = { title: _title, ..._recipe };
            if (_controlsVisible !== undefined) cfg.controlsVisible = _controlsVisible;
            return cfg;
        }

        /**
         * One undoable step: the recipe becomes `next`. A step that closes a loop is marked, so the cycle state offers
         * Undo (operator decision 16).
         */
        function commit(next, label, { said = '' } = {}) {
            const before = _recipe;
            const looped = !!cycleIds(_id);
            _undo.push(label, [JSON.stringify(before)]);
            _recipe = normalizeGrouping(next).recipe;
            const step = _undo.peek();
            if (step) step.closesLoop = !looped && !!cycleIds(_id);
            _message = { text: said, undo: !!said };
            changed();
        }

        /** Set fields of the recipe (Settings, Statistics offered) as one step. */
        function setFields(patch, label) {
            const next = { ..._recipe };
            for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
            commit(next, label);
        }

        function undo() {
            const step = _undo.pop();
            if (!step) return false;
            _recipe = normalizeGrouping(JSON.parse(step.before[0])).recipe;
            _message = { text: `Undone: ${step.label}.`, undo: false };
            changed();
            return true;
        }

        /** The recipe changed: its consumers, its own groups, the saved state and the history hear it. */
        function changed() {
            checkMissing();
            watch();
            groupSources().sources.sourceChanged(_id);
            paint();
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        /** Add a factor as one step (Add factor, and the panel's API). */
        function addFactor(partitioning, label) {
            const p = normalizeGrouping({ partitionings: [partitioning] }).recipe.partitionings[0];
            if (!p) return false;
            commit({ ..._recipe, partitionings: [..._recipe.partitionings, p] }, label || `add factor ${sourceName(p.source, sourceTitle)}`);
            return true;
        }

        function updateConfig(config) {
            if (!config) return;
            if (config.title && config.title !== _title) { _title = config.title; groupSources().sources.sourceChanged(_id); paint(); }
            if (config.controlsVisible !== undefined) {
                _controlsVisible = config.controlsVisible;
                showControls();
            }
            const keys = Object.keys(config).filter((k) => !PANEL_KEYS.includes(k));
            if (!keys.length) return;
            // Back and Forward give a whole configuration (it has the version); a remap gives the fields it rewrote.
            // Either way the recipe as saved, with no undo step
            _recipe = recipeFrom('version' in config ? config : { ..._recipe, ...config });
            if (_initialized) changed();
        }

        function checkMissing() {
            const structure = _structure.dataset === DataManager.getCurrentDataset() ? _structure.value : null;
            _missing = structure ? missingFactors(_recipe, structure, { hasGene, hasPanel: (id) => !!panelOf(id) }) : [];
        }

        // ---------------------------------------------------------------- DOM

        function buildDom() {
            const { el } = D;
            const root = el('div', { class: 'cgrp-panel', data: { panelId: _id } });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            _status = createStatus({ D, id: _id, on: { action: onAction } });
            _factors = createFactors({ D, id: _id, model: factorsModel, on: {
                commit: (list, label, opts) => commit({ ..._recipe, partitionings: list }, label, opts),
                add: (p, label) => addFactor(p, label),
                announce: (text) => say(text),
                open: openPanel
            } });
            _settings = createSettings({ D, id: _id, recipe: () => _recipe, set: setFields });
            const undoBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-undo', disabled: true, on: { click: () => undo() } }, 'Undo');
            const empty = el('div', { class: 'cgrp-empty', hidden: true },
                el('p', { class: 'cgrp-empty__lead', text: `Add a ${VOCABULARY.word.factor} to divide the cells into ${VOCABULARY.plural.group}.` }),
                el('p', { class: 'cgrp-empty__help', text: `A ${VOCABULARY.word.factor} is a column, a gene in bins, a score in bins or a cell table. `
                    + `${VOCABULARY.plural.group[0].toUpperCase()}${VOCABULARY.plural.group.slice(1)} are the combinations of its ${VOCABULARY.plural.level}.` }));
            const messageText = el('span', { class: 'cgrp-message__text' });
            const messageUndo = el('button', { type: 'button', class: 'btn btn-sm btn-link cgrp-message__undo', hidden: true, on: { click: () => undo() } }, 'Undo');
            const message = el('div', { class: 'cgrp-message', role: 'status', aria: { live: 'polite' } }, messageText, messageUndo);
            // what Toggle Controls hides (UX 2.1): Add factor here, and the Settings row below
            const controls = el('div', { class: 'cgrp-controls', 'data-panel-controls': '' }, _factors.addElement, undoBtn);
            const groups = el('div', { class: 'cgrp-groups' });
            const statistics = el('div', { class: 'cgrp-statistics' });
            const settings = el('div', { class: 'cgrp-settings-zone' }, _settings.element);
            root.append(_status.element, empty, controls, message, _factors.listElement, groups, statistics, settings);
            root.addEventListener('keydown', onKey);
            container.innerHTML = '';
            container.appendChild(root);
            _dom = { root, controls, undoBtn, empty, message, messageText, messageUndo, groups, statistics, settingsZone: settings,
                noData: root.querySelector(`#loading-screen-${_id}`) };
            showControls();
            mountParts();
        }

        /** Toggle Controls: Add factor and Settings hide, and the cards collapse to one line each. */
        function showControls() {
            if (!_dom) return;
            const visible = _controlsVisible !== false;
            if (!visible || _dom.controls.dataset.controlsHidden === 'true') setControlsVisible(_dom.controls, visible);
            _dom.settingsZone.hidden = !visible;
            _dom.root.classList.toggle('cgrp-compact', !visible);
        }

        function mountParts() {
            const ctx = { panelId: _id, read: () => _snap, recipe: () => _recipe, set: setFields, shown };
            if (PARTS.groups) _parts.push(PARTS.groups.mount(_dom.groups, ctx));
            if (PARTS.statistics) _parts.push(PARTS.statistics.mount(_dom.statistics, ctx));
        }

        function onKey(e) {
            const typing = e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text');
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
                if (undo()) e.preventDefault();
            }
        }

        function factorsModel() {
            const s = shown();
            const infos = _recipe.partitionings.map((_, i) => (s && s.index[i] >= 0 ? s.reading.partitionings[s.index[i]] : null));
            const labels = _recipe.partitionings.map((_, i) => (s && s.index[i] >= 0 ? s.defaults[s.index[i]] : new Map()));
            const notes = cardNotes(currentStatus());
            const all = PanelManager.getAllPanels();
            const ofType = (type) => all.filter((p) => typeOf(p) === type).map((p) => ({ id: p.getId(), title: p.getTitle() }));
            const cells = DataManager.getCells();
            return {
                self: _id, recipe: _recipe, infos, labels, missing: new Set(_missing), notes,
                structure: _structure.value, cells: cells ? cells.length : 0, titleOf: sourceTitle, hasGene,
                focusedGene: DataManager.getFocusedGene(), focusedCell: focusedCellName(),
                choices: { groupings: ofType(TYPE), tables: ofType('cell-table'), scores: scoreChoices() }
            };
        }

        /**
         * What a card says of its own state (UX 2.6): a factor refused for its levels, a table (or a score's gene
         * table) whose filter is being built, waits for a click or is refused, a table factor above 1M cells shown.
         * @returns {Map<number, string>} factor index -> its sentence
         */
        function cardNotes(desc) {
            const notes = new Map();
            if (desc.card) notes.set(desc.card.index, desc.card.text);
            const snap = _snap;
            if (snap && snap.table && ['building', 'ask', 'refused', 'failed'].includes(desc.state)) {
                const i = _recipe.partitionings.findIndex((p) => p.source.key === snap.table);
                if (i >= 0) notes.set(i, desc.text);
            }
            if (snap && snap.reason === 'table_too_many_cells') {
                _recipe.partitionings.forEach((p, i) => { if (p.source.type === TABLE_SOURCE) notes.set(i, desc.text); });
            }
            return notes;
        }

        function focusedCellName() {
            const c = DataManager.getFocusedCell && DataManager.getFocusedCell();
            return typeof c === 'string' ? c : (c && c.name) || null;
        }

        function scoreChoices() {
            try {
                return scoreSources().map((s) => ({ id: s.id, title: s.title, options: (s.options || []).map((o) => ({ method: o.method, layer: o.layer, label: o.label })) }));
            } catch (error) {
                console.error(`Cell grouping ${_id}:`, error);
                return [];
            }
        }

        function currentStatus() {
            const snap = _snap;
            const header = snap && snap.state === 'refused' && snap.key ? groupSources().store.snapshot(snap.key).header : null;
            const step = _undo.peek();
            return describeStatus({
                recipe: _recipe, snap, header, cells: (DataManager.getCells() || []).length, nameOf, missing: _missing,
                cycleIds: snap && snap.state === 'cycle' ? cycleIds(_id) || [] : [], self: _id,
                loopUndo: !!(step && step.closesLoop),
                obsmWidth: (key) => obsmWidth(_structure.value, key),
                tableTitle: titleOfPanel, gateTable: snap && snap.table ? snap.table : null
            });
        }

        function paint() {
            if (!_dom) return;
            const desc = currentStatus();
            const s = shown();
            const reply = s ? s.reply : null;
            _status.paint(desc, {
                small: desc.state === 'ready' && reply ? smallLine(reply) : null,
                reasons: reply ? noGroupReasons(s.made, reply, (i) => sourceName(s.made.partitionings[i].source, sourceTitle)) : [],
                usedBy: _usedBy
            });
            _dom.empty.hidden = desc.state !== 'empty';
            const drawn = [_recipe, reply, _missing.join(','), JSON.stringify([...cardNotes(desc)]), _structure.value];
            if (!_drawn || drawn.some((x, i) => x !== _drawn[i])) { _drawn = drawn; _factors.paint(); }
            _settings.paint();
            const step = _undo.peek();
            _dom.undoBtn.disabled = !step;
            _dom.undoBtn.title = step ? `Undo: ${step.label}` : 'Nothing to undo';
            _dom.undoBtn.setAttribute('aria-label', step ? `Undo: ${step.label}` : 'Undo');
            _dom.messageText.textContent = _message.text;
            _dom.messageUndo.hidden = !(_message.undo && step);
            for (const part of _parts) if (part && part.update) part.update();
        }

        /** "Used by": the panels whose configuration names this grouping (one pass over the page's panels). */
        function refreshUsedBy() {
            _usedBy = usedByText(usersOf(_id));
        }

        function laterUsedBy() {
            clearTimeout(_usedTimer);
            _usedTimer = setTimeout(() => { refreshUsedBy(); paint(); }, 0);
        }

        /** Everything is drawn again: the cards too (panel titles, the menus' lists may have changed). */
        function repaint() {
            _drawn = null;
            refreshUsedBy();
            paint();
        }

        function say(text) {
            _message = { text, undo: false };
            if (_dom) { _dom.messageText.textContent = text; _dom.messageUndo.hidden = true; }
        }

        function onAction(action) {
            const h = _handle;
            if (action === 'update') groupSources().sources.update(_id);
            else if (action === 'compute') { if (h) h.compute(); }
            else if (action === 'cancel') { if (h) h.cancel(); }
            else if (action === 'retry') { if (h) h.retry(); }
            else if (action === 'undo') undo();
            else if (action === 'binfewer') {
                const i = _recipe.partitionings.findIndex((p) => !!p.binning);
                if (i >= 0) _factors.expand(i);
            } else if (action.startsWith('levels:')) _factors.expand(Number(action.slice('levels:'.length)));
            else if (action.startsWith('open:')) openPanel(action.slice('open:'.length));
        }

        /** Show a panel this grouping names: an open one is scrolled to, a closed one reopens beside this one. */
        function openPanel(pid) {
            const p = panelOf(pid);
            if (!p) return;
            if (isOpen(p)) {
                const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(pid)}"]`);
                if (tile) { tile.scrollIntoView({ block: 'nearest' }); const t = tile.querySelector('.tile-title'); if (t) t.focus(); }
                return;
            }
            PanelManager.reopenClosedPanel(pid, { nextTo: _id });
        }

        // ---------------------------------------------------------------- events from the page

        function onDataUpdate(updateType) {
            if (!_initialized) return undefined;
            if (updateType === 'datasetChanged') {
                _dom.noData.style.display = 'none';
                syncControlsWithDataset(_dom.controls, true);
                _structure = { dataset: null, value: null };
                groupSources().sources.contextChanged();
                return datasetReady();
            }
            if (updateType === 'subsetChanged' || updateType === 'partChanged') {
                groupSources().sources.contextChanged();
                paint();
            }
            return undefined;
        }

        /** Panels were added, closed, reopened or renamed: who uses this one, and its menus, may have changed. */
        function onPanelsChanged() {
            if (!_initialized) return;
            checkMissing();
            groupSources().sources.recheck();
            repaint();
        }

        function _debugState() {
            const snap = _snap;
            const reply = snap && snap.values && snap.values.reply;
            return JSON.parse(JSON.stringify({
                recipe: _recipe, state: snap ? snap.state : null, held: snap ? snap.held : null, undo: _undo.size,
                groups: reply ? reply.groups.length : null, missing: _missing, visible: _visible, status: currentStatus()
            }));
        }

        return {
            init,
            cleanup,
            destroy: cleanup,
            onDataUpdate,
            onPanelsChanged,
            getId: () => _id,
            getTitle: () => _title,
            setTitle(title) { _title = title; groupSources().sources.sourceChanged(_id); paint(); },
            getType: () => TYPE,
            getConfig,
            updateConfig,
            setConfig: updateConfig,
            // for the steps after this one, and the tests
            getRecipe,
            addFactor,
            undo,
            _debugState
        };
    }

    PanelManager.registerPanelType('cell-grouping', CellGroupingPanel);
})();
