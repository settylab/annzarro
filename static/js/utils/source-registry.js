/**
 * The registry of data sources that have three levels, as obsm does:
 *
 *   level 1, the source type   obsm          gene-score          (later) cell-set
 *   level 2, the entity        X_umap        a signature         a cell set
 *   level 3, the sub-key       dimension 0   an aggregation      a group
 *
 * A consumer (an axis, the colour or a hover column of a plot, later a table column)
 * stores `{type, key, column}`: the type, the entity's id and the sub-key. This is the
 * encoding obsm already has, so links, panel sets and view copy treat every provider alike.
 * An empty `column` means the provider's default sub-key, so a link made before sub-keys
 * existed keeps its meaning.
 *
 * A provider declares:
 *   type, label
 *   entity            'cells' | 'genes': what one value belongs to (a cell set would give genes)
 *   consumers         the panel types that accept it, e.g. ['cell-plot']
 *   axes              which roles accept it, e.g. ['x', 'y', 'z', 'color', 'hover']
 *   entities()        [{id, title, open}] (open or closed)
 *   subKeys(id)       [{value, label}], default first
 *   defaultSub
 *   load(setting, opts)   a series: {values, type, categories, coverage, vector}
 *
 * The built-in sources (obs, obsm, obsp, layer, var...) are not registered: they keep their
 * own handling in plot-make.js. Only providers added after them live here.
 */

const _providers = new Map();

/** Register (or replace) a provider. */
export function registerSource(provider) {
    _providers.set(provider.type, provider);
}

export function getSource(type) {
    return _providers.get(type) || null;
}

/** The providers a consumer accepts for a role, in registration order. */
export function sourcesFor(consumer, role = 'x') {
    return [..._providers.values()].filter(p => p.consumers.includes(consumer) && p.axes.includes(role));
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
