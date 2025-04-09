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
        const columns = datasetStructure.obs?.columns || Object.keys(datasetStructure.obs || {});
        keyOptions = columns.map(col => `<option value="${col}">${col}</option>`);
        break;
      }
      case 'obsm': {
        const keys = Object.keys(datasetStructure.obsm?.dataframes || {});
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'obsp': {
        keyOptions = (datasetStructure.obsp?.keys || []).map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'layer': {
        const keys = datasetStructure.layers?.details?.keys || datasetStructure.layers?.keys || [];
        keyOptions = keys.map(key => `<option value="${key}">${key}</option>`);
        break;
      }
      case 'var': {
        const columns = datasetStructure.var?.columns || Object.keys(datasetStructure.var || {});
        keyOptions = columns.map(col => `<option value="${col}">${col}</option>`);
        break;
      }
      case 'varm':
      case 'varp': {
        const keys = datasetStructure[type]?.keys || [];
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
   * @param {string} plotType - Either 'cell' or 'gene'
   * @param {Object} datasetStructure - Structure of the loaded dataset
   */
  export function populateColumnSelector(settings, columnSelect, axis, plotType, datasetStructure) {
    const type = settings.type || 'obsm';
    let columnOptions = [];
    columnSelect.disabled = false;
  
    switch (type) {
      case 'obs':
      case 'var': {
        columnOptions = ['<option value="">N/A</option>'];
        columnSelect.disabled = true;
        break;
      }
      case 'obsm':
      case 'varm': {
        const df = datasetStructure.obsm?.dataframes?.[settings.key];
        const columns = df?.columns || [];
        if (columns.length > 0) {
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
        const focused = DataManager.getFocusedCell();
        columnOptions = focused ? [`<option value="${focused}">Connections to ${focused}</option>`]
                                : ['<option value="">Select a focused cell first</option>'];
        break;
      }
      case 'varp': {
        const focused = DataManager.getFocusedGene();
        columnOptions = focused ? [`<option value="${focused}">Connections to ${focused}</option>`]
                                : ['<option value="">Select a focused gene first</option>'];
        break;
      }
      case 'layer': {
        if (plotType === 'cell') {
          const focused = DataManager.getFocusedGene();
          columnOptions = focused ? [`<option value="${focused}">Expression of ${focused}</option>`]
                                  : ['<option value="">Select a focused gene first</option>'];
        } else if (plotType === 'gene') {
          const focused = DataManager.getFocusedCell();
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
 * @param {string} plotType - Either 'cell' or 'gene'
 * @param {Object} datasetStructure - Dataset structure as returned from DataManager
 * @returns {Promise<void>}
 */
export function setupAxisSelector(container, axis, settings, plotType, datasetStructure) {
    const typeSelect = container.querySelector(`.axis-type-select[data-axis="${axis}"]`);
    const keySelect = container.querySelector(`.axis-key-select[data-axis="${axis}"]`);
    const columnSelect = container.querySelector(`.axis-column-select[data-axis="${axis}"]`);
  
    if (!typeSelect || !keySelect || !columnSelect) {
      console.error(`Missing select elements for ${axis} axis`);
      return;
    }
  
    console.log(`Setting up ${axis} axis selector with settings:`, settings);
  
    settings.type = settings.type || 'obsm';
    typeSelect.value = settings.type;
  
    populateKeySelector(settings, keySelect, datasetStructure);
    populateColumnSelector(settings, columnSelect, axis, plotType, datasetStructure);
  
    console.log(`Axis '${axis}' setup complete with key='${settings.key}' and column='${settings.column}'`);
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