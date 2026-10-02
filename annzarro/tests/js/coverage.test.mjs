/**
 * Behaviour of static/js/utils/coverage.js -- the "say what is missing and why"
 * value type.
 *
 * The load-bearing case is the LAST group: empty-because-nothing and
 * empty-because-broken must not classify the same. That distinction is the
 * whole point of the module; if these two tests ever agree, the UI is back to
 * the state that produced the 2026-08-28 incident.
 *
 * Run:  node --test annzarro/tests/js/coverage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GAP, ROLE, Coverage, classifyColumn, classifyValues, classifyError,
    classifyFilterStats
} from '../../../static/js/utils/coverage.js';

test('complete coverage says nothing', () => {
    const c = Coverage.complete(75000, 'cells');
    assert.equal(c.isComplete, true);
    assert.equal(c.headline(), '');
    assert.deepEqual(c.lines(), []);
    assert.equal(c.severity, 'ok');
});

test('unreported coverage is loud, not silent', () => {
    const c = Coverage.unreported('cells');
    assert.equal(c.isComplete, false);
    assert.equal(c.worstReason, GAP.UNREPORTED);
    assert.equal(c.severity, 'unreported');
    assert.match(c.headline(), /not reported/i);
    assert.equal(c.lines().length, 1);
});

test('partial coverage names the count and the reason', () => {
    const c = Coverage.partial(3412, 75000, GAP.FILTERED, 'missing coordinates',
        { source: 'x-axis', unit: 'cells' });
    assert.equal(c.headline(), '3,412 of 75,000 cells shown');
    assert.equal(c.lines().length, 1);
    assert.match(c.lines()[0], /x-axis/);
    assert.match(c.lines()[0], /71,588 cells/);
    assert.match(c.lines()[0], /missing coordinates/);
});

test('a Coverage is immutable; withGap returns a new one', () => {
    const a = Coverage.complete(10, 'cells');
    const b = a.withGap(GAP.EMPTY, 'nothing there', 'obs.x');
    assert.equal(a.gaps.length, 0);
    assert.equal(b.gaps.length, 1);
    assert.throws(() => { b.gaps.push({}); });
});

test('merge takes the minimum shown across contributors that RESTRICT', () => {
    // Two series that each decide which points exist: the panel is honest at
    // the scarcer of them.
    const x = Coverage.complete(75000, 'cells');
    const y = Coverage.partial(3412, 75000, GAP.FAILED, 'read failed', { source: 'y-axis' });
    const m = Coverage.merge([x, y], 'cells');
    assert.equal(m.shown, 3412);
    assert.equal(m.total, 75000);
    assert.equal(m.worstReason, GAP.FAILED);
});

test('merge does not launder an undescribed series', () => {
    const m = Coverage.merge([Coverage.complete(100, 'cells'), Coverage.unreported('cells')], 'cells');
    assert.equal(m.worstReason, GAP.UNREPORTED, 'UNREPORTED must survive merging');
});

test('merge of nothing is unreported, never complete', () => {
    assert.equal(Coverage.merge([], 'cells').worstReason, GAP.UNREPORTED);
    assert.equal(Coverage.merge([null, undefined], 'cells').worstReason, GAP.UNREPORTED);
});

test('all entities shown but one column broken: headline names the REASON, not the count', () => {
    // The colour column failed while every point was still drawn. Reporting
    // "0 of 75,000 shown" here would be the same lie as saying nothing, just
    // pointing the other way -- so the count is suppressed and the reason
    // becomes the headline.
    const c = Coverage.complete(75000, 'cells')
        .withGap(GAP.FAILED, 'obs.celltype could not be read', 'colour');
    assert.equal(c.isComplete, false);
    assert.equal(c.shown, 75000);
    assert.equal(c.total, 75000);
    assert.equal(c.headline(), 'Some data could not be read');
    assert.match(c.lines()[0], /colour/);
    assert.match(c.lines()[0], /could not be read/);
});

test('merging a complete-with-gap series does not zero the panel count', () => {
    const m = Coverage.merge([
        Coverage.complete(75000, 'cells'),
        Coverage.complete(75000, 'cells').withGap(GAP.FAILED, 'boom', 'colour')
    ], 'cells');
    assert.equal(m.shown, 75000, 'the points are on screen; do not claim otherwise');
    assert.equal(m.isComplete, false, 'but the gap is still stated');
    assert.equal(m.headline(), 'Some data could not be read');
});

test('a failed read outranks a filter for severity', () => {
    const c = new Coverage({
        shown: 1, total: 10, unit: 'cells',
        gaps: [
            { reason: GAP.FILTERED, detail: 'NaN', source: 'x' },
            { reason: GAP.FAILED, detail: 'boom', source: 'colour' }
        ]
    });
    assert.equal(c.worstReason, GAP.FAILED);
    assert.equal(c.severity, 'error');
    assert.equal(c.lines().length, 2, 'both reasons are still stated');
});

test('an unknown reason degrades to UNREPORTED rather than being shown raw', () => {
    const c = new Coverage({ shown: 0, total: 5, gaps: [{ reason: 'wat', detail: 'x' }] });
    assert.equal(c.gaps[0].reason, GAP.UNREPORTED);
});

// --- classifyColumn: the discriminator the incident turned on -------------

test('classifyColumn: a healthy column is complete', () => {
    const c = classifyColumn({
        column: 'celltype',
        response: { data: { celltype: new Array(75000).fill('Liver') } },
        expected: 75000, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.isComplete, true);
});

test('classifyColumn: key ABSENT means not in this dataset', () => {
    // Measured live 2026-08-28: requesting a nonexistent obs column returns
    // 200 {"data": {}} -- the key is silently dropped by the reader.
    const c = classifyColumn({
        column: 'no_such_column',
        response: { data: {} },
        expected: 75000, unit: 'cells', source: 'obs.no_such_column'
    });
    assert.equal(c.worstReason, GAP.UNAVAILABLE);
    assert.match(c.lines()[0], /does not exist in this dataset/);
});

test('classifyColumn: key PRESENT but empty on a non-empty dataset means FAILED', () => {
    // This is the 2026-08-28 incident exactly: HTTP 200, {"celltype": []},
    // on a dataset with 75,000 cells. An obs column is aligned to n_obs by
    // AnnData's definition, so zero values is a failed read, not an empty one.
    const c = classifyColumn({
        column: 'celltype',
        response: { data: { celltype: [] } },
        expected: 75000, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.worstReason, GAP.FAILED);
    assert.match(c.lines()[0], /could not read/i);
});

test('classifyColumn: key PRESENT and empty on an EMPTY dataset means EMPTY', () => {
    // The opposite verdict on the same response shape. If these two tests ever
    // return the same reason, the module has stopped doing its only job.
    const c = classifyColumn({
        column: 'celltype',
        response: { data: { celltype: [] } },
        expected: 0, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.worstReason, GAP.EMPTY);
    assert.match(c.lines()[0], /has no values/);
});

test('classifyColumn: empty-because-nothing and empty-because-broken DIFFER', () => {
    const shape = { column: 'celltype', response: { data: { celltype: [] } }, unit: 'cells' };
    const broken = classifyColumn({ ...shape, expected: 75000 });
    const legitimatelyEmpty = classifyColumn({ ...shape, expected: 0 });
    assert.notEqual(broken.worstReason, legitimatelyEmpty.worstReason,
        'identical API responses must still be distinguishable by dataset size');
    assert.equal(broken.severity, 'error');
    assert.equal(legitimatelyEmpty.severity, 'warning');
});

test('classifyColumn: a SHORT column is a partial failed read, not a success', () => {
    const c = classifyColumn({
        column: 'celltype',
        response: { data: { celltype: new Array(1200).fill('Liver') } },
        expected: 75000, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.worstReason, GAP.FAILED);
    assert.equal(c.shown, 1200);
    assert.equal(c.total, 75000);
    assert.equal(c.headline(), '1,200 of 75,000 cells shown');
});

test('classifyColumn: unknown expected count does not fabricate a verdict', () => {
    const c = classifyColumn({
        column: 'celltype',
        response: { data: { celltype: [] } },
        expected: null, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.worstReason, GAP.EMPTY, 'with no n_obs to compare, claim only what is known');
});

// --- classifyError --------------------------------------------------------

test('classifyError: a server cap reads as CAPPED, not as a read failure', () => {
    const err = new Error('Too many cells requested: 3. Maximum allowed is 1.');
    err.status = 400;
    err.data = { error: err.message, reason: 'cap_exceeded' };
    const c = classifyError(err, { unit: 'cells', source: 'obs.celltype' });
    assert.equal(c.worstReason, GAP.CAPPED);
});

test('classifyError: a cap from a server with no reason code is still CAPPED', () => {
    // The live server today sends no `reason` field. The wording fallback is
    // what keeps this classified correctly before the server change lands.
    const err = new Error('Too many cells requested: 3. Maximum allowed is 1. Please reduce the number of rows.');
    err.status = 400;
    err.data = { error: err.message };
    assert.equal(classifyError(err, { unit: 'cells' }).worstReason, GAP.CAPPED);
});

test('classifyError: anything else is FAILED and keeps the server message', () => {
    const err = new Error('Cannot handle this file type');
    err.status = 400;
    err.data = { error: err.message };
    const c = classifyError(err, { unit: 'cells', source: 'obs.celltype' });
    assert.equal(c.worstReason, GAP.FAILED);
    assert.match(c.lines()[0], /Cannot handle this file type/);
});

test('classifyError: a not_found reason reads as UNAVAILABLE', () => {
    const err = new Error('Dataset not found');
    err.data = { reason: 'not_found', error: 'Dataset not found' };
    assert.equal(classifyError(err).worstReason, GAP.UNAVAILABLE);
});

test('classifyError: a key_not_found reason reads as UNAVAILABLE ("not in this dataset")', () => {
    const err = new Error("No obs column 'highres_celltype' in this dataset.");
    err.status = 404;
    err.data = { reason: 'key_not_found', error: err.message };
    const c = classifyError(err, { unit: 'cells', source: 'obs.highres_celltype' });
    assert.equal(c.worstReason, GAP.UNAVAILABLE);
    assert.match(c.lines()[0], /not in this dataset/);
});

// --- classifyFilterStats --------------------------------------------------

test('classifyFilterStats: no filtering is complete', () => {
    const c = classifyFilterStats({
        xNaN: 0, yNaN: 0, zNaN: 0, colorNaN: 0, colorOutliers: 0,
        tableFiltered: 0, total: 75000, filtered: 0
    }, 'cells');
    assert.equal(c.isComplete, true);
});

test('classifyFilterStats: NaN coordinates become a stated gap', () => {
    const c = classifyFilterStats({
        xNaN: 71588, yNaN: 0, zNaN: 0, colorNaN: 0, colorOutliers: 0,
        tableFiltered: 0, total: 75000, filtered: 71588
    }, 'cells');
    assert.equal(c.headline(), '3,412 of 75,000 cells shown');
    assert.match(c.lines()[0], /x-axis/);
    assert.match(c.lines()[0], /71,588 cells/);
});

test('classifyFilterStats: inactive toggles do not invent gaps', () => {
    const c = classifyFilterStats({
        xNaN: 0, yNaN: 0, zNaN: 0, colorNaN: 500, colorOutliers: 700,
        tableFiltered: 300, total: 1000, filtered: 0,
        hideNaNActive: false, hideOutliersActive: false, tableFilterActive: false
    }, 'cells');
    assert.equal(c.isComplete, true, 'counts for disabled filters are not gaps');
});

test('classifyFilterStats: absent stats are unreported, not complete', () => {
    assert.equal(classifyFilterStats(null, 'cells').worstReason, GAP.UNREPORTED);
});


/* ================================================================== *
 * ROLE -- whether a contributor decides which entities appear, or     *
 * merely describes entities that appear anyway.                       *
 *                                                                     *
 * Taking a DESCRIBING contributor into the minimum is what captioned  *
 * a table holding 75,000 rows "No cells shown (of 75,000)". The tests *
 * below are the rule; annzarro/tests/js/table-coverage.test.mjs is    *
 * the same rule observed through the real table module.               *
 * ================================================================== */

test('the default role is RESTRICTS -- an unclassified contributor bounds the panel', () => {
    assert.equal(Coverage.complete(10, 'cells').role, ROLE.RESTRICTS);
    assert.equal(Coverage.missing(GAP.FAILED, 'x').role, ROLE.RESTRICTS);
    assert.equal(Coverage.partial(1, 10, GAP.FAILED, 'x').role, ROLE.RESTRICTS);
    assert.equal(Coverage.unreported('cells').role, ROLE.RESTRICTS);
});

test('a DESCRIBING contributor does not bound the panel it describes', () => {
    // Plotly draws every point whether or not marker.color is short: a colour
    // column that covers 3,412 of 75,000 removes NO points from the scatter.
    const x = Coverage.complete(75000, 'cells');
    const colour = Coverage.partial(3412, 75000, GAP.FAILED, 'read failed',
        { source: 'colour' }).asDescribing();
    const m = Coverage.merge([x, colour], 'cells');
    assert.equal(m.shown, 75000, 'the points are all on screen');
    assert.equal(m.total, 75000);
    assert.equal(m.worstReason, GAP.FAILED, 'and the reason is still stated');
    assert.match(m.headline(), /could not be read/i);
    assert.doesNotMatch(m.headline(), /^No cells shown/);
});

test('a DESCRIBING contributor showing nothing still does not empty the panel', () => {
    // The exact shape of the table defect: a column absent from the dataset is
    // `missing`, i.e. shown = 0, but the rows are on screen regardless.
    const good = Coverage.complete(75000, 'cells').asDescribing();
    const absent = Coverage.missing(GAP.UNAVAILABLE, 'not in this dataset',
        { source: 'obs.celltype', unit: 'cells', total: 75000 }).asDescribing();
    const m = Coverage.merge([good, absent], 'cells');
    assert.equal(m.shown, 75000);
    assert.doesNotMatch(m.headline(), /^No cells shown/);
    assert.match(m.lines()[0], /not in this dataset/);
});

test('when NOTHING restricts, shown is the total -- every entity is on screen', () => {
    const m = Coverage.merge([
        Coverage.missing(GAP.FAILED, 'a', { total: 500, unit: 'cells' }).asDescribing(),
        Coverage.missing(GAP.FAILED, 'b', { total: 500, unit: 'cells' }).asDescribing()
    ], 'cells');
    assert.equal(m.shown, 500);
    assert.equal(m.total, 500);
    assert.equal(m.gaps.length, 2, 'both reasons still travel');
});

test('one restricting contributor still bounds a panel full of describing ones', () => {
    // The opposite direction: DESCRIBES must not become a way to launder a
    // real restriction. A capped axis among colour columns still wins.
    const m = Coverage.merge([
        Coverage.complete(75000, 'cells').asDescribing(),
        Coverage.partial(10000, 75000, GAP.CAPPED, 'server limit', { source: 'y-axis' })
    ], 'cells');
    assert.equal(m.shown, 10000);
    assert.equal(m.worstReason, GAP.CAPPED);
});

test('a merged coverage RESTRICTS, so re-merging it with a filter bounds correctly', () => {
    const panel = Coverage.merge([
        Coverage.complete(75000, 'cells'),
        Coverage.missing(GAP.FAILED, 'colour failed', { total: 75000 }).asDescribing()
    ], 'cells');
    assert.equal(panel.role, ROLE.RESTRICTS);
    const withFilter = Coverage.merge([
        panel,
        classifyFilterStats({ xNaN: 71588, total: 75000, filtered: 71588 }, 'cells')
    ], 'cells');
    assert.equal(withFilter.shown, 3412, 'the filter mask still bounds the panel');
});

test('withRole and asDescribing are non-mutating', () => {
    const a = Coverage.complete(10, 'cells');
    const b = a.asDescribing();
    assert.equal(a.role, ROLE.RESTRICTS);
    assert.equal(b.role, ROLE.DESCRIBES);
    assert.equal(a.asDescribing().asDescribing().role, ROLE.DESCRIBES);
    assert.equal(b.withRole(ROLE.RESTRICTS).role, ROLE.RESTRICTS);
});

test('withGap preserves the role', () => {
    const c = Coverage.complete(10, 'cells').asDescribing()
        .withGap(GAP.FAILED, 'something', 'colour');
    assert.equal(c.role, ROLE.DESCRIBES);
});

test('an unknown role falls back to RESTRICTS, not to silence', () => {
    assert.equal(new Coverage({ shown: 1, total: 1, role: 'nonsense' }).role, ROLE.RESTRICTS);
    assert.equal(new Coverage({ shown: 1, total: 1, role: undefined }).role, ROLE.RESTRICTS);
});

/* ================================================================== *
 * classifyValues -- the ONE implementation both surfaces share.       *
 * ================================================================== */

test('classifyColumn delegates to classifyValues once presence is settled', () => {
    // Same values, reached two ways: through a response body and directly.
    // If these ever disagree, the plot and the table can disagree again.
    for (const values of [[], Array(5).fill(null), Array(2).fill(1), Array(5).fill(1)]) {
        const viaColumn = classifyColumn({
            column: 'c', response: { data: { c: values } },
            expected: 5, unit: 'cells', source: 'obs.c'
        });
        const viaValues = classifyValues({
            values, expected: 5, unit: 'cells', source: 'obs.c'
        });
        assert.deepEqual(viaColumn.toJSON(), viaValues.toJSON(),
            `divergent verdict for a ${values.length}-value column`);
    }
});

test('classifyValues: an all-blank column is EMPTY, not complete', () => {
    // The plot used to draw a panel in which nothing was coloured and say
    // nothing at all, because a full-length array of nulls passed the length
    // check. The table said "every entry in this column is blank". Same data,
    // two answers.
    const c = classifyValues({
        values: Array(5).fill(null), expected: 5, unit: 'cells', source: 'obs.celltype'
    });
    assert.equal(c.worstReason, GAP.EMPTY);
    assert.match(c.lines()[0], /blank/);
});

test('classifyValues: a column with one real value among nulls is not blank', () => {
    const values = Array(5).fill(null);
    values[4] = 'T cell';
    assert.equal(classifyValues({ values, expected: 5, unit: 'cells' }).isComplete, true);
});

test('classifyValues carries the role through every branch', () => {
    for (const values of [[], Array(3).fill(null), Array(1).fill(1), Array(3).fill(1)]) {
        const c = classifyValues({
            values, expected: 3, unit: 'cells', source: 's', role: ROLE.DESCRIBES
        });
        assert.equal(c.role, ROLE.DESCRIBES,
            `role lost for a ${values.length}-value column`);
    }
});


/* ================================================================== *
 * One condition, ONE reason line.                                     *
 *                                                                     *
 * An axis that is entirely absent gets described twice: once by the    *
 * series that loaded it, once by the filter mask counting the same     *
 * NaNs. The arithmetic was always right -- merge minimises, so nothing *
 * is double-subtracted -- but the second line frames a not-yet-made    *
 * selection as a filter.                                               *
 * ================================================================== */

test('a fully-absent axis is not also reported as filtered', () => {
    const xLoaded = Coverage.missing(GAP.UNFOCUSED,
        'this column is measured relative to a focused cell, and none is focused yet',
        { source: 'obsp.conn', unit: 'cells', total: 200 });
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: xLoaded } });
    const panel = Coverage.merge([xLoaded, filters], 'cells');

    assert.equal(panel.lines().length, 1, `got: ${JSON.stringify(panel.lines())}`);
    assert.match(panel.lines()[0], /focused/);
    assert.equal(panel.shown, 0, 'and the count is unchanged');
    assert.equal(panel.total, 200);
});

test('suppressing the sentence does not restore the points', () => {
    // `Coverage.complete(total)` reports `shown = total`. Returning it once the
    // last gap was suppressed would hand the panel a full count over an empty
    // plot -- the opposite-direction lie, and the one a duplicate reason line
    // was never worth risking.
    const xLoaded = Coverage.missing(GAP.UNFOCUSED, 'none is focused yet',
        { source: 'obsp.conn', unit: 'cells', total: 200 });
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 0, 'the duplicate sentence is gone');
    assert.equal(filters.shown, 0, 'but the 200 filtered points are still gone');
    assert.equal(filters.total, 200);
});

test('a PARTIALLY absent axis is still reported as filtered', () => {
    // The suppression must not swallow a genuine filter. Only an axis missing
    // EVERY entity is a duplicate of its series-level reason.
    const xLoaded = Coverage.partial(150, 200, GAP.FAILED, 'short read',
        { source: 'obs.x', unit: 'cells' });
    const filters = classifyFilterStats(
        { xNaN: 50, yNaN: 0, zNaN: 0, total: 200, filtered: 50 },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 1);
    assert.match(filters.lines()[0], /x-axis/);
});

test('a fully-NaN axis IS reported when the loaders reported nothing', () => {
    // Without a series-level explanation the filter line is the only reason
    // the user gets, so suppressing it would restore silence.
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: Coverage.complete(200, 'cells') } });
    assert.equal(filters.gaps.length, 1);
    assert.match(filters.lines()[0], /x-axis/);
    // and with no argument at all
    assert.equal(classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 }, 'cells').gaps.length, 1);
});

test('colour NaN is never suppressed', () => {
    // With hide-NaN on, an unreadable colour column REMOVES points -- a real
    // consequence its own DESCRIBES coverage does not account for. Dropping
    // that line would hide a fact, not a duplicate.
    const xLoaded = Coverage.missing(GAP.UNAVAILABLE, 'not here',
        { source: 'obs.ct', unit: 'cells', total: 200 });
    const filters = classifyFilterStats(
        { xNaN: 0, yNaN: 0, zNaN: 0, colorNaN: 200, total: 200, filtered: 200,
          hideNaNActive: true },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 1);
    assert.match(filters.lines()[0], /colour/);
});


/* ================================================================== *
 * ...and ONLY when it is the same fact.                               *
 *                                                                     *
 * The three ways a panel-wide "something is already missing" test      *
 * removes the only reason a user was going to get. Each is a real      *
 * value one of the two call sites passes today.                        *
 * ================================================================== */

test('UNREPORTED does not explain a fully-absent axis', () => {
    // Both call sites fall back to `Coverage.unreported()` when the loaders
    // left nothing behind -- `plot-update.js` on every incremental render.
    // "Nobody said why" is the absence of a reason, not one.
    const nobodySaid = Coverage.unreported('cells');
    const stats = { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 };
    const filters = classifyFilterStats(stats, 'cells',
        { axisCoverage: { x: nobodySaid } });
    assert.equal(filters.gaps.length, 1, 'the filter line is the only reason there is');
    assert.match(filters.lines()[0], /x-axis/);

    const panel = Coverage.merge([nobodySaid, filters], 'cells');
    assert.equal(panel.shown, 0, 'and the panel still says nothing is shown');
    assert.equal(panel.headline(), 'No cells shown (of 200)');
});

test('a gap belonging to ANOTHER contributor does not explain this axis', () => {
    // A colour column awaiting a focused selection DESCRIBES: by this module's
    // own doctrine it accounts for no entities at all. It must not license
    // deleting the x-axis line, which is about entities that are gone.
    const xLoaded = Coverage.complete(200, 'cells');
    const colour = Coverage.missing(GAP.UNFOCUSED, 'none is focused yet',
        { source: 'obsp.conn', unit: 'cells', total: 200 }).asDescribing();
    const load = Coverage.merge([xLoaded, Coverage.complete(200, 'cells'), colour], 'cells');
    assert.equal(load.isComplete, false, 'the panel coverage IS incomplete...');
    assert.equal(load.shown, 200, '...while every entity is still accounted for');

    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 1, 'so the x-axis line must survive');
    assert.match(filters.lines()[0], /x-axis/);
    assert.equal(Coverage.merge([load, filters], 'cells').shown, 0);
});

test('an axis its own loader called COMPLETE is still reported as filtered', () => {
    // `classifyValues` calls a column blank on null/NaN; `createFilterMask`
    // calls a point missing on `isNaN(v)`, which is also true of every string.
    // A categorical axis is therefore COMPLETE to its loader and entirely
    // absent to the mask, and the mask's line is the only one there is.
    const xLoaded = Coverage.complete(200, 'cells');
    const namesDisagree = Coverage.complete(200, 'cells')
        .withGap(GAP.FAILED, 'cell names and data points disagree', 'cells names', 3);
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 1);
    assert.match(filters.lines()[0], /x-axis/);
    assert.equal(Coverage.merge([namesDisagree, filters], 'cells').shown, 0);
});

test('an axis that accounts for FEWER entities than the mask counts still reports', () => {
    // `shown === 0` is a proxy; "accounts for at least `count`" is the condition.
    // They come apart when the axis's own total disagrees with the mask's: a
    // series covering 150 entities, none shown, explains 150 -- not the 200 the
    // mask is about to call filtered.
    const xLoaded = Coverage.missing(GAP.EMPTY, 'every entry blank',
        { source: 'obs.x', unit: 'cells', total: 150 });
    assert.equal(xLoaded.shown, 0, 'shown IS 0, so the proxy would suppress');
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: xLoaded } });
    assert.equal(filters.gaps.length, 1, 'but it only accounts for 150 of 200');
    assert.match(filters.lines()[0], /x-axis/);
});

test('a coverage whose ONLY gap is UNREPORTED explains nothing, counts or not', () => {
    // `Coverage.unreported()` carries no counts, so the accounts-for clause
    // already rejects it -- verified by mutation: removing the UNREPORTED
    // clause kills no test that uses that value. This asserts the clause
    // against the value that clause is actually for: one that DOES carry
    // counts and still says only "nobody described this surface". Neither
    // call site can produce it today; the clause is defence in depth, and
    // this is the test that measures it rather than assuming it.
    const nobodySaid = new Coverage({
        shown: 0, total: 200, unit: 'cells',
        gaps: [{ reason: GAP.UNREPORTED, detail: 'nobody described this surface' }]
    });
    assert.equal(nobodySaid.total - nobodySaid.shown, 200,
        'it accounts for all 200 arithmetically...');
    const filters = classifyFilterStats(
        { xNaN: 200, yNaN: 0, zNaN: 0, total: 200, filtered: 200 },
        'cells', { axisCoverage: { x: nobodySaid } });
    assert.equal(filters.gaps.length, 1, '...but names no reason, so it explains nothing');
    assert.match(filters.lines()[0], /x-axis/);
});

test('SWEEP: across the rule\'s whole input domain, the panel never overstates what is drawn', () => {
    // Hand-picked fixtures drawn from the conditions a rule was written for
    // cannot fail where that rule is wrong -- which is how the panel-wide
    // version of this suppression passed every test it had. So sweep the
    // domain instead and assert two invariants over all of it.
    const T = 200;
    const covs = {
        'undefined': undefined,
        'null': null,
        'non-Coverage object': { shown: 0, total: T, gaps: [{ reason: 'failed' }] },
        'unreported()': Coverage.unreported('cells'),
        'complete(200)': Coverage.complete(T, 'cells'),
        'missing UNFOCUSED': Coverage.missing(GAP.UNFOCUSED, 'd', { unit: 'cells', total: T }),
        'missing EMPTY': Coverage.missing(GAP.EMPTY, 'd', { unit: 'cells', total: T }),
        'missing FAILED total=150': Coverage.missing(GAP.FAILED, 'd', { unit: 'cells', total: 150 }),
        'partial 0/200': Coverage.partial(0, T, GAP.FAILED, 'd', { unit: 'cells' }),
        'partial 50/200': Coverage.partial(50, T, GAP.FAILED, 'd', { unit: 'cells' }),
        'partial 150/200': Coverage.partial(150, T, GAP.FAILED, 'd', { unit: 'cells' }),
        'unreported gap WITH counts': new Coverage({
            shown: 0, total: T, unit: 'cells',
            gaps: [{ reason: GAP.UNREPORTED, detail: 'nobody said' }] }),
    };
    const violations = [];
    for (const [name, cov] of Object.entries(covs)) {
        for (const xNaN of [0, 1, 50, 199, 200]) {
            if (xNaN === 0) continue;
            const filters = classifyFilterStats(
                { xNaN, yNaN: 0, zNaN: 0, total: T, filtered: xNaN },
                'cells', { axisCoverage: { x: cov } });
            const load = (cov instanceof Coverage) ? cov : Coverage.unreported('cells');
            const panel = Coverage.merge([load, filters], 'cells');

            // (1) entities are missing, so SOME reason must reach the user.
            if (panel.lines().length === 0) violations.push(`${name} xNaN=${xNaN}: no reason named`);
            // (2) the panel must never claim more shown than are actually drawn.
            const drawn = T - xNaN;
            if (typeof panel.shown === 'number' && panel.shown > drawn) {
                violations.push(`${name} xNaN=${xNaN}: claims shown=${panel.shown}, only ${drawn} drawn`);
            }
        }
    }
    assert.deepEqual(violations, [], violations.join('\n'));
    // The panel-wide predicate violates (2) on three of these: `unreported()`,
    // `partial 50/200` and `partial 150/200`, each at xNaN=200 -- the last two
    // are cases no hand-written fixture in this file had named.
});

// --- settylab/annzarro#37: "nothing restricts" vs "every restrictor declined" ---

test('#37: restrictors that all declined leave shown UNKNOWN, not equal to total', () => {
    // The measured input from the issue. Before the fix: shown=200 total=200,
    // i.e. a panel whose only statement is a failed read claimed every cell.
    const m = Coverage.merge([
        Coverage.unreported('cells'),
        new Coverage({ shown: null, total: 200, unit: 'cells',
                       gaps: [{ reason: GAP.FAILED, detail: 'read failed', source: 'obs.a' }] })
    ], 'cells');
    assert.equal(m.shown, null);
    assert.equal(m.total, 200);
    assert.equal(m.isComplete, false);
    assert.equal(m.toJSON().shown, null, 'the serialised form must not carry a fabricated count');
    assert.doesNotMatch(m.headline(), /200 of 200/);
});

test('#37: one restrictor declining makes the minimum of the rest an upper bound only', () => {
    const m = Coverage.merge([
        Coverage.complete(200, 'cells'),
        Coverage.unreported('cells')
    ], 'cells');
    assert.equal(m.shown, null);
    assert.equal(m.worstReason, GAP.UNREPORTED);
});

test('#37: a declining restrictor with NO gaps still produces a reason', () => {
    // The severe variant: without a gap the panel would render nothing at all.
    const silent = new Coverage({ shown: null, total: 200, unit: 'cells' });
    const m = Coverage.merge([silent], 'cells');
    assert.equal(m.shown, null);
    assert.equal(m.isComplete, false);
    assert.equal(m.worstReason, GAP.UNREPORTED);
    assert.match(m.lines()[0], /how many cells are on screen was not reported/);
});

test('#37: a re-merge does not inherit a fabricated bound', () => {
    const declined = Coverage.merge([Coverage.unreported('cells')], 'cells');
    const withFilter = Coverage.merge([
        declined,
        classifyFilterStats({ xNaN: 50, total: 200, filtered: 50 }, 'cells')
    ], 'cells');
    assert.equal(withFilter.shown, null, 'still unknown: the first contributor never said');
    assert.equal(withFilter.worstReason, GAP.UNREPORTED);
});

test('#37: nothing restricting still means every entity is on screen', () => {
    const m = Coverage.merge([
        Coverage.unreported('cells').asDescribing(),
        Coverage.complete(300, 'cells').asDescribing()
    ], 'cells');
    assert.equal(m.shown, 300);
    assert.equal(m.worstReason, GAP.UNREPORTED, 'the undescribed column is still loud');
});

test('#37: a describing total above every restricting total is stated, not left bare', () => {
    // merge([complete(150), describes(total 200)]) used to read
    // "150 of 200 cells shown" with no line underneath saying why.
    const m = Coverage.merge([
        Coverage.complete(150, 'cells'),
        Coverage.complete(200, 'cells').asDescribing()
    ], 'cells');
    assert.equal(m.shown, 150);
    assert.equal(m.total, 200, 'the larger expectation is the evidence; keep it');
    assert.equal(m.headline(), '150 of 200 cells shown');
    assert.equal(m.lines().length, 1);
    assert.match(m.lines()[0], /disagree about how many cells there are \(150 drawn from, 200 expected\)/);
});

test('#37: agreeing totals add no disagreement gap', () => {
    const m = Coverage.merge([
        Coverage.complete(200, 'cells'),
        Coverage.partial(10, 200, GAP.FAILED, 'x', { unit: 'cells' }).asDescribing()
    ], 'cells');
    assert.equal(m.gaps.length, 1);
    assert.equal(m.gaps[0].reason, GAP.FAILED);
});

// --- settylab/annzarro#41/#42: the server's reason codes since #45 -----------

test('#41: a 404 key_not_found is "not in this dataset", not a failed read', () => {
    const err = Object.assign(new Error("No obs column 'gone' in this dataset."),
        { status: 404, data: { reason: 'key_not_found' } });
    const c = classifyError(err, { unit: 'cells', source: 'obs.gone', total: 10 });
    assert.equal(c.worstReason, GAP.UNAVAILABLE);
    assert.match(c.lines()[0], /not in this dataset/);
});

test('#41: unsupported_type and read_failed are failures that keep the server sentence', () => {
    for (const [status, reason] of [[400, 'unsupported_type'], [500, 'read_failed'], [500, 'stale_metadata']]) {
        const err = Object.assign(new Error(`obs column 'Nucleus': ${reason}`),
            { status, data: { reason } });
        const c = classifyError(err, { unit: 'cells', source: 'obs.Nucleus', total: 10 });
        assert.equal(c.worstReason, GAP.FAILED, reason);
        assert.match(c.lines()[0], /Nucleus/);
    }
});
