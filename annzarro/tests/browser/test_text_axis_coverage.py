"""A gene plot with a text column as an axis, and what its coverage says.

Reported on the 1M-cell Tahoe prefix: Ensembl IDs (a var column of strings) as
the gene plot's x axis. Plotly drew all 5,000 genes on a category axis; the
panel said "Why 5,000 of 5,000 genes are not shown: no x/y value", and listed
"var.highly_variable: not in this dataset" although nobody asked for it.

Two stores: ``with_hv.zarr`` has var.highly_variable (a gene plot opened on it
colours by it, by default); ``plain.zarr`` does not. A plot carried from the
first to the second must say nothing about highly_variable (a colour nobody
chose), and the text axis must count as shown.

Needs Playwright with Chromium; skipped otherwise, unless
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
from annzarro.tests.ui_helpers import open_dataset, wait_for_open
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GID = "gene-plot-T"
TILE = f'.tile[data-tile-id="{GID}"]'
N_GENES = 20


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path, highly_variable):
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), path)
    g = zarr.open_group(str(path), mode="r+")
    var = g["var"]
    ids = var.create_array("ensembl_id", shape=(N_GENES,), dtype=var["gene_name"].dtype)
    ids[:] = np.array([f"ENSG{i:011d}" for i in range(N_GENES)], dtype=object)
    ids.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
    mean = var.create_array("mean", shape=(N_GENES,), dtype="float64")
    mean[:] = np.linspace(0, 3, N_GENES)
    mean.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    order = ["gene_name", "ensembl_id", "mean"]
    if highly_variable:
        hv = var.create_array("highly_variable", shape=(N_GENES,), dtype="bool")
        hv[:] = np.arange(N_GENES) % 2 == 0
        hv.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
        order.append("highly_variable")
    var.attrs["column-order"] = order
    zarr.consolidate_metadata(str(path))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    _store(data / "with_hv.zarr", True)
    _store(data / "plain.zarr", False)
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, str(data)
    proc.terminate()
    proc.wait(10)


def _link(root, store, x, y, **extra):
    row = lambda col: {"type": "var", "key": col, "column": ""}
    cfg = {"id": GID, "title": "genes", "x": row(x), "y": row(y), "z": None, "pointSize": 8, "pointOpacity": 1}
    cfg.update(extra)
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": GID, "controlsVisible": True}],
        "controlState": {GID: True}, "panelConfigs": {GID: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


STRIP = """() => {
  const s = document.querySelector('%s .plot-status');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  const gd = document.querySelector('%s .js-plotly-plot');
  const drawn = gd && gd.data ? gd.data.filter(t => Array.isArray(t.x) && t.hoverinfo !== 'skip' && t.marker && t.marker.size !== 0.1).reduce((n, t) => n + t.x.length, 0) : null;
  if (!s) return {strip: false, busy, drawn};
  const pop = s.querySelector('.ps-pop');
  return {strip: true, busy, drawn, headline: s.querySelector('.ps-headline').innerText.trim(),
          text: s.innerText, popText: pop ? pop.textContent : '',
          rows: [...s.querySelectorAll('.ps-rows tr[data-kind]')].map(tr => tr.innerText)};
}""" % (TILE, TILE)


def _settle(page, timeout=60):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = page.evaluate(STRIP)
        if not s["busy"] and s["drawn"]:
            time.sleep(0.8)
            return page.evaluate(STRIP)
        time.sleep(0.2)
    pytest.fail(f"plot never drew; last state {s}")


def _open(pw, url, width=1400):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.goto(url)
    page.wait_for_selector(f"{TILE} .js-plotly-plot", timeout=60_000)
    return browser, page


def _shot(page, name):
    out = os.environ.get("ANNZARRO_SHOTS")
    if out:
        os.makedirs(out, exist_ok=True)
        page.screenshot(path=os.path.join(out, name))


def test_text_axis_counts_every_gene_as_shown(server):
    root, data = server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, os.path.join(data, "plain.zarr"), "ensembl_id", "mean",
                                        color={"type": "none", "key": "", "column": ""}))
        try:
            s = _settle(page)
            assert s["drawn"] == N_GENES, s
            assert "no x/y value" not in s["text"] and "no x value" not in s["text"], s["text"]
            # all drawn, so nothing is said to be missing: the strip is quiet or says all shown
            assert not s["strip"] or not s["rows"], s["rows"]
            if s["strip"]:
                assert "not shown" not in s["headline"].lower() or s["headline"].startswith(f"{N_GENES} of {N_GENES}"), s
            _shot(page, "text-axis.png")
        finally:
            browser.close()


def test_missing_colour_default_of_another_dataset_is_not_reported(server):
    root, data = server
    with playwright.sync_playwright() as pw:
        # no colour in the config: the plot picks highly_variable by default on with_hv
        browser, page = _open(pw, _link(root, os.path.join(data, "with_hv.zarr"), "ensembl_id", "mean"))
        try:
            s = _settle(page)
            assert s["drawn"] == N_GENES, s
            open_dataset(page, os.path.join(data, "plain.zarr"))
            wait_for_open(page, "plain.zarr", timeout=60_000)
            page.wait_for_function("() => !document.body.innerText.includes('highly_variable')", timeout=60_000)
            s = _settle(page)
            assert s["drawn"] == N_GENES, s
            assert "highly_variable" not in s["text"] + s["popText"], s["text"] + s["popText"]
            assert not s["rows"], s["rows"]
            _shot(page, "carried-default.png")
        finally:
            browser.close()


def test_colour_the_user_chose_stays_reported(server):
    root, data = server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, os.path.join(data, "plain.zarr"), "ensembl_id", "mean",
                                        color={"type": "var", "key": "highly_variable", "column": ""}))
        try:
            s = _settle(page)
            assert "highly_variable" in s["text"] + s["popText"] + "".join(s["rows"]), s
        finally:
            browser.close()
