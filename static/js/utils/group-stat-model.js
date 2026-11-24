/**
 * The Gene Plot's `group-stat` source: each gene's value is one statistic of that gene over the cells of ONE group of a
 * Cell Grouping (offered-removal-080.md 10.1, SO-8b). Pure (no DOM, no page state), so Node tests hold it.
 *
 * A setting is `{type, key, column, stat, layer, groupWas, follow?}` (type `group-stat`): `key` the grouping's panel id,
 * `column` the canonical JSON of the group's key (`levelKey`), `stat` one of the statistics of utils/group-statistics.js
 * (without Cell count, which is the same for every gene), `layer` the matrix, `groupWas` the default labels of the
 * group's levels when it was chosen (utils/group-reference.js compares them), `follow` whether it follows its key.
 *
 * The server sends the five moments `[n, sum, sumsq, n_above, sum_above]` of every gene over the group
 * (`shape: "genes"`, core/gene_moments.py), one float64 block `[n_var, 5 * thresholds]`. The statistic is derived here
 * (`statValues`), so a change of statistic or a switch between statistics of the same moments sends no request; the
 * request names the group, the layer and the grouping's Expressed above only. A statistic has the Cell-Gene Plot's
 * name and units (% expressing is 0 to 100), from the same table (utils/group-statistics.js).
 */
import { statisticColumn, MOMENT_STRIDE } from './cell-gene-model.js';
import { STATISTIC_INFO, CELL_COUNT, statisticChoices, statisticLayerChoices, statisticPairAfter } from './group-statistics.js';
import { stableStringify } from './url-history.js';

/** The statistic a new choice starts on, and the layer (OD 8: mean · X). */
export const DEFAULT_STAT = 'mean';
export const DEFAULT_LAYER = 'X';

/** The statistics of the source's menu: the Cell-Gene Plot's, without Cell count. */
export const STAT_IDS = Object.freeze(STATISTIC_INFO.map((m) => m.value));

/** The statistic the server z-scores each gene for (over all cells): a request of its own (G1a). */
export const ZSCORE = 'zscore_mean';

/** A statistic's entry of the table (`value`, `label`, `menu`...); the default's for one this page does not know. */
export const statInfo = (stat) => STATISTIC_INFO.find((m) => m.value === stat) || STATISTIC_INFO.find((m) => m.value === DEFAULT_STAT);

/** The statistic a setting holds, or the default for one that holds none (or one this page does not know). */
export const statOf = (setting) => (setting && STAT_IDS.includes(setting.stat) ? setting.stat : DEFAULT_STAT);

/** The layer a setting holds, or the default. */
export const layerOf = (setting) => (setting && setting.layer ? String(setting.layer) : DEFAULT_LAYER);

/** The group key a setting names (the JSON in `column`), or null when it names none or the text is not a key. */
export function groupKeyOf(setting) {
    if (!setting || typeof setting.column !== 'string' || !setting.column) return null;
    try {
        const key = JSON.parse(setting.column);
        return Array.isArray(key) && key.length && key.every((id) => typeof id === 'string') ? key : null;
    } catch {
        return null;
    }
}

/** The canonical JSON of a group key (what `column` holds; `JSON.stringify(key)`, as the server's `group_key_json`). */
export const columnOf = (key) => JSON.stringify(key);

/** The group reference of a setting, as utils/group-reference.js resolves it; null when it names no group. */
export function referenceOf(setting) {
    const group = groupKeyOf(setting);
    if (!group) return null;
    const was = Array.isArray(setting.groupWas) ? setting.groupWas.filter((t) => typeof t === 'string') : group;
    return { group, groupWas: was, ...(setting.follow === true ? { follow: true } : {}) };
}

/** The grouping's Expressed above, the threshold the request carries (0 unless the grouping says otherwise). */
export function thresholdOf(recipe) {
    return recipe && typeof recipe.detect_above === 'number' && Number.isFinite(recipe.detect_above) ? recipe.detect_above : 0;
}

/**
 * The body of the `genes` request: the grouping's own request (the cells it groups, as `serverRequest` writes them)
 * with the group, the layer and the threshold. The cells shown (`subset`) are added by the groups client.
 * @param {Object} groupingRequest - `serverRequest(recipe, ctx, ...)`'s body
 * @param {string[]} group - the group's key
 * @param {string} layer
 * @param {number} threshold
 */
export function genesRequest(groupingRequest, group, layer, threshold, transform = null) {
    const body = { shape: 'genes', partitionings: groupingRequest.partitionings, small: groupingRequest.small,
        group: [...group], layer, thresholds: [threshold] };
    if (groupingRequest.sets) body.sets = groupingRequest.sets;
    if (transform) Object.assign(body, { transform, clip: 10 });      // the signature's default clip (Q2: fixed)
    return body;
}

/** What makes two requests of the moments the same: the grouping's key, the group, the layer and the threshold. */
export function momentsHash(groupingKey, group, layer, threshold, transform = null) {
    return stableStringify({ g: groupingKey, k: group, l: layer, t: threshold, ...(transform ? { z: transform } : {}) });
}

/**
 * One statistic of every gene from the moments the route sent: `statisticColumn` of the Cell-Gene model over the same
 * moments, genes in the place of groups. NaN where the group has no cell with a finite value of that gene.
 * @param {string} stat - mean, pct_expressing, mean_expressing, sum or sd
 * @param {Float64Array} moments - `[genes, 5]` (one threshold), as the route's block
 * @param {number} genes
 * @returns {Float64Array}
 */
export function statValues(stat, moments, genes) {
    if (stat === CELL_COUNT || !STAT_IDS.includes(stat)) throw new Error(`unknown statistic ${stat}`);
    if (moments.length !== genes * MOMENT_STRIDE) throw new Error('the moments do not hold five numbers for every gene');
    return statisticColumn(stat, moments, genes);
}

// ------------------------------------------------------------------------------------------------ the selects

const asOption = (e, text) => ({ value: e.value, text, disabled: !!e.disabled, title: e.title || e.reason || '' });

/**
 * The statistic select (decision 31): every statistic but Cell count, graded on the setting's layer; an impossible
 * one is disabled with its reason, a held one that cannot be given stays, marked.
 * @param {{stat?: string, layer?: string}} held
 * @param {Object<string, string>} kinds - layer -> what it looks like
 */
export function statMenu(held, kinds, layouts = {}) {
    const stat = statOf(held);
    // z-score mean needs every gene's mean and SD over all cells: offered on a CSC layer, listed disabled otherwise (G1a)
    const list = statisticChoices({ layer: layerOf(held), kinds, held: stat, consumer: 'genes', layout: layouts[layerOf(held)] }).filter((e) => e.value !== CELL_COUNT);
    return { options: list.map((e) => asOption(e, e.label)), chosen: stat };
}

/** The layer select: every layer, graded for the setting's statistic. */
export function layerMenu(held, kinds, datasetLayers) {
    const layer = layerOf(held);
    const list = statisticLayerChoices({ method: statOf(held), datasetLayers, kinds, held: layer });
    return { options: list.map((e) => asOption(e, e.label)), chosen: layer };
}

/**
 * The pair after the user touched the statistic or the layer: the one touched wins, the other moves only when it
 * became impossible, and `say` names that move once.
 * @returns {{stat: string, layer: string, say: string}}
 */
export function pairAfter(held, changed, value, kinds, datasetLayers) {
    const p = statisticPairAfter(changed === 'stat' ? 'method' : 'layer', value, { method: statOf(held), layer: layerOf(held) }, { datasetLayers, kinds });
    return { stat: p.method || statOf(held), layer: p.layer || layerOf(held), say: p.say || '' };
}
