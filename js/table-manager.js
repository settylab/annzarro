/**
 * Table Manager Module
 * 
 * Handles data table creation and management using DataTables
 */

const TableManager = (function() {
    // Private variables
    let _tables = {};
    let _pageSize = 25;
    
    /**
     * Initialize the table manager
     */
    function init() {
        console.log('TableManager initialized');
        
        // Listen for events
        document.addEventListener('dataLoaded', handleDataLoaded);
        document.addEventListener('geneFocusChanged', handleGeneFocusChanged);
        document.addEventListener('cellFocusChanged', handleCellFocusChanged);
        document.addEventListener('geneSetChanged', handleGeneSetChanged);
        document.addEventListener('cellSetChanged', handleCellSetChanged);
    }
    
    /**
     * Create a cells table
     * @param {string} elementId - ID of the table element
     * @param {Object} config - Table configuration
     * @returns {string} - Table ID
     */
    async function createCellsTable(elementId, config = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element not found: ${elementId}`);
            return null;
        }
        
        // Generate a unique table ID
        const tableId = `table-${Date.now()}`;
        
        try {
            // Default config
            const defaultConfig = {
                columns: ['_index'],
                initialPageLength: _pageSize,
                enableSelection: true,
                selectionSet: 'selectedCells',
                enableSearchBuilder: true
            };
            
            // Merge configs
            const mergedConfig = {...defaultConfig, ...config};
            
            // First check if dataset is loaded
            const datasetInfo = DataManager.getDatasetInfo();
            if (!datasetInfo) {
                throw new Error('No dataset loaded');
            }
            
            // Initialize loading state
            element.innerHTML = `
                <div class="alert alert-info">
                    <div class="d-flex align-items-center">
                        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                        <div>Loading cell data...</div>
                    </div>
                </div>
            `;
            
            // Load cell names
            const cellNames = await DataManager.loadCellNames();
            if (!cellNames || cellNames.length === 0) {
                throw new Error('No cell data available');
            }
            
            // Get the first 5 columns from obs if not specified
            if (mergedConfig.columns.length === 0 || 
                (mergedConfig.columns.length === 1 && mergedConfig.columns[0] === '_index')) {
                
                if (datasetInfo.obs_columns && datasetInfo.obs_columns.length > 0) {
                    mergedConfig.columns = ['_index', ...datasetInfo.obs_columns.slice(0, 4)];
                }
            }
            
            // Load obs data for columns
            const obsColumns = mergedConfig.columns.filter(col => col !== '_index');
            
            // Batch size for loading to avoid memory issues
            const batchSize = 1000;
            const batches = Math.ceil(cellNames.length / batchSize);
            
            let allObsData = {};
            
            // Initialize each column
            for (const col of obsColumns) {
                allObsData[col] = new Array(cellNames.length);
            }
            
            // Load data in batches
            for (let batch = 0; batch < batches; batch++) {
                const start = batch * batchSize;
                const end = Math.min(start + batchSize, cellNames.length);
                const indices = Array.from({ length: end - start }, (_, i) => start + i);
                
                const obsData = await DataManager.loadObs(indices, obsColumns);
                
                // Merge batch data into full dataset
                for (const col of obsColumns) {
                    for (let i = 0; i < indices.length; i++) {
                        allObsData[col][indices[i]] = obsData[col][i];
                    }
                }
            }
            
            // Prepare table data
            const data = [];
            
            for (let i = 0; i < cellNames.length; i++) {
                const row = { '_index': cellNames[i] };
                
                for (const col of obsColumns) {
                    row[col] = allObsData[col][i];
                }
                
                data.push(row);
            }
            
            // Prepare columns configuration
            const columns = mergedConfig.columns.map(col => {
                return {
                    data: col,
                    title: col === '_index' ? 'Cell ID' : col
                };
            });
            
            // Clear element
            element.innerHTML = '';
            
            // Create table
            const table = $(`#${elementId}`).DataTable({
                data: data,
                columns: columns,
                pageLength: mergedConfig.initialPageLength,
                scrollX: true,
                scrollY: '400px',
                scrollCollapse: true,
                dom: mergedConfig.enableSearchBuilder ? 'QBfrtip' : 'Bfrtip',
                select: mergedConfig.enableSelection,
                buttons: [
                    'copy', 'csv', 'excel'
                ],
                language: {
                    searchBuilder: {
                        title: 'Filter Cells',
                        button: 'Filter',
                        clearAll: 'Reset'
                    }
                }
            });
            
            // Add click handler for focusing cells
            $(`#${elementId} tbody`).on('click', 'tr', function() {
                const cellId = table.row(this).data()._index;
                DataManager.setFocusedCell(cellId);
            });
            
            // Add search builder change handler for selection sets
            if (mergedConfig.enableSearchBuilder && mergedConfig.selectionSet) {
                table.on('searchBuilder.search', () => {
                    updateCellSelectionFromTable(tableId, mergedConfig.selectionSet);
                });
            }
            
            // Store table reference
            _tables[tableId] = {
                table: table,
                element: element,
                config: mergedConfig,
                type: 'cells'
            };
            
            return tableId;
        } catch (error) {
            console.error('Error creating cells table:', error);
            
            // Show error in element
            element.innerHTML = `
                <div class="alert alert-danger">
                    <h5>Error Creating Table</h5>
                    <p>${error.message}</p>
                </div>
            `;
            
            return null;
        }
    }
    
    /**
     * Create a genes table
     * @param {string} elementId - ID of the table element
     * @param {Object} config - Table configuration
     * @returns {string} - Table ID
     */
    async function createGenesTable(elementId, config = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element not found: ${elementId}`);
            return null;
        }
        
        // Generate a unique table ID
        const tableId = `table-${Date.now()}`;
        
        try {
            // Default config
            const defaultConfig = {
                columns: ['_index'],
                initialPageLength: _pageSize,
                enableSelection: true,
                selectionSet: 'selectedGenes',
                enableSearchBuilder: true,
                enableStringDB: true
            };
            
            // Merge configs
            const mergedConfig = {...defaultConfig, ...config};
            
            // First check if dataset is loaded
            const datasetInfo = DataManager.getDatasetInfo();
            if (!datasetInfo) {
                throw new Error('No dataset loaded');
            }
            
            // Initialize loading state
            element.innerHTML = `
                <div class="alert alert-info">
                    <div class="d-flex align-items-center">
                        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                        <div>Loading gene data...</div>
                    </div>
                </div>
            `;
            
            // Load gene names
            const geneNames = await DataManager.loadGeneNames();
            if (!geneNames || geneNames.length === 0) {
                throw new Error('No gene data available');
            }
            
            // Get the first 5 columns from var if not specified
            if (mergedConfig.columns.length === 0 || 
                (mergedConfig.columns.length === 1 && mergedConfig.columns[0] === '_index')) {
                
                if (datasetInfo.var_columns && datasetInfo.var_columns.length > 0) {
                    mergedConfig.columns = ['_index', ...datasetInfo.var_columns.slice(0, 4)];
                }
            }
            
            // Load var data for columns
            const varColumns = mergedConfig.columns.filter(col => col !== '_index');
            
            // Batch size for loading to avoid memory issues
            const batchSize = 1000;
            const batches = Math.ceil(geneNames.length / batchSize);
            
            let allVarData = {};
            
            // Initialize each column
            for (const col of varColumns) {
                allVarData[col] = new Array(geneNames.length);
            }
            
            // Load data in batches
            for (let batch = 0; batch < batches; batch++) {
                const start = batch * batchSize;
                const end = Math.min(start + batchSize, geneNames.length);
                const indices = Array.from({ length: end - start }, (_, i) => start + i);
                
                const varData = await DataManager.loadVar(indices, varColumns);
                
                // Merge batch data into full dataset
                for (const col of varColumns) {
                    for (let i = 0; i < indices.length; i++) {
                        allVarData[col][indices[i]] = varData[col][i];
                    }
                }
            }
            
            // Prepare table data
            const data = [];
            
            for (let i = 0; i < geneNames.length; i++) {
                const row = { '_index': geneNames[i] };
                
                for (const col of varColumns) {
                    row[col] = allVarData[col][i];
                }
                
                // Add StringDB link column if enabled
                if (mergedConfig.enableStringDB) {
                    row['_stringdb'] = `<a href="https://string-db.org/network/${geneNames[i]}" target="_blank" class="btn btn-sm btn-outline-secondary">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>`;
                }
                
                data.push(row);
            }
            
            // Prepare columns configuration
            const columns = mergedConfig.columns.map(col => {
                return {
                    data: col,
                    title: col === '_index' ? 'Gene ID' : col
                };
            });
            
            // Add StringDB column if enabled
            if (mergedConfig.enableStringDB) {
                columns.push({
                    data: '_stringdb',
                    title: 'StringDB',
                    orderable: false,
                    searchable: false
                });
            }
            
            // Clear element
            element.innerHTML = '';
            
            // Create table
            const table = $(`#${elementId}`).DataTable({
                data: data,
                columns: columns,
                pageLength: mergedConfig.initialPageLength,
                scrollX: true,
                scrollY: '400px',
                scrollCollapse: true,
                dom: mergedConfig.enableSearchBuilder ? 'QBfrtip' : 'Bfrtip',
                select: mergedConfig.enableSelection,
                buttons: [
                    'copy', 'csv', 'excel'
                ],
                language: {
                    searchBuilder: {
                        title: 'Filter Genes',
                        button: 'Filter',
                        clearAll: 'Reset'
                    }
                }
            });
            
            // Add click handler for focusing genes
            $(`#${elementId} tbody`).on('click', 'tr', function(e) {
                // Ignore clicks on StringDB link
                if (e.target.tagName === 'A' || e.target.tagName === 'I') return;
                
                const geneId = table.row(this).data()._index;
                DataManager.setFocusedGene(geneId);
            });
            
            // Add search builder change handler for selection sets
            if (mergedConfig.enableSearchBuilder && mergedConfig.selectionSet) {
                table.on('searchBuilder.search', () => {
                    updateGeneSelectionFromTable(tableId, mergedConfig.selectionSet);
                });
            }
            
            // Store table reference
            _tables[tableId] = {
                table: table,
                element: element,
                config: mergedConfig,
                type: 'genes'
            };
            
            return tableId;
        } catch (error) {
            console.error('Error creating genes table:', error);
            
            // Show error in element
            element.innerHTML = `
                <div class="alert alert-danger">
                    <h5>Error Creating Table</h5>
                    <p>${error.message}</p>
                </div>
            `;
            
            return null;
        }
    }
    
    /**
     * Update cell selection from table
     * @param {string} tableId - Table ID
     * @param {string} setName - Selection set name
     */
    function updateCellSelectionFromTable(tableId, setName) {
        const tableInfo = _tables[tableId];
        if (!tableInfo || tableInfo.type !== 'cells') return;
        
        const table = tableInfo.table;
        
        // Get all indices from filtered rows
        const rows = table.rows({ search: 'applied' }).data().toArray();
        const cellNames = rows.map(row => row._index);
        
        // Convert to indices
        DataManager.loadCellNames().then(allCellNames => {
            const indices = cellNames.map(name => allCellNames.indexOf(name)).filter(idx => idx !== -1);
            
            // Update selection set
            DataManager.setCellSet(setName, indices);
        }).catch(error => {
            console.error('Error updating cell selection:', error);
        });
    }
    
    /**
     * Update gene selection from table
     * @param {string} tableId - Table ID
     * @param {string} setName - Selection set name
     */
    function updateGeneSelectionFromTable(tableId, setName) {
        const tableInfo = _tables[tableId];
        if (!tableInfo || tableInfo.type !== 'genes') return;
        
        const table = tableInfo.table;
        
        // Get all indices from filtered rows
        const rows = table.rows({ search: 'applied' }).data().toArray();
        const geneNames = rows.map(row => row._index);
        
        // Convert to indices
        DataManager.loadGeneNames().then(allGeneNames => {
            const indices = geneNames.map(name => allGeneNames.indexOf(name)).filter(idx => idx !== -1);
            
            // Update selection set
            DataManager.setGeneSet(setName, indices);
        }).catch(error => {
            console.error('Error updating gene selection:', error);
        });
    }
    
    /**
     * Add a column to a table
     * @param {string} tableId - Table ID
     * @param {string} column - Column name
     * @param {string} type - Column data type ('obs' or 'var')
     */
    async function addColumn(tableId, column, type) {
        const tableInfo = _tables[tableId];
        if (!tableInfo) {
            console.error(`Table not found: ${tableId}`);
            return;
        }
        
        const table = tableInfo.table;
        
        try {
            // Check if column already exists
            const existingColumns = table.columns().header().toArray().map(el => el.textContent);
            if (existingColumns.includes(column)) {
                console.warn(`Column ${column} already exists in table`);
                return;
            }
            
            // Load data based on table type
            let data;
            if (tableInfo.type === 'cells' && type === 'obs') {
                data = await DataManager.loadObs(null, [column]);
            } else if (tableInfo.type === 'genes' && type === 'var') {
                data = await DataManager.loadVar(null, [column]);
            } else {
                throw new Error(`Incompatible column type ${type} for table type ${tableInfo.type}`);
            }
            
            // Add column to table
            table.column.add({
                title: column,
                data: function(row, type, set, meta) {
                    const name = row._index;
                    const idx = tableInfo.type === 'cells' ? 
                        DataManager.getCellNames().indexOf(name) : 
                        DataManager.getGeneNames().indexOf(name);
                    return data[column][idx];
                }
            }).draw();
            
            // Update config
            tableInfo.config.columns.push(column);
        } catch (error) {
            console.error(`Error adding column ${column} to table:`, error);
            throw error;
        }
    }
    
    /**
     * Apply a set to all plots
     * @param {string} tableId - Table ID
     */
    function applySetToAllPlots(tableId) {
        const tableInfo = _tables[tableId];
        if (!tableInfo) return;
        
        // Get set name
        const setName = tableInfo.config.selectionSet;
        if (!setName) return;
        
        // Trigger an event for plot manager
        const event = new CustomEvent('applySetToAllPlots', {
            detail: {
                type: tableInfo.type,
                setName: setName
            }
        });
        document.dispatchEvent(event);
    }
    
    /**
     * Generate StringDB URL for selected genes
     * @param {string} tableId - Table ID
     * @returns {string} - StringDB URL
     */
    function generateStringDBUrl(tableId) {
        const tableInfo = _tables[tableId];
        if (!tableInfo || tableInfo.type !== 'genes') return null;
        
        const table = tableInfo.table;
        
        // Get selected rows
        const selectedRows = table.rows({ selected: true }).data().toArray();
        
        // If none selected, use filtered rows
        const rows = selectedRows.length > 0 ? selectedRows : table.rows({ search: 'applied' }).data().toArray();
        
        // Get gene names
        const geneNames = rows.map(row => row._index);
        
        // Limit to 100 genes (StringDB limit)
        const limitedGenes = geneNames.slice(0, 100);
        
        if (limitedGenes.length === 0) return null;
        
        // Get taxonomy ID (9606 is human default)
        const taxonomy = DataManager.getTaxonomy();
        const taxId = taxonomy.taxonomyId || '9606';
        
        // Generate URL
        const baseUrl = 'https://string-db.org/cgi/network.pl';
        const queryParams = new URLSearchParams({
            identifier: limitedGenes.join('%0d'),
            species: taxId,
            network_flavor: 'evidence',
            required_score: 400
        });
        
        return `${baseUrl}?${queryParams.toString()}`;
    }
    
    /**
     * Handle dataset loaded event
     * @param {Event} event - Dataset loaded event
     */
    function handleDataLoaded(event) {
        // No automatic action, tables created on-demand
    }
    
    /**
     * Handle gene focus changed event
     * @param {Event} event - Gene focus changed event
     */
    function handleGeneFocusChanged(event) {
        // Highlight focused gene in tables
        for (const tableId in _tables) {
            const tableInfo = _tables[tableId];
            
            if (tableInfo.type !== 'genes') continue;
            
            const table = tableInfo.table;
            const focusedGene = event.detail.gene;
            
            // Remove previous highlighting
            $(table.table().container()).find('tr.focused-gene').removeClass('focused-gene');
            
            if (focusedGene) {
                // Find row for focused gene
                const rows = table.rows().data();
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i]._index === focusedGene) {
                        // Highlight row
                        $(table.row(i).node()).addClass('focused-gene');
                        
                        // Scroll to row if not visible
                        const $container = $(table.table().container());
                        const $row = $(table.row(i).node());
                        const containerTop = $container.offset().top;
                        const containerHeight = $container.height();
                        const rowTop = $row.offset().top;
                        
                        if (rowTop < containerTop || rowTop > containerTop + containerHeight) {
                            // Set page
                            const pageSize = table.page.len();
                            const pageNum = Math.floor(i / pageSize);
                            table.page(pageNum).draw(false);
                            
                            // Scroll to row
                            const rowIndex = i % pageSize;
                            const $tbody = $container.find('tbody');
                            const $rows = $tbody.find('tr');
                            if ($rows.length > rowIndex) {
                                $tbody.scrollTop($rows.eq(rowIndex).position().top);
                            }
                        }
                        
                        break;
                    }
                }
            }
        }
    }
    
    /**
     * Handle cell focus changed event
     * @param {Event} event - Cell focus changed event
     */
    function handleCellFocusChanged(event) {
        // Highlight focused cell in tables
        for (const tableId in _tables) {
            const tableInfo = _tables[tableId];
            
            if (tableInfo.type !== 'cells') continue;
            
            const table = tableInfo.table;
            const focusedCell = event.detail.cell;
            
            // Remove previous highlighting
            $(table.table().container()).find('tr.focused-cell').removeClass('focused-cell');
            
            if (focusedCell) {
                // Find row for focused cell
                const rows = table.rows().data();
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i]._index === focusedCell) {
                        // Highlight row
                        $(table.row(i).node()).addClass('focused-cell');
                        
                        // Scroll to row if not visible
                        const $container = $(table.table().container());
                        const $row = $(table.row(i).node());
                        const containerTop = $container.offset().top;
                        const containerHeight = $container.height();
                        const rowTop = $row.offset().top;
                        
                        if (rowTop < containerTop || rowTop > containerTop + containerHeight) {
                            // Set page
                            const pageSize = table.page.len();
                            const pageNum = Math.floor(i / pageSize);
                            table.page(pageNum).draw(false);
                            
                            // Scroll to row
                            const rowIndex = i % pageSize;
                            const $tbody = $container.find('tbody');
                            const $rows = $tbody.find('tr');
                            if ($rows.length > rowIndex) {
                                $tbody.scrollTop($rows.eq(rowIndex).position().top);
                            }
                        }
                        
                        break;
                    }
                }
            }
        }
    }
    
    /**
     * Handle gene set changed event
     * @param {Event} event - Gene set changed event
     */
    function handleGeneSetChanged(event) {
        // No automatic action for now
    }
    
    /**
     * Handle cell set changed event
     * @param {Event} event - Cell set changed event
     */
    function handleCellSetChanged(event) {
        // No automatic action for now
    }
    
    // Public API
    return {
        init,
        createCellsTable,
        createGenesTable,
        addColumn,
        applySetToAllPlots,
        generateStringDBUrl
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    TableManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableManager;
} else {
    window.TableManager = TableManager;
}