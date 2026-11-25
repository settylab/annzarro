"""T-CAP (aggregation-unify-080.md 14.8): a section over `genes_per_section` can be Shown as one row, when its channels
read it as a score (so its cost does not grow with its genes). One undoable edit; only offered when it would draw.

A server started with `limits: {genes_per_section: 3}` and a signature of 6 genes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_gene_panel as panel  # noqa: E402
from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the page fixture)
    GENES, P, S1, TP, _drawn, _open, _plot, _sig, page)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
LIMITS = "limits:\n  genes_per_section: 3\n"
SECTION = f"{TP} .cgene-section"


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = panel._make_store
    try:
        proc, root, store = _focus._serve(tmp_path_factory, config=LIMITS)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def _open_over(page, served, color):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], color=color), S1: _sig(S1, "Markers", GENES[:6])}, open_ids=(P, S1))
    until(page, "(s) => !!document.querySelector(s + ' .cgene-section')", TP, timeout=60)


def _rows(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().sections.map(s => s.rows || 'genes')", P)


def test_a_section_over_the_cap_offers_one_row_when_its_color_is_a_score_and_it_draws(page, served):
    _open_over(page, served, {"stat": "zscore_mean", "layer": "X"})
    until(page, "(s) => !!document.querySelector(s + ' .cgene-section__way')", TP)
    note = page.inner_text(f"{SECTION} .az-card__note")
    assert "has 6 genes; a section shows up to 3." in note and "Show as one row" in note, note
    page.click(f"{SECTION} .cgene-section__way")
    st = _drawn(page)
    assert st["rows"] == 1 and st["groups"] == 6, st
    assert _rows(page) == ["set"]
    assert page.get_attribute(f"{TP} .cgene-undo", "title") == "Undo: Markers as one row"
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].rows !== 'set'", P)


def test_no_way_is_offered_when_the_channel_reads_the_genes_one_by_one(page, served):
    _open_over(page, served, {"stat": "mean", "layer": "X"})
    until(page, "(s) => !!document.querySelector(s + ' .cgene-section .az-card__note')", TP)
    assert "has 6 genes; a section shows up to 3." in page.inner_text(f"{SECTION} .az-card__note")
    assert page.locator(f"{SECTION} .cgene-section__way").count() == 0
