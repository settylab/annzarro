"""A set of plots too large for the browser, and the page after a tab that ran out of memory.

The operator kept "All cells", had four plots open and switched to a 95.6M-cell
store: the tab ran out of memory, and every reload restored the same set and ran
out again. Headless Chromium on the committed 200-cell fixture, with the memory
budget made small enough that 200 points matter.

1. Plots drawn at once take turns (memory-guard.js DrawTurns): with room for
   two, the first two draw and the others say "Not drawn: not enough browser
   memory" with Half the cells, Subset, Close other plots and Draw anyway (and
   what it risks); Draw anyway draws; Close other plots closes the others and
   draws this one.
2. A clean link (the bare address, a fresh visit) does not restore the
   autosave: the welcome screen lists it first as "Last session (autosaved
   HH:MM)" with its dataset and panel count, and nothing is drawn until
   Restore. A reload of the tab does restore it (ui.autosave.auto_restore:
   reload, the default); auto_restore: always restores on a fresh visit too.
3. A restore marker left by a page that ended mid-draw (a crash: pagehide
   never ran): the reload of that tab neither restores the autosave nor
   draws the view in its address; the session is listed as "did not finish
   loading" with "Restore with the default subset", which opens it without
   its saved subset. The memory guard's crash marker of a draw does the same.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import re
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
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
SHOTS = os.environ.get("ANNZARRO_SHOTS")   # where to keep screenshots, when set

FAST_AUTOSAVE = "ui:\n  autosave:\n    interval_ms: 300\n"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    (home / "config.yaml").write_text(config)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "config.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", DATA_DIR, "--no-browser",
                             "--auth-disabled"],
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
    return root, proc


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    # large-plot mode above 100 points: the fixture's plots are heavy draws, which take turns
    root, proc = _serve(tmp_path_factory, FAST_AUTOSAVE + "  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def always_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, FAST_AUTOSAVE.replace("interval_ms: 300\n", "interval_ms: 300\n    auto_restore: always\n"))
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


@pytest.fixture
def page(browser):
    context = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    yield page
    assert not errors, errors
    context.close()


IDS = ("cell-plot-a", "cell-plot-b", "cell-plot-c", "cell-plot-d")


def _plot(pid):
    return {"id": pid,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type"}}


def _view(ids=IDS, subset=None):
    tiles = [{"type": "tile", "id": pid, "controlsVisible": False} for pid in ids]

    def nest(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal",
                "panes": [{"percentage": 50}, {"percentage": 50}], "children": [nodes[0], nest(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [nest(tiles)], "controlState": {t["id"]: False for t in tiles},
                               "panelConfigs": {pid: _plot(pid) for pid in ids}}}
    if subset != "absent":
        view["subset"] = subset
    return view


def _link(root, ids=IDS):
    payload = base64.urlsafe_b64encode(json.dumps(_view(ids), separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


def _autosave(page_id, ids=IDS, minutes_ago=5, subset=None):
    """An autosave as an earlier page wrote it ("All cells": subset null)."""
    return {"name": "Autosave", "isAutosave": True, "page": page_id, "dataset": STORE,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 60 * minutes_ago)),
            "panelConfigs": {pid: {"id": pid, "type": "cell-plot", "title": pid, "config": _plot(pid)} for pid in ids},
            "view": _view(ids, subset)}


def _seed(page, root, items):
    """Write localStorage `items` from a page of the origin that runs no app."""
    page.goto(root + "/static/css/styles.css")
    page.evaluate("(items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v)); }", items)


def until(page, js, arg=None, timeout=30.0):
    """Poll an async page function until it returns something truthy."""
    end = time.time() + timeout
    while True:
        value = page.evaluate(js, arg)
        if value:
            return value
        if time.time() > end:
            raise AssertionError(f"timed out waiting for: {js[:120]}")
        time.sleep(0.1)


def _drawn(page, pid, timeout=30.0):
    until(page, """async (pid) => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return !!document.querySelector(`.tile[data-tile-id="${pid}"] .js-plotly-plot .main-svg`)
            && !!g.ledger.get(pid) && !g.ledger.pending.has(pid);
    }""", pid, timeout)


def _settled(page):
    """Every plot drawn or showing why not, nothing drawing or waiting for its turn."""
    until(page, """async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        const tiles = [...document.querySelectorAll('.tile[data-tile-id^="cell-plot"]')];
        return tiles.length && g.drawsInFlight() === 0 && tiles.every(t =>
            t.querySelector('.coverage-placeholder') || t.querySelector('.js-plotly-plot .main-svg'));
    }""", timeout=60)


def _shot(page, name, selector=None):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        if selector:
            page.locator(selector).first.screenshot(path=os.path.join(SHOTS, name))
        else:
            page.screenshot(path=os.path.join(SHOTS, name))


# Room for two of the fixture's plots and part of a third: what the ledger
# holds now (the app, the cache), two plots resident and half a plot's peak
# (the check multiplies needs by 1 + margin).
ROOM_FOR_TWO = """async () => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    const c = m.panelCost({ kind: 'cell-plot', n: 200, large: true, colour: 'categorical' });
    const held = g.held();
    const free = 2 * (c.resident.heap + c.resident.off) + 0.5 * (c.peak.heap + c.peak.off) * 1.2;
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), total_gb: (held.heap + held.off + free) / m.GB, margin: 0.2 };
    return free;
}"""

PLACEHOLDER = '.tile[data-tile-id="{}"] .coverage-placeholder'


def _drawn_ids(page):
    return page.evaluate("""() => [...document.querySelectorAll('.tile[data-tile-id^="cell-plot"]')]
        .filter(t => t.querySelector('.js-plotly-plot .main-svg')).map(t => t.dataset.tileId).sort()""")


def _refused_ids(page):
    return page.evaluate("""() => [...document.querySelectorAll('.tile[data-tile-id^="cell-plot"]')]
        .filter(t => /Not drawn: not enough browser memory/.test((t.querySelector('.coverage-placeholder') || {}).innerText || ''))
        .map(t => t.dataset.tileId).sort()""")


# Each plot tile's header: the title, the buttons, whether they sit on one
# row (every button at the title's height) and whether the title has room
# to be read (at least 40 px wide).
HEADERS = """() => Object.fromEntries([...document.querySelectorAll('.tile[data-tile-id^="cell-plot"]')].map(t => {
    const h = t.querySelector('.tile-header'), title = h.querySelector('.tile-title');
    const buttons = [...h.querySelectorAll('.tile-controls > .btn')];
    const tr = title.getBoundingClientRect(), mid = tr.top + tr.height / 2;
    const boxes = buttons.map(b => b.getBoundingClientRect());
    return [t.dataset.tileId, {
        // the whole title is read: the input does not scroll its text
        title: title.value, titleShown: tr.width >= 40 && title.scrollWidth <= title.clientWidth,
        buttons: buttons.map(b => b.className.split(' ').find(c => c.startsWith('tile-'))),
        oneRow: boxes.every(r => r.top <= mid && r.bottom >= mid),
        inside: boxes.every(r => r.right <= t.getBoundingClientRect().right)
    }];
}))"""


def _restore_four(page, server):
    """The welcome screen's last session restored with room for two plots."""
    _seed(page, server, {"annzarro_autosave": _autosave("earlier-page")})
    page.goto(server + "/")
    item = page.locator(".sessions-list .last-session").first
    item.wait_for(timeout=30000)
    page.evaluate(ROOM_FOR_TWO)
    item.locator(".last-session-restore").click()
    _settled(page)


def test_plots_drawn_at_once_take_turns_and_the_later_ones_are_refused(server, page):
    _restore_four(page, server)
    drawn, refused = _drawn_ids(page), _refused_ids(page)
    assert drawn == ["cell-plot-a", "cell-plot-b"], (drawn, refused)
    assert refused == ["cell-plot-c", "cell-plot-d"], (drawn, refused)
    box = page.locator(PLACEHOLDER.format("cell-plot-c"))
    text = " ".join(box.inner_text().split())
    # one line of numbers, the risk of Draw anyway, the actions: no ceiling, no advice sentence
    lines = box.locator(".coverage-placeholder__reasons li").all_inner_texts()
    assert len(lines) == 2, lines
    assert re.fullmatch(r"Needs ~\d+ MB; \d+ MB free with 3 plots open\.", lines[0]), lines
    assert lines[1] == "Draw anyway may run the tab out of memory; the browser then closes it, with every panel.", lines
    assert "estimated" not in text and "Close a plot, or show fewer cells" not in text, text
    # a refused panel keeps the header of a drawn one: its title, every button, on one row
    heads = page.evaluate(HEADERS)
    assert heads["cell-plot-c"]["title"] == heads["cell-plot-a"]["title"] == "Cell Plot", heads
    for pid in ("cell-plot-c", "cell-plot-d"):
        h = heads[pid]
        assert h["buttons"] == heads["cell-plot-a"]["buttons"], heads
        assert h["oneRow"] and h["inside"] and h["titleShown"], (pid, h)
    actions = box.locator("[data-ps-action]").evaluate_all("bs => bs.map(b => [b.dataset.psAction, b.textContent])")
    assert [a for a, _ in actions] == ["subset", "close-others", "draw-anyway"] or \
        [a for a, _ in actions] == ["subset-half", "subset", "close-others", "draw-anyway"], actions
    assert ("draw-anyway", "Draw anyway") in [tuple(a) for a in actions]
    # no notice (toast) for it: the panel says it
    assert page.locator(".notification, .toast").filter(has_text="memory").count() == 0
    _shot(page, "refused-panel.png")
    # every plot drawn or refused: the restore marker is gone
    until(page, "() => window.sessionManager.restoreMarker() === null")

    # Draw anyway: drawn past the guard, once
    box.locator('[data-ps-action="draw-anyway"]').click()
    _drawn(page, "cell-plot-c")
    assert page.locator(PLACEHOLDER.format("cell-plot-d")).count() == 1


def test_close_other_plots_draws_this_one(server, page):
    _restore_four(page, server)
    assert _refused_ids(page) == ["cell-plot-c", "cell-plot-d"]
    page.locator(PLACEHOLDER.format("cell-plot-d") + ' [data-ps-action="close-others"]').click()
    _drawn(page, "cell-plot-d")
    open_ids = page.evaluate("() => [...document.querySelectorAll('.tile[data-tile-id^=\"cell-plot\"]')].map(t => t.dataset.tileId)")
    assert open_ids == ["cell-plot-d"], open_ids
    # the others are in the closed list, to reopen
    for pid in ("cell-plot-a", "cell-plot-b", "cell-plot-c"):
        assert page.locator(f'.panel-closed-btn[data-id="{pid}"]').count() == 1, pid


LAST = ".sessions-list .last-session"


NAMED = ("() => new URLSearchParams(location.search).get('dataset_path') === 'fixture_small.zarr'"
         " && /^#view=/.test(location.hash)")


def test_a_clean_link_lists_the_last_session_and_draws_nothing_until_restore(server, page):
    _seed(page, server, {"annzarro_autosave": _autosave("earlier-page", ids=("cell-plot-a", "cell-plot-b"))})
    page.goto(server + "/")
    item = page.locator(LAST).first
    item.wait_for(timeout=30000)
    # listed first, before the saved panel sets
    assert page.evaluate("() => document.querySelector('.sessions-list').firstElementChild.classList.contains('last-session')")
    title = item.locator(".last-session__title").inner_text()
    assert title.startswith("Last session (autosaved ") and title.endswith(")"), title
    assert item.locator(".last-session__summary").inner_text() == "fixture_small.zarr, 2 panels"
    assert item.locator(".last-session-restore-default").count() == 0, "it finished loading: only Restore"
    assert item.locator(".last-session__unfinished").count() == 0
    page.wait_for_timeout(1500)
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 0, "a clean link draws nothing by itself"
    # the page with no panels autosaves nothing over it
    assert json.loads(page.evaluate("() => localStorage.getItem('annzarro_autosave')"))["page"] == "earlier-page"
    _shot(page, "welcome-last-session.png", ".selection-section:has(.sessions-list)")

    assert "dataset_path" not in page.url, "nothing is open: the address names no dataset"
    item.locator(".last-session-restore").click()
    _drawn(page, "cell-plot-a")
    _drawn(page, "cell-plot-b")
    # restored, the address names its dataset and view: a reload is the same
    page.wait_for_function(NAMED, timeout=15000)
    # it is now this page's: the Load Panel Set dialog does not offer what is open
    page.wait_for_function("() => (JSON.parse(localStorage.getItem('annzarro_autosave') || '{}').page || 'earlier-page') !== 'earlier-page'",
                           timeout=10000)
    until(page, "() => window.sessionManager.restoreMarker() === null")
    page.click("#btn-load-session")
    page.wait_for_selector("#session-grid .session-card, #session-grid .no-sessions-message", timeout=10000)
    assert page.locator("#session-grid .last-session").count() == 0


def test_the_load_dialog_lists_the_last_sessions_first(server, page):
    older = _autosave("older-page", ids=("cell-plot-a",), minutes_ago=30)
    _seed(page, server, {"annzarro_autosave": _autosave("earlier-page", ids=("cell-plot-a", "cell-plot-b")),
                         "annzarro_last_sessions": [older]})
    page.goto(server + "/")
    page.locator(LAST).first.wait_for(timeout=30000)
    assert page.locator(LAST).count() == 2
    page.click("#btn-load-session")
    page.wait_for_selector("#session-grid .last-session", timeout=10000)
    cards = page.locator("#session-grid .last-session")
    assert cards.count() == 2
    assert cards.nth(0).locator(".last-session__title").inner_text().startswith("Last session (autosaved ")
    assert cards.nth(1).locator(".last-session__title").inner_text().startswith("Earlier session (autosaved ")
    assert cards.nth(1).locator(".last-session__summary").inner_text() == "fixture_small.zarr, 1 panel"
    assert page.evaluate("() => document.querySelector('#session-grid').firstElementChild.classList.contains('last-session')")
    cards.nth(1).locator(".last-session-restore").click()
    _drawn(page, "cell-plot-a")
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 1
    # the dialog closes (after its fade)
    page.wait_for_selector("#session-modal", state="hidden", timeout=10000)


def test_a_reload_of_the_tab_restores_it(server, page):
    _seed(page, server, {"annzarro_autosave": _autosave("earlier-page", ids=("cell-plot-a",))})
    page.goto(server + "/")
    page.locator(LAST).first.wait_for(timeout=30000)
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 0
    # the reload of a tab on the bare address restores the autosave (auto_restore: reload)
    page.reload()
    _drawn(page, "cell-plot-a")
    until(page, "() => window.sessionManager.restoreMarker() === null")
    # the address names the dataset and view it restored, so the next reload opens them from there
    page.wait_for_function(NAMED, timeout=15000)
    # restored whole, it continues in this page: listed no more, and kept once
    until(page, "() => (JSON.parse(localStorage.getItem('annzarro_autosave') || '{}').page || 'earlier-page') !== 'earlier-page'")
    assert page.evaluate("() => window.sessionManager.lastSessions().length") == 0
    # and so does the next reload
    page.reload()
    _drawn(page, "cell-plot-a")


def test_auto_restore_always_restores_a_fresh_visit(always_server, page):
    _seed(page, always_server, {"annzarro_autosave": _autosave("earlier-page", ids=("cell-plot-a",))})
    page.goto(always_server + "/")
    _drawn(page, "cell-plot-a")


def _unfinished_item(page):
    item = page.locator(LAST).first
    item.wait_for(timeout=30000)
    warn = item.locator(".last-session__unfinished")
    warn.wait_for(timeout=5000)
    return item, " ".join(warn.inner_text().split())


def test_a_tab_that_ended_mid_restore_is_not_restored_again(server, page):
    """The restore marker: a page that ends while it draws (pagehide never runs) leaves it."""
    page.goto(_link(server, ids=("cell-plot-a",)))
    _drawn(page, "cell-plot-a")
    page.wait_for_function("() => /#view=/.test(location.hash)", timeout=15000)
    # what a page that runs out of memory mid-draw leaves: its autosave, and the marker of a restore under way
    page.evaluate("""async () => {
        await window.sessionManager.saveToLocalStorage();
        window.sessionManager.beginRestore('switch');
    }""")
    assert page.evaluate("() => !!localStorage.getItem('annzarro_restoring')")
    # the reload: neither the view in the address nor the autosave is drawn by itself
    page.reload()
    item, text = _unfinished_item(page)
    assert text.startswith("Did not finish loading: the tab ended while it was drawn"), text
    assert "default subset" in text
    page.wait_for_timeout(1500)
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 0
    assert "#view=" not in page.url, page.url
    assert page.evaluate("() => localStorage.getItem('annzarro_restoring')") is None, "the marker became the session's mark"
    _shot(page, "welcome-did-not-finish.png", ".selection-section:has(.sessions-list)")
    # and a second reload still does not
    page.reload()
    _unfinished_item(page)
    page.wait_for_timeout(1000)
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 0
    # Restore as saved draws it
    page.locator(LAST).first.locator(".last-session-restore").click()
    _drawn(page, "cell-plot-a")


@pytest.fixture(scope="module")
def subset_server(tmp_path_factory):
    """The fixture's 200 cells open on a default subset of 50."""
    root, proc = _serve(tmp_path_factory, FAST_AUTOSAVE + "  defaults:\n    subset_threshold: 100\n    subset_size: 50\n")
    yield root
    proc.terminate()
    proc.wait(10)


CELLS = "() => (document.getElementById('cell-count') || {}).textContent || ''"


@pytest.mark.parametrize("button,cells", [(".last-session-restore-default", "50 of 200"), (".last-session-restore", "200")])
def test_restore_with_the_default_subset_drops_the_saved_subset(subset_server, page, button, cells):
    """Saved on "All cells" (subset null): Restore opens every cell, the other button the default subset."""
    _seed(page, subset_server, {"annzarro_autosave": {**_autosave("crashed-page", ids=("cell-plot-a",)),
                                                      "unfinished": {"reason": "ended"}}})
    page.goto(subset_server + "/")
    item, text = _unfinished_item(page)
    assert item.locator(".last-session-restore-default").inner_text() == "Restore with the default subset"
    assert item.locator(".last-session-restore").inner_text() == "Restore"
    item.locator(button).click()
    _drawn(page, "cell-plot-a")
    page.wait_for_function(f"() => ({CELLS})() === {json.dumps(cells)}", timeout=15000)


def test_a_crash_marker_of_a_draw_also_stops_the_restore(always_server, page):
    """The memory guard's own marker (a risky draw that never ended): even under always."""
    _seed(page, always_server, {
        "annzarro_autosave": _autosave("crashed-page", ids=("cell-plot-a",)),
        "annzarro_memory_pending": {"panel": "cell-plot-a", "n": 95624334, "action": "draw",
                                    "at": int(time.time() * 1000), "page": "crashed-page"}})
    page.goto(always_server + "/")
    item, text = _unfinished_item(page)
    assert text.startswith("Did not finish loading"), text
    page.wait_for_timeout(1500)
    assert page.locator('.tile[data-tile-id^="cell-plot"]').count() == 0
    assert item.locator(".last-session-restore-default").count() == 1


def test_a_live_tab_s_marker_is_not_taken_for_a_crash(server, browser):
    """Another tab still restoring (its marker refreshed) does not mark its session unfinished."""
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    try:
        page = ctx.new_page()
        _seed(page, server, {"annzarro_autosave": _autosave("live-page", ids=("cell-plot-a",)),
                             "annzarro_restoring": {"page": "live-page", "at": int(time.time() * 1000),
                                                    "beat": int(time.time() * 1000), "source": "switch"}})
        page.goto(server + "/")
        item = page.locator(LAST).first
        item.wait_for(timeout=30000)
        assert item.locator(".last-session__unfinished").count() == 0
        assert page.evaluate("() => !!localStorage.getItem('annzarro_restoring')"), "not this page's to remove"
    finally:
        ctx.close()
