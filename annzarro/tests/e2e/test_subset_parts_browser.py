"""Stepping through a subset's parts in a real (headless) browser.

Opens the committed fixture (200 cells) on {"n": 60, "seed": 0}, which is
part 1 of 4, then steps with the › button and by typing a part number. Every
step must keep the view and load other cells: the cell names each part loads
differ, never overlap, and the four parts together are all 200 cells.

Needs Playwright with Chromium (``pip install playwright; playwright install
chromium``); skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1. Starts the server on a free 127.0.0.1 port.
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

# CI sets ANNZARRO_REQUIRE_BROWSER=1 where Playwright is installed: there a
# missing browser or asset is a failure, not a skip.
REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"


def _skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
N_CELLS, N_PART = 200, 60


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        _skip_or_fail("static/vendor is not provisioned")
    tmp = tmp_path_factory.mktemp("parts")
    data = tmp / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(20)


def test_stepping_parts_loads_disjoint_cells_that_cover_the_dataset(server):
    base, dataset = server
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"id": "cell-plot-A", "title": "parts", "x": x, "y": y, "z": None,
            "color": {"type": "obs", "key": "leiden", "column": ""}}
    layout = {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-A"}],
              "controlState": {"cell-plot-A": False}, "panelConfigs": {"cell-plot-A": plot}}
    view = {"v": 1, "subset": {"n": N_PART, "seed": 0}, "layout": layout}
    link = (f"{base}/?dataset_path={dataset}#view="
            + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))
    loads = []                                   # (part, cell names) per /data/cells reply

    def on_response(resp):
        if "/api/v1/data/cells" in resp.url and resp.ok:
            spec = json.loads(urllib.parse.parse_qs(urllib.parse.urlparse(resp.url).query)["subset"][0])
            loads.append((spec.get("part", 0), resp.json()["cells"]))

    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page()
            page.on("response", on_response)
            page.goto(link)
            page.wait_for_selector("#subset-parts:not([hidden])", timeout=60_000)
            assert page.input_value("#subset-part-input") == "1"
            assert page.text_content("#subset-part-count") == "4"
            assert page.is_disabled("#subset-part-prev")
            tiles = page.eval_on_selector_all(".tile", "t => t.map(e => e.dataset.tileId)")
            assert tiles

            def points():
                return page.evaluate("""() => { const g = document.querySelector('.tile[data-tile-id="cell-plot-A"] .js-plotly-plot');
                    // legend-only helper traces (meta az-legend, one null point) are not cells
                    return g && g._fullData ? g._fullData.filter(d => d.name !== 'Focused Cell' && d.meta !== 'az-legend')
                        .reduce((s, d) => s + (d.x ? d.x.length : 0), 0) : -1; }""")

            def wait_for_part(part):
                page.wait_for_function(f"document.querySelector('#subset-part-input').value === '{part + 1}'",
                                       timeout=60_000)
                deadline = time.time() + 60
                want = min(N_PART, N_CELLS - part * N_PART)
                while (not any(p == part for p, _ in loads) or points() != want) and time.time() < deadline:
                    page.wait_for_timeout(50)
                assert points() == want, f"the plot shows {points()} cells for part {part}, not {want}"

            page.click("#subset-part-next")
            wait_for_part(1)
            page.click("#subset-part-next")
            wait_for_part(2)
            page.fill("#subset-part-input", "4")
            page.press("#subset-part-input", "Enter")
            wait_for_part(3)
            assert page.is_disabled("#subset-part-next")
            assert page.eval_on_selector_all(".tile", "t => t.map(e => e.dataset.tileId)") == tiles, \
                "stepping kept the panels"
        finally:
            browser.close()

    by_part = {}
    for part, cells in loads:
        by_part.setdefault(part, cells)
        assert by_part[part] == cells, f"part {part} loaded two different cell lists"
    assert sorted(by_part) == [0, 1, 2, 3]
    sets = [set(by_part[p]) for p in range(4)]
    assert [len(s) for s in sets] == [60, 60, 60, 20]
    for i in range(4):
        for j in range(i + 1, 4):
            assert not sets[i] & sets[j], f"parts {i} and {j} overlap"
    assert len(set().union(*sets)) == N_CELLS
