"""Statistics offered in the Cell Grouping panel, in a real browser, against the real cell_groups route (G9d).

The store is the grouping fixture (tests/core/grouping_store.py): X is scaled (it has negative values), `logged` is
log-normalised, `counts` holds counts.

1.  Closed, the button states the defaults (in its title and label), mean and % expressing on X, and a default grouping
    stores nothing (GRP-9, SHR-26).
2.  Open (a pop-over, FB-2 decision h), every statistic is defined, the threshold sits once at the top, and cell count is always offered. X is always
    offered: its box cannot be switched off.
3.  A signed X: the sentence of SHR-27 under % expressing and the layer's row says which statistics are not available.
4.  Picking a layer is one undoable step; the recipe stores the layer and the default is not stored.
5.  The threshold is checked as typed, and a reset restores every default in one step.
6.  "Used by" counts consumers by kind, per statistic and per layer; viewers are not counted; switching off a statistic in
    use says who keeps it, and Undo brings it back.
7.  A link carries the options and reopens with them; an edit asks the server for nothing.
8.  Screenshots, light and dark (when SHOTS is set).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, CELL_TYPE, GA, _grouping, _open, _ready, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TOG = f"{A} .gsig-scoring__toggle"                 # the toolbar button: Statistics ▾
POP = "[data-popover='statistics']"                # its pop-over, in the page's one pop-over layer
SEC = f"{POP} .gsig-scoring"                       # what the pop-over holds: the section's body
SIGNED = "% expressing is not available on X: X has negative values. Choose a layer."


def _cfg(**extra):
    return {GA: _grouping(partitionings=[CELL_TYPE], **extra)}


def _recipe(page):
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-grouping-A').getConfig()")
    return {k: cfg[k] for k in ("offered", "layers", "detect_above") if k in cfg}


def _summary(page):
    return page.inner_text(f"{A} .gsig-scoring__summary")


def _open_section(page):
    if page.get_attribute(TOG, "aria-expanded") != "true":
        page.click(TOG)
    page.wait_for_selector(f"{SEC} .gsig-scoring__body", state="visible")
    # the layers say what they look like once the server has sampled each
    until(page, """(s) => [...document.querySelectorAll(s + ' .gsig-scoring__layer')]
        .every(l => l.querySelector('.gsig-scoring__kind'))""", SEC)


def _kinds(page):
    return page.evaluate("""(s) => Object.fromEntries([...document.querySelectorAll(s + ' .gsig-scoring__layer')]
        .map(l => [l.dataset.layer, (l.querySelector('.gsig-scoring__kind') || {}).textContent]))""", SEC)


def _undo_label(page):
    return page.get_attribute(f"{A} .cgrp-undo", "title")


def test_collapsed_it_states_the_defaults_and_a_default_grouping_stores_nothing(page, served):
    _open(page, served, _cfg())
    _ready(page)
    assert page.inner_text(f"{A} .gsig-scoring__label") == "Statistics"
    assert _summary(page) == "mean, % expressing · X"
    assert page.get_attribute(TOG, "aria-label") == "Statistics offered: mean, % expressing · X"
    assert page.get_attribute(TOG, "title") == "mean, % expressing · X"
    assert page.locator(POP).count() == 0, "closed, there is no body in the page"
    assert _recipe(page) == {}, "nothing about the options is stored until it differs from the default"
    assert page.query_selector(f"{A} .cgrp-statistics .gsig-scoring") is not None, "it sits in the statistics zone"


def test_open_it_defines_every_statistic_and_always_offers_cell_count_and_x(page, served):
    _open(page, served, _cfg())
    _ready(page)
    _open_section(page)
    assert page.inner_text(f"{POP} .az-popover-title") == "Statistics offered"
    assert page.inner_text(f"{SEC} fieldset:first-of-type legend") == "Statistics"
    names = page.eval_on_selector_all(f"{SEC} [data-method] .gsig-scoring__optionname", "els => els.map(e => e.textContent)")
    assert names == ["Mean", "% expressing", "Mean of expressing cells", "Sum", "SD"]
    for stat in ("mean", "pct_expressing", "mean_expressing", "sum", "sd"):
        assert len(page.inner_text(f"{SEC} [data-method='{stat}'] .gsig-scoring__definition")) > 20, stat
    checked = page.eval_on_selector_all(f"{SEC} [data-offer-method]:checked", "els => els.map(e => e.dataset.offerMethod)")
    assert checked == ["mean", "pct_expressing"]
    assert "Cell count is always offered." in page.inner_text(f"{SEC} .gsig-scoring__body")
    assert page.inner_text(f"{SEC} .gsig-scoring__help[data-aggregations-help]") == "Plots pick from these. Nothing is computed until a plot shows it."
    # X is always offered
    assert page.is_checked(f"{SEC} [data-layer-offer='X']") and page.is_disabled(f"{SEC} [data-layer-offer='X']")
    assert page.get_attribute(f"{SEC} [data-layer-offer='X']", "title") == "X is always offered."
    assert [k for k in _kinds(page)][:1] == ["X"]
    assert _kinds(page) == {"X": "scaled", "logged": "log-normalized", "counts": "counts"}
    # the threshold sits once, at the top, above both statistics that use it
    box = f"{SEC} [data-threshold] [data-param='detect']"
    assert page.input_value(box) == "0"
    above = page.evaluate("""(s) => { const t = document.querySelector(s + ' [data-threshold]');
        const m = document.querySelector(s + ' [data-method]');
        return !!(t.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING); }""", SEC)
    assert above
    assert page.query_selector(f"{SEC} [data-method] [data-param='detect']") is None, "not repeated under each statistic"
    assert "% expressing and mean of expressing cells" in page.inner_text(f"{SEC} [data-threshold-help]")
    assert page.is_disabled(f"{SEC} .gsig-scoring__reset"), "nothing to reset"


def test_on_a_signed_x_the_sentence_of_shr27_is_said_and_those_statistics_are_left_out(page, served):
    _open(page, served, _cfg())
    _ready(page)
    _open_section(page)
    assert page.inner_text(f"{SEC} [data-method='pct_expressing'] .gsig-scoring__grade") == f"⚠ {SIGNED}"
    assert page.query_selector(f"{SEC} [data-method='mean'] .gsig-scoring__grade") is None
    row = page.inner_text(f"{SEC} .gsig-scoring__layer[data-layer='X'] .gsig-inputwarn")
    assert row == "⚠ % expressing and mean of expressing cells are not available on X: X has negative values."
    # the options a consumer may pick leave them out, with the reason on the graded list
    graded = page.evaluate("""async () => {
        const m = await import('/static/js/utils/group-statistics.js');
        const options = m.GROUP_STATISTICS_MODEL.gradedOptions({ offered: ['mean', 'pct_expressing', 'sum'] }, ['X'], { X: 'signed' });
        return { menu: m.GROUP_STATISTICS_MODEL.offeredOptions({ offered: ['mean', 'pct_expressing', 'sum'] }, ['X'], { X: 'signed' }).map(o => o.id),
                 reason: options.find(o => o.method === 'pct_expressing').reason,
                 size: m.sizeDefault({}, { X: 'signed' }), picked: m.sizeDefault({ layers: ['logged'] }, { X: 'signed', logged: 'log' }, 'logged') };
    }""")
    assert graded["menu"] == ["mean@X", "sum@X"]
    assert graded["reason"] == SIGNED
    assert graded["size"] == {"stat": None, "layer": None, "say": SIGNED, "pending": False}, "no size until a layer is picked"
    assert graded["picked"]["stat"] == "pct_expressing" and graded["picked"]["layer"] == "logged"


def test_picking_a_layer_is_one_undoable_step_and_the_default_is_not_stored(page, served):
    _open(page, served, _cfg())
    _ready(page)
    _open_section(page)
    page.check(f"{SEC} [data-layer-offer='logged']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().layers || []).join() === 'logged'")
    assert _recipe(page) == {"layers": ["logged"]}, "X is implied and not stored"
    assert _summary(page) == "mean, % expressing · X, logged"
    assert _undo_label(page) == "Undo: layers offered"
    # the signed X still says so on its own row, and the sentence is no longer under the method (it is true of one layer)
    assert "negative values" in page.inner_text(f"{SEC} .gsig-scoring__layer[data-layer='X'] .gsig-inputwarn")
    assert page.query_selector(f"{SEC} [data-method='pct_expressing'] .gsig-scoring__grade") is None
    page.uncheck(f"{SEC} [data-layer-offer='logged']")
    until(page, "() => !('layers' in window.PanelManager.getPanel('cell-grouping-A').getConfig())")
    assert _summary(page) == "mean, % expressing · X"
    page.click(f"{A} .cgrp-undo")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().layers || []).join() === 'logged'")
    page.click(f"{A} .cgrp-undo")
    until(page, "() => !('layers' in window.PanelManager.getPanel('cell-grouping-A').getConfig())")
    assert _summary(page) == "mean, % expressing · X"


def test_statistics_are_offered_and_withdrawn_one_step_each_and_the_last_one_stays(page, served):
    _open(page, served, _cfg())
    _ready(page)
    _open_section(page)
    page.check(f"{SEC} [data-offer-method='sum']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'mean,pct_expressing,sum'")
    assert _summary(page) == "mean, % expressing, sum · X"
    page.uncheck(f"{SEC} [data-offer-method='pct_expressing']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'mean,sum'")
    page.uncheck(f"{SEC} [data-offer-method='mean']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'sum'")
    assert page.is_disabled(f"{SEC} [data-offer-method='sum']"), "one stays offered"
    assert _undo_label(page) == "Undo: statistics offered"
    # back to the default list: it is not stored
    page.check(f"{SEC} [data-offer-method='mean']")
    page.check(f"{SEC} [data-offer-method='pct_expressing']")
    page.uncheck(f"{SEC} [data-offer-method='sum']")
    until(page, "() => !('offered' in window.PanelManager.getPanel('cell-grouping-A').getConfig())")


def test_the_threshold_is_checked_as_typed_shared_and_restored_by_one_reset(page, served):
    _open(page, served, _cfg())
    _ready(page)
    _open_section(page)
    box = f"{SEC} [data-threshold] [data-param='detect']"
    page.fill(box, "abc")
    assert page.inner_text(f"{SEC} .gsig-scoring__error:not([hidden])") == "Enter a number from 0 up."
    page.keyboard.press("Tab")
    until(page, "(b) => document.querySelector(b).value === '0'", box)
    assert _recipe(page) == {}, "an invalid entry changes nothing"
    page.fill(box, "0.5")
    page.keyboard.press("Enter")
    page.keyboard.press("Tab")
    until(page, "() => window.PanelManager.getPanel('cell-grouping-A').getConfig().detect_above === 0.5")
    assert _summary(page) == "mean, % expressing (above 0.5) · X"
    assert "above 0.5" in page.inner_text(f"{SEC} [data-threshold-help]")
    page.check(f"{SEC} [data-offer-method='mean_expressing']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).includes('mean_expressing')")
    assert _summary(page) == "mean, % expressing (above 0.5), mean of expressing cells (above 0.5) · X", "one threshold, both statistics"
    page.check(f"{SEC} [data-layer-offer='counts']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().layers || []).join() === 'counts'")
    page.click(f"{SEC} .gsig-scoring__reset")
    until(page, "() => !['offered', 'layers', 'detect_above'].some(k => k in window.PanelManager.getPanel('cell-grouping-A').getConfig())")
    assert _summary(page) == "mean, % expressing · X"
    assert _undo_label(page) == "Undo: reset statistics offered"
    page.click(f"{A} .cgrp-undo")
    until(page, "() => window.PanelManager.getPanel('cell-grouping-A').getConfig().detect_above === 0.5")
    assert _recipe(page)["layers"] == ["counts"], "one undo brings the whole reset back"


PICK = """() => { // what a plot or table choosing a source does: a select changes, and the panel counts its users again
    const s = document.createElement('select'); document.body.append(s); s.dispatchEvent(new Event('change', { bubbles: true })); s.remove(); }"""


def _watch(page, name, kind, statistics):
    page.evaluate("""async ([name, kind, statistics, pick]) => {
        const { groupSources } = await import('/static/js/utils/group-host.js');
        window.__stat = window.__stat || {};
        window.__stat[name] = groupSources().sources.watch('cell-grouping-A', { consumer: { kind, panelId: name },
            option: { codes: true, statistics }, onChange() {} });
        (0, eval)(pick)();
    }""", [name, kind, statistics, PICK])


def _release(page, name):
    page.evaluate("(name) => { window.__stat[name].release(); delete window.__stat[name]; }", name)
    page.evaluate(PICK)


def _use(page, stat):
    return page.evaluate("""([s, stat]) => { const e = document.querySelector(s + ' [data-in-use=\"' + stat + '\"]');
        return e ? e.textContent : null; }""", [SEC, stat])


def test_used_by_counts_consumers_by_kind_per_statistic_and_layer_and_not_viewers(page, served):
    _open(page, served, _cfg(offered=["mean", "pct_expressing", "sum"], layers=["logged"]))
    _ready(page)
    _open_section(page)
    assert _use(page, "mean") is None, "nothing reads it yet"
    X = {"layer": "X"}
    _watch(page, "plot-1", "plot", [{"stat": "mean", **X}, {"stat": "pct_expressing", **X}])
    _watch(page, "plot-2", "plot", [{"stat": "mean", **X}])
    _watch(page, "table-1", "table", [{"stat": "mean", "layer": "logged"}])
    _watch(page, "look", "inspect", [{"stat": "sum", **X}])
    until(page, """([s]) => { const e = document.querySelector(s + ' [data-in-use="mean"]'); return e && e.textContent === '2 plots, 1 table'; }""", [SEC])
    assert _use(page, "pct_expressing") == "1 plot"
    assert _use(page, "sum") is None, "a viewer is not a user"
    layer_use = page.eval_on_selector_all(f"{SEC} .gsig-scoring__layer", """els => Object.fromEntries(els.map(l =>
        [l.dataset.layer, (l.querySelector('.gsig-scoring__use') || {}).textContent || null]))""")
    assert layer_use == {"X": "2 plots", "logged": "1 table", "counts": None}
    # a statistic in use that is switched off is kept by its users, who are named, and Undo offers it again
    page.uncheck(f"{SEC} [data-offer-method='mean']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'pct_expressing,sum'")
    assert page.inner_text(f"{SEC} .gsig-scoring__notice:not([hidden])").startswith("mean is no longer offered. 2 plots, 1 table keep it and say so.")
    page.click(f"{SEC} .gsig-scoring__notice [data-undo]")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'mean,pct_expressing,sum'")
    _release(page, "plot-1")
    until(page, """([s]) => document.querySelector(s + ' [data-in-use="pct_expressing"]') === null""", [SEC])
    assert _use(page, "mean") == "1 plot, 1 table"
    for name in ("plot-2", "table-1", "look"):
        _release(page, name)
    until(page, """([s]) => document.querySelector(s + ' [data-in-use]') === null""", [SEC])


def test_a_link_carries_the_options_and_an_edit_asks_the_server_for_nothing(page, served):
    _open(page, served, _cfg(offered=["sum"], layers=["logged"], detect_above=2))
    _ready(page)
    assert _summary(page) == "sum · X, logged"
    _open_section(page)
    assert page.input_value(f"{SEC} [data-threshold] [data-param='detect']") == "2"
    assert page.is_checked(f"{SEC} [data-offer-method='sum']") and not page.is_checked(f"{SEC} [data-offer-method='mean']")
    asked = len(page.calls)
    page.check(f"{SEC} [data-offer-method='sd']")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().offered || []).join() === 'sum,sd'")
    waits.expect_stays(lambda: len(page.calls) == asked, "a statistic is computed from moments when a plot shows it, so offering one sends no request",
                       page=page)


@pytest.mark.skipif(not os.environ.get("G9D_SHOTS"), reason="screenshots only when G9D_SHOTS names a folder")
@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_screenshots(page, served, scheme):
    out = os.environ["G9D_SHOTS"]
    os.makedirs(out, exist_ok=True)
    page.emulate_media(color_scheme=scheme)
    _open(page, served, _cfg(offered=["mean", "pct_expressing", "sum"], layers=["logged"], detect_above=0.5))
    _ready(page)
    _open_section(page)
    page.locator(POP).screenshot(path=os.path.join(out, f"statistics-{scheme}.png"))


def test_statistics_and_the_signatures_scoring_share_one_kind_request_per_dataset_and_layer(page, served):
    sig = "gene-signature-S"
    kinds = []
    page.on("request", lambda r: kinds.append(r.url) if "/data/matrix_kind" in r.url else None)
    configs = {**_cfg(), sig: {"id": sig, "title": "Signature 1", "genes": ["GENE001", "GENE002"]}}
    _open(page, served, configs, open_ids=(GA, sig))
    page.wait_for_selector(f".tile[data-tile-id='{sig}'] .gsig-scoring")
    until(page, "() => !!document.querySelector('.tile[data-tile-id=\"gene-signature-S\"] .gsig-scoring__summary')")
    _open_section(page)
    page.click(f".tile[data-tile-id='{sig}'] .gsig-scoring__toggle")        # a click outside: the pop-over closes
    until(page, """() => [...document.querySelectorAll('.tile[data-tile-id="gene-signature-S"] .gsig-scoring__layer')]
        .every(l => l.querySelector('.gsig-scoring__kind'))""")
    for layer in ("X", "logged", "counts"):
        asked = [u for u in kinds if f"input={layer}&" in u or u.endswith(f"input={layer}")]
        assert len(asked) == 1, (layer, kinds)
