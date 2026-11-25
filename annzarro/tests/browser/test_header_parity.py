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
