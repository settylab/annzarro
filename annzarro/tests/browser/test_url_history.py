"""Back and Forward step through the views the address recorded (a cheap undo).

Two cell plots on the 200-cell fixture. A settled change pushes a history
entry; the changes of one gesture share it; Back and Forward show the view of
the entry in place, rebuilding only the panels whose settings differ; Back
from the first view leaves the app.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import pytest

import os

from annzarro.tests.browser.test_memory_guard import DATA_DIR  # noqa: E402
from annzarro.tests.browser.test_plot_options import (  # noqa: F401
    A, B, _change, _link, _menu, _open, _settings, page, server)

LENGTH = "() => history.length"
SETTLE_MS = 2200        # past the address's quiet delay (600 ms) and the merge window (1200 ms)


def _font(page, pid):
    return _settings(page, pid).get("fontSize")


def _until_font(page, pid, want):
    page.wait_for_function(
        "([id, want]) => { const s = window.PanelManager.saveLayout().panelConfigs[id]; return s && s.fontSize === want; }",
        arg=[pid, want], timeout=30000)


def _start(page, server):
    """Both plots drawn, then the opening settled."""
    _open(page, server)
    page.wait_for_timeout(SETTLE_MS)
    return page.evaluate(LENGTH)


def _size(page, pid, value, settle=True):
    """Set the plot's font size through its menu, and let the address settle."""
    _menu(page, pid, "text")
    _change(page, f"#font-size-{pid}", value)
    if settle:
        page.wait_for_timeout(SETTLE_MS)


def test_back_and_forward_step_through_configurations(page, server):
    base = _start(page, server)
    initial = (_font(page, A), _font(page, B))

    _size(page, A, 14)
    assert page.evaluate(LENGTH) == base + 1
    _size(page, B, 16)
    assert page.evaluate(LENGTH) == base + 2
    assert (_font(page, A), _font(page, B)) == (14, 16)

    page.go_back()
    _until_font(page, B, initial[1])
    assert (_font(page, A), _font(page, B)) == (14, initial[1])
    page.go_back()
    _until_font(page, A, initial[0])
    assert (_font(page, A), _font(page, B)) == initial
    page.go_forward()
    _until_font(page, A, 14)
    assert (_font(page, A), _font(page, B)) == (14, initial[1])
    # stepping through the history wrote none of its own
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2


def test_a_gesture_is_one_entry(page, server):
    base = _start(page, server)
    _menu(page, A, "text")
    page.wait_for_timeout(SETTLE_MS)
    base = page.evaluate(LENGTH)
    for value in (11, 12, 13, 14, 15):      # rapid edits: one gesture
        page.fill(f"#font-size-{A}", str(value))
        page.press(f"#font-size-{A}", "Tab")
        page.wait_for_timeout(120)
    page.wait_for_timeout(SETTLE_MS)
    assert _font(page, A) == 15
    assert page.evaluate(LENGTH) == base + 1


def test_a_back_step_leaves_the_other_plots_alone(page, server):
    base = _start(page, server)
    page.evaluate("""(id) => { document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`).__kept = 'mine'; }""", A)
    initial = _font(page, B)
    _size(page, B, 17)
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/api/" in r.url else None)
    page.go_back()
    _until_font(page, B, initial)
    page.wait_for_selector(f".tile[data-tile-id='{B}'] .js-plotly-plot", timeout=30000)
    page.wait_for_timeout(1500)
    # A's graph is the very element it was: not rebuilt, not redrawn
    assert page.evaluate("""(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`).__kept""", A) == "mine"
    # A colours by cell_type; nothing asked for it again (B colours by total_counts)
    assert not [u for u in requests if "cell_type" in u], requests


def test_back_from_the_first_view_leaves_the_app(page, server):
    page.goto("about:blank")
    page.goto(_link(server))
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(SETTLE_MS)
    _size(page, A, 14)
    page.go_back()
    page.wait_for_function("() => window.PanelManager.saveLayout().panelConfigs['%s'].fontSize !== 14" % A)
    page.go_back()
    page.wait_for_url("about:blank")


def test_a_reload_keeps_the_view_and_the_entries(page, server):
    base = _start(page, server)
    _size(page, A, 14)
    page.reload()
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot", timeout=60000)
    _until_font(page, A, 14)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1      # the reload added none
    page.go_back()                                # to the view before: a page load of its own address
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot", timeout=60000)
    page.wait_for_function(
        "([id]) => { const s = window.PanelManager.saveLayout().panelConfigs[id]; return s && s.fontSize !== 14; }", arg=[A])


def test_a_dataset_switch_is_an_entry_and_back_returns_to_it(page, server):
    base = _start(page, server)
    _size(page, A, 14)
    first = page.evaluate("() => location.search")
    other = os.path.join(DATA_DIR, "fixture_small_v3.zarr")
    page.evaluate("(p) => { window.annzarro.openDataset(p); }", other)
    page.wait_for_function("() => location.search.includes('fixture_small_v3')", timeout=60000)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2
    page.go_back()
    page.wait_for_function("(q) => location.search === q", arg=first, timeout=60000)
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot", timeout=60000)
    _until_font(page, A, 14)
    assert page.evaluate("() => window.annzarro.getDataset().path").endswith("fixture_small.zarr")
    page.go_forward()
    page.wait_for_function("() => location.search.includes('fixture_small_v3')", timeout=60000)
