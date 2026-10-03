"""Other cells, or another dataset, are drawn into the panels already shown.

A part step reopened the whole view: every tile, control and table was
removed and built again, and each plot was blank from the moment its div was
emptied until Plotly.newPlot finished. Now the panels are told the subset
changed and swap their data in place: the plot is drawn into the same graph
with Plotly.react, the table gets new rows in the same DataTable.

One headless Chromium session per case, on the committed 200-cell fixture
with a 50-cell subset (four parts), a Cell Plot beside a Cell Table:

1. a part step keeps the tile, the plot div and the table (the same DOM
   nodes), never shows a blank plot, calls no Plotly.newPlot, keeps the zoom,
   the table's search, sort and page length, and the focused cell (now
   outside the part, and said so);
2. a new n crossing the large-plot threshold switches mode in the same graph;
3. a dataset change draws into the same graph without a blank frame, and
   the zoom chosen on the previous dataset is reset.

In the regular plot and in large-plot mode (above 40 points, so the 50-cell
parts are large and a 30-cell subset is not).

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
OTHER = os.path.join(DATA_DIR, "fixture_small_v3.zarr")
SPEC = {"n": 50, "seed": 1}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", params=[5_000_000, 40], ids=["regular", "large-plot"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {request.param}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
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


def _part_cells(root, part):
    spec = dict(SPEC, part=part)
    q = urllib.parse.urlencode({"dataset_path": STORE, "subset": json.dumps(spec)})
    with urllib.request.urlopen(f"{root}/api/v1/data/cells?{q}") as r:
        return json.load(r)["cells"]


def _link(root, store=STORE, subset=None, focused=None):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"cell-plot-S": {"id": "cell-plot-S", "x": x, "y": y, "z": None,
                           "color": {"type": "obs", "key": "cell_type", "column": ""}},
           "cell-table-S": {"id": "cell-table-S", "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                                                                {"type": "obs", "key": "total_counts", "column": ""}]}}
    hierarchy = [{"type": "split", "direction": "horizontal",
                  "panes": [{"percentage": 60, "controlsVisible": True}, {"percentage": 40, "controlsVisible": True}],
                  "children": [{"type": "tile", "id": "cell-plot-S", "controlsVisible": True},
                               {"type": "tile", "id": "cell-table-S", "controlsVisible": True}]}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "controlState": {"cell-plot-S": True, "cell-table-S": True}, "panelConfigs": cfg}}
    if subset is not None:
        view["subset"] = subset
    if focused:
        view["constants"] = {"focusedCell": focused}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


# Marks the nodes and starts counting blank frames and Plotly.newPlot calls
WATCH = """() => {
  const tile = (id) => document.querySelector(`.tile[data-tile-id="${id}"]`);
  window.__swap = {
    tile: tile('cell-plot-S'), plot: tile('cell-plot-S').querySelector('.js-plotly-plot'),
    tableTile: tile('cell-table-S'), table: tile('cell-table-S').querySelector('.dataTables_scrollBody table'),
    blank: 0, frames: 0, newPlot: 0
  };
  const P = window.Plotly, newPlot = P.newPlot;
  P.newPlot = function (...a) { window.__swap.newPlot++; return newPlot.apply(this, a); };
  const tick = () => {
    const g = document.querySelector('.tile[data-tile-id="cell-plot-S"] .js-plotly-plot');
    window.__swap.frames++;
    if (!(g && g._fullData && g._fullData.length && g.querySelector('.main-svg'))) window.__swap.blank++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

STATE = """() => {
  const tile = (id) => document.querySelector(`.tile[data-tile-id="${id}"]`);
  const g = tile('cell-plot-S') && tile('cell-plot-S').querySelector('.js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const body = tile('cell-table-S') && tile('cell-table-S').querySelector('.dataTables_scrollBody table');
  const dt = body && window.jQuery && jQuery.fn.dataTable.isDataTable(body) ? jQuery(body).DataTable() : null;
  const l = g && g._fullLayout;
  const mode = tile('cell-plot-S') && tile('cell-plot-S').querySelector('.mode-notice');
  const points = g && g._fullData ? g._fullData.filter(t => !/Focused/.test(t.name || '')
        && !(t.x && t.x.length === 1 && t.x[0] === null)).reduce((s, t) => s + (t.x ? t.x.length : 0), 0) : 0;
  return {
    busy: busy + (l ? 0 : 1),
    part: (document.getElementById('subset-part-input') || {}).value,
    // the dataset a plot is drawn from (its uirevision)
    dataset: g && g.layout ? g.layout.uirevision : null,
    points,
    sig: g && g.data ? g.data.reduce((a, t) => a + [...(t.x || [])].reduce((b, v) => b + (Number.isFinite(v) ? v : 0), 0), 0) : null,
    x: l && l.xaxis && l.xaxis.range ? l.xaxis.range.map(Number) : null,
    y: l && l.yaxis && l.yaxis.range ? l.yaxis.range.map(Number) : null,
    xauto: l && l.xaxis ? l.xaxis.autorange : null,
    large: !!(mode && mode.offsetParent !== null),
    rows: dt ? dt.rows().data().toArray().map(r => JSON.stringify(r)).sort().join('|') : null,
    search: dt ? dt.search() : null, order: dt ? JSON.stringify(dt.order()) : null,
    pageLen: dt ? dt.page.len() : null, firstType: dt && dt.rows().count() ? dt.cell(0, 1).data() : null,
    focused: (document.getElementById('focused-cell') || {}).value,
    outside: (document.getElementById('focused-cell-outside') || {}).textContent || null,
    same: window.__swap ? {
      tile: window.__swap.tile === tile('cell-plot-S'), plot: window.__swap.plot === g,
      tableTile: window.__swap.tableTile === tile('cell-table-S'),
      table: window.__swap.table === body
    } : null,
    blank: window.__swap ? window.__swap.blank : null, newPlot: window.__swap ? window.__swap.newPlot : null
  };
}"""


def _settle(page, pred=lambda s: True, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and pred(s):
            page.wait_for_timeout(800)
            s2 = page.evaluate(STATE)
            if not s2["busy"] and pred(s2):
                return s2
        page.wait_for_timeout(100)
    pytest.fail(f"did not settle: { {k: v for k, v in (s or {}).items() if k != 'rows'} }")


def _zoom(page, s):
    x0, x1 = s["x"]
    y0, y1 = s["y"]
    view = ([x0 + (x1 - x0) / 4, x1 - (x1 - x0) / 4], [y0 + (y1 - y0) / 4, y1 - (y1 - y0) / 4])
    page.evaluate("""([x, y]) => Plotly.relayout(
        document.querySelector('.tile[data-tile-id="cell-plot-S"] .js-plotly-plot'),
        {'xaxis.range[0]': x[0], 'xaxis.range[1]': x[1], 'yaxis.range[0]': y[0], 'yaxis.range[1]': y[1]})""",
                  [view[0], view[1]])
    page.wait_for_timeout(300)
    return view


def _close(a, b):
    return a is not None and all(abs(p - q) < 1e-6 * max(1, abs(q)) for p, q in zip(a, b))


def _set_n(page, n):
    page.click("#subset-button")
    page.wait_for_selector("#subset-n", state="visible")
    if page.is_checked("#subset-n-all"):
        page.click("#subset-n-all")
    page.fill("#subset-n", str(n))
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


def _open(browser, url, errors):
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector('.tile[data-tile-id="cell-plot-S"] .js-plotly-plot', timeout=30000)
    return page


def test_part_step_swaps_data_in_place(server):
    root, large = server
    part0, part1 = _part_cells(root, 0), _part_cells(root, 1)
    focused = next(c for c in part0 if c not in part1)
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            errors = []
            page = _open(browser, _link(root, subset=dict(SPEC, part=0), focused=focused), errors)
            s = _settle(page, lambda s: s["part"] == "1" and (large or s["rows"]) and s["focused"] == focused)
            assert s["large"] == large, s["large"]
            view = _zoom(page, s)
            # the table as the user left it: searched, sorted, ten a page
            if not large:
                page.evaluate("""(q) => jQuery(document.querySelector(
                    '.tile[data-tile-id="cell-table-S"] .dataTables_scrollBody table')).DataTable()
                    .search(String(q)).order([[2, 'desc']]).page.len(10).draw()""", s["firstType"])
                s = page.evaluate(STATE)
                table = (s["search"], s["order"], s["pageLen"])
            page.evaluate(WATCH)

            before = s
            page.click("#subset-part-next")
            s = _settle(page, lambda s: s["part"] == "2" and s["sig"] != before["sig"]
                        and (large or (s["rows"] and s["rows"] != before["rows"])))
            assert s["same"]["tile"] and s["same"]["plot"] and s["same"]["tableTile"], s["same"]
            # large-plot mode: the cell table lists no cells (their names stay on the server)
            assert large or s["same"]["table"], s["same"]
            assert s["blank"] == 0, f"the plot was blank for {s['blank']} frames"
            assert s["newPlot"] == 0, "the plot was built again"
            assert _close(s["x"], view[0]) and _close(s["y"], view[1]), (s["x"], s["y"], view)
            if not large:
                assert (s["search"], s["order"], s["pageLen"]) == table
            assert s["points"] == 50
            assert s["focused"] == focused and s["outside"] == "not in part 2 of 4", (s["focused"], s["outside"])
            assert not errors, errors
        finally:
            browser.close()


def test_a_new_n_crosses_the_large_plot_threshold_in_place(server):
    root, large = server
    if not large:
        pytest.skip("the threshold is 5M here")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            errors = []
            page = _open(browser, _link(root, subset=dict(SPEC, part=0)), errors)
            s = _settle(page, lambda s: s["part"] == "1" and s["large"])
            page.evaluate(WATCH)
            _set_n(page, 30)
            s = _settle(page, lambda s: not s["large"] and s["points"] == 30)
            assert s["same"]["plot"] and s["same"]["tile"], s["same"]
            _set_n(page, 50)
            s = _settle(page, lambda s: s["large"] and s["points"] == 50)
            assert s["same"]["plot"] and s["same"]["tile"], s["same"]
            assert s["blank"] == 0, f"the plot was blank for {s['blank']} frames"
            assert not errors, errors
        finally:
            browser.close()


def test_dataset_change_resets_the_zoom_without_a_blank_plot(server):
    root, large = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            errors = []
            page = _open(browser, _link(root), errors)
            s = _settle(page, lambda s: large or s["rows"])
            _zoom(page, s)
            page.evaluate(WATCH)
            target = page.evaluate("""(name) => [...document.querySelectorAll('#dataset-selector option')]
                .map(o => o.value).find(v => v && v.includes(name))""", os.path.basename(OTHER))
            before = page.evaluate(STATE)
            # what choosing it in the select2 dropdown sends
            page.evaluate("""(v) => jQuery('#dataset-selector').val(v)
                .trigger({type: 'select2:select', params: {data: {id: v}}})""", target)
            s = _settle(page, lambda s: s["dataset"] != before["dataset"] and "_v3" in (s["dataset"] or "")
                        and (large or s["rows"]))
            assert s["same"]["plot"] and s["same"]["tile"], s["same"]
            assert s["blank"] == 0, f"the plot was blank for {s['blank']} frames"
            assert s["newPlot"] == 0, "the plot was built again"
            assert s["xauto"] is True, f"the previous dataset's zoom was kept: {s['x']}"
            assert not errors, errors
        finally:
            browser.close()
