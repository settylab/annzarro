  /**
   * Create a selection tile at the bottom of the main container
   * @param {boolean} [showSessions=true] - Show sessions section
   * @returns {Function} - Function to update the source panel grid
   * @private
   */
  function createSelectionTile(showSessions = true) {
    // Assign a unique ID for the selection tile
    const selectionTileId = 'base-selection-' + Date.now();
    
    // Create a tile selector element
    const tileSelector = document.createElement('div');
    tileSelector.className = 'tile-selector';
    tileSelector.dataset.tileId = selectionTileId;
    tileSelector.dataset.isSelectionTile = 'true';
    // Mark this selector so we know not to add a close button
    tileSelector.dataset.isBottomSelector = 'true';
    
    // Create the new streamlined selection container with explicit IDs to avoid selection issues
    const selectionId = Date.now(); // Use timestamp to ensure unique IDs
    tileSelector.innerHTML = `
        <div class="tile-selection-container">
            <div class="tile-selection-header">
                <h2>Welcome to AnnZarro</h2>
                <p>Get started by choosing a panel type</p>
                <button class="tile-close-btn" id="close-selection-${selectionId}" title="Close">×</button>
            </div>
            
            <div class="selection-sections">
                <!-- Panel Types Section -->
                <div class="selection-section">
                    <h3>Create New Panel</h3>
                    <div class="tile-selection-grid" id="panel-type-grid-${selectionId}"></div>
                </div>
                
                <!-- Clone from Source Section - Only shown when not the first tile -->
                <div class="selection-section" id="clone-panel-section-${selectionId}" style="display: none;">
                    <h3>Clone Existing Panel</h3>
                    <div class="source-selection-grid" id="source-panel-grid-${selectionId}"></div>
                </div>
                
                <!-- Sessions Section - Only shown on first tile/welcome screen -->
                ${showSessions ? `
                <div class="selection-section" id="selection-section-${selectionId}">
                    <h3>Load Saved Panel Set</h3>
                    <div class="sessions-list" id="sessions-list-${selectionId}"></div>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    function hideHeader() {
        const header = tileSelector.querySelector('.tile-selection-header');
        if (header) {
            header.style.display = 'none';
        }
    }
    
    // Add the selector to the container
    _container.appendChild(tileSelector);
    
    // Define panel types
    const panelTypes = [
        { type: 'cell-plot', label: 'Cell Plot', icon: 'fas fa-microscope' },
        { type: 'gene-plot', label: 'Gene Plot', icon: 'fas fa-dna' },
        { type: 'cell-table', label: 'Cell Table', icon: 'fas fa-solid fa-list-ul' },
        { type: 'gene-table', label: 'Gene Table', icon: 'fas fa-th-list' },
        { type: 'gene-set', label: 'Gene Set Analysis', icon: 'fas fa-project-diagram' }
    ];
    
    // Helper function to populate source panels grid
    function populateSourcePanelGrid(grid) {
        // Safety check for grid element
        if (!grid) {
            console.error('Source panel grid element not found');
            return;
        }
        
        // Clear the grid first
        grid.innerHTML = '';
        
        // Get all panels (active and stored closed panels)
        const allPanels = new Map([..._panels.entries()]);
        let hasPanels = false;
        
        // Add all panels to the grid
        allPanels.forEach((panel, id) => {
            hasPanels = true;
            const sourceOption = document.createElement('div');
            sourceOption.className = 'selection-panel-option source-panel-option';
            sourceOption.dataset.id = id;
            
            // Indicate if panel is closed
            if (!_activePanels.has(panel)) {
                sourceOption.classList.add('closed-panel');
            }
            
            const typeIcon = _getPanelTypeIcon(panel.getType());
            sourceOption.innerHTML = `
                <div class="tile-type-icon">
                    <i class="${typeIcon} fa-3x"></i>
                </div>
                <div class="tile-type-label">${panel.getTitle()}</div>
                ${!_activePanels.has(panel) ? `
                    <div class="panel-status">Closed</div>
                    <button class="delete-panel-btn" data-id="${id}" title="Delete">×</button>
                ` : ''}
            `;
            
            // Direct click creates a clone
            sourceOption.addEventListener('click', (e) => {
                // Don't trigger if the delete button was clicked
                if (e.target.classList.contains('delete-panel-btn') || 
                    e.target.closest('.delete-panel-btn')) {
                    return;
                }
                
                // Get panel info
                const config = JSON.parse(JSON.stringify(panel.getConfig()));
                const panelType = panel.getType();
                config.id = `${panelType}-${++_counters[panelType]}`;
                config.title = panel.getTitle();
                const panelId = panel.getId();

                if (panelId && !_activePanels.has(panel)) {
                    // First, remove from panels collection
                    const panel = _panels.get(panelId);
                    if (panel) {
                        const type = panel.getType();
                        if (_panelsByType.has(type)) {
                            _panelsByType.get(type).delete(panel);
                        }
                        _panels.delete(panelId);
                    }
                } else {
                    config.title = _generateUniqueName(config.title);
                }
                populateSourcePanelGrid(grid);
                
                const parentContainer = tileSelector.parentElement;
                if (!parentContainer) {
                    // Create panel with selection tile and resize handle
                    LayoutManager.createPanelWithSelectionTile(
                        _container, 
                        tileSelector, 
                        createPanel, 
                        panelType,
                        config
                    );
                } else {
                    // Create panel in the specific container but still with resize handle
                    LayoutManager.createPanelWithSelectionTile(
                        parentContainer, 
                        tileSelector, 
                        createPanel, 
                        panelType,
                        config
                    );
                }
            });
            
            grid.appendChild(sourceOption);
        });
        
        // Add delete button handlers after all panels are added
        grid.querySelectorAll('.delete-panel-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent panel click
                const panelId = button.dataset.id;
                
                if (panelId) {
                    // First, remove from panels collection
                    const panel = _panels.get(panelId);
                    if (panel) {
                        const type = panel.getType();
                        if (_panelsByType.has(type)) {
                            _panelsByType.get(type).delete(panel);
                        }
                        _panels.delete(panelId);
                    }
                    
                    // Then, refresh the source panel grid
                    populateSourcePanelGrid(grid);
                }
            });
        });
        
        // Show message if no panels available
        if (!hasPanels) {
            grid.innerHTML = '<div class="no-sessions">No panels available to clone</div>';
        }
    }

    
    const sourcePanelGrid = tileSelector.querySelector(`#source-panel-grid-${selectionId}`);
    const clonePanelSection = tileSelector.querySelector(`#clone-panel-section-${selectionId}`);
    function updateSourcePanelGrid() {
        clonePanelSection.style.display = 'block';
        populateSourcePanelGrid(sourcePanelGrid);
    }

    // Get the panel type grid with the unique ID
    const panelTypeGrid = tileSelector.querySelector(`#panel-type-grid-${selectionId}`);
    if (!panelTypeGrid) {
        console.error(`Panel type grid with ID panel-type-grid-${selectionId} not found`);
        return;
    }
    
    // Add panel type options - these create panels on click
    panelTypes.forEach(panel => {
        const panelOption = document.createElement('div');
        panelOption.className = 'selection-panel-option panel-type-option';
        panelOption.dataset.type = panel.type;
        panelOption.innerHTML = `
            <div class="tile-type-icon">
                <i class="${panel.icon} fa-3x"></i>
            </div>
            <div class="tile-type-label">${panel.label}</div>
        `;
        
        // Direct click creates a panel
        panelOption.addEventListener('click', () => {
            // Find the parent container (if any)
            const parentContainer = tileSelector.parentElement;
            
            let newPanel;
            // Always use the createPanelWithSelectionTile to ensure resize handle is added
            if (!parentContainer) {
                // Create panel with selection tile and resize handle in the main container
                newPanel = LayoutManager.createPanelWithSelectionTile(
                    _container, 
                    tileSelector, 
                    createPanel, 
                    panel.type
                );
            } else {
                // Create in the specific container but still with resize handle
                newPanel = LayoutManager.createPanelWithSelectionTile(
                    parentContainer, 
                    tileSelector, 
                    createPanel, 
                    panel.type
                );
            }
            
            hideHeader();
            const sessionsList = tileSelector.querySelector(`#selection-section-${selectionId}`);
            if (sessionsList) {
                sessionsList.style.display = 'none';
            }
            
        });
        
        panelTypeGrid.appendChild(panelOption);
    });
    
    const sessionsList = tileSelector.querySelector(`#sessions-list-${selectionId}`);
    if (sessionsList) {
        sessionsList.innerHTML = '<div class="no-sessions">Loading sessions...</div>';
        
        // Load and display sessions
        SessionManager.listSessions().then(sessions => {
            if (sessions && sessions.length > 0) {
                sessionsList.innerHTML = '';
                
                sessions.forEach(session => {
                    const sessionItem = document.createElement('div');
                    sessionItem.className = 'session-item';
                    sessionItem.innerHTML = `
                        <div class="session-info">
                            <div class="session-name">${session.name}</div>
                            <div class="session-date">${new Date(session.timestamp).toLocaleDateString()}</div>
                            <div class="session-dataset">${session.datasetName || session.dataset}</div>
                        </div>
                    `;
                    
                    // Add click handler
                    sessionItem.addEventListener('click', async () => {
                        // Remove selection tile
                        tileSelector.remove();
                        
                        // Load the session
                        await SessionManager.loadSession(session.name);
                    });
                    
                    sessionsList.appendChild(sessionItem);
                });
            } else {
                sessionsList.innerHTML = '<div class="no-sessions">No saved panel sets available</div>';
            }
        }).catch(error => {
            console.error('Error loading panel sets:', error);
            sessionsList.innerHTML = '<div class="no-sessions">Error loading panel sets</div>';
        });
    } else {
        console.error(`Sessions list with ID sessions-list-${selectionId} not found`);
    }
    
    // Hide close button handler
    const closeBtn = tileSelector.querySelector(`#close-selection-${selectionId}`);
    if (closeBtn) {
        closeBtn.style.display = 'none'; // Hide the close button
    } else {
        console.error(`Close button with ID close-selection-${selectionId} not found`);
    }
    return updateSourcePanelGrid;
}