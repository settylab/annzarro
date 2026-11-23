/**
 * The one place a factor's and a grouping's colours are decided (operator decision 33). The group grid, the Cell Plot
 * (regular and large), the Cell-Gene strips and their legend, and the Count Plot's bars, slices and densities all ask
 * here, so a level or a group has one colour in every panel.
 *
 * A factor (`factorColours`), by priority:
 *   1. `partitioning.colors.overrides[levelId]`, a valid colour;
 *   2. `partitioning.colors.palette`: a named palette of plot-utilities/colors.js (discrete palettes keep their order,
 *      continuous ones are stepped through), or `default` for the app's group colours whatever the dataset stores;
 *   3. the default: an unbinned categorical or boolean factor takes the colours the reply carries (the dataset's
 *      `uns.<key>_colors`, which the server sends when there are at least as many as categories) when they are all
 *      valid; a binned factor takes viridis sampled over its bins in order; any other the app's group colours in level
 *      order (the ten largest in ten clearly different colours, then golden-angle hues, repeating past 64).
 * A reserved level (other, small, missing, zero, in, out) has no colour: the consumer draws its theme's grey.
 *
 * A grouping (`groupingColours`), by priority for each group:
 *   1. `recipe.colors.overrides[groupId]`, a valid colour; the id is the canonical JSON of the group's key
 *      (level-id.js `canonKey`), so it is the same text in every link;
 *   2. a grouping of one factor: that factor's colour of the group's level;
 *   3. `recipe.colors.by` = factor k: the colour of the group's level of factor k;
 *   4. `recipe.colors.palette` (a named palette) or the app's group colours, by the group's place in group order,
 *      repeating by the 64 colour groups (categories.js `groupOf`).
 * The collected small group has no colour unless it is overridden.
 *
 * Pure, so Node tests cover it.
 */
import { canonKey, parseLevelId, RESERVED } from './level-id.js';
import { isColourString } from './uns-palette.js';
import { GROUP_COLOURS, groupOf } from './categories.js';
import { generateDiscreteColors, groupColours } from '../panels/plot-utilities/colors.js';

/** The grey a consumer draws for a group that has no colour of its own (the collected small group). */
export const NO_COLOUR = '#969696';

const SEQUENTIAL = 'viridis';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isReserved = (id) => { const level = parseLevelId(id); return !!level && level.kind === 'reserved'; };
const valid = (colour) => isColourString(colour);

/** `n` colours of a named palette, or null when the name is not one this build knows. */
function named(n, name) {
    if (typeof name !== 'string' || !name || name === 'default') return null;
    try {
        return groupColours(n, name);
    } catch {
        return null;
    }
}

/** `n` colours of a sequential map, in order, the first for one bin. */
function sequential(n, name) {
    if (n <= 0) return [];
    try {
        return n === 1 ? [generateDiscreteColors(2, name)[0]] : generateDiscreteColors(n, name);
    } catch {
        return n === 1 ? [generateDiscreteColors(2, SEQUENTIAL)[0]] : generateDiscreteColors(n, SEQUENTIAL);
    }
}

/** The colour of the level at `i` among `n`, from `colours` (which has at most GROUP_COLOURS), repeating. */
const at = (colours, i) => colours[i % colours.length];

/**
 * The colour of each level of a factor.
 * @param {{binning?: Object, colors?: {palette?: string, overrides?: Object}}} partitioning - the factor, from the recipe
 * @param {{levels?: string[], colors?: Object}} info - the reply's partitioning of it: the colours a column carries
 * @param {string[]} [levels] - the ids to colour, in order (default: the reply's levels)
 * @returns {Map<string, string>} level id to colour; a reserved level is not in it
 */
export function factorColours(partitioning, info, levels) {
    const part = partitioning || {};
    const spec = isObject(part.colors) ? part.colors : {};
    const ids = Array.isArray(levels) ? levels : (info && Array.isArray(info.levels) ? info.levels : []);
    const plain = ids.filter((id) => !isReserved(id));
    const binned = !!part.binning;
    const out = new Map();
    const cap = Math.min(plain.length, GROUP_COLOURS);
    let colours = null;
    if (binned) {
        colours = sequential(plain.length, spec.palette && spec.palette !== 'default' ? spec.palette : SEQUENTIAL);
        plain.forEach((id, i) => out.set(id, colours[i]));
    } else {
        colours = named(cap, spec.palette) || groupColours(cap);
        const dataset = spec.palette ? null : (info && isObject(info.colors) ? info.colors : null);
        const given = dataset ? plain.filter((id) => dataset[id] !== undefined) : [];
        const usable = !!dataset && given.length > 0 && given.every((id) => valid(dataset[id]));
        plain.forEach((id, i) => out.set(id, usable && valid(dataset[id]) ? dataset[id] : at(colours, i)));
    }
    if (isObject(spec.overrides)) {
        for (const id of plain) if (valid(spec.overrides[id])) out.set(id, spec.overrides[id]);
    }
    return out;
}

/** The text a group's override is stored under: the canonical JSON of its key. */
export const groupId = (key) => canonKey(key);

const isCollected = (key) => Array.isArray(key) && key.length === 1 && key[0] === RESERVED.small;

/**
 * The colour of each group of a reply, and of each factor's levels.
 * @param {Object} recipe - the grouping's recipe (from normalizeGrouping), the one the reply is of
 * @param {Object} reply - the server's reply: `partitionings[i].{levels, colors}` and `groups[].key`
 * @returns {{groups: (string|null)[], factors: Map<string, string>[]}} `groups` has one entry per group of the reply,
 *   null for a group with no colour (the collected small group)
 */
export function groupingColours(recipe, reply) {
    const parts = recipe && Array.isArray(recipe.partitionings) ? recipe.partitionings : [];
    const infos = reply && Array.isArray(reply.partitionings) ? reply.partitionings : [];
    const groups = reply && Array.isArray(reply.groups) ? reply.groups : [];
    const factors = parts.map((p, i) => factorColours(p, infos[i] || {}, infos[i] && infos[i].levels));
    const spec = recipe && isObject(recipe.colors) ? recipe.colors : {};
    const overrides = isObject(spec.overrides) ? spec.overrides : {};
    const by = Number.isInteger(spec.by) && spec.by >= 0 && spec.by < parts.length ? spec.by : null;
    const own = named(GROUP_COLOURS, spec.palette) || groupColours(GROUP_COLOURS);
    const of = (factor, key) => (factors[factor] && factors[factor].get(key[factor])) || null;
    return {
        factors,
        groups: groups.map((g, i) => {
            const mine = overrides[groupId(g.key)];
            if (valid(mine)) return mine;
            if (isCollected(g.key)) return null;
            if (parts.length === 1) return of(0, g.key);
            if (by !== null) return of(by, g.key);
            return own[groupOf(i)];
        })
    };
}

/**
 * A count plot's factor as its levels are coloured: with the plot's own level palette (WP-6a, `config.color.palette`),
 * that palette replaces the factor's colours, as another palette in a Cell Plot's menu does; without one, the factor's.
 * @param {Object} config - the count plot's config
 * @param {Object|null} part - the input's partitioning
 * @returns {Object|null}
 */
export function plotPaletteOf(config, part) {
    const palette = config && isObject(config.color) && typeof config.color.palette === 'string' ? config.color.palette : '';
    return palette ? { ...(part || {}), colors: { palette } } : part;
}

/** @type {WeakMap<Object, {part: Object, palette: string, map: Map<string, string>}>} a count table's axis -> its levels' colours */
const AXES = new WeakMap();

/**
 * The colour of level `i` of axis `a` of a count plot's table (panels/cell-count): the colour of the input's factor
 * (a column's own, a palette, an override; for an input that is a grouping, that grouping's colours of its groups, which
 * the reply carries as `colors`), or the plot's own level palette when it names one (`plotPaletteOf`). A reserved
 * level, or one with no colour, takes `grey`.
 * @param {Object} config - the count plot's config; its inputs are partitionings
 * @param {{axes: {input: string, levels: string[], info: Object}[]}} table - from count-plot-model.js `countTable`
 * @param {number} a - the axis
 * @param {number} i - the level's place on the axis
 * @param {string} grey - the theme's colour of a level that has none
 * @returns {string}
 */
export function tableLevelColour(config, table, a, i, grey) {
    const axis = table.axes[a];
    const part = (axis.input === 'factor' ? config.value && config.value.factor : config[axis.input]) || null;
    const palette = config && isObject(config.color) && typeof config.color.palette === 'string' ? config.color.palette : '';
    let found = AXES.get(axis);
    if (!found || found.part !== part || found.palette !== palette) {
        found = { part, palette, map: factorColours(plotPaletteOf(config, part), axis.info, axis.levels) };
        AXES.set(axis, found);
    }
    return found.map.get(axis.levels[i]) || grey;
}
