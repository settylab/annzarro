/**
 * The aggregates of an axis (axis-aggregate-picker-080): a Cell or Gene Plot axis that reads a SET (a gene signature or
 * gene table, a group of a cell grouping) shows as one row, `[layer] [layer name] [item] [aggregation]`. The item picker
 * lists the focused gene or cell and then the sets, in separate sections; picking a set shows a button with the
 * aggregation's symbol after it.
 *
 * What an axis stores is unchanged: a plain item is `{type: 'layer', key: <layer>, column: <item>}` and a set is its
 * provider's own setting (`{type, key, column, layer, ...}`, utils/score-source.js, utils/group-stat-source.js), so
 * links, panel sets and presets made before this row load as they were. This module says which providers are sets
 * (their `aggregate` object), turns a picker value into a setting and back, and clears an axis completely when it
 * leaves the layer source or picks a single item, so no method or layer outlives its set.
 *
 * A provider's `aggregate` is: `sections()` [{heading, entries: [{entry, text, alt?}]}], `start(entry, layer)` the
 * setting of a set newly picked on a layer, `entryOf(setting)`, `layerOf(setting)`, `methods(setting)` {options:
 * [{value, name, symbol, disabled?, title?}], chosen}, `after(setting, 'method'|'layer', value)` the fields to write
 * (with `say`), `layers(setting)` {options: [{value, text, disabled?, title?}], chosen} the row's layer list graded for the
 * aggregation held, and `symbolOf(setting)`.
 *
 * Pure apart from the registry; Node tests hold it.
 */
import { getSource, sourcesFor } from './source-registry.js';

const MARK = '\u0001';

/** The picker value of a set: its provider's type and the entry the provider names it by. */
export const encodeSet = (type, entry) => `${MARK}${type}${MARK}${entry}`;

/** The provider and entry a picker value stands for, or null for a plain item. */
export function decodeSet(value) {
    if (typeof value !== 'string' || !value.startsWith(MARK)) return null;
    const [type, entry] = value.slice(1).split(MARK);
    return getSource(type) && getSource(type).aggregate ? { type, entry } : null;
}

/** The provider of a setting that is a set, or null. */
export function aggregateOf(setting) {
    const provider = setting && setting.type ? getSource(setting.type) : null;
    return provider && provider.aggregate ? provider : null;
}

/** Whether a setting is a set. */
export const isAggregate = (setting) => !!aggregateOf(setting);

/** The source an axis row shows for a setting: a set is read on a layer. */
export const displayType = (setting) => (isAggregate(setting) ? 'layer' : setting.type);

/** The providers whose sets a consumer's axes list, in registration order. */
export function aggregateProviders(consumer, roles) {
    return sourcesFor(consumer, roles).filter((p) => p.aggregate);
}

/** The sets a consumer lists, in sections: [{heading, entries: [{value, text, alt?}]}], empty sections left out. */
export function setSections(consumer, roles) {
    const out = [];
    for (const provider of aggregateProviders(consumer, roles)) {
        for (const section of provider.aggregate.sections()) {
            if (!section.entries.length) continue;
            out.push({ heading: section.heading, entries: section.entries.map((e) => ({ value: encodeSet(provider.type, e.entry), text: e.text, alt: e.alt || '' })) });
        }
    }
    return out;
}

/** The picker value of the set a setting holds, or '' for a plain item. */
export function heldSet(setting) {
    const provider = aggregateOf(setting);
    return provider ? encodeSet(provider.type, provider.aggregate.entryOf(setting)) : '';
}

/** The layer a setting is read on. */
// export-unused-ok: Node tests hold it; the layer lists read it through the provider's `layers`
export function layerOfSetting(setting) {
    const provider = aggregateOf(setting);
    return provider ? provider.aggregate.layerOf(setting) : (setting && setting.key) || '';
}

/**
 * Take every field off a setting but its history, so nothing of what it was can outlive it: a method, a layer, a
 * label, a group's reference.
 */
export function clearSetting(setting) {
    for (const field of Object.keys(setting)) if (field !== 'history') delete setting[field];
    return setting;
}

/** The setting is now a plain item of a layer (a gene or a cell). */
export function startItem(setting, layer, column) {
    clearSetting(setting);
    Object.assign(setting, { type: 'layer', key: layer, column });
    return setting;
}

/** The setting is now the set a picker value names, read on `layer`, with the provider's own default aggregation. */
export function startSet(setting, value, layer) {
    const picked = decodeSet(value);
    if (!picked) return null;
    clearSetting(setting);
    Object.assign(setting, getSource(picked.type).aggregate.start(picked.entry, layer));
    return setting;
}

/**
 * The aggregation a user chose, or the layer they moved to: the provider writes what follows; the other moves only when
 * it became impossible, said once.
 * @returns {string} what was said of a move ('' when none)
 */
export function applyAfter(setting, kind, value) {
    const provider = aggregateOf(setting);
    if (!provider) return '';
    const { say, ...fields } = provider.aggregate.after(setting, kind, value);
    for (const [field, to] of Object.entries(fields)) {
        if (to === undefined || to === null) delete setting[field]; else setting[field] = to;
    }
    return say || '';
}

/** The symbol and name of the aggregation a set setting holds. */
export function aggregationOf(setting) {
    const provider = aggregateOf(setting);
    if (!provider) return null;
    const { options, chosen } = provider.aggregate.methods(setting);
    const held = options.find((o) => o.value === chosen) || options[0];
    return held ? { symbol: held.symbol, name: held.name } : null;
}
