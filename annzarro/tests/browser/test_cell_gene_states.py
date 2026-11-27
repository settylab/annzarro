"""The Cell-Gene Plot's states in a real browser, against the real cell_groups route (X3b; UX 3.5).

The store is X3a's: the grouping fixture (tests/core/grouping_store.py), 1,200 cells, ``cell_type`` with 6 levels,
``many`` with one cell per level (1,200 groups), 40 genes, X signed, layers ``logged`` and ``counts``. Where a state
needs a server that is slow, busy or refusing, the route's replies are rewritten in the page (``page.route``); the
sentences of every state are the Node tests' (annzarro/tests/js/cell-gene-states.test.mjs).

1.  Empty: the checklist, each step ticked as done, each button going to its control; nothing asked.
2.  Refused, too large (CXG-17): above 400,000 cells of the matrix the genes are never asked for, with the groups
    unknown (the groups alone first) and known (no request at all); below it, they are.
3.  Asks first (SHR-32): the upper bound with the stored values, Compute and Fewer genes; nothing computed until
    Compute; Fewer genes opens the section list.
4.  Refused for a CSR layer (CXG-19): the layout and the way out, no genes read.
5.  No size (SHR-27): one dot size, the sentence in place of the size legend, the strip tag, the layers that work
    first in Size.
6.  One cell per group (CXG-27): the suggestion, and Show as Heatmap asks for nothing.
7.  Ready: the strip's "6 groups × 5 rows".
8.  Error: the reason and Retry, which computes again.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _state, _drawn, _features, _settle, P, TP, S1, S2, GA, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

NOTICE = f"{TP} .cgene-plot > .score-notice"


def _says(page, headline):
    """Wait for the overlay to say `headline` (the painter paints a burst of changes once, a moment later), and return
    its text under it."""
    until(page, "([s, want]) => { const h = document.querySelector(s + ' .coverage-placeholder__headline'); return !!h && h.textContent === want; }",
          [NOTICE, headline], timeout=30)
    text = page.locator(f"{NOTICE} .filter-notice__text")
    return text.inner_text() if text.count() else ""


def _buttons(page):
    loc = page.locator(f"{NOTICE} .ps-action")
    return [loc.nth(i).inner_text() for i in range(loc.count())]


def _wait_state(page, state, timeout=60):
    until(page, "([s, want]) => { const e = document.querySelector(s + ' .cgene-panel'); return e && e.dataset.state === want; }",
          [TP, state], timeout=timeout)


def _set(page, fields):
    """A configuration as Back and Forward give it: the whole of it, with no undo step."""
    page.evaluate("([id, f]) => { const p = window.PanelManager.getPanel(id); p.updateConfig({ ...p.getConfig(), ...f }); }", [P, fields])


def _rewrite(page, estimate=None, compute=None):
    """Rewrite the route's replies: `estimate(dict) -> dict` changes an estimate; `compute(route, body)` answers a computation
    (or returns False to let it through to the server)."""
    def handle(route, request):
        if request.method != "POST":
            route.continue_()
            return
        body = json.loads(request.post_data or "{}")
        if body.get("estimate_only"):
            if estimate is None:
                route.continue_()
                return
            reply = route.fetch().json()
            reply["estimate"] = estimate(dict(reply["estimate"]))
            route.fulfill(status=200, content_type="application/json", body=json.dumps(reply))
            return
        if compute is None or compute(route, body) is False:
            route.continue_()
    page.route("**/api/v1/data/cell_groups**", handle)


def _sections(n, source=S1):
    return [{"source": source, "rows": "genes"} for _ in range(n)]


# ------------------------------------------------------------------ 1. empty

def test_the_checklist_ticks_each_step_and_its_buttons_go_to_the_controls(page, served):
    _open(page, served, {P: {"id": P, "title": "Cell-Gene Plot 1"}})
    steps = page.locator(f"{TP} .cgene-checklist li")
    assert steps.count() == 2
    assert [steps.nth(i).locator(".cgene-checklist__go").inner_text() for i in range(2)] == ["Groups ▾", "Add genes ▾"]
    steps.nth(0).locator(".cgene-checklist__go").click()
    until(page, "(s) => document.activeElement === document.querySelector(s + ' .cgene-axis-type')", TP)
    steps.nth(1).locator(".cgene-checklist__go").click()
    until(page, "(s) => !document.querySelector(s + ' .cgene-add-menu').hidden", TP)
    page.keyboard.press("Escape")
    page.select_option(f"{TP} .cgene-axis-type", "obs")
    page.select_option(f"{TP} .cgene-axis-key", "cell_type")
    until(page, "(s) => document.querySelector(s + ' .cgene-checklist li').dataset.done === 'true'", TP)
    assert steps.nth(1).get_attribute("data-done") == "false"
    _settle(page, "an empty plot asks nothing; the absence of a request cannot be waited on")
    assert page.asked == []


# ------------------------------------------------------------------ 2. too large (CXG-17)

TOO_LARGE = "1,200 groups × 360 rows = 432,000 cells of the matrix; the limit is 400,000."


def test_too_large_with_the_groups_unknown_asks_for_the_groups_alone_and_never_for_the_genes(page, served):
    # 9 sections of 40 genes: 360 rows, so the 1,200 groups of `many` make 432,000 cells of the matrix
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "obs", "key": "many"}, sections=_sections(9)),
                         S1: _sig(S1, "All genes", GENES)}, open_ids=(P, S1))
    _wait_state(page, "toolarge")
    assert _says(page, TOO_LARGE) == "Remove a section or use fewer groups."
    # the ways out that would draw (T-CAP): one section as one row, or one removed; no Open grouping for an obs axis
    assert _buttons(page) == ["Show All genes as one row", "Remove All genes"]
    assert page.calls, "the groups were asked for, to know how many there are"
    assert _features(page.calls) == [], "no gene was asked for above the limit"
    _settle(page, "above the limit nothing more is asked; a request that never goes out cannot be waited on")
    assert _features(page.calls) == []
    # one section fewer: 320 rows, 384,000 cells, under the limit: the genes are asked for and drawn
    _set(page, {"sections": _sections(8)})
    st = _drawn(page)
    assert st["groups"] == 1200 and st["rows"] == 320
    assert sorted({f["name"] for f in _features(page.calls)}) == sorted(GENES)


def test_too_large_with_the_groups_known_is_decided_without_any_request(page, served):
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "obs", "key": "many"}, sections=_sections(1)),
                         S1: _sig(S1, "All genes", GENES)}, open_ids=(P, S1))
    _drawn(page)
    n = len(page.calls)
    # nine sections on another layer: new genes to read, 432,000 cells of the matrix: refused before any request
    _set(page, {"sections": _sections(9), "color": {"stat": "mean", "layer": "counts"}})
    _wait_state(page, "toolarge")
    _says(page, TOO_LARGE)
    _settle(page, "the limit is decided from the groups known; the request it prevents never goes out")
    assert len(page.calls) == n
    # under the limit again, the new layer's genes are asked for
    _set(page, {"sections": _sections(8)})
    _drawn(page)
    assert len(page.calls) == n + 1
    assert {f["layer"] for f in page.calls[-1]["features"]} == {"counts"}


def test_too_large_reads_the_groups_of_a_grouping_panel_that_holds_them_with_no_request(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "many"}}]}
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "cell-group", "key": GA}),
                         S1: _sig(S1, "All genes", GENES), GA: grouping}, open_ids=(P, S1, GA))
    # the grouping panel computes its own groups; the plot, with no genes, asks nothing
    until(page, "(id) => { const s = window.PanelManager.getPanel(id)._debugState(); return s.state === 'ready' && s.groups === 1200; }", GA, timeout=60)
    # (the grouping's own grid may ask for the focused gene; the plot's genes are what must never be asked for)
    n = len(page.calls)
    _set(page, {"sections": _sections(9)})
    _wait_state(page, "toolarge")
    _says(page, TOO_LARGE)
    _settle(page, "the grouping panel's groups decide the limit; the requests it makes unneeded never go out")
    assert len(page.calls) == n, "no request at all: not the groups (held), not the genes (above the limit)"


def test_a_grouping_edited_to_more_groups_is_counted_again_before_any_gene(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    # 360 rows: 6 groups fit (2,160 cells of the matrix), 1,200 would not (432,000)
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "cell-group", "key": GA}, sections=_sections(9)),
                         S1: _sig(S1, "All genes", GENES), GA: grouping}, open_ids=(P, S1, GA))
    st = _drawn(page)
    assert st["groups"] == 6 and st["rows"] == 360
    n = len(page.calls)
    # the grouping is edited to one group per cell: its groups are not known until they are counted
    page.evaluate("([id, g]) => window.PanelManager.getPanel(id).updateConfig(g)", [GA, {**grouping, "partitionings": [{"source": {"type": "obs", "key": "many"}}]}])
    _wait_state(page, "toolarge")
    _says(page, TOO_LARGE)
    _settle(page, "above the limit the genes are never asked for; a request that never goes out cannot be waited on")
    after = page.calls[n:]
    assert after, "the new groups were asked for, to count them"
    # the plot reads its genes on `logged`; the grouping's own grid may ask for its focused gene on X
    assert [f for f in _features(after) if f["layer"] == "logged"] == [], "no gene of the plot was asked for above the limit"


# ------------------------------------------------------------------ 3. asks first (SHR-32)

def test_asks_first_with_an_upper_bound_compute_and_fewer_genes(page, served):
    big = lambda e: {**e, "seconds": 350, "tier": "confirm", "lane": "heavy", "entries": 10_500_000_000, "n_cells": 95_600_000}  # noqa: E731
    _rewrite(page, estimate=big)
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:5])}, open_ids=(P, S1))
    _wait_state(page, "awaiting")
    text = _says(page, "Reading 5 genes over 1,200 cells: up to about 6 minutes (10.5 billion stored values).")
    assert text == "Groupings and counts keep working."
    assert _buttons(page) == ["Compute", "Fewer genes"]
    _settle(page, "asks first: nothing is computed before Compute, so no request can be waited on")
    assert page.calls == []
    page.click(f"{NOTICE} .ps-action[data-ps-action='fewer-genes']")
    until(page, "(s) => document.activeElement === document.querySelector(s + ' .cgene-section[data-index=\"0\"] .az-card__head')", TP)
    page.click(f"{NOTICE} .ps-action[data-ps-action='score-compute']")
    _drawn(page)
    assert len(page.calls) == 1 and page.calls[0].get("confirm") is True


# ------------------------------------------------------------------ 4. refused, CSR (CXG-19)

def test_refused_for_a_csr_layer_names_the_layout_and_the_way_out(page, served):
    csr = lambda e: {**e, "seconds": 2400, "tier": "refused", "layout": "csr", "lane": "heavy"}  # noqa: E731
    answered = []

    def refuse(route, body):
        # the server refuses a request of the refused tier before reading anything (413)
        answered.append(body)
        route.fulfill(status=413, content_type="application/json", body=json.dumps(
            {"error": "This would take about 40 minutes.", "reason": "groups_too_expensive",
             "estimate": {"seconds": 2400, "tier": "refused", "layout": "csr", "lane": "heavy"}}))
    _rewrite(page, estimate=csr, compute=refuse)
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:5])}, open_ids=(P, S1))
    _wait_state(page, "refused")
    text = _says(page, "logged is stored by cell (CSR), so 5 genes mean reading the whole matrix: about 40 minutes.")
    assert text == "A copy of the layer stored by gene (CSC) makes this fast; see the documentation."
    # the server's estimate says a run of 40 minutes may be tried (within ten times the 30 minute limit)
    assert _buttons(page) == ["Try anyway"]
    assert len(answered) == len(page.calls), "every computation was refused before the stream: no gene was read"


# ------------------------------------------------------------------ 5. no size (SHR-27)

def test_no_size_draws_one_size_says_why_and_lists_the_layers_that_work_first(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}],
                "offered": ["mean", "fraction_of_cells"], "layers": ["X", "logged", "counts"]}
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=_sections(1),
                                  size={"stat": "fraction_of_cells", "layer": "X"}, color={"stat": "mean", "layer": "X"}),
                         S1: _sig(S1, "Markers", GENES[:5]), GA: grouping}, open_ids=(P, S1, GA))
    _drawn(page)
    sentence = "Fraction of cells cannot be computed on 'X': it has negative values. Choose a layer."
    until(page, "(s) => { const t = document.querySelector(s + ' .ps-tag[data-tag=\"cgene-nosize\"]'); return t && t.textContent === 'No size'; }", TP)
    until(page, "([s, want]) => (document.querySelector(s + ' .cgene-plot').textContent || '').includes(want)", [TP, sentence])
    # the Size layer select (WP-4): the held X marked, the layers that can give the size enabled
    layers = page.eval_on_selector_all(f"{TP} .cgene-size-layer option",
                                       "os => os.filter(o => !o.disabled && !o.classList.contains('cgene-lapsed')).map(o => o.value)")
    assert layers == ["counts", "logged"], layers  # every layer, in the dataset's order (decision 31)
    assert CC.chosen_stat(page, TP, "size") == "fraction_of_cells"
    assert page.locator(f"{TP} .cgene-size-layer option[value='X']").inner_text() == "X (not available)"
    # no size is asked for: only Color's genes
    assert {f["layer"] for f in _features(page.calls)} == {"X"}


# ------------------------------------------------------------------ 6. one cell per group (CXG-27)

def test_one_cell_per_group_suggests_a_heatmap_and_switching_asks_nothing(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "many"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, S1))
    st = _drawn(page)
    assert st["groups"] == 1200
    hint = page.locator(f"{TP} .cgene-hint")
    until(page, "(s) => !document.querySelector(s + ' .cgene-hint').hidden", TP)
    assert hint.inner_text().startswith("One cell per group: Fraction of cells is 0 or 1.")
    n = len(page.calls)
    hint.locator(".cgene-hint__do").click()
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').data[0].type === 'heatmap'", TP)
    until(page, "(s) => document.querySelector(s + ' .cgene-hint').hidden", TP)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().mode", P) == "heatmap"
    assert len(page.calls) == n


# ------------------------------------------------------------------ 7. ready

def test_ready_says_groups_by_rows_in_the_strip(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:5])}, open_ids=(P, S1))
    _drawn(page)
    until(page, "(s) => { const t = document.querySelector(s + ' .ps-tag[data-tag=\"cgene-matrix\"]'); return t && t.textContent === '6 groups × 5 rows'; }", TP)
    assert len(page.calls) == 1, "rows under 200 cannot exceed the limit: the groups and the genes in one request"


# ------------------------------------------------------------------ 8. error

def test_an_error_says_why_and_retry_computes_again(page, served):
    failures = []

    def fail_once(route, body):
        if failures:
            return False
        failures.append(body)
        route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "the server stopped responding"}))
        return None
    _rewrite(page, compute=fail_once)
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:5])}, open_ids=(P, S1))
    _wait_state(page, "failed")
    _says(page, "Could not be computed: the server stopped responding.")
    assert _buttons(page) == ["Retry"]
    page.click(f"{NOTICE} .ps-action[data-ps-action='score-retry']")
    _drawn(page)
    assert len(page.calls) == 2


# ------------------------------------------------------------------ 6. refused for its size is not a refusal by cost

def test_a_grouping_over_the_levels_limit_says_that_limit_and_never_quotes_seconds(page, served):
    """operator 2026-11-25: "would take about 1 second, so it was not run". The real server, a grouping kept by name over the
    2,000-level limit: refused for its SIZE, after a cheap estimate in the auto tier. The notice names the levels and the limit."""
    every = [f"c:m{i:04d}" for i in range(2001)]
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "many"}, "levels": every}]}
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:5]), GA: grouping}, open_ids=(P, S1, GA))
    _wait_state(page, "refused")
    until(page, "(s) => { const h = document.querySelector(s + ' .coverage-placeholder__headline'); return !!h && /not (run|computed)/.test(h.textContent); }",
          NOTICE, timeout=30)       # the painter paints the burst of state changes once, a moment later
    headline = page.locator(f"{NOTICE} .coverage-placeholder__headline").inner_text()
    assert "would take" not in headline and "second" not in headline, headline
    assert "2,001 levels" in headline and "2,000" in headline, headline


# ------------------------------------------------------------------ 2b. ways out of the matrix limit (T-CAP, 14.8)

def _too_large_nine(page, served):
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "obs", "key": "many"}, sections=_sections(9)),
                         S1: _sig(S1, "All genes", GENES)}, open_ids=(P, S1))
    _wait_state(page, "toolarge")


def _undo_label(page):
    return page.get_attribute(f"{TP} .cgene-undo", "title") or page.get_attribute(f"{TP} .cgene-undo", "aria-label")


def test_show_a_section_as_one_row_draws_in_one_undoable_step(page, served):
    _too_large_nine(page, served)
    page.click(f"{NOTICE} .ps-action:has-text('as one row')")
    st = _drawn(page)
    assert st["groups"] == 1200 and st["rows"] == 321, st            # 8 sections of 40 genes and one row
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", P)
    assert [s["rows"] for s in cfg["sections"]].count("set") == 1 and cfg["sections"][0]["rows"] == "set"
    page.click(f"{TP} .cgene-undo")
    _wait_state(page, "toolarge")
    assert [s["rows"] for s in page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", P)["sections"]] == ["genes"] * 9


def test_remove_a_section_draws_in_one_undoable_step(page, served):
    _too_large_nine(page, served)
    page.click(f"{NOTICE} .ps-action:has-text('Remove All genes')")
    st = _drawn(page)
    assert st["groups"] == 1200 and st["rows"] == 320, st
    page.click(f"{TP} .cgene-undo")
    _wait_state(page, "toolarge")
    assert len(page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", P)["sections"]) == 9


def test_no_way_is_offered_when_no_single_edit_would_draw(page, served):
    # 20 sections of 40 genes: 800 rows over 1,200 groups; removing or folding one section leaves 760 rows, still over the limit
    _open(page, served, {P: _plot(mode="heatmap", cellAxis={"type": "obs", "key": "many"}, sections=_sections(20)),
                         S1: _sig(S1, "All genes", GENES)}, open_ids=(P, S1))
    _wait_state(page, "toolarge")
    _says(page, "1,200 groups × 800 rows = 960,000 cells of the matrix; the limit is 400,000.")
    assert _buttons(page) == []


# ------------------------------------------------------------------ the strip follows the drawing

def test_the_strip_does_not_keep_the_count_of_a_drawing_that_is_gone(page, served):
    """A plot that was drawn and is then replaced by a notice (a refusal that clears the drawing) must not leave the strip
    below it saying how many cells the old drawing showed."""
    refuse = {"on": False}

    def estimate(e):
        return {**e, "seconds": 2400, "tier": "refused", "layout": "csc", "lane": "heavy"} if refuse["on"] else e
    _rewrite(page, estimate=estimate)
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)), S1: _sig(S1, "Markers", GENES[:5]), S2: _sig(S2, "Others", GENES[5:10])}, open_ids=(P, S1))
    _drawn(page)
    strip = f"{TP} .plot-status .ps-headline"
    drawn = page.inner_text(strip)
    assert "cells" in drawn and not drawn.startswith("0 "), drawn
    refuse["on"] = True
    _set(page, {"sections": _sections(1, S2)})     # other genes: a new estimate, which is refused
    _wait_state(page, "refused")
    until(page, "(s) => document.querySelector(s + ' .cgene-plot .js-plotly-plot') === null || !document.querySelector(s + ' .cgene-plot .js-plotly-plot').data", TP)
    assert page.inner_text(strip) == "", "nothing is drawn: no count in the strip (not the old drawing's, not \"0 cells\")"
    until(page, "(s) => { const t = document.querySelector(s + ' .plot-status .ps-tag[data-tag=\"score\"]'); return !!t && t.textContent.trim() === 'Plot refused'; }", TP)   # the state tag speaks
    # a drawing arrives again: its count is back
    refuse["on"] = False
    _set(page, {"sections": _sections(1)})
    _drawn(page)
    until(page, "(s) => document.querySelector(s + ' .plot-status .ps-headline').textContent === '1,200 cells'", TP)


# ------------------------------------------------------------------ the gap between sections (none by default, any fraction)

XPOS = """(t) => { const gd = document.querySelector(t + ' .cgene-plot .js-plotly-plot') || document.querySelector(t + ' .js-plotly-plot');
    const f = gd._fullLayout;
    const cell = (tr) => Array.from(tr.x || []).filter(v => v !== null);
    return { ticks: f.xaxis.tickvals, range: f.xaxis.range, domain: f.xaxis.domain, width: gd.clientWidth,
             heat: gd.data.filter(d => d.type === 'heatmap').map(d => cell(d)),
             bar: (() => { const m = gd.data.find(d => d.type === 'scatter' && d.marker && d.marker.colorbar); const b = m && m.marker.colorbar;
                           return b ? b.x : null; })() }; }"""


def _two_one_row(page, served, mode="dots", **extra):
    _open(page, served, {P: _plot(mode=mode, cellAxis={"type": "obs", "key": "cell_type"},
                                  sections=[{"source": S1, "rows": "set"}, {"source": S2, "rows": "set"}], **extra),
                         S1: _sig(S1, "Falls", GENES[:5]), S2: _sig(S2, "Rises", GENES[5:12])}, open_ids=(P, S1))
    _drawn(page)
    return page.evaluate(XPOS, TP)


def test_the_gap_between_sections_is_none_by_default_in_dots_and_in_a_heatmap(page, served):
    assert _two_one_row(page, served)["ticks"] == [0, 1]
    assert _two_one_row(page, served, "heatmap")["heat"] == [[0, 1]], "one run of cells, side by side"


def test_a_gap_of_half_a_column_is_half_a_column_in_dots_and_in_a_heatmap(page, served):
    assert _two_one_row(page, served, gap=0.5)["ticks"] == [0, 1.5]
    heat = _two_one_row(page, served, "heatmap", gap=0.5)["heat"]
    assert heat == [[0], [1.5]], f"two runs of cells half a column apart: {heat}"


def test_two_one_row_sections_are_not_stretched_and_the_legend_follows_the_plot(page, served):
    got = _two_one_row(page, served)
    plot_px = (got["domain"][1] - got["domain"][0]) * (got["width"] - 20)       # paper units are of the area inside the 10 px margins
    assert plot_px / (got["range"][1] - got["range"][0]) <= 141, f"a column of dots is at most 140 px wide: {got}"
    # the colour bar starts just after the plot's right edge, not at the tile's
    assert 0 <= (got["bar"] - got["domain"][1]) * (got["width"] - 20) < 80, got
    swapped = _two_one_row(page, served, swap=True)
    assert swapped["bar"] is not None and swapped["bar"] >= swapped["domain"][1], "swapped axes: the legend does not overlap the plot"


def test_many_columns_keep_the_legend_clear_of_the_plot(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=_sections(1)),
                         S1: _sig(S1, "Markers", GENES[:30])}, open_ids=(P, S1))
    _drawn(page)
    got = page.evaluate(XPOS, TP)
    assert got["bar"] >= got["domain"][1] + 0.02, got


# ------------------------------------------------------------------ the colour bar of a crowded legend column

def test_the_colour_bar_of_a_small_tile_is_readable_and_its_ticks_do_not_touch(page, served):
    page.set_viewport_size({"width": 1500, "height": 800})
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                                  sections=[{"source": S1, "rows": "set"}, {"source": S2, "rows": "set"}]),
                         S1: _sig(S1, "Falls", GENES[:5]), S2: _sig(S2, "Rises", GENES[5:12])}, open_ids=(P, S1))
    _drawn(page)
    got = page.evaluate("""(t) => { const gd = document.querySelector(t + ' .cgene-plot');
        const fills = gd.querySelector('.colorbar .cbfills'); const bar = fills ? fills.getBoundingClientRect().height : 0;
        const tops = [...gd.querySelectorAll('.colorbar .cbaxis text')].map(e => e.getBoundingClientRect().top).sort((a, b) => a - b);
        return { bar, tops, gap: tops.length > 1 ? Math.min(...tops.slice(1).map((v, i) => v - tops[i])) : null }; }""", TP)
    assert got["bar"] >= 60, f"the colour bar is a sliver: {got}"
    assert len(got["tops"]) >= 2 and got["gap"] >= 14, f"tick labels overlap: {got}"
