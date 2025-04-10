/**
 * Panel Manager module for AnnZarro
 * Manages the tile-based panel system
 * 
 * This module has been refactored to:
 * 1. Use responsive layouts with flex for better resizing
 * 2. Improve session saving/restoration with proper hierarchy tracking
 * 3. Fix split functionality to correctly handle horizontal/vertical arrangements
 * 4. Reduce code duplication and improve structure
 */
import { SessionManager } from './session-manager.js';
import { LayoutManager } from './layout-manager.js';

// Constants for panel dimensions and behavior
const CONSTANTS = {
    DEFAULT_TILE_HEIGHT: '1000px',
    MIN_PANE_PERCENTAGE: 10,
    DEFAULT_SPLIT_RATIO: 50,
    MIN_VISIBLE_DIMENSION: 100
};

const PanelManager = (function() {
    // Private variables
    const _panels = new Map(); // All panels by ID
    const _panelsByType = new Map(); // Panels by type
    const _activePanels = new Set(); // Currently open panels
    const _panelTypes = new Map(); // Panel types (constructors)
    
    // Panel counters for generating unique IDs
    const _counters = {
        'cell-plot': 0,
        'gene-plot': 0,
        'cell-table': 0,
        'gene-table': 0,
        'gene-set': 0
    };
    
    // References to DOM elements
    let _container = null;
    
    /**
     * Initialize the panel manager
     * @param {string} containerId - ID of the container element
     */
    function init(containerId) {
        _container = document.getElementById(containerId);
        
        if (!_container) {
            console.error(`Container element with ID "${containerId}" not found.`);
            return;
        }
        
        // Set up the add tile button
        const addTileBtn = document.getElementById('btn-add-tile');
        if (addTileBtn) {
            addTileBtn.addEventListener('click', () => {
                _createSelectionTile();
            });
        }
        
        // Show welcome tile automatically if no panels exist
        // Use a longer timeout to ensure it works
        setTimeout(() => {
            if (_panels.size === 0) {
                console.log('No panels exist, showing welcome tile...');
                _createSelectionTile();
            }
        }, 500);

        console.log('Panel Manager initialized');
    }
    
    /**
     * Register a panel type
     * @param {string} type - Panel type identifier
     * @param {Function} constructor - Panel constructor function
     */
    function registerPanelType(type, constructor) {
        _panelTypes.set(type, constructor);
        _panelsByType.set(type, new Set());
        
        // Initialize counter if not already set
        if (!_counters.hasOwnProperty(type)) {
            _counters[type] = 0;
        }
        
        console.log(`Registered panel type: ${type}`);
    }
    
    /**
     * Get icon class for panel type
     * @param {string} type - Panel type
     * @returns {string} - Font Awesome icon class
     * @private
     */
    function _getPanelTypeIcon(type) {
        const icons = {
            'cell-plot': 'fas fa-microscope',
            'gene-plot': 'fas fa-dna',
            'cell-table': 'fas fa-solid fa-list-ul', // f a-table
            'gene-table': 'fas fa-th-list',
            'gene-set': 'fas fa-project-diagram'
        };
        
        return icons[type] || 'fas fa-cube';
    }
    
    /**
     * Create a tile selection UI
     * @private
     */
    function _createSelectionTile() {
        // Create a tile selector element
        const tileSelector = document.createElement('div');
        tileSelector.className = 'tile-selector';
        
        // Check if this is the first tile
        const isFirstTile = _panels.size === 0;
        
        // Create the new streamlined selection container with explicit IDs to avoid selection issues
        const selectionId = Date.now(); // Use timestamp to ensure unique IDs
        tileSelector.innerHTML = `
            <div class="tile-selection-container">
                <div class="tile-selection-header">
                    <h2>${isFirstTile ? 'Welcome to AnnZarro' : 'Add New Panel'}</h2>
                    <p>${isFirstTile ? 'Get started by choosing a panel type' : 'Choose a panel type'}</p>
                    <button class="tile-close-btn" id="close-selection-${selectionId}" title="Close">×</button>
                </div>
                
                <div class="selection-sections">
                    <!-- Panel Types Section -->
                    <div class="selection-section">
                        <h3>Create New Panel</h3>
                        <div class="tile-selection-grid" id="panel-type-grid-${selectionId}"></div>
                    </div>
                    
                    <!-- Clone from Source Section - Only shown when not the first tile -->
                    ${!isFirstTile ? `
                    <div class="selection-section">
                        <h3>Clone Existing Panel</h3>
                        <div class="source-selection-grid" id="source-panel-grid-${selectionId}"></div>
                    </div>
                    ` : ''}
                    
                    <!-- Sessions Section - Only shown on first tile/welcome screen -->
                    ${isFirstTile ? `
                    <div class="selection-section">
                        <h3>Load Saved Session</h3>
                        <div class="sessions-list" id="sessions-list-${selectionId}"></div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Add the selector to the container
        _container.appendChild(tileSelector);
        
        // Define panel types
        const panelTypes = [
            { type: 'cell-plot', label: 'Cell Plot', icon: 'fas fa-microscope' },
            { type: 'gene-plot', label: 'Gene Plot', icon: 'fas fa-dna' },
            { type: 'cell-table', label: 'Cell Table', icon: 'fas fa-solid fa-list-ul' },
            { type: 'gene-table', label: 'Gene Table', icon: 'fas fa-th-list' },
            { type: 'gene-set', label: 'Gene Set Analysis', icon: 'fas fa-project-diagram' }
        ];
        
        // Helper function to populate source panels grid
        function populateSourcePanelGrid(grid) {
            // Safety check for grid element
            if (!grid) {
                console.error('Source panel grid element not found');
                return;
            }
            
            // Clear the grid first
            grid.innerHTML = '';
            
            // Get all panels (active and stored closed panels)
            const allPanels = new Map([..._panels.entries()]);
            let hasPanels = false;
            
            // Add all panels to the grid
            allPanels.forEach((panel, id) => {
                hasPanels = true;
                const sourceOption = document.createElement('div');
                sourceOption.className = 'selection-panel-option source-panel-option';
                sourceOption.dataset.id = id;
                
                // Indicate if panel is closed
                if (!_activePanels.has(panel)) {
                    sourceOption.classList.add('closed-panel');
                }
                
                const typeIcon = _getPanelTypeIcon(panel.getType());
                sourceOption.innerHTML = `
                    <div class="tile-type-icon">
                        <i class="${typeIcon} fa-3x"></i>
                    </div>
                    <div class="tile-type-label">${panel.getTitle()}</div>
                    ${!_activePanels.has(panel) ? `
                        <div class="panel-status">Closed</div>
                        <button class="delete-panel-btn" data-id="${id}" title="Delete">×</button>
                    ` : ''}
                `;
                
                // Direct click creates a clone
                sourceOption.addEventListener('click', (e) => {
                    // Don't trigger if the delete button was clicked
                    if (e.target.classList.contains('delete-panel-btn') || 
                        e.target.closest('.delete-panel-btn')) {
                        return;
                    }
                    
                    // Get panel info
                    const config = panel.getConfig();
                    const panelType = panel.getType();
                    config.id = `${panelType}-${++_counters[panelType]}`;
                    
                    // Avoid name collision
                    config.title = _generateUniqueName(panelType, panel.getTitle());
                    
                    // Create panel based on source
                    createPanel(panelType, config);
                    
                    // Remove the selection tile
                    tileSelector.remove();
                });
                
                grid.appendChild(sourceOption);
            });
            
            // Add delete button handlers after all panels are added
            grid.querySelectorAll('.delete-panel-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent panel click
                    const panelId = button.dataset.id;
                    
                    if (panelId) {
                        // First, remove from panels collection
                        const panel = _panels.get(panelId);
                        if (panel) {
                            const type = panel.getType();
                            if (_panelsByType.has(type)) {
                                _panelsByType.get(type).delete(panel);
                            }
                            _panels.delete(panelId);
                        }
                        
                        // Then, refresh the source panel grid
                        populateSourcePanelGrid(grid);
                    }
                });
            });
            
            // Show message if no panels available
            if (!hasPanels) {
                grid.innerHTML = '<div class="no-sessions">No panels available to clone</div>';
            }
        }
        
        // Get the panel type grid with the unique ID
        const panelTypeGrid = tileSelector.querySelector(`#panel-type-grid-${selectionId}`);
        if (!panelTypeGrid) {
            console.error(`Panel type grid with ID panel-type-grid-${selectionId} not found`);
            return;
        }
        
        // Add panel type options - these create panels on click
        panelTypes.forEach(panel => {
            const panelOption = document.createElement('div');
            panelOption.className = 'selection-panel-option panel-type-option';
            panelOption.dataset.type = panel.type;
            panelOption.innerHTML = `
                <div class="tile-type-icon">
                    <i class="${panel.icon} fa-3x"></i>
                </div>
                <div class="tile-type-label">${panel.label}</div>
            `;
            
            // Direct click creates a panel
            panelOption.addEventListener('click', () => {
                // Create new panel of selected type
                createPanel(panel.type);
                
                // Remove the selection tile
                tileSelector.remove();
            });
            
            panelTypeGrid.appendChild(panelOption);
        });
        
        // Populate source panels grid if not the first tile
        if (!isFirstTile) {
            const sourcePanelGrid = tileSelector.querySelector(`#source-panel-grid-${selectionId}`);
            if (sourcePanelGrid) {
                populateSourcePanelGrid(sourcePanelGrid);
            }
        }
        
        // Only populate sessions on first tile
        if (isFirstTile) {
            const sessionsList = tileSelector.querySelector(`#sessions-list-${selectionId}`);
            if (sessionsList) {
                sessionsList.innerHTML = '<div class="no-sessions">Loading sessions...</div>';
                
                // Load and display sessions
                SessionManager.listSessions().then(sessions => {
                    if (sessions && sessions.length > 0) {
                        sessionsList.innerHTML = '';
                        
                        sessions.forEach(session => {
                            const sessionItem = document.createElement('div');
                            sessionItem.className = 'session-item';
                            sessionItem.innerHTML = `
                                <div class="session-info">
                                    <div class="session-name">${session.name}</div>
                                    <div class="session-date">${new Date(session.timestamp).toLocaleDateString()}</div>
                                    <div class="session-dataset">${session.datasetName || session.dataset}</div>
                                </div>
                            `;
                            
                            // Add click handler
                            sessionItem.addEventListener('click', async () => {
                                // Remove selection tile
                                tileSelector.remove();
                                
                                // Load the session
                                await SessionManager.loadSession(session.name);
                            });
                            
                            sessionsList.appendChild(sessionItem);
                        });
                    } else {
                        sessionsList.innerHTML = '<div class="no-sessions">No saved sessions available</div>';
                    }
                }).catch(error => {
                    console.error('Error loading sessions:', error);
                    sessionsList.innerHTML = '<div class="no-sessions">Error loading sessions</div>';
                });
            } else {
                console.error(`Sessions list with ID sessions-list-${selectionId} not found`);
            }
        }
        
        // Add close button handler
        const closeBtn = tileSelector.querySelector(`#close-selection-${selectionId}`);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                tileSelector.remove();
            });
        } else {
            console.error(`Close button with ID close-selection-${selectionId} not found`);
        }
        
        // We no longer have a clear sources button since each panel has its own delete button
        /* No longer needed
        const clearSourcesBtn = tileSelector.querySelector('#clear-sources');
        if (clearSourcesBtn) {
            clearSourcesBtn.addEventListener('click', () => {
        */
                /* Clear all button functionality removed, using individual delete buttons instead */
        
        // Scroll to the selection tile
        setTimeout(() => {
            tileSelector.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
    
    /**
     * Generate a unique name to avoid collisions
     * @param {string} type - Panel type
     * @param {string} baseName - Original name
     * @returns {string} - Unique name
     * @private
     */
    function _generateUniqueName(type, baseName) {
        const existingNames = new Set();
        _panels.forEach(panel => {
            existingNames.add(panel.getTitle());
        });
        
        // If the base name doesn't exist, use it
        if (!existingNames.has(baseName)) {
            return baseName;
        }
        
        // Otherwise, add a counter
        let counter = 1;
        let newName = `${baseName} (${counter})`;
        
        while (existingNames.has(newName)) {
            counter++;
            newName = `${baseName} (${counter})`;
        }
        
        return newName;
    }
    
    /**
     * Perform a tile split with the selected panel type
     * @param {string} id - ID of the tile to split
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @param {string} newPanelType - Type of panel to create in the second pane
     * @param {string} sourceId - Optional source panel ID to clone from
     * @private
     */
    function _performSplit(id, direction, newPanelType, sourceId) {
        // Get the original tile and panel
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        const panel = _panels.get(id);
        if (!tile || !panel) return;
        
        // Create a parent container for the two tiles
        const parentContainer = document.createElement('div');
        parentContainer.className = `split-container split-${direction}`;
        
        // Calculate initial percentages for split (50/50)
        if (direction === 'vertical') {
            parentContainer.style.flexDirection = 'row';
        } else {
            parentContainer.style.flexDirection = 'column';
        }
        
        // Create the panes and handle
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        firstPane.style.flex = '50%'; // Use percentage flex instead of fixed pixels
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'horizontal' ? 'horizontal' : 'vertical'}`;
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        secondPane.style.flex = '50%'; // Use percentage flex instead of fixed pixels
        
        // Create new tile for the second pane - this is a selection tile
        const selectorId = _createSelectionTileInPane(secondPane);
        
        // Move original tile to first pane
        tile.parentNode.insertBefore(parentContainer, tile);
        firstPane.appendChild(tile);
        
        // Assemble the parent container
        parentContainer.appendChild(firstPane);
        parentContainer.appendChild(handle);
        parentContainer.appendChild(secondPane);
        
        // Set up the resize handle with percentage-based sizing
        _setupResizableHandle(handle, firstPane, secondPane, direction);
    }
    
    /**
     * Creates a selection tile inside the given pane
     * @param {HTMLElement} pane - The pane to create the selection tile in
     * @returns {string} - ID of the created selection tile
     * @private
     */
    function _createSelectionTileInPane(pane) {
        // Create a tile selector element
        const tileSelector = document.createElement('div');
        tileSelector.className = 'tile-selector';
        
        // Create the new streamlined selection container
        const selectionId = Date.now(); // Use timestamp to ensure unique IDs
        tileSelector.innerHTML = `
            <div class="tile-selection-container">
                <div class="tile-selection-header">
                    <h2>Add New Panel</h2>
                    <p>Choose a panel type</p>
                    <button class="tile-close-btn" id="close-selection-${selectionId}" title="Close">×</button>
                </div>
                
                <div class="selection-sections">
                    <!-- Panel Types Section -->
                    <div class="selection-section">
                        <h3>Create New Panel</h3>
                        <div class="tile-selection-grid" id="panel-type-grid-${selectionId}"></div>
                    </div>
                    
                    <!-- Clone from Source Section -->
                    <div class="selection-section">
                        <h3>Clone Existing Panel</h3>
                        <div class="source-selection-grid" id="source-panel-grid-${selectionId}"></div>
                    </div>
                </div>
            </div>
        `;
        
        // Add the selector to the pane
        pane.appendChild(tileSelector);
        
        // Define panel types
        const panelTypes = [
            { type: 'cell-plot', label: 'Cell Plot', icon: 'fas fa-microscope' },
            { type: 'gene-plot', label: 'Gene Plot', icon: 'fas fa-dna' },
            { type: 'cell-table', label: 'Cell Table', icon: 'fas fa-solid fa-list-ul' },
            { type: 'gene-table', label: 'Gene Table', icon: 'fas fa-th-list' },
            { type: 'gene-set', label: 'Gene Set Analysis', icon: 'fas fa-project-diagram' }
        ];
        
        // Helper function to populate source panels grid
        function populateSourcePanelGrid(grid) {
            // Safety check for grid element
            if (!grid) {
                console.error('Source panel grid element not found');
                return;
            }
            
            // Clear the grid first
            grid.innerHTML = '';
            
            // Get all panels (active and stored closed panels)
            const allPanels = new Map([..._panels.entries()]);
            let hasPanels = false;
            
            // Add all panels to the grid
            allPanels.forEach((panel, id) => {
                hasPanels = true;
                const sourceOption = document.createElement('div');
                sourceOption.className = 'selection-panel-option source-panel-option';
                sourceOption.dataset.id = id;
                
                // Indicate if panel is closed
                if (!_activePanels.has(panel)) {
                    sourceOption.classList.add('closed-panel');
                }
                
                const typeIcon = _getPanelTypeIcon(panel.getType());
                sourceOption.innerHTML = `
                    <div class="tile-type-icon">
                        <i class="${typeIcon} fa-3x"></i>
                    </div>
                    <div class="tile-type-label">${panel.getTitle()}</div>
                    ${!_activePanels.has(panel) ? `
                        <div class="panel-status">Closed</div>
                        <button class="delete-panel-btn" data-id="${id}" title="Delete">×</button>
                    ` : ''}
                `;
                
                // Direct click creates a clone
                sourceOption.addEventListener('click', (e) => {
                    // Don't trigger if the delete button was clicked
                    if (e.target.classList.contains('delete-panel-btn') || 
                        e.target.closest('.delete-panel-btn')) {
                        return;
                    }
                    
                    // Get panel info
                    const config = panel.getConfig();
                    const panelType = panel.getType();
                    config.id = `${panelType}-${++_counters[panelType]}`;
                    
                    // Avoid name collision
                    config.title = _generateUniqueName(panelType, panel.getTitle());
                    
                    // Find the parent pane
                    const parentPane = tileSelector.closest('.split-pane');
                    
                    // Clear the tile selector
                    tileSelector.remove();
                    
                    // Create a new tile in the parent pane
                    const tileElement = _createTileElement(config.id);
                    parentPane.appendChild(tileElement);
                    
                    // Get the content container
                    const contentContainer = tileElement.querySelector('.tile-content');
                    
                    // Create panel instance
                    const Constructor = _panelTypes.get(panelType);
                    const newPanel = new Constructor(contentContainer, config);
                    
                    // Register the panel
                    _panels.set(config.id, newPanel);
                    _panelsByType.get(panelType).add(newPanel);
                    _activePanels.add(newPanel);
                    
                    // Update the title in the DOM
                    const titleInput = tileElement.querySelector('.tile-title');
                    titleInput.value = newPanel.getTitle();
                    titleInput.addEventListener('change', () => {
                        newPanel.setTitle(titleInput.value);
                    });
                    
                    // Set up split handlers
                    const splitHBtn = tileElement.querySelector('.tile-split-h');
                    splitHBtn.addEventListener('click', () => _splitTile(config.id, 'horizontal'));
                    
                    const splitVBtn = tileElement.querySelector('.tile-split-v');
                    splitVBtn.addEventListener('click', () => _splitTile(config.id, 'vertical'));
                    
                    // Set up close handler
                    const closeBtn = tileElement.querySelector('.tile-close');
                    closeBtn.addEventListener('click', () => closePanel(config.id));
                    
                    // Set up toggle controls handler
                    const toggleControlsBtn = tileElement.querySelector('.tile-toggle-controls');
                    toggleControlsBtn.addEventListener('click', () => _togglePanelControls(config.id, toggleControlsBtn));
                    
                    // Initialize the panel
                    newPanel.init();
                });
                
                grid.appendChild(sourceOption);
            });
            
            // Add delete button handlers after all panels are added
            grid.querySelectorAll('.delete-panel-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent panel click
                    const panelId = button.dataset.id;
                    
                    if (panelId) {
                        // First, remove from panels collection
                        const panel = _panels.get(panelId);
                        if (panel) {
                            const type = panel.getType();
                            if (_panelsByType.has(type)) {
                                _panelsByType.get(type).delete(panel);
                            }
                            _panels.delete(panelId);
                        }
                        
                        // Then, refresh the source panel grid
                        populateSourcePanelGrid(grid);
                    }
                });
            });
            
            // Show message if no panels available
            if (!hasPanels) {
                grid.innerHTML = '<div class="no-sessions">No panels available to clone</div>';
            }
        }
        
        // Get the panel type grid with the unique ID
        const panelTypeGrid = tileSelector.querySelector(`#panel-type-grid-${selectionId}`);
        if (!panelTypeGrid) {
            console.error(`Panel type grid with ID panel-type-grid-${selectionId} not found`);
            return;
        }
        
        // Add panel type options - these create panels on click
        panelTypes.forEach(panel => {
            const panelOption = document.createElement('div');
            panelOption.className = 'selection-panel-option panel-type-option';
            panelOption.dataset.type = panel.type;
            panelOption.innerHTML = `
                <div class="tile-type-icon">
                    <i class="${panel.icon} fa-3x"></i>
                </div>
                <div class="tile-type-label">${panel.label}</div>
            `;
            
            // Direct click creates a panel
            panelOption.addEventListener('click', () => {
                // Find the parent pane
                const parentPane = tileSelector.closest('.split-pane');
                
                // Remove the selection tile
                tileSelector.remove();
                
                // Create a new tile in the parent pane
                const newId = `${panel.type}-${++_counters[panel.type]}`;
                const tileElement = _createTileElement(newId);
                parentPane.appendChild(tileElement);
                
                // Get the content container
                const contentContainer = tileElement.querySelector('.tile-content');
                
                // Create panel instance
                const Constructor = _panelTypes.get(panel.type);
                const newPanel = new Constructor(contentContainer, {
                    id: newId,
                    title: `${_formatPanelType(panel.type)} ${_counters[panel.type]}`
                });
                
                // Register the panel
                _panels.set(newId, newPanel);
                _panelsByType.get(panel.type).add(newPanel);
                _activePanels.add(newPanel);
                
                // Update the title in the DOM
                const titleInput = tileElement.querySelector('.tile-title');
                titleInput.value = newPanel.getTitle();
                titleInput.addEventListener('change', () => {
                    newPanel.setTitle(titleInput.value);
                });
                
                // Set up split handlers
                const splitHBtn = tileElement.querySelector('.tile-split-h');
                splitHBtn.addEventListener('click', () => _splitTile(newId, 'horizontal'));
                
                const splitVBtn = tileElement.querySelector('.tile-split-v');
                splitVBtn.addEventListener('click', () => _splitTile(newId, 'vertical'));
                
                // Set up close handler
                const closeBtn = tileElement.querySelector('.tile-close');
                closeBtn.addEventListener('click', () => closePanel(newId));
                
                // Set up toggle controls handler
                const toggleControlsBtn = tileElement.querySelector('.tile-toggle-controls');
                toggleControlsBtn.addEventListener('click', () => _togglePanelControls(newId, toggleControlsBtn));
                
                // Initialize the panel
                newPanel.init();
            });
            
            panelTypeGrid.appendChild(panelOption);
        });
        
        // Populate source panels grid
        const sourcePanelGrid = tileSelector.querySelector(`#source-panel-grid-${selectionId}`);
        if (sourcePanelGrid) {
            populateSourcePanelGrid(sourcePanelGrid);
        }
        
        // Add close button handler
        const closeBtn = tileSelector.querySelector(`#close-selection-${selectionId}`);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                tileSelector.remove();
            });
        } else {
            console.error(`Close button with ID close-selection-${selectionId} not found`);
        }
        
        return selectionId;
    }
    
    /**
     * Create a new panel
     * @param {string} type - Panel type
     * @param {Object} config - Optional configuration
     * @returns {Object} - The created panel instance
     */
    function createPanel(type, config = {}) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Generate a unique ID for the panel
        const id = config.id || `${type}-${++_counters[type]}`;
        
        // Create tile element
        const tileElement = _createTileElement(id);
        
        // Set initial size for the tile (needed for layout saving)
        tileElement.style.height = config.height || CONSTANTS.DEFAULT_TILE_HEIGHT;
        
        // Add the tile to the container
        _container.appendChild(tileElement);
        
        // Get the content container
        const contentContainer = tileElement.querySelector('.tile-content');
        
        // Create panel instance
        const Constructor = _panelTypes.get(type);
        const panel = new Constructor(contentContainer, {
            id,
            title: config.title || `${_formatPanelType(type)} ${_counters[type]}`,
            ...config
        });
        
        // Store reference to the panel
        _panels.set(id, panel);
        _panelsByType.get(type).add(panel);
        _activePanels.add(panel);
        
        // Set up all event handlers
        _setupTileEventHandlers(tileElement, id);
        
        // Initialize the panel
        panel.init();
        
        // Apply control panel visibility if specified
        if (config.hasOwnProperty('controlsVisible')) {
            const plotControls = contentContainer.querySelector('.plot-controls');
            if (plotControls) {
                plotControls.style.display = config.controlsVisible ? 'flex' : 'none';
                
                // Update toggle button
                const toggleBtn = tileElement.querySelector('.tile-toggle-controls');
                if (toggleBtn) {
                    const icon = toggleBtn.querySelector('i');
                    if (icon) {
                        if (config.controlsVisible) {
                            icon.classList.remove('fa-chevron-down');
                            icon.classList.add('fa-chevron-up');
                            toggleBtn.title = 'Hide Controls';
                        } else {
                            icon.classList.remove('fa-chevron-up');
                            icon.classList.add('fa-chevron-down');
                            toggleBtn.title = 'Show Controls';
                        }
                    }
                }
            }
        }
        
        // Scroll the new panel into view
        setTimeout(() => {
            tileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        
        return panel;
    }
    
    /**
     * Format panel type for display
     * @param {string} type - Panel type identifier
     * @returns {string} - Formatted panel type name
     * @private
     */
    function _formatPanelType(type) {
        return type.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
    
    /**
     * Create a new tile DOM element
     * @param {string} id - Tile ID
     * @returns {HTMLElement} - The created tile element
     * @private
     */
    function _createTileElement(id) {
        const template = document.getElementById('tile-template');
        const tile = template.content.cloneNode(true).querySelector('.tile');
        tile.dataset.tileId = id;
        return tile;
    }
    
    /**
     * Toggle panel controls visibility
     * @param {string} id - ID of the panel
     * @param {HTMLElement} button - The toggle button element
     * @private
     */
    function _togglePanelControls(id, button) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
        const contentContainer = tileElement.querySelector('.tile-content');
        
        // Find the plot-controls element within the panel
        const plotControls = contentContainer.querySelector('.plot-controls');
        if (!plotControls) return;
        
        // Toggle controls visibility
        const isVisible = plotControls.style.display !== 'none';
        plotControls.style.display = isVisible ? 'none' : 'flex';
        
        // Store state in the panel's config for session saving
        const config = panel.getConfig() || {};
        config.controlsVisible = !isVisible;
        panel.updateConfig && panel.updateConfig(config);
        
        // Store state in the DOM for immediate reference
        const parentPane = tileElement.closest('.split-pane');
        if (parentPane) {
            parentPane.dataset.controlsVisible = !isVisible;
        }
        
        // Update button icon and title
        const icon = button.querySelector('i');
        if (isVisible) {
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
            button.title = 'Show Controls';
        } else {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
            button.title = 'Hide Controls';
        }
    }
    
    /**
     * Split a tile into two
     * @param {string} id - ID of the tile to split
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @private
     */
    /**
     * Split a tile into two panes
     * @param {string} id - ID of the tile to split
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @private
     */
    function _splitTile(id, direction) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Get the original tile
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (!tile) return;
        
        // Create a parent container for the two tiles
        const parentContainer = document.createElement('div');
        
        // IMPORTANT: For horizontal split button, we want side-by-side arrangement
        // For vertical split button, we want one-above-other arrangement
        // This matches user expectation for the button labels
        if (direction === 'vertical') {
            // One above the other (stacked vertically)
            parentContainer.className = 'split-container split-vertical';
            parentContainer.style.flexDirection = 'column';
            parentContainer.dataset.splitType = 'stacked'; // One above other
        } else {
            // Side by side (arranged horizontally)
            parentContainer.className = 'split-container split-horizontal';
            parentContainer.style.flexDirection = 'row';
            parentContainer.dataset.splitType = 'sideBySide'; // Side by side
        }
        
        // Create the panes and handle
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        firstPane.style.flex = '1'; // Using just flex: 1 for equal parts
        firstPane.dataset.flexPercentage = CONSTANTS.DEFAULT_SPLIT_RATIO;
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'vertical' ? 'horizontal' : 'vertical'}`;
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        secondPane.style.flex = '1'; // Using just flex: 1 for equal parts
        secondPane.dataset.flexPercentage = CONSTANTS.DEFAULT_SPLIT_RATIO;
        
        // Add minimum widths for horizontal splits
        if (direction === 'horizontal') {
            firstPane.style.minWidth = '100px';
            secondPane.style.minWidth = '100px';
        }
        
        // Create new tile for the second pane - this is a selection tile
        const selectorId = _createSelectionTileInPane(secondPane);
        
        // Move original tile to first pane
        tile.parentNode.insertBefore(parentContainer, tile);
        firstPane.appendChild(tile);
        
        // Assemble the parent container
        parentContainer.appendChild(firstPane);
        parentContainer.appendChild(handle);
        parentContainer.appendChild(secondPane);
        
        // Set up the resize handle using the LayoutManager
        LayoutManager.setupResizableHandle(handle, firstPane, secondPane, direction);
        
        // Add data attributes to track the original arrangement
        parentContainer.dataset.splitDirection = direction;
    }
    
    
    // _setupResizableHandle has been removed and moved to LayoutManager.setupResizableHandle
    
    /**
     * Close a panel
     * @param {string} id - Panel ID
     */
    function closePanel(id) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Remove from DOM
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (tile) {
            // Check if this is part of a split view
            const splitContainer = tile.closest('.split-container');
            if (splitContainer) {
                // If in a split view, replace the split with the other pane
                const parentTile = splitContainer.closest('.tile');
                const otherPane = splitContainer.querySelector('.split-pane:not(:has(.tile[data-tile-id="${id}"]))');
                
                if (parentTile && otherPane) {
                    // Move content from other pane to parent tile
                    const otherContent = otherPane.firstChild;
                    parentTile.replaceChild(otherContent, splitContainer);
                }
            } else {
                // Simple case: just remove the tile
                tile.remove();
            }
        }
        
        // Remove from active panels
        _activePanels.delete(panel);
        
        // Store the panel configuration before cleanup
        const config = panel.getConfig();
        config.active = false; // Mark as closed
        
        // Call cleanup on the panel
        panel.cleanup();
        
        // Leave panel in the panels map and panelsByType for potential cloning
        // Instead, we just mark it as inactive by removing it from _activePanels
        console.log(`Panel ${id} closed but stored for potential cloning`);
    }
    
    /**
     * Get a panel by ID
     * @param {string} id - Panel ID
     * @returns {Object} - Panel instance
     */
    function getPanel(id) {
        return _panels.get(id);
    }
    
    /**
     * Get all panels of a specific type
     * @param {string} type - Panel type
     * @returns {Array} - Array of panel instances
     */
    function getPanelsByType(type) {
        return Array.from(_panelsByType.get(type) || []);
    }
    
    /**
     * Notify panels of a data update
     * @param {string} updateType - Type of update
     * @param {Object} data - Update data
     */
    function notifyPanels(updateType, data) {
        _activePanels.forEach(panel => {
            if (typeof panel.onDataUpdate === 'function') {
                panel.onDataUpdate(updateType, data);
            }
        });
    }
    
    /**
     * Reset all panels
     */
    function resetPanels() {
        // Close all panels
        Array.from(_panels.keys()).forEach(id => {
            closePanel(id);
        });
        
        // Clear the container
        if (_container) {
            _container.innerHTML = '';
        }
    }
    
    /**
     * Get all active panels
     * @returns {Array} - Array of active panel instances
     */
    function getActivePanels() {
        return Array.from(_activePanels);
    }
    
    /**
     * Save the current layout dimensions and structure
     * @returns {Object} - Layout configuration
     */
    function saveLayout() {
        // Use the LayoutManager to build a hierarchical representation of the layout
        const mainContainer = document.getElementById('main-container') || _container;
        const layoutHierarchy = [];
        
        // Process each root element in the container
        Array.from(mainContainer.children).forEach(element => {
            const node = LayoutManager.buildLayoutHierarchy(element);
            if (node) {
                layoutHierarchy.push(node);
            }
        });
        
        // Add panel-specific config to the layout
        const panelConfigs = {};
        _panels.forEach((panel, id) => {
            panelConfigs[id] = panel.getConfig() || {};
            
            // Check for control panel visibility
            const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
            if (tileElement) {
                const contentContainer = tileElement.querySelector('.tile-content');
                const plotControls = contentContainer?.querySelector('.plot-controls');
                if (plotControls) {
                    panelConfigs[id].controlsVisible = plotControls.style.display !== 'none';
                }
            }
        });
        
        const layout = {
            hierarchy: layoutHierarchy,
            panels: panelConfigs
        };
        
        console.log('Layout saved:', layout);
        return layout;
    }
    
    /**
     * Restore layout dimensions and structure
     * @param {Object} layout - Layout configuration
     */
    function restoreLayout(layout) {
        if (!layout) return;
        
        console.log('Restoring layout:', layout);
        
        // Clear the container
        if (_container) {
            _container.innerHTML = '';
        }
        
        // Handle new hierarchical format
        if (layout.hierarchy) {
            layout.hierarchy.forEach(node => {
                LayoutManager.rebuildLayoutFromHierarchy(
                    node, 
                    _container,
                    // Callback to create a tile element
                    (id) => {
                        return _createTileElement(id);
                    },
                    // Callback to create a panel instance
                    (id, tileElement) => {
                        // Extract the panel type from the id
                        const typeParts = id.split('-');
                        const type = typeParts.slice(0, -1).join('-'); // everything before the last dash
                        const panelConfig = layout.panels[id] || {};
                        
                        // Check if panel type is registered
                        if (!_panelTypes.has(type)) {
                            console.error(`Unknown panel type: ${type} for panel id: ${id}`);
                            return;
                        }
                        
                        // Get existing panel or create a new one
                        let panel = _panels.get(id);
                        
                        if (panel) {
                            // Re-initialize existing panel with the new tile element
                            const contentContainer = tileElement.querySelector('.tile-content');
                            
                            // Update title
                            const titleInput = tileElement.querySelector('.tile-title');
                            if (titleInput && panel.getTitle()) {
                                titleInput.value = panel.getTitle();
                            }
                            
                            // Set up event handlers
                            _setupTileEventHandlers(tileElement, id);
                            
                            // Re-initialize the panel with the new container
                            if (panel.reinitialize && typeof panel.reinitialize === 'function') {
                                panel.reinitialize(contentContainer, panelConfig);
                            } else {
                                // Fall back to init if reinitialize is not available
                                panel.init();
                            }
                            
                            // Re-add to active panels
                            _activePanels.add(panel);
                        } else {
                            // Create a new panel instance
                            const contentContainer = tileElement.querySelector('.tile-content');
                            const Constructor = _panelTypes.get(type);
                            
                            // Create new panel
                            panel = new Constructor(contentContainer, {
                                id,
                                ...panelConfig,
                                title: panelConfig.title || `${_formatPanelType(type)} ${_counters[type]}`
                            });
                            
                            // Update counter
                            const numericId = parseInt(typeParts[typeParts.length - 1], 10);
                            if (!isNaN(numericId) && numericId > _counters[type]) {
                                _counters[type] = numericId;
                            }
                            
                            // Store reference to the panel
                            _panels.set(id, panel);
                            _panelsByType.get(type).add(panel);
                            _activePanels.add(panel);
                            
                            // Set up event handlers
                            _setupTileEventHandlers(tileElement, id);
                            
                            // Initialize the panel
                            panel.init();
                            
                            // Update title in the DOM
                            const titleInput = tileElement.querySelector('.tile-title');
                            if (titleInput) {
                                titleInput.value = panel.getTitle();
                            }
                        }
                    }
                );
            });
            
            // Set up all the handle resizing
            document.querySelectorAll('.split-handle').forEach(handle => {
                const container = handle.parentElement;
                const panes = container.querySelectorAll('.split-pane');
                
                if (panes.length === 2) {
                    const direction = container.dataset.splitDirection;
                    LayoutManager.setupResizableHandle(handle, panes[0], panes[1], direction);
                }
            });
        } 
        // Handle legacy formats
        else if (layout.tiles || layout.structure) {
            console.warn('Restoring from legacy layout format. Consider saving a new session.');
            
            // Create panels based on saved configuration
            if (layout.panels) {
                Object.entries(layout.panels).forEach(([id, config]) => {
                    if (!_panels.has(id)) {
                        // Extract panel type from ID
                        const typeParts = id.split('-');
                        const type = typeParts.slice(0, -1).join('-'); // everything before the last dash
                        
                        // Create the panel if its type is registered
                        if (_panelTypes.has(type)) {
                            createPanel(type, config);
                        }
                    }
                });
            }
        } else {
            console.warn('Unknown layout format.');
        }
        
        console.log('Layout restoration completed');
    }
    
    /**
     * Set up event handlers for a tile
     * @param {HTMLElement} tileElement - The tile element
     * @param {string} id - The panel ID
     * @private
     */
    function _setupTileEventHandlers(tileElement, id) {
        // Update the title in the DOM
        const titleInput = tileElement.querySelector('.tile-title');
        if (titleInput) {
            titleInput.addEventListener('change', () => {
                const panel = _panels.get(id);
                if (panel) {
                    panel.setTitle(titleInput.value);
                }
            });
        }
        
        // Set up split handlers
        const splitHBtn = tileElement.querySelector('.tile-split-h');
        if (splitHBtn) {
            splitHBtn.addEventListener('click', () => _splitTile(id, 'horizontal'));
        }
        
        const splitVBtn = tileElement.querySelector('.tile-split-v');
        if (splitVBtn) {
            splitVBtn.addEventListener('click', () => _splitTile(id, 'vertical'));
        }
        
        // Set up close handler
        const closeBtn = tileElement.querySelector('.tile-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => closePanel(id));
        }
        
        // Set up toggle controls handler
        const toggleControlsBtn = tileElement.querySelector('.tile-toggle-controls');
        if (toggleControlsBtn) {
            toggleControlsBtn.addEventListener('click', () => _togglePanelControls(id, toggleControlsBtn));
        }
    }

    /**
     * Register a closed panel for potential future cloning
     * @param {string} type - Panel type
     * @param {Object} config - Panel configuration
     * @param {string} id - Optional panel ID (will be generated if not provided)
     */
    function registerClosedPanel(type, config, id) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return;
        }
        
        // Generate an ID if not provided
        const panelId = id || `${type}-${++_counters[type]}`;
        
        // Create a "zombie" panel (stored but not active)
        const Constructor = _panelTypes.get(type);
        const dummyContainer = document.createElement('div'); // Will not be used
        
        const panel = new Constructor(dummyContainer, {
            id: panelId,
            title: config.title || `${_formatPanelType(type)} ${_counters[type]}`,
            ...config,
            _closed: true // Mark as closed
        });
        
        // Store reference but don't add to active panels
        _panels.set(panelId, panel);
        _panelsByType.get(type).add(panel);
        
        console.log(`Registered closed panel: ${panelId}`);
    }
    
    /**
     * Get all panels (both active and closed)
     * @returns {Array} - Array of all panel instances
     */
    function getAllPanels() {
        return Array.from(_panels.values());
    }
    
    // Public API
    return {
        init,
        registerPanelType,
        createPanel,
        closePanel,
        getPanel,
        getPanelsByType,
        getActivePanels,
        getAllPanels,
        notifyPanels,
        resetPanels,
        saveLayout,
        restoreLayout,
        registerClosedPanel
    };
})();

// Export the module
export { PanelManager };