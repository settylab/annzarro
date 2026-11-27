"""The Methods pop-over of the Gene Signature panel in a real browser (decision 31, SO-2).

Nothing is "offered": a plot or table chooses any method on any layer. The signature's panel holds only the settings
of each method (the clip of z-scores, the bins, controls and seed of the control-adjusted score, the detection
threshold, and the down weighting) in a pop-over behind **Methods ▾**, on the shared pop-over primitive: it opens
without moving any box of the panel and Escape closes it. Inspect is gone; **Distribution** opens a Count Plot of the
score beside the panel.

The store is the one of test_gene_score_plots.py (60 cells, 3,000 genes, layers `counts`). The score route is the real
one except where a test needs a slow estimate.

1.  Methods ▾ opens a pop-over listing every method with its definition and parameters; Escape closes it; the panel's
    boxes do not move; there is no Scores offered section and no Inspect.
2.  Each number is checked: any positive clip or none, bins, controls, seed, the detection threshold; an invalid entry
    keeps the last valid value and says what is expected. Each method with parameters has its own Reset, and Reset to
    defaults puts the parameters back (never a method or a layer).
3.  The button says, in its title and with a dot, which parameter is not at its default.
4.  The pop-over says which methods and layers plots read.
5.  The settings are in the link and the panel set, without `offered` or `layers`, and come back from each; an old
    link with `offered` and `layers` keeps every consumer on the layer it drew.
6.  The score key changes only when it should: a clip edit recomputes only a z-score mean consumer; the seed, bins and
    controls only the control-adjusted one; a clip edit costs a plain mean no request at all.
7.  Edits of 5 seconds or more collect behind **Update score**, whatever the setting.
8.  Every layer's kind is asked once, without alternatives, for grading the consumers' choices.
9.  Distribution opens a Count Plot of the score (z-score mean of X) beside the panel.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing
Playwright is an error.
"""
import base64
import json
import urllib.parse

import pytest  # noqa: F401  (the fixtures are used by name)

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401  (the fixtures are used by name)
    C, INIT, S, SIG, SCORE, _cell, _numbers, _open, _save_set, _sig, _wait_coloured, page, served,
)
from annzarro.tests.browser.test_memory_guard import until

D = '.tile[data-tile-id="cell-plot-D"]'
E = '.tile[data-tile-id="cell-plot-E"]'
MEAN = {**SCORE, "column": "mean"}
CONTROL = {**SCORE, "column": "control_adjusted"}
POP = "[data-popover='methods']"
BUTTON = f"{S} [data-methods]"

# every recipe the page sends to the score route, in order, with what it was for
RECORD = """
const inner = window.fetch;
window.__recipes = [];
window.fetch = async (url, init) => {
  if (String(url).includes('/data/gene_score')) {
    try { const b = JSON.parse(init.body); window.__recipes.push(Object.assign({ for: b.estimate_only ? 'estimate' : 'compute' }, b.recipe)); } catch (e) { /* not ours */ }
  }
  return inner(url, init);
};
"""


@pytest.fixture
def rec(page):
    """The page records the recipes it sends (this runs after the page's own wrapper of the route)."""
    page.add_init_script(RECORD)
    return page


def _recipes(page, kind="compute"):
    return [r for r in page.evaluate("() => window.__recipes") if r["for"] == kind]


def _sel(name):
    return f"#gsig-methods-{name}-{SIG}"


def _methods(page):
    """Open the Methods pop-over (once)."""
    if page.query_selector(POP) is None:
        page.click(BUTTON)
    page.wait_for_selector(POP, state="visible")


def _enter(page, selector, text):
    page.fill(selector, text)
    page.press(selector, "Enter")


def _recipe(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)


def _wait_computes(page, n):
    until(page, "(n) => window.__scoreCalls.filter(c => c.kind === 'compute').length === n", n)


def _sig_open(page, served, **sig):
    _open(page, served, plots=(), sig=_sig(**sig), sig_open=True, wait=False)
    page.wait_for_selector(BUTTON)


def _boxes(page):
    """Where every box of the signature's panel is: what opening the pop-over must not move."""
    return page.evaluate("""(s) => [...document.querySelectorAll(s + ' .gsig-panel, ' + s + ' .gsig-panel > *')]
        .map(e => { const r = e.getBoundingClientRect(); return [e.className, r.x, r.y, r.width, r.height]; })""", S)


ALL = ["zscore_mean", "mean", "sum", "control_adjusted", "fraction_of_genes", "fraction_of_total"]


# ------------------------------------------------------------------ the pop-over

def test_methods_opens_a_popover_with_every_method_escape_closes_it_and_the_panel_does_not_move(page, served):
    _sig_open(page, served)
    assert page.inner_text(BUTTON).replace("\n", " ").strip() == "Methods ▾"
    assert page.get_attribute(BUTTON, "aria-haspopup") == "dialog"
    assert page.query_selector(f"{S} .gsig-scoring") is None, "no Scores offered section in the panel"
    assert page.query_selector(".gsig-inspect") is None, "no Inspect"
    assert page.query_selector(f"{S} [data-offer-method], {S} [data-layer-offer]") is None
    before = _boxes(page)
    page.click(BUTTON)
    page.wait_for_selector(POP, state="visible")
    assert _boxes(page) == before, "opening it moves no box of the panel"
    assert page.get_attribute(BUTTON, "aria-expanded") == "true"
    body = page.inner_text(POP)
    assert "Plots and tables choose a method and a layer. These are the settings of each method, for every layer." in body
    methods = page.eval_on_selector_all(f"{POP} [data-method]", "els => els.map(e => e.dataset.method)")
    assert methods == ALL, "every method, always"
    names = page.eval_on_selector_all(f"{POP} [data-method] .gsig-scoring__optionname", "els => els.map(e => e.textContent)")
    assert names == ["Z-score mean", "Mean", "Sum", "Control-adjusted", "Fraction of genes", "% of total"]
    for method in ALL:
        assert len(page.inner_text(f"{POP} [data-method='{method}'] .gsig-scoring__definition")) > 20
    for key in ("clip", "bins", "controls", "seed", "detect"):
        assert page.is_visible(_sel(key)), f"{key}: every parameter shows, no Offer box first"
    assert page.query_selector(f"{POP} [data-offer-method], {POP} [data-layer], {POP} [data-layer-offer]") is None, "no offer, no layers"
    assert page.query_selector(f"{POP} [data-weighting]:not([hidden])") is None, "no down weighting while Up/Down is off"
    assert page.is_disabled(f"{POP} [data-reset-all]"), "nothing to reset"
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached")
    assert page.get_attribute(BUTTON, "aria-expanded") == "false"
    assert page.evaluate("() => document.activeElement && document.activeElement.dataset.methods !== undefined"), "focus back on the button"
    assert _boxes(page) == before


def test_the_clip_takes_any_positive_number_or_none_and_keeps_the_last_valid_value_otherwise(page, served):
    _sig_open(page, served)
    _methods(page)
    _enter(page, _sel("clip"), "3.5")
    assert _recipe(page)["clip"] == 3.5
    assert page.get_attribute(BUTTON, "title") == "z-score mean: clip ±3.5"
    for bad in ("abc", "0", "-2", "", "1,5"):
        page.fill(_sel("clip"), bad)
        assert page.inner_text(_sel("clip-error")) == "Enter a number above 0.", bad
        page.press(_sel("clip"), "Enter")
        assert _recipe(page)["clip"] == 3.5, f"{bad!r} changes nothing"
        assert page.input_value(_sel("clip")) == "3.5", "the last valid value is put back"
        assert page.inner_text(_sel("clip-error")) == "Enter a number above 0.", "and the reason stays"
    _enter(page, _sel("clip"), "1e3")
    assert _recipe(page)["clip"] == 1000 and page.is_hidden(_sel("clip-error"))
    page.click(_sel("clipbox"))                                         # off
    assert _recipe(page)["clip"] is None and page.is_disabled(_sel("clip"))
    assert "Not clipped" in page.inner_text(f"{POP} [data-method='zscore_mean']")
    assert page.get_attribute(BUTTON, "title") == "z-score mean: not clipped"
    page.click(_sel("clipbox"))                                         # on again: the last number
    assert _recipe(page)["clip"] == 1000 and page.input_value(_sel("clip")) == "1000"


def test_control_adjusted_has_bins_controls_and_a_seed(page, served):
    _sig_open(page, served)
    _methods(page)
    assert page.input_value(_sel("bins")) == "25" and page.input_value(_sel("controls")) == "50" and page.input_value(_sel("seed")) == "0"
    _enter(page, _sel("bins"), "10")
    _enter(page, _sel("controls"), "20")
    _enter(page, _sel("seed"), "42")
    r = _recipe(page)
    assert (r["bins"], r["controls"], r["seed"]) == (10, 20, 42)
    for key, bad, message in (("bins", "1", "Enter a whole number from 2 to 200."), ("bins", "x", "Enter a whole number from 2 to 200."),
                              ("controls", "0", "Enter a whole number from 1 to 1,000."),
                              ("controls", "2000", "Enter a whole number from 1 to 1,000."),
                              ("seed", "-1", "Enter a whole number from 0 up."), ("seed", "1.5", "Enter a whole number from 0 up.")):
        want = {"bins": "10", "controls": "20", "seed": "42"}[key]
        page.fill(_sel(key), bad)
        assert page.inner_text(_sel(f"{key}-error")) == message
        page.press(_sel(key), "Enter")
        assert page.input_value(_sel(key)) == want and str(_recipe(page)[key]) == want, (key, bad)
    assert page.get_attribute(BUTTON, "title") == "control-adjusted: bins 10, controls 20, seed 42"


def test_the_expression_threshold_is_a_number_from_zero_up_shown_under_fraction_of_genes(page, served):
    _sig_open(page, served)
    _methods(page)
    assert page.input_value(_sel("detect")) == "0"
    assert "A gene counts as expressed in a cell when its value is above this." in page.inner_text(f"{POP} [data-method='fraction_of_genes']")
    _enter(page, _sel("detect"), "1.5")
    assert _recipe(page)["detect_above"] == 1.5
    assert page.get_attribute(BUTTON, "title") == "fraction of genes: above 1.5"
    for bad in ("-1", "x", ""):
        page.fill(_sel("detect"), bad)
        assert page.inner_text(_sel("detect-error")) == "Enter a number from 0 up."
        page.press(_sel("detect"), "Enter")
        assert page.input_value(_sel("detect")) == "1.5" and _recipe(page)["detect_above"] == 1.5
    _enter(page, _sel("detect"), "0")
    assert _recipe(page)["detect_above"] == 0


def test_each_method_with_parameters_has_its_own_reset_and_reset_to_defaults_resets_parameters_only(page, served):
    _sig_open(page, served, input="counts", offered=["mean"], layers=["counts", "X"])
    _methods(page)
    assert page.locator(f"{POP} [data-reset-method]:visible").count() == 0, "nothing to reset at the defaults"
    _enter(page, _sel("clip"), "2")
    _enter(page, _sel("seed"), "5")
    _enter(page, _sel("bins"), "10")
    _enter(page, _sel("detect"), "1")
    assert page.is_visible(f"{POP} [data-reset-method='zscore_mean']") and page.is_visible(f"{POP} [data-reset-method='control_adjusted']")
    page.click(f"{POP} [data-reset-method='control_adjusted']")
    r = _recipe(page)
    assert (r["bins"], r["controls"], r["seed"]) == (25, 50, None) and r["clip"] == 2, "only that method is reset"
    assert page.is_hidden(f"{POP} [data-reset-method='control_adjusted']")
    page.click(f"{POP} [data-reset-method='zscore_mean']")
    assert _recipe(page)["clip"] == 10 and page.input_value(_sel("clip")) == "10"
    _enter(page, _sel("clip"), "4")
    page.click(f"{POP} [data-reset-all]")                                # nothing reads the score: no question
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["bins"], r["detect_above"]) == (10, None, 25, 0)
    assert (r["method"], r["input"]) == ("mean", "counts"), "a reset touches no method and no layer"
    assert "offered" not in r and "layers" not in r
    assert page.is_disabled(f"{POP} [data-reset-all]")
    assert page.get_attribute(BUTTON, "data-nondefault") == "false"


def test_reset_to_defaults_asks_first_when_a_plot_shows_a_score_it_changes(page, served):
    _open(page, served, plots=(("cell-plot-C", None),), sig=_sig(clip=3), sig_open=True)
    _wait_coloured(page)
    _methods(page)
    until(page, "() => /Used by 1 plot/.test(document.querySelector(\"[data-popover='methods'] [data-used-by]\").textContent)")
    page.click(f"{POP} [data-reset-all]")
    assert page.inner_text(f"{POP} [data-reset-note]").startswith("1 plot or table shows a score this changes.")
    assert _recipe(page)["clip"] == 3, "asked, nothing changed yet"
    page.click(f"{POP} [data-reset-cancel]")
    assert page.is_hidden(f"{POP} [data-reset-note]") and _recipe(page)["clip"] == 3
    page.click(f"{POP} [data-reset-all]")
    page.click(f"{POP} [data-reset-anyway]")
    assert _recipe(page)["clip"] == 10


def test_the_button_names_every_parameter_not_at_its_default_with_a_dot(page, served):
    _sig_open(page, served, clip=None, seed=3)
    assert page.get_attribute(BUTTON, "data-nondefault") == "true"
    assert page.is_visible(f"{BUTTON} .gsig-methods__dot")
    assert page.get_attribute(BUTTON, "title") == "z-score mean: not clipped; control-adjusted: seed 3"
    assert page.get_attribute(BUTTON, "aria-label") == "Methods: z-score mean: not clipped; control-adjusted: seed 3"


def test_the_popover_says_which_methods_and_layers_plots_read(page, served):
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color={**MEAN, "layer": "counts"})),
                               ("cell-plot-E", _cell("cell-plot-E", color=MEAN))), sig_open=True)
    for tile in (C, D, E):
        _wait_coloured(page, tile)
    _methods(page)
    until(page, "() => !!document.querySelector(\"[data-popover='methods'] [data-in-use='mean']\").textContent")
    assert page.inner_text(f"{POP} [data-in-use='zscore_mean']") == "1 plot"
    assert page.inner_text(f"{POP} [data-in-use='mean']") == "2 plots"
    assert page.inner_text(f"{POP} [data-in-use='sum']") == ""
    assert page.inner_text(f"{POP} [data-used-by]") == "Used by 3 plots: z-score mean, mean · X, counts"


# ------------------------------------------------------------------ links and panel sets

def _link_of(page, served):
    root, store = served
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return view, f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def test_the_settings_are_in_the_link_and_the_panel_set_without_offered_or_layers(page, served):
    _open(page, served, plots=(("cell-plot-C", None),), sig_open=True)
    _wait_coloured(page)
    _methods(page)
    _enter(page, _sel("clip"), "3")
    _enter(page, _sel("seed"), "7")
    _enter(page, _sel("bins"), "12")
    _enter(page, _sel("controls"), "30")
    want = {"clip": 3, "seed": 7, "bins": 12, "controls": 30, "input": "X", "method": "zscore_mean", "detect_above": 0}
    view, url = _link_of(page, served)
    cfg = view["layout"]["panelConfigs"][SIG]
    assert {k: cfg[k] for k in want} == want
    assert "offered" not in cfg and "layers" not in cfg
    assert "Float32" not in json.dumps(view)

    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(INIT)
    try:
        other.goto(url)
        other.wait_for_selector(BUTTON, timeout=30000)
        assert other.get_attribute(BUTTON, "title") == "z-score mean: clip ±3; control-adjusted: bins 12, controls 30, seed 7"
        r = other.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)
        assert {k: r[k] for k in want} == want
        other.click(BUTTON)
        other.wait_for_selector(POP, state="visible")
        assert other.input_value(_sel("clip")) == "3" and other.input_value(_sel("seed")) == "7"
        assert other.input_value(_sel("bins")) == "12" and other.input_value(_sel("controls")) == "30"
    finally:
        other.close()

    _save_set(page, "score-options")
    saved = page.evaluate("() => PanelManager.saveLayout()")
    text = json.dumps(saved)
    assert '"controls": 30' in text and '"offered"' not in text and '"layers"' not in text
    root, store = served
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    try:
        fresh.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        fresh.wait_for_selector("#btn-load-session", state="visible", timeout=30000)
        fresh.wait_for_selector(".tile-selector", state="visible", timeout=30000)
        fresh.click("#btn-load-session")
        fresh.locator(".session-card[data-session-name='score-options'] .session-load").first.click()
        fresh.wait_for_selector(BUTTON, timeout=30000)
        r = fresh.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)
        assert {k: r[k] for k in want} == want
    finally:
        fresh.close()


def test_an_old_link_with_offered_and_layers_keeps_every_consumer_on_the_layer_it_drew(page, served):
    # made before decision 31: the signature offered sum on counts first; the plot stored no layer and read counts
    old = _sig(input="counts", method="sum", offered=["sum"], layers=["counts", "X"])
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "column": "sum"})),), sig=old, sig_open=True)
    _wait_coloured(page)
    color = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")
    assert (color["column"], color["layer"]) == ("sum", "counts"), "the layer it drew before"
    r = _recipe(page)
    assert (r["method"], r["input"]) == ("sum", "counts") and "offered" not in r and "layers" not in r
    view, _ = _link_of(page, served)
    cfg = view["layout"]["panelConfigs"][SIG]
    assert "offered" not in cfg and "layers" not in cfg and (cfg["method"], cfg["input"]) == ("sum", "counts")
    assert page.query_selector(f"{C} .no-longer-offered, {C} [data-lapsed]") is None


def test_a_restored_config_is_read_for_its_pair_and_its_parameters(page, served):
    _sig_open(page, served)
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 2, seed: 3, input: 'counts', offered: ['sum'] })", SIG)
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["input"], r["method"]) == (2, 3, "counts", "sum")
    assert "offered" not in r and "layers" not in r
    assert page.get_attribute(BUTTON, "title") == "z-score mean: clip ±2; control-adjusted: seed 3"
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 10, seed: null, input: 'X', method: 'zscore_mean' })", SIG)
    assert page.get_attribute(BUTTON, "data-nondefault") == "false"


# ------------------------------------------------------------------ the key

def test_a_clip_edit_recomputes_only_a_z_score_mean_consumer(rec, served):
    page = rec
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=CONTROL))), sig_open=True)
    for tile in (C, D, E):
        _wait_coloured(page, tile)
    assert sorted(r["method"] for r in _recipes(page)) == ["control_adjusted", "mean", "zscore_mean"]
    _wait_computes(page, 3)
    _methods(page)

    # the clip: the z-score mean recomputes, the plain mean and the control-adjusted score do not
    before = _numbers(page, D)
    _enter(page, _sel("clip"), "3")
    _wait_computes(page, 4)
    # time for a second request, were one going to; only the z-score mean should be asked
    page.wait_for_timeout(800)
    assert len(_recipes(page)) == 4, "one request: the z-score mean, with the new clip"
    last = _recipes(page)[-1]
    assert (last["method"], last["clip"]) == ("zscore_mean", 3)
    assert _numbers(page, D) == before
    assert len(_recipes(page, "estimate")) == 4, "three at the start and one for the new clip: the others were known"

    page.click(_sel("clipbox"))
    _wait_computes(page, 5)
    # time for a further request to show up before the next step counts requests
    page.wait_for_timeout(500)
    assert _recipes(page)[-1]["clip"] is None and _recipes(page)[-1]["method"] == "zscore_mean"

    # the seed, the bins, the controls: only the control-adjusted score
    for key, value, n in (("seed", "9", 6), ("bins", "10", 7), ("controls", "20", 8)):
        _enter(page, _sel(key), value)
        _wait_computes(page, n)
        # time for a second request, were one going to; only the control-adjusted score should be asked
        page.wait_for_timeout(400)
        assert len(_recipes(page)) == n
        last = _recipes(page)[-1]
        assert last["method"] == "control_adjusted" and last[key] == int(value), key

    # the detection threshold: nothing reads fraction of genes
    _enter(page, _sel("detect"), "1")
    # time for a request, were one going to; none should be asked
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 8

    # entering a value that is already there asks nothing
    _enter(page, _sel("seed"), "9")
    # time for a request, were one going to; none should be asked
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 8
    assert {r["input"] for r in _recipes(page)} == {"X"}


def test_a_clip_edit_changes_nothing_a_plain_mean_shows_and_asks_the_server_nothing(rec, served):
    page = rec
    _open(page, served, plots=(("cell-plot-D", _cell("cell-plot-D", color=MEAN)),), sig_open=True, wait=False)
    page.wait_for_selector(f"{D} .js-plotly-plot", timeout=30000)
    _wait_coloured(page, D)
    _methods(page)
    n_compute, n_estimate = len(_recipes(page)), len(_recipes(page, "estimate"))
    _enter(page, _sel("clip"), "2")
    page.click(_sel("clipbox"))
    # time for a request, were one going to; none should be asked
    page.wait_for_timeout(1000)
    assert len(_recipes(page)) == n_compute and len(_recipes(page, "estimate")) == n_estimate
    assert page.evaluate("() => window.__scoreCalls.length") == n_compute + n_estimate
    assert "not applied" not in page.inner_text(f"{S} .gsig-score"), "nothing was held back either"


# ------------------------------------------------------------------ cost

def test_edits_of_five_seconds_or_more_collect_behind_update_score_whatever_the_setting(rec, served):
    page = rec
    page.add_init_script("""window.__scoreFake = (kind, body, real) => {
        if (kind !== 'estimate') return undefined;
        const r = body.recipe;
        const seconds = (r.clip === 3 || r.seed === 4) ? 40 : 1;
        return new Response(JSON.stringify({ estimate: { seconds, tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5, layout: 'csc', entries: 1 },
            missing: [], duplicated: [], recipe: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };""")
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=CONTROL))), sig_open=True)
    for tile in (C, D, E):
        _wait_coloured(page, tile)
    _wait_computes(page, 3)
    _methods(page)
    before = _numbers(page, C)
    _enter(page, _sel("clip"), "3")
    page.wait_for_selector(f"{S} .gsig-score [data-score-command='update']")
    assert "1 change is not applied" in page.inner_text(f"{S} .gsig-score")
    assert "About 40 seconds" in page.inner_text(f"{S} .gsig-score")
    _enter(page, _sel("seed"), "4")
    until(page, "(s) => /2 changes are not applied/.test(document.querySelector(s + ' .gsig-score').textContent)", S)
    # time for a request, were one going to; nothing is asked until the edits are applied
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 3, "nothing is asked until the edits are applied"
    assert _numbers(page, C) == before, "the plots keep the previous scores"
    page.keyboard.press("Escape")
    page.click(f"{S} .gsig-score [data-score-command='update']")
    _wait_computes(page, 5)
    new = _recipes(page)[3:]
    assert sorted(r["method"] for r in new) == ["control_adjusted", "zscore_mean"], "the plain mean was not asked again"
    assert {(r["clip"], r["seed"]) for r in new} == {(3, 4)}, "both edits were applied together"
    page.wait_for_selector(f"{S} .gsig-score [data-score-command='update']", state="detached")


# ------------------------------------------------------------------ what each layer looks like

def test_every_layer_is_graded_once_without_alternatives(page, served):
    calls = []
    page.route("**/api/v1/data/matrix_kind*", lambda route: (calls.append(route.request.url), route.continue_())[1])
    _sig_open(page, served)
    until(page, "(id) => Object.keys(window.PanelManager.getPanel(id).getGrading().kinds).length === 2", SIG)
    grading = page.evaluate("(id) => window.PanelManager.getPanel(id).getGrading()", SIG)
    assert sorted(grading["kinds"]) == ["X", "counts"], "every layer of the dataset, not only one"
    asked = sorted(urllib.parse.parse_qs(urllib.parse.urlparse(u).query)["input"][0] for u in calls)
    assert asked == ["X", "counts"], "each once"
    assert all(urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("suggest") == ["0"] for u in calls), "no alternatives sampled"


def test_a_failing_kind_route_leaves_the_panel_quiet(page, served):
    page.route("**/api/v1/data/matrix_kind*", lambda route: route.fulfill(status=500, content_type="application/json", body="{}"))
    _sig_open(page, served)
    # time for the kind route to answer, were it going to change anything; the panel stays quiet
    page.wait_for_timeout(500)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getGrading()", SIG) == {"kinds": {}, "stats": {}}
    _methods(page)
    assert page.query_selector(f"{POP} .gsig-scoring__grade, {S} .gsig-inputwarn") is None


def test_the_real_route_answers_for_the_store(page, served):
    _sig_open(page, served)
    got = page.evaluate("""async (store) => {
        const r = await fetch('/api/v1/data/matrix_kind?' + new URLSearchParams({ dataset_path: store, input: 'X' }));
        return { status: r.status, body: await r.json() };
    }""", served[1])
    assert got["status"] == 200 and got["body"]["input"] == "X" and got["body"]["kind"] == "log"
    assert got["body"]["suggest"] is None


# ------------------------------------------------------------------ Distribution (Inspect's job)

def test_distribution_opens_a_count_plot_of_the_score_beside_the_panel(page, served):
    _sig_open(page, served)
    assert page.inner_text(f"{S} [data-distribution]") == "Distribution"
    page.click(f"{S} [data-distribution]")
    until(page, "() => window.PanelManager.getAllPanels().some(p => p.getType() === 'cell-count')")
    cfg = page.evaluate("""() => { const p = window.PanelManager.getAllPanels().find(p => p.getType() === 'cell-count');
        return { id: p.getId(), config: p.getConfig() }; }""")
    assert cfg["config"]["mode"] == "histogram"
    source = cfg["config"]["x"]["source"]
    assert (source["type"], source["key"], source["column"], source["layer"]) == ("gene-score", SIG, "zscore_mean", "X")
    tile = f".tile[data-tile-id=\"{cfg['id']}\"]"
    page.wait_for_selector(f"{tile} .js-plotly-plot", timeout=30000)
    until(page, """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.some(d => d.type === 'bar' && (d.y || []).length > 1)); }""", tile)
    assert page.query_selector(f"{tile} .coverage-placeholder") is None, "the score is drawn, not refused"
    assert "T cell score" in page.inner_text(tile), "the x axis names the score"


def test_the_methods_pop_over_uses_the_az_pop_body(page, served):
    from annzarro.tests.browser.popover_standard import assert_body_standard
    _sig_open(page, served)
    page.click(BUTTON)
    page.wait_for_selector(POP, state="visible")
    got = assert_body_standard(page, POP, help=True, sections=6, shot="signature-methods")
    assert [t["text"] for t in got["titles"]][:2] == ["Z-score mean", "Mean"], "a section per method, titled by its name"
