/**
 * Utilities for loading and processing table data
 */
import { notify } from '../../utils/notify.js';
import { isBooleanColumn, renderBoolean, searchBuilderPreDefined } from '../../utils/search-builder.js';
import { DataManager } from '../../data-manager.js';
import { populateColumnsCellTable, populateColumnsGeneTable, setupColumnSelectionEvents} from './table-ui-make.js'
import {
    Coverage, GAP, ROLE, classifyColumn, classifyValues, classifyMatrixColumn,
    classifyError, missingEntity, unreadableCell, classifyFocusRow
} from '../../utils/coverage.js';

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
            // This one genuinely RESTRICTS: with no entity names there are no
            // rows at all, so "nothing shown" is the truth rather than a lie.
            err.coverage = Coverage.missing(GAP.UNAVAILABLE,
                `this dataset supplied no ${entityType} names`,
                { source: `${entityType} names`, unit: entityType });
            throw err;
        }
        // One entry per requested column. A column that never lands in this
        // list has not been classified, and Coverage.merge turns that into a
        // visible UNREPORTED rather than an absence nobody notices.
        const columnCoverages = [];
        const booleanColumns = [];   // data keys of Yes/No columns (search-builder.js)
        
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
                
                // Check if aborted after loading column data
                if (signal && signal.aborted) {
                    throw new DOMException(`Table data loading aborted after loading column ${getColumnKey(column)}`, 'AbortError');
                }
                
                // Add column data to the data object. EXACTLY ONE coverage is
                // pushed per requested column: pushing the loader's verdict here
                // and a second one below would count one bad column twice in the
                // notice.
                const columnKey = getColumnKey(column);
                if (Array.isArray(columnData) && columnData.length === entityIndex.length) {
                    columnCoverages.push(loaded.coverage);
                    data.forEach((row, i) => {
                        row[columnKey] = columnData[i];
                    });
                    
                    // Add column definition
                    const displayName = getColumnDisplayName(column);
                    if (isBooleanColumn(columnData)) {
                        // Yes/No for display, filtering and type detection, so
                        // a SearchBuilder "Equals Yes" matches (it saw raw
                        // booleans, typed the column num, and kept 0 rows)
                        booleanColumns.push(columnKey);
                        columnDefinitions.push({
                            title: displayName,
                            data: columnKey,
                            className: 'dt-center',
                            type: 'string',
                            render: renderBoolean
                        });
                        continue;
                    }
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
                    // When the loader already said WHY -- absent from the
                    // dataset, failed read, unfindable cell -- that reason is
                    // the news and stands as the column's one coverage. Only a
                    // length mismatch the loader thought was fine needs its own.
                    columnCoverages.push(
                        loaded.coverage.isComplete
                            ? Coverage.missing(GAP.FAILED,
                                `returned ${Array.isArray(columnData) ? columnData.length : 0} values for ${entityIndex.length} ${entityType}, `
                                + 'so the column was left out of the table',
                                { source: columnKey, unit: entityType, total: entityIndex.length,
                                  role: ROLE.DESCRIBES })
                            : loaded.coverage);
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
            booleanColumns: booleanColumns,
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

    // A table column DESCRIBES rows that are on screen regardless of whether it
    // could be read: 75,000 rows do not vanish because one column is missing.
    // Without this the panel's merged `shown` fell to 0 and the notice read
    // "No cells shown (of 75,000)" above a fully populated table.
    const opts = { unit: entityType, source, role: ROLE.DESCRIBES };

    try {
        const loaded = await _loadColumnValues(column, entityType, signal);

        // A response body, when there is one, is classified as a body -- NOT as
        // the array extracted from it. `response.data[key]` is `undefined` both
        // when the column is absent from the dataset and when the read failed,
        // so extracting first destroys the one discriminator the server gives
        // us. This is the whole reason the plot and the table used to give
        // opposite answers for one response.
        if (loaded.response) {
            return {
                values: loaded.values,
                coverage: classifyColumn({
                    column: loaded.column, response: loaded.response,
                    expected, ...opts
                })
            };
        }

        // Paths with no response body to inspect say for themselves what they
        // could not find; everything else goes through the same value
        // classifier the plot uses.
        if (loaded.unavailable) {
            // One sentence, shared with the plot -- see missingEntity().
            const { kind, name, cell } = loaded.unavailable;
            return {
                values: loaded.values,
                coverage: kind === 'cell'
                    ? unreadableCell(cell || (name ? { name } : null), { ...opts, total: expected })
                    : missingEntity(kind, name, { ...opts, total: expected })
            };
        }
        if (loaded.matrixKey !== undefined) {
            // obsm/varm/obsp/varp/layer bodies carry no key-presence signal,
            // so they go through the matrix rule the plot uses. Reading this
            // identical body by a different rule is what once made the table
            // say "failed to read" (error) beside the plot's "not in this
            // dataset" (warning), on one page.
            // A slice taken AT one entity (obsp/varp row, layer row/column)
            // carries `slice`, so an all-blank one names that entity and the
            // fix -- the same sentence the plot gives (classifyFocusRow).
            return {
                values: loaded.values,
                coverage: loaded.slice
                    ? classifyFocusRow({
                        values: loaded.values, expected, key: loaded.matrixKey,
                        ...loaded.slice, ...opts
                    })
                    : classifyMatrixColumn({
                        values: loaded.values, expected, key: loaded.matrixKey, ...opts
                    })
            };
        }
        if (loaded.unsupported) {
            // Nobody taught the table to load this column type. That is a
            // defect in our code, and UNREPORTED is what says so out loud
            // rather than dressing it up as missing data.
            return {
                values: loaded.values,
                coverage: Coverage.missing(GAP.UNREPORTED,
                    `the table does not know how to load a "${type}" column`,
                    { ...opts, total: expected })
            };
        }

        return {
            values: loaded.values,
            coverage: classifyValues({ values: loaded.values, expected, ...opts })
        };
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        console.error(`Error loading column data for ${source}:`, error);
        // The all-null fallback is kept -- the table still renders -- but the
        // reason now travels with it instead of being logged and dropped.
        return {
            values: Array(expected).fill(null),
            coverage: (error.coverage ? error.coverage.asDescribing() : null)
                || classifyError(error, { ...opts, total: expected })
        };
    }
}

/**
 * Fetch one table column's raw values, together with the PROVENANCE its caller
 * needs to classify them. Throws on failure.
 *
 * Returns `{ values, response?, column?, unavailable?, unsupported? }`:
 *
 *   - `response` + `column` -- an obs/var body, to be classified as a body.
 *     Returning `response.data[key]` alone would collapse "the column is not in
 *     this dataset" (key ABSENT) and "the read failed" (key present, empty)
 *     into one indistinguishable `undefined`, which is precisely how the table
 *     came to contradict the plot about the same server response.
 *   - `unavailable` -- `{kind, name, cell?}` for a cell/gene that is not in
 *     THIS dataset (or, `cell` from DataManager.locateCell, a cell outside the
 *     subset that an older server cannot read). It used to return a full-length array of nulls, which the
 *     classifier could only read as "legitimately blank"; the sentence is now
 *     built by `missingEntity`, shared with the plot.
 *   - `matrixKey` -- this came from an obsm/varm/obsp/varp/layer member, whose
 *     body has no key-presence signal (see `classifyMatrixColumn`).
 *   - `slice` -- `{kind, name, focused}` when that read was taken AT one cell
 *     or gene (obsp/varp row, layer row/column), for `classifyFocusRow`.
 *   - `unsupported` -- an unrecognised column type; a defect in this function.
 *
 * Callers must go through `loadColumnData`, which attaches the Coverage.
 */
async function _loadColumnValues(column, entityType, signal = null) {
    const { type, key, column: columnName } = column;

    // obsp/varp answer with a LIST OF ROWS. Reaching straight for `data[0]`
    // turns an empty body -- `{"data": []}`, the server's measured shape for an
    // absent key -- into `undefined`, which is indistinguishable from a
    // malformed row and classifies as a read failure. That is B1's
    // extract-before-classify shape one level down, and it made the table say
    // "failed to read" where the plot said "not in this dataset" for the same
    // body. An empty body stays an empty ARRAY so `classifyMatrixColumn` can
    // recognise it.
    const firstRow = (body) =>
        (Array.isArray(body) && body.length > 0) ? body[0] : [];

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
                return { values: obsData.data ? obsData.data[key] : undefined,
                         response: obsData, column: key };
            } else if (type === 'obsm') {
                const obsmData = await DataManager.loadObsm({
                    obsmKey: key,
                    columnName: columnName
                });
                return { values: obsmData.data, matrixKey: key };
            } else if (type === 'obsp') {
                // The focused cell, or a fixed one; a cell the subset does
                // not show is read by its dataset row (DataManager.locateCell)
                const focused = columnName === 'focused_cell' || columnName === '_focused_cell';
                const name = focused ? DataManager.getFocusedCell() : columnName;
                const cell = await DataManager.locateCell(name);
                if (DataManager.cellRowParams(cell)) {
                    const obspData = await DataManager.loadObsp({ obspKey: key, cell });
                    return { values: firstRow(obspData.data), matrixKey: key,
                             slice: { kind: 'cell', name, focused } };
                }
                return {
                    values: Array(DataManager.getCells().length).fill(null),
                    unavailable: { kind: 'cell', name, cell }
                };
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
                        return { values: layerData.data, matrixKey: key,
                                 slice: { kind: 'gene', name: focusedGene, focused: true } };
                    }
                    return {
                        values: Array(DataManager.getCells().length).fill(null),
                        unavailable: { kind: 'gene', name: focusedGene }
                    };
                } else {
                    // For fixed gene in layer
                    const geneIndex = DataManager.getGeneIndex(columnName);
                    
                    if (geneIndex >= 0) {
                        const layerData = await DataManager.loadLayer({
                            layerName: key,
                            cols: [geneIndex]
                        });
                        return { values: layerData.data, matrixKey: key,
                                 slice: { kind: 'gene', name: columnName, focused: false } };
                    }
                    return {
                        values: Array(DataManager.getCells().length).fill(null),
                        unavailable: { kind: 'gene', name: columnName }
                    };
                }
            }
        } else {
            // Gene table data
            if (type === 'var') {
                const varData = await DataManager.loadVar({
                    columns: [key]
                });
                return { values: varData.data ? varData.data[key] : undefined,
                         response: varData, column: key };
            } else if (type === 'varm') {
                const varmData = await DataManager.loadVarm({
                    varmKey: key,
                    columnName: columnName
                });
                return { values: varmData.data, matrixKey: key };
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
                        return { values: firstRow(varpData.data), matrixKey: key,
                                 slice: { kind: 'gene', name: focusedGene, focused: true } };
                    }
                    return {
                        values: Array(DataManager.getGenes().length).fill(null),
                        unavailable: { kind: 'gene', name: focusedGene }
                    };
                } else {
                    // For fixed gene in varp
                    const geneIndex = DataManager.getGeneIndex(columnName);
                    
                    if (geneIndex >= 0) {
                        const varpData = await DataManager.loadVarp({
                            varpKey: key,
                            rows: [geneIndex]
                        });
                        return { values: firstRow(varpData.data), matrixKey: key,
                                 slice: { kind: 'gene', name: columnName, focused: false } };
                    }
                    return {
                        values: Array(DataManager.getGenes().length).fill(null),
                        unavailable: { kind: 'gene', name: columnName }
                    };
                }
            } else if (type === 'layer') {
                // The focused cell's expression row, or a fixed cell's; also
                // for a cell the subset does not show (see obsp above)
                const focused = columnName === 'focused_cell' || columnName === '_focused_cell';
                const name = focused ? DataManager.getFocusedCell() : columnName;
                const cell = await DataManager.locateCell(name);
                if (DataManager.cellRowParams(cell)) {
                    const layerData = await DataManager.loadLayer({ layerName: key, cell });
                    return { values: layerData.data, matrixKey: key,
                             slice: { kind: 'cell', name, focused } };
                }
                return {
                    values: Array(DataManager.getGenes().length).fill(null),
                    unavailable: { kind: 'cell', name, cell }
                };
            }
        }
        
        return { values: [], unsupported: true };
    } catch (error) {
        // Rethrow -- including aborts. The all-null fallback and the reason for
        // it now live together in loadColumnData's catch. Swallowing here is
        // what turned a read failure into a column of "N/A" that looked exactly
        // like data which is legitimately absent.
        console.error(`Error loading column data for ${type}.${key}.${columnName}:`, error);
        throw error;
    }
}

const FOCUSED_CELL_COLUMNS = new Set(['focused_cell', '_focused_cell']);
const FOCUSED_GENE_COLUMNS = new Set(['focused_gene', '_focused_gene']);

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
 *
 * A column picked from a cell or gene is named after it ("connectivities:
 * HSPC_Old_1#..."). Only a placeholder column from an older session follows
 * the focus; it names the entity it shows right now and says that it follows.
 * @param {Object} column - The column object
 * @returns {string} - The display name
 */
export function getColumnDisplayName(column) {
    if (column.type === 'obs' || column.type === 'var') {
        return `${column.key}`;
    } else if (column.type === 'obsm' || column.type === 'varm') {
        return `${column.key}:${column.column}`;
    } else if (column.type === 'obsp' || column.type === 'varp' || column.type === 'layer') {
        // a cell the subset does not show is still a column, and says so
        const notShown = name => (DataManager.cellShown(name) === false ? ' (not shown)' : '');
        if (FOCUSED_CELL_COLUMNS.has(column.column)) {
            const focused = DataManager.getFocusedCell();
            return `${column.key}: ${focused ?? 'no focused cell'} (follows focus)${notShown(focused)}`;
        } else if (FOCUSED_GENE_COLUMNS.has(column.column)) {
            return `${column.key}: ${DataManager.getFocusedGene() ?? 'no focused gene'} (follows focus)`;
        } else if (column.column) {
            return `${column.key}: ${column.column}${notShown(column.column)}`;
        }
        return `${column.key}`;
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
                    // Export the data, not the display: the display rounds
                    // numbers to 4 decimals and wraps ids in HTML. The column
                    // renders return the raw value for any type but 'display'.
                    exportOptions: { orthogonal: 'export' },
                    filename: function() {
                        // 'this' here refers to the DataTable API instance.
                        // Return the dynamically set property or fallback to a default name.
                        return `${settings.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`;
                      }
                }
            ]
        },
        searchBuilder: {
                // criteria AND top-level logic (an OR came back as AND), with
                // boolean conditions saved as num 'true' translated to Yes/No
                preDefined: searchBuilderPreDefined(settings.searchBuilderConfig, tableData.booleanColumns || []),
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
 * The selected columns that read the focus that just changed.
 *
 * A column follows the focus only through its `focused_cell` / `focused_gene`
 * placeholder, which only older sessions hold: a column picked from the
 * focus now stores the entity's name and does not move (issue #9).
 * @param {Array<Object>} columns - The table's selected columns
 * @param {string} changedEntityType - Which focus changed ('cells' or 'genes')
 * @returns {Array<Object>}
 */
export function columnsFollowingFocus(columns, changedEntityType) {
    const placeholders = changedEntityType === 'cells' ? FOCUSED_CELL_COLUMNS
        : changedEntityType === 'genes' ? FOCUSED_GENE_COLUMNS : null;
    if (!placeholders || !Array.isArray(columns)) return [];
    return columns.filter(col => col && placeholders.has(col.column));
}

/**
 * Whether any selected column reads the focus that just changed.
 * @param {Array<Object>} columns - The table's selected columns
 * @param {string} changedEntityType - Which focus changed ('cells' or 'genes')
 * @returns {boolean}
 */
export function focusChangeAffectsColumns(columns, changedEntityType) {
    return columnsFollowingFocus(columns, changedEntityType).length > 0;
}

/**
 * Reload the given columns into the live table, leaving every other column,
 * the paging and the SearchBuilder state as they are.
 *
 * Used for placeholder columns that follow the focus. Rebuilding the whole
 * table for them reloaded every column and re-created the DataTable on each
 * focus change.
 * @param {Object} dataTable - The DataTables API instance
 * @param {Array<Object>} columns - Columns to reload
 * @param {string} tableEntityType - The table's rows ('cells' or 'genes')
 * @returns {Promise<boolean>} false when a column is not in the table (it was
 *     left out when it last failed to load), so the caller must rebuild
 */
export async function reloadColumnsInPlace(dataTable, columns, tableEntityType) {
    const aoColumns = dataTable.settings()[0].aoColumns || [];
    const rows = dataTable.rows();
    const n = rows.count();
    let changed = false;
    for (const column of columns) {
        const key = getColumnKey(column);
        const colIdx = aoColumns.findIndex(c => c.mData === key || c.data === key);
        if (colIdx < 0) return false;
        const { values } = await loadColumnData(column, tableEntityType);
        const fits = Array.isArray(values) && values.length === n;
        rows.every(function (rowIdx) {
            this.data()[key] = fits ? values[rowIdx] : null;
        });
        const header = dataTable.column(colIdx).header();
        if (header) header.textContent = getColumnDisplayName(column);
        changed = true;
    }
    if (changed) rows.invalidate('data').draw(false);
    return true;
}

/**
 * Put new rows into a table that has the same columns, keeping the table:
 * its search, sort order, page length and scroll stay where the user left
 * them. False when the columns differ (the caller rebuilds the table).
 * @param {Object} dataTable - DataTables API instance
 * @param {{data: Array, columns: Array}} tableData - from loadTableData
 * @returns {boolean} whether the rows were replaced
 */
export function replaceRowsInPlace(dataTable, tableData) {
    if (!dataTable || !tableData || !Array.isArray(tableData.data) || !tableData.data.length) return false;
    const have = (dataTable.settings()[0].aoColumns || []).map(c => `${c.mData}|${c.sTitle}`);
    const want = (tableData.columns || []).map(c => `${c.data}|${c.title}`);
    if (have.length !== want.length || have.some((h, i) => h !== want[i])) return false;
    dataTable.clear();
    dataTable.rows.add(tableData.data);
    dataTable.draw(false);
    return true;
}

/**
 * Rebuild a table's column chooser: its lists of focused and locked entities
 * change with the focus and with every lock in every plot.
 * @param {Object} panelSettings - The table panel's settings
 * @param {string} tableRows - The table's rows ('cells' or 'genes')
 */
export async function refreshColumnChooser(panelSettings, tableRows) {
    if (!panelSettings?.id) return;
    const datasetStructure = await DataManager.getDatasetStructure(DataManager.getCurrentDataset());
    if (!datasetStructure) return;
    // Which tabs exist depends on the TABLE, not on the focus.
    const sources = tableRows === 'cells' ? [
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
        const contentContainer = document.getElementById(`${source.id}-content-${panelSettings.id}`);
        if (contentContainer == null) return;
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
    if (tableRows === 'cells') {
        populateColumnsCellTable(sources, datasetStructure, panelSettings.id, panelSettings);
    }
    else {
        populateColumnsGeneTable(sources, datasetStructure, panelSettings.id, panelSettings);
    }

    // Set up event listeners for column selection
    setupColumnSelectionEvents(panelSettings.id, panelSettings, tableRows);
}

/**
 * Update table when focus changes
 *
 * The table itself changes only for placeholder columns that follow the
 * focus, and then only those columns are reloaded. The column chooser is
 * always rebuilt, since it offers the new focused entity.
 * @param {Object} dataTable - The DataTables instance
 * @param {string} entity - The focused entity
 * @param {string} entityType - Which focus changed ('cells' or 'genes')
 * @param {string} [tableEntityType] - The table's own rows ('cells' or 'genes').
 *     Defaults to the opposite of `entityType`, the only pairing that existed
 *     before tables listened to both foci.
 */
export async function updateTableOnFocusChange(dataTable, entity, entityType, tableEntityType) {
    const panelSettings = dataTable.settings()[0]._panelSettings;
    if (!panelSettings || !panelSettings.columns) {
        return;
    }
    const tableRows = tableEntityType || (entityType === 'genes' ? 'cells' : 'genes');

    const following = columnsFollowingFocus(panelSettings.columns, entityType);
    if (following.length) {
        let inPlace = false;
        try {
            inPlace = await reloadColumnsInPlace(dataTable, following, tableRows);
        } catch (error) {
            console.error('Reloading focus-following columns failed, rebuilding the table:', error);
        }
        if (!inPlace) {
            document.dispatchEvent(new CustomEvent('refreshTable', {
                detail: { id: panelSettings.id }
            }));
        }
    }

    await refreshColumnChooser(panelSettings, tableRows);
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
        notify('CSV export failed', error.message || 'See the browser console for details.', 'error');
    }
}