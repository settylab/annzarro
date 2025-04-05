/**
 * Gene Set Panel Module
 * 
 * Handles the creation and management of gene set panels
 */

// Define the gene set panel module
(function() {
    // Import dependencies from ModuleSystem
    const { PANEL_TYPES } = window.ModuleSystem.require('PanelManager.Constants');
    
    /**
     * Create a gene set panel
     * @param {string} panelId - Panel ID
     * @param {Object} config - Panel configuration
     * @returns {Object} - Panel object
     */
    function createGeneSetPanel(panelId, config = {}) {
        const panel = document.getElementById(panelId);
        if (!panel) {
            console.error(`Panel element not found: ${panelId}`);
            return null;
        }
        
        // Default config
        const defaultConfig = {
            title: 'Gene Set',
            geneSets: [],
            activeGeneSet: null
        };
        
        // Merge configs
        const mergedConfig = {...defaultConfig, ...config};
        
        // Update panel element
        panel.config = mergedConfig;
        panel.classList.add('gene-set-panel');
        
        // Create panel content
        panel.innerHTML = `
            <div class="panel-header">
                <h5>Gene Set</h5>
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
                <div id="${panelId}-content" class="gene-set-container">
                    <div class="text-center py-4">
                        <div class="spinner-border" role="status"></div>
                        <p class="mt-2">Loading gene sets...</p>
                    </div>
                </div>
            </div>
        `;
        
        // Initialize panel - this would be implemented with actual functionality
        
        // Return panel info
        return {
            id: panelId,
            type: PANEL_TYPES.GENE_SET,
            config: mergedConfig
        };
    }
    
    // Define the module API
    const geneSetPanelAPI = {
        create: createGeneSetPanel
    };
    
    // Register the module with ModuleSystem
    window.ModuleSystem.register('PanelManager.GeneSetPanel', geneSetPanelAPI);
})();