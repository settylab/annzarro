"""The page keeps to the cost limits the server serves (limits: in its config file), in a real browser.

A server started with `limits: {matrix_values: 30, bars_3d_max: 10}`:

1.  GET /api/v1/policy/effective serves the lowered values.
2.  The Cell-Gene matrix gate refuses at 30 cells of the matrix, before any gene is asked for (6 groups x 6 genes),
    and draws 6 groups x 4 genes (24) as usual.
3.  The 3D gate refuses past 10 bars, with the served number in its reason: no `window.__azBars3dMax` is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_gene_panel as panel  # noqa: E402
from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the page fixture)
    GENES, P, S1, TP, _drawn, _features, _open, _plot, _settle, _sig, page)
from annzarro.tests.browser.test_cell_gene_states import _says, _wait_state  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}                         # 6 groups
LIMITS = "limits:\n  matrix_values: 30\n  bars_3d_max: 10\n"


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = panel._make_store
    try:
        proc, root, store = _focus._serve(tmp_path_factory, config=LIMITS)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def _configs(genes):
    return {P: _plot(cellAxis=OBS, sections=[{"source": S1}]), S1: _sig(S1, "Markers", GENES[:genes])}


def test_the_server_serves_the_lowered_limits(served):
    root, _ = served
    with urllib.request.urlopen(root + "/api/v1/policy/effective", timeout=10) as resp:
        values = json.load(resp)["values"]
    assert (values["limits.matrix_values"], values["limits.bars_3d_max"], values["limits.groups"]) == (30, 10, 2000)


def test_the_matrix_gate_refuses_at_the_served_number_before_any_gene_is_asked(page, served):
    _open(page, served, _configs(4), open_ids=(P, S1))
    st = _drawn(page)
    assert (st["groups"], st["rows"]) == (6, 4)                    # 24 cells: under 30
    page.goto("about:blank")
    page.calls.clear()
    _open(page, served, _configs(6), open_ids=(P, S1))             # 36 cells: over 30
    _wait_state(page, "toolarge")
    _says(page, "6 groups × 6 rows = 36 cells of the matrix; the limit is 30.")
    _settle(page, "above the served limit no gene is asked for; a request that never goes out cannot be waited on")
    assert _features(page.calls) == [], "no gene was asked for above the limit"


def test_the_3d_gate_refuses_past_the_served_bar_cap(page, served):
    _open(page, served, _configs(4), open_ids=(P, S1))
    assert page.evaluate("() => window.__azBars3dMax") is None, "no test override: the cap is the server's"
    st = _drawn(page)
    bars = st["groups"] * st["rows"]
    assert bars == 24
    until(page, "(s) => document.querySelector(s + ' .cgene-3d-btn').disabled", TP)
    title = page.get_attribute(f"{TP} .cgene-3d-btn", "title")
    assert title == "3D draws at most 10 bars; this plot has 24. Use fewer genes or groups.", title
