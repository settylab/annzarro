"""The provider seam of the plots (F3c-1), in a real browser.

A fake CATEGORICAL provider is registered at run time, before the app reads anything, and no consumer file knows
it. It must work where a registered source works: the type menu (a Cell Plot's colour and x list it, its z and a
Gene Plot do not), the key list (its entities, open or closed, and one that is gone), the colour (one trace per
category, named in the legend's title; drawn from a link, in the provider's own colours), an axis (a category axis, titled by the
entity) and the link round trip. The Node half is annzarro/tests/js/source-seam.test.mjs.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import json
import os
import re
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import UMAP_X, UMAP_Y, served  # noqa: E402,F401

C = '.tile[data-tile-id="cell-plot-C"]'
G = '.tile[data-tile-id="gene-plot-G"]'
CATEGORIES = ["B cells", "T cells", "NK cells"]
COLOURS = ["#1b9e77", "#d95f02", "#7570b3"]

# Registered before the app's first request: every fetch waits for it, so a link never reaches the plots first.
FAKE = """
window.__fakeLoads = [];
window.__fakeReady = Promise.all([import('/static/js/utils/source-registry.js'), import('/static/js/utils/coverage.js')]).then(([R, C]) => {
  const ENTITIES = [{ id: 'grp-1', title: 'Grouping A', open: true }, { id: 'grp-2', title: 'Grouping B', open: false }];
  const MISSING = 255;
  R.registerSource({
    type: 'fake-group', label: 'fake groups', entity: 'cells', consumers: ['cell-plot'], axes: ['x', 'y', 'color'], defaultSub: '',
    entities: () => ENTITIES,
    keyEntries: (list, setting) => {
      const out = list.map(e => ({ value: e.id, text: e.title }));
      if (setting.key && !list.some(e => e.id === setting.key)) out.push({ value: setting.key, text: `${setting.label || setting.key} (deleted)` });
      return out;
    },
    subKeys: () => [],
    titleOf: (setting) => `grouping ${setting.label || setting.key}`,
    load: async (setting, opts) => {
      window.__fakeLoads.push({ key: setting.key, role: opts.role });
      const found = ENTITIES.find(e => e.id === setting.key);
      if (found) setting.label = found.title;
      const n = opts.expected || 0;
      const codes = new Uint8Array(n);
      for (let i = 0; i < n; i++) codes[i] = i %% 10 === 9 ? MISSING : i %% 3;
      return { type: 'categorical', codes, MISSING, categories: %s, colours: %s, coverage: C.Coverage.complete(n, 'cells') };
    }
  });
});
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => { await window.__fakeReady; return realFetch(url, init); };
""" % (json.dumps(CATEGORIES), json.dumps(COLOURS))

NONE = {"type": "none", "key": "", "column": ""}
FAKE_COLOUR = {"type": "fake-group", "key": "grp-1", "column": ""}


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            page.add_init_script(FAKE)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _cell(**extra):
    cfg = {"id": "cell-plot-C", "title": "Cell Plot 1", "x": UMAP_X, "y": UMAP_Y, "z": None, "color": NONE,
           "pointSize": 8, "pointOpacity": 1, "categoryPalette": "uns"}
    cfg.update(extra)
    return cfg


def _gene():
    mean = {"type": "var", "key": "mean", "column": ""}
    return {"id": "gene-plot-G", "title": "Gene Plot 1", "x": mean, "y": mean, "z": None, "color": NONE}


def _link(served, configs, open_ids):
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]
    hierarchy = tiles if len(tiles) == 1 else [{"type": "split", "direction": "horizontal",
                                                "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    return _view_url(served, view)


def _view_url(served, view):
    root, store = served
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _options(page, tile, kind, axis):
    return page.evaluate("""([tile, kind, axis]) => [...document.querySelectorAll(`${tile} select.axis-${kind}-select[data-axis="${axis}"] option`)]
        .map(o => [o.value, o.textContent])""", [tile, kind, axis])


def _traces(page, tile=C):
    """Each drawn trace's name and marker colour."""
    return page.evaluate("""(tile) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        return gd && gd.data ? gd.data.map(t => [t.name || '', typeof (t.marker && t.marker.color) === 'string' ? t.marker.color : null]) : [];
    }""", tile)


def _wait_categories(page, tile=C):
    page.wait_for_function("""([tile, names]) => {
        const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.data && names.every(n => gd.data.some(t => t.name === n)) && !document.querySelector(tile + ' .loading-overlay'));
    }""", arg=[tile, CATEGORIES], timeout=30000)


def _layout(page, path, tile=C):
    return page.evaluate("""([tile, path]) => {
        let v = document.querySelector(tile + ' .js-plotly-plot').layout;
        for (const k of path) v = v == null ? v : v[k];
        return v;
    }""", [tile, path])


def _legend(page, tile=C):
    """The legend's title as read: its markup (spacing lines, a sized span) left out."""
    text = _layout(page, ["legend", "title", "text"], tile) or ""
    return re.sub(r"<[^>]+>", " ", text).replace("\xa0", " ").strip()


def _wait_menus(page, tile):
    page.wait_for_function("""(tile) => { const s = document.querySelector(`${tile} select.axis-type-select[data-axis="color"]`);
        return !!s && [...s.options].some(o => o.value === 'obs' || o.value === 'var'); }""", arg=tile, timeout=30000)


def test_the_type_menu_lists_the_provider_where_it_is_accepted(page, served):
    page.goto(_link(served, {"cell-plot-C": _cell(), "gene-plot-G": _gene()}, ["cell-plot-C", "gene-plot-G"]))
    _wait_menus(page, C)
    _wait_menus(page, G)
    assert ["fake-group", "fake groups"] in _options(page, C, "type", "color")
    assert ["fake-group", "fake groups"] in _options(page, C, "type", "x")
    assert "fake-group" not in [v for v, _ in _options(page, C, "type", "z")], "it takes no z"
    for axis in ("x", "color"):
        assert "fake-group" not in [v for v, _ in _options(page, G, "type", axis)], "a cell source is not a Gene Plot's"


def test_colour_from_the_menus_and_the_key_list(page, served):
    page.goto(_link(served, {"cell-plot-C": _cell()}, ["cell-plot-C"]))
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_menus(page, C)
    page.select_option(f'{C} select.axis-type-select[data-axis="color"]', "fake-group")
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-key-select[data-axis="color"] option`)]
        .some(o => o.value === 'grp-2')""", arg=C, timeout=30000)
    assert _options(page, C, "key", "color") == [["grp-1", "Grouping A"], ["grp-2", "Grouping B"]], "open and closed entities"
    assert page.is_disabled(f'{C} select.axis-column-select[data-axis="color"]'), "no sub-keys: no third menu"
    _wait_categories(page)
    assert _legend(page) == "Grouping A", "the legend names the entity"
    assert window_loads(page)[-1] == {"key": "grp-1", "role": "color"}
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', "grp-2")
    page.wait_for_function("""(tile) => { const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.layout && gd.layout.legend && gd.layout.legend.title && String(gd.layout.legend.title.text).includes('Grouping B')); }""",
                           arg=C, timeout=30000)
    assert _legend(page) == "Grouping B"
    assert window_loads(page)[-1] == {"key": "grp-2", "role": "color"}


def window_loads(page):
    return page.evaluate("() => window.__fakeLoads")


def test_an_axis_and_the_link_round_trip(page, served):
    page.goto(_link(served, {"cell-plot-C": _cell(color=FAKE_COLOUR)}, ["cell-plot-C"]))
    _wait_categories(page)
    drawn = dict(_traces(page))
    assert [drawn[n] for n in CATEGORIES] == COLOURS, "the provider's own colours, one per category"
    _wait_menus(page, C)
    page.select_option(f'{C} select.axis-type-select[data-axis="x"]', "fake-group")
    page.wait_for_function("""(tile) => { const gd = document.querySelector(tile + ' .js-plotly-plot');
        return !!(gd && gd.layout && gd.layout.xaxis && gd.layout.xaxis.title && gd.layout.xaxis.title.text === 'Grouping A'
            && !document.querySelector(tile + ' .loading-overlay')); }""", arg=C, timeout=30000)
    assert _layout(page, ["xaxis", "type"]) == "category", "categories are drawn on a category axis"
    assert {r["role"] for r in window_loads(page)} >= {"x", "color"}
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    cfg = view["layout"]["panelConfigs"]["cell-plot-C"]
    assert cfg["x"]["type"] == "fake-group" and cfg["x"]["key"] == "grp-1"
    assert cfg["color"]["type"] == "fake-group" and cfg["color"]["key"] == "grp-1"
    want = sorted(_traces(page))
    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(FAKE)
    try:
        other.goto(_view_url(served, view))
        _wait_categories(other)
        assert sorted(_traces(other)) == want, "the same categories in the same colours"
        assert _layout(other, ["xaxis", "title", "text"]) == "Grouping A"
        assert _legend(other) == "Grouping A"
        assert _layout(other, ["xaxis", "type"]) == "category"
        xs = other.evaluate("""(tile) => [...new Set(document.querySelector(tile + ' .js-plotly-plot').data
            .flatMap(t => Array.from(t.x || [])).filter(v => typeof v === 'string'))]""", C)
        assert sorted(xs) == sorted(CATEGORIES), "the x axis shows the provider's categories"
    finally:
        other.close()


def test_a_key_that_is_gone_is_kept_and_listed(page, served):
    page.goto(_link(served, {"cell-plot-C": _cell(color={**FAKE_COLOUR, "key": "grp-9", "label": "Old grouping"})}, ["cell-plot-C"]))
    _wait_menus(page, C)
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-key-select[data-axis="color"] option`)]
        .some(o => o.value === 'grp-9')""", arg=C, timeout=30000)
    assert _options(page, C, "key", "color")[-1] == ["grp-9", "Old grouping (deleted)"]
    assert page.eval_on_selector(f'{C} select.axis-key-select[data-axis="color"]', "s => s.value") == "grp-9"
