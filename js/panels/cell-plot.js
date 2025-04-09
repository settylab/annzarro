import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { setupAxisSelector } from './plot-utilities/panel-ui-update.js';
import { loadAxisData } from './plot-utilities/plot-make.js';
import { updatePlotElements, highlightFocusedCell, removeHighlight } from './plot-utilities/plot-update.js';
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
        let _fullPlotData = null;
        let _plot = null;
        let _resizeObserver = null;
        let _resizeTimeout = null;
        
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
                plot: _plot,
                settings: _settings,
                plotType: _plotType,
                data: _data,
                loadColorDataAndUpdatePlot: _loadColorDataAndUpdatePlot,
                loadDataAndCreatePlot: _loadDataAndCreatePlot
            })
            
            // 3D plot toggle - this always requires plot recreation since it changes the plot type
            const zAxisToggle = document.getElementById(`z-axis-toggle-${_id}`);
            zAxisToggle.addEventListener('click', async () => {
              const is3D = zAxisToggle.classList.contains('active');
              const zAxisContainer = document.getElementById(`z-axis-container-${_id}`);
            
              if (is3D) {
                // Disable 3D
                zAxisToggle.classList.remove('active', 'btn-primary');
                zAxisToggle.classList.add('btn-outline-secondary');
                zAxisToggle.setAttribute('title', 'Enable 3D plot');
            
                zAxisContainer.style.display = 'none';
                _settings.z = null;
                _loadDataAndCreatePlot();
              } else {
                // Enable 3D
                zAxisToggle.classList.add('active', 'btn-primary');
                zAxisToggle.classList.remove('btn-outline-secondary');
                zAxisToggle.setAttribute('title', '3rd dimension active - click to disable');
            
                zAxisContainer.style.display = 'block';
            
                if (!_settings.z) {
                    const yKey = _settings.y?.key || '';
                    let zColumn = '2';
            
                    const datasetStructure = await DataManager.getDatasetStructure();
                    const df = datasetStructure?.obsm?.dataframes?.[yKey];
                    const yCol = _settings.y?.column;
            
                    if (df?.columns?.length) {
                    const yIdx = df.columns.indexOf(yCol);
                    if (yIdx !== -1 && yIdx + 1 < df.columns.length) {
                        zColumn = df.columns[yIdx + 1];
                    } else {
                        zColumn = df.columns.at(-1); // fallback to last column
                    }
                    }
            
                    _settings.z = { type: 'obsm', key: yKey, column: zColumn };
                    setupAxisSelector(_controlsContainer, 'z', _settings.z, _plotType, datasetStructure);
                }
            
                _loadDataAndCreatePlot();
              }
            });
            
            // Point size slider - use centralized update system
            const pointSizeSlider = document.getElementById(`point-size-${_id}`);
            pointSizeSlider.addEventListener('input', (e) => {
                const newSize = parseFloat(e.target.value);
                _settings.pointSize = newSize;
                
                // Update styling only
                _updatePlotElements({
                    styling: true
                });
            });
            
            // Point opacity slider - use centralized update system
            const pointOpacitySlider = document.getElementById(`point-opacity-${_id}`);
            pointOpacitySlider.addEventListener('input', (e) => {
                const newOpacity = parseFloat(e.target.value);
                _settings.pointOpacity = newOpacity;
                
                // Update styling only
                _updatePlotElements({
                    styling: true
                });
            });
            
            // Color scale selector - use centralized update system
            const colorScaleSelect = document.getElementById(`color-scale-${_id}`);
            colorScaleSelect.addEventListener('change', (e) => {
                const newColorScale = e.target.value;
                _settings.colorScale = newColorScale;
                
                // Only update for numerical data, categorical uses discrete colors
                if (_data.colorType === 'numerical' && _plot) {
                    // Use centralized update system for color updates
                    _updatePlotElements({ colors: true, colorScale: true });
                    console.log(`Updated colorscale to ${newColorScale} without redrawing`);
                } else {
                    _loadDataAndCreatePlot();
                }
            });
            
            // Category palette selector
            const categoryPaletteSelect = document.getElementById(`category-palette-${_id}`);
            categoryPaletteSelect.addEventListener('change', (e) => {
                const oldPalette = _settings.categoryPalette;
                _settings.categoryPalette = e.target.value;
                
                // Check if we have a plot and valid data
                if (_plot && _data.colorType === 'categorical') {
                    _loadDataAndCreatePlot();
                }
            });
            
            // Color range inputs and sliders
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
            
            // Track centering state
            _settings.centeringActive = _settings.centeringActive || false;
            
            // Helper function to update color range values without affecting sliders
            function _updateColorRange(min, max, updateSliders = true, triggerPlotUpdate = true) {
                _settings.colorMin = min !== '' ? parseFloat(min) : null;
                _settings.colorMax = max !== '' ? parseFloat(max) : null;
                
                // Update input fields
                colorMinInput.value = _settings.colorMin !== null ? _settings.colorMin : '';
                colorMaxInput.value = _settings.colorMax !== null ? _settings.colorMax : '';
                
                // Update sliders if requested and we have valid data range
                if (updateSliders && _data && _data.color && Array.isArray(_data.color)) {
                    // Get data range
                    const validValues = _data.color.filter(v => !isNaN(v));
                    const dataMin = Math.min(...validValues);
                    const dataMax = Math.max(...validValues);
                    
                    // Set slider values but don't update inputs again (to avoid recursive triggers)
                    colorMinSlider.value = _settings.colorMin !== null ? _settings.colorMin : dataMin;
                    colorMaxSlider.value = _settings.colorMax !== null ? _settings.colorMax : dataMax;
                }
                
                // Only trigger plot update if specified
                if (triggerPlotUpdate) {
                    _updatePlot(false); // false = only update visual properties, don't recreate plot
                }
            }
            
            // Min input
            colorMinInput.addEventListener('change', (e) => {
                const minValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
                const maxValue = _settings.colorMax;
                _updateColorRange(minValue, maxValue, true);
                
                // Turn off centering when manually editing
                _settings.centeringActive = false;
                _updateCenteringUI();
            });
            
            // Max input
            colorMaxInput.addEventListener('change', (e) => {
                const minValue = _settings.colorMin;
                const maxValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
                _updateColorRange(minValue, maxValue, true);
                
                // Turn off centering when manually editing
                _settings.centeringActive = false;
                _updateCenteringUI();
            });
            
            // Debounce function to prevent too many updates
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            
            // Direct Plotly update for sliders without full update mechanism
            function updateColorRange(minOrMax, value) {
                if (!_plot || !_plot.data || !_plot.data[0] || !_plot.data[0].marker) return;
                
                // Just update the specific property directly using Plotly API
                const update = {};
                update[`marker.c${minOrMax}`] = value;
                
                Plotly.restyle(_plotContainer, update, [0]);
            }

            const hideOutliersButton = document.getElementById(`hide-outliers-${_id}`);
            
            // Initialize button appearance based on the current setting
            if (_settings.hideOutliers) {
              hideOutliersButton.classList.add('active', 'btn-primary');
              hideOutliersButton.classList.remove('btn-outline-secondary');
            } else {
              hideOutliersButton.classList.remove('active', 'btn-primary');
              hideOutliersButton.classList.add('btn-outline-secondary');
            }
            
            hideOutliersButton.addEventListener('click', () => {
              // Toggle the setting
              _settings.hideOutliers = !_settings.hideOutliers;
              if (_settings.hideOutliers) {
                hideOutliersButton.classList.add('active', 'btn-primary');
                hideOutliersButton.classList.remove('btn-outline-secondary');
              } else {
                hideOutliersButton.classList.remove('active', 'btn-primary');
                hideOutliersButton.classList.add('btn-outline-secondary');
              }
              _updatePlotElements({ filter: true });
            });
            
            // Helper function to ensure we have full plot data before filtering
            function ensureFullPlotData() {
                if (!_fullPlotData && _plot && _plot.data) {
                    try {
                        console.log("Creating backup of plot data for filtering");
                        _fullPlotData = JSON.parse(JSON.stringify(_plot.data));
                    } catch (error) {
                        console.error("Failed to create backup of plot data:", error);
                    }
                }
            }
            
            // Min slider - use input for real-time updates
            colorMinSlider.addEventListener('input', (e) => {
                const minValue = parseFloat(e.target.value);
                colorMinInput.value = minValue.toFixed(2);
                
                // Update settings
                _settings.colorMin = minValue;
                
                // Direct efficient update for smooth slider experience
                updateColorRange('min', minValue);
                _updatePlotElements({
                    colors: true,
                    colorRange: true,
                    filter: _settings.hideOutliers
                  });
            });
            
            // Min slider - on change for final update
            colorMinSlider.addEventListener('change', (e) => {
                console.log('Min slider change completed');
                // Immediate update on mouseup
                _updatePlotColorRangeOnly();
            });
            
            // Max slider - use input for real-time updates
            colorMaxSlider.addEventListener('input', (e) => {
                const maxValue = parseFloat(e.target.value);
                colorMaxInput.value = maxValue.toFixed(2);
                
                // Update settings
                _settings.colorMax = maxValue;
                
                // Direct efficient update for smooth slider experience
                updateColorRange('max', maxValue);
                _updatePlotElements({
                    colors: true,
                    colorRange: true,
                    filter: _settings.hideOutliers
                  });
            });
            
            // Max slider - on change for final update
            colorMaxSlider.addEventListener('change', (e) => {
                console.log('Max slider change completed');
                // Immediate update on mouseup
                _updatePlotColorRangeOnly();
            });
            
            // Helper function to update only the color range
            function _updatePlotColorRangeOnly() {
                // Use the centralized update system with only the color ranges
                _updatePlotElements({
                    colors: true,
                    colorRange: true, // Only update the color range (min/max)
                    colorData: false, // Don't update the actual data array
                    colorScale: false, // Don't update the color scale
                    layout: false,
                    styling: false
                });
            }
            
            // Function to apply centering to colormap
            function _applyCentering() {
                if (!_data || !_data.color || !Array.isArray(_data.color)) return;
                
                // Only apply if centering is active
                if (!_settings.centeringActive) return;
                
                // Filter out NaN values
                const validValues = _data.color.filter(v => !isNaN(v));
                
                if (validValues.length > 0) {
                    // Find the absolute maximum (positive or negative)
                    const absMax = Math.max(
                        Math.abs(Math.min(...validValues)), 
                        Math.abs(Math.max(...validValues))
                    );
                    
                    // Update the settings
                    _settings.colorMin = -absMax;
                    _settings.colorMax = absMax;
                    
                    // Update input fields
                    const colorMinInput = document.getElementById(`color-min-${_id}`);
                    const colorMaxInput = document.getElementById(`color-max-${_id}`);
                    
                    if (colorMinInput) colorMinInput.value = (-absMax).toFixed(2);
                    if (colorMaxInput) colorMaxInput.value = absMax.toFixed(2);
                    
                    // Update the sliders with appropriate constraints
                    const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                    const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                    
                    if (colorMinSlider && colorMaxSlider) {
                        // When centering is active:
                        // - Min slider can only have values up to 0
                        // - Max slider can only have values from 0 up
                        
                        // Find the full data range
                        const dataMin = Math.min(...validValues);
                        const dataMax = Math.max(...validValues);
                        
                        // Set different ranges for min and max sliders
                        colorMinSlider.min = Math.min(-absMax, dataMin);
                        colorMinSlider.max = 0; // Min slider can only go up to 0
                        
                        colorMaxSlider.min = 0; // Max slider can only go from 0
                        colorMaxSlider.max = Math.max(absMax, dataMax);
                        
                        // Set values to maintain symmetry
                        colorMinSlider.value = -absMax;
                        colorMaxSlider.value = absMax;
                    }
                    
                    // Update the plot color range directly without redrawing
                    if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                        Plotly.restyle(_plotContainer, {
                            'marker.cmin': -absMax,
                            'marker.cmax': absMax
                        }, [0]);
                    } else {
                        // Use the helper to update only color range
                        _updatePlotColorRangeOnly();
                    }
                }
            }
            
            // Special event listeners for when centering is active
            function _setupCenteringSliderListeners() {
                const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                
                if (!colorMinSlider || !colorMaxSlider) return;
                
                // Remove existing centering-specific listeners if any
                colorMinSlider.removeEventListener('input', _centeringMinSliderHandler);
                colorMaxSlider.removeEventListener('input', _centeringMaxSliderHandler);
                
                // Only add these listeners if centering is active
                if (_settings.centeringActive) {
                    // Add the listeners back
                    colorMinSlider.addEventListener('input', _centeringMinSliderHandler);
                    colorMaxSlider.addEventListener('input', _centeringMaxSliderHandler);
                }
            }
            
            // Handler for min slider during centering
            function _centeringMinSliderHandler(e) {
                if (!_settings.centeringActive) return;
                
                const minValue = parseFloat(e.target.value);
                const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                
                // Ensure symmetry by setting max to negative of min
                const maxValue = -minValue;
                
                // Update settings
                _settings.colorMin = minValue;
                _settings.colorMax = maxValue;
                
                // Update UI
                colorMinInput.value = minValue.toFixed(2);
                if (colorMaxInput) colorMaxInput.value = maxValue.toFixed(2);
                if (colorMaxSlider) colorMaxSlider.value = maxValue;
                
                // Update plot
                if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                    Plotly.restyle(_plotContainer, {
                        'marker.cmin': minValue,
                        'marker.cmax': maxValue
                    }, [0]);
                }
            }
            
            // Handler for max slider during centering
            function _centeringMaxSliderHandler(e) {
                if (!_settings.centeringActive) return;
                
                const maxValue = parseFloat(e.target.value);
                const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                const colorMinInput = document.getElementById(`color-min-${_id}`);
                const colorMaxInput = document.getElementById(`color-max-${_id}`);
                
                // Ensure symmetry by setting min to negative of max
                const minValue = -maxValue;
                
                // Update settings
                _settings.colorMin = minValue;
                _settings.colorMax = maxValue;
                
                // Update UI
                colorMaxInput.value = maxValue.toFixed(2);
                if (colorMinInput) colorMinInput.value = minValue.toFixed(2);
                if (colorMinSlider) colorMinSlider.value = minValue;
                
                // Update plot
                if (_plot && _plot.data && _plot.data[0] && _plot.data[0].marker) {
                    Plotly.restyle(_plotContainer, {
                        'marker.cmin': minValue,
                        'marker.cmax': maxValue
                    }, [0]);
                }
            }
            
            // Update centering UI based on state
            function _updateCenteringUI() {
              const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
              const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
              const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);

              _setupCenteringSliderListeners();
            
              if (_settings.centeringActive) {
                // Update button appearance
                centerColormapButton.classList.add('active', 'btn-primary');
                centerColormapButton.classList.remove('btn-outline-secondary');
                centerColormapButton.setAttribute('title', 'Centering active - click to disable');
            
                // Apply centering immediately 
                _applyCentering();
              } else {
                // Update button appearance
                centerColormapButton.classList.remove('active', 'btn-primary');
                centerColormapButton.classList.add('btn-outline-secondary');
                centerColormapButton.setAttribute('title', 'Center color scale at 0');
            
                if (colorMinSlider && colorMaxSlider) {
                  // Restore normal slider ranges based on the full data range
                  if (_data && _data.color && Array.isArray(_data.color)) {
                    const validValues = _data.color.filter(v => !isNaN(v));
                    if (validValues.length > 0) {
                      const dataMin = Math.min(...validValues);
                      const dataMax = Math.max(...validValues);
            
                      // Reset to full range
                      colorMinSlider.min = dataMin;
                      colorMinSlider.max = dataMax;
                      colorMaxSlider.min = dataMin;
                      colorMaxSlider.max = dataMax;
            
                      // Ensure the current slider values are within the new range
                      let currentMin = parseFloat(colorMinSlider.value);
                      let currentMax = parseFloat(colorMaxSlider.value);
            
                      if (currentMin < dataMin) {
                        currentMin = dataMin;
                        colorMinSlider.value = dataMin;
                        _settings.colorMin = dataMin;
                      } else if (currentMin > dataMax) {
                        currentMin = dataMax;
                        colorMinSlider.value = dataMax;
                        _settings.colorMin = dataMax;
                      }
            
                      if (currentMax < dataMin) {
                        currentMax = dataMin;
                        colorMaxSlider.value = dataMin;
                        _settings.colorMax = dataMin;
                      } else if (currentMax > dataMax) {
                        currentMax = dataMax;
                        colorMaxSlider.value = dataMax;
                        _settings.colorMax = dataMax;
                      }
                    }
                  }
                }
              }
            }
            
            // Center at 0 button - toggle behavior
            const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
            centerColormapButton.addEventListener('click', () => {
                // Get current state before toggling
                const wasActive = _settings.centeringActive;
                
                // Toggle the centering active state
                _settings.centeringActive = !_settings.centeringActive;
                _updateCenteringUI();
            });

            const reverseColormapButton = document.getElementById(`reverse-colormap-${_id}`);
            reverseColormapButton.addEventListener('click', () => {
                _settings.colorReversed = !_settings.colorReversed;
            
                // Update button style
                reverseColormapButton.classList.toggle('btn-primary', _settings.colorReversed);
                reverseColormapButton.classList.toggle('btn-outline-secondary', !_settings.colorReversed);
                reverseColormapButton.classList.toggle('active', _settings.colorReversed);

                _updatePlotElements({colorScale: true, colors: true});
            });
            
            // Hide outliers toggle
            const hideOutliersToggle = document.getElementById(`hide-outliers-${_id}`);
            hideOutliersToggle.addEventListener('change', (e) => {
                _settings.hideOutliers = e.target.checked;
                
                // Directly update the visibility of points without redrawing the plot
                if (_plot && _data.color && _data.colorType === 'numerical') {
                    try {
                        const pointVisibility = [];
                        
                        // Create an array of true/false for each point based on range
                        for (let i = 0; i < _data.color.length; i++) {
                            const val = _data.color[i];
                            if (isNaN(val)) {
                                // NaN values are always visible
                                pointVisibility.push(true);
                            } else if (_settings.hideOutliers) {
                                // When hiding outliers, only show points within range
                                const inRange = (_settings.colorMin === null || val >= _settings.colorMin) && 
                                              (_settings.colorMax === null || val <= _settings.colorMax);
                                pointVisibility.push(inRange);
                            } else {
                                // When not hiding outliers, show all points
                                pointVisibility.push(true);
                            }
                        }
                        
                        // Direct Plotly update for efficiency
                        Plotly.restyle(_plotContainer, {
                            'visible': [pointVisibility]
                        }, [0]);
                        
                        console.log(`Updated point visibility based on outlier setting: hide=${_settings.hideOutliers}`);
                    } catch (error) {
                        console.error('Error updating point visibility:', error);
                        // Fall back to standard update
                        _updatePlot();
                    }
                } else {
                    // Fall back to standard update for non-numerical data
                    _updatePlot();
                }
            });
            
            // Show grid toggle
            const showGridToggle = document.getElementById(`show-grid-${_id}`);
            // Initialize checked state from settings
            if (_settings.showGrid) {
              showGridToggle.classList.add('active', 'btn-primary');
              showGridToggle.classList.remove('btn-outline-secondary');
            } else {
              showGridToggle.classList.remove('active', 'btn-primary');
              showGridToggle.classList.add('btn-outline-secondary');
            }
            showGridToggle.addEventListener('click', () => {
                  // Toggle the setting
                  _settings.showGrid = !_settings.showGrid;
                  
                  // Update button appearance based on the new state
                  if (_settings.showGrid) {
                    showGridToggle.classList.add('active', 'btn-primary');
                    showGridToggle.classList.remove('btn-outline-secondary');
                  } else {
                    showGridToggle.classList.remove('active', 'btn-primary');
                    showGridToggle.classList.add('btn-outline-secondary');
                  }
                
                // Update grid, axes, and other line visibility without redrawing the plot
                if (_plot) {
                    const update = {
                        // Grid lines
                        'xaxis.showgrid': _settings.showGrid,
                        'yaxis.showgrid': _settings.showGrid,
                        // Axis lines
                        'xaxis.showline': _settings.showGrid,
                        'yaxis.showline': _settings.showGrid,
                        // Zero lines
                        'xaxis.zeroline': _settings.showGrid,
                        'yaxis.zeroline': _settings.showGrid,
                        // Tick marks
                        'xaxis.ticks': _settings.showGrid ? '' : 'none',
                        'yaxis.ticks': _settings.showGrid ? '' : 'none',
                        // Tick labels
                        'xaxis.showticklabels': _settings.showGrid,
                        'yaxis.showticklabels': _settings.showGrid
                    };
                    
                    // For 3D plots, add the z-axis settings
                    if (_settings.z) {
                        update['scene.xaxis.showgrid'] = _settings.showGrid;
                        update['scene.yaxis.showgrid'] = _settings.showGrid;
                        update['scene.zaxis.showgrid'] = _settings.showGrid;
                        
                        update['scene.xaxis.showline'] = _settings.showGrid;
                        update['scene.yaxis.showline'] = _settings.showGrid;
                        update['scene.zaxis.showline'] = _settings.showGrid;
                        
                        update['scene.xaxis.zeroline'] = _settings.showGrid;
                        update['scene.yaxis.zeroline'] = _settings.showGrid;
                        update['scene.zaxis.zeroline'] = _settings.showGrid;
                        
                        update['scene.xaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        update['scene.yaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        update['scene.zaxis.ticks'] = _settings.showGrid ? '' : 'none';
                        
                        update['scene.xaxis.showticklabels'] = _settings.showGrid;
                        update['scene.yaxis.showticklabels'] = _settings.showGrid;
                        update['scene.zaxis.showticklabels'] = _settings.showGrid;
                    }
                    
                    Plotly.relayout(_plotContainer, update);
                }
            });
            
            // Highlight focused cell toggle
            const highlightFocusedCellToggle = document.getElementById(`highlight-focused-cell-${_id}`);
            // Initialize button state from settings
            if (_settings.highlightFocusedCell) {
              highlightFocusedCellToggle.classList.add('active', 'btn-primary');
              highlightFocusedCellToggle.classList.remove('btn-outline-secondary');
            } else {
              highlightFocusedCellToggle.classList.remove('active', 'btn-primary');
              highlightFocusedCellToggle.classList.add('btn-outline-secondary');
            }
            
            highlightFocusedCellToggle.addEventListener('click', () => {
                // Toggle the setting
                _settings.highlightFocusedCell = !_settings.highlightFocusedCell;
                
                // Update button appearance based on the new state
                if (_settings.highlightFocusedCell) {
                  highlightFocusedCellToggle.classList.add('active', 'btn-primary');
                  highlightFocusedCellToggle.classList.remove('btn-outline-secondary');
                } else {
                  highlightFocusedCellToggle.classList.remove('active', 'btn-primary');
                  highlightFocusedCellToggle.classList.add('btn-outline-secondary');
                }
                
                // Update the highlighting on the plot
                if (_settings.highlightFocusedCell) {
                    _highlightFocusedCell();
                } else {
                    _removeHighlight();
                }
            });
            
            // Refresh plot button
            const refreshPlotButton = document.getElementById(`refresh-plot-${_id}`);
            refreshPlotButton.addEventListener('click', () => {
                // Show loading indicator
                if (_plotContainer) {
                    _plotContainer.innerHTML = '<div class="alert alert-info">Refreshing plot...</div>';
                }
                // Reload data and recreate the plot
                _loadDataAndCreatePlot();
            });
            
            const lockRangeButton = document.getElementById(`lock-range-${_id}`);

            // Initialize appearance based on the setting
            if (_settings.lockColorRange) {
              lockRangeButton.classList.add('active', 'btn-primary');
              lockRangeButton.classList.remove('btn-outline-secondary');
            } else {
              lockRangeButton.classList.remove('active', 'btn-primary');
              lockRangeButton.classList.add('btn-outline-secondary');
            }
            
            lockRangeButton.addEventListener('click', () => {
              // Toggle the setting
              _settings.lockColorRange = !_settings.lockColorRange;
              
              if (_settings.lockColorRange) {
                lockRangeButton.classList.add('active', 'btn-primary');
                lockRangeButton.classList.remove('btn-outline-secondary');
              } else {
                lockRangeButton.classList.remove('active', 'btn-primary');
                lockRangeButton.classList.add('btn-outline-secondary');
              }
              
              // (Optional) If you want to trigger an update that respects the locked range:
              // _updatePlot(false); or a similar function call here.
            });
            
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
                        _loadColorDataAndUpdatePlot();
                    }
                } else {
                    console.log('Focused cell changed does not affect this plot');
                }
            });
            
            /**
             * Update axis titles and menu labels to reflect the current focused gene
             * @private
             */
            function _updateMenueLabelsForGene(focusedGene) {
                if (!_plot) return;
                
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
                        _loadColorDataAndUpdatePlot();
                    }
                    
                    // After all position data updates complete (if any), handle edge cases
                    if (dataUpdatePromises.length > 0) {
                        Promise.all(dataUpdatePromises)
                            .then(() => {
                                console.log("All position data updates completed");
                                
                                // If we have multiple axes updated, ensure the highlighted cell is properly updated
                                if (Object.values(updates).filter(Boolean).length > 1 && _settings.highlightFocusedCell) {
                                    _removeHighlight();
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
         * Load only color data and update the plot without recreating it
         * @private 
         */
        /**
         * Updates the visibility of color controls based on the current color type
         * @private
         */
        function _updateColorControlsVisibility() {
            const colorRangeContainer = document.getElementById(`color-range-container-${_id}`);
            const colorScaleSelect = document.getElementById(`color-scale-${_id}`);
            const categoryPaletteSelect = document.getElementById(`category-palette-${_id}`);
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
            const centerColormapButton = document.getElementById(`center-colormap-${_id}`);
            const hideOutliersButton = document.getElementById(`hide-outliers-${_id}`);
            const numericalLabel = document.getElementById(`numerical-color-label-${_id}`);
            const categoricalLabel = document.getElementById(`categorical-color-label-${_id}`);
            
            // Get slider containers that contain the labels
            const colorMinSliderContainer = colorMinSlider ? colorMinSlider.closest('.color-min-slider-container') : null;
            const colorMaxSliderContainer = colorMaxSlider ? colorMaxSlider.closest('.color-max-slider-container') : null;
            
            // Only proceed if we have the container
            if (!colorRangeContainer) return;
            
            if (_data.colorType === 'numerical') {
                // Show numerical color controls
                colorRangeContainer.style.display = 'flex';
                colorScaleSelect.style.display = 'block';
                categoryPaletteSelect.style.display = 'none';
                colorMinInput.style.display = 'block';
                colorMaxInput.style.display = 'block';
                colorMinSlider.style.display = 'block';
                colorMaxSlider.style.display = 'block';
                
                // Show slider containers with Min/Max labels
                if (colorMinSliderContainer) colorMinSliderContainer.style.display = 'block';
                if (colorMaxSliderContainer) colorMaxSliderContainer.style.display = 'block';
                
                // Show numerical controls and buttons - use setAttribute to override any inline styles
                if (centerColormapButton) centerColormapButton.setAttribute('style', 'display: inline-block !important; margin-right: 4px !important');
                if (hideOutliersButton) hideOutliersButton.setAttribute('style', 'display: inline-block !important; margin-right: 4px !important');
                
                const lockRangeButton = document.getElementById(`lock-range-${_id}`);
                if (lockRangeButton) lockRangeButton.setAttribute('style', 'display: inline-block !important');
                
                
                // Show the toolbar for numerical controls
                const buttonToolbar = _container.querySelector('.btn-toolbar');
                if (buttonToolbar) {
                    buttonToolbar.setAttribute('style', 'width: 100%; display: flex !important; flex-direction: row !important; gap: 4px');
                    // Show all button groups inside
                    buttonToolbar.querySelectorAll('.btn-group').forEach(group => {
                        group.setAttribute('style', 'width: auto; display: inline-flex !important; flex-wrap: nowrap !important; gap: 4px');
                    });
                }
                
                // Show the entire color range inputs section
                const colorRangeInputs = _container.querySelector('.color-range-inputs');
                if (colorRangeInputs) colorRangeInputs.style.display = 'block';
                
            } else if (_data.colorType === 'categorical') {
                // Show categorical color controls
                colorRangeContainer.style.display = 'flex';
                colorScaleSelect.style.display = 'none';
                // Make sure the category palette selector is prominently displayed
                categoryPaletteSelect.style.display = 'block';
                categoryPaletteSelect.style.margin = '10px 0';
                colorMinInput.style.display = 'none';
                colorMaxInput.style.display = 'none';
                colorMinSlider.style.display = 'none';
                colorMaxSlider.style.display = 'none';
                
                // Hide slider containers with Min/Max labels
                if (colorMinSliderContainer) colorMinSliderContainer.style.display = 'none';
                if (colorMaxSliderContainer) colorMaxSliderContainer.style.display = 'none';
                
                // Handle the numerical control buttons - need to override inline styles with !important
                if (centerColormapButton) centerColormapButton.setAttribute('style', 'display: none !important');
                if (hideOutliersButton) hideOutliersButton.setAttribute('style', 'display: none !important');
                
                const lockRangeButton = document.getElementById(`lock-range-${_id}`);
                if (lockRangeButton) lockRangeButton.setAttribute('style', 'display: none !important');
                
                // Also hide the button toolbar (and all its button groups) for cleaner UI
                const buttonToolbar = _container.querySelector('.btn-toolbar');
                if (buttonToolbar) {
                    buttonToolbar.setAttribute('style', 'display: none !important');
                    // Also hide any button groups inside
                    buttonToolbar.querySelectorAll('.btn-group').forEach(group => {
                        group.setAttribute('style', 'display: none !important');
                    });
                }
                
                // Hide the entire color range inputs section
                const colorRangeInputs = _container.querySelector('.color-range-inputs');
                if (colorRangeInputs) colorRangeInputs.style.display = 'none';
                
                // Show categorical label, hide numerical label
                numericalLabel.style.display = 'none';
                categoricalLabel.style.display = 'inline';
                
            } else {
                // Hide all color controls for 'none' type
                colorRangeContainer.style.display = 'none';
            }
        }
        
        async function _loadColorDataAndUpdatePlot() {
            try {
                // Track if centering was active before updating
                const wasCenteringActive = _settings.centeringActive;
                
                const filteredCellIndices = _settings.subsettedCells && _settings.hideNonSubset
                    ? _settings.subsettedCells.map(cell => DataManager.getCellIndex(cell))
                    : null;
                
                // Load only color data
                console.log('Loading color data for plot update:', _settings.color);
                const colorData = await loadAxisData(_settings.color, filteredCellIndices);
                console.log('Color data for update:', colorData);
                
                // Make sure we have valid values
                if (colorData && colorData.values) {
                    _data.color = colorData.values;
                    _data.colorType = colorData.type;
                    _updateColorControlsVisibility();
                    _data.colorCategories = colorData.categories;
                    console.log(`Updated _data.color to array with ${_data.color.length} elements, type: ${_data.colorType}`);
                    
                    // Restore centering state
                    _settings.centeringActive = wasCenteringActive;
                    
                    // Update min and max slider ranges based on new data before updating plot
                    if (_data.colorType === 'numerical') {
                        const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
                        const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
                        const colorMinInput = document.getElementById(`color-min-${_id}`);
                        const colorMaxInput = document.getElementById(`color-max-${_id}`);
                        
                        if (colorMinSlider && colorMaxSlider) {
                            // Filter out NaN values for min/max calculations
                            const validColorValues = _data.color.filter(val => !isNaN(val));
                            const dataMin = Math.min(...validColorValues);
                            const dataMax = Math.max(...validColorValues);
                            
                            // Set slider range - this doesn't trigger events
                            colorMinSlider.min = dataMin;
                            colorMinSlider.max = dataMax;
                            colorMaxSlider.min = dataMin;
                            colorMaxSlider.max = dataMax;
                            
                            // Set reasonable step size
                            const range = dataMax - dataMin;
                            const step = range > 100 ? 1 : range > 10 ? 0.1 : range > 1 ? 0.01 : 0.001;
                            colorMinSlider.step = step;
                            colorMaxSlider.step = step;
                            
                            // If color range is not locked, update to the new data range
                            // Otherwise, keep the existing values
                            if (!_settings.lockColorRange) {
                                // Update the actual values if not locked
                                colorMinSlider.value = dataMin;
                                colorMaxSlider.value = dataMax;
                                colorMinInput.value = dataMin.toFixed(2);
                                colorMaxInput.value = dataMax.toFixed(2);
                                _settings.colorMin = dataMin;
                                _settings.colorMax = dataMax;
                            } else {
                                console.log("Color range is locked, keeping previous min/max values");
                                // When locked, keep the existing min/max values even if outside data range
                                // We'll just expand the slider UI range to include both data and user values
                                
                                // Expand slider range if needed to include both data and user values
                                const minSliderRange = Math.min(_settings.colorMin, dataMin);
                                const maxSliderRange = Math.max(_settings.colorMax, dataMax);
                                
                                // Update slider ranges to accommodate all values
                                colorMinSlider.min = minSliderRange;
                                colorMaxSlider.min = minSliderRange;
                                colorMinSlider.max = maxSliderRange;
                                colorMaxSlider.max = maxSliderRange;
                                
                                // Keep the current values (not changing them)
                                colorMinSlider.value = _settings.colorMin;
                                colorMaxSlider.value = _settings.colorMax;
                            }
                        }
                    }
                    
                    // Use the centralized update system to handle the color update
                    _updatePlotElements({
                        colors: true,
                        colorData: true,  // New color data loaded
                        colorScale: true, // May need to update color scale
                        colorRange: true, // May need to update color range
                        layout: true
                    });
                    
                } else {
                    console.warn('No valid color data returned, falling back to full plot reload');
                    _loadDataAndCreatePlot();
                }
            } catch (error) {
                console.error('Error updating color data:', error);
                // Fall back to recreating the plot
                _loadDataAndCreatePlot();
            }
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
                                } else if (df.columns.length >= 2) {
                                  settings.column = df.columns[1];
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
                
                // Reset cached data
                _data = {
                    x: null,
                    y: null,
                    z: null,
                    color: null,
                    cells: cells
                };
            
                // Determine if we should load cell subsets
                let filteredCellIndices = null;
                if (_settings.subsettedCells && _settings.hideNonSubset) {
                    filteredCellIndices = _settings.subsettedCells.map(cell => DataManager.getCellIndex(cell));
                }
            
                // Build an array of promises for axis and color data
                const loadPromises = [
                    (async () => {
                        console.log('Loading X-axis data:', _settings.x);
                        _data.x = await loadAxisData(_settings.x, filteredCellIndices);
                    })(),
                    (async () => {
                        console.log('Loading Y-axis data:', _settings.y);
                        _data.y = await loadAxisData(_settings.y, filteredCellIndices);
                    })(),
                ];
            
                if (_settings.z) {
                    loadPromises.push(
                        (async () => {
                            console.log('Loading Z-axis data:', _settings.z);
                            _data.z = await loadAxisData(_settings.z, filteredCellIndices);
                        })()
                    );
                }
            
                // Include color loading concurrently
                loadPromises.push(
                    (async () => {
                        console.log('Loading color data:', _settings.color);
                        try {
                            const colorData = await loadAxisData(_settings.color, filteredCellIndices);
                            _data.color = colorData.values;
                            _data.colorType = colorData.type;
                            _data.colorCategories = colorData.categories;
                            _updateColorControlsVisibility();
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
                    _createPlot();
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
         * Create plot using loaded data
         * @private
         */
        function _createPlot() {
            if (!_data.x || !_data.y) {
                _plotContainer.innerHTML = '<div class="alert alert-warning">Insufficient data for plotting</div>';
                return;
            }
            
            // Check if we have cell names and they match the data
            if (!_data.cells || _data.cells.length === 0) {
                console.error('Cell names missing - cannot create plot');
                _plotContainer.innerHTML = '<div class="alert alert-danger">Error: Cell names missing or unavailable</div>';
                return;
            }
            
            // Ensure cell names match data point count
            if (_data.cells.length !== _data.x.values.length) {
                console.warn(`Cell names count (${_data.cells.length}) doesn't match data points count (${_data.x.values.length})`);
                
                // If we have more cells than data points, trim the list
                if (_data.cells.length > _data.x.values.length) {
                    _data.cells = _data.cells.slice(0, _data.x.values.length);
                }
            }
            
            // Prepare plot data
            const trace = {
                type: _settings.z ? 'scatter3d' : 'scattergl',
                mode: 'markers',
                x: _data.x.values,
                y: _data.y.values,
                text: _data.cells,
                customdata: Array.from({ length: _data.cells.length }, (_, i) => i), // Add cell indices as customdata for click handling
                hovertemplate: '%{text}<br>x: %{x}<br>y: %{y}' + (_settings.z ? '<br>z: %{z}' : '') + '<extra></extra>',
                marker: {
                    size: _settings.pointSize,
                    opacity: _settings.pointOpacity
                }
            };
            
            // Add z-axis if 3D plot
            if (_settings.z && _data.z) {
                trace.z = _data.z.values;
            }

            // Create layout
            const layout = {
                autosize: true,
                margin: { l: 40, r: 40, t: 40, b: 40 },
                hovermode: 'closest',
                xaxis: {
                    title: `${_settings.x.type}.${_settings.x.key}` +
                           (_settings.x.column ? `.${_settings.x.column}` : ''),
                    showgrid: _settings.showGrid,
                    //gridcolor: 'rgba(200, 200, 200, 0.2)',
                    showline: _settings.showGrid,
                    zeroline: _settings.showGrid,
                    ticks: _settings.showGrid ? '' : 'none',
                    showticklabels: _settings.showGrid
                },
                yaxis: {
                    title: `${_settings.y.type}.${_settings.y.key}` +
                           (_settings.y.column ? `.${_settings.y.column}` : ''),
                    showgrid: _settings.showGrid,
                    //gridcolor: 'rgba(200, 200, 200, 0.2)',
                    showline: _settings.showGrid,
                    zeroline: _settings.showGrid,
                    ticks: _settings.showGrid ? '' : 'none',
                    showticklabels: _settings.showGrid
                }
            };
            
            // Add z-axis title for 3D plots
            if (_settings.z) {
                layout.scene = {
                    xaxis: { 
                        title: layout.xaxis.title,
                        showgrid: _settings.showGrid,
                        //gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    },
                    yaxis: { 
                        title: layout.yaxis.title,
                        showgrid: _settings.showGrid,
                        //gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    },
                    zaxis: {
                        title: `${_settings.z.type}.${_settings.z.key}` +
                               (_settings.z.column ? `.${_settings.z.column}` : ''),
                        showgrid: _settings.showGrid,
                        //gridcolor: 'rgba(200, 200, 200, 0.2)',
                        showline: _settings.showGrid,
                        zeroline: _settings.showGrid,
                        ticks: _settings.showGrid ? '' : 'none',
                        showticklabels: _settings.showGrid
                    }
                };
                
                // Remove 2D axis titles for 3D plots
                delete layout.xaxis;
                delete layout.yaxis;
            }
            
            // Set colors based on color data type
            if (_data.colorType === 'categorical') {
                // Rather than using a colorscale, we'll use discrete colors with a legend
                // Remove the colorscale property that would force a colorbar
                delete trace.marker.colorscale;
                
                // Data preparation and color assignment depends on whether we have categories or unique values
                const catValues = _data.categories || [...new Set(_data.color)];
                console.log(`Found ${catValues.length} categories:`, catValues);
                
                // Set up an object to hold all distinct traces (one per category)
                const traces = [];
                const datasetPath = DataManager.getCurrentDataset();
                const colorKey = `${_settings.color.key}_colors`;
                
                // Define color palettes to select from
                const colorPalettes = {
                    default: [
                        '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                        '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
                    ],
                    G10: [
                        '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099',
                        '#0099C6', '#DD4477', '#66AA00', '#B82E2E', '#316395'
                    ],
                    Alphabet: [
                        '#AA0DFE', '#3283FE', '#85660D', '#782AB6', '#565656',
                        '#1C8356', '#16FF32', '#F7E1A0', '#E2E2E2', '#1CBE4F',
                        '#C4451C', '#DEA0FD', '#FE00FA', '#325A9B', '#FEAF16',
                        '#F8A19F', '#90AD1C', '#F6222E', '#1CFFCE', '#2ED9FF',
                        '#B10DA1', '#C075A6', '#FC1CBF', '#B00068', '#FBE426', 
                        '#FA0087'
                    ],
                    Dark2: [
                        '#1B9E77', '#D95F02', '#7570B3', '#E7298A',
                        '#66A61E', '#E6AB02', '#A6761D', '#666666'
                    ],
                    Pastel1: [
                        '#FBB4AE', '#B3CDE3', '#CCEBC5', '#DECBE4',
                        '#FED9A6', '#FFFFCC', '#E5D8BD', '#FDDAEC'
                    ],
                    Set1: [
                        '#E41A1C', '#377EB8', '#4DAF4A', '#984EA3',
                        '#FF7F00', '#FFFF33', '#A65628', '#F781BF', '#999999'
                    ],
                    Set2: [
                        '#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3',
                        '#A6D854', '#FFD92F', '#E5C494', '#B3B3B3'
                    ],
                    Paired: [
                        '#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C',
                        '#FB9A99', '#E31A1C', '#FDBF6F', '#FF7F00',
                        '#CAB2D6', '#6A3D9A', '#FFFF99', '#B15928'
                    ]
                };
                
                // Check for colors in uns
                let unsColors = null;
                
                const processCategories = (customColors = null) => {
                    // Store the custom colors from uns if they exist
                    if (customColors) {
                        unsColors = customColors;
                    }
                    
                    // Choose the color palette based on settings
                    let selectedPalette = colorPalettes.default;
                    let paletteSource = 'default';
                    
                    try {
                        if (_settings.categoryPalette === 'uns' && unsColors && unsColors.length > 0) {
                            selectedPalette = unsColors;
                            paletteSource = 'uns';
                            console.log('Using custom colors from uns:', selectedPalette);
                        } else if (_settings.categoryPalette !== 'uns' && _settings.categoryPalette !== 'default') {
                            // Check if this is a Plotly.js discrete palette
                            if (_settings.categoryPalette.startsWith('Plotly_Discrete_')) {
                                // Use Plotly's discrete color palettes
                                selectedPalette = _settings.categoryPalette.substring(16); // Remove 'Plotly_Discrete_' prefix
                                paletteSource = 'plotly-discrete';
                                console.log(`Using Plotly.js discrete colorscale: ${selectedPalette}`);
                            }
                            // Check if this is a Plotly.js sequential colorscale
                            else if (_settings.categoryPalette.startsWith('Plotly_')) {
                                // Just save the name - we'll use Plotly's built-in sequential colorscales
                                selectedPalette = _settings.categoryPalette.substring(7); // Remove 'Plotly_' prefix
                                paletteSource = 'plotly-sequential';
                                console.log(`Using Plotly.js sequential colorscale: ${selectedPalette}`);
                            } else if (colorPalettes[_settings.categoryPalette]) {
                                // Use our custom color palettes
                                selectedPalette = colorPalettes[_settings.categoryPalette];
                                paletteSource = 'custom';
                                console.log(`Using custom color palette ${_settings.categoryPalette}:`, selectedPalette);
                            } else {
                                console.warn(`Palette ${_settings.categoryPalette} not found, using default`);
                                selectedPalette = colorPalettes.default;
                                paletteSource = 'default';
                            }
                        }
                    } catch (error) {
                        console.error('Error selecting color palette:', error);
                        selectedPalette = colorPalettes.default;
                        paletteSource = 'default';
                    }
                    
                    // Create one trace per category for the legend
                    catValues.forEach((category, i) => {
                        // Find all points belonging to this category
                        const indices = [];
                        _data.color.forEach((val, idx) => {
                            if (val === category) indices.push(idx);
                        });
                        
                        if (indices.length === 0) return; // Skip if no points in this category
                        
                        // Get the color for this category
                        let categoryColor;
                        
                        if (paletteSource === 'uns' && unsColors) {
                            // If using uns colors, we need to match by category index in original category order
                            // from the dataset structure, not by the iteration order in catValues
                            // Try to find category in _data.colorCategories first
                            if (_data.colorCategories && Array.isArray(_data.colorCategories)) {
                                const catIndex = _data.colorCategories.indexOf(category);
                                if (catIndex !== -1 && catIndex < unsColors.length) {
                                    categoryColor = unsColors[catIndex];
                                } else {
                                    // Fallback to position in catValues if category not found
                                    categoryColor = unsColors[i % unsColors.length];
                                }
                            } else {
                                // Fallback to position in catValues if colorCategories not available
                                categoryColor = unsColors[i % unsColors.length];
                            }
                        } else if (paletteSource === 'plotly-discrete') {
                            // For Plotly discrete palettes, get color directly from the discrete color map
                            const discreteColors = {
                                'D3': ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
                                'G10': ['#3366CC', '#DC3912', '#FF9900', '#109618', '#990099', '#0099C6', '#DD4477', '#66AA00', '#B82E2E', '#316395'],
                                'Set1': ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
                                'Set2': ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
                                'Set3': ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
                                'Pastel1': ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec'],
                                'Pastel2': ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc'],
                                'Accent': ['#7fc97f', '#beaed4', '#fdc086', '#ffff99', '#386cb0', '#f0027f', '#bf5b17', '#666666'],
                                'Dark2': ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
                                'Paired': ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928']
                            };
                            const colors = discreteColors[selectedPalette] || discreteColors['D3'];
                            categoryColor = colors[i % colors.length];
                        } else if (paletteSource === 'plotly-sequential') {
                            // For Plotly sequential palettes, we'll set the sequential color scale in the trace options
                            categoryColor = undefined; // Will be set by Plotly
                        } else {
                            // For other custom palettes, use the index in catValues
                            categoryColor = selectedPalette[i % selectedPalette.length];
                        }
                        
                        // Create a trace for this category
                        const catTrace = {
                            type: _settings.z ? 'scatter3d' : 'scattergl',
                            mode: 'markers',
                            name: category,
                            text: indices.map(idx => _data.cells[idx]),
                            // Include cell indices in customdata for 3D plots
                            customdata: indices, // Add cell indices as customdata for click handling
                            hovertemplate: '%{text}<br>x: %{x}<br>y: %{y}' + (_settings.z ? '<br>z: %{z}' : '') + '<extra></extra>',
                            x: indices.map(idx => _data.x.values[idx]),
                            y: indices.map(idx => _data.y.values[idx]),
                            marker: paletteSource === 'plotly-sequential'
                                ? {
                                    size: _settings.pointSize,
                                    opacity: _settings.pointOpacity,
                                    // Use Plotly's built-in sequential colorscale
                                    colorscale: selectedPalette,
                                    // For sequential colorscales, each trace needs a custom color value
                                    color: i, // Use index as the color value
                                    showscale: false // Don't show color scale, we have the legend
                                } 
                                : {
                                    size: _settings.pointSize,
                                    opacity: _settings.pointOpacity,
                                    color: categoryColor
                                },
                            showlegend: true
                        };
                        
                        // Add z coordinates for 3D plots
                        if (_settings.z && _data.z) {
                            catTrace.z = indices.map(idx => _data.z.values[idx]);
                        }
                        
                        traces.push(catTrace);
                    });
                    
                    // Return an empty array if we're going to create multiple traces
                    return traces;
                };
                
                // Check for custom colors in uns if we're using them
                if (_settings.categoryPalette === 'uns') {
                    fetch(`${Config.API.UNS}/${encodeURIComponent(colorKey)}?dataset_path=${encodeURIComponent(datasetPath)}`)
                        .then(response => {
                            if (response.ok) {
                                return response.json();
                            }
                            return null;
                        })
                        .then(data => {
                            if (data && data.data) {
                                console.log(`Found custom colors in uns.${colorKey}:`, data.data);
                                const customColors = Array.isArray(data.data) ? data.data : [data.data];
                                
                                // Process with custom colors 
                                const traces = processCategories(customColors);
                                
                                // Update layout to show the legend
                                layout.showlegend = true;
                                layout.legend = { 
                                  ...layout.legend,  // preserve any existing legend settings
                                  title: { text: _settings.color.key }
                                };
                                
                                // Create the plot with multiple traces
                                _plotContainer.innerHTML = ''
                                Plotly.newPlot(_plotContainer, traces, layout, window.plotlyDefaultConfig || {
                                    responsive: true,
                                    displayModeBar: true,
                                    displaylogo: false,
                                    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
                                });
                                
                                // Set up click handler to update global focused cell
                                _plotContainer.on('plotly_click', (data) => {
                                    try {
                                        const point = data.points[0];
                                        const pointIndex = point.pointIndex;
                                        const traceIndex = point.curveNumber;
                                        let cellName;
                                        
                                        // First priority: Use customdata which contains the cell index
                                        if (point.customdata !== undefined) {
                                            const cellIndex = point.customdata;
                                            if (_data.cells && cellIndex < _data.cells.length) {
                                                cellName = _data.cells[cellIndex];
                                            }
                                            // In multi-trace categorical plot, customdata might be the index for that specific category
                                            else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
                                                cellName = traces[traceIndex].text[pointIndex];
                                            }
                                        }
                                        // Third priority: Use trace's text array
                                        else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
                                            cellName = traces[traceIndex].text[pointIndex];
                                        }
                                        
                                        if (cellName) {
                                            // Update the global focused cell in DataManager
                                            // This will trigger updates in all panels via the event system
                                            DataManager.setFocusedCell(cellName, false);
                                        }
                                    } catch (error) {
                                        console.error("Error handling cell plot click:", error);
                                    }
                                });
                                
                                // Store plot reference
                                _plot = _plotContainer;
                                
                                // Add highlighted cell if needed
                                if (_settings.highlightFocusedCell) {
                                    _highlightFocusedCell();
                                }
                            }
                        })
                        .catch(error => {
                            console.warn(`Error fetching custom colors from uns.${colorKey}:`, error);
                            
                            // Process without custom colors as fallback
                            const traces = processCategories();
                            
                            // Create the plot with multiple traces
                            _plotContainer.innerHTML = ''
                            Plotly.newPlot(_plotContainer, traces, {
                                showlegend: true,
                                legend: {
                                    title: { text: _settings.color.key }
                                }
                            }, window.plotlyDefaultConfig || {
                                responsive: true,
                                displayModeBar: true,
                                displaylogo: false,
                                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
                            });
                            
                            // Set up click handler to update global focused cell
                            _plotContainer.on('plotly_click', (data) => {
                                try {
                                    const point = data.points[0];
                                    const pointIndex = point.pointIndex;
                                    const traceIndex = point.curveNumber;
                                    let cellName;
                                    
                                    // First priority: Use customdata which contains the cell index
                                    if (point.customdata !== undefined) {
                                        const cellIndex = point.customdata;
                                        if (_data.cells && cellIndex < _data.cells.length) {
                                            cellName = _data.cells[cellIndex];
                                        }
                                        // In multi-trace categorical plot, customdata might be the index for that specific category
                                        else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
                                            cellName = traces[traceIndex].text[pointIndex];
                                        }
                                    }
                                    // Third priority: Use trace's text array
                                    else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
                                        cellName = traces[traceIndex].text[pointIndex];
                                    }
                                    
                                    if (cellName) {
                                        // Update the global focused cell in DataManager
                                        // This will trigger updates in all panels via the event system
                                        DataManager.setFocusedCell(cellName, false);
                                    }
                                } catch (error) {
                                    console.error("Error handling cell plot click:", error);
                                }
                            });
                            
                            // Store plot reference
                            _plot = _plotContainer;
                            
                            // Add highlighted cell if needed
                            if (_settings.highlightFocusedCell) {
                                _highlightFocusedCell();
                            }
                        });
                        
                    // Return empty trace here - we'll replace it with the processed traces
                    return [];
                } else {
                    // Not using uns colors or waiting for them, process immediately
                    return processCategories();
                }
            } else if (_data.colorType === 'numerical') {
                // Numerical coloring
                trace.marker.color = _data.color;
                trace.marker.colorscale = _settings.colorScale;
                trace.marker.reversescale = _settings.colorReversed;
                
                // Set color range if specified
                if (_settings.colorMin !== null || _settings.colorMax !== null) {
                    const cmin = _settings.colorMin !== null ? _settings.colorMin : Math.min(..._data.color);
                    const cmax = _settings.colorMax !== null ? _settings.colorMax : Math.max(..._data.color);
                    
                    trace.marker.cmin = cmin;
                    trace.marker.cmax = cmax;
                    
                    // Filter out points outside range if hideOutliers is true
                    if (_settings.hideOutliers) {
                        trace.x = trace.x.filter((_, i) => _data.color[i] >= cmin && _data.color[i] <= cmax);
                        trace.y = trace.y.filter((_, i) => _data.color[i] >= cmin && _data.color[i] <= cmax);
                        trace.text = trace.text.filter((_, i) => _data.color[i] >= cmin && _data.color[i] <= cmax);
                        trace.marker.color = trace.marker.color.filter((_, i) => _data.color[i] >= cmin && _data.color[i] <= cmax);
                        if (trace.z) {
                          trace.z = trace.z.filter((_, i) => _data.color[i] >= cmin && _data.color[i] <= cmax);
                        }
                      }
                }
                
                // Add colorbar with vertical title
                trace.marker.colorbar = {
                    title: {
                        text: `${_settings.color.type}.${_settings.color.key}` +
                              (_settings.color.column ? `.${_settings.color.column}` : ''),
                        side: 'right',  // Place title on right side
                        font: {
                            size: 12
                        }
                    },
                    titleside: 'right'  // Right side vertical text
                };
            } else if (_data.colorType === 'constant') {
                // Use a constant color (default to light grey)
                trace.marker.color = 'rgba(150, 150, 150, 0.7)';
                delete trace.marker.colorscale;
                
                console.log('Using constant color for all points');
            }
            
            
            // Apply subset coloring if needed but not hiding
            if (_settings.subsettedCells && !_settings.hideNonSubset) {
                // Create a new array with all cells
                const allCells = DataManager.getCells();
                const allX = [];
                const allY = [];
                const allZ = _settings.z ? [] : null;
                const allText = [];
                
                // Create subset index lookup for efficient checking
                const subsetLookup = new Set(_settings.subsettedCells);
                const colors = [];
                
                // Load full data for all cells
                // ... (would need to load all axis data here)
                
                // Create two traces - one for subset and one for rest
                // ... (would implement this in a real application)
            }
            
            // The traces array will either contain a single trace (for numerical data)
            // or multiple traces (for categorical data with legend)
            const traces = Array.isArray(trace) ? trace : [trace];
            
            // For categorical data with multiple traces, ensure legend is enabled
            if (traces.length > 1) {
                layout.showlegend = true;
                layout.legend = { 
                    ...layout.legend,  // preserve any existing legend settings
                    title: { text: _settings.color.key } 
                };
            }
            
            // Create the plot
            _plotContainer.innerHTML = ''
            Plotly.newPlot(_plotContainer, traces, layout, window.plotlyDefaultConfig || {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                showlegend: true,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
            });
            
            // Set up click handler to update global focused cell
            _plotContainer.on('plotly_click', (data) => {
                if (!data || !data.points || data.points.length === 0) {
                    return;
                }
                
                const point = data.points[0];
                const pointIndex = point.pointIndex;
                const traceIndex = point.curveNumber;
                let cellName;
                
                // Check if this is a 3D plot
                const is3D = traces[0].type === 'scatter3d';
                
                try {
                    // For both 2D and 3D plots, use customdata for consistent cell identification
                    // First priority: Use customdata which contains the cell index
                    if (point.customdata !== undefined) {
                        // When Hide Outliers is active, customdata is already filtered to contain the correct indices
                        // Otherwise it contains the original index into _data.cells
                        
                        if (typeof point.customdata === 'number') {
                            // Simple numeric index case (typical for non-filtered data)
                            const cellIndex = point.customdata;
                            // For main trace with global indices
                            if (_data.cells && cellIndex < _data.cells.length) {
                                cellName = _data.cells[cellIndex];
                            }
                            // In multi-trace categorical plot, customdata might be the index for that specific category
                            else if (traces[traceIndex] && traces[traceIndex].text && pointIndex < traces[traceIndex].text.length) {
                                cellName = traces[traceIndex].text[pointIndex];
                            }
                        } else if (point.customdata && point.text) {
                            // Might have direct access to cell name in text when outliers are filtered
                            cellName = point.text;
                        }
                    }
                    // Third priority: Use trace's text array in multi-trace categorical plot
                    else if (traces.length > 1 && traces[traceIndex] && traces[traceIndex].text && 
                             pointIndex < traces[traceIndex].text.length) {
                        cellName = traces[traceIndex].text[pointIndex];
                    }
                    // Fourth priority: Use point index with global cell array
                    else if (pointIndex !== undefined && _data.cells && pointIndex < _data.cells.length) {
                        cellName = _data.cells[pointIndex];
                    }
                    // Final fallback: For 3D plots, try to find by coordinates
                    else if (is3D && _data.x && _data.y && _data.x.values && _data.y.values && _data.cells) {
                        // Find the closest cell by coordinates
                        let minDistance = Infinity;
                        let closestIndex = -1;
                        
                        for (let i = 0; i < _data.x.values.length; i++) {
                            const dx = _data.x.values[i] - point.x;
                            const dy = _data.y.values[i] - point.y;
                            let dz = 0;
                            if (is3D && _data.z && _data.z.values) {
                                dz = _data.z.values[i] - point.z;
                            }
                            
                            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestIndex = i;
                            }
                        }
                        
                        if (closestIndex !== -1) {
                            cellName = _data.cells[closestIndex];
                        }
                    }
                    
                    // Debug logging to help diagnose issues with filtered data
                    if (_settings.hideOutliers) {
                        console.log("Click in filtered plot:", { 
                            cellName, 
                            pointIndex, 
                            traceIndex,
                            pointData: point
                        });
                    }
                } catch (error) {
                    console.error("Error identifying cell in plot click:", error);
                }
                
                if (cellName) {
                    // Update the global focused cell in DataManager
                    // This will trigger updates in all panels via the event system
                    DataManager.setFocusedCell(cellName, false);
                }
            });
            
            // Store plot reference
            _plot = _plotContainer;
            
            // Add highlighted cell if needed
            if (_settings.highlightFocusedCell) {
                _highlightFocusedCell();
            }
            
            // Update the visibility of color controls
            _updateColorControlsVisibility();
            
            // Get references to controls that need additional setup
            const categoryPaletteSelect = document.getElementById(`category-palette-${_id}`);
            const colorMinInput = document.getElementById(`color-min-${_id}`);
            const colorMaxInput = document.getElementById(`color-max-${_id}`);
            const colorMinSlider = document.getElementById(`color-min-slider-${_id}`);
            const colorMaxSlider = document.getElementById(`color-max-slider-${_id}`);
            
            if (_data.colorType === 'numerical') {
                // Filter out NaN values for min/max calculations
                const validColorValues = _data.color.filter(val => !isNaN(val));
                const dataMin = Math.min(...validColorValues);
                const dataMax = Math.max(...validColorValues);
                
                // Set up sliders
                colorMinSlider.min = dataMin;
                colorMinSlider.max = dataMax;
                colorMaxSlider.min = dataMin;
                colorMaxSlider.max = dataMax;
                
                // Set slider step to a reasonable value based on data range
                const range = dataMax - dataMin;
                const step = range > 100 ? 1 : range > 10 ? 0.1 : range > 1 ? 0.01 : 0.001;
                colorMinSlider.step = step;
                colorMaxSlider.step = step;
                
                // Set min/max input defaults if not already set
                if (colorMinInput.value === '') {
                    colorMinInput.placeholder = dataMin.toFixed(2);
                    colorMinSlider.value = dataMin;
                } else {
                    colorMinSlider.value = _settings.colorMin !== null ? _settings.colorMin : dataMin;
                }
                
                if (colorMaxInput.value === '') {
                    colorMaxInput.placeholder = dataMax.toFixed(2);
                    colorMaxSlider.value = dataMax;
                } else {
                    colorMaxSlider.value = _settings.colorMax !== null ? _settings.colorMax : dataMax;
                }
            } else if (_data.colorType === 'categorical') {
                // Ensure the correct palette is selected
                categoryPaletteSelect.value = _settings.categoryPalette;
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
            updatePlotElements(_plotContainer, _plot, _data, _settings, _loadDataAndCreatePlot, options);
        }

        /**
         * Update plot with current settings without recreating it
         * @param {boolean} fullDataUpdate - Whether to update all data or just visual properties 
         * @private
         */
        function _updatePlot(fullDataUpdate = false) {
            console.log(`Updating plot (fullDataUpdate=${fullDataUpdate})`);
            
            if (fullDataUpdate) {
                // For full data updates, update colors and data
                _updatePlotElements({
                    colors: true,
                    colorData: true,  // Include the full color data array
                    colorScale: true, // Update the color scale
                    colorRange: true, // Update the color range
                    styling: true,
                    layout: true
                });
            } else {
                // For visual-only updates
                _updatePlotElements({
                    styling: true,
                    colors: _settings.colorMin !== null || _settings.colorMax !== null,
                    colorRange: _settings.colorMin !== null || _settings.colorMax !== null,
                    colorData: false // Don't update the actual color data array
                });
            }
        }
        
        /**
         * Handle data updates from other components
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         */
        async function onDataUpdate(updateType, data) {
            switch (updateType) {
                case 'cellSubset':
                    // Update subset settings
                    _settings.subsettedCells = data.cells;
                    _settings.hideNonSubset = data.hideOthers || false;
                    _loadDataAndCreatePlot();
                    break;
                    
                case 'datasetChanged':
                    // Reset and reload
                    _loadDataAndCreatePlot();
                    break;
            }
        }
        
        /**
         * Clean up resources
         */
        function cleanup() {
            // Remove event listeners
            if (_plot) {
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
            highlightFocusedCell(_plotContainer, _plot, _data, _settings);
        }
        
        
        /**
         * Remove highlight from the plot
         * @private
         */
        function _removeHighlight() {
            removeHighlight(_plotContainer, _plot);
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
            onDataUpdate,
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