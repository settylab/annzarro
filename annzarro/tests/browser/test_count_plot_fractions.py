"""V1b (aggregation-unify-080.md 15) in a real browser: the Count Plot's shares are fractions (0 to 1), Filled bars reach 1, the
measure's statistic is the shared aggregation button with the table's entries, its threshold follows a Cell Grouping's Expressed
above, and a link with the old `pct_above` draws on 0 to 1.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import re

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

served = cc.served
page = cc.page
CC, GA, S = cc.CC, cc.GA, cc.S
GENE = {"type": "layer", "key": "X", "column": gstore.gene(3)}
POP = "[data-popover='aggregation']"


def _ticks(page):
    return page.evaluate("""(s) => { const a = document.querySelector(s + ' .ccnt-plot').layout.yaxis; return { format: a.tickformat, title: a.title.text }; }""", S)


def _share(page, served, **extra):
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION, value={"kind": "share", "of": "x"}, **extra)})
    cc._drawn(page, "bar")


def test_a_share_axis_is_a_fraction_with_ticks_up_to_one_and_a_fraction_title(page, served):
    _share(page, served)
    got = _ticks(page)
    assert got["title"] == "Fraction within each cell_type", got
    assert "%" not in got["format"] and got["format"] == ".2~f", got
    top = page.evaluate("(s) => Math.max(...document.querySelector(s + ' .ccnt-plot').data.flatMap(t => t.y || []))", S)
    assert 0 < top <= 1
    ticks = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-plot .yaxislayer-above .ytick text')].map(t => t.textContent)", S)
    assert ticks and all(re.fullmatch(r"\d(\.\d+)?", t) for t in ticks) and max(float(t) for t in ticks) <= 1.0 + 1e-9, ticks


def test_bar_labels_and_hover_print_a_fraction(page, served):
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION, value={"kind": "share", "of": "x"}, labels="share")})
    cc._drawn(page, "bar")
    texts = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').data.flatMap(t => t.text || [])", S)
    assert texts and all(re.fullmatch(r"\d(\.\d{1,3})?", t) and 0 <= float(t) <= 1 for t in texts if t), texts
    hover = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').data[0].hovertext[0]", S)
    assert re.search(r"Fraction: \d(\.\d{1,3})?$", hover) and "%" not in hover, hover


def test_filled_bars_reach_exactly_one(page, served):
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION, arrangement="fill")})
    cc._drawn(page, "bar")
    layout = page.evaluate("(s) => { const p = document.querySelector(s + ' .ccnt-plot'); return { barnorm: p.layout.barnorm, title: p.layout.yaxis.title.text,"
                           " range: p._fullLayout.yaxis.range, suffix: p.layout.yaxis.ticksuffix || '' }; }", S)
    assert layout["barnorm"] == "fraction" and layout["suffix"] == "" and layout["title"] == "Fraction of cells in each bar", layout
    assert abs(layout["range"][1] - 1) < 1e-9, layout["range"]
    assert page.inner_text(f"{S} .ccnt-arrangement").count("Filled") == 1 and "100%" not in page.inner_text(f"{S} .ccnt-arrangement")


def test_the_measure_statistic_is_the_shared_aggregation_button_with_the_tables_entries(page, served):
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE, value={"kind": "measure"}, measure={"stat": "mean", "source": GENE, "locked": True})})
    cc._drawn(page, "bar")
    btn = f"{S} [data-row='measure'] .axis-agg-btn"
    assert page.locator(btn).count() == 1
    page.click(btn)
    page.wait_for_selector(POP)
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [role=menuitem]")].map((r) => ({
        text: r.textContent.replace(/\\s+/g, ' ').trim(), disabled: r.getAttribute('aria-disabled') === 'true' || r.disabled === true }))""")
    names = [r["text"] for r in rows]
    for want in ("mean", "fraction of cells", "mean of expressing cells", "sum", "SD", "% of total", "Mean, as z-score against all counted cells"):
        assert any(want in n for n in names), (want, names)
    z = next(r for r in rows if "z-score mean" in r["text"])
    assert z["disabled"], rows
    assert any("c⁺" in n for n in names), names
    # choosing a statistic redraws on the fraction scale
    page.click(f"{POP} [role=menuitem]:has-text('fraction of cells')")
    cc._drawn(page, "bar", "c.measure.stat === 'fraction_of_cells'")
    assert cc._plot(page)["layout"]["yaxis"]["title"]["text"] == f"Fraction of cells with {gstore.gene(3)} · X above 0"
    values = [y for t in cc._plot(page)["data"] for y in t["y"] if y is not None]
    assert values and all(0 <= v <= 1 for v in values), values


def _threshold_box(page):
    page.click(f"{S} [data-row='measure'] .axis-agg-btn")
    page.wait_for_selector(f"{POP} input[data-field='above']")
    return page.evaluate("""() => { const i = document.querySelector("[data-popover='aggregation'] input[data-field='above']"); return { value: i.value, placeholder: i.placeholder }; }""")


def test_on_a_grouping_axis_a_gene_measure_follows_the_groupings_expressed_above(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [cc.CONDITION], "detect_above": 1}
    count = cc._count(mode="bar", x={"source": {"type": "cell-group", "key": GA}}, value={"kind": "measure"},
                      measure={"stat": "fraction_of_cells", "source": GENE, "locked": True})
    cc._open(page, served, {CC: count, GA: grouping}, open_ids=(CC, GA))
    cc._drawn(page, "bar")
    sent = [r for r in cc._requests(page) if r.get("measures")]
    assert sent and all(m["above"] == 1 for r in sent for m in r["measures"]), sent
    box = _threshold_box(page)
    assert box == {"value": "", "placeholder": "auto (grouping: 1)"}, box
    # a value of the plot's own overrides it, and the request carries it
    n = len(page.calls)
    page.fill(f"{POP} input[data-field='above']", "2")
    page.press(f"{POP} input[data-field='above']", "Enter")
    until(page, "() => window.PanelManager.getPanel('%s').getConfig().measure.above === 2" % CC)
    cc._drawn(page, "bar", "c.measure.above === 2")
    assert any(m.get("above") == 2 for r in page.calls[n:] for m in r.get("measures", [])), [r.get("measures") for r in page.calls[n:]]


def test_on_an_obs_axis_the_threshold_box_is_the_plots_own(page, served):
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE, value={"kind": "measure"}, measure={"stat": "fraction_of_cells", "source": GENE, "locked": True})})
    cc._drawn(page, "bar")
    box = _threshold_box(page)
    assert box == {"value": "", "placeholder": "0"}, box


def test_an_old_link_with_pct_above_draws_on_zero_to_one(page, served):
    count = cc._count(mode="bar", x=cc.CELL_TYPE, value={"kind": "measure"}, measure={"stat": "pct_above", "source": GENE, "above": 0, "locked": True},
                      color={"min": 0, "max": 80})
    cc._open(page, served, {CC: count})
    cc._drawn(page, "bar", "c.measure && c.measure.stat === 'fraction_of_cells'")
    cfg = cc._config(page)
    assert "color" not in cfg or "max" not in cfg["color"], cfg.get("color")
    values = [y for t in cc._plot(page)["data"] for y in t["y"] if y is not None]
    assert values and all(0 <= v <= 1 for v in values), values


def test_a_groupings_next_edit_of_expressed_above_reaches_the_count_plot(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [cc.CONDITION], "detect_above": 1}
    count = cc._count(mode="bar", x={"source": {"type": "cell-group", "key": GA}}, value={"kind": "measure"},
                      measure={"stat": "fraction_of_cells", "source": GENE, "locked": True})
    cc._open(page, served, {CC: count, GA: grouping}, open_ids=(CC, GA))
    cc._drawn(page, "bar")
    n = len(page.calls)
    page.evaluate("(id) => { const p = window.PanelManager.getPanel(id); p.setConfig({ ...p.getConfig(), detect_above: 3 }); }", GA)
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().detect_above === 3", GA)
    deadline_calls = lambda: [m.get("above") for r in page.calls[n:] for m in r.get("measures", [])]  # noqa: E731
    for _ in range(100):
        if 3 in deadline_calls():
            break
        page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    assert 3 in deadline_calls(), deadline_calls()
