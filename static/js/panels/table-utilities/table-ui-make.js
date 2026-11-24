/**
 * Utilities for creating table panel UI elements
 */
import { DataManager } from '../../data-manager.js';
import { Config } from '../../config.js';
import { tabChoices } from './panel-tracker.js';
import { syncControlsWithDataset } from '../../utils/controls-visibility.js';
import { getColumnDisplayName } from './table-data.js';
import { isDerived } from '../../utils/line-select.js';
import { isScoreColumn, subOf } from '../../utils/score-column.js';
import { tableHalfOf, tableProviders } from '../../utils/table-source.js';
import { bindPairSelects } from '../../utils/pair-selects.js';
import { createAggregationButton } from '../../ui/aggregation-button.js';
import { symbolSpan } from '../../utils/aggregation-symbols.js';
import { middleEllipsis } from '../../utils/plot-titles.js';
import { noDatasetScreenHtml } from '../../utils/no-dataset-screen.js';

/**
 * Creates the basic table panel HTML structure.
 * 
 * @param {HTMLElement} container - The DOM element into which the panel will be rendered.
 * @param {string} id - A unique identifier for the panel instance.
 * @param {Object} settings - Optional settings object with controlsVisible property
 * @returns {{ tableContainer: HTMLElement, controlsContainer: HTMLElement, loadingScreen: HTMLElement }}
 */
/**
 * A selected column's name for the narrow list: at most 34 characters,
 * shortened in the middle so the distinguishing end stays visible.
 * @param {string} name
 * @returns {string}
 */
export function shortColumnName(name, maxChars = 34) {
    return middleEllipsis(String(name), s => Array.from(s).length <= maxChars);
}

export function createTablePanelStructure(container, id, settings = {}) {
    // Determine if controls should be visible (default to true if not specified)
    const controlsVisible = settings.controlsVisible !== false;
    const controlsDisplay = controlsVisible ? 'flex' : 'none';
    
    container.innerHTML = `
        <div class="table-panel">
            ${noDatasetScreenHtml(id)}
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
        
        const provider = tableProviders().find(p => p.type === source.id);
        if (provider) {
            buildSourceTab(provider, id, settings, datasetStructure);
            continue;
        } else if (source.id === 'obs' && datasetStructure.obs?.columns) {
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
        } else if (source.id === 'obsp' || source.id === 'layer') {
            // the ticked columns and one add row, [cell or gene] [matrix or layer] (table-chooser-080.md 4)
            buildEntityTab(source, tabChoices('cells', source.id, datasetStructure, settings.columns), id, settings);
            continue;
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
        } else if (source.id === 'varp' || source.id === 'layer') {
            buildEntityTab(source, tabChoices('genes', source.id, datasetStructure, settings.columns), id, settings);
            continue;
        }
        
        createCheckboxList(contentContainer, items, id, settings);
    }
}

/**
 * The tabs of a Cell Table's column chooser: the built-in sources, then one for every provider that gives a cell table
 * columns (utils/table-source.js), in registration order.
 * @returns {Array<{id: string, name: string, label: string}>}
 */
export function cellTableSources() {
    return [
        { id: 'obs', name: 'obs', label: 'obs' }, //Cell Annotations
        { id: 'obsm', name: 'obsm', label: 'obsm' }, // Cell Matrices
        { id: 'obsp', name: 'obsp', label: 'obsp' }, // Cell-Cell Relations
        { id: 'layer', name: 'layer', label: 'layers' }, // Expression Layers
        ...tableProviders().map(p => ({ id: p.type, name: p.type, label: p.table.tab }))
    ];
}

/** The tabs of a Gene Table's column chooser: a gene table has no cells to take a source's series from. */
export function geneTableSources() {
    return [
        { id: 'var', name: 'var', label: 'var' }, // Gene Annotations
        { id: 'varm', name: 'varm', label: 'varm' }, // Gene Matrices
        { id: 'varp', name: 'varp', label: 'varp' }, // Gene-Gene Relations
        { id: 'layer', name: 'layer', label: 'layers' } // Expression Layers
    ];
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
    // Add tabs for obs, obsm, obsp, layer, and one for each source that gives a cell table columns
    const dataSources = cellTableSources();
    
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
    const dataSources = geneTableSources();
    
    createDataTabs(tabsContainer, tabContent, dataSources, id);
    
    // Populate each tab with available columns
    populateColumnsGeneTable(dataSources, datasetStructure, id, settings);
    
    // Activate the first tab
    const firstTab = tabsContainer.querySelector('button');
    if (firstTab) firstTab.click();
}

/** The id of a plain column's checkbox in the chooser. */
const plainCheckboxId = (column, panelId) => `checkbox-${column.type}-${column.key}-${column.column}-${panelId}`.replace(/\s+/g, '_');

/** An option of a select: its value and its text. */
function optionOf(value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
}

/**
 * The Layers, obsp and varp tabs (table-chooser-080.md 4): the ticked columns grouped under their layer or matrix, then
 * one add row, `[cell or gene] [layer or matrix] [Add column]`. The cross product is never listed. A column is stored as
 * before, `{type, key: <layer or matrix>, column: <name>}`; the search field filters the ticked rows and the item list.
 * @param {{id: string, label: string}} source - the tab
 * @param {Object|null} choices - panel-tracker.js tabChoices
 * @param {string} id - the table panel's id
 * @param {Object} settings
 */
function buildEntityTab(source, choices, id, settings) {
    const pane = document.getElementById(`${source.id}-content-${id}`);
    const list = pane && pane.querySelector('.checkbox-list');
    if (!list) return;
    list.innerHTML = '';
    if (!choices) {
        list.innerHTML = '<div class="alert alert-secondary">No columns available</div>';
        return;
    }
    const type = source.id;
    const word = choices.kind;                      // 'cell' | 'gene'
    const rowsBy = new Map();                       // key -> its group's element
    const notes = new Map(choices.entities.map((e) => [e.name, e.note]));
    const keyOrder = choices.keys;
    const groupOf = (key) => {
        let group = rowsBy.get(key);
        if (group) return group;
        group = document.createElement('div');
        group.className = 'az-entity-group';
        group.dataset.key = key;
        const title = document.createElement('div');
        title.className = 'az-score-group-title fw-semibold';
        title.textContent = key;
        group.appendChild(title);
        rowsBy.set(key, group);
        // the layer's own place: X, then the dataset's order
        const after = [...list.querySelectorAll('.az-entity-group')].find((g) => keyOrder.indexOf(g.dataset.key) > keyOrder.indexOf(key));
        if (after) list.insertBefore(group, after);
        else if (addBox.parentNode) list.insertBefore(group, addBox);
        else list.appendChild(group);
        return group;
    };
    const rowFor = (column, placeholder) => {
        const entry = { type, key: column.key, column: column.column };
        const div = document.createElement('div');
        div.className = 'form-check py-0 ms-3';
        const checkbox = document.createElement('input');
        checkbox.className = 'form-check-input column-checkbox';
        checkbox.type = 'checkbox';
        checkbox.id = plainCheckboxId(entry, id);
        checkbox.setAttribute('data-type', type);
        checkbox.setAttribute('data-key', entry.key);
        checkbox.setAttribute('data-column', entry.column);
        checkbox.dataset.scoreBound = '1';
        checkbox.addEventListener('change', () => updateSelectedColumnsList(id, settings));
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = checkbox.id;
        label.textContent = placeholder ? `no ${word} (unresolved placeholder)` : entry.column;
        div.dataset.search = `${entry.key} ${label.textContent}`.toLowerCase();
        div.appendChild(checkbox);
        div.appendChild(label);
        const note = !placeholder && notes.get(entry.column);
        if (note) {
            const span = document.createElement('span');
            span.className = 'form-text ms-2 az-entity-note';
            span.textContent = note;
            div.appendChild(span);
        }
        return { div, checkbox };
    };
    const addBox = document.createElement('div');
    addBox.className = 'az-entity-add';
    // the ticked columns, layer by layer in the dataset's order (X first), in the order they were added within one
    for (const key of keyOrder) {
        for (const column of choices.held.filter((h) => h.key === key)) {
            const { div, checkbox } = rowFor(column, column.placeholder);
            checkbox.checked = true;
            groupOf(key).appendChild(div);
        }
    }

    list.appendChild(addBox);

    // the add row
    const row = document.createElement('div');
    row.className = 'az-score-add ms-3';
    const item = document.createElement('select');
    item.className = 'form-select form-select-sm az-entity-item';
    item.setAttribute('aria-label', `${word === 'cell' ? 'Cell' : 'Gene'} of a new ${source.label} column`);
    const layer = document.createElement('select');
    layer.className = 'form-select form-select-sm az-entity-key';
    layer.setAttribute('aria-label', `${type === 'layer' ? 'Layer' : 'Matrix'} of a new column`);
    for (const key of choices.keys) layer.appendChild(optionOf(key, key));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-primary az-entity-add-btn';
    button.textContent = 'Add column';
    const note = document.createElement('div');
    note.className = 'form-text mt-0 az-score-add-note';
    note.setAttribute('role', 'status');
    const fillItems = (text = '') => {
        const held = item.value;
        const shown = choices.entities.filter((e) => `${e.name} ${e.note}`.toLowerCase().includes(text));
        item.innerHTML = '';
        for (const e of shown) item.appendChild(optionOf(e.name, `${e.name} (${e.note})`));
        if (shown.some((e) => e.name === held)) item.value = held;
        button.disabled = !shown.length;
    };
    fillItems();
    item.__refilter = fillItems;
    if (!choices.entities.length) note.textContent = `No ${word} is focused or fixed in a plot yet.`;
    button.addEventListener('click', () => {
        if (!item.value) return;
        const column = { key: layer.value, column: item.value };
        let box = document.getElementById(plainCheckboxId({ type, ...column }, id));
        if (!box) {
            const made = rowFor(column, false);
            groupOf(column.key).appendChild(made.div);
            box = made.checkbox;
        }
        box.checked = true;
        note.textContent = `Added ${column.key}: ${column.column}. Apply Changes to show it in the table.`;
        updateSelectedColumnsList(id, settings);
    });
    for (const part of [item, layer, button]) row.appendChild(part);
    addBox.appendChild(row);
    addBox.appendChild(note);

    // the one search field (the pane's, full width): the ticked rows and the item list
    const search = pane.querySelector('.column-search');
    if (search && !search.dataset.scoreBound) {
        search.dataset.scoreBound = '1';
        search.addEventListener('input', (e) => {
            const text = e.target.value.toLowerCase();
            for (const group of pane.querySelectorAll('.az-entity-group')) {
                let any = false;
                for (const r of group.querySelectorAll('.form-check')) {
                    const match = r.dataset.search.includes(text);
                    r.style.display = match ? '' : 'none';
                    any = any || match;
                }
                group.style.display = any ? '' : 'none';
            }
            const select = pane.querySelector('.az-entity-item');
            if (select && select.__refilter) select.__refilter(text);
        });
    }
}

/** The id of a column's checkbox in the chooser. */
function checkboxIdFor(column, panelId) {
    // a score's layer is always named: there is no default layer, and a column stored without one (an old
    // link) is read on the signature's input at the time (the provider says what a column reads)
    const half = tableHalfOf(column);
    const layer = half ? half.chooser.layerOf(column) : '';
    return `checkbox-${column.type}-${column.key}-${column.column}${layer ? `-of-${layer}` : ''}-${panelId}`.replace(/\s+/g, '_');
}

/**
 * One option of an entity in a Cell Table's chooser: a checkbox that is a column while ticked.
 * @param {Object} item - the column it stands for: {type, key, column, layer}
 * @param {{text: string, note?: string}} sub - its text, and what the provider says of it here
 * @param {{title: string}} entity
 * @param {string} id - the table panel's id
 * @param {Object} settings
 */
function sourceOptionRow(item, sub, entity, id, settings) {
    const div = document.createElement('div');
    div.className = 'form-check py-0 ms-3';
    const checkbox = document.createElement('input');
    checkbox.className = 'form-check-input column-checkbox';
    checkbox.type = 'checkbox';
    checkbox.id = checkboxIdFor(item, id);
    checkbox.setAttribute('data-type', item.type);
    checkbox.setAttribute('data-key', item.key);
    checkbox.setAttribute('data-column', item.column);
    if (item.layer) checkbox.setAttribute('data-layer', item.layer);
    checkbox.setAttribute('data-label', entity.title);
    checkbox.dataset.scoreBound = '1';
    checkbox.addEventListener('change', () => updateSelectedColumnsList(id, settings));
    const label = document.createElement('label');
    label.className = 'form-check-label';
    label.htmlFor = checkbox.id;
    label.textContent = sub.text;
    div.dataset.search = `${entity.title} ${sub.text}`.toLowerCase();
    div.append(checkbox);
    // the aggregation's symbol before the text, as the axis rows' button shows it (a provider without symbols has none);
    // beside the label, not in it, so the label stays the column's words; a click on it ticks as the label does
    if (sub.symbol) {
        const sym = symbolSpan(sub.symbol, 'axis-agg-sym az-score-sym');
        sym.setAttribute('aria-hidden', 'true');
        sym.addEventListener('click', () => checkbox.click());
        div.append(sym);
    }
    div.append(label);
    // what the provider says of the option here (it cannot be filtered on in this table: operator decision 15)
    if (sub.note) {
        const why = document.createElement('div');
        why.className = 'form-text mt-0 az-option-note';
        why.id = `${checkbox.id}-note`;
        why.textContent = sub.note;
        checkbox.setAttribute('aria-describedby', why.id);
        div.appendChild(why);
    }
    return { div, checkbox };
}

/**
 * The add row under an entity's ticked columns, `[layer] [aggregation button] [Add column]` (decision 31): the chooser lists
 * no method x layer pairs. Add ticks the column (made here when it is not listed yet); Apply takes it into the table.
 * @param {Object} provider
 * @param {Object} entity
 * @param {HTMLElement} group - the entity's group; new columns go before the row
 * @param {string} id - the table panel's id
 * @param {Object} settings
 */
function sourceAddRow(provider, entity, group, id, settings) {
    const add = provider.table.chooser.add;
    const row = document.createElement('div');
    row.className = 'az-score-add ms-3';
    const layer = document.createElement('select');
    layer.className = 'form-select form-select-sm az-score-add-layer';
    layer.setAttribute('aria-label', `Layer of a new ${entity.title} column`);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-primary az-score-add-btn';
    button.textContent = 'Add column';
    const note = document.createElement('div');
    note.className = 'form-text mt-0 az-score-add-note';
    note.setAttribute('role', 'status');
    // the method is the shared aggregation button (ui/aggregation-button.js), its entries the provider's menu for the pair held
    let pair = null;
    const agg = createAggregationButton({
        label: `Aggregation of a new ${entity.title} column`, axis: 'add',
        methods: () => (pair ? {
            options: add.menus(entity, pair.value()).methods.map(o => ({ value: o.value, name: add.name(o.value), symbol: add.symbols[o.value],
                disabled: !!o.disabled, title: o.title || '' })),
            chosen: pair.value().method
        } : null),
        onPick: (value) => pair.pick('method', value)
    });
    agg.button.classList.add('az-score-add-agg');
    pair = bindPairSelects({
        layer, note, onPaint: () => agg.update(),
        start: () => add.start(entity),
        menus: (p) => add.menus(entity, p),
        after: (changed, value, p) => add.after(entity, changed, value, p)
    });
    agg.update();       // the button's first paint came before the pair existed
    button.addEventListener('click', () => {
        const p = pair.value();
        const item = { type: provider.type, key: entity.id, column: p.method, layer: p.layer };
        let box = document.getElementById(checkboxIdFor(item, id));
        if (!box) {
            const made = sourceOptionRow(item, { text: add.label(p), symbol: add.symbols[p.method] }, entity, id, settings);
            group.insertBefore(made.div, row);
            box = made.checkbox;
        }
        box.checked = true;
        note.textContent = `Added ${add.label(p)}. Apply Changes to show it in the table.`;
        updateSelectedColumnsList(id, settings);
    });
    row.append(layer, agg.button, button);
    group.append(row, note);
}

/**
 * The tab of a source in a Cell Table's chooser: every entity (open or closed), and under each its ticked columns,
 * then (for a provider with an add row) `[layer] [aggregation button] [Add column]`. Several entities and several columns of
 * one can be ticked at once: each is a column. Rebuilt whenever panels come, go or are renamed, since an entity can be
 * made at any time. The words and the options are the provider's (utils/table-source.js `chooser`).
 * @param {Object} provider - a registered source with a table half
 * @param {string} id - the table panel's id
 * @param {Object} settings - the panel settings
 */
export function buildSourceTab(provider, id, settings, structure = null) {
    const chooser = provider.table.chooser;
    const pane = document.getElementById(`${provider.type}-content-${id}`);
    if (!pane) return;
    const list = pane.querySelector('.checkbox-list');
    if (!list) return;
    const search = pane.querySelector('.column-search');
    list.innerHTML = '';
    const entities = provider.entities();
    if (!entities.length) {
        const none = document.createElement('div');
        none.className = 'alert alert-secondary mb-2';
        none.textContent = chooser.empty.text;
        list.appendChild(none);
        const make = document.createElement('button');
        make.type = 'button';
        make.className = 'btn btn-sm btn-outline-primary az-score-new';
        make.textContent = chooser.empty.button;
        make.addEventListener('click', () => {
            // the entity opens beside this table; the tab lists it as soon as it exists
            if (provider.newEntity) provider.newEntity.run(id);
        });
        list.appendChild(make);
        return;
    }
    const ticked = (settings.columns || []).filter(c => c.type === provider.type);
    if (chooser.note) chooser.note(structure || pane.__structure || null);
    pane.__structure = structure || pane.__structure || null;
    for (const entity of entities) {
        const group = document.createElement('div');
        group.className = 'az-score-group';
        group.dataset.entity = entity.id;
        const heading = document.createElement('div');
        heading.className = 'az-score-group-title fw-semibold';
        heading.textContent = chooser.entityLabel(entity);
        heading.title = entity.open ? chooser.entityLabel(entity) : `${chooser.entityLabel(entity)} (closed)`;
        group.appendChild(heading);
        // every column stores the layer it was given
        for (const sub of chooser.options(entity, ticked, id)) {
            const item = { type: provider.type, key: entity.id, column: sub.column, layer: sub.layer };
            const { div, checkbox } = sourceOptionRow(item, sub, entity, id, settings);
            checkbox.checked = ticked.some(c => c.key === entity.id && subOf(c) === sub.column && chooser.layerOf(c) === (sub.layer || ''));
            group.appendChild(div);
        }
        if (chooser.add) sourceAddRow(provider, entity, group, id, settings);
        list.appendChild(group);
    }
    if (search && !search.dataset.scoreBound) {
        search.dataset.scoreBound = '1';
        search.addEventListener('input', (e) => {
            const text = e.target.value.toLowerCase();
            for (const group of pane.querySelectorAll('.az-score-group')) {
                const heading = group.querySelector('.az-score-group-title');
                const named = !!heading && heading.textContent.toLowerCase().includes(text);
                let any = named;
                for (const row of group.querySelectorAll('.form-check')) {
                    const match = named || row.dataset.search.includes(text);
                    row.style.display = match ? '' : 'none';
                    any = any || match;
                }
                group.style.display = any ? '' : 'none';
            }
        });
    }
}

/**
 * Take a column out of the chooser and the table's columns (the table is built again by the
 * caller). The tick goes first: the chooser derives the columns from its ticks.
 * @param {string} id
 * @param {Object} settings
 * @param {Object} column
 * @param {(a: Object, b: Object) => boolean} same
 */
export function removeColumnFromChooser(id, settings, column, same) {
    const box = document.getElementById(checkboxIdFor({ ...column, column: column.column || subOf(column) }, id));
    if (box) box.checked = false;
    settings.columns = (settings.columns || []).filter(c => !same(c, column));
    updateSelectedColumnsList(id, settings);
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
        // the tabs with an add row (a provider's, the layers, obsp and varp) read as a sentence; the other built-in tabs keep their ellipsis
        searchInput.placeholder = (tableProviders().some(p => p.type === source.id) || ['layer', 'obsp', 'varp'].includes(source.id)) ? `Search ${source.label.toLowerCase()}` : `Search ${source.label.toLowerCase()}...`;
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
        if (checkbox.dataset.scoreBound) return;      // the gene-score tab listens for itself
        checkbox.addEventListener('change', () => {
            updateSelectedColumnsList(id, settings);
        }, { signal });
    });
    // entities come and go (a signature is made at any time): the tabs of the sources list them again
    if (entityType === 'cells') {
        document.addEventListener('annzarro:panels-changed', () => {
            for (const provider of tableProviders()) buildSourceTab(provider, id, settings);
        }, { signal });
    }
    
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
    
    // The columns the line-selection tool derived are not in the chooser: they
    // stay, after the ticked ones
    const derived = (settings.columns || []).filter(isDerived);
    // so do source columns whose entity is no longer listed (deleted): they say so in the table,
    // and go when the user removes them
    const orphans = (settings.columns || []).filter(c => isScoreColumn(c)
        && !document.getElementById(checkboxIdFor({ ...c, column: c.column || subOf(c) }, id)));
    // the score columns as they were: one already there on the same layer is kept as it is (an old column with no
    // layer keeps its key, and so its filter conditions); only a new tick stores its layer
    const before = (settings.columns || []).filter(isScoreColumn);
    settings.columns = [];
    
    // Add each selected column
    checkboxes.forEach(checkbox => {
        const type = checkbox.getAttribute('data-type');
        const key = checkbox.getAttribute('data-key');
        const column = checkbox.getAttribute('data-column');
        
        // Add to settings (a source column also keeps the entity's title, for when it is deleted)
        const entry = { type, key, column };
        const half = tableHalfOf({ type });
        if (half) {
            entry.label = checkbox.getAttribute('data-label') || undefined;
            const layer = checkbox.getAttribute('data-layer');
            if (layer) entry.layer = layer;
            const had = before.find(c => c.type === type && c.key === key && subOf(c) === column && (half.chooser.layerOf(c) || null) === layer);
            if (had) { delete entry.layer; if (had.layer) entry.layer = had.layer; }
        }
        settings.columns.push(entry);
        
        // Create list item
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        
        const displayName = getColumnDisplayName(entry);
        
        // Create text span with ellipsis for long names
        const textSpan = document.createElement('span');
        // Shortened in the MIDDLE: kompot_de_..._mahalanobis and
        // kompot_de_..._mean_lfc used to look identical (cut at the end)
        textSpan.textContent = shortColumnName(displayName);
        textSpan.title = displayName; // Full name in tooltip
        textSpan.className = 'text-truncate';
        listItem.appendChild(textSpan);
        
        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-outline-danger btn-xs';
        removeButton.innerHTML = '<i class="fas fa-times"></i>';
        removeButton.title = 'Remove from selection';
        removeButton.addEventListener('click', () => {
            // Uncheck the corresponding checkbox (a score column's id names its layer)
            const checkbox = document.getElementById(checkboxIdFor(entry, id));
            if (checkbox) {
                checkbox.checked = false;
            }
            
            // Update the list
            updateSelectedColumnsList(id, settings);
        });
        
        listItem.appendChild(removeButton);
        selectedColumnsList.appendChild(listItem);
    });
    
    for (const column of derived) {
        settings.columns.push(column);
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item derived-column';
        const textSpan = document.createElement('span');
        textSpan.textContent = shortColumnName(column.key);
        textSpan.title = `${column.key} (derived by a drawn line)`;
        textSpan.className = 'text-truncate';
        listItem.appendChild(textSpan);
        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-outline-danger btn-xs';
        removeButton.innerHTML = '<i class="fas fa-times"></i>';
        removeButton.title = 'Remove from selection';
        removeButton.addEventListener('click', () => {
            settings.columns = settings.columns.filter(c => c !== column);
            updateSelectedColumnsList(id, settings);
        });
        listItem.appendChild(removeButton);
        selectedColumnsList.appendChild(listItem);
    }

    for (const column of orphans) {
        settings.columns.push(column);
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item orphan-score-column';
        const textSpan = document.createElement('span');
        const name = getColumnDisplayName(column);
        textSpan.textContent = shortColumnName(name);
        textSpan.title = `${name} (the signature is gone)`;
        textSpan.className = 'text-truncate';
        listItem.appendChild(textSpan);
        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-outline-danger btn-xs';
        removeButton.innerHTML = '<i class="fas fa-times"></i>';
        removeButton.title = 'Remove from selection';
        removeButton.addEventListener('click', () => {
            settings.columns = settings.columns.filter(c => c !== column);
            updateSelectedColumnsList(id, settings);
        });
        listItem.appendChild(removeButton);
        selectedColumnsList.appendChild(listItem);
    }

    // Show "no columns selected" message if no columns are selected
    if (settings.columns.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'list-group-item text-muted';
        emptyItem.textContent = 'No columns selected';
        selectedColumnsList.appendChild(emptyItem);
    }
}

/**
 * Tick the chooser's boxes for the columns in settings and list them as
 * selected (after columns were added from outside the chooser).
 * @param {string} id - The panel ID
 * @param {Object} settings - The panel settings
 */
export function syncSelectedColumns(id, settings) {
    restoreSelectedColumns(id, settings);
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
        // a link made before aggregations existed names the signature only: the default one
        if (isScoreColumn(col) && !col.column) col.column = subOf(col);
        const checkboxId = `checkbox-${col.type}-${col.key}-${col.column}-${id}`.replace(/\s+/g, '_');
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    
    // Update the selected columns list
    updateSelectedColumnsList(id, settings);
}