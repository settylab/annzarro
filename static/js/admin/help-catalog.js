/**
 * The help of the admin settings that are not keys of the policy registry: the fields of the
 * Users and Access dialogs and of the Data sources section. A registry key brings its own
 * `description` and `guide` from the server (annzarro/server/policy/registry.py); these are
 * the same kind of text for the rest, one entry per control.
 *
 * `guide` is a page of the docs and an anchor on it. tests/server/test_admin_help_docs.py
 * checks that each anchor exists in the docs sources, so write the anchor in the docs first.
 */

import { settingHelp } from './help.js';

const ADMIN = 'deployment/admin.html';

export const CONTROLS = {
    'user.username': {
        title: 'Username',
        text: 'The name the person signs in with: letters, digits and . _ @ - , up to 64 characters.',
        guide: `${ADMIN}#user-field-username`,
    },
    'user.password': {
        title: 'Password',
        text: 'Generate makes a random password that is shown once. Set takes one you type: at least 10 characters and different from the username. Setting a new password ends the user\'s other logins.',
        guide: `${ADMIN}#user-field-password`,
    },
    'user.admin': {
        title: 'Administrator',
        text: 'Whether the account may open the admin pages. Off by default. The last administrator, and your own account, cannot lose the right in the browser.',
        guide: `${ADMIN}#user-field-admin`,
    },
    'user.reassign': {
        title: 'Hand the panel sets to',
        text: 'The user who takes over the removed user\'s saved panel sets. By default they stay under the old owner\'s name, where only an administrator can change them.',
        guide: `${ADMIN}#user-field-reassign`,
    },
    'access.restricted': {
        title: 'Restricted to these datasets',
        text: 'Off by default: the user reads every dataset in the data directories. On, the user reads only what is granted below, and nothing until a grant is active. Administrators are never restricted.',
        guide: `${ADMIN}#access-field-restricted`,
    },
    'access.grant': {
        title: 'Grant',
        text: 'Gives a restricted user a folder with everything below it, every store in a folder, one store, or a remote prefix. A grant is active only while its real path lies inside a data directory.',
        guide: `${ADMIN}#access-field-grant`,
    },
    'access.check': {
        title: 'Check a path',
        text: 'Asks the server whether this user can read a path or URL, and why: which grant covers it, or why none does. Nothing is changed.',
        guide: `${ADMIN}#access-field-check`,
    },
    'data.parents': {
        title: 'Allowed parents',
        text: 'The directories, set as server.admin_data_roots in the config file, inside which an administrator may add data directories. Empty by default: adding is then off.',
        guide: `${ADMIN}#data-field-parents`,
    },
    'data.add-directory': {
        title: 'Add a directory',
        text: 'Adds a data directory below an allowed parent. The server reads datasets from it at once, without a restart. Directories from the config file cannot be removed here.',
        guide: `${ADMIN}#data-field-add-directory`,
    },
};

/**
 * The help mark and Guide link of a control of CONTROLS.
 * @param {string} id
 * @param {Object} [opts] - see help.js helpMark
 * @returns {Array<HTMLElement>}
 * @throws {Error} for an id that is not in CONTROLS (a control must not ship without help)
 */
export function controlHelp(id, opts) {
    const entry = CONTROLS[id];
    if (!entry) throw new Error(`No help for the admin control ${id}`);
    return settingHelp(entry, opts);
}

/** The help of a registry key as the server sends it. */
export function keyHelp(key, title, opts) {
    const configFile = key.config_file ? { path: key.config_file, setting: key.config_file_setting !== false, name: key.name } : null;
    return settingHelp({ title, text: key.description || title, guide: key.guide }, { ...opts, configFile });
}
