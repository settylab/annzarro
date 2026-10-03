/**
 * Automatic point size and opacity (static/js/utils/point-style.js): until
 * the user sets them, they follow the number of points drawn.
 *
 * Run:  node --test annzarro/tests/js/point-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPointStyle, initAutoPointStyle, applyAutoPointStyle } from '../../../static/js/utils/point-style.js';

const BASE = { size: 5, opacity: 1 };

test('small data keeps the default look', () => {
    for (const n of [0, 1, 200]) assert.deepEqual(autoPointStyle(n, BASE), BASE, `n=${n}`);
    const k = autoPointStyle(1000, BASE);   // a thousand points: within 2%
    assert.ok(k.size >= 4.9 && k.opacity >= 0.98, JSON.stringify(k));
});

test('large data gets smaller, fainter points; smooth and monotone in N', () => {
    let prev = autoPointStyle(1, BASE);
    for (let e = 0.5; e <= 8.5; e += 0.05) {
        const s = autoPointStyle(10 ** e, BASE);
        assert.ok(s.size <= prev.size && s.opacity <= prev.opacity, `n=1e${e}`);
        // no step: neighbouring N (12% apart) differ by one rounding step at most
        assert.ok(s.size >= prev.size * 0.9 && s.opacity >= prev.opacity * 0.9, `jump at n=1e${e}`);
        prev = s;
    }
    const big = autoPointStyle(95.6e6, BASE);
    assert.ok(big.size >= 0.5 && big.size <= 1.5, `95.6M size ${big.size}`);
    assert.ok(big.opacity >= 0.1 && big.opacity <= 0.3, `95.6M opacity ${big.opacity}`);
});

test('a panel config without size or opacity is automatic; one that names them is not', () => {
    const fresh = {};
    initAutoPointStyle(fresh, { x: {} });
    assert.equal(fresh.autoPointSize, true);
    assert.equal(fresh.autoPointOpacity, true);

    const oldLink = {};   // written before automatic values existed
    initAutoPointStyle(oldLink, { pointSize: 3, pointOpacity: 0.7 });
    assert.equal(oldLink.autoPointSize, false);
    assert.equal(oldLink.autoPointOpacity, false);

    const saved = {};     // saved while automatic: the value is there, the flag says auto
    initAutoPointStyle(saved, { pointSize: 1.3, pointOpacity: 0.25, autoPointSize: true, autoPointOpacity: false });
    assert.equal(saved.autoPointSize, true);
    assert.equal(saved.autoPointOpacity, false);

    const none = {};
    initAutoPointStyle(none, undefined);
    assert.equal(none.autoPointSize, true);
});

test('automatic values follow N; a value the user set survives N changes', () => {
    const settings = { pointSize: 5, pointOpacity: 1, autoPointSize: true, autoPointOpacity: true };
    assert.equal(applyAutoPointStyle(settings, 95.6e6, BASE), true);
    const big = autoPointStyle(95.6e6, BASE);
    assert.equal(settings.pointSize, big.size);
    assert.equal(settings.pointOpacity, big.opacity);
    assert.equal(applyAutoPointStyle(settings, 95.6e6, BASE), false, 'same N: nothing to do');

    // the user sets the size; the subset is toggled back to 100k
    settings.pointSize = 2.2;
    settings.autoPointSize = false;
    applyAutoPointStyle(settings, 1e5, BASE);
    assert.equal(settings.pointSize, 2.2);
    assert.equal(settings.pointOpacity, autoPointStyle(1e5, BASE).opacity);
});

test('the base follows the server default for few points', () => {
    assert.deepEqual(autoPointStyle(100, { size: 3, opacity: 0.6 }), { size: 3, opacity: 0.6 });
    const s = autoPointStyle(1e7, { size: 3, opacity: 0.6 });
    assert.ok(s.size < 3 && s.opacity < 0.6);
});
