"""Legend options of a categorical plot: the size of the dots, the number of columns, the title.

Set in Plot Options, checked by what the legend draws: the width of each entry's symbol, and the
x position of each entry. The same on a regular plot, a 3D plot and a plot in large-plot mode
(the fixture's 200 cells against a threshold of 100 points); unset, the legend is the constant
one it always was.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_axis_title_restore import _start
from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _change, _link, _menu, _settings, page, server)

# per legend entry: the symbol's drawn width and the entry's left edge; the legend's title text
LEGEND = """(id) => { const gd = (%s)(id);
    const items = [...gd.querySelectorAll('.legend g.traces')].map(g => ({
        x: Math.round(g.getBoundingClientRect().x), y: Math.round(g.getBoundingClientRect().y),
        dot: Math.round(g.querySelector('.legendpoints path.scatterpts').getBoundingClientRect().width) }));
    const title = gd.querySelector('.legend .legendtitletext');
    return { items, title: title ? title.textContent : '', itemsizing: gd._fullLayout.legend.itemsizing,
             orientation: gd._fullLayout.legend.orientation, columns: new Set(items.map(i => i.x)).size,
             rows: new Set(items.map(i => i.y)).size, width: gd._fullLayout.width }; }""" % GD

Z = {"type": "obsm", "key": "X_umap", "column": "0"}


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def _legend(page, pid=A):
    return page.evaluate(LEGEND, pid)


def _open(page, root, extra=None):
    page.goto(_link(root, _cfgs(extra_a=extra)))
    page.wait_for_function(DRAWN, arg=B, timeout=60000)
    if extra and extra.get("z"):
        page.wait_for_function("(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd._fullLayout.scene && gd.data.length > 1); }" % GD,
                               arg=A, timeout=60000)
    else:
        page.wait_for_function(DRAWN, arg=A, timeout=60000)
    page.wait_for_timeout(1500)


def _exercise(page, root, extra=None, large=False):
    _open(page, root, extra)
    if large:
        assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, A), "not drawn in large-plot mode"
    base = _legend(page)
    n = len(base["items"])
    assert n >= 3, base
    assert base["itemsizing"] == "constant" and base["columns"] == 1 and base["title"], base       # today's legend
    assert {i["dot"] for i in base["items"]} == {12}, base
    _menu(page, A, "legend")
    # dots: independent of the points' size
    _change(page, f"#legend-dot-size-{A}", 6)
    page.wait_for_function("(id) => [...(%s)(id).querySelectorAll('.legend .scatterpts')].every(p => Math.round(p.getBoundingClientRect().width) === 6)" % GD, arg=A)
    assert _legend(page)["itemsizing"] == "trace"
    _change(page, f"#legend-dot-size-{A}", 40)                           # more than Plotly draws: 16
    page.wait_for_function("(id) => [...(%s)(id).querySelectorAll('.legend .scatterpts')].every(p => Math.round(p.getBoundingClientRect().width) === 16)" % GD, arg=A)
    # columns: a horizontal legend of two columns; the entries fill them row by row
    _change(page, f"#legend-columns-{A}", 2)
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === 2" % GD, arg=A, timeout=15000)
    two = _legend(page)
    assert two["orientation"] == "h" and two["rows"] == -(-n // 2), two
    assert {i["dot"] for i in two["items"]} == {16}, two                     # the dot size stays
    _change(page, f"#legend-columns-{A}", 3)
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === %d" % (GD, min(3, n)), arg=A, timeout=15000)
    # the legend moves with its position, and keeps the columns
    page.select_option(f"#legend-position-{A}", "bottom")
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === %d" % (GD, min(3, n)), arg=A, timeout=15000)
    page.select_option(f"#legend-position-{A}", "right")
    page.wait_for_timeout(800)
    # the title
    page.uncheck(f"#show-legend-title-{A}")
    page.wait_for_function("(id) => !(%s)(id).querySelector('.legend .legendtitletext') || !(%s)(id).querySelector('.legend .legendtitletext').textContent" % (GD, GD), arg=A)
    # the options travel with the panel
    s = _settings(page, A)
    assert (s["legendDotSize"], s["legendColumns"], s["showLegendTitle"]) == (16, 3, False), s
    # emptied, back to today's legend
    _change(page, f"#legend-dot-size-{A}", "")
    _change(page, f"#legend-columns-{A}", "")
    page.check(f"#show-legend-title-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.legend.itemsizing === 'constant' && !(%s)(id).layout.legend.entrywidth" % (GD, GD), arg=A, timeout=15000)
    page.wait_for_timeout(800)
    back = _legend(page)
    assert back["columns"] == 1 and back["title"] == base["title"] and {i["dot"] for i in back["items"]} == {12}, back
    return n


def test_dots_columns_and_title_on_a_regular_plot(page, server):
    _exercise(page, server)


def test_dots_columns_and_title_on_a_3d_plot(page, server):
    _exercise(page, server, extra={"z": Z, "equalAspect": False})


def test_dots_columns_and_title_in_large_plot_mode(page, large_server):
    _exercise(page, large_server, large=True)


def test_the_options_in_a_link_draw_the_first_legend(page, server):
    _open(page, server, {"legendDotSize": 7, "legendColumns": 2, "showLegendTitle": False})
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === 2" % GD, arg=A, timeout=15000)
    lg = _legend(page)
    assert {i["dot"] for i in lg["items"]} == {7} and lg["title"] == "" and lg["orientation"] == "h", lg
