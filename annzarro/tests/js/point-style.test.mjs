/**
 * Automatic point size and opacity (static/js/utils/point-style.js): until
 * the user sets them, they follow the number of points drawn.
 *
 * Run:  node --test annzarro/tests/js/point-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPointStyle, initAutoPointStyle, applyAutoPointStyle, autoValue, AUTO_CURVE } from '../../../static/js/utils/point-style.js';

const BASE = { size: 5, opacity: 1 };

// the curve itself (sizes not snapped to scattergl's steps)
const curve = (n, base = BASE) => ({
    size: autoValue(n, base.size, AUTO_CURVE.size),
    opacity: Math.min(1, autoValue(n, base.opacity, AUTO_CURVE.opacity))
});

test('small data keeps the default look', () => {
    for (const n of [0, 1, 200]) assert.deepEqual(curve(n), BASE, `n=${n}`);
    const k = curve(1000);   // a thousand points: within 2%
    assert.ok(k.size >= 4.9 && k.opacity >= 0.98, JSON.stringify(k));
});

test('large data gets smaller, fainter points; smooth and monotone in N', () => {
    let prev = curve(1);
    for (let e = 0.5; e <= 8.5; e += 0.05) {
        const s = curve(10 ** e);
        assert.ok(s.size <= prev.size && s.opacity <= prev.opacity, `n=1e${e}`);
        // no step: neighbouring N (12% apart) differ by one rounding step at most
        assert.ok(s.size >= prev.size * 0.9 && s.opacity >= prev.opacity * 0.9, `jump at n=1e${e}`);
        prev = s;
    }
    const big = curve(95.6e6);
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
    assert.deepEqual(curve(100, { size: 3, opacity: 0.6 }), { size: 3, opacity: 0.6 });
    const s = curve(1e7, { size: 3, opacity: 0.6 });
    assert.ok(s.size < 3 && s.opacity < 0.6);
});

test('automatic sizes are ones scattergl draws: whole steps of 100/255 px', () => {
    const step = 100 / 255;
    for (const n of [200, 1e4, 1e5, 1e6, 1e7, 95.6e6]) {
        const { size } = autoPointStyle(n, BASE);
        const k = Math.round(size / step);
        assert.ok(k >= 1 && Math.round(255 * size / 100) === k, `n=${n}: ${size}`);
    }
    assert.equal(autoPointStyle(200, BASE).size, 5.1);       // the default 5 draws as 13 steps
    assert.equal(autoPointStyle(95.6e6, BASE).size, 0.784);  // 0.92 draws as 2 steps
    // 3D (scatter3d) sizes are not quantised: no snapping there
    const settings = { z: { type: 'obsm' }, pointSize: 5, pointOpacity: 1, autoPointSize: true, autoPointOpacity: true };
    applyAutoPointStyle(settings, 95.6e6, BASE);
    assert.equal(settings.pointSize, 0.92);
});

test('3D: automatic opacity is 1 at every N (Plotly draws translucent scatter3d points out of depth order)', () => {
    for (const n of [200, 1e5, 1e6, 95.6e6]) {
        assert.equal(autoPointStyle(n, BASE, true).opacity, 1, `n=${n}`);
        assert.ok(autoPointStyle(n, { size: 5, opacity: 0.6 }, true).opacity === 1, 'whatever the 2D base');
    }
    // 2D -> 3D -> 2D on automatic opacity: the 2D value, then 1, then the 2D value again
    const settings = { pointSize: 5, pointOpacity: 1, autoPointSize: true, autoPointOpacity: true, z: null };
    applyAutoPointStyle(settings, 1e6, BASE);
    const flat = settings.pointOpacity;
    assert.ok(flat < 1);
    settings.z = { type: 'obsm', key: 'X_umap', column: '2' };
    applyAutoPointStyle(settings, 1e6, BASE);
    assert.equal(settings.pointOpacity, 1);
    settings.z = null;
    applyAutoPointStyle(settings, 1e6, BASE);
    assert.equal(settings.pointOpacity, flat);
    // an opacity the user chose stays, also in 3D
    const chosen = { pointSize: 2, pointOpacity: 0.3, autoPointSize: false, autoPointOpacity: false,
                     z: { type: 'obsm', key: 'X_umap', column: '2' } };
    applyAutoPointStyle(chosen, 1e6, BASE);
    assert.equal(chosen.pointOpacity, 0.3);
});
