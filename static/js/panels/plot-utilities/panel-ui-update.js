import { DataManager } from '../../data-manager.js';
import * as $ from '../../utils/jquery-helpers.js';
import { updatePlotElements } from './plot-update.js';

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
        let keys = datasetStructure.layers?.details?.keys || datasetStructure.layers?.keys || [];
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
      if (type === 'obs' || type === 'var') {
        // For obs and var types, avoid using _index if there are other options
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
      let focused;
      if (settings.column && settings.type === 'obsp' && settings.locked) {
        focused = settings.column;
      } else {
        focused = DataManager.getFocusedCell();
        settings.column = focused;
      }
      columnOptions = focused ? 
        [{ value: focused, text: `Focused cell to ${focused}` }] : 
        [{ value: '', text: 'Select a focused cell first' }];
      break;
    }
    case 'varp': {
      let focused;
      if (settings.column && settings.type === 'varp' && settings.locked) {
        focused = settings.column;
      } else {
        focused = DataManager.getFocusedGene();
        settings.column = focused;
      }
      columnOptions = focused ? 
        [{ value: focused, text: `Focused gene to ${focused}` }] : 
        [{ value: '', text: 'Select a focused gene first' }];
      break;
    }
    case 'layer': {
      let focused;
      if (plotType === 'cells') {
        if (settings.column && settings.type === 'layer' && settings.locked) {
          focused = settings.column;
        } else {
          focused = DataManager.getFocusedGene();
          settings.column = focused;
        }
        columnOptions = focused ? 
          [{ value: focused, text: `Focused gene ${focused}` }] : 
          [{ value: '', text: 'Select a focused gene first' }];
      } else if (plotType === 'genes') {
        if (settings.column && settings.type === 'layer' && settings.locked) {
          focused = settings.column;
        } else {
          focused = DataManager.getFocusedCell();
          settings.column = focused;
        }
        columnOptions = focused ? 
          [{ value: focused, text: `Focused cell ${focused}` }] : 
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
  if (colValues.includes(settings.column)) {
    // Current column is valid, keep it
  }
  // For obsm and varm types, try to restore from history if current is invalid
  else if ((type === 'obsm' || type === 'varm') && 
           settings.history[type]?.columns?.[settings.key] && 
           colValues.includes(settings.history[type].columns[settings.key])) {
    settings.column = settings.history[type].columns[settings.key];
  }
  // Last resort: use first available value
  else {
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
      // Default to 'none' for color, otherwise use varm/obsm
      settings.type = axis === 'color' ? 'none' : 
                      (plotType === 'genes' ? 'varm' : 'obsm');
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
        const $refocusButton = $.createElement('button', {
          id: `refocus-${axis}`,
          class: 'btn btn-sm btn-outline-secondary',
          title: 'Refocus to current selection',
          'data-axis': axis,
          'data-type': settings.type
        }, '<i class="fas fa-crosshairs"></i>');
        $buttonsContainer.append($refocusButton);
        
        // Create lock button
        const $lockButton = $.createElement('button', {
          id: `lock-${axis}`,
          class: 'btn btn-sm btn-outline-secondary',
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
        const $refocusButton = $buttonsContainer.find(`#refocus-${axis}`);
        const $lockButton = $buttonsContainer.find(`#lock-${axis}`);
        
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
  const $centerColormapButton = $container.find(`#center-colormap-${id}`);
  const $hideOutliersButton = $container.find(`#hide-outliers-${id}`);
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
    
    // Override inline styles for control buttons
    $centerColormapButton.attr('style', 'display: inline-block !important; margin-right: 4px !important');
    $hideOutliersButton.attr('style', 'display: inline-block !important; margin-right: 4px !important');
    
    const $lockRangeButton = $container.find(`#lock-range-${id}`);
    if ($lockRangeButton.length) {
      $lockRangeButton.attr('style', 'display: inline-block !important');
    }
    
    // Show toolbar for numerical controls
    const $buttonToolbar = $container.find('.btn-toolbar');
    if ($buttonToolbar.length) {
      $buttonToolbar.attr('style', 'width: 100%; display: flex !important; flex-direction: row !important; gap: 4px');
      $buttonToolbar.find('.btn-group').each(function() {
        jQuery(this).attr('style', 'width: auto; display: inline-flex !important; flex-wrap: nowrap !important; gap: 4px');
      });
    }
    
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
    
    // Hide numerical control buttons
    $centerColormapButton.attr('style', 'display: none !important');
    $hideOutliersButton.attr('style', 'display: none !important');
    
    const $lockRangeButton = $container.find(`#lock-range-${id}`);
    if ($lockRangeButton.length) {
      $lockRangeButton.attr('style', 'display: none !important');
    }
    
    // Hide the button toolbar and its button groups
    const $buttonToolbar = $container.find('.btn-toolbar');
    if ($buttonToolbar.length) {
      $buttonToolbar.attr('style', 'display: none !important');
      $buttonToolbar.find('.btn-group').each(function() {
        jQuery(this).attr('style', 'display: none !important');
      });
    }
    
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
 * Updates the color slider UI controls based on current settings.
 *
 * For numerical data:
 *   - Computes the valid data range from data.color.
 *   - Sets the slider (min and max) accordingly.
 *   - If settings.lockColorRange is false, resets slider and input values to the computed dataMin/dataMax.
 *     Otherwise, expands the slider range to include both the new data range and the locked values,
 *     keeping the locked values intact.
 *   - During first load, respects provided colorMin and colorMax values even when lockColorRange is false.
 *
 * For categorical data:
 *   - Updates the category palette selector.
 *
 * @param {HTMLElement} container - The container element that holds the color controls.
 * @param {Object} data - The data object (must include data.color as an array and data.colorType).
 * @param {Object} settings - The plot settings object. Should include centeringActive, lockColorRange, colorMin, colorMax, and categoryPalette.
 * @param {string|number} id - Unique identifier used to construct element selectors.
 * @param {boolean} isFirstLoad - Flag indicating if this is the first load of the panel.
 */
export function updateColorSliderUI(container, data, settings, id, isFirstLoad = false) {
  const $container = jQuery(container);
  const $centerColormapButton = $container.find(`#center-colormap-${id}`);
  const $colorMinInput = $container.find(`#color-min-${id}`);
  const $colorMaxInput = $container.find(`#color-max-${id}`);
  const $colorMinSlider = $container.find(`#color-min-slider-${id}`);
  const $colorMaxSlider = $container.find(`#color-max-slider-${id}`);

  // If centering is active, update the UI accordingly and apply centering
  if (settings.centeringActive) {
    if ($centerColormapButton.length) {
      $.updateButtonState($centerColormapButton, true);
      $centerColormapButton.attr('title', 'Centering active - click to disable');
    }
    // Delegate the centering update to the applyCentering function
    applyCentering(container, data, settings, id);
  } else {
    // Reset the center button appearance
    if ($centerColormapButton.length) {
      $.updateButtonState($centerColormapButton, false);
      $centerColormapButton.attr('title', 'Center color scale at 0');
    }

    if ($colorMinSlider.length && $colorMaxSlider.length && data && data.color && Array.isArray(data.color)) {
      const validValues = data.color.filter(v => !isNaN(v));
      if (validValues.length > 0) {
        const dataMin = Math.min(...validValues);
        const dataMax = Math.max(...validValues);

        // Now, if the color range is not locked, update the actual slider/input values.
        // During first load, respect provided values even when range is not locked
        if (!settings.lockColorRange && !isFirstLoad) {
          // Set slider ranges based on the data
          $colorMinSlider.attr({
            min: dataMin,
            max: dataMax
          });
          
          $colorMaxSlider.attr({
            min: dataMin,
            max: dataMax
          });
          
          const range = dataMax - dataMin;
          const step = range / 500;
          
          $colorMinSlider.attr('step', step);
          $colorMaxSlider.attr('step', step);
          
          // Update UI elements
          $colorMinSlider.val(dataMin);
          $colorMaxSlider.val(dataMax);
          
          if ($colorMinInput.length) $colorMinInput.val(dataMin.toFixed(2));
          if ($colorMaxInput.length) $colorMaxInput.val(dataMax.toFixed(2));
          
          settings.colorMin = dataMin;
          settings.colorMax = dataMax;
        } else {
          // Expand slider range (min, max) to include both the new data range and the locked values
          const minSliderRange = Math.min(settings.colorMin ?? dataMin, dataMin);
          const maxSliderRange = Math.max(settings.colorMax ?? dataMax, dataMax);
          
          $colorMinSlider.attr({
            min: minSliderRange,
            max: maxSliderRange
          });
          
          $colorMaxSlider.attr({
            min: minSliderRange,
            max: maxSliderRange
          });
          
          const range = dataMax - dataMin;
          const step = range / 500;
          
          $colorMinSlider.attr('step', step);
          $colorMaxSlider.attr('step', step);
          
          // Do not change the locked values; just keep them
          $colorMinSlider.val(settings.colorMin ?? dataMin);
          $colorMaxSlider.val(settings.colorMax ?? dataMax);
        }

        // Update input placeholders if fields are empty
        if ($colorMinInput.length && $colorMinInput.val() === '') {
          $colorMinInput.attr('placeholder', (settings.colorMin ?? dataMin).toFixed(2));
        }
        
        if ($colorMaxInput.length && $colorMaxInput.val() === '') {
          $colorMaxInput.attr('placeholder', (settings.colorMax ?? dataMax).toFixed(2));
        }
      }
    }
  }
}

/**
 * Applies centering to the color scale.
 *
 * If centering is active, finds the absolute maximum among the valid color values,
 * updates the settings so that colorMin is -absMax and colorMax is absMax,
 * updates input fields and slider ranges accordingly,
 * and triggers a direct Plotly restyle (or calls updatePlotColorRangeOnly as fallback).
 *
 * @param {HTMLElement} container - The container element holding the color controls.
 * @param {Object} data - The data object (must have data.color as an array).
 * @param {Object} settings - The settings object (must include settings.centeringActive).
 * @param {string|number} id - Unique identifier used for element selectors.
 */
export function applyCentering(container, data, settings, id) {
  if (!data || !data.color || !Array.isArray(data.color)) return;
  if (!settings.centeringActive) return;

  // Filter valid numeric values
  const validValues = data.color.filter(v => !isNaN(v));
  if (validValues.length === 0) return;

  // Compute the absolute maximum value from both ends
  const absMaxComputed = Math.max(
    Math.abs(Math.min(...validValues)),
    Math.abs(Math.max(...validValues))
  );

  // If not locked, update settings with the computed symmetric range
  if (!settings.lockColorRange) {
    settings.colorMin = -absMaxComputed;
    settings.colorMax = absMaxComputed;
  }
  // Otherwise, keep the locked values and do not modify settings.colorMin/colorMax

  // Use the effective values for the UI update
  const effectiveColorMin = settings.lockColorRange ? settings.colorMin : -absMaxComputed;
  const effectiveColorMax = settings.lockColorRange ? settings.colorMax : absMaxComputed;

  // Update input fields
  const $container = jQuery(container);
  const $colorMinInput = $container.find(`#color-min-${id}`);
  const $colorMaxInput = $container.find(`#color-max-${id}`);
  
  if ($colorMinInput.length) $colorMinInput.val(effectiveColorMin.toFixed(2));
  if ($colorMaxInput.length) $colorMaxInput.val(effectiveColorMax.toFixed(2));

  // Update slider controls
  const $colorMinSlider = $container.find(`#color-min-slider-${id}`);
  const $colorMaxSlider = $container.find(`#color-max-slider-${id}`);
  
  if ($colorMinSlider.length && $colorMaxSlider.length) {
    const dataMin = Math.min(...validValues);
    const dataMax = Math.max(...validValues);

    if (!settings.lockColorRange) {
      // Set sliders for a perfectly centered range
      $colorMinSlider.attr({
        min: Math.min(-absMaxComputed, dataMin),
        max: 0
      });
      
      $colorMaxSlider.attr({
        min: 0,
        max: Math.max(absMaxComputed, dataMax)
      });
      
      $colorMinSlider.val(effectiveColorMin);
      $colorMaxSlider.val(effectiveColorMax);
    } else {
      // Locked: expand the slider range to include both locked values and the new data range
      const newSliderMin = Math.min(settings.colorMin, -absMaxComputed, dataMin);
      const newSliderMax = Math.max(settings.colorMax, absMaxComputed, dataMax);
      
      $colorMinSlider.attr({
        min: newSliderMin,
        max: newSliderMax
      });
      
      $colorMaxSlider.attr({
        min: newSliderMin,
        max: newSliderMax
      });
      
      // Preserve the locked slider values
      $colorMinSlider.val(settings.colorMin);
      $colorMaxSlider.val(settings.colorMax);
    }

    // Compute a step value
    const step = absMaxComputed / 500;
    $colorMinSlider.attr('step', step);
    $colorMaxSlider.attr('step', step);
  }
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