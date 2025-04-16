/**
 * Dataset watcher module
 * Provides utilities for panels to handle dataset loading/changing
 */
import { checkDatasetLoadingStatus } from './panel-ui-make.js';

/**
 * Sets up dataset change handlers for a panel
 * @param {string} id - Panel ID
 * @param {Object} panel - Panel instance with onDatasetLoaded method
 * @returns {Function} - Cleanup function to remove event listeners
 */
export function setupDatasetWatcher(id, panel) {
    const handleDatasetChanged = async (e) => {
        console.log(`Dataset changed event received by panel ${id}:`, e.detail);
        const isLoaded = checkDatasetLoadingStatus(id);
        
        if (isLoaded && panel.onDatasetLoaded) {
            try {
                await panel.onDatasetLoaded(e.detail.dataset);
            } catch (error) {
                console.error(`Error handling dataset load in panel ${id}:`, error);
            }
        }
    };
    
    // Set initial state
    checkDatasetLoadingStatus(id);
    
    // Add event listener
    document.addEventListener('datasetChanged', handleDatasetChanged);
    
    // Return cleanup function
    return () => {
        document.removeEventListener('datasetChanged', handleDatasetChanged);
    };
}