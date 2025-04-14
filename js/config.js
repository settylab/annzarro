/**
 * Configuration module for AnnZarro
 */
const Config = (function() {
    // API endpoints
    const API_BASE = '/api/v1';
    
    const API = {
        CONFIG: `${API_BASE}/config`,
        DATASETS: `${API_BASE}/datasets`,
        DATASET_INFO: `${API_BASE}/data/info`,
        DATASET_STRUCTURE: `${API_BASE}/data/dataset_structure`,
        CELLS: `${API_BASE}/data/cells`,
        GENES: `${API_BASE}/data/genes`,
        OBS: `${API_BASE}/data/obs`,
        VAR: `${API_BASE}/data/var`,
        OBSM: `${API_BASE}/data/obsm`,
        VARM: `${API_BASE}/data/varm`,
        OBSP: `${API_BASE}/data/obsp`,
        VARP: `${API_BASE}/data/varp`,
        LAYER: `${API_BASE}/data/layer`,
        X: `${API_BASE}/data/X`,
        BY_PATH: `${API_BASE}/data/by_path`,
        UNS: `${API_BASE}/data/uns`,
        SESSIONS_LIST: `${API_BASE}/sessions/list`,
        SESSIONS_SAVE: `${API_BASE}/sessions/save`,
        SESSIONS_LOAD: `${API_BASE}/sessions/load`,
        SESSIONS_DELETE: `${API_BASE}/sessions/delete`,
        SESSIONS_EXPORT: `${API_BASE}/sessions/export`,
        SESSIONS_IMPORT: `${API_BASE}/sessions/import`
    };
    
    // Panel types definition
    const PANEL_TYPES = [
        { type: 'cell-plot', label: 'Cell Plot', icon: 'fas fa-microscope' },
        { type: 'gene-plot', label: 'Gene Plot', icon: 'fas fa-dna' },
        { type: 'cell-table', label: 'Cell Table', icon: 'fas fa-solid fa-list-ul' },
        { type: 'gene-table', label: 'Gene Table', icon: 'fas fa-th-list' },
        { type: 'gene-set', label: 'Gene Set Analysis', icon: 'fas fa-project-diagram' }
    ];
    
    // Configure Plotly.js defaults if available
    if (typeof Plotly !== 'undefined') {
        // Apply the willReadFrequently attribute to canvas elements
        // This improves performance when using getImageData
        Plotly.setPlotConfig({
            setAttributeOnPlotly: {
                plotGlPixelRatio: window.devicePixelRatio || 1,
                customBuildData: { willReadFrequently: true }
            }
        });
    }
    
    // Default settings
    const DEFAULTS = {
        MAX_CELLS: 10000,
        MAX_GENES: 10000,
        POINT_SIZE: 5,
        POINT_OPACITY: 1.0,
        COLOR_SCALE: 'Portland',
        COLOR_SCALES: [
            "Greys", "YlGnBu", "Greens", "YlOrRd", "Bluered", "RdBu",
            "Reds", "Blues", "Picnic", "Rainbow", "Portland", "Jet",
            "Hot", "Blackbody", "Earth", "Electric", "Viridis", "Cividis",
            "Inferno", "Magma", "Plasma"
        ],
        COLOR_SCALES_DISCRETE: "tab10",
        POINT_SHAPES: ['circle', 'square', 'diamond', 'cross', 'x'],
        TAXONOMY_ID: '9606', // Homo sapiens by default
        TAXONOMY_SPECIES: {
            '9606': 'Homo sapiens',
            '10090': 'Mus musculus',
            '10116': 'Rattus norvegicus',
            '7227': 'Drosophila melanogaster',
            '6239': 'Caenorhabditis elegans',
            '7955': 'Danio rerio'
        },
        // Enable/disable specific panel types in the selection tile
        ENABLED_PANEL_TYPES: ['cell-plot', 'gene-plot', 'cell-table', 'gene-table'] // 'gene-set'
    };

    // Cache constraints (for CacheManager)
    const CACHE = {
        MAX_ENTRIES: 1000, // total entries
        MAX_SIZE_BYTES: 1 * 1024 * 1024 * 1024 // ~1 GB
    };
    
    // Autosave configuration
    const AUTOSAVE = {
        ENABLED: true, // Whether autosave is enabled by default
        INTERVAL: 10000, // 10 seconds autosave interval (in milliseconds)
        STORAGE_KEY: 'annzarro_autosave', // Local Storage key for autosaved session
        SESSION_NAME: 'Autosave', // Default name for autosaved sessions
        SHOW_IN_LIST: false, // Whether to show autosave in session lists
        AUTO_RESTORE: true // Automatically restore autosave on startup
    };
    
    // For StringDB API
    const STRING_DB = {
        BASE_URL: 'https://string-db.org/api',
        VERSION: '11.5',
        NETWORK_IMAGE_URL: 'https://string-db.org/api/svg/network',
        INTERACTION_URL: 'https://string-db.org/api/json/interaction_partners',
        ENRICHMENT_URL: 'https://string-db.org/api/json/enrichment'
    };
    
    // Keyboard shortcuts configuration
    const KEYBOARD_SHORTCUTS = {
        // Whether to use browser-compatible shortcuts (true) or more intuitive but potentially 
        // conflicting shortcuts (false). Set to false when running in Electron or other non-browser env.
        BROWSER_COMPATIBLE: true,
        
        // Default shortcuts that work in both browser and desktop modes
        SAVE_SESSION: { key: 's', modifiers: { ctrl: true } },
        LOAD_SESSION: { key: 'o', modifiers: { ctrl: true } },
        REFRESH_DATASETS: { key: 'r', modifiers: { ctrl: true } },
        
        // Single-key shortcuts for when no text field is active
        NEW_PANEL: { key: 'n', modifiers: {} },
        CLOSE_PANEL: { key: 'w', modifiers: {} },
        SPLIT_HORIZONTAL: { key: 'h', modifiers: {} },
        SPLIT_VERTICAL: { key: 'v', modifiers: {} },
        TOGGLE_CONTROLS: { key: 'c', modifiers: {} },
        
        // Special keys that don't generally conflict
        SHOW_HELP: { key: 'F1', modifiers: {} },
        CLOSE_MODAL: { key: 'Escape', modifiers: {} }
    };
    
    // Server configuration that will be loaded at runtime
    const SERVER_CONFIG = {
        // Branding
        app_name: null,
        project_description: null,
        contact_info: {},
        
        // Panel configuration
        enabled_panel_types: null,
        
        // Cache configuration
        ui_cache_max_entries: null,
        ui_cache_max_size_mb: null,
        
        // Autosave configuration
        ui_autosave_enabled: null,
        ui_autosave_interval_ms: null,
        ui_autosave_storage_key: null,
        ui_autosave_session_name: null,
        ui_autosave_show_in_list: null,
        ui_autosave_auto_restore: null,
        
        // UI defaults
        ui_max_cells: null,
        ui_max_genes: null,
        ui_point_size: null,
        ui_point_opacity: null,
        ui_color_scale: null,
        ui_taxonomy_id: null,
        
        // External integrations
        integrations: null
    };
    
    // Function to load server configuration
    async function loadServerConfig() {
        try {
            const response = await fetch(API.CONFIG);
            if (response.ok) {
                const config = await response.json();
                
                // Update server config with all fields from server
                Object.keys(config).forEach(key => {
                    // Don't override server connection info
                    if (!['host', 'port', 'data_dir'].includes(key)) {
                        SERVER_CONFIG[key] = config[key];
                    }
                });
                
                // Override local defaults with server-provided values
                if (SERVER_CONFIG.ui_max_cells) DEFAULTS.MAX_CELLS = SERVER_CONFIG.ui_max_cells;
                if (SERVER_CONFIG.ui_max_genes) DEFAULTS.MAX_GENES = SERVER_CONFIG.ui_max_genes;
                if (SERVER_CONFIG.ui_point_size) DEFAULTS.POINT_SIZE = SERVER_CONFIG.ui_point_size;
                if (SERVER_CONFIG.ui_point_opacity) DEFAULTS.POINT_OPACITY = SERVER_CONFIG.ui_point_opacity;
                if (SERVER_CONFIG.ui_color_scale) DEFAULTS.COLOR_SCALE = SERVER_CONFIG.ui_color_scale;
                if (SERVER_CONFIG.ui_taxonomy_id) DEFAULTS.TAXONOMY_ID = SERVER_CONFIG.ui_taxonomy_id;
                
                // Override panel types if provided
                if (SERVER_CONFIG.enabled_panel_types) {
                    DEFAULTS.ENABLED_PANEL_TYPES = SERVER_CONFIG.enabled_panel_types;
                }
                
                // Override cache settings if provided
                if (SERVER_CONFIG.ui_cache_max_entries) CACHE.MAX_ENTRIES = SERVER_CONFIG.ui_cache_max_entries;
                if (SERVER_CONFIG.ui_cache_max_size_mb) CACHE.MAX_SIZE_BYTES = SERVER_CONFIG.ui_cache_max_size_mb * 1024 * 1024;
                
                // Override autosave settings if provided
                if (SERVER_CONFIG.ui_autosave_enabled !== null) AUTOSAVE.ENABLED = SERVER_CONFIG.ui_autosave_enabled;
                if (SERVER_CONFIG.ui_autosave_interval_ms) AUTOSAVE.INTERVAL = SERVER_CONFIG.ui_autosave_interval_ms;
                if (SERVER_CONFIG.ui_autosave_storage_key) AUTOSAVE.STORAGE_KEY = SERVER_CONFIG.ui_autosave_storage_key;
                if (SERVER_CONFIG.ui_autosave_session_name) AUTOSAVE.SESSION_NAME = SERVER_CONFIG.ui_autosave_session_name;
                if (SERVER_CONFIG.ui_autosave_show_in_list !== null) AUTOSAVE.SHOW_IN_LIST = SERVER_CONFIG.ui_autosave_show_in_list;
                if (SERVER_CONFIG.ui_autosave_auto_restore !== null) AUTOSAVE.AUTO_RESTORE = SERVER_CONFIG.ui_autosave_auto_restore;
                
                // Override StringDB settings if provided
                if (SERVER_CONFIG.integrations && SERVER_CONFIG.integrations.string_db) {
                    const stringDbConfig = SERVER_CONFIG.integrations.string_db;
                    if (stringDbConfig.base_url) STRING_DB.BASE_URL = stringDbConfig.base_url;
                    if (stringDbConfig.version) STRING_DB.VERSION = stringDbConfig.version;
                }
                
                console.log('Loaded server configuration:', SERVER_CONFIG);
            } else {
                console.error('Failed to load server configuration:', response.statusText);
            }
        } catch (error) {
            console.error('Error loading server configuration:', error);
        }
    }
    
    // Load server config on module initialization
    loadServerConfig();
    
    return {
        API,
        DEFAULTS,
        CACHE,
        AUTOSAVE,
        STRING_DB,
        PANEL_TYPES,
        KEYBOARD_SHORTCUTS,
        SERVER_CONFIG
    };
})();

// Export the module
export { Config };