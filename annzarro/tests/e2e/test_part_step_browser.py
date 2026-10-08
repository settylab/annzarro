"""Stepping through the parts of a subset of a very large dataset.

On a 1B-cell store one new part took 30-70 s: the cell names of its 100,000
cells were read from every chunk of obs/_index, nothing on the screen said
that anything happened, extra clicks queued full loads, and a click during a
dataset load closed every panel. These tests use the committed 200-cell
fixture with the thresholds lowered, so "a very large dataset" is one of 200
cells (``ui.defaults.names_on_demand_above``), and hold the data requests in
the page to make loads long. They check that

  - the names of a part are not downloaded for a very large dataset, and
    hover, click (focus) and the cell table still show the right names, a
    table reading the names of the page it shows and every name only when
    searched on the names;
  - the box and arrows show the part asked for at once, every panel says
    "Loading part N..." over the plot that stays, and clicking on loads only
    the last part;
  - a part step during a dataset load does not close the panels;
  - the dataset picker keeps the open dataset (Refresh twice, a link to a
    dataset that is not first in the list).

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1. Screenshots go to $ANNZARRO_E2E_SHOTS when set.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

from .test_subset_parts_browser import (  # noqa: F401
    FIXTURE, HERE, _free_port, _skip_or_fail, sync_api)

UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
# what the plot of a tile shows: drawn, points, numeric colour
STATE = """(id) => { const g = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
  const d = g && g._fullData ? g._fullData.filter(t => t.name !== 'Focused Cell' && t.meta !== 'az-legend') : [];
  return { drawn: d.length > 0, n: d.reduce((s, t) => s + (t.x ? t.x.length : 0), 0) }; }"""

SHOTS = os.environ.get("ANNZARRO_E2E_SHOTS")
N_CELLS, N_PART = 200, 60

# Every data request of the page waits window.__delay ms before it is sent
# (an abort during the wait sends nothing); `sent` lists what was sent.
DELAY = """() => {
  const real = window.fetch.bind(window);
  window.__delay = 0;
  window.__held = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const ms = /\\/api\\/v1\\/(data\\/(subset(?!\\/locate)|obsm|obs|cells|genes|names|refresh|dataset_structure)|datasets)/.test(url) ? window.__delay : 0;
    if (!ms) return real(input, init);
    const rec = { url, aborted: false };
    window.__held.push(rec);
    const signal = init && init.signal;
    return new Promise((resolve, reject) => {
      const stop = () => { rec.aborted = true; clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); };
      const timer = setTimeout(() => real(input, init).then(resolve, reject), ms);
      if (signal) { if (signal.aborted) return stop(); signal.addEventListener('abort', stop, { once: true }); }
    });
  };
}"""


@pytest.fixture(scope="module")
def two_datasets(tmp_path_factory):
    """A server over two datasets: 'a_first' (listed first) and the fixture."""
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        _skip_or_fail("static/vendor is not provisioned")
    tmp = tmp_path_factory.mktemp("partstep")
    data = tmp / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    shutil.copytree(FIXTURE, data / "a_first.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(20)


def _link(base, dataset, table=False, plot=True):
    tiles, configs = [], {}
    if plot:
        configs["cell-plot-A"] = {"id": "cell-plot-A", "title": "parts", **UMAP, "z": None,
                                  "color": {"type": "obs", "key": "leiden", "column": ""}}
        tiles.append({"type": "tile", "id": "cell-plot-A"})
    if table:
        configs["cell-table-A"] = {"id": "cell-table-A", "title": "cells",
                                   "columns": [{"type": "obs", "key": "leiden", "column": ""}]}
        tiles.append({"type": "tile", "id": "cell-table-A"})
    row = tiles[0] if len(tiles) == 1 else {
        "type": "split", "direction": "vertical", "panes": [{"percentage": 50}] * len(tiles), "children": tiles}
    layout = {"v": 1, "hierarchy": [row] if tiles else [], "controlState": {}, "panelConfigs": configs}
    view = {"v": 1, "subset": {"n": N_PART, "seed": 0}, "layout": layout}
    return (f"{base}/?dataset_path={dataset}#view="
            + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))


class _Page:
    def __init__(self, pw, base, dataset, on_demand=False, table=False, plot=True, delay=0, wait=True, defaults=None):
        try:
            self.browser = pw.chromium.launch()
        except Exception as exc:
            _skip_or_fail(f"Chromium cannot start: {exc}")
        self.base, self.dataset = base, dataset
        self.page = self.browser.new_page(viewport={"width": 1600, "height": 1000})
        self.sent = []                    # data requests that reached the network
        self.page.on("request", lambda r: self.sent.append(r.url) if "/api/v1/data/" in r.url else None)
        changed = dict(defaults or {})
        if on_demand:                     # the fixture's 200 cells are "very many"
            changed["names_on_demand_above"] = 100
        if changed:
            def patch(route):
                config = route.fetch().json()
                ui = dict(config.get("ui") or {})
                ui["defaults"] = {**(ui.get("defaults") or {}), **changed}
                route.fulfill(json={**config, "ui": ui})
            self.page.route("**/api/v1/config", patch)
        self.page.add_init_script(f"window.addEventListener('DOMContentLoaded', ({DELAY}));")
        if delay:
            self.page.add_init_script(f"window.addEventListener('DOMContentLoaded', () => {{ window.__delay = {delay}; }});")
        self.page.goto(_link(base, dataset, table, bool(plot)))
        self.plot = plot
        if wait:
            self.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            if plot:
                self.wait_drawn()

    def delay(self, ms):
        self.page.evaluate(f"() => {{ window.__delay = {ms}; window.__held = []; }}")

    def state(self, pid="cell-plot-A"):
        return self.page.evaluate(STATE, pid)

    def wait_drawn(self, pid="cell-plot-A", timeout=40_000):
        self.page.wait_for_function(f"(id) => ({STATE})(id).drawn", arg=pid, timeout=timeout)
        self.page.wait_for_timeout(500)

    def wait_part(self, part, points=None, timeout=60_000):
        """The box says `part` (1-based) and the plot shows that part's points."""
        self.page.wait_for_function(f"document.querySelector('#subset-part-input').value === '{part}'", timeout=timeout)
        want = points if points is not None else (N_PART if part < 4 else N_CELLS - 3 * N_PART)
        self.page.wait_for_function(
            f"(id) => ({STATE})(id).n === {want} && !document.querySelector('.subset-loading-pill')"
            " && !document.querySelector('.loading-overlay')", arg="cell-plot-A", timeout=timeout)
        self.page.wait_for_timeout(300)

    def x_signature(self):
        return self.page.evaluate("""() => { const g = document.querySelector('.js-plotly-plot');
            return g && g._fullData ? g._fullData.map(t => t.x ? t.x.slice(0, 3).join(',') : '').join('|') : ''; }""")

    def subset_key(self):
        return self.page.evaluate("""async () => { const { DataManager } = await import('/static/js/data-manager.js');
            return DataManager.getSubsetParam(); }""")

    def part_names(self, key=None):
        """The cell names of the part shown, in point order, from the server."""
        key = key or self.subset_key()
        q = urllib.parse.urlencode({"dataset_path": self.dataset, "subset": key})
        return json.loads(urllib.request.urlopen(f"{self.base}/api/v1/data/cells?{q}").read())["cells"]

    def requests_to(self, route):
        return [u for u in self.sent if f"/api/v1/data/{route}" in u]

    def coordinate_requests(self):
        """The embedding reads of the plot (not the focused cell's own, by dataset row)."""
        return [u for u in self.requests_to("obsm") if "dataset_rows" not in u]

    def shot(self, name, tile=None):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            target = self.page.locator(f'.tile[data-tile-id="{tile}"]') if tile else self.page
            target.screenshot(path=os.path.join(SHOTS, name))

    def close(self):
        self.browser.close()


def _parts_of(urls):
    out = []
    for u in urls:
        spec = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("subset")
        out.append(json.loads(spec[0]).get("part", 0) if spec else None)
    return out


# -- names are not downloaded for a very large dataset -------------------------

def test_names_are_not_downloaded_and_hover_and_focus_show_the_right_ones(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, on_demand=True)
        try:
            assert s.requests_to("cells") == [], "the cell names were downloaded on open"
            assert s.state()["n"] == N_PART
            first = s.x_signature()
            s.page.click("#subset-part-next")
            s.wait_part(2)
            assert s.x_signature() != first, "the next part drew the same points"
            assert s.requests_to("cells") == [], "the cell names were downloaded on a part step"
            names = s.part_names()
            assert len(names) == N_PART

            # a point away from the others, so the hover cannot land on a neighbour
            spot = s.page.evaluate("""() => {
              const g = document.querySelector('.js-plotly-plot');
              const t = g._fullData.find(d => d.type === 'scattergl' && d.x && d.x.length > 1);
              const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis, r = g.getBoundingClientRect();
              const px = i => [r.left + xa._offset + xa.c2p(t.x[i]), r.top + ya._offset + ya.c2p(t.y[i])];
              let best = null;
              for (let i = 0; i < t.x.length; i++) {
                const [x, y] = px(i);
                let d = Infinity;
                for (let j = 0; j < t.x.length; j++) if (j !== i) { const [u, v] = px(j); d = Math.min(d, Math.hypot(x - u, y - v)); }
                if (!best || d > best.d) best = { d, x, y, token: t.customdata[i] };
              }
              return best; }""")
            index = int(spot["token"][1:])
            assert spot["token"][0] == "⁣", f"the plot holds {spot['token']!r}, not a token for the cell"
            s.page.mouse.move(spot["x"] - 5, spot["y"] - 5)
            s.page.mouse.move(spot["x"], spot["y"])
            deadline = time.time() + 15
            label = ""
            while time.time() < deadline:
                label = s.page.evaluate("() => [...document.querySelectorAll('.hovertext')].map(e => e.textContent).join(' ')")
                if names[index] in label:
                    break
                s.page.wait_for_timeout(100)
            assert names[index] in label, f"the hover label {label!r} lacks the name {names[index]!r}"
            s.shot("hover-name.png", "cell-plot-A")

            s.page.mouse.click(spot["x"], spot["y"])
            s.page.wait_for_function("(name) => document.getElementById('focused-cell').value === name",
                                     arg=names[index], timeout=15_000)
            assert s.requests_to("cells") == [], "a click downloaded the names"
        finally:
            s.close()


def test_a_cell_table_names_the_rows_it_shows_and_loads_all_names_only_to_search_them(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, on_demand=True, table=True)
        try:
            s.page.wait_for_selector('.tile[data-tile-id="cell-table-A"] .entity-index-value', timeout=30_000)
            names = s.part_names()
            sel = '.tile[data-tile-id="cell-table-A"] .entity-index-value'
            s.page.wait_for_function(
                "(sel) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every(e => e.textContent.trim() && e.textContent.trim() !== '…')",
                arg=sel, timeout=20_000)
            shown = s.page.eval_on_selector_all(sel, "els => els.map(e => e.textContent.trim())")
            assert shown == names[:len(shown)] and len(shown) >= 10, f"the page shows {shown[:5]}, not {names[:5]}"
            assert s.requests_to("cells") == [], "the table downloaded every name to show a page"
            asked = [u for u in s.requests_to("obs") if "columns=_index" in u]
            assert asked, "the page's names were not asked for"
            rows = [r for u in asked for r in urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("rows", [""])[0].split(",") if r]
            assert len(set(rows)) <= 2 * len(shown) + 2, f"names of {len(set(rows))} cells were asked for to show {len(shown)}"
            s.shot("table-names.png", "cell-table-A")

            # a part step: the next part's page, still without the names
            s.page.click("#subset-part-next")
            s.wait_part(2)
            names2 = s.part_names()
            s.page.wait_for_function(
                "(sel) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every(e => e.textContent.trim() && e.textContent.trim() !== '…')",
                arg=sel, timeout=20_000)
            shown2 = s.page.eval_on_selector_all(sel, "els => els.map(e => e.textContent.trim())")
            assert shown2 == names2[:len(shown2)] and shown2 != shown
            assert s.requests_to("cells") == []

            # searching the names needs them all: one download, then the match
            target = names2[33]
            s.page.fill('.tile[data-tile-id="cell-table-A"] div.dataTables_filter input', target)
            s.page.wait_for_function(
                "([sel, name]) => { const e = [...document.querySelectorAll(sel)]; return e.length === 1 && e[0].textContent.trim() === name; }",
                arg=[sel, target], timeout=20_000)
            assert len(s.requests_to("cells")) == 1, "the names were not downloaded once for the search"
        finally:
            s.close()


# -- the part control -----------------------------------------------------------

def test_the_box_the_arrows_and_the_panels_answer_at_once(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset)
        try:
            before = s.state()
            sig = s.x_signature()
            s.delay(2500)
            s.page.click("#subset-part-next")
            s.page.wait_for_timeout(250)
            assert s.page.input_value("#subset-part-input") == "2", "the box does not show the part asked for"
            assert not s.page.is_disabled("#subset-part-next") and not s.page.is_disabled("#subset-part-prev"), \
                "the arrows are off while the part loads"
            assert s.page.get_attribute("#subset-parts", "aria-busy") == "true"
            pill = s.page.locator('.tile[data-tile-id="cell-plot-A"] .subset-loading-pill')
            assert pill.count() == 1 and "Loading part 2" in pill.inner_text(), "the panel does not say that part 2 loads"
            assert s.page.locator('.tile[data-tile-id="cell-plot-A"] .tile-content.subset-loading').count() == 1
            assert s.state() == before and s.x_signature() == sig, "the old plot did not stay while the part loads"
            s.shot("loading-part.png", "cell-plot-A")
            s.delay(0)
            s.wait_part(2)
            assert s.x_signature() != sig
            assert s.page.get_attribute("#subset-parts", "aria-busy") == "false"
            assert s.page.locator('.subset-loading-pill').count() == 0
        finally:
            s.close()


def test_clicking_on_loads_only_the_last_part(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset)
        try:
            s.sent.clear()
            s.delay(1500)
            s.page.click("#subset-part-next")
            s.page.wait_for_timeout(2000)       # the first step is under way (the old code takes it as shown)
            s.page.click("#subset-part-next")
            s.page.wait_for_timeout(400)
            s.page.click("#subset-part-next")
            assert s.page.input_value("#subset-part-input") == "4"
            s.delay(0)
            s.wait_part(4)
            parts = sorted(set(p for p in _parts_of(s.coordinate_requests()) if p is not None))
            assert parts == [3], f"the plot read the coordinates of parts {parts}, not only the last"
            assert s.state()["n"] == N_CELLS - 3 * N_PART
            assert s.page.is_disabled("#subset-part-next")
        finally:
            s.close()


def test_stepping_back_to_the_part_shown_stops_the_load_under_way(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset)
        try:
            sig = s.x_signature()
            s.sent.clear()
            s.delay(1500)
            s.page.click("#subset-part-next")
            s.page.wait_for_timeout(300)
            s.page.click("#subset-part-prev")
            assert s.page.input_value("#subset-part-input") == "1"
            s.delay(0)
            s.wait_part(1)
            assert s.x_signature() == sig
        finally:
            s.close()


def test_a_part_step_during_a_dataset_load_does_not_close_the_panels(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset)
        try:
            s.page.evaluate("() => document.querySelector('.tile[data-tile-id=\"cell-plot-A\"]').setAttribute('data-mark', 'kept')")
            s.delay(2500)
            s.page.click("#refresh-dataset")           # loads the dataset again; its panels redraw
            s.page.wait_for_function("() => window.__held.some(h => /obsm/.test(h.url))", timeout=30_000)
            s.page.click("#subset-part-next")
            s.page.wait_for_timeout(500)
            assert s.page.locator('.tile[data-tile-id="cell-plot-A"][data-mark="kept"]').count() == 1, \
                "the panel was closed for the part step"
            s.delay(0)
            s.wait_part(2)
            assert s.page.locator('.tile[data-tile-id="cell-plot-A"][data-mark="kept"]').count() == 1
            assert s.page.input_value("#subset-part-input") == "2"
        finally:
            s.close()


# -- the dataset picker ---------------------------------------------------------

def test_the_picker_shows_the_dataset_that_is_loading_and_survives_refreshing_twice(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, delay=1500, wait=False)
        try:
            s.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            s.delay(0)
            s.wait_drawn()
            assert s.page.evaluate("() => document.querySelector('#dataset-selector').value") == dataset
            s.delay(800)                               # the list is read slowly: the two refreshes overlap
            s.page.click("#refresh-dataset")
            s.page.click("#refresh-dataset")
            s.page.wait_for_timeout(5000)
            assert s.page.evaluate("() => document.querySelector('#dataset-selector').value") == dataset, \
                "Refresh twice left the picker on another dataset"
        finally:
            s.close()


def test_the_picker_names_the_dataset_a_link_is_loading(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, delay=2500, wait=False)
        try:
            s.page.wait_for_function("() => document.querySelector('#dataset-selector')?.options.length > 1", timeout=30_000)
            s.page.wait_for_timeout(300)
            shown = s.page.evaluate("() => document.querySelector('#dataset-selector').value")
            assert shown == dataset, f"while the link's dataset loads the picker shows {shown!r}, not {dataset!r}"
        finally:
            s.close()


def test_refresh_while_a_link_loads_does_not_open_the_first_dataset(two_datasets):
    """The picker listed the first dataset while the link's loaded, and Refresh reads the picker."""
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, delay=2500, wait=False)
        try:
            s.page.wait_for_function("() => document.querySelector('#dataset-selector')?.options.length > 1", timeout=30_000)
            s.page.wait_for_timeout(300)
            s.page.click("#refresh-dataset")
            s.page.wait_for_timeout(12_000)
            other = [u for u in s.sent if "a_first" in urllib.parse.unquote(u)]
            assert other == [], f"the first dataset of the picker was opened: {other[:2]}"
            s.delay(0)
            s.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            s.wait_drawn()
            assert s.page.evaluate("() => document.querySelector('#dataset-selector').value") == dataset
        finally:
            s.close()


# -- reading ahead --------------------------------------------------------------

def test_the_next_part_is_read_ahead_and_the_step_to_it_asks_for_no_coordinates(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, defaults={"prefetch_next_part": True})
        try:
            s.page.wait_for_function("() => true")
            deadline = time.time() + 20
            while time.time() < deadline and 1 not in _parts_of(s.coordinate_requests()):
                s.page.wait_for_timeout(200)
            ahead = _parts_of(s.coordinate_requests())
            assert 1 in ahead, f"the coordinates of the next part were not read ahead: {ahead}"
            low = [u for u in s.requests_to("subset") if "priority=low" in u]
            assert low, "the next part's cells were not asked for at low priority"
            sig = s.x_signature()
            s.sent.clear()
            s.page.click("#subset-part-next")
            s.wait_part(2)
            assert s.x_signature() != sig
            assert _parts_of(s.coordinate_requests()) == [], "stepping to the part read ahead asked for its coordinates again"
        finally:
            s.close()


def test_nothing_is_read_ahead_when_it_is_off(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, defaults={"prefetch_next_part": False})
        try:
            s.page.wait_for_timeout(4000)
            assert 1 not in _parts_of(s.coordinate_requests())
            assert not [u for u in s.requests_to("subset") if "priority=low" in u]
        finally:
            s.close()


def test_a_step_stops_the_read_ahead_of_another_part(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, defaults={"prefetch_next_part": True}, delay=1200)
        try:
            # the read ahead of part 2 is under way (its request held in the page) ...
            s.page.wait_for_function("() => window.__held.some(h => /priority=low/.test(h.url) && !h.aborted)", timeout=30_000)
            assert 1 not in _parts_of(s.coordinate_requests())
            # ... and a step to part 4 stops it
            s.page.fill("#subset-part-input", "4")
            s.page.press("#subset-part-input", "Enter")
            s.page.wait_for_timeout(400)
            assert s.page.evaluate("() => window.__held.filter(h => /priority=low/.test(h.url)).every(h => h.aborted)"), \
                "the read ahead of part 2 was not stopped"
            s.delay(0)
            s.wait_part(4)
            assert 1 not in _parts_of(s.coordinate_requests()), "the part read ahead was loaded though a later one was asked for"
        finally:
            s.close()


# -- the focused-cell box ---------------------------------------------------------

def test_clicking_into_the_focused_cell_box_asks_for_no_dataset_wide_index_on_a_huge_store(two_datasets):
    """Focusing the box lists names; the app also searched every cell of the
    dataset, which built an index of every name in the server (32 GB at 1B cells)."""
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, wait=False)
        try:
            def too_big(route):
                body = route.fetch().json()
                route.fulfill(json={**body, "name_search": {"dataset": False}})
            s.page.route("**/api/v1/data/subset?*", too_big)
            s.page.goto(_link(base, dataset))
            s.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
            s.wait_drawn()
            s.sent.clear()
            s.page.click("#focused-cell")
            s.page.wait_for_selector(".name-picker-menu:not([hidden]) .name-picker-option", timeout=15_000)
            searched = [u for u in s.requests_to("names")]
            assert searched, "the box listed no names"
            assert not [u for u in searched if "scope=dataset" in u], f"every cell of the dataset was searched: {searched}"
            s.page.fill("#focused-cell", "cell")
            s.page.wait_for_timeout(1500)
            assert not [u for u in s.requests_to("names") if "scope=dataset" in u]
        finally:
            s.close()


def test_clicking_into_the_focused_cell_box_still_searches_the_dataset_when_it_can(two_datasets):
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset)
        try:
            s.sent.clear()
            s.page.click("#focused-cell")
            s.page.wait_for_selector(".name-picker-menu:not([hidden]) .name-picker-option", timeout=15_000)
            s.page.wait_for_timeout(500)
            assert [u for u in s.requests_to("names") if "scope=dataset" in u], "the cells outside the subset are not searched"
        finally:
            s.close()


def test_a_cell_plot_made_after_the_dataset_opened_also_reads_the_next_part_ahead(two_datasets):
    """Single-user servers read ahead by default ('auto'); the plot comes after the dataset."""
    base, dataset = two_datasets
    with sync_api.sync_playwright() as pw:
        s = _Page(pw, base, dataset, plot=False)
        try:
            s.page.wait_for_timeout(3500)              # the dataset is open, no plot: nothing to read ahead
            assert not [u for u in s.requests_to("subset") if "priority=low" in u]
            s.page.click("text=Cell Plot")
            deadline = time.time() + 30
            while time.time() < deadline and not [u for u in s.requests_to("subset") if "priority=low" in u]:
                s.page.wait_for_timeout(200)
            assert [u for u in s.requests_to("subset") if "priority=low" in u], "the next part was not read ahead"
        finally:
            s.close()
