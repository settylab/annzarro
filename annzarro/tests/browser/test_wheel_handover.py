"""The wheel scrolls the page over a panel that fits, and hands over at a scroller's end.

The page (#tile-container) scrolls; a table body, or a panel taller than its
tile, scrolls inside it. A browser latches one scroll gesture (a trackpad swipe
and its momentum) to the scroller it started in, and drops the rest once that
scroller reaches its end. utils/wheel-handover.js scrolls the next scroller out
by the rest, in the same gesture.

Each case starts with everything at the top and sends ONE scroll gesture
(Chrome's Input.synthesizeScrollGesture, latched like a trackpad swipe) of
600 px down at a point, or a run of mouse-wheel notches, and reads where every
scroller ended up:

- a short table (10 rows, fits its 350 px body): the page takes the gesture;
- a long table (25 rows): the table scrolls to its end, the page takes the rest,
  so the two add up to the gesture (the page used to stay at 0);
- the plot controls of a panel that fits: the page takes the gesture;
- a narrow layout where the plot panel is taller than its tile: the panel
  scrolls to its end, then the page.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
PLOT = ".tile[data-tile-id='cell-plot-B']"
TABLE = ".tile[data-tile-id='cell-table-A']"
GESTURE = 600


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "c.yaml"
    cfg.write_text("ui: {}\n")
    port = _free_port()
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(cfg), "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as pw:
        b = pw.chromium.launch()
        yield b
        b.close()


def _link(root, page_length):
    """A Cell Plot (controls open) beside a cell table of `page_length` rows."""
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {"cell-plot-B": {"id": "cell-plot-B", "x": x, "y": y, "z": None,
                            "color": {"type": "obs", "key": "total_counts", "column": ""}},
            "cell-table-A": {"id": "cell-table-A", "title": "T", "pageLength": page_length,
                             "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}}
    tiles = [{"type": "tile", "id": "cell-plot-B", "controlsVisible": True},
             {"type": "tile", "id": "cell-table-A", "controlsVisible": False}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                                      "panes": [{"percentage": 50}, {"percentage": 50}],
                                                      "children": tiles}],
                               "controlState": {"cell-plot-B": True, "cell-table-A": False}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


POSITIONS = """() => {
  const top = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.scrollTop) : null; };
  return {page: top('#tile-container'), table: top("%s .dataTables_scrollBody"),
          plotTile: top("%s .tile-content"), tableTile: top("%s .tile-content")};
}""" % (TABLE, PLOT, TABLE)
MAXES = """() => {
  const m = (sel) => { const e = document.querySelector(sel); return e ? e.scrollHeight - e.clientHeight : null; };
  return {page: m('#tile-container'), table: m("%s .dataTables_scrollBody"), plotTile: m("%s .tile-content")};
}""" % (TABLE, PLOT)
RESET = """() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; }"""


def _open(browser, root, page_length, width):
    page = browser.new_page(viewport={"width": width, "height": 900})
    page.goto(_link(root, page_length))
    page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
    page.wait_for_selector(f"#plot-container-cell-plot-B .main-svg", timeout=30000)
    page.wait_for_timeout(800)
    return page


def _at(page, selector, dy=40):
    box = page.locator(selector).first.bounding_box()
    return box["x"] + box["width"] / 2, min(box["y"] + dy, 860)


def _gesture(page, selector, distance=GESTURE):
    """From the top, one latched scroll gesture down by `distance` px at `selector`; the scroll positions."""
    page.evaluate(RESET)
    page.wait_for_timeout(150)
    x, y = _at(page, selector)
    cdp = page.context.new_cdp_session(page)
    cdp.send("Input.synthesizeScrollGesture", {"x": x, "y": y, "yDistance": -distance,
                                                 "gestureSourceType": "mouse", "speed": 1200, "preventFling": True})
    page.wait_for_timeout(400)
    cdp.detach()
    return page.evaluate(POSITIONS)


def test_short_table_page_takes_the_wheel(server, browser):
    page = _open(browser, server, 10, 1400)
    try:
        assert page.evaluate(MAXES)["table"] <= 1          # ten rows fit the 350 px body
        pos = _gesture(page, f"{TABLE} .dataTables_scrollBody")
        assert pos["page"] >= GESTURE - 30, pos
    finally:
        page.close()


def test_long_table_scrolls_then_hands_over(server, browser):
    page = _open(browser, server, 25, 1400)
    try:
        maxes = page.evaluate(MAXES)
        assert maxes["table"] > 300 and maxes["page"] > 300, maxes
        pos = _gesture(page, f"{TABLE} .dataTables_scrollBody")
        assert pos["table"] == maxes["table"], pos          # the table first, to its end
        assert pos["page"] > 50, pos                        # then the page, in the same gesture
        assert abs(pos["table"] + pos["page"] - GESTURE) <= 40, pos   # nothing lost, nothing doubled
        # a shorter gesture stays in the table
        pos = _gesture(page, f"{TABLE} .dataTables_scrollBody", distance=200)
        assert pos["page"] == 0 and 150 <= pos["table"] <= 240, pos
        # mouse-wheel notches hand over too
        page.evaluate(RESET)
        page.wait_for_timeout(150)
        page.mouse.move(*_at(page, f"{TABLE} .dataTables_scrollBody"))
        for _ in range(8):
            page.mouse.wheel(0, 100)
            page.wait_for_timeout(60)
        page.wait_for_timeout(500)
        pos = page.evaluate(POSITIONS)
        assert pos["table"] == maxes["table"] and pos["page"] > 50, pos
    finally:
        page.close()


def test_fitting_controls_page_takes_the_wheel(server, browser):
    page = _open(browser, server, 25, 1400)
    try:
        assert page.evaluate(MAXES)["plotTile"] <= 1        # the plot panel fits its tile
        pos = _gesture(page, f"{PLOT} .plot-controls")
        assert pos["page"] >= GESTURE - 30, pos
    finally:
        page.close()


def test_narrow_panel_scrolls_then_hands_over(server, browser):
    page = _open(browser, server, 25, 700)
    try:
        maxes = page.evaluate(MAXES)
        assert maxes["plotTile"] > 100, maxes               # controls + plot taller than the tile
        pos = _gesture(page, f"{PLOT} .plot-controls")
        assert pos["plotTile"] == maxes["plotTile"] and pos["page"] > 50, pos
        assert abs(pos["plotTile"] + pos["page"] - GESTURE) <= 40, pos
    finally:
        page.close()


ROW_SUM = """() => {
  const body = document.querySelector("%s .dataTables_scrollBody");
  const row = body && body.closest('.row');
  const page = document.querySelector('#tile-container');
  const room = (e) => e ? e.scrollHeight - e.clientHeight : null;
  return {body: body.scrollTop, row: row ? row.scrollTop : null, page: page.scrollTop,
          roomBody: room(body), roomRow: room(row), roomPage: room(page)};
}""" % TABLE


def test_nested_row_scroller_loses_no_ticks(server, browser):
    """Narrow table panel: table body, then the DataTables .row wrapper, then the page.

    A tick that exceeds the nearest scroller's room must pass the rest outward, and
    ticks during a glide must not keep feeding a scroller that is already going to
    its end. The chain's total travel equals the sum of the deltas.
    """
    page = _open(browser, server, 25, 700)
    try:
        page.evaluate(RESET)
        page.wait_for_timeout(150)
        before = page.evaluate(ROW_SUM)
        assert before["roomRow"] and before["roomRow"] > 50, before     # the nested .row scroller exists
        ticks, delta = 12, 100
        room = before["roomBody"] + before["roomRow"] + before["roomPage"]
        assert room >= ticks * delta + 100, before                      # room for every tick
        page.mouse.move(*_at(page, f"{TABLE} .dataTables_scrollBody"))
        for _ in range(ticks):
            page.mouse.wheel(0, delta)
            page.wait_for_timeout(30)
        page.wait_for_timeout(900)
        after = page.evaluate(ROW_SUM)
        moved = after["body"] + after["row"] + after["page"]
        assert abs(moved - ticks * delta) <= 50, (moved, after)
    finally:
        page.close()
