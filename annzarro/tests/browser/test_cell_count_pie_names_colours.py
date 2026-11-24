"""A pie lists, names and colours its slices (operator, 0.8.0), in a real browser: the legend follows Plot Options and holds the
slices' colours (the same group colours every plot shows), Names / Numbers / Both / None are one undo step each, bins of a number
take continuous colours by default with a colour bar and Min / Max boxes, categories refuse them with the reason, and the SVG
export carries the names.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

served = cc.served
page = cc.page
CC, S = cc.CC, cc.S
DEPTH = {"source": {"type": "obs", "key": "depth"}}
POP = "[data-popover='plot-options']"

LEGEND = """(s) => [...document.querySelectorAll(s + ' .ccnt-plot .legend .traces')].map((t) => {
    const swatch = t.querySelector('.legendpoints path, .legendpie path');
    return { text: t.querySelector('text').textContent, fill: swatch ? getComputedStyle(swatch).fill : null };
})"""
NOTES = "(s) => [...document.querySelectorAll(s + ' .ccnt-plot .annotation-text-g text')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean)"
SLICES = "(s) => { const p = document.querySelector(s + ' .ccnt-plot'); return { labels: p.data[0].labels, colors: p.data[0].marker.colors }; }"
BAR = "(s) => [...document.querySelector(s + ' .ccnt-plot').data].map((t) => [t.name, t.marker.color])"


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.locator(S).screenshot(path=os.path.join(folder, name))


def _rgb(hexcolour):
    h = hexcolour.lstrip("#")
    return f"rgb({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)})"


def _pie(page, served, **config):
    cc._open(page, served, {CC: cc._count(mode="pie", **config)})
    cc._drawn(page, "pie")


def test_the_legend_holds_the_slices_colours_and_follows_plot_options(page, served):
    _pie(page, served, x=cc.CELL_TYPE)
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .legend .traces').length >= 6", S)
    legend = page.evaluate(LEGEND, S)
    slices = page.evaluate(SLICES, S)
    assert [e["text"] for e in legend] == slices["labels"], "one entry for each slice, by name"
    assert [e["fill"] for e in legend] == [_rgb(c) for c in slices["colors"]], "each entry in its slice's colour"
    _shot(page, "pie-legend.png")
    # the same group colours as every other plot of the column: a bar coloured by it
    page.evaluate(f"() => window.PanelManager.getPanel('{CC}').updateConfig({{ version: 1, mode: 'bar', x: {cc.CONDITION}, split: {cc.CELL_TYPE} }})")
    cc._drawn(page, "bar")
    bar = dict(page.evaluate(BAR, S))
    assert dict(zip(slices["labels"], slices["colors"])) == {k: bar[k] for k in slices["labels"]}
    page.evaluate(f"() => window.PanelManager.getPanel('{CC}').updateConfig({{ version: 1, mode: 'pie', x: {cc.CELL_TYPE} }})")
    cc._drawn(page, "pie")
    # Plot Options > Legend: the cap lists the first entries and "+ k more"; Show legend off draws none
    page.click(f"{S} .ccnt-options-btn")
    page.wait_for_selector(POP)
    page.evaluate("() => { const d = document.querySelector(`[data-popover='plot-options'] details[data-section='legend']`); if (!d.open) d.querySelector('summary').click(); }")
    page.fill(f"{POP} [data-option='legendMax']", "3")
    page.press(f"{POP} [data-option='legendMax']", "Enter")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .legend .traces').length === 4", S)
    assert page.evaluate(LEGEND, S)[-1]["text"].startswith("+ 3 more")
    page.uncheck(f"{POP} [data-option='showLegend']")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .legend .traces').length === 0", S)
    assert cc._config(page)["look"]["showLegend"] is False


def test_names_numbers_both_and_none_are_one_undo_step_each(page, served):
    _pie(page, served, x=cc.CELL_TYPE, labels="count")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .annotation-text-g text').length > 0", S)
    numbers = page.evaluate(NOTES, S)
    assert all(t.replace(",", "").isdigit() for t in numbers), numbers
    # Both: the name above the number
    page.check(f"{S} .ccnt-names")
    cc._drawn(page, "pie", "c.names === true")
    both = page.evaluate(NOTES, S)
    labels = page.evaluate(SLICES, S)["labels"]
    assert len(both) == len(numbers) and all(b.startswith(labels[i]) and b.endswith(numbers[i]) for i, b in enumerate(both)), both
    _shot(page, "pie-names-and-numbers.png")
    # Names alone: Labels None
    page.select_option(f"{S} .ccnt-labels", "none")
    cc._drawn(page, "pie", "c.labels === undefined && c.names === true")
    assert page.evaluate(NOTES, S) == labels[: len(both)] or all(n in labels for n in page.evaluate(NOTES, S))
    # None: neither
    page.uncheck(f"{S} .ccnt-names")
    cc._drawn(page, "pie", "c.names === undefined")
    assert page.evaluate(NOTES, S) == []
    # each change was one step: three Undos walk back to the numbers and the stored config has no new field
    for expect in ("c.names === true && c.labels === undefined", "c.names === true && c.labels === 'count'", "c.names === undefined && c.labels === 'count'"):
        page.click(f"{S} .ccnt-undo")
        cc._drawn(page, "pie", expect)
    assert page.evaluate(NOTES, S) == numbers


def test_bins_of_a_number_take_continuous_colours_with_a_colour_bar_and_range_boxes(page, served):
    _pie(page, served, x=DEPTH, labels="count")
    until(page, "(s) => !!document.querySelector(s + ' .ccnt-plot .colorbar')", S)
    config = cc._config(page)
    assert "color" not in config, "continuous is the default for bins: nothing stored"
    assert page.evaluate("(s) => document.querySelectorAll(s + ' .ccnt-plot .legend .traces').length", S) == 0
    colours = page.evaluate(SLICES, S)["colors"]
    assert len(set(colours)) == len(colours) > 2, colours
    page.check(f"{S} .ccnt-names")
    cc._drawn(page, "pie", "c.names === true")
    _shot(page, "pie-continuous.png")
    page.click(f"{S} .ccnt-color-btn")
    page.wait_for_selector("[data-popover='color'] .ccnt-slices")
    assert page.is_checked("[data-popover='color'] .ccnt-slices-continuous")
    assert page.is_visible("[data-popover='color'] .ccnt-color-map") and page.query_selector("[data-popover='color'] .ccnt-color-palette") is None
    drawn = page.evaluate("(s) => { const m = document.querySelector(s + ' .ccnt-plot').data.find((t) => t.meta && t.meta.pieAxes).marker; return [m.cmin, m.cmax]; }", S)
    low = drawn[0] + (drawn[1] - drawn[0]) / 2
    page.fill("[data-popover='color'] .ccnt-color-min", str(low))
    page.press("[data-popover='color'] .ccnt-color-min", "Enter")
    cc._drawn(page, "pie", f"c.color && c.color.min === {low}")
    after = page.evaluate("(s) => { const m = document.querySelector(s + ' .ccnt-plot').data.find((t) => t.meta && t.meta.pieAxes).marker; return [m.cmin, m.cmax]; }", S)
    assert after == [low, drawn[1]], after
    # the level palette instead: a legend, no colour bar; Undo restores the continuous colours
    page.check("[data-popover='color'] .ccnt-slices-levels")
    cc._drawn(page, "pie", "c.color && c.color.slices === 'levels'")
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .legend .traces').length > 2 && !document.querySelector(s + ' .ccnt-plot .colorbar')", S)
    page.click(f"{S} .ccnt-undo")
    cc._drawn(page, "pie", "!c.color || c.color.slices === undefined")
    until(page, "(s) => !!document.querySelector(s + ' .ccnt-plot .colorbar')", S)


def test_categories_refuse_continuous_colours_with_the_reason(page, served):
    _pie(page, served, x=cc.CELL_TYPE)
    page.click(f"{S} .ccnt-color-btn")
    page.wait_for_selector("[data-popover='color'] .ccnt-slices")
    assert page.is_disabled("[data-popover='color'] .ccnt-slices-continuous")
    assert page.is_checked("[data-popover='color'] .ccnt-slices-levels")
    reason = page.inner_text("[data-popover='color'] .ccnt-slices__note")
    assert "categories" in reason, reason
    assert page.get_attribute("[data-popover='color'] label:has(.ccnt-slices-continuous)", "title") == reason
    assert page.is_visible("[data-popover='color'] .ccnt-color-palette")
    assert page.evaluate("(s) => document.querySelectorAll(s + ' .ccnt-plot .colorbar').length", S) == 0


def test_the_exported_svg_carries_the_slice_names(page, served):
    _pie(page, served, x=cc.CELL_TYPE, labels="count", names=True)
    until(page, "(s) => document.querySelectorAll(s + ' .ccnt-plot .annotation-text-g text').length > 0", S)
    labels = page.evaluate(SLICES, S)["labels"]
    svg = page.evaluate("""async (s) => { const X = await import('/static/js/utils/plot-export.js');
        const raw = String(await X.exportImageData(document.querySelector(s + ' .ccnt-plot'), 'full', { format: 'svg', width: 700, height: 500, scale: 1 }));
        return (raw.startsWith('data:') ? decodeURIComponent(raw.slice(raw.indexOf(',') + 1)) : raw).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' '); }""", S)
    assert labels[0] in svg and labels[1] in svg, svg[:400]
