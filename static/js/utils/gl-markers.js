/**
 * Marker size and opacity of a 2D (scattergl) plot, set in its regl scene
 * without Plotly.restyle. Used in both plot modes; colour and data changes
 * still go through Plotly.
 *
 * Plotly 2.20 gives every scattergl attribute editType 'calc', so a
 * restyle of marker.size reruns calc and scene.update for every trace:
 * per-trace calcdata and position arrays are rebuilt on the JS heap while
 * the current ones are alive. At 95.6M points in large-plot mode (1037
 * traces) that ran the tab's V8 heap (about 3.2 GB under pointer
 * compression) out of memory and crashed it on the first size change, on
 * main as well; at 5M points in the regular mode one change took 1.4 s and
 * the heap from 1.5 to 2.9 GB. Here the change goes to the regl groups
 * directly: milliseconds, and no allocation that scales with the points.
 * Hover and click read calcdata positions, which do not change.
 *
 * Plotly stays consistent: gd.data, gd._fullData and the scene's
 * markerOptions carry the new values, so a later relayout (zoom) or a full
 * redraw draws the same. The axes are kept as they are (a restyle would
 * re-run autorange for the new marker padding).
 *
 * It relies on Plotly's scene internals (vendored Plotly 2.20). When they
 * are not as expected, it returns false and the caller restyles.
 */

import { OPACITY_IN_SCENE } from './scattergl-calc.js';

let warned = false;

/**
 * The regl scene of `gd`'s xy subplot, if it has the shape this module
 * needs: every trace a scattergl trace of that subplot, so scene group i
 * is trace i.
 */
function sceneOf(gd) {
  const fl = gd && gd._fullLayout;
  const scene = fl && fl._plots && fl._plots.xy && fl._plots.xy._scene;
  if (!scene || !scene.scatter2d || typeof scene.scatter2d.update !== 'function'
      || typeof scene.draw !== 'function' || !Array.isArray(scene.markerOptions)
      || !fl._glcanvas || typeof fl._glcanvas.each !== 'function'
      || !Array.isArray(gd.data) || !Array.isArray(gd._fullData)
      || scene.markerOptions.length !== gd.data.length
      || gd._fullData.length !== gd.data.length
      || !gd._fullData.every(t => t && t.type === 'scattergl' && (t.xaxis || 'x') === 'x' && (t.yaxis || 'y') === 'y')) {
    return null;
  }
  return scene;
}

/**
 * Set marker size and opacity per trace: `styleOf(trace)` returns
 * { size?, opacity? } (a scalar each; what is left out is kept) or null to
 * leave the trace alone. Returns false (after one console.warn) when the
 * scene cannot be reached, and false when an opacity would go to a trace
 * whose per-point colours Plotly made (they carry the old opacity); nothing
 * has changed then.
 */
export function setGlMarkers(gd, styleOf) {
  const scene = sceneOf(gd);
  if (!scene) {
    if (!warned) {
      warned = true;
      console.warn('Point size/opacity: Plotly scene internals not found; using Plotly.restyle');
    }
    return false;
  }
  // Plotly folds the marker opacity into per-point colours (its own, not
  // scattergl-calc.js ones): a scene opacity would come on top of it
  const styles = scene.markerOptions.map((opts, i) => (opts && gd.data[i] ? styleOf(gd.data[i]) : null));
  if (styles.some((st, i) => st && st.opacity !== undefined && Array.isArray(scene.markerOptions[i].colors)
      && !scene.markerOptions[i][OPACITY_IN_SCENE])) {
    return false;
  }
  const update = scene.markerOptions.map((opts, i) => {
    const trace = gd.data[i];
    const style = styles[i];
    if (!style) return {};                                   // {}: this group unchanged
    const change = {};
    for (const key of ['size', 'opacity']) {
      if (style[key] === undefined) continue;
      change[key] = style[key];
      opts[key] = style[key];
      for (const t of [trace, gd._fullData[i]]) if (t && t.marker) t.marker[key] = style[key];
    }
    return change;
  });
  scene.scatter2d.update(update);
  // the scene draws over the canvas; without a clear, smaller markers would
  // leave the larger old ones visible
  gd._fullLayout._glcanvas.each((c) => { if (c && c.regl) c.regl.clear({ color: [0, 0, 0, 0], depth: 1 }); });
  scene.draw();
  return true;
}

/** For tests: warn again on the next fallback. */
export function _resetGlMarkersWarning() { warned = false; }
