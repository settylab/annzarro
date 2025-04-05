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
        UNS: `${API_BASE}/datasets/uns`,
        SESSIONS_LIST: `${API_BASE}/sessions/list`,
        SESSIONS_SAVE: `${API_BASE}/sessions/save`,
        SESSIONS_LOAD: `${API_BASE}/sessions/load`,
        SESSIONS_DELETE: `${API_BASE}/sessions/delete`,
        SESSIONS_EXPORT: `${API_BASE}/sessions/export`,
        SESSIONS_IMPORT: `${API_BASE}/sessions/import`
    };
    
    // Default settings
    const DEFAULTS = {
        MAX_CELLS: 10000,
        MAX_GENES: 10000,
        POINT_SIZE: 5,
        POINT_OPACITY: 0.7,
        COLOR_SCALE: 'Viridis',
        COLOR_SCALES: [
            'Viridis', 'Plasma', 'Inferno', 'Magma', 'Cividis',
            'Greys', 'Blues', 'Greens', 'Reds', 'Purples', 'Oranges'
        ],
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
        STRING_DB
    };
})();

// Make available for both browser global and CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Config;
} else {
    window.Config = Config;
}