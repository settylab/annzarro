/**
 * Panel Manager Module
 * 
 * Handles panel creation, layout, and management for the application
 */

const PanelManager = (function() {
    // Available data categories and their field population functions
    const DATA_CATEGORIES = {
        'obsm': {
            label: 'Cell Embeddings (obsm)',
            entityType: 'cell', // Only for cell plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obsm && datasetInfo.obsm.keys) {
                    // Add matrix fields
                    for (const key of datasetInfo.obsm.keys) {
                        fields.push({
                            key: key,
                            type: 'matrix',
                            label: key
                        });
                        
                        // For matrices like X_umap, add individual dimensions
                        try {
                            const matrix = await DataManager.loadObsm(key, null, null);
                            if (matrix && matrix.length > 0 && Array.isArray(matrix[0])) {
                                // Check if it's a 2D matrix
                                const dims = matrix[0].length;
                                for (let i = 0; i < dims; i++) {
                                    fields.push({
                                        key: key,
                                        index: i,
                                        type: 'matrix_dimension',
                                        label: `${key} dimension ${i+1}`
                                    });
                                }
                            }
                        } catch (e) {
                            console.warn(`Error checking dimensions for obsm/${key}:`, e);
                        }
                    }
                    
                    // Add dataframe fields
                    if (datasetInfo.obsm.dataframes) {
                        for (const [dfKey, columns] of Object.entries(datasetInfo.obsm.dataframes)) {
                            for (const column of columns) {
                                fields.push({
                                    key: dfKey,
                                    column: column,
                                    type: 'dataframe_column',
                                    label: `${dfKey}.${column}`
                                });
                            }
                        }
                    }
                }
                
                return fields;
            }
        },
        'varm': {
            label: 'Gene Embeddings (varm)',
            entityType: 'gene', // Only for gene plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.varm && datasetInfo.varm.keys) {
                    // Add matrix fields
                    for (const key of datasetInfo.varm.keys) {
                        fields.push({
                            key: key,
                            type: 'matrix',
                            label: key
                        });
                        
                        // For matrices, add individual dimensions
                        try {
                            const matrix = await DataManager.loadVarm(key, null, null);
                            if (matrix && matrix.length > 0 && Array.isArray(matrix[0])) {
                                // Check if it's a 2D matrix
                                const dims = matrix[0].length;
                                for (let i = 0; i < dims; i++) {
                                    fields.push({
                                        key: key,
                                        index: i,
                                        type: 'matrix_dimension',
                                        label: `${key} dimension ${i+1}`
                                    });
                                }
                            }
                        } catch (e) {
                            console.warn(`Error checking dimensions for varm/${key}:`, e);
                        }
                    }
                    
                    // Add dataframe fields
                    if (datasetInfo.varm.dataframes) {
                        for (const [dfKey, columns] of Object.entries(datasetInfo.varm.dataframes)) {
                            for (const column of columns) {
                                fields.push({
                                    key: dfKey,
                                    column: column,
                                    type: 'dataframe_column',
                                    label: `${dfKey}.${column}`
                                });
                            }
                        }
                    }
                }
                
                return fields;
            }
        },
        'obs': {
            label: 'Cell Annotations (obs)',
            entityType: 'cell', // Only for cell plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obs && datasetInfo.obs.columns) {
                    for (const column of datasetInfo.obs.columns) {
                        fields.push({
                            key: column,
                            type: 'column',
                            label: column
                        });
                    }
                }
                
                return fields;
            }
        },
        'var': {
            label: 'Gene Annotations (var)',
            entityType: 'gene', // Only for gene plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.var && datasetInfo.var.columns) {
                    for (const column of datasetInfo.var.columns) {
                        fields.push({
                            key: column,
                            type: 'column',
                            label: column
                        });
                    }
                }
                
                return fields;
            }
        },
        'X': {
            label: 'Expression Matrix (X)',
            entityType: 'both', // Available for both cell and gene plots
            loadFields: async () => {
                // For expression matrix, we need gene selection
                return [{ 
                    key: 'X', 
                    type: 'expression', 
                    label: 'Gene expression (requires focused gene)',
                    requiresFocusedGene: true
                }];
            }
        },
        'layers': {
            label: 'Alternate Expressions (layers)',
            entityType: 'both', // Available for both cell and gene plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.layers && datasetInfo.layers.keys) {
                    for (const key of datasetInfo.layers.keys) {
                        fields.push({
                            key: key,
                            type: 'layer',
                            label: `${key} (requires focused gene)`,
                            requiresFocusedGene: true
                        });
                    }
                }
                
                return fields;
            }
        },
        'obsp': {
            label: 'Cell-Cell Matrices (obsp)',
            entityType: 'cell', // Only for cell plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.obsp && datasetInfo.obsp.keys) {
                    for (const key of datasetInfo.obsp.keys) {
                        fields.push({
                            key: key,
                            type: 'obsp',
                            label: `${key} (requires focused cell)`,
                            requiresFocusedCell: true
                        });
                    }
                }
                
                return fields;
            }
        },
        'varp': {
            label: 'Gene-Gene Matrices (varp)',
            entityType: 'gene', // Only for gene plots
            loadFields: async () => {
                const datasetInfo = DataManager.getDatasetInfo();
                const fields = [];
                
                if (datasetInfo && datasetInfo.varp && datasetInfo.varp.keys) {
                    for (const key of datasetInfo.varp.keys) {
                        fields.push({
                            key: key,
                            type: 'varp',
                            label: `${key} (requires focused gene)`,
                            requiresFocusedGene: true
                        });
                    }
                }
                
                return fields;
            }
        }
    };
    // Private variables
    let _container = null;
    let _panels = {};
    let _panelCount = 0;
    let _panelTypes = {};
    let _minimizedPanels = {};
    let _recentlyClosed = [];
    let _maxRecentClosed = 5;
    
    /**
     * Initialize the panel manager
     */
    function init() {
        _container = document.getElementById('panelContainer');
        if (!_container) {
            console.error('Panel container not found');
            return;
        }
        
        // Register built-in panel types
        registerPanelType('plot', createPlotPanel);
        registerPanelType('cellTable', createCellTablePanel);
        registerPanelType('geneTable', createGeneTablePanel);
        registerPanelType('geneSet', createGeneSetPanel);
        
        // Handle dataset loading events
        document.addEventListener('dataLoaded', handleDataLoaded);
        
        console.log('PanelManager initialized');
    }
    
    /**
     * Register a panel type
     * @param {string} type - Panel type identifier
     * @param {Function} factory - Factory function to create panel content
     */
    function registerPanelType(type, factory) {
        _panelTypes[type] = factory;
    }
    
    /**
     * Create a new panel
     * @param {string} type - Panel type
     * @param {Object} config - Panel configuration
     * @returns {string} - Panel ID
     */
    function createPanel(type, config = {}) {
        const panelId = `panel-${_panelCount++}`;
        
        if (!_panelTypes[type]) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Make sure the config has its own type property set
        // This helps the panel factories know what specific panel variant to create
        if (!config.type && type === 'plot') {
            // Default to scatter plot if not specified
            config.type = 'scatter';
        }
        
        // Create panel element
        const panelElement = document.createElement('div');
        panelElement.id = panelId;
        panelElement.className = 'panel';
        panelElement.innerHTML = `
            <div class="panel-header">
                <div class="panel-title">${config.title || 'Panel'}</div>
                <div class="panel-controls">
                    <button class="btn btn-sm btn-outline-secondary panel-split-h-btn" title="Split Horizontally">
                        <i class="bi bi-layout-split"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary panel-split-v-btn" title="Split Vertically">
                        <i class="bi bi-layout-split-vertical"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary panel-minimize-btn" title="Minimize">
                        <i class="bi bi-dash"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary panel-close-btn" title="Close">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            </div>
            <div class="panel-body">
                <div class="panel-content"></div>
            </div>
        `;
        
        // Add to container
        _container.appendChild(panelElement);
        
        // Store panel
        _panels[panelId] = {
            id: panelId,
            type: type,
            config: config,
            element: panelElement,
            contentElement: panelElement.querySelector('.panel-content')
        };
        
        // Set up event handlers
        setupPanelEventHandlers(panelId);
        
        // Initialize panel content
        const content = _panelTypes[type](panelId, config);
        if (content) {
            const contentElement = panelElement.querySelector('.panel-content');
            if (typeof content === 'string') {
                contentElement.innerHTML = content;
            } else if (content instanceof HTMLElement) {
                contentElement.appendChild(content);
            }
        }
        
        // For plot panels, we need to initialize the plot after adding to DOM
        if (type === 'plot') {
            // Create a brief timeout to let DOM settle
            setTimeout(() => {
                // Initialize the plot with the data from data-manager
                if (config.type === 'scatter') {
                    const plotElement = document.getElementById(`${panelId}-plot`);
                    if (plotElement && window.PlotManager) {
                        console.log(`Initializing scatter plot in panel: ${panelId}`);
                        PlotManager.createScatterPlot(`${panelId}-plot`, config);
                    }
                }
            }, 200);
        }
        
        // Make container visible if first panel
        if (Object.keys(_panels).length === 1) {
            _container.classList.remove('d-none');
            document.getElementById('emptyState').classList.add('d-none');
        }
        
        // Return panel ID
        return panelId;
    }
    
    /**
     * Set up event handlers for a panel
     * @param {string} panelId - Panel ID
     */
    function setupPanelEventHandlers(panelId) {
        const panel = _panels[panelId];
        if (!panel) return;
        
        const element = panel.element;
        
        // Split horizontally
        const splitHBtn = element.querySelector('.panel-split-h-btn');
        splitHBtn.addEventListener('click', () => {
            splitPanel(panelId, 'horizontal');
        });
        
        // Split vertically
        const splitVBtn = element.querySelector('.panel-split-v-btn');
        splitVBtn.addEventListener('click', () => {
            splitPanel(panelId, 'vertical');
        });
        
        // Minimize
        const minimizeBtn = element.querySelector('.panel-minimize-btn');
        minimizeBtn.addEventListener('click', () => {
            minimizePanel(panelId);
        });
        
        // Close
        const closeBtn = element.querySelector('.panel-close-btn');
        closeBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to close this panel?')) {
                closePanel(panelId);
            }
        });
    }
    
    /**
     * Split a panel
     * @param {string} panelId - Panel ID
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     */
    function splitPanel(panelId, direction) {
        const panel = _panels[panelId];
        if (!panel) return;
        
        // Create parent container
        const parentContainer = document.createElement('div');
        parentContainer.className = `panel-split panel-split-${direction}`;
        
        // Replace panel with container
        panel.element.parentNode.replaceChild(parentContainer, panel.element);
        
        // Add original panel back to container
        parentContainer.appendChild(panel.element);
        
        // Create new empty panel of the same type
        const newPanelId = createPanel(panel.type, {...panel.config});
        const newPanel = _panels[newPanelId];
        
        // Add new panel to container
        parentContainer.appendChild(newPanel.element);
        
        // Add resize handle if needed
        if (direction === 'horizontal') {
            const handle = document.createElement('div');
            handle.className = 'panel-split-handle horizontal';
            parentContainer.insertBefore(handle, newPanel.element);
            
            // Make handle draggable
            makeResizeHandleDraggable(handle, 'horizontal');
        } else {
            const handle = document.createElement('div');
            handle.className = 'panel-split-handle vertical';
            parentContainer.insertBefore(handle, newPanel.element);
            
            // Make handle draggable
            makeResizeHandleDraggable(handle, 'vertical');
        }
    }
    
    /**
     * Make a resize handle draggable
     * @param {HTMLElement} handle - Resize handle element
     * @param {string} direction - Resize direction ('horizontal' or 'vertical')
     */
    function makeResizeHandleDraggable(handle, direction) {
        let startX, startY, startWidth, startHeight;
        
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            
            const container = handle.parentNode;
            const panel1 = handle.previousElementSibling;
            const panel2 = handle.nextElementSibling;
            
            if (!panel1 || !panel2) return;
            
            startX = e.clientX;
            startY = e.clientY;
            
            if (direction === 'horizontal') {
                startWidth = panel1.offsetWidth;
            } else {
                startHeight = panel1.offsetHeight;
            }
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            
            handle.classList.add('resizing');
            
            function handleMouseMove(e) {
                if (direction === 'horizontal') {
                    const dx = e.clientX - startX;
                    const newWidth = startWidth + dx;
                    
                    // Calculate percentages
                    const containerWidth = container.offsetWidth;
                    const pct = (newWidth / containerWidth) * 100;
                    
                    // Apply limits
                    const limitedPct = Math.max(10, Math.min(90, pct));
                    
                    // Apply new widths
                    panel1.style.width = `${limitedPct}%`;
                    panel2.style.width = `${100 - limitedPct}%`;
                    
                    // Fire resize event for plots
                    window.dispatchEvent(new Event('resize'));
                } else {
                    const dy = e.clientY - startY;
                    const newHeight = startHeight + dy;
                    
                    // Calculate percentages
                    const containerHeight = container.offsetHeight;
                    const pct = (newHeight / containerHeight) * 100;
                    
                    // Apply limits
                    const limitedPct = Math.max(10, Math.min(90, pct));
                    
                    // Apply new heights
                    panel1.style.height = `${limitedPct}%`;
                    panel2.style.height = `${100 - limitedPct}%`;
                    
                    // Fire resize event for plots
                    window.dispatchEvent(new Event('resize'));
                }
            }
            
            function handleMouseUp() {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                handle.classList.remove('resizing');
            }
        });
    }
    
    /**
     * Minimize a panel
     * @param {string} panelId - Panel ID
     */
    function minimizePanel(panelId) {
        const panel = _panels[panelId];
        if (!panel) return;
        
        // Store panel for later restoration
        _minimizedPanels[panelId] = panel;
        
        // Remove from panels
        delete _panels[panelId];
        
        // Remove element
        if (panel.element.parentNode) {
            panel.element.parentNode.removeChild(panel.element);
        }
        
        // Update minimized panels list in UI
        updateMinimizedPanelsList();
        
        // Check if no panels left
        if (Object.keys(_panels).length === 0) {
            _container.classList.add('d-none');
            document.getElementById('emptyState').classList.remove('d-none');
        }
    }
    
    /**
     * Close a panel
     * @param {string} panelId - Panel ID
     */
    function closePanel(panelId) {
        const panel = _panels[panelId];
        if (!panel) return;
        
        // Add to recently closed
        _recentlyClosed.unshift({
            type: panel.type,
            config: {...panel.config},
            timestamp: new Date()
        });
        
        // Trim recently closed list
        if (_recentlyClosed.length > _maxRecentClosed) {
            _recentlyClosed = _recentlyClosed.slice(0, _maxRecentClosed);
        }
        
        // Remove from panels
        delete _panels[panelId];
        
        // Remove element
        if (panel.element.parentNode) {
            panel.element.parentNode.removeChild(panel.element);
        }
        
        // Update recently closed list in UI
        updateRecentlyClosedList();
        
        // Check if no panels left
        if (Object.keys(_panels).length === 0) {
            _container.classList.add('d-none');
            document.getElementById('emptyState').classList.remove('d-none');
        }
    }
    
    /**
     * Restore a minimized panel
     * @param {string} panelId - Panel ID
     */
    function restoreMinimizedPanel(panelId) {
        const panel = _minimizedPanels[panelId];
        if (!panel) return;
        
        // Show container if needed
        _container.classList.remove('d-none');
        document.getElementById('emptyState').classList.add('d-none');
        
        // Move back to active panels
        _panels[panelId] = panel;
        delete _minimizedPanels[panelId];
        
        // Add back to container
        _container.appendChild(panel.element);
        
        // Update minimized panels list
        updateMinimizedPanelsList();
    }
    
    /**
     * Restore a recently closed panel
     * @param {number} index - Index in recently closed list
     */
    function restoreClosedPanel(index) {
        const panelInfo = _recentlyClosed[index];
        if (!panelInfo) return;
        
        // Create new panel
        createPanel(panelInfo.type, panelInfo.config);
        
        // Remove from recently closed
        _recentlyClosed.splice(index, 1);
        
        // Update recently closed list
        updateRecentlyClosedList();
    }
    
    /**
     * Update the minimized panels list in UI
     */
    function updateMinimizedPanelsList() {
        const container = document.getElementById('minimizedPanelsList');
        if (!container) return;
        
        if (Object.keys(_minimizedPanels).length === 0) {
            container.innerHTML = '<p class="text-muted">No minimized panels</p>';
            return;
        }
        
        let html = '<div class="list-group">';
        
        for (const id in _minimizedPanels) {
            const panel = _minimizedPanels[id];
            html += `
                <a href="#" class="list-group-item list-group-item-action" data-panel-id="${id}">
                    <div class="d-flex justify-content-between align-items-center">
                        <span>${panel.config.title || 'Panel'}</span>
                        <span class="badge bg-secondary">${panel.type}</span>
                    </div>
                </a>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
        
        // Add click handlers
        const items = container.querySelectorAll('.list-group-item');
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const panelId = e.target.closest('.list-group-item').dataset.panelId;
                restoreMinimizedPanel(panelId);
            });
        });
    }
    
    /**
     * Update the recently closed list in UI
     */
    function updateRecentlyClosedList() {
        const container = document.getElementById('recentlyClosedList');
        if (!container) return;
        
        if (_recentlyClosed.length === 0) {
            container.innerHTML = '<p class="text-muted">No recently closed panels</p>';
            return;
        }
        
        let html = '<div class="list-group">';
        
        for (let i = 0; i < _recentlyClosed.length; i++) {
            const panel = _recentlyClosed[i];
            const timeAgo = formatTimeAgo(panel.timestamp);
            
            html += `
                <a href="#" class="list-group-item list-group-item-action" data-index="${i}">
                    <div class="d-flex justify-content-between align-items-center">
                        <span>${panel.config.title || 'Panel'}</span>
                        <div>
                            <span class="badge bg-secondary me-2">${panel.type}</span>
                            <small class="text-muted">${timeAgo}</small>
                        </div>
                    </div>
                </a>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
        
        // Add click handlers
        const items = container.querySelectorAll('.list-group-item');
        items.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const index = parseInt(e.target.closest('.list-group-item').dataset.index);
                restoreClosedPanel(index);
            });
        });
    }
    
    /**
     * Format a timestamp as a relative time string
     * @param {Date} timestamp - Timestamp to format
     * @returns {string} - Formatted time string
     */
    function formatTimeAgo(timestamp) {
        const now = new Date();
        const diff = now - timestamp;
        
        // Convert to seconds
        const seconds = Math.floor(diff / 1000);
        
        if (seconds < 60) {
            return 'just now';
        }
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes}m ago`;
        }
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours}h ago`;
        }
        
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }
    
    /**
     * Create a plot panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {HTMLElement} - Panel content
     */
    function createPlotPanel(panelId, config) {
        const container = document.createElement('div');
        container.className = 'plot-container';
        
        // Create plot settings controls
        const settingsBar = document.createElement('div');
        settingsBar.className = 'plot-settings-bar d-flex align-items-center p-2 bg-light border-bottom';
        settingsBar.innerHTML = `
            <div class="plot-type-selector me-3">
                <select class="form-select form-select-sm" id="${panelId}-plot-type">
                    <option value="scatter" selected>Scatter Plot</option>
                    <option value="violin">Violin Plot</option>
                    <option value="heatmap">Heatmap</option>
                    <option value="box">Box Plot</option>
                    <option value="bar">Bar Chart</option>
                </select>
            </div>
            
            <div class="entity-type-selector me-3">
                <select class="form-select form-select-sm" id="${panelId}-entity-type">
                    <option value="cell" selected>Cell Plot</option>
                    <option value="gene">Gene Plot</option>
                </select>
            </div>
            
            <div class="axis-selector me-2 dropdown">
                <button class="btn btn-sm btn-outline-primary dropdown-toggle" type="button" id="${panelId}-x-axis-btn" data-bs-toggle="dropdown" aria-expanded="false">
                    X Axis
                </button>
                <div class="dropdown-menu axis-dropdown p-3" id="${panelId}-x-axis-dropdown" style="width: 300px;">
                    <h6 class="dropdown-header">Select X Axis Data</h6>
                    <div class="mb-2">
                        <input type="text" class="form-control form-control-sm" id="${panelId}-x-axis-search" placeholder="Search data fields...">
                    </div>
                    <div class="mb-2">
                        <select class="form-select form-select-sm" id="${panelId}-x-axis-category">
                            <!-- Options will be populated dynamically based on entity type -->
                        </select>
                    </div>
                    <div class="data-field-container mb-2" id="${panelId}-x-axis-fields">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <small class="text-muted">Loading available fields...</small>
                    </div>
                    <hr>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-secondary" id="${panelId}-x-axis-cancel">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="${panelId}-x-axis-apply">Apply</button>
                    </div>
                </div>
            </div>
            
            <div class="axis-selector me-2 dropdown">
                <button class="btn btn-sm btn-outline-primary dropdown-toggle" type="button" id="${panelId}-y-axis-btn" data-bs-toggle="dropdown" aria-expanded="false">
                    Y Axis
                </button>
                <div class="dropdown-menu axis-dropdown p-3" id="${panelId}-y-axis-dropdown" style="width: 300px;">
                    <h6 class="dropdown-header">Select Y Axis Data</h6>
                    <div class="mb-2">
                        <input type="text" class="form-control form-control-sm" id="${panelId}-y-axis-search" placeholder="Search data fields...">
                    </div>
                    <div class="mb-2">
                        <select class="form-select form-select-sm" id="${panelId}-y-axis-category">
                            <!-- Options will be populated dynamically based on entity type -->
                        </select>
                    </div>
                    <div class="data-field-container mb-2" id="${panelId}-y-axis-fields">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <small class="text-muted">Loading available fields...</small>
                    </div>
                    <hr>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-secondary" id="${panelId}-y-axis-cancel">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="${panelId}-y-axis-apply">Apply</button>
                    </div>
                </div>
            </div>
            
            <div class="axis-selector me-2 dropdown">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="${panelId}-z-axis-btn" data-bs-toggle="dropdown" aria-expanded="false">
                    Z Axis
                </button>
                <div class="dropdown-menu axis-dropdown p-3" id="${panelId}-z-axis-dropdown" style="width: 300px;">
                    <h6 class="dropdown-header">Select Z Axis Data</h6>
                    <div class="mb-2 d-flex justify-content-end">
                        <button class="btn btn-sm btn-outline-danger" id="${panelId}-z-axis-clear">
                            <i class="bi bi-x"></i> Clear Z Axis
                        </button>
                    </div>
                    <div class="mb-2">
                        <input type="text" class="form-control form-control-sm" id="${panelId}-z-axis-search" placeholder="Search data fields...">
                    </div>
                    <div class="mb-2">
                        <select class="form-select form-select-sm" id="${panelId}-z-axis-category">
                            <!-- Options will be populated dynamically based on entity type -->
                        </select>
                    </div>
                    <div class="data-field-container mb-2" id="${panelId}-z-axis-fields">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <small class="text-muted">Loading available fields...</small>
                    </div>
                    <hr>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-secondary" id="${panelId}-z-axis-cancel">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="${panelId}-z-axis-apply">Apply</button>
                    </div>
                </div>
            </div>
            
            <div class="axis-selector me-2 dropdown">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="${panelId}-color-btn" data-bs-toggle="dropdown" aria-expanded="false">
                    Color By
                </button>
                <div class="dropdown-menu axis-dropdown p-3" id="${panelId}-color-dropdown" style="width: 300px;">
                    <h6 class="dropdown-header">Select Color Data</h6>
                    <div class="mb-2 d-flex justify-content-end">
                        <button class="btn btn-sm btn-outline-danger" id="${panelId}-color-clear">
                            <i class="bi bi-x"></i> Clear Color
                        </button>
                    </div>
                    <div class="mb-2">
                        <input type="text" class="form-control form-control-sm" id="${panelId}-color-search" placeholder="Search data fields...">
                    </div>
                    <div class="mb-2">
                        <select class="form-select form-select-sm" id="${panelId}-color-category">
                            <!-- Options will be populated dynamically based on entity type -->
                        </select>
                    </div>
                    <div class="data-field-container mb-2" id="${panelId}-color-fields">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <small class="text-muted">Loading available fields...</small>
                    </div>
                    <div id="${panelId}-color-range-container" class="mb-2 d-none">
                        <label class="form-label small">Color Range</label>
                        <div class="d-flex align-items-center mb-1">
                            <input type="number" class="form-control form-control-sm me-2" id="${panelId}-color-min" placeholder="Min">
                            <input type="number" class="form-control form-control-sm" id="${panelId}-color-max" placeholder="Max">
                        </div>
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="${panelId}-color-clip" checked>
                            <label class="form-check-label small" for="${panelId}-color-clip">Clip values outside range</label>
                        </div>
                    </div>
                    <div id="${panelId}-color-scale-container" class="mb-2">
                        <label class="form-label small">Color Scale</label>
                        <select class="form-select form-select-sm" id="${panelId}-color-scale">
                            <option value="Viridis">Viridis (Sequential)</option>
                            <option value="Plasma">Plasma (Sequential)</option>
                            <option value="Inferno">Inferno (Sequential)</option>
                            <option value="RdBu">RdBu (Diverging)</option>
                            <option value="RdYlBu">RdYlBu (Diverging)</option>
                            <option value="Spectral">Spectral (Diverging)</option>
                            <option value="Set1">Set1 (Categorical)</option>
                            <option value="Set2">Set2 (Categorical)</option>
                            <option value="Paired">Paired (Categorical)</option>
                        </select>
                    </div>
                    <hr>
                    <div class="d-flex justify-content-between">
                        <button class="btn btn-sm btn-outline-secondary" id="${panelId}-color-cancel">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="${panelId}-color-apply">Apply</button>
                    </div>
                </div>
            </div>
            
            <div class="ms-auto">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="${panelId}-plot-settings-btn" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="bi bi-gear"></i> Settings
                </button>
                <div class="dropdown-menu p-3" style="width: 250px;">
                    <h6 class="dropdown-header">Plot Settings</h6>
                    <div class="mb-2">
                        <label class="form-label small">Marker Size</label>
                        <input type="range" class="form-range" id="${panelId}-marker-size" min="1" max="15" value="5">
                    </div>
                    <div class="mb-2">
                        <label class="form-label small">Marker Opacity</label>
                        <input type="range" class="form-range" id="${panelId}-marker-opacity" min="0.1" max="1" step="0.1" value="0.7">
                    </div>
                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" id="${panelId}-show-legend" checked>
                        <label class="form-check-label small" for="${panelId}-show-legend">Show Legend</label>
                    </div>
                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" id="${panelId}-grid-lines" checked>
                        <label class="form-check-label small" for="${panelId}-grid-lines">Show Grid Lines</label>
                    </div>
                    <hr>
                    <h6 class="dropdown-header">Hover Information</h6>
                    <div id="${panelId}-hover-fields" class="hover-fields-container mb-2">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="${panelId}-hover-name" checked>
                            <label class="form-check-label small" for="${panelId}-hover-name">Cell/Gene Name</label>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-secondary w-100" id="${panelId}-add-hover-field">
                        <i class="bi bi-plus"></i> Add Field
                    </button>
                </div>
            </div>
        `;
        
        container.appendChild(settingsBar);
        
        // Create plot container
        const plotDiv = document.createElement('div');
        plotDiv.id = `${panelId}-plot`;
        plotDiv.className = 'plot-area';
        plotDiv.style.height = 'calc(100% - 50px)';
        plotDiv.style.minHeight = '300px'; // Ensure minimum height for plot rendering
        plotDiv.style.width = '100%';      // Ensure full width
        container.appendChild(plotDiv);
        
        // Add a small delay to let the DOM fully render before initializing the plot
        setTimeout(() => {
            console.log(`Plot container dimensions: ${plotDiv.offsetWidth}x${plotDiv.offsetHeight}`);
        }, 100);
        
        // Set panel title if not provided
        if (!config.title) {
            const panelElement = document.getElementById(panelId);
            if (panelElement) {
                const titleElement = panelElement.querySelector('.panel-title');
                if (titleElement) {
                    titleElement.textContent = 'Plot';
                }
            }
        }
        
        // Add event handlers for axis and color selectors
        setTimeout(() => {
            initializePlotControls(panelId, config);
        }, 100);
        
        // Return the container
        return container;
    }
    
    /**
     * Initialize plot controls for a panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     */
    async function initializePlotControls(panelId, config) {
        console.log(`Initializing plot controls for panel ${panelId}`);
        
        try {
            const axes = ['x', 'y', 'z'];
            
            // Set up entity type selector
            const entityTypeSelect = document.getElementById(`${panelId}-entity-type`);
            let currentEntityType = config.entityType || 'cell'; // Default to cell plot
            
            if (entityTypeSelect) {
                // Initialize with current selection if available
                if (config.entityType) {
                    entityTypeSelect.value = config.entityType;
                }
                
                // Add change handler to update available categories
                entityTypeSelect.addEventListener('change', () => {
                    const newEntityType = entityTypeSelect.value;
                    currentEntityType = newEntityType;
                    
                    // Update config
                    const panel = _panels[panelId];
                    if (panel) {
                        panel.config.entityType = newEntityType;
                    }
                    
                    // Update available categories for all selectors
                    updateAvailableCategoriesForEntityType(panelId, newEntityType);
                });
            }
            
            // Set up each axis selector
            for (const axis of axes) {
                const categorySelect = document.getElementById(`${panelId}-${axis}-axis-category`);
                const searchInput = document.getElementById(`${panelId}-${axis}-axis-search`);
                const fieldsContainer = document.getElementById(`${panelId}-${axis}-axis-fields`);
                const applyButton = document.getElementById(`${panelId}-${axis}-axis-apply`);
                const cancelButton = document.getElementById(`${panelId}-${axis}-axis-cancel`);
                const axisButton = document.getElementById(`${panelId}-${axis}-axis-btn`);
                
                if (!categorySelect || !fieldsContainer) continue;
                
                // Initialize with current selection if available
                if (config[`${axis}Axis`] && config[`${axis}Axis`].path) {
                    const path = config[`${axis}Axis`].path;
                    const pathParts = path.split('/');
                    
                    if (pathParts.length >= 2) {
                        const category = pathParts[0];
                        const key = pathParts[1];
                        let label = config[`${axis}Axis`].label || `${key} ${axis.toUpperCase()}`;
                        
                        // Update dropdown button text and style
                        if (axisButton) {
                            axisButton.textContent = label;
                            // Set button style to indicate selection
                            axisButton.classList.remove('btn-outline-secondary');
                            axisButton.classList.add('btn-outline-primary');
                        }
                        
                        // Select the right category
                        if (categorySelect) {
                            const option = Array.from(categorySelect.options).find(opt => opt.value === category);
                            if (option) {
                                categorySelect.value = category;
                            }
                        }
                        
                        // Load the fields for this category
                        populateFieldsForCategory(category, fieldsContainer, searchInput, panelId, axis);
                    }
                }
                
                // Add category change handler
                if (categorySelect) {
                    categorySelect.addEventListener('change', () => {
                        const category = categorySelect.value;
                        populateFieldsForCategory(category, fieldsContainer, searchInput, panelId, axis);
                    });
                }
                
                // Add search handler
                if (searchInput) {
                    searchInput.addEventListener('input', () => {
                        const searchTerm = searchInput.value.toLowerCase();
                        const fieldItems = fieldsContainer.querySelectorAll('.field-item');
                        
                        fieldItems.forEach(item => {
                            const label = item.textContent.toLowerCase();
                            if (label.includes(searchTerm)) {
                                item.style.display = '';
                            } else {
                                item.style.display = 'none';
                            }
                        });
                    });
                }
                
                // Add clear button handler for Z axis
                if (axis === 'z') {
                    const clearButton = document.getElementById(`${panelId}-z-axis-clear`);
                    if (clearButton) {
                        clearButton.addEventListener('click', () => {
                            console.log(`Clearing Z axis for panel ${panelId}`);
                            
                            // Get panel
                            const panel = _panels[panelId];
                            if (panel) {
                                // Set the path to null to clear the Z axis
                                panel.config.zAxis = {
                                    path: null,
                                    index: null,
                                    label: null
                                };
                                
                                // Update the plot
                                if (window.PlotManager) {
                                    PlotManager.updatePlot(panelId, panel.config);
                                }
                                
                                // Update button text
                                const axisButton = document.getElementById(`${panelId}-z-axis-btn`);
                                if (axisButton) {
                                    axisButton.textContent = "Z Axis";
                                    // Reset button style when clearing
                                    axisButton.classList.remove('btn-outline-primary');
                                    axisButton.classList.add('btn-outline-secondary');
                                }
                                
                                // Close dropdown
                                const dropdown = bootstrap.Dropdown.getInstance(document.getElementById(`${panelId}-z-axis-btn`));
                                if (dropdown) {
                                    dropdown.hide();
                                }
                            }
                        });
                    }
                }
                
                // Add apply button handler
                if (applyButton) {
                    applyButton.addEventListener('click', () => {
                        const selectedField = fieldsContainer.querySelector('input[name="' + panelId + '-' + axis + '-field"]:checked');
                        if (selectedField) {
                            try {
                                const fieldInfo = JSON.parse(selectedField.dataset.fieldInfo);
                                console.log(`Selected field info:`, fieldInfo);
                                
                                // For obs columns, fix the type to ensure proper loading
                                if (categorySelect && categorySelect.value === 'obs') {
                                    // This fixes the issue with 'Age' loading
                                    console.log(`Detected obs selection, ensuring type is set to 'column'`);
                                    fieldInfo.type = 'column';
                                }
                                
                                // Apply selection first - important to update data before closing
                                applyAxisSelection(panelId, axis, fieldInfo);
                                
                                // Let the dropdown close naturally via Bootstrap's built-in behavior
                                // The button click will propagate and Bootstrap will handle closing
                            } catch (error) {
                                console.error(`Error applying axis selection:`, error);
                                alert(`Error applying selection: ${error.message}`);
                            }
                        }
                    });
                }
                
                // Add cancel button handler
                if (cancelButton) {
                    cancelButton.addEventListener('click', () => {
                        // Let Bootstrap handle closing the dropdown naturally
                        // No need to call hide() manually
                    });
                }
            }
            
            // Set up color selector
            const colorCategorySelect = document.getElementById(`${panelId}-color-category`);
            const colorSearchInput = document.getElementById(`${panelId}-color-search`);
            const colorFieldsContainer = document.getElementById(`${panelId}-color-fields`);
            const colorApplyButton = document.getElementById(`${panelId}-color-apply`);
            const colorCancelButton = document.getElementById(`${panelId}-color-cancel`);
            const colorButton = document.getElementById(`${panelId}-color-btn`);
            const colorRangeContainer = document.getElementById(`${panelId}-color-range-container`);
            const colorMinInput = document.getElementById(`${panelId}-color-min`);
            const colorMaxInput = document.getElementById(`${panelId}-color-max`);
            const colorClipCheckbox = document.getElementById(`${panelId}-color-clip`);
            const colorScaleSelect = document.getElementById(`${panelId}-color-scale`);
            
            if (colorCategorySelect && colorFieldsContainer) {
                // Initialize with current selection if available
                if (config.color && config.color.path) {
                    const path = config.color.path;
                    const pathParts = path.split('/');
                    
                    if (pathParts.length >= 2) {
                        const category = pathParts[0];
                        const key = pathParts[1];
                        let label = config.color.label || key;
                        
                        // Update dropdown button text and style
                        if (colorButton) {
                            colorButton.textContent = `Color: ${label}`;
                            // Set button style to indicate selection
                            colorButton.classList.remove('btn-outline-secondary');
                            colorButton.classList.add('btn-outline-primary');
                        }
                        
                        // Select the right category
                        const option = Array.from(colorCategorySelect.options).find(opt => opt.value === category);
                        if (option) {
                            colorCategorySelect.value = category;
                        }
                        
                        // Load the fields for this category
                        populateFieldsForCategory(category, colorFieldsContainer, colorSearchInput, panelId, 'color');
                        
                        // Setup color range if available
                        if (config.color.range && colorRangeContainer) {
                            colorRangeContainer.classList.remove('d-none');
                            if (colorMinInput && config.color.range[0] !== null) {
                                colorMinInput.value = config.color.range[0];
                            }
                            if (colorMaxInput && config.color.range[1] !== null) {
                                colorMaxInput.value = config.color.range[1];
                            }
                        }
                        
                        // Setup color clip option
                        if (colorClipCheckbox && config.color.clipValues !== undefined) {
                            colorClipCheckbox.checked = config.color.clipValues;
                        }
                        
                        // Setup color scale
                        if (colorScaleSelect && config.color.scale) {
                            const scaleOption = Array.from(colorScaleSelect.options).find(opt => opt.value === config.color.scale);
                            if (scaleOption) {
                                colorScaleSelect.value = config.color.scale;
                            }
                        }
                    }
                }
                
                // Add category change handler
                colorCategorySelect.addEventListener('change', () => {
                    const category = colorCategorySelect.value;
                    populateFieldsForCategory(category, colorFieldsContainer, colorSearchInput, panelId, 'color');
                });
                
                // Add search handler
                if (colorSearchInput) {
                    colorSearchInput.addEventListener('input', () => {
                        const searchTerm = colorSearchInput.value.toLowerCase();
                        const fieldItems = colorFieldsContainer.querySelectorAll('.field-item');
                        
                        fieldItems.forEach(item => {
                            const label = item.textContent.toLowerCase();
                            if (label.includes(searchTerm)) {
                                item.style.display = '';
                            } else {
                                item.style.display = 'none';
                            }
                        });
                    });
                }
                
                // Add clear button handler for Color
                const clearColorButton = document.getElementById(`${panelId}-color-clear`);
                if (clearColorButton) {
                    clearColorButton.addEventListener('click', () => {
                        console.log(`Clearing color for panel ${panelId}`);
                        
                        // Get panel
                        const panel = _panels[panelId];
                        if (panel) {
                            // Set the color path to null to clear the coloring
                            panel.config.color = {
                                path: null,
                                label: null,
                                scale: 'Viridis',
                                range: [null, null],
                                clipValues: true
                            };
                            
                            // Update the plot
                            if (window.PlotManager) {
                                PlotManager.updatePlot(panelId, panel.config);
                            }
                            
                            // Update button text and style
                            const colorButton = document.getElementById(`${panelId}-color-btn`);
                            if (colorButton) {
                                colorButton.textContent = "Color By";
                                // Reset button style when clearing
                                colorButton.classList.remove('btn-outline-primary');
                                colorButton.classList.add('btn-outline-secondary');
                            }
                            
                            // Close dropdown
                            const dropdown = bootstrap.Dropdown.getInstance(document.getElementById(`${panelId}-color-btn`));
                            if (dropdown) {
                                dropdown.hide();
                            }
                        }
                    });
                }
                
                // Add apply button handler
                if (colorApplyButton) {
                    colorApplyButton.addEventListener('click', () => {
                        const selectedField = colorFieldsContainer.querySelector('input[name="' + panelId + '-color-field"]:checked');
                        if (selectedField) {
                            try {
                                const fieldInfo = JSON.parse(selectedField.dataset.fieldInfo);
                                console.log(`Selected color field info:`, fieldInfo);
                                
                                // For obs columns, fix the type to ensure proper loading
                                if (colorCategorySelect && colorCategorySelect.value === 'obs') {
                                    // This fixes the issue with 'Age' loading
                                    console.log(`Detected obs selection for color, ensuring type is set to 'column'`);
                                    fieldInfo.type = 'column';
                                }
                                
                                // Get color range values
                                let colorRange = [null, null];
                                if (colorMinInput && colorMinInput.value !== '') {
                                    colorRange[0] = parseFloat(colorMinInput.value);
                                }
                                if (colorMaxInput && colorMaxInput.value !== '') {
                                    colorRange[1] = parseFloat(colorMaxInput.value);
                                }
                                
                                // Get clip option
                                const clipValues = colorClipCheckbox ? colorClipCheckbox.checked : true;
                                
                                // Get color scale
                                const colorScale = colorScaleSelect ? colorScaleSelect.value : 'Viridis';
                                
                                // Apply selection first - important to update data before closing
                                applyColorSelection(panelId, fieldInfo, colorRange, clipValues, colorScale);
                                
                                // Let the dropdown close naturally via Bootstrap's built-in behavior
                                // The button click will propagate and Bootstrap will handle closing
                            } catch (error) {
                                console.error(`Error applying color selection:`, error);
                                alert(`Error applying color selection: ${error.message}`);
                            }
                        }
                    });
                }
                
                // Add cancel button handler
                if (colorCancelButton) {
                    colorCancelButton.addEventListener('click', () => {
                        // Let Bootstrap handle closing the dropdown naturally
                        // No need to call hide() manually
                    });
                }
            }
            
            // Setup plot settings
            const markerSizeInput = document.getElementById(`${panelId}-marker-size`);
            const markerOpacityInput = document.getElementById(`${panelId}-marker-opacity`);
            const showLegendCheckbox = document.getElementById(`${panelId}-show-legend`);
            const gridLinesCheckbox = document.getElementById(`${panelId}-grid-lines`);
            
            if (markerSizeInput && config.marker && config.marker.size) {
                markerSizeInput.value = config.marker.size;
                markerSizeInput.addEventListener('change', () => {
                    const size = parseInt(markerSizeInput.value, 10);
                    updatePlotSetting(panelId, 'marker.size', size);
                });
            }
            
            if (markerOpacityInput && config.marker && config.marker.opacity) {
                markerOpacityInput.value = config.marker.opacity;
                markerOpacityInput.addEventListener('change', () => {
                    const opacity = parseFloat(markerOpacityInput.value);
                    updatePlotSetting(panelId, 'marker.opacity', opacity);
                });
            }
            
            if (showLegendCheckbox && config.layout) {
                showLegendCheckbox.checked = config.layout.showLegend !== false;
                showLegendCheckbox.addEventListener('change', () => {
                    updatePlotSetting(panelId, 'layout.showLegend', showLegendCheckbox.checked);
                });
            }
            
            if (gridLinesCheckbox && config.layout) {
                gridLinesCheckbox.checked = config.layout.showGrid !== false;
                gridLinesCheckbox.addEventListener('change', () => {
                    updatePlotSetting(panelId, 'layout.showGrid', gridLinesCheckbox.checked);
                });
            }
            
            // Initialize categories for the selected entity type
            updateAvailableCategoriesForEntityType(panelId, currentEntityType);
            
            // Load initial fields for first category in each selector
            populateFieldsForCategory(
                categorySelect ? categorySelect.value : 'obsm', 
                fieldsContainer, 
                searchInput,
                panelId,
                'x'
            );
            
            populateFieldsForCategory(
                document.getElementById(`${panelId}-y-axis-category`).value, 
                document.getElementById(`${panelId}-y-axis-fields`),
                document.getElementById(`${panelId}-y-axis-search`),
                panelId,
                'y'
            );
            
        } catch (error) {
            console.error('Error initializing plot controls:', error);
        }
    }
    
    /**
     * Update available categories based on entity type
     * @param {string} panelId - Panel ID
     * @param {string} entityType - Entity type ('cell' or 'gene')
     */
    function updateAvailableCategoriesForEntityType(panelId, entityType) {
        // Update all category selectors
        for (const selectorType of ['x-axis', 'y-axis', 'z-axis', 'color']) {
            const categorySelect = document.getElementById(`${panelId}-${selectorType}-category`);
            if (!categorySelect) continue;
            
            // Clear existing options
            categorySelect.innerHTML = '';
            
            // Add options based on entity type
            for (const [key, category] of Object.entries(DATA_CATEGORIES)) {
                // Only include categories that match the entity type or are for both
                if (category.entityType === entityType || category.entityType === 'both') {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = category.label;
                    categorySelect.appendChild(option);
                }
            }
            
            // Trigger change on the first element to update fields
            if (categorySelect.options.length > 0) {
                categorySelect.value = categorySelect.options[0].value;
                categorySelect.dispatchEvent(new Event('change'));
            }
        }
    }
    
    /**
     * Populate fields for a selected data category
     * @param {string} category - Data category (obsm, obs, etc.)
     * @param {HTMLElement} container - Container element for fields
     * @param {HTMLElement} searchInput - Search input element
     * @param {string} panelId - Panel ID
     * @param {string} axisType - Axis type ('x', 'y', 'z', 'color')
     */
    async function populateFieldsForCategory(category, container, searchInput, panelId, axisType) {
        if (!container) return;
        
        // Show loading indicator
        container.innerHTML = `
            <div class="text-center py-2">
                <div class="spinner-border spinner-border-sm" role="status"></div>
                <small class="text-muted ms-2">Loading fields...</small>
            </div>
        `;
        
        try {
            // Clear search
            if (searchInput) {
                searchInput.value = '';
            }
            
            // Get fields for category
            const categoryInfo = DATA_CATEGORIES[category];
            if (!categoryInfo || !categoryInfo.loadFields) {
                container.innerHTML = '<div class="text-muted">No fields available for this category</div>';
                return;
            }
            
            // Debug - get dataset info
            const datasetInfo = DataManager.getDatasetInfo();
            console.log(`Dataset info:`, datasetInfo);
            
            if (category === 'obs') {
                console.log(`Available obs columns:`, datasetInfo?.obs?.columns || []);
            } else if (category === 'var') {
                console.log(`Available var columns:`, datasetInfo?.var?.columns || []);
            } else if (category === 'obsm') {
                console.log(`Available obsm keys:`, datasetInfo?.obsm?.keys || []);
            }
            
            const fields = await categoryInfo.loadFields();
            console.log(`Loaded fields for ${category}:`, fields);
            
            if (!fields || fields.length === 0) {
                container.innerHTML = '<div class="text-muted">No fields available for this category</div>';
                return;
            }
            
            // Create field list
            let html = '<div class="field-list" style="max-height: 200px; overflow-y: auto;">';
            
            fields.forEach((field, index) => {
                const itemClass = field.requiresFocusedGene || field.requiresFocusedCell ? 'text-muted' : '';
                const isDisabled = (field.requiresFocusedGene && !DataManager.getFocusedGene()) || 
                                   (field.requiresFocusedCell && !DataManager.getFocusedCell());
                const disabledAttr = isDisabled ? 'disabled' : '';
                
                // Store field info as data attribute for easy retrieval
                const fieldInfoJson = JSON.stringify(field).replace(/"/g, "&quot;");
                
                html += `
                    <div class="field-item form-check mb-1 ${itemClass}">
                        <input class="form-check-input" type="radio" name="${panelId}-${axisType}-field" 
                               id="${panelId}-${axisType}-field-${index}" value="${index}" 
                               data-field-info="${fieldInfoJson}" ${disabledAttr}>
                        <label class="form-check-label" for="${panelId}-${axisType}-field-${index}">
                            ${field.label}
                        </label>
                    </div>
                `;
            });
            
            html += '</div>';
            
            // Set HTML
            container.innerHTML = html;
            
            // Add selection change handler for color range
            if (axisType === 'color') {
                const fieldRadios = container.querySelectorAll('input[name="' + panelId + '-color-field"]');
                const colorRangeContainer = document.getElementById(`${panelId}-color-range-container`);
                
                fieldRadios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        if (radio.checked && colorRangeContainer) {
                            // Get field type from the data attribute
                            const fieldInfo = JSON.parse(radio.dataset.fieldInfo);
                            
                            // Show color range for numerical data, hide for categorical
                            if (fieldInfo.type === 'matrix_dimension' || 
                                fieldInfo.type === 'expression' || 
                                fieldInfo.type === 'layer') {
                                colorRangeContainer.classList.remove('d-none');
                            } else {
                                colorRangeContainer.classList.add('d-none');
                            }
                        }
                    });
                });
            }
            
        } catch (error) {
            console.error(`Error populating fields for ${category}:`, error);
            container.innerHTML = `<div class="text-danger">Error loading fields: ${error.message}</div>`;
        }
    }
    
    /**
     * Apply axis selection
     * @param {string} panelId - Panel ID
     * @param {string} axis - Axis ('x', 'y', 'z')
     * @param {Object} fieldInfo - Field information
     */
    function applyAxisSelection(panelId, axis, fieldInfo) {
        console.log(`Applying ${axis} axis selection for panel ${panelId}:`, fieldInfo);
        
        // Extract numerical panel ID (handle both 'panel-0' and just '0' formats)
        const panelIdNum = panelId.replace('panel-', '');
        const fullPanelId = panelId.startsWith('panel-') ? panelId : `panel-${panelId}`;
        console.log(`Normalized panel ID: ${fullPanelId}`);
        
        // Get panel
        let panel = _panels[fullPanelId];
        if (!panel) {
            // Try alternate formats
            panel = _panels[panelIdNum] || _panels[`plot-${panelIdNum}`] || _panels[panelId];
            console.log(`Tried alternate panel IDs, found:`, panel ? 'panel' : 'nothing');
        }
        
        if (!panel) {
            console.error(`Panel not found: ${panelId} (or ${fullPanelId})`);
            return;
        }
        
        // Create axis config
        let path = '';
        let label = fieldInfo.label;
        
        switch (fieldInfo.type) {
            case 'matrix':
                path = `obsm/${fieldInfo.key}`;
                break;
                
            case 'matrix_dimension':
                path = `obsm/${fieldInfo.key}`;
                break;
                
            case 'dataframe_column':
                path = `${fieldInfo.key}/${fieldInfo.column}`;
                break;
                
            case 'column':
                path = `obs/${fieldInfo.key}`;
                break;
                
            case 'expression':
                path = 'X';
                break;
                
            case 'layer':
                path = `layers/${fieldInfo.key}`;
                break;
                
            case 'obsp':
                path = `obsp/${fieldInfo.key}`;
                break;
                
            case 'varp':
                path = `varp/${fieldInfo.key}`;
                break;
        }
        
        // Build the new axis configuration
        const axisConfig = {
            path: path,
            label: label
        };
        
        // Add index if applicable
        if (fieldInfo.type === 'matrix_dimension' && fieldInfo.index !== undefined) {
            axisConfig.index = fieldInfo.index;
        }
        
        // Update the panel config
        panel.config[`${axis}Axis`] = axisConfig;
        
        // Update button text and style
        const axisButton = document.getElementById(`${panelId}-${axis}-axis-btn`);
        if (axisButton) {
            axisButton.textContent = label;
            // Update button style to indicate selection
            axisButton.classList.remove('btn-outline-secondary');
            axisButton.classList.add('btn-outline-primary');
        } else {
            console.warn(`Axis button for ${axis} not found`);
        }
        
        // Update the plot - use plotId from the panel configuration if available,
        // otherwise try to construct it from the panel ID
        if (window.PlotManager) {
            console.log(`Updating plot with new ${axis} axis configuration:`, axisConfig);
            
            // Try to get the plot ID from various sources
            const plotElement = document.getElementById(`${fullPanelId}-plot`);
            if (plotElement && plotElement.id) {
                // Try updating using the element ID
                console.log(`Updating plot using element ID: ${plotElement.id}`);
                PlotManager.updatePlot(plotElement.id, panel.config);
            } else {
                // Try with the panel ID
                console.log(`Updating plot using panel ID: ${fullPanelId}`);
                PlotManager.updatePlot(fullPanelId, panel.config);
            }
        } else {
            console.error('PlotManager is not available');
        }
    }
    
    /**
     * Apply color selection
     * @param {string} panelId - Panel ID
     * @param {Object} fieldInfo - Field information
     * @param {Array} range - Color range [min, max]
     * @param {boolean} clipValues - Whether to clip values outside range
     * @param {string} scale - Color scale name
     */
    function applyColorSelection(panelId, fieldInfo, range, clipValues, scale) {
        console.log(`Applying color selection for panel ${panelId}:`, fieldInfo);
        
        // Extract numerical panel ID (handle both 'panel-0' and just '0' formats)
        const panelIdNum = panelId.replace('panel-', '');
        const fullPanelId = panelId.startsWith('panel-') ? panelId : `panel-${panelId}`;
        console.log(`Normalized panel ID: ${fullPanelId}`);
        
        // Get panel
        let panel = _panels[fullPanelId];
        if (!panel) {
            // Try alternate formats
            panel = _panels[panelIdNum] || _panels[`plot-${panelIdNum}`] || _panels[panelId];
            console.log(`Tried alternate panel IDs, found:`, panel ? 'panel' : 'nothing');
        }
        
        if (!panel) {
            console.error(`Panel not found: ${panelId} (or ${fullPanelId})`);
            return;
        }
        
        // Create color config
        let path = '';
        let label = fieldInfo.label;
        
        switch (fieldInfo.type) {
            case 'matrix':
                path = `obsm/${fieldInfo.key}`;
                break;
                
            case 'matrix_dimension':
                path = `obsm/${fieldInfo.key}`;
                break;
                
            case 'dataframe_column':
                path = `${fieldInfo.key}/${fieldInfo.column}`;
                break;
                
            case 'column':
                path = `obs/${fieldInfo.key}`;
                break;
                
            case 'expression':
                path = 'X';
                break;
                
            case 'layer':
                path = `layers/${fieldInfo.key}`;
                break;
                
            case 'obsp':
                path = `obsp/${fieldInfo.key}`;
                break;
                
            case 'varp':
                path = `varp/${fieldInfo.key}`;
                break;
        }
        
        // Build the new color configuration
        const colorConfig = {
            path: path,
            label: label,
            range: range,
            clipValues: clipValues,
            scale: scale
        };
        
        // Add index if applicable
        if (fieldInfo.type === 'matrix_dimension' && fieldInfo.index !== undefined) {
            colorConfig.index = fieldInfo.index;
        }
        
        // Update the panel config
        panel.config.color = colorConfig;
        
        // Update button text and style
        const colorButton = document.getElementById(`${panelId}-color-btn`);
        if (colorButton) {
            colorButton.textContent = `Color: ${label}`;
            // Update button style to indicate selection
            colorButton.classList.remove('btn-outline-secondary');
            colorButton.classList.add('btn-outline-primary');
        } else {
            console.warn(`Color button not found`);
        }
        
        // Update the plot - use plotId from the panel configuration if available,
        // otherwise try to construct it from the panel ID
        if (window.PlotManager) {
            console.log(`Updating plot with new color configuration:`, colorConfig);
            
            // Try to get the plot ID from various sources
            const plotElement = document.getElementById(`${fullPanelId}-plot`);
            if (plotElement && plotElement.id) {
                // Try updating using the element ID
                console.log(`Updating plot using element ID: ${plotElement.id}`);
                PlotManager.updatePlot(plotElement.id, panel.config);
            } else {
                // Try with the panel ID
                console.log(`Updating plot using panel ID: ${fullPanelId}`);
                PlotManager.updatePlot(fullPanelId, panel.config);
            }
        } else {
            console.error('PlotManager is not available');
        }
    }
    
    /**
     * Update a plot setting
     * @param {string} panelId - Panel ID
     * @param {string} path - Setting path (e.g., 'marker.size')
     * @param {any} value - Setting value
     */
    function updatePlotSetting(panelId, path, value) {
        // Get panel
        const panel = _panels[panelId];
        if (!panel) return;
        
        // Split path into parts
        const parts = path.split('.');
        let current = panel.config;
        
        // Navigate to the right level
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
        
        // Set the value
        current[parts[parts.length - 1]] = value;
        
        // Update the plot
        if (window.PlotManager) {
            PlotManager.updatePlot(panelId, panel.config);
        }
    }

    /**
     * Create a cell table panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {HTMLElement} - Panel content
     */
    function createCellTablePanel(panelId, config) {
        const container = document.createElement('div');
        container.className = 'table-container';
        
        // Create table toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar d-flex align-items-center p-2 bg-light border-bottom';
        toolbar.innerHTML = `
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-add-column-btn">
                    <i class="bi bi-plus"></i> Add Column
                </button>
            </div>
            
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-save-selection-btn">
                    <i class="bi bi-save"></i> Save Selection
                </button>
            </div>
            
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-export-btn">
                    <i class="bi bi-download"></i> Export
                </button>
            </div>
            
            <div class="ms-auto">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-apply-to-all-btn">
                    <i class="bi bi-arrow-repeat"></i> Apply to All Plots
                </button>
            </div>
        `;
        
        container.appendChild(toolbar);
        
        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-responsive';
        tableContainer.style.height = 'calc(100% - 50px)';
        
        // Create table
        const table = document.createElement('table');
        table.id = `${panelId}-table`;
        table.className = 'table table-striped table-hover';
        
        // Add basic structure
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Cell ID</th>
                    <th>Cluster</th>
                    <th>Total Counts</th>
                    <th>n_genes</th>
                    <th>percent_mito</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td colspan="5" class="text-center">Loading data...</td>
                </tr>
            </tbody>
        `;
        
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
        
        // Set panel title if not provided
        if (!config.title) {
            const panelElement = document.getElementById(panelId);
            if (panelElement) {
                const titleElement = panelElement.querySelector('.panel-title');
                if (titleElement) {
                    titleElement.textContent = 'Cells';
                }
            }
        }
        
        // Return the container
        return container;
    }
    
    /**
     * Create a gene table panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {HTMLElement} - Panel content
     */
    function createGeneTablePanel(panelId, config) {
        const container = document.createElement('div');
        container.className = 'table-container';
        
        // Create table toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'table-toolbar d-flex align-items-center p-2 bg-light border-bottom';
        toolbar.innerHTML = `
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-add-column-btn">
                    <i class="bi bi-plus"></i> Add Column
                </button>
            </div>
            
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-save-selection-btn">
                    <i class="bi bi-save"></i> Save Selection
                </button>
            </div>
            
            <div class="me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-export-btn">
                    <i class="bi bi-download"></i> Export
                </button>
            </div>
            
            <div class="ms-auto">
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-secondary" id="${panelId}-apply-to-all-btn">
                        <i class="bi bi-arrow-repeat"></i> Apply to All Plots
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" id="${panelId}-stringdb-btn">
                        <i class="bi bi-box-arrow-up-right"></i> StringDB
                    </button>
                </div>
            </div>
        `;
        
        container.appendChild(toolbar);
        
        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-responsive';
        tableContainer.style.height = 'calc(100% - 50px)';
        
        // Create table
        const table = document.createElement('table');
        table.id = `${panelId}-table`;
        table.className = 'table table-striped table-hover';
        
        // Add basic structure
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Gene ID</th>
                    <th>Symbol</th>
                    <th>Mean Expr</th>
                    <th>Dispersion</th>
                    <th>Highly Variable</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td colspan="5" class="text-center">Loading data...</td>
                </tr>
            </tbody>
        `;
        
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
        
        // Set panel title if not provided
        if (!config.title) {
            const panelElement = document.getElementById(panelId);
            if (panelElement) {
                const titleElement = panelElement.querySelector('.panel-title');
                if (titleElement) {
                    titleElement.textContent = 'Genes';
                }
            }
        }
        
        // Return the container
        return container;
    }
    
    /**
     * Create a gene set analysis panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {HTMLElement} - Panel content
     */
    function createGeneSetPanel(panelId, config) {
        const container = document.createElement('div');
        container.className = 'gene-set-container';
        
        // Create toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'd-flex align-items-center p-2 bg-light border-bottom';
        toolbar.innerHTML = `
            <div class="me-2">
                <span class="fw-bold">Gene Set:</span>
                <span id="${panelId}-gene-set-name">${config.setName || 'Unnamed Set'}</span>
                <span class="badge bg-info ms-1" id="${panelId}-gene-count">0 genes</span>
            </div>
            
            <div class="ms-auto">
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-secondary" id="${panelId}-enrich-btn">
                        <i class="bi bi-bar-chart"></i> Enrichment
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" id="${panelId}-export-btn">
                        <i class="bi bi-download"></i> Export
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" id="${panelId}-stringdb-btn">
                        <i class="bi bi-box-arrow-up-right"></i> StringDB
                    </button>
                </div>
            </div>
        `;
        
        container.appendChild(toolbar);
        
        // Create tabs
        const tabs = document.createElement('div');
        tabs.innerHTML = `
            <ul class="nav nav-tabs" id="${panelId}-tabs">
                <li class="nav-item">
                    <a class="nav-link active" data-bs-toggle="tab" href="#${panelId}-genes-tab">Genes</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#${panelId}-enrichment-tab">Enrichment</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" data-bs-toggle="tab" href="#${panelId}-resources-tab">Resources</a>
                </li>
            </ul>
            
            <div class="tab-content p-2" style="height: calc(100% - 90px); overflow-y: auto;">
                <div class="tab-pane fade show active" id="${panelId}-genes-tab">
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i> This panel will display genes in the set and their details.
                    </div>
                    <table class="table table-sm table-hover" id="${panelId}-genes-table">
                        <thead>
                            <tr>
                                <th>Gene</th>
                                <th>Symbol</th>
                                <th>Description</th>
                                <th>Links</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colspan="4" class="text-center">No genes in this set yet</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="tab-pane fade" id="${panelId}-enrichment-tab">
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i> Click the Enrichment button to analyze this gene set.
                    </div>
                </div>
                
                <div class="tab-pane fade" id="${panelId}-resources-tab">
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i> External resources for these genes will be shown here.
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(tabs);
        
        // Set panel title if not provided
        if (!config.title) {
            const panelElement = document.getElementById(panelId);
            if (panelElement) {
                const titleElement = panelElement.querySelector('.panel-title');
                if (titleElement) {
                    titleElement.textContent = 'Gene Set Analysis';
                }
            }
        }
        
        // Return the container
        return container;
    }
    
    /**
     * Handle dataset loaded event
     * @param {Event} event - Dataset loaded event
     */
    function handleDataLoaded(event) {
        // No action for now, panels will be created by user
    }
    
    /**
     * Add a new row of panels
     */
    function addPanelRow() {
        // Create a container for the row
        const row = document.createElement('div');
        row.className = 'row g-3 mb-3';
        
        // Add some options for panel types
        row.innerHTML = `
            <div class="col-12 text-center mb-3">
                <h5>Select panel type</h5>
            </div>
            <div class="col-md-4 col-sm-6">
                <div class="card h-100 panel-type-card" data-type="plot">
                    <div class="card-body text-center">
                        <i class="bi bi-graph-up fs-2 mb-2"></i>
                        <h5 class="card-title">Plot</h5>
                        <p class="card-text">Create interactive plots for data visualization</p>
                        <button class="btn btn-primary create-panel-btn">Create Plot</button>
                    </div>
                </div>
            </div>
            <div class="col-md-4 col-sm-6">
                <div class="card h-100 panel-type-card" data-type="cellTable">
                    <div class="card-body text-center">
                        <i class="bi bi-table fs-2 mb-2"></i>
                        <h5 class="card-title">Cells Table</h5>
                        <p class="card-text">Browse and filter cell data with search capabilities</p>
                        <button class="btn btn-primary create-panel-btn">Create Table</button>
                    </div>
                </div>
            </div>
            <div class="col-md-4 col-sm-6">
                <div class="card h-100 panel-type-card" data-type="geneTable">
                    <div class="card-body text-center">
                        <i class="bi bi-table fs-2 mb-2"></i>
                        <h5 class="card-title">Genes Table</h5>
                        <p class="card-text">Browse and filter gene data with search capabilities</p>
                        <button class="btn btn-primary create-panel-btn">Create Table</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add to container
        _container.appendChild(row);
        
        // Add event listeners
        const createButtons = row.querySelectorAll('.create-panel-btn');
        createButtons.forEach(button => {
            button.addEventListener('click', () => {
                const type = button.closest('.panel-type-card').dataset.type;
                createPanel(type);
                
                // Remove the row once a panel is created
                row.remove();
            });
        });
    }
    
    /**
     * Get the current panel layout state
     * @returns {Object} - Layout state
     */
    function getLayoutState() {
        const state = {
            panels: {},
            minimized: {},
            recentlyClosed: [..._recentlyClosed]
        };
        
        // Store active panels
        for (const id in _panels) {
            const panel = _panels[id];
            state.panels[id] = {
                type: panel.type,
                config: {...panel.config}
            };
        }
        
        // Store minimized panels
        for (const id in _minimizedPanels) {
            const panel = _minimizedPanels[id];
            state.minimized[id] = {
                type: panel.type,
                config: {...panel.config}
            };
        }
        
        return state;
    }
    
    /**
     * Restore the panel layout from a saved state
     * @param {Object} state - Layout state
     */
    function restoreLayoutState(state) {
        if (!state) return;
        
        // Clear existing panels
        for (const id in _panels) {
            const panel = _panels[id];
            if (panel.element && panel.element.parentNode) {
                panel.element.parentNode.removeChild(panel.element);
            }
        }
        
        _panels = {};
        _minimizedPanels = {};
        
        // Restore panels
        if (state.panels) {
            for (const id in state.panels) {
                const panelInfo = state.panels[id];
                createPanel(panelInfo.type, panelInfo.config);
            }
        }
        
        // Restore minimized panels
        if (state.minimized) {
            for (const id in state.minimized) {
                const panelInfo = state.minimized[id];
                const newId = createPanel(panelInfo.type, panelInfo.config);
                minimizePanel(newId);
            }
        }
        
        // Restore recently closed
        if (state.recentlyClosed) {
            _recentlyClosed = [...state.recentlyClosed];
            updateRecentlyClosedList();
        }
        
        // Show/hide container as needed
        if (Object.keys(_panels).length > 0) {
            _container.classList.remove('d-none');
            document.getElementById('emptyState').classList.add('d-none');
        } else {
            _container.classList.add('d-none');
            document.getElementById('emptyState').classList.remove('d-none');
        }
    }
    
    // Public API
    return {
        init,
        registerPanelType,
        createPanel,
        minimizePanel,
        closePanel,
        restoreMinimizedPanel,
        restoreClosedPanel,
        addPanelRow,
        getLayoutState,
        restoreLayoutState
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    PanelManager.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelManager;
} else {
    window.PanelManager = PanelManager;
}