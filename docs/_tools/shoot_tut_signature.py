"""Screenshots and numbers for the tutorial "Is the stem cell ageing response kept as cells differentiate?"
(docs/tutorials/signature-score.md).

It drives the real interface the way the page tells a reader to: gene lists from cut-offs on the stored fold change (a Gene Table
filter, then Add from in a Gene Signature), the six scores, a signature with two sides, one-row sections per cell type and
age, and the lineage. It stops with "STEP FAILED" when the application does not do what the page says. Every number the
page quotes is printed in the log.

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_signature.py [--port 8862]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session, panelset_file, split, start_link, tile  # noqa: E402
from tut_ui import (T, add_panel, make_signature, agg_button, agg_menu, axis_sel, choose_agg, controls_dump, data_dir_with, fail, make_gene_table,  # noqa: E402
                    csv_of, hover_table, open_plain, pick_set, plot_colors, plot_data, rename, until)

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging_annzarro.zarr"
FC = "kompot_de_Young_to_Old_fold_change"


def shot_tile(page, pid, name):
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")
    page.evaluate("(t) => document.querySelector(t).scrollIntoView({block: 'start'})", T(pid))
    page.evaluate("() => { const a = document.activeElement; if (a && a.blur) a.blur(); }")
    page.mouse.move(2, 2)
    page.wait_for_timeout(500)
    box = page.locator(T(pid)).bounding_box()
    vh = page.viewport_size["height"]
    if box["y"] + box["height"] > vh:
        box["height"] = vh - box["y"]
    page.screenshot(path=str(OUT / f"{name}.png"), clip=box)


def save_view(page, name, tiles, closed, title):
    """The panels as they are now, as a view for a "Start here" link: `tiles` open side by side, `closed` kept closed."""
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfgs = view["layout"]["panelConfigs"]
    keep = {i: cfgs[i] for i in list(tiles) + list(closed)}
    node = tile(tiles[0])
    for other in tiles[1:]:
        node = split("horizontal", node, tile(other), 50)
    view["layout"] = {"v": 1, "hierarchy": [node], "controlState": {i: False for i in keep}, "panelConfigs": keep}
    for k in ("subset", "sessionStyles"):
        view.pop(k, None)
    VIEWS.mkdir(exist_ok=True)
    PANELSETS.mkdir(parents=True, exist_ok=True)
    (VIEWS / f"tut-signature-{name}.json").write_text(json.dumps(view, indent=1) + "\n")
    (PANELSETS / f"tut-signature-{name}.json").write_text(json.dumps(panelset_file(title, view, STORE), indent=1) + "\n")
    (PANELSETS / f"tut-signature-{name}.url.txt").write_text(start_link(STORE, view) + "\n")


def side_by_side(a, b, out):
    """Two shots of one tile next to each other, the pieces removed."""
    from PIL import Image
    ia, ib = Image.open(OUT / f"{a}.png").convert("RGB"), Image.open(OUT / f"{b}.png").convert("RGB")
    sheet = Image.new("RGB", (ia.width + ib.width + 40, max(ia.height, ib.height)), "white")
    sheet.paste(ia, (0, 0))
    sheet.paste(ib, (ia.width + 40, 0))
    sheet.save(OUT / f"{out}.png", optimize=True)
    (OUT / f"{a}.png").unlink()
    (OUT / f"{b}.png").unlink()


def finish(prefix="sig-"):
    """Re-save this page's shots; a large one as 256 colours (as shoot_we_steps.py does)."""
    from PIL import Image
    for path in sorted(OUT.glob(f"{prefix}*.png")):
        im = Image.open(path).convert("RGB")
        im.save(path, optimize=True)
        if path.stat().st_size > 400_000:
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def np_mean(v):
    return sum(v) / len(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8862)
    args = ap.parse_args()
    d = data_dir_with(STORE)
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(port=args.port, out=OUT, data_dir=d) as sh:
        log = sh.log.append
        log(f"date of the shots: {date.today().isoformat()}")
        page = open_plain(sh, d / STORE, viewport={"width": 1600, "height": 1400})
        shoot(sh, page, log)
    finish()


def add_grouping(page, title, columns):
    """A Cell Grouping with one factor per obs column."""
    cg = add_panel(page, "cell-grouping")
    gt = T(cg)
    for i, column in enumerate(columns):
        page.locator(f"{gt} button.cgrp-add").first.click()
        page.wait_for_timeout(500)
        page.locator("button.cgrp-add-item:visible").filter(has_text="Column").first.click()
        page.wait_for_timeout(600)
        sels = page.locator(f"{gt} select[class*='cgrp-addrow']")
        sels.nth(0).select_option("obs")
        page.wait_for_timeout(300)
        sels.nth(1).select_option(column)
        page.locator(f"{gt} button.btn-primary", has_text="Add").first.click()
        page.wait_for_timeout(2500)
    rename(page, cg, title)
    page.wait_for_timeout(1000)
    return cg


def hsc_table(page, grouping_title, title, op, value, log):
    """A Gene Table of the called genes (`is_de`) with the mean fold change in HSC as a column (the Cell groupings tab), filtered on it."""
    pid = add_panel(page, "gene-table")
    t = T(pid)
    page.wait_for_selector(f"{t} .nav-link", timeout=30000)
    page.locator(f"{t} .nav-link", has_text="var").first.click()
    page.wait_for_timeout(400)
    page.locator(f"{t} label:text-is('kompot_de_Young_to_Old_is_de')").first.click()
    page.locator(f"{t} .nav-link", has_text="Cell groupings").first.click()
    page.wait_for_timeout(800)
    row = page.locator(f"{t} .az-score-group:has(.az-score-group-title[title='{grouping_title}'])").first
    row.locator("select").nth(0).select_option("HSC")
    page.wait_for_timeout(400)
    row.locator("select").nth(1).select_option(FC)
    page.wait_for_timeout(600)
    row.locator("button.az-score-add-btn").click()
    page.wait_for_timeout(1000)
    page.locator(f"{t} button", has_text="Apply Changes").click()
    page.wait_for_timeout(5000)
    heads = page.evaluate("(t) => [...document.querySelectorAll(t + ' .dataTables_scrollHead th')].map(e => e.textContent.trim())", t)
    log(f"{title}: headers {heads}")
    rename(page, pid, title)
    hsc_col = [h for h in heads if h.startswith("HSC")][0]
    for i, (col, cond, val) in enumerate([("kompot_de_Young_to_Old_is_de", "Equals", "Yes"), (hsc_col, op, value)]):
        page.locator(f"{t} button", has_text="Add Condition").first.click()
        page.wait_for_timeout(800)
        c = page.locator(f"{t} .dtsb-criteria").nth(i)
        c.locator(".dtsb-data").select_option(label=col)
        page.wait_for_timeout(600)
        c.locator(".dtsb-condition").select_option(label=cond)
        page.wait_for_timeout(600)
        sel = c.locator("select.dtsb-value")
        if sel.count():
            sel.first.select_option(label=str(val))
        else:
            c.locator("input.dtsb-value").first.fill(str(val))
            c.locator("input.dtsb-value").first.press("Tab")
        page.wait_for_timeout(1500)
    n = page.evaluate("(i) => window.PanelManager.getPanel(i).getConfig().currentEntries.length", pid)
    log(f"{title}: {n} genes pass")
    return pid


def add_from(page, sig_tile, table_title, side=None):
    """Add from the genes of a gene table (Add as Up or Down when the signature has directions)."""
    if side:
        page.locator(f"{sig_tile} button.gsig-segopt", has_text=side).first.click()
        page.wait_for_timeout(300)
    page.locator(f"{sig_tile} button", has_text="Add from").first.click()
    page.wait_for_timeout(500)
    page.locator("button.gs-menu__item:visible").filter(has_text=table_title).first.click()
    page.wait_for_timeout(2000)


def one_row(page, plot_tile, index):
    page.locator(f"{plot_tile} select[class*='cgene-section']").nth(index).select_option("One row")
    page.wait_for_timeout(1500)


def add_section(page, plot_tile, name):
    page.locator(f"{plot_tile} button.cgene-add").first.click()
    page.wait_for_timeout(600)
    page.locator("button.cgene-add-item:visible").filter(has_text=name).first.click()
    page.wait_for_timeout(1500)


def cell_gene(page, groups, layer="logged_counts", by_grouping=None):
    pid = add_panel(page, "cell-gene")
    t = T(pid)
    if by_grouping is not None:
        page.locator(f"{t} select.cgene-axis-type").select_option(label="Cell Grouping")
        page.wait_for_timeout(500)
        page.locator(f"{t} select.cgene-axis-key").select_option(label=by_grouping)
    else:
        page.locator(f"{t} select.cgene-axis-type").select_option("obs")
        page.locator(f"{t} select.cgene-axis-key").select_option(groups)
    page.wait_for_timeout(1500)
    page.locator(f"{t} select.cgene-color-layer").select_option(layer)
    return pid


def paste(page, sig_tile, genes, side=None, log=None, name=""):
    """Paste a gene list into a signature panel (Add as `side` when it has directions); returns the preview's text."""
    page.locator(f"{sig_tile} button", has_text="Paste or upload").first.click()
    page.locator(f"{sig_tile} textarea").first.fill(", ".join(genes))
    page.locator(f"{sig_tile} button", has_text="Preview").first.click()
    page.wait_for_timeout(800)
    if side:
        page.locator(f"{sig_tile} select.gp-addas").select_option(label=side)
        page.wait_for_timeout(300)
    text = page.inner_text(sig_tile).replace("\n", " | ")
    if log:
        log(f"paste preview {name}: " + text[:600])
    return text


def exact(name):
    return re.compile(rf"^\s*{re.escape(name)}\s*$")


def add_section_exact(page, plot_tile, name):
    page.locator(f"{plot_tile} button.cgene-add").first.click()
    page.wait_for_timeout(600)
    page.locator("button.cgene-add-item:visible").filter(has_text=exact(name)).first.click()
    page.wait_for_timeout(1500)


def signature_from(page, title, tables, log, sides=None):
    """A Gene Signature filled with Add from, one table at a time (`sides` gives Up or Down for each, for a signature with two sides)."""
    sig = add_panel(page, "gene-signature")
    st = T(sig)
    rename(page, sig, title)
    if sides:
        page.locator(f"{st} button", has_text="Up/Down").first.click()
        page.wait_for_timeout(500)
    for i, table in enumerate(tables):
        add_from(page, st, table, sides[i] if sides else None)
        log(f"{title} after Add from {table}: " + page.inner_text(st).replace("\n", " | ")[:360])
    return sig


def one_row_color(page, tile_, pid):
    page.locator(f"{tile_} button.cgene-color").first.click()
    page.wait_for_timeout(400)
    page.locator(".axis-agg-item[data-agg='zscore_mean']").click()
    page.wait_for_timeout(3000)


def shoot(sh, page, log):
    # ---- 1. a gene list from a cut-off: the called genes whose mean fold change in HSCs is below -0.5
    g_type = add_grouping(page, "Cell type", ["midres_celltype"])
    t_fall = hsc_table(page, "Cell type", "Falls in HSCs table", "Less Than", "-0.5", log)
    shot_tile(page, t_fall, "sig-table-lo")
    t_rise = hsc_table(page, "Cell type", "Rises in HSCs table", "Greater Than", "0.5", log)
    sigF = signature_from(page, "Falls in HSCs", ["Falls in HSCs table"], log)
    shot_tile(page, sigF, "sig-add-from")
    sigR = signature_from(page, "Rises in HSCs", ["Rises in HSCs table"], log)
    cp = add_panel(page, "cell-plot")
    ct = T(cp)
    pick_set(page, ct, "color", sigF, layer="logged_counts")
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && (g.data || []).some(d => d.marker && d.marker.color && d.marker.color.length > 1000); }", "the coloured UMAP", ct, timeout=120)
    page.wait_for_timeout(1500)
    rows = agg_menu(page, ct, "color")
    log("aggregation list: " + json.dumps([(r["v"], r["sym"], r["name"], r["off"], r["why"] or r["title"]) for r in rows]))
    agg_menu(page, ct, "color", keep_open=True)
    shot_tile(page, cp, "sig-agg-button")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    shot_tile(page, cp, "sig-umap-lo")
    colors = plot_colors(page, cp)
    log(f"Falls in HSCs z-score mean on the UMAP: min {min(colors):.2f}, max {max(colors):.2f}")
    pick_set(page, ct, "color", sigR, layer="logged_counts")
    page.wait_for_timeout(3500)
    shot_tile(page, cp, "sig-umap-hi")
    colors = plot_colors(page, cp)
    log(f"Rises in HSCs z-score mean on the UMAP: min {min(colors):.2f}, max {max(colors):.2f}")
    side_by_side("sig-umap-lo", "sig-umap-hi", "sig-umap")
    cgt = cell_gene(page, None, by_grouping="Cell type")
    for name in ("Falls in HSCs", "Rises in HSCs"):
        add_section_exact(page, T(cgt), name)
    until(page, "(t) => document.querySelectorAll(t + ' select.form-select').length >= 8", "two sections", T(cgt), timeout=30)
    for i in (0, 1):
        one_row(page, T(cgt), i)
    one_row_color(page, T(cgt), cgt)
    shot_tile(page, cgt, "sig-three-rows")
    d1 = csv_of(page, cgt, "/tmp/sig-type.csv")
    c1 = [c for c in d1.columns if c.startswith("Z-score")][0]
    for sec, part in d1.groupby("Section"):
        v1 = part.set_index("Group")[c1].sort_values(ascending=False)
        log(f"  {sec} by cell type: highest " + ", ".join(f"{k} {float(x):.2f}" for k, x in list(v1.items())[:5]) + f"; HSC {float(v1['HSC']):.2f}; Neutrophil {float(v1['Neutrophil']):.2f}; Monocyte {float(v1['Monocyte']):.2f}; T cell {float(v1['T cell']):.2f}")
    # ---- 2. a signature with two sides: what rises and falls over all cells
    t_up = make_gene_table(page, "Rises over all cells table", [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mean_lfc")],
                           [("kompot_de_Young_to_Old_is_de", "Equals", "Yes"), ("kompot_de_Young_to_Old_mean_lfc", "Greater Than", "0.05")], log)
    t_dn = make_gene_table(page, "Falls over all cells table", [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mean_lfc")],
                           [("kompot_de_Young_to_Old_is_de", "Equals", "Yes"), ("kompot_de_Young_to_Old_mean_lfc", "Less Than", "-0.05")], log)
    sigUD = signature_from(page, "Response over all cells", ["Rises over all cells table", "Falls over all cells table"], log, sides=["Up", "Down"])
    shot_tile(page, sigUD, "sig-panel")
    pick_set(page, ct, "color", sigUD, layer="logged_counts")
    page.wait_for_timeout(3500)
    rows = agg_menu(page, ct, "color")
    log("aggregation list with down genes: " + json.dumps([(r["v"], r["off"], r["why"] or r["title"]) for r in rows]))
    page.locator(f"{T(sigUD)} button", has_text="Methods").first.click()
    page.wait_for_timeout(600)
    shot_tile(page, sigUD, "sig-methods")
    page.keyboard.press("Escape")
    g_age = add_grouping(page, "Cell type by age", ["midres_celltype", "Age"])
    log("Cell type by age: " + page.inner_text(T(g_age)).replace("\n", " | ")[:200])
    shot_tile(page, g_age, "sig-grouping")
    cga = cell_gene(page, None, by_grouping="Cell type by age")
    for name in ("Falls in HSCs", "Response over all cells"):
        add_section_exact(page, T(cga), name)
    until(page, "(t) => document.querySelectorAll(t + ' select.form-select').length >= 8", "two sections", T(cga), timeout=30)
    for i in (0, 1):
        one_row(page, T(cga), i)
    one_row_color(page, T(cga), cga)
    page.locator(f"{T(cga)} select.cgene-mode").select_option(label="Heatmap")
    page.wait_for_timeout(2000)
    page.locator(f"{T(cga)} button.cgene-swap").first.click()
    page.wait_for_timeout(2500)
    shot_tile(page, cga, "sig-age-rows")
    d2 = csv_of(page, cga, "/tmp/sig-age.csv")
    c2 = [c for c in d2.columns if c.startswith("Z-score")][0]
    for sec, part in d2.groupby("Section"):
        vals = part.set_index("Group")[c2]
        log(f"  {sec}: " + "; ".join(f"{k} {float(vals[k]):.2f}" for k in ("HSC | Young", "HSC | Mid", "HSC | Old", "LMPP | Young", "LMPP | Old", "Neutrophil | Young", "Neutrophil | Old", "Monocyte | Young", "Monocyte | Old", "T cell | Young", "T cell | Old", "Mature B cell | Young", "Mature B cell | Old") if k in vals.index))
        ages = {a: round(float(np_mean([v for k, v in vals.items() if k.endswith("| " + a)])), 3) for a in ("Young", "Mid", "Old")}
        log(f"  {sec}: mean over the cell types by age {ages}")
    # ---- 3. the lineage
    g_stage = add_grouping(page, "Stage", ["highres_celltype"])
    page.locator(f"{T(g_stage)} button", has_text="Edit").first.click()
    page.wait_for_timeout(700)
    pop = page.locator("[data-popover]").filter(has_text="Levels of highres_celltype").first
    pop.get_by_text("Tick none", exact=True).click()
    page.wait_for_timeout(500)
    for stage in ("HSC", "LMPP", "GMP", "Myelo P", "Neutrophil"):
        pop.locator(f"input[type=checkbox][aria-label='{stage}']").check()
        page.wait_for_timeout(250)
    pop.get_by_text("Leave out of all groups", exact=True).click()
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")
    page.wait_for_timeout(1000)
    log("Stage grouping: " + page.inner_text(T(g_stage)).replace("\n", " | ")[:420])
    cgs = cell_gene(page, None, layer=FC, by_grouping="Stage")
    for name in ("Falls in HSCs", "Rises in HSCs"):
        add_section_exact(page, T(cgs), name)
    until(page, "(t) => document.querySelectorAll(t + ' select.form-select').length >= 8", "two sections", T(cgs), timeout=30)
    page.wait_for_timeout(3000)
    page.locator(f"{T(cgs)} button.cgene-color-btn").first.click()
    page.wait_for_timeout(500)
    page.locator('[data-popover] select[data-option="colorScale"]').select_option("RdBu")
    page.locator('[data-popover] input[data-option="center"]').fill("0")
    page.locator('[data-popover] input[data-option="center"]').press("Enter")
    page.wait_for_timeout(1000)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    shot_tile(page, cgs, "sig-lineage-dots")
    d4 = csv_of(page, cgs, "/tmp/sig-lineage.csv")
    c4 = [c for c in d4.columns if c.startswith("Mean")][0]
    for sec, part in d4.groupby("Section"):
        by = part.groupby("Group")[c4].mean()
        log(f"  {sec}: mean fold change over its genes by stage: " + ", ".join(f"{k} {float(by[k]):.3f}" for k in by.index))
    save_view(page, "lineage", [cgs], [sigF, sigR, g_stage], "Signature tutorial: the fold change along the neutrophil lineage")
    # ---- 4. the volcano
    gpl = add_panel(page, "gene-plot")
    gpt = T(gpl)
    page.locator(f"{gpt} button", has_text="3D").first.click()
    page.wait_for_timeout(1500)
    page.select_option(axis_sel(gpt, "color", "type"), "none")
    page.wait_for_timeout(800)
    for axis, col in (("x", "kompot_de_Young_to_Old_mean_lfc"), ("y", "kompot_de_Young_to_Old_mahalanobis")):
        page.select_option(axis_sel(gpt, axis, "type"), "var")
        page.wait_for_timeout(500)
        page.select_option(axis_sel(gpt, axis, "key"), col)
        page.wait_for_timeout(800)
    page.select_option(f"{gpt} select[class*=table-filter]", sigF)
    page.wait_for_timeout(3000)
    shot_tile(page, gpl, "sig-volcano")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
