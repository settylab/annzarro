"""The status strip's slim progress bar (static/js/utils/panel-surface.js setStatusProgress), in a real browser.

A strip that is not persistent (a table's) is removed when it has nothing to say; a bar is something to say, so the
strip stays while it holds one and goes when the bar is taken away. The bar is a role=progressbar with the sentence
as aria-valuetext, aria-valuenow only while determinate, and its fill width set from the page.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_gene_score_plots as gs  # noqa: E402


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    proc, root, store = gs._served(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = gs._new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


STRIP = """async ([step]) => {
  const PS = await import('/static/js/utils/panel-surface.js');
  const { Coverage } = await import('/static/js/utils/coverage.js');
  let host = document.getElementById('az-test-host');
  if (!host) {
    const box = document.createElement('div');
    host = document.createElement('div');
    host.id = 'az-test-host';
    box.appendChild(host);
    document.body.appendChild(box);
    // a table's strip: not persistent, and nothing missing, so there is no strip
    PS.renderCoverageNotice(host, Coverage.complete(10, 'cells'), 'cells');
  }
  if (step === 'determinate') PS.setStatusProgress(host, { determinate: true, pct: 40, sentence: 'Computing it: 4 of 10.', text: 'about 1 minute left' });
  if (step === 'indeterminate') PS.setStatusProgress(host, { determinate: false, sentence: 'Waiting for the server: 1 computation ahead.', text: 'Score queued' });
  if (step === 'clear') PS.setStatusProgress(host, null);
  const strip = host.parentNode.querySelector('.plot-status');
  const bar = strip && strip.querySelector('.ps-progress .source-progress');
  return { strip: !!strip, bar: bar && { role: bar.getAttribute('role'), mode: bar.dataset.mode, now: bar.getAttribute('aria-valuenow'),
    min: bar.getAttribute('aria-valuemin'), max: bar.getAttribute('aria-valuemax'), valuetext: bar.getAttribute('aria-valuetext'),
    width: bar.querySelector('.source-progress__fill').style.width,
    text: strip.querySelector('.ps-progress-text') ? strip.querySelector('.ps-progress-text').textContent : null } };
}"""


def test_a_strip_that_is_not_persistent_stays_while_it_holds_a_bar_and_clears_after(page, served):
    gs._open(page, served, sig=False, plots=(("cell-plot-C", gs._cell("cell-plot-C", color={"type": "obs", "key": "score"})),))
    assert page.evaluate(STRIP, ["none"]) == {"strip": False, "bar": None}, "nothing missing: no strip"
    got = page.evaluate(STRIP, ["determinate"])
    assert got["strip"], "a bar keeps the strip"
    assert got["bar"] == {"role": "progressbar", "mode": "determinate", "now": "40", "min": "0", "max": "100",
                          "valuetext": "Computing it: 4 of 10.", "width": "40%", "text": "about 1 minute left"}
    got = page.evaluate(STRIP, ["indeterminate"])
    assert got["bar"]["mode"] == "indeterminate" and got["bar"]["now"] is None and got["bar"]["text"] == "Score queued"
    assert page.evaluate(STRIP, ["clear"]) == {"strip": False, "bar": None}, "the bar gone, the strip goes"


def _summary(page, tile=gs.C):
    return page.evaluate("(t) => { const s = document.querySelector(t + ' .plot-status'); return s ? s.getAttribute('data-summary') : null; }", tile)


def test_the_strip_says_a_score_is_not_ready_not_available_or_not_in_this_dataset(page, served):
    wait = "([t, w]) => ((document.querySelector(t + ' .plot-status') || {getAttribute: () => ''}).getAttribute('data-summary') || '').includes(w)"
    # none of its genes in the dataset (the real route): truly not in this dataset
    gs._open(page, served, sig=gs._sig(genes=("NOT_A_GENE", "NOR_THIS")))
    page.wait_for_selector(f"{gs.C} .score-notice[data-state='noscore']", timeout=30000)
    gs.until(page, wait, [gs.C, "gene score"])
    assert "gene score T cell score: not in this dataset" in _summary(page)
    # computing: not ready yet (it said "not in this dataset", which was false)
    page.goto("about:blank")
    gs._slow(page, "auto", 3)
    gs._open(page, served, wait=False)
    page.wait_for_selector(f"{gs.C} .score-notice[data-state='computing']", timeout=30000)
    gs.until(page, wait, [gs.C, "gene score"])
    assert "gene score T cell score: not ready yet" in _summary(page)
    assert "not in this dataset" not in _summary(page)
    # refused: not available
    page.goto("about:blank")
    gs._slow(page, "refused", 1500, refuse="Too large. Use fewer genes.")
    gs._open(page, served, wait=False)
    page.wait_for_selector(f"{gs.C} .score-notice[data-state='refused']", timeout=30000)
    gs.until(page, wait, [gs.C, "not available"])
    assert "gene score T cell score: not available" in _summary(page)
