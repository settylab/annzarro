"""The memory guard's buffer ceiling and its fresh answers, in a real browser.

The operator's reports on 0.6.0 (a Mac with 128 GB):

1. Six Cell Plots of 100,000 cells on a 95.6M-cell dataset: the subset
   dialog let every cell through. The RAM budget (the computer's memory
   less a reserve) fits six plots of ~7 GB; the tab's ArrayBuffers (16.6 GB
   in Chrome, about 15 GB in Safari) do not. The dialog now checks the
   buffers of all plots together, says so ("of buffers") and gives the
   largest size that fits.
2. After closing the only plot, a new Cell Plot was refused ("Not enough
   browser memory") even at 100,000 cells. Two faults: the allocation probe's
   verdict was inverted (a browser that gave the bytes was told it could
   not), and the create tiles were asked again only when a panel changed, not
   when the subset did.
3. A refusal names the ceiling that binds.

The fixture's 200 cells stand in for millions: the ceilings are set from
what the ledger holds at that moment (Config.DEFAULTS.MEMORY), as in
test_memory_guard.py. Chromium, and WebKit where the engine matters (it
gets Safari's ceiling) when Playwright has it.
"""
import pytest

from annzarro.tests.browser.test_memory_guard import (  # noqa: F401  (fixtures)
    playwright, server, large_server, _link, _drawn, until, SET_FREE, REFUSING_ALLOCATOR,
)


@pytest.fixture(params=["chromium", "webkit"])
def engine_page(request):
    with playwright.sync_playwright() as p:
        try:
            b = getattr(p, request.param).launch()
        except Exception as e:  # WebKit is not installed everywhere
            if request.param == "chromium":
                raise
            pytest.skip(f"{request.param} not available: {e}")
        context = b.new_context(viewport={"width": 1400, "height": 1000})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.engine = request.param
        try:
            yield page
            assert not errors, errors
        finally:
            b.close()


# A buffer ceiling with exactly `free` bytes left after what the ledger holds,
# and RAM and heap ceilings far above anything (so the buffers bind).
SET_BUFFERS_FREE = """async (free) => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    g.held();
    const held = g.ledger.buffers();
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), heap_gb: 1000, total_gb: 1000,
        buffers_gb: (held + free) / m.GB, margin: 0.2 };
    document.dispatchEvent(new CustomEvent(g.MEMORY_EVENT));
    return held;
}"""

# What a subset change to n cells adds in buffers, all open plots together (with the margin).
SUBSET_BUFFERS = """async (n) => {
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    const { Config } = await import('/static/js/config.js');
    const b = m.predictSubsetBuffers(n, g.ledger.panels(), Config.DEFAULTS.LARGE_PLOT_POINTS, g.ledger.model, p => !p.threeD);
    return (b.peak - b.before) * (1 + g.settings().margin);
}"""


def _apply_subset(page, n):
    page.click("#subset-button")
    page.wait_for_selector("#subset-modal", state="visible")
    page.click(f'#subset-presets button[data-n="{n}"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled", timeout=10000)
    page.click("#subset-apply")
    page.wait_for_function("(n) => new RegExp('^' + n + ' of 200').test((document.getElementById('cell-count') || {}).textContent || '')",
                           arg=n, timeout=30000)
    until(page, """async (n) => { const g = await import('/static/js/utils/memory-guard-ui.js');
        return g.ledger.panels().every(e => e.n === n) && !g.ledger.pending.size; }""", n)


def test_subset_counts_the_buffers_of_every_plot(large_server, engine_page):
    page = engine_page
    ids = ("cell-plot-a", "cell-plot-b", "cell-plot-c")
    page.goto(_link(large_server, ids))
    for pid in ids:
        _drawn(page, pid)
    # 100 cells first: regular plots (large-plot mode above 100), which every cell turns large
    _apply_subset(page, 100)
    for pid in ids:
        _drawn(page, pid)
    # the engine's own ceiling, before any setting: Safari's is not Chrome's
    source = page.evaluate("async () => (await import('/static/js/utils/memory-guard-ui.js')).limits().buffers.source")
    assert ("Safari" in source) == (page.engine == "webkit"), source
    # the fixture's sizes are tiny (a regular plot's 160 B a point outweigh large-plot
    # mode's here): a ceiling just below what every cell adds, all three plots together
    need = page.evaluate(SUBSET_BUFFERS, 200)
    page.evaluate(SET_BUFFERS_FREE, need * 0.9)
    r = page.evaluate("""async () => { const g = await import('/static/js/utils/memory-guard-ui.js');
        const r = g.subsetCheck(200, 100); return [r.fits, r.binding, r.why]; }""")
    assert r[0] is False and r[1] == "buffers" and "of browser buffers" in r[2] and "with 3 plots open" in r[2], r
    page.click("#subset-button")
    page.wait_for_selector("#subset-preset-all", state="visible")
    page.wait_for_function("() => document.getElementById('subset-preset-all').classList.contains('sp-memory')", timeout=15000)
    chip = page.locator("#subset-preset-all")
    assert chip.locator(".sp-mem").inner_text().endswith("of buffers")
    assert "browser buffers" in chip.get_attribute("title")
    # 200 cells typed: Apply is refused, and the footer names the buffers
    page.fill("#subset-n", "200")
    page.wait_for_function("() => /^200 cells: /.test(document.getElementById('subset-memory').textContent)", timeout=15000)
    assert page.is_disabled("#subset-apply")
    footer = page.inner_text("#subset-memory")
    assert footer.startswith("200 cells: Needs ~") and "browser buffers" in footer, footer
    page.click('#subset-modal [data-bs-dismiss="modal"]')
    page.wait_for_selector("#subset-modal", state="hidden")
    # with room for it, every cell fits again
    page.evaluate(SET_BUFFERS_FREE, need * 1.1)
    assert page.evaluate("async () => (await import('/static/js/utils/memory-guard-ui.js')).subsetCheck(200, 100).fits")

def test_a_crash_with_buffers_lowers_the_ceiling(server, engine_page):
    """The crash marker of a draw near the buffer ceiling carries the buffers;
    the next page keeps them as this browser's ceiling, so the same plots at
    the same size are not offered as fitting again."""
    first = engine_page
    first.goto(server + "/")
    first.evaluate("""() => localStorage.setItem('annzarro_memory_pending', JSON.stringify(
        { panel: 'cell-plot-x', n: 95624334, action: 'draw', page: 'gone', at: Date.now(), buffers: 3e9 }))""")
    # a second page of the same browser (a reload would clear the marker: a page left on purpose did not crash)
    page = first.context.new_page()
    page.goto(server + "/")
    got = until(page, """async () => { const g = await import('/static/js/utils/memory-guard-ui.js');
        const l = g.limits(); return l && [l.buffers.bytes, l.buffers.source, localStorage.getItem('annzarro_memory_buffers'),
            g.settings().margin]; }""")
    assert got[0] == 3e9 and "ended a page" in got[1] and got[2] == "3000000000", got
    assert abs(got[3] - 0.45) < 1e-9, got        # and the learned margin


def test_the_probe_refuses_only_what_the_browser_does_not_give(server, engine_page):
    """0.4.2 to 0.6.0 refused every probed step the browser could hold (and
    let through the ones it could not): a new large plot of every cell of a
    95.6M-cell dataset was refused on an empty page."""
    page = engine_page
    page.goto(_link(server))
    _drawn(page, "cell-plot-a")
    CHECK = """async () => { const g = await import('/static/js/utils/memory-guard-ui.js');
        const { Config } = await import('/static/js/config.js');
        Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), total_gb: 1000, buffers_gb: 1000 };
        g.freshProbes();
        const r = g.newPanelCheck('cell-plot', { n: 5000000, large: true });      // ~400 MB: probed
        return [r.fits, r.binding, r.why]; }"""
    assert page.evaluate(CHECK) == [True, None, ""]
    page.evaluate(f"({REFUSING_ALLOCATOR})()")
    r = page.evaluate(CHECK)
    assert r[0] is False and r[1] == "alloc" and "cannot allocate" in r[2], r


def test_create_tile_follows_the_subset_with_no_panel_open(server, engine_page):
    """A create tile refused at every cell is asked again when the subset
    shrinks, though no panel changed, and names the ceiling that binds."""
    page = engine_page
    page.goto(_link(server))
    _drawn(page, "cell-plot-a")
    page.evaluate("() => window.PanelManager.closePanel('cell-plot-a')")
    # past the checks a close asks again by itself (memory-guard-ui.js _recheckSoon)
    page.wait_for_timeout(8500)
    create = page.locator('.panel-type-option[data-type="cell-plot"]').last
    create.wait_for(state="attached", timeout=10000)
    # room for a new plot of 150 cells: 200 do not fit, 100 do
    need150 = page.evaluate("""async () => { const m = await import('/static/js/utils/memory-guard.js');
        return m.panelCost({ kind: 'cell-plot', n: 150, colour: 'numeric' }).peak.heap * 1.2; }""")
    page.evaluate(SET_FREE, need150)
    page.wait_for_function("""() => [...document.querySelectorAll('.panel-type-option[data-type="cell-plot"]')]
        .every(o => o.classList.contains('memory-blocked'))""", timeout=15000)
    assert create.locator(".memory-note").inner_text() == "Not enough JS memory"
    # the cells change and nothing else does (no dialog asking the guard, no panel)
    page.evaluate("""async () => { const { DataManager } = await import('/static/js/data-manager.js');
        DataManager.setSubsetRequest({ n: 100, seed: 0 }); await DataManager.reloadSubset(); }""")
    page.wait_for_function("""() => [...document.querySelectorAll('.panel-type-option[data-type="cell-plot"]')]
        .every(o => !o.classList.contains('memory-blocked'))""", timeout=15000)
    assert create.locator(".memory-note").count() == 0
