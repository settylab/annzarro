"""Shared pieces of the loading-clarity browser tests: a server on two copies of the fixture,
a share link with N plots/tables, and a route that makes the data requests slow."""
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

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")

#: data requests a slow shared filesystem would hold up
SLOW = ("/data/dataset_structure", "/data/obs", "/data/obsm", "/data/cells", "/data/genes",
        "/data/names", "/data/fingerprint", "/data/X", "/api/v1/datasets")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(tmp_path_factory, extra_args=(), config=None):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    shutil.copytree(FIXTURE, data / "other_small.zarr")
    port = free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    cmd = [sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
           "--data-dir", str(data), "--no-browser", "--auth-disabled", *extra_args]
    if config:
        (home / "config.yaml").write_text(config)
        cmd += ["--config", str(home / "config.yaml")]
    proc = subprocess.Popen(cmd, env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    return root, proc, data


def make_link(root, store, ids=("cell-plot-A", "gene-plot-B", "cell-table-C")):
    """A share link of one tile per id (a plot of UMAP coloured by cell_type, a gene plot, a table)."""
    def config(i):
        if i.startswith("cell-plot"):
            return {"id": i, "title": "Cell Plot " + i[-1], "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                    "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None,
                    "color": {"type": "obs", "key": "cell_type", "column": ""}}
        return {"id": i}
    view = {"v": 1, "layout": {"v": 1,
            "hierarchy": [{"type": "tile", "id": i, "controlsVisible": True} for i in ids],
            "controlState": {i: True for i in ids},
            "panelConfigs": {i: config(i) for i in ids}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(str(store), safe='/')}#view={payload}"


def slow(page, ms):
    """Hold every request in SLOW for ``ms`` (the link's own page and static files are not delayed)."""
    def handler(route):
        if any(k in route.request.url for k in SLOW) and "/datasets/folder" not in route.request.url:
            page.wait_for_timeout(ms)
        route.continue_()
    page.route("**/api/v1/**", handler)


OPEN_TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
