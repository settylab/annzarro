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
 * @returns {void}
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
    // Common event listeners for both table types
    setupCommonEventListeners({
        id,
        settings,
        dataTable,
        title,
        refreshTable
    });

    // Entity-specific event listeners
    if (entityType === 'cells') {
        setupCellTableEventListeners({
            id,
            dataTable
        });
    } else if (entityType === 'genes') {
        setupGeneTableEventListeners({
            id,
            dataTable
        });
    }
}

/**
 * Set up common event listeners for all table types
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.settings - Panel settings
 * @param {Object} options.dataTable - DataTable instance
 * @param {string} options.title - Panel title
 * @param {Function} options.refreshTable - Function to refresh the table
 * @returns {void}
 */
function setupCommonEventListeners({
    id,
    settings,
    dataTable,
    title,
    refreshTable
}) {
    // Listen for column updates
    document.addEventListener('columnsUpdated', async (e) => {
        if (e.detail.id === id) {
            await refreshTable();
        }
    });
    
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
    });
    
    // Listen for search builder toggle
    document.addEventListener('searchBuilderToggled', (e) => {
        if (e.detail.id === id) {
            settings.searchBuilderEnabled = e.detail.enabled;
            
            // Toggle search builder visibility
            if (dataTable) {
                $('.dtsp-searchBuilder').toggle(e.detail.enabled);
            }
        }
    });
    
    // Listen for export CSV request
    document.addEventListener('exportTableToCsv', (e) => {
        if (e.detail.id === id && dataTable) {
            exportTableToCsv(dataTable, title);
        }
    });
    
    // Listen for refresh table request
    document.addEventListener('refreshTable', (e) => {
        if (e.detail.id === id) {
            refreshTable();
        }
    });
}

/**
 * Set up cell table specific event listeners
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.dataTable - DataTable instance
 * @returns {void}
 */
function setupCellTableEventListeners({
    id,
    dataTable
}) {
    // Listen for focused gene changes
    document.addEventListener('focusedGeneChanged', async (e) => {
        // Handle both immediate updates and deferred updates
        setTimeout(() => {
            if (dataTable) {
                console.log(`Cell table ${id} handling focused gene change: ${e.detail.gene}`);
                updateTableOnFocusChange(dataTable, e.detail.gene, 'genes');
            }
        }, 0);
    });
}

/**
 * Set up gene table specific event listeners
 * @param {Object} options - Options for setting up listeners
 * @param {string} options.id - Panel ID
 * @param {Object} options.dataTable - DataTable instance
 * @returns {void}
 */
function setupGeneTableEventListeners({
    id,
    dataTable
}) {
    // Listen for focused cell changes
    document.addEventListener('focusedCellChanged', async (e) => {
        // Handle both immediate updates and deferred updates
        setTimeout(() => {
            if (dataTable) {
                console.log(`Gene table ${id} handling focused cell change: ${e.detail.cell}`);
                updateTableOnFocusChange(dataTable, e.detail.cell, 'cells');
            }
        }, 0);
    });
}