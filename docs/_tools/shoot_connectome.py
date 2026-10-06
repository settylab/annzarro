"""Views, panel sets and screenshots for the connectome panel of the paper's cell-by-cell figure
(docs/paper/cell-by-cell.md, section "A connectome as a cells x cells matrix").

The store is built by data_prep/neuro_demo.py in settylab/annzarro-paper:
data/neuro_demo/celegans_connectome_cengen.zarr (112 C. elegans neuron classes, CeNGEN
transcriptomes, Varshney 2011 synapse counts summed per class). The paper panel is drawn by
figures/fig2_cell_by_cell.py connectome_panel(): focus AVA, row of obsp/chemical_synapses, log
colour from 1 to 82, strongest on top, classes with no synapse in grey.

In AnnZarro the closest view is: Log on with floor 0.5 and the colour range from the data, so
classes with no synapse take the lowest colour (log10 0.5) and a single synapse (log10 1) is
already a step above it; reversed Blues, whose low end is a light grey. Under Log the Min and
Max of the colour range are log10 values, so a range of 1 to 82 would be typed as 0 and 1.914.

Writes
  docs/_static/panelsets/paper/cell-by-cell-connectome{,-gap}.json   panel sets
  docs/_static/panelsets/paper/cell-by-cell-connectome{,-gap}.url.txt share links
  docs/_tools/views/cell-by-cell-connectome{,-gap}.json            deep-link `view` objects
  docs/_static/screens/paper/connectome-*.png                     screenshots

Run (under the bench lock), with AnnZarro from this checkout:
  .venv-docs/bin/python docs/_tools/shoot_connectome.py [--port 8817]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, panelset_file, start_link, tile  # noqa: E402

REPO = HERE.parent.parent
STORE = "celegans_connectome_cengen.zarr"
NEURO_DIR = Path(os.environ.get("ANNZARRO_NEURO_DATA", DATA_DIR / "neuro_demo"))
PANELSETS = REPO / "docs" / "_static" / "panelsets" / "paper"
VIEWS = HERE / "views"
OUT = REPO / "docs" / "_static" / "screens" / "paper"
FOCUS = "AVA"
TID = "cell-plot-N"


def view(key: str, title: str) -> dict:
    cfg = {
        "id": TID, "title": title,
        "x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"},
        "z": None,
        "color": {"type": "obsp", "key": key, "column": FOCUS, "locked": False,
                  "log": True, "logFloor": 0.5},
        "colorScale": "Blues", "colorReversed": True,
        "pointSize": 8, "pointOpacity": 1,
        "highlightFocusedCell": True, "equalAspect": True,
        "xaxisTitle": "UMAP 1", "yaxisTitle": "UMAP 2",
    }
    return {"v": 1, "constants": {"focusedCell": FOCUS},
            "layout": {"v": 1, "hierarchy": [tile(TID)], "controlState": {TID: False},
                       "panelConfigs": {TID: cfg}}}


ALL = {
    "cell-by-cell-connectome": view("chemical_synapses", "Chemical synapses from the focused class"),
    "cell-by-cell-connectome-gap": view("gap_junctions", "Gap junctions of the focused class"),
}


def serve(port: int) -> subprocess.Popen:
    env = dict(os.environ, ANNZARRO_HOME=tempfile.mkdtemp(), ANNZARRO_HEADLESS="1",
               PYTHONPATH=str(REPO) + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(NEURO_DIR), "--no-browser",
                             "--auth-disabled"], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/config", timeout=1)
            return proc
        except OSError:
            time.sleep(0.25)
    proc.kill()
    raise SystemExit("server did not start")


def write() -> None:
    VIEWS.mkdir(exist_ok=True)
    for name, v in ALL.items():
        (VIEWS / f"{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        (PANELSETS / f"{name}.json").write_text(json.dumps(panelset_file(name, v, STORE), indent=2) + "\n")
        (PANELSETS / f"{name}.url.txt").write_text(start_link(STORE, v) + "\n")
        print("wrote", name)


TRACE = """() => { const g = document.querySelector('.tile .js-plotly-plot');
  return g.data.map(t => ({name: t.name || null, n: (t.x || []).length,
    cmin: t.marker && t.marker.cmin, cmax: t.marker && t.marker.cmax})); }"""


def shoot(port: int) -> None:
    proc = serve(port)
    try:
        with Session(port=port, out=OUT, url=f"http://127.0.0.1:{port}", data_dir=NEURO_DIR) as s:
            for name, v in ALL.items():
                page = s.open(v, dataset=str(NEURO_DIR / STORE), viewport={"width": 1000, "height": 760})
                s.log.append(f"{name}: traces {page.evaluate(TRACE)}")
                short = name.replace("cell-by-cell-", "")
                s.shot(page, f"{short}-page", tiles={TID: short})
                (OUT / f"{short}-page.png").unlink()      # only the tile crop is used
                page.context.close()
    finally:
        proc.terminate()
        proc.wait(10)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8817)
    ap.add_argument("--no-shots", action="store_true")
    a = ap.parse_args()
    write()
    if not a.no_shots:
        shoot(a.port)


if __name__ == "__main__":
    main()
