/**
 * Cell Table Panel
 * Displays cells in a DataTable with columns from obs, obsm, obsp, and layers
 */
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { createTablePanelStructure, initializeTableUIState, checkDatasetLoadingStatus } from './table-utilities/table-ui-make.js';
import { loadTableData, initializeDataTable, releaseTable, keptSelection, applyLineToSettings, settleColumnChooser, replaceRowsInPlace, updateTableOnFocusChange, exportTableToCsv, pinPanelFocusPlaceholders, getColumnKey } from './table-utilities/table-data.js';
import { Coverage, GAP, classifyError } from '../utils/coverage.js';
import { renderCoverageNotice, drawPlaceholder, showCancelled } from '../utils/panel-surface.js';
import { beginLoad, endLoad, cancelLoads, wasCancelled } from '../utils/load-scope.js';
import { loadingIndicator } from './plot-utilities/plot-make.js';
import { setupTableEventListeners } from './table-utilities/listeners.js';
import { syncControlsWithDataset } from '../utils/controls-visibility.js';
import { assignKnownSettings, configOf } from '../utils/panel-settings.js';
import { commit as commitMemory, forget as forgetMemory } from '../utils/memory-guard-ui.js';
import { tableMayLoad } from './table-utilities/table-memory.js';
import { TableScores } from './table-utilities/table-scores.js';
import { bindScoreColumns } from './table-utilities/table-score-ui.js';
import { isScoreColumn, sameScoreColumn } from '../utils/score-column.js';
import { pinLayers, sourceInput } from '../utils/score-source.js';
import { removeColumnFromChooser } from './table-utilities/table-ui-make.js';
import { TableResolver } from '../utils/table-resolver.js';
import { makeDom } from './gene-set-utilities/dom.js';
import { createCellMethods } from './cell-grouping/methods.js';
import { METHODS_TEXT, cleanMethods, tableDefinition } from '../utils/group-statistics.js';
import './table-utilities/table-background.js';
import { createTableUndo, changesTableState, giveBack } from './table-utilities/table-undo.js';

const CellTablePanel = (function() {
    /**
     * Cell Table Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function CellTablePanel(container, options = {}) {
        // Private variables
        const _id = options.id || `cell-table-${Date.now()}`;
        let _title = options.title || 'Cell Table';
        const _container = container;
        const _plotType = 'cells';
        let _tableContainer = null;
        let _controlsContainer = null;
        let _dataTable = null;
        let _tableListenersCleanup = null;
        let _isFirstLoad = true;
        
        // Initialize settings with default options
        const _settings = {
            columns: [],
            searchBuilderEnabled: true, // Always enabled
            responsive: false, // Disable responsive (use container size)
            fixedHeader: true, // Always use fixed header
            searchBuilderConfig: { criteria: [] },
            searchText: '',
            // the search box's toggles (regex, smart, case): saved with the panel
            searchRegex: false,
            searchSmart: true,
            searchCaseInsensitive: true,
            currentEntries: [],
            filteredCells: null
        };
        
        // Override with provided options
        Object.assign(_settings, options);
        // Methods ▾ (decision 34): the parameters of the statistics over the table's cells, `methods` in the
        // configuration only when one is not at its default. Kept apart from the DataTable's settings.
        let _methods = cleanMethods(options.methods);
        let _methodsUi = null;
        let _undo = null;                   // Undo of the table's settings (table-utilities/table-undo.js)
        delete _settings.methods;
        // A "focused cell/gene" placeholder from an older view names the
        // entity focused now (the view's own focus is restored first), and
        // never follows the focus after that (issue #9)
        pinPanelFocusPlaceholders(_settings, _title);
        
        /**
         * Initialize the panel
         */
        async function init() {
            try {
                // Create panel structure with settings
                const { tableContainer, controlsContainer, loadingScreen } = createTablePanelStructure(_container, _id, _settings);
                
                // Store references for later use
                _tableContainer = tableContainer;
                _controlsContainer = controlsContainer;
                mountMethods();
                mountUndo();
                
                // Manually update the UI based on dataset loading status
                const isDatasetLoaded = DataManager.isDatasetLoaded();
                if (loadingScreen) {
                    loadingScreen.style.display = isDatasetLoaded ? 'none' : 'flex';
                }
                syncControlsWithDataset(controlsContainer, isDatasetLoaded);
            
                
                // If a dataset is already loaded, initialize the panel
                if (isDatasetLoaded) {
                    await onDatasetLoaded(DataManager.getCurrentDataset());
                }
                
                
            } catch (error) {
                console.error('Error initializing cell table panel:', error);
                if (_tableContainer) {
                    drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'initializing table', unit: 'cells' }), 'cells');
                }
            }
        }
        
        /**
         * Methods ▾ beside the table's actions (decision 34). A Gene Plot reads these when it colours by this table's
         * cells (SO-8c); each edit is saved with the panel.
         */
        function mountMethods() {
            const host = _controlsContainer && _controlsContainer.querySelector('.action-buttons');
            if (!host) return;
            if (_methodsUi) _methodsUi.destroy();
            _methodsUi = createCellMethods({ D: makeDom(document), id: _id, intro: METHODS_TEXT.tableIntro, definitionOf: tableDefinition, getFields: () => _methods,
                apply: (patch) => setMethods({ ..._methods, ...patch }) });
            host.prepend(_methodsUi.element);
        }

        /**
         * Undo, in the control row beside Methods ▾: every change of the table's settings is one step (table-utilities/table-undo.js).
         * Undo gives the settings before back and builds the table from them, as a link would.
         */
        function mountUndo() {
            const host = _controlsContainer && _controlsContainer.querySelector('.action-buttons');
            if (!host) return;
            if (_undo) _undo.dispose();
            _undo = createTableUndo({
                root: _container, settings: () => _settings, extra: () => ({ methods: Object.keys(_methods).length ? _methods : undefined }),
                busy: () => !!(_tableContainer && _tableContainer.querySelector('.table-loading')),
                restore: restoreSettings
            });
            const methods = _methodsUi && _methodsUi.element;
            host.insertBefore(_undo.button({ className: 'btn btn-sm btn-outline-secondary table-undo' }), methods ? methods.nextSibling : host.firstChild);
            _undo.rebase();
        }

        /** Undo: the settings before become the settings, and the table is built again from them. */
        async function restoreSettings(config) {
            if (_dataTable) {
                releaseTable(_dataTable, _settings);
                _dataTable = null;
            }
            giveBack(_settings, config, ['methods']);
            setMethods(cleanMethods(config.methods));
            const length = document.getElementById(`table-length-${_id}`);
            if (length) length.value = String(_settings.pageLength || 25);
            await refreshTable();
            await settleColumnChooser(_settings, _plotType);
        }

        /** The method fields become `next` (cleaned); the saved state hears it. */
        function setMethods(next) {
            const clean = cleanMethods(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)));
            if (JSON.stringify(clean) === JSON.stringify(_methods)) return;
            _methods = clean;
            if (_undo) _undo.observe('change the methods');
            // what a Gene Plot's axis of this table's cells stands for moved (its Expressed above): the page's group sources hear it
            document.dispatchEvent(new CustomEvent('annzarro:table-filtered', { detail: { id: _id } }));
            if (_methodsUi) _methodsUi.paint();
            if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') window.sessionManager.notifyPanelUpdate();
        }

        /**
         * Handle dataset loaded event
         * @param {string} datasetPath - The path to the loaded dataset
         */
        async function onDatasetLoaded(datasetPath) {
            try {
                console.log(`Loading dataset for cell table panel ${_id}: ${datasetPath}`);
                
                // Get the dataset structure
                const datasetStructure = await DataManager.getDatasetStructure(datasetPath);
                if (!datasetStructure) {
                    throw new Error('Failed to load dataset structure');
                }
                
                // Initialize UI state with the dataset
                await initializeTableUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);
                
                // Always initialize the table, even if no columns are selected
                await refreshTable();
                if (_undo) _undo.rebase();             // what a dataset and its first build made of the settings is no step
                
                _isFirstLoad = false;
                console.log(`Dataset ${datasetPath} loaded successfully for cell table panel ${_id}`);
            } catch (error) {
                console.error(`Error loading dataset for cell table panel ${_id}:`, error);
                if (_tableContainer) {
                    drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'loading dataset', unit: 'cells' }), 'cells');
                }
                _isFirstLoad = false;
            }
        }
        
        /**
         * Set up event listeners
         */
        function _setupEventListeners() {
            // Clean up previous listeners if they exist
            if (_tableListenersCleanup) {
                _tableListenersCleanup();
            }
            
            // Set up new listeners and store the cleanup function
            _tableListenersCleanup = setupTableEventListeners({
                id: _id,
                settings: _settings,
                tableContainer: _tableContainer,
                dataTable: _dataTable,
                entityType: 'cells',
                title: _title,
                refreshTable: refreshTable
            });
        }
        
        /**
         * Refresh the table with current settings
         * @param {AbortSignal} [signal] - Optional abort signal to allow cancellation
         * @returns {Promise<void>} - Promise that resolves when the table is refreshed
         */
        async function refreshTable(signal, { inPlace = false } = {}) {
            // a score column with no layer (an old link) is resolved now, once, with its filter conditions
            pinScoreColumns();
            // One signal per load (utils/load-scope.js): a newer load of this
            // table, closing it and the Cancel button abort it. `signal` is
            // the one of the update that asks for it.
            signal = beginLoad(_tableContainer, 'table', signal);
            // A table that is built from nothing (opened, or its first load) takes over the filter of
            // any background build of it (utils/table-resolver.js): the build ends before it loads a
            // second copy of the rows, and the plots wait for this table
            let claimed = !inPlace && !_dataTable;
            if (claimed) TableResolver.claim(_id);
            const settle = (how, why) => {
                if (!claimed) return;
                claimed = false;
                TableResolver.panelSettled(_id, how, why);
            };
            try {
                // will its rows fit next to the other panels? (utils/memory-guard-ui.js)
                if (!tableMayLoad(_tableContainer, _id, 'cell-table', () => {
                    if (!_dataTable) return;
                    releaseTable(_dataTable, _settings);
                    _dataTable = null;
                })) {
                    settle('refused', 'not enough browser memory');
                    return;
                }
                // Other cells of the same table: the rows are swapped into
                // the table shown, so it does not blank and keeps its state
                let preloaded = null;
                if (inPlace && _dataTable) {
                    // the rows stay until the new ones are there: say it is working
                    loadingIndicator.show(_tableContainer, 'table-data');
                    let tableData;
                    try {
                        tableData = preloaded = await loadTableData(_settings, _plotType, signal);
                    } finally {
                        loadingIndicator.hide(_tableContainer, 'table-data');
                    }
                    if (signal.aborted) {
                        throw new DOMException('Table refresh aborted after loading data', 'AbortError');
                    }
                    TableScores.prune(_id, _settings.columns);
                    if (replaceRowsInPlace(_dataTable, tableData)) {
                        renderCoverageNotice(_tableContainer, tableData.coverage, 'cells');
                        // the score columns say what they are for these cells
                        bindScoreColumns(_dataTable, _settings, _tableContainer);
                        return;
                    }
                }

                // Show loading indicator
                _tableContainer.innerHTML = `
                    <div class="d-flex flex-column justify-content-center align-items-center table-loading" style="height: 200px;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-secondary load-cancel mt-2" title="Stop loading">Cancel</button>
                    </div>
                `;
                _tableContainer.querySelector('.load-cancel').addEventListener('click', () => cancelLoads(_tableContainer, true));
                
                // Check if operation is aborted before loading data
                if (signal.aborted) {
                    throw new DOMException('Table refresh aborted before loading data', 'AbortError');
                }
                
                // Load table data with abort signal
                const tableData = preloaded || await loadTableData(_settings, _plotType, signal);
                
                // Check if operation is aborted after loading data
                if (signal.aborted) {
                    throw new DOMException('Table refresh aborted after loading data', 'AbortError');
                }
                
                // a score column taken out of the table stops wanting its score
                TableScores.prune(_id, _settings.columns);

                // Destroy existing DataTable if it exists
                if (_dataTable) {
                    // the filter, the search and the rows passing them as
                    // values: the next DataTable starts from them
                    releaseTable(_dataTable, _settings);
                    _dataTable = null;
                }
                
                // Initialize DataTable
                if (tableData.data.length > 0) {
                    _dataTable = initializeDataTable(_tableContainer, tableData, _settings, _plotType);
                    claimed = false;       // initializeDataTable told the resolver and the plots
                    // its rows, in the browser memory guard's ledger (a subset change redraws them)
                    commitMemory(_id, { kind: 'cell-table', n: tableData.data.length });
                    // State what the table is NOT showing, and why. A table that
                    // silently drops an unreadable column looks identical to one
                    // whose column genuinely holds nothing.
                    renderCoverageNotice(_tableContainer, tableData.coverage, 'cells');
                    
                    // Store panel settings in DataTables settings
                    _dataTable.settings()[0]._panelSettings = _settings;
                    
                    // Set up event listeners after DataTable is initialized
                    _setupEventListeners();
                } else {
                    settle('empty');
                    drawPlaceholder(_tableContainer,
                        (tableData.coverage && !tableData.coverage.isComplete)
                            ? tableData.coverage
                            : Coverage.missing(GAP.EMPTY,
                                'no columns are selected -- pick some in the control panel',
                                { source: 'table columns', unit: 'cells' }),
                        'cells');
                }
                
            } catch (error) {
                // Handle errors differently based on type
                if (error && error.name === 'AbortError') {
                    // If operation was aborted, log only in debug mode
                    if (window.Config && window.Config.DEBUG_MODE) {
                        console.debug(`Cell table refresh aborted for ${_id}`);
                    }
                    // the rows shown before stay (only a load into the table shown keeps them)
                    if (wasCancelled(signal)) settle('cancelled');
                    if (wasCancelled(signal)) showCancelled(_tableContainer, 'cells', !!(inPlace && _dataTable));
                } else {
                    // For actual errors, show error message
                    settle('failed', error && error.message ? error.message : 'unknown error');
                    console.error('Error refreshing cell table:', error);
                    // classifyError: a limit (the names of a dataset too
                    // large to list) is not a failed read
                    drawPlaceholder(_tableContainer,
                        error.coverage || classifyError(error, { source: 'table data', unit: 'cells' }),
                        'cells');
                    // The placeholder replaced the table's DOM: the DataTable is gone from the page. Let it go, so
                    // the next update (a subset that makes the rows listable again) builds a table instead of
                    // swapping rows into this detached one and leaving the placeholder up.
                    if (_dataTable) {
                        releaseTable(_dataTable, _settings);
                        _dataTable = null;
                    }
                }
                
                // Rethrow abort errors to signal upstream that operation was
                // cancelled (not the Cancel button's: the panel says it itself)
                if (error && error.name === 'AbortError' && !wasCancelled(signal)) {
                    throw error;
                }
            } finally {
                endLoad(_tableContainer, signal);
            }
        }
        
        /**
         * Clean up resources
         */
        function cleanup() {
            cancelLoads(_tableContainer);
            if (_dataTable) {
                // what other panels still read (a plot's table filter, the
                // panel set) stays, as values; the DataTable's rows go
                releaseTable(_dataTable, _settings, { rowNames: DataManager.getCells(), rows: _dataTable.rows().count() });
                _dataTable = null;
            }
            forgetMemory(_id);
            if (_methodsUi) { _methodsUi.destroy(); _methodsUi = null; }
            if (_undo) { _undo.dispose(); _undo = null; }
            // a closed table wants its scores only when something that filters by it needs them
            TableScores.release(_id);
            // its filter is now its closed selection (set above); nothing is rebuilt
            TableResolver.panelClosed(_id);
            
            _container.innerHTML = '';
        }
        
        /**
         * Destroy the panel and clean up resources
         */
        function destroy() {
            // Clean up table listeners
            if (_tableListenersCleanup) {
                _tableListenersCleanup();
                _tableListenersCleanup = null;
            }
            
            // Call the standard cleanup
            cleanup();
        }
        
        /**
         * Handle data updates from other components
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         * @returns {Promise<void>} - Promise that resolves when the update is complete
         */
        async function onDataUpdate(updateType, updateData) {
            // Check if an abort signal was provided in the update data
            const signal = updateData && updateData._abortSignal;
            
            // Other cells of the open dataset: the same columns, new rows
            if (updateType === 'subsetChanged') {
                await refreshTable(signal, { inPlace: true });
                return;
            }

            if (updateType === 'datasetChanged') {
                if (window.Config && window.Config.DEBUG_MODE) {
                    console.log(`CellTable ${_id}: Dataset changed, reinitializing table`);
                }
                
                // A panel made before the first dataset load began (its type
                // picked while the page was still starting) kept its "No
                // dataset loaded" screen and its hidden controls: nothing
                // lifted them when the dataset came. Lift them now, and only
                // then, so a panel that already had a dataset keeps its
                // controls as they are.
                const noDataScreen = document.getElementById(`loading-screen-${_id}`);
                if (noDataScreen && noDataScreen.style.display !== 'none') checkDatasetLoadingStatus(_id);

                // Rebuild the column chooser from the NEW dataset, then the
                // table. Reloading only the table (and only when it had
                // columns) left the chooser offering the previous dataset's
                // fields and, on a failure, the previous dataset's rows.
                try {
                    const datasetStructure = await DataManager.getDatasetStructure(updateData?.dataset);
                    if (!datasetStructure) {
                        throw new Error('Failed to load dataset structure');
                    }
                    // The chooser keeps only the columns it can tick in this
                    // dataset; keep asking for the rest so the table says
                    // which are missing instead of dropping them unannounced.
                    const requested = Array.isArray(_settings.columns) ? _settings.columns.slice() : [];
                    await initializeTableUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);
                    _settings.columns = requested;
                    // rows swapped into the table shown when the columns match
                    await refreshTable(signal, { inPlace: true });
                    // what another dataset (or the first one, for a panel made before it) made of the settings is no step of the user's
                    if (_undo) _undo.rebase();
                    return;
                } catch (error) {
                    // If this is an abort error, propagate it
                    if (error && error.name === 'AbortError') {
                        throw error;
                    }
                    // Otherwise this table shows its own failure (issue #2)
                    console.error(`Error updating cell table ${_id}:`, error);
                    if (_tableContainer) {
                        drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                            error.message || 'unknown error',
                            { source: 'loading dataset', unit: 'cells' }), 'cells');
                    }
                }
            }
            
            // Return a resolved promise to indicate completion
            return Promise.resolve();
        }
        
        /**
         * Get panel ID
         * @returns {string} - Panel ID
         */
        function getId() {
            return _id;
        }
        
        /**
         * Get panel title
         * @returns {string} - Panel title
         */
        function getTitle() {
            return _title;
        }
        
        /**
         * Set panel title
         * @param {string} title - New title
         */
        function setTitle(title) {
            _title = title;
            // Update title in settings to ensure it's included in getConfig()
            _settings.title = title;
        }
        
        /**
         * Get panel type
         * @returns {string} - Panel type
         */
        function getType() {
            return 'cell-table';
        }
        
        /**
         * Get panel configuration
         * @returns {Object} - Panel configuration
         */
        function getConfig() {
            // the DataTable's live views (the rows passing the filter) are read when read; `methods` only when not default
            const config = configOf(_settings, { title: _title });
            if (Object.keys(_methods).length) config.methods = { ..._methods };
            return config;
        }
        
        /**
         * Update panel configuration
         * @param {Object} config - New configuration
         */
        function updateConfig(config) {
            if (!config) return;
            
            // Update title if provided
            if (config.title) {
                _title = config.title;
            }
            
            // Update other settings; never the read-only views of the live
            // DataTable (searchBuilderConfig, currentEntries)
            assignKnownSettings(_settings, config);
            // Methods ▾: a whole configuration (Back and Forward, a link) without `methods` is at the defaults
            if ('methods' in config || 'columns' in config) setMethods(cleanMethods(config.methods));
            // a config from outside (a link, Back and Forward, a panel set's remap) is no step of the user's: the steps are forgotten
            if (_undo && !_undo.restoring && changesTableState(config)) _undo.rebase();
        }
        
        /**
         * Filter by a line drawn on a plot (the line-selection tool,
         * utils/line-select.js): its columns and its condition go into the
         * settings, and the table is built again from them.
         * @param {{x: Object, y: Object, cond: Object}} line
         * @returns {Promise<{columns: Object[], column: Object}>}
         */
        async function applyLine(line) {
            const added = applyLineToSettings(_settings, line);
            await refreshTable();
            await settleColumnChooser(_settings, _plotType);
            if (_undo) _undo.rebase();             // another panel's change
            return added;
        }

        /**
         * Put the filter a background build made (utils/table-resolver.js) into this CLOSED table.
         * Refused when the table is open: an open table is its own filter.
         * @param {{passing, seen}|null} selection - utils/closed-table.js
         * @returns {boolean} whether it was set
         */
        function setClosedSelection(selection) {
            if (_dataTable) return false;
            _settings.closedSelection = keptSelection(selection);
            return true;
        }

        /**
         * Resolve the score columns that carry no layer (a link made before layers were stored) to the layer their
         * source reads now, once: afterwards a column never moves with its source's first layer. A column's data key
         * names its layer, and the conditions of the filter name the column by that key, so both are rewritten. The
         * filter of a table that is shown is a view of its DataTable: the table is frozen first (its state kept as
         * values) and the caller builds it again.
         * @returns {boolean} whether a column was resolved
         */
        function pinScoreColumns() {
            const open = (_settings.columns || []).some(c => isScoreColumn(c) && !c.layer && sourceInput(c.key));
            if (!open) return false;
            if (_dataTable) {
                releaseTable(_dataTable, _settings);
                _dataTable = null;
            }
            return pinLayers(_settings, getColumnKey);
        }

        /** Sources came or went: a column that waited for its source to exist is resolved, and the table built with it. */
        function onPanelsChanged() {
            if (_dataTable && pinScoreColumns()) refreshTable();
        }

        /**
         * Take a column out of the table (a score column whose signature is gone, or that could
         * not be computed): the chooser is unticked and the table is built again without it.
         * @param {Object} column
         */
        async function removeColumn(column) {
            removeColumnFromChooser(_id, _settings, column, sameScoreColumn);
            await refreshTable();
        }

        /**
         * Whether other panels may read this table's rows: not while its filter reads a score that
         * is not ready (the rows are held, utils/score-column.js), and the plots and Gene Set
         * Analysis panels that read it wait with it.
         */
        function isReady() {
            return !_dataTable || !scoreGate();
        }

        /**
         * What stands between this table's filter and its rows because a score the filter reads is
         * not ready (utils/score-column.js filterGate), or null. Asking for a closed table's gate
         * asks for its scores, for the dependants that can be seen.
         * @param {{visible?: () => boolean}} [opts]
         */
        function scoreGate(opts = {}) {
            return TableScores.gateOf(_id, { columns: _settings.columns, searchBuilderConfig: _settings.searchBuilderConfig }, opts);
        }

        // Public API
        return {
            init,
            isReady,
            scoreGate,
            removeColumn,
            setClosedSelection,
            refreshTable,
            // before a source's first layer changes: a column with no layer takes the layer it reads now
            pinScoreLayers: () => { const shown = !!_dataTable; if (pinScoreColumns() && shown) refreshTable(); },
            onPanelsChanged,
            applyLine,
            cleanup,
            destroy,
            onDataUpdate,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig,
            updateConfig,
            /** The method fields (decision 34), for a Gene Plot that reads this table's cells (SO-8c): `{detect_above?}`. */
            getMethods: () => ({ ..._methods }),
            /** Open Methods ▾; false while the table's controls are not shown. */
            revealMethods: () => { if (!_methodsUi || (_controlsContainer && _controlsContainer.style.display === 'none')) return false; _methodsUi.reveal(); return true; }
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('cell-table', CellTablePanel);
    
    return CellTablePanel;
})();

// Export as module
export { CellTablePanel };