/**
 * Utilities for loading and processing table data
 */
import { DataManager } from '../../data-manager.js';
import { populateColumnsCellTable, populateColumnsGeneTable, setupColumnSelectionEvents} from './table-ui-make.js'
import { Coverage, GAP, classifyError } from '../../utils/coverage.js';

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
            const err = new Error(`No ${entityType} found in dataset`);
            err.coverage = Coverage.missing(GAP.UNAVAILABLE,
                `this dataset supplied no ${entityType} names`,
                { source: `${entityType} names`, unit: entityType });
            throw err;
        }
        // One entry per requested column. A column that never lands in this
        // list has not been classified, and Coverage.merge turns that into a
        // visible UNREPORTED rather than an absence nobody notices.
        const columnCoverages = [];
        
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
                const loaded = await loadColumnData(column, entityType, signal);
                const columnData = loaded.values;
                columnCoverages.push(loaded.coverage);
                
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
                    // The column is DROPPED from the table here. That used to be
                    // console-only: the user saw a table simply missing a column
                    // they had asked for, with no indication why.
                    console.error(`Column data length (${columnData?.length}) doesn't match entity count (${entityIndex.length}) for ${columnKey}`);
                    columnCoverages.push(Coverage.missing(GAP.FAILED,
                        `returned ${columnData ? columnData.length : 0} values for ${entityIndex.length} ${entityType}, `
                        + 'so the column was left out of the table',
                        { source: columnKey, unit: entityType, total: entityIndex.length }));
                }
            }
        }
        
        // Final abort check before returning
        if (signal && signal.aborted) {
            throw new DOMException('Table data loading aborted before completion', 'AbortError');
        }
        
        return {
            coverage: Coverage.merge(
                columnCoverages.length ? columnCoverages : [Coverage.complete(entityIndex.length, entityType)],
                entityType
            ),
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
    const source = `${type}.${key}` + (columnName ? `.${columnName}` : '');
    const expected = entityType === 'cells'
        ? (DataManager.getCells() || []).length
        : (DataManager.getGenes() || []).length;

    /**
     * The single verdict point for a table column. Every return path of
     * `_loadColumnValues` passes through here, so a branch added later cannot
     * hand back values without a classification.
     */
    const classify = (values) => {
        const n = Array.isArray(values) ? values.length : 0;
        if (n === 0) {
            return expected > 0
                ? Coverage.missing(GAP.FAILED,
                    `the column returned no values although this dataset has ${expected} ${entityType}`,
                    { source, unit: entityType, total: expected })
                : Coverage.missing(GAP.EMPTY, 'the column has no values',
                    { source, unit: entityType, total: expected });
        }
        // An all-blank column renders as a wall of "N/A" and reads exactly like
        // real data that happens to be missing. Full scan, not a sample: a
        // sampled verdict here would be a confident guess.
        if (values.every(v => v === null || v === undefined)) {
            return Coverage.missing(GAP.EMPTY,
                'every entry in this column is blank (nothing was available to fill it)',
                { source, unit: entityType, total: expected });
        }
        if (expected > 0 && n < expected) {
            return Coverage.partial(n, expected, GAP.FAILED,
                'the read returned fewer values than this dataset has entities',
                { source, unit: entityType });
        }
        return Coverage.complete(expected || n, entityType);
    };

    try {
        const values = await _loadColumnValues(column, entityType, signal);
        return { values, coverage: classify(values) };
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        console.error(`Error loading column data for ${source}:`, error);
        // The all-null fallback is kept -- the table still renders -- but the
        // reason now travels with it instead of being logged and dropped.
        return {
            values: Array(expected).fill(null),
            coverage: error.coverage
                || classifyError(error, { unit: entityType, source, total: expected })
        };
    }
}

/**
 * Fetch one table column's raw values. Returns an array; throws on failure.
 * Callers must go through `loadColumnData`, which attaches the Coverage.
 */
async function _loadColumnValues(column, entityType, signal = null) {
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
        // Rethrow -- including aborts. The all-null fallback and the reason for
        // it now live together in loadColumnData's catch. Swallowing here is
        // what turned a read failure into a column of "N/A" that looked exactly
        // like data which is legitimately absent.
        console.error(`Error loading column data for ${type}.${key}.${columnName}:`, error);
        throw error;
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
    const focusedCell = DataManager.getFocusedCell();
    const focusedGene = DataManager.getFocusedGene();
    if (column.type === 'obs' || column.type === 'var') {
        return `${column.key}`;
    } else if (column.type === 'obsm' || column.type === 'varm') {
        return `${column.key}:${column.column}`;
    } else if (column.type === 'obsp' || column.type === 'varp') {
        if (column.column === 'focused_cell' || column.column === '_focused_cell') {
            return `${column.key}: ${focusedCell}`;
        } else if (column.column === 'focused_gene' || column.column === '_focused_gene') {
            return `${column.key}: ${focusedGene}`;
        } else if (column.column) {
            return `${column.key}: ${column.column}`;
        } else {
            return `${column.key}`;
        }
    } else if (column.type === 'layer') {
        if (column.column === 'focused_gene' || column.column === '_focused_gene') {
            return `${column.key}: ${focusedGene}`;
        } else if (column.column === 'focused_cell' || column.column === '_focused_cell') {
            return `${column.key}: ${focusedCell}`;
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

    // State‐holders for our toggles:
    let useRegex          = false;
    let useSmart          = true;
    let useCaseInsensitive = true;
    
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
        // Default search options
        search: {
            regex:          useRegex,
            smart:          useSmart,
            caseInsensitive: useCaseInsensitive
        },
        // Standard Bootstrap 5 DataTables layout with SearchBuilder and search box
        dom: '<"row"<"col-sm-12 col-md-9"Q><"col-sm-12 col-md-3 d-flex align-items-end justify-content-end"f>>' +
             '<"row"<"col-sm-12"tr>>' +
             '<"row"<"col-sm-12 col-md-7"i><"col-sm-12 col-md-5"p>>',
        responsive: false, // Never use responsive mode
        scrollX: true, // Always enable horizontal scrolling
        scrollY: '350px',
        scrollCollapse: true, // Always collapse scroll
        fixedHeader: false,
        select: true, // Enable row selection
        hover: true,
        stripe: true,
        autoWidth: true, // essential for column name alignment with content
        // Use Bootstrap 5 styling
        language: {
            searchBuilder: {
                button: {
                    0: '<i class="fas fa-filter"></i> Filter',
                    1: '<i class="fas fa-filter"></i> Filters: 1',
                    _: '<i class="fas fa-filter"></i> Filters: %d'
                }
            }
        },
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
                preDefined: { criteria: settings.searchBuilderConfig?.criteria || [] },
                display: 'block', // Always display
                depthLimit: 2, // Limit depth to prevent overly complex queries
                layout: 'columns-2', // Modern layout with columns
                filterChanged: true, // Update table in real-time with changes
                greyscale: false, // Use full colors for better visibility
                i18n: {
                    add: 'Add Condition',
                    button: {
                        0: '<i class="fas fa-filter"></i> Filter',
                        _: '<i class="fas fa-filter"></i> Filters (%d)'
                    },
                    clearAll: 'Clear All',
                    condition: 'Condition',
                    data: 'Column',
                    "delete": 'Delete',
                    deleteTitle: 'Delete filtering rule',
                    left: '<i class="fas fa-angle-left"></i>',
                    logicAnd: 'AND',
                    logicOr: 'OR',
                    right: '<i class="fas fa-angle-right"></i>',
                    title: {
                        0: 'Advanced Search',
                        _: 'Advanced Search (%d)'
                    },
                    value: 'Value'
                }
            },
        initComplete: function(dtsettings, json) {
            // The DataTable instance is available as 'this' in the callback
            const api = this.api();

            // Add event handlers for entity selection
            api.on('click', '.entity-index-value', function() {
                const entity = $(this).data('entity');
                if (entityType === 'cells') {
                    DataManager.setFocusedCell(entity);
                } else {
                    DataManager.setFocusedGene(entity);
                }
            });
            
            // Access the search container - find it relative to the table container
            const tableContainer = this.api().table().container();
            // For Bootstrap 5 integration, the search input is in a different location
            const $searchInput = $(tableContainer).find('div.dataTables_filter input');
            
            // If search input found, create a wrapper and add buttons
            if ($searchInput.length) {
                console.log('Found search input for custom buttons');
                
                // Find the search container in Bootstrap 5 integration
                const $searchParent = $(tableContainer).find('div.dataTables_filter');
                
                // Create the search options container 
                const $searchOptions = $('<div class="dt-search-options"></div>');
                
                // Generate unique IDs for buttons based on table ID or a random number
                const tableId = this.api().table().node().id || Math.floor(Math.random() * 10000);
                const btnRegexId = `btnRegex_${tableId}`;
                const btnSmartId = `btnSmart_${tableId}`;
                const btnCaseId = `btnCase_${tableId}`;
                
                // Add the search control buttons with tooltips - initial state matching our variables
                // Using more intuitive symbols that match the functionality
                $searchOptions.append(`
                    <button id="${btnRegexId}" class="dt-search-option btn btn-sm${useRegex ? ' active' : ''}" 
                            title="Regular Expression Mode">
                        .*
                    </button>
                    <button id="${btnSmartId}" class="dt-search-option btn btn-sm${useSmart ? ' active' : ''}" 
                            title="Smart Search (default)">
                        <i class="fas fa-magic"></i>
                    </button>
                    <button id="${btnCaseId}" class="dt-search-option btn btn-sm${!useCaseInsensitive ? ' active' : ''}" 
                            title="Case Sensitive">
                        Aa
                    </button>
                `);
                
                // For Bootstrap 5 integration, we need to create a container
                // that works with the Bootstrap layout
                const $container = $('<div class="dt-search-container d-flex align-items-center mb-2"></div>');
                
                // In Bootstrap 5 integration, we need to restructure the search area
                const $label = $searchParent.find('label');
                
                if ($label.length) {
                    // Save the label text
                    const labelText = $label.text();
                    
                    // Create a new label with proper Bootstrap 5 styling
                    const $newLabel = $(`<label class="form-label me-2 dt-search-label">${labelText}</label>`);
                    
                    // Clear the parent and build our new structure
                    $searchParent.empty();
                    
                    // Create a container with flex column direction to stack elements
                    $container.removeClass('d-flex align-items-center').addClass('d-flex flex-column');
                    
                    // Create a row for the label and search input
                    const $searchRow = $('<div class="d-flex align-items-center w-100 mb-2"></div>');
                    $searchRow.append($newLabel);
                    
                    // Create an input group to hold the search input
                    const $inputGroup = $('<div class="input-group input-group-sm flex-grow-1"></div>');
                    $inputGroup.append($searchInput);
                    $searchRow.append($inputGroup);
                    
                    // Add the search row to the container
                    $container.append($searchRow);
                    
                    // Create a row for search options with proper styling
                    const $optionsRow = $('<div class="d-flex justify-content-end align-items-center w-100"></div>');
                    
                    // Add a descriptive label for the search options
                    const $optionsLabel = $('<small class="text-muted me-2">Search options:</small>');
                    $optionsRow.append($optionsLabel);
                    $optionsRow.append($searchOptions);
                    
                    // Add the options row below the search input
                    $container.append($optionsRow);
                    
                    // Add the container to the search parent
                    $searchParent.append($container);
                } else {
                    // Just append the search options after the input
                    $searchOptions.insertAfter($searchInput);
                }
                
                // 5) A small helper to re-draw with current flags
                function applySearch() {
                    const term = $searchInput.val();
                    api.search(term, useRegex, useSmart, useCaseInsensitive).draw();
                }
    
                // 6) Wire up clicks
                $(`#${btnRegexId}`).on('click', function() {
                    useRegex = !useRegex;
                    $(this).toggleClass('active', useRegex);
                    applySearch();
                });
                
                $(`#${btnSmartId}`).on('click', function() {
                    useSmart = !useSmart;
                    $(this).toggleClass('active', useSmart);
                    applySearch();
                });
                
                $(`#${btnCaseId}`).on('click', function() {
                    useCaseInsensitive = !useCaseInsensitive;
                    // Treating button as "Case Sensitive" - active when useCaseInsensitive is false
                    $(this).toggleClass('active', !useCaseInsensitive);
                    applySearch();
                });

                $searchInput.on('input', function() {
                    applySearch();
                });
                
            }
        }
    };
    
    // Initialize the DataTable with Bootstrap 5 styling
    let dataTable;
    try {
        // Add Bootstrap 5 specific classes and styling
        tableOptions.classes = {
            sTable: 'table table-striped table-hover',
            sWrapper: 'dataTables_wrapper dt-bootstrap5',
            sFilterInput: 'form-control form-control-sm',
            sLengthSelect: 'form-select form-select-sm',
            sProcessing: 'dataTables_processing card'
        };
        
        // Bootstrap 5 pagination styling
        tableOptions.language = {
            ...tableOptions.language,
            paginate: {
                first: '<i class="fas fa-angle-double-left"></i>',
                previous: '<i class="fas fa-angle-left"></i>',
                next: '<i class="fas fa-angle-right"></i>',
                last: '<i class="fas fa-angle-double-right"></i>'
            }
        };
        
        // Ensure DOM includes SearchBuilder (Q) before filter (f)
        if (!tableOptions.dom.includes('Q')) {
            tableOptions.dom = '<"row"<"col-sm-12 col-md-9"Q><"col-sm-12 col-md-3 d-flex align-items-end justify-content-end"f>>' +
                               '<"row"<"col-sm-12"tr>>' +
                               '<"row"<"col-sm-12 col-md-7"i><"col-sm-12 col-md-5"p>>';
        }
        
        // Initialize with SearchBuilder extension explicitly
        dataTable = $(table).DataTable(tableOptions);
        
        // Make sure SearchBuilder is visible
        setTimeout(() => {
            // Force the SearchBuilder to refresh and show properly
            if (dataTable.searchBuilder && typeof dataTable.searchBuilder.rebuild === 'function') {
                dataTable.searchBuilder.rebuild(settings.searchBuilderConfig || {});
            }
            
            // Make logic buttons more visible by adding custom classes
            $(tableContainer).find('.dtsb-logicButton').each(function() {
                const $button = $(this);
                if ($button.text().trim() === 'AND') {
                    $button.addClass('dtsb-logic-and');
                } else if ($button.text().trim() === 'OR') {
                    $button.addClass('dtsb-logic-or');
                }
            });
        }, 100);
        
    } catch (error) {
        console.error('Error initializing DataTable with SearchBuilder criteria:', error);
        dataTable = $(table).DataTable();
    }

    Object.defineProperty(settings, 'searchBuilderConfig', {
        configurable: true,
        get() {
          // this function will run each time someone does `settings.searchBuilderConfig`
          try {
            return dataTable.searchBuilder ? dataTable.searchBuilder.getDetails() : {};
          } catch (error) {
            console.warn('Failed to get searchBuilder details, returning empty object', error);
            return {};
          }
        }
      });

    // Keep track of previous entries to detect changes
    let previousEntries = [];
    
    Object.defineProperty(settings, 'currentEntries', {
        configurable: true,
        get() {
          // returns an array of the original-data indexes 
          // for every row that survives the current search/filter
          try {
            return dataTable
                .rows({ search: 'applied', order: 'applied' })
                .indexes()
                .toArray();
          } catch (error) {
            console.warn('Failed to get current entries, returning empty array', error);
            return [];
          }
        }
      });
    
    // Add event listeners for data redraw (after search/filter changes)
    dataTable.on('draw.dt', function() {
        // Get the current entries (deep copy since toArray() is already made in the getter)
        const currentEntries = [...settings.currentEntries];
        
        // Check if the entries have changed
        let entriesChanged = false;
        
        if (previousEntries.length !== currentEntries.length) {
            entriesChanged = true;
        } else {
            // Compare the entries arrays - they should be in the same order
            for (let i = 0; i < currentEntries.length; i++) {
                if (currentEntries[i] !== previousEntries[i]) {
                    entriesChanged = true;
                    break;
                }
            }
        }
        
        // Only notify if entries actually changed
        if (entriesChanged && window.PanelManager && window.PanelManager.notifyPanels && settings.id) {
            // Update the previous entries with a deep copy
            previousEntries = [...currentEntries];
            
            // Notify panels when table selection changes
            window.PanelManager.notifyPanels('tableFiltered', { 
                id: settings.id,
                type: entityType 
            });
        }
    });
    
    // Initialize previousEntries with a deep copy
    previousEntries = [...settings.currentEntries];

    // Notify panels that table selection changed
    window.PanelManager.notifyPanels('tableFiltered', { 
        id: settings.id,
        type: entityType 
    });
    
    // Return the DataTables instance
    return dataTable;
}

/**
 * Update table when focus changes
 * @param {Object} dataTable - The DataTables instance
 * @param {string} entity - The focused entity
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 */
export async function updateTableOnFocusChange(dataTable, entity, entityType) {
    // Update any layer or relation columns
    const dtSettings = dataTable.settings()[0];
    const panelSettings = dtSettings._panelSettings;
    const datasetPath = DataManager.getCurrentDataset()
    const datasetStructure = await DataManager.getDatasetStructure(datasetPath);
    
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
    
    //Refresh the main panel as well. 
    const sources = entityType === 'genes' ? [
        { id: 'obs', name: 'obs', label: 'obs' }, //Cell Annotations
        { id: 'obsm', name: 'obsm', label: 'obsm' }, // Cell Matrices
        { id: 'obsp', name: 'obsp', label: 'obsp' }, // Cell-Cell Relations
        { id: 'layer', name: 'layer', label: 'layers' } // Expression Layers
    ] : [
        { id: 'var', name: 'var', label: 'var' }, // Gene Annotations
        { id: 'varm', name: 'varm', label: 'varm' }, // Gene Matrices
        { id: 'varp', name: 'varp', label: 'varp' }, // Gene-Gene Relations
        { id: 'layer', name: 'layer', label: 'layers' } // Expression Layers
    ];

    //Make everything blank to start fresh
    for (const source of sources) {
        const contentContainer = document.getElementById(`${source.id}-content-${panelSettings.id}`);6
        if (contentContainer == null) {
            console.log("Container is null");
            return;
        }
        contentContainer.innerHTML = '';

        const searchContainer = document.createElement('div');
        searchContainer.className = 'input-group input-group-sm mb-2';
        
        const searchIcon = document.createElement('span');
        searchIcon.className = 'input-group-text';
        searchIcon.innerHTML = '<i class="fas fa-search"></i>';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'form-control column-search';
        searchInput.placeholder = `Search ${source.label.toLowerCase()}...`;
        searchInput.setAttribute('data-tab', source.id);
        
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        contentContainer.appendChild(searchContainer);

        //Add back the checkboxList element
        const checkboxList = document.createElement('div');
        checkboxList.className = 'checkbox-list';
        contentContainer.appendChild(checkboxList);
    }

    //Add them back
    if (entityType === 'genes') {
        populateColumnsCellTable(sources, datasetStructure, panelSettings.id, panelSettings);
    }
    else {
        populateColumnsGeneTable(sources, datasetStructure, panelSettings.id, panelSettings);
    }

    // Set up event listeners for column selection
    setupColumnSelectionEvents(panelSettings.id, panelSettings, entityType);
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