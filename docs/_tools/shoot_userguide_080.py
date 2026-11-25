"""Screenshots and views for the 0.8.0 pages of the User guide: Gene Signature, Cell Grouping, Cell-Gene Plot, long computations.

Same method as shoot_userguide.py (docs/_tools/shots.py): every image comes from this script and a saved view, a control is
operated by real input where the step is about it, and a callout is a numbered outline drawn over the element it names.

Writes
  docs/_static/screens/user-guide/signature-*.png, grouping-*.png, cellgene-*.png, longcomp-*.png
  docs/_tools/views/userguide-080-*.json     the `view` objects used below

Run (the server starts, shoots and stops inside this one command):
  .venv-docs/bin/python docs/_tools/shoot_userguide_080.py [--port 8818] [--only signature grouping cellgene longcomp]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data), served through a temporary directory of symlinks.
The long-computations shots use a scratch server configuration that lowers the cost limits so the notices appear on a small
store; the page says so. The Cell Count Plot figures are not here yet: that plot's wording was still changing when this was
written (see docs/user-guide/cell-count-plot.md).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, tile  # noqa: E402
from shoot_userguide import OUT, VIEWS, capture, capture_union, finish, annotate, ds, T  # noqa: E402

D = "bm_aging_annzarro.zarr"
OBS = lambda k: {"type": "obs", "key": k}  # noqa: E731
UMAP = [{"type": "obsm", "key": "X_umap", "column": "0"}, {"type": "obsm", "key": "X_umap", "column": "1"}]

# Genes of the story: stem cell markers and lineage markers of mouse bone marrow (all in the store).
STEM = ["Cd34", "Kit", "Procr", "Hlf", "Mecom", "Ly6a", "Cebpa", "Irf8"]
LINEAGE = ["Cd3e", "Cd79a", "Ms4a1", "Cebpa", "Gata1", "Irf8", "Klf1", "Lyz2", "Pf4", "S100a8"]

SIG1, SIG2, GRP, CG, CT = "gene-signature-1", "gene-signature-2", "cell-grouping-1", "cell-gene-1", "cell-table-1"


def configs():
    return {
        SIG1: {"id": SIG1, "title": "Stem cell markers", "genes": STEM},
        SIG2: {"id": SIG2, "title": "Lineage markers", "genes": LINEAGE},
        GRP: {"id": GRP, "title": "Cell types by age", "version": 1,
              "partitionings": [{"source": OBS("midres_celltype")}, {"source": OBS("Age")}]},
        CG: {"id": CG, "title": "Cell-Gene Plot 1", "version": 1, "mode": "dots", "cellAxis": OBS("midres_celltype"),
             "sections": [{"source": SIG1, "rows": "genes"}, {"source": SIG2, "rows": "genes"}],
             "color": {"stat": "mean", "layer": "logged_counts"}, "size": {"stat": "fraction_of_cells", "layer": "raw_counts"}},
        CT: {"id": CT, "title": "Cell table", "columns": [{"type": "obs", "key": "midres_celltype", "column": ""}]},
    }


def view(shown, extra=None, name=None, controls=True):
    """A view with the panels `shown` open (one tile, or two side by side) and every other panel of `configs()` closed."""
    cfg = configs()
    cfg.update(extra or {})
    tiles = [{"type": "tile", "id": i, "controlsVisible": controls} for i in shown]
    root = tiles[0] if len(tiles) == 1 else {
        "type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}
    v = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [root], "controlState": {i: controls for i in shown},
                                              "panelConfigs": cfg}}
    if name:
        VIEWS.mkdir(exist_ok=True)
        (VIEWS / f"userguide-080-{name}.json").write_text(json.dumps(v, indent=1) + "\n")
    return v


def settle(page, sh, seconds=1.0):
    sh.ready(page)
    time.sleep(seconds)


def pop(page, name):
    return f"[data-popover='{name}']"


def shoot_signature(sh, data_dir):
    page = sh.open(view([SIG1], name="signature"), dataset=ds(D, data_dir), viewport={"width": 1200, "height": 560})
    settle(page, sh, 2.0)
    t = T(SIG1)
    capture(sh, page, "signature-panel", t, marks=[
        (1, f"{t} [data-methods]"), (2, f"{t} button:has-text('Distribution')"), (3, f"{t} input[placeholder*='Search']"),
        (4, f"{t} button:has-text('Paste or upload')"), (5, f"{t} button:has-text('Add from')"), (6, f"{t} button:has-text('Up/Down')"),
        (7, f"{t} button:has-text('Undo')")])
    page.locator(f"{t} [data-methods]").click()
    page.wait_for_selector(pop(page, "methods"))
    time.sleep(0.6)
    capture(sh, page, "signature-methods", pop(page, "methods"))
    page.keyboard.press("Escape")
    page.context.close()
    # Paste or upload: a pasted list with a direction column, previewed before anything is added
    page = sh.open(view([SIG1], extra={SIG1: {"id": SIG1, "title": "Signature", "genes": []}}, name="signature-paste"),
                   dataset=ds(D, data_dir), viewport={"width": 1200, "height": 900})
    settle(page, sh, 2.0)
    page.locator(f"{t} button:has-text('Paste or upload')").click()
    time.sleep(1.0)
    box = page.locator(f"{t} textarea, [data-popover] textarea").first
    box.fill("gene\tdirection\nCd34\t1\nKit\t1\nHlf\t1\nProcr\t1\nIrf8\t-1\nCd79a\t-1\nCD3E\t-1\nNOTAGENE\t1")
    time.sleep(1.0)
    page.locator(f"{t} button:has-text('Preview')").click()
    time.sleep(2.0)
    capture(sh, page, "signature-paste", t)
    page.context.close()
    # A Cell Table's Gene score tab: layer, aggregation button and Add column
    page = sh.open(view([CT], name="signature-table"), dataset=ds(D, data_dir), viewport={"width": 1400, "height": 760})
    settle(page, sh, 2.0)
    ct = T(CT)
    page.locator(f"{ct} .nav-link", has_text="Gene score").first.click()
    time.sleep(1.0)
    capture(sh, page, "signature-table-score", ct + " .table-controls")
    page.context.close()


def shoot_grouping(sh, data_dir):
    page = sh.open(view([GRP], name="grouping"), dataset=ds(D, data_dir), viewport={"width": 1200, "height": 640})
    settle(page, sh, 3.0)
    t = T(GRP)
    capture(sh, page, "grouping-overview", t, marks=[
        (1, f"{t} button:has-text('Add factor')"), (2, f"{t} .cmeth__toggle"), (3, f"{t} .cgrp-settings-btn"),
        (4, f"{t} .az-cards > li"), (5, f"{t} .az-card__edit"), (6, f"{t} .cgrp-groups")])
    page.locator(f"{t} .cgrp-settings-btn").click()
    page.wait_for_selector(pop(page, "settings"))
    time.sleep(0.6)
    capture(sh, page, "grouping-settings", pop(page, "settings"))
    page.keyboard.press("Escape")
    time.sleep(0.4)
    page.locator(f"{t} button:has-text('Cross-table')").click()
    time.sleep(1.0)
    capture(sh, page, "grouping-crosstable", t)
    page.locator(f"{t} button:has-text('List')").click()
    time.sleep(0.5)
    page.locator(f"{t} .az-card__edit").first.click()
    page.wait_for_selector(pop(page, "levels"))
    time.sleep(0.6)
    capture(sh, page, "grouping-levels", pop(page, "levels"))
    page.keyboard.press("Escape")
    page.context.close()
    # a numeric factor: binned, with its Edit pop-over (the binning control with the preview of the distribution)
    binned = {GRP: {"id": GRP, "title": "Cells by depth and age", "version": 1, "partitionings": [
        {"source": OBS("total_counts"), "binning": {"method": "equal_count", "bins": 6}}, {"source": OBS("Age")}]}}
    page = sh.open(view([GRP], extra=binned, name="grouping-binned"), dataset=ds(D, data_dir))
    settle(page, sh, 3.0)
    page.locator(f"{t} .az-card__edit").first.click()
    page.wait_for_selector(pop(page, "binning"))
    time.sleep(1.0)
    capture(sh, page, "grouping-bins", pop(page, "binning"))
    page.context.close()


def shoot_cellgene(sh, data_dir):
    page = sh.open(view([CG], name="cellgene"), dataset=ds(D, data_dir))
    settle(page, sh, 3.0)
    t = T(CG)
    capture(sh, page, "cellgene-overview", t, marks=[
        (1, f"{t} .cgene-axis"), (2, f"{t} .cgene-mode"), (3, f"{t} .cgene-field--color"), (4, f"{t} .cgene-field--size"),
        (5, f"{t} .cgene-scale"), (6, f"{t} .cgene-add"), (7, f"{t} .cgene-sections"), (8, f"{t} .cgene-3d-btn"),
        (9, f"{t} .cgene-swap"), (10, f"{t} .cgene-cluster-btn"), (11, f"{t} .cgene-color-btn"),
        (12, f"{t} .cgene-undo"), (13, f"{t} .cgene-options-btn")])
    # the Size symbol button's list: symbol and name of every statistic, with the threshold box ("above") of Fraction of cells
    page.locator(f"{t} .cgene-field--size .axis-agg-btn").click()
    time.sleep(0.8)
    menu = "[role=menu]:visible, .az-agg-menu:visible, .axis-agg-menu:visible"
    capture_union(sh, page, "cellgene-color-list", [f"{t} .cgene-field--size", menu], pad=10)
    page.keyboard.press("Escape")
    time.sleep(0.3)
    # Cluster pop-over
    page.locator(f"{t} .cgene-cluster-btn").click()
    page.wait_for_selector(pop(page, "cluster"))
    time.sleep(0.6)
    capture(sh, page, "cellgene-cluster", pop(page, "cluster"))
    page.keyboard.press("Escape")
    page.context.close()

    # a clustered plot with its dendrograms
    clustered = {CG: {**configs()[CG], "cluster": {"genes": "sections", "groups": "all"}}}
    page = sh.open(view([CG], extra=clustered, name="cellgene-clustered", controls=False), dataset=ds(D, data_dir))
    settle(page, sh, 3.0)
    capture(sh, page, "cellgene-dendrogram", T(CG) + " .tile-content")
    page.context.close()

    # one-row sections: the card with Show as One row, and the Color and Size of the row
    one = {CG: {**configs()[CG], "sections": [{"source": SIG1, "rows": "set"}, {"source": SIG2, "rows": "set"}]}}
    page = sh.open(view([CG], extra=one, name="cellgene-onerow"), dataset=ds(D, data_dir))
    settle(page, sh, 3.0)
    capture(sh, page, "cellgene-onerow", T(CG))
    page.context.close()

    # 3D
    three = {CG: {**configs()[CG], "view": "3d"}}
    page = sh.open(view([CG], extra=three, name="cellgene-3d", controls=False), dataset=ds(D, data_dir))
    settle(page, sh, 4.0)
    capture(sh, page, "cellgene-3d", T(CG) + " .tile-content")
    page.context.close()


def first_genes(data_dir, n):
    """The first n gene names of the store (read from its var index): a signature larger than the plot's limit."""
    import zarr
    var = zarr.open_group(str(Path(data_dir) / D), mode="r")["var"]["_index"][:n]
    return [str(g) for g in var]


def shoot_refusal_ways(sh, data_dir):
    """A matrix over its limit (11 sections of 2,000 genes over the 19 cell types): the notice names the cells of the matrix and the
    limit, and offers the ways out that would draw the plot, as buttons."""
    genes = first_genes(data_dir, 2000)
    extra = {
        "gene-signature-3": {"id": "gene-signature-3", "title": "First 2,000 genes", "genes": genes},
        CG: {**configs()[CG], "sections": [{"source": "gene-signature-3", "rows": "genes"}] * 11},
    }
    page = sh.open(view([CG], extra=extra, name="cellgene-too-large", controls=False), dataset=ds(D, data_dir))
    settle(page, sh, 4.0)
    page.wait_for_selector(f"{T(CG)} .score-notice", timeout=60000)
    time.sleep(6.0)
    sh.log.append("refusal ways: notice = " + json.dumps(page.eval_on_selector(f"{T(CG)} .score-notice", "e => e.textContent")))
    capture_union(sh, page, "cellgene-refused", [f"{T(CG)} .score-notice .filter-notice__card"], pad=18)
    page.context.close()


# The limits are lowered for the long-computations pictures, so the notices appear on a store of 8,090 cells: a scratch server
# configuration (limits.* of docs/deployment/resource-limits.md), never a setting of the product. The page says so.
LOWERED = "limits:\n  live_update_s: 0.1\n  ask_first_s: 0.4\n  refuse_s: 0.9\n  try_max_s: 120\n"


def shoot_longcomp(sh, data_dir):
    """Asks first, refused with Try anyway, and a panel that runs without asking: a Cell-Gene Plot of the 18 marker genes, with the
    layers stored by cell, under the lowered limits."""
    notice = f"{T(CG)} .score-notice"
    # one layer for Color and Size: one read, between the ask-first and the refuse limit
    one_layer = {CG: {**configs()[CG], "color": {"stat": "mean", "layer": "logged_counts"},
                      "size": {"stat": "fraction_of_cells", "layer": "logged_counts"}}}
    page = sh.open(view([CG], extra=one_layer, name="longcomp-asks"), dataset=ds(D, data_dir))
    settle(page, sh, 4.0)
    page.wait_for_selector(notice, timeout=60000)
    time.sleep(2.0)
    sh.log.append("longcomp asks: " + json.dumps(page.eval_on_selector(notice, "e => e.textContent")))
    capture_union(sh, page, "longcomp-asks", [f"{notice} .filter-notice__card"], pad=18)
    page.context.close()
    # two layers: two reads, over the refuse limit
    page = sh.open(view([CG], name="longcomp-refused"), dataset=ds(D, data_dir))
    settle(page, sh, 4.0)
    page.wait_for_selector(notice, timeout=60000)
    time.sleep(2.0)
    sh.log.append("longcomp refused: " + json.dumps(page.eval_on_selector(notice, "e => e.textContent")))
    capture_union(sh, page, "longcomp-refused", [f"{notice} .filter-notice__card"], pad=18)
    # tick Don't ask again on the refusal: it starts the run the server allows, and the strip says the panel runs without asking
    page.get_by_label("Don't ask again for this panel").first.check()
    sh.ready(page, timeout=120)
    time.sleep(3.0)
    tag = page.locator(f"{T(CG)} .ps-tag:has-text('Runs without asking')").first
    sh.log.append("longcomp tag visible: " + str(tag.count()))
    tag.click()
    time.sleep(0.8)
    capture_union(sh, page, "longcomp-runs-without-asking", [f"{T(CG)} .plot-status, {T(CG)} .ps-summary", "[role=dialog]:visible, .ps-popover:visible, .popover:visible"], pad=14)
    page.context.close()


STEPS = {"signature": shoot_signature, "grouping": shoot_grouping, "cellgene": shoot_cellgene, "refusal": shoot_refusal_ways, "longcomp": shoot_longcomp}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8818)
    ap.add_argument("--only", nargs="*", default=None)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="annzarro-userguide080-"))
    (data_dir / D).symlink_to(DATA_DIR / D)
    wanted = a.only or list(STEPS)
    normal = [n for n in wanted if n != "longcomp"]
    if normal:
        with Session(a.port, OUT, data_dir=data_dir) as sh:
            for name in normal:
                STEPS[name](sh, data_dir)
    if "longcomp" in wanted:
        cfg = Path(tempfile.mkdtemp(prefix="annzarro-lowered-limits-")) / "site.yaml"
        cfg.write_text(LOWERED)
        with Session(a.port + 1, OUT, data_dir=data_dir, config=cfg) as sh:
            shoot_longcomp(sh, data_dir)
