/**
 * Configuration module for AnnZarro
 */
import { appUrl } from './utils/app-url.js';

/**
 * The ui.* settings in /api/v1/config, nested (ui: {defaults, cache,
 * autosave, enabled_panel_types}, what the server sends) or flat (ui_max_cells,
 * ui_autosave_enabled, ... from older servers). Nested wins. Unset values are
 * null; booleans stay booleans, so false is a setting, not "unset".
 * @param {Object} server - the parsed /api/v1/config response
 * @returns {Object}
 */
export function readUiSettings(server) {
    const cfg = server || {};
    const ui = cfg.ui && typeof cfg.ui === 'object' ? cfg.ui : {};
    const d = ui.defaults || {}, c = ui.cache || {}, a = ui.autosave || {};
    const pick = (nested, flat) => (nested !== undefined && nested !== null ? nested
        : (cfg[flat] !== undefined && cfg[flat] !== null ? cfg[flat] : null));
    return {
        maxCells: pick(d.max_cells, 'ui_max_cells'),
        maxGenes: pick(d.max_genes, 'ui_max_genes'),
        pointSize: pick(d.point_size, 'ui_point_size'),
        pointOpacity: pick(d.point_opacity, 'ui_point_opacity'),
        colorScale: pick(d.color_scale, 'ui_color_scale'),
        taxonomyId: pick(d.taxonomy_id, 'ui_taxonomy_id'),
        largePlotPoints: pick(d.large_plot_points, 'ui_large_plot_points'),
        namesOnDemandAbove: pick(d.names_on_demand_above, 'ui_names_on_demand_above'),
        enabledPanelTypes: pick(ui.enabled_panel_types, 'enabled_panel_types'),
        cacheMaxEntries: pick(c.max_entries, 'ui_cache_max_entries'),
        cacheMaxSizeMb: pick(c.max_size_mb, 'ui_cache_max_size_mb'),
        autosaveEnabled: pick(a.enabled, 'ui_autosave_enabled'),
        autosaveIntervalMs: pick(a.interval_ms, 'ui_autosave_interval_ms'),
        autosaveStorageKey: pick(a.storage_key, 'ui_autosave_storage_key'),
        autosaveSessionName: pick(a.session_name, 'ui_autosave_session_name'),
        autosaveShowInList: pick(a.show_in_list, 'ui_autosave_show_in_list'),
        autosaveAutoRestore: pick(a.auto_restore, 'ui_autosave_auto_restore'),
        // the browser memory guard's settings, as sent (utils/memory-guard.js memorySettings checks them)
        memory: ui.memory && typeof ui.memory === 'object' ? ui.memory : null
    };
}
/**
 * The integrations.* settings in /api/v1/config, for the Gene Set Analysis
 * panel's external services:
 *   external_requests  ask | on | off: whether the panel may send gene ids to
 *                      services, asking first (ask, the default), without
 *                      asking, or never. YAML reads a bare off/on as a
 *                      boolean, so false and true mean off and on; anything
 *                      else unknown means ask.
 *   gene_set.services  adapter ids or service names allowed (null: all)
 *   gene_set.timeout_ms  per request attempt
 *   string_db          base_url and version of the STRING API
 * @param {Object} server - the parsed /api/v1/config response
 * @returns {{externalRequests: 'ask'|'on'|'off', services: string[]|null, timeoutMs: number,
 *   stringDb: {baseUrl: string|null, version: string|null}}}
 */
export function readIntegrations(server) {
    const cfg = server && server.integrations && typeof server.integrations === 'object' ? server.integrations : {};
    let ext = cfg.external_requests;
    if (ext === false) ext = 'off';
    else if (ext === true) ext = 'on';
    ext = typeof ext === 'string' ? ext.trim().toLowerCase() : 'ask';
    if (!['ask', 'on', 'off'].includes(ext)) ext = 'ask';
    const gs = cfg.gene_set && typeof cfg.gene_set === 'object' ? cfg.gene_set : {};
    const services = Array.isArray(gs.services) ? gs.services.filter(x => typeof x === 'string') : null;
    const t = Number(gs.timeout_ms);
    const sdb = cfg.string_db && typeof cfg.string_db === 'object' ? cfg.string_db : {};
    return {
        externalRequests: ext,
        services,
        timeoutMs: Number.isFinite(t) && t > 0 ? t : 20000,
        stringDb: {
            baseUrl: typeof sdb.base_url === 'string' && sdb.base_url.startsWith('https://') ? sdb.base_url : null,
            version: sdb.version !== undefined && sdb.version !== null ? String(sdb.version) : null
        }
    };
}

const Config = (function() {
    // API endpoints, under the path the app is mounted at (see utils/app-url.js)
    const API_BASE = appUrl('/api/v1');
    
    const API = {
        CONFIG: `${API_BASE}/config`,
        DATASETS: `${API_BASE}/datasets`,
        DATASET_INFO: `${API_BASE}/data/info`,
        DATASET_STRUCTURE: `${API_BASE}/data/dataset_structure`,
        FINGERPRINT: `${API_BASE}/data/fingerprint`,
        CELLS: `${API_BASE}/data/cells`,
        GENES: `${API_BASE}/data/genes`,
        NAMES: `${API_BASE}/data/names`,
        SUBSET: `${API_BASE}/data/subset`,
        SUBSET_LOCATE: `${API_BASE}/data/subset/locate`,
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
        CACHE_RESET: `${API_BASE}/cache/reset`,
        DATA_REFRESH: `${API_BASE}/data/refresh`,
        SESSIONS_LIST: `${API_BASE}/sessions/list`,
        SESSIONS_SAVE: `${API_BASE}/sessions/save`,
        SESSIONS_LOAD: `${API_BASE}/sessions/load`,
        SESSIONS_DELETE: `${API_BASE}/sessions/delete`,
        SESSIONS_EXPORT: `${API_BASE}/sessions/export`,
        SESSIONS_IMPORT: `${API_BASE}/sessions/import`,
        AUTH_ME: `${API_BASE}/auth/me`
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
        // A Cell Plot with more points than this uses the large-plot mode
        // (panels/plot-utilities/large-plot.js): no hover, click or table
        // filter. The regular path costs 400-900 B of the tab's V8 heap per
        // point (one plot of 5M categorical points fits, a few do not); 1M
        // keeps several regular plots open at once. Server key
        // ui.defaults.large_plot_points.
        LARGE_PLOT_POINTS: 1000000,
        // A dataset with more cells than this does not download the names of
        // the cells it shows, whatever the subset: a part or subset of cells
        // spread over such a dataset touches nearly every chunk of its name
        // column (the 100,000 cells of one part of a 1B-cell store: 477 chunk
        // reads, 20-35 s at every part step), while hover, focus and a table's
        // page need a few names. Below it a part's names are a few chunks (a
        // 5M-cell store has 5) and come with the part. Server key
        // ui.defaults.names_on_demand_above.
        NAMES_ON_DEMAND_ABOVE: 5000000,
        // Browser memory guard, server ui.memory (utils/memory-guard.js)
        MEMORY: null,
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
            '7955': 'Danio rerio',
            '559292': 'Saccharomyces cerevisiae S288C',
            '3702': 'Arabidopsis thaliana',
            '8364': 'Xenopus tropicalis',
            '9823': 'Sus scrofa',
            '9544': 'Macaca mulatta',
            '9031': 'Gallus gallus'
        },
        // Enable/disable specific panel types in the selection tile
        ENABLED_PANEL_TYPES: ['cell-plot', 'gene-plot', 'cell-table', 'gene-table', 'gene-set'],
        
        // Plot aesthetics defaults
        PLOT_AESTHETICS: {
            // Grid settings
            SHOW_GRID: true,
            
            // Axes settings
            SHOW_AXIS_TITLES: true,
            SHOW_AXIS_LABELS: true,
            SHOW_AXIS_LINES: true,
            SHOW_ZERO_LINES: false,
            
            // Default colors (light theme)
            BG_COLOR: '#ffffff',
            GRID_COLOR: '#e6e6e6',
            AXIS_COLOR: '#000000',
            TEXT_COLOR: '#000000',
            ZERO_LINE_COLOR: '#cccccc',
            BACKDROP_COLOR: '#f0f0f0', // 3D backdrop color
            
            // 3D backdrop settings
            SHOW_BACKDROP: false, // Hidden by default
            
            // Line width settings
            AXIS_LINE_WIDTH: 1,
            GRID_LINE_WIDTH: 1,
            ZERO_LINE_WIDTH: 1,
            
            // Dark theme colors (for application via button)
            DARK_THEME: {
                BG_COLOR: '#1e1e1e',
                GRID_COLOR: '#444444',
                AXIS_COLOR: '#ffffff',
                TEXT_COLOR: '#ffffff',
                ZERO_LINE_COLOR: '#666666',
                BACKDROP_COLOR: '#121212' // 3D backdrop color for dark theme
            },
            
            // Fonts
            FONT_SIZE: 12,
            FONT_FAMILY: 'Arial, Helvetica, sans-serif',
            
            // Margins
            MARGINS: { l: 80, r: 80, t: 80, b: 60, pad: 4 },
            
            // Legend settings
            SHOW_LEGEND: true,
            LEGEND_POSITION: 'right',
            
            // Export options
            EXPORT_WIDTH: 1200,
            EXPORT_HEIGHT: 800,
            SCALE_EXPORT: false,
            
            // Interaction settings
            ENABLE_ZOOM: true,
            ENABLE_PAN: true,
            SHOW_HOVER_INFO: true
        }
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
    
    // For StringDB API: a versioned host, so a result can be reproduced
    // and says which STRING made it (server key integrations.string_db)
    const STRING_DB = {
        BASE_URL: 'https://version-12-5.string-db.org/api',
        VERSION: '12.5'
    };

    // The Gene Set Analysis panel's external services (readIntegrations)
    const INTEGRATIONS = readIntegrations(null);
    
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
        
        // Environment settings
        local_mode: false,
        // one user on this machine (server: core/remote.py hosted_reasons)
        single_user: false,
        
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
                
                // Apply the server's ui.* settings. The server sends them
                // nested (ui: {defaults, cache, autosave, enabled_panel_types},
                // as in config/base.yaml); this read only flat ui_* keys, so
                // every ui setting was ignored. readUiSettings takes either.
                const ui = readUiSettings(SERVER_CONFIG);
                if (ui.maxCells) DEFAULTS.MAX_CELLS = ui.maxCells;
                if (ui.maxGenes) DEFAULTS.MAX_GENES = ui.maxGenes;
                if (ui.pointSize) DEFAULTS.POINT_SIZE = ui.pointSize;
                if (ui.pointOpacity) DEFAULTS.POINT_OPACITY = ui.pointOpacity;
                if (ui.colorScale) DEFAULTS.COLOR_SCALE = ui.colorScale;
                if (ui.taxonomyId) DEFAULTS.TAXONOMY_ID = ui.taxonomyId;
                if (ui.largePlotPoints !== null && ui.largePlotPoints >= 0) {
                    DEFAULTS.LARGE_PLOT_POINTS = Number(ui.largePlotPoints);
                }
                if (ui.namesOnDemandAbove !== null && ui.namesOnDemandAbove >= 0) {
                    DEFAULTS.NAMES_ON_DEMAND_ABOVE = Number(ui.namesOnDemandAbove);
                }
                if (ui.enabledPanelTypes) DEFAULTS.ENABLED_PANEL_TYPES = ui.enabledPanelTypes;
                if (ui.cacheMaxEntries) CACHE.MAX_ENTRIES = ui.cacheMaxEntries;
                if (ui.cacheMaxSizeMb) CACHE.MAX_SIZE_BYTES = ui.cacheMaxSizeMb * 1024 * 1024;
                if (ui.autosaveEnabled !== null) AUTOSAVE.ENABLED = ui.autosaveEnabled;
                if (ui.autosaveIntervalMs) AUTOSAVE.INTERVAL = ui.autosaveIntervalMs;
                if (ui.autosaveStorageKey) AUTOSAVE.STORAGE_KEY = ui.autosaveStorageKey;
                if (ui.autosaveSessionName) AUTOSAVE.SESSION_NAME = ui.autosaveSessionName;
                if (ui.autosaveShowInList !== null) AUTOSAVE.SHOW_IN_LIST = ui.autosaveShowInList;
                if (ui.autosaveAutoRestore !== null) AUTOSAVE.AUTO_RESTORE = ui.autosaveAutoRestore;
                if (ui.memory) DEFAULTS.MEMORY = ui.memory;

                // External services (the gene set panel), StringDB's address
                Object.assign(INTEGRATIONS, readIntegrations(SERVER_CONFIG));
                if (INTEGRATIONS.stringDb.baseUrl) STRING_DB.BASE_URL = INTEGRATIONS.stringDb.baseUrl;
                if (INTEGRATIONS.stringDb.version) STRING_DB.VERSION = INTEGRATIONS.stringDb.version;
                
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
        INTEGRATIONS,
        PANEL_TYPES,
        KEYBOARD_SHORTCUTS,
        SERVER_CONFIG
    };
})();

// Export the module
export { Config };