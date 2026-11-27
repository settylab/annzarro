"""The top band above a Cell or Gene Plot's plot box (v0.8.0): the 80 px of top margin was room for a modebar that now sits over the
plot area (utils/modebar-anchor.js), so a new plot keeps 30 px, and a plot saved with the old default margins gets it too.

Run:  python -m pytest annzarro/tests/browser/test_ux_small_band.py -n 2
"""
import pytest

try:
    import playwright.sync_api as playwright  # noqa: E402,F401
except ImportError:  # pragma: no cover
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_group_plots import C, P, _open, _plot, page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OLD = {"l": 80, "r": 80, "t": 80, "b": 60, "pad": 4}
TOP = """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return gd && gd._fullLayout ? gd._fullLayout._size.t : null; }"""


def _top(page):
    until(page, "(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!(gd && gd._fullLayout && gd._fullLayout._size); }", C)
    return page.evaluate(TOP, C)


def test_a_new_cell_plot_keeps_30_px_above_its_plot_box(page, served):
    _open(page, served, {P: _plot()})
    assert _top(page) <= 40, "no blank band above the plot box"


def test_a_plot_saved_with_the_old_default_margins_gets_the_new_top(page, served):
    _open(page, served, {P: _plot(margins=dict(OLD))})
    assert _top(page) <= 40
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().margins.t", P) <= 40


def test_a_margin_the_user_chose_is_kept(page, served):
    _open(page, served, {P: _plot(margins={"l": 80, "r": 80, "t": 120, "b": 60, "pad": 4})})
    assert _top(page) >= 110


def test_a_3d_plot_keeps_the_same_top(page, served):
    z = {"type": "obsm", "key": "X_umap", "column": "1"}
    _open(page, served, {P: _plot(z=z)})
    until(page, "(t) => !!document.querySelector(t + ' .js-plotly-plot .scene, ' + t + ' .js-plotly-plot .gl-container')", C)
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot')._fullLayout.margin.t", C) <= 40
