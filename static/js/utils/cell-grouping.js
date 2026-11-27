/**
 * The recipe of a cell grouping and what is made of it: the versioned normaliser, the hash a result is cached under,
 * the names of the groups, and the request body (plan 1.6, PER-3, SHR-8 to SHR-12).
 *
 * A grouping's recipe is `{version, partitionings, separator?, small?, detect_above?, colors?, groupOverrides?}` (with
 * the retired `offered?, layers?` of decision 31 read as stored, never flagged) and a
 * partitioning (a factor; the count plot's inputs are the same shape) is `{source, levels?, rest?, labels?, binning?,
 * colors?}`. `colors` is how it is coloured (utils/grouping-colours.js): a factor's is `{palette?: string,
 * overrides?: {levelId: css}}`, a grouping's `{by?: factor index, palette?: string}` (`by` absent: the grouping's own
 * palette). `groupOverrides` is what the user set for single groups (operator decision 38): `[{name, label?, color?}]`,
 * each keyed by the group's generated name (`generatedGroupNames`: its level labels joined by the separator), so it
 * applies only while a group of that name exists and stays stored, inactive, while none does (another dataset, another
 * factor, moved bins). Colours are drawn from the reply and the recipe now, never computed, so
 * they are no part of the hash. It is stored without its defaults, with every unknown field kept, so an older build
 * opening a newer link loses nothing, and a recipe from before colours loads unchanged. After release 0.8.0 a change to
 * this schema needs a new version and a migration.
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
import { isColourString } from './uns-palette.js';
import { stableStringify } from './url-history.js';
import { limit } from './limits.js';

const P = VOCABULARY.phrase;

const GROUPING_VERSION = 1;

/**
 * SHR-13: the most factors a grouping holds, and the most groups it makes (levels: SHR-6). The server's limits
 * (limits.partitionings, limits.groups; utils/limits.js), read at each use, so a change by the administrator applies.
 */
// export-unused-ok: G9a disables Add factor at 8 factors and says why over 2,000 groups
export const GROUPING_LIMITS = Object.freeze({
    get partitionings() { return limit('partitionings'); },
    get levels() { return limit('groups'); },
    get groups() { return limit('groups'); }
});

/** The statistic ids a grouping can offer to its consumers (plan 1.6). */
export const STATISTIC_IDS = Object.freeze(['zscore_mean', 'mean', 'fraction_of_cells', 'mean_expressing', 'sum', 'sd', 'count']);
/** Ids an old link, session or panel set may hold for a statistic: read as the current id, never written (aggregation-unify-080.md 13.3). */
const STATISTIC_ALIASES = Object.freeze({ pct_expressing: 'fraction_of_cells' });
/** `stat` under its current id. */
export const canonicalStatistic = (stat) => (typeof stat === 'string' && STATISTIC_ALIASES[stat]) || stat;
/** Whether `stat` is an old id: its stored style fields (a size or colour range) are in the old units and are dropped. */
export const isOldStatisticId = (stat) => typeof stat === 'string' && Object.hasOwn(STATISTIC_ALIASES, stat);
const SMALL_MODES = Object.freeze(['keep', 'collect', 'hide']);
const DEFAULT_SMALL = Object.freeze({ threshold: 10, mode: 'keep' });
const DEFAULT_SEPARATOR = ' | ';
const SOURCE_FIELDS = ['type', 'key', 'column', 'layer'];
const PARTITIONING_FIELDS = ['source', 'levels', 'rest', 'labels', 'binning', 'colors'];
const GROUPING_FIELDS = ['version', 'partitionings', 'separator', 'small', 'offered', 'layers', 'detect_above', 'colors', 'groupOverrides'];
const GROUP_OVERRIDE_FIELDS = ['name', 'label', 'color'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unknownFields = (raw, known, into) => {
    for (const key of Object.keys(raw)) if (!known.includes(key)) into[key] = raw[key];
    return into;
};
const unique = (list) => [...new Set(list)];

/** A map of id to colour, the valid ones; `bad` is called once when one is dropped. */
function colourMap(raw, bad, field) {
    if (!isObject(raw)) {
        bad(field, 'bad_colors');
        return null;
    }
    const kept = Object.fromEntries(Object.entries(raw).filter(([, css]) => isColourString(css)));
    if (Object.keys(kept).length !== Object.keys(raw).length) bad(field, 'bad_colors');
    return Object.keys(kept).length ? kept : null;
}

/**
 * `groupOverrides` in its stored form (decision 38): entries `{name, label?, color?}` with a non-empty name, a string
 * label and a valid colour, one per name (the last one given wins), unknown fields kept; an entry with nothing set beyond
 * its name is dropped. Null when none is left.
 */
function normalizeGroupOverrides(raw, bad) {
    if (!Array.isArray(raw)) {
        bad('groupOverrides', 'bad_group_overrides');
        return null;
    }
    const byName = new Map();
    for (const entry of raw) {
        if (!isObject(entry) || typeof entry.name !== 'string' || !entry.name) {
            bad('groupOverrides', 'bad_group_overrides');
            continue;
        }
        const out = { name: entry.name };
        if (entry.label !== undefined) {
            if (typeof entry.label === 'string') out.label = entry.label;
            else bad('groupOverrides.label', 'bad_group_overrides');
        }
        if (entry.color !== undefined) {
            if (isColourString(entry.color)) out.color = entry.color;
            else bad('groupOverrides.color', 'bad_group_overrides');
        }
        unknownFields(entry, GROUP_OVERRIDE_FIELDS, out);
        byName.delete(out.name);
        if (Object.keys(out).length > 1) byName.set(out.name, out);
    }
    return byName.size ? [...byName.values()] : null;
}

/**
 * A `colors` field in its stored form: `{palette?, overrides?}` of a factor, `{by?, palette?}` of a grouping. Invalid parts are
 * dropped and reported, a default (`by: 'own'`, an empty palette or map) is not stored, unknown fields are kept; null
 * when nothing is left.
 */
function normalizeColors(raw, bad, field, grouping) {
    if (!isObject(raw)) {
        bad(field, 'bad_colors');
        return null;
    }
    const out = {};
    if (grouping && raw.by !== undefined && raw.by !== 'own') {
        if (Number.isInteger(raw.by) && raw.by >= 0) out.by = raw.by;
        else bad(`${field}.by`, 'bad_colors');
    }
    if (raw.palette !== undefined && raw.palette !== '') {
        if (typeof raw.palette === 'string') out.palette = raw.palette;
        else bad(`${field}.palette`, 'bad_colors');
    }
    if (!grouping && raw.overrides !== undefined) {
        const overrides = colourMap(raw.overrides, bad, `${field}.overrides`);
        if (overrides) out.overrides = overrides;
    }
    // a group's own colour is a `groupOverrides` entry (decision 38), never stored here
    unknownFields(raw, grouping ? ['by', 'palette'] : ['palette', 'overrides'], out);
    return Object.keys(out).length ? out : null;
}

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
 * @param {Object} [binning] - options of normalizeBinning (`max`, `keepDefault`), for a caller whose bin limits differ
 * @returns {{partitioning: Object|null, problems: {field: string, reason: string}[]}} null when it has no usable source
 */
// export-unused-ok: C1 normalises the inputs of a count plot, which are partitionings too
export function normalizePartitioning(raw, binning) {
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
        const bin = normalizeBinning(raw.binning, binning);
        out.binning = bin.binning;
        for (const p of bin.problems) bad(`binning.${p.field}`, p.reason);
    }
    if (raw.colors !== undefined) {
        const colors = normalizeColors(raw.colors, bad, 'colors', false);
        if (colors) out.colors = colors;
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
    // `offered` and `layers` were retired by decision 31: kept as stored while valid, never flagged, dropped by the
    // panel's next edit. `detect_above` stays: the grouping's method parameter (decision 34)
    if (Array.isArray(raw.offered)) {
        const kept = unique(raw.offered.map(canonicalStatistic).filter((id) => STATISTIC_IDS.includes(id)));
        if (kept.length) out.offered = kept;
    }
    if (Array.isArray(raw.layers)) {
        const kept = unique(raw.layers.filter((name) => typeof name === 'string' && name !== ''));
        if (kept.length) out.layers = kept;
    }
    if (raw.detect_above !== undefined) {
        if (typeof raw.detect_above !== 'number' || !Number.isFinite(raw.detect_above)) bad('detect_above', 'bad_detect_above');
        else if (raw.detect_above !== 0) out.detect_above = raw.detect_above;
    }
    if (raw.colors !== undefined) {
        const colors = normalizeColors(raw.colors, bad, 'colors', true);
        if (colors) out.colors = colors;
    }
    if (raw.groupOverrides !== undefined) {
        const overrides = normalizeGroupOverrides(raw.groupOverrides, bad);
        if (overrides) out.groupOverrides = overrides;
    }
    return { recipe: unknownFields(raw, GROUPING_FIELDS, out), problems };
}

/** A recipe's small-group rule (SHR-12) with its defaults: `{threshold, mode}`; a group under `threshold` cells is small. */
export function effectiveSmall(recipe) {
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
 * The hash a grouping's result is cached under (PER-3): equal recipes give equal text, and what no number of the
 * groups depends on does not change it: a rename, the separator, an old link's `offered` and `layers`, the detection
 * threshold (each feature's key carries its own), and a default written out. So it is made of what the request sends.
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
    return (variant) => stableStringify({ v: variant.version, p: variant.partitionings.map(body), small: effectiveSmall(variant) });
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

/**
 * One Map per partitioning: level id to its default label (SHR-9), the same label in two partitionings qualified. A level that
 * is a group of another grouping is called what that group is called (`info.names`); with `generated` it is called by its
 * generated name (`info.generatedNames`), which a rename of that group leaves alone.
 */
export function defaultLabelMaps(recipe, reply, titleOf, generated = false) {
    const maps = recipe.partitionings.map((p, i) => {
        const read = (reply.partitionings && reply.partitionings[i]) || { levels: [] };
        const info = generated && read.generatedNames ? { ...read, names: read.generatedNames } : read;
        const name = sourceName(p.source, titleOf);
        const map = new Map();
        if (p.binning) for (const { id, label } of levelLabels(p.binning, info, name)) map.set(id, label);
        // a category the plot does not show (unticked) still has its name, which the checklist reads
        for (const id of [...(info.levels || []), ...(info.categories || [])]) if (!map.has(id)) map.set(id, plainLabel(id, name, info));
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
 * @param {boolean} [generated] - name a level that is a group of another grouping by that group's generated name, not its label
 *   (what a group reference compares: a rename is display only)
 * @returns {{key: string[], labels: string[]}[]} one per group of the reply, in its order
 */
// export-unused-ok: G7's group-reference compares default labels (SHR-38)
export function groupLabels(recipe, reply, titleOf, generated = false) {
    const maps = defaultLabelMaps(recipe, reply, titleOf, generated);
    const collected = P.smallGroups(effectiveSmall(recipe).threshold);
    return reply.groups.map((g) => ({
        key: g.key,
        labels: isCollected(g.key) ? [collected] : g.key.map((id, i) => (maps[i] && maps[i].get(id)) || id)
    }));
}

/**
 * What a partitioning's reply says about ids a link stored before 0.8.1: `legacy_ids`, old id to the id it has now (a
 * float32 category 0.1 was `c:0.10000000149011612` and is `c:0.1`). Only an old id the reply does not itself list counts:
 * a kept level the link names is echoed as it was stored, so what is keyed by it is already right.
 * @returns {Map<string, string>} old id to current id; empty when the reply has none
 */
export function legacyIdMap(info) {
    const out = new Map();
    const raw = info && info.legacy_ids;
    if (!raw || typeof raw !== 'object') return out;
    const listed = new Set([...(info.levels || []), ...(info.categories || [])]);
    for (const [old, now] of Object.entries(raw)) if (!listed.has(old) && typeof now === 'string') out.set(old, now);
    return out;
}

/** The rename of level `id` in a partitioning's `labels`, found under the id an old link stored it by when not under this one. */
export function renameOf(labels, id, info) {
    if (!labels) return undefined;
    if (labels[id] !== undefined) return labels[id];
    for (const [old, now] of legacyIdMap(info)) if (now === id && labels[old] !== undefined) return labels[old];
    return undefined;
}

/** A map keyed by level id with the keys of an old link moved to the ids they have now (a current key is not replaced). */
function rekeyed(map, legacy) {
    if (!map || typeof map !== 'object' || !legacy.size) return map;
    let out = map;
    for (const [old, now] of legacy) {
        if (Object.hasOwn(map, old) && !Object.hasOwn(map, now)) {
            if (out === map) out = { ...map };
            out[now] = map[old];
            delete out[old];
        }
    }
    return out;
}

/**
 * The recipe as a reply of the engine since 0.8.1 reads it: the renames (`labels`) and level colours
 * (`colors.overrides`) of an old link keyed by the ids they have now. Returns the recipe itself when nothing moves.
 */
function upgradeLevelIds(recipe, reply) {
    const infos = (reply && reply.partitionings) || [];
    let out = recipe;
    (recipe.partitionings || []).forEach((p, i) => {
        const legacy = legacyIdMap(infos[i]);
        if (!legacy.size) return;
        const labels = rekeyed(p.labels, legacy);
        const overrides = p.colors && rekeyed(p.colors.overrides, legacy);
        if (labels === p.labels && (!p.colors || overrides === p.colors.overrides)) return;
        if (out === recipe) out = { ...recipe, partitionings: [...recipe.partitionings] };
        out.partitionings[i] = { ...p, ...(labels !== p.labels ? { labels } : {}),
            ...(p.colors && overrides !== p.colors.overrides ? { colors: { ...p.colors, overrides } } : {}) };
    });
    return out;
}

/**
 * `upgradeLevelIds`, and the group settings (`groupOverrides`, keyed by the generated name, which is made of the labels)
 * of an old link moved to the generated names the groups have now: the name a group had is found by naming the groups with
 * the old ids.
 */
export function upgradeRecipe(recipe, reply, titleOf) {
    const levels = upgradeLevelIds(recipe, reply);
    const infos = (reply && reply.partitionings) || [];
    const maps = (recipe.partitionings || []).map((_, i) => legacyIdMap(infos[i]));
    if (!maps.some((m) => m.size) || !Array.isArray(levels.groupOverrides) || !levels.groupOverrides.length) return levels;
    const back = maps.map((m) => new Map([...m].map(([old, now]) => [now, old])));
    const oldId = (i, id) => (back[i] && back[i].get(id)) || id;
    const oldReply = {
        ...reply,
        partitionings: infos.map((info, i) => ({ ...info, levels: (info.levels || []).map((id) => oldId(i, id)),
            categories: info.categories && info.categories.map((id) => oldId(i, id)), generatedNames: undefined, names: undefined })),
        groups: (reply.groups || []).map((g) => ({ ...g, key: isCollected(g.key) ? g.key : g.key.map((id, i) => oldId(i, id)) }))
    };
    const now = generatedGroupNames(levels, reply, titleOf);
    const was = generatedGroupNames(recipe, oldReply, titleOf);
    const names = new Set(now);
    const moved = new Map();
    was.forEach((name, i) => { if (name !== now[i] && !names.has(name)) moved.set(name, now[i]); });
    if (!moved.size) return levels;
    const have = new Set(levels.groupOverrides.map((o) => o.name));
    return { ...levels, groupOverrides: levels.groupOverrides.map((o) => (moved.has(o.name) && !have.has(moved.get(o.name))
        ? { ...o, name: moved.get(o.name) } : o)) };
}

/**
 * The name of each group (SHR-9): its generated name (`generatedGroupNames`), or the label the user gave that group
 * (`groupOverrides`, decision 38, keyed by the generated name). A label that another group already has is qualified the way
 * level duplicates are, `name (2)`: the group that is called that keeps it.
 * @returns {string[]} one per group of the reply, in its order
 */
export function groupNames(recipeIn, reply, titleOf) {
    const recipe = upgradeRecipe(recipeIn, reply, titleOf);
    const generated = generatedGroupNames(recipe, reply, titleOf);
    // what an inner grouping's groups are CALLED shows; what overrides are keyed by does not move with it
    const shown = joinedNames(recipe, reply, titleOf, false);
    const labels = new Map((Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : [])
        .filter((o) => typeof o.label === 'string' && o.label !== '').map((o) => [o.name, o.label]));
    if (!labels.size) return shown;
    const taken = new Set(shown.filter((_, i) => !labels.has(generated[i])));
    return shown.map((name, i) => {
        if (!labels.has(generated[i])) return name;
        const label = labels.get(generated[i]);
        let out = label;
        for (let n = 2; taken.has(out); n++) out = P.suffixed(label, n);
        taken.add(out);
        return out;
    });
}

/**
 * The generated name of each group, what a group's own settings are keyed by (`groupOverrides`, decision 38): its level
 * labels, renamed where the user renamed a level, joined by the separator. Two groups with one name get (2), (3) in order. A
 * level that is a group of another grouping is named by that group's GENERATED name, so a rename of it never moves a key.
 * @returns {string[]} one per group of the reply, in its order
 */
export function generatedGroupNames(recipe, reply, titleOf) {
    return joinedNames(recipe, reply, titleOf, true);
}

/** Each group's level labels joined by the separator, the same name twice qualified; `generated` keys inner groups by generated name. */
function joinedNames(recipeIn, reply, titleOf, generated) {
    const recipe = upgradeLevelIds(recipeIn, reply);
    const separator = recipe.separator === undefined ? DEFAULT_SEPARATOR : recipe.separator;
    const seen = new Map();
    return groupLabels(recipe, reply, titleOf, generated).map(({ key, labels }) => {
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

/** @type {WeakMap<Object, Object>} flags -> packed: a table's cells are packed once while the host holds one array for them */
const packed = new WeakMap();

/**
 * A set of cells shown as the request carries it: bit i & 7 of byte i >> 3, least significant first, padding bits 0.
 * Packed once per flags array (a host hands the same array while the cells are the same: their hash).
 */
// export-unused-ok: C1 sends the sets of a count plot the same way
export function packBitset(flags) {
    let out = typeof flags === 'object' && flags ? packed.get(flags) : undefined;
    if (!out) {
        out = pack(flags);
        if (typeof flags === 'object' && flags) packed.set(flags, out);
    }
    return { ...out };
}

function pack(flags) {
    const bytes = new Uint8Array((flags.length + 7) >> 3);
    for (let i = 0; i < flags.length; i++) if (flags[i]) bytes[i >> 3] |= 1 << (i & 7);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return { encoding: 'bitset-base64', length: flags.length, data: btoa(binary) };
}

/** Groupings nested below the top one in a request: a grouping that uses a grouping that uses ... (SHR-29). */
export const MAX_NESTING = 4;

/** The tables of a request, each packed once and named `s0`, `s1`, ... by the table panel that makes it. */
function tableSets() {
    const refs = new Map();
    const data = {};
    return {
        data,
        refFor(key, flags) {
            if (!refs.has(key)) {
                refs.set(key, `s${refs.size}`);
                data[refs.get(key)] = packBitset(flags);
            }
            return refs.get(key);
        }
    };
}

function wirePartitions(recipe, ctx, depth, sets) {
    if (depth > MAX_NESTING + 1) throw new Error(`Groupings nest at most ${MAX_NESTING} deep.`);
    return recipe.partitionings.map((p) => {
        const wire = computed(p);
        let source = Object.fromEntries(SOURCE_FIELDS.filter((f) => wire.source[f] !== undefined).map((f) => [f, wire.source[f]]));
        const flags = ctx && ctx.bitsetFor && p.source.type === 'table' ? ctx.bitsetFor(p.source) : null;
        if (flags) source = { type: p.source.type, ref: sets.refFor(p.source.key, flags) };
        const inline = ctx && ctx.inlineRecipe ? ctx.inlineRecipe(p.source) : null;
        if (inline && inline.recipe) source.recipe = inline.recipe;
        if (inline && inline.grouping) {
            source.recipe = { partitionings: wirePartitions(inline.grouping, ctx, depth + 1, sets), small: effectiveSmall(inline.grouping) };
        }
        const body = { source };
        if (wire.levels) body.levels = wire.levels;
        if (p.rest === 'exclude') body.rest = 'exclude';
        if (wire.binning) body.binning = wire.binning;
        return body;
    });
}

/**
 * The body of a request for the groups of a recipe (SHR-29, plan 1.2): what the server computes from, with no label,
 * separator or statistic list, and every default filled in so the body says what the engine does. A table source is
 * `{type: 'table', ref}` and its cells are one entry of the top-level `sets`, whichever partitionings use the table.
 * @param {Object} recipe - from normalizeGrouping
 * @param {{subset?: Object, features?: Object[], bitsetFor?: (source: Object) => (ArrayLike<*>|null),
 *   inlineRecipe?: (source: Object) => ({recipe: Object}|{grouping: Object}|null)}} ctx
 *   `bitsetFor` gives, per cell shown, whether a table source passes it; `inlineRecipe` gives the recipe a score source
 *   (the score route's) or a grouping source (a normalised grouping) carries in the request
 * @param {{codes?: boolean, histograms?: number[]}} want - what comes back besides the groups: the codes, and the
 *   histograms of the partitionings it names (by index)
 */
// export-unused-ok: G7's client sends this body
export function serverRequest(recipe, ctx, want) {
    const sets = tableSets();
    const request = { shape: 'grouping', partitionings: wirePartitions(recipe, ctx, 1, sets), small: effectiveSmall(recipe),
        subset: (ctx && ctx.subset) || null, want: { codes: !!want.codes, histograms: [...(want.histograms || [])] } };
    if (Object.keys(sets.data).length) request.sets = sets.data;
    if (ctx && ctx.features) request.features = ctx.features;
    return request;
}
