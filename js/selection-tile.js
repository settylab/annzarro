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
     * @param {object} options.counters - Object holding counters for panel types.
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
        counters: {},
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
                <h3>Clone Existing Panel</h3>
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
                <h3>Clone Existing Panel</h3>
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
      // Use the centralized panel type definitions
      return Config.PANEL_TYPES;
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
        const newId = `${panelType}-${++this.counters[panelType]}`;
        const config = {
          id: newId,
          title: `${this._formatPanelType(panelType)} ${this.counters[panelType]}`
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
      const panelConfig = Config.PANEL_TYPES.find(pt => pt.type === panelType);
      const typeIcon = panelConfig ? panelConfig.icon : 'fas fa-cube';
      
      option.innerHTML = `
        <div class="tile-type-icon">
          <i class="${typeIcon} fa-3x"></i>
        </div>
        <div class="tile-type-label">${panel.getTitle()}</div>
        ${!this.activePanels.has(panel) ? `
          <div class="panel-status">Closed</div>
          <button class="delete-panel-btn" data-id="${id}" title="Delete">×</button>
        ` : ''}
      `;
      option.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-panel-btn') ||
            e.target.closest('.delete-panel-btn')) {
          return;
        }
        const config = JSON.parse(JSON.stringify(panel.getConfig()));
        const panelType = panel.getType();
        config.id = `${panelType}-${++this.counters[panelType]}`;
        config.title = panel.getTitle();
        const panelId = panel.getId();
  
        if (panelId && !this.activePanels.has(panel)) {
          const panelInstance = this.panels.get(panelId);
          if (panelInstance) {
            const type = panelInstance.getType();
            if (this.panelsByType.has(type)) {
              this.panelsByType.get(type).delete(panelInstance);
            }
            this.panels.delete(panelId);
          }
        } else {
          config.title = this.generateUniqueName(config.title);
        }
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
            this._populateSourcePanelGrid(grid);
          }
        });
      });
    }
  
    _populateSourcePanelGrid(grid) {
      if (!grid) {
        console.error('Source panel grid element not found');
        return;
      }
      grid.innerHTML = '';
      const allPanels = new Map(this.panels);
      let hasPanels = false;
      allPanels.forEach((panel, id) => {
        hasPanels = true;
        const option = this._createSourcePanelOption(panel, id, grid);
        grid.appendChild(option);
      });
      this._attachDeleteHandlers(grid);
      if (!hasPanels) {
        grid.innerHTML = '<div class="no-sessions">No panels available to clone</div>';
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
      
      list.innerHTML = '<div class="no-sessions">Loading sessions...</div>';
      sessionManager.listSessions().then(sessions => {
        if (sessions && sessions.length > 0) {
          list.innerHTML = '';
          sessions.forEach(session => {
            list.appendChild(this._createSessionItem(session));
          });
        } else {
          list.innerHTML = '<div class="no-sessions">No saved panel sets available</div>';
        }
      }).catch(error => {
        console.error('Error loading panel sets:', error);
        list.innerHTML = '<div class="no-sessions">Error loading panel sets</div>';
      });
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
      
      item.innerHTML = `
        <div class="session-info">
          <div class="session-name">
            ${session.name}
            ${session.isAutosave ? 
              `<span class="autosave-indicator" style="font-size: 0.7rem; padding: 2px 6px; background-color: #0dcaf0; color: white; border-radius: 10px; margin-left: 8px;">Auto</span>` 
              : ''}
          </div>
          <div class="session-date">${new Date(session.timestamp).toLocaleDateString()}</div>
          <div class="session-dataset">${session.datasetName || session.dataset}</div>
        </div>
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
     */
    updateSourcePanelGrid() {
      const grid = this.tileSelector.querySelector(`#source-panel-grid-${this.selectionId}`);
      if (this.variant === "welcome") {
        const cloneSection = this.tileSelector.querySelector(`#clone-panel-section-${this.selectionId}`);
        if (cloneSection) cloneSection.style.display = 'block';
      }
      this._populateSourcePanelGrid(grid);
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
  }