/**
 * Panel Manager Module - Main Index
 * 
 * Re-exports all panel manager modules
 */

// Import modules using CommonJS require for better compatibility
const PanelManagerCore = require('./core.js');
const PlotPanel = require('./plot-panel.js');
const CellTablePanel = require('./cell-table-panel.js');
const GeneTablePanel = require('./gene-table-panel.js');
const GeneSetPanel = require('./gene-set-panel.js');
const DataCategories = require('./data-categories.js');

// Create and export the complete PanelManager
const PanelManager = (function() {
    // Initialize core functionality
    const core = PanelManagerCore;
    
    // Initialize with the panel types
    function init() {
        core.init();
        
        // Register built-in panel types
        core.registerPanelType('plot', PlotPanel.create);
        core.registerPanelType('cellTable', CellTablePanel.create);
        core.registerPanelType('geneTable', GeneTablePanel.create);
        core.registerPanelType('geneSet', GeneSetPanel.create);
    }
    
    // Public API
    return {
        init,
        
        // Core functionality
        registerPanelType: core.registerPanelType,
        createPanel: core.createPanel,
        minimizePanel: core.minimizePanel,
        closePanel: core.closePanel,
        restoreMinimizedPanel: core.restoreMinimizedPanel,
        restoreClosedPanel: core.restoreClosedPanel,
        addPanelRow: core.addPanelRow,
        getLayoutState: core.getLayoutState,
        restoreLayoutState: core.restoreLayoutState,
        
        // Data categories
        DATA_CATEGORIES: DataCategories
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