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

  // Since filtering is no longer used, set rowsArr to null.
  const rowsArr = null;

  let data;
  let values;
  let dataType;
  let categories = null;

  try {
    // Special case for 'none' type (constant color).
    if (type === 'none') {
      // Determine if we're working with gene or cell data based on function parameters
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

    // Process based on settings.type.
    switch (type) {
      case 'obs': {
        data = await DataManager.loadObs({
          datasetPath,
          columns: [key],
          rows: rowsArr
        });
        console.log(`Received obs data for ${key}:`, data);

        if (!data.data || !data.data[key]) {
          console.warn(`No data found for obs.${key}`);
          throw new Error(`No data found for column '${key}' in obs table`);
        }

        values = data.data[key];
        console.log(`Loaded ${values.length} data points (obs.${key})`);
        if (values.length > 0) {
          console.log(`Sample values: ${values.slice(0, 5)}`);
        }

        if (data.categories && data.categories[key]) {
          dataType = 'categorical';
          categories = data.categories[key];
        } else {
          // Infer data type: if >80% of values can be converted to a number, treat as numerical.
          const numericCount = values.filter(v => {
            if (v === null || v === undefined) return false;
            return !isNaN(parseFloat(v));
          }).length;
          dataType = (numericCount / values.length >= 0.8) ? 'numerical' : 'categorical';
        }
        break;
      }
      case 'var': {
        data = await DataManager.loadVar({
          datasetPath,
          columns: [key],
          rows: rowsArr
        });
        console.log(`Received var data for ${key}:`, data);

        if (!data.data || !data.data[key]) {
          console.warn(`No data found for var.${key}`);
          throw new Error(`No data found for column '${key}' in var table`);
        }

        values = data.data[key];
        console.log(`Loaded ${values.length} data points (var.${key})`);
        if (values.length > 0) {
          console.log(`Sample values: ${values.slice(0, 5)}`);
        }

        if (data.categories && data.categories[key]) {
          dataType = 'categorical';
          categories = data.categories[key];
        } else {
          // Infer data type: if >80% of values can be converted to a number, treat as numerical.
          const numericCount = values.filter(v => {
            if (v === null || v === undefined) return false;
            return !isNaN(parseFloat(v));
          }).length;
          dataType = (numericCount / values.length >= 0.8) ? 'numerical' : 'categorical';
        }
        break;
      }
      case 'obsm': {
        data = await DataManager.loadObsm({
          datasetPath,
          obsmKey: key,
          columnName: column,
          rows: rowsArr
        });
        console.log(`Received obsm data for ${key} column ${column}:`, data);

        if (!data.data || data.data.length === 0) {
          console.warn(`No data points received for obsm.${key}.${column}`);
          throw new Error(`No data points found for ${key}.${column}`);
        }

        values = data.data;
        dataType = 'numerical';
        console.log(`Loaded ${values.length} data points (obsm.${key}.${column})`);
        if (values.length > 0) {
          console.log(`Sample values: ${values.slice(0, 5)}`);
        }
        break;
      }
      case 'varm': {
        data = await DataManager.loadVarm({
          datasetPath,
          varmKey: key,
          columnName: column,
          rows: rowsArr
        });
        console.log(`Received varm data for ${key} column ${column}:`, data);

        if (!data.data || data.data.length === 0) {
          console.warn(`No data points received for varm.${key}.${column}`);
          throw new Error(`No data points found for ${key}.${column}`);
        }

        values = data.data;
        dataType = 'numerical';
        console.log(`Loaded ${values.length} data points (varm.${key}.${column})`);
        if (values.length > 0) {
          console.log(`Sample values: ${values.slice(0, 5)}`);
        }
        break;
      }
      case 'obsp': {
        const focusedCell = DataManager.getFocusedCell();
        if (!focusedCell) {
          throw new Error('No focused cell selected');
        }
        const focusedCellIndex = DataManager.getCellIndex(focusedCell);
        if (focusedCellIndex === -1) {
          throw new Error('Focused cell not found in dataset');
        }
        console.log(`Loading obsp data for ${key} with focused cell ${focusedCell} (index ${focusedCellIndex})`);
        data = await DataManager.loadObsp({
          datasetPath,
          obspKey: key,
          rows: [focusedCellIndex]
        });
        console.log(`Received obsp data:`, data.data ? `Array of ${data.data.length} elements` : 'No data array');

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const firstRow = data.data[0];
          if (Array.isArray(firstRow)) {
            console.log(`Obsp data is an array with ${firstRow.length} connections`);
            console.log(`Sample values: ${JSON.stringify(firstRow.slice(0, 5))}`);
            values = firstRow;
          } else {
            console.warn(`Expected array for obsp row, got: ${typeof firstRow}`);
            values = (firstRow !== undefined && firstRow !== null) ? [firstRow] : [];
          }
        } else {
          console.warn(`Invalid or empty obsp data received`);
          values = [];
        }

        if (values && values.length > 0) {
          // Replace null/undefined with NaN.
          values = values.map(v => (v === null || v === undefined) ? NaN : v);
          const firstVal = values[0];
          if (typeof firstVal === 'object') {
            console.warn('Obsp values are objects, attempting to convert to numbers');
            values = values.map(v => {
              if (v === null || v === undefined) return NaN;
              if (typeof v === 'number') return v;
              return (v && 'value' in v) ? v.value : NaN;
            });
            dataType = 'numerical';
          } else if (typeof firstVal === 'string') {
            console.warn('Obsp values are strings, treating as categorical');
            dataType = 'categorical';
          } else {
            dataType = 'numerical';
          }
        } else {
          dataType = 'numerical';
        }
        break;
      }
      case 'varp': {
        const focusedGene = DataManager.getFocusedGene();
        if (!focusedGene) {
          throw new Error('No focused gene selected');
        }
        const focusedGeneIndex = DataManager.getGeneIndex(focusedGene);
        if (focusedGeneIndex === -1) {
          throw new Error('Focused gene not found in dataset');
        }
        console.log(`Loading varp data for ${key} with focused gene ${focusedGene} (index ${focusedGeneIndex})`);
        data = await DataManager.loadVarp({
          datasetPath,
          varpKey: key,
          rows: [focusedGeneIndex]
        });
        console.log(`Received varp data:`, data.data ? `Array of ${data.data.length} elements` : 'No data array');

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const firstRow = data.data[0];
          if (Array.isArray(firstRow)) {
            console.log(`Varp data is an array with ${firstRow.length} connections`);
            console.log(`Sample values: ${JSON.stringify(firstRow.slice(0, 5))}`);
            values = firstRow;
          } else {
            console.warn(`Expected array for varp row, got: ${typeof firstRow}`);
            values = (firstRow !== undefined && firstRow !== null) ? [firstRow] : [];
          }
        } else {
          console.warn(`Invalid or empty varp data received`);
          values = [];
        }

        if (values && values.length > 0) {
          // Replace null/undefined with NaN.
          values = values.map(v => (v === null || v === undefined) ? NaN : v);
          const firstVal = values[0];
          if (typeof firstVal === 'object') {
            console.warn('Varp values are objects, attempting to convert to numbers');
            values = values.map(v => {
              if (v === null || v === undefined) return NaN;
              if (typeof v === 'number') return v;
              return (v && 'value' in v) ? v.value : NaN;
            });
            dataType = 'numerical';
          } else if (typeof firstVal === 'string') {
            console.warn('Varp values are strings, treating as categorical');
            dataType = 'categorical';
          } else {
            dataType = 'numerical';
          }
        } else {
          dataType = 'numerical';
        }
        break;
      }
      case 'layer': {
        if (plotType === 'genes') {
          // In gene plots, the focused cell defines a row; fetch a column array (colArr) from gene indices.
          const focusedCell = DataManager.getFocusedCell();
          if (!focusedCell) {
            throw new Error('No focused cell selected');
          }
          const focusedCellIndex = DataManager.getCellIndex(focusedCell);
          if (focusedCellIndex === -1) {
            throw new Error('Focused cell not found in dataset');
          }
          console.log(`Loading layer data for ${key} with focused cell ${focusedCell} (index ${focusedCellIndex}) for gene plot`);

          // Obtain gene indices to define the columns.
          const genes = DataManager.getGenes();
          const colArr = null;

          // Always use the cell index rather than the cell name with potential special characters
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            rows: [focusedCellIndex],
            cols: colArr
          });
          console.log(`Received layer data:`, data.data ? `Array of ${data.data.length} elements` : 'No data array');

          if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            if (Array.isArray(data.data[0])) {
              console.log(`Layer data is a 2D array with ${data.data.length} rows and ${data.data[0].length} columns`);
              // Assume the first (and only) row corresponds to gene values.
              values = data.data[0];
            } else {
              console.log(`Layer data is a 1D array with ${data.data.length} elements`);
              values = data.data;
            }
          } else {
            console.warn(`Empty or invalid layer data received for gene plot`);
            values = [];
          }
          dataType = 'numerical';
        } else {
          // In non-gene plots, the focused gene defines a column.
          const focusedGene = DataManager.getFocusedGene();
          if (!focusedGene) {
            throw new Error('No focused gene selected');
          }
          const focusedGeneIndex = DataManager.getGeneIndex(focusedGene);
          if (focusedGeneIndex === -1) {
            throw new Error('Focused gene not found in dataset');
          }
          console.log(`Loading layer data for ${key} with focused gene ${focusedGene} (index ${focusedGeneIndex})`);
          data = await DataManager.loadLayer({
            datasetPath,
            layerName: key,
            rows: rowsArr,
            cols: [focusedGeneIndex]
          });
          console.log(`Received layer data:`, data.data ? `Array of ${data.data.length} elements` : 'No data array');

          if (data.data && typeof data.data === 'object') {
            if (Array.isArray(data.data)) {
              if (data.data.length > 0) {
                if (Array.isArray(data.data[0])) {
                  console.log(`Layer data is a 2D array with ${data.data.length} rows and ${data.data[0].length} columns`);
                  console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                  try {
                    // Extract the first element from each row.
                    values = data.data.map(row => (row[0] === undefined ? NaN : row[0]));
                    console.log(`Extracted ${values.length} values, first few: ${JSON.stringify(values.slice(0, 5))}`);
                  } catch (e) {
                    console.error(`Error extracting values from 2D array:`, e);
                    values = Array(data.data.length).fill(NaN);
                  }
                } else {
                  console.log(`Layer data is a 1D array with ${data.data.length} elements`);
                  console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                  values = data.data;
                }
              } else {
                console.warn(`Empty layer data array received`);
                values = [];
              }
            } else {
              console.warn(`Unexpected data format received: ${typeof data.data}`);
              values = [];
            }
          } else {
            console.warn(`No valid data array received from layer endpoint`);
            values = [];
          }
          if (values.length > 0) {
            const firstVal = values[0];
            if (typeof firstVal === 'object') {
              console.warn('Layer values are objects, attempting to convert to numbers');
              values = values.map(v => {
                if (v === null || v === undefined) return NaN;
                if (typeof v === 'number') return v;
                return (v && 'value' in v) ? v.value : NaN;
              });
            } else if (typeof firstVal === 'string') {
              console.warn('Layer values are strings, attempting to convert to numbers');
              values = values.map(v => {
                if (v === null || v === undefined) return NaN;
                const parsed = parseFloat(v);
                return isNaN(parsed) ? NaN : parsed;
              });
            }
            console.log(`Processed layer data to ${values.length} values of type ${typeof values[0]}`);
            console.log(`Sample values after processing: ${values.slice(0, 5)}`);
          }
          dataType = 'numerical';
        }
        break;
      }
      default:
        throw new Error(`Unknown data type: ${type}`);
    }

    const result = { values, type: dataType, categories };
    return result;

  } catch (error) {
    console.error(`Error loading data for settings`, settings, 'error:', error);
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
      console.log(`Validating ${axis} axis settings:`, axisSettings);
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
              console.log(`Setting default column '${axisSettings.column}' for ${axis}-axis ${axisSettings.type}.${axisSettings.key}`);
            } else {
              axisSettings.column = '0';
              console.log(`No columns found for ${axisSettings.type}.${axisSettings.key}, defaulting ${axis}-axis column to '0'`);
            }
          } else {
            axisSettings.column = '0';
            console.log(`Dataset structure missing ${axisSettings.type}.${axisSettings.key}, defaulting ${axis}-axis column to '0'`);
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
        console.log('Loading X-axis data:', settings.x);
        data.x = await loadAxisData(settings.x, plotType);
      })(),
      (async () => {
        console.log('Loading Y-axis data:', settings.y);
        data.y = await loadAxisData(settings.y, plotType);
      })()
    ];

    if (settings.z) {
      loadPromises.push(
        (async () => {
          console.log('Loading Z-axis data:', settings.z);
          data.z = await loadAxisData(settings.z, plotType);
        })()
      );
    }

    // Load color data concurrently.
    loadPromises.push(
      (async () => {
        console.log('Loading color data:', settings.color);
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
    console.log(`Found ${catValues.length} categories:`, catValues);
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
        console.log(`Found custom colors in uns.${colorKey}:`, customColors);
      } else {
        console.log(`No uns colors from ${colorKey}`);
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