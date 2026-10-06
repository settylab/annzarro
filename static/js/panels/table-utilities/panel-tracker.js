/**
 * Panel Tracker module for table panels
 * 
 * Provides utilities to track fixed entities in other panels
 * for use in column selection in table panels
 */
import { PanelManager } from '../../panel-manager.js';
import { DataManager } from '../../data-manager.js';
import { layerKeys } from '../../utils/structure-keys.js';

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
 * The matrix names of an obsp/varp section of /data/dataset_structure.
 *
 * The server sends them as a list (`keys`, process_file.py get_keys); an
 * older shape had a `matrices` object keyed by name. The varp code iterated
 * Object.keys() of the list, so a gene table offered "0: Focused Gene",
 * "1: Focused Gene" instead of the varp names, and a restored column
 * {type: 'varp', key: 'spearman_fold_change'} matched nothing and was
 * silently dropped. Both shapes give names here.
 * @param {{keys?: string[]|Object, matrices?: string[]|Object}|undefined} section
 * @returns {string[]}
 */
export function pairwiseKeys(section) {
    const keys = section?.matrices ? section.matrices : section?.keys;
    if (!keys) return [];
    return Array.isArray(keys) ? keys : Object.keys(keys);
}

const PLACEHOLDERS = {
    cell: new Set(['focused_cell', '_focused_cell']),
    gene: new Set(['focused_gene', '_focused_gene'])
};

/**
 * Column choices for one pairwise source (obsp/varp rows, layer rows or
 * columns): every matrix crossed with every entity the table could name.
 *
 * Choosing the focused entity stores its NAME (`column: 'S100a9'`), not a
 * placeholder. Issue #9: a column added from the focus used to follow it, so
 * every focus change reloaded the table, re-ran filters on that column and
 * cascaded into the plots filtered by the table; the "Selected Columns" list
 * could only call it "focused". A table needs the entity, not whether it is
 * focused right now.
 *
 * Offered, once per entity: the focused one, every one locked in a plot
 * (all of them, from any panel), and every one this table already holds, so
 * a column added from an earlier focus stays listed and can be removed.
 * A placeholder column from an older session is pinned to a name when its
 * panel is made (table-data.js pinFocusPlaceholders); one that is not names
 * no entity, never the focus, and is listed so it can be removed.
 *
 * @param {Object} options
 * @param {string} options.type - 'obsp' | 'varp' | 'layer'
 * @param {string[]} options.keys - Matrix (or layer) names
 * @param {Array<{name: string, source: string, panelTitle?: string, panelId?: string}>} options.entities
 *     Focused entity first, then locked ones, deduplicated
 * @param {'cell'|'gene'} options.kind - What the entities are
 * @param {Array<Object>} [options.selected] - The table's current columns
 * @returns {Array<Object>} Checkbox items
 */
export function entityColumnItems({ type, keys, entities, kind, selected = [] }) {
    const items = [];
    const seen = new Set();
    const add = (item) => {
        const id = `${item.key}\u0000${item.column}`;
        if (seen.has(id)) return;
        seen.add(id);
        items.push(item);
    };
    for (const entity of entities) {
        for (const key of keys) {
            const note = entity.source === 'focused' ? 'focused'
                : `fixed in ${entity.panelTitle}`;
            add({
                type, key, column: entity.name,
                label: `${key}: ${entity.name} (${note})`,
                source: entity.source,
                ...(entity.panelId ? { panelId: entity.panelId } : {})
            });
        }
    }
    for (const col of selected || []) {
        if (!col || col.type !== type || !keys.includes(col.key) || !col.column) continue;
        if (PLACEHOLDERS[kind].has(col.column)) {
            add({
                type, key: col.key, column: col.column,
                label: `${col.key}: no ${kind} (unresolved placeholder)`,
                source: 'table'
            });
        } else {
            add({
                type, key: col.key, column: col.column,
                label: `${col.key}: ${col.column} (in this table)`,
                source: 'table'
            });
        }
    }
    return items;
}

const cellEntities = () => getFixedCells().map(fc => ({ ...fc, name: fc.cell }));
const geneEntities = () => getFixedGenes().map(fg => ({ ...fg, name: fg.gene }));

/**
 * Get obsp matrices for cell table with fixed cells
 * @param {Object} datasetStructure - The dataset structure
 * @param {Array<Object>} [selected] - The table's current columns
 * @returns {Array<Object>} - Array of obsp items for column selection
 */
export function getObspColumnsForCellTable(datasetStructure, selected = []) {
    if (!datasetStructure?.obsp?.matrices && !datasetStructure?.obsp?.keys) return [];
    return entityColumnItems({
        type: 'obsp', keys: pairwiseKeys(datasetStructure.obsp),
        entities: cellEntities(), kind: 'cell', selected
    });
}

/**
 * Get varp matrices for gene table with fixed genes
 * @param {Object} datasetStructure - The dataset structure
 * @param {Array<Object>} [selected] - The table's current columns
 * @returns {Array<Object>} - Array of varp items for column selection
 */
export function getVarpColumnsForGeneTable(datasetStructure, selected = []) {
    if (!datasetStructure?.varp?.matrices && !datasetStructure?.varp?.keys) return [];
    return entityColumnItems({
        type: 'varp', keys: pairwiseKeys(datasetStructure.varp),
        entities: geneEntities(), kind: 'gene', selected
    });
}

/**
 * Get layer columns for cell table with fixed genes
 * @param {Object} datasetStructure - The dataset structure
 * @param {Array<Object>} [selected] - The table's current columns
 * @returns {Array<Object>} - Array of layer items for column selection
 */
export function getLayerColumnsForCellTable(datasetStructure, selected = []) {
    if (!datasetStructure?.layers && !datasetStructure?.X) return [];
    // X first, then the layers, as in the plot menus
    return entityColumnItems({
        type: 'layer', keys: layerKeys(datasetStructure),
        entities: geneEntities(), kind: 'gene', selected
    });
}

/**
 * Get layer columns for gene table with fixed cells
 * @param {Object} datasetStructure - The dataset structure
 * @param {Array<Object>} [selected] - The table's current columns
 * @returns {Array<Object>} - Array of layer items for column selection
 */
export function getLayerColumnsForGeneTable(datasetStructure, selected = []) {
    if (!datasetStructure?.layers && !datasetStructure?.X) return [];
    return entityColumnItems({
        type: 'layer', keys: layerKeys(datasetStructure),
        entities: cellEntities(), kind: 'cell', selected
    });
}
