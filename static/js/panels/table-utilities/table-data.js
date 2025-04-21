/**
 * Utilities for loading and processing table data
 */
import { DataManager } from '../../data-manager.js';
import { setupSearchBuilderCriteriaListener } from './listeners.js';

/**
 * Load data for a table
 * @param {Object} settings - The table settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @param {AbortSignal} [signal] - Optional abort signal to allow cancellation
 * @returns {Promise<Object>} - The table data with column definitions
 */
export async function loadTableData(settings, entityType, signal = null) {
    try {
        // Check if already aborted
        if (signal && signal.aborted) {
            throw new DOMException('Table data loading aborted', 'AbortError');
        }
        
        // Load entity index based on entity type
        const entityIndex = entityType === 'cells' 
            ? DataManager.getCells() 
            : DataManager.getGenes();
        
        if (!entityIndex || entityIndex.length === 0) {
            throw new Error(`No ${entityType} found in dataset`);
        }
        
        // Check if aborted after fetching entity index
        if (signal && signal.aborted) {
            throw new DOMException('Table data loading aborted after entity index fetch', 'AbortError');
        }
        
        // First initialize the data array with the entity index
        const data = entityIndex.map(entity => ({ "_index": entity }));
        
        // Create basic column definitions with entity index
        const columnDefinitions = [{
            title: entityType === 'cells' ? 'Cell ID' : 'Gene ID',
            data: '_index',
            className: 'dt-center entity-index',
            render: function(data, type, row) {
                // For display/filter/sort, use as-is
                if (type === 'display') {
                    return `<span class="entity-index-value" data-entity="${data}">${data}</span>`;
                }
                return data;
            }
        }];
        
        // Only process additional columns if specified
        if (settings.columns && settings.columns.length > 0) {
            // For each column, load the data and create column definitions
            for (const column of settings.columns) {
                // Check for abort before loading each column
                if (signal && signal.aborted) {
                    throw new DOMException(`Table data loading aborted before loading column ${getColumnKey(column)}`, 'AbortError');
                }
                
                // Load data based on column type
                const columnData = await loadColumnData(column, entityType, signal);
                
                // Check if aborted after loading column data
                if (signal && signal.aborted) {
                    throw new DOMException(`Table data loading aborted after loading column ${getColumnKey(column)}`, 'AbortError');
                }
                
                // Add column data to the data object
                const columnKey = getColumnKey(column);
                if (columnData && columnData.length === entityIndex.length) {
                    data.forEach((row, i) => {
                        row[columnKey] = columnData[i];
                    });
                    
                    // Add column definition
                    const displayName = getColumnDisplayName(column);
                    columnDefinitions.push({
                        title: displayName,
                        data: columnKey,
                        className: 'dt-center',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                // Format based on data type
                                if (data === null || data === undefined) {
                                    return '<span class="text-muted">N/A</span>';
                                } else if (typeof data === 'number') {
                                    return data.toFixed(4).replace(/\.?0+$/, '');
                                } else if (typeof data === 'boolean') {
                                    return data ? 'Yes' : 'No';
                                }
                            }
                            return data;
                        }
                    });
                } else {
                    console.error(`Column data length (${columnData?.length}) doesn't match entity count (${entityIndex.length}) for ${columnKey}`);
                }
            }
        }
        
        // Final abort check before returning
        if (signal && signal.aborted) {
            throw new DOMException('Table data loading aborted before completion', 'AbortError');
        }
        
        return {
            data: data,
            columns: columnDefinitions,
            entityIndex: entityIndex
        };
        
    } catch (error) {
        // Only log non-abort errors
        if (!error || error.name !== 'AbortError') {
            console.error('Error loading table data:', error);
        } else {
            if (window.Config && window.Config.DEBUG_MODE) {
                console.debug('Table data loading was aborted:', error.message);
            }
        }
        throw error;
    }
}

/**
 * Load data for a specific column
 * @param {Object} column - The column configuration
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @param {AbortSignal} [signal] - Optional abort signal to allow cancellation
 * @returns {Promise<Array>} - The column data
 */
async function loadColumnData(column, entityType, signal = null) {
    const { type, key, column: columnName } = column;
    
    try {
        // Check if already aborted before any data loading
        if (signal && signal.aborted) {
            throw new DOMException(`Table column data loading aborted for ${type}.${key}.${columnName}`, 'AbortError');
        }
        
        // Load data based on column type and entity type
        if (entityType === 'cells') {
            // Cell table data
            if (type === 'obs') {
                const obsData = await DataManager.loadObs({
                    columns: [key]
                });
                return obsData.data[key];
            } else if (type === 'obsm') {
                const obsmData = await DataManager.loadObsm({
                    obsmKey: key,
                    columnName: columnName
                });
                return obsmData.data;
            } else if (type === 'obsp') {
                // Check if using focused cell or specific cell
                if (columnName === 'focused_cell' || columnName === '_focused_cell') {
                    // For focused cell in obsp
                    const focusedCell = DataManager.getFocusedCell();
                    const cellIndex = DataManager.getCellIndex(focusedCell);
                    
                    if (cellIndex >= 0) {
                        const obspData = await DataManager.loadObsp({
                            obspKey: key,
                            rows: [cellIndex]
                        });
                        return obspData.data[0];
                    }
                    return Array(DataManager.getCells().length).fill(null);
                } else {
                    // For fixed cell in obsp
                    const cellIndex = DataManager.getCellIndex(columnName);
                    
                    if (cellIndex >= 0) {
                        const obspData = await DataManager.loadObsp({
                            obspKey: key,
                            rows: [cellIndex]
                        });
                        return obspData.data[0];
                    }
                    return Array(DataManager.getCells().length).fill(null);
                }
            } else if (type === 'layer') {
                // Check if using focused gene or specific gene
                if (columnName === 'focused_gene' || columnName === '_focused_gene') {
                    // For focused gene in layer
                    const focusedGene = DataManager.getFocusedGene();
                    const geneIndex = DataManager.getGeneIndex(focusedGene);
                    
                    if (geneIndex >= 0) {
                        const layerData = await DataManager.loadLayer({
                            layerName: key,
                            cols: [geneIndex]
                        });
                        return layerData.data;
                    }
                    return Array(DataManager.getCells().length).fill(null);
                } else {
                    // For fixed gene in layer
                    const geneIndex = DataManager.getGeneIndex(columnName);
                    
                    if (geneIndex >= 0) {
                        const layerData = await DataManager.loadLayer({
                            layerName: key,
                            cols: [geneIndex]
                        });
                        return layerData.data;
                    }
                    return Array(DataManager.getCells().length).fill(null);
                }
            }
        } else {
            // Gene table data
            if (type === 'var') {
                const varData = await DataManager.loadVar({
                    columns: [key]
                });
                return varData.data[key];
            } else if (type === 'varm') {
                const varmData = await DataManager.loadVarm({
                    varmKey: key,
                    columnName: columnName
                });
                return varmData.data;
            } else if (type === 'varp') {
                // Check if using focused gene or specific gene
                if (columnName === 'focused_gene' || columnName === '_focused_gene') {
                    // For focused gene in varp
                    const focusedGene = DataManager.getFocusedGene();
                    const geneIndex = DataManager.getGeneIndex(focusedGene);
                    
                    if (geneIndex >= 0) {
                        const varpData = await DataManager.loadVarp({
                            varpKey: key,
                            rows: [geneIndex]
                        });
                        return varpData.data[0];
                    }
                    return Array(DataManager.getGenes().length).fill(null);
                } else {
                    // For fixed gene in varp
                    const geneIndex = DataManager.getGeneIndex(columnName);
                    
                    if (geneIndex >= 0) {
                        const varpData = await DataManager.loadVarp({
                            varpKey: key,
                            rows: [geneIndex]
                        });
                        return varpData.data[0];
                    }
                    return Array(DataManager.getGenes().length).fill(null);
                }
            } else if (type === 'layer') {
                // Check if using focused cell or specific cell
                if (columnName === 'focused_cell' || columnName === '_focused_cell') {
                    // For focused cell in layer
                    const focusedCell = DataManager.getFocusedCell();
                    const cellIndex = DataManager.getCellIndex(focusedCell);
                    
                    if (cellIndex >= 0) {
                        const layerData = await DataManager.loadLayer({
                            layerName: key,
                            rows: [cellIndex]
                        });
                        return layerData.data;
                    }
                    return Array(DataManager.getGenes().length).fill(null);
                } else {
                    // For fixed cell in layer
                    const cellIndex = DataManager.getCellIndex(columnName);
                    
                    if (cellIndex >= 0) {
                        const layerData = await DataManager.loadLayer({
                            layerName: key,
                            rows: [cellIndex]
                        });
                        return layerData.data;
                    }
                    return Array(DataManager.getGenes().length).fill(null);
                }
            }
        }
        
        return [];
    } catch (error) {
        // If it's an abort error, propagate it upwards
        if (error && error.name === 'AbortError') {
            throw error;
        }
        
        // Otherwise log the error and return null values
        console.error(`Error loading column data for ${type}.${key}.${columnName}:`, error);
        // Return null values instead of failing completely
        return entityType === 'cells' 
            ? Array(DataManager.getCells().length).fill(null)
            : Array(DataManager.getGenes().length).fill(null);
    }
}

/**
 * Get a unique key for a column
 * @param {Object} column - The column object
 * @returns {string} - The column key
 */
export function getColumnKey(column) {
    const { type, key, column: columnName } = column;
    return `${type}_${key}_${columnName || 'main'}`.replace(/\s+/g, '_');
}

/**
 * Get display name for a column
 * @param {Object} column - The column object
 * @returns {string} - The display name
 */
export function getColumnDisplayName(column) {
    if (column.type === 'obs' || column.type === 'var') {
        return `${column.key}`;
    } else if (column.type === 'obsm' || column.type === 'varm') {
        return `${column.key}:${column.column}`;
    } else if (column.type === 'obsp' || column.type === 'varp') {
        if (column.column === 'focused_cell' || column.column === '_focused_cell') {
            return `${column.key}: Focused Cell`;
        } else if (column.column === 'focused_gene' || column.column === '_focused_gene') {
            return `${column.key}: Focused Gene`;
        } else if (column.column) {
            return `${column.key}: ${column.column}`;
        } else {
            return `${column.key}`;
        }
    } else if (column.type === 'layer') {
        if (column.column === 'focused_gene' || column.column === '_focused_gene') {
            return `${column.key}: Focused Gene`;
        } else if (column.column === 'focused_cell' || column.column === '_focused_cell') {
            return `${column.key}: Focused Cell`;
        } else {
            return `${column.key}: ${column.column}`;
        }
    }
    return `${column.type}:${column.key}:${column.column}`;
}

/**
 * Initialize DataTables instance
 * @param {HTMLElement} tableContainer - The container for the table
 * @param {Object} tableData - The table data
 * @param {Object} settings - The table settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @returns {Object} - The DataTables instance
 */
export function initializeDataTable(tableContainer, tableData, settings, entityType) {
    // Clear the container and add a table element
    tableContainer.innerHTML = '<table class="table table-sm table-striped" style="width:100%"></table>';
    const table = tableContainer.querySelector('table');
    
    // Configure DataTables options
    const tableOptions = {
        data: tableData.data,
        columns: tableData.columns,
        paging: true,
        ordering: true,
        info: true,
        searching: true,
        lengthChange: false, // Hide default length selector as we have our own
        pageLength: settings.pageLength || 25,
        lengthMenu: [10, 25, 50, 100, 250],
        // Standard Bootstrap 5 DataTables layout with SearchBuilder and search box
        dom: '<"row"<"col-sm-12 col-md-9"Q><"col-sm-12 col-md-3 d-flex align-items-end justify-content-end"f>>' +
             '<"row"<"col-sm-12"tr>>' +
             '<"row"<"col-sm-12 col-md-7"i><"col-sm-12 col-md-5"p>>',
        scrollY: '100%', // Use percentage to fill container
        scrollCollapse: true,
        scrollX: false, // No horizontal scrolling
        fixedHeader: false, // Disable fixed header to avoid duplicate header issue
        
        // Use Bootstrap's built-in styling for striping
        hover: true,
        stripe: true,
        autoWidth: true,
        // Configure buttons properly - include basic export functionality
        buttons: {
            buttons: [
                {
                    extend: 'csv',
                    text: 'CSV',
                    className: 'd-none', // Hidden button for programmatic use
                    filename: function() {
                        // 'this' here refers to the DataTable API instance.
                        // Return the dynamically set property or fallback to a default name.
                        return `${settings.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`;
                      }
                }
            ]
        },
        searchBuilder: {
            preDefined: settings.searchBuilderConfig && 
                      settings.searchBuilderConfig.criteria ? 
                      settings.searchBuilderConfig : 
                      undefined,
            display: 'block' // Always display
        },
        initComplete: function(dtsettings, json) {
            // The DataTable instance is available as 'this' in the callback
            const api = this.api();
            const dtSettings = dtsettings || this.settings()[0];
            const panelSettings = dtSettings._panelSettings || {};

            // Add event handlers for entity selection
            api.on('click', '.entity-index-value', function() {
                const entity = $(this).data('entity');
                if (entityType === 'cells') {
                    DataManager.setFocusedCell(entity);
                } else {
                    DataManager.setFocusedGene(entity);
                }
            });
            
            // Make sure SearchBuilder is shown
            try {
                setupSearchBuilderCriteriaListener(api, settings)

            } catch (error) {
                console.error('Error initializing SearchBuilder:', error);
            }
            
        },
        drawCallback: function(settings) {
            // Update settings with filtered data
            updateFilteredSet(this, settings, entityType);
        }
    };
    
    // Initialize the DataTable
    const dataTable = $(table).DataTable(tableOptions);
    
    // Set compact row height for better density
    $(tableContainer).find('table.dataTable tbody tr').css({
        'height': '24px',
        'max-height': '24px'
    });
    
    // Return the DataTables instance
    return dataTable;
}

/**
 * Update settings with filtered entities
 * @param {Object} dataTable - The DataTables instance
 * @param {Object} settings - The DataTables settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 */
function updateFilteredSet(dataTable, dtSettings, entityType) {
    try {
        // Get all visible rows
        const api = new $.fn.dataTable.Api(dtSettings);
        let filteredData = [];
        
        try {
            // Try to get filtered data
            filteredData = api.rows({ search: 'applied' }).data().toArray();
        } catch (err) {
            console.warn('Error getting filtered rows:', err);
            return;
        }
        
        // Extract entity indices
        const filteredEntities = filteredData.map(row => row._index);
        
        // Store in the panel settings
        if (dtSettings._panelSettings) {
            if (entityType === 'cells') {
                dtSettings._panelSettings.filteredCells = filteredEntities;
                
                // Dispatch event
                const event = new CustomEvent('filteredCellsUpdated', {
                    detail: {
                        id: dtSettings._panelSettings.id,
                        filteredCells: filteredEntities
                    }
                });
                document.dispatchEvent(event);
            } else {
                dtSettings._panelSettings.filteredGenes = filteredEntities;
                
                // Dispatch event
                const event = new CustomEvent('filteredGenesUpdated', {
                    detail: {
                        id: dtSettings._panelSettings.id,
                        filteredGenes: filteredEntities
                    }
                });
                document.dispatchEvent(event);
            }
        }
    } catch (err) {
        console.error('Error updating filtered entities:', err);
    }
}

/**
 * Update table when focus changes
 * @param {Object} dataTable - The DataTables instance
 * @param {string} entity - The focused entity
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 */
export function updateTableOnFocusChange(dataTable, entity, entityType) {
    // Update any layer or relation columns
    const dtSettings = dataTable.settings()[0];
    const panelSettings = dtSettings._panelSettings;
    
    if (!panelSettings || !panelSettings.columns) {
        return;
    }
    
    // Check if we need to update any columns
    const needsUpdate = panelSettings.columns.some(col => {
        // Check for focused entity references
        const usesFocusedEntity = 
            (col.column === 'focused_gene' || col.column === '_focused_gene' || 
             col.column === 'focused_cell' || col.column === '_focused_cell');
             
        // Check for entity type-specific columns
        const usesEntitySpecificColumns = 
            (entityType === 'cells' && (col.type === 'layer' || col.type === 'varp')) || 
            (entityType === 'genes' && (col.type === 'layer' || col.type === 'obsp'));
            
        return usesFocusedEntity || usesEntitySpecificColumns;
    });
    
    if (needsUpdate) {
        // Reload the table data
        document.dispatchEvent(new CustomEvent('refreshTable', {
            detail: { id: panelSettings.id }
        }));
    }
}

/**
 * Export table data to CSV using DataTables built-in export functionality
 * @param {Object} dataTable - The DataTables instance
 * @param {string} tableTitle - The table title for the file name
 */
export function exportTableToCsv(dataTable, tableTitle) {
    try {
        // Get DataTables API object
        let api;
        if (typeof dataTable.api === 'function') {
            api = dataTable.api();
        } else {
            // When using jQuery object directly
            api = dataTable;
        }
        api.button('.buttons-csv').trigger()
    } catch (error) {
        console.error('Error exporting table to CSV:', error);
        alert('Failed to export table to CSV. See console for details.');
    }
}