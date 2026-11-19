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

LINE = """(o) => new TextEncoder().encode(JSON.stringify(o) + '\\n')"""


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
