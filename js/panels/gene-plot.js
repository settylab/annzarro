/**
 * Gene Plot Panel
 * Displays genes using data from var, varm, varp, and layers
 */
const GenePlotPanel = (function() {
    /**
     * Gene Plot Panel constructor
     * @param {HTMLElement} container - Container element
     * @param {Object} options - Panel options
     */
    function GenePlotPanel(container, options = {}) {
        // Private variables
        const _id = options.id || `gene-plot-${Date.now()}`;
        let _title = options.title || 'Gene Plot';
        const _container = container;
        let _plotContainer = null;
        
        /**
         * Initialize the panel
         */
        function init() {
            _container.innerHTML = `
                <div class="plot-panel">
                    <div class="plot-controls">
                        <div class="alert alert-info">Gene plot configuration options will appear here</div>
                    </div>
                    <div class="plot-container" id="plot-container-${_id}">
                        <div class="alert alert-secondary">Gene plot visualization will appear here</div>
                    </div>
                </div>
            `;
            
            _plotContainer = document.getElementById(`plot-container-${_id}`);
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
        }
        
        /**
         * Get panel type
         * @returns {string} - Panel type
         */
        function getType() {
            return 'gene-plot';
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
    setTimeout(() => {
        if (window.PanelManager) {
            window.PanelManager.registerPanelType('gene-plot', GenePlotPanel);
        }
    }, 0);
    
    return GenePlotPanel;
})();

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GenePlotPanel;
} else {
    window.GenePlotPanel = GenePlotPanel;
}