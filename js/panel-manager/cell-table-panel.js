/**
 * Cell Table Panel Module
 * 
 * Handles the creation and management of cell table panels
 */

// Define the cell table panel module
(function() {
    // Import dependencies from ModuleSystem
    const { PANEL_TYPES } = window.ModuleSystem.require('PanelManager.Constants');
    
    /**
     * Create a cell table panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {Object} - Panel object
     */
    function createCellTablePanel(panelId, config = {}) {
        const panel = document.getElementById(panelId);
        if (!panel) {
            console.error(`Panel element not found: ${panelId}`);
            return null;
        }
        
        // Default config
        const defaultConfig = {
            title: 'Cell Table',
            columns: [],
            pageSize: 25,
            filter: null
        };
        
        // Merge configs
        const mergedConfig = {...defaultConfig, ...config};
        
        // Update panel element
        panel.config = mergedConfig;
        panel.classList.add('cell-table-panel');
        
        // Create panel content
        panel.innerHTML = `
            <div class="panel-header">
                <h5>Cell Table</h5>
                <div class="btn-toolbar">
                    <div class="btn-group">
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="PanelManager.minimizePanel('${panelId}')">
                            <i class="bi bi-dash"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="PanelManager.closePanel('${panelId}')">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="panel-body">
                <div id="${panelId}-table" class="table-container">
                    <div class="text-center py-4">
                        <div class="spinner-border" role="status"></div>
                        <p class="mt-2">Loading cell data...</p>
                    </div>
                </div>
            </div>
        `;
        
        // Initialize panel - this would be implemented with the actual functionality
        
        // Return panel info
        return {
            id: panelId,
            type: PANEL_TYPES.CELL_TABLE,
            config: mergedConfig
        };
    }
    
    // Define the module API
    const cellTablePanelAPI = {
        create: createCellTablePanel
    };
    
    // Register the module with ModuleSystem
    window.ModuleSystem.register('PanelManager.CellTablePanel', cellTablePanelAPI);
})();