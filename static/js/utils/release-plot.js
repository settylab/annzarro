/**
 * Free what a Plotly graph holds on the GPU, then purge it.
 *
 * Plotly.purge (2.20) removes a WebGL plot's canvases from the page and
 * drops its data, but never destroys the scattergl scene, the regl context
 * or the WebGL context itself: their GPU buffers and the context stay until
 * the canvas is garbage-collected, and anything that still refers to the
 * scene keeps them for good. A page may hold about 16 live WebGL contexts
 * (each 2D plot holds two); past that the browser drops the oldest, and a
 * panel goes blank. Every image export draws an off-screen copy of the plot
 * and purges it the same way.
 *
 * releasePlot(gd) destroys the scenes and regl contexts and loses each
 * WebGL context first, so closing a panel, redrawing one from scratch, or
 * exporting gives the memory back when it says it does.
 */

/** The regl (WebGL) contexts of a graph, as Plotly keeps them on its canvases. */
function reglsOf(gd) {
    const fl = gd && gd._fullLayout;
    const out = [];
    if (fl && fl._glcanvas && typeof fl._glcanvas.each === 'function') {
        fl._glcanvas.each((d) => { if (d && d.regl) out.push(d); });
    }
    return out;
}

/** Destroy every subplot scene (2D WebGL and 3D) of `gd`. */
function destroyScenes(fl) {
    for (const plot of Object.values(fl._plots || {})) {
        const scene = plot && plot._scene;
        if (scene && typeof scene.destroy === 'function') {
            try { scene.destroy(); } catch { /* already gone */ }
        }
    }
    const gl3d = (fl._subplots && fl._subplots.gl3d) || [];
    for (const id of gl3d) {
        const scene = fl[id] && fl[id]._scene;
        if (scene && typeof scene.destroy === 'function') {
            try { scene.destroy(); } catch { /* already gone */ }
        }
    }
}

/**
 * Free the GPU side of `gd` without purging it: scenes, regl contexts and
 * the WebGL contexts. The graph cannot draw afterwards; purge or redraw it.
 * @returns {number} WebGL contexts released
 */
export function releaseGl(gd) {
    const fl = gd && gd._fullLayout;
    if (!fl) return 0;
    destroyScenes(fl);
    let released = 0;
    for (const d of reglsOf(gd)) {
        const gl = d.regl._gl;
        try { d.regl.destroy(); } catch { /* already destroyed */ }
        d.regl = null;
        try {
            const ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
            if (ext && !gl.isContextLost()) { ext.loseContext(); released++; }
        } catch { /* no context to lose */ }
    }
    return released;
}

/**
 * Release the GPU side of `gd`, then Plotly.purge it. Safe on a div that is
 * not (or no longer) a plot.
 */
export function releasePlot(gd) {
    if (!gd) return;
    try { releaseGl(gd); } catch (e) { console.warn('releasePlot: could not free the WebGL side', e); }
    if (typeof Plotly !== 'undefined' && Plotly.purge && gd._fullLayout) {
        try { Plotly.purge(gd); } catch { /* not a plot container */ }
    }
}

/** Live WebGL contexts held by Plotly graphs in `root` (the page by default). */
export function liveWebglContexts(root = typeof document !== 'undefined' ? document : null) {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    for (const gd of root.querySelectorAll('.js-plotly-plot')) {
        for (const d of reglsOf(gd)) {
            const gl = d.regl && d.regl._gl;
            if (!gl || typeof gl.isContextLost !== 'function' || !gl.isContextLost()) n++;
        }
    }
    return n;
}
