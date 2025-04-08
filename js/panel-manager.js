/**
 * Panel Manager module for AnnZarro
 * Manages the tile-based panel system
 */
import { SessionManager } from './session-manager.js';

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
    
    // For tile splitting process
    let _pendingSplit = null;
    
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
        
        // Create split container
        const splitContainer = document.createElement('div');
        splitContainer.className = `split-container split-${direction}`;
        
        // Create the panes and handle
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'horizontal' ? 'horizontal' : 'vertical'}`;
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        
        // Move original content to first pane
        const originalContent = tile.querySelector('.tile-content');
        firstPane.appendChild(originalContent);
        
        // Assemble the split container
        splitContainer.appendChild(firstPane);
        splitContainer.appendChild(handle);
        splitContainer.appendChild(secondPane);
        
        // Replace the original content with the split container
        tile.appendChild(splitContainer);
        
        // Create new panel in second pane
        const config = sourceId ? 
            (_panels.get(sourceId)?.getConfig() || {}) : 
            { title: `${_formatPanelType(newPanelType)} ${_counters[newPanelType] + 1}` };
            
        // Create content container for the new panel
        const newContentContainer = document.createElement('div');
        newContentContainer.className = 'tile-content';
        secondPane.appendChild(newContentContainer);
        
        // Create the new panel
        const Constructor = _panelTypes.get(newPanelType);
        const newId = `${newPanelType}-${++_counters[newPanelType]}`;
        
        const newPanel = new Constructor(newContentContainer, {
            id: newId,
            ...config
        });
        
        // Register the panel
        _panels.set(newId, newPanel);
        _panelsByType.get(newPanelType).add(newPanel);
        _activePanels.add(newPanel);
        
        // Initialize the panel
        newPanel.init();
        
        // Set up the resize handle
        _setupResizableHandle(handle, firstPane, secondPane, direction);
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
        const id = `${type}-${++_counters[type]}`;
        
        // Create tile element
        const tileElement = _createTileElement(id);
        
        // Set initial size for the tile (needed for layout saving)
        tileElement.style.height = config.height || '1000px'; // Increased from 500px for better visualization
        
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
        
        // Update the title in the DOM
        const titleInput = tileElement.querySelector('.tile-title');
        titleInput.value = panel.getTitle();
        titleInput.addEventListener('change', () => {
            panel.setTitle(titleInput.value);
        });
        
        // Set up split handlers
        const splitHBtn = tileElement.querySelector('.tile-split-h');
        splitHBtn.addEventListener('click', () => _splitTile(id, 'horizontal'));
        
        const splitVBtn = tileElement.querySelector('.tile-split-v');
        splitVBtn.addEventListener('click', () => _splitTile(id, 'vertical'));
        
        // Set up close handler
        const closeBtn = tileElement.querySelector('.tile-close');
        closeBtn.addEventListener('click', () => closePanel(id));
        
        // Set up toggle controls handler
        const toggleControlsBtn = tileElement.querySelector('.tile-toggle-controls');
        toggleControlsBtn.addEventListener('click', () => _togglePanelControls(id, toggleControlsBtn));
        
        // Initialize the panel
        console.log(`Befor startin the init the settings are:`, panel.getConfig());
        panel.init();
        
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
    function _splitTile(id, direction) {
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Set up the pending split with default values (clone the current panel)
        _pendingSplit = {
            id,
            direction,
            panelType: panel.getType(),
            sourceId: id // Default to cloning the current panel
        };
        
        // Perform the split immediately with the same panel type
        _performSplit();
        return;
    }
    
    /**
     * Perform the actual tile split based on stored split info
     * @private
     */
    function _performSplit() {
        if (!_pendingSplit) return;
        
        const { id, direction, panelType, sourceId } = _pendingSplit;
        
        // Get the original tile and panel
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        const panel = _panels.get(id);
        if (!tile || !panel) return;
        
        // Create split container
        const splitContainer = document.createElement('div');
        splitContainer.className = `split-container split-${direction}`;
        
        // For vertical splits, use side-by-side layout
        if (direction === 'vertical') {
            splitContainer.style.flexDirection = 'row';
        } else {
            splitContainer.style.flexDirection = 'column';
        }
        
        // Create the panes and handle
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'horizontal' ? 'horizontal' : 'vertical'}`;
        
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        
        // Move original content to first pane
        const originalContent = tile.querySelector('.tile-content');
        firstPane.appendChild(originalContent);
        
        // Assemble the split container
        splitContainer.appendChild(firstPane);
        splitContainer.appendChild(handle);
        splitContainer.appendChild(secondPane);
        
        // Replace the original content with the split container
        tile.appendChild(splitContainer);
        
        // Create content container for the new panel
        const newContentContainer = document.createElement('div');
        newContentContainer.className = 'tile-content';
        secondPane.appendChild(newContentContainer);
        
        // Get config for the new panel
        let config = {};
        
        if (sourceId) {
            // Clone from source panel
            const sourcePanel = _panels.get(sourceId);
            if (sourcePanel) {
                config = sourcePanel.getConfig();
                // Avoid name collision
                if (sourceId !== id) {
                    config.title = _generateUniqueName(panelType, sourcePanel.getTitle());
                } else {
                    // When cloning from the same panel
                    config.title = `${panel.getTitle()} Copy`;
                }
            }
        }
        
        // Create the new panel
        const Constructor = _panelTypes.get(panelType);
        const newId = `${panelType}-${++_counters[panelType]}`;
        
        const newPanel = new Constructor(newContentContainer, {
            id: newId,
            ...config
        });
        
        // Store panel reference
        _panels.set(newId, newPanel);
        _panelsByType.get(panelType).add(newPanel);
        _activePanels.add(newPanel);
        
        // Initialize the panel
        newPanel.init();
        
        // Set up resize handling
        _setupResizableHandle(handle, firstPane, secondPane, direction);
        
        // Clear pending split
        _pendingSplit = null;
    }
    
    /**
     * Set up resizable handle for split panes
     * @param {HTMLElement} handle - The resize handle element
     * @param {HTMLElement} firstPane - First pane element
     * @param {HTMLElement} secondPane - Second pane element
     * @param {string} direction - Split direction ('horizontal' or 'vertical')
     * @private
     */
    function _setupResizableHandle(handle, firstPane, secondPane, direction) {
        let startPosition = 0;
        let startFirstSize = 0;
        let startSecondSize = 0;
        
        const onMouseDown = (e) => {
            e.preventDefault();
            
            // Store the starting position and sizes
            startPosition = direction === 'horizontal' ? e.clientX : e.clientY;
            startFirstSize = direction === 'horizontal' ? 
                firstPane.offsetWidth : firstPane.offsetHeight;
            startSecondSize = direction === 'horizontal' ? 
                secondPane.offsetWidth : secondPane.offsetHeight;
            
            // Add event listeners for dragging
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            // Add dragging class
            handle.classList.add('dragging');
        };
        
        const onMouseMove = (e) => {
            e.preventDefault();
            
            // Calculate the new position
            const currentPosition = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPosition - startPosition;
            
            // Calculate new sizes
            const newFirstSize = startFirstSize + delta;
            const newSecondSize = startSecondSize - delta;
            
            // Apply new sizes if they're valid (min size of 100px)
            if (newFirstSize > 100 && newSecondSize > 100) {
                if (direction === 'horizontal') {
                    firstPane.style.width = `${newFirstSize}px`;
                    secondPane.style.width = `${newSecondSize}px`;
                } else {
                    firstPane.style.height = `${newFirstSize}px`;
                    secondPane.style.height = `${newSecondSize}px`;
                }
            }
        };
        
        const onMouseUp = () => {
            // Remove event listeners
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // Remove dragging class
            handle.classList.remove('dragging');
        };
        
        // Set up the handle for dragging
        handle.addEventListener('mousedown', onMouseDown);
    }
    
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
     * Get all active panels
     * @returns {Array} - Array of active panel instances
     */
    function getActivePanels() {
        return Array.from(_activePanels);
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
     * Save the current layout dimensions
     * @returns {Object} - Layout configuration
     */
    function saveLayout() {
        const layout = {
            tiles: {},
            splits: {},
            panels: {} // Store panel-specific config that should persist
        };
        
        // Save tile heights and widths
        document.querySelectorAll('.tile').forEach(tile => {
            const id = tile.dataset.tileId;
            if (id) {
                // Get computed style if inline style is not available
                const computedStyle = window.getComputedStyle(tile);
                
                // Get the actual height/width, prioritizing inline styles
                const height = tile.style.height || computedStyle.height;
                const width = tile.style.width || computedStyle.width;
                
                // Store dimensions
                layout.tiles[id] = {
                    height: height,
                    width: width
                };
                
                // Also store in panel config
                const panel = _panels.get(id);
                if (panel) {
                    const config = panel.getConfig() || {};
                    layout.panels[id] = {
                        ...config,
                        height: height,
                        width: width
                    };
                }
                
                // Check for split containers in this tile
                const splitContainers = tile.querySelectorAll('.split-container');
                splitContainers.forEach((container, index) => {
                    const splitId = `${id}-split-${index}`;
                    const direction = container.classList.contains('split-horizontal') ? 'horizontal' : 'vertical';
                    const panes = container.querySelectorAll('.split-pane');
                    
                    if (panes.length === 2) {
                        // Get computed styles for panes
                        const pane1Style = window.getComputedStyle(panes[0]);
                        const pane2Style = window.getComputedStyle(panes[1]);
                        
                        // Prioritize inline styles over computed styles
                        layout.splits[splitId] = {
                            direction,
                            pane1: {
                                height: panes[0].style.height || pane1Style.height,
                                width: panes[0].style.width || pane1Style.width
                            },
                            pane2: {
                                height: panes[1].style.height || pane2Style.height,
                                width: panes[1].style.width || pane2Style.width
                            }
                        };
                    }
                });
            }
        });
        
        console.log('Layout saved:', layout);
        return layout;
    }
    
    /**
     * Restore layout dimensions
     * @param {Object} layout - Layout configuration
     */
    function restoreLayout(layout) {
        if (!layout) return;
        
        console.log('Restoring layout:', layout);
        
        // Handle both old format (flat object) and new format (tiles/splits)
        if (layout.tiles) {
            // New format
            // Restore tile dimensions
            Object.entries(layout.tiles).forEach(([id, dimensions]) => {
                const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
                if (tile) {
                    if (dimensions.height) {
                        tile.style.height = dimensions.height;
                    }
                    if (dimensions.width) {
                        tile.style.width = dimensions.width;
                    }
                } else {
                    console.log(`Tile with ID ${id} not found`);
                }
            });
            
            // Restore split container dimensions
            if (layout.splits) {
                Object.entries(layout.splits).forEach(([splitId, splitConfig]) => {
                    const [tileId] = splitId.split('-split-');
                    const tile = document.querySelector(`.tile[data-tile-id="${tileId}"]`);
                    
                    if (tile) {
                        const index = parseInt(splitId.split('-split-')[1]);
                        const splitContainers = tile.querySelectorAll('.split-container');
                        
                        if (index < splitContainers.length) {
                            const container = splitContainers[index];
                            const panes = container.querySelectorAll('.split-pane');
                            
                            if (panes.length === 2) {
                                // Apply dimensions to panes
                                const { pane1, pane2 } = splitConfig;
                                
                                if (pane1.height) panes[0].style.height = pane1.height;
                                if (pane1.width) panes[0].style.width = pane1.width;
                                
                                if (pane2.height) panes[1].style.height = pane2.height;
                                if (pane2.width) panes[1].style.width = pane2.width;
                            }
                        } else {
                            console.log(`Split container at index ${index} not found for tile ${tileId}`);
                        }
                    } else {
                        console.log(`Tile with ID ${tileId} not found for split ${splitId}`);
                    }
                });
            }
        } else {
            // Old format for backward compatibility
            Object.entries(layout).forEach(([id, dimensions]) => {
                const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
                if (tile) {
                    if (dimensions.height) {
                        tile.style.height = dimensions.height;
                    }
                    if (dimensions.width) {
                        tile.style.width = dimensions.width;
                    }
                } else {
                    console.log(`Tile with ID ${id} not found (old format)`);
                }
            });
        }
        
        console.log('Layout restoration completed');
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