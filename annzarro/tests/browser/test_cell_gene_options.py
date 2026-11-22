"""The Cell-Gene Plot's Cluster menu and Plot Options in a real browser (X5; UX 3.1, 3.3, 3.4, 7; CXG-18, CXG-20 to
CXG-26).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition with
2, 40 genes, GENE003 expressed by no cell (a constant row, which correlation cannot cluster).

1.  Cluster ▾: Cluster genes Off / Within sections, Cluster groups Off / All, and Within <first factor> only for a
    grouping of two factors or more; the line naming the linkage and distance; clustering reorders the drawing and asks
    for nothing; a row left out is counted in the rows-left-out sentence and drawn last (UX 3.4, CXG-22 to CXG-24).
2.  Ward while correlation is set switches Distance to Euclidean and says so, with Undo (Q2).
3.  Plot Options reach the drawing and ask for nothing: totals, section titles, dendrograms, the strips' legend, the
    scaling help line with the pooled note.
4.  Show as table is the CSV: the same header and rows as Download CSV (UX 7, CXG-20).
5.  A newly added section shows progress on its own rows while the others stay drawn (CXG-18).
6.  Screenshots in light and dark (written only when ANNZARRO_SHOTS names a directory).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import csv
import io
import os
import time

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _state, _drawn, _settle, _config, P, TP, S1, S2, GA, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
TWO = {"id": GA, "title": "Grouping 1", "version": 1,
       "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]}


def _trace_names(page):
    return page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data.map(t => t.name || '')", TP)


def _ticks(page, axis="xaxis"):
    return page.evaluate("([s, a]) => document.querySelector(s + ' .cgene-plot').layout[a].ticktext", [TP, axis])


def _option(name):
    return f"{TP} .cgene-options [data-option='{name}']"


def _open_options(page):
    if page.locator(f"{TP} .cgene-options").is_hidden():
        page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(f"{TP} .cgene-options:not([hidden])")


def _open_cluster(page):
    if page.locator(f"{TP} .cgene-cluster-menu").is_hidden():
        page.click(f"{TP} .cgene-cluster-btn")
    page.wait_for_selector(f"{TP} .cgene-cluster-menu:not([hidden])")


def _redrawn(page, check, arg=None):
    """Wait until the drawn figure passes `check` (a JS function of the plot element and `arg`)."""
    until(page, "([s, f, a]) => { const p = document.querySelector(s + ' .cgene-plot'); return !!p && !!p.data && (new Function('p', 'a', 'return (' + f + ')(p, a)'))(p, a); }",
          [TP, check, arg], timeout=30)


# ------------------------------------------------------------------ 1. Cluster ▾

def test_the_cluster_menu_offers_its_scopes_states_the_method_and_counts_rows_left_out(page, served):
    genes = GENES[:6]          # GENE003 is expressed by no cell: constant, so correlation leaves it out
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", genes)}, open_ids=(P, S1))
    _drawn(page)
    _open_cluster(page)
    menu = page.locator(f"{TP} .cgene-cluster-menu")
    gene_values = menu.locator("[data-scope='genes'] input[type=radio]")
    assert [gene_values.nth(i).get_attribute("value") for i in range(gene_values.count())] == ["off", "sections"]
    group_values = menu.locator("[data-scope='groups'] input[type=radio]")
    assert [group_values.nth(i).get_attribute("value") for i in range(group_values.count())] == ["off", "all"], \
        "a grouping of one factor has no Within"
    assert "Off" in menu.inner_text() and "Within sections" in menu.inner_text()
    assert menu.locator(".cgene-cluster-summary").inner_text() == \
        "Complete linkage, Pearson correlation, on the values as displayed. Change them in Plot Options."
    n = len(page.calls)
    menu.locator("[data-scope='genes'] input[value='sections']").check()
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().cluster || {}).genes === 'sections'", P)
    note = page.locator(f"{TP} .cgene-cluster-note")
    until(page, "(s) => { const n = document.querySelector(s + ' .cgene-cluster-note'); return !!n && n.textContent.length > 0; }", TP)
    assert note.inner_text() == "1 row not clustered: too few values in common, or constant. They are at the end."
    _redrawn(page, "(p) => p.layout.xaxis.ticktext[p.layout.xaxis.ticktext.length - 1] === 'GENE003'")
    assert sorted(_ticks(page)) == sorted(genes)
    _settle(page, "clustering reorders what is held; there is no request to wait for")
    assert len(page.calls) == n
    # off again: the source order, and the sentence goes
    menu.locator("[data-scope='genes'] input[value='off']").check()
    _redrawn(page, "(p, a) => JSON.stringify(p.layout.xaxis.ticktext) === JSON.stringify(a)", genes)
    assert note.inner_text() == ""


def test_within_the_first_factor_is_offered_for_a_grouping_of_two_factors(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: TWO}, open_ids=(P, S1))
    _drawn(page)
    _open_cluster(page)
    radios = page.locator(f"{TP} .cgene-cluster-menu [data-scope='groups'] label")
    assert [radios.nth(i).inner_text().strip() for i in range(radios.count())] == ["Off", "All", "Within cell_type"]
    page.check(f"{TP} .cgene-cluster-menu [data-scope='groups'] input[value='first']")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().cluster || {}).groups === 'first'", P)
    # a dendrogram per block of the first factor, drawn beside the groups
    _redrawn(page, "(p) => p.data.some(t => t.name === 'dendrogram groups')")


# ------------------------------------------------------------------ 2. Ward (Q2)

def test_ward_switches_distance_to_euclidean_says_so_and_undo_restores_it(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    _open_options(page)
    linkage = page.locator(_option("linkage"))
    labels = linkage.locator("option")
    assert [labels.nth(i).inner_text() for i in range(labels.count())] == ["complete", "average", "Ward (Euclidean distance only)"]
    linkage.select_option("ward")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().cluster || {}; return c.linkage === 'ward' && c.distance === 'euclidean'; }", P)
    note = page.locator(f"{TP} .cgene-ward-note")
    assert note.locator(".cgene-ward-note__text").inner_text() == "Ward needs Euclidean distance, so Distance is now Euclidean."
    assert page.locator(_option("distance")).input_value() == "euclidean"
    # correlation cannot be chosen while Ward is the linkage, and says why
    corr = page.locator(f"{_option('distance')} option[value='correlation']")
    assert corr.evaluate("(o) => o.disabled") is True
    assert "Ward" in (corr.get_attribute("title") or "")
    _open_cluster(page)
    assert page.locator(f"{TP} .cgene-cluster-summary").inner_text().startswith("Ward linkage, Euclidean, on the values as displayed.")
    _open_options(page)
    note.locator(".cgene-ward-undo").click()
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().cluster || {}; return (c.linkage || 'complete') === 'complete' && (c.distance || 'correlation') === 'correlation'; }", P)
    assert note.is_hidden()


# ------------------------------------------------------------------ 3. Plot Options reach the drawing

def test_plot_options_reach_the_drawing_and_ask_for_nothing(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, scale="z_pooled",
                                  sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "set"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), S2: _sig(S2, "Pathway", GENES[4:8]), GA: TWO}, open_ids=(P, S1, S2))
    _drawn(page)
    names = _trace_names(page)
    assert "section brackets" in names and names.count("group strip") == 2 and names.count("strip legend") == 2, names
    n = len(page.calls)
    _open_options(page)
    help_text = page.locator(f"{TP} .cgene-options .cgene-scaling-note").inner_text()
    assert "Groups with no value are skipped; a constant gene gives 0." in help_text
    assert "across its own groups" in help_text, "under z_pooled a one-row section is z-scored across its own groups"
    page.check(_option("totals"))
    _redrawn(page, "(p) => p.data.some(t => t.name === 'cells per group')")
    page.uncheck(_option("sectionTitles"))
    _redrawn(page, "(p) => !(p.layout.annotations || []).some(a => a.name === 'section title')")
    page.uncheck(_option("strips"))
    _redrawn(page, "(p) => !p.data.some(t => t.name === 'strip legend')")
    page.fill(_option("plotTitle"), "Markers by type")
    page.press(_option("plotTitle"), "Enter")
    _redrawn(page, "(p) => !!p.layout.title && p.layout.title.text === 'Markers by type'")
    page.select_option(_option("colorScale"), "RdBu")
    page.wait_for_selector(f"{_option('center')}:not([disabled])")
    page.fill(_option("center"), "0")
    page.press(_option("center"), "Enter")
    _redrawn(page, "(p) => { const m = p.data[0].marker; return m.colorscale === 'RdBu' && Math.abs(m.cmin + m.cmax) < 1e-9; }")
    config = _config(page)
    assert config["totals"] is True and config["sectionTitles"] is False and config["colorScale"] == "RdBu" and config["center"] == 0
    _settle(page, "every Plot Options change redraws what is held; no request should go out")
    assert len(page.calls) == n
    # each was one undoable step
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().center === undefined", P)
    # Size threshold (scanpy's expression_cutoff for the size): stored on Size, and the genes are read with it
    page.fill(_option("sizeThreshold"), "0.5")
    page.press(_option("sizeThreshold"), "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 0.5", P)
    _drawn(page)
    assert any(f.get("detect_above") == 0.5 for c in page.calls[n:] for f in (c.get("features") or [])), "the genes are asked with the threshold"


# ------------------------------------------------------------------ 4. Show as table

def test_show_as_table_is_the_csv(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, S1))
    _drawn(page)
    _open_options(page)
    page.click(f"{TP} .cgene-table-btn")
    table = page.locator(f"{TP} .cgene-table table")
    table.wait_for()
    head = [h.strip() for h in table.locator("thead th").all_inner_texts()]
    body = table.locator("tbody tr")
    assert body.count() == 3 * 6, "one row per gene and group"
    with page.expect_download() as got:
        page.click(f"{TP} .cgene-csv-btn")
    text = open(got.value.path(), encoding="utf-8").read()
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == head
    assert len(rows) - 1 == body.count()
    first = [c.strip() for c in body.nth(0).locator("td").all_inner_texts()]
    assert first == rows[1]
    assert head[:4] == ["Section", "Row", "Group", "Cells"]
    assert head[4] == "Mean · logged · not scaled"
    page.click(f"{TP} .cgene-table-btn")
    page.wait_for_selector(f"{TP} .cgene-table", state="hidden")


# ------------------------------------------------------------------ 5. CXG-18

def test_a_new_section_shows_progress_on_its_own_rows_while_the_others_stay_drawn(page, served):
    held = []

    def hold(route, request):
        if request.method == "POST" and '"estimate_only"' not in (request.post_data or "") and len(page.calls) > 1:
            held.append(route)
            return
        route.continue_()
    page.route("**/api/v1/data/cell_groups**", hold)
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:3]), S2: _sig(S2, "More", GENES[10:12])}, open_ids=(P, S1, S2))
    _drawn(page)
    page.evaluate("([id, src]) => { const p = window.PanelManager.getPanel(id); const c = p.getConfig();"
                  " p.updateConfig({ ...c, sections: [...c.sections, { source: src, rows: 'genes' }] }); }", [P, S2])
    _redrawn(page, "(p) => p.data.some(t => t.name === 'rows being read')")
    pending = page.evaluate("(s) => { const p = document.querySelector(s + ' .cgene-plot'); const t = p.data.find(x => x.name === 'rows being read');"
                            " return { n: t.x.length, text: t.text[0] }; }", TP)
    assert pending["n"] == 2 * 6, "every cell of the two new rows"
    assert "Reading 2 genes" in pending["text"]
    # the first section stays drawn with its values meanwhile
    assert page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data[0].x.length", TP) > 0
    assert page.locator(f"{TP} .cgene-panel").get_attribute("data-state") == "updating"
    # the held request has reached the route (each evaluate lets Playwright run its handlers), then it goes through
    deadline = time.monotonic() + 30
    while not held:
        assert time.monotonic() < deadline, "the new section's request never reached the route"
        page.evaluate("1")
    assert len(held) == 1, "one request, for the new section's genes"
    held.pop().continue_()
    _redrawn(page, "(p) => !p.data.some(t => t.name === 'rows being read') && p.layout.xaxis.ticktext.length === 5")


# ------------------------------------------------------------------ 6. screenshots

@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
@pytest.mark.parametrize("dark", [False, True])
def test_screenshots_of_the_options_and_the_strip_legend(page, served, dark):
    if dark:
        page.emulate_media(color_scheme="dark")
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, totals=True,
                                  cluster={"genes": "sections", "groups": "all", "linkage": "complete", "distance": "correlation"},
                                  sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "set"}]),
                         S1: _sig(S1, "Markers", GENES[:8]), S2: _sig(S2, "Pathway", GENES[8:14]), GA: TWO}, open_ids=(P, S1, S2))
    _drawn(page)
    _redrawn(page, "(p) => p.data.some(t => t.name === 'strip legend')")
    os.makedirs(SHOTS, exist_ok=True)
    theme = "dark" if dark else "light"
    page.locator(TP).screenshot(path=os.path.join(SHOTS, f"x5-plot-{theme}.png"))
    _open_options(page)
    page.locator(TP).screenshot(path=os.path.join(SHOTS, f"x5-options-{theme}.png"))
    page.click(f"{TP} .cgene-options-btn")
    _open_cluster(page)
    page.locator(TP).screenshot(path=os.path.join(SHOTS, f"x5-cluster-{theme}.png"))
