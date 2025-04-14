/**
 * Gene Table Panel
 * Displays genes in a DataTable with columns from var, varm, varp, and layers
 */
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { createTablePanelStructure, initializeTableUIState, checkDatasetLoadingStatus } from './table-utilities/table-ui-make.js';
import { loadTableData, initializeDataTable, updateTableOnFocusChange, exportTableToCsv } from './table-utilities/table-data.js';
import { setupDatasetWatcher } from './table-utilities/dataset-watcher.js';
import { setupTableEventListeners } from './table-utilities/listeners.js';

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
        let _datasetWatcherCleanup = null;
        let _tableListenersCleanup = null;
        let _isFirstLoad = true;
        
        // Initialize settings with default options
        const _settings = {
            columns: [],
            searchBuilderEnabled: true, // Always enabled
            responsive: false, // Disable responsive (use container size)
            fixedHeader: true, // Always use fixed header
            searchBuilderConfig: { criteria: [] },
            filteredGenes: null
        };
        
        // Override with provided options
        Object.assign(_settings, options);
        
        /**
         * Initialize the panel
         */
        async function init() {
            try {
                // Create panel structure
                const { tableContainer, controlsContainer, loadingScreen } = createTablePanelStructure(_container, _id);
                
                // Store references for later use
                _tableContainer = tableContainer;
                _controlsContainer = controlsContainer;
                
                // Manually update the UI based on dataset loading status
                const isDatasetLoaded = DataManager.isDatasetLoaded();
                if (loadingScreen) {
                    loadingScreen.style.display = isDatasetLoaded ? 'none' : 'flex';
                }
                if (controlsContainer) {
                    controlsContainer.style.display = isDatasetLoaded ? 'flex' : 'none';
                }
                
                // Set up dataset watching
                _datasetWatcherCleanup = setupDatasetWatcher(_id, {
                    onDatasetLoaded: onDatasetLoaded
                });
                
                // If a dataset is already loaded, initialize the panel
                if (isDatasetLoaded) {
                    await onDatasetLoaded(DataManager.getCurrentDataset());
                }
                
                // Set up event listeners
                _setupEventListeners();
                
            } catch (error) {
                console.error('Error initializing gene table panel:', error);
                if (_tableContainer) {
                    _tableContainer.innerHTML = `<div class="alert alert-danger">Error initializing table: ${error.message}</div>`;
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
                console.log(`Dataset ${datasetPath} loaded successfully for gene table panel ${_id}`);
            } catch (error) {
                console.error(`Error loading dataset for gene table panel ${_id}:`, error);
                if (_tableContainer) {
                    _tableContainer.innerHTML = `<div class="alert alert-danger">Error loading dataset: ${error.message}</div>`;
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
        
        /**
         * Refresh the table with current settings
         */
        async function refreshTable() {
            try {
                // Show loading indicator
                _tableContainer.innerHTML = `
                    <div class="d-flex justify-content-center align-items-center" style="height: 200px;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                `;
                
                // Load table data
                const tableData = await loadTableData(_settings, _plotType);
                
                // Destroy existing DataTable if it exists
                if (_dataTable) {
                    _dataTable.destroy();
                    _dataTable = null;
                }
                
                // Initialize DataTable
                if (tableData.data.length > 0) {
                    _dataTable = initializeDataTable(_tableContainer, tableData, _settings, _plotType);
                    
                    // Store panel settings in DataTables settings
                    _dataTable.settings()[0]._panelSettings = _settings;
                    
                    // Set up event listeners after DataTable is initialized
                    _setupEventListeners();
                } else {
                    _tableContainer.innerHTML = `
                        <div class="alert alert-info">
                            No data available. Please select columns from the control panel.
                        </div>
                    `;
                }
                
            } catch (error) {
                console.error('Error refreshing gene table:', error);
                _tableContainer.innerHTML = `
                    <div class="alert alert-danger">
                        Error loading table data: ${error.message}
                    </div>
                `;
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
            // Clean up dataset watcher
            if (_datasetWatcherCleanup) {
                _datasetWatcherCleanup();
                _datasetWatcherCleanup = null;
            }
            
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
         */
        function onDataUpdate(updateType, data) {
            if (updateType === 'datasetChanged') {
                console.log(`GeneTable ${_id}: Dataset changed, reinitializing table`);
                
                // For dataset changes, reinitialize the table
                if (_settings.columns && _settings.columns.length > 0) {
                    refreshTable();
                }
            }
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
            
            // Update other settings if needed
            Object.keys(config).forEach(key => {
                if (key !== 'title' && _settings[key] !== undefined) {
                    _settings[key] = config[key];
                }
            });
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