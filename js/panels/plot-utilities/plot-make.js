import { DataManager } from '../../data-manager.js';
import { createLayout, processCategories, attachClickHandler } from './plot-make-helper.js';
import { highlightFocusedCell } from './plot-update.js';

/**
 * Loads data for a specific axis.
 * @param {Object} settings - Axis settings object.
 * @param {Array<number>} [filteredIndices=null] - Optional indices to filter data.
 * @returns {Promise<Object>} - A promise resolving to an object containing:
 *   - values: The data values,
 *   - type: Data type (e.g. 'numerical', 'categorical', 'constant'),
 *   - categories: (optional) Category definitions.
 */
export async function loadAxisData(settings, filteredIndices = null) {
  if (!settings) {
    throw new Error(`loadAxisData: settings is undefined`);
  }

  const { type, key, column } = settings;
  const datasetPath = DataManager.getCurrentDataset();

  // Determine rows parameter based on filtered indices.
  const rows = filteredIndices ? filteredIndices.join(',') : null;

  let data;
  let values;
  let dataType;
  let categories = null;

  try {
    // Special case for 'none' type (constant color).
    if (type === 'none') {
      const cells = DataManager.getCells();
      const cellCount = cells ? cells.length : 100;
      values = Array(cellCount).fill(1);
      dataType = 'constant';
      return { values, type: dataType, categories };
    }

    // Process based on settings.type.
    switch (type) {
      case 'obs':
        data = await DataManager.loadObs({
          datasetPath,
          columns: [key],
          rows: rows ? rows.split(',') : null
        });
        console.log(`Received obs data for ${key}:`, data);

        if (!data.data || !data.data[key]) {
          console.warn(`No data found for obs.${key}`);
          throw new Error(`No data found for column '${key}' in obs table`);
        }

        values = data.data[key];
        if (Array.isArray(values)) {
          console.log(`Loaded ${values.length} data points (obs.${key})`);
          if (values.length > 0) {
            console.log(`Sample values: ${values.slice(0, 5)}`);
          }
        }

        if (data.categories && data.categories[key]) {
          dataType = 'categorical';
          categories = data.categories[key];
        } else {
          dataType = Array.isArray(values) && typeof values[0] === 'number' ? 'numerical' : 'string';
        }
        break;

      case 'obsm':
        data = await DataManager.loadObsm({
          datasetPath,
          obsmKey: key,
          columnName: column,
          rows: rows ? rows.split(',') : null
        });
        console.log(`Received obsm data for ${key} column ${column}:`, data);

        if (!data.data || data.data.length === 0) {
          console.warn(`No data points received for obsm.${key}.${column}`);
          throw new Error(`No data points found for ${key}.${column}`);
        }

        values = data.data;
        dataType = 'numerical';
        if (Array.isArray(values)) {
          console.log(`Loaded ${values.length} data points (obsm.${key}.${column})`);
          if (values.length > 0) {
            console.log(`Sample values: ${values.slice(0, 5)}`);
          }
        }
        break;

      case 'obsp':
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
            console.warn(`Expected array for obsp row, got:`, typeof firstRow);
            if (firstRow !== undefined && firstRow !== null) {
              values = [firstRow];
              console.log(`Converted non-array obsp data to array`);
            } else {
              values = [];
              console.warn(`No usable obsp data found`);
            }
          }
        } else {
          console.warn(`Invalid or empty obsp data received`);
          values = [];
        }

        if (values && values.length > 0) {
          values = values.map(v => (v === null || v === undefined) ? NaN : v);
          const firstVal = values[0];
          if (typeof firstVal === 'object') {
            console.warn('Obsp values are objects, attempting to convert to numbers');
            values = values.map(v => {
              if (v === null || v === undefined) return NaN;
              if (typeof v === 'number') return v;
              if (typeof v === 'object' && 'value' in v) return v.value;
              return NaN;
            });
          } else if (typeof firstVal === 'string') {
            console.warn('Obsp values are strings, attempting to convert to numbers');
            values = values.map(v => {
              if (v === null || v === undefined) return NaN;
              const parsed = parseFloat(v);
              return isNaN(parsed) ? NaN : parsed;
            });
          }
          const nanCount = values.filter(val => isNaN(val)).length;
          console.log(`Processed obsp data to ${values.length} values with ${nanCount} NaN values`);
          console.log(`Sample values after processing: ${values.slice(0, 5)}`);
        }
        dataType = 'numerical';
        break;

      case 'layer':
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
          rows: rows ? rows.split(',') : null,
          cols: [focusedGeneIndex]
        });
        console.log(`Received layer data:`, data.data ? `Array of ${data.data.length} elements` : 'No data array');

        if (data.data && typeof data.data === 'object') {
          if (Array.isArray(data.data)) {
            if (data.data.length > 0) {
              if (Array.isArray(data.data[0])) {
                console.log(`Layer data is 2D array with ${data.data.length} rows and ${data.data[0].length} columns`);
                console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                try {
                  values = data.data.map(row => {
                    const val = row[0];
                    return val === undefined ? NaN : val;
                  });
                  console.log(`Extracted ${values.length} values, first few: ${JSON.stringify(values.slice(0, 5))}`);
                } catch (e) {
                  console.error(`Error extracting values from 2D array:`, e);
                  values = Array(data.data.length).fill(NaN);
                }
              } else {
                console.log(`Layer data is 1D array with ${data.data.length} elements`);
                console.log(`Sample values: ${JSON.stringify(data.data.slice(0, 5))}`);
                values = data.data;
              }
            } else {
              console.warn(`Empty layer data array received`);
              values = [];
            }
          } else {
            console.warn(`Unexpected data format received:`, typeof data.data);
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
              if (typeof v === 'object' && 'value' in v) return v.value;
              return NaN;
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
        break;

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
 * Creates a Plotly plot.
 *
 * @param {HTMLElement} container - DOM element that holds the panel.
 * @param {HTMLElement} plotContainer - DOM element that holds the plot.
 * @param {Object} settings - Object with plot configuration (axes, colors, palettes, etc).
 * @param {Object} data - Data object containing x, y (and optionally z), cells, color, etc.
 * @param {string|number} id - An identifier used to connect the plot to UI controls.
 *
 * @returns {Promise<void>}
 */
export async function createPlot(container, plotContainer, settings, data, id) {
  // Validate required data
  if (!data.x || !data.y) {
    plotContainer.innerHTML =
      '<div class="alert alert-warning">Insufficient data for plotting</div>';
    return;
  }
  if (!data.cells || data.cells.length === 0) {
    console.error('Cell names missing - cannot create plot');
    plotContainer.innerHTML =
      '<div class="alert alert-danger">Error: Cell names missing or unavailable</div>';
    return;
  }
  if (data.cells.length !== data.x.values.length) {
    console.warn(
      `Cell names count (${data.cells.length}) doesn't match data points count (${data.x.values.length})`
    );
    if (data.cells.length > data.x.values.length) {
      data.cells = data.cells.slice(0, data.x.values.length);
    }
  }

  // Prepare base trace (works for numerical and constant coloring)
  const baseTrace = {
    type: settings.z ? 'scatter3d' : 'scattergl',
    mode: 'markers',
    x: data.x.values,
    y: data.y.values,
    text: data.cells,
    customdata: Array.from({ length: data.cells.length }, (_, i) => i),
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
        console.warn(`Failed to load uns colors from ${colorKey}`);
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
      if (settings.highlightFocusedCell) {
        highlightFocusedCell(plotContainer, data, settings);
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
      if (settings.highlightFocusedCell) {
        highlightFocusedCell(plotContainer, data, settings);
      }
      return;
    }
  } else if (data.colorType === 'numerical') {
    // Numerical coloring branch.
    baseTrace.marker.color = data.color;
    baseTrace.marker.colorscale = settings.colorScale;
    baseTrace.marker.reversescale = settings.colorReversed;
    if (settings.colorMin !== null || settings.colorMax !== null) {
      const cmin = settings.colorMin !== null ? settings.colorMin : Math.min(...data.color);
      const cmax = settings.colorMax !== null ? settings.colorMax : Math.max(...data.color);
      baseTrace.marker.cmin = cmin;
      baseTrace.marker.cmax = cmax;
      if (settings.hideOutliers) {
        baseTrace.x = baseTrace.x.filter((_, i) => data.color[i] >= cmin && data.color[i] <= cmax);
        baseTrace.y = baseTrace.y.filter((_, i) => data.color[i] >= cmin && data.color[i] <= cmax);
        baseTrace.text = baseTrace.text.filter((_, i) => data.color[i] >= cmin && data.color[i] <= cmax);
        baseTrace.marker.color = baseTrace.marker.color.filter(
          (_, i) => data.color[i] >= cmin && data.color[i] <= cmax
        );
        if (baseTrace.z) {
          baseTrace.z = baseTrace.z.filter((_, i) => data.color[i] >= cmin && data.color[i] <= cmax);
        }
      }
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

  // Update UI controls for numerical or categorical plots.
  if (data.colorType === 'numerical') {
    const validColorValues = data.color.filter(val => !isNaN(val));
    const dataMin = Math.min(...validColorValues);
    const dataMax = Math.max(...validColorValues);
    const colorMinInput = document.getElementById(`color-min-${id}`);
    const colorMaxInput = document.getElementById(`color-max-${id}`);
    const colorMinSlider = document.getElementById(`color-min-slider-${id}`);
    const colorMaxSlider = document.getElementById(`color-max-slider-${id}`);

    colorMinSlider.min = dataMin;
    colorMinSlider.max = dataMax;
    colorMaxSlider.min = dataMin;
    colorMaxSlider.max = dataMax;
    const range = dataMax - dataMin;
    const step = range > 100 ? 1 : range > 10 ? 0.1 : range > 1 ? 0.01 : 0.001;
    colorMinSlider.step = step;
    colorMaxSlider.step = step;

    if (colorMinInput.value === '') {
      colorMinInput.placeholder = dataMin.toFixed(2);
      colorMinSlider.value = dataMin;
    } else {
      colorMinSlider.value = settings.colorMin !== null ? settings.colorMin : dataMin;
    }
    if (colorMaxInput.value === '') {
      colorMaxInput.placeholder = dataMax.toFixed(2);
      colorMaxSlider.value = dataMax;
    } else {
      colorMaxSlider.value = settings.colorMax !== null ? settings.colorMax : dataMax;
    }
  } else if (data.colorType === 'categorical') {
    const categoryPaletteSelect = document.getElementById(`category-palette-${id}`);
    if (categoryPaletteSelect) {
      categoryPaletteSelect.value = settings.categoryPalette;
    }
  }
}