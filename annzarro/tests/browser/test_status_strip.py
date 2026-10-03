"""The status strip of a Cell Plot, in a real browser.

What a plot does not show, and why, is said in ONE place: the strip under the
plot (static/js/utils/panel-surface.js). Its reasons add up, each has the
action that undoes it, the plot never moves when its text changes, and
nothing about it is a toast or a banner. Large-plot mode is a tag in the same
strip; a click on such a plot pulses it and opens its popover once.

The store is the committed 200-cell fixture with every tenth total_counts
blanked (rows 0, 10, ...), served twice: as is, and with large-plot mode
above 100 points.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import re
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pytest
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SUBSET = {"n": 50, "seed": 0}
NAN_ROWS = set(range(0, 200, 10))
TILE = '.tile[data-tile-id="cell-plot-L"]'


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_nan.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    counts = zarr.open(store, mode="r+")["obs"]["total_counts"]
    values = counts[:]
    values[sorted(NAN_ROWS)] = np.nan
    counts[:] = values
    (home / "c.yaml").write_text(config)
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(home / "c.yaml"), "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    return proc, root, store


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root, store = _serve(tmp_path_factory, "ui: {}\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    proc, root, store = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _part_rows(root, store, part):
    spec = dict(SUBSET, part=part) if part else SUBSET
    q = urllib.parse.urlencode({"dataset_path": store, "subset": json.dumps(spec)})
    with urllib.request.urlopen(f"{root}/api/v1/data/cells?{q}") as r:
        return [int(c.split("_")[1]) for c in json.load(r)["cells"]]


def _link(root, store, subset=SUBSET, plot=None, table=False, focused=None, controls=True):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"id": "cell-plot-L", "title": "umap", "x": x, "y": y, "z": None,
           "color": {"type": "obs", "key": "total_counts", "column": ""}, "pointSize": 8, "pointOpacity": 1}
    cfg.update(plot or {})
    tiles = [{"type": "tile", "id": "cell-plot-L", "controlsVisible": controls}]
    configs = {"cell-plot-L": cfg}
    if table:
        tiles.append({"type": "tile", "id": "cell-table-T", "controlsVisible": True})
        configs["cell-table-T"] = {"id": "cell-table-T", "title": "cells"}
    hierarchy = tiles if len(tiles) == 1 else [{
        "type": "split", "direction": "horizontal",
        "panes": [{"percentage": 60}, {"percentage": 40}], "children": tiles}]
    view = {"v": 1, "subset": subset, "constants": {"focusedCell": focused} if focused else {},
            "layout": {"v": 1, "hierarchy": hierarchy,
                       "controlState": {t["id"]: controls for t in tiles}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


# Counts every toast that appears, and the most shown at once
TOASTS = """() => {
  window.__toasts = {made: 0, most: 0, titles: []};
  const scan = () => {
    const shown = [...document.querySelectorAll('.notification:not(.notification-ask)')];
    window.__toasts.most = Math.max(window.__toasts.most, shown.length);
  };
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.classList && n.classList.contains('notification')) {
        window.__toasts.made++;
        window.__toasts.titles.push((n.querySelector('.notification-title') || {}).textContent);
      }
    }
    scan();
  }).observe(document.documentElement, {subtree: true, childList: true});
}"""

STRIP = """() => {
  const s = document.querySelector('.tile[data-tile-id="cell-plot-L"] .plot-status');
  const num = (e) => e ? Number(e.textContent.replace(/,/g, '')) : null;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  const area = document.querySelector('.tile[data-tile-id="cell-plot-L"] .js-plotly-plot .nsewdrag');
  const box = area ? area.getBoundingClientRect() : null;
  if (!s) return {strip: false, busy};
  return {
    strip: true, busy,
    severity: [...s.classList].find(c => c.startsWith('plot-status--')),
    headline: s.querySelector('.ps-headline').innerText.trim(),
    chips: [...s.querySelectorAll('.ps-chip')].filter(c => c.offsetParent !== null && c.offsetTop < 20)
        .map(c => c.textContent),
    details: !!s.querySelector('.ps-details') && s.querySelector('.ps-details').offsetParent !== null,
    rows: [...s.querySelectorAll('.ps-rows tr[data-kind]')].map(tr => ({
      kind: tr.dataset.kind, n: num(tr.querySelector('.ps-n')),
      actions: [...tr.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction)})),
    notShown: num(s.querySelector('.ps-total .ps-n')),
    tags: [...s.querySelectorAll('.ps-tag')].map(t => t.textContent),
    open: [...s.querySelectorAll('.ps-pop')].filter(p => !p.hidden).map(p => p.dataset.pop),
    pulses: Number(s.dataset.pulses || 0),
    width: s.getBoundingClientRect().width,
    plot: box ? [Math.round(box.top), Math.round(box.height)] : null,
    part: (document.getElementById('subset-part-input') || {}).value,
    // the surfaces the strip replaced must not come back
    old: document.querySelectorAll('.coverage-notice, .datapoint-filter-widget, .mode-notice, .focus-notice').length,
    caption: (() => { const g = document.querySelector('.tile[data-tile-id="cell-plot-L"] .js-plotly-plot');
                      const a = g && g.layout && (g.layout.annotations || []).find(a => a.name === 'coverage-notice');
                      return a ? a.text : null; })()
  };
}"""


def _wait(page, pred, timeout=60):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = page.evaluate(STRIP)
        if not s["busy"] and s["strip"] and pred(s):
            return s
        time.sleep(0.2)
    pytest.fail(f"timed out; last state {s}")


def _rows(s):
    return {r["kind"]: r["n"] for r in s["rows"]}


def _sums(s):
    """The rows add up to what is not shown, and that to the headline."""
    shown, total = [int(v.replace(",", "")) for v in s["headline"].split(" ")[0:3:2]]
    assert sum(r["n"] for r in s["rows"]) == s["notShown"] == total - shown, s
    return shown


def _act(page, action):
    page.click(f"{TILE} .plot-status .ps-summary")
    page.click(f'{TILE} .plot-status .ps-pop[data-pop="main"] [data-ps-action="{action}"]')


def _open(pw, link, width=1500):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": 1100})
    page.add_init_script("document.addEventListener('DOMContentLoaded', () => (" + TOASTS + ")())")
    page.goto(link)
    return browser, page


def test_each_reason_counted_once_and_undone(server):
    root, store = server
    part0, part1 = _part_rows(root, store, 0), _part_rows(root, store, 1)
    nan0 = len(NAN_ROWS & set(part0))
    assert nan0 > 0, "the fixture's NaN rows must reach part 1"
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, plot={"hideNaN": True}, table=True))
        try:
            # outside the part, and Hide NaN
            s = _wait(page, lambda s: "nan" in _rows(s))
            assert _rows(s) == {"outside": 150, "nan": nan0}, s
            assert _sums(s) == 50 - nan0
            assert s["chips"][:2] == ["150 not in part 1 of 4", f"{nan0} NaN hidden"], s
            assert "not in part 1 of 4" in s["caption"], "the exported image says it too"
            assert s["old"] == 0
            assert [r["actions"] for r in s["rows"]] == [["next-part", "subset"], ["show-nan"]]

            # the popover opens on click, with the reason, the count and the action
            page.click(f"{TILE} .plot-status .ps-summary")
            assert page.evaluate(STRIP)["open"] == ["main"]
            page.keyboard.press("Escape")
            assert page.evaluate(STRIP)["open"] == []

            # Show NaN gives the NaN cells back
            _act(page, "show-nan")
            s = _wait(page, lambda s: "nan" not in _rows(s))
            assert _rows(s) == {"outside": 150} and _sums(s) == 50

            # a table filter, then Hide NaN again: each cell under ONE reason
            page.fill('.tile[data-tile-id="cell-table-T"] input[type="search"]', "cell_01")
            page.select_option(f"{TILE} select.table-filter-select", "cell-table-T")
            page.click('button[id^="remove-non-table-entries-"]')
            out_table = [r for r in part0 if not (100 <= r < 200)]
            s = _wait(page, lambda s: "table" in _rows(s))
            assert _rows(s) == {"outside": 150, "table": len(out_table)}, s
            page.evaluate("() => document.querySelector('button[id^=\"hide-nan-\"]').click()")
            nan_in_table = len([r for r in part0 if 100 <= r < 200 and r in NAN_ROWS])
            s = _wait(page, lambda s: "nan" in _rows(s) or nan_in_table == 0)
            assert _rows(s).get("nan", 0) == nan_in_table and _rows(s)["table"] == len(out_table), s
            _sums(s)

            # Stop filtering gives the table's cells back (drawn grey; the
            # colour filters still act on the table's cells only, #37)
            _act(page, "stop-table")
            s = _wait(page, lambda s: "table" not in _rows(s))
            assert _rows(s) == {"outside": 150, "nan": nan_in_table}, s

            # Next part swaps the cells for the next part's: the part advances
            _act(page, "next-part")
            s = _wait(page, lambda s: s["part"] == "2" and "part 2 of 4" in " ".join(s["chips"]))
            assert _rows(s) == {"outside": 150, "nan": len(NAN_ROWS & set(part1))}, s
            assert page.evaluate("() => window.__toasts").get("made") == 0, "no toast for any of it"
        finally:
            browser.close()


def test_outliers_and_missing_coordinates(server):
    root, store = server
    part0 = _part_rows(root, store, 0)
    # x from total_counts: its NaN rows have no coordinate; Hide Outliers on a
    # range that leaves out the low counts
    plot = {"x": {"type": "obs", "key": "total_counts", "column": ""}, "hideOutliers": True,
            "colorMin": 2000, "colorMax": 20000}
    values = zarr.open(store, mode="r")["obs"]["total_counts"][:]
    coords = len(NAN_ROWS & set(part0))
    low = len([r for r in part0 if r not in NAN_ROWS and values[r] < 2000])
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, plot=plot))
        try:
            s = _wait(page, lambda s: "coords" in _rows(s) and ("outliers" in _rows(s) or low == 0))
            assert _rows(s) == {"outside": 150, "coords": coords, **({"outliers": low} if low else {})}, s
            _sums(s)
            assert [r["actions"] for r in s["rows"] if r["kind"] == "coords"] == [[]], "nothing undoes a blank"
            if low:
                _act(page, "show-outliers")
                s = _wait(page, lambda s: "outliers" not in _rows(s))
                assert _rows(s) == {"outside": 150, "coords": coords}
        finally:
            browser.close()


def test_one_toast_at_most_and_the_plot_never_moves(server):
    """The session of the audit, with the controls closed so that only the
    strip could move the plot: open, step a part, hide NaN, focus a cell
    outside the part, step back."""
    root, store = server
    part1 = _part_rows(root, store, 1)
    outside = next(f"cell_{i:04d}" for i in range(200) if i not in part1)
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, controls=False))
        try:
            s = _wait(page, lambda s: s["plot"] is not None)
            plots = [s["plot"]]
            texts = {s["headline"] + "|" + ",".join(s["chips"])}
            page.click("#subset-part-next")
            s = _wait(page, lambda s: s["part"] == "2" and "part 2 of 4" in " ".join(s["chips"]))
            plots.append(s["plot"]); texts.add(s["headline"] + "|" + ",".join(s["chips"]))
            page.evaluate("() => document.querySelector('button[id^=\"hide-nan-\"]').click()")
            s = _wait(page, lambda s: "nan" in _rows(s))
            plots.append(s["plot"]); texts.add(s["headline"] + "|" + ",".join(s["chips"]))
            page.click("#focused-cell")
            page.fill("#focused-cell", outside)
            option = f"""() => [...document.querySelectorAll('.name-picker-option')]
                .find(li => li.firstChild && li.firstChild.textContent === '{outside}')"""
            page.wait_for_function(f"() => !!({option})()", timeout=20_000)
            page.evaluate(f"""() => ({option})().dispatchEvent(
                new MouseEvent('mousedown', {{bubbles: true, cancelable: true}}))""")
            page.wait_for_function("() => !document.getElementById('focused-cell-outside').hidden", timeout=20_000)
            assert page.text_content("#focused-cell-outside") == "not in part 2 of 4"
            s = _wait(page, lambda s: True)
            assert s["tags"] == [], "a regular plot marks the focus with its ring; no strip tag"
            plots.append(s["plot"])
            page.click("#subset-part-prev")
            s = _wait(page, lambda s: s["part"] == "1")
            plots.append(s["plot"])
            assert len(texts) >= 3, f"the strip did change: {texts}"
            assert len(set(map(tuple, plots))) == 1, f"the plot area moved: {plots}"
            toasts = page.evaluate("() => window.__toasts")
            assert toasts["most"] <= 1, toasts
            assert toasts["made"] == 0, f"persistent state never goes in a toast: {toasts}"
            assert s["old"] == 0
        finally:
            browser.close()


def test_narrow_strip_keeps_the_total_and_details(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, plot={"hideNaN": True}, controls=False), width=340)
        try:
            s = _wait(page, lambda s: "nan" in _rows(s))
            assert s["width"] < 360, s
            assert re.fullmatch(r"\d+ of 200 shown", s["headline"]), s
            assert s["chips"] == [] and s["details"], s
        finally:
            browser.close()


def test_large_plot_click_pulses_and_explains_once(large_server):
    root, store = large_server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, subset=None))
        try:
            s = _wait(page, lambda s: s["tags"] == ["Large plot: no hover/click"])
            assert s["open"] == [] and s["pulses"] == 0, "the limit is shown before any click"
            area = page.query_selector(f"{TILE} .js-plotly-plot .nsewdrag").bounding_box()
            cx, cy = area["x"] + area["width"] / 2, area["y"] + area["height"] / 2
            cursor = page.evaluate(f"() => getComputedStyle(document.elementFromPoint({cx}, {cy})).cursor")
            assert cursor != "pointer", "nothing here is clickable, so no hand"
            opened = []
            for _ in range(5):
                page.mouse.click(cx, cy)
                time.sleep(0.2)
                s = page.evaluate(STRIP)
                opened.append(s["open"] == ["large"])
                page.keyboard.press("Escape")
            s = page.evaluate(STRIP)
            assert opened == [True, False, False, False, False], opened
            assert s["pulses"] == 5
            assert page.evaluate("() => window.__toasts")["made"] == 0

            # the tag's own popover: why, and the subset that lifts the limit
            page.click(f'{TILE} .plot-status .ps-tag[data-tag="large"]')
            text = page.text_content(f'{TILE} .plot-status .ps-pop[data-pop="large"]')
            assert "Over 100 points (200 here)" in text, text
            page.click(f'{TILE} .plot-status .ps-pop[data-pop="large"] [data-ps-action="subset-regular"]')
            page.wait_for_selector("#subset-modal", state="visible")
            chosen = page.get_attribute('button.subset-preset[aria-pressed="true"]', "data-n")
            sizes = page.evaluate("() => [...document.querySelectorAll('button.subset-preset')]"
                                  ".map(b => Number(b.dataset.n))")
            assert int(chosen) == max(n for n in sizes if n <= 100), (chosen, sizes)
        finally:
            browser.close()


def test_large_plot_strip_counts_hide_nan(large_server):
    root, store = large_server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, subset=None, plot={"hideNaN": True}))
        try:
            s = _wait(page, lambda s: "nan" in _rows(s))
            assert _rows(s) == {"nan": len(NAN_ROWS)}, s
            assert _sums(s) == 200 - len(NAN_ROWS)
            assert s["tags"] == ["Large plot: no hover/click"] and s["old"] == 0
        finally:
            browser.close()
