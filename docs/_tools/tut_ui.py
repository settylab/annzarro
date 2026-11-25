"""Helpers for the tutorial screenshot scripts that drive the real interface the way a reader does.

Used by shoot_tut_dotplot.py and shoot_tut_signature.py: they add panels from the panel chooser, type into
them, press their buttons and read what the plots hold, and stop with a message that says where the
page's steps and the application part ways (`fail`).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import DATA_DIR  # noqa: E402


def T(tid: str) -> str:
    return f'.tile[data-tile-id="{tid}"]'


def fail(msg: str):
    raise SystemExit(f"STEP FAILED: {msg}")


def data_dir_with(*stores: str) -> Path:
    """A temporary data directory of symlinks to the named stores in ANNZARRO_DOCS_DATA."""
    d = Path(tempfile.mkdtemp(prefix="tutorial-data-"))
    for s in stores:
        os.symlink(DATA_DIR / s, d / s)
    return d


def until(page, js, what, arg=None, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js, arg) if arg is not None else page.evaluate(js):
            return
        page.wait_for_timeout(250)
    fail(f"timed out waiting for {what}")


def open_plain(sh, dataset, viewport=None):
    """Open a dataset with no view (the panel chooser only)."""
    import urllib.parse
    ctx = sh.browser.new_context(viewport=viewport or {"width": 1600, "height": 1000}, device_scale_factor=1.5, color_scheme="light")
    page = ctx.new_page()
    page._inflight = set()
    page.on("request", lambda r: page._inflight.add(r))
    page.on("requestfinished", lambda r: page._inflight.discard(r))
    page.on("requestfailed", lambda r: page._inflight.discard(r))
    page.on("console", lambda m: sh.log.append(f"console.{m.type}: {m.text[:300]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: sh.log.append(f"pageerror: {e}"))
    page.goto(f"{sh.base}/?dataset_path={urllib.parse.quote(str(dataset))}")
    page.wait_for_selector(".tile-selector", timeout=60000)
    page.wait_for_function("document.getElementById('cell-count').textContent.trim() !== '-'", timeout=60000)
    time.sleep(1.5)
    return page


def add_panel(page, kind: str) -> str:
    """Press a card of the panel chooser; the id of the new panel."""
    before = set(page.evaluate("(k) => window.PanelManager.getPanelsByType(k).map(p => p.getId())", kind))
    page.locator(f'.panel-type-option[data-type="{kind}"]:visible').last.click()
    until(page, "([k, b]) => window.PanelManager.getPanelsByType(k).some(p => !b.includes(p.getId()))", f"a new {kind}", [kind, sorted(before)])
    page.wait_for_timeout(800)
    return [i for i in page.evaluate("(k) => window.PanelManager.getPanelsByType(k).map(p => p.getId())", kind) if i not in before][0]


def rename(page, pid: str, title: str) -> None:
    box = page.locator(f"{T(pid)} input.tile-title")
    box.click()
    box.fill(title)
    box.press("Enter")
    page.wait_for_timeout(300)


def controls_dump(page, scope: str) -> str:
    """What is visible in a scope, for a failure message."""
    return json.dumps(page.evaluate("""(s) => [...document.querySelectorAll(s + ' button, ' + s + ' select, ' + s + ' input, ' + s + ' textarea')]
        .filter(e => e.offsetParent).map(e => (e.tagName + '.' + (e.className || '').toString().slice(0, 40) + ' ' + (e.textContent || e.placeholder || e.title || '').trim().slice(0, 40)))""", scope))


def make_signature(page, title: str, genes: list[str], paste: bool = False) -> str:
    """A Gene Signature with the genes: typed one by one (Enter ticks the match), or pasted."""
    pid = add_panel(page, "gene-signature")
    if paste:
        page.locator(f'{T(pid)} button', has_text="Paste or upload").first.click()
        page.locator(f"{T(pid)} textarea").first.fill(", ".join(genes))
        page.locator(f'{T(pid)} button', has_text="Preview").first.click()
        page.wait_for_timeout(600)
        add = page.locator(f'{T(pid)} button', has_text="Add ")
        add = add.filter(has_text="gene")
        if add.count() == 0:
            fail("no 'Add n genes' button in the paste preview: " + controls_dump(page, T(pid)))
        add.first.click()
    else:
        box = page.locator(f"{T(pid)} input.gsig-search")
        for g in genes:
            box.click()
            box.fill(g)
            box.press("Enter")
            page.wait_for_timeout(250)
    page.wait_for_timeout(500)
    rename(page, pid, title)
    return pid


def plot_data(page, pid: str):
    """The traces of a panel's Plotly plot as plain data (first 400 values of each array)."""
    return page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); if (!gd || !gd.data) return null;
        const a = (v) => (v === undefined || v === null) ? null : Array.from(v).slice(0, 4000);
        return gd.data.map(d => ({type: d.type, name: d.name || '', x: a(d.x), y: a(d.y), z: d.z ? d.z.map(r => a(r)) : null,
            color: d.marker && d.marker.color ? a(d.marker.color) : null, size: d.marker && d.marker.size ? a(d.marker.size) : null,
            text: a(d.text), hover: a(d.hovertext)})); }""", T(pid))


def make_gene_table(page, title: str, columns: list[tuple[str, str]], conditions: list[tuple[str, str, str]] | None = None, log=print) -> str:
    """A Gene Table with ticked columns (tab, label) and filter conditions (column label, condition, value), built through
    the column chooser and Advanced Search; returns its id and logs how many genes pass."""
    pid = add_panel(page, "gene-table")
    t = T(pid)
    page.wait_for_selector(f"{t} .nav-link", timeout=30000)
    for tab, label in columns:
        page.locator(f"{t} .nav-link", has_text=tab).first.click()
        page.wait_for_timeout(400)
        loc = page.locator(f"{t} label:text-is('{label}')")
        if loc.count() == 0:
            fail(f"the column chooser offers no '{label}' on {tab}: " + controls_dump(page, t)[:800])
        loc.first.click()
        page.wait_for_timeout(300)
    page.locator(f"{t} button", has_text="Apply Changes").click()
    page.wait_for_timeout(2500)
    rename(page, pid, title)
    for i, (col, cond, val) in enumerate(conditions or []):
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
