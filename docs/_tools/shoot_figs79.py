"""Screenshots for the paper-figure guides on the slot map and on performance.

Slot map (docs/paper/overview.md, panel b; the script name keeps an earlier figure numbering):
one single-panel view per AnnData slot, each cropped to its tile, plus the controls of three
panels so the guide can show the exact dropdown values. Performance (docs/paper/performance.md):
one deep link is
opened, a gene and a cell are clicked, and the browser's own Resource Timing entries for
the data requests are written to fig9-resource-timing.json (the numbers quoted in the
guide come from that file).

Run: .venv-docs/bin/python docs/_tools/shoot_figs79.py [--port 8816] [--only fig7|fig9]
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from PIL import Image, ImageChops  # noqa: E402
from shots import Session, split, tile  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "paper"
VIEWS = HERE / "views"

CELL = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"   # an old HSC, the focus used throughout the paper
GENE = "H2-Q7"
FC = "kompot_de_Young_to_Old_fold_change"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
VOLCANO_X = {"type": "var", "key": "kompot_de_Young_to_Old_mean_lfc", "column": ""}
VOLCANO_Y = {"type": "var", "key": "kompot_de_Young_to_Old_mahalanobis", "column": ""}
CELL_HOVER = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "highres_celltype"}]
GENE_HOVER = [{"type": "var", "key": "_index"}]
SMALL = {"width": 1000, "height": 820}


def cell_plot(tid, title, color, x=UMAP_X, y=UMAP_Y, **kw):
    return {"id": tid, "title": title, "x": x, "y": y, "z": None, "color": color,
            "pointSize": 3, "pointOpacity": 0.8, "highlightFocusedCell": True,
            "hoverInfo": CELL_HOVER, **kw}


def gene_plot(tid, title, color, x=VOLCANO_X, y=VOLCANO_Y, **kw):
    return {"id": tid, "title": title, "x": x, "y": y, "z": None, "color": color,
            "pointSize": 5, "pointOpacity": 0.8, "highlightFocusedGene": True,
            "hoverInfo": GENE_HOVER, **kw}


def single(cfg):
    tid = cfg["id"]
    return {"v": 1, "constants": {"focusedCell": CELL, "focusedGene": GENE, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [tile(tid)], "controlState": {tid: False},
                       "panelConfigs": {tid: cfg}}}


# name -> panel config; the tile id prefix decides the panel type
FIG7 = {
    "slot-obsm-obs": cell_plot(
        "cell-plot-S1", "obsm axes (X_umap), obs colour (highres_celltype, uns colours)",
        {"type": "obs", "key": "highres_celltype", "column": ""}),
    "slot-obs-axes": cell_plot(
        "cell-plot-S2", "obs axes: Kompot log density, Young vs Old; colour obs DA log fold change",
        {"type": "obs", "key": "kompot_da_Young_to_Old_lfc", "column": ""},
        x={"type": "obs", "key": "kompot_da_Young_log_density", "column": ""},
        y={"type": "obs", "key": "kompot_da_Old_log_density", "column": ""},
        colorScale="RdBu", colorReversed=True, centeringActive=True),
    "slot-obsp": cell_plot(
        "cell-plot-S3", "obsp row of the focused cell: diffusion_walk_t5",
        {"type": "obsp", "key": "diffusion_walk_t5", "column": CELL, "locked": False},
        colorScale="Blues", colorReversed=True),
    "slot-layer-gene": cell_plot(
        "cell-plot-S4", f"layer column of the focused gene: fold change of {GENE}",
        {"type": "layer", "key": FC, "column": GENE, "locked": False},
        colorScale="RdBu", centeringActive=True),
    "slot-layer-cell": gene_plot(
        "gene-plot-S5", "var axes (volcano), colour = layer row of the focused cell (fold change)",
        {"type": "layer", "key": FC, "column": CELL, "locked": False},
        colorScale="RdBu", centeringActive=True),
    "slot-varm": gene_plot(
        "gene-plot-S6", "varm axes: gene loadings on PC 1 and PC 2 (varm PCs); colour var Mahalanobis distance",
        {"type": "var", "key": "kompot_de_Young_to_Old_mahalanobis", "column": ""},
        x={"type": "varm", "key": "PCs", "column": "0"},
        y={"type": "varm", "key": "PCs", "column": "1"}, colorScale="Viridis"),
    "slot-varp": gene_plot(
        "gene-plot-S7", f"varp row of the focused gene: Spearman correlation to {GENE}",
        {"type": "varp", "key": "spearman_fold_change", "column": GENE, "locked": False},
        colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
}
# Output names are referenced by docs/data/slot-map.md (slot-obsp, slot-layer-gene, slot-varp,
# slot-varp-controls) as well as docs/paper/overview.md; keep them stable.
# shots that also crop the panel's controls, to show the three dropdowns
WITH_CONTROLS = ["slot-obsp", "slot-layer-cell", "slot-varp"]


def tidy(path, pad=12):
    """Trim the empty margin Plotly leaves in a tall tile; keep the PNG small."""
    im = Image.open(path).convert("RGB")
    im = im.crop((4, 4, im.width - 4, im.height - 4))   # drop the tile's 1 px border
    bg = Image.new("RGB", im.size, im.getpixel((im.width // 2, 2)))
    box = ImageChops.difference(im, bg).point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        l, t, r, b = box
        im = im.crop((max(l - pad, 0), max(t - pad, 0), min(r + pad, im.width), min(b + pad, im.height)))
    im.save(path, optimize=True)
    if path.stat().st_size > 400 * 1024:
        im.quantize(256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def show_controls(s, page, tid):
    page.locator(f'.tile[data-tile-id="{tid}"] .tile-toggle-controls').click()
    s.ready(page)
    page.locator(f'.tile[data-tile-id="{tid}"] .plot-controls').screenshot(
        path=str(OUT / f"{name_of(tid)}-controls.png"))
    tidy(OUT / f"{name_of(tid)}-controls.png")
    s.log.append(f"wrote {name_of(tid)}-controls.png")


def name_of(tid):
    return next(n for n, c in FIG7.items() if c["id"] == tid)


def fig7(s):
    for name, cfg in FIG7.items():
        view = single(cfg)
        (VIEWS / f"{name}.json").write_text(json.dumps(view, indent=1))
        page = s.open(view, viewport=SMALL)
        s.shot(page, f"_full-{name}", tiles={cfg["id"]: name})
        (OUT / f"_full-{name}.png").unlink()
        tidy(OUT / f"{name}.png")
        if name in WITH_CONTROLS:
            show_controls(s, page, cfg["id"])
        page.context.close()


# Performance: what one click costs, measured by the browser itself.
TIMING_JS = """() => performance.getEntriesByType('resource')
  .filter(e => e.name.includes('/api/v1/data/'))
  .map(e => ({url: e.name.replace(location.origin, ''), ms: +e.duration.toFixed(1),
              transfer: e.transferSize, body: e.encodedBodySize}))"""


def fig9(s):
    a = cell_plot("cell-plot-P1", f"fold change of the focused gene ({GENE})",
                  {"type": "layer", "key": FC, "column": GENE, "locked": False},
                  colorScale="RdBu", centeringActive=True)
    b = gene_plot("gene-plot-P2", "volcano, colour = fold change in the focused cell",
                  {"type": "layer", "key": FC, "column": CELL, "locked": False},
                  colorScale="RdBu", centeringActive=True)
    view = {"v": 1, "constants": {"focusedCell": CELL, "focusedGene": GENE, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [split("horizontal", tile(a["id"]), tile(b["id"]))],
                       "controlState": {a["id"]: False, b["id"]: False},
                       "panelConfigs": {a["id"]: a, b["id"]: b}}}
    (VIEWS / "click-cost.json").write_text(json.dumps(view, indent=1))
    page = s.open(view)
    page.evaluate("performance.clearResourceTimings()")
    record = {"dataset": "bm_aging.zarr (8,090 cells x 16,285 genes)", "clicks": []}
    # Focus a new gene by clicking it in the volcano, then a new cell in the embedding.
    for label, tid in (("gene click", b["id"]), ("cell click", a["id"])):
        page.evaluate("performance.clearResourceTimings()")
        clicked = page.evaluate("""(tid) => {
          const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
          const tr = g._fullData[0], n = tr.x.length;
          const i = Math.floor(n * 0.37);
          const pt = {curveNumber: 0, pointNumber: i, pointIndex: i, x: tr.x[i], y: tr.y[i],
                      data: g.data[0], fullData: tr,
                      customdata: tr.customdata ? tr.customdata[i] : undefined,
                      text: tr.text ? tr.text[i] : undefined};
          g.emit('plotly_click', {points: [pt], event: new MouseEvent('click')});
          return tr.text ? String(tr.text[i]).slice(0, 80) : i;
        }""", tid)
        s.ready(page)
        record["clicks"].append({"click": label, "point": clicked,
                                 "requests": page.evaluate(TIMING_JS)})
    # Back to the previous gene (header "Previous gene" button): a repeat of an earlier read.
    page.evaluate("performance.clearResourceTimings()")
    statuses = []
    page.on("response", lambda r: statuses.append((r.status, r.url.replace(s.base, "")))
            if "/api/v1/data/" in r.url else None)
    page.click("#gene-history-back")
    s.ready(page)
    record["clicks"].append({"click": "Previous gene (repeat)", "point": page.input_value("#focused-gene")
                             if page.locator("#focused-gene").count() else None,
                             "requests": page.evaluate(TIMING_JS),
                             "http_status": [st for st, _ in statuses]})
    (OUT / "fig9-resource-timing.json").write_text(json.dumps(record, indent=1))
    s.shot(page, "fig9-after-clicks")
    tidy(OUT / "fig9-after-clicks.png")
    s.log.append(json.dumps(record, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8816)
    ap.add_argument("--only", choices=["fig7", "fig9"])
    a = ap.parse_args()
    VIEWS.mkdir(exist_ok=True)
    with Session(a.port, OUT) as s:
        if a.only in (None, "fig7"):
            fig7(s)
        if a.only in (None, "fig9"):
            fig9(s)
