"""A focused or locked cell outside the cell subset, in a real browser.

The store is the one of tests/server/test_focus_rows.py: 50 cells, and every
value names its cell. The obsp ``dist`` row of dataset row r holds
r * 50 + c for cell c, and the layer ``counts`` row holds r * 7 + g + 0.5 for
gene g. The subset is {"n": 12, "seed": 4}: five parts. So a panel's values
say exactly which cell's row it shows and over which cells.

One headless Chromium session:

1. opens a link on part 1 with a cell of part 1 focused, a Cell Plot
   coloured by that cell's obsp row and a Gene Plot of its layer row;
2. steps to part 2: the focus is kept, the colour is the same cell's row cut
   to part 2's cells, and the Gene Plot is unchanged;
3. locks the colour axis, steps to part 3, unlocks it: still that cell;
4. opens a share link with that outside focus in a fresh context, with and
   without the row hint the link carries: the focus is restored.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import shutil
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

SPEC = {"n": 12, "seed": 4}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config=None):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = _make_store(data / "focus.zarr")
    port = _free_port()
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    extra = []
    if config:
        (home / "c.yaml").write_text(config)
        extra = ["--config", str(home / "c.yaml")]
    proc = subprocess.Popen([exe, "start", *extra, "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
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
    return proc, root, store


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root, store = _serve(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """Large-plot mode above 10 points: every 12-cell part is drawn large."""
    proc, root, store = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 10\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _api(root, path, **query):
    with urllib.request.urlopen(f"{root}/api/v1/data/{path}?{urllib.parse.urlencode(query)}") as r:
        return json.load(r)


def _part_rows(root, store, part):
    spec = dict(SPEC, part=part) if part else SPEC
    cells = _api(root, "cells", dataset_path=store, subset=json.dumps(spec))["cells"]
    return [int(c[1:]) for c in cells]


def _link(root, store, part, focused, cell_rows=None, colour_locked=False, colour=None):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    colour = colour or {"type": "obsp", "key": "dist", "column": focused, "locked": colour_locked}
    cells = {"id": "cell-plot-F", "title": "kNN", "x": x, "y": y, "z": None, "color": colour}
    genes = {"id": "gene-plot-F", "title": "expression", "z": None,
             "x": {"type": "layer", "key": "counts", "column": focused},
             "y": {"type": "var", "key": "mean", "column": ""},
             "color": {"type": "var", "key": "mean", "column": ""}}
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 50}, {"percentage": 50}], "children": [
                  {"type": "tile", "id": "cell-plot-F", "controlsVisible": True},
                  {"type": "tile", "id": "gene-plot-F", "controlsVisible": True}]}],
              "controlState": {"cell-plot-F": True, "gene-plot-F": True},
              "panelConfigs": {"cell-plot-F": cells, "gene-plot-F": genes}}
    constants = {"focusedCell": focused}
    if cell_rows:
        constants["cellRows"] = cell_rows
    view = {"v": 1, "subset": dict(SPEC, part=part), "constants": constants, "layout": layout}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


STATE = """() => {
  const plot = (id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
  const values = (g, field) => {
    if (!g || !g._fullData) return null;
    const out = [];
    for (const t of g._fullData) {
      if (/Focused/.test(t.name || '')) continue;
      const v = field === 'color' ? (t.marker && t.marker.color) : t[field];
      if (Array.isArray(v) || ArrayBuffer.isView(v)) out.push(...Array.from(v));
    }
    return out;
  };
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const cells = plot('cell-plot-F'), genes = plot('gene-plot-F');
  const notice = document.querySelector('.tile[data-tile-id="cell-plot-F"] .coverage-notice__headline');
  return {
    focused: (document.getElementById('focused-cell') || {}).value,
    part: (document.getElementById('subset-part-input') || {}).value,
    colour: values(cells, 'color'), geneX: values(genes, 'x'),
    notice: notice ? notice.textContent.trim() : null, busy
  };
}"""


def _wait(page, pred, timeout=60):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = page.evaluate(STATE)
        if pred(s):
            return s
        time.sleep(0.25)
    pytest.fail(f"timed out; last state {s}")


def _expect(r, shown):
    """What the panels show for cell r over the cells of a part."""
    colour = sorted(float(r * N_OBS + c) for c in shown)
    gene_x = sorted(float(r * N_VAR + g) + 0.5 for g in range(N_VAR))
    return colour, gene_x


def _shows(r, shown, part):
    colour, gene_x = _expect(r, shown)

    def pred(s):
        return (not s["busy"] and s["part"] == str(part + 1) and s["focused"] == f"c{r}"
                and s["colour"] is not None and sorted(s["colour"]) == colour
                and s["geneX"] is not None and sorted(s["geneX"]) == gene_x)
    return pred


def _step(page):
    page.click("#subset-part-next")


def test_focus_and_lock_survive_part_steps(server):
    root, store = server
    parts = [_part_rows(root, store, p) for p in range(4)]
    r = parts[1][3]                       # a cell of part 1, outside parts 2 and 3
    assert all(r not in parts[p] for p in (2, 3))
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto(_link(root, store, 1, f"c{r}"))
            _wait(page, _shows(r, parts[1], 1))

            # 2. a part step keeps the focus; its rows are read by dataset row
            requests = []
            page.on("request", lambda req: requests.append(req.url))
            _step(page)
            s = _wait(page, _shows(r, parts[2], 2))
            assert s["notice"] is None or "not in this dataset" not in s["notice"]
            assert any("dataset_rows=" in u and "/obsp/dist" in u for u in requests), requests
            assert not any("scope=dataset" in u for u in requests), \
                "the row recorded before the step was used, not a dataset-wide name search"

            # 3. lock the colour axis, step, unlock: still that cell
            page.click('.tile[data-tile-id="cell-plot-F"] button.axis-lock-btn[data-axis="color"]')
            _step(page)
            _wait(page, _shows(r, parts[3], 3))
            locked = page.evaluate("""() => { const t = document.querySelector('.tile[data-tile-id="cell-plot-F"]');
                return t.querySelector('button.axis-lock-btn[data-axis="color"] .fa-lock') !== null; }""")
            assert locked, "the lock survived the step"
            page.click('.tile[data-tile-id="cell-plot-F"] button.axis-lock-btn[data-axis="color"]')
            _wait(page, _shows(r, parts[3], 3))
        finally:
            browser.close()


@pytest.mark.parametrize("hint", [True, False])
def test_a_link_restores_an_outside_focus(server, hint):
    root, store = server
    parts = [_part_rows(root, store, p) for p in range(3)]
    r = parts[0][5]
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            context = browser.new_context(viewport={"width": 1400, "height": 900})
            page = context.new_page()
            requests = []
            page.on("request", lambda req: requests.append(req.url))
            page.goto(_link(root, store, 2, f"c{r}", cell_rows={f"c{r}": r} if hint else None))
            _wait(page, _shows(r, parts[2], 2))
            searched = any("scope=dataset" in u for u in requests)
            assert searched is (not hint), "the hint spares the dataset-wide name search"
            if hint:
                assert any("columns=_index" in u and f"dataset_rows={r}" in u for u in requests), \
                    "the hint is checked against the name"
        finally:
            browser.close()


def test_a_share_link_carries_the_row_hint(server):
    root, store = server
    parts = [_part_rows(root, store, p) for p in range(2)]
    r = parts[0][2]
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto(_link(root, store, 1, f"c{r}"))
            _wait(page, _shows(r, parts[1], 1))
            view = page.evaluate("""async () => {
                const { SessionManager } = await import('/static/js/session-manager.js');
                return SessionManager.captureView(); }""")
            assert view["constants"]["focusedCell"] == f"c{r}"
            assert view["constants"]["cellRows"] == {f"c{r}": r}
        finally:
            browser.close()


def test_pick_a_cell_the_subset_does_not_show(server):
    """The picker finds every cell, the shown ones first; an outside pick is
    focused, tagged in the menu, badged in the header and noted on the plot."""
    root, store = server
    parts = [_part_rows(root, store, p) for p in range(2)]
    r0 = parts[1][0]
    x = next(r for r in parts[0] if r not in parts[1])
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto(_link(root, store, 1, f"c{r0}"))
            _wait(page, _shows(r0, parts[1], 1))
            assert page.is_hidden("#focused-cell-outside")

            page.click("#focused-cell")
            page.fill("#focused-cell", f"c{x}")
            option = f"""() => [...document.querySelectorAll('.name-picker-option')]
                .find(li => li.firstChild && li.firstChild.textContent === 'c{x}')"""
            page.wait_for_function(f"() => {{ const li = ({option})(); return li && li.classList.contains('outside'); }}",
                                   timeout=20_000)
            tags = page.evaluate("""() => [...document.querySelectorAll('.name-picker-option')]
                .map(li => [li.firstChild.textContent, li.classList.contains('outside')])""")
            shown_first = [outside for _, outside in tags]
            assert shown_first == sorted(shown_first), f"shown cells first: {tags}"
            page.evaluate(f"""() => {{ const li = ({option})();
                li.dispatchEvent(new MouseEvent('mousedown', {{bubbles: true, cancelable: true}})); }}""")

            _wait(page, _shows(x, parts[1], 1))
            page.wait_for_function("() => !document.getElementById('focused-cell-outside').hidden", timeout=20_000)
            assert page.text_content("#focused-cell-outside") == "not in part 2 of 5"
            note = page.wait_for_selector('.tile[data-tile-id="cell-plot-F"] .focus-notice .coverage-notice__headline', timeout=20_000)
            assert note.text_content().strip() == f"Focused cell c{x} is not among the shown cells"
            label = page.evaluate("""() => document.querySelector(
                '.tile[data-tile-id="cell-plot-F"] select.axis-column-select[data-axis="color"]').options[0].text""")
            assert label == f"Focused cell c{x} (not shown)"

            # focusing a shown cell again clears all three
            page.click("#focused-cell")
            page.fill("#focused-cell", f"c{r0}")
            page.wait_for_function(f"() => [...document.querySelectorAll('.name-picker-option')]"
                                   f".some(li => li.firstChild.textContent === 'c{r0}')", timeout=20_000)
            page.press("#focused-cell", "Enter")
            _wait(page, _shows(r0, parts[1], 1))
            page.wait_for_function("() => document.getElementById('focused-cell-outside').hidden", timeout=20_000)
            assert page.query_selector('.tile[data-tile-id="cell-plot-F"] .focus-notice') is None
        finally:
            browser.close()


def test_large_plot_mode_keeps_the_focus_and_says_so(large_server):
    """No marker in large-plot mode, but the focus is kept, its rows are read and
    the plot says it is not shown."""
    root, store = large_server
    parts = [_part_rows(root, store, p) for p in range(2)]
    x = next(r for r in parts[0] if r not in parts[1])
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            # large-plot mode colours by obs or a gene, not by an obsp row
            page.goto(_link(root, store, 1, f"c{x}", colour={"type": "obs", "key": "score", "column": ""}))
            note = page.wait_for_selector(
                '.tile[data-tile-id="cell-plot-F"] .focus-notice .coverage-notice__headline', timeout=60_000)
            assert note.text_content() == f"Focused cell c{x} is not among the shown cells"
            assert page.query_selector('.tile[data-tile-id="cell-plot-F"] .mode-notice') is not None, "large mode"
            s = _wait(page, lambda s: s["focused"] == f"c{x}" and s["geneX"] is not None
                      and sorted(s["geneX"]) == _expect(x, parts[1])[1])
            assert page.text_content("#focused-cell-outside") == "not in part 2 of 5"
            marks = page.evaluate("""() => document.querySelector('.tile[data-tile-id="cell-plot-F"] .js-plotly-plot')
                ._fullData.filter(t => t.name === 'Focused Cell').length""")
            assert marks == 0, "no marker in large-plot mode"
        finally:
            browser.close()
