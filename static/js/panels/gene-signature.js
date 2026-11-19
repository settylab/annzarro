/**
 * Gene Signature Panel
 *
 * A signature is a named recipe, a list of genes plus how to score them
 * (utils/gene-signature.js), that outlives its panel: it is its panel, open or
 * closed, and a link, a panel set and a history entry carry it as
 * configuration only.
 *
 * This panel builds the gene list. It opens on the full gene list with a
 * working default (the z-score of each gene, then the average) and nothing to
 * configure: tick genes, or search, tick all that match, add the focused gene,
 * a gene fixed in a plot, or every gene of a gene table. Every change of the
 * list can be undone. A signature holds up to 2,000 genes.
 *
 * It is usable wherever a Gene Table is: a Gene Plot's table filter and the
 * Gene Set Analysis source read it through the same contract a table has
 * (`currentEntries`, `isReady()`, the `tableFiltered` notice), and a closed
 * signature keeps filtering, because its genes are its recipe and need no
 * computation. `selectionIsLive` tells those readers so.
 *
 * Later steps plug in through the exported registries: more ways to add genes
 * (paste and upload), more places to use the signature (a colour, a table
 * column) and the scoring options.
 *
 * It touches no DOM and adds no listener until init(): a closed panel
 * restored from a link or a panel set is constructed and never initialized
 * (PanelManager.registerClosedPanel).
 */
import { PanelManager } from '../panel-manager.js';
import { DataManager } from '../data-manager.js';
import { makeDom } from './gene-set-utilities/dom.js';
import { noDatasetScreenHtml } from '../utils/no-dataset-screen.js';
import { setControlsVisible, syncControlsWithDataset } from '../utils/controls-visibility.js';
import { createGeneGrid } from '../utils/gene-grid.js';
import { getFixedGenes } from './table-utilities/panel-tracker.js';
import { signatureChanged, signatureRenamed, signatureStatus, onSignatureStatus, scoreCommand } from '../utils/score-source.js';
import { durationText } from '../utils/score-notices.js';
import { pasteSource } from './gene-signature-paste.js';
import { pickIdColumnFor, buildIdMap } from '../utils/gene-paste.js';
import { readTableSelection as readSelection } from './gene-set-utilities/state.js';
import {
    GENE_LIMIT, normalizeRecipe, recipeHash, definitionText, planAdd, limitMessage, searchNames, enterTarget,
    UndoStack, fmtCount, inDatasetNames, compareNames, serverRecipe
} from '../utils/gene-signature.js';

/** Search runs this long after the last key, so a long list is not searched on every key. */
const SEARCH_DELAY_MS = 90;

/**
 * Ways to add genes beyond the ones built in, from later steps (paste and
 * upload). Each is `(ctx) => items`, where an item is
 * `{id, label, run: () => void}` and `ctx` is `{panel, genes}`. An item with `inline: true` is a
 * button beside Add from (`shortLabel` on narrow panels) instead of a menu entry, and one with
 * `drop: (file) => void` takes a file dropped on the panel.
 */
export const ADD_SOURCES = [];

// Paste or upload (step 4): an inline button next to Add from, and a drop target over the panel
ADD_SOURCES.push(pasteSource);

/**
 * Places to use a signature beyond the ones built in, from later steps (the
 * colour of a cell plot, a cell table column). Each is
 * `(ctx) => items`, where an item is `{id, label, run: () => void, disabled?: string}`
 * and `ctx` is `{panel, id, title}`.
 */
export const USE_IN = [];

/**
 * Make one of `plot`'s sources (x, y or colour) this signature's score, as the user would with the
 * plot's own menus: the source becomes gene-score and its signature this one, with the default
 * aggregation. A signature's score is computed when the plot needs it.
 */
async function useAs(plot, axis, id, title) {
    const tile = document.querySelector(`.tile[data-tile-id="${CSS.escape(plot.getId())}"]`);
    const typeSelect = tile && tile.querySelector(`select.axis-type-select[data-axis="${axis}"]`);
    const keySelect = tile && tile.querySelector(`select.axis-key-select[data-axis="${axis}"]`);
    const current = () => (plot.getConfig() || {})[axis] || {};
    if (!typeSelect || !keySelect) {
        plot.setConfig({ [axis]: { ...current(), type: 'gene-score', key: id, label: title, column: '' } });
        if (plot.refreshPlot) await plot.refreshPlot();
        return;
    }
    const fire = (select) => {
        select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (current().type !== 'gene-score') {
        typeSelect.value = 'gene-score';
        fire(typeSelect);
        // the type change fills the key list (it is asynchronous)
        for (let i = 0; i < 100 && !(current().type === 'gene-score' && [...keySelect.options].some(o => o.value === id)); i++) {
            await new Promise(resolve => setTimeout(resolve, 30));
        }
    }
    if (current().key !== id) {
        if (![...keySelect.options].some(o => o.value === id)) return;
        keySelect.value = id;
        fire(keySelect);
    }
}

/** For a chosen Cell Plot: Colour, Use as X, Use as Y. */
USE_IN.push(({ id, title }) => PanelManager.getActivePanels()
    .filter(panel => panel.getType() === 'cell-plot')
    .flatMap(panel => [
        ['color', `Colour ${panel.getTitle()}`],
        ['x', `Use as X in ${panel.getTitle()}`],
        ['y', `Use as Y in ${panel.getTitle()}`]
    ].map(([axis, label]) => ({ id: `${axis}:${panel.getId()}`, label,
        run: () => { useAs(panel, axis, id, title).catch((error) => console.error(`Use as ${axis} failed:`, error)); } }))));

/**
 * For each open Cell Table: Add to <Cell Table>. The score becomes a column (the signature's
 * z-score mean, the default aggregation; others are ticked in the table's own chooser), filled
 * in when the score is there. A table that has the column already says so.
 */
USE_IN.push(({ id, title }) => PanelManager.getActivePanels()
    .filter(panel => panel.getType() === 'cell-table' && typeof panel.addColumn === 'function' && typeof panel.hasColumn === 'function')
    .map(panel => {
        const has = panel.hasColumn({ type: 'gene-score', key: id, column: 'zscore_mean' });
        return { id: `table:${panel.getId()}`, label: `Add to ${panel.getTitle()}`,
            disabled: has ? `${panel.getTitle()} has this column` : undefined,
            run: () => { panel.addColumn({ type: 'gene-score', key: id, column: 'zscore_mean', label: title }).catch((error) => console.error('Add to table failed:', error)); } };
    }));

/** The dataset's gene index, shared by every signature (a Map of name -> position), rebuilt when the genes change. */
let _indexCache = { key: null, index: null };

/**
 * @param {string[]} genes - the dataset's genes in their order
 * @returns {Map<string, number>}
 */
function geneIndexOf(genes) {
    const key = `${DataManager.getCurrentDataset() || ''}\u0001${genes.length}\u0001${genes[0]}\u0001${genes[genes.length - 1]}`;
    if (_indexCache.key !== key) {
        const index = new Map();
        for (let i = 0; i < genes.length; i++) if (!index.has(genes[i])) index.set(genes[i], i);
        _indexCache = { key, index };
    }
    return _indexCache.index;
}

const GeneSignaturePanel = (function() {
    /**
     * @param {HTMLElement} container
     * @param {Object} options - a saved config
     */
    function GeneSignaturePanel(container, options = {}) {
        const _id = options.id || `gene-signature-${Date.now()}`;
        let _title = options.title || 'Gene Signature';
        const _container = container;
        const { recipe: _recipe, notes: _loadNotes } = normalizeRecipe(options);
        let _controlsVisible = options.controlsVisible;

        // derived, never saved
        let _names = [];                  // the dataset's genes, sorted
        let _nameSet = new Set();
        let _view = _recipe.genes.length ? 'selected' : 'all';
        let _search = { query: '', regex: false, matchCase: false, invalid: false };
        let _rows = [];                   // the names the grid shows
        let _matches = null;              // names matching the search in the view, or null for no search
        let _message = _loadNotes.join(' ');
        let _timer = null;
        let _unwatchScore = null;
        let _initialized = false;
        let _dom = null;
        let D = null;
        let _grid = null;
        const _undo = new UndoStack();
        const _idMaps = new Map();        // dataset + column -> Promise of id -> gene name, read only when a paste needs it
        let _flow = null;                 // an inline flow (paste and upload) replacing the list: {node, opener, onClose}
        const _listeners = [];

        // -------------------------------------------------------------------
        // life cycle

        function init() {
            D = makeDom(document);
            _initialized = true;
            buildDom();
            listen(document, 'click', onDocumentClick);
            listen(document, 'change', onSomeSelectChanged);
            listen(document, 'focusedGeneChanged', () => { closeMenus(); });
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            if (_controlsVisible === false) setControlsVisible(_dom.controls, false);
            if (loaded) loadGenes();
            rebuildRows({ top: true });
            paint();
            _unwatchScore = onSignatureStatus(_id, () => paintScore());
            // a panel opened under an id the page already uses (Back and Forward, a reopened signature, a panel set)
            // is what a plot filtered by that id has not read yet; a table says as much when its rows are in
            if (loaded) announce();
        }

        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            _listeners.push([target, type, fn]);
        }

        /** Drop every timer and listener and the DOM. The recipe stays: a closed signature is still a signature. */
        function cleanup() {
            clearTimeout(_timer);
            _timer = null;
            closeFlow(null, { focus: false });
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            if (_grid) _grid.destroy();
            _grid = null;
            if (_unwatchScore) _unwatchScore();
            _unwatchScore = null;
            _initialized = false;
            _dom = null;
            _container.innerHTML = '';
        }

        function destroy() {
            cleanup();
        }

        function loadGenes() {
            const genes = DataManager.getGenes();
            _names = genes.slice().sort(compareNames);
            _nameSet = new Set(_names);
        }

        // -------------------------------------------------------------------
        // the recipe

        function getRecipe() {
            return { ..._recipe, genes: [..._recipe.genes], down: [..._recipe.down] };
        }

        /** Replace the recipe's lists and settings (keys of a recipe), as a saved config would. */
        function setRecipe(next) {
            const { recipe, notes } = normalizeRecipe({ ..._recipe, ...next });
            Object.assign(_recipe, recipe);
            if (notes.length) _message = notes.join(' ');
        }

        /** The saved configuration: the title, the recipe and the page state that is the panel's own. */
        function getConfig() {
            const cfg = { title: _title, ...serverRecipe(_recipe) };
            if (_controlsVisible !== undefined) cfg.controlsVisible = _controlsVisible;
            // What a reader of a gene table reads, derived and never saved: not enumerable, so it is in no link,
            // panel set, history entry or copy of the config
            Object.defineProperty(cfg, 'currentEntries', {
                enumerable: false, configurable: true,
                get: () => currentEntries()
            });
            return cfg;
        }

        /**
         * The positions, in the dataset's genes, of the genes that are in it
         * (ascending), as a table lists the rows that pass its filter.
         * @returns {number[]}
         */
        function currentEntries() {
            const genes = DataManager.getGenes();
            const index = geneIndexOf(genes);
            const out = [];
            for (const name of [..._recipe.genes, ..._recipe.down]) {
                const i = index.get(name);
                if (i !== undefined) out.push(i);
            }
            return out.sort((a, b) => a - b);
        }

        function updateConfig(config) {
            if (!config) return;
            if (config.title && config.title !== _title) { _title = config.title; signatureRenamed(_id); }
            else if (config.title) _title = config.title;
            if (config.controlsVisible !== undefined) _controlsVisible = config.controlsVisible;
            const recipeKeys = ['genes', 'down', 'input', 'method', 'clip', 'seed'];
            if (recipeKeys.some(k => k in config)) {
                setRecipe(Object.fromEntries(recipeKeys.filter(k => k in config).map(k => [k, config[k]])));
                if (_initialized) { rebuildRows(); paint(); }
                notifyChange();
            }
        }

        function getId() { return _id; }
        function getTitle() { return _title; }
        function setTitle(title) { _title = title; signatureRenamed(_id); }
        function getType() { return 'gene-signature'; }

        /** Tell readers (plots filtered by this signature, Gene Set Analysis) and the saved state that the genes changed. */
        function announce() {
            try {
                PanelManager.notifyPanels('tableFiltered', { id: _id, type: 'genes' });
            } catch (error) {
                console.error(`Gene signature ${_id}:`, error);
            }
        }

        function notifyChange() {
            announce();
            // plots that show this signature's score: update now, or collect the edits behind Update score
            signatureChanged(_id);
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
                window.sessionManager.notifyPanelUpdate();
            }
        }

        // -------------------------------------------------------------------
        // changing the list

        /**
         * Make `genes` the up genes, as one undoable step.
         * @param {string[]} genes - sorted, distinct
         * @param {string} label - what undo says
         * @param {{tick?: boolean}} [opts]
         */
        function commit(genes, label, opts = {}) {
            _undo.push(label, _recipe.genes, opts);
            _recipe.genes = genes;
            afterChange(opts.tick ? 'tick' : 'list');
        }

        function afterChange(kind) {
            // a single tick leaves the Selected rows where they are (an untick strikes the row through);
            // anything else changes which rows there are
            if (kind === 'tick') {
                if (_grid) _grid.refresh();
            } else {
                rebuildRows();
            }
            paint();
            notifyChange();
        }

        /**
         * Add genes. Over the limit nothing is added and the message says so.
         * @param {Iterable<string>} names
         * @param {{label?: string, noun?: string, outside?: number}} [opts] - `label`: where they come from ("DE genes")
         * @returns {{ok: boolean, added: number, already: number}}
         */
        function addGenes(names, { label = '', outside = 0, step = '' } = {}) {
            const list = [...names];
            const plan = planAdd(_recipe.genes, list, GENE_LIMIT, _recipe.down.length);
            if (!plan.ok) {
                say(limitMessage(plan, label ? `${label} has ${fmtCount(new Set(list).size)} genes.` : ''));
                return { ok: false, added: 0, already: plan.already };
            }
            if (!plan.added.length) {
                say(list.length ? `Nothing new: ${plan.already === 1 ? 'that gene is' : 'those genes are'} already selected.` : 'No genes to add.');
                return { ok: true, added: 0, already: plan.already };
            }
            const n = plan.added.length;
            const from = label ? ` from ${label}` : '';
            commit(plan.genes, step || `add ${fmtCount(n)} gene${n === 1 ? '' : 's'}${from}`);
            let text = n === 1 && !label ? `Added ${plan.added[0]}.` : `Added ${fmtCount(n)} gene${n === 1 ? '' : 's'}${from}.`;
            if (plan.already) text += ` ${fmtCount(plan.already)} ${plan.already === 1 ? 'was' : 'were'} already selected.`;
            if (outside) text += ` ${fmtCount(outside)} ${outside === 1 ? 'is' : 'are'} not in this dataset.`;
            say(text);
            return { ok: true, added: n, already: plan.already };
        }

        /** Tick or untick one gene. */
        function toggleGene(name, checked) {
            if (checked) {
                const plan = planAdd(_recipe.genes, [name], GENE_LIMIT, _recipe.down.length);
                if (!plan.ok) {
                    say(limitMessage(plan));
                    if (_grid) _grid.refresh();
                    return;
                }
                if (plan.added.length) commit(plan.genes, `tick ${name}`, { tick: true });
                say(`${name} selected.`);
            } else {
                if (!_recipe.genes.includes(name)) return;
                commit(_recipe.genes.filter(g => g !== name), `untick ${name}`, { tick: true });
                say(`${name} unselected.`);
            }
        }

        /** Tick every gene the search shows. */
        function tickAll() {
            if (_view !== 'all' || !_matches || !_matches.length) return;
            const q = _search.query;
            const result = addGenes(_matches, { step: `tick ${fmtCount(_matches.length)} genes matching "${q}"` });
            if (result.ok && result.added) {
                say(`Ticked ${fmtCount(result.added)} gene${result.added === 1 ? '' : 's'} matching "${q}".`
                    + (result.already ? ` ${fmtCount(result.already)} ${result.already === 1 ? 'was' : 'were'} already selected.` : ''));
            }
        }

        function clearAll() {
            if (!_recipe.genes.length) return;
            const n = _recipe.genes.length;
            commit([], `clear ${fmtCount(n)} genes`);
            say(`Cleared ${fmtCount(n)} gene${n === 1 ? '' : 's'}.`);
        }

        function undo() {
            const step = _undo.pop();
            if (!step) return false;
            _recipe.genes = step.before;
            rebuildRows();
            paint();
            notifyChange();
            say(`Undone: ${step.label}.`);
            return true;
        }

        // -------------------------------------------------------------------
        // the rows

        function viewNames() {
            return _view === 'all' ? _names : _recipe.genes;
        }

        /** Search the view and set the rows. An invalid pattern keeps the last rows. */
        function rebuildRows({ top = false } = {}) {
            const names = viewNames();
            const result = searchNames(names, _search.query, _search);
            _search.invalid = !!result.invalid;
            if (!result.invalid) {
                _matches = result.indices ? result.indices.map(i => names[i]) : null;
                _rows = _matches || names;
            }
            if (_grid) _grid.setRows(_rows, { top });
        }

        function setView(view) {
            if (_view === view) return;
            _view = view;
            rebuildRows({ top: true });
            paint();
        }

        function stateOf(name) {
            const checked = _recipe.genes.includes(name) || _recipe.down.includes(name);
            return {
                checked,
                missing: _nameSet.size > 0 && !_nameSet.has(name),
                removed: _view === 'selected' && !checked
            };
        }

        // -------------------------------------------------------------------
        // DOM

        function buildDom() {
            const { el } = D;
            const sid = (x) => `gsig-${x}-${_id}`;
            const status = el('div', { class: 'gsig-status', role: 'region', aria: { label: 'Signature' } });
            const summary = el('span', { class: 'gsig-summary', id: sid('summary') });
            const useIn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-usein',
                aria: { haspopup: 'menu', expanded: 'false', controls: sid('usein-menu') }, on: { click: () => toggleMenu('usein') } },
            'Use in ▾');
            const useInMenu = el('div', { class: 'gs-menu gsig-menu', id: sid('usein-menu'), role: 'menu', hidden: true,
                on: { keydown: (e) => onMenuKey(e, 'usein') } });
            const definition = el('div', { class: 'gsig-definition', id: sid('definition') });
            const usedBy = el('div', { class: 'gsig-usedby' });
            const scoreLine = el('div', { class: 'gsig-score', hidden: true });
            status.append(
                el('div', { class: 'gsig-status__row' }, summary, el('span', { class: 'gsig-menu-wrap' }, useIn, useInMenu)),
                definition, usedBy, scoreLine);

            const search = el('input', { type: 'search', class: 'form-control form-control-sm gsig-search', id: sid('search'),
                placeholder: 'Search genes', autocomplete: 'off', spellcheck: 'false', aria: { label: 'Search genes', describedby: sid('searchnote') },
                on: { input: onSearchInput, keydown: onSearchKey } });
            const regex = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-toggle', title: 'Regular expression',
                aria: { pressed: 'false', label: 'Regular expression' }, on: { click: () => toggleSearch('regex') } }, '.*');
            const matchCase = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-toggle', title: 'Match case',
                aria: { pressed: 'false', label: 'Match case' }, on: { click: () => toggleSearch('matchCase') } }, 'Aa');
            const tickAllBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary gsig-tickall', hidden: true,
                on: { click: tickAll } });
            const searchNote = el('div', { class: 'gsig-searchnote', id: sid('searchnote') });
            const addFrom = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-addfrom',
                aria: { haspopup: 'menu', expanded: 'false', controls: sid('addfrom-menu') }, on: { click: () => toggleMenu('addfrom') } },
            el('span', { class: 'gsig-long', text: 'Add from ▾' }), el('span', { class: 'gsig-short', text: 'Add ▾' }));
            const addMenu = el('div', { class: 'gs-menu gsig-menu', id: sid('addfrom-menu'), role: 'menu', hidden: true,
                on: { keydown: (e) => onMenuKey(e, 'addfrom') } });
            const _flowHost = el('div', { class: 'gsig-flow', hidden: true });
            const controls = el('div', { class: 'gsig-controls' },
                el('div', { class: 'gsig-search-row' }, search, regex, matchCase, tickAllBtn),
                searchNote,
                el('div', { class: 'gsig-add-row' }, ...inlineButtons(), el('span', { class: 'gsig-menu-wrap' }, addFrom, addMenu)),
                _flowHost);

            const allBtn = el('button', { type: 'button', role: 'radio', class: 'gsig-seg', on: { click: () => setView('all') } });
            const selBtn = el('button', { type: 'button', role: 'radio', class: 'gsig-seg', on: { click: () => setView('selected') } });
            const viewSwitch = el('div', { class: 'gsig-viewswitch', role: 'radiogroup', aria: { label: 'Genes shown' },
                on: { keydown: onSwitchKey } }, allBtn, selBtn);
            const undoBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-undo', disabled: true,
                on: { click: () => { undo(); } } }, 'Undo');
            const clearBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-clear',
                title: 'Remove every gene from the signature (can be undone)', on: { click: clearAll } }, 'Clear');
            const listbar = el('div', { class: 'gsig-listbar' }, viewSwitch, el('span', { class: 'gsig-listbar__actions' }, undoBtn, clearBtn));

            const note = el('div', { class: 'gsig-note-line' });
            const message = el('div', { class: 'gsig-message', role: 'status', aria: { live: 'polite' }, id: sid('message') });
            const empty = el('div', { class: 'gsig-empty', hidden: true });

            _grid = createGeneGrid({
                doc: document, label: 'Genes', stateOf,
                onToggle: (name, checked) => toggleGene(name, checked)
            });

            const root = el('div', { class: 'gsig-panel' });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            root.addEventListener('keydown', onPanelKey);
            root.addEventListener('dragover', onPanelDragOver);
            root.addEventListener('drop', onPanelDrop);
            root.append(status, controls, listbar, message, note, empty, _grid.element);
            _container.innerHTML = '';
            _container.appendChild(root);
            _dom = { root, controls, flowHost: _flowHost, status, summary, useIn, useInMenu, definition, usedBy, scoreLine, search, regex, matchCase, tickAllBtn, searchNote,
                addFrom, addMenu, allBtn, selBtn, undoBtn, clearBtn, listbar, message, note, empty,
                noData: root.querySelector(`#loading-screen-${_id}`) };
        }

        /** Repaint everything that states the list: counts, buttons, notes. */
        function paint() {
            if (!_dom) return;
            const n = _recipe.genes.length + _recipe.down.length;
            const loaded = _nameSet.size > 0;
            const missing = loaded ? [..._recipe.genes, ..._recipe.down].filter(g => !_nameSet.has(g)).length : 0;
            _dom.summary.textContent = n
                ? `${fmtCount(n)} of ${fmtCount(GENE_LIMIT)} genes selected`
                : `Tick genes to build a score. A signature holds up to ${fmtCount(GENE_LIMIT)} genes.`;
            _dom.definition.textContent = `${definitionText(_recipe)}.${missing ? ` ${fmtCount(missing)} not in this dataset.` : ''}`;
            _dom.useIn.disabled = n === 0;
            _dom.useIn.title = n === 0 ? 'Tick genes first' : 'Use this signature in a plot or an analysis';

            _dom.search.classList.toggle('is-invalid', _search.invalid);
            _dom.regex.setAttribute('aria-pressed', String(_search.regex));
            _dom.regex.classList.toggle('active', _search.regex);
            _dom.matchCase.setAttribute('aria-pressed', String(_search.matchCase));
            _dom.matchCase.classList.toggle('active', _search.matchCase);
            _dom.searchNote.textContent = _search.invalid ? 'Not a valid pattern' : '';
            _dom.searchNote.classList.toggle('gsig-searchnote--error', _search.invalid);

            const searching = !!_search.query && !_search.invalid;
            const total = _names.length;
            _dom.allBtn.textContent = searching && _view === 'all' && _matches
                ? `All genes ${fmtCount(_matches.length)} ${_matches.length === 1 ? 'match' : 'matches'}` : `All genes ${fmtCount(total)}`;
            const selMatches = searching && _view === 'selected' && _matches;
            _dom.selBtn.textContent = selMatches
                ? `Selected ${fmtCount(_matches.length)} ${_matches.length === 1 ? 'match' : 'matches'}` : `Selected ${fmtCount(n)}`;
            for (const [btn, v] of [[_dom.allBtn, 'all'], [_dom.selBtn, 'selected']]) {
                btn.setAttribute('aria-checked', String(_view === v));
                btn.tabIndex = _view === v ? 0 : -1;
                btn.classList.toggle('active', _view === v);
            }

            const canTickAll = _view === 'all' && searching && _matches && _matches.length > 0;
            _dom.tickAllBtn.hidden = !canTickAll;
            if (canTickAll) _dom.tickAllBtn.textContent = `Tick all ${fmtCount(_matches.length)}`;

            const step = _undo.peek();
            _dom.undoBtn.disabled = !step;
            _dom.undoBtn.title = step ? `Undo: ${step.label}` : 'Nothing to undo';
            _dom.undoBtn.setAttribute('aria-label', step ? `Undo: ${step.label}` : 'Undo');
            _dom.clearBtn.hidden = n === 0;

            // an empty view says why
            let text = '';
            if (!loaded) text = '';
            else if (_view === 'selected' && !n) text = 'No genes selected yet. Switch to All genes and tick some.';
            else if (searching && _matches && !_matches.length) {
                text = _view === 'selected'
                    ? `${_search.query} is not selected.` : `No gene matches ${_search.query}.`;
            }
            _dom.empty.hidden = !text;
            D.clear(_dom.empty);
            if (text) {
                _dom.empty.append(text);
                if (_view === 'selected' && searching && n) {
                    _dom.empty.append(' ', D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', text: 'Search all genes',
                        on: { click: () => setView('all') } }));
                }
            }
            _grid.element.hidden = !!text && _rows.length === 0;

            paintUsedBy();
            paintScore();
            _dom.message.textContent = _message;
        }

        /**
         * What the score of this signature is doing, when plots or tables show it: computing with Cancel,
         * edits held back behind Update score, a score that asks first, a failure. Nothing when nothing needs it.
         */
        function paintScore() {
            if (!_dom || !_dom.scoreLine) return;
            const st = signatureStatus(_id);
            const line = _dom.scoreLine;
            D.clear(line);
            const btn = (label, command) => D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link',
                data: { scoreCommand: command }, on: { click: () => scoreCommand(_id, command) } }, label);
            let text = '';
            let action = null;
            if (st.held) {
                const n = st.held.edits;
                text = `${n === 1 ? '1 change is' : `${n} changes are`} not applied.`
                    + (Number.isFinite(st.held.seconds) ? ` ${durationText(st.held.seconds).replace(/^about/, 'About')}.` : '')
                    + ' Plots show the previous score.';
                action = btn('Update score', 'update');
            } else if (st.dependants && ['estimating', 'computing', 'updating'].includes(st.state)) {
                const p = st.progress;
                text = p && p.total > 0 ? `Computing: ${fmtCount(p.done)} of ${fmtCount(p.total)} genes.` : 'Computing.';
                action = btn('Cancel', 'cancel');
            } else if (st.dependants && st.state === 'queued') {
                text = 'Waiting for another score to finish.';
                action = btn('Cancel', 'cancel');
            } else if (st.dependants && st.state === 'awaiting') {
                text = `This score will take ${durationText(st.estimate && st.estimate.seconds)}.`;
                action = btn('Compute', 'compute');
            } else if (st.dependants && st.state === 'cancelled') {
                text = 'The score was cancelled.';
                action = btn('Compute', 'compute');
            } else if (st.dependants && st.state === 'failed') {
                text = `Score not computed${st.message ? `: ${st.message.replace(/[.\s]+$/, '')}` : ''}.`;
                action = btn('Retry', 'retry');
            } else if (st.dependants && (st.state === 'refused' || st.state === 'noscore')) {
                text = st.message || 'No score.';
            } else if (st.dependants && st.state === 'ready' && st.header) {
                text = `Score ready: ${fmtCount(st.header.n_used)} gene${st.header.n_used === 1 ? '' : 's'} used.`;
            }
            line.hidden = !text;
            if (text) line.append(D.el('span', { class: 'gsig-score__text', text }), action ? ' ' : '', action || '');
        }

        /** The dependants: Gene Plots filtered by this signature, Gene Set Analysis panels reading it. */
        function paintUsedBy() {
            if (!_dom) return;
            const counts = { plot: 0, analysis: 0 };
            for (const panel of PanelManager.getAllPanels()) {
                const type = panel.getType && panel.getType();
                if (type !== 'gene-plot' && type !== 'gene-set') continue;
                const cfg = panel.getConfig && panel.getConfig();
                if (cfg && cfg.tableFilter === _id) counts[type === 'gene-plot' ? 'plot' : 'analysis']++;
            }
            const parts = [];
            if (counts.plot) parts.push(`${counts.plot} plot${counts.plot === 1 ? '' : 's'}`);
            if (counts.analysis) parts.push(`${counts.analysis} Gene Set Analysis`);
            _dom.usedBy.textContent = parts.length ? `Used by ${parts.join(', ')}` : '';
            _dom.usedBy.hidden = !parts.length;
        }

        /** Say something in the panel's one live region. */
        function say(text) {
            _message = text;
            if (_dom) _dom.message.textContent = text;
        }

        // -------------------------------------------------------------------
        // search

        function onSearchInput() {
            clearTimeout(_timer);
            _search.query = _dom.search.value;
            _timer = setTimeout(applySearch, SEARCH_DELAY_MS);
        }

        function applySearch() {
            clearTimeout(_timer);
            _timer = null;
            if (!_dom) return;
            _search.query = _dom.search.value;
            rebuildRows({ top: true });
            paint();
        }

        function toggleSearch(key) {
            _search[key] = !_search[key];
            applySearch();
        }

        function clearSearch() {
            _dom.search.value = '';
            _search.query = '';
            applySearch();
        }

        function onSearchKey(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applySearch();
                if (_view !== 'all') return;
                const target = enterTarget(_rows, _search.query, _search);
                if (!target) {
                    if (_rows.length > 1 && !_search.invalid) say(`${fmtCount(_rows.length)} genes match. Use Tick all ${fmtCount(_rows.length)}, or type the whole name.`);
                    return;
                }
                if (_recipe.genes.includes(target)) say(`${target} is already selected.`);
                else toggleGene(target, true);
                // the box is cleared and keeps the focus, so genes can be typed in a row
                clearSearch();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_rows.length) _grid.focusRow(_grid.activeIndex());
            } else if (e.key === 'Escape') {
                if (_dom.search.value) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
            }
        }

        function onSwitchKey(e) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = _view === 'all' ? 'selected' : 'all';
                setView(next);
                (next === 'all' ? _dom.allBtn : _dom.selBtn).focus();
            }
        }

        /** Undo with Ctrl or Cmd+Z outside a text field. */
        function onPanelKey(e) {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
                const t = e.target;
                if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                if (undo()) e.preventDefault();
            }
        }

        // -------------------------------------------------------------------
        // menus

        let _openMenu = null;

        function menuParts(which) {
            return which === 'usein' ? { button: _dom.useIn, menu: _dom.useInMenu } : { button: _dom.addFrom, menu: _dom.addMenu };
        }

        function toggleMenu(which) {
            if (_openMenu === which) { closeMenus(); return; }
            closeMenus();
            const { button, menu } = menuParts(which);
            D.clear(menu);
            const items = which === 'usein' ? useInItems() : addFromItems();
            if (!items.length) {
                menu.appendChild(D.el('div', { class: 'gs-menu__item gsig-menu__none', text: which === 'usein' ? 'Nothing to use it in yet' : 'Nothing to add from' }));
            }
            for (const item of items) {
                menu.appendChild(D.el('button', { type: 'button', role: 'menuitem', class: 'gs-menu__item', disabled: !!item.disabled,
                    title: item.disabled || undefined, data: { id: item.id },
                    on: { click: () => { closeMenus(); button.focus(); item.run(); } } }, item.label));
            }
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            _openMenu = which;
            const first = menu.querySelector('button:not(:disabled)');
            if (first) first.focus();
        }

        function closeMenus() {
            if (!_dom) return;
            for (const which of ['usein', 'addfrom']) {
                const { button, menu } = menuParts(which);
                menu.hidden = true;
                button.setAttribute('aria-expanded', 'false');
            }
            _openMenu = null;
        }

        function onMenuKey(e, which) {
            const { button, menu } = menuParts(which);
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { closeMenus(); button.focus(); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === 'ArrowDown') { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
            else if (e.key === 'Tab') closeMenus();
        }

        function onDocumentClick(e) {
            if (_openMenu && _dom && !e.target.closest('.gsig-menu-wrap')) closeMenus();
        }

        /** A table filter or a source changed somewhere: who uses this signature may have changed. */
        function onSomeSelectChanged(e) {
            if (e.target && e.target.tagName === 'SELECT') setTimeout(paintUsedBy, 0);
        }

        /** What "Add from" offers: the focused gene, genes fixed in plots, every gene table, and what later steps add. */
        function addFromItems() {
            const items = [];
            const inData = (g) => _nameSet.has(g);
            const seen = new Set();
            for (const f of getFixedGenes()) {
                if (!f.gene || seen.has(f.gene) || !inData(f.gene)) continue;
                seen.add(f.gene);
                const where = f.source === 'focused' ? 'focused' : `fixed in ${f.panelTitle}`;
                items.push({ id: `gene:${f.gene}`, label: `${f.gene} · ${where}`, run: () => addGenes([f.gene]) });
            }
            const active = new Set(PanelManager.getActivePanels());
            for (const table of PanelManager.getPanelsByType('gene-table')) {
                const sel = readSelection(table, { open: active.has(table), geneNames: DataManager.getGenes() });
                const title = (table.getTitle && table.getTitle()) || 'Gene table';
                if (!sel.names) {
                    items.push({ id: `table:${table.getId()}`, label: `${title} · genes not known yet`, disabled: 'This table has not loaded its rows.', run: () => {} });
                    continue;
                }
                const { names, outside } = inDatasetNames(sel.names, _nameSet);
                items.push({ id: `table:${table.getId()}`, label: `${title} · ${fmtCount(names.length)} gene${names.length === 1 ? '' : 's'}`,
                    run: () => addGenes(names, { label: title, outside }) });
            }
            for (const item of addSourceItems()) if (!item.inline) items.push(item);
            return items;
        }

        function addSourceItems() {
            const out = [];
            for (const source of ADD_SOURCES) out.push(...source({ panel: api, genes: _names }));
            return out;
        }

        /**
         * Pasted ids to gene names, for the preview: the one var column that holds them (gene_ids, ensembl_id, an
         * Entrez column), read on first need and kept for the dataset. Null when the dataset has no such column or
         * it cannot be read, so the preview keeps its plain "these look like ids" message.
         * @param {'ensembl'|'entrez'} kind
         * @returns {Promise<Map<string,string>|null>}
         */
        async function loadIdMap(kind) {
            const path = DataManager.getCurrentDataset();
            if (!path) return null;
            let columns;
            try {
                const structure = await DataManager.getDatasetStructure(path);
                const v = structure && structure.var;
                columns = (v && (v.columns || Object.keys(v))) || [];
            } catch { return null; }
            const column = pickIdColumnFor(kind, columns);
            if (!column) return null;
            const key = `${path}\u0001${column}`;
            if (!_idMaps.has(key)) {
                _idMaps.set(key, (async () => {
                    const resp = await DataManager.loadVar({ datasetPath: path, columns: [column] });
                    const values = resp && resp.data && resp.data[column];
                    if (!values || typeof values.length !== 'number') throw new Error(`no values for ${column}`);
                    return buildIdMap(values, DataManager.getGenes());
                })());
                _idMaps.get(key).catch(() => _idMaps.delete(key));
            }
            try { return await _idMaps.get(key); } catch { return null; }
        }

        /** The buttons of the sources that sit beside Add from (Paste or upload). */
        function inlineButtons() {
            return addSourceItems().filter(i => i.inline).map(item => D.el('button', {
                type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-inline', data: { id: item.id },
                aria: { label: item.label }, on: { click: () => { closeMenus(); item.run(); } } },
            D.el('span', { class: 'gsig-long', text: item.label }), D.el('span', { class: 'gsig-short', text: item.shortLabel || item.label })));
        }

        /**
         * Show `node` in place of the list (zones 3 to 5 of the design), until closeFlow.
         * @param {HTMLElement} node
         * @param {{opener?: string, onClose?: () => void}} [opts] - `opener`: id of the inline button that gets the focus back
         */
        function openFlow(node, opts = {}) {
            if (!_dom) return;
            closeFlow(null, { focus: false });
            closeMenus();
            _flow = { node, opener: opts.opener, onClose: opts.onClose };
            _dom.flowHost.append(node);
            _dom.flowHost.hidden = false;
            _dom.root.classList.add('gsig-flowing');
        }

        /** Put the list back. The focus goes to the button that opened the flow. */
        function closeFlow(opener, { focus = true } = {}) {
            const flow = _flow;
            if (!flow) return;
            _flow = null;
            if (flow.onClose) flow.onClose();
            flow.node.remove();
            if (!_dom) return;
            _dom.flowHost.hidden = true;
            _dom.root.classList.remove('gsig-flowing');
            if (_grid) _grid.refresh();
            const id = opener || flow.opener;
            const btn = id && _dom.root.querySelector(`.gsig-inline[data-id="${CSS.escape(id)}"]`);
            if (focus && btn) btn.focus();
        }

        function onPanelDragOver(e) {
            const types = e.dataTransfer && e.dataTransfer.types;
            if (types && [...types].includes('Files') && addSourceItems().some(i => i.drop)) e.preventDefault();
        }

        /** A file dropped on the panel goes to the source that takes files (Paste or upload). */
        function onPanelDrop(e) {
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            const item = addSourceItems().find(i => i.drop);
            if (!file || !item) return;
            e.preventDefault();
            item.drop(file);
        }

        /** What "Use in" offers: the Gene Plots it can filter, the Gene Set Analysis panels it can feed, and what later steps add. */
        function useInItems() {
            const items = [];
            const active = PanelManager.getActivePanels();
            for (const panel of active) {
                const type = panel.getType();
                if (type === 'gene-plot') {
                    items.push({ id: `filter:${panel.getId()}`, label: `Filter ${panel.getTitle()}`, run: () => filterPlot(panel) });
                } else if (type === 'gene-set') {
                    items.push({ id: `analyse:${panel.getId()}`, label: `Analyse in ${panel.getTitle()}`, run: () => feedAnalysis(panel) });
                }
            }
            for (const provider of USE_IN) items.push(...provider({ panel: api, id: _id, title: _title }));
            return items;
        }

        /** Select this signature in a Gene Plot's table filter, as the user would. */
        function filterPlot(plot) {
            const select = document.querySelector(`.tile[data-tile-id="${CSS.escape(plot.getId())}"] select.table-filter-select`);
            if (select && [...select.options].some(o => o.value === _id)) {
                select.value = _id;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.jQuery) window.jQuery(select).trigger('change');
            } else {
                plot.setConfig({ tableFilter: _id });
                if (plot.onDataUpdate) plot.onDataUpdate('tableChanged', { id: _id });
            }
            say(`${plot.getTitle()} is filtered by ${_title}.`);
            setTimeout(paintUsedBy, 50);
        }

        /** Make this signature the source of a Gene Set Analysis panel. */
        function feedAnalysis(panel) {
            panel.setConfig({ tableFilter: _id });
            say(`${panel.getTitle()} analyses ${_title}.`);
            setTimeout(paintUsedBy, 0);
        }

        // -------------------------------------------------------------------
        // events from the page

        function onDataUpdate(updateType, updateData) {
            if (updateType === 'datasetChanged') {
                if (!_initialized) return undefined;
                closeFlow(null, { focus: false });
                loadGenes();
                _dom.noData.style.display = 'none';
                syncControlsWithDataset(_dom.controls, true);
                rebuildRows({ top: true });
                paint();
                notifyChange();
            }
            void updateData;
            return undefined;
        }

        /** Panels were added, closed, reopened or renamed: who uses this one may have changed. */
        function onPanelsChanged() {
            if (!_initialized) return;
            paintUsedBy();
        }

        /** For tests: the state as JSON-safe data. */
        function _debugState() {
            return JSON.parse(JSON.stringify({
                recipe: _recipe, hash: recipeHash(_recipe), view: _view, search: _search,
                rows: _rows.length, drawn: _grid ? _grid.drawnCount() : 0, undo: _undo.size, message: _message
            }));
        }

        const api = {
            init,
            cleanup,
            destroy,
            onDataUpdate,
            onPanelsChanged,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig,
            updateConfig,
            setConfig: updateConfig,
            // the contract of a gene table, as a reader of one uses it (see the header)
            isReady: () => true,
            selectionIsLive: true,
            // for the steps after this one
            getRecipe,
            getRecipeHash: () => recipeHash(_recipe),
            addGenes,
            undo,
            // for the sources that plug in (paste and upload)
            getDatasetGenes: () => DataManager.getGenes(),
            loadIdMap,
            getSelectedGenes: () => [..._recipe.genes, ..._recipe.down],
            openFlow,
            closeFlow,
            _debugState
        };
        return api;
    }

    PanelManager.registerPanelType('gene-signature', GeneSignaturePanel);

    return GeneSignaturePanel;
})();

export { GeneSignaturePanel };
