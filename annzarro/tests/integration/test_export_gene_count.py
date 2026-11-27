"""``annzarro export --panel`` draws a Cell-Gene Plot and a Cell Count Plot, not only a Cell Plot.

The command takes any open panel with a Plotly graph (main.js annzarroPlots), so the two newer plots export too. One run
per plot, in a fresh server and headless Chromium, as a user runs it; the figure must be a PNG of a drawn plot.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api  # noqa: F401,E402
else:
    pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")

CELL_GENE = {"id": "cell-gene-1", "title": "Cell-Gene Plot 1", "version": 1, "mode": "dots",
             "sections": [{"source": "gene-signature-S1", "rows": "genes"}],
             "cellAxis": {"type": "obs", "key": "cell_type"},
             "color": {"stat": "mean", "layer": "X"}, "size": {"stat": "fraction_of_cells", "layer": "X"}}
SIGNATURE = {"id": "gene-signature-S1", "title": "Markers", "genes": ["GENE004", "GENE005", "GENE006"]}
CELL_COUNT = {"id": "cell-count-1", "title": "Count 1", "version": 1, "mode": "bar",
              "x": {"source": {"type": "obs", "key": "cell_type"}}}
PANEL_SET = {
    "name": "gene-and-count", "dataset": "fixture_small.zarr",
    "view": {"v": 1, "constants": {}, "layout": {
        "v": 1, "controlState": {},
        "hierarchy": [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}],
                       "children": [{"type": "tile", "id": "cell-gene-1"}, {"type": "tile", "id": "cell-count-1"}]}],
        "panelConfigs": {"cell-gene-1": CELL_GENE, "cell-count-1": CELL_COUNT, "gene-signature-S1": SIGNATURE}}},
}


@pytest.fixture(scope="module")
def work(tmp_path_factory):
    base = tmp_path_factory.mktemp("export_gene_count")
    shutil.copytree(FIXTURE, base / "fixture_small.zarr")
    (base / "view.json").write_text(json.dumps(PANEL_SET))
    return base


@pytest.mark.parametrize("panel", ["cell-gene-1", "cell-count-1"])
def test_a_cell_gene_and_a_cell_count_plot_export_as_png(work, panel):
    out = work / f"{panel}.png"
    env = dict(os.environ, PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.run([sys.executable, "-m", "annzarro.cli", "export", str(work / "view.json"), "--store", str(work / "fixture_small.zarr"),
                           "--out", str(out), "--panel", panel, "--allow-other-store", "--timeout", "120"],
                          cwd=work, env=env, capture_output=True, text=True, timeout=600)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    data = out.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(data) > 20_000, "a drawn plot, not an empty canvas"
