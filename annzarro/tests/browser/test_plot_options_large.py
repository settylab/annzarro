"""Plot Options in large-plot mode: the controls that apply work, the rest do not break the plot.

The fixture's 200 cells are drawn in large-plot mode by a threshold of 100 points. Tick marks, the
tick count, margins and the scale bar act on the graph as in the regular mode; the colour bar and
point-style controls of the regular mode have no effect on a large plot's own legend and bar, and
changing them must leave the plot drawn.
"""
import pytest

from annzarro.tests.browser.test_axis_title_restore import _start
from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, SB, _cfgs, _change, _full, _link, _menu, _slide, page)


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def test_options_on_a_large_plot(page, server):
    page.goto(_link(server, _cfgs()))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1500)
    assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, A), "the fixture did not draw in large-plot mode"
    _menu(page, A, "axes")
    page.uncheck(f"#show-tick-marks-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.ticks === ''" % GD, arg=A)
    _change(page, f"#tick-count-{A}", 3)
    assert _full(page, A, "xaxis.nticks") == 3
    page.check(f"#show-scale-bar-{A}")
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    _slide(page, f"#scale-bar-size-{A}", 200)
    assert page.evaluate(SB, A)["shapes"] == 1
    _menu(page, A, "margins")
    _change(page, f"#margin-all-input-{A}", 20)
    assert [_full(page, A, f"margin.{k}") for k in "ltrb"] == [20] * 4
    _menu(page, A, "legend")
    page.select_option(f"#colorbar-position-{A}", "bottom")
    page.wait_for_timeout(500)
    page.click(f"#preset-publication-{A}") if page.query_selector(f"#preset-publication-{A}") else None
    page.wait_for_timeout(800)
    # still drawn, still large
    assert page.evaluate("(id) => !!(%s)(id).__isLarge && (%s)(id).data.some(t => t.x && t.x.length > 1)" % (GD, GD), A)
