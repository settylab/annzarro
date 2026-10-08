"""A panel that loads for long can be stopped, and a newer view stops the older load.

Opens the committed fixture (200 cells) and holds every data request in the
page for a while (a slow connection) to make loads long. Checks that

  - the loading overlay offers Cancel only after a moment (1.5 s);
  - Cancel aborts the panel's requests, starts no new one, and leaves the
    previous plot with a tag, or a placeholder with Load when there was none;
    Load then reads the data again; a table does the same;
  - changing the colour while the plot loads aborts the load that was
    running, so the final plot has the new colour, whichever load is slower
    (also when the running load is a whole-plot load);
  - closing a loading panel aborts its requests while another panel, which
    shares some of them, goes on.

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1. Screenshots go to $ANNZARRO_E2E_SHOTS when set.
"""
import base64
import json
import os

from .test_subset_parts_browser import (  # noqa: F401  (server is a fixture)
    _skip_or_fail, server, sync_api)

UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
SHOTS = os.environ.get("ANNZARRO_E2E_SHOTS")
CELL_TYPES, LEIDEN = {"Endothelial", "Hepatocyte", "Kupffer"}, {"0", "1", "2", "3", "4"}

# The page's data requests (not the dataset's own: names, subset, store checks), held for
# window.__hold(url) ms before they are sent; each call is recorded with whether
# its AbortSignal fired. An abort during the hold sends nothing at all.
HOLD = """() => {
  const real = window.fetch.bind(window);
  window.__net = [];
  window.__hold = () => window.__initialHold || 0;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const ms = /\\/api\\/v1\\/data\\//.test(url) && !/\\/data\\/(names|cells|genes|refresh|fingerprint|dataset_structure|subset)/.test(url) ? window.__hold(url) : 0;
    if (!ms) return real(input, init);
    const rec = { url, aborted: false, settled: false, sent: false };
    window.__net.push(rec);
    const signal = init && init.signal;
    return new Promise((resolve, reject) => {
      const stop = () => { rec.aborted = true; rec.settled = true; clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); };
      const timer = setTimeout(() => {
        rec.sent = true;
        real(input, init).then(r => { rec.settled = true; resolve(r); }, e => { rec.settled = true; reject(e); });
      }, ms);
      if (signal) { if (signal.aborted) return stop(); signal.addEventListener('abort', () => { if (!rec.settled) stop(); }, { once: true }); }
    });
  };
}"""

STATE = """(id) => { const g = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
  const d = g && g._fullData ? g._fullData.filter(t => t.name !== 'Focused Cell' && t.meta !== 'az-legend') : [];
  return { drawn: d.length > 0, n: d.reduce((s, t) => s + (t.x ? t.x.length : 0), 0),
           numeric: d.some(t => t.marker && Array.isArray(t.marker.color) && typeof t.marker.color[0] === 'number'),
           names: d.map(t => t.name) }; }"""


def _link(base, dataset, colours, table=False):
    """Cell plots (id -> colour obs key) side by side, and a cell table below."""
    plots = {pid: {"id": pid, "title": pid, **UMAP, "z": None, "color": {"type": "obs", "key": key, "column": ""}}
             for pid, key in colours.items()}
    tiles = [{"type": "tile", "id": pid} for pid in plots]
    row = {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(tiles)}] * len(tiles),
           "children": tiles} if len(tiles) > 1 else tiles[0]
    configs = dict(plots)
    if table:
        row = {"type": "split", "direction": "vertical", "panes": [{"percentage": 50}] * 2,
               "children": [row, {"type": "tile", "id": "cell-table-A"}]}
        configs["cell-table-A"] = {"id": "cell-table-A", "title": "cell-table-A",
                                   "columns": [{"type": "obs", "key": "leiden", "column": ""}]}
    layout = {"v": 1, "hierarchy": [row], "controlState": {}, "panelConfigs": configs}
    view = {"v": 1, "subset": None, "layout": layout}
    return (f"{base}/?dataset_path={dataset}#view="
            + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))


class _Page:
    def __init__(self, pw, base, dataset, colours, table=False, initial_hold=0, large_above=None):
        try:
            self.browser = pw.chromium.launch()
        except Exception as exc:
            _skip_or_fail(f"Chromium cannot start: {exc}")
        self.page = self.browser.new_page(viewport={"width": 1600, "height": 900})
        self.requests = []          # data requests that reached the network
        self.page.on("request", lambda r: self.requests.append(r.url) if "/api/v1/data/" in r.url else None)
        if large_above is not None:          # large-plot mode from this many cells on
            def patch(route):
                config = route.fetch().json()
                ui = dict(config.get("ui") or {})
                ui["defaults"] = {**(ui.get("defaults") or {}), "large_plot_points": large_above}
                route.fulfill(json={**config, "ui": ui})
            self.page.route("**/api/v1/config", patch)
        self.page.add_init_script(f"window.__initialHold = {initial_hold};")
        self.page.add_init_script(f"window.addEventListener('DOMContentLoaded', ({HOLD}));")
        self.page.goto(_link(base, dataset, colours, table))
        self.ids = list(colours)
        if not initial_hold:
            self.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            for pid in self.ids:
                self.wait_drawn(pid)

    def state(self, pid):
        return self.page.evaluate(STATE, pid)

    def wait_drawn(self, pid, timeout=40_000):
        self.page.wait_for_function(f"(id) => ({STATE})(id).drawn", arg=pid, timeout=timeout)
        self.page.wait_for_timeout(500)

    def hold(self, ms, only=None):
        """Hold the data requests (those whose URL contains `only`) for `ms`."""
        cond = f"u.includes({json.dumps(only)})" if only else "true"
        self.page.evaluate(f"() => {{ window.__hold = u => ({cond}) ? {ms} : 0; window.__net = []; }}")
        self.requests.clear()

    def net(self):
        return self.page.evaluate("() => window.__net")

    def overlay(self, pid):
        return self.page.locator(f'.tile[data-tile-id="{pid}"] .loading-overlay')

    def cancel_button(self, pid):
        return self.page.locator(f'.tile[data-tile-id="{pid}"] .loading-overlay .load-cancel').last

    def refresh(self, pid):
        self.page.evaluate("""async (id) => {
            const { DataManager } = await import('/static/js/data-manager.js');
            DataManager.clearDatasetCache();               // the browser's copies, or the load reads none
            PanelManager.getPanel(id).refreshPlot();
        }""", pid)

    def pick_colour(self, pid, key):
        self.page.select_option(f'.tile[data-tile-id="{pid}"] .axis-key-select[data-axis="color"]', key, force=True)

    def shot(self, name, tile=None):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            target = self.page.locator(f'.tile[data-tile-id="{tile}"]') if tile else self.page
            target.screenshot(path=os.path.join(SHOTS, name))

    def close(self):
        self.browser.close()


def test_cancel_button_shows_only_after_a_moment(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"})
        try:
            s.hold(6000)
            s.refresh("cell-plot-A")
            s.overlay("cell-plot-A").first.wait_for(timeout=5000)
            s.page.wait_for_timeout(400)
            assert not s.cancel_button("cell-plot-A").is_visible(), "Cancel is shown at once; a quick load would flash it"
            s.cancel_button("cell-plot-A").wait_for(state="visible", timeout=4000)
            s.shot("cancel-button.png", "cell-plot-A")
        finally:
            s.close()


def test_cancel_aborts_requests_keeps_the_plot_and_load_reads_again(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"})
        try:
            before = s.state("cell-plot-A")
            s.hold(8000)
            s.refresh("cell-plot-A")
            s.cancel_button("cell-plot-A").wait_for(state="visible", timeout=6000)
            held = s.net()
            assert held, "the refresh sent no data request; this tests nothing"
            s.requests.clear()
            s.cancel_button("cell-plot-A").click()
            s.page.wait_for_timeout(1500)
            net = s.net()
            assert [r["url"] for r in net if not r["aborted"] and not r["settled"]] == [], "requests still running after Cancel"
            assert all(r["aborted"] for r in net[:len(held)]), \
                f"not aborted: {[r['url'][-70:] for r in net[:len(held)] if not r['aborted']]}"
            assert len(net) == len(held), "Cancel started new requests"
            assert s.requests == [], f"data requests were sent after Cancel: {s.requests}"
            assert s.overlay("cell-plot-A").count() == 0, "the overlay is still up"
            assert s.state("cell-plot-A") == before, "the previous plot is not kept"
            tag = s.page.locator('.tile[data-tile-id="cell-plot-A"] .ps-tag[data-tag="cancelled"]')
            assert tag.count() == 1, "the panel does not say loading was cancelled"
            s.shot("cancelled-plot-kept.png", "cell-plot-A")
            # nothing arrives late and changes the panel
            s.page.wait_for_timeout(8000)
            assert s.state("cell-plot-A") == before
            # Load reads the data again
            s.hold(0)
            tag.first.click()
            s.page.locator('.ps-action[data-ps-action="redraw"]').first.click()
            s.page.wait_for_function("() => !document.querySelector('[data-tag=\"cancelled\"]')", timeout=20_000)
            s.wait_drawn("cell-plot-A")
            assert s.state("cell-plot-A")["drawn"]
        finally:
            s.close()


def test_cancel_on_the_first_load_leaves_placeholders_with_load(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"}, table=True, initial_hold=20_000)
        try:
            s.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            plot_cancel = s.cancel_button("cell-plot-A")
            plot_cancel.wait_for(state="visible", timeout=10_000)
            table_cancel = s.page.locator('.tile[data-tile-id="cell-table-A"] .load-cancel')
            table_cancel.wait_for(state="visible", timeout=10_000)
            s.shot("cancel-button-table.png", "cell-table-A")
            plot_cancel.click()
            table_cancel.click()
            for tile in ("cell-plot-A", "cell-table-A"):
                s.page.wait_for_selector(f'.tile[data-tile-id="{tile}"] .coverage-placeholder', timeout=5000)
                text = s.page.inner_text(f'.tile[data-tile-id="{tile}"] .coverage-placeholder')
                assert "cancelled" in text.lower(), f"{tile}: {text!r}"
                assert s.page.locator(f'.tile[data-tile-id="{tile}"] .ps-action[data-ps-action="redraw"]').count() == 1
            s.shot("cancelled-placeholder-plot.png", "cell-plot-A")
            s.shot("cancelled-placeholder-table.png", "cell-table-A")
            s.page.evaluate("() => { window.__initialHold = 0; }")
            for tile in ("cell-plot-A", "cell-table-A"):
                s.page.locator(f'.tile[data-tile-id="{tile}"] .ps-action[data-ps-action="redraw"]').click()
            s.wait_drawn("cell-plot-A")
            s.page.wait_for_selector('.tile[data-tile-id="cell-table-A"] .dt-info, .tile[data-tile-id="cell-table-A"] .dataTables_info',
                                     timeout=20_000)
        finally:
            s.close()


def test_a_newer_colour_aborts_the_older_load_and_wins(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"})
        try:
            s.hold(3000, only="cell_type")             # the older choice is the slow one
            s.pick_colour("cell-plot-A", "cell_type")
            s.page.wait_for_timeout(300)
            s.pick_colour("cell-plot-A", "total_counts")
            s.page.wait_for_function(f"(id) => ({STATE})(id).numeric", arg="cell-plot-A", timeout=20_000)
            s.page.wait_for_timeout(5000)              # the slow reply would be here by now
            assert s.state("cell-plot-A")["numeric"], "the older colour was drawn over the newer"
            older = [r for r in s.net() if "cell_type" in r["url"]]
            assert older and all(r["aborted"] for r in older), "the older colour's request was not aborted"
        finally:
            s.close()


def test_a_colour_change_during_a_whole_plot_load_is_not_overwritten(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"})
        try:
            s.hold(3000, only="leiden")                # the whole load, which reads leiden
            s.refresh("cell-plot-A")
            s.page.wait_for_timeout(500)
            s.pick_colour("cell-plot-A", "cell_type")
            s.page.wait_for_timeout(6000)              # the whole load would be done by now
            names = set(map(str, s.state("cell-plot-A")["names"]))
            assert names & CELL_TYPES and not names & LEIDEN, f"the plot is coloured by {sorted(names)}, not by cell_type"
        finally:
            s.close()


def test_closing_a_loading_panel_aborts_its_requests_and_the_other_goes_on(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden", "cell-plot-B": "cell_type"})
        try:
            s.hold(4000)
            s.refresh("cell-plot-A")
            s.refresh("cell-plot-B")
            s.page.wait_for_timeout(600)
            s.page.evaluate("""() => document.querySelector('.tile[data-tile-id="cell-plot-A"] .tile-close').click()""")
            s.page.wait_for_timeout(6000)
            net = s.net()
            mine = [r for r in net if "leiden" in r["url"]]
            theirs = [r for r in net if "cell_type" in r["url"]]
            shared = [r for r in net if "X_umap" in r["url"]]
            assert mine and all(r["aborted"] for r in mine), "the closed panel's request was not aborted"
            assert theirs and not any(r["aborted"] for r in theirs), "the other panel's request was aborted"
            assert shared and not any(r["aborted"] for r in shared), "a request the other panel needs was aborted"
            assert s.state("cell-plot-B")["drawn"]
        finally:
            s.close()


def test_cancel_stops_a_large_plot_load_before_it_draws(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, {"cell-plot-A": "leiden"}, initial_hold=8000, large_above=50)
        try:
            s.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            s.cancel_button("cell-plot-A").wait_for(state="visible", timeout=10_000)
            # (the focused cell's name probe, columns=_index, is not the plot's)
            def own():
                return [r for r in s.net() if "columns=_index" not in r["url"]]
            held = len(own())
            assert held, "the large plot sent no data request; this tests nothing"
            s.requests.clear()
            s.cancel_button("cell-plot-A").click()
            s.page.wait_for_selector('.tile[data-tile-id="cell-plot-A"] .coverage-placeholder', timeout=5000)
            s.page.wait_for_timeout(1500)
            assert all(r["aborted"] for r in own()), \
                f"not aborted: {[r['url'][-70:] for r in own() if not r['aborted']]}"
            assert len(own()) == held and not [u for u in s.requests if "columns=_index" not in u], "Cancel started new requests"
            s.page.wait_for_timeout(8000)      # nothing arrives late and draws the plot
            assert not s.state("cell-plot-A")["drawn"]
            s.page.evaluate("() => { window.__initialHold = 0; }")
            s.page.locator('.tile[data-tile-id="cell-plot-A"] .ps-action[data-ps-action="redraw"]').click()
            s.wait_drawn("cell-plot-A")
            assert s.page.evaluate("() => document.querySelector('.tile[data-tile-id=\"cell-plot-A\"] .js-plotly-plot').__isLarge"), \
                "the plot is not drawn in large-plot mode; this tests nothing"
        finally:
            s.close()
