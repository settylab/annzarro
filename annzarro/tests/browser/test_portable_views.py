"""A saved view opens on any server that has its store, and says so when it cannot.

Several servers, each with its own data directory, stand for several
deployments:

* A: fixture_small.zarr, plus two variants of it: ``fields.zarr`` (the same
  cells and genes, without obs/leiden) and ``cells.zarr`` (other cell names,
  without obs/leiden);
* B: the same store at another path and name (datasets/moved.zarr);
* C: the same store under the same name, in another directory.

Checked here, in headless Chromium:

* a link whose store is not on the server opens its layout without data,
  every panel a placeholder that keeps its settings, with a notice naming
  the path; "Change dataset" onto the right store restores the full view;
* changed onto a store without a field the view uses, the panel marks it
  "not in this dataset", nothing else fails, and switching back restores it;
* a link (with its fingerprint) opened on a store with other cells warns
  before opening; on a store with other fields it opens and names them;
* a panel set saved on A, uploaded on C (same name, other directory) and on
  B (other path: found by fingerprint) gives the same layout, the same panel
  settings and the same exported SVG as on A.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.core import fingerprint
from annzarro.tests.zarr_compat import open_group, write_strings

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")

UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
VIEW = {
    "v": 1,
    "constants": {"focusedGene": "GENE003"},
    "layout": {"v": 1, "controlState": {},
               "hierarchy": [{"type": "split", "direction": "horizontal",
                              "panes": [{"percentage": 60}, {"percentage": 40}],
                              "children": [{"type": "tile", "id": "cell-plot-1"},
                                           {"type": "tile", "id": "cell-table-1"}]}],
               "panelConfigs": {"cell-plot-1": {"id": "cell-plot-1", **UMAP, "pointSize": 6, "autoPointSize": False,
                                                "color": {"type": "obs", "key": "leiden", "column": ""}},
                                "cell-table-1": {"id": "cell-table-1"}}},
}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(data_dir, home):
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            return proc, root
        except OSError:
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


def _drop_leiden(store):
    shutil.rmtree(store / "obs" / "leiden")
    attrs = json.loads((store / "obs" / ".zattrs").read_text())
    attrs["column-order"] = [c for c in attrs.get("column-order", []) if c != "leiden"]
    (store / "obs" / ".zattrs").write_text(json.dumps(attrs))


def _rename_cells(store):
    group = open_group(store / "obs", mode="a")
    attrs = dict(group["_index"].attrs)
    del group["_index"]
    write_strings(group, "_index", [f"other_{i:04d}" for i in range(200)]).attrs.update(attrs)


def _consolidate(store):
    docs = fingerprint._zarr_local_metadata(str(store))
    (store / ".zmetadata").write_text(json.dumps({"zarr_consolidated_format": 1, "metadata": docs}))


@pytest.fixture(scope="module")
def servers(tmp_path_factory):
    dirs = {name: tmp_path_factory.mktemp(f"data_{name}") for name in "ABC"}
    shutil.copytree(FIXTURE, dirs["A"] / "fixture_small.zarr")
    fields = dirs["A"] / "fields.zarr"
    shutil.copytree(FIXTURE, fields)
    _drop_leiden(fields)
    _consolidate(fields)
    cells = dirs["A"] / "cells.zarr"
    shutil.copytree(FIXTURE, cells)
    _drop_leiden(cells)
    _rename_cells(cells)
    _consolidate(cells)
    (dirs["B"] / "datasets").mkdir()
    shutil.copytree(FIXTURE, dirs["B"] / "datasets" / "moved.zarr")
    shutil.copytree(FIXTURE, dirs["C"] / "fixture_small.zarr")
    procs, roots = [], {}
    for name, data_dir in dirs.items():
        proc, root = _start(data_dir, tmp_path_factory.mktemp(f"home_{name}"))
        procs.append(proc)
        roots[name] = root
    yield roots, dirs
    for proc in procs:
        proc.terminate()
        proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _payload(view):
    return base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")


def _link(root, path, view):
    return f"{root}/?dataset_path={urllib.parse.quote(str(path), safe='/')}#view={_payload(view)}"


def _page(browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 950})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page, errors


def _drawn(page, tile="cell-plot-1"):
    page.wait_for_selector(f'.tile[data-tile-id="{tile}"] .js-plotly-plot', timeout=30000)
    page.wait_for_function("() => window.annzarroPlotState && JSON.parse(window.annzarroPlotState()).plots.every(p => p[1])"
                           " && !JSON.parse(window.annzarroPlotState()).loading", timeout=30000)
    page.wait_for_timeout(1500)


def _notices(page):
    return page.eval_on_selector_all(".notification", "els => els.map(e => e.innerText)")


def _plot_config(page, tile="cell-plot-1"):
    return page.evaluate(f"() => PanelManager.getPanel('{tile}').getConfig()")


def _strip_recipe(svg):
    return re.sub(r'<metadata id="annzarro-recipe">.*?</metadata>', "", svg, flags=re.S)


def _missing_marked(page, tile="cell-plot-1"):
    """The plot keeps the missing key, listed as not in this dataset."""
    return page.evaluate(f"""() => [...document.querySelectorAll('.tile[data-tile-id="{tile}"] option')]
        .some(o => /not in this dataset/.test(o.textContent) && o.value === 'leiden')""")


def _open_without_data(browser, servers):
    roots, _ = servers
    ctx, page, errors = _page(browser)
    page.goto(_link(roots["A"], "/no/such/dir/gone.zarr", VIEW))
    page.wait_for_selector(".panel-no-data", timeout=30000)
    page.wait_for_timeout(800)
    return ctx, page, errors


def test_missing_store_opens_the_layout_without_data(browser, servers):
    ctx, page, errors = _open_without_data(browser, servers)
    try:
        assert sorted(page.eval_on_selector_all(".panel-no-data", "els => els.map(e => e.dataset.panelType)")) \
            == ["cell-plot", "cell-table"]
        notices = " ".join(_notices(page))
        assert "Dataset not found" in notices and "/no/such/dir/gone.zarr" in notices
        assert page.is_visible("#btn-change-dataset")
        # the view as saved: every setting, the focus, the store it names
        captured = page.evaluate("() => sessionManager.captureView()")
        for tid, cfg in VIEW["layout"]["panelConfigs"].items():
            got = captured["layout"]["panelConfigs"][tid]
            assert {k: got.get(k) for k in cfg} == cfg
        assert captured["constants"]["focusedGene"] == "GENE003"
        assert captured["store"]["path"] == "/no/such/dir/gone.zarr"
        assert not errors, errors
    finally:
        ctx.close()


def test_change_dataset_onto_the_right_store_restores_the_view(browser, servers):
    ctx, page, errors = _open_without_data(browser, servers)
    try:
        page.click("#btn-change-dataset")
        page.wait_for_selector('#change-dataset-modal .change-dataset-item[data-path$="fixture_small.zarr"]', timeout=20000)
        page.click('#change-dataset-modal .change-dataset-item[data-path$="fixture_small.zarr"] button')
        _drawn(page)
        assert page.query_selector(".panel-no-data") is None
        assert _plot_config(page)["color"]["key"] == "leiden"
        assert not _missing_marked(page)
        assert page.input_value("#focused-gene") == "GENE003"
        assert not page.is_visible("#btn-change-dataset")
        assert not errors, errors
    finally:
        ctx.close()


def test_a_store_without_a_field_marks_it_and_switching_back_restores_it(browser, servers):
    ctx, page, errors = _open_without_data(browser, servers)
    try:
        page.click("#btn-change-dataset")
        page.wait_for_selector('#change-dataset-modal .change-dataset-item[data-path$="fields.zarr"]', timeout=20000)
        page.click('#change-dataset-modal .change-dataset-item[data-path$="fields.zarr"] button')
        _drawn(page)
        # the panel says what is missing; the view did not fail
        assert _missing_marked(page)
        assert _plot_config(page)["color"]["key"] == "leiden"
        assert page.query_selector('.tile[data-tile-id="cell-table-1"] table') is not None
        # back on the store that has it: drawn again, by leiden
        path = page.evaluate("""() => [...document.querySelectorAll('#dataset-selector option')]
            .map(o => o.value).find(v => v.endsWith('/fixture_small.zarr'))""")
        page.evaluate("""(path) => { const sel = document.getElementById('dataset-selector');
            $(sel).val(path).trigger({type: 'select2:select', params: {data: {id: path}}}); }""", path)
        page.wait_for_function("(p) => JSON.parse(window.annzarroPlotState()).loading === false"
                               " && document.getElementById('dataset-path').textContent !== ''", arg=path)
        page.wait_for_timeout(2500)
        assert _plot_config(page)["color"]["key"] == "leiden"
        assert not _missing_marked(page)
        assert not errors, errors
    finally:
        ctx.close()


def _share(page):
    page.click("#btn-share-link")
    page.wait_for_selector("#share-link-fallback:not([hidden])", timeout=15000)
    return page.input_value("#share-link-field")


def _shared_view(browser, servers):
    """A link made by this version on A: it carries the store's fingerprint."""
    roots, dirs = servers
    ctx, page, errors = _page(browser)
    try:
        page.goto(_link(roots["A"], dirs["A"] / "fixture_small.zarr", VIEW))
        _drawn(page)
        link = _share(page)
        assert not errors, errors
    finally:
        ctx.close()
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(link).query)
    assert query["dataset_path"] == ["fixture_small.zarr"], "the link names the store relative to the data directory"
    return link


def test_a_link_opened_on_other_cells_warns_first(browser, servers):
    roots, dirs = servers
    link = _shared_view(browser, servers)
    other = link.replace("dataset_path=fixture_small.zarr", "dataset_path=cells.zarr")
    ctx, page, errors = _page(browser)
    try:
        page.goto(other)
        page.wait_for_selector(".notification-ask", timeout=30000)
        text = " ".join(_notices(page))
        assert "differs from the one the view was saved on" in text and "other cells" in text
        # the layout is there meanwhile, without data
        assert page.query_selector(".panel-no-data") is not None
        page.click('.notification-ask button[data-action="open"]')
        _drawn(page)
        assert _missing_marked(page)
        assert not errors, errors
    finally:
        ctx.close()


def test_a_link_opened_on_other_fields_names_them(browser, servers):
    link = _shared_view(browser, servers)
    ctx, page, errors = _page(browser)
    try:
        page.goto(link.replace("dataset_path=fixture_small.zarr", "dataset_path=fields.zarr"))
        _drawn(page)
        text = " ".join(_notices(page))
        assert "Same cells and genes" in text and "obs/leiden is not in this store" in text
        assert page.query_selector(".notification-ask") is None
        assert not errors, errors
    finally:
        ctx.close()


def test_the_same_link_on_the_same_store_says_nothing(browser, servers):
    link = _shared_view(browser, servers)
    ctx, page, errors = _page(browser)
    try:
        page.goto(link)
        _drawn(page)
        assert _notices(page) == []
        assert not errors, errors
    finally:
        ctx.close()


TREE_JS = """() => { const l = PanelManager.saveLayout();
  const strip = n => n.type === 'split' ? {split: n.direction, panes: n.panes.map(p => Math.round(p.percentage)),
      children: n.children.map(strip)} : n.type === 'tile' ? {tile: n.id} : {other: n.type};
  return l.hierarchy.map(strip); }"""


def _state(page):
    configs = page.evaluate("""() => { const l = PanelManager.saveLayout(); const out = {};
        for (const [k, v] of Object.entries(l.panelConfigs)) { const c = {...v}; delete c.title; out[k] = c; }
        return out; }""")
    return {"tree": page.evaluate(TREE_JS), "configs": configs,
            "gene": page.input_value("#focused-gene")}


def _svg(page, tile="cell-plot-1"):
    return page.evaluate("(id) => window.annzarroExport(id, 'svg')", tile)


def _upload(page, root, file_path):
    page.goto(root + "/")
    page.wait_for_function("() => !!window.PanelManager", timeout=30000)
    page.wait_for_timeout(1000)
    page.click("#btn-load-session")
    page.wait_for_selector("#session-modal", state="visible")
    page.click("#toggle-upload-btn")
    page.set_input_files("#session-file-upload", str(file_path))
    page.click("#btn-confirm-session")
    ask = page.locator(".notification-ask button[data-action='switch']")
    try:
        ask.first.wait_for(timeout=5000)
        ask.first.click()
    except playwright.Error:
        pass


def test_a_panel_set_from_A_opens_on_B_and_C_with_the_same_view_and_svg(browser, servers, tmp_path):
    roots, dirs = servers
    ctx, page, errors = _page(browser)
    try:
        page.goto(_link(roots["A"], dirs["A"] / "fixture_small.zarr", VIEW))
        _drawn(page)
        page.click("#btn-save-session")
        page.fill("#session-name", "portable")
        page.click("#btn-confirm-session")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
        for _ in range(40):
            try:
                saved = json.loads(urllib.request.urlopen(f"{roots['A']}/api/v1/sessions/export?name=portable").read())
                break
            except urllib.error.HTTPError:
                time.sleep(0.25)
        on_a = _state(page)
        svg_a = _svg(page)
        assert not errors, errors
    finally:
        ctx.close()
    # saved relative to the data directory, the absolute path a hint only
    assert saved["dataset"] == "fixture_small.zarr"
    assert saved["datasetAbs"].endswith("fixture_small.zarr")
    assert saved["view"]["store"]["fp"]["n_obs"] == 200 and saved["view"]["store"]["fp"]["data"]
    file_path = tmp_path / "portable.json"
    file_path.write_text(json.dumps(saved))

    for name, note in (("C", None), ("B", "Opened on another path")):
        ctx, page, errors = _page(browser)
        try:
            _upload(page, roots[name], file_path)
            _drawn(page)
            assert _state(page) == on_a, name
            svg = _svg(page)
            if name == "C":
                # same name, same store: the very same file, recipe included
                assert svg == svg_a, "the SVG on C differs from A's"
            else:
                # another name: the same drawing; the recipe names the store as B has it
                assert _strip_recipe(svg) == _strip_recipe(svg_a), "the drawing on B differs from A's"
                assert '"dataset":"datasets/moved.zarr"' in svg
            text = " ".join(_notices(page))
            if note:
                assert note in text and "same cells and genes" in text, text
            assert "Dataset not found" not in text
            assert not errors, errors
        finally:
            ctx.close()


def test_an_old_absolute_link_still_opens(browser, servers):
    """A v0.4.0 link: the server's absolute path, no store record."""
    roots, dirs = servers
    ctx, page, errors = _page(browser)
    try:
        page.goto(_link(roots["C"], dirs["C"] / "fixture_small.zarr", VIEW))
        _drawn(page)
        assert _notices(page) == []
        assert _plot_config(page)["color"]["key"] == "leiden"
        assert not errors, errors
    finally:
        ctx.close()
