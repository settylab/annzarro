"""Screenshots and views for the User guide (docs/user-guide/*.md).

Every capture follows real user input where the guide describes a click: tiles are split with
their own buttons, points are clicked in the Plotly graph, lock buttons are pressed, table
conditions are built in the SearchBuilder, the dataset field is typed into.

Writes
  docs/_static/screens/user-guide/*.png     screenshots (annotated ones carry numbered callouts)
  docs/_tools/views/userguide-*.json        deep-link `view` objects used below

Run:
  .venv-docs/bin/python docs/_tools/shoot_userguide.py [--port 8817] [--only interface focus ...]

Data: bm_aging.zarr, bm_aging_showcase.zarr and spatial_demo.zarr in ANNZARRO_DOCS_DATA
(default ~/gits/annzarro-paper/data). The script serves them from a temporary data directory
of symlinks, so panel sets it saves for the screenshots never reach the shared sessions folder.

The remote-dataset shots need fsspec + aiohttp (pip install 'annzarro[remote]'). Pass
--remote-python with an interpreter that has them; the script then serves the data directory
over plain HTTP on port+10 and starts that interpreter's annzarro with
ANNZARRO_REMOTE_ALLOWLIST=http://127.0.0.1:<port+10>/. Without it the remote shots are skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import (DATA_DIR, DSF, Session, Shooter, encode_view, split,  # noqa: E402
                   start_server, stop_server, tile)

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "user-guide"
VIEWS = HERE / "views"

ACCENT = (214, 51, 108)          # one callout colour for every page (#D6336C)
HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"           # example HSC (examples.json)
GMP_CLICK = "HSPC_Old_3#GGGTATTAGGCCGCTT-1"     # a GMP near the HSC (screenshots.py)
FC = "kompot_de_Young_to_Old_fold_change"
WALK = "diffusion_walk_t5"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
VOLCANO_X = {"type": "var", "key": "kompot_de_Young_to_Old_mean_lfc", "column": ""}
VOLCANO_Y = {"type": "var", "key": "kompot_de_Young_to_Old_mahalanobis", "column": ""}
CONST = {"focusedCell": HSC, "focusedGene": "H2-Q7", "taxonomyId": "10090"}
DATASETS = ("bm_aging.zarr", "bm_aging_showcase.zarr", "spatial_demo.zarr")


# --------------------------------------------------------------------------- views
def cell_plot(pid, title, color, x=UMAP_X, y=UMAP_Y, z=None, **kw):
    c = {"id": pid, "title": title, "x": x, "y": y, "z": z, "color": color,
         "pointSize": 3, "pointOpacity": 0.8}
    c.update(kw)
    return c


def gene_plot(pid, title, color, x=VOLCANO_X, y=VOLCANO_Y, z=None, **kw):
    c = {"id": pid, "title": title, "x": x, "y": y, "z": z, "color": color,
         "pointSize": 5, "pointOpacity": 0.8}
    c.update(kw)
    return c


def view(hierarchy, configs, constants=CONST):
    return {"v": 1, "constants": dict(constants),
            "layout": {"v": 1, "hierarchy": [hierarchy],
                       "controlState": {k: False for k in configs},
                       "panelConfigs": configs}}


def save_view(name, v):
    VIEWS.mkdir(exist_ok=True)
    (VIEWS / f"userguide-{name}.json").write_text(json.dumps(v, indent=1) + "\n")
    return v


def obsp(key, column, locked=False):
    return {"type": "obsp", "key": key, "column": column, "locked": locked}


def layer(key, column, locked=False):
    return {"type": "layer", "key": key, "column": column, "locked": locked}


# --------------------------------------------------------------------------- images
def _font(size):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def finish(path: Path):
    """Keep every PNG under ~400 KB: optimise, then quantise if it is still too big."""
    im = Image.open(path).convert("RGB")
    im.save(path, optimize=True)
    if path.stat().st_size > 400_000:
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    if path.stat().st_size > 400_000:
        w, h = im.size
        im = im.resize((int(w * 0.8), int(h * 0.8)), Image.LANCZOS)
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def annotate(path: Path, marks):
    """marks: list of (label, (x0, y0, x1, y1)) in image pixels. Draws a thin outline and a
    numbered disc at the outline's top-left corner, in the single accent colour."""
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im)
    r = int(11 * DSF)
    font = _font(int(13 * DSF))
    for label, (x0, y0, x1, y1) in marks:
        pad = int(2 * DSF)
        d.rectangle([x0 - pad, y0 - pad, x1 + pad, y1 + pad], outline=ACCENT, width=int(2 * DSF))
        cx = max(r, min(im.width - r, x0 - pad))
        cy = max(r, min(im.height - r, y0 - pad))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
        d.text((cx, cy), str(label), fill="white", font=font, anchor="mm")
    im.save(path)


def clean(page):
    page.add_style_tag(content="#notification-container, .notification { display: none !important; }")
    time.sleep(0.3)


def capture(sh, page, name, region=None, marks=(), hide_modebar=True, hover=False):
    """Screenshot `region` (a selector, or None for the viewport) to OUT/name.png and draw
    numbered callouts over the elements matched by `marks` [(label, selector), ...]."""
    clean(page)
    nohover = None if hover else page.add_style_tag(content=".hoverlayer { display: none !important; }")
    style = page.add_style_tag(content=".modebar-container { display: none !important; }") \
        if hide_modebar else None
    path = OUT / f"{name}.png"
    if region:
        loc = page.locator(region).first
        loc.screenshot(path=str(path))
        box = loc.bounding_box()
        ox, oy = box["x"], box["y"]
    else:
        page.screenshot(path=str(path))
        ox = oy = 0
    if marks:
        boxes = []
        for label, sel in marks:
            b = page.locator(sel).first.bounding_box()
            if b is None:
                sh.log.append(f"{name}: mark {label} {sel} not visible")
                continue
            boxes.append((label, ((b["x"] - ox) * DSF, (b["y"] - oy) * DSF,
                                  (b["x"] - ox + b["width"]) * DSF, (b["y"] - oy + b["height"]) * DSF)))
        annotate(path, boxes)
    for st in (style, nohover):
        if st:
            st.evaluate("e => e.remove()")
    finish(path)
    sh.log.append(f"wrote {name}.png")


def crop_top(name, frac):
    """A lone full-width tile restored from a deep link draws at about half its height (bug
    list); keep the drawn part."""
    path = OUT / f"{name}.png"
    im = Image.open(path)
    im.crop((0, 0, im.width, int(im.height * frac))).save(path)
    finish(path)


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


def toggle_controls(sh, page, tid):
    page.locator(f"{T(tid)} .tile-toggle-controls").first.click()
    sh.ready(page)
    # A plot does not always grow back after its controls are hidden (see the user guide
    # bug list); a window resize event makes Plotly re-measure the tile.
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    sh.ready(page)


def point_xy(page, tid, name):
    """Page coordinates of the point named `name` in a 2D Plotly panel."""
    return page.evaluate("""([tid, name]) => {
      const g = document.querySelector(`.tile[data-tile-id="${tid}"] .js-plotly-plot`);
      for (const t of g._fullData) {
        const i = (t.customdata || []).indexOf(name);
        if (i < 0) continue;
        const L = g._fullLayout, r = g.getBoundingClientRect();
        return [r.left + L.margin.l + L.xaxis.l2p(t.x[i]), r.top + L.margin.t + L.yaxis.l2p(t.y[i])];
      }
      return null; }""", [tid, name])


def api_requests(page):
    reqs = []
    page.on("request", lambda r: reqs.append(urllib.parse.unquote(r.url)) if "/api/v1/data/" in r.url else None)
    return reqs


def open_plain(sh, dataset):
    """Open a dataset with no view (the Welcome tile). Shooter.open waits for a tile."""
    ctx = sh.browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=DSF,
                                 color_scheme="light")
    page = ctx.new_page()
    page._inflight = set()
    page.on("request", lambda r: page._inflight.add(r))
    page.on("requestfinished", lambda r: page._inflight.discard(r))
    page.on("requestfailed", lambda r: page._inflight.discard(r))
    page.on("pageerror", lambda e: sh.log.append(f"pageerror: {e}"))
    page.goto(f"{sh.base}/?dataset_path={urllib.parse.quote(str(dataset))}")
    page.wait_for_selector(".tile-selector", timeout=60000)
    page.wait_for_function("document.getElementById('cell-count').textContent.trim() !== '-'", timeout=60000)
    time.sleep(1.5)
    return page


def ds(name, data_dir):
    return str(Path(data_dir) / name)


# --------------------------------------------------------------------------- pages
def shoot_interface(sh, data_dir):
    page = open_plain(sh, ds("bm_aging.zarr", data_dir))
    capture(sh, page, "ui-welcome")
    capture(sh, page, "ui-header", "#app-header", marks=[
        (1, "#select2-dataset-selector-container"), (2, "#refresh-dataset"),
        (3, "#gene-history-back"), (4, "#select2-focused-gene-container"),
        (5, "#cell-history-back"), (6, "#select2-focused-cell-container"),
        (7, "#btn-save-session"), (8, "#btn-load-session"), (9, "#btn-share-link")])

    # Gene picker: open it, type a prefix
    page.click("#select2-focused-gene-container")
    page.locator(".select2-container--open .select2-search__field").fill("H2-")
    time.sleep(0.8)
    capture(sh, page, "ui-gene-picker", None)
    im = Image.open(OUT / "ui-gene-picker.png")
    im.crop((int(560 * DSF), 0, int(1060 * DSF), int(560 * DSF))).save(OUT / "ui-gene-picker.png")
    finish(OUT / "ui-gene-picker.png")
    page.keyboard.press("Escape")

    # Add a cell plot from the welcome tile
    page.locator(".tile-selector >> text=Cell Plot").first.click()
    sh.ready(page)
    page.evaluate("window.scrollTo(0, 0)")
    tid = page.evaluate("document.querySelector('.tile[data-tile-id^=\"cell-plot\"]').dataset.tileId")
    capture(sh, page, "ui-first-cell-plot", None)

    # Split it side by side, then fill the new pane with a gene plot
    page.locator(f"{T(tid)} .tile-split-h").first.click()
    time.sleep(1.5)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "ui-split-selector", None)
    page.locator(".split-pane .tile-selector >> text=Gene Plot").first.click()
    sh.ready(page)
    sh.hide_controls(page)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "ui-two-panels", None)
    capture(sh, page, "ui-tile-header", f"{T(tid)} .tile-header", marks=[
        (1, f"{T(tid)} .tile-title"), (2, f"{T(tid)} .tile-toggle-controls"),
        (3, f"{T(tid)} .tile-split-h"), (4, f"{T(tid)} .tile-split-v"), (5, f"{T(tid)} .tile-close")])
    handle = page.locator(".split-handle.vertical").first
    b = handle.bounding_box()
    capture(sh, page, "ui-split-handle", None)
    annotate(OUT / "ui-split-handle.png", [(1, (b["x"] * DSF - 6, (b["y"] + 120) * DSF,
                                               (b["x"] + b["width"]) * DSF + 6, (b["y"] + 520) * DSF))])
    im = Image.open(OUT / "ui-split-handle.png")
    cx = int((b["x"] - 260) * DSF)
    im.crop((cx, int(140 * DSF), cx + int(520 * DSF), int(760 * DSF))).save(OUT / "ui-split-handle.png")
    finish(OUT / "ui-split-handle.png")

    # Close the gene plot: it moves to "Duplicate or Reopen Panel"
    gid = page.evaluate("document.querySelector('.tile[data-tile-id^=\"gene-plot\"]').dataset.tileId")
    page.locator(f"{T(gid)} .tile-close").first.click()
    time.sleep(2)
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    time.sleep(0.5)
    sel = page.locator(".tile-selector").last
    sel.scroll_into_view_if_needed()
    capture(sh, page, "ui-reopen", None)
    im = Image.open(OUT / "ui-reopen.png")
    im.crop((0, int(im.height * 0.34), im.width, im.height)).save(OUT / "ui-reopen.png")
    finish(OUT / "ui-reopen.png")
    page.context.close()


def shoot_focus(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("focus", view(
        split("horizontal", tile("cell-plot-W"), tile("cell-plot-F")),
        {"cell-plot-W": cell_plot("cell-plot-W", "5-step diffusion walk from the focused cell",
                                  obsp(WALK, HSC), colorScale="Blues", colorReversed=True),
         "cell-plot-F": cell_plot("cell-plot-F", "Fold change (Young to Old) of the focused gene",
                                  layer(FC, "H2-Q7"), colorScale="RdBu", centeringActive=True)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "focus-start", "#tile-container")

    # Hover, then click a GMP
    x, y = point_xy(page, "cell-plot-W", GMP_CLICK)
    page.mouse.move(x - 30, y - 30)
    page.mouse.move(x, y)
    time.sleep(1.0)
    capture(sh, page, "focus-hover", T("cell-plot-W") + " .tile-content", hover=True)
    reqs = api_requests(page)
    page.mouse.click(x, y)
    sh.ready(page)
    sh.log.append("focus click requests: " + " | ".join(r.split("?")[0] + "?" + r.split("&rows=")[-1][:20] if "rows=" in r else r.split("?")[0] for r in reqs))
    capture(sh, page, "focus-after-click", "#tile-container")
    capture(sh, page, "focus-cell-history", "#app-header", marks=[(1, "#cell-history-back"),
                                                                  (2, "#select2-focused-cell-container")])
    im = Image.open(OUT / "focus-cell-history.png")
    im.crop((int(1050 * DSF), 0, int(1500 * DSF), im.height)).save(OUT / "focus-cell-history.png")
    finish(OUT / "focus-cell-history.png")

    # Back to the HSC with the history arrow, then lock the walk panel's colour
    page.click("#cell-history-back")
    sh.ready(page)
    toggle_controls(sh, page, "cell-plot-W")
    page.locator(f"{T('cell-plot-W')} #lock-color").click()
    time.sleep(0.5)
    capture(sh, page, "focus-lock-button", T("cell-plot-W") + " .color-selector-container .axis-selector",
            marks=[(1, f"{T('cell-plot-W')} .axis-column-select[data-axis=color]"),
                   (2, f"{T('cell-plot-W')} #lock-color")])
    # Focus the GMP again: the locked panel keeps the HSC's row
    page.click("#cell-history-forward")
    sh.ready(page)
    capture(sh, page, "focus-locked-refocus", T("cell-plot-W") + " .color-selector-container .axis-selector",
            marks=[(1, f"{T('cell-plot-W')} #refocus-color"), (2, f"{T('cell-plot-W')} #lock-color")])
    toggle_controls(sh, page, "cell-plot-W")
    capture(sh, page, "focus-locked", "#tile-container")
    page.context.close()

    # Compare two genes on one fixed scale: left locked to H2-Q7, right follows the focus
    v = save_view("compare-genes", view(
        split("horizontal", tile("cell-plot-L"), tile("cell-plot-R")),
        {"cell-plot-L": cell_plot("cell-plot-L", "Locked: fold change of H2-Q7", layer(FC, "H2-Q7", True),
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
         "cell-plot-R": cell_plot("cell-plot-R", "Follows the focus: fold change of the focused gene",
                                  layer(FC, "S100a9"), colorScale="RdBu", colorMin=-1, colorMax=1,
                                  lockColorRange=True)},
        constants={**CONST, "focusedGene": "S100a9"}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "focus-compare-genes", "#tile-container")
    page.context.close()


def shoot_plots(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("cell-plot-controls", view(
        tile("cell-plot-C"),
        {"cell-plot-C": cell_plot("cell-plot-C", "Cell plot", {"type": "obs", "key": "highres_celltype", "column": ""})}))
    page = sh.open(v, dataset=D)
    toggle_controls(sh, page, "cell-plot-C")
    page.evaluate("window.scrollTo(0, 0)")
    c = T("cell-plot-C")
    capture(sh, page, "plots-cell-controls", c + " .plot-controls", marks=[
        (1, f"{c} .axis-type-select[data-axis=x]"), (2, f"{c} .axis-key-select[data-axis=x]"),
        (3, f"{c} .axis-column-select[data-axis=x]"), (4, f"{c} .color-selector-container .axis-selector"),
        (5, f"{c} [id^=z-axis-toggle]"), (6, f"{c} [id^=highlight-focused-cell]"),
        (7, f"{c} [id^=aesthetics-menu-btn]"), (8, f"{c} .table-filter-controls"),
        (9, f"{c} .point-controls"), (10, f"{c} [id^=category-palette]")])
    page.context.close()
    # Reopen rather than hide the controls again: a plot keeps its smaller height after its
    # controls are hidden (bug list on the user guide's final report).
    page = sh.open(v, dataset=D)
    capture(sh, page, "plots-categorical", c + " .tile-content")
    crop_top("plots-categorical", 0.56)
    page.context.close()

    v = save_view("cell-sources", view(
        split("horizontal",
              split("vertical", tile("cell-plot-P"), tile("cell-plot-Q")),
              split("vertical", tile("cell-plot-K"), tile("cell-plot-3"))),
        {"cell-plot-P": cell_plot("cell-plot-P", "obsm X_pca 0 vs 1, colour obs total_counts",
                                  {"type": "obs", "key": "total_counts", "column": ""},
                                  x={"type": "obsm", "key": "X_pca", "column": "0"},
                                  y={"type": "obsm", "key": "X_pca", "column": "1"}, colorScale="Viridis"),
         "cell-plot-Q": cell_plot("cell-plot-Q", "obs vs obs: n_genes_by_counts vs pct_counts_mt",
                                  {"type": "obs", "key": "Age", "column": ""},
                                  x={"type": "obs", "key": "n_genes_by_counts", "column": ""},
                                  y={"type": "obs", "key": "pct_counts_mt", "column": ""}),
         "cell-plot-K": cell_plot("cell-plot-K", "obsm AbCapture CD150 vs CD48 protein, colour layer H2-Q7",
                                  layer("MAGIC_imputed_data", "H2-Q7"),
                                  x={"type": "obsm", "key": "AbCapture", "column": "CD150_TotalSeqB"},
                                  y={"type": "obsm", "key": "AbCapture", "column": "CD48_TotalSeqB"},
                                  colorScale="Viridis"),
         "cell-plot-3": cell_plot("cell-plot-3", "3D: obsm X_pca 0, 1, 2",
                                  {"type": "obs", "key": "highres_celltype", "column": ""},
                                  x={"type": "obsm", "key": "X_pca", "column": "0"},
                                  y={"type": "obsm", "key": "X_pca", "column": "1"},
                                  z={"type": "obsm", "key": "X_pca", "column": "2"}, pointSize=2)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "plots-cell-sources", "#tile-container")
    page.context.close()

    v = save_view("gene-sources", view(
        split("horizontal", tile("gene-plot-V"), tile("gene-plot-L")),
        {"gene-plot-V": gene_plot("gene-plot-V", "var vs var, colour varp row of the focused gene",
                                  {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
         "gene-plot-L": gene_plot("gene-plot-L", "varm PCs 0 vs 1, colour layer row of the focused cell",
                                  {"type": "layer", "key": FC, "column": HSC, "locked": False},
                                  x={"type": "varm", "key": "PCs", "column": "0"},
                                  y={"type": "varm", "key": "PCs", "column": "1"},
                                  colorScale="RdBu", centeringActive=True)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "plots-gene-sources", "#tile-container")
    page.context.close()


def shoot_colour(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("colour-seq-div", view(
        split("horizontal", tile("cell-plot-S"), tile("cell-plot-D")),
        {"cell-plot-S": cell_plot("cell-plot-S", "Sequential: Blues, reversed (diffusion walk)",
                                  obsp(WALK, HSC), colorScale="Blues", colorReversed=True),
         "cell-plot-D": cell_plot("cell-plot-D", "Diverging: RdBu, Center at 0 (fold change)",
                                  layer(FC, "H2-Q7"), colorScale="RdBu", centeringActive=True)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "colour-seq-div", "#tile-container")
    toggle_controls(sh, page, "cell-plot-D")
    d = T("cell-plot-D")
    capture(sh, page, "colour-controls", d + " .color-range-controls", marks=[
        (1, f"{d} [id^=color-scale-]"), (2, f"{d} .color-min-slider-container"),
        (3, f"{d} .color-max-slider-container"), (4, f"{d} [id^=center-colormap]"),
        (5, f"{d} [id^=reverse-colormap]"), (6, f"{d} [id^=lock-range]"),
        (7, f"{d} [id^=hide-outliers]"), (8, f"{d} [id^=hide-nan]")])
    page.context.close()

    # Same gene, two fixed ranges: clipped at +-0.25 vs the full range; and Hide Outliers
    v = save_view("colour-range", view(
        split("horizontal", tile("cell-plot-A"), split("horizontal", tile("cell-plot-B"), tile("cell-plot-O")), 34),
        {"cell-plot-A": cell_plot("cell-plot-A", "Range from the data (-1.03 to 1.03)",
                                  layer(FC, "H2-Q7"), colorScale="RdBu", centeringActive=True),
         "cell-plot-B": cell_plot("cell-plot-B", "Range fixed at -0.25 to 0.25: values beyond take the end colours",
                                  layer(FC, "H2-Q7"), colorScale="RdBu", colorMin=-0.25, colorMax=0.25,
                                  lockColorRange=True),
         "cell-plot-O": cell_plot("cell-plot-O", "Same range with Hide Outliers",
                                  layer(FC, "H2-Q7"), colorScale="RdBu", colorMin=-0.25, colorMax=0.25,
                                  lockColorRange=True, hideOutliers=True)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "colour-range", "#tile-container")
    page.context.close()


def shoot_tables(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("gene-table-start", view(
        split("horizontal", tile("gene-plot-G"), tile("gene-table-T")),
        {"gene-plot-G": gene_plot("gene-plot-G", "Volcano, colour = Spearman (fold change) to the focused gene",
                                  {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True),
         "gene-table-T": {"id": "gene-table-T", "title": "Gene table"}}))
    page = sh.open(v, dataset=D)
    t = T("gene-table-T")
    toggle_controls(sh, page, "gene-table-T")

    def check(tab, label):
        page.locator(f"{t} .nav-link", has_text=tab).first.click()
        time.sleep(0.4)
        page.locator(f"{t} label:text-is('{label}')").first.click()
        time.sleep(0.3)

    check("var", "kompot_de_Young_to_Old_mean_lfc")
    check("var", "kompot_de_Young_to_Old_mahalanobis")
    page.locator(f"{t} .nav-link", has_text="var").first.click()
    capture(sh, page, "tables-columns", t + " .table-controls", marks=[
        (1, f"{t} .nav-tabs, {t} .nav"), (2, f"{t} .table-controls h6:text-is('Selected Columns')"),
        (3, f"{t} button:has-text('Apply Changes')"), (4, f"{t} button:has-text('Export CSV')")])
    page.locator(f"{t} button", has_text="Apply Changes").click()
    sh.ready(page)
    toggle_controls(sh, page, "gene-table-T")

    # Sort by mahalanobis, descending
    th = page.locator(f"{t} thead th", has_text="mahalanobis").first
    th.click(); sh.ready(page); th.click(); sh.ready(page)

    # SearchBuilder: mahalanobis > 5 AND (mean_lfc > 0.05 OR mean_lfc < -0.05)
    def crit(n, col, cond, val):
        c = page.locator(f"{t} .dtsb-criteria").nth(n)
        c.locator(".dtsb-data").select_option(label=col); time.sleep(0.6)
        c.locator(".dtsb-condition").select_option(label=cond); time.sleep(0.6)
        c.locator("input.dtsb-value").first.fill(str(val))
        c.locator("input.dtsb-value").first.press("Tab"); time.sleep(1.5)

    page.locator(f"{t} button", has_text="Add Condition").first.click(); time.sleep(0.8)
    crit(0, "kompot_de_Young_to_Old_mahalanobis", "Greater Than", 5)
    page.locator(f"{t} button", has_text="Add Condition").first.click(); time.sleep(0.8)
    crit(1, "kompot_de_Young_to_Old_mean_lfc", "Greater Than", 0.05)
    page.locator(f"{t} .dtsb-criteria").nth(1).locator(".dtsb-right").click(); time.sleep(1.0)
    sub = page.locator(f"{t} .dtsb-group .dtsb-group").first
    sub.locator(".dtsb-add").first.click(); time.sleep(0.8)
    crit(2, "kompot_de_Young_to_Old_mean_lfc", "Less Than", -0.05)
    sub.locator(".dtsb-logic").first.click()
    sh.ready(page)
    info = page.locator(f"{t} .dataTables_info").inner_text()
    sh.log.append(f"tables: searchbuilder info = {info}")
    capture(sh, page, "tables-searchbuilder", t + " .tile-content", marks=[
        (1, f"{t} .dtsb-criteria >> nth=0"), (2, f"{t} .dtsb-criteria >> nth=1 >> .dtsb-left"),
        (3, f"{t} .dtsb-group .dtsb-group .dtsb-logic"), (4, f"{t} .dataTables_info")])

    # Link the gene plot to the table
    toggle_controls(sh, page, "gene-plot-G")
    page.select_option(f"{T('gene-plot-G')} .table-filter-select", "gene-table-T")
    sh.ready(page)
    g = T("gene-plot-G")
    capture(sh, page, "tables-filter-select", g + " .table-filter-controls",
            marks=[(1, f"{g} .table-filter-select"), (2, f"{g} [id^=remove-non-table-entries]")])
    toggle_controls(sh, page, "gene-plot-G")
    capture(sh, page, "tables-linked", "#tile-container")
    layout = json.loads(page.evaluate("JSON.stringify(PanelManager.saveLayout())"))
    save_view("gene-table-filtered", {"v": 1, "constants": CONST, "layout": layout})
    toggle_controls(sh, page, "gene-plot-G")
    page.locator(f"{g} [id^=remove-non-table-entries]").click()
    sh.ready(page)
    toggle_controls(sh, page, "gene-plot-G")
    capture(sh, page, "tables-linked-removed", g + " .tile-content")

    # Export CSV: which rows and columns end up in the file
    toggle_controls(sh, page, "gene-table-T")
    with page.expect_download() as dl:
        page.locator(f"{t} button", has_text="Export CSV").click()
    csv_path = Path(tempfile.mkdtemp()) / dl.value.suggested_filename
    dl.value.save_as(csv_path)
    lines = csv_path.read_text().splitlines()
    sh.log.append(f"tables: CSV {dl.value.suggested_filename}: {len(lines)} lines, header {lines[0][:120]}, "
                  f"first row {lines[1][:80]}")
    toggle_controls(sh, page, "gene-table-T")

    # Click a gene name in the table: it becomes the focused gene
    page.locator(f"{t} span.entity-index-value[data-entity='Cd74']").click()
    sh.ready(page)
    sh.log.append("tables: focused gene after table click = " +
                  page.evaluate("document.getElementById('focused-gene').value"))
    page.context.close()


def shoot_panelsets(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = json.loads((VIEWS / "userguide-focus.json").read_text())
    page = sh.open(v, dataset=D)
    page.click("#btn-save-session"); time.sleep(1.2)
    page.fill("#session-name", "HSC walk and H2-Q7 fold change")
    time.sleep(0.4)
    capture(sh, page, "panelsets-save", "#session-modal .modal-content")
    page.click("#btn-confirm-session"); time.sleep(2.5)
    page.context.close()

    page = open_plain(sh, D)
    page.click("#btn-load-session"); time.sleep(1.5)
    capture(sh, page, "panelsets-load", "#session-modal .modal-content", marks=[
        (1, "#session-search"), (2, "#session-grid > * >> nth=0"),
        (3, "#session-grid button:has-text('Export')"), (4, "#toggle-upload-btn"),
        (5, "#btn-confirm-session")])
    page.locator("#session-grid > *").first.click(); time.sleep(0.3)
    page.click("#btn-confirm-session"); time.sleep(4)
    sh.ready(page)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "panelsets-loaded-closed", None)
    btn = page.locator(".panel-closed-btn").first
    btn.hover(); time.sleep(0.3)
    btn.click()
    sh.ready(page)
    sh.hide_controls(page)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "panelsets-reopened", None)
    page.context.close()


def shoot_share(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = json.loads((VIEWS / "userguide-focus.json").read_text())
    page = sh.open(v, dataset=D, clipboard_denied=True)
    page.click("#btn-share-link"); time.sleep(1.2)
    link = page.evaluate("document.getElementById('share-link-field').value")
    sh.log.append(f"share: link length {len(link)} characters")
    capture(sh, page, "share-fallback", "#app-header",
            marks=[(1, "#btn-share-link"), (2, "#share-link-field")])
    im = Image.open(OUT / "share-fallback.png")
    im.crop((int(1000 * DSF), 0, im.width, im.height)).save(OUT / "share-fallback.png")
    finish(OUT / "share-fallback.png")
    page.context.close()


def shoot_export(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = json.loads((VIEWS / "userguide-focus.json").read_text())
    page = sh.open(v, dataset=D)
    w = T("cell-plot-W")
    page.locator(f"{w} .js-plotly-plot").hover(); time.sleep(0.6)
    capture(sh, page, "export-modebar", w + " .tile-content", hide_modebar=False,
            marks=[(1, f"{w} .modebar-btn[data-title*='Download']")])
    im = Image.open(OUT / "export-modebar.png")
    im.crop((im.width - int(380 * DSF), 0, im.width, int(110 * DSF))).save(OUT / "export-modebar.png")
    finish(OUT / "export-modebar.png")
    toggle_controls(sh, page, "cell-plot-W")
    page.locator(f"{w} [id^=aesthetics-menu-btn]").click(); time.sleep(1.2)
    pop = page.locator(".popover").last
    page.locator("[id^=download-png-cell-plot-W]").scroll_into_view_if_needed(); time.sleep(0.4)
    capture(sh, page, "export-plot-options", ".popover .popover-body", marks=[
        (1, "[id^=download-png-cell-plot-W]"), (2, "[id^=plot-width-cell-plot-W]"),
        (3, "[id^=plot-height-cell-plot-W]")])
    page.context.close()


def shoot_spatial(sh, data_dir):
    D = ds("spatial_demo.zarr", data_dir)
    SPOT = "AAACAAGTATCTCCCA-1"
    sx = {"type": "obsm", "key": "spatial_upright", "column": "0"}
    sy = {"type": "obsm", "key": "spatial_upright", "column": "1"}
    const = {"focusedCell": SPOT, "focusedGene": "Ttr", "taxonomyId": "10090"}
    v = save_view("spatial", view(
        split("horizontal",
              split("vertical", tile("cell-plot-SL"), tile("cell-plot-SG")),
              split("vertical", tile("cell-plot-SK"), tile("cell-plot-SU"))),
        {"cell-plot-SL": cell_plot("cell-plot-SL", "Spots at obsm spatial_upright, colour obs leiden",
                                   {"type": "obs", "key": "leiden", "column": ""}, x=sx, y=sy, pointSize=4,
                                   pointOpacity=1),
         "cell-plot-SG": cell_plot("cell-plot-SG", "Colour: layer log_normalized, focused gene",
                                   layer("log_normalized", "Ttr"), x=sx, y=sy, pointSize=4, pointOpacity=1,
                                   colorScale="Viridis"),
         "cell-plot-SK": cell_plot("cell-plot-SK", "Colour: obsp spatial_kernel row of the focused spot",
                                   obsp("spatial_kernel", SPOT), x=sx, y=sy, pointSize=4, pointOpacity=1,
                                   colorScale="Blues", colorReversed=True),
         "cell-plot-SU": cell_plot("cell-plot-SU", "Same kernel row on the expression UMAP",
                                   obsp("spatial_kernel", SPOT), pointSize=4, pointOpacity=1,
                                   colorScale="Blues", colorReversed=True)},
        constants=const))
    page = sh.open(v, dataset=D)
    capture(sh, page, "spatial-overview", "#tile-container")
    x, y = point_xy(page, "cell-plot-SL", page.evaluate(
        "(() => { const d = document.querySelector('.tile[data-tile-id=\"cell-plot-SL\"] .js-plotly-plot')._fullData;"
        " const t = d.reduce((a, b) => ((b.customdata || []).length > (a.customdata || []).length ? b : a));"
        " return t.customdata[Math.floor(t.customdata.length / 3)]; })()"))
    reqs = api_requests(page)
    page.mouse.click(x, y)
    sh.ready(page)
    sh.log.append("spatial click requests: " + " | ".join(r.split("?")[0] for r in reqs))
    capture(sh, page, "spatial-after-click", "#tile-container")
    page.context.close()


def shoot_remote(sh_unused, data_dir, port, remote_python, log):
    """Separate server with remote stores allowed for the local HTTP server only."""
    http_port = port + 10
    http = subprocess.Popen([sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1"],
                            cwd=str(DATA_DIR), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ["ANNZARRO_REMOTE_ALLOWLIST"] = f"http://127.0.0.1:{http_port}/"
    exe = str(Path(remote_python).with_name("annzarro"))
    proc = start_server(exe, port, OUT.parent / f".server-{port}-remote.log", Path(data_dir))
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            sh = Shooter(browser, f"http://127.0.0.1:{port}", log, OUT)
            page = open_plain(sh, ds("bm_aging.zarr", data_dir))
            url = f"http://127.0.0.1:{http_port}/bm_aging.zarr"
            page.click("#select2-dataset-selector-container"); time.sleep(0.8)
            page.locator(".select2-container--open .select2-search__field").fill(url)
            time.sleep(0.8)
            capture(sh, page, "remote-typed", None)
            im = Image.open(OUT / "remote-typed.png")
            im.crop((0, 0, int(800 * DSF), int(330 * DSF))).save(OUT / "remote-typed.png")
            finish(OUT / "remote-typed.png")
            page.keyboard.press("Enter")
            sh.ready(page)
            page.context.close()

            v = save_view("remote", view(tile("cell-plot-R"), {"cell-plot-R": cell_plot(
                "cell-plot-R", "Fold change of H2-Q7, read over HTTP", layer(FC, "H2-Q7"),
                colorScale="RdBu", centeringActive=True)}))
            ctx = browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=DSF)
            page = ctx.new_page()
            page._inflight = set()
            page.on("request", lambda r: page._inflight.add(r))
            page.on("requestfinished", lambda r: page._inflight.discard(r))
            page.on("requestfailed", lambda r: page._inflight.discard(r))
            page.goto(f"http://127.0.0.1:{port}/?dataset_path={urllib.parse.quote(url, safe='')}"
                      f"#view={encode_view(v)}")
            sh.ready(page)
            sh.hide_controls(page)
            page.evaluate("window.scrollTo(0, 0)")
            capture(sh, page, "remote-plot", None)
            crop_top("remote-plot", 0.66)
            ctx.close()
            browser.close()
    finally:
        stop_server(proc)
        http.terminate()


STEPS = {"interface": shoot_interface, "focus": shoot_focus, "plots": shoot_plots,
         "colour": shoot_colour, "tables": shoot_tables, "panelsets": shoot_panelsets,
         "share": shoot_share, "export": shoot_export, "spatial": shoot_spatial}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8817)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--remote-python", default=None,
                    help="python of an env with annzarro[remote]; enables the remote shots")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="annzarro-userguide-"))
    for name in DATASETS:
        if (DATA_DIR / name).exists():
            (data_dir / name).symlink_to(DATA_DIR / name)
    wanted = a.only or list(STEPS) + ["remote"]
    with Session(a.port, OUT, data_dir=data_dir) as sh:
        for name in wanted:
            if name in STEPS:
                STEPS[name](sh, data_dir)
    if "remote" in wanted:
        log: list[str] = []
        if a.remote_python:
            shoot_remote(None, data_dir, a.port, a.remote_python, log)
        else:
            log.append("remote: skipped (pass --remote-python)")
        print("\n".join(log))
