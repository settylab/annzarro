"""Large-plot positions off the JS heap, drawn and selected as before.

Plotly's scattergl calc keeps each trace's positions as a plain Array of
doubles and its point ids as a plain Array: 20 B a point of V8 heap, and at
200M points the tab died of a V8 out-of-memory. In large-plot mode (no hover)
the calc wrapper (static/js/utils/scattergl-calc.js) moves both into typed
arrays. Checked here on the 200-cell fixture drawn in large-plot mode:

1. the calc state holds typed arrays with the same numbers as Plotly's own;
2. the drawn image is the same pixel for pixel with the wrapper on and off;
3. a box selection (Plotly's select drag; the app hides the buttons, the
   graph still supports it) selects exactly the points inside the box;
4. a regular plot (hover on) keeps Plotly's arrays.

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
PID = "cell-plot-T"
GRAPH = f"document.querySelector('.tile[data-tile-id=\"{PID}\"] .js-plotly-plot')"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", params=[10, 5_000_000], ids=["large-plot", "regular"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {request.param}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg), "--host", "127.0.0.1",
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


def _link(root, colour, highlight=True):
    # highlight off: large-plot mode's focus marker is a pixel-sized shape, after which Plotly
    # records a selection box in pixels (there is no selection tool in the plots; this test draws one)
    plot = {"id": PID, "highlightFocusedCell": highlight, "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None, "color": colour,
            "pointSize": 6, "pointOpacity": 1}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": False}],
                       "controlState": {PID: False}, "panelConfigs": {PID: plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


COLOURS = [{"type": "obs", "key": "cell_type", "column": ""}, {"type": "obs", "key": "total_counts", "column": ""}]


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            pg = browser.new_page(viewport={"width": 1200, "height": 800})
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            yield pg
            assert not errors, errors
        finally:
            browser.close()


def _drawn(page):
    end = time.time() + 60
    while time.time() < end:
        n = page.evaluate(f"""() => {{ const g = {GRAPH};
            return g && g._fullData ? g._fullData.reduce((s, t) => s + (t.x && t.x.length > 1 ? t.x.length : 0), 0) : 0; }}""")
        if n >= 150:
            time.sleep(0.5)
            return
        time.sleep(0.2)
    pytest.fail("not drawn")


# Each point trace's calc state: the array types and the positions (as numbers).
STASH = """() => { const g = %s;
  return g.calcdata.map((cd, i) => { const t = cd[0].t, sc = t._scene;
    const o = sc && sc.markerOptions[t.index];
    return {meta: g.data[i].meta || null, positions: Object.prototype.toString.call(t.positions),
            ids: t.ids ? Object.prototype.toString.call(t.ids) : null,
            sceneSame: !!o && o.positions === t.positions,
            values: Array.from(t.positions || []).map(v => (Number.isNaN(v) ? 'NaN' : v)),
            idValues: t.ids ? Array.from(t.ids) : null}; }); }""" % GRAPH

# Redraw from scratch (a new calc), with typed positions on or off.
REDRAW = """async (off) => { const S = await import('/static/js/utils/scattergl-calc.js');
  S._setTypedPositionsDisabled(off);
  const g = %s;
  try { await Plotly.newPlot(g, g.data, g.layout, g._context); } finally { S._setTypedPositionsDisabled(false); }
}""" % GRAPH


def _shot(page):
    return page.locator(f'.tile[data-tile-id="{PID}"] .js-plotly-plot').screenshot()


@pytest.mark.parametrize("colour", COLOURS, ids=["category", "numeric"])
def test_positions_are_typed_and_draw_the_same(server, page, colour):
    root, large = server
    page.goto(_link(root, colour))
    _drawn(page)
    page.evaluate(REDRAW, True)
    time.sleep(0.5)
    plain = page.evaluate(STASH)
    before = _shot(page)
    page.evaluate(REDRAW, False)
    time.sleep(0.5)
    typed = page.evaluate(STASH)
    after = _shot(page)
    assert all(p["positions"] == "[object Array]" for p in plain), plain
    if large:
        assert all(t["positions"] == "[object Float64Array]" and t["sceneSame"] for t in typed), typed
        assert all(t["ids"] in (None, "[object Uint32Array]") for t in typed), typed
    else:
        assert all(t["positions"] == "[object Array]" for t in typed), "a plot with hover keeps Plotly's arrays"
    assert [t["values"] for t in typed] == [p["values"] for p in plain], "the same numbers"
    assert [t["idValues"] for t in typed] == [p["idValues"] for p in plain]
    assert before == after, "drawn differently"


SELECT = """async () => {
  const g = %s;
  await Plotly.relayout(g, {dragmode: 'select'});
  window.__sel = null;
  g.on('plotly_selected', (e) => { window.__sel = e ? e.points.map(p => [p.curveNumber, p.pointNumber]) : []; });
  return true;
}""" % GRAPH

# the points inside the selected data box, by brute force over the point traces
# (not legend entries or the colour bar's point)
INSIDE = """([x0, x1, y0, y1]) => { const g = %s; const out = [];
  g._fullData.forEach((t, c) => { if (!t.x || t.visible !== true || t.meta === 'az-legend' || t.meta === 'az-colorbar') return;
    for (let i = 0; i < t.x.length; i++) {
      if (t.x[i] >= x0 && t.x[i] <= x1 && t.y[i] >= y0 && t.y[i] <= y1) out.push([c, i]); } });
  return out; }""" % GRAPH


def test_box_selection_selects_the_points_inside(server, page):
    root, large = server
    page.goto(_link(root, COLOURS[0], highlight=False))
    _drawn(page)
    page.evaluate(SELECT)
    box = page.locator(f'.tile[data-tile-id="{PID}"] .nsewdrag').bounding_box()
    x0, y0 = box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.3
    x1, y1 = box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.7
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=10)
    page.mouse.up()
    end = time.time() + 10
    while page.evaluate("() => window.__sel") is None and time.time() < end:
        time.sleep(0.1)
    sel = page.evaluate("() => window.__sel")
    assert sel, "nothing selected"
    rng = page.evaluate(f"""() => {{ const g = {GRAPH}; const s = g._fullLayout.selections && g._fullLayout.selections[0];
        return s ? [Math.min(s.x0, s.x1), Math.max(s.x0, s.x1), Math.min(s.y0, s.y1), Math.max(s.y0, s.y1)] : null; }}""")
    assert rng, "no selection box in the layout"
    inside = page.evaluate(INSIDE, rng)
    assert sorted(map(tuple, sel)) == sorted(map(tuple, inside))
