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

/**
 * Move the one point of scattergl trace `i` (the focused-cell marker) to
 * (x, y) in its regl scene, without Plotly.restyle: at 1M points a restyle
 * of its x and y took 450 ms (calc and scene.update of every trace), this
 * a redraw of the scene. gd.data, gd._fullData and the trace's calcdata get
 * the new position, so a zoom, a full redraw or an export draws it there.
 * The axes are kept as they are (the marker sits on a drawn point). Returns
 * false, with nothing changed, when the scene or the trace is not as
 * expected; the caller restyles then.
 * @param {HTMLElement} gd
 * @param {number} i  trace index
 * @param {number} x
 * @param {number} y
 */
export function setGlPoint(gd, i, x, y) {
  const scene = sceneOf(gd);
  const fl = gd && gd._fullLayout;
  const trace = gd && Array.isArray(gd.data) ? gd.data[i] : null;
  const full = scene && gd._fullData[i];
  const opts = scene && scene.markerOptions[i];
  const cd = Array.isArray(gd && gd.calcdata) && gd.calcdata[i] && gd.calcdata[i][0];
  const stash = cd && cd.t;
  if (!scene || !trace || !full || !opts || !stash || full._length !== 1 || !opts.positions
      || opts.positions.length !== 2 || !fl.xaxis || !fl.yaxis) return false;
  const xa = fl.xaxis, ya = fl.yaxis;
  if (!['linear', 'log'].includes(xa.type) || !['linear', 'log'].includes(ya.type)) return false;
  const cx = xa.d2c(x), cy = ya.d2c(y);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
  // regl-scatter2d positions are linearized: log axes in log10, as Plotly's calc makes them
  const positions = [xa.type === 'log' ? xa.c2l(cx) : cx, ya.type === 'log' ? ya.c2l(cy) : cy];
  if (!positions.every(Number.isFinite)) return false;
  trace.x = [x];
  trace.y = [y];
  full.x = trace.x;
  full.y = trace.y;
  full._x = [cx];
  full._y = [cy];
  stash.x = full._x;
  stash.y = full._y;
  stash.positions = positions;
  opts.positions = positions;
  scene.scatter2d.update(scene.markerOptions.map((o, k) => (k === i ? { positions } : {})));
  fl._glcanvas.each((c) => { if (c && c.regl) c.regl.clear({ color: [0, 0, 0, 0], depth: 1 }); });
  scene.draw();
  return true;
}
