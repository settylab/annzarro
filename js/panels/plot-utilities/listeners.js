import { populateKeySelector, populateColumnSelector, updateColorSliderUI } from './panel-ui-update.js';
import { loadAxisData } from './plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot, highlightFocusedEntity, removeHighlight } from './plot-update.js';
import { DataManager } from '../../data-manager.js';

export function setupPlotEventListeners({
    container,
    plotContainer,
    controlsContainer,
    settings,
    plotType,
    data,
    id,
    loadDataAndCreatePlot
  }) {

    const observer = setupResizeObserver(plotContainer);
    
    // Set up other listeners immediately
    setupAxisSelectorListeners(
        container,
        plotContainer,
        settings,
        plotType,
        data,
        id,
        loadDataAndCreatePlot);

    setupPlotControlListeners(
        container,
        settings,
        plotContainer,
        plotType,
        data,
        id,
        loadDataAndCreatePlot,
        updatePlotElements,
        controlsContainer
    )
    setupColorControls(
        container,
        settings,
        data,
        plotContainer,
        id,
        loadDataAndCreatePlot,
    );

    return observer;
}


/**
 * Sets up a ResizeObserver to autosize a Plotly plot when its container resizes.
 * @param {HTMLElement} plotContainer - The DOM element containing the plot.
 * @returns {ResizeObserver|null} - The created ResizeObserver instance or null if not supported.
 */
export function setupResizeObserver(plotContainer) {
    // Add detailed debugging to identify the specific issue
    if (!plotContainer) {
      console.warn('ResizeObserver setup failed: plot container is null or undefined');
      return null;
    }
    
    if (!window.ResizeObserver) {
      console.warn('ResizeObserver setup failed: ResizeObserver API not supported by browser');
      return null;
    }
  
    let resizeTimeout = null;
  
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === plotContainer) {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            Plotly.relayout(plotContainer, { autosize: true });
          }, 10); // debounce
        }
      }
    });
  
    observer.observe(plotContainer);
    return observer;
}


/**
 * Sets up plot control listeners (e.g., 3D toggle, point size/opacity sliders, grid toggle,
 * highlight focused cell toggle, refresh plot, lock range) inside the provided container.
 *
 * @param {HTMLElement} container - The container element for the control UI.
 * @param {Object} settings - Plot settings (e.g., settings.z, pointSize, pointOpacity,
 *                            showGrid, highlightFocusedCell, lockColorRange, etc.).
 * @param {HTMLElement} plotContainer - The Plotly plot container element.
 * @param {Object} data - Data cache object (e.g., { x, y, z, color, cells, colorType, … }).
 * @param {string|number} id - Unique identifier to build element selectors.
 * @param {Function} loadDataAndCreatePlot - Function to recreate the entire plot.
 * @param {Function} updatePlotElements - Function to update plot properties.
 * @param {Object} controlsContainer - An object containing.
 */
export function setupPlotControlListeners(
    container,
    settings,
    plotContainer,
    plotType,
    data,
    id,
    loadDataAndCreatePlot,
    updatePlotElements,
    controlsContainer
  ) {
    // --- 3D Plot Toggle ---
    const zAxisToggle = container.querySelector(`#z-axis-toggle-${id}`);
    const zAxisContainer = container.querySelector(`#z-axis-container-${id}`);
    zAxisToggle.addEventListener('click', async () => {
      const is3D = zAxisToggle.classList.contains('active');
      if (is3D) {
        // Disable 3D: reset classes, hide 3D controls, update settings
        zAxisToggle.classList.remove('active', 'btn-primary');
        zAxisToggle.classList.add('btn-outline-secondary');
        zAxisToggle.setAttribute('title', 'Enable 3D plot');
        if (zAxisContainer) {
          zAxisContainer.style.display = 'none';
        }
        settings.z = null;
        loadDataAndCreatePlot();
      } else {
        // Enable 3D: change button appearance, show controls
        zAxisToggle.classList.add('active', 'btn-primary');
        zAxisToggle.classList.remove('btn-outline-secondary');
        zAxisToggle.setAttribute('title', '3rd dimension active - click to disable');
        if (zAxisContainer) {
          zAxisContainer.style.display = 'block';
        }
        if (!settings.z) {
          const yKey = settings.y?.key || '';
          let zColumn = '2';
          const datasetStructure = await DataManager.getDatasetStructure();
          const df = plotType === 'genes' 
            ? datasetStructure?.varm?.dataframes?.[yKey] 
            : datasetStructure?.obsm?.dataframes?.[yKey];
          const yCol = settings.y?.column;
          if (df?.columns?.length) {
            const yIdx = df.columns.indexOf(yCol);
            if (yIdx !== -1 && yIdx + 1 < df.columns.length) {
              zColumn = df.columns[yIdx + 1];
            } else {
              zColumn = df.columns.at(-1); // fallback to last column
            }
          }
          settings.z = { type: plotType === 'genes' ? 'varm' : 'obsm', key: yKey, column: zColumn };
          // Call the axis selector setup helper from the controls object.
          if (typeof controlsContainer.setupAxisSelector === 'function') {
            controlsContainer.setupAxisSelector(container, 'z', settings.z, controlsContainer.plotType, datasetStructure);
          }
        }
        loadDataAndCreatePlot();
      }
    });
  
    // --- Point Size Slider ---
    const pointSizeSlider = container.querySelector(`#point-size-${id}`);
    pointSizeSlider.addEventListener('input', (e) => {
      const newSize = parseFloat(e.target.value);
      settings.pointSize = newSize;
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { styling: true });
    });
  
    // --- Point Opacity Slider ---
    const pointOpacitySlider = container.querySelector(`#point-opacity-${id}`);
    pointOpacitySlider.addEventListener('input', (e) => {
      const newOpacity = parseFloat(e.target.value);
      settings.pointOpacity = newOpacity;
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { styling: true });
    });
  
    // --- Show Grid Toggle ---
    const showGridToggle = container.querySelector(`#show-grid-${id}`);
    if (settings.showGrid) {
      showGridToggle.classList.add('active', 'btn-primary');
      showGridToggle.classList.remove('btn-outline-secondary');
    } else {
      showGridToggle.classList.remove('active', 'btn-primary');
      showGridToggle.classList.add('btn-outline-secondary');
    }
    showGridToggle.addEventListener('click', () => {
      settings.showGrid = !settings.showGrid;
      if (settings.showGrid) {
        showGridToggle.classList.add('active', 'btn-primary');
        showGridToggle.classList.remove('btn-outline-secondary');
      } else {
        showGridToggle.classList.remove('active', 'btn-primary');
        showGridToggle.classList.add('btn-outline-secondary');
      }
      if (plotContainer) {
        const update = {
          // 2D axes
          'xaxis.showgrid': settings.showGrid,
          'yaxis.showgrid': settings.showGrid,
          'xaxis.showline': settings.showGrid,
          'yaxis.showline': settings.showGrid,
          'xaxis.zeroline': settings.showGrid,
          'yaxis.zeroline': settings.showGrid,
          'xaxis.ticks': settings.showGrid ? '' : 'none',
          'yaxis.ticks': settings.showGrid ? '' : 'none',
          'xaxis.showticklabels': settings.showGrid,
          'yaxis.showticklabels': settings.showGrid,
        };
        // For 3D plots.
        if (settings.z) {
          Object.assign(update, {
            'scene.xaxis.showgrid': settings.showGrid,
            'scene.yaxis.showgrid': settings.showGrid,
            'scene.zaxis.showgrid': settings.showGrid,
            'scene.xaxis.showline': settings.showGrid,
            'scene.yaxis.showline': settings.showGrid,
            'scene.zaxis.showline': settings.showGrid,
            'scene.xaxis.zeroline': settings.showGrid,
            'scene.yaxis.zeroline': settings.showGrid,
            'scene.zaxis.zeroline': settings.showGrid,
            'scene.xaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.yaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.zaxis.ticks': settings.showGrid ? '' : 'none',
            'scene.xaxis.showticklabels': settings.showGrid,
            'scene.yaxis.showticklabels': settings.showGrid,
            'scene.zaxis.showticklabels': settings.showGrid,
          });
        }
        Plotly.relayout(plotContainer, update);
      }
    });
  
    // --- Highlight Focused Cell Toggle (conditional) ---
  const highlightFocusedCellToggle = container.querySelector(`#highlight-focused-cell-${id}`);
  if (highlightFocusedCellToggle) {
    if (settings.highlightFocusedCell) {
      highlightFocusedCellToggle.classList.add('active', 'btn-primary');
      highlightFocusedCellToggle.classList.remove('btn-outline-secondary');
    } else {
      highlightFocusedCellToggle.classList.remove('active', 'btn-primary');
      highlightFocusedCellToggle.classList.add('btn-outline-secondary');
    }
    highlightFocusedCellToggle.addEventListener('click', () => {
      settings.highlightFocusedCell = !settings.highlightFocusedCell;
      if (settings.highlightFocusedCell) {
        highlightFocusedCellToggle.classList.add('active', 'btn-primary');
        highlightFocusedCellToggle.classList.remove('btn-outline-secondary');
        highlightFocusedEntity(plotContainer, data, settings, 'cells');
      } else {
        highlightFocusedCellToggle.classList.remove('active', 'btn-primary');
        highlightFocusedCellToggle.classList.add('btn-outline-secondary');
        removeHighlight(plotContainer);
      }
    });
  }

  // --- Highlight Focused Gene Toggle (conditional) ---
  const highlightFocusedGeneToggle = container.querySelector(`#highlight-focused-gene-${id}`);
  if (highlightFocusedGeneToggle) {
    if (settings.highlightFocusedGene) {
      highlightFocusedGeneToggle.classList.add('active', 'btn-primary');
      highlightFocusedGeneToggle.classList.remove('btn-outline-secondary');
    } else {
      highlightFocusedGeneToggle.classList.remove('active', 'btn-primary');
      highlightFocusedGeneToggle.classList.add('btn-outline-secondary');
    }
    highlightFocusedGeneToggle.addEventListener('click', () => {
      settings.highlightFocusedGene = !settings.highlightFocusedGene;
      if (settings.highlightFocusedGene) {
        highlightFocusedGeneToggle.classList.add('active', 'btn-primary');
        highlightFocusedGeneToggle.classList.remove('btn-outline-secondary');
        highlightFocusedEntity(plotContainer, data, settings, 'genes');
      } else {
        highlightFocusedGeneToggle.classList.remove('active', 'btn-primary');
        highlightFocusedGeneToggle.classList.add('btn-outline-secondary');
        removeHighlight(plotContainer);
      }
    });
  }
  
    // --- Refresh Plot Button ---
    const refreshPlotButton = container.querySelector(`#refresh-plot-${id}`);
    refreshPlotButton.addEventListener('click', () => {
      if (plotContainer) {
        plotContainer.innerHTML = '<div class="alert alert-info">Refreshing plot...</div>';
      }
      loadDataAndCreatePlot();
    });
  
    // --- Lock Range Button ---
    const lockRangeButton = container.querySelector(`#lock-range-${id}`);
    if (settings.lockColorRange) {
      lockRangeButton.classList.add('active', 'btn-primary');
      lockRangeButton.classList.remove('btn-outline-secondary');
    } else {
      lockRangeButton.classList.remove('active', 'btn-primary');
      lockRangeButton.classList.add('btn-outline-secondary');
    }
    lockRangeButton.addEventListener('click', () => {
      settings.lockColorRange = !settings.lockColorRange;
      if (settings.lockColorRange) {
        lockRangeButton.classList.add('active', 'btn-primary');
        lockRangeButton.classList.remove('btn-outline-secondary');
      } else {
        lockRangeButton.classList.remove('active', 'btn-primary');
        lockRangeButton.classList.add('btn-outline-secondary');
      }
      // Optionally trigger a plot update if needed:
      updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, { colorRange: true });
    });
  }

/**
 * Set up color controls (e.g., color scale, opacity, color range inputs, centering, and outlier filtering)
 * for a plot. Uses elements inside the provided container.
 *
 * @param {HTMLElement} container - The root element containing the color controls.
 * @param {Object} settings - The plot settings object.
 * @param {Object} data - The data cache object (e.g. { x, y, z, color, cells, colorType, … }).
 * @param {HTMLElement} plotContainer - The element that holds the Plotly plot.
 * @param {string|number} id - Unique identifier used to form element selectors.
 * @param {Function} loadDataAndCreatePlot - Function to reload the entire plot.
 * @param {Function} updatePlot - Function to update the plot visuals (without recreating it).
 */
export function setupColorControls(
    container,
    settings,
    data,
    plotContainer,
    id,
    loadDataAndCreatePlot,
) {


    // helper closure to avoid passing all parameters
    function _updatePlotElements(options = {}) {
        updatePlotElements(plotContainer, data, settings, loadDataAndCreatePlot, options);
    }


     function _updatePlot(fullDataUpdate = false) {
        console.log(`Updating plot (fullDataUpdate=${fullDataUpdate})`);
        
        if (fullDataUpdate) {
            updateColorSliderUI(container, data, settings, id, plotContainer);
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
            updateColorSliderUI(container, data, settings, id, plotContainer);
            // For visual-only updates
            _updatePlotElements({
                styling: true,
                colors: settings.colorMin !== null || settings.colorMax !== null,
                colorRange: settings.colorMin !== null || settings.colorMax !== null,
                colorData: false // Don't update the actual color data array
            });
        }
    }

    // --- Color scale selector ---
    const colorScaleSelect = container.querySelector(`#color-scale-${id}`);
    colorScaleSelect.addEventListener('change', (e) => {
        const newColorScale = e.target.value;
        settings.colorScale = newColorScale;
        // For numerical data, update visual properties; categorical uses discrete colors so reload plot.
        if (data.colorType === 'numerical' && plotContainer) {
            _updatePlotElements({ colors: true, colorScale: true });
            console.log(`Updated colorscale to ${newColorScale} without redrawing`);
        } else {
            loadDataAndCreatePlot();
        }
    });

    // --- Category palette selector ---
    const categoryPaletteSelect = container.querySelector(`#category-palette-${id}`);
    categoryPaletteSelect.addEventListener('change', (e) => {
        settings.categoryPalette = e.currentTarget.value;
        if (plotContainer && data.colorType === 'categorical') {
            loadDataAndCreatePlot();
        }
    });

    // --- Color range inputs and sliders ---
    const colorMinInput = container.querySelector(`#color-min-${id}`);
    const colorMaxInput = container.querySelector(`#color-max-${id}`);
    const colorMinSlider = container.querySelector(`#color-min-slider-${id}`);
    const colorMaxSlider = container.querySelector(`#color-max-slider-${id}`);

    // Ensure centeringActive is defined.
    settings.centeringActive = settings.centeringActive || false;

    // Helper to update color range values without affecting slider UI
    function _updateColorRange(min, max, updateSliders = true, triggerPlotUpdate = true) {
        settings.colorMin = min !== '' ? parseFloat(min) : null;
        settings.colorMax = max !== '' ? parseFloat(max) : null;
        colorMinInput.value = settings.colorMin !== null ? settings.colorMin : '';
        colorMaxInput.value = settings.colorMax !== null ? settings.colorMax : '';

        if (updateSliders && data && data.color && Array.isArray(data.color)) {
            const validValues = data.color.filter((v) => !isNaN(v));
            const dataMin = Math.min(...validValues);
            const dataMax = Math.max(...validValues);
            colorMinSlider.value = settings.colorMin !== null ? settings.colorMin : dataMin;
            colorMaxSlider.value = settings.colorMax !== null ? settings.colorMax : dataMax;
        }

        if (triggerPlotUpdate) {
            _updatePlot(false); // false indicates "visual update only"
        }
    }

    colorMinInput.addEventListener('change', (e) => {
        const minValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
        _updateColorRange(minValue, settings.colorMax, true);
    });

    colorMaxInput.addEventListener('change', (e) => {
        const maxValue = e.target.value !== '' ? parseFloat(e.target.value) : null;
        _updateColorRange(settings.colorMin, maxValue, true);
    });

    // --- Direct slider update helper ---
    function updateColorRangeDirect(minOrMax, value) {
        if (!plotContainer || !plotContainer.data || !plotContainer.data[0] || !plotContainer.data[0].marker)
            return;
        const update = {};
        update[`marker.c${minOrMax}`] = value;
        Plotly.restyle(plotContainer, update, [0]);
    }

    // --- Hide outliers button ---
    const hideOutliersButton = container.querySelector(`#hide-outliers-${id}`);
    if (settings.hideOutliers) {
        hideOutliersButton.classList.add('active', 'btn-primary');
        hideOutliersButton.classList.remove('btn-outline-secondary');
    } else {
        hideOutliersButton.classList.remove('active', 'btn-primary');
        hideOutliersButton.classList.add('btn-outline-secondary');
    }
    hideOutliersButton.addEventListener('click', () => {
        settings.hideOutliers = !settings.hideOutliers;
        if (settings.hideOutliers) {
            hideOutliersButton.classList.add('active', 'btn-primary');
            hideOutliersButton.classList.remove('btn-outline-secondary');
        } else {
            hideOutliersButton.classList.remove('active', 'btn-primary');
            hideOutliersButton.classList.add('btn-outline-secondary');
        }
        _updatePlotElements({ filter: true });
    });

    // --- Min slider ---
    colorMinSlider.addEventListener('input', (e) => {
        const minValue = parseFloat(e.currentTarget.value);
        colorMinInput.value = minValue.toFixed(2);
        settings.colorMin = minValue;
        updateColorRangeDirect('min', minValue);
        _updatePlotElements({
            colors: true,
            colorRange: true,
            filter: settings.hideOutliers
        });
    });

    // --- Max slider ---
    colorMaxSlider.addEventListener('input', (e) => {
        const maxValue = parseFloat(e.currentTarget.value);
        colorMaxInput.value = maxValue.toFixed(2);
        settings.colorMax = maxValue;
        updateColorRangeDirect('max', maxValue);
        _updatePlotElements({
            colors: true,
            colorRange: true,
            filter: settings.hideOutliers
        });
    });

    // --- Centering and reverse colormap controls ---
    const centerColormapButton = container.querySelector(`#center-colormap-${id}`);
    centerColormapButton.addEventListener('click', () => {
        settings.centeringActive = !settings.centeringActive;
        setupCenteringSliderListeners();
        updateColorSliderUI(container, data, settings, id, plotContainer)
        _updatePlot(false)
    });

    const reverseColormapButton = container.querySelector(`#reverse-colormap-${id}`);
    reverseColormapButton.addEventListener('click', () => {
        settings.colorReversed = !settings.colorReversed;
        reverseColormapButton.classList.toggle('btn-primary', settings.colorReversed);
        reverseColormapButton.classList.toggle('btn-outline-secondary', !settings.colorReversed);
        reverseColormapButton.classList.toggle('active', settings.colorReversed);
        _updatePlotElements({ colorScale: true, colors: true });
    });

    // --- Centering slider listeners and helpers ---
    function setupCenteringSliderListeners() {
        const csColorMinSlider = container.querySelector(`#color-min-slider-${id}`);
        const csColorMaxSlider = container.querySelector(`#color-max-slider-${id}`);
        if (!csColorMinSlider || !csColorMaxSlider) return;
        csColorMinSlider.removeEventListener('input', centeringMinSliderHandler);
        csColorMaxSlider.removeEventListener('input', centeringMaxSliderHandler);
        if (settings.centeringActive) {
            csColorMinSlider.addEventListener('input', centeringMinSliderHandler);
            csColorMaxSlider.addEventListener('input', centeringMaxSliderHandler);
        }
    }

    function centeringMinSliderHandler(e) {
        if (!settings.centeringActive) return;
        const minValue = parseFloat(e.target.value);
        const csColorMaxSlider = container.querySelector(`#color-max-slider-${id}`);
        const csColorMaxInput = container.querySelector(`#color-max-${id}`);
        const csColorMinInput = container.querySelector(`#color-min-${id}`);
        const maxValue = -minValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        csColorMinInput.value = minValue.toFixed(2);
        if (csColorMaxInput) csColorMaxInput.value = maxValue.toFixed(2);
        if (csColorMaxSlider) csColorMaxSlider.value = maxValue;
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 'marker.cmin': minValue, 'marker.cmax': maxValue }, [0]);
        }
    }

    function centeringMaxSliderHandler(e) {
        if (!settings.centeringActive) return;
        const maxValue = parseFloat(e.target.value);
        const csColorMinSlider = container.querySelector(`#color-min-slider-${id}`);
        const csColorMinInput = container.querySelector(`#color-min-${id}`);
        const csColorMaxInput = container.querySelector(`#color-max-${id}`);
        const minValue = -maxValue;
        settings.colorMin = minValue;
        settings.colorMax = maxValue;
        csColorMaxInput.value = maxValue.toFixed(2);
        if (csColorMinInput) csColorMinInput.value = minValue.toFixed(2);
        if (csColorMinSlider) csColorMinSlider.value = minValue;
        if (plotContainer && plotContainer.data && plotContainer.data[0] && plotContainer.data[0].marker) {
            Plotly.restyle(plotContainer, { 'marker.cmin': minValue, 'marker.cmax': maxValue }, [0]);
        }
    }
}


/**
 * Setup listeners for all axis selector dropdowns (type, key, column)
 * @param {HTMLElement} container - Root element containing the axis selectors
 * @param {Object} settings - Axis settings object
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} data - Data cache for axis values
 * @param {string} id - Unique identifier for the plot
 * @param {Function} loadDataAndCreatePlot - Full plot rebuild
 */
function setupAxisSelectorListeners(
    container,
    plotContainer,
    settings,
    plotType,
    data,
    id,
    loadDataAndCreatePlot
) {
  // Add defensive check - container must be defined
  if (!container) {
    console.error('setupAxisSelectorListeners: container is undefined');
    return;
  }
  
  // Get all axis selectors
  const selectors = container.querySelectorAll('.axis-type-select');
  
  // Make sure we found some selectors
  if (!selectors || selectors.length === 0) {
    console.warn(`setupAxisSelectorListeners: No axis selectors found in container`);
  }
  
  selectors.forEach(select => {
    select.addEventListener('change', async (e) => {
      const axis =  e.currentTarget.dataset.axis;
      const type =  e.currentTarget.value;
      const keySelect = container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
      const columnSelect = container.querySelector(`.axis-column-select[data-axis="${axis}"]`);

      if (!keySelect || !columnSelect) return console.error(`Missing axis elements for ${axis}`);

      settings[axis].type = type;

      const datasetStructure = await DataManager.getDatasetStructure();
      if (!datasetStructure) return console.error('No dataset structure');

      populateKeySelector(settings[axis], keySelect, datasetStructure);
    if (type === 'none' && axis === 'color') {
      await loadColorDataAndUpdatePlot(
        container,
        plotContainer,
        settings,
        data,
        id,
        loadDataAndCreatePlot
    );
      return;
    }

      console.log(`Axis ${axis} type changed to ${type}`);
      console.log(keySelect.options);
      const keys = [...keySelect.options].map(o => o.value);
      settings[axis].key = keys[0] || '';
      keySelect.value = settings[axis].key;

      populateColumnSelector(settings[axis], columnSelect, axis, plotType, datasetStructure);

      const cols = [...columnSelect.options].map(o => o.value);
      const current = settings[axis].column;
      if (!cols.includes(current)) {
        const fallback = cols[{ x: 0, y: 1, z: 2 }[axis]] || cols[0] || '';
        columnSelect.value = fallback;
        settings[axis].column = fallback;
      } else {
        columnSelect.value = current;
      }

      handleAxisUpdate(axis);
    });
  });

  // Handle key selectors with defensive check
  const keySelectors = container.querySelectorAll('.axis-key-select');
  if (!keySelectors || keySelectors.length === 0) {
    console.warn('setupAxisSelectorListeners: No axis key selectors found in container');
  }
  
  keySelectors.forEach(select => {
    select.addEventListener('change', async (e) => {
      const axis =  e.currentTarget.dataset.axis;
      const key =  e.currentTarget.value;
      const columnSelect = container.querySelector(`.axis-column-select[data-axis="${axis}"]`);

      if (!columnSelect) return console.error(`Missing column select for ${axis}`);

      settings[axis].key = key;

      const datasetStructure = await DataManager.getDatasetStructure();
      if (!datasetStructure) return console.error('No dataset structure');

      populateColumnSelector(settings[axis], columnSelect, axis, plotType, datasetStructure);

      const cols = [...columnSelect.options].map(o => o.value);
      const current = settings[axis].column;
      if (!cols.includes(current)) {
        const fallback = cols[{ x: 0, y: 1, z: 2 }[axis]] || cols[0] || '';
        columnSelect.value = fallback;
        settings[axis].column = fallback;
      } else {
        columnSelect.value = current;
      }

      handleAxisUpdate(axis);
    });
  });

  // Handle column selectors with defensive check
  const columnSelectors = container.querySelectorAll('.axis-column-select');
  if (!columnSelectors || columnSelectors.length === 0) {
    console.warn('setupAxisSelectorListeners: No axis column selectors found in container');
  }
  
  columnSelectors.forEach(select => {
    select.addEventListener('change', (e) => {
      const axis =  e.currentTarget.dataset.axis;
      settings[axis].column =  e.currentTarget.value;
      handleAxisUpdate(axis);
    });
  });

  function handleAxisUpdate(axis) {
    if (axis === 'color') {
        loadColorDataAndUpdatePlot(
            container,
            plotContainer,
            settings,
            data,
            id,
            loadDataAndCreatePlot
          )
    } else if (['x', 'y', 'z'].includes(axis)) {
      loadAxisData(settings[axis]).then(axisData => {
        if (axisData?.values) {
          data[axis] = axisData;
          updatePlotElements(
            plotContainer,
            data, 
            settings, 
            loadDataAndCreatePlot, 
            { 
              [`${axis}Axis`]: true, 
              layout: true 
            }
          );
        } else {
          loadDataAndCreatePlot();
        }
      }).catch(() => loadDataAndCreatePlot());
    } else {
      loadDataAndCreatePlot();
    }
  }
}
