"""The Cell-Gene Plot's Cluster, Color and Plot Options pop-overs in a real browser (X5, WP-2; UX 3.1, 3.3, 3.4, 7;
CXG-18, CXG-20 to CXG-26).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition with
2, 40 genes, GENE003 expressed by no cell (a constant row, which correlation cannot cluster).

1.  Cluster ▾: Cluster genes Off / Within sections, Cluster groups Off / All, and Within <first factor> only for a
    grouping of two factors or more; the line naming the linkage and distance; clustering reorders the drawing and asks
    for nothing; a row left out is counted in the rows-left-out sentence and drawn last (UX 3.4, CXG-22 to CXG-24).
2.  Ward while correlation is set switches Distance to Euclidean and says so, with Undo (Q2).
3.  Color ▾ and Plot Options reach the drawing and ask for nothing: totals, section titles, the strips' legend, the
    color scale and center, the scaling help line with the pooled note.
4.  Download CSV, in Plot Options ▸ Export (UX 7, CXG-20; Show as table is gone, WP-2).
5.  A newly added section shows progress on its own rows while the others stay drawn (CXG-18).
6.  Screenshots in light and dark (written only when ANNZARRO_SHOTS names a directory).
7.  WP-2: the three are pop-overs. A click outside and Escape close them, focus goes back to the button, the plot box
    does not move, the clustering's fields are all in Cluster and min/max in Color, each dendrogram hides on its own.

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
from annzarro.tests.browser import waits  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
TWO = {"id": GA, "title": "Grouping 1", "version": 1, "layers": ["logged"],
       "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]}


def _trace_names(page):
    return page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data.map(t => t.name || '')", TP)


def _ticks(page, axis="xaxis"):
    return page.evaluate("([s, a]) => document.querySelector(s + ' .cgene-plot').layout[a].ticktext", [TP, axis])


def _option(name, pop="plot-options"):
    return f"[data-popover='{pop}'] [data-option='{name}']"


def _open_pop(page, name, button):
    """Open a pop-over by its button, unless it is open (one is open page-wide; it is not in the tile)."""
    if page.locator(f"[data-popover='{name}']").count() == 0:
        page.click(f"{TP} {button}")
    page.wait_for_selector(f"[data-popover='{name}']")


def _open_options(page):
    _open_pop(page, "plot-options", ".cgene-options-btn")


def _open_color(page):
    _open_pop(page, "color", ".cgene-color-btn")


def _open_cluster(page):
    _open_pop(page, "cluster", ".cgene-cluster-btn")


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
    menu = page.locator("[data-popover='cluster'] .cgene-cluster-menu")
    gene_values = menu.locator("[data-scope='genes'] input[type=radio]")
    assert [gene_values.nth(i).get_attribute("value") for i in range(gene_values.count())] == ["off", "sections"]
    group_values = menu.locator("[data-scope='groups'] input[type=radio]")
    assert [group_values.nth(i).get_attribute("value") for i in range(group_values.count())] == ["off", "all"], \
        "a grouping of one factor has no Within"
    assert "Off" in menu.inner_text() and "Within sections" in menu.inner_text()
    assert menu.locator(".cgene-cluster-summary").inner_text() == \
        "Complete linkage, Pearson correlation, on the values as displayed."
    n = len(page.calls)
    menu.locator("[data-scope='genes'] input[value='sections']").check()
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().cluster || {}).genes === 'sections'", P)
    # the sentence is a tag of the plot's status strip (it no longer wraps in the control grid and grows the tile)
    note = f"{TP} .ps-tag[data-tag='cgene-cluster']"
    page.wait_for_selector(note, timeout=30000)
    assert page.locator(note).inner_text() == "Partly clustered"
    assert page.locator(note).get_attribute("title") == "1 row not clustered: too few values in common, or constant. They are at the end."
    _redrawn(page, "(p) => p.layout.xaxis.ticktext[p.layout.xaxis.ticktext.length - 1] === 'GENE003'")
    assert sorted(_ticks(page)) == sorted(genes)
    _settle(page, "clustering reorders what is held; there is no request to wait for")
    assert len(page.calls) == n
    # off again: the source order, and the sentence goes
    menu.locator("[data-scope='genes'] input[value='off']").check()
    _redrawn(page, "(p, a) => JSON.stringify(p.layout.xaxis.ticktext) === JSON.stringify(a)", genes)
    page.wait_for_selector(note, state="detached", timeout=30000)


def test_within_the_first_factor_is_offered_for_a_grouping_of_two_factors(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: TWO}, open_ids=(P, S1))
    _drawn(page)
    _open_cluster(page)
    radios = page.locator("[data-popover='cluster'] [data-scope='groups'] label")
    assert [radios.nth(i).inner_text().strip() for i in range(radios.count())] == ["Off", "All", "Within cell_type"]
    page.check("[data-popover='cluster'] [data-scope='groups'] input[value='first']")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().cluster || {}).groups === 'first'", P)
    # a dendrogram per block of the first factor, drawn beside the groups
    _redrawn(page, "(p) => p.data.some(t => t.name === 'dendrogram groups')")


# ------------------------------------------------------------------ 1b. the live panel draws X4b's annotations

def test_the_live_panel_draws_brackets_strips_dendrograms_and_marks_small_groups(page, served):
    """Regression guard: X4b's annotations were drawn in Node only, never by the panel (found in X5)."""
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                                  cluster={"genes": "off", "groups": "all", "linkage": "complete", "distance": "correlation"},
                                  sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "genes"}]),
                         S1: _sig(S1, "B markers", GENES[:4]), S2: _sig(S2, "T markers", GENES[6:10])}, open_ids=(P,))
    _drawn(page)
    _redrawn(page, "(p) => p.data.some(t => t.name === 'dendrogram groups')")
    names = _trace_names(page)
    for want in ("section brackets", "group strip", "strip legend", "dendrogram groups"):
        assert want in names, (want, names)
    titles = page.evaluate("(s) => (document.querySelector(s + ' .cgene-plot').layout.annotations || [])"
                           ".filter(a => a.name === 'section title').map(a => a.text)", TP)
    assert titles == ["B markers", "T markers"]
    # cell_type's level of 5 cells is under the small-group threshold (10): its label says "small"
    groups = _ticks(page, "yaxis")
    assert sum(1 for t in groups if "<i>small</i>" in t) == 1, groups


# ------------------------------------------------------------------ 1c. words, never ids; a fresh panel's defaults

def _no_lapsed(page):
    texts = page.evaluate("(s) => [...document.querySelectorAll(s + ' select option')].map(o => o.textContent)", TP)
    assert not any("no longer offered" in t for t in texts), [t for t in texts if "no longer" in t]
    assert "no longer offered" not in page.locator(f"{TP} .cgene-panel").inner_text()


@pytest.mark.parametrize("axis", ["obs", "grouping"])
def test_a_fresh_panel_names_its_groups_source_in_words_and_offers_its_own_defaults(page, served, axis):
    """A new plot's Color and Size are its own defaults, so nothing reads "(no longer offered)"; the Groups type select
    shows words, never a provider's type id."""
    cell_axis = {"type": "obs", "key": "cell_type"} if axis == "obs" else {"type": "cell-group", "key": GA}
    plot = {"id": P, "title": "Cell-Gene Plot 1", "cellAxis": cell_axis, "sections": [{"source": S1, "rows": "genes"}]}
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    _open(page, served, {P: plot, S1: _sig(S1, "Markers", GENES[:4]), GA: grouping}, open_ids=(P, S1, GA))
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return !!e && !['empty', 'nodata'].includes(e.dataset.state); }", TP)
    shown = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgene-axis-type option')].map(o => [o.value, o.textContent])", TP)
    assert shown == [["obs", "obs"], ["cell-group", "Cell Grouping"]], shown
    config = _config(page)
    assert config["color"] == {"stat": "mean", "layer": "X"} and config["size"] == {"stat": "pct_expressing", "layer": "X"}
    _no_lapsed(page)


# ------------------------------------------------------------------ 2. Ward (Q2)

def test_ward_switches_distance_to_euclidean_says_so_and_undo_restores_it(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    _open_cluster(page)
    linkage = page.locator(_option("linkage", "cluster"))
    labels = linkage.locator("option")
    assert [labels.nth(i).inner_text() for i in range(labels.count())] == ["complete", "average", "Ward (Euclidean distance only)"]
    linkage.select_option("ward")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().cluster || {}; return c.linkage === 'ward' && c.distance === 'euclidean'; }", P)
    note = page.locator("[data-popover='cluster'] .cgene-ward-note")
    assert note.locator(".cgene-ward-note__text").inner_text() == "Ward needs Euclidean distance, so Distance is now Euclidean."
    assert page.locator(_option("distance", "cluster")).input_value() == "euclidean"
    # correlation cannot be chosen while Ward is the linkage, and says why
    corr = page.locator(f"{_option('distance', 'cluster')} option[value='correlation']")
    assert corr.evaluate("(o) => o.disabled") is True
    assert "Ward" in (corr.get_attribute("title") or "")
    assert page.locator("[data-popover='cluster'] .cgene-cluster-summary").inner_text().startswith("Ward linkage, Euclidean, on the values as displayed.")
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
    # two factors: a strip and a legend each (Color strips: Factors, the default)
    assert "section brackets" in names and names.count("group strip") == 2 and names.count("strip legend") == 2, names
    n = len(page.calls)
    _open_color(page)
    help_text = page.locator("[data-popover='color'] .cgene-scaling-note").inner_text()
    assert "Groups with no value are skipped; a constant gene gives 0." in help_text
    assert "across its own groups" in help_text, "under z_pooled a one-row section is z-scored across its own groups"
    _open_options(page)
    page.check(_option("totals"))
    _redrawn(page, "(p) => p.data.some(t => t.name === 'cells per group')")
    page.uncheck(_option("sectionTitles"))
    _redrawn(page, "(p) => !(p.layout.annotations || []).some(a => a.name === 'section title')")
    page.uncheck(_option("strips"))
    _redrawn(page, "(p) => !p.data.some(t => t.name === 'strip legend')")
    page.fill(_option("plotTitle"), "Markers by type")
    page.press(_option("plotTitle"), "Enter")
    _redrawn(page, "(p) => !!p.layout.title && p.layout.title.text === 'Markers by type'")
    _open_color(page)
    page.select_option(_option("colorScale", "color"), "RdBu")
    page.wait_for_selector(f"{_option('center', 'color')}:not([disabled])")
    page.fill(_option("center", "color"), "0")
    page.press(_option("center", "color"), "Enter")
    _redrawn(page, "(p) => { const m = p.data[0].marker; return m.colorscale === 'RdBu' && Math.abs(m.cmin + m.cmax) < 1e-9; }")
    config = _config(page)
    assert config["totals"] is True and config["sectionTitles"] is False and config["colorScale"] == "RdBu" and config["center"] == 0
    _settle(page, "every Plot Options change redraws what is held; no request should go out")
    assert len(page.calls) == n
    # each was one undoable step
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().center === undefined", P)
    # Size threshold (scanpy's expression_cutoff for the size), beside Size since WP-4: stored on Size, and the genes are
    # read with it; Plot Options no longer has one
    assert page.locator(_option("sizeThreshold")).count() == 0
    page.fill(f"{TP} .cgene-size-above", "0.5")
    page.press(f"{TP} .cgene-size-above", "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 0.5", P)
    _drawn(page)
    assert any(f.get("detect_above") == 0.5 for c in page.calls[n:] for f in (c.get("features") or [])), "the genes are asked with the threshold"


# ------------------------------------------------------------------ 4. Download CSV (Show as table is gone, WP-2)

def test_download_csv_is_in_plot_options_export(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, S1))
    _drawn(page)
    _open_options(page)
    with page.expect_download() as got:
        page.click("[data-popover='plot-options'] .cgene-export .cgene-csv-btn")
    text = open(got.value.path(), encoding="utf-8").read()
    rows = list(csv.reader(io.StringIO(text)))
    head = rows[0]
    assert len(rows) - 1 == 3 * 6, "one row per gene and group"
    assert head[:4] == ["Section", "Row", "Group", "Cells"]
    assert head[4] == "Mean · logged · not scaled"
    assert [r[1] for r in rows[1::6]] == GENES[:3], "the rows in the drawn order"


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
    # rows added to a drawing are a quiet recompute: no notice over the plot (decision 21)
    waits.expect_stays(lambda: page.locator(f"{TP} .cgene-plot > .score-notice:visible").count() == 0,
                       "a quiet recompute must never put a notice over the drawing; nothing appears to wait for", page=page, seconds=1.0)
    # the held request has reached the route (each evaluate lets Playwright run its handlers), then it goes through
    deadline = time.monotonic() + 30
    while not held:
        assert time.monotonic() < deadline, "the new section's request never reached the route"
        page.evaluate("1")
    assert len(held) == 1, "one request, for the new section's genes"
    held.pop().continue_()
    _redrawn(page, "(p) => !p.data.some(t => t.name === 'rows being read') && p.layout.xaxis.ticktext.length === 5")


# ------------------------------------------------------------------ 7. WP-2: Cluster, Color and Plot Options are pop-overs

def _pop(name):
    """A pop-over's surface: one body-level layer, one open page-wide (static/js/ui/popover.js)."""
    return f"[data-popover='{name}']"


BUTTONS = {"cluster": ".cgene-cluster-btn", "color": ".cgene-color-btn", "plot-options": ".cgene-options-btn"}


def _one_plot(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)


def _area_box(page):
    return page.evaluate("(s) => { const r = document.querySelector(s + ' .cgene-area').getBoundingClientRect();"
                         " return [r.width, r.height]; }", TP)


# A control each surface shows, wherever the surface is (the old inline blocks and the pop-overs alike)
SHOWS = {"cluster": "[data-scope='genes'] input[value='sections']", "color": "[data-option='max']",
         "plot-options": "[data-option='totals']"}


def _frames(page):
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")


@pytest.mark.parametrize("name", ["plot-options", "cluster"])
def test_a_click_outside_closes_plot_options_and_cluster(page, served, name):
    _one_plot(page, served)
    page.click(f"{TP} {BUTTONS[name]}")
    page.wait_for_selector(SHOWS[name])
    # a press in the plot area, outside the surface and its button
    box = page.locator(f"{TP} .cgene-area").bounding_box()
    page.mouse.click(box["x"] + box["width"] - 4, box["y"] + box["height"] - 4)
    page.wait_for_selector(SHOWS[name], state="hidden")
    assert page.locator(_pop(name)).count() == 0
    assert page.locator(f"{TP} {BUTTONS[name]}").get_attribute("aria-expanded") == "false"


@pytest.mark.parametrize("name", ["plot-options", "cluster", "color"])
def test_escape_closes_and_focus_returns_to_the_button(page, served, name):
    _one_plot(page, served)
    page.click(f"{TP} {BUTTONS[name]}")
    page.wait_for_selector(SHOWS[name])
    assert page.evaluate("(n) => !!document.activeElement.closest(`[data-popover='${n}']`)", name), "focus goes into the pop-over"
    # Escape closes from anywhere, not only with focus inside the surface (finding 2)
    page.evaluate("() => document.activeElement.blur()")
    page.keyboard.press("Escape")
    page.wait_for_selector(SHOWS[name], state="hidden")
    assert page.evaluate("([s, b]) => document.activeElement === document.querySelector(s + ' ' + b)", [TP, BUTTONS[name]])
    # and from inside it
    page.click(f"{TP} {BUTTONS[name]}")
    page.wait_for_selector(SHOWS[name])
    page.keyboard.press("Escape")
    page.wait_for_selector(SHOWS[name], state="hidden")
    assert page.evaluate("([s, b]) => document.activeElement === document.querySelector(s + ' ' + b)", [TP, BUTTONS[name]])


def test_the_plot_box_is_the_same_with_cluster_open_and_closed(page, served):
    _one_plot(page, served)
    closed = _area_box(page)
    page.click(f"{TP} .cgene-cluster-btn")
    page.wait_for_selector(SHOWS["cluster"])
    _frames(page)
    assert _area_box(page) == closed, "opening Cluster moves nothing in the panel"
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(SHOWS["plot-options"])
    _frames(page)
    assert _area_box(page) == closed, "nor does Plot Options"
    assert page.locator(_pop("plot-options")).count() == 1


def test_there_is_no_show_as_table(page, served):
    _one_plot(page, served)
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(_pop("plot-options"))
    assert page.locator(".cgene-table-btn").count() == 0
    assert page.locator(f"{TP} .cgene-table").count() == 0
    # Download CSV is in Plot Options' Export group
    assert page.locator(f"{_pop('plot-options')} .cgene-export .cgene-csv-btn").count() == 1


def test_the_clustering_fields_are_in_cluster_and_none_in_plot_options(page, served):
    _one_plot(page, served)
    page.click(f"{TP} .cgene-cluster-btn")
    page.wait_for_selector(_pop("cluster"))
    for name in ("linkage", "distance", "dendroGenes", "dendroGroups", "sortGroups"):
        assert page.locator(f"{_pop('cluster')} [data-option='{name}']").count() == 1, name
    assert page.locator(f"{_pop('cluster')} select[data-option='linkage']").is_visible()
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(_pop("plot-options"))
    for name in ("linkage", "distance", "dendroGenes", "dendroGroups", "dendrograms", "sortGroups"):
        assert page.locator(f"{_pop('plot-options')} [data-option='{name}']").count() == 0, name


def test_min_and_max_are_in_color(page, served):
    _one_plot(page, served)
    page.click(f"{TP} .cgene-color-btn")
    page.wait_for_selector(_pop("color"))
    for name in ("colorScale", "reverse", "min", "max", "center", "dotMin", "dotMax"):
        assert page.locator(f"{_pop('color')} [data-option='{name}']").count() == 1, name
    # the dots' sizes are Plot Options fields (WP-5a schema), not Color's
    for name in ("dotScale", "dotSmallest"):
        assert page.locator(f"{_pop('color')} [data-option='{name}']").count() == 0, name
    page.fill(f"{_pop('color')} [data-option='max']", "2")
    page.press(f"{_pop('color')} [data-option='max']", "Enter")
    until(page, "(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().limits) === '[null,2]'", P)
    _redrawn(page, "(p) => p.data[0].marker.cmax === 2")
    assert page.locator(_pop("color")).count() == 1, "an edit applies live and leaves the pop-over open"
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(_pop("plot-options"))
    for name in ("colorScale", "min", "max", "center", "printValues", "dotMin", "dotMax"):
        assert page.locator(f"{_pop('plot-options')} [data-option='{name}']").count() == 0, name
    for name in ("dotScale", "dotSmallest", "dotOpacity"):
        assert page.locator(f"{_pop('plot-options')} [data-option='{name}']").count() == 1, name


def _set_range(page, selector, value):
    """Move a slider as a drag ends: its value, then input and change."""
    page.eval_on_selector(selector, "(e, v) => { e.value = String(v); e.dispatchEvent(new Event('input', {bubbles: true}));"
                          " e.dispatchEvent(new Event('change', {bubbles: true})); }", value)


_LARGEST = "(p) => p.data[0].marker.size.reduce((m, v) => (v > m ? v : m), 0)"
# the matrix's cell on screen, px: the smaller of the gene axis's and the group axis's pitch as Plotly laid them out
_CELL = ("(p) => { const L = p._fullLayout; const pitch = (ax) => ax._length / Math.abs(ax.range[1] - ax.range[0]);"
         " return Math.min(pitch(L.xaxis), pitch(L.yaxis)); }")


def test_dots_fill_their_cells_and_largest_dot_takes_a_share_of_the_cell(page, served):
    _one_plot(page, served)
    _open_options(page)
    # Largest dot is empty (the dot fills its cell) and says so; Smallest dot is at its 3 px
    assert page.locator(_option("dotScale")).input_value() == ""
    assert page.locator(_option("dotScale")).get_attribute("placeholder") == "100"
    assert page.locator(_option("dotSmallestNumber")).input_value() == "3"
    # the largest dot fills its cell on screen, less 2 px (once the figure is built for the plot's settled size)
    _redrawn(page, f"(p) => Math.abs(({_LARGEST})(p) - (({_CELL})(p) - 2)) < 1.5")
    full = page.evaluate(f"(s) => ({_LARGEST})(document.querySelector(s + ' .cgene-plot'))", TP)
    assert full > 20, f"a full cell of four genes is larger than the old 20 px: {full}"
    assert page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data[0].marker.opacity", TP) == 1
    page.fill(_option("dotScale"), "50")
    page.press(_option("dotScale"), "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().dotScale === 50", P)
    _redrawn(page, f"(p) => Math.abs(({_LARGEST})(p) - (({_CELL})(p) - 2) / 2) < 1")
    assert page.locator(_option("dotScale")).input_value() == "50"
    _set_range(page, _option("dotSmallest"), 6)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().dotSmallest === 6", P)
    _redrawn(page, "(p) => p.data[0].marker.size.reduce((m, v) => (v < m ? v : m), Infinity) === 6")
    # each a step of the panel's undo
    page.click(f"{TP} .cgene-undo")
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return c.dotScale === undefined && c.dotSmallest === undefined; }", P)


def test_a_link_from_before_keeps_its_dot_px_until_largest_dot_is_moved(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], dotSizes=[5, 12]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    _redrawn(page, f"(p) => ({_LARGEST})(p) === 12 && p.data[0].marker.size.reduce((m, v) => (v < m ? v : m), Infinity) === 5")
    _open_options(page)
    # the fields show what is drawn: the smallest dot's 5 px, and the largest dot's saved 12 px
    assert page.locator(_option("dotSmallestNumber")).input_value() == "5"
    assert page.locator(_option("dotScale")).input_value() == ""
    assert page.locator(_option("dotScale")).get_attribute("placeholder") == "12 px (saved)", "Largest dot says the px it draws"
    # a share typed in Largest dot converts the link: a share of the cell, its smallest dot kept
    page.fill(_option("dotScale"), "80")
    page.press(_option("dotScale"), "Enter")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return c.dotSizes === undefined && c.dotScale === 80 && c.dotSmallest === 5; }", P)
    _redrawn(page, f"(p) => Math.abs(({_LARGEST})(p) - 0.8 * (({_CELL})(p) - 2)) < 1")


def test_dot_opacity_in_plot_options_redraws_and_undo_restores_it(page, served):
    _one_plot(page, served)
    _redrawn(page, "(p) => p.data[0].marker.opacity === 1")
    _open_options(page)
    assert page.locator(_option("dotOpacityNumber")).input_value() == "1"
    _set_range(page, _option("dotOpacity"), 0.5)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().dotOpacity === 0.5", P)
    _redrawn(page, "(p) => p.data[0].marker.opacity === 0.5 && p.data.find(t => t.name === 'size legend').marker.opacity < 0.5")
    assert page.locator(_option("dotOpacityNumber")).input_value() == "0.5"
    # the number box sets it too
    page.fill(_option("dotOpacityNumber"), "0.3")
    page.press(_option("dotOpacityNumber"), "Enter")
    _redrawn(page, "(p) => p.data[0].marker.opacity === 0.3")
    assert page.locator(_option("dotOpacity")).input_value() == "0.3"
    page.click(f"{TP} .cgene-undo")
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => !('dotOpacity' in window.PanelManager.getPanel(id).getConfig())", P)
    _redrawn(page, "(p) => p.data[0].marker.opacity === 1")
    _open_options(page)
    assert page.locator(_option("dotOpacityNumber")).input_value() == "1"


def test_hiding_one_dendrogram_keeps_the_other(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                                  cluster={"genes": "sections", "groups": "all", "linkage": "complete", "distance": "correlation"},
                                  sections=[{"source": S1, "rows": "genes"}]), S1: _sig(S1, "Markers", GENES[:6])}, open_ids=(P, S1))
    _drawn(page)
    _redrawn(page, "(p) => p.data.some(t => t.name === 'dendrogram genes') && p.data.some(t => t.name === 'dendrogram groups')")
    page.click(f"{TP} .cgene-cluster-btn")
    page.uncheck(f"{_pop('cluster')} [data-option='dendroGenes']")
    _redrawn(page, "(p) => !p.data.some(t => t.name === 'dendrogram genes') && p.data.some(t => t.name === 'dendrogram groups')")
    assert _config(page)["cluster"]["dendrograms"] == {"genes": False, "groups": True}
    page.click(f"{TP} .cgene-undo")
    _redrawn(page, "(p) => p.data.some(t => t.name === 'dendrogram genes')")


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
    page.screenshot(path=os.path.join(SHOTS, f"x5-options-{theme}.png"))
    page.click(f"{TP} .cgene-options-btn")
    _open_cluster(page)
    page.screenshot(path=os.path.join(SHOTS, f"x5-cluster-{theme}.png"))
    _open_color(page)
    page.screenshot(path=os.path.join(SHOTS, f"wp2-color-{theme}.png"))
