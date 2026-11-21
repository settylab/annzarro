"""The Cell-Gene Plot's annotations (static/js/panels/cell-gene/draw-annotations.js) drawn by the bundled Plotly (X4b).

Node holds the figure's content (tests/js/cell-gene-annotations.test.mjs). This draws a figure with every annotation on,
in dots and in a heatmap, swapped or not, to see what only a browser shows:

* Plotly draws the bands' traces (bars, lines) with no warning, one subplot per band;
* the bands stay apart: no band's box overlaps the matrix's box, and the matrix keeps a usable size;
* PNG and SVG export carry the brackets' titles, the strips, the totals' axis and the labels of the groups (CXG-20).

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


# A figure with every annotation, from the modules the page loads, drawn into a div of its own.
DRAW = """async ([mode, swap, dark]) => {
  const D = await import('/static/js/panels/cell-gene/draw.js');
  const { PLOT_PALETTES } = await import('/static/js/utils/plot-theme.js');
  const theme = dark ? PLOT_PALETTES.dark : PLOT_PALETTES.light;
  const rows = 14, groups = 8;
  const color = new Float64Array(rows * groups), size = new Float64Array(rows * groups);
  for (let i = 0; i < color.length; i++) { color[i] = (i * 7) % 11; size[i] = (i * 13) % 101; }
  const model = {
    mode, swap, pixels: {width: 900, height: 600},
    groups: Array.from({length: groups}, (_, g) => ({label: 'cell type ' + (g >> 1) + ' | ' + (g & 1 ? 'Young' : 'Old'), n: 150 + 90 * g, small: g === 7})),
    rows: Array.from({length: rows}, (_, r) => ({label: 'Gene' + r, gapBefore: r === 7 ? 1 : 0,
      section: r < 7 ? {index: 0, title: 'B cell markers', note: '2 genes not in this dataset'} : {index: 1, title: 'T cell markers'}})),
    color: {id: 'mean|X', stat: 'mean', layer: 'X', scaling: 'none', values: color, colorscale: 'Viridis'},
    size: {id: 'pct|X', stat: 'pct_expressing', layer: 'X', detectAbove: 0, values: size}
  };
  const palette = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3'];
  // a dendrogram of the groups as one block, and of each section's genes
  const merges = (n) => { const z = []; for (let i = 0; i < n - 1; i++) z.push(i === 0 ? 0 : n + i - 1, i + 1, 0.3 + i * 0.4, i + 2); return Float64Array.from(z); };
  model.annotations = {
    brackets: {titles: true},
    strips: [{title: 'cell_type', colours: Array.from({length: groups}, (_, g) => palette[g >> 1]), levels: Array.from({length: groups}, (_, g) => 'type ' + (g >> 1))},
             {title: 'age', colours: Array.from({length: groups}, (_, g) => (g & 1 ? '#fdb462' : '#80b1d3')), levels: Array.from({length: groups}, (_, g) => (g & 1 ? 'Young' : 'Old'))}],
    totals: true,
    dendrograms: {groups: [{merges: merges(groups), positions: Array.from({length: groups}, (_, g) => g)}],
                  genes: [{merges: merges(7), positions: [0, 1, 2, 3, 4, 5, 6]}, {merges: merges(7), positions: [7, 8, 9, 10, 11, 12, 13]}]}
  };
  const fig = D.buildFigure(model, theme);
  const div = document.createElement('div');
  div.style.cssText = 'width:900px;height:600px;position:fixed;left:0;top:0;z-index:99999;background:' + theme.bgColor;
  div.id = 'x4b';
  document.body.appendChild(div);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  await Plotly.newPlot(div, fig.data, fig.layout, fig.config);
  console.warn = warn;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const out = {
    asked: [...new Set(fig.data.map(t => t.type))].sort(),
    drawn: [...new Set(div._fullData.map(t => t.type))].sort(),
    modules: div._fullData.every(t => t._module && t._module.name === t.type),
    plots: Object.values(div._fullLayout._plots).map(p => box(p.plot.node())),
    main: box(div._fullLayout._plots.xy.plot.node()),
    titles: [...div.querySelectorAll('.annotation-text')].map(e => e.textContent),
    warnings
  };
  const png = await Plotly.toImage(div, {format: 'png', width: 900, height: 600});
  out.png = [png.slice(0, 22), png.length];
  const svg = decodeURIComponent((await Plotly.toImage(div, {format: 'svg', width: 900, height: 600})).split(',').slice(1).join(','));
  out.svg = [svg.length, ['B cell markers', 'T cell markers', 'Cells', 'cell type 0'].filter(s => svg.includes(s)).length, svg.includes('small')];
  out.shot = !!window.__keep;
  if (!window.__keep) { Plotly.purge(div); div.remove(); }
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


@pytest.mark.parametrize("mode,swap,dark", [("dots", False, False), ("heatmap", True, True)])
def test_every_annotation_draws_exports_and_keeps_the_bands_apart(page, mode, swap, dark):
    out = page.evaluate(DRAW, [mode, swap, dark])
    assert "bar" in out["drawn"] and "scatter" in out["drawn"], out["drawn"]
    assert set(out["asked"]) == set(out["drawn"]), out
    assert out["modules"], "a trace has no module of its type"
    assert not [w for w in out["warnings"] if "nrecognized" in w or "Plotly" in w], out["warnings"]
    assert out["png"][0].startswith("data:image/png") and out["png"][1] > 1500, out["png"]
    size, found, small = out["svg"]
    assert size > 3000 and found == 4 and small, f"the SVG carries titles, the totals axis and the labels: {out['svg']}"
    left, top, right, bottom = out["main"]
    assert right - left > 200 and bottom - top > 150, f"the matrix keeps its room: {out['main']}"
    # no band overlaps the matrix: a band is another subplot, and its box and the matrix's share at most an edge
    for box in out["plots"]:
        if box == out["main"]:
            continue
        w = min(box[2], right) - max(box[0], left)
        h = min(box[3], bottom) - max(box[1], top)
        assert not (w > 1.5 and h > 1.5), f"a band overlaps the matrix: {box} over {out['main']}"
    assert len(out["plots"]) >= 6, out["plots"]
    assert not page.problems, page.problems
