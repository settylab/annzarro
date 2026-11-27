"""A new Gene Plot opens in 2D on the first two components; 3D is one click away.

A new Gene Plot used to pick a third varm component and open in 3D. It now draws
component 0 against 1 with 3D off; pressing 3D takes the third component as the z axis.
A saved view, panel set or link that stored a z axis still opens in 3D, and a
stored config that says nothing about z keeps its old meaning (3D). The Cell Plot
is not changed. Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1.
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

import numpy as np
import pytest
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURE = os.path.join(HERE, "..", "data", "fixture_small.zarr")
GENE = "gene-plot-A"
VARM = lambda column: {"type": "varm", "key": "X_pca", "column": column}   # noqa: E731
GD = "document.querySelector('.tile .js-plotly-plot')"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _add_varm(path):
    """X_pca on the genes: a four-column array (its columns are named 0..3)."""
    g = zarr.open_group(str(path), mode="r+")
    n = g["var"]["_index"].shape[0]
    values = np.random.default_rng(3).normal(size=(n, 4)).astype("float32")
    varm = g["varm"]
    if hasattr(varm, "create_array"):       # zarr 3
        a = varm.create_array("X_pca", shape=values.shape, chunks=(n, 4), dtype="float32")
        a[:] = values
    else:                                   # zarr 2
        a = varm.create_dataset("X_pca", data=values, chunks=(n, 4))
    a.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    zarr.consolidate_metadata(str(path))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data / "pcs.zarr")
    _add_varm(data / "pcs.zarr")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield {"root": root, "store": str(data / "pcs.zarr")}
    proc.terminate()
    proc.wait(10)


def _app(server):
    return f"{server['root']}/?dataset_path={urllib.parse.quote(server['store'], safe='/')}"


def _link(server, **cfg):
    cfg = {"id": GENE, "title": "t", "color": {"type": "none"}, **cfg}
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": GENE, "controlsVisible": True}],
            "controlState": {GENE: True}, "panelConfigs": {GENE: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return _app(server) + f"#view={enc}"


STATE = """() => {
  const gd = %s;
  if (!gd || !gd.data || !gd.data.length) return null;
  const cfg = Object.values(PanelManager.saveLayout().panelConfigs).find(c => c.id && c.id.startsWith('gene-plot')) || {};
  const types = gd.data.map(t => t.type);
  return {types, three: types.includes('scatter3d'), z: cfg.z, x: cfg.x && cfg.x.column, y: cfg.y && cfg.y.column,
          toggle: document.querySelector('.tile [id^="z-axis-toggle-"]').getAttribute('aria-pressed')};
}""" % GD


def _state(page, want3d=None, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        s = page.evaluate(STATE)
        if s and (want3d is None or s["three"] == want3d):
            page.wait_for_timeout(800)
            return page.evaluate(STATE)
        page.wait_for_timeout(200)
    pytest.fail(f"the plot never drew as wanted: {page.evaluate(STATE)}")


def _run(body):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            body(page)
            assert not errors, errors
        finally:
            browser.close()


def test_a_new_gene_plot_is_2d_on_the_first_two_components_and_3d_takes_the_third(server):
    def body(page):
        page.goto(_app(server))
        page.wait_for_selector(".panel-type-option[data-type='gene-plot']", timeout=30000)
        page.locator(".tile-selector .panel-type-option[data-type='gene-plot']").first.click()
        s = _state(page, want3d=False)
        assert s["z"] is None and s["toggle"] == "false" and s["types"] and "scatter3d" not in s["types"], s
        assert (s["x"], s["y"]) == ("0", "1"), s
        page.locator(".tile [id^='z-axis-toggle-']").click()
        s = _state(page, want3d=True)
        assert s["z"]["column"] == "2" and s["z"]["key"] == "X_pca" and s["toggle"] == "true", s
    _run(body)


def test_a_link_that_stored_a_z_axis_opens_in_3d(server):
    def body(page):
        page.goto(_link(server, x=VARM("0"), y=VARM("1"), z=VARM("2")))
        s = _state(page, want3d=True)
        assert s["z"]["column"] == "2" and s["toggle"] == "true", s
    _run(body)


def test_a_link_that_stored_no_z_keeps_its_old_meaning_3d(server):
    def body(page):
        page.goto(_link(server, x=VARM("0"), y=VARM("1")))     # no z key at all
        s = _state(page, want3d=True)
        assert s["z"]["column"] == "2", s
    _run(body)


def test_a_link_that_stored_2d_stays_2d(server):
    def body(page):
        page.goto(_link(server, x=VARM("0"), y=VARM("1"), z=None))
        s = _state(page, want3d=False)
        assert s["z"] is None and s["toggle"] == "false", s
    _run(body)
