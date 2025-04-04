/**
 * UIManager - Manages the user interface and layouts
 * This class is responsible for:
 * 1. Managing different layout configurations
 * 2. Creating and updating panels
 * 3. Handling UI events and user interactions
 */

/**
 * Helper function to access dependencies safely.
 * This avoids variable declarations that might conflict.
 */
function getDependencies() {
    let deps = {};
    
    // Node environment
    if (typeof require !== 'undefined') {
        deps.dataManager = require('./data-manager');
        deps.matrixManager = require('./matrix-manager');
        deps.plotManager = require('./plot-manager');
        deps.tableManager = require('./table-manager');
        deps.stringDB = require('./string-db');
        deps.Utils = require('./utils');
    } 
    // Annzarro modules
    else if (typeof Annzarro !== 'undefined' && Annzarro.modules) {
        deps.dataManager = Annzarro.modules.dataManager;
        deps.matrixManager = Annzarro.modules.matrixManager;
        deps.plotManager = Annzarro.modules.plotManager;
        deps.tableManager = Annzarro.modules.tableManager;
        deps.stringDB = Annzarro.modules.stringDB;
        deps.Utils = Annzarro.modules.Utils;
    }
    // Global fallback
    else if (typeof window !== 'undefined') {
        deps.dataManager = window.dataManager;
        deps.matrixManager = window.matrixManager;
        deps.plotManager = window.plotManager;
        deps.tableManager = window.tableManager;
        deps.stringDB = window.stringDB;
        deps.Utils = window.Utils;
    }
    
    return deps;
}

class UIManager {
    constructor() {
        // Available layouts
        this.layouts = {
            'single': this.createSingleLayout.bind(this),
            'horizontal': this.createHorizontalLayout.bind(this),
            'vertical': this.createVerticalLayout.bind(this),
            'quad': this.createQuadLayout.bind(this)
        };
        
        // Current layout type
        this.currentLayout = 'single';
        
        // Map of panels (id -> panel info)
        this.panels = new Map();
        
        // Panel types and their creators
        this.panelTypes = {
            'plot': this.createPlotPanel.bind(this),
            'table': this.createTablePanel.bind(this),
            'gene-info': this.createGeneInfoPanel.bind(this),
            'cell-info': this.createCellInfoPanel.bind(this),
            'data-explorer': this.createDataExplorerPanel.bind(this),
            'string-db': this.createStringDbPanel.bind(this),
            'matrix': this.createMatrixPanel.bind(this)
        };
        
        // Initialize UI event handlers
        this._initEventHandlers();
        
        // Set up focus change handlers
        this._setupFocusChangeHandlers();
    }

    /**
     * Initialize the UI manager
     * @param {string} containerId - ID of the main container element
     */
    initialize(containerId = 'vizContainer') {
        this.containerId = containerId;
        console.log(`Initializing UI manager with container ID: ${containerId}`);
        
        // Always ensure we have a container element
        this.container = document.getElementById(containerId);
        
        // Create a container element if it doesn't exist
        if (!this.container) {
            console.log(`Container element with ID ${containerId} not found, creating it`);
            
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.className = 'h-100 w-100';
            
            // Find panel container to append to (this is the most important part)
            const panelContainer = document.getElementById('panelContainer');
            if (panelContainer) {
                console.log('Found panelContainer, appending container to it');
                
                // Make sure the panel container is visible and empty state is hidden
                const emptyState = document.getElementById('emptyState');
                if (emptyState) {
                    console.log('Hiding empty state');
                    emptyState.classList.add('d-none');
                }
                
                // Show panel container
                panelContainer.classList.remove('d-none');
                panelContainer.style.display = 'block';
                panelContainer.style.height = '100%';
                panelContainer.appendChild(this.container);
            } else {
                // Fallback - find mainContainer
                const mainContainer = document.getElementById('mainContainer');
                if (mainContainer) {
                    console.log('Found mainContainer, appending container to it');
                    mainContainer.appendChild(this.container);
                } else {
                    // Last resort - append to body
                    console.log('No suitable container found, appending to body');
                    document.body.appendChild(this.container);
                }
            }
            
            console.log(`Created container element with ID ${containerId}`);
        }
        
        // Ensure the container is visible and has proper dimensions
        this.container.style.display = 'block';
        this.container.style.height = '100%';
        this.container.style.width = '100%';
        
        console.log('Setting initial layout to single');
        // Set initial layout
        this.setLayout('single');
    }

    /**
     * Set the layout type
     * @param {string} layoutType - Type of layout ('single', 'horizontal', 'vertical', 'quad')
     */
    setLayout(layoutType) {
        console.log(`Setting layout to: ${layoutType}`);
        
        if (!this.layouts[layoutType]) {
            console.error(`Layout type '${layoutType}' is not supported`);
            return;
        }
        
        // Save current panels
        const currentPanels = Array.from(this.panels.values());
        
        // Clear the container
        const panelContainer = document.getElementById('panelContainer');
        if (panelContainer) {
            panelContainer.innerHTML = '';
            
            // Create a default container if needed
            if (!this.container || !document.getElementById(this.containerId)) {
                this.container = document.createElement('div');
                this.container.id = this.containerId;
                this.container.className = 'h-100 w-100';
                panelContainer.appendChild(this.container);
            }
        }
        
        // Make sure container is visible
        if (this.container) {
            this.container.style.display = 'block';
        }
        
        // Clear panels
        this.panels.clear();
        
        // Create the new layout
        this.layouts[layoutType]();
        this.currentLayout = layoutType;
        
        // Create default panel if no panels were created
        if (this.panels.size === 0) {
            console.log('Creating default panel for empty layout');
            // For single layout, create one plot panel
            if (layoutType === 'single' && document.getElementById('panel-1')) {
                this.createPanel('panel-1', 'plot', {
                    title: 'UMAP Plot',
                    plotType: 'scatter'
                });
            }
        }
        
        // Restore panels if possible
        if (currentPanels.length > 0) {
            const maxPanels = {
                'single': 1,
                'horizontal': 2,
                'vertical': 2,
                'quad': 4
            }[layoutType] || 1;
            
            // Restore up to maxPanels
            for (let i = 0; i < Math.min(maxPanels, currentPanels.length); i++) {
                const panel = currentPanels[i];
                const panelId = `panel-${i + 1}`;
                
                // Create the panel
                this.createPanel(panelId, panel.type, panel.config);
            }
        }
        
        // Dispatch layout changed event
        const event = new CustomEvent('layoutChanged', {
            detail: { layout: layoutType }
        });
        document.dispatchEvent(event);
    }

    /**
     * Create a single layout
     * @private
     */
    createSingleLayout() {
        console.log('Creating single layout');
        
        // Make sure we have a container to work with
        if (!this.container) {
            console.error('Container not found for layout creation');
            return;
        }
        
        // Clear the container first to avoid duplicated content
        this.container.innerHTML = '';
        
        // Set up the container structure
        const row = document.createElement('div');
        row.className = 'row h-100';
        row.style.margin = '0'; // Ensure row doesn't add unwanted margins
        this.container.appendChild(row);
        
        const col = document.createElement('div');
        col.className = 'col-12 h-100 p-0'; // Removed padding
        row.appendChild(col);
        
        const panel = document.createElement('div');
        panel.id = 'panel-1';
        panel.className = 'h-100 panel';
        col.appendChild(panel);
        
        // Create empty panel
        this._createEmptyPanelContent(panel);
        
        // Make sure panel is visible
        panel.style.display = 'block';
        
        console.log('Single layout created with panel-1');
    }

    /**
     * Create a horizontal layout (side by side)
     * @private
     */
    createHorizontalLayout() {
        // Clear the container
        this.container.innerHTML = '';
        
        // Create a wrapper using CSS Grid instead of Bootstrap
        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid-container';
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateColumns = '50% 50%';
        gridContainer.style.gridTemplateRows = '100%';
        gridContainer.style.height = '100%';
        gridContainer.style.width = '100%';
        gridContainer.style.overflow = 'hidden';
        this.container.appendChild(gridContainer);
        
        for (let i = 1; i <= 2; i++) {
            const panelContainer = document.createElement('div');
            panelContainer.className = 'panel-container';
            panelContainer.style.gridColumn = i;
            panelContainer.style.gridRow = 1;
            panelContainer.style.overflow = 'hidden';
            panelContainer.style.height = '100%';
            panelContainer.style.position = 'relative';
            gridContainer.appendChild(panelContainer);
            
            const panel = document.createElement('div');
            panel.id = `panel-${i}`;
            panel.className = 'h-100 panel';
            panel.style.overflow = 'hidden';
            panelContainer.appendChild(panel);
            
            // Create empty panel
            this._createEmptyPanelContent(panel);
        }
        
        // Add resizer between panels (replaces old implementation)
        const resizer = document.createElement('div');
        resizer.className = 'panel-resizer horizontal';
        resizer.style.position = 'absolute';
        resizer.style.width = '10px';
        resizer.style.height = '100%';
        resizer.style.left = 'calc(50% - 5px)';
        resizer.style.top = '0';
        resizer.style.cursor = 'col-resize';
        resizer.style.zIndex = '1000';
        resizer.style.backgroundColor = '#dee2e6';
        this.container.appendChild(resizer);
        
        // Attach resize event
        this._attachGridResizeEvent(resizer, gridContainer, 'horizontal');
    }

    /**
     * Create a vertical layout (stacked)
     * @private
     */
    createVerticalLayout() {
        // Clear the container
        this.container.innerHTML = '';
        
        // Create a wrapper using CSS Grid
        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid-container';
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateRows = '50% 50%';
        gridContainer.style.gridTemplateColumns = '100%';
        gridContainer.style.height = '100%';
        gridContainer.style.width = '100%';
        gridContainer.style.overflow = 'hidden';
        this.container.appendChild(gridContainer);
        
        for (let i = 1; i <= 2; i++) {
            const panelContainer = document.createElement('div');
            panelContainer.className = 'panel-container';
            panelContainer.style.gridRow = i;
            panelContainer.style.gridColumn = 1;
            panelContainer.style.overflow = 'hidden';
            panelContainer.style.height = '100%';
            panelContainer.style.position = 'relative';
            gridContainer.appendChild(panelContainer);
            
            const panel = document.createElement('div');
            panel.id = `panel-${i}`;
            panel.className = 'h-100 panel';
            panel.style.overflow = 'hidden';
            panelContainer.appendChild(panel);
            
            // Create empty panel
            this._createEmptyPanelContent(panel);
        }
        
        // Add resizer between panels
        const resizer = document.createElement('div');
        resizer.className = 'panel-resizer vertical';
        resizer.style.position = 'absolute';
        resizer.style.height = '10px';
        resizer.style.width = '100%';
        resizer.style.top = 'calc(50% - 5px)';
        resizer.style.left = '0';
        resizer.style.cursor = 'row-resize';
        resizer.style.zIndex = '1000';
        resizer.style.backgroundColor = '#dee2e6';
        this.container.appendChild(resizer);
        
        // Attach resize event
        this._attachGridResizeEvent(resizer, gridContainer, 'vertical');
    }

    /**
     * Create a quad layout (2x2 grid)
     * @private
     */
    createQuadLayout() {
        // Clear the container
        this.container.innerHTML = '';
        
        // Create a wrapper using CSS Grid
        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid-container';
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateRows = '50% 50%';
        gridContainer.style.gridTemplateColumns = '50% 50%';
        gridContainer.style.height = '100%';
        gridContainer.style.width = '100%';
        gridContainer.style.overflow = 'hidden';
        this.container.appendChild(gridContainer);
        
        // Create all four panels
        let panelCount = 1;
        for (let row = 1; row <= 2; row++) {
            for (let col = 1; col <= 2; col++) {
                const panelContainer = document.createElement('div');
                panelContainer.className = 'panel-container';
                panelContainer.style.gridRow = row;
                panelContainer.style.gridColumn = col;
                panelContainer.style.overflow = 'hidden';
                panelContainer.style.height = '100%';
                panelContainer.style.position = 'relative';
                gridContainer.appendChild(panelContainer);
                
                const panel = document.createElement('div');
                panel.id = `panel-${panelCount}`;
                panel.className = 'h-100 panel';
                panel.style.overflow = 'hidden';
                panelContainer.appendChild(panel);
                
                // Create empty panel
                this._createEmptyPanelContent(panel);
                
                panelCount++;
            }
        }
        
        // Add horizontal resizer
        const horizontalResizer = document.createElement('div');
        horizontalResizer.className = 'panel-resizer horizontal';
        horizontalResizer.style.position = 'absolute';
        horizontalResizer.style.width = '10px';
        horizontalResizer.style.height = '100%';
        horizontalResizer.style.left = 'calc(50% - 5px)';
        horizontalResizer.style.top = '0';
        horizontalResizer.style.cursor = 'col-resize';
        horizontalResizer.style.zIndex = '1000';
        horizontalResizer.style.backgroundColor = '#dee2e6';
        this.container.appendChild(horizontalResizer);
        
        // Add vertical resizer
        const verticalResizer = document.createElement('div');
        verticalResizer.className = 'panel-resizer vertical';
        verticalResizer.style.position = 'absolute';
        verticalResizer.style.height = '10px';
        verticalResizer.style.width = '100%';
        verticalResizer.style.top = 'calc(50% - 5px)';
        verticalResizer.style.left = '0';
        verticalResizer.style.cursor = 'row-resize';
        verticalResizer.style.zIndex = '1000';
        verticalResizer.style.backgroundColor = '#dee2e6';
        this.container.appendChild(verticalResizer);
        
        // Attach resize events
        this._attachGridResizeEvent(horizontalResizer, gridContainer, 'horizontal');
        this._attachGridResizeEvent(verticalResizer, gridContainer, 'vertical');
    }

    /**
     * Create a new panel
     * @param {string} panelId - ID of the panel element
     * @param {string} panelType - Type of panel to create
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     */
    createPanel(panelId, panelType, config = {}) {
        console.log(`Creating panel with ID ${panelId}, type ${panelType}`);
        
        // Get the panel element
        let panelElement = document.getElementById(panelId);
        if (!panelElement) {
            console.warn(`Panel element with ID ${panelId} not found, creating it`);
            
            // Try to find the container
            const container = this.container || document.getElementById(this.containerId);
            if (!container) {
                console.error('Container not found for creating panel');
                return null;
            }
            
            // Create the panel element
            panelElement = document.createElement('div');
            panelElement.id = panelId;
            panelElement.className = 'h-100 panel';
            
            // Find a suitable parent based on the panel ID
            if (panelId === 'panel-1') {
                // For panel-1, find the main layout container
                const col = container.querySelector('.col-12');
                if (col) {
                    col.appendChild(panelElement);
                } else {
                    container.appendChild(panelElement);
                }
            } else {
                // For other panels, add them directly to the container
                container.appendChild(panelElement);
            }
        }
        
        // Check if panel type is supported
        if (!this.panelTypes[panelType]) {
            console.error(`Panel type '${panelType}' is not supported`);
            // Use a fallback panel type if available
            if (this.panelTypes['plot']) {
                console.log(`Falling back to 'plot' panel type`);
                panelType = 'plot';
            } else {
                return null;
            }
        }
        
        // Make sure panel is visible
        panelElement.style.display = 'block';
        
        // Clear the panel
        panelElement.innerHTML = '';
        
        console.log(`Creating ${panelType} panel content`);
        
        try {
            // Create the panel
            const panel = this.panelTypes[panelType](panelElement, config);
            
            // Store the panel info
            this.panels.set(panelId, {
                element: panelElement,
                type: panelType,
                config: config
            });
            
            console.log(`Panel ${panelId} created successfully`);
            return panel;
        } catch (error) {
            console.error(`Error creating panel: ${error.message}`);
            // Create a fallback panel with error message
            panelElement.innerHTML = `
                <div class="alert alert-danger m-3">
                    <h5>Error Creating Panel</h5>
                    <p>${error.message}</p>
                </div>
            `;
            return panelElement;
        }
    }

    /**
     * Create a plot panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createPlotPanel(container, config = {}) {
        console.log('Creating plot panel', config);
        
        // Get dependencies
        const deps = getDependencies();
        const plotManager = deps.plotManager;
        const dataManager = deps.dataManager;
        
        if (!plotManager) {
            console.error('PlotManager dependency not found');
            container.innerHTML = `
                <div class="alert alert-danger m-3">
                    <h5>Error</h5>
                    <p>PlotManager dependency not found</p>
                </div>
            `;
            return container;
        }
        
        // Make sure the container is visible
        container.style.display = 'block';
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'Plot';
        header.appendChild(title);
        
        // Add controls
        const controls = document.createElement('div');
        controls.className = 'd-flex';
        header.appendChild(controls);
        
        // Add settings button
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'btn btn-sm btn-outline-secondary me-1';
        settingsBtn.innerHTML = '<i class="bi bi-gear"></i>';
        settingsBtn.title = 'Plot Settings';
        settingsBtn.addEventListener('click', () => {
            // Show plot settings modal
            $('#vizSettingsModal').modal('show');
            
            // Store the target panel ID in the modal
            document.getElementById('vizSettingsModal').dataset.targetPanel = container.id;
            
            // Populate the settings form based on the current config
            this._populatePlotSettingsForm(config);
        });
        controls.appendChild(settingsBtn);
        
        // Add export button
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn btn-sm btn-outline-secondary me-1';
        exportBtn.innerHTML = '<i class="bi bi-download"></i>';
        exportBtn.title = 'Export Plot';
        exportBtn.addEventListener('click', () => {
            // Export the plot
            plotManager.downloadPlot(container.id, 'png', `annzarro-plot-${new Date().toISOString().slice(0, 10)}`);
        });
        controls.appendChild(exportBtn);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        body.style.height = 'calc(100% - 50px)'; // Account for header height
        container.appendChild(body);
        
        // Create the plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'h-100 w-100';
        plotContainer.id = `plot-${container.id}`;
        body.appendChild(plotContainer);
        
        // Check if data is loaded
        const dataLoaded = dataManager && dataManager.isDataLoaded && dataManager.isDataLoaded();
        
        // Create a placeholder plot if no data is provided or no data is loaded
        if (!config.data && !dataLoaded) {
            console.log('No data available, showing placeholder');
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-graph-up fs-1 mb-3"></i>
                    <p>Load data to see visualization</p>
                    <button class="btn btn-primary btn-sm load-data-btn">
                        <i class="bi bi-folder-plus"></i> Load Data
                    </button>
                </div>
            `;
            plotContainer.appendChild(placeholder);
            
            // Add click handler for the load data button
            placeholder.querySelector('.load-data-btn')?.addEventListener('click', () => {
                $('#loadDataModal').modal('show');
            });
        } else if (!config.data && dataLoaded) {
            // Data is loaded but no specific plot configuration
            console.log('Data loaded but no plot config, creating default plot');
            
            // Try to create a default plot with UMAP if available
            try {
                const basicInfo = dataManager.getBasicInfo();
                if (basicInfo && basicInfo.embeddings && basicInfo.embeddings.includes('umap')) {
                    console.log('Creating default UMAP plot');
                    
                    // Create simple plot data
                    const defaultConfig = {
                        plotType: 'scatter',
                        title: 'UMAP Visualization',
                        xAxis: 'obsm:X_umap:0',
                        yAxis: 'obsm:X_umap:1'
                    };
                    
                    // Load the data and create the plot
                    this._loadPlotData(defaultConfig)
                        .then(plotData => {
                            console.log('Default plot data loaded', plotData);
                            plotManager.createPlot(
                                plotContainer.id,
                                defaultConfig.plotType,
                                plotData,
                                { markerSize: 5, markerOpacity: 0.7 }
                            );
                        })
                        .catch(error => {
                            console.error('Error creating default plot:', error);
                            plotContainer.innerHTML = `
                                <div class="alert alert-warning m-3">
                                    <p>Could not create default plot: ${error.message}</p>
                                    <button class="btn btn-primary btn-sm configure-plot-btn">
                                        <i class="bi bi-gear"></i> Configure Plot
                                    </button>
                                </div>
                            `;
                            
                            // Add click handler for the configure button
                            plotContainer.querySelector('.configure-plot-btn')?.addEventListener('click', () => {
                                settingsBtn.click();
                            });
                        });
                } else {
                    console.log('No embeddings found, showing configuration prompt');
                    plotContainer.innerHTML = `
                        <div class="d-flex justify-content-center align-items-center h-100">
                            <div class="text-center text-muted">
                                <i class="bi bi-graph-up fs-1 mb-3"></i>
                                <p>Data loaded. Configure the plot to see visualization.</p>
                                <button class="btn btn-primary btn-sm configure-plot-btn">
                                    <i class="bi bi-gear"></i> Configure Plot
                                </button>
                            </div>
                        </div>
                    `;
                    
                    // Add click handler for the configure button
                    plotContainer.querySelector('.configure-plot-btn')?.addEventListener('click', () => {
                        settingsBtn.click();
                    });
                }
            } catch (error) {
                console.error('Error setting up default plot:', error);
                plotContainer.innerHTML = `
                    <div class="alert alert-warning m-3">
                        <p>Error setting up plot: ${error.message}</p>
                    </div>
                `;
            }
        } else if (config.data) {
            // Create the actual plot with provided data
            console.log('Creating plot with provided data');
            
            try {
                plotManager.createPlot(
                    plotContainer.id,
                    config.plotType || 'scatter',
                    config.data,
                    config.plotSettings || { markerSize: 5, markerOpacity: 0.7 }
                );
            } catch (error) {
                console.error('Error creating plot:', error);
                plotContainer.innerHTML = `
                    <div class="alert alert-danger m-3">
                        <p>Error creating plot: ${error.message}</p>
                    </div>
                `;
            }
        }
        
        return container;
    }

    /**
     * Create a table panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createTablePanel(container, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const tableManager = deps.tableManager;
        if (!tableManager) {
            console.error('TableManager dependency not found');
            return container;
        }
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'Data Table';
        header.appendChild(title);
        
        // Add controls
        const controls = document.createElement('div');
        controls.className = 'd-flex';
        header.appendChild(controls);
        
        // Add columns button
        const columnsBtn = document.createElement('button');
        columnsBtn.className = 'btn btn-sm btn-outline-secondary me-1';
        columnsBtn.innerHTML = '<i class="fas fa-columns"></i>';
        columnsBtn.title = 'Manage Columns';
        columnsBtn.addEventListener('click', () => {
            // Show columns selection modal
            this._showColumnsSelectionModal(container.id, config);
        });
        controls.appendChild(columnsBtn);
        
        // Add export button
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn btn-sm btn-outline-secondary me-1';
        exportBtn.innerHTML = '<i class="fas fa-download"></i>';
        exportBtn.title = 'Export Data';
        exportBtn.addEventListener('click', () => {
            // Export the table data
            const table = tableManager.getTable(`table-${container.id}`);
            if (table) {
                // Use DataTables export buttons
                table.buttons('excel:name').trigger();
            }
        });
        controls.appendChild(exportBtn);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create the table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'h-100 w-100';
        tableContainer.id = `table-${container.id}`;
        body.appendChild(tableContainer);
        
        // Create a placeholder table if no data is provided
        if (!config.data) {
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-table fs-1 mb-3"></i>
                    <p>Configure the table to see data</p>
                </div>
            `;
            tableContainer.appendChild(placeholder);
        } else {
            // Create the actual table
            tableManager.createTable(
                tableContainer.id,
                config.data,
                config.columns || [],
                config.tableOptions || {}
            );
        }
        
        return container;
    }

    /**
     * Create a gene info panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createGeneInfoPanel(container, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const stringDB = deps.stringDB;
        const plotManager = deps.plotManager;
        
        if (!dataManager || !stringDB || !plotManager) {
            console.error('Dependencies not found');
            return container;
        }
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'Gene Information';
        header.appendChild(title);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create the gene info container
        const geneInfoContainer = document.createElement('div');
        geneInfoContainer.className = 'h-100 w-100';
        geneInfoContainer.id = `gene-info-${container.id}`;
        body.appendChild(geneInfoContainer);
        
        // Show gene info if gene is provided
        if (config.gene) {
            this._displayGeneInfo(geneInfoContainer.id, config.gene, config.speciesId);
        } else {
            // Create a placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-code-slash fs-1 mb-3"></i>
                    <p>Select a gene to see information</p>
                </div>
            `;
            geneInfoContainer.appendChild(placeholder);
        }
        
        return container;
    }

    /**
     * Create a cell info panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createCellInfoPanel(container, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) {
            console.error('DataManager dependency not found');
            return container;
        }
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'Cell Information';
        header.appendChild(title);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create the cell info container
        const cellInfoContainer = document.createElement('div');
        cellInfoContainer.className = 'h-100 w-100';
        cellInfoContainer.id = `cell-info-${container.id}`;
        body.appendChild(cellInfoContainer);
        
        // Show cell info if cell is provided
        if (config.cell) {
            this._displayCellInfo(cellInfoContainer.id, config.cell);
        } else {
            // Create a placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-circle fs-1 mb-3"></i>
                    <p>Select a cell to see information</p>
                </div>
            `;
            cellInfoContainer.appendChild(placeholder);
        }
        
        return container;
    }

    /**
     * Create a data explorer panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createDataExplorerPanel(container, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const Utils = deps.Utils;
        
        if (!dataManager || !Utils) {
            console.error('Dependencies not found');
            return container;
        }
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'Data Explorer';
        header.appendChild(title);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create explorer container
        const explorerContainer = document.createElement('div');
        explorerContainer.className = 'h-100 w-100';
        explorerContainer.id = `explorer-${container.id}`;
        body.appendChild(explorerContainer);
        
        // Create tabs
        const tabsNav = document.createElement('ul');
        tabsNav.className = 'nav nav-tabs';
        tabsNav.role = 'tablist';
        explorerContainer.appendChild(tabsNav);
        
        // Create tab content
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        explorerContainer.appendChild(tabContent);
        
        // Define tabs
        const tabs = [
            { id: 'overview', label: 'Overview', active: true },
            { id: 'obs', label: 'Cells (.obs)' },
            { id: 'var', label: 'Genes (.var)' },
            { id: 'obsm', label: 'Cell Matrices (.obsm)' },
            { id: 'varm', label: 'Gene Matrices (.varm)' },
            { id: 'layers', label: 'Layers' },
            { id: 'uns', label: 'Unstructured (.uns)' },
            { id: 'kompot', label: 'Kompot Runs' }
        ];
        
        // Create tabs and panes
        for (const tab of tabs) {
            // Create tab
            const tabItem = document.createElement('li');
            tabItem.className = 'nav-item';
            tabItem.role = 'presentation';
            tabsNav.appendChild(tabItem);
            
            const tabButton = document.createElement('button');
            tabButton.className = `nav-link ${tab.active ? 'active' : ''}`;
            tabButton.id = `${tab.id}-tab-${container.id}`;
            tabButton.dataset.bsToggle = 'tab';
            tabButton.dataset.bsTarget = `#${tab.id}-pane-${container.id}`;
            tabButton.type = 'button';
            tabButton.role = 'tab';
            tabButton.setAttribute('aria-controls', `${tab.id}-pane-${container.id}`);
            tabButton.setAttribute('aria-selected', tab.active ? 'true' : 'false');
            tabButton.textContent = tab.label;
            tabItem.appendChild(tabButton);
            
            // Create pane
            const tabPane = document.createElement('div');
            tabPane.className = `tab-pane fade ${tab.active ? 'show active' : ''}`;
            tabPane.id = `${tab.id}-pane-${container.id}`;
            tabPane.role = 'tabpanel';
            tabPane.setAttribute('aria-labelledby', `${tab.id}-tab-${container.id}`);
            tabContent.appendChild(tabPane);
            
            // Add placeholder content
            tabPane.innerHTML = `
                <div class="p-3">
                    <h5>${tab.label}</h5>
                    <div id="${tab.id}-content-${container.id}"></div>
                </div>
            `;
        }
        
        // Populate data if anndata is loaded
        if (dataManager.isDataLoaded()) {
            this._populateDataExplorer(container.id);
        }
        
        return container;
    }

    /**
     * Create a StringDB panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createStringDbPanel(container, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const stringDB = deps.stringDB;
        
        if (!stringDB) {
            console.error('StringDB dependency not found');
            return container;
        }
        
        // Create the panel header
        const header = document.createElement('div');
        header.className = 'panel-header';
        container.appendChild(header);
        
        // Add title
        const title = document.createElement('h5');
        title.className = 'mb-0';
        title.textContent = config.title || 'STRING-DB Integration';
        header.appendChild(title);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create the StringDB container
        const stringDbContainer = document.createElement('div');
        stringDbContainer.className = 'h-100 w-100';
        stringDbContainer.id = `string-db-${container.id}`;
        body.appendChild(stringDbContainer);
        
        // Show network if genes are provided
        if (config.genes && config.genes.length > 0) {
            this._displayStringDbNetwork(stringDbContainer.id, config.genes, config.speciesId);
        } else {
            // Create a placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="bi bi-diagram-3 fs-1 mb-3"></i>
                    <p>Select genes to see protein interaction network</p>
                </div>
            `;
            stringDbContainer.appendChild(placeholder);
        }
        
        return container;
    }

    /**
     * Create empty panel content with options to create different panel types
     * @param {HTMLElement} container - Container element
     * @private
     */
    _createEmptyPanelContent(container) {
        // Create content
        const content = document.createElement('div');
        content.className = 'd-flex justify-content-center align-items-center h-100';
        content.innerHTML = `
            <div class="text-center">
                <h5>Create Panel</h5>
                <div class="btn-group" role="group">
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="plot">
                        <i class="bi bi-graph-up"></i> Plot
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="table">
                        <i class="bi bi-table"></i> Table
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="gene-info">
                        <i class="bi bi-code-slash"></i> Gene Info
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="cell-info">
                        <i class="bi bi-circle"></i> Cell Info
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="data-explorer">
                        <i class="bi bi-search"></i> Explorer
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="string-db">
                        <i class="bi bi-diagram-3"></i> STRING-DB
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="matrix">
                        <i class="bi bi-grid-3x3"></i> Matrix
                    </button>
                </div>
            </div>
        `;
        container.appendChild(content);
        
        // Add event listeners
        const buttons = content.querySelectorAll('.create-panel');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const panelType = button.dataset.type;
                this.createPanel(container.id, panelType);
            });
        });
    }

    /**
     * Attach resize event to a grid container
     * @param {HTMLElement} resizer - The resizer element
     * @param {HTMLElement} gridContainer - The grid container to resize
     * @param {string} direction - Direction of the resizer ('horizontal' or 'vertical')
     * @private
     */
    _attachGridResizeEvent(resizer, gridContainer, direction) {
        let startPos, startGrid;
        
        const startResize = (e) => {
            e.preventDefault();
            if (direction === 'horizontal') {
                startPos = e.clientX;
                startGrid = gridContainer.style.gridTemplateColumns;
            } else {
                startPos = e.clientY;
                startGrid = gridContainer.style.gridTemplateRows;
            }
            
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
            document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
            resizer.classList.add('resizing');
        };
        
        const resize = (e) => {
            if (direction === 'horizontal') {
                // Horizontal resizing - update column widths
                const containerWidth = gridContainer.offsetWidth;
                const newPos = e.clientX;
                const delta = newPos - startPos;
                const percentage = (newPos / containerWidth) * 100;
                
                // Ensure minimum widths (10%)
                if (percentage > 10 && percentage < 90) {
                    gridContainer.style.gridTemplateColumns = `${percentage}% ${100 - percentage}%`;
                    resizer.style.left = `calc(${percentage}% - 5px)`;
                }
            } else {
                // Vertical resizing - update row heights
                const containerHeight = gridContainer.offsetHeight;
                const newPos = e.clientY;
                const delta = newPos - startPos;
                const percentage = (newPos / containerHeight) * 100;
                
                // Ensure minimum heights (10%)
                if (percentage > 10 && percentage < 90) {
                    gridContainer.style.gridTemplateRows = `${percentage}% ${100 - percentage}%`;
                    resizer.style.top = `calc(${percentage}% - 5px)`;
                }
            }
        };
        
        const stopResize = () => {
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = '';
            resizer.classList.remove('resizing');
            
            // Trigger a window resize event to update any internal components
            window.dispatchEvent(new Event('resize'));
        };
        
        resizer.addEventListener('mousedown', startResize);
    }

    /**
     * Initialize event handlers for UI elements
     * @private
     */
    _initEventHandlers() {
        // Layout selection
        document.addEventListener('click', event => {
            const layoutBtn = event.target.closest('[data-layout]');
            if (layoutBtn) {
                const layoutType = layoutBtn.dataset.layout;
                this.setLayout(layoutType);
            }
        });
        
        // Apply plot settings
        document.addEventListener('click', event => {
            if (event.target.id === 'applyVizSettings') {
                const modal = document.getElementById('vizSettingsModal');
                const targetPanel = modal.dataset.targetPanel;
                
                // Collect settings from the form
                const plotType = document.getElementById('plotType').value;
                const xAxis = document.getElementById('xAxis').value;
                const yAxis = document.getElementById('yAxis').value;
                const zAxis = document.getElementById('zAxis').value;
                const colorBy = document.getElementById('colorBy').value;
                const colorMin = document.getElementById('colorMin').value;
                const colorMax = document.getElementById('colorMax').value;
                const outOfRangeAction = document.querySelector('input[name="outOfRangeAction"]:checked').value;
                const showFocusedGene = document.getElementById('showFocusedGene').checked;
                const showFocusedCell = document.getElementById('showFocusedCell').checked;
                
                // Create settings object
                const settings = {
                    plotType,
                    xAxis,
                    yAxis,
                    zAxis: zAxis || null,
                    colorBy: colorBy || null,
                    colorMin: colorMin !== '' ? parseFloat(colorMin) : null,
                    colorMax: colorMax !== '' ? parseFloat(colorMax) : null,
                    outOfRangeAction,
                    showFocusedGene,
                    showFocusedCell
                };
                
                // Apply settings
                this._applyPlotSettings(targetPanel, settings);
                
                // Hide the modal
                $('#vizSettingsModal').modal('hide');
            }
        });
        
        // Data loaded event
        document.addEventListener('dataLoaded', () => {
            // Update the data status bar
            this._updateDataStatusBar();
            
            // Update plot settings options
            this._updatePlotSettingsOptions();
        });
        
        // Gene focus changed event
        document.addEventListener('focusChanged', event => {
            const focusType = event.detail.type;
            const focusValue = event.detail.value;
            const deps = getDependencies();
            const dataManager = deps.dataManager;
            
            if (focusType === 'gene') {
                // Update gene info panels
                this.panels.forEach((panel, panelId) => {
                    if (panel.type === 'gene-info') {
                        this.createPanel(panelId, 'gene-info', {
                            gene: focusValue,
                            speciesId: dataManager.getTaxonomyInfo().taxonomyId
                        });
                    }
                });
            } else if (focusType === 'cell') {
                // Update cell info panels
                this.panels.forEach((panel, panelId) => {
                    if (panel.type === 'cell-info') {
                        this.createPanel(panelId, 'cell-info', {
                            cell: focusValue
                        });
                    }
                });
            }
        });
    }

    /**
     * Update the data status bar with information about the loaded data
     * @private
     */
    _updateDataStatusBar() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const Utils = deps.Utils;
        
        if (!dataManager || !Utils) {
            console.error('Dependencies not found');
            return;
        }
        
        const statusBar = document.getElementById('dataStatusBar');
        const datasetName = document.getElementById('datasetName');
        const datasetStats = document.getElementById('datasetStats');
        const exploreBtn = document.getElementById('exploreDataBtn');
        
        // Check if status bar exists
        if (!statusBar) {
            console.warn('Status bar element not found');
            return;
        }
        
        if (dataManager.isDataLoaded()) {
            const info = dataManager.getBasicInfo();
            
            // Set dataset name if element exists
            if (datasetName) {
                datasetName.textContent = 'Dataset loaded';
            }
            
            // Set dataset stats if element exists
            if (datasetStats) {
                datasetStats.textContent = `(${Utils.formatNumber(info.nObs)} cells × ${Utils.formatNumber(info.nVars)} genes)`;
            }
            
            // Update explore button if it exists
            if (exploreBtn) {
                exploreBtn.disabled = false;
                
                // Add event listener to explore button if not already added
                if (!exploreBtn.dataset.listenerAdded) {
                    exploreBtn.addEventListener('click', () => {
                        // Show data explorer modal
                        $('#dataExplorerModal').modal('show');
                        
                        // Populate the data explorer
                        this._populateDataExplorer('dataExplorerModal');
                    });
                    
                    exploreBtn.dataset.listenerAdded = 'true';
                }
            }
            
            // Update status bar style
            statusBar.className = 'alert alert-success my-2';
        } else {
            // Reset status bar elements if they exist
            if (datasetName) {
                datasetName.textContent = 'No dataset loaded';
            }
            
            if (datasetStats) {
                datasetStats.textContent = '';
            }
            
            if (exploreBtn) {
                exploreBtn.disabled = true;
            }
            
            statusBar.className = 'alert alert-secondary my-2';
        }
    }

    /**
     * Populate the plot settings form
     * @param {Object} config - Current plot configuration
     * @private
     */
    _populatePlotSettingsForm(config) {
        // Set plot type
        const plotTypeSelect = document.getElementById('plotType');
        if (config.plotType) {
            plotTypeSelect.value = config.plotType;
        }
        
        // Update axis options
        this._updatePlotSettingsOptions();
        
        // Set axis values
        const xAxisSelect = document.getElementById('xAxis');
        const yAxisSelect = document.getElementById('yAxis');
        const zAxisSelect = document.getElementById('zAxis');
        const colorBySelect = document.getElementById('colorBy');
        
        if (config.xAxis) xAxisSelect.value = config.xAxis;
        if (config.yAxis) yAxisSelect.value = config.yAxis;
        if (config.zAxis) zAxisSelect.value = config.zAxis;
        if (config.colorBy) colorBySelect.value = config.colorBy;
        
        // Set color range values
        const colorMin = document.getElementById('colorMin');
        const colorMax = document.getElementById('colorMax');
        
        colorMin.value = config.colorMin !== undefined ? config.colorMin : '';
        colorMax.value = config.colorMax !== undefined ? config.colorMax : '';
        
        // Set out of range action
        if (config.outOfRangeAction) {
            document.getElementById(config.outOfRangeAction === 'clip' ? 'clipValues' : 'hideValues').checked = true;
        }
        
        // Set focus options
        document.getElementById('showFocusedGene').checked = config.showFocusedGene !== false;
        document.getElementById('showFocusedCell').checked = config.showFocusedCell !== false;
        
        // Show/hide color settings based on colorBy value
        const colorSettings = document.getElementById('colorSettings');
        colorSettings.style.display = config.colorBy ? 'block' : 'none';
        
        // Add change event to colorBy select
        colorBySelect.addEventListener('change', () => {
            colorSettings.style.display = colorBySelect.value ? 'block' : 'none';
        });
    }

    /**
     * Update the plot settings options based on the loaded data
     * @private
     */
    _updatePlotSettingsOptions() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager || !dataManager.isDataLoaded()) return;
        
        // Get data info
        const info = dataManager.getBasicInfo();
        
        // Get select elements
        const xAxisSelect = document.getElementById('xAxis');
        const yAxisSelect = document.getElementById('yAxis');
        const zAxisSelect = document.getElementById('zAxis');
        const colorBySelect = document.getElementById('colorBy');
        
        // Clear existing options
        xAxisSelect.innerHTML = '';
        yAxisSelect.innerHTML = '';
        zAxisSelect.innerHTML = '<option value="">None</option>';
        colorBySelect.innerHTML = '<option value="">None</option>';
        
        // Add obsm options
        const embeddings = info.embeddings || [];
        for (const embedding of embeddings) {
            // Get dimensions
            for (let i = 0; i < 5; i++) {
                const option = document.createElement('option');
                option.value = `obsm:${embedding}:${i}`;
                option.textContent = `${embedding.replace('X_', '')} ${i + 1}`;
                
                xAxisSelect.appendChild(option.cloneNode(true));
                yAxisSelect.appendChild(option.cloneNode(true));
                zAxisSelect.appendChild(option.cloneNode(true));
            }
        }
        
        // Add obs options
        const obsColumns = dataManager.getObsColumns() || [];
        for (const column of obsColumns) {
            const option = document.createElement('option');
            option.value = `obs:${column}`;
            option.textContent = `obs.${column}`;
            
            xAxisSelect.appendChild(option.cloneNode(true));
            yAxisSelect.appendChild(option.cloneNode(true));
            zAxisSelect.appendChild(option.cloneNode(true));
            colorBySelect.appendChild(option.cloneNode(true));
        }
        
        // Add obsp options (cell-cell matrices)
        const obspMatrices = info.obspMatrices || dataManager.getObspMatrices() || [];
        if (obspMatrices.length > 0) {
            // Add option group for obsp matrices
            const obspGroup = document.createElement('optgroup');
            obspGroup.label = 'Cell-Cell Matrices (.obsp)';
            
            // Get cell names (observe only for current focused cell)
            const focusedCell = dataManager.getFocusedCell();
            
            for (const matrixKey of obspMatrices) {
                // Option for the entire matrix with focused cell
                const optionFocused = document.createElement('option');
                optionFocused.value = `obsp:${matrixKey}:focused`;
                optionFocused.textContent = `obsp.${matrixKey} (focused cell)`;
                
                // Add to all selects
                xAxisSelect.appendChild(optionFocused.cloneNode(true));
                yAxisSelect.appendChild(optionFocused.cloneNode(true));
                zAxisSelect.appendChild(optionFocused.cloneNode(true));
                colorBySelect.appendChild(optionFocused.cloneNode(true));
            }
        }
        
        // Add varp options (gene-gene matrices)
        const varpMatrices = info.varpMatrices || dataManager.getVarpMatrices() || [];
        if (varpMatrices.length > 0) {
            // Add option group for varp matrices
            const varpGroup = document.createElement('optgroup');
            varpGroup.label = 'Gene-Gene Matrices (.varp)';
            
            // Get gene names (observe only for current focused gene)
            const focusedGene = dataManager.getFocusedGene();
            
            for (const matrixKey of varpMatrices) {
                // Option for the entire matrix with focused gene
                const optionFocused = document.createElement('option');
                optionFocused.value = `varp:${matrixKey}:focused`;
                optionFocused.textContent = `varp.${matrixKey} (focused gene)`;
                
                // Add to all selects
                xAxisSelect.appendChild(optionFocused.cloneNode(true));
                yAxisSelect.appendChild(optionFocused.cloneNode(true));
                zAxisSelect.appendChild(optionFocused.cloneNode(true));
                colorBySelect.appendChild(optionFocused.cloneNode(true));
            }
        }
        
        // Select first two options by default if not already set
        if (!xAxisSelect.value && xAxisSelect.options.length > 0) {
            xAxisSelect.selectedIndex = 0;
        }
        
        if (!yAxisSelect.value && yAxisSelect.options.length > 1) {
            yAxisSelect.selectedIndex = 1;
        }
    }

    /**
     * Apply plot settings to a panel
     * @param {string} panelId - ID of the panel
     * @param {Object} settings - Plot settings
     * @private
     */
    _applyPlotSettings(panelId, settings) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager || !dataManager.isDataLoaded()) return;
        
        // Get the panel
        const panel = this.panels.get(panelId);
        if (!panel) return;
        
        // Create a new config
        const newConfig = {
            ...panel.config,
            plotType: settings.plotType,
            xAxis: settings.xAxis,
            yAxis: settings.yAxis,
            zAxis: settings.zAxis,
            colorBy: settings.colorBy,
            title: `${settings.xAxis.split(':')[1]} vs ${settings.yAxis.split(':')[1]}`
        };
        
        // Create plot settings
        const plotSettings = {
            markerSize: 5,
            markerOpacity: 0.7,
            colorMin: settings.colorMin,
            colorMax: settings.colorMax,
            outOfRangeAction: settings.outOfRangeAction,
            showFocusedGene: settings.showFocusedGene,
            showFocusedCell: settings.showFocusedCell
        };
        
        // Load data for the plot
        this._loadPlotData(newConfig)
            .then(plotData => {
                // Update config with data and settings
                newConfig.data = plotData;
                newConfig.plotSettings = plotSettings;
                
                // Create the panel
                this.createPanel(panelId, 'plot', newConfig);
            })
            .catch(error => {
                console.error('Error loading plot data:', error);
            });
    }

    /**
     * Load data for a plot based on configuration
     * @param {Object} config - Plot configuration
     * @returns {Promise<Object>} Plot data
     * @private
     */
    async _loadPlotData(config) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) {
            throw new Error('DataManager dependency not found');
        }
        
        // Parse axis specifications
        const xAxisSpec = config.xAxis.split(':');
        const yAxisSpec = config.yAxis.split(':');
        const zAxisSpec = config.zAxis ? config.zAxis.split(':') : null;
        const colorBySpec = config.colorBy ? config.colorBy.split(':') : null;
        
        // Load data for each axis
        const xResult = await this._loadAxisData(xAxisSpec);
        const yResult = await this._loadAxisData(yAxisSpec);
        const zResult = zAxisSpec ? await this._loadAxisData(zAxisSpec) : [null, null];
        const colorResult = colorBySpec ? await this._loadAxisData(colorBySpec) : [null, null];
        
        // Extract data, labels, and optional text
        const [xData, xLabel, xText] = xResult.length >= 3 ? xResult : [...xResult, null];
        const [yData, yLabel, yText] = yResult.length >= 3 ? yResult : [...yResult, null];
        const [zData, zLabel, zText] = zResult.length >= 3 ? zResult : [...zResult, null];
        const [colorData, colorLabel, colorText] = colorResult.length >= 3 ? colorResult : [...colorResult, null];
        
        // Create plot data object
        const plotData = {
            x: xData,
            y: yData,
            z: zData,
            color: colorData,
            text: xText || yText || zText || colorText, // Use any available text for hover
            xLabel,
            yLabel,
            zLabel,
            colorLabel,
            title: `${xLabel} vs ${yLabel}`
        };
        
        // Add focused gene/cell if available
        const focusedGene = dataManager.getFocusedGene();
        const focusedCell = dataManager.getFocusedCell();
        
        if (focusedGene) {
            // Find the index of the focused gene in the data
            // This depends on the specific data structure and might need adaptation
            plotData.focusedGeneName = focusedGene;
            plotData.focusedGeneIndex = 0; // Placeholder, needs actual index
        }
        
        if (focusedCell) {
            // Find the index of the focused cell in the data
            // This depends on the specific data structure and might need adaptation
            plotData.focusedCellName = focusedCell;
            plotData.focusedCellIndex = 0; // Placeholder, needs actual index
        }
        
        return plotData;
    }

    /**
     * Load data for a specific axis
     * @param {Array<string>} axisSpec - Axis specification [source, key, index?]
     * @returns {Promise<Array>} [data, label]
     * @private
     */
    async _loadAxisData(axisSpec) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const matrixManager = deps.matrixManager;
        
        if (!dataManager) {
            throw new Error('DataManager dependency not found');
        }
        
        const source = axisSpec[0];
        const key = axisSpec[1];
        const param = axisSpec.length > 2 ? axisSpec[2] : null;
        
        // For obsm and other numerical indices
        let index = null;
        if (param && param !== 'focused' && !isNaN(parseInt(param))) {
            index = parseInt(param);
        }
        
        let data = null;
        let label = `${source}.${key}`;
        
        if (source === 'obsm') {
            // Load obsm data
            const obsm = await dataManager.loadObsm(key);
            
            if (obsm && index !== null) {
                // Extract the specific column
                data = Array.from(obsm).map(row => row[index]);
                label = `${key.replace('X_', '')} ${index + 1}`;
            }
        } else if (source === 'obs') {
            // Load obs data
            const obs = await dataManager.loadObs(key);
            
            if (obs) {
                data = Array.from(obs);
                label = `obs.${key}`;
            }
        } else if (source === 'obsp') {
            // Load obsp matrix data for either focused cell or index
            if (param === 'focused') {
                // Get the focused cell
                const focusedCell = dataManager.getFocusedCell();
                const focusedCellIndex = dataManager.findCellIndex(focusedCell);
                
                if (focusedCell && focusedCellIndex >= 0) {
                    try {
                        // Get row for focused cell from the matrix
                        const matrix = await matrixManager.getObspMatrix(key, [focusedCellIndex]);
                        if (matrix && matrix.length > 0) {
                            // Use just the first row for plotting (focused cell)
                            data = matrix[0];
                            label = `obsp.${key} (${focusedCell})`;
                            
                            // Get cell names for the plot
                            const cellNames = await dataManager.getObsNames();
                            // Create text labels for hover
                            const text = data.map((value, idx) => 
                                `${focusedCell} → ${cellNames[idx]}: ${value.toFixed(3)}`);
                                
                            // Add to returned data for use in plotting
                            return [data, label, text];
                        }
                    } catch (error) {
                        console.error(`Error loading obsp matrix ${key} for focused cell:`, error);
                    }
                }
            }
        } else if (source === 'varp') {
            // Load varp matrix data for either focused gene or index
            if (param === 'focused') {
                // Get the focused gene
                const focusedGene = dataManager.getFocusedGene();
                const focusedGeneIndex = dataManager.findGeneIndex(focusedGene);
                
                if (focusedGene && focusedGeneIndex >= 0) {
                    try {
                        // Get row for focused gene from the matrix
                        const matrix = await matrixManager.getVarpMatrix(key, [focusedGeneIndex]);
                        if (matrix && matrix.length > 0) {
                            // Use just the first row for plotting (focused gene)
                            data = matrix[0];
                            label = `varp.${key} (${focusedGene})`;
                            
                            // Get gene names for the plot
                            const geneNames = await dataManager.getVarNames();
                            // Create text labels for hover
                            const text = data.map((value, idx) => 
                                `${focusedGene} → ${geneNames[idx]}: ${value.toFixed(3)}`);
                                
                            // Add to returned data for use in plotting
                            return [data, label, text];
                        }
                    } catch (error) {
                        console.error(`Error loading varp matrix ${key} for focused gene:`, error);
                    }
                }
            }
        }
        
        return [data, label];
    }

    /**
     * Show a modal for selecting columns to display in a table
     * @param {string} panelId - ID of the panel
     * @param {Object} config - Current table configuration
     * @private
     */
    _showColumnsSelectionModal(panelId, config) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;

        if (!dataManager || !dataManager.isDataLoaded()) {
            return;
        }

        // Create modal if it doesn't exist
        let modal = document.getElementById('columnsSelectionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.id = 'columnsSelectionModal';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-labelledby', 'columnsSelectionModalLabel');
            modal.setAttribute('aria-hidden', 'true');

            // Add modal HTML structure
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="columnsSelectionModalLabel">Select Columns</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-4">
                                    <!-- Source selection tabs -->
                                    <div class="nav flex-column nav-pills" id="data-source-tabs" role="tablist">
                                        <button class="nav-link active" id="obs-tab" data-bs-toggle="pill" data-bs-target="#obs-content" type="button">Cell Annotations (.obs)</button>
                                        <button class="nav-link" id="var-tab" data-bs-toggle="pill" data-bs-target="#var-content" type="button">Gene Annotations (.var)</button>
                                        <button class="nav-link" id="obsm-tab" data-bs-toggle="pill" data-bs-target="#obsm-content" type="button">Cell Matrices (.obsm)</button>
                                        <button class="nav-link" id="varm-tab" data-bs-toggle="pill" data-bs-target="#varm-content" type="button">Gene Matrices (.varm)</button>
                                        <button class="nav-link" id="obsp-tab" data-bs-toggle="pill" data-bs-target="#obsp-content" type="button">Cell-Cell Relations (.obsp)</button>
                                        <button class="nav-link" id="varp-tab" data-bs-toggle="pill" data-bs-target="#varp-content" type="button">Gene-Gene Relations (.varp)</button>
                                        <button class="nav-link" id="layers-tab" data-bs-toggle="pill" data-bs-target="#layers-content" type="button">Layers</button>
                                    </div>
                                </div>
                                <div class="col-md-8">
                                    <!-- Tab content -->
                                    <div class="tab-content" id="data-source-content">
                                        <div class="tab-pane fade show active" id="obs-content" role="tabpanel">
                                            <div class="list-group" id="obs-columns-list"></div>
                                        </div>
                                        <div class="tab-pane fade" id="var-content" role="tabpanel">
                                            <div class="list-group" id="var-columns-list"></div>
                                        </div>
                                        <div class="tab-pane fade" id="obsm-content" role="tabpanel">
                                            <div id="obsm-selector">
                                                <div class="form-group mb-3">
                                                    <label for="obsm-key-select">Select Matrix:</label>
                                                    <select class="form-select" id="obsm-key-select"></select>
                                                </div>
                                                <div class="list-group" id="obsm-columns-list"></div>
                                            </div>
                                        </div>
                                        <div class="tab-pane fade" id="varm-content" role="tabpanel">
                                            <div id="varm-selector">
                                                <div class="form-group mb-3">
                                                    <label for="varm-key-select">Select Matrix:</label>
                                                    <select class="form-select" id="varm-key-select"></select>
                                                </div>
                                                <div class="list-group" id="varm-columns-list"></div>
                                            </div>
                                        </div>
                                        <div class="tab-pane fade" id="obsp-content" role="tabpanel">
                                            <div id="obsp-selector">
                                                <div class="form-group mb-3">
                                                    <label for="obsp-key-select">Select Cell-Cell Matrix:</label>
                                                    <select class="form-select" id="obsp-key-select"></select>
                                                </div>
                                                <div class="mb-3">
                                                    <div class="form-check">
                                                        <input class="form-check-input" type="radio" name="obspCellType" id="obspFocusedCell" value="focused" checked>
                                                        <label class="form-check-label" for="obspFocusedCell">
                                                            Use focused cell
                                                        </label>
                                                    </div>
                                                    <div class="form-check">
                                                        <input class="form-check-input" type="radio" name="obspCellType" id="obspSpecificCell" value="specific">
                                                        <label class="form-check-label" for="obspSpecificCell">
                                                            Select specific cell:
                                                        </label>
                                                    </div>
                                                    <select class="form-select mt-2" id="obsp-cell-select" disabled></select>
                                                </div>
                                                <div class="list-group" id="obsp-columns-list"></div>
                                            </div>
                                        </div>
                                        <div class="tab-pane fade" id="varp-content" role="tabpanel">
                                            <div id="varp-selector">
                                                <div class="form-group mb-3">
                                                    <label for="varp-key-select">Select Gene-Gene Matrix:</label>
                                                    <select class="form-select" id="varp-key-select"></select>
                                                </div>
                                                <div class="mb-3">
                                                    <div class="form-check">
                                                        <input class="form-check-input" type="radio" name="varpGeneType" id="varpFocusedGene" value="focused" checked>
                                                        <label class="form-check-label" for="varpFocusedGene">
                                                            Use focused gene
                                                        </label>
                                                    </div>
                                                    <div class="form-check">
                                                        <input class="form-check-input" type="radio" name="varpGeneType" id="varpSpecificGene" value="specific">
                                                        <label class="form-check-label" for="varpSpecificGene">
                                                            Select specific gene:
                                                        </label>
                                                    </div>
                                                    <select class="form-select mt-2" id="varp-gene-select" disabled></select>
                                                </div>
                                                <div class="list-group" id="varp-columns-list"></div>
                                            </div>
                                        </div>
                                        <div class="tab-pane fade" id="layers-content" role="tabpanel">
                                            <div class="list-group" id="layers-list"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="apply-columns-btn">Apply</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Initialize event handlers
            const applyBtn = document.getElementById('apply-columns-btn');
            applyBtn.addEventListener('click', () => this._applyColumnSelection(panelId, config));

            // Handle .obsm key selection changes
            const obsmKeySelect = document.getElementById('obsm-key-select');
            obsmKeySelect.addEventListener('change', () => this._populateObsmColumns(obsmKeySelect.value));

            // Handle .varm key selection changes
            const varmKeySelect = document.getElementById('varm-key-select');
            varmKeySelect.addEventListener('change', () => this._populateVarmColumns(varmKeySelect.value));
        }

        // Store target panel ID in the modal
        modal.dataset.targetPanel = panelId;

        // Populate data sources
        this._populateColumnSelectionData(config);

        // Show the modal
        const modalInstance = new bootstrap.Modal(modal);
        modalInstance.show();
    }

    /**
     * Populate column selection modal with available data sources
     * @param {Object} config - Current panel configuration
     * @private
     */
    _populateColumnSelectionData(config) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;

        if (!dataManager || !dataManager.isDataLoaded()) {
            return;
        }

        // Get available data
        const info = dataManager.getBasicInfo();

        // Populate .obs columns
        const obsColumnsList = document.getElementById('obs-columns-list');
        obsColumnsList.innerHTML = '';
        
        for (const column of info.obs_columns || []) {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action';
            item.setAttribute('href', '#');
            item.setAttribute('data-column', `obs:${column}`);
            item.innerHTML = `<i class="bi bi-table"></i> ${column}`;
            obsColumnsList.appendChild(item);
        }

        // Populate .var columns
        const varColumnsList = document.getElementById('var-columns-list');
        varColumnsList.innerHTML = '';
        
        for (const column of info.var_columns || []) {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action';
            item.setAttribute('href', '#');
            item.setAttribute('data-column', `var:${column}`);
            item.innerHTML = `<i class="bi bi-table"></i> ${column}`;
            varColumnsList.appendChild(item);
        }

        // Populate .obsm keys
        const obsmKeySelect = document.getElementById('obsm-key-select');
        obsmKeySelect.innerHTML = '';
        
        for (const key of info.embeddings || []) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            obsmKeySelect.appendChild(option);
        }

        // Populate .varm keys
        const varmKeySelect = document.getElementById('varm-key-select');
        varmKeySelect.innerHTML = '';
        
        if (info.has_varm && info.metadata && info.metadata.varm && info.metadata.varm.keys) {
            for (const key of info.metadata.varm.keys) {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = key;
                varmKeySelect.appendChild(option);
            }
        }

        // Populate initial obsm columns if available
        if (obsmKeySelect.options.length > 0) {
            this._populateObsmColumns(obsmKeySelect.value);
        }

        // Populate initial varm columns if available
        if (varmKeySelect.options.length > 0) {
            this._populateVarmColumns(varmKeySelect.value);
        }
        
        // Populate .obsp matrices
        const obspKeySelect = document.getElementById('obsp-key-select');
        obspKeySelect.innerHTML = '';
        
        const obspMatrices = info.obspMatrices || dataManager.getObspMatrices() || [];
        for (const matrix of obspMatrices) {
            const option = document.createElement('option');
            option.value = matrix;
            option.textContent = matrix;
            obspKeySelect.appendChild(option);
        }
        
        // Set up event handlers for obsp
        if (obspKeySelect.options.length > 0) {
            // Cell selector radio buttons
            const obspFocusedRadio = document.getElementById('obspFocusedCell');
            const obspSpecificRadio = document.getElementById('obspSpecificCell');
            const obspCellSelect = document.getElementById('obsp-cell-select');
            
            // Toggle cell selector based on radio selection
            obspFocusedRadio.addEventListener('change', () => {
                obspCellSelect.disabled = obspFocusedRadio.checked;
            });
            
            obspSpecificRadio.addEventListener('change', () => {
                obspCellSelect.disabled = !obspSpecificRadio.checked;
                
                // Populate cell selector if needed
                if (obspSpecificRadio.checked && obspCellSelect.options.length === 0) {
                    this._populateObspCellSelect();
                }
            });
            
            // Initial population of obsp columns
            this._populateObspColumns(obspKeySelect.value);
        }
        
        // Populate .varp matrices
        const varpKeySelect = document.getElementById('varp-key-select');
        varpKeySelect.innerHTML = '';
        
        const varpMatrices = info.varpMatrices || dataManager.getVarpMatrices() || [];
        for (const matrix of varpMatrices) {
            const option = document.createElement('option');
            option.value = matrix;
            option.textContent = matrix;
            varpKeySelect.appendChild(option);
        }
        
        // Set up event handlers for varp
        if (varpKeySelect.options.length > 0) {
            // Gene selector radio buttons
            const varpFocusedRadio = document.getElementById('varpFocusedGene');
            const varpSpecificRadio = document.getElementById('varpSpecificGene');
            const varpGeneSelect = document.getElementById('varp-gene-select');
            
            // Toggle gene selector based on radio selection
            varpFocusedRadio.addEventListener('change', () => {
                varpGeneSelect.disabled = varpFocusedRadio.checked;
            });
            
            varpSpecificRadio.addEventListener('change', () => {
                varpGeneSelect.disabled = !varpSpecificRadio.checked;
                
                // Populate gene selector if needed
                if (varpSpecificRadio.checked && varpGeneSelect.options.length === 0) {
                    this._populateVarpGeneSelect();
                }
            });
            
            // Initial population of varp columns
            this._populateVarpColumns(varpKeySelect.value);
        }

        // Populate layers
        const layersList = document.getElementById('layers-list');
        layersList.innerHTML = '';
        
        for (const layer of info.layers || []) {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action';
            item.setAttribute('href', '#');
            item.setAttribute('data-layer', layer);
            item.innerHTML = `<i class="bi bi-layers"></i> ${layer}`;
            layersList.appendChild(item);
        }
    }

    /**
     * Populate obsm columns based on selected key
     * @param {string} obsmKey - Selected obsm key
     * @private
     */
    _populateObsmColumns(obsmKey) {
        const obsmColumnsList = document.getElementById('obsm-columns-list');
        obsmColumnsList.innerHTML = '';

        // Get sample data to determine dimensions
        const deps = getDependencies();
        const dataManager = deps.dataManager;

        if (!dataManager || !obsmKey) return;

        // Load a sample to get dimensions
        dataManager.loadObsm(obsmKey, [0]).then(sample => {
            if (!sample || !sample.length) return;

            const dimensions = sample[0].length;
            
            // Create a list item for each dimension
            for (let i = 0; i < dimensions; i++) {
                const item = document.createElement('a');
                item.className = 'list-group-item list-group-item-action';
                item.setAttribute('href', '#');
                item.setAttribute('data-column', `obsm:${obsmKey}:${i}`);
                item.innerHTML = `<i class="bi bi-graph-up"></i> ${obsmKey} Dimension ${i+1}`;
                obsmColumnsList.appendChild(item);
            }
        }).catch(err => {
            console.error(`Error getting obsm dimensions for ${obsmKey}:`, err);
        });
    }

    /**
     * Populate varm columns based on selected key
     * @param {string} varmKey - Selected varm key
     * @private
     */
    _populateVarmColumns(varmKey) {
        const varmColumnsList = document.getElementById('varm-columns-list');
        varmColumnsList.innerHTML = '';

        // Get sample data to determine dimensions
        const deps = getDependencies();
        const dataManager = deps.dataManager;

        if (!dataManager || !varmKey) return;

        // Load a sample to get dimensions
        dataManager.loadVarm(varmKey, [0]).then(sample => {
            if (!sample || !sample.length) return;

            const dimensions = sample[0].length;
            
            // Create a list item for each dimension
            for (let i = 0; i < dimensions; i++) {
                const item = document.createElement('a');
                item.className = 'list-group-item list-group-item-action';
                item.setAttribute('href', '#');
                item.setAttribute('data-column', `varm:${varmKey}:${i}`);
                item.innerHTML = `<i class="bi bi-graph-up"></i> ${varmKey} Dimension ${i+1}`;
                varmColumnsList.appendChild(item);
            }
        }).catch(err => {
            console.error(`Error getting varm dimensions for ${varmKey}:`, err);
        });
    }

    /**
     * Populate obsp cell selector dropdown
     * @private
     */
    _populateObspCellSelect() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) return;
        
        // Get cell selector
        const cellSelect = document.getElementById('obsp-cell-select');
        cellSelect.innerHTML = '';
        
        // Get cell names
        dataManager.getObsNames().then(cellNames => {
            if (!cellNames || !cellNames.length) return;
            
            // Populate select with cell names
            for (let i = 0; i < cellNames.length; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = cellNames[i];
                cellSelect.appendChild(option);
            }
        }).catch(err => {
            console.error('Error getting cell names:', err);
        });
    }
    
    /**
     * Populate obsp columns for the selected key
     * @param {string} obspKey - The obsp matrix key
     * @private
     */
    _populateObspColumns(obspKey) {
        const obspColumnsList = document.getElementById('obsp-columns-list');
        obspColumnsList.innerHTML = '';
        
        if (!obspKey) return;
        
        // Create data item for focused cell option
        const focusedItem = document.createElement('a');
        focusedItem.className = 'list-group-item list-group-item-action';
        focusedItem.setAttribute('href', '#');
        focusedItem.setAttribute('data-column', `obsp:${obspKey}:focused`);
        focusedItem.innerHTML = `<i class="bi bi-grid-3x3"></i> ${obspKey} (focused cell)`;
        obspColumnsList.appendChild(focusedItem);
    }
    
    /**
     * Populate varp gene selector dropdown
     * @private
     */
    _populateVarpGeneSelect() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) return;
        
        // Get gene selector
        const geneSelect = document.getElementById('varp-gene-select');
        geneSelect.innerHTML = '';
        
        // Get gene names
        dataManager.getVarNames().then(geneNames => {
            if (!geneNames || !geneNames.length) return;
            
            // Populate select with gene names
            for (let i = 0; i < geneNames.length; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = geneNames[i];
                geneSelect.appendChild(option);
            }
        }).catch(err => {
            console.error('Error getting gene names:', err);
        });
    }
    
    /**
     * Populate varp columns for the selected key
     * @param {string} varpKey - The varp matrix key
     * @private
     */
    _populateVarpColumns(varpKey) {
        const varpColumnsList = document.getElementById('varp-columns-list');
        varpColumnsList.innerHTML = '';
        
        if (!varpKey) return;
        
        // Create data item for focused gene option
        const focusedItem = document.createElement('a');
        focusedItem.className = 'list-group-item list-group-item-action';
        focusedItem.setAttribute('href', '#');
        focusedItem.setAttribute('data-column', `varp:${varpKey}:focused`);
        focusedItem.innerHTML = `<i class="bi bi-grid-3x3"></i> ${varpKey} (focused gene)`;
        varpColumnsList.appendChild(focusedItem);
    }
    
    /**
     * Set up listeners for focus changes to update visualizations
     * @private
     */
    _setupFocusChangeHandlers() {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) return;
        
        // Add event listener for focus changes
        dataManager.addEventListener('focusChanged', (event) => {
            // When focus changes, update all panels that might be affected
            if (event.type === 'cell' || event.type === 'gene') {
                this._updatePanelsOnFocusChange(event);
            }
        });
    }
    
    /**
     * Update panels when focused cell or gene changes
     * @param {Object} focusEvent - Focus change event
     * @private
     */
    _updatePanelsOnFocusChange(focusEvent) {
        // Iterate through all panels
        for (const [panelId, panel] of this.panels.entries()) {
            // For plot panels, check if they use obsp or varp data with 'focused'
            if (panel.type === 'plot' && panel.config) {
                let needsUpdate = false;
                
                // Check axis specs for obsp or varp with focused option
                const checkSpec = (spec) => {
                    if (!spec) return false;
                    const parts = spec.split(':');
                    if (parts.length < 3) return false;
                    
                    const [source, key, param] = parts;
                    
                    // Check if using focused cell and cell focus changed
                    if (source === 'obsp' && param === 'focused' && focusEvent.type === 'cell') {
                        return true;
                    }
                    
                    // Check if using focused gene and gene focus changed
                    if (source === 'varp' && param === 'focused' && focusEvent.type === 'gene') {
                        return true;
                    }
                    
                    return false;
                };
                
                // Check all axes and color
                if (checkSpec(panel.config.xAxis) || 
                    checkSpec(panel.config.yAxis) || 
                    checkSpec(panel.config.zAxis) || 
                    checkSpec(panel.config.colorBy)) {
                    needsUpdate = true;
                }
                
                // Update the panel if needed
                if (needsUpdate) {
                    console.log(`Updating panel ${panelId} due to focus change: ${focusEvent.type}`);
                    
                    // Re-apply the plot settings to update the visualization
                    this._applyPlotSettings(panelId, panel.config);
                }
            }
        }
    }
    
    /**
     * Apply column selection to the panel
     * @param {string} panelId - Target panel ID
     * @param {Object} config - Current panel configuration
     * @private
     */
    _applyColumnSelection(panelId, config) {
        // Get selected columns
        const selectedItems = document.querySelectorAll('.list-group-item.active');
        const columns = Array.from(selectedItems).map(item => {
            if (item.dataset.column) {
                return item.dataset.column;
            } else if (item.dataset.layer) {
                return `layer:${item.dataset.layer}`;
            }
            return null;
        }).filter(Boolean);

        // Update panel with selected columns
        const panel = this.panels.get(panelId);
        if (panel && columns.length > 0) {
            const newConfig = {
                ...panel.config,
                columns: columns
            };
            
            // Create a new panel with the updated config
            this.createPanel(panelId, 'table', newConfig);
        }

        // Close the modal
        const modal = document.getElementById('columnsSelectionModal');
        const modalInstance = bootstrap.Modal.getInstance(modal);
        if (modalInstance) {
            modalInstance.hide();
        }
    }

    /**
     * Display gene information
     * @param {string} containerId - ID of the container element
     * @param {string} gene - Gene symbol or name
     * @param {number} speciesId - NCBI taxonomy ID
     * @private
     */
    _displayGeneInfo(containerId, gene, speciesId = 9606) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const stringDB = deps.stringDB;
        const plotManager = deps.plotManager;
        
        if (!dataManager || !stringDB || !plotManager) {
            console.error('Dependencies not found');
            return;
        }
        
        // Get the container element
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Clear the container
        container.innerHTML = '';
        
        // Create the gene info structure
        const geneInfoContainer = document.createElement('div');
        geneInfoContainer.className = 'p-3';
        container.appendChild(geneInfoContainer);
        
        // Add gene header
        const geneHeader = document.createElement('div');
        geneHeader.className = 'd-flex justify-content-between align-items-center mb-3';
        geneHeader.innerHTML = `
            <h3>${gene}</h3>
            <button class="btn btn-sm btn-outline-primary set-focus-gene" data-gene="${gene}">
                <i class="fas fa-crosshairs"></i> Set as Focused Gene
            </button>
        `;
        geneInfoContainer.appendChild(geneHeader);
        
        // Add gene expression plot (placeholder)
        const genePlot = document.createElement('div');
        genePlot.className = 'mb-3';
        genePlot.innerHTML = `
            <h5>Expression Across Conditions</h5>
            <div id="gene-plot-${containerId}" style="height: 300px;"></div>
        `;
        geneInfoContainer.appendChild(genePlot);
        
        // Add StringDB resources
        const resourcesContainer = document.createElement('div');
        resourcesContainer.innerHTML = stringDB.createResourcePanel(gene, speciesId);
        geneInfoContainer.appendChild(resourcesContainer);
        
        // Add event listener to set focus gene button
        container.querySelector('.set-focus-gene').addEventListener('click', () => {
            dataManager.setFocusedGene(gene);
        });
        
        // Load gene expression data and create a plot
        this._loadGeneExpressionData(gene)
            .then(data => {
                if (data) {
                    const plotContainer = document.getElementById(`gene-plot-${containerId}`);
                    plotManager.createPlot(
                        plotContainer.id,
                        'violin',
                        {
                            groups: data.groups,
                            values: data.values,
                            xLabel: 'Condition',
                            yLabel: 'Expression',
                            title: `${gene} Expression`
                        },
                        {
                            showPoints: true,
                            pointsOpacity: 0.3
                        }
                    );
                }
            })
            .catch(error => {
                console.error('Error loading gene expression data:', error);
            });
    }

    /**
     * Load gene expression data
     * @param {string} gene - Gene symbol
     * @returns {Promise<Object>} Gene expression data
     * @private
     */
    async _loadGeneExpressionData(gene) {
        // This is a placeholder that would need to be implemented based on the actual data structure
        // In a real implementation, this would load expression data for the gene across different conditions
        
        // Mock data for demonstration
        return {
            groups: ['Condition A', 'Condition B', 'Condition C'],
            values: [
                ...Array(50).fill('Condition A'),
                ...Array(50).fill('Condition B'),
                ...Array(50).fill('Condition C')
            ],
            expression: [
                ...Array.from({ length: 50 }, () => Math.random() * 2 + 1),
                ...Array.from({ length: 50 }, () => Math.random() * 2 + 2),
                ...Array.from({ length: 50 }, () => Math.random() * 2 + 3)
            ]
        };
    }

    /**
     * Display cell information
     * @param {string} containerId - ID of the container element
     * @param {string} cell - Cell ID
     * @private
     */
    _displayCellInfo(containerId, cell) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        
        if (!dataManager) {
            console.error('DataManager dependency not found');
            return;
        }
        
        // Get the container element
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Clear the container
        container.innerHTML = '';
        
        // Create the cell info structure
        const cellInfoContainer = document.createElement('div');
        cellInfoContainer.className = 'p-3';
        container.appendChild(cellInfoContainer);
        
        // Add cell header
        const cellHeader = document.createElement('div');
        cellHeader.className = 'd-flex justify-content-between align-items-center mb-3';
        cellHeader.innerHTML = `
            <h3>Cell: ${cell}</h3>
            <button class="btn btn-sm btn-outline-primary set-focus-cell" data-cell="${cell}">
                <i class="fas fa-crosshairs"></i> Set as Focused Cell
            </button>
        `;
        cellInfoContainer.appendChild(cellHeader);
        
        // Add cell attributes (placeholder)
        const cellAttributes = document.createElement('div');
        cellAttributes.className = 'mb-3';
        cellAttributes.innerHTML = `
            <h5>Cell Attributes</h5>
            <div id="cell-attrs-${containerId}">
                <p>Loading cell attributes...</p>
            </div>
        `;
        cellInfoContainer.appendChild(cellAttributes);
        
        // Add gene expression in this cell (placeholder)
        const geneExpression = document.createElement('div');
        geneExpression.className = 'mb-3';
        geneExpression.innerHTML = `
            <h5>Top Expressed Genes</h5>
            <div id="cell-genes-${containerId}">
                <p>Loading gene expression data...</p>
            </div>
        `;
        cellInfoContainer.appendChild(geneExpression);
        
        // Add event listener to set focus cell button
        container.querySelector('.set-focus-cell').addEventListener('click', () => {
            dataManager.setFocusedCell(cell);
        });
        
        // Load cell attributes
        this._loadCellAttributes(cell)
            .then(attributes => {
                if (attributes) {
                    const attrsContainer = document.getElementById(`cell-attrs-${containerId}`);
                    attrsContainer.innerHTML = '';
                    
                    // Create a table for attributes
                    const table = document.createElement('table');
                    table.className = 'table table-striped';
                    table.innerHTML = `
                        <thead>
                            <tr>
                                <th>Attribute</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(attributes)
                                .map(([key, value]) => `
                                    <tr>
                                        <td>${key}</td>
                                        <td>${value}</td>
                                    </tr>
                                `)
                                .join('')}
                        </tbody>
                    `;
                    attrsContainer.appendChild(table);
                }
            })
            .catch(error => {
                console.error('Error loading cell attributes:', error);
            });
        
        // Load cell gene expression
        this._loadCellGeneExpression(cell)
            .then(genes => {
                if (genes) {
                    const genesContainer = document.getElementById(`cell-genes-${containerId}`);
                    genesContainer.innerHTML = '';
                    
                    // Create a table for genes
                    const table = document.createElement('table');
                    table.className = 'table table-striped';
                    table.innerHTML = `
                        <thead>
                            <tr>
                                <th>Gene</th>
                                <th>Expression</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${genes.map(gene => `
                                <tr>
                                    <td>${gene.name}</td>
                                    <td>${gene.expression.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    `;
                    genesContainer.appendChild(table);
                }
            })
            .catch(error => {
                console.error('Error loading cell gene expression:', error);
            });
    }

    /**
     * Load cell attributes
     * @param {string} cell - Cell ID
     * @returns {Promise<Object>} Cell attributes
     * @private
     */
    async _loadCellAttributes(cell) {
        // This is a placeholder that would need to be implemented based on the actual data structure
        // In a real implementation, this would load attributes for the cell from obs
        
        // Mock data for demonstration
        return {
            'Cell Type': 'Type A',
            'Cluster': 'Cluster 1',
            'Total Counts': '1234',
            'QC Metric': 'Passed'
        };
    }

    /**
     * Load cell gene expression
     * @param {string} cell - Cell ID
     * @returns {Promise<Array>} Top expressed genes
     * @private
     */
    async _loadCellGeneExpression(cell) {
        // This is a placeholder that would need to be implemented based on the actual data structure
        // In a real implementation, this would load the expression values for top genes in this cell
        
        // Mock data for demonstration
        return [
            { name: 'Gene A', expression: 5.2 },
            { name: 'Gene B', expression: 4.8 },
            { name: 'Gene C', expression: 3.9 },
            { name: 'Gene D', expression: 3.7 },
            { name: 'Gene E', expression: 3.5 }
        ];
    }

    /**
     * Display StringDB network
     * @param {string} containerId - ID of the container element
     * @param {Array<string>} genes - Gene symbols
     * @param {number} speciesId - NCBI taxonomy ID
     * @private
     */
    _displayStringDbNetwork(containerId, genes, speciesId = 9606) {
        const deps = getDependencies();
        const stringDB = deps.stringDB;
        
        if (!stringDB) {
            console.error('StringDB dependency not found');
            return;
        }
        
        // Get the container element
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Clear the container
        container.innerHTML = '';
        
        // Create network container
        const networkContainer = document.createElement('div');
        networkContainer.className = 'p-3';
        container.appendChild(networkContainer);
        
        // Add network panel
        networkContainer.innerHTML = stringDB.createNetworkPanel(genes, speciesId);
        
        // Add enrichment analysis (if there are enough genes)
        if (genes.length >= 3) {
            const loadingMessage = document.createElement('div');
            loadingMessage.className = 'alert alert-info';
            loadingMessage.textContent = 'Loading enrichment analysis...';
            networkContainer.appendChild(loadingMessage);
            
            // Fetch enrichment data
            stringDB.fetchEnrichment(genes, speciesId)
                .then(enrichmentData => {
                    // Remove loading message
                    loadingMessage.remove();
                    
                    // Add enrichment panel
                    if (enrichmentData && enrichmentData.length > 0) {
                        const enrichmentPanel = document.createElement('div');
                        enrichmentPanel.innerHTML = stringDB.createEnrichmentPanel(
                            enrichmentData,
                            'GO Biological Processes'
                        );
                        networkContainer.appendChild(enrichmentPanel);
                    } else {
                        const noDataMessage = document.createElement('div');
                        noDataMessage.className = 'alert alert-warning';
                        noDataMessage.textContent = 'No enrichment data found for these genes.';
                        networkContainer.appendChild(noDataMessage);
                    }
                })
                .catch(error => {
                    console.error('Error fetching enrichment data:', error);
                    loadingMessage.className = 'alert alert-danger';
                    loadingMessage.textContent = 'Error loading enrichment analysis: ' + error.message;
                });
        }
    }

    /**
     * Populate the data explorer
     * @param {string} containerId - ID of the container element
     * @private
     */
    _populateDataExplorer(containerId) {
        const deps = getDependencies();
        const dataManager = deps.dataManager;
        const Utils = deps.Utils;
        
        if (!dataManager || !Utils || !dataManager.isDataLoaded()) return;
        
        // Get basic info
        const info = dataManager.getBasicInfo();
        
        // Populate overview
        const overviewContent = document.getElementById(`overview-content-${containerId}`);
        if (overviewContent) {
            overviewContent.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <h5 class="card-title">Dataset Overview</h5>
                        <p><strong>Cells:</strong> ${Utils.formatNumber(info.nObs)}</p>
                        <p><strong>Genes:</strong> ${Utils.formatNumber(info.nVars)}</p>
                        <p><strong>Embeddings:</strong> ${info.embeddings.join(', ') || 'None'}</p>
                        <p><strong>Layers:</strong> ${info.layerNames.join(', ') || 'None'}</p>
                        <p><strong>Cell-Cell Matrices:</strong> ${info.obspMatrices?.join(', ') || 'None'}</p>
                        <p><strong>Gene-Gene Matrices:</strong> ${info.varpMatrices?.join(', ') || 'None'}</p>
                    </div>
                </div>
            `;
        }
        
        // Ideally, other tabs would be populated with similar data-driven content
    }
    
    /**
     * Create a Matrix Visualization panel for obsp and varp matrices
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {Object} Panel object
     */
    createMatrixPanel(panelId, config = {}) {
        // Get dependencies
        const deps = getDependencies();
        const { dataManager, matrixManager, plotManager } = deps;
        
        // Default config
        config = {
            title: 'Matrix Visualization',
            matrixType: null, // 'obsp' or 'varp'
            matrixKey: null,
            colorScale: 'viridis',
            showLabels: true,
            sampleSize: 100,
            ...config
        };
        
        // Create panel
        const panel = document.createElement('div');
        panel.className = 'matrix-panel w-100 h-100 pb-2';
        panel.innerHTML = `
            <div class="panel-toolbar d-flex justify-content-between mb-2">
                <div class="d-flex">
                    <select class="form-select form-select-sm me-1 matrix-type-select" style="max-width: 120px;">
                        <option value="">Matrix Type</option>
                        <option value="obsp" ${config.matrixType === 'obsp' ? 'selected' : ''}>Cell-Cell</option>
                        <option value="varp" ${config.matrixType === 'varp' ? 'selected' : ''}>Gene-Gene</option>
                    </select>
                    <select class="form-select form-select-sm me-1 matrix-key-select" style="max-width: 150px;">
                        <option value="">Select Matrix</option>
                    </select>
                </div>
                <div class="d-flex">
                    <select class="form-select form-select-sm me-1 color-scale-select" style="max-width: 100px;">
                        <option value="viridis" ${config.colorScale === 'viridis' ? 'selected' : ''}>Viridis</option>
                        <option value="plasma" ${config.colorScale === 'plasma' ? 'selected' : ''}>Plasma</option>
                        <option value="inferno" ${config.colorScale === 'inferno' ? 'selected' : ''}>Inferno</option>
                        <option value="magma" ${config.colorScale === 'magma' ? 'selected' : ''}>Magma</option>
                        <option value="Reds" ${config.colorScale === 'Reds' ? 'selected' : ''}>Reds</option>
                        <option value="Blues" ${config.colorScale === 'Blues' ? 'selected' : ''}>Blues</option>
                        <option value="RdBu" ${config.colorScale === 'RdBu' ? 'selected' : ''}>Red-Blue</option>
                    </select>
                    <div class="form-check form-switch me-1 mt-1">
                        <input class="form-check-input show-labels-check" type="checkbox" ${config.showLabels ? 'checked' : ''}>
                        <label class="form-check-label small">Labels</label>
                    </div>
                    <button class="btn btn-sm btn-outline-primary ms-1 select-matrix-btn">
                        <i class="bi bi-grid-3x2"></i>
                    </button>
                </div>
            </div>
            <div class="matrix-container w-100" style="height: calc(100% - 40px);">
                <div class="d-flex justify-content-center align-items-center h-100 matrix-placeholder">
                    <div class="text-center">
                        <div class="mb-3">Select a matrix to visualize</div>
                        <button class="btn btn-primary select-matrix-btn">
                            <i class="bi bi-grid-3x2 me-1"></i> Select Matrix
                        </button>
                    </div>
                </div>
                <div class="matrix-plot h-100"></div>
            </div>
        `;
        
        // Update panel title
        this._setPanelTitle(panelId, config.title);
        
        // Get panel content
        const content = document.querySelector(`#${panelId} .panel-content`);
        content.innerHTML = '';
        content.appendChild(panel);
        
        // Hide panel placeholder
        this._hidePanelPlaceholder(panelId);
        
        // Store panel info
        this.panels.set(panelId, {
            type: 'matrix',
            config,
            panel
        });
        
        // Set up event listeners
        panel.querySelector('.matrix-type-select').addEventListener('change', (e) => {
            const matrixType = e.target.value;
            if (matrixType) {
                // Update matrix key select with available options
                this._populateMatrixKeySelect(panel.querySelector('.matrix-key-select'), matrixType);
            }
        });
        
        panel.querySelector('.matrix-key-select').addEventListener('change', (e) => {
            const matrixKey = e.target.value;
            const matrixType = panel.querySelector('.matrix-type-select').value;
            const colorScale = panel.querySelector('.color-scale-select').value;
            const showLabels = panel.querySelector('.show-labels-check').checked;
            
            if (matrixKey && matrixType) {
                // Display matrix
                this._displayMatrix(panelId, matrixType, matrixKey, colorScale, showLabels);
            }
        });
        
        panel.querySelector('.color-scale-select').addEventListener('change', (e) => {
            const matrixKey = panel.querySelector('.matrix-key-select').value;
            const matrixType = panel.querySelector('.matrix-type-select').value;
            const colorScale = e.target.value;
            const showLabels = panel.querySelector('.show-labels-check').checked;
            
            if (matrixKey && matrixType) {
                // Update color scale
                this._displayMatrix(panelId, matrixType, matrixKey, colorScale, showLabels);
            }
        });
        
        panel.querySelector('.show-labels-check').addEventListener('change', (e) => {
            const matrixKey = panel.querySelector('.matrix-key-select').value;
            const matrixType = panel.querySelector('.matrix-type-select').value;
            const colorScale = panel.querySelector('.color-scale-select').value;
            const showLabels = e.target.checked;
            
            if (matrixKey && matrixType) {
                // Update labels
                this._displayMatrix(panelId, matrixType, matrixKey, colorScale, showLabels);
            }
        });
        
        // Set up matrix selection button
        const selectMatrixButtons = panel.querySelectorAll('.select-matrix-btn');
        selectMatrixButtons.forEach(button => {
            button.addEventListener('click', () => {
                this._showMatrixSelector(panelId);
            });
        });
        
        // Populate matrix type if provided
        if (config.matrixType) {
            this._populateMatrixKeySelect(panel.querySelector('.matrix-key-select'), config.matrixType);
        }
        
        // Display matrix if type and key are provided
        if (config.matrixType && config.matrixKey) {
            this._displayMatrix(panelId, config.matrixType, config.matrixKey, config.colorScale, config.showLabels);
        } else {
            // Hide the plot container and show placeholder
            panel.querySelector('.matrix-plot').style.display = 'none';
        }
        
        return this.panels.get(panelId);
    }
    
    /**
     * Show the matrix selector modal
     * @param {string} panelId - Panel ID to update after selection
     * @private
     */
    _showMatrixSelector(panelId) {
        const deps = getDependencies();
        const { dataManager } = deps;
        
        // Get the modal element
        const modal = document.getElementById('matrixSelectorModal');
        if (!modal) return;
        
        // Set up the callback for the select button
        const selectButton = modal.querySelector('#selectMatrixBtn');
        
        // Remove any existing event listeners using cloneNode
        const newButton = selectButton.cloneNode(true);
        selectButton.parentNode.replaceChild(newButton, selectButton);
        
        // Add new event listener
        newButton.addEventListener('click', () => {
            // Get the selected tab
            const activeTab = modal.querySelector('.nav-link.active');
            const tabId = activeTab.id;
            
            // Determine matrix type based on tab
            let matrixType;
            let matrixKey;
            
            if (tabId === 'obsp-tab') {
                matrixType = 'obsp';
                const selected = modal.querySelector('#obsp-list .list-group-item.active');
                if (selected) {
                    matrixKey = selected.dataset.key;
                }
            } else if (tabId === 'varp-tab') {
                matrixType = 'varp';
                const selected = modal.querySelector('#varp-list .list-group-item.active');
                if (selected) {
                    matrixKey = selected.dataset.key;
                }
            } else if (tabId === 'obsm-tab') {
                matrixType = 'obsm';
                const selected = modal.querySelector('#obsm-list .list-group-item.active');
                if (selected) {
                    matrixKey = selected.dataset.key;
                }
            } else if (tabId === 'varm-tab') {
                matrixType = 'varm';
                const selected = modal.querySelector('#varm-list .list-group-item.active');
                if (selected) {
                    matrixKey = selected.dataset.key;
                }
            } else if (tabId === 'layers-tab') {
                matrixType = 'layer';
                const selected = modal.querySelector('#layers-list .list-group-item.active');
                if (selected) {
                    matrixKey = selected.dataset.key;
                }
            }
            
            // Check if we have a valid selection
            if (matrixType && matrixKey) {
                // Update the panel
                const panel = this.panels.get(panelId);
                if (panel && panel.type === 'matrix') {
                    // Update the panel selects
                    const matrixTypeSelect = panel.panel.querySelector('.matrix-type-select');
                    const matrixKeySelect = panel.panel.querySelector('.matrix-key-select');
                    
                    // Set the values
                    matrixTypeSelect.value = matrixType;
                    
                    // Populate the key select
                    this._populateMatrixKeySelect(matrixKeySelect, matrixType);
                    matrixKeySelect.value = matrixKey;
                    
                    // Get other settings
                    const colorScale = panel.panel.querySelector('.color-scale-select').value;
                    const showLabels = panel.panel.querySelector('.show-labels-check').checked;
                    
                    // Display the matrix
                    this._displayMatrix(panelId, matrixType, matrixKey, colorScale, showLabels);
                    
                    // Update panel title
                    let title;
                    if (matrixType === 'obsp') {
                        title = `Cell-Cell Matrix: ${matrixKey}`;
                    } else if (matrixType === 'varp') {
                        title = `Gene-Gene Matrix: ${matrixKey}`;
                    } else if (matrixType === 'obsm') {
                        title = `Cell Embedding: ${matrixKey}`;
                    } else if (matrixType === 'varm') {
                        title = `Gene Matrix: ${matrixKey}`;
                    } else if (matrixType === 'layer') {
                        title = `Layer: ${matrixKey}`;
                    }
                    
                    this._setPanelTitle(panelId, title);
                }
                
                // Close the modal
                const bsModal = bootstrap.Modal.getInstance(modal);
                if (bsModal) {
                    bsModal.hide();
                }
            } else {
                // Show error if nothing selected
                alert('Please select a matrix');
            }
        });
        
        // Load matrix data for all tabs
        this._loadMatrixSelectorData(modal);
        
        // Show the modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }
    
    /**
     * Load data for the matrix selector modal
     * @param {HTMLElement} modal - The modal element
     * @private
     */
    _loadMatrixSelectorData(modal) {
        const deps = getDependencies();
        const { dataManager } = deps;
        
        // Get basic info to determine available matrices
        const info = dataManager.getBasicInfo();
        if (!info) return;
        
        // Load obsp matrices
        const obspList = modal.querySelector('#obsp-list');
        const obspLoading = modal.querySelector('#obsp-loading');
        const obspEmpty = modal.querySelector('#obsp-empty');
        
        if (obspList && obspLoading && obspEmpty) {
            obspList.innerHTML = '';
            obspLoading.style.display = 'block';
            obspEmpty.style.display = 'none';
            
            const obspMatrices = info.obspMatrices || dataManager.getObspMatrices() || [];
            
            if (obspMatrices.length > 0) {
                obspMatrices.forEach(key => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.key = key;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${key}</h6>
                        </div>
                        <p class="mb-1 small text-muted">Cell-cell relationships matrix</p>
                    `;
                    
                    // Add click handler
                    item.addEventListener('click', () => {
                        // Remove active class from all items
                        obspList.querySelectorAll('.list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        item.classList.add('active');
                    });
                    
                    obspList.appendChild(item);
                });
                
                obspLoading.style.display = 'none';
            } else {
                obspLoading.style.display = 'none';
                obspEmpty.style.display = 'block';
            }
        }
        
        // Load varp matrices
        const varpList = modal.querySelector('#varp-list');
        const varpLoading = modal.querySelector('#varp-loading');
        const varpEmpty = modal.querySelector('#varp-empty');
        
        if (varpList && varpLoading && varpEmpty) {
            varpList.innerHTML = '';
            varpLoading.style.display = 'block';
            varpEmpty.style.display = 'none';
            
            const varpMatrices = info.varpMatrices || dataManager.getVarpMatrices() || [];
            
            if (varpMatrices.length > 0) {
                varpMatrices.forEach(key => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.key = key;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${key}</h6>
                        </div>
                        <p class="mb-1 small text-muted">Gene-gene relationships matrix</p>
                    `;
                    
                    // Add click handler
                    item.addEventListener('click', () => {
                        // Remove active class from all items
                        varpList.querySelectorAll('.list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        item.classList.add('active');
                    });
                    
                    varpList.appendChild(item);
                });
                
                varpLoading.style.display = 'none';
            } else {
                varpLoading.style.display = 'none';
                varpEmpty.style.display = 'block';
            }
        }
        
        // Load obsm matrices (embeddings)
        const obsmList = modal.querySelector('#obsm-list');
        const obsmLoading = modal.querySelector('#obsm-loading');
        const obsmEmpty = modal.querySelector('#obsm-empty');
        
        if (obsmList && obsmLoading && obsmEmpty) {
            obsmList.innerHTML = '';
            obsmLoading.style.display = 'block';
            obsmEmpty.style.display = 'none';
            
            const embeddings = info.embeddings || dataManager.getEmbeddings() || [];
            
            if (embeddings.length > 0) {
                embeddings.forEach(key => {
                    // Use the X_ prefix for obsm keys
                    const obsmKey = key.startsWith('X_') ? key : `X_${key.toLowerCase()}`;
                    
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.key = obsmKey;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${key}</h6>
                        </div>
                        <p class="mb-1 small text-muted">Cell embedding</p>
                    `;
                    
                    // Add click handler
                    item.addEventListener('click', () => {
                        // Remove active class from all items
                        obsmList.querySelectorAll('.list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        item.classList.add('active');
                    });
                    
                    obsmList.appendChild(item);
                });
                
                obsmLoading.style.display = 'none';
            } else {
                obsmLoading.style.display = 'none';
                obsmEmpty.style.display = 'block';
            }
        }
        
        // Load varm matrices
        const varmList = modal.querySelector('#varm-list');
        const varmLoading = modal.querySelector('#varm-loading');
        const varmEmpty = modal.querySelector('#varm-empty');
        
        if (varmList && varmLoading && varmEmpty) {
            varmList.innerHTML = '';
            varmLoading.style.display = 'block';
            varmEmpty.style.display = 'none';
            
            // Get varm matrices if available 
            const varmMatrices = info.varmMatrices || [];
            
            if (varmMatrices.length > 0) {
                varmMatrices.forEach(key => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.key = key;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${key}</h6>
                        </div>
                        <p class="mb-1 small text-muted">Gene matrix</p>
                    `;
                    
                    // Add click handler
                    item.addEventListener('click', () => {
                        // Remove active class from all items
                        varmList.querySelectorAll('.list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        item.classList.add('active');
                    });
                    
                    varmList.appendChild(item);
                });
                
                varmLoading.style.display = 'none';
            } else {
                varmLoading.style.display = 'none';
                varmEmpty.style.display = 'block';
            }
        }
        
        // Load layers
        const layersList = modal.querySelector('#layers-list');
        const layersLoading = modal.querySelector('#layers-loading');
        const layersEmpty = modal.querySelector('#layers-empty');
        
        if (layersList && layersLoading && layersEmpty) {
            layersList.innerHTML = '';
            layersLoading.style.display = 'block';
            layersEmpty.style.display = 'none';
            
            const layers = info.layerNames || dataManager.getLayers() || [];
            
            if (layers.length > 0) {
                layers.forEach(key => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.key = key;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">${key}</h6>
                        </div>
                        <p class="mb-1 small text-muted">Expression matrix layer</p>
                    `;
                    
                    // Add click handler
                    item.addEventListener('click', () => {
                        // Remove active class from all items
                        layersList.querySelectorAll('.list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        item.classList.add('active');
                    });
                    
                    layersList.appendChild(item);
                });
                
                layersLoading.style.display = 'none';
            } else {
                layersLoading.style.display = 'none';
                layersEmpty.style.display = 'block';
            }
        }
    }
    
    /**
     * Populate the matrix key select with options based on matrix type
     * @param {HTMLSelectElement} select - The select element to populate
     * @param {string} matrixType - The type of matrix ('obsp' or 'varp')
     * @private
     */
    _populateMatrixKeySelect(select, matrixType) {
        const deps = getDependencies();
        const { dataManager } = deps;
        
        // Clear existing options
        select.innerHTML = '<option value="">Select Matrix</option>';
        
        // Get available matrices based on type
        let matrices = [];
        if (matrixType === 'obsp') {
            matrices = dataManager.getObspMatrices() || [];
        } else if (matrixType === 'varp') {
            matrices = dataManager.getVarpMatrices() || [];
        }
        
        // Add options
        matrices.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            select.appendChild(option);
        });
    }
    
    /**
     * Display a matrix visualization
     * @param {string} panelId - The panel ID
     * @param {string} matrixType - The type of matrix ('obsp' or 'varp')
     * @param {string} matrixKey - The key of the matrix
     * @param {string} colorScale - The color scale to use
     * @param {boolean} showLabels - Whether to show labels
     * @private
     */
    _displayMatrix(panelId, matrixType, matrixKey, colorScale, showLabels) {
        const deps = getDependencies();
        const { dataManager, matrixManager, plotManager } = deps;
        
        // Get the panel
        const panel = this.panels.get(panelId);
        if (!panel) return;
        
        // Update config
        panel.config.matrixType = matrixType;
        panel.config.matrixKey = matrixKey;
        panel.config.colorScale = colorScale;
        panel.config.showLabels = showLabels;
        
        // Show loading indicator
        const matrixContainer = panel.panel.querySelector('.matrix-container');
        const matrixPlot = panel.panel.querySelector('.matrix-plot');
        const matrixPlaceholder = panel.panel.querySelector('.matrix-placeholder');
        
        matrixPlaceholder.style.display = 'none';
        matrixPlot.style.display = 'none';
        matrixPlot.innerHTML = '<div class="d-flex justify-content-center align-items-center h-100"><div class="spinner-border" role="status"></div></div>';
        matrixPlot.style.display = 'block';
        
        // Load matrix data
        const loadPromise = matrixType === 'obsp' 
            ? matrixManager.getObspSample(matrixKey, 50)
            : matrixManager.getVarpSample(matrixKey, 50);
            
        loadPromise.then(data => {
            // Create heatmap visualization
            const plotData = [{
                z: data.data,
                x: data.rowNames || Array.from({length: data.data[0].length}, (_, i) => i),
                y: data.colNames || Array.from({length: data.data.length}, (_, i) => i),
                type: 'heatmap',
                colorscale: colorScale,
                showscale: true,
                hoverongaps: false
            }];
            
            const plotLayout = {
                title: `${matrixKey} ${matrixType === 'obsp' ? 'Cell-Cell' : 'Gene-Gene'} Matrix`,
                margin: {
                    l: showLabels ? 120 : 50,
                    r: 50,
                    b: showLabels ? 120 : 50,
                    t: 50,
                    pad: 4
                },
                xaxis: {
                    showticklabels: showLabels,
                    tickangle: 45
                },
                yaxis: {
                    showticklabels: showLabels
                }
            };
            
            const plotConfig = {
                responsive: true,
                displayModeBar: true,
                displaylogo: false,
                toImageButtonOptions: {
                    format: 'png',
                    filename: `${matrixType}_${matrixKey}`,
                    height: 1000,
                    width: 1000,
                    scale: 2
                }
            };
            
            // Clear and create the plot
            matrixPlot.innerHTML = '';
            Plotly.newPlot(matrixPlot, plotData, plotLayout, plotConfig);
            
            // Update plot on window resize
            const resizeObserver = new ResizeObserver(() => {
                Plotly.Plots.resize(matrixPlot);
            });
            resizeObserver.observe(matrixPlot);
        })
        .catch(error => {
            console.error(`Error loading ${matrixType} matrix ${matrixKey}:`, error);
            matrixPlot.innerHTML = `<div class="alert alert-danger">Error loading matrix: ${error.message}</div>`;
        });
    }
}

// Create and export a singleton instance
const uiManager = new UIManager();

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = uiManager;
} else if (typeof window !== 'undefined') {
    // Register with the module loader if available
    if (window.Annzarro) {
        window.Annzarro.registerModule('uiManager', uiManager);
        window.Annzarro.checkModulesReady();
    } else {
        window.uiManager = uiManager;
    }
}