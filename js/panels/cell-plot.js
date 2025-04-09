import { createPanelStructure, initializeUIState } from './plot-utilities/panel-ui-make.js';
import { setupAxisSelector, updateColorControlsVisibility } from './plot-utilities/panel-ui-update.js';
import { loadAxisData, createPlot } from './plot-utilities/plot-make.js';
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
                plot: _plotContainer,
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
                if (_data.colorType === 'numerical' && _plotContainer) {
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
                if (_plotContainer && _data.colorType === 'categorical') {
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
                if (!_plotContainer || !_plotContainer.data || !_plotContainer.data[0] || !_plotContainer.data[0].marker) return;
                
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
                if (!_fullPlotData && _plotContainer && _plotContainer.data) {
                    try {
                        console.log("Creating backup of plot data for filtering");
                        _fullPlotData = JSON.parse(JSON.stringify(_plotContainer.data));
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
                    if (_plotContainer && _plotContainer.data && _plotContainer.data[0] && _plotContainer.data[0].marker) {
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
                if (
                    _plotContainer &&
                    _plotContainer.data &&
                    _plotContainer.data[0] &&
                    _plotContainer.data[0].marker
                ) {
                    Plotly.restyle(
                        _plotContainer,
                        {
                            'marker.cmin': minValue,
                            'marker.cmax': maxValue
                        },
                        [0]
                    );
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
                if (_plotContainer && _plotContainer.data && _plotContainer.data[0] && _plotContainer.data[0].marker) {
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
                if (_plotContainer && _data.color && _data.colorType === 'numerical') {
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
                if (_plotContainer) {
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
        

        
        async function _loadColorDataAndUpdatePlot() {
            try {
                // Track if centering was active before updating
                const wasCenteringActive = _settings.centeringActive;
                
                const filteredCellIndices = _settings.subsettedCells && _settings.hideNonSubset
                    ? _settings.subsettedCells.map(cell => DataManager.getCellIndex(cell))
                    : null;
                
                // Load only color data
                const colorData = await loadAxisData(_settings.color, filteredCellIndices);
                
                // Make sure we have valid values
                if (colorData && colorData.values) {
                    _data.color = colorData.values;
                    _data.colorType = colorData.type;
                    updateColorControlsVisibility(_container, _data.colorType, _id);
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
        
        
        /**
         * Remove highlight from the plot
         * @private
         */
        function _removeHighlight() {
            removeHighlight(_plotContainer);
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