"""The provider seam of the plots, second half (F3c-2), in a real browser.

A fake CATEGORICAL provider with 100 levels is registered at run time, before the app reads anything, and no
consumer file knows it. It must work where a registered source works: colour groups in the regular plot (its
`rankOf` decides each category's colour; a ranked provider's `groupNames` name the legend), the Hover picker (its own
group, and the hover line "Grouping A: L07"), large-plot mode's colour from its `loadLarge` codes (the legend, the
tooltip's line), and a refusal with the existing sentence where it is not a large-plot axis. The Node half is
annzarro/tests/js/source-seam-large.test.mjs.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points`` lowered to 100 (test_large_plot_mode's
server): every cell is "large", and a 100-cell subset is a regular plot.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_large_plot_mode import STORE, server  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

N = 200
MARK = "\x01"
LEVELS = 100
L = '.tile[data-tile-id="cell-plot-L"]'

# Cell i (of the cells shown) is in level i % 100 (L00 .. L99); the last of 200 has none. Ranks run against the codes
# (L99 is rank 0), so a colour drawn by code order is caught. `fake-ranked` sends ranks as its codes, with
# the legend's names (groupNames), as a provider that does not send every label would.
FAKE = """
window.__fakeLoads = [];
window.__fakeReady = Promise.all([import('/static/js/utils/source-registry.js'), import('/static/js/utils/coverage.js')]).then(([R, C]) => {
  const LEVELS = %d, MISSING = 65535;
  const categories = Array.from({ length: LEVELS }, (_, k) => 'L' + String(k).padStart(2, '0'));
  const rankOf = new Map(categories.map((c, k) => [c, LEVELS - 1 - k]));
  const colours = categories.map((_, k) => `rgb(${k}, 0, 0)`);
  const codesOf = (n) => { const codes = new Uint16Array(n);
    for (let i = 0; i < n; i++) codes[i] = i === 2 * LEVELS - 1 ? MISSING : i %% LEVELS; return codes; };
  const named = (setting) => { setting.label = setting.key === 'grp-1' ? 'Grouping A' : setting.key; };
  const base = (type) => ({
    type, valueType: 'categorical', entity: 'cells', consumers: ['cell-plot'], axes: ['x', 'y', 'color', 'hover'],
    largeAxes: ['color'], largeAxesReason: 'A fake grouping can colour a large plot, not be one of its axes.', defaultSub: '',
    // a set is picked under layer (G-SRC): its own section of the item list, no aggregation, a disabled layer
    aggregate: {
      sections: () => [{ heading: 'Fake groups', entries: [{ entry: 'grp-1', text: 'Grouping A' }] }],
      start: (id, layer, previous) => ({ type, key: id, column: '', history: { ...((previous && previous.history) || {}), layer: { key: layer } } }),
      entryOf: (setting) => setting.key,
      layerOf: (setting) => (setting.history && setting.history.layer && setting.history.layer.key) || '',
      methods: () => null,
      layers: () => ({ options: [{ value: 'X', text: 'X' }], chosen: 'X', disabled: true, title: 'A fake grouping reads no layer.' }),
      after: () => ({ say: '' }),
      symbolOf: () => ''
    },
    entities: () => [{ id: 'grp-1', title: 'Grouping A', open: true }],
    keyEntries: (list) => list.map(e => ({ value: e.id, text: e.title })),
    subKeys: () => [],
    titleOf: (setting) => `grouping ${setting.label || setting.key}`
  });
  R.registerSource({ ...base('fake-many'),
    load: async (setting, opts) => {
      window.__fakeLoads.push({ fn: 'load', type: 'fake-many', role: opts.role });
      named(setting);
      return { type: 'categorical', codes: codesOf(opts.expected || 0), MISSING, categories, colours, rankOf,
        coverage: C.Coverage.complete(opts.expected || 0, 'cells') };
    },
    loadLarge: async (setting, opts) => {
      window.__fakeLoads.push({ fn: 'loadLarge', type: 'fake-many', role: opts.role });
      named(setting);
      return { type: 'categorical', codes: codesOf(opts.expected || 0), MISSING, categories, colours, rankOf,
        coverage: C.Coverage.complete(opts.expected || 0, 'cells') };
    },
    hover: {
      group: 'Fake groupings',
      options: () => [{ value: 'fake-many:grp-1', label: 'Grouping A' }],
      valueOf: (setting) => `fake-many:${setting.key}`,
      parse: (value) => ({ key: value.slice('fake-many:'.length) }),
      label: (setting) => setting.label || setting.key
    }
  });
  const groupNames = Array.from({ length: 64 }, (_, g) => `Group ${g}`);
  R.registerSource({ ...base('fake-ranked'),
    load: async (setting, opts) => {
      window.__fakeLoads.push({ fn: 'load', type: 'fake-ranked', role: opts.role });
      named(setting);
      const codes = codesOf(opts.expected || 0).map(c => (c === MISSING ? c : LEVELS - 1 - c));
      return { type: 'categorical', codes, MISSING, categories: [], ranked: true, groupNames,
        coverage: C.Coverage.complete(opts.expected || 0, 'cells') };
    },
    loadLarge: async () => { throw new Error('not drawn large here'); }
  });
  const FEW = ['B cells', 'T cells', 'NK cells'], FEW_COLOURS = ['#1b9e77', '#d95f02', '#7570b3'];
  const few = (fn) => async (setting, opts) => {
    window.__fakeLoads.push({ fn, type: 'fake-few', role: opts.role });
    named(setting);
    const codes = new Uint8Array(opts.expected || 0).map((_, i) => i %% 3);
    return { type: 'categorical', codes, MISSING: 255, categories: FEW, colours: FEW_COLOURS,
      coverage: C.Coverage.complete(opts.expected || 0, 'cells') };
  };
  R.registerSource({ ...base('fake-few'), load: few('load'), loadLarge: few('loadLarge') });
});
// every uns key the plots ask for (DataManager.loadUns answers a key the store lacks without a request)
window.__unsKeys = [];
window.__unsReady = import('/static/js/data-manager.js').then(({ DataManager }) => {
  const real = DataManager.loadUns;
  DataManager.loadUns = (options, ...rest) => { window.__unsKeys.push(options && options.unsKey); return real(options, ...rest); };
});
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => { await window.__fakeReady; await window.__unsReady; return realFetch(url, init); };
""" % LEVELS

UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
MANY = {"type": "fake-many", "key": "grp-1", "column": ""}
RANKED = {"type": "fake-ranked", "key": "grp-1", "column": ""}
FEW = {"type": "fake-few", "key": "grp-1", "column": ""}
SUBSET = {"n": LEVELS, "seed": 0}


@pytest.fixture
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


def _page(browser):
    page = browser.new_page(viewport={"width": 1400, "height": 950})
    page.add_init_script(FAKE)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.__errors = errors
    return page


def _link(root, x=UMAP_X, colour=MANY, subset=None, **extra):
    cfg = {"id": "cell-plot-L", "title": "t", "x": x, "y": UMAP_Y, "z": None, "color": colour,
           "pointSize": 8, "pointOpacity": 1}
    cfg.update(extra)
    view = {"v": 1, "subset": subset, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-L", "controlsVisible": True}],
                               "controlState": {"cell-plot-L": True}, "panelConfigs": {"cell-plot-L": cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


GROUPS = """(tile) => {
  const g = document.querySelector(tile + ' .js-plotly-plot');
  if (!g || !g.data || document.querySelector(tile + ' .loading-overlay')) return null;
  const groups = g.data.filter(t => typeof t.legendgroup === 'string' && t.legendgroup.startsWith('az-colour-group-')
      && Array.isArray(t.x) && t.x.length && t.x[0] !== null);
  if (!groups.length) return null;
  return groups.map(t => ({ group: t.legendgroup, name: t.name, colour: t.marker && t.marker.color,
      labels: Array.isArray(t._azLabels) ? [...new Set(t._azLabels)].sort() : null, points: t.x.length,
      hovertext: Array.isArray(t.hovertext) ? t.hovertext.slice(0, 3) : null }));
}"""


def _expected_groups(page):
    """Each colour group's categories by rank (rank r in group r % 64), as the page's own helpers name them."""
    return page.evaluate("""async (levels) => {
        const C = await import('/static/js/utils/categories.js');
        const out = {};
        for (let r = 0; r < levels; r++) {
            const g = C.groupOf(r), label = 'L' + String(levels - 1 - r).padStart(2, '0');
            (out[C.colourGroupKey(g)] = out[C.colourGroupKey(g)] || []).push(label);
        }
        return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { labels: [...v].sort(), name: C.groupLegendName(v) }]));
    }""", LEVELS)


def test_colour_groups_follow_the_providers_ranks(browser, server):
    page = _page(browser)
    page.goto(_link(server, subset=SUBSET))
    groups = until(page, GROUPS, L)
    want = _expected_groups(page)
    assert len(groups) == 64, "100 levels are drawn in 64 colour groups"
    got = {g["group"]: g for g in groups}
    assert set(got) == set(want)
    for key, w in want.items():
        assert got[key]["labels"] == w["labels"], (key, got[key]["labels"])
        assert got[key]["name"] == w["name"], "the legend names the group's categories, largest first"
    assert {r["role"] for r in page.evaluate("() => window.__fakeLoads")} == {"color"}
    assert not page.__errors, page.__errors


def test_a_ranked_provider_names_its_groups(browser, server):
    page = _page(browser)
    page.goto(_link(server, colour=RANKED, subset=SUBSET))
    groups = until(page, GROUPS, L)
    assert sorted(g["name"] for g in groups) == sorted(f"Group {g}" for g in range(64)), "the provider's groupNames"
    assert not page.__errors, page.__errors


def test_the_hover_picker_lists_the_provider_and_the_hover_line_reads_it(browser, server):
    page = _page(browser)
    page.goto(_link(server, colour={"type": "obs", "key": "total_counts", "column": ""}, subset=SUBSET))
    page.wait_for_function("""(tile) => { const s = document.querySelector(tile + ' select.hover-columns-select');
        return !!s && [...s.querySelectorAll('optgroup')].some(g => g.label === 'Fake groupings'); }""", arg=L, timeout=30000)
    group = page.evaluate("""(tile) => [...document.querySelectorAll(tile + ' select.hover-columns-select optgroup')]
        .filter(g => g.label === 'Fake groupings').map(g => [...g.children].map(o => [o.value, o.textContent, o.selected]))""", L)
    assert group == [[["fake-many:grp-1", "Grouping A", False]]]
    until(page, "(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot'); return !!(g && g.data && g.data.length); }", L)
    page.select_option(f"{L} select.hover-columns-select", ["fake-many:grp-1"])
    texts = until(page, """(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
        const t = g && g.data && g.data.find(d => Array.isArray(d.hovertext) && d.hovertext.some(h => String(h).includes('Grouping A: ')));
        return t ? { names: t.customdata, hovertext: t.hovertext } : null; }""", L)
    names = page.evaluate("async () => Array.from((await import('/static/js/data-manager.js')).DataManager.getCells())")
    for name, line in zip(texts["names"], texts["hovertext"]):
        i = names.index(name)
        assert line == f"<br>Grouping A: L{i % LEVELS:02d}", (name, line)
    hover = page.evaluate("() => window.PanelManager.getPanel('cell-plot-L').getConfig().hoverInfo")
    assert {"type": "fake-many", "key": "grp-1"} in [{k: h[k] for k in ("type", "key")} for h in hover]
    assert "hover:grp-1::" in {r["role"] for r in page.evaluate("() => window.__fakeLoads")}
    assert not page.__errors, page.__errors


LARGE = """(tile) => {
  const t = document.querySelector(tile);
  const g = t && t.querySelector('.js-plotly-plot');
  if (!t || !t.querySelector('.plot-status .ps-tag[data-tag="large"]') || !g || !g._fullData || !g.__largeState) return null;
  const legend = g._fullData.filter(d => d.meta === 'az-legend').map(d => ({ name: d.name, group: d.legendgroup }));
  return legend.length ? { legend } : null;
}"""


def test_a_large_plot_is_coloured_from_the_providers_codes(browser, server):
    page = _page(browser)
    page.goto(_link(server))
    drawn = until(page, LARGE, L)
    loads = page.evaluate("() => window.__fakeLoads")
    assert {(r["fn"], r["role"]) for r in loads} == {("loadLarge", "color")}, "the large plot's form, never the plain array"
    want = _expected_groups(page)
    names = {d["group"]: d["name"] for d in drawn["legend"] if d["group"] in want}
    assert names == {k: w["name"] for k, w in want.items()}, "64 colour groups, named by their drawn categories"
    assert "NA" in [d["name"] for d in drawn["legend"]]
    # the tooltip's colour line is read from the codes the plot holds: the row's category
    until(page, """(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
        return !!(g && g.__largeState && g.__largeState.index && g._fullLayout); }""", L)
    row = 31
    spot = page.evaluate("""([tile, row]) => {
        const g = document.querySelector(tile + ' .js-plotly-plot'), idx = g.__largeState.index;
        const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis, r = g.querySelector('.nsewdrag').getBoundingClientRect();
        const p = Array.from(idx.rows).indexOf(row);
        return { x: r.left + xa.l2p(idx.X[p]), y: r.top + ya.l2p(idx.Y[p]) };
    }""", [L, row])
    page.mouse.move(spot["x"] - 60, spot["y"] - 60)
    page.mouse.move(spot["x"], spot["y"], steps=4)
    tip = until(page, """() => { const t = document.querySelector('.large-plot-tip');
        const rows = t && t.style.display !== 'none' ? Array.from(t.children).map(c => c.textContent) : [];
        return rows.some(r => r.startsWith('Grouping A: ')) ? rows : null; }""")
    hovered = page.evaluate("""(tile) => document.querySelector(tile + ' .js-plotly-plot').__largeState.hovered""", L)
    hovered_row = page.evaluate("""([tile, p]) => document.querySelector(tile + ' .js-plotly-plot').__largeState.index.rows[p]""", [L, hovered])
    assert f"Grouping A: L{hovered_row % LEVELS:02d}" in tip, (tip, hovered_row)
    assert not page.__errors, page.__errors


def test_a_large_plot_draws_a_providers_own_colours(browser, server):
    page = _page(browser)
    page.goto(_link(server, colour=FEW, categoryPalette="uns"))
    until(page, LARGE, L)
    legend = page.evaluate("""(tile) => document.querySelector(tile + ' .js-plotly-plot')._fullData
        .filter(d => d.meta === 'az-legend').map(d => [d.name, d.marker.color])""", L)
    assert legend == [["B cells", "#1b9e77"], ["T cells", "#d95f02"], ["NK cells", "#7570b3"]], "the provider's colours, not uns"
    assert page.evaluate("""(t) => !document.querySelector(t + ' .plot-status .ps-tag[data-tag="uns-palette"]')""", L)
    assert not page.__errors, page.__errors


def test_a_grouping_is_refused_as_a_large_plot_axis(browser, server):
    page = _page(browser)
    page.goto(_link(server, x=MANY, colour={"type": "none", "key": "", "column": ""}))
    text = until(page, """(tile) => { const p = document.querySelector(tile + ' .coverage-placeholder');
        return p && /not available/.test(p.textContent) ? p.textContent.replace(/\\s+/g, ' ').trim() : null; }""", L)
    assert ("An x axis from fake-many is not available for 200 points: turn on a subset, or choose an embedding (obsm), "
            "an obs column or a gene") in text
    # the item lists (a grouping is picked under layer): the x row, which holds it, and the y and colour rows once on layer
    value = MARK + "fake-many" + MARK + "grp-1"
    page.wait_for_function("""([tile, v]) => { const o = [...document.querySelectorAll(tile + ' select.axis-column-select[data-axis="x"] option')].find(o => o.value === v);
        return !!o && o.disabled; }""", arg=[L, value], timeout=30000)
    for axis in ("y", "color"):
        page.select_option(f'{L} select.axis-type-select[data-axis="{axis}"]', "layer")
        page.wait_for_function("""([tile, axis, v]) => [...document.querySelectorAll(`${tile} select.axis-column-select[data-axis="${axis}"] option`)].some(o => o.value === v)""",
                               arg=[L, axis, value], timeout=30000)
    state = page.evaluate("""([tile, v]) => ['x', 'y', 'color'].map(axis => {
        const o = [...document.querySelectorAll(`${tile} select.axis-column-select[data-axis="${axis}"] option`)].find(o => o.value === v);
        return [axis, o.disabled, o.getAttribute('title')]; })""", [L, value])
    reason = "A fake grouping can colour a large plot, not be one of its axes."
    assert state == [["x", True, reason], ["y", True, reason], ["color", False, None]], state
    assert not page.__errors, page.__errors


TRACE_COLOURS = """(tile) => {
  const g = document.querySelector(tile + ' .js-plotly-plot');
  if (!g || !g.data || document.querySelector(tile + ' .loading-overlay')) return null;
  const named = g.data.filter(t => t.meta !== 'az-legend' && typeof t.name === 'string' && !/Focused/.test(t.name) && typeof (t.marker && t.marker.color) === 'string'
      && Array.isArray(t.x) && t.x.length);
  return named.length ? Object.fromEntries(named.map(t => [t.name, t.marker.color])) : null;
}"""

FEW_COLOURS = {"B cells": "#1b9e77", "T cells": "#d95f02", "NK cells": "#7570b3"}
CELL_TYPE = {"type": "obs", "key": "cell_type", "column": ""}


def _recolour(page, kind, value):
    """Choose in a colour row's `type`, `key` or `column` select."""
    page.select_option(f'{L} select.axis-{kind}-select[data-axis="color"]', value)


def _wait_colours(page, names):
    return until(page, """([tile, names]) => { const c = (%s)(tile);
        return c && names.every(n => n in c) ? c : null; }""" % TRACE_COLOURS, [L, names])


def _cell_type_colours(browser, server):
    """cell_type's colours as a full draw gives them (its uns palette, or the default)."""
    page = _page(browser)
    page.goto(_link(server, colour=CELL_TYPE, subset=SUBSET, categoryPalette="uns"))
    colours = until(page, TRACE_COLOURS, L)
    page.close()
    return colours


def test_recolour_takes_a_providers_colours_and_a_columns_back(browser, server):
    """Recolouring from the menus (plot-update.js) uses a provider's own colours and asks uns for nothing under its
    key; recolouring back to a column drops them and reads the column's uns palette again, as a full draw does."""
    want = _cell_type_colours(browser, server)
    assert set(want.values()) & set(FEW_COLOURS.values()) == set()
    page = _page(browser)
    page.goto(_link(server, colour=CELL_TYPE, subset=SUBSET, categoryPalette="uns"))
    assert until(page, TRACE_COLOURS, L) == want
    # the provider is picked under layer: layer in the first select, then its entry in the item list
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-type-select[data-axis="color"] option`)]
        .some(o => o.value === 'layer')""", arg=L, timeout=30000)
    _recolour(page, "type", "layer")
    entry = MARK + "fake-few" + MARK + "grp-1"
    page.wait_for_function("""([tile, v]) => [...document.querySelectorAll(`${tile} select.axis-column-select[data-axis="color"] option`)].some(o => o.value === v)""",
                           arg=[L, entry], timeout=30000)
    _recolour(page, "column", entry)
    assert _wait_colours(page, list(FEW_COLOURS)) == FEW_COLOURS, "the provider's own colours"
    assert not [k for k in page.evaluate("() => window.__unsKeys") if k and k.startswith("grp-1")], "no uns lookup under a panel id"
    asked = len(page.evaluate("() => window.__unsKeys"))
    _recolour(page, "type", "obs")
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-key-select[data-axis="color"] option`)]
        .some(o => o.value === 'cell_type')""", arg=L, timeout=30000)
    _recolour(page, "key", "cell_type")
    assert _wait_colours(page, list(want)) == want, "the column's colours again, not the provider's"
    assert "cell_type_colors" in page.evaluate("() => window.__unsKeys")[asked:], "the column's uns palette is read again"
    assert not page.__errors, page.__errors


def test_a_column_recoloured_after_a_provider_drops_its_colours(browser, server):
    """The review's case (M11): a provider's colours drawn in full, then a column chosen from the menus: the column's
    own colours, read from its uns key, never the provider's left over."""
    want = _cell_type_colours(browser, server)
    page = _page(browser)
    page.goto(_link(server, colour=FEW, subset=SUBSET, categoryPalette="uns"))
    assert _wait_colours(page, list(FEW_COLOURS)) == FEW_COLOURS
    assert not [k for k in page.evaluate("() => window.__unsKeys") if k and k.startswith("grp-1")], "no uns lookup under a panel id"
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-type-select[data-axis="color"] option`)]
        .some(o => o.value === 'obs')""", arg=L, timeout=30000)
    _recolour(page, "type", "obs")
    page.wait_for_function("""(tile) => [...document.querySelectorAll(`${tile} select.axis-key-select[data-axis="color"] option`)]
        .some(o => o.value === 'cell_type')""", arg=L, timeout=30000)
    _recolour(page, "key", "cell_type")
    assert _wait_colours(page, list(want)) == want, "the column's colours, not the provider's"
    assert "cell_type_colors" in page.evaluate("() => window.__unsKeys")
    assert not page.__errors, page.__errors
