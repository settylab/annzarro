import { DataManager } from '../../data-manager.js';
import { notInSubsetLabel } from '../../utils/subset.js';
import { 
  loadAxisData, 
  createFilterMask, 
  applyFilterMask, 
  updateTableEntities,
  panelLoadCoverage,
  stableAxisRanges,
  applyHoverInfo,
  sortTracesByColor,
  unsortTraces,
  applyLogColor,
  applyLogColorbar
} from '../plot-utilities/plot-make.js';
import { updateColorControlsVisibility, updateColorSliderUI } from './panel-ui-update.js';
import { processCategories, isLegendProxy } from './plot-make-helper.js';
import { applyAllAestheticSettings } from './plot-aesthetics-menu.js';
import { arrayMin, arrayMax } from '../../utils/array-stats.js';
import { Coverage, classifyFilterStats } from '../../utils/coverage.js';
import { renderCoverageNotice, renderModeNotice, withCoverageAnnotation } from '../../utils/panel-surface.js';
import { withPlotlyBatch } from '../../utils/plotly-batch.js';



/**
 * Updates the datapoint filter widget with the current filter statistics
 * 
 * @param {HTMLElement} plotContainer - The DOM element containing the plot
 * @param {object} filterStats - Statistics about filtered datapoints
 * @param {number} filterStats.xNaN - Number of NaN values in x-axis data
 * @param {number} filterStats.yNaN - Number of NaN values in y-axis data
 * @param {number} filterStats.zNaN - Number of NaN values in z-axis data
 * @param {number} filterStats.colorNaN - Number of NaN values in color data
 * @param {number} filterStats.colorOutliers - Number of outliers in color data
 * @param {number} filterStats.tableFiltered - Number of table-filtered datapoints
 * @param {number} filterStats.total - Total number of datapoints
 * @param {number} filterStats.filtered - Total number of filtered datapoints
 */
function updateFilterWidget(plotContainer, filterStats) {
    const plotId = plotContainer.id.replace('plot-container-', '');
    const widget = document.getElementById(`filter-widget-${plotId}`);
    
    if (!widget) return;
    
    const statsList = widget.querySelector('.filter-stats-list');
    const totalCount = widget.querySelector('.filter-total-count');
    
    // Clear existing items
    statsList.innerHTML = '';
    
    // Track if we have any filters to display
    let hasFilters = false;
    
    // Add items for each filter reason - axis NaNs are always filtered by Plotly
    if (filterStats.xNaN > 0) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item">
                <span class="filter-reason">X-axis NaN:</span>
                <span class="filter-count">${filterStats.xNaN}</span>
            </li>
        `;
    }
    
    if (filterStats.yNaN > 0) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item">
                <span class="filter-reason">Y-axis NaN:</span>
                <span class="filter-count">${filterStats.yNaN}</span>
            </li>
        `;
    }
    
    if (filterStats.zNaN > 0) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item">
                <span class="filter-reason">Z-axis NaN:</span>
                <span class="filter-count">${filterStats.zNaN}</span>
            </li>
        `;
    }
    
    // Only show color NaN in the stats when hideNaN is active
    if (filterStats.colorNaN > 0 && filterStats.hideNaNActive) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item">
                <span class="filter-reason">Color NaN:</span>
                <span class="filter-count">${filterStats.colorNaN}</span>
            </li>
        `;
    }
    
    // Only show color outliers when hideOutliers is active
    if (filterStats.colorOutliers > 0 && filterStats.hideOutliersActive) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item">
                <span class="filter-reason">Color outliers:</span>
                <span class="filter-count">${filterStats.colorOutliers}</span>
            </li>
        `;
    }
    
    // Show table filtered entries when table filter is active and either 
    // they're being removed or there are some to remove
    if (filterStats.tableFilterActive) {
        if (filterStats.tableFiltered > 0) {
            hasFilters = true;
            statsList.innerHTML += `
                <li class="filter-stats-item">
                    <span class="filter-reason">Table filtered:</span>
                    <span class="filter-count">${filterStats.tableFiltered}</span>
                </li>
            `;
        }
    }
    
    // Cells outside the subset count as hidden too, so the total accounts
    // for every cell of the dataset
    const notInSubset = filterStats.notInSubset || 0;
    if (notInSubset > 0) {
        hasFilters = true;
        statsList.innerHTML += `
            <li class="filter-stats-item" title="Not loaded: outside the cell subset or its current part (Cells, above the panels)">
                <span class="filter-reason">${notInSubsetLabel(DataManager.getSubset())}:</span>
                <span class="filter-count">${notInSubset.toLocaleString('en-US')}</span>
            </li>
        `;
    }

    // Update total count and percentage
    const hidden = filterStats.filtered + notInSubset;
    const all = filterStats.total + notInSubset;
    const percentage = all > 0 ? Math.round((hidden / all) * 100) : 0;
    
    totalCount.textContent = `${hidden.toLocaleString('en-US')} (${percentage}%)`;
    
    // Show/hide the widget based on whether there are any filters
    if (hasFilters) {
        widget.classList.remove('hidden');
    } else {
        widget.classList.add('hidden');
    }
}

/**
 * Whether `data` is a complete load for the dataset that is loaded now.
 *
 * loadDataAndCreatePlot clears the series and rebuilds them asynchronously.
 * During a dataset switch a table reloads and fires tableChanged, and the
 * focus is re-resolved, while the plot's own reload is still in flight; the
 * incremental update those trigger then read `data.x` / `data.color` as null
 * (TypeError in createFilterMask / processCategories, caught, and a second
 * full redraw). Data is current only once a load has stamped it with the
 * dataset generation it was read under, and that generation is still live.
 * @param {Object} data - A plot panel's data cache
 * @returns {boolean}
 */
export function isPlotDataCurrent(data) {
    return !!(data && data.generation !== null && data.generation !== undefined
        && data.generation === DataManager.getDatasetGeneration()
        && data.x && data.y && data.x.values && data.y.values);
}

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
        colorScale: false,
        colorRange: false,
        styling: false,
        layout: false,
        filter: false 
    };
    
    // A large plot (large-plot.js) has no incremental updates: redraw it
    if (data && data.large) {
        refreshPlot();
        return;
    }

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

    // A reload is rebuilding the series (or they are from the previous
    // dataset): leave the plot to that reload, which draws current settings.
    if (!isPlotDataCurrent(data)) {
        return;
    }
    
    // Every Plotly edit in apply() goes to a copy of the figure, drawn once
    // at the end (utils/plotly-batch.js): one recalculation of the points
    // instead of one per restyle. A case only a full redraw can show throws
    // RefreshNeeded, so the batch is dropped instead of drawn first.
    const apply = async () => {
        const refreshPlot = () => { throw new RefreshNeeded(); };

        removeHighlight(plotContainer); // One trace less to take care of
        // back to data order: the updates below write arrays in data order
        await unsortTraces(plotContainer);

        // The axes as shown before this update, so hiding points can keep them
        const fl = plotContainer._fullLayout;
        const axesBefore = fl && fl.xaxis && fl.yaxis && Array.isArray(fl.xaxis.range) ? {
            auto: fl.xaxis.autorange !== false && fl.yaxis.autorange !== false,
            x: [...fl.xaxis.range], y: [...fl.yaxis.range]
        } : null;

        const is3D = plotContainer.data[0].type === 'scatter3d';
        const shouldBe3D = settings.z !== null;
        const isNumerical = data.colorType === 'numerical';
        const isCategorical = data.colorType === 'categorical';
        const entityType = data.entities
        const hasTableMask = data.tableFilterMask !== null && data.tableFilterMask?.length > 0;

        // Apply filtering using the shared functions from plot-make.js
        
        // First create the mask and get statistics - always run this to count NaNs
        const { indexMask, filterStats } = createFilterMask(data, settings);
        
        // Update the filter widget with statistics
        updateFilterWidget(plotContainer, filterStats);

        // Restate the panel's coverage. An incremental update changes what is
        // on screen, so a notice left over from the previous render would be
        // stale -- and a stale "all shown" is the same lie as no notice at all.
        const coverageUnit = entityType === 'genes' ? 'genes' : 'cells';
        // RECOMPUTED from the series now in `data`, not read from
        // `data.coverage` -- which is written only by the full render, so on
        // this path it described the PREVIOUS axis. Reading it here licensed a
        // suppression from the fresh axis while the sentence came from the
        // stale panel, and the user got a headline with no reason at all.
        const loaded = panelLoadCoverage(data, settings, coverageUnit);
        data.coverage = loaded;
        // Per AXIS, not per panel: only the series that loaded x can explain x.
        const liveCoverage = Coverage.merge([
            loaded,
            classifyFilterStats(filterStats, coverageUnit, {
                axisCoverage: {
                    x: data.x && data.x.coverage, y: data.y && data.y.coverage,
                    z: data.z && data.z.coverage
                }
            })
        ], coverageUnit);
        renderCoverageNotice(plotContainer, liveCoverage, coverageUnit);
        try {
            const relaid = withCoverageAnnotation(
                (plotContainer.layout || {}), liveCoverage
            );
            Plotly.relayout(plotContainer, { annotations: relaid.annotations });
        } catch (e) {
            console.warn('Could not restate coverage annotation on the plot:', e);
        }

        // FILTER-ONLY MODE: apply filtering updates only.
        if (updateOptions.filter) {
            
            // Get entity data using our helper function
            const entities = data[entityType];
            if (!entities) {
                console.warn("Entities data is not present, skipping filtering updates.");
            } else {
                // When filter==true and tableFilterMask exists, use it to further subset data
                // but only for the trace that is named "In table"
                if (hasTableMask && plotContainer.data && plotContainer.data.length > 1) {
                    // Find index of trace named "In table"
                    const tableTraceIndex = plotContainer.data.findIndex(trace => trace && trace.name != "Not in table");
                    
                    if (tableTraceIndex >= 0) {
                        // Apply both indexMask and tableFilterMask
                        const combinedMask = indexMask.map((keep, i) => keep && data.tableFilterMask[i]);
                        const filteredData = applyFilterMask(data, combinedMask);
                        
                        const update = {
                            x: [filteredData.x.values],
                            y: [filteredData.y.values],
                            'marker.color': [filteredData.color],
                            text: [filteredData[entityType]],
                            customdata: [filteredData.customdata]
                        };
                        
                        if (shouldBe3D && filteredData.z) {
                            update.z = [filteredData.z.values];
                        }
                        
                        // Only update the "In table" trace
                        Plotly.restyle(plotContainer, update, [tableTraceIndex]);
                    } else {
                        // If no "In table" trace found, try to find any trace that's not "Not in table"
                        const alternativeTraceIndex = plotContainer.data.findIndex(trace => trace && trace.name !== "Not in table");
                        
                        if (alternativeTraceIndex >= 0) {
                            // Apply both indexMask and tableFilterMask
                            const combinedMask = indexMask.map((keep, i) => keep && data.tableFilterMask[i]);
                            const filteredData = applyFilterMask(data, combinedMask);
                            
                            const update = {
                                x: [filteredData.x.values],
                                y: [filteredData.y.values],
                                'marker.color': [filteredData.color],
                                text: [filteredData[entityType]],
                                customdata: [filteredData.customdata]
                            };
                            
                            if (shouldBe3D && filteredData.z) {
                                update.z = [filteredData.z.values];
                            }
                            
                            // Update the alternative trace
                            Plotly.restyle(plotContainer, update, [alternativeTraceIndex]);
                        } else {
                            // If no suitable trace found, fall back to standard approach
                            const filteredData = applyFilterMask(data, indexMask);
                            
                            const update = {
                                x: [filteredData.x.values],
                                y: [filteredData.y.values],
                                'marker.color': [filteredData.color],
                                text: [filteredData[entityType]],
                                customdata: [filteredData.customdata]
                            };
                            
                            if (shouldBe3D && filteredData.z) {
                                update.z = [filteredData.z.values];
                            }
                            
                            Plotly.restyle(plotContainer, update, [0]);
                        }
                    }
                } else {
                    // Standard approach without table filtering
                    const filteredData = applyFilterMask(data, indexMask);
                    
                    const update = {
                        x: [filteredData.x.values],
                        y: [filteredData.y.values],
                        'marker.color': [filteredData.color],
                        text: [filteredData[entityType]],
                        customdata: [filteredData.customdata]
                    };
                    
                    if (shouldBe3D && filteredData.z) {
                        update.z = [filteredData.z.values];
                    }
                    
                    Plotly.restyle(plotContainer, update, [0]);
                }
            }
        }

        const hasMultipleTraces = plotContainer.data && plotContainer.data.length > 1;

        // Update POSITION data if required.
        const positionChange = updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis;
        if (positionChange) {
            // Recreate plot if switching between 2D and 3D.
            if (is3D !== shouldBe3D) {
                refreshPlot();
                return;
            }
            
            if (isCategorical || hasMultipleTraces) {
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
                        const entityNames = trace.customdata;
                        if (!entityNames || !entityNames.length) return;

                        // Map entity names back to indices for accessing coordinate data
                        const indices = entityNames.map(name => entities.indexOf(name)).filter(idx => idx !== -1);
                        if (!indices.length) return;

                        const update = {};
                        if (updateOptions.xAxis && data.x?.values) update.x = [indices.map(idx => data.x.values[idx])];
                        if (updateOptions.yAxis && data.y?.values) update.y = [indices.map(idx => data.y.values[idx])];
                        if (updateOptions.zAxis && data.z?.values && shouldBe3D) update.z = [indices.map(idx => data.z.values[idx])];
                        update.text = [entityNames];
                        update.customdata = [entityNames];

                        if (Object.keys(update).length > 0) {
                            Plotly.restyle(plotContainer, update, [i]);
                        }
                    });
                } catch (error) {
                    console.error("Error updating categorical trace positions:", error);
                    refreshPlot();
                    return;
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
                }
            }
        }
        
        // COLOR DATA UPDATES
        if (updateOptions.colors && data.color) {
            
            // When switching from categorical (multiple traces) to numerical (single trace)
            if (!isCategorical && hasMultipleTraces && !hasTableMask) {
                // Create a new single trace using the data object
                const newTrace = {
                    type: settings.z ? 'scatter3d' : 'scattergl',
                    mode: 'markers',
                    x: data.x.values,
                    y: data.y.values,
                    text: data[entityType],
                    customdata: data[entityType],
                    hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` +
                        (settings.z ? `<br>z: %{z}` : '') +
                        `<br>c: %{marker.color}<extra></extra>`,
                    marker: {
                        size: settings.pointSize,
                        opacity: settings.pointOpacity,
                        color: data.color,
                        colorscale: settings.colorScale,
                        reversescale: settings.colorReversed,
                        cmin: settings.colorMin !== null ? settings.colorMin : arrayMin(data.color.filter(v => !isNaN(v))),
                        cmax: settings.colorMax !== null ? settings.colorMax : arrayMax(data.color.filter(v => !isNaN(v))),
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
                
                // Process categories to create traces for each category, from
                // the same masked points as the full render: with Hide NaN on,
                // the points it counted as hidden must not be drawn under NA.
                const shownData = (settings.hideNaN || settings.hideOutliers)
                    ? applyFilterMask(data, indexMask) : data;
                const categoricalTraces = processCategories(settings, shownData, catValues, customColors);
                
                // Remove all existing traces
                while (plotContainer.data.length > 0) {
                    Plotly.deleteTraces(plotContainer, 0);
                }
                
                // Add new categorical traces
                Plotly.addTraces(plotContainer, categoricalTraces);
                
                // Update the legend title for categorical data
                Plotly.relayout(plotContainer, {
                    'legend.title.text': `${settings.color.type}.${settings.color.key}` + 
                                        (settings.color.column ? `.${settings.color.column}` : ''),
                    'legend.title.font': { 
                        size: settings.fontSize ? settings.fontSize + 2 : 14,
                        family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
                        color: settings.textColor || '#000000'
                    }
                });
                  
            } else if (isNumerical) {
              // Handle numerical coloring with table filtering
              const isTableFilterActive = settings.tableFilter && settings.tableFilter !== 'none' && data.tableEntities;
              
              // Special case: if we have table filtering active 
              if (isTableFilterActive) {
                const entityKey = data.entities;
                const entities = data[entityKey];
                
                // Split into table and non-table indices
                const tableIndices = [];
                const nonTableIndices = [];
                
                entities.forEach((entity, i) => {
                  if (data.tableEntities.has(entity)) {
                    tableIndices.push(i);
                  } else {
                    nonTableIndices.push(i);
                  }
                });
                
                // If one of the groups is empty, handle with standard approach
                if (tableIndices.length === 0 || (nonTableIndices.length === 0 && !settings.removeNonTableEntries)) {
                  // Fall back to standard numerical update
                  const update = {};
                  const applyMask = idx => !indexMask || indexMask[idx];
  
                  if (updateOptions.colors) {
                      update['marker.color'] = [data.color.filter((_, i) => applyMask(i))];
                  }
                  
                  if (updateOptions.colorScale || updateOptions.colors) {
                      update['marker.colorscale'] = settings.colorScale;
                      update['marker.reversescale'] = settings.colorReversed;
                  }
                  
                  if (settings.colorMin !== null && (updateOptions.colorRange || updateOptions.colors)) {
                      update['marker.cmin'] = settings.colorMin;
                  }
                  
                  if (settings.colorMax !== null && (updateOptions.colorRange || updateOptions.colors)) {
                      update['marker.cmax'] = settings.colorMax;
                  }
                  
                  if (Object.keys(update).length > 0) {
                      Plotly.restyle(plotContainer, update, [0]);
                  }
                } else {
                  // Create traces based on table filter settings
                  const traces = [];
                  
                  // Apply the filter mask only to the table entities
                  // For numerical coloring with multiple traces, we only want to apply filtering 
                  // (like outlier removal) to the "In table" trace
                  const tableFilteredIndices = tableIndices.filter(idx => {
                    // Only apply outlier and NaN filtering to table entities
                    let keepPoint = true;
                    
                    // Apply color NaN filtering if enabled
                    if (settings.hideNaN && (data.color[idx] === null || isNaN(data.color[idx]))) {
                      keepPoint = false;
                    }
                    
                    // Apply outlier filtering if enabled
                    if (keepPoint && settings.hideOutliers) {
                      const colorVal = data.color[idx];
                      if (colorVal !== null && !isNaN(colorVal)) {
                        const cmin = settings.colorMin ?? arrayMin(data.color.filter(v => !isNaN(v)));
                        const cmax = settings.colorMax ?? arrayMax(data.color.filter(v => !isNaN(v)));
                        if (colorVal < cmin || colorVal > cmax) {
                          keepPoint = false;
                        }
                      }
                    }
                    
                    return keepPoint;
                  });
                  
                  // First, add the "Not in table" trace if we're not removing non-table entries
                  if (!settings.removeNonTableEntries && nonTableIndices.length > 0) {
                    const nonTableTrace = {
                      type: settings.z ? 'scatter3d' : 'scattergl',
                      mode: 'markers',
                      name: 'Not in table',
                      text: nonTableIndices.map(i => entities[i]),
                      customdata: nonTableIndices.map(i => entities[i]),
                      hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                                    (settings.z ? `<br>z: %{z}` : '') + 
                                    `<extra></extra>`,
                      x: nonTableIndices.map(i => data.x.values[i]),
                      y: nonTableIndices.map(i => data.y.values[i]),
                      marker: {
                        size: settings.pointSize,
                        opacity: settings.pointOpacity,
                        color: 'rgba(180, 180, 180, 1.)',
                        showscale: false
                      },
                      // For numerical coloring, don't show in legend
                      showlegend: false
                    };
                    
                    // Add z-values for 3D plots
                    if (settings.z && data.z) {
                      nonTableTrace.z = nonTableIndices.map(i => data.z.values[i]);
                    }
                    
                    traces.push(nonTableTrace);
                  }
                  
                  // Then add the "In table" trace with filtered indices
                  if (tableFilteredIndices.length > 0) {
                    const tableTrace = {
                      type: settings.z ? 'scatter3d' : 'scattergl',
                      mode: 'markers',
                      name: 'In table',
                      text: tableFilteredIndices.map(i => entities[i]),
                      customdata: tableFilteredIndices.map(i => entities[i]),
                      hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                                    (settings.z ? `<br>z: %{z}` : '') + 
                                    `<br>c: %{marker.color}<extra></extra>`,
                      x: tableFilteredIndices.map(i => data.x.values[i]),
                      y: tableFilteredIndices.map(i => data.y.values[i]),
                      marker: {
                        size: settings.pointSize,
                        opacity: settings.pointOpacity,
                        color: tableFilteredIndices.map(i => data.color[i]),
                        colorscale: settings.colorScale,
                        reversescale: settings.colorReversed,
                        cmin: settings.colorMin !== null ? settings.colorMin : undefined,
                        cmax: settings.colorMax !== null ? settings.colorMax : undefined,
                        colorbar: {
                          title: {
                            text: `${settings.color.type}.${settings.color.key}` + 
                                  (settings.color.column ? `.${settings.color.column}` : ''),
                            side: 'right'
                          },
                          titleside: 'right'
                        },
                        showscale: true
                      },
                      showlegend: false
                    };
                    
                    // Add z-values for 3D plots
                    if (settings.z && data.z) {
                      tableTrace.z = tableFilteredIndices.map(i => data.z.values[i]);
                    }
                    
                    traces.push(tableTrace);
                  }
                  
                  // First remove all existing traces
                  while (plotContainer.data.length > 0) {
                    Plotly.deleteTraces(plotContainer, 0);
                  }
                  
                  // Add new traces - order matters for z-index (first traces are drawn on bottom)
                  Plotly.addTraces(plotContainer, traces);
                }
              } else {
                // Standard numerical update (no table filter or removing non-table entries)
                const update = {};
                const applyMask = idx => !indexMask || indexMask[idx];

                if (updateOptions.colors) {
                    update['marker.color'] = [data.color.filter((_, i) => applyMask(i))];
                }
                
                if (updateOptions.colorScale || updateOptions.colors) {
                    update['marker.colorscale'] = settings.colorScale;
                    update['marker.reversescale'] = settings.colorReversed;
                }
                
                if (settings.colorMin !== null && (updateOptions.colorRange || updateOptions.colors)) {
                    update['marker.cmin'] = settings.colorMin;
                }
                
                if (settings.colorMax !== null && (updateOptions.colorRange || updateOptions.colors)) {
                    update['marker.cmax'] = settings.colorMax;
                }
                
                if (Object.keys(update).length > 0) {
                    Plotly.restyle(plotContainer, update, [0]);
                }
              }
            } else if (data.colorType === 'constant') {
                // Handle constant color with table filtering
                const isTableFilterActive = settings.tableFilter && settings.tableFilter !== 'none' && data.tableEntities;
                
                // Special case: if we have table filtering active
                if (isTableFilterActive) {
                    const entityKey = data.entities;
                    const entities = data[entityKey];
                    
                    // Split into table and non-table indices
                    const tableIndices = [];
                    const nonTableIndices = [];
                    
                    entities.forEach((entity, i) => {
                        if (data.tableEntities.has(entity)) {
                            tableIndices.push(i);
                        } else {
                            nonTableIndices.push(i);
                        }
                    });
                    
                    // If one of the groups is empty, handle with standard approach
                    if (tableIndices.length === 0 || (nonTableIndices.length === 0 && !settings.removeNonTableEntries)) {
                        // Fall back to standard constant color update
                        const update = {};
                        update['marker.color'] = 'rgba(150, 150, 150, 1.0)';
                        update['marker.showscale'] = false;
                        update['showlegend'] = false;
                        
                        if (Object.keys(update).length > 0) {
                            Plotly.restyle(plotContainer, update, [0]);
                        }
                    } else {
                        // Create traces based on table filter settings
                        const traces = [];
                        
                        // First, add the "Not in table" trace if we're not removing non-table entries
                        if (!settings.removeNonTableEntries && nonTableIndices.length > 0) {
                            const nonTableTrace = {
                                type: settings.z ? 'scatter3d' : 'scattergl',
                                mode: 'markers',
                                name: 'Not in table',
                                text: nonTableIndices.map(i => entities[i]),
                                customdata: nonTableIndices.map(i => entities[i]),
                                hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                                            (settings.z ? `<br>z: %{z}` : '') + 
                                            `<extra></extra>`,
                                x: nonTableIndices.map(i => data.x.values[i]),
                                y: nonTableIndices.map(i => data.y.values[i]),
                                marker: {
                                    size: settings.pointSize,
                                    opacity: settings.pointOpacity,
                                    color: 'rgba(180, 180, 180, 1.)', // Lighter gray for non-table entities
                                    showscale: false
                                },
                                showlegend: true
                            };
                            
                            // Add z-values for 3D plots
                            if (settings.z && data.z) {
                                nonTableTrace.z = nonTableIndices.map(i => data.z.values[i]);
                            }
                            
                            traces.push(nonTableTrace);
                        }
                        
                        // Then add the "In table" trace with table indices
                        // For constant color, we don't need to apply outlier filtering
                        if (tableIndices.length > 0) {
                            const tableTrace = {
                                type: settings.z ? 'scatter3d' : 'scattergl',
                                mode: 'markers',
                                name: 'In table',
                                text: tableIndices.map(i => entities[i]),
                                customdata: tableIndices.map(i => entities[i]),
                                hovertemplate: `%{text}<br>x: %{x}<br>y: %{y}` + 
                                            (settings.z ? `<br>z: %{z}` : '') + 
                                            `<extra></extra>`,
                                x: tableIndices.map(i => data.x.values[i]),
                                y: tableIndices.map(i => data.y.values[i]),
                                marker: {
                                    size: settings.pointSize,
                                    opacity: settings.pointOpacity,
                                    color: 'rgba(100, 100, 100, 0.7)', // Standard gray for table entities
                                    showscale: false
                                },
                                showlegend: false
                            };
                            
                            // Add z-values for 3D plots
                            if (settings.z && data.z) {
                                tableTrace.z = tableIndices.map(i => data.z.values[i]);
                            }
                            
                            traces.push(tableTrace);
                        }
                        
                        // First remove all existing traces
                        while (plotContainer.data.length > 0) {
                            Plotly.deleteTraces(plotContainer, 0);
                        }
                        
                        // Add new traces - order matters for z-index (first traces are drawn on bottom)
                        Plotly.addTraces(plotContainer, traces);
                    }
                } else {
                    // Standard constant color update (no table filter or removing non-table entries)
                    const update = {};
                    update['marker.color'] = 'rgba(150, 150, 150, 1.0)';
                    update['marker.showscale'] = false;
                    update['showlegend'] = false;
                    
                    if (Object.keys(update).length > 0) {
                        Plotly.restyle(plotContainer, update, [0]);
                    }
                }
            } else {
                refreshPlot();
                return;
            }
        }

        // Filtering removed or restored points: keep the axes on all points
        if (updateOptions.filter) {
            const pinned = stableAxisRanges(data, settings);
            // Hiding switched on while the axes were auto-fitted to all points:
            // keep exactly those ranges (no jump from a different padding)
            if (pinned && pinned['xaxis.range'] && axesBefore && axesBefore.auto) {
                pinned['xaxis.range'] = axesBefore.x;
                pinned['yaxis.range'] = axesBefore.y;
            }
            if (pinned) {
                // awaited: the highlight below snapshots the layout and puts it
                // back, which would otherwise undo this
                try {
                    await Plotly.relayout(plotContainer, pinned);
                } catch (err) {
                    console.warn('Axis range update skipped:', err && err.message);
                }
            }
        }

        // hover labels for whatever traces the update left
        await applyHoverInfo(plotContainer, data, settings);
        await applyLogColorbar(plotContainer, data, settings);
        await sortTracesByColor(plotContainer, settings);

        // bring back the focused entity if enabled
        highlightFocusedEntity(plotContainer, data, settings, entityType);
        
        // STYLING UPDATES (e.g., point size and opacity)
        if (updateOptions.styling) {
            const update = {
                'marker.size': settings.pointSize,
                'marker.opacity': settings.pointOpacity
            };
            
            const dataTraceIndices = plotContainer.data
                .map((trace, i) => (trace && !isLegendProxy(trace)
                    && trace.name !== `Focused ${entityType === 'cells' ? 'Cell' : 'Gene'}` ? i : -1))
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
                            font: { 
                                size: settings.fontSize ? settings.fontSize + 2 : 14,
                                family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
                                color: settings.textColor || '#000000'
                            }
                        },
                        titleside: 'right'
                    };
                    const restyleUpdate = {
                        'marker.colorbar': colorbar,
                        'marker.showscale': true,
                        'showlegend': false
                    };
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                } else if (data.colorType === 'categorical') {
                    // Update the legend title for categorical data
                    Plotly.relayout(plotContainer, {
                        'legend.title.text': `${settings.color.type}.${settings.color.key}` + 
                                           (settings.color.column ? `.${settings.color.column}` : ''),
                        'legend.title.font': { 
                            size: settings.fontSize ? settings.fontSize + 2 : 14,
                            family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
                            color: settings.textColor || '#000000'
                        }
                    });
                } else if (settings.color.type === 'none' || data.colorType === 'constant') {
                    const restyleUpdate = {
                        'marker.showscale': false,
                        'showlegend': false
                    };
                    Plotly.restyle(plotContainer, restyleUpdate, [0]);
                }
            }
        }

        applyAllAestheticSettings(plotContainer, settings);
    };

    try {
        await withPlotlyBatch(plotContainer, apply);
    } catch (error) {
        if (!(error instanceof RefreshNeeded)) {
            console.error("Error updating plot:", error);
            console.log("Falling back to recreating the plot");
        }
        refreshPlot();
    }
}

/** Thrown inside updatePlotElements' batch when only a full redraw can show the update. */
class RefreshNeeded extends Error {}


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
    if (data && data.large) {
        refreshPlot();
        return;
    }
    try {
        // Load only color data using the imported loadAxisData, passing the plotContainer
        // to show loading indicators during color data loading
        const colorData = await loadAxisData(settings.color, data.entities, plotContainer);

        if (colorData && colorData.values) {
            // Update the data cache with new color information.
            data.color = colorData.values;
            data.colorType = colorData.type;
            applyLogColor(data, settings);
            data.colorCategories = colorData.categories;
            // Colour DESCRIBES the points (see ROLE). Without this the panel
            // kept announcing the PREVIOUS colour column's coverage -- and, on
            // a refocus, said nothing about a varp/obsp/layer row that came back
            // all blank for the newly focused entity (settylab/annzarro#40).
            data.colorCoverage = colorData.coverage
                ? colorData.coverage.asDescribing()
                : null;

            // Update UI controls within the container.
            updateColorControlsVisibility(container, data.colorType, id);
            updateColorSliderUI(container, data, settings, id);

            // Use the centralized update system to update plot elements.
            const options = {
                colors: true,
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
 * One line on a cell plot whose focused cell the subset does not show: it is
 * focused, its rows are read, but it is not a point here. Not a coverage gap
 * (no shown point is missing) and not counted as a removed point. Shown when
 * highlighting is on, and always in large-plot mode, which draws no marker.
 * @param {HTMLElement} plotContainer
 * @param {Object} data - the plot's data ({cells, large?})
 * @param {Object} settings
 * @param {string|null} entityType
 */
export function noteFocusOutside(plotContainer, data, settings, entityType = null) {
  if (!plotContainer || !data || (entityType || data.entities) !== 'cells') return;
  const clear = () => renderModeNotice(plotContainer, null, 'notice', 'focus');
  const name = DataManager.getFocusedCell();
  if (!name || !(settings.highlightFocusedCell || data.large)) return clear();
  const cells = data.cells;
  if (cells && typeof cells.indexOf === 'function' && cells.indexOf(name) >= 0) return clear();
  DataManager.locateCell(name).then(cell => {
    if (DataManager.getFocusedCell() !== name || !plotContainer.isConnected) return;
    const outside = cell && !cell.shown && cell.row !== null;
    renderModeNotice(plotContainer, outside ? `Focused cell ${name} is not among the shown cells` : null,
                     'notice', 'focus');
  }).catch(() => {});
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
  noteFocusOutside(plotContainer, data, settings, entityType);
  // A large plot (large-plot.js) draws no focused-cell marker
  if (data && data.large) return;
  // Capture current view state before making changes
  let currentLayout = null;
  let newXTitle = `${settings.x.type}.${settings.x.key}${settings.x.column ? `.${settings.x.column}` : ''}`;
  let newYTitle = `${settings.y.type}.${settings.y.key}${settings.y.column ? `.${settings.y.column}` : ''}`;
  if (plotContainer && plotContainer.layout) {
    // Store current view state as a deep copy
    currentLayout = JSON.parse(JSON.stringify(plotContainer.layout));
  }

  // Determine which property to use: cells or genes.
  entityType = entityType || data.entities
  if (!plotContainer || !data || !data[entityType] || !data.x || !data.y ||
      !data.x.values || !data.y.values) {
    console.warn(`Missing required data for highlighting ${entityType}`);
    return;
  }

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
    // a cell the subset does not show: noteFocusOutside says so
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
  
  // Plotly reports a degenerate plot area (a panel squeezed to nothing,
  // e.g. while a restored layout is still sizing itself) by THROWING from
  // update/relayout, synchronously or from the returned promise. Inside a
  // focus-change handler that surfaced as an unhandled promise rejection on
  // every focus change. The highlight is cosmetic: log it and move on; the
  // next resize or focus change redraws it.
  const settle = (what, run) => Promise.resolve()
    .then(run)
    .catch(error => console.warn(`Focused-${entityType === 'cells' ? 'cell' : 'gene'} highlight ${what} skipped:`, error && error.message ? error.message : error));

  if (existingIdx >= 0) {
    // Move the existing highlight marker. restyle touches only that trace;
    // the layout is unchanged, so it is not re-sent (re-sending a deep copy
    // of it is what made Plotly redo the axis scaling here).
    const update = { x: [highlightTrace.x], y: [highlightTrace.y] };
    if (is3D) update.z = [highlightTrace.z];
    return settle('update', () => Plotly.restyle(plotContainer, update, [existingIdx]));
  }

  // A second call while the first add is still in flight would see no
  // highlight trace either and add another one (seen after a restore: two
  // 'Focused Cell' traces). Wait for that add, then move its marker.
  if (plotContainer.__focusHighlightAdding) {
    return plotContainer.__focusHighlightAdding
      .then(() => highlightFocusedEntity(plotContainer, data, settings, entityType));
  }

  // No highlight trace yet: add one, then put back the view the user had
  // (adding a trace must not reset zoom), with the configured axis titles.
  const adding = settle('add', () => Plotly.addTraces(plotContainer, highlightTrace).then(() => {
    if (!currentLayout) return undefined;
    // Put back only the VIEW (zoom, camera) and the axis titles. Re-sending
    // the whole layout snapshot taken before the add undid any layout change
    // made meanwhile, e.g. the legend moved off the colour bar.
    const restore = {};
    for (const axis of ['xaxis', 'yaxis']) {
      const ax = currentLayout[axis];
      if (!ax) continue;
      if (Array.isArray(ax.range)) restore[`${axis}.range`] = ax.range;
      if (ax.autorange !== undefined) restore[`${axis}.autorange`] = ax.autorange;
      if (ax.title) restore[`${axis}.title.text`] = settings.showAxisTitles ? (axis === 'xaxis' ? newXTitle : newYTitle) : "";
    }
    if (currentLayout.scene && currentLayout.scene.camera) restore['scene.camera'] = currentLayout.scene.camera;
    return Object.keys(restore).length ? Plotly.relayout(plotContainer, restore) : undefined;
  })).finally(() => {
    if (plotContainer.__focusHighlightAdding === adding) plotContainer.__focusHighlightAdding = null;
  });
  plotContainer.__focusHighlightAdding = adding;
  return adding;
}


/**
 * Apply the point size and opacity to an existing plot in at most two restyles.
 *
 * The slider path used to run updatePlotElements({styling: true}), which
 * removes and re-adds the focus highlight trace and re-applies every
 * aesthetic setting: ~38 Plotly calls and ~320 ms per slider step on
 * bm_aging. Size and opacity need none of that: they are marker properties
 * of the data traces, plus the highlight's size (always twice the points).
 *
 * @param {HTMLElement} plotContainer - The Plotly plot.
 * @param {Object} settings - Plot settings (pointSize, pointOpacity).
 * @returns {Promise<void>} Resolves once Plotly has applied both restyles.
 */
export async function restyleMarkers(plotContainer, settings) {
    if (!plotContainer || !Array.isArray(plotContainer.data) || plotContainer.data.length === 0) return;
    const isHighlight = (trace) => trace && typeof trace.name === 'string'
        && /^focused (cell|gene)$/i.test(trace.name.trim());
    const dataIdx = [];
    const highlightIdx = [];
    plotContainer.data.forEach((trace, i) => {
        if (isLegendProxy(trace)) return;   // legend entries stay at full opacity
        (isHighlight(trace) ? highlightIdx : dataIdx).push(i);
    });
    if (dataIdx.length) {
        await Plotly.restyle(plotContainer,
            { 'marker.size': settings.pointSize, 'marker.opacity': settings.pointOpacity }, dataIdx);
    }
    if (highlightIdx.length) {
        await Plotly.restyle(plotContainer, { 'marker.size': settings.pointSize * 2 }, highlightIdx);
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
    const refocusButton = controlsContainer.querySelector(`.axis-refocus-btn[data-axis="${axis}"]`);
  
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


/**
 * Updates a plot when a table filter has changed
 * @param {HTMLElement} plotContainer - The plot container
 * @param {Object} data - The data object
 * @param {Object} settings - The settings object 
 * @param {Function} refreshPlot - Function to refresh the plot
 * @returns {Promise<void>} - Promise that resolves when update is complete
 */
export async function updatePlotOnTableChange(plotContainer, data, settings, refreshPlot) {
  console.log(`Updating plot after table change with filter: ${settings.tableFilter || 'none'}`);
  
  // Use the new updateTableEntities function to efficiently update table entities
  const tableEntitiesChanged = await updateTableEntities(data, settings);
  
  // If table entities didn't change, no need to update the plot
  if (!tableEntitiesChanged) {
    console.log("Table entities unchanged, no plot update needed");
    return Promise.resolve();
  }
  
  console.log("Table entities changed, updating plot");
  
  // First only update color since this may resplit the trace"
  return updatePlotElements(plotContainer, data, settings, refreshPlot, { 
    filter: true, // Always apply filtering when table entities change 
    colors: true,  // Always update colors for table filtering (handles graying out)
    colorRange: true, // Update color range if needed
  });
}