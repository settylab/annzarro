"""The plot sliders give fine control at the low end, and the boxes beside them edit the plot.

Point size and opacity move on log tracks and colour min/max in quantile
space (static/js/utils/slider-scales.js), so the bottom of each track is the
low range a large plot needs. One headless Chromium session opens the
committed 200-cell fixture coloured by ``total_counts`` and:

- clicks each slider at 10% of its track and checks the value lands in the
  low range (size about 0.3 px, opacity about 0.004, colour about the 10th
  percentile of the plotted values) and reaches the plot;
- types into each number box and checks the plot takes the typed value;
- opens a link with values from the old linear tracks (size 0.1, below the
  log track) and checks they are drawn unchanged.

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
PID = "cell-plot-a"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(home, *extra):
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled", *extra],
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
    return proc, root


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root = _serve(tmp_path_factory.mktemp("home"))
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """The same fixture drawn by the large-plot path (typed arrays, binned colour traces)."""
    home = tmp_path_factory.mktemp("home-large")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")
    proc, root = _serve(home, "--config", str(cfg))
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root, **extra):
    plot = {"id": PID,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "total_counts", "column": ""}, **extra}
    hierarchy = [{"type": "tile", "id": PID, "controlsVisible": True}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy, "panelConfigs": {PID: plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    store = os.path.join(DATA_DIR, "fixture_small.zarr")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


# the trace carrying the colour bar, i.e. the points
MARKER = f"""() => {{
    const gd = document.querySelector('#plot-container-{PID} .js-plotly-plot')
        || document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
    const t = gd.data.find(t => t.marker && t.marker.colorbar && Array.isArray(t.marker.color));
    return {{ size: t.marker.size, opacity: t.marker.opacity, cmin: t.marker.cmin, cmax: t.marker.cmax,
              colors: t.marker.color.filter(Number.isFinite) }};
}}"""


def _open(browser, url):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
    page.wait_for_timeout(800)
    return page, errors


def _click_track(page, sel, fraction):
    """Click a range input at `fraction` of its thumb's travel."""
    box = page.locator(sel).bounding_box()
    thumb = 16  # Bootstrap's form-range thumb; the thumb centre travels width - thumb
    x = box["x"] + thumb / 2 + fraction * (box["width"] - thumb)
    page.mouse.click(x, box["y"] + box["height"] / 2)
    page.wait_for_timeout(400)


def _marker(page):
    page.wait_for_timeout(300)
    return page.evaluate(MARKER)


def _type(page, sel, value):
    page.fill(sel, str(value))
    page.locator(sel).dispatch_event("change")
    page.wait_for_timeout(500)


def test_sliders_low_end_and_number_boxes(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server))

            # --- size: 10% of the log track is about 0.3 px, not 2 px
            _click_track(page, f"#point-size-{PID}", 0.10)
            size = float(page.input_value(f"#point-size-input-{PID}"))
            assert size == 0.392, size                     # the smallest size scattergl draws
            assert _marker(page)["size"] == pytest.approx(size)

            # --- opacity: 10% of the log track is about 0.004, not 0.1
            _click_track(page, f"#point-opacity-{PID}", 0.10)
            opacity = float(page.input_value(f"#point-opacity-input-{PID}"))
            assert 0.002 <= opacity <= 0.006, opacity
            assert _marker(page)["opacity"] == pytest.approx(opacity)

            # --- opacity 1.0 is reachable exactly (the right end of the track)
            _click_track(page, f"#point-opacity-{PID}", 1.0)
            page.locator(f"#point-opacity-{PID}").press("End")
            page.wait_for_timeout(400)
            assert page.input_value(f"#point-opacity-input-{PID}") == "1"
            assert _marker(page)["opacity"] == 1

            # --- colour: 10% of the track is the 10th percentile of the values
            colors = sorted(_marker(page)["colors"])
            n = len(colors)
            # half way is the median: on this column a linear track gives 5026,
            # below the 46th percentile
            _click_track(page, f"#color-max-slider-{PID}", 0.5)
            value = float(page.input_value(f"#color-max-{PID}"))
            assert colors[int(0.46 * (n - 1))] <= value <= colors[int(0.54 * (n - 1))], value
            for which in ("max", "min"):
                _click_track(page, f"#color-{which}-slider-{PID}", 0.10)
                value = float(page.input_value(f"#color-{which}-{PID}"))
                lo, hi = colors[int(0.06 * (n - 1))], colors[int(0.14 * (n - 1))]
                assert lo <= value <= hi, (which, value, lo, hi)
                drawn = _marker(page)["c" + which]
                assert drawn == pytest.approx(value, rel=0.01), (which, drawn, value)

            # --- the number boxes edit the plot, also off the tracks' range
            _type(page, f"#point-size-input-{PID}", 1.7)
            assert _marker(page)["size"] == 1.57          # snapped: 4 steps of 100/255 px
            assert page.input_value(f"#point-size-input-{PID}") == "1.57"
            _type(page, f"#point-opacity-input-{PID}", 0.003)
            assert _marker(page)["opacity"] == 0.003
            _type(page, f"#color-max-{PID}", 20000)
            assert _marker(page)["cmax"] == 20000
            assert page.input_value(f"#color-max-slider-{PID}") == "1000"   # pinned to the end
            _type(page, f"#point-size-input-{PID}", 0.1)                     # below one step
            assert _marker(page)["size"] == 0.392
            assert page.input_value(f"#point-size-{PID}") == "0"
            assert not errors, errors
            page.close()
        finally:
            browser.close()


def test_old_linear_link_values_are_drawn_unchanged(server):
    """A link saved with the linear tracks opens with the same size, opacity and colour range."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            url = _link(server, pointSize=0.1, pointOpacity=0.37, colorMin=1000, colorMax=4321.5)
            page, errors = _open(browser, url)
            m = _marker(page)
            assert m["size"] == 0.1
            assert m["opacity"] == 0.37
            assert (m["cmin"], m["cmax"]) == (1000, 4321.5)
            assert page.input_value(f"#point-size-input-{PID}") == "0.1"
            assert page.input_value(f"#point-opacity-input-{PID}") == "0.37"
            assert "is-auto" not in page.get_attribute(f"#point-size-input-{PID}", "class")
            assert "is-auto" not in page.get_attribute(f"#point-opacity-input-{PID}", "class")
            assert page.input_value(f"#color-min-{PID}") == "1000"
            assert page.input_value(f"#color-max-{PID}") == "4322"         # shown rounded
            assert not errors, errors
            page.close()
        finally:
            browser.close()


def test_large_plot_mode_sliders(large_server):
    """Large-plot mode keeps typed arrays; its colour sliders are quantile tracks as well."""
    import zarr
    store = zarr.open(os.path.join(DATA_DIR, "fixture_small.zarr"), mode="r")
    colors = sorted(float(v) for v in store["obs"]["total_counts"][:])
    n = len(colors)
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(large_server))
            traces = """() => document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot').data""" % PID
            assert len(page.evaluate(traces)) > 2, "not drawn by the large-plot path"

            _click_track(page, f"#point-size-{PID}", 0.10)
            size = float(page.input_value(f"#point-size-input-{PID}"))
            assert size == 0.392, size
            page.wait_for_timeout(800)
            sizes = {t["marker"]["size"] for t in page.evaluate(traces) if t.get("x") and len(t["x"]) > 1}
            assert sizes == {size}, sizes

            _click_track(page, f"#color-max-slider-{PID}", 0.5)
            value = float(page.input_value(f"#color-max-{PID}"))
            assert colors[int(0.46 * (n - 1))] <= value <= colors[int(0.54 * (n - 1))], value
            page.wait_for_timeout(800)
            bar = [t for t in page.evaluate(traces) if t["marker"].get("colorbar")]
            assert bar and bar[0]["marker"]["cmax"] == pytest.approx(value, rel=0.01), bar[:1]

            # every change redraws in this mode; the next one keeps the bound just set
            _click_track(page, f"#color-min-slider-{PID}", 0.10)
            page.wait_for_timeout(800)
            assert float(page.input_value(f"#color-max-{PID}")) == value
            bar = [t for t in page.evaluate(traces) if t["marker"].get("colorbar")]
            assert bar[0]["marker"]["cmax"] == pytest.approx(value, rel=0.01)
            assert bar[0]["marker"]["cmin"] <= colors[int(0.14 * (n - 1))]
            assert not errors, errors
            page.close()
        finally:
            browser.close()


def test_automatic_point_style(server):
    """Without a size or opacity in the link both are automatic: shown, marked, and ended by a user value."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server))
            m = _marker(page)
            # 200 points: the curve is flat, today's default (base.yaml: 5 px, opaque), as the
            # size scattergl draws it: 13 steps of 100/255 px = 5.1 (5 drew the same)
            assert (m["size"], m["opacity"]) == (5.1, 1)
            size_box, opacity_box = f"#point-size-input-{PID}", f"#point-opacity-input-{PID}"
            assert page.input_value(size_box) == "5.1"
            assert "is-auto" in page.get_attribute(size_box, "class")
            assert "auto" in page.get_attribute(size_box, "title")
            assert "active" in page.get_attribute(f"#point-size-auto-{PID}", "class")
            assert "active" in page.get_attribute(f"#point-opacity-auto-{PID}", "class")

            _type(page, size_box, 2.5)
            assert _marker(page)["size"] == 2.35            # snapped to 6 steps
            assert "is-auto" not in page.get_attribute(size_box, "class")
            assert "is-auto" in page.get_attribute(opacity_box, "class"), "opacity is still automatic"
            assert "active" not in page.get_attribute(f"#point-size-auto-{PID}", "class")
            assert "active" in page.get_attribute(f"#point-opacity-auto-{PID}", "class")

            # a refresh redraws (and recomputes automatic values): the user's size stays
            page.click(f"#refresh-plot-{PID}")
            page.wait_for_timeout(1500)
            assert _marker(page)["size"] == 2.35

            # the saved layout (what links and sessions store) says which values are automatic
            cfg = page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['%s']" % PID)
            assert (cfg["pointSize"], cfg["autoPointSize"]) == (2.35, False)
            assert (cfg["pointOpacity"], cfg["autoPointOpacity"]) == (1, True)

            page.click(f"#point-size-auto-{PID}")
            page.wait_for_timeout(500)
            assert _marker(page)["size"] == 5.1
            assert "is-auto" in page.get_attribute(size_box, "class")
            assert not errors, errors
            page.close()
        finally:
            browser.close()


def _plot_pixels(page):
    """The plot at fixed axes, as an image array (the axes do not follow a marker change)."""
    import io
    import numpy as np
    from PIL import Image
    page.evaluate("""() => Plotly.relayout(document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot'),
                     {'xaxis.range': [-3, 3], 'yaxis.range': [-3, 3]})""" % PID)
    page.wait_for_timeout(800)
    png = page.locator(f'.tile[data-tile-id="{PID}"] .js-plotly-plot').screenshot()
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(int)


@pytest.mark.parametrize("mode", ["regular", "large"])
@pytest.mark.parametrize("size,opacity", [(0.5, 0.3), (1, 0.6), (2, 1), (6, 0.2)])
def test_marker_change_draws_like_a_fresh_load(request, mode, size, opacity):
    """2D plots (both modes) set size/opacity in the regl scene, not by Plotly.restyle (a restyle reruns
    calc for every trace: V8 out of memory at 95.6M, heap nearly doubled at 5M). It must draw what a fresh
    load at those values draws (per-point colours here; the focused-cell highlight in the regular mode)."""
    server = request.getfixturevalue("server" if mode == "regular" else "large_server")
    colour = {"color": {"type": "obs", "key": "total_counts", "column": ""}}
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ref_page, errors = _open(browser, _link(server, pointSize=size, pointOpacity=opacity, **colour))
            ref = _plot_pixels(ref_page)
            ref_page.close()

            page, errors2 = _open(browser, _link(server, **colour))
            page.evaluate("""() => { window.__restyles = 0; document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot')
                             .on('plotly_restyle', () => window.__restyles++); }""" % PID)
            _type(page, f"#point-size-input-{PID}", size)
            _type(page, f"#point-opacity-input-{PID}", opacity)
            state = page.evaluate("""() => { const gd = document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot');
                const pts = gd.data.filter(t => t.x && t.x.length > 1);
                return { restyles: window.__restyles, sizes: [...new Set(pts.map(t => t.marker.size))],
                         scene: [...new Set(gd._fullLayout._plots.xy._scene.markerOptions
                                 .filter((o, i) => o && pts.includes(gd.data[i])).map(o => o.size))] }; }""" % PID)
            assert state["restyles"] == 0, "a size/opacity change must not restyle"
            assert len(state["sizes"]) == 1 and state["sizes"] == state["scene"], state
            # the box shows the size scattergl draws: whole steps of 100/255 px
            shown = float(page.input_value(f"#point-size-input-{PID}"))
            assert round(255 * shown / 100) == max(1, round(255 * size / 100)), shown
            assert state["sizes"][0] == shown
            got = _plot_pixels(page)
            assert got.shape == ref.shape
            differ = int((abs(got - ref).max(axis=2) > 8).sum())
            assert differ <= 0.001 * got.shape[0] * got.shape[1], f"{differ} pixels differ from a fresh load"
            assert not errors and not errors2, errors + errors2
            page.close()
        finally:
            browser.close()


def test_hover_finds_the_point_after_a_size_change(server):
    """Hover reads calcdata positions, which the direct regl update leaves alone: after a size change
    the hover label is still the point under the cursor."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _open(browser, _link(server, highlightFocusedCell=False))
            _type(page, f"#point-size-input-{PID}", 6)
            _type(page, f"#point-opacity-input-{PID}", 0.3)
            assert _marker(page)["size"] == 5.88
            # the most isolated point of the first trace, and where it is on screen
            target = page.evaluate("""() => {
                const gd = document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot');
                const t = gd._fullData.findIndex(d => d.x && d.x.length > 1);
                const xs = gd._fullData[t].x, ys = gd._fullData[t].y, xa = gd._fullLayout.xaxis, ya = gd._fullLayout.yaxis;
                const all = gd._fullData.flatMap(d => (d.x || []).map((x, i) => [xa.l2p(x), ya.l2p(d.y[i])]));
                let best = -1, gap = -1;
                xs.forEach((x, i) => { const px = xa.l2p(x), py = ya.l2p(ys[i]);
                    const d = Math.min(...all.filter(q => q[0] !== px || q[1] !== py).map(q => Math.hypot(q[0] - px, q[1] - py)));
                    if (d > gap) { gap = d; best = i; } });
                const box = gd.querySelector('.nsewdrag').getBoundingClientRect();
                window.__hover = null;
                gd.on('plotly_hover', (e) => { window.__hover = { curve: e.points[0].curveNumber, i: e.points[0].pointIndex }; });
                return { curve: t, i: best, gap, x: box.left + xa.l2p(xs[best]), y: box.top + ya.l2p(ys[best]) };
            }""" % PID)
            assert target["gap"] > 8, target
            page.mouse.move(target["x"] - 40, target["y"] - 40)
            page.mouse.move(target["x"], target["y"], steps=4)
            page.wait_for_function("() => window.__hover !== null", timeout=5000)
            hover = page.evaluate("() => window.__hover")
            assert (hover["curve"], hover["i"]) == (target["curve"], target["i"]), (hover, target)
            assert not errors, errors
            page.close()
        finally:
            browser.close()
