"""The Cell Plot's and Gene Plot's Plot Options on the shared pop-over (WP-5b; design note options-ux-080 sections 2f, 4
and 5; operator decisions 25 and 39) in a real browser.

The store is the grouping fixture (tests/core/grouping_store.py).

1.  The toolbar: one row under the controls, the view toggles first, Refresh and Plot Options at its right end, as in
    every plot panel (ui/plot-toolbar.js).
2.  Plot Options is the shared pop-over: Escape closes it and puts focus back on its button, the panel's box does not
    move, its groups are in the shared order.
3.  The point size is in Plot Options (Points), not in the control grid; setting it redraws the points and is kept.
4.  Reset of a group puts back that group's options only.
5.  A link keeps every option the pop-over set (font, grid, point size, a legend option), opened in a new page.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page  # noqa: E402,F401 (the fixtures)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

CP, GP = "cell-plot-W", "gene-plot-W"
POP = "[data-popover='plot-options']"
UMAP = lambda i: {"type": "obsm", "key": "X_umap", "column": str(i)}  # noqa: E731


def _tile(pid):
    return f'.tile[data-tile-id="{pid}"]'


def _configs(which, **extra):
    if which == "cell-plot":
        return {CP: {"id": CP, "title": "Cell Plot 1", "x": UMAP(0), "y": UMAP(1), "z": None,
                     "color": {"type": "obs", "key": "cell_type", "column": ""}, **extra}}, CP
    return {GP: {"id": GP, "title": "Gene Plot 1", "x": {"type": "layer", "key": "logged", "column": "CELL0001"},
                 "y": {"type": "layer", "key": "X", "column": "CELL0001"}, "z": None,
                 "color": {"type": "var", "key": "gene_name", "column": ""}, **extra}}, GP


def _url(served, configs, pid):
    root, store = served
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": pid, "controlsVisible": True}],
                               "controlState": {pid: True}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, which, **extra):
    configs, pid = _configs(which, **extra)
    page.goto(_url(served, configs, pid))
    _drawn(page, pid)
    return pid


def _drawn(page, pid):
    until(page, "(id) => { const p = document.getElementById('plot-container-' + id); return !!p && !!p._fullLayout && p.data && p.data.length > 0; }",
          pid, timeout=60)


def _settings(page, pid):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", pid)


def _open_options(page, pid):
    if page.locator(POP).count() == 0:
        page.click(f"#aesthetics-menu-btn-{pid}")
    page.wait_for_selector(f"{POP} details[data-panel='{pid}']")


def _section(page, pid, name):
    d = page.locator(f"{POP} details[data-panel='{pid}'][data-section='{name}']")
    if not d.evaluate("(e) => e.open"):
        d.locator("summary").click()


def _box(page, sel):
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }", sel)


WHICH = ["cell-plot", "gene-plot"]


# ------------------------------------------------------------------ 1. the toolbar

TOOLBAR = """(t) => [...document.querySelector(t + ' .az-plot-toolbar').children].filter((b) => b.matches('.btn') && getComputedStyle(b).display !== 'none')
    .map((b) => ({ text: b.textContent.trim(), slot: b.dataset.toolbarSlot }))"""


@pytest.mark.parametrize("which", WHICH)
def test_plot_options_is_the_last_toolbar_button_and_undo_sits_just_before_it(page, served, which):
    """[3D] [Equal aspect] [Refresh] ... [Undo] [Plot Options]: the places of every plot panel (design note section 4)."""
    pid = _open(page, served, which)
    tile = _tile(pid)
    assert page.locator(f"{tile} .az-plot-toolbar").count() == 1
    buttons = page.evaluate(TOOLBAR, tile)
    # the exact row; whoever removes Refresh changes this line
    highlight = "Highlight Focused Cell" if which == "cell-plot" else "Highlight Focused Gene"
    assert buttons == [{"text": "3D", "slot": "actions"}, {"text": "Equal aspect", "slot": "actions"},
                       {"text": highlight, "slot": "actions"}, {"text": "Refresh", "slot": "actions"},
                       {"text": "Undo", "slot": "undo"}, {"text": "Plot Options", "slot": "options"}], buttons
    boxes = page.evaluate("(t) => { const r = document.querySelector(t + ' .az-plot-toolbar').getBoundingClientRect();"
                          " const o = document.querySelector(t + ' .az-plot-toolbar [data-toolbar-slot=options]').getBoundingClientRect();"
                          " return [r.right, o.right]; }", tile)
    assert abs(boxes[0] - boxes[1]) <= 2, "Plot Options at the row's right end"


# ------------------------------------------------------------------ 2. the shared pop-over

@pytest.mark.parametrize("which", WHICH)
def test_plot_options_is_the_shared_pop_over(page, served, which):
    pid = _open(page, served, which)
    tile = _tile(pid)
    before = (_box(page, tile), _box(page, f"#plot-container-{pid}"))
    _open_options(page, pid)
    page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    assert (_box(page, tile), _box(page, f"#plot-container-{pid}")) == before, "opening Plot Options moves nothing in the panel"
    assert page.locator(f"{tile} {POP}").count() == 0, "the pop-over is in the body-level layer"
    sections = page.evaluate("(id) => [...document.querySelectorAll(`[data-popover='plot-options'] details[data-panel='${id}']`)].map((d) => d.dataset.section)", pid)
    assert sections == ["presets", "text", "background", "axes", "points", "focused", "legend", "margins", "export", "apply"]
    # Escape from anywhere closes it and puts focus back on its button
    page.evaluate("() => document.activeElement.blur()")
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached")
    assert page.evaluate("(id) => document.activeElement === document.getElementById('aesthetics-menu-btn-' + id)", pid)


# ------------------------------------------------------------------ 3. the point size

@pytest.mark.parametrize("which", WHICH)
def test_the_point_size_is_in_plot_options_and_redraws_the_points(page, served, which):
    pid = _open(page, served, which)
    assert page.locator(f"{_tile(pid)} .ctl-grid #point-size-input-{pid}").count() == 0, "not in the control grid"
    assert not page.is_visible(f"#point-size-input-{pid}"), "nor shown anywhere while Plot Options is closed"
    _open_options(page, pid)
    _section(page, pid, "points")
    box = f"{POP} details[data-section='points'] #point-size-input-{pid}"
    page.wait_for_selector(box)
    page.fill(box, "7")
    page.press(box, "Tab")
    # a 2D size snaps to the steps WebGL draws (100/255 px; 7 is drawn as 7.06)
    until(page, "(id) => { const s = window.PanelManager.getPanel(id).getConfig(); return s.autoPointSize === false && Math.abs(s.pointSize - 7) < 0.4; }", pid)
    drawn = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().pointSize", pid)
    # closed and opened again, the box says what is set
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached")
    _open_options(page, pid)
    _section(page, pid, "points")
    assert float(page.input_value(box)) == drawn


# ------------------------------------------------------------------ 4. Reset of one group

def test_reset_of_a_group_puts_back_only_that_group(page, served):
    pid = _open(page, served, "cell-plot")
    _open_options(page, pid)
    _section(page, pid, "text")
    page.fill(f"#font-size-{pid}", "18")
    page.press(f"#font-size-{pid}", "Tab")
    until(page, "(id) => document.getElementById('plot-container-' + id).layout.font.size === 18", pid)
    _section(page, pid, "axes")
    page.uncheck(f"#grid-toggle-{pid}")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().showGrid === false", pid)
    page.click(f"#reset-section-text-{pid}")
    until(page, "(id) => document.getElementById('plot-container-' + id).layout.font.size === 12", pid)
    s = _settings(page, pid)
    assert s["fontSize"] == 12 and s["showGrid"] is False, "the Axes group keeps its own"
    assert page.locator(POP).count() == 1, "the pop-over stays open"
    assert page.input_value(f"#font-size-{pid}") == "12"


# ------------------------------------------------------------------ 5. a link keeps it all

@pytest.mark.parametrize("which", WHICH)
def test_a_link_keeps_every_option_set_in_plot_options(page, served, which):
    pid = _open(page, served, which)
    _open_options(page, pid)
    _section(page, pid, "text")
    page.fill(f"#font-size-{pid}", "16")
    page.press(f"#font-size-{pid}", "Tab")
    _section(page, pid, "axes")
    page.uncheck(f"#grid-toggle-{pid}")
    _section(page, pid, "legend")
    page.select_option(f"#legend-position-{pid}", "bottom")
    _section(page, pid, "points")
    page.fill(f"#point-size-input-{pid}", "6")
    page.press(f"#point-size-input-{pid}", "Tab")
    until(page, "(id) => { const s = window.PanelManager.getPanel(id).getConfig(); return s.fontSize === 16 && s.showGrid === false"
                " && s.legendPosition === 'bottom' && s.autoPointSize === false && Math.abs(s.pointSize - 6) < 0.4; }", pid)
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfg = view["layout"]["panelConfigs"][pid]
    root, store = served
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
    _drawn(page, pid)
    s = _settings(page, pid)
    for key in ("fontSize", "showGrid", "legendPosition", "pointSize", "autoPointSize"):
        assert s[key] == cfg[key], key
    assert page.evaluate("(id) => document.getElementById('plot-container-' + id).layout.font.size", pid) == 16
    assert page.evaluate("(id) => document.getElementById('plot-container-' + id).layout.xaxis.showgrid", pid) is False


# ------------------------------------------------------------------ 6. Undo

@pytest.mark.parametrize("which", WHICH)
def test_undo_takes_back_each_change_as_one_step(page, served, which):
    """Undo (ui/panel-undo.js through plot-utilities/plot-undo.js): each change of the plot is one labelled step, and
    Undo re-applies the config before it the way Back and Forward do; the zoom is not a step."""
    pid = _open(page, served, which)
    undo = f"#plot-undo-{pid}"
    assert page.is_disabled(undo), "nothing to undo in a plot just opened"
    before = _settings(page, pid)
    _open_options(page, pid)
    _section(page, pid, "axes")
    page.uncheck(f"#grid-toggle-{pid}")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().showGrid === false", pid)
    until(page, "(s) => !document.querySelector(s).disabled", undo)
    page.keyboard.press("Escape")
    was = bool(before.get("equalAspect"))
    page.click(f"#equal-aspect-{pid}")
    until(page, "([s, v]) => !!window.PanelManager.getPanel(s).getConfig().equalAspect === v", [pid, not was])
    until(page, "(s) => (document.querySelector(s).title || '').includes('equal aspect')", undo)
    # the last change first, then the one before
    page.click(undo)
    until(page, "([s, v]) => !!window.PanelManager.getPanel(s).getConfig().equalAspect === v", [pid, was])
    _drawn(page, pid)
    assert _settings(page, pid)["showGrid"] is False, "only the last step is undone"
    until(page, "(s) => !document.querySelector(s).disabled", undo)
    page.click(undo)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().showGrid === true", pid)
    _drawn(page, pid)
    assert page.evaluate("(id) => document.getElementById('plot-container-' + id).layout.xaxis.showgrid", pid) is True
    assert page.is_disabled(undo)


# ------------------------------------------------------------------ 7. a long pop-over scrolls

def test_a_long_plot_options_scrolls_and_keeps_its_place(page, served):
    """Every group open, the menu is taller than the room under its button: its body scrolls, and a scroll inside it
    is kept (ui/popover.js placed the surface again on every scroll, which reset the body's scroll to the top)."""
    pid = _open(page, served, "cell-plot")
    _open_options(page, pid)
    page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    room = page.evaluate("() => { const b = document.querySelector(\"[data-popover='plot-options'] .az-popover-body\"); return [b.scrollHeight, b.clientHeight]; }")
    assert room[0] > room[1], "taller than its room"
    page.locator(f"#apply-others-{pid}").scroll_into_view_if_needed()
    top = page.evaluate("() => document.querySelector(\"[data-popover='plot-options'] .az-popover-body\").scrollTop")
    assert top > 0
    assert page.is_visible(f"#apply-others-{pid}")
    b = page.locator("[data-popover='plot-options'] .az-popover-body").bounding_box()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    page.mouse.wheel(0, -40)
    page.wait_for_function("(t) => document.querySelector(\"[data-popover='plot-options'] .az-popover-body\").scrollTop < t", arg=top)
    after = page.evaluate("() => document.querySelector(\"[data-popover='plot-options'] .az-popover-body\").scrollTop")
    assert 0 < after < top, (top, after)
    assert page.locator(POP).count() == 1


# ------------------------------------------------------------------ for other tests

def open_point_size(page, pid):
    """Show the point size's controls, in Plot Options ▸ Points since WP-5b, ready to use (other tests call this)."""
    if not page.query_selector(f"[data-popover='plot-options'] details[data-panel='{pid}']"):
        if page.query_selector(POP):
            page.keyboard.press("Escape")                 # another plot's pop-over
            page.wait_for_selector(POP, state="detached")
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"{POP} details[data-panel='{pid}']")
    page.evaluate("(id) => { const d = document.querySelector(`[data-popover='plot-options'] details[data-panel='${id}'][data-section='points']`);"
                  " if (!d.open) d.querySelector('summary').click(); }", pid)
    page.locator(f"#point-size-input-{pid}").scroll_into_view_if_needed()
    page.wait_for_selector(f"#point-size-input-{pid}", state="visible")
