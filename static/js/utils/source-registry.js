/**
 * The registry of data sources that have three levels, as obsm does:
 *
 *   level 1, the source type   obsm          gene-score          (later) cell-group
 *   level 2, the entity        X_umap        a signature         a grouping
 *   level 3, the sub-key       dimension 0   an aggregation      (none)
 *
 * A consumer (an axis, the colour or a hover column of a plot, later a table column)
 * stores `{type, key, column}`: the type, the entity's id and the sub-key. This is the
 * encoding obsm already has, so links, panel sets and view copy treat every provider alike.
 * An empty `column` means the provider's default sub-key, so a link made before sub-keys
 * existed keeps its meaning.
 *
 * The plots' menus, loads, titles, view copy, Hover picker and large-plot mode ask the provider; none of them names a type.
 * A provider declares:
 *   type, label
 *   valueType         'numerical' | 'categorical': what its series is (the memory guard prices a colour by it)
 *   entity            'cells' | 'genes': what one value belongs to (a grouping gives cells)
 *   consumers         the panel types that accept it, e.g. ['cell-plot']
 *   axes              which roles accept it, e.g. ['x', 'y', 'z', 'color', 'hover']
 *   largeAxes         which of x, y and color a large plot (large-plot.js) draws it on; elsewhere that mode refuses
 *                     it, as it refuses any type it cannot draw (none: [] or left out)
 *   entities()        [{id, title, open, kind?}] (open or closed)
 *   keyEntries(entities, setting)
 *                     the key list of a consumer that holds `setting`: [{value, text, group?}], with what the
 *                     setting holds when its entity is gone, and `newEntity` last when there is one
 *   newEntity         optional {value, run(nextTo)}: the key list's way to make an entity beside panel
 *                     `nextTo`; run returns the new panel ({getId, getTitle}) or null
 *   subKeys(id)       [{value, label}], default first
 *   defaultSub        the sub-key an empty column means ('' when there are none)
 *   subKeyMenu        optional (setting) => {options, chosen, adopt}: the third menu. Each option is
 *                     {value, text, column, layer?} for a choice the setting stores, or {value, text, run(setting,
 *                     nextTo)} for a way somewhere that is not a choice. `adopt` ({column, layer}) is set when the
 *                     setting holds none, so the first option becomes its choice. A provider without one has no
 *                     third menu
 *   layered           optional: a setting keeps a `layer` of its own (another source drops it)
 *   load(setting, opts)
 *                     the series, opts {host, role, axis, expected, unit, signal}:
 *                       numerical    {values, type: 'numerical', coverage, vector}
 *                       categorical  {codes, MISSING, categories, colours, coverage, rankOf?, ranked?, groupNames?, values?}
 *                     A categorical series of more than GROUP_COLOURS categories is drawn in colour groups (utils/categories.js):
 *                     `rankOf` (category -> rank over every cell) decides each category's colour. `ranked` codes are
 *                     those ranks themselves, with no labels: then `groupNames` names each colour's legend entry.
 *                     `missingLabel`, optional: what the legend calls the points without a category ('Not in any
 *                     group'); 'NA' when not given
 *                     It names what it read in the setting: `label` (the entity's title, kept for when it is
 *                     gone) and, when the title has two lines, `labelFull` (joined by '\n'); titles read them, as
 *                     they cannot reach the page. A series that cannot be drawn yet throws SourceUnavailable
 *   loadLarge(setting, opts)
 *                     the series in a large plot's form, typed arrays only, never a plain array per point (opts as load's):
 *                       numerical    {type: 'numerical', vector}
 *                       categorical  {type: 'categorical', codes, MISSING, categories, colours?, rankOf?, ranked?, groupNames?}
 *   hover             optional, for a provider with the 'hover' role: the Hover picker's group and a hover line
 *                       group           the picker's heading for its entries ('Gene scores')
 *                       options(kept)   [{value, label}]: its entries, then any value in `kept` (picker values chosen
 *                                       now) it no longer offers, kept and marked
 *                       valueOf(setting)  the picker value of a stored hover entry: `${type}:...`
 *                       parse(value)    the setting a picker value stands for, without its type: {key, column?, layer?}
 *                       label(setting)  what its hover line is called ("T cell score"): "<label>: <value>"
 *   titleOf(setting)  the source as a coverage line names it ("gene score T cell score")
 *   placeholder(host, notice)
 *                     draws an axis that cannot be drawn: the placeholder says why, with the way out
 *   vocabulary        {result}: what the source makes, in a sentence ('score')
 *
 * The built-in sources (obs, obsm, obsp, layer, var...) are not registered: they keep their
 * own handling in plot-make.js. Only providers added after them live here.
 */

const _providers = new Map();

/** The sources every dataset has, read by plot-make.js itself; any other type is a provider's. */
const BUILT_IN = new Set(['none', 'obs', 'obsm', 'obsp', 'layer', 'var', 'varm', 'varp']);

/** What starts the value of an entry a built-in type's key list holds for a provider (never stored: it is a way to choose). */
const ALSO = '\u0001';

/**
 * The entries a built-in type's key list adds for the providers listed under it too (a grouping under obs, UX 5), for a
 * consumer's roles: each entity as `{value, text, group}`, grouped under the provider's `alsoListedGroup`. Choosing one
 * switches the type select to the provider's type (parseAlsoListed); the value itself is never stored.
 * @param {string} builtIn - 'obs'
 * @param {string} consumer - a panel type, e.g. 'cell-plot'
 * @param {string[]} roles
 */
export function alsoListedEntries(builtIn, consumer, roles) {
    return sourcesFor(consumer, roles).filter(p => p.alsoListedUnder === builtIn && p.alsoListedGroup)
        .flatMap(p => p.entities().map(e => ({ value: `${ALSO}${p.type}${ALSO}${e.id}`, text: e.title, group: p.alsoListedGroup })));
}

/**
 * The provider's type and entity an entry of alsoListedEntries stands for, or null for any other value.
 * @param {string} value
 * @returns {{type: string, key: string}|null}
 */
export function parseAlsoListed(value) {
    if (typeof value !== 'string' || !value.startsWith(ALSO)) return null;
    const [type, key] = value.slice(ALSO.length).split(ALSO);
    return getSource(type) && key ? { type, key } : null;
}

/** Register (or replace) a provider. */
export function registerSource(provider) {
    _providers.set(provider.type, provider);
}

export function getSource(type) {
    return _providers.get(type) || null;
}

/**
 * Whether a setting's type is a provider's rather than a built-in source, registered or not (a link may name a
 * provider this page has not loaded).
 * @param {string} type
 */
export function isProviderType(type) {
    return !!type && !BUILT_IN.has(type);
}

/** What a large plot draws of the built-in sources, per axis (large-plot.js); a provider says it in `largeAxes`. */
const LARGE_BUILT_IN = Object.freeze({
    x: Object.freeze(['obsm', 'obs', 'layer']),
    y: Object.freeze(['obsm', 'obs', 'layer']),
    color: Object.freeze(['obsm', 'obs', 'layer', 'none'])
});

/**
 * Whether a large plot can draw a source type on an axis: a built-in source it reads, or a provider registered here
 * that names the axis in its `largeAxes`.
 * @param {string} type
 * @param {'x'|'y'|'color'} axis
 */
export function largeAccepts(type, axis) {
    if ((LARGE_BUILT_IN[axis] || []).includes(type)) return true;
    const provider = !BUILT_IN.has(type) ? getSource(type) : null;
    return !!provider && Array.isArray(provider.largeAxes) && provider.largeAxes.includes(axis);
}

/** The providers whose entries a consumer's Hover picker lists, in registration order. */
export function hoverSources(consumer) {
    return sourcesFor(consumer, ['hover']).filter(p => p.hover);
}

/**
 * The providers a consumer accepts for every one of its roles, in registration order.
 * @param {string} consumer - a panel type, e.g. 'cell-plot'
 * @param {string[]|string} roles - e.g. ['x'] for an axis, ['color'] for the colour; one role alone may be a string
 */
export function sourcesFor(consumer, roles) {
    const wanted = Array.isArray(roles) ? roles : [roles];
    return [..._providers.values()].filter(p => p.consumers.includes(consumer) && wanted.every(role => p.axes.includes(role)));
}

/** The layer a consumer reads a score over: its own choice, or '' for the signature's input. */
export function layerOf(setting) {
    return setting && setting.layer ? String(setting.layer) : '';
}

/** The sub-key a setting stands for: its column, or the provider's default. */
export function subKeyOf(setting) {
    const provider = setting && getSource(setting.type);
    if (!provider) return setting && setting.column ? String(setting.column) : '';
    return setting.column ? String(setting.column) : provider.defaultSub;
}

/**
 * The name a title gives a provider's setting: what its load wrote (`labelFull`, its lines joined by `joiner`; else
 * `label`), else the entity's id until its title is known.
 * @param {{key?: string, label?: string, labelFull?: string}} setting
 * @param {string} joiner - '<br>' for a colour bar, ' · ' for an axis
 */
export function settingTitle(setting, joiner) {
    return setting.labelFull ? setting.labelFull.replace('\n', joiner) : (setting.label || setting.key || '');
}

/**
 * A provider's series that cannot be drawn yet, and why: a colour falls back to neutral points, an axis to the
 * provider's placeholder, both with the notice over the plot. `state` is the provider's state name, `type` the
 * provider's type (whose placeholder an axis draws).
 */
export class SourceUnavailable extends Error {
    constructor(text, notice, coverage, state = null, type = null) {
        super(text);
        this.name = 'SourceUnavailable';
        this.notice = notice;
        this.coverage = coverage;
        this.state = state;
        this.type = type;
    }
}

/**
 * The regular plot's form of a provider's series: a categorical one as one label per point (null where it has
 * none), with its categories and stored colours; a numerical one as is.
 * @param {Object} series - what a provider's load returned
 */
export function plotSeries(series) {
    if (series.type !== 'categorical') {
        return { values: series.values, type: series.type, categories: null, coverage: series.coverage, rankOf: null, ranked: false,
            groupNames: null, colours: null, missingLabel: null };
    }
    const { codes, MISSING } = series;
    // ranked codes have no labels: each point's value is its rank, as the plot's own ranked categories are
    const ranked = !!series.ranked;
    const categories = ranked ? null : series.categories;
    const values = series.values || Array.from(codes, c => (c === MISSING ? null : ranked ? c : categories[c]));
    return { values, type: 'categorical', categories, coverage: series.coverage, rankOf: series.rankOf || null,
        ranked, groupNames: series.groupNames || null, colours: series.colours || null, missingLabel: series.missingLabel || null };
}
