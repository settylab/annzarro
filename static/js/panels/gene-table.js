/**
 * Gene Table Panel
 * Displays genes in a DataTable with columns from var, varm, varp, and layers
 */
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { createTablePanelStructure, initializeTableUIState, checkDatasetLoadingStatus } from './table-utilities/table-ui-make.js';
import { loadTableData, initializeDataTable, replaceRowsInPlace, updateTableOnFocusChange, exportTableToCsv } from './table-utilities/table-data.js';
import { Coverage, GAP } from '../utils/coverage.js';
import { renderCoverageNotice, drawPlaceholder } from '../utils/panel-surface.js';
import { setupTableEventListeners } from './table-utilities/listeners.js';
import { syncControlsWithDataset } from '../utils/controls-visibility.js';
import { assignKnownSettings } from '../utils/panel-settings.js';

const GeneTablePanel = (function() {
    /**
     * Gene Table Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function GeneTablePanel(container, options = {}) {
        // Private variables
        const _id = options.id || `gene-table-${Date.now()}`;
        let _title = options.title || 'Gene Table';
        const _container = container;
        const _plotType = 'genes';
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
            currentEntries: [],
            filteredGenes: null
        };
        
        // Override with provided options
        Object.assign(_settings, options);
        
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
                
                // Set up event listeners
                _setupEventListeners();
                
            } catch (error) {
                console.error('Error initializing gene table panel:', error);
                if (_tableContainer) {
                    drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'initializing table', unit: 'genes' }), 'genes');
                }
            }
        }
        
        /**
         * Handle dataset loaded event
         * @param {string} datasetPath - The path to the loaded dataset
         */
        async function onDatasetLoaded(datasetPath) {
            try {
                console.log(`Loading dataset for gene table panel ${_id}: ${datasetPath}`);
                
                // Get the dataset structure
                const datasetStructure = await DataManager.getDatasetStructure(datasetPath);
                if (!datasetStructure) {
                    throw new Error('Failed to load dataset structure');
                }
                
                // Initialize UI state with the dataset
                await initializeTableUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);
                
                // Always initialize the table, even if no columns are selected
                await refreshTable();
                
                _isFirstLoad = false;
            } catch (error) {
                console.error(`Error loading dataset for gene table panel ${_id}:`, error);
                if (_tableContainer) {
                    drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'loading dataset', unit: 'genes' }), 'genes');
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
                entityType: 'genes',
                title: _title,
                refreshTable: refreshTable
            });
        }
        
        // Track the current loading operation for cancellation
        let _currentLoadOperation = null;
        
        /**
         * Refresh the table with current settings
         * @param {AbortSignal} [signal] - Optional abort signal to allow cancellation
         * @returns {Promise<void>} - Promise that resolves when the table is refreshed
         */
        async function refreshTable(signal, { inPlace = false } = {}) {
            try {
                // If there's an existing loading operation, abort it
                if (_currentLoadOperation) {
                    _currentLoadOperation.abort();
                    _currentLoadOperation = null;
                }
                
                // Create a new abort controller if not provided through signal
                if (!signal) {
                    _currentLoadOperation = new AbortController();
                    signal = _currentLoadOperation.signal;
                }
                
                // Other cells of the same table: the rows are swapped into
                // the table shown, so it does not blank and keeps its state
                let preloaded = null;
                if (inPlace && _dataTable) {
                    const tableData = preloaded = await loadTableData(_settings, _plotType, signal);
                    if (signal.aborted) {
                        throw new DOMException('Table refresh aborted after loading data', 'AbortError');
                    }
                    if (replaceRowsInPlace(_dataTable, tableData)) {
                        renderCoverageNotice(_tableContainer, tableData.coverage, 'genes');
                        if (_currentLoadOperation && _currentLoadOperation.signal === signal) {
                            _currentLoadOperation = null;
                        }
                        return;
                    }
                }

                // Show loading indicator
                _tableContainer.innerHTML = `
                    <div class="d-flex justify-content-center align-items-center" style="height: 200px;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                `;
                
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
                
                // Destroy existing DataTable if it exists
                if (_dataTable) {
                    // deep copy linked searchBuilderConfig
                    const sb_data = JSON.parse(JSON.stringify(_settings.searchBuilderConfig));
                    delete _settings.searchBuilderConfig;
                    _settings.searchBuilderConfig = sb_data;
                    _dataTable.destroy();
                    _dataTable = null;
                }
                
                // Initialize DataTable
                if (tableData.data.length > 0) {
                    _dataTable = initializeDataTable(_tableContainer, tableData, _settings, _plotType);
                    // State what the table is NOT showing, and why. A table that
                    // silently drops an unreadable column looks identical to one
                    // whose column genuinely holds nothing.
                    renderCoverageNotice(_tableContainer, tableData.coverage, 'genes');
                    
                    // Store panel settings in DataTables settings
                    _dataTable.settings()[0]._panelSettings = _settings;
                    
                    // Set up event listeners after DataTable is initialized
                    _setupEventListeners();
                } else {
                    drawPlaceholder(_tableContainer,
                        (tableData.coverage && !tableData.coverage.isComplete)
                            ? tableData.coverage
                            : Coverage.missing(GAP.EMPTY,
                                'no columns are selected -- pick some in the control panel',
                                { source: 'table columns', unit: 'genes' }),
                        'genes');
                }
                
                // Clear the abort controller reference on successful completion
                if (_currentLoadOperation && _currentLoadOperation.signal === signal) {
                    _currentLoadOperation = null;
                }
                
            } catch (error) {
                // Clear the abort controller reference
                if (_currentLoadOperation && _currentLoadOperation.signal === signal) {
                    _currentLoadOperation = null;
                }
                
                // Handle errors differently based on type
                if (error && error.name === 'AbortError') {
                    // If operation was aborted, log only in debug mode
                    if (window.Config && window.Config.DEBUG_MODE) {
                        console.debug(`Gene table refresh aborted for ${_id}`);
                    }
                } else {
                    // For actual errors, show error message
                    console.error('Error refreshing gene table:', error);
                    drawPlaceholder(_tableContainer,
                        error.coverage || Coverage.missing(GAP.FAILED,
                            error.message || 'unknown error',
                            { source: 'table data', unit: 'genes' }),
                        'genes');
                }
                
                // Rethrow abort errors to signal upstream that operation was cancelled
                if (error && error.name === 'AbortError') {
                    throw error;
                }
            }
        }
        
        /**
         * Clean up resources
         */
        function cleanup() {
            if (_dataTable) {
                _dataTable.destroy();
                _dataTable = null;
            }
            
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
                    console.log(`GeneTable ${_id}: Dataset changed, reinitializing table`);
                }
                
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
                    return;
                } catch (error) {
                    // If this is an abort error, propagate it
                    if (error && error.name === 'AbortError') {
                        throw error;
                    }
                    // Otherwise this table shows its own failure (issue #2)
                    console.error(`Error updating gene table ${_id}:`, error);
                    if (_tableContainer) {
                        drawPlaceholder(_tableContainer, error.coverage || Coverage.missing(GAP.FAILED,
                            error.message || 'unknown error',
                            { source: 'loading dataset', unit: 'genes' }), 'genes');
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
            return 'gene-table';
        }
        
        /**
         * Get panel configuration
         * @returns {Object} - Panel configuration
         */
        function getConfig() {
            return {
                title: _title,
                ..._settings
            };
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
        }
        
        // Public API
        return {
            init,
            refreshTable,
            cleanup,
            destroy,
            onDataUpdate,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig,
            updateConfig
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('gene-table', GeneTablePanel);
    
    return GeneTablePanel;
})();

// Export as module
export { GeneTablePanel };