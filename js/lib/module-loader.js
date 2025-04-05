/**
 * Simple Module Loader
 * 
 * Handles dynamic loading of JavaScript modules in a browser environment
 * without requiring bundlers or ES module support
 */

const ModuleLoader = (function() {
    // Module registry
    const _modules = {};
    const _loadPromises = {};
    
    /**
     * Load a JavaScript module
     * @param {string} modulePath - Path to the module
     * @returns {Promise<any>} - Promise resolving to the module
     */
    async function loadModule(modulePath) {
        // Check if already loaded
        if (_modules[modulePath]) {
            return _modules[modulePath];
        }
        
        // Check if already loading
        if (_loadPromises[modulePath]) {
            return _loadPromises[modulePath];
        }
        
        // Start loading
        _loadPromises[modulePath] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = modulePath;
            script.type = 'text/javascript';
            
            // Set up load handlers
            script.onload = () => {
                // Capture the module if it was registered
                const moduleName = modulePath.split('/').pop().replace('.js', '');
                if (window[moduleName]) {
                    _modules[modulePath] = window[moduleName];
                    resolve(window[moduleName]);
                } else {
                    reject(new Error(`Module ${moduleName} not found after loading ${modulePath}`));
                }
            };
            
            script.onerror = () => {
                reject(new Error(`Failed to load module: ${modulePath}`));
                delete _loadPromises[modulePath];
            };
            
            // Add to document
            document.head.appendChild(script);
        });
        
        return _loadPromises[modulePath];
    }
    
    /**
     * Register a module in the loader
     * @param {string} moduleName - Name of the module
     * @param {any} moduleInstance - Module instance
     */
    function registerModule(moduleName, moduleInstance) {
        _modules[moduleName] = moduleInstance;
    }
    
    /**
     * Get a loaded module
     * @param {string} moduleName - Name of the module
     * @returns {any} - Module instance
     */
    function getModule(moduleName) {
        return _modules[moduleName];
    }
    
    // Public API
    return {
        loadModule,
        registerModule,
        getModule
    };
})();

// Export for both browser and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModuleLoader;
} else {
    window.ModuleLoader = ModuleLoader;
}