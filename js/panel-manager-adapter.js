/**
 * Panel Manager Adapter
 * 
 * This adapter ensures the original PanelManager is used while we work on a modular version,
 * but adds enhancements for handling array-based and dataframe-based matrices in obsm and varm.
 */

// Create an enhanced adapter based on the original PanelManager
const PanelManagerAdapter = (function() {
    let _originalPanelManager = null;
    
    /**
     * Initialize the adapter
     */
    function init() {
        if (!window.PanelManager) {
            console.error('Original PanelManager not found');
            return false;
        }
        
        _originalPanelManager = window.PanelManager;
        
        // Initialize the original PanelManager
        const result = _originalPanelManager.init();
        console.log('PanelManagerAdapter: Original PanelManager initialized');
        
        // Apply enhancements
        _applyEnhancements();
        
        return result;
    }
    
    /**
     * Apply enhancements to the original PanelManager
     * - Improved handling of array-based matrices in obsm and varm
     * - Add support for numeric column indices
     * - Fix transparency and marker size in plot settings
     */
    function _applyEnhancements() {
        console.log('PanelManagerAdapter: Applying enhancements');
        
        // Fix for marker size and opacity in PlotManager
        _enhancePlotManager();
        
        // Enhance the original DATA_CATEGORIES to handle array-based matrices
        const originalDataCategories = _originalPanelManager.DATA_CATEGORIES;
        
        // Only apply enhancements if the original DATA_CATEGORIES exists
        if (!originalDataCategories) return;
            
        // Enhance obsm loadColumns function to handle array-based matrices
        if (originalDataCategories.obsm && originalDataCategories.obsm.loadColumns) {
            const originalObsmLoadColumns = originalDataCategories.obsm.loadColumns;
            originalDataCategories.obsm.loadColumns = async function(field) {
                console.log('Enhanced obsm.loadColumns called with field:', field);
                
                const columns = await originalObsmLoadColumns(field);
                
                // Check if the field is from an array-based matrix
                // This is determined by checking if the column names are numeric strings
                const isArrayBased = columns.length > 0 && 
                                    columns.every(col => 
                                        col.column && 
                                        /^\d+$/.test(col.column) && 
                                        col.label && 
                                        col.label.startsWith('Dimension'));
                                        
                if (isArrayBased) {
                    console.log('Detected array-based obsm matrix:', field.key);
                    
                    // Add an attribute to indicate this is an array-based matrix
                    columns.forEach(col => {
                        col.isArrayColumn = true;
                        // Make labels more friendly
                        col.label = `Dimension ${parseInt(col.column) + 1}`;
                    });
                }
                
                return columns;
            };
        }
        
        // Enhance varm loadColumns function to handle array-based matrices
        if (originalDataCategories.varm && originalDataCategories.varm.loadColumns) {
            const originalVarmLoadColumns = originalDataCategories.varm.loadColumns;
            originalDataCategories.varm.loadColumns = async function(field) {
                console.log('Enhanced varm.loadColumns called with field:', field);
                
                const columns = await originalVarmLoadColumns(field);
                
                // Check if the field is from an array-based matrix
                const isArrayBased = columns.length > 0 && 
                                    columns.every(col => 
                                        col.column && 
                                        /^\d+$/.test(col.column) && 
                                        col.label && 
                                        col.label.startsWith('Dimension'));
                                        
                if (isArrayBased) {
                    console.log('Detected array-based varm matrix:', field.key);
                    
                    // Add an attribute to indicate this is an array-based matrix
                    columns.forEach(col => {
                        col.isArrayColumn = true;
                        // Make labels more friendly
                        col.label = `Dimension ${parseInt(col.column) + 1}`;
                    });
                }
                
                return columns;
            };
        }
    }
    
    /**
     * Apply enhancements to PlotManager to fix marker size and opacity
     */
    function _enhancePlotManager() {
        // Wait for PlotManager to be available
        if (!window.PlotManager) {
            console.warn('PlotManager not available for enhancement');
            return;
        }
        
        // Save a reference to the original updatePlot function
        const originalUpdatePlot = window.PlotManager.updatePlot;
        
        // Replace updatePlot with an enhanced version that properly handles marker properties
        window.PlotManager.updatePlot = function(plotId, config = {}) {
            console.log('Enhanced updatePlot called with config:', config);
            
            // Fix marker size and opacity for categorical data
            if (config && config._categoryTraces && Array.isArray(config._categoryTraces)) {
                // Apply marker properties to each category trace
                config._categoryTraces.forEach(catTrace => {
                    if (catTrace.marker && config.marker) {
                        // Transfer marker properties from config to each category trace
                        if (config.marker.size !== undefined) {
                            catTrace.marker.size = config.marker.size;
                        }
                        if (config.marker.opacity !== undefined) {
                            catTrace.marker.opacity = config.marker.opacity;
                        }
                    }
                });
            }
            
            // Call the original updatePlot function
            return originalUpdatePlot.call(window.PlotManager, plotId, config);
        };
        
        console.log('PlotManager.updatePlot enhanced for better marker properties handling');
    }
    
    // Delegate all methods to the original panel manager
    function delegateToOriginal(methodName) {
        return function(...args) {
            if (!_originalPanelManager) {
                console.error(`Cannot call ${methodName}: Original PanelManager not initialized`);
                return null;
            }
            
            // Call the original method
            const originalMethod = _originalPanelManager[methodName];
            if (typeof originalMethod !== 'function') {
                console.error(`Method ${methodName} is not a function in original PanelManager`);
                return null;
            }
            
            return originalMethod.apply(_originalPanelManager, args);
        };
    }
    
    // Public API - delegate everything to the original but with enhancements
    return {
        init,
        registerPanelType: delegateToOriginal('registerPanelType'),
        createPanel: delegateToOriginal('createPanel'),
        minimizePanel: delegateToOriginal('minimizePanel'),
        closePanel: delegateToOriginal('closePanel'),
        restoreMinimizedPanel: delegateToOriginal('restoreMinimizedPanel'),
        restoreClosedPanel: delegateToOriginal('restoreClosedPanel'),
        addPanelRow: delegateToOriginal('addPanelRow'),
        getLayoutState: delegateToOriginal('getLayoutState'),
        restoreLayoutState: delegateToOriginal('restoreLayoutState'),
        
        // Access to enhanced data categories
        get DATA_CATEGORIES() {
            return _originalPanelManager ? _originalPanelManager.DATA_CATEGORIES : null;
        }
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait for a short delay to ensure PanelManager is loaded first
    setTimeout(() => {
        PanelManagerAdapter.init();
    }, 500);
});

// Export the adapter
window.PanelManagerAdapter = PanelManagerAdapter;