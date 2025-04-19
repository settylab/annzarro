/**
 * Dataset watcher module for table panels
 * Provides utilities for table panels to handle dataset loading/changing
 */
import { DataManager } from '../../data-manager.js';
import { checkDatasetLoadingStatus } from './table-ui-make.js';

/**
 * Sets up dataset change handlers for a panel
 * @param {string} id - Panel ID
 * @param {Object} panel - Panel instance with onDatasetLoaded method
 * @returns {Function} - Cleanup function to remove event listeners
 */
export function setupDatasetWatcher(id, panel) {
    const handleDatasetChanged = async (e) => {
        console.log(`Dataset changed event received by table panel ${id}:`, e.detail);
        const isLoaded = checkDatasetLoadingStatus(id);
        
        if (isLoaded && panel.onDatasetLoaded) {
            try {
                await panel.onDatasetLoaded(e.detail.dataset);
            } catch (error) {
                console.error(`Error handling dataset load in table panel ${id}:`, error);
            }
        }
    };
    
    // Set initial state - SKIP the initial check to avoid the error
    // We'll handle showing/hiding in the panel init instead
    
    // Add event listener
    document.addEventListener('datasetChanged', handleDatasetChanged);
    
    // Return cleanup function
    return () => {
        document.removeEventListener('datasetChanged', handleDatasetChanged);
    };
}