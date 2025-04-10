import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { setupAxisSelector, updateColorControlsVisibility } from './plot-utilities/panel-ui-update.js';
import { loadAxisData, createPlot } from './plot-utilities/plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedCell, removeHighlight } from './plot-utilities/plot-update.js';
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';
import { DataManager } from '../data-manager.js';
import { setupPlotEventListeners } from './plot-utilities/listeners.js';

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
        const _plotType = 'cell'; 
        const _container = container;
        let _plotContainer = null;
        let _controlsContainer = null;
        let _resizeObserver = null;
        
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
                await _loadDataAndCreatePlot();
                
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
                loadDataAndCreatePlot: _loadDataAndCreatePlot
            })
            
            
            // Listen for focused cell changes
            document.addEventListener('focusedCellChanged', (e) => {
                const focusedCell = e.detail.cell;
                console.log(`Focused cell changed to: ${focusedCell}`);
                
                // Check if we're using obsp data anywhere in the plot
                const usesObspData = _settings.x.type === 'obsp' || 
                                    _settings.y.type === 'obsp' || 
                                    (_settings.z && _settings.z.type === 'obsp') ||
                                    _settings.color.type === 'obsp';
                
                if (usesObspData) {
                    // Track which axes need updates
                    const updates = {
                        xAxis: _settings.x.type === 'obsp',
                        yAxis: _settings.y.type === 'obsp',
                        zAxis: _settings.z && _settings.z.type === 'obsp',
                        colors: _settings.color.type === 'obsp',
                        layout: false
                    };
                    
                    
                    // Handle specific update scenarios
                    if (updates.xAxis) {
                        console.log('Focused cell changed affects x-axis, loading new data');
                        _settings.x.column = focusedCell;
                        loadAxisData(_settings.x).then(xData => {
                            if (xData && xData.values) {
                                _data.x = xData;
                                _updatePlotElements({ 
                                    xAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    if (updates.yAxis) {
                        console.log('Focused cell changed affects y-axis, loading new data');
                        _settings.y.column = focusedCell;
                        loadAxisData(_settings.y).then(yData => {
                            if (yData && yData.values) {
                                _data.y = yData;
                                _updatePlotElements({ 
                                    yAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    if (updates.zAxis) {
                        console.log('Focused cell changed affects z-axis, loading new data');
                        _settings.z.column = focusedCell;
                        loadAxisData(_settings.z).then(zData => {
                            if (zData && zData.values) {
                                _data.z = zData;
                                _updatePlotElements({ 
                                    zAxis: true,
                                    layout: true 
                                });
                            } else {
                                _loadDataAndCreatePlot();
                            }
                        }).catch(() => _loadDataAndCreatePlot());
                    }
                    if (updates.colors) {
                        // Only color uses obsp data - we can use optimized update
                        console.log('Focused cell changed, only affects color data - using optimized update');
                        _settings.color.column = focusedCell;
                        loadColorDataAndUpdatePlot(
                            _container,
                            _plotContainer,
                            _settings,
                            _data,
                            _id,
                            _loadDataAndCreatePlot
                        );
                    }
                } else if (_settings.highlightFocusedCell) {
                    // If the focused cell change does not affect the plot, but we are highlighting it
                    _highlightFocusedCell();
                } else {
                    console.log('Focused cell changed does not affect this plot');
                }
            });
            
            /**
             * Update axis titles and menu labels to reflect the current focused gene
             * @private
             */
            function _updateMenueLabelsForGene(focusedGene) {
                if (!_plotContainer) return;
                
                // Update UI controls in menus to show correct gene name
                const updateColumnSelectOptions = (axis) => {
                    if (_settings[axis] && _settings[axis].type === 'layer') {
                        const columnSelect = _container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
                        if (columnSelect && columnSelect.options.length > 0) {
                            // Update the option text to show the new gene name
                            columnSelect.options[0].text = `Expression of ${focusedGene}`;
                        }
                    }
                };
                
                // Update all axis column selects
                updateColumnSelectOptions('x');
                updateColumnSelectOptions('y');
                updateColumnSelectOptions('z');
                updateColumnSelectOptions('color');
            }
            
            // Listen for focused gene changes
            document.addEventListener('focusedGeneChanged', (e) => {
                console.log(`Focused gene changed to: ${e.detail.gene}`);
                const focusedGene = e.detail.gene;
                
                // Check if we're using layer data anywhere in the plot
                const usesLayerData = _settings.x.type === 'layer' || 
                                     _settings.y.type === 'layer' || 
                                     (_settings.z && _settings.z.type === 'layer') ||
                                     _settings.color.type === 'layer';
                
                if (usesLayerData) {
                    // Update all the labels that reference genes even before loading any data
                    _updateMenueLabelsForGene(focusedGene);
                    
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
                        console.log('Focused gene changed affects x-axis, loading new data');
                        _settings.x.column = focusedGene;
                        const xPromise = loadAxisData(_settings.x).then(xData => {
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
                        console.log('Focused gene changed affects y-axis, loading new data');
                        _settings.y.column = focusedGene;
                        const yPromise = loadAxisData(_settings.y).then(yData => {
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
                        console.log('Focused gene changed affects z-axis, loading new data');
                        _settings.z.column = focusedGene;
                        const zPromise = loadAxisData(_settings.z).then(zData => {
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
                        console.log('Focused gene changed affects color data, loading new data');
                        _settings.color.column = focusedGene;
                        // Load just the color data and update
                        loadColorDataAndUpdatePlot(
                            _container,
                            _plotContainer,
                            _settings,
                            _data,
                            _id,
                            _loadDataAndCreatePlot
                        );
                    }
                    
                    // After all position data updates complete (if any), handle edge cases
                    if (dataUpdatePromises.length > 0) {
                        Promise.all(dataUpdatePromises)
                            .then(() => {
                                console.log("All position data updates completed");
                                
                                // If we have multiple axes updated, ensure the highlighted cell is properly updated
                                if (Object.values(updates).filter(Boolean).length > 1 && _settings.highlightFocusedCell) {
                                    removeHighlight(_plotContainer);
                                    _highlightFocusedCell();
                                }
                            })
                            .catch(err => {
                                console.error("Error during position data updates:", err);
                                // Only redraw as a last resort if we hit errors
                                _loadDataAndCreatePlot();
                            });
                    }
                } else {
                    console.log('Focused gene changed does not affect this plot');
                }
            });
        }
        

        
        /**
         * Load data based on current settings and create the plot
         * @private
         */
        async function _loadDataAndCreatePlot() {
            try {
                const cells = DataManager.getCells();
                if (!cells || !cells.length) {
                    _plotContainer.innerHTML = '<div class="alert alert-warning">No cells available</div>';
                    return;
                }
                
                // Show loading indicator
                _plotContainer.innerHTML = '<div class="spinner"></div> Loading plot data...';
                
                // Validate settings before loading data
                for (const axis of ['x', 'y', 'z', 'color']) {
                    if (axis === 'z' && !_settings.z) continue; // Skip z-axis if not used
                    
                    const settings = _settings[axis];
                    console.log(`Validating ${axis} axis settings:`, settings);
                    
                    if (!settings) {
                        throw new Error(`No settings found for ${axis} axis`);
                    }
                    
                    // Validate type
                    if (!settings.type) {
                        _plotContainer.innerHTML = `<div class="alert alert-warning">
                            Missing type for ${axis}-axis
                        </div>`;
                        return;
                    }
                    
                    // For obsm, ensure we have a key
                    if (settings.type === 'obsm') {
                        if (!settings.key || settings.key === '') {
                            _plotContainer.innerHTML = `<div class="alert alert-warning">
                                Please select an obsm key for the ${axis}-axis
                            </div>`;
                            return;
                        }
                        
                        // Ensure we have a column specified
                        if (settings.column === undefined || settings.column === null || settings.column === '') {
                          // Get the global dataset structure for the current obsm key
                          const ds = await DataManager.getDatasetStructure();
                          if (ds && ds.obsm && ds.obsm.dataframes && ds.obsm.dataframes[settings.key]) {
                            const df = ds.obsm.dataframes[settings.key];
                            if (df.columns && df.columns.length > 0) {
                              if (axis === 'x') {
                                settings.column = df.columns[0]; // First column for x-axis
                              } else if (axis === 'y') {
                                settings.column = df.columns.length >= 2 ? df.columns[1] : df.columns[0];
                              } else if (axis === 'z') {
                                if (df.columns.length >= 3) {
                                  settings.column = df.columns[2];
                                } else {
                                  settings.column = df.columns[0];
                                }
                              } else if (axis === 'color') {
                                if (df.columns.length >= 4) {
                                    settings.column = df.columns[3];
                                  } else {
                                    settings.column = df.columns[0];
                                  }
                                }
                              console.log(`Setting default column '${settings.column}' for ${axis}-axis obsm.${settings.key}`);
                            } else {
                              settings.column = '0';
                              console.log(`No columns found in global dataset for obsm.${settings.key}, defaulting ${axis}-axis column to '0'`);
                            }
                          } else {
                            settings.column = '0';
                            console.log(`Global dataset structure does not have obsm.${settings.key}, defaulting ${axis}-axis column to '0'`);
                          }
                        }
                    }
                }
                
                // Reset cached data without changing the reference:
                // This is important because it maintains the original object reference—any part of the code
                // that holds a reference to _data will automatically see the updated values.
                Object.keys(_data).forEach(key => delete _data[key]);
                Object.assign(_data, {
                    x: null,
                    y: null,
                    z: null,
                    color: null,
                    cells: cells
                });
        
            
                // Build an array of promises for axis and color data
                const loadPromises = [
                    (async () => {
                        console.log('Loading X-axis data:', _settings.x);
                        _data.x = await loadAxisData(_settings.x);
                    })(),
                    (async () => {
                        console.log('Loading Y-axis data:', _settings.y);
                        _data.y = await loadAxisData(_settings.y);
                    })(),
                ];
            
                if (_settings.z) {
                    loadPromises.push(
                        (async () => {
                            console.log('Loading Z-axis data:', _settings.z);
                            _data.z = await loadAxisData(_settings.z);
                        })()
                    );
                }
            
                // Include color loading concurrently
                loadPromises.push(
                    (async () => {
                        console.log('Loading color data:', _settings.color);
                        try {
                            const colorData = await loadAxisData(_settings.color);
                            _data.color = colorData.values;
                            _data.colorType = colorData.type;
                            _data.colorCategories = colorData.categories;
                            updateColorControlsVisibility(_container, _data.colorType, _id);
                        } catch (err) {
                            console.error("Error loading color data:", err);
                        }
                    })()
                );
            
                // Wait for all loads to complete
                await Promise.all(loadPromises);
                
                // Validate data before creating plot
                if (_data.x && _data.x.values && _data.x.values.length > 0 &&
                    _data.y && _data.y.values && _data.y.values.length > 0) {
                    console.log(`Creating plot with ${_data.x.values.length} data points`);

                    await createPlot(_container, _plotContainer, _settings, _data, _id);
                    updateColorControlsVisibility(_container, _data.colorType, _id);
                    

                } else {
                    console.error('Insufficient data for plotting');
                    _plotContainer.innerHTML = `<div class="alert alert-warning">
                        Insufficient data for plotting. X axis has 
                        ${_data.x && _data.x.values ? _data.x.values.length : 0} points, 
                        Y axis has ${_data.y && _data.y.values ? _data.y.values.length : 0} points.
                    </div>`;
                }
                
            } catch (error) {
                console.error('Error loading plot data:', error);
                _plotContainer.innerHTML = `<div class="alert alert-danger">Error loading data: ${error.message}</div>`;
            }
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
            updatePlotElements(_plotContainer, _data, _settings, _loadDataAndCreatePlot, options);
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
            
            // Call the standard cleanup
            cleanup();
        }
        
        /**
         * Highlight the focused cell in the plot
         * @private
         */
        function _highlightFocusedCell() {
            highlightFocusedCell(_plotContainer, _data, _settings);
        }
        
        
        // Listen for focused cell changed events to update highlighting
        document.addEventListener('focusedCellChanged', (event) => {
            if (_settings.highlightFocusedCell) {
                _highlightFocusedCell();
            }
        });
        
        // Public API
        return {
            init,
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
    PanelManager.registerPanelType('cell-plot', CellPlotPanel);
    
    return CellPlotPanel;
})();

// Export the module
export { CellPlotPanel };