/**
 * Panel Manager Module
 * 
 * Handles panel creation, layout, and management for the application
 */

const PanelManager = (function() {
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
            
            <div class="axis-selector me-2">
                <button class="btn btn-sm btn-outline-primary" id="${panelId}-x-axis-btn">
                    X Axis <i class="bi bi-chevron-down"></i>
                </button>
            </div>
            
            <div class="axis-selector me-2">
                <button class="btn btn-sm btn-outline-primary" id="${panelId}-y-axis-btn">
                    Y Axis <i class="bi bi-chevron-down"></i>
                </button>
            </div>
            
            <div class="axis-selector me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-z-axis-btn">
                    Z Axis <i class="bi bi-chevron-down"></i>
                </button>
            </div>
            
            <div class="axis-selector me-2">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-color-btn">
                    Color By <i class="bi bi-chevron-down"></i>
                </button>
            </div>
            
            <div class="ms-auto">
                <button class="btn btn-sm btn-outline-secondary" id="${panelId}-plot-settings-btn">
                    <i class="bi bi-gear"></i> Settings
                </button>
            </div>
        `;
        
        container.appendChild(settingsBar);
        
        // Create plot container
        const plotDiv = document.createElement('div');
        plotDiv.id = `${panelId}-plot`;
        plotDiv.className = 'plot-area';
        plotDiv.style.height = 'calc(100% - 50px)';
        container.appendChild(plotDiv);
        
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
        
        // Add axis selector event handlers
        // (In a real implementation, these would open dropdowns for selecting data)
        
        // Return the container
        return container;
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