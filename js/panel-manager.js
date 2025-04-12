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
    let _updateSourcePanelSelection = null;
    
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
        
        // Initialize the LayoutManager with a callback to create selection tiles
        LayoutManager.init((parentElement) => {
            _createSelectionTileInPane(parentElement);
        });
        
        // Show welcome tile automatically if no panels exist
        setTimeout(() => {
            if (_panels.size === 0) {
                console.log('No panels exist, showing welcome tile...');
                _updateSourcePanelSelection = createBaseSelectionTile();
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
        if (!Object.prototype.hasOwnProperty.call(_counters, type)) {
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
            'cell-table': 'fas fa-solid fa-list-ul', // fa-table
            'gene-table': 'fas fa-th-list',
            'gene-set': 'fas fa-project-diagram'
        };
        
        return icons[type] || 'fas fa-cube';
    }
    
    /**
     * Create a selection tile at the bottom of the main container
     * @param {boolean} [showSessions=true] - Show sessions section
     * @returns {Function} - Function to update the source panel grid
     * @private
     */
    function createBaseSelectionTile(showSessions = true) {
        // Assign a unique ID for the selection tile
        const selectionTileId = 'base-selection-' + Date.now();
        
        // Create a tile selector element
        const tileSelector = document.createElement('div');
        tileSelector.className = 'tile-selector';
        tileSelector.dataset.tileId = selectionTileId;
        tileSelector.dataset.isSelectionTile = 'true';
        // Mark this selector so we know not to add a close button
        tileSelector.dataset.isBottomSelector = 'true';
        
        // Create the new streamlined selection container with explicit IDs to avoid selection issues
        const selectionId = Date.now(); // Use timestamp to ensure unique IDs
        tileSelector.innerHTML = `
            <div class="tile-selection-container">
                <div class="tile-selection-header">
                    <h2>Welcome to AnnZarro</h2>
                    <p>Get started by choosing a panel type</p>
                    <button class="tile-close-btn" id="close-selection-${selectionId}" title="Close">×</button>
                </div>
                
                <div class="selection-sections">
                    <!-- Panel Types Section -->
                    <div class="selection-section">
                        <h3>Create New Panel</h3>
                        <div class="tile-selection-grid" id="panel-type-grid-${selectionId}"></div>
                    </div>
                    
                    <!-- Clone from Source Section - Only shown when not the first tile -->
                    <div class="selection-section" id="clone-panel-section-${selectionId}" style="display: none;">
                        <h3>Clone Existing Panel</h3>
                        <div class="source-selection-grid" id="source-panel-grid-${selectionId}"></div>
                    </div>
                    
                    <!-- Sessions Section - Only shown on first tile/welcome screen -->
                    ${showSessions ? `
                    <div class="selection-section" id="selection-section-${selectionId}">
                        <h3>Load Saved Session</h3>
                        <div class="sessions-list" id="sessions-list-${selectionId}"></div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        function hideHeader() {
            const header = tileSelector.querySelector('.tile-selection-header');
            if (header) {
                header.style.display = 'none';
            }
        }
        
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
                    config.title = panel.getTitle();
                    const panelId = panel.getId();

                    if (panelId && !_activePanels.has(panel)) {
                        // First, remove from panels collection
                        const panel = _panels.get(panelId);
                        if (panel) {
                            const type = panel.getType();
                            if (_panelsByType.has(type)) {
                                _panelsByType.get(type).delete(panel);
                            }
                            _panels.delete(panelId);
                        }
                    } else {
                        config.title = _generateUniqueName(config.title);
                    }
                    populateSourcePanelGrid(grid);
                    
                    const parentContainer = tileSelector.parentElement;
                    if (!parentContainer) {
                        // Create panel with selection tile and resize handle
                        LayoutManager.createPanelWithSelectionTile(
                            _container, 
                            tileSelector, 
                            createPanel, 
                            panelType,
                            config
                        );
                    } else {
                        // Create panel in the specific container but still with resize handle
                        LayoutManager.createPanelWithSelectionTile(
                            parentContainer, 
                            tileSelector, 
                            createPanel, 
                            panelType,
                            config
                        );
                    }
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

        
        const sourcePanelGrid = tileSelector.querySelector(`#source-panel-grid-${selectionId}`);
        const clonePanelSection = tileSelector.querySelector(`#clone-panel-section-${selectionId}`);
        function updateSourcePanelGrid() {
            clonePanelSection.style.display = 'block';
            populateSourcePanelGrid(sourcePanelGrid);
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
                // Find the parent container (if any)
                const parentContainer = tileSelector.parentElement;
                
                let newPanel;
                // Always use the createPanelWithSelectionTile to ensure resize handle is added
                if (!parentContainer) {
                    // Create panel with selection tile and resize handle in the main container
                    newPanel = LayoutManager.createPanelWithSelectionTile(
                        _container, 
                        tileSelector, 
                        createPanel, 
                        panel.type
                    );
                } else {
                    // Create in the specific container but still with resize handle
                    newPanel = LayoutManager.createPanelWithSelectionTile(
                        parentContainer, 
                        tileSelector, 
                        createPanel, 
                        panel.type
                    );
                }
                
                hideHeader();
                const sessionsList = tileSelector.querySelector(`#selection-section-${selectionId}`);
                if (sessionsList) {
                    sessionsList.style.display = 'none';
                }
                
                console.log(`Created new panel of type ${panel.type} with ID ${newPanel.getId()}`);
            });
            
            panelTypeGrid.appendChild(panelOption);
        });
        
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
        
        // Hide close button handler
        const closeBtn = tileSelector.querySelector(`#close-selection-${selectionId}`);
        if (closeBtn) {
            closeBtn.style.display = 'none'; // Hide the close button
        } else {
            console.error(`Close button with ID close-selection-${selectionId} not found`);
        }
        return updateSourcePanelGrid;
    }
    
    /**
     * Generate a unique name to avoid collisions
     * @param {string} baseName - Original name
     * @returns {string} - Unique name
     * @private
     */
    function _generateUniqueName(baseName) {
        const existingNames = new Set();
        _panels.forEach(panel => {
            existingNames.add(panel.getTitle());
        });
        
        // If the base name doesn't exist, use it
        if (!existingNames.has(baseName)) {
            return baseName;
        }
        
        // Check if the base name ends with " (number)"
        const match = baseName.match(/^(.*)\s(\d+)$/);
        let counter = 1;
        let cleanBaseName = baseName;

        if (match) {
            cleanBaseName = match[1]; // Extract the base name without the number
            counter = parseInt(match[2], 10); // Use the extracted number as the starting counter
        }
        let newName = `${cleanBaseName} ${counter}`;
        
        while (existingNames.has(newName)) {
            counter++;
            newName = `${cleanBaseName} ${counter}`;
        }
        
        return newName;
    }
    
    /**
     * Creates a selection tile inside the given pane
     * @param {HTMLElement} pane - The pane to create the selection tile in
     * @returns {HTMLElement} - The created selection tile element
     * @private
     */
    function _createSelectionTileInPane(pane) {
        // Assign a unique ID for the selection tile
        const selectionTileId = 'selection-' + Date.now();
        // Create a tile selector element
        const tileSelector = document.createElement('div');
        tileSelector.className = 'tile-selector';
        tileSelector.dataset.tileId = selectionTileId;
        tileSelector.dataset.isSelectionTile = 'true';
        
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
                    config.title = panel.getTitle();
                    const panelId = panel.getId();

                    if (panelId && !_activePanels.has(panel)) {
                        // First, remove from panels collection
                        const panel = _panels.get(panelId);
                        if (panel) {
                            const type = panel.getType();
                            if (_panelsByType.has(type)) {
                                _panelsByType.get(type).delete(panel);
                            }
                            _panels.delete(panelId);
                        }
                    } else {
                        config.title = _generateUniqueName(config.title);
                    }
                    populateSourcePanelGrid(grid);
                    
                    // Find the parent pane
                    const parentPane = tileSelector.closest('.split-pane');
                    
                    // Create the cloned panel
                    createPanel(panelType, config, parentPane);
                    
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
        const sourcePanelGrid = tileSelector.querySelector(`#source-panel-grid-${selectionId}`);
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
                
                // Create a new panel in the parent pane
                const newId = `${panel.type}-${++_counters[panel.type]}`;
                const config = {
                    id: newId,
                    title: `${_formatPanelType(panel.type)} ${_counters[panel.type]}`
                };
                
                tileSelector.remove();
                // Create the panel in the parent pane
                createPanel(panel.type, config, parentPane);
            });
            
            panelTypeGrid.appendChild(panelOption);
        });
        
        // Populate source panels grid
        if (sourcePanelGrid) {
            populateSourcePanelGrid(sourcePanelGrid);
        }
        
        // Add close button handler
        const closeBtn = tileSelector.querySelector(`#close-selection-${selectionId}`);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                // Store reference to pane before removing the tile
                const parentPane = pane;
                
                // First remove the selection tile
                tileSelector.remove();
                
                // Then close the pane if needed
                if (parentPane) {
                    LayoutManager.closePanel(parentPane);
                }
            });
        } else {
            console.error(`Close button with ID close-selection-${selectionId} not found`);
        }
        
        return tileSelector;
    }
    
    /**
     * Create a new panel
     * @param {string} type - Panel type
     * @param {Object} config - Optional configuration
     * @param {HTMLElement} [targetContainer] - Optional container to place the panel in
     * @returns {Object} - The created panel instance
     */
    function createPanel(type, config = {}, targetContainer = null) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Generate a unique ID for the panel
        const id = config.id || `${type}-${++_counters[type]}`;
        
        // Create tile element
        const tileElement = _createTileElement(id);
        
        // Determine where to add the tile
        const container = targetContainer || _container;
        
        // Check if we're replacing a tile selector
        const tileSelector = container.querySelector('.tile-selector');
        if (tileSelector) {
            // Only replace non-bottom selectors
            if (!tileSelector.dataset.isBottomSelector) {
                // Replace the tile selector with the new tile
                container.insertBefore(tileElement, tileSelector);
                tileSelector.remove();
            } else {
                // If this is a bottom selector, insert before it but don't remove it
                container.insertBefore(tileElement, tileSelector);
            }
        } else {
            // Just add the tile to the container
            container.appendChild(tileElement);
        }
        
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
        
        const titleInput = tileElement.querySelector('.tile-title');
        if (titleInput && panel.getTitle) {
            titleInput.value = panel.getTitle();
        }

        // Set up all event handlers
        _setupTileEventHandlers(tileElement, id);
        
        // Initialize the panel
        panel.init();
        
        // Apply control panel visibility if specified
        if (Object.prototype.hasOwnProperty.call(config, 'controlsVisible')) {
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
        
        updateSourcePanelSelection();
        return panel;
    }

   
    function updateSourcePanelSelection() {
        if (typeof updateSourcePanelSelection === 'function') {
            _updateSourcePanelSelection();
        }
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
        
        // Get the parent container
        const parentContainer = tile.parentElement;
        if (!parentContainer) return;
        
        // Use the LayoutManager to create the split
        LayoutManager.createSplit(parentContainer, tile, direction);
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
            // Use the LayoutManager to properly close the panel and handle container cleanup
            LayoutManager.closePanel(tile);
        }
        
        // Remove from active panels
        _activePanels.delete(panel);
        
        // Store the panel configuration before cleanup
        const config = panel.getConfig();
        config.active = false; // Mark as closed
        
        // Call cleanup on the panel
        panel.cleanup();

        // Remove from source panels of bottom selection
        updateSourcePanelSelection();
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
     * This function only saves the layout structure and visual state, not panel data configurations
     * @returns {Object} - Layout configuration with hierarchy only
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
        
        // Control panel visibility is part of the layout visual state (not panel config)
        const controlState = {};
        _panels.forEach((panel, id) => {
            const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
            if (tileElement) {
                const contentContainer = tileElement.querySelector('.tile-content');
                const plotControls = contentContainer?.querySelector('.plot-controls');
                if (plotControls) {
                    controlState[id] = plotControls.style.display !== 'none';
                }
            }
        });
        
        const layout = {
            hierarchy: layoutHierarchy,
            controlState: controlState
        };
        
        console.log('Layout saved:', layout);
        return layout;
    }
    
    /**
     * Restore layout dimensions and structure
     * @param {Object} layout - Layout configuration
     * @returns {Promise<void>} - Promise that resolves when all panels are initialized
     */
    async function restoreLayout(layout) {
        if (!layout) return;
        
        console.log('Restoring layout:', layout);
        
        // Track currently active panels before restore
        const previouslyActivePanels = new Set(_activePanels);
        
        // Clear the active panels set - we'll repopulate it
        _activePanels.clear();
        
        // Collect panel IDs from the layout
        const panelIdsInLayout = new Set();
        
        // Clear the container
        if (_container) {
            _container.innerHTML = '';
        }
        
        // Function to extract panel IDs from hierarchy nodes
        function collectPanelIds(node) {
            if (!node) return;
            
            if (node.type === 'tile' && node.id) {
                panelIdsInLayout.add(node.id);
            } else if (node.type === 'split' && node.children) {
                node.children.forEach(child => collectPanelIds(child));
            }
        }
        
        // Handle new hierarchical format
        if (layout.hierarchy) {
            // Collect all panel IDs in the layout
            layout.hierarchy.forEach(node => collectPanelIds(node));
            
            // First pass: Build the DOM layout structure without initializing panels
            const rebuiltNodes = layout.hierarchy.map(node => 
                LayoutManager.rebuildLayoutFromHierarchy(
                    node, 
                    _container,
                    // Callback to create a tile element
                    (id) => _createTileElement(id),
                    // Empty callback - we'll initialize panels in second pass
                    () => {}
                )
            );
            
            // Set up all the handle resizing
            document.querySelectorAll('.split-handle').forEach(handle => {
                const container = handle.parentElement;
                const panes = container.querySelectorAll('.split-pane');
                
                if (panes.length === 2) {
                    const direction = container.dataset.splitDirection;
                    LayoutManager.setupResizableHandle(handle, panes[0], panes[1], direction);
                }
            });
            
            // Second pass: Initialize all panels in the layout
            const initializationPromises = [];
            
            for (const id of panelIdsInLayout) {
                const tileElement = document.querySelector(`.tile[data-tile-id="${id}"]`);
                if (!tileElement) continue;
                
                const contentContainer = tileElement.querySelector('.tile-content');
                if (!contentContainer) continue;
                
                // Extract panel type from ID
                const typeParts = id.split('-');
                const type = typeParts.slice(0, -1).join('-'); // everything before the last dash
                
                // Set up event handlers first
                _setupTileEventHandlers(tileElement, id);
                
                // Check if panel type is registered
                if (!_panelTypes.has(type)) {
                    console.error(`Unknown panel type: ${type} for panel id: ${id}`);
                    continue;
                }
                
                // Get existing panel or create a new one
                let panel = _panels.get(id);
                let promise;
                
                // Get the panel config from the layout
                const panelConfig = layout.panelConfigs && layout.panelConfigs[id] ? layout.panelConfigs[id] : { id };
                
                if (panel) {
                    // Update title
                    const titleInput = tileElement.querySelector('.tile-title');
                    if (titleInput && panel.getTitle) {
                        titleInput.value = panel.getTitle();
                    }
                    
                    // Apply control panel visibility state if available
                    if (layout.controlState && layout.controlState[id] !== undefined) {
                        const isVisible = layout.controlState[id];
                        const plotControls = contentContainer.querySelector('.plot-controls');
                        if (plotControls) {
                            plotControls.style.display = isVisible ? 'flex' : 'none';
                            
                            // Update toggle button
                            const toggleBtn = tileElement.querySelector('.tile-toggle-controls');
                            if (toggleBtn) {
                                const icon = toggleBtn.querySelector('i');
                                if (icon) {
                                    if (isVisible) {
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
                    
                    // Initialize asynchronously
                    promise = new Promise(resolve => {
                        // Use a microtask to ensure DOM is ready
                        Promise.resolve().then(() => {
                            try {
                                // Pass the complete panel configuration to avoid reinitializing with default settings
                                return panel.init();
                            } catch (error) {
                                console.error(`Error initializing restored panel ${id}:`, error);
                            }
                        }).then(resolve);
                    });
                    
                    // Add to active panels
                    _activePanels.add(panel);
                } else {
                    // Create a new panel instance
                    const Constructor = _panelTypes.get(type);
                    
                    // Create new panel with saved config
                    panel = new Constructor(contentContainer, panelConfig);
                    
                    // Update counter
                    const numericId = parseInt(typeParts[typeParts.length - 1], 10);
                    if (!isNaN(numericId) && numericId > _counters[type]) {
                        _counters[type] = numericId;
                    }
                    
                    // Store reference to the panel
                    _panels.set(id, panel);
                    _panelsByType.get(type).add(panel);
                    _activePanels.add(panel);
                    
                    // Update title in the DOM
                    const titleInput = tileElement.querySelector('.tile-title');
                    if (titleInput && panel.getTitle) {
                        titleInput.value = panel.getTitle();
                    }
                    
                    // Initialize asynchronously
                    promise = new Promise(resolve => {
                        Promise.resolve().then(() => {
                            try {
                                return panel.init();
                            } catch (error) {
                                console.error(`Error initializing new panel ${id}:`, error);
                            }
                        }).then(resolve);
                    });
                }
                
                initializationPromises.push(promise);
            }
            
            // Wait for all initializations to complete
            await Promise.all(initializationPromises);
            
            // Make panels that weren't in the layout inactive
            previouslyActivePanels.forEach(panel => {
                if (!panelIdsInLayout.has(panel.getId())) {
                    _activePanels.delete(panel);
                    // Don't delete from _panels so they're still available for cloning
                }
            });
        } 
        // Handle legacy formats
        else if (layout.tiles || layout.structure) {
            console.warn('Restoring from legacy layout format. Consider saving a new session.');
        } 
        else {
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
                    updateSourcePanelSelection();
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
        
        // Set up close handler - don't add close functionality to selection tiles
        const closeBtn = tileElement.querySelector('.tile-close');
        if (closeBtn) {
            if (tileElement.classList.contains('tile-selector') || 
                tileElement.dataset.isBottomSelector === 'true' ||
                tileElement.querySelector('.tile-selector[data-is-bottom-selector="true"]')) {
                // Hide close button for selection tiles
                closeBtn.style.display = 'none';
            } else {
                closeBtn.addEventListener('click', () => closePanel(id));
            }
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
        registerClosedPanel,
        createBaseSelectionTile,
        updateSourcePanelSelection
    };
})();

// Export the module
export { PanelManager };