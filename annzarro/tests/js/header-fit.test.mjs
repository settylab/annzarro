/**
 * The header's ladder (static/js/utils/header-fit.js): the dataset box gives way
 * before the focused gene and cell inputs. Its name may be cut hard, as the open
 * list shows it whole; the focused cell is read in its input.
 *
 * Reported from CI (Linux fonts, 1440px): the row was 2px short with the button
 * labels gone, and the next step tightened the focus inputs first, cutting
 * HSPC_Young_1#AAAGATGGTCCGAAGA-1 to 231px while the dataset box kept 400px.
 *
 * Drives the REAL fitDatasetHeader against a header whose row width is a model
 * of which steps are on.
 *
 * Run:  node --test annzarro/tests/js/header-fit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 0 }) }) })
};

const { STEPS, STACKED_CLASS, fitDatasetHeader, restWraps } = await import('../../../static/js/utils/header-fit.js');

/** A header whose one row is `room` px wide and needs `natural` px less what each step on frees. */
function header({ room, natural, frees }) {
    const classes = new Set(['app-header']);
    const h = {
        style: { setProperty() {} },
        classList: {
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
            contains: c => classes.has(c)
        },
        querySelector: sel => (sel === '.global-controls > .row' ? row : null)
    };
    const row = {
        clientWidth: room,
        get scrollWidth() {
            if (classes.has(STACKED_CLASS)) return room;
            return natural - [...classes].reduce((sum, c) => sum + (frees[c] || 0), 0);
        },
        children: []
    };
    return { h, classes };
}

const steps = classes => STEPS.filter(c => classes.has(c));

test('the dataset box gives way before the focus inputs', () => {
    assert.ok(STEPS.indexOf('dataset-tight') < STEPS.indexOf('focus-tight'), STEPS.join(' < '));
    assert.equal(STEPS[0], 'actions-compact', 'the button labels go first');
});

test('a row the dataset box can make room for keeps the focus inputs whole', () => {
    // the CI case: 2px short once the labels are icons; the box can give up 260px
    const { h, classes } = header({ room: 1282, natural: 1659, frees: { 'actions-compact': 375, 'dataset-tight': 260, 'focus-tight': 200 } });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), ['actions-compact', 'dataset-tight']);
    assert.ok(!classes.has(STACKED_CLASS));
});

test('the focus inputs give way only once the dataset box is at its least', () => {
    const { h, classes } = header({ room: 942, natural: 1660, frees: { 'actions-compact': 375, 'dataset-tight': 260, 'focus-tight': 200 } });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), ['actions-compact', 'dataset-tight', 'focus-tight']);
});

test('a row that fits keeps every step off', () => {
    const { h, classes } = header({ room: 1762, natural: 1660, frees: {} });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), []);
});

/** A stacked row's pickers and buttons, as [top, height] each. */
function stackedRow(items) {
    const children = items.map(([top, height]) => ({
        classList: { contains: () => false },
        getBoundingClientRect: () => ({ top, height, bottom: top + height })
    }));
    return { querySelector: () => ({ children }) };
}

test('stacked, the buttons centred beside the taller pickers are on their line', () => {
    // measured at 1024px: the pickers 62px tall at 74, the buttons 38px at 86
    assert.equal(restWraps(stackedRow([[74, 62], [74, 62], [86, 38]])), false);
    assert.equal(restWraps(stackedRow([[74, 62], [74, 62], [140, 38]])), true);
});
