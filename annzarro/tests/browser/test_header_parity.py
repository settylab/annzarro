"""Every panel's header (and the Add panel tile's) has the same background grey, one token, light and dark; no exceptions.

One panel of every kind (Cell, Gene, Cell-Gene, Count, Cell and Gene Table, Gene Set, Gene Signature, Cell Grouping) and an empty
tile (the Add panel chooser) are opened together; their headers' computed background is compared.
Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page  # noqa: E402,F401

TYPES = ["cell-plot", "gene-plot", "cell-table", "gene-table", "gene-set", "gene-signature", "cell-grouping", "cell-gene", "cell-count"]
EXCEPTIONS = {}


def _url(served):
    root, store = served
    ids = [f"{t}-H" for t in TYPES]
    nodes = [{"type": "tile", "id": i, "controlsVisible": True} for i in ids] + [{"type": "selector"}]
    configs = {i: {"id": i, "title": t} for i, t in zip(ids, TYPES)}
    configs["cell-grouping-H"] = {"id": "cell-grouping-H", "title": "Grouping", "version": 1,
                                  "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}      # a factor card
    view = {"v": 1, "layout": {"v": 1, "hierarchy": nodes, "controlState": {i: True for i in ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


READ = """() => [...document.querySelectorAll('.tile')].map((t) => { const h = t.querySelector('.tile-header, .tile-selection-header, .panel-header');
    return [t.dataset.tileId || 'selector', h ? getComputedStyle(h).backgroundColor : null, h ? h.className : null]; })
    .concat([...document.querySelectorAll('.tile-selector')].map((t) => ['selector', (() => { const h = t.querySelector('.tile-selection-header'); return h ? getComputedStyle(h).backgroundColor : null; })(), 'tile-selection-header']))"""


def test_every_panel_header_has_the_same_grey(page, served):
    page.set_viewport_size({"width": 1700, "height": 1100})
    page.goto(_url(served))
    page.wait_for_function("() => document.querySelectorAll('.tile .tile-header').length >= 9", timeout=60000)
    for theme in ("light", "dark"):
        page.click(f'#theme-toggle button[data-theme-mode="{theme}"]')
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=theme)
        rows = page.evaluate(READ)
        assert len([r for r in rows if r[0] != "selector"]) >= 9, rows
        colours = {r[0]: r[1] for r in rows if r[0] not in EXCEPTIONS}
        assert len(set(colours.values())) == 1, f"{theme}: panel headers differ: {colours}"
        token = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--az-panel-header-bg').trim()")
        assert token, "the one token --az-panel-header-bg is not defined on :root"


# ------------------------------------------------------------------ the states a header takes, and the inner headers that look like one

INNER = {"table toolbar strip": ".tile[data-tile-id='cell-table-H'] .table-controls",
         "gene table toolbar strip": ".tile[data-tile-id='gene-table-H'] .table-controls",
         "gene signature status strip": ".tile[data-tile-id='gene-signature-H'] .gsig-status",
         "grouping factor card bar": ".tile[data-tile-id='cell-grouping-H'] .az-card__bar",
         "gene set section header": ".tile[data-tile-id='gene-set-H'] .gs-section__head"}
INNER_EXCEPTIONS = {}      # name -> reason; empty on purpose

BG = "(sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : null; }"


def test_a_header_keeps_its_grey_in_every_state(page, served):
    page.set_viewport_size({"width": 1700, "height": 1100})
    page.goto(_url(served))
    page.wait_for_function("() => document.querySelectorAll('.tile .tile-header').length >= 9", timeout=60000)
    head = ".tile[data-tile-id='cell-plot-H'] .tile-header"
    other = ".tile[data-tile-id='cell-count-H'] .tile-header"
    for theme in ("light", "dark"):
        page.click(f'#theme-toggle button[data-theme-mode="{theme}"]')
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=theme)
        rest = page.evaluate(BG, head)
        seen = {"rest": rest, "other panel": page.evaluate(BG, other)}
        page.hover(head)
        seen["hover"] = page.evaluate(BG, head)
        page.focus(f"{head} .tile-title")
        seen["title focused"] = page.evaluate(BG, head)
        seen["panel focused"] = page.evaluate(BG, head)
        page.click(f"{head} .tile-toggle-controls")
        seen["controls collapsed"] = page.evaluate(BG, head)
        page.click(f"{head} .tile-toggle-controls")
        page.evaluate("(sel) => document.querySelector(sel).closest('.tile').querySelector('.tile-content').classList.add('subset-loading')", head)
        seen["dataset switching dim"] = page.evaluate(BG, head)
        page.evaluate("(sel) => document.querySelector(sel).closest('.tile').querySelector('.tile-content').classList.remove('subset-loading')", head)
        page.evaluate("() => document.querySelectorAll('.split-handle').forEach((h) => h.classList.add('dragging'))")
        seen["split handle dragging"] = page.evaluate(BG, head)
        page.evaluate("() => document.querySelectorAll('.split-handle').forEach((h) => h.classList.remove('dragging'))")
        assert len(set(seen.values())) == 1, f"{theme}: a panel header changes shade: {seen}"


def test_the_inner_headers_use_the_panel_header_grey(page, served):
    page.set_viewport_size({"width": 1700, "height": 1100})
    page.goto(_url(served))
    page.wait_for_function("() => document.querySelectorAll('.tile .tile-header').length >= 9", timeout=60000)
    for theme in ("light", "dark"):
        page.click(f'#theme-toggle button[data-theme-mode="{theme}"]')
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=theme)
        want = page.evaluate(BG, ".tile[data-tile-id='cell-plot-H'] .tile-header")
        got = {name: page.evaluate(BG, sel) for name, sel in INNER.items() if name not in INNER_EXCEPTIONS}
        missing = [n for n, v in got.items() if v is None]
        assert not missing, f"not found in the page: {missing}"
        bad = {n: v for n, v in got.items() if v != want}
        assert not bad, f"{theme}: inner headers differ from the panel header {want}: {bad}"
