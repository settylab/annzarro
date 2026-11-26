"""A small UX finding of the tutorial writers (v0.8.0), on the grouping harness: a cross-table column is as wide as its name, so the
columns can be told apart.

Run:  python -m pytest annzarro/tests/browser/test_ux_small_grouping.py -n 2
"""
import pytest

try:
    import playwright.sync_api as playwright  # noqa: E402,F401
except ImportError:  # pragma: no cover
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_grouping_panel as base  # noqa: E402
from annzarro.tests.browser import test_group_grid as GG  # noqa: E402
from annzarro.tests.browser.test_cell_group_plots import page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

LONG = {"c:ctrl": "kompot_da_Young_to_Old_lfc < -1", "c:treated": "kompot_da_Young_to_Old_lfc >= 1"}


# ------------------------------------------------------------------ 6. the cross-table's columns

def test_a_cross_table_column_is_wide_enough_for_its_name(page, served):
    second = {**base.CONDITION, "labels": LONG}
    GG._open(page, served, [base.CELL_TYPE, second])
    page.click(f"{GG.A} .cgg__view [data-view='cross']")
    until(page, "(s) => !!document.querySelector(s + ' .cgg-grid[data-view=cross]')", GG.A)
    shown = page.evaluate("""(s) => [...document.querySelectorAll(s + ' [role=columnheader]')].filter(e => e.classList.contains('cgg-num'))
        .map(e => [e.textContent.trim(), e.scrollWidth <= e.clientWidth + 1])""", GG.GRID)
    assert shown and all(ok for _, ok in shown), f"every column name is shown in full: {shown}"
    assert len({text for text, _ in shown}) == len(shown) and all(len(text) > 20 for text, _ in shown), shown
