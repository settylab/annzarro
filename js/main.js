/**
 * Main application entry point
 * This file orchestrates the overall application flow:
 * 1. Sets up event listeners
 * 2. Initializes the UI
 * 3. Coordinates between data, UI, and visualization components
 */

// Wait for all modules to be loaded and initialized
document.addEventListener('modulesLoaded', function() {
    console.log('Modules loaded event received, initializing application');
    initializeApp();
});

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
    // Check if zarr is defined and retry if needed
    if (typeof zarr === 'undefined') {
        console.warn('zarr library is not loaded yet, waiting...');
        // Try again after a delay
        setTimeout(initializeApp, 500);
        return;
    }
    
    console.log('zarr library is loaded and available');
    
    // Initialize the UI manager
    if (typeof uiManager === 'object' && typeof uiManager.initialize === 'function') {
        uiManager.initialize('vizContainer');
    } else {
        console.error('UI Manager not properly initialized');
        return;
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Load available demo datasets
    loadAvailableDemoData();
    
    // Check for demo data in URL parameters
    checkForDemoDataInUrl();
    
    console.log('Application initialized successfully');
    
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
    // Load data button
    document.getElementById('loadZarrBtn').addEventListener('click', function() {
        // Get the selected tab
        const activeTab = document.querySelector('#loadDataTabs .nav-link.active');
        const tabId = activeTab.getAttribute('data-bs-target').substring(1);
        
        // Show loading indicator
        showLoadingIndicator('Loading zarr data...');
        
        // Handle based on the tab
        if (tabId === 'local') {
            const fileInput = document.getElementById('localZarrFile');
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
        } else if (tabId === 'url') {
            const url = document.getElementById('zarrUrl').value.trim();
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
        } else if (tabId === 's3') {
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
        } else if (tabId === 'demo') {
            const selectedDemo = document.querySelector('#demo .list-group-item.active');
            if (selectedDemo) {
                const demoType = selectedDemo.dataset.demo;
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
                hideLoadingIndicator();
            }
        }
    });
    
    // Demo data selection - use event delegation instead of direct binding
    // This ensures even dynamically added elements will have the event handler
    document.getElementById('demo').addEventListener('click', function(event) {
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
            document.querySelectorAll('#demo .list-group-item').forEach(i => {
                i.classList.remove('active');
            });
            
            // Add active class to clicked item
            targetItem.classList.add('active');
            
            // Log selection for debugging
            console.log('Demo data selected:', targetItem.dataset.demo, targetItem.dataset.path);
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
        // Update gene and cell select options
        updateGeneOptions();
        updateCellOptions();
        
        // Create a default plot in the first panel
        const firstPanel = document.getElementById('panel-1');
        if (firstPanel) {
            uiManager.createPanel('panel-1', 'plot', {
                plotType: 'scatter',
                title: 'UMAP Visualization'
            });
        }
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
        const demoContainer = document.querySelector('#demo .list-group');
        if (!demoContainer) {
            console.warn('Demo container not found');
            return;
        }

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
        
        if (!isFileProtocol) {
            // Only try to fetch if we're not on file:// protocol
            try {
                // Create a fetch request to the data directory with a timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                // Handle URLs with or without trailing slash
                const baseUrl = window.location.href.includes('?') 
                    ? window.location.href.split('?')[0] 
                    : window.location.href;
                const dataUrl = baseUrl.endsWith('/') 
                    ? baseUrl + 'data/' 
                    : baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1) + 'data/';
                
                console.log('Fetching demo data from:', dataUrl);
                const response = await fetch(dataUrl, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    // Parse the directory listing HTML
                    const html = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    
                    // Look for links that end with .zarr/
                    const links = Array.from(doc.querySelectorAll('a')).filter(link => {
                        const href = link.getAttribute('href');
                        return href && (href.endsWith('.zarr/') || href.endsWith('.zarr'));
                    });
                    
                    // Add additional datasets found
                    links.forEach(link => {
                        const href = link.getAttribute('href');
                        const name = href.replace(/\/$/, ''); // Remove trailing slash
                        const displayName = name.replace(/\.zarr$/, ''); // Remove .zarr extension
                        
                        // Skip if we already have this dataset (based on name)
                        if (datasets.some(d => d.name === name)) {
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
                        
                        datasets.push({
                            name: name,
                            displayName: formattedName,
                            path: 'data/' + name,
                            description: description
                        });
                    });
                }
            } catch (fetchError) {
                console.warn('Error fetching directory listing:', fetchError);
                // Continue with hardcoded datasets
            }
        } else {
            // Add file:// protocol notice
            const notice = document.createElement('div');
            notice.className = 'alert alert-info mb-3';
            notice.innerHTML = `
                <i class="fas fa-info-circle me-2"></i>
                You're viewing this file locally. Only hardcoded demo datasets are shown.
                For auto-discovery of datasets, please use a web server.
            `;
            demoContainer.appendChild(notice);
        }
        
        // Display either the datasets or a warning
        if (datasets.length === 0) {
            demoContainer.innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    No demo datasets found in the data directory.
                </div>
            `;
            return;
        }
        
        // Create a container for the dataset buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'list-group mt-3';
        
        // Create a button for each dataset
        datasets.forEach(dataset => {
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
                console.log('Demo data selected:', this.dataset.demo, this.dataset.path);
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
        
    } catch (error) {
        console.error('Error loading available demo data:', error);
        
        // Display an error message in the demo container
        const demoContainer = document.querySelector('#demo .list-group');
        if (demoContainer) {
            demoContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Error loading demo datasets: ${error.message}
                </div>
            `;
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
        
        // If the demo selector isn't found, it might be because the demo list hasn't loaded yet
        // Let's check for a standard path
        if (!selectedDemo) {
            console.log(`Demo dataset element not found for ${demoType}, trying standard path...`);
            const standardPath = `data/${demoType}.zarr`;
            
            // Try to load from the standard path, keeping any URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            const pathWithParams = token ? `${standardPath}?token=${token}` : standardPath;
            
            console.log(`Loading demo data from ${pathWithParams}...`);
            
            // Check if we're using file:// protocol
            const isFileProtocol = window.location.protocol === 'file:';
            
            try {
                if (isFileProtocol) {
                    // When using file:// protocol, trying to load a zarr directory directly
                    // will often fail because the browser security model. We'll need to preload the
                    // data structure from known paths.
                    console.log('Using file:// protocol, loading hardcoded demo data structure');
                    
                    // Create a dummy anndata structure
                    const anndataObj = {
                        shape: [1000, 2000], // Example dimensions
                        X: {
                            shape: [1000, 2000],
                            dtype: 'float32',
                            path: 'X'
                        },
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
                    
                    // Manually set the anndata structure in dataManager
                    dataManager.anndata = anndataObj;
                    
                    // Trigger the dataLoaded event
                    dataManager._triggerEvent('dataLoaded', anndataObj);
                    
                    // Create a custom event for UI elements to respond to
                    const event = new CustomEvent('dataLoaded', {
                        detail: { source: 'hardcoded', dataset: demoType }
                    });
                    document.dispatchEvent(event);
                    
                    return true;
                } else {
                    // For HTTP protocol, we can use the normal loader
                    await zarrLoader.loadFromUrl(pathWithParams);
                    
                    // Convert to AnnData
                    return await loadAnndataFromZarr();
                }
            } catch (loadError) {
                console.error('Error loading data:', loadError);
                
                // If the URL method fails, fall back to hardcoded data structure
                // This is useful for file:// protocol which can't properly fetch zarr directory listing
                console.warn('Falling back to hardcoded data structure');
                
                // Create a dummy anndata structure
                const anndataObj = {
                    shape: [1000, 2000], // Example dimensions
                    X: {
                        shape: [1000, 2000],
                        dtype: 'float32',
                        path: 'X'
                    },
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
                
                // Manually set the anndata structure in dataManager
                dataManager.anndata = anndataObj;
                
                // Trigger the dataLoaded event
                dataManager._triggerEvent('dataLoaded', anndataObj);
                
                // Create a custom event for UI elements to respond to
                const event = new CustomEvent('dataLoaded', {
                    detail: { source: 'hardcoded', dataset: demoType }
                });
                document.dispatchEvent(event);
                
                return true;
            }
        }
        
        // If we found the selected demo, proceed with loading from it
        // Get the path from the data attribute
        const path = selectedDemo.dataset.path;
        
        // Add token parameter if present in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const pathWithParams = token ? `${path}?token=${token}` : path;
        
        console.log(`Loading demo data from ${pathWithParams}...`);
        
        // Check if we're using file:// protocol
        const isFileProtocol = window.location.protocol === 'file:';
        
        try {
            if (isFileProtocol) {
                // When using file:// protocol, fallback to hardcoded structure
                console.log('Using file:// protocol, loading hardcoded demo data structure');
                
                // Create a dummy anndata structure
                const anndataObj = {
                    shape: [1000, 2000], // Example dimensions
                    X: {
                        shape: [1000, 2000],
                        dtype: 'float32',
                        path: 'X'
                    },
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
                
                // Manually set the anndata structure in dataManager
                dataManager.anndata = anndataObj;
                
                // Trigger the dataLoaded event
                dataManager._triggerEvent('dataLoaded', anndataObj);
                
                // Create a custom event for UI elements to respond to
                const event = new CustomEvent('dataLoaded', {
                    detail: { source: 'hardcoded', dataset: demoType }
                });
                document.dispatchEvent(event);
                
                return true;
            } else {
                // For HTTP protocol, we can use the normal loader
                await zarrLoader.loadFromUrl(pathWithParams);
                
                // Convert to AnnData
                return await loadAnndataFromZarr();
            }
        } catch (error) {
            console.error('Error in primary loading method:', error);
            
            // Fallback to a hardcoded dummy structure
            console.warn('Falling back to hardcoded demo data structure');
            
            // Create a dummy anndata structure
            const anndataObj = {
                shape: [1000, 2000], // Example dimensions
                X: {
                    shape: [1000, 2000],
                    dtype: 'float32',
                    path: 'X'
                },
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
            
            // Manually set the anndata structure in dataManager
            dataManager.anndata = anndataObj;
            
            // Trigger the dataLoaded event
            dataManager._triggerEvent('dataLoaded', anndataObj);
            
            // Create a custom event for UI elements to respond to
            const event = new CustomEvent('dataLoaded', {
                detail: { source: 'hardcoded', dataset: demoType }
            });
            document.dispatchEvent(event);
            
            return true;
        }
    } catch (error) {
        console.error('Error loading demo data:', error);
        throw error;
    }
}


/**
 * Load AnnData from zarr store
 * @returns {Promise<void>}
 */
async function loadAnndataFromZarr() {
    try {
        // Load AnnData from zarr store
        await dataManager.loadFromZarr(zarrLoader);
        
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
    // This function updates various UI elements after data is loaded
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