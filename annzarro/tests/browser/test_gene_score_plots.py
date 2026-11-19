"""The `gene-score` source in Cell Plots, in a real browser.

Step 5 of the gene-signature plan. A signature is a named recipe (genes plus
how to score them); a Cell Plot can take its x, y, colour or hover from the
signature's score, open or closed, in the regular plot and in large-plot mode.
The score is computed by the server (POST /api/v1/data/gene_score) when a plot
needs it, held in the browser as a Float32Array, and never written to a link.

The store is generated: 60 cells and 3,000 genes (ACTB, CD3D, CD3E, CD3G,
Cd3d, GAPDH, KLF1 and GENE0000 to GENE2992). A second server lowers
`ui.defaults.large_plot_points` to 10, so every cell plot there is large.

Where a test needs a score to be slow, to ask first or to fail, the page's
`fetch` is replaced for the score route (`window.__scoreFake`): the estimate
and the stream are then the test's, and the plot cannot tell.

1.  F4: close the signature and the plot keeps its colours; reopened, the same
    id, so the plot follows.
2.  F5: a link with a closed signature computes with nothing open; the plot
    shows neutral points and progress, then the colours.
3.  F6: a slow score asks (one click), then progress, then colours.
4.  The cost tiers are read from the estimate: auto, confirm, refused (with the
    server's explanation).
5.  Every dependant state: computing, queued, cancelled, failed, retry,
    refused, deleted, out of date and held behind Update score, no genes, no
    gene in the dataset. A notice never changes the plot's size.
6.  The x and y axes, hover and the titles name the signature.
7.  Large-plot mode: colour, axes and tooltip.
8.  History makes no request when the key is unchanged; a recipe edit does.
9.  Link and panel-set round trip with a closed signature; no computed value in
    a link.
10. The load limits: two scores at a time, one request for shared scores.
11. Id remapping when a panel set is added beside open panels.
12. Open signature with no chooser tile in the page.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.server.test_focus_rows import _array, _dataframe  # noqa: E402
from annzarro.tests.zarr_compat import open_group  # noqa: E402

N_OBS = 60
SPECIAL = ["ACTB", "CD3D", "CD3E", "CD3G", "Cd3d", "GAPDH", "KLF1"]
GENES = SPECIAL + [f"GENE{i:04d}" for i in range(3000 - len(SPECIAL))]

C = '.tile[data-tile-id="cell-plot-C"]'
C2 = '.tile[data-tile-id="cell-plot-D"]'
S = '.tile[data-tile-id="gene-signature-S"]'
SIG = "gene-signature-S"
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
SCORE = {"type": "gene-score", "key": SIG, "label": "T cell score", "column": ""}

# the fake score route: window.__scoreFake(kind, body, real) -> Response | undefined
INIT = """
window.__scoreCalls = [];
const real = window.fetch.bind(window);
window.fetch = async (url, init) => {
  if (String(url).includes('/data/gene_score')) {
    let body = {};
    try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    const kind = body.estimate_only ? 'estimate' : 'compute';
    window.__scoreCalls.push({ kind, genes: (body.recipe && body.recipe.genes) || [], confirm: !!body.confirm, subset: body.subset || null });
    if (window.__scoreFake) {
      const out = window.__scoreFake(kind, body, () => real(url, init), init);
      if (out) return out;
    }
  }
  return real(url, init);
};
"""

# A score that waits for the test: estimate with the given tier, a stream the test feeds.
#   window.__slow(tier, seconds)  installs it;  __frame(i, obj) sends a frame to the i-th request;
#   __finish(i, values, header) ends it;  __fail413(message) makes the next compute a refusal.
SLOW = """
window.__ctls = [];
window.__enc = new TextEncoder();
window.__slow = (tier, seconds, opts) => {
  opts = opts || {};
  window.__scoreFake = (kind, body, real, init) => {
    if (kind === 'estimate') {
      return new Response(JSON.stringify({ estimate: { seconds, tier, auto_max_s: 60, max_s: 600, live_max_s: 5, layout: 'csc', entries: 10 },
        missing: [], duplicated: [], recipe: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (opts.refuse) {
      return new Response(JSON.stringify({ error: opts.refuse, reason: 'score_too_expensive', estimate: { seconds, tier } }),
        { status: 413, headers: { 'Content-Type': 'application/json' } });
    }
    if (opts.passThrough) return undefined;
    const i = window.__ctls.length;
    const stream = new ReadableStream({ start(c) {
      window.__ctls[i] = c;
      if (init && init.signal) init.signal.addEventListener('abort', () => { try { c.error(new DOMException('Aborted', 'AbortError')); } catch (e) { /* closed */ } });
    } });
    return new Response(stream, { status: 200 });
  };
};
window.__frame = (i, o) => window.__ctls[i].enqueue(window.__enc.encode(JSON.stringify(o) + '\\n'));
window.__finish = (i, values, header) => {
  window.__frame(i, Object.assign({ type: 'result', scored: true, n_used: 2, n_cells: values.length, byte_length: values.length * 4, dtype: 'float32' }, header || {}));
  window.__ctls[i].enqueue(new Uint8Array(new Float32Array(values).buffer));
  window.__ctls[i].close();
};
window.__error = (i, reason, message) => { window.__frame(i, { type: 'error', reason, message }); window.__ctls[i].close(); };
"""
INIT = INIT + SLOW
RAMP = list(range(N_OBS))


def _make_store(path):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    n_var = len(GENES)
    x = (np.arange(N_OBS)[:, None] * 0.01 + np.arange(n_var)[None, :] * 0.001).astype(np.float32)
    _array(root, "X", x)
    _array(root.create_group("layers"), "counts", x + 0.5)
    _array(root.create_group("obsm"), "X_umap", np.stack([np.arange(N_OBS), -np.arange(N_OBS)], 1).astype(np.float32))
    _dataframe(root, "obs", [f"c{i}" for i in range(N_OBS)], {"score": np.arange(N_OBS, dtype=np.float64)})
    _dataframe(root, "var", GENES, {"mean": np.arange(n_var, dtype=np.float64)})
    return str(path)


def _served(tmp_path_factory, config=None):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory, config)
    finally:
        _focus._make_store = original
    return proc, root, store


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    proc, root, store = _served(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_served(tmp_path_factory):
    proc, root, store = _served(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 10\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _new_page(browser):
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    page.add_init_script(INIT)
    return page


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


@pytest.fixture
def large_page(large_served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _cell(pid="cell-plot-C", title="Cell Plot 1", **extra):
    cfg = {"id": pid, "title": title, "x": UMAP_X, "y": UMAP_Y, "z": None, "color": SCORE, "pointSize": 8, "pointOpacity": 1}
    cfg.update(extra)
    return cfg


def _sig(genes=("GENE0001", "GENE0002"), **extra):
    return {"id": SIG, "title": "T cell score", "genes": list(genes), **extra}


def _url(served, open_ids, configs, **view_extra):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)], "controlState": {i: True for i in open_ids},
                               "panelConfigs": configs}, **view_extra}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, plots=(("cell-plot-C", None),), sig=None, sig_open=False, extra_cfgs=None, wait=True, **view):
    """A link: Cell Plots (id, config), and the signature closed unless sig_open."""
    open_ids, cfgs = [], {}
    for pid, cfg in plots:
        open_ids.append(pid)
        cfgs[pid] = cfg or _cell(pid)
    if sig is not False:
        cfgs[SIG] = sig or _sig()
        if sig_open:
            open_ids.insert(0, SIG)
    cfgs.update(extra_cfgs or {})
    page.goto(_url(served, open_ids, cfgs, **view))
    if wait:
        page.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=30000)


def _calls(page, kind=None):
    calls = page.evaluate("() => window.__scoreCalls")
    return [c for c in calls if kind is None or c["kind"] == kind]


def _fake(page, script):
    """Replace the score route with `script`: (kind, body, real, init) => Response | undefined."""
    page.evaluate(f"() => {{ window.__scoreFake = ({script}); }}")


def _colours(page, tile=C):
    """The colour of each point of the plot (numbers), or the marker colour of its traces."""
    return page.evaluate("""(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        if (!gd || !gd.data) return null;
        const out = [];
        for (const t of gd.data) {
            const c = t.marker && t.marker.color;
            if (Array.isArray(c) || ArrayBuffer.isView(c)) out.push(...Array.from(c).map(Number));
            else if (typeof c === 'string' && (t.x || []).length > 1) out.push(c);
        }
        return out;
    }""", tile)


def _drawn(page, tile=C):
    return page.evaluate("""(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.length);
    }""", tile)


def _notice(page, tile=C):
    """The overlay notice over the plot: {state, text, actions}, or None."""
    return page.evaluate("""(tile) => {
        const el = document.querySelector(tile + ' .score-notice');
        if (!el) return null;
        return { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) };
    }""", tile)


def _tag(page, tile=C):
    return page.evaluate("""(tile) => {
        const el = document.querySelector(tile + ' .plot-status .ps-tag[data-tag="score"]');
        return el ? el.textContent.trim() : null;
    }""", tile)


def _placeholder(page, tile=C):
    return page.evaluate("""(tile) => {
        const el = document.querySelector(tile + ' .coverage-placeholder');
        if (!el) return null;
        return { state: el.dataset.scoreState || null, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) };
    }""", tile)


def _box(page, tile=C):
    return page.evaluate("""(tile) => {
        const r = document.querySelector(tile + ' [id^="plot-container-"]').getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }""", tile)


def _wait_coloured(page, tile=C):
    until(page, """(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.some(t => t.marker && (Array.isArray(t.marker.color) || ArrayBuffer.isView(t.marker.color))
            && t.marker.colorscale));
    }""", tile)


def _numbers(page, tile=C):
    return page.evaluate("""(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        const t = gd.data.find(t => t.marker && (Array.isArray(t.marker.color) || ArrayBuffer.isView(t.marker.color)));
        return t ? Array.from(t.marker.color).map(Number) : null;
    }""", tile)


# -------------------------------------------------------------------- tests

def test_f5_a_link_with_a_closed_signature_computes_with_nothing_open(page, served):
    _open(page, served)
    _wait_coloured(page)
    # nothing but the plot is on the page: the signature is closed
    assert page.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId())") == ["cell-plot-C"]
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S') != null")
    values = _numbers(page)
    assert len(values) == 60
    assert len({round(v, 5) for v in values}) > 1, "a score differs between cells"
    # one estimate, one computation
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"]
    assert _notice(page) is None and _tag(page) is None, "a ready score says nothing"


def _slow(page, tier, seconds, **opts):
    """The score route waits for the test from now on: on the page that is open, and on every page the test opens next."""
    page.add_init_script(f"window.__slow({json.dumps(tier)}, {json.dumps(seconds)}, {json.dumps(opts)})")
    if page.url.startswith("http"):
        page.evaluate("([tier, seconds, opts]) => window.__slow(tier, seconds, opts)", [tier, seconds, opts])


def _finish(page, i=0, values=None, **header):
    page.evaluate("([i, v, h]) => window.__finish(i, v, h)", [i, values if values is not None else RAMP, header])


def _frame(page, i, **obj):
    page.evaluate("([i, o]) => window.__frame(i, o)", [i, obj])


def _action(page, name, tile=C):
    page.click(f"{tile} [data-ps-action='{name}']")


def test_f6_a_slow_score_asks_once_then_shows_progress_then_the_colours(page, served):
    _slow(page, "confirm", 130)
    _open(page, served, wait=False)
    page.wait_for_selector(f"{C} .score-notice", timeout=30000)
    note = _notice(page)
    assert note["state"] == "awaiting"
    assert "'T cell score' will take about 2 minutes." in note["text"]
    assert ["score-compute|Compute"] == [a for a in note["actions"] if a.startswith("score-compute")]
    assert _tag(page) == "Score not computed"
    # the plot is there, in neutral points, with no colour bar
    assert _drawn(page)
    assert page.locator(f"{C} .colorbar").count() == 0
    assert [c["kind"] for c in _calls(page)] == ["estimate"], "nothing was computed without the click"
    # one click
    box = _box(page)
    _action(page, "score-compute")
    until(page, "() => window.__ctls.length === 1")
    assert _calls(page, "compute")[0]["confirm"] is True, "the click is sent as confirm: true"
    _frame(page, 0, type="progress", done=0, total=2)
    _frame(page, 0, type="progress", done=1, total=2)
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('1 of 2 genes')", C)
    note = _notice(page)
    assert note["state"] == "computing"
    assert "Computing 'T cell score': 1 of 2 genes." in note["text"]
    assert any(a.startswith("score-cancel|Cancel") for a in note["actions"])
    assert _tag(page) == "Score computing"
    assert _box(page) == box, "a notice never moves or resizes the plot"
    _finish(page, 0)
    _wait_coloured(page)
    assert _notice(page) is None and _tag(page) is None
    assert _box(page) == box
    assert _numbers(page) == [float(v) for v in RAMP]


def test_the_cost_tiers_are_read_from_the_estimate(page, served):
    # auto: computes without asking, up to the limit the estimate states
    _slow(page, "auto", 59)
    _open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    assert _notice(page)["state"] == "computing"
    _finish(page, 0)
    _wait_coloured(page)

    # refused: the server's own explanation, no computation, ways out
    page.goto("about:blank")
    _slow(page, "refused", 1500, refuse="This score would take about 25 minutes; the limit is 10. Use fewer genes.")
    _open(page, served, wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='refused']", timeout=30000)
    note = _notice(page)
    assert "'T cell score' would take about 25 minutes, so it was not run." in note["text"]
    assert "Use fewer genes." in note["text"], "the server's explanation"
    assert [a.split("|")[0] for a in note["actions"]] == ["score-open", "score-choose"]
    assert _tag(page) == "Score refused"
    assert page.evaluate("() => window.__ctls.length") == 0
    assert not page.locator(f"{C} [data-ps-action='score-compute']").count(), "above the limit there is no Compute"


def test_computing_shows_progress_and_cancel_stops_it_and_compute_starts_it_again(page, served):
    _slow(page, "auto", 3)
    _open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    _frame(page, 0, type="progress", done=31, total=50)
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('31 of 50 genes')", C)
    box = _box(page)
    assert _drawn(page), "neutral points are drawn while the score computes"
    assert _tag(page) == "Score computing"
    _action(page, "score-cancel")
    page.wait_for_selector(f"{C} .score-notice[data-state='cancelled']")
    note = _notice(page)
    assert "'T cell score' was cancelled. This plot has no colour." in note["text"]
    assert _tag(page) == "Score cancelled"
    assert _box(page) == box
    # the request was aborted: its stream is errored; nothing was computed
    _action(page, "score-compute")
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1)
    _wait_coloured(page)
    assert _notice(page) is None


def test_a_failed_score_says_why_and_retry_asks_again(page, served):
    _slow(page, "auto", 3)
    _open(page, served, wait=False)
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("() => window.__error(0, 'read_failed', 'Failed to read the dataset: the server stopped responding')")
    page.wait_for_selector(f"{C} .score-notice[data-state='failed']")
    note = _notice(page)
    assert "'T cell score' could not be computed: Failed to read the dataset: the server stopped responding." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-retry", "score-open"]
    assert _tag(page) == "Score failed"
    _action(page, "score-retry")
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1)
    _wait_coloured(page)
    assert _notice(page) is None


def test_two_plots_that_share_a_score_share_the_request_and_cancel_says_so(page, served):
    _slow(page, "auto", 3)
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", "Cell Plot 2"))))
    page.wait_for_selector(f"{C2} .score-notice", timeout=30000)
    until(page, "() => window.__ctls.length === 1")
    assert len(_calls(page, "compute")) == 1 and len(_calls(page, "estimate")) == 1, "one computation for two plots"
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('Cancel for 2 plots')", C)
    _finish(page, 0)
    _wait_coloured(page, C)
    _wait_coloured(page, C2)
    assert len(_calls(page, "compute")) == 1


def test_a_signature_with_no_genes_and_one_with_no_gene_in_the_dataset_each_say_so(page, served):
    _open(page, served, sig=_sig(genes=()))
    page.wait_for_selector(f"{C} .score-notice[data-state='nogenes']", timeout=30000)
    assert "'T cell score' has no genes yet." in _notice(page)["text"]
    assert _tag(page) == "No genes"
    assert _calls(page) == [], "nothing is asked of the server for an empty signature"
    assert [a.split("|")[0] for a in _notice(page)["actions"]] == ["score-open"]

    page.goto("about:blank")
    _open(page, served, sig=_sig(genes=("NOT_A_GENE", "NOR_THIS")))
    page.wait_for_selector(f"{C} .score-notice[data-state='noscore']", timeout=30000)
    assert "None of the genes of 'T cell score' are in this dataset." in _notice(page)["text"]
    assert _tag(page) == "No score"


def test_a_deleted_signature_says_so_and_the_plot_keeps_its_setting(page, served):
    _open(page, served)
    _wait_coloured(page)
    page.evaluate("() => window.PanelManager.removePanel('gene-signature-S')")
    page.wait_for_selector(f"{C} .score-notice[data-state='deleted']")
    assert "Signature 'T cell score' was deleted." in _notice(page)["text"]
    assert _tag(page) == "Source deleted"
    assert [a.split("|")[0] for a in _notice(page)["actions"]] == ["score-choose"]
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.key") == SIG
    # the key list still names it, as deleted
    assert page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].map(o => o.textContent)", C) \
        == ["T cell score (deleted)"]


def test_the_source_menu_offers_gene_score_and_lists_every_signature_open_or_closed(page, served):
    other = {"id": "gene-signature-O", "title": "B cell score", "genes": ["CD3E"]}
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "obs", "key": "score", "column": ""})),),
          extra_cfgs={"gene-signature-O": other}, sig_open=True)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    options = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"color\"] option')].map(o => o.value)", C)
    assert options == ["none", "obs", "obsm", "obsp", "layer", "gene-score"] or "gene-score" in options
    for axis in ("x", "y"):
        assert "gene-score" in page.evaluate(
            "([t, a]) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"' + a + '\"] option')].map(o => o.value)", [C, axis])
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "gene-score")
    until(page, "(t) => document.querySelector(t + ' select.axis-key-select[data-axis=\"color\"]').options.length === 2", C)
    labels = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].map(o => o.textContent)", C)
    assert labels == ["T cell score", "B cell score"] or sorted(labels) == ["B cell score", "T cell score"], labels
    assert not any("closed" in l.lower() for l in labels), "no suffix: the chooser alone says Closed"
    # the second is closed (not in the layout) and still offered; pick it
    page.select_option(f"{C} select.axis-key-select[data-axis='color']", "gene-signature-O")
    _wait_coloured(page)
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")["key"] == "gene-signature-O"
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.label") == "B cell score"
    # the colour bar names the signature
    bars = page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title))
        .filter(Boolean)""", C)
    assert bars == ["B cell score"], bars


def test_f4_close_the_signature_and_the_plot_keeps_its_colours_then_reopen_it(page, served):
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    before = _numbers(page)
    requests = len(_calls(page))
    page.click(f"{S} .tile-close, {S} [data-action='close'], {S} .close-panel-btn")
    until(page, "() => !window.PanelManager.getActivePanels().some(p => p.getId() === 'gene-signature-S')")
    page.wait_for_timeout(500)
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S') != null"), "closed, still a signature"
    assert _numbers(page) == before, "the plot keeps its colours"
    assert _notice(page) is None
    assert len(_calls(page)) == requests, "closing the panel asks nothing"
    # reopened: the same id, so the plot follows it (Open signature needs no chooser tile)
    page.evaluate("() => window.PanelManager.reopenClosedPanel('gene-signature-S', {nextTo: 'cell-plot-C'})")
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getType()") == "gene-signature"
    assert _numbers(page) == before
    assert len(_calls(page)) == requests, "reopening asks nothing: the key is the same"
