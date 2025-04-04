/**
 * Main application entry point
 * This file orchestrates the overall application flow:
 * 1. Sets up event listeners
 * 2. Initializes the UI
 * 3. Coordinates between data, UI, and visualization components
 */

// Configuration for backend communication - load from config
// The API URL will be determined dynamically from the server configuration
window.ANNZARRO_API_URL = null; // Will be set in getApiConfig()

// Function to configure API URL - simplified for unified server approach
async function getApiConfig() {
    try {
        // First, try to get config from same origin (unified server approach)
        console.log('Fetching API configuration from unified server...');
        
        // Build API URL based on current location (same origin)
        const currentLocation = window.location;
        const protocol = currentLocation.protocol;
        const hostname = currentLocation.hostname;
        const port = currentLocation.port ? `:${currentLocation.port}` : '';
        
        // Use the same origin for API URL (unified server approach)
        window.ANNZARRO_API_URL = `${protocol}//${hostname}${port}/api/v1`;
        console.log(`Using unified server API URL: ${window.ANNZARRO_API_URL}`);
        
        // Verify the API URL by making a test request
        const testResponse = await fetch(`${window.ANNZARRO_API_URL}/config`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            timeout: 2000
        });
        
        if (testResponse.ok) {
            console.log(`API URL verified: ${window.ANNZARRO_API_URL}`);
            return true;
        } else {
            console.warn(`API not available at ${window.ANNZARRO_API_URL}, status:`, testResponse.status);
            // Fall back to legacy dual-server approach
            return await fallbackLegacyApiConfig();
        }
    } catch (error) {
        console.error('Error verifying API URL:', error);
        // Fall back to legacy dual-server approach
        return await fallbackLegacyApiConfig();
    }
}

// Legacy fallback for dual-server approach (Frontend + Backend)
async function fallbackLegacyApiConfig() {
    console.log('Falling back to legacy dual-server API configuration...');
    
    // Get current location information
    const currentLocation = window.location;
    const protocol = currentLocation.protocol;
    const hostname = currentLocation.hostname;
    
    // Try to use the fixed backend port (8001)
    // This is only for backward compatibility and should be removed once unified server is implemented
    const backendPort = 8001;
    
    console.warn(`Using legacy backend port ${backendPort} - consider upgrading to unified server`);
    window.ANNZARRO_API_URL = `${protocol}//${hostname}:${backendPort}/api/v1`;
    
    try {
        // Try to verify the connection
        const testResponse = await fetch(`${window.ANNZARRO_API_URL}/config`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            mode: 'cors',
            timeout: 2000
        });
        
        if (testResponse.ok) {
            console.log(`Legacy API URL verified: ${window.ANNZARRO_API_URL}`);
            return true;
        }
    } catch (error) {
        console.error('Error testing legacy API connection:', error);
    }
    
    console.error('Could not connect to API server - please make sure the server is running');
    return false;
}

// Wait for all modules to be loaded and initialized
document.addEventListener('modulesLoaded', function() {
    initializeApp();
});

// Add a failsafe loading mechanism to handle initialization issues
setTimeout(function() {
    // Check if the global loading overlay is still visible
    const globalLoadingOverlay = document.getElementById('globalLoadingOverlay');
    if (globalLoadingOverlay && globalLoadingOverlay.style.display !== 'none') {
        // Try to initialize anyway
        try {
            if (typeof Annzarro !== 'undefined') {
                Annzarro.modulesLoaded = true;
            }
            
            initializeApp();
            
            // Hide loading indicator
            if (globalLoadingOverlay) {
                globalLoadingOverlay.style.display = 'none';
            }
            
            // Try to load available data
            loadAvailableData();
        } catch (error) {
            console.error('Error in fallback initialization:', error);
        }
    }
}, 3000); // Wait 3 seconds before trying fallback

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeApp,
        setupEventListeners,
        loadAvailableData,
        loadAvailableDemoData, // Kept for backward compatibility
        loadDataFromPath,
        checkForDataInUrl
    };
}

/**
 * Initialize the application with proper dependency checking
 */
async function initializeApp() {
    // Get API configuration
    await getApiConfig();
    
    // Check if we have the zarrLoader available
    if (typeof zarrLoader === 'undefined' || !zarrLoader) {
        console.error('zarrLoader is not available. Make sure the Python backend is running.');
        
        // Show a more detailed error based on what we know
        let apiUrl = window.ANNZARRO_API_URL || '(not configured)';
        let portMatch = apiUrl.match(/:(\d+)\//);
        let apiPort = portMatch ? portMatch[1] : 'unknown';
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.innerHTML = `
            <h4>Error: Python Backend Not Available</h4>
            <p>The application cannot connect to the Python backend server at ${apiUrl}.</p>
            <p><strong>Current status:</strong></p>
            <ul>
                <li>API URL: ${apiUrl}</li>
                <li>Connection status: Failed</li>
                <li>Error: zarrLoader is not initialized</li>
            </ul>
            <p><strong>Diagnostic steps:</strong></p>
            <ol>
                <li>Check if the server is running:<br>
                <code>python server_status.py</code></li>
                <li>If not running, start the server:<br>
                <code>python run_annzarro.py --start</code></li>
                <li>If you see "Address already in use" errors, clear the ports:<br>
                <code>python server_status.py --stop-all</code></li>
                <li>Check server configuration in <code>annzarro/server/config.json</code></li>
                <li>Verify the correct port is being used (currently trying to connect to port ${apiPort})</li>
            </ol>
            <p>After fixing the issue, refresh this page.</p>
            <button id="retryConnectionBtn" class="btn btn-primary mt-2">
                <i class="fas fa-sync-alt me-1"></i> Retry Connection
            </button>
        `;
        document.body.insertBefore(errorDiv, document.body.firstChild);
        
        // Add retry button handler
        document.getElementById('retryConnectionBtn')?.addEventListener('click', async function() {
            this.disabled = true;
            this.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Retrying...';
            
            // Try to reconnect
            try {
                // Re-fetch API config
                await getApiConfig();
                
                // Try to verify backend is running
                const response = await fetch(`${window.ANNZARRO_API_URL}/config`, { 
                    mode: 'cors',
                    headers: { 'Accept': 'application/json' },
                    timeout: 3000
                });
                
                if (response.ok) {
                    // Reload the page if successful
                    window.location.reload();
                } else {
                    this.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i> Failed - Refresh Page to Try Again';
                    errorDiv.querySelector('ul').innerHTML += `<li>Retry attempt failed: ${response.status} ${response.statusText}</li>`;
                }
            } catch (retryError) {
                this.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i> Failed - Refresh Page to Try Again';
                errorDiv.querySelector('ul').innerHTML += `<li>Retry attempt failed: ${retryError.message}</li>`;
            }
        });
        
        return;
    }
    
    // Check for UI manager
    if (typeof uiManager === 'undefined') {
        console.error('uiManager is not defined');
        return;
    }
    
    // Initialize the UI manager
    if (typeof uiManager === 'object' && typeof uiManager.initialize === 'function') {
        try {
            uiManager.initialize('vizContainer');
        } catch (error) {
            console.error('Error initializing UI manager:', error);
            return;
        }
    } else {
        console.error('UI Manager not properly initialized');
        return;
    }
    
    // Set up event listeners
    try {
        setupEventListeners();
    } catch (error) {
        console.error('Error setting up event listeners:', error);
        return;
    }
    
    // Load available datasets
    try {
        loadAvailableData();
    } catch (error) {
        console.error('Error starting dataset loading:', error);
    }
    
    // Check for dataset parameters in URL
    try {
        checkForDataInUrl();
    } catch (error) {
        console.error('Error checking for dataset in URL:', error);
    }
    
    // Hide global loading overlay
    const globalLoadingOverlay = document.getElementById('globalLoadingOverlay');
    if (globalLoadingOverlay) {
        globalLoadingOverlay.style.display = 'none';
    }
}

/**
 * Set up application-wide event listeners
 */
function setupEventListeners() {
    // Load data button (main Load Data button)
    document.getElementById('loadDataBtn').addEventListener('click', function() {
        // Show the load data modal
        $('#loadDataModal').modal('show');
    });
    
    // Demo data button
    document.getElementById('browseDataBtn').addEventListener('click', function() {
        // Show the browse data modal
        $('#browseDataModal').modal('show');
        
        // Load available data
        loadAvailableData();
    });
    
    // Main menu items
    document.getElementById('loadDataMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#loadDataModal').modal('show');
    });
    
    document.getElementById('browseDataMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#browseDataModal').modal('show');
        loadAvailableData();
    });
    
    document.getElementById('layoutMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#layoutModal').modal('show');
    });
    
    document.getElementById('settingsMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#settingsModal').modal('show');
    });
    
    document.getElementById('helpMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#helpModal').modal('show');
    });
    
    // Process load data form submission
    document.getElementById('loadDataSubmit').addEventListener('click', function() {
        // Get the selected tab
        const activeTab = document.querySelector('#loadDataTabs .nav-link.active');
        const tabId = activeTab.getAttribute('data-bs-target').substring(1);
        
        // Show loading indicator
        showLoadingIndicator('Loading zarr data...');
        
        // Handle based on the tab
        if (tabId === 'local-file-content') {
            const fileInput = document.getElementById('localFile');
            if (fileInput.files.length > 0) {
                loadZarrFromLocal(fileInput.files)
                    .then(() => {
                        hideLoadingIndicator();
                        $('#loadDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading zarr from local files: ' + error.message);
                        hideLoadingIndicator();
                    });
            } else {
                showError('Please select a zarr directory or file');
                hideLoadingIndicator();
            }
        } else if (tabId === 'url-content') {
            const url = document.getElementById('urlInput').value.trim();
            if (url) {
                loadZarrFromUrl(url)
                    .then(() => {
                        hideLoadingIndicator();
                        $('#loadDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading zarr from URL: ' + error.message);
                        hideLoadingIndicator();
                    });
            } else {
                showError('Please enter a URL');
                hideLoadingIndicator();
            }
        } else if (tabId === 's3-content') {
            const bucket = document.getElementById('s3Bucket').value.trim();
            const key = document.getElementById('s3Key').value.trim();
            const region = document.getElementById('s3Region').value.trim() || 'us-east-1';
            const anonymous = document.getElementById('s3Anonymous').checked;
            
            if (bucket && key) {
                const s3Config = {
                    bucket,
                    key,
                    region,
                    anonymous
                };
                
                if (!anonymous) {
                    const accessKey = document.getElementById('s3AccessKey').value.trim();
                    const secretKey = document.getElementById('s3SecretKey').value.trim();
                    
                    if (!accessKey || !secretKey) {
                        showError('Please enter AWS access key and secret key');
                        hideLoadingIndicator();
                        return;
                    }
                    
                    s3Config.accessKey = accessKey;
                    s3Config.secretKey = secretKey;
                }
                
                loadZarrFromS3(s3Config)
                    .then(() => {
                        hideLoadingIndicator();
                        $('#loadDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading zarr from S3: ' + error.message);
                        hideLoadingIndicator();
                    });
            } else {
                showError('Please enter S3 bucket name and key');
                hideLoadingIndicator();
            }
        }
    });
    
    // Demo datasets list handling
    document.getElementById('demoDatasetsList').addEventListener('click', function(event) {
        // Find the clicked list-group-item if any
        let targetItem = event.target;
        
        // If the click was on a child element inside the list-group-item, find the parent
        while (targetItem && !targetItem.classList.contains('list-group-item') && targetItem !== this) {
            targetItem = targetItem.parentElement;
        }
        
        // If we found a list-group-item, process it
        if (targetItem && targetItem.classList.contains('list-group-item')) {
            // Prevent default behavior
            event.preventDefault();
            
            // Remove active class from all items
            document.querySelectorAll('#demoDatasetsList .list-group-item').forEach(i => {
                i.classList.remove('active');
            });
            
            // Add active class to clicked item
            targetItem.classList.add('active');
            
            // Log selection for debugging
            console.log('Demo data selected:', targetItem.dataset.demo, targetItem.dataset.path);
        }
    });
    
    // Load demo data button
    document.getElementById('loadDatasetSubmit').addEventListener('click', function() {
        const selectedDemo = document.querySelector('#datasetsList .list-group-item.active');
        if (selectedDemo) {
            const demoType = selectedDemo.dataset.demo;
            const path = selectedDemo.dataset.path;
            
            // Show loading indicator
            showLoadingIndicator('Loading data...');
            
            loadDataFromPath(demoType, path)
                .then(() => {
                    hideLoadingIndicator();
                    $('#browseDataModal').modal('hide');
                })
                .catch(error => {
                    showError('Error loading data: ' + error.message);
                    hideLoadingIndicator();
                });
        } else {
            showError('Please select a dataset');
        }
    });
    
    // Save layout button
    document.getElementById('saveLayoutBtn').addEventListener('click', function() {
        saveCurrentLayout();
    });
    
    // Anonymous S3 access toggle
    document.getElementById('s3Anonymous').addEventListener('change', function() {
        const credentialsSection = document.getElementById('s3CredentialsSection');
        credentialsSection.style.display = this.checked ? 'none' : 'block';
    });
    
    
    // Gene focus select
    document.getElementById('geneFocus').addEventListener('change', function() {
        const gene = this.value;
        dataManager.setFocusedGene(gene || null);
    });
    
    // Cell focus select
    document.getElementById('cellFocus').addEventListener('change', function() {
        const cell = this.value;
        dataManager.setFocusedCell(cell || null);
    });
    
    // Species select
    document.getElementById('speciesSelect').addEventListener('change', function() {
        const taxonomyId = parseInt(this.value);
        const speciesName = this.options[this.selectedIndex].text.split('(')[0].trim();
        dataManager.setTaxonomyInfo(taxonomyId, speciesName);
    });
    
    // Add support for custom species ID and name
    document.getElementById('customSpeciesForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const taxonomyId = parseInt(document.getElementById('customTaxonomyId').value);
        const speciesName = document.getElementById('customSpeciesName').value.trim();
        
        if (taxonomyId && speciesName) {
            dataManager.setTaxonomyInfo(taxonomyId, speciesName);
            
            // Update the select dropdown or add a new option
            const select = document.getElementById('speciesSelect');
            const existingOption = Array.from(select.options).find(opt => parseInt(opt.value) === taxonomyId);
            
            if (existingOption) {
                existingOption.text = `${speciesName} (${taxonomyId})`;
                existingOption.selected = true;
            } else {
                const newOption = document.createElement('option');
                newOption.value = taxonomyId;
                newOption.text = `${speciesName} (${taxonomyId})`;
                newOption.selected = true;
                select.appendChild(newOption);
            }
            
            // Close the modal if open
            $('#customSpeciesModal').modal('hide');
        }
    });
    
    // Gene name column select
    document.getElementById('geneNameColumn')?.addEventListener('change', function() {
        const column = this.value;
        // Update gene options with the selected column
        updateGeneOptions(column);
    });
    
    // Data loaded event
    document.addEventListener('dataLoaded', function(event) {
        console.log('Data loaded event received', event);
        
        // Update gene and cell select options
        updateGeneOptions();
        updateCellOptions();
        
        // Make sure the empty state is hidden and panel container is shown
        const emptyState = document.getElementById('emptyState');
        const panelContainer = document.getElementById('panelContainer');
        
        if (emptyState) {
            console.log('Hiding empty state');
            emptyState.classList.add('d-none');
            emptyState.style.display = 'none';
        }
        
        if (panelContainer) {
            console.log('Showing panel container');
            panelContainer.classList.remove('d-none');
            panelContainer.style.display = 'block';
            panelContainer.style.height = '100%';
        }
        
        // Update status indicator
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusIndicator) {
            console.log('Updating status indicator');
            let dataInfo = '';
            if (dataManager && dataManager.isDataLoaded()) {
                const info = dataManager.getBasicInfo() || {};
                if (info.nObs && info.nVars) {
                    dataInfo = ` (${info.nObs} cells × ${info.nVars} genes)`;
                }
            }
            statusIndicator.innerHTML = `<span class="badge bg-success">Data Loaded${dataInfo}</span>`;
        }
        
        // Create a default plot in the first panel
        const firstPanel = document.getElementById('panel-1');
        if (firstPanel) {
            console.log('Creating plot in first panel');
            try {
                // Get basic info about the data to determine what kind of plot to create
                const basicInfo = dataManager.getBasicInfo() || {};
                const hasEmbeddings = basicInfo.embeddings && basicInfo.embeddings.length > 0;
                
                if (hasEmbeddings) {
                    console.log('Data has embeddings, creating UMAP plot');
                    // Use UMAP or first available embedding
                    const embedding = basicInfo.embeddings.includes('umap') ? 'umap' : basicInfo.embeddings[0];
                    
                    uiManager.createPanel('panel-1', 'plot', {
                        plotType: 'scatter',
                        title: `${embedding.toUpperCase()} Visualization`,
                        xAxis: `obsm:X_${embedding}:0`,
                        yAxis: `obsm:X_${embedding}:1`
                    });
                } else {
                    console.log('Data has no embeddings, creating generic plot');
                    // Create a basic plot panel that can be configured
                    uiManager.createPanel('panel-1', 'plot', {
                        plotType: 'scatter',
                        title: 'Data Visualization'
                    });
                }
            } catch (error) {
                console.error('Error creating default plot:', error);
                // Create a basic panel as fallback
                uiManager.createPanel('panel-1', 'plot', {
                    plotType: 'scatter',
                    title: 'Data Visualization' 
                });
            }
        } else {
            console.log('First panel not found, initializing UI');
            // First panel doesn't exist, might need to initialize the UI
            try {
                if (typeof uiManager !== 'undefined' && uiManager) {
                    // Make sure UI is initialized with single layout
                    uiManager.initialize('vizContainer');
                    uiManager.setLayout('single');
                    
                    // Try again to create the panel
                    const newFirstPanel = document.getElementById('panel-1');
                    if (newFirstPanel) {
                        uiManager.createPanel('panel-1', 'plot', {
                            plotType: 'scatter',
                            title: 'Data Visualization'
                        });
                    }
                }
            } catch (error) {
                console.error('Error initializing UI after data load:', error);
            }
        }
        
        console.log('Data loaded event processing complete');
    });
}

/**
 * Check for dataset parameters in URL
 */
function checkForDataInUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const dataset = urlParams.get('dataset') || urlParams.get('demo'); // Support both new and old parameter names
    const path = urlParams.get('path');
    
    if (dataset || path) {
        // Wait a moment for the available datasets to be loaded first
        setTimeout(() => {
            showLoadingIndicator('Loading data...');
            loadDataFromPath(dataset, path)
                .then(() => {
                    hideLoadingIndicator();
                })
                .catch(error => {
                    showError('Error loading data: ' + error.message);
                    hideLoadingIndicator();
                });
        }, 500);
    }
}

/**
 * Load zarr data from local files
 * @param {FileList} files - Selected files
 * @returns {Promise<void>} 
 */
async function loadZarrFromLocal(files) {
    try {
        // Load the zarr store
        await zarrLoader.loadFromDirectory(files);
        
        // Convert to AnnData
        return await loadAnndataFromZarr();
    } catch (error) {
        console.error('Error loading zarr from local files:', error);
        throw error;
    }
}

/**
 * Load zarr data from URL
 * @param {string} url - URL to the zarr store
 * @returns {Promise<void>}
 */
async function loadZarrFromUrl(url) {
    try {
        // Load the zarr store
        await zarrLoader.loadFromUrl(url);
        
        // Convert to AnnData
        return await loadAnndataFromZarr();
    } catch (error) {
        console.error('Error loading zarr from URL:', error);
        throw error;
    }
}

/**
 * Load zarr data from S3
 * @param {Object} s3Config - S3 configuration
 * @returns {Promise<void>}
 */
async function loadZarrFromS3(s3Config) {
    try {
        // Load the zarr store
        await zarrLoader.loadFromS3(s3Config);
        
        // Convert to AnnData
        return await loadAnndataFromZarr();
    } catch (error) {
        console.error('Error loading zarr from S3:', error);
        throw error;
    }
}

/**
 * Legacy function - redirects to the new loadAvailableData function
 * This function is kept for backwards compatibility
 */
async function loadAvailableDemoData() {
    return loadAvailableData();
}

/**
 * Load available data from the server and display in a browsable interface
 * This function shows available datasets from the application startup directory
 * with navigation controls and proper separation of directories and zarr files
 */
async function loadAvailableData() {
    try {
        // Get the datasets container element
        const demoContainer = document.getElementById('datasetsList');
        if (!demoContainer) {
            console.error('Demo datasets container not found');
            return;
        }
        
        // Hide loading indicators
        const loadingIndicator = document.getElementById('datasetsLoading');
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        
        // Hide error message
        const errorMessage = document.getElementById('datasetsError');
        if (errorMessage) errorMessage.classList.add('d-none');

        // Initialize datasets array
        const datasets = {
            directories: [],
            zarrFiles: []
        };
        
        // Clear existing demo datasets and remove loading spinner
        demoContainer.innerHTML = '';
        
        // Check if we're using file:// protocol, which doesn't support fetch for directory listing
        const isFileProtocol = window.location.protocol === 'file:';
        
        // Create a refresh button
        const refreshButton = document.createElement('button');
        refreshButton.className = 'btn btn-sm btn-outline-primary mb-3';
        refreshButton.innerHTML = '<i class="fas fa-sync-alt me-1"></i> Refresh';
        refreshButton.addEventListener('click', function() {
            this.disabled = true;
            this.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Refreshing...';
            
            // Keep track of the current directory when refreshing
            loadAvailableData().finally(() => {
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-sync-alt me-1"></i> Refresh';
            });
        });
        
        // Add the refresh button to the container
        demoContainer.appendChild(refreshButton);
        
        // Add status message while loading
        const statusMessage = document.createElement('div');
        statusMessage.className = 'alert alert-info mb-3';
        statusMessage.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="spinner-border spinner-border-sm me-2" role="status"></span>
                <span>Loading available data...</span>
            </div>
        `;
        demoContainer.appendChild(statusMessage);
        
        // Track current directory
        let currentDirectory = "."; // Start at application root
        
        // Create breadcrumbs navigation
        const breadcrumbsContainer = document.createElement('nav');
        breadcrumbsContainer.setAttribute('aria-label', 'breadcrumb');
        breadcrumbsContainer.className = 'mb-3';
        breadcrumbsContainer.innerHTML = `
            <ol class="breadcrumb" id="directoryBreadcrumbs">
                <li class="breadcrumb-item active" aria-current="page">
                    <a href="#" data-path=".">Home</a>
                </li>
            </ol>
        `;
        demoContainer.appendChild(breadcrumbsContainer);
        
        // Add event listener for breadcrumb navigation
        document.getElementById('directoryBreadcrumbs').addEventListener('click', function(event) {
            event.preventDefault();
            const target = event.target;
            
            if (target.tagName === 'A' && target.hasAttribute('data-path')) {
                const path = target.getAttribute('data-path');
                currentDirectory = path;
                refreshDirectoryContents(path);
            }
        });
        
        // Function to update breadcrumbs based on current path
        function updateBreadcrumbs(path) {
            const breadcrumbs = document.getElementById('directoryBreadcrumbs');
            const pathParts = path === '.' ? [] : path.split('/');
            
            // Clear existing breadcrumbs
            breadcrumbs.innerHTML = '';
            
            // Always add home
            const homeItem = document.createElement('li');
            homeItem.className = 'breadcrumb-item';
            if (path === '.') homeItem.className += ' active';
            homeItem.innerHTML = path === '.' ? 
                'Home' : 
                '<a href="#" data-path=".">Home</a>';
            breadcrumbs.appendChild(homeItem);
            
            // Add path parts
            let currentPath = '';
            pathParts.forEach((part, index) => {
                currentPath += (index > 0 ? '/' : '') + part;
                
                const item = document.createElement('li');
                item.className = 'breadcrumb-item';
                if (index === pathParts.length - 1) {
                    item.className += ' active';
                    item.setAttribute('aria-current', 'page');
                    item.textContent = part;
                } else {
                    item.innerHTML = `<a href="#" data-path="${currentPath}">${part}</a>`;
                }
                breadcrumbs.appendChild(item);
            });
        }
        
        // Function to fetch and display directory contents
        async function refreshDirectoryContents(directoryPath) {
            currentDirectory = directoryPath; // Update current directory
            
            // Show loading indicator
            const contentsContainer = document.getElementById('directoryContents');
            if (contentsContainer) {
                contentsContainer.innerHTML = `
                    <div class="d-flex justify-content-center p-4">
                        <div class="spinner-border" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                `;
            }
            
            try {
                // Update breadcrumbs
                updateBreadcrumbs(directoryPath);
                
                // Fetch directory contents from API
                let apiUrl = `${window.ANNZARRO_API_URL}/datasets?dir=${encodeURIComponent(directoryPath)}`;
                console.log(`Fetching directory contents from: ${apiUrl}`);
                
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load directory contents: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                
                // Clear existing datasets
                datasets.directories = [];
                datasets.zarrFiles = [];
                
                // Process the response data
                if (data.datasets && Array.isArray(data.datasets)) {
                    data.datasets.forEach(item => {
                        // Check if it's a zarr file or directory
                        if (item.name.endsWith('.zarr')) {
                            datasets.zarrFiles.push({
                                name: item.name,
                                displayName: item.name.replace(/\.zarr$/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                path: item.path,
                                description: item.description || 'AnnData dataset in zarr format',
                                isSymlink: item.is_symlink || false
                            });
                        } else if (item.is_directory) {
                            datasets.directories.push({
                                name: item.name,
                                path: item.path,
                                isSymlink: item.is_symlink || false
                            });
                        }
                    });
                }
                
                // Display the contents
                displayDirectoryContents();
                
            } catch (error) {
                console.error('Error fetching directory contents:', error);
                
                if (contentsContainer) {
                    contentsContainer.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-circle me-2"></i>
                            Error loading directory contents: ${error.message}
                        </div>
                    `;
                }
            }
        }
        
        // Function to display directory contents
        function displayDirectoryContents() {
            // Remove the loading status message
            if (statusMessage.parentNode) {
                statusMessage.parentNode.removeChild(statusMessage);
            }
            
            // Create or get the contents container
            let contentsContainer = document.getElementById('directoryContents');
            if (!contentsContainer) {
                contentsContainer = document.createElement('div');
                contentsContainer.id = 'directoryContents';
                demoContainer.appendChild(contentsContainer);
            }
            
            // Clear existing content
            contentsContainer.innerHTML = '';
            
            // Show "up" navigation if not at root
            if (currentDirectory !== '.') {
                const upButton = document.createElement('button');
                upButton.type = 'button';
                upButton.className = 'list-group-item list-group-item-action';
                upButton.innerHTML = '<i class="fas fa-level-up-alt me-2"></i> Up one level';
                upButton.addEventListener('click', function() {
                    // Go up one level in the directory tree
                    const parts = currentDirectory.split('/');
                    parts.pop();
                    const parentDir = parts.length === 0 ? '.' : parts.join('/');
                    refreshDirectoryContents(parentDir);
                });
                contentsContainer.appendChild(upButton);
            }
            
            // Display directories
            if (datasets.directories.length > 0) {
                const directoriesTitle = document.createElement('div');
                directoriesTitle.className = 'list-group-item list-group-item-secondary';
                directoriesTitle.innerHTML = '<i class="fas fa-folder me-2"></i> Directories';
                contentsContainer.appendChild(directoriesTitle);
                
                datasets.directories.forEach(directory => {
                    const directoryItem = document.createElement('button');
                    directoryItem.type = 'button';
                    directoryItem.className = 'list-group-item list-group-item-action';
                    
                    // Add symlink indicator if applicable
                    const symlinkBadge = directory.isSymlink ? 
                        '<span class="badge bg-info ms-2">symlink</span>' : '';
                    
                    directoryItem.innerHTML = `
                        <i class="fas fa-folder me-2"></i>
                        ${directory.name}${symlinkBadge}
                    `;
                    
                    directoryItem.addEventListener('click', function() {
                        refreshDirectoryContents(directory.path);
                    });
                    
                    contentsContainer.appendChild(directoryItem);
                });
            }
            
            // Display zarr files
            if (datasets.zarrFiles.length > 0) {
                const zarrTitle = document.createElement('div');
                zarrTitle.className = 'list-group-item list-group-item-secondary';
                zarrTitle.innerHTML = '<i class="fas fa-database me-2"></i> Zarr Datasets';
                contentsContainer.appendChild(zarrTitle);
                
                datasets.zarrFiles.forEach(dataset => {
                    const datasetItem = document.createElement('button');
                    datasetItem.type = 'button';
                    datasetItem.className = 'list-group-item list-group-item-action';
                    datasetItem.dataset.demo = dataset.displayName.toLowerCase();
                    datasetItem.dataset.path = dataset.path;
                    
                    // Add symlink indicator if applicable
                    const symlinkBadge = dataset.isSymlink ? 
                        '<span class="badge bg-info ms-2">symlink</span>' : '';
                    
                    datasetItem.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h5 class="mb-1">
                                <i class="fas fa-database me-2"></i>
                                ${dataset.displayName}${symlinkBadge}
                            </h5>
                        </div>
                        <div class="small text-muted">${dataset.description}</div>
                        <div class="small text-muted">Path: ${dataset.path}</div>
                    `;
                    
                    // Add click handler to select this dataset
                    datasetItem.addEventListener('click', function(event) {
                        // Remove active class from all items
                        document.querySelectorAll('#directoryContents .list-group-item').forEach(i => {
                            i.classList.remove('active');
                        });
                        
                        // Add active class to clicked item
                        this.classList.add('active');
                    });
                    
                    contentsContainer.appendChild(datasetItem);
                });
            }
            
            // If no items found, show message
            if (datasets.directories.length === 0 && datasets.zarrFiles.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'alert alert-info mt-3';
                emptyMessage.innerHTML = 'This directory is empty';
                contentsContainer.appendChild(emptyMessage);
            }
            
            // Add load button for zarr files
            if (datasets.zarrFiles.length > 0) {
                const loadButton = document.createElement('button');
                loadButton.type = 'button';
                loadButton.className = 'btn btn-primary mt-3 w-100';
                loadButton.innerHTML = '<i class="fas fa-download me-1"></i> Load Selected Dataset';
                loadButton.addEventListener('click', function() {
                    const selectedDataset = document.querySelector('#directoryContents .list-group-item.active');
                    if (selectedDataset) {
                        const demoType = selectedDataset.dataset.demo;
                        const path = selectedDataset.dataset.path;
                        
                        // Show loading indicator
                        showLoadingIndicator('Loading data...');
                        
                        // Use the path directly for loading
                        loadDataFromPath(demoType, path)
                            .then(() => {
                                hideLoadingIndicator();
                                $('#browseDataModal').modal('hide');
                            })
                            .catch(error => {
                                showError('Error loading data: ' + error.message);
                                hideLoadingIndicator();
                            });
                    } else {
                        showError('Please select a dataset');
                    }
                });
                demoContainer.appendChild(loadButton);
            }
        }
        
        // Handle the case where no datasets are found (replacing the else branch)
        if (datasets.directories.length === 0 && datasets.zarrFiles.length === 0) {
            // Default case - just display empty container with message
            console.log('No datasets found in standard location');
            
            // Add information notice 
            const notice = document.createElement('div');
            notice.className = 'alert alert-info mb-3';
            notice.innerHTML = `
                <i class="fas fa-info-circle me-2"></i>
                No datasets found. Please check that the data directory exists and contains .zarr datasets.
            `;
            demoContainer.appendChild(notice);
            
            // Add a retry button
            const retryButton = document.createElement('button'); 
            retryButton.type = 'button';
            retryButton.className = 'btn btn-primary mb-3';
            retryButton.innerHTML = '<i class="fas fa-sync-alt me-2"></i>Retry Loading Datasets';
            retryButton.addEventListener('click', function() {
                loadAvailableData();
            });
            
            demoContainer.appendChild(retryButton);
        }
        
        // Remove status message
        if (statusMessage.parentNode) {
            statusMessage.parentNode.removeChild(statusMessage);
        }
        
        console.log('Final datasets count:', datasets.directories.length + datasets.zarrFiles.length);
        
        // If still no datasets, show warning
        if (datasets.directories.length === 0 && datasets.zarrFiles.length === 0) {
            console.log('No datasets found, showing warning');
            const warningEl = document.createElement('div');
            warningEl.className = 'alert alert-warning';
            warningEl.innerHTML = `
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                No datasets found in the current directory.
            `;
            demoContainer.appendChild(warningEl);
            
            // Add a direct load aging.zarr button as fallback
            const fallbackButton = document.createElement('button');
            fallbackButton.type = 'button';
            fallbackButton.className = 'btn btn-primary mt-3';
            fallbackButton.innerHTML = '<i class="bi bi-database-fill me-1"></i> Try Loading Sample Dataset';
            fallbackButton.addEventListener('click', function() {
                loadDataFromPath('aging', 'data/aging.zarr')
                    .then(() => {
                        // Hide the modal
                        $('#browseDataModal').modal('hide');
                    })
                    .catch(error => {
                        console.error('Error loading sample dataset:', error);
                        // Show error message
                        showError('Error loading sample dataset: ' + error.message);
                    });
            });
            demoContainer.appendChild(fallbackButton);
            
            return;
        }
        
        // Create a container for the dataset buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'list-group mt-3';
        
        // Create a button for each dataset
        datasets.zarrFiles.forEach(dataset => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'list-group-item list-group-item-action';
            button.dataset.demo = dataset.displayName.toLowerCase();
            button.dataset.path = dataset.path;
            
            // Add symlink indicator if applicable
            const symlinkBadge = dataset.isSymlink 
                ? '<span class="badge bg-info ms-2">symlink</span>' 
                : '';
            
            button.innerHTML = `
                <strong>${dataset.displayName} Dataset${symlinkBadge}</strong>
                <div class="small text-muted">${dataset.description}</div>
                <div class="small text-muted">Path: ${dataset.path}</div>
            `;
            
            // Add click handler directly to prevent issues with dynamic elements
            button.addEventListener('click', function(event) {
                // Prevent default behavior
                event.preventDefault();
                
                // Remove active class from all items
                document.querySelectorAll('#demoDatasetsList .list-group-item').forEach(i => {
                    i.classList.remove('active');
                });
                
                // Add active class to clicked item
                this.classList.add('active');
            });
            
            buttonsContainer.appendChild(button);
        });
        
        // Add the buttons to the container
        demoContainer.appendChild(buttonsContainer);
        
        // Mark the first dataset as active by default
        const firstButton = buttonsContainer.querySelector('.list-group-item');
        if (firstButton) {
            firstButton.classList.add('active');
        }
        
        // Add a direct load button for convenience
        const directLoadButton = document.createElement('button');
        directLoadButton.type = 'button';
        directLoadButton.className = 'btn btn-primary mt-3 w-100';
        directLoadButton.innerHTML = '<i class="fas fa-download me-1"></i> Load Selected Dataset';
        directLoadButton.addEventListener('click', function() {
            const selectedDemo = document.querySelector('#demoDatasetsList .list-group-item.active');
            if (selectedDemo) {
                const demoType = selectedDemo.dataset.demo;
                const path = selectedDemo.dataset.path;
                
                // Show loading indicator
                showLoadingIndicator('Loading data...');
                
                loadDataFromPath(demoType, path)
                    .then(() => {
                        hideLoadingIndicator();
                        $('#browseDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading data: ' + error.message);
                        hideLoadingIndicator();
                    });
            } else {
                showError('Please select a dataset');
            }
        });
        demoContainer.appendChild(directLoadButton);
        
    } catch (error) {
        console.error('Error in loadAvailableData:', error);
        
        // Display an error message in the demo container
        const demoContainer = document.querySelector('#datasetsList');
        if (demoContainer) {
            demoContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Error loading datasets: ${error.message}
                </div>
                <button class="btn btn-primary mt-3" id="retryLoadBtn">
                    <i class="fas fa-sync-alt me-1"></i> Retry Loading Datasets
                </button>
                <button class="btn btn-outline-primary mt-3 ms-2" id="directLoadAgingBtn">
                    <i class="fas fa-database me-1"></i> Load Aging Dataset Directly
                </button>
            `;
            
            // Add event listeners to the buttons
            document.getElementById('retryLoadBtn')?.addEventListener('click', function() {
                loadAvailableData();
            });
            
            document.getElementById('directLoadAgingBtn')?.addEventListener('click', function() {
                loadDataFromPath('aging', 'data/aging.zarr')
                    .then(() => {
                        $('#browseDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading sample dataset: ' + error.message);
                    });
            });
        }
    }
}

/**
 * Load data from a specified path
 * @param {string} datasetName - Name of the dataset
 * @param {string} path - Optional direct path to the data
 * @returns {Promise<void>}
 */
async function loadDataFromPath(datasetName, path = null) {
    try {
        // Make sure zarr is defined
        if (typeof zarr === 'undefined') {
            throw new Error('zarr is not defined. Make sure the zarr.js library is properly loaded.');
        }
        
        // Find the selected dataset element
        let selectedDataset = document.querySelector(`#datasetsList .list-group-item[data-demo="${datasetName}"]`);
        
        // If no dataset is selected but we have a path, use that
        const datasetPath = path || (selectedDataset ? selectedDataset.dataset.path : null);
        
        if (!datasetPath) {
            throw new Error('No dataset path specified');
        }
        
        console.log(`Loading data from path: ${datasetPath}`);
        
        // Add token parameter if present in the URL and is valid (for auth)
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        // Only add token if it's alphanumeric (basic security validation)
        const pathWithParams = (token && /^[a-zA-Z0-9]+$/.test(token)) ? 
            `${datasetPath}?token=${token}` : datasetPath;
        
        try {
            // Load from URL using zarrLoader
            console.log('Loading zarr data from URL:', pathWithParams);
            await zarrLoader.loadFromUrl(pathWithParams);
            
            // Convert to AnnData
            return await loadAnndataFromZarr();
        } catch (error) {
            console.error('Error loading data from path:', error);
            throw error;
        }
    } catch (error) {
        // console.error('[DEBUG] Error loading demo data:', error);
        throw error;
    }
}

/**
 * Create a hardcoded dataset structure for demo purposes
 * @param {string} datasetType - Type of dataset to create
 * @returns {Object} An AnnData-like object structure
 */
function createHardcodedDataset(datasetType) {
    // console.log(`[DEBUG] Creating hardcoded dataset for type: ${datasetType}`);
    
    // Default structure for all datasets
    const baseStructure = {
        shape: [1000, 2000],
        X: {
            shape: [1000, 2000],
            dtype: 'float32',
            path: 'X'
        }
    };
    
    // Dataset-specific customizations
    if (datasetType === 'aging') {
        // Create an aging dataset with relevant cell types and genes
        return {
            ...baseStructure,
            obs: {
                index: Array.from({length: 1000}, (_, i) => `cell_${i}`),
                columns: ['cell_type', 'age', 'condition'],
                columnsInfo: {
                    cell_type: { 
                        shape: [1000], 
                        dtype: 'string', 
                        path: 'obs/cell_type',
                        categories: ['HSC', 'MPP', 'GMP', 'MEP', 'CLP']
                    },
                    age: { 
                        shape: [1000], 
                        dtype: 'string', 
                        path: 'obs/age',
                        categories: ['Young', 'Mid', 'Old']
                    },
                    condition: { 
                        shape: [1000], 
                        dtype: 'string', 
                        path: 'obs/condition',
                        categories: ['WT', 'KO']
                    }
                }
            },
            var: {
                index: [
                    'Hoxa9', 'Meis1', 'Pbx1', 'Runx1', 'Gata2', 'Foxo3', 'Cebpa', 'Myc', 
                    'Stat3', 'Bcl2', 'Mpl', 'Cd34', 'Itga2b', 'Prdm16', 'Hif1a', 'Sirt1',
                    ...Array.from({length: 1984}, (_, i) => `gene_${i + 17}`)
                ],
                columns: ['gene_name', 'expressed', 'highly_variable'],
                columnsInfo: {
                    gene_name: { shape: [2000], dtype: 'string', path: 'var/gene_name' },
                    expressed: { shape: [2000], dtype: 'boolean', path: 'var/expressed' },
                    highly_variable: { shape: [2000], dtype: 'boolean', path: 'var/highly_variable' }
                }
            },
            obsm: {
                'X_umap': { shape: [1000, 2], dtype: 'float32', path: 'obsm/X_umap' },
                'X_pca': { shape: [1000, 50], dtype: 'float32', path: 'obsm/X_pca' },
                'X_tsne': { shape: [1000, 2], dtype: 'float32', path: 'obsm/X_tsne' }
            },
            uns: {
                'aging_metadata': {
                    experiment_date: '2023-04-15',
                    organism: 'Mus musculus',
                    tissue: 'Bone marrow',
                    citation: 'Example et al., 2023'
                }
            },
            layers: {
                'normalized_counts': { shape: [1000, 2000], dtype: 'float32', path: 'layers/normalized_counts' },
                'MAGIC_imputed_data': { shape: [1000, 2000], dtype: 'float32', path: 'layers/MAGIC_imputed_data' }
            }
        };
    } else {
        // Generic dataset for other types
        return {
            ...baseStructure,
            obs: {
                index: Array.from({length: 1000}, (_, i) => `cell_${i}`),
                columns: ['cell_type', 'condition'],
                columnsInfo: {
                    cell_type: { shape: [1000], dtype: 'string', path: 'obs/cell_type' },
                    condition: { shape: [1000], dtype: 'string', path: 'obs/condition' }
                }
            },
            var: {
                index: Array.from({length: 2000}, (_, i) => `gene_${i}`),
                columns: ['gene_name', 'expressed'],
                columnsInfo: {
                    gene_name: { shape: [2000], dtype: 'string', path: 'var/gene_name' },
                    expressed: { shape: [2000], dtype: 'boolean', path: 'var/expressed' }
                }
            },
            obsm: {
                'X_umap': { shape: [1000, 2], dtype: 'float32', path: 'obsm/X_umap' },
                'X_pca': { shape: [1000, 50], dtype: 'float32', path: 'obsm/X_pca' }
            }
        };
    }
}


/**
 * Load AnnData from zarr store
 * @returns {Promise<void>}
 */
async function loadAnndataFromZarr() {
    try {
        console.log('Starting to load AnnData from zarr');
        
        // Convert zarr to AnnData structure using backend API
        const anndata = await zarrLoader.convertToAnnData();
        console.log('AnnData structure received:', anndata);
        
        // Update data manager with the AnnData structure
        if (dataManager && typeof dataManager.setAnndata === 'function') {
            console.log('Setting AnnData in dataManager.setAnndata');
            dataManager.setAnndata(anndata);
        } else if (dataManager) {
            console.log('Setting AnnData directly in dataManager.anndata');
            dataManager.anndata = anndata;
        } else {
            console.error('dataManager not available, cannot set AnnData');
        }
        
        // Dispatch dataLoaded event
        console.log('Dispatching dataLoaded event');
        const event = new CustomEvent('dataLoaded', {
            detail: { source: 'zarr', data: anndata }
        });
        document.dispatchEvent(event);
        
        // Update the UI
        updateAfterDataLoad();
        
        return Promise.resolve();
    } catch (error) {
        console.error('Error loading AnnData from zarr:', error);
        throw error;
    }
}

/**
 * Update the UI after data is loaded
 */
function updateAfterDataLoad() {
    console.log('Updating UI after data load');
    
    try {
        // Update status indicator
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusIndicator) {
            console.log('Updating status indicator');
            // Get basic info from data manager if available
            let dataInfo = '';
            if (dataManager && dataManager.isDataLoaded && dataManager.isDataLoaded()) {
                let info = {};
                if (typeof dataManager.getBasicInfo === 'function') {
                    info = dataManager.getBasicInfo();
                } else if (dataManager.anndata) {
                    info = {
                        nObs: dataManager.anndata.observations || 0,
                        nVars: dataManager.anndata.variables || 0
                    };
                }
                
                // Add info to status badge
                if (info.nObs && info.nVars) {
                    dataInfo = ` (${info.nObs} cells × ${info.nVars} genes)`;
                }
            }
            
            statusIndicator.innerHTML = `<span class="badge bg-success">Data Loaded${dataInfo}</span>`;
        }
        
        // Hide empty state and show panels
        const emptyState = document.getElementById('emptyState');
        const panelContainer = document.getElementById('panelContainer');
        
        if (emptyState) {
            console.log('Hiding empty state');
            emptyState.classList.add('d-none');
            emptyState.style.display = 'none';
        }
        
        if (panelContainer) {
            console.log('Showing panel container');
            panelContainer.classList.remove('d-none');
            panelContainer.style.display = 'block';
            panelContainer.style.height = '100%';
            
            // Create default panel if none exists
            if (!panelContainer.querySelector('#vizContainer') && !panelContainer.querySelector('.panel')) {
                console.log('Panel container is empty, initializing UI manager');
                if (typeof uiManager !== 'undefined' && uiManager) {
                    // Initialize the UI manager with the container and create a default layout
                    console.log('Creating default panel in empty container');
                    uiManager.initialize('vizContainer');
                    uiManager.setLayout('single');
                    
                    // Create a default plot panel
                    const panel1 = document.getElementById('panel-1');
                    if (panel1) {
                        console.log('Creating plot in panel-1');
                        uiManager.createPanel('panel-1', 'plot', {
                            plotType: 'scatter',
                            title: 'Data Visualization'
                        });
                    }
                }
            }
        }
        
        // Update gene and cell options
        console.log('Updating gene and cell options');
        updateGeneOptions();
        updateCellOptions();
        
        console.log('UI update complete');
    } catch (error) {
        console.error('Error updating UI after data load:', error);
    }
}

/**
 * Update gene selection options
 * @param {string} geneNameColumn - Optional column containing gene names
 */
function updateGeneOptions(geneNameColumn = null) {
    const geneFocusSelect = document.getElementById('geneFocus');
    
    // Clear existing options
    geneFocusSelect.innerHTML = '<option value="">None selected</option>';
    
    // Check if data is loaded
    if (!dataManager.isDataLoaded()) return;
    
    try {
        // First try the API endpoint which can use a specific column
        let url = `${window.ANNZARRO_API_URL}/data/genes`;
        if (geneNameColumn) {
            url += `?column=${encodeURIComponent(geneNameColumn)}`;
        }
        
        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.genes && data.genes.length > 0) {
                    const geneNames = data.genes;
                    
                    // Add options to select
                    for (const gene of geneNames) {
                        const option = document.createElement('option');
                        option.value = gene;
                        option.textContent = gene;
                        geneFocusSelect.appendChild(option);
                    }
                    
                    // Initialize select2 for better UX
                    $(geneFocusSelect).select2({
                        placeholder: 'Select a gene',
                        allowClear: true,
                        width: '100%'
                    });
                    
                    return;
                }
                
                // If the API failed or returned empty, try the legacy method
                fallbackLoadGenes();
            })
            .catch(error => {
                console.error('Error loading genes from API:', error);
                // Try legacy method as fallback
                fallbackLoadGenes();
            });
    } catch (error) {
        console.error('Error setting up gene options:', error);
        // Try legacy method as fallback
        fallbackLoadGenes();
    }
    
    function fallbackLoadGenes() {
        try {
            // Try to load var index directly
            dataManager.loadVar()
                .then(varData => {
                    if (varData && varData._index) {
                        const geneNames = varData._index;
                        
                        // Add options to select
                        for (const gene of geneNames) {
                            const option = document.createElement('option');
                            option.value = gene;
                            option.textContent = gene;
                            geneFocusSelect.appendChild(option);
                        }
                        
                        // Initialize select2 for better UX
                        $(geneFocusSelect).select2({
                            placeholder: 'Select a gene',
                            allowClear: true,
                            width: '100%'
                        });
                    }
                })
                .catch(error => {
                    console.error('Error loading var data:', error);
                });
        } catch (error) {
            console.error('Error in fallback gene loading:', error);
        }
    }
}

/**
 * Update cell selection options
 */
function updateCellOptions() {
    const cellFocusSelect = document.getElementById('cellFocus');
    
    // Clear existing options
    cellFocusSelect.innerHTML = '<option value="">None selected</option>';
    
    // Check if data is loaded
    if (!dataManager.isDataLoaded()) return;
    
    // Get obs index
    try {
        // Try to load obs index
        dataManager.loadObs()
            .then(obsData => {
                if (obsData && obsData._index) {
                    const cellNames = obsData._index;
                    
                    // Add options to select
                    for (const cell of cellNames) {
                        const option = document.createElement('option');
                        option.value = cell;
                        option.textContent = cell;
                        cellFocusSelect.appendChild(option);
                    }
                    
                    // Initialize select2 for better UX
                    $(cellFocusSelect).select2({
                        placeholder: 'Select a cell',
                        allowClear: true,
                        width: '100%'
                    });
                }
            })
            .catch(error => {
                console.error('Error loading obs data:', error);
            });
    } catch (error) {
        console.error('Error setting up cell options:', error);
    }
}

/**
 * Save the current layout to localStorage
 */
function saveCurrentLayout() {
    try {
        const layout = {
            type: uiManager.currentLayout,
            panels: {}
        };
        
        // Get panel configurations
        uiManager.panels.forEach((panel, panelId) => {
            layout.panels[panelId] = {
                type: panel.type,
                config: panel.config
            };
        });
        
        // Save to localStorage
        localStorage.setItem('savedLayout', JSON.stringify(layout));
        
        showSuccess('Layout saved successfully');
    } catch (error) {
        console.error('Error saving layout:', error);
        showError('Error saving layout: ' + error.message);
    }
}

/**
 * Load a saved layout from localStorage
 */
function loadSavedLayout() {
    try {
        const savedLayout = localStorage.getItem('savedLayout');
        if (!savedLayout) {
            return false;
        }
        
        const layout = JSON.parse(savedLayout);
        
        // Set the layout type
        uiManager.setLayout(layout.type);
        
        // Restore panels
        Object.entries(layout.panels).forEach(([panelId, panelInfo]) => {
            const panelElement = document.getElementById(panelId);
            if (panelElement) {
                uiManager.createPanel(panelId, panelInfo.type, panelInfo.config);
            }
        });
        
        return true;
    } catch (error) {
        console.error('Error loading saved layout:', error);
        return false;
    }
}

/**
 * Show a loading indicator
 * @param {string} message - Loading message
 */
function showLoadingIndicator(message = 'Loading...') {
    // Create loading overlay if it doesn't exist
    let loadingOverlay = document.getElementById('loadingOverlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loadingOverlay';
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="spinner-container">
                <div class="spinner-border text-primary" role="status"></div>
                <div class="mt-2" id="loadingMessage">${message}</div>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    } else {
        document.getElementById('loadingMessage').textContent = message;
        loadingOverlay.style.display = 'flex';
    }
}

/**
 * Hide the loading indicator
 */
function hideLoadingIndicator() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

/**
 * Show an error message
 * @param {string} message - Error message
 */
function showError(message) {
    // Create a toast notification
    const errorToast = document.createElement('div');
    errorToast.className = 'toast align-items-center text-white bg-danger border-0';
    errorToast.setAttribute('role', 'alert');
    errorToast.setAttribute('aria-live', 'assertive');
    errorToast.setAttribute('aria-atomic', 'true');
    errorToast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="fas fa-exclamation-circle me-2"></i> ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    
    // Add toast to container
    toastContainer.appendChild(errorToast);
    
    // Initialize and show the toast
    const toast = new bootstrap.Toast(errorToast);
    toast.show();
    
    // Remove the toast after it's hidden
    errorToast.addEventListener('hidden.bs.toast', function() {
        errorToast.remove();
    });
}

/**
 * Show a success message
 * @param {string} message - Success message
 */
function showSuccess(message) {
    // Create a toast notification
    const successToast = document.createElement('div');
    successToast.className = 'toast align-items-center text-white bg-success border-0';
    successToast.setAttribute('role', 'alert');
    successToast.setAttribute('aria-live', 'assertive');
    successToast.setAttribute('aria-atomic', 'true');
    successToast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="fas fa-check-circle me-2"></i> ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    
    // Add toast to container
    toastContainer.appendChild(successToast);
    
    // Initialize and show the toast
    const toast = new bootstrap.Toast(successToast);
    toast.show();
    
    // Remove the toast after it's hidden
    successToast.addEventListener('hidden.bs.toast', function() {
        successToast.remove();
    });
}