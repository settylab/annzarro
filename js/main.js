/**
 * Main application entry point
 * This file orchestrates the overall application flow:
 * 1. Sets up event listeners
 * 2. Initializes the UI
 * 3. Coordinates between data, UI, and visualization components
 */

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the UI manager
    uiManager.initialize('vizContainer');
    
    // Set up event listeners
    setupEventListeners();
    
    // Check for demo data in URL parameters
    checkForDemoDataInUrl();
});

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
    
    // Demo data selection
    document.querySelectorAll('#demo .list-group-item').forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all items
            document.querySelectorAll('#demo .list-group-item').forEach(i => {
                i.classList.remove('active');
            });
            
            // Add active class to clicked item
            this.classList.add('active');
        });
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
        showLoadingIndicator('Loading demo data...');
        loadDemoData(demo)
            .then(() => {
                hideLoadingIndicator();
            })
            .catch(error => {
                showError('Error loading demo data: ' + error.message);
                hideLoadingIndicator();
            });
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
        
        // Map of demo types to URLs
        const demoUrls = {
            'aging': 'data/aging.zarr'
        };
        
        const url = demoUrls[demoType];
        if (!url) {
            throw new Error(`Unknown demo type: ${demoType}`);
        }
        
        console.log(`Loading demo data from ${url}...`);
        
        // Load the zarr store
        await zarrLoader.loadFromUrl(url);
        
        // Convert to AnnData
        return await loadAnndataFromZarr();
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