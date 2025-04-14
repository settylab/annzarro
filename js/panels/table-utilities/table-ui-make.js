/**
 * Utilities for creating table panel UI elements
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { 
    getObspColumnsForCellTable,
    getLayerColumnsForCellTable,
    getVarpColumnsForGeneTable,
    getLayerColumnsForGeneTable
} from './panel-tracker.js';

/**
 * Creates the basic table panel HTML structure.
 * 
 * @param {HTMLElement} container - The DOM element into which the panel will be rendered.
 * @param {string} id - A unique identifier for the panel instance.
 * @returns {{ tableContainer: HTMLElement, controlsContainer: HTMLElement, loadingScreen: HTMLElement }}
 */
export function createTablePanelStructure(container, id) {
    container.innerHTML = `
        <div class="table-panel">
            <div class="loading-screen" id="loading-screen-${id}" style="display: none;">
                <div class="loading-content">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <h4 class="mt-3">No dataset loaded</h4>
                    <p>Please select a dataset to begin visualization</p>
                </div>
            </div>
            <div class="table-controls">
                <div class="control-row">
                    <!-- Left column: Available Columns -->
                    <div class="column-selector">
                        <h6 class="control-section-title">Available Columns</h6>
                        <div class="data-type-tabs">
                            <ul class="nav nav-tabs" role="tablist">
                                <!-- Data type tabs will be added here based on entity type -->
                            </ul>
                            <div class="tab-content">
                                <!-- Tab content will be added here based on entity type -->
                            </div>
                        </div>
                    </div>
                    
                    <!-- Right column: Selected Columns and Actions -->
                    <div class="column-actions">
                        <div class="selected-columns">
                            <h6>Selected Columns</h6>
                            <ul id="selected-columns-list-${id}" class="list-group selected-columns-list">
                                <!-- Selected columns will be added here -->
                            </ul>
                            <div class="action-buttons">
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-sm btn-secondary" id="refresh-table-${id}">Refresh</button>
                                    <button class="btn btn-sm btn-outline-primary" id="export-csv-${id}">
                                        <i class="fas fa-file-csv"></i> Export CSV
                                    </button>
                                </div>
                                <button class="btn btn-sm btn-primary" id="apply-columns-${id}">Apply Columns</button>
                            </div>
                        </div>
                        
                        <!-- Hidden options that are always enabled -->
                        <input type="hidden" id="search-builder-enabled-${id}" checked>
                        <input type="hidden" id="fixed-header-${id}" checked>
                        <input type="hidden" id="responsive-table-${id}">
                        
                        <!-- Table length (rows per page) moved to control panel -->
                        <div class="table-length">
                            <label for="table-length-${id}">Show entries:</label>
                            <select id="table-length-${id}" class="form-select form-select-sm">
                                <option value="10">10</option>
                                <option value="25" selected>25</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="250">250</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            <div class="table-container" id="table-container-${id}"></div>
        </div>
    `;

    // Don't check dataset loading status here - we'll do it in the init method
    // to avoid any DOM-related errors during initialization

    // No resize observer needed

    return {
        tableContainer: document.getElementById(`table-container-${id}`),
        controlsContainer: container.querySelector('.table-controls'),
        loadingScreen: document.getElementById(`loading-screen-${id}`)
    };
}

/**
 * Checks if a dataset is loaded and updates UI accordingly
 * @param {string} id - The panel ID
 * @returns {boolean} - Whether a dataset is loaded
 */
export function checkDatasetLoadingStatus(id) {
    const isDatasetLoaded = DataManager.isDatasetLoaded();
    const loadingScreen = document.getElementById(`loading-screen-${id}`);
    
    if (loadingScreen) {
        loadingScreen.style.display = isDatasetLoaded ? 'none' : 'flex';
    }
    
    // Find controls container directly
    const tablePanel = document.getElementById(`table-container-${id}`)?.closest('.table-panel');
    const controlsContainer = tablePanel?.querySelector('.table-controls');
    
    if (controlsContainer) {
        controlsContainer.style.display = isDatasetLoaded ? 'flex' : 'none';
    }
    
    return isDatasetLoaded;
}

/**
 * Initializes the UI state for the table panel.
 *
 * @param {string} id - Unique ID for this panel instance
 * @param {Object} settings - Panel settings
 * @param {Object} datasetStructure - The dataset structure object
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 * @param {HTMLElement} controlsContainer - The container for the table controls
 * @returns {Promise<void>} Resolves when UI state is initialized
 */
export async function initializeTableUIState(id, settings, datasetStructure, entityType, controlsContainer) {
    console.log(`Initializing table UI state for ${entityType} table`);
    
    if (!datasetStructure) throw new Error('Failed to load dataset structure');
    
    const container = controlsContainer.closest('.table-panel');
    
    // Set up tabs and content for available columns based on entity type
    const tabsContainer = container.querySelector('.data-type-tabs .nav-tabs');
    const tabContent = container.querySelector('.data-type-tabs .tab-content');
    
    // Clear existing tabs and content
    tabsContainer.innerHTML = '';
    tabContent.innerHTML = '';
    
    // Add tabs based on entity type
    if (entityType === 'cells') {
        await setupCellTableTabs(tabsContainer, tabContent, datasetStructure, id, settings);
    } else {
        await setupGeneTableTabs(tabsContainer, tabContent, datasetStructure, id, settings);
    }
    
    // Set up event listeners for column selection
    setupColumnSelectionEvents(id, settings, entityType);
    
    // Restore selected columns from settings
    restoreSelectedColumns(id, settings);
}

/**
 * Set up tabs for cell table
 * @param {HTMLElement} tabsContainer - The tabs container
 * @param {HTMLElement} tabContent - The tab content container
 * @param {Object} datasetStructure - The dataset structure
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
async function setupCellTableTabs(tabsContainer, tabContent, datasetStructure, id, settings) {
    // Add tabs for obs, obsm, obsp, layer
    const dataSources = [
        { id: 'obs', name: 'obs', label: 'obs' }, //Cell Annotations
        { id: 'obsm', name: 'obsm', label: 'obsm' }, // Cell Matrices
        { id: 'obsp', name: 'obsp', label: 'obsp' }, // Cell-Cell Relations
        { id: 'layer', name: 'layer', label: 'layers' } // Expression Layers
    ];
    
    createDataTabs(tabsContainer, tabContent, dataSources, id);
    
    // Populate each tab with available columns
    for (const source of dataSources) {
        const contentContainer = document.getElementById(`${source.id}-content-${id}`);
        if (!contentContainer) continue;
        
        let items = [];
        
        if (source.id === 'obs' && datasetStructure.obs?.columns) {
            items = datasetStructure.obs.columns.map(column => ({
                type: 'obs',
                key: column,
                column: ''
            }));
        } else if (source.id === 'obsm' && datasetStructure.obsm?.dataframes) {
            for (const [key, df] of Object.entries(datasetStructure.obsm.dataframes)) {
                if (df.columns && df.columns.length > 0) {
                    df.columns.forEach((column, idx) => {
                        items.push({
                            type: 'obsm',
                            key: key,
                            column: column || idx.toString()
                        });
                    });
                }
            }
        } else if (source.id === 'obsp' && datasetStructure.obsp?.matrices) {
            // Get fixed cell items from panel tracker
            items = getObspColumnsForCellTable(datasetStructure);
        } else if (source.id === 'layer' && datasetStructure.layers) {
            // Get fixed gene items from panel tracker
            items = getLayerColumnsForCellTable(datasetStructure);
        }
        
        createCheckboxList(contentContainer, items, id, settings);
    }
    
    // Activate the first tab
    const firstTab = tabsContainer.querySelector('button');
    if (firstTab) firstTab.click();
}

/**
 * Set up tabs for gene table
 * @param {HTMLElement} tabsContainer - The tabs container
 * @param {HTMLElement} tabContent - The tab content container
 * @param {Object} datasetStructure - The dataset structure
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
async function setupGeneTableTabs(tabsContainer, tabContent, datasetStructure, id, settings) {
    // Add tabs for var, varm, varp, layer
    const dataSources = [
        { id: 'var', name: 'var', label: 'var' }, // Gene Annotations
        { id: 'varm', name: 'varm', label: 'varm' }, // Gene Matrices
        { id: 'varp', name: 'varp', label: 'varp' }, // Gene-Gene Relations
        { id: 'layer', name: 'layer', label: 'layers' } // Expression Layers
    ];
    
    createDataTabs(tabsContainer, tabContent, dataSources, id);
    
    // Populate each tab with available columns
    for (const source of dataSources) {
        const contentContainer = document.getElementById(`${source.id}-content-${id}`);
        if (!contentContainer) continue;
        
        let items = [];
        
        if (source.id === 'var' && datasetStructure.var?.columns) {
            items = datasetStructure.var.columns.map(column => ({
                type: 'var',
                key: column,
                column: ''
            }));
        } else if (source.id === 'varm' && datasetStructure.varm?.dataframes) {
            for (const [key, df] of Object.entries(datasetStructure.varm.dataframes)) {
                if (df.columns && df.columns.length > 0) {
                    df.columns.forEach((column, idx) => {
                        items.push({
                            type: 'varm',
                            key: key,
                            column: column || idx.toString()
                        });
                    });
                }
            }
        } else if (source.id === 'varp' && datasetStructure.varp?.matrices) {
            // Get fixed gene items from panel tracker
            items = getVarpColumnsForGeneTable(datasetStructure);
        } else if (source.id === 'layer' && datasetStructure.layers) {
            // Get fixed cell items from panel tracker
            items = getLayerColumnsForGeneTable(datasetStructure);
        }
        
        createCheckboxList(contentContainer, items, id, settings);
    }
    
    // Activate the first tab
    const firstTab = tabsContainer.querySelector('button');
    if (firstTab) firstTab.click();
}

/**
 * Create tabs for data sources
 * @param {HTMLElement} tabsContainer - The tabs container
 * @param {HTMLElement} tabContent - The tab content container
 * @param {Array} dataSources - The data sources
 * @param {string} id - The panel ID
 */
function createDataTabs(tabsContainer, tabContent, dataSources, id) {
    dataSources.forEach((source, index) => {
        // Create tab
        const tabItem = document.createElement('li');
        tabItem.className = 'nav-item';
        tabItem.role = 'presentation';
        
        const tabButton = document.createElement('button');
        tabButton.className = `nav-link ${index === 0 ? 'active' : ''}`;
        tabButton.id = `${source.id}-tab-${id}`;
        tabButton.setAttribute('data-bs-toggle', 'tab');
        tabButton.setAttribute('data-bs-target', `#${source.id}-content-${id}`);
        tabButton.type = 'button';
        tabButton.role = 'tab';
        tabButton.setAttribute('aria-controls', `${source.id}-content-${id}`);
        tabButton.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
        tabButton.textContent = source.label;
        
        tabItem.appendChild(tabButton);
        tabsContainer.appendChild(tabItem);
        
        // Create content
        const content = document.createElement('div');
        content.className = `tab-pane fade ${index === 0 ? 'show active' : ''}`;
        content.id = `${source.id}-content-${id}`;
        content.role = 'tabpanel';
        content.setAttribute('aria-labelledby', `${source.id}-tab-${id}`);
        
        // Add search input
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
        content.appendChild(searchContainer);
        
        // Add checkbox list container
        const checkboxList = document.createElement('div');
        checkboxList.className = 'checkbox-list';
        content.appendChild(checkboxList);
        
        tabContent.appendChild(content);
    });
}

/**
 * Create checkbox list for selecting columns
 * @param {HTMLElement} container - The container for the checkboxes
 * @param {Array} items - The items to display as checkboxes
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
function createCheckboxList(container, items, id, settings) {
    const checkboxList = container.querySelector('.checkbox-list');
    checkboxList.innerHTML = '';
    
    if (items.length === 0) {
        checkboxList.innerHTML = '<div class="alert alert-secondary">No columns available</div>';
        return;
    }
    
    // Sort items alphabetically by display name
    items.sort((a, b) => {
        const aName = getColumnDisplayName(a);
        const bName = getColumnDisplayName(b);
        return aName.localeCompare(bName);
    });
    
    // Create checkbox for each item
    items.forEach(item => {
        // Use label if provided, otherwise generate a display name
        const displayName = item.label || getColumnDisplayName(item);
        
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'form-check py-0';
        
        const checkbox = document.createElement('input');
        checkbox.className = 'form-check-input column-checkbox';
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox-${item.type}-${item.key}-${item.column}-${id}`.replace(/\s+/g, '_');
        checkbox.setAttribute('data-type', item.type);
        checkbox.setAttribute('data-key', item.key);
        checkbox.setAttribute('data-column', item.column);
        
        // Set additional attributes for source tracking
        if (item.source) {
            checkbox.setAttribute('data-source', item.source);
        }
        
        if (item.panelId) {
            checkbox.setAttribute('data-panel-id', item.panelId);
        }
        
        // Check if this column is in settings
        if (settings.columns) {
            const isSelected = settings.columns.some(col => 
                col.type === item.type && 
                col.key === item.key && 
                (col.column === item.column || 
                 (item.column === 'focused_cell' && col.column === '_focused_cell') ||
                 (item.column === 'focused_gene' && col.column === '_focused_gene'))
            );
            checkbox.checked = isSelected;
        }
        
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = checkbox.id;
        label.textContent = displayName;
        
        // Add tooltip for fixed entities
        if (item.source) {
            label.title = `${displayName} (${item.source})`;
            if (item.source !== 'focused') {
                label.style.fontStyle = 'italic';
            }
        }
        
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        checkboxList.appendChild(checkboxDiv);
    });
    
    // Add search functionality
    const searchInput = container.querySelector('.column-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchText = e.target.value.toLowerCase();
            const checkboxes = checkboxList.querySelectorAll('.form-check');
            
            checkboxes.forEach(cb => {
                const label = cb.querySelector('label').textContent.toLowerCase();
                cb.style.display = label.includes(searchText) ? '' : 'none';
            });
        });
    }
}

/**
 * Get display name for a column
 * @param {Object} column - The column object
 * @returns {string} - The display name
 */
function getColumnDisplayName(column) {
    if (column.type === 'obs' || column.type === 'var') {
        return `${column.key}`;
    } else if (column.type === 'obsm' || column.type === 'varm') {
        return `${column.key}:${column.column}`;
    } else if (column.type === 'obsp') {
        if (column.column === 'focused_cell' || column.column === '_focused_cell') {
            return `${column.key}: Focused Cell`;
        } else if (column.column) {
            return `${column.key}: ${column.column}`;
        } else {
            return `${column.key}`;
        }
    } else if (column.type === 'varp') {
        if (column.column === 'focused_gene' || column.column === '_focused_gene') {
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
 * Setup event listeners for column selection
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 */
function setupColumnSelectionEvents(id, settings, entityType) {
    // Find container more safely
    const tablePanel = document.getElementById(`table-container-${id}`)?.closest('.table-panel');
    if (!tablePanel) return;
    
    const checkboxes = tablePanel.querySelectorAll('.column-checkbox');
    const selectedColumnsList = document.getElementById(`selected-columns-list-${id}`);
    
    // Handle checkbox changes
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSelectedColumnsList(id, settings);
        });
    });
    
    // Handle apply button
    const applyButton = document.getElementById(`apply-columns-${id}`);
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            const event = new CustomEvent('columnsUpdated', {
                detail: { id, columns: settings.columns }
            });
            document.dispatchEvent(event);
        });
    }
    
    // Handle search builder toggle
    const searchBuilderCheckbox = document.getElementById(`search-builder-enabled-${id}`);
    if (searchBuilderCheckbox) {
        searchBuilderCheckbox.checked = settings.searchBuilderEnabled !== false;
        searchBuilderCheckbox.addEventListener('change', (e) => {
            settings.searchBuilderEnabled = e.target.checked;
            const event = new CustomEvent('searchBuilderToggled', {
                detail: { id, enabled: e.target.checked }
            });
            document.dispatchEvent(event);
        });
    }
    
    // Handle responsive table toggle
    const responsiveCheckbox = document.getElementById(`responsive-table-${id}`);
    if (responsiveCheckbox) {
        responsiveCheckbox.checked = settings.responsive !== false;
        responsiveCheckbox.addEventListener('change', (e) => {
            settings.responsive = e.target.checked;
            const event = new CustomEvent('tableOptionChanged', {
                detail: { id, option: 'responsive', value: e.target.checked }
            });
            document.dispatchEvent(event);
        });
    }
    
    // Handle fixed header toggle
    const fixedHeaderCheckbox = document.getElementById(`fixed-header-${id}`);
    if (fixedHeaderCheckbox) {
        fixedHeaderCheckbox.checked = settings.fixedHeader === true;
        fixedHeaderCheckbox.addEventListener('change', (e) => {
            settings.fixedHeader = e.target.checked;
            const event = new CustomEvent('tableOptionChanged', {
                detail: { id, option: 'fixedHeader', value: e.target.checked }
            });
            document.dispatchEvent(event);
        });
    }
    
    // Handle export CSV button
    const exportButton = document.getElementById(`export-csv-${id}`);
    if (exportButton) {
        exportButton.addEventListener('click', () => {
            const event = new CustomEvent('exportTableToCsv', {
                detail: { id }
            });
            document.dispatchEvent(event);
        });
    }
    
    // Handle table length selector
    const lengthSelector = document.getElementById(`table-length-${id}`);
    if (lengthSelector) {
        lengthSelector.addEventListener('change', (e) => {
            settings.pageLength = parseInt(e.target.value);
            const event = new CustomEvent('tableOptionChanged', {
                detail: { id, option: 'pageLength', value: parseInt(e.target.value) }
            });
            document.dispatchEvent(event);
        });
        
        // Set initial value from settings
        if (settings.pageLength) {
            lengthSelector.value = settings.pageLength.toString();
        }
    }
    
    // Handle refresh button
    const refreshButton = document.getElementById(`refresh-table-${id}`);
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            const event = new CustomEvent('refreshTable', {
                detail: { id }
            });
            document.dispatchEvent(event);
        });
    }
}

/**
 * Update the selected columns list
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
function updateSelectedColumnsList(id, settings) {
    // Find container safely
    const tablePanel = document.getElementById(`table-container-${id}`)?.closest('.table-panel');
    if (!tablePanel) return;
    
    const checkboxes = tablePanel.querySelectorAll('.column-checkbox:checked');
    const selectedColumnsList = document.getElementById(`selected-columns-list-${id}`);
    if (!selectedColumnsList) return;
    
    // Clear current list
    selectedColumnsList.innerHTML = '';
    
    // Initialize columns array if not exists
    if (!settings.columns) {
        settings.columns = [];
    } else {
        settings.columns = [];
    }
    
    // Add each selected column
    checkboxes.forEach(checkbox => {
        const type = checkbox.getAttribute('data-type');
        const key = checkbox.getAttribute('data-key');
        const column = checkbox.getAttribute('data-column');
        
        // Add to settings
        settings.columns.push({
            type,
            key,
            column
        });
        
        // Create list item
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        
        const displayName = getColumnDisplayName({ type, key, column });
        
        // Create text span with ellipsis for long names
        const textSpan = document.createElement('span');
        textSpan.textContent = displayName;
        textSpan.title = displayName; // Full name in tooltip
        textSpan.className = 'text-truncate';
        listItem.appendChild(textSpan);
        
        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-outline-danger btn-xs';
        removeButton.innerHTML = '<i class="fas fa-times"></i>';
        removeButton.title = 'Remove from selection';
        removeButton.addEventListener('click', () => {
            // Uncheck the corresponding checkbox
            const checkboxId = `checkbox-${type}-${key}-${column}-${id}`.replace(/\s+/g, '_');
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = false;
            }
            
            // Update the list
            updateSelectedColumnsList(id, settings);
        });
        
        listItem.appendChild(removeButton);
        selectedColumnsList.appendChild(listItem);
    });
    
    // Show "no columns selected" message if no columns are selected
    if (settings.columns.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'list-group-item text-muted';
        emptyItem.textContent = 'No columns selected';
        selectedColumnsList.appendChild(emptyItem);
    }
}

/**
 * Restore selected columns from settings
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
function restoreSelectedColumns(id, settings) {
    if (!settings.columns || !Array.isArray(settings.columns)) {
        return;
    }
    
    // Check all checkboxes that match a column in settings
    settings.columns.forEach(col => {
        const checkboxId = `checkbox-${col.type}-${col.key}-${col.column}-${id}`.replace(/\s+/g, '_');
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    
    // Update the selected columns list
    updateSelectedColumnsList(id, settings);
}