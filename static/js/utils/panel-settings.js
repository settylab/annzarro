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
