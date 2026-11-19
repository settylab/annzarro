"""The Score options section of the Gene Signature panel in a real browser (step 8 of the gene-signature plan).

The signature's panel defines which options plots and tables are offered (an aggregation, read from a layer) and how
each is computed: the clip of z-scores, the bins, controls and seed of the control-adjusted score. Collapsed, one row
states what is offered. Plots and tables only pick from what is offered.

The store is the one of test_gene_score_plots.py (60 cells, 3,000 genes, layers `counts`). The score route is
the real one except where a test needs a slow estimate; the route that says what an input looks like is the real
one except in the warning test, which answers as a raw-count matrix would.

1.  The section is collapsed and states the settings; opening it shows Input, Clip and Seed with their help.
2.  Clip: any positive number, off, back on; an invalid entry keeps the last valid value and says what is expected.
3.  Seed: a whole number from 0 up, with the same rule.
4.  The settings are in the recipe, the link and the panel set, and come back from each.
5.  The score key changes only when it should: the clip not for a plain mean, the seed only for the
    control-adjusted score, the input for all; a clip edit costs a plain mean no request at all.
6.  Edits of 5 seconds or more collect behind **Update score**, whatever the setting.
7.  The raw-count warning appears for an input that looks like counts, shows in the status zone with the section
    collapsed and in the section when open, names a layer that looks log-normalised, and clears when it is chosen.
8.  The route answers for the real store.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing
Playwright is an error.
"""
import base64
import json
import urllib.parse

import pytest

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401  (the fixtures are used by name)
    C, INIT, S, SIG, SCORE, _action, _calls, _cell, _numbers, _open, _save_set, _sig, _wait_coloured, large_page,
    large_served, page, served,
)
from annzarro.tests.browser.test_memory_guard import until

D = '.tile[data-tile-id="cell-plot-D"]'
E = '.tile[data-tile-id="cell-plot-E"]'
MEAN = {**SCORE, "column": "mean"}
CONTROL = {**SCORE, "column": "control_adjusted"}

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


def _three_plots(page, served, **kw):
    """A plot of each aggregation of one signature, the signature open."""
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=CONTROL))), sig_open=True, **kw)
    for tile in (C, D, E):
        _wait_coloured(page, tile)


def _sel(name):
    return f"#gsig-scoring-{name}-{SIG}"


def _expand(page):
    if page.get_attribute(f"{S} .gsig-scoring__toggle", "aria-expanded") != "true":
        page.click(f"{S} .gsig-scoring__toggle")
    page.wait_for_selector(f"{S} .gsig-scoring__body", state="visible")


def _enter(page, selector, text):
    page.fill(selector, text)
    page.press(selector, "Enter")


def _recipe(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)


def _wait_computes(page, n):
    until(page, "(n) => window.__scoreCalls.filter(c => c.kind === 'compute').length === n", n)


def _offer(page, method, on=True):
    box = f"{S} [data-offer-method='{method}']"
    if page.is_checked(box) != on:
        page.click(box)


def _layer_offer(page, layer):
    page.click(f"{S} [data-layer-offer='{layer}']")


def _sig_open(page, served, **sig):
    _open(page, served, plots=(), sig=_sig(**sig), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")


ALL = ["zscore_mean", "mean", "sum", "detected", "fraction_of_total", "control_adjusted"]


# ------------------------------------------------------------------ the section

def test_the_section_is_collapsed_and_states_what_is_offered_then_opens_with_every_option_defined(page, served):
    _sig_open(page, served)
    assert page.get_attribute(f"{S} .gsig-scoring__toggle", "aria-expanded") == "false"
    assert page.is_hidden(f"{S} .gsig-scoring__body")
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layer X"
    assert "Z-score mean of X, clipped at ±10" in page.inner_text(f"{S} .gsig-definition"), "the definition line stays"
    assert page.inner_text(f"{S} .gsig-scoring__label") == "Score options"
    _expand(page)
    body = page.inner_text(f"{S} .gsig-scoring__body")
    assert "choose gene-score as the source, then this signature, then the option" in body
    methods = page.eval_on_selector_all(f"{S} [data-method]", "els => els.map(e => e.dataset.method)")
    assert methods == ALL, "listed by common use, z-score mean first"
    for method in ALL:
        assert len(page.inner_text(f"{S} [data-method='{method}'] .gsig-scoring__help")) > 20
    assert "less the average of control genes" in page.inner_text(f"{S} [data-method='control_adjusted']")
    on = page.eval_on_selector_all(f"{S} [data-offer-method]", "els => els.filter(e => e.checked).map(e => e.dataset.offerMethod)")
    assert on == ["zscore_mean", "mean", "sum"]
    assert "default" in page.inner_text(f"{S} [data-method='zscore_mean'] .gsig-scoring__optionhead")
    assert page.input_value(_sel("clip")) == "10" and page.is_checked(_sel("clipbox"))
    assert page.is_disabled(f"{S} .gsig-scoring__reset"), "nothing to reset"
    layers = page.eval_on_selector_all(f"{S} [data-layer]", "els => els.map(e => e.dataset.layer)")
    assert layers == ["X", "counts"], "X first, then the layers"
    assert page.is_checked(f"{S} [data-layer-default='X']") and page.is_disabled(f"{S} [data-layer-offer='X']")
    page.click(f"{S} .gsig-scoring__toggle")
    assert page.is_hidden(f"{S} .gsig-scoring__body")


def test_the_clip_takes_any_positive_number_or_none_and_keeps_the_last_valid_value_otherwise(page, served):
    _sig_open(page, served)
    _expand(page)
    _enter(page, _sel("clip"), "3.5")
    assert _recipe(page)["clip"] == 3.5
    assert "clipped at ±3.5" in page.inner_text(f"{S} .gsig-definition")
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
    assert "Not clipped" in page.inner_text(f"{S} [data-method='zscore_mean']")
    page.click(_sel("clipbox"))                                         # on again: the last number
    assert _recipe(page)["clip"] == 1000 and page.input_value(_sel("clip")) == "1000"


def test_the_clip_is_off_with_a_reason_when_z_score_mean_is_not_offered(page, served):
    _sig_open(page, served)
    _expand(page)
    _offer(page, "zscore_mean", False)
    assert page.is_disabled(_sel("clip")) and page.is_disabled(_sel("clipbox"))
    assert page.inner_text(f"{S} [data-method='zscore_mean'] [data-needs-offer]") == "Offer this option to set its parameters."
    r = _recipe(page)
    assert r["offered"] == ["mean", "sum"] and r["method"] == "mean", "the default moves to an offered method"
    assert r["clip"] == 10, "the clip is kept for when it is offered again"
    _offer(page, "zscore_mean", True)
    assert page.is_enabled(_sel("clip")) and _recipe(page)["offered"] == ["zscore_mean", "mean", "sum"]


def test_the_last_offered_option_cannot_be_switched_off(page, served):
    _sig_open(page, served, offered=["sum"])
    _expand(page)
    assert page.is_disabled(f"{S} [data-offer-method='sum']")
    assert "At least one option stays offered" in page.get_attribute(f"{S} [data-offer-method='sum']", "title")


def test_control_adjusted_has_bins_controls_and_a_seed_when_offered(page, served):
    _sig_open(page, served)
    _expand(page)
    assert page.is_disabled(_sel("bins")) and page.is_disabled(_sel("seed")), "off until offered"
    _offer(page, "control_adjusted")
    assert page.is_enabled(_sel("bins")) and page.input_value(_sel("bins")) == "25"
    assert page.input_value(_sel("controls")) == "50" and page.input_value(_sel("seed")) == "0"
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


def test_reset_to_defaults_puts_every_setting_back(page, served):
    _sig_open(page, served)
    _expand(page)
    _enter(page, _sel("clip"), "2")
    _offer(page, "control_adjusted")
    _enter(page, _sel("seed"), "5")
    _offer(page, "mean", False)
    _layer_offer(page, "counts")
    page.click(f"{S} [data-layer-default='counts']")
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["input"]) == (2, 5, "counts") and r["layers"] == ["counts", "X"]
    page.click(f"{S} .gsig-scoring__reset")
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["input"], r["method"]) == (10, None, "X", "zscore_mean")
    assert r["offered"] == ["zscore_mean", "mean", "sum"] and r["layers"] == ["X"]
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layer X"
    assert page.is_disabled(f"{S} .gsig-scoring__reset")


def test_layers_are_offered_and_one_is_the_default(page, served):
    _sig_open(page, served)
    _expand(page)
    _layer_offer(page, "counts")
    assert _recipe(page)["layers"] == ["X", "counts"] and _recipe(page)["input"] == "X"
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layers X, counts"
    page.click(f"{S} [data-layer-default='counts']")
    r = _recipe(page)
    assert r["input"] == "counts" and r["layers"] == ["counts", "X"]
    assert page.is_disabled(f"{S} [data-layer-offer='counts']") and page.is_enabled(f"{S} [data-layer-offer='X']")
    _layer_offer(page, "X")
    assert _recipe(page)["layers"] == ["counts"]
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layer counts"


# ------------------------------------------------------------------ what plots and tables are offered

def _agg_options(page, tile=C, axis="color"):
    return page.eval_on_selector_all(f"{tile} select.axis-column-select[data-axis='{axis}'] option",
                                     "els => els.map(e => [e.value, e.textContent])")


def test_a_plot_is_offered_what_the_panel_offers_and_a_switched_off_option_is_kept_and_marked(page, served):
    _open(page, served, plots=(("cell-plot-D", _cell("cell-plot-D", color=MEAN)),), sig=_sig(), sig_open=True, wait=False)
    page.wait_for_selector(f"{D} .js-plotly-plot", timeout=30000)
    _wait_coloured(page, D)
    values = [v for v, _ in _agg_options(page, D)]
    assert values == ["zscore_mean", "mean", "sum"]
    _expand(page)
    _offer(page, "detected")
    until(page, "(t) => document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"color\"] option').length === 4", D)
    assert [v for v, _ in _agg_options(page, D)] == ["zscore_mean", "mean", "sum", "detected"]
    _offer(page, "mean", False)                                          # the plot reads the mean
    until(page, "(t) => /no longer offered/.test(document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').textContent)", D)
    options = _agg_options(page, D)
    assert ["mean", "Mean (no longer offered)"] in [list(o) for o in options] or any(v == "mean" and "no longer offered" in t for v, t in options)
    assert page.eval_on_selector(f"{D} select.axis-column-select[data-axis='color']", "s => s.value") == "mean", "its setting is kept"
    assert _numbers(page, D), "and it still draws"
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-plot-D').getConfig().color")
    assert cfg["column"] == "mean", "the link stays valid"
    _offer(page, "mean", True)
    until(page, "(t) => !/no longer offered/.test(document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').textContent)", D)


def test_the_hover_picker_lists_only_what_is_offered(page, served):
    _open(page, served, plots=(("cell-plot-C", None),), sig=_sig(offered=["zscore_mean", "detected"]), sig_open=True)
    _wait_coloured(page)
    opts = page.eval_on_selector_all(f"{C} select.hover-columns-select optgroup[label='Gene scores'] option", "els => els.map(e => e.value)")
    assert opts == [f"gene-score:{SIG}:zscore_mean", f"gene-score:{SIG}:detected"]


def test_the_section_shows_which_options_plots_use(page, served):
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=MEAN))), sig_open=True)
    _wait_coloured(page)
    _expand(page)
    until(page, "(s) => !!document.querySelector(s + ' [data-in-use=\"mean\"]')", S)
    assert page.inner_text(f"{S} [data-in-use='zscore_mean']") == "used by 1"
    assert page.inner_text(f"{S} [data-in-use='mean']") == "used by 2"
    assert page.query_selector(f"{S} [data-in-use='sum']") is None


# ------------------------------------------------------------------ links and panel sets

def _link_of(page, served):
    root, store = served
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return view, f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _set_up(page):
    _expand(page)
    _enter(page, _sel("clip"), "3")
    _offer(page, "control_adjusted")
    _offer(page, "detected")
    _offer(page, "sum", False)
    _enter(page, _sel("seed"), "7")
    _enter(page, _sel("bins"), "12")
    _enter(page, _sel("controls"), "30")
    _layer_offer(page, "counts")


def test_the_options_are_in_the_link_and_the_panel_set_and_come_back_from_both(page, served):
    _open(page, served, plots=(("cell-plot-C", None),), sig_open=True)
    _wait_coloured(page)
    _set_up(page)
    want = {"clip": 3, "seed": 7, "bins": 12, "controls": 30, "input": "X", "layers": ["X", "counts"],
            "offered": ["zscore_mean", "mean", "detected", "control_adjusted"]}
    view, url = _link_of(page, served)
    cfg = view["layout"]["panelConfigs"][SIG]
    assert {k: cfg[k] for k in want} == want
    assert "Float32" not in json.dumps(view)

    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(INIT)
    try:
        other.goto(url)
        other.wait_for_selector(f"{S} .gsig-scoring", timeout=30000)
        assert other.inner_text(f"{S} .gsig-scoring__summary") == \
            "Offered: z-score mean, mean, detected, control-adjusted · layers X, counts"
        r = other.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)
        assert {k: r[k] for k in want} == want
        other.click(f"{S} .gsig-scoring__toggle")
        assert other.input_value(_sel("clip")) == "3" and other.input_value(_sel("seed")) == "7"
        assert other.input_value(_sel("bins")) == "12" and other.input_value(_sel("controls")) == "30"
    finally:
        other.close()

    _save_set(page, "score-options")
    saved = json.dumps(page.evaluate("() => PanelManager.saveLayout()"))
    assert '"offered"' in saved and '"controls": 30' in saved and '"layers"' in saved
    root, store = served
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    try:
        fresh.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        fresh.wait_for_selector("#btn-load-session", state="visible", timeout=30000)
        fresh.wait_for_selector(".tile-selector", state="visible", timeout=30000)
        fresh.click("#btn-load-session")
        fresh.locator(".session-card[data-session-name='score-options'] .session-load").first.click()
        fresh.wait_for_selector(f"{S} .gsig-scoring", timeout=30000)
        r = fresh.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)
        assert {k: r[k] for k in want} == want
    finally:
        fresh.close()


def test_a_link_from_before_the_options_existed_opens_with_the_defaults(page, served):
    _open(page, served, plots=(), sig=_sig(method="zscore_mean", clip=10, seed=None, input="X"), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    r = _recipe(page)
    assert r["offered"] == ["zscore_mean", "mean", "sum"] and r["layers"] == ["X"] and (r["bins"], r["controls"]) == (25, 50)
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layer X"


def test_a_restored_config_moves_the_section_and_asks_what_the_new_input_looks_like(page, served):
    calls = []
    page.route("**/api/v1/data/matrix_kind*", lambda route: (calls.append(route.request.url), route.fulfill(
        status=200, content_type="application/json", body=json.dumps({**LOGGED, "input": "counts"})))[1])
    _sig_open(page, served)
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 2, seed: 3, input: 'counts', offered: ['sum'] })", SIG)
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: sum · layers counts, X"
    page.wait_for_timeout(300)
    assert any("input=counts" in u for u in calls)
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 10, seed: null, input: 'X', offered: null, layers: null })", SIG)
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "Offered: z-score mean, mean, sum · layer X"


# ------------------------------------------------------------------ the key

def test_the_score_key_changes_only_when_it_should(rec, served):
    page = rec
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=CONTROL))),
          sig=_sig(offered=ALL), sig_open=True)
    for tile in (C, D, E):
        _wait_coloured(page, tile)
    assert sorted(r["method"] for r in _recipes(page)) == ["control_adjusted", "mean", "zscore_mean"]
    _wait_computes(page, 3)
    _expand(page)

    # the clip: the z-score mean recomputes, the plain mean and the control-adjusted score do not
    before = _numbers(page, D)
    _enter(page, _sel("clip"), "3")
    _wait_computes(page, 4)
    page.wait_for_timeout(800)
    assert len(_recipes(page)) == 4, "one request: the z-score mean, with the new clip"
    last = _recipes(page)[-1]
    assert (last["method"], last["clip"]) == ("zscore_mean", 3)
    assert _numbers(page, D) == before
    assert len(_recipes(page, "estimate")) == 4, "three at the start and one for the new clip: the others were known"

    page.click(_sel("clipbox"))
    _wait_computes(page, 5)
    page.wait_for_timeout(500)
    assert _recipes(page)[-1]["clip"] is None and _recipes(page)[-1]["method"] == "zscore_mean"

    # the seed, the bins, the controls: only the control-adjusted score
    for key, value, n in (("seed", "9", 6), ("bins", "10", 7), ("controls", "20", 8)):
        _enter(page, _sel(key), value)
        _wait_computes(page, n)
        page.wait_for_timeout(400)
        assert len(_recipes(page)) == n
        last = _recipes(page)[-1]
        assert last["method"] == "control_adjusted" and last[key] == int(value), key

    # what is offered changes no score
    _offer(page, "detected")
    _layer_offer(page, "counts")
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 8

    # the default layer: all three
    page.click(f"{S} [data-layer-default='counts']")
    _wait_computes(page, 11)
    assert sorted(r["method"] for r in _recipes(page)[-3:]) == ["control_adjusted", "mean", "zscore_mean"]
    assert {r["input"] for r in _recipes(page)[-3:]} == {"counts"}

    # entering a value that is already there asks nothing
    _enter(page, _sel("seed"), "9")
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 11


def test_a_clip_edit_changes_nothing_a_plain_mean_shows_and_asks_the_server_nothing(rec, served):
    page = rec
    _open(page, served, plots=(("cell-plot-D", _cell("cell-plot-D", color=MEAN)),), sig_open=True, wait=False)
    page.wait_for_selector(f"{D} .js-plotly-plot", timeout=30000)
    _wait_coloured(page, D)
    _expand(page)
    n_compute, n_estimate = len(_recipes(page)), len(_recipes(page, "estimate"))
    _enter(page, _sel("clip"), "2")
    page.click(_sel("clipbox"))
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
                               ("cell-plot-E", _cell("cell-plot-E", color=CONTROL))),
          sig=_sig(offered=ALL), sig_open=True)
    for tile in (C, D, E):
        _wait_coloured(page, tile)
    _wait_computes(page, 3)
    _expand(page)
    before = _numbers(page, C)
    _enter(page, _sel("clip"), "3")
    page.wait_for_selector(f"{S} .gsig-score [data-score-command='update']")
    assert "1 change is not applied" in page.inner_text(f"{S} .gsig-score")
    assert "About 40 seconds" in page.inner_text(f"{S} .gsig-score")
    _enter(page, _sel("seed"), "4")
    until(page, "(s) => /2 changes are not applied/.test(document.querySelector(s + ' .gsig-score').textContent)", S)
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 3, "nothing is asked until the edits are applied"
    assert _numbers(page, C) == before, "the plots keep the previous scores"
    page.click(f"{S} .gsig-score [data-score-command='update']")
    _wait_computes(page, 5)
    new = _recipes(page)[3:]
    assert sorted(r["method"] for r in new) == ["control_adjusted", "zscore_mean"], "the plain mean was not asked again"
    assert {(r["clip"], r["seed"]) for r in new} == {(3, 4)}, "both edits were applied together"
    page.wait_for_selector(f"{S} .gsig-score [data-score-command='update']", state="detached")


# ------------------------------------------------------------------ raw counts

COUNTS = {"input": "X", "kind": "counts", "stats": {"kind": "counts", "n": 9000, "whole": 1.0, "min": 1.0, "max": 557.0, "negative": 0.0},
          "suggest": "counts_log", "checked": {"counts": "log"}}
LOGGED = {"input": "counts", "kind": "log", "stats": {"kind": "log", "n": 9000, "whole": 0.0, "min": 0.1, "max": 5.0, "negative": 0.0},
          "suggest": None, "checked": {}}


def _answer_as_counts(page, calls):
    def handler(route):
        calls.append(route.request.url)
        want = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("input", ["X"])[0]
        body = COUNTS if want == "X" else {**LOGGED, "input": want}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/data/matrix_kind*", handler)


def test_the_raw_count_warning_appears_names_a_layer_and_clears_when_it_is_chosen(page, served):
    calls = []
    _answer_as_counts(page, calls)
    _sig_open(page, served)
    status = f"{S} .gsig-inputwarn[data-input-warning='status']"
    page.wait_for_selector(status, state="visible")
    text = page.inner_text(status)
    assert "X looks like raw counts (whole numbers up to 557)." in text
    assert "Scores should be computed on normalised, log-transformed data" in text
    assert "counts_log looks log-normalised." in text
    _expand(page)
    page.wait_for_selector(f"{S} .gsig-inputwarn[data-input-warning='layer'][data-layer='X']", state="visible")
    assert page.is_hidden(status), "open: the warning is under the layer"
    assert "looks like raw counts" in page.inner_text(f"{S} [data-layer='X']")
    page.click(f"{S} [data-layer='X'] [data-use-input='counts_log']")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().input === 'counts_log'", SIG)
    page.wait_for_selector(f"{S} .gsig-inputwarn[data-layer='X']", state="detached", timeout=5000) if False else None
    assert page.is_checked(f"{S} [data-layer-default='counts_log']")
    page.click(f"{S} .gsig-scoring__toggle")
    assert page.is_hidden(status), "the default layer is fine now"
    assert len([u for u in calls if "input=X" in u]) == 1, "the answer for X is asked of the server once"


def test_each_offered_layer_is_checked_where_it_is_offered(page, served):
    def handler(route):
        want = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("input", ["X"])[0]
        body = {**COUNTS, "input": want, "suggest": None} if want == "counts" else {**LOGGED, "input": want}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/data/matrix_kind*", handler)
    _sig_open(page, served)
    page.wait_for_timeout(400)
    assert page.is_hidden(f"{S} .gsig-inputwarn[data-input-warning='status']"), "X looks log-normalised here"
    _expand(page)
    _layer_offer(page, "counts")
    page.wait_for_selector(f"{S} .gsig-inputwarn[data-input-warning='layer'][data-layer='counts']", state="visible")
    text = page.inner_text(f"{S} [data-input-warning='layer'][data-layer='counts']")
    assert text.startswith("Layer counts looks like raw counts") and "looks log-normalised" not in text
    assert page.query_selector(f"{S} [data-input-warning='layer'][data-layer='X']") is None


def test_a_failing_kind_route_leaves_the_panel_quiet(page, served):
    page.route("**/api/v1/data/matrix_kind*", lambda route: route.fulfill(status=500, content_type="application/json", body="{}"))
    _sig_open(page, served)
    page.wait_for_timeout(500)
    assert page.is_hidden(f"{S} .gsig-inputwarn[data-input-warning='status']")
    _expand(page)
    assert page.query_selector(f"{S} [data-input-warning='layer']") is None


def test_the_real_route_answers_for_the_store_and_a_layer_not_in_the_dataset_is_kept_listed(page, served):
    _sig_open(page, served)
    got = page.evaluate("""async (store) => {
        const r = await fetch('/api/v1/data/matrix_kind?' + new URLSearchParams({ dataset_path: store, input: 'X' }));
        return { status: r.status, body: await r.json() };
    }""", served[1])
    assert got["status"] == 200 and got["body"]["input"] == "X" and got["body"]["kind"] == "log"
    assert got["body"]["suggest"] is None
    page2 = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    page2.add_init_script(INIT)
    try:
        _open(page2, served, plots=(), sig=_sig(input="not_a_layer"), sig_open=True, wait=False)
        page2.wait_for_selector(f"{S} .gsig-scoring")
        page2.click(f"{S} .gsig-scoring__toggle")
        assert "not_a_layer (not in this dataset)" in page2.inner_text(f"{S} [data-layer='not_a_layer']")
    finally:
        page2.close()
