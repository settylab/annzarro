"""Screenshots of large-plot mode for user-guide/subsets.md.

The real case is tens of millions of cells; the mode starts above
ui.defaults.large_plot_points (5M by default). To regenerate on the small demo
store, the server here runs with that setting lowered to 5,000, so bm_aging's
8,090 cells are "large" and a 4,000-cell subset is not:

    .venv-docs/bin/python docs/_tools/shoot_large_plot.py

Writes docs/_static/screens/user-guide/large-plot-{all,subset}.png: the same
Cell Plot with every cell (large-plot mode: the panel's notice, Hover picker
and table filter off) and with the subset on (the regular plot).
"""
from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

from shots import Session, tile

OUT = Path(__file__).resolve().parents[1] / "_static/screens/user-guide"
T = "cell-plot-LP"


def view(subset):
    cfg = {T: {"id": T, "title": "UMAP", "x": {"type": "obsm", "key": "X_umap", "column": "0"},
               "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None,
               "color": {"type": "obs", "key": "highres_celltype", "column": ""},
               "pointSize": 4, "pointOpacity": 0.8}}
    return {"v": 1, "subset": subset,
            "layout": {"v": 1, "hierarchy": [{**tile(T), "controlsVisible": True}], "controlState": {T: True}, "panelConfigs": cfg}}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8964)
    a = ap.parse_args()
    cfg = Path(tempfile.gettempdir()) / "annzarro-large-plot-shots.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 5000\n")
    with Session(a.port, OUT, config=cfg) as sh:
        for name, subset in (("large-plot-all", None), ("large-plot-subset", {"n": 4000, "seed": 0})):
            page = sh.open(view(subset), dataset="bm_aging.zarr", viewport={"width": 1400, "height": 900})
            time.sleep(0.5)
            notice = page.locator(".mode-notice .coverage-notice__headline")
            sh.log.append(f"{name}: notice = {notice.inner_text() if notice.count() else None}")
            page.mouse.move(2, 2)
            page.locator(f'.tile[data-tile-id="{T}"] .tile-content').screenshot(path=str(OUT / f"{name}.png"))
            sh.log.append(f"wrote {name}.png")
            page.context.close()


if __name__ == "__main__":
    main()
