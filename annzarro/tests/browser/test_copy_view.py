"""C copies the view next to the hover text; a paste over a panel applies it where the coordinates exist.

Two panels A and B of the fixture's embedding, real C and real Ctrl/Cmd+V key presses (so the browser's
own copy and paste events carry the clipboard), in Chromium and WebKit, in regular and large-plot mode:

1. zoom A, C over a point, paste over B: B's ranges equal A's; the plain text of the clipboard is the
   hover text alone (the JSON is in the custom flavour only);
2. B with the axes swapped takes the ranges by coordinate;
3. B on other coordinates: nothing changes, "No matching coordinates";
4. 3D to 3D: the camera and ranges follow (Chromium; 3D is not drawn in large-plot mode);
5. a paste over the chooser, the header or empty space: focus only, ranges unchanged;
6. a paste into a text box gives the hover text alone;
7. pasting back onto the source panel restores its view;
8. with paste-to-focus off a paste over a panel still applies the view.

Needs Playwright with Chromium and WebKit; a missing browser skips, unless ANNZARRO_REQUIRE_BROWSER=1.
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
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
MAC = sys.platform == "darwin"
PASTE = "Meta+v" if MAC else "Control+v"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(home, params, enabled=True):
    cfg = home / "c.yaml"
    # a rule that reads the first line of the hover text, as an admin would set one up
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {params}\n  paste_focus:\n    enabled: {str(enabled).lower()}\n"
                   "    rules:\n      - pattern: '^(?<cell>cell_\\d+)'\n        dataset_match: prefix\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg), "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            return proc, root
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module", params=[10**9, 10], ids=["regular", "large"])
def server(request, tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), request.param)
    yield root, request.param < 50
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def server_no_focus(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 10**9, enabled=False)
    yield root
    proc.terminate()
    proc.wait(10)


def umap(col):
    return {"type": "obsm", "key": "X_umap", "column": str(col)}


TOTAL = {"type": "obs", "key": "total_counts", "column": ""}


def _link(root, a, b):
    """Panels A and B side by side, the chooser below; a and b are (x, y[, z]) fields."""
    def cfg(pid, axes):
        c = {"id": pid, "title": pid, "x": axes[0], "y": axes[1], "z": axes[2] if len(axes) > 2 else None,
             "pointSize": 12, "pointOpacity": 1, "color": {"type": "obs", "key": "cell_type", "column": ""}}
        return c
    tiles = [{"type": "tile", "id": "cell-plot-A", "controlsVisible": False},
             {"type": "tile", "id": "cell-plot-B", "controlsVisible": False}]
    split = {"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [split, {"type": "selector"}],
                       "controlState": {"cell-plot-A": False, "cell-plot-B": False},
                       "panelConfigs": {"cell-plot-A": cfg("cell-plot-A", a), "cell-plot-B": cfg("cell-plot-B", b)}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def gd(pid):
    return f".tile[data-tile-id='{pid}'] .js-plotly-plot"


READY = """g => { const e = document.querySelector(g);
  return !!(e && e._fullLayout && (e.__largeState ? e.__largeState.index : e.data && e.data.length) && e.__azSettings); }"""

RANGES = """g => { const l = document.querySelector(g)._fullLayout;
  const s = l.scene;
  return s ? {x: s.xaxis.range.map(Number), y: s.yaxis.range.map(Number), z: s.zaxis.range.map(Number)}
           : {x: l.xaxis.range.map(Number), y: l.yaxis.range.map(Number)}; }"""

CAMERA = """g => { const s = document.querySelector(g)._fullLayout.scene;
  const c = s._scene && s._scene.getCamera ? s._scene.getCamera() : s.camera; return c.eye; }"""

CENTRE = """g => { const r = document.querySelector(g).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }"""


def _ranges(page, pid):
    return page.evaluate(RANGES, gd(pid))


def _close(a, b):
    # the copied view is rounded to 4 digits of the axis span, so within 1e-3 of it
    return all(abs(p - q) < 2e-3 * max(1, abs(b[k][1] - b[k][0])) for k in b for p, q in zip(a[k], b[k]))


def _zoom(page, pid):
    r = _ranges(page, pid)
    x0, x1 = r["x"]
    y0, y1 = r["y"]
    new = {"x": [x0 + (x1 - x0) / 4, x1 - (x1 - x0) / 5], "y": [y0 + (y1 - y0) / 5, y1 - (y1 - y0) / 4]}
    page.evaluate("""([g, v]) => Plotly.relayout(document.querySelector(g),
        {'xaxis.range': v.x, 'yaxis.range': v.y})""", [gd(pid), new])
    page.wait_for_timeout(400)
    return new


def _hover(page, pid):
    """Put the pointer on a point of the panel and wait for its label; the pointer stays there."""
    g = gd(pid)
    if page.evaluate("g => !!document.querySelector(g).__largeState", g):
        x, y = page.evaluate("""g => { const e = document.querySelector(g), idx = e.__largeState.index;
            const xa = e._fullLayout.xaxis, ya = e._fullLayout.yaxis, r = e.querySelector('.nsewdrag').getBoundingClientRect();
            const [x0, x1] = xa.range.map(Number).sort((a, b) => a - b), [y0, y1] = ya.range.map(Number).sort((a, b) => a - b);
            for (let i = 0; i < idx.X.length; i++) if (idx.X[i] > x0 && idx.X[i] < x1 && idx.Y[i] > y0 && idx.Y[i] < y1)
              return [r.left + xa.l2p(idx.X[i]), r.top + ya.l2p(idx.Y[i])];
            return [r.left + 5, r.top + 5]; }""", g)
        page.mouse.move(x - 40, y - 40)
        page.mouse.move(x + 1, y + 1, steps=4)
        page.wait_for_function("""() => { const t = document.querySelector('.large-plot-tip');
            return !!(t && t.style.display !== 'none' && t.children.length >= 3 && /^cell_\\d+$/.test(t.firstChild.textContent)); }""", timeout=15000)
        return
    box = page.evaluate("""g => { const r = document.querySelector(g + ' .nsewdrag').getBoundingClientRect();
        return [r.left, r.top, r.width, r.height]; }""", g)
    for i in range(1, 30):
        for j in range(1, 30):
            page.mouse.move(box[0] + box[2] * i / 30, box[1] + box[3] * j / 30)
            page.wait_for_timeout(6)
            if page.evaluate("g => { const e = document.querySelector(g); return !!(e._hoverdata && e._hoverdata.length); }", g):
                return
    pytest.fail("no point under the pointer")


def _hover_3d(page, pid):
    page.mouse.move(*page.evaluate(CENTRE, gd(pid)))
    page.evaluate("""g => { const e = document.querySelector(g);
        const n = e.data.findIndex(t => t.type === 'scatter3d' && t.name !== 'Focused Cell' && t.text);
        e.emit('plotly_hover', {points: [{curveNumber: n, pointNumber: 3, x: e.data[n].x[3], y: e.data[n].y[3], z: e.data[n].z[3]}]}); }""", gd(pid))


def _toast(page):
    return page.evaluate("() => [...document.querySelectorAll('.notification')].map(n => n.textContent).join(' | ')")


def _copy(page, hover):
    hover()
    page.keyboard.press("c")
    page.wait_for_function("() => /Copied hover info/.test(document.body.innerText)")


def _paste_over(page, pid=None, at=None):
    page.evaluate("() => document.querySelectorAll('.notification').forEach(n => n.remove())")
    page.mouse.move(*(at or page.evaluate(CENTRE, gd(pid))))
    page.wait_for_timeout(100)
    page.keyboard.press(PASTE)


def _wait_toast(page, pattern):
    page.wait_for_function("p => new RegExp(p).test(document.body.innerText)", arg=pattern, timeout=10000)


@pytest.fixture(params=["chromium", "webkit"])
def page(request):
    with playwright.sync_playwright() as p:
        try:
            browser = getattr(p, request.param).launch()
        except Exception as e:  # noqa: BLE001
            if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
                raise
            pytest.skip(f"{request.param} not installed: {e}")
        try:
            kw = {"permissions": ["clipboard-read", "clipboard-write"]} if request.param == "chromium" else {}
            ctx = browser.new_context(viewport={"width": 1400, "height": 900}, **kw)
            page = ctx.new_page()
            page.browser_name = request.param
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


def _open(page, root, a, b):
    page.goto(_link(root, a, b))
    for pid in ("cell-plot-A", "cell-plot-B"):
        page.wait_for_function(READY, arg=gd(pid), timeout=60000)
    page.wait_for_timeout(500)


def test_paste_over_b_gives_a_b_the_same_view(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (umap(0), umap(1)))
    view = _zoom(page, "cell-plot-A")
    assert not _close(_ranges(page, "cell-plot-B"), view)
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    _paste_over(page, "cell-plot-B")
    _wait_toast(page, r"View applied \(x, y\)")
    page.wait_for_timeout(500)
    assert _close(_ranges(page, "cell-plot-B"), view), (_ranges(page, "cell-plot-B"), view)
    # one text paste: the hover label alone, in the browser's own clipboard text
    page.focus("#focused-cell")
    page.keyboard.press(PASTE)
    text = page.input_value("#focused-cell")
    assert text.startswith("cell_") and "x: " in text and "annzarro-view" not in text and "{" not in text and "schema" not in text, text


def test_swapped_axes_map_by_coordinate(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (umap(1), umap(0)))
    view = _zoom(page, "cell-plot-A")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    _paste_over(page, "cell-plot-B")
    _wait_toast(page, r"View applied")
    page.wait_for_timeout(500)
    assert _close(_ranges(page, "cell-plot-B"), {"x": view["y"], "y": view["x"]}), _ranges(page, "cell-plot-B")


def test_other_coordinates_change_nothing_and_say_so(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (TOTAL, TOTAL))
    before = _ranges(page, "cell-plot-B")
    _zoom(page, "cell-plot-A")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    _paste_over(page, "cell-plot-B")
    _wait_toast(page, "No matching coordinates")
    page.wait_for_timeout(400)
    assert _close(_ranges(page, "cell-plot-B"), before)


def test_paste_not_over_a_panel_is_focus_only(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (umap(0), umap(1)))
    _zoom(page, "cell-plot-A")
    before = _ranges(page, "cell-plot-B")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    chooser = page.evaluate("""() => { const e = [...document.querySelectorAll('.tile-selector')].filter(e => e.offsetParent)[0];
        e.scrollIntoView(); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }""")
    spots = {"chooser": chooser, "header": [700, 4]}
    for name, at in spots.items():
        over = page.evaluate("([x, y]) => !!document.elementFromPoint(x, y).closest('.tile:not(.tile-selector)')", at)
        assert not over, name
        page.evaluate("() => { document.getElementById('focused-cell').value = ''; }")
        _paste_over(page, at=at)
        _wait_toast(page, "Focused cell cell_")
        assert not page.evaluate("() => /View (not )?applied|No matching/.test(document.body.innerText)"), name
        page.wait_for_timeout(300)
        assert _close(_ranges(page, "cell-plot-B"), before), name


def test_paste_back_on_the_source_restores_its_view(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (umap(0), umap(1)))
    view = _zoom(page, "cell-plot-A")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    page.evaluate("g => Plotly.relayout(document.querySelector(g), {'xaxis.autorange': true, 'yaxis.autorange': true})", gd("cell-plot-A"))
    page.wait_for_timeout(500)
    assert not _close(_ranges(page, "cell-plot-A"), view)
    _paste_over(page, "cell-plot-A")
    _wait_toast(page, "View applied")
    page.wait_for_timeout(500)
    assert _close(_ranges(page, "cell-plot-A"), view)


def test_3d_camera_follows(server, page):
    root, large = server
    if large:
        pytest.skip("3D is not drawn in large-plot mode")
    if page.browser_name != "chromium":
        pytest.skip("WebGL scenes are driven in Chromium")
    _open(page, root, (umap(0), umap(1), TOTAL), (umap(0), umap(1), TOTAL))
    eye = {"x": 0.3, "y": 0.4, "z": 2.5}
    page.evaluate("""([g, eye]) => Plotly.relayout(document.querySelector(g),
        {'scene.camera': {eye, up: {x: 0, y: 0, z: 1}, center: {x: 0, y: 0, z: 0}},
         'scene.xaxis.range': [-1, 1], 'scene.yaxis.range': [-2, 2], 'scene.zaxis.range': [-3, 3]})""", [gd("cell-plot-A"), eye])
    page.wait_for_timeout(500)
    _copy(page, lambda: _hover_3d(page, "cell-plot-A"))
    _paste_over(page, "cell-plot-B")
    _wait_toast(page, r"View applied \(x, y, z, camera\)")
    page.wait_for_timeout(500)
    assert _close(_ranges(page, "cell-plot-B"), {"x": [-1, 1], "y": [-2, 2], "z": [-3, 3]})
    got = page.evaluate(CAMERA, gd("cell-plot-B"))
    assert got["x"] == pytest.approx(0.3, abs=1e-3) and got["z"] == pytest.approx(2.5, abs=1e-3), got


def test_a_paste_with_paste_to_focus_off_still_applies_the_view(server_no_focus, page):
    _open(page, server_no_focus, (umap(0), umap(1)), (umap(0), umap(1)))
    view = _zoom(page, "cell-plot-A")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    _paste_over(page, "cell-plot-B")
    _wait_toast(page, "View applied")
    page.wait_for_timeout(400)
    assert _close(_ranges(page, "cell-plot-B"), view)
    assert "Focused cell" not in page.evaluate("() => document.body.innerText")


def test_the_view_reaches_another_tab(server, page):
    root, large = server
    _open(page, root, (umap(0), umap(1)), (umap(0), umap(1)))
    view = _zoom(page, "cell-plot-A")
    _copy(page, lambda: _hover(page, "cell-plot-A"))
    other = page.context.new_page()
    other.errors = []
    other.on("pageerror", lambda e: other.errors.append(str(e)))
    _open(other, root, (umap(0), umap(1)), (umap(0), umap(1)))
    assert not _close(_ranges(other, "cell-plot-B"), view)
    _paste_over(other, "cell-plot-B")
    _wait_toast(other, "View applied")
    other.wait_for_timeout(500)
    assert _close(_ranges(other, "cell-plot-B"), view)
    assert not other.errors, other.errors
