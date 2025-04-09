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
    const colorKey = `${_settings.color.key}_colors`;
    
    // Check for colors in uns
    let unsColors = null;

    /* paletteSource === 'uns' -> we can try getting it with 
    DataManager.loadUns({
            datasetPath: _settings.datasetPath,
            key: colorKey,
        })

    otherwise, we can get the colors from
    generateDiscreteColors(catValues.length, paletteSource)

    Both should give us a list of colors, one for each category by
    which we split the trace. It is imortant to setup the on-click
    listener.
    */
    
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
        DataManager.loadUns({
            datasetPath: _settings.datasetPath,
            key: colorKey,
        }).then(response => {
                if (response.ok) {
                    return response.json();
                }
                return null;
            })
            .then(data => {
                if (!data || !data.data) {
                    console.warn(`No custom colors found in uns.${colorKey}`);
                    return;
                }
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
        // Use point index with global cell array
        else if (pointIndex !== undefined && _data.cells && pointIndex < _data.cells.length) {
            cellName = _data.cells[pointIndex];
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