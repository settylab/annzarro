/**
 * Gene Set Panel Module
 * 
 * Handles the creation and management of gene set panels
 */

// Global variable for this module
window['gene-set-panel'] = (function() {
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
            genes: [],
            source: null
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
                <div id="${panelId}-gene-set" class="gene-set-container">
                    <div class="text-center py-4">
                        <div class="spinner-border" role="status"></div>
                        <p class="mt-2">Loading gene set...</p>
                    </div>
                </div>
            </div>
        `;
        
        // Initialize panel - this would be implemented with the actual functionality
        
        // Return panel info
        return {
            id: panelId,
            type: 'geneSet',
            config: mergedConfig
        };
    }
    
    // Public API
    return {
        create: createGeneSetPanel
    };
})();

// No CommonJS export needed, using window['gene-set-panel']