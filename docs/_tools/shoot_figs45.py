"""Screenshots, views and panel sets for the paper-figure guides gene by gene and cells and genes
(docs/paper/gene-by-gene.md, cells-and-genes.md). Screenshot names with fig4/fig5 keep an earlier
figure numbering; panel sets and views are named after the guide.

    .venv-docs/bin/python docs/_tools/shoot_figs45.py [--port 8815] [--only 4ab 4c 4d 5abc 5d]

Writes
  docs/_tools/views/{gene-by-gene,cells-and-genes}-*.json   deep-link `view` objects
  docs/_static/panelsets/paper/<same names>.json     panel sets for Load Panel Set > Upload file
  docs/_static/panelsets/paper/links-figs45.json     compressed `#view=z1.` fragments per view
  docs/_static/panelsets/paper/<same names>.url.txt  the full link, included by the pages
  docs/_static/screens/paper/fig{4,5}*.png           screenshots

Gene by gene = figures/fig3_gene_by_gene.py and cells and genes = figures/fig4_cells_by_genes.py in
settylab/annzarro-paper. Cells and genes are the paper's (data_prep/demo_panelsets/examples.json).
All views use bm_aging_annzarro.zarr (docs/data/demo-data.md), which adds the paper's
offline results (modules, ranks, classes, the fold-change z-score layer) as fields.
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session, panelset_file, split, start_link, tile, z1  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "paper"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "paper"
DATASET = "bm_aging_annzarro.zarr"

HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
MONO = "Mature_Young_2#TCAATTCAGTGAGGCT-1"
FC = "kompot_de_Young_to_Old_fold_change"
FC_Z = "kompot_de_Young_to_Old_fold_change_zscores"
YS, OS = "kompot_de_Young_smoothed", "kompot_de_Old_smoothed"


def var(key: str) -> dict:
    return {"type": "var", "key": key, "column": ""}


LFC, MAH = var("kompot_de_Young_to_Old_mean_lfc"), var("kompot_de_Young_to_Old_mahalanobis")
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
GENE_HOVER = [{"type": "var", "key": "_index"}]
CELL_HOVER = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "highres_celltype"}]


def view(cfg: dict, hierarchy: dict, gene: str, cell: str) -> dict:
    return {"v": 1, "constants": {"focusedGene": gene, "focusedCell": cell, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [hierarchy],
                       "controlState": {k: False for k in cfg}, "panelConfigs": cfg}}


def crit(title: str, field: str, cond: str, value, kind="num") -> dict:
    """One SearchBuilder criterion: `title` is the column header, `field` its data key
    (`<slot>_<key>_<column or main>`, table-data.js getColumnKey)."""
    vals = value if isinstance(value, list) else [value]
    return {"condition": cond, "data": title, "origData": field, "type": kind,
            "value": [str(v) for v in vals]}


def var_crit(key: str, cond: str, value, kind="num") -> dict:
    return crit(key, f"var_{key}_main", cond, value, kind)


def layer_crit(layer: str, cell: str, cond: str, value) -> dict:
    """Criterion on a gene table's layer column for a fixed cell or the focused cell."""
    field = f"layer_{layer}_{'focused_cell' if cell == MONO else cell}"
    return crit(f"{layer}: {cell}", field, cond, value)


# --------------------------------------------------------------------------- Figure 4
def fig4_ab() -> dict:
    cfg = {"gene-plot-4a": {
        "id": "gene-plot-4a", "title": "Volcano, colour = focused gene's row of spearman_fold_change",
        "x": LFC, "y": MAH, "z": None,
        "color": {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
        "pointSize": 5, "pointOpacity": 0.85, "colorScale": "RdBu",
        "colorMin": -1, "colorMax": 1, "lockColorRange": True, "highlightFocusedGene": True,
        "hoverInfo": GENE_HOVER}}
    return view(cfg, tile("gene-plot-4a"), "H2-Q7", HSC)


def rank_strip(tid: str, focus: str) -> dict:
    return {"id": tid, "title": f"DE genes ranked by rho with {focus}, colour = module (k = 3)",
            "x": var(f"rho_rank_{focus}"), "y": var(f"rho_fc_{focus}"), "z": None,
            "color": var("gene_module_k3"), "pointSize": 7, "pointOpacity": 0.95,
            "hideNaN": True, "showZeroLines": True, "hoverInfo": GENE_HOVER,
            # Headroom above rho = 1 keeps the in-plot coverage note off the top-ranked genes.
            "viewport2D": {"xrange": [-4, 194], "yrange": [-0.8, 1.35]}}


def fig4_c() -> dict:
    cfg = {
        "gene-plot-4c1": rank_strip("gene-plot-4c1", "H2-Q7"),
        "gene-plot-4c2": rank_strip("gene-plot-4c2", "S100a9"),
        "gene-table-4c": {
            "id": "gene-table-4c", "title": "H2-Q7's module-mates with rho < 0.2",
            "columns": [var("gene_module_k3"), var("rho_fc_H2-Q7"), var("rho_fc_S100a9"), MAH],
            "searchBuilderConfig": {"logic": "AND", "criteria": [
                var_crit("gene_module_k3", "=", "module 1", "string"),
                var_crit("rho_fc_H2-Q7", "<", "0.2")]}},
    }
    hier = split("horizontal", split("vertical", tile("gene-plot-4c1"), tile("gene-plot-4c2")),
                 tile("gene-table-4c"), 58)
    return view(cfg, hier, "H2-Q7", HSC)


def fig4_d() -> dict:
    cfg = {"gene-plot-4d": {
        "id": "gene-plot-4d", "title": "Focused gene's rows: smoothed (x) vs fold change (y)",
        "x": {"type": "varp", "key": "spearman_smoothed", "column": "H2-Q7", "locked": False},
        "y": {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
        "z": None, "color": var("h2q7_correlation_class"), "pointSize": 5, "pointOpacity": 0.85,
        "highlightFocusedGene": True, "showZeroLines": True, "hoverInfo": GENE_HOVER}}
    return view(cfg, tile("gene-plot-4d"), "H2-Q7", HSC)


# --------------------------------------------------------------------------- Figure 5
def umap(tid: str, title: str, key: str, **kw) -> dict:
    c = {"id": tid, "title": title, "x": UMAP_X, "y": UMAP_Y, "z": None,
         "color": {"type": "layer", "key": key, "column": "S100a9", "locked": False},
         "pointSize": 3, "pointOpacity": 0.85, "highlightFocusedCell": True, "hoverInfo": CELL_HOVER}
    c.update(kw)
    return c


SHARED_RANGE = {"colorScale": "Viridis", "colorMin": 0, "colorMax": 3.77, "lockColorRange": True}


def fig5_abc() -> dict:
    cfg = {
        "cell-plot-5a": umap("cell-plot-5a", "a | S100a9 fold change, Old - Young", FC,
                             colorScale="RdBu", centeringActive=True),
        "cell-plot-5b": umap("cell-plot-5b", "b | S100a9 smoothed, Young (0 to 3.77)", YS, **SHARED_RANGE),
        "cell-plot-5c": umap("cell-plot-5c", "c | S100a9 smoothed, Old (0 to 3.77)", OS, **SHARED_RANGE),
    }
    hier = split("horizontal", tile("cell-plot-5a"),
                 split("horizontal", tile("cell-plot-5b"), tile("cell-plot-5c")), 34)
    return view(cfg, hier, "S100a9", HSC)


def fig5_a_cells() -> dict:
    """Which cells carry the loss: S100a9 fold change < -0.5 (expected 317 cells, 288 HSC)."""
    fc_title, fc_field = f"{FC}: S100a9", f"layer_{FC}_focused_gene"
    cfg = {
        "cell-table-5t": {
            "id": "cell-table-5t", "title": "Cells with S100a9 fold change < -0.5",
            "columns": [{"type": "obs", "key": "highres_celltype", "column": ""},
                        {"type": "layer", "key": FC, "column": "focused_gene"}],
            "searchBuilderConfig": {"logic": "AND", "criteria": [crit(fc_title, fc_field, "<", "-0.5")]}},
        "cell-plot-5t": umap("cell-plot-5t", "Cells in the table (others grey)", FC, colorScale="RdBu",
                             centeringActive=True, tableFilter="cell-table-5t",
                             removeNonTableEntries=False),
    }
    return view(cfg, split("horizontal", tile("cell-table-5t"), tile("cell-plot-5t"), 45), "S100a9", HSC)


def scatter_5d(color: dict, **kw) -> dict:
    c = {"id": "gene-plot-5d", "title": "d | fold change: locked HSC (x) vs focused cell (y)",
         "x": {"type": "layer", "key": FC, "column": HSC, "locked": True},
         "y": {"type": "layer", "key": FC, "column": MONO, "locked": False},
         "z": None, "color": color, "pointSize": 6, "pointOpacity": 0.9,
         "highlightFocusedGene": True, "showZeroLines": True, "hoverInfo": GENE_HOVER}
    c.update(kw)
    return c


def gene_table_5d(title: str, layer: str, criteria: dict) -> dict:
    return {"id": "gene-table-5d", "title": title,
            "columns": [var("hsc_vs_monocyte_direction"), {"type": "layer", "key": layer, "column": HSC},
                        {"type": "layer", "key": layer, "column": "focused_cell"}],
            "searchBuilderConfig": criteria}


def fig5_d() -> dict:
    """Locked HSC (x) vs focused monocyte (y); the table recounts the opposite-direction DE
    genes from the two layer columns with nested AND/OR logic (expected 61)."""
    de = var_crit("kompot_de_Young_to_Old_mahalanobis", ">", "5.82")
    # Restore keeps only the top-level criteria, not its logic (table-data.js:614), so the
    # OR sits one level down: DE AND ((HSC > 0 AND mono < 0) OR (HSC < 0 AND mono > 0)).
    sb = {"logic": "AND", "criteria": [de, {"logic": "OR", "criteria": [
        {"logic": "AND", "criteria": [layer_crit(FC, HSC, ">", 0), layer_crit(FC, MONO, "<", 0)]},
        {"logic": "AND", "criteria": [layer_crit(FC, HSC, "<", 0), layer_crit(FC, MONO, ">", 0)]}]}]}
    cfg = {
        "gene-plot-5d": scatter_5d(var("hsc_vs_monocyte_direction")),
        "gene-table-5d": gene_table_5d("DE genes changing in opposite directions", FC, sb),
    }
    cfg["gene-table-5d"]["columns"].insert(1, MAH)
    hier = split("horizontal", tile("gene-plot-5d"), tile("gene-table-5d"), 55)
    return view(cfg, hier, "S100a9", MONO)


def fig5_d_noise() -> dict:
    """The same scatter coloured by the focused cell's z-score row; the table keeps DE genes
    beyond 1.96 Kompot s.d. in both cells (expected: Apoe opposite, 10 same direction)."""
    sb = {"logic": "AND", "criteria": [
        var_crit("hsc_vs_monocyte_direction", "!=", "not DE", "string"),
        layer_crit(FC_Z, HSC, "!between", ["-1.96", "1.96"]),
        layer_crit(FC_Z, MONO, "!between", ["-1.96", "1.96"])]}
    cfg = {
        "gene-plot-5d": scatter_5d({"type": "layer", "key": FC_Z, "column": MONO, "locked": False},
                                   colorScale="RdBu", colorMin=-4, colorMax=4, lockColorRange=True,
                                   title="d' | colour = z-score of the focused cell's fold change"),
        "gene-table-5d": gene_table_5d("DE genes beyond 1.96 s.d. in both cells", FC_Z, sb),
    }
    return view(cfg, split("horizontal", tile("gene-plot-5d"), tile("gene-table-5d"), 55), "S100a9", MONO)


ALL_VIEWS = {"gene-by-gene-ab": fig4_ab, "gene-by-gene-c": fig4_c, "gene-by-gene-d": fig4_d,
             "cells-and-genes-abc": fig5_abc, "cells-and-genes-a-cells": fig5_a_cells, "cells-and-genes-d": fig5_d, "cells-and-genes-d-noise": fig5_d_noise}


# --------------------------------------------------------------------------- artefacts
def panelset(name: str, v: dict) -> dict:
    return panelset_file(name, v, DATASET)


def write_artefacts() -> dict:
    VIEWS.mkdir(exist_ok=True)
    PANELSETS.mkdir(parents=True, exist_ok=True)
    views, links = {}, {}
    for name, fn in ALL_VIEWS.items():
        v = views[name] = fn()
        (VIEWS / f"{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        (PANELSETS / f"{name}.json").write_text(json.dumps(panelset(name, v), indent=2) + "\n")
        links[name] = {"dataset": DATASET, "fragment": "#view=" + z1(v)}
        # The link a reader pastes: default local server, store in its data directory.
        (PANELSETS / f"{name}.url.txt").write_text(start_link(DATASET, v) + "\n")
    (PANELSETS / "links-figs45.json").write_text(json.dumps(links, indent=1) + "\n")
    return views


# --------------------------------------------------------------------------- input
def point_xy(page, tid: str, name: str):
    """Screen position of the point named `name` (gene or cell) in tile `tid`."""
    return page.evaluate("""([tid, name]) => {
      const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
      for (const tr of g._fullData) {
        const i = (tr.customdata || []).indexOf(name);
        if (i < 0) continue;
        const L = g._fullLayout, r = g.getBoundingClientRect();
        return {x: r.left + L.xaxis._offset + L.xaxis.l2p(tr.x[i]),
                y: r.top + L.yaxis._offset + L.yaxis.l2p(tr.y[i])};
      }
      return null; }""", [tid, name])


def click_point(s, page, tid: str, name: str, which: str) -> str:
    pos = point_xy(page, tid, name)
    if pos is None:
        raise RuntimeError(f"{name} not in plot {tid}")
    page.mouse.move(pos["x"], pos["y"])
    time.sleep(0.4)
    page.mouse.click(pos["x"], pos["y"])
    time.sleep(0.5)
    s.ready(page)
    return focused(page, which)


def focused(page, which: str) -> str:
    return page.evaluate(f"document.getElementById('focused-{which}').value")


def pick(s, page, which: str, value: str) -> str:
    """Type `value` into the header's Focused Gene / Focused Cell picker and press Enter."""
    box = page.locator(f"#focused-{which}")
    box.click()
    box.fill(value)
    # The picker is a server-side typeahead (static/js/utils/name-picker.js): wait for
    # the matches, then Enter picks the highlighted (first) one and closes the menu.
    page.locator(".name-picker-menu:not([hidden]) .name-picker-option").first.wait_for()
    box.press("Enter")
    time.sleep(0.3)
    # Leave the box: while it keeps keyboard focus, the header does not show a focus
    # change made by clicking a plot (name-picker.js setValue skips a focused input).
    box.press("Escape")
    time.sleep(0.3)
    s.ready(page)
    return focused(page, which)


def show_hover(page) -> None:
    """Undo the hover-hiding stylesheet that Shooter.shot injects."""
    page.evaluate("document.querySelectorAll('style').forEach(e => "
                  "{ if (e.textContent.includes('.hoverlayer')) e.remove(); })")


def hover_shot(s, page, tid: str, name: str, png: str) -> None:
    """Tile screenshot with Plotly's own hover label on one point (what a user sees)."""
    show_hover(page)
    pos = point_xy(page, tid, name)
    if pos is None:
        raise RuntimeError(f"{name} not in plot {tid}")
    page.add_style_tag(content="#notification-container, .notification, .modebar-container"
                               " { display: none !important; }")
    page.mouse.move(pos["x"] + 2, pos["y"] + 2)
    page.mouse.move(pos["x"], pos["y"])
    time.sleep(0.8)
    label = page.evaluate("() => [...document.querySelectorAll('.hoverlayer .hovertext')]"
                          ".map(e => e.textContent).join(' | ')")
    s.log.append(f"{png}: hover '{label}'")
    page.locator(f'.tile[data-tile-id="{tid}"] .tile-content').screenshot(path=str(OUT / f"{png}.png"))
    page.mouse.move(2, 2)


def toggle_controls(s, page, tid: str) -> None:
    page.locator(f'.tile[data-tile-id="{tid}"] .tile-toggle-controls').click()
    time.sleep(0.8)
    s.ready(page)


def traces(page, tid: str) -> str:
    return page.evaluate("""(tid) => {
      const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
      return g._fullData.map(t => `${t.name}:${t.x.length}`).join(', '); }""", tid)


def table_info(page, tid: str) -> str:
    return page.evaluate("""(tid) => [...document.querySelectorAll(
        `.tile[data-tile-id="${tid}"] .dt-info, .tile[data-tile-id="${tid}"] .dataTables_info`)]
        .map(e => e.textContent.trim()).join(' / ')""", tid)


def table_rows(page, tid: str, n=12) -> list:
    return page.evaluate("""([tid, n]) => [...document.querySelectorAll(
        `.tile[data-tile-id="${tid}"] tbody tr`)]
        .slice(0, n).map(r => r.innerText.replace(/\\s*\\t\\s*/g, ' | '))""", [tid, n])


def shrink(paths) -> None:
    """Quantize PNGs above ~400 KB."""
    from PIL import Image
    for p in paths:
        p = Path(p)
        if p.exists() and p.stat().st_size > 400_000:
            Image.open(p).convert("RGB").quantize(256).save(p, optimize=True)


# --------------------------------------------------------------------------- shoots
# A plot in a single-tile layout keeps Plotly's default 450 px height however tall the
# tile is, so single-tile views use a window just tall enough for that.
SINGLE = {"width": 1000, "height": 700}

def shoot_4ab(s, views) -> None:
    page = s.open(views["gene-by-gene-ab"] | {"constants": views["gene-by-gene-ab"]["constants"] | {"focusedGene": "S100a9"}},
                  dataset=DATASET, viewport=SINGLE)
    got = pick(s, page, "gene", "H2-Q7")
    s.log.append(f"4a picked H2-Q7 -> {got}; traces {traces(page, 'gene-plot-4a')}")
    page.locator("#app-header").screenshot(path=str(OUT / "fig4a-header.png"))
    s.shot(page, "fig4a-page", {"gene-plot-4a": "fig4a-volcano-h2q7"})
    hover_shot(s, page, "gene-plot-4a", "H2-Q6", "fig4a-hover-h2q6")
    got = click_point(s, page, "gene-plot-4a", "H2-Aa", "gene")
    s.log.append(f"4b clicked H2-Aa -> {got}; traces {traces(page, 'gene-plot-4a')}")
    s.shot(page, "fig4b-page", {"gene-plot-4a": "fig4b-volcano-h2aa"})
    hover_shot(s, page, "gene-plot-4a", "H2-Ab1", "fig4b-hover-h2ab1")
    page.context.close()


def shoot_4c(s, views) -> None:
    page = s.open(views["gene-by-gene-c"], dataset=DATASET, viewport={"width": 1600, "height": 1000})
    s.log.append(f"4c table {table_info(page, 'gene-table-4c')}")
    s.log.append(f"4c strips {traces(page, 'gene-plot-4c1')} / {traces(page, 'gene-plot-4c2')}")
    s.log.append(f"4c rows {table_rows(page, 'gene-table-4c', 5)}")
    s.shot(page, "fig4c-page", {"gene-plot-4c1": "fig4c-strip-h2q7", "gene-plot-4c2": "fig4c-strip-s100a9",
                                "gene-table-4c": "fig4c-table"})
    hover_shot(s, page, "gene-plot-4c2", "Camp", "fig4c-hover-camp")
    page.context.close()


def shoot_4d(s, views) -> None:
    page = s.open(views["gene-by-gene-d"], dataset=DATASET, viewport=SINGLE | {"width": 1250})
    s.log.append(f"4d traces {traces(page, 'gene-plot-4d')}")
    s.shot(page, "fig4d-page", {"gene-plot-4d": "fig4d-plot"})
    hover_shot(s, page, "gene-plot-4d", "H2-K1", "fig4d-hover-h2k1")
    hover_shot(s, page, "gene-plot-4d", "H2-Q6", "fig4d-hover-h2q6")
    page.set_viewport_size({"width": 1250, "height": 1100})
    toggle_controls(s, page, "gene-plot-4d")
    page.locator('.tile[data-tile-id="gene-plot-4d"] .plot-controls').screenshot(
        path=str(OUT / "fig4d-controls.png"))
    page.context.close()


def shoot_5abc(s, views) -> None:
    page = s.open(views["cells-and-genes-abc"], dataset=DATASET, viewport={"width": 1600, "height": 640})
    s.shot(page, "fig5abc-page", {"cell-plot-5a": "fig5a-fc", "cell-plot-5b": "fig5b-young",
                                  "cell-plot-5c": "fig5c-old"})
    page.context.close()
    # The colour controls of panel b, open, in a tall window so the plot keeps its size.
    page = s.open(views["cells-and-genes-abc"], dataset=DATASET, viewport={"width": 1600, "height": 1300})
    toggle_controls(s, page, "cell-plot-5b")
    page.locator('.tile[data-tile-id="cell-plot-5b"] .color-range-controls').screenshot(
        path=str(OUT / "fig5b-range-controls.png"))
    page.context.close()


def only(v: dict, tid: str) -> dict:
    """The same view with one tile, so a tall neighbour does not stretch the plot."""
    lay = v["layout"]
    return v | {"layout": lay | {"hierarchy": [tile(tid)], "controlState": {tid: False},
                                 "panelConfigs": {tid: lay["panelConfigs"][tid]}}}


def shoot_5a_cells(s, views) -> None:
    page = s.open(views["cells-and-genes-a-cells"], dataset=DATASET, viewport={"width": 1600, "height": 900})
    info = table_info(page, "cell-table-5t")
    page.locator('.tile[data-tile-id="cell-table-5t"] .dtsb-searchBuilder, '
                 '.tile[data-tile-id="cell-table-5t"] .dtsb-group').first.wait_for()
    s.log.append(f"5a cells table {info}; traces {traces(page, 'cell-plot-5t')}")
    s.shot(page, "fig5a-cells-page", {"cell-table-5t": "fig5a-cells-table", "cell-plot-5t": "fig5a-cells-umap"})
    page.context.close()
    # Check of the guide's second step (no screenshot): AND cell type = HSC, expected 288.
    v = json.loads(json.dumps(views["cells-and-genes-a-cells"]))
    v["layout"]["panelConfigs"]["cell-table-5t"]["searchBuilderConfig"]["criteria"].append(
        crit("highres_celltype", "obs_highres_celltype_main", "=", "HSC", "string"))
    page = s.open(v, dataset=DATASET, viewport={"width": 1600, "height": 900})
    s.log.append(f"5a cells AND HSC: {table_info(page, 'cell-table-5t')}")
    page.context.close()


def shoot_5d(s, views) -> None:
    page = s.open(views["cells-and-genes-d"], dataset=DATASET, viewport={"width": 1600, "height": 1000})
    s.log.append(f"5d table {table_info(page, 'gene-table-5d')}; rows {table_rows(page, 'gene-table-5d', 3)}; "
                 f"traces {traces(page, 'gene-plot-5d')}")
    s.shot(page, "fig5d-page", {"gene-table-5d": "fig5d-table"})
    page.context.close()
    page = s.open(only(views["cells-and-genes-d"], "gene-plot-5d"), dataset=DATASET,
                  viewport=SINGLE | {"width": 1100})
    s.shot(page, "fig5d-plot-page", {"gene-plot-5d": "fig5d-plot"})
    hover_shot(s, page, "gene-plot-5d", "Apoe", "fig5d-hover-apoe")
    page.set_viewport_size({"width": 1100, "height": 1100})
    toggle_controls(s, page, "gene-plot-5d")
    page.locator('.tile[data-tile-id="gene-plot-5d"] .plot-controls').screenshot(
        path=str(OUT / "fig5d-controls.png"))
    page.context.close()

    page = s.open(views["cells-and-genes-d-noise"], dataset=DATASET, viewport={"width": 1600, "height": 900})
    s.log.append(f"5d noise table {table_info(page, 'gene-table-5d')}; rows {table_rows(page, 'gene-table-5d')}")
    s.shot(page, "fig5d-noise-page", {"gene-plot-5d": "fig5d-noise-plot", "gene-table-5d": "fig5d-noise-table"})
    page.context.close()


# The PNGs the two pages use. Shooter.shot also writes a full-page capture for every call;
# the rest are removed after a full run so the repository only carries what is shown.
USED = {"fig4a-header", "fig4a-volcano-h2q7", "fig4a-hover-h2q6", "fig4b-volcano-h2aa",
        "fig4b-hover-h2ab1", "fig4c-page", "fig4c-hover-camp", "fig4d-controls", "fig4d-plot",
        "fig4d-hover-h2k1", "fig5a-fc", "fig5a-cells-page", "fig5b-range-controls", "fig5abc-page",
        "fig5d-controls", "fig5d-plot", "fig5d-hover-apoe", "fig5d-table", "fig5d-noise-page"}

SHOOTS = {"4ab": shoot_4ab, "4c": shoot_4c, "4d": shoot_4d, "5abc": shoot_5abc, "5acells": shoot_5a_cells, "5d": shoot_5d}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8815)
    ap.add_argument("--only", nargs="*", choices=list(SHOOTS))
    a = ap.parse_args()
    views = write_artefacts()
    with Session(a.port, OUT) as s:
        for key, fn in SHOOTS.items():
            if a.only is None or key in a.only:
                fn(s, views)
    if a.only is None:
        for p in OUT.glob("fig[45]*.png"):
            if p.stem not in USED:
                p.unlink()
    shrink(OUT.glob("fig[45]*.png"))
    (OUT.parent / f".server-{a.port}.log").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
