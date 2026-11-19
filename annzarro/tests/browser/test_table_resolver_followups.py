"""Follow-ups to the background recompute of closed tables (utils/table-resolver.js).

1. Gene Set Analysis asks the resolver for a restored closed table, as a plot does, and says the same
   things (building, Build filter, refused, failed).
2. Cancel: the building state offers Cancel, which stops the load phase and returns to Build filter.
   The last step (filter and release) cannot be stopped; the notice says so while it runs.
3. A crafted link whose tables depend on each other shows the cycle state and builds nothing.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI),
where a missing Playwright is an error.
"""
import json
import time

import pytest

from annzarro.tests.browser.test_gene_set_panel import (  # noqa: F401  (fixtures and helpers)
    GS, Services, _link as gs_link, _open, bar, browser, server as gs_server, state, until as gs_until)
from annzarro.tests.browser.test_table_resolver import (  # noqa: F401
    HOLD, PASS, PASS0, _link, builds, instrument, large_server, playwright, resolver, server, shown,
    tile, plot_id, table_id, wait_names, wait_notice)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

GENE_HOLD = "window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };"


@pytest.fixture
def gs_env(browser, gs_server):
    context, page, services, errors = _open(browser, gs_server)
    yield page, services, gs_server
    assert not errors, errors
    assert not services.unmocked, services.unmocked
    context.close()


@pytest.fixture
def page(browser, server):
    context = browser.new_context(viewport={"width": 1500, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    yield page
    assert not errors, errors
    context.close()


# ------------------------------------------------------------ Gene Set Analysis

def test_gene_set_analysis_gets_a_restored_closed_table_by_itself(gs_env):
    page, services, root = gs_env
    page.goto(gs_link(root, table_open=False))
    gs_until(page, "() => { const p = window.PanelManager.getPanel('gene-set-G'); return p && p._debugState().source.count === 10; }")
    s = state(page)
    assert s["source"]["status"] == "closed" and s["gate"] is None
    assert not bar(page).startswith("Waiting")
    assert page.evaluate("async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.buildsStarted") == 1
    assert services.calls == [], "building the selection sends nothing"


def test_gene_set_analysis_says_build_filter_and_builds_on_the_click(gs_env):
    page, services, root = gs_env
    page.add_init_script(GENE_HOLD)
    page.goto(gs_link(root, table_open=False))
    gs_until(page, "() => window.PanelManager.getPanel('gene-set-G')?._debugState().gate === 'resolver'")
    assert "Building 'Gene Table 1' will pause the page for a few seconds." in bar(page)
    assert state(page)["source"]["count"] == 0
    assert page.evaluate("async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.buildsStarted") == 0
    page.click(f'{GS} .gs-bar__actions button:has-text("Build filter")')
    gs_until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 10")
    assert state(page)["gate"] is None


def test_gene_set_analysis_shows_a_refused_table(gs_env):
    page, services, root = gs_env
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 1, ASK_ROWS: 5 };")
    page.goto(gs_link(root, table_open=False))
    gs_until(page, "() => window.PanelManager.getPanel('gene-set-G')?._debugState().gate === 'resolver'")
    text = bar(page)
    assert "too large to build here" in text and "Open the table to filter by it." in text
    assert page.locator(f'{GS} .gs-bar__actions button:has-text("Build filter")').count() == 0
    assert page.locator(f'{GS} .gs-bar__actions button:has-text("Open table")').count() == 1


def test_gene_set_analysis_cancels_a_build(gs_env):
    page, services, root = gs_env
    page.goto(gs_link(root, table_open=False, search="GENE00"))
    # slow the build the page starts: wrap the host before the first update reads the table
    gs_until(page, "() => window.PanelManager.getPanel('gene-set-G')?._debugState().source.count === 10")
    page.evaluate("""async () => {
        const { TableResolver } = await import('/static/js/utils/table-resolver.js');
        const h = TableResolver.host;
        TableResolver.host = { ...h, build: async (job) => { await new Promise(r => setTimeout(r, 4000)); return h.build(job); } };
        window.PanelManager.getPanel('gene-table-A').setClosedSelection(null);
        window.PanelManager.getPanel('gene-set-G').onDataUpdate('tableFiltered', { id: 'gene-table-A' });
    }""")
    gs_until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'gene-table-A'")
    gs_until(page, "() => /Building 'Gene Table 1'/.test(document.querySelector('.tile[data-tile-id=\"gene-set-G\"] .gs-bar__text')?.innerText || '')")
    page.click(f'{GS} .gs-bar__actions button:has-text("Cancel")')
    gs_until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().gate === 'resolver'")
    assert "will pause the page" in bar(page)
    assert page.locator(f'{GS} .gs-bar__actions button:has-text("Build filter")').count() == 1


# ------------------------------------------------------------------ Cancel on a plot

SLOW = """async ([delay, hold]) => {
    const { TableResolver } = await import('/static/js/utils/table-resolver.js');
    const h = TableResolver.host;
    const b = window.__builds = { started: 0, signals: [] };
    TableResolver.host = { ...h, build: async (job) => {
        b.started++; b.signals.push(job.signal);
        if (delay) await new Promise(r => setTimeout(r, delay));
        const enter = job.enter;
        return h.build({ ...job, enter: hold ? async () => { await enter(); await new Promise(r => setTimeout(r, hold)); } : enter });
    } };
}"""


def test_cancel_stops_the_load_and_returns_to_build_filter(page, server):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };")
    page.goto(_link(server))
    wait_notice(page)
    page.evaluate(SLOW, [4000, 0])
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="build-filter"]')
    until(page, f"() => /^Filter not applied yet\\nBuilding 'Table 1'\\./.test(document.querySelector('{tile(plot_id(0))} .filter-notice')?.innerText || '')")
    s = shown(page)
    assert "cancel-filter" in s["actions"] and "reopen-table" in s["actions"] and "table-filter-off" in s["actions"]
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="cancel-filter"]')
    until(page, f"() => document.querySelector('{tile(plot_id(0))} .filter-notice [data-ps-action=\"build-filter\"]')")
    assert page.evaluate("() => window.__builds.signals[0].aborted") is True
    s = shown(page)
    assert s["names"] == [] and "will pause the page" in s["notice"]
    page.wait_for_timeout(1000)
    assert page.evaluate("() => window.__builds.started") == 1, "a cancelled build does not restart by itself"
    # Build filter builds again
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="build-filter"]')
    wait_names(page, PASS)
    assert page.evaluate("() => window.__builds.started") == 2


def test_cancel_stays_available_in_the_automatic_tier(page, server):
    page.goto(_link(server))
    wait_names(page, PASS)
    page.evaluate(SLOW, [4000, 0])
    page.evaluate("""() => { window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null);
        window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' }); }""")
    until(page, f"() => document.querySelector('{tile(plot_id(0))} .filter-notice [data-ps-action=\"cancel-filter\"]')")
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="cancel-filter"]')
    until(page, f"() => document.querySelector('{tile(plot_id(0))} .filter-notice [data-ps-action=\"build-filter\"]')")


def test_the_last_step_cannot_be_cancelled_and_says_so(page, server):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };")
    page.goto(_link(server))
    wait_notice(page)
    page.evaluate(SLOW, [0, 2500])
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="build-filter"]')
    until(page, f"() => /cannot be cancelled/.test(document.querySelector('{tile(plot_id(0))} .filter-notice')?.innerText || '')")
    s = shown(page)
    assert "cancel-filter" not in s["actions"]
    assert "Filtering 'Table 1'." in s["notice"]
    assert resolver(page, "(r) => r.cancel('cell-table-t0')") is False
    wait_names(page, PASS)
    assert page.evaluate("() => window.__builds.signals[0].aborted") is False


# ------------------------------------------------------------------ cycles

def test_a_crafted_cyclic_link_shows_the_cycle_and_builds_nothing(page, server):
    page.goto(_link(server, tables=(("cell_01", False), ("cell_00", False)),
                    table_extra={0: {"tableFilter": table_id(1)}, 1: {"tableFilter": table_id(0)}}))
    wait_notice(page)
    s = shown(page)
    assert s["names"] == []
    assert "'Table 1' and 'Table 2' depend on each other." in s["notice"]
    assert "reopen-table" in s["actions"] and "table-filter-off" in s["actions"] and "build-filter" not in s["actions"]
    assert s["unresolved"].startswith("'Table 1' and 'Table 2' depend on each other.")
    page.wait_for_timeout(1500)
    assert resolver(page, "(r) => r.buildsStarted") == 0
    assert resolver(page, "(r) => r.status('cell-table-t0').state") == "cycle"
    # Stop filtering ends it
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="table-filter-off"]')
    page.wait_for_selector(f"{tile(plot_id(0))} .filter-notice", state="detached", timeout=20000)


def test_a_chain_without_a_cycle_is_built(page, server):
    page.goto(_link(server, tables=(("cell_01", False), ("cell_00", False)), table_extra={0: {"tableFilter": table_id(1)}}))
    wait_names(page, PASS)
    assert resolver(page, "(r) => r.buildsStarted") == 1
