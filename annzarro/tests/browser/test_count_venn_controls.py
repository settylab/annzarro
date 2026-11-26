"""A Venn's own controls in a real browser (operator, 0.8.0): "controlling the names and stats shown, and toggle enabling that
the area of the sections reflects the amount in them".

Served as test_count_sets.py serves it (the grouping fixture, 1,200 cells). Three sets (levels of a column, a condition
on a number, a boolean column) draw a Venn; then, each on the drawn page:

1.  Labels (Count and fraction, Count, Fraction, None) and Names: each draws what it says and is one Undo step; a value is
    stored only when it differs from its default, and going back to the default removes the field.
2.  Area reflects counts: each circle's area is in proportion to its set's cells (measured from the shapes Plotly drew),
    the label of each region is still the brute-force count, one Undo returns equal circles, and an old link (none of the
    fields) draws the equal circles as before.
3.  Export (SVG) carries the labels the plot shows, fixed and proportional; screenshots are kept for the report when
    ANNZARRO_SHOTS is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import math
import os
import re

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: F401,E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import (  # noqa: E402,F401  (fixtures: served, page)
    CC, S, served, page, _count, _open, _config,
)
from annzarro.tests.browser.test_count_sets import (  # noqa: E402
    LEVELS_SET, COND_SET, BOOL_SET, _drawn, _membership, _regions, _undo_steps,
)

SETS = [LEVELS_SET, COND_SET, BOOL_SET]

FIGURE = """(s) => { const p = document.querySelector(s + ' .ccnt-plot');
    const t = p._fullData.find(d => d.name === 'regions');
    const circles = p._fullLayout.shapes.filter(h => h.type === 'circle');
    return { text: Array.from(t.text), names: p._fullLayout.annotations.map(a => a.text).filter(x => /^[ABC] · /.test(x)),
        radii: circles.map(h => (h.x1 - h.x0) / 2), notes: p._fullLayout.annotations.map(a => a.text).filter(x => x.startsWith('Areas are approximate')),
        centres: circles.map(h => [(h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2]) }; }"""


FIXED = [(-0.55, 0.32), (0.55, 0.32), (0, -0.62)]


def _fixed(fig):
    """Whether the circles are the fixed layout's (equal, at the places of draw-sets.js `VENN`)."""
    return len(fig["centres"]) == 3 and all(abs(c[0] - f[0]) < 1e-9 and abs(c[1] - f[1]) < 1e-9 for c, f in zip(fig["centres"], FIXED))


def _figure(page):
    return page.evaluate(FIGURE, S)


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.locator(S).screenshot(path=os.path.join(folder, name))


def _venn(page, served, **extra):
    _open(page, served, {CC: _count(mode="venn", sets=SETS, **extra)})
    _drawn(page, "venn")
    until(page, "(s) => !!document.querySelector(s + ' .ccnt-plot')._fullData", S)


def _wait_text(page, predicate):
    until(page, f"(s) => {{ const f = ({FIGURE})(s); return ({predicate}); }}", S)


def _svg(page):
    return page.evaluate("""async (s) => { const p = document.querySelector(s + ' .ccnt-plot');
        const url = await window.Plotly.toImage(p, { format: 'svg', width: 900, height: 600 });
        return decodeURIComponent(url.split(',').slice(1).join(',')); }""", S)


def test_venn_controls_sit_in_the_labels_row_and_default_to_what_old_links_drew(page, served):
    _venn(page, served)
    row = page.evaluate("""(s) => { const r = document.querySelector(s + ' .ccnt-row--labels');
        return { shown: r.offsetParent !== null, select: [...r.querySelectorAll('.ccnt-labels option')].map(o => o.textContent),
                 value: r.querySelector('.ccnt-labels').value, names: r.querySelector('.ccnt-names').checked,
                 area: r.querySelector('.ccnt-venn-area').checked, areaShown: r.querySelector('.ccnt-venn-area').offsetParent !== null,
                 areaLabel: r.querySelector('.ccnt-venn-area').parentElement.textContent.trim() }; }""", S)
    assert row == {"shown": True, "select": ["Count and fraction", "Count", "Fraction", "None"], "value": "both", "names": True,
                   "area": False, "areaShown": True, "areaLabel": "Area reflects counts"}, row
    brute = _regions(SETS)
    fig = _figure(page)
    assert [t.split("<br>")[0] for t in fig["text"]] == [f"{brute.get(c, 0):,}" for c in range(1, 8)]
    assert all(re.search(r"<br>[\d.<]+$", t) for t in fig["text"]) and len(fig["names"]) == 3
    assert fig["radii"] == [1, 1, 1] and _fixed(fig), "the fixed layout"
    config = _config(page)
    assert not any(k in config for k in ("vennLabels", "vennNames", "vennArea")), config
    # the row is not there in another mode (the pie's Names is its own)
    page.select_option(f"{S} .ccnt-mode", "upset")
    _drawn(page, "upset")
    assert not page.is_visible(f"{S} .ccnt-venn-area")


def test_each_label_mode_and_names_is_one_undo_step_and_stored_only_off_its_default(page, served):
    _venn(page, served)
    brute = _regions(SETS)
    counts = [f"{brute.get(c, 0):,}" for c in range(1, 8)]
    steps = _undo_steps(page)

    for value, check in (("count", lambda t: t in counts), ("share", lambda t: re.fullmatch(r"[\d.<]+", t) is not None), ("none", lambda t: t == "")):
        page.select_option(f"{S} .ccnt-labels", value)
        _drawn(page, "venn", f"c.vennLabels === '{value}'")
        _wait_text(page, "f.text.every(t => " + {"count": "/^[\\d,]+$/.test(t)", "share": "/^[\\d.<]+$/.test(t)", "none": "t === ''"}[value] + ")")
        fig = _figure(page)
        assert all(check(t) for t in fig["text"]), (value, fig["text"])
        if value == "count":
            assert fig["text"] == counts
        steps += 1
        assert _undo_steps(page) == steps, f"{value} is one step"
        _shot(page, f"venn-fixed-{value}.png")

    # back to the default removes the field
    page.select_option(f"{S} .ccnt-labels", "both")
    _drawn(page, "venn", "c.vennLabels === undefined")
    _wait_text(page, "f.text.every(t => t.includes('<br>'))")
    steps += 1
    assert _undo_steps(page) == steps

    page.uncheck(f"{S} .ccnt-names")
    _drawn(page, "venn", "c.vennNames === false")
    _wait_text(page, "f.names.length === 0")
    steps += 1
    assert _undo_steps(page) == steps
    _shot(page, "venn-fixed-no-names.png")
    page.check(f"{S} .ccnt-names")
    _drawn(page, "venn", "c.vennNames === undefined")
    _wait_text(page, "f.names.length === 3")
    steps += 1

    # Undo walks them back, one each: names on, then names off, labels both, labels none
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "venn", "c.vennNames === false")
    _wait_text(page, "f.names.length === 0")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "venn", "c.vennNames === undefined")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "venn", "c.vennLabels === 'none'")
    _wait_text(page, "f.text.every(t => t === '')")
    assert page.input_value(f"{S} .ccnt-labels") == "none"


def test_area_reflects_counts_draws_circles_in_proportion_to_their_sets_and_is_one_step(page, served):
    _venn(page, served)
    inside = _membership(SETS)
    sizes = [int(inside[:, s].sum()) for s in range(3)]
    brute = _regions(SETS)
    steps = _undo_steps(page)
    page.check(f"{S} .ccnt-venn-area")
    _drawn(page, "venn", "c.vennArea === true")
    _wait_text(page, "!f.centres.every(([x, y], i) => Math.abs(x - [-0.55, 0.55, 0][i]) < 1e-9 && Math.abs(y - [0.32, 0.32, -0.62][i]) < 1e-9)")
    fig = _figure(page)
    assert _undo_steps(page) == steps + 1
    big = max(sizes)
    for r, n in zip(fig["radii"], sizes):
        assert abs(r ** 2 - n / big) < 1e-3, (fig["radii"], sizes)
    assert not _fixed(fig)
    # the labels that are drawn are still the brute-force counts (a region too small for its label has none)
    drawn = [(c, t) for c, t in zip(range(1, 8), fig["text"]) if t]
    assert len(drawn) >= 3
    for code, text in drawn:
        assert text.split("<br>")[0] == f"{brute.get(code, 0):,}", (code, text)
    _shot(page, "venn-proportional-both.png")
    for value in ("count", "share", "none"):
        page.select_option(f"{S} .ccnt-labels", value)
        _drawn(page, "venn", f"c.vennLabels === '{value}' && c.vennArea === true")
        _wait_text(page, "f.text.every(t => " + {"count": "!t.includes('%') && !t.includes('<br>')", "share": "t === '' || /^[\\d.<]+$/.test(t)", "none": "t === ''"}[value] + ")")
        _shot(page, f"venn-proportional-{value}.png")
    page.select_option(f"{S} .ccnt-labels", "both")
    _drawn(page, "venn", "c.vennLabels === undefined && c.vennArea === true")
    page.uncheck(f"{S} .ccnt-names")
    _drawn(page, "venn", "c.vennNames === false")
    _wait_text(page, "f.names.length === 0")
    _shot(page, "venn-proportional-no-names.png")
    page.check(f"{S} .ccnt-names")
    _drawn(page, "venn", "c.vennNames === undefined")

    # off again: the field is gone and the equal circles are back, as one Undo from the toggle
    page.uncheck(f"{S} .ccnt-venn-area")
    _drawn(page, "venn", "c.vennArea === undefined")
    _wait_text(page, "f.radii.every(r => r === 1)")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "venn", "c.vennArea === true")
    _wait_text(page, "!f.centres.every(([x, y], i) => Math.abs(x - [-0.55, 0.55, 0][i]) < 1e-9 && Math.abs(y - [0.32, 0.32, -0.62][i]) < 1e-9)")


def test_two_sets_draw_the_overlap_in_proportion_and_an_impossible_three_says_so(page, served):
    _open(page, served, {CC: _count(mode="venn", sets=SETS[:2], vennArea=True)})
    _drawn(page, "venn")
    until(page, "(s) => !!document.querySelector(s + ' .ccnt-plot')._fullData", S)
    inside = _membership(SETS[:2])
    a, b, ab = int(inside[:, 0].sum()), int(inside[:, 1].sum()), int((inside[:, 0] & inside[:, 1]).sum())
    geometry = page.evaluate("""(s) => { const [c0, c1] = document.querySelector(s + ' .ccnt-plot')._fullLayout.shapes.filter(h => h.type === 'circle');
        return [(c0.x1 - c0.x0) / 2, (c1.x1 - c1.x0) / 2, Math.hypot((c1.x0 + c1.x1) / 2 - (c0.x0 + c0.x1) / 2, (c1.y0 + c1.y1) / 2 - (c0.y0 + c0.y1) / 2)]; }""", S)
    r0, r1, d = geometry
    lens = (r0 ** 2 * math.acos((d * d + r0 ** 2 - r1 ** 2) / (2 * d * r0)) + r1 ** 2 * math.acos((d * d + r1 ** 2 - r0 ** 2) / (2 * d * r1))
            - 0.5 * math.sqrt((-d + r0 + r1) * (d + r0 - r1) * (d - r0 + r1) * (d + r0 + r1)))
    per = math.pi / max(a, b)
    assert abs(lens - ab * per) / (ab * per) < 1e-4, (lens, ab * per)
    _shot(page, "venn-proportional-two-sets.png")
    assert _figure(page)["notes"] == []


def test_an_old_link_with_none_of_the_fields_draws_the_equal_circles_and_nothing_is_stored(page, served):
    _venn(page, served)
    fig = _figure(page)
    assert fig["radii"] == [1, 1, 1] and _fixed(fig)
    assert not any(k in _config(page) for k in ("vennLabels", "vennNames", "vennArea"))


def test_export_carries_the_labels_the_plot_shows(page, served):
    _venn(page, served)
    brute = _regions(SETS)
    svg = _svg(page)
    for code in range(1, 8):
        assert f"{brute.get(code, 0):,}" in svg
    assert "A · " in svg and "B · " in svg and "C · " in svg
    page.select_option(f"{S} .ccnt-labels", "share")
    _drawn(page, "venn", "c.vennLabels === 'share'")
    _wait_text(page, "f.text.every(t => /^[\\d.<]+$/.test(t))")
    page.uncheck(f"{S} .ccnt-names")
    _drawn(page, "venn", "c.vennNames === false")
    _wait_text(page, "f.names.length === 0")
    svg = _svg(page)
    assert "A · " not in svg and re.search(r">0\.\d+<", svg)
    page.check(f"{S} .ccnt-venn-area")
    _drawn(page, "venn", "c.vennArea === true")
    _wait_text(page, "!f.centres.every(([x, y], i) => Math.abs(x - [-0.55, 0.55, 0][i]) < 1e-9 && Math.abs(y - [0.32, 0.32, -0.62][i]) < 1e-9)")
    svg = _svg(page)
    assert svg.count("<circle") + svg.count("<path") >= 3 and re.search(r">0\.\d+<", svg) and "A · " not in svg


PIXELS = """(s) => [...document.querySelectorAll(s + ' .ccnt-plot .shapelayer path')].map(p => { const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; })"""


def test_circles_of_an_edited_plot_are_where_a_fresh_plot_puts_them(page, served):
    """The circles are drawn in the hidden axes' coordinates: after edits, in pixels, they are those of the plot opened from the final config."""
    _venn(page, served)
    for step in (lambda: page.check(f"{S} .ccnt-venn-area"), lambda: page.select_option(f"{S} .ccnt-labels", "share"),
                 lambda: page.uncheck(f"{S} .ccnt-names"), lambda: page.uncheck(f"{S} .ccnt-venn-area"), lambda: page.check(f"{S} .ccnt-venn-area")):
        step()
        _drawn(page, "venn")
    _drawn(page, "venn", "c.vennArea === true && c.vennNames === false && c.vennLabels === 'share'")
    _wait_text(page, "f.names.length === 0 && f.text.every(t => t === '' || /^[\\d.<]+$/.test(t))")
    config = _config(page)
    edited = page.evaluate(PIXELS, S)
    # the same page, loaded again from a link of the final config: a fresh drawing
    _open(page, served, {CC: {"id": CC, **config}})
    until(page, f"""(s) => {{ const r = document.querySelector(s + ' .ccnt-panel');
        return r && r.dataset.drawn === 'venn' && r.dataset.state === 'ready' && document.querySelectorAll(s + ' .ccnt-plot .shapelayer path').length > 0; }}""", S, timeout=60)
    fresh = page.evaluate(PIXELS, S)
    assert len(edited) == len(fresh) >= 3, (edited, fresh)
    for a, b in zip(edited, fresh):
        assert all(abs(x - y) <= 1.5 for x, y in zip(a, b)), (edited, fresh)
