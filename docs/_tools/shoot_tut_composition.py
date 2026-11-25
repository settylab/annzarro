"""Screenshots, views and Start-here links for the tutorial "Which cell states gain and lose with age?"
(docs/tutorials/composition.md).

Kompot's differential abundance per cell (`obs/kompot_da_Young_to_Old_*`) on a UMAP, then rebuilt as a Cell Grouping
with manual thresholds and counted against the cell types in its cross-table. The Cell Count Plot steps have their own
views (added once the Count Plot's fractions have landed). The script writes each view as a view file and a panel set
with its link, opens it, drives the few controls a figure is about (a factor's Edit pop-over, the Cross-table view),
and prints every number the page quotes, read off the panel, so the page can be checked against the app.

Writes
  docs/_tools/views/tut-composition-*.json
  docs/_static/panelsets/tutorials/tut-composition-*.json and .url.txt
  docs/_static/screens/tutorials/comp-*.png

Run (it starts its own server on --port):
  python docs/_tools/shoot_tut_composition.py [--port 8871] [--only NAME ...]
Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import CLEAN_CSS, NO_MODEBAR_CSS, Session, panelset_file, split, start_link, tile  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
SETS = HERE.parent / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging_annzarro.zarr"

LFC = "kompot_da_Young_to_Old_lfc"
PTP = "kompot_da_Young_to_Old_neg_log10_lfc_ptp"
DIRECTION = "kompot_da_Young_to_Old_lfc_direction"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
HOVER = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "midres_celltype"}, {"type": "obs", "key": LFC}]

DA_PLOT, TYPE_PLOT, CALL_PLOT = "cell-plot-da", "cell-plot-types", "cell-plot-call"
CALL, CHECK, BYTYPE, BYFINE = "cell-grouping-call", "cell-grouping-check", "cell-grouping-types", "cell-grouping-fine"

# the generated names of the two called groups (factor labels joined by the separator) and what the tutorial calls them
GAINED = f"{LFC} ≥ 1 | {PTP} ≥ 1.3"
LOST = f"{LFC} < -1 | {PTP} ≥ 1.3"
MIDDLE = [f"{LFC} -1 to 1 | {PTP} < 1.3", f"{LFC} -1 to 1 | {PTP} ≥ 1.3"]
RED, BLUE, GREY = "#b2182b", "#2166ac", "#d9d9d9"


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


# --------------------------------------------------------------------------- panels
def obs(key):
    return {"type": "obs", "key": key, "column": ""}


def cell_plot(pid, title, color, **kw):
    return {"id": pid, "title": title, "x": UMAP_X, "y": UMAP_Y, "z": None, "color": color, "pointSize": 3,
            "pointOpacity": 0.8, "hoverInfo": HOVER, **kw}


def lfc_bins(thresholds=(-1, 1), named=False):
    f = {"source": {"type": "obs", "key": LFC}, "binning": {"method": "manual", "thresholds": list(thresholds)}}
    if named:  # the bins renamed with the pop-over's pencil: the cross-table's columns stay readable
        f["labels"] = {"bin:0": "lost", "bin:1": "between", "bin:2": "gained"}
    return f


def ptp_bin():
    """-log10 of the tail probability above 1.301: a tail probability below 0.05."""
    return {"source": {"type": "obs", "key": PTP}, "binning": {"method": "manual", "thresholds": [1.301]}}


def call_grouping(named=True):
    g = {"id": CALL, "title": "Age call", "version": 1, "partitionings": [lfc_bins(), ptp_bin()]}
    if named:
        g["groupOverrides"] = ([{"name": GAINED, "label": "gained with age", "color": RED},
                                {"name": LOST, "label": "lost with age", "color": BLUE}]
                               + [{"name": n, "label": t, "color": c} for n, t, c in
                                  zip(MIDDLE, ["within ±1, not significant", "within ±1, significant"], [GREY, "#a6a6a6"])])
    return g


def cross_grouping(gid, title, first):
    """`first` (a categorical obs column) against the paper's log fold change bins: the cross-table's rows and columns."""
    return {"id": gid, "title": title, "version": 1,
            "partitionings": [{"source": {"type": "obs", "key": first}}, lfc_bins(named=True)]}


def view(layout, configs, controls=None):
    controls = controls or {}
    return {"v": 1, "constants": {"focusedGene": "Apoe", "taxonomyId": "10090"},
            "layout": {"v": 1, "hierarchy": [layout], "controlState": {k: controls.get(k, False) for k in configs},
                       "panelConfigs": configs}}


# --------------------------------------------------------------------------- the views
def da_umap():
    return view(split("horizontal", tile(DA_PLOT), tile(TYPE_PLOT), 50), {
        DA_PLOT: cell_plot(DA_PLOT, "Abundance change, Young to Old (log fold change)", obs(LFC),
                           colorScale="RdBu", centeringActive=True),
        TYPE_PLOT: cell_plot(TYPE_PLOT, "Cell types", obs("midres_celltype"))})


def call():
    return view(split("horizontal", tile(CALL), tile(CALL_PLOT), 44), {
        CALL: call_grouping(),
        CALL_PLOT: cell_plot(CALL_PLOT, "Cells by the age call", {"type": "cell-group", "key": CALL, "label": "Age call"})},
        {CALL: True})


def check():
    return view(tile(CHECK), {CHECK: cross_grouping(CHECK, "Your call against the stored one", DIRECTION)}, {CHECK: True})


def by_type():
    return view(split("horizontal", tile(BYTYPE), tile(BYFINE), 50), {
        BYTYPE: cross_grouping(BYTYPE, "Cell types by the call", "midres_celltype"),
        BYFINE: cross_grouping(BYFINE, "Fine cell types by the call", "highres_celltype")},
        {BYTYPE: True, BYFINE: True})


VIEWS_ALL = {"da-umap": da_umap, "call": call, "check": check, "by-type": by_type}


def write_views():
    VIEWS.mkdir(parents=True, exist_ok=True)
    SETS.mkdir(parents=True, exist_ok=True)
    for name, make in VIEWS_ALL.items():
        v = make()
        (VIEWS / f"tut-composition-{name}.json").write_text(json.dumps(v, indent=1) + "\n")
        ps = panelset_file(f"Tutorial: composition, {name}", v, STORE)
        (SETS / f"tut-composition-{name}.json").write_text(json.dumps(ps, indent=1) + "\n")
        (SETS / f"tut-composition-{name}.url.txt").write_text(start_link(STORE, v) + "\n")
        print("view", name)


# --------------------------------------------------------------------------- reading the app
def wait_grouping(page, gid):
    page.wait_for_function("(s) => /groups · /.test((document.querySelector(s) || {}).innerText || '')",
                           arg=T(gid), timeout=90000)
    page.wait_for_timeout(1500)


def header(page, gid):
    return page.evaluate("(s) => (document.querySelector(s).innerText.match(/[0-9,]+ groups · [^\\n]*/) || [''])[0]", T(gid))


def cross(page, gid):
    """Show the Cross-table and return its rows (the grid draws the rows in view: scroll to the end for the rest)."""
    page.locator(f"{T(gid)} .cgg__viewbtn[data-view=cross]").click()
    page.wait_for_timeout(1200)
    read = """(s) => [...document.querySelectorAll(s + ' .cgg [role=row]')].map(r => [...r.children].map(c => c.innerText.trim()).join(' ; '))"""
    rows = page.evaluate(read, T(gid))
    page.evaluate("(s) => { for (const e of document.querySelectorAll(s + ' .cgg *')) if (e.scrollHeight > e.clientHeight + 5) e.scrollTop = 1e6; }", T(gid))
    page.wait_for_timeout(600)
    for r in page.evaluate(read, T(gid)):
        if r not in rows:
            rows.append(r)
    page.evaluate("(s) => { for (const e of document.querySelectorAll(s + ' .cgg *')) e.scrollTop = 0; }", T(gid))
    page.wait_for_timeout(400)
    return rows


def share(rows, label):
    """A cross-table row's cells below -1, between and above 1, with the shares of the row."""
    for r in rows:
        parts = [p.strip() for p in r.split(";")]
        if parts[0] == label:
            n = [int(p.replace(",", "")) for p in parts[1:4]]  # columns: lost, between, gained
            t = sum(n)
            return f"{label}: down {n[0]} ({100 * n[0] / t:.0f}%), between {n[1]}, up {n[2]} ({100 * n[2] / t:.0f}%) of {t}"
    return f"{label}: not found"


def crop(s, page, tid, name, height=None):
    """One tile's content; `height` (CSS px) cuts off the empty rest of a short grid."""
    s.toasts(page, name)
    page.mouse.move(2, 2)
    page.add_style_tag(content=CLEAN_CSS + NO_MODEBAR_CSS)
    page.wait_for_timeout(300)
    loc = page.locator(f"{T(tid)} .tile-content")
    if height is None:
        loc.screenshot(path=str(s.out / f"{name}.png"))
    else:
        box = loc.bounding_box()
        page.screenshot(path=str(s.out / f"{name}.png"), clip={**box, "height": min(height, box["height"])})


# --------------------------------------------------------------------------- the shots
def shoot(s, only):
    def want(name):
        return not only or name in only

    if want("da-umap"):
        page = s.open(da_umap())
        page.wait_for_timeout(6000)
        s.shot(page, "comp-da-umap")
        page.context.close()

    if want("call"):
        page = s.open(call())
        wait_grouping(page, CALL)
        print("NUMBER call:", header(page, CALL))
        print("NUMBER call groups:", page.evaluate("(s) => document.querySelector(s + ' .cgg').innerText.replace(/\\n/g, ' | ')", T(CALL))[:1200])
        rows = cross(page, CALL)
        print("NUMBER call cross:", rows)
        page.locator(f"{T(CALL)} .cgg__viewbtn[data-view=list]").click()
        page.wait_for_timeout(800)
        page.wait_for_timeout(3000)
        s.shot(page, "comp-call")
        # the log fold change factor's Edit pop-over: its distribution, the thresholds -1 and 1 and the chips
        page.locator(f"{T(CALL)} .az-card__edit").first.click()
        page.wait_for_timeout(1500)
        pop = page.locator(".cgrp-editor").first
        pop.screenshot(path=str(s.out / "comp-bins.png"))
        print("NUMBER bins pop-over:", pop.inner_text().replace("\n", " | ")[:800])
        page.keyboard.press("Escape")
        page.context.close()
        # the same call at 0.5: what moves
        g = call_grouping(named=False)
        g["partitionings"][0] = lfc_bins((-0.5, 0.5))
        v = view(tile(CALL), {CALL: g}, {CALL: True})
        page = s.open(v)
        wait_grouping(page, CALL)
        print("NUMBER call at 0.5 cross:", cross(page, CALL))
        page.context.close()

    if want("check"):
        page = s.open(check())
        wait_grouping(page, CHECK)
        rows = cross(page, CHECK)
        print("NUMBER check cross:", rows)
        crop(s, page, CHECK, "comp-check", height=420)
        page.context.close()

    if want("by-type"):
        page = s.open(by_type())
        wait_grouping(page, BYTYPE)
        wait_grouping(page, BYFINE)
        mid = cross(page, BYTYPE)
        fine = cross(page, BYFINE)
        for label in ["HSC", "Treg", "ILC", "Mature B cell", "T cell", "Monocyte", "Neutrophil"]:
            print("NUMBER cell type", share(mid, label))
        for label in ["Mature Naive B cell", "Memory B cell", "Naive CD8 T cell", "CD8 TEM", "Non Classical Monocyte", "Monocyte"]:
            print("NUMBER fine type", share(fine, label))
        s.shot(page, "comp-by-type")
        page.context.close()


def age_numbers(s):
    """The numbers of the counting-by-age section, read off cross-tables (no figure)."""
    G = "cell-grouping-age"
    pairs = [("midres_celltype", "Age"), ("Compartment", "Age"), ("Sample", "Compartment")]
    for a, b in pairs:
        g = {"id": G, "title": "x", "version": 1,
             "partitionings": [{"source": {"type": "obs", "key": a}}, {"source": {"type": "obs", "key": b}}]}
        page = s.open(view(tile(G), {G: g}, {G: True}))
        wait_grouping(page, G)
        print(f"NUMBER {a} x {b}:", cross(page, G))
        page.context.close()
    g = {"id": G, "title": "x", "version": 1, "partitionings": [
        {"source": {"type": "obs", "key": "Compartment"}}, {"source": {"type": "obs", "key": "Age"}},
        {"source": {"type": "obs", "key": "midres_celltype"}}]}
    page = s.open(view(tile(G), {G: g}, {G: True}))
    wait_grouping(page, G)
    page.locator(f"{T(G)} input[placeholder='Search groups']").fill("HSC")
    page.wait_for_timeout(1200)
    print("NUMBER Compartment|Age|HSC:", page.evaluate("(s) => document.querySelector(s + ' .cgg').innerText.replace(/\\n/g, ' | ')", T(G))[:800])
    page.context.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8871)
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    write_views()
    with Session(port=args.port, out=OUT) as s:
        shoot(s, set(args.only or []))
        if not args.only or "age" in args.only:
            age_numbers(s)


if __name__ == "__main__":
    main()
