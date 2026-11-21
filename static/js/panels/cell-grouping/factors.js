/**
 * The factors of a Cell Grouping (UX 2.2, GRP-3, GRP-4, GRP-8, SHR-2, SHR-6, SHR-10, SHR-13): what each entry of Add
 * factor makes, the operations of a card, the references a grouping's configuration holds, and the cards themselves.
 *
 * Pure (no DOM, no page): every operation takes a partitioning, or a list of them, and returns a new one, so an undo
 * step is the recipe before it and Node tests cover each. panels/cell-grouping.js draws the cards and the Add factor
 * row from these, and commits each change as one undoable step.
 *
 * Interface words come from utils/vocabulary.js (factor, level, group, grouping).
 *
 * SEAM (G9b): a binned factor's expanded card holds `.cgrp-binning`, empty here. The binning control mounts in it
 * through `BINNING_SLOT.mount(host, {partitioning, info, commit})` once G9b registers it; until then the card lists
 * the bins with their counts and says the method and count.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { GROUPING_LIMITS, sourceName } from '../../utils/cell-grouping.js';
import { parseLevelId, RESERVED } from '../../utils/level-id.js';
import { wouldLoop, loopReason } from '../../utils/panel-references.js';

const W = VOCABULARY.word;
const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * The source types of plan 1.6 whose `key` is another panel's id, named once here: a factor's source is part of the
 * grouping's frozen schema. (The cell-group provider, G8a, may export its own name for the second; this one follows.)
 */
export const SCORE_SOURCE = 'gene-score';
export const GROUP_SOURCE = 'cell-group';
export const TABLE_SOURCE = 'table';
/** Source types whose `key` is another panel's id: a grouping's references. */
export const PANEL_SOURCES = Object.freeze([TABLE_SOURCE, SCORE_SOURCE, GROUP_SOURCE]);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------- references

/**
 * The references of a grouping's configuration (utils/panel-references.js): each factor whose source is a table, a
 * score or another grouping names that panel, and is computed from it. Never throws on a hand-edited link.
 * @param {Object} config - the panel's configuration: its title and its recipe's fields
 */
export function groupingReferences(config) {
    const list = config && Array.isArray(config.partitionings) ? config.partitionings : [];
    const out = [];
    for (const p of list) {
        const source = isObject(p) && isObject(p.source) ? p.source : null;
        if (!source || !PANEL_SOURCES.includes(source.type) || typeof source.key !== 'string' || !source.key) continue;
        out.push({ id: source.key, via: 'partitioning', field: 'partitionings',
            get: () => source.key, set: (v) => { source.key = v; } });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------- making factors

const NUMERIC = /^(u?int|float)\d*$/;
const binned = (source) => ({ source, binning: { method: 'equal_count' } });

/** A factor's kind: what its card shows. */
export function factorKind(p) {
    const type = p && p.source && p.source.type;
    if (type === TABLE_SOURCE) return 'table';
    if (type === GROUP_SOURCE) return 'grouping';
    return p && p.binning ? 'binned' : 'categorical';
}

/** Whether an obs column is read as numbers (binned) rather than as categories. */
function isNumericColumn(structure, key) {
    const info = structure && structure.obs && structure.obs.columns_info && structure.obs.columns_info[key];
    return !!info && NUMERIC.test(String(info.type || ''));
}

/**
 * A column as a factor: categorical at once (a category, a string, a boolean), equal-count bins for a number; an obsm
 * column is always a number (GRP-3). The zero bin is the binning control's (G9b), decided from its preview.
 * @param {Object} structure - the dataset structure
 * @param {'obs'|'obsm'} type
 * @param {string} key
 * @param {string} [column] - an obsm dimension
 */
export function columnFactor(structure, type, key, column) {
    if (type === 'obsm') return binned({ type: 'obsm', key, column: String(column === undefined ? '0' : column) });
    const source = { type: 'obs', key };
    return isNumericColumn(structure, key) ? binned(source) : { source };
}

/** The cell names (the obs index) as a factor: one level per cell (SHR-6, E3's wire contract). */
export function cellNamesFactor(structure) {
    const index = structure && structure.obs && typeof structure.obs.index === 'string' ? structure.obs.index : '_index';
    return { source: { type: 'obs', key: index } };
}

/** A gene of a layer in 4 equal-count bins; the gene is stored by name in `column` (SHR-1). */
export function geneFactor(layer, gene) {
    return binned({ type: 'layer', key: layer, column: gene });
}

/** A signature's or gene table's score, read with one method and layer, in 4 equal-count bins. */
export function scoreFactor(panelId, method, layer) {
    return binned({ type: SCORE_SOURCE, key: panelId, column: method, layer });
}

/** A cell table: in, not in (SHR-4). */
export function tableFactor(panelId) {
    return { source: { type: 'table', key: panelId } };
}

/** Another grouping: one level per group. */
export function groupingFactor(panelId) {
    return { source: { type: GROUP_SOURCE, key: panelId } };
}

/** A cell's row of an obsp matrix (its neighbors), in 4 equal-count bins; the cell is stored by name. */
export function neighborsFactor(key, cell) {
    return binned({ type: 'obsp', key, column: cell });
}

/** Why no factor can be added now, or null (SHR-13). */
export function addFactorRefusal(recipe) {
    const n = recipe && Array.isArray(recipe.partitionings) ? recipe.partitionings.length : 0;
    return n >= GROUPING_LIMITS.partitionings
        ? `A grouping holds up to ${GROUPING_LIMITS.partitionings} ${VOCABULARY.plural.factor}. Remove one first.` : null;
}

/** Why the cell names cannot be a factor for this many cells shown, or null (SHR-6). */
export function cellNamesRefusal(cellsShown) {
    const limit = GROUPING_LIMITS.groups;
    if (!(cellsShown > limit)) return null;
    return `One ${W.group} per cell needs at most ${fmt(limit)} ${W.cellsShown}; ${fmt(cellsShown)} are shown. `
        + 'Use a subset, or bin a numeric value instead.';
}

/** The card's sentence for a factor refused for its levels (SHR-6, UX 2.6). */
export function tooManyLevelsText(name, count) {
    return `${name} has ${fmt(count)} ${VOCABULARY.plural.level}; a ${W.factor} holds up to ${fmt(GROUPING_LIMITS.levels)}. `
        + 'Tick the levels to keep, use a subset, or bin a numeric value.';
}

/**
 * The panels a reference menu offers, with the ones that would close a loop unavailable (operator decision 15): one
 * walk of the panels computed from this grouping per option, done when the menu is built.
 * @param {string} panelId - the grouping whose menu it is
 * @param {Array<{id: string, title: string}>} candidates
 * @returns {Array<{id: string, title: string, disabled: boolean, reason: (string|null)}>} without the grouping itself
 */
export function referenceChoices(panelId, candidates) {
    return candidates.filter((c) => c.id !== panelId).map((c) => {
        const loops = wouldLoop(panelId, c.id);
        return { id: c.id, title: c.title, disabled: loops, reason: loops ? loopReason(c.title, W.grouping) : null };
    });
}

// ---------------------------------------------------------------------------------------------- the list

/** The list with the factor at `from` moved to `to`; out of range, the same order. */
export function moveFactor(list, from, to) {
    const out = [...list];
    if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
}

/** The list with an independent copy of the factor at `i` after it. */
export function duplicateFactor(list, i) {
    const out = [...list];
    if (i < 0 || i >= out.length) return out;
    out.splice(i + 1, 0, JSON.parse(JSON.stringify(out[i])));
    return out;
}

export function removeFactor(list, i) {
    return list.filter((_, k) => k !== i);
}

/**
 * The factors whose source this dataset lacks (GRP-14): an obs column, an obsm matrix or dimension, a layer or its
 * gene, an obsp matrix, or a panel that is gone.
 * @param {Object} recipe
 * @param {Object} structure
 * @param {{hasGene: (name: string) => boolean, hasPanel: (id: string) => boolean}} has
 * @returns {number[]} their indexes
 */
export function missingFactors(recipe, structure, { hasGene, hasPanel }) {
    if (!structure) return [];
    const obs = new Set((structure.obs && structure.obs.columns) || []);
    const obsm = obsmKeys(structure);
    const layers = new Set(['X', ...layerList(structure)]);
    const obsp = obspKeys(structure);
    const out = [];
    recipe.partitionings.forEach((p, i) => {
        const s = p.source;
        let ok;
        switch (s.type) {
            case 'obs': ok = obs.has(s.key) || s.key === '_index' || s.key === (structure.obs && structure.obs.index); break;
            case 'obsm': ok = obsm.has(s.key) && (s.column === undefined || dimensionIn(structure, s.key, s.column)); break;
            case 'layer': ok = layers.has(s.key) && (!s.column || hasGene(s.column)); break;
            case 'obsp': ok = obsp.has(s.key); break;
            default: ok = PANEL_SOURCES.includes(s.type) ? hasPanel(s.key) : true;
        }
        if (!ok) out.push(i);
    });
    return out;
}

/** The layers of a structure, X not included (it is always there). */
export function layerList(structure) {
    const l = structure && structure.layers;
    const keys = l && !Array.isArray(l) ? ((l.details && l.details.keys) || l.keys) : l;
    return asList(keys).filter((n) => n !== 'X');
}

/** A structure's key list, given as a list or as an object by key. */
function asList(keys) {
    if (!keys) return [];
    return Array.isArray(keys) ? keys : typeof keys === 'object' ? Object.keys(keys) : [];
}

/** The obsm keys of a structure. */
export function obsmKeys(structure) {
    const o = structure && structure.obsm;
    if (!o) return new Set();
    if (Array.isArray(o)) return new Set(o);
    return new Set([...asList(o.keys), ...Object.keys(o.dataframes || {}), ...Object.keys(o.info || {})]);
}

/** The obsp keys of a structure. */
export function obspKeys(structure) {
    return new Set(asList(structure && structure.obsp && structure.obsp.keys));
}

/** The width of an obsm matrix (its columns), or null when the structure does not say. */
export function obsmWidth(structure, key) {
    const o = structure && structure.obsm;
    const info = (o && o.info && o.info[key]) || (structure && structure.obsm_info && structure.obsm_info[key]) || null;
    const shape = info && Array.isArray(info.shape) ? info.shape : null;
    if (shape && shape.length > 1) return Number(shape[1]);
    const frame = o && o.dataframes && o.dataframes[key];
    return frame && Array.isArray(frame.columns) ? frame.columns.length : null;
}

function dimensionIn(structure, key, column) {
    const width = obsmWidth(structure, key);
    const frame = structure.obsm && structure.obsm.dataframes && structure.obsm.dataframes[key];
    if (frame && Array.isArray(frame.columns) && frame.columns.includes(column)) return true;
    return width === null || (/^\d+$/.test(String(column)) && Number(column) < width);
}

// ---------------------------------------------------------------------------------------------- a card

/**
 * A card's title: the source's short name, a table as `in Table 1`, and "(not in this dataset)" when it is missing.
 * @param {Object} p
 * @param {(source: Object) => (string|undefined)} titleOf - the title of the panel behind a source
 * @param {boolean} [missing]
 */
export function factorTitle(p, titleOf, missing = false) {
    const name = sourceName(p.source, titleOf);
    const text = p.source.type === 'table' ? VOCABULARY.phrase.inTable(name) : name;
    return missing ? `${text} (not in this dataset)` : text;
}

const METHOD_LABEL = Object.freeze({
    equal_count: 'Equal count', equal_width: 'Equal width', log: 'Log-spaced', manual: 'Manual thresholds', categories: 'Categories'
});

/**
 * The kind and the levels: "categorical · 14 levels", "binned · Equal count · 4 levels", "table · 2 levels". Without a
 * reply, the kind alone (and the method).
 */
export function factorSummary(p, info) {
    const kind = factorKind(p);
    const parts = [kind];
    if (kind === 'binned') parts.push(METHOD_LABEL[p.binning.method] || p.binning.method);
    if (info && Array.isArray(info.levels)) parts.push(VOCABULARY.count(info.levels.length, 'level'));
    return parts.join(' · ');
}

/**
 * The first levels with their cells: "B cell 1,204 · T cell 980 · +12".
 * @param {{levels: string[], counts: Array<?number>}} info - a partitioning of the reply, as the group store reads it
 * @param {Map<string, string>} labels - level id -> its shown label
 * @param {number} [n]
 */
export function levelPreview(info, labels, n = 2) {
    if (!info || !Array.isArray(info.levels)) return '';
    const shown = info.levels.slice(0, n).map((id, i) => {
        const count = info.counts && typeof info.counts[i] === 'number' ? ` ${fmt(info.counts[i])}` : '';
        return `${labels.get(id) || id}${count}`;
    });
    const more = info.levels.length - n;
    return more > 0 ? `${shown.join(' · ')} · +${more}` : shown.join(' · ');
}

const isCategory = (id) => { const l = parseLevelId(id); return !!l && l.kind === 'category'; };
/** The categories of a reply's partitioning, kept or not, in the column's order: what can be ticked. */
const categoriesOf = (info) => {
    if (info && Array.isArray(info.categories)) return info.categories;
    return info && Array.isArray(info.levels) ? info.levels.filter(isCategory) : [];
};
/** The ids ticked now: the kept list, or every category when there is none. */
const tickedOf = (p, info) => (Array.isArray(p.levels) ? p.levels : categoriesOf(info));

const withField = (p, field, value) => {
    const out = { ...p };
    if (value === undefined) delete out[field]; else out[field] = value;
    return out;
};

/** Tick or untick one category: unticking keeps a chosen list (SHR-2), a ticked level goes last. */
export function tickLevel(p, info, id, on) {
    const ticked = tickedOf(p, info).filter((x) => x !== id);
    if (on) ticked.push(id);
    return withField(p, 'levels', ticked);
}

/** Every category ticked: the default, so nothing is stored. */
export function tickAll(p) {
    return withField(p, 'levels', undefined);
}

export function tickNone(p) {
    return withField(p, 'levels', []);
}

/** The ticked levels by their cells, most first. */
export function sortByCells(p, info) {
    const counts = new Map((info.levels || []).map((id, i) => [id, info.counts && typeof info.counts[i] === 'number' ? info.counts[i] : 0]));
    const ticked = [...tickedOf(p, info)];
    ticked.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    return withField(p, 'levels', ticked);
}

/** A ticked level one place up (-1) or down (+1) in the order (SHR-10). */
export function moveLevel(p, info, id, by) {
    const ticked = [...tickedOf(p, info)];
    const i = ticked.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ticked.length) return p;
    [ticked[i], ticked[j]] = [ticked[j], ticked[i]];
    return withField(p, 'levels', ticked);
}

/**
 * A level renamed (GRP-8): an empty name or the default one removes the rename. Never changes a key.
 * @param {string} [defaultLabel]
 */
export function renameLevel(p, id, text, defaultLabel) {
    const labels = { ...(p.labels || {}) };
    const name = String(text || '').trim();
    if (!name || name === defaultLabel) delete labels[id];
    else labels[id] = name;
    return withField(p, 'labels', Object.keys(labels).length ? labels : undefined);
}

/** Where the unticked levels go: one `<name> other` level ('other', the default) or no group ('exclude'). */
export function setRest(p, rest) {
    return withField(p, 'rest', rest === 'exclude' ? 'exclude' : undefined);
}

/**
 * The rows of a categorical card: ticked levels in their order, then the unticked, then the reserved levels (other,
 * no value) that cannot be ticked.
 * @param {Object} p
 * @param {{levels: string[], counts: Array<?number>}} info
 * @param {Map<string, string>} defaults - level id -> its default label
 * @returns {Array<{id: string, label: string, was: (string|null), ticked: (boolean|null), n: (number|null), tickable: boolean}>}
 */
export function levelRows(p, info, defaults) {
    const counts = new Map((info.levels || []).map((id, i) => [id, info.counts ? info.counts[i] : null]));
    const ticked = tickedOf(p, info);
    const tickedSet = new Set(ticked);
    const rows = [];
    const row = (id, on, tickable) => {
        const def = defaults.get(id) || id;
        const renamed = p.labels && p.labels[id];
        rows.push({ id, label: renamed || (id === RESERVED.na ? W.noValue : def), was: renamed ? def : null,
            ticked: tickable ? on : null, n: counts.has(id) && typeof counts.get(id) === 'number' ? counts.get(id) : null, tickable });
    };
    for (const id of ticked) row(id, true, true);
    for (const id of categoriesOf(info)) if (!tickedSet.has(id)) row(id, false, true);
    for (const id of info.levels || []) if (!isCategory(id)) row(id, null, false);
    return rows;
}


// ---------------------------------------------------------------------------------------------- the view

/**
 * Where G9b's binning control mounts in a binned card. `mount` is set by panels/partition-options/binning-control.js;
 * null until then.
 * @type {{mount: (null|((host: HTMLElement, ctx: {partitioning: Object, info: Object, commit: Function}) => {destroy: Function}))}}
 */
// export-unused-ok: G9b registers the binning control here
export const BINNING_SLOT = { mount: null };
