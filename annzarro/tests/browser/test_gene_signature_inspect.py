"""Inspect, in the Gene Signature panel (step 7 of the gene-signature plan), in a real browser.

Inspect is one disclosure button under the gene list. Opened, it shows the distribution of the
score over the cells shown (a histogram that counts the cells with no score), the figures of each
gene from the server's `result` frame, plain-words flags, a sortable table whose rows focus the
gene, and two CSV exports built in the browser from the held Float32Array.

The store is the one of test_gene_score_plots (60 cells, 3,000 genes). Where a test needs figures
or states the real server does not produce (a barely detected gene, cells with no score, a score
that asks first), the page's `fetch` is replaced for the score route, as there.

1.  Closed by default: the first view is the gene list and nothing is computed.
2.  Opening computes, and the figures are the server's.
3.  A plot that holds the score is not asked again; the other aggregation is a second score and
    going back to the first is not a request.
4.  The histogram: bins add up to the cells, a tooltip per bin by pointer and by keyboard.
5.  Cells with no score are counted and said.
6.  Flags in plain words; the table sorts; a click on a gene focuses it.
7.  Export: the gene figures and the score of each cell, with names, equal to what the plot holds.
8.  Every state: computing with Cancel, asks first, cancelled, refused, failed with Retry,
    out of date behind Update score, no genes.
9.  Keyboard and ARIA.
10. Light and dark.
11. Closing the section lets go of the score; narrow panels.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import csv
import io
import json
import re

import pytest

from annzarro.tests.browser import test_gene_score_plots as base
from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401  (fixtures)
    C, S, SIG, N_OBS, RAMP, page, served, _open, _sig, _calls, _numbers, _wait_coloured, _slow, _finish, _frame,
)
from annzarro.tests.browser.test_memory_guard import until

I = f"{S} .gsig-inspect"
TOGGLE = f"{I} .gsig-inspect__toggle"


def _open_panel(page, served, sig=None, plots=(), **kw):
    """The signature open, with no plot unless asked for."""
    page.add_init_script(f"window.__ramp = {json.dumps([float(i) for i in range(N_OBS)])};")
    _open(page, served, plots=plots, sig=sig or _sig(), sig_open=True, wait=False, **kw)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)


def _inspect(page):
    page.click(TOGGLE)
    assert page.get_attribute(TOGGLE, "aria-expanded") == "true"


def _wait_table(page):
    page.wait_for_selector(f"{I} .gsig-inspect__genes tbody tr", timeout=30000)


def _server_header(page, genes, method="zscore_mean", clip=10):
    """The real route's `result` frame for these genes (the first JSON line after the progress frames)."""
    return page.evaluate("""async ([dataset, genes, method, clip]) => {
        const url = '/api/v1/data/gene_score?' + new URLSearchParams({ dataset_path: dataset });
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipe: { genes, down: [], input: 'X', method, clip, seed: null, version: 1 } }) });
        const text = await r.text();
        for (const line of text.split('\\n')) {
            if (!line.startsWith('{')) continue;
            const o = JSON.parse(line);
            if (o.type === 'result') return o;
        }
        return { error: text.slice(0, 200), status: r.status };
    }""", [page.evaluate("() => new URLSearchParams(location.search).get('dataset_path')"), genes, method, clip])


def _rows(page):
    """The table: {gene: [detected, mean, sd, clipped] as text}."""
    return page.evaluate("""(I) => Object.fromEntries([...document.querySelectorAll(I + ' .gsig-inspect__genes tbody tr')].map(tr => [
        tr.dataset.gene, ['detected', 'mean', 'sd', 'clipped'].map(k => tr.querySelector('.gsig-col-' + k).textContent.trim())]))""", I)


def _order(page):
    return page.evaluate("(I) => [...document.querySelectorAll(I + ' .gsig-inspect__genes tbody tr')].map(tr => tr.dataset.gene)", I)


def _bins(page):
    return page.evaluate("(I) => window.PanelManager.getPanel('gene-signature-S')._inspect()._debug().dist.counts", I)


def _near(text, expected, rel=0.006, pct=False):
    got = float(text.rstrip("%")) / (100 if pct else 1)
    return abs(got - expected) <= max(abs(expected) * rel, 6e-4 if pct else 1e-3)


def _fake_header(genes, **extra):
    return dict(genes=genes, n_cells=N_OBS, n_shown=N_OBS, n_used=len([g for g in genes if g["status"] == "used"]), **extra)


def _g(name, **kw):
    return {"name": name, "column": 0, "status": "used", "mean": 1.0, "sd": 1.0, "detected": 0.4, "clipped": 0.0, **kw}


# ------------------------------------------------------------------------ 1, 2

def test_inspect_is_closed_by_default_and_computes_nothing_until_opened(page, served):
    _open_panel(page, served)
    assert page.get_attribute(TOGGLE, "aria-expanded") == "false"
    assert not page.is_visible(f"{I} .gsig-inspect__body")
    assert page.is_visible(f"{S} .gsig-grid"), "the first view stays the gene list"
    page.wait_for_timeout(600)
    assert _calls(page) == [], "nothing is asked for a score that nobody opened"
    assert page.inner_text(f"{TOGGLE} .gsig-inspect__summary") == "Distribution and figures of each gene"


def test_opening_computes_and_the_figures_are_the_servers(page, served):
    genes = ["GENE0001", "GENE0002", "GENE0003"]
    _open_panel(page, served, sig=_sig(genes=genes))
    _inspect(page)
    _wait_table(page)
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"]
    header = _server_header(page, genes)
    assert header["type"] == "result", header
    rows = _rows(page)
    assert sorted(rows) == sorted(genes)
    for g in header["genes"]:
        det, mean, sd, clipped = rows[g["name"]]
        assert _near(det, g["detected"], pct=True), (g, det)
        assert _near(mean, g["mean"]), (g, mean)
        assert _near(sd, g["sd"]), (g, sd)
        assert clipped == "0%" or _near(clipped, g["clipped"], pct=True), (g, clipped)
    # the summary beside the button and the figures under the histogram describe the score held
    summary = page.inner_text(f"{TOGGLE} .gsig-inspect__summary")
    assert re.fullmatch(r"Mean -?[\d.e-]+, SD [\d.e-]+, 60 cells", summary), summary
    assert page.inner_text(f"{I} .gsig-inspect__heading") == "Score distribution, 60 cells shown"
    assert sum(_bins(page)) == N_OBS
    assert "No cell is missing a score." == page.inner_text(f"{I} .gsig-inspect__missing")
    assert "Z-score mean of X, clipped at ±10." == page.inner_text(f"{I} .gsig-inspect__definition")
    assert page.inner_text(f"{I} .gsig-inspect__note") == "Per-gene figures use all cells of the dataset."


# --------------------------------------------------------------------------- 3

def test_a_plot_that_holds_the_score_means_no_second_request(page, served):
    _open_panel(page, served, plots=(("cell-plot-C", None),))
    _wait_coloured(page)
    before = _calls(page)
    assert [c["kind"] for c in before] == ["estimate", "compute"]
    _inspect(page)
    _wait_table(page)
    page.wait_for_timeout(500)
    assert _calls(page) == before, "the score the plot holds is the score inspected"
    # and what is inspected is the plot's own vector
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S')._inspect()._debug().state") == "ready"
    assert sum(_bins(page)) == len(_numbers(page)) == N_OBS


def test_each_aggregation_is_offered_and_a_second_one_is_a_second_score_only_once(page, served):
    _open_panel(page, served)
    _inspect(page)
    _wait_table(page)
    labels = page.eval_on_selector_all(f"{I} .gsig-inspect__agg [role=radio]", "els => els.map(e => e.textContent + '|' + e.getAttribute('aria-checked'))")
    assert labels == ["Z-score mean|true", "Mean expression|false"]
    assert len(_calls(page, "compute")) == 1
    page.click(f"{I} .gsig-inspect__agg [data-method=mean]")
    until(page, "(I) => /Mean expression of X/.test((document.querySelector(I + ' .gsig-inspect__definition') || {}).textContent || '')", I)
    page.wait_for_function("(I) => !!document.querySelector(I + ' .gsig-inspect__genes tbody tr')", arg=I)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute' && c.method === 'mean').length === 1")
    assert page.inner_text(f"{I} .gsig-inspect__definition") == "Mean expression of X."
    assert _rows(page)["GENE0001"][3] == "n/a", "a plain mean clips nothing"
    # back to the first: held, so no request
    n = len(_calls(page))
    page.click(f"{I} .gsig-inspect__agg [data-method=zscore_mean]")
    until(page, "(I) => /Z-score mean/.test(document.querySelector(I + ' .gsig-inspect__definition').textContent)", I)
    page.wait_for_timeout(400)
    assert len(_calls(page)) == n


def test_the_aggregation_a_plot_shows_is_the_one_inspected_first(page, served):
    cell = base._cell("cell-plot-C", color={"type": "gene-score", "key": SIG, "label": "T cell score", "column": "mean"})
    _open(page, served, plots=(("cell-plot-C", cell),), sig=_sig(), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    until(page, "() => window.__scoreCalls.some(c => c.kind === 'compute')")
    _inspect(page)
    assert page.get_attribute(f"{I} [data-method=mean]", "aria-checked") == "true"


# --------------------------------------------------------------------------- 4

def test_the_histogram_has_a_tooltip_per_bin_by_pointer_and_keyboard(page, served):
    _open_panel(page, served)
    _inspect(page)
    _wait_table(page)
    bins = _bins(page)
    assert len(bins) == 30 and sum(bins) == N_OBS
    hit = page.query_selector_all(f"{I} .gsig-hist__hit")
    assert len(hit) == 30
    # every bar is thin: at most 24 px, and there is no stroke on a mark
    widths = page.eval_on_selector_all(f"{I} .gsig-hist__bar", "els => els.map(e => e.getBoundingClientRect().width)")
    assert widths and max(widths) <= 24.01
    assert page.eval_on_selector_all(f"{I} .gsig-hist__bar", "els => els.every(e => getComputedStyle(e).strokeWidth === '0px' || getComputedStyle(e).stroke === 'none')")
    hit[3].hover()
    tip = page.inner_text(f"{I} .gsig-hist__tip")
    n = bins[3]
    assert re.fullmatch(rf".+ to .+: {n} cell{{0,1}}s? \(\d+\.\d%\)", tip) or n == 0, tip
    assert page.evaluate("(I) => document.querySelector(I + ' .gsig-hist__tip').classList.contains('is-shown')", I)
    page.mouse.move(0, 0)
    assert not page.evaluate("(I) => document.querySelector(I + ' .gsig-hist__tip').classList.contains('is-shown')", I)
    # keyboard: the chart is one tab stop, arrows read the bars
    page.focus(f"{I} .gsig-hist__group")
    first = page.inner_text(f"{I} .gsig-hist__tip")
    assert first.startswith(page.evaluate("(I) => document.querySelector(I + ' .gsig-hist__tip').textContent.split(' to ')[0]", I))
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    assert page.get_attribute(f"{I} .gsig-hist__tip", "data-bin") == "2"
    page.keyboard.press("End")
    assert page.get_attribute(f"{I} .gsig-hist__tip", "data-bin") == "29"
    page.keyboard.press("Home")
    assert page.get_attribute(f"{I} .gsig-hist__tip", "data-bin") == "0"
    assert page.get_attribute(f"{I} .gsig-hist__group", "role") == "group"
    assert "arrow keys" in page.get_attribute(f"{I} .gsig-hist__group", "aria-label")


# --------------------------------------------------------------------------- 5

def test_cells_with_no_score_are_counted_and_said(page, served):
    _slow(page, "auto", 1)
    _open_panel(page, served)
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    values = [float(i) for i in range(N_OBS)]
    values_js = [None if i in (3, 4, 5) else v for i, v in enumerate(values)]
    page.evaluate("""([v, h]) => window.__finish(0, v.map(x => x === null ? NaN : x), h)""",
                  [values_js, _fake_header([_g("GENE0001"), _g("GENE0002")])])
    _wait_table(page)
    assert page.inner_text(f"{I} .gsig-inspect__missing") == "3 cells have no score (every gene is missing there) and are not in the histogram."
    assert "Missing 3" in page.inner_text(f"{I} .gsig-inspect__figures")
    assert sum(_bins(page)) == N_OBS - 3
    assert page.inner_text(f"{I} .gsig-inspect__heading") == "Score distribution, 60 cells shown"


# --------------------------------------------------------------------------- 6

FLAGGED = [_g("COMMON", detected=0.9, mean=3.0, sd=2.0, clipped=0.0),
           _g("RARE", detected=0.004, mean=0.01, sd=0.1, clipped=0.0),
           _g("CLIPPER", detected=0.02, mean=0.5, sd=1.5, clipped=0.032),
           _g("FLAT", status="constant", detected=1.0, mean=2.0, sd=0.0, clipped=None)]


def _fake_open(page, served, genes=FLAGGED, **kw):
    _slow(page, "auto", 1)
    _open_panel(page, served, **kw)
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("([h]) => window.__finish(0, window.__ramp, h)", [_fake_header(genes)])


def test_genes_that_dominate_or_are_barely_detected_are_flagged_in_plain_words(page, served):
    page.add_init_script(f"window.__ramp = {json.dumps([float(i) for i in range(N_OBS)])};")
    _fake_open(page, served)
    _wait_table(page)
    flags = page.evaluate("""(I) => Object.fromEntries([...document.querySelectorAll(I + ' .gsig-inspect__genes tbody tr')].map(tr =>
        [tr.dataset.gene, [...tr.querySelectorAll('.gsig-inspect__flag')].map(f => f.textContent)]))""", I)
    assert flags["COMMON"] == []
    assert flags["RARE"] == ["Barely detected: non-zero in 0.4% of cells, so a few cells set what it adds."]
    assert flags["CLIPPER"] == ["Dominates: clipped in 3.2% of cells, where it outweighs the other genes."]
    assert flags["FLAT"] == ["Left out: the same value in every cell."]
    assert page.inner_text(f"{I} .gsig-inspect__flags") == "1 gene dominates the score, 1 is barely detected, 1 was left out."
    assert page.inner_text(f"{I} tr[data-gene=CLIPPER] .gsig-col-clipped") == "3.2%"


def test_the_gene_table_sorts_and_a_click_on_a_gene_focuses_it(page, served):
    page.add_init_script(f"window.__ramp = {json.dumps([float(i) for i in range(N_OBS)])};"
                         "window.__focused = []; document.addEventListener('focusedGeneChanged', e => window.__focused.push(e.detail.gene));")
    _fake_open(page, served)
    _wait_table(page)
    assert _order(page) == ["CLIPPER", "COMMON", "FLAT", "RARE"], "by name to begin with"
    assert page.get_attribute(f"{I} th.gsig-col-name", "aria-sort") == "ascending"
    page.click(f"{I} [data-sort=detected]")
    assert _order(page) == ["FLAT", "COMMON", "CLIPPER", "RARE"], "a number sorts large first"
    assert page.get_attribute(f"{I} th.gsig-col-detected", "aria-sort") == "descending"
    page.click(f"{I} [data-sort=detected]")
    assert _order(page) == ["RARE", "CLIPPER", "COMMON", "FLAT"]
    page.click(f"{I} [data-sort=clipped]")
    assert _order(page)[0] == "CLIPPER"
    assert _order(page)[-1] == "FLAT", "a gene with no figure sorts last"
    page.click(f"{I} [data-sort=name]")
    assert _order(page) == ["CLIPPER", "COMMON", "FLAT", "RARE"]
    page.click(f"{I} tr[data-gene=RARE] .gsig-inspect__gene")
    assert page.evaluate("() => window.__focused")[-1] == "RARE"
    # the sort button keeps the focus after the table is drawn again
    page.click(f"{I} [data-sort=sd]")
    assert page.evaluate("() => document.activeElement.dataset.sort") == "sd"


def test_a_long_gene_list_shows_the_first_hundred_and_offers_all(page, served):
    genes = [_g(f"G{i:03d}") for i in range(250)]
    page.add_init_script(f"window.__ramp = {json.dumps([float(i) for i in range(N_OBS)])};")
    _fake_open(page, served, genes=genes)
    _wait_table(page)
    assert len(_order(page)) == 100
    page.click(f"{I} [data-inspect-action=show-all]")
    assert len(_order(page)) == 250


# --------------------------------------------------------------------------- 7

def _download(page, button):
    with page.expect_download() as info:
        page.click(f"{I} [data-inspect-export={button}]")
    path = info.value.path()
    return info.value.suggested_filename, open(path, encoding="utf-8").read()


def test_export_of_the_gene_figures_and_of_the_score_of_each_cell(page, served):
    genes = ["GENE0001", "GENE0002", "GENE0003"]
    _open_panel(page, served, sig=_sig(genes=genes), plots=(("cell-plot-C", None),))
    _wait_coloured(page)
    held = _numbers(page)
    _inspect(page)
    _wait_table(page)
    header = _server_header(page, genes)

    name, text = _download(page, "genes")
    assert name == "T_cell_score_zscore_mean_genes.csv"
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == ["gene", "status", "detected_fraction", "mean", "sd", "clipped_fraction"]
    assert [r[0] for r in rows[1:]] == [g["name"] for g in header["genes"]]
    for r, g in zip(rows[1:], header["genes"]):
        assert float(r[2]) == pytest.approx(g["detected"]) and float(r[3]) == pytest.approx(g["mean"]) and float(r[4]) == pytest.approx(g["sd"])

    name, text = _download(page, "scores")
    assert name == "T_cell_score_zscore_mean_scores.csv"
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == ["cell", "score"]
    assert [r[0] for r in rows[1:]] == [f"c{i}" for i in range(N_OBS)]
    assert len(rows) == N_OBS + 1
    exported = [float(r[1]) for r in rows[1:]]
    assert exported == pytest.approx(held, rel=1e-6, abs=1e-6), "the file is the vector the plot holds"
    assert "Exported the score of 60 cells." == page.inner_text(f"{I} .gsig-inspect__result")


def test_export_leaves_cells_without_a_score_empty(page, served):
    _slow(page, "auto", 1)
    _open_panel(page, served)
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    vals = [None if i == 7 else i / 10 for i in range(N_OBS)]
    page.evaluate("([v, h]) => window.__finish(0, v.map(x => x === null ? NaN : x), h)", [vals, _fake_header([_g("GENE0001")])])
    _wait_table(page)
    _, text = _download(page, "scores")
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[8] == ["c7", ""]
    assert rows[2] == ["c1", "0.1"]


# --------------------------------------------------------------------------- 8

def _state(page):
    return page.evaluate("""(I) => { const el = document.querySelector(I + ' .gsig-inspect__state');
        return el.hidden ? null : { state: el.dataset.state, text: el.querySelector('.gsig-inspect__statetext').textContent.trim(),
            actions: [...el.querySelectorAll('button')].map(b => b.textContent.trim()) }; }""", I)


def test_computing_shows_progress_with_cancel_and_cancelled_offers_compute(page, served):
    _slow(page, "auto", 3)
    _open_panel(page, served)
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    _frame(page, 0, type="progress", done=31, total=50)
    until(page, "(I) => /31 of 50 genes/.test(document.querySelector(I + ' .gsig-inspect__state').textContent)", I)
    st = _state(page)
    assert st["actions"] == ["Cancel"] and st["state"] == "computing"
    assert not page.is_visible(f"{I} .gsig-inspect__content")
    page.click(f"{I} [data-inspect-action=score-cancel]")
    until(page, "(I) => document.querySelector(I + ' .gsig-inspect__state').dataset.state === 'cancelled'", I)
    st = _state(page)
    assert st["text"] == "'T cell score' was cancelled." and st["actions"] == ["Compute"]
    page.click(f"{I} [data-inspect-action=score-compute]")
    until(page, "() => window.__ctls.length === 2")
    page.evaluate("(h) => window.__finish(1, window.__ramp, h)", _fake_header([_g("GENE0001")]))
    _wait_table(page)
    assert _state(page) is None


def test_a_score_that_asks_first_waits_for_one_click(page, served):
    _slow(page, "confirm", 120)
    _open_panel(page, served)
    _inspect(page)
    until(page, "(I) => (document.querySelector(I + ' .gsig-inspect__state') || {}).dataset && document.querySelector(I + ' .gsig-inspect__state').dataset.state === 'awaiting'", I)
    st = _state(page)
    assert st["text"] == "'T cell score' will take about 2 minutes." and st["actions"] == ["Compute"]
    assert _calls(page, "compute") == [], "asking is not computing"
    page.click(f"{I} [data-inspect-action=score-compute]")
    until(page, "() => window.__ctls.length === 1")
    assert _calls(page, "compute")[0]["confirm"] is True


def test_a_refused_score_says_why_and_a_failed_one_can_be_retried(page, served):
    _slow(page, "refused", 2000, refuse="This score would take about 33 minutes; the limit is 10. Use fewer genes.")
    _open_panel(page, served)
    _inspect(page)
    until(page, "(I) => (document.querySelector(I + ' .gsig-inspect__state') || {}).dataset && document.querySelector(I + ' .gsig-inspect__state').dataset.state === 'refused'", I)
    st = _state(page)
    assert "would take about 33 minutes, so it was not run." in st["text"]
    assert "Use fewer genes." in st["text"]
    assert st["actions"] == [], "Open signature and Choose another belong to a plot"
    assert not page.is_visible(f"{I} .gsig-inspect__content")


def test_a_failed_score_says_why_and_retry_asks_again(page, served):
    page.add_init_script("window.__ramp = %s;" % json.dumps([float(i) for i in range(N_OBS)]))
    _slow(page, "auto", 3)
    _open_panel(page, served)
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("() => window.__error(0, 'read_failed', 'Failed to read the dataset: the server stopped responding')")
    until(page, "(I) => (document.querySelector(I + ' .gsig-inspect__state') || {}).dataset && document.querySelector(I + ' .gsig-inspect__state').dataset.state === 'failed'", I)
    st = _state(page)
    assert st["text"] == "'T cell score' could not be computed: Failed to read the dataset: the server stopped responding."
    assert st["actions"] == ["Retry"]
    page.click(f"{I} [data-inspect-action=score-retry]")
    until(page, "() => window.__ctls.length === 2")
    page.evaluate("(h) => window.__finish(1, window.__ramp, h)", _fake_header([_g("GENE0001")]))
    _wait_table(page)


def test_a_signature_with_no_genes_says_to_tick_some(page, served):
    _open_panel(page, served, sig=_sig(genes=()))
    _inspect(page)
    until(page, "(I) => !document.querySelector(I + ' .gsig-inspect__state').hidden", I)
    assert _state(page)["text"] == "Tick genes to inspect their score."
    assert _calls(page) == []


def test_an_edit_that_is_held_keeps_the_previous_score_and_update_applies_it(page, served):
    page.add_init_script("window.__ramp = %s;" % json.dumps([float(i) for i in range(N_OBS)]))
    _slow(page, "auto", 30)           # 30 s: edits collect behind Update score
    _open_panel(page, served, plots=())
    _inspect(page)
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("(h) => window.__finish(0, window.__ramp, h)", _fake_header([_g("GENE0001")]))
    _wait_table(page)
    page.click(f"{S} .gsig-seg >> nth=0")        # All genes
    page.fill(f"{S} .gsig-search", "GENE0005")
    page.keyboard.press("Enter")
    until(page, "(I) => (document.querySelector(I + ' .gsig-inspect__state') || {}).dataset && document.querySelector(I + ' .gsig-inspect__state').dataset.state === 'held'", I)
    st = _state(page)
    assert st["text"].startswith("Showing the previous 'T cell score'. 1 change is not applied.")
    assert st["actions"] == ["Update score"]
    assert page.is_visible(f"{I} .gsig-inspect__content"), "the previous figures stay on show"
    n = len(_calls(page, "compute"))
    page.click(f"{I} [data-inspect-action=score-update]")
    until(page, "() => window.__ctls.length === 2")
    assert len(_calls(page, "compute")) == n + 1


# --------------------------------------------------------------------------- 9, 10, 11

def test_keyboard_opens_and_closes_inspect_and_the_aggregation_is_a_radio_group(page, served):
    _open_panel(page, served)
    page.focus(TOGGLE)
    page.keyboard.press("Enter")
    assert page.get_attribute(TOGGLE, "aria-expanded") == "true"
    assert page.get_attribute(TOGGLE, "aria-controls") == page.get_attribute(f"{I} .gsig-inspect__body", "id")
    assert page.get_attribute(f"{I} .gsig-inspect__body", "role") == "region"
    _wait_table(page)
    assert page.get_attribute(f"{I} .gsig-inspect__agg", "role") == "radiogroup"
    page.focus(f"{I} [data-method=zscore_mean]")
    page.keyboard.press("ArrowRight")
    until(page, "(I) => document.querySelector(I + ' [data-method=mean]').getAttribute('aria-checked') === 'true'", I)
    assert page.evaluate("() => document.activeElement.dataset.method") == "mean"
    # tab order: gene buttons in the table are reachable and named
    names = page.eval_on_selector_all(f"{I} .gsig-inspect__gene", "els => els.map(e => e.textContent)")
    assert set(names) == {"GENE0001", "GENE0002"}
    page.focus(TOGGLE)
    page.keyboard.press("Space")
    assert page.get_attribute(TOGGLE, "aria-expanded") == "false"
    assert not page.is_visible(f"{I} .gsig-inspect__body")


def test_closing_inspect_lets_go_of_the_score_and_reopening_makes_no_request(page, served):
    _open_panel(page, served)
    _inspect(page)
    _wait_table(page)
    page.click(TOGGLE)
    n = len(_calls(page))
    # nothing else holds the score now
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S')._inspect().isOpen()") is False
    _inspect(page)
    _wait_table(page)
    assert len(_calls(page)) == n, "the score is still in the store"


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_light_and_dark_use_the_theme_tokens(page, served, scheme):
    page.emulate_media(color_scheme=scheme)
    _open_panel(page, served)
    _inspect(page)
    _wait_table(page)
    page.wait_for_selector(f"{I} .gsig-hist__bar")
    theme = page.evaluate("document.documentElement.getAttribute('data-theme')")
    assert theme == scheme
    style = page.evaluate("""(I) => {
        const bar = getComputedStyle(document.querySelector(I + ' .gsig-hist__bar'));
        const tick = getComputedStyle(document.querySelector(I + ' .gsig-hist__tick'));
        const panel = getComputedStyle(document.querySelector(I));
        const tok = (n) => { const d = document.createElement('i'); d.style.color = 'var(' + n + ')'; document.body.append(d);
            const c = getComputedStyle(d).color; d.remove(); return c; };
        return { bar: bar.fill, link: tok('--az-link'), tick: tick.fill, muted: tok('--az-muted'), bg: panel.backgroundColor, surface2: tok('--az-surface-2') };
    }""", I)
    assert style["bar"] == style["link"], "the bars wear the link token"
    assert style["tick"] == style["muted"], "axis text wears a text token, not the data colour"
    assert style["bg"] == style["surface2"]
    text = page.evaluate("(I) => getComputedStyle(document.querySelector(I + ' .gsig-inspect__genes td')).color", I)
    assert text != style["bar"], "figures are not set in the data colour"


def test_narrow_panels_keep_gene_and_detected_and_below_280_replace_the_chart_by_its_figures(page, served):
    _open_panel(page, served)
    _inspect(page)
    _wait_table(page)
    assert page.is_visible(f"{I} .gsig-col-sd")
    page.evaluate("(S) => { document.querySelector(S).style.width = '330px'; document.querySelector(S).style.flex = 'none'; }", S)
    page.evaluate("(S) => { document.querySelector(S + ' .gsig-panel').parentElement.style.width = '330px'; }", S)
    until(page, "(S) => document.querySelector(S + ' .gsig-panel').clientWidth <= 340", S)
    assert not page.is_visible(f"{I} .gsig-col-sd"), "below 360 px the table shows Gene and Detected"
    assert page.is_visible(f"{I} .gsig-col-detected")
    page.evaluate("(S) => { document.querySelector(S + ' .gsig-panel').parentElement.style.width = '260px'; }", S)
    until(page, "(S) => document.querySelector(S + ' .gsig-panel').clientWidth <= 270", S)
    assert not page.is_visible(f"{I} .gsig-inspect__chartwrap")
    assert page.is_visible(f"{I} .gsig-inspect__figures"), "the figures stay"
