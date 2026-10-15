"""Plot Options in large-plot mode: the controls that apply work, the rest do not break the plot.

The fixture's 200 cells are drawn in large-plot mode by a threshold of 100 points. Tick marks, the
tick count, margins, the scale bar and the colour bar options (position, length, ticks) act on the
graph as in the regular mode, and the plot stays drawn.
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
    # B has a numerical colour: its colour bar options on a large plot
    assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, B)
    BAR = """(id) => { const gd = (%s)(id); const t = gd.data.find(t => t.meta === 'az-colorbar');
        return t ? { orientation: t.marker.colorbar.orientation, len: t.marker.colorbar.len, nticks: t.marker.colorbar.nticks,
                     x: t.marker.colorbar.x, drawn: gd.querySelectorAll('.colorbar .cbaxis text').length } : null; }""" % GD
    before = page.evaluate(BAR, B)
    assert before and before["drawn"] > 0, before                      # the large plot's colour bar is drawn
    _menu(page, B, "legend")
    page.select_option(f"#colorbar-position-{B}", "bottom")
    _slide(page, f"#colorbar-length-{B}", 50)
    _change(page, f"#colorbar-ticks-{B}", 3)
    after = page.evaluate(BAR, B)
    assert after and after["drawn"] > 0, after                         # still drawn
    assert (after["orientation"], after["len"], after["nticks"]) == ("h", 0.5, 3), after     # and the options apply to it
    assert after["x"] != before["x"]
    # a preset and Apply to other panels
    _menu(page, A, "presets")
    page.click(f"#preset-publication-{A}")
    page.wait_for_timeout(800)
    _menu(page, A, "apply")
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showgrid === false" % GD, arg=B, timeout=15000)
    page.wait_for_timeout(800)
    # both still drawn, still large
    for pid in (A, B):
        assert page.evaluate("(id) => !!(%s)(id).__isLarge && (%s)(id).data.some(t => t.x && t.x.length > 0)" % (GD, GD), pid)
