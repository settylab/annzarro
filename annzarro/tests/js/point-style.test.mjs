/**
 * Automatic point size and opacity (static/js/utils/point-style.js): until
 * the user sets them, they follow the number of points drawn.
 *
 * Run:  node --test annzarro/tests/js/point-style.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapPointSize } from '../../../static/js/utils/slider-scales.js';
import { autoPointStyle, initAutoPointStyle, applyAutoPointStyle, autoValue, AUTO_CURVE } from '../../../static/js/utils/point-style.js';

const BASE = { size: 5, opacity: 1 };

// the curve itself (sizes not snapped to scattergl's steps)
const curve = (n, base = BASE) => ({
    size: autoValue(n, base.size, AUTO_CURVE.size),
    opacity: Math.min(1, autoValue(n, base.opacity, AUTO_CURVE.opacity))
});

test('small data keeps the default look', () => {
    for (const n of [0, 1, 200]) assert.deepEqual(curve(n), BASE, `n=${n}`);
    const k = curve(1000);   // a thousand points: within 6% (size) and 2% (opacity)
    assert.ok(k.size >= 4.7 && k.opacity >= 0.98, JSON.stringify(k));
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
    // raw curve (before snapping to the smallest drawable step)
    const big = curve(95.6e6);
    assert.equal(big.size, 0.27, `95.6M size ${big.size}`);
    assert.equal(big.opacity, 0.19, `95.6M opacity ${big.opacity}`);
});

test('the curve in numbers, as drawn (snapped to scattergl steps): steep from 100 to 100k, smallest step from 10M', () => {
    const drawn = (n) => { const { size, opacity } = autoPointStyle(n, BASE); return [size, opacity]; };
    assert.deepEqual(drawn(100), [5.1, 1]);
    assert.deepEqual(drawn(1e3), [4.71, 0.98]);
    assert.deepEqual(drawn(1e4), [3.53, 0.87]);
    assert.deepEqual(drawn(1e5), [1.96, 0.64]);
    assert.deepEqual(drawn(1e6), [1.18, 0.43]);
    assert.deepEqual(drawn(1e7), [0.392, 0.28]);
    assert.deepEqual(drawn(95.6e6), [0.392, 0.19]);
    // each tenfold between 1k and 1M takes the size down by a clear factor
    for (const n of [1e3, 1e4, 1e5]) {
        assert.ok(autoPointStyle(n * 10, BASE).size <= 0.8 * autoPointStyle(n, BASE).size, `n=${n}`);
    }
});

test('snapped sizes are monotone in N and never below the smallest step scattergl draws', () => {
    const step = 100 / 255;
    let prev = Infinity;
    for (let e = 0; e <= 9; e += 0.05) {
        const { size } = autoPointStyle(10 ** e, BASE);
        assert.ok(size <= prev, `size grew at n=1e${e}`);
        assert.ok(size >= Number(step.toPrecision(3)), `n=1e${e}: ${size}`);
        prev = size;
    }
    // 3D sizes are not snapped but have the same floor
    assert.equal(autoPointStyle(1e9, BASE, true).size, 0.392);
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
    assert.equal(autoPointStyle(95.6e6, BASE).size, 0.392);  // the smallest step (the curve gives 0.27)
    // 3D (scatter3d) sizes are not quantised: no snapping there
    const settings = { z: { type: 'obsm' }, pointSize: 5, pointOpacity: 1, autoPointSize: true, autoPointOpacity: true };
    applyAutoPointStyle(settings, 95.6e6, BASE);
    assert.equal(settings.pointSize, 0.392);   // the curve's 0.27 raised to the smallest step
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

test('greyMarker: the greyed-out points follow the curve for their own count, whatever the main points have', async () => {
    const { greyMarker, NOT_IN_TABLE_COLOR } = await import('../../../static/js/utils/point-style.js');
    const want = autoPointStyle(1e6, BASE);
    const auto = { autoPointSize: true, autoPointOpacity: true, pointSize: 1.18, pointOpacity: 0.43 };
    assert.deepEqual(greyMarker(auto, 1e6), { ...want, color: NOT_IN_TABLE_COLOR });
    // a size or opacity set for the main points does not enter
    const set = { autoPointSize: false, autoPointOpacity: false, pointSize: 9, pointOpacity: 0.1 };
    assert.deepEqual(greyMarker(set, 1e6), { ...want, color: NOT_IN_TABLE_COLOR });
    // their count decides: fewer points, a larger size
    assert.ok(greyMarker(set, 1e3).size > greyMarker(set, 1e6).size);
});

test('greyMarker: scale, opacity and colour of the panel replace the defaults; bad values fall back', async () => {
    const { greyMarker } = await import('../../../static/js/utils/point-style.js');
    const base = greyMarker({}, 1e6);
    const m = greyMarker({ notInTableScale: 2, notInTableOpacity: 0.25, notInTableColor: '#ff0000' }, 1e6);
    assert.equal(m.size, snapPointSize(base.size * 2));
    assert.equal(m.opacity, 0.25);
    assert.equal(m.color, '#ff0000');
    assert.deepEqual(greyMarker({ notInTableScale: -1, notInTableOpacity: 7 }, 1e6), base);
    // 3D sizes are not snapped
    const z = { z: { type: 'obsm', key: 'X_umap', column: '2' }, notInTableScale: 1.37 };
    assert.equal(greyMarker(z, 1e6).size, autoPointStyle(1e6, BASE, true).size * 1.37);
});

test('plot area: the reference area draws the calibrated values exactly, an unknown area is the reference', async () => {
    const { REF_AREA } = await import('../../../static/js/utils/point-style.js');
    assert.equal(REF_AREA, 660 * 332);
    for (const n of [0, 100, 1e3, 1e4, 1e5, 1e6, 5e6, 1e7, 95.6e6]) {
        for (const is3D of [false, true]) {
            const today = autoPointStyle(n, BASE, is3D);
            assert.deepEqual(autoPointStyle(n, BASE, is3D, REF_AREA), today, `n=${n} 3D=${is3D}`);
            for (const unknown of [undefined, 0, -5, NaN, null]) {
                assert.deepEqual(autoPointStyle(n, BASE, is3D, unknown), today, `n=${n} area=${unknown}`);
            }
        }
    }
    assert.deepEqual(Object.values(autoPointStyle(1e6, BASE, false, REF_AREA)), [1.18, 0.43]);
});

test('plot area: N points in k times the area draw as N/k points do; larger is larger and more opaque', async () => {
    const { REF_AREA, areaCount } = await import('../../../static/js/utils/point-style.js');
    for (const k of [1 / 8, 1 / 4, 1 / 2, 2, 3, 8]) {
        assert.equal(areaCount(1e6, REF_AREA * k), 1e6 / k);
        assert.deepEqual(autoPointStyle(1e6, BASE, false, REF_AREA * k), autoPointStyle(1e6 / k, BASE), `k=${k}`);
    }
    for (const n of [1e5, 1e6, 5e6]) {
        let prev = { size: 0, opacity: 0 };
        for (let e = -4; e <= 4; e += 0.25) {
            const s = autoPointStyle(n, BASE, false, REF_AREA * 2 ** e);
            assert.ok(s.size >= prev.size && s.opacity >= prev.opacity, `n=${n} area 2^${e}`);
            prev = s;
        }
        const ref = autoPointStyle(n, BASE, false, REF_AREA);
        const big = autoPointStyle(n, BASE, false, REF_AREA * 4);
        const small = autoPointStyle(n, BASE, false, REF_AREA / 4);
        assert.ok(big.size > ref.size && big.opacity > ref.opacity, `n=${n} bigger`);
        assert.ok(small.size < ref.size && small.opacity < ref.opacity, `n=${n} smaller`);
    }
    // 3D: the size follows the area, the opacity stays 1
    assert.ok(autoPointStyle(1e6, BASE, true, REF_AREA * 4).size > autoPointStyle(1e6, BASE, true).size);
    assert.equal(autoPointStyle(1e6, BASE, true, REF_AREA * 4).opacity, 1);
    assert.equal(autoPointStyle(1e6, BASE, true, REF_AREA / 4).opacity, 1);
});

test('plot area: the factor is held within 1/8 and 8; never above the base for few points', async () => {
    const { REF_AREA, AREA_RANGE, areaCount } = await import('../../../static/js/utils/point-style.js');
    assert.deepEqual([...AREA_RANGE], [1 / 8, 8]);
    for (const n of [1e5, 1e6, 1e7]) {
        assert.deepEqual(autoPointStyle(n, BASE, false, REF_AREA * 100), autoPointStyle(n, BASE, false, REF_AREA * 8));
        assert.deepEqual(autoPointStyle(n, BASE, false, REF_AREA / 100), autoPointStyle(n, BASE, false, REF_AREA / 8));
    }
    assert.equal(areaCount(8e6, REF_AREA * 1e6), 1e6);
    assert.equal(areaCount(1e6, 1), 8e6);
    for (const n of [1, 200, 1e3]) {
        const s = autoPointStyle(n, BASE, false, REF_AREA * 8);
        assert.ok(s.size <= snapPointSize(BASE.size) && s.opacity <= BASE.opacity, `n=${n}`);
    }
});

test('plot area: applyAutoPointStyle keeps the area per panel; the grey points follow it; a set value stays', async () => {
    const { REF_AREA, styleArea, greyMarker } = await import('../../../static/js/utils/point-style.js');
    const auto = { autoPointSize: true, autoPointOpacity: true };
    assert.equal(styleArea(auto), undefined);
    applyAutoPointStyle(auto, 1e6, BASE);
    assert.equal(auto.pointSize, 1.18);
    assert.equal(applyAutoPointStyle(auto, 1e6, BASE, REF_AREA * 4), true);
    assert.equal(styleArea(auto), REF_AREA * 4);
    assert.deepEqual([auto.pointSize, auto.pointOpacity], Object.values(autoPointStyle(1e6, BASE, false, REF_AREA * 4)));
    // no area given: the panel's last one
    assert.equal(applyAutoPointStyle(auto, 1e6, BASE), false);
    assert.equal(greyMarker(auto, 1e6).size, autoPointStyle(1e6, { size: 5, opacity: 0.7 }, false, REF_AREA * 4).size);
    // the area is not a setting: nothing saved or shared carries it
    assert.deepEqual(Object.keys(auto).sort(), ['autoPointOpacity', 'autoPointSize', 'pointOpacity', 'pointSize']);

    const set = { autoPointSize: false, autoPointOpacity: false, pointSize: 3, pointOpacity: 0.5 };
    assert.equal(applyAutoPointStyle(set, 1e6, BASE, REF_AREA / 8), false);
    assert.equal(applyAutoPointStyle(set, 1e6, BASE, REF_AREA * 8), false);
    assert.deepEqual([set.pointSize, set.pointOpacity], [3, 0.5]);
});
