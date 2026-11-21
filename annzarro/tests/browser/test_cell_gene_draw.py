"""The Cell-Gene Plot's figure (static/js/panels/cell-gene/draw.js) drawn by the bundled Plotly (X4a, CXG-20).

Node holds the figure's content (tests/js/cell-gene-draw.test.mjs). This opens the app's page, builds figures from the
module the browser loads, and draws them with Plotly.newPlot to see what only a browser shows:

* dots and heatmap draw the trace types asked for (a module of that type, not Plotly's fallback), with no Plotly warning;
* the color bar and the size legend are in the drawing, one size legend subplot per size quantity;
* PNG and SVG export work for dots and for a heatmap, with the legend in the SVG (CXG-20);
* a one-row section on another quantity draws its own color bar.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import socket
import subprocess
import sys
import threading
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    retry = threading.Event()
    for k in range(120):
        try:
            urllib.request.urlopen(url + "/api/v1/config", timeout=1)
            break
        except OSError:
            retry.wait(min(0.5, 0.1 * (k + 1)))   # the server is not up yet: nothing else to wait on
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()
    proc.wait(10)


# A figure from the module the page loads, drawn into a div of its own; resolves to what Plotly drew and both exports.
DRAW = """async ([mode, own, dots, groups]) => {
  const D = await import('/static/js/panels/cell-gene/draw.js');
  const rows = 12;
  const color = new Float64Array(rows * groups), size = new Float64Array(rows * groups);
  for (let i = 0; i < color.length; i++) { color[i] = (i * 7) % 11; size[i] = (i * 13) % 101; }
  color[3] = NaN;
  const model = {
    mode, groups: Array.from({length: groups}, (_, g) => ({label: 'group ' + g, n: 100 + g})),
    rows: Array.from({length: rows}, (_, r) => ({label: 'Gene' + r})),
    color: {id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: color, colorscale: 'Viridis'},
    size: {id: 'pct|X', stat: 'pct_expressing', layer: 'X', detectAbove: 0, values: size}
  };
  if (own) {
    model.rows[rows - 1] = {label: 'Score', section: {index: 1, title: 'Pathway'},
      own: {color: {id: 'score|B', label: 'z-score mean · X, averaged'}, size: {id: 'm|X', label: "Mean of the genes' means"}}};
  }
  const fig = D.buildFigure(model, {bgColor: '#ffffff', gridColor: '#e6e6e6', axisColor: '#000000', textColor: '#000000'});
  const div = document.createElement('div');
  div.style.cssText = 'width:900px;height:600px;position:fixed;left:0;top:0';
  document.body.appendChild(div);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  await Plotly.newPlot(div, fig.data, fig.layout, fig.config);
  console.warn = warn;
  const out = {
    asked: [...new Set(fig.data.map(t => t.type))].sort(),
    drawn: [...new Set(div._fullData.map(t => t.type))].sort(),
    modules: div._fullData.every(t => t._module && t._module.name === t.type),
    colorbars: div.querySelectorAll('.colorbar').length,
    sizeLegends: fig.data.filter(t => t.name === 'size legend').length,
    warnings
  };
  const png = await Plotly.toImage(div, {format: 'png', width: 900, height: 600});
  out.png = [png.slice(0, 22), png.length];
  if (dots !== 'gl') {
    const svg = decodeURIComponent((await Plotly.toImage(div, {format: 'svg', width: 900, height: 600})).split(',').slice(1).join(','));
    out.svg = [svg.slice(0, 40), svg.length, svg.includes('Mean') , svg.includes('group 0')];
  }
  Plotly.purge(div); div.remove();
  return out;
}"""


@pytest.fixture(scope="module")
def page(root):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1250, "height": 900})
            problems = []
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.goto(root)
            page.wait_for_function("typeof Plotly !== 'undefined'")
            page.problems = problems
            yield page
        finally:
            browser.close()


CASES = {
    "dots": (["dots", False, "svg", 20], {"scatter"}),
    "dots-gl": (["dots", False, "gl", 1000], {"scattergl", "scatter"}),
    "heatmap": (["heatmap", False, "svg", 20], {"heatmap"}),
    "dots-own": (["dots", True, "svg", 20], {"scatter"}),
    "heatmap-own": (["heatmap", True, "svg", 20], {"heatmap"}),
}


@pytest.mark.parametrize("case", sorted(CASES))
def test_the_figure_draws_and_exports_as_png_and_svg(page, case):
    args, want = CASES[case]
    out = page.evaluate(DRAW, args)
    assert set(out["asked"]) == want, out
    assert set(out["drawn"]) == want, f"Plotly drew {out['drawn']} for {out['asked']}"
    assert out["modules"], "a trace has no module of its type"
    assert not [w for w in out["warnings"] if "nrecognized" in w or "Plotly" in w], out["warnings"]
    assert out["png"][0].startswith("data:image/png"), out["png"]
    assert out["png"][1] > 1500
    if "svg" in out:
        head, size, has_bar_title, has_group = out["svg"]
        assert "<svg" in head and size > 2000, out["svg"]
        assert has_bar_title and has_group, "the SVG carries the color bar's title and the group labels"
    expected_bars = 2 if args[1] else 1
    assert out["colorbars"] == expected_bars, out
    if args[0] == "dots":
        assert out["sizeLegends"] == (2 if args[1] else 1), out
    assert not page.problems, page.problems
