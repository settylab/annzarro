"""Loading a panel set lists its panels closed; its layout is one click away.

Reported by an operator: choosing a panel set reopened every panel it held
(and a legacy set every panel not marked inactive), which on a large set can
overload the machine. A set the user loads now restores its dataset, subset
and focus and lists each of its panels closed, with its settings, under
"Duplicate or Reopen Panel"; the user reopens the ones wanted, or all of them
at once with the notice's "Open saved layout", which applies the set's view
exactly as a share link would. A share link (#view=) still opens its panels,
and so do the autosave restore and the Load dialog's "Load and open layout".

One headless Chromium session builds two panels (a renamed cell plot and a
cell table beside it), saves them as a panel set, then loads the set:

1. from the Load Panel Set dialog while the panels are open (the set
   replaces them): no tile is open, both panels are listed closed with the
   configs they were saved with, and one reopens with its title;
2. from the welcome screen's list in a fresh context: the same;
3. the share link of the same view, in a fresh context: both panels open;
4. "Open saved layout" after a closed load gives the same tiles, sizes and
   settings as that share link, and no closed duplicate is left;
5. "Load and open layout" in the dialog opens the set's panels at once.

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
SET_NAME = "two-panels"


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
    url = f"{root}/?dataset_path={urllib.parse.quote(str(data_dir / 'fixture_small.zarr'), safe='/')}"
    yield url
    proc.terminate()
    proc.wait(10)


OPEN_TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
CLOSED_LISTED = """() => [...document.querySelectorAll(
    '.tile-container > .tile-selector .source-panel-option.closed-panel')]
    .filter(e => e.offsetParent !== null).map(e => e.dataset.id)"""
# Each panel's saved config. `_closed` only marks how a closed panel was
# registered (selection-tile.js clears it on reopen), not a setting; a key set
# to null is no setting either (an open plot reports showBackdrop: null once
# drawn, a closed one leaves it out).
CONFIGS = """ids => { const all = PanelManager.saveLayout().panelConfigs;
    return ids.map(id => { if (!all[id]) return null; const { _closed, ...c } = all[id];
        return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined)); }); }"""


# The open layout as the user sees it: rows, splits with pane sizes, tiles.
TREE_JS = r"""
() => {
  const kids = (el, cls) => [...el.children].filter(c => cls.some(k => c.classList.contains(k)));
  const walk = (el) => {
    if (el.classList.contains('panel-wrapper')) {
      const c = kids(el, ['split-container', 'tile'])[0];
      return c ? {row: el.style.height, content: walk(c)} : null;
    }
    if (el.classList.contains('tile')) return el.dataset.tileId;
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
CLOSED_ALL = "() => [...document.querySelectorAll('.source-panel-option.closed-panel')].map(e => e.dataset.id)"


def _tile_ids(page):
    return page.evaluate(OPEN_TILES)


def _choose(page, chooser, panel_type):
    before = _tile_ids(page)
    page.locator(f"{chooser} .panel-type-option[data-type='{panel_type}']").first.click()
    page.wait_for_function("n => document.querySelectorAll('.tile-container .tile[data-tile-id]').length > n",
                           arg=len(before))
    new = [t for t in _tile_ids(page) if t not in before][0]
    drawn = ".js-plotly-plot" if panel_type.endswith("plot") else "table"
    page.wait_for_selector(f".tile[data-tile-id='{new}'] {drawn}", timeout=30000)
    return new


def _build(page):
    """A renamed cell plot and a cell table split beside it; returns their ids."""
    plot = _choose(page, ".tile-selector", "cell-plot")
    title = page.locator(f".tile[data-tile-id='{plot}'] .tile-title")
    title.fill("Renamed plot")
    title.press("Enter")
    page.locator(f".tile[data-tile-id='{plot}'] .tile-split-h").first.click()
    table = _choose(page, ".split-pane > .tile-selector:not([data-is-bottom-selector='true'])", "cell-table")
    page.wait_for_timeout(500)
    return [plot, table]


def _save_set(page, name):
    page.click("#btn-save-session")
    page.fill("#session-name", name)
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")


def _share_link(page):
    page.click("#btn-share-link")
    page.wait_for_timeout(500)
    try:
        return page.evaluate("() => navigator.clipboard.readText()")
    except playwright.Error:
        return page.input_value("#share-link-field")


def _wait_open(page, ids):
    for i in ids:
        drawn = ".js-plotly-plot" if "plot" in i else "table"
        page.wait_for_selector(f".tile[data-tile-id='{i}'] {drawn}", timeout=30000)
    page.wait_for_timeout(800)


def _assert_closed(page, ids, saved):
    # the offer is the last step of a load: before it, the panels replaced
    # (same ids, in the replace case) may still be there
    page.locator(".notification[data-offer='saved-layout']").wait_for(timeout=30000)
    page.wait_for_timeout(500)
    assert _tile_ids(page) == []
    assert sorted(page.evaluate(CLOSED_LISTED)) == sorted(ids)
    assert page.evaluate(CONFIGS, ids) == saved


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def test_loaded_panel_set_lists_its_panels_closed(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server)
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        ids = _build(page)
        saved = page.evaluate(CONFIGS, ids)
        assert saved[0]["title"] == "Renamed plot"

        page.click("#btn-save-session")
        page.fill("#session-name", SET_NAME)
        page.click("#btn-confirm-session")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")

        # 1. the dialog's list, over the open panels: they are replaced, and
        #    nothing of the set opens
        page.wait_for_selector(".modal-backdrop", state="detached")
        page.click("#btn-load-session")
        page.locator(f".session-card[data-session-name='{SET_NAME}']").click()
        page.click("#btn-confirm-session")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
        _assert_closed(page, ids, saved)

        # a closed panel reopens with its settings
        page.locator(f".tile-container > .tile-selector .panel-closed-btn[data-id='{ids[0]}']").click()
        page.wait_for_selector(f".tile[data-tile-id='{ids[0]}'] .js-plotly-plot", timeout=30000)
        assert page.input_value(f".tile[data-tile-id='{ids[0]}'] .tile-title") == "Renamed plot"

        # 2. the welcome screen's list, in a browser with nothing open
        other = fresh.new_page()
        other.on("pageerror", lambda e: errors.append(str(e)))
        other.goto(server)
        other.locator(".session-item", has_text=SET_NAME).first.click()
        _assert_closed(other, ids, saved)
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()


def test_share_link_still_opens_its_panels(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        page.goto(server)
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        ids = _build(page)
        saved = page.evaluate(CONFIGS, ids)
        page.click("#btn-share-link")
        page.wait_for_timeout(500)
        try:
            link = page.evaluate("() => navigator.clipboard.readText()")
        except playwright.Error:
            link = page.input_value("#share-link-field")
        assert "#view=" in link

        opened = fresh.new_page()
        errors = []
        opened.on("pageerror", lambda e: errors.append(str(e)))
        opened.goto(link)
        opened.wait_for_selector(f".tile[data-tile-id='{ids[0]}'] .js-plotly-plot", timeout=30000)
        opened.wait_for_selector(f".tile[data-tile-id='{ids[1]}'] table", timeout=30000)
        assert sorted(_tile_ids(opened)) == sorted(ids)
        assert opened.evaluate(CONFIGS, ids) == saved
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()


def _build_and_share(page, server, name):
    page.goto(server)
    page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
    ids = _build(page)
    # a non-default pane size, so the comparison sees the layout, not defaults
    handle = page.locator(".split-container > .split-handle").first.bounding_box()
    page.mouse.move(handle["x"] + 2, handle["y"] + handle["height"] / 2)
    page.mouse.down()
    page.mouse.move(handle["x"] + 140, handle["y"] + handle["height"] / 2, steps=5)
    page.mouse.up()
    page.wait_for_timeout(300)
    _save_set(page, name)
    return ids, _share_link(page)


def test_open_saved_layout_matches_the_share_link(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    by_link = browser.new_context(viewport={"width": 1400, "height": 1000})
    by_set = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        ids, link = _build_and_share(page, server, "layout-offer")

        linked = by_link.new_page()
        linked.goto(link)
        _wait_open(linked, ids)
        want_tree, want_configs = linked.evaluate(TREE_JS), linked.evaluate(CONFIGS, ids)
        assert want_tree[0]["content"]["sizes"] != [50, 50], want_tree

        loaded = by_set.new_page()
        errors = []
        loaded.on("pageerror", lambda e: errors.append(str(e)))
        loaded.goto(server)
        loaded.locator(".session-item", has_text="layout-offer").first.click()
        offer = loaded.locator(".notification[data-offer='saved-layout']")
        offer.wait_for(timeout=30000)
        assert _tile_ids(loaded) == []
        button = offer.locator("button[data-action='open']")
        assert button.inner_text().strip() == "Open saved layout (2 panels)"
        button.click()
        _wait_open(loaded, ids)
        assert loaded.evaluate(TREE_JS) == want_tree
        assert loaded.evaluate(CONFIGS, ids) == want_configs
        # the closed entries were reopened in place, not duplicated
        assert loaded.evaluate(CLOSED_ALL) == []
        assert loaded.evaluate("() => PanelManager.getAllPanels().length") == len(ids)
        assert loaded.locator(".notification[data-offer='saved-layout']").count() == 0
        assert not errors, errors
    finally:
        ctx.close()
        by_link.close()
        by_set.close()


def test_load_and_open_layout_from_the_dialog(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        ids, _ = _build_and_share(page, server, "layout-open")
        want_tree, want_configs = page.evaluate(TREE_JS), page.evaluate(CONFIGS, ids)

        other = fresh.new_page()
        errors = []
        other.on("pageerror", lambda e: errors.append(str(e)))
        other.goto(server)
        other.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        other.click("#btn-load-session")
        other.locator(".session-card[data-session-name='layout-open'] .session-load-open").click()
        _wait_open(other, ids)
        assert other.evaluate(TREE_JS) == want_tree
        assert other.evaluate(CONFIGS, ids) == want_configs
        # opened at once: no offer to open it again
        assert other.locator(".notification[data-offer='saved-layout']").count() == 0
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()


def test_open_saved_layout_from_the_list_after_dismissing_the_notice(server, browser):
    """Notices are dismissed by reflex: the offer stays above the closed panels."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    by_link = browser.new_context(viewport={"width": 1400, "height": 1000})
    by_set = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        ids, link = _build_and_share(page, server, "layout-list")
        linked = by_link.new_page()
        linked.goto(link)
        _wait_open(linked, ids)
        want_tree, want_configs = linked.evaluate(TREE_JS), linked.evaluate(CONFIGS, ids)

        loaded = by_set.new_page()
        errors = []
        loaded.on("pageerror", lambda e: errors.append(str(e)))
        loaded.goto(server)
        loaded.locator(".session-item", has_text="layout-list").first.click()
        offer = loaded.locator(".notification[data-offer='saved-layout']")
        offer.wait_for(timeout=30000)
        offer.locator(".notification-close").click()
        offer.wait_for(state="detached", timeout=10000)

        listed = loaded.locator(".tile-container > .tile-selector .open-saved-layout-btn")
        assert listed.inner_text().strip() == "Open saved layout (2)"
        listed.click()
        _wait_open(loaded, ids)
        assert loaded.evaluate(TREE_JS) == want_tree
        assert loaded.evaluate(CONFIGS, ids) == want_configs
        assert loaded.evaluate(CLOSED_ALL) == []
        # used up: gone from every list
        assert loaded.locator(".open-saved-layout-btn").count() == 0
        assert not errors, errors
    finally:
        ctx.close()
        by_link.close()
        by_set.close()
