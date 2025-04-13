import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { loadAxisData, loadDataAndCreatePlot } from './plot-utilities/plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity } from './plot-utilities/plot-update.js';
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { setupPlotEventListeners } from './plot-utilities/listeners.js';
import { setupDatasetWatcher } from './plot-utilities/dataset-watcher.js';

/**
 * Gene Plot Panel
 * Displays genes using data from var, varm, varp, and layers
 */
const GenePlotPanel = (function() {
    /**
     * Gene Plot Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function GenePlotPanel(container, options = {}) {
        // Private variables
        const _id = options.id || `gene-plot-${Date.now()}`;
        let _title = options.title || 'Gene Plot';
        const _plotType = 'genes'; 
        const _container = container;
        let _plotContainer = null;
        let _controlsContainer = null;
        let _resizeObserver = null;
        let _datasetWatcherCleanup = null;
        let _isFirstLoad = true;
        
        // Initialize minimal settings, letting the initialization process set data-dependent values
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
            hoverInfo: [{ type: 'var', key: '_index' }],
            subsettedGenes: null,
            hideNonSubset: false,
            showGrid: true,    // Show grid lines by default
            lockColorRange: false,  // Don't lock color range by default
            highlightFocusedGene: true // Highlight focused gene by default
        };
        
        
        // Override with provided options, if any
        Object.assign(_settings, options);
        
        // Cached data
        let _data = {
            x: null,
            y: null,
            z: null,
            color: null,
            entities: _plotType
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
            
            // Use _controlsContainer instead of _container for event listeners
            // Since we're setting up UI controls like axis selectors
            _resizeObserver = setupPlotEventListeners({
                container: _container, // Use _controlsContainer which contains the UI controls
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
            
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', async (e) => {
                const focusedGene = e.detail.gene;
                handleFocusedGeneChanged(focusedGene);
            
            });
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', async (e) => {
                const focusedCell = e.detail.cell;
                handleFocusedCellChanged(focusedCell);
            });
        }

        /**
         * Handle focused gene changes
         * @param {string} focusedGene - The gene that is currently focused
         *  @private
         */
        async function handleFocusedGeneChanged(focusedGene) {
        
            // Determine if any setting uses varp data
            const usesVarpData = _settings.x.type === 'varp' ||
                                   _settings.y.type === 'varp' ||
                                   (_settings.z && _settings.z.type === 'varp') ||
                                   _settings.color.type === 'varp';
        
            if (usesVarpData) {
                // Array to hold promises for axis updates
                const updatePromises = [];
        
                // Process non-color axes (x, y, z) that use varp data
                ['x', 'y', 'z'].forEach(axis => {
                    if (_settings[axis] && _settings[axis].type === 'varp') {
                        updatePromises.push(updateAxis(axis, focusedGene, "genes"));
                    }
                });
        
                // Process the color update if it uses varp data
                if (_settings.color.type === 'varp') {
                    updatePromises.push(updateAxis('color', focusedGene, "genes"));
                }
        
                try {
                    await Promise.all(updatePromises);
                } catch (err) {
                    console.error("Error during varp data updates:", err);
                    refreshPlot();
                }
            } else if (_settings.highlightFocusedGene) {
                // Highlight the focused gene if there's no varp update required
                highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
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
            if (_settings[axis] && _settings[axis].type === 'layer' && endityType === 'cells') {
                columnSelect.options[0].text = `Expression of ${focusedEntity}`;
            } else if (_settings[axis] && _settings[axis].type === 'varp' && endityType === 'genes') {
                columnSelect.options[0].text = `Connection to ${focusedEntity}`;
            }
        }

        async function handleFocusedCellChanged(focusedCell) {
            
            // Check if we're using layer data anywhere in the plot
            const usesLayerData = _settings.x.type === 'layer' || 
                                  _settings.y.type === 'layer' || 
                                  (_settings.z && _settings.z.type === 'layer') ||
                                  _settings.color.type === 'layer';
            
            if (!usesLayerData) {
                return;
            }
            
            // Array to hold promises for axis updates (x, y, z)
            const axisUpdatePromises = [];
            
            // Process each non-color axis if it uses layer data
            ['x', 'y', 'z'].forEach(axis => {
                if (_settings[axis] && _settings[axis].type === 'layer') {
                    // updateAxis returns a promise even for synchronous operations,
                    // so we add it to our array for later synchronization.
                    axisUpdatePromises.push(updateAxis(axis, focusedCell, "cells"));
                }
            });
            
            // Process the color update if using layer data
            let colorUpdatePromise = Promise.resolve();
            if (_settings.color.type === 'layer') {
                colorUpdatePromise = updateAxis('color', focusedCell, "cells");
            }
            
            // Wait for all asynchronous updates to complete
            try {
                await Promise.all([...axisUpdatePromises, colorUpdatePromise]);
                
                // If multiple axis updates occurred and highlighting is enabled,
                // ensure the focused entity is properly highlighted.
                if (axisUpdatePromises.length > 1 && _settings.highlightFocusedCell) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
            } catch (err) {
                console.error("Error during data updates:", err);
                refreshPlot();
            }
        }
        
        /**
         * Update the axis based on the focused entity and its type
         * @param {string} axis - Axis to update (x, y, z, color)
         * @param {string} focusedEntity - The entity to focus on
         * @param {string} entityType - Type of entity (genes, cells)
         */
        async function updateAxis(axis, focusedEntity, entityType) {
            // Determine the proper highlight flag based on the entity type.
            const refocusButton = _controlsContainer.querySelector(`#refocus-${axis}`);
        
            // Special handling for the 'color' axis.
            if (axis === 'color') {
                if (_settings.color.locked) {
                    if (_settings.color.column !== focusedEntity) {
                        if (refocusButton) refocusButton.style.display = 'inline-block';
                    } else {
                        if (refocusButton) refocusButton.style.display = 'none';
                    }
                } else if (_settings.color.column !== focusedEntity) {
                    _settings.color.column = focusedEntity;
                    _updateMenueLabelsForFocus(focusedEntity, entityType, axis);
                    try {
                        await loadColorDataAndUpdatePlot(
                            _container,
                            _plotContainer,
                            _settings,
                            _data,
                            _id,
                            refreshPlot
                        );
                    } catch (err) {
                        refreshPlot();
                    }
                }
                return;
            } else {
                // For non-color axes (x, y, z)
                if (_settings[axis].locked) {
                    if (_settings[axis].column !== focusedEntity) {
                        if (refocusButton) refocusButton.style.display = 'inline-block';
                    } else {
                        if (refocusButton) refocusButton.style.display = 'none';
                    }
                } else if (_settings[axis].column !== focusedEntity) {
                    _settings[axis].column = focusedEntity;
                    _updateMenueLabelsForFocus(focusedEntity, entityType, axis);
                    try {
                        const axisData = await loadAxisData(_settings[axis], _plotType);
                        if (axisData && axisData.values) {
                            _data[axis] = axisData;
                            _updatePlotElements({
                                [`${axis}Axis`]: true,
                                layout: true
                            });
                        } else {
                            refreshPlot();
                        }
                    } catch (err) {
                        refreshPlot();
                    }
                }
            }
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
            return 'gene-plot';
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
                // For dataset changes, fully reinitialize the plot
                refreshPlot();
            }
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
            onDataUpdate
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('gene-plot', GenePlotPanel);
    
    return GenePlotPanel;
})();

// Export the module
export { GenePlotPanel };