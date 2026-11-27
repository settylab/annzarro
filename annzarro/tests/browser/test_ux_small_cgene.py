"""Small UX findings of the tutorial writers (v0.8.0), on the Cell-Gene harness: the threshold 0 is the default on an obs axis,
and the grouping and group selects of a Gene Plot row keep a readable width in a tile about 1,000 px wide.

Run:  python -m pytest annzarro/tests/browser/test_ux_small_cgene.py -n 2
"""
import json

import pytest

try:
    import playwright.sync_api as playwright  # noqa: E402,F401
except ImportError:  # pragma: no cover
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser import test_gene_plot_group_stat as GS  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import GENES, P, S1, TP, _drawn, _open, _plot, _sig, page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402


# ------------------------------------------------------------------ 4. the Cell-Gene threshold 0

def test_a_threshold_of_zero_on_an_obs_axis_is_the_default_so_the_button_loses_its_suffix(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}],
                        size={"stat": "fraction_of_cells", "layer": "logged", "detect_above": 2}),
               S1: _sig(S1, "Markers", GENES[0:3])}
    _open(page, served, configs, open_ids=(P,))
    _drawn(page)
    assert page.inner_text(f"{TP} button.cgene-size").replace(" ", "").endswith(">2")
    CC.set_above(page, TP, "size", "0")
    until(page, "(id) => !('detect_above' in window.PanelManager.getPanel(id).getConfig().size)", P)
    assert not page.inner_text(f"{TP} button.cgene-size").replace(" ", "").endswith(">0"), "no own value: no suffix"
    assert CC.above(page, TP, "size")["value"] == "0", "the box says what the plot does"


def test_a_threshold_of_zero_on_a_grouping_axis_stays_an_override_of_the_groupings_own(page, served):
    from annzarro.tests.browser.test_cell_gene_ungated import AXIS, GA  # noqa: F401
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}],
                "detect_above": 1}
    configs = {P: _plot(cellAxis=dict(AXIS), sections=[{"source": S1, "rows": "genes"}], size={"stat": "fraction_of_cells", "layer": "logged"}),
               S1: _sig(S1, "Markers", GENES[0:3]), GA: grouping}
    _open(page, served, configs, open_ids=(P, GA))
    _drawn(page)
    CC.set_above(page, TP, "size", "0")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 0", P)
    assert page.inner_text(f"{TP} button.cgene-size").replace(" ", "").endswith(">0"), "an override of the grouping's 1 is shown"


# ------------------------------------------------------------------ 5. the Gene Plot axis row: three control columns (a tile about 1,000 px wide), two, one

@pytest.mark.parametrize("width", [1500, 1000, 800])
def test_the_grouping_and_group_selects_of_a_gene_plot_row_keep_a_readable_width(page, served, width):
    page.set_viewport_size({"width": width, "height": 900})
    GS._open(page, served, {GS.G: GS._plot(color=GS._stat()), GS.GA: GS._grouping()})
    page.wait_for_selector(f'{GS.C} select.axis-member-select[data-axis="color"]', timeout=30000)
    widths = page.evaluate("""(t) => { const w = (s) => document.querySelector(t + ' ' + s).getBoundingClientRect().width;
        return { item: w('select.axis-column-select[data-axis="color"]'), member: w('select.axis-member-select[data-axis="color"]') }; }""", GS.C)
    assert widths["item"] >= 60 and widths["member"] >= 60, f"each select shows more than its arrow: {widths}"
