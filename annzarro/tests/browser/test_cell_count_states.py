"""The Cell Count Plot's limits, states and Save as grouping in a real browser, against the real cell_groups route (C2b).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells; cell_type (6 levels), condition (2),
sample (30), many (2,001 categories, 1,200 of them used), pseudotime (20 cells without a value), depth and score.

1.  Each refusal of UX 4.3 is decided before any request, says the count and the limit, and its way out works:
    Choose levels (the chooser lists the levels with one light request, never the grid), Remove Color by, Bin it, and
    Show as Bar for an input the mode cannot use (SHR-37, SHR-39, CNT-14).
2.  The route's states go through the page's painter as every source's do ('count-grid'): Counting 1,200 cells… with
    Cancel, the progress bar of decision 21 once the wait is long, a failure with Retry routed to this plot (SHR-35).
3.  The strip of CNT-22: cells counted, without a value, outside the range.
4.  Save as grouping (CNT-7): the dialog's lines, a Cell Grouping panel made from the plot's inputs with the same
    groups, Save refused over the grouping limits; opened from Plot Options and from a click on a bar.
5.  Show as table (UX 7): the CSV's rows as an HTML table.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# the panel test's server on the grouping fixture, and its page that records every cell_groups request
served = cc.served
page = cc.page

CC, S, DATA, N = cc.CC, cc.S, cc.DATA, cc.N
_count, _open, _drawn, _config, _plot, _requests = cc._count, cc._open, cc._drawn, cc._config, cc._plot, cc._requests


def obs(key, **extra):
    return {"source": {"type": "obs", "key": key}, **extra}


def _grid_requests(page):
    return [c for c in _requests(page) if c.get("shape") == "grid"]


def _state(page):
    """What the plot area says for a plan that asks nothing, and its buttons, or None when it is hidden."""
    return page.evaluate("""(s) => { const b = document.querySelector(s + ' .ccnt-state');
        return b.hidden ? null : { text: b.querySelector('.ccnt-state__text').textContent, state: b.dataset.state,
            actions: [...document.querySelectorAll(s + ' .ccnt-state-box .ccnt-state__actions button')].map(x => x.textContent) }; }""", S)


def _refused(page, text, actions):
    until(page, "([s, t]) => { const b = document.querySelector(s + ' .ccnt-state');"
                " return b && !b.hidden && b.querySelector('.ccnt-state__text').textContent === t; }", [S, text])
    assert _state(page) == {"text": text, "state": "refused", "actions": actions}
    waits.expect_stays(lambda: not _grid_requests(page),
                       "a refusal is decided from the plan: no grid request may follow, and none has a signal to wait for", page=page)


def _undo_label(page):
    return page.get_attribute(f"{S} .ccnt-undo", "aria-label")


# ------------------------------------------------------------------ 1. refusals before any request, and their way out

def test_too_many_levels_on_x_is_refused_before_any_request_and_choose_levels_lists_them(page, served):
    _open(page, served, {CC: _count(mode="bar", x=obs("many"))})
    _refused(page, "many has 2,001 levels; Bar shows up to 200.", ["Choose levels"])

    page.click(f"{S} .ccnt-state-box button:has-text('Choose levels')")
    # the chooser opens on X and lists the levels: one light request for that input alone, never the grid
    until(page, "() => document.querySelectorAll('[data-popover=levels] .ccnt-level').length > 0", timeout=60)
    assert page.is_visible("[data-popover='levels'] .ccnt-levels")
    asked = _requests(page)
    # at 2,001 categories: exactly one request, of levels only (no codes, no grid), for that input alone
    assert len(asked) == 1 and not _grid_requests(page), asked
    assert [p["source"]["key"] for p in asked[0]["partitionings"]] == ["many"]
    assert not (asked[0].get("want") or {}).get("codes"), asked[0]
    assert page.evaluate("() => document.querySelectorAll('[data-popover=levels] .ccnt-level').length") == 2001, \
        "every category is listed, used or not"
    # closing and opening the chooser again asks nothing more: the levels are held for that input
    page.click(f"{S} [data-input='x'] .ccnt-choose")
    page.click(f"{S} [data-input='x'] .ccnt-choose")
    until(page, "() => document.querySelectorAll('[data-popover=levels] .ccnt-level').length === 2001")
    waits.expect_stays(lambda: len(_requests(page)) == 1, "a second look at the levels asks nothing; there is no event to wait for", page=page)
    used = DATA.obs["many"].value_counts()
    counts = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('[data-popover=levels] .ccnt-level')]
        .map(li => [li.dataset.id, li.querySelector('.ccnt-level__n').textContent]))""")
    assert counts["c:m0005"] == f"{int(used['m0005']):,}"

    # keep two levels: the rest is counted as one, and the plot is drawn from one grid request
    page.click(f"[data-popover='levels'] .ccnt-levels__actions button:has-text('Tick none')")
    until(page, f"() => Array.isArray(window.PanelManager.getPanel('{CC}').getConfig().x.levels)")
    for name in ("m0001", "m0002"):
        page.check(f"[data-popover='levels'] .ccnt-level[data-id='c:{name}'] input[type=checkbox]")
    _drawn(page, "bar", "c.x.levels && c.x.levels.length === 2")
    assert len(_grid_requests(page)) >= 1
    assert sum(sum(t["y"]) for t in _plot(page)["data"]) == N


def test_choose_levels_says_why_when_the_levels_are_refused_for_their_number(page, served):
    # the fixture has no column with more used categories than a grouping holds: the route's refusal is played here
    refused = {"type": "result", "version": 1, "shape": "grouping", "n_shown": N, "message": "Too many groups.", "blocks": [],
               "refused": {"reason": "too_many_groups", "count": 2345, "limit": 2000}}

    def handle(route):
        body = json.loads(route.request.post_data or "{}") if route.request.method == "POST" else {}
        if route.request.method != "POST" or body.get("shape") == "grid":
            route.continue_()
        elif body.get("estimate_only"):
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"estimate": {"seconds": 0.1, "tier": "live", "lane": "light"}}))
        else:
            route.fulfill(status=200, content_type="application/x-ndjson",
                          body=json.dumps({"type": "start", "lane": "light", "entries_total": 1}) + "\n" + json.dumps(refused) + "\n")

    page.route("**/data/cell_groups*", handle)
    _open(page, served, {CC: _count(mode="bar", x=obs("many"))})
    _refused(page, "many has 2,001 levels; Bar shows up to 200.", ["Choose levels"])
    page.click(f"{S} .ccnt-state-box button:has-text('Choose levels')")
    note = f"[data-popover='levels'] .ccnt-levels__note"
    page.wait_for_selector(note, timeout=30000)
    assert page.inner_text(f"{note} .ccnt-levels__said") == "many has 2,345 levels that hold a cell; Choose levels lists up to 2,000."
    assert page.query_selector(f"[data-popover='levels'] .ccnt-levels__wait") is None
    assert page.query_selector_all(f"{note} button") == [], "a categorical column has no way out here"
    assert len([c for c in _requests(page) if c.get("shape") != "grid"]) == 1


def test_color_by_over_the_limit_is_removed_by_its_way_out_in_one_undoable_step(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=obs("depth"), split=obs("many"))})
    _refused(page, "Color by many has 2,001 levels; a histogram colors up to 200.", ["Split by another column ▾", "Remove Color by"])
    page.click(f"{S} .ccnt-state-box button:has-text('Remove Color by')")
    _drawn(page, "histogram", "!c.split")
    assert _config(page)["x"] == obs("depth")
    assert _undo_label(page) == "Undo: no Color by"
    page.click(f"{S} .ccnt-undo")
    until(page, "(s) => { const b = document.querySelector(s + ' .ccnt-state'); return b && !b.hidden && b.dataset.state === 'refused'; }", S)
    assert _state(page)["actions"] == ["Split by another column ▾", "Remove Color by"]
    assert _config(page)["split"] == obs("many")


def test_a_2d_histograms_most_frequent_level_over_8_levels_and_a_heatmap_over_200(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth"), y=obs("score"), value={"kind": "top_level", "factor": obs("sample")})})
    _refused(page, "Color by sample has 30 levels; 2D histogram colors up to 8.", ["Remove Color by"])
    page.click(f"{S} .ccnt-state-box button:has-text('Remove Color by')")
    _drawn(page, "hist2d", "!c.value")

    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ version: 1, mode: 'heatmap',
        x: {{ source: {{ type: 'obs', key: 'many' }} }}, y: {{ source: {{ type: 'obs', key: 'cell_type' }} }} }})""")
    asked = len(_grid_requests(page))
    until(page, "(s) => { const b = document.querySelector(s + ' .ccnt-state'); return b && !b.hidden && b.dataset.state === 'refused'; }", S)
    assert _state(page)["text"] == "many × cell_type is 2,001 × 6; Heatmap shows up to 200 × 200."
    waits.expect_stays(lambda: len(_grid_requests(page)) == asked, "the heatmap's refusal asks nothing", page=page)


def test_a_typed_bin_count_is_checked_against_the_modes_limit_where_it_is_typed(page, served):
    _open(page, served, {CC: _count(mode="bar", x=obs("depth"))})
    _drawn(page, "bar")
    page.click(f"{S} [data-row='x'] .ccnt-bins")
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc")
    assert page.get_attribute(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "title") == "A whole number from 2 to 200."
    asked = len(_grid_requests(page))
    page.fill(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "300")
    page.press(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "Enter")
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc-message:has-text('Enter a whole number from 2 to 200.')")
    assert "binning" not in _config(page)["x"]
    waits.expect_stays(lambda: len(_grid_requests(page)) == asked and _state(page) is None,
                       "a refused entry changes nothing: no request and no refusal follow", page=page)


def test_too_many_bins_for_bar_opens_the_binning_control_and_a_histogram_of_a_category_shows_as_bar(page, served):
    _open(page, served, {CC: _count(mode="bar", x=obs("depth", binning={"method": "equal_width", "bins": 300}))})
    _refused(page, "depth has 300 bins; Bar shows up to 200.", ["Fewer bins", "Bin it"])
    page.click(f"{S} .ccnt-state-box button:has-text('Bin it')")
    # the most bins Bar shows, one undoable step, and the control open on it
    _drawn(page, "bar", "c.x.binning && c.x.binning.bins === 200")
    assert _undo_label(page) == "Undo: bin X"
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc")
    assert page.input_value(f"[data-popover='binning'] .ccnt-binning .pbc-bins") == "200"
    page.fill(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "40")
    page.press(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "Enter")
    _drawn(page, "bar", "c.x.binning && c.x.binning.bins === 40")

    # a Histogram given categories from outside (Back and Forward, a remap) is drawn as Bar and says so once
    # (the views follow the X axis type, 0.8.0): never the old unusable state
    page.select_option(f"{S} .ccnt-mode", "histogram")
    _drawn(page, "histogram")
    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ x: {{ source: {{ type: 'obs', key: 'cell_type' }} }} }})""")
    _drawn(page, "bar", "c.x.source.key === 'cell_type'")
    assert page.inner_text(f"{S} .ccnt-view-note") == "Histogram needs a numeric axis, so this plot is drawn as Bar."
    assert _state(page) is None


# ------------------------------------------------------------------ 2. the route's states through the painter

def test_the_route_states_are_the_painters_with_its_progress_bar_cancel_and_retry(page, served):
    held = []
    failing = {"on": False}

    def handle(route):
        # the estimate passes (the store asks it once per recipe and never cancels it); the count is held or fails
        if route.request.method != "POST" or json.loads(route.request.post_data or "{}").get("estimate_only"):
            route.continue_()
        elif failing["on"]:
            route.abort()
        else:
            held.append(route)

    page.route("**/data/cell_groups*", handle)
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE)})
    ids = page.evaluate("async () => (await import('/static/js/utils/host-binding.js')).painter.ids()")
    assert "count-grid" in ids
    # no drawing yet: the painter's overlay says the cells being counted, with Cancel; the plan's own box is hidden
    notice = f"{S} .ccnt-plot > .score-notice"
    head = f"{notice} .coverage-placeholder__headline"
    until(page, "([h, t]) => { const e = document.querySelector(h); return !!e && e.textContent === t; }", [head, f"Counting {N:,} cells…"])
    assert page.is_visible(f"{notice} button:has-text('Cancel')")
    assert page.is_hidden(f"{S} .ccnt-state")
    # a long wait gets the bar of decision 21 by the page's clock (no progress frame has come: indeterminate)
    bar = page.wait_for_selector(f"{notice} .source-progress[role='progressbar']", timeout=20000)
    assert bar.get_attribute("data-mode") == "indeterminate"
    assert bar.get_attribute("aria-valuenow") is None
    assert bar.get_attribute("aria-valuetext") == f"Counting {N:,} cells…"
    page.click(f"{notice} button:has-text('Cancel')")
    page.wait_for_selector(f"{notice}[data-state='cancelled']")
    assert page.is_visible(f"{notice} button:has-text('Compute')")

    # a failure: the painter says it, and its Retry goes to this plot's handle
    failing["on"] = True
    page.click(f"{notice} button:has-text('Compute')")
    page.wait_for_selector(f"{notice}[data-state='failed']", timeout=30000)
    assert page.is_visible(f"{notice} button:has-text('Retry')")
    assert page.get_attribute(f"{S} .ccnt-plot", "data-source-state") == "failed"
    failing["on"] = False
    page.unroute("**/data/cell_groups*")
    page.click(f"{notice} button:has-text('Retry')")
    _drawn(page, "bar")
    page.wait_for_selector(notice, state="detached")
    for route in held:
        try:
            route.abort()
        except Exception:  # noqa: BLE001 - a held request the page already gave up
            pass


# ------------------------------------------------------------------ 3. the strip

def test_the_banner_says_the_cells_counted_without_a_value_and_outside_the_range(page, served):
    pt = DATA.obs["pseudotime"]
    _open(page, served, {CC: _count(mode="histogram", x=obs("pseudotime", binning={"method": "equal_width", "range": [0.5, None]}))})
    _drawn(page, "histogram")
    missing = int(pt.isna().sum())
    outside = int((pt < 0.5).sum())
    counted = N - missing - outside
    # the coverage banner under the plot says it, once; the footer line says nothing more
    assert page.get_attribute(f"{S} .plot-status", "data-summary").splitlines() == [
        f"{counted:,} of {N:,} cells shown",
        f"pseudotime: filtered out ({missing} cells) -- without a value for pseudotime",
        f"filtered out ({outside} cells) -- outside the range"]
    assert page.query_selector(f"{S} .ccnt-strip") is None, "there is no footer line under the banner"


# ------------------------------------------------------------------ 4. Save as grouping

def _dialog(page):
    return page.evaluate("""(s) => { const d = document.querySelector(s + ' .ccnt-save');
        if (!d || d.hidden) return null;
        const save = d.querySelector('.ccnt-save__save');
        return { title: d.querySelector('.ccnt-save__title').textContent, lines: [...d.querySelectorAll('.ccnt-save__line')].map(p => p.textContent),
                 disabled: save.disabled, why: save.title, role: d.getAttribute('role') }; }""", S)


def test_save_as_grouping_makes_a_grouping_of_the_plots_inputs_with_the_same_groups(page, served):
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION)})
    _drawn(page, "bar")
    groups = int((DATA.obs.groupby(["cell_type", "condition"], observed=True).size() > 0).sum())
    asked = len(_requests(page))
    page.click(f"{S} .ccnt-save-btn")
    d = _dialog(page)
    assert d == {"title": "Save as grouping", "lines": [f"Factors: cell_type, condition. {groups} groups."], "disabled": False, "why": "", "role": "dialog"}
    assert len(_requests(page)) == asked, "the dialog says what the plot already knows"
    before = page.evaluate("() => window.PanelManager.getPanelsByType('cell-grouping').length")
    page.click(f"{S} .ccnt-save__save")
    until(page, f"() => window.PanelManager.getPanelsByType('cell-grouping').length === {before + 1}")
    recipe = page.evaluate("() => { const g = window.PanelManager.getPanelsByType('cell-grouping').slice(-1)[0]; return g.getRecipe(); }")
    assert recipe == {"version": 1, "partitionings": [cc.CELL_TYPE, cc.CONDITION]}
    assert _dialog(page) is None
    # the grouping computes the groups the plot showed
    until(page, f"""() => {{ const g = window.PanelManager.getPanelsByType('cell-grouping').slice(-1)[0];
        const t = document.querySelector('.tile[data-tile-id="' + g.getId() + '"]');
        return t && /\\b{groups} groups\\b/.test(t.textContent); }}""", timeout=60)


def test_save_as_grouping_is_refused_over_the_grouping_limits_and_opens_from_a_click_on_a_bar(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=obs("depth", binning={"method": "equal_width", "bins": 1500}))})
    _drawn(page, "histogram")
    page.click(f"{S} .ccnt-save-btn")
    d = _dialog(page)
    reason = "depth has 1,500 bins; a factor of a grouping holds up to 1,000. Use fewer bins first."
    assert d["disabled"] is True and d["why"] == reason
    assert reason in d["lines"]
    page.click(f"{S} .ccnt-save__cancel")
    assert _dialog(page) is None

    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ version: 1, mode: 'bar',
        x: {{ source: {{ type: 'obs', key: 'cell_type' }} }} }})""")
    _drawn(page, "bar")
    # a click where a bar is: Plotly's drag layer takes the pointer and says which bar
    box = page.locator(f"{S} .ccnt-plot .bars .point path").first.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    until(page, "(s) => { const d = document.querySelector(s + ' .ccnt-save'); return d && !d.hidden; }", S)
    assert _dialog(page)["lines"] == ["Factors: cell_type. 6 groups."]


# ------------------------------------------------------------------ 5. no Show as table; Download CSV on the toolbar

def test_there_is_no_show_as_table_and_the_csv_downloads_from_the_toolbar(page, served):
    """Show as table was dropped (operator ruling, 2026-11-23); the CSV it mirrored stays, in Plot Options ▸ Export (WP-5a)."""
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION)})
    _drawn(page, "bar")
    assert page.query_selector(f"{S} .ccnt-table-btn") is None and page.query_selector(f"{S} .ccnt-table") is None
    assert "Show as table" not in page.inner_text(f"{S} .ccnt-panel")
    with page.expect_download() as info:
        page.click(f"{S} .ccnt-toolbar .ccnt-options-btn")
        page.click("[data-popover='plot-options'] [data-section='export'] .ccnt-csv")
    lines = open(info.value.path(), encoding="utf-8").read().strip().splitlines()
    assert lines[0].split(",")[:4] == ["cell_type", "condition", "Cells", "Share"]
    want = DATA.obs.groupby(["cell_type", "condition"], observed=True).size()
    got = {(r[0], r[1]): int(r[2]) for r in (line.split(",") for line in lines[1:])}
    assert {k: v for k, v in got.items() if v} == {k: int(v) for k, v in want.items() if v}


# ------------------------------------------------------------------ 6. the category cap is said as the plan says it

@pytest.mark.parametrize("mode, as_what", [("hist2d", "2D histogram"), ("density2d", "2D density")])
def test_a_grouping_with_too_many_groups_for_a_2d_plot_names_the_input_and_the_cap(page, served, mode, as_what):
    """operator 2026-11-25: Color by a large Cell Grouping in a 2D histogram or 2D density. The refusal is right (these modes colour up
    to 8 levels); its reason was first the estimate ("would take about 1 second"), then "'Count 1' has a factor with 30 levels: a
    factor holds up to 8". It now says what the plan says: the input, its count and the mode's cap."""
    grouping = {"id": cc.GA, "title": "Grouping 1", "version": 1, "partitionings": [obs("sample")]}       # 30 groups
    config = _count(mode=mode, x=obs("depth"), y=obs("score"), split={"source": {"type": "cell-group", "key": cc.GA}})
    _open(page, served, {CC: config, cc.GA: grouping}, open_ids=(CC, cc.GA))
    head = f"{S} .score-notice .coverage-placeholder__headline"
    until(page, "(h) => !!document.querySelector(h) && /levels|not (run|computed)|would take/.test(document.querySelector(h).textContent)", head, timeout=60)
    text = page.inner_text(head)
    assert text == f"Color by Grouping 1 has 30 levels; {as_what} colors up to 8.", text
