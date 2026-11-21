"""Progress bars for long waits, and one painter per host, in a real browser (FX-H; operator decision 21; browser
review H3 and O2).

The store and the fake score route are test_gene_score_plots.py's: the estimate and the stream are the test's.

1. A slow score (the estimate over 10 s) shows a DETERMINATE bar beside its sentence, from the stored entries, with
   role=progressbar, aria-valuenow and the sentence as aria-valuetext; the bar goes when the score is ready.
2. A short job keeps its text line; once it has run 10 s by the page's clock it shows a bar too.
3. A job waiting in the server's line shows an INDETERMINATE bar (no aria-valuenow) and its place in line; once it
   runs, the bar fills from the entries.
4. One painter per host: a second provider on the same plot (here a stand-in built on the same binding) keeps its
   notice when the score's events repaint the plot, its Compute goes to it and not to the score, and the other plot
   that shares the score shows the score's own notice.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_gene_score_plots as gs  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.waits import expect_stays  # noqa: E402

C = gs.C
C2 = gs.C2


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


def _bar(page, tile=C, where=".score-notice"):
    """The progress bar in the notice (or the placeholder): its mode and ARIA, or None."""
    return page.evaluate("""([tile, where]) => {
        const el = document.querySelector(tile + ' ' + where + ' .source-progress');
        if (!el) return null;
        const fill = el.querySelector('.source-progress__fill');
        return { mode: el.dataset.mode, role: el.getAttribute('role'), min: el.getAttribute('aria-valuemin'),
                 max: el.getAttribute('aria-valuemax'), now: el.getAttribute('aria-valuenow'),
                 text: el.getAttribute('aria-valuetext'), width: fill ? fill.style.width : null };
    }""", [tile, where])


def _bar_mode(page, mode, tile=C):
    until(page, "([t, m]) => { const b = document.querySelector(t + ' .score-notice .source-progress'); return !!b && b.dataset.mode === m; }",
          [tile, mode])


def test_a_slow_score_shows_a_determinate_bar_beside_its_sentence(page, served):
    gs._slow(page, "auto", 59)
    gs._open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    gs._frame(page, 0, type="progress", done=61, total=200, entries_done=300, entries_total=1200, running_s=1,
              queue={"ahead": 0, "sharing": 0})
    _bar_mode(page, "determinate")
    bar = _bar(page)
    assert bar["role"] == "progressbar"
    assert (bar["min"], bar["max"], bar["now"]) == ("0", "100", "25"), "300 of 1,200 stored entries"
    assert bar["width"] == "25%"
    note = gs._notice(page)
    assert note["state"] == "computing"
    assert "Computing 'T cell score': 61 of 200 genes." in note["text"], "the existing sentence, beside the bar"
    assert bar["text"] == "Computing 'T cell score': 61 of 200 genes. This plot has no colour."
    assert any(a.startswith("score-cancel|Cancel") for a in note["actions"])
    # time left, once 10% of the entries and 5 s of running are behind it
    gs._frame(page, 0, type="progress", done=120, total=200, entries_done=600, entries_total=1200, running_s=60,
              queue={"ahead": 0, "sharing": 0})
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('seconds left')", C)
    # 600 of 1,200 entries in 60 s of running: 60 s more
    assert "Computing 'T cell score': 120 of 200 genes · about 60 seconds left." in gs._notice(page)["text"]
    assert _bar(page)["now"] == "50"
    gs._finish(page, 0)
    gs._wait_coloured(page)
    assert gs._notice(page) is None and _bar(page) is None


def test_a_short_job_keeps_its_line_and_gets_a_bar_after_ten_seconds(page, served):
    gs._slow(page, "auto", 3)
    gs._open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    gs._frame(page, 0, type="progress", done=1, total=2)
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('1 of 2 genes')", C)
    expect_stays(lambda: _bar(page) is None, "a short job has no bar: nothing event-driven marks its absence", page=page, seconds=1.0)
    # no frame arrives meanwhile: the page's own clock brings the bar at 10 s
    page.wait_for_selector(f"{C} .score-notice .source-progress[data-mode='determinate']", timeout=15000)
    assert _bar(page)["now"] == "50"
    gs._finish(page, 0)
    gs._wait_coloured(page)
    assert _bar(page) is None


def test_a_queued_job_shows_an_indeterminate_bar_and_its_place_in_line(page, served):
    gs._slow(page, "auto", 30)
    gs._open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    gs._frame(page, 0, type="progress", done=0, total=2, entries_done=0, entries_total=1200, running_s=0,
              queue={"ahead": 2, "sharing": 0})
    page.wait_for_selector(f"{C} .score-notice[data-state='queued']", timeout=15000)
    _bar_mode(page, "indeterminate")
    bar = _bar(page)
    assert bar["role"] == "progressbar"
    assert bar["now"] is None, "no aria-valuenow while indeterminate"
    assert bar["text"].startswith("Waiting for the server: 2 computations ahead.")
    note = gs._notice(page)
    assert "Waiting for the server: 2 computations ahead." in note["text"]
    assert "Groupings and counts keep working." in note["text"]
    assert gs._tag(page) == "Score queued"
    # its turn comes: the bar fills from the entries
    gs._frame(page, 0, type="progress", done=1, total=2, entries_done=900, entries_total=1200, running_s=2,
              queue={"ahead": 0, "sharing": 0})
    _bar_mode(page, "determinate")
    assert _bar(page)["now"] == "75"
    gs._finish(page, 0)
    gs._wait_coloured(page)
    assert _bar(page) is None


# A second provider on plot C, made with the page's own host binding and action registry (G8a's grouping will be one).
SECOND = """async () => {
  const HB = await import('/static/js/utils/host-binding.js');
  const A = await import('/static/js/utils/source-actions.js');
  const SN = await import('/static/js/utils/source-notices.js');
  const vocabulary = { thing: 'grouping', source: 'grouping', result: 'grouping', Computing: 'Computing' };
  window.__second = { computed: 0, handle: null };
  const binding = HB.createHostBinding({
    id: 'plot-second',
    open: (host, role, setting, onChange) => {
      const handle = { snap: { state: 'awaiting', title: 'Grouping 1', key: 'g1', estimate: { seconds: 120 } },
        read() { return this.snap; }, release() {}, sharers: () => 1,
        set(snap) { this.snap = snap; onChange(snap); } };
      window.__second.handle = handle;
      return { handle };
    },
    matches: () => true,
    describe: (snap, ctx) => SN.describeSource(snap, ctx, vocabulary)
  });
  A.actions.register({ id: 'plot-second', owns: (host) => binding.recordsOf(host).size > 0,
    actions: { 'score-compute': { target: (host) => (binding.recordsOf(host).size ? host : null),
      run: () => { window.__second.computed++; window.__second.handle.set({ state: 'ready', title: 'Grouping 1', key: 'g1', values: [1] }); } } } });
  const host = document.querySelector('#plot-container-cell-plot-C');
  binding.recordFor(host, 'size', { key: 'cell-grouping-1' });
  binding.paint(host);
}"""


def test_one_painter_per_host_two_providers_on_one_plot_and_a_shared_score(page, served):
    gs._slow(page, "auto", 3)
    gs._open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", gs._cell("cell-plot-D", "Cell Plot 2"))), wait=False)
    until(page, "() => window.__ctls.length === 1")
    gs._frame(page, 0, type="progress", done=1, total=4)
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('1 of 4 genes')", C)
    page.evaluate(SECOND)
    page.wait_for_selector(f"{C} .score-notice[data-state='awaiting']", timeout=15000)
    note = gs._notice(page)
    assert "'Grouping 1' will take about 2 minutes." in note["text"], "the worst notice of the two providers"
    # the score's events repaint both plots: plot C keeps the second provider's notice, plot D says the score's
    gs._frame(page, 0, type="progress", done=2, total=4)
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('2 of 4 genes')", C2)
    assert gs._notice(page)["state"] == "awaiting", "a score event does not wipe the other provider's notice"
    assert "Cancel for 2 plots" in gs._notice(page, C2)["text"], "the shared score's notice on the other plot"
    # its Compute computes it, not the score (the score provider was registered first)
    computes = len(gs._calls(page, "compute"))
    gs._action(page, "score-compute")
    until(page, "() => window.__second.computed === 1")
    assert len(gs._calls(page, "compute")) == computes, "the score was not asked again"
    assert not gs._calls(page, "compute")[-1]["confirm"]
    # with the second provider ready, the plot says the score's state again
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'computing'; }", C)
    assert "2 of 4 genes" in gs._notice(page)["text"]
    gs._finish(page, 0)
    gs._wait_coloured(page)
    gs._wait_coloured(page, C2)
    assert gs._notice(page) is None and gs._notice(page, C2) is None
