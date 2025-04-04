/**
 * File Browser Module
 * 
 * Provides a browser interface for navigating and selecting zarr datasets
 */

const FileBrowser = (function() {
    // Private variables
    let _currentDirectory = '';
    let _homeDirectory = '';
    let _modalElement = null;
    let _fileListElement = null;
    let _breadcrumbElement = null;
    let _loadButtonElement = null;
    let _selectedDatasetPath = null;
    
    /**
     * Initialize the file browser
     */
    function init() {
        _modalElement = document.getElementById('fileBrowserModal');
        _fileListElement = document.getElementById('fileList');
        _breadcrumbElement = document.getElementById('directoryBreadcrumb');
        _loadButtonElement = document.getElementById('loadSelectedDataset');
        
        if (!_modalElement || !_fileListElement || !_breadcrumbElement || !_loadButtonElement) {
            console.error('Required elements for file browser not found');
            return;
        }
        
        // Set up event listeners
        document.getElementById('goUpButton').addEventListener('click', goUpDirectory);
        document.getElementById('goHomeButton').addEventListener('click', goHomeDirectory);
        document.getElementById('refreshButton').addEventListener('click', refreshDirectory);
        _loadButtonElement.addEventListener('click', loadSelectedDataset);
        
        // Initialize the browser by getting the home directory
        fetchHomeDirectory();
        
        console.log('FileBrowser initialized');
    }
    
    /**
     * Open the file browser modal
     */
    function openBrowser() {
        // Ensure browser is initialized with current data
        refreshDirectory();
        
        // Show the modal
        const modal = bootstrap.Modal.getOrCreateInstance(_modalElement);
        modal.show();
    }
    
    /**
     * Fetch the home directory from the server
     */
    async function fetchHomeDirectory() {
        try {
            const response = await fetch('/api/v1/directories/home');
            if (!response.ok) {
                throw new Error(`Failed to get home directory: ${response.statusText}`);
            }
            
            const data = await response.json();
            _homeDirectory = data.directory;
            _currentDirectory = _homeDirectory;
            
            // Load the initial directory
            loadDirectory(_currentDirectory);
        } catch (error) {
            console.error('Error fetching home directory:', error);
            showError('Failed to determine home directory. Please check the server configuration.');
        }
    }
    
    /**
     * Go up one directory level
     */
    function goUpDirectory() {
        if (_currentDirectory === _homeDirectory) {
            // Already at home, can't go up
            return;
        }
        
        // Get parent directory
        const path = _currentDirectory.split('/');
        path.pop(); // Remove last element
        const parentDir = path.join('/');
        
        // Make sure we don't go above home
        if (parentDir && parentDir.startsWith(_homeDirectory)) {
            loadDirectory(parentDir);
        } else {
            loadDirectory(_homeDirectory);
        }
    }
    
    /**
     * Go to the home directory
     */
    function goHomeDirectory() {
        loadDirectory(_homeDirectory);
    }
    
    /**
     * Refresh the current directory
     */
    function refreshDirectory() {
        loadDirectory(_currentDirectory);
    }
    
    /**
     * Load a directory and display its contents
     * @param {string} path - Directory path
     */
    async function loadDirectory(path) {
        // Show loading state
        _fileListElement.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading directory contents...</p></div>';
        
        try {
            const response = await fetch(`/api/v1/directories/list?path=${encodeURIComponent(path)}`);
            if (!response.ok) {
                throw new Error(`Failed to load directory: ${response.statusText}`);
            }
            
            const data = await response.json();
            _currentDirectory = path;
            
            // Update UI
            updateBreadcrumb();
            displayDirectoryContents(data);
            
            // Reset selection
            _selectedDatasetPath = null;
            updateLoadButton();
        } catch (error) {
            console.error('Error loading directory:', error);
            
            _fileListElement.innerHTML = `
                <div class="alert alert-danger m-3">
                    <h5>Error Loading Directory</h5>
                    <p>${error.message}</p>
                    <button class="btn btn-outline-danger btn-sm" onclick="FileBrowser.refreshDirectory()">
                        <i class="bi bi-arrow-clockwise"></i> Retry
                    </button>
                </div>
            `;
        }
    }
    
    /**
     * Update the breadcrumb navigation
     */
    function updateBreadcrumb() {
        if (!_breadcrumbElement) return;
        
        const parts = _currentDirectory.split('/');
        let html = '';
        let currentPath = '';
        
        // Add home
        html += `
            <li class="breadcrumb-item">
                <a href="#" data-path="${_homeDirectory}">Home</a>
            </li>
        `;
        
        // Add each directory part
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) continue;
            
            currentPath += (currentPath ? '/' : '') + part;
            
            if (i === parts.length - 1) {
                // Last part is current directory
                html += `<li class="breadcrumb-item active">${part}</li>`;
            } else {
                html += `
                    <li class="breadcrumb-item">
                        <a href="#" data-path="${currentPath}">${part}</a>
                    </li>
                `;
            }
        }
        
        _breadcrumbElement.innerHTML = html;
        
        // Add click handlers
        const links = _breadcrumbElement.querySelectorAll('a[data-path]');
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const path = e.target.dataset.path;
                loadDirectory(path);
            });
        });
    }
    
    /**
     * Display directory contents
     * @param {Object} data - Directory contents
     */
    function displayDirectoryContents(data) {
        if (!_fileListElement) return;
        
        const { directories, zarr_stores } = data;
        
        if (directories.length === 0 && zarr_stores.length === 0) {
            _fileListElement.innerHTML = `
                <div class="alert alert-info m-3">
                    <h5>Empty Directory</h5>
                    <p>This directory does not contain any zarr datasets or subdirectories.</p>
                </div>
            `;
            return;
        }
        
        let html = '<div class="list-group">';
        
        // First show zarr stores at the top
        if (zarr_stores.length > 0) {
            html += '<h6 class="mt-2 mb-2">Zarr Datasets</h6>';
            
            for (const store of zarr_stores) {
                const isSelected = _selectedDatasetPath === store.path;
                const activeClass = isSelected ? 'active' : '';
                
                html += `
                    <a href="#" class="list-group-item list-group-item-action ${activeClass} dataset-item" 
                       data-path="${store.path}" data-type="zarr">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-database me-2"></i>
                                <span class="fw-semibold">${store.name}</span>
                                ${store.is_link ? '<span class="badge bg-info ms-2">link</span>' : ''}
                            </div>
                            <small class="text-muted">
                                ${store.cells} cells × ${store.genes} genes
                            </small>
                        </div>
                    </a>
                `;
            }
        }
        
        // Then show directories
        if (directories.length > 0) {
            html += '<h6 class="mt-3 mb-2">Directories</h6>';
            
            for (const dir of directories) {
                html += `
                    <a href="#" class="list-group-item list-group-item-action directory-item" 
                       data-path="${dir.path}" data-type="directory">
                        <i class="bi bi-folder me-2"></i> ${dir.name}
                        ${dir.is_link ? '<span class="badge bg-info ms-2">link</span>' : ''}
                    </a>
                `;
            }
        }
        
        html += '</div>';
        _fileListElement.innerHTML = html;
        
        // Add click handlers
        const directoryItems = _fileListElement.querySelectorAll('.directory-item');
        directoryItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const path = e.target.closest('.directory-item').dataset.path;
                loadDirectory(path);
            });
        });
        
        const datasetItems = _fileListElement.querySelectorAll('.dataset-item');
        datasetItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                selectDataset(e.target.closest('.dataset-item'));
            });
        });
    }
    
    /**
     * Select a dataset
     * @param {Element} element - Selected dataset element
     */
    function selectDataset(element) {
        // Clear previous selection
        const activeItems = _fileListElement.querySelectorAll('.dataset-item.active');
        activeItems.forEach(item => item.classList.remove('active'));
        
        // Set new selection
        element.classList.add('active');
        _selectedDatasetPath = element.dataset.path;
        
        updateLoadButton();
    }
    
    /**
     * Update the load button state
     */
    function updateLoadButton() {
        if (_loadButtonElement) {
            _loadButtonElement.disabled = !_selectedDatasetPath;
        }
    }
    
    /**
     * Load the selected dataset
     */
    function loadSelectedDataset() {
        if (!_selectedDatasetPath) return;
        
        // Close the modal
        const modal = bootstrap.Modal.getInstance(_modalElement);
        if (modal) {
            modal.hide();
        }
        
        // Trigger dataset load
        const loadEvent = new CustomEvent('datasetRequested', {
            detail: {
                datasetPath: _selectedDatasetPath
            }
        });
        document.dispatchEvent(loadEvent);
    }
    
    /**
     * Show an error message
     * @param {string} message - Error message
     */
    function showError(message) {
        if (!_fileListElement) return;
        
        _fileListElement.innerHTML = `
            <div class="alert alert-danger m-3">
                <h5>Error</h5>
                <p>${message}</p>
                <button class="btn btn-outline-danger btn-sm" onclick="FileBrowser.refreshDirectory()">
                    <i class="bi bi-arrow-clockwise"></i> Retry
                </button>
            </div>
        `;
    }
    
    // Public API
    return {
        init,
        openBrowser,
        refreshDirectory,
        goUpDirectory,
        goHomeDirectory
    };
})();

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    FileBrowser.init();
});

// Export as module and global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileBrowser;
} else {
    window.FileBrowser = FileBrowser;
}