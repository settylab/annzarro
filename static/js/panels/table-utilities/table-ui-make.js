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
import { syncControlsWithDataset } from '../../utils/controls-visibility.js';
import { getColumnDisplayName } from './table-data.js';

/**
 * Creates the basic table panel HTML structure.
 * 
 * @param {HTMLElement} container - The DOM element into which the panel will be rendered.
 * @param {string} id - A unique identifier for the panel instance.
 * @param {Object} settings - Optional settings object with controlsVisible property
 * @returns {{ tableContainer: HTMLElement, controlsContainer: HTMLElement, loadingScreen: HTMLElement }}
 */
export function createTablePanelStructure(container, id, settings = {}) {
    // Determine if controls should be visible (default to true if not specified)
    const controlsVisible = settings.controlsVisible !== false;
    const controlsDisplay = controlsVisible ? 'flex' : 'none';
    
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
            <div class="table-controls" style="display: ${controlsDisplay};">
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
                                <button class="btn btn-sm btn-outline-primary" id="export-csv-${id}">
                                    <i class="fas fa-file-csv"></i> Export CSV
                                </button>
                                <button class="btn btn-sm btn-primary" id="apply-columns-${id}">
                                    <i class="fas fa-sync-alt"></i> Apply Changes
                                </button>
                            </div>
                        </div>
                        
                        <!-- Hidden options that are always enabled -->
                        <input type="hidden" id="search-builder-enabled-${id}" checked>
                        <input type="hidden" id="fixed-header-${id}" checked>
                        <input type="hidden" id="responsive-table-${id}">
                        
                        <!-- Table length (rows per page) moved to control panel -->
                        <div class="table-length">
                            <label for="table-length-${id}">Show entries:</label>
                            <select id="table-length-${id}" class="form-select form-select-sm text-center">
                                <option value="10">&nbsp;10&nbsp;</option>
                                <option value="25" selected>&nbsp;25&nbsp;</option>
                                <option value="50">&nbsp;50&nbsp;</option>
                                <option value="100">&nbsp;100&nbsp;</option>
                                <option value="250">&nbsp;250&nbsp;</option>
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
    
    syncControlsWithDataset(controlsContainer, isDatasetLoaded);
    
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

export function populateColumnsCellTable(dataSources, datasetStructure, id, settings) {
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
            let dataframeObj = datasetStructure.obsm?.dataframes;
            createAccordion(source, contentContainer, id, dataframeObj);
            for (const [key, df] of Object.entries(datasetStructure.obsm.dataframes)) {
                const accordionContainer = document.getElementById(`${source.id}-${key}-accordion-content-${id}`);
                if (!accordionContainer) continue;

                let obsm_items = []

                if (df.columns && df.columns.length > 0) {
                    df.columns.forEach((column, idx) => {
                        obsm_items.push({
                            type: 'obsm',
                            key: key,
                            column: column || idx.toString()
                        });
                    });
                }
                createCheckboxList(accordionContainer, obsm_items, id, settings);
            }
            continue;
        } else if (source.id === 'obsp' && datasetStructure.obsp?.keys) {
            // Get fixed cell items from panel tracker
            items = getObspColumnsForCellTable(datasetStructure, settings.columns);
        } else if (source.id === 'layer' && datasetStructure.layers) {
            // Get fixed gene items from panel tracker
            items = getLayerColumnsForCellTable(datasetStructure, settings.columns);
        }
        
        createCheckboxList(contentContainer, items, id, settings);
    }
}

export function populateColumnsGeneTable(dataSources, datasetStructure, id, settings) {
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
            let dataframeObj = datasetStructure.varm?.dataframes;
            createAccordion(source, contentContainer, id, dataframeObj);

            for (const [key, df] of Object.entries(datasetStructure.varm.dataframes)) {
                const accordionContainer = document.getElementById(`${source.id}-${key}-accordion-content-${id}`);
                if (!accordionContainer) continue;

                let varm_items = []

                if (df.columns && df.columns.length > 0) {
                    df.columns.forEach((column, idx) => {
                        varm_items.push({
                            type: 'varm',
                            key: key,
                            column: column || idx.toString()
                        });
                    });
                }
                createCheckboxList(accordionContainer, varm_items, id, settings);
            }
            continue;
        } else if (source.id === 'varp' && datasetStructure.varp?.keys) {
            // Get fixed gene items from panel tracker
            items = getVarpColumnsForGeneTable(datasetStructure, settings.columns);
        } else if (source.id === 'layer' && datasetStructure.layers) {
            // Get fixed cell items from panel tracker
            items = getLayerColumnsForGeneTable(datasetStructure, settings.columns);
        }
        
        createCheckboxList(contentContainer, items, id, settings);
    }
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
    
    createDataTabs(tabsContainer, tabContent, dataSources, id, datasetStructure);
    
    // Populate each tab with available columns
    populateColumnsCellTable(dataSources, datasetStructure, id, settings);
    
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
    populateColumnsGeneTable(dataSources, datasetStructure, id, settings);
    
    // Activate the first tab
    const firstTab = tabsContainer.querySelector('button');
    if (firstTab) firstTab.click();
}

function createAccordionHeader(sourceId, panelId, label, index) {
    const accordionHeader = document.createElement('h6');
    accordionHeader.className = 'accordion-header';
    accordionHeader.id = `${sourceId}-accordion-${panelId}`;
    
    const accordionButton = document.createElement('button');
    accordionButton.className = `accordion-button`;
    if (index !== 0) {
        accordionButton.classList.add('collapsed');
    }
    accordionButton.setAttribute('data-bs-toggle', 'collapse');
    accordionButton.setAttribute('data-bs-target', `#${sourceId}-accordion-content-${panelId}`);
    accordionButton.type = 'button';
    accordionButton.setAttribute('aria-controls', `${sourceId}-accordion-content-${panelId}`);
    accordionButton.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
    accordionButton.style.padding = '0.25rem 0.5rem';
    accordionButton.style.fontSize = '0.875rem';
    accordionButton.textContent = label;

    accordionHeader.appendChild(accordionButton);
    return accordionHeader;
}

function createAccordionContent(source, sourceId, panelId, index) {
    const contentContainer = document.createElement('div');
    contentContainer.className = `accordion-collapse collapse ${index === 0 ? 'show' : ''}`;
    contentContainer.id = `${sourceId}-accordion-content-${panelId}`;
    contentContainer.setAttribute('aria-labelledby', `${sourceId}-accordion-${panelId}`);
    contentContainer.setAttribute('data-bs-parent', `#${source.id}-accordion-${panelId}`);

    const content = document.createElement('div');
    content.className = 'accordion-body';
    content.style.padding = '0.25rem 0.5rem';
    content.style.fontSize = '0.875rem';


     // Add checkbox list container
    const checkboxList = document.createElement('div');
    checkboxList.className = 'checkbox-list';
    content.appendChild(checkboxList);

    contentContainer.appendChild(content);
    return contentContainer;
}


function createAccordion(source, content, panelId, dataframeObj) {
    const accordionContainer = document.createElement('div');
    accordionContainer.className = "accordion";
    accordionContainer.id = `${source.id}-accordion-${panelId}`

    Object.keys(dataframeObj).forEach((key, index) => {
        const accordionItem = document.createElement('div');
        accordionItem.className = "accordion-item";

        const sourceId = source.id + "-" + key;
        const accordionHeader = createAccordionHeader(sourceId, panelId, key, index);
        accordionItem.appendChild(accordionHeader)

        const accordionContent = createAccordionContent(source, sourceId, panelId, index);
        accordionItem.appendChild(accordionContent);

        accordionContainer.appendChild(accordionItem);
    })

    content.appendChild(accordionContainer);
}


function createContentWithSubtabs(source, content, panelId, dataframeObj) {
    if (Object.keys(dataframeObj).length == 0) {
        return;
    }
    const subTabsContainer = document.createElement('ul');
    subTabsContainer.className = 'nav nav-tabs mt-2';
    
    const subTabContent = document.createElement('div');
    subTabContent.className = 'tab-content';
    
    Object.keys(dataframeObj).forEach((tabKey, index) => {
        const sourceId = source.id + "-" + tabKey;
        const subTabItem = createTab(sourceId, panelId, tabKey, index);
        subTabsContainer.appendChild(subTabItem);

        const subContent = createContent(sourceId, panelId, index);
        
        const checkboxList = document.createElement('div');
        checkboxList.className = 'checkbox-list';
        subContent.appendChild(checkboxList);
        
        subTabContent.appendChild(subContent);
    });
    
    content.appendChild(subTabsContainer);
    content.appendChild(subTabContent);
}

function createContent(sourceId, panelId, index) {
    const content = document.createElement('div');
    content.className = `tab-pane fade ${index === 0 ? 'show active' : ''}`;
    content.id = `${sourceId}-content-${panelId}`;
    content.role = 'tabpanel';
    content.setAttribute('aria-labelledby', `${sourceId}-tab-${panelId}`);
    return content;
}

function createTab(sourceId, panelId, label, index) {
    const tabItem = document.createElement('li');
    tabItem.className = 'nav-item';
    tabItem.role = 'presentation';
    
    const tabButton = document.createElement('button');
    tabButton.className = `nav-link ${index === 0 ? 'active' : ''}`;
    tabButton.id = `${sourceId}-tab-${panelId}`;
    tabButton.setAttribute('data-bs-toggle', 'tab');
    tabButton.setAttribute('data-bs-target', `#${sourceId}-content-${panelId}`);
    tabButton.type = 'button';
    tabButton.role = 'tab';
    tabButton.setAttribute('aria-controls', `#${sourceId}-content-${panelId}`);
    tabButton.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    tabButton.textContent = label;

    tabItem.appendChild(tabButton);
    return tabItem;
}

/**
 * Create tabs for data sources
 * @param {HTMLElement} tabsContainer - The tabs container
 * @param {HTMLElement} tabContent - The tab content container
 * @param {Array} dataSources - The data sources
 * @param {string} panelId - The panel ID
 */
function createDataTabs(tabsContainer, tabContent, dataSources, panelId) {
    dataSources.forEach((source, index) => {
        // Create tab
        const tabItem = createTab(source.id, panelId, source.label, index);
        tabsContainer.appendChild(tabItem);

        //Create Content
        const content = createContent(source.id, panelId, index);
        
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
    
    // Add search functionality. The search box sits on the TAB pane; the
    // obsm/varm lists are inside an accordion in that pane, so look upward
    // (querySelector from the accordion found nothing and the box was inert).
    const searchInput = container.querySelector('.column-search')
        || container.closest?.('.tab-pane')?.querySelector('.column-search');
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

/** Per-panel AbortController for the listeners setupColumnSelectionEvents adds. */
const _columnSelectionControllers = new Map();

/**
 * Setup event listeners for column selection
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 * @param {string} entityType - Type of entities ('cells' or 'genes')
 */
export function setupColumnSelectionEvents(id, settings, entityType) {
    // Find container more safely
    const tablePanel = document.getElementById(`table-container-${id}`)?.closest('.table-panel');
    if (!tablePanel) return;

    // This runs again on every focus change (updateTableOnFocusChange), but the
    // option controls below are NOT rebuilt in between. Without dropping the
    // previous registration, N focus changes meant N listeners on each control:
    // one Export click dispatched N export requests. Abort the previous set.
    _columnSelectionControllers.get(id)?.abort();
    const controller = new AbortController();
    _columnSelectionControllers.set(id, controller);
    const signal = controller.signal;
    
    const checkboxes = tablePanel.querySelectorAll('.column-checkbox');
    const selectedColumnsList = document.getElementById(`selected-columns-list-${id}`);
    
    // Handle checkbox changes
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSelectedColumnsList(id, settings);
        }, { signal });
    });
    
    // Handle apply button
    const applyButton = document.getElementById(`apply-columns-${id}`);
    if (applyButton) {
        // Clear all existing click listeners by cloning the button
        const newApplyButton = applyButton.cloneNode(true);
        applyButton.parentNode.replaceChild(newApplyButton, applyButton);
        
        // Add the event listener to the new button
        newApplyButton.addEventListener('click', () => {
            console.log(`Apply columns clicked for ${id}`);
            
            // The columnsUpdated event already triggers a refresh
            const columnsEvent = new CustomEvent('columnsUpdated', {
                detail: { id, columns: settings.columns }
            });
            document.dispatchEvent(columnsEvent);
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
        }, { signal });
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
        }, { signal });
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
        }, { signal });
    }
    
    // Handle export CSV button
    const exportButton = document.getElementById(`export-csv-${id}`);
    if (exportButton) {
        exportButton.addEventListener('click', () => {
            const event = new CustomEvent('exportTableToCsv', {
                detail: { id }
            });
            document.dispatchEvent(event);
        }, { signal });
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
        }, { signal });
        
        // Set initial value from settings
        if (settings.pageLength) {
            lengthSelector.value = settings.pageLength.toString();
        }
    }
    
    // No refresh button anymore - it's combined with apply-columns
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