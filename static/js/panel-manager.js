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
import { LayoutManager } from './layout-manager.js';
import { SelectionTile } from './selection-tile.js';
import { Config } from './config.js';

const PanelManager = (function() {
    // Private variables
    const _panels = new Map(); // All panels by ID
    const _panelsByType = new Map(); // Panels by type
    const _activePanels = new Set(); // Currently open panels
    const _panelTypes = new Map(); // Panel types (constructors)
    
    // Panel counters for generating unique IDs
    const _counters = {};
    
    // References to DOM elements
    let _container = null;
    let _welcomeSelectionTile = null;
    
    /**
     * Initialize the panel manager
     * @param {string} containerId - ID of the container element
     * @param {Object} options - Optional configuration options
     * @param {boolean} options.hasAutosave - Whether there's an autosave session
     */
    function init(containerId, options = {}) {
        _container = document.getElementById(containerId);
        
        if (!_container) {
            console.error(`Container element with ID "${containerId}" not found.`);
            return;
        }
        
        // Initialize counters from Config.PANEL_TYPES
        Config.PANEL_TYPES.forEach(panelType => {
            _counters[panelType.type] = 0;
        });
        
        // Initialize the LayoutManager with a callback to create selection tiles
        LayoutManager.init((parentElement) => {
            new SelectionTile({
                container: parentElement,
                variant: "pane",
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                counters: _counters,
                generateUniqueName: _generateUniqueName
            });
        });
        
        // If there's an autosave session, show a welcome tile with loading indication
        if (options.hasAutosave) {
            _welcomeSelectionTile = new SelectionTile({
                container: _container,
                variant: "welcome",
                showSessions: false,  // Don't show sessions section
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                counters: _counters,
                generateUniqueName: _generateUniqueName,
                sessionManager: window.sessionManager
            });
            
            // Customize the welcome tile to indicate autosave is loading
            const header = _welcomeSelectionTile.tileSelector.querySelector('.tile-selection-header');
            if (header) {
                header.innerHTML = `
                    <h2>Loading Dataset and Autosaved Panels</h2>
                    <p><div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div> Your previous panel set is being restored...</p>
                `;
            }
        }
        // Otherwise show the standard welcome tile
        else {
            _welcomeSelectionTile = new SelectionTile({
                container: _container,
                variant: "welcome",
                showSessions: true,
                panels: _panels,
                activePanels: _activePanels,
                layoutManager: LayoutManager,
                createPanel: createPanel,
                panelsByType: _panelsByType,
                counters: _counters,
                generateUniqueName: _generateUniqueName,
                sessionManager: window.sessionManager
            });
        }
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
    }
    
    
    
    /**
     * Generate a unique name to avoid collisions
     * @param {string} baseName - Original name
     * @param {string} [type] - Optional type for more specific naming
     * @returns {string} - Unique name
     * @private
     */
    function _generateUniqueName(baseName, type = null) {
        if (!baseName) {
            baseName = (type ? `${_formatPanelType(type)} ${_counters[type]}` : 'Panel 1');
        }
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
            const tableControls = contentContainer.querySelector('.table-controls');
            const controlsElement = plotControls || tableControls;
            
            if (controlsElement) {
                controlsElement.style.display = config.controlsVisible ? 'flex' : 'none';
                
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

   
    /**
     * Update all selection tiles when panels are added, removed, or modified
     */
    function updateSourcePanelSelection() {
        // First, find all selection tiles in the DOM
        const selectionTiles = document.querySelectorAll('.tile-selector');
        selectionTiles.forEach(tile => {
            // Get the SelectionTile instance from the element
            const instance = tile._selectionTileInstance;
            if (instance && typeof instance.updateSourcePanelGrid === 'function') {
                instance.updateSourcePanelGrid();
            }
        });
        
        // Also update the welcome selection tile if it exists
        if (_welcomeSelectionTile && typeof _welcomeSelectionTile.updateSourcePanelGrid === 'function') {
            _welcomeSelectionTile.updateSourcePanelGrid();
            
            // If we have panels and this is the welcome tile, show clone section
            if (_panels.size > 0) {
                _welcomeSelectionTile.hideHeader();
                _welcomeSelectionTile.toggleSessions(false);
            }
        }
        
        // Notify SessionManager about panel update to trigger autosave if enabled
        if (window.sessionManager && typeof window.sessionManager.notifyPanelUpdate === 'function') {
            window.sessionManager.notifyPanelUpdate();
        }
    }
    
    /**
     * Format panel type for display
     * @param {string} type - Panel type identifier
     * @returns {string} - Formatted panel type name
     * @private
     */
    function _formatPanelType(type) {
        // Use the label from centralized panel type definitions
        const panelType = Config.PANEL_TYPES.find(pt => pt.type === type);
        if (panelType && panelType.label) {
            return panelType.label;
        }
        
        // Fallback to original formatting
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
        
        // Find either plot-controls or table-controls element within the panel
        const plotControls = contentContainer.querySelector('.plot-controls');
        const tableControls = contentContainer.querySelector('.table-controls');
        
        // Determine which controls element to toggle
        const controlsElement = plotControls || tableControls;
        if (!controlsElement) return;
        
        // Toggle controls visibility
        const isVisible = controlsElement.style.display !== 'none';
        controlsElement.style.display = isVisible ? 'none' : (plotControls ? 'flex' : 'flex');
        
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
                const tableControls = contentContainer?.querySelector('.table-controls');
                const controlsElement = plotControls || tableControls;
                
                if (controlsElement) {
                    controlState[id] = controlsElement.style.display !== 'none';
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
                        const tableControls = contentContainer.querySelector('.table-controls');
                        const controlsElement = plotControls || tableControls;
                        
                        if (controlsElement) {
                            controlsElement.style.display = isVisible ? 'flex' : 'none';
                            
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
                    const newTitle = titleInput.value;
                    // Update the panel's title using the setTitle method
                    // This will update the internal title state of the panel
                    panel.setTitle(newTitle);
                    
                    // Update any selection tiles to show the new title
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
     * @param {string} [id] - Optional panel ID (will be generated if not provided)
     * @returns {Object} - The created panel instance
     */
    function registerClosedPanel(type, config, id = null) {
        if (!_panelTypes.has(type)) {
            console.error(`Unknown panel type: ${type}`);
            return null;
        }
        
        // Generate an ID if not provided using the same counter system for active and closed panels
        config.id = id || `${type}-${++_counters[type]}`;
        config.title = _generateUniqueName(config.title, type);

        // Create a "zombie" panel (stored but not active)
        const Constructor = _panelTypes.get(type);
        const dummyContainer = document.createElement('div'); // Will not be used
        
        const panel = new Constructor(dummyContainer, {
            id: config.id,
            title: config.title,
            ...config,
            _closed: true // Mark as closed
        });
        
        // Store reference but don't add to active panels
        _panels.set(config.id, panel);
        _panelsByType.get(type).add(panel);
        
        // Return the panel for additional operations
        return panel;
    }
    
    /**
     * Get all panels (both active and closed)
     * @returns {Array} - Array of all panel instances
     */
    function getAllPanels() {
        return Array.from(_panels.values());
    }
    
    /**
     * Get all active panels
     * @returns {Array} - Array of active panel instances
     */
    function getAllActivePanels() {
        // Return active panels or all panels if no active panels set exists
        return getActivePanels ? getActivePanels() : Array.from(_panels.values());
    }

    /**
     * Get the panel types map
     * @returns {Map} - Map of panel types
     */
    function getCounters() {
        return _counters;
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
        getAllActivePanels,
        getCounters,
        notifyPanels,
        resetPanels,
        saveLayout,
        restoreLayout,
        registerClosedPanel,
        updateSourcePanelSelection
    };
})();

// Export the module
export { PanelManager };