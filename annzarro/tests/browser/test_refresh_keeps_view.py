"""The header's Refresh re-reads the open dataset and keeps every plot's view (0.8.0, decision 39).

The per-plot Refresh is gone (the render-drift harness, test_render_drift.py, holds every edit to a fresh draw); the
header's Refresh is the one way to re-read the store from disk. A Refresh of the dataset that is open is not a
switch to another dataset: the coordinates are the same, so a Cell Plot's and a Gene Plot's zoom stays, in the drawing,
in the settings, in the link the page writes, and after the next redraw. What changed on disk comes in: a column
added to obs is offered after the Refresh.

One headless Chromium session per test, on a copy of the 200-cell fixture.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import urllib.parse

import numpy as np
import pytest

if __import__("os").environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_refresh_reads_disk import served  # noqa: E402,F401 (the fixture: a served copy)

CP, GP = "cell-plot-K", "gene-plot-K"
ROW = lambda cell: {"type": "layer", "key": "X", "column": cell}  # noqa: E731
GD = "(id) => document.querySelector(`.tile[data-tile-id=\"${id}\"] .js-plotly-plot`)"
VIEW = """(id) => { const gd = (%s)(id); const c = window.PanelManager.getPanel(id).getConfig();
    return { saved: c.viewport2D || null, drawn: gd && gd._fullLayout ? [gd._fullLayout.xaxis.range, gd._fullLayout.yaxis.range] : null }; }""" % GD
DRAWN = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd.data && gd.data.some(t => t.x && t.x.length > 1)); }""" % GD


def _link(root, store):
    plots = {
        CP: {"id": CP, "x": {"type": "obsm", "key": "X_umap", "column": "0"}, "y": {"type": "obsm", "key": "X_umap", "column": "1"},
             "z": None, "color": {"type": "obs", "key": "total_counts", "column": ""}},
        GP: {"id": GP, "x": ROW("cell_0001"), "y": ROW("cell_0002"), "z": None, "color": {"type": "none", "key": "", "column": ""}},
    }
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in plots]
    view = {"v": 1, "constants": {"focusedCell": "cell_0001"},
            "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}],
                                              "children": tiles}],
                       "controlState": {i: True for i in plots}, "panelConfigs": plots}}
    payload = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


def _zoom(page, pid):
    """A zoom as the user makes it (a relayout of both ranges), into the middle half of what is drawn."""
    page.evaluate("""(id) => { const gd = (%s)(id); const [x, y] = [gd._fullLayout.xaxis.range, gd._fullLayout.yaxis.range];
        const mid = (r) => [r[0] + (r[1] - r[0]) / 4, r[1] - (r[1] - r[0]) / 4];
        return Plotly.relayout(gd, { 'xaxis.range': mid(x), 'yaxis.range': mid(y) }); }""" % GD, pid)
    page.wait_for_function("(id) => !!window.PanelManager.getPanel(id).getConfig().viewport2D", arg=pid)
    return page.evaluate(VIEW, pid)


def _add_obs_column(store, name):
    """A column written to the store's obs from another process: a new array and its name in column-order."""
    import zarr
    try:
        root = zarr.open_group(store, mode="r+", use_consolidated=False)
    except TypeError:
        root = zarr.open_group(store, mode="r+")
    obs = root["obs"]
    n = obs[obs.attrs["_index"]].shape[0]
    arr = obs.create_dataset(name, data=np.arange(n, dtype="float64")) if hasattr(obs, "create_dataset") \
        else obs.create_array(name, data=np.arange(n, dtype="float64"))
    arr.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + [name]
    # as the server's notice tells a user to (a store read without its consolidated metadata is a case of its own)
    zarr.consolidate_metadata(store)


def _close(a, b, tol=1e-6):
    return all(abs(x - y) <= tol * max(1.0, abs(x), abs(y)) for x, y in zip(a, b))


def test_the_header_refresh_keeps_each_plots_zoom_and_brings_what_changed_on_disk(served):
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root, store))
            for pid in (CP, GP):
                page.wait_for_function(DRAWN, arg=pid, timeout=60000)
            before = {pid: _zoom(page, pid) for pid in (CP, GP)}

            # every view the page records while it refreshes (the link in the address bar follows the view, and the
            # autosave is the same capture): none may be without the zoom, not even for a moment
            page.evaluate("""() => { window.__views = [];
                const keep = (kind) => { const o = history[kind].bind(history);
                    history[kind] = (state, title, url) => { if (url) window.__views.push(String(url)); return o(state, title, url); }; };
                keep('replaceState'); keep('pushState');
                // and the settings themselves, every frame: what a link or the autosave would take at that moment
                window.__lost = [];
                const watch = () => { for (const id of ['%s', '%s']) { const p = window.PanelManager.getPanel(id);
                    if (p && !p.getConfig().viewport2D) window.__lost.push(id); }
                    if (!window.__stopWatch) requestAnimationFrame(watch); };
                requestAnimationFrame(watch); }""" % (CP, GP))
            _add_obs_column(store, "added_on_disk")
            page.click("#refresh-dataset")
            # the dataset was read again: the new column is offered in the Cell Plot's colour menu
            page.wait_for_function("""(id) => { const t = document.querySelector(`.tile[data-tile-id="${id}"]`);
                const s = t && t.querySelector('select.axis-key-select[data-axis="color"]');
                return !!s && [...s.options].some(o => o.value === 'added_on_disk'); }""", arg=CP, timeout=60000)
            for pid in (CP, GP):
                page.wait_for_function(DRAWN, arg=pid, timeout=60000)
                page.wait_for_function("([id, want]) => { const v = (%s)(id); return !!v.saved && JSON.stringify(v.saved) === JSON.stringify(want); }"
                                       % VIEW, arg=[pid, before[pid]["saved"]], timeout=60000)
                after = page.evaluate(VIEW, pid)
                assert after["saved"] == before[pid]["saved"], f"{pid}: the zoom kept in the settings went"
                for axis in (0, 1):
                    assert _close(after["drawn"][axis], before[pid]["drawn"][axis], 1e-3), \
                        f"{pid}: drawn {after['drawn']} after the Refresh, {before[pid]['drawn']} before"

            page.evaluate("() => { window.__stopWatch = true; }")
            lost = page.evaluate("() => [...new Set(window.__lost)]")
            assert not lost, f"the zoom was gone from the settings of {lost} during the Refresh (a link or autosave then would lose it)"
            recorded = page.evaluate("""async () => { const d = await import('/static/js/utils/deeplink.js');
                const out = [];
                for (const url of window.__views) { const m = /#view=([^&]+)/.exec(url); if (!m) continue;
                    const v = await d.decodeViewPayload(decodeURIComponent(m[1]));
                    const c = v && v.layout && v.layout.panelConfigs; if (c) out.push([c['%s'] && c['%s'].viewport2D, c['%s'] && c['%s'].viewport2D]); }
                return out; }""" % (CP, CP, GP, GP))
            for cp_view, gp_view in recorded:
                assert cp_view == before[CP]["saved"] and gp_view == before[GP]["saved"], \
                    f"a view recorded during the Refresh lost a zoom: {cp_view}, {gp_view}"

            # the link and the autosave carry it (the page's own capture of the view)
            configs = page.evaluate("() => window.sessionManager.captureView().layout.panelConfigs")
            for pid in (CP, GP):
                assert configs[pid]["viewport2D"] == before[pid]["saved"], f"{pid}: the link lost the zoom"

            # and the next redraw from the settings draws it again
            for pid in (CP, GP):
                page.evaluate("(id) => window.PanelManager.getPanel(id).refreshPlot()", pid)
                page.wait_for_function(DRAWN, arg=pid, timeout=60000)
                again = page.evaluate(VIEW, pid)
                assert again["saved"] == before[pid]["saved"]
                for axis in (0, 1):
                    assert _close(again["drawn"][axis], before[pid]["drawn"][axis], 1e-3), f"{pid}: a redraw lost the zoom"
            assert not errors, errors
        finally:
            browser.close()
