/**
 * Keep the camera the user turned a 3D plot to.
 *
 * Turning a 3D plot is a GUI edit, and `uirevision` keeps it across a
 * Plotly.react: for each part of the camera the new layout leaves as it was
 * before the edit, Plotly copies the value from `gd._fullLayout`. Two gaps in
 * plotly.js 2.20 broke that, and clicking a cell to focus it (which recolours
 * a plot coloured by that cell's obsp row) snapped the camera back to the
 * default view, all of it or only the parts that had not changed since the
 * previous turn:
 *
 * - The gl3d scene keeps a reference to the full layout of the draw that last
 *   replotted it and saves the turned camera THERE on mouseup. After the
 *   graph is laid out again without replotting the scene (a resize of the
 *   window or the panel) that is no longer `gd._fullLayout`, whose camera
 *   then stays the default that uirevision restores.
 * - A turn is saved only on a mouseup over the plot's canvas. Released
 *   elsewhere (a drag that leaves the plot), it is lost at the next redraw.
 *
 * A third gap kept a zoom, which has no mouseup, from being kept at all: the
 * scene saves on every `wheel` of its canvas, but the camera it reads lags
 * the input (gl-plot3d shows the view as of 2 * 16 ms ago), so each save is
 * the camera before that step and the last step is never saved. The next
 * redraw (a focus click, a recolour) then restored the camera of an
 * earlier step, or the default view. A zoom is saved once the camera has
 * caught up, as are drags and pinches.
 */

/**
 * Make Plotly's record of a 3D graph's camera the camera on screen: point the
 * scene at the current full layout and record the camera as a GUI edit, as
 * Plotly does on mouseup. Call it before a react into a graph that may have a
 * 3D scene; it does nothing otherwise.
 * @param {HTMLElement} gd
 * @returns {boolean} whether the camera had changed since Plotly last saved it
 */
export function syncSceneCamera(gd) {
    const fl = gd && gd._fullLayout;
    const scene = fl && fl.scene && fl.scene._scene;
    if (!scene || typeof scene.getCamera !== 'function' || typeof scene.saveLayout !== 'function'
            || !gd.layout) {
        return false;
    }
    const changed = typeof scene.isCameraChanged === 'function' && scene.isCameraChanged(gd.layout);
    scene.fullLayout = fl;
    scene.saveLayout(gd.layout);
    fl.scene.camera = scene.getCamera();
    return changed;
}

/**
 * `layout` for a Plotly.react that redraws a 3D graph in place, with the
 * camera on screen. The camera kept in the panel's settings is for a new
 * graph (a link, another dataset); on a graph already drawn under the same
 * uirevision it can lag behind the screen. Leaving the camera out instead
 * resets it once Plotly has dropped its record of the user's turn, which it
 * does when a react sends any other camera.
 * @param {HTMLElement} gd
 * @param {Object} layout
 * @returns {Object}
 */
export function withShownCamera(gd, layout) {
    const fl = gd && gd._fullLayout;
    const scene = fl && fl.scene && fl.scene._scene;
    if (!layout || !layout.scene || !scene || typeof scene.getCamera !== 'function'
            || fl.uirevision === undefined || fl.uirevision !== layout.uirevision) {
        return layout;
    }
    syncSceneCamera(gd);
    return { ...layout, scene: { ...layout.scene, camera: scene.getCamera() } };
}

let _listening = false;

/** How long after the last input the camera has caught up with it (ms): the
 * camera's own lag is 2 * 16 ms, and a frame to render it. */
export const CAMERA_SETTLE_MS = 150;

/**
 * Record a turn wherever the mouse is released, not only over the plot:
 * every drawn 3D graph whose camera moved since Plotly saved it is saved
 * now, with the `plotly_relayout` Plotly would have sent (the panel keeps
 * the camera in its settings from it). Installed once.
 */
export function recordCameraOnRelease() {
    if (_listening || typeof window === 'undefined' || typeof document === 'undefined') return;
    _listening = true;
    const record = () => {
        for (const gd of document.querySelectorAll('.js-plotly-plot')) {
            if (!gd._fullLayout || !gd._fullLayout.scene || !syncSceneCamera(gd)) continue;
            if (typeof gd.emit === 'function') gd.emit('plotly_relayout', { 'scene.camera': gd._fullLayout.scene.camera });
        }
    };
    // and again once the camera has caught up with the input: a wheel zoom
    // (every step, until the last) and the end of a drag or pinch
    let timer = null;
    const recordSettled = () => {
        clearTimeout(timer);
        timer = setTimeout(record, CAMERA_SETTLE_MS);
    };
    window.addEventListener('mouseup', record, true);
    window.addEventListener('touchend', record, true);
    window.addEventListener('mouseup', recordSettled, true);
    window.addEventListener('touchend', recordSettled, true);
    window.addEventListener('wheel', recordSettled, { capture: true, passive: true });
}
