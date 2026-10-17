"""Every plotting option of a panel survives a share link, a panel set, the autosave and Duplicate.

The options are listed once, with a non-default value each, in tests/js/plot-option-cases.json
(the Node test of the pure serialisation reads the same file). Here the panels are real:

1. first draw == live change: a plot opened from a config looks exactly like the plot a person
   gets by changing the option in Plot Options (the Publication preset lost its axis lines on
   every opened link because the first draw took them from the grid switch);
2. all options at once travel through the four routes and give the same settings and the
   same drawn layout, in the app's own colour scheme and in the opposite one.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_plot_options as T  # noqa: E402
from annzarro.tests.browser.test_memory_guard import STORE  # noqa: E402

A, B = T.A, T.B
HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(os.path.dirname(HERE), "js", "plot-option-cases.json")))["cases"]
SHOTS = os.environ.get("ANNZARRO_SHOTS")
MENU = "/static/js/panels/plot-utilities/plot-aesthetics-menu.js"

server = T.server

# what the drawn plot shows, without the ranges the data and the window decide
LOOK = """(id) => {
  const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
  const L = gd._fullLayout;
  const skip = new Set(['range', 'autorange', 'domain', 'uirevision', 'rangeslider', 'anchor', 'position', '_input', 'tickvals', 'ticktext',
                        'tick0', 'dtick', 'scaleanchor', 'constrain', 'constraintoward', 'automargin', 'layer', 'categoryarray', 'revision']);
  const plain = (o, depth = 0) => {
    if (o === null || typeof o !== 'object') return typeof o === 'function' ? undefined : o;
    if (Array.isArray(o)) return o.length > 40 ? ['<' + o.length + '>'] : o.map(v => plain(v, depth + 1));
    if (depth > 4) return undefined;
    const out = {};
    for (const k of Object.keys(o).sort()) {
      if (k.startsWith('_') || skip.has(k)) continue;
      const v = plain(o[k], depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  const axes = {};
  for (const k of Object.keys(L).filter(k => /^(x|y)axis$/.test(k))) axes[k] = plain(L[k]);
  const scene = L.scene ? { xaxis: plain(L.scene.xaxis), yaxis: plain(L.scene.yaxis), zaxis: plain(L.scene.zaxis), bgcolor: L.scene.bgcolor } : null;
  // a series is told by its length and its distinct values, not by listing the cells
  const series = (v) => Array.isArray(v) || ArrayBuffer.isView(v) ? { n: v.length, distinct: [...new Set(Array.from(v).map(x => typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x))].slice(0, 8) } : v;
  const traces = gd._fullData.map(t => { const m = t.marker || {};
    return { type: t.type, name: t.name, mode: t.mode, showlegend: t.showlegend, opacity: t.opacity, n: t.x ? t.x.length : 0,
      marker: { color: series(m.color), size: series(m.size), opacity: series(m.opacity), line: plain(m.line), symbol: m.symbol,
                colorscale: plain(m.colorscale), reversescale: m.reversescale, cmin: m.cmin, cmax: m.cmax },
      colorbar: m.colorbar ? plain(m.colorbar) : null }; });
  // the scale bar's annotation lies inside the autorange, so its place drifts a little with every redraw: compare its length and side
  const mid = L.xaxis ? (L.xaxis.range[0] + L.xaxis.range[1]) / 2 : 0;
  const bar = (items) => (items || []).map(it => it && it.name === 'az-scalebar'
    ? { ...plain(it), x: undefined, x0: undefined, x1: undefined, side: (it.x !== undefined ? it.x : it.x0) < mid ? 'left' : 'right',
        length: it.x1 !== undefined ? Math.round((it.x1 - it.x0) * 1e3) / 1e3 : undefined } : plain(it));
  return { paper: L.paper_bgcolor, plot: L.plot_bgcolor, font: plain(L.font), margin: plain(L.margin), legend: plain(L.legend),
           showlegend: L.showlegend, hovermode: L.hovermode, dragmode: L.dragmode, modebar: plain(L.modebar),
           shapes: bar(L.shapes), annotations: bar(L.annotations), axes, scene, traces };
}"""

# the settings a panel keeps (what saveLayout() hands on)
CONFIG = "(id) => window.PanelManager.saveLayout().panelConfigs[id]"
# the app's colour scheme at the time
SCHEMES = ["light", "dark"]
IGNORED = {"id", "_closed", "viewport2D", "viewport3D", "colorRangeUnits", "hoverInfo", "history", "controlsVisible", "x", "y", "z", "color"}


def _diff(a, b, path="", tol=0.02):
    """The differences between two plain structures; numbers within `tol` of their size count as equal (a few pixels of range)."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += _diff(a.get(k, "<missing>"), b.get(k, "<missing>"), f"{path}.{k}", tol)
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += _diff(x, y, f"{path}[{i}]", tol)
        return out
    if isinstance(a, float) and isinstance(b, float):
        return [] if abs(a - b) <= tol * max(1.0, abs(a), abs(b)) else [f"{path}: {a!r} != {b!r}"]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def _base(case):
    """The two plots' configs for a case: the key set to its value."""
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    panel = case["panel"]
    if panel == "b":
        cfg = {"id": B, "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "total_counts", "column": ""}}
    elif panel == "a3d":
        cfg = {"id": A, "x": x, "y": y, "z": {"type": "obsm", "key": "X_umap", "column": "0"},
               "color": {"type": "obs", "key": "cell_type", "column": ""}}
    else:
        cfg = {"id": A, "x": x, "y": y, "z": None, "equalAspect": True, "color": {"type": "obs", "key": "cell_type", "column": ""}}
    return cfg


def _tab(browser, scheme):
    ctx = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme=scheme)
    ctx.set_default_timeout(60000)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    return ctx, page, errors


def _view_url(root, layout):
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view=" + _encode(layout)


def _encode(layout):
    import base64
    return base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")


def _layout(cfgs):
    """The first two plots side by side, any further plot in a row of its own."""
    ids = list(cfgs)
    tile = lambda i: {"type": "tile", "id": i, "controlsVisible": True}
    nodes = [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}],
              "children": [tile(i) for i in ids[:2]]}] if len(ids) > 1 else [tile(ids[0])]
    nodes += [tile(i) for i in ids[2:]]
    return {"v": 1, "hierarchy": nodes, "controlState": {i: True for i in ids}, "panelConfigs": cfgs}


DRAWN = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd.data && gd.data.some(t => t.x && t.x.length > 1)
    && ((gd._fullLayout.xaxis && gd._fullLayout.xaxis.range) || gd._fullLayout.scene)); }""" % T.GD


def _goto(page, url):
    """page.goto, again when the machine is out of local sockets (ERR_ADDRESS_INVALID under many parallel browsers)."""
    for attempt in range(4):
        try:
            page.goto(url)
            return
        except playwright.Error as e:
            if "ERR_ADDRESS_INVALID" not in str(e) or attempt == 3:
                raise
            page.wait_for_timeout(1500)


def _open_cfgs(page, root, cfgs):
    """Open the panels; the other of the two plots is there with its defaults so the split has two sides."""
    cfgs = dict(cfgs)
    for pid, other in ((A, _base({"panel": "a"})), (B, _base({"panel": "b"}))):
        cfgs.setdefault(pid, other)
    _goto(page, _view_url(root, _layout(cfgs)))
    for pid in cfgs:
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1200)


# the control of Plot Options (or of the panel) that sets each option: (how, id of the control)
CONTROLS = {
    "bgColor": ("color", "plot-bg-color"), "gridColor": ("color", "grid-color"), "axisColor": ("color", "axis-color"),
    "textColor": ("color", "text-color"), "zeroLineColor": ("color", "zero-line-color"), "backdropColor": ("color", "backdrop-color"),
    "notInTableColor": ("color", "not-in-table-color"), "focusedColor": ("color", "focused-color"),
    "focusedEdgeColor": ("color", "focused-edge-color"),
    "showGrid": ("check", "grid-toggle"), "showAxisTitles": ("check", "show-axis-titles"), "showAxisLabels": ("check", "show-axis-labels"),
    "showAxisLines": ("check", "show-axis-lines"), "showZeroLines": ("check", "zero-lines"), "showBackdrop": ("check", "show-backdrop"),
    "showTickMarks": ("check", "show-tick-marks"), "showLegend": ("check", "show-legend"), "showScaleBar": ("check", "show-scale-bar"),
    "marginsUnlinked": ("check", "margins-unlink"), "focusedNoFill": ("check", "focused-no-fill"),
    "tickCount": ("fill", "tick-count"), "axisLineWidth": ("fill", "axis-line-width"), "gridLineWidth": ("fill", "grid-line-width"),
    "zeroLineWidth": ("fill", "zero-line-width"), "fontSize": ("fill", "font-size"), "colorbarTicks": ("fill", "colorbar-ticks"),
    "scaleBarUnit": ("fill", "scale-bar-unit"), "notInTableScale": ("fill", "not-in-table-scale"),
    "notInTableOpacity": ("fill", "not-in-table-opacity"), "focusedScale": ("fill", "focused-scale"),
    "focusedOpacity": ("fill", "focused-opacity"), "focusedEdgeWidth": ("fill", "focused-edge-width"),
    "exportWidth": ("fill", "plot-width"), "exportHeight": ("fill", "plot-height"),
    "fontFamily": ("select", "font-family"), "legendPosition": ("select", "legend-position"),
    "colorbarPosition": ("select", "colorbar-position"), "scaleBarCorner": ("select", "scale-bar-corner"),
    "colorbarLength": ("slide", "colorbar-length", 100), "scaleBarSize": ("slide", "scale-bar-size", 100),
}


def _open_menu(page, pid):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    for d in page.query_selector_all(f"details[data-panel='{pid}']"):
        if not d.evaluate("e => e.open"):
            d.query_selector("summary").click()


def _set_control(page, pid, key, value):
    how, cid, *scale = CONTROLS[key]
    sel = f"#{cid}-{pid}"
    _open_menu(page, pid)
    if how == "check":
        page.set_checked(sel, bool(value))
    elif how == "fill":
        T._change(page, sel, value)
    elif how == "select":
        page.select_option(sel, str(value))
    elif how == "color":
        page.fill(sel, value)
    elif how == "slide":
        T._slide(page, sel, value * scale[0])
    page.wait_for_timeout(500)


def _live(page, pid, key, value):
    """What a person does: change the option in Plot Options (margins: unlink, then each side)."""
    if key == "margins":
        _set_control(page, pid, "marginsUnlinked", True)
        for side, k in (("left", "l"), ("right", "r"), ("top", "t"), ("bottom", "b")):
            T._change(page, f"#margin-{side}-{pid}", value[k])
    elif key == "equalAspect":
        page.click(f"#equal-aspect-{pid}")
    elif key == "highlightFocusedCell":
        page.click(f"#highlight-focused-cell-{pid}")
    else:
        _set_control(page, pid, key, value)
    page.wait_for_timeout(800)


def _case_cfg(case):
    cfg = _base(case)
    cfg.update(case.get("extra") or {})
    cfg[case["key"]] = case["value"]
    return cfg


@pytest.fixture
def browser(server):
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


DRIVEN = set(CONTROLS) | {"margins", "equalAspect", "highlightFocusedCell"}
LIVE = [c for c in CASES if c["render"] and c["key"] in DRIVEN]
REDRAWN = [c for c in CASES if c["render"] and c["key"] not in DRIVEN]


@pytest.mark.parametrize("scheme", ["light"])
@pytest.mark.parametrize("case", LIVE, ids=lambda c: c.get("name", c["key"]))
def test_first_draw_equals_the_live_change(server, browser, case, scheme):
    cfg = _case_cfg(case)
    pid = cfg["id"]
    ctx, page, errors = _tab(browser, scheme)
    try:
        # opened from the config
        _open_cfgs(page, server, {pid: cfg})
        drawn = page.evaluate(LOOK, pid)
        # the same plot opened with defaults, then changed the way Plot Options changes it
        base = _base(case)
        base.update({k: v for k, v in (case.get("extra") or {}).items()})
        page.goto("about:blank")
        _open_cfgs(page, server, {pid: base})
        base_value = base.get(case["key"])
        _live(page, pid, case["key"], case["value"])
        live = page.evaluate(LOOK, pid)
        assert not errors, errors
        d = _diff(live, drawn, tol=case.get("tolerance", 0.02))
        assert not d, 'live != first draw:\n' + '\n'.join(x[:300] for x in d)
    except playwright.TimeoutError:
        page.screenshot(path=os.path.join(os.environ.get("ANNZARRO_DEBUG_DIR", "/tmp"), f"nodraw-{case['key']}-{scheme}.png"))
        pytest.fail(f"the plot did not draw: {errors}")
    finally:
        ctx.close()


@pytest.mark.parametrize("case", REDRAWN, ids=lambda c: c.get("name", c["key"]))
def test_an_option_that_redraws_the_data_changes_the_first_draw(server, browser, case):
    ctx, page, errors = _tab(browser, "light")
    try:
        pid = _base(case)["id"]
        _open_cfgs(page, server, {pid: _case_cfg(case)})
        drawn = page.evaluate(LOOK, pid)
        page.goto("about:blank")
        base = _base(case)
        base.update(case.get("extra") or {})
        _open_cfgs(page, server, {pid: base})
        assert _diff(page.evaluate(LOOK, pid), drawn) != [], f"{case['key']} does nothing on the first draw"
        assert not errors, errors
    finally:
        ctx.close()


# ---- every option at once through the four routes ----

C = "cell-plot-C"
OPPOSITE = {"light": "dark", "dark": "light"}
ROUTES = ["share-link", "panel-set", "autosave", "duplicate"]


def _all_cfgs():
    """One config per plot with every option of its panel set to its case value."""
    cfgs = {A: _base({"panel": "a"}), B: _base({"panel": "b"}), C: dict(_base({"panel": "a3d"}), id=C)}
    for case in CASES:
        cfg = cfgs[{"a": A, "b": B, "a3d": C}[case["panel"]]]
        cfg.update(case.get("extra") or {})
        cfg[case["key"]] = case["value"]
    # the plots that have no colour of their own in the cases are pinned too, so that they look the same in either app theme
    from annzarro.tests.browser import test_plot_options as _T  # noqa: F401
    light = {"bgColor": "#fafafa", "gridColor": "#dddddd", "axisColor": "#111111", "textColor": "#222222", "zeroLineColor": "#bbbbbb",
             "backdropColor": "#eeeeee", "notInTableColor": "#aaaaaa", "focusedColor": "#ee0000", "focusedEdgeColor": "#010101"}
    for pid in (B, C):
        for k, v in light.items():
            cfgs[pid].setdefault(k, v)
    cfgs[A]["title"] = "Plot A"
    return cfgs


def _settings_of(page, pid):
    return page.evaluate(CONFIG, pid)


def _comparable(cfg):
    out = {k: v for k, v in cfg.items() if k not in IGNORED}
    if cfg.get("autoPointSize"):
        out.pop("pointSize", None)             # worked out again for the panel's area: only "auto" is kept
    if cfg.get("autoPointOpacity"):
        out.pop("pointOpacity", None)
    return out


def _same_settings(a, b, copy=False):
    ca, cb = _comparable(a), _comparable(b)
    if copy:
        ca.pop("title", None)
        cb.pop("title", None)       # a copy is given a title of its own
    assert _diff(ca, cb) == []


def _wait_drawn(page, pids):
    for pid in pids:
        try:
            page.wait_for_function(DRAWN, arg=pid, timeout=60000)
        except playwright.TimeoutError:
            page.screenshot(path=os.path.join(os.environ.get("ANNZARRO_DEBUG_DIR", "/tmp"), f"undrawn-{pid}.png"))
            raise
    page.wait_for_timeout(1500)


def _settle_both(page, pids):
    """Both plots and the app's own settling (the scale bar follows the range) are done."""
    _wait_drawn(page, pids)


@pytest.fixture(scope="module")
def own_server(tmp_path_factory):
    """A server on a copy of the fixture store: saving a panel set writes into its data directory."""
    import shutil
    from annzarro.tests.browser import test_memory_guard as G
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(G.STORE, data / "fixture_small.zarr")
    mp = pytest.MonkeyPatch()
    mp.setattr(G, "DATA_DIR", str(data))
    root, proc = G._serve(tmp_path_factory)
    mp.undo()
    yield root, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


def _url(root, store, view=None):
    q = f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}"
    return q + (f"#view={view}" if view else "")


def _open_all(page, root, store, cfgs):
    _goto(page, _url(root, store, _encode(_layout(cfgs))))
    _settle_both(page, list(cfgs))


def _route(route, page, ctx, browser, root, store, scheme_to):
    """Carry the panels in `page` to a fresh page by `route`; returns the page showing them and the ids to compare."""
    pids = [A, B, C]
    if route == "share-link":
        payload = page.evaluate("""async () => { const d = await import('/static/js/utils/deeplink.js');
            return d.encodeViewPayload({v: 1, subset: null, layout: window.PanelManager.saveLayout()}); }""")
        assert payload.startswith("z1."), payload[:8]
        ctx2 = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme=scheme_to)
        page2 = ctx2.new_page()
        _goto(page2, _url(root, store, payload))
        _settle_both(page2, pids)
        return page2, ctx2, {p: p for p in pids}
    if route in ("panel-set", "autosave"):
        ctx2 = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme=scheme_to)
        page2 = ctx2.new_page()
        if route == "panel-set":
            name = f"roundtrip-{scheme_to}"
            saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", name)
            assert saved["status"] == "success", saved
        else:
            name = "Autosave"
            page.evaluate("() => window.sessionManager.saveToLocalStorage()")
            blob = page.evaluate("() => localStorage.getItem('annzarro_autosave')")
            assert blob and "colourModel" in blob
        _goto(page2, _url(root, store))              # a dataset and no panels of ours: the saved ones come over them
        page2.wait_for_function("() => window.sessionManager && window.sessionManager.getCurrentDatasetInfo().hasCurrent", timeout=60000)
        if route == "autosave":
            page2.evaluate("(v) => localStorage.setItem('annzarro_autosave', v)", blob)
        loaded = page2.evaluate("(n) => window.sessionManager.loadSession(n)", name)
        assert loaded["status"] == "success", loaded
        _settle_both(page2, pids)
        return page2, ctx2, {p: p for p in pids}
    # duplicate: the same page, each plot copied through "Duplicate or Reopen Panel"
    before = set(page.evaluate("() => [...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)"))
    mapping = {}
    for pid in pids:
        page.evaluate("(id) => setTimeout(() => document.querySelector(`.source-panel-option[data-id='${id}']`).click(), 0)", pid)
        page.wait_for_function("([b]) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !b.includes(t.dataset.tileId))",
                               arg=[sorted(before)], timeout=30000)
        now = set(page.evaluate("() => [...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)"))
        (new,) = now - before
        mapping[pid] = new
        before = now
        page.wait_for_function(DRAWN, arg=new, timeout=60000)
    page.wait_for_timeout(1500)
    return page, None, mapping


@pytest.mark.parametrize("to", ["same", "opposite"])
@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("scheme", SCHEMES)
def test_every_option_survives_the_route(own_server, browser, route, scheme, to):
    if route == "duplicate" and to == "opposite":
        pytest.skip("a copy is made in the same page")
    root, store = own_server
    scheme_to = scheme if to == "same" else OPPOSITE[scheme]
    ctx, page, errors = _tab(browser, scheme)
    ctx2 = None
    try:
        cfgs = _all_cfgs()
        _open_all(page, root, store, cfgs)
        original = {pid: (_settings_of(page, pid), page.evaluate(LOOK, pid)) for pid in cfgs}
        for pid, case_cfg in cfgs.items():       # the page keeps what was asked for
            for k, v in case_cfg.items():
                if k not in IGNORED and k not in ("title", "pointSize", "pointOpacity", "colorMin", "colorMax"):
                    assert _diff({k: original[pid][0].get(k)}, {k: v}) == [], (pid, k)
        page2, ctx2, mapping = _route(route, page, ctx, browser, root, store, scheme_to)
        for pid, new in mapping.items():
            cfg_o, look_o = original[pid]
            _same_settings(cfg_o, _settings_of(page2, new), copy=route == "duplicate")
            look_n = page2.evaluate(LOOK, new)
            if route == "duplicate":
                # the copy is another size, and the scale bar is a fifth of the width in view: it is there, its length is its own
                for look in (look_o, look_n):
                    assert [s["name"] for s in look.pop("shapes") or []].count("az-scalebar") == (1 if pid == A else 0)
                    look.pop("annotations")
            if route == "duplicate":
                for look, cfg in ((look_o, cfg_o), (look_n, _settings_of(page2, new))):
                    for t in look["traces"]:           # automatic point size and opacity follow the panel's area, by design
                        if cfg.get("autoPointSize"):
                            t["marker"].pop("size", None)
                        if cfg.get("autoPointOpacity"):
                            t["marker"].pop("opacity", None)
            d = _diff(look_o, look_n)
            assert not d, f"{route} {scheme}->{scheme_to} {pid} looks different:\n" + "\n".join(x[:300] for x in d)
        assert not errors, errors
    finally:
        if ctx2:
            ctx2.close()
        ctx.close()


# ---- the Publication preset, as reported: axes gone on another machine and in a copy ----

PUBLICATION_LOOK = ["paper_bgcolor", "plot_bgcolor", "font.color", "font.size", "xaxis.showline", "xaxis.linecolor", "xaxis.linewidth",
                    "xaxis.showgrid", "xaxis.tickcolor", "xaxis.tickfont.color", "yaxis.showline", "yaxis.linecolor", "yaxis.linewidth",
                    "xaxis.nticks", "xaxis.ticks", "margin.t", "margin.l"]


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


def _publication_look(page, pid):
    return {p: T._full(page, pid, p) for p in PUBLICATION_LOOK}


@pytest.mark.parametrize("dst", SCHEMES)
@pytest.mark.parametrize("src", SCHEMES)
def test_publication_preset_opens_with_its_axes_on_another_machine(own_server, browser, src, dst):
    root, store = own_server
    ctx, page, errors = _tab(browser, src)
    ctx2 = None
    try:
        _goto(page, _url(root, store, _encode(_layout({A: _base({"panel": "a"}), B: _base({"panel": "b"})}))))
        _wait_drawn(page, [A, B])
        _open_menu(page, A)
        page.click(f"#preset-publication-{A}")
        page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showgrid === false" % T.GD, arg=A)
        page.wait_for_timeout(1000)
        original = _publication_look(page, A)
        assert original["xaxis.showline"] is True and original["xaxis.linecolor"] == "#000000" and original["xaxis.linewidth"] == 1.5
        assert original["paper_bgcolor"] == "#ffffff"          # white in either app theme
        _shot(page, f"publication-{src}-original.png")
        # the share link
        payload = page.evaluate("""async () => { const d = await import('/static/js/utils/deeplink.js');
            return d.encodeViewPayload({v: 1, subset: null, layout: window.PanelManager.saveLayout()}); }""")
        ctx2 = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme=dst)
        page2 = ctx2.new_page()
        _goto(page2, _url(root, store, payload))
        _wait_drawn(page2, [A, B])
        assert _publication_look(page2, A) == original
        _shot(page2, f"publication-{src}-to-{dst}-link.png")
        # Duplicate, in the page the preset was applied in
        page.evaluate("(id) => setTimeout(() => document.querySelector(`.source-panel-option[data-id='${id}']`).click(), 0)", A)
        page.wait_for_function("(ids) => [...document.querySelectorAll('.tile[data-tile-id]')].some(t => !ids.includes(t.dataset.tileId))", arg=[A, B])
        (copy,) = set(page.evaluate("() => [...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)")) - {A, B}
        page.wait_for_function(DRAWN, arg=copy, timeout=60000)
        page.wait_for_timeout(1500)
        assert _publication_look(page, copy) == original
        _shot(page, f"publication-{src}-duplicate.png")
        assert not errors, errors
    finally:
        if ctx2:
            ctx2.close()
        ctx.close()


# a link as 0.5.5 wrote it: the Publication preset's settings, with the colour model marker and its pinned colours
LINK_055 = {"showGrid": False, "showZeroLines": False, "showTickMarks": True, "tickCount": 5, "fontSize": 16, "axisLineWidth": 1.5,
            "margins": {"l": 70, "r": 70, "t": 40, "b": 60, "pad": 4}, "colorbarTicks": 5, "colorbarLength": 0.6, "colourModel": 2,
            "bgColor": "#ffffff", "textColor": "#000000", "gridColor": "#e6e6e6", "axisColor": "#000000", "zeroLineColor": "#cccccc",
            "backdropColor": "#f0f0f0"}


@pytest.mark.parametrize("scheme", SCHEMES)
def test_a_link_made_by_0_5_5_opens_with_its_axes(own_server, browser, scheme):
    root, store = own_server
    ctx, page, errors = _tab(browser, scheme)
    try:
        cfgs = {A: {**_base({"panel": "a"}), **LINK_055}, B: _base({"panel": "b"})}
        _goto(page, _url(root, store, _encode(_layout(cfgs))))
        _wait_drawn(page, [A, B])
        look = _publication_look(page, A)
        assert look["xaxis.showline"] is True and look["yaxis.showline"] is True
        assert look["xaxis.linecolor"] == "#000000" and look["xaxis.linewidth"] == 1.5
        assert look["paper_bgcolor"] == "#ffffff" and look["xaxis.showgrid"] is False
        assert not errors, errors
    finally:
        ctx.close()
