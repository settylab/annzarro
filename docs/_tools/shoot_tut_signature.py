"""Screenshots and numbers for the tutorial "Do stem cells carry the published signature of ageing?"
(docs/tutorials/signature-score.md).

It drives the real interface the way the page tells a reader to and stops with "STEP FAILED" when the application does
not do what the page says. Every number the page quotes is printed in the log.

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_signature.py [--port 8862] [--signature PATH]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data). The signature file is
docs/_static/downloads/hsc-ageing-signature.csv unless --signature names another.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import Session, panelset_file, split, start_link, tile  # noqa: E402
from tut_ui import (T, add_panel, agg_button, agg_menu, axis_sel, choose_agg, controls_dump, data_dir_with, fail, make_gene_table,  # noqa: E402
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


def store_numbers(genes):
    """What the stored var columns say of the signature's genes, for the page's volcano step."""
    import numpy as np
    import zarr
    from shots import DATA_DIR
    st = zarr.open(str(DATA_DIR / STORE), mode="r")
    names = np.array([g.decode() if isinstance(g, bytes) else g for g in st["var/_index"][:]])
    de = st["var/kompot_de_Young_to_Old_is_de"][:].astype(bool)
    mah = st["var/kompot_de_Young_to_Old_mahalanobis"][:]
    lfc = st["var/kompot_de_Young_to_Old_mean_lfc"][:]
    hsc = st["var/hsc_fold_change"][:]
    rank = (-mah).argsort().argsort() + 1
    idx = [int(np.where(names == g)[0][0]) for g in genes if g in names]
    called = [genes[i] for i, k in enumerate([int(np.where(names == g)[0][0]) for g in genes if g in names]) if de[k]]
    out = [f"signature genes in the store: {len(idx)} of {len(genes)}; called by Kompot: {len(called)} {called}"]
    out.append("Mahalanobis rank (of %d): %s" % (len(names), {names[k]: int(rank[k]) for k in idx}))
    out.append(f"mean_lfc of the signature genes: median {float(np.median(lfc[idx])):.3f}, range {float(lfc[idx].min()):.3f} to {float(lfc[idx].max()):.3f}; hsc_fold_change median {float(np.median(hsc[idx])):.3f}, range {float(hsc[idx].min()):.3f} to {float(hsc[idx].max()):.3f}")
    return " | ".join(out)


def np_mean(v):
    return sum(v) / len(v)


def finish(prefix="sig-"):
    """Re-save this page's shots; a large one as 256 colours (as shoot_we_steps.py does)."""
    from PIL import Image
    for path in sorted(OUT.glob(f"{prefix}*.png")):
        im = Image.open(path).convert("RGB")
        im.save(path, optimize=True)
        if path.stat().st_size > 400_000:
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8862)
    ap.add_argument("--signature", default=str(DOCS / "_static" / "downloads" / "hsc-ageing-signature.csv"))
    args = ap.parse_args()
    d = data_dir_with(STORE)
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(port=args.port, out=OUT, data_dir=d) as sh:
        log = sh.log.append
        log(f"date of the shots: {date.today().isoformat()}; signature file {args.signature}")
        page = open_plain(sh, d / STORE, viewport={"width": 1600, "height": 1400})
        shoot(sh, page, log, args.signature)
    finish()


def shoot(sh, page, log, sigfile):
    # ---- 1. the published signature, from a file with a sign column
    sig = add_panel(page, "gene-signature")
    st = T(sig)
    rename(page, sig, "HSC ageing (published)")
    page.locator(f"{st} button", has_text="Up/Down").first.click()
    page.wait_for_timeout(500)
    page.locator(f"{st} button", has_text="Paste or upload").first.click()
    page.locator(f"{st} input[type=file]").set_input_files(sigfile)
    page.wait_for_timeout(1500)
    page.locator(f"{st} select:has(option:text-is('None'))").first.select_option(label="direction_log2fc")
    page.wait_for_timeout(600)
    add = page.locator(f"{st} button.btn-primary", has_text="Add ")
    log("the Add button reads: " + add.first.inner_text())
    shot_tile(page, sig, "sig-paste-sign")
    add.first.click()
    page.wait_for_timeout(1500)
    log("status: " + page.inner_text(f"{st} .tile-content").replace("\n", " | ")[:400])
    shot_tile(page, sig, "sig-panel")
    # ---- 2. a Cell Plot coloured by the score
    cp = add_panel(page, "cell-plot")
    ct = T(cp)
    log("a new Cell Plot: " + json.dumps(page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return [c.x, c.y, c.color]; }", cp))[:400])
    pick_set(page, ct, "color", sig, layer="X")
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && (g.data || []).some(d => d.marker && d.marker.color && d.marker.color.length > 1000); }", "the coloured UMAP", ct, timeout=120)
    page.wait_for_timeout(1500)
    log(f"button reads: {page.get_attribute(agg_button(ct, 'color'), 'aria-label')}")
    rows = agg_menu(page, ct, "color")
    log("aggregation list on X: " + json.dumps([(r["v"], r["sym"], r["name"], r["off"], r["why"] or r["title"], r["on"]) for r in rows]))
    page.select_option(axis_sel(ct, "color", "key"), "logged_counts")
    page.wait_for_timeout(3000)
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && (g.data || []).some(d => d.marker && d.marker.color && d.marker.color.length > 1000); }", "the UMAP on logged_counts", ct, timeout=120)
    rows = agg_menu(page, ct, "color")
    log("aggregation list on logged_counts: " + json.dumps([(r["v"], r["off"], r["why"] or r["title"]) for r in rows]))
    cols = plot_colors(page, cp)
    log(f"UMAP colours: n {len(cols)}, min {min(cols):.2f}, max {max(cols):.2f}, mean {sum(cols)/len(cols):.3f}")
    choose_agg(page, ct, "color", "zscore_mean")
    page.wait_for_timeout(1500)
    agg_menu(page, ct, "color", keep_open=True)
    shot_tile(page, cp, "sig-agg-button")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    shot_tile(page, cp, "sig-umap")
    # ---- 3. the methods of the signature
    page.locator(f"{st} button.gsig-methods-toggle, {st} button", has_text="Methods").first.click()
    page.wait_for_timeout(600)
    log("Methods pop-over: " + str(page.evaluate("() => [...document.querySelectorAll('[data-popover]')].filter(e => e.getBoundingClientRect().width).map(e => e.innerText.slice(0, 1500))")))
    shot_tile(page, sig, "sig-methods")
    page.keyboard.press("Escape")
    # ---- 4. the distribution
    nplots = len(page.evaluate("() => window.PanelManager.getPanelsByType('cell-count')"))
    page.locator(f"{st} button", has_text="Distribution").first.click()
    until(page, "() => window.PanelManager.getPanelsByType('cell-count').length > 0", "a Cell Count Plot", timeout=60)
    cc = page.evaluate("() => window.PanelManager.getPanelsByType('cell-count').map(p => p.getId()).slice(-1)[0]")
    page.wait_for_timeout(4000)
    log("count plot config: " + json.dumps(page.evaluate("(i) => window.PanelManager.getPanel(i).getConfig()", cc))[:700])
    log("count plot controls: " + controls_dump(page, T(cc))[:1800])
    cct = T(cc)
    page.locator(f"{cct} select.axis-layer-select").first.select_option("logged_counts")
    page.wait_for_timeout(3000)
    # Color by: the second axis row
    page.locator(f"{cct} select.axis-type-select[data-axis='split']").select_option("obs")
    page.wait_for_timeout(600)
    page.locator(f"{cct} select.axis-key-select[data-axis='split']").select_option("Age")
    page.wait_for_timeout(3000)
    log("count plot config: " + json.dumps(page.evaluate("(i) => window.PanelManager.getPanel(i).getConfig()", cc))[:900])
    log("arrangements: " + json.dumps(page.evaluate("(t) => [...document.querySelectorAll(t + ' .ccnt-arrangement__input')].map(e => [e.value, e.checked, (e.closest('label') || {}).textContent])", cct)))
    page.locator(f"{cct} label", has_text="Overlaid").first.click()
    page.wait_for_timeout(2500)
    shot_tile(page, cc, "sig-distribution")
    cnt = page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return gd.data.map(d => [d.name, d.type, (d.y || []).reduce((a, b) => a + b, 0)]); }""", cct)
    log(f"histogram traces (name, type, cells): {cnt}")
    # ---- 5. per group: a Cell Grouping of cell type and age
    cg = add_panel(page, "cell-grouping")
    gt = T(cg)
    log("a new Cell Grouping: " + controls_dump(page, gt)[:1600])
    page.locator(f"{gt} button", has_text="Add factor").first.click()
    page.wait_for_timeout(600)
    log("Add factor menu: " + str(page.evaluate("() => [...document.querySelectorAll('button.cgrp-add-item')].map(e => e.textContent.trim())")))
    page.locator("button.cgrp-add-item").filter(has_text="Column").first.click()
    page.wait_for_timeout(800)
    def add_factor(column):
        sels = page.locator(f"{gt} select[class*='cgrp-addrow']")
        sels.nth(0).select_option("obs")
        page.wait_for_timeout(300)
        sels.nth(1).select_option(column)
        page.locator(f"{gt} button.btn-primary", has_text="Add").first.click()
        page.wait_for_timeout(2500)

    add_factor("midres_celltype")
    page.locator("button.cgrp-add").first.click()
    page.locator("button.cgrp-add-item").filter(has_text="Column").first.click()
    page.wait_for_timeout(600)
    add_factor("Age")
    rename(page, cg, "Cell type by age")
    page.wait_for_timeout(1500)
    log("grouping panel text: " + page.inner_text(gt).replace("\n", " | ")[:1800])
    log("grouping config: " + json.dumps(page.evaluate("(i) => window.PanelManager.getPanel(i).getConfig()", cg))[:900])
    shot_tile(page, cg, "sig-grouping")
    # ---- 6. a Cell-Gene Plot of the genes of the signature over the groups
    cgp = add_panel(page, "cell-gene")
    gp = T(cgp)
    page.locator(f"{gp} select.cgene-axis-type").select_option(label="Cell Grouping")
    page.wait_for_timeout(500)
    page.locator(f"{gp} select.cgene-axis-key").select_option(index=1)
    page.wait_for_timeout(1500)
    page.locator(f"{gp} select.cgene-color-layer").select_option("logged_counts")
    page.locator(f"{gp} button.cgene-add").first.click()
    page.wait_for_timeout(300)
    page.locator("button.cgene-add-item:visible").filter(has_text="HSC ageing").first.click()
    page.wait_for_timeout(1500)
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && (g.data || []).some(d => d.marker && d.marker.color && d.marker.color.length > 100); }", "the dot plot", gp, timeout=120)
    page.wait_for_timeout(2000)
    shot_tile(page, cgp, "sig-dotplot-genes")
    page.locator(f"{gp} button.az-card__more").first.click()
    page.wait_for_timeout(500)
    log("card menu: " + str(page.evaluate("() => [...document.querySelectorAll('[data-popover] button, [role=menuitem]')].filter(e => e.getBoundingClientRect().width).map(e => e.textContent.trim())")))
    page.locator("[data-popover]").get_by_text("Duplicate", exact=True).first.click()
    page.wait_for_timeout(2000)
    until(page, "(t) => document.querySelectorAll(t + ' select.form-select').length >= 8", "the copy of the section", gp, timeout=30)
    sections = page.locator(f"{gp} select[class*='cgene-section']")
    log(f"sections now: {sections.count()}")
    sections.nth(1).select_option("One row")
    page.wait_for_timeout(2500)
    choose_agg_cg = lambda which, value: (page.locator(f"{gp} button.cgene-{which}").first.click(), page.wait_for_timeout(400), page.locator(f".axis-agg-item[data-agg='{value}']").click(), page.wait_for_timeout(2500))
    choose_agg_cg("color", "zscore_mean")
    page.wait_for_timeout(2000)
    shot_tile(page, cgp, "sig-dotplot")
    df = csv_of(page, cgp, "/tmp/sig-dotplot.csv")
    log("CSV columns: " + str(list(df.columns)) + f"; sections {df['Section'].unique().tolist()}")
    col = [c for c in df.columns if c.startswith("Z-score") or c.startswith("Mean")][0]
    one = df[df["Section"].str.contains("copy")]
    log(f"one-row section rows: {len(one)}; sample: {one[['Row', 'Group', col]].head(3).values.tolist()}")
    for grp in ("HSC | Young", "HSC | Mid", "HSC | Old", "LMPP | Old", "MKP | Old", "MKP | Young", "Neutrophil | Old", "T cell | Old"):
        r = one[one["Group"] == grp]
        if len(r):
            log(f"  {grp}: {float(r[col].iloc[0]):.3f}")
    save_view(page, "score", [cp, cgp], [sig, cg], "Signature tutorial: the score and its groups")
    # ---- 7. Kompot's view of the same genes: a second plot, mean of the fold-change layer
    cgf = add_panel(page, "cell-gene")
    ft = T(cgf)
    page.locator(f"{ft} select.cgene-axis-type").select_option("obs")
    page.locator(f"{ft} select.cgene-axis-key").select_option("midres_celltype")
    page.locator(f"{ft} button.cgene-add").first.click()
    page.wait_for_timeout(800)
    page.locator("button.cgene-add-item:visible").filter(has_text="HSC ageing").first.click()
    page.wait_for_timeout(1000)
    page.locator(f"{ft} select.cgene-color-layer").select_option(FC)
    page.wait_for_timeout(2000)
    page.locator(f"{ft} select.cgene-mode").select_option(label="Heatmap")
    page.wait_for_timeout(2500)
    page.locator(f"{ft} button.cgene-color-btn").first.click()
    page.wait_for_timeout(500)
    page.locator('[data-popover] select[data-option="colorScale"]').select_option("RdBu")
    page.locator('[data-popover] input[data-option="center"]').fill("0")
    page.locator('[data-popover] input[data-option="center"]').press("Enter")
    page.wait_for_timeout(1000)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    shot_tile(page, cgf, "sig-fc-heatmap")
    fc = csv_of(page, cgf, "/tmp/sig-fc.csv")
    fcol = [c for c in fc.columns if c.startswith("Mean")][0]
    g = fc.pivot_table(index="Row", columns="Group", values=fcol)
    down = ("Cd34", "Satb1", "Usp6nl", "Fgd5", "Flt3")
    up = [x for x in g.index if x not in down]
    log(f"fold change in HSC: {int((g.loc[up, 'HSC'] > 0).sum())} of {len(up)} up genes positive; mean {g.loc[up, 'HSC'].mean():.2f}; in Monocyte {g.loc[up, 'Monocyte'].mean():.2f}; Neutrophil {g.loc[up, 'Neutrophil'].mean():.2f}")
    log("  down genes in HSC: " + str({x: round(float(g.loc[x, 'HSC']), 2) for x in g.index if x in down}))
    log("  top HSC: " + str(g['HSC'].sort_values(ascending=False).head(6).round(2).to_dict()))
    # ---- 8. did Kompot call them? a gene table, and a Gene Plot of the volcano with the signature as its Table
    gt2 = make_gene_table(page, "Kompot", [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mahalanobis"), ("var", "hsc_fold_change")], None, log)
    gpl = add_panel(page, "gene-plot")
    gpt = T(gpl)
    log("a new Gene Plot: " + json.dumps(page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return [c.x, c.y, c.color, c.tableFilter]; }", gpl))[:500])
    page.locator(f"{gpt} button", has_text="3D").first.click()          # a new Gene Plot on the principal components opens in 3D
    page.wait_for_timeout(1500)
    page.select_option(axis_sel(gpt, "color", "type"), "none")
    page.wait_for_timeout(800)
    for axis, col in (("x", "kompot_de_Young_to_Old_mean_lfc"), ("y", "kompot_de_Young_to_Old_mahalanobis")):
        page.select_option(axis_sel(gpt, axis, "type"), "var")
        page.wait_for_timeout(500)
        page.select_option(axis_sel(gpt, axis, "key"), col)
        page.wait_for_timeout(800)
    page.wait_for_timeout(2500)
    sig_genes = [r.split(",")[0] for r in Path(sigfile).read_text().splitlines()[1:] if r.strip()]
    log(store_numbers(sig_genes))
    page.select_option(f"{gpt} select[class*=table-filter]", sig)
    page.wait_for_timeout(2500)
    shot_tile(page, gpl, "sig-volcano-lfc")
    page.select_option(axis_sel(gpt, "x", "key"), "hsc_fold_change")
    page.wait_for_timeout(3000)
    shot_tile(page, gpl, "sig-volcano-hsc")
    side_by_side("sig-volcano-lfc", "sig-volcano-hsc", "sig-volcano")
    # ---- 9. the reverse direction: a signature of Kompot's called genes, up and down
    up_t = make_gene_table(page, "Kompot up", [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mean_lfc")],
                           [("kompot_de_Young_to_Old_is_de", "Equals", "Yes"), ("kompot_de_Young_to_Old_mean_lfc", "Greater Than", "0")], log)
    dn_t = make_gene_table(page, "Kompot down", [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mean_lfc")],
                           [("kompot_de_Young_to_Old_is_de", "Equals", "Yes"), ("kompot_de_Young_to_Old_mean_lfc", "Less Than", "0")], log)
    sig2 = add_panel(page, "gene-signature")
    s2 = T(sig2)
    rename(page, sig2, "Kompot DE")
    page.locator(f"{s2} button", has_text="Up/Down").first.click()
    page.wait_for_timeout(500)
    for side, table in (("Up", "Kompot up"), ("Down", "Kompot down")):
        page.locator(f"{s2} button.gsig-segopt", has_text=side).first.click()
        page.wait_for_timeout(300)
        page.locator(f"{s2} button", has_text="Add from").first.click()
        page.wait_for_timeout(500)
        page.locator("button.gs-menu__item").filter(has_text=table).first.click()
        page.wait_for_timeout(2000)
    log("Kompot DE status: " + page.inner_text(s2).replace("\n", " | ")[:300])
    shot_tile(page, sig2, "sig-kompot-signature")
    # ---- 10. both signatures as one-row sections of one plot over cell type by age
    two = add_panel(page, "cell-gene")
    tt = T(two)
    page.locator(f"{tt} select.cgene-axis-type").select_option(label="Cell Grouping")
    page.wait_for_timeout(500)
    page.locator(f"{tt} select.cgene-axis-key").select_option(index=1)
    page.wait_for_timeout(1500)
    page.locator(f"{tt} select.cgene-color-layer").select_option("logged_counts")
    for name in ("HSC ageing", "Kompot DE"):
        page.locator(f"{tt} button.cgene-add").first.click()
        page.wait_for_timeout(600)
        page.locator("button.cgene-add-item:visible").filter(has_text=name).first.click()
        page.wait_for_timeout(1500)
    until(page, "(t) => document.querySelectorAll(t + ' select.form-select').length >= 8", "the two sections", tt, timeout=30)
    for i in (0, 1):
        page.locator(f"{tt} select[class*='cgene-section']").nth(i).select_option("One row")
        page.wait_for_timeout(1500)
    page.locator(f"{tt} button.cgene-color").first.click()
    page.wait_for_timeout(400)
    page.locator(".axis-agg-item[data-agg='zscore_mean']").click()
    page.wait_for_timeout(3000)
    shot_tile(page, two, "sig-two-rows")
    d2 = csv_of(page, two, "/tmp/sig-two.csv")
    c2 = [c for c in d2.columns if c.startswith("Z-score")][0]
    log("two-row CSV sections: " + str(d2["Section"].unique().tolist()))
    for sec, part in d2.groupby("Section"):
        vals = part.set_index("Group")[c2]
        log(f"  {sec}: HSC {vals['HSC | Young']:.2f} / {vals['HSC | Mid']:.2f} / {vals['HSC | Old']:.2f}; MKP {vals['MKP | Young']:.2f} / {vals['MKP | Mid']:.2f} / {vals['MKP | Old']:.2f}; Neutrophil {vals['Neutrophil | Young']:.2f} / {vals['Neutrophil | Mid']:.2f} / {vals['Neutrophil | Old']:.2f}; T cell {vals['T cell | Young']:.2f} / {vals['T cell | Mid']:.2f} / {vals['T cell | Old']:.2f}")
        ages = {a: float(np_mean([v for k, v in vals.items() if k.endswith("| " + a)])) for a in ("Young", "Mid", "Old")}
        log(f"  {sec}: mean over cell types by age {ages}")
    # ---- 11. rank cells: a Cell Table with the score as a column
    ctab = add_panel(page, "cell-table")
    cts = T(ctab)
    page.wait_for_selector(f"{cts} .nav-link", timeout=30000)
    log("Cell Table tabs: " + str(page.evaluate("(t) => [...document.querySelectorAll(t + ' .nav-link')].map(e => e.textContent.trim())", cts)))
    page.locator(f"{cts} .nav-link", has_text="Gene score").first.click()
    page.wait_for_timeout(800)
    for label in ("HSC ageing (published)", "Kompot DE"):
        grp = page.locator(f"{cts} .az-score-group").filter(has_text=label).first
        grp.locator("select.az-score-add-layer").select_option("logged_counts")
        page.wait_for_timeout(500)
        grp.locator("button.az-score-add-btn").click()
        page.wait_for_timeout(1200)
    page.locator(f"{cts} .nav-link", has_text="obs").first.click()
    page.wait_for_timeout(500)
    page.locator(f"{cts} label:text-is('kompot_da_Young_to_Old_lfc')").first.click()
    page.wait_for_timeout(400)
    page.locator(f"{cts} button", has_text="Apply Changes").click()
    page.wait_for_timeout(5000)
    heads = page.evaluate("(t) => [...document.querySelectorAll(t + ' .dataTables_scrollHead th')].map(e => e.textContent.trim())", cts)
    log("table headers: " + str(heads))
    # sort by the published score, descending: click its header until the first rows are the highest
    hd = [i for i, h in enumerate(heads) if "HSC ageing" in h][0]
    for _ in range(2):
        page.locator(f"{cts} .dataTables_scrollHead th").nth(hd).click()
        page.wait_for_timeout(1500)
    rows = page.evaluate("(t) => [...document.querySelectorAll(t + ' .dataTables_scrollBody tbody tr')].slice(0, 6).map(r => [...r.querySelectorAll('td')].map(c => c.textContent.trim()))", cts)
    log("top rows by the published score: " + json.dumps(rows))
    shot_tile(page, ctab, "sig-cell-table")
    save_view(page, "compare", [two, gpl], [sig, sig2, cg, gt2, up_t, dn_t], "Signature tutorial: the published and Kompot signatures")
    # ---- 12. the scoring itself against the stored S score, with the published S phase list (docs/_static/downloads/s-phase-genes.txt)
    sphase = DOCS / "_static" / "downloads" / "s-phase-genes.txt"
    if not sphase.exists():
        log("TODO(paper): step 12 skipped, docs/_static/downloads/s-phase-genes.txt (the S phase genes of Tirosh et al.) is not in the repository yet")
    else:
        log("step 12: the S phase file is there, the check is still to be written")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
