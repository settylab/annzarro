import { DataManager } from '../../data-manager.js';
import { createLayout, processCategories, attachClickHandler } from './plot-make-helper.js';
import { highlightFocusedEntity, updatePlotElements } from './plot-update.js';
import { updateColorSliderUI, updateColorControlsVisibility } from './panel-ui-update.js';

/**
 * Loads data for a specific axis from an anndata-derived source.
 * 
 * @param {Object} settings - Axis settings object.
 * @param {string} [plotType=null] - Optional plot type ('cells' or 'genes') to determine context.
 * @returns {Promise<Object>} - Resolves to an object with:
 *    - values: The data values,
 *    - type: Data type ('numerical', 'categorical', 'constant', or 'string'),
 *    - categories: (optional) Category definitions.
 */
export async function loadAxisData(settings, plotType = null) {
  if (!settings) {
    throw new Error(`loadAxisData: settings is undefined`);
  }

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

  try {
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
    throw new Error(`Failed to load data for (${type}.${key}${column ? '.' + column : ''})`);
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
 *
 * @returns {Promise<void>}
 */
export async function loadDataAndCreatePlot(container, plotContainer, settings, data, id) {
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

    // Show a loading indicator.
    plotContainer.innerHTML =
      '<div class="spinner"></div> Loading plot data...';

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
        data.x = await loadAxisData(settings.x, plotType);
      })(),
      (async () => {
        data.y = await loadAxisData(settings.y, plotType);
      })()
    ];

    if (settings.z) {
      loadPromises.push(
        (async () => {
          data.z = await loadAxisData(settings.z, plotType);
        })()
      );
    }

    // Load color data concurrently.
    loadPromises.push(
      (async () => {
        try {
          const colorData = await loadAxisData(settings.color, plotType);
          data.color = colorData.values;
          data.colorType = colorData.type;
          data.colorCategories = colorData.categories;
          // Update any color control UI in the container.
          updateColorControlsVisibility(container, data.colorType, id);
        } catch (err) {
          console.error("Error loading color data:", err);
        }
      })()
    );

    // Wait until all data is loaded.
    await Promise.all(loadPromises);

    // Validate that x and y axes have data.
    if (data.x && data.x.values && data.x.values.length > 0 &&
        data.y && data.y.values && data.y.values.length > 0) {
      console.log(`Creating plot with ${data.x.values.length} data points`);
      await createPlot(container, plotContainer, settings, data, id);
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
    plotContainer.innerHTML = `<div class="alert alert-danger">Error loading data: ${error.message}</div>`;
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
 *
 * @returns {Promise<void>}
 */
export async function createPlot(container, plotContainer, settings, data, id) {
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
      attachClickHandler(plotContainer, categoricalTraces, data);
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
      attachClickHandler(plotContainer, categoricalTraces, data);
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
    updateColorSliderUI(container, data, settings, id);
    if (settings.colorMin !== null || settings.colorMax !== null) {
      const cmin = settings.colorMin !== null ? settings.colorMin : Math.min(...data.color);
      const cmax = settings.colorMax !== null ? settings.colorMax : Math.max(...data.color);
      baseTrace.marker.cmin = cmin;
      baseTrace.marker.cmax = cmax;
    }
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
    attachClickHandler(plotContainer, [baseTrace], data);
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
    attachClickHandler(plotContainer, [baseTrace], data);
  }
}