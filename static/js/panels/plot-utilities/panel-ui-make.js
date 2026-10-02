import { listAvailableColormaps } from './colors.js';
import { setupAxisSelector, updateTableFilterSelect, chooseDefaultAxes } from './panel-ui-update.js';
import { Config } from '../../config.js';
import { DataManager } from '../../data-manager.js';
import { initializeAestheticsSettings } from './plot-aesthetics-menu.js';
import * as $ from '../../utils/jquery-helpers.js';
import { syncControlsWithDataset } from '../../utils/controls-visibility.js';

// Create array of discrete color scales
const COLOR_SCALES = (Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Portland'];

/**
 * Injects available colormaps into a <select> element with <optgroup> support.
 * The first element is set to "uns" with the text "As stored in adata.uns".
 * @param {HTMLSelectElement|jQuery} selectElement - The <select> element to populate.
 * @param {Object} colormapGroups - Output of listAvailableColormaps()
 * @param {string} [selected] - Optional selected value.
 */
export function populateColormapSelectorGrouped(selectElement, colormapGroups, selected = '') {
  const $select = jQuery(selectElement);
  
  // clear existing options
  $select.empty();
  
  // Insert the first menu option for "uns" colors
  $select.append(new Option('As stored in adata.uns if available', 'uns', selected === 'uns', selected === 'uns'));

  // Process the remaining colormaps grouped by category
  for (const [groupLabel, colormaps] of Object.entries(colormapGroups)) {
    const $optgroup = jQuery('<optgroup></optgroup>').attr('label', groupLabel);
    
    for (const cmap of colormaps) {
      const isSelected = cmap === selected;
      $optgroup.append(new Option(cmap, cmap, isSelected, isSelected));
    }
    
    $select.append($optgroup);
  }
  
  $select.prop('disabled', false);
}

/**
 * Generates and injects a plot panel HTML structure into the given container.
 *
 * @param {HTMLElement|jQuery} container - The DOM element into which the panel will be rendered.
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
  const $container = jQuery(container);
  
  $container.html(`
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
              <option value="">Loading...</option>
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="${axis}" disabled>
              <option value="">Loading...</option>
            </select>
            <select class="form-select form-select-sm axis-column-select" data-axis="${axis}" disabled>
              <option value="">Loading...</option>
            </select>
          </div>
        </div>
        `).join('')}

        <!-- Z-Axis Selector -->
        <div class="axis-selector-container" id="z-axis-container-${id}" style="display:none;">
          <div class="axis-selector-label">Z-Axis (3D)</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="z" id="z-type-select-${id}">
              <option value="">Loading...</option>
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="z" disabled>
              <option value="">Loading...</option>
            </select>
            <select class="form-select form-select-sm axis-column-select" data-axis="z" disabled>
              <option value="">Loading...</option>
            </select>
          </div>
        </div>

        <!-- Color Controls and Selectors -->
        <div class="color-selector-container">
          <div class="axis-selector-label">Color</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="color" id="color-type-select-${id}">
              <option value="">Loading...</option>
              <option value="none">None (constant)</option>
              <!-- Other options will be set based on plot type -->
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="color" disabled>
              <option value="">Loading...</option>
            </select>
            <select class="form-select form-select-sm axis-column-select" data-axis="color" disabled>
              <option value="">Loading...</option>
            </select>
          </div>

          <div class="color-options mt-2">
            <div class="btn-group" role="group">
              <button class="btn btn-sm btn-outline-secondary me-2" id="z-axis-toggle-${id}">3D Plot</button>
              <button class="btn btn-sm active btn-primary me-2" id="highlight-focused-cell-${id}" style="display:none;">Highlight Focused Cell</button>
              <button class="btn btn-sm active btn-primary me-2" id="highlight-focused-gene-${id}" style="display:none;">Highlight Focused Gene</button>
              <button class="btn btn-sm btn-outline-secondary me-2" id="refresh-plot-${id}">Refresh</button>
              <button class="btn btn-sm btn-outline-secondary me-2" id="aesthetics-menu-btn-${id}"><i class="fas fa-sliders-h"></i> Plot Options</button>
            </div>
            
            <div class="table-filter-controls mb-2 mt-2">
              <div class="d-flex align-items-center">
                <label class="me-2 mb-0">Filter by Table:</label>
                <select class="form-select form-select-sm table-filter-select" id="table-filter-${id}">
                  <option value="none">None</option>
                  <!-- Options populated by external logic -->
                </select>
                <button class="btn btn-sm btn-outline-secondary ms-2" id="remove-non-table-entries-${id}" title="Toggle between coloring non-table entries in gray or completely removing them">
                  <i class="fas fa-eye-slash"></i>
                </button>
              </div>
            </div>

            <div class="point-controls">
              <div class="point-size-control">
                <label>Size:</label>
                <input type="range" class="form-range" min=".1" max="20" step="0.1" value="${settings.pointSize}" id="point-size-${id}">
              </div>
              <div class="point-opacity-control">
                <label>Opacity:</label>
                <input type="range" class="form-range" min="0.01" max="1" step="0.01" value="${settings.pointOpacity}" id="point-opacity-${id}">
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
                  <option value="">Loading palettes...</option>
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
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="lock-range-${id}">Lock Range</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-outliers-${id}">Hide Outliers</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-nan-${id}">Hide NaN</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="sort-by-color-${id}" title="Draw the largest |colour| values on top">Strong on top</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="plot-container" id="plot-container-${id}">
        <div class="datapoint-filter-widget hidden" id="filter-widget-${id}">
          <div class="filter-stats-title">Removed Datapoints</div>
          <ul class="filter-stats-list">
            <!-- Filter stats will be inserted here -->
          </ul>
          <div class="filter-total">
            <span>Total:</span> <span class="filter-total-count">0 (0%)</span>
          </div>
        </div>
      </div>
    </div>
  `);

  // Inject colormaps into the discrete palette selector
  const categoryPaletteSelector = $container.find(`#category-palette-${id}`)[0];
  const groupedColormaps = listAvailableColormaps();  // returns { groupLabel: [names] }
  populateColormapSelectorGrouped(categoryPaletteSelector, groupedColormaps, settings.categoryPalette);

  // Check dataset loading status and show/hide UI elements accordingly
  checkDatasetLoadingStatus(id);

  return {
    plotContainer: document.getElementById(`plot-container-${id}`),
    controlsContainer: $container.find('.plot-controls')[0],
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
  const $loadingScreen = jQuery(`#loading-screen-${id}`);
  const $plotContainer = jQuery(`#plot-container-${id}`);
  
  // Handle case where plot container doesn't exist or isn't in DOM yet
  if (!$plotContainer.length) {
    console.warn(`Plot container with ID plot-container-${id} not found`);
    return isDatasetLoaded;
  }
  
  const $plotPanel = $plotContainer.closest('.plot-panel');
  
  // Handle case where plot panel doesn't exist
  if (!$plotPanel.length) {
    console.warn(`Plot panel for ID ${id} not found`);
    return isDatasetLoaded;
  }
  
  const $controlsContainer = $plotPanel.find('.plot-controls');
  
  if ($loadingScreen.length) {
    $loadingScreen.toggle(!isDatasetLoaded);
  }
  
  // Shows controls only if the user (or a restored view) has not hidden them
  syncControlsWithDataset($controlsContainer[0], isDatasetLoaded);
  
  // Also update the loading status of all select elements
  if ($plotPanel.length) {
    // Update select elements
    $plotPanel.find('select').each(function() {
      const $select = jQuery(this);
      
      if (!isDatasetLoaded) {
        if (!$select.prop('disabled')) {
          $select.prop('disabled', true);
          
          // If the select doesn't have a loading option yet, add one
          if ($select.find('option').length === 0 || 
              $select.find('option:first').val() !== '' || 
              $select.find('option:first').text() !== 'Loading...') {
            $select.prepend('<option value="">Loading...</option>');
            $select.val('');
          }
        }
      }
    });
    
    // Disable buttons when dataset is not loaded
    $plotPanel.find('button').prop('disabled', !isDatasetLoaded);
    
    // Disable range inputs when dataset is not loaded
    $plotPanel.find('input[type="range"]').prop('disabled', !isDatasetLoaded);
    
    // Disable number inputs when dataset is not loaded
    $plotPanel.find('input[type="number"]').prop('disabled', !isDatasetLoaded);
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
  const $container = jQuery(controlsContainer).closest('.plot-panel');
  
  // Set up the correct axis options based on plot type
  for (const axis of ['x', 'y', 'z', 'color']) {
    const $selector = $container.find(`#${axis}-type-select-${id}`);
    if (!$selector.length) continue;
    
    // Clear existing options
    $selector.empty();
    
    // Add 'none' option for color only
    if (axis === 'color') {
      $selector.append(new Option('None (constant)', 'none'));
    }
    
    // Add appropriate options based on plot type
    if (isGenePlot) {
      // Gene plot: var, varm, varp, layer
      const options = [
        { value: 'var', text: 'var' },
        { value: 'varm', text: 'varm', selected: true },
        { value: 'varp', text: 'varp' },
        { value: 'layer', text: 'layer' }
      ];
      
      options.forEach(opt => {
        $selector.append(new Option(opt.text, opt.value, opt.selected, opt.selected));
      });
    } else {
      // Cell plot: obs, obsm, obsp, layer
      const options = [
        { value: 'obs', text: 'obs' },
        { value: 'obsm', text: 'obsm', selected: true },
        { value: 'obsp', text: 'obsp' },
        { value: 'layer', text: 'layer' }
      ];
      
      options.forEach(opt => {
        $selector.append(new Option(opt.text, opt.value, opt.selected, opt.selected));
      });
    }
    
    $selector.prop('disabled', false); // Enable the selector
  }
  
  // Show the appropriate highlight button
  const $highlightFocusedCellButton = $container.find(`#highlight-focused-cell-${id}`);
  const $highlightFocusedGeneButton = $container.find(`#highlight-focused-gene-${id}`);
  
  if ($highlightFocusedCellButton.length && $highlightFocusedGeneButton.length) {
    if (isGenePlot) {
      $highlightFocusedCellButton.hide();
      $highlightFocusedGeneButton.show();
    } else {
      $highlightFocusedCellButton.show();
      $highlightFocusedGeneButton.hide();
    }
  }

  // Try to set default axes from data collection if they're undefined
  function trySetDefaultAxes() {
    const defaults = chooseDefaultAxes(plotType, datasetStructure);
    if (!defaults) {
      return false;
    }

    // Only set default x and y if they're not already defined
    if (!settings.x || !settings.x.type) {
      settings.x = defaults.x;
    }

    if (!settings.y || !settings.y.type) {
      settings.y = defaults.y;
    }

    // Only suggest z-axis if there's a third column available and z is undefined
    if (defaults.z && settings.z === undefined) {
      settings.z = defaults.z;
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
  settings.hideNaN = settings.hideNaN || false;
  
  // Initialize aesthetic settings
  initializeAestheticsSettings(settings);

  // Axis selectors
  setupAxisSelector(controlsContainer, 'x', settings.x, plotType, datasetStructure);
  setupAxisSelector(controlsContainer, 'y', settings.y, plotType, datasetStructure);

  if (settings.z) {
    const $toggle = jQuery(`#z-axis-toggle-${id}`);
    $.updateButtonState($toggle, true);
    $toggle.attr('title', '3rd dimension active - click to disable');

    const $zContainer = jQuery(`#z-axis-container-${id}`);
    $zContainer.show();
    setupAxisSelector(controlsContainer, 'z', settings.z, plotType, datasetStructure);
  } else if (settings.z === undefined) {
    settings.z = null; // ensure no legacy 3D state
  }

  setupAxisSelector(controlsContainer, 'color', settings.color, plotType, datasetStructure);

  // Point controls - ensure sliders reflect the panel's settings
  const $pointSizeSlider = jQuery(`#point-size-${id}`);
  if ($pointSizeSlider.length) $pointSizeSlider.val(settings.pointSize);
  
  const $pointOpacitySlider = jQuery(`#point-opacity-${id}`);
  if ($pointOpacitySlider.length) $pointOpacitySlider.val(settings.pointOpacity);
  
  // Initialize table filter dropdown
  updateTableFilterSelect(controlsContainer, id, plotType, settings.tableFilter);
  
  // Initialize table filter settings if not present
  settings.tableFilter = settings.tableFilter || 'none';
  settings.removeNonTableEntries = settings.removeNonTableEntries || false;
  
  // Set up remove non-table entries button state
  const $removeNonTableEntriesBtn = jQuery(`#remove-non-table-entries-${id}`);
  if ($removeNonTableEntriesBtn.length) {
    if (settings.removeNonTableEntries) {
      $removeNonTableEntriesBtn.addClass('btn-primary').removeClass('btn-outline-secondary');
      $removeNonTableEntriesBtn.attr('title', 'Remove non-table entries (active)');
    } else {
      $removeNonTableEntriesBtn.addClass('btn-outline-secondary').removeClass('btn-primary');
      $removeNonTableEntriesBtn.attr('title', 'Remove non-table entries (inactive)');
    }
  }
  
  // Color controls
  const $colorScaleSelect = jQuery(`#color-scale-${id}`);
  if ($colorScaleSelect.length && settings.colorScale) $colorScaleSelect.val(settings.colorScale);
  
  const $categoryPaletteSelect = jQuery(`#category-palette-${id}`);
  if ($categoryPaletteSelect.length && settings.categoryPalette) $categoryPaletteSelect.val(settings.categoryPalette);
  
  // Lock range button
  const $lockRangeButton = jQuery(`#lock-range-${id}`);
  if ($lockRangeButton.length) {
    $.updateButtonState($lockRangeButton, settings.lockColorRange);
  }
  
  // Center colormap button
  const $centerColormapButton = jQuery(`#center-colormap-${id}`);
  if ($centerColormapButton.length) {
    $.updateButtonState($centerColormapButton, settings.centeringActive);
    $centerColormapButton.attr('title', settings.centeringActive ? 
      'Centering active - click to disable' : 'Center color scale at 0');
  }
  
  // Hide outliers button
  const $hideOutliersButton = jQuery(`#hide-outliers-${id}`);
  if ($hideOutliersButton.length) {
    $.updateButtonState($hideOutliersButton, settings.hideOutliers);
  }
  
  // Strong-on-top button (default on)
  const $sortByColorButton = jQuery(`#sort-by-color-${id}`);
  if ($sortByColorButton.length) {
    $.updateButtonState($sortByColorButton, settings.sortByColor !== false);
  }

  // Hide NaN button
  const $hideNanButton = jQuery(`#hide-nan-${id}`);
  if ($hideNanButton.length) {
    $.updateButtonState($hideNanButton, settings.hideNaN);
  }
  
  // Reverse colormap button
  const $reverseColormapButton = jQuery(`#reverse-colormap-${id}`);
  if ($reverseColormapButton.length) {
    $.updateButtonState($reverseColormapButton, settings.colorReversed);
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