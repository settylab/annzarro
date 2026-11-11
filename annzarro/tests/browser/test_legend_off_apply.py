"""Apply to other panels carries a legend that is off, with its columns, to the other plot."""
from annzarro.tests.browser import test_plot_options as O
from annzarro.tests.browser.test_plot_options import server, page  # noqa: F401

SET = """([id, on]) => { const box = document.getElementById('show-legend-' + id);
    box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); }"""


def test_apply_to_other_panels_carries_legend_off_with_columns(page, server):
    A, B = O.A, O.B
    cfgs = O._cfgs(extra_a={"legendColumns": 2}, extra_b={"color": {"type": "obs", "key": "cell_type", "column": ""}})
    O._open(page, server, cfgs)
    count = "(id) => (%s)(id).querySelectorAll('g.legend g.traces, g.legend2 g.traces, g.legend3 g.traces').length" % O.GD
    assert page.evaluate(count, B) > 0
    O._menu(page, A, "legend")
    page.evaluate(SET, [A, False])
    page.wait_for_timeout(1500)
    assert page.evaluate(count, A) == 0
    O._menu(page, A, "apply")
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id).layout.showlegend === false" % O.GD, arg=B, timeout=15000)
    page.wait_for_timeout(2000)
    assert page.evaluate(count, B) == 0
    assert page.evaluate("(id) => (%s)(id).querySelectorAll('g.legend, g.legend2').length" % O.GD, B) == 0
