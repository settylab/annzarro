// How a kept view is rounded (utils/view-rounding.js); annzarro/tests/utils/test_view_rounding.py states the same cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roundedRange, roundCamera } from '../../../static/js/utils/view-rounding.js';

test('a range keeps 4 significant digits of its span, in the order given', () => {
    assert.deepEqual(roundedRange([-1.5534503, 0.8878132]), [-1.553, 0.888]);
    assert.deepEqual(roundedRange([0.8878132, -1.5534503]), [0.888, -1.553]);
    assert.deepEqual(roundedRange([1000.123456, 1000.223456]), [1000.1235, 1000.2235]);
    assert.deepEqual(roundedRange(['a', 'b']), ['a', 'b']);
    // idempotent: rounding what is kept changes nothing
    const once = roundedRange([-1.5534503, 0.8878132]);
    assert.deepEqual(roundedRange(once), once);
});

test('a camera keeps 4 significant digits of the eye distance, so a close view keeps its precision', () => {
    const far = roundCamera({ eye: { x: 7.653378975652401, y: 1.00004, z: -0.24748 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } });
    assert.deepEqual(far.eye, { x: 7.653, y: 1, z: -0.247 });
    const near = roundCamera({ eye: { x: 0.123456, y: 0.05, z: 0.0123456 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1.00004 } });
    assert.deepEqual(near.eye, { x: 0.1235, y: 0.05, z: 0.0123 });
    assert.deepEqual(near.up, { x: 0, y: 0, z: 1 });
    assert.deepEqual(roundCamera(far), far);
});
