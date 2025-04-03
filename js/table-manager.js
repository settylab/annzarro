/**
 * TableManager - Creates and manages DataTables for cell and gene data
 * This class is responsible for:
 * 1. Creating and configuring DataTables
 * 2. Handling DataTable events like selection and filtering
 * 3. Managing table data and column visibility
 */

class TableManager {
    constructor() {
        // Map of table instances
        this.tables = new Map();
        
        // Map of searchBuilder instances
        this.searchBuilders = new Map();
        
        // Column configurations
        this.columnConfigs = {
            // Special columns that should be visible by default
            defaultVisible: ['_index', 'gene', 'cell', 'symbol', 'name'],
            
            // Columns that should always be hidden
            alwaysHidden: ['_row', '_column']
        };
        
        // Current filter settings
        this.filters = new Map();
    }

    /**
     * Create a new DataTable
     * @param {string} containerId - ID of the container element
     * @param {Array} data - Data for the table
     * @param {Array} columns - Column definitions
     * @param {Object} options - Additional options
     * @returns {Object} The DataTable instance
     */
    createTable(containerId, data, columns, options = {}) {
        // Get the container element
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container element with ID ${containerId} not found`);
            return null;
        }
        
        // Clear the container
        container.innerHTML = '';
        
        // Create a table element
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        table.style.width = '100%';
        container.appendChild(table);
        
        // Process column definitions
        const columnDefs = this._processColumnDefinitions(columns);
        
        // Configure default options
        const defaultOptions = {
            data: data,
            columns: columns,
            columnDefs: columnDefs,
            dom: 'Qlfrtip', // Include SearchBuilder ('Q')
            responsive: true,
            orderCellsTop: true,
            fixedHeader: true,
            paging: true,
            pageLength: 25,
            lengthMenu: [10, 25, 50, 100],
            scrollY: options.scrollY || '400px',
            scrollX: true,
            select: {
                style: 'multi',
                selector: 'td:first-child'
            },
            buttons: [
                {
                    extend: 'colvis',
                    text: 'Columns',
                    columns: ':not(.noVis)'
                },
                {
                    extend: 'collection',
                    text: 'Export',
                    buttons: [
                        'copy',
                        'csv',
                        'excel',
                        'pdf'
                    ]
                }
            ],
            language: {
                searchBuilder: {
                    data: 'Column',
                    value: 'Value',
                    conditions: {
                        string: {
                            contains: 'Contains',
                            empty: 'Empty',
                            notEmpty: 'Not Empty',
                            equals: 'Equals',
                            notContains: 'Does not contain',
                            startsWith: 'Starts with',
                            endsWith: 'Ends with'
                        },
                        num: {
                            equals: 'Equals',
                            gt: '>',
                            gte: '>=',
                            lt: '<',
                            lte: '<=',
                            not: 'Not',
                            between: 'Between',
                            notBetween: 'Not Between'
                        }
                    }
                }
            }
        };
        
        // Merge with user options
        const tableOptions = {...defaultOptions, ...options};
        
        // Initialize DataTable
        const dataTable = $(table).DataTable(tableOptions);
        
        // Store the table instance
        this.tables.set(containerId, {
            table: dataTable,
            container: container,
            columns: columns,
            data: data,
            options: tableOptions
        });
        
        // Get the searchBuilder instance
        const searchBuilder = dataTable.searchBuilder();
        this.searchBuilders.set(containerId, searchBuilder);
        
        // Set up event handlers
        this._setupEventHandlers(containerId, dataTable);
        
        return dataTable;
    }

    /**
     * Process column definitions to set visibility and rendering
     * @param {Array} columns - Column definitions
     * @returns {Array} Processed column definitions
     * @private
     */
    _processColumnDefinitions(columns) {
        const columnDefs = [];
        
        // Add default visibility rules
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            const columnName = column.data;
            
            // Check if column should be visible by default
            const visible = this.columnConfigs.defaultVisible.includes(columnName) ||
                            column.defaultVisible === true;
                            
            // Check if column should always be hidden
            const alwaysHidden = this.columnConfigs.alwaysHidden.includes(columnName) ||
                                column.alwaysHidden === true;
            
            // Add column definition
            columnDefs.push({
                targets: i,
                visible: visible && !alwaysHidden,
                searchable: !alwaysHidden,
                className: alwaysHidden ? 'noVis' : ''
            });
        }
        
        return columnDefs;
    }

    /**
     * Set up event handlers for the DataTable
     * @param {string} containerId - ID of the container element
     * @param {Object} dataTable - DataTable instance
     * @private
     */
    _setupEventHandlers(containerId, dataTable) {
        // Selection change event
        dataTable.on('select', (e, dt, type, indexes) => {
            if (type === 'row') {
                const selectedData = dataTable.rows(indexes).data().toArray();
                
                // Dispatch custom event
                const event = new CustomEvent('tableSelectionChanged', {
                    detail: {
                        containerId: containerId,
                        selected: selectedData,
                        type: 'add'
                    }
                });
                document.dispatchEvent(event);
            }
        });
        
        // Deselection event
        dataTable.on('deselect', (e, dt, type, indexes) => {
            if (type === 'row') {
                const deselectedData = dataTable.rows(indexes).data().toArray();
                
                // Dispatch custom event
                const event = new CustomEvent('tableSelectionChanged', {
                    detail: {
                        containerId: containerId,
                        selected: deselectedData,
                        type: 'remove'
                    }
                });
                document.dispatchEvent(event);
            }
        });
        
        // Search event
        dataTable.on('search.dt', () => {
            // Get filtered data
            const filteredData = dataTable.rows({search: 'applied'}).data().toArray();
            
            // Update filters
            this.filters.set(containerId, {
                active: dataTable.search() !== '',
                filtered: filteredData
            });
            
            // Dispatch custom event
            const event = new CustomEvent('tableFilterChanged', {
                detail: {
                    containerId: containerId,
                    filtered: filteredData,
                    activeFilter: dataTable.search() !== ''
                }
            });
            document.dispatchEvent(event);
        });
    }

    /**
     * Get a DataTable instance
     * @param {string} containerId - ID of the container element
     * @returns {Object|null} The DataTable instance or null if not found
     */
    getTable(containerId) {
        const tableInfo = this.tables.get(containerId);
        return tableInfo ? tableInfo.table : null;
    }

    /**
     * Update the data in a DataTable
     * @param {string} containerId - ID of the container element
     * @param {Array} newData - New data for the table
     * @returns {Object|null} The updated DataTable instance or null if not found
     */
    updateTableData(containerId, newData) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Update the table data
        tableInfo.table.clear();
        tableInfo.table.rows.add(newData);
        tableInfo.table.draw();
        
        // Update the stored data
        tableInfo.data = newData;
        
        return tableInfo.table;
    }

    /**
     * Add or remove columns from a DataTable
     * @param {string} containerId - ID of the container element
     * @param {Array} columns - Column definitions to add
     * @param {Array} columnsToRemove - Column names to remove
     * @returns {Object|null} The updated DataTable instance or null if not found
     */
    updateTableColumns(containerId, columns = [], columnsToRemove = []) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Get current columns
        const currentColumns = [...tableInfo.columns];
        
        // Remove columns if specified
        const filteredColumns = columnsToRemove.length > 0
            ? currentColumns.filter(col => !columnsToRemove.includes(col.data))
            : currentColumns;
        
        // Add new columns if specified
        const newColumns = [
            ...filteredColumns,
            ...columns
        ];
        
        // Re-create the table with new columns
        const container = tableInfo.container;
        container.innerHTML = '';
        
        const table = document.createElement('table');
        table.className = 'table table-striped table-hover';
        table.style.width = '100%';
        container.appendChild(table);
        
        // Process column definitions
        const columnDefs = this._processColumnDefinitions(newColumns);
        
        // Update column definitions in options
        const newOptions = {
            ...tableInfo.options,
            columns: newColumns,
            columnDefs: columnDefs
        };
        
        // Initialize new DataTable
        const dataTable = $(table).DataTable(newOptions);
        
        // Update stored table info
        tableInfo.table = dataTable;
        tableInfo.columns = newColumns;
        tableInfo.options = newOptions;
        this.tables.set(containerId, tableInfo);
        
        // Update searchBuilder reference
        this.searchBuilders.set(containerId, dataTable.searchBuilder());
        
        // Set up event handlers
        this._setupEventHandlers(containerId, dataTable);
        
        return dataTable;
    }

    /**
     * Select rows in a DataTable based on criteria
     * @param {string} containerId - ID of the container element
     * @param {Function} filterFn - Function to filter rows
     * @returns {Object|null} The DataTable instance or null if not found
     */
    selectRows(containerId, filterFn) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Get the rows to select
        const indexes = [];
        tableInfo.table.rows().every(function(index) {
            const rowData = this.data();
            if (filterFn(rowData)) {
                indexes.push(index);
            }
        });
        
        // Select the rows
        tableInfo.table.rows(indexes).select();
        
        return tableInfo.table;
    }

    /**
     * Deselect all rows in a DataTable
     * @param {string} containerId - ID of the container element
     * @returns {Object|null} The DataTable instance or null if not found
     */
    deselectAllRows(containerId) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Deselect all rows
        tableInfo.table.rows().deselect();
        
        return tableInfo.table;
    }

    /**
     * Highlight a specific row in a DataTable
     * @param {string} containerId - ID of the container element
     * @param {string} value - Value to search for
     * @param {string} column - Column name to search in
     * @returns {Object|null} The DataTable instance or null if not found
     */
    highlightRow(containerId, value, column = '_index') {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Find the column index
        const columnIndex = tableInfo.columns.findIndex(col => col.data === column);
        if (columnIndex === -1) {
            console.error(`Column ${column} not found in table ${containerId}`);
            return null;
        }
        
        // Remove any existing highlights
        $(tableInfo.container).find('tr.highlighted-row').removeClass('highlighted-row');
        
        // Find the row with the matching value
        const rowIndex = tableInfo.table
            .column(columnIndex)
            .data()
            .toArray()
            .findIndex(val => val === value);
        
        if (rowIndex !== -1) {
            // Highlight the row
            $(tableInfo.table.row(rowIndex).node()).addClass('highlighted-row');
            
            // Scroll to the row
            const rowNode = tableInfo.table.row(rowIndex).node();
            const scrollBody = $(tableInfo.container).find('.dataTables_scrollBody');
            scrollBody.animate({
                scrollTop: $(rowNode).position().top + scrollBody.scrollTop()
            }, 500);
        }
        
        return tableInfo.table;
    }

    /**
     * Apply a search filter to a DataTable
     * @param {string} containerId - ID of the container element
     * @param {string} searchTerm - Search term
     * @returns {Object|null} The DataTable instance or null if not found
     */
    applySearch(containerId, searchTerm) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Apply the search
        tableInfo.table.search(searchTerm).draw();
        
        return tableInfo.table;
    }

    /**
     * Apply a SearchBuilder rule to a DataTable
     * @param {string} containerId - ID of the container element
     * @param {Object} rule - SearchBuilder rule
     * @returns {Object|null} The SearchBuilder instance or null if not found
     */
    applySearchBuilderRule(containerId, rule) {
        const searchBuilder = this.searchBuilders.get(containerId);
        if (!searchBuilder) {
            console.error(`No SearchBuilder found for container ${containerId}`);
            return null;
        }
        
        // Clear existing rules
        searchBuilder.clear();
        
        // Add the new rule
        const group = searchBuilder.getGroup();
        group.criteria[0].condition(rule.condition);
        group.criteria[0].data(rule.column);
        group.criteria[0].value(rule.value);
        
        // Apply the search
        searchBuilder.rebuild();
        
        return searchBuilder;
    }

    /**
     * Get the current filtered data from a DataTable
     * @param {string} containerId - ID of the container element
     * @returns {Array|null} The filtered data or null if table not found
     */
    getFilteredData(containerId) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Get filtered data
        return tableInfo.table.rows({search: 'applied'}).data().toArray();
    }

    /**
     * Get the selected rows from a DataTable
     * @param {string} containerId - ID of the container element
     * @returns {Array|null} The selected data or null if table not found
     */
    getSelectedData(containerId) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) {
            console.error(`No table found for container ${containerId}`);
            return null;
        }
        
        // Get selected data
        return tableInfo.table.rows({selected: true}).data().toArray();
    }

    /**
     * Destroy a DataTable
     * @param {string} containerId - ID of the container element
     */
    destroyTable(containerId) {
        const tableInfo = this.tables.get(containerId);
        if (!tableInfo) return;
        
        // Destroy the DataTable
        tableInfo.table.destroy();
        
        // Clear the container
        tableInfo.container.innerHTML = '';
        
        // Remove from maps
        this.tables.delete(containerId);
        this.searchBuilders.delete(containerId);
        this.filters.delete(containerId);
    }
}

// Create and export a singleton instance
const tableManager = new TableManager();

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = tableManager;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro) {
        window.Annzarro.registerModule('tableManager', tableManager);
        window.Annzarro.checkModulesReady();
    } else {
        window.tableManager = tableManager;
    }
}