"""Plot Options: folded groups, tick controls, linked margins, colour bar, scale bar, presets, copying.

Two cell plots on the 200-cell fixture: A coloured by cell type (legend) with
Equal aspect on, B coloured by total counts (colour bar). Every control is
checked by what the plot draws, not by the setting it writes, and the options
travel with the panel (saved layout, link, a config from before them).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402

A, B = "cell-plot-A", "cell-plot-B"
GROUPS = ["Presets", "Appearance", "Axes and ticks", "Points", "Legend and colour bar", "Text", "Margins", "Export",
          "Apply to other panels"]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: errors.append(f"browser dialog: {d.message}") or d.dismiss())
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _cfgs(extra_a=None, extra_b=None):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    a = {"id": A, "x": x, "y": y, "z": None, "equalAspect": True,
         "color": {"type": "obs", "key": "cell_type", "column": ""}, **(extra_a or {})}
    b = {"id": B, "x": x, "y": y, "z": None, "color": {"type": "obs", "key": "total_counts", "column": ""},
         **(extra_b or {})}
    return {A: a, B: b}


def _link(root, cfgs=None):
    cfgs = cfgs or _cfgs()
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in (A, B)]
    layout = {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                      "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}],
              "controlState": {i: True for i in (A, B)}, "panelConfigs": cfgs}
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


GD = """(id) => document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)"""
DRAWN = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd.data && gd.data.some(t => t.x && t.x.length > 1)
    && gd._fullLayout.xaxis && gd._fullLayout.xaxis.range); }""" % GD


def _open(page, root, cfgs=None):
    page.goto(_link(root, cfgs))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1500)


def _full(page, pid, path):
    """A value of the plot's drawn layout: 'xaxis.nticks', 'margin.t', ..."""
    return page.evaluate("""([id, path]) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), (%s)(id)._fullLayout)"""
                         % GD, [pid, path])


def _menu(page, pid, section=None):
    """Open the plot's menu (once) and a group of it."""
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    if section:
        d = page.query_selector(f"details[data-panel='{pid}'][data-section='{section}']")
        if not d.evaluate("e => e.open"):
            d.query_selector("summary").click()
        page.wait_for_function("(e) => e.open", arg=d)


def _close_menu(page, pid):
    page.click(f"#aesthetics-menu-btn-{pid}")
    page.wait_for_selector(f"details[data-panel='{pid}']", state="detached")


def _change(page, selector, value):
    """Type into a number or text box and leave it (the change event)."""
    page.fill(selector, str(value))
    page.press(selector, "Tab")
    page.wait_for_timeout(400)


def _settings(page, pid):
    return page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", pid)


def test_menu_is_grouped_in_folding_sections_that_stay_as_left(page, server):
    _open(page, server)
    _menu(page, A)
    titles = page.eval_on_selector_all(f"details[data-panel='{A}'] > summary", "els => els.map(e => e.textContent.trim())")
    assert titles == GROUPS
    opened = page.eval_on_selector_all(f"details[data-panel='{A}']", "els => els.filter(e => e.open).map(e => e.dataset.section)")
    assert opened == ["presets"]
    _menu(page, A, "margins")
    _close_menu(page, A)
    _menu(page, A)
    opened = page.eval_on_selector_all(f"details[data-panel='{A}']", "els => els.filter(e => e.open).map(e => e.dataset.section)")
    assert sorted(opened) == ["margins", "presets"]
    # the Not in table group lives under Points
    _menu(page, A, "points")
    assert page.is_visible(f"#not-in-table-scale-{A}")


def test_tick_marks_labels_and_count(page, server):
    _open(page, server)
    _menu(page, A, "axes")
    assert _full(page, A, "xaxis.ticks") == "outside" and _full(page, A, "xaxis.showticklabels") is True
    page.uncheck(f"#show-tick-marks-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.ticks === ''" % GD, arg=A)
    assert _full(page, A, "xaxis.showticklabels") is True          # the labels stay
    assert page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick text').length > 0" % GD, A)
    page.check(f"#show-tick-marks-{A}")
    page.uncheck(f"#show-axis-labels-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showticklabels === false" % GD, arg=A)
    assert _full(page, A, "xaxis.ticks") == "outside"              # the marks stay
    assert page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick text').length" % GD, A) == 0
    page.check(f"#show-axis-labels-{A}")
    many = page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick').length" % GD, A)
    _change(page, f"#tick-count-{A}", 3)
    assert _full(page, A, "xaxis.nticks") == 3 and _full(page, A, "yaxis.nticks") == 3
    few = page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick').length" % GD, A)
    assert 0 < few < many, (few, many)
    _change(page, f"#tick-count-{A}", "")                          # empty: automatic again
    assert _full(page, A, "xaxis.nticks") == 0
    assert page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick').length" % GD, A) == many


def test_margins_one_slider_for_all_sides_unlink_for_each(page, server):
    _open(page, server)
    _menu(page, A, "margins")
    assert not page.is_visible(f"#margin-sides-{A}")
    _change(page, f"#margin-all-input-{A}", 25)
    assert [_full(page, A, f"margin.{k}") for k in "ltrb"] == [25] * 4
    page.eval_on_selector(f"#margin-all-{A}", "e => { e.value = 40; e.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_timeout(300)
    assert [_full(page, A, f"margin.{k}") for k in "ltrb"] == [40] * 4
    page.check(f"#margins-unlink-{A}")
    assert page.is_visible(f"#margin-sides-{A}")
    assert page.is_disabled(f"#margin-all-{A}")
    _change(page, f"#margin-top-{A}", 70)
    assert _full(page, A, "margin.t") == 70 and _full(page, A, "margin.l") == 40
    cfg = _settings(page, A)
    assert cfg["marginsUnlinked"] is True and cfg["margins"]["t"] == 70 and cfg["margins"]["l"] == 40
    page.uncheck(f"#margins-unlink-{A}")                           # linked again: one value for all
    assert not page.is_visible(f"#margin-sides-{A}")
    assert len({_full(page, A, f"margin.{k}") for k in "ltrb"}) == 1


def test_colour_bar_position_length_and_ticks(page, server):
    _open(page, server)
    _menu(page, B, "legend")
    bar = """(id) => { const t = (%s)(id).data.find(t => t.marker && t.marker.colorbar); return t.marker.colorbar; }""" % GD
    assert page.evaluate(bar, B)["orientation"] == "v"
    page.select_option(f"#colorbar-position-{B}", "bottom")
    page.wait_for_function("(a) => (%s)(a[0]).data.find(t => t.marker && t.marker.colorbar).marker.colorbar.orientation === 'h'" % GD, arg=[B])
    page.eval_on_selector(f"#colorbar-length-{B}", "e => { e.value = 50; e.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_function("(id) => (%s)(id).data.find(t => t.marker && t.marker.colorbar).marker.colorbar.len === 0.5" % GD, arg=B)
    cbar_h = page.evaluate("(id) => (%s)(id).querySelector('.colorbar .cbfills').getBoundingClientRect().width" % GD, B)
    full_w = page.evaluate("(id) => (%s)(id)._fullLayout._size.w" % GD, B)
    assert cbar_h < 0.6 * full_w, (cbar_h, full_w)
    ticks = "(id) => (%s)(id).querySelectorAll('.colorbar .cbaxis text').length" % GD
    auto = page.evaluate(ticks, B)
    _change(page, f"#colorbar-ticks-{B}", 2)
    page.wait_for_function("(id) => (%s)(id).data.find(t => t.marker && t.marker.colorbar).marker.colorbar.nticks === 2" % GD, arg=B)
    page.wait_for_timeout(500)
    assert 0 < page.evaluate(ticks, B) < auto, (page.evaluate(ticks, B), auto)
    # with the legend again
    page.select_option(f"#colorbar-position-{B}", "legend")
    page.wait_for_function("(id) => (%s)(id).data.find(t => t.marker && t.marker.colorbar).marker.colorbar.orientation === 'v'" % GD, arg=B)
    # the colour bar settings are the panel's own
    assert _settings(page, A)["colorbarLength"] == 1


SB = """(id) => { const gd = (%s)(id);
    const s = (gd.layout.shapes || []).filter(s => s.name === 'az-scalebar');
    const a = (gd.layout.annotations || []).filter(a => a.name === 'az-scalebar');
    return {shapes: s.length, annotations: a.length, text: a[0] && a[0].text, x: s[0] && [s[0].x0, s[0].x1],
            drawn: gd.querySelectorAll('.shapelayer path').length}; }""" % GD


def _slide(page, selector, value):
    page.eval_on_selector(selector, "(e, v) => { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", value)
    page.wait_for_timeout(400)


def test_scale_bar_round_length_size_unit_corner_and_zoom(page, server):
    _open(page, server)
    _menu(page, A, "axes")
    assert page.evaluate(SB, A)["shapes"] == 0
    assert not page.is_checked(f"#show-scale-bar-{A}")                  # off by default
    page.check(f"#show-scale-bar-{A}")
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    first = page.evaluate(SB, A)
    assert first["shapes"] == 1 and first["annotations"] == 1
    n = first["text"]                                                   # coordinate units, no suffix yet
    assert float(n) > 0
    # a round length: 1, 2 or 5 times a power of ten
    mant = float(f"{float(n):.6e}".split("e")[0])
    assert round(mant) in (1, 2, 5) and abs(mant - round(mant)) < 1e-9, first["text"]
    # about a fifth of the visible width
    width = page.evaluate("(id) => { const r = (%s)(id)._fullLayout.xaxis.range; return Math.abs(r[1] - r[0]); }" % GD, A)
    assert 0.5 * (width / 5) <= float(n) <= 2 * (width / 5), (n, width)
    assert abs(abs(first["x"][1] - first["x"][0]) - float(n)) < 1e-6
    assert first["drawn"] >= 1
    # the size control: a larger bar, with a thicker line
    line = "(id) => (%s)(id).layout.shapes.find(s => s.name === 'az-scalebar').line.width" % GD
    w1 = page.evaluate(line, A)
    _slide(page, f"#scale-bar-size-{A}", 400)
    big = page.evaluate(SB, A)
    assert float(big["text"]) > float(n) and page.evaluate(line, A) > w1, (first, big)
    _slide(page, f"#scale-bar-size-{A}", 100)
    # the optional unit suffix
    _change(page, f"#scale-bar-unit-{A}", "µm")
    assert page.evaluate(SB, A)["text"] == f"{n} µm"
    _change(page, f"#scale-bar-unit-{A}", "")
    assert page.evaluate(SB, A)["text"] == n
    # zoomed in to a tenth, it is shorter
    page.evaluate("""async (id) => { const gd = (%s)(id); const [a, b] = gd._fullLayout.xaxis.range; const m = (a + b) / 2, w = (b - a) / 10;
        await Plotly.relayout(gd, {'xaxis.range': [m - w / 2, m + w / 2]}); }""" % GD, A)
    page.wait_for_timeout(500)
    zoomed = page.evaluate(SB, A)
    assert zoomed["shapes"] == 1 and float(zoomed["text"].split(" ")[0]) < float(n), (first, zoomed)
    # a resized panel: Equal aspect changes the x range with the width, and the bar follows it
    page.evaluate("""async (id) => { await Plotly.relayout((%s)(id), {'xaxis.autorange': true}); }""" % GD, A)
    page.wait_for_timeout(300)
    RANGE = "(id) => (%s)(id)._fullLayout.xaxis.range.slice()" % GD
    before = page.evaluate(RANGE, A)
    page.set_viewport_size({"width": 700, "height": 1000})
    page.wait_for_timeout(1500)
    after = page.evaluate(RANGE, A)
    assert abs((after[1] - after[0]) - (before[1] - before[0])) > 0.05 * (before[1] - before[0]), (before, after)
    right_edge = page.evaluate("""(id) => { const gd = (%s)(id); const r = gd._fullLayout.xaxis.range; const lo = Math.min(...r), hi = Math.max(...r);
        const s = gd.layout.shapes.find(s => s.name === 'az-scalebar'); return [s.x1, hi - 0.04 * (hi - lo)]; }""" % GD, A)
    assert abs(right_edge[0] - right_edge[1]) < 1e-6, right_edge
    # the corner
    page.evaluate("""async (id) => { await Plotly.relayout((%s)(id), {'xaxis.autorange': true}); }""" % GD, A)
    page.select_option(f"#scale-bar-corner-{A}", "top-left")
    page.wait_for_timeout(500)
    corner = page.evaluate("(id) => { const gd = (%s)(id); const s = gd.layout.shapes.find(s => s.name === 'az-scalebar'); const r = gd._fullLayout.xaxis.range; return [s.y0, s.x0 - Math.min(r[0], r[1]) < s.x1 - Math.min(r[0], r[1])? s.x0 : s.x1, Math.min(r[0], r[1]), Math.max(r[0], r[1])]; }" % GD, A)
    assert corner[0] == 0.95 and corner[1] < (corner[2] + corner[3]) / 2, corner
    # off again
    page.uncheck(f"#show-scale-bar-{A}")
    page.wait_for_function("(id) => !(%s)(id).layout.shapes || !(%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    assert page.evaluate(SB, A)["annotations"] == 0


def test_scale_bar_is_greyed_with_its_reason_without_equal_aspect(page, server):
    _open(page, server)
    _menu(page, B, "axes")
    assert page.is_disabled(f"#show-scale-bar-{B}")
    assert page.is_disabled(f"#scale-bar-size-{B}")
    assert "Equal aspect" in page.inner_text(f"#scale-bar-note-{B}")
    assert "Needs Equal aspect" in page.get_attribute(f"#scale-bar-options-{B} .form-check", "title")
    assert page.evaluate(SB, B)["shapes"] == 0


def test_turning_equal_aspect_off_switches_the_scale_bar_off_for_good(page, server):
    _open(page, server, _cfgs(extra_a={"showScaleBar": True}))
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    page.click(f"#equal-aspect-{A}")                                    # Equal aspect off
    page.wait_for_function("(id) => !(%s)(id).layout.shapes || !(%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    assert _settings(page, A)["showScaleBar"] is False                  # the setting itself is off
    page.click(f"#equal-aspect-{A}")                                    # back on: the bar stays off
    page.wait_for_timeout(800)
    assert _settings(page, A)["showScaleBar"] is False
    assert page.evaluate(SB, A)["shapes"] == 0
    _menu(page, A, "axes")
    assert not page.is_checked(f"#show-scale-bar-{A}") and not page.is_disabled(f"#show-scale-bar-{A}")


def test_publication_and_default_presets(page, server):
    _open(page, server, _cfgs(extra_a={"showScaleBar": True}))
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    base_font = _full(page, A, "font.size")
    assert _full(page, A, "xaxis.showgrid") is True
    _menu(page, A, "presets")
    page.click(f"#preset-publication-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showgrid === false" % GD, arg=A)
    assert _full(page, A, "yaxis.showgrid") is False
    assert _full(page, A, "paper_bgcolor") == "#ffffff"
    assert _full(page, A, "font.size") > base_font
    assert _full(page, A, "xaxis.nticks") == 5 and _full(page, A, "xaxis.ticks") == "outside"
    cfg = _settings(page, A)
    assert cfg["showGrid"] is False and cfg["tickCount"] == 5
    assert cfg["showScaleBar"] is True and page.evaluate(SB, A)["shapes"] == 1      # the scale bar is not part of the preset
    # the menu shows what it did
    assert not page.is_checked(f"#grid-toggle-{A}") if page.query_selector(f"#grid-toggle-{A}") else True
    page.click(f"#preset-default-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showgrid === true" % GD, arg=A)
    assert _full(page, A, "font.size") == base_font
    assert _full(page, A, "xaxis.nticks") == 0
    page.wait_for_function("(id) => !(%s)(id).layout.shapes || !(%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    cfg = _settings(page, A)
    assert cfg["showGrid"] is True and cfg["tickCount"] is None and cfg["showScaleBar"] is False


def test_apply_to_other_panels_asks_in_the_page_and_copies_only_the_look(page, server):
    _open(page, server)
    page.evaluate("""async (id) => { const gd = (%s)(id); await Plotly.relayout(gd, {paper_bgcolor: '#ffffff'}); }""" % GD, B)
    _menu(page, A, "appearance")
    page.eval_on_selector(f"#plot-bg-color-{A}", "e => { e.value = '#223344'; e.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.wait_for_timeout(300)
    _menu(page, A, "text")
    _change(page, f"#font-size-{A}", 18)
    _menu(page, A, "axes")
    _change(page, f"#tick-count-{A}", 4)
    assert _full(page, B, "paper_bgcolor") == "#ffffff"
    _menu(page, A, "apply")
    assert not page.is_visible(f"#apply-others-ask-{A}")
    page.click(f"#apply-others-{A}")
    assert page.is_visible(f"#apply-others-ask-{A}")                  # a question in the page, not a dialog
    assert "1 other plot" in page.inner_text(f"#apply-others-text-{A}")
    page.click(f"#apply-others-no-{A}")                               # cancel: nothing changes
    page.wait_for_timeout(300)
    assert _full(page, B, "paper_bgcolor") == "#ffffff" and _settings(page, B).get("tickCount") is None
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.paper_bgcolor === '#223344'" % GD, arg=B)
    assert _full(page, B, "font.size") == 18 and _full(page, B, "xaxis.nticks") == 4
    assert "Applied to 1 plot" in page.inner_text(f"#apply-others-done-{A}")
    cfg_a, cfg_b = _settings(page, A), _settings(page, B)
    # the look moved, what the plot shows did not
    assert cfg_b["bgColor"] == "#223344" and cfg_b["tickCount"] == 4 and cfg_b["fontSize"] == 18
    assert cfg_b["color"]["key"] == "total_counts" and cfg_a["color"]["key"] == "cell_type"
    assert not cfg_b.get("equalAspect")
    assert cfg_b["id"] == B


def test_options_travel_with_the_panel_and_old_configs_get_defaults(page, server):
    # a config from before these options
    _open(page, server)
    old = _settings(page, A)
    for key in ("tickCount", "marginsUnlinked", "colorbarPosition", "colorbarLength", "colorbarTicks", "showScaleBar",
                "scaleBarCorner", "scaleBarSize", "scaleBarUnit"):
        assert key in old, key
    assert old["tickCount"] is None and old["marginsUnlinked"] is False and old["colorbarPosition"] == "legend"
    assert old["colorbarLength"] == 1 and old["showScaleBar"] is False and old["scaleBarUnit"] == ""
    # set several, read the saved layout, open it as a link: the plot draws them
    _menu(page, A, "axes")
    _change(page, f"#tick-count-{A}", 4)
    page.uncheck(f"#show-tick-marks-{A}")
    _slide(page, f"#scale-bar-size-{A}", 200)
    _change(page, f"#scale-bar-unit-{A}", "nm")
    page.select_option(f"#scale-bar-corner-{A}", "bottom-left")
    page.check(f"#show-scale-bar-{A}")
    _menu(page, A, "margins")
    page.check(f"#margins-unlink-{A}")
    _change(page, f"#margin-left-{A}", 33)
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    cfg = layout["panelConfigs"][A]
    assert (cfg["tickCount"], cfg["showTickMarks"], cfg["scaleBarUnit"], cfg["scaleBarCorner"], cfg["showScaleBar"],
            cfg["marginsUnlinked"], cfg["margins"]["l"]) == (4, False, "nm", "bottom-left", True, True, 33)
    page.goto("about:blank")
    page.goto(_link(server, {A: cfg, B: layout["panelConfigs"][B]}))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1500)
    assert _full(page, A, "xaxis.nticks") == 4 and _full(page, A, "xaxis.ticks") == ""
    assert _full(page, A, "margin.l") == 33
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD), arg=A)
    assert page.evaluate(SB, A)["text"].endswith(" nm") and cfg["scaleBarSize"] == 2
    assert _settings(page, B)["tickCount"] is None


def test_each_panel_has_its_own_margins(page, server):
    """One plot's margins are not another's."""
    _open(page, server)
    _menu(page, A, "margins")
    _change(page, f"#margin-all-input-{A}", 15)
    assert _settings(page, A)["margins"]["t"] == 15
    assert _settings(page, B)["margins"]["t"] == 80


def test_grid_off_keeps_the_tick_labels_on_the_first_draw(page, server):
    """Tick labels follow their own switch: a plot opened with the grid off (a Publication look) shows them."""
    _open(page, server, _cfgs(extra_a={"showGrid": False}))
    assert _full(page, A, "xaxis.showgrid") is False
    assert _full(page, A, "xaxis.showticklabels") is True
    assert page.evaluate("(id) => (%s)(id).querySelectorAll('.xtick text').length > 0" % GD, A)
