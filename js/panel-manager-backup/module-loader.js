/**
 * Module Loader
 * 
 * A helper module to load and manage panel manager modules
 */

// Global variable for this module
window['module-loader'] = (function() {
    // Module registry
    const _modules = {};
    const _loadPromises = {};
    
    /**
     * Load a JavaScript module
     * @param {string} moduleName - Name of the module
     * @param {string} modulePath - Path to the module
     * @returns {Promise<any>} - Promise resolving to the module
     */
    async function loadModule(moduleName, modulePath) {
        // Check if already loaded
        if (_modules[moduleName]) {
            return _modules[moduleName];
        }
        
        // Check if already loading
        if (_loadPromises[moduleName]) {
            return _loadPromises[moduleName];
        }
        
        // Start loading
        _loadPromises[moduleName] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = modulePath;
            script.type = 'text/javascript';
            
            // Set up load handlers
            script.onload = () => {
                // Capture the module from the window object
                if (window[moduleName]) {
                    _modules[moduleName] = window[moduleName];
                    resolve(window[moduleName]);
                } else {
                    reject(new Error(`Module ${moduleName} not found after loading ${modulePath}`));
                }
            };
            
            script.onerror = () => {
                reject(new Error(`Failed to load module: ${modulePath}`));
                delete _loadPromises[moduleName];
            };
            
            // Add to document
            document.head.appendChild(script);
        });
        
        return _loadPromises[moduleName];
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
        getModule
    };
})();