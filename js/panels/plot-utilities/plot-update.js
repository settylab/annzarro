import { DataManager } from '../../data-manager.js';
import { loadAxisData } from '../plot-utilities/plot-make.js';
import { updateColorControlsVisibility, updateColorSliderUI } from './panel-ui-update.js';
import { processCategories } from './plot-make-helper.js';
import { applyAllAestheticSettings } from './plot-aesthetics-menu.js';



/**
 * Centralized function to efficiently update plot elements.
 *
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @param {object} data - The data object containing x, y, z, color, cells or genes, etc.
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
 * @param {Function} refreshPlot - Fallback function to recreate the plot.
 * @param {boolean} options.filter - Whether to update filtering (hide outliers).
 * @returns {Promise<void>} A promise that resolves when the update is complete.
 */
export async function updatePlotElements(plotContainer, data, settings, refreshPlot, options = {}) {
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
        refreshPlot();
        return;
    }
    
    try {
        const is3D = plotContainer.data[0].type === 'scatter3d';
        const shouldBe3D = settings.z !== null;
        const isNumerical = data.colorType === 'numerical';
        const isCategorical = data.colorType === 'categorical';
        const hasMultipleTraces = plotContainer.data && plotContainer.data.length > 1;
        const entityType = data.entities

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
            
            // Get entity data using our helper function
            const entities = data[entityType];
            if (!entities) {
                console.warn("Entities data is not present, skipping filtering updates.");
            } else {
                if (indexMask) {
                    filteredX = data.x.values.filter((_, i) => indexMask[i]);
                    filteredY = data.y.values.filter((_, i) => indexMask[i]);
                    filteredZ = settings.z && data.z ? data.z.values.filter((_, i) => indexMask[i]) : undefined;
                    filteredColor = data.color.filter((_, i) => indexMask[i]);
                    filteredText = entities.filter((_, i) => indexMask[i]);
                    filteredCustom = Array.from({length: entities.length}, (_, i) => i).filter((_, i) => indexMask[i]);
                } else {
                    filteredX = data.x.values;
                    filteredY = data.y.values;
                    filteredZ = settings.z && data.z ? data.z.values : undefined;
                    filteredColor = data.color;
                    filteredText = entities;
                    filteredCustom = Array.from({length: entities.length}, (_, i) => i);
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
        }

        // Update POSITION data if required.
        const positionChange = updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis;
        if (positionChange) {
            // Recreate plot if switching between 2D and 3D.
            if (is3D !== shouldBe3D) {
                refreshPlot();
                return;
            }
            
            if (isCategorical && hasMultipleTraces) {
                try {
                    // Determine entity type
                    const entities = data[entityType];
                    if (!entities) {
                        console.warn("Entities data is not present, skipping filtering updates.");
                        throw new Error("Entities data is not present");
                    }
                    
                    // Update each trace independently for categorical data.
                    plotContainer.data.forEach((trace, i) => {
                        if (trace.mode !== 'markers') return;
                        const indices = trace.customdata;
                        if (!indices || !indices.length) return;

                        const update = {};
                        if (updateOptions.xAxis && data.x?.values) update.x = [indices.map(idx => data.x.values[idx])];
                        if (updateOptions.yAxis && data.y?.values) update.y = [indices.map(idx => data.y.values[idx])];
                        if (updateOptions.zAxis && data.z?.values && shouldBe3D) update.z = [indices.map(idx => data.z.values[idx])];
                        if (entities && entities.length) {
                            update.text = [indices.map(idx => entities[idx])];
                            update.customdata = [indices];
                        }

                        if (Object.keys(update).length > 0) {
                            Plotly.restyle(plotContainer, update, [i]);
                        }
                    });
                } catch (error) {
                    console.error("Error updating categorical trace positions:", error);
                    refreshPlot();
                    return;
                }
                
                // Update the highlighted entity if needed
                highlightFocusedEntity(plotContainer, data, settings, entityType);
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
                    // Highlight the appropriate entity based on plot type
                    highlightFocusedEntity(plotContainer, data, settings, entityType);
                }
            }
        }
        
        // COLOR DATA UPDATES
        if (updateOptions.colors && data.color) {
            let hasFocusedCell = false;
            if (settings.highlightFocusedCell || settings.highlightFocusedGene) {
                removeHighlight(plotContainer);
                hasFocusedCell = true;
            }
            
            const hasStillMultipleTraces = plotContainer.data && plotContainer.data.length > 1;
            
            if (updateOptions.colorData || updateOptions.colors) {
              // When switching from categorical (multiple traces) to numerical (single trace)
              if (!isCategorical && hasStillMultipleTraces) {
                  // Create a new single trace using the data object
                  const newTrace = {
                      type: settings.z ? 'scatter3d' : 'scattergl',
                      mode: 'markers',
                      x: data.x.values,
                      y: data.y.values,
                      text: data[entityType],
                      customdata: Array.from({ length: data[entityType].length }, (_, i) => i),
                      hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` +
                          (settings.z ? `<br>z: %{z}` : '') +
                          `<br>c: %{marker.color}<extra></extra>`,
                      marker: {
                          size: settings.pointSize,
                          opacity: settings.pointOpacity,
                          color: data.color,
                          colorscale: settings.colorScale,
                          reversescale: settings.colorReversed,
                          cmin: settings.colorMin !== null ? settings.colorMin : Math.min(...data.color.filter(v => !isNaN(v))),
                          cmax: settings.colorMax !== null ? settings.colorMax : Math.max(...data.color.filter(v => !isNaN(v))),
                          colorbar: {
                              title: {
                                  text: `${settings.color.type}.${settings.color.key}` + 
                                        (settings.color.column ? `.${settings.color.column}` : ''),
                                  side: 'right',
                                  font: { size: 12 }
                              },
                              titleside: 'right'
                          },
                          showscale: true
                      },
                      showlegend: false
                  };
                  
                  if (settings.z) newTrace.z = data.z.values;
                  
                  // First remove all traces
                  while (plotContainer.data.length > 0) {
                      Plotly.deleteTraces(plotContainer, 0);
                  }
                  
                  // Add the new trace
                  Plotly.addTraces(plotContainer, newTrace);
                  
                  // Re-highlight focused entity if needed
                  if (settings.highlightFocusedCell || settings.highlightFocusedGene) {
                      highlightFocusedEntity(plotContainer, data, settings, entityType);
                  }
                  applyAllAestheticSettings(plotContainer, settings);
                      
              } else if (isCategorical) {
                  // Get unique category values and prepare color data
                  const catValues = data.colorCategories || [...new Set(data.color)];
                  let customColors = null;
                  
                  // Try to load custom colors from uns if categoryPalette is set to "uns"
                  if (settings.categoryPalette === "uns") {
                      const colorKey = `${settings.color.key}_colors`;
                      const datasetPath = DataManager.getCurrentDataset();
                      try {
                          // DataManager.loadUns is async
                          const response = await DataManager.loadUns({
                              datasetPath: datasetPath,
                              unsKey: colorKey
                          });
                          
                          if (response && response.data) {
                              customColors = Array.isArray(response.data) ? response.data : [response.data];
                          }
                      } catch (error) {
                          console.warn(`Error fetching custom colors from uns.${colorKey}:`, error);
                      }
                  }
                  
                  // Process categories to create traces for each category
                  const categoricalTraces = processCategories(settings, data, catValues, customColors);
                  
                  // Remove all existing traces
                  while (plotContainer.data.length > 0) {
                      Plotly.deleteTraces(plotContainer, 0);
                  }
                  
                  // Add new categorical traces
                  Plotly.addTraces(plotContainer, categoricalTraces);
                  
                  // Re-highlight focused entity if needed
                  if (settings.highlightFocusedCell || settings.highlightFocusedGene) {
                      highlightFocusedEntity(plotContainer, data, settings, entityType);
                  }
                  applyAllAestheticSettings(plotContainer, settings);
                    
              } else if (isNumerical) {
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
                
                if (Object.keys(update).length > 0) {
                    Plotly.restyle(plotContainer, update, [0]);
                }
                applyAllAestheticSettings(plotContainer, settings);
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
            } else {
                refreshPlot();
            }
            
            // Re-add highlight for the focused entity if needed.
            if (hasFocusedCell) {
                highlightFocusedEntity(plotContainer, data, settings, entityType);
            }
          }
        }
        
        // STYLING UPDATES (e.g., point size and opacity)
        if (updateOptions.styling) {
            const update = {
                'marker.size': settings.pointSize,
                'marker.opacity': settings.pointOpacity
            };
            
            const dataTraceIndices = plotContainer.data
                .map((trace, i) => (trace && trace.name !== `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}` ? i : -1))
                .filter(i => i !== -1);
            
            if (dataTraceIndices.length > 0) {
                Plotly.restyle(plotContainer, update, dataTraceIndices);
            }
            
            const highlightIndex = plotContainer.data.findIndex(trace => trace && trace.name === `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}`);
            if (highlightIndex >= 0) {
                Plotly.restyle(plotContainer, {
                    'marker.size': settings.pointSize * 2  // Always 2x the normal point size.
                }, [highlightIndex]);
            }
        }
        
        // LAYOUT UPDATES (e.g., axis titles and colorbar properties)
        if (updateOptions.layout) {
            
            if (!plotContainer || !plotContainer.data || !plotContainer.data[0]) {
                console.warn("Unable to update layout: plot or container is not valid");
                return;
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
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                } else if (settings.color.type === 'none' || data.colorType === 'constant') {
                    const restyleUpdate = {
                        'marker.showscale': false,
                        'showlegend': false
                    };
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                }
            }
                        
            // Use the imported applyAllAestheticSettings function
            applyAllAestheticSettings(plotContainer, settings);
        }
        
        // If position data changed, update the highlighted cell.
        if ((settings.highlightFocusedCell || settings.highlightFocusedGene) && (updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis)) {
            highlightFocusedEntity(plotContainer, data, settings, entityType)
        }
        
    } catch (error) {
        console.error("Error updating plot:", error);
        console.log("Falling back to recreating the plot");
        refreshPlot();
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
 * @param {Function} refreshPlot - A fallback function to recreate the entire plot.
 *
 * @returns {Promise<void>}
 */
export async function loadColorDataAndUpdatePlot(
    container,
    plotContainer,
    settings,
    data,
    id,
    refreshPlot
) {
    try {
        // Load only color data using the imported loadAxisData, passing the plotContainer
        // to show loading indicators during color data loading
        const colorData = await loadAxisData(settings.color, data.entities, plotContainer);

        if (colorData && colorData.values) {
            // Update the data cache with new color information.
            data.color = colorData.values;
            data.colorType = colorData.type;
            data.colorCategories = colorData.categories;

            // Update UI controls within the container.
            updateColorControlsVisibility(container, data.colorType, id);
            updateColorSliderUI(container, data, settings, id);

            // Use the centralized update system to update plot elements.
            const options = {
                colors: true,
                colorData: true, // New color data loaded.
                colorScale: true, // May need to update color scale.
                colorRange: true, // May need to update color range.
                filter: true, // Update filtering if needed.
                layout: true
            }
            updatePlotElements(plotContainer, data, settings, refreshPlot, options);

        } else {
            console.warn('No valid color data returned, falling back to full plot reload');
            refreshPlot();
        }
    } catch (error) {
        console.error('Error updating color data:', error);
        // Fall back to recreating the plot.
        refreshPlot();
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
 *   - z (non-null if 3D)
 * @param {string} entityType - Either "cell" or "gene" to indicate the type of entity to highlight.
 */
export function highlightFocusedEntity(plotContainer, data, settings, entityType=null) {
  // Determine which property to use: cells or genes.
  entityType = entityType || data.entities
  if (!plotContainer || !data || !data[entityType] || !data.x || !data.y ||
      !data.x.values || !data.y.values) {
    console.warn(`Missing required data for highlighting ${entityType}`);
    return;
  }
//   if (!plotContainer.data || !Array.isArray(plotContainer.data)) {
//     console.warn("Plot data is not available for highlighting");
//     return;
//   }

  // Get the focused entity based on type.
  const focusedEntity = entityType === 'cells'
    ? DataManager.getFocusedCell()
    : DataManager.getFocusedGene();
  const highlightEnabled = entityType === 'cells'
    ? settings.highlightFocusedCell
    : settings.highlightFocusedGene;
  if (!focusedEntity || !highlightEnabled) {
    removeHighlight(plotContainer);
    return;
  }

  let focusedIndex = -1;
  let traceIndex = 0;
  const entityArray = data[entityType];

  if (!plotContainer.data || !Array.isArray(plotContainer.data)) {
    console.warn("Plot data is not available for highlighting");
    return;
  }

  // Check if the data is categorical with multiple traces.
  const isCategorical = data.colorType === 'categorical';
  const dataTraces = plotContainer.data.filter(trace => trace && 
    trace.name !== `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}`);
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
    name: `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}`,
    showlegend: false  // Prevent the trace from appearing in the legend.
  };
  if (is3D && zValue !== undefined) {
    highlightTrace.z = [zValue];
  }

  // Update existing highlight trace if one exists; otherwise add a new one.
  const existingIdx = plotContainer.data.findIndex(trace => trace && 
    trace.name === `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}`);
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


/**
 * Update the axis based on the focused entity and its type
 * 
 * @param {string} axis - Axis to update ('x', 'y', 'z', 'color')
 * @param {string} focusedEntity - The entity to focus on (e.g., a gene or cell)
 * @param {string} entityType - Type of the entity ('genes', 'cells')
 * @param {object} context - Shared state and utilities
 * @param {object} context.settings - The current settings object
 * @param {HTMLElement} context.controlsContainer - DOM container holding UI controls
 * @param {HTMLElement} context.container - Outer container for the plot
 * @param {HTMLElement} context.plotContainer - Plotly target container
 * @param {object} context.data - Current data cache for axes
 * @param {string} context.id - Panel or plot identifier
 * @param {string} context.plotType - 'cells' or 'genes'
 * @param {function} context.refreshPlot - Fallback plot refresh function
 * @param {function} context.updateMenueLabelsForFocus - Updates dropdowns or labels
 */
export async function refocusAxisOnEntity(
    axis,
    focusedEntity,
    entityType,
    {
      settings,
      controlsContainer,
      container,
      plotContainer,
      data,
      id,
      plotType,
      refreshPlot,
      updateMenueLabelsForFocus,
    }
  ) {
    const refocusButton = controlsContainer.querySelector(`#refocus-${axis}`);
  
    if (axis === 'color') {
      if (settings.color.locked) {
        if (settings.color.column !== focusedEntity) {
          if (refocusButton) refocusButton.style.display = 'inline-block';
        } else {
          if (refocusButton) refocusButton.style.display = 'none';
        }
      } else if (settings.color.column !== focusedEntity) {
        settings.color.column = focusedEntity;
        updateMenueLabelsForFocus(focusedEntity, entityType, axis);
        await loadColorDataAndUpdatePlot(container, plotContainer, settings, data, id, refreshPlot);
      }
      return;
    }
  
    // For x, y, z axes
    if (settings[axis].locked) {
      if (settings[axis].column !== focusedEntity) {
        if (refocusButton) refocusButton.style.display = 'inline-block';
      } else {
        if (refocusButton) refocusButton.style.display = 'none';
      }
    } else if (settings[axis].column !== focusedEntity) {
      settings[axis].column = focusedEntity;
      updateMenueLabelsForFocus(focusedEntity, entityType, axis);
      // Pass the plotContainer to loadAxisData to enable loading indicators
      const axisData = await loadAxisData(settings[axis], plotType, plotContainer);
      if (!axisData || !axisData.values) {
        throw new Error(`Loading data for ${axis} generated no values.`);
      } else {
        data[axis] = axisData;
        updatePlotElements(plotContainer, data, settings, refreshPlot, { [`${axis}Axis`]: true, layout: true });
      }
    }
  }