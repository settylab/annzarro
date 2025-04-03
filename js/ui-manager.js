/**
 * UIManager - Manages the user interface and layouts
 * This class is responsible for:
 * 1. Managing different layout configurations
 * 2. Creating and updating panels
 * 3. Handling UI events and user interactions
 */

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
            'string-db': this.createStringDbPanel.bind(this)
        };
        
        // Initialize UI event handlers
        this._initEventHandlers();
    }

    /**
     * Initialize the UI manager
     * @param {string} containerId - ID of the main container element
     */
    initialize(containerId = 'vizContainer') {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        
        if (!this.container) {
            console.error(`Container element with ID ${containerId} not found`);
            return;
        }
        
        // Set initial layout
        this.setLayout('single');
    }

    /**
     * Set the layout type
     * @param {string} layoutType - Type of layout ('single', 'horizontal', 'vertical', 'quad')
     */
    setLayout(layoutType) {
        if (!this.layouts[layoutType]) {
            console.error(`Layout type '${layoutType}' is not supported`);
            return;
        }
        
        // Save current panels
        const currentPanels = Array.from(this.panels.values());
        
        // Clear the container
        this.container.innerHTML = '';
        this.panels.clear();
        
        // Create the new layout
        this.layouts[layoutType]();
        this.currentLayout = layoutType;
        
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
        const row = document.createElement('div');
        row.className = 'row h-100';
        this.container.appendChild(row);
        
        const col = document.createElement('div');
        col.className = 'col-12 h-100';
        row.appendChild(col);
        
        const panel = document.createElement('div');
        panel.id = 'panel-1';
        panel.className = 'h-100 panel';
        col.appendChild(panel);
        
        // Create empty panel
        this._createEmptyPanelContent(panel);
    }

    /**
     * Create a horizontal layout (side by side)
     * @private
     */
    createHorizontalLayout() {
        const row = document.createElement('div');
        row.className = 'row h-100';
        this.container.appendChild(row);
        
        for (let i = 1; i <= 2; i++) {
            const col = document.createElement('div');
            col.className = 'col-6 h-100';
            row.appendChild(col);
            
            const panel = document.createElement('div');
            panel.id = `panel-${i}`;
            panel.className = 'h-100 panel';
            col.appendChild(panel);
            
            // Create empty panel
            this._createEmptyPanelContent(panel);
        }
        
        // Add resizer
        this._addResizer('horizontal', row.children[0], row.children[1]);
    }

    /**
     * Create a vertical layout (stacked)
     * @private
     */
    createVerticalLayout() {
        for (let i = 1; i <= 2; i++) {
            const row = document.createElement('div');
            row.className = 'row';
            row.style.height = '50%';
            this.container.appendChild(row);
            
            const col = document.createElement('div');
            col.className = 'col-12 h-100';
            row.appendChild(col);
            
            const panel = document.createElement('div');
            panel.id = `panel-${i}`;
            panel.className = 'h-100 panel';
            col.appendChild(panel);
            
            // Create empty panel
            this._createEmptyPanelContent(panel);
        }
        
        // Add resizer
        this._addResizer('vertical', this.container.children[0], this.container.children[1]);
    }

    /**
     * Create a quad layout (2x2 grid)
     * @private
     */
    createQuadLayout() {
        for (let i = 1; i <= 2; i++) {
            const row = document.createElement('div');
            row.className = 'row';
            row.style.height = '50%';
            this.container.appendChild(row);
            
            for (let j = 1; j <= 2; j++) {
                const col = document.createElement('div');
                col.className = 'col-6 h-100';
                row.appendChild(col);
                
                const panel = document.createElement('div');
                panel.id = `panel-${(i - 1) * 2 + j}`;
                panel.className = 'h-100 panel';
                col.appendChild(panel);
                
                // Create empty panel
                this._createEmptyPanelContent(panel);
            }
            
            // Add horizontal resizers
            this._addResizer('horizontal', row.children[0], row.children[1]);
        }
        
        // Add vertical resizers
        this._addResizer('vertical', this.container.children[0], this.container.children[1]);
    }

    /**
     * Create a new panel
     * @param {string} panelId - ID of the panel element
     * @param {string} panelType - Type of panel to create
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     */
    createPanel(panelId, panelType, config = {}) {
        // Get the panel element
        const panelElement = document.getElementById(panelId);
        if (!panelElement) {
            console.error(`Panel element with ID ${panelId} not found`);
            return null;
        }
        
        // Check if panel type is supported
        if (!this.panelTypes[panelType]) {
            console.error(`Panel type '${panelType}' is not supported`);
            return null;
        }
        
        // Clear the panel
        panelElement.innerHTML = '';
        
        // Create the panel
        const panel = this.panelTypes[panelType](panelElement, config);
        
        // Store the panel info
        this.panels.set(panelId, {
            element: panelElement,
            type: panelType,
            config: config
        });
        
        return panel;
    }

    /**
     * Create a plot panel
     * @param {HTMLElement} container - Container element
     * @param {Object} config - Configuration for the panel
     * @returns {HTMLElement} The created panel
     * @private
     */
    createPlotPanel(container, config = {}) {
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
        settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
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
        exportBtn.innerHTML = '<i class="fas fa-download"></i>';
        exportBtn.title = 'Export Plot';
        exportBtn.addEventListener('click', () => {
            // Export the plot
            plotManager.downloadPlot(container.id, 'png', `annzarro-plot-${new Date().toISOString().slice(0, 10)}`);
        });
        controls.appendChild(exportBtn);
        
        // Add the body
        const body = document.createElement('div');
        body.className = 'panel-body';
        container.appendChild(body);
        
        // Create the plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'h-100 w-100';
        plotContainer.id = `plot-${container.id}`;
        body.appendChild(plotContainer);
        
        // Create a placeholder plot if no data is provided
        if (!config.data) {
            const placeholder = document.createElement('div');
            placeholder.className = 'd-flex justify-content-center align-items-center h-100';
            placeholder.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-chart-line fa-3x mb-3"></i>
                    <p>Configure the plot to see visualization</p>
                </div>
            `;
            plotContainer.appendChild(placeholder);
        } else {
            // Create the actual plot
            plotManager.createPlot(
                plotContainer.id,
                config.plotType || 'scatter',
                config.data,
                config.plotSettings
            );
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
                    <i class="fas fa-table fa-3x mb-3"></i>
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
                    <i class="fas fa-dna fa-3x mb-3"></i>
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
                    <i class="fas fa-circle fa-3x mb-3"></i>
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
                    <i class="fas fa-project-diagram fa-3x mb-3"></i>
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
                        <i class="fas fa-chart-line"></i> Plot
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="table">
                        <i class="fas fa-table"></i> Table
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="gene-info">
                        <i class="fas fa-dna"></i> Gene Info
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="cell-info">
                        <i class="fas fa-circle"></i> Cell Info
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="data-explorer">
                        <i class="fas fa-search"></i> Explorer
                    </button>
                    <button type="button" class="btn btn-outline-primary create-panel" data-type="string-db">
                        <i class="fas fa-project-diagram"></i> STRING-DB
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
     * Add a resizer element between two panels
     * @param {string} direction - Direction of the resizer ('horizontal' or 'vertical')
     * @param {HTMLElement} firstElement - First element
     * @param {HTMLElement} secondElement - Second element
     * @private
     */
    _addResizer(direction, firstElement, secondElement) {
        const resizer = document.createElement('div');
        resizer.className = `resizer ${direction}`;
        
        if (direction === 'horizontal') {
            resizer.style.left = `${firstElement.offsetWidth}px`;
            this.container.appendChild(resizer);
            
            let startX, startWidth;
            
            const startResize = (e) => {
                startX = e.clientX;
                startWidth = firstElement.offsetWidth;
                document.addEventListener('mousemove', resize);
                document.addEventListener('mouseup', stopResize);
                document.body.style.cursor = 'col-resize';
            };
            
            const resize = (e) => {
                const containerWidth = this.container.offsetWidth;
                const newWidth = startWidth + (e.clientX - startX);
                const percentage = (newWidth / containerWidth) * 100;
                
                // Ensure minimum widths
                if (percentage > 10 && percentage < 90) {
                    firstElement.style.width = `${percentage}%`;
                    secondElement.style.width = `${100 - percentage}%`;
                    resizer.style.left = `${firstElement.offsetWidth}px`;
                }
            };
            
            const stopResize = () => {
                document.removeEventListener('mousemove', resize);
                document.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = '';
            };
            
            resizer.addEventListener('mousedown', startResize);
        } else {
            resizer.style.top = `${firstElement.offsetHeight}px`;
            this.container.appendChild(resizer);
            
            let startY, startHeight;
            
            const startResize = (e) => {
                startY = e.clientY;
                startHeight = firstElement.offsetHeight;
                document.addEventListener('mousemove', resize);
                document.addEventListener('mouseup', stopResize);
                document.body.style.cursor = 'row-resize';
            };
            
            const resize = (e) => {
                const containerHeight = this.container.offsetHeight;
                const newHeight = startHeight + (e.clientY - startY);
                const percentage = (newHeight / containerHeight) * 100;
                
                // Ensure minimum heights
                if (percentage > 10 && percentage < 90) {
                    firstElement.style.height = `${percentage}%`;
                    secondElement.style.height = `${100 - percentage}%`;
                    resizer.style.top = `${firstElement.offsetHeight}px`;
                }
            };
            
            const stopResize = () => {
                document.removeEventListener('mousemove', resize);
                document.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = '';
            };
            
            resizer.addEventListener('mousedown', startResize);
        }
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
        const statusBar = document.getElementById('dataStatusBar');
        const datasetName = document.getElementById('datasetName');
        const datasetStats = document.getElementById('datasetStats');
        const exploreBtn = document.getElementById('exploreDataBtn');
        
        if (dataManager.isDataLoaded()) {
            const info = dataManager.getBasicInfo();
            
            // Set dataset name
            datasetName.textContent = 'Dataset loaded';
            
            // Set dataset stats
            datasetStats.textContent = `(${Utils.formatNumber(info.nObs)} cells × ${Utils.formatNumber(info.nVars)} genes)`;
            
            // Enable explore button
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
            
            // Update status bar style
            statusBar.className = 'alert alert-success my-2';
        } else {
            // Reset status bar
            datasetName.textContent = 'No dataset loaded';
            datasetStats.textContent = '';
            exploreBtn.disabled = true;
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
        if (!dataManager.isDataLoaded()) return;
        
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
        if (!dataManager.isDataLoaded()) return;
        
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
        // Parse axis specifications
        const xAxisSpec = config.xAxis.split(':');
        const yAxisSpec = config.yAxis.split(':');
        const zAxisSpec = config.zAxis ? config.zAxis.split(':') : null;
        const colorBySpec = config.colorBy ? config.colorBy.split(':') : null;
        
        // Load data for each axis
        const [xData, xLabel] = await this._loadAxisData(xAxisSpec);
        const [yData, yLabel] = await this._loadAxisData(yAxisSpec);
        const [zData, zLabel] = zAxisSpec ? await this._loadAxisData(zAxisSpec) : [null, null];
        const [colorData, colorLabel] = colorBySpec ? await this._loadAxisData(colorBySpec) : [null, null];
        
        // Create plot data object
        const plotData = {
            x: xData,
            y: yData,
            z: zData,
            color: colorData,
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
        const source = axisSpec[0];
        const key = axisSpec[1];
        const index = axisSpec.length > 2 ? parseInt(axisSpec[2]) : null;
        
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
        // To be implemented
    }

    /**
     * Display gene information
     * @param {string} containerId - ID of the container element
     * @param {string} gene - Gene symbol
     * @param {number} speciesId - NCBI taxonomy ID
     * @private
     */
    _displayGeneInfo(containerId, gene, speciesId = 9606) {
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
        // This function would populate the data explorer tabs with information from the loaded AnnData
        // For brevity, this implementation is placeholder and would need to be expanded
        
        if (!dataManager.isDataLoaded()) return;
        
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
                    </div>
                </div>
            `;
        }
        
        // Ideally, other tabs would be populated with similar data-driven content
    }
}

// Create and export a singleton instance
const uiManager = new UIManager();