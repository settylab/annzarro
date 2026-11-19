"""The Scoring section of the Gene Signature panel in a real browser (step 8 of the gene-signature plan).

A signature shares a few settings with every score made from it: the input matrix, the clip of z-scores and the
seed of the control genes. They live under **Scoring**, collapsed to one row that states them. How the genes are
combined (z-score mean, mean, control-adjusted) is chosen where the score is used, in the plot.

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


# ------------------------------------------------------------------ the section

def test_the_section_is_collapsed_and_states_the_settings_then_opens_with_its_help(page, served):
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    assert page.get_attribute(f"{S} .gsig-scoring__toggle", "aria-expanded") == "false"
    assert page.is_hidden(f"{S} .gsig-scoring__body")
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, clipped at ±10"
    assert "Z-score mean of X, clipped at ±10" in page.inner_text(f"{S} .gsig-definition"), "the definition line stays"
    _expand(page)
    assert page.input_value(_sel("clip")) == "10" and page.is_checked(_sel("clipbox"))
    assert page.input_value(_sel("seed")) == "0"
    assert page.input_value(_sel("input")) == "X"
    options = page.eval_on_selector_all(f"{_sel('input')} option", "els => els.map(e => e.value)")
    assert options == ["X", "counts"], "X first, then the layers"
    body = page.inner_text(f"{S} .gsig-scoring__body")
    assert "One rare gene can otherwise dominate the average." in body
    assert "Picks the control genes of a control-adjusted score" in body
    assert page.is_disabled(f"{S} .gsig-scoring__reset"), "nothing to reset"
    page.click(f"{S} .gsig-scoring__toggle")
    assert page.is_hidden(f"{S} .gsig-scoring__body")


def test_the_clip_takes_any_positive_number_or_none_and_keeps_the_last_valid_value_otherwise(page, served):
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    _expand(page)
    _enter(page, _sel("clip"), "3.5")
    assert _recipe(page)["clip"] == 3.5
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, clipped at ±3.5"
    for bad in ("abc", "0", "-2", "", "1,5"):
        page.fill(_sel("clip"), bad)
        assert page.is_visible(f"{_sel('clip-error')}"), f"typing {bad!r} says what is expected"
        assert page.inner_text(_sel("clip-error")) == "Enter a number above 0."
        page.press(_sel("clip"), "Enter")
        assert _recipe(page)["clip"] == 3.5, f"{bad!r} changes nothing"
        assert page.input_value(_sel("clip")) == "3.5", "the last valid value is put back"
        assert page.inner_text(_sel("clip-error")) == "Enter a number above 0.", "and the reason stays"
    _enter(page, _sel("clip"), "1e3")
    assert _recipe(page)["clip"] == 1000
    assert page.is_hidden(_sel("clip-error")), "a valid entry clears the message"
    page.click(_sel("clipbox"))                                         # off
    assert _recipe(page)["clip"] is None
    assert page.is_disabled(_sel("clip"))
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, not clipped"
    assert "Not clipped" in page.inner_text(f"{S} .gsig-scoring__body")
    page.click(_sel("clipbox"))                                         # on again: the last number
    assert _recipe(page)["clip"] == 1000 and page.input_value(_sel("clip")) == "1000"


def test_the_seed_is_a_whole_number_from_zero_up(page, served):
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    _expand(page)
    assert _recipe(page)["seed"] is None
    _enter(page, _sel("seed"), "42")
    assert _recipe(page)["seed"] == 42
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, clipped at ±10, seed 42"
    for bad in ("-1", "1.5", "x", "1e3", ""):
        page.fill(_sel("seed"), bad)
        assert page.inner_text(_sel("seed-error")) == "Enter a whole number from 0 up."
        page.press(_sel("seed"), "Enter")
        assert _recipe(page)["seed"] == 42 and page.input_value(_sel("seed")) == "42", bad
    _enter(page, _sel("seed"), "0")
    assert _recipe(page)["seed"] == 0


def test_reset_to_defaults_puts_every_shared_setting_back(page, served):
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    _expand(page)
    _enter(page, _sel("clip"), "2")
    _enter(page, _sel("seed"), "5")
    page.select_option(_sel("input"), "counts")
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["input"]) == (2, 5, "counts")
    page.click(f"{S} .gsig-scoring__reset")
    r = _recipe(page)
    assert (r["clip"], r["seed"], r["input"], r["method"]) == (10, None, "X", "zscore_mean")
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, clipped at ±10"
    assert page.is_disabled(f"{S} .gsig-scoring__reset")


# ------------------------------------------------------------------ links and panel sets

def _link_of(page, served):
    root, store = served
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return view, f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def test_the_settings_are_in_the_link_and_the_panel_set_and_come_back_from_both(page, served):
    _open(page, served, plots=(("cell-plot-C", None),), sig_open=True)
    _wait_coloured(page)
    _expand(page)
    _enter(page, _sel("clip"), "3")
    _enter(page, _sel("seed"), "7")
    page.select_option(_sel("input"), "counts")
    view, url = _link_of(page, served)
    cfg = view["layout"]["panelConfigs"][SIG]
    assert (cfg["clip"], cfg["seed"], cfg["input"]) == (3, 7, "counts")
    assert "Float32" not in json.dumps(view)

    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(INIT)
    try:
        other.goto(url)
        other.wait_for_selector(f"{S} .gsig-scoring", timeout=30000)
        assert other.inner_text(f"{S} .gsig-scoring__summary") == "counts, clipped at ±3, seed 7"
        other.click(f"{S} .gsig-scoring__toggle")
        assert other.input_value(_sel("clip")) == "3" and other.input_value(_sel("seed")) == "7"
        assert other.input_value(_sel("input")) == "counts"
        r = other.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", SIG)
        assert (r["clip"], r["seed"], r["input"]) == (3, 7, "counts")
    finally:
        other.close()

    _save_set(page, "score-options")
    saved = page.evaluate("() => PanelManager.saveLayout()")
    assert '"clip": 3' in json.dumps(saved) and '"input": "counts"' in json.dumps(saved)
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
        assert (r["clip"], r["seed"], r["input"]) == (3, 7, "counts")
        assert fresh.inner_text(f"{S} .gsig-scoring__summary") == "counts, clipped at ±3, seed 7"
    finally:
        fresh.close()


def test_a_restored_config_moves_the_section_and_asks_what_the_new_input_looks_like(page, served):
    """Back and Forward, a reopened signature and a panel set all reach the panel through updateConfig."""
    calls = []
    page.route("**/api/v1/data/matrix_kind*", lambda route: (calls.append(route.request.url), route.fulfill(
        status=200, content_type="application/json", body=json.dumps({**LOGGED, "input": "counts"})))[1])
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 2, seed: 3, input: 'counts' })", SIG)
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "counts, clipped at ±2, seed 3"
    until(page, "() => true")
    page.wait_for_timeout(300)
    assert any("input=counts" in u for u in calls)
    page.evaluate("(id) => window.PanelManager.getPanel(id).updateConfig({ clip: 10, seed: null, input: 'X' })", SIG)
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "X, clipped at ±10"


# ------------------------------------------------------------------ the key

def test_the_score_key_changes_only_when_it_should(rec, served):
    page = rec
    _three_plots(page, served)
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

    # clip off: again only the z-score mean
    page.click(_sel("clipbox"))
    _wait_computes(page, 5)
    page.wait_for_timeout(500)
    assert _recipes(page)[-1]["clip"] is None and _recipes(page)[-1]["method"] == "zscore_mean"

    # the seed: only the control-adjusted score
    _enter(page, _sel("seed"), "9")
    _wait_computes(page, 6)
    page.wait_for_timeout(500)
    assert len(_recipes(page)) == 6
    last = _recipes(page)[-1]
    assert (last["method"], last["seed"]) == ("control_adjusted", 9)

    # the input: all three
    page.select_option(_sel("input"), "counts")
    _wait_computes(page, 9)
    assert sorted(r["method"] for r in _recipes(page)[-3:]) == ["control_adjusted", "mean", "zscore_mean"]
    assert {r["input"] for r in _recipes(page)[-3:]} == {"counts"}

    # entering a value that is already there asks nothing
    _enter(page, _sel("seed"), "9")
    page.wait_for_timeout(600)
    assert len(_recipes(page)) == 9


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
    # a clip of 3 or a seed of 4 would take 40 s; everything else is quick
    page.add_init_script("""window.__scoreFake = (kind, body, real) => {
        if (kind !== 'estimate') return undefined;
        const r = body.recipe;
        const seconds = (r.clip === 3 || r.seed === 4) ? 40 : 1;
        return new Response(JSON.stringify({ estimate: { seconds, tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5, layout: 'csc', entries: 1 },
            missing: [], duplicated: [], recipe: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };""")
    _three_plots(page, served)
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
    _open(page, served, plots=(), sig_open=True, wait=False)
    status = f"{S} .gsig-inputwarn[data-input-warning='status']"
    inline = f"{S} .gsig-inputwarn[data-input-warning='inline']"
    page.wait_for_selector(status, state="visible")
    text = page.inner_text(status)
    assert "X looks like raw counts (whole numbers up to 557)." in text
    assert "Scores should be computed on normalised, log-transformed data" in text
    assert "counts_log looks log-normalised." in text
    assert page.is_hidden(inline), "with Scoring collapsed the warning is in the status zone only"
    # open the section: the same warning moves under Input
    _expand(page)
    page.wait_for_selector(inline, state="visible")
    assert page.is_hidden(status)
    assert "looks like raw counts" in page.inner_text(inline)
    # choosing the layer that looks normalised clears it
    page.click(f"{inline} [data-use-input='counts_log']")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().input === 'counts_log'", SIG)
    page.wait_for_selector(inline, state="hidden")
    assert page.is_hidden(status) and page.input_value(_sel("input")) == "counts_log"
    assert page.inner_text(f"{S} .gsig-scoring__summary") == "counts_log, clipped at ±10"
    # back to X: it appears again, and is asked of the server once per input
    page.select_option(_sel("input"), "X")
    page.wait_for_selector(inline, state="visible")
    assert len([u for u in calls if "input=X" in u]) == 1, "the answer for X is kept"
    page.click(f"{S} .gsig-scoring__toggle")
    page.wait_for_selector(status, state="visible")


def test_a_layer_that_looks_like_counts_is_named_as_a_layer_and_log_values_get_no_warning(page, served):
    def handler(route):
        want = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("input", ["X"])[0]
        body = {**COUNTS, "input": want, "suggest": None} if want == "counts" else {**LOGGED, "input": want}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/data/matrix_kind*", handler)
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    page.wait_for_timeout(500)
    assert page.is_hidden(f"{S} .gsig-inputwarn[data-input-warning='status']"), "X looks log-normalised here"
    _expand(page)
    page.select_option(_sel("input"), "counts")
    page.wait_for_selector(f"{S} .gsig-inputwarn[data-input-warning='inline']", state="visible")
    text = page.inner_text(f"{S} .gsig-inputwarn[data-input-warning='inline']")
    assert text.startswith("Layer counts looks like raw counts")
    assert "looks log-normalised" not in text, "none to suggest"
    page.select_option(_sel("input"), "X")
    page.wait_for_selector(f"{S} .gsig-inputwarn[data-input-warning='inline']", state="hidden")


def test_a_failing_kind_route_leaves_the_panel_quiet(page, served):
    page.route("**/api/v1/data/matrix_kind*", lambda route: route.fulfill(status=500, content_type="application/json", body="{}"))
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    page.wait_for_timeout(500)
    assert page.is_hidden(f"{S} .gsig-inputwarn[data-input-warning='status']")
    assert page.is_hidden(f"{S} .gsig-inputwarn[data-input-warning='inline']")


def test_the_real_route_answers_for_the_store_and_the_layer_not_in_the_dataset_is_kept_listed(page, served):
    _open(page, served, plots=(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-scoring")
    got = page.evaluate("""async (store) => {
        const r = await fetch('/api/v1/data/matrix_kind?' + new URLSearchParams({ dataset_path: store, input: 'X' }));
        return { status: r.status, body: await r.json() };
    }""", served[1])
    assert got["status"] == 200 and got["body"]["input"] == "X" and got["body"]["kind"] == "log"
    assert got["body"]["suggest"] is None
    # a link naming a layer this dataset does not have still shows it, marked
    _enter_missing = _sig(input="not_a_layer")
    page2 = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    page2.add_init_script(INIT)
    try:
        _open(page2, served, plots=(), sig=_enter_missing, sig_open=True, wait=False)
        page2.wait_for_selector(f"{S} .gsig-scoring")
        page2.click(f"{S} .gsig-scoring__toggle")
        assert page2.eval_on_selector(_sel("input"), "s => s.options[s.selectedIndex].textContent") == "not_a_layer (not in this dataset)"
    finally:
        page2.close()


def test_the_section_says_where_the_aggregation_is_chosen_lists_them_and_shows_those_in_use(page, served):
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", color=MEAN)),
                               ("cell-plot-E", _cell("cell-plot-E", color=MEAN))), sig_open=True)
    _wait_coloured(page)
    _expand(page)
    body = page.inner_text(f"{S} .gsig-scoring__body")
    assert "How the genes are combined is chosen where the score is used" in body
    assert "pick gene-score as the source, then this signature, then the aggregation" in body
    items = page.eval_on_selector_all(f"{S} [data-aggregation]", "els => els.map(e => e.dataset.aggregation)")
    assert items == ["zscore_mean", "mean", "control_adjusted"]
    assert "less the average of control genes" in page.inner_text(f"{S} [data-aggregation='control_adjusted']")
    until(page, "(s) => /In use now: Z-score mean \\(1\\), Mean \\(2\\)\\./.test(document.querySelector(s + ' [data-aggregations-in-use]').textContent)", S)
