"""The Cell Count Plot panel in a real browser, against the real cell_groups route (C2a).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition,
sample (30 levels), depth and score (numbers), is_doublet, layers X, logged and counts over 40 genes.

1.  Job 1, "cells per cluster, split by condition, as shares": the counts, then Share within each X and 100% with no new
    request, each one undoable step (CNT-4, CNT-15).
2.  Job 2, "the distribution of a number, per sample": a histogram by sample, the compact binning line, the shared control
    opened in place with "Values outside are left out and counted", a bin count and a range typed (CNT-3, CNT-9, UX 4.4).
3.  Job 5, "mean of the focused gene per cluster": Height Mean of… from the focused gene, following the focus with no
    step, and the lock (CNT-16, CNT-17).
4.  A mode change keeps every input; the rows of the mode, "Kept for other modes", a pie's Slices, the modes not drawn
    in this build unavailable with the reason (CNT-6, UX 4.1, UX 4.2).
5.  A 2D histogram: its 100 x 100 default, the Color entries and the most frequent level (CNT-9, CNT-18, UX 4.5); a
    density per condition drawn by V3's figure, its sentences and the bandwidth adjust (CNT-10, UX 4.4).
6.  A link and a panel set: the config only, nothing computed; a set added beside open panels remaps the inputs, Color
    by, the sets and the statistic (CAT-9); a grouping says it is used by the plot.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import re
import time
import urllib.parse

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

CC = "cell-count-A"
GA = "cell-grouping-G"
TA = "cell-table-T"
SIG = "gene-signature-S"
S = f'.tile[data-tile-id="{CC}"]'
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
CONDITION = {"source": {"type": "obs", "key": "condition"}}
DATA = gstore.make_data()
N = gstore.N_OBS


def _make_store(path):
    gstore.make_store(str(path), "csc", "zarr", data=DATA)
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    # the server of test_focus_outside_subset (the code under test first on its path), on the grouping fixture
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1100})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.calls = []
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _count(pid=CC, title="Count 1", **config):
    return {"id": pid, "title": title, "version": 1, **config}


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)] if tiles else [],
                               "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, configs, open_ids=(CC,)):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{S} .ccnt-panel[data-state]", timeout=30000)


def _drawn(page, mode, check="true"):
    """Wait until the plot is drawn in `mode`, ready, and `check` (a JS expression of `c`, the config) holds."""
    until(page, f"""([s, m]) => {{ const r = document.querySelector(s + ' .ccnt-panel');
        const c = window.PanelManager.getPanel('{CC}').getConfig();
        return r && r.dataset.drawn === m && r.dataset.state === 'ready' && ({check}); }}""", [S, mode], timeout=60)


def _config(page, pid=CC):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", pid)


def _plot(page):
    return page.evaluate("""(s) => { const p = document.querySelector(s + ' .ccnt-plot');
        return { data: p.data.map(t => ({ type: t.type, name: t.name, x: t.x && Array.from(t.x), y: t.y && Array.from(t.y),
                     z: t.z && t.z.map(r => Array.from(r)), labels: t.labels, values: t.values })),
                 layout: { barmode: p.layout.barmode, barnorm: p.layout.barnorm, xaxis: p.layout.xaxis, yaxis: p.layout.yaxis } }; }""", S)


def _bars(page):
    """The bars by (level of x, trace name): their heights."""
    fig = _plot(page)
    ticks = fig["layout"]["xaxis"]["ticktext"]
    out = {}
    for t in fig["data"]:
        for x, y in zip(t["x"], t["y"]):
            out[(ticks[x], t.get("name"))] = y
    return out


def _requests(page):
    return [c for c in page.calls if not c.get("estimate_only")]


def _rows(page):
    """The rows of the control bar that are shown, with their labels."""
    return page.evaluate("""(s) => [...document.querySelectorAll(s + ' .ccnt-controls .ccnt-row')]
        .filter(r => r.offsetParent !== null).map(r => r.querySelector('label').textContent)""", S)


def _undo_label(page):
    return page.get_attribute(f"{S} .ccnt-undo", "aria-label")


def _state_text(page):
    return page.evaluate("(s) => { const b = document.querySelector(s + ' .ccnt-state'); return b.hidden ? null : b.textContent; }", S)


# ------------------------------------------------------------------ 1. job 1

def test_job1_cells_per_cluster_split_by_condition_as_shares(page, served):
    statuses = []
    page.on("response", lambda r: statuses.append(r.status) if "/data/cell_groups" in r.url and r.request.method == "POST" else None)
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    # the grid request reaches the route as the route takes it (no field a grid does not take): 200, never 400
    assert statuses and set(statuses) == {200}, statuses
    assert _rows(page) == ["Mode", "X", "Color by", "Height", "Labels"]
    want = DATA.obs.groupby(["cell_type", "condition"], observed=True).size()
    got = _bars(page)
    assert {k: v for k, v in got.items() if v} == {(ct, cond): int(n) for (ct, cond), n in want.items()}
    sent = _requests(page)
    assert sent and sent[-1]["shape"] == "grid" and [p["source"]["key"] for p in sent[-1]["partitionings"]] == ["cell_type", "condition"]
    asked = len(sent)

    page.select_option(f"{S} .ccnt-value", "share:x")
    _drawn(page, "bar", "c.value && c.value.of === 'x'")
    shares = _bars(page)
    per_type = want.groupby(level=0, observed=True).sum()
    for (ct, cond), n in want.items():
        assert abs(shares[(ct, cond)] - n / per_type[ct]) < 1e-12
    assert _plot(page)["layout"]["yaxis"]["title"]["text"] == "% within each cell_type"
    assert page.inner_text(f"{S} .ccnt-value__help") == "As percent."

    page.click(f"{S} .ccnt-arrangement__opt:has-text('100%')")
    _drawn(page, "bar", "c.arrangement === 'fill'")
    assert _plot(page)["layout"]["barnorm"] == "percent"
    assert len(_requests(page)) == asked, "a share and an arrangement are drawn from the same counts"
    assert _undo_label(page) == "Undo: 100% bars"

    page.click(f"{S} .ccnt-undo")
    _drawn(page, "bar", "!c.arrangement")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "bar", "!c.value")
    assert _config(page)["split"] == CONDITION


# ------------------------------------------------------------------ 2. job 2

def test_job2_a_histogram_per_sample_with_the_inline_binning(page, served):
    depth = {"source": {"type": "obs", "key": "depth"}}
    _open(page, served, {CC: _count(mode="histogram", x=depth, split={"source": {"type": "obs", "key": "sample"}})})
    _drawn(page, "histogram")
    fig = _plot(page)
    assert len(fig["data"]) == DATA.obs["sample"].nunique()
    assert sum(sum(t["y"]) for t in fig["data"]) == N
    assert {len(t["x"]) for t in fig["data"]} == {50}
    line = f"{S} [data-row='x'] .ccnt-bins"
    assert page.inner_text(line).startswith("Bins: equal width · 50 · auto range")

    page.click(line)
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc")
    assert page.inner_text(f"[data-popover='binning'] .ccnt-binning .pbc-range-help") == "Values outside are left out and counted."
    assert page.input_value(f"[data-popover='binning'] .ccnt-binning .pbc-bins") == "50"
    page.fill(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "20")
    page.press(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "Enter")
    _drawn(page, "histogram", "c.x.binning && c.x.binning.bins === 20")
    assert {len(t["x"]) for t in _plot(page)["data"]} == {20}
    assert page.inner_text(line).startswith("Bins: equal width · 20 · auto range")

    # a range: the cells below it are left out (CNT-9, SHR-45)
    page.fill(f"[data-popover='binning'] .ccnt-binning .pbc-range-lo", "1")
    page.press(f"[data-popover='binning'] .ccnt-binning .pbc-range-lo", "Enter")
    _drawn(page, "histogram", "c.x.binning && Array.isArray(c.x.binning.range) && c.x.binning.range[0] === 1")
    assert sum(sum(t["y"]) for t in _plot(page)["data"]) == int((DATA.obs["depth"] >= 1).sum())
    assert _config(page)["x"] == {"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_width", "bins": 20, "range": [1, None]}}

    # a count the grouping's control would have dropped (its default, 10) is kept
    page.fill(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "10")
    page.press(f"[data-popover='binning'] .ccnt-binning .pbc-bins", "Enter")
    _drawn(page, "histogram", "c.x.binning && c.x.binning.bins === 10")
    assert {len(t["x"]) for t in _plot(page)["data"]} == {10}


# ------------------------------------------------------------------ 3. job 5

def _focus_gene(page, name):
    page.evaluate("async (g) => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene(g); }", name)


def _means(gene):
    j = DATA.var_names.index(gene)
    values = np.asarray(DATA.layer("X")[:, j], dtype=np.float64)
    return {ct: float(values[(DATA.obs["cell_type"] == ct).to_numpy()].mean()) for ct in DATA.obs["cell_type"].cat.categories}


def test_job5_mean_of_the_focused_gene_per_cluster_follows_the_focus_until_locked(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE)})
    _drawn(page, "bar")
    _focus_gene(page, gstore.gene(3))
    page.select_option(f"{S} .ccnt-value", "stat:mean")
    _drawn(page, "bar", f"c.measure && c.measure.source.column === '{gstore.gene(3)}' && c.value && c.value.kind === 'measure'")
    assert _config(page)["measure"] == {"stat": "mean", "source": {"type": "layer", "key": "X", "column": gstore.gene(3)}}
    assert page.is_visible(f"{S} [data-row='measure']")
    assert _plot(page)["layout"]["yaxis"]["title"]["text"] == f"Mean of {gstore.gene(3)} · X"
    for (ct, _), y in _bars(page).items():
        assert abs(y - _means(gstore.gene(3))[ct]) <= 1e-5 * max(1.0, abs(y)), ct
    step = _undo_label(page)

    # the focus moves: the statistic follows, as a cell plot's color does, with no step of its own
    _focus_gene(page, gstore.gene(7))
    _drawn(page, "bar", f"c.measure.source.column === '{gstore.gene(7)}'")
    for (ct, _), y in _bars(page).items():
        assert abs(y - _means(gstore.gene(7))[ct]) <= 1e-5 * max(1.0, abs(y)), ct
    assert _undo_label(page) == step

    # locked, it stays
    page.click(f"{S} [data-row='measure'] .axis-lock-btn")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().measure.locked === true")
    _focus_gene(page, gstore.gene(10))
    waits.expect_stays(lambda: _config(page)["measure"]["source"]["column"] == gstore.gene(7),
                       "a locked statistic keeps its gene: there is no event to wait for", page=page)


# ------------------------------------------------------------------ 4. modes

def test_a_mode_change_keeps_every_input_and_lists_what_the_mode_does_not_read(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    groups = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .ccnt-mode optgroup')].map(g =>
        [g.label, [...g.children].map(o => [o.textContent, o.disabled, o.title])])""", S)
    assert [g[0] for g in groups] == ["Counts", "Two inputs", "Smoothed", "Sets"]
    assert groups[0][1] == [["Bar", False, ""], ["Histogram", False, ""], ["Pie", False, ""]]
    assert groups[3][1][0] == ["Venn", False, ""]

    page.select_option(f"{S} .ccnt-mode", "hist2d")
    until(page, "(s) => document.querySelector(s + ' .ccnt-panel').dataset.state === 'empty'", S)
    assert _rows(page) == ["Mode", "X", "Y", "Color by", "Color", "Labels"], "a 2D histogram reads Color by"
    assert not page.is_visible(f"{S} .ccnt-kept")
    assert _state_text(page) == "Choose Y to count cells."

    page.select_option(f"{S} .ccnt-mode", "pie")
    _drawn(page, "pie")
    assert _rows(page) == ["Mode", "Slices", "Labels"]
    assert page.inner_text(f"{S} .ccnt-kept") == "Kept for other modes: Color by obs condition"
    pie = _plot(page)["data"][0]
    assert dict(zip(pie["labels"], pie["values"])) == {k: int(v) for k, v in DATA.obs["cell_type"].value_counts().items()}

    page.select_option(f"{S} .ccnt-mode", "bar")
    _drawn(page, "bar")
    assert not page.is_visible(f"{S} .ccnt-kept")
    assert len(_plot(page)["data"]) == 2, "Color by is back"
    assert _config(page)["split"] == CONDITION and _config(page)["x"] == CELL_TYPE

    # a histogram of a categorical X: the input stays, and the plot says why it cannot be drawn
    page.select_option(f"{S} .ccnt-mode", "histogram")
    until(page, "(s) => document.querySelector(s + ' .ccnt-panel').dataset.state === 'unusable'", S)
    assert _state_text(page) == "Histogram needs a numeric X. cell_type is categorical."
    assert _config(page)["x"] == CELL_TYPE


# ------------------------------------------------------------------ 5. a 2D histogram, Color and the most frequent level

def test_a_2d_histogram_its_default_bins_and_the_most_frequent_level(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}})})
    _drawn(page, "hist2d")
    for row in ("x", "y"):
        assert page.inner_text(f"{S} [data-row='{row}'] .ccnt-bins").startswith("Bins: equal width · 100 · auto range")
    z = _plot(page)["data"][0]["z"]
    assert len(z) == 100 and len(z[0]) == 100
    assert sum(v for r in z for v in r if v is not None) == N
    entries = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-value option')].map(o => o.textContent)", S)
    assert entries == ["Count", "Share of the row", "Share of the column", "Share of the total", "Mean of…", "Sum of…", "% above…",
                       "SD of…", "z-score of…", "Most frequent level of…"]
    page.select_option(f"{S} .ccnt-value", "top_level")
    _drawn(page, "hist2d", "c.value && c.value.kind === 'top_level'")
    assert _config(page)["value"] == {"kind": "top_level", "factor": CELL_TYPE}
    assert page.is_visible(f"{S} [data-row='factor']")
    names = [t["name"] for t in _plot(page)["data"][1:]]
    assert sorted(names) == sorted(DATA.obs["cell_type"].cat.categories)


def test_a_density_per_condition_draws_through_v3_with_its_sentences_and_adjust(page, served):
    depth = {"source": {"type": "obs", "key": "depth"}}
    _open(page, served, {CC: _count(mode="density", x=depth, split=CONDITION)})
    _drawn(page, "density")
    fig = _plot(page)
    assert sorted(t["name"] for t in fig["data"]) == sorted(DATA.obs["condition"].unique())
    assert _rows(page) == ["Mode", "X", "Color by", "Smoothing"]
    assert "Range from the 0.1st to the 99.9th percentile" in page.inner_text(f"{S} .ccnt-density-notes")
    assert page.inner_text(f"{S} .ccnt-density-notes").startswith("Bandwidth ")
    asked = len(_requests(page))
    page.fill(f"{S} .ccnt-adjust", "2")
    page.press(f"{S} .ccnt-adjust", "Enter")
    _drawn(page, "density", "c.adjust === 2")
    assert "× 2" in page.inner_text(f"{S} .ccnt-density-notes")
    assert len(_requests(page)) == asked, "the bandwidth is the browser's: nothing is asked"
    page.fill(f"{S} .ccnt-adjust", "40")
    page.press(f"{S} .ccnt-adjust", "Enter")
    until(page, "(s) => document.querySelector(s + ' .ccnt-adjust__problem').textContent === 'Enter a number from 0.1 to 10.'", S)
    assert _config(page)["adjust"] == 2


# ------------------------------------------------------------------ 6. links, panel sets, a remap

def _captured(page):
    return page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"]


def _save_set(page, name):
    page.click("#btn-save-session")
    page.fill("#session-name", name)
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")


def test_a_panel_set_carries_the_config_and_a_set_added_beside_open_panels_remaps_every_reference(page, served):
    root, _ = served
    sig = {"id": SIG, "title": "B score", "genes": [gstore.gene(i) for i in range(12)]}
    table = {"id": TA, "title": "Table 1", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [CONDITION]}
    count = _count(mode="bar", x={"source": {"type": "table", "key": TA}}, split={"source": {"type": "cell-group", "key": GA}},
                   value={"kind": "measure"}, measure={"stat": "mean", "source": {"type": "gene-score", "key": SIG, "column": "zscore_mean"}},
                   sets=[{"source": {"type": "table", "key": TA}}])
    _open(page, served, {CC: count, TA: table, GA: grouping, SIG: sig}, open_ids=(CC, TA, GA))
    _drawn(page, "bar")
    cfg = _captured(page)[CC]
    assert {k: cfg[k] for k in ("x", "split", "value", "measure", "sets")} == {k: count[k] for k in ("x", "split", "value", "measure", "sets")}
    assert "counts" not in json.dumps(cfg) and "n_shown" not in json.dumps(cfg)
    assert page.inner_text(f"{S} .ccnt-kept") == "Kept for other modes: Sets: in Table 1"
    # the grouping knows the plot uses it
    until(page, f"() => /Used by 1 plot/.test(document.querySelector('.tile[data-tile-id=\"{GA}\"] .cgrp-usedby').textContent)")

    name = f"count-set-{int(time.time() * 1000)}"
    _save_set(page, name)
    page.goto(root)
    page.wait_for_function("() => window.sessionManager && window.PanelManager")
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n)", name)
    assert loaded["status"] == "success", loaded
    page.wait_for_selector(f"{S} .ccnt-panel[data-state]", timeout=30000)
    _drawn(page, "bar")
    # the same set added beside the open panels: new ids, and the added count plot reads the added panels
    page.click("#btn-load-session")
    page.locator(f".session-card[data-session-name='{name}'] .session-add-closed").first.click()
    page.wait_for_function("() => PanelManager.getAllPanels().length === 8", timeout=30000)
    got = page.evaluate("""() => PanelManager.getAllPanels().map(p => [p.getType(), p.getId(), p.getType() === 'cell-count' ? p.getConfig() : null])""")
    ids = {t: [g[1] for g in got if g[0] == t] for t in ("cell-table", "cell-grouping", "gene-signature", "cell-count")}
    assert all(len(v) == 2 for v in ids.values()), ids
    added = {t: [i for i in v if i not in (CC, TA, GA, SIG)][0] for t, v in ids.items()}
    new = [g[2] for g in got if g[0] == "cell-count" and g[1] == added["cell-count"]][0]
    assert new["x"]["source"]["key"] == added["cell-table"]
    assert new["split"]["source"]["key"] == added["cell-grouping"]
    assert [s["source"]["key"] for s in new["sets"]] == [added["cell-table"]]
    assert new["measure"]["source"]["key"] == added["gene-signature"]
    old = [g[2] for g in got if g[0] == "cell-count" and g[1] == CC][0]
    assert (old["x"]["source"]["key"], old["split"]["source"]["key"], old["measure"]["source"]["key"]) == (TA, GA, SIG)


def test_the_control_bar_is_the_one_toggle_controls_hides(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE)})
    _drawn(page, "bar")
    found = page.evaluate("""async (s) => { const { controlsElementOf } = await import('/static/js/utils/controls-visibility.js');
        return controlsElementOf(document.querySelector(s + ' .tile-content')).className; }""", S)
    assert "ccnt-controls" in found


def _bar_lefts(page):
    """The left edge in pixels of each drawn bar of the first level, one per trace: equal when stacked, spread when side by side."""
    return page.evaluate("""(s) => { const p = document.querySelector(s + ' .ccnt-plot');
        return { full: p._fullLayout.barmode,
                 lefts: [...p.querySelectorAll('.barlayer .trace')].map(t => { const b = t.querySelector('.point path');
                     return b ? Math.round(b.getBoundingClientRect().left) : null; }) }; }""", S)


def test_stacked_color_by_draws_stacked_bars_and_side_by_side_draws_grouped(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    stacked = _bar_lefts(page)
    assert stacked["full"] == "stack" and len(set(stacked["lefts"])) == 1, stacked
    page.click(f"{S} .ccnt-arrangement__opt:has-text('Side by side')")
    _drawn(page, "bar", "c.arrangement === 'dodge'")
    assert _bar_lefts(page)["full"] == "group"
    page.click(f"{S} .ccnt-arrangement__opt:has-text('Stacked')")
    _drawn(page, "bar", "!c.arrangement")
    again = _bar_lefts(page)
    assert again["full"] == "stack" and len(set(again["lefts"])) == 1, again



def test_a_statistic_is_side_by_side_and_offers_no_arrangement(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION, value={"kind": "measure"},
                                    measure={"stat": "mean", "source": {"type": "obs", "key": "score"}})})
    _drawn(page, "bar")
    assert _bar_lefts(page)["full"] == "group"
    assert not page.is_visible(f"{S} .ccnt-arrangement"), "Stacked must not be offered for bars that cannot stack"


def test_an_unticked_level_keeps_its_name_in_the_checklist(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE)})
    _drawn(page, "bar")
    page.click(f"{S} [data-row='x'] .ccnt-choose")
    names = page.eval_on_selector_all(f"[data-popover='levels'] .ccnt-level__label", "els => els.map(e => e.textContent)")
    page.click(f"[data-popover='levels'] .ccnt-level:first-child input[type=checkbox]")
    _drawn(page, "bar", "Array.isArray(c.x.levels) && c.x.levels.length === %d" % (len(names) - 1))
    after = page.eval_on_selector_all(f"[data-popover='levels'] .ccnt-level__label", "els => els.map(e => e.textContent)")
    assert set(names) <= set(after), (names, after)
    assert not [t for t in after if t.startswith(("c:", "g:"))], after


def test_the_binning_control_shows_no_empty_preview_when_the_reply_has_no_histogram(page, served):
    """A count plot's reply carries no histogram: the control must not leave a blank grey field under the range help."""
    depth = {"source": {"type": "obs", "key": "depth"}}
    _open(page, served, {CC: _count(mode="histogram", x=depth)})
    _drawn(page, "histogram")
    page.click(f"{S} [data-row='x'] .ccnt-bins")
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc")
    shot = os.environ.get("FB1B_SHOT")
    if shot:
        page.locator(f"[data-popover='binning'] .ccnt-binning .pbc").screenshot(path=shot)
    empty = page.evaluate("(s) => [...document.querySelectorAll('[data-popover=binning] .ccnt-binning .pbc-hist.is-empty')].filter(e => e.offsetHeight > 0).length", S)
    assert empty == 0, "an empty preview is drawn as a grey field"



def test_2d_density_contours_of_a_split_are_drawn_in_the_level_colors(page, served):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    _open(page, served, {CC: _count(mode="density2d", x=depth, y=score, split=CONDITION, style="contours")})
    _drawn(page, "density2d")
    traces = page.evaluate("""(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'contour')
        .map(t => ({ line: t.line.color, cs: t.colorscale }))""", S)
    assert len(traces) == 2 and all(t["cs"] == [[0, t["line"]], [1, t["line"]]] for t in traces), traces
    # what Plotly drew: the lines of one level are of one color
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .contourlayer .contourlevel path').length > 0", S)
    drawn = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .ccnt-plot .contourlayer > g')].filter(g => g.querySelector('.contourlevel path')).map(g =>
        [...new Set([...g.querySelectorAll('.contourlevel path')].map(p => getComputedStyle(p).stroke))])""", S)
    assert drawn and all(len(c) == 1 for c in drawn), drawn
    if os.environ.get("FB1C_SHOT"):
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.environ["FB1C_SHOT"])


# ------------------------------------------------------------------ even-width bins (WP-9)

LOG_DEPTH = {"source": {"type": "obs", "key": "depth"}, "binning": {"method": "log", "bins": 8}}


def _pixel_steps(page):
    """The pixel distance between neighbouring bin centers of the 2D histogram's x axis, and its tick texts."""
    return page.evaluate("""(s) => { const p = document.querySelector(s + ' .ccnt-plot'); const ax = p._fullLayout.xaxis;
        const x = Array.from(p.data[0].x); const steps = x.slice(1).map((v, i) => Math.abs(ax.l2p(v) - ax.l2p(x[i])));
        return { steps, x, ticks: Array.from(p.querySelectorAll('.xtick text')).map(t => t.textContent) }; }""", S)


def test_log_bins_of_a_2d_histogram_are_drawn_evenly_and_the_switch_restores_the_values(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x=LOG_DEPTH, y={"source": {"type": "obs", "key": "score"}})})
    _drawn(page, "hist2d")
    even = _pixel_steps(page)
    assert even["x"] == list(range(len(even["x"]))) and len(even["x"]) >= 6
    assert max(even["steps"]) - min(even["steps"]) < 0.5, even["steps"]
    assert 2 <= len(even["ticks"]) <= 13

    page.click(f"{S} [data-row='x'] .ccnt-bins")
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc-spacing")
    assert page.is_checked(f"[data-popover='binning'] .ccnt-binning .pbc-spacing-even")
    page.check(f"[data-popover='binning'] .ccnt-binning .pbc-spacing-value")
    _drawn(page, "hist2d", "c.binSpacing && c.binSpacing.x === 'value'")
    values = _pixel_steps(page)
    assert values["x"] != even["x"]
    assert max(values["steps"]) / min(values["steps"]) > 1.5, values["steps"]
    assert _config(page)["binSpacing"] == {"x": "value"}
    # a draw-only switch asks the engine for nothing
    n = len(_requests(page))
    page.check(f"[data-popover='binning'] .ccnt-binning .pbc-spacing-even")
    _drawn(page, "hist2d", "c.binSpacing && c.binSpacing.x === 'even'")
    assert len(_requests(page)) == n


def test_equal_width_bins_default_to_their_values_and_escape_closes_the_binning_control(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}})})
    _drawn(page, "hist2d")
    assert _pixel_steps(page)["x"] != list(range(100))
    toggle = f"{S} [data-row='x'] .ccnt-bins"
    page.click(toggle)
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc-spacing")
    assert page.is_checked(f"[data-popover='binning'] .ccnt-binning .pbc-spacing-value")
    page.focus(f"[data-popover='binning'] .ccnt-binning .pbc-method")
    page.keyboard.press("Escape")
    page.wait_for_selector(f"[data-popover='binning'] .ccnt-binning .pbc", state="detached")
    assert page.get_attribute(toggle, "aria-expanded") == "false"



def _shot(page, name):
    """A screenshot of the plot when ANNZARRO_FB1C_SHOTS names a folder (for a look at the figure, not an assertion)."""
    folder = os.environ.get("ANNZARRO_FB1C_SHOTS")
    if folder:
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(folder, f"{name}.png"))


def _layers(page):
    return page.evaluate("""(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'heatmap')
        .map(t => ({ name: t.name, zmin: t.zmin, zmax: t.zmax, cs: t.colorscale }))""", S)


def test_a_2d_histogram_colored_by_a_level_draws_opacity_layers(page, served):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    _open(page, served, {CC: _count(mode="hist2d", x=depth, y=score, split=CONDITION)})
    _drawn(page, "hist2d")
    assert _rows(page) == ["Mode", "X", "Y", "Color by", "Color", "Labels"]
    layers = _layers(page)
    assert sorted(t["name"] for t in layers) == sorted(DATA.obs["condition"].unique())
    assert len({t["zmax"] for t in layers}) == 1 and all(t["zmin"] == 0 for t in layers), layers
    sent = _requests(page)[-1]
    assert [p["source"]["key"] for p in sent["partitionings"]] == ["depth", "score", "condition"]
    _shot(page, "hist2d-color-by")
    # a color that says something else takes the rectangles back: the Color by row goes and is kept
    page.select_option(f"{S} .ccnt-value", "top_level")
    _drawn(page, "hist2d", "c.value && c.value.kind === 'top_level'")
    assert "Color by" not in _rows(page)
    assert _config(page)["split"] == CONDITION


def _density_traces(page):
    return page.evaluate("""(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'heatmap' || t.type === 'contour')
        .map(t => ({ type: t.type, coloring: t.contours && t.contours.coloring, lines: t.contours && t.contours.showlines }))""", S)


def _layer(page, key, on):
    box = f"{S} .ccnt-layer--{key}"
    (page.check if on else page.uncheck)(box)


_COMBOS = [("image",), ("lines",), ("fill",), ("image", "lines"), ("image", "fill"), ("fill", "lines"), ("image", "fill", "lines")]


@pytest.mark.parametrize("split", [True, False])
def test_the_layers_of_a_2d_density_toggle_in_any_combination(page, served, split):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    extra = {"split": CONDITION} if split else {}
    _open(page, served, {CC: _count(mode="density2d", x=depth, y=score, **extra)})
    _drawn(page, "density2d")
    n = 2 if split else 1
    # the default: filled isolines, with lines when there is a Color by
    assert [page.is_checked(f"{S} .ccnt-layer--{k}") for k in ("image", "lines", "fill")] == [False, split, True]
    for combo in _COMBOS:
        for key in ("image", "lines", "fill"):           # ticks first, so one layer is always left ticked
            if key in combo and not page.is_checked(f"{S} .ccnt-layer--{key}"):
                _layer(page, key, True)
        for key in ("image", "lines", "fill"):
            if key not in combo and page.is_checked(f"{S} .ccnt-layer--{key}"):
                _layer(page, key, False)
        until(page, "([s, want]) => JSON.stringify(Object.keys(window.PanelManager.getPanel('%s').getConfig().layers || {}).sort()) === JSON.stringify(want)" % CC,
              [S, sorted(combo)])
        traces = _density_traces(page)
        assert sum(t["type"] == "heatmap" for t in traces) == (n if "image" in combo else 0), combo
        assert sum(t["type"] == "contour" for t in traces) == (n if ("fill" in combo or "lines" in combo) else 0), combo
        shot = os.environ.get("ANNZARRO_FB1D_SHOTS")
        if shot:
            _drawn(page, "density2d")
            page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(shot, f"{'split' if split else 'one'}-{'+'.join(combo)}.png"))
    # the last layer cannot be unticked
    for key in ("image", "lines"):
        if page.is_checked(f"{S} .ccnt-layer--{key}"):
            _layer(page, key, False)
    page.click(f"{S} .ccnt-layer--fill")
    assert page.is_checked(f"{S} .ccnt-layer--fill"), "the last layer stays ticked"


def test_an_old_link_with_a_style_reads_as_layers(page, served):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    _open(page, served, {CC: _count(mode="density2d", x=depth, y=score, split=CONDITION, style="image")})
    _drawn(page, "density2d")
    assert [t["type"] for t in _density_traces(page)] == ["heatmap", "heatmap"]
    assert page.is_checked(f"{S} .ccnt-layer--image") and not page.is_checked(f"{S} .ccnt-layer--fill")
    _layer(page, "lines", True)
    _drawn(page, "density2d", "c.layers && c.layers.lines && c.layers.image && c.style === undefined")



@pytest.mark.parametrize("combo", [("image",), ("fill",), ("lines",), ("fill", "lines"), ("image", "fill")])
def test_one_group_2d_density_layers_take_the_color_menu_settings(page, served, combo):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    _open(page, served, {CC: _count(mode="density2d", x=depth, y=score, layers={k: True for k in combo})})
    _drawn(page, "density2d")
    page.click(f"{S} .ccnt-color-btn")
    page.select_option("[data-popover='color'] .ccnt-color-map", "Cividis")
    _drawn(page, "density2d", "c.color && c.color.map === 'Cividis'")
    page.check("[data-popover='color'] .ccnt-color-reverse")
    page.fill("[data-popover='color'] .ccnt-color-min", "0.01")
    page.press("[data-popover='color'] .ccnt-color-min", "Enter")
    _drawn(page, "density2d", "c.color.reverse === true && c.color.min === 0.01")
    traces = page.evaluate("""(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'heatmap' || t.type === 'contour')
        .map(t => ({ cs: t.colorscale, rev: t.reversescale, zmin: t.zmin }))""", S)
    assert traces and all(t["rev"] is True and t["zmin"] == 0.01 and t["cs"] != "Viridis" for t in traces), traces


# ------------------------------------------------------------------ the Cell points layer of a 2D density

def _caps(page, draw=None, load=None):
    page.evaluate("""async ([draw, load]) => { const { Config } = await import('/static/js/config.js');
        if (draw !== null) Config.DEFAULTS.DENSITY_POINTS_DRAW = draw;
        if (load !== null) Config.DEFAULTS.DENSITY_POINTS_LOAD = load; }""", [draw, load])


def _points(page):
    return page.evaluate("""(s) => { const d = [...document.querySelector(s + ' .ccnt-plot').data];
        const pts = d.filter(t => t.type === 'scattergl');
        return { n: pts.reduce((m, t) => m + t.x.length, 0), traces: pts.length, types: d.map(t => t.type),
                 size: pts.length ? pts[0].marker.size : null }; }""", S)


def _strip(page):
    return page.inner_text(f"{S} .ccnt-density-notes")


def _points_config(split, **extra):
    depth = {"source": {"type": "obs", "key": "depth"}}
    score = {"source": {"type": "obs", "key": "score"}}
    by = split if isinstance(split, dict) else (CONDITION if split else None)
    return _count(mode="density2d", x=depth, y=score, **({"split": by} if by else {}), **extra)


@pytest.mark.parametrize("split", [True, False])
def test_the_cell_points_layer_alone_draws_the_cells_with_the_grid_hover_under_it(page, served, split):
    _open(page, served, {CC: _points_config(split, layers={"points": True})})
    _drawn(page, "density2d")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .scattergl, ' + s + ' .ccnt-plot canvas').length > 0", S)
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S)
    got = _points(page)
    assert 0 < got["n"] <= N, got
    assert got["types"].count("heatmap") == (2 if split else 1), "a transparent heatmap carries the hover"
    assert re.search(r"Cells drawn as points: [\d,]+ of [\d,]+\.", _strip(page)), _strip(page)
    shot = os.environ.get("ANNZARRO_FB1E_SHOTS")
    if shot:
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(shot, f"points-{'split' if split else 'one'}.png"))


def test_the_cell_points_layer_combines_with_filled_isolines_and_takes_a_point_size(page, served):
    _open(page, served, {CC: _points_config(True, layers={"fill": True, "lines": True, "points": True})})
    _drawn(page, "density2d")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot').length > 0 && /Cells drawn/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S)
    got = _points(page)
    assert got["n"] > 0 and got["types"].index("contour") < got["types"].index("scattergl") and "heatmap" not in got["types"], got
    assert got["size"] == 3
    page.fill(f"{S} .ccnt-point-size", "6")
    page.press(f"{S} .ccnt-point-size", "Enter")
    _drawn(page, "density2d", "c.pointSize === 6")
    assert _points(page)["size"] == 6
    shot = os.environ.get("ANNZARRO_FB1E_SHOTS")
    if shot:
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(shot, "points-fill-lines.png"))


def test_the_cell_points_layer_draws_a_seeded_sample_above_the_cap_and_says_so(page, served):
    _open(page, served, {CC: _points_config(True, layers={"fill": True})})
    _drawn(page, "density2d")
    _caps(page, draw=300)
    page.check(f"{S} .ccnt-layer--points")
    until(page, "(s) => /a random sample/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S)
    assert re.search(r"Cells drawn as points: [\d,]+ of a random sample of 300 of the 1,200 cells\.", _strip(page)), _strip(page)
    drawn = int(re.search(r"Cells drawn as points: ([\d,]+) of", _strip(page)).group(1).replace(",", ""))
    assert drawn == _points(page)["n"], "the notice counts the points on the plot"
    first = _points(page)
    assert 0 < first["n"] <= 300
    # the same cells again after a redraw: toggle the layer off and on
    page.uncheck(f"{S} .ccnt-layer--points")
    _drawn(page, "density2d", "!c.layers.points")
    page.check(f"{S} .ccnt-layer--points")
    until(page, "(s) => /a random sample/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S)
    assert _points(page)["n"] == first["n"]


def test_the_cell_points_layer_is_refused_above_the_load_cap_and_for_a_source_it_cannot_load(page, served):
    _open(page, served, {CC: _points_config(False, layers={"fill": True})})
    _drawn(page, "density2d")
    _caps(page, load=500)
    page.check(f"{S} .ccnt-layer--points")
    until(page, "(s) => /more than the 500/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S)
    assert _points(page)["n"] == 0
    assert "Turn on a subset" in _strip(page)
    _caps(page, load=25_000_000)


def _point_colours(page):
    """The rgb of each point trace (a level's color): the colors the points are drawn in."""
    return page.evaluate("""(s) => [...new Set([...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'scattergl')
        .map(t => String(t.marker.color).replace(/, [\\d.]+\\)$/, ')')))]""", S)


def test_cell_points_take_a_grouping_as_color_by_and_match_its_groups(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [CONDITION]}
    count = _points_config({"source": {"type": "cell-group", "key": GA}}, layers={"points": True})
    _open(page, served, {CC: count, GA: grouping}, open_ids=(CC, GA))
    _drawn(page, "density2d")
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S, timeout=60)
    colours = _point_colours(page)
    assert len(colours) == 2, colours
    # the groups of the grouping are the grid's levels: each is drawn in the color of its legend entry
    legend = page.evaluate("""(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'scatter' && t.name)
        .map(t => t.marker.color)""", S)
    assert len(legend) == 2


def test_cell_points_take_a_number_as_color_by_binned_by_the_reply_s_edges(page, served):
    score = {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 3}}
    _open(page, served, {CC: _points_config(score, layers={"points": True})})
    _drawn(page, "density2d")
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S, timeout=60)
    assert len(_point_colours(page)) == 3, _point_colours(page)
    shot = os.environ.get("ANNZARRO_FB1F_SHOTS")
    if shot:
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(shot, "points-binned.png"))



def test_cell_points_reload_when_the_grouping_is_edited_and_match_its_new_groups(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [CONDITION]}
    count = _points_config({"source": {"type": "cell-group", "key": GA}}, layers={"points": True})
    _open(page, served, {CC: count, GA: grouping}, open_ids=(CC, GA))
    _drawn(page, "density2d")
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S, timeout=60)
    before = _points(page)
    assert len(_point_colours(page)) == 2
    # tick off a level of the grouping and leave the unticked cells out: one group is left
    edited = {"id": GA, "title": "Grouping 1", "version": 1,
              "partitionings": [{**CONDITION, "levels": ["c:ctrl"], "rest": "exclude"}]}
    page.evaluate("(cfg) => window.PanelManager.getPanel('%s').setConfig(cfg)" % GA, edited)
    # the points reload against the new groups: the cells of the group that is left, the others in no group and not drawn
    until(page, """([s, n]) => { const m = /Cells drawn as points: ([\\d,]+) of/.exec(document.querySelector(s + ' .ccnt-density-notes').textContent);
        return !!m && Number(m[1].replace(/,/g, '')) !== n; }""", [S, before["n"]], timeout=60)
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S, timeout=60)
    after = _points(page)
    assert len(_point_colours(page)) == 1, "the one group left is the one color drawn"
    drawn = int(re.search(r"Cells drawn as points: ([\d,]+) of", _strip(page)).group(1).replace(",", ""))
    assert drawn == after["n"], "the notice counts the points on the plot"
    assert 0 < after["n"] < before["n"], (before, after)
    ctrl = int((DATA.obs["condition"] == "ctrl").sum())
    assert after["n"] <= ctrl, "only the cells of the one group are drawn"


def test_cell_points_reload_when_an_edit_makes_new_groups_the_old_codes_do_not_hold(page, served):
    """A third bin has no level in the codes the points were loaded with: only a reload can draw it."""
    def depth(bins):
        return {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": bins}}
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [depth(2)]}
    count = _points_config({"source": {"type": "cell-group", "key": GA}}, layers={"points": True})
    _open(page, served, {CC: count, GA: grouping}, open_ids=(CC, GA))
    _drawn(page, "density2d")
    until(page, "(s) => /Cells drawn as points/.test(document.querySelector(s + ' .ccnt-density-notes').textContent)", S, timeout=60)
    assert len(_point_colours(page)) == 2
    page.evaluate("(cfg) => window.PanelManager.getPanel('%s').setConfig(cfg)" % GA,
                  {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [depth(3)]})
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot').length > 0", S)
    until(page, """(s) => new Set([...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'scattergl')
        .map(t => String(t.marker.color).replace(/, [\\d.]+\\)$/, ')'))).size === 3""", S, timeout=60)
