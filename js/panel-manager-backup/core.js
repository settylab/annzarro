/**
 * Panel Manager Core Module
 * 
 * Handles the core panel management functionality
 */

// Global variable for this module
window.core = (function() {
    // Private variables
    let _container;
    let _panels = {};
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
        
        // Initialize minimized panels container
        const minimizedContainer = document.createElement('div');
        minimizedContainer.id = 'minimizedPanelsContainer';
        minimizedContainer.className = 'minimized-panels-container';
        document.body.appendChild(minimizedContainer);
        
        // Add recently closed panels dropdown to navbar if it doesn't exist
        if (!document.getElementById('recentlyClosedDropdown')) {
            const navbarNav = document.getElementById('navbarNav');
            if (navbarNav) {
                const recentlyClosedItem = document.createElement('li');
                recentlyClosedItem.className = 'nav-item dropdown';
                recentlyClosedItem.innerHTML = `
                    <a class="nav-link dropdown-toggle" href="#" id="recentlyClosedDropdown" role="button" data-bs-toggle="dropdown">
                        <i class="bi bi-recycle"></i> Recently Closed
                    </a>
                    <ul class="dropdown-menu" id="recentlyClosedList">
                        <li><span class="dropdown-item disabled">No recently closed panels</span></li>
                    </ul>
                `;
                navbarNav.appendChild(recentlyClosedItem);
            }
        }
    }
    
    /**
     * Register a panel type
     * @param {string} type - Panel type
     * @param {Function} factory - Panel factory function
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
        // Ensure container is visible
        _container.classList.remove('d-none');
        document.getElementById('emptyState').classList.add('d-none');
        
        // Generate panel ID
        const panelId = `panel-${Date.now()}`;
        
        // Create panel row if needed
        let rowElement = _container.querySelector('.panel-row:last-child');
        if (!rowElement || rowElement.children.length >= 2) {
            rowElement = addPanelRow();
        }
        
        // Create panel using factory
        if (!_panelTypes[type]) {
            console.error(`Panel type not registered: ${type}`);
            return null;
        }
        
        // Create panel element
        const panelElement = document.createElement('div');
        panelElement.className = 'panel-container col-md-6';
        panelElement.id = panelId;
        rowElement.appendChild(panelElement);
        
        // Create the panel using its factory
        const panel = _panelTypes[type](panelId, config);
        
        // Store panel in registry
        _panels[panelId] = {
            id: panelId,
            type: type,
            element: panelElement,
            config: panel.config || config
        };
        
        // Return panel ID
        return panelId;
    }
    
    /**
     * Add a new panel row
     * @returns {HTMLElement} - Row element
     */
    function addPanelRow() {
        const row = document.createElement('div');
        row.className = 'panel-row row g-3 mb-3';
        _container.appendChild(row);
        return row;
    }
    
    /**
     * Minimize a panel
     * @param {string} panelId - Panel ID
     */
    function minimizePanel(panelId) {
        const panel = _panels[panelId];
        if (!panel) return;
        
        // Store panel and hide it
        _minimizedPanels[panelId] = panel;
        panel.element.style.display = 'none';
        
        // Remove from panels registry
        delete _panels[panelId];
        
        // Add to minimized container
        const minimizedContainer = document.getElementById('minimizedPanelsContainer');
        if (minimizedContainer) {
            const badge = document.createElement('div');
            badge.className = 'minimized-panel-badge';
            badge.dataset.panelId = panelId;
            badge.innerHTML = `
                <span class="panel-type">${panel.type}</span>
                <button class="btn-restore" onclick="PanelManager.restoreMinimizedPanel('${panelId}')">
                    <i class="bi bi-arrows-angle-expand"></i>
                </button>
            `;
            minimizedContainer.appendChild(badge);
        }
    }
    
    /**
     * Restore a minimized panel
     * @param {string} panelId - Panel ID
     */
    function restoreMinimizedPanel(panelId) {
        const panel = _minimizedPanels[panelId];
        if (!panel) return;
        
        // Show panel
        panel.element.style.display = '';
        
        // Re-add to panels registry
        _panels[panelId] = panel;
        
        // Remove from minimized
        delete _minimizedPanels[panelId];
        
        // Remove badge
        const badge = document.querySelector(`[data-panel-id="${panelId}"]`);
        if (badge) badge.remove();
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
            id: panelId,
            type: panel.type,
            config: panel.config
        });
        
        // Keep only a limited number of closed panels
        if (_recentlyClosed.length > _maxRecentClosed) {
            _recentlyClosed.pop();
        }
        
        // Update recently closed list
        updateRecentlyClosedList();
        
        // Remove from DOM
        panel.element.remove();
        
        // Remove from registry
        delete _panels[panelId];
        
        // Check if we need to hide container
        if (Object.keys(_panels).length === 0) {
            _container.classList.add('d-none');
            document.getElementById('emptyState').classList.remove('d-none');
        }
    }
    
    /**
     * Update the recently closed panels list
     */
    function updateRecentlyClosedList() {
        const list = document.getElementById('recentlyClosedList');
        if (!list) return;
        
        list.innerHTML = '';
        
        if (_recentlyClosed.length === 0) {
            list.innerHTML = '<li><span class="dropdown-item disabled">No recently closed panels</span></li>';
            return;
        }
        
        for (const panel of _recentlyClosed) {
            const item = document.createElement('li');
            item.innerHTML = `
                <a class="dropdown-item" href="#" onclick="PanelManager.restoreClosedPanel('${panel.id}'); return false;">
                    ${panel.type} panel
                </a>
            `;
            list.appendChild(item);
        }
    }
    
    /**
     * Restore a recently closed panel
     * @param {string} panelId - Panel ID
     */
    function restoreClosedPanel(panelId) {
        const panelIndex = _recentlyClosed.findIndex(p => p.id === panelId);
        if (panelIndex === -1) return;
        
        const panel = _recentlyClosed[panelIndex];
        
        // Remove from recently closed
        _recentlyClosed.splice(panelIndex, 1);
        updateRecentlyClosedList();
        
        // Create a new panel with the same config
        createPanel(panel.type, panel.config);
    }
    
    /**
     * Get the current layout state
     * @returns {Object} - Layout state
     */
    function getLayoutState() {
        const state = {
            panels: {},
            minimized: {..._minimizedPanels},
            recentlyClosed: [..._recentlyClosed]
        };
        
        // Add panel info
        for (const id in _panels) {
            const panel = _panels[id];
            state.panels[id] = {
                type: panel.type,
                config: panel.config
            };
        }
        
        return state;
    }
    
    /**
     * Restore layout from state
     * @param {Object} state - Layout state
     */
    function restoreLayoutState(state) {
        if (!state) return;
        
        // Clear current layout
        _container.innerHTML = '';
        _panels = {};
        _minimizedPanels = {};
        _recentlyClosed = [];
        
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

// No CommonJS export needed, using window.core