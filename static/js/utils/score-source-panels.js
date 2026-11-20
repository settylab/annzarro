/**
 * The panels that are sources of a gene score, as the score machinery sees them (design 3.3a).
 *
 * A gene SIGNATURE and a gene TABLE are one kind of source: a set of genes plus how to score them. They differ
 * only in how the genes are chosen. A signature's genes are handpicked and are its recipe. A table's genes are the
 * rows that pass its filter, read through the selection every reader of a table uses (`readTableSelection`: an open
 * table's `currentEntries`, a closed table's frozen `closedSelection`), so a table is scored from the same rows
 * that Gene Set Analysis and a Gene Plot's filter read.
 *
 * This module is the one place where the difference lives. `createSourceAdapter` answers, for a panel id:
 *
 *   title      the panel's title
 *   kind       'signature' | 'table'
 *   recipe()   the recipe now: the genes, and the option fields (utils/signature-options.js: one schema)
 *   options()  the option fields alone (what is offered, and how it is scored), without reading the genes
 *   gate()     null when the genes can be read; else why not yet: the table is opening, being built in the
 *              background (utils/table-resolver.js), waits for a click, is refused or failed, or is part of a cycle
 *   actions    what the notices' buttons do to a gate (build now, cancel, retry)
 *
 * Pure (no DOM, no page state): the page supplies the panels, the dataset's gene names and the table resolver, so
 * Node tests cover every state with fakes.
 */
import { readTableSelection, tableSelectionStatus } from '../panels/gene-set-utilities/state.js';
import { normalizeRecipe } from './gene-signature.js';
import { normalizeOptions, pickOptions } from './signature-options.js';

export const SIGNATURE_TYPE = 'gene-signature';
export const TABLE_TYPE = 'gene-table';
/** The panel types that are sources of a gene score. */
export const SOURCE_TYPES = Object.freeze([SIGNATURE_TYPE, TABLE_TYPE]);

export const isSourceType = (type) => SOURCE_TYPES.includes(type);
export const kindOfType = (type) => (type === TABLE_TYPE ? 'table' : 'signature');

/**
 * Whether a panel's configuration reads the score of source `id`: an axis, the colour or a hover entry of a plot, or a
 * score column of a table. Only those keys are read (a table's config has lazy views of its rows that must not be
 * touched). The dependants of a gene table that is closed are the panels for which this is true.
 * @param {Object|null} config
 * @param {string} id
 */
export function readsScoreOf(config, id) {
    if (!config || !id) return false;
    const hit = (s) => !!s && s.type === 'gene-score' && s.key === id;
    for (const axis of ['x', 'y', 'z', 'color']) if (hit(config[axis])) return true;
    if (Array.isArray(config.hoverInfo) && config.hoverInfo.some(hit)) return true;
    return Array.isArray(config.columns) && config.columns.some(hit);
}

/** A source's name where signatures and tables share one list with no heading (a hover picker): a table says so. */
export const entityLabel = (entity) => (entity.kind === 'table' ? `${entity.title} (table)` : entity.title);

/**
 * The sources of a key menu: signatures and gene tables, told apart. With only one kind there is no heading; with both,
 * each kind has its own group, so a user can tell a handpicked list from a filtered table.
 * @param {Array<{id: string, title: string, kind?: string}>} entities
 * @returns {Array<{value: string, text: string, group?: string}>}
 */
export function scoreKeyOptions(entities) {
    const kinds = new Set(entities.map(e => e.kind || 'signature'));
    return entities.map(e => ({ value: e.id, text: e.title, ...(kinds.size > 1 ? { group: KIND_HEADING[e.kind || 'signature'] } : {}) }));
}

/** The word for a source's kind, as a heading in a menu. */
export const KIND_HEADING = Object.freeze({ signature: 'Gene signatures', table: 'Gene tables' });

/**
 * The options a table panel stores, as the recipe's option fields. A table that never set any has the defaults.
 * @param {{getScoreOptions?: Function}} panel
 */
export function optionsOf(panel) {
    return normalizeOptions(typeof panel.getScoreOptions === 'function' ? panel.getScoreOptions() : {});
}

/**
 * The option fields (input, method, offered, layers, clip...) of any source panel: a signature's recipe has them, a
 * gene table keeps them apart from its genes. What a menu, a label or a notice reads of a source is only these.
 * @param {Object} panel - a source panel
 * @returns {Object}
 */
export function optionFieldsOf(panel) {
    if (typeof panel.getScoreOptions === 'function') return optionsOf(panel);
    return typeof panel.getRecipe === 'function' ? panel.getRecipe() : normalizeOptions({});
}

/**
 * The recipe of a gene table now: its passing genes and its option fields.
 * @param {Object} panel - a gene table
 * @param {{open: boolean, geneNames: ArrayLike<string>}} ctx
 * @returns {Object} a recipe (utils/gene-signature.js)
 */
export function tableRecipe(panel, ctx) {
    const selection = readTableSelection(panel, ctx);
    return normalizeRecipe({ ...pickOptions(optionsOf(panel)), genes: selection.names || [] }).recipe;
}

/**
 * A table resolver status as the state of a score that waits for it.
 * @param {{state: string, reason?: string, detail?: string, cycle?: string[], rows?: number, frozen?: boolean}} status
 * @returns {{state: string, message?: string, gate: Object}}
 *   `state` is one a snapshot has: building, ask, refused, failed or cycle
 */
export function gateState(status) {
    const gate = { ...status };
    switch (status.state) {
        case 'ask': return { state: 'ask', gate };
        case 'refused':
            return { state: 'refused', gate, message: status.reason === 'memory'
                ? `Not enough browser memory to build the table.${status.detail ? ` ${status.detail}` : ''}`
                : `The table is too large to build here${status.rows ? ` (${Number(status.rows).toLocaleString('en-US')} rows)` : ''}. Open it to score its genes.` };
        case 'failed': return { state: 'failed', gate, message: status.reason || 'the table could not be built' };
        case 'cycle': return { state: 'cycle', gate, cycle: status.cycle || [] };
        default: return { state: 'building', gate };      // waiting, building, opening, idle
    }
}

/**
 * @param {Object} host
 * @param {(id: string) => (Object|null)} host.panel - the page's panel by id
 * @param {(panel: Object) => boolean} host.active - the panel is open
 * @param {() => ArrayLike<string>} host.geneNames - the dataset's genes, in row order
 * @param {() => boolean} [host.off] - gene scores are turned off here
 * @param {(recipe: Object, sub: string, layer: string) => boolean} [host.offers] - the source still offers this option
 * @param {Object} [host.resolver] - the table resolver: `need(id, dependant)`, `accept(id)`, `cancel(id)`, `retry(id)`,
 *   `cycleOf(id)` (the ids on a cycle through the table, or null)
 */
export function createSourceAdapter({ panel, active, geneNames, off = () => false, offers = null, resolver = null }) {
    const titleOf = (id) => {
        const p = panel(id);
        return p && typeof p.getTitle === 'function' ? p.getTitle() : id;
    };

    function tableGate(p, dependant) {
        const id = p.getId();
        const cycle = resolver && resolver.cycleOf ? resolver.cycleOf(id) : null;
        if (cycle) return gateState({ state: 'cycle', cycle: cycle.map(titleOf) });
        // only whether the rows can be read: a gate is asked on every read of a dependant, the rows when they change
        const rows = tableSelectionStatus(p, { open: active(p) }).status;
        if (rows === 'waiting') return gateState({ state: 'waiting', reason: 'opening' });
        if (rows === 'open' || rows === 'closed') return null;
        // a closed table with no rows kept (restored from a link or a panel set, or built for other cells): the
        // resolver builds its filter in the background when it may
        if (!resolver) return gateState({ state: 'failed', reason: 'the table has no rows to read' });
        const status = resolver.need(id, dependant);
        if (!status || status.state === 'ready') return null;
        if (status.state === 'missing') return gateState({ state: 'failed', reason: 'the table is gone' });
        return gateState(status);
    }

    return {
        /** The source behind a panel id, or null when no source panel has it. */
        get(id) {
            const p = id ? panel(id) : null;
            const type = p && typeof p.getType === 'function' ? p.getType() : null;
            if (!isSourceType(type)) return null;
            if (type === SIGNATURE_TYPE) {
                if (typeof p.getRecipe !== 'function') return null;
                return { title: p.getTitle(), kind: 'signature', recipe: () => p.getRecipe(), options: () => p.getRecipe(), gate: () => null, actions: null };
            }
            return {
                title: p.getTitle(), kind: 'table',
                recipe: () => tableRecipe(p, { open: active(p), geneNames: geneNames() }),
                options: () => optionsOf(p),
                gate: (dependant) => tableGate(p, dependant),
                actions: resolver ? {
                    accept: () => resolver.accept(p.getId()),
                    cancel: () => resolver.cancel(p.getId()),
                    retry: () => resolver.retry(p.getId())
                } : null
            };
        },
        off,
        offers: offers || undefined,
        titleOf
    };
}
