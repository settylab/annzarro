/**
 * What a panel set's Load buttons do, as data (no DOM, no fetch), so the Node
 * suite tests the rules the Load dialog and the welcome list both draw.
 *
 * One primary button, "Load", restores the set exactly as a share link would:
 * it switches to the set's dataset and opens every panel that was open when
 * the set was saved, in its layout. Two small icon buttons are its ablations:
 * `current` (keep the open dataset, open the panels there) and `add` (keep
 * dataset and open panels, only add the set's panels to the closed list).
 *
 * When the set's dataset is not on this server, "switch dataset" has nothing
 * to switch to: the primary becomes "Load on the current dataset" (or, with
 * no dataset open, "Choose dataset..."), and a `choose` icon loads the set
 * onto any store the user picks.
 */

export const MODES = ['full', 'current', 'add', 'choose'];

/** The icons (Font Awesome) each mode wears, here so the help popover shows the same. */
export const MODE_ICONS = {
    full: 'fa-arrow-right-to-bracket',
    current: 'fa-thumbtack',
    add: 'fa-folder-plus',
    choose: 'fa-database'
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The status badge of a card: where the set's dataset is.
 * @param {{named?: string|null, found?: boolean|null, foundPath?: string|null,
 *          repointed?: Object|null, refused?: Object|null, failed?: Object|null}|null} status
 * @returns {{state: 'ok'|'missing'|'unnamed'|'pending', text: string, title: string}}
 */
export function describeStatus(status) {
    if (!status) return { state: 'pending', text: '', title: 'Checking whether the dataset is here...' };
    const named = status.named || null;
    if (!named) {
        return { state: 'unnamed', text: '',
            title: 'This set names no dataset: it loads onto the open one.' };
    }
    if (status.found) {
        const moved = status.repointed && status.foundPath
            ? ` ${named} is not on this server by that name; ${status.foundPath} has the same ` +
              'cells and genes, and Load opens it.'
            : '';
        return { state: 'ok', text: '✓ available here',
            title: `The set's dataset, ${named}, is on this server.${moved}` };
    }
    let why;
    if (status.refused) {
        why = `${named} is outside the data directory this server shares, so it cannot be opened here.`;
    } else if (status.failed) {
        why = `${named} could not be read: ${status.failed.error || 'unknown error'}.`;
    } else {
        why = `${named} is not on this server, and no store in its data directory has the same cells and genes.`;
    }
    return { state: 'missing', text: 'not found here',
        title: `${why} Load uses the open dataset instead, or choose another.` };
}

/**
 * The buttons of a card, given what is known about its set.
 * @param {{found?: boolean|null, hasCurrent?: boolean, currentName?: string,
 *          open?: number|null, total?: number|null}} status
 *   found: true (its dataset is here), false (not), null (not known yet, or
 *   the set names none); hasCurrent: a dataset is open; open/total: the
 *   panels open at save / all its panels.
 * @returns {{primary: {mode: string, label: string, title: string},
 *            actions: Array<{mode: string, icon: string, label: string, title: string,
 *                            visible: boolean, enabled: boolean}>}}
 */
export function loadChoices(status = {}) {
    const { found = null, hasCurrent = false, currentName = '', open = null, total = null } = status;
    const missing = found === false;
    // "switch to the set's dataset" is possible: it is here, or the set
    // names none and the open one is used
    const canSwitch = !missing && (found === true || hasCurrent);
    const none = open === 0;
    const cur = currentName ? `the open dataset (${currentName})` : 'the open dataset';
    const panels = open === null ? 'its panels' : plural(open, 'panel');
    const keepNote = 'Panels it replaces stay in the closed list.';

    let primary;
    if (canSwitch) {
        primary = none
            ? { mode: 'full', label: 'Load (no panels were open)',
                title: 'Load: no panel was open when this set was saved, so switch to its dataset and ' +
                       `list its ${plural(total || 0, 'panel')} closed.` }
            : { mode: 'full', label: 'Load',
                title: `Load: switch to the set's dataset and open ${panels} in the saved layout, as a ` +
                       `share link would. ${keepNote}` };
    } else if (hasCurrent) {
        primary = { mode: 'current', label: 'Load on the current dataset',
            title: `Load on the current dataset: the set's dataset is not here, so open ` +
                   `${none ? 'the set (no panel was open, so its panels are listed closed)' : panels} ` +
                   `on ${cur}. ${keepNote}` };
    } else {
        primary = { mode: 'choose', label: 'Choose dataset\u2026',
            title: 'Choose dataset: no dataset is open and the set\'s own is not here. ' +
                   'Pick one on this server and the set loads onto it.' };
    }

    const actions = [
        { mode: 'current', icon: MODE_ICONS.current, label: 'Load on the current dataset',
          visible: primary.mode !== 'current', enabled: hasCurrent,
          title: hasCurrent
            ? `Load on the current dataset: keep ${cur} and open ${panels} in the saved layout there. ${keepNote}`
            : 'Load on the current dataset is not available: no dataset is open.' },
        { mode: 'add', icon: MODE_ICONS.add, label: 'Add panels closed',
          visible: true, enabled: true,
          title: 'Add panels closed: keep the dataset and the open panels; add the set\'s ' +
                 `${total === null ? 'panels' : plural(total, 'panel')} to the closed list.` },
        { mode: 'choose', icon: MODE_ICONS.choose, label: 'Choose dataset\u2026',
          visible: missing && primary.mode !== 'choose', enabled: true,
          title: 'Choose dataset: pick any dataset on this server and load the set onto it, ' +
                 'opening its panels.' }
    ];
    return { primary, actions };
}

/**
 * The options SessionManager.loadSession applies for a button's mode.
 * `choose` also needs the dataset the user picks (`onDataset`).
 * @param {string} mode
 * @returns {{add: boolean, keepDataset: boolean, choose: boolean}}
 */
export function modeOptions(mode) {
    switch (mode) {
        case 'current': return { add: false, keepDataset: true, choose: false };
        case 'add': return { add: true, keepDataset: true, choose: false };
        case 'choose': return { add: false, keepDataset: false, choose: true };
        case 'full':
        default: return { add: false, keepDataset: false, choose: false };
    }
}
