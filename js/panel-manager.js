/**
 * Panel Manager module for AnnZarro
 * Manages the tile-based panel system
 */
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
            addTileBtn.addEventListener('click', _showAddTileModal);
        }
        
        // Set up the create tile button in the modal
        const createTileBtn = document.getElementById('btn-create-tile');
        if (createTileBtn) {
            createTileBtn.addEventListener('click', _createTileFromModal);
        }
        
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
     * Show the add tile modal
     * @private
     */
    function _showAddTileModal() {
        // Update the source tile dropdown with current tiles
        const sourceSelect = document.getElementById('tile-source');
        sourceSelect.innerHTML = '<option value="">Create New</option>';
        
        // Add all existing panels as options
        _panels.forEach((panel, id) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = panel.getTitle();
            sourceSelect.appendChild(option);
        });
        
        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('add-tile-modal'));
        modal.show();
    }
    
    /**
     * Create a new tile based on the modal selections
     * @private
     */
    function _createTileFromModal() {
        const typeSelect = document.getElementById('tile-type');
        const sourceSelect = document.getElementById('tile-source');
        
        const type = typeSelect.value;
        const sourceId = sourceSelect.value;
        
        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('add-tile-modal')).hide();
        
        // Create the tile
        if (sourceId) {
            // Clone from existing tile
            const sourcePanel = _panels.get(sourceId);
            if (sourcePanel) {
                const config = sourcePanel.getConfig();
                createPanel(type, config);
            }
        } else {
            // Create new tile
            createPanel(type);
        }
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
        panel.init();
        
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
        const tile = document.querySelector(`.tile[data-tile-id="${id}"]`);
        if (!tile) return;
        
        // Get the original panel
        const panel = _panels.get(id);
        if (!panel) return;
        
        // Create a container for the split
        const splitContainer = document.createElement('div');
        splitContainer.className = `split-container split-${direction}`;
        
        // Clone the original tile for the second pane
        const newTile = _createTileElement(`${id}-clone`);
        
        // Move the original tile's content to the first pane
        const originalContent = tile.querySelector('.tile-content');
        const firstPane = document.createElement('div');
        firstPane.className = 'split-pane';
        
        // Create a handle for resizing
        const handle = document.createElement('div');
        handle.className = `split-handle ${direction === 'horizontal' ? 'horizontal' : 'vertical'}`;
        
        // Create the second pane
        const secondPane = document.createElement('div');
        secondPane.className = 'split-pane';
        
        // Append the elements to the split container
        firstPane.appendChild(originalContent);
        secondPane.appendChild(newTile);
        
        splitContainer.appendChild(firstPane);
        splitContainer.appendChild(handle);
        splitContainer.appendChild(secondPane);
        
        // Replace the original tile's content with the split container
        tile.appendChild(splitContainer);
        
        // Create a new panel of the same type in the second pane
        const config = panel.getConfig();
        config.title = `${panel.getTitle()} Copy`;
        
        const newPanel = createPanel(panel.getType(), config);
        
        // Set up resize handling
        _setupResizableHandle(handle, firstPane, secondPane, direction);
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
        
        // Remove from panels by type
        const type = panel.getType();
        if (_panelsByType.has(type)) {
            _panelsByType.get(type).delete(panel);
        }
        
        // Call cleanup on the panel
        panel.cleanup();
        
        // Remove from panels map
        _panels.delete(id);
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
    
    // Public API
    return {
        init,
        registerPanelType,
        createPanel,
        closePanel,
        getPanel,
        getPanelsByType,
        getActivePanels,
        notifyPanels,
        resetPanels
    };
})();

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PanelManager;
} else {
    window.PanelManager = PanelManager;
}