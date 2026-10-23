import test from 'node:test';
import assert from 'node:assert/strict';
import { translateY, extraHeight, legendIsClipped } from '../../../static/js/utils/legend-export.js';

test('translateY reads the y of a translate', () => {
  assert.equal(translateY('translate(435.98,100)'), 100);
  assert.equal(translateY('translate(1 -20.5)'), -20.5);
  assert.equal(translateY(''), 0);
  assert.equal(translateY(null), 0);
});

test('extraHeight is what the image lacks under the legend, 0 when it fits', () => {
  assert.equal(extraHeight(800, 100, 1150), 1150 + 100 + 8 - 800);
  assert.equal(extraHeight(800, 100, 500), 0);
  assert.equal(extraHeight(800, 100, 692), 0);
  assert.equal(extraHeight(800, 100, 693), 1);
  assert.equal(extraHeight(800, NaN, 500), 0);
});

test('a legend is clipped when it is taller than the box Plotly shows', () => {
  assert.equal(legendIsClipped({ legend: { _height: 1150, _effHeight: 220 } }), true);
  assert.equal(legendIsClipped({ legend: { _height: 220, _effHeight: 220 } }), false);
  assert.equal(legendIsClipped({ showlegend: false, legend: { _height: 1150, _effHeight: 220 } }), false);
  assert.equal(legendIsClipped({}), false);
});
