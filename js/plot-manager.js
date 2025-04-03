/**
 * PlotManager - Creates and manages plots for visualization
 * This class is responsible for:
 * 1. Creating various plot types (scatter, violin, heatmap, etc.)
 * 2. Updating plots based on data and settings
 * 3. Handling plot interactions (selection, hover, etc.)
 */

/**
 * Helper function to access the Utils dependency safely.
 * This avoids variable declarations that might conflict.
 */
function getUtils() {
    // Node environment
    if (typeof require !== 'undefined') {
        return require('./utils');
    }
    // Annzarro modules
    if (typeof Annzarro !== 'undefined' && Annzarro.modules && Annzarro.modules.Utils) {
        return Annzarro.modules.Utils;
    }
    // Global fallback
    if (typeof window !== 'undefined' && window.Utils) {
        return window.Utils;
    }
    
    console.error('Utils dependency not found');
    return null;
}

class PlotManager {
    constructor() {
        // Plot type registry
        this.plotTypes = {
            'scatter': this.createScatterPlot.bind(this),
            'violin': this.createViolinPlot.bind(this),
            'heatmap': this.createHeatmapPlot.bind(this),
            'bar': this.createBarPlot.bind(this)
        };
        
        // Plot instances (panelId -> plot object)
        this.plots = new Map();
        
        // Default plot settings
        this.defaultSettings = {
            scatter: {
                markerSize: 5,
                markerOpacity: 0.7,
                colorRange: ['blue', 'red'],
                showFocusedGene: true,
                showFocusedCell: true
            },
            violin: {
                showPoints: true,
                pointsOpacity: 0.3,
                colorRange: ['blue', 'red'],
                boxWidth: 0.5
            },
            heatmap: {
                colorRange: ['blue', 'white', 'red'],
                zMin: null,
                zMax: null,
                showDendrogram: true
            },
            bar: {
                orientation: 'vertical',
                colorRange: ['blue', 'red'],
                barWidth: 0.8,
                showError: true
            }
        };
    }
    
    /**
     * Update all plots based on selection or filter changes
     * @param {Object} filterChange - Information about what changed
     */
    updateAllPlots(filterChange) {
        // Update each plot with the new filter or selection
        for (const [panelId, plotInfo] of this.plots.entries()) {
            // Apply filter to plot data
            let filteredData = { ...plotInfo.data };
            
            // Apply selection filters if provided
            if (filterChange.selectionChanged) {
                if (filterChange.type === 'cells' && plotInfo.data.cellIndices) {
                    // Filter data to show only selected cells
                    const selectedIndices = filterChange.selected.map(cellName => {
                        return plotInfo.data.cellIndices[cellName];
                    }).filter(index => index !== undefined);
                    
                    // Apply filter to data arrays
                    this._filterDataIndices(filteredData, selectedIndices);
                } else if (filterChange.type === 'genes' && plotInfo.data.geneIndices) {
                    // Filter data to show only selected genes
                    const selectedIndices = filterChange.selected.map(geneName => {
                        return plotInfo.data.geneIndices[geneName];
                    }).filter(index => index !== undefined);
                    
                    // Apply filter to data arrays
                    this._filterDataIndices(filteredData, selectedIndices);
                }
            }
            
            // Apply value filtering if provided
            if (filterChange.valueFilter) {
                const { field, min, max } = filterChange.valueFilter;
                
                if (filteredData[field]) {
                    // Find indices that match the filter criteria
                    const validIndices = [];
                    for (let i = 0; i < filteredData[field].length; i++) {
                        const value = filteredData[field][i];
                        if (value >= min && value <= max) {
                            validIndices.push(i);
                        }
                    }
                    
                    // Apply filter to data arrays
                    this._filterDataIndices(filteredData, validIndices);
                }
            }
            
            // Handle focused items
            if (filterChange.focusChanged) {
                if (filterChange.type === 'cell') {
                    filteredData.focusedCellIndex = filterChange.index;
                    filteredData.focusedCellName = filterChange.name;
                } else if (filterChange.type === 'gene') {
                    filteredData.focusedGeneIndex = filterChange.index;
                    filteredData.focusedGeneName = filterChange.name;
                }
            }
            
            // Update the plot with filtered data
            this.updatePlot(panelId, filteredData);
        }
    }
    
    /**
     * Helper method to filter data arrays by indices
     * @param {Object} data - Data object with arrays
     * @param {Array<number>} indices - Indices to keep
     * @private
     */
    _filterDataIndices(data, indices) {
        // Filter each array in the data object
        for (const key in data) {
            if (Array.isArray(data[key])) {
                data[key] = indices.map(i => data[key][i]);
            }
        }
    }
    
    /**
     * Highlight focused items in a plot
     * @param {string} plotId - ID of the plot
     */
    highlightFocusedItems(plotId) {
        const plotInfo = this.plots.get(plotId);
        if (!plotInfo) return;
        
        // Get the current data
        const plotData = plotInfo.data;
        
        // Check if there's a focused gene or cell
        if (plotData.focusedGeneIndex !== undefined || plotData.focusedCellIndex !== undefined) {
            // Update the plot to highlight the focused item
            this.updatePlot(plotId, plotData);
        }
    }

    /**
     * Create a new plot
     * @param {string} panelId - ID of the panel to create the plot in
     * @param {string} plotType - Type of plot to create
     * @param {Object} plotData - Data for the plot
     * @param {Object} plotSettings - Settings for the plot
     * @returns {Object} The created plot object
     */
    createPlot(panelId, plotType, plotData, plotSettings = {}) {
        const Utils = getUtils();
        if (!Utils) {
            console.error('Utils module not found');
            return null;
        }

        // Get the panel element
        const panelElement = document.getElementById(panelId);
        if (!panelElement) {
            console.error(`Panel element with ID ${panelId} not found`);
            return null;
        }
        
        // Check if plot type is supported
        if (!this.plotTypes[plotType]) {
            console.error(`Plot type '${plotType}' is not supported`);
            return null;
        }
        
        // Clear any existing plot
        this.destroyPlot(panelId);
        
        // Create the plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'plot-container';
        plotContainer.style.width = '100%';
        plotContainer.style.height = '100%';
        panelElement.appendChild(plotContainer);
        
        // Merge default settings with provided settings
        const settings = Utils.deepMerge(
            this.defaultSettings[plotType] || {},
            plotSettings
        );
        
        // Create the plot
        const plot = this.plotTypes[plotType](plotContainer, plotData, settings);
        
        // Store the plot
        this.plots.set(panelId, {
            type: plotType,
            plot,
            container: plotContainer,
            data: plotData,
            settings
        });
        
        return plot;
    }

    /**
     * Update an existing plot
     * @param {string} panelId - ID of the panel with the plot
     * @param {Object} newData - New data for the plot
     * @param {Object} newSettings - New settings for the plot
     * @returns {Object} The updated plot object
     */
    updatePlot(panelId, newData = null, newSettings = null) {
        const Utils = getUtils();
        if (!Utils) {
            console.error('Utils module not found');
            return null;
        }

        // Get the plot
        const plotInfo = this.plots.get(panelId);
        if (!plotInfo) {
            console.error(`No plot found in panel ${panelId}`);
            return null;
        }
        
        // Update data if provided
        if (newData) {
            plotInfo.data = newData;
        }
        
        // Update settings if provided
        if (newSettings) {
            plotInfo.settings = Utils.deepMerge(plotInfo.settings, newSettings);
        }
        
        // Recreate the plot with updated data and settings
        const updatedPlot = this.plotTypes[plotInfo.type](
            plotInfo.container,
            plotInfo.data,
            plotInfo.settings
        );
        
        // Update plot in the registry
        plotInfo.plot = updatedPlot;
        this.plots.set(panelId, plotInfo);
        
        return updatedPlot;
    }

    /**
     * Destroy a plot
     * @param {string} panelId - ID of the panel with the plot to destroy
     */
    destroyPlot(panelId) {
        // Get the plot
        const plotInfo = this.plots.get(panelId);
        if (!plotInfo) return;
        
        // Clear the plot container
        if (plotInfo.container) {
            Plotly.purge(plotInfo.container);
            plotInfo.container.remove();
        }
        
        // Remove from registry
        this.plots.delete(panelId);
    }

    /**
     * Create a scatter plot
     * @param {HTMLElement} container - Container element for the plot
     * @param {Object} data - Data for the plot
     * @param {Object} settings - Settings for the plot
     * @returns {Object} The created plot object
     */
    createScatterPlot(container, data, settings) {
        // Check if this is a large dataset
        if (data.x && data.x.length > 10000 && window.ANNZARRO_API_URL) {
            // Use downsampled visualization for large datasets
            return this._createLargeScatterPlot(container, data, settings);
        }
        
        // Extract data for the plot
        const {
            x, y, z,
            color,
            text,
            xLabel, yLabel, zLabel,
            colorLabel,
            title
        } = data;
        
        // Create the base trace
        const trace = {
            type: 'scattergl', // Use WebGL renderer for better performance
            mode: 'markers',
            x,
            y,
            text,
            hoverinfo: text ? 'text' : 'x+y',
            marker: {
                size: settings.markerSize || 5,
                opacity: settings.markerOpacity || 0.7
            }
        };
        
        // Add z dimension for 3D plot if provided
        if (z) {
            trace.type = 'scatter3d';
            trace.z = z;
        }
        
        // Add color if provided
        if (color) {
            // Check if the color values are categorical
            const uniqueValues = [...new Set(color)];
            const isCategorical = uniqueValues.some(val => typeof val === 'string' && isNaN(val)) || 
                                 uniqueValues.length <= 10;
            
            if (isCategorical) {
                // Categorical coloring
                trace.marker.color = color;
                trace.marker.colorscale = settings.colorRange || ['blue', 'red'];
            } else {
                // Numerical coloring
                trace.marker.color = color;
                trace.marker.colorscale = settings.colorRange || 'Viridis';
                
                // Set color range if specified
                if (settings.colorMin !== undefined && settings.colorMax !== undefined) {
                    trace.marker.cmin = settings.colorMin;
                    trace.marker.cmax = settings.colorMax;
                }
                
                // Add colorbar
                trace.marker.colorbar = { title: colorLabel || 'Value' };
                
                // Handle out of range values
                if (settings.outOfRangeAction === 'hide') {
                    // Filter points outside the color range
                    const validIndices = [];
                    for (let i = 0; i < color.length; i++) {
                        if (color[i] >= settings.colorMin && color[i] <= settings.colorMax) {
                            validIndices.push(i);
                        }
                    }
                    
                    // Only show valid points
                    trace.x = validIndices.map(i => x[i]);
                    trace.y = validIndices.map(i => y[i]);
                    if (z) trace.z = validIndices.map(i => z[i]);
                    trace.marker.color = validIndices.map(i => color[i]);
                    if (text) trace.text = validIndices.map(i => text[i]);
                }
            }
        }
        
        // Highlight focused items if enabled
        if (settings.showFocusedGene && data.focusedGeneIndex !== undefined) {
            // Create a trace for the focused gene
            const focusedTrace = {
                type: trace.type,
                mode: 'markers',
                x: [x[data.focusedGeneIndex]],
                y: [y[data.focusedGeneIndex]],
                marker: {
                    size: (settings.markerSize || 5) * 1.5,
                    color: 'red',
                    line: {
                        color: 'black',
                        width: 2
                    }
                },
                hoverinfo: 'text',
                text: [`Focused Gene: ${data.focusedGeneName}`],
                showlegend: true,
                name: 'Focused Gene'
            };
            
            if (z) {
                focusedTrace.z = [z[data.focusedGeneIndex]];
            }
            
            // Add the focused trace
            return Plotly.newPlot(container, [trace, focusedTrace], this._createLayout(xLabel, yLabel, zLabel, title));
        } else if (settings.showFocusedCell && data.focusedCellIndex !== undefined) {
            // Create a trace for the focused cell
            const focusedTrace = {
                type: trace.type,
                mode: 'markers',
                x: [x[data.focusedCellIndex]],
                y: [y[data.focusedCellIndex]],
                marker: {
                    size: (settings.markerSize || 5) * 1.5,
                    color: 'red',
                    line: {
                        color: 'black',
                        width: 2
                    }
                },
                hoverinfo: 'text',
                text: [`Focused Cell: ${data.focusedCellName}`],
                showlegend: true,
                name: 'Focused Cell'
            };
            
            if (z) {
                focusedTrace.z = [z[data.focusedCellIndex]];
            }
            
            // Add the focused trace
            return Plotly.newPlot(container, [trace, focusedTrace], this._createLayout(xLabel, yLabel, zLabel, title));
        } else {
            // Basic plot without focusing
            return Plotly.newPlot(container, [trace], this._createLayout(xLabel, yLabel, zLabel, title));
        }
    }
    
    /**
     * Create a scatter plot for large datasets using backend downsampling
     * @param {HTMLElement} container - Container element for the plot
     * @param {Object} data - The plot data
     * @param {Object} settings - Plot settings
     * @returns {Promise<Object>} The created plot
     * @private
     */
    async _createLargeScatterPlot(container, data, settings) {
        // Show loading indicator
        this._showLoadingIndicator(container, 'Loading optimized visualization...');
        
        try {
            // Construct embedding name (usually X_umap, X_pca, etc.)
            const embeddingKey = settings.embedding || 
                                (data.xLabel && data.yLabel ? 
                                 `X_${data.xLabel.toLowerCase().replace(/[0-9]/g, '')}` : 
                                 'X_umap');
            
            // Determine color column if available
            const colorBy = settings.colorBy || null;
            
            // Call the backend API to get downsampled data
            const params = new URLSearchParams({
                n_samples: settings.maxPoints || 5000,
                method: settings.downsampleMethod || 'kmeans',
                include_embeddings: 'true',
                include_obs: 'true'
            });
            
            // Make the API request
            const response = await fetch(`${window.ANNZARRO_API_URL}/data/downsampled?${params}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch downsampled data: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Check if we got the embedding data we need
            if (!result.embeddings || !result.embeddings[embeddingKey]) {
                throw new Error(`Embedding data ${embeddingKey} not available`);
            }
            
            // Create plot data from the API result
            const plotData = {
                x: result.embeddings[embeddingKey].map(coord => coord[0]),
                y: result.embeddings[embeddingKey].map(coord => coord[1]),
                xLabel: data.xLabel || embeddingKey.replace('X_', '') + ' 1',
                yLabel: data.yLabel || embeddingKey.replace('X_', '') + ' 2',
                title: (data.title || 'Cell Visualization') + 
                       ` (${result.n_cells.toLocaleString()} cells, downsampled)`,
                cellIndices: result.cell_indices  // Keep track of original indices
            };
            
            // Add cell names if available
            if (result.cell_names) {
                plotData.text = result.cell_names.map((name, i) => {
                    const x = plotData.x[i];
                    const y = plotData.y[i];
                    
                    // Format hover text
                    let text = `Cell: ${name}`;
                    text += `<br>${plotData.xLabel}: ${this._formatNumber(x)}`;
                    text += `<br>${plotData.yLabel}: ${this._formatNumber(y)}`;
                    
                    return text;
                });
            }
            
            // Add color information if available
            if (colorBy && result.obs && result.obs[colorBy]) {
                plotData.color = result.obs[colorBy];
                plotData.colorLabel = colorBy;
            }
            
            // Hide loading indicator
            this._hideLoadingIndicator(container);
            
            // Create the plot using standard method
            return this.createScatterPlot(container, plotData, {
                ...settings,
                title: plotData.title
            });
        } catch (error) {
            console.error('Error creating downsampled plot:', error);
            
            // Remove loading indicator
            this._hideLoadingIndicator(container);
            
            // Show error message
            this._showErrorMessage(container, `Failed to create optimized plot: ${error.message}`);
            
            // Fall back to regular plot if possible
            if (data.x && data.y) {
                return this.createScatterPlot(container, {
                    ...data,
                    title: (data.title || '') + ' (unoptimized)'
                }, settings);
            }
            
            return null;
        }
    }
    
    /**
     * Format a number nicely for display
     * @param {number} value - The number to format
     * @returns {string} Formatted number
     * @private
     */
    _formatNumber(value) {
        if (typeof value !== 'number') return value;
        
        // Check if it's an integer
        if (Number.isInteger(value)) return value.toString();
        
        // Format with appropriate precision
        if (Math.abs(value) < 0.001) return value.toExponential(2);
        if (Math.abs(value) < 1) return value.toFixed(3);
        if (Math.abs(value) < 10) return value.toFixed(2);
        if (Math.abs(value) < 100) return value.toFixed(1);
        return value.toFixed(0);
    }
    
    /**
     * Show a loading indicator in the container
     * @param {HTMLElement} container - The container element
     * @param {string} message - Loading message
     * @private
     */
    _showLoadingIndicator(container, message = 'Loading...') {
        // Remove any existing indicators
        this._hideLoadingIndicator(container);
        
        // Create loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'plot-loading-indicator';
        loadingDiv.style.position = 'absolute';
        loadingDiv.style.top = '50%';
        loadingDiv.style.left = '50%';
        loadingDiv.style.transform = 'translate(-50%, -50%)';
        loadingDiv.style.textAlign = 'center';
        loadingDiv.style.padding = '20px';
        loadingDiv.style.background = 'rgba(255,255,255,0.9)';
        loadingDiv.style.borderRadius = '5px';
        loadingDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        loadingDiv.style.zIndex = '1000';
        
        // Add spinner and message
        loadingDiv.innerHTML = `
            <div style="display: inline-block; width: 2rem; height: 2rem; border: 0.25rem solid rgba(0,123,255,0.25); 
                        border-right-color: #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <div style="margin-top: 10px; color: #333;">${message}</div>
        `;
        
        // Add animation style if needed
        if (!document.getElementById('plot-loading-style')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'plot-loading-style';
            styleEl.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(styleEl);
        }
        
        // Ensure container has position relative for proper positioning
        const containerStyle = window.getComputedStyle(container);
        if (containerStyle.position === 'static') {
            container.style.position = 'relative';
        }
        
        // Add to container
        container.appendChild(loadingDiv);
    }
    
    /**
     * Hide the loading indicator
     * @param {HTMLElement} container - The container element
     * @private
     */
    _hideLoadingIndicator(container) {
        const indicator = container.querySelector('.plot-loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    /**
     * Show an error message in the container
     * @param {HTMLElement} container - The container element
     * @param {string} message - Error message
     * @private
     */
    _showErrorMessage(container, message) {
        // Remove any existing error messages
        const existingError = container.querySelector('.plot-error-message');
        if (existingError) existingError.remove();
        
        // Create error message element
        const errorDiv = document.createElement('div');
        errorDiv.className = 'plot-error-message';
        errorDiv.style.position = 'absolute';
        errorDiv.style.top = '50%';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translate(-50%, -50%)';
        errorDiv.style.textAlign = 'center';
        errorDiv.style.padding = '20px';
        errorDiv.style.background = 'rgba(255,220,220,0.9)';
        errorDiv.style.color = '#721c24';
        errorDiv.style.borderRadius = '5px';
        errorDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
        errorDiv.style.maxWidth = '80%';
        
        // Add error icon and message
        errorDiv.innerHTML = `
            <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
            <div>${message}</div>
        `;
        
        // Ensure container has position relative for proper positioning
        const containerStyle = window.getComputedStyle(container);
        if (containerStyle.position === 'static') {
            container.style.position = 'relative';
        }
        
        // Add to container
        container.appendChild(errorDiv);
    }

    /**
     * Create a violin plot
     * @param {HTMLElement} container - Container element for the plot
     * @param {Object} data - Data for the plot
     * @param {Object} settings - Settings for the plot
     * @returns {Object} The created plot object
     */
    createViolinPlot(container, data, settings) {
        // Extract data for the plot
        const {
            groups,
            values,
            text,
            xLabel, yLabel,
            title
        } = data;
        
        // Create traces for each group
        const traces = [];
        
        // Get unique groups
        const uniqueGroups = [...new Set(groups)];
        
        // Create violin for each group
        for (const group of uniqueGroups) {
            // Get indices for this group
            const indices = [];
            for (let i = 0; i < groups.length; i++) {
                if (groups[i] === group) {
                    indices.push(i);
                }
            }
            
            // Get values for this group
            const groupValues = indices.map(i => values[i]);
            const groupText = text ? indices.map(i => text[i]) : null;
            
            // Create violin trace
            const violinTrace = {
                type: 'violin',
                x: Array(groupValues.length).fill(group),
                y: groupValues,
                name: group,
                box: {
                    visible: true,
                    width: settings.boxWidth || 0.5
                },
                meanline: {
                    visible: true
                },
                points: settings.showPoints ? 'all' : false,
                pointpos: 0,
                jitter: 0.3,
                marker: {
                    opacity: settings.pointsOpacity || 0.3
                }
            };
            
            // Add hover text if provided
            if (groupText) {
                violinTrace.text = groupText;
                violinTrace.hoverinfo = 'text';
            }
            
            traces.push(violinTrace);
        }
        
        // Create the layout
        const layout = this._createLayout(xLabel, yLabel, null, title);
        layout.violinmode = 'group';
        
        // Create the plot
        return Plotly.newPlot(container, traces, layout);
    }

    /**
     * Create a heatmap plot
     * @param {HTMLElement} container - Container element for the plot
     * @param {Object} data - Data for the plot
     * @param {Object} settings - Settings for the plot
     * @returns {Object} The created plot object
     */
    createHeatmapPlot(container, data, settings) {
        // Extract data for the plot
        const {
            z,
            x, y,
            text,
            xLabel, yLabel,
            title
        } = data;
        
        // Create the trace
        const trace = {
            type: 'heatmap',
            z,
            x,
            y,
            colorscale: settings.colorRange || 'RdBu',
            hoverinfo: text ? 'text' : 'x+y+z'
        };
        
        // Add hover text if provided
        if (text) {
            trace.text = text;
        }
        
        // Set color range if specified
        if (settings.zMin !== undefined) trace.zmin = settings.zMin;
        if (settings.zMax !== undefined) trace.zmax = settings.zMax;
        
        // Create the layout
        const layout = this._createLayout(xLabel, yLabel, null, title);
        
        // Enable zoom if there are many cells
        if (z && z.length > 20) {
            layout.xaxis.autorange = true;
            layout.yaxis.autorange = true;
            layout.xaxis.showgrid = false;
            layout.yaxis.showgrid = false;
        }
        
        // Create the plot
        return Plotly.newPlot(container, [trace], layout);
    }

    /**
     * Create a bar plot
     * @param {HTMLElement} container - Container element for the plot
     * @param {Object} data - Data for the plot
     * @param {Object} settings - Settings for the plot
     * @returns {Object} The created plot object
     */
    createBarPlot(container, data, settings) {
        const Utils = getUtils();
        if (!Utils) {
            console.error('Utils module not found');
            return null;
        }

        // Extract data for the plot
        const {
            x, y,
            error,
            color,
            text,
            xLabel, yLabel,
            title
        } = data;
        
        // Determine orientation
        const isVertical = settings.orientation !== 'horizontal';
        
        // Create the trace
        const trace = {
            type: 'bar',
            orientation: isVertical ? 'v' : 'h',
            [isVertical ? 'x' : 'y']: x,
            [isVertical ? 'y' : 'x']: y,
            text,
            hoverinfo: text ? 'text' : 'x+y',
            marker: {
                width: settings.barWidth || 0.8
            }
        };
        
        // Add color if provided
        if (color) {
            // Check if the color values are categorical
            const uniqueValues = [...new Set(color)];
            const isCategorical = uniqueValues.some(val => typeof val === 'string' && isNaN(val)) || 
                                 uniqueValues.length <= 10;
            
            if (isCategorical) {
                // Categorical coloring - use a list of colors
                const colorMap = {};
                uniqueValues.forEach((val, i) => {
                    colorMap[val] = Utils.getColorFromPalette(i);
                });
                trace.marker.color = color.map(val => colorMap[val]);
            } else {
                // Numerical coloring
                trace.marker.color = color;
                trace.marker.colorscale = settings.colorRange || 'Viridis';
                
                // Set color range if specified
                if (settings.colorMin !== undefined && settings.colorMax !== undefined) {
                    trace.marker.cmin = settings.colorMin;
                    trace.marker.cmax = settings.colorMax;
                }
                
                // Add colorbar
                trace.marker.colorbar = { title: 'Value' };
            }
        }
        
        // Add error bars if provided and enabled
        if (error && settings.showError) {
            trace.error_[isVertical ? 'y' : 'x'] = {
                type: 'data',
                array: error,
                visible: true
            };
        }
        
        // Create the layout
        const layout = this._createLayout(
            isVertical ? xLabel : yLabel,
            isVertical ? yLabel : xLabel,
            null,
            title
        );
        
        // Create the plot
        return Plotly.newPlot(container, [trace], layout);
    }

    /**
     * Create a layout object for Plotly
     * @param {string} xLabel - Label for x-axis
     * @param {string} yLabel - Label for y-axis
     * @param {string} zLabel - Label for z-axis
     * @param {string} title - Plot title
     * @returns {Object} Plotly layout object
     * @private
     */
    _createLayout(xLabel, yLabel, zLabel, title) {
        const layout = {
            title: {
                text: title || '',
                font: {
                    size: 16
                }
            },
            margin: {
                l: 60,
                r: 40,
                t: 50,
                b: 60
            },
            xaxis: {
                title: {
                    text: xLabel || '',
                    font: {
                        size: 14
                    }
                }
            },
            yaxis: {
                title: {
                    text: yLabel || '',
                    font: {
                        size: 14
                    }
                }
            },
            hovermode: 'closest',
            template: 'plotly_white'
        };
        
        // Add z-axis for 3D plots
        if (zLabel) {
            layout.scene = {
                xaxis: { title: xLabel || '' },
                yaxis: { title: yLabel || '' },
                zaxis: { title: zLabel || '' }
            };
        }
        
        return layout;
    }

    /**
     * Download a plot as an image
     * @param {string} panelId - ID of the panel with the plot
     * @param {string} format - Image format ('png', 'svg', 'jpeg')
     * @param {string} filename - Name for the downloaded file
     */
    downloadPlot(panelId, format = 'png', filename = 'plot') {
        // Get the plot
        const plotInfo = this.plots.get(panelId);
        if (!plotInfo) {
            console.error(`No plot found in panel ${panelId}`);
            return;
        }
        
        // Download the plot
        Plotly.downloadImage(plotInfo.container, {
            format: format,
            filename: filename,
            width: 1200,
            height: 800
        });
    }

    /**
     * Enable plot interactions (like selection)
     * @param {string} panelId - ID of the panel with the plot
     * @param {Function} callback - Callback function for interactions
     */
    enableInteractions(panelId, callback) {
        // Get the plot
        const plotInfo = this.plots.get(panelId);
        if (!plotInfo) {
            console.error(`No plot found in panel ${panelId}`);
            return;
        }
        
        // Enable selection
        plotInfo.container.on('plotly_selected', data => {
            if (data && callback) {
                callback('selection', data);
            }
        });
        
        // Enable clicking
        plotInfo.container.on('plotly_click', data => {
            if (data && callback) {
                callback('click', data);
            }
        });
        
        // Enable hovering
        plotInfo.container.on('plotly_hover', data => {
            if (data && callback) {
                callback('hover', data);
            }
        });
    }

    /**
     * Add annotations to a plot
     * @param {string} panelId - ID of the panel with the plot
     * @param {Array} annotations - Array of annotation objects
     * @returns {Object} The updated plot object
     */
    addAnnotations(panelId, annotations) {
        // Get the plot
        const plotInfo = this.plots.get(panelId);
        if (!plotInfo) {
            console.error(`No plot found in panel ${panelId}`);
            return null;
        }
        
        // Get current layout
        const layout = plotInfo.plot.layout || {};
        
        // Add annotations
        layout.annotations = annotations;
        
        // Update the plot
        Plotly.relayout(plotInfo.container, layout);
        
        return plotInfo.plot;
    }
}

// Create and export a singleton instance
const plotManager = new PlotManager();

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = plotManager;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro) {
        window.Annzarro.registerModule('plotManager', plotManager);
        window.Annzarro.checkModulesReady();
    } else {
        window.plotManager = plotManager;
    }
}