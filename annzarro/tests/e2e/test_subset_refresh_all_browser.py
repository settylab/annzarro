"""A subset change redraws every open cell plot, with no click on refresh.

Opens the committed fixture (200 cells) with four cell plots (categorical,
gene and continuous colourings, one in 3D) and a cell table. Every way to
change the subset (a part step, the dialog turning a subset on, another size,
a preset, back to every cell) must leave every plot drawn on the new cells,
exactly once, and the table listing them. A cell table redraws on a subset
change and announces its rows (`tableFiltered`); that announcement must not
cancel the plots' own update, also when the plots are slow.

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


def _link(base, dataset, subset=None):
    """A deep link with the plots and the table; `subset` None is every cell."""
    tiles = [{"type": "tile", "id": i} for i in [*PLOTS, "cell-table-A"]]

    def split(direction, a, b):
        return {"type": "split", "direction": direction, "panes": [{"percentage": 50}] * 2, "children": [a, b]}

    root = split("vertical", split("horizontal", tiles[0], tiles[1]),
                 split("horizontal", tiles[2], split("horizontal", tiles[3], tiles[4])))
    layout = {"v": 1, "hierarchy": [root],
              "controlState": {}, "panelConfigs": {**{k: {"id": k, "title": k, **v} for k, v in PLOTS.items()},
                                                   "cell-table-A": {"id": "cell-table-A", "title": "cell-table-A"}}}
    view = {"v": 1, "subset": subset, "layout": layout}
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


class _Session:
    """A page on the committed fixture with the four plots and the table."""

    def __init__(self, pw, base, dataset, subset):
        try:
            self.browser = pw.chromium.launch()
        except Exception as exc:
            _skip_or_fail(f"Chromium cannot start: {exc}")
        self.page = self.browser.new_page(viewport={"width": 1800, "height": 1000})
        self.page.goto(_link(base, dataset, subset))
        self.page.wait_for_selector("#subset-button:not([hidden])", timeout=60_000)
        self.ids = list(PLOTS)
        self.failures = []
        self.previous = self.settled(N_CELLS if subset is None else subset["n"], {})
        assert sorted(self.previous) == sorted(PLOTS), f"plots drawn: {sorted(self.previous)}"
        self.page.evaluate(COUNT_DRAWS)

    def settled(self, want, previous):
        """Wait (bounded) for every plot to show `want` cells other than `previous`."""
        try:
            self.page.wait_for_function(
                """([want, previous, ids]) => { const d = (%s)();
                    return ids.every(i => d[i] && d[i].n === want && d[i].sig !== (previous[i] || {}).sig); }"""
                % DRAWN, arg=[want, previous, self.ids], timeout=40_000)
        except Exception:
            pass
        self.page.wait_for_timeout(1500)     # a redraw that is still coming would show here
        return self.page.evaluate(DRAWN)

    def expect(self, what, want):
        """After an action: every plot shows `want` new cells, drawn once; the table lists them.

        A step that fails is recorded and the next one goes on from what the
        page shows, so one run says which steps fail (see `done`)."""
        now = self.settled(want, self.previous)
        draws = self.page.evaluate("() => window.__draws")
        info = self.page.evaluate(TABLE_INFO)
        for pid in self.ids:
            if now[pid]["n"] != want:
                self.failures.append(f"{what}: {pid} shows {now[pid]['n']} cells, not {want}")
            elif now[pid]["sig"] == self.previous[pid]["sig"]:
                self.failures.append(f"{what}: {pid} still shows the old cells")
            elif draws.get(pid) != 1:
                self.failures.append(f"{what}: {pid} was drawn {draws.get(pid)} times")
        if not (info and f"of {want}" in info.replace(",", "")):
            self.failures.append(f"{what}: table says {info!r}")
        self.previous = now
        self.page.evaluate("() => { window.__draws = {}; }")

    def done(self):
        assert not self.failures, "; ".join(self.failures)

    def dialog(self, enabled=True, n=None, preset=None):
        """Open the subset dialog, set it, press Apply."""
        page = self.page
        page.click("#subset-button")
        page.wait_for_selector("#subset-modal.show", timeout=10_000)
        if preset is not None:
            page.click(f'#subset-presets button.subset-preset[data-n="{preset}"]')
        else:
            if page.is_checked("#subset-enabled") != enabled:
                page.click("#subset-enabled")
            if n is not None:
                page.fill("#subset-n", str(n))
        page.click("#subset-apply")
        page.wait_for_selector("#subset-modal.show", state="detached", timeout=10_000)


def test_part_step_redraws_every_cell_plot(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Session(pw, base, dataset, {"n": N_PART, "seed": 0})
        try:
            # the last step lists fewer rows: the table announces them mid-update
            for part, want in ((1, N_PART), (2, N_PART), (3, N_CELLS - 3 * N_PART)):
                s.page.click("#subset-part-next")
                s.expect(f"part {part}", want)
            s.done()
        finally:
            s.browser.close()


def test_dialog_activate_resize_preset_and_clear_redraw_every_cell_plot(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Session(pw, base, dataset, None)         # every cell
        try:
            s.dialog(n=N_PART)                         # every cell -> a subset
            s.expect("activate", N_PART)
            s.dialog(n=100)                            # another size
            s.expect("change n", 100)
            s.page.click("#subset-button")
            s.page.wait_for_selector("#subset-modal.show")
            chips = [int(n) for n in s.page.eval_on_selector_all(
                "#subset-presets button.subset-preset[data-n]:not([disabled])", "e => e.map(x => x.dataset.n)")]
            s.page.click("#subset-modal .btn-close")
            s.page.wait_for_selector("#subset-modal.show", state="detached")
            chip = next(n for n in chips if n not in (100, N_CELLS) and n < N_CELLS)
            s.dialog(preset=chip)                      # a preset
            s.expect(f"preset {chip}", chip)
            s.dialog(enabled=False)                    # back to every cell
            s.expect("clear", N_CELLS)
            s.done()
        finally:
            s.browser.close()


def test_table_notice_lands_after_a_slow_update_without_cancelling_it(server):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        s = _Session(pw, base, dataset, {"n": 150, "seed": 0})
        try:
            s.page.evaluate("""() => { window.__notices = []; const o = PanelManager.notifyPanels; const t0 = performance.now();
                PanelManager.notifyPanels = function (type, d) { const r = { type, start: performance.now() - t0 };
                  window.__notices.push(r);
                  return o.call(this, type, d).finally(() => { r.end = performance.now() - t0; }); }; }""")
            # a slow connection: the plots' reads are in flight when the table redraws with 50 rows
            s.page.route("**/api/v1/data/**", lambda route: (s.page.wait_for_timeout(300), route.continue_()))
            s.page.click("#subset-part-next")
            s.expect("slow part step", 50)
            notices = {n["type"]: n for n in s.page.evaluate("() => window.__notices")}
            assert {"subsetChanged", "tableFiltered"} <= set(notices), notices
            assert notices["tableFiltered"]["start"] < notices["subsetChanged"]["end"], \
                "the table notice must arrive while the update is still running, or this tests nothing"
            assert notices["tableFiltered"]["end"] >= notices["subsetChanged"]["end"], \
                "the table notice is delivered after the update it arrived in"
            s.done()
        finally:
            s.browser.close()
