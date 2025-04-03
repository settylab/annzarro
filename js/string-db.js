/**
 * StringDB - Provides integration with the STRING database for gene/protein interaction networks
 * This class is responsible for:
 * 1. Generating URLs for the STRING database
 * 2. Fetching and parsing data from the STRING API
 * 3. Creating visualizations for gene interactions and enrichment
 */

class StringDB {
    constructor() {
        // Base URLs for STRING
        this.baseWebUrl = 'https://string-db.org/cgi';
        this.baseApiUrl = 'https://string-db.org/api';
        
        // Request caching
        this.cache = new Map();
        
        // Supported species mapping
        this.speciesMapping = {
            9606: 'Homo sapiens',
            10090: 'Mus musculus',
            10116: 'Rattus norvegicus',
            7227: 'Drosophila melanogaster',
            6239: 'Caenorhabditis elegans',
            4932: 'Saccharomyces cerevisiae',
            3702: 'Arabidopsis thaliana'
        };
    }

    /**
     * Generate a URL for the STRING network visualization
     * @param {Array<string>} genes - Gene symbols to include
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @param {Object} options - Additional options for the URL
     * @returns {string} STRING network URL
     */
    getNetworkUrl(genes, speciesId = 9606, options = {}) {
        const baseOptions = {
            identifiers: genes.join('%0d'),
            species: speciesId,
            network_flavor: options.networkFlavor || 'evidence',
            required_score: options.requiredScore || 400
        };
        
        // Add optional parameters
        if (options.additionalNodes) {
            baseOptions.add_white_nodes = options.additionalNodes;
        }
        
        // Build the URL
        const url = new URL(`${this.baseWebUrl}/network.pl`);
        
        // Add parameters
        Object.entries(baseOptions).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
        
        return url.toString();
    }

    /**
     * Generate a URL for the STRING network image
     * @param {Array<string>} genes - Gene symbols to include
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @param {Object} options - Additional options for the URL
     * @returns {string} STRING network image URL
     */
    getNetworkImageUrl(genes, speciesId = 9606, options = {}) {
        const baseOptions = {
            identifiers: genes.join('%0d'),
            species: speciesId,
            network_flavor: options.networkFlavor || 'evidence',
            required_score: options.requiredScore || 400
        };
        
        // Add optional parameters
        if (options.additionalNodes) {
            baseOptions.add_white_nodes = options.additionalNodes;
        }
        
        // Build the URL
        const url = new URL(`${this.baseApiUrl}/image/network`);
        
        // Add parameters
        Object.entries(baseOptions).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
        
        return url.toString();
    }

    /**
     * Generate a URL for the STRING enrichment analysis
     * @param {Array<string>} genes - Gene symbols to include
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @returns {string} STRING enrichment URL
     */
    getEnrichmentUrl(genes, speciesId = 9606) {
        const url = new URL(`${this.baseWebUrl}/network.pl`);
        
        url.searchParams.append('identifiers', genes.join('%0d'));
        url.searchParams.append('species', speciesId);
        url.searchParams.append('caller_identity', 'annzarro');
        
        // Add anchor to go to enrichment section
        return `${url.toString()}#enrichment`;
    }

    /**
     * Generate a URL for a single gene in STRING
     * @param {string} gene - Gene symbol
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @returns {string} STRING gene URL
     */
    getGeneUrl(gene, speciesId = 9606) {
        return this.getNetworkUrl([gene], speciesId);
    }

    /**
     * Fetch functional enrichment data from STRING API
     * @param {Array<string>} genes - Gene symbols to include
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @param {string} category - Enrichment category
     * @returns {Promise<Array>} Enrichment results
     */
    async fetchEnrichment(genes, speciesId = 9606, category = 'Process') {
        try {
            // Generate cache key
            const cacheKey = `enrichment_${genes.join('_')}_${speciesId}_${category}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }
            
            // Create the URL
            const url = new URL(`${this.baseApiUrl}/json/enrichment`);
            
            // Prepare form data
            const formData = new FormData();
            formData.append('identifiers', genes.join('\n'));
            formData.append('species', speciesId);
            formData.append('caller_identity', 'annzarro');
            
            // Add category if specified
            const validCategories = ['Process', 'Component', 'Function', 'KEGG', 'Pfam', 'InterPro', 'SMART', 'Keywords', 'RCTM'];
            if (validCategories.includes(category)) {
                // For GO categories, STRING expects "GO Process" format
                if (['Process', 'Component', 'Function'].includes(category)) {
                    formData.append('enrichment_category', `GO ${category}`);
                } else {
                    formData.append('enrichment_category', category);
                }
            }
            
            // Fetch data
            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });
            
            // Parse response
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Cache the result
            this.cache.set(cacheKey, data);
            
            return data;
        } catch (error) {
            console.error('Error fetching enrichment data:', error);
            return [];
        }
    }

    /**
     * Get resource links for a gene
     * @param {string} gene - Gene symbol
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @returns {Object} Object with resource name -> URL mappings
     */
    getResourceLinks(gene, speciesId = 9606) {
        const encodedGene = encodeURIComponent(gene);
        const speciesName = this.speciesMapping[speciesId] || 'Unknown';
        
        const links = {
            'STRING DB': this.getGeneUrl(gene, speciesId),
            'BioGRID': `https://thebiogrid.org/search.php?search=${encodedGene}&organism=${encodeURIComponent(speciesName)}`,
            'Reactome': `https://reactome.org/content/query?q=${encodedGene}&species=${encodeURIComponent(speciesName)}&cluster=true`,
            'UniProt': `https://www.uniprot.org/uniprotkb?query=${encodedGene}+AND+organism_id:${speciesId}`
        };
        
        // Add species-specific resources
        if (speciesId === 9606) { // Human
            links['NCBI Gene'] = `https://www.ncbi.nlm.nih.gov/gene/?term=${encodedGene}+AND+human[orgn]`;
            links['OMIM'] = `https://www.omim.org/search?search=${encodedGene}`;
            links['GeneCards'] = `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodedGene}`;
            links['GTeX'] = `https://gtexportal.org/home/gene/${encodedGene}`;
        } else if (speciesId === 10090) { // Mouse
            links['NCBI Gene'] = `https://www.ncbi.nlm.nih.gov/gene/?term=${encodedGene}+AND+mouse[orgn]`;
            links['MGI'] = `https://www.informatics.jax.org/quicksearch/summary?queryType=exactPhrase&query=${encodedGene}`;
        } else if (speciesId === 10116) { // Rat
            links['NCBI Gene'] = `https://www.ncbi.nlm.nih.gov/gene/?term=${encodedGene}+AND+rat[orgn]`;
            links['RGD'] = `https://rgd.mcw.edu/rgdweb/search/search.html?term=${encodedGene}&speciesType=3`;
        }
        
        return links;
    }

    /**
     * Create HTML for a gene resource panel
     * @param {string} gene - Gene symbol
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @returns {string} HTML for the resource panel
     */
    createResourcePanel(gene, speciesId = 9606) {
        const links = this.getResourceLinks(gene, speciesId);
        
        // Create resource links HTML
        const linksHtml = Object.entries(links)
            .map(([name, url]) => `<a href="${url}" target="_blank" class="btn btn-sm btn-outline-primary m-1">${name}</a>`)
            .join('');
        
        // Create panel HTML
        return `
            <div class="card mt-3">
                <div class="card-header">
                    <h5 class="card-title mb-0">Resources for ${gene}</h5>
                </div>
                <div class="card-body">
                    <div class="d-flex flex-wrap">
                        ${linksHtml}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create HTML for a gene set network panel
     * @param {Array<string>} genes - Gene symbols
     * @param {number} speciesId - NCBI taxonomy ID (default: 9606 for human)
     * @returns {string} HTML for the network panel
     */
    createNetworkPanel(genes, speciesId = 9606) {
        const networkUrl = this.getNetworkUrl(genes, speciesId);
        const imageUrl = this.getNetworkImageUrl(genes, speciesId);
        const enrichmentUrl = this.getEnrichmentUrl(genes, speciesId);
        
        return `
            <div class="card mt-3">
                <div class="card-header">
                    <h5 class="card-title mb-0">STRING Protein Interaction Network</h5>
                </div>
                <div class="card-body">
                    <p class="card-text">Showing interactions for ${genes.length} genes</p>
                    <div class="text-center mb-3">
                        <a href="${networkUrl}" target="_blank">
                            <img src="${imageUrl}" alt="STRING network" class="img-fluid stringdb-network-image border">
                        </a>
                    </div>
                    <div class="d-flex justify-content-center">
                        <a href="${networkUrl}" target="_blank" class="btn btn-primary mx-1">View Interactive Network</a>
                        <a href="${enrichmentUrl}" target="_blank" class="btn btn-success mx-1">View Enrichment Analysis</a>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create HTML for an enrichment results panel
     * @param {Array<Object>} enrichmentData - Enrichment results from fetchEnrichment
     * @param {string} title - Panel title
     * @returns {string} HTML for the enrichment panel
     */
    createEnrichmentPanel(enrichmentData, title = 'Functional Enrichment') {
        if (!enrichmentData || enrichmentData.length === 0) {
            return `
                <div class="card mt-3">
                    <div class="card-header">
                        <h5 class="card-title mb-0">${title}</h5>
                    </div>
                    <div class="card-body">
                        <p class="card-text">No enrichment results found.</p>
                    </div>
                </div>
            `;
        }
        
        // Create table rows
        const rows = enrichmentData.slice(0, 20).map(item => {
            const term = item.term || '';
            const description = item.description || '';
            const fdr = item.fdr ? item.fdr.toExponential(2) : '';
            const geneCount = item.number_of_genes || '';
            const genes = item.inputGenes || '';
            
            return `
                <tr>
                    <td>${term}</td>
                    <td>${description}</td>
                    <td>${fdr}</td>
                    <td>${geneCount}</td>
                    <td>${Array.isArray(genes) ? genes.join(', ') : genes}</td>
                </tr>
            `;
        }).join('');
        
        return `
            <div class="card mt-3">
                <div class="card-header">
                    <h5 class="card-title mb-0">${title} (${enrichmentData.length} terms)</h5>
                </div>
                <div class="card-body">
                    <div class="table-responsive enrichment-results">
                        <table class="table table-striped">
                            <thead>
                                <tr>
                                    <th>Term</th>
                                    <th>Description</th>
                                    <th>FDR</th>
                                    <th>Genes</th>
                                    <th>Matching Genes</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                    ${enrichmentData.length > 20 ? `<p class="text-muted">Showing 20 of ${enrichmentData.length} results.</p>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Get the species name for a taxonomy ID
     * @param {number} speciesId - NCBI taxonomy ID
     * @returns {string} Species name or 'Unknown species'
     */
    getSpeciesName(speciesId) {
        return this.speciesMapping[speciesId] || 'Unknown species';
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    }
}

// Create and export a singleton instance
const stringDB = new StringDB();