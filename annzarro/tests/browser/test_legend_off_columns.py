"""Legend off with several columns: every column legend goes, with its title note and the room it took; on again brings them back."""
import pytest

from annzarro.tests.browser.test_legend_columns import (  # noqa: F401
    TILE, LINEAGES, server, page, _open, _read, _settled, _link,
)

VISIBLE = """(sel) => { const gd = document.querySelector(sel);
    const legends = [...gd.querySelectorAll('g.legend, g.legend2, g.legend3, g.legend4')].filter(g => g.querySelector('g.traces') || g.querySelector('rect.bg'));
    const fl = gd._fullLayout;
    const note = (gd.layout.annotations || []).filter(a => a && a.name === 'az-legend-title').length;
    return { legends: legends.length, note, plotW: fl._size.w, mr: fl._size.r, ml: fl._size.l, showlegend: gd.layout.showlegend,
             meta: gd.layout.meta, noteDom: gd.querySelectorAll('.annotation').length }; }"""

SET = """([id, on]) => { const box = document.getElementById('show-legend-' + id);
    box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); }"""


def _toggle(page, on):
    page.evaluate(SET, ["cell-plot-M", on])
    page.wait_for_timeout(2500)


def _menu(page):
    page.click("#aesthetics-menu-btn-cell-plot-M")
    page.wait_for_selector("details[data-panel='cell-plot-M']", state="visible")
    page.click("details[data-panel='cell-plot-M'][data-section='legend'] summary")
    page.wait_for_timeout(300)


@pytest.mark.parametrize("columns,align", [(2, None), (3, None), (2, "centre")])
def test_off_hides_every_column_and_on_brings_them_back(page, server, columns, align):
    extra = {"legendTitleAlign": align} if align else {}
    _open(page, server, columns, **extra)
    on = page.evaluate(VISIBLE, TILE)
    assert on["legends"] == columns, on
    _menu(page)
    _toggle(page, False)
    off = page.evaluate(VISIBLE, TILE)
    assert off["legends"] == 0, off
    assert off["note"] == 0, off
    assert off["plotW"] > on["plotW"] + 20, (on, off)
    _toggle(page, True)
    _settled(page, columns)
    back = page.evaluate(VISIBLE, TILE)
    assert back["legends"] == columns, back
    assert abs(back["plotW"] - on["plotW"]) < 3, (on, back)
    assert back["note"] == on["note"], (on, back)


from annzarro.tests.browser.test_legend_columns import EXPORT  # noqa: E402

CSEL = '.tile[data-tile-id="cell-plot-M"] .axis-key-select[data-axis="color"]'
LEGEND_NODES = "(sel) => document.querySelector(sel).querySelectorAll('g.legend, g.legend2, g.legend3, g.legend4').length"


def _open_off(page, server, columns, **extra):
    """A link with the legend off and `columns` columns saved."""
    root, store = server
    page.goto(_link(root, store, legendColumns=columns, showLegend=False, **extra))
    page.wait_for_function("(sel) => { const g = document.querySelector(sel); return !!g && !!g._fullLayout && g.data.length > 5; }", arg=TILE, timeout=60000)
    page.wait_for_timeout(3000)


@pytest.mark.parametrize("columns", [2, 3])
def test_a_link_with_the_legend_off_opens_with_no_legend_and_on_brings_the_columns(page, server, columns):
    _open_off(page, server, columns)
    off = page.evaluate(VISIBLE, TILE)
    assert off["legends"] == 0 and off["note"] == 0 and not page.evaluate(LEGEND_NODES, TILE), off
    assert not page.evaluate("(sel) => !!document.querySelector(sel).layout.legend2", TILE)
    _menu(page)
    _toggle(page, True)
    _settled(page, columns)
    assert page.evaluate(VISIBLE, TILE)["legends"] == columns


def test_an_export_with_the_legend_off_has_no_legend(page, server):
    _open(page, server, 2)
    _menu(page)
    _toggle(page, False)
    for how in ("full", "shown"):
        r = page.evaluate(EXPORT, [TILE, how, 1200, 600])
        assert r["boxes"] == [], r
    svg = page.evaluate("""async (sel) => { const { exportImageData } = await import('/static/js/utils/plot-export.js');
        return await exportImageData(document.querySelector(sel), 'full', { format: 'svg', width: 1200, height: 600, scale: 1 }); }""", TILE)
    assert "az-legend-title" not in svg and 'class="legend' not in svg


def test_continuous_colour_and_back_keeps_the_columns(page, server):
    _open(page, server, 2)
    page.select_option(CSEL, "total_counts")
    page.wait_for_function("(sel) => { const g = document.querySelector(sel); return !!g._fullLayout && !g.querySelector('g.legend g.traces'); }", arg=TILE, timeout=30000)
    page.wait_for_timeout(2500)
    cont = page.evaluate(VISIBLE, TILE)
    assert cont["legends"] == 0 and cont["note"] == 0, cont
    page.select_option(CSEL, "lineage")
    _settled(page, 2)
    assert page.evaluate(VISIBLE, TILE)["legends"] == 2

