import { DataManager } from '../../data-manager.js';
import { createLayout, processCategories, attachClickHandler } from './plot-make-helper.js';
import { highlightFocusedEntity, updatePlotElements } from './plot-update.js';
import { updateColorSliderUI, updateColorControlsVisibility } from './panel-ui-update.js';

/**
 * Manages loading indicators for plot operations with built-in counter to handle
 * concurrent loading operations properly.
 */
class LoadingIndicator {
  constructor() {
    this._counters = new WeakMap(); // Use WeakMap to avoid memory leaks
    this._instanceId = Date.now().toString(36); // Unique instance identifier
  }

  /**
   * Generate a stable ID for a container
   * @param {HTMLElement} container - The container element
   * @returns {string} - A stable identifier
   */
  _getContainerId(container) {
    // If container already has an ID or data-id attribute, use it
    if (container.id) return container.id;
    if (container.dataset.id) return container.dataset.id;
    
    // If container doesn't have an ID, generate one and store it
    if (!container.dataset.loadingId) {
      // Create a stable ID based on DOM position
      const domPath = [];
      let node = container;
      while (node && node !== document.body) {
        const siblings = Array.from(node.parentNode?.children || []);
        const index = siblings.indexOf(node);
        domPath.unshift(index);
        node = node.parentNode;
      }
      
      // Create a stable ID that persists for this DOM element
      const stableId = `loading-container-${this._instanceId}-${domPath.join('-')}`;
      container.dataset.loadingId = stableId;
    }
    
    return container.dataset.loadingId;
  }

  /**
   * Shows a loading indicator for the specified container if not already showing
   * @param {HTMLElement} plotContainer - The container to show loading indicator in
   * @param {string} operation - Identifier for the loading operation
   * @returns {void}
   */
  show(plotContainer, operation) {
    if (!plotContainer) return;
    
    // Generate a stable container ID
    const containerId = this._getContainerId(plotContainer);
    
    // Initialize counter map for this container if needed
    if (!this._counters.has(plotContainer)) {
      this._counters.set(plotContainer, new Map());
    }
    
    const operationCounts = this._counters.get(plotContainer);
    const currentCount = operationCounts.get(operation) || 0;
    operationCounts.set(operation, currentCount + 1);
    
    // Only modify DOM if this is the first concurrent operation of this type
    if (currentCount === 0) {
      const overlayId = `loading-overlay-${containerId}-${operation}`;
      // Check if overlay already exists and remove it if it does (handles edge cases)
      const existingOverlay = document.getElementById(overlayId);
      if (existingOverlay) existingOverlay.remove();
      
      // Create new overlay
      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.className = 'loading-overlay';
      overlay.dataset.operation = operation; // Store operation for fallback cleanup
      overlay.dataset.containerId = containerId; // Store containerId for fallback cleanup
      overlay.innerHTML = '<div class="spinner"></div> Loading axis data...';
      
      // Make sure container has position relative/absolute for proper overlay
      const containerPosition = window.getComputedStyle(plotContainer).position;
      if (containerPosition === 'static') {
        plotContainer.style.position = 'relative';
      }
      
      plotContainer.appendChild(overlay);
    }
  }

  /**
   * Hides the loading indicator for the specified container
   * @param {HTMLElement} plotContainer - The container to hide loading indicator in
   * @param {string} operation - Identifier for the loading operation 
   * @returns {void}
   */
  hide(plotContainer, operation) {
    if (!plotContainer) return;
    
    // Get the stable container ID
    const containerId = this._getContainerId(plotContainer);
    
    // Find and remove operation counts
    if (this._counters.has(plotContainer)) {
      const operationCounts = this._counters.get(plotContainer);
      const currentCount = operationCounts.get(operation) || 0;
      
      if (currentCount <= 1) {
        // Last or only operation is complete
        operationCounts.delete(operation);
        
        // Remove any overlay for this operation
        const overlayId = `loading-overlay-${containerId}-${operation}`;
        const overlay = document.getElementById(overlayId);
        if (overlay) {
          overlay.remove();
        } else {
          // Fallback: find by data attributes if ID approach fails
          const fallbackOverlays = plotContainer.querySelectorAll(
            `.loading-overlay[data-operation="${operation}"][data-container-id="${containerId}"]`
          );
          fallbackOverlays.forEach(el => el.remove());
        }
      } else {
        // Decrement counter for concurrent operations
        operationCounts.set(operation, currentCount - 1);
      }
      
      // Clean up the container entry if no more operations
      if (operationCounts.size === 0) {
        this._counters.delete(plotContainer);
      }
    } else {
      // Fallback: if counter tracking failed, attempt cleanup by data attributes
      const allOverlays = plotContainer.querySelectorAll(
        `.loading-overlay[data-operation="${operation}"]`
      );
      allOverlays.forEach(el => el.remove());
    }
  }
  
  /**
   * Clean up all loading indicators for a container when it's being destroyed
   * @param {HTMLElement} plotContainer - The container being destroyed
   */
  cleanupContainer(plotContainer) {
    if (!plotContainer) return;
    
    // First, delete the counter entry
    if (this._counters.has(plotContainer)) {
      this._counters.delete(plotContainer);
    }
    
    // Then remove all loading overlays from the container
    const overlays = plotContainer.querySelectorAll('.loading-overlay');
    overlays.forEach(overlay => overlay.remove());
  }
}

// Create a singleton instance
const loadingIndicator = new LoadingIndicator();

// Make loadingIndicator globally available for cleanup
window.loadingIndicator = loadingIndicator;

/**
 * Loads data for a specific axis from an anndata-derived source.
 * 
 * @param {Object} settings - Axis settings object.
 * @param {string} [plotType=null] - Optional plot type ('cells' or 'genes') to determine context.
 * @param {HTMLElement} [plotContainer=null] - Container to show loading indicator in.
 * @returns {Promise<Object>} - Resolves to an object with:
 *    - values: The data values,
 *    - type: Data type ('numerical', 'categorical', 'constant', or 'string'),
 *    - categories: (optional) Category definitions.
 */
export async function loadAxisData(settings, plotType = null, plotContainer = null) {
  if (!settings) {
    throw new Error(`loadAxisData: settings is undefined`);
  }

  // Show loading indicator if container is provided
  if (plotContainer) {
    loadingIndicator.show(plotContainer, 'axis-data');
  }

  try {
    const { type, key, column } = settings;
    const datasetPath = DataManager.getCurrentDataset();
    const rowsArr = null; // Filtering no longer applies

    let data, values, dataType;
    let categories = null;

    // --- Helper Functions ---
    // Returns at most maxSample elements of an array.
    function sampleArray(arr, maxSample = 100) {
      return arr.length > maxSample ? arr.slice(0, maxSample) : arr;
    }

    /**
     * Infer whether the sampled values are mostly numeric or categorical.
     * Booleans count as categorical.
     * @param {Array} arr - Array of values.
     * @returns {string} - 'numerical' or 'categorical'.
     */
    function determineDataType(arr) {
      const sample = sampleArray(arr);
      if (sample.length === 0) return 'categorical';
      let boolCount = 0, numCount = 0;
      sample.forEach(v => {
        if (v === true || v === false) {
          boolCount++;
        } else if (v !== null && v !== undefined && !isNaN(parseFloat(v))) {
          numCount++;
        }
      });
      if (boolCount / sample.length >= 0.8) return 'categorical';
      if (numCount / sample.length >= 0.8) return 'numerical';
      return 'categorical';
    }

    // Convert non-null booleans to strings.
    function convertBooleans(arr) {
      return arr.map(v => (v === null || v === undefined) ? v : String(v));
    }

    // Convert values to numbers when possible while preserving the array length.
    function processNumericValues(arr) {
      return arr.map(v => {
        if (v === null || v === undefined) return NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'object' && v && 'value' in v) return v.value;
        if (typeof v === 'string') {
          const parsed = parseFloat(v);
          return isNaN(parsed) ? NaN : parsed;
        }
        return NaN;
      });
    }

    // SPECIAL CASE: 'none' type (constant color).
    if (type === 'none') {
      const isGenePlot = plotType === 'genes';
      if (isGenePlot) {
        const genes = DataManager.getGenes();
        const geneCount = genes ? genes.length : 100;
        values = Array(geneCount).fill(1);
      } else {
        const cells = DataManager.getCells();
        const cellCount = cells ? cells.length : 100;
        values = Array(cellCount).fill(1);
      }
      dataType = 'constant';
      return { values, type: dataType, categories };
    }

    // Common pattern for most data types.
    switch (type) {
      case 'obs':
      case 'var': {
        const loadMethod = type === 'obs' ? DataManager.loadObs : DataManager.loadVar;
        data = await loadMethod({ datasetPath, columns: [key], rows: rowsArr });
        if (!data.data || !data.data[key]) {
          console.warn(`No data found for ${type}.${key}`);
          throw new Error(`No data found for column '${key}' in ${type} table`);
        }
        values = data.data[key];
        if (data.categories && data.categories[key]) {
          dataType = 'categorical';
          categories = data.categories[key];
        } else {
          dataType = determineDataType(values);
          if (dataType === 'categorical') {
            values = convertBooleans(values);
          }
        }
        break;
      }
      case 'obsm':
      case 'varm': {
        const loadMethod = type === 'obsm' ? DataManager.loadObsm : DataManager.loadVarm;
        data = await loadMethod({
          datasetPath,
          [type === 'obsm' ? 'obsmKey' : 'varmKey']: key,
          columnName: column,
          rows: rowsArr
        });
        if (!data.data || data.data.length === 0) {
          console.warn(`No data points received for ${type}.${key}.${column}`);
          throw new Error(`No data points found for ${key}.${column}`);
        }
        values = data.data;
        dataType = 'numerical';
        break;
      }
      case 'obsp':
      case 'varp': {
        if (type === 'obsp') {
          const cellIndex = DataManager.getCellIndex(column);
          if (cellIndex === -1) throw new Error('Focused cell not found in dataset');
          data = await DataManager.loadObsp({ datasetPath, obspKey: key, rows: [cellIndex] });
        } else {
          const geneIndex = DataManager.getGeneIndex(column);
          if (geneIndex === -1) throw new Error('Focused gene not found in dataset');
          data = await DataManager.loadVarp({ datasetPath, varpKey: key, rows: [geneIndex] });
        }
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const firstRow = data.data[0];
          values = Array.isArray(firstRow) ? firstRow : ((firstRow !== undefined && firstRow !== null) ? [firstRow] : []);
        } else {
          console.warn(`Invalid or empty ${type} data received`);
          values = [];
        }
        // Preserve length: map nulls/undefined to NaN.
        values = values.map(v => (v === null || v === undefined) ? NaN : v);
        const sample = sampleArray(values);
        if (sample.every(v => typeof v === 'object')) {
          values = processNumericValues(values);
          dataType = 'numerical';
        } else if (sample.every(v => typeof v === 'string')) {
          dataType = 'categorical';
        } else {
          dataType = 'numerical';
        }
        break;
      }
      case 'layer': {
        if (plotType === 'genes') {
          const cellIndex = DataManager.getCellIndex(column);
          if (cellIndex === -1) throw new Error('Focused cell not found in dataset');
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            rows: [cellIndex],
            cols: null
          });
          if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            values = Array.isArray(data.data[0]) ? data.data[0] : data.data;
          } else {
            console.warn('Empty or invalid layer data received for gene plot');
            values = [];
          }
          dataType = 'numerical';
        } else {
          const geneIndex = DataManager.getGeneIndex(column);
          if (geneIndex === -1) throw new Error('Focused gene not found in dataset');
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            rows: rowsArr,
            cols: [geneIndex]
          });
          if (data.data && Array.isArray(data.data)) {
            if (data.data.length > 0) {
              if (Array.isArray(data.data[0])) {
                try {
                  values = data.data.map(row => (row[0] === undefined ? NaN : row[0]));
                } catch (e) {
                  console.error('Error extracting values from 2D array:', e);
                  values = Array(data.data.length).fill(NaN);
                }
              } else {
                values = data.data;
              }
            } else {
              console.warn('Empty layer data array received');
              values = [];
            }
          } else {
            console.warn(`Unexpected data format received: ${typeof data.data}`);
            values = [];
          }
          if (values.length > 0) {
            const sample = sampleArray(values);
            if (sample.every(v => typeof v === 'object')) {
              values = processNumericValues(values);
            } else if (sample.every(v => typeof v === 'string')) {
              values = values.map(v => {
                if (v === null || v === undefined) return NaN;
                const parsed = parseFloat(v);
                return isNaN(parsed) ? NaN : parsed;
              });
            }
          }
          dataType = 'numerical';
        }
        break;
      }
      default:
        throw new Error(`Unknown data type: ${type}`);
    }

    return { values, type: dataType, categories };
  } catch (error) {
    console.error('Error loading data for settings', settings, 'error:', error);
    throw new Error(`Failed to load data for (${settings.type}.${settings.key}${settings.column ? '.' + settings.column : ''}) error: ${error.message}`);
  } finally {
    // Hide loading indicator if container was provided
    if (plotContainer) {
      loadingIndicator.hide(plotContainer, 'axis-data');
    }
  }
}



/**
 * Loads data for all axes and then creates the plot.
 *
 * @param {HTMLElement} container - The container element for the panel/controls.
 * @param {HTMLElement} plotContainer - The Plotly plot container element.
 * @param {Object} settings - The settings object for the plot (e.g., axes settings for x, y, z, color).
 * @param {Object} data - A mutable data cache object (e.g., { x, y, z, color, cells, ... }).
 * @param {string|number} id - A unique identifier used to build element selectors.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 *
 * @returns {Promise<void>}
 */
export async function loadDataAndCreatePlot(container, plotContainer, settings, data, id, isFirstLoad = false) {
  try {
    // Determine if this is a gene or cell plot based on settings
    const isGenePlot = data.entities == 'genes'
    
    if (isGenePlot) {
      // Validate that genes exist for gene plots
      const genes = DataManager.getGenes();
      if (!genes || !genes.length) {
        plotContainer.innerHTML = '<div class="alert alert-warning">No genes available</div>';
        return;
      }
    } else {
      // Validate that cells exist for cell plots
      const cells = DataManager.getCells();
      if (!cells || !cells.length) {
        plotContainer.innerHTML = '<div class="alert alert-warning">No cells available</div>';
        return;
      }
    }

    // Show loading indicator
    loadingIndicator.show(plotContainer, 'full-plot');

    // Validate each axis (x, y, z, color) in settings.
    for (const axis of ['x', 'y', 'z', 'color']) {
      // Skip z-axis if not used.
      if (axis === 'z' && !settings.z) continue;
      const axisSettings = settings[axis];
      if (!axisSettings) {
        throw new Error(`No settings found for ${axis} axis`);
      }
      if (!axisSettings.type) {
        plotContainer.innerHTML = `<div class="alert alert-warning">
          Missing type for ${axis}-axis
        </div>`;
        return;
      }
      
      // For 'obsm'/'varm' type, ensure key and column are provided.
      if (axisSettings.type === 'obsm' || axisSettings.type === 'varm') {
        if (!axisSettings.key || axisSettings.key === '') {
          plotContainer.innerHTML = `<div class="alert alert-warning">
            Please select an ${axisSettings.type} key for the ${axis}-axis
          </div>`;
          return;
        }
        if (axisSettings.column === undefined || axisSettings.column === null || axisSettings.column === '') {
          // Query the global dataset structure.
          const ds = await DataManager.getDatasetStructure();
          
          // Handle both obsm and varm
          const dfCollection = axisSettings.type === 'obsm' ? ds?.obsm?.dataframes : ds?.varm?.dataframes;
          if (ds && dfCollection && dfCollection[axisSettings.key]) {
            const df = dfCollection[axisSettings.key];
            if (df.columns && df.columns.length > 0) {
              if (axis === 'x') {
                axisSettings.column = df.columns[0];
              } else if (axis === 'y') {
                axisSettings.column = df.columns.length >= 2 ? df.columns[1] : df.columns[0];
              } else if (axis === 'z') {
                axisSettings.column = df.columns.length >= 3 ? df.columns[2] : df.columns[0];
              } else if (axis === 'color') {
                axisSettings.column = df.columns.length >= 4 ? df.columns[3] : df.columns[0];
              }
            } else {
              axisSettings.column = '0';
            }
          } else {
            axisSettings.column = '0';
          }
        }
      }
    }

    // Reset cached data without changing its reference.
    Object.keys(data).forEach(key => delete data[key]);
    
    // Set up the appropriate entity list (cells or genes)
    if (isGenePlot) {
      const genes = DataManager.getGenes();
      Object.assign(data, {
        x: null,
        y: null,
        z: null,
        color: null,
        genes: genes,
        entities: "genes"
      });
    } else {
      const cells = DataManager.getCells();
      Object.assign(data, {
        x: null,
        y: null,
        z: null,
        color: null,
        cells: cells,
        entities: "cells"
      });
    }

    // Determine the plot type for loading the appropriate data
    const plotType = isGenePlot ? 'genes' : 'cells';
    
    // Build an array of promises to load axis and color data concurrently.
    const loadPromises = [
      (async () => {
        data.x = await loadAxisData(settings.x, plotType, plotContainer);
      })(),
      (async () => {
        data.y = await loadAxisData(settings.y, plotType, plotContainer);
      })()
    ];

    if (settings.z) {
      loadPromises.push(
        (async () => {
          data.z = await loadAxisData(settings.z, plotType, plotContainer);
        })()
      );
    }

    // Load color data concurrently.
    loadPromises.push(
      (async () => {
          const colorData = await loadAxisData(settings.color, plotType, plotContainer);
          data.color = colorData.values;
          data.colorType = colorData.type;
          data.colorCategories = colorData.categories;
          // Update any color control UI in the container.
          updateColorControlsVisibility(container, data.colorType, id);
      })()
    );

    // Wait until all data is loaded.
    await Promise.all(loadPromises);

    // Validate that x and y axes have data.
    if (data.x && data.x.values && data.x.values.length > 0 &&
        data.y && data.y.values && data.y.values.length > 0) {
      console.log(`Creating plot with ${data.x.values.length} data points`);
      await createPlot(container, plotContainer, settings, data, id, isFirstLoad);
      updateColorControlsVisibility(container, data.colorType, id);
    } else {
      console.error('Insufficient data for plotting');
      plotContainer.innerHTML = `<div class="alert alert-warning">
        Insufficient data for plotting. X axis has 
        ${data.x && data.x.values ? data.x.values.length : 0} points, 
        Y axis has ${data.y && data.y.values ? data.y.values.length : 0} points.
      </div>`;
    }
  } catch (error) {
    console.error('Error loading plot data:', error);

    // clear data
    plotContainer.data = [];
    
    // Create a more detailed error message
    let errorDetails = '';
    let suggestedActions = '';
    
    // Check if the error is related to a specific axis
    if (error.message && error.message.includes('Failed to load data for')) {
      // Extract the axis information
      const axisInfo = error.message.match(/\((.*?)\)/);
      if (axisInfo && axisInfo[1]) {
        const [type, key, column] = axisInfo[1].split('.');
        
        // Create a more user-friendly error message
        if (type && key) {
          errorDetails = `<br><br><strong>Failed data:</strong> ${type} "${key}"`;
          if (column) {
            errorDetails += `, column "${column}"`;
          }
          
          // Add potential solutions based on the error type
          errorDetails += '<br><br><strong>Possible solutions:</strong><ul>';
          
          if (type === 'layer') {
            errorDetails += '<li>Check if the selected layer exists in the dataset</li>';
            errorDetails += '<li>Verify that the specified cell/gene is valid</li>';
          } else if (type === 'obsm' || type === 'varm') {
            errorDetails += '<li>Check if the embedding or reduction exists</li>';
            errorDetails += '<li>Verify that the column index or name is valid</li>';
          } else if (type === 'obsp' || type === 'varp') {
            errorDetails += '<li>Check if the connectivity matrix exists</li>';
            errorDetails += '<li>Ensure a cell/gene is focused before using this data type</li>';
            
            // For focused cell/gene not found errors, add specific advice
            if (error.message.includes('Focused cell not found') || 
                error.message.includes('Focused gene not found')) {
              suggestedActions = `
                <div class="alert alert-info mt-3">
                  <strong>This is a common issue when opening a saved panel with a new dataset.</strong>
                  <p>The previously focused cell/gene doesn't exist in the current dataset.</p>
                  <p><strong>Suggested actions:</strong></p>
                  <ol>
                    <li>Select a new cell/gene in this dataset</li>
                    <li>Consider duplicating this panel before changing if you want to preserve the current configuration</li>
                    <li>Change the axis type to something that doesn't require a focused cell/gene</li>
                  </ol>
                </div>
              `;
            }
          } else if (type === 'obs' || type === 'var') {
            errorDetails += '<li>Check if the column name exists in the obs/var table</li>';
          }
          
          errorDetails += '</ul>';
        }
      }
    }
    
    plotContainer.innerHTML = `
      <div class="alert alert-danger">
        <h5>Error loading data</h5>
        <p>${error.message}</p>
        ${errorDetails}
      </div>
      ${suggestedActions}`;
  } finally {
    // Hide the loading indicator when all is done
    loadingIndicator.hide(plotContainer, 'full-plot');
  }
}


/**
 * Creates a Plotly plot.
 *
 * @param {HTMLElement} container - DOM element that holds the panel.
 * @param {HTMLElement} plotContainer - DOM element that holds the plot.
 * @param {Object} settings - Object with plot configuration (axes, colors, palettes, etc).
 * @param {Object} data - Data object containing x, y (and optionally z), cells/genes, color, etc.
 * @param {string|number} id - An identifier used to connect the plot to UI controls.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 *
 * @returns {Promise<void>}
 */
export async function createPlot(container, plotContainer, settings, data, id, isFirstLoad = false) {
  // Determine if this is a gene plot or cell plot
  const isGenePlot = settings && settings.highlightFocusedGene !== undefined;
  const entityKey = isGenePlot ? 'genes' : 'cells';
  const entities = data[entityKey];
  const highlightKey = isGenePlot ? 'highlightFocusedGene' : 'highlightFocusedCell';

  // Validate required data
  if (!data.x || !data.y) {
    plotContainer.innerHTML =
      '<div class="alert alert-warning">Insufficient data for plotting</div>';
    return;
  }
  if (!entities || entities.length === 0) {
    console.error(`${isGenePlot ? 'Gene' : 'Cell'} names missing - cannot create plot`);
    plotContainer.innerHTML =
      `<div class="alert alert-danger">Error: ${isGenePlot ? 'Gene' : 'Cell'} names missing or unavailable</div>`;
    return;
  }
  if (entities.length !== data.x.values.length) {
    console.warn(
      `${isGenePlot ? 'Gene' : 'Cell'} names count (${entities.length}) doesn't match data points count (${data.x.values.length})`
    );
    if (entities.length > data.x.values.length) {
      data[entityKey] = entities.slice(0, data.x.values.length);
    }
  }

  // Prepare base trace (works for numerical and constant coloring)
  const baseTrace = {
    type: settings.z ? 'scatter3d' : 'scattergl',
    mode: 'markers',
    x: data.x.values,
    y: data.y.values,
    text: entities,
    customdata: Array.from({ length: entities.length }, (_, i) => i),
    hovertemplate:
      `%{text}<br>x: %{x}<br>y: %{y}` +
      (settings.z ? `<br>z: %{z}` : '') +
      (data.colorType === 'numerical' ? `<br>c: %{marker.color}` : '') +
      `<extra></extra>`,
    marker: {
      size: settings.pointSize,
      opacity: settings.pointOpacity
    }
  };
  if (settings.z && data.z) {
    baseTrace.z = data.z.values;
  }

  // Build layout with our pure helper
  const layout = createLayout(settings);

  // Branch for different color types
  if (data.colorType === 'categorical') {
    // Remove colorscale if present
    delete baseTrace.marker.colorscale;

    // Derive the unique category values
    const catValues = data.colorCategories || [...new Set(data.color)];
    const colorKey = `${settings.color.key}_colors`;
    const datasetPath = DataManager.getCurrentDataset();
    try {
      const response = await DataManager.loadUns({
        datasetPath: datasetPath,
        unsKey: colorKey
      });
      let customColors = null;
      if (response && response.data) {
        customColors = Array.isArray(response.data)
          ? response.data
          : [response.data];
      }
      // Process categories using the uns (custom) colors if available.
      const categoricalTraces = processCategories(settings, data, catValues, customColors);
      
      layout.showlegend = true;
      layout.legend = { ...(layout.legend || {}), title: { text: settings.color.key } };

      plotContainer.innerHTML = '';
      Plotly.newPlot(
        plotContainer,
        categoricalTraces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        }
      );
      attachClickHandler(plotContainer, categoricalTraces, data, settings);
      if (settings[highlightKey]) {
        highlightFocusedEntity(plotContainer, data, settings);
      }
      return;
    } catch (error) {
      console.warn(`Error fetching custom colors from uns.${colorKey}:`, error);
      // Fallback: process without custom colors
      const categoricalTraces = processCategories(settings, data, catValues);
      
      plotContainer.innerHTML = '';
      Plotly.newPlot(
        plotContainer,
        categoricalTraces,
        layout,
        window.plotlyDefaultConfig || {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
        }
      );
      attachClickHandler(plotContainer, categoricalTraces, data, settings);
      if (settings[highlightKey]) {
        highlightFocusedEntity(plotContainer, data, settings);
      }
      return;
    }
  } else if (data.colorType === 'numerical') {
    // Numerical coloring branch.
    baseTrace.marker.color = data.color;
    baseTrace.marker.colorscale = settings.colorScale;
    baseTrace.marker.reversescale = settings.colorReversed;
    
    // Update color sliders with the loaded data while preserving saved settings
    updateColorSliderUI(container, data, settings, id, isFirstLoad);
    
    let cmin = settings.colorMin;
    let cmax = settings.colorMax;
    
    // If either setting is not defined (i.e. null or undefined), compute valid values and update only the missing one.
    if (cmin == null || cmax == null) {
      const validValues = data.color.filter(v => !isNaN(v));
    
      if (cmin == null) {
        cmin = Math.min(...validValues);
      }
      if (cmax == null) {
        cmax = Math.max(...validValues);
      }
    }
    
    baseTrace.marker.cmin = cmin;
    baseTrace.marker.cmax = cmax;
    baseTrace.marker.colorbar = {
      title: {
        text:
          `${settings.color.type}.${settings.color.key}` +
          (settings.color.column ? `.${settings.color.column}` : ''),
        side: 'right',
        font: { size: 12 }
      },
      titleside: 'right'
    };
    plotContainer.innerHTML = '';
    Plotly.newPlot(
      plotContainer,
      [baseTrace],
      layout,
      window.plotlyDefaultConfig || {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
      }
    );
    attachClickHandler(plotContainer, [baseTrace], data, settings);
    updatePlotElements(plotContainer, data, settings, null, { filter: true, colorRange: true })
  } else if (data.colorType === 'constant') {
    // Constant coloring branch.
    baseTrace.marker.color = 'rgba(150, 150, 150, 0.7)';
    delete baseTrace.marker.colorscale;
    console.log('Using constant color for all points');
    plotContainer.innerHTML = '';
    Plotly.newPlot(
      plotContainer,
      [baseTrace],
      layout,
      window.plotlyDefaultConfig || {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d']
      }
    );
    attachClickHandler(plotContainer, [baseTrace], data, settings);
  }
  if (settings[highlightKey]) {
    highlightFocusedEntity(plotContainer, data, settings);
  }
}