/**
 * Panel Manager Module
 * 
 * This is the main entry point for the Panel Manager.
 * It loads the module system and then the modular panel manager components.
 */

// This file serves as a bootstrap for loading the modular panel manager components
(function() {
    // Load module system first
    const moduleSystemScript = document.createElement('script');
    moduleSystemScript.src = 'js/module-system.js';
    moduleSystemScript.async = false; // Load synchronously
    
    // Wait for module system to load, then load panel manager components
    moduleSystemScript.onload = () => {
        console.log('Module system loaded, loading Panel Manager components...');
        
        // Define modules to load
        const modules = [
            { name: 'constants', path: 'js/panel-manager/constants.js' },
            { name: 'core', path: 'js/panel-manager/core.js' },
            { name: 'data-categories', path: 'js/panel-manager/data-categories.js' },
            { name: 'plot-panel', path: 'js/panel-manager/plot-panel.js' },
            { name: 'cell-table-panel', path: 'js/panel-manager/cell-table-panel.js' },
            { name: 'gene-table-panel', path: 'js/panel-manager/gene-table-panel.js' },
            { name: 'gene-set-panel', path: 'js/panel-manager/gene-set-panel.js' }
        ];
        
        // Load modules sequentially to ensure proper dependency order
        let modulePromises = [];
        
        // Load each module
        modules.forEach(module => {
            const script = document.createElement('script');
            script.src = module.path;
            
            // Create a promise for this script
            const modulePromise = new Promise((resolve, reject) => {
                script.onload = () => {
                    console.log(`Module ${module.name} loaded successfully`);
                    resolve();
                };
                script.onerror = () => {
                    console.error(`Failed to load module ${module.name} from ${module.path}`);
                    reject(new Error(`Failed to load module ${module.name}`));
                };
            });
            
            modulePromises.push(modulePromise);
            document.head.appendChild(script);
        });
        
        // After all modules are loaded, load the main panel manager
        Promise.all(modulePromises)
            .then(() => {
                console.log('All Panel Manager modules loaded, initializing main module...');
                const mainScript = document.createElement('script');
                mainScript.src = 'js/panel-manager/index.js';
                mainScript.onload = () => {
                    console.log('Panel Manager main module loaded successfully');
                    // Initialize automatically once everything is loaded
                    if (window.PanelManager && typeof window.PanelManager.init === 'function') {
                        window.PanelManager.init();
                    }
                };
                document.head.appendChild(mainScript);
            })
            .catch(error => {
                console.error('Error loading Panel Manager modules:', error);
                
                // Fallback to the original implementation if available
                const originalScript = document.createElement('script');
                originalScript.src = 'js/panel-manager-original.js';
                originalScript.onload = () => {
                    console.log('Loaded original Panel Manager as fallback');
                    if (window.PanelManager && typeof window.PanelManager.init === 'function') {
                        window.PanelManager.init();
                    }
                };
                document.head.appendChild(originalScript);
            });
    };
    
    // Handle script loading error
    moduleSystemScript.onerror = () => {
        console.error('Failed to load module system');
        
        // Fallback to the original implementation if available
        const originalScript = document.createElement('script');
        originalScript.src = 'js/panel-manager-original.js';
        originalScript.onload = () => {
            console.log('Loaded original Panel Manager as fallback');
            if (window.PanelManager && typeof window.PanelManager.init === 'function') {
                window.PanelManager.init();
            }
        };
        document.head.appendChild(originalScript);
    };
    
    // Start loading the module system
    document.head.appendChild(moduleSystemScript);
})();