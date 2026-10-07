/**
 * Gene Set Analysis Panel
 *
 * Follows one Gene Table: the genes passing its filter (the selection, as
 * plots read it) and the focused gene. Each section asks one external
 * service (STRING, g:Profiler, MyGene.info; Enrichr, Reactome and the Human
 * Protein Atlas when turned on) and fails on its own; the Links section is
 * made locally and works offline.
 *
 * Nothing is sent until the user asks: a Run (or, after one, auto-update)
 * takes a snapshot of the selection and fetches the visible sections that
 * need it. Opening the app, a link, a panel set or a session makes no
 * external request. With auto-update off (the default) a changed selection
 * is stated in the bar above the sections, with one click to refresh.
 *
 * DOM and wiring only. What is decided is in gene-set-utilities/ (state.js:
 * snapshot, keys, staleness; runner.js: requests, retries, pacing; links.js:
 * the links), which Node tests cover.
 */
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { Coverage, GAP } from '../utils/coverage.js';
import { drawPlaceholder, renderCoverageNotice } from '../utils/panel-surface.js';
import { noDatasetScreenHtml } from '../utils/no-dataset-screen.js';
import { setControlsVisible, syncControlsWithDataset } from '../utils/controls-visibility.js';
import { mountNamePicker } from '../utils/name-picker.js';
import { makeDom, sci, toCsv } from './gene-set-utilities/dom.js';
import {
    setHash, inputKey, readTableSelection, selectionIds, makeSnapshot, panelStaleness, fmt,
    settleRun, needsFetch, blockedReason, normalizeConfig, configOf, startRun, pickIdColumn, ID_COLUMN_PREFERENCE
} from './gene-set-utilities/state.js';
import { createRunner } from './gene-set-utilities/runner.js';
import { createConsent } from './gene-set-utilities/consent.js';
import { enabledAdapters, hostsOf } from './gene-set-utilities/registry.js';
import { registerAll } from './gene-set-utilities/services/index.js';
import { xrefsOf } from './gene-set-utilities/services/mygene.js';
import {
    detectIdType, geneRecord, geneLinks, geneLink, setLinks, defaultColumns, columnChoices, linksCsv, resourceById, stripVersion
} from './gene-set-utilities/links.js';
import {
    speciesOf, speciesLabel, searchSpecies, remoteSpeciesSearch, learnSpecies, speciesFromIds, speciesFromText, UNS_SPECIES_KEYS
} from './gene-set-utilities/species.js';

registerAll();

/** Selection changes closer together than this make one auto-update. */
const AUTO_DEBOUNCE_MS = 750;
/** Rows of the Links list per page (the DOM stays small at 30k genes). */
const LIST_PAGE = 50;

/** What a blocked run is, as a coverage gap: [reason, kind] (coverage.js KIND_LABEL). */
const GAP_OF = {
    empty: [GAP.EMPTY, ''], capped: [GAP.CAPPED, 'over-limit'], species: [GAP.UNAVAILABLE, 'unsupported'],
    idtype: [GAP.UNAVAILABLE, 'unsupported'], unfocused: [GAP.UNFOCUSED, ''], declined: [GAP.UNAVAILABLE, 'declined'],
    // asked, and the service knew none of the genes (an answer, not a failure)
    unmapped: [GAP.UNAVAILABLE, 'unmapped']
};

const STATUS_WORD = { idle: 'not run', loading: 'loading…', ok: 'ok', stale: 'stale', error: 'error' };

const GeneSetPanel = (function() {
    /**
     * Gene Set Panel constructor. Touches no DOM and adds no listener: a
     * closed panel restored from a panel set is constructed and never
     * initialized (PanelManager.registerClosedPanel).
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options (a saved config)
     */
    function GeneSetPanel(container, options = {}) {
        const _id = options.id || `gene-set-${Date.now()}`;
        let _title = options.title || 'Gene Set Analysis';
        const _container = container;
        const _adaptersAll = enabledAdapters(null);
        const _settings = normalizeConfig(options, _adaptersAll, (m) => console.warn(`Gene set panel ${_id}: ${m}`));
        let _controlsVisible = options.controlsVisible;

        // derived, never saved
        let _adapters = _adaptersAll;
        let _runner = null;
        let _snapshot = null;
        let _armed = false;           // a Run happened in this page: auto-update may fetch
        let _source = { status: 'none', title: '', names: null, ids: [], hash: null, count: 0, missingIds: 0 };
        let _focus = { name: null, id: null };
        let _dataset = null;
        let _genes = [];              // the dataset's gene names (var index)
        let _geneSet = null;
        let _ids = null;              // {column, byName: Map, toName: Map} for an ID column
        let _idType = 'unknown';      // how the ids are read: the setting, or detected
        let _detectedType = 'unknown';
        let _varColumns = [];
        let _unsKeys = [];
        let _speciesWhy = null;       // why this species: 'explicit', 'ensembl', 'uns:<key>', 'default'
        let _dataTaxonomyId = null;   // the species the dataset itself points to (uns, Ensembl ids), chosen or not
        let _pending = null;          // sections waiting for consent
        let _notice = null;           // a one-off line in the bar ("Not sent")
        let _autoTimer = null;
        let _sourceQueued = false;
        let _listPage = 0;
        let _listFilter = '';
        let _initialized = false;
        let _picker = null;
        const _blobUrls = new Map();  // section -> object URLs to revoke
        const _disposers = new Map(); // section -> render disposer
        // section -> view choices made in a drawn result (STRING's category,
        // a table shown in full): a rerun redraws the section from scratch, and
        // these used to go back to their defaults with it (renderCtx view)
        const _views = new Map();
        const _listeners = [];
        let _dom = null;              // element references, after init
        let D = null;                 // el/table/link builders

        // -------------------------------------------------------------------
        // life cycle

        /** Build the panel and listen; never fetches. */
        function init() {
            D = makeDom(document);
            _initialized = true;
            _adapters = enabledAdapters(Config.INTEGRATIONS);
            _runner = createRunner({
                fetchImpl: (...a) => window.fetch(...a),
                setTimeout: (...a) => window.setTimeout(...a),
                clearTimeout: (t) => window.clearTimeout(t),
                now: () => Date.now(),
                timeoutMs: Config.INTEGRATIONS.timeoutMs,
                // tells "this browser is offline" from a host that does not answer
                online: () => (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : undefined),
                onChange: (sid) => {
                    paintSection(sid);
                    // the gene card's ids make the focused gene's links direct
                    if (sid === 'mygene-card') paintSection('links');
                    paintBar();
                }
            });
            buildDom();
            listen(document, 'focusedGeneChanged', onFocusChanged);
            listen(document, 'taxonomyIdChanged', onSpeciesChanged);
            listen(window, 'online', onOnline);
            listen(window, 'offline', paintAll);
            listen(document, 'click', onDocumentClick);
            const loaded = DataManager.isDatasetLoaded();
            _dom.noData.style.display = loaded ? 'none' : 'flex';
            syncControlsWithDataset(_dom.controls, loaded);
            if (_controlsVisible === false) setControlsVisible(_dom.controls, false);
            if (loaded) onDatasetLoaded(DataManager.getCurrentDataset());
            else paintAll();
        }

        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            _listeners.push([target, type, fn]);
        }

        /** Abort everything, drop every timer, listener, object URL and result. */
        function cleanup() {
            if (_runner) _runner.dispose();
            clearTimeout(_autoTimer);
            _autoTimer = null;
            for (const [target, type, fn] of _listeners.splice(0)) target.removeEventListener(type, fn);
            for (const sid of [..._blobUrls.keys()]) revokeSection(sid);
            if (_picker) _picker.close();
            _snapshot = null;
            _pending = null;
            _initialized = false;
            _dom = null;
            _container.innerHTML = '';
        }

        function destroy() {
            cleanup();
        }

        async function onDatasetLoaded(path) {
            _dataset = path;
            _genes = DataManager.getGenes();
            _geneSet = null;
            _ids = null;
            _snapshot = null;
            _armed = false;
            _pending = null;
            if (_runner) _runner.reset();
            _dom.noData.style.display = 'none';
            syncControlsWithDataset(_dom.controls, true);
            await loadIdColumns(path);
            await ensureIds();
            await inferSpecies();
            const f = DataManager.getFocusedGene();
            _focus = { name: f || null, id: f ? idOf(f) : null };
            _loadTried = false;
            refreshSource();
            paintAll();
            maybeAutoOnLoad();
        }

        /** The var columns offered under IDs (the var index first). */
        async function loadIdColumns(path) {
            let columns = [];
            try {
                const structure = await DataManager.getDatasetStructure(path);
                _unsKeys = structure && structure.uns && Array.isArray(structure.uns.keys) ? structure.uns.keys : [];
                const v = structure && structure.var;
                columns = (v && (v.columns || Object.keys(v))) || [];
            } catch (error) {
                console.warn(`Gene set panel ${_id}: no var columns:`, error);
            }
            _varColumns = columns.filter(c => c !== '_index');
            fillIdOptions();
        }

        function fillIdOptions() {
            const sel = _dom.ids;
            D.clear(sel);
            const auto = pickIdColumn(_varColumns);
            sel.appendChild(D.el('option', { value: 'auto', text: `Auto: ${auto === '_index' ? 'var index' : auto}` }));
            sel.appendChild(D.el('option', { value: '_index', text: 'var index' }));
            for (const c of _varColumns) sel.appendChild(D.el('option', { value: c, text: c }));
            const col = _settings.idColumn;
            if (col !== 'auto' && col !== '_index' && !_varColumns.includes(col)) {
                sel.appendChild(D.el('option', { value: col, text: `${col} (not in this dataset)` }));
            }
            sel.value = col;
        }

        /** The column the ids come from: the setting, or for 'auto' pickIdColumn's choice. */
        function idCol() {
            return _settings.idColumn === 'auto' ? pickIdColumn(_varColumns) : _settings.idColumn;
        }

        /** What the ids are, in words, as the bar and the snapshot name them. */
        function idLabel() {
            const words = { symbol: 'gene names', ensembl: 'Ensembl ids', entrez: 'Entrez ids', unknown: 'ids' };
            return `${idCol() === '_index' ? 'var index' : idCol()} as ${words[_idType]}`;
        }

        /** The ID column's values by gene name (read once per dataset and column). */
        async function ensureIds() {
            const col = idCol();
            if (col === '_index') {
                _ids = null;
            } else if (!_ids || _ids.column !== col || _ids.dataset !== _dataset) {
                try {
                    const resp = await DataManager.loadVar({ datasetPath: _dataset, columns: [col] });
                    const values = resp && resp.data && resp.data[col];
                    if (!values || typeof values.length !== 'number') throw new Error(`no values for ${col}`);
                    const byName = new Map(), toName = new Map();
                    const genes = _genes;
                    for (let i = 0; i < genes.length; i++) {
                        const v = values[i];
                        const id = v === null || v === undefined ? '' : String(v);
                        byName.set(genes[i], id);
                        if (id && !toName.has(id)) toName.set(id, genes[i]);
                        // the id as sent, without an Ensembl version, finds its gene too
                        const bare = id ? stripVersion(id) : '';
                        if (bare && !toName.has(bare)) toName.set(bare, genes[i]);
                    }
                    _ids = { column: col, dataset: _dataset, byName, toName, error: null };
                } catch (error) {
                    console.warn(`Gene set panel ${_id}: cannot read ${col}:`, error);
                    _ids = { column: col, dataset: _dataset, byName: new Map(), toName: new Map(), error: String(error.message || error) };
                }
            }
            _detectedType = detectIdType(_genes.slice(0, 200).map(rawIdOf).filter(Boolean));
            _idType = _settings.idType === 'auto' ? _detectedType : _settings.idType;
            const words = { symbol: 'gene names (symbols)', ensembl: 'Ensembl ids', entrez: 'Entrez ids', unknown: 'mixed ids' };
            _dom.idTypeAuto.textContent = `Auto: ${words[_detectedType]}`;
            _dom.idType.value = _settings.idType;
        }

        /** A gene's value in the ID column, as stored. */
        function rawIdOf(name) {
            if (!name) return null;
            if (idCol() === '_index') return name;
            const id = _ids && _ids.byName.get(name);
            return id ? id.trim() : null;
        }

        /** A gene's id as sent: Ensembl ids without their version (ENSG….16 -> ENSG…). */
        function idOf(name) {
            const id = rawIdOf(name);
            return id && _idType === 'ensembl' ? stripVersion(id) : id;
        }

        /**
         * The dataset's species, when nobody chose it (not a user, not a
         * link, not a panel set): a species or organism entry of uns, else
         * the Ensembl prefix of the ids (ENSMUSG: mouse); without either,
         * the server's default stays, marked as unconfirmed. A user's pick
         * always wins (DataManager source 'explicit').
         */
        /**
         * What the dataset says its species is: an uns entry (taxonomy_id,
         * taxid, species, organism, ...), else the Ensembl prefixes of the ID
         * column, the var index, or another var column of ids (gene_ids,
         * wbgene, ...). {tax, why} or null.
         */
        async function datasetSpecies() {
            const keys = new Map(_unsKeys.map(k => [String(k).toLowerCase(), k]));
            for (const name of UNS_SPECIES_KEYS) {
                const key = keys.get(name);
                if (!key) continue;
                let tax;
                try {
                    const resp = await DataManager.loadUns({ datasetPath: _dataset, unsKey: key });
                    tax = speciesFromText(resp && resp.data);
                } catch { tax = null; }
                if (tax) return { tax, why: `uns:${key}` };
            }
            const fromIds = speciesFromIds(_genes.slice(0, 500).map(rawIdOf)) || speciesFromIds(_genes.slice(0, 500));
            if (fromIds) return { tax: fromIds, why: 'ensembl' };
            // other columns of ids, in the order Auto would pick them
            const idCols = ID_COLUMN_PREFERENCE.slice(0, 2).flat();
            const lower = new Map(_varColumns.map(c => [c.toLowerCase(), c]));
            for (const name of idCols) {
                const col = lower.get(name);
                if (!col || col === idCol()) continue;
                try {
                    const resp = await DataManager.loadVar({ datasetPath: _dataset, columns: [col] });
                    const values = resp && resp.data && resp.data[col];
                    const tax = values ? speciesFromIds(Array.from({ length: Math.min(500, values.length) }, (_, i) => String(values[i] ?? ''))) : null;
                    if (tax) return { tax, why: 'ensembl' };
                } catch { /* a column that cannot be read says nothing */ }
            }
            return null;
        }

        /**
         * The dataset's species, when nobody chose it (not a user, not a
         * link, not a panel set): what datasetSpecies finds; without it, the
         * server's default stays, marked as unconfirmed. A user's pick always
         * wins (DataManager source 'explicit'); what the dataset says is kept
         * anyway, for the hint when a service knows none of the genes.
         */
        async function inferSpecies() {
            const found = await datasetSpecies();
            _dataTaxonomyId = found ? found.tax : null;
            if (DataManager.getTaxonomySource() === 'explicit') { _speciesWhy = 'explicit'; paintSpecies(); return; }
            if (found) {
                _speciesWhy = found.why;
                if (found.tax !== taxonomyId() || DataManager.getTaxonomySource() !== 'inferred') {
                    DataManager.setTaxonomyId(found.tax, { source: 'inferred' });
                }
            } else {
                _speciesWhy = DataManager.getTaxonomySource() === 'inferred' ? 'inferred' : 'default';
            }
            paintSpecies();
        }

        /** The species field's text, with why this species. */
        function speciesText() {
            const tax = taxonomyId();
            const sp = speciesOf(tax);
            const name = sp.name || `taxon ${tax}`;
            if (_speciesWhy === 'ensembl') return `Auto: ${name} (from Ensembl IDs)`;
            if (_speciesWhy && _speciesWhy.startsWith('uns:')) return `Auto: ${name} (from uns["${_speciesWhy.slice(4)}"])`;
            if (_speciesWhy === 'default') return `${speciesLabel(tax)} (default, not checked)`;
            return speciesLabel(tax);
        }

        function paintSpecies() {
            if (!_dom) return;
            if (_picker && document.activeElement !== _dom.species) _picker.setValue(speciesText());
            const unconfirmed = _speciesWhy === 'default';
            _dom.species.classList.toggle('gs-species--unconfirmed', unconfirmed);
            if (!_dom.speciesErr.dataset.error) {
                _dom.speciesErr.className = `gs-hint${unconfirmed ? ' gs-hint--warn' : ''}`;
                _dom.speciesErr.textContent = unconfirmed
                    ? 'The dataset does not say its species, and its ids have no Ensembl prefix: this is the server\'s default. Check it.'
                    : '';
            }
        }

        function nameOfId(id) {
            if (idCol() === '_index') return id;
            return (_ids && _ids.toName.get(id)) || id;
        }

        function hasGene(nameOrId) {
            if (!_geneSet) _geneSet = new Set(_genes);
            return _geneSet.has(nameOrId) || !!(_ids && _ids.toName.has(nameOrId));
        }

        // -------------------------------------------------------------------
        // events

        /**
         * PanelManager.notifyPanels. Returns at once: nothing here waits for
         * the network, and nothing uses the broadcast's abort signal (every
         * table keystroke aborts the previous broadcast's).
         */
        function onDataUpdate(updateType, updateData) {
            if (!_initialized) return undefined;
            if (updateType === 'datasetChanged') {
                const path = updateData && updateData.dataset;
                if (path) onDatasetLoaded(path).catch(error => console.error(`Gene set panel ${_id}:`, error));
                return undefined;
            }
            // 'tableChanged' is the legacy DOM listener's name for it, without data
            if (updateType === 'tableFiltered' || updateType === 'tableChanged') {
                const id = updateData && updateData.id;
                if (id && id !== _settings.tableFilter) return undefined;
                queueSourceRefresh();
            }
            return undefined;
        }

        /**
         * Read the source after the broadcast: a table announces its first
         * rows before its DataTable is stored, so it reads as not ready
         * until the current task is done.
         */
        function queueSourceRefresh() {
            if (_sourceQueued) return;
            _sourceQueued = true;
            Promise.resolve().then(() => {
                _sourceQueued = false;
                if (!_initialized) return;
                const before = _source.hash;
                refreshSource();
                paintAll();
                if (_settings.autoUpdate && _armed && _source.hash !== before && sourceChangedSinceSnapshot()) scheduleAuto();
                else maybeAutoOnLoad();
            });
        }

        /** Tables were added, closed, reopened or renamed. */
        function onPanelsChanged() {
            if (!_initialized) return;
            const before = _settings.tableFilter;
            if (fillSourceOptions()) {
                // bound to another (or a first) table: results were for the old one
                if (before !== 'none') _notice = 'The source table was removed; following the next one.';
                setSource(_settings.tableFilter);
                return;
            }
            if (!PanelManager.getPanelsByType('gene-table').length && before !== 'none') {
                setSource('none');
                return;
            }
            queueSourceRefresh();
        }

        function onFocusChanged(e) {
            if (!_initialized || (e.detail && e.detail.duringDatasetTransition)) return;
            const name = (e.detail && e.detail.gene) || null;
            _focus = { name, id: name ? idOf(name) : null };
            settleAll();
            paintAll();
            if (_settings.autoUpdate && _armed) {
                runSections(visibleAdapters().filter(a => a.kind === 'gene'), { auto: true });
            }
        }

        function onSpeciesChanged() {
            if (!_initialized) return;
            if (DataManager.getTaxonomySource() === 'explicit') _speciesWhy = 'explicit';
            paintSpecies();
            settleAll();
            paintAll();
            if (_settings.autoUpdate && _armed) runNow({ auto: true });
        }

        function onOnline() {
            paintAll();
            if (_settings.autoUpdate && _armed) runNow({ auto: true });
        }

        function onDocumentClick(e) {
            // a menu item redraws the menu, so its click arrives here from a
            // detached element: that click was inside, not outside
            if (!e.target.isConnected) return;
            if (_dom && !_dom.sectionsMenu.hidden && !_dom.sectionsWrap.contains(e.target)) closeSectionsMenu();
        }

        function scheduleAuto() {
            clearTimeout(_autoTimer);
            _autoTimer = setTimeout(() => {
                _autoTimer = null;
                runNow({ auto: true });
            }, AUTO_DEBOUNCE_MS);
        }

        // -------------------------------------------------------------------
        // the source and the snapshot

        function taxonomyId() {
            return String(DataManager.getTaxonomyId() || Config.DEFAULTS.TAXONOMY_ID);
        }

        function speciesName() {
            return speciesOf(taxonomyId()).name;
        }

        /** Re-read the source table (cheap: on every redraw of it). */
        function refreshSource() {
            const tf = _settings.tableFilter;
            if (!tf || tf === 'none') {
                _source = { status: 'none', title: '', names: null, ids: [], hash: null, count: 0, missingIds: 0 };
                return;
            }
            const table = PanelManager.getPanel(tf);
            const open = !!table && PanelManager.getActivePanels().includes(table);
            const sel = readTableSelection(table, { open, geneNames: _genes });
            if (!sel.names) {
                _source = { status: sel.status, title: sel.title, names: null, ids: [], hash: null, count: 0, missingIds: 0 };
                return;
            }
            const picked = selectionIds(sel.names, { idColumn: 'mapped', idOf });
            _source = { status: sel.status, title: sel.title, names: picked.names, ids: picked.genes,
                hash: setHash(picked.genes), count: picked.genes.length, missingIds: picked.missingIds, duplicates: picked.duplicates };
        }

        function sourceChangedSinceSnapshot() {
            return !_snapshot || !!panelStaleness(_snapshot, currentDescriptor());
        }

        function currentDescriptor() {
            return { hash: _source.hash, count: _source.count, taxonomyId: taxonomyId(), speciesName: speciesName(),
                idColumn: idLabel(), sourceId: _settings.tableFilter };
        }

        function takeSnapshot() {
            refreshSource();
            if (!_source.names) return null;
            _snapshot = makeSnapshot({ genes: _source.ids, names: _source.names, missingIds: _source.missingIds,
                duplicates: _source.duplicates || 0, sourceId: _settings.tableFilter, sourceTitle: _source.title,
                sourceStatus: _source.status, taxonomyId: taxonomyId(), speciesName: speciesName(),
                idColumn: idLabel(), takenAt: Date.now() });
            return _snapshot;
        }

        /** The dataset's ids, as the enrichment background (once per dataset and ID column). */
        let _background = null;
        function background() {
            const key = `${_dataset}\u0001${idLabel()}\u0001${_genes.length}`;
            if (!_background || _background.key !== key || (_ids && _background.ids !== _ids)) {
                const list = selectionIds(_genes, { idColumn: 'mapped', idOf }).genes;
                _background = { key, ids: _ids, list, hash: setHash(list) };
            }
            return _background;
        }

        function serviceConfig() {
            return { string: { api: Config.STRING_DB.BASE_URL, version: Config.STRING_DB.VERSION } };
        }

        /** What adapter `a` would be sent now: the snapshot (set) or the focus (gene). */
        function inputFor(a) {
            const params = _settings.sections[a.id].params;
            const services = serviceConfig();
            const tax = a.kind === 'gene' ? taxonomyId() : (_snapshot ? _snapshot.taxonomyId : taxonomyId());
            const input = {
                genes: a.kind === 'set' && _snapshot ? _snapshot.genes : [],
                names: a.kind === 'set' && _snapshot ? _snapshot.names : [],
                genesHash: _snapshot ? _snapshot.hash : null,
                focus: _focus.id ? { id: _focus.id, name: _focus.name } : null,
                taxonomyId: tax,
                speciesName: speciesOf(tax).name,
                idType: _idType,
                // what the dataset's ids say, for "is the species right?" when nothing maps
                dataTaxonomyId: _dataTaxonomyId,
                params,
                background: null,
                backgroundHash: null,
                services
            };
            if (a.kind === 'set' && params.background === 'dataset') {
                const bg = background();
                input.background = bg.list;
                input.backgroundHash = bg.hash;
            }
            const key = inputKey(a, {
                genesHash: input.genesHash, focusId: input.focus && input.focus.id, taxonomyId: tax,
                idColumn: a.kind === 'set' && _snapshot ? _snapshot.idColumn : idLabel(),
                params, backgroundHash: input.backgroundHash, service: a.id.startsWith('string') ? services.string.api : ''
            });
            return { input: Object.freeze(input), key };
        }

        function visibleAdapters() {
            return _adapters.filter(a => _settings.sections[a.id] && _settings.sections[a.id].visible);
        }

        /** Mark every section stale or fresh against what it would show now. */
        function settleAll() {
            if (!_runner) return;
            for (const a of _adapters) {
                const run = _runner.get(a.id);
                if (run.status === 'idle' || run.status === 'loading') continue;
                if (a.kind === 'set' && !_snapshot) continue;
                const { key } = inputFor(a);
                _runner.update(a.id, r => settleRun(r, key));
            }
        }

        // -------------------------------------------------------------------
        // running

        function policy() {
            return Config.INTEGRATIONS.externalRequests;
        }

        function offline() {
            return typeof navigator !== 'undefined' && navigator.onLine === false;
        }

        /** Why nothing can run at all, or null. */
        function gate() {
            if (!DataManager.isDatasetLoaded()) return 'no-dataset';
            if (!_settings.tableFilter || _settings.tableFilter === 'none') return 'no-source';
            if (_source.status === 'missing') return 'no-source';
            if (_source.status === 'waiting') return 'waiting';
            if (_source.status === 'closed-unknown') return 'closed-unknown';
            if (idCol() !== '_index' && _ids && _ids.error) return 'ids';
            return null;
        }

        /**
         * Run (and Refresh): a new snapshot of the selection, then every
         * visible section whose input changed. One click; consent first
         * where it is still needed.
         */
        async function runNow({ auto = false, quiet = false } = {}) {
            if (!_initialized) return;
            _notice = null;
            if (idCol() !== '_index') await ensureIds();
            refreshSource();
            if (gate()) { paintAll(); return; }
            takeSnapshot();
            // a Run arms auto-update; an auto-update on opening only once it may send
            if (!quiet) _armed = true;
            settleAll();
            await runSections(visibleAdapters(), { auto, quiet });
        }

        /**
         * Opening a link, a panel set or a session sends nothing, unless
         * auto-update is on and every service it needs is already agreed to
         * (the server's "on", the user's "Always", or the link's consent for
         * exactly this selection). Tried once, when the source is first read.
         */
        let _loadTried = false;
        function maybeAutoOnLoad() {
            if (_loadTried || _armed || !_settings.autoUpdate || gate() || policy() === 'off' || offline()) return;
            _loadTried = true;
            runNow({ auto: true, quiet: true });
        }

        /** The consent rules, for the selection about to be sent (consent.js). */
        function makeConsent() {
            return createConsent({ policy: policy(), storage: safeStorage(), link: _settings.consent,
                selection: _snapshot ? _snapshot.hash : _source.hash });
        }

        /**
         * Remember in the panel's settings which services the user agreed to
         * for this selection: a share link then carries that consent, for
         * exactly this selection and no other.
         */
        function recordConsent(consent, requests) {
            if (!_snapshot || policy() !== 'ask') return;
            const hosts = requests.filter(r => r.persistable && ['page', 'user', 'link'].includes(consent.decide(r).why)
                && consent.decide(r).answer === 'send').map(r => r.host);
            if (!hosts.length) return;
            const same = _settings.consent && _settings.consent.selection === _snapshot.hash;
            _settings.consent = { selection: _snapshot.hash, hosts: [...new Set([...(same ? _settings.consent.hosts : []), ...hosts])].sort() };
        }

        /** A section that is not sent, and why (before any request). */
        function refuse(a, key, error) {
            _runner.abort(a.id);
            _runner.update(a.id, r => ({ ...startRun(r, key, Date.now()), status: 'error', lastInputHash: key,
                error: { attempts: 0, ...error }, prev: null, finishedAt: Date.now() }));
        }

        /**
         * Start `adapters` that need it: blocked ones say why, the rest ask
         * consent, then fetch. `fresh`: asked for by the user, so fetched
         * even when the result is current (and not from the cache).
         * `force`: sent although over the service's limit ("Try anyway").
         * `quiet`: never asks; what is not agreed to is not sent.
         */
        async function runSections(adapters, { auto = false, fresh = false, force = false, quiet = false } = {}) {
            if (!_runner) return;
            let toFetch = [];
            for (const a of adapters) {
                if (a.kind === 'set' && !_snapshot) continue;
                const { input, key } = inputFor(a);
                const run = _runner.get(a.id);
                if (!fresh && !needsFetch(run, key)) continue;
                const blocked = a.kind === 'gene' && _focus.name && !_focus.id
                    ? { kind: 'empty', message: `${_focus.name} has no value in the ID column ${idCol()}.` }
                    : blockedReason(a, input, { force });
                if (blocked) {
                    refuse(a, key, blocked);
                    continue;
                }
                toFetch.push({ adapter: a, input, key, fresh });
            }
            paintAll();
            if (!toFetch.length) return;
            if (policy() === 'off' || offline()) { paintAll(); return; }
            const consent = makeConsent();
            const requestsOf = (t) => hostsOf(t.adapter, t.input).map(host => ({ host, persistable: !t.adapter.privacy, adapter: t.adapter, input: t.input }));
            // the user said "Never" to a service: its sections say so, and are not sent
            toFetch = toFetch.filter(t => {
                const denied = consent.denied(requestsOf(t));
                if (!denied.length) return true;
                refuse(t.adapter, t.key, { kind: 'declined', hosts: denied,
                    message: `You chose not to send gene ids to ${denied.join(', ')} (in this browser).` });
                return false;
            });
            if (!toFetch.length) { paintAll(); return; }
            // a cached result is shown without a request, so without asking
            const requests = toFetch.filter(x => x.fresh || !_runner.has(x.key)).flatMap(requestsOf);
            const missing = consent.missing(requests);
            if (missing.length) {
                if (quiet) { paintAll(); return; }
                _pending = { toFetch, requests: missing, all: requests, consent, auto };
                paintAll();
                return;
            }
            if (quiet) _armed = true;
            recordConsent(consent, requests);
            startFetches(toFetch);
        }

        function startFetches(toFetch) {
            const batch = toFetch.map(({ adapter, input, key, fresh }) => _runner.start(adapter.id, adapter, input, key, { fresh }));
            Promise.all(batch).then(() => {
                settleAll();
                paintBar();
            }, (error) => console.error(`Gene set panel ${_id}:`, error));
            paintAll();
        }

        /** The answer to the consent bar: send, always, never, or cancel. */
        function answerConsent(answer) {
            const p = _pending;
            _pending = null;
            if (!p) return;
            if (answer === 'cancel') {
                _notice = 'Not sent: nothing left this browser.';
                // auto-update waits for the next Run, rather than asking again at every change
                _armed = false;
                paintAll();
                return;
            }
            if (answer === 'never') {
                p.consent.deny(p.requests);
                // sections of those services now say so; the others are sent if agreed to
                runSections(p.toFetch.map(t => t.adapter), { auto: p.auto, fresh: true, quiet: true });
                return;
            }
            p.consent.grant(p.requests, { always: answer === 'always' });
            recordConsent(p.consent, p.all);
            startFetches(p.toFetch);
        }

        /** Forget a "Never" for these hosts, then try the section again (it asks). */
        function askAgain(a, hosts) {
            makeConsent().forget(hosts);
            refreshSection(a);
        }

        function safeStorage() {
            try {
                return window.localStorage;
            } catch {
                return null;
            }
        }

        /** A section's own refresh (header button, Retry). */
        function refreshSection(a) {
            if (a.kind === 'set' && (!_snapshot || sourceChangedSinceSnapshot())) {
                runNow();
                return;
            }
            _armed = true;
            runSections([a], { fresh: true });
        }

        // -------------------------------------------------------------------
        // DOM

        function buildDom() {
            const { el } = D;
            const sid = (x) => `gs-${x}-${_id}`;
            const source = el('select', { class: 'form-select form-select-sm', id: sid('source'),
                on: { change: (e) => setSource(e.target.value) } });
            const ids = el('select', { class: 'form-select form-select-sm', id: sid('ids'), title: 'The var column whose values are sent and linked',
                on: { change: (e) => setIdColumn(e.target.value) } }, el('option', { value: 'auto', text: 'Auto' }));
            const idTypeAuto = el('option', { value: 'auto', text: 'Auto' });
            const idType = el('select', { class: 'form-select form-select-sm gs-idtype', id: sid('idtype'),
                aria: { label: 'Read the ids as' }, title: 'How the values are read: gene names (symbols), Ensembl or Entrez ids',
                on: { change: (e) => setIdType(e.target.value) } },
            idTypeAuto, el('option', { value: 'symbol', text: 'Gene names (symbols)' }),
            el('option', { value: 'ensembl', text: 'Ensembl ids' }), el('option', { value: 'entrez', text: 'Entrez ids' }));
            idType.value = _settings.idType;
            const species = el('input', { type: 'text', class: 'form-control form-control-sm', id: sid('species'),
                placeholder: 'name, common name or taxonomy id', value: speciesText(),
                aria: { describedby: sid('species-err') } });
            const speciesErr = el('span', { class: 'gs-hint', id: sid('species-err'), aria: { live: 'polite' } });
            const run = el('button', { type: 'button', class: 'btn btn-sm btn-primary gs-run', on: { click: () => runNow() } });
            const auto = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gs-auto',
                aria: { pressed: String(_settings.autoUpdate) }, title: 'Refresh whenever the source table changes',
                on: { click: toggleAuto } }, 'Auto-update');
            const sectionsBtn = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gs-sections-btn',
                aria: { haspopup: 'true', expanded: 'false', controls: sid('menu') }, on: { click: toggleSectionsMenu } });
            const sectionsMenu = el('div', { class: 'gs-menu', id: sid('menu'), role: 'menu', hidden: true,
                on: { keydown: onMenuKey } });
            const sectionsWrap = el('span', { class: 'gs-sections-wrap' }, sectionsBtn, sectionsMenu);
            const controls = el('div', { class: 'gs-controls' },
                el('div', { class: 'ctl-grid gs-grid' },
                    el('div', { class: 'ctl-group', role: 'group', aria: { label: 'Source' } },
                        el('div', { class: 'ctl-row' }, el('label', { class: 'ctl-label', for: sid('source'), text: 'Source' }), el('div', { class: 'ctl-field' }, source)),
                        el('div', { class: 'ctl-row' }, el('label', { class: 'ctl-label', for: sid('ids'), text: 'IDs' }), el('div', { class: 'ctl-field' }, ids, idType)),
                        el('div', { class: 'ctl-row' }, el('label', { class: 'ctl-label', for: sid('species'), text: 'Species' }),
                            el('div', { class: 'ctl-field gs-species' }, species, speciesErr))),
                    el('div', { class: 'ctl-group gs-run-group', role: 'group', aria: { label: 'Run' } },
                        el('div', { class: 'gs-run-row' }, run, auto, sectionsWrap))));
            const barText = el('span', { class: 'gs-bar__text', role: 'status', aria: { live: 'polite' }, id: sid('bar') });
            const barActions = el('span', { class: 'gs-bar__actions' });
            const bar = el('div', { class: 'gs-bar' }, barText, barActions);
            const consent = el('div', { class: 'gs-consent', hidden: true, role: 'region', aria: { label: 'Send gene ids?' } });
            const sections = el('div', { class: 'gs-sections' });
            const root = el('div', { class: 'gs-panel' });
            root.insertAdjacentHTML('afterbegin', noDatasetScreenHtml(_id));
            root.append(controls, bar, consent, sections);
            _container.innerHTML = '';
            _container.appendChild(root);
            _dom = { root, controls, source, ids, idType, idTypeAuto, species, speciesErr, run, auto, sectionsBtn, sectionsMenu, sectionsWrap,
                bar, barText, barActions, consent, sections, noData: root.querySelector(`#loading-screen-${_id}`), sectionEls: new Map() };
            _picker = mountNamePicker({ input: species, noun: 'species', search: searchSpeciesItems, onPick: pickSpecies });
            fillSourceOptions();
            buildSections();
        }

        /**
         * The Source list. A panel without a source (new, or its table
         * removed) follows the first open gene table, or the first closed
         * one; with none at all it says so, and binds to the first table as
         * soon as one is made (onPanelsChanged).
         * @returns {boolean} whether the source changed
         */
        function fillSourceOptions() {
            if (!_dom) return false;
            const sel = _dom.source;
            D.clear(sel);
            const tables = PanelManager.getPanelsByType('gene-table');
            const active = new Set(PanelManager.getActivePanels());
            if (!tables.length) {
                sel.appendChild(D.el('option', { value: 'none', text: 'No gene table yet' }));
                sel.disabled = true;
                sel.value = 'none';
                return false;
            }
            sel.disabled = false;
            for (const t of tables) {
                const label = `${t.getTitle()}${active.has(t) ? '' : ' (closed)'}`;
                sel.appendChild(D.el('option', { value: t.getId(), text: label }));
            }
            let changed = false;
            if (!tables.some(t => t.getId() === _settings.tableFilter)) {
                const pick = tables.find(t => active.has(t)) || tables[0];
                changed = _settings.tableFilter !== pick.getId();
                _settings.tableFilter = pick.getId();
            }
            sel.value = _settings.tableFilter;
            return changed;
        }

        function setSource(id) {
            _settings.tableFilter = id || 'none';
            if (_runner) _runner.abortAll();
            _snapshot = null;
            _armed = false;
            _pending = null;
            if (_dom) _dom.source.value = _settings.tableFilter;
            refreshSource();
            settleAll();
            paintAll();
        }

        async function setIdType(type) {
            _settings.idType = type || 'auto';
            await setIdColumn(_settings.idColumn);
        }

        async function setIdColumn(col) {
            _settings.idColumn = col || 'auto';
            _speciesWhy = null;
            await ensureIds();
            await inferSpecies();
            const f = DataManager.getFocusedGene();
            _focus = { name: f || null, id: f ? idOf(f) : null };
            refreshSource();
            settleAll();
            paintAll();
            if (_settings.autoUpdate && _armed) runNow({ auto: true });
        }

        function toggleAuto() {
            _settings.autoUpdate = !_settings.autoUpdate;
            _dom.auto.setAttribute('aria-pressed', String(_settings.autoUpdate));
            _dom.auto.classList.toggle('active', _settings.autoUpdate);
            // turning it on is a request to be up to date now
            if (_settings.autoUpdate) runNow();
            else paintAll();
        }

        // species -------------------------------------------------------------

        let _remoteQuery = null;

        async function searchSpeciesItems(query, { signal }) {
            const remoteAllowed = policy() !== 'off';
            const local = searchSpecies(query, { remoteAllowed });
            if (remoteAllowed && _remoteQuery && query.trim() === _remoteQuery) {
                _remoteQuery = null;
                const remote = await remoteSpeciesSearch(query, { fetchImpl: (...a) => window.fetch(...a),
                    setTimeout: (...a) => window.setTimeout(...a), clearTimeout: (t) => window.clearTimeout(t),
                    now: () => Date.now(), signal });
                return { matches: [...remote, ...local.filter(i => i.kind === 'local')], truncated: false };
            }
            return { matches: local, truncated: false };
        }

        function pickSpecies(name, item) {
            delete _dom.speciesErr.dataset.error;
            _dom.species.removeAttribute('aria-invalid');
            if (item.kind === 'remote-ask') {
                // asked for by name: only now does the text go to NCBI
                _remoteQuery = item.query;
                _dom.species.value = item.query;
                _dom.species.focus();
                _dom.species.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            if (!/^\d+$/.test(String(item.taxid))) {
                _dom.species.setAttribute('aria-invalid', 'true');
                _dom.speciesErr.dataset.error = '1';
                _dom.speciesErr.className = 'gs-hint gs-hint--error';
                _dom.speciesErr.textContent = 'Not a species: pick one from the list or type a taxonomy id.';
                return;
            }
            if (item.kind === 'remote') learnSpecies({ taxid: item.taxid, name: item.sci, common: item.common });
            // a pick is a choice, also of the species that was inferred or the default
            _speciesWhy = 'explicit';
            if (String(item.taxid) !== taxonomyId() || DataManager.getTaxonomySource() !== 'explicit') {
                DataManager.setTaxonomyId(String(item.taxid));
            }
            paintSpecies();
        }

        // sections menu -------------------------------------------------------

        function sectionLabel(a) {
            return `${a.label} · ${a.provider.name}`;
        }

        function toggleSectionsMenu() {
            if (_dom.sectionsMenu.hidden) openSectionsMenu();
            else closeSectionsMenu();
        }

        function openSectionsMenu() {
            const menu = _dom.sectionsMenu;
            D.clear(menu);
            for (const sid of _settings.sectionOrder) {
                const a = _adapters.find(x => x.id === sid);
                if (!a && sid !== 'links') continue;
                const visible = !!(_settings.sections[sid] && _settings.sections[sid].visible);
                menu.appendChild(D.el('button', { type: 'button', role: 'menuitemcheckbox', class: 'gs-menu__item',
                    aria: { checked: String(visible) }, data: { section: sid },
                    on: { click: () => { setVisible(sid, !visible); openSectionsMenu(); menu.querySelector(`[data-section="${sid}"]`)?.focus(); } } },
                D.el('span', { class: 'gs-menu__check', aria: { hidden: 'true' }, text: visible ? '✓' : '' }),
                a ? sectionLabel(a) : 'Links',
                a && a.privacy ? D.el('span', { class: 'gs-menu__warn', text: a.privacy.stores === 'public' ? ' (stores lists publicly)' : ' (keeps results under a guessable token)' }) : ''));
            }
            menu.hidden = false;
            _dom.sectionsBtn.setAttribute('aria-expanded', 'true');
            const first = menu.querySelector('button');
            if (first && document.activeElement === _dom.sectionsBtn) first.focus();
        }

        function closeSectionsMenu() {
            _dom.sectionsMenu.hidden = true;
            _dom.sectionsBtn.setAttribute('aria-expanded', 'false');
        }

        function onMenuKey(e) {
            const items = [..._dom.sectionsMenu.querySelectorAll('button')];
            const i = items.indexOf(document.activeElement);
            if (e.key === 'Escape') { closeSectionsMenu(); _dom.sectionsBtn.focus(); e.preventDefault(); }
            else if (e.key === 'ArrowDown') { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
        }

        /** Show or hide a section. Hiding aborts it; showing fetches it when a Run made its input. */
        function setVisible(sid, visible) {
            if (!_settings.sections[sid]) _settings.sections[sid] = { visible, params: {} };
            _settings.sections[sid].visible = visible;
            const a = _adapters.find(x => x.id === sid);
            if (!visible && a && _runner) _runner.abort(sid);
            paintSection(sid);
            paintSectionsButton();
            paintBar();
            if (visible && a && _armed && policy() !== 'off') runSections([a]);
        }

        // sections -----------------------------------------------------------

        function buildSections() {
            D.clear(_dom.sections);
            _dom.sectionEls.clear();
            for (const sid of _settings.sectionOrder) {
                if (sid === 'links') { buildSection('links', null); continue; }
                const a = _adapters.find(x => x.id === sid);
                if (a) buildSection(sid, a);
            }
        }

        function buildSection(sid, a) {
            const { el } = D;
            const hid = `gs-h-${sid}-${_id}`, bid = `gs-b-${sid}-${_id}`;
            const toggle = el('button', { type: 'button', class: 'gs-section__toggle', id: hid, aria: { controls: bid },
                on: { click: () => setVisible(sid, !_settings.sections[sid].visible) } },
            el('span', { class: 'gs-caret', aria: { hidden: 'true' } }),
            el('span', { class: 'gs-section__label', text: a ? a.label : 'Links' }),
            a ? el('span', { class: 'gs-section__provider', text: ` · ${a.provider.name}` }) : '');
            const badge = el('span', { class: 'gs-badge' });
            const actions = el('span', { class: 'gs-section__actions' });
            const params = el('div', { class: 'gs-section__params', hidden: true });
            const result = el('div', { class: 'gs-section__result', id: `gs-r-${sid}-${_id}` });
            const body = el('div', { class: 'gs-section__body', id: bid, role: 'region', aria: { labelledby: hid } }, result);
            const section = el('section', { class: 'gs-section', data: { section: sid }, aria: { labelledby: hid } },
                el('div', { class: 'gs-section__head' }, toggle, badge, actions), params, body);
            _dom.sections.appendChild(section);
            _dom.sectionEls.set(sid, { section, toggle, badge, actions, params, body, result });
            if (a && a.params && Object.keys(a.params).length) buildParams(sid, a);
        }

        function buildParams(sid, a) {
            const { el } = D;
            const box = _dom.sectionEls.get(sid).params;
            D.clear(box);
            const values = _settings.sections[sid].params;
            for (const [name, spec] of Object.entries(a.params)) {
                const fid = `gs-p-${sid}-${name}-${_id}`;
                const opts = (spec.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) }));
                let control;
                if (spec.type === 'bool') {
                    control = el('label', { class: 'gs-param__check' },
                        el('input', { type: 'checkbox', id: fid, checked: !!values[name],
                            on: { change: (e) => setParam(sid, a, name, e.target.checked) } }), ` ${spec.label}`);
                    box.appendChild(el('div', { class: 'gs-param' }, control));
                    continue;
                }
                if (spec.type === 'multi') {
                    control = el('div', { class: 'gs-param__multi', role: 'group', aria: { label: spec.label } },
                        opts.map(o => el('label', { class: 'gs-param__check' },
                            el('input', { type: 'checkbox', value: o.value, checked: values[name].includes(o.value),
                                on: { change: () => {
                                    const picked = [...control.querySelectorAll('input:checked')].map(i => i.value);
                                    if (picked.length) setParam(sid, a, name, picked);
                                    else buildParams(sid, a);   // at least one source
                                } } }), ` ${o.label}`)));
                    box.appendChild(el('div', { class: 'gs-param' }, el('span', { class: 'gs-param__label', text: spec.label }), control));
                    continue;
                }
                control = el('select', { class: 'form-select form-select-sm', id: fid,
                    on: { change: (e) => setParam(sid, a, name, spec.type === 'number' ? Number(e.target.value) : e.target.value) } },
                opts.map(o => el('option', { value: o.value, text: o.label })));
                control.value = String(values[name]);
                box.appendChild(el('div', { class: 'gs-param' }, el('label', { class: 'gs-param__label', for: fid, text: spec.label }), control));
            }
        }

        function setParam(sid, a, name, value) {
            _settings.sections[sid].params = { ..._settings.sections[sid].params, [name]: value };
            settleAll();
            paintSection(sid);
            paintBar();
            // a changed setting is a request for that section's result
            if (_settings.sections[sid].visible && (a.kind === 'gene' || _snapshot) && _armed) runSections([a]);
        }

        function revokeSection(sid) {
            const urls = _blobUrls.get(sid) || [];
            for (const u of urls) URL.revokeObjectURL(u);
            _blobUrls.delete(sid);
            const dispose = _disposers.get(sid);
            _disposers.delete(sid);
            if (dispose) { try { dispose(); } catch { /* the section is redrawn anyway */ } }
        }

        function renderCtx(sid, input) {
            return {
                ...D, sci, input,
                blobImage(blob, alt) {
                    const url = URL.createObjectURL(blob);
                    if (!_blobUrls.has(sid)) _blobUrls.set(sid, []);
                    _blobUrls.get(sid).push(url);
                    return D.el('img', { src: url, alt, class: 'gs-image' });
                },
                hasGene,
                nameOf: nameOfId,
                focusGene: (idOrName) => DataManager.setFocusedGene(nameOfId(idOrName)),
                // what the user chose in this section's result, kept across reruns
                view: {
                    get: (key) => (_views.get(sid) || {})[key],
                    set: (key, value) => { _views.set(sid, { ...(_views.get(sid) || {}), [key]: value }); }
                }
            };
        }

        function paintAll() {
            if (!_dom) return;
            paintControls();
            paintBar();
            for (const sid of _dom.sectionEls.keys()) paintSection(sid);
        }

        /** "Sections n/m": how many sections are shown, after every change of one. */
        function paintSectionsButton() {
            if (!_dom) return;
            const all = [..._adapters.map(a => a.id), 'links'];
            const on = all.filter(sid => _settings.sections[sid] && _settings.sections[sid].visible).length;
            _dom.sectionsBtn.textContent = `Sections ${on}/${all.length} ▾`;
        }

        function paintControls() {
            const n = _source.count;
            const blocked = gate();
            _dom.run.textContent = _snapshot ? `⟳ Refresh · ${fmt(n)} genes` : `⟳ Run · ${fmt(n)} genes`;
            _dom.run.disabled = !!blocked && blocked !== 'waiting';
            _dom.auto.setAttribute('aria-pressed', String(_settings.autoUpdate));
            _dom.auto.classList.toggle('active', _settings.autoUpdate);
            paintSectionsButton();
            if (_dom.source.value !== _settings.tableFilter) fillSourceOptions();
            _dom.ids.value = _settings.idColumn;
            _dom.idType.value = _settings.idType;
            paintSpecies();
        }

        function hostsSummary() {
            const hosts = new Map();
            for (const a of visibleAdapters()) {
                if (a.kind === 'set') hosts.set(a.provider.name, true);
            }
            return [...hosts.keys()].join(', ');
        }

        function barButton(text, onClick, cls = 'btn-outline-primary') {
            return D.el('button', { type: 'button', class: `btn btn-sm ${cls}`, text, on: { click: onClick } });
        }

        /** The bar: whether the results describe the selection, and the one action that fixes it. */
        function paintBar() {
            if (!_dom) return;
            const { barText, barActions, bar } = _dom;
            D.clear(barActions);
            let tone = 'notice', text;
            const g = gate();
            const n = _source.count;
            const tag = _source.status === 'closed' ? ' (source table closed: its selection when it closed)' : '';
            if (g === 'no-dataset') text = 'No dataset loaded.';
            else if (g === 'no-source') {
                text = PanelManager.getPanelsByType('gene-table').length ? 'Pick a gene table as the source.'
                    : 'No gene table yet. Add one with Create New Panel (the panel chooser) → Gene Table; '
                        + 'this panel then analyses the genes passing its filter.';
            }
            else if (g === 'waiting') text = `Waiting for "${_source.title}" to load…`;
            else if (g === 'closed-unknown') {
                tone = 'stale';
                text = `Source table "${_source.title}" is closed and its selection is not known; reopen it.`;
            } else if (g === 'ids') {
                tone = 'stale';
                text = `Cannot read the ID column ${idCol()}: ${_ids.error}`;
            } else if (_pending) {
                text = 'Waiting for your answer below: nothing has been sent yet.';
            } else if (!_snapshot || !anyResult()) {
                const where = hostsSummary();
                text = policy() === 'off'
                    ? `External services are turned off on this server. ${fmt(n)} genes from "${_source.title}"${tag}; the Links work.`
                    : offline() ? `This browser is offline: nothing can be sent; the Links work. ${fmt(n)} genes from "${_source.title}".${tag}`
                        : `Not run yet. Run sends ${fmt(n)} gene ids${where ? ` to ${where}` : ''}.${tag}`;
                if (_settings.autoUpdate && policy() !== 'off') text += ' Auto-update starts with the first Run.';
                if (_notice) text = `${_notice} ${text}`;
                if (policy() !== 'off') barActions.appendChild(barButton(`⟳ Run · ${fmt(n)} genes`, () => runNow()));
            } else {
                const stale = panelStaleness(_snapshot, currentDescriptor());
                const time = new Date(_snapshot.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const summary = sectionSummary();
                if (stale) {
                    tone = 'stale';
                    text = `⚠ ${stale.text} (${time}).${tag}`;
                    if (_settings.autoUpdate) text += ' Updating…';
                    barActions.appendChild(barButton(`⟳ Refresh · ${fmt(n)} genes`, () => runNow(), 'btn-warning'));
                } else {
                    tone = 'ok';
                    text = `✓ Results for ${fmt(_snapshot.count)} genes from "${_snapshot.sourceTitle}" · `
                        + `${_snapshot.speciesName || `taxon ${_snapshot.taxonomyId}`} · ${time}${summary ? ` · ${summary}` : ''}${tag}`;
                }
                if (_snapshot.missingIds) text += ` ${fmt(_snapshot.missingIds)} genes have no ${_snapshot.idColumn} and were not sent.`;
                if (_snapshot.duplicates) text += ` ${fmt(_snapshot.duplicates)} repeated ids were sent once.`;
                if (_notice) text = `${_notice} ${text}`;
                if (policy() === 'off') text = `External services are turned off on this server; the Links work. ${text}`;
                else if (offline()) text = `This browser is offline: the Links work; results fetch when it is back online. ${text}`;
            }
            if (_source.status === 'closed' && g === null) {
                barActions.appendChild(barButton('Reopen table', reopenSource, 'btn-outline-secondary'));
            }
            bar.className = `gs-bar gs-bar--${tone}`;
            if (barText.textContent !== text) barText.textContent = text;
            paintConsent();
        }

        /** The app's own Reopen (the chooser's button for that table), as the plots' strip does it. */
        function reopenSource() {
            const btn = document.querySelector(`.panel-closed-btn[data-id="${CSS.escape(_settings.tableFilter)}"]`);
            if (btn) btn.click();
        }

        /** Whether any visible section has run (or been refused) since the snapshot. */
        function anyResult() {
            return !!_runner && visibleAdapters().some(a => _runner.get(a.id).status !== 'idle');
        }

        function sectionSummary() {
            if (!_runner) return '';
            const counts = { ok: 0, error: 0, loading: 0, refused: 0, none: 0 };
            for (const a of visibleAdapters()) {
                const run = _runner.get(a.id);
                if (run.status === 'error' && run.error && run.error.kind === 'unmapped') counts.none++;
                else if (run.status === 'error' && run.error && GAP_OF[run.error.kind]) counts.refused++;
                else if (run.status in counts) counts[run.status]++;
            }
            return [counts.loading ? `${counts.loading} loading` : '', counts.ok ? `${counts.ok} ready` : '',
                counts.none ? `${counts.none} found none of the genes` : '',
                counts.error ? `${counts.error} failed` : '', counts.refused ? `${counts.refused} not sent` : ''].filter(Boolean).join(', ');
        }

        function paintConsent() {
            const box = _dom.consent;
            D.clear(box);
            if (!_pending) { box.hidden = true; return; }
            const { el } = D;
            const byHost = new Map();
            for (const r of _pending.requests) {
                if (!byHost.has(r.host)) byHost.set(r.host, []);
                byHost.get(r.host).push(r);
            }
            const lines = [...byHost.entries()].map(([host, rs]) => {
                const a = rs[0].adapter;
                const what = typeof a.describeRequest === 'function' ? a.describeRequest(rs[0].input) : 'gene ids';
                return el('li', {}, el('b', { text: host }), ` (${a.provider.name}): ${what}`,
                    a.privacy ? el('div', { class: 'gs-consent__warn', text: `⚠ ${a.privacy.text} Asked every time.` }) : '');
            });
            const persistable = _pending.requests.some(r => r.persistable);
            box.append(el('div', { class: 'gs-consent__text', text: 'Send these to the services below? Nothing else leaves this browser '
                + '(no dataset name, no cell data, no address of this page).' }),
            el('ul', { class: 'gs-consent__list' }, lines),
            // fetch-policy.js hostAnswers: the one request beyond those listed
            el('div', { class: 'gs-consent__note', text: 'If a request fails without an answer, the panel asks that service '
                + 'once for its home page (a bare GET, nothing of yours in it) to tell "could not connect" from '
                + '"blocked by the browser".' }),
            el('div', { class: 'gs-consent__do' },
                barButton('Send', () => answerConsent('send'), 'btn-primary'),
                persistable ? barButton('Always send to these services', () => answerConsent('always')) : '',
                persistable ? barButton('Never', () => answerConsent('never'), 'btn-outline-danger') : '',
                barButton('Cancel', () => answerConsent('cancel'), 'btn-outline-secondary')));
            box.hidden = false;
        }

        /** Draw one section from its state. */
        function paintSection(sid) {
            if (!_dom || !_initialized) return;
            const parts = _dom.sectionEls.get(sid);
            if (!parts) return;
            if (sid === 'links') { paintLinks(parts); return; }
            const a = _adapters.find(x => x.id === sid);
            if (!a) return;
            const visible = !!_settings.sections[sid].visible;
            const run = _runner ? _runner.get(sid) : { status: 'idle' };
            const panelStale = a.kind === 'set' && _snapshot && !!panelStaleness(_snapshot, currentDescriptor());
            const stale = run.status === 'stale' || ((run.status === 'ok' || run.status === 'error') && panelStale);
            parts.section.classList.toggle('gs-section--hidden', !visible);
            parts.section.classList.toggle('gs-section--stale', visible && stale);
            parts.toggle.setAttribute('aria-expanded', String(visible));
            parts.body.hidden = !visible;
            parts.body.setAttribute('aria-busy', String(run.status === 'loading'));
            // the badge: a word with the colour, never colour alone
            let word = visible ? STATUS_WORD[run.status] : (run.status === 'idle' ? 'hidden, not fetched' : 'hidden');
            if (visible && stale && run.status !== 'loading') word = 'stale';
            if (visible && run.status === 'loading' && run.retryAt) word = `retrying in ${Math.max(1, Math.ceil((run.retryAt - Date.now()) / 1000))} s…`;
            if (visible && !stale && run.status === 'ok' && run.finishedAt && run.startedAt) {
                word = run.cached ? 'ok · cached' : `ok · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)} s`;
            }
            if (visible && !stale && run.status === 'error' && run.error && GAP_OF[run.error.kind]) {
                word = { species: 'species not covered', unmapped: 'none found' }[run.error.kind] || 'not sent';
            }
            parts.badge.className = `gs-badge gs-badge--${visible ? (stale && run.status !== 'loading' ? 'stale' : run.status) : 'hidden'}`;
            D.clear(parts.badge);
            if (visible && run.status === 'loading') parts.badge.appendChild(D.el('span', { class: 'spinner-border spinner-border-sm', aria: { hidden: 'true' } }));
            parts.badge.appendChild(document.createTextNode(` ${word}`));
            if (run.status === 'loading' && run.retryAt) setTimeout(() => paintSection(sid), 1000);
            paintActions(sid, a, parts, run, visible);
            if (!visible) return;
            paintBody(sid, a, parts, run);
        }

        function paintActions(sid, a, parts, run, visible) {
            const { el } = D;
            D.clear(parts.actions);
            if (!visible) return;
            if (a.params && Object.keys(a.params).length) {
                parts.actions.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-light', title: 'Settings',
                    aria: { label: `${sectionLabel(a)} settings`, expanded: String(!parts.params.hidden) },
                    on: { click: (e) => { parts.params.hidden = !parts.params.hidden; e.currentTarget.setAttribute('aria-expanded', String(!parts.params.hidden)); } } },
                el('i', { class: 'fas fa-cog', aria: { hidden: 'true' } })));
            }
            const can = policy() !== 'off' && (a.kind === 'gene' ? !!_focus.id : _source.count > 0) && !gate();
            parts.actions.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-light', disabled: !can,
                title: run.status === 'error' ? 'Retry' : 'Refresh this section', aria: { label: `Refresh ${sectionLabel(a)}` },
                on: { click: () => refreshSection(a) } }, el('i', { class: 'fas fa-sync-alt', aria: { hidden: 'true' } })));
            const url = openUrlOf(a, run.resultInput || inputFor(a).input, run.status === 'ok' || run.status === 'stale' ? run.result : null);
            if (url) {
                parts.actions.appendChild(el('a', { class: 'btn btn-sm btn-light', href: url, target: '_blank', rel: 'noopener noreferrer',
                    referrerpolicy: 'no-referrer', title: `Open in ${a.provider.name}`, aria: { label: `Open in ${a.provider.name} (opens in a new tab)` } },
                el('i', { class: 'fas fa-external-link-alt', aria: { hidden: 'true' } })));
            }
            if (typeof a.exportRows === 'function' && run.result && (run.status === 'ok' || run.status === 'stale')) {
                parts.actions.appendChild(el('button', { type: 'button', class: 'btn btn-sm btn-light', title: 'Download as CSV',
                    aria: { label: `Download ${sectionLabel(a)} as CSV` }, on: { click: () => downloadRows(a, run.result) } },
                el('i', { class: 'fas fa-download', aria: { hidden: 'true' } })));
            }
        }

        /** The service's own page for this input, when the adapter has one and it is https. */
        function openUrlOf(a, input, result) {
            if (typeof a.openUrl !== 'function') return null;
            try {
                const url = a.openUrl(input, result);
                return typeof url === 'string' && url.startsWith('https://') ? url : null;
            } catch {
                return null;
            }
        }

        function downloadRows(a, result) {
            try {
                const { columns, rows } = a.exportRows(result);
                download(`${a.id}.csv`, new Blob([toCsv(columns, rows)], { type: 'text/csv' }));
            } catch (error) {
                console.error(`Gene set panel ${_id}: export of ${a.id} failed:`, error);
            }
        }

        function download(filename, blob) {
            const url = URL.createObjectURL(blob);
            const link = D.el('a', { href: url, download: filename, hidden: true });
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        /** A section that shows no result, and why ("No genes shown (of 20)" and the reason). */
        function placeholder(host, a, reason, kind, message, extra = []) {
            host.dataset.drawn = '';
            const total = a.kind === 'gene' ? 1 : (_snapshot ? _snapshot.count : _source.count);
            drawPlaceholder(host, new Coverage({ shown: 0, total, unit: 'genes',
                gaps: [{ reason, kind, detail: message, source: a.provider.name, count: total }] }), 'genes');
            if (extra.length) host.appendChild(D.el('div', { class: 'gs-placeholder-do' }, extra));
        }

        function paintBody(sid, a, parts, run) {
            const host = parts.result;
            const { input } = inputFor(a);
            // results drawn for one state of the run are kept while it loads again
            const showResult = run.result && (run.status === 'ok' || run.status === 'stale' || (run.status === 'loading' && run.prev && run.prev.status !== 'idle'));
            if (run.status === 'error' && run.error) {
                revokeSection(sid);
                D.clear(host);
                const kind = run.error.kind;
                const [reason, gapKind] = GAP_OF[kind] || [GAP.FAILED, 'request'];
                const failed = !GAP_OF[kind];
                const msg = failed
                    ? `${run.error.message}${run.error.attempts > 1 ? ` (${run.error.attempts} attempts)` : ''}`
                    : run.error.message;
                const extra = [];
                if (failed) {
                    extra.push(barButton('Retry', () => refreshSection(a)));
                    const url = openUrlOf(a, input, null);
                    if (url) extra.push(D.link(url, `Open in ${a.provider.name}`, { cls: 'btn btn-sm btn-outline-secondary' }));
                }
                // over the service's limit: the user may send it anyway, and see what the service says
                if (kind === 'capped' && policy() !== 'off') {
                    extra.push(barButton('Try anyway', () => { _armed = true; runSections([a], { fresh: true, force: true }); }));
                }
                if (kind === 'declined') {
                    extra.push(barButton('Ask again', () => askAgain(a, run.error.hosts || [])));
                }
                placeholder(host, a, reason, gapKind, msg, extra);
                if (failed) {
                    host.insertBefore(D.el('div', { class: 'gs-error-title', text: `Could not get ${a.label.toLowerCase()} from ${a.provider.name}. Other sections are not affected.` }), host.firstChild);
                }
                return;
            }
            if (policy() === 'off') {
                revokeSection(sid);
                D.clear(host);
                placeholder(host, a, GAP.UNAVAILABLE, 'disabled', 'External services are turned off on this server; the Links section still works.');
                return;
            }
            if (!showResult && offline()) {
                revokeSection(sid);
                D.clear(host);
                placeholder(host, a, GAP.FAILED, 'request', 'This browser is offline. Links still work; results fetch when it is back online.');
                return;
            }
            if (run.status === 'loading' && (!showResult || run.progress)) {
                revokeSection(sid);
                D.clear(host);
                host.dataset.drawn = '';
                host.appendChild(D.el('div', { class: 'gs-loading' }, D.el('span', { class: 'spinner-border spinner-border-sm', aria: { hidden: 'true' } }),
                    ` ${run.progress || `Asking ${a.provider.name}…`}`));
                return;
            }
            if (!showResult) {
                revokeSection(sid);
                D.clear(host);
                const pending = _pending && _pending.toFetch.some(t => t.adapter.id === sid);
                const why = pending ? 'Waiting for your answer above.'
                    : a.kind === 'gene' && !_focus.id ? 'Follows the focused gene: click a gene in a table or in the Links list.'
                        : a.kind === 'gene' ? `For ${_focus.name}: ⟳ fetches it.`
                            : _snapshot ? 'Not fetched for these genes yet: ⟳ fetches it.' : 'Not run yet: ⟳ Run fetches it.';
                host.dataset.drawn = '';
                host.appendChild(D.el('p', { class: 'gs-idle', text: why }));
                return;
            }
            parts.body.setAttribute('aria-describedby', _dom.barText.id);
            // drawn already (a stale or reloading result stays as drawn, dimmed)
            if (host.dataset.drawn === String(run.lastInputHash) && host.firstChild) return;
            revokeSection(sid);
            D.clear(host);
            const drawInput = run.resultInput || input;
            try {
                const dispose = a.render(run.result, host, renderCtx(sid, drawInput));
                if (typeof dispose === 'function') _disposers.set(sid, dispose);
                const cov = typeof a.coverage === 'function' ? a.coverage(run.result, drawInput) : null;
                renderCoverageNotice(host, cov || Coverage.complete(a.kind === 'gene' ? 1 : drawInput.genes.length, 'genes'), 'genes');
                host.dataset.drawn = String(run.lastInputHash);
            } catch (error) {
                console.error(`Gene set panel ${_id}: ${sid} could not draw its result:`, error);
                revokeSection(sid);
                D.clear(host);
                placeholder(host, a, GAP.FAILED, '', `the result could not be shown (${error.message || error})`);
                host.dataset.drawn = '';
            }
        }

        // links ------------------------------------------------------------------

        function linkCtx() {
            const tax = taxonomyId();
            return { taxonomyId: tax, speciesName: speciesOf(tax).name, idType: _idType,
                stringBase: Config.STRING_DB.BASE_URL.replace(/\/api\/?$/, '') };
        }

        /** The focused gene's ids: its own, plus the gene card's when the card is for it. */
        function focusRecord() {
            const run = _runner && _runner.get('mygene-card');
            let xrefs = {};
            if (run && run.result && run.status === 'ok') {
                const a = _adapters.find(x => x.id === 'mygene-card');
                if (a && run.lastInputHash === inputFor(a).key) xrefs = xrefsOf(run.result.hit);
            }
            return geneRecord(_focus.id, _idType, xrefs);
        }

        function paintLinks(parts) {
            const { el } = D;
            const visible = !!_settings.sections.links.visible;
            parts.section.classList.toggle('gs-section--hidden', !visible);
            parts.toggle.setAttribute('aria-expanded', String(visible));
            parts.body.hidden = !visible;
            parts.badge.className = 'gs-badge gs-badge--ok';
            parts.badge.textContent = visible ? 'local, no request' : 'hidden';
            if (!visible) return;
            const host = parts.result;
            D.clear(host);
            const ctx = linkCtx();
            // the focused gene
            const focus = el('div', { class: 'gs-links__focus' });
            if (_focus.name) {
                const rec = focusRecord();
                const links = geneLinks(rec, ctx);
                focus.append(el('div', { class: 'gs-links__title' }, el('span', { class: 'gs-links__key', text: 'Focused gene ' }),
                    el('b', { text: _focus.name }), _focus.id && _focus.id !== _focus.name ? ` (${_focus.id})` : '',
                    rec.entrez || rec.ensembl ? '' : ''),
                el('div', { class: 'gs-links__row' }, links.length ? links.flatMap((l, i) => [i ? ' · ' : '',
                    D.link(l.href, l.label, { label: `${_focus.name} on ${l.label}` })]) : `No ${idCol()} value for ${_focus.name}.`));
            } else {
                focus.append(el('span', { class: 'gs-idle', text: 'Focused gene: none. Click a gene in a table, or in the list below.' }));
            }
            host.appendChild(focus);
            // the selection
            const n = _source.count;
            const differs = _snapshot && _source.hash !== _snapshot.hash;
            const list = el('div', { class: 'gs-links__list' });
            const head = el('div', { class: 'gs-links__title' },
                el('span', { class: 'gs-links__key', text: `Selected genes (${fmt(n)}${differs ? ', current' : ''}) ` }),
                n ? el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gs-list-toggle',
                    aria: { expanded: String(_settings.links.listOpen), controls: `gs-list-${_id}` },
                    text: _settings.links.listOpen ? 'Hide list' : 'Show list',
                    on: { click: () => setListOpen(!_settings.links.listOpen) } }) : '',
                n ? el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Copy ids', on: { click: copyIds } }) : '',
                el('span', { class: 'gs-links__copied', role: 'status', aria: { live: 'polite' } }));
            list.appendChild(head);
            if (n) {
                const whole = setLinks(_source.ids, ctx);
                list.appendChild(el('div', { class: 'gs-links__row' }, el('span', { class: 'gs-links__key', text: 'Whole set: ' }),
                    whole.flatMap((l, i) => [i ? ' · ' : '', l.href
                        ? D.link(l.href, l.label, { label: `${fmt(n)} genes on ${l.label}` })
                        : el('span', { class: 'gs-link--off', title: l.why, tabindex: '0', aria: { label: `${l.label}: ${l.why}` }, text: l.label })])));
                if (_settings.links.listOpen) list.appendChild(linksTable(ctx));
            }
            host.appendChild(list);
        }

        function columns(ctx) {
            const choices = new Set(columnChoices(ctx.taxonomyId).map(c => c.id));
            const cols = (_settings.links.columns || defaultColumns(ctx.taxonomyId)).filter(c => choices.has(c));
            return cols.length ? cols : defaultColumns(ctx.taxonomyId);
        }

        function linksTable(ctx) {
            const { el } = D;
            const cols = columns(ctx);
            const all = _source.names.map((name, i) => ({ name, id: _source.ids[i] }));
            const q = _listFilter.trim().toLowerCase();
            const rows = q ? all.filter(r => r.name.toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q)) : all;
            const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
            _listPage = Math.min(_listPage, pages - 1);
            const page = rows.slice(_listPage * LIST_PAGE, (_listPage + 1) * LIST_PAGE);
            const box = el('div', { class: 'gs-links__table', id: `gs-list-${_id}` });
            const find = el('input', { type: 'search', class: 'form-control form-control-sm gs-find', placeholder: 'Find',
                value: _listFilter, aria: { label: 'Find a gene in the list' },
                on: { input: (e) => { _listFilter = e.target.value; _listPage = 0; repaintListKeepingFocus(); } } });
            const colMenu = el('details', { class: 'gs-columns' }, el('summary', { text: 'Columns' }),
                el('div', { class: 'gs-columns__list' }, columnChoices(ctx.taxonomyId, ctx.speciesName).map(c => el('label', { class: 'gs-param__check' },
                    el('input', { type: 'checkbox', checked: cols.includes(c.id), on: { change: (e) => toggleColumn(c.id, e.target.checked, ctx) } }), ` ${c.label}`))));
            box.append(el('div', { class: 'gs-links__tools' }, find, colMenu,
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Download links CSV',
                    on: { click: () => download('gene-links.csv', new Blob([linksCsv(all.map(r => ({ ...r, rec: geneRecord(r.id, _idType) })), cols, ctx)], { type: 'text/csv' })) } })));
            const focused = _focus.name;
            // the table scrolls on its own, so Hide list (above and below it) stays at hand
            box.appendChild(el('div', { class: 'gs-links__scroll' }, D.table(`Links for the ${fmt(rows.length)} selected genes`, ['Gene', ...cols.map(c => (resourceById(c) || { label: c }).label)],
                page.map(r => {
                    const rec = geneRecord(r.id, _idType);
                    return [el('button', { type: 'button', class: `btn btn-link btn-sm gs-gene${r.name === focused ? ' gs-gene--focused' : ''}`,
                        aria: { label: `Focus ${r.name}`, current: r.name === focused ? 'true' : undefined },
                        on: { click: () => DataManager.setFocusedGene(r.name) } }, r.name === focused ? '● ' : '', r.name),
                    ...cols.map(c => {
                        const l = geneLink(c, rec, ctx);
                        const label = (resourceById(c) || { label: c }).label;
                        return l.href ? { text: '↗', href: l.href, label: `${r.name} on ${label}` } : { text: '—', title: l.why };
                    })];
                }))));
            box.appendChild(el('div', { class: 'gs-pager' },
                el('span', { text: rows.length ? `${fmt(_listPage * LIST_PAGE + 1)}–${fmt(Math.min(rows.length, (_listPage + 1) * LIST_PAGE))} of ${fmt(rows.length)}` : 'No gene matches' }),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: '‹ Prev', disabled: _listPage === 0,
                    on: { click: () => { _listPage--; paintSection('links'); } } }),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Next ›', disabled: _listPage >= pages - 1,
                    on: { click: () => { _listPage++; paintSection('links'); } } }),
                el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary gs-list-hide', text: 'Hide list',
                    aria: { controls: `gs-list-${_id}` }, on: { click: () => setListOpen(false) } })));
            return box;
        }

        /** Show or hide the Links list; the focus stays on (or returns to) its Show/Hide button. */
        function setListOpen(open) {
            _settings.links.listOpen = open;
            paintSection('links');
            const toggle = _dom && _dom.sectionEls.get('links').result.querySelector('.gs-list-toggle');
            if (toggle) toggle.focus();
        }

        function repaintListKeepingFocus() {
            paintSection('links');
            const find = _dom.sectionEls.get('links').result.querySelector('.gs-find');
            if (find) { find.focus(); find.setSelectionRange(find.value.length, find.value.length); }
        }

        function toggleColumn(id, on, ctx) {
            const cols = columns(ctx).filter(c => c !== id);
            if (on) cols.push(id);
            const order = columnChoices(ctx.taxonomyId).map(c => c.id);
            _settings.links.columns = order.filter(c => cols.includes(c));
            paintSection('links');
            const det = _dom.sectionEls.get('links').result.querySelector('.gs-columns');
            if (det) det.open = true;
        }

        async function copyIds() {
            const text = _source.ids.join('\n');
            const status = _dom.sectionEls.get('links').result.querySelector('.gs-links__copied');
            try {
                await navigator.clipboard.writeText(text);
                if (status) status.textContent = `Copied ${fmt(_source.ids.length)} ids.`;
            } catch {
                if (status) status.textContent = 'This browser did not allow copying; use Download links CSV.';
            }
        }

        // -------------------------------------------------------------------
        // public

        function getId() {
            return _id;
        }

        function getTitle() {
            return _title;
        }

        function setTitle(title) {
            _title = title;
        }

        function getType() {
            return 'gene-set';
        }

        /** The saved settings: an explicit list (state.js configOf). Cheap. */
        function getConfig() {
            return configOf({ id: _id, title: _title, settings: _settings, controlsVisible: _controlsVisible, adapters: _adaptersAll });
        }

        function updateConfig(config) {
            if (!config) return;
            if (config.title) _title = config.title;
            if (Object.prototype.hasOwnProperty.call(config, 'controlsVisible')) _controlsVisible = !!config.controlsVisible;
        }

        /** Replace the settings (a config from elsewhere), as a new panel would read them. */
        function setConfig(config) {
            const next = normalizeConfig({ ...getConfig(), ...(config || {}) }, _adaptersAll);
            Object.assign(_settings, next);
            if (_initialized) {
                if (_runner) _runner.abortAll();
                buildSections();
                setSource(_settings.tableFilter);
            }
        }

        /** For tests: the state as JSON-safe data, without result bodies. */
        function _debugState() {
            const runs = {};
            if (_runner) {
                for (const a of _adapters) {
                    const r = _runner.get(a.id);
                    runs[a.id] = { status: r.status, lastInputHash: r.lastInputHash, error: r.error, cached: !!r.cached,
                        hasResult: !!r.result, visible: !!_settings.sections[a.id].visible };
                }
            }
            return JSON.parse(JSON.stringify({
                settings: _settings, armed: _armed, gate: gate(), policy: policy(), idType: _idType, idColumn: idCol(),
                source: { status: _source.status, title: _source.title, count: _source.count, hash: _source.hash },
                snapshot: _snapshot ? { count: _snapshot.count, hash: _snapshot.hash, taxonomyId: _snapshot.taxonomyId,
                    idColumn: _snapshot.idColumn, sourceId: _snapshot.sourceId } : null,
                stale: _snapshot ? panelStaleness(_snapshot, currentDescriptor()) : null,
                focus: _focus, pendingConsent: _pending ? _pending.requests.map(r => r.host) : null, runs
            }));
        }

        return {
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
            setConfig,
            runNow,
            _debugState
        };
    }

    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('gene-set', GeneSetPanel);

    return GeneSetPanel;
})();

export { GeneSetPanel };
