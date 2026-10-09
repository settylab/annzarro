import { initAutoPointStyle } from '../utils/point-style.js';
import { focusedOptionLabel } from './plot-utilities/panel-ui-update.js';
import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { loadDataAndCreatePlot } from './plot-utilities/plot-make.js';
import { highlightFocusedEntity, updatePlotOnTableChange, refocusAxisOnEntity } from './plot-utilities/plot-update.js';
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { setupPlotEventListeners } from './plot-utilities/listeners.js';
import { Coverage, GAP } from '../utils/coverage.js';
import { drawPlaceholder, showCancelled } from '../utils/panel-surface.js';
import { beginLoad, endLoad, cancelLoads, wasCancelled } from '../utils/load-scope.js';
import { releasePlot } from '../utils/release-plot.js';
import { forget } from '../utils/memory-guard-ui.js';
import { restoreColorRange, storedColorRange } from '../utils/array-stats.js';

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
        let _isFirstLoad = true;
        
        // Initialize minimal settings, letting the initialization process set data-dependent values
        const _settings = {
            x: undefined,
            y: undefined,
            z: undefined, // undefined will try to set this, null will force 2d
            color: { type: 'none', key: '', column: '' }, // Start with no coloring
            pointSize: (Config && Config.DEFAULTS && Config.DEFAULTS.POINT_SIZE) || 5,
            pointOpacity: (Config && Config.DEFAULTS && Config.DEFAULTS.POINT_OPACITY) || 0.7,
            autoPointSize: true,      // size and opacity follow the number of points
            autoPointOpacity: true,   // until set (utils/point-style.js)
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
            highlightFocusedGene: true, // Highlight focused gene by default
            exportWidth: 1200,      // Default export width in pixels
            exportHeight: 800       // Default export height in pixels
        };
        
        
        // Override with provided options, if any (colour bounds stored in
        // data units go back to drawn units: array-stats.js restoreColorRange)
        Object.assign(_settings, restoreColorRange(options));
        initAutoPointStyle(_settings, options);
        
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
                    drawPlaceholder(_plotContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'initializing panel', unit: 'genes' }), 'genes');
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
                    drawPlaceholder(_plotContainer, error.coverage || Coverage.missing(GAP.FAILED,
                        error.message || 'unknown error',
                        { source: 'loading dataset', unit: 'genes' }), 'genes');
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
            
            
            // Event handler functions that can be removed when cleaning up
            const focusedGeneChangedHandler = async (e) => {
                const focusedGene = e.detail.gene;
                const duringDatasetTransition = e.detail.duringDatasetTransition || false;
                
                if (duringDatasetTransition) {
                    // During dataset transition, only update menu labels without data reload
                    ['x', 'y', 'z', 'color'].forEach(axis => {
                        if (_settings[axis] && _settings[axis].type === 'varp') {
                            _updateMenueLabelsForFocus(focusedGene, "genes", axis);
                        }
                    });
                } else {
                    // Full data reload for normal gene changes
                    handleFocusedGeneChanged(focusedGene);
                }
            };
            
            const focusedCellChangedHandler = async (e) => {
                const focusedCell = e.detail.cell;
                const duringDatasetTransition = e.detail.duringDatasetTransition || false;
                
                if (duringDatasetTransition) {
                    // During dataset transition, only update menu labels without data reload
                    ['x', 'y', 'z', 'color'].forEach(axis => {
                        if (_settings[axis] && _settings[axis].type === 'layer') {
                            _updateMenueLabelsForFocus(focusedCell, "cells", axis);
                        }
                    });
                } else {
                    // Full data reload for normal cell changes
                    handleFocusedCellChanged(focusedCell);
                }
            };
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', focusedGeneChangedHandler);
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', focusedCellChangedHandler);
            
            // Store handlers so they can be removed during cleanup
            handleFocusedGeneChanged.eventHandler = focusedGeneChangedHandler;
            handleFocusedCellChanged.eventHandler = focusedCellChangedHandler;
        }

        /**
         * Handle focused gene changes
         * @param {string} focusedGene - The gene that is currently focused
         *  @private
         */
        async function handleFocusedGeneChanged(focusedGene) {
            // A panel made while the dataset is still opening is already listening,
            // and the focus is resolved before its own load has set its axes. That
            // is a legitimate early event: the load reads the focus itself, so
            // there is nothing to refresh yet.
            if (!(_settings.x && _settings.y)) return;

        
             // Determine if any setting uses varp data
             const usesVarpData = _settings.x.type === 'varp' ||
             _settings.y.type === 'varp' ||
             (_settings.z && _settings.z.type === 'varp') ||
             _settings.color.type === 'varp';
        
            if (!usesVarpData) {
                if (_settings.highlightFocusedGene) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
                return;
            }
        
            try {
                // Array to hold update promises for axes and color.
                const updatePromises = [];
            
                // Process non-color axes (x, y, z) that use obsp data.
                ['x', 'y', 'z', 'color'].forEach(axis => {
                    if (_settings[axis] && _settings[axis].type === 'varp') {
                        updatePromises.push(refocusAxis(axis, focusedGene, _plotType));
                    }
                });

                await Promise.all(updatePromises);
                // If any axis was updated and highlighting is enabled,
                // ensure the focused entity is properly highlighted.
                // Always: a LOCKED axis is not refocused, so nothing else moves the
                // highlight to the new focus (it stayed on the old cell)
                if (_settings.highlightFocusedGene) {
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
            // A locked axis keeps showing the entity it is locked to
            const locked = !!(_settings[axis] && _settings[axis].locked && _settings[axis].column);
            if (locked) focusedEntity = _settings[axis].column;
            if (_settings[axis] && _settings[axis].type === 'layer' && endityType === 'cells') {
                columnSelect.options[0].text = focusedOptionLabel('cells', focusedEntity, locked);
            } else if (_settings[axis] && _settings[axis].type === 'varp' && endityType === 'genes') {
                columnSelect.options[0].text = focusedOptionLabel('genes', focusedEntity, locked);
            }
        }

        async function handleFocusedCellChanged(focusedCell) {
            // A panel made while the dataset is still opening is already listening,
            // and the focus is resolved before its own load has set its axes. That
            // is a legitimate early event: the load reads the focus itself, so
            // there is nothing to refresh yet.
            if (!(_settings.x && _settings.y)) return;

            
            // Check if we're using layer data anywhere in the plot
            const usesLayerData = _settings.x.type === 'layer' || 
                                  _settings.y.type === 'layer' || 
                                  (_settings.z && _settings.z.type === 'layer') ||
                                  _settings.color.type === 'layer';
            
            if (!usesLayerData) {
                return;
            }
            
            // Wait for all asynchronous updates to complete
            try {
                // Array to hold promises for axis updates (x, y, z)
                const axisUpdatePromises = [];
                
                // Process axis if it uses layer data
                ['x', 'y', 'z', 'color'].forEach(axis => {
                    if (_settings[axis] && _settings[axis].type === 'layer') {
                        // refocusAxis returns a promise even for synchronous operations,
                        // so we add it to our array for later synchronization.
                        axisUpdatePromises.push(refocusAxis(axis, focusedCell, "cells"));
                    }
                });
                
                await Promise.all(axisUpdatePromises);
                
                // If multiple axis updates occurred and highlighting is enabled,
                // ensure the focused entity is properly highlighted.
                if (axisUpdatePromises.length > 1 && _settings?.highlightFocusedCell) {
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                }
            } catch (err) {
                console.error("Error during layer updates:", err);
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
         * @param {AbortSignal} [signal] - Optional abort signal of the update that asks for it
         * @returns {Promise<void>} - Promise that resolves when the plot is refreshed
         */
        async function refreshPlot(signal) {
            // One signal per load (utils/load-scope.js): a newer load of this
            // panel, closing it and the overlay's Cancel abort it
            signal = beginLoad(_plotContainer, 'plot', signal);
            try {
                await loadDataAndCreatePlot(_container, _plotContainer, _settings, _data, _id, _isFirstLoad, signal);
            } catch (error) {
                // Only log non-abort errors
                if (!error || error.name !== 'AbortError') {
                    console.error(`Error refreshing gene plot ${_id}:`, error);
                    throw error;
                }
                if (window.Config && window.Config.DEBUG_MODE) {
                    console.debug(`Plot refresh aborted for ${_id}`);
                }
            } finally {
                endLoad(_plotContainer, signal);
            }
            // loadDataAndCreatePlot returns quietly when it was aborted; the
            // Cancel button leaves what was drawn, or says there is nothing
            if (wasCancelled(signal)) {
                showCancelled(_plotContainer, 'genes',
                    !!(_plotContainer._fullLayout && Array.isArray(_plotContainer.data) && _plotContainer.data.length));
            }
        }


        /**
         * Clean up resources
         */
        function cleanup() {
            // Remove document event listeners
            if (handleFocusedCellChanged.eventHandler) {
                document.removeEventListener('focusedCellChanged', handleFocusedCellChanged.eventHandler);
            }
            
            if (handleFocusedGeneChanged.eventHandler) {
                document.removeEventListener('focusedGeneChanged', handleFocusedGeneChanged.eventHandler);
            }

            // Remove event listeners
            if (_plotContainer) {
                // Clean up any loading indicators before purging the plot
                if (window.loadingIndicator && typeof window.loadingIndicator.cleanupContainer === 'function') {
                    window.loadingIndicator.cleanupContainer(_plotContainer);
                }

                // Clean up aesthetics menu event listeners
                if (_plotContainer._aestheticsCleanup && typeof _plotContainer._aestheticsCleanup === 'function') {
                    _plotContainer._aestheticsCleanup();
                    _plotContainer._aestheticsCleanup = null;
                }

                // the WebGL side too: Plotly.purge leaves it to the garbage collector
                releasePlot(_plotContainer);
            }

            // A closed panel is kept for "Reopen", and this closure with it:
            // drop the loaded series, or closing frees nothing (a reopen
            // loads them again). A load still running is stopped.
            cancelLoads(_plotContainer);
            Object.keys(_data).forEach(key => delete _data[key]);
            Object.assign(_data, { x: null, y: null, z: null, color: null, entities: _plotType });
            forget(_id);

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
                ..._settings,
                ...storedColorRange(_settings)   // Min/Max in data units, also under Log
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
            
            // Call the standard cleanup
            cleanup();
        }
        
        /**
         * Handle data updates, especially dataset changes
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         * @returns {Promise<void>} - Promise that resolves when the update is complete
         */
        async function onDataUpdate(updateType, updateData) {
            // Check if an abort signal was provided in the update data
            const signal = updateData && updateData._abortSignal;
            
            // Process the update based on type
            // Other cells of the open dataset: the selectors still apply,
            // only the points change; drawn into the graph shown, which keeps
            // the view the user chose
            if (updateType === 'subsetChanged') {
                await refreshPlot(signal);
                return;
            }

            if (updateType === 'datasetChanged') {
                if (window.Config && window.Config.DEBUG_MODE) {
                    console.log(`GenePlot ${_id}: Dataset changed, reinitializing plot`);
                }
                
                // For dataset changes, fully reinitialize the plot with abort signal
                try {
                    const datasetPath = updateData["dataset"];
                    const datasetStructure = await DataManager.getDatasetStructure(datasetPath);

                    await initializeUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);

                    // Another dataset's coordinates: the zoom and camera chosen
                    // on the previous one do not apply (the plot is drawn into
                    // the same graph, under the new dataset's uirevision)
                    _settings.viewport2D = null;
                    _settings.viewport3D = null;
                    await refreshPlot(signal);
                    
                    // If we get here, the operation completed successfully
                    return;
                } catch (error) {
                    // If this is an abort error, propagate it
                    if (error && error.name === 'AbortError') {
                        throw error;
                    }
                    
                    // Otherwise this plot shows its own failure instead of
                    // the previous dataset's plot (issue #2)
                    console.error(`Error updating gene plot ${_id}:`, error);
                    if (_plotContainer) {
                        drawPlaceholder(_plotContainer, error.coverage || Coverage.missing(GAP.FAILED,
                            error.message || 'unknown error',
                            { source: 'loading dataset', unit: 'genes' }), 'genes');
                    }
                }
            }
            
            // Handle table updates for filtering
            else if (updateType === 'tableChanged' || updateType === 'tableFiltered') {
                // Check if the update is from the table we're using for filtering
                // or if it's a direct tableChanged event without specific ID
                const tableId = updateData?.id || '';
                
                // Handle both: 
                // 1. Updates from specific table we're filtering by
                // 2. Direct tableChanged events (e.g., when a table is no longer available)
                if (tableId === '' || tableId === _settings.tableFilter) {
                    if (window.Config && window.Config.DEBUG_MODE) {
                        console.log(`GenePlot ${_id}: Filtered table ${tableId || 'none'} changed, updating plot`);
                    }
                    
                    try {
                        // Update the plot based on the table change
                        await updatePlotOnTableChange(_plotContainer, _data, _settings, refreshPlot);
                        
                        return;
                    } catch (error) {
                        if (error && error.name === 'AbortError') {
                            throw error;
                        }
                        console.error(`Error updating gene plot ${_id} after table change:`, error);
                    }
                }
            }
            
            // Return a resolved promise to indicate completion
            return Promise.resolve();
        }

        /**
         * Set specific values of the config
         * @param {Object} config - New configuration
         */
        function setConfig(config) {
            if (!config) return;
            config = restoreColorRange(config);
            
            // Update settings with new configuration
            Object.keys(config).forEach(key => {
                _settings[key] = config[key];
            });
        }

        /**
         * Update panel configuration
         * @param {Object} config - New configuration
         */
        function updateConfig(config) {
            if (!config) return;
            config = restoreColorRange(config);
            
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
            setConfig,
            updateConfig,
            onDataUpdate
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('gene-plot', GenePlotPanel);
    
    return GenePlotPanel;
})();

// Export the module
export { GenePlotPanel };