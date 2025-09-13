/**
 * Panel Tracker module for table panels
 * 
 * Provides utilities to track fixed entities in other panels
 * for use in column selection in table panels
 */
import { PanelManager } from '../../panel-manager.js';
import { DataManager } from '../../data-manager.js';

/**
 * Get fixed cells from all active panels
 * @returns {Array<Object>} - Array of fixed cell objects with source info
 */
export function getFixedCells() {
    const fixedCells = [];
    const panels = PanelManager.getAllActivePanels();
    
    // Track unique cells to avoid duplicates
    const uniqueCells = new Set();
    
    // Get focused cell
    const focusedCell = DataManager.getFocusedCell();
    if (focusedCell) {
        fixedCells.push({
            cell: focusedCell,
            source: 'focused',
            panelId: null,
            panelTitle: 'Focused Cell'
        });
        uniqueCells.add(focusedCell);
    }
    
    // Process each panel to find fixed cells
    for (const panel of panels) {
        if (!panel) continue;
        
        const panelType = panel.getType();
        const panelId = panel.getId();
        const panelTitle = panel.getTitle();
        const panelConfig = panel.getConfig ? panel.getConfig() : null;
        
        if (!panelConfig) continue;
        
        // Check if panel has obsp data with locked cell
        if (panelType === 'cell-plot' && panelConfig.x?.type === 'obsp' && panelConfig.x?.locked) {
            const cell = panelConfig.x.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'obsp',
                    panelId,
                    panelTitle,
                    axis: 'x'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.y?.type === 'obsp' && panelConfig.y?.locked) {
            const cell = panelConfig.y.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'obsp',
                    panelId,
                    panelTitle,
                    axis: 'y'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.z?.type === 'obsp' && panelConfig.z?.locked) {
            const cell = panelConfig.z.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'obsp',
                    panelId,
                    panelTitle,
                    axis: 'z'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.color?.type === 'obsp' && panelConfig.color?.locked) {
            const cell = panelConfig.color.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'obsp',
                    panelId,
                    panelTitle,
                    axis: 'color'
                });
                uniqueCells.add(cell);
            }
        }
        
        // Check if panel has layer data with locked cell
        if (panelType === 'gene-plot' && panelConfig.x?.type === 'layer' && panelConfig.x?.locked) {
            const cell = panelConfig.x.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'x'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.y?.type === 'layer' && panelConfig.y?.locked) {
            const cell = panelConfig.y.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'y'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.z?.type === 'layer' && panelConfig.z?.locked) {
            const cell = panelConfig.z.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'z'
                });
                uniqueCells.add(cell);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.color?.type === 'layer' && panelConfig.color?.locked) {
            const cell = panelConfig.color.column;
            if (cell && !uniqueCells.has(cell)) {
                fixedCells.push({
                    cell,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'color'
                });
                uniqueCells.add(cell);
            }
        }
    }
    
    return fixedCells;
}

/**
 * Get fixed genes from all active panels
 * @returns {Array<Object>} - Array of fixed gene objects with source info
 */
export function getFixedGenes() {
    const fixedGenes = [];
    const panels = PanelManager.getAllActivePanels();
    
    // Track unique genes to avoid duplicates
    const uniqueGenes = new Set();
    
    // Get focused gene
    const focusedGene = DataManager.getFocusedGene();
    if (focusedGene) {
        fixedGenes.push({
            gene: focusedGene,
            source: 'focused',
            panelId: null,
            panelTitle: 'Focused Gene'
        });
        uniqueGenes.add(focusedGene);
    }
    
    // Process each panel to find fixed genes
    for (const panel of panels) {
        if (!panel) continue;
        
        const panelType = panel.getType();
        const panelId = panel.getId();
        const panelTitle = panel.getTitle();
        const panelConfig = panel.getConfig ? panel.getConfig() : null;
        
        if (!panelConfig) continue;
        
        // Check if panel has varp data with locked gene
        if (panelType === 'gene-plot' && panelConfig.x?.type === 'varp' && panelConfig.x?.locked) {
            const gene = panelConfig.x.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'varp',
                    panelId,
                    panelTitle,
                    axis: 'x'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.y?.type === 'varp' && panelConfig.y?.locked) {
            const gene = panelConfig.y.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'varp',
                    panelId,
                    panelTitle,
                    axis: 'y'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.z?.type === 'varp' && panelConfig.z?.locked) {
            const gene = panelConfig.z.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'varp',
                    panelId,
                    panelTitle,
                    axis: 'z'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'gene-plot' && panelConfig.color?.type === 'varp' && panelConfig.color?.locked) {
            const gene = panelConfig.color.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'varp',
                    panelId,
                    panelTitle,
                    axis: 'color'
                });
                uniqueGenes.add(gene);
            }
        }
        
        // Check if panel has layer data with locked gene
        if (panelType === 'cell-plot' && panelConfig.x?.type === 'layer' && panelConfig.x?.locked) {
            const gene = panelConfig.x.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'x'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.y?.type === 'layer' && panelConfig.y?.locked) {
            const gene = panelConfig.y.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'y'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.z?.type === 'layer' && panelConfig.z?.locked) {
            const gene = panelConfig.z.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'z'
                });
                uniqueGenes.add(gene);
            }
        }
        
        if (panelType === 'cell-plot' && panelConfig.color?.type === 'layer' && panelConfig.color?.locked) {
            const gene = panelConfig.color.column;
            if (gene && !uniqueGenes.has(gene)) {
                fixedGenes.push({
                    gene,
                    source: 'layer',
                    panelId,
                    panelTitle,
                    axis: 'color'
                });
                uniqueGenes.add(gene);
            }
        }
    }
    
    return fixedGenes;
}

/**
 * Get obsp matrices for cell table with fixed cells
 * @param {Object} datasetStructure - The dataset structure
 * @returns {Array<Object>} - Array of obsp items for column selection
 */
export function getObspColumnsForCellTable(datasetStructure) {
    if (!datasetStructure?.obsp?.matrices && !datasetStructure?.obsp?.keys) return [];
    
    const items = [];
    const fixedCells = getFixedCells();
    
    // Add the focused cell entry for each obsp matrix
    const focusedCell = fixedCells.find(fc => fc.source === 'focused');
    if (focusedCell) {
        const keys = datasetStructure?.obsp?.matrices ? datasetStructure.obsp.matrices : datasetStructure.obsp.keys;
        for (const key of keys) {
            items.push({
                type: 'obsp',
                key,
                column: 'focused_cell',
                label: `${key}: Focused Cell (${focusedCell.cell})`,
                source: 'focused'
            });
        }
    }
    
    // Add fixed cells from other panels
    for (const fixedCell of fixedCells) {
        if (fixedCell.source === 'focused') continue; // Skip focused cell, already added

        const keys = datasetStructure?.obsp?.matrices ? datasetStructure.obsp.matrices : datasetStructure.obsp.keys;
        for (const key of keys) {
            items.push({
                type: 'obsp',
                key,
                column: fixedCell.cell,
                label: `${key}: ${fixedCell.cell} (Fixed in ${fixedCell.panelTitle})`,
                source: fixedCell.source,
                panelId: fixedCell.panelId
            });
        }
    }
    
    return items;
}

/**
 * Get varp matrices for gene table with fixed genes
 * @param {Object} datasetStructure - The dataset structure
 * @returns {Array<Object>} - Array of varp items for column selection
 */
export function getVarpColumnsForGeneTable(datasetStructure) {
    if (!datasetStructure?.varp?.matrices && !datasetStructure?.varp?.keys) return [];
    
    const items = [];
    const fixedGenes = getFixedGenes();
    
    // Add the focused gene entry for each varp matrix
    const focusedGene = fixedGenes.find(fg => fg.source === 'focused');
    if (focusedGene) {
        const keys = datasetStructure?.varp?.matrices ? datasetStructure.varp.matrices : datasetStructure.varp.keys;
        for (const key of Object.keys(keys)) {
            items.push({
                type: 'varp',
                key,
                column: 'focused_gene',
                label: `${key}: Focused Gene (${focusedGene.gene})`,
                source: 'focused'
            });
        }
    }
    
    // Add fixed genes from other panels
    for (const fixedGene of fixedGenes) {
        if (fixedGene.source === 'focused') continue; // Skip focused gene, already added
        
        const keys = datasetStructure?.varp?.matrices ? datasetStructure.varp.matrices : datasetStructure.varp.keys;
        for (const key of Object.keys(keys)) {
            items.push({
                type: 'varp',
                key,
                column: fixedGene.gene,
                label: `${key}: ${fixedGene.gene} (Fixed in ${fixedGene.panelTitle})`,
                source: fixedGene.source,
                panelId: fixedGene.panelId
            });
        }
    }
    
    return items;
}

/**
 * Get layer columns for cell table with fixed genes
 * @param {Object} datasetStructure - The dataset structure
 * @returns {Array<Object>} - Array of layer items for column selection
 */
export function getLayerColumnsForCellTable(datasetStructure) {
    if (!datasetStructure?.layers) return [];
    
    const items = [];
    const fixedGenes = getFixedGenes();
    
    // Make sure layers is an array
    const layersArray = Array.isArray(datasetStructure.layers.keys) ? 
        datasetStructure.layers.keys : 
        (typeof datasetStructure.layers.keys === 'object' ? 
            Object.keys(datasetStructure.layers.keys) : 
            []);
    
    // Add the focused gene entry for each layer
    const focusedGene = fixedGenes.find(fg => fg.source === 'focused');
    if (focusedGene) {
        for (const layer of layersArray) {
            //May delete the focused gene part.
            items.push({
                type: 'layer',
                key: layer,
                column: 'focused_gene',
                label: `${layer}: Focused Gene`,
                source: 'focused'
            });
        }
    }
    
    // Add fixed genes from other panels
    for (const fixedGene of fixedGenes) {
        if (fixedGene.source === 'focused') continue; // Skip focused gene, already added
        
        for (const layer of layersArray) {
            items.push({
                type: 'layer',
                key: layer,
                column: fixedGene.gene,
                label: `${layer}: ${fixedGene.gene} (Fixed in ${fixedGene.panelTitle})`,
                source: fixedGene.source,
                panelId: fixedGene.panelId
            });
        }
    }
    
    return items;
}

/**
 * Get layer columns for gene table with fixed cells
 * @param {Object} datasetStructure - The dataset structure
 * @returns {Array<Object>} - Array of layer items for column selection
 */
export function getLayerColumnsForGeneTable(datasetStructure) {
    if (!datasetStructure?.layers) return [];
    
    const items = [];
    const fixedCells = getFixedCells();
    
    // Make sure layers is an array
    const layersArray = Array.isArray(datasetStructure.layers.keys) ? 
        datasetStructure.layers.keys : 
        (typeof datasetStructure.layers.keys === 'object' ? 
            Object.keys(datasetStructure.layers.keys) : 
            []);
    
    // Add the focused cell entry for each layer
    const focusedCell = fixedCells.find(fc => fc.source === 'focused');
    if (focusedCell) {
        for (const layer of layersArray) {
            items.push({
                type: 'layer',
                key: layer,
                column: 'focused_cell',
                label: `${layer}: Focused Cell`,
                source: 'focused'
            });
        }
    }
    
    // Add fixed cells from other panels
    for (const fixedCell of fixedCells) {
        if (fixedCell.source === 'focused') continue; // Skip focused cell, already added
        
        for (const layer of layersArray) {
            items.push({
                type: 'layer',
                key: layer,
                column: fixedCell.cell,
                label: `${layer}: ${fixedCell.cell} (Fixed in ${fixedCell.panelTitle})`,
                source: fixedCell.source,
                panelId: fixedCell.panelId
            });
        }
    }
    
    return items;
}