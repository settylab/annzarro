"""A part step or a subset change reloads the panels that read the cells shown, and no others.

A gene plot's points are genes, its axes and colours come from the gene axis
or from one cell's row (read by the cell's dataset row), so other cells
change none of it. It used to be redrawn, with its requests, on every part
step, and dimmed under "Loading part 2..." while it was.

One headless Chromium session on the committed 200-cell fixture with a
50-cell subset (four parts): a cell plot, a cell table, a gene plot drawn
from the rows of two cells and coloured by the focused cell, and a gene table.
Counted from the step: every Plotly draw or restyle per tile, every DataTables draw per
tile, and the data requests each panel's own reads would make.

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
SPEC = {"n": 50, "seed": 1, "part": 0}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(url + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()
    proc.wait(10)


def _link(root):
    umap = lambda c: {"type": "obsm", "key": "X_umap", "column": c}  # noqa: E731
    row = lambda c: {"type": "layer", "key": "X", "column": c}  # noqa: E731
    cfg = {"cell-plot-S": {"id": "cell-plot-S", "x": umap("0"), "y": umap("1"), "z": None,
                           "color": {"type": "obs", "key": "cell_type", "column": ""}},
           "gene-plot-G": {"id": "gene-plot-G", "x": row("cell_0001"), "y": row("cell_0002"), "z": None,
                           "color": row("focused_cell")},
           "cell-table-T": {"id": "cell-table-T", "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                                                              {"type": "obs", "key": "total_counts", "column": ""}]},
           "gene-table-H": {"id": "gene-table-H", "columns": [{"type": "var", "key": "gene_name", "column": ""}]}}
    tile = lambda i: {"type": "tile", "id": i, "controlsVisible": True}  # noqa: E731
    row_of = lambda *ids: {"type": "split", "direction": "horizontal",  # noqa: E731
                           "panes": [{"percentage": 50, "controlsVisible": True}] * 2,
                           "children": [tile(i) for i in ids]}
    view = {"v": 1, "subset": SPEC, "layout": {
        "v": 1, "controlState": {i: True for i in cfg}, "panelConfigs": cfg,
        "hierarchy": [{"type": "split", "direction": "vertical",
                       "panes": [{"percentage": 50, "controlsVisible": True}] * 2,
                       "children": [row_of("cell-plot-S", "gene-plot-G"), row_of("cell-table-T", "gene-table-H")]}]}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


# Counts, per tile, every Plotly draw and every DataTables draw
WATCH = """() => {
  const tileOf = (el) => { const t = el && el.closest && el.closest('.tile'); return t && t.dataset.tileId; };
  window.__draws = {};
  const bump = (id) => { if (id) window.__draws[id] = (window.__draws[id] || 0) + 1; };
  for (const f of ['react', 'newPlot', 'restyle', 'update', 'relayout', 'addTraces', 'deleteTraces']) {
    const o = Plotly[f];
    Plotly[f] = function (gd, ...a) { bump(tileOf(typeof gd === 'string' ? document.getElementById(gd) : gd)); return o.call(this, gd, ...a); };
  }
  jQuery(document).on('draw.dt', (e) => bump(tileOf(e.target)));
}"""

BUSY = """() => [...document.querySelectorAll('.loading-overlay, .spinner-border, .subset-loading')]
    .filter(e => e.offsetParent !== null).length"""
DIMMED = """() => [...document.querySelectorAll('.tile')].filter(
    t => t.querySelector('.tile-content.subset-loading')).map(t => t.dataset.tileId)"""


def _quiet(page, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        if not page.evaluate(BUSY):
            page.wait_for_timeout(800)
            if not page.evaluate(BUSY):
                return
        page.wait_for_timeout(100)
    pytest.fail("the panels did not settle")


def _open(browser, root):
    page = browser.new_page(viewport={"width": 1500, "height": 1300})
    reads = []
    page.on("request", lambda r: reads.append(urllib.parse.unquote(r.url.split("/api/v1/")[-1]))
            if "/api/v1/data/" in r.url else None)
    page.goto(_link(root))
    for tile in ("cell-plot-S", "gene-plot-G"):
        page.wait_for_selector(f'.tile[data-tile-id="{tile}"] .js-plotly-plot .main-svg', timeout=30000)
    for tile in ("cell-table-T", "gene-table-H"):
        page.wait_for_selector(f'.tile[data-tile-id="{tile}"] .dataTables_scrollBody table', state="attached", timeout=30000)
    _quiet(page)
    return page, reads


def test_a_part_step_reloads_only_the_panels_that_read_the_cells(root):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, reads = _open(browser, root)
            page.evaluate(WATCH)
            reads.clear()
            page.click("#subset-part-next")
            dimmed = set()
            end = time.time() + 40
            while time.time() < end and page.input_value("#subset-part-input") != "2":
                dimmed.update(page.evaluate(DIMMED))
                page.wait_for_timeout(20)
            _quiet(page)
            draws = page.evaluate("window.__draws")
            assert draws.get("cell-plot-S", 0) >= 1 and draws.get("cell-table-T", 0) >= 1, draws
            assert draws.get("gene-plot-G", 0) == 0, f"the gene plot was redrawn: {draws}"
            assert draws.get("gene-table-H", 0) == 0, f"the gene table was redrawn: {draws}"
            assert not any(r.startswith("data/layer/X") for r in reads), f"the gene plot read its rows again: {reads}"
            assert not ({"gene-plot-G", "gene-table-H"} & dimmed), f"dimmed under Loading part: {dimmed}"
        finally:
            browser.close()


SIGNATURE = """() => {
  const g = document.querySelector('.tile[data-tile-id="gene-plot-G"] .js-plotly-plot');
  return JSON.stringify(g.data.map(t => [t.x && Array.from(t.x), t.y && Array.from(t.y),
                                          t.marker && t.marker.color && Array.from(t.marker.color)]))
    + g.layout.xaxis.title.text;
}"""


def test_a_gene_plot_coloured_by_a_cell_keeps_that_cell_through_part_steps(root):
    """The colours of the focused cell's row are the cell's, not the part's: the part step leaves them as drawn."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, reads = _open(browser, root)
            before = page.evaluate(SIGNATURE)
            for part in ("2", "3"):
                page.click("#subset-part-next")
                page.wait_for_function(f"() => document.getElementById('subset-part-input').value === '{part}'",
                                       timeout=40000)
                _quiet(page)
            assert page.evaluate(SIGNATURE) == before
            assert "cell_0006" in before
        finally:
            browser.close()
