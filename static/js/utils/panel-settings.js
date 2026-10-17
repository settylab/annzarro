/**
 * Copy a config into a panel's settings without touching read-only views.
 *
 * A table panel's settings carry two getters that read the live DataTable
 * (`searchBuilderConfig`, `currentEntries`; table-data.js defines them). The
 * tables' updateConfig assigned every known key, so a whole getConfig()
 * handed back (the tile's controls toggle did that) threw
 *   Cannot set property searchBuilderConfig of #<Object> which has only a getter
 * Seen on every deep-linked table with an Advanced Search filter once its
 * controls were collapsed.
 *
 * Only keys the settings already have are copied (as before), and accessor
 * properties without a setter are left alone.
 *
 * @param {Object} settings - the panel's settings, updated in place
 * @param {Object} config - incoming values
 * @param {string[]} [skip] - keys handled by the caller (e.g. 'title')
 * @returns {Object} settings
 */
export function assignKnownSettings(settings, config, skip = ['title']) {
    if (!config) return settings;
    Object.keys(config).forEach(key => {
        if (skip.includes(key) || settings[key] === undefined) return;
        const desc = Object.getOwnPropertyDescriptor(settings, key);
        if (desc && desc.get && !desc.set) return;
        settings[key] = config[key];
    });
    return settings;
}

/**
 * A table panel's getConfig(): `head` (its title), then its settings, with
 * the live views of the DataTable left as getters. Read only when a caller
 * reads them: `currentEntries` lists every row passing the filter, about
 * 50 ms at 1M rows, and the spread `{...settings}` read it on every
 * getConfig(), which the column chooser does on each focus change and the
 * autosave and the address bar on every save (the most of 0.5 s per focus
 * change at 1M cells, for a list nothing there used).
 * @param {Object} settings - the panel's settings
 * @param {Object} [head] - keys put first (settings of the same name win, as in a spread)
 * @returns {Object}
 */
export function configOf(settings, head = {}) {
    const out = { ...head };
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(settings))) {
        if (!desc.enumerable) continue;
        if (desc.get) {
            // a copy, as the spread made: writing to it sets its own value, never the panel's
            Object.defineProperty(out, key, { enumerable: true, configurable: true, get: () => settings[key],
                set: (value) => { Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true }); } });
        }
        else out[key] = desc.value;
    }
    return out;
}
