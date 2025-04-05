/**
 * Simple Module System
 * 
 * A lightweight dependency management system for browser JavaScript
 * that doesn't require bundlers or ES modules.
 */

const ModuleSystem = (function() {
    // Module registry
    const _modules = {};
    const _dependencies = {};
    const _loadPromises = {};
    
    /**
     * Register a module
     * @param {string} name - Module name
     * @param {Object|Function} factory - Module factory or object
     * @param {Array<string>} dependencies - Module dependencies
     */
    function registerModule(name, factory, dependencies = []) {
        if (_modules[name]) {
            console.warn(`Module ${name} is already registered. Overwriting.`);
        }
        
        _modules[name] = null; // Placeholder until instantiated
        _dependencies[name] = dependencies;
        
        // If the factory is not a function, use it directly as the module
        if (typeof factory !== 'function') {
            _modules[name] = factory;
            console.log(`Module ${name} registered as object`);
            return;
        }
        
        // If no dependencies, instantiate immediately
        if (dependencies.length === 0) {
            _modules[name] = factory();
            console.log(`Module ${name} instantiated (no dependencies)`);
            return;
        }
        
        // Dependencies exist - will be instantiated on first require
        console.log(`Module ${name} registered with dependencies: ${dependencies.join(', ')}`);
    }
    
    /**
     * Get a module (instantiating it if needed)
     * @param {string} name - Module name
     * @returns {Object} - Module instance
     */
    function requireModule(name) {
        // If module already instantiated, return it
        if (_modules[name] !== null) {
            return _modules[name];
        }
        
        // If module not registered, throw error
        if (!_dependencies.hasOwnProperty(name)) {
            throw new Error(`Module ${name} is not registered`);
        }
        
        // Instantiate dependencies first
        const dependencies = _dependencies[name];
        const resolvedDependencies = dependencies.map(dep => requireModule(dep));
        
        // Get the factory
        const factory = _modules[name];
        
        // If factory is not a function, return it directly
        if (typeof factory !== 'function') {
            return factory;
        }
        
        // Instantiate the module
        _modules[name] = factory(...resolvedDependencies);
        console.log(`Module ${name} instantiated with dependencies`);
        
        return _modules[name];
    }
    
    /**
     * Load a module from a file
     * @param {string} name - Module name
     * @param {string} path - Path to the module file
     * @returns {Promise<Object>} - Promise resolving to the module
     */
    function loadModule(name, path) {
        // Check if already loaded
        if (_modules[name] !== undefined) {
            return Promise.resolve(_modules[name]);
        }
        
        // Check if already loading
        if (_loadPromises[name]) {
            return _loadPromises[name];
        }
        
        // Start loading
        _loadPromises[name] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.type = 'text/javascript';
            
            // Set up load handlers
            script.onload = () => {
                // Script is loaded, but module might not be registered yet
                if (_modules[name] !== undefined) {
                    resolve(_modules[name]);
                } else {
                    // Module not registered, wait a bit
                    setTimeout(() => {
                        if (_modules[name] !== undefined) {
                            resolve(_modules[name]);
                        } else {
                            reject(new Error(`Module ${name} not registered after loading ${path}`));
                        }
                    }, 100);
                }
            };
            
            script.onerror = () => {
                reject(new Error(`Failed to load module: ${path}`));
                delete _loadPromises[name];
            };
            
            // Add to document
            document.head.appendChild(script);
        });
        
        return _loadPromises[name];
    }
    
    /**
     * Check if a module is registered
     * @param {string} name - Module name
     * @returns {boolean} - True if module is registered
     */
    function isModuleRegistered(name) {
        return _modules[name] !== undefined;
    }
    
    /**
     * Get all registered modules
     * @returns {Array<string>} - Array of module names
     */
    function getRegisteredModules() {
        return Object.keys(_modules);
    }
    
    // Public API
    return {
        register: registerModule,
        require: requireModule,
        load: loadModule,
        isRegistered: isModuleRegistered,
        getRegisteredModules
    };
})();

// Make available globally
window.ModuleSystem = ModuleSystem;