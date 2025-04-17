import { DataManager } from '../../data-manager.js';

/**
 * Populates only the key selector for a given axis.
 * @param {Object} settings - Axis settings object (will be updated)
 * @param {HTMLSelectElement} keySelect - The key select dropdown
 * @param {Object} datasetStructure - Structure of the loaded dataset
 */
export function populateKeySelector(settings, keySelect, datasetStructure) {
    const type = settings.type || 'obsm';
    let keyOptions = [];
    keySelect.disabled = false;
  
    switch (type) {
      case 'none': {
        keyOptions = ['<option value="">N/A</option>'];
        keySelect.disabled = true;
        break;
      }
      case 'obs': {
        let columns = datasetStructure.obs?.columns || Object.keys(datasetStructure.obs || {});
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = columns.map(col => `<option value="${col}">${col}</option>`);
        break;
      }
      case 'obsm': {
        let keys = Object.keys(datasetStructure.obsm?.dataframes || {});
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'obsp': {
        let keys = datasetStructure.obsp?.keys || [];
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'layer': {
        let keys = datasetStructure.layers?.details?.keys || datasetStructure.layers?.keys || [];
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'var': {
        let columns = datasetStructure.var?.columns || Object.keys(datasetStructure.var || {});
        // Sort columns alphabetically if there are more than 10
        if (columns.length > 10) {
          columns = [...columns].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = columns.map(col => `<option value="${col}">${col}</option>`);
        break;
      }
      case 'varm':
      case 'varp': {
        let keys = datasetStructure[type]?.keys || [];
        // Sort keys alphabetically if there are more than 10
        if (keys.length > 10) {
          keys = [...keys].sort((a, b) => a.localeCompare(b));
        }
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      default:
        console.warn(`Unsupported type in populateKeySelector: ${type}`);
    }
  
    keySelect.innerHTML = keyOptions.length ? keyOptions.join('') : '<option value="">No options available</option>';
  
    const keyValues = Array.from(keySelect.options).map(opt => opt.value);
    if (!keyValues.includes(settings.key)) {
      settings.key = keyValues[0] || '';
    }
    keySelect.value = settings.key;
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
    const type = settings.type || (plotType=='cells' ? 'obsm' : 'varm');
    let columnOptions = [];
    columnSelect.disabled = false;
  
    switch (type) {
      case 'obs':
      case 'var': {
        columnOptions = ['<option value="">N/A</option>'];
        columnSelect.disabled = true;
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
          columnOptions = columns.map(col => `<option value="${col}">${col}</option>`);
          const axisIndexMap = { x: 0, y: 1, z: 2 };
          const idx = axisIndexMap[axis] || 0;
          if (!columns.includes(settings.column)) {
            settings.column = columns[idx] || columns[0];
          }
        } else {
          columnOptions = Array.from({ length: 3 }, (_, i) => `<option value="${i}">${i}</option>`);
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
          columnOptions = columns.map(col => `<option value="${col}">${col}</option>`);
          const axisIndexMap = { x: 0, y: 1, z: 2 };
          const idx = axisIndexMap[axis] || 0;
          if (!columns.includes(settings.column)) {
            settings.column = columns[idx] || columns[0];
          }
        } else {
          columnOptions = Array.from({ length: 3 }, (_, i) => `<option value="${i}">${i}</option>`);
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
        columnOptions = focused ? [`<option value="${focused}">Connections to ${focused}</option>`]
                                : ['<option value="">Select a focused cell first</option>'];
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
        columnOptions = focused ? [`<option value="${focused}">Connections to ${focused}</option>`]
                                : ['<option value="">Select a focused gene first</option>'];
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
          columnOptions = focused ? [`<option value="${focused}">Expression of ${focused}</option>`]
                                  : ['<option value="">Select a focused gene first</option>'];
        } else if (plotType === 'genes') {
          if (settings.column && settings.type === 'layer' && settings.locked) {
            focused = settings.column;
          } else {
            focused = DataManager.getFocusedCell();
            settings.column = focused;
          }
          columnOptions = focused ? [`<option value="${focused}">Expression in ${focused}</option>`]
                                  : ['<option value="">Select a focused cell first</option>'];
        }
        break;
      }
    }
  
    columnSelect.innerHTML = columnOptions.join('');
    const colValues = Array.from(columnSelect.options).map(opt => opt.value);
    if (!colValues.includes(settings.column)) {
      settings.column = columnSelect.value || '';
    }
    columnSelect.value = settings.column;
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
/**
 * Shows or hides a loading indicator for a dropdown
 * @param {HTMLElement} dropdown - The select element
 */
export function showDropdownLoading(dropdown) {
  if (!dropdown) return;
  dropdown.innerHTML = '<option value="">Loading... </option>';
  dropdown.disabled = true;
}

export function setupAxisSelector(container, axis, settings, plotType, datasetStructure) {
    const typeSelect = container.querySelector(`.axis-type-select[data-axis="${axis}"]`);
    const keySelect = container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
    const columnSelect = container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
  
    if (!typeSelect || !keySelect || !columnSelect) {
      console.error(`Missing select elements for ${axis} axis`);
      return;
    }
    
    // Show loading indicators while initializing
    showDropdownLoading(keySelect);
    showDropdownLoading(columnSelect);
  
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
    typeSelect.value = settings.type;
  
    // Populate dropdowns which will replace loading indicators
    populateKeySelector(settings, keySelect, datasetStructure);
    populateColumnSelector(settings, columnSelect, axis, plotType, datasetStructure);
    
    // Add or update the refocus and lock buttons for layer, obsp, and varp types
    const axisSelector = columnSelect.closest('.axis-selector');
    if (axisSelector) {
      // Check if the type requires the special buttons
      const needsSpecialButtons = ['layer', 'obsp', 'varp'].includes(settings.type);
      
      // Get existing buttons container if it exists
      let buttonsContainer = axisSelector.querySelector(`.axis-special-buttons-${axis}`);
      
      // If container exists but buttons not needed, remove it
      if (buttonsContainer && !needsSpecialButtons) {
        buttonsContainer.remove();
        return;
      }
      
      // If buttons are needed but container doesn't exist, create it
      if (needsSpecialButtons && !buttonsContainer) {
        buttonsContainer = document.createElement('div');
        buttonsContainer.className = `axis-special-buttons-${axis}`;
        
        // Create refocus button
        const refocusButton = document.createElement('button');
        refocusButton.id = `refocus-${axis}`;
        refocusButton.className = 'btn btn-sm btn-outline-secondary';
        refocusButton.title = 'Refocus to current selection';
        refocusButton.innerHTML = '<i class="fas fa-crosshairs"></i>';
        refocusButton.dataset.axis = axis;
        refocusButton.dataset.type = settings.type;
        buttonsContainer.appendChild(refocusButton);
        
        // Create lock button
        const lockButton = document.createElement('button');
        lockButton.id = `lock-${axis}`;
        lockButton.dataset.axis = axis;
        lockButton.dataset.type = settings.type;
        buttonsContainer.appendChild(lockButton);
        
        // Add container to DOM
        axisSelector.appendChild(buttonsContainer);
      } 
      
      // If buttons are needed and container exists, update button properties
      if (needsSpecialButtons && buttonsContainer) {
        // Initialize the locked state if not already set
        if (settings.locked === undefined) {
          settings.locked = false;
        }
        
        // Get references to buttons
        const refocusButton = buttonsContainer.querySelector(`#refocus-${axis}`);
        const lockButton = buttonsContainer.querySelector(`#lock-${axis}`);
        
        // Update data type attribute for both buttons
        if (refocusButton) {
          refocusButton.dataset.type = settings.type;
        }
        
        if (lockButton) {
          lockButton.dataset.type = settings.type;
          
          // Apply the right classes based on locked state
          if (settings.locked) {
            lockButton.className = 'btn btn-sm btn-primary active';
            lockButton.setAttribute('aria-pressed', 'true');
            lockButton.title = 'Unlock (follow focused element)';
            lockButton.innerHTML = '<i class="fas fa-lock"></i>';
          } else {
            lockButton.className = 'btn btn-sm btn-outline-secondary';
            lockButton.setAttribute('aria-pressed', 'false');
            lockButton.title = 'Lock (keep current selection)';
            lockButton.innerHTML = '<i class="fas fa-lock-open"></i>';
          }
        }
        
        // Show refocus button if locked and there's a different focus available
        if (refocusButton) {
          const shouldShowRefocus = settings.locked && (
            (settings.type === 'layer' && plotType === 'cells' && DataManager.getFocusedGene() && DataManager.getFocusedGene() !== settings.column) ||
            (settings.type === 'layer' && plotType === 'genes' && DataManager.getFocusedCell() && DataManager.getFocusedCell() !== settings.column) ||
            (settings.type === 'obsp' && DataManager.getFocusedCell() && DataManager.getFocusedCell() !== settings.column) ||
            (settings.type === 'varp' && DataManager.getFocusedGene() && DataManager.getFocusedGene() !== settings.column)
          );
          
          refocusButton.style.display = shouldShowRefocus ? 'inline-flex' : 'none';
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
  const colorRangeContainer = container.querySelector(`#color-range-container-${id}`);
  const colorScaleSelect = container.querySelector(`#color-scale-${id}`);
  const categoryPaletteSelect = container.querySelector(`#category-palette-${id}`);
  const colorMinInput = container.querySelector(`#color-min-${id}`);
  const colorMaxInput = container.querySelector(`#color-max-${id}`);
  const colorMinSlider = container.querySelector(`#color-min-slider-${id}`);
  const colorMaxSlider = container.querySelector(`#color-max-slider-${id}`);
  const centerColormapButton = container.querySelector(`#center-colormap-${id}`);
  const hideOutliersButton = container.querySelector(`#hide-outliers-${id}`);
  const numericalLabel = container.querySelector(`#numerical-color-label-${id}`);
  const categoricalLabel = container.querySelector(`#categorical-color-label-${id}`);

  const colorMinSliderContainer = colorMinSlider ? colorMinSlider.closest('.color-min-slider-container') : null;
  const colorMaxSliderContainer = colorMaxSlider ? colorMaxSlider.closest('.color-max-slider-container') : null;

  if (!colorRangeContainer) return;

  if (colorType === 'numerical') {
    // Show numerical color controls.
    colorRangeContainer.style.display = 'flex';
    if (colorScaleSelect) colorScaleSelect.style.display = 'block';
    if (categoryPaletteSelect) categoryPaletteSelect.style.display = 'none';
    if (colorMinInput) colorMinInput.style.display = 'block';
    if (colorMaxInput) colorMaxInput.style.display = 'block';
    if (colorMinSlider) colorMinSlider.style.display = 'block';
    if (colorMaxSlider) colorMaxSlider.style.display = 'block';
    
    // Show slider containers with Min/Max labels.
    if (colorMinSliderContainer) colorMinSliderContainer.style.display = 'block';
    if (colorMaxSliderContainer) colorMaxSliderContainer.style.display = 'block';
    
    // Override inline styles for control buttons.
    if (centerColormapButton)
      centerColormapButton.setAttribute('style', 'display: inline-block !important; margin-right: 4px !important');
    if (hideOutliersButton)
      hideOutliersButton.setAttribute('style', 'display: inline-block !important; margin-right: 4px !important');
    
    const lockRangeButton = container.querySelector(`#lock-range-${id}`);
    if (lockRangeButton)
      lockRangeButton.setAttribute('style', 'display: inline-block !important');
    
    // Show toolbar for numerical controls.
    const buttonToolbar = container.querySelector('.btn-toolbar');
    if (buttonToolbar) {
      buttonToolbar.setAttribute('style', 'width: 100%; display: flex !important; flex-direction: row !important; gap: 4px');
      buttonToolbar.querySelectorAll('.btn-group').forEach(group => {
        group.setAttribute('style', 'width: auto; display: inline-flex !important; flex-wrap: nowrap !important; gap: 4px');
      });
    }
    
    // Show the entire color range inputs section.
    const colorRangeInputs = container.querySelector('.color-range-inputs');
    if (colorRangeInputs) colorRangeInputs.style.display = 'block';
    
  } else if (colorType === 'categorical') {
    // Show categorical color controls.
    colorRangeContainer.style.display = 'flex';
    if (colorScaleSelect) colorScaleSelect.style.display = 'none';
    if (categoryPaletteSelect) {
      categoryPaletteSelect.style.display = 'block';
      categoryPaletteSelect.style.margin = '10px 0';
    }
    if (colorMinInput) colorMinInput.style.display = 'none';
    if (colorMaxInput) colorMaxInput.style.display = 'none';
    if (colorMinSlider) colorMinSlider.style.display = 'none';
    if (colorMaxSlider) colorMaxSlider.style.display = 'none';
    
    // Hide slider containers with Min/Max labels.
    if (colorMinSliderContainer) colorMinSliderContainer.style.display = 'none';
    if (colorMaxSliderContainer) colorMaxSliderContainer.style.display = 'none';
    
    // Hide numerical control buttons.
    if (centerColormapButton)
      centerColormapButton.setAttribute('style', 'display: none !important');
    if (hideOutliersButton)
      hideOutliersButton.setAttribute('style', 'display: none !important');
    
    const lockRangeButton = container.querySelector(`#lock-range-${id}`);
    if (lockRangeButton)
      lockRangeButton.setAttribute('style', 'display: none !important');
    
    // Hide the button toolbar and its button groups.
    const buttonToolbar = container.querySelector('.btn-toolbar');
    if (buttonToolbar) {
      buttonToolbar.setAttribute('style', 'display: none !important');
      buttonToolbar.querySelectorAll('.btn-group').forEach(group => {
        group.setAttribute('style', 'display: none !important');
      });
    }
    
    // Hide the entire color range inputs section.
    const colorRangeInputs = container.querySelector('.color-range-inputs');
    if (colorRangeInputs) colorRangeInputs.style.display = 'none';
    
    // Show/hide labels.
    if (numericalLabel) numericalLabel.style.display = 'none';
    if (categoricalLabel) categoricalLabel.style.display = 'inline';
    
  } else {
    // For 'none' type, hide the entire color controls.
    colorRangeContainer.style.display = 'none';
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
  const csCenterColormapButton = container.querySelector(`#center-colormap-${id}`);
  const csColorMinInput = container.querySelector(`#color-min-${id}`);
  const csColorMaxInput = container.querySelector(`#color-max-${id}`);
  const csColorMinSlider = container.querySelector(`#color-min-slider-${id}`);
  const csColorMaxSlider = container.querySelector(`#color-max-slider-${id}`);

  // If centering is active, update the UI accordingly and apply centering.
  if (settings.centeringActive) {
    if (csCenterColormapButton) {
      csCenterColormapButton.classList.add('active', 'btn-primary');
      csCenterColormapButton.classList.remove('btn-outline-secondary');
      csCenterColormapButton.setAttribute('title', 'Centering active - click to disable');
    }
    // Delegate the centering update to the applyCentering function.
    applyCentering(container, data, settings, id);
  } else {
    // Reset the center button appearance.
    if (csCenterColormapButton) {
      csCenterColormapButton.classList.remove('active', 'btn-primary');
      csCenterColormapButton.classList.add('btn-outline-secondary');
      csCenterColormapButton.setAttribute('title', 'Center color scale at 0');
    }

    if (csColorMinSlider && csColorMaxSlider && data && data.color && Array.isArray(data.color)) {
      const validValues = data.color.filter(v => !isNaN(v));
      if (validValues.length > 0) {
        const dataMin = Math.min(...validValues);
        const dataMax = Math.max(...validValues);

        // Now, if the color range is not locked, update the actual slider/input values.
        // During first load, respect provided values even when range is not locked
        if (!settings.lockColorRange && !isFirstLoad) {
          // Set slider ranges based on the data
          csColorMinSlider.min = dataMin;
          csColorMinSlider.max = dataMax;
          csColorMaxSlider.min = dataMin;
          csColorMaxSlider.max = dataMax;
          const range = dataMax - dataMin;
          const step = range / 500
          csColorMinSlider.step = step;
          csColorMaxSlider.step = step;
          
          // Update UI elements
          csColorMinSlider.value = dataMin;
          csColorMaxSlider.value = dataMax;
          if (csColorMinInput) csColorMinInput.value = dataMin.toFixed(2);
          if (csColorMaxInput) csColorMaxInput.value = dataMax.toFixed(2);
          
          settings.colorMin = dataMin;
          settings.colorMax = dataMax;
        } else {
          // Expand slider range (min, max) to include both the new data range and the locked values.
          const minSliderRange = Math.min(settings.colorMin ?? dataMin, dataMin);
          const maxSliderRange = Math.max(settings.colorMax ?? dataMax, dataMax);
          csColorMinSlider.min = minSliderRange;
          csColorMaxSlider.min = minSliderRange;
          csColorMinSlider.max = maxSliderRange;
          csColorMaxSlider.max = maxSliderRange;
          const range = dataMax - dataMin;
          const step = range / 500
          csColorMinSlider.step = step;
          csColorMaxSlider.step = step;
          // Do not change the locked values; just keep them.
          csColorMinSlider.value = settings.colorMin ?? dataMin;
          csColorMaxSlider.value = settings.colorMax ?? dataMax;
        }

        // (Optional) You might also update the placeholders if desired:
        if (csColorMinInput && csColorMinInput.value === '') {
          csColorMinInput.placeholder = settings.colorMin ?? dataMin.toFixed(2);
        }
        if (csColorMaxInput && csColorMaxInput.value === '') {
          csColorMaxInput.placeholder = settings.colorMin ?? dataMax.toFixed(2);
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
 * @param {Function} loadDataAndCreatePlot - Function to redraw the plot elements.
 */
export function applyCentering(container, data, settings, id) {
  if (!data || !data.color || !Array.isArray(data.color)) return;
  if (!settings.centeringActive) return;

  // Filter valid numeric values.
  const validValues = data.color.filter(v => !isNaN(v));
  if (validValues.length === 0) return;

  // Compute the absolute maximum value from both ends.
  const absMaxComputed = Math.max(
    Math.abs(Math.min(...validValues)),
    Math.abs(Math.max(...validValues))
  );

  // If not locked, update settings with the computed symmetric range.
  if (!settings.lockColorRange) {
    settings.colorMin = -absMaxComputed;
    settings.colorMax = absMaxComputed;
  }
  // Otherwise, keep the locked values and do not modify settings.colorMin/colorMax.

  // Use the effective values for the UI update.
  const effectiveColorMin = settings.lockColorRange ? settings.colorMin : -absMaxComputed;
  const effectiveColorMax = settings.lockColorRange ? settings.colorMax : absMaxComputed;

  // Update input fields.
  const csColorMinInput = container.querySelector(`#color-min-${id}`);
  const csColorMaxInput = container.querySelector(`#color-max-${id}`);
  if (csColorMinInput) csColorMinInput.value = effectiveColorMin.toFixed(2);
  if (csColorMaxInput) csColorMaxInput.value = effectiveColorMax.toFixed(2);

  // Update slider controls.
  const csColorMinSlider = container.querySelector(`#color-min-slider-${id}`);
  const csColorMaxSlider = container.querySelector(`#color-max-slider-${id}`);
  if (csColorMinSlider && csColorMaxSlider) {
    const dataMin = Math.min(...validValues);
    const dataMax = Math.max(...validValues);

    if (!settings.lockColorRange) {
      // Set sliders for a perfectly centered range.
      csColorMinSlider.min = Math.min(-absMaxComputed, dataMin);
      csColorMinSlider.max = 0;
      csColorMaxSlider.min = 0;
      csColorMaxSlider.max = Math.max(absMaxComputed, dataMax);
      csColorMinSlider.value = effectiveColorMin;
      csColorMaxSlider.value = effectiveColorMax;
    } else {
      // Locked: expand the slider range to include both locked values and the new data range.
      const newSliderMin = Math.min(settings.colorMin, -absMaxComputed, dataMin);
      const newSliderMax = Math.max(settings.colorMax, absMaxComputed, dataMax);
      csColorMinSlider.min = newSliderMin;
      csColorMaxSlider.min = newSliderMin;
      csColorMinSlider.max = newSliderMax;
      csColorMaxSlider.max = newSliderMax;
      // Preserve the locked slider values.
      csColorMinSlider.value = settings.colorMin;
      csColorMaxSlider.value = settings.colorMax;
    }

    // Compute a step value (here using absMaxComputed/500 as an example).
    const step = absMaxComputed / 500;
    csColorMinSlider.step = step;
    csColorMaxSlider.step = step;
  }
}