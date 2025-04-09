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

  