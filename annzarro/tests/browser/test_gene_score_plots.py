"""The `gene-score` source in Cell Plots, in a real browser.

Step 5 of the gene-signature plan. A signature is a named recipe (genes plus
how to score them); a Cell Plot can take its x, y, z or colour from the
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
6.  The x and y axes and the titles name the signature (a score is no hover line: decision 32).
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
    window.__scoreCalls.push({ kind, genes: (body.recipe && body.recipe.genes) || [], method: (body.recipe && body.recipe.method) || null, input: (body.recipe && body.recipe.input) || null, confirm: !!body.confirm, subset: body.subset || null });
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
      if (init && init.signal) init.signal.addEventListener('abort', () => {
        window.__aborted = (window.__aborted || 0) + 1;
        try { c.error(new DOMException('Aborted', 'AbortError')); } catch (e) { /* closed */ }
      });
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
    # the notice is drawn a moment after the state changes (a repaint is batched): wait for it
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'computing'; }", C)
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
    assert "'T cell score' was cancelled. This plot has no color." in note["text"]
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
        == ["T cell score (deleted)", "New signature…"]


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
    until(page, "(t) => document.querySelector(t + ' select.axis-key-select[data-axis=\"color\"]').options.length === 3", C)
    labels = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].map(o => o.textContent)", C)
    assert labels[-1] == "New signature…"
    assert sorted(labels[:-1]) == ["B cell score", "T cell score"], labels
    assert not any("closed" in l.lower() for l in labels), "no suffix: the chooser alone says Closed"
    # the second is closed (not in the layout) and still offered; pick it
    page.select_option(f"{C} select.axis-key-select[data-axis='color']", "gene-signature-O")
    _wait_coloured(page)
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")["key"] == "gene-signature-O"
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.label") == "B cell score"
    # the colour bar names the signature (the old colours stay until the new score is there)
    until(page, """(t) => document.querySelector(t + ' .js-plotly-plot').data.some(d => d.marker && d.marker.colorbar && d.marker.colorbar.title
        && String(d.marker.colorbar.title.text || d.marker.colorbar.title).startsWith('B cell score'))""", C)
    bars = page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title))
        .filter(Boolean)""", C)
    assert bars == ["B cell score<br>z-score mean · X"], bars


def test_f4_close_the_signature_and_the_plot_keeps_its_colours_then_reopen_it(page, served):
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    before = _numbers(page)
    requests = len(_calls(page))
    page.click(f"{S} .tile-close, {S} [data-action='close'], {S} .close-panel-btn")
    until(page, "() => !window.PanelManager.getActivePanels().some(p => p.getId() === 'gene-signature-S')")
    # time for a score request or a redraw, were one going to; closing the panel changes nothing
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


def test_a_score_on_an_axis_is_a_placeholder_while_it_computes_and_names_the_signature_after(page, served):
    _slow(page, "auto", 3)
    cfg = _cell(x=SCORE, y=UMAP_Y, color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", cfg),), wait=False)
    until(page, "() => window.__ctls.length === 1")
    page.wait_for_selector(f"{C} .coverage-placeholder", timeout=30000)
    until(page, "(t) => ((document.querySelector(t + ' .coverage-placeholder') || {dataset: {}}).dataset || {}).scoreState === 'computing'", C)
    holder = _placeholder(page)
    assert holder["state"] == "computing"
    assert "Computing 'T cell score'" in holder["text"]
    assert any(a.startswith("score-cancel") for a in holder["actions"])
    assert not _drawn(page), "nothing truthful can be drawn from an axis that is not there"
    _frame(page, 0, type="progress", done=1, total=2)
    until(page, "(t) => (document.querySelector(t + ' .coverage-placeholder') || {textContent: ''}).textContent.includes('1 of 2 genes')", C)
    _finish(page, 0)
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.length); }", C)
    assert _placeholder(page) is None and _notice(page) is None
    xs = page.evaluate("(t) => Array.from(document.querySelector(t + ' .js-plotly-plot').data[0].x).map(Number)", C)
    assert len(xs) == 60 and xs[:3] == [0.0, 1.0, 2.0] or sorted(xs)[:3] == [0.0, 1.0, 2.0]
    title = page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.title.text", C)
    assert title == "T cell score · z-score mean · X", "the axis names the signature, not the panel id"


# The score request the page sends, kept so a test can ask the route itself for the reply (its own oracle)
KEEP_COMPUTE = """
window.__computeRequests = [];
const kept = window.fetch;
window.fetch = (url, init) => {
  if (String(url).includes('/data/gene_score') && init && typeof init.body === 'string' && !JSON.parse(init.body).estimate_only) {
    window.__computeRequests.push({ url: String(url), body: init.body, headers: Object.fromEntries(new Headers(init.headers || {}).entries()) });
  }
  return kept(url, init);
};
"""

# One cell's score as the route answers it: the first compute request sent again, its stream read here (JSON lines,
# the result frame, then the float32 block), with no app code between
ROUTE_VALUE = """async (row) => {
  const req = window.__computeRequests[0];
  const reply = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
  const bytes = new Uint8Array(await reply.arrayBuffer());
  let start = 0;
  for (;;) {
    const end = bytes.indexOf(10, start);
    const frame = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end)));
    start = end + 1;
    if (frame.type === 'result') {
      const values = new Float32Array(bytes.slice(start, start + frame.byte_length).buffer);
      return Number.isNaN(values[row]) ? null : values[row];
    }
  }
}"""


def test_large_plot_mode_colours_by_a_score_and_its_tooltip_reads_the_vector(large_page, large_served):
    large_page.add_init_script(KEEP_COMPUTE)
    _open(large_page, large_served)
    _wait_large_coloured(large_page)
    assert large_page.evaluate("(t) => !!document.querySelector(t + ' .plot-status .ps-tag[data-tag=\"large\"]')", C), "large-plot mode"
    assert _tag(large_page) is None and _notice(large_page) is None
    assert [c["kind"] for c in _calls(large_page)] == ["estimate", "compute"]
    # the series is the store's Float32Array itself
    names = large_page.evaluate("""(t) => [...new Set(document.querySelector(t + ' .js-plotly-plot').data.map(d => d.name))]""", C)
    assert any(str(n).startswith("bin ") for n in names), names
    bars = large_page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title))
        .filter(Boolean)""", C)
    assert bars == ["T cell score<br>z-score mean · X"]
    # the tooltip's colour line is read from the held vector, not asked of the server for one cell
    until(large_page, """(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
        return !!(g && g.__largeState && g.__largeState.index && g._fullLayout); }""", C)
    # The pointer is put where the cell is NOW, so the layout must have stopped moving (a late relayout or resize
    # shifts the axes, and the same pixel is then another cell): wait until the axes and the plot area have held
    # for ten frames.
    large_page.wait_for_function("""(tile) => {
        const g = document.querySelector(tile + ' .js-plotly-plot'), a = g && g.querySelector('.nsewdrag');
        if (!g || !a || !g._fullLayout) return false;
        const r = a.getBoundingClientRect(), L = g._fullLayout;
        const key = [r.left, r.top, r.width, r.height, L.xaxis.range, L.yaxis.range].join();
        const w = window.__azLayoutHold = (window.__azLayoutHold && window.__azLayoutHold.key === key)
            ? { key, n: window.__azLayoutHold.n + 1 } : { key, n: 0 };
        return w.n >= 10; }""", arg=C, polling="raf", timeout=30000)
    spot = large_page.evaluate("""(tile) => {
        const g = document.querySelector(tile + ' .js-plotly-plot'), idx = g.__largeState.index;
        const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis, r = g.querySelector('.nsewdrag').getBoundingClientRect();
        const p = Array.from(idx.rows).indexOf(30);
        return { x: r.left + xa.l2p(idx.X[p]), y: r.top + ya.l2p(idx.Y[p]) };
    }""", C)
    before = len(_calls(large_page))
    large_page.mouse.move(spot["x"] - 60, spot["y"] - 60)
    large_page.mouse.move(spot["x"] + 1, spot["y"] + 1, steps=4)
    # The pointer passes over cells 20 to 29 on its way (X_umap puts every cell on one diagonal), and each move is
    # read a moment later: on a busy machine the tooltip can first show a cell passed on the way. Wait for the
    # tooltip of the cell under the pointer's end, cell 30 (its x line), not for the first tooltip.
    until(large_page, """() => { const t = document.querySelector('.large-plot-tip');
        const lines = t ? Array.from(t.children).map(c => c.textContent) : [];
        return !!(t && t.style.display !== 'none' && lines.includes('x: 30') && lines.includes('y: -30')
            && lines.some(c => c.startsWith('T cell score · z-score mean · X: '))); }""")
    tip = large_page.evaluate("() => Array.from(document.querySelector('.large-plot-tip').children).map(c => c.textContent)")
    line = [t for t in tip if t.startswith("T cell score · z-score mean · X: ")][0]
    assert len(_calls(large_page)) == before, "the value came from the vector: no request"
    held = large_page.evaluate(ROUTE_VALUE, 30)
    assert held is not None and abs(float(line.split(": ")[1]) - held) <= abs(held) * 1e-3 + 1e-9, (line, held)


def _wait_large_coloured(page, tile=C):
    until(page, """(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.some(t => t.marker && t.marker.colorscale));
    }""", tile)


def test_large_plot_mode_axes_and_states(large_page, large_served):
    _slow(large_page, "auto", 3)
    cfg = _cell(x=SCORE, color={"type": "none", "key": "", "column": ""})
    _open(large_page, large_served, plots=(("cell-plot-C", cfg),), wait=False)
    until(large_page, "() => window.__ctls.length === 1")
    large_page.wait_for_selector(f"{C} .coverage-placeholder", timeout=30000)
    until(large_page, "(t) => ((document.querySelector(t + ' .coverage-placeholder') || {dataset: {}}).dataset || {}).scoreState === 'computing'", C)
    assert _placeholder(large_page)["state"] == "computing"
    _finish(large_page, 0)
    until(large_page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.length); }", C)
    assert large_page.evaluate("(t) => !!document.querySelector(t + ' .plot-status .ps-tag[data-tag=\"large\"]')", C)

    # a colour from a score that asks first: neutral points, the overlay, the plot in place
    large_page.goto("about:blank")
    _slow(large_page, "confirm", 130)
    _open(large_page, large_served, wait=False)
    large_page.wait_for_selector(f"{C} .score-notice[data-state='awaiting']", timeout=30000)
    assert _drawn(large_page)
    assert "'T cell score' will take about 2 minutes." in _notice(large_page)["text"]
    box = _box(large_page)
    _action(large_page, "score-compute")
    until(large_page, "() => window.__ctls.length === 1")
    _finish(large_page, 0)
    _wait_large_coloured(large_page)
    assert _box(large_page) == box


def _edit(page, genes):
    """Edit the open signature as the user would: add genes through the panel."""
    page.evaluate("(genes) => window.PanelManager.getPanel('gene-signature-S').addGenes(genes)", genes)


def _changed_from(page, before, tile=C):
    until(page, "([t, b]) => { const g = document.querySelector(t + ' .js-plotly-plot'); "
                "const x = g && g.data.find(d => d.marker && d.marker.colorscale); "
                "return !!x && Array.from(x.marker.color).join() !== b.join(); }", [tile, before])


def test_a_quick_edit_updates_the_plot_by_itself_after_a_short_pause(page, served):
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    before = _numbers(page)
    _edit(page, ["GENE0100"])
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    _changed_from(page, before)
    assert _calls(page, "compute")[1]["genes"] == ["GENE0001", "GENE0002", "GENE0100"]
    assert _notice(page) is None, "a live update ends without a notice"


def test_edits_of_a_slow_score_are_held_behind_update_score_and_the_plot_keeps_the_previous_one(page, served):
    # estimates: the first recipes are quick; with a fifth gene the score takes 40 s
    page.add_init_script("""window.__scoreFake = (kind, body, real) => {
        if (kind !== 'estimate') return undefined;
        const seconds = body.recipe.genes.length > 3 ? 40 : 1;
        return new Response(JSON.stringify({ estimate: { seconds, tier: 'auto', auto_max_s: 60, max_s: 600, live_max_s: 5, layout: 'csc', entries: 1 },
            missing: [], duplicated: [], recipe: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };""")
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    before = _numbers(page)
    box = _box(page)
    _edit(page, ["GENE0100"])
    _edit(page, ["GENE0200"])
    _edit(page, ["GENE0300"])
    page.wait_for_selector(f"{C} .score-notice[data-state='held']")
    note = _notice(page)
    assert "Showing the previous 'T cell score'. 3 changes are not applied. About 40 seconds." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-update"]
    assert _tag(page) == "Score out of date"
    assert _numbers(page) == before, "the plot keeps the previous score"
    assert _box(page) == box
    assert len(_calls(page, "compute")) == 1, "the edits cost nothing until they are applied"
    assert "3 changes are not applied" in page.inner_text(f"{S} .gsig-score"), "the panel says so too"
    _action(page, "score-update")
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _calls(page, "compute")[1]["genes"] == ["GENE0001", "GENE0002", "GENE0100", "GENE0200", "GENE0300"]
    _changed_from(page, before)
    assert _notice(page) is None
    # the same button in the panel
    _edit(page, ["GENE0400"])
    _edit(page, ["GENE0500"])
    page.wait_for_selector(f"{S} .gsig-score [data-score-command='update']")
    page.click(f"{S} .gsig-score [data-score-command='update']")
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 3")


def test_while_an_update_computes_the_plot_shows_the_previous_score_and_says_so(page, served):
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    before = _numbers(page)
    _slow(page, "auto", 1)
    _edit(page, ["GENE0100"])
    until(page, "() => window.__ctls.length === 1")
    page.wait_for_selector(f"{C} .score-notice[data-state='updating']")
    assert "Showing the previous 'T cell score'. Updating." in _notice(page)["text"]
    assert _tag(page) == "Score updating"
    assert _numbers(page) == before
    _finish(page, 0, [float(v) * 2 for v in RAMP])
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); const x = g.data.find(d => d.marker && d.marker.colorscale); return !!x && Array.from(x.marker.color)[3] === 6; }", C)
    assert _notice(page) is None


def test_history_makes_no_request_when_the_key_is_unchanged(page, served):
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", "Cell Plot 2", color=UMAP_Y))))
    _wait_coloured(page)
    first = len(_calls(page))
    assert first == 2
    # close the plot (a history step), then Back: the plot is made again with the same recipe
    page.click(f"{C} .tile-close, {C} [data-action='close'], {C} .close-panel-btn")
    until(page, "() => !window.PanelManager.getActivePanels().some(p => p.getId() === 'cell-plot-C')")
    # outwait the history merge window (MERGE_MS) so the close is its own entry, then go Back
    page.wait_for_timeout(1500)
    page.go_back()
    until(page, "() => window.PanelManager.getActivePanels().some(p => p.getId() === 'cell-plot-C')")
    _wait_coloured(page)
    assert len(_calls(page)) == first, _calls(page)
    # a recipe edited since is a new key, and does ask
    _open(page, served, sig_open=True)
    _edit(page, ["GENE0003"])
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _calls(page, "compute")[1]["genes"] == ["GENE0001", "GENE0002", "GENE0003"]


def test_the_link_of_a_view_with_a_closed_signature_carries_the_recipe_and_no_computed_value(page, served):
    _open(page, served)
    _wait_coloured(page)
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    configs = view["layout"]["panelConfigs"]
    assert configs[SIG]["genes"] == ["GENE0001", "GENE0002"], "the closed signature is carried"
    assert SIG not in json.dumps(view["layout"]["hierarchy"]), "closed: no tile"
    assert configs["cell-plot-C"]["color"]["type"] == "gene-score" and configs["cell-plot-C"]["color"]["key"] == SIG
    text = json.dumps(view)
    assert "Float32" not in text and "values" not in text
    assert len(text) < 6000, "sixty scores would be hundreds of digits more"
    other = page.context.browser.new_page()
    other.add_init_script(INIT)
    other.goto(page.url)
    other.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_coloured(other)
    assert [c["kind"] for c in _calls(other)] == ["estimate", "compute"]
    assert _numbers(other) == _numbers(page)
    other.close()


def _save_set(page, name):
    page.click("#btn-save-session")
    page.fill("#session-name", name)
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")


def test_a_panel_set_with_a_closed_signature_loads_with_its_colours_and_carries_no_values(page, served):
    _open(page, served)
    _wait_coloured(page)
    want = _numbers(page)
    _save_set(page, "score-set")
    saved = json.dumps(page.evaluate("() => PanelManager.saveLayout()"))
    assert "Float32" not in saved and '"values"' not in saved
    root, store = served
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    try:
        fresh.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        fresh.wait_for_selector("#btn-load-session", state="visible", timeout=30000)
        fresh.wait_for_selector(".tile-selector", state="visible", timeout=30000)
        fresh.click("#btn-load-session")
        fresh.locator(".session-card[data-session-name='score-set'] .session-load").first.click()
        fresh.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
        _wait_coloured(fresh)
        assert _numbers(fresh) == want
        assert fresh.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId())") == ["cell-plot-C"], "the signature is closed"
        assert fresh.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes") == ["GENE0001", "GENE0002"]
        assert [c["kind"] for c in _calls(fresh)] == ["estimate", "compute"]
    finally:
        fresh.close()


def test_added_panels_that_need_new_ids_keep_their_plot_and_signature_together(page, served):
    _open(page, served)
    _wait_coloured(page)
    _save_set(page, "remap-set")
    page.click("#btn-load-session")
    page.locator(".session-card[data-session-name='remap-set'] .session-add-closed").first.click()
    page.wait_for_function("() => PanelManager.getAllPanels().length === 4", timeout=30000)
    got = page.evaluate("""() => PanelManager.getAllPanels().map(p => [p.getType(), p.getId(),
        p.getType() === 'cell-plot' ? p.getConfig().color.key : null])""")
    sigs = [g[1] for g in got if g[0] == "gene-signature"]
    plots = [g for g in got if g[0] == "cell-plot"]
    assert len(sigs) == 2 and sigs[0] == SIG and sigs[1] != SIG
    added = [g for g in plots if g[1] != "cell-plot-C"][0]
    assert added[2] == sigs[1], "the added plot colours by the added signature, not by the one that was already there"
    assert [g for g in plots if g[1] == "cell-plot-C"][0][2] == SIG


def test_at_most_two_scores_compute_at_once_and_a_shared_score_is_one_request(page, served):
    extra = {f"gene-signature-{k}": {"id": f"gene-signature-{k}", "title": f"Score {k}", "genes": [f"GENE000{k}"]} for k in range(1, 5)}
    plots = tuple((f"cell-plot-{k}", _cell(f"cell-plot-{k}", f"Cell Plot {k}", color={"type": "gene-score", "key": f"gene-signature-{k}",
                                                                                         "label": f"Score {k}", "column": ""}))
                  for k in range(1, 5))
    _slow(page, "auto", 3)
    page.set_viewport_size({"width": 1700, "height": 1400})
    _open(page, served, plots=plots, sig=False, extra_cfgs=extra, wait=False)
    until(page, "() => window.__ctls.length === 2")
    # time for a third request, were one going to; only two run at a time
    page.wait_for_timeout(800)
    assert page.evaluate("() => window.__ctls.length") == 2, "two at a time"
    assert len(_calls(page, "compute")) == 2
    queued = page.evaluate("""() => [...document.querySelectorAll('.score-notice')].map(e => e.dataset.state).sort()""")
    assert queued.count("queued") == 2 and queued.count("computing") == 2, queued
    _finish(page, 0)
    until(page, "() => window.__ctls.length === 3")
    _finish(page, 1)
    until(page, "() => window.__ctls.length === 4")
    _finish(page, 2)
    _finish(page, 3)
    for k in range(1, 5):
        _wait_coloured(page, f'.tile[data-tile-id="cell-plot-{k}"]')


def test_a_score_off_screen_waits_until_its_plot_comes_into_view(page, served):
    extra = {"gene-signature-2": {"id": "gene-signature-2", "title": "Score 2", "genes": ["GENE0002"]}}
    two = _cell("cell-plot-2", "Cell Plot 2", color={"type": "gene-score", "key": "gene-signature-2", "label": "Score 2", "column": ""})
    _slow(page, "auto", 3)
    page.add_init_script("""window.__hold = true; const o = window.IntersectionObserver;
        window.IntersectionObserver = class { constructor(cb) { this.cb = cb; window.__io = window.__io || []; window.__io.push(this); }
            observe(el) { this.el = el; if (!window.__hold) this.cb([{ isIntersecting: true, target: el }]); else if (el.id.endsWith('cell-plot-2')) this.cb([{ isIntersecting: false, target: el }]); else this.cb([{ isIntersecting: true, target: el }]); }
            disconnect() {} unobserve() {} };""")
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-2", two)), extra_cfgs=extra, wait=False)
    until(page, "() => window.__ctls.length === 1")
    # time for a request, were one going to; nothing starts for the plot off screen
    page.wait_for_timeout(800)
    assert len(_calls(page, "estimate")) == 1 and page.evaluate("() => window.__ctls.length") == 1, "nothing starts for the plot off screen"
    page.evaluate("""() => { window.__hold = false; for (const io of window.__io) if (io.el) io.cb([{ isIntersecting: true, target: io.el }]); }""")
    until(page, "() => window.__ctls.length === 2")


def test_open_signature_works_with_no_chooser_tile_in_the_page(page, served):
    _slow(page, "refused", 1500, refuse="Too large. Use fewer genes.")
    _open(page, served, wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='refused']", timeout=30000)
    # take every chooser out of the page: reopening must not click a chooser tile's button (reopen-table does)
    page.evaluate("() => document.querySelectorAll('.tile-selector, .panel-closed-btn').forEach(e => e.remove())")
    assert page.locator(".panel-closed-btn").count() == 0
    assert page.locator(S).count() == 0
    _action(page, "score-open")
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    # the same id, so the plot follows; the tile of the plot was split, the signature is beside it
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getType()") == "gene-signature"
    assert page.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId()).sort()") == ["cell-plot-C", "gene-signature-S"]
    assert "T cell score" in page.inner_text(f"{S} .tile-title, {S} input.tile-title") or page.input_value(f"{S} .tile-title") == "T cell score"


def _choose_score(page, axis, key=SIG):
    """Pick a signature as an axis source through the plot's own menus: gene-score, then the signature."""
    page.select_option(f"{C} select.axis-type-select[data-axis='{axis}']", "gene-score")
    until(page, "([t, a, k]) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"' + a + '\"] option')].some(o => o.value === k)", [C, axis, key])
    page.select_option(f"{C} select.axis-key-select[data-axis='{axis}']", key)


def test_the_source_menus_colour_a_cell_plot_by_the_signature(page, served):
    plain = _cell(color={"type": "obs", "key": "score", "column": ""})
    _open(page, served, plots=(("cell-plot-C", plain),), sig_open=True)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert page.locator(f"{S} .gsig-usein").count() == 0, "the signature panel has no Use in menu"
    _choose_score(page, "color")
    # the obs colours stay while the score is on its way (the old plot is kept): wait for the score's own colours,
    # not for "some colours"
    until(page, """(t) => { const g = document.querySelector(t + ' .js-plotly-plot');
        return !!g && g.data.some(d => d.marker && d.marker.colorbar && d.marker.colorbar.title
            && String(d.marker.colorbar.title.text || d.marker.colorbar.title).startsWith('T cell score')); }""", C)
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")
    assert cfg["type"] == "gene-score" and cfg["key"] == SIG and cfg["label"] == "T cell score"
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"]


def _set_subset(page, on, n=30):
    page.click("#subset-button")
    page.wait_for_selector("#subset-enabled", state="visible")
    if page.is_checked("#subset-enabled") != on:
        page.click("#subset-enabled")
    if on:
        if page.is_checked("#subset-n-all"):
            page.click("#subset-n-all")
        page.fill("#subset-n", str(n))
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")


def test_the_cells_shown_are_part_of_the_key_so_a_new_subset_asks_and_going_back_does_not(page, served):
    _open(page, served, subset={"n": 30, "seed": 0})
    _wait_coloured(page)
    assert len(_numbers(page)) == 30
    first = _calls(page, "compute")
    assert len(first) == 1 and isinstance(first[0]["subset"], str), "the cells shown go to the route"
    # all the cells: another key, another request, sixty values
    _set_subset(page, False)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); const x = g && g.data.find(d => d.marker && d.marker.colorscale); return !!x && x.marker.color.length === 60; }", C)
    assert _calls(page, "compute")[1]["subset"] is None
    # the 30 again: served from the store
    _set_subset(page, True, 30)
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); const x = g && g.data.find(d => d.marker && d.marker.colorscale); return !!x && x.marker.color.length === 30; }", C)
    assert len(_calls(page, "compute")) == 2


def test_closing_the_last_plot_that_needs_a_score_stops_its_computation(page, served):
    _slow(page, "auto", 3)
    _open(page, served, plots=(("cell-plot-C", None), ("cell-plot-D", _cell("cell-plot-D", "Cell Plot 2"))), wait=False)
    until(page, "() => window.__ctls.length === 1")
    page.click(f"{C} .tile-close, {C} [data-action='close'], {C} .close-panel-btn")
    until(page, "() => !window.PanelManager.getActivePanels().some(p => p.getId() === 'cell-plot-C')")
    # time for an abort, were one going to; the other plot still needs the score
    page.wait_for_timeout(500)
    assert (page.evaluate("() => window.__aborted") or 0) == 0, "the other plot still needs it"
    page.click(f"{C2} .tile-close, {C2} [data-action='close'], {C2} .close-panel-btn")
    until(page, "() => window.__aborted === 1")
    assert len(_calls(page, "compute")) == 1


def test_renaming_a_signature_retitles_its_plots_without_computing_again(page, served):
    _open(page, served, sig_open=True)
    _wait_coloured(page)
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').setTitle('Exhaustion score')")
    until(page, """(t) => { const g = document.querySelector(t + ' .js-plotly-plot');
        return !!g && g.data.some(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title) === 'Exhaustion score<br>z-score mean · X'); }""", C)
    assert len(_calls(page, "compute")) == 1, "a title is not part of the recipe"
    labels = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].map(o => o.textContent)", C)
    assert labels == ["Exhaustion score", "New signature…"]


def test_a_closed_signature_put_back_with_another_recipe_by_back_or_forward_updates_its_plots(page, served):
    _open(page, served)
    _wait_coloured(page)
    before = _numbers(page)
    page.evaluate("""() => PanelManager.restoreClosedPanels([{ id: 'gene-signature-S', type: 'gene-signature',
        config: { id: 'gene-signature-S', title: 'T cell score', genes: ['GENE0050', 'GENE0060'] } }])""")
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _calls(page, "compute")[1]["genes"] == ["GENE0050", "GENE0060"]
    _changed_from(page, before)


SIG2 = "gene-signature-T"
SCORE2 = {"type": "gene-score", "key": SIG2, "label": "B cell score", "column": ""}
OTHER = {SIG2: {"id": SIG2, "title": "B cell score", "genes": ["GENE0010", "GENE0011"]}}


def _points(page, tile=C):
    return page.evaluate("""(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
        return g.data.filter(d => (d.x || []).length > 1 || (d.z || []).length > 1).reduce((n, d) => n + Array.from(d.x).filter(v => Number.isFinite(Number(v))).length, 0); }""", tile)


def _ready_plot(page, tile=C):
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.some(d => (d.x || []).length > 1)); }", tile)


def test_a_score_is_selectable_on_every_axis_including_z_in_a_3d_plot(page, served):
    cfg = _cell(x=UMAP_X, y=UMAP_Y, z=SCORE, color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", cfg),))
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.some(d => d.type === 'scatter3d' && (d.z || []).length > 1)); }", C)
    zs = page.evaluate("(t) => Array.from(document.querySelector(t + ' .js-plotly-plot').data.find(d => d.type === 'scatter3d').z).map(Number)", C)
    assert len(zs) == 60 and len(set(round(v, 5) for v in zs)) > 1
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.scene.zaxis.title.text", C) == "T cell score · z-score mean · X"
    # and the z menu offers it
    assert "gene-score" in page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"z\"] option')].map(o => o.value)", C)


def test_two_scores_against_each_other_one_per_signature_and_the_same_signature_on_two_axes_is_one_request(page, served):
    cfg = _cell(x=SCORE, y=SCORE2, color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", cfg),), extra_cfgs=OTHER)
    _ready_plot(page)
    assert sorted(c["genes"][0] for c in _calls(page, "compute")) == ["GENE0001", "GENE0010"]
    titles = page.evaluate("(t) => { const l = document.querySelector(t + ' .js-plotly-plot').layout; return [l.xaxis.title.text, l.yaxis.title.text]; }", C)
    assert titles == ["T cell score · z-score mean · X", "B cell score · z-score mean · X"]
    page.goto("about:blank")
    same = _cell(x=SCORE, y=SCORE, color=SCORE)
    _open(page, served, plots=(("cell-plot-C", same),))
    _ready_plot(page)
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"], "x, y and colour share one request"
    xs = page.evaluate("(t) => { const d = document.querySelector(t + ' .js-plotly-plot').data.find(d => (d.x || []).length > 1); return [Array.from(d.x).map(Number), Array.from(d.y).map(Number)]; }", C)
    assert xs[0] == xs[1]


def test_a_score_against_an_obs_column_and_against_a_gene(page, served):
    cfg = _cell(x=SCORE, y={"type": "obs", "key": "score", "column": ""}, color={"type": "layer", "key": "X", "column": "KLF1"})
    _open(page, served, plots=(("cell-plot-C", cfg),))
    _ready_plot(page)
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.title.text", C) == "T cell score · z-score mean · X"


def test_two_aggregations_of_one_signature_are_two_scores_and_one_aggregation_is_shared(page, served):
    two = _cell(x={**SCORE, "column": "zscore_mean"}, y={**SCORE, "column": "mean"}, color={**SCORE, "column": "mean"})
    _open(page, served, plots=(("cell-plot-C", two),))
    _ready_plot(page)
    computes = _calls(page, "compute")
    assert sorted(c["method"] for c in computes) == ["mean", "zscore_mean"], "y and colour share the mean; x is the z-score mean"
    assert len(_calls(page, "estimate")) == 2
    titles = page.evaluate("(t) => { const l = document.querySelector(t + ' .js-plotly-plot').layout; return [l.xaxis.title.text, l.yaxis.title.text]; }", C)
    assert titles == ["T cell score · z-score mean · X", "T cell score · mean · X"]
    # the third level is the method select: every method the server computes, z-score mean first (decision 31), and
    # the layer beside it in a select of its own
    opts = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"y\"] option')].map(o => [o.value, o.textContent])", C)
    assert opts == [["zscore_mean", "z-score mean"], ["mean", "mean"], ["sum", "sum"], ["control_adjusted", "control-adjusted"],
                    ["detected", "fraction detected"], ["fraction_of_total", "% of total"]]
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-layer-select[data-axis=\"y\"]').value", C) == "X"
    # choosing the other aggregation in the menu moves the axis to it
    page.select_option(f"{C} select.axis-column-select[data-axis='x']", "mean")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().x.column === 'mean'")
    # time for a second compute, were one going to; the mean was already in the store
    page.wait_for_timeout(800)
    assert len(_calls(page, "compute")) == 2, "the mean was already in the store"
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.title.text", C) == "T cell score · mean · X"


def test_a_link_made_before_sub_keys_has_no_column_and_means_the_z_score_mean(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "gene-score", "key": SIG, "label": "T cell score"})),))
    _wait_coloured(page)
    assert _calls(page, "compute")[0]["method"] == "zscore_mean"
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').value", C) == "zscore_mean"
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-layer-select[data-axis=\"color\"]').value", C) == "X"


def test_the_registry_lists_a_closed_signature_and_its_aggregations(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "none", "key": "", "column": ""})),), extra_cfgs=OTHER, sig_open=True)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    got = page.evaluate("""async () => {
        const reg = await import('/static/js/utils/source-registry.js');
        const p = reg.getSource('gene-score');
        return { entities: p.entities(), subs: p.subKeys('x'), def: p.defaultSub, entity: p.entity,
                 forX: reg.sourcesFor('cell-plot', 'x').map(q => q.type), forZ: reg.sourcesFor('cell-plot', 'z').map(q => q.type),
                 forGenePlot: reg.sourcesFor('gene-plot', 'x').map(q => q.type) };
    }""")
    assert sorted((e["id"], e["open"]) for e in got["entities"]) == [(SIG, True), (SIG2, False)], "the closed one is listed"
    assert [s["value"] for s in got["subs"]] == ["zscore_mean", "mean", "sum", "control_adjusted", "detected", "fraction_of_total"], \
        "every method: nothing is offered (decision 31)"
    assert got["def"] == "zscore_mean"
    assert got["forX"] == ["gene-score", "cell-group"] and got["forZ"] == ["gene-score", "cell-group"] and got["forGenePlot"] == []


def test_cells_without_a_score_on_an_axis_follow_hide_nan_and_are_counted(page, served):
    _slow(page, "auto", 1)
    cfg = _cell(x=SCORE, color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", cfg),), wait=False)
    until(page, "() => window.__ctls.length === 1")
    values = [float("nan") if i < 5 else float(i) for i in range(N_OBS)]
    page.evaluate("([v]) => window.__finish(0, v.map(x => x === null ? NaN : x))", [[None if v != v else v for v in values]])
    _ready_plot(page)
    assert _points(page) == 55
    strip = page.inner_text(f"{C} .plot-status")
    assert "55" in strip and "60" in strip, strip


def test_flipping_a_score_axis_and_zoom_are_kept(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x=SCORE, color={"type": "none", "key": "", "column": ""}, flipX=True)),))
    _ready_plot(page)
    assert page.evaluate("(t) => { const r = document.querySelector(t + ' .js-plotly-plot')._fullLayout.xaxis.range; return r[0] > r[1]; }", C), "flipped"
    page.evaluate("(t) => Plotly.relayout(document.querySelector(t + ' .js-plotly-plot'), {'xaxis.range': [3, 1]})", C)
    # let the zoom be recorded by the plot before it is redrawn
    page.wait_for_timeout(400)
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').refreshPlot()")
    # time for the redraw to move the zoom, were it going to; it must survive
    page.wait_for_timeout(1200)
    r = page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot')._fullLayout.xaxis.range", C)
    assert r[0] > r[1] and abs(r[0] - 3) < 1e-6, "the zoom the user chose survives a redraw"


def test_the_source_menus_take_the_signature_on_x_and_y(page, served):
    plain = _cell(color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", plain),), sig_open=True)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    _choose_score(page, "x")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().x.type === 'gene-score'")
    _choose_score(page, "y")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().y.type === 'gene-score'")
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig()")
    assert cfg["x"]["key"] == SIG and cfg["y"]["key"] == SIG and cfg["x"]["column"] == "zscore_mean"
    _ready_plot(page)
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"]


def test_large_plot_mode_takes_scores_on_x_y_and_colour_but_no_3d(large_page, large_served):
    both = _cell(x=SCORE, y=SCORE2, color=SCORE)
    _open(large_page, large_served, plots=(("cell-plot-C", both),), extra_cfgs=OTHER)
    _wait_large_coloured(large_page)
    assert sorted(c["genes"][0] for c in _calls(large_page, "compute")) == ["GENE0001", "GENE0010"]
    large_page.goto("about:blank")
    _open(large_page, large_served, plots=(("cell-plot-C", _cell(z=SCORE)),), wait=False)
    large_page.wait_for_selector(f"{C} .coverage-placeholder", timeout=30000)
    assert "3D is not available" in _placeholder(large_page)["text"]


def test_log_colour_scale_on_a_score_says_how_many_cells_sit_at_the_floor(page, served):
    """AnnZarro has a log COLOUR scale (the Log button, with a floor) and no log axis type: the axes of every
    source stay linear. A z-score is mostly negative; a log scale cannot show zero or below, so those cells are
    not dropped but drawn in the lowest colour, and the colour controls say how many."""
    _slow(page, "auto", 1)
    _open(page, served, plots=(("cell-plot-C", None),), wait=False)
    until(page, "() => window.__ctls.length === 1")
    # 30 cells below zero, 5 at zero, 25 above: 1, 2, ... 25
    values = [-3.0 + i * 0.1 for i in range(30)] + [0.0] * 5 + [float(i) for i in range(1, 26)]
    _finish(page, 0, values)
    _wait_coloured(page)
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot')._fullLayout.xaxis.type", C) == "linear"
    page.evaluate("() => document.getElementById('log-color-cell-plot-C').click()")
    until(page, "() => { const h = document.getElementById('color-log-hint-cell-plot-C'); return !!h && !h.hidden && h.textContent.length > 0; }")
    hint = page.inner_text("#color-log-hint-cell-plot-C")
    assert "36 of 60 cells have a score at or below 1" in hint, hint
    assert "lowest colour" in hint
    drawn = page.evaluate("""(t) => { const g = document.querySelector(t + ' .js-plotly-plot');
        const d = g.data.find(d => d.marker && d.marker.colorscale && (d.marker.color || []).length > 1);
        return Array.from(d.marker.color).map(Number); }""", C)
    assert len(drawn) == 60, "no cell is dropped"
    floor = min(drawn)
    assert sum(1 for v in drawn if v == floor) == 36, "the 35 at or below zero (and the first positive, 1, which is the floor) share the lowest colour"
    assert abs(max(drawn) - 1.39794) < 1e-4, "the largest score, 25, is log10 25"
    ticks = page.evaluate("""(t) => { const g = document.querySelector(t + ' .js-plotly-plot');
        const d = g.data.find(d => d.marker && d.marker.colorbar && d.marker.colorbar.tickvals); return d ? d.marker.colorbar.ticktext : null; }""", C)
    assert ticks, "the colour bar is labelled in the score's own units"
    assert len(_calls(page, "compute")) == 1, "the scale is applied to the score the plot holds"
    # off again: the hint goes with the log scale, and the colours are the scores
    page.evaluate("() => document.getElementById('log-color-cell-plot-C').click()")
    until(page, """(tile) => { const gd = document.querySelector(tile + ' .js-plotly-plot');
        const t = gd.data.find(t => t.marker && (Array.isArray(t.marker.color) || ArrayBuffer.isView(t.marker.color)));
        return !!t && Math.min(...Array.from(t.marker.color).map(Number)) === -3.0; }""", C)
    assert min(_numbers(page)) == -3.0


G = '.tile[data-tile-id="gene-plot-G"]'
VAR_MEAN = {"type": "var", "key": "mean", "column": ""}


def _gene_plot(**extra):
    return {"id": "gene-plot-G", "title": "Gene Plot 1", "x": VAR_MEAN, "y": VAR_MEAN, "z": None, "color": VAR_MEAN, **extra}


def test_a_gene_plot_with_a_gene_score_link_says_it_is_a_cell_source_and_the_rest_works(page, served):
    # as colour: the genes are drawn, in neutral points, with the sentence
    _open(page, served, plots=(("gene-plot-G", _gene_plot(color=SCORE)),), wait=False)
    page.wait_for_selector(f"{G} .js-plotly-plot", timeout=30000)
    until(page, "(t) => !!(document.querySelector(t + ' .plot-status') || {}).textContent && document.querySelector(t + ' .plot-status').textContent.includes('Gene scores are a cell source')", G)
    assert _calls(page) == [], "nothing is asked of the server"
    # as an axis: the placeholder says so
    page.goto("about:blank")
    _open(page, served, plots=(("gene-plot-G", _gene_plot(x=SCORE)),), wait=False)
    page.wait_for_selector(f"{G} .coverage-placeholder", timeout=30000)
    text = page.inner_text(f"{G} .coverage-placeholder")
    assert "Gene scores are a cell source; not available in a Gene Plot." in text
    assert "Failed" not in text
    # the type menu of a Gene Plot never offered it
    assert "gene-score" not in page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"x\"] option')].map(o => o.value)", G)


def test_new_signature_in_the_key_list_opens_a_signature_beside_the_plot_and_wires_the_axis(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "obs", "key": "score", "column": ""})),), sig=False)
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "gene-score")
    until(page, "(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].some(o => o.value === '__new_signature__')", C)
    labels = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-key-select[data-axis=\"color\"] option')].map(o => [o.textContent, o.disabled])", C)
    assert labels == [["No signatures or tables yet", True], ["New signature…", False]]
    page.select_option(f"{C} select.axis-key-select[data-axis='color']", "__new_signature__")
    until(page, "() => window.PanelManager.getPanelsByType('gene-signature').length === 1")
    new_id = page.evaluate("() => window.PanelManager.getPanelsByType('gene-signature')[0].getId()")
    page.wait_for_selector(f'.tile[data-tile-id="{new_id}"] .gsig-grid .gsig-row', timeout=30000)
    until(page, "(id) => window.PanelManager.getPanel('cell-plot-C').getConfig().color.key === id", new_id)
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.type") == "gene-score"
    page.wait_for_selector(f"{C} .score-notice[data-state='nogenes']")
    # genes ticked in the new signature colour the plot
    page.evaluate("(id) => window.PanelManager.getPanel(id).addGenes(['GENE0001', 'GENE0002'])", new_id)
    _wait_coloured(page)


def test_an_open_signature_nobody_uses_states_its_genes_without_computing(page, served):
    _open(page, served, plots=(), sig=_sig(genes=("GENE0001", "GENE0002", "NOT_A_GENE")), sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    # the line is always there (it keeps its height); wait for it to say something
    until(page, "(s) => !!document.querySelector(s + ' .gsig-score') && document.querySelector(s + ' .gsig-score').textContent !== ''", S)
    assert page.inner_text(f"{S} .gsig-score") == "Ready, 2 of 3 genes in this dataset."
    # time for a score request, were one going to; nobody uses the score
    page.wait_for_timeout(800)
    assert _calls(page) == [], "no score is computed for a score nobody uses"


def test_signatures_turned_off_by_the_administrator_says_so_over_the_plot(page, served):
    stub = {"version": "v1", "values": {"panel.gene-signature.enabled": False}}
    page.route("**/api/v1/policy/effective*", lambda route: route.fulfill(
        status=200, body=json.dumps(stub), headers={"Content-Type": "application/json", "X-AnnZarro-Policy": "v1"}))
    _open(page, served, wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='off']", timeout=30000)
    assert "Gene signatures are turned off on this server." in _notice(page)["text"]
    assert _tag(page) == "Turned off"
    assert _calls(page) == []
    assert _drawn(page), "the plot is drawn, in neutral points"
