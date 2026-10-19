"""A 3D camera the user turned stays where they turned it.

Clicking a cell to focus it in a 3D Cell Plot coloured by that cell's obsp
row snapped the camera back to the default view (all of it, or only the
parts that had not changed since the previous turn). plotly.js 2.20's gl3d
scene saves a turned camera into the full layout of the draw that last
replotted it; once the graph had been laid out again (a resize) that was no
longer `gd._fullLayout`, which kept the default, and the next Plotly.react
(the recolour the click causes) restored that default through uirevision.

The window is resized once, then the camera is turned the way Plotly
records a mouse turn (the scene's camera moves, then `mouseup` on its
canvas) and by a real mouse drag; then the test clicks a point (the `plotly_click` Plotly emits
for it, handled by the app's own click handler), recolours, steps to the
next part, and turns once more releasing the mouse outside the plot. After
each the camera is the one the user left, and the focus marker sits on the
focused cell. The modebar's reset still resets.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1, where a missing Playwright is an error.
"""
import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.server.rich_store import make_rich_store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PLOT = '.tile[data-tile-id="cell-plot-C"] .js-plotly-plot'


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    store = make_rich_store(data / "rich.zarr")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store):
    plot = {"id": "cell-plot-C",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "z": {"type": "obs", "key": "total_counts", "column": ""},
            # follows the focused cell: a click recolours the plot
            "color": {"type": "obsp", "key": "conn", "column": "cell_0000"}}
    view = {"v": 1, "subset": {"n": 50, "seed": 1}, "constants": {"focusedCell": "cell_0000"},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-C", "controlsVisible": True}],
                       "controlState": {"cell-plot-C": True}, "panelConfigs": {"cell-plot-C": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


STATE = """() => {
  const g = document.querySelector('%s');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const sc = g && g._fullLayout && g._fullLayout.scene && g._fullLayout.scene._scene;
  if (!sc || !g.data || !g.data.length) return {busy: 1};
  const mark = g.data.find(t => t.name === 'Focused Cell');
  return {busy, camera: sc.getCamera(),
          part: (document.getElementById('subset-part-input') || {}).value,
          focused: document.getElementById('focused-cell').value,
          colour: JSON.stringify(g.data.map(t => t.name || '')),
          mark: mark ? [mark.x[0], mark.y[0], mark.z[0]] : null};
}""" % PLOT


def _settle(page, pred=lambda s: True, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and pred(s):
            page.wait_for_timeout(800)
            s2 = page.evaluate(STATE)
            if not s2["busy"] and pred(s2):
                return s2
        page.wait_for_timeout(200)
    pytest.fail(f"plot did not settle: {s}")


def _turn(page, eye, center, release_on_plot=True):
    """Turn the camera as a mouse drag does: the scene's camera moves, and on
    mouseup over the plot Plotly records it (released elsewhere, it does not)."""
    page.evaluate("""([eye, center, onPlot]) => {
        const g = document.querySelector('%s');
        const sc = g._fullLayout.scene._scene;
        sc.camera.lookAt(eye, center, [0, 0, 1]);
        (onPlot ? sc.glplot.canvas : window).dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    }""" % PLOT, [eye, center, release_on_plot])
    page.wait_for_timeout(300)
    return {"eye": dict(zip("xyz", eye)), "center": dict(zip("xyz", center)), "up": {"x": 0, "y": 0, "z": 1}}


def _drag(page, dx, dy):
    """Turn the camera with a real mouse drag over the plot."""
    box = page.evaluate("""() => { const r = document.querySelector('%s').getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + Math.min(r.height, innerHeight - r.top) / 2}; }""" % PLOT)
    page.mouse.move(box["x"], box["y"])
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(box["x"] + dx * i / 10, box["y"] + dy * i / 10)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.wait_for_timeout(300)
    cam = page.evaluate(STATE)["camera"]
    return {k: cam[k] for k in ("eye", "center", "up")}


def _assert_camera(s, want, what):
    for part in ("eye", "center", "up"):
        for k in "xyz":
            assert s["camera"][part][k] == pytest.approx(want[part][k], abs=1e-4), \
                f"{what}: camera {part}.{k} is {s['camera'][part][k]}, not {want[part][k]} ({s['camera']})"


def _click_point(page, i):
    """Click point i of the first drawn trace: the plotly_click Plotly emits for it."""
    return page.evaluate("""(i) => {
        const g = document.querySelector('%s');
        const n = g.data.findIndex(t => t.name !== 'Focused Cell' && (t.customdata || t.text) && t.x.length > i);
        const t = g.data[n], name = (t.customdata || t.text)[i];
        // a click is a quick, still press: the pointer events a real one makes
        // (plot-make-helper.js trackGesture), with Plotly's 3D plotly_click
        // between the press and the release
        const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const ev = (type) => new PointerEvent(type, {pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse',
                                                      clientX: x, clientY: y, bubbles: true, cancelable: true});
        g.dispatchEvent(ev('pointerdown'));
        g.emit('plotly_click', {points: [{curveNumber: n, pointNumber: i, x: t.x[i], y: t.y[i], z: t.z[i],
                                          customdata: name}]});
        window.dispatchEvent(ev('pointerup'));
        return {name, at: [t.x[i], t.y[i], t.z[i]]};
    }""" % PLOT, i)


def test_turned_camera_survives_focus_clicks_recolour_and_parts(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root, store))
            _settle(page, lambda s: s["part"] == "1" and s["mark"] is not None)

            # the window is resized: Plotly lays the graph out again without
            # replotting the scene, which then keeps the old full layout
            page.set_viewport_size({"width": 1250, "height": 900})
            _settle(page)

            # a turn, then a small drag: the parts of the camera the drag left
            # as they were are what Plotly restored from its stale record
            first = _turn(page, [0.3, -1.9, 0.6], [0.1, 0.0, -0.1])
            cam = _drag(page, 6, 0)
            assert cam["eye"]["x"] != pytest.approx(first["eye"]["x"], abs=1e-4), "the drag did not turn the camera"

            # 1. a click focuses another cell: the plot recolours to its row
            for i in (3, 8):
                clicked = _click_point(page, i)
                s = _settle(page, lambda s: s["focused"] == clicked["name"] and s["mark"] is not None
                            and s["mark"] == pytest.approx(clicked["at"]))
                _assert_camera(s, cam, f"focus click on {clicked['name']}")

            # 2. recolour by a category
            before = s["colour"]
            page.select_option('.tile[data-tile-id="cell-plot-C"] select.axis-type-select[data-axis="color"]', "obs")
            s = _settle(page, lambda s: s["colour"] != before)
            _assert_camera(s, cam, "recolour")

            # 3. the next part
            page.click("#subset-part-next")
            s = _settle(page, lambda s: s["part"] == "2")
            _assert_camera(s, cam, "part step")

            # 4. a turn released outside the plot, which Plotly does not record
            cam = _turn(page, [-1.2, 1.1, 1.0], [0.0, 0.1, 0.0], release_on_plot=False)
            clicked = _click_point(page, 2)
            s = _settle(page, lambda s: s["focused"] == clicked["name"])
            _assert_camera(s, cam, "focus click after a turn released outside the plot")

            # the modebar's reset still resets, and stays reset
            page.hover(PLOT)
            page.click('.tile[data-tile-id="cell-plot-C"] .modebar-btn[data-title="Reset camera to default"]')
            page.wait_for_timeout(500)
            reset = page.evaluate(STATE)["camera"]
            assert reset["eye"]["x"] != pytest.approx(cam["eye"]["x"], abs=1e-3), "the reset button did nothing"
            clicked = _click_point(page, 4)
            s = _settle(page, lambda s: s["focused"] == clicked["name"])
            _assert_camera(s, reset, "focus click after a reset")
            assert not errors, errors
        finally:
            browser.close()


# --- a zoom alone (mouse wheel) is kept like a turn ---------------------------
#
# A wheel zoom has no mouseup. plotly.js 2.20 saves it in the canvas's `wheel`
# listener (scene.saveLayout + plotly_relayout), which is registered after the
# camera's own wheel listener, so the camera has moved by then; whether the
# save carries the zoomed camera is what these tests pin, with real wheel input.

SETTINGS = """() => {
  const c = window.PanelManager.getPanel('cell-plot-C').getConfig().viewport3D;
  return c ? {eye: c.eye, up: c.up, center: c.center} : null;
}"""


def _zoom(page, dy=-400, steps=3):
    """Zoom with the mouse wheel over the plot, without turning it."""
    box = page.evaluate("""() => { const r = document.querySelector('%s').getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + Math.min(r.height, innerHeight - r.top) / 2}; }""" % PLOT)
    page.mouse.move(box["x"], box["y"])
    for _ in range(steps):
        page.mouse.wheel(0, dy)
        page.wait_for_timeout(120)
    page.wait_for_timeout(500)
    cam = page.evaluate(STATE)["camera"]
    return {k: cam[k] for k in ("eye", "center", "up")}


def _assert_kept(page, want, what, settled=None):
    s = settled or page.evaluate(STATE)
    _assert_camera(s, want, what + " (on screen)")
    saved = page.evaluate(SETTINGS)
    assert saved, f"{what}: no camera in the panel settings"
    for part in ("eye", "center", "up"):
        for k in "xyz":
            assert saved[part][k] == pytest.approx(want[part][k], abs=1e-4), \
                f"{what}: settings {part}.{k} is {saved[part][k]}, not {want[part][k]}"


def _norm(c):
    return sum(c["eye"][k] ** 2 for k in "xyz") ** 0.5


def _open(p, root, store):
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(_link(root, store))
    _settle(page, lambda s: s["part"] == "1" and s["mark"] is not None)
    return browser, page, errors


def _focus_other(page, i):
    clicked = _click_point(page, i)
    return _settle(page, lambda s: s["focused"] == clicked["name"] and s["mark"] is not None
                   and s["mark"] == pytest.approx(clicked["at"]))


def test_wheel_zoom_survives_focus_recolour_refresh_and_reload(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser, page, errors = _open(p, root, store)
        try:
            start = page.evaluate(STATE)["camera"]
            zoomed = _zoom(page)
            assert _norm(zoomed) < _norm(start) - 0.1, "the wheel did not zoom"
            for part in ("center", "up"):
                for k in "xyz":
                    assert zoomed[part][k] == pytest.approx(start[part][k], abs=1e-6), "the wheel turned or panned"
            _assert_kept(page, zoomed, "after the zoom")

            # 1. a click focuses another cell: the plot recolours to its row
            for i in (3, 8):
                s = _focus_other(page, i)
                _assert_kept(page, zoomed, f"focus click {i}", s)

            # 2. recolour by a category
            before = s["colour"]
            page.select_option('.tile[data-tile-id="cell-plot-C"] select.axis-type-select[data-axis="color"]', "obs")
            s = _settle(page, lambda s: s["colour"] != before)
            _assert_kept(page, zoomed, "recolour", s)

            # 3. the refresh buttons: the dataset refresh and the plot's own redraw
            page.click("#refresh-dataset")
            page.wait_for_timeout(1500)
            s = _settle(page)
            _assert_kept(page, zoomed, "dataset refresh", s)
            page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').refreshPlot()")
            page.wait_for_timeout(500)
            s = _settle(page)
            _assert_kept(page, zoomed, "plot refresh", s)

            # 4. a reload of the tab on the bare address restores the panels from the
            # autosave (a fresh visit only lists it: ui.autosave.auto_restore reload)
            page.evaluate("() => window.dispatchEvent(new Event('beforeunload'))")
            page.wait_for_timeout(500)
            page.evaluate("() => history.replaceState(history.state, '', location.pathname)")
            page.reload()
            _settle(page, lambda s: s["mark"] is not None)
            _assert_kept(page, zoomed, "page reload")
            assert not errors, errors
        finally:
            browser.close()


def test_turn_then_wheel_zoom_survives_focus_and_recolour(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser, page, errors = _open(p, root, store)
        try:
            _drag(page, 40, 15)
            turned = page.evaluate(STATE)["camera"]
            zoomed = _zoom(page, dy=300)
            assert _norm(zoomed) > _norm(turned) + 0.1, "the wheel did not zoom out"
            assert zoomed["eye"]["x"] / _norm(zoomed) == pytest.approx(turned["eye"]["x"] / _norm(turned), abs=1e-3)
            _assert_kept(page, zoomed, "after turn and zoom")
            s = _focus_other(page, 5)
            _assert_kept(page, zoomed, "focus click after turn and zoom", s)
            before = s["colour"]
            page.select_option('.tile[data-tile-id="cell-plot-C"] select.axis-type-select[data-axis="color"]', "obs")
            s = _settle(page, lambda s: s["colour"] != before)
            _assert_kept(page, zoomed, "recolour after turn and zoom", s)
            assert not errors, errors
        finally:
            browser.close()


def test_wheel_zoom_then_drag_released_outside_survives_focus(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser, page, errors = _open(p, root, store)
        try:
            _zoom(page)
            # a drag that leaves the plot and is released outside it
            box = page.evaluate("""() => { const r = document.querySelector('%s').getBoundingClientRect();
                return {x: r.left + r.width / 2, y: r.top + Math.min(r.height, innerHeight - r.top) / 2}; }""" % PLOT)
            page.mouse.move(box["x"], box["y"])
            page.mouse.down()
            for i in range(1, 11):
                page.mouse.move(box["x"] - 30 * i, box["y"] + 5 * i)
                page.wait_for_timeout(30)
            page.mouse.move(2, 2)
            page.mouse.up()
            page.wait_for_timeout(400)
            cam = page.evaluate(STATE)["camera"]
            cam = {k: cam[k] for k in ("eye", "center", "up")}
            s = _focus_other(page, 6)
            _assert_kept(page, cam, "focus click after zoom and a drag released outside", s)
            assert not errors, errors
        finally:
            browser.close()
