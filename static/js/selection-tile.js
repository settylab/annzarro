import { Config } from './config.js';

export class SelectionTile {
    /**
     * Create a new SelectionTile.
     *
     * @param {object} options - Dependencies and configuration for the tile.
     * @param {HTMLElement} options.container - Where the tile is appended. For variant "pane", this should be the pane element.
     * @param {string} [options.variant="welcome"] - "welcome" (base tile) or "pane" (normal selection tile).
     * @param {boolean} [options.showSessions=true] - Whether to include the sessions section (only used for "welcome").
     * @param {Map} options.panels - Map of all panels.
     * @param {Set} options.activePanels - Set of active panel objects.
     * @param {object} options.layoutManager - Object with methods to create panels (and optionally close a pane).
     * @param {Function} options.createPanel - Function to create a panel.
     * @param {Map} options.panelsByType - Map grouping panels by type.
     * @param {Function} options.generateUniqueName - Function to generate a unique panel title.
     * @param {object} options.sessionManager - Object with listSessions and loadSession methods.
     */
    constructor(options) {
      Object.assign(this, {
        container: null,
        variant: "welcome",
        showSessions: true,
        panels: new Map(),
        activePanels: new Set(),
        layoutManager: null,
        createPanel: null,
        panelsByType: new Map(),
        generateUniqueName: null,
        sessionManager: null,
      }, options);
  
      // Unique ID for this instance
      this.selectionId = Date.now();
      this.tileSelector = this._createTileSelectorElement();
      this.container.appendChild(this.tileSelector);
      
      // Store reference to this instance on the DOM element for easy access
      this.tileSelector._selectionTileInstance = this;
  
      // Initialize sections that are common to both variants.
      this._initPanelTypeGrid();
      this._initSourcePanelGrid();
      if (this.variant === "welcome" && this.showSessions) {
        this._initSessionsList();
      }
      this._attachCloseButton();
    }
  
    // --- HTML Generation depending on variant ---
    _getTileSelectorHtml() {
      if (this.variant === "welcome") {
        return `
          <div class="tile-selection-container">
            <div class="tile-selection-header">
              <h2>Welcome to AnnZarro</h2>
              <p>Get started by choosing a panel type</p>
              <button class="tile-close-btn" id="close-selection-${this.selectionId}" title="Close">×</button>
            </div>
            <div class="selection-sections">
              <div class="selection-section">
                <h3>Create New Panel</h3>
                <div class="tile-selection-grid" id="panel-type-grid-${this.selectionId}"></div>
              </div>
              <div class="selection-section" id="clone-panel-section-${this.selectionId}" style="display: none;">
                <div class="section-header" style="position: relative; text-align: center; margin-bottom: 10px;">
                  <h3 style="margin: 0; display: inline-block;">Duplicate or Reopen Panel</h3>
                  <button class="btn btn-sm btn-outline-danger clear-closed-panels-btn" id="clear-closed-panels-${this.selectionId}" style="font-size: 0.8rem; padding: 2px 8px; position: absolute; right: 0; top: 0;">
                    <i class="fas fa-trash-alt"></i> Clear closed panels
                  </button>
                </div>
                <div class="source-selection-grid" id="source-panel-grid-${this.selectionId}"></div>
              </div>
              ${this.showSessions ? `
              <div class="selection-section" id="selection-section-${this.selectionId}">
                <h3>Load Saved Panel Set</h3>
                <div class="sessions-list" id="sessions-list-${this.selectionId}"></div>
              </div>
              ` : ''}
            </div>
          </div>
        `;
      } else if (this.variant === "pane") {
        return `
          <div class="tile-selection-container">
            <div class="tile-selection-header">
              <h2>Add New Panel</h2>
              <p>Choose a panel type</p>
              <button class="tile-close-btn" id="close-selection-${this.selectionId}" title="Close">×</button>
            </div>
            <div class="selection-sections">
              <div class="selection-section">
                <h3>Create New Panel</h3>
                <div class="tile-selection-grid" id="panel-type-grid-${this.selectionId}"></div>
              </div>
              <div class="selection-section">
                <div class="section-header" style="position: relative; text-align: center; margin-bottom: 10px;">
                  <h3 style="margin: 0; display: inline-block;">Duplicate or Reopen Panel</h3>
                  <button class="btn btn-sm btn-outline-danger clear-closed-panels-btn" id="clear-closed-panels-pane-${this.selectionId}" style="font-size: 0.8rem; padding: 2px 8px; position: absolute; right: 0; top: 0;">
                    <i class="fas fa-trash-alt"></i> Clear closed panels
                  </button>
                </div>
                <div class="source-selection-grid" id="source-panel-grid-${this.selectionId}"></div>
              </div>
            </div>
          </div>
        `;
      }
    }
  
    _createTileSelectorElement() {
      const el = document.createElement('div');
      el.className = 'tile-selector';
      el.dataset.tileId = 'base-selection-' + Date.now();
      el.dataset.isSelectionTile = 'true';
      if (this.variant === "welcome") {
        el.dataset.isBottomSelector = 'true';
      }
      el.innerHTML = this._getTileSelectorHtml();
      return el;
    }
  
    // --- Panel Types Section ---
    get panelTypes() {
      // Filter panel types based on enabled types in the config
      const enabledTypes = Config.DEFAULTS.ENABLED_PANEL_TYPES || [];
      
      // If no panel types are specified as enabled, show all panel types
      if (!enabledTypes.length) {
        return Config.PANEL_TYPES;
      }
      
      // Filter the panel types to only show enabled ones
      return Config.PANEL_TYPES.filter(panel => enabledTypes.includes(panel.type));
    }
  
    _initPanelTypeGrid() {
      const grid = this.tileSelector.querySelector(`#panel-type-grid-${this.selectionId}`);
      if (!grid) {
        console.error(`Panel type grid with ID panel-type-grid-${this.selectionId} not found`);
        return;
      }
      this.panelTypes.forEach(panel => {
        const option = document.createElement('div');
        option.className = 'selection-panel-option panel-type-option';
        option.dataset.type = panel.type;
        option.innerHTML = `
          <div class="tile-type-icon">
            <i class="${panel.icon} fa-3x"></i>
          </div>
          <div class="tile-type-label">${panel.label}</div>
        `;
        option.addEventListener('click', () => {
          this.createPanelFromType(panel.type);
          if (this.variant === "welcome") {
            this.hideHeader();
            this.toggleSessions(false);
          }
        });
        grid.appendChild(option);
      });
    }
  
    /**
     * Helper to format a panel type into a human-friendly title.
     * Uses the label from centralized panel type definitions
     */
    _formatPanelType(panelType) {
      // Use the label from centralized panel type definitions
      const panelTypeObj = Config.PANEL_TYPES.find(pt => pt.type === panelType);
      if (panelTypeObj && panelTypeObj.label) {
        return panelTypeObj.label;
      }
      
      // Fallback to original formatting
      return panelType.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }
  
    /**
     * Create a panel based on the type.
     * For "welcome", use the layoutManager; for "pane", call createPanel directly and remove the tile.
     */
    createPanelFromType(panelType) {
      if (this.variant === "welcome") {
        const parentContainer = this.tileSelector.parentElement;
        if (!parentContainer) {
          this.layoutManager.createPanelWithSelectionTile(
            this.container,
            this.tileSelector,
            this.createPanel,
            panelType
          );
        } else {
          this.layoutManager.createPanelWithSelectionTile(
            parentContainer,
            this.tileSelector,
            this.createPanel,
            panelType
          );
        }
        // After creating the first panel, always hide the header and sessions,
        // and show the clone section if there are panels
        if (this.panels.size > 0) {
          this.hideHeader();
          this.toggleSessions(false);
          const cloneSection = this.tileSelector.querySelector(`#clone-panel-section-${this.selectionId}`);
          if (cloneSection) cloneSection.style.display = 'block';
        }
      } else if (this.variant === "pane") {
        const newId = `${panelType}-${Date.now()}`;
        const config = {
          id: newId,
          title: this.generateUniqueName(`${this._formatPanelType(panelType)} 1`)
        };
        const parentPane = this.tileSelector.closest('.split-pane') || this.container;
        this.createPanel(panelType, config, parentPane);
        this.remove();
      }
    }
  
    // --- Source Panel Grid Section ---
    _initSourcePanelGrid() {
      // For both variants: in "welcome" the clone section is hidden initially,
      // in "pane" it is always visible.
      const grid = this.tileSelector.querySelector(`#source-panel-grid-${this.selectionId}`);
      if (!grid) {
        console.error(`Source panel grid with ID source-panel-grid-${this.selectionId} not found`);
        return;
      }
      this._populateSourcePanelGrid(grid);
    }
  
    _createSourcePanelOption(panel, id, grid) {
      const option = document.createElement('div');
      option.className = 'selection-panel-option source-panel-option';
      option.dataset.id = id;
      if (!this.activePanels.has(panel)) {
        option.classList.add('closed-panel');
      }
      
      // Get the icon from centralized panel definitions
      const panelType = panel.getType();
      const panelId = panel.getId();
      const panelTitle = panel.getTitle();
      const panelConfig = Config.PANEL_TYPES.find(pt => pt.type === panelType);
      const typeIcon = panelConfig ? panelConfig.icon : 'fas fa-cube';
      
      option.innerHTML = `
        <div class="tile-type-icon">
          <i class="${typeIcon} fa-3x"></i>
        </div>
        <div class="tile-type-label">${panelTitle}</div>
        ${!this.activePanels.has(panel) ? `
          <div class="panel-status panel-closed-btn" data-id="${id}" data-type="${panelType}">Closed</div>
          <button class="delete-panel-btn" data-id="${id}" title="Delete">×</button>
        ` : ''}
      `;
      
      // Add hover effect to change "Closed" to "Reopen" for closed panels
      const statusBtn = option.querySelector('.panel-closed-btn');
      if (statusBtn) {
        statusBtn.addEventListener('mouseenter', function() {
          this.innerText = 'Reopen';
          this.classList.add('panel-reopen-btn');
        });
        
        statusBtn.addEventListener('mouseleave', function() {
          this.innerText = 'Closed';
          this.classList.remove('panel-reopen-btn');
        });
        
        statusBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Stop propagation to prevent the container click
          const panelId = e.target.dataset.id;
          const panelType = e.target.dataset.type;
          this._reopenPanel(panelId, panelType, grid);
        });
      }
      option.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-panel-btn') ||
            e.target.closest('.delete-panel-btn') || 
            e.target.classList.contains('panel-closed-btn') ||
            e.target.closest('.panel-closed-btn')) {
          return;
        }
        
        // For regular clicks on the panel, clone/duplicate the panel instead of reopening
        const config = JSON.parse(JSON.stringify(panel.getConfig()));
        config.id = `${panelType}-${Date.now()}`;
        
        // Always ensure unique titles for duplicated panels
        config.title = this.generateUniqueName(panelTitle);
        config._closed = false;
        
        // For cloning, we don't delete the original panel
        this._populateSourcePanelGrid(grid);
        if (this.variant === "welcome") {
          const parentContainer = this.tileSelector.parentElement;
          if (!parentContainer) {
            this.layoutManager.createPanelWithSelectionTile(
              this.container,
              this.tileSelector,
              this.createPanel,
              panelType,
              config
            );
          } else {
            this.layoutManager.createPanelWithSelectionTile(
              parentContainer,
              this.tileSelector,
              this.createPanel,
              panelType,
              config
            );
          }
        } else if (this.variant === "pane") {
          const parentPane = this.tileSelector.closest('.split-pane') || this.container;
          this.createPanel(panelType, config, parentPane);
          this.remove();
        }
      });
      return option;
    }
  
    _attachDeleteHandlers(grid) {
      grid.querySelectorAll('.delete-panel-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          const panelId = button.dataset.id;
          if (panelId) {
            const panelInstance = this.panels.get(panelId);
            if (panelInstance) {
              const type = panelInstance.getType();
              if (this.panelsByType.has(type)) {
                this.panelsByType.get(type).delete(panelInstance);
              }
              this.panels.delete(panelId);
            }
            
            // Update the current grid
            this._populateSourcePanelGrid(grid);
            
            // Update all selection tiles by finding PanelManager's updateSourcePanelSelection function
            if (window.PanelManager && typeof window.PanelManager.updateSourcePanelSelection === 'function') {
              window.PanelManager.updateSourcePanelSelection();
            }
          }
        });
      });
    }
  
    /**
     * Populates the source panel grid with available panels
     * @param {HTMLElement} grid - The grid element to populate
     * @returns {boolean} - Whether any panels were found to populate the grid
     * @private
     */
    _populateSourcePanelGrid(grid) {
      if (!grid) {
        console.error('Source panel grid element not found');
        return false;
      }
      grid.innerHTML = '';
      
      // Populate the panel grid
      const allPanels = new Map(this.panels);
      let hasPanels = false;
      let hasClosedPanels = false;
      
      allPanels.forEach((panel, id) => {
        hasPanels = true;
        if (!this.activePanels.has(panel)) {
          hasClosedPanels = true;
        }
        const option = this._createSourcePanelOption(panel, id, grid);
        grid.appendChild(option);
      });
      
      this._attachDeleteHandlers(grid);
      
      // Update the clear button visibility
      this._updateClearButtonVisibility(hasClosedPanels);
      
      if (!hasPanels) {
        grid.innerHTML = '<div class="no-sessions">No panels available to clone</div>';
      }
      
      return hasPanels;
    }
    
    /**
     * Update the visibility of the clear button based on whether there are closed panels
     * @param {boolean} hasClosedPanels - Whether there are closed panels
     * @private 
     */
    _updateClearButtonVisibility(hasClosedPanels) {
      // Find the clear button in both variants
      const welcomeClearButton = document.getElementById(`clear-closed-panels-${this.selectionId}`);
      const paneClearButton = document.getElementById(`clear-closed-panels-pane-${this.selectionId}`);
      
      // Add click handlers if the buttons exist and don't already have them
      if (welcomeClearButton && !welcomeClearButton._hasClickHandler) {
        welcomeClearButton.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this._clearClosedPanels();
        });
        welcomeClearButton._hasClickHandler = true;
      }
      
      if (paneClearButton && !paneClearButton._hasClickHandler) {
        paneClearButton.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this._clearClosedPanels();
        });
        paneClearButton._hasClickHandler = true;
      }
      
      // Set button visibility based on which one exists and whether there are closed panels
      if (welcomeClearButton) {
        welcomeClearButton.style.display = hasClosedPanels ? 'block' : 'none';
      }
      
      if (paneClearButton) {
        paneClearButton.style.display = hasClosedPanels ? 'block' : 'none';
      }
    }
    
    /**
     * Clear all closed panels after confirmation
     * @private
     */
    _clearClosedPanels() {
      const closedPanels = [];
      
      // Collect all closed panels
      this.panels.forEach((panel, id) => {
        if (!this.activePanels.has(panel)) {
          closedPanels.push({ panel, id });
        }
      });
      
      if (closedPanels.length === 0) {
        return;
      }
      
      // Ask for confirmation
      const confirmMessage = `Are you sure you want to delete all ${closedPanels.length} closed panels?`;
      if (confirm(confirmMessage)) {
        // Delete all closed panels
        closedPanels.forEach(({ panel, id }) => {
          const type = panel.getType();
          if (this.panelsByType.has(type)) {
            this.panelsByType.get(type).delete(panel);
          }
          this.panels.delete(id);
        });
        
        // Find the grid and refresh it
        const grid = this.tileSelector.querySelector(`.source-selection-grid`);
        if (grid) {
          this._populateSourcePanelGrid(grid);
        }
        
        // Update all selection tiles globally
        if (window.PanelManager && typeof window.PanelManager.updateSourcePanelSelection === 'function') {
          window.PanelManager.updateSourcePanelSelection();
        }
      }
    }
  
    // --- Sessions Section (Only for "welcome") ---
    _initSessionsList() {
      const list = this.tileSelector.querySelector(`#sessions-list-${this.selectionId}`);
      if (!list) {
        console.error(`Sessions list with ID sessions-list-${this.selectionId} not found`);
        return;
      }
      
      // Use either provided sessionManager or global window.sessionManager
      const sessionManager = this.sessionManager || window.sessionManager;
      
      if (!sessionManager) {
        console.error('SessionManager not available');
        list.innerHTML = '<div class="no-sessions">Session manager not available</div>';
        return;
      }
      
      // Check if preview functions are loaded
      const previewsAvailable = window._loadAllSessionPreviews && window._updatePanelPreview;
      
      // Show loading state
      list.innerHTML = '<div class="no-sessions">Loading sessions...</div>';
      
      // Get sessions list
      sessionManager.listSessions().then(sessions => {
        if (sessions && sessions.length > 0) {
          list.innerHTML = '';
          
          // Create items
          sessions.forEach(session => {
            list.appendChild(this._createSessionItem(session));
          });
          
          // Load previews if available
          if (previewsAvailable) {
            this._loadSessionPreviews(sessions);
          } else {
            // If previews aren't available, show placeholder text
            document.querySelectorAll('.session-card-preview').forEach(container => {
              container.innerHTML = '<div class="panel-preview-empty">Panel info will appear here</div>';
            });
            
            // Try again after a short delay in case the functions are being loaded
            setTimeout(() => {
              if (window._loadAllSessionPreviews) {
                this._loadSessionPreviews(sessions);
              }
            }, 1000);
          }
        } else {
          list.innerHTML = '<div class="no-sessions">No saved panel sets available</div>';
        }
      }).catch(error => {
        console.error('Error loading panel sets:', error);
        list.innerHTML = '<div class="no-sessions">Error loading panel sets</div>';
      });
    }
    
    /**
     * Load panel previews for session items
     * @param {Array} sessions - List of session objects
     * @private
     */
    _loadSessionPreviews(sessions) {
      // Use the global function from main.js to load all previews
      if (window._loadAllSessionPreviews) {
        window._loadAllSessionPreviews(sessions);
      } else {
        console.warn('Global preview loading function not available');
        
        // If the function isn't available, show a message in the preview containers
        sessions.forEach(session => {
          const previewContainers = document.querySelectorAll(
            `.session-card-preview[data-session-name="${session.name}"]`
          );
          
          previewContainers.forEach(container => {
            container.innerHTML = `<div class="panel-preview-empty">Preview unavailable</div>`;
          });
        });
      }
    }
  
    _createSessionItem(session) {
      const item = document.createElement('div');
      item.className = 'session-item';
      
      // Add special class for autosave session
      if (session.isAutosave) {
        item.classList.add('autosave');
        item.style.borderColor = '#0dcaf0';
        item.style.backgroundColor = '#f8f9fa';
      }
      
      // Create the panel preview placeholder
      const panelPreview = `<div class="session-card-preview" data-session-name="${session.name}">
        <div class="panel-preview-loading">
          <i class="fas fa-spinner fa-pulse"></i>
        </div>
      </div>`;
      
      item.innerHTML = `
        <div class="session-info">
          <div class="session-name" title="${session.name}">
            <span class="truncate-text">${session.name}</span>
            ${session.isAutosave ? 
              `<span class="autosave-indicator" style="font-size: 0.7rem; padding: 2px 6px; background-color: #0dcaf0; color: white; border-radius: 10px; margin-left: 8px;">Auto</span>` 
              : ''}
          </div>
          <div class="session-date">${new Date(session.timestamp).toLocaleDateString()}</div>
          <div class="session-dataset truncate-text" title="${session.datasetName || session.dataset}">${session.datasetName || session.dataset}</div>
        </div>
        ${panelPreview}
      `;
      
      // Use either provided sessionManager or global window.sessionManager
      const sessionManager = this.sessionManager || window.sessionManager;
      
      item.addEventListener('click', async () => {
        if (this.variant != "welcome") {
            this.remove();
        }
        if (sessionManager) {
          await sessionManager.loadSession(session.name);
        } else {
          console.error('SessionManager not available, cannot load session');
        }
      });
      
      return item;
    }
  
    // --- Close Button Behavior ---
    _attachCloseButton() {
      const closeBtn = this.tileSelector.querySelector(`#close-selection-${this.selectionId}`);
      if (closeBtn) {
        if (this.variant === "welcome") {
          // For welcome tiles, hide the button.
          closeBtn.style.display = 'none';
        } else if (this.variant === "pane") {
          // For pane tiles, attach a click event to remove the tile and close the pane.
          closeBtn.addEventListener('click', () => {
            if (this.layoutManager && typeof this.layoutManager.closePanel === 'function') {
                this.layoutManager.closePanel(this.tileSelector);
                delete this.tileSelector._selectionTileInstance;
            } else {
                this.remove();
            }
          });
        }
      } else {
        console.error(`Close button with ID close-selection-${this.selectionId} not found`);
      }
    }
  
    // --- Public Methods ---
    /**
     * In welcome variant, update the source panel grid (and show the clone section).
     * If no panels are available in welcome variant, show the sessions panel instead.
     * @returns {boolean} - Whether any panels were found to populate the grid
     */
    updateSourcePanelGrid() {
      const grid = this.tileSelector.querySelector(`#source-panel-grid-${this.selectionId}`);
      
      if (this.variant === "welcome") {
        const cloneSection = this.tileSelector.querySelector(`#clone-panel-section-${this.selectionId}`);
        if (cloneSection) cloneSection.style.display = 'block';
        
        const hasPanels = this._populateSourcePanelGrid(grid);
        
        // If no panels available and this is welcome tile
        if (!hasPanels) {
          // Clear any autosave since there are no panels to restore
          const sessionManager = this.sessionManager || window.sessionManager;
          if (sessionManager && typeof sessionManager.clearAutosave === 'function') {
            console.log('No panels available, clearing autosave');
            sessionManager.clearAutosave();
          }
          
          // If sessions section is enabled, show it
          if (this.showSessions) {
            // Hide the clone section
            if (cloneSection) cloneSection.style.display = 'none';
            
            // Show the sessions section
            const sessionsSection = this.tileSelector.querySelector(`#selection-section-${this.selectionId}`);
            if (sessionsSection) {
              sessionsSection.style.display = 'block';
              // Refresh the sessions list to make sure it's up to date
              this.refreshSessionsList();
            }
          }
        }
        
        return hasPanels;
      } else {
        return this._populateSourcePanelGrid(grid);
      }
    }
  
    /**
     * Toggle the visibility of the sessions section (only applicable for welcome variant).
     *
     * @param {boolean} show - True to show, false to hide.
     */
    toggleSessions(show) {
      const sessionsSection = this.tileSelector.querySelector(`#selection-section-${this.selectionId}`);
      if (sessionsSection) {
        sessionsSection.style.display = show ? '' : 'none';
      }
    }
  
    /**
     * Hide the header.
     */
    hideHeader() {
      const header = this.tileSelector.querySelector('.tile-selection-header');
      if (header) header.style.display = 'none';
    }
  
    /**
     * Refresh the sessions list manually (only applicable for welcome variant).
     */
    refreshSessionsList() {
      if (this.variant === "welcome" && this.showSessions) {
        this._initSessionsList();
      }
    }
  
    /**
     * Remove the selection tile from the DOM.
     */
    remove() {
      delete this.tileSelector._selectionTileInstance;
      this.tileSelector.remove();
    }

    /**
     * Reopen a closed panel with the same ID (instead of cloning)
     * @param {string} panelId - ID of the panel to reopen
     * @param {string} panelType - Type of the panel to reopen
     * @param {HTMLElement} grid - The source panel grid element to update
     * @private
     */
    _reopenPanel(panelId, panelType, grid) {
      const panel = this.panels.get(panelId);
      if (!panel) return;
      
      // Check if the panel is active (should not be)
      if (this.activePanels.has(panel)) {
        console.warn('Cannot reopen an already active panel:', panelId);
        return;
      }
      
      // Get the panel configuration
      const config = JSON.parse(JSON.stringify(panel.getConfig()));
      config._closed = false; // Mark as not closed
      
      // Keep the SAME ID to maintain references from other panels
      config.id = panelId;
      
      // Create a backup of the panel to restore in case of failure
      const backupPanel = panel;
      
      try {
        // Remove the panel from panels map and type-specific collection
        if (this.panelsByType.has(panelType)) {
          this.panelsByType.get(panelType).delete(panel);
        }
        this.panels.delete(panelId);
        
        // Create the new panel using the same ID
        let newPanel;
        
        if (this.variant === "welcome") {
          const parentContainer = this.tileSelector.parentElement;
          if (!parentContainer) {
            newPanel = this.layoutManager.createPanelWithSelectionTile(
              this.container,
              this.tileSelector,
              this.createPanel,
              panelType,
              config
            );
          } else {
            newPanel = this.layoutManager.createPanelWithSelectionTile(
              parentContainer,
              this.tileSelector,
              this.createPanel,
              panelType,
              config
            );
          }
        } else if (this.variant === "pane") {
          const parentPane = this.tileSelector.closest('.split-pane') || this.container;
          newPanel = this.createPanel(panelType, config, parentPane);
          this.remove();
        }
        
        // If panel creation failed, restore the backup
        if (!newPanel) {
          console.error('Failed to reopen panel:', panelId);
          if (this.panelsByType.has(panelType)) {
            this.panelsByType.get(panelType).add(backupPanel);
          }
          this.panels.set(panelId, backupPanel);
          this._populateSourcePanelGrid(grid);
        }
      } catch (error) {
        console.error('Error reopening panel:', error);
        // Restore the original panel on error
        if (this.panelsByType.has(panelType)) {
          this.panelsByType.get(panelType).add(backupPanel);
        }
        this.panels.set(panelId, backupPanel);
        this._populateSourcePanelGrid(grid);
      }
    }
  }