"""Screenshots for the paper's worked-example steps that the tutorials add by hand.

Each one starts from a tutorial's view and then does the step as a user would:

- Worked example 1, Steps 16-17 (cell-similarity.md): step the focus back with the history
  arrows; duplicate the walk panel from "Duplicate or Reopen Panel" and colour the copy by
  DM_Kernel.
- Worked example 2, Step 21 (gene-similarity.md): fade weak correlations with Blues, Reverse,
  Min 0.3 and the locked range, then move the focus.
- Worked example 4, Step 26 (cells-and-genes.md): set Color to varp spearman_fold_change,
  row Focused gene.
- Worked example 5, Steps 29 and 31 (tour.md): a regular expression in the table's search box;
  Export CSV of the filtered rows; click a cell ID to focus it.

Run (bm_aging.zarr and bm_aging_showcase.zarr in ANNZARRO_DOCS_DATA):

    .venv-docs/bin/python docs/_tools/shoot_we_steps.py

Writes docs/_static/screens/tutorials/we*.png and prints what each step showed.
"""
from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

from PIL import Image

import sys
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR, DSF, Session  # noqa: E402

OUT = HERE.parent / "_static" / "screens" / "tutorials"
PANELSETS = HERE.parent / "_static" / "panelsets" / "paper"
HSC = "HSPC_Old_1#GAAGCCCGTGGCTCTG-1"
LMPP = "HSPC_Old_2#ACTCTCGCAAACCGGA-1"
GMP = "HSPC_Old_3#ATTTCACTCGTAGTGT-1"


def T(tid):
    return f'.tile[data-tile-id="{tid}"]'


def view_of(name):
    d = json.loads((PANELSETS / f"{name}.json").read_text())
    return d["view"], d["dataset"]


def focused(page):
    return page.evaluate("document.getElementById('focused-cell').value")


def focus_cell(sh, page, name):
    """Click Focused Cell, type the name, Enter, Esc (as the tutorials say)."""
    page.click("#focused-cell")
    page.keyboard.press("Meta+A")
    page.keyboard.type(name, delay=10)
    page.wait_for_selector(".name-picker-option", timeout=30000)
    time.sleep(0.5)
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    sh.ready(page)


def finish(path: Path):
    im = Image.open(path).convert("RGB")
    im.save(path, optimize=True)
    if path.stat().st_size > 400_000:
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)


def crop(page, name, selectors, pad=8):
    page.add_style_tag(content="#notification-container, .notification, .hoverlayer { display: none !important; }")
    page.mouse.move(2, 2)
    time.sleep(0.3)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    boxes = [b for b in (page.locator(s).first.bounding_box() for s in selectors) if b]
    x0 = max(0, min(b["x"] for b in boxes) - pad)
    y0 = max(0, min(b["y"] for b in boxes) - pad)
    x1 = max(b["x"] + b["width"] for b in boxes) + pad
    y1 = max(b["y"] + b["height"] for b in boxes) + pad
    im = Image.open(path)
    im.crop((int(x0 * DSF), int(y0 * DSF), int(min(x1 * DSF, im.width)),
             int(min(y1 * DSF, im.height)))).save(path)
    finish(path)


def toggle_controls(sh, page, tid):
    page.locator(f"{T(tid)} .tile-toggle-controls").first.click()
    sh.ready(page)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    sh.ready(page)


def select_row(page, tid, axis, prefix):
    """Pick the option of an axis's row selector whose text starts with `prefix`."""
    sel = f"{T(tid)} .axis-column-select[data-axis={axis}]"
    value = page.evaluate("""([sel, prefix]) => {
        const o = [...document.querySelector(sel).options].find(o => o.text.startsWith(prefix));
        return o ? o.value : null; }""", [sel, prefix])
    if value is None:
        raise SystemExit(f"no row option {prefix!r} in {sel}")
    page.select_option(sel, value)


def walk(sh, data):
    v, ds = view_of("cell-by-cell-walk")
    page = sh.open(v, dataset=str(data / ds))
    W = next(k for k in v["layout"]["panelConfigs"] if k.startswith("cell-plot"))
    # Step 16: walk the focus along the path, then step back with the history arrows
    for name in (LMPP, GMP):
        focus_cell(sh, page, name)
    sh.log.append(f"WE1 step 16: focused after typing = {focused(page)}")
    page.click("#cell-history-back")
    sh.ready(page)
    after1 = focused(page)
    page.click("#cell-history-back")
    sh.ready(page)
    after2 = focused(page)
    sh.log.append(f"WE1 step 16: back = {after1}, back again = {after2}")
    crop(page, "we1-history", ["#cell-history-back", "#cell-history-forward", "#focused-cell"])
    page.click("#cell-history-forward")
    sh.ready(page)
    sh.log.append(f"WE1 step 16: forward = {focused(page)}")
    page.click("#cell-history-back")
    sh.ready(page)

    # Step 17: duplicate the walk panel and colour the copy by DM_Kernel
    page.locator(f"{T(W)} .tile-split-h").first.click()
    time.sleep(2)
    sec = page.locator(".split-pane .selection-section", has_text="Duplicate or Reopen Panel").last
    cards = sec.locator(".source-panel-option")
    sh.log.append("WE1 step 17: cards = " + json.dumps(cards.all_inner_texts()))
    sec.locator(".source-panel-option", has_text="5-step diffusion walk").first.click()
    time.sleep(2)
    sh.ready(page)
    tids = page.evaluate("[...document.querySelectorAll('.tile[data-tile-id^=\"cell-plot\"]')].map(t => t.dataset.tileId)")
    copy = next(t for t in tids if t != W)
    sh.log.append(f"WE1 step 17: copy = {copy}, title = "
                  + page.evaluate(f"(() => {{ const e = document.querySelector('{T(copy)} .tile-header input, {T(copy)} .tile-header .tile-title'); return e ? (e.value || e.textContent) : ''; }})()"))
    if page.locator(f"{T(copy)} .plot-controls").first.is_hidden():
        toggle_controls(sh, page, copy)
    page.select_option(f"{T(copy)} .axis-key-select[data-axis=color]", "DM_Kernel")
    time.sleep(1)
    sh.ready(page)
    sh.log.append("WE1 step 17: copy colour row = " + page.evaluate(
        f"document.querySelector('{T(copy)} .axis-column-select[data-axis=color]').selectedOptions[0].text"))
    toggle_controls(sh, page, copy)
    focus_cell(sh, page, GMP)
    sh.log.append(f"WE1 step 17: focused = {focused(page)}")
    # the table pane is below; shoot the two plots side by side
    crop(page, "we1-duplicate", [T(W), T(copy)], pad=0)
    page.context.close()


def fade(sh, data):
    v, ds = view_of("gene-by-gene-ab")
    page = sh.open(v, dataset=str(data / ds))
    G = next(k for k in v["layout"]["panelConfigs"] if k.startswith("gene-plot"))
    g = T(G)
    toggle_controls(sh, page, G)
    page.select_option(f"{g} [id^=color-scale-]", "Blues")
    sh.ready(page)
    page.locator(f"{g} [id^=reverse-colormap]").first.click()
    sh.ready(page)
    mn = page.locator(f"{g} [id^=color-min-]:not([id*=slider])").first
    mn.fill("0.3")
    mn.press("Enter")
    mn.dispatch_event("change")
    sh.ready(page)
    state = lambda: page.evaluate(f"""() => {{  // noqa: E731
        const q = s => document.querySelector('{g} ' + s);
        return {{min: q('[id^=color-min-]:not([id*=slider])').value, max: q('[id^=color-max-]:not([id*=slider])').value,
                lock: q('[id^=lock-range]').getAttribute('aria-pressed'),
                reverse: q('[id^=reverse-colormap]').getAttribute('aria-pressed'),
                strong: q('[id^=sort-by-color]').getAttribute('aria-pressed'),
                scale: q('[id^=color-scale-]').value}}; }}""")
    sh.log.append("WE2 step 21: controls = " + json.dumps(state()))
    crop(page, "we2-fade-controls", [f"{g} .color-range-controls"], pad=6)
    toggle_controls(sh, page, G)
    order = lambda: page.evaluate(f"""() => {{  // noqa: E731
        const gd = document.querySelector('{g} .js-plotly-plot');
        const t = gd._fullData.find(t => t.marker && Array.isArray(t.marker.color) && t.marker.color.length > 1000);
        const c = t.marker.color, n = c.length, last = c.slice(n - 500);
        return {{n, colorscale0: JSON.stringify(t.marker.colorscale[0]), cmin: t.marker.cmin, cmax: t.marker.cmax,
                last500_below_0_3: last.filter(v => v < 0.3).length, below_minus_0_3: c.filter(v => v < -0.3).length}}; }}""")
    # v0.4.0's Strong on top (on by default) orders by |value|: count how many of the 500
    # points drawn last are below Min, i.e. pale (anti-correlated genes among them)
    sh.log.append("WE2 step 21: draw order = " + json.dumps(order()))
    crop(page, "we2-fade", [f"{g} .tile-content"], pad=0)
    # the range holds as the focus moves
    page.click("#focused-gene")
    page.keyboard.press("Meta+A")
    page.keyboard.type("H2-Aa", delay=10)
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")
    sh.ready(page)
    sh.log.append("WE2 step 21: focus " + page.evaluate("document.getElementById('focused-gene').value")
                  + " -> " + json.dumps(order()))
    crop(page, "we2-fade-h2aa", [f"{g} .tile-content"], pad=0)
    page.context.close()


def rows(sh, data):
    v, ds = view_of("cells-and-genes-d")
    page = sh.open(v, dataset=str(data / ds))
    G = next(k for k in v["layout"]["panelConfigs"] if k.startswith("gene-plot"))
    toggle_controls(sh, page, G)
    c = T(G)
    page.select_option(f"{c} .axis-type-select[data-axis=color]", "varp")
    time.sleep(1)
    page.select_option(f"{c} .axis-key-select[data-axis=color]", "spearman_fold_change")
    time.sleep(1)
    select_row(page, G, "color", "Focused gene")
    sh.ready(page)
    sh.log.append("WE4 step 26: colour = " + page.evaluate(f"""[...document.querySelectorAll(
        '{c} .color-selector-container select')].map(s => s.selectedOptions[0] && s.selectedOptions[0].text).join(' | ')"""))
    crop(page, "we4-spearman-controls", [f"{c} .color-selector-container"], pad=6)
    toggle_controls(sh, page, G)
    crop(page, "we4-spearman", [f"{c} .tile-content"], pad=0)
    page.context.close()


def table(sh, data):
    v, ds = view_of("interface-table-filter")
    page = sh.open(v, dataset=str(data / ds))
    tab = next(k for k in v["layout"]["panelConfigs"] if k.startswith("cell-table"))
    t = T(tab)
    info = lambda: page.locator(f"{t} .dataTables_info").first.inner_text()  # noqa: E731
    sh.log.append(f"WE5 start: {info()}")
    box = page.locator(f"{t} .dataTables_filter input, {t} .dt-search input").first
    box.fill("Mid|Old")
    box.press("Enter")
    sh.ready(page)
    sh.log.append(f"WE5 step 29: 'Mid|Old' without regex: {info()}")
    page.locator(f"{t} .dt-search-option[title='Regular Expression Mode']").first.click()
    sh.ready(page)
    sh.log.append(f"WE5 step 29: 'Mid|Old' with regex: {info()}")
    # With smart search on (the default) DataTables wraps the term as ^(?=.*?TERM).*$, so a
    # bare alternation binds Old to the start of the row; parentheses keep it whole.
    box.fill("(Mid|Old)")
    box.press("Enter")
    sh.ready(page)
    sh.log.append(f"WE5 step 29: '(Mid|Old)' with regex: {info()}")
    sh.log.append("WE5 step 29: plot = " + json.dumps(page.evaluate("""() => {
        const g = document.querySelector('.tile[data-tile-id^="cell-plot"] .js-plotly-plot');
        return g._fullData.map(t => [t.name, (t.x || []).length]); }""")))
    crop(page, "we5-regex", [f"{t} .dt-search-container", f"{t} .dataTables_info"], pad=8)

    box.fill("Old")
    box.press("Enter")
    sh.ready(page)
    sh.log.append(f"WE5 step 29: 'Old' with regex: {info()}")
    box.fill("(Mid|Old)")
    box.press("Enter")
    sh.ready(page)

    # Step 31: Export CSV writes the rows that pass
    toggle_controls(sh, page, tab)
    with page.expect_download() as dl:
        page.locator(f"{t} button", has_text="Export CSV").click()
    path = Path(tempfile.mkdtemp()) / dl.value.suggested_filename
    dl.value.save_as(path)
    lines = path.read_text().splitlines()
    sh.log.append(f"WE5 step 31: {dl.value.suggested_filename}: {len(lines) - 1} rows, header {lines[0]}, "
                  f"first {lines[1]}")
    toggle_controls(sh, page, tab)
    first = page.locator(f"{t} span.entity-index-value").first
    name = first.get_attribute("data-entity")
    first.click()
    sh.ready(page)
    sh.log.append(f"WE5 step 31: clicked {name}, focused = {focused(page)}")
    page.context.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8871)
    ap.add_argument("--only", nargs="*", default=["walk", "fade", "rows", "table"])
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with Session(a.port, OUT, data_dir=DATA_DIR) as sh:
        for step in a.only:
            {"walk": walk, "fade": fade, "rows": rows, "table": table}[step](sh, DATA_DIR)


if __name__ == "__main__":
    main()
