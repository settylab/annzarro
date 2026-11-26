"""G-SRC3 (aggregation-unify-080.md 16/17): the Venn / UpSet condition editor picks like a Count Plot row. Its first select is
obs, obsm, obsp and layer; a signature or gene table is picked under layer (a number per cell); a grouping is no number, so
none is listed and the obs list has no "Groupings" shortcut ("in a group" is its own set kind).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
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
DRAFT = "[data-popover='set-definition']"
SIGNATURE = {"id": SIG, "title": "B score", "genes": [gstore.gene(i) for i in range(12)]}
GROUPING = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [cc.CONDITION]}


def _condition(page, served):
    cc._open(page, served, {CC: cc._count(mode="venn"), GA: GROUPING, SIG: SIGNATURE}, open_ids=(CC, GA))
    until(page, "(s) => document.querySelector(s + ' .ccnt-sets') && !document.querySelector(s + ' .ccnt-sets').hidden", S)
    page.select_option(f"{S} .ccnt-sets__add", "condition")
    page.wait_for_selector(f"{DRAFT} .axis-type-select option[value='layer']", state="attached")


def test_the_condition_first_select_has_no_gene_score_or_cell_grouping_and_the_obs_list_no_groupings(page, served):
    _condition(page, served)
    types = page.eval_on_selector_all(f"{DRAFT} .axis-type-select option", "els => els.map(e => e.textContent)")
    assert "Gene score" not in types and "Cell Grouping" not in types and [t for t in types if t != "—"] == ["obs", "obsm", "obsp", "layer"], types
    page.select_option(f"{DRAFT} .axis-type-select", "obs")
    assert page.locator(f"{DRAFT} .axis-key-select optgroup").count() == 0
    assert page.locator(f"{DRAFT} .axis-key-select option:has-text('Grouping 1')").count() == 0


def test_a_signature_is_a_condition_under_layer_and_a_grouping_is_not_listed(page, served):
    _condition(page, served)
    page.select_option(f"{DRAFT} .axis-type-select", "layer")
    until(page, "(d) => document.querySelector(d + ' .axis-column-select').querySelectorAll('optgroup').length > 1", DRAFT)
    heads = page.eval_on_selector_all(f"{DRAFT} .axis-column-select optgroup", "els => els.map(g => g.label)")
    assert "Gene signatures" in heads and "Cell groupings" not in heads, heads
    value = page.evaluate("""(d) => [...document.querySelectorAll(d + ' .axis-column-select option')].find(o => o.textContent === 'B score').value""", DRAFT)
    page.select_option(f"{DRAFT} .axis-column-select", value)
    page.wait_for_selector(f"{DRAFT} .axis-agg-btn")
    page.select_option(f"{DRAFT} select[data-field='op']", ">")
    page.fill(f"{DRAFT} input[data-field='value']", "0")
    page.press(f"{DRAFT} input[data-field='value']", "Enter")
    until(page, f"() => (window.PanelManager.getPanel('{CC}').getConfig().sets || []).length === 1")
    source = cc._config(page)["sets"][0]["source"]
    assert source["type"] == "gene-score" and source["key"] == SIG and source["column"] == "zscore_mean", source
