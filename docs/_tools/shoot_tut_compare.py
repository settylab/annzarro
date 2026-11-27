"""Screenshots, views and Start-here links for the tutorial "Compare the age response of two cell states by clicking"
(docs/tutorials/compare-cell-states.md).

A Gene Plot with one cell's row of the stored fold-change layer on x (locked) and the focused cell's row on y, coloured
by the focused gene's row of `varp/spearman_fold_change` on Blues reversed, range 0.5 to 1, locked. Two Cell Plots on
the UMAP beside it: one to click cells in, one showing where the focused gene changes. The script writes each view as a
view file and a panel set with its link, opens it, and prints every number the page quotes, read off the drawn plot or
the table, so the page can be checked against the app.

Writes
  docs/_tools/views/tut-compare-*.json
  docs/_static/panelsets/tutorials/tut-compare-*.json and .url.txt
  docs/_static/screens/tutorials/compare-*.png

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_compare.py [--port 8871] [--only NAME ...]
Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import CLEAN_CSS, NO_MODEBAR_CSS, Session, panelset_file, split, start_link, tile  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
SETS = HERE.parent / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging_annzarro.zarr"

FC = "kompot_de_Young_to_Old_fold_change"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}

HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
HSC2 = "HSPC_Old_1#AAAGGATTCCTACCAC-1"
LMPP = "HSPC_Old_2#ACTCTCGCAAACCGGA-1"
GMP = "HSPC_Old_3#ATTTCACTCGTAGTGT-1"
MONO = "Mature_Young_2#TCAATTCAGTGAGGCT-1"
NEUTRO = "Mature_Young_1#AAAGGTAAGCTAGTTC-1"
MEMB = "Mature_Young_1#CTCCCTCCACTAGAGG-1"
PLASMA = "Mature_Mid_1#GCCATGGAGTATGATG-1"

GP, TYPES, WHERE, TABLE = "gene-plot-cmp", "cell-plot-types", "cell-plot-where", "gene-table-cmp"
LINEAGE = ["gene-plot-l1", "gene-plot-l2", "gene-plot-l3", "gene-plot-l4"]
IS_DE = {"type": "var", "key": "kompot_de_Young_to_Old_is_de", "column": ""}


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


# --------------------------------------------------------------------------- panels
def row(cell, locked):
    return {"type": "layer", "key": FC, "column": cell, "locked": locked}


def partners(gene, key="spearman_fold_change"):
    return {"type": "varp", "key": key, "column": gene, "locked": False}


def gene_plot(pid=GP, title="Fold change: locked HSC (x) against the focused cell (y)", y_cell=MONO, gene="S100a9",
              key="spearman_fold_change", color=True):
    cfg = {"id": pid, "title": title, "x": row(HSC, True), "y": row(y_cell, False), "z": None,
           "pointSize": 6, "pointOpacity": 0.9, "highlightFocusedGene": True, "showZeroLines": True,
           "hoverInfo": [{"type": "var", "key": "_index"}]}
    if color:
        cfg.update({"color": partners(gene, key), "colorScale": "Blues", "colorReversed": True,
                    "colorMin": 0.5, "colorMax": 1, "lockColorRange": True})
    else:
        cfg["color"] = IS_DE
    return cfg


def cell_plot(pid, title, color, **kw):
    return {"id": pid, "title": title, "x": UMAP_X, "y": UMAP_Y, "z": None, "color": color, "pointSize": 3,
            "pointOpacity": 0.8, "highlightFocusedCell": True,
            "hoverInfo": [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "highres_celltype"}], **kw}


def types_plot():
    return cell_plot(TYPES, "Click a cell", {"type": "obs", "key": "midres_celltype", "column": ""})


def where_plot(gene):
    return cell_plot(WHERE, "Where the focused gene changes", {"type": "layer", "key": FC, "column": gene, "locked": False},
                     colorScale="RdBu", centeringActive=True)


def view(layout, configs, controls, gene, cell):
    return {"v": 1, "constants": {"focusedGene": gene, "focusedCell": cell, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [layout], "controlState": {k: controls.get(k, False) for k in configs},
                       "panelConfigs": configs}}


def three(gene="S100a9", cell=MONO, key="spearman_fold_change", color=True):
    """The page's layout: the UMAP to click on the left above the UMAP of the focused gene, the Gene Plot on the right."""
    left = split("vertical", tile(TYPES), tile(WHERE), 50)
    return view(split("horizontal", left, tile(GP), 38),
                {TYPES: types_plot(), WHERE: where_plot(gene), GP: gene_plot(gene=gene, key=key, color=color)},
                {GP: True}, gene, cell)


def corr_column(gene):
    return {"type": "varp", "key": "spearman_fold_change", "column": gene}


def col_key(c):
    s = f"{c['type']}_{c['key']}_{c.get('column') or 'main'}"
    s = re.sub(r"\s+", "_", s)
    return re.sub(r"[.\[\]()\\]", lambda m: f"␞{ord(m.group()):x}␞", s)


def header(c):
    return f"{c['key']} · {c['column']}" if c.get("column") else c["key"]


def table_view(gene="Cd74", cut=0.6):
    col = corr_column(gene)
    tab = {"id": TABLE, "title": f"Partners of {gene}", "pageLength": 25,
           "columns": [IS_DE, col], "searchBuilderEnabled": True,
           "searchBuilderConfig": {"logic": "AND", "criteria": [
               {"condition": ">", "data": header(col), "origData": col_key(col), "type": "num", "value": [str(cut)]}]}}
    v = three(gene)
    v["layout"]["hierarchy"] = [split("horizontal", tile(TABLE), tile(GP), 45)]
    v["layout"]["panelConfigs"] = {TYPES: types_plot(), TABLE: tab, GP: gene_plot(gene=gene)}
    v["layout"]["controlState"] = {TYPES: False, TABLE: True, GP: False}
    return v


def lineage_view():
    cells = [("another HSC", HSC2), ("an LMPP", LMPP), ("a GMP", GMP), ("a monocyte", MONO)]
    cfgs = {}
    for pid, (name, cell) in zip(LINEAGE, cells):
        cfg = gene_plot(pid=pid, title=f"The HSC (x) against {name} (y)", y_cell=cell, color=False)
        # one scale on both axes, so a cell whose changes are small draws a flat cloud
        cfg.update({"y": row(cell, True), "equalAspect": True, "showLegend": False})
        cfgs[pid] = cfg
    t = [tile(p) for p in LINEAGE]
    layout = split("vertical", split("horizontal", t[0], t[1], 50), split("horizontal", t[2], t[3], 50), 50)
    return view(layout, cfgs, {}, "S100a9", MONO)


VIEWS_ALL = {"start": lambda: three("S100a9"), "partners": lambda: three("Cd74"), "table": table_view}


def write_views():
    VIEWS.mkdir(parents=True, exist_ok=True)
    SETS.mkdir(parents=True, exist_ok=True)
    for name, make in VIEWS_ALL.items():
        v = make()
        (VIEWS / f"tut-compare-{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        ps = panelset_file(f"Tutorial: compare cell states, {name}", v, STORE)
        (SETS / f"tut-compare-{name}.json").write_text(json.dumps(ps, indent=1) + "\n")
        (SETS / f"tut-compare-{name}.url.txt").write_text(start_link(STORE, v) + "\n")
        print("view", name)


# --------------------------------------------------------------------------- reading the app
POINTS = """(pid) => { const gd = document.querySelector('.tile[data-tile-id="' + pid + '"] .js-plotly-plot'); const out = {};
  for (const t of (gd && gd.data) || []) { if (!t.customdata) continue;
    const col = t.marker && Array.isArray(t.marker.color) ? t.marker.color : null;
    for (let i = 0; i < t.x.length; i++) { const n = Array.isArray(t.customdata[i]) ? t.customdata[i][0] : t.customdata[i];
      out[String(n)] = [t.x[i], t.y[i], col ? col[i] : t.name]; } }
  return out; }"""


def points(page, pid=GP, want_colour=True):
    page.wait_for_function("""([pid, c]) => { const gd = document.querySelector('.tile[data-tile-id="' + pid + '"] .js-plotly-plot');
        return !!gd && (gd.data || []).some(t => t.customdata && t.x && t.x.length > 1000 && t.y.some(v => v !== null)
            && (!c || (t.marker && Array.isArray(t.marker.color)))); }""", arg=[pid, want_colour], timeout=90000)
    page.wait_for_timeout(1500)
    return page.evaluate(POINTS, pid)


def focus_gene(page, gene, pid=GP):
    """Set the focused gene by typing it, as a reader would, and wait until the colour is that gene's row."""
    box = page.locator("#gene-search, input[placeholder*='gene' i]").first
    box.fill(gene)
    box.press("Enter")
    page.wait_for_function("""([pid, g]) => { const gd = document.querySelector('.tile[data-tile-id="' + pid + '"] .js-plotly-plot');
        if (!gd || !gd.data) return false;
        for (const t of gd.data) { if (!t.customdata || !t.marker || !Array.isArray(t.marker.color)) continue;
          for (let i = 0; i < t.customdata.length; i++) { const n = Array.isArray(t.customdata[i]) ? t.customdata[i][0] : t.customdata[i];
            if (n === g) return t.marker.color[i] > 0.999; } }
        return false; }""", arg=[pid, gene], timeout=90000)
    page.wait_for_timeout(1500)


def top(pts, gene, n=6):
    vals = sorted(((v[2], g) for g, v in pts.items() if isinstance(v[2], (int, float)) and g != gene), reverse=True)
    above = {c: sum(1 for v, _ in vals if v > c) for c in (0.6, 0.7)}
    return [(g, round(v, 2)) for v, g in vals[:n]], above


def crop(s, page, tid, name):
    s.toasts(page, name)
    page.mouse.move(2, 2)
    page.add_style_tag(content=CLEAN_CSS + NO_MODEBAR_CSS)
    page.wait_for_timeout(300)
    page.locator(f"{T(tid)} .tile-content").screenshot(path=str(s.out / f"{name}.png"))


def say(tag, pts, genes):
    for g in genes:
        v = pts.get(g)
        print(f"NUMBER {tag} {g}:", (round(v[0], 2), round(v[1], 2), round(v[2], 2) if isinstance(v[2], (int, float)) else v[2]) if v else None)


# --------------------------------------------------------------------------- the shots
def shoot(s, only):
    def want(name):
        return not only or name in only

    if want("start"):
        page = s.open(three("S100a9"))
        pts = points(page)
        say("HSC×monocyte", pts, ["S100a9", "Apoe", "S100a8"])
        lst, above = top(pts, "S100a9")
        print("NUMBER S100a9 partners:", lst, above)
        crop(s, page, GP, "compare-s100a9")
        page.context.close()
        # the controls at full width, so the third boxes show the cell and the gene by name
        v = three("S100a9")
        v["layout"]["hierarchy"] = [tile(GP)]
        page = s.open(v)
        points(page)
        page.locator(f"{T(GP)} .plot-controls").screenshot(path=str(s.out / "compare-controls.png"))
        page.context.close()

    if want("diagonal"):
        v = three("S100a9", cell=HSC2)
        page = s.open(v)
        pts = points(page)
        xs = [(a, b) for a, b, _ in pts.values() if a is not None and b is not None]
        n = len(xs)
        mx = sum(a for a, _ in xs) / n
        my = sum(b for _, b in xs) / n
        cov = sum((a - mx) * (b - my) for a, b in xs)
        r = cov / (sum((a - mx) ** 2 for a, _ in xs) * sum((b - my) ** 2 for _, b in xs)) ** 0.5
        print(f"NUMBER locked HSC against a second HSC: {n} genes, r = {r:.3f}")
        say("HSC×HSC2", pts, ["S100a9", "Apoe"])
        s.shot(page, "compare-diagonal")
        page.context.close()

    if want("lineage"):
        page = s.open(lineage_view())
        for pid, name in zip(LINEAGE, ["HSC2", "LMPP", "GMP", "monocyte"]):
            pts = points(page, pid, want_colour=False)
            ys = [b for a, b, _ in pts.values() if b is not None]
            xs = [a for a, b, _ in pts.values() if a is not None]
            de = [(a, b) for a, b, c in pts.values() if c == "true" and a is not None and b is not None]
            print(f"NUMBER lineage {name}: max |x| {max(abs(v) for v in xs):.2f}, max |y| {max(abs(v) for v in ys):.2f}, "
                  f"called genes {len(de)}, same sign {sum(1 for a, b in de if a * b > 0)}")
        s.shot(page, "compare-lineage")
        page.context.close()
        for name, cell in [("neutrophil", NEUTRO), ("memory B", MEMB), ("plasma", PLASMA)]:
            v = lineage_view()
            v["layout"]["hierarchy"] = [tile(LINEAGE[0])]
            v["layout"]["panelConfigs"] = {LINEAGE[0]: {**v["layout"]["panelConfigs"][LINEAGE[0]], "y": row(cell, True)}}
            page = s.open(v)
            pts = points(page, LINEAGE[0], want_colour=False)
            ys = [b for a, b, _ in pts.values() if b is not None]
            print(f"NUMBER {name}: max |y| {max(abs(v) for v in ys):.2f}")
            page.context.close()

    for gene, name in [("Cd74", "compare-cd74"), ("Apoe", "compare-apoe"), ("Cd79a", None)]:
        if not want(gene.lower()):
            continue
        page = s.open(three(gene))
        pts = points(page)
        lst, above = top(pts, gene, 8)
        print(f"NUMBER {gene} partners:", lst, above)
        say(f"HSC×monocyte {gene}", pts, [gene])
        if name:
            s.shot(page, name)
        page.context.close()

    if want("smoothed"):
        page = s.open(three("Cd74", key="spearman_smoothed"))
        pts = points(page)
        lst, above = top(pts, "Cd74", 8)
        print("NUMBER Cd74 smoothed partners:", lst, above)
        page.context.close()

    if want("table"):
        page = s.open(table_view())
        page.wait_for_function("""(s) => { const e = document.querySelector(s + ' .dataTables_info, ' + s + ' .dt-info');
            return !!e && /of [0-9,]+ entries/.test(e.textContent); }""", arg=T(TABLE), timeout=90000)
        page.wait_for_timeout(1500)
        print("NUMBER table:", page.locator(f"{T(TABLE)} .dataTables_info, {T(TABLE)} .dt-info").first.inner_text())
        print("NUMBER table rows:", page.evaluate("""(s) => [...document.querySelectorAll(s + ' tbody tr')]
            .map(r => [...r.children].map(c => c.textContent.trim()).join(' | ')).slice(0, 25)""", T(TABLE)))
        crop(s, page, TABLE, "compare-table")
        page.context.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8871)
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    write_views()
    with Session(port=args.port, out=OUT) as s:
        shoot(s, set(args.only or []))


if __name__ == "__main__":
    main()
