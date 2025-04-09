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
  
  // Check for required elements and data
  if (!_plotContainer || !_plotContainer.parentNode) {
      console.warn("Plot container doesn't exist or is not in the DOM, cannot update");
      return;
  }
  
  // Ensure the plot container is valid
  if (_plotContainer.innerHTML === '') {
      console.warn("Plot container is empty, recreating plot");
      _loadDataAndCreatePlot();
      return;
  }
  
  // If plot doesn't exist, create it
  if (!_plot || !_plot.data) {
      console.warn("Plot doesn't exist yet, creating it instead of updating");
      _loadDataAndCreatePlot();
      return;
  }
  
  try {
      const is3D = _plot.data[0].type === 'scatter3d';
      const shouldBe3D = _settings.z !== null;
      const isNumerical = _data.colorType === 'numerical';
      const isCategorical = _data.colorType === 'categorical';
      const hasMultipleTraces = _plot.data && _plot.data.length > 1;

      let indexMask = null;
      if (_settings.hideOutliers && isNumerical && _data.color) {
          const cmin = _settings.colorMin !== null ? _settings.colorMin : Math.min(..._data.color);
          const cmax = _settings.colorMax !== null ? _settings.colorMax : Math.max(..._data.color);
          indexMask = _data.color.map((v) => v >= cmin && v <= cmax);
      }

      // FILTER-ONLY MODE: Just apply filtering
      if (updateOptions.filter) {
          let filteredX, filteredY, filteredZ, filteredColor, filteredText, filteredCustom;

          if (indexMask) {
              filteredX = _data.x.values.filter((_, i) => indexMask[i]);
              filteredY = _data.y.values.filter((_, i) => indexMask[i]);
              filteredZ = _settings.z && _data.z ? _data.z.values.filter((_, i) => indexMask[i]) : undefined;
              filteredColor = _data.color.filter((_, i) => indexMask[i]);
              filteredText = _data.cells.filter((_, i) => indexMask[i]);
              filteredCustom = _data.cells.map((_, i) => i).filter((_, i) => indexMask[i]);
          } else {
              filteredX = _data.x.values;
              filteredY = _data.y.values;
              filteredZ = _settings.z && _data.z ? _data.z.values : undefined;
              filteredColor = _data.color;
              filteredText = _data.cells;
              filteredCustom = _data.cells.map((_, i) => i);
          }

          const update = {
              x: [filteredX],
              y: [filteredY],
              'marker.color': [filteredColor],
              text: [filteredText],
              customdata: [filteredCustom]
          };
          if (shouldBe3D && filteredZ) update.z = [filteredZ];

          console.log("Applying filtering-only update", update);
          Plotly.restyle(_plotContainer, update, [0]);
      }
      // POSITION DATA UPDATES (most significant changes)
      // If position axes data change is needed, check if we need a full redraw
      const positionChange = updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis;
      
      if (positionChange) {
          // Check if we're switching between 2D and 3D - always need complete redraw
          if (is3D !== shouldBe3D) {
              console.log("Switching between 2D and 3D plot types - recreating plot");
              _loadDataAndCreatePlot();
              return;
          }
          
          if (isCategorical && hasMultipleTraces) {
              // Handle position updates for categorical data with multiple traces
              console.log("Updating positions for categorical data with multiple traces");
              
              try {
                  // For each trace/category, update the positions
                  _plot.data.forEach((trace, i) => {
                      // Skip non-marker traces (like highlight traces)
                      if (trace.mode !== 'markers') return;
                  
                      const indices = trace.customdata;
                      if (!indices || !indices.length) return;

                      const update = {};
                      if (updateOptions.xAxis && _data.x?.values) update.x = [indices.map(idx => _data.x.values[idx])];
                      if (updateOptions.yAxis && _data.y?.values) update.y = [indices.map(idx => _data.y.values[idx])];
                      if (updateOptions.zAxis && _data.z?.values && shouldBe3D) update.z = [indices.map(idx => _data.z.values[idx])];
                      if (_data.cells) {
                          update.text = [indices.map(idx => _data.cells[idx])];
                          update.customdata = [indices];
                      }

                      if (Object.keys(update).length > 0) {
                          console.log(`Updating trace ${i} positions:`, update);
                          Plotly.restyle(_plotContainer, update, [i]);
                      }
                  });
              } catch (error) {
                  console.error("Error updating categorical trace positions:", error);
                  // Fallback to recreating the plot if there's an error
                  _loadDataAndCreatePlot();
                  return;
              }
              
              // Update highlighted cell if needed
              if (_settings.highlightFocusedCell) {
                  // Remove and re-add highlight to ensure it's updated with new positions
                  _removeHighlight();
                  _highlightFocusedCell();
              }
          } else {
              // Standard position update for single trace (numerical data)
              const update = {};
              const applyMask = idx => !indexMask || indexMask[idx];

              const fx = updateOptions.xAxis ? _data.x.values.filter((_, i) => applyMask(i)) : null;
              const fy = updateOptions.yAxis ? _data.y.values.filter((_, i) => applyMask(i)) : null;
              const fz = updateOptions.zAxis && _data.z?.values && shouldBe3D ? _data.z.values.filter((_, i) => applyMask(i)) : null;

              if (fx) update.x = [fx];
              if (fy) update.y = [fy];
              if (fz) update.z = [fz];

              if (Object.keys(update).length > 0) {
                  console.log("Updating position data:", update);
                  Plotly.restyle(_plotContainer, update, [0]);
                  if (_settings.highlightFocusedCell) {
                      _removeHighlight();
                      _highlightFocusedCell();
                  }
              }
          }
      }
      
      // COLOR DATA UPDATES
      if (updateOptions.colors && _data.color) {
          // Store current focused cell state to restore it later if needed
          let hasFocusedCell = false;
          if (_settings.highlightFocusedCell) {
              // Temporarily remove highlight before updating colors
              _removeHighlight();
              hasFocusedCell = true;
          }
          // check if still multiple without the highlighted cell trace
          const hasStillMultipleTraces = _plot.data && _plot.data.length > 1;
          
          // Only check categorical vs. numerical transitions when we're actually 
          // changing the color data, not just updating ranges
          if (updateOptions.colorData) {
              // If changing between categorical and numerical, we need a complete recreation
              if ((isCategorical && !hasStillMultipleTraces) || (!isCategorical && hasStillMultipleTraces)) {
                  console.log("Switching between categorical and numerical coloring - recreating plot");
                  _loadDataAndCreatePlot();
                  return;
              }
          }
          
          // For categorical coloring, we need to recreate as we use multiple traces
          // But only when we're actually changing color data
          if (isCategorical && updateOptions.colorData) {
              console.log("Categorical coloring requires recreating the plot");
              _loadDataAndCreatePlot();
              return;
          }
          
          // For numerical data with many NaN values, recreation is safer
          if (isNumerical && _data.color && _data.color.length > 0) {
              
              // Check what specific color properties need updating
              // This allows for more targeted updates
              const update = {};
              const applyMask = idx => !indexMask || indexMask[idx];
              
              // Only include the full color array if the actual data changed
              // This prevents unnecessary data transfer during slider interactions
              if (updateOptions.colorData) {
                  update['marker.color'] = [_data.color.filter((_, i) => applyMask(i))];
              }
              
              // Include colorscale if specified or if color data changed
              if (updateOptions.colorScale || updateOptions.colorData) {
                  update['marker.colorscale'] = _settings.colorScale;
                  update['marker.reversescale'] = _settings.colorReversed;
              }
              
              // Add color range if specified
              if (_settings.colorMin !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                  update['marker.cmin'] = _settings.colorMin;
              }
              
              if (_settings.colorMax !== null && (updateOptions.colorRange || updateOptions.colorData)) {
                  update['marker.cmax'] = _settings.colorMax;
              }
              
              // Enable colorbar and disable legend
              update['marker.showscale'] = true;
              update['showlegend'] = false;
              
              // Only apply updates if there's something to update
              if (Object.keys(update).length > 0) {
                  // Apply color updates
                  Plotly.restyle(_plotContainer, update, [0]);
              }
          } else if (_data.colorType === 'constant') {
              const update = {};
              
              // Only include the full color array if the actual data changed
              // This prevents unnecessary data transfer during slider interactions
              if (updateOptions.colorData) {
                  update['marker.color'] = 'rgba(150, 150, 150, 0.7)';
              }
              
              // Disable both the colorbar and the legend
              update['marker.showscale'] = false;
              update['showlegend'] = false;
              
              // Only apply updates if there's something to update
              if (Object.keys(update).length > 0) {
                  // Apply color updates
                  Plotly.restyle(_plotContainer, update, [0]);
              }
          }
          
          // Re-add highlighted point if we temporarily removed it
          if (hasFocusedCell) {
              _highlightFocusedCell();
          }
      }
      
      // STYLING UPDATES (size, opacity)
      if (updateOptions.styling) {
      
          const update = {
              'marker.size': _settings.pointSize,
              'marker.opacity': _settings.pointOpacity
          };
      
          // Get indices for all traces except the one named "Focused Cell"
          const dataTraceIndices = _plot.data
              .map((trace, i) => (trace && trace.name !== 'Focused Cell' ? i : -1))
              .filter(i => i !== -1);
      
          if (dataTraceIndices.length > 0) {
              Plotly.restyle(_plotContainer, update, dataTraceIndices);
          }
      
          // Find the index of the highlight trace (if it exists)
          const highlightIndex = _plot.data.findIndex(trace => trace && trace.name === 'Focused Cell');
          if (highlightIndex >= 0) {
              Plotly.restyle(_plotContainer, {
                  'marker.size': _settings.pointSize * 2  // Always 2x the current point size
              }, [highlightIndex]);
          }
      }
      
      // OTHER LAYOUT UPDATES
      if (updateOptions.layout) {
          console.log("Updating layout properties");
          
          // Check if we have a valid plot and container for layout updates
          if (!_plot || !_plot.data || !_plot.data[0] || !_plotContainer) {
              console.warn("Unable to update layout: plot or container is not valid");
              return;
          }
          
          // Axis title updates (layout-level)
          const layoutUpdate = {};
          const is3D = _plot.data[0].type === 'scatter3d';
          
          if (_settings && _settings.x && _settings.x.type && _settings.x.key) {
              const xAxisTitle = `${_settings.x.type}.${_settings.x.key}${_settings.x.column ? `.${_settings.x.column}` : ''}`;
              if (is3D) {
                  layoutUpdate['scene.xaxis.title'] = xAxisTitle;
              } else {
                  layoutUpdate['xaxis.title'] = xAxisTitle;
              }
          }
          
          if (_settings && _settings.y && _settings.y.type && _settings.y.key) {
              const yAxisTitle = `${_settings.y.type}.${_settings.y.key}${_settings.y.column ? `.${_settings.y.column}` : ''}`;
              if (is3D) {
                  layoutUpdate['scene.yaxis.title'] = yAxisTitle;
              } else {
                  layoutUpdate['yaxis.title'] = yAxisTitle;
              }
          }
          
          if (is3D && _settings && _settings.z && _settings.z.type && _settings.z.key) {
              const zAxisTitle = `${_settings.z.type}.${_settings.z.key}${_settings.z.column ? `.${_settings.z.column}` : ''}`;
              layoutUpdate['scene.zaxis.title'] = zAxisTitle;
          }
          
          if (Object.keys(layoutUpdate).length > 0) {
              console.log("Applying layout updates:", layoutUpdate);
              Plotly.relayout(_plotContainer, layoutUpdate);
          }
          
          // Marker (trace) updates for colorbar need to be applied with Plotly.restyle
          if (_settings && _settings.color && _settings.color.type && _settings.color.key) {
              if (_data.colorType === 'numerical') {
                  const colorbar = {
                      title: {
                          text: `${_settings.color.type}.${_settings.color.key}` +
                                (_settings.color.column ? `.${_settings.color.column}` : ''),
                          side: 'right',  // Title appears on the right side of the colorbar
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
                  // Here, update the first trace (or adjust trace indices as needed)
                  Plotly.restyle(_plotContainer, restyleUpdate, [0]);
              } else if (_settings.color.type === 'none' || _data.colorType === 'constant') {
                  const restyleUpdate = {
                      'marker.showscale': false,
                      'showlegend': false
                  };
                  console.log("Applying colorbar restyle updates:", restyleUpdate);
                  Plotly.restyle(_plotContainer, restyleUpdate, [0]);
              }
          }
      }
      
      // Update highlighted cell if data position has changed
      if (_settings.highlightFocusedCell && 
          (updateOptions.xAxis || updateOptions.yAxis || updateOptions.zAxis)) {
          _removeHighlight();
          _highlightFocusedCell();
      }
      
      
  } catch (error) {
      console.error("Error updating plot:", error);
      console.log("Falling back to recreating the plot");
      _loadDataAndCreatePlot();
  }
}