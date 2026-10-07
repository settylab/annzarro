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
(default ~/annzarro-data). The script serves them from a temporary data directory
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


def clean(page, keep_offer=False):
    if keep_offer:      # the "Open saved layout" notice stays in the shot, also after an earlier clean()
        page.add_style_tag(content="#notification-container { display: block !important; } "
                                   ".notification:not([data-offer]) { display: none !important; } "
                                   ".notification[data-offer] { display: block !important; }")
    else:
        page.add_style_tag(content="#notification-container, .notification { display: none !important; }")
    time.sleep(0.3)


def capture(sh, page, name, region=None, marks=(), hide_modebar=True, hover=False, keep_offer=False):
    """Screenshot `region` (a selector, or None for the viewport) to OUT/name.png and draw
    numbered callouts over the elements matched by `marks` [(label, selector), ...]."""
    clean(page, keep_offer)
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


def capture_union(sh, page, name, selectors, marks=(), pad=8):
    """Screenshot the viewport and crop to the union of `selectors` (plus `pad` px), so a
    row wider than its tile (or partly scrolled) is still captured whole."""
    clean(page)
    st = page.add_style_tag(content=".hoverlayer { display: none !important; }")
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    boxes = [page.locator(s_).first.bounding_box() for s_ in selectors]
    boxes = [b for b in boxes if b]
    x0 = max(0, min(b["x"] for b in boxes) - pad)
    y0 = max(0, min(b["y"] for b in boxes) - pad)
    x1 = max(b["x"] + b["width"] for b in boxes) + pad
    y1 = max(b["y"] + b["height"] for b in boxes) + pad
    out = []
    for label, sel in marks:
        b = page.locator(sel).first.bounding_box()
        if b:
            out.append((label, ((b["x"] - x0) * DSF, (b["y"] - y0) * DSF,
                                (b["x"] - x0 + b["width"]) * DSF, (b["y"] - y0 + b["height"]) * DSF)))
    im = Image.open(path)
    im.crop((int(x0 * DSF), int(y0 * DSF), int(min(x1 * DSF, im.width)), int(min(y1 * DSF, im.height)))).save(path)
    if out:
        annotate(path, out)
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
        return [r.left + L.xaxis._offset + L.xaxis.l2p(t.x[i]), r.top + L.yaxis._offset + L.yaxis.l2p(t.y[i])];
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
        (3, "#gene-history-back"), (4, "#focused-gene"),
        (5, "#cell-history-back"), (6, "#focused-cell"),
        (7, "#btn-save-session"), (8, "#btn-load-session"), (9, "#btn-share-link")])

    # Gene picker: open it, type a prefix
    page.click("#focused-gene")
    page.fill("#focused-gene", "H2-")
    page.wait_for_selector(".name-picker-option", timeout=20000)
    time.sleep(0.8)
    capture_union(sh, page, "ui-gene-picker", ["#gene-history-back", "#focused-gene", ".name-picker-menu"],
                  marks=[(1, ".name-picker-regex"), (2, ".name-picker-status")], pad=12)
    page.keyboard.press("Escape")
    page.locator("body").click(position={"x": 5, "y": 400})

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
    # The canvas is full, so the bottom selector has no room: split the remaining tile and
    # use the new pane's "Duplicate or Reopen Panel" section.
    page.locator(f"{T(tid)} .tile-split-v").first.click()
    time.sleep(2)
    sec = page.locator(".split-pane .selection-section", has_text="Duplicate or Reopen Panel").last
    sec.scroll_into_view_if_needed()
    time.sleep(0.6)
    clean(page)
    page.screenshot(path=str(OUT / "ui-reopen.png"))
    b = sec.bounding_box()
    Image.open(OUT / "ui-reopen.png").crop(tuple(int(v * DSF) for v in
        (b["x"], b["y"], b["x"] + b["width"], min(b["y"] + b["height"], 1000)))).save(OUT / "ui-reopen.png")
    finish(OUT / "ui-reopen.png")
    sh.log.append("wrote ui-reopen.png")
    page.context.close()


def shoot_focus(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("focus", view(
        split("horizontal", tile("cell-plot-W"), tile("cell-plot-F")),
        {"cell-plot-W": cell_plot("cell-plot-W", "5-step diffusion walk from the focused cell",
                                  obsp(WALK, HSC), colorScale="Blues", colorReversed=True,
                                  hoverInfo=[{"type": "obs", "key": "_index"},
                                             {"type": "obs", "key": "highres_celltype"},
                                             {"type": "obs", "key": "Age"}]),
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
    capture_union(sh, page, "focus-cell-history", ["#cell-history-back", "#focused-cell"],
                  marks=[(1, "#cell-history-back"), (2, "#focused-cell")], pad=14)

    # Back to the HSC with the history arrow, then lock the walk panel's colour
    page.click("#cell-history-back")
    sh.ready(page)
    toggle_controls(sh, page, "cell-plot-W")
    W = T("cell-plot-W")
    lock = f"{W} .axis-lock-btn[data-axis=color]"
    refocus = f"{W} .axis-refocus-btn[data-axis=color]"
    page.locator(lock).click()
    time.sleep(0.5)
    capture_union(sh, page, "focus-lock-button", [f"{W} .axis-key-select[data-axis=color]", lock],
                  marks=[(1, f"{W} .axis-column-select[data-axis=color]"), (2, lock)])
    # Focus the GMP again: the locked panel keeps the HSC's row
    page.click("#cell-history-forward")
    sh.ready(page)
    sh.log.append("focus: locked column label = " + page.evaluate(
        f"document.querySelector('{W} .axis-column-select[data-axis=color]').selectedOptions[0].text"))
    capture_union(sh, page, "focus-locked-refocus", [f"{W} .axis-key-select[data-axis=color]", lock],
                  marks=[(1, refocus), (2, lock)])
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
        (5, f"{c} [id^=z-axis-toggle]"), (6, f"{c} [id^=equal-aspect]"),
        (7, f"{c} [id^=highlight-focused-cell]"), (8, f"{c} [id^=category-palette]"),
        (9, f"{c} [id^=hide-nan]"), (10, f"{c} .point-controls"),
        (11, f"{c} .table-filter-controls"), (12, f"{c} [id^=aesthetics-menu-btn]")])
    toggle_controls(sh, page, "cell-plot-C")      # hide the controls: the plot fills the tile again
    capture(sh, page, "plots-categorical", c + " .tile-content")
    page.context.close()

    # Categorical colour with missing values: a grey "NA" legend entry (showcase store)
    SC = ds("bm_aging_showcase.zarr", data_dir)
    v = save_view("categorical-na", view(
        tile("gene-plot-M"),
        {"gene-plot-M": gene_plot("gene-plot-M", "Volcano coloured by var fig4_module_k3 (NaN for non-DE genes)",
                                  {"type": "var", "key": "fig4_module_k3", "column": ""})}))
    page = sh.open(v, dataset=SC)
    capture(sh, page, "plots-categorical-na", T("gene-plot-M") + " .tile-content")
    sh.log.append("plots: categorical-na traces = " + json.dumps(page.evaluate(
        "document.querySelector('.tile[data-tile-id=\"gene-plot-M\"] .js-plotly-plot')._fullData"
        ".map(t => [t.name, (t.x || []).length])")))
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
    page.context.close()

    # The numerical colour controls, on one full-width tile so the toolbar fits in one row
    v = save_view("colour-controls", view(tile("cell-plot-D"), {"cell-plot-D": cell_plot(
        "cell-plot-D", "Fold change (Young to Old) of the focused gene", layer(FC, "H2-Q7"),
        colorScale="RdBu", centeringActive=True)}))
    page = sh.open(v, dataset=D)
    toggle_controls(sh, page, "cell-plot-D")
    d = T("cell-plot-D")
    capture(sh, page, "colour-controls", d + " .color-range-controls", marks=[
        (1, f"{d} [id^=color-scale-]"), (2, f"{d} .color-min-slider-container"),
        (3, f"{d} .color-max-slider-container"), (4, f"{d} [id^=center-colormap]"),
        (5, f"{d} [id^=reverse-colormap]"), (6, f"{d} [id^=lock-range]"),
        (7, f"{d} [id^=hide-outliers]"), (8, f"{d} [id^=hide-nan]"),
        (9, f"{d} [id^=sort-by-color]"), (10, f"{d} [id^=log-color]"),
        (11, f"{d} [id^=log-floor]")])
    sh.log.append("colour: Min/Max boxes = " + json.dumps(page.evaluate(
        f"[document.querySelector('{d} [id^=color-min-]:not([id*=slider])').value,"
        f" document.querySelector('{d} [id^=color-max-]:not([id*=slider])').value]")))
    page.context.close()

    # Log scale with a floor: the walk row spans several orders of magnitude
    v = save_view("colour-log", view(
        split("horizontal", tile("cell-plot-N"), tile("cell-plot-G")),
        {"cell-plot-N": cell_plot("cell-plot-N", "Linear colour (diffusion walk)", obsp(WALK, HSC),
                                  colorScale="Viridis"),
         "cell-plot-G": cell_plot("cell-plot-G", "Log colour, floor 1e-5",
                                  {**obsp(WALK, HSC), "log": True, "logFloor": 1e-5}, colorScale="Viridis")}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "colour-log", "#tile-container")
    page.context.close()

    # Strong on top: same volcano, drawing order by data order vs by |colour|
    v = save_view("colour-strong-on-top", view(
        split("horizontal", tile("gene-plot-U"), tile("gene-plot-S")),
        {"gene-plot-U": gene_plot("gene-plot-U", "Strong on top off: data order",
                                  {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True, sortByColor=False),
         "gene-plot-S": gene_plot("gene-plot-S", "Strong on top on (default): largest |colour| last",
                                  {"type": "varp", "key": "spearman_fold_change", "column": "H2-Q7", "locked": False},
                                  colorScale="RdBu", colorMin=-1, colorMax=1, lockColorRange=True)}))
    page = sh.open(v, dataset=D)
    capture(sh, page, "colour-strong-on-top", "#tile-container")
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
    page.locator(f"{t} .nav-link", has_text="varp").first.click()
    time.sleep(0.4)
    sh.log.append("tables: varp tab = " + json.dumps(page.evaluate(
        f"[...document.querySelectorAll('{t} .tab-pane.active label')].map(l => l.textContent.trim())")))
    varp_label = "spearman_fold_change: H2-Q7 (focused)"
    page.locator(f"{t} label:text-is('{varp_label}')").first.click()
    time.sleep(0.3)
    capture(sh, page, "tables-columns", t + " .table-controls", marks=[
        (1, f"{t} .nav-tabs, {t} .nav"), (2, f"{t} label:text-is('{varp_label}')"),
        (3, f"{t} .table-controls h6:text-is('Selected Columns')"),
        (4, f"{t} button:has-text('Apply Changes')"), (5, f"{t} button:has-text('Export CSV')")])
    page.locator(f"{t} button", has_text="Apply Changes").click()
    sh.ready(page)
    sh.log.append("tables: headers = " + json.dumps(page.evaluate(
        f"[...document.querySelectorAll('{t} thead th')].map(th => th.textContent.trim())")))
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
    sh.log.append("tables: headers after the focus change = " + json.dumps(page.evaluate(
        f"[...document.querySelectorAll('{t} thead th')].map(th => th.textContent.trim())")))
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

    # A second set that names a store this server does not have (older, so it is listed last)
    sessions = Path(data_dir) / "sessions"
    for _ in range(40):
        saved = sorted(sessions.glob("HSC_walk*.json")) if sessions.exists() else []
        if saved:
            break
        time.sleep(0.25)
    lost = json.loads(saved[0].read_text())
    lost.update(name="Cohort_walk_lost_dataset", dataset="/cohorts/lost_cohort.zarr",
                datasetName="lost_cohort", timestamp="2026-01-01T09:00:00.000Z")
    lost.get("view", {}).pop("store", None)
    (sessions / "Cohort_walk_lost_dataset.json").write_text(json.dumps(lost))

    page = open_plain(sh, D)
    page.click("#btn-load-session"); time.sleep(1.5)
    page.locator("#session-grid .load-actions[data-status='ready']").first.wait_for(timeout=30000)
    page.locator(".session-card[data-session-name='Cohort_walk_lost_dataset'] .load-actions[data-status='ready']") \
        .wait_for(timeout=30000)
    time.sleep(0.8)
    first = "#session-grid > .session-card:first-child"
    capture(sh, page, "panelsets-load", "#session-modal .modal-content", marks=[
        (1, "#session-search"), (2, first),
        (3, f"{first} .session-dataset-badge"), (4, f"{first} .session-load"),
        (5, f"{first} .load-icons"), (6, "#session-help-btn"), (7, "#toggle-upload-btn")])
    capture(sh, page, "panelsets-load-missing", ".session-card[data-session-name='Cohort_walk_lost_dataset']", marks=[
        (1, ".session-card[data-session-name='Cohort_walk_lost_dataset'] .session-dataset-badge"),
        (2, ".session-card[data-session-name='Cohort_walk_lost_dataset'] .session-load"),
        (3, ".session-card[data-session-name='Cohort_walk_lost_dataset'] .session-load-choose")])
    page.locator("#session-help-btn").hover(); time.sleep(0.6)
    capture(sh, page, "panelsets-help", "#session-modal .modal-content")
    page.mouse.move(2, 2); time.sleep(0.3)
    # "Load with panels closed" lists the set's panels closed and offers its saved layout in a notice
    page.locator(f"{first} .session-load-closed").click()
    page.mouse.move(700, 900)                           # off the buttons, so no hover state is shot
    offer = page.locator(".notification[data-offer='saved-layout']")
    offer.wait_for(state="attached", timeout=30000)     # hidden by the dialog shot's clean()
    time.sleep(1.0)
    sh.ready(page)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "panelsets-loaded", None, keep_offer=True, marks=[
        (1, ".tile-container > .tile-selector .source-panel-option.closed-panel >> nth=0"),
        (2, ".notification[data-offer='saved-layout'] button[data-action='open']")])
    sh.log.append("panelsets: after load, focus = " + json.dumps(page.evaluate(
        "[document.getElementById('focused-gene').value, document.getElementById('focused-cell').value,"
        " [...document.querySelectorAll('.tile-container .tile')].map(t => t.dataset.tileId),"
        " [...document.querySelectorAll('.source-panel-option.closed-panel')].map(e => e.dataset.id)]")))
    offer.locator("button[data-action='open']").click(); time.sleep(3)
    sh.ready(page)
    page.evaluate("window.scrollTo(0, 0)")
    capture(sh, page, "panelsets-opened", None)
    sh.log.append("panelsets: after Open saved layout = " + json.dumps(page.evaluate(
        "[...document.querySelectorAll('.tile-container .tile')].map(t => t.dataset.tileId)")))
    page.context.close()


def shoot_share(sh, data_dir):
    D = ds("bm_aging.zarr", data_dir)
    v = json.loads((VIEWS / "userguide-focus.json").read_text())
    page = sh.open(v, dataset=D, clipboard_denied=True)
    page.click("#btn-share-link"); time.sleep(1.2)
    link = page.evaluate("document.getElementById('share-link-field').value")
    sh.log.append(f"share: link length {len(link)} characters")
    sh.log.append("share: fallback field visible = " + str(page.is_visible("#share-link-field")))
    capture_union(sh, page, "share-fallback", ["#btn-save-session", "#btn-share-link", "#share-link-fallback"],
                  marks=[(1, "#btn-share-link"), (2, "#share-link-field")], pad=10)
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
                                   {"type": "obs", "key": "leiden", "column": ""}, x=sx, y=sy, equalAspect=True, pointSize=4,
                                   pointOpacity=1),
         "cell-plot-SG": cell_plot("cell-plot-SG", "Colour: layer log_normalized, focused gene",
                                   layer("log_normalized", "Ttr"), x=sx, y=sy, equalAspect=True, pointSize=4, pointOpacity=1,
                                   colorScale="Viridis"),
         "cell-plot-SK": cell_plot("cell-plot-SK", "Colour: obsp spatial_kernel row of the focused spot",
                                   obsp("spatial_kernel", SPOT), x=sx, y=sy, equalAspect=True, pointSize=4, pointOpacity=1,
                                   colorScale="Blues", colorReversed=True),
         "cell-plot-SU": cell_plot("cell-plot-SU", "Same kernel row on the expression UMAP",
                                   obsp("spatial_kernel", SPOT), pointSize=4, pointOpacity=1,
                                   colorScale="Blues", colorReversed=True)},
        constants=const))
    page = sh.open(v, dataset=D)
    capture(sh, page, "spatial-overview", "#tile-container")
    page.context.close()

    v2 = save_view("spatial-aspect", view(
        split("horizontal", tile("cell-plot-AO"), tile("cell-plot-AE")),
        {"cell-plot-AO": cell_plot("cell-plot-AO", "Equal aspect off: stretched to the tile",
                                   {"type": "obs", "key": "leiden", "column": ""}, x=sx, y=sy,
                                   pointSize=3, pointOpacity=1),
         "cell-plot-AE": cell_plot("cell-plot-AE", "Equal aspect on: one unit on x = one unit on y",
                                   {"type": "obs", "key": "leiden", "column": ""}, x=sx, y=sy,
                                   equalAspect=True, pointSize=3, pointOpacity=1)},
        constants=const))
    page = sh.open(v2, dataset=D)
    capture(sh, page, "spatial-aspect", "#tile-container")
    page.context.close()
    page = sh.open(v, dataset=D)
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
            ctx.close()
            browser.close()
    finally:
        stop_server(proc)
        http.terminate()


def shoot_subsets(sh, data_dir):
    """A subset of bm_aging.zarr (8,090 cells, under the 200,000-cell default threshold,
    so the subset is chosen by hand here)."""
    D = ds("bm_aging.zarr", data_dir)
    v = save_view("subset-start", view(
        split("horizontal", tile("cell-plot-SA"), tile("cell-table-ST")),
        {"cell-plot-SA": cell_plot("cell-plot-SA", "Cell type", {"type": "obs", "key": "highres_celltype", "column": ""}),
         "cell-table-ST": {"id": "cell-table-ST", "title": "Cell table",
                           "columns": [{"type": "obs", "key": "Age", "column": ""},
                                       {"type": "obs", "key": "highres_celltype", "column": ""}]}}))
    page = sh.open(v, dataset=D)
    capture_union(sh, page, "subsets-badge-all", ["#cell-count", "#subset-button"],
                  marks=[(1, "#subset-button")], pad=10)
    page.click("#subset-button")
    page.wait_for_selector("#subset-modal.show", timeout=20000)
    time.sleep(0.6)
    if not page.is_checked("#subset-enabled"):
        page.check("#subset-enabled")
    page.fill("#subset-n", "3000")
    page.fill("#subset-seed", "0")
    page.select_option("#subset-balance", label="Balanced across Age")
    page.click("#subset-add-condition")
    time.sleep(0.5)
    cond = page.locator("#subset-conditions > *").last
    selects = cond.locator("select")
    selects.nth(0).select_option(label="n_genes_by_counts")
    time.sleep(0.4)
    selects.nth(1).select_option(value=">=")
    time.sleep(0.4)
    cond.locator("input").first.fill("1000")
    cond.locator("input").first.press("Tab")
    page.wait_for_function("document.getElementById('subset-preview').textContent.trim().length > 0"
                           " && !document.getElementById('subset-preview').textContent.includes('Checking')",
                           timeout=20000)
    time.sleep(0.5)
    sh.log.append("subsets: preview = " + page.locator("#subset-preview").inner_text().replace("\n", " | "))
    page.locator("#subset-modal .modal-content").screenshot(path=str(OUT / "subsets-dialog.png"))
    finish(OUT / "subsets-dialog.png")
    sh.log.append("wrote subsets-dialog.png")
    reqs = api_requests(page)
    page.click("#subset-apply")
    time.sleep(2)
    sh.ready(page)
    sh.log.append("subsets: header = " + page.evaluate(
        "document.getElementById('cell-count').textContent + ' | ' + document.getElementById('subset-button').textContent"
        " + ' | ' + document.getElementById('subset-button').title"))
    sh.log.append("subsets: requests with subset = %d of %d" % (sum("subset=" in r for r in reqs), len(reqs)))
    capture(sh, page, "subsets-applied", None)
    capture_union(sh, page, "subsets-badge", ["#cell-count", "#subset-button"],
                  marks=[(1, "#subset-button")], pad=10)
    # Parts: 8,063 cells pass the filter, in parts of 3,000 -> 3 parts. Step to part 2.
    page.mouse.move(0, 0)          # no hover or focus styling in the shots
    capture_union(sh, page, "subsets-parts", ["#cell-count", "#subset-button", "#subset-parts"],
                  marks=[(1, "#subset-part-prev"), (2, "#subset-part-input"), (3, "#subset-part-next")], pad=10)
    parts_view = ["#dataset-stats", T("cell-plot-SA"), T("cell-table-ST")]
    capture_union(sh, page, "subsets-parts-view-1", parts_view, pad=4)
    rows1 = page.locator(f"{T('cell-table-ST')} tbody tr td").first.inner_text()
    page.click("#subset-part-next")
    page.wait_for_function("document.getElementById('subset-part-input').value === '2'", timeout=60000)
    time.sleep(2)
    sh.ready(page)
    page.mouse.move(0, 0)
    page.evaluate("document.activeElement && document.activeElement.blur()")
    time.sleep(0.3)
    sh.log.append("subsets: after › = " + page.evaluate(
        "document.getElementById('cell-count').textContent + ' | part ' + document.getElementById('subset-part-input').value"
        " + ' of ' + document.getElementById('subset-part-count').textContent + ' | ' + document.getElementById('subset-button').title"))
    capture_union(sh, page, "subsets-parts-view-2", parts_view, pad=4)
    part2_first = page.locator(f"{T('cell-table-ST')} tbody tr td").first.inner_text()
    sh.log.append(f"subsets: first table cell part 1 = {rows1!r}, part 2 = "
                  f"{part2_first!r}")
    sh.log.append("subsets: filter widget part 2 = " + page.locator(f"{T('cell-plot-SA')} .datapoint-filter-widget").inner_text().replace("\n", " "))
    page.click("#subset-part-prev")
    page.wait_for_function("document.getElementById('subset-part-input').value === '1'", timeout=60000)
    time.sleep(2)
    sh.ready(page)
    sh.log.append("subsets: table info = " + page.locator(f"{T('cell-table-ST')} .dataTables_info").inner_text())
    sh.log.append("subsets: filter widget = " + page.locator(f"{T('cell-plot-SA')} .datapoint-filter-widget").inner_text().replace("\n", " "))
    # Share link carries the subset
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=sh.base)
    page.click("#btn-share-link"); time.sleep(1)
    link = page.evaluate("navigator.clipboard.readText()")
    sh.log.append(f"subsets: share link length {len(link)}")
    page.context.close()


def shoot_focus_outside(sh, data_dir):
    """A focused cell outside the subset: the HSC is in part 2 of {"n": 3000, "seed": 0} on
    bm_aging.zarr; one click on › shows part 3, which does not hold it. The walk from the HSC
    is coloured over part 3's cells, the ring marks where the HSC lies, the header says it is
    not shown. Then the picker lists a cell of another part, tagged."""
    D = ds("bm_aging.zarr", data_dir)
    v = view(split("horizontal", tile("cell-plot-W"), tile("cell-plot-T")),
             {"cell-plot-W": cell_plot("cell-plot-W", "5-step diffusion walk from the focused cell",
                                       obsp(WALK, HSC), colorScale="Blues", colorReversed=True),
              "cell-plot-T": cell_plot("cell-plot-T", "Cell type",
                                       {"type": "obs", "key": "highres_celltype", "column": ""})})
    v["subset"] = {"n": 3000, "seed": 0, "part": 1}
    save_view("focus-outside", v)
    page = sh.open(v, dataset=D)
    page.click("#subset-part-next")
    page.wait_for_function("document.getElementById('subset-part-input').value === '3'", timeout=60000)
    page.wait_for_function("!document.getElementById('focused-cell-outside').hidden", timeout=60000)
    time.sleep(2)
    sh.ready(page)
    page.wait_for_function("""() => { const g = document.querySelector('.tile[data-tile-id="cell-plot-W"] .js-plotly-plot');
        return g && g._fullData && g._fullData.some(t => t.name === 'Focused Cell'); }""", timeout=60000)
    page.mouse.move(0, 0)
    page.evaluate("document.activeElement && document.activeElement.blur()")
    time.sleep(0.5)
    sh.log.append("focus-outside: badge = " + page.text_content("#focused-cell-outside")
                  + " | status = " + page.evaluate("""() => { const n = document.querySelector(
                      '.tile[data-tile-id="cell-plot-W"] .plot-status');
                      return n ? n.dataset.summary : null; }"""))
    capture_union(sh, page, "focus-outside-header", ["#focused-cell", "#focused-cell-outside", "#subset-parts"],
                  marks=[(1, "#focused-cell-outside")], pad=10)
    capture_union(sh, page, "focus-outside", [T("cell-plot-W"), T("cell-plot-T")], pad=2)

    # The picker: a cell of part 1, listed after part 3's matches and tagged
    page.click("#focused-cell")
    page.fill("#focused-cell", "HSPC_Young_1#AAAGG")
    page.wait_for_function("document.querySelector('.name-picker-option.outside') !== null", timeout=60000)
    time.sleep(0.5)
    capture_union(sh, page, "focus-outside-picker", ["#focused-cell", ".name-picker:has(#focused-cell) .name-picker-menu"],
                  pad=6)
    sh.log.append("focus-outside: picker = " + " | ".join(page.evaluate(
        "[...document.querySelectorAll('.name-picker-option')].slice(0, 8).map(li => li.textContent)")))
    page.context.close()


def draw_tooltip(path, anchor, text, scale):
    """Draw a browser-style tooltip with `text` under `anchor` (x0, y0, x1, y1 in image
    pixels). Headless Chromium does not render native `title` tooltips into
    screenshots, so the badge's real title text is drawn into the shot."""
    im = Image.open(path).convert("RGB")
    font = _font(int(11 * scale))
    lines = []
    for para in text.split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            trial = (line + " " + w).strip()
            if font.getlength(trial) > 430 * scale and line:
                lines.append(line)
                line = w
            else:
                line = trial
        lines.append(line)
    pad, lh = int(6 * scale), int(15 * scale)
    width = int(max(font.getlength(l) for l in lines)) + 2 * pad
    height = lh * len(lines) + 2 * pad
    x0 = int(min(max(0, anchor[0]), im.width - width - 2))
    y0 = int(anchor[3] + 4 * scale)
    canvas = Image.new("RGB", (max(im.width, x0 + width + 2), max(im.height, y0 + height + 2)), "white")
    canvas.paste(im, (0, 0))
    d = ImageDraw.Draw(canvas)
    d.rectangle([x0, y0, x0 + width, y0 + height], fill=(255, 255, 225), outline=(118, 118, 118))
    for i, l in enumerate(lines):
        d.text((x0 + pad, y0 + pad + i * lh), l, fill=(0, 0, 0), font=font)
    canvas.save(path)


def shoot_subset_balanced_parts(sh, data_dir):
    """A late part of a balanced partition: the small cell types are used up."""
    D = ds("bm_aging.zarr", data_dir)
    v = view(split("horizontal", tile("cell-plot-SB"), tile("cell-table-SC")),
             {"cell-plot-SB": cell_plot("cell-plot-SB", "Cell type", {"type": "obs", "key": "highres_celltype", "column": ""}),
              "cell-table-SC": {"id": "cell-table-SC", "title": "Cell table",
                                "columns": [{"type": "obs", "key": "highres_celltype", "column": ""}]}})
    v["subset"] = {"n": 1000, "seed": 0, "balance": "highres_celltype", "part": 6}
    v = save_view("subset-balanced-part", v)
    page = sh.open(v, dataset=D)
    page.wait_for_selector("#subset-parts:not([hidden])", timeout=60000)
    sh.ready(page)
    page.mouse.move(0, 0)
    title = page.get_attribute("#subset-button", "title")
    sh.log.append("subsets: balanced late part tooltip = " + title.replace("\n", " | "))
    sh.log.append("subsets: balanced late part = part " + page.input_value("#subset-part-input")
                  + " of " + page.text_content("#subset-part-count"))
    name = "subsets-balanced-late-part"
    capture_union(sh, page, name, ["#dataset-stats", T("cell-plot-SB")], pad=4)
    # hang the tooltip under the badge, right of the part stepper so it stays readable
    box = page.locator("#subset-button").bounding_box()
    parts = page.locator("#subset-parts").bounding_box()
    region = [page.locator(s_).first.bounding_box() for s_ in ("#dataset-stats", T("cell-plot-SB"))]
    x0 = max(0, min(b["x"] for b in region) - 4)
    y0 = max(0, min(b["y"] for b in region) - 4)
    anchor = ((parts["x"] + parts["width"] + 8 - x0) * DSF, (box["y"] - y0) * DSF,
              (box["x"] - x0 + box["width"]) * DSF, (box["y"] - y0 + box["height"]) * DSF)
    draw_tooltip(OUT / f"{name}.png", anchor, title, DSF)
    finish(OUT / f"{name}.png")
    page.context.close()


STEPS = {"interface": shoot_interface, "focus": shoot_focus, "plots": shoot_plots,
         "colour": shoot_colour, "tables": shoot_tables, "panelsets": shoot_panelsets,
         "share": shoot_share, "export": shoot_export, "spatial": shoot_spatial,
         "subsets": shoot_subsets, "subsets-balanced": shoot_subset_balanced_parts,
         "focus-outside": shoot_focus_outside}

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
