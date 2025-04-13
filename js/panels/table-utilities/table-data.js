/**
 * Utilities for loading and processing table data
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';

/**
 * Load data for a table
 * @param {Object} settings - The table settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @returns {Promise<Object>} - The table data with column definitions
 */
export async function loadTableData(settings, entityType) {
    if (!settings.columns || settings.columns.length === 0) {
        return {
            data: [],
            columns: [],
            entityIndex: []
        };
    }
    
    try {
        // Load entity index based on entity type
        const entityIndex = entityType === 'cells' 
            ? DataManager.getCells() 
            : DataManager.getGenes();
        
        if (!entityIndex || entityIndex.length === 0) {
            throw new Error(`No ${entityType} found in dataset`);
        }
        
        // First initialize the data array with the entity index
        const data = entityIndex.map(entity => ({ "_index": entity }));
        
        // Now load each column and add it to the data
        const columnDefinitions = [];
        columnDefinitions.push({
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
        });
        
        // For each column, load the data and create column definitions
        for (const column of settings.columns) {
            // Load data based on column type
            const columnData = await loadColumnData(column, entityType);
            
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
        
        return {
            data: data,
            columns: columnDefinitions,
            entityIndex: entityIndex
        };
        
    } catch (error) {
        console.error('Error loading table data:', error);
        throw error;
    }
}

/**
 * Load data for a specific column
 * @param {Object} column - The column configuration
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @returns {Promise<Array>} - The column data
 */
async function loadColumnData(column, entityType) {
    const { type, key, column: columnName } = column;
    
    try {
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
        return `${column.key}`;
    } else if (column.type === 'layer') {
        if (column.column === 'focused_gene') {
            return `${column.key}:Focused Gene`;
        } else if (column.column === 'focused_cell') {
            return `${column.key}:Focused Cell`;
        } else {
            return `${column.key}:${column.column}`;
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
    // Clear the container
    tableContainer.innerHTML = '';
    
    // Create table element with wrapper for better DataTables styling
    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive';
    
    const table = document.createElement('table');
    table.className = 'table table-striped table-bordered w-100';
    
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);
    
    // Configure DataTables options
    const tableOptions = {
        data: tableData.data,
        columns: tableData.columns,
        paging: true,
        ordering: true,
        info: true,
        searching: true,
        lengthChange: true,
        pageLength: 25,
        lengthMenu: [10, 25, 50, 100, 250],
        dom: settings.searchBuilderEnabled !== false ? 'QBlfrtip' : 'Blfrtip',
        responsive: settings.responsive !== false,
        scrollX: settings.responsive === false,
        scrollY: settings.fixedHeader ? '50vh' : '',
        scrollCollapse: settings.fixedHeader === true,
        buttons: [
            'copy', 'csv', 'excel'
        ],
        searchBuilder: settings.searchBuilderConfig && 
                   settings.searchBuilderConfig.criteria ? 
                   { preDefined: settings.searchBuilderConfig } : 
                   {},
        initComplete: function(settings, json) {
            // Check if search builder is enabled and there's a valid config
            if (settings.searchBuilderEnabled !== false && 
                settings.searchBuilderConfig && 
                settings.searchBuilderConfig.criteria) {
                
                // The DataTable instance is available as 'this' in the callback
                const api = this.api();
                if (api.searchBuilder) {
                    try {
                        api.searchBuilder.rebuild(settings.searchBuilderConfig);
                    } catch (error) {
                        console.warn('Error rebuilding SearchBuilder config:', error);
                    }
                }
            }
        },
        drawCallback: function(settings) {
            // Update settings with filtered data
            updateFilteredSet(this, settings, entityType);
        }
    };
    
    // Initialize the DataTable
    const dataTable = $(table).DataTable(tableOptions);
    
    // Add event handlers for entity selection
    $(table).on('click', '.entity-index-value', function() {
        const entity = $(this).data('entity');
        if (entityType === 'cells') {
            DataManager.setFocusedCell(entity);
        } else {
            DataManager.setFocusedGene(entity);
        }
    });
    
    // Check if SearchBuilder is actually available
    const hasSearchBuilder = typeof $.fn.dataTable.SearchBuilder !== 'undefined';
    
    // Handle SearchBuilder initialization
    try {
        // Only try to use SearchBuilder if it's available
        if (!hasSearchBuilder) {
            console.warn('SearchBuilder extension is not available, disabling SearchBuilder functionality');
            // Remove SearchBuilder from DOM if not available
            $(tableContainer).find('.dt-button[data-name="searchBuilder"]').remove();
        } else if (settings.searchBuilderEnabled === false) {
            // Hide search builder UI if explicitly disabled
            setTimeout(() => {
                $(tableContainer).find('.dt-button-collection, .dtsp-searchBuilder').hide();
                $(tableContainer).find('.dtsb-group').closest('.card, .container, .dataTables_wrapper').hide();
                $(tableContainer).find('.dt-button[data-name="searchBuilder"]').hide();
            }, 100);
        }
    } catch (err) {
        console.warn('Error managing SearchBuilder UI:', err);
    }
    
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
 * Export table data to CSV
 * @param {Object} dataTable - The DataTables instance
 * @param {string} tableTitle - The table title for the file name
 */
export function exportTableToCsv(dataTable, tableTitle) {
    const csvContent = [];
    const api = dataTable.api();
    
    // Get column headers
    const headers = api.columns().header().map(th => th.textContent).toArray();
    csvContent.push(headers.join(','));
    
    // Get visible rows
    const visibleRows = api.rows({ search: 'applied' }).data().toArray();
    
    // Add each row to CSV content
    visibleRows.forEach(row => {
        const values = headers.map(header => {
            const value = row[header] !== undefined ? row[header] : '';
            
            // Quote strings with commas
            if (typeof value === 'string' && value.includes(',')) {
                return `"${value}"`;
            }
            return value;
        });
        
        csvContent.push(values.join(','));
    });
    
    // Create CSV file and download
    const csvString = csvContent.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = `${tableTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}