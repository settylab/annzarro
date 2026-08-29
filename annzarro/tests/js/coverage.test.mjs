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
