import { DataManager } from '../../data-manager.js';
import * as $ from '../../utils/jquery-helpers.js';
import { updatePlotElements } from './plot-update.js';
import { formatRangeValue } from '../../utils/array-stats.js';
import { SLIDER_STEPS, pointSizeScale, opacityScale, quantileScale, mirroredScale, trackValue, valueAt } from '../../utils/slider-scales.js';
import { layerKeys, keyExistsInStructure } from '../../utils/structure-keys.js';
import { notify } from '../../utils/notify.js';

// Annotation columns that are numeric in a typical scanpy/anndata object, in
// the order we would rather plot them. Used only when the matrix source is
// absent, so a dataset without varm (or obsm) still opens on something real.
const PREFERRED_ANNOTATION_AXES = {
  genes: ['means', 'mean', 'dispersions_norm', 'dispersions', 'variances_norm', 'variances',
          'mean_counts', 'total_counts', 'n_cells_by_counts', 'n_cells', 'pct_dropout_by_counts'],
  cells: ['total_counts', 'n_genes_by_counts', 'n_genes', 'n_counts', 'pct_counts_mt']
};

/**
 * Whether a dataset has at least one entry in a matrix collection (obsm/varm).
 * @param {Object} datasetStructure - Structure of the loaded dataset
 * @param {string} collection - 'obsm' or 'varm'
 * @returns {boolean}
 */
export function hasMatrixEntries(datasetStructure, collection) {
  const entry = datasetStructure?.[collection];
  return Object.keys(entry?.dataframes || {}).length > 0 || (entry?.keys?.length || 0) > 0;
}

/**
 * The source a fresh x/y/z axis starts on: the matrix collection (varm for
 * gene plots, obsm for cell plots) when the dataset has one, otherwise the
 * annotation dataframe (var / obs). Defaulting to an EMPTY varm left the axis
 * with no key, and initializeUIState then threw "No key selected".
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} datasetStructure - Structure of the loaded dataset
 * @returns {string}
 */
export function defaultAxisType(plotType, datasetStructure) {
  const matrix = plotType === 'genes' ? 'varm' : 'obsm';
  const annotation = plotType === 'genes' ? 'var' : 'obs';
  return hasMatrixEntries(datasetStructure, matrix) ? matrix : annotation;
}

/**
 * Default x/y (and possibly z) axes for a new plot.
 *
 * Prefers a matrix embedding (X_umap, then X_pca, then the first entry); when
 * there is no usable one, falls back to two distinct annotation columns.
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} datasetStructure - Structure of the loaded dataset
 * @returns {{x: Object, y: Object, z?: Object}|null} null when nothing usable exists
 */
export function chooseDefaultAxes(plotType, datasetStructure) {
  const isGenePlot = plotType === 'genes';
  const collection = isGenePlot ? 'varm' : 'obsm';
  const dataframeCollection = datasetStructure?.[collection]?.dataframes;

  if (dataframeCollection && Object.keys(dataframeCollection).length > 0) {
    const dataframeKeys = Object.keys(dataframeCollection);
    // Try UMAP first, then look for a key starting with "X_umap", then try PCA, then use the first available key
    const defaultKey =
      dataframeKeys.includes("X_umap") ? "X_umap" :
      dataframeKeys.find(k => k.startsWith("X_umap")) ||
      (dataframeKeys.includes("X_pca") ? "X_pca" : dataframeKeys[0]);
    const columns = dataframeCollection[defaultKey]?.columns || [];
    if (columns.length >= 2) {
      const axes = {
        x: { type: collection, key: defaultKey, column: columns[0] },
        y: { type: collection, key: defaultKey, column: columns[1] }
      };
      if (columns.length >= 3) {
        axes.z = { type: collection, key: defaultKey, column: columns[2] };
      }
      return axes;
    }
    console.warn(`No usable columns in ${collection} dataframe "${defaultKey}"`);
  } else {
    console.warn(`No ${collection} dataframes available`);
  }

  // Fall back to the annotation dataframe (var / obs).
  const annotation = isGenePlot ? 'var' : 'obs';
  const available = (datasetStructure?.[annotation]?.columns || []).filter(c => c !== '_index');
  const preferred = PREFERRED_ANNOTATION_AXES[plotType] || [];
  const ordered = [
    ...preferred.filter(c => available.includes(c)),
    ...available.filter(c => !preferred.includes(c))
  ];
  if (ordered.length < 2) return null;
  return {
    x: { type: annotation, key: ordered[0], column: '' },
    y: { type: annotation, key: ordered[1], column: '' }
  };
}

/** What a cell's label adds when the subset does not show it. */
export const NOT_SHOWN = ' (not shown)';

/**
 * The label of an axis column option that follows the focused cell or gene.
 * One wording everywhere: the menus said "Focused cell to X" when built and
 * "Focused cell X" after a focus change (cell-plot.js / gene-plot.js).
 * @param {'cells'|'genes'} entity
 * @param {string} name
 * @returns {string}
 */
export function focusedOptionLabel(entity, name, locked = false) {
  // a locked axis names the entity it is locked to, and says so; and a cell
  // the subset does not show, so (main.js relabels once that is known)
  const label = `${locked ? 'Locked' : 'Focused'} ${entity === 'cells' ? 'cell' : 'gene'} ${name}`;
  return entity === 'cells' && DataManager.cellShown(name) === false ? `${label}${NOT_SHOWN}` : label;
}

/**
 * Populates only the key selector for a given axis.
 * @param {Object} settings - Axis settings object (will be updated)
 * @param {HTMLSelectElement} keySelect - The key select dropdown
 * @param {Object} datasetStructure - Structure of the loaded dataset
 */
export function populateKeySelector(settings, keySelect, datasetStructure) {
    const type = settings.type || 'layer';
    let keyOptions = [];
    const $keySelect = jQuery(keySelect);
    $keySelect.prop('disabled', false);
  
    // Initialize the settings history if it doesn't exist
    if (!settings.history) {
      settings.history = {};
    }
    
    // Initialize the type history if it doesn't exist
    if (!settings.history[type]) {
      settings.history[type] = { key: null };
    }
  
    switch (type) {
      case 'none': {
        keyOptions = [{ value: '', text: 'N/A', selected: false }];
        $keySelect.prop('disabled', true);
        break;
      }
      case 'obs': {
        let columns = datasetStructure.obs?.columns || Object.keys(datasetStructure.obs || {});
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = columns.map(col => ({ value: col, text: col }));
        break;
      }
      case 'obsm': {
        let keys = Object.keys(datasetStructure.obsm?.dataframes || {});
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => ({ value: key, text: key }));
        break;
      }
      case 'obsp': {
        let keys = datasetStructure.obsp?.keys || [];
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => ({ value: key, text: key }));
        break;
      }
      case 'layer': {
        // X first, then the layers (layerKeys): X was not offered at all
        let keys = layerKeys(datasetStructure);
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => ({ value: key, text: key }));
        break;
      }
      case 'var': {
        let columns = datasetStructure.var?.columns || Object.keys(datasetStructure.var || {});
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = columns.map(col => ({ value: col, text: col }));
        break;
      }
      case 'varm':
      case 'varp': {
        let keys = datasetStructure[type]?.keys || [];
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => ({ value: key, text: key }));
        break;
      }
      default:
        console.warn(`Unsupported type in populateKeySelector: ${type}`);
    }
  
    // Use jQuery to populate the select element
    if (keyOptions.length) {
      $.createSelect(keyOptions, $keySelect);
    } else {
      $.createSelect([{ value: '', text: 'No options available' }], $keySelect);
    }
  
    const keyValues = $keySelect.find('option').map(function() {
      return jQuery(this).val();
    }).get();
    
    // First check if current selection is valid
    if (keyValues.includes(settings.key)) {
      // Current key is valid, keep it
    }
    // If not, try to restore previously used key for this type
    else if (settings.history[type].key && keyValues.includes(settings.history[type].key)) {
      settings.key = settings.history[type].key;
    } 
    // Last resort: use first available key, but avoid _index if possible
    else {
      const wanted = settings.key;
      if (wanted && !keyExistsInStructure(datasetStructure, wanted)) {
        // A key the dataset does not have at all (a deep link or panel set
        // from another dataset) is KEPT, listed as missing, and reported:
        // the loader then states the gap ('not in this dataset') instead of
        // the plot silently showing some other column.
        $.createSelect([...keyOptions, { value: wanted, text: `${wanted} (not in this dataset)` }], $keySelect);
        notify('Plot source not found',
          `${type} "${wanted}" is not in this dataset; nothing is shown for it. Pick another ${type} key.`,
          'warning');
      } else if (type === 'obs' || type === 'var') {
        // The user switched the type menu: take a key of the new type,
        // avoiding _index if there are other options
        const nonIndexKey = keyValues.find(k => k !== '_index');
        settings.key = nonIndexKey || keyValues[0] || '';
      } else {
        settings.key = keyValues[0] || '';
      }
    }
    
    // Set the select value using jQuery
    $.setSelectValue($keySelect, settings.key, false);
}
  
/**
 * Populates only the column selector based on current key.
 * @param {Object} settings - Axis settings object (will be updated)
 * @param {HTMLSelectElement} columnSelect - The column select dropdown
 * @param {string} axis - Axis name ('x', 'y', 'z', or 'color')
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} datasetStructure - Structure of the loaded dataset
 */
export function populateColumnSelector(settings, columnSelect, axis, plotType, datasetStructure) {
  // Initialize the settings history if it doesn't exist
  if (!settings.history) {
    settings.history = {};
  }
  
  // Make sure we have the type defined
  const type = settings.type || (plotType === 'cells' ? 'obsm' : 'varm');
  
  // Initialize the type history if it doesn't exist
  if (!settings.history[type]) {
    settings.history[type] = { key: '', columns: {} };
  }
  
  // Initialize the columns object for this type if it doesn't exist
  if (!settings.history[type].columns) {
    settings.history[type].columns = {};
  }
  
  let columnOptions = [];
  const $columnSelect = jQuery(columnSelect);
  $columnSelect.prop('disabled', false);

  switch (type) {
    case 'obs':
    case 'var': {
      columnOptions = [{ value: '', text: 'N/A' }];
      $columnSelect.prop('disabled', true);
      break;
    }
    case 'obsm': {
      const df = datasetStructure.obsm?.dataframes?.[settings.key];
      let columns = df?.columns || [];
      if (columns.length > 0) {
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        columnOptions = columns.map(col => ({ value: col, text: col }));
        
        // Try to use previously saved column for this key
        if (settings.history[type]?.columns?.[settings.key] && columns.includes(settings.history[type].columns[settings.key])) {
          settings.column = settings.history[type].columns[settings.key];
        } else if (!columns.includes(settings.column)) {
          // Fall back to positional mapping if no history or not in available columns
          const axisIndexMap = { x: 0, y: 1, z: 2 };
          let idx = axisIndexMap[axis] || 0;
          
          // Skip _index column if possible
          if (columns[idx] === "_index" && columns.length > idx + 1) {
            idx += 1;
          } else if (idx === 0 && columns[0] === "_index" && columns.length > 1) {
            // If we're about to default to index 0 and it's "_index", use the next one
            settings.column = columns[1];
            return;
          }
          
          settings.column = columns[idx] || columns[0];
        }
      } else {
        columnOptions = Array.from({ length: 3 }, (_, i) => ({ value: i.toString(), text: i.toString() }));
        if (!['0', '1', '2'].includes(settings.column)) {
          settings.column = axis === 'x' ? '0' : axis === 'y' ? '1' : '2';
        }
      }
      break;
    }
    case 'varm': {
      const df = datasetStructure.varm?.dataframes?.[settings.key];
      let columns = df?.columns || [];
      if (columns.length > 0) {
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        columnOptions = columns.map(col => ({ value: col, text: col }));
        
        // Try to use previously saved column for this key
        if (settings.history[type]?.columns?.[settings.key] && columns.includes(settings.history[type].columns[settings.key])) {
          settings.column = settings.history[type].columns[settings.key];
        } else if (!columns.includes(settings.column)) {
          // Fall back to positional mapping if no history or not in available columns
          const axisIndexMap = { x: 0, y: 1, z: 2 };
          let idx = axisIndexMap[axis] || 0;
          
          // Skip _index column if possible
          if (columns[idx] === "_index" && columns.length > idx + 1) {
            idx += 1;
          } else if (idx === 0 && columns[0] === "_index" && columns.length > 1) {
            // If we're about to default to index 0 and it's "_index", use the next one
            settings.column = columns[1];
            return;
          }
          
          settings.column = columns[idx] || columns[0];
        }
      } else {
        columnOptions = Array.from({ length: 3 }, (_, i) => ({ value: i.toString(), text: i.toString() }));
        if (!['0', '1', '2'].includes(settings.column)) {
          settings.column = axis === 'x' ? '0' : axis === 'y' ? '1' : '2';
        }
      }
      break;
    }
    case 'obsp': {
      // obsp/varp/layer "columns" are entity names chosen by focus, not a
      // listed set, so a remembered value is only gated on the lock. There is
      // no `columns` array in scope here (it is block-scoped to obsm/varm);
      // referencing one threw a ReferenceError when an axis returned to obsp.
      let focused;
      if (settings.column && settings.type === 'obsp' && settings.locked) {
        focused = settings.column;
      } else if (settings.history[type]?.columns?.[settings.key] && settings.history[type]?.locked) {
        settings.column = settings.history[type].columns[settings.key];
        focused = settings.column;
      } else {
        focused = DataManager.getFocusedCell();
        settings.column = focused;
      }
      columnOptions = focused ? 
        [{ value: focused, text: focusedOptionLabel('cells', focused, !!(settings.locked || settings.history[type]?.locked)) }] : 
        [{ value: '', text: 'Select a focused cell first' }];
      break;
    }
    case 'varp': {
      let focused;
      if (settings.column && settings.type === 'varp' && settings.locked) {
        focused = settings.column;
      } else if (settings.history[type]?.columns?.[settings.key] && settings.history[type]?.locked) {
        settings.column = settings.history[type].columns[settings.key];
        focused = settings.column;
      } else {
        focused = DataManager.getFocusedGene();
        settings.column = focused;
      }
      columnOptions = focused ? 
        [{ value: focused, text: focusedOptionLabel('genes', focused, !!(settings.locked || settings.history[type]?.locked)) }] : 
        [{ value: '', text: 'Select a focused gene first' }];
      break;
    }
    case 'layer': {
      let focused;
      if (plotType === 'cells') {
        if (settings.column && settings.type === 'layer' && settings.locked) {
          focused = settings.column;
        } else if (settings.history[type]?.columns?.[settings.key] && settings.history[type]?.locked) {
          settings.column = settings.history[type].columns[settings.key];
          focused = settings.column;
        } else {
          focused = DataManager.getFocusedGene();
          settings.column = focused;
        }
        columnOptions = focused ? 
          [{ value: focused, text: focusedOptionLabel('genes', focused, !!(settings.locked || settings.history[type]?.locked)) }] : 
          [{ value: '', text: 'Select a focused gene first' }];
      } else if (plotType === 'genes') {
        if (settings.column && settings.type === 'layer' && settings.locked) {
          focused = settings.column;
        } else if (settings.history[type]?.columns?.[settings.key] && settings.history[type]?.locked) {
          settings.column = settings.history[type].columns[settings.key];
          focused = settings.column;
        } else {
          focused = DataManager.getFocusedCell();
          settings.column = focused;
        }
        columnOptions = focused ? 
          [{ value: focused, text: focusedOptionLabel('cells', focused, !!(settings.locked || settings.history[type]?.locked)) }] : 
          [{ value: '', text: 'Select a focused cell first' }];
      }
      break;
    }
  }

  // Use jQuery to populate the select element
  $.createSelect(columnOptions, $columnSelect);

  const colValues = $columnSelect.find('option').map(function() {
    return jQuery(this).val();
  }).get();
  
  // First check if current column selection is valid
  if (!colValues.includes(settings.column)) {
    settings.column = $columnSelect.val() || '';
  }
  
  // Set the select value using jQuery
  $.setSelectValue($columnSelect, settings.column, false);
}

/**
 * Shows or hides a loading indicator for a dropdown
 * @param {HTMLElement} dropdown - The select element
 */
export function showDropdownLoading(dropdown) {
  if (!dropdown) return;
  const $dropdown = jQuery(dropdown);
  $dropdown.html('<option value="">Loading... </option>');
  $dropdown.prop('disabled', true);
}

/**
 * Function to set up axis selector.
 * @param {HTMLElement} container - The root DOM element containing the selector elements.
 * @param {string} axis - Axis name (x, y, z, color)
 * @param {Object} settings - Axis settings (will be updated)
 * @param {string} plotType - Either 'cells' or 'genes'
 * @param {Object} datasetStructure - Dataset structure as returned from DataManager
 * @returns {Promise<void>}
 */
export function setupAxisSelector(container, axis, settings, plotType, datasetStructure) {
    const $container = jQuery(container);
    const $typeSelect = $container.find(`.axis-type-select[data-axis="${axis}"]`);
    const $keySelect = $container.find(`.axis-key-select[data-axis="${axis}"]`);
    const $columnSelect = $container.find(`.axis-column-select[data-axis="${axis}"]`);
  
    if (!$typeSelect.length || !$keySelect.length || !$columnSelect.length) {
      console.error(`Missing select elements for ${axis} axis`);
      return;
    }
    
    // Show loading indicators while initializing
    showDropdownLoading($keySelect);
    showDropdownLoading($columnSelect);
  
    // Initialize if completely empty
    if (!settings.type) {
      // Default to 'none' for color, otherwise varm/obsm when present, else var/obs
      settings.type = axis === 'color' ? 'none' : defaultAxisType(plotType, datasetStructure);
    }
    
    // Initialize other required fields
    settings.key = settings.key || '';
    settings.column = settings.column || '';
    
    // Set the UI value
    $.setSelectValue($typeSelect, settings.type, false);
  
    // Populate dropdowns which will replace loading indicators
    populateKeySelector(settings, $keySelect[0], datasetStructure);
    populateColumnSelector(settings, $columnSelect[0], axis, plotType, datasetStructure);
    
    // Add or update the refocus and lock buttons for layer, obsp, and varp types
    const $axisSelector = $columnSelect.closest('.axis-selector');
    if ($axisSelector.length) {
      // Check if the type requires the special buttons
      const needsSpecialButtons = ['layer', 'obsp', 'varp'].includes(settings.type);
      
      // Get existing buttons container if it exists
      let $buttonsContainer = $axisSelector.find(`.axis-special-buttons-${axis}`);
      
      // If container exists but buttons not needed, remove it
      if ($buttonsContainer.length && !needsSpecialButtons) {
        $buttonsContainer.remove();
        return;
      }
      
      // If buttons are needed but container doesn't exist, create it
      if (needsSpecialButtons && !$buttonsContainer.length) {
        $buttonsContainer = $.createElement('div', {
          class: `axis-special-buttons-${axis}`
        });
        
        // Create refocus button
        // Classes + data-axis, not ids: 'refocus-x' / 'lock-color' repeated in
        // every plot panel on the page (duplicate DOM ids)
        const $refocusButton = $.createElement('button', {
          class: 'btn btn-sm btn-outline-secondary axis-refocus-btn',
          title: 'Refocus to current selection',
          'data-axis': axis,
          'data-type': settings.type
        }, '<i class="fas fa-crosshairs"></i>');
        $buttonsContainer.append($refocusButton);
        
        // Create lock button
        const $lockButton = $.createElement('button', {
          class: 'btn btn-sm btn-outline-secondary axis-lock-btn',
          'data-axis': axis,
          'data-type': settings.type
        });
        $buttonsContainer.append($lockButton);
        
        // Add container to DOM
        $axisSelector.append($buttonsContainer);
      } 
      
      // If buttons are needed and container exists, update button properties
      if (needsSpecialButtons && $buttonsContainer.length) {
        // Initialize the locked state if not already set
        if (settings.locked === undefined) {
          settings.locked = false;
        }
        
        // Get references to buttons
        const $refocusButton = $buttonsContainer.find('.axis-refocus-btn');
        const $lockButton = $buttonsContainer.find('.axis-lock-btn');
        
        // Update data type attribute for both buttons
        if ($refocusButton.length) {
          $refocusButton.attr('data-type', settings.type);
        }
        
        if ($lockButton.length) {
          $lockButton.attr('data-type', settings.type);
          
          // Apply the right classes based on locked state
          $.updateButtonState($lockButton, settings.locked, 'btn-primary active', 'btn-outline-secondary');
          
          // Update title and icon
          if (settings.locked) {
            $lockButton.attr('title', 'Unlock (follow focused element)');
            $lockButton.html('<i class="fas fa-lock"></i>');
          } else {
            $lockButton.attr('title', 'Lock (keep current selection)');
            $lockButton.html('<i class="fas fa-lock-open"></i>');
          }
        }
        
        // Show refocus button if locked and there's a different focus available
        if ($refocusButton.length) {
          const shouldShowRefocus = settings.locked && (
            (settings.type === 'layer' && plotType === 'cells' && DataManager.getFocusedGene() && DataManager.getFocusedGene() !== settings.column) ||
            (settings.type === 'layer' && plotType === 'genes' && DataManager.getFocusedCell() && DataManager.getFocusedCell() !== settings.column) ||
            (settings.type === 'obsp' && DataManager.getFocusedCell() && DataManager.getFocusedCell() !== settings.column) ||
            (settings.type === 'varp' && DataManager.getFocusedGene() && DataManager.getFocusedGene() !== settings.column)
          );
          
          $.showHide($refocusButton, shouldShowRefocus, 'inline-flex');
        }
      }
    }
  
    console.log(`Axis '${axis}' setup complete with type='${settings.type}' key='${settings.key}' and column='${settings.column}'`);
}

/**
 * Which colour-toolbar controls apply to which colour type, by element id
 * prefix (the panel id is appended).
 *
 * Hide NaN acts on categorical colours too (points with no category), and
 * Equal aspect is about the axes, not the colour. The categorical branch used
 * to hide the whole toolbar, so both were unreachable there: a Hide NaN left
 * on from a numerical colour or a restored view kept hiding points that the
 * user could not show again from that panel.
 */
export const COLOR_TOOLBAR_CONTROLS = Object.freeze({
  numerical: Object.freeze(['center-colormap', 'reverse-colormap', 'lock-range', 'hide-outliers',
    'hide-nan', 'equal-aspect', 'sort-by-color', 'log-color', 'log-floor']),
  categorical: Object.freeze(['hide-nan', 'equal-aspect'])
});

/** Show the toolbar with exactly the controls that apply to `colorType`. */
function applyColorToolbar($container, colorType, id) {
  const shown = COLOR_TOOLBAR_CONTROLS[colorType] || [];
  for (const name of COLOR_TOOLBAR_CONTROLS.numerical) {
    const $el = $container.find(`#${name}-${id}`);
    if (!$el.length) continue;
    $el.attr('style', shown.includes(name)
      ? (name === 'log-floor' ? 'width: 7.5rem' : 'display: inline-block !important')
      : 'display: none !important');
  }
  const $buttonToolbar = $container.find('.btn-toolbar');
  if ($buttonToolbar.length) {
    $buttonToolbar.attr('style', 'width: 100%; display: flex !important; flex-direction: row !important; gap: 4px');
    $buttonToolbar.find('.btn-group').each(function() {
      jQuery(this).attr('style', 'width: auto; display: inline-flex !important; flex-wrap: nowrap !important; gap: 4px');
    });
  }
}

/**
 * Updates the visibility of color controls based on the current color type,
 * using elements within the provided container.
 *
 * @param {HTMLElement} container - The container element that holds the color control elements.
 * @param {string} colorType - The type of color control ('numerical', 'categorical', or 'none').
 * @param {string|number} id - The unique identifier used for element IDs.
 */
export function updateColorControlsVisibility(container, colorType, id) {
  const $container = jQuery(container);
  const $colorRangeContainer = $container.find(`#color-range-container-${id}`);
  const $colorScaleSelect = $container.find(`#color-scale-${id}`);
  const $categoryPaletteSelect = $container.find(`#category-palette-${id}`);
  const $colorMinInput = $container.find(`#color-min-${id}`);
  const $colorMaxInput = $container.find(`#color-max-${id}`);
  const $colorMinSlider = $container.find(`#color-min-slider-${id}`);
  const $colorMaxSlider = $container.find(`#color-max-slider-${id}`);
  const $numericalLabel = $container.find(`#numerical-color-label-${id}`);
  const $categoricalLabel = $container.find(`#categorical-color-label-${id}`);

  const $colorMinSliderContainer = $colorMinSlider.closest('.color-min-slider-container');
  const $colorMaxSliderContainer = $colorMaxSlider.closest('.color-max-slider-container');

  if (!$colorRangeContainer.length) return;

  if (colorType === 'numerical') {
    // Show numerical color controls
    $colorRangeContainer.css('display', 'flex');
    $.showHide($colorScaleSelect, true, 'block');
    $.showHide($categoryPaletteSelect, false);
    $.showHide($colorMinInput, true, 'block');
    $.showHide($colorMaxInput, true, 'block');
    $.showHide($colorMinSlider, true, 'block');
    $.showHide($colorMaxSlider, true, 'block');
    
    // Show slider containers with Min/Max labels
    $.showHide($colorMinSliderContainer, true, 'block');
    $.showHide($colorMaxSliderContainer, true, 'block');
    
    // Every toolbar control applies to a numerical colour
    applyColorToolbar($container, 'numerical', id);
    
    // Show the entire color range inputs section
    const $colorRangeInputs = $container.find('.color-range-inputs');
    $.showHide($colorRangeInputs, true, 'block');
    
  } else if (colorType === 'categorical') {
    // Show categorical color controls
    $colorRangeContainer.css('display', 'flex');
    $.showHide($colorScaleSelect, false);
    
    if ($categoryPaletteSelect.length) {
      $.showHide($categoryPaletteSelect, true, 'block');
      $categoryPaletteSelect.css('margin', '10px 0');
    }
    
    $.showHide($colorMinInput, false);
    $.showHide($colorMaxInput, false);
    $.showHide($colorMinSlider, false);
    $.showHide($colorMaxSlider, false);
    
    // Hide slider containers with Min/Max labels
    $.showHide($colorMinSliderContainer, false);
    $.showHide($colorMaxSliderContainer, false);
    
    // Only the controls that apply to categories: Hide NaN, Equal aspect
    applyColorToolbar($container, 'categorical', id);
    
    // Hide the entire color range inputs section
    const $colorRangeInputs = $container.find('.color-range-inputs');
    $.showHide($colorRangeInputs, false);
    
    // Show/hide labels
    $.showHide($numericalLabel, false);
    $.showHide($categoricalLabel, true, 'inline');
    
  } else {
    // For 'none' type, hide the entire color controls
    $.showHide($colorRangeContainer, false);
  }
}

/**
 * Show the panel's point size and opacity: the log-scale tracks and the
 * number boxes beside them. A value outside a track's range (e.g. size 0.1
 * from an older link) pins the thumb to that end; the box shows it as is.
 */
export function showPointStyle(id, settings) {
  const show = (name, scale, value, auto, what, note = '') => {
    const tip = (auto ? `${what}: auto, follows the number of points drawn (not the panel size)` : `${what} (set)`) + note;
    const $slider = jQuery(`#${name}-${id}`);
    if ($slider.length) $slider.val(trackValue(scale, value)).attr('title', `${tip} (log scale)`);
    const $input = jQuery(`#${name}-input-${id}`);
    if ($input.length) $input.val(value).toggleClass('is-auto', !!auto).attr('title', tip);
    const $auto = jQuery(`#${name}-auto-${id}`);
    if ($auto.length) {
      $auto.toggleClass('active', !!auto).attr('aria-pressed', String(!!auto)).attr('title', auto
        ? `${what} is automatic: it follows the number of points drawn, not the panel size${note}`
        : `Make the ${what.toLowerCase()} automatic again: follow the number of points drawn${note}`);
    }
  };
  show('point-size', pointSizeScale, settings.pointSize, settings.autoPointSize, 'Marker size');
  // 3D: automatic opacity is 1 (utils/point-style.js); a chosen one is kept, with this warning
  show('point-opacity', opacityScale, settings.pointOpacity, settings.autoPointOpacity, 'Marker opacity',
    settings.z ? '. In 3D, below 1 Plotly draws the points out of depth order (far ones over near ones); automatic is 1' : '');
}

/**
 * The "Strong on top" toggle: disabled in 3D, where depth decides which
 * points are in front (plot-make.js colorSortApplies), and shown with its
 * 2D state, which applies again when the plot returns to 2D.
 */
export function showColorSortControl(id, settings) {
  const $button = jQuery(`#sort-by-color-${id}`);
  if (!$button.length) return;
  const is3D = !!settings.z;
  $button.prop('disabled', is3D).attr('title', is3D
    ? 'In 3D, depth decides which points are in front'
    : 'Draw the largest |colour| values on top');
  $.updateButtonState($button, settings.sortByColor !== false);
}

/**
 * The scales of the colour min and max sliders (slider-scales.js), or null
 * when no value is finite. Both move in quantile space; centred at 0 they
 * move over |value|, the min thumb mirrored, so min = -max position for
 * position as the centring handlers require.
 */
export function colorSliderScales(values, centered) {
  if (!centered) {
    const scale = quantileScale(values);
    return scale && { min: scale, max: scale };
  }
  const abs = quantileScale(values, { transform: Math.abs });
  return abs && { min: mirroredScale(abs), max: abs };
}

/** The colour value a min/max slider shows (its scale, else its raw value). */
export function colorSliderValue(slider) {
  const scale = jQuery(slider).data('scale');
  return scale ? valueAt(scale, slider.value) : parseFloat(slider.value);
}

/** Put a colour min/max thumb on `value`; outside the data it pins to an end. */
export function showColorBound($slider, value, side) {
  const scale = $slider.data('scale');
  $slider.val(scale ? trackValue(scale, value, side) : value);
}

/**
 * Give the colour sliders their scales and show settings.colorMin/colorMax
 * on them and in the number boxes. A constant column has nothing to slide
 * over: the sliders are disabled, the boxes still take a typed range.
 */
function showColorRange($container, id, scales, settings) {
  const $colorMinSlider = $container.find(`#color-min-slider-${id}`);
  const $colorMaxSlider = $container.find(`#color-max-slider-${id}`);
  const $colorMinInput = $container.find(`#color-min-${id}`);
  const $colorMaxInput = $container.find(`#color-max-${id}`);
  if ($colorMinSlider.length && $colorMaxSlider.length) {
    $colorMinSlider.data('scale', scales.min);
    $colorMaxSlider.data('scale', scales.max);
    $colorMinSlider.attr({ min: 0, max: SLIDER_STEPS, step: 1 }).prop('disabled', !!scales.max.constant);
    $colorMaxSlider.attr({ min: 0, max: SLIDER_STEPS, step: 1 }).prop('disabled', !!scales.max.constant);
    showColorBound($colorMinSlider, settings.colorMin, 'low');
    showColorBound($colorMaxSlider, settings.colorMax, 'high');
  }
  if ($colorMinInput.length) $colorMinInput.val(formatRangeValue(settings.colorMin));
  if ($colorMaxInput.length) $colorMaxInput.val(formatRangeValue(settings.colorMax));
}

/**
 * Updates the color slider UI controls based on current settings.
 *
 * For numerical data the sliders move over percentiles of data.color (an
 * Array or a typed array; slider-scales.js samples a long one), while
 * settings and the number boxes keep colour values:
 *   - If settings.lockColorRange is false, resets the range to the data's
 *     min and max.
 *   - During first load (a restored link or session) or with a locked range,
 *     keeps the provided colorMin/colorMax and fills a missing one from the data.
 *
 * @param {HTMLElement} container - The container element that holds the color controls.
 * @param {Object} data - The data object (data.color: the coloured values).
 * @param {Object} settings - The plot settings object. Should include centeringActive, lockColorRange, colorMin, colorMax.
 * @param {string|number} id - Unique identifier used to construct element selectors.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 */
export function updateColorSliderUI(container, data, settings, id, isFirstLoad = false) {
  const $container = jQuery(container);
  const $centerColormapButton = $container.find(`#center-colormap-${id}`);

  // If centering is active, update the UI accordingly and apply centering
  if (settings.centeringActive) {
    if ($centerColormapButton.length) {
      $.updateButtonState($centerColormapButton, true);
      $centerColormapButton.attr('title', 'Centering active - click to disable');
    }
    // Delegate the centering update to the applyCentering function
    applyCentering(container, data, settings, id);
    return;
  }
  // Reset the center button appearance
  if ($centerColormapButton.length) {
    $.updateButtonState($centerColormapButton, false);
    $centerColormapButton.attr('title', 'Center color scale at 0');
  }
  if (!data || !data.color || typeof data.color === 'string') return;
  const scales = colorSliderScales(data.color, false);
  if (!scales) return;
  const dataMin = scales.max.min, dataMax = scales.max.max;

  if (!settings.lockColorRange && !isFirstLoad) {
    settings.colorMin = dataMin;
    settings.colorMax = dataMax;
  } else {
    // First load (e.g. a restored deep link or session) or a locked
    // range: keep the provided values, but fill a missing one from the
    // data -- that is what the plot itself does for cmin/cmax
    // (plot-make.js), so the settings now say what is drawn.
    if (settings.colorMin == null) settings.colorMin = dataMin;
    if (settings.colorMax == null) settings.colorMax = dataMax;
  }
  // Show them in the boxes too, not only on the sliders: the boxes would
  // otherwise keep the template's "0" and "100" after a restore whose
  // config had no colorMin/colorMax, while the plot is coloured over the
  // data range.
  showColorRange($container, id, scales, settings);
}

/**
 * Applies centering to the color scale.
 *
 * If centering is active, finds the absolute maximum among the valid color
 * values and, unless the range is locked, sets colorMin to -absMax and
 * colorMax to absMax. The sliders then move over percentiles of |value|,
 * the min slider mirrored (colorSliderScales).
 *
 * @param {HTMLElement} container - The container element holding the color controls.
 * @param {Object} data - The data object (data.color: the coloured values).
 * @param {Object} settings - The settings object (must include settings.centeringActive).
 * @param {string|number} id - Unique identifier used for element selectors.
 */
export function applyCentering(container, data, settings, id) {
  if (!data || !data.color || typeof data.color === 'string') return;
  if (!settings.centeringActive) return;
  const scales = colorSliderScales(data.color, true);
  if (!scales) return;
  const absMax = scales.max.max;

  // If not locked, update settings with the computed symmetric range;
  // otherwise keep the locked values
  if (!settings.lockColorRange) {
    settings.colorMin = -absMax;
    settings.colorMax = absMax;
  }
  showColorRange(jQuery(container), id, scales, settings);
}

/**
 * Updates the table filter select dropdown with available tables
 * @param {HTMLElement} container - The container element that holds the select
 * @param {string} id - The panel ID
 * @param {string} entityType - 'cells' or 'genes'
 * @param {string|null} value - Optional value to set the select to
 */
export function updateTableFilterSelect(container, id, entityType, value = null) {
  const $container = jQuery(container);
  
  // The ID in the DOM may include a prefix like "cell-plot-" or "gene-plot-"
  // First try looking for the table filter dropdown directly using the exact id
  let $tableFilterSelect = $container.find(`#table-filter-${id}`);
  
  // If not found, try a more flexible selector that matches the class
  if (!$tableFilterSelect.length) {
    $tableFilterSelect = $container.find('.table-filter-select');
  }
  
  // If still not found, try looking for any dropdown containing "table-filter"
  if (!$tableFilterSelect.length) {
    $tableFilterSelect = $container.find('select[id*="table-filter"]');
  }
  
  // Log a warning but continue processing
  if (!$tableFilterSelect.length) {
    console.warn(`Table filter select not found for panel ${id} - searched in container:`, $container);
  }
  
  // Get all table panels from PanelManager
  const tableType = entityType === 'cells' ? 'cell-table' : 'gene-table';
  const tablePanels = window.PanelManager ? window.PanelManager.getPanelsByType(tableType) : [];
  
  // Can't proceed if no dropdown and no table panels
  if (!$tableFilterSelect.length && (!tablePanels || !tablePanels.length)) {
    return;
  }
  
  // Update the dropdown if found
  if ($tableFilterSelect.length) {
    // Get the current selection
    const currentValue = value || $tableFilterSelect.val();
    
    // Clear all options except the first one (None)
    $tableFilterSelect.find('option:not([value="none"])').remove();
    
    // Add options for each table panel
    tablePanels.forEach(panel => {
      const panelId = panel.getId();
      const title = panel.getTitle();
      const $option = jQuery('<option></option>')
        .val(panelId)
        .text(title);
        
      $tableFilterSelect.append($option);
    });
    
    // Check if the current table filter is still available
    const isCurrentTableAvailable = currentValue && 
      currentValue !== 'none' && 
      $tableFilterSelect.find(`option[value="${currentValue}"]`).length > 0;
    
    if (isCurrentTableAvailable) {
      // Keep the same table selected if still available
      $tableFilterSelect.val(currentValue);
    } else {
      // Default to None if previous table is no longer available
      $tableFilterSelect.val('none');
      
      // Get panel to call onDataUpdate if needed
      const panel = window.PanelManager ? window.PanelManager.getPanel(id) : null;
      if (panel && panel.onDataUpdate && currentValue) {
        // store new tableFilter in settings of the panel
        panel.setConfig({ tableFilter: 'none' });
        // Call onDataUpdate with tableChanged event, passing empty data to avoid issues with id property
        panel.onDataUpdate('tableChanged', {});
      }
    }
    
    console.log(`Updated table filter dropdown for panel ${id} with ${tablePanels.length} table options`);
  } else {
    // If dropdown not found but we have panel data, try to update settings directly
    const panel = window.PanelManager ? window.PanelManager.getPanel(id) : null;
    if (panel) {
      // Get the current settings
      const settings = panel.getConfig ? panel.getConfig() : {};
      if (settings) {
        // Check if the current table filter is still available
        const currentTableFilter = settings.tableFilter;
        const tableIds = tablePanels.map(panel => panel.getId());
        const isCurrentTableAvailable = currentTableFilter && 
          currentTableFilter !== 'none' && 
          tableIds.includes(currentTableFilter);
        
        if (!isCurrentTableAvailable && currentTableFilter && currentTableFilter !== 'none') {
          // Reset to 'none' since the table is no longer available
          settings.tableFilter = 'none';
          console.log(`Reset table filter for panel ${id} to 'none'`);
          
          // Call onDataUpdate with tableChanged event if available
          if (panel.onDataUpdate) {
            panel.setConfig({ tableFilter: 'none' });
            // Pass empty data object to avoid null reference issues
            panel.onDataUpdate('tableChanged', {});
          }
        }
      }
    }
  }
}