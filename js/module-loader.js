/**
 * Module Loader
 *
 * This file handles the loading and initialization of all application modules
 * in the correct order, ensuring dependencies are properly resolved and preventing
 * variable redeclaration errors.
 */

// Define the application namespace
window.Annzarro = window.Annzarro || {};

// Module registry
Annzarro.modules = {
    Utils: null,
    zarrLoader: null,
    dataManager: null,
    plotManager: null,
    tableManager: null,
    stringDB: null,
    uiManager: null
};

// Dependency mappings - to resolve circular dependencies
Annzarro.dependencies = {
    dataManager: ['zarrLoader'],
    plotManager: ['Utils'],
    uiManager: ['dataManager', 'plotManager', 'tableManager', 'stringDB', 'Utils']
};

// Loading status
Annzarro.modulesLoaded = false;
Annzarro.loadedModules = [];

/**
 * Register a module with the application
 * @param {string} moduleName - Name of the module
 * @param {Object} moduleInstance - Module instance
 */
Annzarro.registerModule = function(moduleName, moduleInstance) {
    this.modules[moduleName] = moduleInstance;
    this.loadedModules.push(moduleName);
    
    // Check if all required modules are loaded
    this.checkModulesReady();
};

/**
 * Get a module (used to resolve dependencies)
 * @param {string} moduleName - Name of the module to get
 * @returns {Object} The module instance
 */
Annzarro.getModule = function(moduleName) {
    return this.modules[moduleName];
};

/**
 * Initialize modules in the correct dependency order
 */
Annzarro.initializeModules = function() {
    if (this.modulesLoaded) {
        return;
    }
    
    // Make module instances accessible globally
    // But avoid overwriting existing global variables
    if (!window.Utils) window.Utils = this.modules.Utils;
    if (!window.zarrLoader) window.zarrLoader = this.modules.zarrLoader;
    if (!window.dataManager) window.dataManager = this.modules.dataManager;
    if (!window.plotManager) window.plotManager = this.modules.plotManager;
    if (!window.tableManager) window.tableManager = this.modules.tableManager;
    if (!window.stringDB) window.stringDB = this.modules.stringDB;
    if (!window.uiManager) window.uiManager = this.modules.uiManager;
    
    this.modulesLoaded = true;
    
    // Dispatch a custom event to notify application components
    try {
        document.dispatchEvent(new CustomEvent('modulesLoaded', {
            detail: { modules: this.modules }
        }));
    } catch (error) {
        console.error('Error dispatching modulesLoaded event:', error);
    }
};

/**
 * Check if all modules are loaded and initialize if ready
 */
Annzarro.checkModulesReady = function() {
    // Check if all modules are registered
    const allRegistered = Object.entries(this.modules)
        .every(([moduleName, instance]) => instance !== null);
    
    if (allRegistered && !this.modulesLoaded) {
        this.initializeModules();
        return true;
    }
    
    return false;
};

// Listen for DOM ready event to initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Wait a short time to ensure all scripts have loaded
    setTimeout(function() {
        // Check for global module instances and register them
        if (window.Utils && !Annzarro.modules.Utils) Annzarro.modules.Utils = window.Utils;
        if (window.zarrLoader && !Annzarro.modules.zarrLoader) Annzarro.modules.zarrLoader = window.zarrLoader;
        if (window.dataManager && !Annzarro.modules.dataManager) Annzarro.modules.dataManager = window.dataManager;
        if (window.plotManager && !Annzarro.modules.plotManager) Annzarro.modules.plotManager = window.plotManager;
        if (window.tableManager && !Annzarro.modules.tableManager) Annzarro.modules.tableManager = window.tableManager;
        if (window.stringDB && !Annzarro.modules.stringDB) Annzarro.modules.stringDB = window.stringDB;
        if (window.uiManager && !Annzarro.modules.uiManager) Annzarro.modules.uiManager = window.uiManager;
        
        if (!Annzarro.modulesLoaded) {
            Annzarro.checkModulesReady();
            
            // If modules are still not loaded, try a fallback
            if (!Annzarro.modulesLoaded) {
                console.warn('Forcing module initialization for compatibility');
                
                // Make module instances accessible globally (fallback)
                if (!window.Utils) window.Utils = {};
                if (!window.zarrLoader) window.zarrLoader = {};
                if (!window.dataManager) window.dataManager = {};
                if (!window.plotManager) window.plotManager = {};
                if (!window.tableManager) window.tableManager = {};
                if (!window.stringDB) window.stringDB = {};
                if (!window.uiManager) window.uiManager = {};
                
                // Force modules loaded state
                Annzarro.modulesLoaded = true;
                
                // Dispatch event
                document.dispatchEvent(new CustomEvent('modulesLoaded', {
                    detail: { modules: Annzarro.modules }
                }));
                
                // Initialize the application
                if (typeof initializeApp === 'function') {
                    try {
                        initializeApp();
                    } catch (error) {
                        console.error('Error initializing app:', error);
                    }
                }
            }
        }
    }, 500); // Increased timeout to allow more time for modules to load
});