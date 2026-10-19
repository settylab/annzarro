"""Screenshots and views for the tutorial "Select an area with lines" (docs/tutorials/line-select.md).

It drives the real UI the way the page tells a reader to: arms the Line button of a cell table,
drags lines on the UMAP with the mouse (headless Chromium), switches the outer AND of Advanced
Search to OR, and hovers a plot with a text axis. Every count the page quotes is read off the app
here and printed in the log.

Writes
  docs/_static/screens/tutorials/line-select-*.png

Run (it starts its own server on --port):
  python docs/_tools/shoot_line_select.py [--port 8825]

Data: bm_aging_annzarro.zarr in ANNZARRO_DOCS_DATA (default ~/annzarro-data).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, Session, split, tile  # noqa: E402
import shoot_userguide as su  # noqa: E402  (its capture() draws the red box: outline and number disc)

OUT = HERE.parent / "_static" / "screens" / "tutorials"
STORE = "bm_aging_annzarro.zarr"
TBL, PLOT, TEXT = "cell-table-a", "cell-plot-a", "cell-plot-b"
UMAP = lambda c: {"type": "obsm", "key": "X_umap", "column": c}   # noqa: E731
OBS = lambda k: {"type": "obs", "key": k, "column": ""}   # noqa: E731

# a lobe of the UMAP: four corners in data units, counter-clockwise on the screen from the bottom left
CORNERS = [(9.5, -2.0), (17.5, -0.5), (16.0, 5.0), (9.0, 3.5)]


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


def view(with_text_plot=False):
    cfgs = {
        TBL: {"id": TBL, "title": "Cells", "columns": [OBS("highres_celltype"), OBS("Age")]},
        PLOT: {"id": PLOT, "title": "UMAP", "x": UMAP("0"), "y": UMAP("1"), "z": None,
               "color": OBS("highres_celltype"), "pointSize": 3, "pointOpacity": 0.8, "tableFilter": "none"},
    }
    right = tile(PLOT)
    controls = {TBL: False, PLOT: False}
    if with_text_plot:
        cfgs[TEXT] = {"id": TEXT, "title": "Age by cell type", "x": OBS("highres_celltype"), "y": OBS("Age"),
                      "z": None, "pointSize": 3, "color": {"type": "none"}, "tableFilter": "none"}
        right = split("vertical", tile(PLOT), tile(TEXT), 65)
        controls[TEXT] = False
    layout = split("horizontal", tile(TBL), right, 40)
    layout["height"] = 1000
    return {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [layout], "controlState": controls,
                                                "panelConfigs": cfgs}}


def rows(page):
    return page.evaluate(f"PanelManager.getPanel('{TBL}').getConfig().currentEntries.length")


def area(page):
    return page.evaluate(f"""() => {{ const g = document.getElementById('plot-container-{PLOT}');
        const r = g.getBoundingClientRect(), fl = g._fullLayout, x = fl.xaxis, y = fl.yaxis;
        return {{left: r.left + x._offset, top: r.top + y._offset, w: x._length, h: y._length,
                 xr: x.range, yr: y.range}}; }}""")


def at(a, X, Y):
    """Page pixels of a data point."""
    fx = (X - a["xr"][0]) / (a["xr"][1] - a["xr"][0])
    fy = 1 - (Y - a["yr"][0]) / (a["yr"][1] - a["yr"][0])
    return a["left"] + fx * a["w"], a["top"] + fy * a["h"]


def corner(page, i):
    """Page pixels of a corner of the lobe, measured now: the plot moves when the table above grows."""
    return at(area(page), *CORNERS[i])


def line(page, i, j, hold=False):
    """Drag from corner i to corner j."""
    p, q = corner(page, i), corner(page, j)
    page.mouse.move(*p)
    page.mouse.down()
    page.mouse.move(*q, steps=10)
    if not hold:
        page.mouse.up()


def wait_rows(page, before):
    page.wait_for_function(f"n => PanelManager.getPanel('{TBL}').getConfig().currentEntries.length !== n",
                           arg=before, timeout=60000)
    page.wait_for_timeout(2500)


def clean(page):
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")


def arm(page):
    page.click(f"{T(TBL)} .az-line-select-btn")
    page.wait_for_selector(f'.az-line-overlay[data-plot="{PLOT}"]')
    page.wait_for_timeout(500)


_annotate = su.annotate


def _padded(path, marks, pad=6):
    """The helper's box, a few pixels wider all round, so the red of an armed button stays visible inside it."""
    g = pad * su.DSF
    _annotate(path, [(label, (x0 - g, y0 - g, x1 + g, y1 + g)) for label, (x0, y0, x1, y1) in marks])


su.annotate = _padded


def mark(page, name, region=None):
    """A screenshot with the Line filter button in a red box (the highlight helper of the other
    guides: shoot_userguide.capture, outline and number disc in the one accent colour)."""
    su.OUT = OUT
    su.capture(SH, page, name, region, marks=[(1, f"{T(TBL)} .az-line-select-btn")])


SH = None
# two lines that cut away part of the UMAP, in data units: the group at the bottom, then the arm at the left
CUT_BOTTOM = ((-8.0, -2.6), (21.0, -0.9))      # drawn left to right: what is below goes
CUT_LEFT = ((1.5, 17.0), (1.5, -9.0))          # drawn downwards: what is left of it goes


def shoot(sh):
    global SH
    SH = sh
    log = sh.log.append
    page = sh.open(view(), dataset=STORE, viewport={"width": 1700, "height": 1000})
    total = rows(page)
    log(f"cells: {total}")
    a = area(page)

    # armed: the Line filter button, and the hint on the plot
    arm(page)
    page.mouse.move(*at(a, 4, 10))
    mark(page, "line-select-armed")

    page.context.close()
    if os.environ.get("LINE_SELECT_DARK_DIR"):         # a look at the dark theme, not part of the docs
        page = sh.open(view(), dataset=STORE, viewport={"width": 1700, "height": 1000}, scheme="dark")
        arm(page)
        page.mouse.move(*at(area(page), 4, 10))
        su.OUT = Path(os.environ["LINE_SELECT_DARK_DIR"])
        su.capture(SH, page, "line-select-armed-dark", None, marks=[(1, f"{T(TBL)} .az-line-select-btn")])
        page.context.close()
    page = sh.open(view(), dataset=STORE, viewport={"width": 1700, "height": 1000})
    a = area(page)
    arm(page)

    # the first line, mid-drag: the line and the shaded side that will be filtered out
    p, q = (at(area(page), *c) for c in CUT_BOTTOM)
    page.mouse.move(*p)
    page.mouse.down()
    page.mouse.move(*q, steps=10)
    mark(page, "line-select-preview")
    page.mouse.up()
    wait_rows(page, total)
    n1 = rows(page)
    log(f"after the first line (bottom): {n1} of {total}")
    page.mouse.move(*at(area(page), 4, 10))
    mark(page, "line-select-one")

    # the second line
    p, q = (at(area(page), *c) for c in CUT_LEFT)
    page.mouse.move(*p)
    page.mouse.down()
    page.mouse.move(*q, steps=10)
    page.mouse.up()
    wait_rows(page, n1)
    n2 = rows(page)
    log(f"after the second line (left): {n2} of {total}")
    log("headers: " + str(page.evaluate(f"[...document.querySelectorAll('{T(TBL)} .dataTables_scrollHead th')].map(t => t.textContent.trim())")))
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    page.mouse.move(2, 2)
    mark(page, "line-select-two")
    page.locator(f"{T(TBL)} .dtsb-searchBuilder").screenshot(path=str(OUT / "line-select-conditions.png"))
    page.context.close()

    # an area: four lines, counter-clockwise on the screen from the bottom left, the area on the left of each
    page = sh.open(view(), dataset=STORE, viewport={"width": 1700, "height": 1000})
    arm(page)
    for name, i, j in (("bottom", 0, 1), ("right", 1, 2), ("top", 2, 3), ("left", 3, 0)):
        before = rows(page)
        line(page, i, j)
        wait_rows(page, before)
        log(f"area, {name}: {rows(page)} of {total}")
    n_area = rows(page)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    page.mouse.move(2, 2)
    mark(page, "line-select-area")
    page.locator(f"{T(TBL)} .dtsb-searchBuilder").screenshot(path=str(OUT / "line-select-table.png"))
    page.context.close()

    # the other way round: lines drawn clockwise, outer AND switched to OR, filters the area out
    page = sh.open(view(), dataset=STORE, viewport={"width": 1700, "height": 1000})
    arm(page)
    for i, j in ((0, 3), (3, 2), (2, 1), (1, 0)):
        before = rows(page)
        line(page, i, j)
        if before > 0:
            wait_rows(page, before)
        else:
            page.wait_for_timeout(3000)
        log(f"clockwise: {rows(page)} of {total}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    page.locator(f"{T(TBL)} .dtsb-group > .dtsb-logicContainer button").first.click()
    page.wait_for_timeout(3000)
    n_out = rows(page)
    log(f"clockwise lines, outer OR: {n_out} of {total} (area {n_area}; sum {n_out + n_area})")
    page.mouse.move(2, 2)
    mark(page, "line-select-or")
    page.locator(f"{T(TBL)} .dtsb-searchBuilder").screenshot(path=str(OUT / "line-select-or-conditions.png"))
    page.context.close()

    # a plot with a text axis says why
    page = sh.open(view(True), dataset=STORE, viewport={"width": 1700, "height": 1000})
    arm(page)
    box = page.locator(f"#plot-container-{TEXT}").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.3)
    page.wait_for_selector("#line-select-tip")
    mark(page, "line-select-warning")
    page.context.close()


def finish() -> None:
    """Re-save this page's shots; a large one as 256 colours (as shoot_gene_groups.py does)."""
    from PIL import Image
    for path in sorted(OUT.glob("line-select-*.png")):
        im = Image.open(path).convert("RGB")
        im.save(path, optimize=True)
        if path.stat().st_size > 400_000:
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8825)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(port=args.port, out=OUT) as sh:
        shoot(sh)
    finish()


if __name__ == "__main__":
    main()
