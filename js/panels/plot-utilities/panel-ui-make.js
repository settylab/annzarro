import { listAvailableColormaps } from './colors.js';
import { setupAxisSelector, updateColorSliderUI } from './panel-ui-update.js';
import { Config } from '../../config.js';
import { DataManager } from '../../data-manager.js';

// Create array of discrete color scales
const COLOR_SCALES = (Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Portland'];

/**
 * Injects available colormaps into a <select> element with <optgroup> support.
 * The first element is set to "uns" with the text "As stored in adata.uns".
 * @param {HTMLSelectElement} selectElement - The <select> element to populate.
 * @param {Object} colormapGroups - Output of listAvailableColormaps()
 * @param {string} [selected] - Optional selected value.
 */
export function populateColormapSelectorGrouped(selectElement, colormapGroups, selected = '') {
  // Insert the first menu option for "uns" colors
  const unsOption = document.createElement('option');
  unsOption.value = 'uns';
  unsOption.textContent = 'As stored in adata.uns';
  if (selected === 'uns') unsOption.selected = true;
  selectElement.appendChild(unsOption);

  // Process the remaining colormaps grouped by category
  for (const [groupLabel, colormaps] of Object.entries(colormapGroups)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabel;
    for (const cmap of colormaps) {
      const option = document.createElement('option');
      option.value = cmap;
      option.textContent = cmap;
      if (cmap === selected) option.selected = true;
      optgroup.appendChild(option);
    }
    selectElement.appendChild(optgroup);
  }
}

/**
 * Generates and injects a plot panel HTML structure into the given container.
 *
 * @param {HTMLElement} container - The DOM element into which the panel will be rendered.
 * @param {string} id - A unique identifier for the panel instance.
 * @param {Object} settings - An object containing configuration values.
 * @param {number} settings.pointSize - Default point size for plotting.
 * @param {number} settings.pointOpacity - Default point opacity.
 * @param {string} settings.colorScale - Default continuous colormap name.
 * @param {string} settings.categoryPalette - Default discrete palette name.
 * @param {number} [settings.colorMin=0] - Minimum value for color range.
 * @param {number} [settings.colorMax=100] - Maximum value for color range.
 * @returns {{ plotContainer: HTMLElement, controlsContainer: HTMLElement, loadingScreen: HTMLElement }}
 */
export function createPanelStructure(container, id, settings) {
  container.innerHTML = `
    <div class="plot-panel">
      <div class="loading-screen" id="loading-screen-${id}" style="display: none;">
        <div class="loading-content">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
          <h4 class="mt-3">No dataset loaded</h4>
          <p>Please select a dataset to begin visualization</p>
        </div>
      </div>
      <div class="plot-controls">
        <!-- X and Y Axis Selectors -->
        ${['x', 'y'].map(axis => `
        <div class="axis-selector-container">
          <div class="axis-selector-label">${axis.toUpperCase()}-Axis</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="${axis}" id="${axis}-type-select-${id}">
              <!-- Options will be set based on plot type -->
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="${axis}"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="${axis}"></select>
          </div>
        </div>
        `).join('')}

        <!-- Z-Axis Selector -->
        <div class="axis-selector-container" id="z-axis-container-${id}" style="display:none;">
          <div class="axis-selector-label">Z-Axis (3D)</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="z" id="z-type-select-${id}">
              <!-- Options will be set based on plot type -->
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="z"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="z"></select>
          </div>
        </div>

        <!-- Color Controls and Selectors -->
        <div class="color-selector-container">
          <div class="axis-selector-label">Color</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="color" id="color-type-select-${id}">
              <option value="none">None (constant)</option>
              <!-- Other options will be set based on plot type -->
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="color"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="color"></select>
          </div>

          <div class="color-options mt-2">
            <div class="btn-group" role="group">
              <button class="btn btn-sm btn-outline-secondary me-2" id="z-axis-toggle-${id}">3D Plot</button>
              <button class="btn btn-sm active btn-primary me-2" id="show-grid-${id}">Show Grid</button>
              <button class="btn btn-sm active btn-primary me-2" id="highlight-focused-cell-${id}" style="display:none;">Highlight Focused Cell</button>
              <button class="btn btn-sm active btn-primary me-2" id="highlight-focused-gene-${id}" style="display:none;">Highlight Focused Gene</button>
              <button class="btn btn-sm btn-outline-secondary me-2" id="refresh-plot-${id}">Refresh</button>
            </div>

            <div class="point-controls">
              <div class="point-size-control">
                <label>Size:</label>
                <input type="range" class="form-range" min="1" max="20" value="${settings.pointSize}" id="point-size-${id}">
              </div>
              <div class="point-opacity-control">
                <label>Opacity:</label>
                <input type="range" class="form-range" min="0.1" max="1" step="0.1" value="${settings.pointOpacity}" id="point-opacity-${id}">
              </div>
            </div>

            <div class="color-range-controls" id="color-range-container-${id}" style="display:none;">
              <div class="d-flex align-items-center mb-2">
                <label id="numerical-color-label-${id}" class="numerical-color-label me-2 mb-0">Color Map:</label>
                <label id="categorical-color-label-${id}" class="categorical-color-label me-2 mb-0" style="display:none;">Color Palette:</label>
                <select class="form-select form-select-sm color-palette-selector flex-grow-1" id="color-scale-${id}">
                  ${COLOR_SCALES.map(scale => `
                    <option value="${scale}" ${scale === settings.colorScale ? 'selected' : ''}>${scale}</option>
                  `).join('')}
                </select>
                <select class="form-select form-select-sm category-palette-selector flex-grow-1" id="category-palette-${id}" style="display:none;">
                  <!-- Options populated by external logic -->
                </select>
              </div>

              <div class="color-range-inputs">
                <div class="color-range-sliders">
                  <div class="color-min-slider-container">
                    <label>Min:</label>
                    <input type="range" class="form-range" id="color-min-slider-${id}" value="${settings.colorMin ?? 0}">
                    <input type="number" class="form-control form-control-sm" id="color-min-${id}" value="${settings.colorMin ?? 0}">
                  </div>
                  <div class="color-max-slider-container">
                    <label>Max:</label>
                    <input type="range" class="form-range" id="color-max-slider-${id}" value="${settings.colorMax ?? 100}">
                    <input type="number" class="form-control form-control-sm" id="color-max-${id}" value="${settings.colorMax ?? 100}">
                  </div>
                </div>
              </div>

              <div class="btn-toolbar d-flex flex-row" role="toolbar">
                <div class="btn-group d-flex flex-row flex-nowrap" role="group">
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="center-colormap-${id}">Center at 0</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="reverse-colormap-${id}">Reverse Colormap</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-outliers-${id}">Hide Outliers</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="lock-range-${id}">Lock Range</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="plot-container" id="plot-container-${id}"></div>
    </div>
  `;

  // Inject colormaps into the discrete palette selector
  const categoryPaletteSelector = container.querySelector(`#category-palette-${id}`);
  const groupedColormaps = listAvailableColormaps();  // returns { groupLabel: [names] }
  populateColormapSelectorGrouped(categoryPaletteSelector, groupedColormaps, settings.categoryPalette);

  // Check dataset loading status and show/hide UI elements accordingly
  checkDatasetLoadingStatus(id);

  return {
    plotContainer: document.getElementById(`plot-container-${id}`),
    controlsContainer: container.querySelector('.plot-controls'),
    loadingScreen: document.getElementById(`loading-screen-${id}`)
  };
}

/**
 * Checks if a dataset is loaded and updates UI accordingly
 * @param {string} id - The panel ID
 * @returns {boolean} - Whether a dataset is loaded
 */
export function checkDatasetLoadingStatus(id) {
  const isDatasetLoaded = DataManager.isDatasetLoaded();
  const loadingScreen = document.getElementById(`loading-screen-${id}`);
  const controlsContainer = document.querySelector(`#plot-container-${id}`).closest('.plot-panel').querySelector('.plot-controls');
  
  if (loadingScreen) {
    loadingScreen.style.display = isDatasetLoaded ? 'none' : 'flex';
  }
  
  if (controlsContainer) {
    controlsContainer.style.display = isDatasetLoaded ? 'flex' : 'none';
  }
  
  return isDatasetLoaded;
}

/**
 * Initializes the UI state for the cell plot panel.
 *
 * @param {string} id - Unique ID for this panel instance.
 * @param {Object} settings - Plot settings (x, y, z, color, pointSize, etc.)
 * @param {Function} datasetStructure - The dataset structure object.
 * @param {string} plotType - Type of plot ('cells' or 'genes').
 * @param {HTMLElement} controlsContainer - The container for the plot controls.
 * @returns {Promise<void>} Resolves when UI state is initialized, or rejects with an error
 */
export async function initializeUIState(id, settings, datasetStructure, plotType, controlsContainer) {
  console.log('Initializing UI state with settings:', settings);

  if (!datasetStructure) throw new Error('Failed to load dataset structure');
  
  // Configure the axis type selectors based on plot type
  const isGenePlot = plotType === 'genes';
  const container = controlsContainer.closest('.plot-panel');
  
  // Set up the correct axis options based on plot type
  for (const axis of ['x', 'y', 'z', 'color']) {
    const selector = container.querySelector(`#${axis}-type-select-${id}`);
    if (!selector) continue;
    
    // Clear existing options
    selector.innerHTML = '';
    
    // Add 'none' option for color only
    if (axis === 'color') {
      const noneOption = document.createElement('option');
      noneOption.value = 'none';
      noneOption.textContent = 'None (constant)';
      selector.appendChild(noneOption);
    }
    
    // Add appropriate options based on plot type
    if (isGenePlot) {
      // Gene plot: var, varm, varp, layer
      const varOption = document.createElement('option');
      varOption.value = 'var';
      varOption.textContent = 'var';
      selector.appendChild(varOption);
      
      const varmOption = document.createElement('option');
      varmOption.value = 'varm';
      varmOption.textContent = 'varm';
      varmOption.selected = true;
      selector.appendChild(varmOption);
      
      const varpOption = document.createElement('option');
      varpOption.value = 'varp';
      varpOption.textContent = 'varp';
      selector.appendChild(varpOption);
      
      const layerOption = document.createElement('option');
      layerOption.value = 'layer';
      layerOption.textContent = 'layer';
      selector.appendChild(layerOption);
    } else {
      // Cell plot: obs, obsm, obsp, layer
      const obsOption = document.createElement('option');
      obsOption.value = 'obs';
      obsOption.textContent = 'obs';
      selector.appendChild(obsOption);
      
      const obsmOption = document.createElement('option');
      obsmOption.value = 'obsm';
      obsmOption.textContent = 'obsm';
      obsmOption.selected = true;
      selector.appendChild(obsmOption);
      
      const obspOption = document.createElement('option');
      obspOption.value = 'obsp';
      obspOption.textContent = 'obsp';
      selector.appendChild(obspOption);
      
      const layerOption = document.createElement('option');
      layerOption.value = 'layer';
      layerOption.textContent = 'layer';
      selector.appendChild(layerOption);
    }
  }
  
  // Show the appropriate highlight button
  const highlightFocusedCellButton = container.querySelector(`#highlight-focused-cell-${id}`);
  const highlightFocusedGeneButton = container.querySelector(`#highlight-focused-gene-${id}`);
  
  if (highlightFocusedCellButton && highlightFocusedGeneButton) {
    if (isGenePlot) {
      highlightFocusedCellButton.style.display = 'none';
      highlightFocusedGeneButton.style.display = 'inline-block';
    } else {
      highlightFocusedCellButton.style.display = 'inline-block';
      highlightFocusedGeneButton.style.display = 'none';
    }
  }

  // Try to set default axes from data collection if they're undefined
  function trySetDefaultAxes() {
    // Auto-set default axes from appropriate collection based on plot type
    const collection = isGenePlot ? 'varm' : 'obsm';
    const dataframeCollection = isGenePlot ? datasetStructure?.varm?.dataframes : datasetStructure?.obsm?.dataframes;
    
    if (!dataframeCollection || Object.keys(dataframeCollection).length === 0) {
      console.warn(`No ${collection} dataframes available`);
      return false;
    }
    
    const dataframeKeys = Object.keys(dataframeCollection);
    // Try UMAP first, then look for a key starting with "X_umap", then try PCA, then use the first available key
    let defaultKey =
      dataframeKeys.includes("X_umap") ? "X_umap" :
      dataframeKeys.find(k => k.startsWith("X_umap")) ||
      (dataframeKeys.includes("X_pca") ? "X_pca" : dataframeKeys[0]);

    const defaultFrame = dataframeCollection[defaultKey];
    if (!defaultFrame?.columns?.length || defaultFrame.columns.length < 2) {
      console.warn(`No usable columns in ${collection} dataframe "${defaultKey}"`);
      return false;
    }

    // Only set default x and y if they're not already defined
    if (!settings.x || !settings.x.type) {
      settings.x = { 
        type: collection,
        key: defaultKey,
        column: defaultFrame.columns[0]
      };
    }

    if (!settings.y || !settings.y.type) {
      settings.y = { 
        type: collection,
        key: defaultKey,
        column: defaultFrame.columns[1]
      };
    }

    // Only suggest z-axis if there's a third column available and z is undefined
    if (defaultFrame.columns.length >= 3 && settings.z === undefined) {
      settings.z = {
        type: collection,
        key: defaultKey,
        column: defaultFrame.columns[2]
      };
    }
    
    return true;
  }
  
  // Try to set a default color if not already defined
  function trySetDefaultColor() {
    if (settings.color && settings.color.type !== 'none') {
      return; // Color is already defined
    }
    
    // For gene plots, try to use 'highly_variable' from var as a default color
    if (isGenePlot && datasetStructure?.var?.columns) {
      if (datasetStructure.var.columns.includes('highly_variable')) {
        settings.color = {
          type: 'var',
          key: 'highly_variable',
          column: ''
        };
        return;
      }
    }
    
    // For cell plots, try to use 'leiden' or another clustering from obs as a default color
    if (!isGenePlot && datasetStructure?.obs?.columns) {
      const obsColumns = datasetStructure.obs.columns;
      const clusteringColumn = 
        obsColumns.includes('leiden') ? 'leiden' : 
        obsColumns.includes('louvain') ? 'louvain' :
        obsColumns.find(col => col.includes('cluster'));
      
      if (clusteringColumn) {
        settings.color = {
          type: 'obs',
          key: clusteringColumn,
          column: ''
        };
        console.log(`Setting default color to obs.${clusteringColumn}`);
        return;
      }
    }
  }
  
  // Try to set defaults but don't force them
  trySetDefaultAxes();
  trySetDefaultColor();

  // Ensure all settings objects are properly initialized
  settings.x = settings.x || {};
  settings.y = settings.y || {};
  settings.color = settings.color || { type: isGenePlot ? 'var' : 'obs', key: '', column: '' };

  // Axis selectors
  setupAxisSelector(controlsContainer, 'x', settings.x, plotType, datasetStructure);
  setupAxisSelector(controlsContainer, 'y', settings.y, plotType, datasetStructure);

  if (settings.z) {
    const toggle = document.getElementById(`z-axis-toggle-${id}`);
    toggle?.classList.add('active', 'btn-primary');
    toggle?.classList.remove('btn-outline-secondary');
    toggle?.setAttribute('title', '3rd dimension active - click to disable');

    const zContainer = document.getElementById(`z-axis-container-${id}`);
    if (zContainer) zContainer.style.display = 'block';
    setupAxisSelector(controlsContainer, 'z', settings.z, plotType, datasetStructure);
  } else if (settings.z === undefined) {
    settings.z = null; // ensure no legacy 3D state
  }

  setupAxisSelector(controlsContainer, 'color', settings.color, plotType, datasetStructure);

  // Point controls - ensure sliders reflect the panel's settings
  const pointSizeSlider = document.getElementById(`point-size-${id}`);
  if (pointSizeSlider) pointSizeSlider.value = settings.pointSize;
  
  const pointOpacitySlider = document.getElementById(`point-opacity-${id}`);
  if (pointOpacitySlider) pointOpacitySlider.value = settings.pointOpacity;
  
  // Color controls
  const colorScaleSelect = document.getElementById(`color-scale-${id}`);
  if (colorScaleSelect && settings.colorScale) colorScaleSelect.value = settings.colorScale;
  
  const categoryPaletteSelect = document.getElementById(`category-palette-${id}`);
  if (categoryPaletteSelect && settings.categoryPalette) categoryPaletteSelect.value = settings.categoryPalette;
  
  // Lock range button
  const lockRangeButton = document.getElementById(`lock-range-${id}`);
  if (lockRangeButton) {
    if (settings.lockColorRange) {
      lockRangeButton.classList.add('active', 'btn-primary');
      lockRangeButton.classList.remove('btn-outline-secondary');
    } else {
      lockRangeButton.classList.remove('active', 'btn-primary');
      lockRangeButton.classList.add('btn-outline-secondary');
    }
  }
  
  // Center colormap button
  const centerColormapButton = document.getElementById(`center-colormap-${id}`);
  if (centerColormapButton) {
    if (settings.centeringActive) {
      centerColormapButton.classList.add('active', 'btn-primary');
      centerColormapButton.classList.remove('btn-outline-secondary');
      centerColormapButton.setAttribute('title', 'Centering active - click to disable');
    } else {
      centerColormapButton.classList.remove('active', 'btn-primary');
      centerColormapButton.classList.add('btn-outline-secondary');
      centerColormapButton.setAttribute('title', 'Center color scale at 0');
    }
  }
  
  // Hide outliers button
  const hideOutliersButton = document.getElementById(`hide-outliers-${id}`);
  if (hideOutliersButton) {
    if (settings.hideOutliers) {
      hideOutliersButton.classList.add('active', 'btn-primary');
      hideOutliersButton.classList.remove('btn-outline-secondary');
    } else {
      hideOutliersButton.classList.remove('active', 'btn-primary');
      hideOutliersButton.classList.add('btn-outline-secondary');
    }
  }
  
  // We can't update color sliders here because the data isn't loaded yet
  // Color sliders will be updated after data is loaded during plot creation

  // Validation
  for (const axis of ['x', 'y']) {
    if (!settings[axis]?.key) {
      throw new Error(`No key selected for ${axis}-axis after initialization`);
    }
  }
}