"""Values written to a served store appear after a Refresh, panel or header.

The validation run on v0.3.1 (annzarro-paper notes/sources/
annzarro_v0.3.1_refresh.py) wrote to a store from a second process with
zarr slice assignment while a page showed it: neither a panel's Refresh nor
Ctrl+R (Refresh dataset) showed the new values. The panel's Refresh sent no
request within 60 s of the load (the browser's cache), Ctrl+R cleared that
cache by a key that never matched, and the server answered the requests
that did go out with 304 (the ETag did not see chunk writes).

One headless Chromium session per test opens a copy of the 200-cell
fixture coloured by obs total_counts, writes new values into the copy's
chunks and checks the plot draws them after the refresh.

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

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
PID = "cell-plot-a"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def served(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    store = str(data / "fixture_small.zarr")
    shutil.copytree(FIXTURE, store)
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
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
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store):
    plot = {"id": PID,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "total_counts", "column": ""}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
                               "panelConfigs": {PID: plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


COLOURS = f"""() => {{
    const gd = document.querySelector('.tile[data-tile-id="{PID}"] .js-plotly-plot');
    const t = gd && gd.data && gd.data.find(t => t.marker && t.marker.colorbar && Array.isArray(t.marker.color));
    return t ? t.marker.color.filter(Number.isFinite) : null;
}}"""


def _write(store, value):
    """A slice write from another process' point of view: chunks only."""
    import zarr
    try:
        root = zarr.open_group(store, mode="r+", use_consolidated=False)
    except TypeError:  # zarr 2: open_group never reads .zmetadata
        root = zarr.open_group(store, mode="r+")
    arr = root["obs/total_counts"]
    arr[:] = np.full(arr.shape, value, dtype=arr.dtype)


def _drawn(page, value, timeout=20):
    end = time.time() + timeout
    colours = None
    while time.time() < end:
        colours = page.evaluate(COLOURS)
        if colours and all(c == value for c in colours):
            return True
        page.wait_for_timeout(250)
    return colours


@pytest.mark.parametrize("how", ["panel", "header"])
def test_refresh_draws_values_written_to_the_store(served, how):
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root, store))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
            page.wait_for_function(f"({COLOURS})() && ({COLOURS})().length > 100", timeout=30000)
            assert len(set(page.evaluate(COLOURS))) > 10
            # well within the browser cache's 60 s
            _write(store, 4321.0)
            if how == "panel":
                page.click(f"#refresh-plot-{PID}")
            else:
                page.click("#refresh-dataset")
            got = _drawn(page, 4321.0)
            assert got is True, f"after the {how} Refresh the plot still draws {sorted(set(got or []))[:5]}..."
            assert not errors, errors
            page.close()
        finally:
            browser.close()
