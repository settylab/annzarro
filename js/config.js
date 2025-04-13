/**
 * Configuration module for AnnZarro
 */
const Config = (function() {
    // API endpoints
    const API_BASE = '/api/v1';
    
    const API = {
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
        SESSION_NAME: 'Autosave' // Default name for autosaved sessions
    };
    
    // For StringDB API
    const STRING_DB = {
        BASE_URL: 'https://string-db.org/api',
        VERSION: '11.5',
        NETWORK_IMAGE_URL: 'https://string-db.org/api/svg/network',
        INTERACTION_URL: 'https://string-db.org/api/json/interaction_partners',
        ENRICHMENT_URL: 'https://string-db.org/api/json/enrichment'
    };
    
    return {
        API,
        DEFAULTS,
        CACHE,
        AUTOSAVE,
        STRING_DB,
        PANEL_TYPES
    };
})();

// Export the module
export { Config };