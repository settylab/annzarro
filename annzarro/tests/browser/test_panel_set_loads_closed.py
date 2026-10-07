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
5. "Load and open layout" in the dialog opens the set's panels at once;
6. "Add to closed panels" (the Load dialog card, the prompt a load raises
   while panels exist, the welcome list) keeps the open view and only adds
   the set's panels to the closed list: clashing ids renamed, a plot's
   tableFilter kept on the set's own table, a set from another dataset
   added and marked, without switching.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import json
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
DATA = {}      # the server's data directory, for panel sets written by hand


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
    # the same cells under another name: "another dataset" for add-to-closed
    shutil.copytree(FIXTURE, data_dir / "other_small.zarr")
    DATA["dir"] = data_dir
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
      return c ? {row: el.style.getPropertyValue('--panel-height'), content: walk(c)} : null;
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
        # panels exist, so the load asks first: Replace
        page.locator(".notification-ask", has_text="Load panel set?").locator("button[data-action='replace']").click()
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


ALL_IDS = "() => PanelManager.getAllPanels().map(p => p.getId())"
TAGS = """() => Object.fromEntries([...document.querySelectorAll(
    '.tile-container > .tile-selector .source-panel-option.closed-panel')]
    .map(e => [e.dataset.id, (e.querySelector('.panel-origin-tag:not([hidden])') || {}).textContent || null]))"""
RAW_CONFIG = """id => { const { _closed, ...c } = PanelManager.saveLayout().panelConfigs[id];
    return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined)); }"""


def _filtered_set(page, server, name):
    """A cell plot filtered by a cell table beside it, saved as `name`; returns (plot, table)."""
    page.goto(server)
    page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
    plot, table = _build(page)
    page.select_option(f".tile[data-tile-id='{plot}'] select.table-filter-select", table)
    page.wait_for_timeout(800)
    assert page.evaluate(RAW_CONFIG, plot)["tableFilter"] == table
    _save_set(page, name)
    return plot, table


def _added(page, before):
    """The panels added since `before` (a list of ids), as {old title: id}."""
    return [i for i in page.evaluate(ALL_IDS) if i not in before]


def _assert_added_copy(page, view_before, ids_before, plot, table, saved, set_name):
    """The open view is untouched; two closed copies of plot and table were added."""
    page.wait_for_function("n => PanelManager.getAllPanels().length === n", arg=len(ids_before) + 2, timeout=30000)
    page.wait_for_timeout(500)
    assert page.evaluate(TREE_JS) == view_before
    assert sorted(_tile_ids(page)) == sorted([plot, table])
    all_ids = page.evaluate(ALL_IDS)
    assert len(set(all_ids)) == len(all_ids)
    new = _added(page, ids_before)
    new_plot = next(i for i in new if i.startswith("cell-plot-"))
    new_table = next(i for i in new if i.startswith("cell-table-"))
    # the ids clashed with the open panels: both renamed
    assert new_plot != plot and new_table != table
    # configs intact apart from the id, and the filter follows the set's own table
    got_plot, got_table = page.evaluate(RAW_CONFIG, new_plot), page.evaluate(RAW_CONFIG, new_table)
    assert got_plot["tableFilter"] == new_table
    # the titles clash with the open panels': the set's name follows
    assert got_plot["title"] == f"{saved[0]['title']} ({set_name})"
    assert got_table["title"] == f"{saved[1]['title']} ({set_name})"
    assert {**got_plot, "id": plot, "tableFilter": table, "title": saved[0]["title"]} == saved[0]
    assert {**got_table, "id": table, "title": saved[1]["title"]} == saved[1]
    return new_plot, new_table


def test_add_to_closed_from_the_dialog_keeps_the_open_view(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        plot, table = _filtered_set(page, server, "add-me")
        saved = [page.evaluate(RAW_CONFIG, plot), page.evaluate(RAW_CONFIG, table)]
        view_before, ids_before = page.evaluate(TREE_JS), page.evaluate(ALL_IDS)
        focus_before = page.input_value("#focused-cell")

        page.click("#btn-load-session")
        page.locator(".session-card[data-session-name='add-me'] .session-add-closed").click()
        new_plot, new_table = _assert_added_copy(page, view_before, ids_before, plot, table, saved, "add-me")
        tags = page.evaluate(TAGS)
        assert tags[new_plot] == "from add-me" and tags[new_table] == "from add-me"
        # the full name on hover, as the tag may be cut
        assert page.locator(f".source-panel-option[data-id='{new_plot}'] .panel-origin-tag").get_attribute("title") \
            == 'Added from the panel set "add-me"'
        assert page.input_value("#focused-cell") == focus_before
        assert page.locator(".notification", has_text="2 panels added to the closed panels").count() == 1
        # nothing was replaced: no saved layout to offer
        assert page.locator(".open-saved-layout-btn, .notification[data-offer]").count() == 0
        assert not errors, errors
    finally:
        ctx.close()


def test_load_with_panels_open_asks_replace_add_or_cancel(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        plot, table = _filtered_set(page, server, "ask-me")
        saved = [page.evaluate(RAW_CONFIG, plot), page.evaluate(RAW_CONFIG, table)]
        view_before, ids_before = page.evaluate(TREE_JS), page.evaluate(ALL_IDS)

        def ask():
            page.wait_for_selector(".modal-backdrop", state="detached")
            page.click("#btn-load-session")
            page.locator(".session-card[data-session-name='ask-me']").click()
            page.click("#btn-confirm-session")
            prompt = page.locator(".notification-ask", has_text="Load panel set?")
            prompt.wait_for(timeout=30000)
            return prompt

        prompt = ask()
        assert [b.strip() for b in prompt.locator(".notification-actions button").all_inner_texts()] == \
            ["Replace", "Add to closed panels", "Cancel"]
        prompt.locator("button[data-action='cancel']").click()
        page.wait_for_timeout(800)
        assert page.evaluate(TREE_JS) == view_before and page.evaluate(ALL_IDS) == ids_before

        ask().locator("button[data-action='add']").click()
        _assert_added_copy(page, view_before, ids_before, plot, table, saved, "ask-me")
    finally:
        ctx.close()


def test_add_to_closed_from_the_welcome_list_and_another_dataset(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        plot, table = _filtered_set(page, server, "elsewhere")
        other = fresh.new_page()
        errors = []
        other.on("pageerror", lambda e: errors.append(str(e)))
        other.goto(server.replace("fixture_small.zarr", "other_small.zarr"))
        other.locator(".session-item", has_text="elsewhere").locator(".session-item-add").click()
        other.wait_for_function("ids => ids.every(id => !!PanelManager.getPanel(id))", arg=[plot, table],
                                timeout=30000)
        other.wait_for_timeout(500)
        assert _tile_ids(other) == []
        # not switched: still the dataset that was open
        assert other.evaluate("() => document.getElementById('dataset-selector').value").endswith("other_small.zarr")
        tags = other.evaluate(TAGS)
        assert tags[plot] == tags[table] == "other dataset · from elsewhere"
        assert other.evaluate(RAW_CONFIG, plot)["tableFilter"] == table
        assert not errors, errors
    finally:
        ctx.close()
        fresh.close()


# Sets saved with all, some or none of their panels open, and a legacy one:
# the closed list holds all five, "Open saved layout (N)" counts and opens
# only the panels that were open at save, in their layout.
FIVE = ["cell-plot-P1", "cell-plot-P2", "cell-plot-P3", "cell-table-T1", "cell-table-T2"]


def _config(pid):
    umap = lambda c: {"type": "obsm", "key": "X_umap", "column": str(c)}
    if pid.startswith("cell-plot"):
        return {"id": pid, "title": f"Plot {pid[-2:]}", "x": umap(0), "y": umap(1), "color": {"type": "none"}}
    return {"id": pid, "title": f"Table {pid[-2:]}"}


def _stack(ids):
    tile = lambda i: {"type": "tile", "id": i, "controlsVisible": True}
    if len(ids) == 1:
        return tile(ids[0])
    if len(ids) == 2:
        return {"type": "split", "direction": "horizontal",
                "panes": [{"percentage": 50}, {"percentage": 50}], "children": [tile(ids[0]), tile(ids[1])]}
    return {"type": "split", "direction": "vertical", "panes": [{"percentage": 50}, {"percentage": 50}],
            "children": [_stack(ids[:2]), _stack(ids[2:])]}


def _write_set(name, open_ids, legacy=False):
    store = str(DATA["dir"] / "fixture_small.zarr")
    if legacy:
        doc = {"name": name, "dataset": store, "panelConfigs": {
            i: {"id": i, "type": i.rsplit("-", 1)[0], "title": _config(i)["title"],
                "config": {**_config(i), "active": i in open_ids}} for i in FIVE}}
    else:
        layout = {"v": 1, "hierarchy": [_stack(open_ids)] if open_ids else [],
                  "controlState": {}, "panelConfigs": {i: _config(i) for i in FIVE}}
        doc = {"name": name, "dataset": store, "view": {"v": 1, "layout": layout}}
    sessions = DATA["dir"] / "sessions"
    sessions.mkdir(exist_ok=True)
    (sessions / f"{name}.json").write_text(json.dumps(doc))


@pytest.mark.parametrize("case,open_ids,legacy", [
    ("all-open", FIVE, False),
    ("some-open", ["cell-plot-P1", "cell-table-T1"], False),
    ("none-open", [], False),
    ("legacy-mixed", ["cell-plot-P1", "cell-plot-P2", "cell-table-T2"], True),
])
def test_closed_load_offers_only_the_panels_open_at_save(server, browser, case, open_ids, legacy):
    name = f"count-{case}"
    _write_set(name, open_ids, legacy)
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server)
        page.locator(".session-item", has_text=name).first.click()
        notice = page.locator(".notification", has_text=f'Loaded "{name}"')
        notice.wait_for(timeout=30000)
        page.wait_for_timeout(500)
        assert _tile_ids(page) == []
        assert sorted(page.evaluate(CLOSED_ALL)) == sorted(FIVE)
        text = notice.inner_text()
        assert "5 panels listed closed" in text
        k = len(open_ids)
        offer = page.locator(".notification[data-offer='saved-layout'] button[data-action='open']")
        listed = page.locator(".tile-container > .tile-selector .open-saved-layout-btn")
        if k == 0:
            assert "none was open" in text
            assert offer.count() == 0 and listed.count() == 0
            return
        assert ("all 5 were open" if k == 5 else f"{k} were open") in text
        assert offer.inner_text().strip() == f"Open saved layout ({k} panels)"
        assert listed.inner_text().strip() == f"Open saved layout ({k})"
        listed.click()
        page.wait_for_function("n => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === n",
                               arg=k, timeout=30000)
        page.wait_for_timeout(1000)
        assert sorted(_tile_ids(page)) == sorted(open_ids)
        # in their layout: the open ones' tree as saved
        tree = page.evaluate(TREE_JS)
        assert len(tree) == 1 and tree[0]["content"] == _shape(_stack(open_ids))
        assert sorted(page.evaluate(CLOSED_ALL)) == sorted(set(FIVE) - set(open_ids))
        assert not errors, errors
    finally:
        ctx.close()


def _shape(node):
    """A hierarchy node in TREE_JS's shape (sizes rounded, tiles as ids)."""
    if node["type"] == "tile":
        return node["id"]
    return {"split": node["direction"], "sizes": [round(p["percentage"]) for p in node["panes"]],
            "panes": [_shape(c) for c in node["children"]]}


def test_load_and_open_layout_of_a_set_saved_with_none_open(server, browser):
    _write_set("count-none-dialog", [])
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        page.goto(server)
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        page.click("#btn-load-session")
        page.locator(".session-card[data-session-name='count-none-dialog'] .session-load-open").click()
        notice = page.locator(".notification", has_text='Loaded "count-none-dialog"')
        notice.wait_for(timeout=30000)
        assert "No panel was open when the set was saved, so none opened" in notice.inner_text()
        assert _tile_ids(page) == []
        assert sorted(page.evaluate(CLOSED_ALL)) == sorted(FIVE)
        assert page.locator(".open-saved-layout-btn, .notification[data-offer]").count() == 0
    finally:
        ctx.close()


def test_one_question_when_the_set_is_on_another_dataset(server, browser):
    """Panels open and the set saved elsewhere: one notice asks both, never two in a row."""
    _write_set("count-elsewhere", ["cell-plot-P1"])
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        page.goto(server.replace("fixture_small.zarr", "other_small.zarr"))
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        _choose(page, ".tile-selector", "cell-plot")
        page.click("#btn-load-session")
        page.locator(".session-card[data-session-name='count-elsewhere']").click()
        page.click("#btn-confirm-session")
        ask = page.locator(".notification-ask", has_text="Switch dataset?")
        ask.wait_for(timeout=30000)
        assert page.locator(".notification-ask").count() == 1
        assert [b.strip() for b in ask.locator(".notification-actions button").all_inner_texts()] == \
            ["Switch and load", "Add to closed panels", "Keep current"]
        ask.locator("button[data-action='replace']").click()
        page.locator(".notification", has_text='Loaded "count-elsewhere"').wait_for(timeout=30000)
        # no second question came
        assert page.locator(".notification-ask:not([data-offer])").count() == 0
        assert page.evaluate("() => document.getElementById('dataset-selector').value").endswith("fixture_small.zarr")
    finally:
        ctx.close()
