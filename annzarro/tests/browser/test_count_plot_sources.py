"""G-SRC2 (aggregation-unify-080.md 17) in a real browser: a Count Plot's rows pick gene signatures, gene tables and cell
groupings under layer, as a Cell Plot's axes do. The first select lists obs, obsm, obsp and layer only; the item list under
layer has the sections; a button appears only where something is aggregated (a signature's score method; a measure of a
signature has two, the statistic and the score method); a grouping has none and its layer select is disabled; a score
measure keeps the plot's own "Expressed above"; Distribution writes what the row writes; old links open to the same plot.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

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
CC, GA, SIG, S = cc.CC, cc.GA, cc.SIG, cc.S
POP = "[data-popover='aggregation']"
SCORE = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "layer": "X"}
GROUPING = {"type": "cell-group", "key": GA}
GENE = {"type": "layer", "key": "X", "column": gstore.gene(3)}
SIGNATURE = {"id": SIG, "title": "B score", "genes": [gstore.gene(i) for i in range(12)]}
GROUPING_PANEL = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [cc.CONDITION], "detect_above": 1}
HEADINGS = ["Genes", "Gene signatures", "Gene tables", "Cell groupings"]


def _row(field):
    return f"{S} [data-row='{field}']"


def _open(page, served, count, **panels):
    configs = {CC: count, GA: GROUPING_PANEL, SIG: SIGNATURE}
    configs.update(panels)
    cc._open(page, served, configs, open_ids=(CC, GA))


def _options(page, field, which):
    return page.evaluate("""([row, which]) => [...document.querySelector(row + ' select.axis-' + which + '-select').options].map(o => o.textContent)""",
                         [_row(field), which])


def _headings(page, field):
    return page.evaluate("""(row) => [...document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup')].map(g => g.label)""", _row(field))


def _items(page, field, heading):
    return page.evaluate("""([row, heading]) => { const g = [...document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup')].find(x => x.label === heading);
        return g ? [...g.querySelectorAll('option')].map(o => o.textContent) : null; }""", [_row(field), heading])


def _pick(page, field, heading, text):
    value = page.evaluate("""([row, heading, text]) => { const g = [...document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup')].find(x => x.label === heading);
        return [...g.querySelectorAll('option')].find(o => o.textContent === text).value; }""", [_row(field), heading, text])
    page.select_option(f"{_row(field)} select.axis-column-select", value)


def _stored(page, path):
    return page.evaluate("([id, path]) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), window.PanelManager.getPanel(id).getConfig())", [CC, path])


def _agg_buttons(page, field):
    return page.evaluate("""(row) => [...document.querySelectorAll(row + ' .axis-agg-btn')].map(b => ({ title: b.title, cls: b.className, label: b.textContent }))""", _row(field))


def test_no_first_select_offers_gene_score_or_cell_grouping_and_the_obs_list_has_no_groupings(page, served):
    _open(page, served, cc._count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION, value={"kind": "measure"},
                                  measure={"stat": "mean", "source": GENE, "locked": True}))
    cc._drawn(page, "bar")
    for field in ("x", "split", "measure"):
        types = _options(page, field, "type")
        assert "Gene score" not in types and "Cell Grouping" not in types, (field, types)
        assert [t for t in types if t not in ("None (constant)", "—")] == ["obs", "obsm", "obsp", "layer"], (field, types)
    cc._open(page, served, {CC: cc._count(mode="heatmap", x=cc.CELL_TYPE, y=cc.CONDITION, value={"kind": "top_level", "factor": cc.CELL_TYPE}),
                            GA: GROUPING_PANEL, SIG: SIGNATURE}, open_ids=(CC, GA))
    cc._drawn(page, "heatmap")
    for field in ("x", "y", "factor"):
        types = _options(page, field, "type")
        assert "Gene score" not in types and "Cell Grouping" not in types, (field, types)
    for field in ("x", "y", "factor"):
        assert page.evaluate("(row) => [...document.querySelector(row + ' select.axis-key-select').querySelectorAll('optgroup')].map(g => g.label)", _row(field)) == [], field
    assert page.locator(f"{_row('x')} select.axis-key-select option:has-text('Groupings')").count() == 0


def test_under_layer_the_sections_are_in_order_and_the_measure_lists_no_grouping(page, served):
    _open(page, served, cc._count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION, value={"kind": "measure"},
                                  measure={"stat": "mean", "source": GENE, "locked": True}))
    cc._drawn(page, "bar")
    page.select_option(f"{_row('x')} select.axis-type-select", "layer")
    until(page, "(row) => document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup').length > 1", _row("x"))
    assert _headings(page, "x") == [h for h in HEADINGS if h != "Gene tables" or _items(page, "x", "Gene tables")]
    groupings = _items(page, "x", "Cell groupings")
    assert groupings[-1] == "New grouping…" and "Grouping 1" in groupings, groupings
    assert _items(page, "x", "Gene signatures")[-1] == "New signature…"
    # a number per cell: the measure lists the gene-side sets and no grouping
    heads = _headings(page, "measure")
    assert "Cell groupings" not in heads and heads[:2] == ["Genes", "Gene signatures"], heads


def test_a_signature_on_x_has_the_score_method_button_and_a_grouping_has_none_and_a_disabled_layer(page, served):
    _open(page, served, cc._count(mode="histogram", x={"source": SCORE}))
    cc._drawn(page, "histogram")
    buttons = _agg_buttons(page, "x")
    assert len(buttons) == 1 and buttons[0]["title"].startswith("Aggregation: Z-score mean"), buttons
    assert page.input_value(f"{_row('x')} select.axis-type-select") == "layer"
    n = len(cc._requests(page))
    page.click(f"{_row('x')} .axis-agg-btn")
    page.wait_for_selector(POP)
    names = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [role=menuitem] .axis-agg-name")].map(e => e.textContent)""")
    assert len(names) == 6 and names[0] == "Z-score mean" and "Mean" in names, names
    page.click(f"{POP} [data-agg='mean']")
    cc._drawn(page, "histogram", "c.x.source.column === 'mean'")
    assert _stored(page, "x.source.type") == "gene-score" and _stored(page, "x.source.layer") == "X"
    assert "mean" in cc._plot(page)["layout"]["xaxis"]["title"]["text"].lower()
    assert len(cc._requests(page)) >= n
    # a grouping: one bar per group, no button, the layer select disabled and saying why
    cc._open(page, served, {CC: cc._count(mode="bar", x={"source": GROUPING}, split={"source": GROUPING}), GA: GROUPING_PANEL, SIG: SIGNATURE}, open_ids=(CC, GA))
    cc._drawn(page, "bar")
    for field in ("x", "split"):
        assert _agg_buttons(page, field) == [], field
        key = f"{_row(field)} select.axis-key-select"
        assert page.is_disabled(key) and page.get_attribute(key, "title") == "A cell grouping reads no layer.", field
        assert page.input_value(f"{_row(field)} select.axis-type-select") == "layer"
    assert page.inner_text(f"{_row('x')} select.axis-column-select option:checked") == "Grouping 1"


def test_a_measure_of_a_signature_has_two_buttons_each_changing_only_its_own_step(page, served):
    _open(page, served, cc._count(mode="bar", x=cc.CELL_TYPE, value={"kind": "measure"}, measure={"stat": "mean", "source": SCORE}))
    cc._drawn(page, "bar")
    buttons = _agg_buttons(page, "measure")
    assert len(buttons) == 2, buttons
    stat, method = [b for b in buttons if "ccnt-measure-stat" in b["cls"]][0], [b for b in buttons if "ccnt-measure-stat" not in b["cls"]][0]
    assert stat["title"].startswith("Statistic over each bar's cells: mean"), stat
    assert method["title"] == "Aggregation over B score's genes: Z-score mean", method
    # the statistic is the first step of the line, before the source
    order = page.evaluate("""(row) => { const r = document.querySelector(row);
        return [[...r.children[0].children].map(c => c.classList.contains('ccnt-measure-stat') ? 'stat' : c.tagName === 'LABEL' ? 'label' : 'other'),
                r.children[1].className.includes('axis-selector')]; }""", _row("measure"))
    assert order == [["stat", "label"], True], order
    n = len(cc._requests(page))
    page.click(f"{_row('measure')} .ccnt-measure-stat")
    page.wait_for_selector(POP)
    page.click(f"{POP} [data-agg='sum']")
    cc._drawn(page, "bar", "c.measure.stat === 'sum'")
    assert len(cc._requests(page)) == n, "the statistic is read from the same moments: no request"
    page.click(f"{_row('measure')} .axis-selector .axis-agg-btn")
    page.wait_for_selector(POP)
    page.click(f"{POP} [data-agg='mean']")
    cc._drawn(page, "bar", "c.measure.source.column === 'mean'")
    assert len(cc._requests(page)) == n + 1, "a new score method is one request"
    assert _stored(page, "measure.stat") == "sum" and _stored(page, "measure.source.column") == "mean"


def test_distribution_writes_what_the_row_writes(page, served):
    cc._open(page, served, {CC: cc._count(mode="histogram", x=cc.CELL_TYPE), GA: GROUPING_PANEL, SIG: SIGNATURE}, open_ids=(CC, GA, SIG))
    page.wait_for_selector(f'.tile[data-tile-id="{SIG}"] [data-distribution]', timeout=30000)
    page.click(f'.tile[data-tile-id="{SIG}"] [data-distribution]')
    until(page, "(own) => window.PanelManager.getAllPanels().some(p => p.getType() === 'cell-count' && p.getId() !== own)", CC)
    opened = page.evaluate("""(own) => { const p = window.PanelManager.getAllPanels().find(q => q.getType() === 'cell-count' && q.getId() !== own);
        return { id: p.getId(), config: p.getConfig() }; }""", CC)
    source = opened["config"]["x"]["source"]
    assert opened["config"]["mode"] == "histogram"
    assert source == {"type": "gene-score", "key": SIG, "column": "zscore_mean", "layer": "X"}, source
    tile = f'.tile[data-tile-id="{opened["id"]}"]'
    page.wait_for_selector(f"{tile} [data-row='x'] .axis-agg-btn", timeout=30000)
    assert page.input_value(f"{tile} [data-row='x'] select.axis-type-select") == "layer"
    assert page.input_value(f"{tile} [data-row='x'] select.axis-key-select") == "X"
    assert page.inner_text(f"{tile} [data-row='x'] select.axis-column-select option:checked") == "B score"
    assert page.inner_text(f"{tile} [data-row='x'] .axis-agg-btn").strip() != ""
    # picking the same set in the Count Plot's own row stores the same source
    page.select_option(f"{_row('x')} select.axis-type-select", "layer")
    until(page, "(row) => document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup').length > 1", _row("x"))
    _pick(page, "x", "Gene signatures", "B score")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return c.x.source.type === 'gene-score'; }", CC)
    assert _stored(page, "x.source") == source


def test_a_grouping_axis_with_a_gene_measure_follows_expressed_above_and_a_signature_measure_does_not(page, served):
    count = cc._count(mode="bar", x={"source": GROUPING}, value={"kind": "measure"},
                      measure={"stat": "fraction_of_cells", "source": GENE, "locked": True})
    _open(page, served, count)
    cc._drawn(page, "bar")
    sent = [r for r in cc._requests(page) if r.get("measures")]
    assert sent and all(m["above"] == 1 for r in sent for m in r["measures"]), sent
    page.click(f"{_row('measure')} .ccnt-measure-stat")
    page.wait_for_selector(f"{POP} input[data-field='above']")
    assert page.get_attribute(f"{POP} input[data-field='above']", "placeholder") == "auto (grouping: 1)"
    page.keyboard.press("Escape")
    # a score is displayed under layer but stored with its own type: the grouping's Expressed above is a gene's, not a score's
    count = cc._count(mode="bar", x={"source": GROUPING}, value={"kind": "measure"}, measure={"stat": "fraction_of_cells", "source": SCORE})
    _open(page, served, count)
    cc._drawn(page, "bar")
    sent = [r for r in cc._requests(page) if r.get("measures")]
    assert sent and all(not m.get("above") for r in sent[-1:] for m in r["measures"]), sent[-1:]
    page.click(f"{_row('measure')} .ccnt-measure-stat")
    page.wait_for_selector(f"{POP} input[data-field='above']")
    assert page.get_attribute(f"{POP} input[data-field='above']", "placeholder") == "0"


def test_a_link_with_a_score_x_a_grouping_colour_and_a_score_measure_opens_the_same_and_an_unrelated_edit_keeps_the_config(page, served):
    count = cc._count(mode="bar", x={"source": SCORE, "binning": {"method": "equal_width", "bins": 5}}, split={"source": GROUPING},
                      value={"kind": "measure"}, measure={"stat": "mean", "source": {**SCORE, "column": "mean"}})
    _open(page, served, count)
    cc._drawn(page, "bar")
    before = cc._config(page)
    assert before["x"]["source"] == SCORE and before["split"]["source"] == GROUPING and before["measure"]["source"]["column"] == "mean"
    for field in ("x", "split", "measure"):
        assert page.input_value(f"{_row(field)} select.axis-type-select") == "layer", field
    page.select_option(f"{S} .ccnt-labels", "count")
    cc._drawn(page, "bar", "c.labels === 'count'")
    after = cc._config(page)
    for key in ("x", "split", "measure"):
        assert json.dumps(after[key], sort_keys=True) == json.dumps(before[key], sort_keys=True), key


def test_switching_x_from_a_signature_to_obs_leaves_no_method_or_layer_and_the_plot_draws(page, served):
    _open(page, served, cc._count(mode="bar", x={"source": SCORE}, split=cc.CONDITION))
    cc._drawn(page, "bar")
    page.select_option(f"{_row('x')} select.axis-type-select", "obs")
    page.select_option(f"{_row('x')} select.axis-key-select", "cell_type")
    cc._drawn(page, "bar", "c.x.source.key === 'cell_type'")
    source = _stored(page, "x.source")
    assert source == {"type": "obs", "key": "cell_type"}, source
    assert page.locator(f"{_row('x')} .axis-agg-btn").count() == 0


def test_split_by_another_column_on_a_layer_row_opens_the_item_list_with_groupings_over_the_cap_greyed_in_their_section(page, served):
    # a 2D histogram colours up to 8 levels: Color by Grouping 2 with 12 kept levels is refused before any request
    big = {"id": "cell-grouping-B", "title": "Grouping 2", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "sample"}}]}
    count = cc._count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}},
                      split={"source": {"type": "cell-group", "key": "cell-grouping-B"}, "levels": [f"category:g{i}" for i in range(12)]})
    _open(page, served, count, **{"cell-grouping-B": big})
    until(page, "(s) => { const b = document.querySelector(s + ' .ccnt-state'); return !!b && !b.hidden; }", S)
    assert "Split by another column ▾" in page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-state-box button')].map(b => b.textContent)", S)
    # a grouping's groups are known once it was read: say so for the grouping that has them
    page.evaluate("""async () => { const R = await import('/static/js/utils/source-registry.js');
        R.getSource('cell-group').aggregate.levelCount = (id) => (id === 'cell-grouping-B' ? 30 : id === 'cell-grouping-G' ? 2 : null); }""")
    page.click(f"{S} .ccnt-state-box button:has-text('Split by another column')")
    until(page, """(row) => [...document.querySelector(row + ' select.axis-column-select').options].some(o => o.disabled)""", _row("split"))
    groups = page.evaluate("""(row) => Object.fromEntries([...document.querySelector(row + ' select.axis-column-select').querySelectorAll('optgroup')]
        .map(g => [g.label, [...g.querySelectorAll('option')].map(o => [o.textContent, o.disabled])]))""", _row("split"))
    assert groups["Cell groupings"] == [["Grouping 2 (closed): 30 levels, at most 8", True], ["Grouping 1", False], ["New grouping…", False]], groups
    # choosing one that fits is the row's ordinary change: one step, and the plot draws
    _pick(page, "split", "Cell groupings", "Grouping 1")
    cc._drawn(page, "hist2d", "c.split && c.split.source.key === '%s'" % GA)
