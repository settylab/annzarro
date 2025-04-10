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
    _settings.categoryPalette = e.currentTarget.value; 
    
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