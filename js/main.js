/**
 * Main Application Module
 * 
 * Entry point for the application that coordinates all other modules
 */

const AnnzarroApp = (function() {
    // Private variables
    let _initialized = false;
    
    /**
     * Initialize the application
     */
    function init() {
        if (_initialized) return;
        
        console.log('Initializing Annzarro Application');
        
        // Setup UI event handlers
        setupEventHandlers();
        
        // Setup home page interactions
        setupHomePageInteractions();
        
        // Handle dataset requests
        document.addEventListener('datasetRequested', handleDatasetRequested);
        
        // Mark as initialized
        _initialized = true;
    }
    
    /**
     * Setup UI event handlers
     */
    function setupEventHandlers() {
        // Show/hide loading indicator
        document.addEventListener('dataLoading', () => {
            document.getElementById('loadingIndicator')?.classList.remove('d-none');
        });
        
        document.addEventListener('dataLoaded', () => {
            document.getElementById('loadingIndicator')?.classList.add('d-none');
            hideEmptyState();
        });
        
        // Add panel row button
        const addPanelBtn = document.getElementById('addPanelBtn');
        if (addPanelBtn) {
            addPanelBtn.addEventListener('click', () => {
                if (window.PanelManager) {
                    PanelManager.addPanelRow();
                }
            });
        }
        
        // New session button
        const newSessionBtn = document.getElementById('newSessionBtn');
        if (newSessionBtn) {
            newSessionBtn.addEventListener('click', () => {
                // Confirm if there are unsaved changes
                const confirmMsg = 'This will clear all panels and start a new session. Continue?';
                if (confirm(confirmMsg)) {
                    // Clear all panels and setup new ones
                    if (window.PanelManager) {
                        PanelManager.restoreLayoutState({ panels: {}, minimized: {}, recentlyClosed: [] });
                    }
                }
            });
        }
    }
    
    /**
     * Setup home page interactions
     */
    function setupHomePageInteractions() {
        // Load data button
        const loadDataBtn = document.getElementById('loadDataBtn');
        if (loadDataBtn) {
            loadDataBtn.addEventListener('click', () => {
                // Show file browser modal
                if (window.FileBrowser) {
                    FileBrowser.openBrowser();
                }
            });
        }
        
        // Browse data button in empty state
        const browseDataBtn = document.getElementById('browseDataBtn');
        if (browseDataBtn) {
            browseDataBtn.addEventListener('click', () => {
                // Show file browser modal
                if (window.FileBrowser) {
                    FileBrowser.openBrowser();
                }
            });
        }
        
        // Browse data menu item in navbar
        const browseDataMenu = document.getElementById('browseDataMenu');
        if (browseDataMenu) {
            browseDataMenu.addEventListener('click', () => {
                // Show file browser modal
                if (window.FileBrowser) {
                    FileBrowser.openBrowser();
                }
            });
        }
    }
    
    /**
     * Handle dataset requested event
     * @param {Event} event - Dataset requested event
     */
    function handleDatasetRequested(event) {
        const datasetPath = event.detail.datasetPath;
        
        if (!datasetPath) return;
        
        // Show loading indicator
        document.dispatchEvent(new Event('dataLoading'));
        
        // Load the dataset
        DataManager.loadDataset(datasetPath)
            .then(() => {
                console.log(`Dataset loaded: ${datasetPath}`);
                
                // Hide empty state
                hideEmptyState();
                
                // Create default layout if none exists
                if (PanelManager && Object.keys(PanelManager.getLayoutState().panels).length === 0) {
                    createDefaultLayout();
                }
            })
            .catch(error => {
                console.error('Error loading dataset:', error);
                
                // Show error notification
                if (window.SessionManager) {
                    SessionManager.showNotification(`Failed to load dataset: ${error.message}`, 'error');
                }
            });
    }
    
    /**
     * Hide the empty state and show the panel container
     */
    function hideEmptyState() {
        const emptyState = document.getElementById('emptyState');
        const panelContainer = document.getElementById('panelContainer');
        
        if (emptyState) {
            emptyState.classList.add('d-none');
        }
        
        if (panelContainer) {
            panelContainer.classList.remove('d-none');
        }
    }
    
    /**
     * Create a default layout with common panels
     */
    function createDefaultLayout() {
        if (!PanelManager) return;
        
        // Create UMAP scatter plot
        PanelManager.createPanel('plot', {
            title: 'UMAP Plot',
            type: 'scatter',
            xAxis: {
                path: 'obsm/X_umap',
                index: 0,
                label: 'UMAP 1'
            },
            yAxis: {
                path: 'obsm/X_umap',
                index: 1,
                label: 'UMAP 2'
            }
        });
        
        // Create genes table
        PanelManager.createPanel('geneTable', {
            title: 'Genes',
            selectionSet: 'defaultGenes'
        });
        
        // Create cells table
        PanelManager.createPanel('cellTable', {
            title: 'Cells',
            selectionSet: 'defaultCells'
        });
    }
    
    // Public API
    return {
        init
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    AnnzarroApp.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnnzarroApp;
} else {
    window.AnnzarroApp = AnnzarroApp;
}