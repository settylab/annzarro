"""A zoom, a pan or a 3D camera stays where the user put it.

Recolouring sent the axes back to autorange: the Hide NaN / Hide Outliers
axis pinning ran on every colour change and, with both off, relayouted
autorange. A part step or a new seed redraws the panel from its settings,
which had lost the zoom the same way. In large-plot mode the zoom was never
recorded at all, and in 3D any relayout that was not a camera move (the
coverage annotation) reset the recorded camera.

One headless Chromium session per case opens the committed 200-cell fixture
on a 50-cell subset (four parts), zooms, and then:

1. recolours by another category and by a gene;
2. steps to the next part;
3. draws a new seed in the subset dialog;
4. opens a link that carries the zoom in the panel's settings.

After each, the axes (or the camera) are the ones the user chose. Both in
the regular plot and in large-plot mode (above 10 points).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
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

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
TILE = '.tile[data-tile-id="cell-plot-K"] '


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", params=[5_000_000, 10], ids=["regular", "large-plot"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    (home / "config.yaml").write_text(f"ui:\n  defaults:\n    large_plot_points: {request.param}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, request.param < 50
    proc.terminate()
    proc.wait(10)


def _link(root, z=False, viewport2D=None, part=0):
    plot = {"id": "cell-plot-K",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "z": {"type": "obs", "key": "total_counts", "column": ""} if z else None,
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    if viewport2D:
        plot["viewport2D"] = viewport2D
    view = {"v": 1, "subset": {"n": 50, "seed": 1, "part": part},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-K", "controlsVisible": True}],
                       "controlState": {"cell-plot-K": True}, "panelConfigs": {"cell-plot-K": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


STATE = """() => {
  const g = document.querySelector('.tile[data-tile-id="cell-plot-K"] .js-plotly-plot');
  const l = g && g._fullLayout;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  if (!l || !g.data || !g.data.length) return {busy: 1};
  return {
    busy,
    part: (document.getElementById('subset-part-input') || {}).value,
    // what the plot is coloured by: the categories, or the colour values
    colour: JSON.stringify(g.data.map(t => t.name || '').concat(
        g.data.map(t => (t.marker && Array.isArray(t.marker.color)) ? t.marker.color.length : 0))),
    // which cells are drawn: the sum of their x coordinates
    first: g.data.reduce((a, t) => a + [...(t.x || [])].reduce((b, v) => b + (Number.isFinite(v) ? v : 0), 0), 0),
    x: l.xaxis && l.xaxis.range ? l.xaxis.range.map(Number) : null,
    y: l.yaxis && l.yaxis.range ? l.yaxis.range.map(Number) : null,
    eye: l.scene && l.scene.camera ? l.scene.camera.eye : null
  };
}"""


def _settle(page, pred=lambda s: True, timeout=60):
    """Wait until the plot is drawn, nothing loads and `pred` holds; then a beat for late relayouts."""
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and pred(s):
            page.wait_for_timeout(800)
            s2 = page.evaluate(STATE)
            if not s2["busy"]:
                return s2
        page.wait_for_timeout(200)
    pytest.fail(f"plot did not settle: {s}")


def _close(a, b):
    return a is not None and b is not None and all(abs(p - q) < 1e-6 * max(1, abs(q)) for p, q in zip(a, b))


def _assert_view(s, view, what):
    assert _close(s["x"], view[0]) and _close(s["y"], view[1]), \
        f"{what}: the zoom was lost, axes {s['x']} {s['y']} instead of {view}"


def _zoom(page, s):
    """Zoom to the middle half of the axes, as a drag would (a plotly_relayout)."""
    x0, x1 = s["x"]
    y0, y1 = s["y"]
    view = ([x0 + (x1 - x0) / 4, x1 - (x1 - x0) / 4], [y0 + (y1 - y0) / 4, y1 - (y1 - y0) / 4])
    page.evaluate("""([x, y]) => Plotly.relayout(
        document.querySelector('.tile[data-tile-id="cell-plot-K"] .js-plotly-plot'),
        {'xaxis.range[0]': x[0], 'xaxis.range[1]': x[1], 'yaxis.range[0]': y[0], 'yaxis.range[1]': y[1]})""",
                  [view[0], view[1]])
    page.wait_for_timeout(300)
    return view


def _new_seed(page):
    page.click("#subset-button")
    page.wait_for_selector("#subset-seed", state="visible")
    page.fill("#subset-seed", "7")
    page.click("#subset-apply")
    # the dialog's backdrop fades out; until then it takes the clicks
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


def test_zoom_survives_recolour_parts_seed_and_link(server):
    root, large = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root))
            s = _settle(page, lambda s: s["part"] == "1")
            view = _zoom(page, s)
            _assert_view(page.evaluate(STATE), view, "zoom")

            # 1. recolour: another category, then a gene
            before = s["colour"]
            page.select_option(TILE + 'select.axis-key-select[data-axis="color"]', "leiden")
            s = _settle(page, lambda s: s["colour"] != before)
            _assert_view(s, view, "recolour by category")
            before = s["colour"]
            page.select_option(TILE + 'select.axis-type-select[data-axis="color"]', "X")
            s = _settle(page, lambda s: s["colour"] != before)
            _assert_view(s, view, "recolour by gene")

            # 2. the next part
            page.click("#subset-part-next")
            s = _settle(page, lambda s: s["part"] == "2")
            _assert_view(s, view, "part step")

            # 3. a new seed
            before = s["first"]
            _new_seed(page)
            s = _settle(page, lambda s: s["first"] != before)
            _assert_view(s, view, "new seed")

            # 4. a link that carries the zoom
            page2 = browser.new_page(viewport={"width": 1400, "height": 900})
            page2.on("pageerror", lambda e: errors.append(str(e)))
            page2.goto(_link(root, viewport2D={"xrange": view[0], "yrange": view[1]}, part=2))
            s = _settle(page2, lambda s: s["part"] == "3")
            _assert_view(s, view, "link")
            # ... and keeps it on the next step
            page2.click("#subset-part-next")
            s = _settle(page2, lambda s: s["part"] == "4")
            _assert_view(s, view, "link, then a part step")
            assert not errors, errors
        finally:
            browser.close()


def test_camera_survives_recolour_and_parts(server):
    root, large = server
    if large:
        pytest.skip("large-plot mode draws 2D only")
    eye = {"x": 0.3, "y": 0.4, "z": 2.5}
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root, z=True))
            s = _settle(page, lambda s: s["part"] == "1" and s["eye"] is not None)
            page.evaluate("""(eye) => Plotly.relayout(
                document.querySelector('.tile[data-tile-id="cell-plot-K"] .js-plotly-plot'),
                {'scene.camera': {eye, up: {x: 0, y: 0, z: 1}, center: {x: 0, y: 0, z: 0}}})""", eye)
            page.wait_for_timeout(300)

            before = s["colour"]
            page.select_option(TILE + 'select.axis-key-select[data-axis="color"]', "leiden")
            s = _settle(page, lambda s: s["colour"] != before)
            assert s["eye"] == pytest.approx(eye), f"recolour: camera {s['eye']}"

            page.click("#subset-part-next")
            s = _settle(page, lambda s: s["part"] == "2")
            assert s["eye"] == pytest.approx(eye), f"part step: camera {s['eye']}"
            assert not errors, errors
        finally:
            browser.close()
