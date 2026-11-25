"""Screenshots, views and Start-here links for the tutorial "Do cell types respond to age in the same way?"
(docs/tutorials/group-statistics.md).

Every panel is a Gene Plot, Gene Table, Cell Table or Cell-Gene Plot on a statistic of a group of cells: a group of a
Cell Grouping (`group-stat`) or the cells of a Cell Table (`table-stat`), over the Kompot fold-change layer or
`logged_counts`. The script writes each view as a view file and a panel set with its link, opens it, drives the few
controls a figure is about (the aggregation button's list, the Gene Table's column chooser), and prints every number the
page quotes, read off the drawn plot or the table, so the page can be checked against the app.

Writes
  docs/_tools/views/tut-gstat-*.json
  docs/_static/panelsets/tutorials/tut-gstat-*.json and .url.txt
  docs/_static/screens/tutorials/gstat-*.png

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_group_stats.py [--port 8861] [--only NAME ...]
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

REPO = HERE.parent.parent
OUT = HERE.parent / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
SETS = HERE.parent / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging_annzarro.zarr"

FC = "kompot_de_Young_to_Old_fold_change"
LOG = "logged_counts"
MID, HIGH = "cell-grouping-ct", "cell-grouping-fine"
PLOT, PLOT2, TABLE, CG = "gene-plot-gs", "gene-plot-gs2", "gene-table-gs", "cell-gene-gs"
CT_MID, CT_OLD = "cell-table-mid", "cell-table-old"
IS_DE = {"type": "var", "key": "kompot_de_Young_to_Old_is_de", "column": ""}
MAHAL = {"type": "var", "key": "kompot_de_Young_to_Old_mahalanobis", "column": ""}
GROUPING_TITLE = {MID: "Cell types", HIGH: "Fine cell types"}


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


# --------------------------------------------------------------------------- panels
def grouping(gid, obs, title=None):
    return {"id": gid, "title": title or GROUPING_TITLE[gid], "version": 1,
            "partitionings": [{"source": {"type": "obs", "key": obs}}]}


def group_key(level):
    return json.dumps([f"c:{level}"], separators=(",", ":"))


def stat(level, layer=FC, gid=MID, s="mean"):
    """A group of a Cell Grouping as a Gene Plot axis or a Gene Table column: one statistic of each gene over its cells."""
    return {"type": "group-stat", "key": gid, "column": group_key(level), "stat": s, "layer": layer, "groupWas": [level]}


def column(level, layer=FC, gid=MID):
    return {**stat(level, layer, gid), "label": GROUPING_TITLE[gid]}


def table_stat(tid, layer=LOG):
    return {"type": "table-stat", "key": tid, "stat": "mean", "layer": layer}


def gene_plot(pid, title, x, y, color=IS_DE, table="none", square=False):
    """`square`: x and y on one scale (Equal aspect), for two axes of the same quantity and their diagonal."""
    cfg = {"id": pid, "title": title, "x": x, "y": y, "z": None, "color": color, "pointSize": 6, "pointOpacity": 0.9,
           "showZeroLines": True, "highlightFocusedGene": True, "hoverInfo": [{"type": "var", "key": "_index"}],
           "tableFilter": table}
    if square:
        cfg["equalAspect"] = True
    return cfg


def col_key(c):
    """The table's data key of a column (static/js/utils/column-key.js), which a SearchBuilder condition names."""
    s = f"{c['type']}_{c['key']}_{c.get('column') or 'main'}"
    if c.get("layer"):
        s += f"__of_{c['layer']}"
    if c.get("stat"):
        s += f"__as_{c['stat']}"
    s = re.sub(r"\s+", "_", s)
    return re.sub(r"[.\[\]()\\]", lambda m: f"␞{ord(m.group()):x}␞", s)


def header(c):
    """The column header the table shows (and SearchBuilder lists)."""
    if c["type"] == "group-stat":
        return f"{json.loads(c['column'])[0][2:]}: mean · {c['layer']}"
    return c["key"]


def num(c, op, value):
    return {"condition": op, "data": header(c), "origData": col_key(c), "type": "num", "value": [str(value)]}


def is_true(c):
    return {"condition": "=", "data": header(c), "origData": col_key(c), "type": "string", "value": ["true"]}


def obs_eq(key, value):
    return {"condition": "=", "data": key, "origData": f"obs_{key}_main", "type": "string", "value": [value]}


def gene_table(tid, title, columns, criteria=None):
    cfg = {"id": tid, "title": title, "columns": columns, "pageLength": 25}
    if criteria:
        cfg.update({"searchBuilderEnabled": True, "searchBuilderConfig": {"criteria": criteria, "logic": "AND"}})
    return cfg


def cell_table(tid, title, age):
    return {"id": tid, "title": title, "pageLength": 5,
            "columns": [{"type": "obs", "key": "midres_celltype", "column": ""}, {"type": "obs", "key": "Age", "column": ""}],
            "searchBuilderEnabled": True,
            "searchBuilderConfig": {"criteria": [obs_eq("midres_celltype", "HSC"), obs_eq("Age", age)], "logic": "AND"}}


def view(layout, configs, controls=None, focus="Apoe"):
    controls = controls or {}
    return {"v": 1, "constants": {"focusedGene": focus, "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [layout], "controlState": {k: controls.get(k, False) for k in configs},
                       "panelConfigs": configs}}


def plot_and(pid, plot, *extra, controls=None, focus="Apoe", below=False):
    """The Gene Plot over the full width with its controls open (its axis row needs the width to show the grouping and
    the group by name); the panels it reads are closed (`below=False`: a closed grouping or table still serves its
    cells), or side by side under the plot (`below=True`)."""
    cfgs = {pid: plot}
    for cfg in extra:
        cfgs[cfg["id"]] = cfg
    if not below:
        v = view(tile(pid), cfgs, controls or {pid: True}, focus)
        v["layout"]["controlState"] = {pid: True}
        return v
    under = tile(extra[0]["id"])
    for cfg in extra[1:]:
        under = split("horizontal", under, tile(cfg["id"]))
    return view(split("vertical", tile(pid), under, 78), cfgs, controls or {pid: True}, focus)


# --------------------------------------------------------------------------- the views
HSC_MONO = lambda: plot_and(PLOT, gene_plot(PLOT, "Mean fold change: HSC (x) against Monocyte (y)", stat("HSC"), stat("Monocyte")),  # noqa: E731
                            grouping(MID, "midres_celltype"))
DIAGONAL = lambda: plot_and(PLOT, gene_plot(PLOT, "One old HSC (x) against all HSCs (y)",  # noqa: E731
                                            {"type": "var", "key": "hsc_fold_change", "column": ""}, stat("HSC")),
                            grouping(MID, "midres_celltype"))
GRAN_COLUMNS = [IS_DE, MAHAL, column("HSC"), column("Myelo P"), column("Neutrophil")]
GRANULOCYTE = lambda: view(  # noqa: E731
    split("horizontal", tile(TABLE), tile(MID), 75),
    {TABLE: gene_table(TABLE, "Called genes that fall in HSCs", GRAN_COLUMNS,
                       [is_true(IS_DE), num(column("HSC"), "<", -0.5)]),
     MID: grouping(MID, "midres_celltype")}, {TABLE: True}, focus="S100a8")
B_NAIVE, B_MEMORY = column("Mature Naive B cell", gid=HIGH), column("Memory B cell", gid=HIGH)
NAIVE_MEMORY = lambda: plot_and(PLOT, gene_plot(PLOT, "Mean fold change: naive (x) against memory B cells (y)",  # noqa: E731
                                                stat("Mature Naive B cell", gid=HIGH), stat("Memory B cell", gid=HIGH)),
                                grouping(HIGH, "highres_celltype"), focus="Cd79a")
OPPOSING = [IS_DE, B_NAIVE, B_MEMORY]


def opposing_table():
    return gene_table(TABLE, "Opposite in naive and memory B cells", OPPOSING,
                      [is_true(IS_DE), num(B_NAIVE, "<", -0.2), num(B_MEMORY, ">", 0.2)])


def divergent():
    cg = {"id": CG, "title": "Opposing genes by fine cell type", "version": 1, "mode": "heatmap",
          "sections": [{"source": TABLE, "rows": "genes"}], "cellAxis": {"type": "cell-group", "key": HIGH},
          "color": {"stat": "mean", "layer": FC}, "colorScale": "RdBu", "center": 0, "swap": False}
    # the table stays open under the plot: it is the section's gene list
    return view(split("horizontal", tile(CG), tile(TABLE), 64),
                {CG: cg, TABLE: opposing_table(), HIGH: grouping(HIGH, "highres_celltype")}, {CG: False}, focus="Cd79a")


CELL_TABLES = lambda: plot_and(PLOT, gene_plot(PLOT, "Mean of logged_counts: Mid HSCs (x) against Old HSCs (y)",  # noqa: E731
                                               table_stat(CT_MID), table_stat(CT_OLD)),
                               cell_table(CT_MID, "Mid HSCs", "Mid"), cell_table(CT_OLD, "Old HSCs", "Old"), focus="Cd74", below=True)
AGG = lambda: plot_and(PLOT, gene_plot(PLOT, "Mean of logged_counts in HSCs", stat("HSC", layer=LOG), stat("Monocyte", layer=LOG)),  # noqa: E731
                       grouping(MID, "midres_celltype"))
GONE = lambda: plot_and(PLOT, gene_plot(PLOT, "After the grouping's factor changed", stat("Mature B cell", gid=MID), stat("Monocyte", gid=MID)),  # noqa: E731
                        {**grouping(MID, "highres_celltype"), "title": "Cell types"})
VARM_CHECK = lambda: plot_and(PLOT, gene_plot(PLOT, "Stored HSC mean (x) against the live HSC mean (y)",  # noqa: E731
                                              {"type": "varm", "key": "mean_by_celltype", "column": "HSC"}, stat("HSC", layer=LOG)),
                              grouping(MID, "midres_celltype"))

VIEWS_ALL = {"hsc-monocyte": HSC_MONO, "diagonal": DIAGONAL, "granulocyte": GRANULOCYTE, "naive-memory": NAIVE_MEMORY,
             "divergent": divergent, "cell-tables": CELL_TABLES, "stored-check": VARM_CHECK}


def write_views():
    VIEWS.mkdir(parents=True, exist_ok=True)
    SETS.mkdir(parents=True, exist_ok=True)
    for name, make in VIEWS_ALL.items():
        v = make()
        (VIEWS / f"tut-gstat-{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        ps = panelset_file(f"Tutorial: group statistics, {name}", v, STORE)
        (SETS / f"tut-gstat-{name}.json").write_text(json.dumps(ps, indent=1) + "\n")
        (SETS / f"tut-gstat-{name}.url.txt").write_text(start_link(STORE, v) + "\n")
        print("view", name)


# --------------------------------------------------------------------------- reading the app
POINTS = """(pid) => { const gd = document.querySelector('.tile[data-tile-id="' + pid + '"] .js-plotly-plot'); const out = {};
  for (const t of (gd && gd.data) || []) { if (!t.customdata) continue;
    for (let i = 0; i < t.x.length; i++) { const n = Array.isArray(t.customdata[i]) ? t.customdata[i][0] : t.customdata[i];
      out[String(n)] = [t.x[i], t.y[i], t.name]; } }
  return out; }"""


def points(page, pid=PLOT):
    page.wait_for_function("""(pid) => { const gd = document.querySelector('.tile[data-tile-id="' + pid + '"] .js-plotly-plot');
        return !!gd && (gd.data || []).some(t => t.customdata && t.x && t.x.length > 1000 && t.x.some(v => v !== null)); }""",
                           arg=pid, timeout=90000)
    return page.evaluate(POINTS, pid)


def say(tag, pts, genes):
    for g in genes:
        v = pts.get(g)
        print(f"NUMBER {tag} {g}: " + (f"x {v[0]:+.2f}, y {v[1]:+.2f}, called {v[2]}" if v and v[0] is not None and v[1] is not None else str(v)))


def corr(pts):
    xs = [v[0] for v in pts.values() if v[0] is not None and v[1] is not None]
    ys = [v[1] for v in pts.values() if v[0] is not None and v[1] is not None]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    sxx = sum((a - mx) ** 2 for a in xs)
    syy = sum((b - my) ** 2 for b in ys)
    return n, sxy / (sxx * syy) ** 0.5


def info(page, tid):
    return page.locator(f"{T(tid)} .dataTables_info, {T(tid)} .dt-info").first.inner_text()


def wait_rows(page, tid):
    page.wait_for_function("""(s) => { const e = document.querySelector(s + ' .dataTables_info, ' + s + ' .dt-info');
        return !!e && /of [0-9,]+ entries/.test(e.textContent) && !/computing/i.test(document.querySelector(s).textContent); }""",
                           arg=T(tid), timeout=90000)


# --------------------------------------------------------------------------- the shots
def crop(s, page, tid, name):
    """One tile's content, as Shooter.shot crops its tiles (no hover, no modebar), without the whole window."""
    s.toasts(page, name)
    page.mouse.move(2, 2)
    page.add_style_tag(content=CLEAN_CSS + NO_MODEBAR_CSS)
    page.wait_for_timeout(300)
    page.locator(f"{T(tid)} .tile-content").screenshot(path=str(s.out / f"{name}.png"))
    s.log.append(f"wrote {name}.png")



def shoot(s, only):
    def want(name):
        return not only or name in only

    if want("hsc-monocyte"):
        page = s.open(HSC_MONO())
        pts = points(page)
        say("HSC×Monocyte", pts, ["H2-Q7", "Apoe", "S100a9", "H2-Aa", "H2-Ab1", "H2-Eb1", "Cd74", "AW112010", "Igkc"])
        de = [v for v in pts.values() if v[2] == "true"]
        print(f"NUMBER called genes {len(de)}: same sign {sum(1 for v in de if v[0] * v[1] > 0)}, "
              f"opposite {sum(1 for v in de if v[0] * v[1] < 0)}")
        crop(s, page, PLOT, "gstat-hsc-monocyte-plot")
        # the X row of the controls: the layer, the grouping, the group and the aggregation button
        page.locator(f"{T(PLOT)} .plot-controls").screenshot(path=str(OUT / "gstat-axis-row.png"))
        page.context.close()

    if want("diagonal"):
        page = s.open(DIAGONAL())
        pts = points(page)
        n, r = corr(pts)
        print(f"NUMBER stored HSC cell against the HSC mean: {n} genes, r = {r:.3f}")
        say("stored×live", pts, ["Apoe", "S100a9"])
        crop(s, page, PLOT, "gstat-diagonal-plot")
        page.context.close()

    if want("granulocyte"):
        page = s.open(GRANULOCYTE())
        wait_rows(page, TABLE)
        print("NUMBER granulocyte table:", info(page, TABLE))
        print("NUMBER granulocyte rows:", page.evaluate("""(s) => [...document.querySelectorAll(s + ' .dataTables_scrollBody tbody tr, ' + s + ' tbody tr')]
            .map(r => [...r.children].map(c => c.textContent.trim()).join(' | ')).filter(t => t.includes('|')).slice(0, 25)""", T(TABLE)))
        crop(s, page, TABLE, "gstat-granulocyte-table")
        # the column chooser on its Cell groupings tab
        page.locator(f"#group-stat-tab-{TABLE}").click()
        page.wait_for_selector(f"#group-stat-content-{TABLE}", state="visible")
        page.wait_for_timeout(500)
        page.locator(f"#group-stat-content-{TABLE}").screenshot(path=str(OUT / "gstat-table-tab.png"))
        page.context.close()

    if want("naive-memory"):
        page = s.open(NAIVE_MEMORY())
        pts = points(page)
        say("naive×memory B", pts, ["Cd79a", "Ighm", "Cd74", "Ms4a1", "Cd79b", "Igkc"])
        de = [v for v in pts.values() if v[2] == "true"]
        opp = sum(1 for v in de if v[0] < -0.2 and v[1] > 0.2)
        print(f"NUMBER called genes falling in naive B (< -0.2) and rising in memory B (> 0.2): {opp}")
        crop(s, page, PLOT, "gstat-naive-memory-plot")
        page.context.close()

    if want("divergent"):
        page = s.open(divergent())
        page.wait_for_function("(s) => document.querySelector(s + ' .cgene-panel').dataset.state === 'ready'", arg=T(CG), timeout=90000)
        wait_rows(page, TABLE)
        print("NUMBER opposing table:", info(page, TABLE))
        print("NUMBER heatmap:", page.evaluate("(s) => (document.querySelector(s).innerText.match(/[0-9]+ groups × [0-9]+ rows?/) || [''])[0]", T(CG)))
        crop(s, page, CG, "gstat-divergent-heatmap")
        page.context.close()

    if want("cell-tables"):
        page = s.open(CELL_TABLES())
        wait_rows(page, CT_MID)
        wait_rows(page, CT_OLD)
        print("NUMBER Mid HSC table:", info(page, CT_MID), "| Old HSC table:", info(page, CT_OLD))
        pts = points(page)
        say("Mid×Old HSC", pts, ["Cd74", "H2-Aa", "H2-Eb1"])
        rise = sorted(((v[1] - v[0], g) for g, v in pts.items() if v[0] is not None and v[1] is not None), reverse=True)[:5]
        print("NUMBER largest rises Mid to Old:", [(g, round(d, 2)) for d, g in rise])
        s.shot(page, "gstat-cell-tables")
        page.context.close()

    if want("agg"):
        page = s.open(AGG())
        points(page)
        page.click(f"{T(PLOT)} button.axis-agg-btn[data-axis='x']")
        page.wait_for_selector("[data-popover='aggregation']", state="visible")
        rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")]
            .map(r => [r.dataset.agg, r.disabled, (r.querySelector('.axis-agg-why') || {}).textContent || r.title])""")
        print("NUMBER aggregation list on logged_counts:", rows)
        page.wait_for_timeout(300)
        box = page.locator("[data-popover='aggregation']").bounding_box()
        row = page.locator(f"{T(PLOT)} .plot-controls").bounding_box()
        x0, y0 = min(box["x"], row["x"]), min(box["y"], row["y"])
        x1 = max(box["x"] + box["width"], row["x"] + row["width"])
        y1 = max(box["y"] + box["height"], row["y"] + row["height"])
        page.screenshot(path=str(OUT / "gstat-agg-greyed.png"), clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0})
        page.context.close()

    if want("gone"):
        page = s.open(GONE())
        try:
            page.wait_for_function("(s) => /no longer a group|group changed/i.test(document.querySelector(s).textContent)", arg=T(PLOT), timeout=30000)
        except Exception:
            print("NUMBER tile text:", page.evaluate("(s) => document.querySelector(s).innerText.slice(0, 1500)", T(PLOT)))
            page.screenshot(path=str(OUT / "_gone-debug.png"))
            raise
        page.wait_for_timeout(1000)
        print("NUMBER notice:", page.evaluate("""(s) => [...document.querySelectorAll(s + ' *')].filter(e => e.children.length === 0
            && /group/i.test(e.textContent)).map(e => e.textContent.trim()).slice(0, 8)""", T(PLOT)))
        page.locator(f"{T(PLOT)} .tile-content").screenshot(path=str(OUT / "gstat-group-changed.png"))
        page.context.close()

    if want("stored-check"):
        page = s.open(VARM_CHECK())
        pts = points(page)
        n, r = corr(pts)
        print(f"NUMBER stored per-cell-type mean against the live one: {n} genes, r = {r:.4f}")
        say("varm×live", pts, ["Apoe", "Hlf"])
        page.context.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8861)
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    write_views()
    with Session(port=args.port, out=OUT) as s:
        shoot(s, set(args.only or []))


if __name__ == "__main__":
    main()
