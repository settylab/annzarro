/**
 * The recipe of a cell grouping and what is made of it: the versioned normaliser, the hash a result is cached under,
 * the names and colours of the groups, and the request body (plan 1.6, PER-3, SHR-8 to SHR-12).
 *
 * A grouping's recipe is `{version, partitionings, separator?, small?, offered?, layers?, detect_above?}` and a
 * partitioning (a factor; the count plot's inputs are the same shape) is `{source, levels?, rest?, labels?, binning?}`.
 * It is stored without its defaults, with every unknown field kept, so an older build opening a newer link loses
 * nothing. After release 0.8.0 a change to this schema needs a new version and a migration.
 *
 * The server's reply is read as `{partitionings: [{levels, edges?, bins_made?, degenerate?, value?, boolean?, names?,
 * colors?}], groups: [{key, n}]}`: for each partitioning the ids of its levels in order (with the bin edges the engine
 * found, whether it is a boolean column, the names of the groups of a grouping used as a factor, and the colours of
 * the column), and the non-empty groups, in order, each with the list of its level ids.
 *
 * Pure, so Node tests cover it.
 */
import { VOCABULARY } from './vocabulary.js';
import { normalizeBinning, effectiveBinning, levelLabels } from './binning.js';
import { RESERVED, parseLevelId } from './level-id.js';
import { groupOf } from './categories.js';
import { stableStringify } from './url-history.js';

const P = VOCABULARY.phrase;

const GROUPING_VERSION = 1;

/** SHR-13: the most factors a grouping holds, and the most groups it makes (levels: SHR-6). */
// export-unused-ok: G9a disables Add factor at 8 factors and says why over 2,000 groups
export const GROUPING_LIMITS = Object.freeze({ partitionings: 8, levels: 2000, groups: 2000 });

/** The statistic ids a grouping can offer to its consumers (plan 1.6). */
const STATISTIC_IDS = Object.freeze(['mean', 'pct_expressing', 'mean_expressing', 'sum', 'sd', 'count']);
const SMALL_MODES = Object.freeze(['keep', 'collect', 'hide']);
const DEFAULT_SMALL = Object.freeze({ threshold: 10, mode: 'keep' });
const DEFAULT_SEPARATOR = ' | ';
const SOURCE_FIELDS = ['type', 'key', 'column', 'layer'];
const PARTITIONING_FIELDS = ['source', 'levels', 'rest', 'labels', 'binning'];
const GROUPING_FIELDS = ['version', 'partitionings', 'separator', 'small', 'offered', 'layers', 'detect_above'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unknownFields = (raw, known, into) => {
    for (const key of Object.keys(raw)) if (!known.includes(key)) into[key] = raw[key];
    return into;
};
const unique = (list) => [...new Set(list)];

/** A source setting `{type, key, column?, layer?}`, or null when it has no type or key. */
function normalizeSource(raw, problems) {
    if (!isObject(raw) || typeof raw.type !== 'string' || typeof raw.key !== 'string' || !raw.type || !raw.key) return null;
    const out = { type: raw.type, key: raw.key };
    for (const field of ['column', 'layer']) {
        if (raw[field] === undefined) continue;
        if (typeof raw[field] !== 'string') problems.push({ field: `source.${field}`, reason: 'bad_source' });
        else if (raw[field] !== '') out[field] = raw[field];
    }
    return unknownFields(raw, SOURCE_FIELDS, out);
}

/**
 * A partitioning in its stored form: the grouping's factor and every count-plot input.
 * @param {*} raw
 * @returns {{partitioning: Object|null, problems: {field: string, reason: string}[]}} null when it has no usable source
 */
// export-unused-ok: C1 normalises the inputs of a count plot, which are partitionings too
export function normalizePartitioning(raw) {
    const problems = [];
    const bad = (field, reason) => problems.push({ field, reason });
    if (!isObject(raw)) {
        bad('partitioning', 'bad_partitioning');
        return { partitioning: null, problems };
    }
    const source = normalizeSource(raw.source, problems);
    if (!source) {
        bad('source', 'bad_source');
        return { partitioning: null, problems };
    }
    const out = { source };
    if (raw.levels !== undefined) {
        if (Array.isArray(raw.levels)) {
            const ids = raw.levels.filter((id) => typeof id === 'string');
            if (ids.length !== raw.levels.length) bad('levels', 'bad_levels');
            out.levels = unique(ids);
        } else {
            bad('levels', 'bad_levels');
        }
    }
    if (raw.rest !== undefined) {
        if (raw.rest === 'exclude') out.rest = 'exclude';
        else if (raw.rest !== 'other') bad('rest', 'bad_rest');
    }
    if (raw.labels !== undefined) {
        if (isObject(raw.labels)) {
            const labels = Object.fromEntries(Object.entries(raw.labels).filter(([, text]) => typeof text === 'string'));
            if (Object.keys(labels).length !== Object.keys(raw.labels).length) bad('labels', 'bad_labels');
            if (Object.keys(labels).length) out.labels = labels;
        } else {
            bad('labels', 'bad_labels');
        }
    }
    if (raw.binning !== undefined) {
        const bin = normalizeBinning(raw.binning);
        out.binning = bin.binning;
        for (const p of bin.problems) bad(`binning.${p.field}`, p.reason);
    }
    return { partitioning: unknownFields(raw, PARTITIONING_FIELDS, out), problems };
}

function normalizeSmall(raw, bad) {
    if (!isObject(raw)) {
        bad('small', 'bad_small');
        return null;
    }
    const out = {};
    if (raw.threshold !== undefined) {
        if (Number.isInteger(raw.threshold) && raw.threshold >= 1) {
            if (raw.threshold !== DEFAULT_SMALL.threshold) out.threshold = raw.threshold;
        } else {
            bad('small.threshold', 'bad_small');
        }
    }
    if (raw.mode !== undefined) {
        if (!SMALL_MODES.includes(raw.mode)) bad('small.mode', 'bad_small');
        else if (raw.mode !== DEFAULT_SMALL.mode) out.mode = raw.mode;
    }
    unknownFields(raw, ['threshold', 'mode'], out);
    return Object.keys(out).length ? out : null;
}

/**
 * A grouping's recipe from whatever a link, a panel set or the panel holds: every field valid, defaults left out,
 * unknown fields kept. A recipe of a newer version is returned as it is, and reported.
 * @param {*} raw
 * @returns {{recipe: Object, problems: {field: string, reason: string}[]}}
 */
// export-unused-ok: G7 and G8a read a grouping panel's stored recipe
export function normalizeGrouping(raw) {
    const problems = [];
    const bad = (field, reason) => problems.push({ field, reason });
    if (!isObject(raw)) {
        if (raw !== undefined) bad('recipe', 'bad_recipe');
        return { recipe: { version: GROUPING_VERSION, partitionings: [] }, problems };
    }
    let version = GROUPING_VERSION;
    if (raw.version !== undefined) {
        if (!Number.isInteger(raw.version) || raw.version < 1) bad('version', 'bad_version');
        else version = raw.version;
    }
    if (version > GROUPING_VERSION) {
        bad('version', 'newer_version');
        return { recipe: { ...raw }, problems };
    }
    const out = { version, partitionings: [] };
    const list = Array.isArray(raw.partitionings) ? raw.partitionings : [];
    if (raw.partitionings !== undefined && !Array.isArray(raw.partitionings)) bad('partitionings', 'bad_partitionings');
    for (const item of list) {
        const { partitioning, problems: found } = normalizePartitioning(item);
        problems.push(...found);
        if (partitioning) out.partitionings.push(partitioning);
    }
    for (const p of out.partitionings) {
        if (p.binning && p.binning.outside === 'exclude') {
            bad('binning.outside', 'exclude_in_grouping');
            delete p.binning.outside;
        }
    }
    if (out.partitionings.length > GROUPING_LIMITS.partitionings) {
        bad('partitionings', 'too_many_partitionings');
        out.partitionings.length = GROUPING_LIMITS.partitionings;
    }
    if (raw.separator !== undefined) {
        if (typeof raw.separator !== 'string') bad('separator', 'bad_separator');
        else if (raw.separator !== DEFAULT_SEPARATOR) out.separator = raw.separator;
    }
    if (raw.small !== undefined) {
        const small = normalizeSmall(raw.small, bad);
        if (small) out.small = small;
    }
    if (raw.offered !== undefined) {
        const list = Array.isArray(raw.offered) ? raw.offered : [];
        const kept = unique(list.filter((id) => STATISTIC_IDS.includes(id)));
        if (!Array.isArray(raw.offered) || kept.length !== unique(list).length) bad('offered', 'bad_offered');
        if (kept.length) out.offered = kept;
    }
    if (raw.layers !== undefined) {
        const list = Array.isArray(raw.layers) ? raw.layers : [];
        const kept = unique(list.filter((name) => typeof name === 'string'));
        if (!Array.isArray(raw.layers) || kept.length !== unique(list).length) bad('layers', 'bad_layers');
        if (kept.length) out.layers = kept;
    }
    if (raw.detect_above !== undefined) {
        if (typeof raw.detect_above !== 'number' || !Number.isFinite(raw.detect_above)) bad('detect_above', 'bad_detect_above');
        else if (raw.detect_above !== 0) out.detect_above = raw.detect_above;
    }
    return { recipe: unknownFields(raw, GROUPING_FIELDS, out), problems };
}

function effectiveSmall(recipe) {
    return { threshold: DEFAULT_SMALL.threshold, mode: DEFAULT_SMALL.mode, ...recipe.small };
}

/** The part of a partitioning that decides what is computed, as the hash and the request see it. */
function computed(partitioning) {
    const out = { source: partitioning.source, rest: partitioning.rest === 'exclude' ? 'exclude' : 'other' };
    if (partitioning.levels) out.levels = partitioning.levels;
    if (partitioning.binning) out.binning = effectiveBinning(partitioning.binning);
    return out;
}

/**
 * The hash a grouping's result is cached under (PER-3): equal recipes give equal text, and what no number depends on
 * does not change it: a rename, the separator, the order of the statistics offered, and a default written out.
 * Each partitioning is walked once, when the hasher is made, and again only when a variant brings a new one, so
 * hashing the variants of one applied recipe costs nothing per call.
 * @param {Object} recipe - from normalizeGrouping
 * @param {(source: Object) => (string|null|undefined)} [upstream] - the hash of what a source of another panel computes
 *   (a table's bitset, a score's recipe); a source it names is hashed by that and no longer by its panel id
 * @returns {(variant: Object) => string}
 */
// export-unused-ok: G7's group store keys its cache by this hash
export function groupingHasher(recipe, upstream) {
    const memo = new WeakMap();
    const body = (partitioning) => {
        let found = memo.get(partitioning);
        if (!found) {
            found = computed(partitioning);
            memo.set(partitioning, found);
        }
        const up = upstream ? upstream(partitioning.source) : null;
        if (typeof up !== 'string') return found;
        const source = { ...found.source, upstream: up };
        delete source.key;
        return { ...found, source };
    };
    recipe.partitionings.forEach((p) => body(p));
    return (variant) => stableStringify({
        v: variant.version,
        p: variant.partitionings.map(body),
        small: effectiveSmall(variant),
        detect_above: variant.detect_above || 0,
        offered: [...(variant.offered || [])].sort(),
        layers: [...(variant.layers || [])].sort()
    });
}

/**
 * A source's short name, the first part of its bins' labels: the gene or cell a `layer` or `obsp` source reads, a
 * dimension of an `obsm` matrix, the column of an `obs` source, and the panel's title for a source another panel makes.
 * @param {{type: string, key: string, column?: string}} source
 * @param {(source: Object) => (string|undefined)} [titleOf] - the title of the panel behind a source
 */
// export-unused-ok: G8a titles a grouping as a source
export function sourceName(source, titleOf) {
    const title = titleOf ? titleOf(source) : undefined;
    if (typeof title === 'string' && title) return title;
    if (source.type === 'layer' || source.type === 'obsp') return source.column || source.key;
    if (source.type === 'obsm') return source.column ? `${source.key} ${source.column}` : source.key;
    return source.key;
}

/** The default label of a level that is not a bin of this partitioning's binning. */
function plainLabel(id, name, info) {
    const level = parseLevelId(id);
    if (!level) return id;
    switch (level.kind) {
        case 'category':
            if (info.boolean && level.text === 'true') return name;
            if (info.boolean && level.text === 'false') return P.negated(name);
            return level.text;
        case 'group': return (info.names && info.names[id]) || level.key.join(' ');
        case 'reserved':
            switch (id) {
                case RESERVED.zero: return P.zero(name);
                case RESERVED.in: return P.inTable(name);
                case RESERVED.out: return P.notInTable(name);
                case RESERVED.other: return P.other(name);
                case RESERVED.na: return P.noValue(name);
                default: return id;
            }
        default: return id;
    }
}

/** One Map per partitioning: level id to its default label (SHR-9), the same label in two partitionings qualified. */
function defaultLabelMaps(recipe, reply, titleOf) {
    const maps = recipe.partitionings.map((p, i) => {
        const info = (reply.partitionings && reply.partitionings[i]) || { levels: [] };
        const name = sourceName(p.source, titleOf);
        const map = new Map();
        if (p.binning) for (const { id, label } of levelLabels(p.binning, info, name)) map.set(id, label);
        for (const id of info.levels || []) if (!map.has(id)) map.set(id, plainLabel(id, name, info));
        return { map, name, info };
    });
    const seen = new Map();
    for (const { map, info } of maps) {
        const texts = new Set();
        for (const id of map.keys()) {
            const level = parseLevelId(id);
            if (level && level.kind === 'category' && !info.boolean) texts.add(level.text);
        }
        for (const text of texts) seen.set(text, (seen.get(text) || 0) + 1);
    }
    for (const { map, name, info } of maps) {
        for (const id of map.keys()) {
            const level = parseLevelId(id);
            if (level && level.kind === 'category' && !info.boolean && seen.get(level.text) > 1) map.set(id, P.qualified(name, level.text));
        }
    }
    return maps.map(({ map }) => map);
}

const isCollected = (key) => key.length === 1 && key[0] === RESERVED.small;

/**
 * Each group's key with its default level labels, the ones a user's rename and the separator leave alone. A consumer
 * that names one group compares these (SHR-38).
 * @param {Object} recipe - from normalizeGrouping
 * @param {Object} reply - the server's reply
 * @param {(source: Object) => (string|undefined)} [titleOf] - the title of the panel behind a source
 * @returns {{key: string[], labels: string[]}[]} one per group of the reply, in its order
 */
// export-unused-ok: G7's group-reference compares default labels (SHR-38)
export function groupLabels(recipe, reply, titleOf) {
    const maps = defaultLabelMaps(recipe, reply, titleOf);
    const collected = P.smallGroups(effectiveSmall(recipe).threshold);
    return reply.groups.map((g) => ({
        key: g.key,
        labels: isCollected(g.key) ? [collected] : g.key.map((id, i) => (maps[i] && maps[i].get(id)) || id)
    }));
}

/**
 * The name of each group (SHR-9): its level labels, renamed where the user renamed one, joined by the separator.
 * Two groups with one name get (2), (3) in order.
 * @returns {string[]} one per group of the reply, in its order
 */
// export-unused-ok: G8a lists the groups of a grouping as the levels of a source
export function groupNames(recipe, reply, titleOf) {
    const separator = recipe.separator === undefined ? DEFAULT_SEPARATOR : recipe.separator;
    const seen = new Map();
    return groupLabels(recipe, reply, titleOf).map(({ key, labels }) => {
        const shown = isCollected(key) ? labels : labels.map((label, i) => {
            const renamed = recipe.partitionings[i] && recipe.partitionings[i].labels;
            return (renamed && renamed[key[i]]) || label;
        });
        const name = shown.join(separator);
        const n = (seen.get(name) || 0) + 1;
        seen.set(name, n);
        return n === 1 ? name : P.suffixed(name, n);
    });
}

/**
 * The colour of each group (SHR-11): a grouping of one categorical factor takes that column's colours, where the reply
 * has them; any other takes the palette in group order, repeating by the 64 colour groups of a large category list.
 * @param {Object} recipe - from normalizeGrouping
 * @param {Object} reply - the server's reply
 * @param {string[]} palette
 * @returns {string[]} one per group of the reply, in its order
 */
// export-unused-ok: G8a colours a plot by a grouping
export function groupColours(recipe, reply, palette) {
    const one = recipe.partitionings.length === 1 && !recipe.partitionings[0].binning;
    const own = one && reply.partitionings && reply.partitionings[0] && reply.partitionings[0].colors;
    return reply.groups.map((g, i) => (own && own[g.key[0]]) || palette[groupOf(i) % palette.length]);
}

/** A set of cells shown as the request carries it: bit i & 7 of byte i >> 3, least significant first, padding bits 0. */
// export-unused-ok: C1 sends the sets of a count plot the same way
export function packBitset(flags) {
    const bytes = new Uint8Array((flags.length + 7) >> 3);
    for (let i = 0; i < flags.length; i++) if (flags[i]) bytes[i >> 3] |= 1 << (i & 7);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return { encoding: 'bitset-base64', length: flags.length, data: btoa(binary) };
}

/** A grouping nested in a source stops here: a grouping that uses a grouping that uses ... */
const MAX_NESTING = 4;

function wirePartitions(recipe, ctx, depth) {
    if (depth > MAX_NESTING) throw new Error(`Groupings nest at most ${MAX_NESTING} deep.`);
    return recipe.partitionings.map((p) => {
        const wire = computed(p);
        const source = Object.fromEntries(SOURCE_FIELDS.filter((f) => wire.source[f] !== undefined).map((f) => [f, wire.source[f]]));
        const inline = ctx && ctx.inlineRecipe ? ctx.inlineRecipe(p.source) : null;
        if (inline && inline.recipe) source.recipe = inline.recipe;
        if (inline && inline.grouping) {
            source.recipe = { partitionings: wirePartitions(inline.grouping, ctx, depth + 1), small: effectiveSmall(inline.grouping) };
        }
        const body = { source };
        if (wire.levels) body.levels = wire.levels;
        if (p.rest === 'exclude') body.rest = 'exclude';
        if (wire.binning) body.binning = wire.binning;
        const flags = ctx && ctx.bitsetFor ? ctx.bitsetFor(p.source) : null;
        if (flags) body.bitset = packBitset(flags);
        return body;
    });
}

/**
 * The body of a request for the groups of a recipe (SHR-29): what the server computes from, with no label, separator or
 * statistic offered, and every default filled in so the body says what the engine does.
 * @param {Object} recipe - from normalizeGrouping
 * @param {{subset?: Object, features?: Object[], bitsetFor?: (source: Object) => (ArrayLike<*>|null),
 *   inlineRecipe?: (source: Object) => ({recipe: Object}|{grouping: Object}|null)}} ctx
 *   `bitsetFor` gives, per cell shown, whether a table source passes it; `inlineRecipe` gives the recipe a score source
 *   (the score route's) or a grouping source (a normalised grouping) carries in the request
 * @param {string[]} want - what comes back (`groups`, `codes`, ...)
 */
// export-unused-ok: G7's client sends this body
export function serverRequest(recipe, ctx, want) {
    const request = { shape: 'grouping', partitionings: wirePartitions(recipe, ctx, 1), small: effectiveSmall(recipe),
        subset: (ctx && ctx.subset) || null, want: [...want] };
    if (ctx && ctx.features) request.features = ctx.features;
    return request;
}
