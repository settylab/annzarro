/**
 * Marker size and opacity of a scattergl plot, set in its regl scene
 * without Plotly.restyle.
 *
 * Plotly 2.20 gives every scattergl attribute editType 'calc', so a
 * restyle of marker.size reruns calc and scene.update for every trace:
 * per-trace calcdata and position arrays are rebuilt on the JS heap while
 * the current ones are alive. At 95.6M points in large-plot mode (1037
 * traces) that ran the tab's V8 heap (about 3.2 GB under pointer
 * compression) out of memory and crashed it on the first size change, on
 * main as well. Here the change goes to the regl groups directly: about
 * 9 ms, and no allocation that scales with the points.
 *
 * Plotly stays consistent: gd.data, gd._fullData and the scene's
 * markerOptions carry the new values, so a later relayout (zoom) or a full
 * redraw draws the same. The axes are kept as they are (a restyle would
 * re-run autorange for the new marker padding).
 *
 * It relies on Plotly's scene internals (vendored Plotly 2.20). When they
 * are not as expected, it returns false and the caller restyles.
 */

let warned = false;

/** The regl scene of `gd`'s xy subplot, if it has the shape this module needs. */
function sceneOf(gd) {
  const fl = gd && gd._fullLayout;
  const scene = fl && fl._plots && fl._plots.xy && fl._plots.xy._scene;
  if (!scene || !scene.scatter2d || typeof scene.scatter2d.update !== 'function'
      || typeof scene.draw !== 'function' || !Array.isArray(scene.markerOptions)
      || !fl._glcanvas || typeof fl._glcanvas.each !== 'function'
      || !Array.isArray(gd.data) || !Array.isArray(gd._fullData)
      || scene.markerOptions.length !== gd.data.length) return null;
  return scene;
}

/**
 * Set size and opacity of every trace not skipped by `skip(trace)`.
 * Returns false (after one console.warn) when the scene cannot be reached;
 * nothing has changed then.
 */
export function setGlMarkers(gd, size, opacity, skip = () => false) {
  const scene = sceneOf(gd);
  if (!scene) {
    if (!warned) {
      warned = true;
      console.warn('Point size/opacity: Plotly scene internals not found; using Plotly.restyle');
    }
    return false;
  }
  const update = scene.markerOptions.map((opts, i) => {
    const trace = gd.data[i];
    if (!opts || !trace || skip(trace)) return {};          // {}: this group unchanged
    opts.size = size;
    opts.opacity = opacity;
    for (const t of [trace, gd._fullData[i]]) {
      if (t && t.marker) { t.marker.size = size; t.marker.opacity = opacity; }
    }
    return { size, opacity };
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
