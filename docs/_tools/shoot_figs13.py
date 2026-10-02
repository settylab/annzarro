"""Screenshots, views and panel sets for the paper-figure guides 1 (focus model),
2 (interface) and 3 (cell by cell).

Every capture follows real user input where the guide describes a click: points are clicked
in the Plotly graph, the header pickers are typed into, lock buttons are pressed. Cell IDs
and views follow figures/screenshots.py and figures/fig2_cell_by_cell.py in
settylab/annzarro-paper, so the guides match the paper.

Writes
  docs/_static/screens/paper/fig{1,2,3}-*.png     screenshots
  docs/_tools/views/fig{1,2,3}-*.json              deep-link `view` objects
  docs/_static/panelsets/paper/fig{1,2,3}-*.json   panel sets for Load Panel Set > Upload file
  docs/_static/panelsets/paper/fig{1,2,3}-*.url.txt  share links with a placeholder data directory
  docs/_static/panelsets/paper/links-figs13.json     compressed `#view=z1.` fragments per view

Run: .venv-docs/bin/python docs/_tools/shoot_figs13.py [--port 8814] [--only fig1 fig2 fig3 check]
Fig 3 needs data/bm_aging_showcase.zarr (obsp umap_distance, diffusion_distance;
obs fig3_plasma_groups).
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session, split, tile  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "paper"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "paper"

HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"          # example HSC (examples.json)
MONO = "Mature_Young_2#TCAATTCAGTGAGGCT-1"     # example monocyte (examples.json)
LMPP = "HSPC_Old_2#ACTCTCGCAAACCGGA-1"         # 1/3 of the HSC -> monocyte path (fig2.json)
GMP = "HSPC_Old_3#ATTTCACTCGTAGTGT-1"          # 2/3 of the path (fig2.json)
PLASMA = "Mature_Mid_1#GCCATGGAGTATGATG-1"     # Fig 3b/c focus (fig2.json focus_bc)
# Four-click sequence of paper Fig 2b (SCREENSHOTS.md): cells that a click lands on.
CLICKS = [("GMP", "HSPC_Old_3#GGGTATTAGGCCGCTT-1"),
          ("cMoP", "Mature_Young_1#CAAGGGATCCCGTAAA-1"),
          ("Monocyte", "Mature_Young_1#CAACCAAGTATACCCA-1")]

FC = "kompot_de_Young_to_Old_fold_change"
WALK = "diffusion_walk_t5"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
VOLCANO_X = {"type": "var", "key": "kompot_de_Young_to_Old_mean_lfc", "column": ""}
VOLCANO_Y = {"type": "var", "key": "kompot_de_Young_to_Old_mahalanobis", "column": ""}
CELL_HOVER = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "highres_celltype"}]
GENE_HOVER = [{"type": "var", "key": "_index"}]
CELLTYPE = {"type": "obs", "key": "highres_celltype", "column": ""}
SHOWCASE = "bm_aging_showcase.zarr"


# --------------------------------------------------------------------------- views
def cell_plot(tid, title, color, x=UMAP_X, y=UMAP_Y, **kw):
    return {"id": tid, "title": title, "x": x, "y": y, "z": None, "color": color,
            "pointSize": 3, "pointOpacity": 0.8, "highlightFocusedCell": True,
            "hoverInfo": CELL_HOVER, **kw}


def gene_plot(tid, title, color, x=VOLCANO_X, y=VOLCANO_Y, **kw):
    return {"id": tid, "title": title, "x": x, "y": y, "z": None, "color": color,
            "pointSize": 5, "pointOpacity": 0.8, "highlightFocusedGene": True,
            "hoverInfo": GENE_HOVER, **kw}


def walk_color(cell=HSC):
    return {"type": "obsp", "key": WALK, "column": cell, "locked": False}


# Reversed Blues, as in the paper: a zero-probability cell is light grey, not white.
WALK_STYLE = {"colorScale": "Blues", "colorReversed": True}


def view(cfgs: dict, hierarchy: dict, cell=HSC, gene="H2-Q7") -> dict:
    return {"v": 1,
            "constants": {"focusedCell": cell, "focusedGene": gene, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [hierarchy],
                       "controlState": {k: False for k in cfgs}, "panelConfigs": cfgs}}


def fig1_view() -> dict:
    """2 x 2: columns = cell scatter | gene scatter, rows = driven by the focused cell |
    by the focused gene. Each panel is one arrow of the paper's Fig 1."""
    cfgs = {
        "cell-plot-F1a": cell_plot("cell-plot-F1a", "Cell scatter | focused cell's row of obsp/diffusion_walk_t5",
                                   walk_color(), **WALK_STYLE),
        "gene-plot-F1b": gene_plot("gene-plot-F1b", "Gene scatter | focused cell's row of the fold-change layer",
                                   {"type": "layer", "key": FC, "column": HSC, "locked": False},
                                   colorScale="RdBu", centeringActive=True),
        "cell-plot-F1c": cell_plot("cell-plot-F1c", "Cell scatter | focused gene's column of the fold-change layer",
                                   {"type": "layer", "key": FC, "column": "H2-Q7", "locked": False},
                                   colorScale="RdBu", centeringActive=True),
        "gene-plot-F1d": gene_plot("gene-plot-F1d", "Gene scatter | focused gene's row of varp/spearman_fold_change",
                                   {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7",
                                    "locked": False},
                                   colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
    }
    h = split("horizontal",
              split("vertical", tile("cell-plot-F1a"), tile("cell-plot-F1c")),
              split("vertical", tile("gene-plot-F1b"), tile("gene-plot-F1d")))
    return view(cfgs, h)


def fig2_overview_view() -> dict:
    """Paper Fig 2a (figures/screenshots.py overview_view)."""
    cfgs = {
        "cell-plot-O1": cell_plot("cell-plot-O1", "5-step diffusion walk from the focused cell",
                                  walk_color(), **WALK_STYLE),
        "gene-plot-O2": gene_plot("gene-plot-O2",
                                  "Kompot volcano, colour = Spearman (fold change) to focused gene",
                                  {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7",
                                   "locked": False},
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
        "cell-plot-O3": cell_plot("cell-plot-O3", "Fold change (Young to Old) of the focused gene",
                                  {"type": "layer", "key": FC, "column": "H2-Q7", "locked": False},
                                  colorScale="RdBu", centeringActive=True),
        "cell-table-O4": {
            "id": "cell-table-O4", "title": "Cells filtered by cell type (HSC)",
            "columns": [CELLTYPE, {"type": "obs", "key": "Age", "column": ""},
                        {"type": "obs", "key": "kompot_da_Young_to_Old_lfc_zscore", "column": ""}],
            "searchBuilderConfig": {
                "criteria": [{"condition": "=", "data": "highres_celltype",
                              "origData": "obs_highres_celltype_main", "type": "string",
                              "value": ["HSC"]}],
                "logic": "AND"},
        },
    }
    h = split("horizontal",
              split("vertical", tile("cell-plot-O1"), tile("cell-plot-O3")),
              split("vertical", tile("gene-plot-O2"), tile("cell-table-O4"), 45))
    return view(cfgs, h)


def fig2_focus_view() -> dict:
    """Paper Fig 2b (figures/screenshots.py focus_view)."""
    cfgs = {
        "cell-plot-F1": cell_plot("cell-plot-F1", "5-step diffusion walk from the focused cell",
                                  walk_color(), **WALK_STYLE),
        "cell-plot-F2": cell_plot("cell-plot-F2", "Cell types (focused cell highlighted)", CELLTYPE),
    }
    return view(cfgs, split("horizontal", tile("cell-plot-F1"), tile("cell-plot-F2")), gene="S100a9")


def fig2_filter_view() -> dict:
    """Paper Fig 2c (data_prep/demo_panelsets/E_table_filter.view.json)."""
    cfgs = {
        "cell-table-E1": {
            "id": "cell-table-E1", "title": "HSC with DA z-score > 2",
            "columns": [CELLTYPE, {"type": "obs", "key": "kompot_da_Young_to_Old_lfc_zscore", "column": ""},
                        {"type": "obs", "key": "Age", "column": ""}],
            "searchBuilderConfig": {
                "criteria": [
                    {"condition": "=", "data": "highres_celltype", "origData": "obs_highres_celltype_main",
                     "type": "string", "value": ["HSC"]},
                    {"condition": ">", "data": "kompot_da_Young_to_Old_lfc_zscore",
                     "origData": "obs_kompot_da_Young_to_Old_lfc_zscore_main", "type": "num",
                     "value": ["2"]}],
                "logic": "AND"},
        },
        "cell-plot-E2": cell_plot("cell-plot-E2", "UMAP masked by the table filter",
                                  {"type": "obs", "key": "kompot_da_Young_to_Old_lfc_zscore", "column": ""},
                                  colorScale="RdBu", centeringActive=True,
                                  tableFilter="cell-table-E1", hideNonSubset=False),
    }
    return view(cfgs, split("horizontal", tile("cell-table-E1"), tile("cell-plot-E2"), 45), gene="S100a9")


def fig3a_view() -> dict:
    """Showcase store: one walk panel beside a table of the 13 cells on the HSC -> monocyte
    path; clicking a cell ID in the table moves the focus along the path."""
    cfgs = {
        "cell-plot-W1": cell_plot("cell-plot-W1", "5-step diffusion walk from the focused cell",
                                  walk_color(), **WALK_STYLE),
        "cell-table-W2": {
            "id": "cell-table-W2", "title": "Cells on the HSC to monocyte diffusion path",
            "columns": [{"type": "obs", "key": "fig3a_path_step", "column": ""},
                        {"type": "obs", "key": "fig3a_focus_cells", "column": ""}, CELLTYPE],
            "searchBuilderConfig": {
                "criteria": [{"condition": "!=", "data": "fig3a_focus_cells",
                              "origData": "obs_fig3a_focus_cells_main", "type": "string",
                              "value": ["not on path"]}],
                "logic": "AND"},
        },
    }
    return view(cfgs, split("horizontal", tile("cell-plot-W1"), tile("cell-table-W2"), 55), gene="S100a9")


def fig3bc_view() -> dict:
    """Showcase store: rows of obsp/umap_distance and obsp/diffusion_distance as the axes
    (Fig 3b), and the plasma cell's discordant groups on the UMAP (Fig 3c)."""
    groups = {"type": "obs", "key": "fig3_plasma_groups", "column": ""}
    cfgs = {
        "cell-plot-D1": cell_plot(
            "cell-plot-D1", "UMAP distance (x) vs diffusion distance (y) to the focused cell",
            groups,
            x={"type": "obsp", "key": "umap_distance", "column": PLASMA, "locked": False},
            y={"type": "obsp", "key": "diffusion_distance", "column": PLASMA, "locked": False}),
        "cell-plot-D2": cell_plot("cell-plot-D2", "The same groups on the UMAP", groups),
    }
    return view(cfgs, split("horizontal", tile("cell-plot-D1"), tile("cell-plot-D2")),
                cell=PLASMA, gene="S100a9")


# --------------------------------------------------------------------------- artefacts
def z1(v: dict) -> str:
    """The app's compressed fragment: z1.<base64url(deflate-raw(JSON))>."""
    raw = json.dumps(v, separators=(",", ":"), ensure_ascii=False).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return "z1." + base64.urlsafe_b64encode(c.compress(raw) + c.flush()).decode().rstrip("=")


def panelset(name: str, v: dict, dataset: str) -> dict:
    """A panel set file as Save Panel Set writes it. Loading one re-registers the panels
    (Add New Panel > Duplicate or Reopen Panel); it does not restore focus or layout."""
    cfgs = v["layout"]["panelConfigs"]
    return {"name": name, "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": dataset, "datasetName": Path(dataset).stem, "constants": v["constants"],
            "panelConfigs": {k: {"id": k, "type": k.rsplit("-", 1)[0], "title": c["title"],
                                 "config": c, "isSelectionTile": False} for k, c in cfgs.items()}}


ALL_VIEWS = {
    "fig1-focus-model": (fig1_view, "bm_aging.zarr"),
    "fig2-overview": (fig2_overview_view, "bm_aging.zarr"),
    "fig2-focus-sequence": (fig2_focus_view, "bm_aging.zarr"),
    "fig2-table-filter": (fig2_filter_view, "bm_aging.zarr"),
    "fig3-walk": (fig3a_view, SHOWCASE),
    "fig3-umap-vs-diffusion": (fig3bc_view, SHOWCASE),
}


def write_artefacts() -> None:
    VIEWS.mkdir(exist_ok=True)
    PANELSETS.mkdir(parents=True, exist_ok=True)
    links = {}
    for name, (fn, ds) in ALL_VIEWS.items():
        v = fn()
        (VIEWS / f"{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        (PANELSETS / f"{name}.json").write_text(json.dumps(panelset(name, v, ds), indent=2) + "\n")
        links[name] = {"dataset": ds, "fragment": "#view=" + z1(v)}
        (PANELSETS / f"{name}.url.txt").write_text(
            f"http://127.0.0.1:8000/?dataset_path=/path/to/annzarro-data/{ds}#view={z1(v)}\n")
    (PANELSETS / "links-figs13.json").write_text(json.dumps(links, indent=1) + "\n")


# --------------------------------------------------------------------------- input
def click_point(page, tid: str, name: str) -> None:
    """Click the point `name` (cell or gene) in the Plotly graph of tile `tid`."""
    pos = page.evaluate("""([tid, name]) => {
      const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
      const tr = g._fullData[0], i = tr.customdata.indexOf(name);
      if (i < 0) return null;
      const L = g._fullLayout, xa = L.xaxis, ya = L.yaxis, r = g.getBoundingClientRect();
      return {x: r.left + xa._offset + xa.l2p(tr.x[i]), y: r.top + ya._offset + ya.l2p(tr.y[i])};
    }""", [tid, name])
    if pos is None:
        raise RuntimeError(f"{name} not in plot {tid}")
    page.mouse.move(pos["x"], pos["y"])
    time.sleep(0.4)
    page.mouse.click(pos["x"], pos["y"])
    time.sleep(0.5)


def focused(page, which="cell") -> str:
    return page.evaluate(f"document.getElementById('focused-{which}').value")


def pick(page, which: str, value: str) -> str:
    """Type `value` into the header's Focused Cell / Focused Gene picker and press Enter."""
    page.click(f"#focused-{which} + .select2 .select2-selection")
    field = page.locator(".select2-container--open .select2-search__field")
    field.fill(value)
    time.sleep(0.6)
    field.press("Enter")
    time.sleep(0.3)
    page.keyboard.press("Escape")
    time.sleep(0.5)
    return focused(page, which)


def toggle_controls(page, tid: str) -> None:
    page.locator(f'.tile[data-tile-id="{tid}"] .tile-toggle-controls').click()
    time.sleep(0.8)


def press_lock(page, tid: str, axis: str = "color") -> str:
    """Press the lock button of one axis selector (the controls must be open)."""
    btn = page.locator(f'.tile[data-tile-id="{tid}"] .axis-special-buttons-{axis} [id="lock-{axis}"]')
    btn.click()
    time.sleep(0.6)
    return btn.get_attribute("title")


def crop(page, selector: str, path: Path) -> None:
    page.locator(selector).screenshot(path=str(path))


def shrink(paths) -> None:
    """Quantize PNGs above ~400 KB."""
    from PIL import Image
    for p in paths:
        p = Path(p)
        if p.exists() and p.stat().st_size > 400_000:
            Image.open(p).convert("RGB").quantize(256).save(p, optimize=True)


# --------------------------------------------------------------------------- shoots
def shoot_fig1(s) -> None:
    v = fig1_view()
    page = s.open(v)
    s.shot(page, "fig1-1-start")

    # Click a monocyte in the walk panel: the two panels driven by the focused cell follow.
    for cell in [MONO, CLICKS[2][1]]:
        click_point(page, "cell-plot-F1a", cell)
        s.ready(page)
        if focused(page) == cell:
            break
    s.log.append(f"fig1 cell click -> {focused(page)}")
    s.shot(page, "fig1-2-cell-click")

    # Click H2-Aa in the varp volcano: the two panels driven by the focused gene follow.
    click_point(page, "gene-plot-F1d", "H2-Aa")
    s.ready(page)
    s.log.append(f"fig1 gene click -> {focused(page, 'gene')}")
    s.shot(page, "fig1-3-gene-click")

    # Lock the walk panel's colour on the monocyte, then focus the HSC from the header.
    toggle_controls(page, "cell-plot-F1a")
    s.log.append(f"fig1 lock: {press_lock(page, 'cell-plot-F1a')}")
    crop(page, '.tile[data-tile-id="cell-plot-F1a"] .color-selector-container .axis-selector',
         OUT / "fig1-4-lock-button.png")
    toggle_controls(page, "cell-plot-F1a")
    s.ready(page)
    s.log.append(f"fig1 header pick -> {pick(page, 'cell', HSC)}")
    s.ready(page)
    s.shot(page, "fig1-4-locked")
    page.context.close()

    # The Color selector of the walk panel, for the step that sets it up.
    one = view({"cell-plot-F1a": v["layout"]["panelConfigs"]["cell-plot-F1a"]}, tile("cell-plot-F1a"))
    page = s.open(one, viewport={"width": 1100, "height": 900})
    toggle_controls(page, "cell-plot-F1a")
    s.ready(page)
    crop(page, '.tile[data-tile-id="cell-plot-F1a"] .plot-controls', OUT / "fig1-controls-walk.png")
    page.context.close()
    one = view({"gene-plot-F1d": v["layout"]["panelConfigs"]["gene-plot-F1d"]}, tile("gene-plot-F1d"))
    page = s.open(one, viewport={"width": 1100, "height": 900})
    toggle_controls(page, "gene-plot-F1d")
    s.ready(page)
    crop(page, '.tile[data-tile-id="gene-plot-F1d"] .plot-controls', OUT / "fig1-controls-varp.png")
    page.context.close()


def shoot_fig2(s) -> None:
    page = s.open(fig2_overview_view())
    s.shot(page, "fig2-a-overview")
    page.context.close()

    page = s.open(fig2_focus_view())
    page.add_style_tag(content=".modebar-container { display: none !important; }")
    crop(page, '.tile[data-tile-id="cell-plot-F1"] .tile-content', OUT / "fig2-b-1-HSC.png")
    for k, (ct, cell) in enumerate(CLICKS, 2):
        click_point(page, "cell-plot-F1", cell)
        s.ready(page)
        s.log.append(f"fig2 click {k} {ct}: {cell} -> {focused(page)}")
        page.mouse.move(2, 2)
        crop(page, '.tile[data-tile-id="cell-plot-F1"] .tile-content', OUT / f"fig2-b-{k}-{ct}.png")
    page.context.close()

    page = s.open(fig2_filter_view())
    info = page.evaluate("""() => [...document.querySelectorAll('.dataTables_info, .dt-info')]
                            .map(e => e.textContent.trim()).join(' / ')""")
    n = page.evaluate("""() => {
      const g = document.querySelector('.tile[data-tile-id="cell-plot-E2"] .js-plotly-plot');
      return g._fullData.map(t => (t.name || '') + ':' + t.x.length); }""")
    s.log.append(f"fig2 filter table: {info}; plot traces: {n}")
    s.shot(page, "fig2-c-filter")

    # Save Panel Set dialog, then Share Link with the clipboard denied (shows the field).
    page.click("#btn-save-session")
    page.wait_for_selector("#session-name", state="visible")
    page.fill("#session-name", "fig2-table-filter")
    time.sleep(0.6)
    crop(page, "#session-modal .modal-content", OUT / "fig2-save-panel-set.png")
    page.keyboard.press("Escape")
    time.sleep(0.6)
    page.context.close()

    # The table's own controls (column chooser) above its Advanced Search.
    cfg = fig2_filter_view()["layout"]["panelConfigs"]["cell-table-E1"]
    page = s.open(view({"cell-table-E1": cfg}, tile("cell-table-E1"), gene="S100a9"),
                  viewport={"width": 1100, "height": 1000})
    toggle_controls(page, "cell-table-E1")
    s.ready(page)
    page.mouse.move(2, 2)
    crop(page, '.tile[data-tile-id="cell-table-E1"] .tile-content', OUT / "fig2-table-controls.png")
    page.context.close()

    page = s.open(fig2_filter_view(), clipboard_denied=True)
    page.click("#btn-share-link")
    page.wait_for_selector("#share-link-fallback:not([hidden])", timeout=10000)
    link = page.input_value("#share-link-field")
    s.log.append(f"fig2 share link ({len(link)} chars): {link[:100]}...")
    page.evaluate("document.getElementById('share-link-field').scrollLeft = 0")
    page.mouse.move(2, 2)
    time.sleep(0.3)
    crop(page, "#app-header", OUT / "fig2-share-link.png")

    page.click("#btn-load-session")
    page.wait_for_selector("#session-modal", state="visible")
    time.sleep(1.0)
    crop(page, "#session-modal .modal-content", OUT / "fig2-load-panel-set.png")
    # Upload the Fig 1 panel set file, load it, and open Add New Panel to show where its
    # panels land. The uploaded set is deleted again so the shared list stays clean.
    page.click("#toggle-upload-btn")
    page.set_input_files("#session-file-upload", str(PANELSETS / "fig1-focus-model.json"))
    time.sleep(0.5)
    crop(page, "#session-modal .modal-content", OUT / "fig2-upload-panel-set.png")
    page.click("#btn-confirm-session")
    time.sleep(3)
    s.toasts(page, "fig2 upload")
    try:
        page.locator('.tile[data-tile-id="cell-plot-E2"] .tile-split-v').click()
        time.sleep(2)
        page.add_style_tag(content="#notification-container, .notification { display: none !important; }")
        page.locator(".selection-section", has_text="Duplicate or Reopen Panel").last.screenshot(
            path=str(OUT / "fig2-reopen-panels.png"))
    finally:
        s.log.append("fig2 delete uploaded set: " + str(page.evaluate(
            "fetch('/api/v1/sessions/delete?name=fig1-focus-model', {method: 'DELETE'}).then(r => r.status)")))
    page.context.close()


def click_entity(page, tid: str, name: str) -> None:
    """Click the cell (or gene) ID link in a table tile, which focuses it."""
    page.locator(f'.tile[data-tile-id="{tid}"] .entity-index-value[data-entity="{name}"]').click()
    time.sleep(0.6)


def check_view(criteria: list, logic="AND") -> dict:
    """A lone cell table whose Advanced Search holds `criteria`, for counting rows."""
    cfg = {"id": "cell-table-K1", "title": "check",
           "columns": [CELLTYPE, {"type": "obs", "key": "fig3_plasma_groups", "column": ""}],
           "searchBuilderConfig": {"criteria": [
               {"condition": "=", "data": k, "origData": f"obs_{k}_main", "type": "string",
                "value": [v]} for k, v in criteria], "logic": logic}}
    return view({"cell-table-K1": cfg}, tile("cell-table-K1"), cell=PLASMA, gene="S100a9")


FIG3_CHECKS = [
    [("fig3_plasma_groups", "near in UMAP, far in diffusion")],
    [("fig3_plasma_groups", "far in UMAP, near in diffusion")],
    [("fig3_plasma_groups", "near in UMAP, far in diffusion"), ("highres_celltype", "pDC")],
    [("fig3_plasma_groups", "near in UMAP, far in diffusion"), ("highres_celltype", "NK")],
    [("fig3_plasma_groups", "far in UMAP, near in diffusion"), ("highres_celltype", "Mature Naive B cell")],
    [("fig3_plasma_groups", "far in UMAP, near in diffusion"), ("highres_celltype", "Memory B cell")],
]


def check_fig3(s) -> None:
    """Table-filter counts quoted in the cell-similarity tutorial, read from the app."""
    for crit in FIG3_CHECKS:
        page = s.open(check_view(crit), dataset=SHOWCASE, viewport={"width": 1100, "height": 900})
        info = page.evaluate("""() => [...document.querySelectorAll('.dataTables_info, .dt-info')]
                                .map(e => e.textContent.trim()).join(' / ')""")
        s.log.append(f"fig3 check {crit}: {info}")
        page.context.close()


def shoot_fig3(s, showcase: bool) -> None:
    if not showcase:
        s.log.append("fig3 skipped: showcase store not ready")
        return
    page = s.open(fig3a_view(), dataset=SHOWCASE)
    page.locator('.tile[data-tile-id="cell-table-W2"] th', has_text="fig3a_path_step").first.click()
    s.ready(page)
    s.log.append("fig3a table: " + page.evaluate("""() => [...document.querySelectorAll(
        '.dataTables_info, .dt-info')].map(e => e.textContent.trim()).join(' / ')"""))
    for k, (ct, cell) in enumerate([("HSC", HSC), ("LMPP", LMPP), ("GMP", GMP), ("Monocyte", MONO)], 1):
        if k > 1:
            click_entity(page, "cell-table-W2", cell)
            s.ready(page)
            s.log.append(f"fig3a {ct}: clicked {cell} -> {focused(page)}")
        if k == 1:
            s.shot(page, "fig3-a-page")
        page.add_style_tag(content=".modebar-container { display: none !important; }")
        page.mouse.move(2, 2)
        crop(page, '.tile[data-tile-id="cell-plot-W1"] .tile-content', OUT / f"fig3-a-{k}-{ct}.png")
    page.context.close()

    page = s.open(fig3bc_view(), dataset=SHOWCASE)
    n = page.evaluate("""() => [...document.querySelectorAll('.tile .js-plotly-plot')].map(g =>
        g._fullData.map(t => (t.name || '') + ':' + (t.x ? t.x.length : 0)).join(', '))""")
    s.log.append(f"fig3bc traces: {n}")
    s.shot(page, "fig3-bc")
    page.context.close()
    one = view({"cell-plot-D1": fig3bc_view()["layout"]["panelConfigs"]["cell-plot-D1"]},
               tile("cell-plot-D1"), cell=PLASMA)
    page = s.open(one, dataset=SHOWCASE, viewport={"width": 1100, "height": 900})
    toggle_controls(page, "cell-plot-D1")
    s.ready(page)
    crop(page, '.tile[data-tile-id="cell-plot-D1"] .plot-controls', OUT / "fig3-controls-axes.png")
    page.context.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8814)
    ap.add_argument("--only", nargs="*", default=["fig1", "fig2", "fig3"])
    a = ap.parse_args()
    write_artefacts()
    showcase = (Path.home() / "gits/annzarro-paper/data/bm_aging_showcase.READY").exists()
    with Session(a.port, OUT) as s:
        if "fig1" in a.only:
            shoot_fig1(s)
        if "fig2" in a.only:
            shoot_fig2(s)
        if "fig3" in a.only:
            shoot_fig3(s, showcase)
        if "check" in a.only and showcase:
            check_fig3(s)
    shrink(p for p in OUT.glob("fig[123]-*.png"))
