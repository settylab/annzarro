"""A layout of nested splits survives a share link and a panel set.

Reported: "when I make too many subdivisions, e.g. a horizontal and a
vertical one, the share link does not seem to be able to reproduce the view
in a new browser." Reproduced on 9ea6673: the saved hierarchy of a split
holding another split was ``{"type": "split", "children": []}``. The walk
asked the split for ``.split-pane`` descendants, got four (its own two and
the nested split's two), failed its two-pane check and kept nothing. The
link then opened an empty layout.

Each case builds a layout through the UI as a user would (welcome tile, split
buttons, the pane's chooser, dragging the handles, hiding a panel's
controls), clicks Share Link and opens the link in a fresh browser context,
so no autosave can help. The tile tree, the pane sizes, the panel types and
configs, which controls are shown, and the height of each panel row must
match, and the bottom chooser must come back once, below the rows. After a
restore every plot must be drawn inside its tile and above the chooser, and
every split handle must still resize its own split. One case also saves a
panel set: the stored layout keeps every level; loading the set in a fresh
context (its Load button) brings back the same tree, sizes and settings.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    # panel sets are saved under the data dir: use a copy, not the repo's
    data_dir = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data_dir / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, str(data_dir / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


# The layout as the user sees it: the DOM walked by direct children only
# (never by descendant queries, the bug under test), panel type, pane sizes
# rounded to whole percent, and whether each panel's controls are shown.
TREE_JS = r"""
() => {
  const kids = (el, cls) => [...el.children].filter(c => cls.some(k => c.classList.contains(k)));
  const walk = (el) => {
    if (el.classList.contains('panel-wrapper')) {
      const c = kids(el, ['split-container', 'tile', 'tile-selector'])[0];
      return c ? {row: el.style.getPropertyValue('--panel-height'), content: walk(c)} : null;
    }
    if (el.classList.contains('tile-selector')) {
      const header = el.querySelector('.tile-selection-header');
      return header && header.style.display === 'none' ? 'chooser' : 'welcome';
    }
    if (el.classList.contains('tile')) {
      const pc = el.querySelector('.plot-controls, .table-controls');
      return {id: el.dataset.tileId, controls: pc ? pc.style.display !== 'none' : null};
    }
    if (el.classList.contains('split-container')) {
      const panes = kids(el, ['split-pane']);
      return {split: el.dataset.splitDirection,
              sizes: panes.map(p => Math.round(parseFloat(p.dataset.flexPercentage || '50'))),
              panes: panes.map(p => (p.children[0] ? walk(p.children[0]) : null))};
    }
    return null;
  };
  return [...document.querySelector('.tile-container').children].map(walk).filter(Boolean);
}
"""

# Where things are drawn: every panel row ends above the bottom chooser, and a
# plot's data area lies inside its tile. Restored tiles once sat bare in the
# flex column, shrank with the chooser, and the plot ran under it. A tile too
# small for its controls scrolls its content instead; its plot is below them
# by design, so only tiles whose content fits are checked for that.
GEOMETRY_JS = """() => {
  const box = e => e.getBoundingClientRect();
  const chooser = document.querySelector('.tile-container > .tile-selector');
  const bad = [];
  for (const row of document.querySelectorAll('.tile-container > .panel-wrapper')) {
    if (!chooser || box(row).bottom > box(chooser).top + 1) bad.push('a row overlaps the chooser');
  }
  for (const tile of document.querySelectorAll('.tile-container .tile[data-tile-id]')) {
    const content = tile.querySelector('.tile-content');
    const area = tile.querySelector('.js-plotly-plot .nsewdrag');
    if (!area || content.scrollHeight > content.clientHeight + 1) continue;
    const a = box(area), t = box(tile);
    if (a.height < 50 || a.width < 50) bad.push(`${tile.dataset.tileId} plot area ${a.width}x${a.height}`);
    if (a.top < t.top - 1 || a.bottom > t.bottom + 1 || a.left < t.left - 1 || a.right > t.right + 1)
      bad.push(`${tile.dataset.tileId} plot area outside its tile`);
  }
  return bad;
}"""

SIZES_JS = """() => [...document.querySelectorAll('.split-container')].map(c =>
    [...c.children].filter(p => p.classList.contains('split-pane'))
        .map(p => parseFloat(p.dataset.flexPercentage || '50')))"""


def _open(page, url):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    return errors


def _tile_ids(page):
    return page.evaluate("[...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)")


def _choose(page, chooser, panel_type):
    """Pick a panel type in a chooser; returns the new tile's id."""
    before = _tile_ids(page)
    page.locator(f"{chooser} .panel-type-option[data-type='{panel_type}']").first.click()
    page.wait_for_function("n => document.querySelectorAll('.tile[data-tile-id]').length > n", arg=len(before))
    new = [t for t in _tile_ids(page) if t not in before][0]
    drawn = ".js-plotly-plot" if panel_type.endswith("plot") else "table"
    page.wait_for_selector(f".tile[data-tile-id='{new}'] {drawn}", timeout=30000)
    return new


def _split(page, tile_id, direction, panel_type):
    """Split a tile and fill the new pane from its own chooser."""
    page.locator(f".tile[data-tile-id='{tile_id}'] .tile-split-{direction[0]}").first.click()
    return _choose(page, ".split-pane > .tile-selector:not([data-is-bottom-selector='true'])", panel_type)


def _drag(page, tile_id, dx, dy):
    """Drag the handle of the split that directly holds this tile."""
    handle = page.locator(f".split-pane:has(> .tile[data-tile-id='{tile_id}']) ~ .split-handle, "
                          f".split-handle:has(~ .split-pane > .tile[data-tile-id='{tile_id}'])").first
    box = handle.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=5)
    page.mouse.up()


def _drag_row(page, dy):
    """Drag the first row's height handle (under its .panel-wrapper)."""
    box = page.locator(".tile-container > .split-handle[data-panel-handle='true']").first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + dy, steps=5)
    page.mouse.up()


def _settle(page):
    page.wait_for_function("() => !!window.PanelManager")
    page.wait_for_timeout(1500)


def _share_link(page):
    page.click("#btn-share-link")
    page.wait_for_timeout(500)
    try:
        return page.evaluate("() => navigator.clipboard.readText()")
    except playwright.Error:
        return page.input_value("#share-link-field")


def _configs(page):
    # the open panels only: a closed panel's config may ride along, but a link opens what is shown
    return page.evaluate("""() => { const l = PanelManager.saveLayout(); const open = new Set(
        [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId));
        return Object.fromEntries(Object.entries(l.panelConfigs).filter(([k]) => open.has(k))); }""")


def _build(page, case):
    """Build one layout through the UI; returns nothing, the DOM is the result."""
    a = _choose(page, ".tile-selector", "cell-plot")
    if case == "horizontal-then-vertical-left":
        b = _split(page, a, "horizontal", "cell-table")
        c = _split(page, a, "vertical", "cell-plot")
        _drag(page, b, 150, 0)
        _drag(page, c, 0, 90)
        # and the row's own height handle, under the panel
        _drag_row(page, -200)
        page.locator(f".tile[data-tile-id='{c}'] .tile-toggle-controls").first.click()
    elif case == "vertical-then-horizontal-right":
        b = _split(page, a, "vertical", "cell-table")
        c = _split(page, b, "horizontal", "cell-plot")
        _drag(page, a, 0, -80)
        _drag(page, c, -120, 0)
    elif case == "three-levels":
        b = _split(page, a, "horizontal", "cell-table")
        c = _split(page, b, "vertical", "cell-plot")
        d = _split(page, c, "horizontal", "cell-plot")
        _drag(page, d, -60, 0)
        _drag(page, a, 100, 0)
    elif case == "close-inside-nested":
        b = _split(page, a, "horizontal", "cell-table")
        c = _split(page, b, "vertical", "cell-plot")
        _split(page, c, "horizontal", "cell-plot")
        # let the plots finish drawing: Plotly 2.20 throws from a pending
        # auto-margin redraw when a plot is purged mid-draw (not this bug)
        page.wait_for_timeout(1000)
        page.locator(f".tile[data-tile-id='{c}'] .tile-close").first.click()
    page.wait_for_timeout(300)


CASES = ["horizontal-then-vertical-left", "vertical-then-horizontal-right", "three-levels", "close-inside-nested"]


@pytest.mark.parametrize("case", CASES)
def test_nested_layout_round_trips_through_a_share_link(server, browser, case):
    server, store = server
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = _open(page, f"{server}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        _build(page, case)
        built = page.evaluate(TREE_JS)
        assert "split" in built[0]["content"], built
        if case != "close-inside-nested":
            assert any(s != [50, 50] for s in page.evaluate(SIZES_JS)), "no pane was resized"

        opened = fresh.new_page()
        errors += _open(opened, _share_link(page))
        _settle(opened)
        assert opened.evaluate(TREE_JS) == built
        assert built[-1] == "chooser"
        assert _configs(opened) == _configs(page)
        assert opened.evaluate(GEOMETRY_JS) == []

        # a restored split's handle resizes that split; the outer one used
        # to be left unwired (its "panes" were four), so dragging did nothing
        before = opened.evaluate(SIZES_JS)
        handles = opened.locator(".tile-container .split-container > .split-handle")
        for i in range(handles.count()):
            # rows grow with their content now, so a handle can be below the window
            handles.nth(i).scroll_into_view_if_needed()
            box = handles.nth(i).bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            if box["height"] > 400:   # a tall handle: grab it inside the window
                y = max(box["y"], 0) + 100
            opened.mouse.move(x, y)
            opened.mouse.down()
            opened.mouse.move(x + 40, y + 40, steps=4)
            opened.mouse.up()
        after = opened.evaluate(SIZES_JS)
        assert all(b != a for b, a in zip(before, after)), (before, after)
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()


def test_nested_layout_round_trips_through_a_panel_set(server, browser):
    server, store = server
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        url = f"{server}/?dataset_path={urllib.parse.quote(store, safe='/')}"
        errors = _open(page, url)
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        _build(page, "horizontal-then-vertical-left")
        built = page.evaluate(TREE_JS)
        hierarchy = page.evaluate("() => PanelManager.saveLayout().hierarchy")
        page.click("#btn-save-session")
        page.fill("#session-name", "nested-splits")
        page.click("#btn-confirm-session")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")

        # the dialog closes before the server has written the file
        stored = {}
        for _ in range(40):
            stored = page.evaluate("() => fetch('/api/v1/sessions/load?name=nested-splits').then(r => r.json())")
            if "view" in stored:
                break
            time.sleep(0.25)
        assert stored["view"]["layout"]["hierarchy"] == hierarchy
        assert hierarchy[0]["children"][0]["type"] == "split"  # the nested level

        opened = fresh.new_page()
        errors += _open(opened, url)
        opened.locator(".session-item", has_text="nested-splits").first.locator(".session-load").click()
        opened.wait_for_selector(".tile[data-tile-id]", timeout=30000)
        _settle(opened)
        assert opened.evaluate(TREE_JS) == built
        assert _configs(opened) == _configs(page)
        assert opened.evaluate(GEOMETRY_JS) == []
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()
