"""The Cell-Gene Plot panel in a real browser, against the real cell_groups route (X3a).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition, 40
genes GENE000 to GENE039, X signed, layers ``logged`` and ``counts``.

1.  Nothing chosen: the panel says what to pick, and asks for nothing (CXG-2).
2.  Job 1, "marker genes of each cluster as a dot plot": an obs column and a signature, drawn as dots; one request,
    one feature per gene; switching to a heatmap asks for nothing (CXG-1 to CXG-3, CXG-18).
3.  Job 2, "three gene lists side by side": three sections with their titles and gene counts, a gene not in the dataset
    counted on its row (CXG-3, CXG-6, CXG-8, UX 3.2).
4.  Job 3, "one row per pathway": a one-row section; Color and Size each follow the plot's statistic and layer and choose
    only a gene step, under "Combine the gene rows" and "Score each cell", with the help line and, for a score's share,
    the threshold box; combining the rows sends no score request, a score sends one on the channel's layer (decision 40).
5.  Requested once: a section's genes as rows and as one row are asked for once, and adding a gene to the signature
    asks for that gene alone (CXG-18).
6.  The section list: Add genes, Genes / One row, the title edited in place, the ⋯ menu (Duplicate, Remove, Move up,
    Move down) and Alt+Up, each one undoable step (UX 3.2, UX 7).
7.  Groups: the type and key selects, a grouping as the cell axis, New grouping… (CXG-2, UX 3.1).
8.  A link carries the configuration as it was given, and a panel set added beside open panels remaps the cell axis
    and the sections (PER-1, CAT-9).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import time
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

P = "cell-gene-P"
GA = "cell-grouping-A"
S1 = "gene-signature-S1"
S2 = "gene-signature-S2"
S3 = "gene-signature-S3"
TP = f'.tile[data-tile-id="{P}"]'
VALUES = "[data-popover='values']"
DATA = gstore.make_data()
GENES = [gstore.gene(i) for i in range(gstore.N_VAR)]


def _make_store(path):
    gstore.make_store(str(path), "csc", "zarr", data=DATA)
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1100})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            # every POST to the route (estimates too), and the computations alone
            page.asked = []
            page.calls = []

            def seen(r):
                if "/data/cell_groups" not in r.url or r.method != "POST":
                    return
                body = json.loads(r.post_data or "{}")
                page.asked.append(body)
                if not body.get("estimate_only"):
                    page.calls.append(body)
            page.on("request", seen)
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _plot(**fields):
    return {"id": P, "title": "Cell-Gene Plot 1", "version": 1, "mode": "dots", "sections": [],
            "color": {"stat": "mean", "layer": "logged"}, "size": {"stat": "pct_expressing", "layer": "logged"}, **fields}


def _sig(pid, title, genes):
    return {"id": pid, "title": title, "genes": list(genes)}


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)] if tiles else [],
                               "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, configs, open_ids=(P,)):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{TP} .cgene-panel[data-state]", timeout=30000)


def _state(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState()", P)


def _drawn(page):
    """Wait for the plot to be drawn from the groups, and return the panel's state."""
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return e && e.dataset.state === 'ready'; }", TP, timeout=60)
    return _state(page)


def _features(calls):
    return [f for c in calls for f in (c.get("features") or [])]


def _settle(page, reason):
    """Nothing more is asked: a negative assertion, so it waits a fixed while."""
    n = len(page.calls)
    waits.expect_stays(lambda: len(page.calls) == n, reason, page=page, seconds=1.0)


def _config(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", P)


# ------------------------------------------------------------------ 1. nothing chosen

def test_nothing_chosen_says_what_to_pick_and_asks_nothing(page, served):
    _open(page, served, {P: {"id": P, "title": "Cell-Gene Plot 1"}})
    root = page.locator(f"{TP} .cgene-panel")
    assert root.get_attribute("data-state") == "empty"
    steps = page.locator(f"{TP} .cgene-checklist li")
    assert steps.count() == 2
    assert "Choose groups" in steps.nth(0).inner_text()
    assert "Add genes" in steps.nth(1).inner_text()
    assert steps.nth(0).get_attribute("data-done") == "false"
    _settle(page, "a plot with no groups and no genes must never ask the server; nothing happens to wait for")
    assert page.asked == []
    # choosing groups ticks the first step, and still asks for nothing (no genes yet)
    page.select_option(f"{TP} .cgene-axis-type", "obs")
    page.select_option(f"{TP} .cgene-axis-key", "cell_type")
    until(page, "(s) => document.querySelector(s + ' .cgene-checklist li').dataset.done === 'true'", TP)
    _settle(page, "groups with no genes are nothing to compute; the absence of a request cannot be waited on")
    assert page.asked == []


# ------------------------------------------------------------------ 2. job 1

def test_job1_marker_genes_as_a_dot_plot(page, served):
    genes = GENES[:5]
    # every statistic is listed on every layer (decision 31), so Color can change statistic on the layer it reads (CXG-11)
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", genes), GA: grouping}, open_ids=(P, S1))
    st = _drawn(page)
    assert st["groups"] == 6
    assert st["rows"] == 5
    feats = _features(page.calls)
    assert sorted(f["name"] for f in feats) == genes
    assert all(f["kind"] == "gene" and f["layer"] == "logged" for f in feats)
    assert len(page.calls) == 1, "one request: the groups and every gene together"
    traces = page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data.map(t => t.type)", TP)
    assert traces[0] in ("scatter", "scattergl")
    # a heatmap is drawn from what is held: nothing is asked
    n = len(page.calls)
    page.click(f"{TP} .cgene-mode input[value='heatmap']")
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').data[0].type === 'heatmap'", TP)
    assert len(page.calls) == n
    # so is a change of statistic on the same layer, or of the scale
    page.select_option(f"{TP} .cgene-color", "sum")
    assert page.input_value(f"{TP} .cgene-color-layer") == "logged", "the layer stays: it can give the sum (WP-4)"
    page.select_option(f"{TP} .cgene-scale", "var")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().scale === 'var'", P)
    _settle(page, "a change of statistic or scale reads only what is held, so there is no request to wait for")
    assert len(page.calls) == n


# ------------------------------------------------------------------ 3. job 2

def test_job2_three_lists_side_by_side(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                        sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "genes", "title": "T cells"},
                                  {"source": S3, "rows": "genes"}]),
               S1: _sig(S1, "B cell markers", GENES[0:3]), S2: _sig(S2, "T cell markers", GENES[3:6] + ["NOT_A_GENE"]),
               S3: _sig(S3, "Myeloid", GENES[6:8])}
    _open(page, served, configs, open_ids=(P, S1, S2, S3))
    st = _drawn(page)
    assert st["rows"] == 8
    rows = page.locator(f"{TP} .cgene-section")
    assert rows.count() == 3
    assert page.locator(f"{TP} .cgene-sections").get_attribute("role") == "list"
    titles = [rows.nth(i).locator(".cgene-section__title").input_value() for i in range(3)]
    assert titles == ["B cell markers", "T cells", "Myeloid"]
    assert rows.nth(1).locator(".cgene-section__source").inner_text() == "T cell markers"
    assert rows.nth(0).locator(".cgene-section__source").count() == 0 or not rows.nth(0).locator(".cgene-section__source").is_visible()
    assert rows.nth(1).locator(".cgene-section__count").inner_text() == "4 genes · 1 not in this dataset"
    assert rows.nth(0).locator(".cgene-section__count").inner_text() == "3 genes"
    feats = _features(page.calls)
    assert "NOT_A_GENE" not in [f["name"] for f in feats], "a gene not in the dataset is left out"
    # the drawing carries the sections, in order
    labels = page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').layout.xaxis.ticktext", TP)
    assert labels == GENES[0:8]


# ------------------------------------------------------------------ 4. job 3

def _step_options(page, which):
    return page.evaluate("""([s, w]) => { const sel = document.querySelector(s + ' .cgene-section__genes[data-which="' + w + '"]');
        return [...sel.querySelectorAll('optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.textContent)]); }""",
                         [VALUES, which])


def test_job3_one_row_per_pathway(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "set"}]),
               S1: _sig(S1, "Pathway", GENES[0:6])}
    _open(page, served, configs, open_ids=(P, S1))
    st = _drawn(page)
    assert st["rows"] == 1
    # Color and Size open in a pop-over from the row's summary button (WP-8)
    page.click(f"{TP} .cgene-section__values-btn")
    page.wait_for_selector(VALUES)
    # each channel: the statistic and layer it follows, read only, then one gene step select under two headings (decision 40)
    for which, channel in (("color", "Mean · logged"), ("size", "% expressing (> 0) · logged")):
        assert page.locator(f"{VALUES} .cgene-section__channel[data-which='{which}']").inner_text() == channel
        groups = _step_options(page, which)
        assert [g[0] for g in groups] == ["Combine the gene rows", "Score each cell"]
        assert groups[1][1][0] == "z-score mean"
    assert _step_options(page, "size")[0][1] == ["Mean of the gene rows", "Genes detected per cell", "Mean of the gene rows, as z-scores"]
    assert page.locator(f"{VALUES} select").count() == 2, "no layer and no statistic select: those are the plot's"
    sec = page.locator(VALUES)
    assert sec.locator(".cgene-section__genes[data-which='color']").input_value() == "rows_mean"
    assert sec.locator(".cgene-section__genes[data-which='size']").input_value() == "rows_mean"
    assert sec.locator(".cgene-section__help[data-which='color']").inner_text() == \
        "Each gene's Mean · logged in the group, averaged over the 6 genes of Pathway. Same scale as the gene rows."
    # the mean of the gene rows: no score asked for
    assert [f["kind"] for f in _features(page.calls)] == ["gene"] * 6
    # Size from a score, with its threshold box: one score feature on Size's layer, the threshold in the request
    n = len(page.calls)
    sec.locator(".cgene-section__genes[data-which='size']").select_option("zscore_mean")
    above = sec.locator(".cgene-section__above[data-which='size']")
    above.wait_for(state="visible")
    assert above.input_value() == "0"
    until(page, "(s) => document.querySelector(s + ' .cgene-panel').dataset.state === 'ready'", TP, timeout=90)
    new = _features(page.calls[n:])
    assert [f["kind"] for f in new] == ["score"]
    assert new[0]["column"] == "zscore_mean" and new[0]["layer"] == "logged" and new[0]["above"] == 0
    assert sec.locator(".cgene-section__help[data-which='size']").inner_text() == \
        "Each cell's z-score mean score of Pathway on logged, then the group's % of cells above 0. Its settings: Pathway ▸ Methods ▾."
    above.fill("0.5")
    above.press("Enter")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().sections[0].size || {}).above === 0.5", P)
    cfg = _config(page)
    assert cfg["sections"][0]["size"] == {"genes": "zscore_mean", "above": 0.5}
    # nothing is offered: no select of the pop-over leads elsewhere (decision 31)
    texts = page.eval_on_selector_all(f"{VALUES} option", "os => os.map(o => o.textContent)")
    assert not any("offer" in t.lower() for t in texts), texts
    assert _config(page)["sections"][0].get("color") is None


# ------------------------------------------------------------------ 5. requested once

def test_a_sections_genes_are_requested_once_and_one_gene_adds_one_feature(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                        sections=[{"source": S1, "rows": "genes"}, {"source": S1, "rows": "set"}]),
               S1: _sig(S1, "Markers", GENES[0:4])}
    _open(page, served, configs, open_ids=(P, S1))
    _drawn(page)
    feats = _features(page.calls)
    assert sorted(f["name"] for f in feats) == GENES[0:4], "each gene once, though two sections read it"
    assert len(page.calls) == 1
    # a duplicate section asks for nothing
    page.click(f"{TP} .cgene-section >> nth=0 >> .cgene-section__menu-btn")
    page.click("[data-popover='section-menu'] .cgene-section__menu-item[data-op='duplicate']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 3", P)
    _settle(page, "a duplicate section reads genes that are held; no request should follow")
    assert len(page.calls) == 1
    # one gene more in the signature: one request, for that gene alone
    page.evaluate("(id) => window.PanelManager.getPanel(id).addGenes(['GENE020'])", S1)
    until(page, "(s) => document.querySelector(s + ' .cgene-panel').dataset.state === 'ready'"
                " && window.PanelManager.getPanel('cell-gene-P')._debugState().rows === 11", TP, timeout=60)
    assert len(page.calls) == 2
    assert [f["name"] for f in page.calls[1]["features"]] == ["GENE020"]


# ------------------------------------------------------------------ 6. the section list

def test_the_section_list_edits_are_undoable_steps(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}),
               S1: _sig(S1, "B cell markers", GENES[0:3]), S2: _sig(S2, "T cell markers", GENES[3:5])}
    _open(page, served, configs, open_ids=(P, S1, S2))
    # Add genes lists signatures under their heading, then New signature…
    page.click(f"{TP} .cgene-add")
    items = page.locator(f"{TP} .cgene-add-menu [role='menuitem']")
    assert [items.nth(i).inner_text() for i in range(items.count())] == ["B cell markers", "T cell markers", "New signature…"]
    assert page.locator(f"{TP} .cgene-add-menu [role='group']").first.get_attribute("aria-label") == "Gene signatures"
    items.nth(0).click()
    page.click(f"{TP} .cgene-add")
    page.locator(f"{TP} .cgene-add-menu [role='menuitem']").nth(1).click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)
    sec = page.locator(f"{TP} .cgene-section")
    assert sec.nth(0).locator(".cgene-section__title").input_value() == "B cell markers"
    # Genes / One row is a radiogroup
    assert sec.nth(0).locator("[role='radiogroup']").count() == 1
    sec.nth(1).locator("input[value='set']").check()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[1].rows === 'set'", P)
    # the title, edited in place
    title = sec.nth(0).locator(".cgene-section__title")
    title.fill("B cells")
    title.press("Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'B cells'", P)
    assert sec.nth(0).locator(".cgene-section__source").inner_text() == "B cell markers"
    # Move down from the ⋯ menu, announced; Alt+Up on the focused section moves it back
    sec.nth(0).locator(".cgene-section__menu-btn").click()
    labels = page.locator("[data-popover='section-menu'] .cgene-section__menu-item")
    assert [labels.nth(i).inner_text() for i in range(labels.count())] == ["Duplicate", "Remove", "Open source", "Move up", "Move down"]
    page.locator("[data-popover='section-menu'] .cgene-section__menu-item[data-op='down']").click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[1].title === 'B cells'", P)
    assert "moved to position 2 of 2" in page.locator(f"{TP} .cgene-message").inner_text()
    # the menu closes after its item ran and gives focus back to ⋯ (ui/popover.js): only then focus the section
    page.wait_for_selector("[data-popover='section-menu']", state="detached", timeout=5000)
    page.locator(f"{TP} .cgene-section").nth(1).focus()
    page.keyboard.press("Alt+ArrowUp")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].title === 'B cells'", P)
    # Remove, then Undo brings it back; every edit was one step
    page.locator(f"{TP} .cgene-section").nth(1).locator(".cgene-section__menu-btn").click()
    page.locator("[data-popover='section-menu'] .cgene-section__menu-item[data-op='remove']").click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 1", P)
    assert _state(page)["undo"] == 7, "two adds, one row, a title, two moves, a removal"
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)


# ------------------------------------------------------------------ 7. groups

def test_groups_from_a_grouping_and_new_grouping(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "condition"}}]}
    configs = {P: _plot(sections=[{"source": S1, "rows": "genes"}]), S1: _sig(S1, "Markers", GENES[0:3]), GA: grouping}
    _open(page, served, configs, open_ids=(P, S1, GA))
    types = page.evaluate("(s) => [...document.querySelector(s + ' .cgene-axis-type').options].map(o => o.value)", TP)
    assert types == ["obs", "cell-group"]
    page.select_option(f"{TP} .cgene-axis-type", "cell-group")
    keys = page.evaluate("(s) => [...document.querySelector(s + ' .cgene-axis-key').options].map(o => o.textContent)", TP)
    assert keys[-1] == "New grouping…"
    assert "Grouping 1" in keys
    page.select_option(f"{TP} .cgene-axis-key", GA)
    st = _drawn(page)
    assert st["groups"] == 2
    assert _config(page)["cellAxis"] == {"type": "cell-group", "key": GA}
    # New grouping… opens a grouping beside the plot and makes it the cell axis
    page.select_option(f"{TP} .cgene-axis-key", "__new_grouping__")
    until(page, """(id) => { const c = window.PanelManager.getPanel(id).getConfig().cellAxis;
        return c && c.key !== 'cell-grouping-A' && c.key.startsWith('cell-grouping'); }""", P)
    new_id = _config(page)["cellAxis"]["key"]
    assert page.locator(f'.tile[data-tile-id="{new_id}"]').count() == 1


# ------------------------------------------------------------------ 8. links and panel sets

def test_a_link_carries_the_configuration_unchanged(page, served):
    cfg = _plot(cellAxis={"type": "cell-group", "key": GA},
                sections=[{"source": S1, "rows": "genes", "title": "Mine"},
                          {"source": S1, "rows": "set", "size": {"genes": "mean"}}],
                scale="z_groups", swap=True, colorScale="Viridis")
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    _open(page, served, {P: cfg, S1: _sig(S1, "Markers", GENES[0:3]), GA: grouping}, open_ids=(P, S1, GA))
    got = _config(page)
    for key, value in cfg.items():
        if key == "id":
            continue
        assert got[key] == value, key


def _save_set(page, name):
    page.click("#btn-save-session")
    page.fill("#session-name", name)
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")


def test_a_panel_set_beside_open_panels_remaps_the_axis_and_the_sections(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    cfg = _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}, {"source": S1, "rows": "set"}])
    _open(page, served, {P: cfg, S1: _sig(S1, "Markers", GENES[0:3]), GA: grouping}, open_ids=(P, S1, GA))
    _drawn(page)
    name = f"cell-gene-set-{int(time.time() * 1000)}"
    _save_set(page, name)
    # the same set added beside the open panels: new ids, and the added plot reads the added grouping and signature
    page.click("#btn-load-session")
    page.locator(f".session-card[data-session-name='{name}'] .session-add-closed").first.click()
    page.wait_for_function("() => PanelManager.getAllPanels().length === 6", timeout=30000)
    got = page.evaluate("""() => PanelManager.getAllPanels().map(p => [p.getType(), p.getId(),
        p.getType() === 'cell-gene' ? p.getConfig() : null])""")
    groupings = [g[1] for g in got if g[0] == "cell-grouping" and g[1] != GA]
    sigs = [g[1] for g in got if g[0] == "gene-signature" and g[1] != S1]
    added = [g[2] for g in got if g[0] == "cell-gene" and g[1] != P][0]
    assert len(groupings) == 1 and len(sigs) == 1
    assert added["cellAxis"] == {"type": "cell-group", "key": groupings[0]}
    assert [s["source"] for s in added["sections"]] == [sigs[0], sigs[0]]
    assert _config(page)["cellAxis"]["key"] == GA, "the open plot keeps its own"
