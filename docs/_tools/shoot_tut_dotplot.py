"""Screenshots and numbers for the tutorial "Where does each gene change with age?" (docs/tutorials/marker-dot-plot.md).

It drives the real interface the way the page tells a reader to: adds Gene Signature panels and types or pastes
their genes, adds a Cell-Gene Plot, chooses its groups and the signatures, opens the Size button, scales and
clusters it, then does the same for the fold-change layer of Kompot. It stops with "STEP FAILED" when the
application does not do what the page says. Every number the page quotes is read from the application here and
written to the log; the page prints what this script printed.

Writes
  docs/_static/screens/tutorials/dotplot-*.png
  docs/_tools/views/tut-dotplot-*.json                   the views the "Start here" links open
  docs/_static/panelsets/tutorials/tut-dotplot-*.json    their panel set files and .url.txt links

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_dotplot.py [--port 8861]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data).
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
from tut_ui import T, add_panel, make_gene_table, controls_dump, data_dir_with, fail, make_signature, open_plain, plot_data, rename, until  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "tutorials"
STORE = "bm_aging_annzarro.zarr"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "tutorials"
FC = "kompot_de_Young_to_Old_fold_change"

LINEAGES = [
    ("Stem and progenitor", ["Hlf", "Mecom", "Procr", "Mpl"], False),
    ("Megakaryocyte", ["Pf4", "Itga2b", "Gp9"], True),
    ("Erythroid", ["Klf1", "Gata1", "Car1"], True),
    ("Myeloid", ["Elane", "Mpo", "Ngp", "Ltf", "S100a8"], True),
    ("Monocyte", ["Csf1r", "Ccr2", "Ly6c2", "Irf8"], True),
    ("pDC", ["Siglech"], True),
    ("B cell", ["Ebf1", "Vpreb1", "Cd79a", "Cd19", "Ms4a1"], True),
    ("T cell", ["Cd3e", "Cd8a", "Foxp3"], True),
]


def shot_tile(page, pid, name, pad=0):
    """The tile with whatever is open over it."""
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")
    # the tile's top to the top of the scrolling area, so a tile lower in the stack is in the frame
    page.evaluate("""(t) => { const e = document.querySelector(t); e.scrollIntoView({block: 'start'}); }""", T(pid))
    page.evaluate("() => { const a = document.activeElement; if (a && a.blur) a.blur(); }")
    page.mouse.move(2, 2)
    page.wait_for_timeout(500)
    box = page.locator(T(pid)).bounding_box()
    vh = page.viewport_size["height"]
    if box["y"] + box["height"] > vh:
        box["height"] = vh - box["y"]
    page.screenshot(path=str(OUT / f"{name}.png"), clip={"x": box["x"] - pad, "y": box["y"] - pad, "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad})


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
    (VIEWS / f"tut-dotplot-{name}.json").write_text(json.dumps(view, indent=1) + "\n")
    (PANELSETS / f"tut-dotplot-{name}.json").write_text(json.dumps(panelset_file(title, view, STORE), indent=1) + "\n")
    (PANELSETS / f"tut-dotplot-{name}.url.txt").write_text(start_link(STORE, view) + "\n")


def side_by_side(a, b, out, names=(0.02, 0.085), body=(0.34, 0.445), rows=(0.46, 0.97)):
    """The group names and the myeloid section of two tile shots next to each other, the two pieces removed."""
    from PIL import Image

    def piece(path):
        im = Image.open(path).convert("RGB")
        w, h = im.size
        y = (int(rows[0] * h), int(rows[1] * h))
        n = im.crop((int(names[0] * w), y[0], int(names[1] * w), y[1]))
        m = im.crop((int(body[0] * w), y[0], int(body[1] * w), y[1]))
        sheet = Image.new("RGB", (n.width + m.width, n.height), "white")
        sheet.paste(n, (0, 0))
        sheet.paste(m, (n.width, 0))
        return sheet

    pa, pb = piece(OUT / f"{a}.png"), piece(OUT / f"{b}.png")
    sheet = Image.new("RGB", (pa.width * 2 + 40, pa.height), "white")
    sheet.paste(pa, (0, 0))
    sheet.paste(pb, (pa.width + 40, 0))
    sheet.save(OUT / f"{out}.png", optimize=True)
    (OUT / f"{a}.png").unlink()
    (OUT / f"{b}.png").unlink()


def cell_values(page, pid):
    """{(group, gene): (colour, size)} of the dots of a Cell-Gene Plot, from the figure."""
    traces = plot_data(page, pid)
    main = next(t for t in traces if t["type"] == "scatter" and t["color"] and len(t["x"] or []) > 5)
    return main


def finish(prefix="dotplot-"):
    """Re-save this page's shots; a large one as 256 colours (as shoot_we_steps.py does)."""
    from PIL import Image
    for path in sorted(OUT.glob(f"{prefix}*.png")):
        im = Image.open(path).convert("RGB")
        im.save(path, optimize=True)
        if path.stat().st_size > 400_000:
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8861)
    args = ap.parse_args()
    d = data_dir_with(STORE)
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(port=args.port, out=OUT, data_dir=d) as sh:
        log = sh.log.append
        log(f"date of the shots: {date.today().isoformat()}")
        page = open_plain(sh, d / STORE, viewport={"width": 1600, "height": 1400})
        shoot(sh, page, log)
    finish()


def hover_table(page, pid):
    """{(group, gene): [lines of its hover]} of every dot, from the figure (a section may be a trace of its own)."""
    out = {}
    for tr in plot_data(page, pid):
        for h in (tr.get("text") or []):
            if not isinstance(h, str) or "<br>" not in h or " · Cells:" not in h:
                continue
            parts = h.split("<br>")
            out[(parts[0].split(" · Cells:")[0], parts[1])] = parts[2:]
    return out


def popover_click(page, text):
    page.locator("[data-popover]").get_by_text(text, exact=True).first.click()
    page.wait_for_timeout(1200)


def shoot(sh, page, log):
    # ---- part 1: markers
    sigs = {}
    for title, genes, paste in LINEAGES:
        sigs[title] = make_signature(page, title, genes, paste)
    cg = add_panel(page, "cell-gene")
    t = T(cg)
    shot_tile(page, cg, "dotplot-checklist")
    page.locator(f"{t} select.cgene-axis-type").select_option("obs")
    page.locator(f"{t} select.cgene-axis-key").select_option("midres_celltype")
    color_layer = page.locator(f"{t} select.cgene-color-layer")
    log(f"a new plot starts with Color layer {color_layer.input_value()} and Size layer {page.locator(f'{t} select.cgene-size-layer').input_value()}")
    color_layer.select_option("logged_counts")

    def add_section(title):
        page.locator(f"{t} button.cgene-add").first.click()
        page.wait_for_timeout(300)
        page.locator("button.cgene-add-item").filter(has_text=title).first.click()
        page.wait_for_timeout(800)

    def drawn():
        until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && (g.data || []).some(d => d.type === 'scatter' && d.marker && d.marker.color && d.marker.color.length > 100); }",
              "the dots", t, timeout=120)
        page.wait_for_timeout(1500)

    for title, _, _ in LINEAGES:
        add_section(title)
    drawn()
    h0 = hover_table(page, cg)
    log(f"dots: {len(h0)}")
    for k in [("HSC", "Hlf"), ("HSC", "Mecom"), ("HSC", "Procr"), ("MKP", "Pf4"), ("Ery P", "Car1"), ("Ery P", "Klf1"), ("Myelo P", "Elane"), ("Myelo P", "Mpo"),
              ("Neutrophil", "Ngp"), ("Neutrophil", "Ltf"), ("Monocyte", "Csf1r"), ("Monocyte", "Ccr2"), ("pDC", "Siglech"), ("Pre-B cell", "Ebf1"),
              ("Pre-B cell", "Cd79a"), ("Immature B cell", "Ms4a1"), ("T cell", "Cd3e"), ("Treg", "Foxp3"), ("Neutrophil", "S100a8"), ("Mature B cell", "S100a8"),
              ("T cell", "S100a8"), ("HSC", "S100a8")]:
        log(f"  {k}: {h0.get(k)}")
    shot_tile(page, cg, "dotplot-sections")
    save_view(page, "markers", [cg], list(sigs.values()), "Dot plot tutorial: the marker plot")
    shot_tile(page, cg, "dotplot-s100a8-zero")
    # ---- step 4: the Size button, and S100a8 at a threshold of 5
    page.locator(f"{t} button.cgene-size").first.click()
    page.wait_for_timeout(500)
    shot_tile(page, cg, "dotplot-size-button")
    page.locator('input[data-field="above"]').fill("5")
    page.locator('input[data-field="above"]').press("Enter")
    page.wait_for_timeout(3500)
    h2 = hover_table(page, cg)
    for k in [("Neutrophil", "S100a8"), ("Mature B cell", "S100a8"), ("T cell", "S100a8"), ("HSC", "S100a8"), ("Neutrophil", "Ngp")]:
        log(f"  above 5, {k}: {h2.get(k)}")
    page.keyboard.press("Escape")          # the first ends the edit of the box, the second closes the menu
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    shot_tile(page, cg, "dotplot-s100a8-five")
    side_by_side("dotplot-s100a8-zero", "dotplot-s100a8-five", "dotplot-s100a8")
    page.locator(f"{t} button.cgene-size").first.click()
    page.wait_for_selector('input[data-field="above"]')
    page.locator('input[data-field="above"]').fill("0")
    page.locator('input[data-field="above"]').press("Enter")
    page.wait_for_timeout(2500)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    # ---- step 5: scale, z-score mean, cluster
    page.locator(f"{t} select.cgene-scale").select_option(label="0 to 1 per gene")
    page.wait_for_timeout(2500)
    hs = hover_table(page, cg)
    log(f"  0 to 1 per gene, HSC Hlf: {hs.get(('HSC', 'Hlf'))}; Neutrophil S100a8: {hs.get(('Neutrophil', 'S100a8'))}")
    page.locator(f"{t} select.cgene-scale").select_option(label="None")
    page.wait_for_timeout(1500)
    page.locator(f"{t} button.cgene-color").first.click()
    page.wait_for_timeout(400)
    items = page.evaluate("() => [...document.querySelectorAll('.axis-agg-item')].map(e => [e.dataset.agg, e.disabled, e.title])")
    log(f"the Color list on logged_counts: {items}")
    page.locator('.axis-agg-item[data-agg="zscore_mean"]').click()
    page.wait_for_timeout(3000)
    hz = hover_table(page, cg)
    log(f"  z-score mean, HSC Hlf: {hz.get(('HSC', 'Hlf'))}; Neutrophil S100a8: {hz.get(('Neutrophil', 'S100a8'))}")
    log("scale choices under a z-score mean Color: " + json.dumps(page.evaluate("(t) => [...document.querySelectorAll(t + ' select.cgene-scale option')].map(o => [o.textContent, o.disabled, o.title])", t)))
    page.locator(f"{t} button.cgene-color").first.click()
    page.locator('.axis-agg-item[data-agg="mean"]').click()
    page.wait_for_timeout(2000)
    page.locator(f"{t} select.cgene-scale").select_option(label="0 to 1 per gene")
    page.wait_for_timeout(1500)
    page.locator(f"{t} button.cgene-cluster-btn").first.click()
    page.wait_for_timeout(500)
    popover_click(page, "All")
    page.wait_for_timeout(1500)
    log("cluster pop-over: " + str(page.evaluate("() => [...document.querySelectorAll('[data-popover]')].filter(e => e.getBoundingClientRect().width).map(e => e.innerText.slice(0, 400))")))
    shot_tile(page, cg, "dotplot-cluster-menu")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    shot_tile(page, cg, "dotplot-clustered")
    # ---- step 6: the numbers, as a CSV
    page.locator(f"{t} select.cgene-scale").select_option(label="None")
    page.wait_for_timeout(1500)
    page.locator(f"{t} button.cgene-options-btn").first.click()
    page.wait_for_timeout(500)
    with page.expect_download() as dl:
        page.locator("[data-popover]").get_by_text("Download CSV", exact=True).first.click()
    path = dl.value.path()
    csv = Path(path).read_text()
    Path("/tmp/dotplot-markers.csv").write_text(csv)
    log("CSV head: " + " || ".join(csv.splitlines()[:4]))
    page.keyboard.press("Escape")
    part2(sh, page, log, cg)


def part2(sh, page, log, cg1):
    # ---- part 2: Kompot's fold change
    page.evaluate("() => window.scrollTo(0, 0)")
    de = make_gene_table(page, "Kompot DE genes",
                         [("var", "kompot_de_Young_to_Old_is_de"), ("var", "kompot_de_Young_to_Old_mahalanobis"), ("var", "kompot_de_Young_to_Old_mean_lfc")],
                         [("kompot_de_Young_to_Old_is_de", "Equals", "Yes")], log)
    log("strip of the table: " + page.locator(f"{T(de)} .table-status, {T(de)} .dataTables_info").first.inner_text())
    shot_tile(page, de, "dotplot-de-table")
    cg = add_panel(page, "cell-gene")
    t = T(cg)
    page.locator(f"{t} select.cgene-axis-type").select_option("obs")
    page.locator(f"{t} select.cgene-axis-key").select_option("midres_celltype")
    page.locator(f"{t} button.cgene-add").first.click()
    page.wait_for_timeout(300)
    page.locator("button.cgene-add-item").filter(has_text="Kompot DE genes").first.click()
    page.wait_for_timeout(1500)
    page.locator(f"{t} select.cgene-color-layer").select_option(FC)
    page.wait_for_timeout(2500)
    # Fraction of cells on this layer is greyed
    page.locator(f"{t} button.cgene-size").first.click()
    page.wait_for_timeout(500)
    log("Size list on the fold-change layer (if any): " + json.dumps(page.evaluate("() => [...document.querySelectorAll('.axis-agg-item')].map(e => [e.dataset.agg, e.disabled, e.title])")))
    page.keyboard.press("Escape")
    log("Size layer select: " + page.locator(f"{t} select.cgene-size-layer").input_value())
    page.locator(f"{t} button.cgene-color").first.click()
    page.wait_for_timeout(400)
    log("Color list on the fold-change layer: " + json.dumps(page.evaluate("() => [...document.querySelectorAll('.axis-agg-item')].map(e => [e.dataset.agg, e.disabled, e.title])")))
    shot_tile(page, cg, "dotplot-fc-layer-greyed")
    page.keyboard.press("Escape")
    page.locator(f"{t} select.cgene-mode").select_option(label="Heatmap")
    page.wait_for_timeout(2500)
    page.locator(f"{t} button.cgene-color-btn").first.click()
    page.wait_for_timeout(500)
    page.locator('[data-popover] select[data-option="colorScale"]').select_option("RdBu")
    page.wait_for_timeout(800)
    page.locator('[data-popover] input[data-option="center"]').fill("0")
    page.locator('[data-popover] input[data-option="center"]').press("Enter")
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.wait_for_timeout(800)
    shot_tile(page, cg, "dotplot-fc-heatmap")
    save_view(page, "fold-change", [de, cg], [], "Dot plot tutorial: Kompot's fold change")
    fc = csv_of(page, cg, "/tmp/dotplot-fc.csv")
    report_fc(fc, log)
    # genes clustered within sections
    page.locator(f"{t} button.cgene-cluster-btn").first.click()
    page.wait_for_timeout(500)
    popover_click(page, "Within sections")
    page.wait_for_timeout(2000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    shot_tile(page, cg, "dotplot-fc-clustered")
    modules(sh, page, log, de)
    # finer groups, axes swapped
    page.locator(f"{t} select.cgene-axis-key").select_option("highres_celltype")
    page.wait_for_timeout(3000)
    page.wait_for_timeout(1500)
    shot_tile(page, cg, "dotplot-fc-highres")
    fc2 = csv_of(page, cg, "/tmp/dotplot-fc-highres.csv")
    log(f"highres CSV rows: {len(fc2)}; groups: {fc2['Group'].nunique()}")
    sys.stdout.flush()


def modules(sh, page, log, de):
    """The three stored modules of the 190 genes as three sections of a third plot, each clustered within itself."""
    mods = [make_gene_table(page, f"Module {k}", [("var", "gene_module_k3")], [("gene_module_k3", "Equals", f"module {k}")], log) for k in (1, 2, 3)]
    cg = add_panel(page, "cell-gene")
    t = T(cg)
    page.locator(f"{t} select.cgene-axis-type").select_option("obs")
    page.locator(f"{t} select.cgene-axis-key").select_option("midres_celltype")
    for k in (1, 2, 3):
        page.locator(f"{t} button.cgene-add").first.click()
        page.wait_for_timeout(300)
        page.locator("button.cgene-add-item").filter(has_text=f"Module {k}").first.click()
        page.wait_for_timeout(1200)
    page.locator(f"{t} select.cgene-color-layer").select_option(FC)
    page.wait_for_timeout(2500)
    page.locator(f"{t} select.cgene-mode").select_option(label="Heatmap")
    page.wait_for_timeout(2500)
    page.locator(f"{t} button.cgene-color-btn").first.click()
    page.wait_for_timeout(500)
    page.locator('[data-popover] select[data-option="colorScale"]').select_option("RdBu")
    page.locator('[data-popover] input[data-option="center"]').fill("0")
    page.locator('[data-popover] input[data-option="center"]').press("Enter")
    page.wait_for_timeout(1000)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.locator(f"{t} button.cgene-cluster-btn").first.click()
    page.wait_for_timeout(500)
    popover_click(page, "Within sections")
    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    shot_tile(page, cg, "dotplot-fc-modules")
    save_view(page, "modules", [cg], mods + [de], "Dot plot tutorial: the three modules")
    df = csv_of(page, cg, "/tmp/dotplot-fc-modules.csv")
    col = [c for c in df.columns if c.startswith("Mean")][0]
    for sec, part in df.groupby("Section"):
        g = part.groupby("Group")[col].mean()
        log(f"  {sec}: {part['Row'].nunique()} genes; mean fold change HSC {g['HSC']:.2f}, Monocyte {g['Monocyte']:.2f}, Treg {g['Treg']:.2f}, Neutrophil {g['Neutrophil']:.2f}")


def csv_of(page, pid, where):
    import pandas as pd
    t = T(pid)
    page.locator(f"{t} button.cgene-options-btn").first.click()
    page.wait_for_timeout(500)
    with page.expect_download() as dl:
        page.locator("[data-popover]").get_by_text("Download CSV", exact=True).first.click()
    Path(where).write_text(Path(dl.value.path()).read_text())
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return pd.read_csv(where)


def report_fc(df, log):
    col = [c for c in df.columns if c.startswith("Mean") or c.startswith("Fold")][0]
    log(f"fold-change CSV: {len(df)} rows, columns {list(df.columns)}")
    g = df.pivot_table(index="Row", columns="Group", values=col)
    log(f"genes {g.shape[0]}, groups {g.shape[1]}")
    for gene in ("H2-Q7", "S100a9", "S100a8", "Apoe", "Mt1", "Fosb"):
        if gene in g.index:
            r = g.loc[gene]
            log(f"  {gene}: HSC {r.get('HSC'):.2f}, Monocyte {r.get('Monocyte'):.2f}, Neutrophil {r.get('Neutrophil'):.2f}")
    for grp in ("HSC", "Monocyte", "Neutrophil", "T cell", "Mature B cell"):
        if grp in g.columns:
            log(f"  |fold change| above 0.25 in {grp}: {(g[grp].abs() > 0.25).sum()}; mean |fc| {g[grp].abs().mean():.2f}")
    log(f"  most red gene in HSC: {g['HSC'].idxmax()} {g['HSC'].max():.2f}; bluest {g['HSC'].idxmin()} {g['HSC'].min():.2f}")


if __name__ == "__main__":
    main()
