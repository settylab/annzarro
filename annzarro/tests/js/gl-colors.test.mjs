/**
 * Per-point colours of 2D plots computed outside Plotly
 * (static/js/utils/gl-colors.js): the wrapped scattergl calc runs Plotly
 * with a placeholder colour and hands the scene the colours computed here.
 * That they equal Plotly's own colours is tested in a browser against
 * Plotly (annzarro/tests/browser/test_point_colours.py); here the parts that
 * need no Plotly: the scale function, the colour range, which traces it
 * takes, and what the wrapper leaves behind.
 *
 * Run:  node --test annzarro/tests/js/gl-colors.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    parseScaleColor, scaleColorFunction, colorRange, eligible, wrapScatterglModule,
    OPACITY_IN_SCENE, _setGlColorsDisabled
} = await import('../../../static/js/utils/gl-colors.js');

test('scale colours: the forms Plotly scales use; anything else is not read', () => {
    assert.deepEqual(parseScaleColor('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseScaleColor('#440154'), [68, 1, 84, 1]);
    assert.deepEqual(parseScaleColor('rgb(5,10, 200)'), [5, 10, 200, 1]);
    assert.deepEqual(parseScaleColor('rgba(5, 10, 200, 0.5)'), [5, 10, 200, 0.5]);
    assert.deepEqual(parseScaleColor('rgb(300, 1.4, 1.6)'), [255, 1, 2, 1]);
    for (const s of ['red', 'hsl(0, 50%, 50%)', 'rgb(1, 2)', 'rgba(1, 2, 3)', 'rgb(1, 2, 3, 0.5)', 7, null]) {
        assert.equal(parseScaleColor(s), null, String(s));
    }
});

test('scale function: clamped linear steps, integer RGB, shared results, grey for missing', () => {
    const f = scaleColorFunction([[0, 'rgb(0, 0, 0)'], [0.5, 'rgb(100, 0, 0)'], [1, 'rgb(100, 200, 0)']], false, 0, 10);
    assert.deepEqual(f(0), [0, 0, 0, 1]);
    assert.deepEqual(f(-5), [0, 0, 0, 1], 'below cmin: the first colour');
    assert.deepEqual(f(2.5), [50 / 255, 0, 0, 1]);
    assert.deepEqual(f(7.5), [100 / 255, 100 / 255, 0, 1]);
    assert.deepEqual(f(99), [100 / 255, 200 / 255, 0, 1], 'above cmax: the last colour');
    assert.equal(f(2.5), f(2.5000001), 'equal colours are one array');
    const grey = [68 / 255, 68 / 255, 68 / 255, 1];
    for (const v of [NaN, null, undefined, Infinity]) assert.deepEqual(f(v), grey, String(v));
    // reversed: the stops mirrored
    const r = scaleColorFunction([[0, '#000000'], [1, '#ffffff']], true, 0, 1);
    assert.deepEqual(r(0), [1, 1, 1, 1]);
    assert.deepEqual(r(1), [0, 0, 0, 1]);
    // alpha rounded to two digits, as tinycolor writes it
    const a = scaleColorFunction([[0, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 0, 1)']], false, 0, 3);
    assert.deepEqual(a(1), [0, 0, 0, 0.33]);
    assert.equal(scaleColorFunction([[0, 'red'], [1, '#fff']], false, 0, 1), null);
});

test('colour range: the data\'s when automatic, the set one otherwise, widened when flat', () => {
    assert.deepEqual(colorRange({ cauto: true }, [3, NaN, -1, null, 7, Infinity]), [-1, 7]);
    assert.deepEqual(colorRange({ cauto: false, cmin: 0, cmax: 2 }, [3, -1]), [0, 2]);
    assert.deepEqual(colorRange({ cauto: true, cmin: 0, cmax: 2 }, [3, -1]), [-1, 3]);
    assert.deepEqual(colorRange({ cauto: true }, [4, 4]), [3.5, 4.5]);
    assert.deepEqual(colorRange({ cauto: true }, [NaN]), [-0.5, 0.5], 'no number: Plotly\'s false - 0.5');
});

const fullTrace = (over = {}) => ({
    type: 'scattergl', visible: true, opacity: 1, _length: 3,
    marker: { color: [1, 2, 3], colorscale: [[0, '#000000'], [1, '#ffffff']], cauto: true, opacity: 0.4,
        symbol: 'circle', angle: 0, line: { color: '#444', width: 0 }, ...over }
});

test('eligible: numeric colour per point over its own scale, one opacity and symbol', () => {
    assert.equal(eligible(fullTrace()), true);
    assert.equal(eligible(fullTrace({ color: new Float32Array([1, 2, 3]) })), true);
    assert.equal(eligible(fullTrace({ color: [1, null, undefined] })), true);
    for (const [why, over] of [
        ['one colour', { color: '#ff0000' }], ['colour names', { color: ['red', 'blue', 'red'] }],
        ['too short', { color: [1, 2] }], ['colour axis', { coloraxis: 'coloraxis' }],
        ['auto scale', { autocolorscale: true }], ['cmid', { cmid: 0 }],
        ['opacity per point', { opacity: [1, 1, 1] }], ['open symbol', { symbol: 'circle-open' }],
        ['symbol per point', { symbol: ['circle', 'square', 'circle'] }],
        ['border colour per point', { line: { color: [1, 2, 3], width: 1 } }]]) {
        assert.equal(eligible(fullTrace(over)), false, why);
    }
    assert.equal(eligible({ ...fullTrace(), visible: 'legendonly' }), false);
});

/** A calc like Plotly's as far as the wrapper sees it: stash, scene, marker options. */
function fakeModule(seen) {
    const scene = { markerOptions: [], count: 0 };
    return {
        scene,
        module: {
            name: 'scattergl',
            calc(gd, trace) {
                seen.push({ color: trace.marker.color, cmin: trace.marker.cmin, cmax: trace.marker.cmax,
                    cauto: trace.marker.cauto });
                const opts = { color: [0, 0, 0, 0], opacity: trace.opacity * trace.marker.opacity };
                scene.markerOptions.push(opts);
                return [{ t: { _scene: scene, index: scene.count++ } }];
            }
        }
    };
}

test('wrapped calc: Plotly sees one colour and a set range; the scene gets the colours', () => {
    const seen = [];
    const { module, scene } = fakeModule(seen);
    assert.equal(wrapScatterglModule(module), true);
    const calc = module.calc;
    assert.equal(wrapScatterglModule(module), true);
    assert.equal(module.calc, calc, 'wrapped once');
    const t = fullTrace();
    const values = t.marker.color;
    module.calc({}, t);
    assert.equal(typeof seen[0].color, 'string');
    assert.deepEqual([seen[0].cmin, seen[0].cmax, seen[0].cauto], [1, 3, false]);
    assert.equal(t.marker.color, values, 'the values are back');
    assert.equal(t.marker.cauto, true, 'still automatic');
    assert.deepEqual([t.marker.cmin, t.marker.cmax], [1, 3], 'the range Plotly would have computed');
    const opts = scene.markerOptions[0];
    assert.equal(opts.color, undefined);
    assert.deepEqual(opts.colors, [[0, 0, 0, 1], [128 / 255, 128 / 255, 128 / 255, 1], [1, 1, 1, 1]]);
    assert.equal(opts.opacity, 0.4, 'the opacity is the scene\'s, not in the colours');
    assert.equal(opts[OPACITY_IN_SCENE], true);
});

test('wrapped calc: other traces, and the switch for tests, go straight to Plotly', () => {
    const seen = [];
    const { module, scene } = fakeModule(seen);
    wrapScatterglModule(module);
    const named = fullTrace({ color: ['red', 'blue', 'red'] });
    module.calc({}, named);
    assert.deepEqual(seen[0].color, ['red', 'blue', 'red']);
    assert.equal(scene.markerOptions[0].colors, undefined);
    _setGlColorsDisabled(true);
    try {
        module.calc({}, fullTrace());
        assert.deepEqual(seen[1].color, [1, 2, 3]);
    } finally {
        _setGlColorsDisabled(false);
    }
    assert.equal(wrapScatterglModule({ name: 'scatter', calc() {} }), false);
});
