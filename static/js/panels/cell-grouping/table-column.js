/**
 * A Cell Grouping as a column of a Cell Table (CAT-6, CAT-7, SHR-34): the TABLE HALF of the `cell-group` provider
 * (utils/table-source.js describes what a table asks of it). utils/cell-group-source.js registers it, and hands it what
 * it already has (the page's group sources, the list of groupings, a grouping's title and notice, Open grouping), so this
 * module imports neither the provider nor the page and Node tests hold it with fakes.
 *
 * The column reads the grouping's groups as a consumer of kind `table`, through the page's ONE group sources
 * (utils/group-host.js): a table, a plot and the grouping's own panel that need the same groups share one request and one
 * copy of the codes. What it shows:
 *
 * - each cell's group by name, as the grouping names it (SHR-9), and "Not in any group" for a cell in no group (SHR-5);
 * - sorted in group order, not by name: a group's code is its place in group order, so its rank is its code;
 * - filtered with the categorical conditions of SearchBuilder: "Equals" lists the groups (`listsCategories`), as it lists
 *   an obs column's categories. A grouping holds at most 2,000 groups;
 * - while the groups are not there, the states of a score column (utils/score-column.js), in a grouping's words, and its
 *   rows held while the table's filter reads it (CAT-6).
 *
 * A table that filters on a group column is a binary partitioning for another grouping like any filtered table (CAT-7).
 * A table that FILTERS on a grouping that is built from that table is a loop (SHR-34); one that only shows its column is
 * not (each cell's group beside its row). So the column chooser offers that grouping with a note saying it cannot be
 * filtered here, and the condition builder leaves the column out (`filterable`, operator decision 15). A loop that no
 * menu could prevent (a link, a session, a condition made before the grouping used the table) computes nothing and
 * shows the cycle state, naming the panels. A loop through a table and a grouping has no gene list to split at, so its
 * notice offers Open grouping and Remove this filter (the conditions on the column), never a fixed copy (decision 18);
 * a table has no undo.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { wouldLoop } from '../../utils/panel-references.js';

const W = VOCABULARY.word;
const PL = VOCABULARY.plural;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The type of the source, as a column stores it and as its chooser tab is called (UX 5). */
const TAB = 'cell-group';

/** What the column calls its groups while it has none (utils/table-source.js `words`). */
const GROUP_WORDS = Object.freeze({ the: `the ${PL.group}`, none: `no ${PL.group}`, ready: `the ${PL.group} are ready` });

/** What a cell in no group says in the column (SHR-5, UX 6.1). */
const NOT_IN_ANY_GROUP = capital(W.notInAnyGroup);

/**
 * Why a grouping built from this table cannot be filtered on here: a condition on it would close a loop (operator
 * decision 15). The column itself can be shown: it is no edge (utils/panel-references.js `source`).
 */
const cannotFilter = (title) => `Can't be filtered here: ${title} depends on this table`;

/** The states in which a column has no groups and will not get any by waiting: its notice offers to remove it. */
const REMOVABLE = new Set(['deleted', 'off', 'failed', 'refused', 'cancelled', 'nofactors']);

/** names -> each group's rank: the group order is the codes' order, so a group's rank is its code. Once per names. */
const RANKS = new WeakMap();

function rankOf(names) {
    let rank = RANKS.get(names);
    if (!rank) {
        rank = Array.from({ length: names.length }, (_, i) => i);
        RANKS.set(names, rank);
    }
    return rank;
}

/**
 * The table half of the `cell-group` provider.
 * @param {Object} deps
 * @param {() => {watch: Function, namesOf: Function, update: Function, visibilityChanged: Function}} deps.sources - the
 *   page's group sources (utils/group-host.js `groupSources().sources`), asked when first needed
 * @param {(setting: {key: string, label?: string}) => string} deps.titleOf - a grouping's title, or what it was called
 *   when last seen
 * @param {(id: string) => ({getTitle: () => string}|null)} deps.groupingPanel - the grouping panel with this id
 * @param {(snap: Object, ctx: {role: string, sharers: number}) => (Object|null)} deps.describe - a grouping's notice
 *   (utils/source-notices.js describeSource in the grouping's words)
 * @param {(id: string, nextTo: (string|null)) => Object|null} deps.open - Open grouping, beside a panel
 * @param {(codes: ArrayBufferView) => number} deps.missingOf - the code of a cell in no group, for codes of this width
 */
export function createGroupTable({ sources, titleOf, groupingPanel, describe, open, missingOf }) {
    /**
     * What a table reads of a grouping's snapshot (utils/table-source.js): the codes, the group names and their ranks
     * when the groups are there; the state and its fields always. Never `values`: a table reads that as numbers. Made
     * per read from what is held, so nothing here grows with the cells or the groups.
     */
    function view(id, snap) {
        const values = snap && snap.values;
        const out = { ...snap, values: null, words: GROUP_WORDS };
        if (!values || !values.codes || !values.reply) return out;
        const names = sources().namesOf(id, values.reply);
        out.codes = values.codes;
        out.categories = names;
        out.MISSING = missingOf(values.codes);
        out.rank = rankOf(names);
        out.missingLabel = NOT_IN_ANY_GROUP;
        return out;
    }

    /** The column's name: the grouping's title, written into the column so it is kept for when the grouping is gone. */
    function label(column) {
        const panel = groupingPanel(column.key);
        if (panel) column.label = panel.getTitle();
        return titleOf(column);
    }

    return {
        tab: TAB,
        listsCategories: true,

        watch(column, { host, visible, onChange }) {
            const id = column.key;
            const handle = sources().watch(id, {
                consumer: { kind: 'table', role: 'column', panelId: host, host }, option: { codes: true },
                visible, onChange: (snap) => onChange(view(id, snap))
            });
            return {
                read: () => view(id, handle.read()),
                release: () => handle.release(),
                sharers: () => handle.sharers(),
                compute: () => handle.compute(),
                retry: () => handle.retry(),
                cancel: () => handle.cancel()
            };
        },

        visibilityChanged: () => sources().visibilityChanged(),
        update: (column) => sources().update(column.key),
        label,
        fullLabel: label,

        /**
         * The notice of a column whose groups are not there: the grouping's own, read as a column. A table has no other
         * grouping to choose, so where there are no groups it offers to remove the column, which also ends a loop
         * through it (the filter's conditions on the column go with it).
         */
        describe(snap, { sharers = 1 } = {}) {
            const notice = describe(snap, { role: 'column', sharers });
            if (!notice) return null;
            const actions = notice.actions.filter(([action]) => action !== 'score-choose');
            // a loop through a table runs through a condition on the column: removing the conditions ends it
            if (notice.state === 'cycle') actions.push(['score-unfilter', 'Remove this filter']);
            else if (REMOVABLE.has(notice.state)) actions.push(['score-remove', 'Remove column']);
            return { ...notice, actions };
        },

        open: (column, hostId) => open(column.key, hostId),

        /** Whether a condition on the column may be built in this table: not when the grouping is built from it. */
        filterable: (column, tableId) => !(tableId && column && wouldLoop(tableId, column.key)),

        chooser: {
            layerOf: () => '',
            entityLabel: (grouping) => grouping.title,
            /**
             * One column per grouping. One that is built from this table, at any distance, can be shown but not
             * filtered on here, and says so (operator decision 15).
             */
            options(grouping, ticked, tableId) {
                const option = { column: '', text: grouping.title };
                if (tableId && wouldLoop(tableId, grouping.id)) option.note = cannotFilter(grouping.title);
                return [option];
            },
            empty: { text: `No ${PL.grouping} yet.`, button: `New ${W.grouping}…` }
        }
    };
}
