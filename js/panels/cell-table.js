/**
 * Cell Table Panel
 * Displays cells in a DataTable with columns from obs, obsm, obsp, and layers
 */
import { PanelManager } from '../panel-manager.js';
import { Config } from '../config.js';

const CellTablePanel = (function() {
    /**
     * Cell Table Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function CellTablePanel(container, options = {}) {
        // Private variables
        const _id = options.id || `cell-table-${Date.now()}`;
        let _title = options.title || 'Cell Table';
        const _container = container;
        let _tableContainer = null;
        
        /**
         * Initialize the panel
         */
        function init() {
            _container.innerHTML = `
                <div class="table-panel">
                    <div class="table-controls">
                        <div class="alert alert-info">Cell table configuration options will appear here</div>
                    </div>
                    <div class="table-container" id="table-container-${_id}">
                        <div class="alert alert-secondary">Cell table will appear here</div>
                    </div>
                </div>
            `;
            
            _tableContainer = document.getElementById(`table-container-${_id}`);
        }
        
        /**
         * Clean up resources
         */
        function cleanup() {
            _container.innerHTML = '';
        }
        
        /**
         * Handle data updates from other components
         * @param {string} updateType - Type of update
         * @param {Object} data - Update data
         */
        function onDataUpdate(updateType, data) {
            // Handle data updates
        }
        
        /**
         * Get panel ID
         * @returns {string} - Panel ID
         */
        function getId() {
            return _id;
        }
        
        /**
         * Get panel title
         * @returns {string} - Panel title
         */
        function getTitle() {
            return _title;
        }
        
        /**
         * Set panel title
         * @param {string} title - New title
         */
        function setTitle(title) {
            _title = title;
            // No _settings object in this panel type, but we ensure title is updated in getConfig
        }
        
        /**
         * Get panel type
         * @returns {string} - Panel type
         */
        function getType() {
            return 'cell-table';
        }
        
        /**
         * Get panel configuration
         * @returns {Object} - Panel configuration
         */
        function getConfig() {
            return {
                title: _title
            };
        }
        
        // Public API
        return {
            init,
            cleanup,
            onDataUpdate,
            getId,
            getTitle,
            setTitle,
            getType,
            getConfig
        };
    }
    
    // Register this panel type with the PanelManager
    PanelManager.registerPanelType('cell-table', CellTablePanel);
    
    return CellTablePanel;
})();

// Export as module
export { CellTablePanel };