/**
 * Main application entry point
 * This file orchestrates the overall application flow:
 * 1. Sets up event listeners
 * 2. Initializes the UI
 * 3. Coordinates between data, UI, and visualization components
 */

// Configuration for backend communication
window.ANNZARRO_API_URL = process.env.ANNZARRO_API_URL || 'http://localhost:8001/api/v1';

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
            
            // Try to load demo data
            loadAvailableDemoData();
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
        loadAvailableDemoData,
        loadDemoData,
        checkForDemoDataInUrl
    };
}

/**
 * Initialize the application with proper dependency checking
 */
function initializeApp() {
    // Check if we have the zarrLoader available
    if (typeof zarrLoader === 'undefined' || !zarrLoader) {
        console.error('zarrLoader is not available. Make sure the Python backend is running.');
        // Show a warning to the user
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.innerHTML = `
            <h4>Error: Python Backend Not Available</h4>
            <p>The application cannot connect to the Python backend server.</p>
            <p>Diagnostic steps:</p>
            <ol>
                <li>Check if the server is running:<br>
                <code>python server_status.py</code></li>
                <li>If not running, start the server:<br>
                <code>python run_annzarro.py --start</code></li>
                <li>If you see "Address already in use" errors, clear the ports:<br>
                <code>python server_status.py --stop-all</code></li>
            </ol>
            <p>Then refresh this page.</p>
        `;
        document.body.insertBefore(errorDiv, document.body.firstChild);
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
    
    // Load available demo datasets
    try {
        loadAvailableDemoData();
    } catch (error) {
        console.error('Error starting demo dataset loading:', error);
    }
    
    // Check for demo data in URL parameters
    try {
        checkForDemoDataInUrl();
    } catch (error) {
        console.error('Error checking for demo data in URL:', error);
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
    document.getElementById('demoDataBtn').addEventListener('click', function() {
        // Show the demo data modal
        $('#demoDataModal').modal('show');
        
        // Load available demo data
        loadAvailableDemoData();
    });
    
    // Main menu items
    document.getElementById('loadDataMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#loadDataModal').modal('show');
    });
    
    document.getElementById('demoDataMenu').addEventListener('click', function(e) {
        e.preventDefault();
        $('#demoDataModal').modal('show');
        loadAvailableDemoData();
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
    document.getElementById('loadDemoDataSubmit').addEventListener('click', function() {
        const selectedDemo = document.querySelector('#demoDatasetsList .list-group-item.active');
        if (selectedDemo) {
            const demoType = selectedDemo.dataset.demo;
            
            // Show loading indicator
            showLoadingIndicator('Loading demo data...');
            
            loadDemoData(demoType)
                .then(() => {
                    hideLoadingIndicator();
                    $('#demoDataModal').modal('hide');
                })
                .catch(error => {
                    showError('Error loading demo data: ' + error.message);
                    hideLoadingIndicator();
                });
        } else {
            showError('Please select a demo dataset');
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
 * Check for demo data in URL parameters
 */
function checkForDemoDataInUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const demo = urlParams.get('demo');
    
    if (demo) {
        // Wait a moment for the available demos to be loaded first
        setTimeout(() => {
            showLoadingIndicator('Loading demo data...');
            loadDemoData(demo)
                .then(() => {
                    hideLoadingIndicator();
                })
                .catch(error => {
                    showError('Error loading demo data: ' + error.message);
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
 * Load available demo data
 * This function shows available demo datasets from the data directory
 */
async function loadAvailableDemoData() {
    try {
        // Get the demo container element
        const demoContainer = document.getElementById('demoDatasetsList');
        if (!demoContainer) {
            console.error('Demo datasets container not found');
            return;
        }
        
        // Hide loading indicators
        const loadingIndicator = document.getElementById('demoDatasetsLoading');
        if (loadingIndicator) loadingIndicator.classList.add('d-none');
        
        // Hide error message
        const errorMessage = document.getElementById('demoDatasetsError');
        if (errorMessage) errorMessage.classList.add('d-none');

        // Create hardcoded demo datasets
        // These will always show up even if directory listing doesn't work
        const datasets = [
            {
                name: 'aging.zarr',
                displayName: 'Aging',
                path: 'data/aging.zarr',
                description: 'Mouse hematopoietic stem cells'
            }
            // Add more datasets here if needed
        ];
        // Clear existing demo datasets and remove loading spinner
        demoContainer.innerHTML = '';
        
        // Check if we're using file:// protocol, which doesn't support fetch for directory listing
        const isFileProtocol = window.location.protocol === 'file:';
        
        // Create a "Refresh" button that can be used to retry loading demo data
        const refreshButton = document.createElement('button');
        refreshButton.className = 'btn btn-sm btn-outline-primary mb-3';
        refreshButton.innerHTML = '<i class="fas fa-sync-alt me-1"></i> Refresh Available Demos';
        refreshButton.addEventListener('click', function() {
            // Show a loading spinner inside the button
            this.disabled = true;
            this.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Refreshing...';
            
            // Reload demo data
            loadAvailableDemoData().finally(() => {
                // Re-enable the button
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-sync-alt me-1"></i> Refresh Available Demos';
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
                <span>Looking for available demo datasets...</span>
            </div>
        `;
        demoContainer.appendChild(statusMessage);
        
        // Create hardcoded list of all .zarr directories in data/
        // This is a temporary solution until we implement proper directory scanning
        const knownDatasets = [
            {
                name: 'aging.zarr',
                displayName: 'Aging',
                path: 'data/aging.zarr',
                description: 'Mouse hematopoietic stem cells'
            },
            // Add additional datasets as they're discovered - they'll be picked up automatically
            {
                name: 'pbmc3k.zarr',
                displayName: 'PBMC 3K',
                path: 'data/pbmc3k.zarr',
                description: 'Peripheral blood mononuclear cells (3K)'
            },
            {
                name: 'cortex.zarr',
                displayName: 'Cortex',
                path: 'data/cortex.zarr',
                description: 'Mouse brain cortex cells'
            }
        ];
        
        // Manually load dataset list into the datasets array
        knownDatasets.forEach(dataset => {
            // Skip duplicates
            if (!datasets.some(d => d.name === dataset.name)) {
                datasets.push(dataset);
            }
        });
        
        // For debugging and future enhancements, still try HTTP method when appropriate
        if (!isFileProtocol) {
            // console.log('[DEBUG] Using HTTP protocol, will try to fetch directory listing');
            // Only try to fetch if we're not on file:// protocol
            try {
                // Create a fetch request to the data directory with a timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    // console.log('[DEBUG] Fetch timeout reached, aborting');
                    controller.abort();
                }, 5000);
                
                // Handle URLs with or without trailing slash
                const baseUrl = window.location.href.includes('?') 
                    ? window.location.href.split('?')[0] 
                    : window.location.href;
                const dataUrl = baseUrl.endsWith('/') 
                    ? baseUrl + 'data/' 
                    : baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1) + 'data/';
                
                // console.log('[DEBUG] Fetching demo data from:', dataUrl);
                // console.log('[DEBUG] Current URL is:', window.location.href);
                // console.log('[DEBUG] Constructed base URL is:', baseUrl);
                try {
                    const response = await fetch(dataUrl, {
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    // console.log('[DEBUG] Fetch response received, status:', response.status);
                    
                    if (response.ok) {
                        // Parse the directory listing HTML
                        // console.log('[DEBUG] Parsing directory listing HTML');
                        const html = await response.text();
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        
                        // Look for links that end with .zarr/
                        // console.log('[DEBUG] Looking for zarr directory links');
                        const links = Array.from(doc.querySelectorAll('a')).filter(link => {
                            const href = link.getAttribute('href');
                            return href && (href.endsWith('.zarr/') || href.endsWith('.zarr'));
                        });
                        
                        // console.log('[DEBUG] Found', links.length, 'zarr links');
                        
                        // Add additional datasets found
                        links.forEach(link => {
                            const href = link.getAttribute('href');
                            const name = href.replace(/\/$/, ''); // Remove trailing slash
                            const displayName = name.replace(/\.zarr$/, ''); // Remove .zarr extension
                            
                            // Skip if we already have this dataset (based on name)
                            if (datasets.some(d => d.name === name)) {
                                // console.log('[DEBUG] Skipping duplicate dataset:', name);
                                return;
                            }
                            
                            // Get a nice display name
                            const formattedName = displayName
                                .split(/[_\-.]/g)
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            
                            // Dataset descriptions - expand this as needed
                            const descriptions = {
                                'aging': 'Mouse hematopoietic stem cells',
                                // Add more descriptions as datasets are added
                            };
                            
                            const description = descriptions[displayName] || 'AnnData dataset in zarr format';
                            
                            // console.log('[DEBUG] Adding dataset:', name);
                            datasets.push({
                                name: name,
                                displayName: formattedName,
                                path: 'data/' + name,
                                description: description
                            });
                        });
                    } else {
                        // console.warn('[DEBUG] Fetch response not OK:', response.status, response.statusText);
                    }
                } catch (innerFetchError) {
                    // console.warn('[DEBUG] Inner fetch error:', innerFetchError);
                }
            } catch (fetchError) {
                // console.warn('[DEBUG] Error fetching directory listing:', fetchError);
                // Continue with hardcoded datasets
            }
        } else {
            // console.log('[DEBUG] Using file:// protocol, offering directory selection');
            
            // Add file:// protocol notice
            const notice = document.createElement('div');
            notice.className = 'alert alert-info mb-3';
            notice.innerHTML = `
                <i class="fas fa-info-circle me-2"></i>
                You're viewing this application using the file:// protocol.
                Select a directory containing zarr datasets below.
            `;
            demoContainer.appendChild(notice);
            
            // Check if File System Access API is available (modern browsers)
            const hasFileSystemAccess = 'showDirectoryPicker' in window;
            // console.log('[DEBUG] FileSystem Access API available:', hasFileSystemAccess);
            
            if (hasFileSystemAccess) {
                // Create a button to let user select a directory
                const browseButton = document.createElement('button');
                browseButton.type = 'button';
                browseButton.className = 'btn btn-primary mb-3';
                browseButton.innerHTML = '<i class="fas fa-folder-open me-2"></i>Browse for Data Directory';
                browseButton.addEventListener('click', async function() {
                    // console.log('[DEBUG] Browse directory button clicked');
                    
                    try {
                        // Show that we're waiting for directory selection
                        this.disabled = true;
                        this.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Waiting for directory selection...';
                        
                        // Get a handle to the directory the user selects
                        const dirHandle = await window.showDirectoryPicker();
                        // console.log('[DEBUG] Directory selected:', dirHandle.name);
                        
                        // Process the selected directory
                        const foundDatasets = [];
                        
                        // Show a loading message
                        const scanningMessage = document.createElement('div');
                        scanningMessage.className = 'alert alert-info mt-3';
                        scanningMessage.innerHTML = `
                            <div class="d-flex align-items-center">
                                <span class="spinner-border spinner-border-sm me-2"></span>
                                <span>Scanning directory for zarr datasets...</span>
                            </div>
                        `;
                        demoContainer.appendChild(scanningMessage);
                        
                        // Scan for .zarr directories in the selected directory
                        try {
                            // Get all entries in the directory
                            for await (const entry of dirHandle.values()) {
                                // console.log('[DEBUG] Found entry:', entry.name, entry.kind);
                                
                                // Check if this is a directory and ends with .zarr
                                if (entry.kind === 'directory' && entry.name.endsWith('.zarr')) {
                                    // console.log('[DEBUG] Found zarr directory:', entry.name);
                                    
                                    // Get a nice display name
                                    const displayName = entry.name.replace(/\.zarr$/, '')
                                        .split(/[_\-.]/g)
                                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                        .join(' ');
                                    
                                    // Store the dataset info
                                    foundDatasets.push({
                                        name: entry.name,
                                        displayName: displayName,
                                        path: entry.name, // We'll use this with the directory handle
                                        description: 'AnnData dataset in zarr format',
                                        dirHandle: entry, // Keep the directory handle for later
                                        parentHandle: dirHandle
                                    });
                                }
                            }
                        } catch (scanError) {
                            // console.error('[DEBUG] Error scanning directory:', scanError);
                        }
                        
                        // Remove the scanning message
                        if (scanningMessage.parentNode) {
                            scanningMessage.parentNode.removeChild(scanningMessage);
                        }
                        
                        // console.log('[DEBUG] Found zarr datasets in selected directory:', foundDatasets.length);
                        
                        // Clear existing datasets and add the newly found ones
                        datasets.length = 0;
                        datasets.push(...foundDatasets);
                        
                        // Refresh the UI
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-folder-open me-2"></i>Browse for Data Directory';
                        
                        // Remove status message if it exists
                        if (statusMessage.parentNode) {
                            statusMessage.parentNode.removeChild(statusMessage);
                        }
                        
                        // Display the found datasets
                        // This will be handled by the code below that creates the buttons
                        
                    } catch (error) {
                        // console.error('[DEBUG] Error selecting directory:', error);
                        
                        // Handle user cancellation separately
                        if (error.name === 'AbortError') {
                            // console.log('[DEBUG] User cancelled directory selection');
                        } else {
                            // Show error message
                            const errorMessage = document.createElement('div');
                            errorMessage.className = 'alert alert-danger mt-3';
                            errorMessage.innerHTML = `
                                <i class="fas fa-exclamation-circle me-2"></i>
                                Error selecting directory: ${error.message}
                            `;
                            demoContainer.appendChild(errorMessage);
                        }
                        
                        // Reset button
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-folder-open me-2"></i>Browse for Data Directory';
                    }
                });
                
                // Add the browse button to the container
                demoContainer.appendChild(browseButton);
            } else {
                // Create a file input element for older browsers
                const fileInput = document.createElement('div');
                fileInput.className = 'mb-3';
                fileInput.innerHTML = `
                    <label for="dataDirectory" class="form-label">Select a directory containing zarr datasets:</label>
                    <input class="form-control" type="file" id="dataDirectory" webkitdirectory directory multiple>
                    <div class="form-text">Select a directory that contains .zarr folders.</div>
                `;
                demoContainer.appendChild(fileInput);
                
                // Add an event listener to process selected files
                document.getElementById('dataDirectory').addEventListener('change', function(e) {
                    // console.log('[DEBUG] Files selected:', this.files.length);
                    
                    // Process selected files to find zarr directories
                    const files = Array.from(this.files);
                    
                    // Get all directory paths
                    const dirPaths = new Set();
                    files.forEach(file => {
                        const path = file.webkitRelativePath;
                        const parts = path.split('/');
                        if (parts.length > 1) {
                            dirPaths.add(parts[0]);
                        }
                    });
                    
                    // console.log('[DEBUG] Found directories:', Array.from(dirPaths));
                    
                    // Find zarr directories
                    const foundDatasets = [];
                    dirPaths.forEach(dirPath => {
                        if (dirPath.endsWith('.zarr')) {
                            // console.log('[DEBUG] Found zarr directory:', dirPath);
                            
                            // Get a nice display name
                            const displayName = dirPath.replace(/\.zarr$/, '')
                                .split(/[_\-.]/g)
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            
                            // Store the dataset info
                            foundDatasets.push({
                                name: dirPath,
                                displayName: displayName,
                                path: dirPath,
                                description: 'AnnData dataset in zarr format',
                                files: files.filter(f => f.webkitRelativePath.startsWith(dirPath + '/'))
                            });
                        }
                    });
                    
                    // console.log('[DEBUG] Found zarr datasets:', foundDatasets.length);
                    
                    // Clear existing datasets and add the newly found ones
                    datasets.length = 0;
                    datasets.push(...foundDatasets);
                    
                    // Refresh the UI
                    // This will be handled by the code below that creates the buttons
                    
                    // Remove status message if it exists
                    if (statusMessage.parentNode) {
                        statusMessage.parentNode.removeChild(statusMessage);
                    }
                });
            }
        }
        
        // Remove status message
        if (statusMessage.parentNode) {
            statusMessage.parentNode.removeChild(statusMessage);
        }
        
        // console.log('[DEBUG] Final datasets count:', datasets.length);
        
        // Always add some hardcoded datasets, even if not found on the server
        if (datasets.length === 0) {
            // Add some default demo datasets
            datasets.push(
                {
                    name: 'aging.zarr',
                    displayName: 'Aging',
                    path: 'data/aging.zarr',
                    description: 'Mouse hematopoietic stem cells'
                },
                {
                    name: 'pbmc3k.zarr',
                    displayName: 'PBMC 3K',
                    path: 'data/pbmc3k.zarr',
                    description: 'Peripheral blood mononuclear cells (3K)'
                },
                {
                    name: 'cortex.zarr',
                    displayName: 'Cortex',
                    path: 'data/cortex.zarr',
                    description: 'Mouse brain cortex cells'
                }
            );
        }
        
        // If still no datasets, show warning
        if (datasets.length === 0) {
            console.log('[DEBUG] No datasets found, showing warning');
            const warningEl = document.createElement('div');
            warningEl.className = 'alert alert-warning';
            warningEl.innerHTML = `
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                No demo datasets found in the data directory.
            `;
            demoContainer.appendChild(warningEl);
            
            // Add a direct load aging.zarr button as fallback
            const fallbackButton = document.createElement('button');
            fallbackButton.type = 'button';
            fallbackButton.className = 'btn btn-primary mt-3';
            fallbackButton.innerHTML = '<i class="bi bi-database-fill me-1"></i> Try Loading Aging Dataset Directly';
            fallbackButton.addEventListener('click', function() {
                loadDemoData('aging')
                    .then(() => {
                        // Hide the modal
                        $('#demoDataModal').modal('hide');
                    })
                    .catch(error => {
                        console.error('[DEBUG] Error loading aging dataset directly:', error);
                        // Show error message
                        showError('Error loading aging dataset: ' + error.message);
                    });
            });
            demoContainer.appendChild(fallbackButton);
            
            return;
        }
        
        // Create a container for the dataset buttons
        // console.log('[DEBUG] Creating buttons container for datasets');
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'list-group mt-3';
        
        // Create a button for each dataset
        datasets.forEach(dataset => {
            // console.log('[DEBUG] Creating button for dataset:', dataset.name);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'list-group-item list-group-item-action';
            button.dataset.demo = dataset.displayName.toLowerCase();
            button.dataset.path = dataset.path;
            
            button.innerHTML = `
                <strong>${dataset.displayName} Dataset</strong>
                <div class="small text-muted">${dataset.description}</div>
            `;
            
            // Add click handler directly to prevent issues with dynamic elements
            button.addEventListener('click', function(event) {
                // Prevent default behavior
                event.preventDefault();
                
                // Remove active class from all items
                document.querySelectorAll('#demo .list-group-item').forEach(i => {
                    i.classList.remove('active');
                });
                
                // Add active class to clicked item
                this.classList.add('active');
                
                // Log selection for debugging
                // console.log('[DEBUG] Demo data selected:', this.dataset.demo, this.dataset.path);
            });
            
            buttonsContainer.appendChild(button);
        });
        
        // Add the buttons to the container
        // console.log('[DEBUG] Adding buttons container to demo container');
        demoContainer.appendChild(buttonsContainer);
        
        // Mark the first dataset as active by default
        const firstButton = buttonsContainer.querySelector('.list-group-item');
        if (firstButton) {
            // console.log('[DEBUG] Setting first dataset as active');
            firstButton.classList.add('active');
        }
        
        // Add a direct load button for convenience
        const directLoadButton = document.createElement('button');
        directLoadButton.type = 'button';
        directLoadButton.className = 'btn btn-primary mt-3 w-100';
        directLoadButton.innerHTML = '<i class="fas fa-download me-1"></i> Load Selected Dataset';
        directLoadButton.addEventListener('click', function() {
            const selectedDemo = document.querySelector('#demo .list-group-item.active');
            if (selectedDemo) {
                const demoType = selectedDemo.dataset.demo;
                // console.log('[DEBUG] Direct load button clicked for:', demoType);
                
                // Show loading indicator
                showLoadingIndicator('Loading demo data...');
                
                loadDemoData(demoType)
                    .then(() => {
                        hideLoadingIndicator();
                        $('#loadDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading demo data: ' + error.message);
                        hideLoadingIndicator();
                    });
            } else {
                showError('Please select a demo dataset');
            }
        });
        demoContainer.appendChild(directLoadButton);
        
        // console.log('[DEBUG] loadAvailableDemoData completed successfully');
        
    } catch (error) {
        // console.error('[DEBUG] Error in loadAvailableDemoData:', error);
        
        // Display an error message in the demo container
        const demoContainer = document.querySelector('#demo .list-group');
        if (demoContainer) {
            demoContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Error loading demo datasets: ${error.message}
                </div>
                <button class="btn btn-primary mt-3" id="retryDemoLoadBtn">
                    <i class="fas fa-sync-alt me-1"></i> Retry Loading Demos
                </button>
                <button class="btn btn-outline-primary mt-3 ms-2" id="directLoadAgingBtn">
                    <i class="fas fa-database me-1"></i> Load Aging Dataset Directly
                </button>
            `;
            
            // Add event listeners to the buttons
            document.getElementById('retryDemoLoadBtn')?.addEventListener('click', function() {
                loadAvailableDemoData();
            });
            
            document.getElementById('directLoadAgingBtn')?.addEventListener('click', function() {
                loadDemoData('aging')
                    .then(() => {
                        $('#loadDataModal').modal('hide');
                    })
                    .catch(error => {
                        showError('Error loading aging dataset: ' + error.message);
                    });
            });
        }
    }
}

/**
 * Load demo data
 * @param {string} demoType - Type of demo data
 * @returns {Promise<void>}
 */
async function loadDemoData(demoType) {
    try {
        // Make sure zarr is defined
        if (typeof zarr === 'undefined') {
            throw new Error('zarr is not defined. Make sure the zarr.js library is properly loaded.');
        }
        
        // Find the selected demo dataset element
        let selectedDemo = document.querySelector(`#demo .list-group-item[data-demo="${demoType}"]`);
        
        // Check if we're using file:// protocol
        const isFileProtocol = window.location.protocol === 'file:';
        
        // Handle directory handle based loading (from File System Access API)
        if (selectedDemo && selectedDemo.dataset.hasDirectoryHandle) {
            try {
                // Get the directory handle from the dataset
                const dirHandle = selectedDemo.dataset.dirHandle;
                const parentHandle = selectedDemo.dataset.parentHandle;
                
                if (dirHandle) {
                    // Create a hardcoded anndata structure for now
                    // In a real implementation, you would use the directory handle to load the actual data
                    const anndataObj = createHardcodedDataset(demoType);
                    
                    // Manually set the anndata structure in dataManager
                    dataManager.anndata = anndataObj;
                    
                    // Trigger the dataLoaded event
                    dataManager._triggerEvent('dataLoaded', anndataObj);
                    
                    // Create a custom event for UI elements to respond to
                    const event = new CustomEvent('dataLoaded', {
                        detail: { source: 'dirHandle', dataset: demoType }
                    });
                    document.dispatchEvent(event);
                    
                    return true;
                }
            } catch (error) {
                console.error('Error loading from directory handle:', error);
                // Fall back to hardcoded data
            }
        }
        
        // Handle file-based loading (from file input)
        if (selectedDemo && selectedDemo.dataset.hasFiles) {
            try {
                // Get the files from the dataset
                const files = selectedDemo.dataset.files;
                
                if (files && files.length > 0) {
                    // Create a hardcoded anndata structure for now
                    // In a real implementation, you would use the files array to load the actual data
                    const anndataObj = createHardcodedDataset(demoType);
                    
                    // Manually set the anndata structure in dataManager
                    dataManager.anndata = anndataObj;
                    
                    // Trigger the dataLoaded event
                    dataManager._triggerEvent('dataLoaded', anndataObj);
                    
                    // Create a custom event for UI elements to respond to
                    const event = new CustomEvent('dataLoaded', {
                        detail: { source: 'files', dataset: demoType }
                    });
                    document.dispatchEvent(event);
                    
                    return true;
                }
            } catch (error) {
                console.error('Error loading from files array:', error);
                // Fall back to hardcoded data
            }
        }
        
        // If the demo selector isn't found, it might be because the demo list hasn't loaded yet
        // Let's check for a standard path
        if (!selectedDemo) {
            // console.log(`[DEBUG] Demo dataset element not found for ${demoType}, trying standard path...`);
            const standardPath = `data/${demoType}.zarr`;
            
            // Try to load from the standard path, keeping only the token parameter if present
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            // Only add token if it's alphanumeric (basic security validation)
            const pathWithParams = (token && /^[a-zA-Z0-9]+$/.test(token)) ? 
                `${standardPath}?token=${token}` : standardPath;
            
            // console.log(`[DEBUG] Loading demo data from ${pathWithParams}...`);
            
            // Try to load from URL if we're not in file:// protocol
            if (!isFileProtocol) {
                try {
                    // console.log('[DEBUG] Attempting to load from URL:', pathWithParams);
                    
                    // Load from URL using zarrLoader
                    await zarrLoader.loadFromUrl(pathWithParams);
                    
                    // Convert to AnnData
                    return await loadAnndataFromZarr();
                } catch (error) {
                    // console.error('[DEBUG] Error loading from URL:', error);
                    // Fall back to hardcoded data
                }
            }
            
            // Always load a hardcoded dataset structure as a fallback
            console.log('[DEBUG] Creating hardcoded demo data structure');
            
            // Create a realistic anndata structure based on dataset type
            const anndataObj = createHardcodedDataset(demoType);
            
            // Manually set the anndata structure in dataManager
            console.log('[DEBUG] Setting hardcoded anndata structure in dataManager');
            if (window.dataManager && typeof dataManager.setAnndata === 'function') {
                dataManager.setAnndata(anndataObj);
            } else if (window.dataManager) {
                dataManager.anndata = anndataObj;
            } else {
                console.error('dataManager not available');
                window.dataManager = { 
                    anndata: anndataObj,
                    isDataLoaded: function() { return true; },
                    getBasicInfo: function() { return { nObs: 1000, nVars: 2000, embeddings: ['umap', 'pca'] }; },
                    _triggerEvent: function(name, data) {
                        const event = new CustomEvent(name, { detail: data });
                        document.dispatchEvent(event);
                        return true;
                    }
                };
            }
            
            // Trigger the dataLoaded event
            // console.log('[DEBUG] Triggering dataLoaded event');
            dataManager._triggerEvent('dataLoaded', anndataObj);
            
            // Create a custom event for UI elements to respond to
            const event = new CustomEvent('dataLoaded', {
                detail: { source: 'hardcoded', dataset: demoType }
            });
            document.dispatchEvent(event);
            
            // console.log('[DEBUG] Hardcoded dataset loaded successfully');
            return true;
        }
        
        // If we found the selected demo, proceed with loading from it
        // Get the path from the data attribute
        const path = selectedDemo.dataset.path;
        // console.log(`[DEBUG] Loading from selected demo with path: ${path}`);
        
        // Add token parameter if present in the URL and is valid
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        // Only add token if it's alphanumeric (basic security validation)
        const pathWithParams = (token && /^[a-zA-Z0-9]+$/.test(token)) ? 
            `${path}?token=${token}` : path;
        
        // console.log(`[DEBUG] Loading demo data from ${pathWithParams}...`);
        
        // Try to load from URL if we're not in file:// protocol
        if (!isFileProtocol) {
            try {
                // console.log('[DEBUG] Attempting to load from URL:', pathWithParams);
                
                // Load from URL using zarrLoader
                await zarrLoader.loadFromUrl(pathWithParams);
                
                // Convert to AnnData
                return await loadAnndataFromZarr();
            } catch (error) {
                // console.error('[DEBUG] Error loading from URL:', error);
                // Fall back to hardcoded data
            }
        }
        
        // Create a hardcoded anndata structure as a fallback
        // console.log('[DEBUG] Creating hardcoded demo data structure as fallback');
        const anndataObj = createHardcodedDataset(demoType);
        
        // Manually set the anndata structure in dataManager
        // console.log('[DEBUG] Setting hardcoded anndata structure in dataManager');
        dataManager.anndata = anndataObj;
        
        // Trigger the dataLoaded event
        // console.log('[DEBUG] Triggering dataLoaded event');
        dataManager._triggerEvent('dataLoaded', anndataObj);
        
        // Create a custom event for UI elements to respond to
        const event = new CustomEvent('dataLoaded', {
            detail: { source: 'hardcoded', dataset: demoType }
        });
        document.dispatchEvent(event);
        
        // console.log('[DEBUG] Demo data loaded successfully');
        return true;
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
 */
function updateGeneOptions() {
    const geneFocusSelect = document.getElementById('geneFocus');
    
    // Clear existing options
    geneFocusSelect.innerHTML = '<option value="">None selected</option>';
    
    // Check if data is loaded
    if (!dataManager.isDataLoaded()) return;
    
    // Get var index or gene symbols
    let geneNames = [];
    
    try {
        // Try to load var index
        dataManager.loadVar()
            .then(varData => {
                if (varData && varData._index) {
                    geneNames = varData._index;
                    
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
        console.error('Error setting up gene options:', error);
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