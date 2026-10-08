"""A subset change redraws every open cell plot, with no click on refresh.

Opens the committed fixture (200 cells) on {"n": 60, "seed": 0} with several
cell plots (categorical, gene and continuous colourings, one in 3D) and a cell
table, steps to the next parts, and checks that every plot drew the new part's
cells, exactly once, and that the table lists them. A cell table redraws on a
subset change and announces its rows (`tableFiltered`); that announcement must
not cancel the plots' own update.

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json

from .test_subset_parts_browser import (  # noqa: F401  (server is a fixture)
    N_CELLS, N_PART, _skip_or_fail, server, sync_api)

UMAP = {"x": {"type": "obsm", "key": "X_umap", "column": "0"},
        "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
PLOTS = {
    "cell-plot-A": {**UMAP, "z": None, "color": {"type": "obs", "key": "leiden", "column": ""}},
    "cell-plot-B": {**UMAP, "z": None, "color": {"type": "layer", "key": "X", "column": "GENE005"}},
    "cell-plot-C": {**UMAP, "z": None, "color": {"type": "obs", "key": "total_counts", "column": ""}},
    "cell-plot-D": {"x": UMAP["x"], "y": UMAP["y"], "z": {"type": "obsm", "key": "X_umap", "column": "0"},
                    "color": {"type": "obs", "key": "cell_type", "column": ""}},
}


def _link(base, dataset):
    tiles = [{"type": "tile", "id": i} for i in [*PLOTS, "cell-table-A"]]
    def split(direction, a, b):
        return {"type": "split", "direction": direction, "panes": [{"percentage": 50}] * 2, "children": [a, b]}

    root = split("vertical", split("horizontal", tiles[0], tiles[1]),
                 split("horizontal", tiles[2], split("horizontal", tiles[3], tiles[4])))
    layout = {"v": 1, "hierarchy": [root],
              "controlState": {}, "panelConfigs": {**{k: {"id": k, "title": k, **v} for k, v in PLOTS.items()},
                                                   "cell-table-A": {"id": "cell-table-A", "title": "cell-table-A"}}}
    view = {"v": 1, "subset": {"n": N_PART, "seed": 0}, "layout": layout}
    return (f"{base}/?dataset_path={dataset}#view="
            + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))


# what each plot drew: the number of cells and a signature of their x values
DRAWN = """() => { const out = {};
  for (const g of document.querySelectorAll('.tile .js-plotly-plot')) {
    const id = g.closest('.tile').dataset.tileId;
    const xs = (g._fullData || []).filter(d => d.name !== 'Focused Cell' && d.meta !== 'az-legend')
        .flatMap(d => d.x ? Array.from(d.x) : []);
    out[id] = { n: xs.length, sig: xs.map(Number).sort().join(',') };
  }
  return out; }"""
TABLE_INFO = """() => { const t = document.querySelector(
    '.tile[data-tile-id="cell-table-A"] .dataTables_info, .tile[data-tile-id="cell-table-A"] .dt-info');
  return t ? t.textContent : null; }"""
COUNT_DRAWS = """() => { window.__draws = {}; const P = window.Plotly;
  for (const f of ['react', 'newPlot']) { const o = P[f];
    P[f] = function (g, ...a) { const el = typeof g === 'string' ? document.getElementById(g) : g;
      const t = el && el.closest && el.closest('.tile'); const id = t ? t.dataset.tileId : '?';
      window.__draws[id] = (window.__draws[id] || 0) + 1; return o.call(this, g, ...a); }; } }"""


def test_subset_change_redraws_every_cell_plot(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": 1800, "height": 1000})
            page.goto(_link(base, dataset))
            page.wait_for_selector("#subset-parts:not([hidden])", timeout=60_000)
            ids = list(PLOTS)

            def settled(want, previous):
                """Wait (bounded) for every plot to show `want` cells other than `previous`."""
                try:
                    page.wait_for_function(
                        """([want, previous, ids]) => { const d = (%s)();
                            return ids.every(i => d[i] && d[i].n === want && d[i].sig !== (previous[i] || {}).sig); }"""
                        % DRAWN, arg=[want, previous, ids], timeout=40_000)
                except Exception:
                    pass
                page.wait_for_timeout(1500)     # a redraw that is still coming would show here
                return page.evaluate(DRAWN)

            previous = settled(N_PART, {})
            assert sorted(previous) == sorted(PLOTS), f"plots drawn: {sorted(previous)}"
            page.evaluate(COUNT_DRAWS)
            for part, want in ((1, N_PART), (2, N_PART), (3, N_CELLS - 3 * N_PART)):
                page.evaluate("() => { window.__draws = {}; }")
                page.click("#subset-part-next")
                now = settled(want, previous)
                for pid in ids:
                    assert now[pid]["n"] == want, f"part {part}: {pid} shows {now[pid]['n']} cells, not {want}"
                    assert now[pid]["sig"] != previous[pid]["sig"], f"part {part}: {pid} still shows the old cells"
                draws = page.evaluate("() => window.__draws")
                assert all(draws.get(pid) == 1 for pid in ids), f"part {part}: draws per plot {draws}"
                info = page.evaluate(TABLE_INFO)
                assert info and f"of {want}" in info.replace(",", ""), f"part {part}: table says {info!r}"
                previous = now
        finally:
            browser.close()
