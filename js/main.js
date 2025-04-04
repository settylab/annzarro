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

// Function to configure API URL - using unified server approach only
/**
 * Configure and verify API connection, with automatic retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 1000)
 * @returns {Promise<boolean>} - Success status
 */
async function getApiConfig(maxRetries = 3, retryDelay = 1000) {
    let retryCount = 0;
    
    async function attemptConnection() {
        try {
            // Configure for unified server approach (only option now)
            console.log(`Configuring API for unified server (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            
            // Build API URL based on current location (same origin)
            const currentLocation = window.location;
            const protocol = currentLocation.protocol;
            const hostname = currentLocation.hostname;
            const port = currentLocation.port ? `:${currentLocation.port}` : '';
            
            // Use the same origin for API URL (unified server approach)
            window.ANNZARRO_API_URL = `${protocol}//${hostname}${port}/api/v1`;
            console.log(`Using unified server API URL: ${window.ANNZARRO_API_URL}`);
            
            // Set in global config as well
            if (window.Annzarro && window.Annzarro.config) {
                window.Annzarro.config.apiUrl = window.ANNZARRO_API_URL;
            }
            
            // Verify the API URL by making a test request
            const testResponse = await fetch(`${window.ANNZARRO_API_URL}/config`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                timeout: 2000
            });
            
            if (testResponse.ok) {
                console.log(`API URL verified: ${window.ANNZARRO_API_URL}`);
                
                // Get the actual config
                const config = await testResponse.json();
                console.log('Server config:', config);
                
                // Update UI with data directory if needed
                if (config && config.data_dir) {
                    console.log(`Server using data directory: ${config.data_dir}`);
                }
                
                // Check server status for more detailed info
                try {
                    const statusResponse = await fetch(`${window.ANNZARRO_API_URL}/status`, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        timeout: 2000
                    });
                    
                    if (statusResponse.ok) {
                        const statusData = await statusResponse.json();
                        console.log('Server status:', statusData);
                        
                        // Store server status information for later use
                        window.serverStatus = statusData;
                        
                        // Update status indicator if available
                        updateServerStatusIndicator(statusData);
                    }
                } catch (statusError) {
                    console.warn('Could not fetch detailed server status:', statusError);
                    // Non-critical, continue anyway
                }
                
                return true;
            } else {
                console.error(`API not available at ${window.ANNZARRO_API_URL}, status: ${testResponse.status}`);
                return false;
            }
        } catch (error) {
            console.error('Error verifying API URL:', error);
            return false;
        }
    }
    
    // First attempt
    let success = await attemptConnection();
    
    // Auto-retry logic
    while (!success && retryCount < maxRetries) {
        retryCount++;
        console.log(`Retrying connection in ${retryDelay}ms... (${retryCount}/${maxRetries})`);
        
        // Show retry notification if available
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusIndicator) {
            statusIndicator.innerHTML = `
                <span class="badge bg-warning">
                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                    Connecting... (${retryCount}/${maxRetries})
                </span>
            `;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Exponential backoff for retry delay
        retryDelay = Math.min(retryDelay * 1.5, 5000);
        
        // Attempt connection again
        success = await attemptConnection();
    }
    
    // Final result
    if (success) {
        console.log('API connection successful');
        return true;
    } else {
        console.error('Failed to connect to API server after multiple attempts');
        
        // Show failure in UI
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusIndicator) {
            statusIndicator.innerHTML = `
                <span class="badge bg-danger">
                    <i class="bi bi-exclamation-triangle-fill me-1"></i>
                    Server Disconnected
                </span>
            `;
        }
        
        // Show alert
        alert("Cannot connect to server. Please make sure the server is running at " + window.ANNZARRO_API_URL);
        return false;
    }
}

/**
 * Update the server status indicator in the UI
 * @param {Object} statusData - Server status data
 */
function updateServerStatusIndicator(statusData) {
    const statusIndicator = document.getElementById('statusIndicator');
    if (!statusIndicator) return;
    
    if (statusData && statusData.server && statusData.server.status === 'running') {
        // Server is running
        const memoryUsage = statusData.resources?.memory_usage_mb || 0;
        const cpuLoad = statusData.resources?.cpu_load || 0;
        const uptime = statusData.server?.uptime || 'unknown';
        
        statusIndicator.innerHTML = `
            <span class="badge bg-success" title="Server Status">
                <i class="bi bi-hdd-network-fill me-1"></i>
                Server Connected
            </span>
            <span class="badge bg-info ms-1" title="Memory Usage">
                <i class="bi bi-memory me-1"></i>
                ${memoryUsage.toFixed(0)} MB
            </span>
            <span class="badge bg-info ms-1" title="CPU Load">
                <i class="bi bi-cpu me-1"></i>
                ${cpuLoad.toFixed(0)}%
            </span>
        `;
    } else if (statusData && statusData.server && statusData.server.status === 'error') {
        // Server has an error
        statusIndicator.innerHTML = `
            <span class="badge bg-danger">
                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                Server Error: ${statusData.server.error || 'Unknown error'}
            </span>
        `;
    } else {
        // Unknown server status
        statusIndicator.innerHTML = `
            <span class="badge bg-warning">
                <i class="bi bi-question-circle-fill me-1"></i>
                Unknown Server Status
            </span>
        `;
    }
}

// Note: Legacy fallback for dual-server approach has been removed
// We now exclusively use the unified server approach with API and static content on the same port

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

/**
 * Background server health check function
 * Periodically monitors the server connection and updates UI accordingly
 */
let healthCheckInterval = null;
let connectionLostTime = null;
let consecutiveFailures = 0;

function startServerHealthCheck() {
    // Clear any existing interval
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    
    // Reset state
    connectionLostTime = null;
    consecutiveFailures = 0;
    
    // Start the health check interval
    healthCheckInterval = setInterval(async () => {
        // Skip if API URL is not configured
        if (!window.ANNZARRO_API_URL) return;
        
        try {
            // Make a lightweight request to the status endpoint
            const response = await fetch(`${window.ANNZARRO_API_URL}/status`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                timeout: 2000
            });
            
            if (response.ok) {
                // Server is responsive, reset failure counter
                const statusData = await response.json();
                console.log('Server health check OK');
                
                // Update the UI with status information
                updateServerStatusIndicator(statusData);
                
                // Store for app-wide access
                window.serverStatus = statusData;
                
                // If we were previously disconnected, show reconnection message
                if (connectionLostTime) {
                    const downtime = Math.round((Date.now() - connectionLostTime) / 1000);
                    showSuccess(`Server connection restored after ${downtime} seconds`);
                    connectionLostTime = null;
                }
                
                // Reset failure counter
                consecutiveFailures = 0;
            } else {
                // Server responded but with an error
                handleHealthCheckFailure(`Server responded with status ${response.status}`);
            }
        } catch (error) {
            // Connection failed completely
            handleHealthCheckFailure(`Connection error: ${error.message}`);
        }
    }, 30000); // Check every 30 seconds
    
    console.log('Server health check started');
}

/**
 * Handle health check failure by updating UI and tracking failures
 * @param {string} reason - Reason for the failure
 */
function handleHealthCheckFailure(reason) {
    consecutiveFailures++;
    console.warn(`Server health check failed (${consecutiveFailures}): ${reason}`);
    
    // Update the status indicator
    const statusIndicator = document.getElementById('statusIndicator');
    if (statusIndicator) {
        if (consecutiveFailures === 1) {
            // First failure, show warning
            statusIndicator.innerHTML = `
                <span class="badge bg-warning">
                    <i class="bi bi-exclamation-circle me-1"></i>
                    Server Connection Issue
                </span>
            `;
        } else if (consecutiveFailures >= 3) {
            // Multiple failures, consider disconnected
            statusIndicator.innerHTML = `
                <span class="badge bg-danger">
                    <i class="bi bi-x-circle me-1"></i>
                    Server Disconnected
                </span>
                <button id="reconnectBtn" class="btn btn-sm btn-outline-light ms-2">
                    <i class="bi bi-arrow-repeat me-1"></i>
                    Reconnect
                </button>
            `;
            
            // Add reconnect button handler
            document.getElementById('reconnectBtn')?.addEventListener('click', async function() {
                this.disabled = true;
                this.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Reconnecting...';
                
                // Try to reconnect
                const success = await getApiConfig(2, 1000);
                
                if (success) {
                    consecutiveFailures = 0;
                    connectionLostTime = null;
                } else {
                    // Reset button after failure
                    this.disabled = false;
                    this.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Reconnect';
                }
            });
            
            // Record when we first detected disconnection
            if (!connectionLostTime) {
                connectionLostTime = Date.now();
            }
        }
    }
    
    // If multiple failures and we have data loaded, show a toast warning
    if (consecutiveFailures === 3 && dataManager && dataManager.isDataLoaded()) {
        showWarning('Server connection lost. Your current view will remain available, but you cannot load new data.');
    }
}

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
    const apiConfigSuccess = await getApiConfig();
    
    // Start server health check if API connection was successful
    if (apiConfigSuccess) {
        startServerHealthCheck();
    }
    
    // Check if we have the zarrLoader available
    if (typeof zarrLoader === 'undefined' || !zarrLoader) {
        console.error('zarrLoader is not available. Make sure the unified server is running.');
        
        // Show a more detailed error based on what we know
        let apiUrl = window.ANNZARRO_API_URL || '(not configured)';
        let portMatch = apiUrl.match(/:(\d+)\//);
        let apiPort = portMatch ? portMatch[1] : 'unknown';
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.innerHTML = `
            <h4>Error: Unified Server Not Available</h4>
            <p>The application cannot connect to the unified server at ${apiUrl}.</p>
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
                <li>If you see "Address already in use" errors, stop the server:<br>
                <code>python run_annzarro.py --stop</code></li>
                <li>Check server configuration in <code>annzarro/server/config.json</code></li>
                <li>Verify the correct port is being used (currently trying to connect to port ${apiPort})</li>
            </ol>
            <p>After fixing the issue, refresh this page.</p>
            <button id="retryConnectionBtn" class="btn btn-primary mt-2">
                <i class="bi bi-arrow-repeat me-1"></i> Retry Connection
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
                const success = await getApiConfig(2, 1000);
                
                if (success) {
                    // Reload the page if successful
                    window.location.reload();
                } else {
                    this.innerHTML = '<i class="bi bi-exclamation-circle me-1"></i> Failed - Refresh Page to Try Again';
                    errorDiv.querySelector('ul').innerHTML += `<li>Retry attempt failed: Connection timeout</li>`;
                }
            } catch (retryError) {
                this.innerHTML = '<i class="bi bi-exclamation-circle me-1"></i> Failed - Refresh Page to Try Again';
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
    
    // Initialize dataframe UI if available
    if (typeof dataframeUI === 'object' && typeof dataframeUI.initialize === 'function') {
        try {
            dataframeUI.initialize();
        } catch (error) {
            console.error('Error initializing dataframe UI:', error);
            // Non-critical, continue anyway
        }
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
    const datasetId = urlParams.get('dataset_id'); // Support explicit dataset ID
    
    if (dataset || path) {
        // Wait a moment for the available datasets to be loaded first
        setTimeout(() => {
            showLoadingIndicator('Loading data...');
            loadDataFromPath(dataset, path, datasetId)
                .then((loadedDatasetId) => {
                    hideLoadingIndicator();
                    
                    // Add the dataset ID to the URL if not already present
                    if (loadedDatasetId && !urlParams.has('dataset_id')) {
                        const newParams = new URLSearchParams(window.location.search);
                        newParams.set('dataset_id', loadedDatasetId);
                        
                        // Update the URL without reloading the page
                        const newUrl = window.location.pathname + '?' + newParams.toString();
                        window.history.replaceState({}, '', newUrl);
                    }
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
        console.log('Loading available datasets...');
        
        // Get the datasets container element
        const demoContainer = document.getElementById('datasetsList');
        if (!demoContainer) {
            console.error('Datasets container not found');
            return;
        }
        
        // Hide loading indicators
        const loadingIndicator = document.getElementById('datasetsLoading');
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        
        // Hide error message
        const errorMessage = document.getElementById('datasetsError');
        if (errorMessage) errorMessage.classList.add('d-none');

        // Clear existing content
        demoContainer.innerHTML = '';
        
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
        
        // Create a refresh button
        const refreshButton = document.createElement('button');
        refreshButton.className = 'btn btn-sm btn-outline-primary mb-3';
        refreshButton.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Refresh';
        refreshButton.addEventListener('click', function() {
            this.disabled = true;
            this.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Refreshing...';
            
            // Reload available data
            loadAvailableData().finally(() => {
                this.disabled = false;
                this.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Refresh';
            });
        });
        
        // Add the refresh button to the container
        demoContainer.appendChild(refreshButton);
        
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
            if (!breadcrumbs) return;

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
        
        // Create contents container
        const contentsContainer = document.createElement('div');
        contentsContainer.id = 'directoryContents';
        contentsContainer.className = 'list-group mt-3';
        demoContainer.appendChild(contentsContainer);
        
        // First load of directory contents
        await refreshDirectoryContents(currentDirectory);
        
        // Function to fetch and display directory contents
        async function refreshDirectoryContents(directoryPath) {
            // Update current directory
            currentDirectory = directoryPath;
            console.log(`Loading directory contents for: ${directoryPath}`);
            
            // Show loading indicator
            contentsContainer.innerHTML = `
                <div class="d-flex justify-content-center p-4">
                    <div class="spinner-border" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>
            `;
            
            try {
                // Update breadcrumbs
                updateBreadcrumbs(directoryPath);
                
                // Make sure API URL is set
                if (!window.ANNZARRO_API_URL) {
                    throw new Error('API URL not configured. Try refreshing the page.');
                }
                
                // Fetch directory contents from API
                const apiUrl = `${window.ANNZARRO_API_URL}/datasets?dir=${encodeURIComponent(directoryPath)}`;
                console.log(`Fetching directory contents from: ${apiUrl}`);
                
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load directory contents: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                console.log('API response:', data);
                
                // Process and display the contents
                displayContents(data.datasets || []);
                
                // Remove the loading status message if it exists
                if (statusMessage && statusMessage.parentNode) {
                    statusMessage.parentNode.removeChild(statusMessage);
                }
            } catch (error) {
                console.error('Error fetching directory contents:', error);
                
                contentsContainer.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-circle me-2"></i>
                        Error loading directory contents: ${error.message}
                    </div>
                    <button class="btn btn-primary mt-3" id="retryDirectoryBtn">
                        <i class="bi bi-arrow-repeat me-1"></i> Retry
                    </button>
                `;
                
                // Add event listener to retry button
                document.getElementById('retryDirectoryBtn')?.addEventListener('click', function() {
                    refreshDirectoryContents(currentDirectory);
                });
            }
        }
        
        // Function to display directory contents
        function displayContents(items) {
            // Clear existing content
            contentsContainer.innerHTML = '';
            
            // Categorize items
            const directories = [];
            const zarrFiles = [];
            
            items.forEach(item => {
                // Check if this is a zarr dataset by checking the type or if the path ends with .zarr
                if (item.type === 'zarr' || (item.path && item.path.endsWith('.zarr'))) {
                    zarrFiles.push({
                        name: item.name || item.id || item.path.split('/').pop(),
                        displayName: item.name || item.id?.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        path: item.path,
                        description: item.description || 'AnnData dataset in zarr format',
                        isSymlink: item.is_symlink || false
                    });
                } else if (item.is_directory) {
                    directories.push({
                        name: item.name,
                        path: item.path,
                        isSymlink: item.is_symlink || false
                    });
                }
            });
            
            // Show "up" navigation if not at root
            if (currentDirectory !== '.') {
                const upButton = document.createElement('button');
                upButton.type = 'button';
                upButton.className = 'list-group-item list-group-item-action';
                upButton.innerHTML = '<i class="bi bi-arrow-up-circle me-2"></i> Up one level';
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
            if (directories.length > 0) {
                const directoriesTitle = document.createElement('div');
                directoriesTitle.className = 'list-group-item list-group-item-secondary';
                directoriesTitle.innerHTML = '<i class="bi bi-folder me-2"></i> Directories';
                contentsContainer.appendChild(directoriesTitle);
                
                directories.forEach(directory => {
                    const directoryItem = document.createElement('button');
                    directoryItem.type = 'button';
                    directoryItem.className = 'list-group-item list-group-item-action';
                    
                    // Add symlink indicator if applicable
                    const symlinkBadge = directory.isSymlink ? 
                        '<span class="badge bg-info ms-2">symlink</span>' : '';
                    
                    directoryItem.innerHTML = `
                        <i class="bi bi-folder2 me-2"></i>
                        ${directory.name}${symlinkBadge}
                    `;
                    
                    directoryItem.addEventListener('click', function() {
                        refreshDirectoryContents(directory.path);
                    });
                    
                    contentsContainer.appendChild(directoryItem);
                });
            }
            
            // Display zarr files
            if (zarrFiles.length > 0) {
                const zarrTitle = document.createElement('div');
                zarrTitle.className = 'list-group-item list-group-item-secondary';
                zarrTitle.innerHTML = '<i class="bi bi-database me-2"></i> Zarr Datasets';
                contentsContainer.appendChild(zarrTitle);
                
                zarrFiles.forEach(dataset => {
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
                                <i class="bi bi-database-fill me-2"></i>
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
            if (directories.length === 0 && zarrFiles.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'alert alert-info mt-3';
                emptyMessage.innerHTML = 'This directory is empty';
                contentsContainer.appendChild(emptyMessage);
            }
            
            // Add load button for zarr files
            if (zarrFiles.length > 0) {
                const loadButton = document.createElement('button');
                loadButton.type = 'button';
                loadButton.className = 'btn btn-primary mt-3 w-100';
                loadButton.innerHTML = '<i class="bi bi-download me-1"></i> Load Selected Dataset';
                loadButton.addEventListener('click', function() {
                    const selectedDataset = document.querySelector('#directoryContents .list-group-item.active[data-path]');
                    if (selectedDataset) {
                        const demoType = selectedDataset.dataset.demo;
                        const path = selectedDataset.dataset.path;
                        
                        console.log(`Loading dataset: ${path}`);
                        
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
        
    } catch (error) {
        console.error('Error in loadAvailableData:', error);
        
        // Display an error message in the demo container
        const demoContainer = document.querySelector('#datasetsList');
        if (demoContainer) {
            demoContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-circle me-2"></i>
                    Error loading datasets: ${error.message}
                </div>
                <button class="btn btn-primary mt-3" id="retryLoadBtn">
                    <i class="bi bi-arrow-repeat me-1"></i> Retry Loading Datasets
                </button>
                <button class="btn btn-outline-primary mt-3 ms-2" id="directLoadAgingBtn">
                    <i class="bi bi-database-fill me-1"></i> Load Aging Dataset Directly
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
 * Select a dataset from a specified path using stateless API approach
 * @param {string} datasetName - Name of the dataset (used for display only)
 * @param {string} path - Path to the data
 * @param {string|null} datasetId - Optional dataset ID to use (if null, one will be generated)
 * @returns {Promise<string>} The dataset ID of the selected dataset
 */
async function loadDataFromPath(datasetName, path = null, datasetId = null) {
    try {
        // Check if we have a path
        if (!path) {
            // Try to find the path from the selected dataset element
            const selectedDataset = document.querySelector(`#datasetsList .list-group-item[data-demo="${datasetName}"]`) || 
                                    document.querySelector(`#directoryContents .list-group-item.active[data-path]`);
            
            if (selectedDataset && selectedDataset.dataset.path) {
                path = selectedDataset.dataset.path;
            } else {
                throw new Error('No dataset path specified');
            }
        }
        
        console.log(`Selecting dataset from path: ${path}`);
        
        // Make sure API URL is set
        if (!window.ANNZARRO_API_URL) {
            await getApiConfig(); // Make sure API URL is configured
            if (!window.ANNZARRO_API_URL) {
                throw new Error('API URL is not configured. Please refresh the page and try again.');
            }
        }
        
        // Add token parameter if present in the URL and is valid (for auth)
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        // Only add token if it's alphanumeric (basic security validation)
        const pathWithParams = (token && /^[a-zA-Z0-9]+$/.test(token)) ? 
            `${path}?token=${token}` : path;
        
        // Generate dataset ID if not provided
        if (!datasetId) {
            datasetId = 'dataset_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        }
        
        // Create dataset metadata
        const metadata = {
            name: datasetName,
            description: `Dataset selected from ${path}`,
            path: path
        };
        
        // Show status in console
        console.log(`Selecting dataset via stateless API with ID: ${datasetId}...`);
        
        try {
            // Check if zarrLoader is available
            if (!zarrLoader) {
                throw new Error('ZarrLoader is not available. Please refresh the page and try again.');
            }
            
            // Get dataset info using stateless API call
            console.log('Calling zarrLoader.loadFromUrl with path:', pathWithParams, 'and dataset ID:', datasetId);
            const loadResult = await zarrLoader.loadFromUrl(pathWithParams, datasetId);
            
            if (!loadResult || loadResult.error) {
                throw new Error(loadResult?.error || 'Failed to get dataset info. Server returned an error.');
            }
            
            console.log('Initial dataset info retrieval successful, getting full AnnData structure...');
            
            // Enhance metadata with data from the server response
            Object.assign(metadata, {
                shape: loadResult.info.shape,
                n_obs: loadResult.info.n_obs,
                n_vars: loadResult.info.n_vars,
                embeddings: loadResult.info.embeddings || [],
                layers: loadResult.info.layers || {}
            });
            
            // Convert to AnnData via the loadAnndataFromZarr function with dataset ID
            const loadedDatasetId = await loadAnndataFromZarr(datasetId, metadata);
            
            // Return the dataset ID
            return loadedDatasetId;
        } catch (error) {
            console.error('Error accessing dataset via stateless API:', error);
            throw new Error(`Failed to select dataset: ${error.message}`);
        }
    } catch (error) {
        console.error('Error in loadDataFromPath:', error);
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
 * Load AnnData from zarr store with dataset ID using stateless approach
 * @param {string} datasetId - Client-side dataset ID to use
 * @param {Object} metadata - Optional metadata for the dataset
 * @returns {Promise<string>} The dataset ID that was loaded
 */
async function loadAnndataFromZarr(datasetId, metadata = {}) {
    try {
        if (!datasetId) {
            throw new Error('Dataset ID is required for stateless operation');
        }
        
        console.log('Starting to load AnnData from zarr with dataset ID:', datasetId);
        
        // Convert zarr to AnnData structure using stateless backend API
        const anndata = await zarrLoader.convertToAnnData(datasetId);
        console.log('AnnData structure received:', anndata);
        
        // Add client-provided metadata
        anndata.metadata = metadata;
        
        // Update data manager with the AnnData structure
        let loadedDatasetId = null;
        
        if (dataManager && typeof dataManager.setAnndata === 'function') {
            console.log('Setting AnnData in dataManager.setAnndata with dataset ID:', datasetId);
            loadedDatasetId = dataManager.setAnndata(anndata, datasetId, metadata);
            
            // Store the dataset path for future stateless requests
            if (dataManager.setDatasetPath && anndata.dataset_path) {
                dataManager.setDatasetPath(datasetId, anndata.dataset_path);
            }
        } else if (dataManager) {
            console.error('dataManager.setAnndata method not available, falling back to legacy approach');
            // Legacy approach - just set directly but track dataset ID for stateless operation
            dataManager.anndata = anndata;
            dataManager.currentDatasetId = datasetId;
            dataManager.currentDatasetPath = anndata.dataset_path;
        } else {
            console.error('dataManager not available, cannot set AnnData');
            throw new Error('dataManager not available');
        }
        
        // Dispatch dataLoaded event - Include dataset ID for newer components
        console.log('Dispatching dataLoaded event');
        const event = new CustomEvent('dataLoaded', {
            detail: { 
                source: 'zarr', 
                data: anndata,
                datasetId: loadedDatasetId || datasetId,
                metadata: metadata,
                datasetPath: anndata.dataset_path
            }
        });
        document.dispatchEvent(event);
        
        // Update the UI
        updateAfterDataLoad(loadedDatasetId || datasetId);
        
        return loadedDatasetId || datasetId;
    } catch (error) {
        console.error('Error loading AnnData from zarr:', error);
        throw error;
    }
}

/**
 * Update the UI after a dataset is selected
 * @param {string} datasetId - The ID of the selected dataset
 */
function updateAfterDataLoad(datasetId = null) {
    console.log('Updating UI after dataset selection');
    
    try {
        // Get the active dataset ID if not specified
        const dsId = datasetId || (dataManager ? dataManager.getActiveDatasetId() : null);
        
        // Update status indicator
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusIndicator) {
            console.log('Updating status indicator');
            // Get basic info from data manager if available
            let dataInfo = '';
            let datasetInfo = '';
            
            if (dataManager && dataManager.isDataLoaded(dsId)) {
                // Get dataset info if available
                const dsInfo = dsId ? dataManager.getDatasetInfo(dsId) : null;
                if (dsInfo) {
                    datasetInfo = dsInfo.name ? ` - ${dsInfo.name}` : '';
                }
                
                // Get basic info about the data
                let info = {};
                if (typeof dataManager.getBasicInfo === 'function') {
                    info = dataManager.getBasicInfo(dsId);
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
            
            // Create the status badges
            const loadedBadge = `<span class="badge bg-success">Dataset Selected${dataInfo}</span>`;
            const idBadge = dsId ? `<span class="badge bg-primary ms-1" title="Dataset ID">${dsId}</span>` : '';
            const nameBadge = datasetInfo ? `<span class="badge bg-secondary ms-1">${datasetInfo}</span>` : '';
            
            statusIndicator.innerHTML = loadedBadge + idBadge + nameBadge;
            
            // Add dataset dropdown if multiple datasets are loaded
            if (dataManager && dataManager.getLoadedDatasets().length > 1) {
                // Create a dataset switcher dropdown
                const dropdownHTML = createDatasetSwitcherDropdown();
                statusIndicator.innerHTML += dropdownHTML;
                
                // Add event listener after rendering
                setTimeout(() => {
                    document.getElementById('datasetSwitcher')?.addEventListener('change', function() {
                        const newDatasetId = this.value;
                        if (newDatasetId && dataManager) {
                            dataManager.setActiveDataset(newDatasetId);
                            // Update UI to reflect the dataset change
                            updateAfterDataLoad(newDatasetId);
                        }
                    });
                }, 0);
            }
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
                            title: 'Data Visualization',
                            datasetId: dsId // Associate panel with dataset ID
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
 * Create a dataset switcher dropdown HTML
 * @returns {string} HTML for dataset switcher dropdown
 */
function createDatasetSwitcherDropdown() {
    // Get datasets from dataManager
    const datasets = dataManager.getLoadedDatasets();
    const activeId = dataManager.getActiveDatasetId();
    
    if (datasets.length <= 1) {
        return '';
    }
    
    // Create the dropdown
    let html = `
        <div class="dataset-switcher ms-3 d-inline-block">
            <select id="datasetSwitcher" class="form-select form-select-sm">
                <option value="">Switch Dataset</option>
    `;
    
    // Add options for each dataset
    datasets.forEach(dataset => {
        const selected = dataset.id === activeId ? 'selected' : '';
        const datasetName = dataset.name || dataset.id;
        const cellCount = dataset.data?.nObs || '?';
        const geneCount = dataset.data?.nVars || '?';
        
        html += `<option value="${dataset.id}" ${selected}>${datasetName} (${cellCount}×${geneCount})</option>`;
    });
    
    html += `
            </select>
        </div>
    `;
    
    return html;
}

/**
 * Update gene selection options
 * @param {string} geneNameColumn - Optional column containing gene names
 * @param {string} datasetId - Optional dataset ID to update for
 */
function updateGeneOptions(geneNameColumn = null, datasetId = null) {
    const geneFocusSelect = document.getElementById('geneFocus');
    
    // Check if element exists
    if (!geneFocusSelect) {
        console.error('Gene focus select element not found');
        return;
    }
    
    // Use active dataset if not specified
    const dsId = datasetId || (dataManager ? dataManager.getActiveDatasetId() : null);
    
    // Clear existing options
    geneFocusSelect.innerHTML = '<option value="">None selected</option>';
    
    // Check if data is loaded
    if (!dataManager.isDataLoaded(dsId)) return;
    
    try {
        // First try the API endpoint which can use a specific column
        let url = `${window.ANNZARRO_API_URL}/data/genes`;
        
        // Add parameters
        url += '?';
        
        if (dsId) {
            url += `dataset_id=${encodeURIComponent(dsId)}&`;
        }
        
        if (geneNameColumn) {
            url += `column=${encodeURIComponent(geneNameColumn)}`;
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
                    
                    // Set the current focused gene if any
                    if (dataManager && dsId && dataManager.datasets.has(dsId)) {
                        const dataset = dataManager.datasets.get(dsId);
                        if (dataset.focusedGene) {
                            geneFocusSelect.value = dataset.focusedGene;
                            $(geneFocusSelect).trigger('change');
                        }
                    }
                    
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
            dataManager.loadVar(null, null, dsId)
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
                        
                        // Set the current focused gene if any
                        if (dataManager && dsId && dataManager.datasets.has(dsId)) {
                            const dataset = dataManager.datasets.get(dsId);
                            if (dataset.focusedGene) {
                                geneFocusSelect.value = dataset.focusedGene;
                                $(geneFocusSelect).trigger('change');
                            }
                        }
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
 * @param {string} datasetId - Optional dataset ID to update for
 */
function updateCellOptions(datasetId = null) {
    const cellFocusSelect = document.getElementById('cellFocus');
    
    // Check if element exists
    if (!cellFocusSelect) {
        console.error('Cell focus select element not found');
        return;
    }
    
    // Use active dataset if not specified
    const dsId = datasetId || (dataManager ? dataManager.getActiveDatasetId() : null);
    
    // Clear existing options
    cellFocusSelect.innerHTML = '<option value="">None selected</option>';
    
    // Check if data is loaded
    if (!dataManager.isDataLoaded(dsId)) return;
    
    // Get obs index
    try {
        // Try to load obs index
        dataManager.loadObs(null, null, dsId)
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
                    
                    // Set the current focused cell if any
                    if (dataManager && dsId && dataManager.datasets.has(dsId)) {
                        const dataset = dataManager.datasets.get(dsId);
                        if (dataset.focusedCell) {
                            cellFocusSelect.value = dataset.focusedCell;
                            $(cellFocusSelect).trigger('change');
                        }
                    }
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
                <i class="bi bi-check-circle me-2"></i> ${message}
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

/**
 * Show a warning message
 * @param {string} message - Warning message
 */
function showWarning(message) {
    // Create a toast notification
    const warningToast = document.createElement('div');
    warningToast.className = 'toast align-items-center text-dark bg-warning border-0';
    warningToast.setAttribute('role', 'alert');
    warningToast.setAttribute('aria-live', 'assertive');
    warningToast.setAttribute('aria-atomic', 'true');
    warningToast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi bi-exclamation-triangle me-2"></i> ${message}
            </div>
            <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
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
    toastContainer.appendChild(warningToast);
    
    // Initialize and show the toast
    const toast = new bootstrap.Toast(warningToast, {
        autohide: false  // Warning messages don't auto-hide
    });
    toast.show();
    
    // Remove the toast after it's hidden
    warningToast.addEventListener('hidden.bs.toast', function() {
        warningToast.remove();
    });
}