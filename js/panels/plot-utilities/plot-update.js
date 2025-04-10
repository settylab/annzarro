import { DataManager } from '../../data-manager.js';
import { loadAxisData } from '../plot-utilities/plot-make.js';
import { updateColorControlsVisibility, updateColorSliderUI } from './panel-ui-update.js';


/**
 * Centralized function to efficiently update plot elements.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
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
export function updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, options = {}) {
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

    // Check if there is a Plotly plot in the plotContainer.
    if (!plotContainer.data || !Array.isArray(plotContainer.data) || plotContainer.data.length === 0) {
        console.warn("No Plotly plot found in the container, recreating plot");
        loadDataAndCreatePlot();
        return;
    }
    
    try {
        const is3D = plotContainer.data[0].type === 'scatter3d';
        const shouldBe3D = settings.z !== null;
        const isNumerical = data.colorType === 'numerical';
        const isCategorical = data.colorType === 'categorical';
        const hasMultipleTraces = plotContainer.data && plotContainer.data.length > 1;

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
                    plotContainer.data.forEach((trace, i) => {
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
                    removeHighlight(plotContainer);
                    highlightFocusedCell(plotContainer,data, settings);
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
                        removeHighlight(plotContainer);
                        highlightFocusedCell(plotContainer, data, settings);
                    }
                }
            }
        }
        
        // COLOR DATA UPDATES
        if (updateOptions.colors && data.color) {
            let hasFocusedCell = false;
            if (settings.highlightFocusedCell) {
                removeHighlight(plotContainer);
                hasFocusedCell = true;
            }
            
            const hasStillMultipleTraces = plotContainer.data && plotContainer.data.length > 1;
            
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
                highlightFocusedCell(plotContainer, data, settings);
            }
        }
        
        // STYLING UPDATES (e.g., point size and opacity)
        if (updateOptions.styling) {
            const update = {
                'marker.size': settings.pointSize,
                'marker.opacity': settings.pointOpacity
            };
            
            const dataTraceIndices = plotContainer.data
                .map((trace, i) => (trace && trace.name !== 'Focused Cell' ? i : -1))
                .filter(i => i !== -1);
            
            if (dataTraceIndices.length > 0) {
                Plotly.restyle(plotContainer, update, dataTraceIndices);
            }
            
            const highlightIndex = plotContainer.data.findIndex(trace => trace && trace.name === 'Focused Cell');
            if (highlightIndex >= 0) {
                Plotly.restyle(plotContainer, {
                    'marker.size': settings.pointSize * 2  // Always 2x the normal point size.
                }, [highlightIndex]);
            }
        }
        
        // LAYOUT UPDATES (e.g., axis titles and colorbar properties)
        if (updateOptions.layout) {
            console.log("Updating layout properties");
            
            if (!plotContainer || !plotContainer.data || !plotContainer.data[0]) {
                console.warn("Unable to update layout: plot or container is not valid");
                return;
            }
            
            const layoutUpdate = {};
            
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
            removeHighlight(plotContainer);
            highlightFocusedCell(plotContainer, data, settings);
        }
        
    } catch (error) {
        console.error("Error updating plot:", error);
        console.log("Falling back to recreating the plot");
        loadDataAndCreatePlot();
    }
}


/**
 * Loads only color data and updates the plot without recreating the entire plot.
 *
 * @param {HTMLElement} container - Container element that holds UI controls.
 * @param {HTMLElement} plotContainer - DOM element that holds the plot.
 * @param {Object} settings - Settings object containing plot configuration (axes, colors, etc.).
 * @param {Object} data - Data cache object (e.g. { x, y, z, color, cells, … }).
 * @param {string|number} id - Unique identifier used to target UI controls.
 * @param {Function} loadDataAndCreatePlot - A fallback function to recreate the entire plot.
 *
 * @returns {Promise<void>}
 */
export async function loadColorDataAndUpdatePlot(
    container,
    plotContainer,
    settings,
    data,
    id,
    loadDataAndCreatePlot
) {
    try {

        // Determine filtered cell indices (if using a subset and hiding non-subset cells).
        const filteredCellIndices =
            settings.subsettedCells && settings.hideNonSubset
                ? settings.subsettedCells.map(cell => DataManager.getCellIndex(cell))
                : null;

        // Load only color data using the imported loadAxisData.
        const colorData = await loadAxisData(settings.color, filteredCellIndices);

        if (colorData && colorData.values) {
            // Update the data cache with new color information.
            data.color = colorData.values;
            data.colorType = colorData.type;
            data.colorCategories = colorData.categories;

            // Update UI controls within the container.
            updateColorControlsVisibility(container, data.colorType, id);
            updateColorSliderUI(container, data, settings, id, plotContainer);

            // Use the centralized update system to update plot elements.
            const options = {
                colors: true,
                colorData: true, // New color data loaded.
                colorScale: true, // May need to update color scale.
                colorRange: true, // May need to update color range.
                filter: true, // Update filtering if needed.
                layout: true
            }
            updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, options);

        } else {
            console.warn('No valid color data returned, falling back to full plot reload');
            loadDataAndCreatePlot();
        }
    } catch (error) {
        console.error('Error updating color data:', error);
        // Fall back to recreating the plot.
        loadDataAndCreatePlot();
    }
}


/**
 * Highlights the focused entity (cell or gene) in the Plotly plot.
 *
 * @param {HTMLElement} plotContainer - The container element holding the plot.
 * @param {Object} data - The data object. Expected to have:
 *   - For cells: { x: { values: [...] }, y: { values: [...] }, (optional z: { values: [...] }), cells: [...] }
 *   - For genes: { x: { values: [...] }, y: { values: [...] }, (optional z: { values: [...] }), genes: [...] }
 *   Also expected to include a "colorType" property.
 * @param {Object} settings - Plot settings object. Expected to include:
 *   - pointSize,
 *   - highlightFocusedCell (for cells) or highlightFocusedGene (for genes),
 *   - z (non-null if 3D)
 * @param {string} entityType - Either "cell" or "gene" to indicate the type of entity to highlight.
 */
export function highlightFocusedEntity(plotContainer, data, settings, entityType) {
  // Determine which property to use: cells or genes.
  const entityKey = entityType === 'cell' ? 'cells' : 'genes';
  if (!plotContainer || !data || !data[entityKey] || !data.x || !data.y ||
      !data.x.values || !data.y.values) {
    console.warn(`Missing required data for highlighting ${entityType}`);
    return;
  }
  if (!plotContainer.data || !Array.isArray(plotContainer.data)) {
    console.warn("Plot data is not available for highlighting");
    return;
  }

  // Get the focused entity based on type.
  const focusedEntity = entityType === 'cell'
    ? DataManager.getFocusedCell()
    : DataManager.getFocusedGene();
  const highlightEnabled = entityType === 'cell'
    ? settings.highlightFocusedCell
    : settings.highlightFocusedGene;
  if (!focusedEntity || !highlightEnabled) {
    removeHighlight(plotContainer);
    return;
  }

  let focusedIndex = -1;
  let traceIndex = 0;
  const entityArray = data[entityKey];

  // Check if the data is categorical with multiple traces.
  const isCategorical = data.colorType === 'categorical';
  const dataTraces = plotContainer.data.filter(trace => trace && 
    trace.name !== `Focused ${entityType === 'cell' ? 'Cell' : 'Gene'}`);
  const hasMultipleTraces = dataTraces.length > 1;

  if (isCategorical && hasMultipleTraces) {
    for (let i = 0; i < dataTraces.length; i++) {
      const trace = dataTraces[i];
      if (trace && Array.isArray(trace.text)) {
        const idx = trace.text.indexOf(focusedEntity);
        if (idx !== -1) {
          focusedIndex = idx;
          traceIndex = i;
          break;
        }
      }
    }
  } else {
    focusedIndex = entityArray.indexOf(focusedEntity);
  }

  if (focusedIndex === -1) {
    console.warn(`Focused ${entityType} ${focusedEntity} not found in plot data`);
    removeHighlight(plotContainer);
    return;
  }

  // Determine if we are in 3D mode.
  const is3D = settings.z !== null;

  // Retrieve the coordinates for the focused entity.
  let xValue, yValue, zValue;
  if (isCategorical && hasMultipleTraces) {
    const trace = dataTraces[traceIndex];
    if (trace && Array.isArray(trace.x) && Array.isArray(trace.y) &&
        focusedIndex < trace.x.length && focusedIndex < trace.y.length) {
      xValue = trace.x[focusedIndex];
      yValue = trace.y[focusedIndex];
      if (is3D && trace.z && Array.isArray(trace.z) && focusedIndex < trace.z.length) {
        zValue = trace.z[focusedIndex];
      }
    } else {
      console.error("Invalid trace data for highlighting");
      return;
    }
  } else {
    if (focusedIndex < entityArray.length &&
        focusedIndex < data.x.values.length && focusedIndex < data.y.values.length) {
      xValue = data.x.values[focusedIndex];
      yValue = data.y.values[focusedIndex];
      if (is3D && data.z && data.z.values && Array.isArray(data.z.values) &&
          focusedIndex < data.z.values.length) {
        zValue = data.z.values[focusedIndex];
      }
    } else {
      console.error("Invalid data for highlighting");
      return;
    }
  }

  // Build the highlight trace.
  const highlightTrace = {
    x: [xValue],
    y: [yValue],
    mode: 'markers',
    type: is3D ? 'scatter3d' : 'scattergl',
    marker: {
      size: settings.pointSize * 2, // Emphasize by doubling the size.
      color: 'rgba(255, 0, 0, 1)',   // Red highlight.
      opacity: 1,
      line: {
        color: 'rgba(0, 0, 0, 1)',
        width: 2
      },
      showscale: false  // Do not create a new colorbar.
    },
    hoverinfo: 'skip',
    name: `Focused ${entityType === 'cell' ? 'Cell' : 'Gene'}`,
    showlegend: false  // Prevent the trace from appearing in the legend.
  };
  if (is3D && zValue !== undefined) {
    highlightTrace.z = [zValue];
  }

  // Update existing highlight trace if one exists; otherwise add a new one.
  const existingIdx = plotContainer.data.findIndex(trace => trace && 
    trace.name === `Focused ${entityType === 'cell' ? 'Cell' : 'Gene'}`);
  if (existingIdx >= 0) {
    Plotly.restyle(plotContainer, {
      x: [highlightTrace.x],
      y: [highlightTrace.y],
      z: is3D ? [highlightTrace.z] : undefined,
      type: highlightTrace.type
    }, existingIdx);
  } else {
    Plotly.addTraces(plotContainer, highlightTrace);
  }
}


/**
 * Highlights the focused cell in the Plotly plot.
 *
 * @param {HTMLElement} plotContainer - The container element for the Plotly plot.
 * @param {Object} data - The data object (expected to have data.cells, x, y, etc.).
 * @param {Object} settings - The plot settings.
 */
export function highlightFocusedCell(plotContainer, data, settings) {
  highlightFocusedEntity(plotContainer, data, settings, 'cell');
}

/**
 * Highlights the focused gene in the Plotly plot.
 *
 * @param {HTMLElement} plotContainer - The container element for the Plotly plot.
 * @param {Object} data - The data object (expected to have data.genes, x, y, etc.).
 * @param {Object} settings - The plot settings.
 */
export function highlightFocusedGene(plotContainer, data, settings) {
  highlightFocusedEntity(plotContainer, data, settings, 'gene');
}

/**
 * Removes any highlight trace for cells or genes from the Plotly plot.
 *
 * This function will look for any trace in plotContainer.data whose name (case-insensitive)
 * is either "Focused Cell" or "Focused Gene" and remove it.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the Plotly plot.
 */
export function removeHighlight(plotContainer) {
    if (!plotContainer) return;
    try {
      if (!plotContainer.data || !Array.isArray(plotContainer.data)) return;
  
      const indicesToRemove = [];
      // Loop in reverse order to avoid index shifting while deleting traces.
      for (let i = plotContainer.data.length - 1; i >= 0; i--) {
        const trace = plotContainer.data[i];
        if (trace && typeof trace.name === 'string') {
          const traceName = trace.name.trim().toLowerCase();
          if (traceName === 'focused cell' || traceName === 'focused gene') {
            indicesToRemove.push(i);
          }
        }
      }
      if (indicesToRemove.length > 0) {
        Plotly.deleteTraces(plotContainer, indicesToRemove);
      }
    } catch (error) {
      console.error("Error removing highlight traces:", error);
    }
  }