"""The browser memory guard in a real browser (static/js/utils/memory-guard*.js).

Headless Chromium on the committed 200-cell fixture. The guard's budget is
made small enough that 200 points matter: through the server's ui.memory
(proving it reaches the browser through /api/v1/config), or, where a test
needs a ceiling between two states, by setting the page's
Config.DEFAULTS.MEMORY from what the ledger holds at that moment.

1. ui.memory.heap_gb below what the app itself holds: the plot is not
   drawn, and the panel says why (block); with enforce: warn it is drawn
   with a warning tag.
2. A second Cell Plot that would not fit: the create tile and the duplicate
   tile are disabled with the reason; closing the plot frees its share and
   enables them again. Closing loses the plot's WebGL contexts (release-plot.js)
   and removes it from the ledger.
3. The subset dialog: with three plots open "All" does not fit and its chip
   is disabled with "needs ~"; the footer gives the headroom; with one plot
   it is enabled again.
4. Export: the full-resolution buttons are disabled with the reason written
   under them, the plot "as shown" is offered beside them and downloads a
   PNG of the plot's on-screen size; the modebar camera refuses in the
   status strip and offers "Export as shown". With room, the full export
   downloads a PNG of the export's size and leaves the live plot as it was.
5. A crash marker left by a page that died while drawing a panel: the panel
   is not drawn again until "Draw anyway".
6. The cell table builds rows only for the page shown (deferRender).
7. Closing frees only what is private to a panel: a closed table still
   filters the plot linked to it, the focused cell and the panel set
   outlive the panel, Reopen works, and the closed plot's ledger entry and
   WebGL contexts are gone.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import socket
import struct
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


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config=None):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    extra = []
    if config:
        (home / "config.yaml").write_text(config)
        extra = ["--config", str(home / "config.yaml")]
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", *extra, "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
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
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def tiny_server(tmp_path_factory):
    """A JS heap budget below what the app alone holds (0.17 GB): no plot fits."""
    root, proc = _serve(tmp_path_factory, "ui:\n  memory:\n    heap_gb: 0.1\n")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def warn_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, "ui:\n  memory:\n    heap_gb: 0.1\n    enforce: warn\n")
    yield root
    proc.terminate()
    proc.wait(10)


def _plot(pid):
    return {"id": pid,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type"}}


def _link(root, ids=("cell-plot-a",), extra=None):
    configs = {pid: _plot(pid) for pid in ids}
    tiles = [{"type": "tile", "id": pid, "controlsVisible": True} for pid in ids]
    if extra:
        for pid, cfg in extra.items():
            configs[pid] = cfg
            tiles.append({"type": "tile", "id": pid, "controlsVisible": True})
    def nest(nodes):
        # splits are binary: a, (b, (c, ...))
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal",
                "panes": [{"percentage": 50}, {"percentage": 50}], "children": [nodes[0], nest(nodes[1:])]}
    hierarchy = [nest(tiles)]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": hierarchy,
                       "controlState": {t["id"]: True for t in tiles}, "panelConfigs": configs}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


def _drawn(page, pid):
    page.wait_for_selector(f'.tile[data-tile-id="{pid}"] .js-plotly-plot', timeout=30000)
    page.wait_for_function(f"""async () => {{
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return !!g.ledger.get('{pid}');
    }}""", timeout=30000)


# Set the page's JS heap ceiling so that exactly `free` bytes are left after
# what the ledger holds now (the guard multiplies needs by 1 + margin).
SET_FREE = """async (free) => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    const held = g.held().heap;
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), heap_gb: (held + free) / (m.GB * m.HEAP_USABLE_SHARE), margin: 0.2 };
    document.dispatchEvent(new CustomEvent(g.MEMORY_EVENT));
    return held;
}"""

# What a new Cell Plot of the cells shown needs (its peak), from the model.
NEW_PLOT_NEED = """async () => {
    const m = await import('/static/js/utils/memory-guard.js');
    const { DataManager } = await import('/static/js/data-manager.js');
    const n = DataManager.getCells().length;
    return m.panelCost({ kind: 'cell-plot', n, large: false, colour: 'numeric' }).peak.heap * 1.2;
}"""


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
    context = browser.new_context(accept_downloads=True, viewport={"width": 1400, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    yield page
    assert not errors, errors
    context.close()


def test_config_reaches_the_browser_and_blocks_the_draw(tiny_server, page):
    cfg = json.loads(urllib.request.urlopen(tiny_server + "/api/v1/config").read())
    assert cfg["ui"]["memory"]["heap_gb"] == 0.1
    assert cfg["ui"]["memory"]["enforce"] == "block"
    page.goto(_link(tiny_server))
    page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .coverage-placeholder', timeout=30000)
    text = page.inner_text('.tile[data-tile-id="cell-plot-a"] .coverage-placeholder')
    assert "Needs ~" in text and "of browser JS memory" in text and "free" in text, text
    assert "Close a plot, or show fewer cells" in text, text
    # the way out, offered where the plot would be
    assert page.locator('.tile[data-tile-id="cell-plot-a"] .coverage-placeholder [data-ps-action="subset"]').count() == 1
    assert page.locator('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot').count() == 0
    assert page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return g.ledger.panels().length;
    }""") == 0


def test_warn_draws_and_says_so(warn_server, page):
    page.goto(_link(warn_server))
    _drawn(page, "cell-plot-a")
    tag = page.locator('.tile[data-tile-id="cell-plot-a"] .ps-tag[data-tag="memory"]')
    tag.wait_for(timeout=10000)
    assert tag.inner_text() == "Over the memory budget"


def test_tiles_follow_the_headroom_and_close_frees(server, page):
    page.goto(_link(server))
    _drawn(page, "cell-plot-a")
    create = page.locator('.panel-type-option[data-type="cell-plot"]').last
    create.wait_for(state="attached", timeout=10000)
    assert "memory-blocked" not in (create.get_attribute("class") or "")

    need = page.evaluate(NEW_PLOT_NEED)
    page.evaluate(SET_FREE, need * 0.5)
    page.wait_for_function("""() => [...document.querySelectorAll('.panel-type-option[data-type="cell-plot"]')]
        .every(o => o.classList.contains('memory-blocked'))""", timeout=5000)
    title = create.get_attribute("title")
    assert title.startswith("Needs ~") and "with 2 plots open" in title and "Close a plot" in title, title
    assert create.locator(".memory-note").inner_text() == "Not enough browser memory"
    # the gene plot tile is not a Cell Plot of 200 cells: its own check
    # the duplicate tile of the open plot is refused the same way
    dup = page.locator('.source-panel-option').first
    assert "memory-blocked" in dup.get_attribute("class")
    assert "duplicate it" in dup.get_attribute("title")
    # a click on a refused tile opens nothing
    before = page.locator(".tile[data-tile-id^='cell-plot']").count()
    create.click(force=True)
    page.wait_for_timeout(300)
    assert page.locator(".tile[data-tile-id^='cell-plot']").count() == before

    # close the plot: its WebGL contexts are lost and its share is free again
    page.evaluate("""() => {
        const gd = document.querySelector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot');
        window.__gls = gd._fullLayout._glcanvas.data().filter(d => d.regl).map(d => d.regl._gl);
    }""")
    assert page.evaluate("() => window.__gls.length") == 2
    page.evaluate("() => window.PanelManager.closePanel('cell-plot-a')")
    assert page.evaluate("() => window.__gls.every(gl => gl.isContextLost())")
    assert page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return g.ledger.get('cell-plot-a') === null && g.ledger.plotCount() === 0;
    }""")
    page.wait_for_function("""() => [...document.querySelectorAll('.panel-type-option[data-type="cell-plot"]')]
        .every(o => !o.classList.contains('memory-blocked'))""", timeout=5000)

    # a panel created interactively is in the ledger once drawn (its init and
    # the dataset both start a draw; the first one's end must not lose the second)
    page.evaluate("""() => window.PanelManager.createPanelInLayout('cell-plot', { id: 'cell-plot-n',
        x: { type: 'obsm', key: 'X_umap', column: '0' }, y: { type: 'obsm', key: 'X_umap', column: '1' },
        color: { type: 'obs', key: 'cell_type' } })""")
    _drawn(page, "cell-plot-n")


def test_subset_chips_count_every_open_plot(server, page):
    ids = ("cell-plot-a", "cell-plot-b", "cell-plot-c")
    page.goto(_link(server, ids))
    for pid in ids:
        _drawn(page, pid)
    # a ceiling where, with three plots, 100 cells fit and all 200 do not,
    # and with one plot all 200 do (the fixture's sizes are tiny, so the
    # ceiling sits between the needs of 100 and 200 cells)
    need = page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return [100, 200].map(n => g.subsetCheck(n, 5000000).needBytes);     // already x (1 + margin)
    }""")
    resident = page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return g.ledger.get('cell-plot-b').resident.heap;
    }""")
    free3 = (need[0] + need[1]) / 2
    assert free3 + 2 * resident > need[1] / 3
    page.evaluate(SET_FREE, free3)
    page.click("#subset-button")
    page.wait_for_selector("#subset-preset-all", state="visible")
    page.wait_for_function("() => document.getElementById('subset-preset-all').classList.contains('sp-memory')",
                           timeout=5000)
    chip = page.locator("#subset-preset-all")
    assert chip.locator(".sp-mem").inner_text().startswith("needs ~")
    title = chip.get_attribute("title")
    assert "with 3 plots open" in title and "Close a panel or pick a smaller size" in title, title
    assert page.is_disabled("#subset-n-all")
    # the current spec is every cell: Apply is refused, and the footer says why
    page.wait_for_function("() => document.getElementById('subset-apply').disabled", timeout=5000)
    footer = page.inner_text("#subset-memory")
    assert footer.startswith("200 cells: Needs ~"), footer
    # the presets that fit stay; a smaller size brings Apply back, and the
    # footer gives the headroom
    assert [c["n"] for c in page.evaluate(CHIPS) if c["memory"]] == [None]
    page.click('#subset-presets button[data-n="100"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled", timeout=10000)
    assert page.inner_text("#subset-memory").startswith("Browser memory: ")
    assert "with 3 plots open (estimated)" in page.inner_text("#subset-memory")
    page.click('#subset-modal [data-bs-dismiss="modal"]')
    page.wait_for_selector("#subset-modal", state="hidden")

    page.evaluate("() => { window.PanelManager.closePanel('cell-plot-b'); window.PanelManager.closePanel('cell-plot-c'); }")
    page.click("#subset-button")
    page.wait_for_selector("#subset-preset-all", state="visible")
    page.wait_for_function("() => !document.getElementById('subset-preset-all').classList.contains('sp-memory')",
                           timeout=5000)
    assert "with 1 plot open" in page.inner_text("#subset-memory")


CHIPS = """() => [...document.querySelectorAll('#subset-presets .subset-preset')].map(c => ({
    n: c.dataset.n ? Number(c.dataset.n) : null, memory: c.classList.contains('sp-memory')
}))"""


def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", head[16:24])


def _open_menu(page, pid="cell-plot-a"):
    page.click(f"#aesthetics-menu-btn-{pid}")
    page.wait_for_selector(f"#download-png-{pid}", state="visible")


def test_export_when_it_does_not_fit_offers_the_plot_as_shown(server, page):
    page.goto(_link(server))
    _drawn(page, "cell-plot-a")
    page.evaluate(SET_FREE, 1000)
    _open_menu(page)
    for fmt in ("png", "svg", "jpeg", "webp"):
        assert page.is_disabled(f"#download-{fmt}-cell-plot-a")
    note = page.inner_text(".export-memory-note")
    assert note.startswith("Full resolution: Needs ~") and "Export it as shown instead" in note, note
    shown = page.locator("#download-shown-png-cell-plot-a")
    size = page.evaluate("""() => { const gd = document.querySelector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot');
        return [gd._fullLayout.width * 2, gd._fullLayout.height * 2]; }""")
    assert f"As shown ({size[0]} × {size[1]} px)" in page.inner_text(".export-shown-row")
    with page.expect_download() as dl:
        shown.click()
    path = dl.value.path()
    assert tuple(_png_size(path)) == tuple(size)
    with page.expect_download() as dl:
        page.click("#download-shown-svg-cell-plot-a")
    svg = open(dl.value.path(), encoding="utf-8").read()
    assert svg.startswith("<svg") and "data:image/png;base64" in svg   # the WebGL points as an image
    # the live plot keeps its drag layer (Plotly's own toSVG would remove it)
    assert page.locator('.tile[data-tile-id="cell-plot-a"] .draglayer').count() == 1

    # the modebar camera refuses in the status strip, with "Export as shown"
    page.keyboard.press("Escape")
    page.mouse.click(5, 5)
    page.hover('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot')
    page.click('.tile[data-tile-id="cell-plot-a"] .modebar-btn[data-title="Download plot as a png"]')
    tag = page.locator('.tile[data-tile-id="cell-plot-a"] .ps-tag[data-tag="memory"]')
    tag.wait_for(timeout=5000)
    assert tag.inner_text() == "Not exported: browser memory"
    action = page.locator('.tile[data-tile-id="cell-plot-a"] [data-ps-action="export-shown"]')
    action.wait_for(state="visible", timeout=5000)     # the first refusal opens its popover
    with page.expect_download() as dl:
        action.click()
    assert tuple(_png_size(dl.value.path())) == tuple(size)


def test_full_export_with_room(server, page):
    page.goto(_link(server))
    _drawn(page, "cell-plot-a")
    before = page.evaluate("""() => { const gd = document.querySelector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot');
        return JSON.stringify({ n: gd.data.length, x: Array.from(gd.data[0].x.slice(0, 5)), range: gd.layout.xaxis.range,
                                uid: gd.data.map(t => t.uid) }); }""")
    contexts = page.evaluate("async () => (await import('/static/js/utils/release-plot.js')).liveWebglContexts()")
    _open_menu(page)
    assert not page.is_disabled("#download-png-cell-plot-a")
    assert page.locator(".export-memory-note").count() == 0
    with page.expect_download() as dl:
        page.click("#download-png-cell-plot-a")
    w, h = _png_size(dl.value.path())
    assert (w, h) in ((1200, 800), (2400, 1600)), (w, h)
    with page.expect_download() as dl:
        page.click("#download-svg-cell-plot-a")
    assert open(dl.value.path(), encoding="utf-8").read().startswith("<svg")
    after = page.evaluate("""() => { const gd = document.querySelector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot');
        return JSON.stringify({ n: gd.data.length, x: Array.from(gd.data[0].x.slice(0, 5)), range: gd.layout.xaxis.range,
                                uid: gd.data.map(t => t.uid) }); }""")
    assert after == before
    # the off-screen plots of both exports gave their WebGL contexts back
    assert page.evaluate("async () => (await import('/static/js/utils/release-plot.js')).liveWebglContexts()") == contexts
    assert page.locator("body > div.js-plotly-plot").count() == 0


def test_a_crash_while_drawing_waits_for_draw_anyway(server, page):
    # what a page that died while drawing leaves behind (a page closed on
    # purpose clears it on pagehide): set from a page of the same origin
    page.goto(server + "/static/css/styles.css")
    page.evaluate("""() => localStorage.setItem('annzarro_memory_pending',
        JSON.stringify({ panel: 'cell-plot-a', n: 95624334, action: 'draw', at: Date.now() }))""")
    page.goto(_link(server))
    placeholder = page.locator('.tile[data-tile-id="cell-plot-a"] .coverage-placeholder')
    placeholder.wait_for(timeout=30000)
    assert "ended (most likely out of memory) while it drew this plot of 95,624,334 points" in placeholder.inner_text()
    assert page.locator('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot').count() == 0
    # the crash made the guard more careful in this browser
    assert page.evaluate("() => Number(localStorage.getItem('annzarro_memory_margin'))") == 0.25
    # read once: the marker is gone
    assert page.evaluate("() => localStorage.getItem('annzarro_memory_pending')") is None
    page.click('.tile[data-tile-id="cell-plot-a"] .coverage-placeholder [data-ps-action="draw-anyway"]')
    _drawn(page, "cell-plot-a")


def test_cell_table_renders_only_the_page_shown(server, page):
    table = {"id": "cell-table-t", "pageLength": 25,
             "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                         {"type": "obs", "key": "total_counts", "column": ""}]}
    page.goto(_link(server, ids=(), extra={"cell-table-t": table}))
    page.wait_for_selector('.tile[data-tile-id="cell-table-t"] .dataTables_scrollBody table tbody tr', timeout=30000)
    rows = page.evaluate("""() => {
        const t = jQuery('.tile[data-tile-id="cell-table-t"] .dataTables_scrollBody table').DataTable();
        return { data: t.rows().count(), nodes: t.rows().nodes().toArray().filter(Boolean).length };
    }""")
    assert rows["data"] == 200
    assert rows["nodes"] <= 25, rows
    assert page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        const e = g.ledger.get('cell-table-t');
        return e && e.kind === 'cell-table' && e.n === 200;
    }""")


def test_closing_frees_only_what_is_private(server, page):
    """Closing a panel frees its own drawing, never what other panels read.

    The behaviour kept is the one recorded on v030-preview (9cc53c6) before
    the cleanup changed: a plot filtered by a table keeps showing the rows
    that passed the table after the table is closed, also after it redraws,
    and still lists the table as its filter; the focused cell and the panel
    set outlive the panel they were set in. The table then reopened
    unfiltered (its search was not saved); since T8 it reopens with its
    search, and the plot keeps its cells.
    """
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"id": "cell-plot-B", "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "cell_type", "column": ""}}
    table = {"id": "cell-table-A", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    page.goto(_link(server, ids=(), extra={"cell-plot-B": plot, "cell-table-A": table}))
    _drawn(page, "cell-plot-B")
    page.wait_for_selector('.tile[data-tile-id="cell-table-A"] .dataTables_scrollBody tbody tr', timeout=30000)
    page.select_option('.tile[data-tile-id="cell-plot-B"] select.table-filter-select', "cell-table-A")
    page.click("#remove-non-table-entries-cell-plot-B")
    page.fill('.tile[data-tile-id="cell-table-A"] input[type="search"]', "cell_01")
    strip = '.tile[data-tile-id="cell-plot-B"] .plot-status'
    page.wait_for_function(f"""() => /^100 of 200 cells shown/.test(
        document.querySelector('{strip}')?.getAttribute('data-summary') || '')""", timeout=15000)
    page.evaluate("""async () => {
        const { DataManager } = await import('/static/js/data-manager.js');
        DataManager.setFocusedCell('cell_0150');
    }""")

    page.evaluate("() => window.PanelManager.closePanel('cell-table-A')")
    state = """() => ({
        summary: document.querySelector('%s')?.getAttribute('data-summary') || '',
        options: [...document.querySelectorAll('.tile[data-tile-id="cell-plot-B"] select.table-filter-select option')].map(o => o.value),
        value: document.querySelector('.tile[data-tile-id="cell-plot-B"] select.table-filter-select').value,
        frozen: (() => { const s = window.PanelManager.getPanel('cell-table-A').getConfig();
                         return Array.isArray(s.currentEntries) ? s.currentEntries.length : null; })()
    })""" % strip
    s = page.evaluate(state)
    assert s["summary"].startswith("100 of 200 cells shown"), s
    assert s["options"] == ["none", "cell-table-A"] and s["value"] == "cell-table-A", s
    assert s["frozen"] == 100, s
    # B redrawn from scratch still applies the closed table's rows
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-B').refreshPlot()")
    page.wait_for_timeout(1500)
    s = page.evaluate(state)
    assert s["summary"].startswith("100 of 200 cells shown"), s

    # Reopen: the table comes back with its search (user decision T8, since
    # v030-preview it came back unfiltered), and B still shows its 100 cells
    page.click('.panel-closed-btn[data-id="cell-table-A"]')
    page.wait_for_selector('.tile[data-tile-id="cell-table-A"] .dataTables_scrollBody tbody tr', timeout=30000)
    assert "of 100 entries" in page.inner_text('.tile[data-tile-id="cell-table-A"] .dataTables_info')
    page.wait_for_function(f"""() => /^100 of 200 cells shown/.test(
        document.querySelector('{strip}')?.getAttribute('data-summary') || '')""", timeout=15000)

    # close the plot: its memory and WebGL contexts go, the focus and the panel set stay
    page.evaluate("""() => {
        const gd = document.querySelector('.tile[data-tile-id="cell-plot-B"] .js-plotly-plot');
        window.__gls = gd._fullLayout._glcanvas.data().filter(d => d.regl).map(d => d.regl._gl);
    }""")
    page.evaluate("() => window.PanelManager.closePanel('cell-plot-B')")
    assert page.evaluate("() => window.__gls.length === 2 && window.__gls.every(gl => gl.isContextLost())")
    assert page.evaluate("""async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        const { DataManager } = await import('/static/js/data-manager.js');
        return g.ledger.get('cell-plot-B') === null && DataManager.getFocusedCell() === 'cell_0150';
    }""")
    # the closed plot is still offered for Reopen and saved with the panel set
    assert page.locator('.panel-closed-btn[data-id="cell-plot-B"]').count() == 1
    page.wait_for_function("""() => Object.keys(localStorage).some(k => /autosave/.test(k)
        && /cell-plot-B/.test(localStorage.getItem(k)))""", timeout=20000)
    # Reopen B: drawn again from its settings, with the table filter
    page.click('.panel-closed-btn[data-id="cell-plot-B"]')
    _drawn(page, "cell-plot-B")
    assert page.input_value('.tile[data-tile-id="cell-plot-B"] select.table-filter-select') == "cell-table-A"
