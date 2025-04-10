import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { loadAxisData, loadDataAndCreatePlot } from './plot-utilities/plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity, removeHighlight } from './plot-utilities/plot-update.js';
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { setupPlotEventListeners } from './plot-utilities/listeners.js';

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
        const _plotType = 'gene'; 
        const _container = container;
        let _plotContainer = null;
        let _controlsContainer = null;
        let _resizeObserver = null;
        
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
            color: null
        };
        
        /**
         * Initialize the panel
         */
        async function init() {
            try {
                // Create panel structure
                const { plotContainer, controlsContainer } = createPanelStructure(_container, _id, _settings);
    
                // Store references for later use
                _plotContainer = plotContainer;
                _controlsContainer = controlsContainer;
                
                console.log('Panel structure created: ', 
                    'plotContainer=', _plotContainer ? 'defined' : 'undefined',
                    'controlsContainer=', _controlsContainer ? 'defined' : 'undefined');
                
                // Initialize UI state and then load data
                console.log('Initializing UI state...');
                
                // Get the dataset structure directly from our internal function
                const datasetStructure = await DataManager.getDatasetStructure();
                if (!datasetStructure) {
                    throw new Error('Failed to load dataset structure');
                }
                
                // Now we have the dataset structure, we can initialize the UI
                await initializeUIState(_id, _settings, datasetStructure, _plotType, _controlsContainer);
                
                // Load data and create plot first
                await refreshPlot();
                
                // Only set up event listeners after the plot is created
                console.log('Plot created, setting up event listeners');
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
                loadDataAndCreatePlot: refreshPlot
            })
            
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', (e) => {
                const focusedGene = e.detail.gene;
                console.log(`Focused gene changed to: ${focusedGene}`);
                
                // Check if we're using varp data anywhere in the plot
                const usesVarpData = _settings.x.type === 'varp' || 
                                    _settings.y.type === 'varp' || 
                                    (_settings.z && _settings.z.type === 'varp') ||
                                    _settings.color.type === 'varp';
                
                if (usesVarpData) {
                    // Track which axes need updates
                    const updates = {
                        xAxis: _settings.x.type === 'varp',
                        yAxis: _settings.y.type === 'varp',
                        zAxis: _settings.z && _settings.z.type === 'varp',
                        colors: _settings.color.type === 'varp',
                        layout: false
                    };
                    
                    
                    // Handle specific update scenarios
                    if (updates.xAxis) {
                        console.log('Focused gene changed affects x-axis, loading new data');
                        _settings.x.column = focusedGene;
                        loadAxisData(_settings.x, null, 'gene').then(xData => {
                            if (xData && xData.values) {
                                _data.x = xData;
                                _updatePlotElements({ 
                                    xAxis: true,
                                    layout: true 
                                });
                            } else {
                                refreshPlot();
                            }
                        }).catch(() => refreshPlot());
                    }
                    if (updates.yAxis) {
                        console.log('Focused gene changed affects y-axis, loading new data');
                        _settings.y.column = focusedGene;
                        loadAxisData(_settings.y, null, 'gene').then(yData => {
                            if (yData && yData.values) {
                                _data.y = yData;
                                _updatePlotElements({ 
                                    yAxis: true,
                                    layout: true 
                                });
                            } else {
                                refreshPlot();
                            }
                        }).catch(() => refreshPlot());
                    }
                    if (updates.zAxis) {
                        console.log('Focused gene changed affects z-axis, loading new data');
                        _settings.z.column = focusedGene;
                        loadAxisData(_settings.z, null, 'gene').then(zData => {
                            if (zData && zData.values) {
                                _data.z = zData;
                                _updatePlotElements({ 
                                    zAxis: true,
                                    layout: true 
                                });
                            } else {
                                refreshPlot();
                            }
                        }).catch(() => refreshPlot());
                    }
                    if (updates.colors) {
                        // Only color uses varp data - we can use optimized update
                        console.log('Focused gene changed, only affects color data - using optimized update');
                        _settings.color.column = focusedGene;
                        loadColorDataAndUpdatePlot(
                            _container,
                            _plotContainer,
                            _settings,
                            _data,
                            _id,
                            refreshPlot
                        );
                    }
                } else if (_settings.highlightFocusedGene) {
                    // If the focused gene change does not affect the plot, but we are highlighting it
                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                } else {
                    console.log('Focused gene changed does not affect this plot');
                }
            });
            
            /**
             * Update axis titles and menu labels to reflect the current focused cell
             * @private
             */
            function _updateMenueLabelsForCell(focusedCell) {
                if (!_plotContainer) return;
                
                // Update UI controls in menus to show correct cell name
                const updateColumnSelectOptions = (axis) => {
                    if (_settings[axis] && _settings[axis].type === 'layer') {
                        const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
                        if (columnSelect && columnSelect.options.length > 0) {
                            // Update the option text to show the new cell name
                            columnSelect.options[0].text = `Expression in ${focusedCell}`;
                        }
                    }
                };
                
                // Update all axis column selects
                updateColumnSelectOptions('x');
                updateColumnSelectOptions('y');
                updateColumnSelectOptions('z');
                updateColumnSelectOptions('color');
            }
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', (e) => {
                console.log(`Focused cell changed to: ${e.detail.cell}`);
                const focusedCell = e.detail.cell;
                
                // Check if we're using layer data anywhere in the plot
                const usesLayerData = _settings.x.type === 'layer' || 
                                     _settings.y.type === 'layer' || 
                                     (_settings.z && _settings.z.type === 'layer') ||
                                     _settings.color.type === 'layer';
                
                if (usesLayerData) {
                    // Update all the labels that reference cells even before loading any data
                    _updateMenueLabelsForCell(focusedCell);
                    
                    // Track which axes need data updates
                    const updates = {
                        xAxis: _settings.x.type === 'layer',
                        yAxis: _settings.y.type === 'layer',
                        zAxis: _settings.z && _settings.z.type === 'layer',
                        colors: _settings.color.type === 'layer'
                    };
                    
                    // For position data updates, we now handle them using the centralized _updatePlotElements
                    const dataUpdatePromises = [];
                    
                    // If x-axis uses layer data, load new data
                    if (updates.xAxis) {
                        console.log('Focused cell changed affects x-axis, loading new data');
                        _settings.x.column = focusedCell;
                        const xPromise = loadAxisData(_settings.x, null, 'gene').then(xData => {
                            if (xData && xData.values) {
                                _data.x = xData;
                                // Update using _updatePlotElements
                                _updatePlotElements({ xAxis: true, layout: true });
                            }
                        }).catch(err => {
                            console.error("Error loading x-axis data:", err);
                        });
                        dataUpdatePromises.push(xPromise);
                    }
                    
                    // If y-axis uses layer data, load new data
                    if (updates.yAxis) {
                        console.log('Focused cell changed affects y-axis, loading new data');
                        _settings.y.column = focusedCell;
                        const yPromise = loadAxisData(_settings.y, null, 'gene').then(yData => {
                            if (yData && yData.values) {
                                _data.y = yData;
                                // Update using _updatePlotElements
                                _updatePlotElements({ yAxis: true, layout: true });
                            }
                        }).catch(err => {
                            console.error("Error loading y-axis data:", err);
                        });
                        dataUpdatePromises.push(yPromise);
                    }
                    
                    // If z-axis uses layer data, load new data
                    if (updates.zAxis) {
                        console.log('Focused cell changed affects z-axis, loading new data');
                        _settings.z.column = focusedCell;
                        const zPromise = loadAxisData(_settings.z, null, 'gene').then(zData => {
                            if (zData && zData.values) {
                                _data.z = zData;
                                // Update using _updatePlotElements
                                _updatePlotElements({ zAxis: true, layout: true });
                            }
                        }).catch(err => {
                            console.error("Error loading z-axis data:", err);
                        });
                        dataUpdatePromises.push(zPromise);
                    }
                    
                    // If color uses layer data, load and update new data
                    if (updates.colors) {
                        console.log('Focused cell changed affects color data, loading new data');
                        _settings.color.column = focusedCell;
                        // Load just the color data and update
                        loadColorDataAndUpdatePlot(
                            _container,
                            _plotContainer,
                            _settings,
                            _data,
                            _id,
                            refreshPlot
                        );
                    }
                    
                    // After all position data updates complete (if any), handle edge cases
                    if (dataUpdatePromises.length > 0) {
                        Promise.all(dataUpdatePromises)
                            .then(() => {
                                console.log("All position data updates completed");
                                
                                // If we have multiple axes updated, ensure the highlighted gene is properly updated
                                if (Object.values(updates).filter(Boolean).length > 1 && _settings.highlightFocusedGene) {
                                    removeHighlight(_plotContainer);
                                    highlightFocusedEntity(_plotContainer, _data, _settings, _plotType);
                                }
                            })
                            .catch(err => {
                                console.error("Error during position data updates:", err);
                                // Only redraw as a last resort if we hit errors
                                refreshPlot();
                            });
                    }
                } else {
                    console.log('Focused cell changed does not affect this plot');
                }
            });
        }
        

        
        /**
         * Reload the data and redraw the plot
         */
        async function refreshPlot() {
            loadDataAndCreatePlot(_container, _plotContainer, _settings, _data, _id)
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
            
            // Call the standard cleanup
            cleanup();
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
            getConfig
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('gene-plot', GenePlotPanel);
    
    return GenePlotPanel;
})();

// Export the module
export { GenePlotPanel };