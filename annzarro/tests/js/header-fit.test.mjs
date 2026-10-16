/**
 * The header's ladder (static/js/utils/header-fit.js): buttons to icons, then the focused gene and
 * cell inputs tighten, then the buttons take a row of their own. The dataset is the button of the
 * dataset bar, so it is not a step of the header.
 *
 * Drives the REAL fitDatasetHeader against a header whose row width is a model of which steps are on.
 *
 * Run:  node --test annzarro/tests/js/header-fit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 0 }) }) })
};

const { STEPS, WRAPPED_CLASS, fitDatasetHeader } = await import('../../../static/js/utils/header-fit.js');

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
            if (classes.has(WRAPPED_CLASS)) return room;
            return natural - [...classes].reduce((sum, c) => sum + (frees[c] || 0), 0);
        },
        children: []
    };
    return { h, classes };
}

const steps = classes => STEPS.filter(c => classes.has(c));
const FREES = { 'actions-compact': 375, 'focus-tight': 200 };

test('the header has two steps before it wraps: the button labels go first, then the focus inputs tighten', () => {
    assert.deepEqual(STEPS, ['actions-compact', 'focus-tight']);
});

test('a row that fits keeps every step off', () => {
    const { h, classes } = header({ room: 1762, natural: 1660, frees: FREES });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), []);
    assert.ok(!classes.has(WRAPPED_CLASS));
});

test('a row a little short has the labels turned to icons and the focus inputs left whole', () => {
    const { h, classes } = header({ room: 1300, natural: 1660, frees: FREES });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), ['actions-compact']);
});

test('the focus inputs give way only once the buttons are icons', () => {
    const { h, classes } = header({ room: 1150, natural: 1660, frees: FREES });
    fitDatasetHeader(h);
    assert.deepEqual(steps(classes), ['actions-compact', 'focus-tight']);
    assert.ok(!classes.has(WRAPPED_CLASS));
});

test('a row that still does not fit wraps, with the tight layout kept', () => {
    const { h, classes } = header({ room: 700, natural: 1660, frees: FREES });
    fitDatasetHeader(h);
    assert.ok(classes.has(WRAPPED_CLASS));
    assert.deepEqual(steps(classes), ['actions-compact', 'focus-tight']);
});
