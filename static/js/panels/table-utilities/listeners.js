/**
 * Table Event Listeners
 * This file contains functions to set up event listeners for table panels
 */
import { DataManager } from '../../data-manager.js';
import { exportTableToCsv, updateTableOnFocusChange } from './table-data.js';

/**
 * Set up event listeners for table panels
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.settings - Panel settings
 * @param {HTMLElement} options.tableContainer - Table container element
 * @param {Object} options.dataTable - DataTable instance
 * @param {string} options.entityType - Entity type ('cells' or 'genes')
 * @param {string} options.title - Panel title
 * @param {Function} options.refreshTable - Function to refresh the table
 * @returns {Function} - Removes every listener this call registered
 */
export function setupTableEventListeners({
    id,
    settings,
    tableContainer,
    dataTable,
    entityType,
    title,
    refreshTable
}) {
    // Every document-level listener below is registered with this signal, so
    // the cleanup removes all of them. The panels call this on EVERY refresh;
    // without the removal each refresh stacked another full set, and one
    // 'refreshTable' event then ran N refreshes against N stale DataTables.
    const controller = new AbortController();
    const signal = controller.signal;

    // Common event listeners for both table types
    setupCommonEventListeners({
        id,
        settings,
        dataTable,
        title,
        refreshTable,
        signal
    });

    // Entity-specific event listeners
    if (entityType === 'cells') {
        setupCellTableEventListeners({
            id,
            dataTable,
            signal
        });
    } else if (entityType === 'genes') {
        setupGeneTableEventListeners({
            id,
            dataTable,
            signal
        });
    }
    
    // Return a cleanup function that can be called when refreshing the table
    return function cleanupListeners() {
        controller.abort();
        // Remove SearchBuilder event listener if dataTable exists
        if (dataTable && dataTable.table) {
            $(dataTable.table().node()).off('searchBuilder.dtsb');
        }
    };
}

/**
 * Set up common event listeners for all table types
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.settings - Panel settings
 * @param {Object} options.dataTable - DataTable instance
 * @param {string} options.title - Panel title
 * @param {Function} options.refreshTable - Function to refresh the table
 * @param {AbortSignal} options.signal - Removes the listeners when aborted
 * @returns {void}
 */
function setupCommonEventListeners({
    id,
    settings,
    dataTable,
    title,
    refreshTable,
    signal
}) {
    // Listen for column updates
    document.addEventListener('columnsUpdated', async (e) => {
        if (e.detail.id === id) {
            try {
                await refreshTable();
            } catch (error) {
                // Handle AbortError gracefully, don't log it as an error
                if (error && error.name !== 'AbortError') {
                    console.error('Error refreshing table after columns update:', error);
                }
            }
        }
    }, { signal });
    
    // Listen for table option changes
    document.addEventListener('tableOptionChanged', (e) => {
        if (e.detail.id === id) {
            // Update settings
            settings[e.detail.option] = e.detail.value;
            
            // Refresh table if already initialized
            if (dataTable) {
                refreshTable();
            }
        }
    }, { signal });
    
    // Listen for search builder toggle
    document.addEventListener('searchBuilderToggled', (e) => {
        if (e.detail.id === id) {
            settings.searchBuilderEnabled = e.detail.enabled;
            
            // Toggle search builder visibility
            if (dataTable) {
                $('.dtsp-searchBuilder').toggle(e.detail.enabled);
            }
        }
    }, { signal });
    
    // Listen for export CSV request
    document.addEventListener('exportTableToCsv', (e) => {
        if (e.detail.id === id && dataTable) {
            exportTableToCsv(dataTable, title);
        }
    }, { signal });
    
    // Listen for refresh table request
    document.addEventListener('refreshTable', (e) => {
        if (e.detail.id === id) {
            refreshTable();
        }
    }, { signal });
}

/**
 * Set up cell table specific event listeners
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.dataTable - DataTable instance
 * @param {AbortSignal} options.signal - Removes the listeners when aborted
 * @returns {void}
 */
function setupCellTableEventListeners({
    id,
    dataTable,
    signal
}) {
    // Listen for focused gene changes
    document.addEventListener('focusedGeneChanged', async (e) => {
        // Handle both immediate updates and deferred updates
        setTimeout(() => {
            if (dataTable && !signal.aborted) {
                console.log(`Cell table ${id} handling focused gene change: ${e.detail.gene}`);
                updateTableOnFocusChange(dataTable, e.detail.gene, 'genes');
            }
        }, 0);
    }, { signal });
}

/**
 * Set up gene table specific event listeners
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.dataTable - DataTable instance
 * @param {AbortSignal} options.signal - Removes the listeners when aborted
 * @returns {void}
 */
function setupGeneTableEventListeners({
    id,
    dataTable,
    signal
}) {
    // Listen for focused cell changes
    document.addEventListener('focusedCellChanged', async (e) => {
        // Handle both immediate updates and deferred updates
        setTimeout(() => {
            if (dataTable && !signal.aborted) {
                console.log(`Gene table ${id} handling focused cell change: ${e.detail.cell}`);
                updateTableOnFocusChange(dataTable, e.detail.cell, 'cells');
            }
        }, 0);
    }, { signal });
}