"""Screenshots and views for the tutorial "Analyse a gene set" (docs/tutorials/gene-set-analysis.md).

It drives the real UI the way the page tells a reader to and stops when the app does not do
what the page says: it ticks the gene table's columns, types four filter conditions into
Advanced Search, adds a Gene Set Analysis panel from the bottom selector, reads its IDs and
Species, presses Run and then Send in the consent bar, reads the results, downloads a CSV,
changes a threshold and runs again.

The panel fetches its results from external services, so this script does too: STRING,
g:Profiler and MyGene.info answer for real, and the pictures show what they answered on the
day the script ran (printed at the top of the log; the page quotes it). What is sent: the
gene ids of the table's selection, the species, and the dataset's genes as the background.

Writes
  docs/_static/screens/tutorials/gene-set-analysis-*.png
  docs/_tools/views/gene-set-analysis-*.json                 the views below
  docs/_static/panelsets/tutorials/gene-set-analysis-*.json  their panel set files and .url.txt links

Run (it starts its own server on --port):
  python docs/_tools/shoot_gene_set_tutorial.py [--port 8824]

Data: bm_aging.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data), served from a temporary
data directory of symlinks.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, panelset_file, split, start_link, tile  # noqa: E402

DOCS = HERE.parent
OUT = DOCS / "_static" / "screens" / "tutorials"
VIEWS = HERE / "views"
PANELSETS = DOCS / "_static" / "panelsets" / "tutorials"
STORE = "bm_aging.zarr"
NAME = "gene-set-analysis"

HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
FC = "kompot_de_Young_to_Old_fold_change"
MAHAL = "kompot_de_Young_to_Old_mahalanobis"
LFC = "kompot_de_Young_to_Old_mean_lfc"
ISDE = "kompot_de_Young_to_Old_is_de"
FC_LABEL = f"{FC}: {HSC}"
# No taxonomy id: the reader checks what the panel finds for Species
CONST = {"focusedGene": "H2-Q7", "focusedCell": HSC}

TBL, PLOT = "gene-table-s", "gene-plot-s"


def T(tid: str) -> str:
    return f'.tile[data-tile-id="{tid}"]'


def var(key: str) -> dict:
    return {"type": "var", "key": key, "column": ""}


def start_view() -> dict:
    cfgs = {
        TBL: {"id": TBL, "title": "Up in old, DE, rising in the HSC", "columns": [var(MAHAL), var(LFC)]},
        PLOT: {"id": PLOT, "title": "Volcano: the table's genes in colour", "x": var(LFC), "y": var(MAHAL),
               "z": None, "color": {"type": "layer", "key": FC, "column": HSC, "locked": True},
               "colorScale": "RdBu", "centeringActive": True, "pointSize": 6, "pointOpacity": 0.9,
               "highlightFocusedGene": True, "tableFilter": TBL, "removeNonTableEntries": False},
    }
    layout = split("horizontal", tile(TBL), tile(PLOT), 55)
    return {"v": 1, "constants": dict(CONST),
            "layout": {"v": 1, "hierarchy": [layout],
                       "controlState": {k: False for k in cfgs}, "panelConfigs": cfgs}}


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


def clean(page):
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")
    page.mouse.move(2, 2)
    page.wait_for_timeout(300)


def full(page, path):
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


def rows_passing(page) -> int:
    return page.evaluate(f"() => window.PanelManager.getPanel('{TBL}').getConfig().currentEntries.length")


def criterion(page, n, col, cond, val):
    c = page.locator(f"{T(TBL)} .dtsb-criteria").nth(n)
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


def shoot(sh, store: str) -> None:
    log = sh.log.append
    log(f"date of the shots: {date.today().isoformat()}")
    v = start_view()
    save(f"{NAME}-start", v, "Gene set analysis: start")
    page = sh.open(v, dataset=store)
    t = T(TBL)

    # 1. The set: two volcano thresholds, the DE label, and a column from a chosen cell
    toggle_controls(sh, page, TBL)

    def tab(name):
        page.locator(f"{t} .nav-link", has_text=name).first.click()
        page.wait_for_timeout(400)

    def tick(label):
        loc = page.locator(f"{t} label:text-is('{label}')")
        if loc.count() == 0:
            fail(f"the column chooser offers no '{label}'")
        loc.first.click()
        page.wait_for_timeout(300)

    tab("var")
    tick(ISDE)
    tab("layers")
    tick(f"{FC_LABEL} (focused)")
    page.locator(f"{t} button", has_text="Apply Changes").click()
    sh.ready(page)
    toggle_controls(sh, page, TBL)
    for i, (col, cond, val) in enumerate([(MAHAL, "Greater Than", 5), (LFC, "Greater Than", 0.05),
                                          (ISDE, "Equals", "Yes"), (FC_LABEL, "Greater Than", 0)]):
        page.locator(f"{t} button", has_text="Add Condition").first.click()
        page.wait_for_timeout(800)
        criterion(page, i, col, cond, val)
        log(f"set: after condition {i + 1} ({col} {cond} {val}): {rows_passing(page)} genes")
    sh.ready(page)
    n = rows_passing(page)
    if n != 52:
        fail(f"the four conditions keep {n} genes, expected 52")
    clean(page)
    full(page, OUT / f"{NAME}-set.png")

    # 2. Add the Gene Set Analysis panel from the bottom selector
    opt = page.locator('.panel-type-option[data-type="gene-set"]:visible')
    if opt.count() == 0:
        fail("no visible 'Gene Set Analysis' option in the bottom selector")
    opt.last.click()
    page.wait_for_timeout(1500)
    sh.ready(page)
    gid = page.evaluate("() => window.PanelManager.getPanelsByType('gene-set').map(p => p.getId())")
    if len(gid) != 1:
        fail(f"expected one gene set panel, found {gid}")
    gid = gid[0]
    GS = T(gid)
    until(page, f"() => window.PanelManager.getPanel('{gid}')._debugState().source.count === {n}",
          "the new panel to follow the table")
    # a tall window, so each section is shot whole rather than scrolled inside the tile
    page.set_viewport_size({"width": 1600, "height": 3000})
    sh.ready(page)
    page.locator(GS).first.scroll_into_view_if_needed()
    st = page.evaluate(f"() => window.PanelManager.getPanel('{gid}')._debugState()")
    species = page.locator(f"{GS} .gs-species input").first.input_value()
    log(f"panel: source {st['source']}, ids {st['idColumn']} as {st['idType']}, species '{species}', "
        f"bar '{page.locator(f'{GS} .gs-bar__text').inner_text()}'")
    if "Mus musculus" not in species:
        fail(f"Species reads '{species}'")
    clean(page)
    page.locator(f"{GS} .gs-controls").first.screenshot(path=str(OUT / f"{NAME}-controls.png"))

    # 3. Run: the consent bar says what is sent, and to whom
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])", timeout=15000)
    log("consent: " + page.locator(f"{GS} .gs-consent").inner_text().replace("\n", " | "))
    clean(page)
    page.locator(f"{GS} .gs-consent").screenshot(path=str(OUT / f"{NAME}-consent.png"))
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    settled = f"""() => {{ const s = window.PanelManager.getPanel('{gid}')._debugState();
        const r = Object.values(s.runs).filter(r => r.visible);
        return r.length > 0 && r.every(r => r.status === 'ok' || r.status === 'error'); }}"""
    until(page, settled, "the sections")
    page.wait_for_timeout(1500)
    st = page.evaluate(f"() => window.PanelManager.getPanel('{gid}')._debugState()")
    log("run: " + json.dumps({k: r["status"] for k, r in st["runs"].items() if r["visible"]}))
    log("bar: " + page.locator(f"{GS} .gs-bar__text").inner_text())

    def section(sid):
        return page.locator(f'{GS} .gs-section[data-section="{sid}"]')

    def rows(sid, k=8):
        return page.evaluate(f"""[...document.querySelectorAll('{GS} .gs-section[data-section="{sid}"] tbody tr')]
            .slice(0, {k}).map(r => r.innerText.replace(/\\t/g, ' | '))""")

    # STRING enrichment, one category (FDR is corrected within it)
    cat = section("string-enrichment").locator("select:has(option:text-matches('^All categories'))").first
    labels = cat.evaluate("s => [...s.options].map(o => o.text)")
    log(f"STRING categories: {labels}")
    go = next((x for x in labels if x.startswith("GO Process")), None)
    if go:
        cat.select_option(label=go)
        page.wait_for_timeout(800)
    log("STRING GO Process rows: " + json.dumps(rows("string-enrichment")))
    clean(page)
    section("string-enrichment").screenshot(path=str(OUT / f"{NAME}-string.png"))
    log("g:Profiler: " + section("gprofiler-gost").inner_text()[:300].replace("\n", " | "))
    log("g:Profiler rows: " + json.dumps(rows("gprofiler-gost")))
    section("gprofiler-gost").screenshot(path=str(OUT / f"{NAME}-gprofiler.png"))
    log("network: " + section("string-network").inner_text()[:400].replace("\n", " | "))
    section("string-network").screenshot(path=str(OUT / f"{NAME}-network.png"))
    log("card: " + section("mygene-card").inner_text()[:400].replace("\n", " | "))
    section("mygene-card").screenshot(path=str(OUT / f"{NAME}-card.png"))
    # the service's own page, and the CSV
    href = section("string-enrichment").locator("a[title^='Open in']").first.get_attribute("href")
    log(f"STRING open link: {href[:160]}")
    with page.expect_download() as dl:
        section("string-enrichment").locator("button[title='Download as CSV']").first.click()
    csv = Path(tempfile.mkdtemp()) / dl.value.suggested_filename
    dl.value.save_as(csv)
    lines = csv.read_text().splitlines()
    log(f"CSV {dl.value.suggested_filename}: {len(lines) - 1} rows; header {lines[0][:200]}; first {lines[1][:200]}")
    page.locator(f'{GS} .gs-links__list button:has-text("Show list")').click()
    page.wait_for_selector(f"{GS} .gs-links__table tbody tr")
    section("links").screenshot(path=str(OUT / f"{NAME}-links.png"))
    save(f"{NAME}-results", {"v": 1, "constants": dict(CONST),
                             "layout": json.loads(page.evaluate("JSON.stringify(PanelManager.saveLayout())"))},
         "Gene set analysis: the set and its panel")

    # 4. Change a threshold: stale, then Run again
    box = page.locator(f"{t} .dtsb-criteria").nth(3).locator("input.dtsb-value").first
    box.fill("0.3")
    box.press("Tab")
    page.wait_for_timeout(1500)
    sh.ready(page)
    n2 = rows_passing(page)
    log(f"threshold 0.3: {n2} genes")
    until(page, f"() => /Selection changed/.test(document.querySelector('{GS} .gs-bar__text').textContent)",
          "the stale notice", 60)
    log("stale bar: " + page.locator(f"{GS} .gs-bar__text").inner_text())
    clean(page)
    page.locator(f"{GS} .gs-bar").screenshot(path=str(OUT / f"{NAME}-stale.png"))
    page.click(f"{GS} .gs-run")
    page.wait_for_timeout(500)
    if page.locator(f"{GS} .gs-consent:not([hidden])").count():
        log("rerun: the consent bar asked again")
        page.click(f"{GS} .gs-consent button:has-text('Send')")
    until(page, f"""() => {{ const s = window.PanelManager.getPanel('{gid}')._debugState();
        return s.snapshot && s.snapshot.count === {n2} && !s.stale; }}""", "the rerun")
    until(page, settled, "the rerun's sections")
    page.wait_for_timeout(1500)
    log("rerun bar: " + page.locator(f"{GS} .gs-bar__text").inner_text())
    cat2 = section("string-enrichment").locator("select:has(option:text-matches('^All categories'))").first
    log(f"rerun: the category list reads '{cat2.evaluate('s => s.options[s.selectedIndex].text')}'")
    go2 = next((x for x in cat2.evaluate("s => [...s.options].map(o => o.text)") if x.startswith("GO Process")), None)
    if go2:
        cat2.select_option(label=go2)
        page.wait_for_timeout(800)
    log("rerun STRING rows: " + json.dumps(rows("string-enrichment")))
    page.evaluate(f"""() => {{ for (const e of document.querySelectorAll('{GS} *'))
        if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); }}""")
    log("rerun network: " + section("string-network").inner_text()[:300].replace("\n", " | "))
    clean(page)
    page.locator(f"{GS} .gs-bar").screenshot(path=str(OUT / f"{NAME}-rerun-bar.png"))
    section("string-enrichment").screenshot(path=str(OUT / f"{NAME}-string-rerun.png"))
    page.context.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8824)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data_dir = Path(tempfile.mkdtemp(prefix="annzarro-genesettut-"))
    (data_dir / STORE).symlink_to(DATA_DIR / STORE)
    with Session(a.port, OUT, data_dir=data_dir) as sh:
        shoot(sh, str(data_dir / STORE))
    finish("gene-set-analysis-")
