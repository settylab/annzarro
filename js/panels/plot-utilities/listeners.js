import { populateKeySelector, populateColumnSelector, updateColorSliderUI } from './panel-ui-update.js';
import { loadAxisData } from './plot-make.js';
import { updatePlotElements, loadColorDataAndUpdatePlot } from './plot-update.js';
import { DataManager } from '../../data-manager.js';

export function setupPlotEventListeners({
    container,
    plotContainer,
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

    // setup3DToggle(container, settings, plotType, updateFn);
    setupColorControls(
        container,
        settings,
        data,
        plotContainer,
        id,
        loadDataAndCreatePlot,
    );
    // setupPointStyleControls(container, settings, updateFn);
    // setupEventListenersForFocusChanges(settings, updateFn);
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
 * @param {string} plotType - Either 'cell' or 'gene'
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
      const type = container.querySelector(`.axis-type-select[data-axis="${axis}"]`).value;
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
