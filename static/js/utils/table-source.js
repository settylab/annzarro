/**
 * What a table asks of the providers of three-level sources (utils/source-registry.js): the TABLE HALF, a provider's
 * `table` object, for the columns of a Cell Table. No table file names a source type; each asks here.
 *
 * A provider that accepts tables names 'cell-table' among its `consumers` and 'column' among its `axes`, and declares:
 *
 *   table.tab                 the label of its tab in the column chooser
 *   table.watch(column, {host, visible, onChange})
 *                             a handle on the column's series: read() -> snapshot, release(), sharers(), compute(),
 *                             retry(), cancel() (each true when it did something). onChange(snapshot) on every change
 *   table.visibilityChanged() optional: a table came into view or went out of it (a column's `visible` answers differently now)
 *   table.update(column)      optional: ask for the series again (a notice's Update); true when it did something
 *   table.label(column)       the column's name
 *   table.fullLabel(column)   the column's name in an export's header
 *   table.describe(snap, {sharers})
 *                             optional: the notice of a column that is not ready (utils/score-column.js describeColumn
 *                             is the default). `snap` carries `source` and `title`
 *   table.canOffer(column), table.offer(column)
 *                             optional: the notice's way to offer a lapsed option again
 *   table.open(column, hostId)  optional: the notice's way to open the entity beside the table
 *   table.chooser             the tab's list, one group per entity:
 *       entityLabel(entity)       the group's heading
 *       options(entity, ticked, tableId)
 *                                 [{column, layer?, text, note?}]: what the entity gives a column, then any ticked column
 *                                 it no longer offers. `note` is shown under the option (in this table it can be shown
 *                                 but not filtered on: operator decision 15)
 *       layerOf(column)           the layer a column names, or what a column of none reads ('' for a source with no layers)
 *       note(structure)           optional: the dataset's structure, noted when the tab is built
 *       empty                     {text, button}: what the tab says with no entity, and the label of the way to make one
 *                                 (the provider's `newEntity`)
 *       more                      optional {text, run(entity, nextTo)}: a link under each group
 *   table.filterable(column, tableId)
 *                             optional: false when a condition on the column must not be built in this table (it would
 *                             close a loop). The condition builder then leaves the column out, unless a condition names
 *                             it already (a link): that one stays, and the provider's notice says what it does
 *   table.listsCategories     optional, categorical only: true when the categories are few enough to list, so a
 *                             condition's "Equals" lists them; otherwise it takes typed text
 *
 * A snapshot read from a handle is what the column states itself from (utils/score-column.js columnView):
 *   state    ready, updating, estimating, queued, computing, idle, building, ask, awaiting, deleted, ... (the score's
 *            vocabulary: a state not named there reads as a source with no values)
 *   numerical    values: Float32Array, one per row
 *   categorical  codes (one per row), categories (the label of each code), MISSING (the code of no value), and optionally
 *                rank (each category's place in the order the column sorts by) and missingLabel (what a row of no
 *                category says, found by a filter and sorted last; 'N/A' when absent)
 *   words        optional {the, none, ready}: what the column calls its values while it has none ('the score', 'no
 *                score', 'the score is ready' when absent)
 * A provider whose source is not there yet answers 'deleted' (or any state with no series) and calls onChange when it is.
 */
import { getSource, sourcesFor } from './source-registry.js';

/** The table half of the provider a column belongs to, or null: a built-in column, a derived one, or a provider this page lacks. */
export function tableHalfOf(column) {
    const provider = column && column.type ? getSource(column.type) : null;
    return provider && provider.table ? provider.table : null;
}

/** The providers a Cell Table's column chooser lists as tabs, in registration order. */
export function tableProviders() {
    return sourcesFor('cell-table', ['column']).filter(p => p.table);
}
