"""The session's default plot style: "Make this the session default" in Plot Options, Apply to other panels.

It redefines Default: every plot on Default (made from the chooser, or put back by the Default preset)
follows it, now and when it changes; a plot with a look of its own does not. Two cell plots (A, B) from
a link have looks of their own; plots made from the chooser are on Default. A is set up (font 18, four
ticks) and made the default. A reload of the tab keeps it, Close all clears it only with the cache tick,
a link and a panel set carry it (a panel set applies it only when loaded with its panels open), and a
panel set can be only a style.

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
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
A, B = "cell-plot-A", "cell-plot-B"
TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId)"
GD = """(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)"""
DRAWN = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd.data && gd.data.some(t => t.x && t.x.length > 1)); }""" % GD


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    """A server on its own copy of the store: saving a panel set writes <data dir>/sessions."""
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    home = tmp_path_factory.mktemp("home")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1500, "height": 1000}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(served):
    root, store = served
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {i: {"id": i, "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "cell_type", "column": ""}}
            for i in (A, B)}
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in (A, B)]
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}],
              "controlState": {i: True for i in (A, B)}, "panelConfigs": cfgs}
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served):
    page.goto(_link(served))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1000)


def _menu(page, pid, section):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    d = page.query_selector(f"details[data-panel='{pid}'][data-section='{section}']")
    if not d.evaluate("e => e.open"):
        d.query_selector("summary").click()
    page.wait_for_function("(e) => e.open", arg=d)


def _change(page, selector, value):
    page.fill(selector, str(value))
    page.press(selector, "Tab")
    page.wait_for_timeout(400)


def _settings(page, pid):
    return page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", pid)


def _close_menu(page, pid):
    if page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="detached")


def _make_default_from_a(page):
    """A: font 18 and four ticks; Make this the session default."""
    _menu(page, A, "text")
    _change(page, f"#font-size-{A}", 18)
    _menu(page, A, "axes")
    _change(page, f"#tick-count-{A}", 4)
    _menu(page, A, "apply")
    assert not page.is_visible(f"#session-style-reset-{A}")
    page.click(f"#session-style-set-{A}")
    page.wait_for_selector(f"#session-style-reset-{A}", state="visible")
    assert page.inner_text(f"#session-style-done-{A}") == "Set."
    _close_menu(page, A)


def _new_plot(page, kind="cell"):
    """A plot from the bottom chooser; its id."""
    before = set(page.evaluate(TILES))
    page.locator(f".panel-type-option[data-type='{kind}-plot']").last.click()
    page.wait_for_function("(b) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                           arg=sorted(before), timeout=30000)
    (new,) = set(page.evaluate(TILES)) - before
    if kind == "cell":
        page.wait_for_function(DRAWN, arg=new, timeout=60000)
    return new


def _look(page, pid):
    cfg = _settings(page, pid)
    return cfg["fontSize"], cfg["tickCount"], cfg.get("styleDefault")


def _wait_look(page, pid, font, ticks=None):
    page.wait_for_function("""([id, font, ticks]) => { const c = window.PanelManager.saveLayout().panelConfigs[id];
        return c.fontSize === font && (c.tickCount ?? null) === ticks; }""", arg=[pid, font, ticks], timeout=10000)


def _note_shown(page, pid):
    """Whether the menu of `pid`, opened afresh, says a session default is set (the reset button shows)."""
    _close_menu(page, pid)
    _menu(page, pid, "apply")
    shown = page.is_visible(f"#session-style-reset-{pid}")
    _close_menu(page, pid)
    return shown


def _ask_close_all(page, clear):
    page.click("#btn-close-all")
    page.wait_for_selector(".notification-ask", timeout=5000)
    ask = page.locator(".notification-ask")
    if clear:
        ask.locator("input[type=checkbox]").check()
    page.wait_for_timeout(700)
    return ask


def _remove_every_panel(page):
    page.evaluate("""() => { const pm = window.PanelManager;
        pm.getActivePanels().map(p => p.getId()).forEach(id => pm.closePanel(id));
        pm.getAllPanels().map(p => p.getId()).forEach(id => pm.removePanel(id)); }""")
    page.wait_for_function("() => window.PanelManager.getAllPanels().length === 0")


def _share_url(page, served):
    root, store = served
    payload = page.evaluate("""async () => { const d = await import('/static/js/utils/deeplink.js');
        return d.encodeViewPayload(window.sessionManager.captureView()); }""")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


def test_the_default_restyles_plots_on_default_and_leaves_the_rest(page, served):
    _open(page, served)
    own = _look(page, B)
    assert own == (12, None, None)                                       # from a link, with no marker: its own look
    n1, n2 = _new_plot(page), _new_plot(page)
    assert _look(page, n1) == (12, None, True)                           # made from the chooser: on Default
    _make_default_from_a(page)
    assert _settings(page, A)["styleDefault"] is True                    # the plot it was made from is on Default
    _wait_look(page, n1, 18, 4)                                          # existing plots on Default follow at once
    _wait_look(page, n2, 18, 4)
    assert page.evaluate("(id) => (%s)(id)._fullLayout.xaxis.nticks" % GD, n1) == 4
    assert _look(page, B)[:2] == (12, None)                              # a look of its own does not

    # a plot made now starts from it, and Duplicate of a plot on Default is on Default
    n3 = _new_plot(page)
    assert _look(page, n3) == (18, 4, True)
    before = set(page.evaluate(TILES))
    page.evaluate("(id) => setTimeout(() => document.querySelector(`.source-panel-option[data-id='${id}']`).click(), 0)", n2)
    page.wait_for_function("(b) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                           arg=sorted(before), timeout=30000)
    (dup,) = set(page.evaluate(TILES)) - before
    assert _look(page, dup)[:2] == (18, 4)

    # changing a plot's look in Plot Options makes it its own: the default no longer moves it
    _menu(page, n1, "text")
    _change(page, f"#font-size-{n1}", 16)
    assert _look(page, n1) == (16, 4, False)
    _close_menu(page, n1)

    # a new default: A again, with another size; n1 keeps its own, the others follow
    _menu(page, A, "text")
    _change(page, f"#font-size-{A}", 20)
    assert _settings(page, A)["styleDefault"] is False
    _menu(page, A, "apply")
    page.click(f"#session-style-set-{A}")
    _close_menu(page, A)
    _wait_look(page, n2, 20, 4)
    assert _look(page, n1)[0] == 16

    # the Default preset puts a plot back on Default: it follows the session default (the tooltip says so)
    _menu(page, n1, "presets")
    assert page.get_attribute(f"#preset-default-{n1}", "title").startswith("Session default style")
    page.click(f"#preset-default-{n1}")
    _wait_look(page, n1, 20, 4)
    assert _settings(page, n1)["styleDefault"] is True
    _close_menu(page, n1)

    # reset: every plot on Default is built-in again, the plots with their own look stay
    _menu(page, n2, "apply")
    page.click(f"#session-style-reset-{n2}")
    _close_menu(page, n2)
    for pid in (n1, n2, n3, dup):
        _wait_look(page, pid, 12, None)
    assert _look(page, B)[:2] == (12, None)
    _menu(page, n1, "presets")
    assert page.get_attribute(f"#preset-default-{n1}", "title") == "Built-in style"


def test_a_gene_plot_has_its_own_default(page, served):
    _open(page, served)
    gene = _new_plot(page, "gene")
    _make_default_from_a(page)
    assert _settings(page, gene)["fontSize"] == 12 and _settings(page, gene)["styleDefault"] is True
    assert _settings(page, _new_plot(page, "gene"))["fontSize"] == 12     # the cell plots' default is theirs


def test_a_reload_of_the_tab_keeps_it_and_a_new_tab_does_not(page, served):
    _open(page, served)
    n1 = _new_plot(page)
    _make_default_from_a(page)
    _wait_look(page, n1, 18, 4)
    assert page.evaluate("() => Object.keys(sessionStorage)").count("annzarro_session_style") == 1
    page.reload()
    page.wait_for_function("(id) => !!document.querySelector(`.tile[data-tile-id='${id}'] .js-plotly-plot`)", arg=n1, timeout=60000)
    page.wait_for_timeout(1500)
    assert _look(page, n1) == (18, 4, True)                              # still on Default, still following
    assert _look(page, B)[:2] == (12, None)
    assert _settings(page, _new_plot(page))["fontSize"] == 18
    assert _note_shown(page, A)
    other = page.context.new_page()                                      # a new tab: its own session storage
    _open(other, served)
    assert not _note_shown(other, A)
    assert _settings(other, _new_plot(other))["fontSize"] == 12


def test_close_all_keeps_it_without_the_tick_and_clears_it_with_the_tick(page, served):
    _open(page, served)
    _make_default_from_a(page)
    ask = _ask_close_all(page, clear=False)
    ask.get_by_role("button", name="Close all", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 0")
    page.wait_for_timeout(500)
    assert "annzarro_session_style" in page.evaluate("() => Object.keys(sessionStorage)")
    assert _settings(page, _new_plot(page))["fontSize"] == 18            # the welcome tile makes the first plot

    ask = _ask_close_all(page, clear=True)
    with page.expect_navigation(timeout=30000):
        ask.get_by_role("button", name="Close all", exact=True).click()
    page.wait_for_function("() => document.readyState === 'complete'")
    page.wait_for_timeout(1500)
    assert "annzarro_session_style" not in page.evaluate("() => Object.keys(sessionStorage)")
    _open(page, served)
    assert not _note_shown(page, A)
    assert _settings(page, _new_plot(page))["fontSize"] == 12


def test_a_link_carries_the_default_and_renders_the_same_for_the_receiver(page, served):
    _open(page, served)
    n1 = _new_plot(page)
    _make_default_from_a(page)
    _wait_look(page, n1, 18, 4)
    url = _share_url(page, served)
    view = page.evaluate("() => window.sessionManager.captureView()")
    assert view["sessionStyles"]["cell-plot"] == {"fontSize": 18, "tickCount": 4}      # only what differs from built-in
    assert view["layout"]["panelConfigs"][n1]["styleDefault"] is True

    # a receiver with another default of their own gets the sender's, and the plots on Default look as sent
    receiver = page.context.browser.new_context(viewport={"width": 1500, "height": 1000}).new_page()
    receiver.goto(_link(served))
    receiver.wait_for_function(DRAWN, arg=A, timeout=60000)
    receiver.wait_for_timeout(1000)
    _menu(receiver, A, "text")
    _change(receiver, f"#font-size-{A}", 9)
    _menu(receiver, A, "apply")
    receiver.click(f"#session-style-set-{A}")
    _close_menu(receiver, A)
    receiver.goto(url)
    receiver.reload()
    receiver.wait_for_function(DRAWN, arg=n1, timeout=60000)
    receiver.wait_for_timeout(1500)
    assert _look(receiver, n1) == (18, 4, True)
    assert _settings(receiver, _new_plot(receiver))["fontSize"] == 18

    # a link made with no default, with plots on Default, clears the receiver's: they look built-in as sent
    clear = page.context.browser.new_context(viewport={"width": 1500, "height": 1000}).new_page()
    clear.goto(_link(served))
    clear.wait_for_function(DRAWN, arg=A, timeout=60000)
    n2 = _new_plot(clear)
    sender_url = _share_url(clear, served)
    assert "sessionStyles" not in clear.evaluate("() => window.sessionManager.captureView()")
    receiver.goto(sender_url)
    receiver.reload()
    receiver.wait_for_function(DRAWN, arg=n2, timeout=60000)
    receiver.wait_for_timeout(1500)
    assert _look(receiver, n2)[:2] == (12, None)
    assert not _note_shown(receiver, A)


def test_a_panel_set_carries_it_and_applies_it_only_when_its_panels_open(page, served):
    _open(page, served)
    n1 = _new_plot(page)
    _make_default_from_a(page)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "with-style")
    assert saved["status"] == "success", saved
    stored = page.evaluate("""async () => (await (await fetch('/api/v1/sessions/load?name=with-style')).json()).view.sessionStyles""")
    assert stored["cell-plot"] == {"fontSize": 18, "tickCount": 4}

    # a set saved with no default and a plot on Default clears the current one when opened
    _menu(page, A, "apply")
    page.click(f"#session-style-reset-{A}")
    _close_menu(page, A)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "without-style")
    assert saved["status"] == "success", saved
    assert page.evaluate("""async () => (await (await fetch('/api/v1/sessions/load?name=without-style')).json()).view.sessionStyles""") is None

    # closed: the set's default stays out
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'add'})", "with-style")
    assert loaded["status"] == "success", loaded
    page.wait_for_timeout(800)
    assert not _note_shown(page, A)
    assert _settings(page, _new_plot(page))["fontSize"] == 12

    # open: it replaces the current one, and its plots on Default follow it
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'current'})", "with-style")
    assert loaded["status"] == "success", loaded
    page.wait_for_function("(id) => !!document.querySelector(`.tile[data-tile-id='${id}'] .js-plotly-plot`)", arg=n1, timeout=60000)
    page.wait_for_timeout(1500)
    assert _look(page, n1) == (18, 4, True)
    assert _note_shown(page, n1)
    assert _settings(page, _new_plot(page))["fontSize"] == 18

    # opening the set saved without a default clears it (it has plots on Default)
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n, {mode: 'current'})", "without-style")
    assert loaded["status"] == "success", loaded
    page.wait_for_timeout(2500)
    assert not _note_shown(page, page.evaluate(TILES)[0])


def test_a_set_with_no_panel_can_be_only_a_style(page, served):
    _open(page, served)
    n1 = _new_plot(page)
    _remove_every_panel(page)
    refused = page.evaluate("(n) => window.sessionManager.saveSession(n)", "nothing")
    assert refused["status"] == "error" and "nothing to save" in refused["message"]

    _open(page, served)
    n1 = _new_plot(page)
    _make_default_from_a(page)
    _remove_every_panel(page)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "house-style")
    assert saved["status"] == "success", saved
    data = page.evaluate("""async () => await (await fetch('/api/v1/sessions/load?name=house-style')).json()""")
    assert data["styleOnly"] is True and data["dataset"] == "" and data["panelConfigs"] == {}
    assert data["view"]["sessionStyles"]["cell-plot"] == {"fontSize": 18, "tickCount": 4}
    listed = page.evaluate("""async () => (await (await fetch('/api/v1/sessions/list')).json()).find(s => s.name === 'house-style')""")
    assert listed["styleOnly"] is True

    # another page, no default: the card says Style only, with one Apply style button and no dataset warning
    other = page.context.new_page()
    _open(other, served)
    n2 = _new_plot(other)
    assert _look(other, n2)[:2] == (12, None)
    other.wait_for_selector("#btn-load-session")
    other.click("#btn-load-session")
    card = other.locator(".session-card[data-session-name='house-style']")
    card.wait_for(timeout=30000)
    card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    assert card.locator(".session-dataset-badge:visible").all_inner_texts() == ["Style only"]
    assert card.locator(".session-load").inner_text() == "Apply style"
    assert card.locator(".load-icon-btn:visible").count() == 0
    assert "not found" not in card.inner_text()
    other.click("#session-help-btn")
    assert "Style only" in other.inner_text("#session-help-pop") and "panels open" in other.inner_text("#session-help-pop")
    other.click("#session-help-btn")                                     # unpin it
    card.locator(".session-load").click()
    other.wait_for_selector("#session-modal", state="hidden", timeout=30000)
    _wait_look(other, n2, 18, 4)                                         # its plots on Default took it
    assert n2 in other.evaluate(TILES) and B in other.evaluate(TILES)    # the open panels stay open, as they were
    assert _settings(other, _new_plot(other))["fontSize"] == 18


def test_a_set_with_panels_and_a_style_says_so_on_its_card(page, served):
    _open(page, served)
    _new_plot(page)
    _make_default_from_a(page)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "card-style")
    assert saved["status"] == "success", saved
    _menu(page, A, "apply")
    page.click(f"#session-style-reset-{A}")
    _close_menu(page, A)
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "card-plain")
    assert saved["status"] == "success", saved
    page.click("#btn-load-session")
    for name, texts in (("card-style", ["Style"]), ("card-plain", [])):
        card = page.locator(f".session-card[data-session-name='{name}']")
        card.wait_for(timeout=30000)
        card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
        assert card.locator(".session-style-badge:visible").all_inner_texts() == texts, name
    tip = page.locator(".session-card[data-session-name='card-style'] .session-style-badge")
    assert "cell plots" in tip.get_attribute("data-tip")
    assert "only when the set is loaded with its panels open" in tip.get_attribute("data-tip")


BOXES = """(card) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const icons = [...card.querySelectorAll('.session-card-actions > *')].map(r);
    const badges = [...card.querySelectorAll('.session-card-dataset > *')].filter(e => e.offsetParent !== null);
    return { icons, badges: badges.map(r), names: badges.map(e => e.textContent.trim()) };
}"""


def _meets(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


@pytest.mark.parametrize("width", [1400, 560])
def test_badges_never_overlap_the_card_icons(page, served, width):
    """A long name, a dataset badge and the Style badge, in a wide and a narrow dialog."""
    page.set_viewport_size({"width": width, "height": 900})
    _open(page, served)
    _new_plot(page)
    _make_default_from_a(page)
    name = "a_really_long_house_style_panel_set_name_that_goes_on_and_on_and_on"
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", name)
    assert saved["status"] == "success", saved
    page.click("#btn-load-session")
    card = page.locator(f".session-card[data-session-name='{name}']")
    card.wait_for(timeout=30000)
    card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    shot = os.environ.get("ANNZARRO_SHOTS")
    if shot:
        os.makedirs(shot, exist_ok=True)
        card.screenshot(path=os.path.join(shot, f"card-{width}.png"))
    boxes = card.evaluate(BOXES)
    assert len(boxes["icons"]) == 2 and len(boxes["badges"]) >= 3, boxes["names"]    # name, dataset badge, Style badge
    for badge in boxes["badges"]:
        for icon in boxes["icons"]:
            assert not _meets(badge, icon), (boxes["names"], badge, icon)


def test_a_set_with_only_closed_panels_and_a_style_applies_the_style_and_keeps_the_page(page, served):
    _open(page, served)
    n1 = _new_plot(page)
    _make_default_from_a(page)
    page.evaluate("""() => { const pm = window.PanelManager;
        pm.getActivePanels().map(p => p.getId()).forEach(id => pm.closePanel(id)); }""")
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", "closed-only")
    assert saved["status"] == "success", saved
    other = page.context.new_page()
    _open(other, served)
    n2 = _new_plot(other)
    url = other.url
    other.click("#btn-load-session")
    card = other.locator(".session-card[data-session-name='closed-only']")
    card.wait_for(timeout=30000)
    card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    card.locator(".session-load").click()
    other.wait_for_selector("#session-modal", state="hidden", timeout=30000)
    _wait_look(other, n2, 18, 4)
    assert sorted(other.evaluate(TILES)) == sorted([A, B, n2])           # nothing closed, nothing added
    assert other.url.split("#")[0] == url.split("#")[0]
