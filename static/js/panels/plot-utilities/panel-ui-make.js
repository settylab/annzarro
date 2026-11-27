import { listAvailableColormaps } from './colors.js';
import { setupAxisSelector, typeChoices, updateTableFilterSelect, chooseDefaultAxes, showPointStyle, showScalePreview, UNS_PALETTE_LABEL } from './panel-ui-update.js';
import { scaleOptionLabel } from '../../utils/color-scales.js';
import { colorBoundToData } from '../../utils/array-stats.js';
import { Config } from '../../config.js';
import { DataManager } from '../../data-manager.js';
import { initializeAestheticsSettings } from './plot-aesthetics-menu.js';
import { createPlotToolbar } from '../../ui/plot-toolbar.js';
import { VOCABULARY } from '../../utils/vocabulary.js';
import * as $ from '../../utils/jquery-helpers.js';
import { syncControlsWithDataset } from '../../utils/controls-visibility.js';
import { populateHoverSelect } from './hover-columns.js';
import { noDatasetScreenHtml } from '../../utils/no-dataset-screen.js';
import { escapeHtml } from '../../utils/safe-markdown.js';
import { SLIDER_STEPS, opacityScale, trackValue } from '../../utils/slider-scales.js';

// Create array of discrete color scales
const COLOR_SCALES = (Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Portland'];

/**
 * Injects available colormaps into a <select> element with <optgroup> support.
 * The first element is set to "uns" with the text UNS_PALETTE_LABEL ("As stored in adata.uns"; a provider's colour names
 * its own, panel-ui-update.js updateColorControlsVisibility).
 * @param {HTMLSelectElement|jQuery} selectElement - The <select> element to populate.
 * @param {Object} colormapGroups - Output of listAvailableColormaps()
 * @param {string} [selected] - Optional selected value.
 */
export function populateColormapSelectorGrouped(selectElement, colormapGroups, selected = '') {
  const $select = jQuery(selectElement);
  
  // clear existing options
  $select.empty();
  
  // Insert the first menu option for "uns" colors
  $select.append(new Option(UNS_PALETTE_LABEL, 'uns', selected === 'uns', selected === 'uns'));

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
 * One axis row of the plot controls: its label and the type, key and column
 * selects. The type menu lists what `consumer` accepts for `roles`; setupAxisSelector
 * fills the key and column selects and appends the lock/refocus buttons.
 * @param {string} axis - 'x', 'y', 'z' or 'color'
 * @param {string} label
 * @param {string} id - the panel's id
 * @param {{plotType: 'cells'|'genes', consumer: string, roles: string[]}} use - the entity a value belongs to,
 *   the panel type, and the roles the row's source fills (['x'], ['color'])
 * @param {string} [attrs]
 */
function axisRow(axis, label, id, { plotType, roles }, attrs = 'class="axis-selector-container ctl-row"') {
  const rowAttrs = attrs.startsWith('class=') ? attrs : `class="axis-selector-container ctl-row" ${attrs}`;
  const types = typeChoices(plotType, roles)
    .map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.text)}</option>`).join('');
  return `
            <div ${rowAttrs}>
              <label class="axis-selector-label ctl-label" for="${axis}-type-select-${id}">${label}</label>
              <div class="axis-selector">
                <select class="form-select form-select-sm axis-type-select" data-axis="${axis}" id="${axis}-type-select-${id}">
                  ${types}
                </select>
                <select class="form-select form-select-sm axis-key-select" data-axis="${axis}" disabled>
                  <option value="">Loading...</option>
                </select>
                <select class="form-select form-select-sm axis-column-select" data-axis="${axis}" disabled>
                  <option value="">Loading...</option>
                </select>
              </div>
            </div>`;
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
 * @param {{plotType: 'cells'|'genes', consumer: string}} panel - the entity a point is and the panel type, which
 *   the axis rows' type menus list sources for
 * @returns {{ plotContainer: HTMLElement, controlsContainer: HTMLElement, loadingScreen: HTMLElement }}
 */
export function createPanelStructure(container, id, settings, { plotType, consumer }) {
  const $container = jQuery(container);
  
  $container.html(`
    <div class="plot-panel">
      ${noDatasetScreenHtml(id)}
      <div class="plot-controls">
        <!-- One grid (styles.css, "Plot controls"): three groups that sit side
             by side, two up or stacked as the panel narrows, and a row of
             toggles under them. A hidden group leaves no gap. -->
        <div class="ctl-grid ctl-no-colour">
          <!-- What is plotted: the axes and the colour source -->
          <div class="ctl-group ctl-axes" role="group" aria-label="Axes and colour">
            ${['x', 'y'].map(axis => axisRow(axis, axis.toUpperCase(), id, { plotType, consumer, roles: [axis] })).join('')}
            ${axisRow('z', 'Z', id, { plotType, consumer, roles: ['z'] }, `id="z-axis-container-${id}" style="display:none;"`)}
            ${axisRow('color', 'Color', id, { plotType, consumer, roles: ['color'] }, 'class="color-selector-container ctl-row"')}
          </div>

          <!-- How the colour is drawn; hidden for a constant colour -->
          <div class="ctl-group ctl-colour color-range-controls" id="color-range-container-${id}" style="display:none;"
               role="group" aria-label="Colour scale">
            <div class="ctl-row">
              <label id="numerical-color-label-${id}" class="numerical-color-label ctl-label" for="color-scale-${id}">Map</label>
              <label id="categorical-color-label-${id}" class="categorical-color-label ctl-label" for="category-palette-${id}" style="display:none;">Palette</label>
              <div class="ctl-field">
                <select class="form-select form-select-sm color-palette-selector" id="color-scale-${id}">
                  ${COLOR_SCALES.map(scale => `
                    <option value="${scale}" ${scale === settings.colorScale ? 'selected' : ''}>${scaleOptionLabel(scale)}</option>
                  `).join('')}
                </select>
                <span class="color-scale-preview" id="color-scale-preview-${id}" aria-hidden="true"></span>
                <select class="form-select form-select-sm category-palette-selector" id="category-palette-${id}" style="display:none;">
                  <option value="">Loading palettes...</option>
                  <!-- Options populated by external logic -->
                </select>
              </div>
            </div>

            <div class="color-range-inputs">
              <div class="color-range-sliders">
                <div class="color-min-slider-container ctl-row ctl-slider">
                  <label class="ctl-label" for="color-min-${id}">Min</label>
                  <input type="range" class="form-range" id="color-min-slider-${id}" min="0" max="${SLIDER_STEPS}" step="1" value="0" title="Percentile of the coloured values" aria-label="Colour minimum (percentile)">
                  <input type="number" class="form-control form-control-sm" id="color-min-${id}" value="${colorBoundToData(settings.colorMin, !!settings.color?.log) ?? 0}">
                </div>
                <div class="color-max-slider-container ctl-row ctl-slider">
                  <label class="ctl-label" for="color-max-${id}">Max</label>
                  <input type="range" class="form-range" id="color-max-slider-${id}" min="0" max="${SLIDER_STEPS}" step="1" value="${SLIDER_STEPS}" title="Percentile of the coloured values" aria-label="Colour maximum (percentile)">
                  <input type="number" class="form-control form-control-sm" id="color-max-${id}" value="${colorBoundToData(settings.colorMax, !!settings.color?.log) ?? 100}">
                </div>
              </div>
            </div>

            <div class="color-log-hint small" id="color-log-hint-${id}" role="status" hidden></div>

            <div class="btn-toolbar ctl-toggles" role="toolbar" aria-label="Colour scale options">
              <div class="ctl-toggle-set" role="group">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="center-colormap-${id}" aria-pressed="false">Center at 0</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="reverse-colormap-${id}" aria-pressed="false">Reverse</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="lock-range-${id}" aria-pressed="false">Lock Range</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-outliers-${id}" aria-pressed="false">Hide Outliers</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-nan-${id}" aria-pressed="false">Hide NaN</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="sort-by-color-${id}" aria-pressed="false" title="Draw the largest |colour| values on top">Strong on top</button>
                <span class="ctl-log">
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="log-color-${id}" aria-pressed="false" title="log10 colour scale; values at or below the floor share its colour">Log</button>
                  <input type="number" class="form-control form-control-sm log-floor-input" id="log-floor-${id}" placeholder="floor: auto" title="Floor for the log colour scale (empty: smallest positive value)" aria-label="Log floor">
                </span>
              </div>
            </div>
          </div>

          <!-- How the points are drawn and labelled -->
          <div class="ctl-group ctl-points" role="group" aria-label="Points">
            <div class="point-controls">
              <div class="point-opacity-control ctl-row ctl-slider">
                <label class="ctl-label" for="point-opacity-input-${id}">Opacity</label>
                <input type="range" class="form-range" min="0" max="${SLIDER_STEPS}" step="1" value="${trackValue(opacityScale, settings.pointOpacity)}" id="point-opacity-${id}"
                       title="Marker opacity (log scale)" aria-label="Point opacity (log scale)">
                <input type="number" class="form-control form-control-sm" min="0" max="1" step="any" value="${settings.pointOpacity}" id="point-opacity-input-${id}" title="Marker opacity, 0 to 1">
                <span class="point-auto"><button type="button" class="btn btn-sm btn-outline-secondary point-auto-btn" id="point-opacity-auto-${id}"
                      title="Automatic opacity: follows the number of points drawn (in view when zoomed)">auto</button></span>
              </div>
            </div>

            <div class="table-filter-controls ctl-row">
              <label class="ctl-label" for="table-filter-${id}" title="Filter by table">Table</label>
              <div class="ctl-field">
                <select class="form-select form-select-sm table-filter-select" id="table-filter-${id}" aria-label="Filter by table">
                  <option value="none">None</option>
                  <!-- Options populated by external logic -->
                </select>
                <button class="btn btn-sm btn-outline-secondary" id="remove-non-table-entries-${id}" aria-pressed="false" title="Toggle between colouring non-table entries in grey or completely removing them">
                  <i class="fas fa-eye-slash"></i>
                </button>
              </div>
            </div>

            <div class="hover-columns-controls ctl-row">
              <label class="ctl-label" for="hover-columns-${id}">Hover</label>
              <select multiple size="3" class="form-select form-select-sm hover-columns-select" id="hover-columns-${id}"
                      aria-label="Columns listed in the hover label" title="Columns listed in the hover label (Ctrl/Cmd-click for several)">
              </select>
            </div>
          </div>

          <!-- Panel-wide toggles and actions -->
          <div class="color-options ctl-actions">
            <span class="ctl-actions-toggles" role="group" aria-label="View">
              <button class="btn btn-sm btn-outline-secondary" id="z-axis-toggle-${id}" aria-pressed="false" title="${VOCABULARY.plotPanel.view3dHelp}">${VOCABULARY.plotPanel.view3d}</button>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="equal-aspect-${id}" aria-pressed="false" title="Same scale on x and y (spatial coordinates)">Equal aspect</button>
              <button class="btn btn-sm active btn-primary" id="highlight-focused-cell-${id}" aria-pressed="true" style="display:none;">Highlight Focused Cell</button>
              <button class="btn btn-sm active btn-primary" id="highlight-focused-gene-${id}" aria-pressed="true" style="display:none;">Highlight Focused Gene</button>
            </span>
            <span class="ctl-actions-end" role="group" aria-label="Plot actions">
              <button class="btn btn-sm btn-outline-secondary" id="aesthetics-menu-btn-${id}" title="Plot options" aria-label="Plot options"><i class="fas fa-sliders-h"></i> <span class="ctl-btn-text">Plot Options</span></button>
            </span>
          </div>
        </div>
      </div>
      <div class="plot-container" id="plot-container-${id}"></div>
    </div>
  `);

  // Inject colormaps into the discrete palette selector
  const categoryPaletteSelector = $container.find(`#category-palette-${id}`)[0];
  const groupedColormaps = listAvailableColormaps();  // returns { groupLabel: [names] }
  populateColormapSelectorGrouped(categoryPaletteSelector, groupedColormaps, settings.categoryPalette);

  // Check dataset loading status and show/hide UI elements accordingly
  checkDatasetLoadingStatus(id);

  // The shared plot toolbar (ui/plot-toolbar.js; design note options-ux-080 section 4, WP-5b): the panel's actions
  // first (the view toggles, Refresh last of them, so that it can go on its own), then Undo (plot-undo.js) and Plot
  // Options at the row's right end, the same places as in every plot panel. The buttons are the ones drawn above (their
  // ids and listeners stay); the row ends the control grid.
  const actionsRow = $container.find('.ctl-actions')[0];
  if (actionsRow) {
    const q = (sel) => actionsRow.querySelector(sel);
    const toolbar = createPlotToolbar({
      className: 'ctl-toolbar',
      actions: [q(`#z-axis-toggle-${id}`), q(`#equal-aspect-${id}`), q(`#highlight-focused-cell-${id}`), q(`#highlight-focused-gene-${id}`),
        q(`#refresh-plot-${id}`)].filter(Boolean),
      options: q(`#aesthetics-menu-btn-${id}`)
    });
    actionsRow.replaceWith(toolbar.element);
  }
  // The point size is Plot Options' (Points group, options-popover.js): it is not in this grid; its opacity stays here.

  const controlsContainer = $container.find('.plot-controls')[0];
  // The axis selects' change handlers are bound only after the panel's first draw (the panel's init awaits the dataset, then
  // sets its listeners up), but the selects are filled before: a choice made in between would show in the select and be
  // ignored by the panel. The rows are inert until the panel says its handlers are bound (axisControlsReady).
  holdAxisControls(controlsContainer, true);

  return {
    plotContainer: document.getElementById(`plot-container-${id}`),
    controlsContainer,
    loadingScreen: document.getElementById(`loading-screen-${id}`)
  };
}

/**
 * Hold (`hold` true) or release the axis rows of a plot panel's controls. Held, no one can change an axis (inert: no mouse,
 * no keyboard, not focusable) and the controls say they are `data-axis-controls="loading"`; released, `"ready"`. A panel
 * releases them once its change handlers are bound, whether or not its first draw worked.
 * @param {HTMLElement} controlsContainer
 * @param {boolean} hold
 */
export function holdAxisControls(controlsContainer, hold) {
  if (!controlsContainer) return;
  controlsContainer.dataset.axisControls = hold ? 'loading' : 'ready';
  for (const row of controlsContainer.querySelectorAll('.axis-selector')) {
    row.inert = !!hold;
    if (hold) row.title = 'Loading\u2026'; else row.removeAttribute('title');
  }
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
          // what to give back when a dataset comes (below)
          this.dataset.noDatasetValue = JSON.stringify($select.val() ?? '');
          $select.prop('disabled', true);

          // If the select doesn't have a loading option yet, add one
          if ($select.find('option').length === 0 ||
              $select.find('option:first').val() !== '' ||
              $select.find('option:first').text() !== 'Loading...') {
            $select.prepend('<option value="">Loading...</option>');
            $select.val('');
          }
        }
      } else if (this.dataset.noDatasetValue !== undefined) {
        // Disabled above while there was no dataset: a panel made then is
        // checked again when the dataset comes, and its selects that the
        // panel's own setup does not refill (palettes, hover columns, the
        // table filter) were left disabled, still showing "Loading...".
        const $loading = $select.find('option:first');
        if ($loading.val() === '' && $loading.text() === 'Loading...') $loading.remove();
        $select.val(JSON.parse(this.dataset.noDatasetValue));
        $select.prop('disabled', false);
        delete this.dataset.noDatasetValue;
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
 * @param {string} consumer - the panel type ('cell-plot', 'gene-plot'): what its type menus list
 * @returns {Promise<void>} Resolves when UI state is initialized, or rejects with an error
 */
export async function initializeUIState(id, settings, datasetStructure, plotType, controlsContainer, consumer) {
  console.log('Initializing UI state with settings:', settings);

  if (!datasetStructure) throw new Error('Failed to load dataset structure');
  
  const isGenePlot = plotType === 'genes';
  const $container = jQuery(controlsContainer).closest('.plot-panel');
  
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
    const fillX = !settings.x || !settings.x.type;
    const fillY = !settings.y || !settings.y.type;
    if (fillX) {
      settings.x = defaults.x;
    }

    if (fillY) {
      settings.y = defaults.y;
    }

    // Equal aspect starts on for a cell plot whose x AND y were both filled
    // here from one embedding (UMAP, t-SNE, PCA, spatial): one unit is as long
    // on both axes, whatever the tile's shape. Absent means "not chosen": a
    // value the user, a link, a panel set or a session set (true or false) is
    // never touched, and a link that fixes its own axes keeps opening as it did.
    if (fillX && fillY && !isGenePlot && settings.equalAspect === undefined
        && defaults.x.type === 'obsm' && defaults.x.key === defaults.y.key) {
      settings.equalAspect = true;
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
          column: '',
          auto: true
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
          column: '',
          auto: true
        };
        console.log(`Setting default color to obs.${clusteringColumn}`);
        return;
      }
    }
  }
  
  // A colour the panel picked itself (`auto`, cleared by the colour menus) on
  // another dataset is not the user's: where this dataset lacks the column it
  // is dropped and the default chosen again, instead of reporting a column
  // nobody asked for as "not in this dataset". A colour the user picked stays.
  const autoColor = settings.color;
  if (autoColor && autoColor.auto) {
    const columns = datasetStructure?.[autoColor.type]?.columns;
    if (Array.isArray(columns) && !columns.includes(autoColor.key)) delete settings.color;
  }

  // Try to set defaults but don't force them
  trySetDefaultAxes();
  trySetDefaultColor();

  // the button follows the setting: the listeners may have been set up before the dataset came
  $.updateButtonState($container.find(`#equal-aspect-${id}`), !!settings.equalAspect);

  // Ensure all settings objects are properly initialized
  settings.x = settings.x || {};
  settings.y = settings.y || {};
  settings.color = settings.color || { type: isGenePlot ? 'var' : 'obs', key: '', column: '' };
  settings.hideNaN = settings.hideNaN || false;
  
  // Initialize aesthetic settings
  initializeAestheticsSettings(settings);

  // Axis selectors
  setupAxisSelector(controlsContainer, 'x', settings.x, plotType, datasetStructure, { consumer, roles: ['x'], aggregate: true });
  setupAxisSelector(controlsContainer, 'y', settings.y, plotType, datasetStructure, { consumer, roles: ['y'], aggregate: true });

  if (settings.z) {
    const $toggle = jQuery(`#z-axis-toggle-${id}`);
    $.updateButtonState($toggle, true);
    $toggle.attr('title', '3rd dimension active - click to disable');

    const $zContainer = jQuery(`#z-axis-container-${id}`);
    $zContainer.show();
    setupAxisSelector(controlsContainer, 'z', settings.z, plotType, datasetStructure, { consumer, roles: ['z'], aggregate: true });
  } else if (settings.z === undefined) {
    settings.z = null; // ensure no legacy 3D state
  }

  setupAxisSelector(controlsContainer, 'color', settings.color, plotType, datasetStructure, { consumer, roles: ['color'], aggregate: true });

  // Point controls - ensure sliders reflect the panel's settings
  showPointStyle(id, settings);
  
  // Hover columns picker (settings.hoverInfo)
  populateHoverSelect(document.getElementById(`hover-columns-${id}`), plotType, datasetStructure, settings.hoverInfo, settings.hoverOff);

  // Initialize table filter dropdown
  updateTableFilterSelect(controlsContainer, id, plotType, settings.tableFilter);
  
  // Initialize table filter settings if not present
  settings.tableFilter = settings.tableFilter || 'none';
  settings.removeNonTableEntries = settings.removeNonTableEntries || false;
  
  // Set up remove non-table entries button state
  const $removeNonTableEntriesBtn = jQuery(`#remove-non-table-entries-${id}`);
  if ($removeNonTableEntriesBtn.length) {
    $.updateButtonState($removeNonTableEntriesBtn, settings.removeNonTableEntries, 'btn-primary');
    $removeNonTableEntriesBtn.attr('title', `Remove non-table entries (${settings.removeNonTableEntries ? 'active' : 'inactive'})`);
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
  // The swatch draws an off-screen plot to resolve the map: only once the
  // swatch is on screen (controls open, colour numerical), and then when
  // the browser is idle, not on the way to the panel's first plot.
  const preview = () => showScalePreview(jQuery(`#color-range-container-${id}`), id, settings);
  const whenIdle = () => (typeof requestIdleCallback === 'function'
    ? requestIdleCallback(preview, { timeout: 5000 }) : setTimeout(preview, 1000));
  const swatch = document.getElementById(`color-scale-preview-${id}`);
  if (swatch && typeof IntersectionObserver === 'function') {
    const seen = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { seen.disconnect(); whenIdle(); }
    });
    seen.observe(swatch);
  } else {
    whenIdle();
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