/**
 * Save as grouping (CNT-7, UX 4.7): a Cell Grouping made from a count plot's partitionings, so every bar, slice or
 * rectangle becomes a group that plots, tables and the Cell-Gene Plot can use.
 *
 * - The RECIPE is made by G6's model (utils/cell-grouping.js `normalizeGrouping`) from the inputs the plot draws: X,
 *   Y and Color by, each as the plot has it (kept levels, renames, binning), with the bin count the plot used written
 *   out (a grouping's default count is not the count plot's) and its `outside` turned from the count plot's exclude
 *   into the grouping's clamp (SHR-45). Nothing of the recipe is written here by hand.
 * - The DIALOG says the factors, the groups the plot shows (its grid cells that hold a cell) and, when cells are
 *   affected, that cells outside a range go into the end bins. Over the grouping limits (SHR-13) Save is disabled with
 *   the reason, since nothing in the dialog can change it (SHR-37).
 * - Densities (their bins are the smoothing grid) and sets (a set is a member, not a factor) are not offered.
 *
 * Opened from Plot Options and by a click on a bar, slice or rectangle (CNT-21). It reads only what the plot already
 * holds, so opening it asks for nothing.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { normalizeGrouping, GROUPING_LIMITS } from '../../utils/cell-grouping.js';
import { BINS_MAX } from '../../utils/binning.js';
import { RESERVED } from '../../utils/level-id.js';
import { forControl } from './controls-model.js';

const W = VOCABULARY.countPlot.saveGrouping;

/** The modes whose inputs are factors: not the densities, not the sets. */
const SAVED_MODES = Object.freeze(['bar', 'histogram', 'pie', 'hist2d', 'heatmap']);
/** The plan's inputs that become factors, in this order; a most frequent level colors the plot and is not one. */
const FACTOR_INPUTS = Object.freeze(['x', 'y', 'split']);

/** Whether a config's plot can be saved as a grouping. */
export const saveOffered = (config) => !!config && SAVED_MODES.includes(config.mode);

/** The bins a binned input has: the thresholds' bins, or its bin count (the zero bin apart); null for a column read by its values. */
function binsOf(p) {
    const b = p.binning;
    if (!b || b.method === 'categories') return null;
    return b.method === 'manual' ? b.thresholds.length + 1 : b.bins;
}

/** The groups the grouping would have: the grid's cells over the factors' axes that hold a cell. */
function groupsOf(grid, axes) {
    const keep = axes.map((a) => a >= 0);
    const dims = grid.dims;
    const at = new Int32Array(dims.length);
    const seen = new Set();
    for (let c = 0; c < grid.cells; c++) {
        if (grid.counts[c] > 0) {
            let key = 0;
            for (let a = 0; a < dims.length; a++) if (keep[a]) key = key * dims[a] + at[a];
            seen.add(key);
        }
        for (let a = dims.length - 1; a >= 0; a--) {
            if (++at[a] < dims[a]) break;
            at[a] = 0;
        }
    }
    return seen.size;
}

/**
 * What Save as grouping would make of a drawn plot, and whether it may.
 * @param {Object} config - the config that made the grid
 * @param {Object} grid - utils/count-plot-model.js readGrid
 * @param {{input: string}[]} inputs - the grid's axes in order (planGrid's `inputs`)
 * @param {{nameOf: (field: string) => string}} ctx - an input's name
 * @returns {{available: boolean, recipe?: Object, groups?: number, clamped?: number, lines?: string[], problem?: (string|null)}}
 */
export function savePlan(config, grid, inputs, { nameOf }) {
    if (!saveOffered(config)) return { available: false };
    const fields = FACTOR_INPUTS.filter((f) => inputs.some((i) => i.input === f));
    // each input as the grid asked for it (the count plot's default bin count written out), with the grouping's clamp
    const asked = fields.map((f) => {
        const p = config[f];
        const levels = grid.axes[inputs.findIndex((i) => i.input === f)].levels;
        if (!levels.some((id) => id.startsWith('bin:') || id === RESERVED.zero)) return p;
        const shown = forControl(p, config.mode);
        const binning = { ...shown.binning };
        delete binning.outside;
        return { ...shown, binning };
    });
    const { recipe } = normalizeGrouping({ partitionings: asked });
    const groups = groupsOf(grid, inputs.map((i) => (fields.includes(i.input) ? 1 : -1)));
    const names = fields.map((f, i) => {
        const n = asked[i].binning ? binsOf(asked[i]) : null;
        return n ? W.binned(nameOf(f), n) : nameOf(f);
    });
    const clamped = grid.outside || 0;
    const lines = [W.factors(names, groups)];
    if (clamped > 0) lines.push(W.clamp(clamped));
    const wide = asked.findIndex((p) => p.binning && p.binning.method !== 'manual' && binsOf(p) > BINS_MAX);
    let problem = null;
    if (wide >= 0) problem = W.overBins(nameOf(fields[wide]), binsOf(asked[wide]), BINS_MAX);
    else if (groups > GROUPING_LIMITS.groups) problem = W.overGroups(groups, GROUPING_LIMITS.groups);
    if (problem) lines.push(problem);
    return { available: true, recipe, groups, clamped, lines, problem };
}

/**
 * The dialog, inside the panel (`role="dialog"`): the plan's lines, Cancel and Save, Save disabled with the reason
 * over the limits. Escape and Cancel close it; Save calls `save(recipe)` and closes it.
 * @param {Object} D - the DOM builder (gene-set-utilities/dom.js)
 * @param {HTMLElement} host - where it is shown
 * @param {ReturnType<typeof savePlan>} plan
 * @param {{save: (recipe: Object) => void, close?: () => void}} on
 * @returns {{close: () => void}}
 */
export function openSaveDialog(D, host, plan, on) {
    const { el } = D;
    const titleId = `${host.id || 'ccnt'}-save-title`;
    const close = () => { box.remove(); if (on.close) on.close(); };
    const save = el('button', { type: 'button', class: 'btn btn-sm btn-primary ccnt-save__save', disabled: !!plan.problem, title: plan.problem || '',
        on: { click: () => { if (plan.problem) return; close(); on.save(plan.recipe); } } }, W.save);
    const cancel = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ccnt-save__cancel', on: { click: close } }, W.cancel);
    const box = el('div', { class: 'ccnt-save', role: 'dialog', aria: { labelledby: titleId, modal: 'false' } },
        el('div', { class: 'ccnt-save__title', id: titleId, text: W.title }),
        ...plan.lines.map((line) => el('p', { class: 'ccnt-save__line', text: line })),
        el('div', { class: 'ccnt-save__do' }, cancel, save));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    const old = host.querySelector(':scope > .ccnt-save');
    if (old) old.remove();
    host.appendChild(box);
    (plan.problem ? cancel : save).focus();
    return { close };
}
