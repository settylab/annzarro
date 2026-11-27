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
 * list can be undone. A signature holds any number of genes.
 *
 * It is usable wherever a Gene Table is: a Gene Plot's table filter and the
 * Gene Set Analysis source read it through the same contract a table has
 * (`currentEntries`, `isReady()`, the `tableFiltered` notice), and a closed
 * signature keeps filtering, because its genes are its recipe and need no
 * computation. `selectionIsLive` tells those readers so.
 *
 * Its score, one number per cell, is a `gene-score` source of Cell Plots, Cell
 * Tables and Count Plots (utils/score-source.js): each chooses a method and a
 * layer, and the panel's Methods pop-over holds the settings of each method
 * (panels/score-options). Distribution opens a Count Plot of the score beside
 * the panel. Up/Down, beside Add from, lets genes count against the score. More
 * ways to add genes plug in through ADD_SOURCES (paste and upload).
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
import { OPTION_KEYS } from '../utils/signature-options.js';
import { pinConsumersOf, sourceChanged, sourceRenamed, sourceStatus, onSourceStatus, scoreCommand } from '../utils/score-source.js';
import { durationText } from '../utils/score-notices.js';
import { Coverage, GAP } from '../utils/coverage.js';
import { renderCoverageNotice } from '../utils/panel-surface.js';
import { pasteSource } from './gene-signature-paste.js';
import { createScoreOptions } from './score-options/score-options.js';
import { distributionSource } from './cell-count/controls-model.js';
import { pickIdColumnFor, buildIdMap } from '../utils/gene-paste.js';
import { readTableSelection as readSelection } from './gene-set-utilities/state.js';
import {
    normalizeRecipe, normalizeSettings, recipeHash, searchNames, enterTarget,
    UndoStack, fmtCount, inDatasetNames, compareNames, storedRecipe,
    selectedNames, planDirection, planAddAs, directionCounts, mergeSorted
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
        let _dirFilter = 'all';           // Selected view, directions on: 'all', 'up' or 'down'
        let _addAs = 'up';                // what Add from and the focused gene add as (directions on)
        let _rows = [];                   // the names the grid shows
        let _matches = null;              // names matching the search in the view, or null for no search
        let _message = _loadNotes.join(' ');
        let _timer = null;
        let _unwatchScore = null;
        let _initialized = false;
        let _dom = null;
        let D = null;
        let _grid = null;
        let _scoreOptions = null;         // the Methods pop-over and the layers' kinds (panels/score-options/score-options.js), shared with the gene table
        let _askOff = false;              // Up/Down switched off while down genes exist: the question is in place
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
            listen(document, 'focusedGeneChanged', () => { closeMenus(); paintFocused(); });
            listen(window, 'resize', placeMenu);
            listen(window, 'scroll', () => { if (_openMenu) closeMenus(); }, true);
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            if (_controlsVisible === false) setControlsVisible(_dom.controls, false);
            if (loaded) loadGenes();
            rebuildRows({ top: true });
            paint();
            if (loaded) _scoreOptions.load();        // the layers, and what each looks like
            _unwatchScore = onSourceStatus(_id, paintScore);
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
            if (_dom && _dom.addMenu.parentElement === document.body) _dom.addMenu.remove();
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            if (_grid) _grid.destroy();
            _grid = null;
            if (_unwatchScore) _unwatchScore();
            _unwatchScore = null;
            if (_scoreOptions) _scoreOptions.destroy();
            _scoreOptions = null;
            _initialized = false;
            _dom = null;
            _container.innerHTML = '';
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
            // consumers with no layer take the input as it is now, before it changes: they never move with it
            if (('input' in next || 'layers' in next || 'offered' in next) && normalizeSettings({ ..._recipe, ...next }, false).input !== _recipe.input) pinConsumersOf();
            if (!('genes' in next) && !('down' in next)) {
                // settings only: the lists stay as they are
                Object.assign(_recipe, normalizeSettings({ ..._recipe, ...next }, _recipe.down.length > 0));
                return;
            }
            const { recipe, notes } = normalizeRecipe({ ..._recipe, ...next });
            Object.assign(_recipe, recipe);
            if (notes.length) _message = notes.join(' ');
        }

        /** The saved configuration: the title, the recipe and the page state that is the panel's own. */
        function getConfig() {
            const cfg = { title: _title, ...storedRecipe(_recipe) };
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
            if (config.title && config.title !== _title) { _title = config.title; sourceRenamed(_id); }
            else if (config.title) _title = config.title;
            if (config.controlsVisible !== undefined) _controlsVisible = config.controlsVisible;
            const recipeKeys = ['genes', 'down', 'down_weight', 'directions', ...OPTION_KEYS];
            if (recipeKeys.some(k => k in config)) {
                setRecipe(Object.fromEntries(recipeKeys.filter(k => k in config).map(k => [k, config[k]])));
                if (_initialized) { rebuildRows(); paint(); if (_scoreOptions) _scoreOptions.changed(Object.keys(config)); }
                notifyChange(Object.keys(config));
            }
        }

        /** What the layers look like and what was sampled of them: scoreChoices grades each method on each layer by it. */
        function getGrading() {
            return _scoreOptions ? _scoreOptions.getGrading() : {};
        }

        function getId() { return _id; }
        function getTitle() { return _title; }
        function setTitle(title) { _title = title; sourceRenamed(_id); }
        function getType() { return 'gene-signature'; }

        /** Tell readers (plots filtered by this signature, Gene Set Analysis) and the saved state that the genes changed. */
        function announce() {
            try {
                PanelManager.notifyPanels('tableFiltered', { id: _id, type: 'genes' });
            } catch (error) {
                console.error(`Gene signature ${_id}:`, error);
            }
        }

        /**
         * An edit in the Methods pop-over or of Up/Down: part of the recipe, so it reaches the link and the score's key.
         * The list of genes did not change, so what is filtered by this signature is not told. (The component tells the
         * readers.)
         * @param {Object} patch - fields of the recipe (clip, seed, bins, controls, detect_above, down_weight, directions)
         */
        function storeOptions(patch) {
            setRecipe(patch);
            if ('directions' in patch) {
                if (!_recipe.directions) { _addAs = 'up'; _dirFilter = 'all'; }
                rebuildRows();
            }
            paint();
            if (_grid) _grid.refresh();
        }

        /**
         * The genes changed, or the option fields named in `keys` (a saved config, Back and Forward).
         * @param {string[]} [keys]
         */
        function notifyChange(keys = []) {
            announce();
            // plots that show this signature's score: update now, or collect the edits behind Update score
            sourceChanged(_id, keys);
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
                window.sessionManager.notifyPanelUpdate();
            }
        }

        // -------------------------------------------------------------------
        // changing the list

        /**
         * Make `genes` the up genes and `down` the down genes, as one undoable step: every change of the list, of a
         * gene's direction included, goes through here, so undo restores both sides.
         * @param {string[]} genes - sorted, distinct
         * @param {string[]} down - sorted, distinct, none of them in `genes`
         * @param {string} label
         * @param {{tick?: boolean, rebuild?: boolean}} [opts] - `tick`: joins the step before it when close in time;
         *   `rebuild`: the rows are rebuilt (the default for anything but a tick)
         */
        function commitLists(genes, down, label, opts = {}) {
            _undo.push(label, _recipe.genes, { tick: opts.tick, down: _recipe.down });
            _recipe.genes = genes;
            _recipe.down = down;
            if (down.length) _recipe.directions = true;
            afterChange(opts.tick && !opts.rebuild ? 'tick' : 'list');
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
         * Add genes.
         * @param {Iterable<string>} names
         * @param {{label?: string, noun?: string, outside?: number}} [opts] - `label`: where they come from ("DE genes")
         * @returns {{ok: boolean, added: number, already: number}}
         */
        function addGenes(names, { label = '', outside = 0, step = '', direction = 'up', move = false } = {}) {
            const list = [...names];
            return addDirected(direction === 'down' ? [] : list, direction === 'down' ? list : [], { label, outside, step, move, asked: list.length });
        }

        /**
         * Add genes on both sides in one undoable step. A gene already in the signature keeps its side, unless `move`
         * (the preview's "change them too"), which puts it on the side it is added as.
         * @param {string[]} up
         * @param {string[]} down
         * @param {{label?: string, outside?: number, step?: string, move?: boolean, asked?: number}} [opts]
         */
        function addDirected(up, down, { label = '', outside = 0, step = '', move = false, asked = up.length + down.length } = {}) {
            let r = { genes: _recipe.genes, down: _recipe.down };
            const pu = planAddAs(r, up, 'up');
            r = { genes: pu.genes, down: pu.down };
            const pd = planAddAs(r, down, 'down');
            r = { genes: pd.genes, down: pd.down };
            let moved = 0;
            if (move) {
                const mu = planDirection(r, up, 'up');
                r = { genes: mu.genes, down: mu.down };
                const md = planDirection(r, down, 'down');
                r = { genes: md.genes, down: md.down };
                moved = mu.changed.length + md.changed.length;
            }
            const n = pu.added.length + pd.added.length;
            const already = Math.max(0, pu.already + pd.already - moved);
            if (!n && !moved) {
                say(asked ? `Nothing new: ${already === 1 ? 'that gene is' : 'those genes are'} already selected.` : 'No genes to add.');
                return { ok: true, added: 0, already };
            }
            const from = label ? ` from ${label}` : '';
            const as = !down.length ? '' : !up.length ? ' as down' : ' as up and down';
            const parts = [];
            if (n) parts.push(`add ${fmtCount(n)} gene${n === 1 ? '' : 's'}${as}${from}`);
            if (moved) parts.push(`change ${fmtCount(moved)} gene${moved === 1 ? '' : 's'} to ${down.length && !up.length ? 'down' : up.length && !down.length ? 'up' : 'the added side'}`);
            commitLists(r.genes, r.down, step || parts.join(' and '));
            let text = '';
            if (n) text = n === 1 && !label && !moved && (pu.added[0] || pd.added[0]) ? `Added ${pu.added[0] || pd.added[0]}${as}.` : `Added ${fmtCount(n)} gene${n === 1 ? '' : 's'}${as}${from}.`;
            if (moved) text += `${text ? ' ' : ''}${fmtCount(moved)} gene${moved === 1 ? '' : 's'} changed direction.`;
            if (already) text += ` ${fmtCount(already)} ${already === 1 ? 'was' : 'were'} already selected.`;
            if (outside) text += ` ${fmtCount(outside)} ${outside === 1 ? 'is' : 'are'} not in this dataset.`;
            say(text);
            return { ok: true, added: n, already, moved };
        }

        /** Tick or untick one gene. */
        function toggleGene(name, checked) {
            if (checked) {
                const plan = planAddAs(_recipe, [name], 'up');
                if (plan.added.length) commitLists(plan.genes, plan.down, `tick ${name}`, { tick: true });
                say(`${name} selected.`);
            } else {
                const side = sideOf(name);
                if (!side) return;
                commitLists(side === 'up' ? _recipe.genes.filter(g => g !== name) : _recipe.genes,
                    side === 'down' ? _recipe.down.filter(g => g !== name) : _recipe.down, `untick ${name}`, { tick: true });
                say(`${name} unselected.`);
            }
        }

        /**
         * Set the direction of genes in the signature, as one undoable step.
         * @param {string[]} names
         * @param {'up'|'down'} direction
         */
        function setDirection(names, direction) {
            const plan = planDirection(_recipe, names, direction);
            if (!plan.changed.length) {
                say(plan.same ? `Already ${direction}.` : 'Nothing to change.');
                return { ok: true, changed: 0 };
            }
            const n = plan.changed.length;
            const filtering = _dirFilter !== 'all' && _view === 'selected';
            // one gene flipped keeps its row where it is, like a tick; a bulk change or an active filter rebuilds the rows
            commitLists(plan.genes, plan.down, n === 1 ? `make ${plan.changed[0]} ${direction}` : `make ${fmtCount(n)} genes ${direction}`,
                { tick: n === 1, rebuild: filtering });
            say(n === 1 ? `${plan.changed[0]} is now ${direction}.` : `${fmtCount(n)} genes are now ${direction}.`);
            return { ok: true, changed: n };
        }

        /** Every gene the search and the filter show, in the Selected view, to one direction. */
        function setShown(direction) {
            if (_view !== 'selected') return;
            setDirection(_rows, direction);
        }

        /** The switch turned off with down genes present: they count as up, in one undoable step. */
        function countDownAsUp() {
            const n = _recipe.down.length;
            if (!n) { _recipe.directions = false; return; }
            commitLists(mergeSorted(_recipe.genes, _recipe.down), [], `count ${fmtCount(n)} down gene${n === 1 ? '' : 's'} as up`);
            _recipe.directions = false;
            _addAs = 'up';
            _dirFilter = 'all';
            rebuildRows();
            paint();
            say(`${fmtCount(n)} down gene${n === 1 ? '' : 's'} now count${n === 1 ? 's' : ''} as up.`);
        }

        /**
         * Up/Down pressed. Turned on, genes can be added and set as down. Turned off with down genes present, it asks first,
         * since they would silently count as up: Count as up (one undoable step) or Keep.
         */
        function onDirectionSwitch(on) {
            if (on) { _askOff = false; setDirections(true); return; }
            if (_recipe.down.length) { _askOff = true; paint(); return; }
            _askOff = false;
            setDirections(false);
        }

        /** Up/Down as an edit of the recipe: its readers and the saved state are told, as for a Methods edit. */
        function setDirections(on) {
            storeOptions({ directions: on });
            sourceChanged(_id, ['directions']);
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        /** Distribution: a Count Plot of the score beside the panel (what Inspect showed), on z-score mean of the signature's input layer. */
        function openDistribution() {
            return PanelManager.createPanelNextTo('cell-count', _id, { mode: 'histogram', x: { source: distributionSource(_id) } });
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
            const n = _recipe.genes.length + _recipe.down.length;
            if (!n) return;
            commitLists([], [], `clear ${fmtCount(n)} genes`);
            say(`Cleared ${fmtCount(n)} gene${n === 1 ? '' : 's'}.`);
        }

        function undo() {
            const step = _undo.pop();
            if (!step) return false;
            _recipe.genes = step.before;
            if (step.down) _recipe.down = step.down;
            if (_recipe.down.length) _recipe.directions = true;
            rebuildRows();
            paint();
            notifyChange();
            say(`Undone: ${step.label}.`);
            return true;
        }

        // -------------------------------------------------------------------
        // the rows

        function viewNames() {
            if (_view === 'all') return _names;
            const names = selectedNames(_recipe);
            if (!_recipe.directions || _dirFilter === 'all') return names;
            return _dirFilter === 'down' ? _recipe.down : _recipe.genes;
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

        /** 'up', 'down' or null for a gene, from sets kept while the lists are the same arrays (every change replaces them). */
        let _sides = { genes: null, down: null, up: null, dn: null };
        function sideOf(name) {
            if (_sides.genes !== _recipe.genes || _sides.down !== _recipe.down) {
                _sides = { genes: _recipe.genes, down: _recipe.down, up: new Set(_recipe.genes), dn: new Set(_recipe.down) };
            }
            return _sides.up.has(name) ? 'up' : _sides.dn.has(name) ? 'down' : null;
        }

        function stateOf(name) {
            const side = sideOf(name);
            const checked = side !== null;
            return {
                checked,
                direction: _recipe.directions && checked ? side : undefined,
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
            const definition = el('div', { class: 'gsig-definition', id: sid('definition') });
            const usedBy = el('div', { class: 'gsig-usedby' });
            const scoreLine = el('div', { class: 'gsig-score' });
            _scoreOptions = createScoreOptions({ id: _id, D, getOptions: getRecipe, setOptions: storeOptions, directions: true });
            // the score's toolbar: the settings of each method, and the score's distribution in a Count Plot (Inspect's job)
            const distributionBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-distribution',
                data: { distribution: '' }, title: 'Open a Cell Count Plot of this score (z-score mean of X) beside the panel',
                on: { click: openDistribution } }, 'Distribution');
            const tools = el('span', { class: 'gsig-status__tools', role: 'toolbar', aria: { label: 'Score' } },
                _scoreOptions.methods.button, distributionBtn);
            status.append(
                el('div', { class: 'gsig-status__row' }, summary, tools),
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
            const addMenu = el('div', { class: 'gs-menu gsig-menu', id: sid('addfrom-menu'), role: 'menu', hidden: true, tabindex: '-1',
                on: { keydown: (e) => onMenuKey(e) } });
            const addMenuHome = el('span', { class: 'gsig-menu-wrap' }, addFrom, addMenu);
            const focusedBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary gsig-focused', hidden: true,
                on: { click: addFocused } });
            // Up/Down is on: what Add from, Paste and the focused gene add as
            const addAsBtn = (value, text) => el('button', { type: 'button', role: 'radio', class: 'gsig-segopt', data: { addAsValue: value },
                on: { click: () => { _addAs = value; paint(); } } }, text);
            const addAsUp = addAsBtn('up', 'Up'), addAsDown = addAsBtn('down', 'Down');
            const addAsSel = el('div', { class: 'gsig-addas', id: sid('addas'), role: 'radiogroup', data: { addAs: '' },
                aria: { label: 'Add as' } }, addAsUp, addAsDown);
            const addAsWrap = el('span', { class: 'gsig-addas-wrap', hidden: true }, el('span', { text: 'Add as ' }), addAsSel);
            // Up/Down: some genes count against the score (a property of the gene list; how they weigh is in Methods)
            const upDown = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gsig-updown', id: sid('updown'),
                data: { directions: '' }, aria: { pressed: 'false' }, on: { click: () => onDirectionSwitch(!_recipe.directions) } }, 'Up/Down');
            const dirAsk = el('div', { class: 'gsig-scoring__notice gsig-dirask', role: 'status', hidden: true, data: { directionAsk: '' } });
            const _flowHost = el('div', { class: 'gsig-flow', hidden: true });
            // the search is not a control: the tile's Hide Controls hides the add row and Up/Down, never the search
            // (a gene table's search stays too), so it sits in a band of its own above them
            const searchBar = el('div', { class: 'gsig-searchbar' },
                el('div', { class: 'gsig-search-row' }, search, regex, matchCase, tickAllBtn),
                searchNote);
            const controls = el('div', { class: 'gsig-controls' },
                el('div', { class: 'gsig-add-row' }, addAsWrap, focusedBtn, ...inlineButtons(), addMenuHome, upDown),
                dirAsk,
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
            // Selected view with directions on: a filter by direction and a bulk change of the rows shown
            const filterSel = el('select', { class: 'form-select form-select-sm gsig-dirfilter', id: sid('dirfilter'), data: { dirFilter: '' },
                aria: { label: 'Show genes' }, on: { change: () => { _dirFilter = ['up', 'down'].includes(filterSel.value) ? filterSel.value : 'all'; rebuildRows({ top: true }); paint(); } } },
            el('option', { value: 'all', text: 'All' }), el('option', { value: 'up', text: 'Up' }), el('option', { value: 'down', text: 'Down' }));
            const setUpBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { setShown: 'up' },
                on: { click: () => setShown('up') } });
            const setDownBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', data: { setShown: 'down' },
                on: { click: () => setShown('down') } });
            const dirBar = el('div', { class: 'gsig-dirbar', hidden: true },
                el('label', { class: 'gsig-dirbar__filter', for: sid('dirfilter') }, el('span', { text: 'Show ' }), filterSel), setUpBtn, setDownBtn);

            const note = el('div', { class: 'gsig-note-line' });
            const message = el('div', { class: 'gsig-message', role: 'status', aria: { live: 'polite' }, id: sid('message') });
            const empty = el('div', { class: 'gsig-empty', hidden: true });

            _grid = createGeneGrid({
                doc: document, label: 'Genes', stateOf,
                onToggle: (name, checked) => toggleGene(name, checked),
                onDirection: (name, direction) => setDirection([name], direction)
            });
            // the banner under the list ("5 of 3,000 genes selected") is the strip a plot has under it: it follows the grid
            if (!_grid.element.id) _grid.element.id = sid('grid');

            const root = el('div', { class: 'gsig-panel' });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            root.addEventListener('keydown', onPanelKey);
            root.addEventListener('dragover', onPanelDragOver);
            root.addEventListener('drop', onPanelDrop);
            root.append(status, searchBar, controls, listbar, dirBar, message, note, empty, _grid.element);
            _container.innerHTML = '';
            _container.appendChild(root);
            _dom = { root, searchBar, controls, flowHost: _flowHost, status, summary, definition, usedBy, scoreLine, search, regex, matchCase, tickAllBtn, searchNote,
                addFrom, addMenu, addMenuHome, focusedBtn, allBtn, selBtn, undoBtn, clearBtn, listbar, message, note, empty,
                addAsWrap, addAsSel, addAsUp, addAsDown, dirBar, filterSel, setUpBtn, setDownBtn, upDown, dirAsk, distributionBtn,
                noData: root.querySelector(`#loading-screen-${_id}`) };
        }

        /** Repaint everything that states the list: counts, buttons, notes. */
        function paint() {
            if (!_dom) return;
            const n = _recipe.genes.length + _recipe.down.length;
            const loaded = _nameSet.size > 0;
            const counts = directionCounts(_recipe);
            // how many are selected is the banner at the bottom (paintBanner); the top keeps only the first hint
            _dom.summary.textContent = n ? '' : 'Tick genes to build a score.';
            _dom.summary.hidden = !!n;
            paintBanner(loaded);
            // no single definition here: each plot or table chooses its method and layer (the Methods pop-over holds their settings)
            const sides = loaded ? emptySideNote() : '';
            // genes not in this dataset are a note of the banner at the bottom (paintBanner), so this line rarely appears
            _dom.definition.textContent = sides;
            _dom.definition.hidden = !_dom.definition.textContent;
            paintFocused();

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
                ? `Selected ${fmtCount(_matches.length)} ${_matches.length === 1 ? 'match' : 'matches'}` : `Selected ${fmtCount(n)}${counts ? `: ${counts}` : ''}`;
            for (const [btn, v] of [[_dom.allBtn, 'all'], [_dom.selBtn, 'selected']]) {
                btn.setAttribute('aria-checked', String(_view === v));
                btn.tabIndex = _view === v ? 0 : -1;
                btn.classList.toggle('active', _view === v);
            }

            paintDirections();

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
            if (_scoreOptions) _scoreOptions.paint();
            _dom.message.textContent = _message;
            _dom.message.title = _message;
        }

        /**
         * The status banner at the bottom of the panel: "5 of 3,000 genes selected", the same strip (utils/panel-surface.js)
         * as a plot's "n of N cells shown", always there once the genes are known so the list never moves when it changes.
         * Its details say how many are not selected.
         */
        function paintBanner(loaded) {
            if (!loaded || !_grid) return;
            const total = _names.length;
            const all = [..._recipe.genes, ..._recipe.down];
            const shown = all.filter(g => _nameSet.has(g)).length;
            const missing = all.length - shown;
            const gaps = [];
            if (shown < total) gaps.push({ reason: GAP.FILTERED, kind: 'unselected', detail: 'not ticked in this signature', count: total - shown });
            // a selected gene the dataset lacks is not among its genes: a note, counted in its own words
            if (missing) gaps.push({ reason: GAP.UNAVAILABLE, source: `${fmtCount(missing)} selected gene${missing === 1 ? '' : 's'}`, hides: false });
            const coverage = new Coverage({ shown, total, unit: 'genes', gaps });
            renderCoverageNotice(_grid.element, coverage, 'genes', { persistent: true, verb: 'selected' });
        }

        /** "None of the 8 down genes are in this dataset, so only up genes are scored." (and the same for up). */
        function emptySideNote() {
            if (!_recipe.directions || !_recipe.down.length) return '';
            const absent = (list) => list.length > 0 && list.every(g => !_nameSet.has(g));
            const none = (list, side) => (list.length === 1 ? `The ${side} gene is` : list.length === 2 ? `Both ${side} genes are`
                : `None of the ${fmtCount(list.length)} ${side} genes are`);
            if (absent(_recipe.down) && !absent(_recipe.genes)) {
                return `${none(_recipe.down, 'down')} not in this dataset, so only up genes are scored.`;
            }
            if (absent(_recipe.genes) && !absent(_recipe.down) && _recipe.genes.length) {
                return `${none(_recipe.genes, 'up')} not in this dataset, so only down genes are scored.`;
            }
            if (!_recipe.genes.length && !absent(_recipe.down)) return 'All genes are down, so the score is the negative of their average.';
            return '';
        }

        /** Up/Down, and the controls that exist only while it is on. */
        function paintDirections() {
            const on = !!_recipe.directions;
            _dom.upDown.setAttribute('aria-pressed', String(on));
            _dom.upDown.classList.toggle('active', on);
            _dom.upDown.title = on ? 'Some genes count against the score. Click to score every gene as up.'
                : 'Score some genes as down: they count against the score';
            const n = _recipe.down.length;
            _askOff = _askOff && n > 0 && on;
            _dom.dirAsk.hidden = !_askOff;
            D.clear(_dom.dirAsk);
            if (_askOff) {
                _dom.dirAsk.append(`${fmtCount(n)} down gene${n === 1 ? '' : 's'} will count as up. `,
                    D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { countAsUp: '' },
                        on: { click: () => { _askOff = false; countDownAsUp(); } } }, 'Count as up'), ' ',
                    D.el('button', { type: 'button', class: 'btn btn-link btn-sm gsig-link', data: { keepDown: '' },
                        on: { click: () => { _askOff = false; paint(); } } }, 'Keep'));
            }
            _dom.addAsWrap.hidden = !on;
            for (const [btn, v] of [[_dom.addAsUp, 'up'], [_dom.addAsDown, 'down']]) {
                const chosen = (on ? _addAs : 'up') === v;
                btn.setAttribute('aria-checked', String(chosen));
                btn.classList.toggle('active', chosen);
            }
            const bar = on && _view === 'selected' && (_recipe.genes.length + _recipe.down.length) > 0;
            _dom.dirBar.hidden = !bar;
            if (!bar) return;
            _dom.filterSel.value = _dirFilter;
            const shown = _view === 'selected' ? _rows.length : 0;
            const would = (dir) => planDirection(_recipe, _rows, dir).changed.length;
            for (const [btn, dir] of [[_dom.setUpBtn, 'up'], [_dom.setDownBtn, 'down']]) {
                btn.textContent = `Set ${fmtCount(shown)} shown to ${dir === 'up' ? 'Up' : 'Down'}`;
                btn.disabled = shown === 0 || would(dir) === 0;
                btn.title = btn.disabled ? `Every gene shown is already ${dir}` : `Make the ${fmtCount(shown)} genes shown ${dir} (can be undone)`;
            }
        }

        /**
         * What the score of this signature is doing, when plots or tables show it: computing with Cancel,
         * edits held back behind Update score, a score that asks first, a failure. Nothing when nothing needs it.
         */
        function paintScore() {
            if (!_dom || !_dom.scoreLine) return;
            const st = sourceStatus(_id);
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
            } else if (!st.dependants) {
                // nothing shows this score, so none is computed; the genes are counted from the dataset's names
                const all = [..._recipe.genes, ..._recipe.down];
                if (all.length && _nameSet.size > 0) {
                    const present = all.filter(g => _nameSet.has(g)).length;
                    text = `Ready, ${fmtCount(present)} of ${fmtCount(all.length)} gene${all.length === 1 ? '' : 's'} in this dataset.`;
                }
            } else if (st.dependants && st.state === 'ready' && st.header) {
                text = `Score ready: ${fmtCount(st.header.n_used)} gene${st.header.n_used === 1 ? '' : 's'} used.`;
            }
            // the line stays, empty or not: the list under it never moves (styles.css .gsig-score)
            line.title = text;
            if (text) line.append(D.el('span', { class: 'gsig-score__text', text }), action || '');
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
            if (_dom) { _dom.message.textContent = text; _dom.message.title = text; }
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
                if (sideOf(target)) say(`${target} is already selected.`);
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

        function menuParts() {
            return { button: _dom.addFrom, menu: _dom.addMenu };
        }

        /** Put the open menu where the button is, in the viewport, above every panel; flip or slide at the edges. */
        function placeMenu() {
            if (!_dom || _openMenu !== 'addfrom') return;
            const { button, menu } = menuParts();
            const b = button.getBoundingClientRect();
            const margin = 4;
            menu.style.maxHeight = `${Math.max(120, window.innerHeight - 2 * margin)}px`;
            const w = menu.offsetWidth, h = menu.offsetHeight;
            let left = Math.min(Math.max(margin, b.left), Math.max(margin, window.innerWidth - w - margin));
            let top = b.bottom + 2;
            if (top + h > window.innerHeight - margin) {
                const above = b.top - 2 - h;
                top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
            }
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        }

        function toggleMenu(which) {
            if (_openMenu === which) { closeMenus(); return; }
            closeMenus();
            const { button, menu } = menuParts();
            D.clear(menu);
            const items = addFromItems();
            if (!items.length) {
                menu.appendChild(D.el('div', { class: 'gs-menu__item gsig-menu__none', text: 'Nothing to add from' }));
            }
            for (const item of items) {
                menu.appendChild(D.el('button', { type: 'button', role: 'menuitem', class: 'gs-menu__item', disabled: !!item.disabled,
                    title: item.disabled || undefined, data: { id: item.id },
                    on: { click: () => { closeMenus(); button.focus(); item.run(); } } }, item.label));
            }
            // a portal to body: the panel and its neighbours clip and stack what is inside them
            document.body.appendChild(menu);
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            _openMenu = which;
            placeMenu();
            const first = menu.querySelector('button:not(:disabled)');
            // an empty menu takes the focus itself, so Esc still closes it
            (first || menu).focus({ preventScroll: true });
        }

        function closeMenus() {
            if (!_dom) return;
            const { button, menu } = menuParts();
            menu.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            if (menu.parentElement === document.body) _dom.addMenuHome.appendChild(menu);
            _openMenu = null;
        }

        function onMenuKey(e) {
            const { button, menu } = menuParts();
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { closeMenus(); button.focus(); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === 'ArrowDown') { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
            else if (e.key === 'Tab') closeMenus();
        }

        function onDocumentClick(e) {
            if (_openMenu && _dom && !e.target.closest('.gsig-menu-wrap') && !e.target.closest('.gsig-menu')) closeMenus();
        }

        /** A table filter or a source changed somewhere: who uses this signature may have changed. */
        function onSomeSelectChanged(e) {
            if (e.target && e.target.tagName === 'SELECT') setTimeout(paintUsedBy, 0);
        }

        /** What "Add from" offers: genes fixed in plots (the focused gene has its own button), every gene table, and what later steps add. */
        function addFromItems() {
            const items = [];
            const inData = (g) => _nameSet.has(g);
            const seen = new Set();
            for (const f of getFixedGenes()) {
                if (f.source === 'focused' || !f.gene || seen.has(f.gene) || !inData(f.gene)) continue;
                seen.add(f.gene);
                const where = `fixed in ${f.panelTitle}`;
                items.push({ id: `gene:${f.gene}`, label: `${f.gene} · ${where}`, run: () => addGenes([f.gene], { direction: currentAddAs() }) });
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
                    run: () => addGenes(names, { label: title, outside, direction: currentAddAs() }) });
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

        /** The focused gene as a one-click add; disabled, with the reason, when it cannot be added. */
        function paintFocused() {
            if (!_dom) return;
            const gene = DataManager.getFocusedGene();
            const btn = _dom.focusedBtn;
            btn.hidden = !gene;
            if (!gene) return;
            let reason = '';
            if (_nameSet.size && !_nameSet.has(gene)) reason = `${gene} is not in this dataset`;
            else if (sideOf(gene)) reason = `${gene} is already in the list`;
            const as = _recipe.directions && _addAs === 'down' ? ' as down' : '';
            btn.textContent = `+ ${gene}${as} (focused)`;
            btn.disabled = !!reason;
            btn.title = reason || `Add the focused gene ${gene}${as}`;
            btn.setAttribute('aria-label', reason ? `Add ${gene}, focused: unavailable, ${reason}` : `Add ${gene}${as}, the focused gene`);
        }

        function addFocused() {
            const gene = DataManager.getFocusedGene();
            if (gene && _dom && !_dom.focusedBtn.disabled) addGenes([gene], { direction: currentAddAs() });
        }

        /** What Add from and the focused gene add as: up unless Up/Down is on and Down is chosen. */
        function currentAddAs() {
            return _recipe.directions && _addAs === 'down' ? 'down' : 'up';
        }

        // -------------------------------------------------------------------
        // events from the page

        function onDataUpdate(updateType) {
            if (updateType === 'datasetChanged') {
                if (!_initialized) return undefined;
                closeFlow(null, { focus: false });
                loadGenes();
                if (_scoreOptions) _scoreOptions.datasetChanged();
                _dom.noData.style.display = 'none';
                syncControlsWithDataset(_dom.controls, true);
                rebuildRows({ top: true });
                paint();
                notifyChange();
            }
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
            destroy: cleanup,
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
            getGrading,
            /** What the default score depends on, as text: equal recipes give equal text (the tests compare it across a link). */
            getRecipeHash: () => recipeHash(_recipe),
            openDistribution,
            addGenes,
            addDirected,
            setDirection,
            getAddAs: () => currentAddAs(),
            directionsOn: () => !!_recipe.directions,
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
