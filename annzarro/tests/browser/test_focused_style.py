"""Plot Options, Focused cell: size, opacity, fill, edge colour and width of the highlight.

Three plots on the 200-cell fixture: A in 2D, B in 3D, G a gene plot (its
group is Focused gene). The dataset opens with its first cell and gene
focused. Checked by what the plot draws:

1. a link without the keys draws the default highlight: an open circle
   (no fill) five times the point size, opaque, a 2 px black edge;
2. each control restyles the highlight trace and nothing else: no newPlot,
   react or added/removed trace, at most one restyle per change;
3. the app theme switching keeps a colour that was set and draws the
   theme's colour for one that was not; Reset follows the theme again;
4. the values travel with the panel (saved layout, a link made from it),
   and the other panels keep the defaults;
5. the full export (PNG) draws the styled highlight;
6. No fill draws an open circle (transparent fill, visible edge) on screen, in
   2D, 3D and gene plots, through a focus move, a link and the PNG and SVG exports.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import io
import json
import os
import urllib.parse

from PIL import Image

from annzarro.tests.browser.test_memory_guard import STORE
from annzarro.tests.browser.test_plot_options import _close_menu, _menu, page, server  # noqa: F401  (fixtures)

A, B, G = "cell-plot-A", "cell-plot-B", "gene-plot-G"
SHOTS = os.environ.get("ANNZARRO_SHOTS")       # a directory: screenshots for review

GD = """(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)"""
FOCUS = """(id) => { const gd = (%s)(id); if (!gd || !gd.data) return null;
    const t = gd.data.find(t => /^Focused (Cell|Gene)$/.test(t.name || ''));
    const f = gd._fullData && gd._fullData.find(t => /^Focused (Cell|Gene)$/.test(t.name || ''));
    const panel = window.PanelManager && window.PanelManager.getActivePanels().find(p => p.getId() === id);
    const cfg = panel ? panel.getConfig() : {};
    return t && panel ? { type: t.type, size: t.marker.size, color: String(t.marker.color).replace(/ /g, ''), opacity: t.marker.opacity,
                 lineColor: t.marker.line.color, lineWidth: t.marker.line.width, pointSize: cfg.pointSize,
                 fullColor: f && String(f.marker.color).replace(/ /g, ''), fullLineWidth: f && f.marker.line.width } : null; }""" % GD
SPY = """() => { if (!window.__spy) { window.__spy = {};
      for (const k of ['newPlot', 'react', 'restyle', 'relayout', 'update', 'addTraces', 'deleteTraces']) {
        const f = Plotly[k]; window.__spy[k] = 0;
        Plotly[k] = function (...a) { window.__spy[k]++; return f.apply(this, a); }; } }
    for (const k in window.__spy) window.__spy[k] = 0; }"""


FILLED = {pid: {"focusedNoFill": False} for pid in (A, B, G)}      # the default is no fill; these draw one


def _link(root, extra=None):
    umap = lambda c: {"type": "obsm", "key": "X_umap", "column": c}  # noqa: E731
    row = lambda c: {"type": "layer", "key": "X", "column": c}  # noqa: E731
    cfgs = {A: {"id": A, "x": umap("0"), "y": umap("1"), "z": None,
                "color": {"type": "obs", "key": "cell_type", "column": ""}},
            B: {"id": B, "x": umap("0"), "y": umap("1"), "z": {"type": "obs", "key": "total_counts", "column": ""},
                "color": {"type": "obs", "key": "cell_type", "column": ""}},
            G: {"id": G, "x": row("cell_0001"), "y": row("cell_0002"), "z": None, "color": row("focused_cell")}}
    for pid, more in (extra or {}).items():
        cfgs[pid].update(more)
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in (A, B, G)]
    pair = {"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}],
            "children": tiles[1:]}
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 34}, {"percentage": 66}],
                                      "children": [tiles[0], pair]}],
              "controlState": {i: True for i in (A, B, G)}, "panelConfigs": cfgs}
    return _view(root, layout)


def _view(root, layout):
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def _open(page, url):
    page.goto(url)
    for pid in (A, B, G):
        page.wait_for_function("(id) => { const f = (%s)(id); return f && f.size > 0; }" % FOCUS, arg=pid, timeout=60000)
    page.wait_for_timeout(1000)


def _reload_view(page, root, layout):
    """Open the link, let the restore END, then reload: the reload of a page that is still restoring
    is taken for the end of a page that crashed while it drew (session-manager.js, the restore
    marker), and the view is then deliberately not drawn by itself."""
    page.goto(_view(root, layout))
    for pid in (A, B, G):
        page.wait_for_function("(id) => { const f = (%s)(id); return f && f.size > 0; }" % FOCUS, arg=pid, timeout=60000)
    page.wait_for_function("() => !localStorage.getItem('annzarro_restoring')", timeout=30000)
    page.reload()


def _focus(page, pid):
    return page.evaluate(FOCUS, pid)


def _today(f):
    """The default highlight: no fill, five times the point size, a 2 px black edge."""
    assert f["size"] == 5 * f["pointSize"], f
    # a 3D marker draws no edge: its open circle is the symbol, in the edge colour
    want = "#000000" if f["type"] == "scatter3d" else "rgba(0,0,0,0)"
    assert (f["color"], f["opacity"], f["lineColor"], f["lineWidth"]) == (want, 1, "#000000", 2), f


def _set(page, selector, value):
    """One change event, as a number box left or a colour picked."""
    page.evaluate("""([sel, v]) => { const el = document.querySelector(sel); el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true })); }""", [selector, str(value)])


def _wait(page, pid, key, want):
    page.wait_for_function("([id, key, want]) => { const f = (%s)(id); return f && f[key] === want; }" % FOCUS,
                           arg=[pid, key, want], timeout=10000)


def _spied(page):
    page.wait_for_timeout(300)
    return page.evaluate("() => ({ ...window.__spy })")


def _shot(page, name, pid=None):
    if not SHOTS:
        return
    os.makedirs(SHOTS, exist_ok=True)
    page.wait_for_timeout(500)                  # the menu's fade-in
    where = page.locator(f'.tile[data-tile-id="{pid}"]') if pid else page
    where.screenshot(path=os.path.join(SHOTS, name + ".png"))
    if not pid and page.query_selector(".aesthetics-popover"):
        page.locator(".aesthetics-popover").screenshot(path=os.path.join(SHOTS, name + "-crop.png"))


def test_a_link_without_the_keys_draws_the_default_highlight(page, server):
    _open(page, _link(server))
    for pid in (A, B, G):
        _today(_focus(page, pid))
    assert _focus(page, A)["type"] == "scattergl" and _focus(page, B)["type"] == "scatter3d"
    _menu(page, A, "focused")
    title = page.eval_on_selector(f"details[data-panel='{A}'][data-section='focused'] > summary", "e => e.textContent.trim()")
    assert title == "Focused cell"
    assert page.input_value(f"#focused-scale-{A}") == "5" and page.input_value(f"#focused-opacity-{A}") == "1"
    assert page.input_value(f"#focused-edge-width-{A}") == "2"
    assert page.input_value(f"#focused-color-{A}") == "#ff0000" and page.input_value(f"#focused-edge-color-{A}") == "#000000"
    assert page.is_disabled(f"#reset-focused-color-{A}")                  # following the theme: nothing to reset
    _shot(page, "menu-focused-light")
    _menu(page, G, "focused")
    title = page.eval_on_selector(f"details[data-panel='{G}'][data-section='focused'] > summary", "e => e.textContent.trim()")
    assert title == "Focused gene"


def test_each_control_restyles_only_the_highlight_in_2d_3d_and_gene_plots(page, server):
    _open(page, _link(server, FILLED))
    for pid in (A, B, G):
        _menu(page, pid, "focused")
        page.evaluate(SPY)
        ps = _focus(page, pid)["pointSize"]
        steps = [(f"#focused-scale-{pid}", 3.5, "size", ps * 3.5),
                 (f"#focused-opacity-{pid}", 0.5, "opacity", 0.5),
                 (f"#focused-edge-width-{pid}", 4, "lineWidth", 4),
                 (f"#focused-color-{pid}", "#00ff00", "color", "#00ff00"),
                 (f"#focused-edge-color-{pid}", "#0000ff", "lineColor", "#0000ff")]
        for sel, value, key, want in steps:
            page.evaluate(SPY)
            _set(page, sel, value)
            _wait(page, pid, key, want)
            spy = _spied(page)
            assert spy["newPlot"] == spy["react"] == spy["addTraces"] == spy["deleteTraces"] == spy["update"] == 0, (pid, sel, spy)
            assert spy["restyle"] <= 1 and spy["relayout"] == 0, (pid, sel, spy)
        f = _focus(page, pid)
        assert (f["fullColor"], f["fullLineWidth"]) == ("#00ff00", 4), f    # Plotly drew it, not only the settings
        # the same value again: nothing to send
        page.evaluate(SPY)
        _set(page, f"#focused-color-{pid}", "#00ff00")
        assert _spied(page)["restyle"] == 0
        # an empty opacity is the default (opaque); a value out of range is ignored
        _set(page, f"#focused-opacity-{pid}", "")
        _wait(page, pid, "opacity", 1)
        _set(page, f"#focused-scale-{pid}", -1)
        page.wait_for_timeout(300)
        assert _focus(page, pid)["size"] == ps * 3.5
    _shot(page, "plots-restyled-light")
    # the point size moving keeps the factor
    before = _focus(page, A)["pointSize"]
    page.fill(f"#point-size-input-{A}", "8")
    page.press(f"#point-size-input-{A}", "Tab")
    page.wait_for_function("([id, ps]) => { const f = (%s)(id); return f && f.pointSize !== ps && f.size === f.pointSize * 3.5; }"
                           % FOCUS, arg=[A, before], timeout=10000)


def test_theme_switch_keeps_a_set_colour_and_follows_for_the_rest(page, server):
    _open(page, _link(server, FILLED))
    _menu(page, A, "focused")
    _set(page, f"#focused-edge-color-{A}", "#0000ff")
    _wait(page, A, "lineColor", "#0000ff")
    assert not page.is_disabled(f"#reset-focused-edge-color-{A}")
    palettes = page.evaluate("async () => (await import('/static/js/utils/plot-theme.js')).PLOT_PALETTES")
    page.click('#theme-toggle button[data-theme-mode="dark"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'dark'")
    page.wait_for_timeout(800)
    for pid in (A, B, G):
        f = _focus(page, pid)
        assert f["color"] == palettes["dark"]["focusedColor"], f              # not set: the dark theme's
        assert f["lineColor"] == ("#0000ff" if pid == A else palettes["dark"]["focusedEdgeColor"]), f
    _menu(page, A, "focused")
    _shot(page, "menu-focused-dark")
    _set(page, f"#focused-color-{A}", "#00ff00")
    _wait(page, A, "color", "#00ff00")
    _shot(page, "plot-restyled-dark", A)
    cfg = page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", A)
    assert (cfg["focusedEdgeColor"], cfg["focusedColor"]) == ("#0000ff", "#00ff00")
    # Reset: the edge follows the theme again, the input shows it
    page.click(f"#reset-focused-edge-color-{A}")
    _wait(page, A, "lineColor", palettes["dark"]["focusedEdgeColor"])
    assert page.input_value(f"#focused-edge-color-{A}") == palettes["dark"]["focusedEdgeColor"]
    assert "focusedEdgeColor" not in page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", A)
    page.click('#theme-toggle button[data-theme-mode="light"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'light'")
    page.wait_for_timeout(800)
    f = _focus(page, A)
    assert (f["color"], f["lineColor"]) == ("#00ff00", palettes["light"]["focusedEdgeColor"]), f


def _theme(page, mode):
    page.click(f'#theme-toggle button[data-theme-mode="{mode}"]')
    page.wait_for_function("(m) => document.documentElement.getAttribute('data-theme') === m", arg=mode)
    page.wait_for_timeout(800)


def test_the_default_edge_is_white_in_dark_and_black_in_light(page, server):
    """Left at the default the edge follows the theme; a colour chosen by hand (also black or white) is kept."""
    _open(page, _link(server))
    for pid in (A, B, G):
        assert _focus(page, pid)["lineColor"] == "#000000"
    _theme(page, "dark")
    for pid in (A, B, G):
        assert _focus(page, pid)["lineColor"] == "#ffffff", pid
    _theme(page, "light")
    for pid in (A, B, G):
        assert _focus(page, pid)["lineColor"] == "#000000", pid
    # chosen by hand: blue on A, black (the light default) on B; both survive both switches
    _menu(page, A, "focused")
    _set(page, f"#focused-edge-color-{A}", "#0000ff")
    _wait(page, A, "lineColor", "#0000ff")
    _menu(page, B, "focused")
    _set(page, f"#focused-edge-color-{B}", "#000000")
    cfg = page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", B)
    assert cfg["focusedEdgeColor"] == "#000000"
    for mode in ("dark", "light", "dark"):
        _theme(page, mode)
        assert _focus(page, A)["lineColor"] == "#0000ff", mode
        assert _focus(page, B)["lineColor"] == "#000000", mode
        assert _focus(page, G)["lineColor"] == ("#ffffff" if mode == "dark" else "#000000"), mode


def test_the_values_travel_with_the_panel(page, server):
    _open(page, _link(server, {B: {"focusedScale": 4, "focusedOpacity": 0.6, "focusedEdgeWidth": 0, "focusedNoFill": False,
                                   "focusedColor": "#00ffff", "focusedEdgeColor": "#ffffff"}}))
    f = _focus(page, B)
    assert (f["size"], f["opacity"], f["lineWidth"], f["color"], f["lineColor"]) == (
        4 * f["pointSize"], 0.6, 0, "#00ffff", "#ffffff"), f
    _today(_focus(page, A))
    _menu(page, A, "focused")
    page.set_checked(f"#focused-no-fill-{A}", False)
    _set(page, f"#focused-scale-{A}", 5)
    _set(page, f"#focused-color-{A}", "#00ff00")
    _wait(page, A, "color", "#00ff00")
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    assert (layout["panelConfigs"][A]["focusedScale"], layout["panelConfigs"][A]["focusedColor"]) == (5, "#00ff00")
    assert not any(k.startswith("focused") for k in layout["panelConfigs"][G])    # G keeps the defaults
    _reload_view(page, server, layout)
    for pid in (A, B, G):
        page.wait_for_function("(id) => { const f = (%s)(id); return f && f.size > 0; }" % FOCUS, arg=pid, timeout=60000)
    page.wait_for_timeout(800)
    f = _focus(page, A)
    assert (f["size"], f["color"]) == (5 * f["pointSize"], "#00ff00"), f
    f = _focus(page, B)
    assert (f["opacity"], f["lineWidth"], f["color"]) == (0.6, 0, "#00ffff"), f
    _today(_focus(page, G))


GREEN = """async ([id]) => {
    const { fullImage } = await import('/static/js/utils/plot-export.js');
    const url = await fullImage((%s)(id), { format: 'png', width: 600, height: 400, scale: 1 });
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 40 && px[i + 1] > 215 && px[i + 2] < 40) n++;
    return n; }""" % GD


def test_the_export_draws_the_styled_highlight(page, server):
    _open(page, _link(server))
    assert page.evaluate(GREEN, [A]) == 0
    _menu(page, A, "focused")
    page.set_checked(f"#focused-no-fill-{A}", False)
    _set(page, f"#focused-scale-{A}", 6)
    _set(page, f"#focused-color-{A}", "#00ff00")
    _wait(page, A, "color", "#00ff00")
    assert page.evaluate(GREEN, [A]) > 20


# ---- No fill: an open circle ----

NO_FILL = "rgba(0,0,0,0)"
RING = {"focusedNoFill": True, "focusedScale": 6, "focusedEdgeWidth": 3, "focusedEdgeColor": "#0000ff", "focusedColor": "#ff0000"}
SYMBOL = "(id) => (%s)(id)._fullData.find(t => /^Focused (Cell|Gene)$/.test(t.name || '')).marker.symbol" % GD
LAYOUT_CFG = "(id) => window.PanelManager.saveLayout().panelConfigs[id]"

# where the highlight trace of a 2D plot is on the page, and its radius in px
AT = """(id) => { const gd = (%s)(id); const t = gd.data.find(t => /^Focused (Cell|Gene)$/.test(t.name || ''));
    const fl = gd._fullLayout, r = gd.querySelector('.nsewdrag').getBoundingClientRect();
    return { x: r.left + fl.xaxis.l2p(t.x[0]), y: r.top + fl.yaxis.l2p(t.y[0]), r: t.marker.size / 2, ux: t.x[0] }; }""" % GD


def _is_blue(p):
    return p[2] > 200 and p[0] < 60 and p[1] < 60


def _is_red(p):
    return p[0] > 220 and p[1] < 50 and p[2] < 50


def _screen(page):
    return Image.open(io.BytesIO(page.screenshot())).convert("RGB")


def _count(img, test, box=None):
    w, h = img.size
    x0, y0, x1, y1 = box or (0, 0, w, h)
    px = img.load()
    return sum(1 for x in range(max(0, int(x0)), min(w, int(x1))) for y in range(max(0, int(y0)), min(h, int(y1))) if test(px[x, y]))


def _open_circle_at(page, pid):
    """The highlight of a 2D plot on screen: blue edge pixels around the radius, red nowhere, the centre not the marker's."""
    page.mouse.move(2, 2)                      # no hover label over the points
    page.wait_for_timeout(400)
    at = page.evaluate(AT, pid)
    img = _screen(page)
    r = at["r"]
    around = (at["x"] - r - 3, at["y"] - r - 3, at["x"] + r + 3, at["y"] + r + 3)
    edge = _count(img, _is_blue, around)
    reds = _count(img, _is_red, around)
    inner = _count(img, lambda p: _is_blue(p) or _is_red(p), (at["x"] - r / 2, at["y"] - r / 2, at["x"] + r / 2, at["y"] + r / 2))
    assert edge > 2 * 3.14 * r * 0.5, ("the edge is not drawn", pid, edge, at)
    assert reds == 0, ("the marker is filled", pid, reds)
    assert inner == 0, ("the centre shows the marker, not the plot behind it", pid, inner)
    return at


def _state(f):
    assert f["color"] == NO_FILL and f["fullColor"] == NO_FILL, f
    assert (f["lineColor"], f["lineWidth"], f["fullLineWidth"]) == ("#0000ff", 3, 3), f


def test_no_fill_draws_an_open_circle_in_2d_and_gene_plots(page, server):
    page.set_viewport_size({"width": 1400, "height": 1200})       # all three tiles on screen
    _open(page, _link(server, {A: dict(RING, focusedNoFill=False), G: dict(RING, focusedNoFill=False)}))
    for pid in (A, G):                                  # filled to begin with: red inside the ring
        page.mouse.move(2, 2)
        page.wait_for_timeout(300)
        at = page.evaluate(AT, pid)
        assert _is_red(_screen(page).getpixel((int(at["x"]), int(at["y"])))), pid
        _menu(page, pid, "focused")
        page.evaluate(SPY)
        page.set_checked(f"#focused-no-fill-{pid}", True)
        _wait(page, pid, "color", NO_FILL)
        spy = _spied(page)
        assert spy["newPlot"] == spy["react"] == spy["addTraces"] == spy["deleteTraces"] == spy["update"] == 0, (pid, spy)
        _state(_focus(page, pid))
        _close_menu(page, pid)                          # the menu would cover a plot
        _open_circle_at(page, pid)
        _shot(page, f"no-fill-{pid}", pid)
        # it follows the cell: the regl scene moves the marker, the pixels follow
        before = page.evaluate(AT, pid)["ux"]
        page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell('cell_0042', false)")
        page.wait_for_function("([id, x]) => { const f = (%s); const gd = f(id);"
                               " const t = gd.data.find(t => /^Focused (Cell|Gene)$/.test(t.name || '')); return t && t.x[0] !== x; }" % GD,
                               arg=[pid, before], timeout=10000)
        page.wait_for_timeout(500)
        _state(_focus(page, pid))
        _open_circle_at(page, pid)
        _menu(page, pid, "focused")
        # No fill off: the chosen colour is back, filled
        page.set_checked(f"#focused-no-fill-{pid}", False)
        _wait(page, pid, "color", "#ff0000")
        assert _focus(page, pid)["lineWidth"] == 3
        page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell('cell_0000', false)")
        page.wait_for_timeout(500)
        page.set_checked(f"#focused-no-fill-{pid}", True)
        _wait(page, pid, "color", NO_FILL)
        _close_menu(page, pid)


def test_no_fill_draws_an_open_circle_in_3d(page, server):
    page.set_viewport_size({"width": 1400, "height": 1200})
    _open(page, _link(server, {B: dict(RING, focusedNoFill=False)}))
    tile = page.locator(f'.tile[data-tile-id="{B}"] .js-plotly-plot')

    def counts():
        page.mouse.move(2, 2)
        page.wait_for_timeout(600)
        img = Image.open(io.BytesIO(tile.screenshot())).convert("RGB")
        return _count(img, _is_red), _count(img, _is_blue)
    red, blue = counts()
    assert red > 5, "the filled marker is not drawn red in 3D"
    _menu(page, B, "focused")
    page.set_checked(f"#focused-no-fill-{B}", True)
    _wait(page, B, "color", "#0000ff")                  # 3D draws no marker edge: the open-circle symbol, in the edge colour
    assert page.evaluate(SYMBOL, B) == "circle-open"
    assert (_focus(page, B)["lineColor"], _focus(page, B)["lineWidth"]) == ("#0000ff", 3)
    _close_menu(page, B)
    red, blue = counts()
    assert red == 0 and blue > 2, ("3D open circle", red, blue)
    _menu(page, B, "focused")                          # back to filled: the symbol and the fill return
    page.set_checked(f"#focused-no-fill-{B}", False)
    _wait(page, B, "color", "#ff0000")
    assert page.evaluate(SYMBOL, B) == "circle"


def test_no_fill_with_a_zero_edge_keeps_one_pixel(page, server):
    _open(page, _link(server, {A: {"focusedEdgeWidth": 0, "focusedNoFill": False}}))
    assert _focus(page, A)["lineWidth"] == 0
    _menu(page, A, "focused")
    page.set_checked(f"#focused-no-fill-{A}", True)
    _wait(page, A, "lineWidth", 1)                     # raised, not invisible
    assert page.input_value(f"#focused-edge-width-{A}") == "1"
    assert page.evaluate(LAYOUT_CFG, A)["focusedEdgeWidth"] == 1
    _set(page, f"#focused-edge-width-{A}", 0)          # entered below 1 while open: back to 1
    page.wait_for_timeout(300)
    assert page.input_value(f"#focused-edge-width-{A}") == "1" and _focus(page, A)["lineWidth"] == 1
    _set(page, f"#focused-edge-width-{A}", 4)
    _wait(page, A, "lineWidth", 4)
    page.set_checked(f"#focused-no-fill-{A}", False)   # the width stays what it is
    _wait(page, A, "color", "#ff0000")
    assert _focus(page, A)["lineWidth"] == 4
    _set(page, f"#focused-edge-width-{A}", 0)          # filled: 0 is allowed again
    _wait(page, A, "lineWidth", 0)


def test_a_fill_travels_with_the_panel_and_apply_to_others_copies_it(page, server):
    """No fill is the default, so a fill is stored: focusedNoFill false must survive every route."""
    _open(page, _link(server))
    assert "focusedNoFill" not in page.evaluate(LAYOUT_CFG, A)
    assert _focus(page, A)["color"] == NO_FILL
    _menu(page, A, "focused")
    assert page.is_checked(f"#focused-no-fill-{A}")
    _set(page, f"#focused-edge-color-{A}", "#0000ff")
    page.set_checked(f"#focused-no-fill-{A}", False)
    _wait(page, A, "color", "#ff0000")
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    assert layout["panelConfigs"][A]["focusedNoFill"] is False
    assert "focusedNoFill" not in layout["panelConfigs"][G]
    _reload_view(page, server, layout)                 # a link, an autosave and a duplicate all restore this layout
    for pid in (A, B, G):
        page.wait_for_function("(id) => { const f = (%s)(id); return f && f.size > 0; }" % FOCUS, arg=pid, timeout=60000)
    page.wait_for_timeout(800)
    assert _focus(page, A)["color"] == "#ff0000"
    assert _focus(page, G)["color"] == NO_FILL
    # the theme switch keeps the choice and the colour behind it
    _theme(page, "dark")
    assert _focus(page, A)["color"] != NO_FILL
    _menu(page, A, "focused")
    assert not page.is_checked(f"#focused-no-fill-{A}")
    _set(page, f"#focused-color-{A}", "#00ff00")
    page.click(f"#reset-focused-color-{A}")            # Reset is the colour's: it follows the theme, the fill stays on
    page.wait_for_timeout(300)
    assert _focus(page, A)["color"] != NO_FILL
    # Apply to other panels: the other cell plot (B, in 3D) gets the fill, a gene plot is not of this kind
    assert page.evaluate(SYMBOL, B) == "circle-open"
    _menu(page, A, "apply")
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullData.find(t => /^Focused (Cell|Gene)$/.test(t.name || '')).marker.symbol === 'circle'"
                           % GD, arg=B, timeout=10000)
    assert page.evaluate(LAYOUT_CFG, B)["focusedNoFill"] is False
    assert "focusedNoFill" not in page.evaluate(LAYOUT_CFG, G)


PNG_COUNTS = """async ([id, format]) => {
    const { fullImage } = await import('/static/js/utils/plot-export.js');
    const out = await fullImage((%s)(id), { format, width: 600, height: 400, scale: 1 });
    const url = format === 'svg' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out) : out;
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width || 600; c.height = img.height || 400;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 220 && px[i + 1] < 50 && px[i + 2] < 50) red++;
        if (px[i + 2] > 200 && px[i] < 60 && px[i + 1] < 60) blue++;
    }
    return { red, blue }; }""" % GD


def test_no_fill_in_the_png_and_svg_exports(page, server):
    _open(page, _link(server, {A: RING, B: RING}))
    for pid in (A, B):
        for fmt in ("png", "svg"):
            c = page.evaluate(PNG_COUNTS, [pid, fmt])
            assert c["red"] == 0 and c["blue"] > (5 if pid == A else 2), (pid, fmt, c)    # a 3D edge is thin
    # control: the filled marker is red in the same export
    _menu(page, A, "focused")
    page.set_checked(f"#focused-no-fill-{A}", False)
    _wait(page, A, "color", "#ff0000")
    assert page.evaluate(PNG_COUNTS, [A, "png"])["red"] > 5
