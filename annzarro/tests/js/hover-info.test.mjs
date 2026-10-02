/**
 * Hover labels honour hoverInfo and format numbers.
 *
 * hoverInfo was saved in every plot config and link but never read, and the
 * colour value came out raw (3.347795285435495e-8). Headless on view E the
 * 'In table' trace now reads "...<br>c: %{marker.color:.4~g}" plus
 * "highres_celltype: HSC" for each point.
 *
 * Run:  node --test annzarro/tests/js/hover-info.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {}, location: { href: 'http://localhost/' }, Config: {} };
globalThis.document = {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => []
};
const restyles = [];
globalThis.Plotly = new Proxy({}, { get: (_, k) => k === 'restyle' ? (gd, u, i) => { restyles.push([u, i]); return Promise.resolve(); } : () => Promise.resolve() });
globalThis.fetch = async () => ({ ok: false, statusText: 'test' });

const { applyHoverInfo, formatHoverValue, hoverTemplateFor } =
    await import('../../../static/js/panels/plot-utilities/plot-make.js');

test('numbers get 4 significant digits, missing values NA', () => {
    assert.equal(formatHoverValue(3.347795285435495e-8), '3.348e-8');
    assert.equal(formatHoverValue(10.210302257599338), '10.21');
    assert.equal(formatHoverValue(42), '42');
    assert.equal(formatHoverValue(null), 'NA');
    assert.equal(formatHoverValue(NaN), 'NA');
    assert.equal(formatHoverValue('HSC'), 'HSC');
});

test('templates format x, y, z and colour; categorical traces name their category', () => {
    const num = hoverTemplateFor({ marker: { color: [1], colorscale: 'RdBu' } }, { z: null }, { colorType: 'numerical' });
    assert.match(num, /x: %\{x:\.4~g\}<br>y: %\{y:\.4~g\}<br>c: %\{marker\.color:\.4~g\}/);
    const cat = hoverTemplateFor({ name: 'HSC', marker: { color: '#f00' } }, { z: { key: 'z' } }, { colorType: 'categorical', hoverExtra: [{}] });
    assert.match(cat, /z: %\{z:\.4~g\}<br>HSC%\{hovertext\}/);
});

test('hoverInfo columns become per-point hovertext, matched by name', async () => {
    restyles.length = 0;
    const gd = { data: [
        { name: 'Not in table', text: ['c2', 'c0'] },
        { name: 'z', text: ['c1'], marker: { color: [0.5], colorscale: 'RdBu' } },
        { name: 'Focused Cell', text: ['c1'] }
    ] };
    const data = { entities: 'cells', cells: ['c0', 'c1', 'c2'], colorType: 'numerical',
        hoverExtra: [{ label: 'highres_celltype', values: ['HSC', 'GMP', null] }, { label: 'score', values: [1.23456, 2, 3e-9] }] };
    await applyHoverInfo(gd, data, { z: null });
    const [[update, indices]] = restyles;
    assert.deepEqual(indices, [0, 1], 'the focused-cell marker is left alone');
    assert.deepEqual(update.hovertext[0], ['<br>highres_celltype: NA<br>score: 3e-9', '<br>highres_celltype: HSC<br>score: 1.235']);
    assert.deepEqual(update.hovertext[1], ['<br>highres_celltype: GMP<br>score: 2']);
});
