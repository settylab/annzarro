import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { loadDataAndCreatePlot } from './plot-utilities/plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity, refocusAxisOnEntity } from './plot-utilities/plot-update.js';
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { setupPlotEventListeners } from './plot-utilities/listeners.js';
import { setupDatasetWatcher } from './plot-utilities/dataset-watcher.js';

/**
 * Cell Plot Panel
 * Displays cells using data from obs, obsm, obsp, and layers
 */
const CellPlotPanel = (function() {
    /**
     * Cell Plot Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function CellPlotPanel(container, options = {}) {
        // Private variables
        const _id = options.id || `cell-plot-${Date.now()}`;
        let _title = options.title || 'Cell Plot';
        const _plotType = 'cells'; 
        const _container = container;
        let _plotContainer = null;
        let _controlsContainer = null;
        let _resizeObserver = null;
        let _datasetWatcherCleanup = null;
        let _isFirstLoad = true;
        
        // Initialize settings with initial default options
        const _settings = {
            x: undefined,
            y: undefined,
            z: undefined, // undefined will try to set this, null will force 2d
            color: { type: 'none', key: '', column: '' }, // Start with no coloring
            pointSize: (Config && Config.DEFAULTS && Config.DEFAULTS.POINT_SIZE) || 5,
            pointOpacity: (Config && Config.DEFAULTS && Config.DEFAULTS.POINT_OPACITY) || 0.7,
            colorScale: (Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALE) || 'Portland',
            categoryPalette: 'uns', // Default to using colors from uns if available
            colorMin: null,
            colorMax: null,
            colorReversed: false,
            hoverInfo: [{ type: 'obs', key: '_index' }],
            subsettedCells: null,
            hideNonSubset: false,
            showGrid: true,    // Show grid lines by default
            lockColorRange: false,  // Don't lock color range by default
            highlightFocusedCell: true // Highlight focused cell by default
        };
        
        
        // Override with provided options, if any
        Object.assign(_settings, options);
        
        // Cached data
        let _data = {
            x: null,
            y: null,
            z: null,
            color: null
        };
        
        /**
         * Initialize the panel
         */
        async function init() {
            try {
                // Create panel structure
                const { plotContainer, controlsContainer, loadingScreen } = createPanelStructure(_container, _id, _settings);
    
                // Store references for later use
                _plotContainer = plotContainer;
                _controlsContainer = controlsContainer;
                
                console.log('Panel structure created: ', 
                    'plotContainer=', _plotContainer ? 'defined' : 'undefined',
                    'controlsContainer=', _controlsContainer ? 'defined' : 'undefined',
                    'loadingScreen=', loadingScreen ? 'defined' : 'undefined');
                
                // Set up dataset watching
                _datasetWatcherCleanup = setupDatasetWatcher(_id, {
                    onDatasetLoaded: onDatasetLoaded
                });
                
                // If a dataset is already loaded, initialize the panel
                if (DataManager.isDatasetLoaded()) {
                    await onDatasetLoaded(DataManager.getCurrentDataset());
                }
                
                // Set up event listeners (these work even when no dataset is loaded)
                _setupEventListeners();
            } catch (error) {
                console.error('Error initializing panel:', error);
                console.error(error.stack);
                if (_plotContainer) {
                    _plotContainer.innerHTML = `<div class="alert alert-danger">Error initializing panel: ${error.message}</div>`;
                } else {
                    console.error('Cannot show error - plotContainer is undefined');
                }
            }
        }
        
        /**
         * Handle dataset loaded event
         * @param {string} datasetPath - The path to the loaded dataset
         */
        async function onDatasetLoaded(datasetPath) {
            try {
                console.log(`Loading dataset for panel ${_id}: ${datasetPath}`);
                
                // Get the dataset structure
                const datasetStructure = await DataManager.getDatasetStructure(datasetPath);
                if (!datasetStructure) {
                    throw new Error('Failed to load dataset structure');
                }
                
                // Initialize UI state with the dataset
                await initializeUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);
                
                // Load data and create plot
                await refreshPlot();
                
                _isFirstLoad = false;
                console.log(`Dataset ${datasetPath} loaded successfully for panel ${_id}`);
            } catch (error) {
                console.error(`Error loading dataset for panel ${_id}:`, error);
                if (_plotContainer) {
                    _plotContainer.innerHTML = `<div class="alert alert-danger">Error loading dataset: ${error.message}</div>`;
                }
                _isFirstLoad = false;
            }
        }
        
        
        /**
         * Set up event listeners
         * @private
         */
        function _setupEventListeners() {
            
            _resizeObserver = setupPlotEventListeners({
                plotContainer: _plotContainer,
                controlsContainer: _controlsContainer,
                settings: _settings,
                plotType: _plotType,
                data: _data,
                id: _id,
                loadDataAndCreatePlot: refreshPlot,
                onFocusedCellChanged: handleFocusedCellChanged,
                onFocusedGeneChanged: handleFocusedGeneChanged
            })
            
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', async (e) => {
                const focusedCell = e.detail.cell;
                handleFocusedCellChanged(focusedCell);
            });
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', async (e) => {
                const focusedGene = e.detail.gene;
                handleFocusedGeneChanged(focusedGene);
            });
        }

        async function handleFocusedCellChanged(focusedCell) {
        
            // Determine if any setting uses obsp data
            const usesObspData = _settings.x.type === 'obsp' ||
                                 _settings.y.type === 'obsp' ||
                                 (_settings.z && _settings.z.type === 'obsp') ||
                                 _settings.color.type === 'obsp';
        
            if (!usesObspData) {
                if (_settings.highlightFocusedCell) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
                return;
            }
        
            // Array to hold update promises for axes and color.
            const updatePromises = [];
        
            // Process non-color axes (x, y, z) that use obsp data.
            ['x', 'y', 'z', 'color'].forEach(axis => {
                if (_settings[axis] && _settings[axis].type === 'obsp') {
                    updatePromises.push(refocusAxis(axis, focusedCell, "cells"));
                }
            });
        
            try {
                await Promise.all(updatePromises);
                // If more than one axis was updated and highlighting is enabled,
                // ensure the focused entity is properly highlighted.
                if (updatePromises.length > 1 && _settings.highlightFocusedCell) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
            } catch (err) {
                console.error("Error during obsp data updates:", err);
                refreshPlot();
            }
        }
        
        /**
         * Update axis titles and menu labels to reflect the current focused entity
         * @param {string} focusedEntity - The entity to focus on
         * @param {string} endityType - Type of entity (genes, cells)
         * @param {string} axis - Axis to update (x, y, z)
         * @private
         */
        function _updateMenueLabelsForFocus(focusedEntity, endityType, axis) {
            const columnSelect = _controlsContainer.querySelector(`.axis-column-select[data-axis="${axis}"]`);
            if (!columnSelect) {
                console.warn(`Column select for axis ${axis} not found`);
                return;
            }
            // Update the label of the first option in the select element
            if (_settings[axis] && _settings[axis].type === 'layer' && endityType === 'genes') {
                columnSelect.options[0].text = `Expression of ${focusedEntity}`;
            } else if (_settings[axis] && _settings[axis].type === 'obsp' && endityType === 'cells') {
                columnSelect.options[0].text = `Connection to ${focusedEntity}`;
            }
        }

        async function handleFocusedGeneChanged(focusedGene) {
            // Determine if any setting uses layer data
            const usesLayerData = _settings.x.type === 'layer' ||
                                  _settings.y.type === 'layer' ||
                                  (_settings.z && _settings.z.type === 'layer') ||
                                  _settings.color.type === 'layer';
        
            if (!usesLayerData) {
                return;
            }
        
            // Entity type is "genes" for this event.
            const updatePromises = [];
        
            // Process non-color axes (x, y, z) that use layer data.
            ['x', 'y', 'z', 'color'].forEach(axis => {
                if (_settings[axis] && _settings[axis].type === 'layer') {
                    // Call the unified async update method for the axis
                    updatePromises.push(refocusAxis(axis, focusedGene, "genes"));
                }
            });
            try {
                await Promise.all(updatePromises);
        
                // Optionally update highlighting if multiple updates occurred and highlighting is enabled.
                if (updatePromises.length > 1 && _settings.highlightFocusedGene) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
            } catch (err) {
                console.error("Error during layer data updates:", err);
                refreshPlot();
            }
        }

        /**
         * Update the axis based on the focused entity and its type
         * @param {string} axis - Axis to update (x, y, z, color)
         * @param {string} focusedEntity - The entity to focus on
         * @param {string} entityType - Type of entity (genes, cells)
         */
        async function refocusAxis(axis, focusedEntity, entityType) {
            await refocusAxisOnEntity(axis, focusedEntity, entityType, {
            settings: _settings,
            controlsContainer: _controlsContainer,
            container: _container,
            plotContainer: _plotContainer,
            data: _data,
            id: _id,
            plotType: _plotType,
            refreshPlot,
            updateMenueLabelsForFocus: _updateMenueLabelsForFocus,
            });
        }

        
        /**
         * Reload the data and redraw the plot
         */
        async function refreshPlot() {
            loadDataAndCreatePlot(_container, _plotContainer, _settings, _data, _id, _isFirstLoad)
        }
        
        
        /**
         * Update plot with current settings without recreating it
         * @param {boolean} fullDataUpdate - Whether to update all data or just visual properties 
         * @private
         */
        /**
         * Centralized function to efficiently update plot elements
         * @param {Object} options - Update options
         * @param {boolean} options.xAxis - Whether to update x-axis data
         * @param {boolean} options.yAxis - Whether to update y-axis data
         * @param {boolean} options.zAxis - Whether to update z-axis data
         * @param {boolean} options.colors - Whether to update any coloring properties
         * @param {boolean} options.colorData - Whether to update the color data array (set to true for new color data)
         * @param {boolean} options.colorScale - Whether to update the color scale only
         * @param {boolean} options.colorRange - Whether to update color range (min/max) only
         * @param {boolean} options.styling - Whether to update visual styling
         * @param {boolean} options.layout - Whether to update layout properties 
         * @param {boolean} options.filter - Whether to update the filtering (hide outliers)
         * @private
         */
        function _updatePlotElements(options = {}) {
            updatePlotElements(_plotContainer, _data, _settings, refreshPlot, options);
        }

        
        /**
         * Clean up resources
         */
        function cleanup() {
            // Remove event listeners
            if (_plotContainer) {
                Plotly.purge(_plotContainer);
            }
            
            // Clear container
            _container.innerHTML = '';
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
            return 'cell-plot';
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
         * Destroy the panel and clean up resources
         */
        function destroy() {
            // Clean up the resize observer if it exists
            if (_resizeObserver) {
                console.log(`Disconnecting ResizeObserver for ${_id}`);
                _resizeObserver.disconnect();
                _resizeObserver = null;
            }
            
            // Clean up dataset watcher
            if (_datasetWatcherCleanup) {
                _datasetWatcherCleanup();
                _datasetWatcherCleanup = null;
            }
            
            // Call the standard cleanup
            cleanup();
        }
        
        /**
         * Handle data updates, especially dataset changes
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         */
        function onDataUpdate(updateType, data) {
            if (updateType === 'datasetChanged') {
                console.log(`CellPlot ${_id}: Dataset changed, reinitializing plot`);
                // For dataset changes, fully reinitialize the plot
                refreshPlot();
            }
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
            refreshPlot,
            cleanup,
            destroy,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig,
            updateConfig,
            onDataUpdate
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('cell-plot', CellPlotPanel);
    
    return CellPlotPanel;
})();

// Export the module
export { CellPlotPanel };