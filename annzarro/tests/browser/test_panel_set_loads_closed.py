"""The Load Panel Set dialog's buttons: one Load, and its ablations as icons.

Each panel-set card (the Load dialog, the welcome list, an uploaded file once
chosen) has ONE highlighted blue "Load": it switches to the set's dataset and
opens the panels that were open when the set was saved, in their layout,
exactly as a share link would. Small icon buttons are its ablations:

    Load on the current dataset   keep the open dataset, open the set's panels
    Add panels closed             keep dataset and open panels, add the set's
                                  panels to the closed list

Nothing asks first (no "Load panel set?", no "Switch dataset?"): the panels a
load replaces stay in the closed list. A card says whether the set's dataset
is on this server ("available here" / "not found here"); when it is not, Load
becomes "Load on the current dataset" (or "Choose dataset..." with none open)
and a database icon loads the set onto any store the user picks. A "?" in the
dialog's header shows what each button does.

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
    DATA["root"] = root
    yield url
    proc.terminate()
    proc.wait(10)


OPEN_TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
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


def _on(server, store):
    """The app's URL with `store` (a name in the data directory) open."""
    return server.replace("fixture_small.zarr", store)


def _guard(page):
    """Collect page errors and fail on any browser dialog (confirm/alert/prompt)."""
    seen = {"errors": [], "dialogs": []}
    page.on("pageerror", lambda e: seen["errors"].append(str(e)))

    def on_dialog(d):
        seen["dialogs"].append(d.message)
        d.dismiss()
    page.on("dialog", on_dialog)
    return seen


def _no_prompts(page, seen=None):
    """No confirmation: no question notice and no browser dialog."""
    asked = page.locator(".notification-ask:not([data-offer])")
    assert asked.count() == 0, asked.all_inner_texts()
    for gone in ("Load panel set?", "Switch dataset?"):
        assert page.locator(".notification", has_text=gone).count() == 0
    if seen is not None:
        assert seen["dialogs"] == [] and seen["errors"] == [], seen


def _open_dialog(page):
    page.wait_for_selector(".modal-backdrop", state="detached")
    page.click("#btn-load-session")
    page.locator("#session-grid .session-card").first.wait_for(timeout=30000)


def _open_dialog_nolist(page):
    """The dialog while no dataset is open (nothing else to wait for)."""
    page.click("#btn-load-session")
    page.locator("#session-grid .session-card").first.wait_for(timeout=30000)


def _card(page, name):
    """A set's card in the dialog, once its dataset has been looked for."""
    card = page.locator(f".session-card[data-session-name='{name}']")
    card.wait_for(timeout=30000)
    card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    return card


def _item(page, name):
    """A set's item in the welcome list, once its dataset has been looked for."""
    item = page.locator(".session-item", has_text=name).first
    item.wait_for(timeout=30000)
    item.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    return item


def _wait_dialog_closed(page):
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null", timeout=60000)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


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


def test_load_opens_the_layout_exactly_as_the_share_link_does(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000},
                              permissions=["clipboard-read", "clipboard-write"])
    by_link = browser.new_context(viewport={"width": 1400, "height": 1000})
    fresh = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        ids, link = _build_and_share(page, server, "layout-open")
        want_tree, want_configs = page.evaluate(TREE_JS), page.evaluate(CONFIGS, ids)
        assert want_tree[0]["content"]["sizes"] != [50, 50], want_tree
        linked = by_link.new_page()
        linked.goto(link)
        _wait_open(linked, ids)
        assert linked.evaluate(TREE_JS) == want_tree

        other = fresh.new_page()
        seen = _guard(other)
        other.goto(server)
        other.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        _open_dialog(other)
        card = _card(other, "layout-open")
        # the one highlighted button
        primary = card.locator(".session-load")
        assert primary.inner_text().strip() == "Load" and "btn-primary" in primary.get_attribute("class")
        primary.click()
        _wait_open(other, ids)
        assert other.evaluate(TREE_JS) == want_tree
        assert other.evaluate(CONFIGS, ids) == want_configs
        _wait_dialog_closed(other)
        # opened at once: no offer to open it again, nothing was asked
        assert other.locator(".notification[data-offer='saved-layout']").count() == 0
        _no_prompts(other, seen)
    finally:
        ctx.close()
        by_link.close()
        fresh.close()


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


def test_loading_over_open_panels_asks_nothing(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        seen = _guard(page)
        plot, table = _filtered_set(page, server, "ask-me")
        saved = [page.evaluate(RAW_CONFIG, plot), page.evaluate(RAW_CONFIG, table)]
        _open_dialog(page)
        _card(page, "ask-me").locator(".session-load").click()
        _wait_dialog_closed(page)
        page.wait_for_timeout(1500)
        # no prompt of any kind; the set's panels are open again, as saved
        _no_prompts(page, seen)
        assert sorted(_tile_ids(page)) == sorted([plot, table])
        _wait_open(page, [plot, table])
        assert [page.evaluate(RAW_CONFIG, plot), page.evaluate(RAW_CONFIG, table)] == saved
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
        _item(other, "elsewhere").locator(".session-add-closed").click()
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
# Load opens only the panels that were open at save, in their layout; the
# others are listed closed.
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


def _set_doc(name, open_ids, legacy=False, dataset=None):
    store = dataset or str(DATA["dir"] / "fixture_small.zarr")
    if legacy:
        return {"name": name, "dataset": store, "panelConfigs": {
            i: {"id": i, "type": i.rsplit("-", 1)[0], "title": _config(i)["title"],
                "config": {**_config(i), "active": i in open_ids}} for i in FIVE}}
    layout = {"v": 1, "hierarchy": [_stack(open_ids)] if open_ids else [],
              "controlState": {}, "panelConfigs": {i: _config(i) for i in FIVE}}
    return {"name": name, "dataset": store, "view": {"v": 1, "layout": layout}}


def _write_set(name, open_ids, legacy=False, dataset=None):
    sessions = DATA["dir"] / "sessions"
    sessions.mkdir(exist_ok=True)
    (sessions / f"{name}.json").write_text(json.dumps(_set_doc(name, open_ids, legacy, dataset)))


GONE = "/nowhere/gone.zarr"      # a store this server does not have
SHOWN = "() => document.getElementById('dataset-selector').value"


def _shape(node):
    """A hierarchy node in TREE_JS's shape (sizes rounded, tiles as ids)."""
    if node["type"] == "tile":
        return node["id"]
    return {"split": node["direction"], "sizes": [round(p["percentage"]) for p in node["panes"]],
            "panes": [_shape(c) for c in node["children"]]}


def _wait_tiles(page, n):
    page.wait_for_function("n => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === n",
                           arg=n, timeout=30000)
    page.wait_for_timeout(1000)


def _wait_dataset(page, store):
    page.wait_for_function("s => (document.getElementById('dataset-selector').value || '').endsWith(s)",
                           arg=store, timeout=30000)


def _page(browser, server, store="fixture_small.zarr"):
    """A page on `store` with its first panel chooser ready, guarded against dialogs."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()
    seen = _guard(page)
    page.goto(_on(server, store))
    page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
    page.wait_for_function("() => window.sessionManager.getCurrentDatasetInfo().hasCurrent", timeout=30000)
    return ctx, page, seen


# ---- the buttons, by what each does to the dataset and to the panels -------

BTN = {"full": ".session-load", "current": ".session-load-current", "add": ".session-add-closed", "choose": ".session-load-choose"}


@pytest.mark.parametrize("where", ["dialog", "welcome"])
def test_a_card_has_one_blue_load_and_four_icons_with_tooltips(server, browser, where):
    _write_set("buttons-card", ["cell-plot-P1", "cell-table-T1"])
    ctx, page, seen = _page(browser, server)
    try:
        if where == "dialog":
            _open_dialog(page)
            card = _card(page, "buttons-card")
            # no confirm button: each card loads by itself
            assert page.locator("#btn-confirm-session").is_hidden()
        else:
            ctx.close()
            ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
            page = ctx.new_page()
            seen = _guard(page)
            page.goto(DATA["root"] + "/")
            card = _item(page, "buttons-card")
        primary = card.locator(".session-load")
        assert primary.inner_text().strip() == "Load"
        assert "btn-primary" in primary.get_attribute("class")
        # exactly one highlighted button
        assert card.locator(".btn-primary").count() == 1
        tips = {m: card.locator(BTN[m]).get_attribute("data-tip") for m in ("current", "add")}
        assert tips["current"].startswith("Load on the current dataset")
        assert card.locator(".session-load-closed").count() == 0     # no "panels closed" button
        assert tips["add"].startswith("Add panels closed")
        # the choose icon only shows when the dataset is missing
        assert card.locator(BTN["choose"]).is_hidden()
        assert card.locator(".session-dataset-badge").inner_text().strip() == "\u2713 available here"
        # a real tooltip appears on hover
        card.locator(BTN["current"]).hover()
        page.locator(".tooltip").wait_for(timeout=5000)
        assert "keep the open dataset" in page.locator(".tooltip").inner_text().lower()
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_load_switches_dataset_and_opens_the_saved_layout(server, browser):
    _write_set("btn-full", ["cell-plot-P1", "cell-table-T1"])
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        # a panel open on the dataset that is open now
        old = _choose(page, ".tile-selector", "cell-plot")
        _open_dialog(page)
        _card(page, "btn-full").locator(BTN["full"]).click()
        _wait_dataset(page, "fixture_small.zarr")
        _wait_tiles(page, 2)
        _wait_dialog_closed(page)
        # the click's tooltip is not left behind on the page
        page.wait_for_timeout(1000)
        assert page.locator(".tooltip").count() == 0
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        # the panel it replaced is in the closed list, not lost
        assert old in page.evaluate(CLOSED_ALL)
        # the other three panels of the set are listed closed
        assert {"cell-plot-P2", "cell-plot-P3", "cell-table-T2"} <= set(page.evaluate(CLOSED_ALL))
        assert page.locator(".open-saved-layout-btn").count() == 0
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_load_on_the_current_dataset_keeps_the_dataset_and_opens_the_panels(server, browser):
    _write_set("btn-current", ["cell-plot-P1", "cell-table-T1"])
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        old = _choose(page, ".tile-selector", "cell-plot")
        _open_dialog(page)
        _card(page, "btn-current").locator(BTN["current"]).click()
        _wait_tiles(page, 2)
        _wait_dialog_closed(page)
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        # not switched
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        assert old in page.evaluate(CLOSED_ALL)
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_add_panels_closed_keeps_dataset_and_open_panels(server, browser):
    _write_set("btn-add", ["cell-plot-P1", "cell-table-T1"])
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        old = _choose(page, ".tile-selector", "cell-plot")
        _open_dialog(page)
        _card(page, "btn-add").locator(BTN["add"]).click()
        page.wait_for_function("n => PanelManager.getAllPanels().length === n", arg=1 + len(FIVE), timeout=30000)
        _wait_dialog_closed(page)
        assert _tile_ids(page) == [old]
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        # added from a set on another dataset: marked, and not switched to
        tags = page.evaluate(TAGS)
        assert [t for i, t in tags.items() if t][0].startswith("other dataset")
        _no_prompts(page, seen)
    finally:
        ctx.close()


def _no_dataset_page(browser):
    """A page with no dataset open: the data directory looks empty while the app starts."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()
    seen = _guard(page)
    hide = lambda route: route.fulfill(status=200, content_type="application/json", body="[]")
    page.route("**/api/v1/datasets*", hide)
    page.goto(DATA["root"] + "/")
    page.wait_for_function("() => !!window.PanelManager", timeout=30000)
    page.wait_for_timeout(1500)
    assert page.evaluate(SHOWN) in (None, "")
    return ctx, page, seen, lambda: page.unroute("**/api/v1/datasets*", hide)


def test_no_dataset_open_disables_load_on_current_and_says_why(server, browser):
    _write_set("btn-nodata", ["cell-plot-P1"])
    ctx, page, seen, listing_back = _no_dataset_page(browser)
    try:
        _open_dialog_nolist(page)
        card = _card(page, "btn-nodata")
        current = card.locator(BTN["current"])
        assert current.get_attribute("aria-disabled") == "true"
        assert "no dataset is open" in current.get_attribute("data-tip")
        current.click(force=True)
        page.wait_for_timeout(500)
        assert _tile_ids(page) == []
        # the other buttons still work: Load switches to the set's dataset
        listing_back()
        card.locator(BTN["full"]).click()
        _wait_dataset(page, "fixture_small.zarr")
        _wait_tiles(page, 1)
        _no_prompts(page, seen)
    finally:
        ctx.close()


# ---- a set whose dataset is not on this server -----------------------------

def test_missing_dataset_badge_and_load_on_the_current_dataset(server, browser):
    _write_set("gone-set", ["cell-plot-P1", "cell-table-T1"], dataset=GONE)
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        _open_dialog(page)
        card = _card(page, "gone-set")
        badge = card.locator(".session-dataset-badge")
        assert badge.inner_text().strip() == "not found here"
        assert "not on this server" in badge.get_attribute("data-tip")
        primary = card.locator(BTN["full"])
        assert primary.inner_text().strip() == "Load on the current dataset"
        assert "btn-primary" in primary.get_attribute("class")
        # the ablation that is the primary is not repeated; closed has nothing to switch to
        assert card.locator(BTN["current"]).is_hidden()
        assert card.locator(BTN["choose"]).is_visible()
        assert card.locator(BTN["choose"]).get_attribute("data-tip").startswith("Choose dataset")
        primary.click()
        _wait_tiles(page, 2)
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        # opened with data: not the placeholder, no "Dataset not found" question
        assert page.locator(".panel-no-data").count() == 0
        assert page.locator(".notification", has_text="Dataset not found").count() == 0
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_missing_dataset_with_none_open_chooses_one_then_loads_onto_it(server, browser):
    _write_set("gone-choose", ["cell-plot-P1", "cell-table-T1"], dataset=GONE)
    ctx, page, seen, listing_back = _no_dataset_page(browser)
    try:
        _open_dialog_nolist(page)
        card = _card(page, "gone-choose")
        primary = card.locator(BTN["full"])
        assert primary.inner_text().strip() == "Choose dataset\u2026"
        assert card.locator(BTN["current"]).get_attribute("aria-disabled") == "true"
        listing_back()
        primary.click()
        # the Change dataset picker of portable views
        page.locator("#change-dataset-modal").wait_for(state="visible", timeout=10000)
        page.locator("#change-dataset-modal .change-dataset-item[data-path$='other_small.zarr'] button").click()
        _wait_dataset(page, "other_small.zarr")
        _wait_tiles(page, 2)
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_choose_dataset_icon_loads_onto_any_store_and_cancel_changes_nothing(server, browser):
    _write_set("gone-icon", ["cell-plot-P1"], dataset=GONE)
    ctx, page, seen = _page(browser, server, "fixture_small.zarr")
    try:
        _open_dialog(page)
        _card(page, "gone-icon").locator(BTN["choose"]).click()
        modal = page.locator("#change-dataset-modal")
        modal.wait_for(state="visible", timeout=10000)
        # closed without a choice: nothing was loaded
        modal.locator(".btn-close").click()
        modal.wait_for(state="hidden", timeout=10000)
        page.wait_for_timeout(500)
        assert _tile_ids(page) == []
        assert page.evaluate(SHOWN).endswith("fixture_small.zarr")

        _open_dialog(page)
        _card(page, "gone-icon").locator(BTN["choose"]).click()
        modal.wait_for(state="visible", timeout=10000)
        modal.locator(".change-dataset-item[data-path$='other_small.zarr'] button").click()
        _wait_dataset(page, "other_small.zarr")
        _wait_tiles(page, 1)
        assert _tile_ids(page) == ["cell-plot-P1"]
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_missing_dataset_in_the_welcome_list_loads_on_the_current_dataset(server, browser):
    _write_set("gone-welcome", ["cell-plot-P1", "cell-table-T1"], dataset=GONE)
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        seen = _guard(page)
        page.goto(_on(server, "other_small.zarr"))
        _wait_dataset(page, "other_small.zarr")
        item = _item(page, "gone-welcome")
        assert item.locator(".session-dataset-badge").inner_text().strip() == "not found here"
        assert item.locator(BTN["full"]).inner_text().strip() == "Load on the current dataset"
        item.locator(BTN["full"]).click()
        _wait_tiles(page, 2)
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        _no_prompts(page, seen)
    finally:
        ctx.close()


# ---- sets saved with all, some or none of their panels open, and a legacy one

@pytest.mark.parametrize("case,open_ids,legacy", [
    ("all-open", FIVE, False),
    ("some-open", ["cell-plot-P1", "cell-table-T1"], False),
    ("none-open", [], False),
    ("legacy-mixed", ["cell-plot-P1", "cell-plot-P2", "cell-table-T2"], True),
])
def test_load_opens_only_the_panels_open_at_save(server, browser, case, open_ids, legacy):
    name = f"count-{case}"
    _write_set(name, open_ids, legacy)
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        _open_dialog(page)
        card = _card(page, name)
        k = len(open_ids)
        primary = card.locator(BTN["full"])
        if k == 0:
            assert primary.inner_text().strip() == "Load (no panels were open)"
        else:
            assert primary.inner_text().strip() == "Load"
            assert f"open {k} panel" in primary.get_attribute("data-tip")
        primary.click()
        notice = page.locator(".notification", has_text=f'Loaded "{name}"')
        if k == 0:
            notice.wait_for(timeout=30000)
            page.wait_for_timeout(500)
            text = notice.inner_text()
            assert "No panel was open when the set was saved, so none opened" in text
            assert "5 panels listed closed" in text
            assert _tile_ids(page) == []
            assert sorted(page.evaluate(CLOSED_ALL)) == sorted(FIVE)
            assert page.locator(".open-saved-layout-btn, .notification[data-offer]").count() == 0
            return
        _wait_tiles(page, k)
        assert sorted(_tile_ids(page)) == sorted(open_ids)
        # in their layout: the open ones' tree as saved
        tree = page.evaluate(TREE_JS)
        assert len(tree) == 1 and tree[0]["content"] == _shape(_stack(open_ids))
        assert sorted(page.evaluate(CLOSED_ALL)) == sorted(set(FIVE) - set(open_ids))
        _no_prompts(page, seen)
    finally:
        ctx.close()



def _choose_file(page, path):
    _open_dialog(page)
    page.click("#toggle-upload-btn")
    page.set_input_files("#session-file-upload", str(path))
    card = page.locator("#upload-card")
    card.wait_for(state="visible", timeout=10000)
    card.locator(".load-actions[data-status='ready'], .text-danger").first.wait_for(timeout=30000)
    return card


def test_an_uploaded_file_gets_the_same_buttons(server, browser, tmp_path):
    path = tmp_path / "from-file.json"
    path.write_text(json.dumps(_set_doc("from-file", ["cell-plot-P1", "cell-table-T1"])))
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        old = _choose(page, ".tile-selector", "cell-plot")
        card = _choose_file(page, path)
        assert card.locator(".session-load").inner_text().strip() == "Load"
        assert card.locator(".btn-primary").count() == 1
        assert card.locator(".session-dataset-badge").inner_text().strip() == "\u2713 available here"
        # the file is imported and loaded with the button used: here, on the current dataset
        card.locator(BTN["current"]).click()
        _wait_tiles(page, 2)
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        assert old in page.evaluate(CLOSED_ALL)
        _wait_dialog_closed(page)
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_an_uploaded_file_load_switches_dataset_and_a_missing_one_falls_back(server, browser, tmp_path):
    here = tmp_path / "here.json"
    here.write_text(json.dumps(_set_doc("up-here", ["cell-plot-P1"])))
    gone = tmp_path / "gone.json"
    gone.write_text(json.dumps(_set_doc("up-gone", ["cell-plot-P1", "cell-table-T1"], dataset=GONE)))
    ctx, page, seen = _page(browser, server, "other_small.zarr")
    try:
        card = _choose_file(page, here)
        card.locator(BTN["full"]).click()
        _wait_dataset(page, "fixture_small.zarr")
        _wait_tiles(page, 1)
        _wait_dialog_closed(page)
        # now a file whose dataset is missing: Load puts it on the open dataset
        card = _choose_file(page, gone)
        assert card.locator(".session-dataset-badge").inner_text().strip() == "not found here"
        assert card.locator(BTN["full"]).inner_text().strip() == "Load on the current dataset"
        card.locator(BTN["full"]).click()
        _wait_tiles(page, 2)
        assert page.evaluate(SHOWN).endswith("fixture_small.zarr")
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_a_file_that_is_not_a_panel_set_says_so(server, browser, tmp_path):
    path = tmp_path / "junk.json"
    path.write_text("{not json")
    ctx, page, seen = _page(browser, server)
    try:
        card = _choose_file(page, path)
        assert "not a panel set" in card.inner_text()
        assert card.locator(".session-load").count() == 0
    finally:
        ctx.close()


# ---- help ----------------------------------------------------------------------

def test_help_popover_shows_the_two_by_two(server, browser):
    _write_set("help-set", ["cell-plot-P1"])
    ctx, page, seen = _page(browser, server)
    try:
        _open_dialog(page)
        help_btn = page.locator("#session-help-btn")
        assert help_btn.is_visible()
        help_btn.hover()
        pop = page.locator(".load-help-popover")
        pop.wait_for(timeout=5000)
        items = pop.locator(".load-help-list li")
        assert items.count() == 3
        assert items.nth(0).locator(".btn-primary").inner_text().strip() == "Load"
        assert items.nth(1).locator("i.fa-thumbtack").count() == 1
        assert items.nth(2).locator("i.fa-folder-plus").count() == 1
        assert pop.locator("i.fa-eye-slash").count() == 0
        assert "not found here" in pop.inner_text()
        # moving away closes it; a click pins it
        page.locator("#session-modal-title").hover()
        pop.wait_for(state="hidden", timeout=5000)
        help_btn.click()
        page.locator("#session-modal-title").hover()
        page.wait_for_timeout(400)
        assert page.locator(".load-help-popover").is_visible()
        help_btn.click()
        page.locator(".load-help-popover").wait_for(state="hidden", timeout=5000)
        # the save dialog has no help
        page.keyboard.press("Escape")
        page.wait_for_selector(".modal-backdrop", state="detached")
        page.click("#btn-save-session")
        assert page.locator("#session-help-btn").is_hidden()
    finally:
        ctx.close()


# ---- the autosave never switches datasets -------------------------------------

AUTOSAVE_KEY = "annzarro_autosave"


def _autosave_doc(store_name):
    doc = _set_doc("Autosave", ["cell-plot-P1", "cell-table-T1"], dataset=str(DATA["dir"] / store_name))
    doc.update({"isAutosave": True, "timestamp": "2026-01-01T00:00:00.000Z"})
    return doc


def test_the_autosave_restores_its_own_dataset_at_start(server, browser):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        seen = _guard(page)
        # the page was left on other_small, which is not the data directory's first store
        page.add_init_script(
            f"if (!localStorage.getItem('{AUTOSAVE_KEY}')) "
            f"localStorage.setItem('{AUTOSAVE_KEY}', {json.dumps(json.dumps(_autosave_doc('other_small.zarr')))});")
        page.goto(DATA["root"] + "/")
        _wait_tiles(page, 2)
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        assert page.evaluate(SHOWN).endswith("other_small.zarr")
        _no_prompts(page, seen)
    finally:
        ctx.close()


def test_the_autosave_never_switches_an_open_dataset(server, browser):
    ctx, page, seen = _page(browser, server, "fixture_small.zarr")
    try:
        page.evaluate(f"localStorage.setItem('{AUTOSAVE_KEY}', {json.dumps(json.dumps(_autosave_doc('other_small.zarr')))})")
        result = page.evaluate("() => window.sessionManager.loadSession('Autosave')")
        assert result["status"] == "success", result
        _wait_tiles(page, 2)
        # its panels opened on the dataset that was open; no question, no switch
        assert page.evaluate(SHOWN).endswith("fixture_small.zarr")
        assert sorted(_tile_ids(page)) == ["cell-plot-P1", "cell-table-T1"]
        _no_prompts(page, seen)
    finally:
        ctx.close()
