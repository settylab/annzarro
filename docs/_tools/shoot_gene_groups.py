"""Screenshots and views for the tutorial "Group genes by several measures at once"
(docs/tutorials/gene-groups.md).

It drives the real UI the way the page tells a reader to, and stops when the app does not
do what the page says: it ticks the gene table's columns in the column chooser, types the
filter conditions into Advanced Search, presses Run in the Gene Set Analysis panel (and
Send in its consent bar, so STRING, g:Profiler and MyGene.info answer for real), changes a
threshold, and focuses another cell. Every count the page quotes is read off the app here
and printed in the log.

Writes
  docs/_static/screens/tutorials/gene-groups-*.png
  docs/_tools/views/gene-groups-*.json                 the views below
  docs/_static/panelsets/tutorials/gene-groups-*.json  their panel set files, and .url.txt links

Run (it starts its own server on --port):
  python docs/_tools/shoot_gene_groups.py [--port 8823]

Data: bm_aging.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data), served from a temporary
data directory of symlinks.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, panelset_file, split, start_link, tile  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging.zarr"

HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"      # the example HSC of the other tutorials
MONO = "Mature_Young_2#TCAATTCAGTGAGGCT-1"  # the example monocyte
GENE = "H2-Q7"
FC = "kompot_de_Young_to_Old_fold_change"
MAHAL = "kompot_de_Young_to_Old_mahalanobis"
LFC = "kompot_de_Young_to_Old_mean_lfc"
RHO = "spearman_fold_change"
CONST = {"focusedGene": GENE, "focusedCell": HSC, "taxonomyId": "10090"}

TBL, PLOT, GS = "gene-table-g", "gene-plot-g", "gene-set-g"
RHO_LABEL = f"{RHO}: {GENE}"            # the column headers the chooser makes
FC_LABEL = f"{FC}: {HSC}"


def T(tid: str) -> str:
    return f'.tile[data-tile-id="{tid}"]'


def var(key: str) -> dict:
    return {"type": "var", "key": key, "column": ""}


def start_view() -> dict:
    """Where the tutorial starts: a gene table of two var columns, a volcano filtered by the
    table (genes outside it grey) and a Gene Set Analysis panel following the table."""
    cfgs = {
        TBL: {"id": TBL, "title": "Genes like H2-Q7 that rise in this HSC",
              "columns": [var(MAHAL), var(LFC)]},
        PLOT: {"id": PLOT, "title": "Volcano: genes in the table coloured by rho with H2-Q7, the rest grey",
               "x": var(LFC), "y": var(MAHAL), "z": None,
               "color": {"type": "varp", "key": RHO, "column": GENE, "locked": True},
               "colorScale": "RdBu", "colorMin": -1, "colorMax": 1, "lockColorRange": True,
               "pointSize": 6, "pointOpacity": 0.9,
               "highlightFocusedGene": True, "tableFilter": TBL, "removeNonTableEntries": False},
        GS: {"id": GS, "title": "Gene Set Analysis", "tableFilter": TBL},
    }
    bottom = split("horizontal", tile(PLOT), tile(GS), 50)
    layout = split("vertical", tile(TBL), bottom, 40)
    layout["height"] = 2400
    return {"v": 1, "constants": dict(CONST),
            "layout": {"v": 1, "hierarchy": [layout],
                       "controlState": {TBL: False, PLOT: False, GS: True}, "panelConfigs": cfgs}}


def save(name: str, v: dict, title: str) -> None:
    VIEWS.mkdir(parents=True, exist_ok=True)
    (VIEWS / f"{name}.json").write_text(json.dumps(v, indent=1) + "\n")
    PANELSETS.mkdir(parents=True, exist_ok=True)
    (PANELSETS / f"{name}.json").write_text(json.dumps(panelset_file(title, v, STORE), indent=1) + "\n")
    (PANELSETS / f"{name}.url.txt").write_text(start_link(STORE, v) + "\n")


def finish(prefix: str) -> None:
    """Re-save this page's shots; a large one as 256 colours (as shoot_we_steps.py does)."""
    from PIL import Image
    for path in sorted(OUT.glob(f"{prefix}*.png")):
        im = Image.open(path).convert("RGB")
        im.save(path, optimize=True)
        if path.stat().st_size > 400_000:
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def fail(msg: str):
    raise SystemExit(f"STEP FAILED: {msg}")


def until(page, js, what, timeout=240):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js):
            return
        page.wait_for_timeout(250)
    fail(f"timed out waiting for {what}")


def toggle_controls(sh, page, tid):
    page.locator(f"{T(tid)} .tile-toggle-controls").first.click()
    sh.ready(page)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    sh.ready(page)


def headers(page) -> list[str]:
    return page.evaluate(f"[...document.querySelectorAll('{T(TBL)} .dataTables_scrollHead thead th, "
                         f"{T(TBL)} table.dataTable thead th')].map(th => th.textContent.trim())"
                         ".filter((t, i, a) => t && a.indexOf(t) === i)")


def info(page) -> str:
    return page.locator(f"{T(TBL)} .dataTables_info").first.inner_text()


def rows_passing(page) -> int:
    return page.evaluate(f"""() => {{
        const p = window.PanelManager.getPanel('{TBL}');
        return p.getConfig().currentEntries.length; }}""")


def plot_in_table(page) -> int:
    """Genes the volcano draws in colour (in the table); the rest are drawn grey."""
    return page.evaluate(f"""() => {{
        const g = document.querySelector('{T(PLOT)} .js-plotly-plot');
        let n = 0;
        for (const t of g._fullData) {{
            const c = t.marker && t.marker.color;
            if (Array.isArray(c) && t.customdata) n += c.filter(v => typeof v === 'number' && Number.isFinite(v)).length;
        }}
        return n; }}""")


def gs_state(page):
    return page.evaluate(f"() => window.PanelManager.getPanel('{GS}')._debugState()")


SETTLED = f"""() => {{ const s = window.PanelManager.getPanel('{GS}')._debugState();
  const r = Object.values(s.runs).filter(r => r.visible);
  return r.length > 0 && r.every(r => r.status === 'ok' || r.status === 'error'); }}"""


def criterion(page, n, col, cond, val):
    c = page.locator(f"{T(TBL)} .dtsb-criteria").nth(n)
    c.locator(".dtsb-data").select_option(label=col)
    page.wait_for_timeout(600)
    c.locator(".dtsb-condition").select_option(label=cond)
    page.wait_for_timeout(600)
    c.locator("input.dtsb-value").first.fill(str(val))
    c.locator("input.dtsb-value").first.press("Tab")
    page.wait_for_timeout(1500)


def set_value(page, n, val):
    box = page.locator(f"{T(TBL)} .dtsb-criteria").nth(n).locator("input.dtsb-value").first
    box.fill(str(val))
    box.press("Tab")
    page.wait_for_timeout(1500)


def focus_cell(sh, page, name):
    """Click Focused Cell, type part of the name, pick it (as the page says)."""
    page.click("#focused-cell")
    page.keyboard.press("Meta+A")
    page.keyboard.type(name.split("#")[1], delay=10)
    page.wait_for_selector(".name-picker-option", timeout=30000)
    page.wait_for_timeout(500)
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    sh.ready(page)


def clip(page, path, selectors, pad=6):
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    boxes = [page.locator(s).first.bounding_box() for s in selectors]
    boxes = [b for b in boxes if b]
    x0 = min(b["x"] for b in boxes) - pad
    y0 = min(b["y"] for b in boxes) - pad
    x1 = max(b["x"] + b["width"] for b in boxes) + pad
    y1 = max(b["y"] + b["height"] for b in boxes) + pad
    page.screenshot(path=str(path), clip={"x": max(x0, 0), "y": max(y0, 0), "width": x1 - x0, "height": y1 - y0})


def full(page, path):
    """The whole page, from the top (the window was grown to the layout when it opened)."""
    page.evaluate("""() => { for (const e of document.querySelectorAll('#tile-container, #tile-container *'))
        if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); }""")
    page.wait_for_timeout(300)
    # the tiles scroll inside #tile-container: grow the window to all of it for the shot
    vp = dict(page.viewport_size)
    h = page.evaluate("""() => { const c = document.querySelector('#tile-container');
        return Math.ceil(c.getBoundingClientRect().top + c.scrollHeight) + 4; }""")
    if h > vp["height"]:
        page.set_viewport_size({"width": vp["width"], "height": h})
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        page.wait_for_timeout(2500)
    # down to the last tile; the panel chooser below it is left out
    bottom = page.evaluate("Math.ceil(Math.max(...[...document.querySelectorAll('.tile')]"
                           ".map(t => t.getBoundingClientRect().bottom))) + 6")
    page.screenshot(path=str(path), full_page=True,
                    clip={"x": 0, "y": 0, "width": vp["width"], "height": bottom})
    if h > vp["height"]:
        page.set_viewport_size(vp)
        page.evaluate("window.dispatchEvent(new Event('resize'))")
        page.wait_for_timeout(1500)


def clean(page):
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")
    page.mouse.move(2, 2)
    page.wait_for_timeout(300)


def shoot(sh, store: str) -> None:
    log = sh.log.append
    v = start_view()
    save("gene-groups-start", v, "Gene groups: start")
    page = sh.open(v, dataset=store)
    log(f"start: headers {headers(page)}, {info(page)}")

    # 1. Columns from the focused gene and the focused cell
    toggle_controls(sh, page, TBL)
    t = T(TBL)

    def tab(name):
        page.locator(f"{t} .nav-link", has_text=name).first.click()
        page.wait_for_timeout(400)

    def tick(label):
        loc = page.locator(f"{t} label:text-is('{label}')")
        if loc.count() == 0:
            fail(f"the column chooser offers no '{label}'; it offers "
                 + json.dumps(page.evaluate(f"[...document.querySelectorAll('{t} .tab-pane.active label')]"
                                            ".map(l => l.textContent.trim())")[:40]))
        loc.first.click()
        page.wait_for_timeout(300)

    tab("varp")
    tick(f"{RHO_LABEL} (focused)")
    clean(page)
    page.locator(f"{t} .table-controls").first.screenshot(path=str(OUT / "gene-groups-chooser-varp.png"))
    tab("layers")
    tick(f"{FC_LABEL} (focused)")
    clean(page)
    page.locator(f"{t} .table-controls").first.screenshot(path=str(OUT / "gene-groups-chooser-layer.png"))
    page.locator(f"{t} button", has_text="Apply Changes").click()
    sh.ready(page)
    toggle_controls(sh, page, TBL)
    h = headers(page)
    log(f"columns: headers {h}")
    for want in (RHO_LABEL, FC_LABEL):
        if want not in h:
            fail(f"header '{want}' missing: {h}")

    # 2. Conditions on those columns
    page.locator(f"{t} button", has_text="Add Condition").first.click()
    page.wait_for_timeout(800)
    criterion(page, 0, RHO_LABEL, "Greater Than", 0.4)
    page.locator(f"{t} button", has_text="Add Condition").first.click()
    page.wait_for_timeout(800)
    criterion(page, 1, FC_LABEL, "Greater Than", 0.2)
    sh.ready(page)
    n_rows, n_plot = rows_passing(page), plot_in_table(page)
    log(f"filter rho > 0.4 AND fc(HSC) > 0.2: {info(page)}; rows passing {n_rows}; volcano colours {n_plot}")
    if n_plot != n_rows:
        fail(f"the volcano colours {n_plot} genes, the table passes {n_rows}")
    gs = gs_state(page)
    log(f"gene set source: {gs['source']}")
    if gs["source"]["count"] != n_rows:
        fail(f"the gene set panel takes {gs['source']['count']} genes, the table passes {n_rows}")
    clean(page)
    full(page, OUT / "gene-groups-filtered.png")

    # 3. Gene set analysis of the group: Run, then Send in the consent bar
    page.click(f"{T(GS)} .gs-run")
    page.wait_for_selector(f"{T(GS)} .gs-consent:not([hidden])", timeout=15000)
    clean(page)
    page.locator(f"{T(GS)} .gs-consent").screenshot(path=str(OUT / "gene-groups-consent.png"))
    page.click(f"{T(GS)} .gs-consent button:has-text('Send')")
    until(page, SETTLED, "the gene set sections")
    page.wait_for_timeout(1500)
    s = gs_state(page)
    log("gene set run: " + json.dumps({k: r["status"] for k, r in s["runs"].items() if r["visible"]})
        + f", snapshot {s['snapshot']['count']} genes")
    log("gene set bar: " + page.locator(f"{T(GS)} .gs-bar__text").inner_text())
    log("STRING enrichment: " + page.locator(f'{T(GS)} .gs-section[data-section="string-enrichment"]')
        .inner_text()[:400].replace("\n", " | "))
    log("STRING network: " + page.locator(f'{T(GS)} .gs-section[data-section="string-network"]')
        .inner_text()[:300].replace("\n", " | "))
    log("STRING rows: " + json.dumps(page.evaluate(f"""[...document.querySelectorAll(
        '{T(GS)} .gs-section[data-section="string-enrichment"] tbody tr')].slice(0, 8)
        .map(r => r.innerText.replace(/\\t/g, ' | '))""")))
    clean(page)
    page.locator(f"{T(GS)} .tile-content").first.screenshot(path=str(OUT / "gene-groups-geneset.png"))
    page.locator(f'{T(GS)} .gs-section[data-section="string-network"]').screenshot(
        path=str(OUT / "gene-groups-network.png"))
    save("gene-groups-filtered", {"v": 1, "constants": dict(CONST),
                                  "layout": json.loads(page.evaluate("JSON.stringify(PanelManager.saveLayout())"))},
         "Gene groups: filtered")

    # 4. Tighten a threshold: the table, the volcano and the gene set panel follow
    set_value(page, 0, 0.5)
    sh.ready(page)
    n_rows2, n_plot2 = rows_passing(page), plot_in_table(page)
    log(f"filter rho > 0.5: {info(page)}; rows {n_rows2}; volcano colours {n_plot2}")
    if n_plot2 != n_rows2:
        fail(f"after the change the volcano colours {n_plot2}, the table passes {n_rows2}")
    until(page, f"() => /Selection changed|changed/.test(document.querySelector('{T(GS)} .gs-bar__text').textContent)",
          "the gene set panel to say its results are stale", 60)
    page.wait_for_timeout(600)
    bar = page.locator(f"{T(GS)} .gs-bar__text").inner_text()
    log(f"gene set bar after the change: {bar}")
    clean(page)
    page.locator(f"{T(GS)} .gs-bar").screenshot(path=str(OUT / "gene-groups-stale.png"))
    # Auto-update on: the panel runs again by itself for the new group
    page.click(f"{T(GS)} .gs-auto")
    until(page, f"""() => {{ const s = window.PanelManager.getPanel('{GS}')._debugState();
        return s.snapshot && s.snapshot.count === {n_rows2} && !s.stale; }}""", "the automatic rerun")
    until(page, SETTLED, "the rerun's sections")
    page.wait_for_timeout(1500)
    log("gene set bar after Auto-update: " + page.locator(f"{T(GS)} .gs-bar__text").inner_text())
    clean(page)
    full(page, OUT / "gene-groups-tightened.png")
    page.locator(f"{T(GS)} .gs-bar").screenshot(path=str(OUT / "gene-groups-rerun-bar.png"))
    save("gene-groups-tightened", {"v": 1, "constants": dict(CONST),
                                   "layout": json.loads(page.evaluate("JSON.stringify(PanelManager.saveLayout())"))},
         "Gene groups: tightened, auto-update on")

    # 5. Focus another cell: the column keeps its cell, the group and the results stay
    before = (headers(page), rows_passing(page), gs_state(page)["snapshot"]["hash"])
    focus_cell(sh, page, MONO)
    page.wait_for_timeout(2500)
    sh.ready(page)
    focused = page.evaluate("document.getElementById('focused-cell').value")
    after = (headers(page), rows_passing(page), gs_state(page)["snapshot"]["hash"])
    log(f"refocus: focused cell {focused}; headers {after[0]}; rows {after[1]}; {info(page)}")
    if focused != MONO:
        fail(f"the focused cell is {focused}, not {MONO}")
    if before != after:
        fail(f"focusing another cell changed the table: {before} -> {after}")
    if gs_state(page)["stale"]:
        fail("the gene set panel went stale on a cell focus change")
    clean(page)
    clip(page, OUT / "gene-groups-refocused-header.png", ["#focused-cell", f"{T(TBL)} .dataTables_scrollHead",
                                                           f"{T(TBL)} .dataTables_info"])
    # the chooser now offers the monocyte as well, beside the HSC the table already holds
    toggle_controls(sh, page, TBL)
    tab("layers")
    labels = page.evaluate(f"[...document.querySelectorAll('{t} .tab-pane.active label')]"
                           f".map(l => l.textContent.trim()).filter(l => l.startsWith('{FC}:'))")
    log(f"refocus: layer chooser {labels}")
    clean(page)
    page.locator(f"{t} .table-controls").first.screenshot(path=str(OUT / "gene-groups-chooser-after.png"))
    page.context.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8823)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="annzarro-genegroups-"))
    (data_dir / STORE).symlink_to(DATA_DIR / STORE)
    with Session(a.port, OUT, data_dir=data_dir) as sh:
        shoot(sh, str(data_dir / STORE))
    finish("gene-groups-")
