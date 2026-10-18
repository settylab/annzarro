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


# the widest legend entry: its symbol and its label
WIDEST = """(id) => Math.max(...[...(%s)(id).querySelectorAll('.legend g.traces')].map(g => g.getBoundingClientRect().width))""" % GD
# which categories' points are drawn: the visible point traces, by legend group
SHOWN = """(id) => { const gd = (%s)(id); return gd.data.filter(t => t.meta === 'az-points' || (t.legendgroup && t.showlegend === false && t.meta !== 'az-legend'))
    .filter(t => t.visible !== 'legendonly').map(t => t.legendgroup).sort(); }""" % GD
ENTRIES = """(id) => [...(%s)(id).querySelectorAll('.legend g.traces')].map(g => g.getBoundingClientRect())""" % GD


def _title_above(page, pid=A):
    """The legend's title lies above its first entry, not beside it."""
    page.wait_for_function("(id) => !!(%s)(id).querySelector('.legend .legendtitletext')" % GD, arg=pid)
    t = page.evaluate("(id) => { const gd = (%s)(id); const t = gd.querySelector('.legend .legendtitletext').getBoundingClientRect();"
                      " const e = Math.min(...[...gd.querySelectorAll('.legend g.traces')].map(g => g.getBoundingClientRect().y));"
                      " return { bottom: t.bottom, entry: e }; }" % GD, pid)
    assert t["bottom"] <= t["entry"] + 4, t


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
    # compact: the columns are as far apart as two (not more) need, not stretched over the page
    xs = sorted({i["x"] for i in two["items"]})
    assert xs[1] - xs[0] <= page.evaluate(WIDEST, A) + 40, (two, page.evaluate(WIDEST, A))
    assert two["rows"] == -(-n // 2) and two["columns"] == 2, two
    _title_above(page)
    assert {i["dot"] for i in two["items"]} == {16}, two                     # the dot size stays
    _change(page, f"#legend-columns-{A}", 3)
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === %d" % (GD, min(3, n)), arg=A, timeout=15000)
    # the legend moves with its position, and keeps the columns
    for position in ("bottom", "top", "left", "right"):
        page.select_option(f"#legend-position-{A}", position)
        page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === %d" % (GD, min(3, n)), arg=A, timeout=15000)
        page.wait_for_timeout(600)
        _title_above(page)
    # a click on an entry hides that category's points alone, not its column's; a double click isolates it
    cats = page.evaluate(SHOWN, A)
    assert len(cats) >= 3 and not any(c.startswith("azcol") for c in cats), cats
    r = page.evaluate(ENTRIES, A)[0]
    page.mouse.click(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    page.wait_for_function("([id, n]) => (%s)(id).data.filter(t => t.meta === 'az-points' && t.visible !== 'legendonly').length === n" % GD, arg=[A, len(cats) - 1], timeout=15000)
    page.mouse.click(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    page.wait_for_function("([id, n]) => (%s)(id).data.filter(t => t.meta === 'az-points' && t.visible !== 'legendonly').length === n" % GD, arg=[A, len(cats)], timeout=15000)
    page.mouse.dblclick(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    page.wait_for_function("([id]) => (%s)(id).data.filter(t => t.meta === 'az-points' && t.visible !== 'legendonly').length === 1" % GD, arg=[A], timeout=15000)
    page.mouse.dblclick(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    page.wait_for_function("([id, n]) => (%s)(id).data.filter(t => t.meta === 'az-points' && t.visible !== 'legendonly').length === n" % GD, arg=[A, len(cats)], timeout=15000)
    # 2 -> 1 with the spinner: the single vertical column again (a click on the plot closed the menu)
    _menu(page, A, "legend")
    _change(page, f"#legend-columns-{A}", 2)
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === 2" % GD, arg=A, timeout=15000)
    page.focus(f"#legend-columns-{A}")
    page.keyboard.press("ArrowDown")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.legend.orientation === 'v' && !(%s)(id).layout.legend.entrywidth" % (GD, GD), arg=A, timeout=15000)
    one = _legend(page)
    assert one["columns"] == 1 and one["rows"] == n and _settings(page, A)["legendColumns"] is None, one
    assert page.input_value(f"#legend-columns-{A}") == "1"
    _change(page, f"#legend-columns-{A}", 3)
    page.wait_for_function("(id) => new Set([...(%s)(id).querySelectorAll('.legend g.traces')].map(g => Math.round(g.getBoundingClientRect().x))).size === %d" % (GD, min(3, n)), arg=A, timeout=15000)
    # the title
    page.uncheck(f"#show-legend-title-{A}")
    page.wait_for_function("(id) => !(%s)(id).querySelector('.legend .legendtitletext') || !(%s)(id).querySelector('.legend .legendtitletext').textContent" % (GD, GD), arg=A)
    # the options travel with the panel
    s = _settings(page, A)
    assert (s["legendDotSize"], s["legendColumns"], s["showLegendTitle"]) == (16, 3, False), s
    # Reset puts both boxes back to today's legend; at the default there is nothing to reset
    page.click(f"#reset-legend-dot-size-{A}")
    page.click(f"#reset-legend-columns-{A}")
    assert page.input_value(f"#legend-dot-size-{A}") == "" and page.input_value(f"#legend-columns-{A}") == ""
    assert page.is_disabled(f"#reset-legend-dot-size-{A}") and page.is_disabled(f"#reset-legend-columns-{A}")
    s = _settings(page, A)
    assert (s["legendDotSize"], s["legendColumns"]) == (None, None), s
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


def test_text_size_has_a_reset(page, server):
    _open(page, server)
    _menu(page, A, "text")
    assert page.is_disabled(f"#reset-font-size-{A}")                       # 12 is the default
    _change(page, f"#font-size-{A}", 18)
    assert not page.is_disabled(f"#reset-font-size-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.font.size === 18" % GD, arg=A)
    page.click(f"#reset-font-size-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.font.size === 12" % GD, arg=A)
    assert page.input_value(f"#font-size-{A}") == "12" and page.is_disabled(f"#reset-font-size-{A}")
    assert _settings(page, A)["fontSize"] == 12


from annzarro.tests.browser.test_many_categories import server as many_server  # noqa: E402,F401  (the fixture)


def test_64_entries_in_columns(page, many_server):
    import base64
    import json
    from annzarro.tests.browser import test_many_categories as M
    root, store = many_server
    for columns in (4, 8):
        link = M._link(root, store, colour="clone")
        head, enc = link.split("#view=")
        view = json.loads(base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)))
        view["layout"]["panelConfigs"]["cell-plot-M"]["legendColumns"] = columns
        link = head + "#view=" + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
        page.goto(link)
        page.wait_for_function("() => document.querySelectorAll('.tile[data-tile-id=\"cell-plot-M\"] .legend g.traces').length === 64", timeout=60000)
        page.wait_for_timeout(1200)
        s = page.evaluate("""() => { const gd = document.querySelector('.tile[data-tile-id="cell-plot-M"] .js-plotly-plot');
            const r = gd.getBoundingClientRect();
            const items = [...gd.querySelectorAll('.legend g.traces')].map(g => g.getBoundingClientRect());
            return { n: items.length, left: Math.min(...items.map(i => i.left)) - r.left, right: Math.max(...items.map(i => i.right)) - r.left,
                     width: r.width, columns: new Set(items.map(i => Math.round(i.x))).size }; }""")
        assert s["n"] == 64 and s["left"] >= -1 and s["right"] <= s["width"] + 1, s     # all drawn, inside the graph
        assert s["columns"] <= columns * 2, s                                           # wraps into rows of columns, not into one row
        if columns == 4:
            assert s["columns"] == 4, s
