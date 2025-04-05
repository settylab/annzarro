/**
 * Panel Manager Module - Main Index
 * 
 * Main entry point for the Panel Manager module system
 */

// Create the Panel Manager facade that coordinates the modular structure
const PanelManager = (function() {
    // Initialize the module system
    let _initialized = false;
    let _modules = {};
    
    /**
     * Initialize Panel Manager
     */
    function init() {
        if (_initialized) return;
        
        console.log('Initializing PanelManager');
        
        try {
            // Load constants module first
            _modules.constants = window.ModuleSystem.require('PanelManager.Constants');
            
            // Load data categories module
            _modules.dataCategories = window.ModuleSystem.require('PanelManager.DataCategories');
            
            // Load core module
            _modules.core = window.ModuleSystem.require('PanelManager.Core');
            
            // Load panel type modules
            _modules.plotPanel = window.ModuleSystem.require('PanelManager.PlotPanel');
            _modules.cellTablePanel = window.ModuleSystem.require('PanelManager.CellTablePanel');
            _modules.geneTablePanel = window.ModuleSystem.require('PanelManager.GeneTablePanel');
            _modules.geneSetPanel = window.ModuleSystem.require('PanelManager.GeneSetPanel');
            
            // Register panel types with core
            const { PANEL_TYPES } = _modules.constants;
            _modules.core.registerPanelType(PANEL_TYPES.PLOT, _modules.plotPanel.create);
            _modules.core.registerPanelType(PANEL_TYPES.CELL_TABLE, _modules.cellTablePanel.create);
            _modules.core.registerPanelType(PANEL_TYPES.GENE_TABLE, _modules.geneTablePanel.create);
            _modules.core.registerPanelType(PANEL_TYPES.GENE_SET, _modules.geneSetPanel.create);
            
            // Initialize core
            _modules.core.init();
            
            _initialized = true;
            console.log('PanelManager initialized successfully');
        } catch (error) {
            console.error('Error initializing PanelManager:', error);
        }
    }
    
    // Create delegating functions to core
    function delegateToCore(methodName) {
        return function(...args) {
            if (!_modules.core) {
                console.error(`PanelManager.${methodName}: Core module not loaded`);
                return null;
            }
            
            if (typeof _modules.core[methodName] !== 'function') {
                console.error(`PanelManager.${methodName}: Method not found in core module`);
                return null;
            }
            
            return _modules.core[methodName](...args);
        };
    }
    
    // Public API
    return {
        init,
        // Panel management functions
        registerPanelType: delegateToCore('registerPanelType'),
        createPanel: delegateToCore('createPanel'),
        minimizePanel: delegateToCore('minimizePanel'),
        closePanel: delegateToCore('closePanel'),
        restoreMinimizedPanel: delegateToCore('restoreMinimizedPanel'),
        restoreClosedPanel: delegateToCore('restoreClosedPanel'),
        addPanelRow: delegateToCore('addPanelRow'),
        getLayoutState: delegateToCore('getLayoutState'),
        restoreLayoutState: delegateToCore('restoreLayoutState'),
        
        // Data categories
        get DATA_CATEGORIES() {
            return _modules.dataCategories || null;
        }
    };
})();

// Make PanelManager globally available
window.PanelManager = PanelManager;