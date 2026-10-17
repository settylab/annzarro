"""Plot Options, Focused cell: size, opacity, fill, edge colour and width of the highlight.

Three plots on the 200-cell fixture: A in 2D, B in 3D, G a gene plot (its
group is Focused gene). The dataset opens with its first cell and gene
focused. Checked by what the plot draws:

1. a link without the keys draws the highlight as before them: twice the
   point size, opaque, red, a 2 px black edge;
2. each control restyles the highlight trace and nothing else: no newPlot,
   react or added/removed trace, at most one restyle per change;
3. the app theme switching keeps a colour that was set and draws the
   theme's colour for one that was not; Reset follows the theme again;
4. the values travel with the panel (saved layout, a link made from it),
   and the other panels keep the defaults;
5. the full export (PNG) draws the styled highlight.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

from annzarro.tests.browser.test_memory_guard import STORE
from annzarro.tests.browser.test_plot_options import _menu, page, server  # noqa: F401  (fixtures)

A, B, G = "cell-plot-A", "cell-plot-B", "gene-plot-G"
SHOTS = os.environ.get("ANNZARRO_SHOTS")       # a directory: screenshots for review

GD = """(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)"""
FOCUS = """(id) => { const gd = (%s)(id); if (!gd || !gd.data) return null;
    const t = gd.data.find(t => /^Focused (Cell|Gene)$/.test(t.name || ''));
    const f = gd._fullData && gd._fullData.find(t => /^Focused (Cell|Gene)$/.test(t.name || ''));
    const panel = window.PanelManager && window.PanelManager.getActivePanels().find(p => p.getId() === id);
    const cfg = panel ? panel.getConfig() : {};
    return t && panel ? { type: t.type, size: t.marker.size, color: t.marker.color, opacity: t.marker.opacity,
                 lineColor: t.marker.line.color, lineWidth: t.marker.line.width, pointSize: cfg.pointSize,
                 fullColor: f && f.marker.color, fullLineWidth: f && f.marker.line.width } : null; }""" % GD
SPY = """() => { if (!window.__spy) { window.__spy = {};
      for (const k of ['newPlot', 'react', 'restyle', 'relayout', 'update', 'addTraces', 'deleteTraces']) {
        const f = Plotly[k]; window.__spy[k] = 0;
        Plotly[k] = function (...a) { window.__spy[k]++; return f.apply(this, a); }; } }
    for (const k in window.__spy) window.__spy[k] = 0; }"""


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


def _focus(page, pid):
    return page.evaluate(FOCUS, pid)


def _today(f):
    """The highlight as drawn before the Focused group existed."""
    assert f["size"] == 2 * f["pointSize"], f
    assert (f["color"], f["opacity"], f["lineColor"], f["lineWidth"]) == ("#ff0000", 1, "#000000", 2), f


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


def test_a_link_without_the_keys_draws_todays_highlight(page, server):
    _open(page, _link(server))
    for pid in (A, B, G):
        _today(_focus(page, pid))
    assert _focus(page, A)["type"] == "scattergl" and _focus(page, B)["type"] == "scatter3d"
    _menu(page, A, "focused")
    title = page.eval_on_selector(f"details[data-panel='{A}'][data-section='focused'] > summary", "e => e.textContent.trim()")
    assert title == "Focused cell"
    assert page.input_value(f"#focused-scale-{A}") == "2" and page.input_value(f"#focused-opacity-{A}") == ""
    assert page.input_value(f"#focused-edge-width-{A}") == "2"
    assert page.input_value(f"#focused-color-{A}") == "#ff0000" and page.input_value(f"#focused-edge-color-{A}") == "#000000"
    assert page.is_disabled(f"#reset-focused-color-{A}")                  # following the theme: nothing to reset
    _shot(page, "menu-focused-light")
    _menu(page, G, "focused")
    title = page.eval_on_selector(f"details[data-panel='{G}'][data-section='focused'] > summary", "e => e.textContent.trim()")
    assert title == "Focused gene"


def test_each_control_restyles_only_the_highlight_in_2d_3d_and_gene_plots(page, server):
    _open(page, _link(server))
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
    _open(page, _link(server))
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
    _open(page, _link(server, {B: {"focusedScale": 4, "focusedOpacity": 0.6, "focusedEdgeWidth": 0,
                                   "focusedColor": "#00ffff", "focusedEdgeColor": "#ffffff"}}))
    f = _focus(page, B)
    assert (f["size"], f["opacity"], f["lineWidth"], f["color"], f["lineColor"]) == (
        4 * f["pointSize"], 0.6, 0, "#00ffff", "#ffffff"), f
    _today(_focus(page, A))
    _menu(page, A, "focused")
    _set(page, f"#focused-scale-{A}", 5)
    _set(page, f"#focused-color-{A}", "#00ff00")
    _wait(page, A, "color", "#00ff00")
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    assert (layout["panelConfigs"][A]["focusedScale"], layout["panelConfigs"][A]["focusedColor"]) == (5, "#00ff00")
    assert not any(k.startswith("focused") for k in layout["panelConfigs"][G])    # G keeps the defaults
    page.goto(_view(server, layout))
    page.reload()
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
    _set(page, f"#focused-scale-{A}", 6)
    _set(page, f"#focused-color-{A}", "#00ff00")
    _wait(page, A, "color", "#00ff00")
    assert page.evaluate(GREEN, [A]) > 20
