"""⋯ Duplicate draws the copy as a section of its own (operator, 2026-11-23: "When duplicating a set, it does not show up
twice in the plot").

A duplicate is an independent copy after the section: its rows are drawn again, under a title of its own, and its
settings are its own, so one can be changed without the other. Undo takes the copy away.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_rows as CR  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, _config, _state, P, TP, S1, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# the drawn figure: the gene axis's positions that carry a value, and the section brackets' titles
FIGURE = """(s) => { const p = document.querySelector(s + ' .cgene-plot');
  const main = (p.data || []).filter(t => !t.name && ['scatter', 'scattergl', 'heatmap'].includes(t.type));
  const columns = new Set(main.flatMap(t => t.type !== 'heatmap' ? Array.from(t.x || [])
    : Array.from(t.x || []).filter((_, j) => (t.z || []).some(row => Number.isFinite(row[j])))));
  const titles = (p.layout.annotations || []).map(a => a.text || '').filter(Boolean);
  return { state: document.querySelector(s + ' .cgene-panel').dataset.state, columns: columns.size, titles }; }"""


def _figure(page):
    return page.evaluate(FIGURE, TP)


def _duplicate(page, i):
    page.locator(f"{TP} .cgene-section").nth(i).locator(".cgene-section__menu-btn").click()
    page.locator(".cgene-section__menu-item[data-op='duplicate']:visible").click()


@pytest.mark.parametrize("rows", ["genes", "set"])
def test_a_duplicate_is_drawn_as_its_own_section(page, served, rows):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": rows}]),
                         S1: _sig(S1, "Pathway", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    one = _figure(page)
    n = one["columns"]
    assert n == (4 if rows == "genes" else 1), one
    _duplicate(page, 0)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)
    try:
        until(page, f"(s) => {{ const f = ({FIGURE})(s); return f.state === 'ready' && f.columns === {2 * n}; }}", TP, timeout=30)
    except AssertionError:
        pytest.fail(f"the copy is not drawn: {_figure(page)}, panel {_state(page)}")
    cfg = _config(page)
    assert cfg["sections"][1].get("title") == "Pathway (copy)", cfg["sections"]
    two = _figure(page)
    assert any("Pathway (copy)" in t for t in two["titles"]), two["titles"]
    assert _state(page)["rows"] == 2 * n
    # Undo takes the copy away
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 1", P)
    until(page, f"(s) => {{ const f = ({FIGURE})(s); return f.state === 'ready' && f.columns === {n}; }}", TP, timeout=30)


def test_the_copy_of_a_one_row_section_has_settings_of_its_own(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "set"}]),
                         S1: _sig(S1, "Pathway", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    _duplicate(page, 0)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)
    _drawn(page)
    # the copy shown as genes: the original stays one row
    CR.show_as(page, TP, 1, "genes")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[1].rows === 'genes'", P)
    assert _config(page)["sections"][0]["rows"] == "set"
    until(page, f"(s) => {{ const f = ({FIGURE})(s); return f.state === 'ready' && f.columns === 5; }}", TP, timeout=30)
