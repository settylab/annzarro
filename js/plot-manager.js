/**
 * PlotManager - Creates and manages plots for visualization
 * This class is responsible for:
 * 1. Creating various plot types (scatter, violin, heatmap, etc.)
 * 2. Updating plots based on data and settings
 * 3. Handling plot interactions (selection, hover, etc.)
 */

/**
 * Helper function to access the Utils dependency safely
 * This avoids variable declarations that might conflict
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
            type: 'scatter',
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