import { populateKeySelector, populateColumnSelector } from './panel-ui-update.js';
import { loadAxisData } from './plot-make.js';
import { updatePlotElements } from './plot-update.js';
import { DataManager } from '../../data-manager.js';

export function setupPlotEventListeners({
    container,
    plotContainer,
    plot,
    settings,
    plotType,
    data,
    loadColorDataAndUpdatePlot,
    loadDataAndCreatePlot
  }) {

    const observer = setupResizeObserver(plotContainer);
    
    // Set up other listeners immediately
    setupAxisSelectorListeners(
        container,
        plotContainer,
        plot,
        settings,
        plotType,
        data,
        loadColorDataAndUpdatePlot,
        loadDataAndCreatePlot);

    // setup3DToggle(container, settings, plotType, updateFn);
    // setupColorControls(container, settings, updateFn);
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
 * Setup listeners for all axis selector dropdowns (type, key, column)
 * @param {HTMLElement} container - Root element containing the axis selectors
 * @param {Object} settings - Axis settings object
 * @param {string} plotType - Either 'cell' or 'gene'
 * @param {Function} loadColorDataAndUpdatePlot - Optimized color update
 * @param {Function} loadDataAndCreatePlot - Full plot rebuild
 * @param {Object} plot - Optional plot object (used to check if plot exists)
 * @param {Object} data - Data cache for axis values
 */
export function setupAxisSelectorListeners(
    container,
    plotContainer,
    plot,
    settings,
    plotType,
    data,
    loadColorDataAndUpdatePlot,
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

      if (type === 'none' && axis === 'color') return loadColorDataAndUpdatePlot();

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
      return loadColorDataAndUpdatePlot();
    }

    if (['x', 'y', 'z'].includes(axis)) {
      loadAxisData(settings[axis]).then(axisData => {
        if (axisData?.values) {
          data[axis] = axisData;
          updatePlotElements(
            plotContainer,
            plot, 
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
