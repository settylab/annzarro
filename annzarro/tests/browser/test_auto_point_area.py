"""Automatic point size and opacity follow the plot area, not only the points.

One cell plot on the 200-cell fixture, with a steep curve (as in
test_auto_point_size.py, for opacity too; the shipped one hardly moves
below a few thousand points). Each resize of the window changes the plot's area:

1. automatic: the size and opacity become the curve's values for the new
   area, through one marker restyle (no newPlot or react) and with no
   relayout after it (restyle -> relayout -> resize would loop);
2. a size the user set stays at every area, while the automatic opacity
   still follows it;
3. an image export at its own width and height draws the values for the
   export's plot area, and leaves the plot on screen as it was.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import time
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402

PID = "cell-plot-A"
GRAPH = f'document.querySelector(\'.tile[data-tile-id="{PID}"] .js-plotly-plot\')'
# AUTO_CURVE's size and opacity constants, and steep ones in their place
STEEP = (("nHalf: 6000, exponent: 0.3", "nHalf: 10, exponent: 0.5"),
         ("nHalf: 9000, exponent: 0.18", "nHalf: 10, exponent: 0.3"))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})

            def steep(route):
                body = route.fetch().text()
                for shipped, steep_one in STEEP:
                    assert shipped in body, "AUTO_CURVE constants changed: update STEEP"
                    body = body.replace(shipped, steep_one)
                route.fulfill(body=body, content_type="text/javascript")

            page.route("**/utils/point-style.js*", steep)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"id": PID, "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "subset": None, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
            "controlState": {PID: True}, "panelConfigs": {PID: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


# Count, from here on: graphs drawn anew (newPlot, react), relayouts, and
# marker restyles: Plotly.restyle calls, and changes of the point size the
# regl scene is given (Plotly's own redraw after a resize passes the size
# the traces have; a restyle passes a new one).
SPY = """() => {
  const g = %s;
  const c = window.__azSpy = { draws: 0, relayouts: 0, restyles: 0 };
  for (const name of ['newPlot', 'react']) {
    const orig = Plotly[name];
    Plotly[name] = function (...a) { if (a[0] === g) c.draws++; return orig.apply(this, a); };
  }
  const restyle = Plotly.restyle;
  Plotly.restyle = function (...a) { if (a[0] === g) c.restyles++; return restyle.apply(this, a); };
  g.on('plotly_relayout', () => { c.relayouts++; });
  const scene = g._fullLayout._plots.xy._scene;
  const update = scene.scatter2d.update.bind(scene.scatter2d);
  let last = JSON.stringify(scene.markerOptions.map(o => o && o.size));
  scene.scatter2d.update = (opts) => {
    const out = update(opts);
    const now = JSON.stringify(scene.markerOptions.map(o => o && o.size));
    if (now !== last) { c.restyles++; last = now; }
    return out;
  };
}""" % GRAPH

STATE = """async () => {
  const g = %s;
  const { autoPointStyle } = await import('/static/js/utils/point-style.js');
  const { plotArea } = await import('/static/js/utils/view-point-style.js');
  const { pointStyleBase } = await import('/static/js/panels/plot-utilities/plot-make.js');
  const pts = g.data.filter(t => t.meta !== 'az-legend' && t.meta !== 'az-colorbar'
      && !/^focused/i.test(t.name || '') && t.x && t.x.length > 1);
  const area = plotArea(g);
  return { area, n: pts.reduce((s, t) => s + t.x.length, 0),
           sizes: [...new Set(pts.map(t => t.marker.size))],
           opacities: [...new Set(pts.map(t => t.marker.opacity))],
           want: autoPointStyle(pts.reduce((s, t) => s + t.x.length, 0), pointStyleBase(), false, area),
           spy: window.__azSpy ? { ...window.__azSpy } : null };
}""" % GRAPH


def _state(page):
    return page.evaluate(STATE)


def _resize(page, width, height, until):
    """Resize the window and wait until the plot's state passes `until`, then for it to settle."""
    before = _state(page)["area"]
    page.set_viewport_size({"width": width, "height": height})
    end = time.time() + 30
    s = None
    while time.time() < end:
        s = _state(page)
        if s["area"] != before and until(s):
            break
        page.wait_for_timeout(100)
    else:
        pytest.fail(f"no settled state at {width}x{height}: {s}")
    page.wait_for_timeout(1000)   # anything that would follow (a loop) has run by now
    return _state(page)


def _matches(s):
    return s["sizes"] == [s["want"]["size"]] and s["opacities"] == [s["want"]["opacity"]]


def test_automatic_style_follows_the_plot_area_with_one_restyle(page, server):
    page.goto(_link(server))
    page.wait_for_function(f"() => {GRAPH} && {GRAPH}._fullLayout && {GRAPH}._fullLayout._plots.xy._scene", timeout=60000)
    end = time.time() + 30
    while not _matches(_state(page)) and time.time() < end:
        page.wait_for_timeout(100)
    big = _state(page)
    assert big["n"] == 200 and _matches(big), big
    page.evaluate(SPY)

    # smaller window, smaller plot area: smaller, fainter points
    small = _resize(page, 800, 600, _matches)
    assert small["area"] < big["area"] / 2, (small, big)
    assert small["sizes"][0] < big["sizes"][0] and small["opacities"][0] < big["opacities"][0], (small, big)
    spy = small["spy"]
    assert spy["draws"] == 0, spy
    assert spy["restyles"] == 1, spy
    # the resize's own relayouts (autosize); none after the restyle
    relayouts = spy["relayouts"]
    page.wait_for_timeout(1000)
    assert _state(page)["spy"] == spy, "the restyle set off more work"

    # back: the values for the large area again, one more restyle
    again = _resize(page, 1500, 1000, _matches)
    assert again["sizes"] == big["sizes"] and again["opacities"] == big["opacities"], (again, big)
    assert again["spy"]["draws"] == 0 and again["spy"]["restyles"] == 2, again["spy"]
    assert again["spy"]["relayouts"] > relayouts

    # a size the user sets stays at any area; the opacity still follows
    box = page.locator(f"#point-size-input-{PID}")
    box.fill("3")
    box.dispatch_event("change")
    # 3 px, snapped to the step scattergl draws (3.14)
    page.wait_for_function(f"() => {GRAPH}.data.some(t => t.marker && Math.abs(t.marker.size - 3) < 0.2)")
    page.wait_for_timeout(500)
    chosen = _state(page)["sizes"]
    assert len(chosen) == 1 and abs(chosen[0] - 3) < 0.2, chosen
    for width, height in ((800, 600), (1500, 1000)):
        s = _resize(page, width, height, lambda s: s["opacities"] == [s["want"]["opacity"]])
        assert s["sizes"] == chosen, s
        assert s["spy"]["draws"] == 0, s["spy"]


EXPORT = """async ([width, height]) => {
  const g = %s;
  const { fullImage } = await import('/static/js/utils/plot-export.js');
  const { autoPointStyle } = await import('/static/js/utils/point-style.js');
  const { plotArea } = await import('/static/js/utils/view-point-style.js');
  const { pointStyleBase } = await import('/static/js/panels/plot-utilities/plot-make.js');
  const hook = g.__azExportMarkers;
  let seen = null;
  g.__azExportMarkers = async (copy) => {
    await hook(copy);
    const pts = copy.data.filter(t => t.meta !== 'az-legend' && t.meta !== 'az-colorbar'
        && !/^focused/i.test(t.name || '') && t.x && t.x.length > 1);
    seen = { area: plotArea(copy), sizes: [...new Set(pts.map(t => t.marker.size))],
             want: autoPointStyle(200, pointStyleBase(), false, plotArea(copy)) };
  };
  try { await fullImage(g, { format: 'png', width, height, scale: 1 }); } finally { g.__azExportMarkers = hook; }
  return seen;
}""" % GRAPH


def test_export_at_its_own_size_draws_the_values_for_its_area(page, server):
    page.goto(_link(server))
    page.wait_for_function(f"() => {GRAPH} && {GRAPH}._fullLayout && {GRAPH}._fullLayout._plots.xy._scene", timeout=60000)
    end = time.time() + 30
    while not _matches(_state(page)) and time.time() < end:
        page.wait_for_timeout(100)
    shown = _state(page)
    assert _matches(shown), shown
    large = page.evaluate(EXPORT, [2400, 1600])
    small = page.evaluate(EXPORT, [500, 400])
    assert large["area"] > shown["area"] > small["area"], (large, shown, small)
    assert large["sizes"] == [large["want"]["size"]], large
    assert small["sizes"] == [small["want"]["size"]], small
    assert large["sizes"][0] > small["sizes"][0], (large, small)
    after = _state(page)
    assert after["sizes"] == shown["sizes"] and after["opacities"] == shown["opacities"], (after, shown)
