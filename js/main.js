/**
 * Main Application Module
 * 
 * Entry point for the application that coordinates all other modules
 */

const AnnzarroApp = (function() {
    // Private variables
    let _initialized = false;
    
    /**
     * Get the panel manager instance
     * @returns {Object} - The panel manager implementation
     */
    function getPanelManager() {
        return window.PanelManagerAdapter || window.PanelManager;
    }
    
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
                const panelManager = getPanelManager();
                if (panelManager) {
                    panelManager.addPanelRow();
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
                    const panelManager = getPanelManager();
                    if (panelManager) {
                        panelManager.restoreLayoutState({ panels: {}, minimized: {}, recentlyClosed: [] });
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
        
        console.log(`Loading dataset from path: ${datasetPath}`);
        
        // Load the dataset
        DataManager.loadDataset(datasetPath)
            .then(async (datasetInfo) => {
                console.log(`Dataset loaded successfully: ${datasetPath}`);
                console.log(`Dataset dimensions: ${datasetInfo.n_obs} cells × ${datasetInfo.n_vars} genes`);
                
                // Hide empty state
                hideEmptyState();
                
                // Create default layout if none exists - using await since it's now async
                const panelManager = getPanelManager();
                if (panelManager && Object.keys(panelManager.getLayoutState().panels).length === 0) {
                    console.log("No existing panels found. Will create default layout.");
                    
                    // Longer delay to ensure data is fully loaded and reflected in metadata
                    // Some datasets may take longer to fully initialize
                    const delayMs = 1500; // Increased delay to ensure everything is loaded
                    console.log(`Waiting ${delayMs}ms before creating default layout...`);
                    
                    // Show a message to the user about the delay
                    if (window.SessionManager) {
                        SessionManager.showNotification('Loading dataset and preparing visualization...', 'info');
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    
                    try {
                        console.log("Creating default layout now...");
                        await createDefaultLayout();
                        console.log("Default layout creation completed");
                    } catch (layoutError) {
                        console.error("Error during default layout creation:", layoutError);
                        // Show error notification
                        if (window.SessionManager) {
                            SessionManager.showNotification(`Error creating layout: ${layoutError.message}`, 'error');
                        }
                    }
                } else {
                    console.log("Existing panels found. Not creating default layout.");
                }
            })
            .catch(error => {
                console.error('Error loading dataset:', error);
                
                // Show error notification
                if (window.SessionManager) {
                    SessionManager.showNotification(`Failed to load dataset: ${error.message}`, 'error');
                }
                
                // Hide loading indicator
                document.dispatchEvent(new Event('dataLoaded'));
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
    async function createDefaultLayout() {
        const panelManager = getPanelManager();
        if (!panelManager) return;
        
        console.log('Creating default layout with panels');
        
        try {
            // Get dataset info to validate before creating panels
            const datasetInfo = DataManager.getDatasetInfo();
            console.log('Dataset info for layout creation:', datasetInfo);
            
            // Verify that gene and cell data are actually loaded
            const geneNames = await DataManager.loadGeneNames();
            const cellNames = await DataManager.loadCellNames();
            
            console.log(`Verified data availability: ${geneNames.length} genes, ${cellNames.length} cells`);
            
            // Check for obsm data to use in plot - use default UMAP if available
            let plotConfig = {
                title: 'UMAP Plot',
                type: 'scatter'
            };
            
            // Check if embeddings are available (the recommended way)
            if (datasetInfo.embeddings && datasetInfo.embeddings.includes('X_umap')) {
                console.log('Using X_umap embedding from embeddings list');
                plotConfig.xAxis = {
                    path: 'obsm/X_umap',
                    index: 0,
                    label: 'X Axis (UMAP 1)'
                };
                plotConfig.yAxis = {
                    path: 'obsm/X_umap',
                    index: 1,
                    label: 'Y Axis (UMAP 2)'
                };
            } 
            // Check older datasets where X_umap might be in obsm.keys
            else if (datasetInfo.obsm && datasetInfo.obsm.keys && datasetInfo.obsm.keys.includes('X_umap')) {
                console.log('Using X_umap embedding from obsm.keys list');
                plotConfig.xAxis = {
                    path: 'obsm/X_umap',
                    index: 0,
                    label: 'X Axis (UMAP 1)'
                };
                plotConfig.yAxis = {
                    path: 'obsm/X_umap',
                    index: 1,
                    label: 'Y Axis (UMAP 2)'
                };
            }
            // Try X_tsne as an alternative
            else if ((datasetInfo.embeddings && datasetInfo.embeddings.includes('X_tsne')) ||
                    (datasetInfo.obsm && datasetInfo.obsm.keys && datasetInfo.obsm.keys.includes('X_tsne'))) {
                console.log('Using X_tsne embedding as alternative');
                plotConfig.xAxis = {
                    path: 'obsm/X_tsne',
                    index: 0,
                    label: 'X Axis (tSNE 1)'
                };
                plotConfig.yAxis = {
                    path: 'obsm/X_tsne',
                    index: 1,
                    label: 'Y Axis (tSNE 2)'
                };
                plotConfig.title = 'tSNE Plot';
            }
            // Try X_pca as another alternative
            else if ((datasetInfo.embeddings && datasetInfo.embeddings.includes('X_pca')) ||
                    (datasetInfo.obsm && datasetInfo.obsm.keys && datasetInfo.obsm.keys.includes('X_pca'))) {
                console.log('Using X_pca embedding as alternative');
                plotConfig.xAxis = {
                    path: 'obsm/X_pca',
                    index: 0,
                    label: 'X Axis (PC 1)'
                };
                plotConfig.yAxis = {
                    path: 'obsm/X_pca',
                    index: 1,
                    label: 'Y Axis (PC 2)'
                };
                plotConfig.title = 'PCA Plot';
            }
            // Use first available obsm as fallback
            else if (datasetInfo.obsm && datasetInfo.obsm.keys && datasetInfo.obsm.keys.length > 0) {
                const firstObsm = datasetInfo.obsm.keys[0];
                console.log(`Using first available obsm key as fallback: ${firstObsm}`);
                plotConfig.xAxis = {
                    path: `obsm/${firstObsm}`,
                    index: 0,
                    label: `X Axis (${firstObsm} 1)`
                };
                plotConfig.yAxis = {
                    path: `obsm/${firstObsm}`,
                    index: 1,
                    label: `Y Axis (${firstObsm} 2)`
                };
                plotConfig.title = `${firstObsm} Plot`;
            } else {
                // No obsm data available, show warning
                console.warn('No embedding data found in dataset. Cannot create default scatter plot.');
                plotConfig = {
                    title: 'No Embeddings Available',
                    type: 'scatter',
                    error: 'This dataset does not contain any dimensionality reduction coordinates (UMAP, tSNE, PCA). Please compute embeddings and save them in the obsm section of your AnnData object.'
                };
            }
            
            // Try loading the obsm data to verify it exists before creating the panel
            if (plotConfig.xAxis && plotConfig.xAxis.path && plotConfig.xAxis.path.startsWith('obsm/')) {
                const obsmKey = plotConfig.xAxis.path.split('/')[1];
                try {
                    console.log(`Verifying obsm/${obsmKey} data availability before creating panel`);
                    const testData = await DataManager.loadObsm(obsmKey, null, null);
                    
                    if (!testData || testData.length === 0) {
                        console.warn(`obsm/${obsmKey} returned empty data`);
                        throw new Error(`No data available for ${obsmKey}. Cannot create visualization.`);
                    }
                    
                    // Verify data structure and quality
                    console.log(`Successfully loaded obsm/${obsmKey} data: ${testData.length} points available`);
                    
                    // Check first few points for validity
                    if (testData.length > 0) {
                        const samplePoints = testData.slice(0, 5);
                        console.log(`Sample points from ${obsmKey}:`, samplePoints);
                        
                        // Verify each point has at least 2 dimensions
                        const hasInvalidPoints = samplePoints.some(point => 
                            !Array.isArray(point) || point.length < 2 || 
                            point.some(val => val === null || val === undefined || isNaN(val))
                        );
                        
                        if (hasInvalidPoints) {
                            console.warn(`obsm/${obsmKey} contains potentially invalid data points`);
                        } else {
                            console.log(`obsm/${obsmKey} data format looks valid`);
                        }
                    }
                    
                    console.log(`Successfully verified obsm/${obsmKey} data: ${testData.length} points available`);
                } catch (obsmError) {
                    console.error(`Error verifying obsm/${obsmKey} data:`, obsmError);
                    plotConfig = {
                        title: `Error Loading ${obsmKey}`,
                        type: 'scatter',
                        error: `Failed to load ${obsmKey} data: ${obsmError.message}`
                    };
                }
            }
            
            // Create the scatter plot panel with entity type set to cell
            console.log('Creating scatter plot panel with config:', plotConfig);
            // Add entity type to config
            plotConfig.entityType = 'cell';
            const panelId = panelManager.createPanel('plot', plotConfig);
            
            // Add a short delay, then explicitly trigger the plot creation via PlotManager
            // This helps ensure the DOM is ready and the plot container exists
            setTimeout(() => {
                if (window.PlotManager && document.getElementById(`${panelId}-plot`)) {
                    console.log(`Explicitly initializing scatter plot in panel ${panelId}`);
                    PlotManager.createScatterPlot(`${panelId}-plot`, plotConfig);
                }
            }, 300);
            
            // Create genes table
            console.log('Creating genes table panel');
            panelManager.createPanel('geneTable', {
                title: 'Genes',
                selectionSet: 'defaultGenes'
            });
            
            // Create cells table
            console.log('Creating cells table panel');
            panelManager.createPanel('cellTable', {
                title: 'Cells',
                selectionSet: 'defaultCells'
            });
            
            console.log('Default layout created successfully');
        } catch (error) {
            console.error('Error creating default layout:', error);
            // Create an error notification panel
            panelManager.createPanel('plot', {
                title: 'Error Creating Layout',
                error: error.message
            });
        }
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