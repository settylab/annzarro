"""Categories hidden with the legend stay hidden, by category, through table-filter redraws.

Reported: with a subset, a category hidden by a legend click, and a plot
linked to a filtered cell table, removing the cells not in the table and
showing them again (grey) hid and showed other cells in no clear pattern,
and moved the hidden entry to another category. Plotly kept the hidden
flag by trace index, and the 'Not in table' trace (first when the cells
are greyed out) or a category the filter empties moved every later trace
by one (utils/legend-entries.js withLegendState).

The committed 200-cell fixture plus `clone`, 120 categories (colour groups),
a 100-cell subset from the subset dialog, a cell plot linked to a cell
table. After every step, the hidden legend entries and the cells each
legend entry draws must be what the data says: the subset's cells, in the
table (or all of them while the grey ones are shown), of each entry's
category, none of a hidden one; the focus marker is never hidden.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
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

from annzarro.tests.zarr_compat import open_group, write_array, write_strings

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
N, CLONES = 200, 120
P, T = "cell-plot-L", "cell-table-L"
GD = f'.tile[data-tile-id="{P}"] .js-plotly-plot'
SEARCH = f'.tile[data-tile-id="{T}"] input[type="search"]'
GREY = "Not in table"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config=""):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_legend.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    obs = open_group(os.path.join(store, "obs"), mode="a")
    g = obs.create_group("clone")
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    write_array(g, "codes", (np.arange(N) % CLONES).astype(np.int16))
    write_strings(g, "categories", [f"clone{i:03d}" for i in range(CLONES)])
    zarr.consolidate_metadata(store)
    (home / "c.yaml").write_text(config or "ui: {}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "c.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    return root, store, proc


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, store, proc = _serve(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """The same store with every plot of more than 100 cells drawn in large-plot mode."""
    root, store, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1600, "height": 950})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root, store, remove, table=True):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {P: {"id": P, "x": x, "y": y, "z": None, "tableFilter": T if table else "none",
                "removeNonTableEntries": remove, "color": {"type": "obs", "key": "cell_type", "column": ""}}}
    hierarchy = [{"type": "tile", "id": P, "controlsVisible": True}]
    if table:
        cfgs[T] = {"id": T, "title": "Table", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
        hierarchy = [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 60}, {"percentage": 40}],
                      "children": [*hierarchy, {"type": "tile", "id": T, "controlsVisible": True}]}]
    view = {"v": 1, "subset": None, "layout": {"v": 1, "hierarchy": hierarchy,
            "controlState": {i: True for i in cfgs}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


# The plot as drawn: hidden legend entries (by legend group), the cells each
# entry draws, the grey cells, and whether a focus marker is hidden.
STATE = """() => {
    const gd = document.querySelector('%s');
    if (!gd || !gd.data) return null;
    const shown = t => t.visible !== 'legendonly' && t.visible !== false;
    const hidden = [...new Set(gd.data.filter(t => t.meta === 'az-legend' && !shown(t)).map(t => t.legendgroup))].sort();
    const entries = [...new Set(gd.data.filter(t => t.meta === 'az-legend').map(t => t.legendgroup))].sort();
    const drawn = {}, all = {};
    let grey = [], focusHidden = false;
    for (const t of gd.data) {
        if (/^focused/i.test(t.name || '')) { focusHidden = focusHidden || !shown(t); continue; }
        if (t.meta === 'az-legend' || !t.customdata) continue;
        if (t.name === '%s') { if (shown(t)) grey = grey.concat(Array.from(t.customdata)); continue; }
        (all[t.legendgroup] = all[t.legendgroup] || []).push(...t.customdata);
        if (shown(t)) (drawn[t.legendgroup] = drawn[t.legendgroup] || []).push(...t.customdata);
    }
    for (const k of Object.keys(drawn)) drawn[k].sort();
    for (const k of Object.keys(all)) all[k].sort();
    const legend = [...gd.querySelectorAll('.legend .traces')].map(n => n.__data__[0].trace.legendgroup).sort();
    return { hidden, entries, legend, drawn, all, grey: grey.sort(), focusHidden };
}""" % (GD, GREY)


class Data:
    """What the plot should draw, from the store and the subset."""

    def __init__(self, store):
        g = zarr.open(store, mode="r")
        self.names = [str(v) for v in g["obs/_index"][:]]
        self.of = {}
        for key in ("cell_type", "clone"):
            cats = [str(c) for c in g[f"obs/{key}/categories"][:]]
            self.of[key] = {n: cats[c] for n, c in zip(self.names, g[f"obs/{key}/codes"][:])}
        self.subset = None
        self.key = "cell_type"
        self.group = None      # colour groups: cell -> legend group, from the first draw

    def entry(self, cell):
        return self.group[cell] if self.group else self.of[self.key][cell]

    def expected(self, search, remove, hidden):
        in_table = [c for c in self.subset if search.lower() in c.lower() or search.lower() in self.of["cell_type"][c].lower()]
        entries = sorted({self.entry(c) for c in in_table})
        drawn = {}
        for c in in_table:
            if self.entry(c) not in hidden:
                drawn.setdefault(self.entry(c), []).append(c)
        grey = [] if remove or not search else sorted(set(self.subset) - set(in_table))
        return {"hidden": sorted(set(hidden) & set(entries)), "entries": entries, "legend": entries,
                "drawn": {k: sorted(v) for k, v in drawn.items()}, "grey": grey, "focusHidden": False}


def _check(page, data, step, search, remove, hidden):
    want = data.expected(search, remove, hidden)
    got = None
    for _ in range(300):
        got = page.evaluate(STATE)
        if got and {k: got[k] for k in want} == want:
            page.wait_for_timeout(300)          # and it stays so
            got = page.evaluate(STATE)
            if {k: got[k] for k in want} == want:
                return got
        page.wait_for_timeout(100)
    diff = {k: (got and got.get(k), v) for k, v in want.items() if not got or got.get(k) != v}
    raise AssertionError(f"{step}: (drawn, expected) differ in {diff}")


def _click_legend(page, group):
    """A click on the legend entry of `group` (as test_large_plot_legend_hidden.py: 64 entries overflow the pane)."""
    page.evaluate("""([sel, group]) => [...document.querySelector(sel).querySelectorAll('.legend .traces')]
        .find(n => n.__data__[0].trace.legendgroup === group).querySelector('.legendtoggle')
        .dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))""", [GD, group])


def _search(page, text):
    page.fill(SEARCH, text)


def _toggle(page):
    page.click(f"#remove-non-table-entries-{P}")


def _subset(page, n):
    page.click("#subset-button")
    page.wait_for_selector("#subset-apply", state="visible")
    page.click(f'#subset-presets button[data-n="{n}"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")


def test_hidden_categories_follow_their_category_through_table_toggles(page, server):
    root, store = server
    data = Data(store)
    page.goto(_link(root, store, remove=False))
    page.wait_for_selector(f'.tile[data-tile-id="{T}"] .dataTables_scrollBody tbody tr', timeout=30000)
    _subset(page, 100)
    page.wait_for_function("""(sel) => { const gd = document.querySelector(sel);
        return gd && gd.data && gd.data.filter(t => t.meta !== 'az-legend' && t.customdata && !/^focused/i.test(t.name || ''))
            .reduce((s, t) => s + t.customdata.length, 0) === 100; }""", arg=GD, timeout=90000)
    s = page.evaluate(STATE)
    data.subset = sorted(c for v in s["drawn"].values() for c in v)
    assert len(data.subset) == 100 and set(data.subset) < set(data.names)
    _check(page, data, "subset", "", False, set())

    hidden = {"Hepatocyte"}
    _click_legend(page, "Hepatocyte")
    _check(page, data, "Hepatocyte hidden", "", False, hidden)

    # cells not in the table greyed out: the grey trace comes first
    _search(page, "cell_01")
    _check(page, data, "table search", "cell_01", False, hidden)
    remove = False
    for i in range(4):
        _toggle(page)
        remove = not remove
        _check(page, data, f"toggle {i + 1} (remove={remove})", "cell_01", remove, hidden)

    # a filter that empties a hidden and a shown category: both come back as they were
    _search(page, "Kupffer")
    _check(page, data, "only Kupffer", "Kupffer", remove, hidden)
    for i in range(2):
        _toggle(page)
        remove = not remove
        _check(page, data, f"only Kupffer, toggle {i + 1} (remove={remove})", "Kupffer", remove, hidden)
    _search(page, "")
    _check(page, data, "search cleared", "", remove, hidden)

    # a second hidden category, then shown again
    _search(page, "cell_01")
    _click_legend(page, "Kupffer")
    hidden = {"Hepatocyte", "Kupffer"}
    _check(page, data, "Kupffer hidden too", "cell_01", remove, hidden)
    _toggle(page)
    remove = not remove
    _check(page, data, f"two hidden, toggle (remove={remove})", "cell_01", remove, hidden)
    _click_legend(page, "Kupffer")
    hidden = {"Hepatocyte"}
    _check(page, data, "Kupffer shown again", "cell_01", remove, hidden)
    _toggle(page)
    remove = not remove
    _check(page, data, f"Kupffer shown, toggle (remove={remove})", "cell_01", remove, hidden)

    # another colour column, in colour groups: nothing hidden there
    _search(page, "")
    page.select_option(f'.tile[data-tile-id="{P}"] select.axis-key-select[data-axis="color"]', "clone")
    page.wait_for_function("""(sel) => document.querySelector(sel).data
        .some(t => (t.legendgroup || '').startsWith('az-colour-group-'))""", arg=GD, timeout=30000)
    data.key = "clone"
    page.wait_for_timeout(500)
    s = page.evaluate(STATE)
    data.group = {c: k for k, v in s["all"].items() for c in v}
    assert sorted(data.group) == data.subset
    # each group holds whole clones
    by_clone = {}
    for c, k in data.group.items():
        by_clone.setdefault(data.of["clone"][c], set()).add(k)
    assert all(len(v) == 1 for v in by_clone.values()), by_clone
    hidden = set()
    _check(page, data, "coloured by clone", "", remove, hidden)

    group = data.group[sorted(data.subset, key=lambda c: (not c.startswith("cell_01"), c))[0]]
    _click_legend(page, group)
    hidden = {group}
    _check(page, data, "colour group hidden", "", remove, hidden)
    _search(page, "cell_01")
    _check(page, data, "colour group, table search", "cell_01", remove, hidden)
    for i in range(3):
        _toggle(page)
        remove = not remove
        _check(page, data, f"colour group, toggle {i + 1} (remove={remove})", "cell_01", remove, hidden)
    _search(page, "")
    _check(page, data, "colour group, search cleared", "", remove, hidden)


def test_hidden_categories_survive_large_plot_redraws(page, large_server):
    """Large-plot mode (no table filters there) redraws from scratch on every change: the hidden entry stays."""
    root, store = large_server
    data = Data(store)
    data.subset = data.names
    page.goto(_link(root, store, remove=False, table=False))
    page.wait_for_function("(sel) => { const g = document.querySelector(sel); return !!(g && g.__isLarge); }",
                           arg=GD, timeout=30000)
    # chunk traces carry no cell names: compare the points each entry draws
    count = """(sel) => { const gd = document.querySelector(sel); const out = {};
        for (const t of gd.data) if (t.meta === 'az-points' && t.visible !== 'legendonly') out[t.legendgroup] = (out[t.legendgroup] || 0) + t.x.length;
        return { hidden: [...new Set(gd.data.filter(t => t.meta === 'az-legend' && t.visible === 'legendonly').map(t => t.legendgroup))].sort(), drawn: out }; }"""
    sizes = {}
    for c in data.names:
        sizes[data.of["cell_type"][c]] = sizes.get(data.of["cell_type"][c], 0) + 1

    def check(step, hidden):
        want = {"hidden": sorted(hidden), "drawn": {k: v for k, v in sizes.items() if k not in hidden}}
        got = None
        for _ in range(150):
            got = page.evaluate(count, GD)
            if got == want:
                return
            page.wait_for_timeout(100)
        raise AssertionError(f"{step}: drawn {got}, expected {want}")

    check("large plot", set())
    _click_legend(page, "Hepatocyte")
    check("Hepatocyte hidden", {"Hepatocyte"})
    # another palette redraws the large plot from nothing
    for palette in ("Accent", "Set1"):
        before = page.evaluate("(sel) => document.querySelector(sel).data.find(t => t.meta === 'az-legend').marker.color", GD)
        page.select_option(f"#category-palette-{P}", palette)
        page.wait_for_function("""([sel, c]) => { const g = document.querySelector(sel);
            return g.__isLarge && g.data && g.data.some(t => t.meta === 'az-legend') && g.data.find(t => t.meta === 'az-legend').marker.color !== c; }""",
                               arg=[GD, before], timeout=30000)
        check(f"redrawn in palette {palette}", {"Hepatocyte"})
