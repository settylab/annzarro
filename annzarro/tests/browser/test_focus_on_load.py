"""Opening a link with ?dataset_path raises no page error from the focus events.

While the dataset opens, main.js focuses its first cell and gene. A panel made
by the link is already listening by then, but its axes are set only once its
own dataset load has read the structure; the focus handlers read
``_settings.x.type`` and threw "Cannot read properties of undefined (reading
'type')". Opens the link with and without a #view, asserts zero page errors,
and then checks that focusing a cell and a gene still recolours the plots.

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

from annzarro.tests.server.test_focus_rows import N_OBS, N_VAR, _make_store  # noqa: E402


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = _make_store(data / "focus.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
                   os.path.abspath(__file__))))) + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, store
    proc.terminate()
    proc.wait(10)


def _share_link(root, store):
    """A cell plot coloured by a gene and by a cell, and a gene plot on a gene."""
    umap = [{"type": "obsm", "key": "X_umap", "column": "0"}, {"type": "obsm", "key": "X_umap", "column": "1"}]
    cells = {"id": "cell-plot-F", "x": umap[0], "y": umap[1], "z": None,
             "color": {"type": "obsp", "key": "dist", "column": "c0"}}
    both = {"id": "cell-plot-G", "x": umap[0], "y": umap[1], "z": None,
            "color": {"type": "layer", "key": "counts", "column": "g0"}}
    genes = {"id": "gene-plot-F", "z": None, "x": {"type": "layer", "key": "counts", "column": "g0"},
             "y": {"type": "var", "key": "mean", "column": ""}, "color": {"type": "var", "key": "mean", "column": ""}}
    ids = ["cell-plot-F", "cell-plot-G", "gene-plot-F"]
    def tile(i):
        return {"type": "tile", "id": i, "controlsVisible": True}
    inner = {"type": "split", "direction": "vertical", "panes": [{"percentage": 50}, {"percentage": 50}],
             "children": [tile("cell-plot-G"), tile("gene-plot-F")]}
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 50}, {"percentage": 50}],
                                      "children": [tile("cell-plot-F"), inner]}],
              "controlState": {i: True for i in ids},
              "panelConfigs": {"cell-plot-F": cells, "cell-plot-G": both, "gene-plot-F": genes}}
    view = {"v": 1, "layout": layout}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


VALUES = """(id) => {
  const g = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
  if (!g || !g._fullData) return null;
  const out = [];
  for (const t of g._fullData) {
    if (/Focused/.test(t.name || '')) continue;
    for (const f of ['x', 'color']) {
      const v = f === 'color' ? (t.marker && t.marker.color) : t[f];
      if (f === 'x' && id !== 'gene-plot-F') continue;
      if (Array.isArray(v) || ArrayBuffer.isView(v)) out.push(...Array.from(v));
    }
  }
  return out.sort((a, b) => a - b);
}"""


def _focus(page, field, name):
    page.click(field)
    page.fill(field, name)
    page.wait_for_function(f"() => [...document.querySelectorAll('.name-picker-option')]"
                           f".some(li => li.firstChild.textContent === '{name}')", timeout=20_000)
    page.press(field, "Enter")


def _wait_values(page, tile, expected):
    t0 = time.time()
    got = None
    while time.time() - t0 < 30:
        got = page.evaluate(VALUES, tile)
        # the plot may also draw the focused point again
        if got and set(expected) <= set(got):
            return
        time.sleep(0.25)
    pytest.fail(f"{tile} shows {got}, expected {expected}")


@pytest.mark.parametrize("with_view", [False, True], ids=["dataset_path", "dataset_path+view"])
def test_no_page_error_on_load_and_focus_still_recolours(served, with_view):
    root, store = served
    url = _share_link(root, store) if with_view else f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}"
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url)
            if not with_view:
                page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
            else:
                page.wait_for_selector('.tile[data-tile-id="gene-plot-F"] .js-plotly-plot', timeout=30000)
                page.wait_for_selector('.tile[data-tile-id="cell-plot-F"] .js-plotly-plot', timeout=30000)
            page.wait_for_function("() => document.getElementById('focused-cell').value === 'c0'"
                                   " && document.getElementById('focused-gene').value === 'g0'", timeout=30000)
            page.wait_for_timeout(1500)
            assert not errors, errors

            # the focus still moves the plots
            if with_view:
                cell, gene = 3, 2
                _focus(page, "#focused-cell", f"c{cell}")
                _wait_values(page, "cell-plot-F", sorted(cell * N_OBS + j for j in range(N_OBS)))
                _focus(page, "#focused-gene", f"g{gene}")
                _wait_values(page, "cell-plot-G", sorted(r * N_VAR + gene + 0.5 for r in range(N_OBS)))
                # a gene plot shows the genes of the focused cell
                _wait_values(page, "gene-plot-F", sorted(cell * N_VAR + k + 0.5 for k in range(N_VAR)))
                assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("panel", ["cell-plot", "gene-plot"])
def test_a_plot_made_before_the_dataset_is_current_raises_no_page_error(served, panel):
    """The Welcome tile is live while the link looks its store up (the fingerprint
    request, held here), so a plot can be made before any dataset is current:
    it listens for the focus the dataset load then sets, with no axes yet."""
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            routes, released = [], []
            page.route("**/data/fingerprint*", lambda r: r.continue_() if released else routes.append(r))
            page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
            option = f".panel-type-option[data-type='{panel}']"
            page.wait_for_selector(option, timeout=30000)
            page.click(option)
            page.wait_for_timeout(500)
            released.append(True)
            for route in routes:
                route.continue_()
            page.wait_for_selector(".tile .js-plotly-plot", timeout=30000)
            page.wait_for_function("() => document.getElementById('focused-cell').value === 'c0'"
                                   " && document.getElementById('focused-gene').value === 'g0'", timeout=30000)
            page.wait_for_timeout(1500)
            assert not errors, errors
        finally:
            browser.close()
