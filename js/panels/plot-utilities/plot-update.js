import { DataManager } from '../../data-manager.js';


/**
 * Centralized function to efficiently update plot elements.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @param {object} plot - The Plotly plot instance.
 * @param {object} data - The data object containing x, y, z, color, cells, etc.
 * @param {object} settings - The settings for the plot (e.g., x, y, z, color, point sizes).
 * @param {object} options - Update options.
 * @param {boolean} options.xAxis - Whether to update x-axis data.
 * @param {boolean} options.yAxis - Whether to update y-axis data.
 * @param {boolean} options.zAxis - Whether to update z-axis data.
 * @param {boolean} options.colors - Whether to update any coloring properties.
 * @param {boolean} options.colorData - Whether to update the color data array (set to true for new color data).
 * @param {boolean} options.colorScale - Whether to update the color scale only.
 * @param {boolean} options.colorRange - Whether to update color range (min/max) only.
 * @param {boolean} options.styling - Whether to update visual styling.
 * @param {boolean} options.layout - Whether to update layout properties/
 * @param {Function} loadDataAndCreatePlot - Fallback function to recreate the plot.
 * @param {boolean} options.filter - Whether to update filtering (hide outliers).
 */
export function updatePlotElements(plotContainer, plot, data, settings, loadDataAndCreatePlot, options = {}) {
    const defaultOptions = {
        xAxis: false,
        yAxis: false,
        zAxis: false,
        colors: false,
        colorData: false,
        colorScale: false,
        colorRange: false,
        styling: false,
        layout: false,
        filter: false 
    };
    
    // Merge provided options with defaults
    const updateOptions = { ...defaultOptions, ...options };

    // Check for required container element
    if (!plotContainer || !plotContainer.parentNode) {
        console.warn("Plot container doesn't exist or is not in the DOM, cannot update");
        return;
    }
    
    // If container is empty, recreate the plot via callback.
    if (plotContainer.innerHTML === '') {
        console.warn("Plot container is empty, recreating plot");
        loadDataAndCreatePlot();
        return;
    }
    
    // If the plot itself doesn't exist, recreate it.
    if (!plot || !plot.data) {
        console.warn("Plot doesn't exist yet, creating it instead of updating");
        loadDataAndCreatePlot();
        return;
    }
    
    try {
        const is3D = plot.data[0].type === 'scatter3d';
        const shouldBe3D = settings.z !== null;
        const isNumerical = data.colorType === 'numerical';
        const isCategorical = data.colorType === 'categorical';
        const hasMultipleTraces = plot.data && plot.data.length > 1;

        // Create an index mask for filtering out outliers if needed.
        let indexMask = null;
        if (settings.hideOutliers && isNumerical && data.color) {
            const cmin = settings.colorMin !== null ? settings.colorMin : Math.min(...data.color);
            const cmax = settings.colorMax !== null ? settings.colorMax : Math.max(...data.color);
            indexMask = data.color.map((v) => v >= cmin && v <= cmax);
        }

        // FILTER-ONLY MODE: apply filtering updates only.
        if (updateOptions.filter) {
            let filteredX, filteredY, filteredZ, filteredColor, filteredText, filteredCustom;
            
            if (indexMask) {
                filteredX = data.x.values.filter((_, i) => indexMask[i]);
                filteredY = data.y.values.filter((_, i) => indexMask[i]);
                filteredZ = settings.z && data.z ? data.z.values.filter((_, i) => indexMask[i]) : undefined;
                filteredColor = data.color.filter((_, i) => indexMask[i]);
                filteredText = data.cells.filter((_, i) => indexMask[i]);
                filteredCustom = data.cells.map((_, i) => i).filter((_, i) => indexMask[i]);
            } else {
                filteredX = data.x.values;
                filteredY = data.y.values;
                filteredZ = settings.z && data.z ? data.z.values : undefined;
                filteredColor = data.color;
                filteredText = data.cells;
                filteredCustom = data.cells.map((_, i) => i);
            }
            
            const update = {
                x: [filteredX],
                y: [filteredY],
                'marker.color': [filteredColor],
                text: [filteredText],
                customdata: [filteredCustom]
            };
            if (shouldBe3D && filteredZ) update.z = [filteredZ];

            Plotly.restyle(plotContainer, update, [0]);
            return; // Exit early after filter update.
        }

        // Update POSITION data if required.
        const positionChange = updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis;
        if (positionChange) {
            // Recreate plot if switching between 2D and 3D.
            if (is3D !== shouldBe3D) {
                console.log("Switching between 2D and 3D plot types - recreating plot");
                loadDataAndCreatePlot();
                return;
            }
            
            if (isCategorical && hasMultipleTraces) {
                console.log("Updating positions for categorical data with multiple traces");

                try {
                    // Update each trace independently for categorical data.
                    plot.data.forEach((trace, i) => {
                        if (trace.mode !== 'markers') return;
                        const indices = trace.customdata;
                        if (!indices || !indices.length) return;

                        const update = {};
                        if (updateOptions.xAxis && data.x?.values) update.x = [indices.map(idx => data.x.values[idx])];
                        if (updateOptions.yAxis && data.y?.values) update.y = [indices.map(idx => data.y.values[idx])];
                        if (updateOptions.zAxis && data.z?.values && shouldBe3D) update.z = [indices.map(idx => data.z.values[idx])];
                        if (data.cells) {
                            update.text = [indices.map(idx => data.cells[idx])];
                            update.customdata = [indices];
                        }

                        if (Object.keys(update).length > 0) {
                            console.log(`Updating trace ${i} positions:`, update);
                            Plotly.restyle(plotContainer, update, [i]);
                        }
                    });
                } catch (error) {
                    console.error("Error updating categorical trace positions:", error);
                    loadDataAndCreatePlot();
                    return;
                }
                
                // Update the focused cell highlight if needed.
                if (settings.highlightFocusedCell) {
                    removeHighlight(plotContainer, plot);
                    highlightFocusedCell(plotContainer, plot, data, settings);
                }
            } else {
                // Standard update for a single trace (numerical data).
                const update = {};
                const applyMask = idx => !indexMask || indexMask[idx];
                
                const fx = updateOptions.xAxis ? data.x.values.filter((_, i) => applyMask(i)) : null;
                const fy = updateOptions.yAxis ? data.y.values.filter((_, i) => applyMask(i)) : null;
                const fz = updateOptions.zAxis && data.z?.values && shouldBe3D ? data.z.values.filter((_, i) => applyMask(i)) : null;
                
                if (fx) update.x = [fx];
                if (fy) update.y = [fy];
                if (fz) update.z = [fz];
                
                if (Object.keys(update).length > 0) {
                    console.log("Updating position data:", update);
                    Plotly.restyle(plotContainer, update, [0]);
                    if (settings.highlightFocusedCell) {
                        removeHighlight(plotContainer, plot);
                        highlightFocusedCell(plotContainer, plot, data, settings);
                    }
                }
            }
        }
        
        // COLOR DATA UPDATES
        if (updateOptions.colors && data.color) {
            let hasFocusedCell = false;
            if (settings.highlightFocusedCell) {
                removeHighlight(plotContainer, plot);
                hasFocusedCell = true;
            }
            
            const hasStillMultipleTraces = plot.data && plot.data.length > 1;
            
            if (updateOptions.colorData) {
                if ((isCategorical && !hasStillMultipleTraces) || (!isCategorical && hasStillMultipleTraces)) {
                    console.log("Switching between categorical and numerical coloring - recreating plot");
                    loadDataAndCreatePlot();
                    return;
                }
            }
            
            if (isCategorical && updateOptions.colorData) {
                console.log("Categorical coloring requires recreating the plot");
                loadDataAndCreatePlot();
                return;
            }
            
            if (isNumerical && data.color && data.color.length > 0) {
                const update = {};
                const applyMask = idx => !indexMask || indexMask[idx];

                if (updateOptions.colorData) {
                    update['marker.color'] = [data.color.filter((_, i) => applyMask(i))];
                }
                
                if (updateOptions.colorScale || updateOptions.colorData) {
                    update['marker.colorscale'] = settings.colorScale;
                    update['marker.reversescale'] = settings.colorReversed;
                }
                
                if (settings.colorMin !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                    update['marker.cmin'] = settings.colorMin;
                }
                
                if (settings.colorMax !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                    update['marker.cmax'] = settings.colorMax;
                }
                
                update['marker.showscale'] = true;
                update['showlegend'] = false;
                
                if (Object.keys(update).length > 0) {
                    Plotly.restyle(plotContainer, update, [0]);
                }
            } else if (data.colorType === 'constant') {
                const update = {};
                if (updateOptions.colorData) {
                    update['marker.color'] = 'rgba(150, 150, 150, 0.7)';
                }
                update['marker.showscale'] = false;
                update['showlegend'] = false;
                
                if (Object.keys(update).length > 0) {
                    Plotly.restyle(plotContainer, update, [0]);
                }
            }
            
            // Re-add highlight for the focused cell if needed.
            if (hasFocusedCell) {
                highlightFocusedCell(plotContainer, plot, data, settings);
            }
        }
        
        // STYLING UPDATES (e.g., point size and opacity)
        if (updateOptions.styling) {
            const update = {
                'marker.size': settings.pointSize,
                'marker.opacity': settings.pointOpacity
            };
            
            const dataTraceIndices = plot.data
                .map((trace, i) => (trace && trace.name !== 'Focused Cell' ? i : -1))
                .filter(i => i !== -1);
            
            if (dataTraceIndices.length > 0) {
                Plotly.restyle(plotContainer, update, dataTraceIndices);
            }
            
            const highlightIndex = plot.data.findIndex(trace => trace && trace.name === 'Focused Cell');
            if (highlightIndex >= 0) {
                Plotly.restyle(plotContainer, {
                    'marker.size': settings.pointSize * 2  // Always 2x the normal point size.
                }, [highlightIndex]);
            }
        }
        
        // LAYOUT UPDATES (e.g., axis titles and colorbar properties)
        if (updateOptions.layout) {
            console.log("Updating layout properties");
            
            if (!plot || !plot.data || !plot.data[0] || !plotContainer) {
                console.warn("Unable to update layout: plot or container is not valid");
                return;
            }
            
            const layoutUpdate = {};
            const is3D = plot.data[0].type === 'scatter3d';
            
            if (settings && settings.x && settings.x.type && settings.x.key) {
                const xAxisTitle = `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`;
                if (is3D) {
                    layoutUpdate['scene.xaxis.title'] = xAxisTitle;
                } else {
                    layoutUpdate['xaxis.title'] = xAxisTitle;
                }
            }
            
            if (settings && settings.y && settings.y.type && settings.y.key) {
                const yAxisTitle = `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`;
                if (is3D) {
                    layoutUpdate['scene.yaxis.title'] = yAxisTitle;
                } else {
                    layoutUpdate['yaxis.title'] = yAxisTitle;
                }
            }
            
            if (is3D && settings && settings.z && settings.z.type && settings.z.key) {
                const zAxisTitle = `${settings.z.type}.${settings.z.key}${settings.z.column ? `.${settings.z.column}` : ''}`;
                layoutUpdate['scene.zaxis.title'] = zAxisTitle;
            }
            
            if (Object.keys(layoutUpdate).length > 0) {
                console.log("Applying layout updates:", layoutUpdate);
                Plotly.relayout(plotContainer, layoutUpdate);
            }
            
            if (settings && settings.color && settings.color.type && settings.color.key) {
                if (data.colorType === 'numerical') {
                    const colorbar = {
                        title: {
                            text: `${settings.color.type}.${settings.color.key}` + (settings.color.column ? `.${settings.color.column}` : ''),
                            side: 'right',
                            font: { size: 12 }
                        },
                        titleside: 'right'
                    };
                    const restyleUpdate = {
                        'marker.colorbar': colorbar,
                        'marker.showscale': true,
                        'showlegend': false
                    };
                    console.log("Applying colorbar restyle updates:", restyleUpdate);
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                } else if (settings.color.type === 'none' || data.colorType === 'constant') {
                    const restyleUpdate = {
                        'marker.showscale': false,
                        'showlegend': false
                    };
                    console.log("Applying colorbar restyle updates:", restyleUpdate);
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                }
            }
        }
        
        // If position data changed, update the highlighted cell.
        if (settings.highlightFocusedCell && (updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis)) {
            removeHighlight(plotContainer, plot);
            highlightFocusedCell(plotContainer, plot, data, settings);
        }
        
    } catch (error) {
        console.error("Error updating plot:", error);
        console.log("Falling back to recreating the plot");
        loadDataAndCreatePlot();
    }
}

/**
 * Highlight the focused cell in the plot.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @param {Object} plot - The Plotly plot instance.
 * @param {Object} data - Data object containing x, y, (optional z), cells, color, and colorType.
 *                         Expected structure:
 *                           data = {
 *                             x: { values: [...] },
 *                             y: { values: [...] },
 *                             z: { values: [...] }, // optional
 *                             cells: [...],
 *                             color: [...],         // optional
 *                             colorType: 'categorical' || 'numerical' || 'constant'
 *                           }
 * @param {Object} settings - Settings for the plot (e.g., pointSize, highlightFocusedCell flag, z).
 *                            Expected keys include:
 *                              settings = {
 *                                pointSize: number,
 *                                highlightFocusedCell: boolean,
 *                                z: any  // typically non-null if 3D
 *                              }
 */
export function highlightFocusedCell(plotContainer, plot, data, settings) {
    // Ensure required data and plot elements exist
    if (!plot || !data || !data.cells || !data.x || !data.y ||
        !data.x.values || !data.y.values || !plotContainer) {
        console.log("Missing required data for highlighting cell");
        return;
    }
    if (!plot.data || !Array.isArray(plot.data)) {
        console.log("Plot data is not available for highlighting");
        return;
    }

    const focusedCell = DataManager.getFocusedCell();
    if (!focusedCell || !settings.highlightFocusedCell) {
        // If highlighting is disabled or no focused cell exists, remove any highlight
        removeHighlight(plotContainer, plot);
        return;
    }

    try {
        // Determine whether we're handling categorical data with multiple traces.
        const isCategorical = data.colorType === 'categorical';
        let dataTraces = [];
        try {
            dataTraces = plot.data.filter(trace => trace && trace.name !== 'Focused Cell');
        } catch (err) {
            console.error("Error filtering traces:", err);
        }
        const hasMultipleTraces = dataTraces.length > 1;
        let focusedCellIndex = -1;
        let traceIndex = 0;

        if (isCategorical && hasMultipleTraces) {
            // Search each trace's text array for the focused cell.
            for (let i = 0; i < dataTraces.length; i++) {
                const trace = dataTraces[i];
                if (trace && Array.isArray(trace.text)) {
                    const idx = trace.text.indexOf(focusedCell);
                    if (idx !== -1) {
                        focusedCellIndex = idx;
                        traceIndex = i;
                        break;
                    }
                }
            }
        } else {
            // For a single trace, just locate the cell in the main data.
            focusedCellIndex = data.cells.indexOf(focusedCell);
        }

        if (focusedCellIndex === -1) {
            console.log(`Focused cell ${focusedCell} not found in plot data`);
            removeHighlight(plotContainer, plot);
            return;
        }

        // Determine if we're in 3D mode.
        const is3D = settings.z !== null;

        // Retrieve coordinates for the focused cell.
        let xValue, yValue, zValue;
        if (isCategorical && hasMultipleTraces) {
            if (traceIndex < dataTraces.length) {
                const trace = dataTraces[traceIndex];
                if (trace && Array.isArray(trace.x) && Array.isArray(trace.y) &&
                    focusedCellIndex < trace.x.length && focusedCellIndex < trace.y.length) {
                    
                    xValue = trace.x[focusedCellIndex];
                    yValue = trace.y[focusedCellIndex];
                    if (is3D && trace.z && Array.isArray(trace.z) &&
                        focusedCellIndex < trace.z.length) {
                        zValue = trace.z[focusedCellIndex];
                    }
                } else {
                    console.error("Invalid trace data for highlighting");
                    return;
                }
            } else {
                console.error("Trace index out of bounds");
                return;
            }
        } else {
            if (Array.isArray(data.x.values) && Array.isArray(data.y.values) &&
                focusedCellIndex < data.x.values.length && focusedCellIndex < data.y.values.length) {
                
                xValue = data.x.values[focusedCellIndex];
                yValue = data.y.values[focusedCellIndex];
                if (is3D && data.z && data.z.values && Array.isArray(data.z.values) &&
                    focusedCellIndex < data.z.values.length) {
                    zValue = data.z.values[focusedCellIndex];
                }
            } else {
                console.error("Invalid data for highlighting");
                return;
            }
        }

        // Create the highlight trace.
        const highlightTrace = {
            x: [xValue],
            y: [yValue],
            mode: 'markers',
            type: is3D ? 'scatter3d' : 'scattergl',
            marker: {
                size: settings.pointSize * 2, // Increased size for emphasis
                color: 'rgba(255, 0, 0, 1)',   // Red color for highlighting
                opacity: 1,
                line: {
                    color: 'rgba(0, 0, 0, 1)',
                    width: 2
                }
            },
            hoverinfo: 'skip',
            name: 'Focused Cell',
            showlegend: false
        };

        // Include z coordinate for 3D plots.
        if (is3D && zValue !== undefined) {
            highlightTrace.z = [zValue];
        }

        // Check if a highlight trace already exists.
        const highlightTraceIndex = plot.data.findIndex(trace => trace && trace.name === 'Focused Cell');
        if (highlightTraceIndex >= 0) {
            // Update existing trace.
            Plotly.restyle(plotContainer, {
                x: [highlightTrace.x],
                y: [highlightTrace.y],
                z: is3D ? [highlightTrace.z] : undefined,
                type: highlightTrace.type
            }, highlightTraceIndex);
        } else {
            // Add a new highlight trace.
            Plotly.addTraces(plotContainer, highlightTrace);
        }
    } catch (error) {
        console.error("Error highlighting focused cell:", error);
    }
}

/**
 * Remove the highlight trace from the plot.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @param {Object} plot - The Plotly plot instance.
 */
export function removeHighlight(plotContainer, plot) {
    if (!plot || !plotContainer) return;

    try {
        if (!plot.data || !Array.isArray(plot.data)) {
            return;
        }
        // Find the highlight trace (by its unique name).
        let highlightTraceIndex = -1;
        for (let i = 0; i < plot.data.length; i++) {
            if (plot.data[i] && plot.data[i].name === 'Focused Cell') {
                highlightTraceIndex = i;
                break;
            }
        }
        if (highlightTraceIndex >= 0) {
            // Remove the trace from the plot.
            Plotly.deleteTraces(plotContainer, highlightTraceIndex);
        }
    } catch (error) {
        console.error("Error removing highlight:", error);
    }
}