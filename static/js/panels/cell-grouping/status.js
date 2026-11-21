/**
 * The status zone of a Cell Grouping (UX 2.3, UX 2.6, GRP-7, GRP-11, GRP-14, GRP-15, GRP-16, SHR-12, SHR-13, SHR-34):
 * what the grouping's own snapshot says, in one line with its buttons, the small-groups line, "in no group" as a
 * button that lists the reasons, and who uses the grouping.
 *
 * Pure: a snapshot (utils/group-sources.js `watch(...).read()`) and the recipe in, the words and the actions out, so
 * Node tests hold every state. panels/cell-grouping.js draws it.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { GROUPING_LIMITS } from '../../utils/cell-grouping.js';
import { compactCount } from '../../utils/coverage.js';
import { durationText } from '../../utils/source-notices.js';
import { factorKind, tooManyLevelsText } from './factors.js';

const W = VOCABULARY.word;
const P = VOCABULARY.phrase;
const fmt = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => (n === 1 ? one : many);

/** "Grouping 1 and Table 2", "A, B and C". */
function listText(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A short duration for the status line: "40 s", "3 min". */
function shortDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return 'a while';
    return s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`;
}

/** The totals of a computed grouping (UX 2.3): "28 groups · 8,012 of 8,090 cells in a group", and the cells in none. */
function totalsLine(reply) {
    const groups = Array.isArray(reply.groups) ? reply.groups.length : 0;
    const shown = Number(reply.n_shown) || 0;
    const grouped = typeof reply.n_grouped === 'number' ? reply.n_grouped
        : (reply.groups || []).reduce((sum, g) => sum + (Number(g.n) || 0), 0);
    return { text: `${VOCABULARY.count(groups, 'group')} · ${fmt(grouped)} of ${fmt(shown)} cells in a ${W.group}`,
        noGroup: Math.max(0, shown - grouped) };
}

/** The small-groups line (SHR-12), or null when no group is small. */
export function smallLine(reply) {
    const small = reply && reply.small;
    const n = small ? Number(small.n_small) || 0 : 0;
    if (!n) return null;
    const head = `${n} ${plural(n, W.smallGroup, `${W.smallGroup}s`)} (under ${small.threshold} cells)`;
    if (small.mode === 'collect') return `${head}, collected into "${P.smallGroups(small.threshold)}"`;
    if (small.mode === 'hide') return `${head}, hidden: their cells are in no ${W.group}`;
    return `${head}, kept`;
}

/**
 * Why cells are in no group: each factor that leaves cells out (its levels' cells fall short of the cells shown), and
 * the hidden small groups. A cell may be left out by more than one factor, so the lines are not a sum.
 * @param {Object} recipe
 * @param {Object} reply - as the group store reads it (levels with their counts apart)
 * @param {(i: number) => string} nameOf - the short name of factor i's source (a table's title)
 * @returns {string[]}
 */
export function noGroupReasons(recipe, reply, nameOf) {
    const out = [];
    const shown = Number(reply.n_shown) || 0;
    recipe.partitionings.forEach((p, i) => {
        if (p.rest !== 'exclude') return;
        const info = reply.partitionings && reply.partitionings[i];
        if (!info || !Array.isArray(info.counts)) return;
        const counted = info.counts.reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
        const n = shown - counted;
        if (n <= 0) return;
        const kind = factorKind(p);
        const name = nameOf(i);
        out.push(kind === 'table' ? `${fmt(n)} are ${P.notInTable(name)}`
            : kind === 'binned' ? `${fmt(n)} have ${W.noValue} for ${name}`
                : `${fmt(n)} are in no ticked ${W.level} of ${name}`);
    });
    const small = reply.small;
    if (small && small.mode === 'hide' && small.n_small > 0) {
        const n = small.n_small;
        out.push(`${n} ${plural(n, W.smallGroup, `${W.smallGroup}s`)} (under ${small.threshold} cells) ${plural(n, 'is', 'are')} hidden`);
    }
    return out;
}

const KIND_OF_USER = [
    [/^(cell-plot|gene-plot|cell-gene|cell-count)$/, 'plot'], [/^(cell-table|gene-table)$/, 'table'], [/^cell-grouping$/, W.grouping]
];

/** "Used by 2 plots, 1 table" (GRP-7), from the users of panel-references.js `usersOf`. */
export function usedByText(users) {
    if (!users || !users.length) return '';
    const counts = new Map([['plot', 0], ['table', 0], [W.grouping, 0], ['panel', 0]]);
    for (const u of users) {
        const found = KIND_OF_USER.find(([re]) => re.test(u.kind));
        const kind = found ? found[1] : 'panel';
        counts.set(kind, counts.get(kind) + 1);
    }
    const parts = [...counts].filter(([, n]) => n).map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`);
    return `Used by ${parts.join(', ')}`;
}

const action = (id, label) => ({ id, label });

/**
 * The status of a grouping: one line and its buttons, for every state of UX 2.6.
 * @param {Object} input
 * @param {Object} input.recipe - normalised
 * @param {?Object} input.snap - the panel's own handle's snapshot (null when nothing is watched)
 * @param {?Object} [input.header] - the store's header of a refused result (its `refused` figures)
 * @param {number} input.cells - cells shown
 * @param {(i: number) => string} input.nameOf - the short name of factor i
 * @param {number[]} input.missing - the factors whose source the dataset lacks
 * @param {string[]} [input.cycleIds] - the panels on a cycle through this one
 * @param {string} [input.self] - this panel's id
 * @param {boolean} [input.loopUndo] - the last edit closed the loop: Undo undoes it (operator decision 16)
 * @param {(key: string) => (number|null)} [input.obsmWidth] - an obsm matrix's columns
 * @param {(id: string) => string} [input.tableTitle] - a table's title, for a table whose filter is not known yet
 * @param {string} [input.gateTable] - the table a gate waits on
 * @returns {{state: string, text: string, actions: {id: string, label: string}[], noGroup?: number,
 *   card?: {index: number, text: string}}}
 */
export function describeStatus(input) {
    const { recipe, snap, cells, nameOf, missing = [] } = input;
    const out = (state, text, actions = [], extra = {}) => ({ state, text, actions, ...extra });
    if (!recipe.partitionings.length) return out('empty', `Add a ${W.factor} to divide the cells into ${VOCABULARY.plural.group}.`);
    if (missing.length) {
        return out('missing', `Nothing computed until ${listText(missing.map(nameOf))} ${missing.length === 1 ? 'is' : 'are'} replaced or removed.`);
    }
    if (!snap) return out('estimating', `Grouping ${compactCount(cells)} cells…`);
    if (snap.state === 'off') return out('off', 'Cell Grouping is turned off on this server.');
    if (snap.state === 'cycle') return cycleStatus(input);

    const held = snap.held && (snap.state === 'ready' || snap.state === 'updating') ? snap.held : null;
    if (held) {
        const wide = recipe.partitionings.findIndex((p) => p.source.type === 'obsm' && input.obsmWidth && input.obsmWidth(p.source.key) > 1);
        if (wide >= 0) {
            const key = recipe.partitionings[wide].source.key;
            return out('held', `${nameOf(wide)} reads all ${fmt(input.obsmWidth(key))} columns of ${key}: about ${shortDuration(held.seconds)}.`,
                [action('update', 'Update groups')]);
        }
        const n = held.edits || 1;
        return out('held', `${n} ${plural(n, 'change', 'changes')} not applied. About ${shortDuration(held.seconds)}.`, [action('update', 'Update groups')]);
    }
    switch (snap.state) {
        case 'ready': {
            const reply = snap.values && snap.values.reply;
            if (!reply) return out('ready', '');
            const totals = totalsLine(reply);
            return out('ready', totals.text, [], { noGroup: totals.noGroup });
        }
        case 'awaiting':
            return out('awaiting', `Grouping ${compactCount(cells)} cells will take ${durationText(snap.estimate && snap.estimate.seconds)}.`,
                [action('compute', 'Compute'), action('cancel', 'Not now')]);
        case 'refused': return refusedStatus(input);
        case 'failed':
            return out('failed', `Groups could not be computed: ${stripStop(snap.message || snap.reason || 'the server did not answer')}.`,
                [action('retry', 'Retry')]);
        case 'cancelled': return out('cancelled', `${VOCABULARY.plural.group[0].toUpperCase()}${VOCABULARY.plural.group.slice(1)} not computed: cancelled.`,
            [action('retry', 'Compute')]);
        case 'building': case 'ask': return tableStatus(input);
        case 'deleted': return out('deleted', 'This grouping is gone.');
        default:
            if (snap.gate || input.gateTable) return tableStatus(input);
            return out(snap.state === 'updating' ? 'computing' : snap.state, `Grouping ${compactCount(cells)} cells…`, [action('cancel', 'Cancel')]);
    }
}

const stripStop = (text) => String(text).replace(/\.\s*$/, '');

function cycleStatus({ snap, cycleIds = [], self, loopUndo }) {
    const titles = [];
    const ids = [];
    (snap.cycle || []).forEach((title, i) => {
        const pid = cycleIds[i];
        if (pid ? ids.includes(pid) : titles.includes(title)) return;
        titles.push(title);
        ids.push(pid || null);
    });
    const actions = loopUndo ? [action('undo', 'Undo')] : [];
    ids.forEach((pid, i) => { if (pid && pid !== self) actions.push(action(`open:${pid}`, `Open ${titles[i]}`)); });
    return { state: 'cycle', text: `${listText(titles)} depend on each other.`, actions };
}

function refusedStatus({ recipe, snap, header, nameOf }) {
    const refused = (header && header.refused) || null;
    const reason = (refused && refused.reason) || snap.reason;
    if (reason === 'too_many_groups' && refused) {
        const levels = Array.isArray(refused.levels) ? refused.levels : [];
        let k = -1;
        levels.forEach((n, i) => { if (k < 0 || n > levels[k]) k = i; });
        const most = k >= 0 ? ` ${nameOf(k)} has ${fmt(levels[k])} ${VOCABULARY.plural.level}.` : '';
        const actions = [];
        if (k >= 0 && factorKind(recipe.partitionings[k] || {}) !== 'binned') actions.push(action(`levels:${k}`, `Choose levels of ${nameOf(k)}`));
        if (recipe.partitionings.some((p) => factorKind(p) === 'binned')) actions.push(action('binfewer', 'Bin fewer'));
        return { state: 'refused', text: `${fmt(refused.count)} ${VOCABULARY.plural.group}: a ${W.grouping} holds up to ${fmt(refused.limit || GROUPING_LIMITS.groups)}. `
            + `Nothing was computed.${most}`, actions };
    }
    if (reason === 'too_many_levels' && refused && Number.isInteger(refused.partitioning)) {
        const i = refused.partitioning;
        return { state: 'refused', text: `${nameOf(i)} has ${fmt(refused.count)} ${VOCABULARY.plural.level}; a ${W.factor} holds up to `
            + `${fmt(refused.limit || GROUPING_LIMITS.levels)}. Nothing was computed.`, actions: [],
        card: { index: i, text: tooManyLevelsText(nameOf(i), refused.count) } };
    }
    return { state: 'refused', text: snap.message || (header && header.message) || 'Nothing was computed.', actions: [] };
}

function tableStatus({ snap, tableTitle, gateTable }) {
    const gate = snap.gate || {};
    const title = gateTable && tableTitle ? tableTitle(gateTable) : 'the table';
    const open = gateTable ? [action(`open:${gateTable}`, 'Open table')] : [];
    if (snap.state === 'ask') {
        const rows = gate.rows ? ` (${fmt(gate.rows)} rows)` : '';
        return { state: 'ask', text: `'${title}' needs a click to build its filter${rows}.`, actions: [action('compute', 'Build filter'), ...open] };
    }
    if (snap.state === 'refused') return { state: 'refused', text: snap.message || `'${title}' cannot be built here.`, actions: open };
    if (snap.state === 'failed') return { state: 'failed', text: `Groups could not be computed: ${stripStop(snap.message || 'the table could not be built')}.`, actions: [action('retry', 'Retry'), ...open] };
    return { state: 'building', text: `Building '${title}'…`, actions: open };
}
