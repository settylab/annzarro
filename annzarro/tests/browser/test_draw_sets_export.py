"""The Venn and UpSet figures draw in the bundled Plotly build and export to PNG and SVG (V2, CNT-23).

The figure comes from panels/cell-count/draw-sets.js, fed a fake SetPlot (the shape fixed for V1's model), so the
test needs no dataset and no server: a static file server over the repository, one page, Plotly drawn in Chromium.
It asserts that every trace Plotly drew is of the type requested (no fallback), that the console holds no Plotly
warning or error, and that the SVG carries the circles, the region counts and the names.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import functools
import http.server
import json
import os
import threading

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))

PAGE = """<!doctype html><meta charset="utf-8"><body><div id="plot" style="width:900px;height:600px"></div>
<script src="/static/vendor/js/plotly-2.35.3-annzarro.min.js"></script>"""

BUILD = """async ({ mode, k, themeName, width }) => {
  const { buildFigure } = await import('/static/js/panels/cell-count/draw-sets.js');
  const { PLOT_PALETTES } = await import('/static/js/utils/plot-theme.js');
  const names = ['in Table 1', 'cell_type is T cell, NK', 'Cd3e > 0.5 (logged_counts)'];
  const regions = [];
  for (let code = 1; code < (1 << k); code++) {
    const key = new Uint8Array(k); let degree = 0;
    for (let s = 0; s < k; s++) if (code & (1 << s)) { key[s] = 1; degree++; }
    regions.push({ key, degree, count: 1000 + 111 * code, share: (1000 + 111 * code) / 20000, color: null });
  }
  const sets = Array.from({ length: k }, (_, i) => ({ index: i, letter: 'ABCDEFGHIJKLMNOP'[i], name: names[i] || 'set ' + i,
    size: regions.filter(r => r.key[i]).reduce((a, r) => a + r.count, 0), noValue: 0, state: 'ok' }));
  const shown = regions.map((_, i) => i).sort((a, b) => regions[b].count - regions[a].count).slice(0, mode === 'upset' ? 5 : regions.length);
  const plot = { mode, universe: 20000, inNone: 4321, sets, regions, shown,
    hidden: { regions: regions.length - shown.length, cells: 900, share: 0.045 }, options: mode === 'upset' ? { sort: 'size', top: 5, minSize: 0 } : null, color: null };
  const fig = buildFigure(plot, PLOT_PALETTES[themeName], { width });
  const gd = document.getElementById('plot');
  window.__messages = [];
  const keep = (m) => (...a) => window.__messages.push(m + ': ' + a.join(' '));
  console.warn = keep('warn'); console.error = keep('error');
  await Plotly.newPlot(gd, fig.data, fig.layout, fig.config);
  const png = await Plotly.toImage(gd, { format: 'png', width: 900, height: 600 });
  const svg = await Plotly.toImage(gd, { format: 'svg', width: 900, height: 600 });
  return { types: gd._fullData.map(t => t.type), requested: fig.data.map(t => t.type), png: png.slice(0, 22), svg: decodeURIComponent(svg.split(',').slice(1).join(',')), messages: window.__messages };
}"""


@pytest.fixture(scope="module")
def root():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(REPO))
    handler.log_message = lambda *a, **k: None

    class Quiet(http.server.ThreadingHTTPServer):
        daemon_threads = True

    srv = Quiet(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _draw(browser, root, **args):
    page = browser.new_page()
    try:
        page.route("**/blank.html", lambda route: route.fulfill(body=PAGE, content_type="text/html"))
        page.goto(root + "/blank.html")
        page.wait_for_function("typeof Plotly !== 'undefined'")
        return page.evaluate(BUILD, args)
    finally:
        page.close()


CASES = [("venn", 2), ("venn", 3), ("upset", 3), ("upset", 5)]


@pytest.mark.parametrize("mode,k", CASES)
@pytest.mark.parametrize("theme_name", ["light", "dark"])
def test_figure_draws_and_exports(browser, root, mode, k, theme_name):
    out = _draw(browser, root, mode=mode, k=k, themeName=theme_name, width=900)
    assert out["types"] == out["requested"], "a trace type missing from the bundle falls back or draws nothing"
    assert out["messages"] == [], json.dumps(out["messages"])
    assert out["png"].startswith("data:image/png"), out["png"]
    svg = out["svg"]
    assert "<svg" in svg
    if mode == "venn":
        assert svg.count("<path") >= k, "the circles"
        assert "4,321 cells in no set" in svg
        assert "1,111" in svg or "1,222" in svg
    else:
        assert "in Table 1" in svg and "cell_type is T cell, NK" in svg
        assert "bars not shown" in svg


def test_narrow_upset_exports(browser, root):
    out = _draw(browser, root, mode="upset", k=3, themeName="light", width=360)
    assert out["messages"] == [], json.dumps(out["messages"])
    assert "<svg" in out["svg"] and "Cells in set" in out["svg"]
